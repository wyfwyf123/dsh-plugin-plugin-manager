// dsh-model-manager — Host half.
//
// The browser panel edits settings through the authenticated DSH Remote API.
// This half owns:
//   1. the subagent reasoning-effort override (`agent/request` waterfall);
//   2. a ring buffer of recent subagent dispatch decisions;
//   3. diagnostics routes registered inside Connection's authentication fence
//      (`connection.fetch.register`): connectivity probes, dispatch
//      simulation, and the dispatch log. No unauthenticated endpoint exists.
import { AsyncLocalStorage } from "node:async_hooks";
import { connect as connectTcp } from "node:net";
import { ProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { aliasFetchArgs, aliasUpstream } from "./routing.js";
import z from "@deepseek-ai/schemastery";
import { USAGE_DOMAIN, USAGE_KINDS, USAGE_LIMITS, costOf, createUsageStore, dayKey, normalizePrices, priceBounds, priceKey, promptTokens, tapUsage } from "./usage.js";

/** Marks llm.stream calls issued by this plugin's own probes. */
const probeScope = new AsyncLocalStorage();
/** Restricts credential resolution to one provider/model's selected Key. */
const keyScope = new AsyncLocalStorage();
/** Restricts the fetch dispatcher to one provider's active request chain. */
const providerProxyScope = new AsyncLocalStorage();

const normalizeProxyUrl = (raw) => {
	const value = typeof raw === "string" ? raw.trim() : "";
	if (!value) return "";
	let url;
	try { url = new URL(value.includes("://") ? value : `http://${value}`); }
	catch { throw new Error("代理地址格式无效，请填写 http://127.0.0.1:7890 这类地址"); }
	if (!(["http:", "https:"].includes(url.protocol)) || !url.hostname || !url.port) throw new Error("代理地址必须是带端口的 HTTP/HTTPS 代理，例如 http://127.0.0.1:7890");
	return url.toString().replace(/\/$/, "");
};

const probeTcp = (host, port, timeoutMs = 450) => new Promise((resolve) => {
	const socket = connectTcp({ host, port });
	let settled = false;
	const done = (ok) => { if (settled) return; settled = true; socket.destroy(); resolve(ok); };
	socket.setTimeout(timeoutMs);
	socket.once("connect", () => done(true));
	socket.once("timeout", () => done(false));
	socket.once("error", () => done(false));
});

/** Marks a request stream's iterator advancement with provider-local proxy context. */
async function* withProviderProxy(source, proxy, keyContext) {
	const iterator = source[Symbol.asyncIterator]();
	try {
		while (true) {
			const result = await providerProxyScope.run(proxy, () => keyScope.run(keyContext, () => iterator.next()));
			if (result.done) return;
			yield result.value;
		}
	} finally {
		await providerProxyScope.run(proxy, () => keyScope.run(keyContext, () => iterator.return?.()));
	}
}

async function* withKeyContext(source, context) {
	const iterator = source[Symbol.asyncIterator]();
	try {
		while (true) {
			const result = await keyScope.run(context, () => iterator.next());
			if (result.done) return;
			yield result.value;
		}
	} finally {
		await keyScope.run(context, () => iterator.return?.());
	}
}

export const name = "dsh-model-manager";
export const inject = ["settings", "credentials"];

/** Standard reasoning levels, ordered weakest → strongest. */
export const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const LLM_NS = "llm-pi-ai";
const SUBAGENT_NS = "subagent";
const SELECTION_NS = "subagent-model-selection-settings";
const TE_NS = "thinking-effort";
const DEFAULT_NS = "agent-default-model";
const DEFAULT_ENTRY_ID = "model-manager";

export const ROUTES = {
	probe: "/api/model-manager.probe",
	simulate: "/api/model-manager.simulate",
	dispatches: "/api/model-manager.dispatches",
	failover: "/api/model-manager.failover",
	sessions: "/api/model-manager.sessions",
	usage: "/api/model-manager.usage",
	keyUsage: "/api/model-manager.key-usage",
	models: "/api/model-manager.models",
	proxy: "/api/model-manager.proxy"
};
/** Failure codes that mean "this provider cannot serve anything right now". */
export const FAILOVER_CODES = ["QUOTA", "ACCOUNT_QUOTA", "AUTH", "MISSING_CREDENTIAL", "INVALID_CREDENTIAL", "ACCOUNT_TOKEN_INVALID", "ACCOUNT_SIGN_IN_REQUIRED", "NO_ADAPTER"];
const SCOPES = ["all", "subagent", "main"];
export const LIMITS = {
	bodyChars: 256 * 1024,
	targets: 64,
	concurrency: 64,
	promptChars: 4000,
	textChars: 600,
	minTimeoutMs: 1000,
	maxTimeoutMs: 300000,
	defaultTimeoutMs: 60000,
	logSize: 500,
	cases: 200,
	infoTtlMs: 60000,
	infoTimeoutMs: 4000,
	eventSize: 300,
	switchesPerTurn: 6,
	maxCooldownMinutes: 1440,
	sessionsTracked: 500
};

const RouteRule = z.object({
	enabled: z.boolean().default(true),
	fromProvider: z.string().default("").description("来源服务商。"),
	fromModel: z.string().default("").description("来源模型；空表示该服务商的所有模型。"),
	toProvider: z.string().default(""),
	toModel: z.string().default(""),
	toEffort: z.string().default("").description("目标推理程度；空表示按目标模型自动换算。"),
	scope: z.string().default("all").description("all | subagent | main")
});
const ChainEntry = z.object({
	provider: z.string().default(""),
	model: z.string().default(""),
	reasoningEffort: z.string().default("")
});
const ProviderProxy = z.object({
	enabled: z.boolean().default(false),
	url: z.string().default("")
});

const ProviderKey = z.object({
	id: z.string(),
	label: z.string().default(""),
	credentialRef: z.string().default(""),
	models: z.array(z.string()).default([]),
	availableModels: z.array(z.string()).default([]),
	onlyBound: z.boolean().default(false),
	limit: z.number().default(0),
	enabled: z.boolean().default(true)
});

export const Config = z.object({
	subagentEffort: z.string().default("").description("子代理推理程度；空字符串表示不干预。"),
	subagentMode: z.string().default("force").description("force：总是覆盖；fill：仅在未指定时填充。"),
	clampToModel: z.boolean().default(true).description("模型不支持所选程度时，自动换成最接近的已支持程度。"),
	subagentModelEfforts: z.dict(z.string()).default({}).description("按 provider/model 单独指定子代理推理程度。"),
	redirects: z.array(RouteRule).default([]).description("模型重定向：命中的请求（含已在运行的子代理）在下一次模型调用时改用目标模型。"),
	failover: z.object({
		enabled: z.boolean().default(true),
		scope: z.string().default("all").description("all | subagent | main"),
		cooldownMinutes: z.number().default(30).description("服务商被判定不可用后多久自动重试；0 表示直到手动恢复。"),
		codes: z.array(z.string()).default([...FAILOVER_CODES]).description("触发切换的错误码。"),
		chain: z.array(ChainEntry).default([]).description("备用模型，按顺序选第一个可用的。")
	}).default({}),
	usagePrices: z.dict(z.object({
		mode: z.union(["token", "call", "mixed"]).description("计费方式：按量 / 按次 / 按次 + 按量"),
		input: z.number().description("输入（未命中缓存）单价 / 百万 tokens"),
		output: z.number().description("输出单价 / 百万 tokens"),
		cacheRead: z.number().description("缓存命中单价 / 百万 tokens；空则按输入单价"),
		cacheWrite: z.number().description("缓存写入单价 / 百万 tokens；空则按输入单价"),
		perCall: z.number().description("每次调用的价格（失败的调用不计）"),
		tiers: z.array(z.object({
			above: z.natural().description("提示词（输入 + 缓存）超过多少 tokens 时整次调用改用本档价格"),
			input: z.number(),
			output: z.number(),
			cacheRead: z.number(),
			cacheWrite: z.number()
		})).description("阶梯价格；未填的项沿用基础价格"),
		currency: z.string().default("CNY")
	})).default({}).description("按 provider/model 配置的单价，仅用于估算费用。"),
	usagePriceHidden: z.array(z.string()).default([]).description("单价表中被手动删除、暂不显示的 provider/model。"),
	providerProxy: z.dict(ProviderProxy).default({}).description("服务商级本地 HTTP 代理设置；只作用于匹配服务商的模型调用、测试与模型发现。"),
	providerKeys: z.dict(z.object({ keys: z.array(ProviderKey).default([]) })).default({}).description("模型别名绑定（本地别名 → 上游模型）；多 API Key 路由已停用，服务商使用自己的单个密钥。"),
	providerLayout: z.object({
		order: z.array(z.string()).default([]).description("服务商自定义顺序。"),
		groups: z.array(z.object({
			name: z.string().default(""),
			providers: z.array(z.string()).default([]),
			collapsed: z.boolean().default(false)
		})).default([]).description("服务商分组，按数组顺序显示。")
	}).default({}).description("模型管理页的服务商分组与排序。")
}).default({}).volatile();

const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" && v.length > 0 ? v : undefined);

/** Read every settings section once per document revision. */
function createSettingsReader(ctx, entryId) {
	let cache;
	const read = () => {
		if (cache) return cache;
		let list = [];
		try {
			const out = ctx.settings.describe();
			list = Array.isArray(out) ? out : Array.isArray(out?.namespaces) ? out.namespaces : [];
		} catch {
			list = [];
		}
		cache = { byNs: new Map(list.map((d) => [String(d.ns), d])) };
		return cache;
	};
	const ns = (id) => {
		const d = read().byNs.get(id) ?? read().byNs.get(`include:${id}`);
		return isRecord(d?.value) ? d.value : undefined;
	};
	return {
		ns,
		own: (fallback) => ns(entryId) ?? fallback,
		llm: () => ns(LLM_NS),
		invalidate: () => {
			cache = undefined;
		}
	};
}

/** Levels a provider/model accepts according to llm-pi-ai settings, or undefined when unknown. */
export function supportedLevels(llmValue, provider, model) {
	const profile = llmValue?.providers?.[provider];
	if (!isRecord(profile)) return undefined;
	let efforts;
	if (Array.isArray(profile.models)) {
		const found = profile.models.find((m) => isRecord(m) && m.id === model);
		if (isRecord(found?.reasoningEfforts)) efforts = found.reasoningEfforts;
	}
	if (!efforts && isRecord(profile.modelOverrides?.[model]?.reasoningEfforts)) {
		efforts = profile.modelOverrides[model].reasoningEfforts;
	}
	if (!efforts) return undefined;
	return LEVELS.filter((level) => level in efforts && (level === "off" || typeof efforts[level] === "string"));
}

/**
 * Levels from adapter-resolved model metadata: `[]` when the model has no
 * reasoning, undefined when it only exposes non-standard effort ids.
 */
export function levelsFromInfo(info) {
	if (!isRecord(info)) return undefined;
	const efforts = Array.isArray(info.reasoning?.efforts) ? info.reasoning.efforts : [];
	if (efforts.length === 0) return [];
	const ids = efforts.map((e) => e?.id).filter((id) => typeof id === "string");
	const standard = LEVELS.filter((l) => ids.includes(l));
	return standard.length > 0 ? standard : undefined;
}

/** Pick the closest supported level; ties prefer the stronger one. */
export function clampLevel(level, supported) {
	if (!supported || supported.length === 0 || supported.includes(level)) return level;
	const want = LEVELS.indexOf(level);
	if (want < 0) return level;
	let best;
	let bestDistance = Infinity;
	for (const candidate of supported) {
		const index = LEVELS.indexOf(candidate);
		if (index < 0) continue;
		const distance = Math.abs(index - want);
		if (distance < bestDistance || (distance === bestDistance && index > LEVELS.indexOf(best))) {
			best = candidate;
			bestDistance = distance;
		}
	}
	return best ?? level;
}

/**
 * Explain the effort decision for one subagent request. Pure.
 * rule: no-setting | fill-kept | no-reasoning | forced | applied | clamped
 */
export function resolveMainEffort(defaults, request, supported) {
	if (str(request?.reasoningEffort)) return request.reasoningEffort;
	const wanted = str(defaults?.reasoningEffort) ?? "high";
	if (Array.isArray(supported)) return supported.length > 0 ? clampLevel(wanted, supported) : undefined;
	return wanted;
}

export function explainEffort(settings, request, supported) {
	const key = `${request.provider}/${request.model}`;
	const perModel = isRecord(settings?.subagentModelEfforts) ? str(settings.subagentModelEfforts[key]) : undefined;
	const unified = str(settings?.subagentEffort);
	const wanted = perModel ?? unified;
	const mode = settings?.subagentMode === "fill" ? "fill" : "force";
	const clamp = settings?.clampToModel !== false;
	const before = request.reasoningEffort;
	const base = {
		key,
		source: perModel ? "per-model" : unified ? "unified" : "none",
		wanted: wanted ?? null,
		mode,
		clamp,
		before: before ?? null,
		supported: Array.isArray(supported) ? supported : null
	};
	const keep = (rule) => ({ ...base, after: before ?? null, changed: false, rule });
	const set = (after, rule) => ({ ...base, after, changed: after !== before, rule });
	if (wanted === undefined) return keep("no-setting");
	if (mode === "fill" && before !== undefined) return keep("fill-kept");
	if (!clamp) return set(wanted, "forced");
	if (Array.isArray(supported) && supported.length === 0) return keep("no-reasoning");
	const after = clampLevel(wanted, supported);
	return set(after, after === wanted ? "applied" : "clamped");
}

/** Decide the effort for one subagent request from settings only. Pure, kept for tests. */
export function resolveEffort(settings, llmValue, request) {
	const d = explainEffort(settings, request, supportedLevels(llmValue, request.provider, request.model));
	return d.rule === "no-setting" || d.rule === "fill-kept" || d.rule === "no-reasoning" ? undefined : d.after;
}

/** Explain where a simulated subagent request would end up. Pure. */
export function simulateDispatch(input) {
	const { own, selection, teEffort, parent, child, supported, route } = input;
	const warnings = [];
	const selectionEnabled = selection?.enabled === true;
	const allowedList = Array.isArray(selection?.allowedModels) ? selection.allowedModels : [];
	const wantsOther = child && (child.provider !== parent.provider || child.model !== parent.model);
	let base;
	let childSource;
	if (wantsOther && selectionEnabled) {
		base = { provider: child.provider, model: child.model, reasoningEffort: str(child.reasoningEffort) };
		childSource = "selected";
		const allowed = allowedList.some((x) => x?.provider === child.provider && x?.model === child.model);
		if (!allowed) warnings.push(`${child.provider}/${child.model} 不在“子代理可选模型”列表中，实际派遣会被拒绝或回退到主代理模型。`);
	} else {
		if (wantsOther) warnings.push("未开启“允许子代理选择模型”，子代理会沿用主代理的模型。");
		base = { provider: parent.provider, model: parent.model, reasoningEffort: str(child?.reasoningEffort) ?? str(parent.reasoningEffort) };
		childSource = "inherit";
	}
	// Redirect / failover happens before the effort override, exactly like the live hook.
	let routed;
	if (route && route.kind) {
		// `supported` already describes the routed target.
		const effort = mapEffort(base.reasoningEffort, route.toEffort, supported?.levels);
		routed = { kind: route.kind, from: { provider: base.provider, model: base.model }, to: { provider: route.to.provider, model: route.to.model }, effort: effort ?? null };
		warnings.push(route.kind === "redirect"
			? `命中重定向规则：${base.provider}/${base.model} → ${route.to.provider}/${route.to.model}。`
			: `${base.provider} 已被标记为不可用，自动切换到备用模型 ${route.to.provider}/${route.to.model}。`);
		base = { provider: route.to.provider, model: route.to.model, reasoningEffort: effort };
	} else if (route?.exhausted) {
		warnings.push(`${base.provider} 已被标记为不可用，但备用链中没有可用模型，请求仍会发往原服务商并失败。`);
	}
	const decision = explainEffort(own, base, supported?.levels);
	const final = { provider: base.provider, model: base.model, reasoningEffort: decision.after ?? undefined };
	if (supported?.source === "unknown") warnings.push("无法读取该模型支持的推理档位，将按原值发送，不做兼容处理。");
	if (decision.rule === "no-reasoning") warnings.push("该模型不支持推理档位，不会写入 reasoningEffort。");
	if (decision.rule === "forced" && Array.isArray(supported?.levels) && final.reasoningEffort && !supported.levels.includes(final.reasoningEffort)) {
		warnings.push(`已关闭兼容处理，${final.reasoningEffort} 不在模型支持列表（${supported.levels.join(" / ") || "无"}）中，请求可能被服务商拒绝。`);
	}
	if (teEffort) {
		warnings.push(decision.mode === "fill"
			? `thinking-effort 插件也设置了子代理推理程度（${teEffort}），“仅填充”模式下它可能先写入，导致本插件不再改动。`
			: `thinking-effort 插件也设置了子代理推理程度（${teEffort}）；强制模式下以本插件为准。`);
	}
	return { parent, base, childSource, routed: routed ?? null, supported: supported ?? { levels: undefined, source: "unknown" }, decision, final, warnings };
}

// ---------------------------------------------------------------- routing (pure)
const scopeOf = (v) => (SCOPES.includes(v) ? v : "all");
const scopeHits = (scope, subagent) => scope === "all" || (scope === "subagent") === subagent;

/** Normalize the stored redirect / failover settings into a validated shape. */
export function normalizeRouting(own) {
	const redirects = (Array.isArray(own?.redirects) ? own.redirects : [])
		.filter((r) => isRecord(r) && r.enabled !== false && str(r.fromProvider) && str(r.toProvider) && str(r.toModel))
		.map((r) => ({ fromProvider: r.fromProvider, fromModel: str(r.fromModel), toProvider: r.toProvider, toModel: r.toModel, toEffort: str(r.toEffort), scope: scopeOf(r.scope) }));
	const f = isRecord(own?.failover) ? own.failover : {};
	const cooldown = typeof f.cooldownMinutes === "number" && Number.isFinite(f.cooldownMinutes) ? Math.min(LIMITS.maxCooldownMinutes, Math.max(0, f.cooldownMinutes)) : 30;
	const codes = Array.isArray(f.codes) ? f.codes.filter(str) : [...FAILOVER_CODES];
	const chain = (Array.isArray(f.chain) ? f.chain : [])
		.filter((c) => isRecord(c) && str(c.provider) && str(c.model))
		.map((c) => ({ provider: c.provider, model: c.model, reasoningEffort: str(c.reasoningEffort) }));
	return { redirects, failover: { enabled: f.enabled !== false, scope: scopeOf(f.scope), cooldownMs: cooldown * 60000, codes, chain } };
}

/**
 * Where one request should go. Pure.
 * Redirect rules apply once (first match); then, when the resulting provider is
 * down, the failover chain picks the first entry on a provider that is not down.
 * @returns {{kind: null|"redirect"|"failover", to, toEffort?, rule?, exhausted?}}
 */
export function pickRoute(routing, request, { subagent, isDown }) {
	let to = { provider: request.provider, model: request.model };
	let kind = null;
	let toEffort;
	let rule;
	const r = routing.redirects.find((x) => scopeHits(x.scope, subagent) && x.fromProvider === to.provider && (!x.fromModel || x.fromModel === to.model));
	if (r && !(r.toProvider === to.provider && r.toModel === to.model)) {
		to = { provider: r.toProvider, model: r.toModel };
		toEffort = r.toEffort;
		kind = "redirect";
		rule = r;
	}
	const f = routing.failover;
	if (f.enabled && scopeHits(f.scope, subagent) && isDown(to.provider)) {
		const alt = f.chain.find((c) => c.provider !== to.provider && !isDown(c.provider));
		if (!alt) return { kind, to, toEffort, rule, exhausted: true };
		return { kind: "failover", to: { provider: alt.provider, model: alt.model }, toEffort: alt.reasoningEffort, rule, via: kind === "redirect" ? to : undefined };
	}
	return { kind, to, toEffort, rule };
}

/**
 * Effort to send after switching models: an explicit target effort wins;
 * otherwise the original is mapped onto the target's supported levels, and
 * dropped when the target support is unknown or has no reasoning.
 */
export function mapEffort(original, explicit, supported) {
	if (explicit) return explicit;
	if (!original) return undefined;
	if (!Array.isArray(supported) || supported.length === 0) return undefined;
	return clampLevel(original, supported);
}

/** Whether a request failure should mark its provider down. */
export function isFailoverFailure(failure, codes) {
	if (!isRecord(failure)) return false;
	if (typeof failure.code === "string" && codes.includes(failure.code)) return true;
	return failure.status === 402;
}

const isSubagent = (payload) => payload?.agent?.session?.header?.origin === "subagent";

/** Run `fn` over `items` with at most `limit` in flight; preserves order. */
export async function runPool(items, limit, fn) {
	const out = new Array(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
		while (next < items.length) {
			const index = next++;
			out[index] = await fn(items[index], index);
		}
	});
	await Promise.all(workers);
	return out;
}

class HttpError extends Error {
	constructor(status, code, message) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

const json = (value, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
const clip = (s, n) => (typeof s === "string" && s.length > n ? `${s.slice(0, n)}…` : s);

async function readJson(request) {
	const text = await request.text();
	if (text.length > LIMITS.bodyChars) throw new HttpError(413, "BODY_TOO_LARGE", "请求体过大");
	if (text.trim() === "") return {};
	let value;
	try {
		value = JSON.parse(text);
	} catch {
		throw new HttpError(400, "BAD_JSON", "请求体必须是 JSON");
	}
	if (!isRecord(value)) throw new HttpError(400, "BAD_JSON", "请求体必须是 JSON 对象");
	return value;
}

function parseRef(value, what) {
	if (!isRecord(value)) throw new HttpError(400, "BAD_REQUEST", `${what} 必须是对象`);
	const ok = (s) => typeof s === "string" && s.length > 0 && s.length <= 200;
	if (!ok(value.provider) || !ok(value.model)) throw new HttpError(400, "BAD_REQUEST", `${what} 需要 provider 与 model`);
	const out = { provider: value.provider, model: value.model };
	if (value.reasoningEffort !== undefined && value.reasoningEffort !== null && value.reasoningEffort !== "") {
		if (typeof value.reasoningEffort !== "string" || value.reasoningEffort.length > 40) throw new HttpError(400, "BAD_REQUEST", `${what}.reasoningEffort 无效`);
		out.reasoningEffort = value.reasoningEffort;
	}
	return out;
}

const intIn = (v, lo, hi, fallback) => {
	const n = typeof v === "number" ? Math.trunc(v) : Number.parseInt(String(v ?? ""), 10);
	return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

function summarizeInfo(info) {
	if (!isRecord(info)) return undefined;
	return {
		name: info.name,
		context: info.context,
		defaultMaxTokens: info.defaultMaxTokens,
		inputModalities: info.inputModalities,
		efforts: Array.isArray(info.reasoning?.efforts) ? info.reasoning.efforts.map((e) => e?.id) : [],
		defaultEffort: info.reasoning?.defaultEffort
	};
}

const failureOf = (error, fallbackCode) => ({
	code: str(error?.code) ?? fallbackCode,
	message: clip(String(error?.message ?? error), 600),
	...(typeof error?.status === "number" ? { status: error.status } : {})
});

/** One real streaming call; never throws. */
export async function probeOne(llm, target, opts, outer, meter) {
	// Usage accounting attributes calls inside this scope to "probe".
	if (probeScope.getStore() !== true) return probeScope.run(true, () => probeOne(llm, target, opts, outer, meter));
	const timeout = AbortSignal.timeout(opts.timeoutMs);
	const signal = AbortSignal.any([outer, timeout]);
	const startedAt = Date.now();
	const t0 = performance.now();
	let firstToken;
	let firstText;
	let text = "";
	let textChars = 0;
	let reasoningChars = 0;
	let toolCalls = 0;
	let usage;
	let finish;
	meter?.enter();
	try {
		const options = {
			provider: target.provider,
			model: target.model,
			messages: [{ role: "user", content: [{ type: "text", text: opts.prompt }] }],
			signal
		};
		if (target.reasoningEffort) options.reasoningEffort = target.reasoningEffort;
		if (opts.maxTokens) options.maxTokens = opts.maxTokens;
		for await (const chunk of llm.stream(options)) {
			const now = performance.now();
			switch (chunk?.type) {
				case "text-delta":
					firstToken ??= now;
					firstText ??= now;
					textChars += chunk.text?.length ?? 0;
					if (text.length < LIMITS.textChars) text += chunk.text ?? "";
					break;
				case "reasoning-delta":
					firstToken ??= now;
					reasoningChars += chunk.text?.length ?? 0;
					break;
				case "tool-call-delta":
					firstToken ??= now;
					break;
				case "block-end":
					if (chunk.block?.type === "text" && textChars === 0 && typeof chunk.block.text === "string") {
						firstToken ??= now;
						firstText ??= now;
						textChars = chunk.block.text.length;
						text = chunk.block.text;
					} else if (chunk.block?.type === "tool-call") toolCalls++;
					break;
				case "usage":
					usage = chunk.usage;
					break;
				case "finish":
					finish = chunk.reason;
					break;
				default:
					break;
			}
		}
	} catch (error) {
		finish = { kind: signal.aborted ? "aborted" : "error", failure: failureOf(error, "EXCEPTION") };
	} finally {
		meter?.leave();
	}
	const end = performance.now();
	finish ??= { kind: "stop" };
	let error;
	if (finish.kind === "error" || finish.kind === "aborted") {
		error = timeout.aborted && !outer.aborted
			? { code: "TIMEOUT", message: `超过 ${opts.timeoutMs} ms 未完成` }
			: { ...failureOf(finish.failure ?? {}, finish.kind === "aborted" ? "ABORTED" : "ERROR"), ...(finish.failure?.requestId ? { requestId: finish.failure.requestId } : {}) };
	}
	const ok = !error;
	const genMs = firstToken !== undefined ? end - firstToken : undefined;
	const outTokens = typeof usage?.outputTokens === "number" ? usage.outputTokens : undefined;
	return {
		provider: target.provider,
		model: target.model,
		reasoningEffort: target.reasoningEffort ?? null,
		ok,
		empty: ok && textChars === 0 && reasoningChars === 0 && toolCalls === 0,
		finish: finish.kind,
		startedAt,
		firstTokenMs: firstToken !== undefined ? Math.round(firstToken - t0) : null,
		firstTextMs: firstText !== undefined ? Math.round(firstText - t0) : null,
		totalMs: Math.round(end - t0),
		tokensPerSec: outTokens && genMs && genMs > 50 ? Math.round((outTokens / genMs) * 10000) / 10 : null,
		text: clip(text, LIMITS.textChars),
		textChars,
		reasoningChars,
		usage: usage ?? null,
		error: error ?? null
	};
}

export function apply(ctx, config) {
	const entryId = ctx.fiber?.entry?.options?.id ?? DEFAULT_ENTRY_ID;
	const reader = createSettingsReader(ctx, entryId);
	const credentials = ctx.get("credentials");
	const keyRef = (provider, id) => `MODEL_MANAGER_${String(provider).toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_${String(id).toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
	// Multi-Key credential routing is retired: each provider uses its own single
	// apiKeyEnv credential again. Alias bindings are still read, but only to learn
	// which upstream model ID an alias must be rewritten to.
	const aliasFor = (provider, model) => {
		const keys = reader.own(config ?? {})?.providerKeys?.[provider]?.keys;
		const upstreamModel = aliasUpstream(Array.isArray(keys) ? keys : [], model);
		return upstreamModel && upstreamModel !== model ? { upstreamModel } : null;
	};
	const originalFetch = globalThis.fetch;
	const originalDispatcher = getGlobalDispatcher();
	const proxyAgents = new Map();
	const agentFor = (url) => {
		let agent = proxyAgents.get(url);
		if (!agent) {
			agent = new ProxyAgent(url);
			proxyAgents.set(url, agent);
		}
		return agent;
	};
	const scopedDispatcher = {
		dispatch(options, handler) {
			const proxy = providerProxyScope.getStore();
			return (proxy ? agentFor(proxy.url) : originalDispatcher).dispatch(options, handler);
		},
		close(...args) { return originalDispatcher.close(...args); },
		destroy(...args) { return originalDispatcher.destroy(...args); }
	};
	setGlobalDispatcher(scopedDispatcher);
	const scopedFetch = async function(input, init) {
		const proxy = providerProxyScope.getStore();
		const key = keyScope.getStore();
		const [nextInput, nextInit] = await aliasFetchArgs(input, init, key);
		if (!proxy) return originalFetch.call(this, nextInput, nextInit);
		return originalFetch.call(this, nextInput, { ...nextInit, dispatcher: agentFor(proxy.url) });
	};
	globalThis.fetch = scopedFetch;
	ctx.effect(() => () => {
		if (globalThis.fetch === scopedFetch) globalThis.fetch = originalFetch;
		if (getGlobalDispatcher() === scopedDispatcher) setGlobalDispatcher(originalDispatcher);
		for (const agent of proxyAgents.values()) void agent.close();
		proxyAgents.clear();
	}, "model-manager: provider proxy fetch and dispatcher");

	const proxyFor = (provider) => {
		const cfg = reader.own(config ?? {})?.providerProxy?.[provider];
		if (!cfg?.enabled) return null;
		const url = normalizeProxyUrl(cfg.url);
		if (!url) throw new Error(`服务商 ${provider} 已启用本地代理，但未设置代理地址；请先自动检测或手动填写`);
		return { provider, url };
	};
	const detectLocalProxy = async () => {
		const candidates = [];
		for (const key of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"]) {
			const raw = process.env[key];
			if (!raw) continue;
			try {
				const url = new URL(normalizeProxyUrl(raw));
				candidates.push({ url: url.toString().replace(/\/$/, ""), host: url.hostname, port: Number(url.port), source: key });
			} catch {}
		}
		for (const port of [7890, 7897, 7891, 7892, 10809, 10808, 1080, 8080, 8888, 20170]) candidates.push({ url: `http://127.0.0.1:${port}`, host: "127.0.0.1", port, source: "local" });
		const seen = new Set();
		for (const candidate of candidates) {
			const key = `${candidate.host}:${candidate.port}`;
			if (!candidate.port || seen.has(key)) continue;
			seen.add(key);
			if (await probeTcp(candidate.host, candidate.port)) return { url: candidate.url, source: candidate.source };
		}
		return null;
	};

	// ---------------------------------------------------------- model metadata
	const infoCache = new Map();
	const invalidateAll = () => {
		reader.invalidate();
		infoCache.clear();
	};
	ctx.on("settings/document-updated", invalidateAll);
	ctx.on("settings/updated", invalidateAll);
	ctx.on("llm/adapters-updated", () => infoCache.clear());

	/** Supported standard levels, preferring adapter metadata over settings. */
	async function supportedFor(provider, model) {
		const llm = ctx.get("llm");
		if (llm && typeof llm.resolveModelInfo === "function") {
			const key = `${provider}\u0000${model}`;
			let entry = infoCache.get(key);
			if (!entry || Date.now() - entry.at > LIMITS.infoTtlMs) {
				const promise = Promise.resolve()
					.then(() => llm.resolveModelInfo(provider, model, AbortSignal.timeout(LIMITS.infoTimeoutMs)))
					.then((info) => ({ info: summarizeInfo(info), levels: levelsFromInfo(info) }), () => undefined);
				entry = { at: Date.now(), promise };
				infoCache.set(key, entry);
			}
			const resolved = await entry.promise;
			if (resolved) {
				if (resolved.levels !== undefined) return { levels: resolved.levels, source: "model", info: resolved.info };
				const fromSettings = supportedLevels(reader.llm(), provider, model);
				return { levels: fromSettings, source: fromSettings ? "settings" : "unknown", info: resolved.info };
			}
			infoCache.delete(key);
		}
		const fromSettings = supportedLevels(reader.llm(), provider, model);
		return { levels: fromSettings, source: fromSettings ? "settings" : "unknown" };
	}

	// ---------------------------------------------------------- dispatch log
	const log = [];
	let seq = 0;
	const record = (entry) => {
		log.push({ seq: ++seq, at: Date.now(), ...entry });
		if (log.length > LIMITS.logSize) log.splice(0, log.length - LIMITS.logSize);
	};

	// ---------------------------------------------------------- provider health (in memory)
	/** provider → { code, message, status?, since, until (0 = manual), manual, hits } */
	const health = new Map();
	const events = [];
	let eventSeq = 0;
	const event = (entry) => {
		events.push({ seq: ++eventSeq, at: Date.now(), ...entry });
		if (events.length > LIMITS.eventSize) events.splice(0, events.length - LIMITS.eventSize);
	};
	/** Collapse repeated route events of one session onto one row. */
	const routeEvent = (entry) => {
		const last = [...events].reverse().find((e) => e.type === "route" && e.sessionId === entry.sessionId);
		if (last && last.kind === entry.kind && last.from === entry.from && last.to === entry.to) {
			last.count = (last.count ?? 1) + 1;
			last.lastAt = Date.now();
			return;
		}
		event({ type: "route", count: 1, ...entry });
	};
	const isDown = (provider) => {
		const h = health.get(provider);
		if (!h) return false;
		if (h.until > 0 && Date.now() >= h.until) {
			health.delete(provider);
			event({ type: "recovered", provider, reason: "cooldown" });
			return false;
		}
		return true;
	};
	const markDown = (provider, failure, { manual = false, cooldownMs } = {}) => {
		const prev = health.get(provider);
		const now = Date.now();
		const until = manual || !cooldownMs ? 0 : now + cooldownMs;
		health.set(provider, {
			code: failure?.code ?? (manual ? "MANUAL" : "ERROR"),
			message: clip(String(failure?.message ?? (manual ? "手动标记为不可用" : "")), 300),
			...(typeof failure?.status === "number" ? { status: failure.status } : {}),
			since: prev?.since ?? now,
			until,
			manual,
			hits: (prev?.hits ?? 0) + 1
		});
		if (!prev) event({ type: "down", provider, code: failure?.code ?? (manual ? "MANUAL" : "ERROR"), message: clip(String(failure?.message ?? ""), 300), manual });
	};
	const recover = (provider, reason) => {
		if (!health.delete(provider)) return false;
		event({ type: "recovered", provider, reason });
		return true;
	};
	const routing = () => normalizeRouting(reader.own(config ?? {}));
	// ---------------------------------------------------------- usage accounting
	// Appended (not prepended) so this tap sits inside DSH's own stream
	// validator and observes exactly what the adapter produced.
	const usage = createUsageStore();
	// Memoized on the raw settings value: every model call needs the tier bounds.
	let priceCache = { raw: undefined, table: {}, bounds: [] };
	const priceState = () => {
		const raw = reader.own(config ?? {})?.usagePrices;
		if (raw !== priceCache.raw) {
			const table = normalizePrices(raw);
			priceCache = { raw, table, bounds: priceBounds(table) };
		}
		return priceCache;
	};
	const prices = () => priceState().table;
	const persistence = { state: "memory", error: () => null };
	ctx.on("llm/stream", (options, next) => {
		let kind = "other";
		let sessionId = null;
		try {
			if (probeScope.getStore() === true) kind = "probe";
			else {
				const agent = ctx.get("agents")?.currentInitiator?.();
				if (agent) {
					const meta = sessionMeta(agent);
					sessionId = meta.sessionId;
					kind = meta.subagent ? "subagent" : "main";
				}
			}
		} catch {
			// attribution is best effort
		}
		const provider = typeof options?.provider === "string" ? options.provider : "(unknown)";
		const model = typeof options?.model === "string" ? options.model : "(unknown)";
		const reasoningEffort = typeof options?.reasoningEffort === "string" ? options.reasoningEffort : null;
		const profile = reader.llm()?.providers?.[provider] ?? {};
		const alias = aliasFor(provider, model);
		if (alias) {
			if (!profile.baseURL || !["openai-completions", "openai-responses", "anthropic-messages"].includes(profile.api)) throw new Error("模型别名需要配置 Base URL 和受支持的 HTTP 接口协议");
			if (profile.transport && profile.transport !== "sse") throw new Error("模型别名目前仅支持 SSE；请将该服务商 transport 设置为 sse");
		}
		const keyContext = { provider, model, upstreamModel: alias?.upstreamModel, baseURL: profile.baseURL };
		const proxy = proxyFor(provider);
		const source = providerProxyScope.run(proxy, () => keyScope.run(keyContext, next));
		const wrapped = proxy ? withProviderProxy(source, proxy, keyContext) : alias ? withKeyContext(source, keyContext) : source;
		return tapUsage(wrapped, (r) => {
			usage.record({ ...r, kind, sessionId, provider, model, reasoningEffort, bounds: priceState().bounds });
		});
	}, { global: true });

	ctx.plugin({
		name: "dsh-model-manager/usage-store",
		inject: ["storageDomain"],
		apply(sub) {
			let domain;
			let closed = false;
			let error = null;
			const flush = () => {
				if (!domain || !usage.isDirty()) return;
				try {
					domain.global.set(usage.takeSnapshot());
					error = null;
				} catch (e) {
					usage.markDirty();
					error = String(e?.message ?? e);
					console.warn("[model-manager] usage flush failed:", e);
				}
			};
			const opening = (async () => {
				try {
					const d = await sub.storageDomain.open(USAGE_DOMAIN);
					if (closed) {
						await d.close?.();
						return;
					}
					domain = d;
					usage.load(d.global.get());
					persistence.state = "persistent";
				} catch (e) {
					error = String(e?.message ?? e);
					persistence.state = "memory";
					console.warn("[model-manager] usage storage unavailable, keeping usage in memory:", e);
				}
			})();
			const timer = setInterval(flush, USAGE_LIMITS.flushMs);
			timer.unref?.();
			persistence.error = () => error;
			sub.effect(() => async () => {
				closed = true;
				clearInterval(timer);
				await opening;
				flush();
				const d = domain;
				domain = undefined;
				persistence.state = "memory";
				try {
					await d?.close?.();
				} catch {
					// already closed
				}
			}, "model-manager: usage storage");
		}
	});

	const sessionMeta = (agent) => {
		const header = agent?.session?.header ?? {};
		return { sessionId: header.id ?? null, parentSessionId: header.parentSession ?? null, depth: header.delegationDepth ?? null, subagent: header.origin === "subagent" };
	};

	// ---------------------------------------------------------- per-session tracking / overrides (in memory)
	// DSH hides the composer model seat for subagent Sessions and the Host
	// rejects session.selectModel for them; a per-session override applied in
	// agent/request is the only way to switch a running subagent's model.
	/** sessionId → { sessionId, parentSessionId, depth, subagent, provider, model, reasoningEffort, original, lastAt, requests } */
	const sessions = new Map();
	/** sessionId → { provider, model, reasoningEffort?, at } */
	const overrides = new Map();
	const track = (meta, original, final) => {
		if (!meta.sessionId) return;
		const prev = sessions.get(meta.sessionId);
		sessions.delete(meta.sessionId); // re-insert → most recent last
		sessions.set(meta.sessionId, {
			sessionId: meta.sessionId,
			parentSessionId: meta.parentSessionId,
			depth: meta.depth,
			subagent: meta.subagent,
			provider: final.provider,
			model: final.model,
			reasoningEffort: final.reasoningEffort ?? null,
			original: { provider: original.provider, model: original.model, reasoningEffort: original.reasoningEffort ?? null },
			lastAt: Date.now(),
			requests: (prev?.requests ?? 0) + 1
		});
		while (sessions.size > LIMITS.sessionsTracked) sessions.delete(sessions.keys().next().value);
	};

	// ---------------------------------------------------------- request rewrite
	// prepend: stay the outermost listener even after a hot reload, so the
	// redirect wins over Session-local model selection installed per Agent.
	ctx.on(
		"agent/request",
		async (payload, next) => {
			const meta = sessionMeta(payload?.agent);
			const original = await next();
			const result = await rewrite(meta, original);
			if (isRecord(result) && typeof result.provider === "string" && typeof result.model === "string" && isRecord(original)) track(meta, original, result);
			return result;
		},
		{ global: true, prepend: true }
	);

	async function rewrite(meta, input) {
			let request = input;
			if (!isRecord(request) || typeof request.provider !== "string" || typeof request.model !== "string") return request;
			// 0. per-session manual override (set from the subagent composer / sessions panel).
			const ov = meta.sessionId ? overrides.get(meta.sessionId) : undefined;
			let overriddenFrom;
			if (ov) {
				overriddenFrom = `${request.provider}/${request.model}`;
				const { reasoningEffort: prevEffort, ...rest } = request;
				let effort = ov.reasoningEffort;
				if (!effort && prevEffort) {
					const supported = await supportedFor(ov.provider, ov.model);
					effort = mapEffort(prevEffort, "", supported.levels);
				}
				request = { ...rest, provider: ov.provider, model: ov.model, ...(effort ? { reasoningEffort: effort } : {}) };
			}
			// 1. redirect / failover — applies to every Session in scope, including running subagents.
			// A manual override skips redirect rules but still fails over when its provider is down.
			let routedFrom;
			try {
				const base = routing();
				const route = pickRoute(ov ? { ...base, redirects: [] } : base, request, { subagent: meta.subagent, isDown });
				if (route.kind) {
					const supported = await supportedFor(route.to.provider, route.to.model);
					const effort = mapEffort(request.reasoningEffort, route.toEffort, supported.levels);
					routedFrom = { provider: request.provider, model: request.model, reasoningEffort: request.reasoningEffort ?? null };
					const { reasoningEffort: _drop, ...rest } = request;
					request = { ...rest, provider: route.to.provider, model: route.to.model, ...(effort ? { reasoningEffort: effort } : {}) };
					routeEvent({ kind: route.kind, sessionId: meta.sessionId, subagent: meta.subagent, from: `${routedFrom.provider}/${routedFrom.model}`, to: `${request.provider}/${request.model}`, effort: effort ?? null });
				} else if (route.exhausted) {
					routeEvent({ kind: "exhausted", sessionId: meta.sessionId, subagent: meta.subagent, from: `${request.provider}/${request.model}`, to: null });
				}
			} catch (error) {
				console.warn("[model-manager] routing failed:", error);
			}
			if (!meta.subagent) {
				try {
					const supported = await supportedFor(request.provider, request.model);
					const effort = resolveMainEffort(reader.ns(DEFAULT_NS), request, supported.levels);
					return effort ? { ...request, reasoningEffort: effort } : request;
				} catch (error) {
					console.warn("[model-manager] main-agent default effort failed:", error);
					return request;
				}
			}
			// 2. subagent reasoning effort
			const fromKey = overriddenFrom ?? (routedFrom ? `${routedFrom.provider}/${routedFrom.model}` : undefined);
			const logMeta = { sessionId: meta.sessionId, parentSessionId: meta.parentSessionId, depth: meta.depth, provider: request.provider, model: request.model, ...(fromKey ? { routedFrom: fromKey } : {}), ...(ov ? { overridden: true } : {}) };
			// An explicit per-session effort wins over the global subagent effort rules.
			if (ov?.reasoningEffort && !routedFrom) {
				record({ ...logMeta, before: request.reasoningEffort ?? null, after: request.reasoningEffort ?? null, rule: "session-override", changed: false, supportedSource: "override" });
				return request;
			}
			try {
				const supported = await supportedFor(request.provider, request.model);
				const d = explainEffort(reader.own(config ?? {}), request, supported.levels);
				record({ ...logMeta, before: d.before, after: d.after, rule: d.rule, changed: d.changed, supportedSource: supported.source });
				return d.changed ? { ...request, reasoningEffort: d.after } : request;
			} catch (error) {
				record({ ...logMeta, before: request.reasoningEffort ?? null, after: request.reasoningEffort ?? null, rule: "error", changed: false, error: String(error?.message ?? error) });
				console.warn("[model-manager] agent/request override failed:", error);
				return request;
			}
	}

	// ---------------------------------------------------------- automatic failover
	// On a quota/auth-class failure: mark the provider down and ask the loop to
	// retry; the retry re-runs agent/request, where the chain picks a fallback.
	const switches = new WeakMap(); // session → { key, count }
	ctx.on(
		"agent/request-error",
		async (payload, next) => {
			try {
				const r = routing();
				const meta = sessionMeta(payload?.agent);
				const failure = payload?.failure;
				const provider = typeof payload?.provider === "string" ? payload.provider : undefined;
				if (!provider || !r.failover.enabled || !scopeHits(r.failover.scope, meta.subagent) || !isFailoverFailure(failure, r.failover.codes)) return next();
				markDown(provider, failure, { cooldownMs: r.failover.cooldownMs });
				const alt = r.failover.chain.find((c) => c.provider !== provider && !isDown(c.provider));
				if (!alt || payload.signal?.aborted) return next();
				const session = payload.agent?.session;
				if (session) {
					const key = `${payload.turn}:${payload.step}`;
					const s = switches.get(session);
					const count = s?.key === key ? s.count + 1 : 1;
					if (count > LIMITS.switchesPerTurn) return next();
					switches.set(session, { key, count });
				}
				event({ type: "failover", provider, code: failure?.code ?? null, sessionId: meta.sessionId, subagent: meta.subagent, to: `${alt.provider}/${alt.model}` });
				return { kind: "retry" };
			} catch (error) {
				console.warn("[model-manager] failover failed:", error);
				return next();
			}
		},
		{ global: true, prepend: true }
	);

	// ---------------------------------------------------------- diagnostics routes
	ctx.plugin({
		name: "dsh-model-manager/diagnostics",
		inject: ["llm", "connection", "credentials"],
		apply(sub) {
			const lifetime = new AbortController();
			sub.effect(() => () => lifetime.abort(), "model-manager: diagnostics lifetime");

			const route = (path, methods, handler) => sub.effect(() => sub.connection.fetch.register({
				path,
				methods,
				requestBody: "buffered",
				fetch: async (request) => {
					try {
						return await handler(request, AbortSignal.any([request.signal, lifetime.signal]));
					} catch (error) {
						if (error instanceof HttpError) return json({ error: { code: error.code, message: error.message } }, error.status);
						console.warn("[model-manager] route failed:", path, error);
						return json({ error: failureOf(error, "INTERNAL") }, 500);
					}
				}
			}), `model-manager: ${path}`);

			route(ROUTES.proxy, ["GET", "POST"], async () => json({ detected: await detectLocalProxy() }));

			const directModels = async (provider, profile, apiKey, signal) => {
				const raw = typeof profile?.baseURL === "string" ? profile.baseURL.trim() : "";
				if (!raw) return [];
				let base;
				try { base = new URL(raw); } catch { return []; }
				if (!/^https?:$/.test(base.protocol)) return [];
				const url = new URL(base.toString().replace(/\/$/, "") + "/models");
				const headers = { accept: "application/json" };
				if (apiKey) {
					headers.authorization = `Bearer ${apiKey}`;
					headers["x-api-key"] = apiKey;
				}
				if (profile.api === "anthropic-messages") headers["anthropic-version"] = "2023-06-01";
				const response = await fetch(url, { method: "GET", headers, signal });
				if (!response.ok) throw new Error(`模型列表请求失败：HTTP ${response.status}`);
				const body = await response.json();
				const list = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
				return list.map((x) => ({
					id: typeof x === "string" ? x : x?.id ?? x?.name ?? x?.model,
					name: typeof x === "object" ? x.name ?? x.displayName ?? x.id : x
				})).filter((x) => typeof x.id === "string" && x.id.length > 0);
			};
			const discoverWithFallback = async (settingsNs, requestBody, provider, profile, apiKey, signal) => {
				const proxy = proxyFor(provider);
				return providerProxyScope.run(proxy, async () => {
					try {
						const found = await sub.llm.discoverModels(settingsNs, requestBody, signal);
						if (Array.isArray(found) && found.length > 0) return found;
					} catch {}
					return directModels(provider, profile, apiKey, signal);
				});
			};

			const modelInfo = async (provider, item, signal) => {
				const id = typeof item?.id === "string" ? item.id : "";
				if (!id) return null;
				try {
					const resolved = await sub.llm.resolveModelInfo(provider, id, signal);
					return {
						id,
						name: resolved.name ?? item.name ?? id,
						description: resolved.description ?? item.description,
						inputModalities: resolved.inputModalities ?? item.inputModalities,
						contextWindow: resolved.context?.contextWindow ?? item.contextWindow,
						maxTokens: resolved.defaultMaxTokens ?? item.maxTokens,
						reasoning: resolved.reasoning
					};
				} catch {
					return { ...item, id, name: item.name ?? id };
				}
			};
			const normalizeModels = (provider, list, signal) => Promise.all((Array.isArray(list) ? list : []).map((item) => modelInfo(provider, item, signal))).then((xs) => xs.filter(Boolean));

			// GET ?provider=id reads the active adapter's model metadata. POST accepts a
			// draft endpoint and resolves its saved credential without exposing it to the client.
			route(ROUTES.models, ["GET", "POST"], async (request, signal) => {
				if (request.method === "GET") {
					const provider = new URL(request.url, "http://local").searchParams.get("provider");
					if (!provider || provider.length > 200) throw new HttpError(400, "BAD_REQUEST", "缺少有效 provider");
					const profile = isRecord(reader.llm()?.providers?.[provider]) ? reader.llm().providers[provider] : {};
					const ref = str(profile.apiKeyEnv) ?? `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
					let apiKey;
					try { apiKey = (await sub.credentials.resolve(ref))?.value; } catch {}
					const list = await discoverWithFallback(provider, { provider }, provider, profile, apiKey, signal);
					return json({ provider, source: "adapter-or-direct", models: await normalizeModels(provider, list, signal) });
				}
				const body = await readJson(request);
				const provider = typeof body.provider === "string" ? body.provider.trim() : "";
				if (!provider || provider.length > 200) throw new HttpError(400, "BAD_REQUEST", "缺少有效 provider");
				const profile = isRecord(reader.llm()?.providers?.[provider]) ? reader.llm().providers[provider] : {};
				const keyId = typeof body.keyId === "string" && body.keyId.trim() ? body.keyId.trim() : undefined;
				const keys = reader.own(config ?? {})?.providerKeys?.[provider]?.keys ?? [];
				const keyEntry = keyId ? keys.find((x) => x.id === keyId) : undefined;
				if (keyId && !keyEntry) throw new HttpError(404, "KEY_NOT_FOUND", "该服务商下没有此 Key");
				const ref = keyEntry ? str(keyEntry.credentialRef) ?? keyRef(provider, keyId) : str(profile.apiKeyEnv) ?? `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
				let apiKey = !keyId && typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : undefined;
				if (!apiKey) {
					try { apiKey = (await sub.credentials.resolve(ref))?.value; } catch {}
				}
				if (keyId && !apiKey) throw new HttpError(400, "MISSING_CREDENTIAL", "请先为此 Key 保存密钥");
				const entries = typeof sub.llm.listConfigurableProviders === "function" ? sub.llm.listConfigurableProviders() : [];
				const entry = (Array.isArray(entries) ? entries : []).find((x) => x.provider === provider);
				const settingsNs = typeof body.settingsNs === "string" && body.settingsNs ? body.settingsNs : entry?.settingsNs ?? LLM_NS;
				const requestBody = {
					provider,
					baseURL: typeof body.baseURL === "string" && body.baseURL.trim() ? body.baseURL.trim() : profile.baseURL,
					api: typeof body.api === "string" && body.api ? body.api : profile.api,
					...(apiKey ? { apiKey } : {})
				};
				if (keyId && !requestBody.baseURL) throw new HttpError(400, "BAD_REQUEST", "按 Key 获取模型需要服务商 Base URL");
				const list = keyId
					? await providerProxyScope.run(proxyFor(provider), () => directModels(provider, { ...profile, ...requestBody }, apiKey, signal))
					: await discoverWithFallback(settingsNs, requestBody, provider, { ...profile, ...requestBody }, apiKey, signal);
				return json({ provider, keyId: keyId ?? null, source: "adapter-or-direct", models: await normalizeModels(provider, list, signal) });
			});

			// POST {targets:[{provider,model,reasoningEffort?}], prompt?, maxTokens?, timeoutMs?, concurrency?, withInfo?}
			route(ROUTES.probe, ["POST"], async (request, signal) => {
				const body = await readJson(request);
				if (!Array.isArray(body.targets) || body.targets.length === 0) throw new HttpError(400, "BAD_REQUEST", "targets 不能为空");
				if (body.targets.length > LIMITS.targets) throw new HttpError(400, "BAD_REQUEST", `一次最多 ${LIMITS.targets} 个目标`);
				const targets = body.targets.map((t, i) => parseRef(t, `targets[${i}]`));
				const prompt = typeof body.prompt === "string" && body.prompt.trim() ? body.prompt.slice(0, LIMITS.promptChars) : "Reply with exactly: OK";
				const opts = {
					prompt,
					maxTokens: body.maxTokens === undefined || body.maxTokens === null || body.maxTokens === "" ? undefined : intIn(body.maxTokens, 1, 1000000, undefined),
					timeoutMs: intIn(body.timeoutMs, LIMITS.minTimeoutMs, LIMITS.maxTimeoutMs, LIMITS.defaultTimeoutMs)
				};
				const concurrency = intIn(body.concurrency, 1, LIMITS.concurrency, Math.min(8, targets.length));
				let inFlight = 0;
				let peakInFlight = 0;
				const meter = {
					enter: () => { peakInFlight = Math.max(peakInFlight, ++inFlight); },
					leave: () => { inFlight--; }
				};
				const infos = new Map();
				if (body.withInfo === true) {
					for (const t of targets) {
						const key = `${t.provider}\u0000${t.model}`;
						if (!infos.has(key)) infos.set(key, supportedFor(t.provider, t.model).catch(() => undefined));
					}
				}
				const attach = async (r) => {
					// A successful real call proves an auto-marked provider works again; manual marks stay.
					if (r.ok && health.get(r.provider)?.manual === false) recover(r.provider, "probe");
					const s = infos.size > 0 ? await infos.get(`${r.provider}\u0000${r.model}`) : undefined;
					if (s) r.modelInfo = { ...(s.info ?? {}), levels: s.levels ?? null, levelsSource: s.source };
					return r;
				};
				const header = () => ({ concurrency, peakInFlight, prompt: clip(prompt, 200), maxTokens: opts.maxTokens ?? null, timeoutMs: opts.timeoutMs });

				if (body.stream === true) {
					// NDJSON: one {type:"result",index,result} line per target as it finishes, then {type:"done"}.
					const encoder = new TextEncoder();
					const cancel = new AbortController();
					const streamSignal = AbortSignal.any([signal, cancel.signal]);
					const stream = new ReadableStream({
						async start(controller) {
							const send = (value) => {
								try {
									controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
								} catch {
									// consumer went away
								}
							};
							const t0 = performance.now();
							try {
								await runPool(targets, concurrency, async (t, index) => {
									const r = await attach(await probeOne(sub.llm, t, opts, streamSignal, meter));
									send({ type: "result", index, result: r });
									return r;
								});
								send({ type: "done", wallMs: Math.round(performance.now() - t0), ...header() });
							} finally {
								try {
									controller.close();
								} catch {
									// already closed
								}
							}
						},
						cancel() {
							cancel.abort();
						}
					});
					return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
				}

				const t0 = performance.now();
				const results = await runPool(targets, concurrency, async (t) => attach(await probeOne(sub.llm, t, opts, signal, meter)));
				return json({ wallMs: Math.round(performance.now() - t0), ...header(), results });
			});

			// POST {cases:[{parent?:{...}, child?:{...}}]}
			route(ROUTES.simulate, ["POST"], async (request) => {
				const body = await readJson(request);
				const defaults = reader.ns(DEFAULT_NS) ?? {};
				const rawCases = Array.isArray(body.cases) && body.cases.length > 0 ? body.cases : [{}];
				if (rawCases.length > LIMITS.cases) throw new HttpError(400, "BAD_REQUEST", `一次最多 ${LIMITS.cases} 个用例`);
				const own = reader.own(config ?? {});
				const selection = reader.ns(SELECTION_NS) ?? {};
				const te = reader.ns(TE_NS) ?? {};
				const subagent = reader.ns(SUBAGENT_NS) ?? {};
				const r = routing();
				const cases = await Promise.all(rawCases.map(async (c, i) => {
					const parent = isRecord(c?.parent) ? parseRef(c.parent, `cases[${i}].parent`) : parseRef(defaults, "默认模型（agent-default-model）");
					const child = isRecord(c?.child) ? parseRef(c.child, `cases[${i}].child`) : undefined;
					const wantsOther = child && (child.provider !== parent.provider || child.model !== parent.model);
					const target = wantsOther && selection.enabled === true ? child : parent;
					const route = pickRoute(r, target, { subagent: true, isDown });
					const dest = route.kind ? route.to : target;
					const supported = await supportedFor(dest.provider, dest.model);
					return simulateDispatch({ own, selection, teEffort: str(te.subagentEffort), parent, child, supported, route });
				}));
				return json({
					settings: {
						subagentEffort: str(own.subagentEffort) ?? null,
						subagentMode: own.subagentMode === "fill" ? "fill" : "force",
						clampToModel: own.clampToModel !== false,
						perModelCount: isRecord(own.subagentModelEfforts) ? Object.values(own.subagentModelEfforts).filter(str).length : 0,
						maxActiveSubagents: subagent.maxActiveSubagents ?? null,
						maxDepth: subagent.maxDepth ?? null,
						selectionEnabled: selection.enabled === true,
						thinkingEffortSubagent: str(te.subagentEffort) ?? null
					},
					cases
				});
			});

			// GET ?since=<seq> → entries after seq;  POST {action:"clear"}
			route(ROUTES.dispatches, ["GET", "POST"], async (request) => {
				if (request.method === "POST") {
					const body = await readJson(request);
					if (body.action !== "clear") throw new HttpError(400, "BAD_REQUEST", "未知操作");
					log.length = 0;
					return json({ seq, now: Date.now(), entries: [] });
				}
				const since = intIn(new URL(request.url, "http://local").searchParams.get("since"), 0, Number.MAX_SAFE_INTEGER, 0);
				return json({ seq, now: Date.now(), entries: log.filter((e) => e.seq > since) });
			});

			// GET → health + events + effective routing.
			// POST {action:"mark", provider} | {action:"reset", provider?} | {action:"clear-events"}
			const failoverState = () => {
				for (const p of [...health.keys()]) isDown(p); // expire cooldowns
				const r = routing();
				return {
					now: Date.now(),
					health: [...health.entries()].map(([provider, h]) => ({ provider, ...h })),
					events: events.slice(-200).reverse(),
					routing: { redirects: r.redirects, failover: { ...r.failover, cooldownMinutes: r.failover.cooldownMs / 60000 } },
					defaults: { codes: FAILOVER_CODES }
				};
			};
			route(ROUTES.failover, ["GET", "POST"], async (request) => {
				if (request.method === "POST") {
					const body = await readJson(request);
					const provider = typeof body.provider === "string" && body.provider.length > 0 && body.provider.length <= 200 ? body.provider : undefined;
					if (body.action === "mark") {
						if (!provider) throw new HttpError(400, "BAD_REQUEST", "缺少 provider");
						markDown(provider, { code: "MANUAL", message: "手动标记为不可用" }, { manual: true });
						const h = health.get(provider);
						if (h) Object.assign(h, { manual: true, until: 0, code: "MANUAL" });
					} else if (body.action === "reset") {
						if (provider) recover(provider, "manual");
						else for (const p of [...health.keys()]) recover(p, "manual");
					} else if (body.action === "clear-events") {
						events.length = 0;
					} else throw new HttpError(400, "BAD_REQUEST", "未知操作");
				}
				return json(failoverState());
			});

			// GET [?id=<sessionId>] → tracked sessions with their override.
			// POST {action:"set", sessionId, provider, model, reasoningEffort?} | {action:"clear", sessionId?}
			const sessionView = (id) => {
				const s = sessions.get(id);
				const ov = overrides.get(id);
				if (!s && !ov) return null;
				return { sessionId: id, ...(s ?? { subagent: null }), override: ov ?? null, usage: sessionUsage(id) };
			};
			/** Per-session token totals with an estimated cost when every used model has a price. */
			const sessionUsage = (id, table = prices()) => {
				const u = usage.session(id);
				if (!u) return null;
				let cost = 0;
				let priced = 0;
				let currency = null;
				for (const m of u.models) {
					const p = table[priceKey(m.provider, m.model)];
					const c = costOf(m, p);
					if (c === null) continue;
					cost += c;
					priced++;
					currency ??= p.currency;
				}
				return { ...u, cost: priced ? cost : null, costComplete: priced === u.models.length, currency };
			};

			route(ROUTES.keyUsage, ["GET", "POST"], async (request) => {
				if (request.method === "POST") {
					const body = await readJson(request);
					if (body.action !== "reset" || typeof body.provider !== "string" || typeof body.keyId !== "string") throw new HttpError(400, "BAD_REQUEST", "provider、keyId 和 reset 必填");
					usage.resetKeySpend(body.provider, body.keyId);
				}
				return json({ rows: usage.keySpends() });
			});

			// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD[&recent=n] → bucket rows with cost, recent calls.
			// POST {action:"reset"} | {action:"clear-recent"}
			const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
			route(ROUTES.usage, ["GET", "POST"], async (request) => {
				if (request.method === "POST") {
					const body = await readJson(request);
					if (body.action === "reset") usage.reset();
					else throw new HttpError(400, "BAD_REQUEST", "未知操作");
				}
				const q = new URL(request.url, "http://local").searchParams;
				const from = DAY_RE.test(q.get("from") ?? "") ? q.get("from") : undefined;
				const to = DAY_RE.test(q.get("to") ?? "") ? q.get("to") : undefined;
				const table = prices();
				const rows = usage.rows(from, to).map((r) => {
					const p = table[priceKey(r.provider, r.model)];
					return { ...r, cost: costOf(r, p), currency: p?.currency ?? null };
				});
				const recentN = intIn(q.get("recent"), 0, USAGE_LIMITS.recent, 50);
				const recent = usage.recent(recentN).map(({ counter, ...e }) => {
					const p = table[priceKey(e.provider, e.model)];
					return { ...e, cost: costOf(counter, p), currency: p?.currency ?? null };
				});
				const sessionsTop = usage.sessionIds().slice(0, 100).map((sid) => {
					const u = sessionUsage(sid, table);
					const s = sessions.get(sid);
					return u ? { ...u, parentSessionId: s?.parentSessionId ?? null, depth: s?.depth ?? null } : null;
				}).filter(Boolean);
				return json({
					now: Date.now(),
					today: dayKey(),
					since: usage.since(),
					storage: { state: persistence.state, error: persistence.error() },
					kinds: USAGE_KINDS,
					prices: table,
					rows,
					recent,
					sessions: sessionsTop
				});
			});
			const sessionsState = (id) => {
				if (id) return { now: Date.now(), session: sessionView(id) };
				const ids = [...new Set([...[...sessions.keys()].reverse(), ...overrides.keys()])];
				return { now: Date.now(), sessions: ids.map(sessionView).filter(Boolean) };
			};
			const okId = (v) => (typeof v === "string" && v.length > 0 && v.length <= 200 ? v : undefined);
			route(ROUTES.sessions, ["GET", "POST"], async (request) => {
				let id = okId(new URL(request.url, "http://local").searchParams.get("id") ?? undefined);
				if (request.method === "POST") {
					const body = await readJson(request);
					id = okId(body.sessionId);
					if (body.action === "set") {
						if (!id) throw new HttpError(400, "BAD_REQUEST", "缺少 sessionId");
						const ref = parseRef(body, "override");
						if (ref.reasoningEffort !== undefined && !LEVELS.includes(ref.reasoningEffort)) throw new HttpError(400, "BAD_REQUEST", "推理程度无效");
						const prev = sessions.get(id);
						overrides.set(id, { ...ref, at: Date.now() });
						event({ type: "override", sessionId: id, subagent: prev?.subagent ?? null, from: prev ? `${prev.provider}/${prev.model}` : null, to: `${ref.provider}/${ref.model}`, effort: ref.reasoningEffort ?? null });
					} else if (body.action === "clear") {
						if (id) {
							if (overrides.delete(id)) event({ type: "override-cleared", sessionId: id });
						} else {
							for (const k of [...overrides.keys()]) event({ type: "override-cleared", sessionId: k });
							overrides.clear();
						}
					} else throw new HttpError(400, "BAD_REQUEST", "未知操作");
				}
				return json(sessionsState(id));
			});
		}
	});
}
