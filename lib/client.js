window.__ModuleLoader__.load({ id: "dsh-model-manager", factory: (require) => {
	var module = { exports: {} };
	var exports = module.exports;
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

	const React = require("react");
	const h = React.createElement;
	const { useState, useEffect, useCallback, useMemo, useRef } = React;

	// ---------------------------------------------------------------- constants
	const PANEL_ID = "model-manager";
	const LLM_NS = "llm-pi-ai";
	const OWN_NS = "model-manager";
	const TE_NS = "thinking-effort";
	const DEFAULT_NS = "agent-default-model";
	const SUBAGENT_NS = "subagent";
	const SELECTION_NS = "subagent-model-selection-settings";
	const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
	const LEVEL_LABEL = { off: "关闭", minimal: "极简", low: "低", medium: "中", high: "高", xhigh: "超高", max: "最大" };
	const APIS = [
		["openai-completions", "OpenAI Chat Completions"],
		["openai-responses", "OpenAI Responses"],
		["anthropic-messages", "Anthropic Messages"]
	];
	const PRESETS = [
		["extended", "扩展：关/低/中/高/超高/最大", ["off", "low", "medium", "high", "xhigh", "max"]],
		["standard", "标准：关/低/中/高", ["off", "low", "medium", "high"]],
		["highmax", "精简：关/高/最大", ["off", "high", "max"]],
		["all", "全部 7 档", LEVELS],
		["none", "清除推理设置", []]
	];

	// ---------------------------------------------------------------- helpers
	const isRec = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
	const rec = (v) => (isRec(v) ? v : {});
	const str = (v) => (typeof v === "string" && v.length > 0 ? v : undefined);
	const toInt = (v) => {
		const n = Number.parseInt(String(v ?? "").trim(), 10);
		return Number.isSafeInteger(n) ? n : undefined;
	};
	const deriveRef = (id) => `${String(id).toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
	const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
	const levelsOf = (efforts) => (isRec(efforts) ? LEVELS.filter((l) => l in efforts) : []);
	const effortsFromPreset = (levels) => {
		if (levels.length === 0) return undefined;
		const out = {};
		for (const l of levels) out[l] = l === "off" ? null : l;
		return out;
	};
	const findView = (desc, ns) => {
		const list = Array.isArray(desc?.namespaces) ? desc.namespaces : [];
		return list.find((v) => v.ns === ns) ?? list.find((v) => v.ns === `include:${ns}`);
	};

	/**
	 * Image-input capability by model family. Third-party relays frequently report
	 * no modality metadata, which used to leave every model unchecked. These
	 * patterns only fill that gap: an explicitly saved `input` always wins, and a
	 * reported `inputModalities` is never overridden.
	 */
	const VISION_PATTERNS = [
		/^claude-3([.-]\d+)?[-.](opus|sonnet|haiku)/i,
		/^claude-(opus|sonnet|haiku)-[3-9]/i,
		/^claude-[4-9]/i,
		/^gpt-4o/i,
		/^gpt-4\.1/i,
		/^gpt-4-turbo/i,
		/^gpt-4-vision/i,
		/^gpt-5/i,
		/^chatgpt-4o/i,
		/^o1(?!-mini)(-|$)/i,
		/^o3(?!-mini)(-|$)/i,
		/^o4(-|$)/i,
		/^grok-.*vision/i,
		/^grok-[4-9]/i,
		/^deepseek-(vl|vision|ocr)/i,
		/^glm-[0-9.]+v/i,
		/^glm-.*vision/i,
		/^gemini-/i,
		/^qwen[0-9.]*-?vl/i,
		/^qwen-?vl/i,
		/^kimi-.*vl/i,
		/^llava/i,
		/^pixtral/i,
		/^internvl/i,
		/^minicpm-v/i,
		/^phi-[34].*vision/i,
		/^phi-4-multimodal/i,
		/^llama-3\.2-.*vision/i,
		/^mistral-.*vision/i,
		/^step-1v/i,
		/^yi-vision/i,
		/^doubao-.*vision/i,
		/^seed-[0-9.]+-vl/i,
		/^ernie-.*vl/i,
		/^hunyuan-.*vision/i,
		/^moondream/i
	];
	const inferredImage = (id) => VISION_PATTERNS.some((re) => re.test(String(id ?? "")));
	/** Modalities to save for a discovered model: reported wins, else the table. */
	const defaultInputModalities = (id, reported) => (Array.isArray(reported) && reported.length ? reported : inferredImage(id) ? ["text", "image"] : undefined);

	/** Unwrap a Remote result `{ ok, value } | { ok: false, error }`. */
	async function call(promise) {
		const r = await promise;
		if (r && typeof r === "object" && "ok" in r) {
			if (r.ok) return r.value;
			const err = new Error(r.error?.message ?? "请求失败");
			err.code = r.error?.code;
			throw err;
		}
		return r;
	}

	function createApi(ctx) {
		const remote = ctx.remote;
		return {
			describe: () => call(remote.settings.describe()),
			mutate: (ns, ops, revision) => call(remote.settings.mutate(ns, ops, revision)),
			credDescribe: (refs) => (refs.length ? call(remote.credentials.describe(refs)) : Promise.resolve({})),
			credSet: (ref, value) => call(remote.credentials.set(ref, value)),
			credUnset: (ref) => call(remote.credentials.unset(ref)),
			discover: (ns, request) => call(remote.llm.discoverModels(ns, request)),
			configurable: () => call(remote.llm.listConfigurableProviders()),
			catalog: () => call(remote.session.modelCatalog()),
			on: (event, fn) => (typeof remote.$on === "function" ? remote.$on(event, fn) : () => {}),
			// ---- diagnostics (authenticated Host routes, same-origin cookie auth)
			probe: (body, signal, onLine) => hostFetch(ROUTES.probe, { method: "POST", body, signal, onLine }),
			simulate: (cases) => hostFetch(ROUTES.simulate, { method: "POST", body: { cases } }),
			dispatches: (since) => hostFetch(`${ROUTES.dispatches}?since=${encodeURIComponent(String(since ?? 0))}`),
			clearDispatches: () => hostFetch(ROUTES.dispatches, { method: "POST", body: { action: "clear" } }),
			failover: () => hostFetch(ROUTES.failover),
			failoverAction: (body) => hostFetch(ROUTES.failover, { method: "POST", body }),
			sessions: (id) => hostFetch(id ? `${ROUTES.sessions}?id=${encodeURIComponent(String(id))}` : ROUTES.sessions),
			sessionsAction: (body) => hostFetch(ROUTES.sessions, { method: "POST", body }),
			usage: (q = {}) => {
				const params = new URLSearchParams();
				for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null) params.set(k, String(v));
				return hostFetch(`${ROUTES.usage}?${params}`);
			},
			usageAction: (body) => hostFetch(ROUTES.usage, { method: "POST", body }),
			keyUsage: () => hostFetch(ROUTES.keyUsage),
			keyUsageAction: (body) => hostFetch(ROUTES.keyUsage, { method: "POST", body }),
			providerModels: (provider) => hostFetch(`${ROUTES.models}?provider=${encodeURIComponent(provider)}`),
			discoverProvider: (body, signal) => hostFetch(ROUTES.models, { method: "POST", body, signal }),
			detectProxy: () => hostFetch(ROUTES.proxy),
			// ---- real dispatch test
			sessionCreate: (req) => call(remote.session.create(req)),
			sessionSelectModel: (req) => call(remote.session.selectModel(req)),
			sessionRename: (req) => call(remote.session.rename(req)),
			sessionPrompt: (req) => call(remote.session.prompt(req)),
			openSession: (id) => ctx.get("uiWorkspace")?.openSession(id),
			archiveSession: (id) => {
				const ws = ctx.get("uiWorkspace");
				if (!ws) throw new Error("当前界面不支持归档");
				return ws.archiveSession(id, { stopActivity: true });
			}
		};
	}

	const ROUTES = {
		probe: "api/model-manager.probe",
		simulate: "api/model-manager.simulate",
		dispatches: "api/model-manager.dispatches",
		failover: "api/model-manager.failover",
		sessions: "api/model-manager.sessions",
		usage: "api/model-manager.usage",
		keyUsage: "api/model-manager.key-usage",
		models: "api/model-manager.models",
		proxy: "api/model-manager.proxy"
	};
	const NO_HOST = "主机端诊断接口不可用：新版插件的主机部分尚未加载，请重启 DSH 后再试。";

	/** fetch a document-relative Host route; JSON or NDJSON (onLine per line). */
	async function hostFetch(path, { method = "GET", body, signal, onLine } = {}) {
		const init = { method, signal, credentials: "same-origin", headers: {} };
		if (body !== undefined) {
			init.headers["content-type"] = "application/json";
			init.body = JSON.stringify(body);
		}
		const res = await fetch(new URL(path, document.baseURI), init);
		const type = res.headers.get("content-type") ?? "";
		if (res.status === 404 || !/json/.test(type)) {
			const err = new Error(NO_HOST);
			err.code = "NO_HOST_ROUTE";
			throw err;
		}
		if (/ndjson/.test(type) && onLine && res.body) {
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buf = "";
			let last;
			for (;;) {
				const { done, value } = await reader.read();
				if (value) buf += decoder.decode(value, { stream: true });
				let nl;
				while ((nl = buf.indexOf("\n")) >= 0) {
					const line = buf.slice(0, nl).trim();
					buf = buf.slice(nl + 1);
					if (!line) continue;
					try {
						last = JSON.parse(line);
						onLine(last);
					} catch {
						// skip malformed line
					}
				}
				if (done) break;
			}
			return last;
		}
		const value = await res.json();
		if (!res.ok) {
			const err = new Error(value?.error?.message ?? `HTTP ${res.status}`);
			err.code = value?.error?.code;
			throw err;
		}
		return value;
	}

	async function loadAll(api) {
		const [desc, catalog, configurable] = await Promise.all([
			api.describe(),
			api.catalog().catch((e) => ({ error: e.message })),
			api.configurable().catch(() => [])
		]);
		const llm = findView(desc, LLM_NS);
		const value = rec(rec(llm?.value).providers);
		const user = rec(rec(llm?.user).providers);
		const base = rec(rec(llm?.base).providers);
		const ids = [...new Set([...Object.keys(user), ...Object.keys(value)])].sort();
		const providers = ids.map((id) => {
			const merged = rec(value[id] ?? user[id]);
			return {
				id,
				value: merged,
				user: isRec(user[id]) ? user[id] : undefined,
				inBase: id in base,
				ref: str(merged.apiKeyEnv) ?? deriveRef(id)
			};
		});
		const providerModels = await Promise.all(providers.map(async (p) => {
			const existing = (catalog?.groups ?? []).find((g) => g.id === p.id);
			if (Array.isArray(existing?.models) && existing.models.length > 0) return null;
			try { return await api.providerModels(p.id); } catch { return null; }
		}));
		if (catalog && !catalog.error) {
			const groups = Array.isArray(catalog.groups) ? catalog.groups.map((g) => ({ ...g, models: Array.isArray(g.models) ? [...g.models] : [] })) : [];
			for (let i = 0; i < providers.length; i++) {
				const p = providers[i];
				const group = groups.find((g) => g.id === p.id);
				const fetched = providerModels[i]?.models ?? [];
				const configured = Array.isArray(p.value.models) ? p.value.models : [];
				const source = group?.models?.length ? group.models : fetched.length ? fetched : configured;
				if (!source.length) continue;
				const models = source.map((md) => {
					const cfg = configured.find((x) => x?.id === md.id);
					const ids = Object.keys(rec(cfg?.reasoningEfforts)).filter((l) => LEVELS.includes(l));
					const reasoning = md.reasoning ?? (ids.length ? { efforts: ids.map((id) => ({ id, name: LEVEL_LABEL[id] ?? id })) } : p.value.reasoning === true ? { efforts: LEVELS.map((id) => ({ id, name: LEVEL_LABEL[id] ?? id })) } : undefined);
					const modalities = Array.isArray(md.inputModalities) && md.inputModalities.length ? md.inputModalities : defaultInputModalities(md.id, cfg?.input);
					return { ...md, ...(modalities ? { inputModalities: modalities } : {}), name: md.name ?? cfg?.name ?? md.id, ...(reasoning ? { reasoning } : {}) };
				});
				if (group) group.models = models;
				else groups.push({ id: p.id, name: p.value.displayName ?? p.id, models });
			}
			catalog.groups = groups;
		}
		// Model pickers follow the custom provider order from the providers tab.
		const order = normLayout(rec(findView(desc, OWN_NS)?.value).providerLayout, ids).order;
		if (Array.isArray(catalog?.groups) && order.length) {
			const rank = new Map(order.map((id, i) => [id, i]));
			catalog.groups = catalog.groups.map((g, i) => [g, i]).sort((a, b) => (rank.get(a[0].id) ?? 1e9 + a[1]) - (rank.get(b[0].id) ?? 1e9 + b[1])).map(([g]) => g);
		}
		const refs = [...new Set(providers.map((p) => p.ref))];
		let creds = {};
		let credError;
		try {
			creds = rec(await api.credDescribe(refs));
		} catch (e) {
			credError = e.message;
		}
		return {
			desc,
			own: findView(desc, OWN_NS),
			writable: desc?.writable !== false,
			llm,
			providers,
			creds,
			credError,
			catalog: catalog && !catalog.error ? catalog : undefined,
			catalogError: catalog?.error,
			configurable: Array.isArray(configurable) ? configurable : []
		};
	}

	// ---------------------------------------------------------------- styles
	const C = {
		bg: "var(--dsw-alias-bg-base, #fff)",
		l1: "var(--dsw-alias-bg-layer-1, #f7f7f8)",
		l2: "var(--dsw-alias-bg-layer-2, #efeff1)",
		b1: "var(--dsw-alias-border-l1, rgba(0,0,0,.08))",
		b2: "var(--dsw-alias-border-l2, rgba(0,0,0,.16))",
		brand: "var(--dsw-alias-brand-primary, #4d6bfe)",
		fg: "var(--dsw-alias-label-primary, #1a1a1a)",
		fg2: "var(--dsw-alias-label-secondary, #6b6b6b)",
		err: "var(--dsw-alias-state-error-primary, #d93025)",
		ok: "var(--dsw-alias-state-success-primary, #1e8e3e)",
		warn: "var(--dsw-alias-state-warn-primary, #e37400)",
		idle: "var(--dsw-alias-state-idle-primary, #9aa0a6)"
	};
	const S = {
		page: { height: "100%", overflow: "auto", boxSizing: "border-box", padding: "24px 32px 48px", color: C.fg, background: C.bg, fontSize: 13, lineHeight: 1.5 },
		inner: { maxWidth: 1080, margin: "0 auto" },
		h1: { fontSize: 20, fontWeight: 600, margin: "0 0 4px" },
		sub: { color: C.fg2, margin: "0 0 16px" },
		tabs: { display: "flex", gap: 4, borderBottom: `1px solid ${C.b1}`, marginBottom: 16 },
		tab: (on) => ({ border: "none", background: "none", padding: "8px 14px", cursor: "pointer", color: on ? C.fg : C.fg2, fontWeight: on ? 600 : 400, borderBottom: `2px solid ${on ? C.brand : "transparent"}`, marginBottom: -1, fontSize: 13 }),
		card: { background: C.l1, border: `1px solid ${C.b1}`, borderRadius: 10, padding: 16, marginBottom: 12 },
		cardTitle: { fontSize: 14, fontWeight: 600, margin: "0 0 4px" },
		hint: { color: C.fg2, fontSize: 12, margin: "2px 0 10px" },
		row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
		grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10, margin: "10px 0" },
		label: { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: C.fg2 },
		input: { height: 30, boxSizing: "border-box", padding: "0 8px", borderRadius: 6, border: `1px solid ${C.b2}`, background: C.bg, color: C.fg, fontSize: 13, minWidth: 0 },
		btn: (kind) => ({
			height: 30, padding: "0 12px", borderRadius: 6, cursor: "pointer", fontSize: 13, whiteSpace: "nowrap",
			border: `1px solid ${kind === "primary" ? C.brand : kind === "danger" ? C.err : C.b2}`,
			background: kind === "primary" ? C.brand : "transparent",
			color: kind === "primary" ? "#fff" : kind === "danger" ? C.err : C.fg
		}),
		pill: (color) => ({ display: "inline-block", padding: "1px 8px", borderRadius: 999, fontSize: 11, border: `1px solid ${color ?? C.b2}`, color: color ?? C.fg2 }),
		chip: { display: "inline-block", padding: "0 6px", borderRadius: 4, fontSize: 11, background: C.l2, color: C.fg, marginRight: 4 },
		dot: (color) => ({ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: color, marginRight: 6 }),
		table: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
		th: { textAlign: "left", fontWeight: 500, color: C.fg2, padding: "6px 8px", borderBottom: `1px solid ${C.b1}` },
		td: { padding: "6px 8px", borderBottom: `1px solid ${C.b1}`, verticalAlign: "middle" },
		flash: (kind) => ({ position: "sticky", top: 0, zIndex: 2, padding: "8px 12px", borderRadius: 8, marginBottom: 12, border: `1px solid ${kind === "err" ? C.err : C.ok}`, color: kind === "err" ? C.err : C.ok, background: C.l1 }),
		warnBox: { padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.warn}`, color: C.fg, margin: "8px 0" },
		mono: { fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace", fontSize: 12 }
	};

	// ---------------------------------------------------------------- tiny components
	function Field({ label, children, wide }) {
		return h("label", { style: { ...S.label, gridColumn: wide ? "1 / -1" : undefined } }, label, children);
	}
	function TextInput({ value, onChange, placeholder, type, ariaLabel, style, disabled }) {
		return h("input", {
			type: type ?? "text", value: value ?? "", placeholder, disabled, "aria-label": ariaLabel,
			style: { ...S.input, ...style }, onChange: (e) => onChange(e.target.value), spellCheck: false, autoComplete: "off"
		});
	}
	function Select({ value, onChange, options, ariaLabel, style, disabled }) {
		return h("select", { value, disabled, "aria-label": ariaLabel, style: { ...S.input, ...style }, onChange: (e) => onChange(e.target.value) },
			options.map(([v, label]) => h("option", { key: v, value: v }, label)));
	}
	function Check({ checked, onChange, label, disabled }) {
		return h("label", { style: { display: "inline-flex", alignItems: "center", gap: 6, cursor: disabled ? "default" : "pointer" } },
			h("input", { type: "checkbox", checked: !!checked, disabled, onChange: (e) => onChange(e.target.checked) }), label);
	}
	function Btn({ kind, onClick, disabled, children, title, "aria-expanded": expanded }) {
		return h("button", { type: "button", title, disabled, onClick, "aria-expanded": expanded, style: { ...S.btn(kind), opacity: disabled ? 0.5 : 1, cursor: disabled ? "default" : "pointer" } }, children);
	}
	function EffortChips({ efforts }) {
		const levels = levelsOf(efforts);
		if (levels.length === 0) return h("span", { style: { color: C.fg2 } }, "未设置");
		return h("span", null, levels.map((l) => {
			const wire = efforts[l];
			const custom = typeof wire === "string" && wire !== l;
			return h("span", { key: l, style: S.chip, title: custom ? `发送值：${wire}` : undefined }, LEVEL_LABEL[l] + (custom ? "*" : ""));
		}));
	}

	function ModelIcon({ size }) {
		const s = size ?? 20;
		return h("svg", { width: s, height: s, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
			h("rect", { x: 5, y: 5, width: 14, height: 14, rx: 3 }),
			h("rect", { x: 9, y: 9, width: 6, height: 6, rx: 1 }),
			h("path", { d: "M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" }));
	}

	// ---------------------------------------------------------------- data hook
	function useManager(api) {
		const [state, setState] = useState({ status: "loading" });
		const [flash, setFlash] = useState(null);
		const [busy, setBusy] = useState(false);
		const generation = useRef(0);
		const flashTimer = useRef();

		const reload = useCallback(async () => {
			const gen = ++generation.current;
			try {
				const data = await loadAll(api);
				if (gen === generation.current) setState({ status: "ready", data });
			} catch (e) {
				if (gen === generation.current) setState((s) => ({ ...s, status: s.data ? "ready" : "error", error: e.message }));
			}
		}, [api]);

		const notify = useCallback((kind, text) => {
			clearTimeout(flashTimer.current);
			setFlash({ kind, text });
			flashTimer.current = setTimeout(() => setFlash(null), kind === "err" ? 8000 : 3000);
		}, []);

		useEffect(() => {
			reload();
			let timer;
			const soon = () => {
				clearTimeout(timer);
				timer = setTimeout(reload, 250);
			};
			const offs = ["settings/document-updated", "credentials/reference-updated", "credentials/record-updated", "llm/adapters-updated"].map((e) => api.on(e, soon));
			return () => {
				clearTimeout(timer);
				clearTimeout(flashTimer.current);
				for (const off of offs) try { off?.(); } catch {}
			};
		}, [api, reload]);

		/** Run one or more writes, then reload; reports success or failure. */
		const run = useCallback(async (okText, fn) => {
			setBusy(true);
			try {
				await fn();
				await reload();
				if (okText) notify("ok", okText);
				return true;
			} catch (e) {
				notify("err", e.message || String(e));
				return false;
			} finally {
				setBusy(false);
			}
		}, [reload, notify]);

		/** settings.mutate with one conflict retry against a fresh revision. */
		const write = useCallback(async (ns, ops) => {
			const view = findView(state.data?.desc, ns) ?? findView(await api.describe(), ns);
			if (!view) throw new Error(`未找到设置分区 ${ns}（对应插件可能未启用）`);
			try {
				await api.mutate(view.ns, ops, view.revision);
			} catch (e) {
				if (e.code !== "settings/conflict") throw e;
				const fresh = findView(await api.describe(), ns);
				await api.mutate(fresh.ns, ops, fresh.revision);
			}
		}, [api, state.data]);

		return { state, flash, busy, reload, run, write, notify };
	}

	// ---------------------------------------------------------------- providers tab
	/** Normalize providerLayout against the providers that exist now. */
	function normLayout(raw, ids) {
		const known = new Set(ids);
		const r = rec(raw);
		const seen = new Set();
		const order = [];
		for (const id of Array.isArray(r.order) ? r.order : []) if (known.has(id) && !seen.has(id)) { seen.add(id); order.push(id); }
		for (const id of ids) if (!seen.has(id)) order.push(id);
		const taken = new Set();
		const groups = [];
		for (const g of Array.isArray(r.groups) ? r.groups : []) {
			const name = str(rec(g).name)?.trim();
			if (!name || groups.some((x) => x.name === name)) continue;
			const providers = (Array.isArray(g.providers) ? g.providers : []).filter((id) => known.has(id) && !taken.has(id) && taken.add(id));
			groups.push({ name, providers, collapsed: g.collapsed === true });
		}
		return { order, groups };
	}
	const SORTS = [["custom", "自定义顺序"], ["name", "名称"], ["usage", "近 30 天用量"], ["models", "模型数"], ["key", "密钥状态"]];
	const lsGet = (k, d) => { try { return globalThis.localStorage?.getItem(k) ?? d; } catch { return d; } };
	const lsSet = (k, v) => { try { globalThis.localStorage?.setItem(k, v); } catch { /* ignore */ } };

	/** 30-day per-provider token totals for cards and the usage sort; silent when the Host route is missing. */
	function useProviderUsage(api) {
		const [map, setMap] = useState({});
		useEffect(() => {
			let alive = true;
			api.usage({ from: dayKeyLocal(-29), recent: 0 }).then((d) => {
				if (!alive) return;
				const out = {};
				for (const r of d.rows ?? []) {
					if (r.kind === "probe") continue;
					const a = (out[r.provider] ??= { calls: 0, tokens: 0, cost: {} });
					a.calls += r.calls;
					a.tokens += tokTotal(r);
					if (typeof r.cost === "number") a.cost[r.currency ?? "CNY"] = (a.cost[r.currency ?? "CNY"] ?? 0) + r.cost;
				}
				setMap(out);
			}, () => {});
			return () => { alive = false; };
		}, [api]);
		return map;
	}

	function ProvidersTab({ m, api }) {
		const data = m.state.data;
		const own = findView(data.desc, OWN_NS);
		const ids = data.providers.map((p) => p.id);
		const stored = useMemo(() => normLayout(rec(own?.value).providerLayout, ids), [own?.value, ids.join("\u0000")]);
		// Optimistic layout: moves render at once, the settings write follows.
		const [local, setLocal] = useState(null);
		useEffect(() => setLocal(null), [stored]);
		const layout = local ?? stored;
		const [adding, setAdding] = useState(false);
		const [open, setOpen] = useState(null);
		const [q, setQ] = useState("");
		const [sort, setSortRaw] = useState(() => lsGet("model-manager.providerSort", "custom"));
		const setSort = (v) => { setSortRaw(v); lsSet("model-manager.providerSort", v); };
		const [grouped, setGroupedRaw] = useState(() => lsGet("model-manager.providerGrouped", "1") === "1");
		const setGrouped = (v) => { setGroupedRaw(v); lsSet("model-manager.providerGrouped", v ? "1" : "0"); };
		const [newGroup, setNewGroup] = useState("");
		const usageMap = useProviderUsage(api);
		const canEdit = data.writable && !!own;

		const save = (next, okText) => {
			setLocal(next);
			return m.run(okText, () => m.write(OWN_NS, [{ op: "set", path: ["providerLayout"], value: next }]));
		};
		const byId = new Map(data.providers.map((p) => [p.id, p]));
		const rank = new Map(layout.order.map((id, i) => [id, i]));
		const nameOf = (p) => (str(p.value.displayName) ?? p.id).toLowerCase();
		const modelsOf = (p) => (Array.isArray(p.value.models) && p.value.models.length ? p.value.models.length : Object.keys(rec(p.value.modelOverrides)).length);
		const cmp = {
			custom: (a, b) => rank.get(a.id) - rank.get(b.id),
			name: (a, b) => nameOf(a).localeCompare(nameOf(b)),
			usage: (a, b) => (usageMap[b.id]?.tokens ?? 0) - (usageMap[a.id]?.tokens ?? 0) || rank.get(a.id) - rank.get(b.id),
			models: (a, b) => modelsOf(b) - modelsOf(a) || rank.get(a.id) - rank.get(b.id),
			key: (a, b) => Number(!!data.creds[b.ref]?.configured) - Number(!!data.creds[a.ref]?.configured) || rank.get(a.id) - rank.get(b.id)
		}[sort] ?? ((a, b) => rank.get(a.id) - rank.get(b.id));
		const needle = q.trim().toLowerCase();
		const match = (p) => !needle || [p.id, p.value.displayName, p.value.baseURL].some((s) => typeof s === "string" && s.toLowerCase().includes(needle));
		const groupOf = new Map(layout.groups.flatMap((g) => g.providers.map((id) => [id, g.name])));

		const move = (id, dir, list) => {
			const i = list.indexOf(id);
			const j = i + dir;
			if (i < 0 || j < 0 || j >= list.length) return;
			const other = list[j];
			const order = [...layout.order];
			const a = order.indexOf(id);
			const b = order.indexOf(other);
			[order[a], order[b]] = [order[b], order[a]];
			save({ ...layout, order }, "顺序已保存");
		};
		const setGroup = (id, name) => {
			const groups = layout.groups.map((g) => ({ ...g, providers: g.providers.filter((x) => x !== id) }));
			if (name) {
				const g = groups.find((x) => x.name === name);
				if (g) g.providers.push(id);
				else groups.push({ name, providers: [id], collapsed: false });
			}
			save({ ...layout, groups }, name ? `已移入分组「${name}」` : "已移出分组");
		};
		const addGroup = () => {
			const name = newGroup.trim().slice(0, 40);
			if (!name) return;
			if (layout.groups.some((g) => g.name === name)) return m.notify("err", "已有同名分组");
			setNewGroup("");
			save({ ...layout, groups: [...layout.groups, { name, providers: [], collapsed: false }] }, `已新增分组「${name}」`);
		};
		const editGroup = (name, fn, okText) => save({ ...layout, groups: fn(layout.groups.map((g) => ({ ...g }))).filter(Boolean) }, okText);
		const moveGroup = (name, dir) => editGroup(name, (gs) => {
			const i = gs.findIndex((g) => g.name === name);
			const j = i + dir;
			if (i >= 0 && j >= 0 && j < gs.length) [gs[i], gs[j]] = [gs[j], gs[i]];
			return gs;
		}, "分组顺序已保存");
		const renameGroup = (name) => {
			const next = globalThis.prompt?.("新的分组名称", name)?.trim().slice(0, 40);
			if (!next || next === name) return;
			if (layout.groups.some((g) => g.name === next)) return m.notify("err", "已有同名分组");
			editGroup(name, (gs) => gs.map((g) => (g.name === name ? { ...g, name: next } : g)), "分组已重命名");
		};
		const deleteGroup = (name) => {
			if (globalThis.confirm && !globalThis.confirm(`删除分组「${name}」？其中的服务商会移到“未分组”，不会被删除。`)) return;
			editGroup(name, (gs) => gs.map((g) => (g.name === name ? null : g)), "分组已删除");
		};
		const toggleGroup = (name) => editGroup(name, (gs) => gs.map((g) => (g.name === name ? { ...g, collapsed: !g.collapsed } : g)), undefined);

		const card = (p, list) => h(ProviderCard, {
			key: p.id, p, m, api, open: open === p.id, onToggle: () => setOpen(open === p.id ? null : p.id),
			usage: usageMap[p.id],
			layout: canEdit ? {
				group: groupOf.get(p.id) ?? "",
				groups: layout.groups.map((g) => g.name),
				onGroup: (name) => setGroup(p.id, name),
				canMove: sort === "custom" && !needle,
				onUp: () => move(p.id, -1, list),
				onDown: () => move(p.id, 1, list),
				first: list[0] === p.id,
				last: list[list.length - 1] === p.id
			} : null
		});
		const section = (title, members, g) => {
			const list = members.filter(match).sort(cmp);
			if (needle && list.length === 0) return null;
			const ids2 = list.map((p) => p.id);
			const collapsed = g?.collapsed && !needle;
			const sums = members.reduce((a, p) => a + (usageMap[p.id]?.tokens ?? 0), 0);
			return h("section", { key: `g:${title}`, style: { marginBottom: 8 } },
				h("div", { style: { ...S.row, justifyContent: "space-between", padding: "6px 2px", borderBottom: `1px solid ${C.b1}`, marginBottom: 8 } },
					h("button", { type: "button", onClick: g && canEdit ? () => toggleGroup(g.name) : undefined, "aria-expanded": !collapsed, style: { border: "none", background: "none", padding: 0, cursor: g && canEdit ? "pointer" : "default", color: C.fg, fontWeight: 600, fontSize: 13, display: "inline-flex", gap: 6, alignItems: "center" } },
						g ? h("span", { "aria-hidden": true, style: { fontSize: 10, color: C.fg2 } }, collapsed ? "▶" : "▼") : null,
						title, h("span", { style: { color: C.fg2, fontWeight: 400 } }, ` · ${members.length} 个`), sums ? h("span", { style: { color: C.fg2, fontWeight: 400 } }, ` · 近 30 天 ${fmtTok(sums)} tokens`) : null),
					g && canEdit ? h("div", { style: { ...S.row, gap: 4 } },
						h(Btn, { onClick: () => moveGroup(g.name, -1), disabled: layout.groups[0]?.name === g.name, title: "分组上移" }, "↑"),
						h(Btn, { onClick: () => moveGroup(g.name, 1), disabled: layout.groups[layout.groups.length - 1]?.name === g.name, title: "分组下移" }, "↓"),
						h(Btn, { onClick: () => renameGroup(g.name) }, "重命名"),
						h(Btn, { kind: "danger", onClick: () => deleteGroup(g.name) }, "删除分组")) : null),
				collapsed ? null : list.length === 0 ? h("div", { style: { ...S.hint, padding: "0 4px 8px" } }, "空分组：在服务商卡片右上角的“分组”下拉里选择这个分组即可移入。") : list.map((p) => card(p, ids2)));
		};

		let body;
		if (grouped && layout.groups.length) {
			const ungrouped = data.providers.filter((p) => !groupOf.has(p.id));
			body = [
				...layout.groups.map((g) => section(g.name, g.providers.map((id) => byId.get(id)).filter(Boolean), g)),
				ungrouped.length ? section("未分组", ungrouped, null) : null
			];
		} else {
			const list = data.providers.filter(match).sort(cmp);
			const ids2 = list.map((p) => p.id);
			body = list.map((p) => card(p, ids2));
			if (needle && list.length === 0) body = h("div", { style: { color: C.fg2 } }, "没有匹配的服务商。");
		}
		return h(React.Fragment, null,
			h("div", { style: { ...S.row, justifyContent: "space-between", marginBottom: 12 } },
				h("div", { style: { color: C.fg2 } }, `共 ${data.providers.length} 个第三方服务商（llm-pi-ai）${layout.groups.length ? ` · ${layout.groups.length} 个分组` : ""}`),
				h(Btn, { kind: "primary", onClick: () => setAdding((v) => !v), disabled: !data.writable }, adding ? "取消新增" : "+ 新增服务商")),
			data.providers.length > 0 ? h("div", { style: { ...S.row, marginBottom: 12 } },
				h(TextInput, { value: q, onChange: setQ, placeholder: "搜索 ID / 名称 / baseURL", ariaLabel: "搜索服务商", style: { width: 220 } }),
				h(Select, { value: sort, onChange: setSort, options: SORTS, ariaLabel: "排序方式" }),
				h(Check, { checked: grouped, onChange: setGrouped, label: "按分组显示" }),
				canEdit ? h("span", { style: { ...S.row, gap: 4, marginLeft: "auto" } },
					h(TextInput, { value: newGroup, onChange: setNewGroup, placeholder: "新分组名称", ariaLabel: "新分组名称", style: { width: 140 } }),
					h(Btn, { onClick: addGroup, disabled: !newGroup.trim() }, "+ 分组")) : null) : null,
			sort !== "custom" || needle ? h("div", { style: { ...S.hint, marginTop: -6 } }, "↑↓ 调整顺序只在“自定义顺序”且未搜索时可用。自定义顺序同时决定其他页面模型下拉框里服务商的先后。") : null,
			!own ? h("div", { style: S.warnBox }, "主机端插件尚未加载，分组和排序暂不能保存（重启 DSH 后可用）。") : null,
			data.credError ? h("div", { style: S.warnBox }, `密钥状态读取失败：${data.credError}`) : null,
			adding ? h(ProviderForm, { m, api, isNew: true, onDone: (id) => { setAdding(false); setOpen(id); } }) : null,
			data.providers.length === 0 && !adding ? h("div", { style: S.card }, "还没有第三方服务商，点击右上角新增。") : null,
			body);
	}

	function KeyStatus({ info }) {
		if (!info) return h("span", { style: { color: C.fg2 } }, h("span", { style: S.dot(C.idle) }), "未知");
		if (!info.configured) return h("span", { style: { color: C.warn } }, h("span", { style: S.dot(C.warn) }), "未配置密钥");
		return h("span", { style: { color: C.ok } }, h("span", { style: S.dot(C.ok) }), "已配置", info.source ? ` · ${info.source}` : "", info.writable === false ? " · 只读" : "");
	}

	function ProviderCard({ p, m, api, open, onToggle, usage, layout }) {
		const data = m.state.data;
		const v = p.value;
		const modelCount = Array.isArray(v.models) && v.models.length > 0 ? v.models.length : Object.keys(rec(v.modelOverrides)).length;
		const [quick, setQuick] = useState(false);
		const [proxyOpen, setProxyOpen] = useState(false);
		return h("div", { style: S.card },
			h("div", { style: { ...S.row, justifyContent: "space-between" } },
				h("div", { style: { ...S.row, gap: 10 } },
					h("strong", { style: { fontSize: 14 } }, str(v.displayName) ?? p.id),
					h("span", { style: { ...S.mono, color: C.fg2 } }, p.id),
					h("span", { style: S.pill() }, str(v.api) ?? "默认协议"),
					p.inBase ? h("span", { style: S.pill(C.warn), title: "此服务商来自内置配置，修改会写入用户层覆盖" }, "内置") : null,
					v.reasoning === true ? h("span", { style: S.pill(C.brand) }, "推理") : null),
				h("div", { style: { ...S.row, gap: 12 } },
					h(KeyStatus, { info: data.creds[p.ref] }),
					h("span", { style: { color: C.fg2 } }, `${modelCount} 个模型`),
					layout ? h("select", {
						value: layout.group, "aria-label": `${p.id} 所在分组`, title: "分组", style: { ...S.input, height: 28, maxWidth: 140 },
						onChange: (e) => layout.onGroup(e.target.value)
					}, h("option", { value: "" }, "未分组"), layout.groups.map((g) => h("option", { key: g, value: g }, g))) : null,
					layout?.canMove ? h("span", { style: { ...S.row, gap: 2 } },
						h(Btn, { onClick: layout.onUp, disabled: layout.first, title: "上移" }, "↑"),
						h(Btn, { onClick: layout.onDown, disabled: layout.last, title: "下移" }, "↓")) : null,
					h(Btn, { onClick: () => setQuick((x) => !x), title: quick ? "收起快捷测试" : "直接测试当前服务商" }, quick ? "收起测试" : "快捷测试"),
					h(Btn, { onClick: () => setProxyOpen((x) => !x), title: proxyOpen ? "收起代理设置" : "展开代理设置" }, proxyOpen ? "收起代理" : "代理设置"),
					h(Btn, { onClick: onToggle, title: open ? "收起服务商管理" : "展开服务商管理" }, open ? "收起" : "管理"))),
			h("div", { style: { ...S.row, justifyContent: "space-between", marginTop: 4 } },
				h("span", { style: { ...S.mono, color: C.fg2 } }, str(v.baseURL) ?? "（未设置 baseURL）"),
				usage ? h("span", { style: { fontSize: 12, color: C.fg2 }, title: "近 30 天，不含测试调用" }, `近 30 天 ${usage.calls} 次 · ${fmtTok(usage.tokens)} tokens${Object.keys(usage.cost).length ? ` · ${fmtCostMap(usage.cost)}` : ""}`) : null),
			proxyOpen ? h(ProviderProxySettings, { p, m, api, data }) : null,
			quick ? h(ProviderQuickTest, { p, api, data }) : null,
			open ? h(React.Fragment, null,
				h(ProviderForm, { m, api, p }),
				h(ProviderAliasSettings, { p, m, data }),
				h(ModelsEditor, { m, api, p })) : null);
	}

	function ProviderQuickTest({ p, api, data }) {
		const configured = modelsSource(p).rows;
		const catalog = data.catalog?.groups?.find((g) => g.id === p.id)?.models ?? [];
		const all = [...new Map([...configured, ...catalog].filter((x) => x?.id).map((x) => [x.id, x])).values()];
		const [model, setModel] = useState(() => all[0]?.id ?? "");
		const [effort, setEffort] = useState("");
		const [prompt, setPrompt] = useState("Reply with exactly: OK");
		const [running, setRunning] = useState(false);
		const [result, setResult] = useState(null);
		const abort = useRef();
		useEffect(() => () => abort.current?.abort(), []);
		useEffect(() => { if (!all.some((x) => x.id === model)) setModel(all[0]?.id ?? ""); }, [p.id, all.map((x) => x.id).join("\u0000")]);
		const picked = all.find((x) => x.id === model);
		const efforts = picked?.reasoning?.efforts ?? [];
		const run = async () => {
			if (!model) return;
			abort.current?.abort();
			const ac = new AbortController();
			abort.current = ac;
			setRunning(true);
			setResult({ pending: true, provider: p.id, model });
			try {
				const out = await api.probe({ targets: [{ provider: p.id, model, ...(effort ? { reasoningEffort: effort } : {}) }], prompt: prompt.trim() || "Reply with exactly: OK", maxTokens: 256, timeoutMs: 60000, concurrency: 1, withInfo: true }, ac.signal);
				setResult(out?.results?.[0] ?? { ok: false, error: { code: "NO_RESULT", message: "服务商没有返回结果" } });
			} catch (e) {
				if (!ac.signal.aborted) setResult({ ok: false, error: { code: e.code ?? "ERROR", message: e.message ?? String(e) } });
			} finally {
				setRunning(false);
			}
		};
		return h("div", { style: { ...S.card, background: C.bg, marginTop: 12 } },
			h("div", { style: S.cardTitle }, "快捷测试"),
			h("div", { style: S.hint }, "只测试当前服务商的一个模型；详细耗时、token、错误码和模型元数据可到“测试/诊断”查看。"),
			all.length === 0 ? h("div", { style: S.warnBox }, "还没有模型。请先在下方模型列表点击“获取模型”，或手动添加模型 ID。") : h(React.Fragment, null,
				h("div", { style: { ...S.row, marginBottom: 8 } },
					h(Select, { value: model, onChange: (v) => { setModel(v); setEffort(""); }, options: all.map((x) => [x.id, x.name && x.name !== x.id ? `${x.name}（${x.id}）` : x.id]), ariaLabel: "快捷测试模型", style: { minWidth: 260 } }),
					h(Select, { value: effort, onChange: setEffort, options: [["", "模型默认"], ...efforts.map((e) => [e.id, effortLabel(e.id)])], ariaLabel: "快捷测试推理程度", style: { width: 180 } }),
				h(Btn, { kind: "primary", onClick: run, disabled: running || !model }, running ? "测试中…" : "发送测试请求")),
				h(TextInput, { value: prompt, onChange: setPrompt, ariaLabel: "快捷测试提示词", placeholder: "测试提示词", style: { width: "100%", marginBottom: 8 } }),
				result ? h("div", { style: { padding: "8px 10px", borderRadius: 8, background: C.l1, border: `1px solid ${C.b1}` } },
					h("div", { style: { ...S.row, justifyContent: "space-between" } }, h(StatusCell, { r: result }), result.reasoningEffort ? h("span", { style: S.chip }, effortLabel(result.reasoningEffort)) : null),
					h(DetailCell, { r: result }),
					result.modelInfo ? h("div", { style: { ...S.hint, margin: "4px 0 0" } }, `模型元数据：上下文 ${result.modelInfo.context?.contextWindow ?? result.modelInfo.contextWindow ?? "—"} · 推理档位 ${(result.modelInfo.levels ?? result.modelInfo.reasoning?.efforts?.map((x) => x.id) ?? []).join(" / ") || "无"}`) : null) : null));
	}

	function ProviderProxySettings({ p, m, api, data }) {
		const saved = rec(rec(data.own?.value).providerProxy)[p.id] ?? {};
		const [enabled, setEnabled] = useState(saved.enabled === true);
		const [url, setUrl] = useState(str(saved.url) ?? "");
		const [status, setStatus] = useState("");
		const [detecting, setDetecting] = useState(false);
		useEffect(() => {
			setEnabled(saved.enabled === true);
			setUrl(str(saved.url) ?? "");
		}, [p.id, saved.enabled, saved.url]);
		const detect = async () => {
			setDetecting(true);
			setStatus("");
			try {
				const out = await api.detectProxy();
				if (!out?.detected?.url) {
					setStatus("未检测到本地 HTTP 代理。请先启动代理，或手动填写地址和端口。");
					return;
				}
				setUrl(out.detected.url);
				setEnabled(true);
				setStatus(`已检测到代理：${out.detected.url}，保存后生效。`);
			} catch (error) {
				setStatus(error.message ?? String(error));
			} finally {
				setDetecting(false);
			}
		};
		const save = () => m.run("服务商代理设置已保存", async () => {
			const address = url.trim();
			if (enabled && !address) throw new Error("代理已开启，请先自动检测或填写代理地址");
			if (enabled) {
				let parsed;
				try { parsed = new URL(address); } catch { throw new Error("请填写 http:// 或 https:// 开头的代理地址"); }
				if (!["http:", "https:"].includes(parsed.protocol) || !parsed.port) throw new Error("代理地址必须包含端口，例如 http://127.0.0.1:7890");
			}
			await m.write(OWN_NS, [{ op: "set", path: ["providerProxy", p.id], value: { enabled, url: address } }]);
			setStatus(enabled ? "代理设置已保存；该服务商的模型调用、测试和模型发现将经此代理。" : "该服务商代理已关闭。");
		});
		return h("div", { style: { marginTop: 8, padding: "8px 0", borderTop: `1px solid ${C.b1}` } },
			h("div", { style: { ...S.row, gap: 8 } },
				h(Check, { checked: enabled, onChange: setEnabled, label: "本服务商使用本地代理" }),
				h(TextInput, { value: url, onChange: setUrl, placeholder: "http://127.0.0.1:7890", ariaLabel: `${p.id} 本地代理地址`, style: { minWidth: 250, flex: 1 } }),
				h(Btn, { onClick: detect, disabled: detecting || m.busy }, detecting ? "检测中…" : "自动检测"),
				h(Btn, { onClick: save, disabled: m.busy || !data.writable }, "保存")),
			status ? h("div", { style: { ...S.hint, color: /未检测到|请填写|无效|必须/.test(status) ? C.warn : C.fg2, marginTop: 4 } }, status) : null);
	}

	const managedKeyRef = (provider, key) => key.credentialRef || `MODEL_MANAGER_${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_${key.id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;

	async function saveKeyBindings(p, m, data, keys, discovered = []) {
		const refs = new Set();
		const aliases = new Map();
		for (const key of keys) {
			if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(key.id)) throw new Error("Key ID 格式无效");
			const ref = managedKeyRef(p.id, key);
			if (refs.has(ref)) throw new Error("Key ID 或凭据引用重复");
			refs.add(ref);
			if (!Number.isFinite(key.limit ?? 0) || (key.limit ?? 0) < 0) throw new Error("额度必须为非负数");
			for (const rule of key.models ?? []) {
				const parts = rule.split("=").map((x) => x.trim());
				if (parts.length > 2 || parts.some((x) => !x)) throw new Error("模型绑定格式无效");
				if (parts.length === 2) {
					if (parts.some((x) => x.includes("*")) || aliases.has(parts[0])) throw new Error("模型别名重复或包含通配符");
					aliases.set(parts[0], parts[1]);
				}
			}
		}
		const source = modelsSource(p);
		const catalog = data.catalog?.groups?.find((g) => g.id === p.id)?.models ?? [];
		const base = source.rows.length && source.mode === "models" ? source.rows : catalog.map((x) => clean({ id: x.id, name: x.name, input: x.inputModalities, ...rec(p.value.modelOverrides)[x.id] }));
		const models = [...base];
		for (const [alias, upstream] of aliases) {
			if (models.some((x) => x.id === alias)) continue;
			const found = discovered.find((x) => x.id === upstream);
			const original = base.find((x) => x.id === upstream) ?? (found ? clean({ id: found.id, name: found.name, contextWindow: found.contextWindow, maxTokens: found.maxTokens, input: defaultInputModalities(found.id, found.inputModalities), reasoningEfforts: found.reasoning?.efforts?.length ? Object.fromEntries(found.reasoning.efforts.map((e) => [e.id, e.id === "off" ? null : e.id])) : undefined }) : null);
			if (!original) throw new Error(`缺少上游模型 ${upstream} 的参数，请先把上游模型加入该服务商的模型列表`);
			// An alias speaks for the same upstream model, so it inherits its image capability.
			const inherited = defaultInputModalities(upstream, original.input);
			models.push(clean({ ...clone(original), id: alias, name: `${original.name || upstream} · ${keys.find((k) => k.models.some((r) => r.split("=")[0].trim() === alias))?.label || alias}`, ...(inherited ? { input: inherited } : {}) }));
		}
		const ops = [];
		if (aliases.size) {
			if (!p.value.baseURL || !APIS.some(([id]) => id === p.value.api)) throw new Error("模型分组需要 Base URL 和 HTTP 接口协议");
			if (p.value.transport && p.value.transport !== "sse") throw new Error("模型分组仅支持 SSE");
			ops.push({ op: "set", path: ["providers", p.id, "models"], value: models }, { op: "set", path: ["providers", p.id, "transport"], value: "sse" });
			if (Object.keys(rec(p.value.modelOverrides)).length) ops.push({ op: "unset", path: ["providers", p.id, "modelOverrides"] });
		}
		if (keys.length && !p.value.apiKeyEnv) ops.push({ op: "set", path: ["providers", p.id, "apiKeyEnv"], value: p.ref });
		if (ops.length) await m.write(LLM_NS, ops);
		await m.write(OWN_NS, [{ op: "set", path: ["providerKeys", p.id], value: { keys } }]);
	}

	function ProviderAliasSettings({ p, m, data }) {
		const saved = rec(rec(data.own?.value).providerKeys)[p.id]?.keys;
		const initial = () => (Array.isArray(saved) ? clone(saved) : []).map((k) => ({
			id: str(k.id) ?? "alias",
			label: str(k.label) ?? "",
			credentialRef: str(k.credentialRef) ?? "",
			models: Array.isArray(k.models) ? k.models.filter((r) => typeof r === "string") : []
		}));
		const [groups, setGroups] = useState(initial);
		const [draft, setDraft] = useState({ group: "", alias: "", upstream: "" });
		const ref = useRef(groups);
		ref.current = groups;
		useEffect(() => { setGroups(initial()); }, [p.id, JSON.stringify(saved)]);
		const persist = (list, okText) => m.run(okText, async () => { await saveKeyBindings(p, m, data, list); setGroups(list); });
		const dropModels = async (aliases) => {
			if (!aliases.size || !Array.isArray(p.value.models)) return;
			await m.write(LLM_NS, [{ op: "set", path: ["providers", p.id, "models"], value: p.value.models.filter((x) => !aliases.has(x.id)) }]);
		};
		const add = () => {
			const alias = draft.alias.trim();
			const upstream = draft.upstream.trim() || alias;
			const groupId = draft.group.trim() || `alias-${Date.now().toString(36)}`;
			if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(alias)) return m.notify("err", "别名只能包含字母、数字、-、_、.、:");
			if (alias === upstream) return m.notify("err", "别名与上游模型 ID 相同，不需要映射");
			const existing = ref.current.find((g) => g.id === groupId);
			if (existing?.models.includes(`${alias}=${upstream}`)) return m.notify("err", "这个别名已经存在");
			const list = existing
				? ref.current.map((g) => (g.id === groupId ? { ...g, models: [...g.models, `${alias}=${upstream}`] } : g))
				: [...ref.current, { id: groupId, label: draft.group.trim(), credentialRef: "", models: [`${alias}=${upstream}`] }];
			setDraft({ group: "", alias: "", upstream: "" });
			return persist(list, "模型别名已添加");
		};
		const removeRule = (group, rule) => m.run("模型别名已移除", async () => {
			await dropModels(new Set([rule.split("=")[0].trim()]));
			const list = ref.current.map((g) => (g.id === group.id ? { ...g, models: g.models.filter((r) => r !== rule) } : g));
			await saveKeyBindings(p, m, data, list);
			setGroups(list);
		});
		const removeGroup = (group) => {
			if (!window.confirm(`移除分组「${group.label || group.id}」及其 ${group.models.length} 个模型别名？`)) return;
			return m.run("分组已移除", async () => {
				await dropModels(new Set(group.models.map((r) => r.split("=")[0].trim())));
				const list = ref.current.filter((g) => g.id !== group.id);
				await saveKeyBindings(p, m, data, list);
				setGroups(list);
			});
		};
		return h("div", { style: { marginTop: 8, borderTop: `1px solid ${C.b1}`, paddingTop: 8 } },
			h("div", { style: S.cardTitle }, "模型别名（本地模型 → 上游模型）"),
			h("div", { style: S.hint }, "只改写发给服务商的模型 ID，不切换 API Key；服务商始终使用自己的单个密钥。"),
			groups.length === 0 ? h("div", { style: { fontSize: 12, color: C.fg2, margin: "6px 0" } }, "还没有模型别名，服务商直接使用自己的模型列表。") : null,
			groups.map((group) => h("div", { key: group.id, style: { padding: "10px 0", borderBottom: `1px solid ${C.b1}` } },
				h("div", { style: { ...S.row, justifyContent: "space-between" } },
					h("strong", null, group.label || group.id, h("span", { style: { fontWeight: 400, color: C.fg2, marginLeft: 6 } }, `${group.models.length} 个别名`)),
					h(Btn, { kind: "danger", onClick: () => removeGroup(group), disabled: m.busy || !data.writable }, "移除分组")),
				group.models.length === 0 ? h("span", { style: { fontSize: 12, color: C.fg2 } }, "（无绑定）") : null,
				h("div", { style: { marginTop: 4 } }, group.models.map((rule) => h("span", { key: rule, style: { ...S.chip, overflowWrap: "anywhere", maxWidth: "100%", display: "inline-flex", alignItems: "center", gap: 4 } }, rule, h(Btn, { onClick: () => removeRule(group, rule), title: "移除这个别名", disabled: m.busy || !data.writable }, "×")))))),
			h("div", { style: S.grid },
				h(Field, { label: "分组名称（留空自动新建）" }, h(TextInput, { value: draft.group, onChange: (v) => setDraft({ ...draft, group: v }), placeholder: "例如 cheap" })),
				h(Field, { label: "本地模型别名" }, h(TextInput, { value: draft.alias, onChange: (v) => setDraft({ ...draft, alias: v }), placeholder: "gpt-4o-0.05" })),
				h(Field, { label: "上游模型 ID" }, h(TextInput, { value: draft.upstream, onChange: (v) => setDraft({ ...draft, upstream: v }), placeholder: "gpt-4o" })),
				h("div", { style: { display: "flex", alignItems: "flex-end" } }, h(Btn, { kind: "primary", onClick: add, disabled: m.busy || !data.writable || !draft.alias.trim() }, "添加别名"))));
	}

	function providerIdFrom(displayName, baseURL) {
		const name = String(displayName ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
		if (name) return name.slice(0, 80);
		try {
			const host = new URL(String(baseURL ?? "")).hostname.toLowerCase().replace(/^www\./, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
			return host.slice(0, 80);
		} catch {
			return "provider";
		}
	}

	function ProviderForm({ m, api, p, isNew, onDone }) {
		const data = m.state.data;
		const v = p?.value ?? {};
		const [d, setD] = useState(() => ({
			id: "", displayName: str(v.displayName) ?? "", api: str(v.api) ?? "openai-completions", baseURL: str(v.baseURL) ?? "", modelId: "",
			apiKeyEnv: str(v.apiKeyEnv) ?? "", reasoning: v.reasoning === true, key: ""
		}));
		const set = (k) => (val) => setD((s) => ({ ...s, [k]: val }));
		const typedId = d.id.trim();
		const id = isNew ? (typedId || providerIdFrom(d.displayName, d.baseURL)) : p.id;
		const ref = d.apiKeyEnv.trim() || deriveRef(id || "PROVIDER");
		const cred = data.creds[p?.ref];
		const idError = isNew && !id ? "请填写服务商名称或 ID" : isNew && !/^[A-Za-z0-9][\w.-]*$/.test(id) ? "只能包含字母、数字、-、_、." : isNew && data.providers.some((x) => x.id === id) ? "已存在同名服务商" : undefined;
		const save = () => m.run(isNew ? `已新增服务商 ${id}` : "服务商已保存", async () => {
			if (isNew) {
				if (!id || idError) throw new Error(idError ?? "请填写服务商 ID");
				if (!d.baseURL.trim()) throw new Error("请填写 baseURL");
				const profile = { displayName: d.displayName.trim() || id, api: d.api, baseURL: d.baseURL.trim(), apiKeyEnv: ref };
				if (d.reasoning) profile.reasoning = true;
				let discovered = [];
				try {
					const entry = data.configurable.find((x) => x.provider === id);
					const out = await api.discoverProvider({ provider: id, baseURL: profile.baseURL, api: profile.api, apiKey: d.key.trim() || undefined, settingsNs: entry?.settingsNs ?? LLM_NS });
					discovered = Array.isArray(out?.models) ? out.models : [];
				} catch {}
				if (!discovered.length && d.modelId.trim()) discovered = [{ id: d.modelId.trim(), name: d.modelId.trim() }];
				if (discovered.length) profile.models = discovered.map((x) => clean({
					id: x.id, name: x.name ?? x.id, contextWindow: x.contextWindow, maxTokens: x.maxTokens,
					input: defaultInputModalities(x.id, x.inputModalities),
					reasoningEfforts: Array.isArray(x.reasoning?.efforts) && x.reasoning.efforts.length ? Object.fromEntries(x.reasoning.efforts.map((e) => [e.id, e.id === "off" ? null : e.id])) : undefined
				}));
				await m.write(LLM_NS, [{ op: "set", path: ["providers", id], value: profile }]);
			} else {
				const ops = [];
				for (const f of ["displayName", "api", "baseURL", "apiKeyEnv"]) {
					const next = d[f].trim();
					if (next !== (str(v[f]) ?? "")) ops.push(next ? { op: "set", path: ["providers", id, f], value: next } : { op: "unset", path: ["providers", id, f] });
				}
				if (d.reasoning !== (v.reasoning === true)) ops.push({ op: "set", path: ["providers", id, "reasoning"], value: d.reasoning });
				if (ops.length) await m.write(LLM_NS, ops);
			}
			if (d.key.trim()) await api.credSet(ref, d.key.trim());
			setD((s) => ({ ...s, key: "" }));
			if (isNew) onDone?.(id);
		});

		const clearKey = () => {
			if (!window.confirm(`清除已保存的密钥 ${p.ref}？`)) return;
			m.run("密钥已清除", () => api.credUnset(p.ref));
		};
		const remove = () => {
			const tip = p.inBase ? "此服务商来自内置配置，删除只会移除你的覆盖。" : "将从配置中删除此服务商及其模型列表（密钥保留）。";
			if (!window.confirm(`删除服务商 ${p.id}？\n${tip}`)) return;
			m.run(`已删除 ${p.id}`, () => m.write(LLM_NS, [{ op: "unset", path: ["providers", p.id] }]));
		};

		return h("div", { style: { ...S.card, background: C.bg, marginTop: 12 } },
				h("div", { style: S.cardTitle }, isNew ? "新增服务商" : "连接设置"),
			h("div", { style: S.grid },
				isNew ? h(Field, { label: idError ? `服务商 ID（${idError}）` : "服务商 ID（可留空，按名称自动生成）" }, h(TextInput, { value: d.id, onChange: set("id"), placeholder: "可留空，例如 myapi" })) : null,
				h(Field, { label: "显示名称" }, h(TextInput, { value: d.displayName, onChange: set("displayName"), placeholder: id })),
				h(Field, { label: "接口协议" }, h(Select, { value: d.api, onChange: set("api"), options: APIS })),
				h(Field, { label: "Base URL", wide: true }, h(TextInput, { value: d.baseURL, onChange: set("baseURL"), placeholder: "https://api.example.com/v1" })),
				isNew ? h(Field, { label: "初始模型 ID（可选，列表获取不到时使用）" }, h(TextInput, { value: d.modelId, onChange: set("modelId"), placeholder: "例如 deepseek-chat" })) : null,
				h(Field, { label: "密钥变量名（apiKeyEnv）" }, h(TextInput, { value: d.apiKeyEnv, onChange: set("apiKeyEnv"), placeholder: ref })),
				h(Field, { label: cred?.configured ? "API Key（已配置，留空则不修改）" : "API Key" },
					h(TextInput, { type: "password", value: d.key, onChange: set("key"), placeholder: cred?.writable === false ? "由环境变量提供，不可在此修改" : "sk-...", disabled: cred?.writable === false }))),
			h("div", { style: { ...S.row, justifyContent: "space-between" } },
				h(Check, { checked: d.reasoning, onChange: set("reasoning"), label: "服务商支持推理（reasoning）" }),
				h("div", { style: S.row },
					!isNew && cred?.configured && cred?.writable !== false ? h(Btn, { onClick: clearKey, disabled: m.busy }, "清除密钥") : null,
					!isNew ? h(Btn, { kind: "danger", onClick: remove, disabled: m.busy || !data.writable }, "删除服务商") : null,
					h(Btn, { kind: "primary", onClick: save, disabled: m.busy || !data.writable }, isNew ? "创建" : "保存连接设置"))),
			h("div", { style: S.hint }, "密钥通过 DSH 凭据服务保存，不会写进配置文件，也不会回传到页面。"));
	}

	// ---------------------------------------------------------------- models editor
	function modelsSource(p) {
		const userModels = Array.isArray(p.user?.models) ? p.user.models : undefined;
		const models = userModels ?? (Array.isArray(p.value.models) ? p.value.models : []);
		const overrides = rec(p.user?.modelOverrides ?? p.value.modelOverrides);
		if (models.length === 0 && Object.keys(overrides).length > 0) {
			return { mode: "overrides", rows: Object.entries(overrides).map(([id, o]) => ({ id, ...clone(rec(o)) })) };
		}
		return { mode: "models", rows: clone(models).filter(isRec) };
	}

	function ModelsEditor({ m, api, p }) {
		const data = m.state.data;
		const source = useMemo(() => modelsSource(p), [p]);
		const [rows, setRows] = useState(source.rows);
		const [dirty, setDirty] = useState(false);
		const [expanded, setExpanded] = useState(null);
		const [preset, setPreset] = useState("extended");
		const [newId, setNewId] = useState("");
		const [found, setFound] = useState(null);
		const [discovering, setDiscovering] = useState(false);
		useEffect(() => { if (!dirty) setRows(source.rows); }, [source, dirty]);

		const update = (next) => { setRows(next); setDirty(true); };
		const adaptiveList = Array.isArray(rec(rec(data.own?.value).adaptiveModels)[p.id]) ? rec(rec(data.own?.value).adaptiveModels)[p.id] : [];
		const toggleAdaptive = (id, on) => m.run(on ? `${id} 改用 adaptive thinking` : `${id} 恢复默认思考方式`, () => {
			const current = rec(rec(data.own?.value).adaptiveModels);
			const list = Array.isArray(current[p.id]) ? current[p.id] : [];
			const next = on ? [...new Set([...list, id])] : list.filter((x) => x !== id);
			return m.write(OWN_NS, [{ op: "set", path: ["adaptiveModels", p.id], value: next }]);
		});
		const patchRow = (i, patch) => update(rows.map((r, j) => (j === i ? clean({ ...r, ...patch }) : r)));
		const applyPreset = () => {
			const levels = PRESETS.find((x) => x[0] === preset)[2];
			update(rows.map((r) => clean({ ...r, reasoningEfforts: effortsFromPreset(levels) })));
		};
		const addManual = () => {
			const id = newId.trim();
			if (!id) return;
			if (rows.some((r) => r.id === id)) return m.notify("err", `模型 ${id} 已存在`);
			update([...rows, source.mode === "overrides" ? { id } : { id, name: id }]);
			setNewId("");
		};
		const discover = async () => {
			setDiscovering(true);
			try {
				const entry = data.configurable.find((x) => x.provider === p.id);
				const out = await api.discoverProvider({ provider: p.id, baseURL: p.value.baseURL, api: p.value.api, settingsNs: entry?.settingsNs ?? LLM_NS });
				const list = Array.isArray(out?.models) ? out.models : [];
				const have = new Set(rows.map((r) => r.id));
				setFound(list.map((x) => ({ ...x, pick: !have.has(x.id), exists: have.has(x.id) })));
				if (list.length === 0) m.notify("err", "服务商没有返回任何模型；请确认 Base URL、接口协议和 API Key");
			} catch (e) {
				m.notify("err", `发现模型失败：${e.message}`);
			} finally {
				setDiscovering(false);
			}
		};
		const addFound = () => {
			const levels = PRESETS.find((x) => x[0] === preset)[2];
			const picked = found.filter((x) => x.pick && !x.exists).map((x) => clean({
				id: x.id, name: x.name ?? x.id, contextWindow: x.contextWindow, maxTokens: x.maxTokens,
				input: Array.isArray(x.inputModalities) ? x.inputModalities : undefined,
				reasoningEfforts: Array.isArray(x.reasoning?.efforts) && x.reasoning.efforts.length ? Object.fromEntries(x.reasoning.efforts.map((e) => [e.id, e.id === "off" ? null : e.id])) : p.value.reasoning === true ? effortsFromPreset(levels) : undefined
			}));
			update([...rows, ...picked]);
			setFound(null);
		};
		const save = () => m.run("模型列表已保存", async () => {
			// Make the inferred image capability explicit, so the saved config matches
			// what the checkbox showed.
			const filled = rows.map((r) => (Array.isArray(r.input) && r.input.length ? r : clean({ ...r, input: defaultInputModalities(r.id, undefined) })));
			if (source.mode === "overrides") {
				const value = {};
				for (const { id, ...rest } of filled) value[id] = rest;
				await m.write(LLM_NS, [{ op: "set", path: ["providers", p.id, "modelOverrides"], value }]);
			} else {
				await m.write(LLM_NS, [{ op: "set", path: ["providers", p.id, "models"], value: filled }]);
			}
			setDirty(false);
		});

		/** Saved price for one model of this provider, keyed `provider/model`. */
		const savedPrices = rec(rec(data.own?.value).usagePrices);
		const priceKeyOf = (modelId) => `${p.id}/${modelId}`;
		/** Persist (or delete) one model price straight from the model editor. */
		const saveModelPrice = (modelId, value) => {
			const path = ["usagePrices", priceKeyOf(modelId)];
			return m.run(value ? `${modelId} 的单价已保存` : `${modelId} 的单价已删除`, () => m.write(OWN_NS, [value ? { op: "set", path, value } : { op: "unset", path }]));
		};

		return h("div", { style: { ...S.card, background: C.bg } },
			h("div", { style: { ...S.row, justifyContent: "space-between" } },
				h("div", null,
					h("div", { style: S.cardTitle }, source.mode === "overrides" ? "模型覆盖（modelOverrides）" : "模型列表"),
					h("div", { style: S.hint }, "推理档位决定这个模型可选的推理程度，以及每一档实际发送给服务商的值。")),
				h("div", { style: S.row },
					h(Select, { value: preset, onChange: setPreset, options: PRESETS.map(([k, l]) => [k, l]), ariaLabel: "推理预设", style: { width: 220 } }),
					h(Btn, { onClick: applyPreset, disabled: rows.length === 0 }, "应用到全部模型"),
					h(Btn, { onClick: discover, disabled: discovering }, discovering ? "获取中…" : "获取模型"))),
			found ? h(DiscoverList, { found, setFound, onAdd: addFound, onCancel: () => setFound(null) }) : null,
			rows.length === 0 ? h("div", { style: { color: C.fg2, padding: "8px 0" } }, "暂无模型。可以自动发现，或在下方手动添加。") :
				h("table", { style: S.table },
					h("thead", null, h("tr", null,
						["模型 ID", "名称", "上下文", "最大输出", "推理档位", ""].map((t) => h("th", { key: t, style: S.th }, t)))),
					h("tbody", null, rows.map((r, i) => h(React.Fragment, { key: r.id },
						h("tr", null,
							h("td", { style: { ...S.td, ...S.mono } }, r.id),
							h("td", { style: S.td }, r.name ?? ""),
							h("td", { style: S.td }, r.contextWindow ?? "—"),
							h("td", { style: S.td }, r.maxTokens ?? "—"),
							h("td", { style: S.td }, h(EffortChips, { efforts: r.reasoningEfforts })),
							h("td", { style: { ...S.td, textAlign: "right", whiteSpace: "nowrap" } },
								h(Btn, { onClick: () => setExpanded(expanded === r.id ? null : r.id) }, expanded === r.id ? "收起" : "编辑"), " ",
								h(Btn, { kind: "danger", onClick: () => { update(rows.filter((_, j) => j !== i)); } }, "移除"))),
						expanded === r.id ? h("tr", null, h("td", { colSpan: 6, style: { ...S.td, background: C.l1 } },
							h(ModelRowEditor, { row: r, mode: source.mode, adaptive: adaptiveList.includes(r.id), onAdaptive: (on) => toggleAdaptive(r.id, on), price: savedPrices[priceKeyOf(r.id)], priceKey: priceKeyOf(r.id), onSavePrice: (value) => saveModelPrice(r.id, value), onError: (msg) => m.notify("err", msg), disabled: m.busy || !data.writable, onChange: (patch) => patchRow(i, patch) }))) : null)))),
			h("div", { style: { ...S.row, justifyContent: "space-between", marginTop: 12 } },
				h("div", { style: S.row },
					h(TextInput, { value: newId, onChange: setNewId, placeholder: "手动添加模型 ID", ariaLabel: "新模型 ID", style: { width: 220 } }),
					h(Btn, { onClick: addManual, disabled: !newId.trim() }, "添加")),
				h("div", { style: S.row },
					dirty ? h("span", { style: { color: C.warn } }, "有未保存的修改") : null,
					dirty ? h(Btn, { onClick: () => { setRows(source.rows); setDirty(false); } }, "放弃") : null,
					h(Btn, { kind: "primary", onClick: save, disabled: !dirty || m.busy || !data.writable }, "保存模型列表"))));
	}

	/** Drop undefined/empty fields so saved YAML stays minimal. */
	function clean(row) {
		const out = {};
		for (const [k, v] of Object.entries(row)) {
			if (v === undefined || v === "") continue;
			if (isRec(v) && Object.keys(v).length === 0 && k === "reasoningEfforts") continue;
			out[k] = v;
		}
		return out;
	}

	function DiscoverList({ found, setFound, onAdd, onCancel }) {
		const toggleAll = (on) => setFound(found.map((x) => (x.exists ? x : { ...x, pick: on })));
		const count = found.filter((x) => x.pick && !x.exists).length;
		return h("div", { style: { ...S.card, marginTop: 8 } },
			h("div", { style: { ...S.row, justifyContent: "space-between" } },
				h("strong", null, `发现 ${found.length} 个模型`),
				h("div", { style: S.row },
					h(Btn, { onClick: () => toggleAll(true) }, "全选"),
					h(Btn, { onClick: () => toggleAll(false) }, "全不选"),
					h(Btn, { onClick: onCancel }, "取消"),
					h(Btn, { kind: "primary", onClick: onAdd, disabled: count === 0 }, `添加 ${count} 个`))),
			h("div", { style: { maxHeight: 260, overflow: "auto", marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 4 } },
				found.map((x, i) => h(Check, {
					key: x.id, checked: x.pick || x.exists, disabled: x.exists,
					onChange: (on) => setFound(found.map((y, j) => (j === i ? { ...y, pick: on } : y))),
					label: h("span", { style: S.mono }, x.id, x.exists ? "（已存在）" : "")
				}))),
			h("div", { style: S.hint }, "新添加的模型会套用上方选择的推理预设（服务商开启推理时）。"));
	}

	function ModelRowEditor({ row, mode, adaptive, onAdaptive, price, priceKey, onSavePrice, onError, disabled, onChange }) {
		const [priceFields, setPriceFields] = useState(() => priceDraft(price));
		useEffect(() => { setPriceFields(priceDraft(price)); }, [priceKey, JSON.stringify(price ?? null)]);
		const setPriceField = (f, v) => setPriceFields((s) => ({ ...s, [f]: v }));
		/** Save the price typed beside the reasoning levels; empty fields clear it. */
		const commitPrice = () => {
			try {
				const value = priceValue(priceKey, { ...priceFields, mode: "token" });
				onSavePrice(value ?? null);
			} catch (error) {
				onError?.(error.message ?? String(error));
			}
		};
		const efforts = rec(row.reasoningEfforts);
		const setEffort = (level, enabled, wire) => {
			const next = { ...efforts };
			if (!enabled) delete next[level];
			else next[level] = level === "off" ? null : (wire ?? (typeof efforts[level] === "string" ? efforts[level] : level));
			const ordered = {};
			for (const l of LEVELS) if (l in next) ordered[l] = next[l];
			onChange({ reasoningEfforts: Object.keys(ordered).length ? ordered : undefined });
		};
		const input = Array.isArray(row.input) ? row.input : undefined;
		// Nothing saved yet: fall back to the family table so common vision models
		// arrive checked instead of silently text-only.
		const imageInput = Array.isArray(input) ? input.includes("image") : inferredImage(row.id);
		return h("div", null,
			h("div", { style: S.grid },
				h(Field, { label: "显示名称" }, h(TextInput, { value: row.name ?? "", onChange: (v) => onChange({ name: v || undefined }) })),
				h(Field, { label: "上下文窗口（tokens）" }, h(TextInput, { value: row.contextWindow ?? "", onChange: (v) => onChange({ contextWindow: toInt(v) }), placeholder: "继承服务商默认" })),
				h(Field, { label: "最大输出（tokens）" }, h(TextInput, { value: row.maxTokens ?? "", onChange: (v) => onChange({ maxTokens: toInt(v) }), placeholder: "继承服务商默认" })),
				mode === "models" ? h(Field, { label: "输入模态" }, h(Check, {
					checked: imageInput, label: Array.isArray(input) ? "支持图片输入" : "支持图片输入（按模型名推断，保存后固定）",
					onChange: (on) => onChange({ input: on ? ["text", "image"] : ["text"] })
				})) : null,
				h(Field, { label: "Anthropic 思考方式", wide: true }, h(Check, {
					checked: adaptive === true,
					label: "使用 adaptive thinking（该模型报 “requires adaptive thinking” 时勾选；推理档位照常可选，插件会把 thinking 改写成 adaptive + output_config.effort）",
					onChange: (on) => onAdaptive(on)
				}))),
			h("div", { style: { fontSize: 12, color: C.fg2, margin: "4px 0" } }, "推理档位（勾选启用；右侧为实际发送值，留空等于档位名）"),
			h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 6 } },
				LEVELS.map((l) => h("div", { key: l, style: { ...S.row, flexWrap: "nowrap" } },
					h(Check, { checked: l in efforts, onChange: (on) => setEffort(l, on), label: h("span", { style: { width: 48, display: "inline-block" } }, LEVEL_LABEL[l]) }),
					l === "off" ? h("span", { style: { color: C.fg2, fontSize: 12 } }, "不发送推理参数") :
						h(TextInput, { value: typeof efforts[l] === "string" ? efforts[l] : "", disabled: !(l in efforts), placeholder: l, ariaLabel: `${LEVEL_LABEL[l]} 发送值`, style: { width: 110 },
							onChange: (v) => setEffort(l, true, v.trim() || l) })))),
			h("div", { style: { marginTop: 10, paddingTop: 8, borderTop: `1px solid ${C.b1}` } },
				h("div", { style: { fontSize: 12, color: C.fg2, marginBottom: 4 } },
					`价格（用于估算费用，每百万 tokens）${price ? " · 已配置" : ""}`),
				h("div", { style: { ...S.row, gap: 10 } },
					PRICE_FIELDS.map(([f, label]) => h("label", { key: f, style: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: C.fg2 } },
						label, h(TextInput, {
							value: priceFields[f] ?? "", onChange: (v) => setPriceField(f, v), ariaLabel: `${row.id} ${label}单价`,
							placeholder: f === "input" || f === "output" ? "0" : "同输入", style: { width: 76 }
						}))),
					h(Select, { value: priceFields.currency, onChange: (v) => setPriceField("currency", v), options: CURRENCIES, ariaLabel: `${row.id} 币种`, style: { width: 100 } }),
					h(Btn, { kind: "primary", onClick: commitPrice, disabled }, price ? "保存价格" : "添加价格"),
					price ? h(Btn, { kind: "danger", onClick: () => onSavePrice(null), disabled }, "删除价格") : null)));
	}

	// ---------------------------------------------------------------- default model tab
	const catalogModels = (catalog) => (catalog?.groups ?? []).flatMap((g) => (g.models ?? []).map((md) => ({ provider: g.id, providerName: g.name, ...md })));
	const keyOf = (provider, model) => `${provider}\u0000${model}`;

	function ModelSelect({ catalog, value, onChange, ariaLabel, extra }) {
		const groups = catalog?.groups ?? [];
		return h("select", { value, "aria-label": ariaLabel, style: { ...S.input, minWidth: 280 }, onChange: (e) => onChange(e.target.value) },
			extra ? h("option", { value: "" }, extra) : null,
			groups.map((g) => h("optgroup", { key: g.id, label: g.name || g.id },
				(g.models ?? []).map((md) => h("option", { key: md.id, value: keyOf(g.id, md.id) }, md.name && md.name !== md.id ? `${md.name}（${md.id}）` : md.id)))));
	}

	function DefaultTab({ m }) {
		const data = m.state.data;
		const view = findView(data.desc, DEFAULT_NS);
		const cur = rec(view?.value);
		const fallback = rec(data.catalog?.default);
		const [sel, setSel] = useState(() => keyOf(str(cur.provider) ?? fallback.provider ?? "", str(cur.model) ?? fallback.model ?? ""));
		const [effort, setEffort] = useState(() => str(cur.reasoningEffort) ?? "high");
		const all = catalogModels(data.catalog);
		const [provider, model] = sel.split("\u0000");
		const picked = all.find((x) => x.provider === provider && x.id === model);
		const efforts = picked?.reasoning?.efforts ?? [];
		const effortChoices = efforts.length ? efforts : picked?.reasoning ? LEVELS.map((id) => ({ id, name: LEVEL_LABEL[id] ?? id })) : [];
		const save = () => m.run("默认模型已保存", () => m.write(DEFAULT_NS, [
			{ op: "set", path: ["provider"], value: provider },
			{ op: "set", path: ["model"], value: model },
			effort ? { op: "set", path: ["reasoningEffort"], value: effort } : { op: "unset", path: ["reasoningEffort"] }
		]));
		if (!data.catalog) return h("div", { style: S.card }, `模型目录读取失败：${data.catalogError ?? "未知错误"}`);
		return h(React.Fragment, null,
			h("div", { style: S.card },
				h("div", { style: S.cardTitle }, "主代理默认模型与推理程度"),
				h("div", { style: S.hint }, "主代理新建会话时使用的模型和推理程度。已有会话可在输入框旁单独切换。"),
				!view ? h("div", { style: S.warnBox }, "未找到 agent-default-model 设置分区，无法保存。") : null,
				h("div", { style: { ...S.row, marginTop: 8 } },
					h(ModelSelect, { catalog: data.catalog, value: sel, onChange: (v) => { setSel(v); setEffort("high"); }, ariaLabel: "默认模型" }),
					h(Select, {
						value: effort, onChange: setEffort, ariaLabel: "默认推理程度", style: { width: 160 },
						options: [["high", "高（默认）"], ["", picked?.reasoning?.defaultEffort ? `模型默认（${picked.reasoning.defaultEffort}）` : "模型默认"], ...effortChoices.filter((e) => e.id !== "high").map((e) => [e.id, e.name || e.id])]
					}),
					h(Btn, { kind: "primary", onClick: save, disabled: m.busy || !view || !picked }, "保存"))),
			h("div", { style: S.card },
				h("div", { style: S.cardTitle }, "当前可用模型"),
				data.catalog.failures?.length ? h("div", { style: S.warnBox }, data.catalog.failures.map((f) => `${f.name || f.id}：${f.message}`).join("；")) : null,
				h("table", { style: S.table },
					h("thead", null, h("tr", null, ["服务商", "模型", "可选推理程度"].map((t) => h("th", { key: t, style: S.th }, t)))),
					h("tbody", null, all.map((x) => h("tr", { key: keyOf(x.provider, x.id) },
						h("td", { style: S.td }, x.providerName || x.provider),
						h("td", { style: { ...S.td, ...S.mono } }, x.id),
						h("td", { style: S.td }, (x.reasoning?.efforts ?? []).map((e) => h("span", { key: e.id, style: S.chip }, e.name || e.id)))))))));
	}

	// ---------------------------------------------------------------- subagent tab
	function SubagentTab({ m }) {
		const data = m.state.data;
		return h(React.Fragment, null,
			h(SubagentEffortCard, { m, data }),
			h(ConcurrencyCard, { m, data }),
			h(SelectionCard, { m, data }));
	}

	function SubagentEffortCard({ m, data }) {
		const own = findView(data.desc, OWN_NS);
		const te = findView(data.desc, TE_NS);
		const v = rec(own?.value);
		const [effort, setEffort] = useState(() => str(v.subagentEffort) ?? "");
		const [mode, setMode] = useState(() => (v.subagentMode === "fill" ? "fill" : "force"));
		const [clamp, setClamp] = useState(() => v.clampToModel !== false);
		const [perModel, setPerModel] = useState(() => ({ ...rec(v.subagentModelEfforts) }));
		const teEffort = str(rec(te?.user).subagentEffort) ?? str(rec(te?.value).subagentEffort);
		const all = catalogModels(data.catalog);
		const levelOptions = (first) => [["", first], ...LEVELS.map((l) => [l, `${LEVEL_LABEL[l]}（${l}）`])];

		const save = () => m.run("子代理推理设置已保存", () => {
			const dict = {};
			for (const [k, val] of Object.entries(perModel)) if (str(val)) dict[k] = val;
			return m.write(OWN_NS, [
				effort ? { op: "set", path: ["subagentEffort"], value: effort } : { op: "set", path: ["subagentEffort"], value: "" },
				{ op: "set", path: ["subagentMode"], value: mode },
				{ op: "set", path: ["clampToModel"], value: clamp },
				{ op: "set", path: ["subagentModelEfforts"], value: dict }
			]);
		});
		const clearTe = () => m.run("已清除 thinking-effort 的子代理设置", () => m.write(TE_NS, [{ op: "unset", path: ["subagentEffort"] }]));

		if (!own) return h("div", { style: S.card },
			h("div", { style: S.cardTitle }, "子代理默认推理程度"),
			h("div", { style: S.warnBox }, "主机端插件尚未加载（未找到 model-manager 设置分区）。安装后需重启 DSH 一次。"));

		return h("div", { style: S.card },
			h("div", { style: S.cardTitle }, "子代理默认推理程度"),
			h("div", { style: S.hint }, "对所有子代理（subagent / fork）的模型请求生效，主代理不受影响。"),
			teEffort && mode === "force" ? h("div", { style: S.warnBox },
				`thinking-effort 插件也设置了子代理推理程度（${teEffort}）。强制模式下以本页设置为准；如需避免混淆可清除它。 `,
				h(Btn, { onClick: clearTe, disabled: m.busy }, "清除 thinking-effort 设置")) : null,
			h("div", { style: S.grid },
				h(Field, { label: "统一推理程度" }, h(Select, { value: effort, onChange: setEffort, options: levelOptions("不干预（沿用模型/会话设置）") })),
				h(Field, { label: "生效方式" }, h(Select, { value: mode, onChange: setMode, options: [["force", "强制覆盖（推荐）"], ["fill", "仅在未指定时填充"]] })),
				h(Field, { label: "兼容处理" }, h(Check, { checked: clamp, onChange: setClamp, label: "模型不支持时自动选最接近的档位" }))),
			all.length ? h("details", { style: { marginTop: 6 } },
				h("summary", { style: { cursor: "pointer", color: C.fg2 } }, `按模型单独指定（${Object.values(perModel).filter(str).length} 项）`),
				h("table", { style: { ...S.table, marginTop: 8 } },
					h("thead", null, h("tr", null, ["模型", "支持的档位", "子代理推理程度"].map((t) => h("th", { key: t, style: S.th }, t)))),
					h("tbody", null, all.map((x) => {
						const k = `${x.provider}/${x.id}`;
						return h("tr", { key: k },
							h("td", { style: { ...S.td, ...S.mono } }, k),
							h("td", { style: S.td }, (x.reasoning?.efforts ?? []).map((e) => e.id).join(" / ") || "—"),
							h("td", { style: S.td }, h(Select, { value: perModel[k] ?? "", ariaLabel: `${k} 子代理推理程度`, style: { width: 180 },
								onChange: (val) => setPerModel((s) => ({ ...s, [k]: val })), options: levelOptions("跟随统一设置") })));
					})))) : null,
			h("div", { style: { ...S.row, justifyContent: "flex-end", marginTop: 10 } },
				h(Btn, { kind: "primary", onClick: save, disabled: m.busy }, "保存子代理推理设置")));
	}

	function ConcurrencyCard({ m, data }) {
		const view = findView(data.desc, SUBAGENT_NS);
		const v = rec(view?.value);
		const [active, setActive] = useState(() => String(v.maxActiveSubagents ?? 8));
		const [depth, setDepth] = useState(() => String(v.maxDepth ?? 1));
		const a = toInt(active);
		const d = toInt(depth);
		const valid = a !== undefined && a >= 1 && d !== undefined && d >= 0;
		const save = () => m.run("并发设置已保存", () => m.write(SUBAGENT_NS, [
			{ op: "set", path: ["maxActiveSubagents"], value: a },
			{ op: "set", path: ["maxDepth"], value: d }
		]));
		return h("div", { style: S.card },
			h("div", { style: S.cardTitle }, "子代理并发"),
			h("div", { style: S.hint }, "同时运行的子代理越多，并行任务完成越快；消耗也会相应增加。"),
			!view ? h("div", { style: S.warnBox }, "未找到 subagent 设置分区。") : null,
			h("div", { style: S.grid },
				h(Field, { label: "最大同时运行数（≥1）" }, h(TextInput, { value: active, onChange: setActive })),
				h(Field, { label: "最大嵌套深度（0 = 子代理不能再派生）" }, h(TextInput, { value: depth, onChange: setDepth }))),
			h("div", { style: { ...S.row, justifyContent: "space-between" } },
				h("div", { style: S.row },
					h("span", { style: { color: C.fg2 } }, "效率预设："),
					[8, 16, 32].map((n) => h(Btn, { key: n, onClick: () => setActive(String(n)) }, `${n} 并发`)),
					h(Btn, { onClick: () => setDepth("2") }, "允许 2 层嵌套")),
				h(Btn, { kind: "primary", onClick: save, disabled: m.busy || !view || !valid }, "保存并发设置")));
	}

	function SelectionCard({ m, data }) {
		const view = findView(data.desc, SELECTION_NS);
		const v = rec(view?.value);
		const [enabled, setEnabled] = useState(() => v.enabled === true);
		const [allowed, setAllowed] = useState(() => new Set((Array.isArray(v.allowedModels) ? v.allowedModels : []).map((x) => `${x.provider}/${x.model}`)));
		const all = catalogModels(data.catalog);
		const toggle = (k, on) => setAllowed((s) => { const n = new Set(s); on ? n.add(k) : n.delete(k); return n; });
		const save = () => m.run("子代理可选模型已保存", () => {
			const list = all.filter((x) => allowed.has(`${x.provider}/${x.id}`)).map((x) => ({ provider: x.provider, model: x.id }));
			return m.write(SELECTION_NS, [{ op: "set", path: ["enabled"], value: enabled }, { op: "set", path: ["allowedModels"], value: list }]);
		});
		if (!view) return null;
		return h("div", { style: S.card },
			h("div", { style: S.cardTitle }, "子代理可选模型"),
			h("div", { style: S.hint }, "开启后，主代理派生子代理时可以从这些模型中挑选（例如把简单任务交给更快的模型）。"),
			h(Check, { checked: enabled, onChange: setEnabled, label: "允许子代理选择模型" }),
			enabled ? h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 4, margin: "8px 0" } },
				all.map((x) => {
					const k = `${x.provider}/${x.id}`;
					return h(Check, { key: k, checked: allowed.has(k), onChange: (on) => toggle(k, on), label: h("span", { style: S.mono }, k) });
				})) : null,
			h("div", { style: { ...S.row, justifyContent: "flex-end" } },
				h(Btn, { kind: "primary", onClick: save, disabled: m.busy || (enabled && allowed.size === 0) }, "保存")));
	}

	// ---------------------------------------------------------------- diagnostics tab
	const fmtMs = (ms) => (typeof ms !== "number" ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);
	const pct = (arr, p) => {
		const xs = arr.filter((x) => typeof x === "number").sort((a, b) => a - b);
		if (xs.length === 0) return undefined;
		return xs[Math.min(xs.length - 1, Math.max(0, Math.ceil((p / 100) * xs.length) - 1))];
	};
	const rowId = (t) => `${t.provider}/${t.model}@${t.reasoningEffort ?? ""}`;
	const uuid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `mm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
	const ERROR_HINT = {
		MISSING_CREDENTIAL: "未配置 API 密钥",
		INVALID_CREDENTIAL: "密钥格式无效",
		AUTH: "鉴权失败：密钥错误或无权限",
		RATE_LIMIT: "触发限流，稍后再试或降低并发",
		QUOTA: "额度不足",
		ACCOUNT_QUOTA: "账户余额/额度不足",
		NO_ADAPTER: "找不到该服务商的适配器（服务商配置或 API 类型有误）",
		CONTEXT_WINDOW_EXCEEDED: "超出上下文窗口",
		TIMEOUT: "超时：服务商无响应或网络不通",
		ABORTED: "已取消",
		EMPTY_RESPONSE: "服务商返回了空响应",
		NO_HOST_ROUTE: "主机端未加载，请重启 DSH"
	};
	const hintOf = (code) => ERROR_HINT[code] ?? (/EFFORT/i.test(code ?? "") ? "该模型不接受此推理档位" : undefined);
	const RULE_TEXT = {
		"no-setting": "未设置子代理推理程度，不干预",
		"fill-kept": "仅填充模式：请求已带推理程度，保持不变",
		"no-reasoning": "模型不支持推理档位，不写入",
		forced: "强制写入（未做兼容处理）",
		applied: "按设置写入",
		clamped: "模型不支持所选档位，已换成最接近的档位",
		error: "插件处理出错，保持原值"
	};
	const SOURCE_TEXT = { model: "模型元数据", settings: "服务商配置", unknown: "未知" };
	const effortLabel = (e) => (e ? `${LEVEL_LABEL[e] ?? e}（${e}）` : "模型默认");

	function StatusCell({ r }) {
		if (!r) return h("span", { style: { color: C.fg2 } }, "—");
		if (r.pending) return h("span", { style: { color: C.fg2 } }, h("span", { style: S.dot(C.idle) }), "测试中…");
		if (r.ok) return h("span", { style: { color: r.empty ? C.warn : C.ok } }, h("span", { style: S.dot(r.empty ? C.warn : C.ok) }), r.empty ? "已连通（空回复）" : r.finish === "max-tokens" ? "已连通（达到长度上限）" : "已连通");
		const code = r.error?.code ?? "ERROR";
		return h("span", { style: { color: C.err }, title: r.error?.message }, h("span", { style: S.dot(C.err) }), `失败 · ${code}${r.error?.status ? ` (${r.error.status})` : ""}`);
	}

	function DetailCell({ r }) {
		if (!r || r.pending) return null;
		if (!r.ok) return h("div", { style: { color: C.err, maxWidth: 420, wordBreak: "break-word" } }, hintOf(r.error?.code) ? h("div", null, hintOf(r.error.code)) : null, h("div", { style: { ...S.mono, color: C.fg2 } }, r.error?.message));
		const tokens = r.usage ? `${r.usage.inputTokens ?? "?"} → ${r.usage.outputTokens ?? "?"} tok${r.usage.reasoningTokens ? `（推理 ${r.usage.reasoningTokens}）` : ""}` : "";
		return h("div", { style: { maxWidth: 420 } },
			h("div", { style: { ...S.mono, wordBreak: "break-word" } }, r.text ? r.text.slice(0, 160) : h("span", { style: { color: C.fg2 } }, r.reasoningChars ? `（仅推理内容 ${r.reasoningChars} 字）` : "（无文本）")),
			h("div", { style: { color: C.fg2, fontSize: 11 } }, [tokens, r.tokensPerSec ? `${r.tokensPerSec} tok/s` : "", r.reasoningChars ? `推理 ${r.reasoningChars} 字` : ""].filter(Boolean).join(" · ")));
	}

	function ProbeResultDetail({ r }) {
		if (!r || r.pending) return null;
		const info = r.modelInfo;
		return h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, padding: 8, background: C.bg, borderRadius: 6 } },
			h("div", null, h("b", null, "请求"), h("div", { style: S.mono }, `${r.provider}/${r.model}`), h("div", { style: { color: C.fg2 } }, `推理程度：${effortLabel(r.reasoningEffort)}`)),
			h("div", null, h("b", null, "耗时"), h("div", null, `首 token ${fmtMs(r.firstTokenMs)} · 首文本 ${fmtMs(r.firstTextMs)}`), h("div", { style: { color: C.fg2 } }, `总耗时 ${fmtMs(r.totalMs)} · ${r.tokensPerSec ? `${r.tokensPerSec} tok/s` : "无速度数据"}`)),
			h("div", null, h("b", null, "用量"), h("div", null, r.usage ? `输入 ${r.usage.inputTokens ?? "—"} · 输出 ${r.usage.outputTokens ?? "—"}` : "服务商未返回 usage"), h("div", { style: { color: C.fg2 } }, r.usage?.reasoningTokens ? `推理 tokens ${r.usage.reasoningTokens}` : `文本 ${r.textChars ?? 0} 字 · 推理 ${r.reasoningChars ?? 0} 字`)),
			info ? h("div", null, h("b", null, "模型能力"), h("div", null, `上下文 ${info.context?.contextWindow ?? info.contextWindow ?? "—"} · 最大输出 ${info.defaultMaxTokens ?? info.maxTokens ?? "—"}`), h("div", { style: { color: C.fg2 } }, `推理档位 ${(info.levels ?? info.reasoning?.efforts?.map((x) => x.id) ?? []).join(" / ") || "无"}`)) : null,
			r.ok ? h("div", { style: { gridColumn: "1 / -1" } }, h("b", null, "完整输出（截取）"), h("pre", { style: { ...S.mono, whiteSpace: "pre-wrap", margin: "4px 0 0", maxHeight: 180, overflow: "auto" } }, r.text || "（无文本输出）")) : h("div", { style: { gridColumn: "1 / -1", color: C.err } }, h("b", null, "错误详情"), h("pre", { style: { ...S.mono, whiteSpace: "pre-wrap", margin: "4px 0 0" } }, r.error?.message ?? "未知错误")));
	}


	async function runProbe(api, targets, opts, signal, onResult) {
		const t0 = performance.now();
		let peak = 0;
		for (let offset = 0; offset < targets.length; offset += 64) {
			const chunk = targets.slice(offset, offset + 64);
			const last = await api.probe({ targets: chunk, stream: true, withInfo: true, ...opts }, signal, (line) => {
				if (line.type === "result") onResult(offset + line.index, line.result);
			});
			if (last?.type === "done") peak = Math.max(peak, last.peakInFlight ?? 0);
			if (signal?.aborted) break;
		}
		return { wallMs: Math.round(performance.now() - t0), peak };
	}

	function ProbeOptions({ o, set, showConcurrency = true }) {
		return h("div", { style: S.grid },
			h(Field, { label: "测试提示词", wide: true }, h(TextInput, { value: o.prompt, onChange: (v) => set({ prompt: v }) })),
			h(Field, { label: "最大输出 tokens（空 = 模型默认）" }, h(TextInput, { value: o.maxTokens, onChange: (v) => set({ maxTokens: v }) })),
			h(Field, { label: "单次超时（秒）" }, h(TextInput, { value: o.timeout, onChange: (v) => set({ timeout: v }) })),
			showConcurrency ? h(Field, { label: "并发数（1–64）" }, h(TextInput, { value: o.concurrency, onChange: (v) => set({ concurrency: v }) })) : null);
	}
	const probeOpts = (o) => ({
		prompt: o.prompt,
		maxTokens: toInt(o.maxTokens),
		timeoutMs: (toInt(o.timeout) ?? 60) * 1000,
		concurrency: Math.min(64, Math.max(1, toInt(o.concurrency) ?? 16))
	});

	// --- connectivity
	function ProbeCard({ m, api, all }) {
		const [picked, setPicked] = useState(() => new Set(all.map((x) => keyOf(x.provider, x.id))));
		const [o, setO] = useState({ prompt: "Reply with exactly: OK", maxTokens: "", timeout: "60", concurrency: "16" });
		const [effortMode, setEffortMode] = useState("default");
		const [rows, setRows] = useState([]);
		const [details, setDetails] = useState(() => new Set());
		const [summary, setSummary] = useState(null);
		const [running, setRunning] = useState(false);
		const abort = useRef();
		useEffect(() => () => abort.current?.abort(), []);
		const set = (patch) => setO((s) => ({ ...s, ...patch }));
		const toggle = (k, on) => setPicked((s) => { const n = new Set(s); on ? n.add(k) : n.delete(k); return n; });
		const toggleDetail = (id) => setDetails((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

		const plan = (models) => models.flatMap((x) => {
			const efforts = (x.reasoning?.efforts ?? []).map((e) => e.id);
			const base = { provider: x.provider, model: x.id };
			if (effortMode === "default" || efforts.length === 0) return [{ ...base }];
			if (effortMode === "all") return efforts.map((e) => ({ ...base, reasoningEffort: e }));
			return [{ ...base, reasoningEffort: efforts.includes(effortMode) ? effortMode : undefined }];
		});

		const start = async (targets, merge) => {
			if (targets.length === 0) return;
			abort.current?.abort();
			const ac = new AbortController();
			abort.current = ac;
			setRunning(true);
			const ids = targets.map(rowId);
			setRows((prev) => {
				const pending = targets.map((t) => ({ ...t, id: rowId(t), pending: true }));
				if (!merge) return pending;
				const map = new Map(prev.map((r) => [r.id, r]));
				for (const p of pending) map.set(p.id, p);
				return [...map.values()];
			});
			const finish = (id, result) => setRows((prev) => prev.map((r) => (r.id === id ? { ...result, id } : r)));
			try {
				const out = await runProbe(api, targets, probeOpts(o), ac.signal, (i, result) => finish(ids[i], result));
				if (!merge) setSummary(out);
			} catch (e) {
				if (!ac.signal.aborted) m.notify("err", e.message || String(e));
			} finally {
				setRows((prev) => prev.map((r) => (r.pending && ids.includes(r.id) ? { ...r, pending: false, ok: false, error: { code: ac.signal.aborted ? "ABORTED" : "ERROR", message: ac.signal.aborted ? "已停止" : "未返回结果" } } : r)));
				setRunning(false);
			}
		};

		const done = rows.filter((r) => !r.pending);
		const okRows = done.filter((r) => r.ok);
		const failed = done.filter((r) => !r.ok);
		const fastest = okRows.slice().sort((a, b) => (a.firstTokenMs ?? 1e12) - (b.firstTokenMs ?? 1e12))[0];
		const groups = all.reduce((acc, x) => ((acc[x.provider] ??= { name: x.providerName || x.provider, items: [] }).items.push(x), acc), {});
		const resultTable = rows.length ? h("div", { style: { overflowX: "auto" } }, h("table", { style: S.table },
			h("thead", null, h("tr", null, ["模型", "档位", "状态", "首字", "总耗时", "输出 / 错误", ""].map((t, i) => h("th", { key: i, style: S.th }, t)))),
			h("tbody", null, rows.map((r) => {
				const detail = details.has(r.id) && !r.pending ? h("tr", { key: `${r.id}:detail` }, h("td", { colSpan: 7, style: { ...S.td, background: C.l1 } }, h(ProbeResultDetail, { r }))) : null;
				return h(React.Fragment, { key: r.id },
					h("tr", { key: `${r.id}:row` },
						h("td", { style: { ...S.td, ...S.mono } }, `${r.provider}/${r.model}`),
						h("td", { style: S.td }, r.reasoningEffort ? h("span", { style: S.chip }, r.reasoningEffort) : h("span", { style: { color: C.fg2 } }, "默认")),
						h("td", { style: S.td }, h(StatusCell, { r })),
						h("td", { style: S.td }, r.pending ? "" : fmtMs(r.firstTokenMs)),
						h("td", { style: S.td }, r.pending ? "" : fmtMs(r.totalMs)),
						h("td", { style: S.td }, h(DetailCell, { r })),
						h("td", { style: { ...S.td, whiteSpace: "nowrap" } },
							h(Btn, { onClick: () => toggleDetail(r.id), disabled: r.pending }, details.has(r.id) ? "收起详情" : "详情"), " ",
							h(Btn, { disabled: running, onClick: () => start([{ provider: r.provider, model: r.model, reasoningEffort: r.reasoningEffort ?? undefined }], true) }, "重测"))),
					detail);
			})))) : null;

		return h("div", { style: S.card },
			h("div", { style: S.cardTitle }, "模型联通测试"),
			h("div", { style: S.hint }, "向所选模型发送一次真实请求（经 DSH 的同一调用链路），测量首字延迟、总耗时与输出速度，失败时给出错误码。所有请求并行执行。"),
			h(ProbeOptions, { o, set }),
			h("div", { style: { ...S.row, margin: "4px 0 8px" } },
				h("span", { style: { color: C.fg2 } }, "推理档位："),
				h(Select, { value: effortMode, onChange: setEffortMode, ariaLabel: "测试推理档位", style: { width: 220 }, options: [["default", "模型默认"], ["all", "逐档测试（每个支持的档位各一次）"], ...LEVELS.map((l) => [l, `仅 ${effortLabel(l)}`])] })),
			h("details", { style: { margin: "4px 0 8px" } },
				h("summary", { style: { cursor: "pointer", color: C.fg2 } }, `选择模型（已选 ${picked.size} / ${all.length}）`),
				h("div", { style: { ...S.row, margin: "6px 0" } },
					h(Btn, { onClick: () => setPicked(new Set(all.map((x) => keyOf(x.provider, x.id)))) }, "全选"),
					h(Btn, { onClick: () => setPicked(new Set()) }, "清空")),
				Object.entries(groups).map(([pid, g]) => h("div", { key: pid, style: { marginBottom: 6 } },
					h("div", { style: { fontWeight: 500, margin: "4px 0" } }, g.name),
					h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 4 } },
						g.items.map((x) => {
							const k = keyOf(x.provider, x.id);
							return h(Check, { key: k, checked: picked.has(k), onChange: (on) => toggle(k, on), label: h("span", { style: S.mono }, x.id) });
						}))))),
			h("div", { style: S.row },
				h(Btn, { kind: "primary", disabled: running || picked.size === 0, onClick: () => start(plan(all.filter((x) => picked.has(keyOf(x.provider, x.id)))), false) }, `测试所选（${picked.size}）`),
				h(Btn, { disabled: running || failed.length === 0, onClick: () => start(failed.map(({ provider, model, reasoningEffort }) => ({ provider, model, reasoningEffort: reasoningEffort ?? undefined })), true) }, `重测失败项（${failed.length}）`),
				running ? h(Btn, { kind: "danger", onClick: () => abort.current?.abort() }, "停止") : null),
			rows.length ? h("div", { style: { ...S.row, margin: "10px 0 4px", color: C.fg2 } },
				h("span", null, `完成 ${done.length}/${rows.length}`),
				h("span", { style: { color: C.ok } }, `成功 ${okRows.length}`),
				h("span", { style: { color: failed.length ? C.err : C.fg2 } }, `失败 ${failed.length}`),
				h("span", null, `首字 P50 ${fmtMs(pct(okRows.map((r) => r.firstTokenMs), 50))}`),
				summary ? h("span", null, `总耗时 ${fmtMs(summary.wallMs)} · 峰值并发 ${summary.peak}`) : null,
				fastest ? h("span", null, `最快：${fastest.provider}/${fastest.model}（${fmtMs(fastest.firstTokenMs)}）`) : null) : null,
			resultTable);
	}

	// --- concurrency stress
	function StressCard({ m, api, all }) {
		const first = all[0];
		const [sel, setSel] = useState(() => (first ? keyOf(first.provider, first.id) : ""));
		const [effort, setEffort] = useState("@subagent");
		const [count, setCount] = useState("16");
		const [o, setO] = useState({ prompt: "Reply with exactly: OK", maxTokens: "", timeout: "90", concurrency: "16" });
		const [res, setRes] = useState(null);
		const [running, setRunning] = useState(false);
		const abort = useRef();
		useEffect(() => () => abort.current?.abort(), []);
		const [provider, model] = sel.split("\u0000");
		const picked = all.find((x) => x.provider === provider && x.id === model);
		const efforts = (picked?.reasoning?.efforts ?? []).map((e) => e.id);
		const n = Math.min(200, Math.max(1, toInt(count) ?? 16));

		const run = async () => {
			if (!picked) return;
			abort.current?.abort();
			const ac = new AbortController();
			abort.current = ac;
			setRunning(true);
			try {
				let reasoningEffort = effort === "@subagent" || effort === "" ? undefined : effort;
				let resolvedNote;
				if (effort === "@subagent") {
					const sim = await api.simulate([{ parent: { provider, model } }]);
					reasoningEffort = sim.cases?.[0]?.final?.reasoningEffort ?? undefined;
					resolvedNote = `按子代理规则解析为：${effortLabel(reasoningEffort)}`;
				}
				const targets = Array.from({ length: n }, () => ({ provider, model, reasoningEffort }));
				const results = new Array(n);
				setRes({ n, done: 0, results, resolvedNote, running: true });
				const out = await runProbe(api, targets, probeOpts(o), ac.signal, (i, r) => {
					results[i] = r;
					setRes((s) => ({ ...s, done: (s?.done ?? 0) + 1, results: [...results] }));
				});
				setRes((s) => ({ ...s, ...out, running: false }));
			} catch (e) {
				if (!ac.signal.aborted) m.notify("err", e.message || String(e));
				setRes((s) => (s ? { ...s, running: false } : s));
			} finally {
				setRunning(false);
			}
		};

		const rs = (res?.results ?? []).filter(Boolean);
		const okR = rs.filter((r) => r.ok);
		const serial = okR.reduce((a, r) => a + (r.totalMs ?? 0), 0);
		const errs = rs.filter((r) => !r.ok).reduce((acc, r) => ((acc[r.error?.code ?? "ERROR"] = (acc[r.error?.code ?? "ERROR"] ?? 0) + 1), acc), {});
		const t0 = rs.length ? Math.min(...rs.map((r) => r.startedAt)) : 0;
		const span = rs.length ? Math.max(...rs.map((r) => r.startedAt + r.totalMs)) - t0 : 0;

		return h("div", { style: S.card },
			h("div", { style: S.cardTitle }, "并发压力测试"),
			h("div", { style: S.hint }, "对同一模型同时发出 N 个请求，模拟多个子代理并行工作，检查服务商限流与真实并行度。“并行加速比” = 各请求耗时之和 ÷ 实际总耗时。"),
			h("div", { style: { ...S.row, marginBottom: 6 } },
				h(ModelSelect, { catalog: { groups: groupsOf(all) }, value: sel, onChange: (v) => { setSel(v); setEffort("@subagent"); }, ariaLabel: "压测模型" }),
				h(Select, { value: effort, onChange: setEffort, ariaLabel: "压测推理档位", style: { width: 220 }, options: [["@subagent", "按子代理规则解析"], ["", "模型默认"], ...efforts.map((e) => [e, effortLabel(e)])] }),
				h("span", { style: { color: C.fg2 } }, "请求数"),
				h(TextInput, { value: count, onChange: setCount, ariaLabel: "请求数", style: { width: 70 } }),
				[8, 16, 32].map((k) => h(Btn, { key: k, onClick: () => { setCount(String(k)); setO((s) => ({ ...s, concurrency: String(k) })); } }, `${k}×`))),
			h(ProbeOptions, { o, set: (p) => setO((s) => ({ ...s, ...p })) }),
			h("div", { style: S.row },
				h(Btn, { kind: "primary", disabled: running || !picked, onClick: run }, `开始压测（${n} 个请求）`),
				running ? h(Btn, { kind: "danger", onClick: () => abort.current?.abort() }, "停止") : null),
			res ? h("div", { style: { marginTop: 10 } },
				res.resolvedNote ? h("div", { style: S.hint }, res.resolvedNote) : null,
				h("div", { style: { ...S.row, color: C.fg2 } },
					h("span", null, `完成 ${rs.length}/${res.n}`),
					h("span", { style: { color: C.ok } }, `成功 ${okR.length}`),
					h("span", { style: { color: rs.length - okR.length ? C.err : C.fg2 } }, `失败 ${rs.length - okR.length}`),
					res.wallMs ? h("span", null, `总耗时 ${fmtMs(res.wallMs)}`) : null,
					res.peak ? h("span", null, `峰值并发 ${res.peak}`) : null,
					h("span", null, `首字 P50/P95 ${fmtMs(pct(okR.map((r) => r.firstTokenMs), 50))} / ${fmtMs(pct(okR.map((r) => r.firstTokenMs), 95))}`),
					h("span", null, `总耗时 P50/P95 ${fmtMs(pct(okR.map((r) => r.totalMs), 50))} / ${fmtMs(pct(okR.map((r) => r.totalMs), 95))}`),
					res.wallMs && serial ? h("span", null, `并行加速比 ${(serial / res.wallMs).toFixed(1)}×`) : null),
				Object.keys(errs).length ? h("div", { style: S.warnBox }, "错误分布：", Object.entries(errs).map(([c, k]) => `${c}${hintOf(c) ? `（${hintOf(c)}）` : ""} × ${k}`).join("；"),
					rs.find((r) => !r.ok)?.error?.message ? h("div", { style: { ...S.mono, color: C.fg2, marginTop: 4 } }, rs.find((r) => !r.ok).error.message) : null) : null,
				span > 0 ? h("div", { style: { marginTop: 8 }, "aria-label": "请求时间线" },
					h("div", { style: { color: C.fg2, fontSize: 11, marginBottom: 4 } }, `时间线（0 – ${fmtMs(span)}，每行一个请求；绿色成功，红色失败）`),
					rs.slice().sort((a, b) => a.startedAt - b.startedAt).map((r, i) => h("div", { key: i, title: `${fmtMs(r.startedAt - t0)} 开始 · 首字 ${fmtMs(r.firstTokenMs)} · 总 ${fmtMs(r.totalMs)}`, style: { position: "relative", height: 6, margin: "2px 0", background: C.l2, borderRadius: 3 } },
						h("div", { style: { position: "absolute", left: `${((r.startedAt - t0) / span) * 100}%`, width: `${Math.max(0.5, (r.totalMs / span) * 100)}%`, top: 0, bottom: 0, borderRadius: 3, background: r.ok ? C.ok : C.err, opacity: 0.8 } })))) : null) : null);
	}

	const groupsOf = (all) => Object.values(all.reduce((acc, x) => ((acc[x.provider] ??= { id: x.provider, name: x.providerName || x.provider, models: [] }).models.push(x), acc), {}));

	// --- dispatch simulation
	function SimResult({ c, onProbe, probing, probe }) {
		const d = c.decision;
		return h("div", { style: { ...S.card, background: C.bg, marginTop: 10 } },
			h("table", { style: S.table }, h("tbody", null,
				[
					["主代理请求", `${c.parent.provider}/${c.parent.model} · ${effortLabel(c.parent.reasoningEffort)}`],
					c.routed
						? ["子代理基础请求", `${c.routed.from.provider}/${c.routed.from.model}（${c.childSource === "selected" ? "子代理自选模型" : "继承主代理"}）→ ${c.routed.kind === "redirect" ? "重定向" : "故障切换"}到 ${c.base.provider}/${c.base.model} · ${effortLabel(c.base.reasoningEffort)}`]
						: ["子代理基础请求", `${c.base.provider}/${c.base.model} · ${effortLabel(c.base.reasoningEffort)}（${c.childSource === "selected" ? "子代理自选模型" : "继承主代理"}）`],
					["规则来源", d.source === "per-model" ? `按模型单独指定（${d.key}）` : d.source === "unified" ? "统一推理程度" : "无"],
					["期望档位 / 模式", `${d.wanted ? effortLabel(d.wanted) : "—"} · ${d.mode === "fill" ? "仅填充" : "强制覆盖"} · 兼容处理${d.clamp ? "开" : "关"}`],
					["模型支持的档位", `${Array.isArray(c.supported.levels) ? (c.supported.levels.length ? c.supported.levels.join(" / ") : "不支持推理") : "未知"}（来源：${SOURCE_TEXT[c.supported.source] ?? c.supported.source}）`],
					["判定", RULE_TEXT[d.rule] ?? d.rule]
				].map(([k, v]) => h("tr", { key: k }, h("td", { style: { ...S.td, color: C.fg2, width: 140 } }, k), h("td", { style: S.td }, v))),
				h("tr", null, h("td", { style: { ...S.td, color: C.fg2 } }, "最终子代理请求"),
					h("td", { style: { ...S.td, fontWeight: 600 } }, `${c.final.provider}/${c.final.model} · ${effortLabel(c.final.reasoningEffort)}`, d.changed ? h("span", { style: { ...S.pill(C.brand), marginLeft: 8 } }, "已改写") : h("span", { style: { ...S.pill(), marginLeft: 8 } }, "未改动"))))),
			c.warnings?.length ? h("div", { style: S.warnBox }, c.warnings.map((w, i) => h("div", { key: i }, `⚠ ${w}`))) : null,
			h("div", { style: { ...S.row, marginTop: 8 } },
				h(Btn, { onClick: onProbe, disabled: probing }, probing ? "测试中…" : "用最终配置发一次真实请求"),
				probe ? h(StatusCell, { r: probe }) : null,
				probe && !probe.pending ? h("span", { style: { color: C.fg2 } }, `首字 ${fmtMs(probe.firstTokenMs)} · 总 ${fmtMs(probe.totalMs)}`) : null),
			probe && !probe.pending ? h(DetailCell, { r: probe }) : null);
	}

	function SimulateCard({ m, api, all, data }) {
		const def = rec(findView(data.desc, DEFAULT_NS)?.value);
		const fallback = rec(data.catalog?.default);
		const [parent, setParent] = useState(() => keyOf(str(def.provider) ?? fallback.provider ?? all[0]?.provider ?? "", str(def.model) ?? fallback.model ?? all[0]?.id ?? ""));
		const [parentEffort, setParentEffort] = useState(() => str(def.reasoningEffort) ?? "");
		const [child, setChild] = useState("");
		const [childEffort, setChildEffort] = useState("");
		const [result, setResult] = useState(null);
		const [matrix, setMatrix] = useState(null);
		const [probe, setProbe] = useState(null);
		const [busy, setBusy] = useState(false);
		const find = (k) => { const [p, id] = k.split("\u0000"); return all.find((x) => x.provider === p && x.id === id); };
		const pm = find(parent);
		const cm = child ? find(child) : undefined;
		const effOpts = (md) => [["", "模型默认"], ...((md?.reasoning?.efforts ?? []).map((e) => [e.id, effortLabel(e.id)]))];

		const simulate = async () => {
			if (!pm) return;
			setBusy(true);
			setProbe(null);
			try {
				const c = { parent: { provider: pm.provider, model: pm.id, reasoningEffort: parentEffort || undefined } };
				if (cm || childEffort) c.child = { provider: cm?.provider ?? pm.provider, model: cm?.id ?? pm.id, reasoningEffort: childEffort || undefined };
				setResult(await api.simulate([c]));
			} catch (e) {
				m.notify("err", e.message || String(e));
			} finally {
				setBusy(false);
			}
		};
		const runMatrix = async () => {
			setBusy(true);
			try {
				setMatrix(await api.simulate(all.map((x) => ({ parent: { provider: x.provider, model: x.id, reasoningEffort: x.reasoning?.defaultEffort } }))));
			} catch (e) {
				m.notify("err", e.message || String(e));
			} finally {
				setBusy(false);
			}
		};
		const realProbe = async (c) => {
			setProbe({ pending: true });
			try {
				const out = await api.probe({ targets: [{ provider: c.final.provider, model: c.final.model, reasoningEffort: c.final.reasoningEffort }], timeoutMs: 90000 });
				setProbe(out.results?.[0] ?? { ok: false, error: { code: "ERROR", message: "无结果" } });
			} catch (e) {
				setProbe({ ok: false, error: { code: e.code ?? "ERROR", message: e.message } });
			}
		};
		const s = (result ?? matrix)?.settings;

		return h("div", { style: S.card },
			h("div", { style: S.cardTitle }, "模拟派遣子代理"),
			h("div", { style: S.hint }, "不启动任何代理，直接用当前设置推演：主代理用某个模型派遣子代理时，子代理最终会以什么模型和推理档位发出请求，以及每一步的判定依据。"),
			h("div", { style: S.grid },
				h(Field, { label: "主代理模型" }, h(ModelSelect, { catalog: { groups: groupsOf(all) }, value: parent, onChange: (v) => { setParent(v); setParentEffort(""); }, ariaLabel: "主代理模型" })),
				h(Field, { label: "主代理推理档位" }, h(Select, { value: parentEffort, onChange: setParentEffort, options: effOpts(pm), ariaLabel: "主代理推理档位" })),
				h(Field, { label: "子代理指定模型（需开启“允许子代理选择模型”）" }, h(ModelSelect, { catalog: { groups: groupsOf(all) }, value: child, extra: "继承主代理", onChange: (v) => { setChild(v); setChildEffort(""); }, ariaLabel: "子代理模型" })),
				h(Field, { label: "子代理请求自带档位" }, h(Select, { value: childEffort, onChange: setChildEffort, options: [["", "不指定"], ...effOpts(cm ?? pm).slice(1)], ariaLabel: "子代理档位" }))),
			h("div", { style: S.row },
				h(Btn, { kind: "primary", onClick: simulate, disabled: busy || !pm }, "开始模拟"),
				h(Btn, { onClick: runMatrix, disabled: busy || all.length === 0 }, `全部模型推演（${all.length}）`)),
			s ? h("div", { style: { ...S.row, marginTop: 8, color: C.fg2 } },
				h("span", null, `统一档位：${s.subagentEffort ? effortLabel(s.subagentEffort) : "不干预"}`),
				h("span", null, `模式：${s.subagentMode === "fill" ? "仅填充" : "强制覆盖"}`),
				h("span", null, `兼容处理：${s.clampToModel ? "开" : "关"}`),
				h("span", null, `单独指定：${s.perModelCount} 项`),
				h("span", null, `最大并发：${s.maxActiveSubagents ?? "—"}`),
				h("span", null, `嵌套深度：${s.maxDepth ?? "—"}`),
				h("span", null, `子代理选模型：${s.selectionEnabled ? "开" : "关"}`)) : null,
			result?.cases?.[0] ? h(SimResult, { c: result.cases[0], probe, probing: probe?.pending, onProbe: () => realProbe(result.cases[0]) }) : null,
			matrix ? h("div", { style: { overflowX: "auto", marginTop: 10 } }, h("table", { style: S.table },
				h("thead", null, h("tr", null, ["主代理模型（默认档位）", "子代理最终档位", "判定", "支持的档位"].map((t) => h("th", { key: t, style: S.th }, t)))),
				h("tbody", null, matrix.cases.map((c, i) => h("tr", { key: i },
					h("td", { style: { ...S.td, ...S.mono } }, `${c.parent.provider}/${c.parent.model}`, h("span", { style: { color: C.fg2 } }, ` · ${c.parent.reasoningEffort ?? "默认"}`)),
					h("td", { style: { ...S.td, fontWeight: c.decision.changed ? 600 : 400 } }, effortLabel(c.final.reasoningEffort)),
					h("td", { style: { ...S.td, color: c.decision.rule === "clamped" || c.warnings.length ? C.warn : C.fg } }, RULE_TEXT[c.decision.rule] ?? c.decision.rule, c.warnings.length ? h("span", { title: c.warnings.join("\n") }, " ⚠") : null),
					h("td", { style: S.td }, Array.isArray(c.supported.levels) ? (c.supported.levels.join(" / ") || "不支持推理") : "未知")))))) : null);
	}

	// --- real end-to-end dispatch
	const LIVE_PROMPT = (n) => `[模型管理插件 · 子代理派遣测试] 请立即在同一轮中并行调用 ${n} 次 subagent 工具（不要分批、不要等待其中任何一个完成后再派遣下一个）。每个子代理的任务都是：“只回复 OK，不要调用任何工具。”全部返回后，用一句话报告收到了几个 OK。不要做任何其他事情。`;

	function summarizeLive(entries, rootId) {
		const known = new Set([rootId]);
		const mine = [];
		for (const e of entries) {
			if (e.parentSessionId && known.has(e.parentSessionId)) {
				known.add(e.sessionId);
				mine.push(e);
			}
		}
		const bySession = new Map();
		for (const e of mine) {
			let g = bySession.get(e.sessionId);
			if (!g) bySession.set(e.sessionId, (g = { sessionId: e.sessionId, depth: e.depth, provider: e.provider, model: e.model, first: e.at, last: e.at, requests: 0, before: e.before, after: e.after, rule: e.rule, changed: e.changed }));
			g.first = Math.min(g.first, e.at);
			g.last = Math.max(g.last, e.at);
			g.requests++;
		}
		const groups = [...bySession.values()].sort((a, b) => a.first - b.first);
		const points = groups.flatMap((g) => [[g.first, 1], [g.last + 1, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
		let cur = 0;
		let peak = 0;
		for (const [, d] of points) peak = Math.max(peak, (cur += d));
		const firsts = groups.map((g) => g.first);
		return { groups, requests: mine.length, peak, spreadMs: firsts.length > 1 ? Math.max(...firsts) - Math.min(...firsts) : 0 };
	}

	function LiveDispatchCard({ m, api, all, data, active }) {
		const def = rec(findView(data.desc, DEFAULT_NS)?.value);
		const fallback = rec(data.catalog?.default);
		const [sel, setSel] = useState(() => keyOf(str(def.provider) ?? fallback.provider ?? all[0]?.provider ?? "", str(def.model) ?? fallback.model ?? all[0]?.id ?? ""));
		const [effort, setEffort] = useState(() => str(def.reasoningEffort) ?? "");
		const [count, setCount] = useState("4");
		const [run, setRun] = useState(null);
		const stopRef = useRef(false);
		const [provider, model] = sel.split("\u0000");
		const picked = all.find((x) => x.provider === provider && x.id === model);
		const n = Math.min(32, Math.max(1, toInt(count) ?? 4));
		const maxActive = toInt(rec(findView(data.desc, SUBAGENT_NS)?.value).maxActiveSubagents);
		useEffect(() => () => { stopRef.current = true; }, []);

		const start = async () => {
			if (!picked) return;
			stopRef.current = false;
			const state = { phase: "准备中", n, startedAt: Date.now(), entries: [], sessionId: null, expected: null };
			const push = (patch) => setRun((s) => ({ ...(s ?? state), ...patch }));
			setRun(state);
			try {
				const sim = await api.simulate([{ parent: { provider, model, reasoningEffort: effort || undefined } }]);
				push({ expected: sim.cases?.[0] });
				const before = await api.dispatches(0);
				let since = before.seq ?? 0;
				const created = await api.sessionCreate({});
				const sessionId = created.sessionId;
				push({ sessionId, phase: "已创建测试会话" });
				await api.sessionSelectModel({ sessionId, provider, model, ...(effort ? { reasoningEffort: effort } : {}) });
				try { await api.sessionRename({ sessionId, title: `[模型管理] 子代理派遣测试 ×${n}` }); } catch {}
				const promptAt = Date.now();
				await api.sessionPrompt({ requestId: uuid(), sessionId, mode: "queue", content: [{ type: "text", text: LIVE_PROMPT(n) }] });
				push({ phase: "主代理思考中，等待派遣…", promptAt });
				const entries = [];
				let lastNew = Date.now();
				const deadline = Date.now() + 5 * 60 * 1000;
				while (!stopRef.current && Date.now() < deadline) {
					await new Promise((r) => setTimeout(r, 1500));
					const out = await api.dispatches(since);
					since = out.seq ?? since;
					if (out.entries?.length) {
						entries.push(...out.entries);
						const sum = summarizeLive(entries, sessionId);
						if (sum.requests > 0) lastNew = Date.now();
						push({ entries: [...entries], phase: `已观测到 ${sum.groups.length} 个子代理` });
					}
					const sum = summarizeLive(entries, sessionId);
					const idle = Date.now() - lastNew;
					if (sum.groups.length >= n && idle > 8000) break;
					if (sum.groups.length > 0 && idle > 45000) break;
				}
				push({ phase: stopRef.current ? "已停止观测" : "观测结束", finishedAt: Date.now() });
			} catch (e) {
				push({ phase: "失败", error: e.message || String(e) });
				m.notify("err", e.message || String(e));
			}
		};

		const sum = run?.sessionId ? summarizeLive(run.entries ?? [], run.sessionId) : null;
		const exp = run?.expected?.final;
		const mismatch = sum && exp ? sum.groups.filter((g) => g.provider === exp.provider && g.model === exp.model && (g.after ?? null) !== (exp.reasoningEffort ?? null)) : [];
		const observing = run && !run.finishedAt && !run.error;

		return h("div", { style: S.card },
			h("div", { style: S.cardTitle }, "真实派遣测试"),
			h("div", { style: S.hint }, "新建一个测试会话，让主代理在同一轮并行派遣 N 个只回复 OK 的子代理，然后从主机端记录核对每个子代理实际使用的模型、推理档位和启动时间差。会消耗少量真实调用。"),
			h("div", { style: { ...S.row, marginBottom: 8 } },
				h(ModelSelect, { catalog: { groups: groupsOf(all) }, value: sel, onChange: (v) => { setSel(v); setEffort(""); }, ariaLabel: "测试会话主代理模型" }),
				h(Select, { value: effort, onChange: setEffort, ariaLabel: "主代理推理档位", style: { width: 180 }, options: [["", "模型默认"], ...((picked?.reasoning?.efforts ?? []).map((e) => [e.id, effortLabel(e.id)]))] }),
				h("span", { style: { color: C.fg2 } }, "子代理数"),
				h(TextInput, { value: count, onChange: setCount, ariaLabel: "子代理数", style: { width: 60 } }),
				h(Btn, { kind: "primary", onClick: start, disabled: !picked || observing }, "开始真实派遣"),
				observing ? h(Btn, { kind: "danger", onClick: () => { stopRef.current = true; } }, "停止观测") : null),
			maxActive !== undefined && n > maxActive ? h("div", { style: S.warnBox }, `子代理数 ${n} 超过“最大同时运行数” ${maxActive}，多出的会排队，可在“子代理”页调高。`) : null,
			run ? h("div", { style: { marginTop: 6 } },
				h("div", { style: { ...S.row, color: C.fg2 } },
					h("span", null, `状态：${run.phase}`),
					run.error ? h("span", { style: { color: C.err } }, run.error) : null,
					run.sessionId ? h(Btn, { onClick: () => api.openSession(run.sessionId) }, "打开测试会话") : null,
					run.sessionId && run.finishedAt ? h(Btn, { onClick: () => m.run("测试会话已归档", () => api.archiveSession(run.sessionId)) }, "归档测试会话") : null),
				exp ? h("div", { style: S.hint }, `模拟预期：子代理以 ${exp.provider}/${exp.model} · ${effortLabel(exp.reasoningEffort)} 发出请求`) : null,
				sum && sum.groups.length ? h(React.Fragment, null,
					h("div", { style: { ...S.row, margin: "6px 0" } },
						h("span", null, `子代理 ${sum.groups.length}/${run.n}`),
						h("span", null, `模型请求 ${sum.requests} 次`),
						h("span", null, `启动时间差 ${fmtMs(sum.spreadMs)}`),
						h("span", { title: "按每个子代理首末请求时间估算，只发一次请求的子代理会被低估" }, `估算峰值并行 ${sum.peak}`),
						run.promptAt ? h("span", null, `首个子代理在提问后 ${fmtMs(sum.groups[0].first - run.promptAt)} 启动`) : null,
						mismatch.length ? h("span", { style: { color: C.err } }, `${mismatch.length} 个子代理档位与预期不符`) : exp ? h("span", { style: { color: C.ok } }, "档位与预期一致") : null),
					h("table", { style: S.table },
						h("thead", null, h("tr", null, ["#", "子代理会话", "层级", "模型", "原档位 → 实际档位", "判定", "首次请求", "请求数"].map((t) => h("th", { key: t, style: S.th }, t)))),
						h("tbody", null, sum.groups.map((g, i) => h("tr", { key: g.sessionId },
							h("td", { style: S.td }, i + 1),
							h("td", { style: { ...S.td, ...S.mono } }, String(g.sessionId).slice(0, 12)),
							h("td", { style: S.td }, g.depth ?? "—"),
							h("td", { style: { ...S.td, ...S.mono } }, `${g.provider}/${g.model}`),
							h("td", { style: S.td }, `${g.before ?? "默认"} → `, h("b", null, g.after ?? "默认"), g.changed ? h("span", { style: { ...S.pill(C.brand), marginLeft: 6 } }, "已改写") : null),
							h("td", { style: S.td }, RULE_TEXT[g.rule] ?? g.rule),
							h("td", { style: S.td }, `+${fmtMs(g.first - sum.groups[0].first)}`),
							h("td", { style: S.td }, g.requests)))))) : null) : null);
	}

	// --- dispatch log
	function DispatchLogCard({ m, api, active }) {
		const [entries, setEntries] = useState([]);
		const [auto, setAuto] = useState(false);
		const [err, setErr] = useState(null);
		const load = useCallback(async () => {
			try {
				const out = await api.dispatches(0);
				setEntries((out.entries ?? []).slice(-100).reverse());
				setErr(null);
			} catch (e) {
				setErr(e.message || String(e));
			}
		}, [api]);
		useEffect(() => { if (active) load(); }, [active, load]);
		useEffect(() => {
			if (!auto || !active) return undefined;
			const t = setInterval(load, 2000);
			return () => clearInterval(t);
		}, [auto, active, load]);
		const clear = async () => {
			try {
				await api.clearDispatches();
				setEntries([]);
			} catch (e) {
				m.notify("err", e.message || String(e));
			}
		};
		return h("div", { style: S.card },
			h("div", { style: { ...S.row, justifyContent: "space-between" } },
				h("div", { style: S.cardTitle }, "子代理派遣记录"),
				h("div", { style: S.row },
					h(Check, { checked: auto, onChange: setAuto, label: "自动刷新" }),
					h(Btn, { onClick: load }, "刷新"),
					h(Btn, { onClick: clear, disabled: entries.length === 0 }, "清空"))),
			h("div", { style: S.hint }, "主机端记录的最近子代理模型请求（最多 500 条，重启后清空），可直接核对推理档位改写是否生效。"),
			err ? h("div", { style: S.warnBox }, err) : null,
			entries.length === 0 && !err ? h("div", { style: { color: C.fg2 } }, "暂无记录。派遣子代理后会出现在这里。") : null,
			entries.length ? h("div", { style: { overflowX: "auto", maxHeight: 360 } }, h("table", { style: S.table },
				h("thead", null, h("tr", null, ["时间", "子代理会话", "父会话", "层级", "模型", "原档位 → 实际档位", "判定"].map((t) => h("th", { key: t, style: S.th }, t)))),
				h("tbody", null, entries.map((e) => h("tr", { key: e.seq },
					h("td", { style: S.td }, new Date(e.at).toLocaleTimeString()),
					h("td", { style: { ...S.td, ...S.mono } }, String(e.sessionId ?? "—").slice(0, 12)),
					h("td", { style: { ...S.td, ...S.mono } }, String(e.parentSessionId ?? "—").slice(0, 12)),
					h("td", { style: S.td }, e.depth ?? "—"),
					h("td", { style: { ...S.td, ...S.mono } }, `${e.provider}/${e.model}`, e.routedFrom ? h("div", { style: { color: C.warn, fontSize: 11 } }, `${e.overridden ? "手动指定" : "已切换"}，原为 ${e.routedFrom}`) : null),
					h("td", { style: S.td }, `${e.before ?? "默认"} → `, h("b", null, e.after ?? "默认"), e.changed ? h("span", { style: { ...S.pill(C.brand), marginLeft: 6 } }, "已改写") : null),
					h("td", { style: { ...S.td, color: e.rule === "error" ? C.err : C.fg } }, RULE_TEXT[e.rule] ?? e.rule, e.error ? `：${e.error}` : "")))))) : null);
	}

	function DiagnosticsTab({ m, api, active }) {
		const data = m.state.data;
		const all = catalogModels(data.catalog);
		if (!data.catalog) return h("div", { style: S.card }, `模型目录读取失败：${data.catalogError ?? "未知错误"}`);
		if (all.length === 0) return h("div", { style: S.card }, "当前没有可用模型。请先在“服务商与模型”页添加服务商并配置密钥。");
		return h(React.Fragment, null,
			data.catalog.failures?.length ? h("div", { style: S.warnBox }, "以下服务商加载模型列表失败：", data.catalog.failures.map((f) => `${f.name || f.id}：${f.message}`).join("；")) : null,
			h(ProbeCard, { m, api, all }),
			h(StressCard, { m, api, all }),
			h(SimulateCard, { m, api, all, data }),
			h(LiveDispatchCard, { m, api, all, data, active }),
			h(DispatchLogCard, { m, api, active }));
	}

	// ---------------------------------------------------------------- failover / redirect tab
	const DEFAULT_FAILOVER_CODES = ["QUOTA", "ACCOUNT_QUOTA", "AUTH", "MISSING_CREDENTIAL", "INVALID_CREDENTIAL", "ACCOUNT_TOKEN_INVALID", "ACCOUNT_SIGN_IN_REQUIRED", "NO_ADAPTER"];
	const CODE_TEXT = {
		QUOTA: "额度/余额不足",
		ACCOUNT_QUOTA: "账户额度用尽",
		AUTH: "鉴权失败",
		MISSING_CREDENTIAL: "未配置密钥",
		INVALID_CREDENTIAL: "密钥无效",
		ACCOUNT_TOKEN_INVALID: "账户令牌失效",
		ACCOUNT_SIGN_IN_REQUIRED: "需要重新登录",
		NO_ADAPTER: "服务商未加载",
		RATE_LIMIT: "限流（429）",
		TIMEOUT: "超时",
		MANUAL: "手动标记"
	};
	const SCOPE_OPTIONS = [["all", "主代理和子代理"], ["subagent", "仅子代理"], ["main", "仅主代理"]];
	const fmtClock = (t) => (typeof t === "number" ? new Date(t).toLocaleTimeString() : "—");
	const splitKey = (k) => {
		const i = k.indexOf("\u0000");
		return i < 0 ? ["", ""] : [k.slice(0, i), k.slice(i + 1)];
	};
	const effortOptionsFor = (all, provider, model, first) => {
		const md = all.find((x) => x.provider === provider && x.id === model);
		const ids = (md?.reasoning?.efforts ?? []).map((e) => e.id).filter((id) => LEVELS.includes(id));
		return [["", first], ...(ids.length ? ids : LEVELS).map((l) => [l, `${LEVEL_LABEL[l] ?? l}（${l}）`])];
	};

	/** Shared health/event state for the tab; polls only while visible. */
	function useFailover(api, active) {
		const [st, setSt] = useState({ status: "loading" });
		const load = useCallback(async () => {
			try {
				setSt({ status: "ready", data: await api.failover() });
			} catch (e) {
				setSt((s) => ({ ...s, status: "error", error: e.message, code: e.code }));
			}
		}, [api]);
		useEffect(() => {
			if (!active) return undefined;
			load();
			const timer = setInterval(load, 4000);
			return () => clearInterval(timer);
		}, [active, load]);
		const act = useCallback(async (body) => setSt({ status: "ready", data: await api.failoverAction(body) }), [api]);
		return { st, load, act };
	}

	function HealthCard({ m, data, fo }) {
		const { st, act } = fo;
		const health = st.data?.health ?? [];
		const byId = new Map(health.map((x) => [x.provider, x]));
		const groups = data.catalog?.groups ?? [];
		const ids = [...new Set([...groups.map((g) => g.id), ...health.map((x) => x.provider)])];
		const nameOf = (id) => groups.find((g) => g.id === id)?.name || id;
		const chain = st.data?.routing?.failover?.chain ?? [];
		const enabled = st.data?.routing?.failover?.enabled !== false;
		const run = (text, body) => m.run(text, () => act(body));
		return h("div", { style: S.card },
			h("div", { style: { ...S.row, justifyContent: "space-between" } },
				h("div", { style: S.cardTitle }, "服务商状态"),
				health.length ? h(Btn, { onClick: () => run("已全部恢复", { action: "reset" }), disabled: m.busy }, "全部恢复") : null),
			h("div", { style: S.hint }, "服务商余额用完或密钥失效时会被自动标记为“不可用”。之后所有范围内的会话（包括已经派遣出去、正在运行的子代理）在下一次模型调用时自动改用备用模型。也可以手动标记。"),
			st.status === "error" ? h("div", { style: S.warnBox }, st.code === "NO_HOST_ROUTE" ? "主机端仍是旧版本，请重启 DSH 后使用故障切换。" : `状态读取失败：${st.error}`) : null,
			enabled && chain.length === 0 ? h("div", { style: S.warnBox }, "还没有配置备用模型。标记为不可用后没有可切换的目标，请先在下方“自动故障切换”里添加备用模型。") : null,
			!enabled ? h("div", { style: S.warnBox }, "自动故障切换已关闭：标记状态仅作记录，不会切换模型。") : null,
			h("table", { style: S.table },
				h("thead", null, h("tr", null, ["服务商", "状态", "原因", "自动恢复", ""].map((t, i) => h("th", { key: i, style: S.th }, t)))),
				h("tbody", null, ids.map((id) => {
					const x = byId.get(id);
					return h("tr", { key: id },
						h("td", { style: S.td }, nameOf(id), nameOf(id) !== id ? h("span", { style: { ...S.mono, color: C.fg2, marginLeft: 6 } }, id) : null),
						h("td", { style: S.td }, x
							? h("span", { style: { color: C.err } }, h("span", { style: S.dot(C.err) }), "不可用", x.hits > 1 ? `（${x.hits} 次）` : "")
							: h("span", { style: { color: C.ok } }, h("span", { style: S.dot(C.ok) }), "正常")),
						h("td", { style: { ...S.td, maxWidth: 360, wordBreak: "break-word" }, title: x?.message }, x ? `${CODE_TEXT[x.code] ?? x.code}${x.status ? ` (${x.status})` : ""}${x.message && x.code !== "MANUAL" ? ` · ${x.message.slice(0, 80)}` : ""}` : "—"),
						h("td", { style: S.td }, !x ? "—" : x.until > 0 ? fmtClock(x.until) : "手动恢复"),
						h("td", { style: { ...S.td, textAlign: "right" } }, x
							? h(Btn, { onClick: () => run(`${nameOf(id)} 已恢复`, { action: "reset", provider: id }), disabled: m.busy }, "恢复")
							: h(Btn, { kind: "danger", onClick: () => run(`${nameOf(id)} 已标记为不可用`, { action: "mark", provider: id }), disabled: m.busy }, "标记不可用")));
				}))));
	}

	function FailoverCard({ m, data, all, own }) {
		const f = rec(own.value?.failover);
		const [enabled, setEnabled] = useState(() => f.enabled !== false);
		const [scope, setScope] = useState(() => (SCOPE_OPTIONS.some(([k]) => k === f.scope) ? f.scope : "all"));
		const [cooldown, setCooldown] = useState(() => String(typeof f.cooldownMinutes === "number" ? f.cooldownMinutes : 30));
		const [codes, setCodes] = useState(() => (Array.isArray(f.codes) ? f.codes.filter(str) : [...DEFAULT_FAILOVER_CODES]));
		const [chain, setChain] = useState(() => (Array.isArray(f.chain) ? f.chain : []).filter(isRec).map((c) => ({ key: keyOf(c.provider ?? "", c.model ?? ""), effort: str(c.reasoningEffort) ?? "" })));
		const extraCodes = ["RATE_LIMIT", "TIMEOUT"];
		const toggleCode = (c, on) => setCodes((s) => (on ? [...new Set([...s, c])] : s.filter((x) => x !== c)));
		const patch = (i, p) => setChain((s) => s.map((x, j) => (j === i ? { ...x, ...p } : x)));
		const move = (i, d) => setChain((s) => {
			const j = i + d;
			if (j < 0 || j >= s.length) return s;
			const n = [...s];
			[n[i], n[j]] = [n[j], n[i]];
			return n;
		});
		const firstKey = all[0] ? keyOf(all[0].provider, all[0].id) : "";
		const providersInChain = chain.map((c) => splitKey(c.key)[0]);
		const sameProvider = providersInChain.length > 1 && new Set(providersInChain).size === 1;
		const save = () => {
			const minutes = Number(cooldown);
			if (!Number.isFinite(minutes) || minutes < 0) return m.notify("err", "冷却时间需为非负数字");
			const list = chain.filter((c) => c.key).map((c) => {
				const [provider, model] = splitKey(c.key);
				return { provider, model, reasoningEffort: c.effort };
			});
			return m.run("故障切换设置已保存", () => m.write(OWN_NS, [{ op: "set", path: ["failover"], value: { enabled, scope, cooldownMinutes: Math.min(1440, minutes), codes, chain: list } }]));
		};
		return h("div", { style: S.card },
			h("div", { style: S.cardTitle }, "自动故障切换"),
			h("div", { style: S.hint }, "模型调用因下列错误失败时，标记该服务商不可用，并立即用备用链中第一个可用（且属于其他服务商）的模型重试同一步。备用模型的推理程度留空时，按原档位自动换算。"),
			h("div", { style: S.grid },
				h(Field, { label: "开关" }, h(Check, { checked: enabled, onChange: setEnabled, label: "启用自动故障切换" })),
				h(Field, { label: "作用范围" }, h(Select, { value: scope, onChange: setScope, options: SCOPE_OPTIONS })),
				h(Field, { label: "冷却时间（分钟，0 = 直到手动恢复）" }, h(TextInput, { value: cooldown, onChange: setCooldown, ariaLabel: "冷却时间（分钟）" }))),
			h("div", { style: { fontSize: 12, color: C.fg2, margin: "4px 0" } }, "触发切换的错误（HTTP 402 总会触发）"),
			h("div", { style: { ...S.row, marginBottom: 10 } },
				[...DEFAULT_FAILOVER_CODES, ...extraCodes].map((c) => h(Check, { key: c, checked: codes.includes(c), onChange: (on) => toggleCode(c, on), label: h("span", { title: c }, CODE_TEXT[c] ?? c) }))),
			h("div", { style: { fontSize: 12, color: C.fg2, margin: "4px 0" } }, "备用模型（按顺序尝试）"),
			chain.length === 0 ? h("div", { style: { color: C.fg2, margin: "6px 0" } }, "暂无备用模型。") : null,
			chain.map((c, i) => {
				const [p, md] = splitKey(c.key);
				return h("div", { key: i, style: { ...S.row, marginBottom: 6 } },
					h("span", { style: { width: 20, color: C.fg2 } }, `${i + 1}.`),
					h(ModelSelect, { catalog: data.catalog, value: c.key, ariaLabel: `备用模型 ${i + 1}`, onChange: (v) => patch(i, { key: v, effort: "" }) }),
					h(Select, { value: c.effort, ariaLabel: `备用模型 ${i + 1} 推理程度`, style: { width: 170 }, onChange: (v) => patch(i, { effort: v }), options: effortOptionsFor(all, p, md, "自动换算") }),
					h(Btn, { onClick: () => move(i, -1), disabled: i === 0, title: "上移" }, "↑"),
					h(Btn, { onClick: () => move(i, 1), disabled: i === chain.length - 1, title: "下移" }, "↓"),
					h(Btn, { kind: "danger", onClick: () => setChain((s) => s.filter((_, j) => j !== i)) }, "删除"));
			}),
			sameProvider ? h("div", { style: S.warnBox }, "备用模型都在同一个服务商下：该服务商自身不可用时没有可切换的目标，建议加入其他服务商的模型。") : null,
			h("div", { style: { ...S.row, justifyContent: "space-between", marginTop: 10 } },
				h(Btn, { onClick: () => setChain((s) => [...s, { key: firstKey, effort: "" }]), disabled: !firstKey }, "+ 添加备用模型"),
				h(Btn, { kind: "primary", onClick: save, disabled: m.busy }, "保存故障切换设置")));
	}

	function RedirectCard({ m, data, all, own }) {
		const groups = data.catalog?.groups ?? [];
		const toRow = (r) => ({
			enabled: r.enabled !== false,
			fromProvider: str(r.fromProvider) ?? "",
			fromModel: str(r.fromModel) ?? "",
			to: keyOf(str(r.toProvider) ?? "", str(r.toModel) ?? ""),
			toEffort: str(r.toEffort) ?? "",
			scope: SCOPE_OPTIONS.some(([k]) => k === r.scope) ? r.scope : "all"
		});
		const [rows, setRows] = useState(() => (Array.isArray(own.value?.redirects) ? own.value.redirects : []).filter(isRec).map(toRow));
		const patch = (i, p) => setRows((s) => s.map((x, j) => (j === i ? { ...x, ...p } : x)));
		const providerIds = [...new Set([...groups.map((g) => g.id), ...rows.map((r) => r.fromProvider).filter(Boolean)])];
		const firstKey = all[0] ? keyOf(all[0].provider, all[0].id) : "";
		const add = () => setRows((s) => [...s, { enabled: true, fromProvider: providerIds[0] ?? "", fromModel: "", to: firstKey, toEffort: "", scope: "all" }]);
		const save = () => {
			const list = rows.map((r) => {
				const [toProvider, toModel] = splitKey(r.to);
				return { enabled: r.enabled, fromProvider: r.fromProvider, fromModel: r.fromModel, toProvider, toModel, toEffort: r.toEffort, scope: r.scope };
			});
			const bad = list.find((r) => !r.fromProvider || !r.toProvider || !r.toModel);
			if (bad) return m.notify("err", "每条规则都需要选择来源服务商和目标模型");
			return m.run("重定向规则已保存", () => m.write(OWN_NS, [{ op: "set", path: ["redirects"], value: list }]));
		};
		return h("div", { style: S.card },
			h("div", { style: S.cardTitle }, "模型重定向"),
			h("div", { style: S.hint }, "把发往某个服务商（或某个模型）的请求改发到另一个模型。对已经在运行的子代理同样生效，从它的下一次模型调用开始。按顺序取第一条命中的规则。已经切换过去的子代理通常会继续使用新模型，删除规则后也不会自动切回。"),
			rows.length === 0 ? h("div", { style: { color: C.fg2, margin: "6px 0" } }, "暂无重定向规则。") : null,
			rows.length ? h("table", { style: S.table },
				h("thead", null, h("tr", null, ["启用", "来源服务商", "来源模型", "改用模型", "推理程度", "范围", ""].map((t, i) => h("th", { key: i, style: S.th }, t)))),
				h("tbody", null, rows.map((r, i) => {
					const [tp, tm] = splitKey(r.to);
					const models = groups.find((g) => g.id === r.fromProvider)?.models ?? [];
					const modelOpts = [["", "全部模型"], ...models.map((md) => [md.id, md.id])];
					if (r.fromModel && !models.some((md) => md.id === r.fromModel)) modelOpts.push([r.fromModel, r.fromModel]);
					const same = tp === r.fromProvider && (tm === r.fromModel);
					return h("tr", { key: i },
						h("td", { style: S.td }, h(Check, { checked: r.enabled, onChange: (v) => patch(i, { enabled: v }), label: "" })),
						h("td", { style: S.td }, h(Select, { value: r.fromProvider, ariaLabel: `规则 ${i + 1} 来源服务商`, style: { width: 150 }, onChange: (v) => patch(i, { fromProvider: v, fromModel: "" }),
							options: providerIds.map((id) => [id, groups.find((g) => g.id === id)?.name || id]) })),
						h("td", { style: S.td }, h(Select, { value: r.fromModel, ariaLabel: `规则 ${i + 1} 来源模型`, style: { width: 170 }, onChange: (v) => patch(i, { fromModel: v }), options: modelOpts })),
						h("td", { style: S.td }, h(ModelSelect, { catalog: data.catalog, value: r.to, ariaLabel: `规则 ${i + 1} 目标模型`, onChange: (v) => patch(i, { to: v, toEffort: "" }) }),
							same ? h("div", { style: { color: C.warn, fontSize: 11 } }, "来源和目标相同，不会生效") : null),
						h("td", { style: S.td }, h(Select, { value: r.toEffort, ariaLabel: `规则 ${i + 1} 推理程度`, style: { width: 140 }, onChange: (v) => patch(i, { toEffort: v }), options: effortOptionsFor(all, tp, tm, "自动换算") })),
						h("td", { style: S.td }, h(Select, { value: r.scope, ariaLabel: `规则 ${i + 1} 范围`, style: { width: 130 }, onChange: (v) => patch(i, { scope: v }), options: SCOPE_OPTIONS })),
						h("td", { style: { ...S.td, textAlign: "right" } }, h(Btn, { kind: "danger", onClick: () => setRows((s) => s.filter((_, j) => j !== i)) }, "删除")));
				}))) : null,
			h("div", { style: { ...S.row, justifyContent: "space-between", marginTop: 10 } },
				h(Btn, { onClick: add, disabled: !firstKey && providerIds.length === 0 }, "+ 添加规则"),
				h(Btn, { kind: "primary", onClick: save, disabled: m.busy }, "保存重定向规则")));
	}

	const EVENT_TEXT = { route: "切换", down: "不可用", recovered: "已恢复", failover: "故障重试", override: "手动指定", "override-cleared": "取消指定" };
	const ROUTE_KIND_TEXT = { redirect: "重定向", failover: "故障切换", exhausted: "无可用备用" };
	const RECOVER_TEXT = { cooldown: "冷却结束", manual: "手动恢复", probe: "测试连通" };

	function EventsCard({ m, fo }) {
		const events = fo.st.data?.events ?? [];
		const detail = (e) => {
			if (e.type === "route") return `${ROUTE_KIND_TEXT[e.kind] ?? e.kind}：${e.from}${e.to ? ` → ${e.to}` : ""}${e.effort ? ` · ${e.effort}` : ""}${e.count > 1 ? ` ×${e.count}` : ""}`;
			if (e.type === "down") return `${e.provider} · ${CODE_TEXT[e.code] ?? e.code}${e.message ? ` · ${e.message.slice(0, 100)}` : ""}`;
			if (e.type === "recovered") return `${e.provider} · ${RECOVER_TEXT[e.reason] ?? e.reason}`;
			if (e.type === "failover") return `${e.provider} 失败（${CODE_TEXT[e.code] ?? e.code ?? "?"}），改用 ${e.to} 重试`;
			if (e.type === "override") return `${e.from ? `${e.from} → ` : ""}${e.to}${e.effort ? ` · ${e.effort}` : ""}`;
			if (e.type === "override-cleared") return "恢复为会话自身的模型";
			return "";
		};
		return h("div", { style: S.card },
			h("div", { style: { ...S.row, justifyContent: "space-between" } },
				h("div", { style: S.cardTitle }, `切换记录（${events.length}）`),
				events.length ? h(Btn, { onClick: () => m.run("已清空", () => fo.act({ action: "clear-events" })), disabled: m.busy }, "清空") : null),
			h("div", { style: S.hint }, "仅保存在内存中，重启 DSH 后清空；服务商状态同理。"),
			events.length === 0 ? h("div", { style: { color: C.fg2 } }, "暂无记录。") : h("table", { style: S.table },
				h("thead", null, h("tr", null, ["时间", "类型", "会话", "详情"].map((t) => h("th", { key: t, style: S.th }, t)))),
				h("tbody", null, events.map((e) => h("tr", { key: e.seq },
					h("td", { style: { ...S.td, whiteSpace: "nowrap" } }, fmtClock(e.lastAt ?? e.at)),
					h("td", { style: { ...S.td, color: e.type === "down" ? C.err : e.type === "recovered" ? C.ok : C.fg } }, EVENT_TEXT[e.type] ?? e.type),
					h("td", { style: { ...S.td, ...S.mono, color: C.fg2 } }, e.sessionId ? `${e.subagent ? "子代理 " : "主代理 "}${String(e.sessionId).slice(0, 8)}` : "—"),
					h("td", { style: { ...S.td, wordBreak: "break-word" } }, detail(e)))))));
	}

	function FailoverTab({ m, api, active }) {
		const data = m.state.data;
		const own = findView(data.desc, OWN_NS);
		const fo = useFailover(api, active);
		const all = catalogModels(data.catalog);
		if (!own) return h("div", { style: S.card }, h("div", { style: S.warnBox }, "主机端插件尚未加载（未找到 model-manager 设置分区）。安装后需重启 DSH 一次。"));
		const v = rec(own.value);
		return h(React.Fragment, null,
			h("div", { style: { ...S.hint, marginBottom: 12 } }, "子代理派遣时会复制主代理当时的模型，DSH 自身不允许在子代理会话里再切换。这里的会话指定、重定向和故障切换在每次模型调用前改写目标，所以对已经在运行的子代理同样有效。"),
			h(HealthCard, { m, data, fo }),
			h(SessionsCard, { api, data, active }),
			h(FailoverCard, { m, data, all, own, key: `f:${JSON.stringify(v.failover ?? null)}` }),
			h(RedirectCard, { m, data, all, own, key: `r:${JSON.stringify(v.redirects ?? null)}` }),
			h(EventsCard, { m, fo }));
	}

	// ---------------------------------------------------------------- per-session model override
	// DSH hides its composer model seat in subagent Sessions and the Host rejects
	// session.selectModel for them; these controls set a Host-side per-session
	// override that agent/request applies from the session's next model call.
	let catalogCache;
	const loadCatalog = (api) => {
		if (!catalogCache || Date.now() - catalogCache.at > 60000) {
			const promise = api.catalog().catch((e) => {
				catalogCache = undefined;
				throw e;
			});
			catalogCache = { at: Date.now(), promise };
		}
		return catalogCache.promise;
	};
	const usageText = (u) => (u ? `${u.total.calls} 次 · ${fmtTok(tokTotal(u.total))} tokens${u.cost !== null && u.cost !== undefined ? ` · ${fmtCost(u.cost, u.currency)}${u.costComplete ? "" : "+"}` : ""}` : "—");
	const refText = (r) => (r ? `${r.provider}/${r.model}${r.reasoningEffort ? ` · ${LEVEL_LABEL[r.reasoningEffort] ?? r.reasoningEffort}` : ""}` : "—");

	function SessionOverrideEditor({ api, catalog, sessionId, session, onSaved }) {
		const ov = session?.override ?? null;
		const cur = ov ?? (session?.provider ? session : null);
		const [sel, setSel] = useState(cur ? keyOf(cur.provider, cur.model) : "");
		const [effort, setEffort] = useState(ov?.reasoningEffort ?? "");
		const [busy, setBusy] = useState(false);
		const [msg, setMsg] = useState(null);
		const all = catalogModels(catalog);
		const [provider, model] = splitKey(sel);
		const run = async (body, done) => {
			setBusy(true);
			setMsg(null);
			try {
				const res = await api.sessionsAction(body);
				setMsg({ kind: "ok", text: done });
				onSaved?.(res.session ?? null);
			} catch (e) {
				setMsg({ kind: "err", text: e.message });
			} finally {
				setBusy(false);
			}
		};
		const apply = () => run({ action: "set", sessionId, provider, model, ...(effort ? { reasoningEffort: effort } : {}) }, "已指定，从下一次模型调用起生效");
		return h("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
			h(ModelSelect, { catalog, value: sel, onChange: (v) => { setSel(v); setEffort(""); }, ariaLabel: "指定模型", extra: "选择模型…" }),
			h(Select, { value: effort, onChange: setEffort, ariaLabel: "指定推理程度", options: effortOptionsFor(all, provider, model, "沿用当前推理程度（自动换算）"), disabled: !sel }),
			h("div", { style: S.row },
				h(Btn, { kind: "primary", onClick: apply, disabled: busy || !sel }, "应用"),
				ov ? h(Btn, { onClick: () => run({ action: "clear", sessionId }, "已取消指定"), disabled: busy }, "取消指定") : null),
			msg ? h("div", { role: "status", style: { fontSize: 12, color: msg.kind === "err" ? C.err : C.ok } }, msg.text) : null);
	}

	function SessionsCard({ api, data, active }) {
		const [st, setSt] = useState({ status: "loading" });
		const [editing, setEditing] = useState(null);
		const load = useCallback(async () => {
			try {
				setSt({ status: "ready", data: await api.sessions() });
			} catch (e) {
				setSt((s) => ({ ...s, status: "error", error: e.message, code: e.code }));
			}
		}, [api]);
		useEffect(() => {
			if (!active) return undefined;
			load();
			const timer = setInterval(load, 4000);
			return () => clearInterval(timer);
		}, [active, load]);
		const list = st.data?.sessions ?? [];
		const overridden = list.filter((s) => s.override).length;
		const clearAll = async () => {
			try {
				setSt({ status: "ready", data: await api.sessionsAction({ action: "clear" }) });
			} catch (e) {
				setSt((s) => ({ ...s, error: e.message }));
			}
		};
		return h("div", { style: S.card },
			h("div", { style: { ...S.row, justifyContent: "space-between" } },
				h("div", { style: S.cardTitle }, `会话模型（${list.length}）`),
				overridden ? h(Btn, { onClick: clearAll }, `全部取消指定（${overridden}）`) : null),
			h("div", { style: S.hint }, "列出最近调用过模型的会话。可以给任意会话（包括正在运行的子代理）单独指定模型，从它的下一次模型调用起生效；子代理会话的输入框右侧也有同样的入口。手动指定优先于重定向规则，指定的服务商不可用时仍会走故障切换。"),
			st.status === "error" && st.code === "NO_HOST_ROUTE" ? h("div", { style: S.warnBox }, NO_HOST) : st.error ? h("div", { style: { color: C.err } }, st.error) : null,
			list.length === 0 ? h("div", { style: { color: C.fg2 } }, st.status === "loading" ? "加载中…" : "暂无记录：会话发起模型调用后会出现在这里。") : h("table", { style: S.table },
				h("thead", null, h("tr", null, ["会话", "当前模型", "派遣时 / 会话自身", "最近调用", "用量", ""].map((t) => h("th", { key: t || "op", style: S.th }, t)))),
				h("tbody", null, list.flatMap((s) => {
					const row = h("tr", { key: s.sessionId },
						h("td", { style: { ...S.td, ...S.mono, whiteSpace: "nowrap" } }, `${s.subagent ? "子代理" : s.subagent === false ? "主代理" : "会话"} ${String(s.sessionId).slice(0, 8)}`, s.depth ? h("span", { style: { color: C.fg2 } }, ` · 深度 ${s.depth}`) : null),
						h("td", { style: { ...S.td, ...S.mono, wordBreak: "break-all" } }, s.provider ? refText(s) : "—", s.override ? h("div", { style: { color: C.warn, fontSize: 11 } }, `手动指定：${refText(s.override)}`) : null),
						h("td", { style: { ...S.td, ...S.mono, color: C.fg2, wordBreak: "break-all" } }, refText(s.original)),
						h("td", { style: { ...S.td, whiteSpace: "nowrap" } }, fmtClock(s.lastAt), s.requests ? h("span", { style: { color: C.fg2 } }, ` · ${s.requests} 次`) : null),
						h("td", { style: { ...S.td, whiteSpace: "nowrap" } }, usageText(s.usage)),
						h("td", { style: { ...S.td, textAlign: "right" } }, h(Btn, { onClick: () => setEditing(editing === s.sessionId ? null : s.sessionId) }, editing === s.sessionId ? "收起" : "指定模型")));
					if (editing !== s.sessionId) return [row];
					return [row, h("tr", { key: `${s.sessionId}:edit` }, h("td", { colSpan: 6, style: S.td },
						h(SessionOverrideEditor, { api, catalog: data.catalog, sessionId: s.sessionId, session: s, onSaved: () => load() })))];
				}))));
	}

	/** Composer seat for subagent Sessions, where DSH hides its own model selector. */
	function SubagentModelSeatInner({ api, sessionId }) {
		const [st, setSt] = useState({ status: "loading" });
		const [open, setOpen] = useState(false);
		const [catalog, setCatalog] = useState(undefined);
		const [pos, setPos] = useState(null);
		const btnRef = useRef(null);
		const popRef = useRef(null);
		const load = useCallback(async () => {
			try {
				setSt({ status: "ready", data: await api.sessions(sessionId) });
			} catch (e) {
				setSt((s) => ({ ...s, status: "error", error: e.message, code: e.code }));
			}
		}, [api, sessionId]);
		useEffect(() => {
			load();
			const timer = setInterval(load, open ? 3000 : 8000);
			return () => clearInterval(timer);
		}, [load, open]);
		useEffect(() => {
			if (!open) return undefined;
			let alive = true;
			loadCatalog(api).then((c) => alive && setCatalog(c), () => alive && setCatalog(null));
			const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
			const onDown = (e) => {
				const t = e.target;
				if (popRef.current?.contains?.(t) || btnRef.current?.contains?.(t)) return;
				setOpen(false);
			};
			globalThis.document?.addEventListener?.("keydown", onKey);
			globalThis.document?.addEventListener?.("mousedown", onDown);
			return () => {
				alive = false;
				globalThis.document?.removeEventListener?.("keydown", onKey);
				globalThis.document?.removeEventListener?.("mousedown", onDown);
			};
		}, [open, api]);
		const s = st.data?.session ?? null;
		const shown = s?.override ?? (s?.provider ? s : null);
		const toggle = () => {
			if (!open) {
				const r = btnRef.current?.getBoundingClientRect?.();
				setPos(r ? { right: Math.max(8, (globalThis.innerWidth ?? 0) - r.right), bottom: Math.max(8, (globalThis.innerHeight ?? 0) - r.top + 6) } : null);
			}
			setOpen(!open);
		};
		const label = shown ? `${shown.model}${shown.reasoningEffort ? ` · ${LEVEL_LABEL[shown.reasoningEffort] ?? shown.reasoningEffort}` : ""}` : "子代理模型";
		return h("span", { style: { position: "relative", display: "inline-flex" } },
			h("button", {
				ref: btnRef, type: "button", onClick: toggle, "aria-haspopup": "dialog", "aria-expanded": open,
				title: shown ? `子代理模型：${refText(shown)}${s?.override ? "（手动指定）" : ""}` : "切换这个子代理的模型",
				style: { display: "inline-flex", alignItems: "center", gap: 4, height: 28, maxWidth: 220, padding: "0 8px", border: "none", borderRadius: 6, background: "transparent", color: s?.override ? C.warn : C.fg2, cursor: "pointer", fontSize: 13 }
			},
				h(ModelIcon, { size: 14 }),
				h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, label),
				h("span", { "aria-hidden": true, style: { fontSize: 10 } }, "▾")),
			open ? h("div", {
				ref: popRef, role: "dialog", "aria-label": "切换子代理模型",
				style: { position: "fixed", ...(pos ?? { right: 16, bottom: 96 }), zIndex: 1000, width: 340, boxSizing: "border-box", padding: 12, borderRadius: 10, border: `1px solid ${C.b2}`, background: C.bg, color: C.fg, boxShadow: "0 8px 28px rgba(0,0,0,.18)", fontSize: 13, lineHeight: 1.5 }
			},
				h("div", { style: { fontWeight: 600, marginBottom: 4 } }, "子代理模型"),
				h("div", { style: S.hint }, "DSH 不允许在子代理会话里直接换模型；这里由模型管理插件接管，从这个子代理的下一次模型调用起生效（正在进行的那一步不受影响）。"),
				st.status === "error" ? h("div", { style: S.warnBox }, st.code === "NO_HOST_ROUTE" ? NO_HOST : st.error) : null,
				s ? h("div", { style: { fontSize: 12, color: C.fg2, marginBottom: 8 } },
					h("div", null, "当前：", h("span", { style: S.mono }, refText(s.provider ? s : null))),
					s.original ? h("div", null, "派遣时：", h("span", { style: S.mono }, refText(s.original))) : null,
					s.usage ? h("div", null, "用量：", usageText(s.usage)) : null) : st.status === "ready" ? h("div", { style: { fontSize: 12, color: C.fg2, marginBottom: 8 } }, "这个子代理在本次启动后还没有发起过模型调用；指定后会在它下一次调用时生效。") : null,
				catalog === undefined ? h("div", { style: { color: C.fg2 } }, "加载模型列表…")
					: catalog === null ? h("div", { style: { color: C.err } }, "模型列表加载失败")
						: h(SessionOverrideEditor, { api, catalog, sessionId, session: s, key: s?.override ? JSON.stringify(s.override) : "none", onSaved: () => load() }),
				s?.override ? h("div", { style: { ...S.hint, marginTop: 8, marginBottom: 0 } }, "取消指定后，子代理可能继续沿用当前模型；要换回原模型请直接指定它。") : null) : null);
	}
	function ConversationSpeedSeat({ api, sessionId }) {
		const [st, setSt] = useState({ status: "loading" });
		const load = useCallback(async () => {
			if (!sessionId) return;
			try { setSt({ status: "ready", data: await api.sessions(sessionId) }); }
			catch (e) { setSt({ status: "error", error: e.message }); }
		}, [api, sessionId]);
		useEffect(() => {
			load();
			const timer = setInterval(load, 3000);
			return () => clearInterval(timer);
		}, [load]);
		if (!sessionId) return null;
		const speed = st.data?.session?.usage?.tokensPerSec;
		const text = typeof speed === "number" && Number.isFinite(speed) ? `${speed} tok/s` : "暂无速度";
		return h("span", {
			title: typeof speed === "number" ? "最近一次已完成模型调用的实际输出速度；每 3 秒刷新" : "当前会话还没有可计算速度的模型调用",
			style: { display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", color: typeof speed === "number" ? C.fg2 : C.idle, fontSize: 11, marginLeft: 4 }
		}, `⚡ ${text}`);
	}

	function SubagentModelSeat({ api, sessionId, useSession }) {
		const isSubagent = typeof useSession === "function" ? useSession((s) => s?.subagent != null) : false;
		if (!sessionId) return null;
		return h(React.Fragment, null,
			h(ConversationSpeedSeat, { api, sessionId }),
			isSubagent ? h(SubagentModelSeatInner, { api, sessionId }) : null);
	}

	// ---------------------------------------------------------------- usage
	const pad2 = (n) => String(n).padStart(2, "0");
	/** Local day key offset by `delta` days (Host and browser share the machine's time zone). */
	const dayKeyLocal = (delta = 0) => {
		const d = new Date();
		d.setDate(d.getDate() + delta);
		return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
	};
	const tokTotal = (c) => (c.inputTokens ?? 0) + (c.outputTokens ?? 0) + (c.cacheReadTokens ?? 0) + (c.cacheWriteTokens ?? 0);
	const fmtTok = (n) => {
		if (typeof n !== "number" || !Number.isFinite(n)) return "—";
		if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
		if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
		if (n >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
		return String(Math.round(n));
	};
	const CUR_SIGN = { CNY: "¥", USD: "$", EUR: "€" };
	const fmtCost = (v, cur) => {
		if (typeof v !== "number") return "—";
		const digits = v === 0 ? 2 : v < 0.01 ? 4 : v < 1 ? 3 : 2;
		return `${CUR_SIGN[cur] ?? `${cur ?? ""} `}${v.toFixed(digits)}`;
	};
	const fmtCostMap = (map) => {
		const parts = Object.entries(map ?? {}).filter(([, v]) => typeof v === "number");
		return parts.length ? parts.map(([cur, v]) => fmtCost(v, cur)).join(" + ") : "—";
	};
	const KIND_TEXT = { main: "主代理", subagent: "子代理", probe: "测试", other: "其他（标题等）" };
	const OUTCOME_TEXT = { ok: "成功", error: "失败", aborted: "中断" };

	/** Sum bucket rows; cost per currency, plus tokens that had no price. */
	function sumRows(rows) {
		const a = { calls: 0, errors: 0, aborted: 0, noUsage: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, durationMs: 0, firstTokenMs: 0, firstTokenCalls: 0, cost: {}, unpricedTokens: 0 };
		for (const r of rows) {
			for (const k of ["calls", "errors", "aborted", "noUsage", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokens", "durationMs", "firstTokenMs", "firstTokenCalls"]) a[k] += r[k] ?? 0;
			if (typeof r.cost === "number") a.cost[r.currency ?? "CNY"] = (a.cost[r.currency ?? "CNY"] ?? 0) + r.cost;
			else a.unpricedTokens += tokTotal(r);
		}
		a.tokens = tokTotal(a);
		return a;
	}
	const groupRows = (rows, keyFn) => {
		const map = new Map();
		for (const r of rows) {
			const k = keyFn(r);
			if (!map.has(k)) map.set(k, { key: k, sample: r, rows: [] });
			map.get(k).rows.push(r);
		}
		return [...map.values()].map((g) => ({ ...g, sum: sumRows(g.rows) }));
	};
	const cacheRate = (s) => {
		const inTotal = s.inputTokens + s.cacheReadTokens + s.cacheWriteTokens;
		return inTotal > 0 ? `${Math.round((s.cacheReadTokens / inTotal) * 100)}%` : "—";
	};
	const RANGES = [["1", "今天"], ["7", "近 7 天"], ["30", "近 30 天"], ["90", "近 90 天"], ["all", "全部"]];

	function StatBox({ label, value, sub, title, ring, delta }) {
		return h("div", { title, style: { flex: "1 1 150px", minWidth: 140, padding: "10px 12px", borderRadius: 8, border: `1px solid ${C.b1}`, background: C.bg, display: "flex", gap: 10, alignItems: "center" } },
			ring ? h(Ring, ring) : null,
			h("div", { style: { minWidth: 0 } },
				h("div", { style: { fontSize: 12, color: C.fg2 } }, label),
				h("div", { style: { fontSize: 18, fontWeight: 600, margin: "2px 0", display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" } }, value,
					delta ? h("span", { title: delta.title, style: { fontSize: 11, fontWeight: 500, padding: "0 6px", borderRadius: 4, background: C.l2, color: C.fg2 } }, delta.text) : null),
				sub ? h("div", { style: { fontSize: 11, color: C.fg2 } }, sub) : null));
	}

	// ---------------------------------------------------------------- usage UI helpers
	/** useState persisted in localStorage; `allowed` restricts restored values. */
	function usePref(key, init, allowed) {
		const [v, setV] = useState(() => {
			const raw = lsGet(`model-manager.${key}`, null);
			if (raw === null) return init;
			if (typeof init === "boolean") return raw === "1";
			return !allowed || allowed.includes(raw) ? raw : init;
		});
		const set = useCallback((nv) => {
			setV(nv);
			lsSet(`model-manager.${key}`, typeof nv === "boolean" ? (nv ? "1" : "0") : String(nv));
		}, [key]);
		return [v, set];
	}

	/** Segmented control (radio group). options: [value, label, {disabled, title}?] */
	function Seg({ value, onChange, options, label }) {
		return h("div", { role: "radiogroup", "aria-label": label, style: { display: "inline-flex", border: `1px solid ${C.b1}`, borderRadius: 8, overflow: "hidden", flexShrink: 0 } },
			options.map(([k, t, o]) => {
				const disabled = !!o?.disabled;
				const on = value === k;
				return h("button", {
					key: k, type: "button", role: "radio", "aria-checked": on, disabled, title: o?.title,
					onClick: () => onChange(k),
					style: { border: "none", padding: "4px 10px", fontSize: 12, whiteSpace: "nowrap", cursor: disabled ? "not-allowed" : "pointer", background: on ? C.brand : "transparent", color: on ? "#fff" : disabled ? C.fg2 : C.fg, opacity: disabled ? 0.5 : 1 }
				}, t);
			}));
	}

	/** Collapsible card; the open state is remembered per id. */
	function Card({ id, title, summary, right, children, defaultOpen = true }) {
		const [open, setOpen] = usePref(`card.${id}`, defaultOpen);
		const bodyId = `mm-card-${id}`;
		return h("div", { style: S.card },
			h("div", { style: { ...S.row, justifyContent: "space-between" } },
				h("button", {
					type: "button", "aria-expanded": open, "aria-controls": bodyId, onClick: () => setOpen(!open),
					style: { display: "inline-flex", alignItems: "center", gap: 8, border: "none", background: "none", padding: 0, cursor: "pointer", color: C.fg, textAlign: "left", fontFamily: "inherit", minWidth: 0 }
				},
					h("span", { "aria-hidden": true, style: { display: "inline-block", width: 10, fontSize: 10, color: C.fg2, transform: open ? "rotate(90deg)" : "none", transition: "transform .12s" } }, "▶"),
					h("span", { style: { ...S.cardTitle, margin: 0 } }, title),
					summary ? h("span", { style: { fontSize: 12, color: C.fg2, fontWeight: 400 } }, summary) : null),
				open && right ? h("div", { style: S.row }, right) : null),
			open ? h("div", { id: bodyId, style: { marginTop: 10 } }, children) : null);
	}

	const dayKeyOfTs = (t) => {
		const d = new Date(t);
		return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
	};
	/** Time for today, "MM-DD HH:mm" otherwise. */
	const fmtWhen = (t) => {
		if (typeof t !== "number") return "—";
		const d = new Date(t);
		return dayKeyOfTs(t) === dayKeyLocal(0) ? d.toLocaleTimeString() : `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
	};
	/** Period-over-period change, for the summary boxes. */
	const deltaOf = (cur, prev, fmt) => {
		if (!(prev > 0) && !(cur > 0)) return null;
		const title = `上一周期：${fmt(prev)}`;
		if (!(prev > 0)) return { text: "新增", title };
		const r = (cur - prev) / prev;
		if (Math.abs(r) < 0.005) return { text: "持平", title };
		return { text: `${r > 0 ? "↑" : "↓"} ${Math.abs(r * 100) >= 100 ? Math.round(r * 100) : (r * 100).toFixed(1)}%`, title, up: r > 0 };
	};

	// ---------------------------------------------------------------- charts (inline SVG, no deps)
	const SERIES = ["#4d6bfe", "#12b886", "#f59f00", "#e64980", "#7950f2", "#15aabf"];
	const OTHER_COLOR = "#adb5bd";
	const MIX = [["inputTokens", "输入", "#4d6bfe"], ["cacheReadTokens", "缓存命中", "#12b886"], ["cacheWriteTokens", "缓存写入", "#f59f00"], ["outputTokens", "输出", "#e64980"]];
	const KIND_COLOR = { main: "#4d6bfe", subagent: "#7950f2", probe: "#adb5bd", other: "#15aabf" };
	const USAGE_KINDS_CLIENT = ["main", "subagent", "other", "probe"];
	const USAGE_RECENT_CAP = 300;
	// [key, label, ratio?] — ratio metrics are averages / rates: drawn as lines, never stacked or summed.
	const METRICS = [["tokens", "tokens"], ["calls", "调用次数"], ["cost", "费用"], ["latency", "平均耗时", true], ["ttft", "首 token", true], ["errorRate", "失败率", true], ["cacheRate", "缓存命中率", true]];
	const isRatio = (metric) => !!METRICS.find((x) => x[0] === metric)?.[2];
	const metricLabel = (metric) => METRICS.find((x) => x[0] === metric)?.[1] ?? metric;
	/** Value of one summed counter (from sumRows) for a metric; NaN when undefined for that counter. */
	const metricOf = (metric, cur) => (s) => {
		if (!s) return metric === "tokens" || metric === "calls" || metric === "cost" ? 0 : NaN;
		switch (metric) {
			case "calls": return s.calls;
			case "cost": return s.cost?.[cur] ?? 0;
			case "latency": return s.calls ? s.durationMs / s.calls : NaN;
			case "ttft": return s.firstTokenCalls ? s.firstTokenMs / s.firstTokenCalls : NaN;
			case "errorRate": return s.calls ? s.errors / s.calls : NaN;
			case "cacheRate": {
				const p = s.inputTokens + s.cacheReadTokens + s.cacheWriteTokens;
				return p ? s.cacheReadTokens / p : NaN;
			}
			default: return s.tokens ?? tokTotal(s);
		}
	};
	const fmtPct = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(v >= 0.1 || v === 0 ? 0 : 1)}%` : "—");
	const fmtMetric = (metric, cur) => (v) => {
		if (!Number.isFinite(v)) return "—";
		switch (metric) {
			case "calls": return String(Math.round(v));
			case "cost": return fmtCost(v, cur);
			case "latency": case "ttft": return fmtMs(v);
			case "errorRate": case "cacheRate": return fmtPct(v);
			default: return fmtTok(v);
		}
	};
	/** Round up to 1/2/2.5/5 × 10^n for a readable axis. */
	const niceMax = (v) => {
		if (!(v > 0)) return 1;
		const p = 10 ** Math.floor(Math.log10(v));
		return ([1, 2, 2.5, 5, 10].find((s) => s * p >= v) ?? 10) * p;
	};
	const tipStyle = { position: "absolute", top: 0, zIndex: 2, pointerEvents: "none", minWidth: 170, maxWidth: 300, padding: "8px 10px", borderRadius: 8, fontSize: 12, lineHeight: 1.6, background: C.bg, color: C.fg, border: `1px solid ${C.b1}`, boxShadow: "0 4px 16px rgba(0,0,0,.12)" };
	const Swatch = ({ color, line }) => h("span", { "aria-hidden": true, style: { display: "inline-block", width: 10, height: line ? 2 : 10, borderRadius: 2, background: color, marginRight: 6, verticalAlign: line ? "3px" : "-1px", flexShrink: 0 } });

	const GRAINS = [["auto", "自动"], ["hour", "按小时"], ["day", "按天"], ["week", "按周"], ["month", "按月"]];
	const CHART_TYPES = [["bar", "柱状"], ["line", "折线"], ["area", "面积"], ["pct", "百分比"]];
	const SPLITS = [["group", "按模型/服务商"], ["kind", "按来源"], ["mix", "按 token 类型"], ["none", "不拆分"]];
	const WEEKDAY = "日一二三四五六";
	/** Monday of the week containing day key k. */
	const weekOf = (k) => {
		const d = new Date(`${k}T00:00:00`);
		d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
		return dayKeyOfTs(d.getTime());
	};

	/**
	 * Continuous time buckets for the trend chart.
	 * Hour buckets come from the in-memory recent-call log (today only); the
	 * others from the daily rows. Each bucket: {key, label, short, sum, parts}.
	 */
	function trendBuckets({ rows, recent, range, kinds, partKey, today, grain }) {
		const days = [...new Set(rows.map((r) => r.day))].sort();
		const start = range === "all" ? days[0] ?? today : dayKeyLocal(1 - Number(range));
		const dayKeys = [];
		for (let d = new Date(`${start}T00:00:00`); dayKeyOfTs(d.getTime()) <= today && dayKeys.length < 400; d.setDate(d.getDate() + 1)) dayKeys.push(dayKeyOfTs(d.getTime()));
		if (!dayKeys.length) dayKeys.push(today);
		const hourOk = dayKeys.length === 1 && dayKeys[0] === today;
		const unit = grain === "hour" ? (hourOk ? "hour" : "day")
			: grain !== "auto" ? grain
				: hourOk ? "hour" : dayKeys.length <= 45 ? "day" : dayKeys.length <= 120 ? "week" : "month";
		const build = (list, keyFn, keys, mk) => {
			const map = new Map(keys.map((k) => [k, []]));
			for (const r of list) map.get(keyFn(r))?.push(r);
			return keys.map((k) => {
				const items = map.get(k);
				const parts = {};
				for (const g of groupRows(items, partKey)) parts[g.key] = g.sum;
				return { key: k, ...mk(k), parts, sum: sumRows(items) };
			});
		};
		if (unit === "hour") {
			const asRow = (e) => ({
				...e, ...(e.usage ?? {}), calls: 1,
				errors: e.outcome === "error" ? 1 : 0, aborted: e.outcome === "aborted" ? 1 : 0, noUsage: e.usage ? 0 : 1,
				firstTokenMs: e.firstTokenMs ?? 0, firstTokenCalls: typeof e.firstTokenMs === "number" ? 1 : 0, durationMs: e.durationMs ?? 0,
				hour: new Date(e.at).getHours()
			});
			const list = recent.filter((e) => kinds[e.kind] !== false && dayKeyOfTs(e.at) === today).map(asRow);
			const keys = Array.from({ length: new Date().getHours() + 1 }, (_, i) => i);
			return { unit, hourOk, partial: recent.length >= USAGE_RECENT_CAP, buckets: build(list, (r) => r.hour, keys, (k) => ({ label: `今天 ${pad2(k)}:00–${pad2(k)}:59`, short: `${pad2(k)}时` })) };
		}
		if (unit === "week") {
			const keys = [...new Set(dayKeys.map(weekOf))];
			return { unit, hourOk, buckets: build(rows, (r) => weekOf(r.day), keys, (k) => ({ label: `${k} 起的一周`, short: k.slice(5) })) };
		}
		if (unit === "month") {
			const keys = [...new Set(dayKeys.map((k) => k.slice(0, 7)))];
			return { unit, hourOk, buckets: build(rows, (r) => r.day.slice(0, 7), keys, (k) => ({ label: `${k.slice(0, 4)} 年 ${Number(k.slice(5))} 月`, short: k.slice(2) })) };
		}
		return { unit: "day", hourOk, buckets: build(rows, (r) => r.day, dayKeys, (k) => ({ label: `${k}（周${WEEKDAY[new Date(`${k}T00:00:00`).getDay()]}）`, short: k.slice(5) })) };
	}

	/**
	 * Trend chart. `matrix[i][j]` is the plotted value of series j in bucket i;
	 * `raw` the unscaled value for tooltips. type: bar | line | area | pct.
	 * Stacked unless `ratio` (averages/rates) or type is line.
	 */
	function TrendChart({ buckets, series, matrix, raw, totals, rawTotals, type, ratio, fmt, axisFmt, showTotal, label }) {
		const [hover, setHover] = useState(null);
		const W = 640, H = 210, L = 54, R = 10, T = 10, B = 24;
		const pw = W - L - R, ph = H - T - B;
		const n = Math.max(1, buckets.length);
		const stacked = !ratio && type !== "line";
		const tops = matrix.map((row) => (stacked ? row.reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0) : Math.max(0, ...row.filter(Number.isFinite))));
		const peak = Math.max(0, ...tops, ...(showTotal ? totals.filter(Number.isFinite) : []));
		const max = type === "pct" ? 1 : niceMax(peak);
		const yOf = (v) => T + ph - (Math.max(0, v) / max) * ph;
		const asBars = type === "bar" || (type !== "line" && !ratio && n === 1);
		const slot = pw / n;
		const xOf = (i) => (asBars ? L + i * slot + slot / 2 : n === 1 ? L + pw / 2 : L + (i / (n - 1)) * pw);
		const every = Math.max(1, Math.ceil(n / 8));
		const showDots = n <= 31;
		const content = [];
		if (asBars) {
			const bw = Math.max(1, Math.min(36, slot * 0.72));
			buckets.forEach((b, i) => {
				let y = T + ph;
				series.forEach((s, j) => {
					const v = matrix[i][j];
					if (!(v > 0)) return;
					const hh = (v / max) * ph;
					y -= hh;
					content.push(h("rect", { key: `${b.key}:${s.key}`, x: L + i * slot + (slot - bw) / 2, y, width: bw, height: Math.max(0.5, hh), fill: s.color }));
				});
			});
		} else if (stacked) {
			// Stacked areas: draw from the top layer down so lower layers stay visible.
			const acc = matrix.map(() => 0);
			const layers = series.map((s, j) => {
				const lo = acc.slice();
				matrix.forEach((row, i) => { acc[i] += Number.isFinite(row[j]) ? row[j] : 0; });
				return { s, lo, hi: acc.slice() };
			});
			for (const { s, lo, hi } of layers.reverse()) {
				const top = hi.map((v, i) => `${xOf(i)} ${yOf(v)}`);
				const bottom = lo.map((v, i) => `${xOf(i)} ${yOf(v)}`).reverse();
				content.push(h("path", { key: `a:${s.key}`, d: `M${top.join("L")}L${bottom.join("L")}Z`, fill: s.color, fillOpacity: 0.55, stroke: s.color, strokeWidth: 1.2 }));
			}
		} else {
			// Lines; NaN (no data) breaks the line.
			series.forEach((s, j) => {
				let d = "";
				let pen = false;
				matrix.forEach((row, i) => {
					const v = row[j];
					if (!Number.isFinite(v)) { pen = false; return; }
					d += `${pen ? "L" : "M"}${xOf(i)} ${yOf(v)}`;
					pen = true;
				});
				if (d) content.push(h("path", { key: `l:${s.key}`, d, fill: "none", stroke: s.color, strokeWidth: 2, strokeLinejoin: "round", strokeLinecap: "round" }));
				if (showDots) matrix.forEach((row, i) => { if (Number.isFinite(row[j])) content.push(h("circle", { key: `d:${s.key}:${i}`, cx: xOf(i), cy: yOf(row[j]), r: hover === i ? 3.5 : 2, fill: s.color })); });
			});
		}
		if (showTotal && !asBars) {
			let d = "";
			let pen = false;
			totals.forEach((v, i) => {
				if (!Number.isFinite(v)) { pen = false; return; }
				d += `${pen ? "L" : "M"}${xOf(i)} ${yOf(v)}`;
				pen = true;
			});
			if (d) content.push(h("path", { key: "total", d, fill: "none", stroke: "currentColor", strokeOpacity: 0.7, strokeWidth: 1.5, strokeDasharray: "4 3" }));
		}
		const hb = hover === null ? null : buckets[hover];
		const tipLeft = hover === null ? 0 : Math.min(68, Math.max(0, (xOf(hover) / W) * 100 - 14));
		return h("div", { style: { position: "relative" }, onMouseLeave: () => setHover(null) },
			h("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "aria-label": label, style: { display: "block", overflow: "visible" } },
				[0, 0.25, 0.5, 0.75, 1].map((f) => {
					const y = T + ph - f * ph;
					return h("g", { key: f },
						h("line", { x1: L, x2: W - R, y1: y, y2: y, stroke: "currentColor", strokeOpacity: f === 0 ? 0.25 : 0.08 }),
						h("text", { x: L - 6, y: y + 4, textAnchor: "end", fontSize: 10, fill: "currentColor", fillOpacity: 0.55 }, axisFmt(max * f)));
				}),
				content,
				hover !== null && !asBars ? h("line", { x1: xOf(hover), x2: xOf(hover), y1: T, y2: T + ph, stroke: "currentColor", strokeOpacity: 0.25 }) : null,
				buckets.map((b, i) => {
					const x0 = asBars ? L + i * slot : n === 1 ? L : Math.max(L, xOf(i) - pw / (n - 1) / 2);
					const x1 = asBars ? x0 + slot : n === 1 ? L + pw : Math.min(W - R, xOf(i) + pw / (n - 1) / 2);
					return h("g", {
						key: b.key, tabIndex: 0, role: "listitem", "aria-label": `${b.label}：${fmt(rawTotals[i])}`,
						onMouseEnter: () => setHover(i), onFocus: () => setHover(i), onBlur: () => setHover(null), style: { outline: "none", cursor: "default" }
					},
						h("rect", { x: x0, y: T, width: Math.max(1, x1 - x0), height: ph, fill: "currentColor", fillOpacity: hover === i && asBars ? 0.06 : 0 }),
						i % every === 0 || i === n - 1 ? h("text", { x: xOf(i), y: H - 6, textAnchor: "middle", fontSize: 10, fill: "currentColor", fillOpacity: 0.55 }, b.short) : null);
				})),
			hb ? h("div", { style: { ...tipStyle, left: `${tipLeft}%` } },
				h("div", { style: { fontWeight: 600 } }, `${hb.label} · ${fmt(rawTotals[hover])}${type === "pct" ? "（100%）" : ""}`),
				h("div", { style: { color: C.fg2 } }, hb.sum.calls ? `${hb.sum.calls} 次调用${hb.sum.errors ? `，失败 ${hb.sum.errors}` : ""}${hb.sum.aborted ? `，中断 ${hb.sum.aborted}` : ""}` : "无调用"),
				series.map((s, j) => {
					const v = raw[hover][j];
					if (!Number.isFinite(v) || (!ratio && v === 0)) return null;
					return h("div", { key: s.key, style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 } },
						h("span", { style: { display: "flex", alignItems: "center", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, h(Swatch, { color: s.color }), s.label),
						h("span", { style: { whiteSpace: "nowrap" } }, fmt(v), type === "pct" && rawTotals[hover] > 0 ? h("span", { style: { color: C.fg2 } }, ` · ${fmtPct(v / rawTotals[hover])}`) : null));
				}).filter(Boolean).reverse()) : null);
	}

	/** Donut with a legend; slices are {key,label,color,value}. */
	function Donut({ slices, fmt, label, center }) {
		const [hover, setHover] = useState(null);
		const total = slices.reduce((a, s) => a + s.value, 0);
		const R = 60, r = 38, cx = 70, cy = 70;
		let acc = 0;
		const arc = (a0, a1) => {
			const p = (a, rad) => [cx + rad * Math.sin(a), cy - rad * Math.cos(a)];
			const large = a1 - a0 > Math.PI ? 1 : 0;
			const [x0, y0] = p(a0, R), [x1, y1] = p(a1, R), [x2, y2] = p(a1, r), [x3, y3] = p(a0, r);
			return `M${x0} ${y0}A${R} ${R} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r} ${r} 0 ${large} 0 ${x3} ${y3}Z`;
		};
		const hs = hover === null ? null : slices[hover];
		const nonZero = slices.filter((s) => s.value > 0);
		return h("div", { style: { display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" } },
			h("svg", { viewBox: "0 0 140 140", width: 140, height: 140, role: "img", "aria-label": label, style: { flexShrink: 0 } },
				total <= 0 ? h("circle", { cx, cy, r: (R + r) / 2, fill: "none", stroke: "currentColor", strokeOpacity: 0.1, strokeWidth: R - r }) :
					nonZero.length === 1 ? h("circle", { cx, cy, r: (R + r) / 2, fill: "none", stroke: nonZero[0].color, strokeWidth: R - r }) :
						slices.map((s, i) => {
							const a0 = (acc / total) * 2 * Math.PI;
							acc += s.value;
							const a1 = (acc / total) * 2 * Math.PI;
							return s.value > 0 ? h("path", { key: s.key, d: arc(a0, Math.max(a0 + 0.002, a1 - 0.006)), fill: s.color, opacity: hover === null || hover === i ? 1 : 0.35, onMouseEnter: () => setHover(i), onMouseLeave: () => setHover(null) }) : null;
						}),
				h("text", { x: cx, y: cy - 2, textAnchor: "middle", fontSize: 14, fontWeight: 600, fill: "currentColor" }, hs ? fmtPct(hs.value / (total || 1)) : center ?? fmt(total)),
				h("text", { x: cx, y: cy + 14, textAnchor: "middle", fontSize: 9, fill: "currentColor", fillOpacity: 0.55 }, hs ? fmt(hs.value) : "合计")),
			h("div", { role: "list", style: { flex: "1 1 160px", minWidth: 0, fontSize: 12 } },
				slices.map((s, i) => h("div", {
					key: s.key, role: "listitem", onMouseEnter: () => setHover(i), onMouseLeave: () => setHover(null),
					style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "2px 4px", borderRadius: 4, background: hover === i ? C.l2 : "transparent" }
				},
					h("span", { style: { display: "flex", alignItems: "center", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: s.label }, h(Swatch, { color: s.color }), s.label),
					h("span", { style: { color: C.fg2, whiteSpace: "nowrap" } }, `${fmt(s.value)} · ${fmtPct(s.value / (total || 1))}`)))));
	}

	/** One horizontal 100% bar with labelled parts. */
	function ShareBar({ parts, fmt, label }) {
		const total = parts.reduce((a, p) => a + p.value, 0);
		return h("div", null,
			h("div", { role: "img", "aria-label": `${label}：${parts.map((p) => `${p.label} ${fmt(p.value)}`).join("，")}`, style: { display: "flex", height: 14, borderRadius: 7, overflow: "hidden", background: C.l2 } },
				total > 0 ? parts.filter((p) => p.value > 0).map((p) => h("div", { key: p.label, title: `${p.label}：${fmt(p.value)}（${fmtPct(p.value / total)}）`, style: { width: `${(p.value / total) * 100}%`, background: p.color } })) : null),
			h("div", { style: { display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 6, fontSize: 12, color: C.fg2 } },
				parts.map((p) => h("span", { key: p.label, style: { display: "inline-flex", alignItems: "center" } }, h(Swatch, { color: p.color }), `${p.label} ${fmt(p.value)}${total > 0 ? `（${fmtPct(p.value / total)}）` : ""}`))));
	}

	/** Small progress ring for ratios (0..1). */
	function Ring({ ratio, color }) {
		const r = 15, c = 2 * Math.PI * r;
		const v = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
		return h("svg", { viewBox: "0 0 40 40", width: 40, height: 40, "aria-hidden": true, style: { flexShrink: 0 } },
			h("circle", { cx: 20, cy: 20, r, fill: "none", stroke: "currentColor", strokeOpacity: 0.1, strokeWidth: 5 }),
			h("circle", { cx: 20, cy: 20, r, fill: "none", stroke: color, strokeWidth: 5, strokeDasharray: `${v * c} ${c}`, strokeLinecap: "round", transform: "rotate(-90 20 20)" }));
	}

	function UsageCharts({ rows, recent, range, kinds, by, today, total }) {
		const currencies = Object.entries(total.cost).sort((a, b) => b[1] - a[1]);
		const cur = currencies[0]?.[0] ?? "CNY";
		const [metricRaw, setMetric] = usePref("usageMetric", "tokens", METRICS.map((x) => x[0]));
		const [type, setType] = usePref("usageChart", "bar", CHART_TYPES.map((x) => x[0]));
		const [grain, setGrain] = usePref("usageGrain", "auto", GRAINS.map((x) => x[0]));
		const [splitRaw, setSplit] = usePref("usageSplit", "group", SPLITS.map((x) => x[0]));
		const [cumulative, setCumulative] = usePref("usageCumulative", false);
		const [showTotalPref, setShowTotal] = usePref("usageShowTotal", true);
		const [hidden, setHidden] = useState(() => new Set());
		const metric = metricRaw === "cost" && !currencies.length ? "tokens" : metricRaw;
		const ratio = isRatio(metric);
		const split = splitRaw === "mix" && metric !== "tokens" ? "group" : splitRaw;
		const chartType = ratio ? "line" : type;
		const cum = cumulative && !ratio;
		const value = metricOf(metric, cur);
		const fmt = fmtMetric(metric, cur);
		const groupLabel = by === "provider" ? "服务商" : "模型";
		const keyOf2 = (r) => (by === "provider" ? r.provider : `${r.provider}/${r.model}`);

		// Top 6 models/providers by tokens (same colours as the table); the rest fold into “其他”.
		const groups = groupRows(rows, keyOf2).sort((a, b) => b.sum.tokens - a.sum.tokens || b.sum.calls - a.sum.calls);
		const restKeys = new Set(groups.slice(SERIES.length).map((g) => g.key));
		const groupSeries = groups.slice(0, SERIES.length).map((g, i) => ({ key: g.key, label: g.key, color: SERIES[i] }));
		if (restKeys.size) groupSeries.push({ key: "\u0000other", label: `其他 ${restKeys.size} 个`, color: OTHER_COLOR });

		let series;
		let partKey;
		if (split === "group") {
			series = groupSeries.map((s) => ({ ...s, val: (b) => value(b.parts[s.key]) }));
			partKey = (r) => (restKeys.has(keyOf2(r)) ? "\u0000other" : keyOf2(r));
		} else if (split === "kind") {
			const present = new Set(rows.map((r) => r.kind));
			series = USAGE_KINDS_CLIENT.filter((k) => kinds[k] !== false && (present.has(k) || !rows.length)).map((k) => ({ key: k, label: KIND_TEXT[k], color: KIND_COLOR[k], val: (b) => value(b.parts[k]) }));
			partKey = (r) => r.kind;
		} else if (split === "mix") {
			series = MIX.map(([k, t, c]) => ({ key: k, label: t, color: c, val: (b) => b.sum[k] }));
			partKey = () => "all";
		} else {
			series = [{ key: "all", label: `全部${metricLabel(metric)}`, color: C.brand, val: (b) => value(b.sum) }];
			partKey = () => "all";
		}
		if (!series.length) series = [{ key: "all", label: "合计", color: C.brand, val: (b) => value(b.sum) }];
		const trend = trendBuckets({ rows, recent, range, kinds, partKey, today, grain });
		const visible = series.filter((s) => !hidden.has(s.key));
		const shown = visible.length ? visible : series;
		const raw = trend.buckets.map((b) => shown.map((s) => s.val(b)));
		// Per-bucket total of the visible series: a sum, or the pooled ratio.
		const bucketTotal = (b, i) => {
			if (!ratio) return raw[i].reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0);
			if (shown.length === series.length || split === "none") return value(b.sum);
			const pooled = sumRows(shown.map((s) => b.parts[s.key]).filter(Boolean).map((p) => ({ ...p, cost: undefined })));
			return value(pooled);
		};
		const baseTotals = trend.buckets.map(bucketTotal);
		let matrix = raw;
		let rawShown = raw;
		let totals = baseTotals;
		let rawTotals = baseTotals;
		if (cum) {
			const run = shown.map(() => 0);
			let t = 0;
			matrix = raw.map((row) => row.map((v, j) => (run[j] += Number.isFinite(v) ? v : 0)));
			totals = baseTotals.map((v) => (t += v));
			rawShown = matrix;
			rawTotals = totals;
		}
		if (chartType === "pct") {
			const tt = totals;
			matrix = matrix.map((row, i) => row.map((v) => (tt[i] > 0 && Number.isFinite(v) ? v / tt[i] : 0)));
			totals = totals.map((v) => (v > 0 ? 1 : 0));
		}
		const showTotal = showTotalPref && shown.length > 1 && (chartType === "line" || ratio);
		const empty = rows.length === 0 && trend.buckets.every((b) => b.sum.calls === 0);
		const unitText = { hour: "每小时", day: "每天", week: "每周", month: "每月" }[trend.unit];

		// Peak / average of the per-bucket values (before accumulation).
		let stats = null;
		if (!empty && !ratio) {
			let pi = 0;
			baseTotals.forEach((v, i) => { if (v > baseTotals[pi]) pi = i; });
			const sum = baseTotals.reduce((a, v) => a + v, 0);
			stats = `峰值 ${trend.buckets[pi]?.label ?? "—"}：${fmt(baseTotals[pi] ?? 0)} · 平均${unitText} ${fmt(sum / Math.max(1, baseTotals.length))} · 合计 ${fmt(sum)}`;
		} else if (!empty) {
			const finite = baseTotals.map((v, i) => [v, i]).filter(([v]) => Number.isFinite(v));
			const best = finite.reduce((a, x) => (a === null || x[0] > a[0] ? x : a), null);
			stats = `整体 ${fmt(value(sumRows(rows)))}${best ? ` · 最高 ${trend.buckets[best[1]].label}：${fmt(best[0])}` : ""}`;
		}

		// Donut always splits by model/provider; ratio metrics fall back to tokens there.
		const donutMetric = ratio ? "tokens" : metric;
		const donutValue = metricOf(donutMetric, cur);
		const slices = groupSeries.map((s) => ({ ...s, value: s.key === "\u0000other" ? groups.slice(SERIES.length).reduce((a, g) => a + donutValue(g.sum), 0) : donutValue(groups.find((g) => g.key === s.key).sum) }));
		const kindGroups = groupRows(rows, (r) => r.kind);
		const toggle = (k) => setHidden((s) => {
			const nx = new Set(s);
			if (nx.has(k)) nx.delete(k);
			else if (series.filter((x) => !nx.has(x.key)).length > 1) nx.add(k);
			return nx;
		});
		const title = trend.unit === "hour" ? "今日分时趋势" : `${{ day: "每日", week: "每周", month: "每月" }[trend.unit]}趋势`;
		const ratioTitle = "平均耗时、首 token、失败率和命中率不能叠加，固定用折线图";
		return h(Card, { id: "trend", title, summary: empty ? "无数据" : `${metricLabel(metric)}${cum ? " · 累计" : ""}` },
			h("div", { style: { ...S.row, gap: 10, marginBottom: 10 } },
				h(Seg, { label: "图表指标", value: metric, onChange: setMetric, options: METRICS.map(([k, t]) => [k, t, k === "cost" && !currencies.length ? { disabled: true, title: "先在下方“单价”里填写价格" } : undefined]) })),
			h("div", { style: { ...S.row, gap: 10, marginBottom: 10 } },
				h(Seg, { label: "图表类型", value: chartType, onChange: setType, options: CHART_TYPES.map(([k, t]) => [k, t, ratio && k !== "line" ? { disabled: true, title: ratioTitle } : undefined]) }),
				h(Seg, { label: "时间粒度", value: grain === "hour" && !trend.hourOk ? "day" : grain, onChange: setGrain, options: GRAINS.map(([k, t]) => [k, t, k === "hour" && !trend.hourOk ? { disabled: true, title: "按小时只用于“今天”（来自内存中的最近调用）" } : undefined]) }),
				h(Select, { value: split, onChange: setSplit, ariaLabel: "拆分方式", options: SPLITS.map(([k, t]) => [k, k === "group" ? `按${groupLabel}` : t]).filter(([k]) => k !== "mix" || metric === "tokens") }),
				h(Check, { checked: cum, onChange: setCumulative, disabled: ratio, label: "累计" }),
				(chartType === "line" || ratio) && series.length > 1 ? h(Check, { checked: showTotalPref, onChange: setShowTotal, label: ratio ? "整体线" : "合计线" }) : null),
			empty ? h("div", { style: { color: C.fg2, padding: "24px 0", textAlign: "center" } }, "这个范围内还没有调用记录。发起一次对话或在“测试/诊断”里测一下（需勾选上方“测试”）就能看到图表。") : h(React.Fragment, null,
				h("div", { style: { display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" } },
					h("div", { style: { flex: "2 1 380px", minWidth: 0 } },
						h(TrendChart, {
							buckets: trend.buckets, series: shown, matrix, raw: rawShown, totals, rawTotals, type: chartType, ratio, fmt,
							axisFmt: chartType === "pct" ? fmtPct : fmt, showTotal, label: `${title}：${metricLabel(metric)}${cum ? "（累计）" : ""}`
						}),
						series.length > 1 ? h("div", { role: "group", "aria-label": "图例（点击隐藏或显示）", style: { display: "flex", flexWrap: "wrap", gap: "4px 6px", marginTop: 6 } },
							series.map((s) => {
								const off = hidden.has(s.key) && visible.length > 0;
								return h("button", {
									key: s.key, type: "button", "aria-pressed": !off, onClick: () => toggle(s.key), title: off ? "点击显示" : "点击隐藏",
									style: { display: "inline-flex", alignItems: "center", maxWidth: 220, border: `1px solid ${C.b1}`, borderRadius: 999, padding: "1px 8px", fontSize: 11, background: "transparent", color: C.fg, cursor: "pointer", opacity: off ? 0.4 : 1, textDecoration: off ? "line-through" : "none" }
								}, h(Swatch, { color: s.color }), h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, s.label));
							}),
							showTotal ? h("span", { style: { display: "inline-flex", alignItems: "center", fontSize: 11, color: C.fg2, padding: "1px 4px" } }, h(Swatch, { color: C.fg2, line: true }), ratio ? "整体" : "合计（虚线）") : null) : null,
						stats ? h("div", { style: { fontSize: 12, color: C.fg2, marginTop: 6 } }, stats) : null,
						trend.unit === "hour" ? h("div", { style: { ...S.hint, margin: "4px 0 0" } }, `分时数据来自内存中的最近调用记录${trend.partial ? `（只保留最近 ${USAGE_RECENT_CAP} 次，更早的不在图里）` : ""}，重启后清零。`) : null),
					h("div", { style: { flex: "1 1 260px", minWidth: 0 } },
						h("div", { style: { fontSize: 12, color: C.fg2, marginBottom: 6 } }, `${groupLabel}占比（${metricLabel(donutMetric)}）`),
						h(Donut, { slices, fmt: fmtMetric(donutMetric, cur), label: `${groupLabel}占比环形图` }))),
				h("div", { style: { display: "flex", gap: 20, flexWrap: "wrap", marginTop: 16 } },
					h("div", { style: { flex: "1 1 300px", minWidth: 0 } },
						h("div", { style: { fontSize: 12, color: C.fg2, marginBottom: 6 } }, "token 构成"),
						h(ShareBar, { parts: MIX.map(([k, t, c]) => ({ label: t, color: c, value: total[k] })), fmt: fmtTok, label: "token 构成" })),
					h("div", { style: { flex: "1 1 300px", minWidth: 0 } },
						h("div", { style: { fontSize: 12, color: C.fg2, marginBottom: 6 } }, `调用来源（${metricLabel(donutMetric)}）`),
						h(ShareBar, { parts: USAGE_KINDS_CLIENT.filter((k) => kinds[k] !== false).map((k) => ({ label: KIND_TEXT[k], color: KIND_COLOR[k], value: donutValue(kindGroups.find((g) => g.key === k)?.sum ?? sumRows([])) })), fmt: fmtMetric(donutMetric, cur), label: "调用来源" })))));
	}

	// ---------------------------------------------------------------- detail table
	const TABLE_COLS = [["name", null], ["calls", "调用"], ["errors", "失败"], ["inputTokens", "输入"], ["cacheReadTokens", "缓存命中"], ["outputTokens", "输出"], ["tokens", "合计"], ["share", "占比"], ["latency", "平均耗时"], ["cost", "费用"]];
	const tableSortVal = (col, g) => {
		const s = g.sum;
		if (col === "name") return g.key;
		if (col === "share") return s.tokens;
		if (col === "latency") return s.calls ? s.durationMs / s.calls : -1;
		if (col === "cost") return Object.values(s.cost).reduce((a, v) => a + v, 0) - (Object.keys(s.cost).length ? 0 : 1);
		return s[col] ?? 0;
	};
	function UsageTable({ rows, by, total, colorOf }) {
		const [sortRaw, setSort] = usePref("tableSort", "tokens", TABLE_COLS.map((x) => x[0]));
		const [dir, setDir] = usePref("tableDir", "desc", ["asc", "desc"]);
		const [q, setQ] = useState("");
		const [all, setAll] = useState(false);
		const keyOf2 = (r) => (by === "provider" ? r.provider : `${r.provider}/${r.model}`);
		const needle = q.trim().toLowerCase();
		const groups = groupRows(rows, keyOf2).filter((g) => !needle || g.key.toLowerCase().includes(needle));
		const sign = dir === "asc" ? 1 : -1;
		groups.sort((a, b) => {
			const x = tableSortVal(sortRaw, a), y = tableSortVal(sortRaw, b);
			return (typeof x === "string" ? x.localeCompare(y) : x - y) * sign || b.sum.tokens - a.sum.tokens;
		});
		const LIMIT = 10;
		const shown = all ? groups : groups.slice(0, LIMIT);
		const clickSort = (col) => {
			if (col === sortRaw) setDir(dir === "asc" ? "desc" : "asc");
			else { setSort(col); setDir(col === "name" ? "asc" : "desc"); }
		};
		const th = ([col, label]) => {
			const text = col === "name" ? (by === "provider" ? "服务商" : "服务商 / 模型") : label;
			const on = sortRaw === col;
			return h("th", { key: col, "aria-sort": on ? (dir === "asc" ? "ascending" : "descending") : "none", style: { ...S.th, ...(col === "name" ? {} : { textAlign: "right" }) } },
				h("button", { type: "button", onClick: () => clickSort(col), style: { border: "none", background: "none", padding: 0, font: "inherit", color: on ? C.fg : "inherit", cursor: "pointer", whiteSpace: "nowrap" } }, text, on ? (dir === "asc" ? " ▲" : " ▼") : ""));
		};
		const tdR = (v, title) => h("td", { style: { ...S.td, textAlign: "right", whiteSpace: "nowrap" }, title }, v);
		return h(Card, {
			id: "table", title: by === "provider" ? "按服务商" : "按模型", summary: `${groupRows(rows, keyOf2).length} 个`,
			right: h(TextInput, { value: q, onChange: setQ, placeholder: `搜索${by === "provider" ? "服务商" : "模型"}`, ariaLabel: "搜索明细", style: { width: 160 } })
		},
			groups.length === 0 ? h("div", { style: { color: C.fg2 } }, needle ? "没有匹配的项。" : "这个范围内还没有调用记录。") : h(React.Fragment, null,
				h("div", { style: { overflowX: "auto" } }, h("table", { style: S.table },
					h("thead", null, h("tr", null, TABLE_COLS.map(th))),
					h("tbody", null, shown.map((g) => {
						const s = g.sum;
						const share = total.tokens ? s.tokens / total.tokens : 0;
						return h("tr", { key: g.key },
							h("td", { style: { ...S.td, ...S.mono, wordBreak: "break-all" } }, h(Swatch, { color: colorOf.get(g.key) ?? OTHER_COLOR }), by === "provider" ? g.sample.provider : h(React.Fragment, null, h("span", { style: { color: C.fg2 } }, `${g.sample.provider}/`), g.sample.model),
								s.tokens > 0 ? h("div", { "aria-hidden": true, title: MIX.map(([k, t]) => `${t} ${fmtTok(s[k])}`).join(" · "), style: { display: "flex", height: 4, borderRadius: 2, overflow: "hidden", marginTop: 4, maxWidth: 220, background: C.l2 } },
									MIX.filter(([k]) => s[k] > 0).map(([k, , c]) => h("div", { key: k, style: { width: `${(s[k] / s.tokens) * 100}%`, background: c } }))) : null),
							tdR(s.calls), tdR(s.errors ? h("span", { style: { color: C.err } }, s.errors) : "0", s.calls ? `失败率 ${fmtPct(s.errors / s.calls)}` : undefined),
							tdR(fmtTok(s.inputTokens), String(s.inputTokens)), tdR(fmtTok(s.cacheReadTokens), `命中率 ${cacheRate(s)}`), tdR(fmtTok(s.outputTokens), s.reasoningTokens ? `其中推理 ${s.reasoningTokens}` : String(s.outputTokens)),
							tdR(h("strong", null, fmtTok(s.tokens)), String(s.tokens)),
							h("td", { style: { ...S.td, minWidth: 90 } }, h("div", { style: { display: "flex", alignItems: "center", gap: 6 } },
								h("div", { style: { flex: 1, height: 6, borderRadius: 3, background: C.l2 } }, h("div", { style: { width: `${Math.round(share * 100)}%`, height: "100%", borderRadius: 3, background: colorOf.get(g.key) ?? OTHER_COLOR } })),
								h("span", { style: { fontSize: 11, color: C.fg2, width: 32, textAlign: "right" } }, fmtPct(share)))),
							tdR(s.calls ? fmtMs(s.durationMs / s.calls) : "—", s.firstTokenCalls ? `首 token ${fmtMs(s.firstTokenMs / s.firstTokenCalls)}` : undefined),
							tdR(Object.keys(s.cost).length ? fmtCostMap(s.cost) : h("span", { style: { color: C.fg2 } }, "—")));
					})))),
				groups.length > LIMIT ? h("div", { style: { marginTop: 8 } }, h(Btn, { onClick: () => setAll(!all) }, all ? "只看前 10 个" : `显示全部 ${groups.length} 个`)) : null));
	}

	// ---------------------------------------------------------------- sessions
	const SESSION_SORTS = [["recent", "最近活跃"], ["tokens", "tokens 最多"], ["cost", "费用最高"], ["calls", "调用最多"]];
	const SESSION_PAGE = 5;
	function UsageSessionsCard({ list }) {
		const [sort, setSort] = usePref("sessionSort", "recent", SESSION_SORTS.map((x) => x[0]));
		const [merge, setMerge] = usePref("sessionMerge", true);
		const [filter, setFilter] = useState("all");
		const [q, setQ] = useState("");
		const [limit, setLimit] = useState(SESSION_PAGE);
		const [open, setOpen] = useState(() => new Set());
		const byId = new Map(list.map((s) => [s.sessionId, s]));
		// Merge subagent sessions into their top-most parent that has usage.
		const rootOf = (s) => {
			let cur = s;
			for (let i = 0; i < 20 && cur.parentSessionId && byId.has(cur.parentSessionId); i++) cur = byId.get(cur.parentSessionId);
			return cur;
		};
		const doMerge = merge && filter === "all";
		const entries = new Map();
		for (const s of list) {
			const root = doMerge ? rootOf(s) : s;
			if (!entries.has(root.sessionId)) entries.set(root.sessionId, { id: root.sessionId, root, members: [] });
			entries.get(root.sessionId).members.push(s);
		}
		const rows = [...entries.values()].map((e) => {
			const agg = { calls: 0, errors: 0, tokens: 0, cost: 0, priced: false, complete: true, lastAt: 0, currency: null, models: new Set() };
			for (const s of e.members) {
				agg.calls += s.total.calls;
				agg.errors += s.total.errors ?? 0;
				agg.tokens += tokTotal(s.total);
				if (s.cost !== null && s.cost !== undefined) { agg.cost += s.cost; agg.priced = true; agg.currency ??= s.currency; }
				if (!s.costComplete) agg.complete = false;
				agg.lastAt = Math.max(agg.lastAt, s.lastAt ?? 0);
				for (const m of s.models) agg.models.add(`${m.provider}/${m.model}`);
			}
			return { ...e, ...agg, children: e.members.filter((s) => s !== e.root) };
		});
		const needle = q.trim().toLowerCase();
		const filtered = rows.filter((r) => (filter === "all" || (filter === "sub") === !!r.root.subagent)
			&& (!needle || r.members.some((s) => String(s.sessionId).toLowerCase().includes(needle)) || [...r.models].some((m) => m.toLowerCase().includes(needle))));
		const cmp = {
			recent: (a, b) => b.lastAt - a.lastAt,
			tokens: (a, b) => b.tokens - a.tokens,
			cost: (a, b) => (b.priced ? b.cost : -1) - (a.priced ? a.cost : -1),
			calls: (a, b) => b.calls - a.calls
		}[sort];
		filtered.sort((a, b) => cmp(a, b) || b.lastAt - a.lastAt);
		const shown = filtered.slice(0, limit);
		const maxTok = Math.max(1, ...filtered.map((r) => r.tokens));
		const totalTok = rows.reduce((a, r) => a + r.tokens, 0);
		const toggle = (id) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
		const label = (s) => `${s.subagent ? "子代理" : "主代理"} ${String(s.sessionId).slice(0, 8)}`;
		const costText = (r) => (r.priced ? `${fmtCost(r.cost, r.currency)}${r.complete ? "" : "+"}` : "—");
		const cell = { ...S.td, whiteSpace: "nowrap" };
		const detail = (r) => {
			const perModel = new Map();
			for (const s of r.members) for (const m of s.models) {
				const k = `${m.provider}/${m.model}`;
				const a = perModel.get(k) ?? { calls: 0, errors: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
				for (const f of Object.keys(a)) a[f] += m[f] ?? 0;
				perModel.set(k, a);
			}
			const sub = { ...S.td, padding: "3px 8px", whiteSpace: "nowrap" };
			return h("div", { style: { padding: "6px 0 6px 18px" } },
				h("div", { style: { fontSize: 12, color: C.fg2, marginBottom: 4 } }, h("span", { style: S.mono }, r.root.sessionId), r.root.parentSessionId ? ` · 父会话 ${String(r.root.parentSessionId).slice(0, 8)}` : "", r.root.depth ? ` · 深度 ${r.root.depth}` : ""),
				h("table", { style: { ...S.table, fontSize: 11 } },
					h("thead", null, h("tr", null, ["模型", "调用", "失败", "输入", "缓存命中", "缓存写入", "输出", "合计"].map((t) => h("th", { key: t, style: { ...S.th, padding: "3px 8px" } }, t)))),
					h("tbody", null, [...perModel.entries()].sort((a, b) => tokTotal(b[1]) - tokTotal(a[1])).map(([k, a]) => h("tr", { key: k },
						h("td", { style: { ...sub, ...S.mono, fontSize: 11 } }, k), h("td", { style: sub }, a.calls), h("td", { style: { ...sub, color: a.errors ? C.err : undefined } }, a.errors),
						h("td", { style: sub }, fmtTok(a.inputTokens)), h("td", { style: sub }, fmtTok(a.cacheReadTokens)), h("td", { style: sub }, fmtTok(a.cacheWriteTokens)), h("td", { style: sub }, fmtTok(a.outputTokens)), h("td", { style: sub }, fmtTok(tokTotal(a))))))),
				r.children.length ? h(React.Fragment, null,
					h("div", { style: { fontSize: 12, color: C.fg2, margin: "8px 0 4px" } }, `合并的子代理会话（${r.children.length}）`),
					h("table", { style: { ...S.table, fontSize: 11 } },
						h("tbody", null, [...r.children].sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0)).map((s) => h("tr", { key: s.sessionId },
							h("td", { style: { ...sub, ...S.mono, fontSize: 11 } }, label(s), s.depth ? h("span", { style: { color: C.fg2 } }, ` · 深度 ${s.depth}`) : null),
							h("td", { style: sub }, `${s.total.calls} 次`), h("td", { style: sub }, fmtTok(tokTotal(s.total))),
							h("td", { style: sub }, s.cost === null || s.cost === undefined ? "—" : `${fmtCost(s.cost, s.currency)}${s.costComplete ? "" : "+"}`),
							h("td", { style: { ...sub, ...S.mono, fontSize: 11, color: C.fg2, whiteSpace: "normal", wordBreak: "break-all" } }, s.models.map((m) => `${m.provider}/${m.model}`).join("、")),
							h("td", { style: sub }, fmtWhen(s.lastAt))))))) : null);
		};
		return h(Card, {
			id: "sessions", title: "会话用量", summary: `本次启动后 ${list.length} 个会话 · ${fmtTok(totalTok)} tokens`,
			right: list.length ? h(React.Fragment, null,
				h(TextInput, { value: q, onChange: (v) => { setQ(v); setLimit(SESSION_PAGE); }, placeholder: "搜索会话 ID / 模型", ariaLabel: "搜索会话", style: { width: 150 } }),
				h(Select, { value: filter, onChange: (v) => { setFilter(v); setLimit(SESSION_PAGE); }, ariaLabel: "会话类型", options: [["all", "全部会话"], ["main", "主代理"], ["sub", "子代理"]] }),
				h(Select, { value: sort, onChange: setSort, ariaLabel: "会话排序", options: SESSION_SORTS }),
				h(Check, { checked: merge, onChange: setMerge, disabled: filter !== "all", label: "子代理并入父会话" })) : null
		},
			list.length === 0 ? h("div", { style: { color: C.fg2 } }, "暂无。会话用量只保存在内存中，重启后从零开始。") : filtered.length === 0 ? h("div", { style: { color: C.fg2 } }, "没有匹配的会话。") : h(React.Fragment, null,
				h("div", { style: { overflowX: "auto" } }, h("table", { style: S.table },
					h("thead", null, h("tr", null, ["会话", "调用", "tokens", "费用", "使用的模型", "最近"].map((t) => h("th", { key: t, style: S.th }, t)))),
					h("tbody", null, shown.map((r) => {
						const isOpen = open.has(r.id);
						const models = [...r.models];
						return h(React.Fragment, { key: r.id },
							h("tr", null,
								h("td", { style: cell },
									h("button", { type: "button", "aria-expanded": isOpen, onClick: () => toggle(r.id), title: "查看按模型明细", style: { border: "none", background: "none", padding: 0, cursor: "pointer", color: C.fg, font: "inherit", display: "inline-flex", alignItems: "center", gap: 6 } },
										h("span", { "aria-hidden": true, style: { fontSize: 9, color: C.fg2, display: "inline-block", width: 9, transform: isOpen ? "rotate(90deg)" : "none" } }, "▶"),
										h("span", { style: S.mono }, label(r.root))),
									r.children.length ? h("span", { style: { ...S.chip, marginLeft: 6 } }, `+${r.children.length} 子代理`) : null,
									!doMerge && r.root.depth ? h("span", { style: { color: C.fg2 } }, ` · 深度 ${r.root.depth}`) : null),
								h("td", { style: cell }, r.calls, r.errors ? h("span", { style: { color: C.err } }, ` (${r.errors} 失败)`) : null),
								h("td", { style: { ...cell, minWidth: 110 }, title: String(r.tokens) },
									h("div", { style: { display: "flex", alignItems: "center", gap: 6 } },
										h("span", { style: { width: 52 } }, fmtTok(r.tokens)),
										h("div", { "aria-hidden": true, style: { flex: 1, height: 4, borderRadius: 2, background: C.l2, minWidth: 40 } }, h("div", { style: { width: `${(r.tokens / maxTok) * 100}%`, height: "100%", borderRadius: 2, background: C.brand } })))),
								h("td", { style: cell }, costText(r)),
								h("td", { style: { ...S.td, ...S.mono, color: C.fg2, wordBreak: "break-all" }, title: models.join("\n") }, models.slice(0, 2).join("、"), models.length > 2 ? ` 等 ${models.length} 个` : ""),
								h("td", { style: cell }, fmtWhen(r.lastAt))),
							isOpen ? h("tr", null, h("td", { colSpan: 6, style: { ...S.td, background: C.bg } }, detail(r))) : null);
					})))),
				h("div", { style: { ...S.row, marginTop: 8, fontSize: 12, color: C.fg2 } },
					`显示 ${shown.length} / ${filtered.length}`,
					filtered.length > limit ? h(Btn, { onClick: () => setLimit(limit + 20) }, `再显示 ${Math.min(20, filtered.length - limit)} 个`) : null,
					filtered.length > limit + 20 ? h(Btn, { onClick: () => setLimit(filtered.length) }, `全部 ${filtered.length} 个`) : null,
					limit > SESSION_PAGE ? h(Btn, { onClick: () => setLimit(SESSION_PAGE) }, "收起") : null)));
	}

	// ---------------------------------------------------------------- recent calls
	const RECENT_PAGE = 20;
	function RecentCallsCard({ list, kinds }) {
		const [outcome, setOutcome] = useState("all");
		const [q, setQ] = useState("");
		const [limit, setLimit] = useState(RECENT_PAGE);
		const needle = q.trim().toLowerCase();
		const inKinds = list.filter((e) => kinds[e.kind] !== false);
		const filtered = inKinds.filter((e) => (outcome === "all" || (outcome === "fail" ? e.outcome !== "ok" : e.outcome === outcome))
			&& (!needle || `${e.provider}/${e.model}`.toLowerCase().includes(needle) || String(e.sessionId ?? "").toLowerCase().includes(needle) || String(e.errorCode ?? "").toLowerCase().includes(needle)));
		const shown = filtered.slice(0, limit);
		const fails = inKinds.filter((e) => e.outcome !== "ok").length;
		const cell = { ...S.td, whiteSpace: "nowrap" };
		return h(Card, {
			id: "recent", defaultOpen: false, title: "最近调用", summary: `${inKinds.length} 次${fails ? ` · ${fails} 次失败/中断` : ""}（内存中最近 ${USAGE_RECENT_CAP} 次）`,
			right: h(React.Fragment, null,
				h(TextInput, { value: q, onChange: (v) => { setQ(v); setLimit(RECENT_PAGE); }, placeholder: "模型 / 会话 / 错误码", ariaLabel: "搜索最近调用", style: { width: 150 } }),
				h(Seg, { label: "调用结果", value: outcome, onChange: (v) => { setOutcome(v); setLimit(RECENT_PAGE); }, options: [["all", "全部"], ["ok", "成功"], ["fail", "失败/中断"]] }))
		},
			filtered.length === 0 ? h("div", { style: { color: C.fg2 } }, inKinds.length ? "没有匹配的调用。" : "暂无。") : h(React.Fragment, null,
				h("div", { style: { overflowX: "auto" } }, h("table", { style: S.table },
					h("thead", null, h("tr", null, ["时间", "类型", "模型", "结果", "输入 / 命中 / 输出", "耗时 / 首字", "费用"].map((t) => h("th", { key: t, style: S.th }, t)))),
					h("tbody", null, shown.map((e) => h("tr", { key: e.seq },
						h("td", { style: cell }, fmtWhen(e.at)),
						h("td", { style: cell }, KIND_TEXT[e.kind] ?? e.kind, e.sessionId ? h("span", { style: { ...S.mono, color: C.fg2 } }, ` ${String(e.sessionId).slice(0, 8)}`) : null),
						h("td", { style: { ...S.td, ...S.mono, wordBreak: "break-all" } }, refText(e)),
						h("td", { style: { ...cell, color: e.outcome === "ok" ? C.ok : e.outcome === "error" ? C.err : C.warn } }, OUTCOME_TEXT[e.outcome] ?? e.outcome, e.errorCode ? ` · ${e.errorCode}` : ""),
						h("td", { style: cell, title: typeof e.promptTokens === "number" ? `提示词共 ${e.promptTokens} tokens` : undefined }, e.usage ? `${fmtTok(e.usage.inputTokens ?? 0)} / ${fmtTok(e.usage.cacheReadTokens ?? 0)} / ${fmtTok(e.usage.outputTokens ?? 0)}` : "无"),
						h("td", { style: cell }, `${fmtMs(e.durationMs)} / ${fmtMs(e.firstTokenMs ?? undefined)}`),
						h("td", { style: cell }, typeof e.cost === "number" ? fmtCost(e.cost, e.currency) : "—")))))),
				h("div", { style: { ...S.row, marginTop: 8, fontSize: 12, color: C.fg2 } },
					`显示 ${shown.length} / ${filtered.length}`,
					filtered.length > limit ? h(Btn, { onClick: () => setLimit(limit + 50) }, `再显示 ${Math.min(50, filtered.length - limit)} 条`) : null,
					limit > RECENT_PAGE ? h(Btn, { onClick: () => setLimit(RECENT_PAGE) }, "收起") : null)));
	}

	// ---------------------------------------------------------------- usage tab
	function UsageTab({ m, api, active }) {
		const data = m.state.data;
		const own = findView(data.desc, OWN_NS);
		const [range, setRange] = usePref("usageRange", "7", RANGES.map((x) => x[0]));
		const [by, setBy] = usePref("usageBy", "model", ["model", "provider"]);
		const [kinds, setKinds] = useState({ main: true, subagent: true, probe: false, other: true });
		const [st, setSt] = useState({ status: "loading" });
		const [confirmReset, setConfirmReset] = useState(false);
		const n = range === "all" ? 0 : Number(range);
		const load = useCallback(async () => {
			try {
				// Twice the range, so the summary can compare with the previous period.
				const q = { recent: USAGE_RECENT_CAP, ...(n ? { from: dayKeyLocal(1 - n * 2) } : {}) };
				setSt({ status: "ready", data: await api.usage(q) });
			} catch (e) {
				setSt((s) => ({ ...s, status: "error", error: e.message, code: e.code }));
			}
		}, [api, n]);
		useEffect(() => {
			if (!active) return undefined;
			load();
			const timer = setInterval(load, 10000);
			return () => clearInterval(timer);
		}, [active, load]);
		const d = st.data;
		if (st.status === "error" && !d) return h("div", { style: S.card }, h("div", { style: S.warnBox }, st.code === "NO_HOST_ROUTE" ? NO_HOST : st.error), h(Btn, { onClick: load }, "重试"));
		if (!d) return h("div", { style: { color: C.fg2 } }, "加载中…");
		const from = n ? dayKeyLocal(1 - n) : "";
		const prevFrom = n ? dayKeyLocal(1 - n * 2) : "";
		const inRange = d.rows.filter((r) => r.day >= from);
		const rows = inRange.filter((r) => kinds[r.kind] !== false);
		const prevRows = n ? d.rows.filter((r) => r.day >= prevFrom && r.day < from && kinds[r.kind] !== false) : [];
		const total = sumRows(rows);
		const prev = n && n > 1 && prevRows.length ? sumRows(prevRows) : null;
		const byKind = groupRows(inRange, (r) => r.kind);
		const keyOf2 = (r) => (by === "provider" ? r.provider : `${r.provider}/${r.model}`);
		// Same colours as the chart legend (top 6 by tokens).
		const colorOf = new Map(groupRows(rows, keyOf2).sort((a, b) => b.sum.tokens - a.sum.tokens || b.sum.calls - a.sum.calls).slice(0, SERIES.length).map((g, i) => [g.key, SERIES[i]]));
		const successRate = total.calls ? (total.calls - total.errors - total.aborted) / total.calls : NaN;
		const cacheIn = total.inputTokens + total.cacheReadTokens + total.cacheWriteTokens;
		const priced = Object.keys(total.cost).length > 0;
		const mainCur = Object.entries(total.cost).sort((a, b) => b[1] - a[1])[0]?.[0];
		const reset = async () => {
			if (!confirmReset) return setConfirmReset(true);
			setConfirmReset(false);
			try {
				await api.usageAction({ action: "reset" });
				await load();
				m.notify("ok", "用量统计已清空");
			} catch (e) {
				m.notify("err", e.message);
			}
		};
		return h(React.Fragment, null,
			h("div", { style: S.card },
				h("div", { style: { ...S.row, justifyContent: "space-between" } },
					h("div", { style: S.row },
						h(Select, { value: range, onChange: setRange, options: RANGES, ariaLabel: "统计范围" }),
						h(Select, { value: by, onChange: setBy, options: [["model", "按模型"], ["provider", "按服务商"]], ariaLabel: "汇总方式" }),
						Object.keys(KIND_TEXT).map((k) => h(Check, { key: k, checked: kinds[k] !== false, onChange: (v) => setKinds((s) => ({ ...s, [k]: v })), label: KIND_TEXT[k] }))),
					h("div", { style: S.row },
						h(Btn, { onClick: load }, "刷新"),
						h(Btn, { kind: "danger", onClick: reset }, confirmReset ? "再点一次确认清空" : "清空统计"))),
				h("div", { style: { ...S.row, gap: 10, marginTop: 12 } },
					h(StatBox, { label: "调用次数", value: String(total.calls), delta: prev && deltaOf(total.calls, prev.calls, String), ring: { ratio: successRate, color: successRate >= 0.95 ? C.ok : successRate >= 0.8 ? C.warn : C.err }, sub: `成功率 ${fmtPct(successRate)} · 失败 ${total.errors} · 中断 ${total.aborted}${total.noUsage ? ` · 无用量 ${total.noUsage}` : ""}` }),
					h(StatBox, { label: "总 tokens", value: fmtTok(total.tokens), title: String(total.tokens), delta: prev && deltaOf(total.tokens, prev.tokens, fmtTok), sub: `输入 ${fmtTok(total.inputTokens)} · 输出 ${fmtTok(total.outputTokens)}${n > 1 ? ` · 日均 ${fmtTok(total.tokens / n)}` : ""}` }),
					h(StatBox, { label: "缓存命中", value: cacheRate(total), ring: { ratio: cacheIn ? total.cacheReadTokens / cacheIn : NaN, color: "#12b886" }, sub: `命中 ${fmtTok(total.cacheReadTokens)} · 写入 ${fmtTok(total.cacheWriteTokens)}` }),
					h(StatBox, { label: "平均耗时 / 首字", value: total.calls ? fmtMs(total.durationMs / total.calls) : "—", sub: `首 token ${total.firstTokenCalls ? fmtMs(total.firstTokenMs / total.firstTokenCalls) : "—"}` }),
					h(StatBox, { label: "估算费用", value: priced ? fmtCostMap(total.cost) : "未配置单价", delta: prev && mainCur && Object.keys(total.cost).length === 1 ? deltaOf(total.cost[mainCur], prev.cost[mainCur] ?? 0, (v) => fmtCost(v, mainCur)) : null, sub: total.unpricedTokens ? `${fmtTok(total.unpricedTokens)} tokens 未定价` : priced ? "按下方单价估算" : "在下方“单价”里填写" })),
				h("div", { style: { ...S.row, gap: 6, marginTop: 10, fontSize: 12, color: C.fg2 } },
					byKind.map((g) => h("span", { key: g.key, style: S.chip }, `${KIND_TEXT[g.key] ?? g.key} ${g.sum.calls} 次 · ${fmtTok(g.sum.tokens)}`))),
				h("div", { style: { ...S.hint, marginTop: 8, marginBottom: 0 } },
					`统计自 ${new Date(d.since).toLocaleString()}。数据来自每次模型调用里服务商返回的 usage；“输入”不含缓存命中部分。`,
					prev ? `箭头是和上一个同样长度的周期相比（${prevFrom} 起 ${n} 天）。` : "",
					d.storage?.state === "persistent" ? "按天汇总的数据会保存到磁盘，重启后保留；会话和最近调用只在内存中。" : `当前只保存在内存中，重启后清零${d.storage?.error ? `（${d.storage.error}）` : ""}。`)),
			h(UsageCharts, { rows, recent: d.recent ?? [], range, kinds, by, today: d.today ?? dayKeyLocal(0), total }),
			h(UsageTable, { rows, by, total, colorOf }),
			h(UsageSessionsCard, { list: d.sessions ?? [] }),
			h(RecentCallsCard, { list: d.recent ?? [], kinds }),
			h(PricesCard, { m, own, data, rows: inRange, key: `p:${JSON.stringify(rec(own?.value).usagePrices ?? null)}` }));
	}

	const PRICE_FIELDS = [["input", "输入"], ["cacheRead", "缓存命中"], ["cacheWrite", "缓存写入"], ["output", "输出"]];
	const PRICE_MODES = [["token", "按量"], ["call", "按次"], ["mixed", "按次 + 按量"]];
	const CURRENCIES = [["CNY", "¥ CNY"], ["USD", "$ USD"], ["EUR", "€ EUR"]];
	const numText = (v) => (typeof v === "number" && Number.isFinite(v) ? String(v) : "");
	let tierSeq = 0;
	/** Saved price → editable draft (all strings; thresholds shown in K tokens). */
	const priceDraft = (p) => {
		const r = rec(p);
		const hasCall = typeof r.perCall === "number";
		const hasToken = PRICE_FIELDS.some(([f]) => typeof r[f] === "number") || (Array.isArray(r.tiers) && r.tiers.length > 0);
		return {
			mode: r.mode === "token" || r.mode === "call" || r.mode === "mixed" ? r.mode : hasCall && hasToken ? "mixed" : hasCall ? "call" : "token",
			currency: str(r.currency) ?? "CNY",
			perCall: numText(r.perCall),
			...Object.fromEntries(PRICE_FIELDS.map(([f]) => [f, numText(r[f])])),
			tiers: (Array.isArray(r.tiers) ? r.tiers : []).map((t) => ({ id: ++tierSeq, above: typeof t?.above === "number" ? String(t.above / 1000) : "", ...Object.fromEntries(PRICE_FIELDS.map(([f]) => [f, numText(t?.[f])])) }))
		};
	};
	const PRICE_SORTS = [["name", "按名称"], ["provider", "按服务商"], ["input", "输入价 高→低"], ["output", "输出价 高→低"], ["recent", "最近添加"]];
	/**
	 * Price rows to show: only what the user added. `needle` searches the full
	 * `provider/model` key, `provider` narrows to one provider, and `sort` orders
	 * the result (see PRICE_SORTS).
	 */
	function priceRowKeys({ saved, draft, needle, provider, sort = "name" }) {
		const all = [...new Set([...Object.keys(saved ?? {}), ...Object.keys(draft ?? {})])];
		const kept = all.filter((k) => {
			if (needle && !k.toLowerCase().includes(needle)) return false;
			if (provider && k.split("/")[0] !== provider) return false;
			return true;
		});
		const priceOf = (k) => rec(rec(saved)[k]);
		const byName = (a, b) => a.localeCompare(b);
		const cmp = {
			name: byName,
			provider: (a, b) => a.split("/")[0].localeCompare(b.split("/")[0]) || byName(a, b),
			input: (a, b) => (priceOf(b).input ?? -1) - (priceOf(a).input ?? -1) || byName(a, b),
			output: (a, b) => (priceOf(b).output ?? -1) - (priceOf(a).output ?? -1) || byName(a, b),
			recent: (a, b) => all.indexOf(b) - all.indexOf(a)
		}[sort] ?? byName;
		return kept.sort(cmp);
	}
	/** Draft → settings value, or undefined when nothing is filled. Throws on invalid input. */
	function priceValue(k, d) {
		const parse = (raw, what) => {
			const s = String(raw ?? "").trim();
			if (!s) return undefined;
			const n = Number(s);
			if (!Number.isFinite(n) || n < 0) throw new Error(`${k}：${what}“${s}”不是有效的非负数`);
			return n;
		};
		const out = { mode: d.mode, currency: d.currency || "CNY" };
		if (d.mode !== "token") {
			const v = parse(d.perCall, "每次价格");
			if (v !== undefined) out.perCall = v;
		}
		if (d.mode !== "call") {
			for (const [f, label] of PRICE_FIELDS) {
				const v = parse(d[f], `${label}单价`);
				if (v !== undefined) out[f] = v;
			}
			const tiers = [];
			for (const t of d.tiers ?? []) {
				const k1 = parse(t.above, "阶梯阈值");
				const prices = {};
				for (const [f, label] of PRICE_FIELDS) {
					const v = parse(t[f], `阶梯${label}单价`);
					if (v !== undefined) prices[f] = v;
				}
				if (k1 === undefined && !Object.keys(prices).length) continue; // empty row
				if (!k1) throw new Error(`${k}：阶梯阈值要大于 0（单位 K tokens）`);
				const above = Math.round(k1 * 1000);
				if (tiers.some((x) => x.above === above)) throw new Error(`${k}：阶梯阈值 ${k1}K 重复`);
				if (!Object.keys(prices).length) throw new Error(`${k}：阶梯 ${k1}K 至少要填一项价格`);
				tiers.push({ above, ...prices });
			}
			if (tiers.length) out.tiers = tiers.sort((a, b) => a.above - b.above);
		}
		const filled = out.perCall !== undefined || out.tiers || PRICE_FIELDS.some(([f]) => out[f] !== undefined);
		return filled ? out : undefined;
	}
	/** One-line summary of a saved price for the collapsed row. */
	const priceSummary = (p, cur) => {
		if (!p) return "未定价";
		const sign = CUR_SIGN[cur] ?? `${cur} `;
		const parts = [];
		if (p.perCall !== undefined) parts.push(`${sign}${p.perCall}/次`);
		const tok = PRICE_FIELDS.filter(([f]) => p[f] !== undefined).map(([f, l]) => `${l} ${p[f]}`);
		if (tok.length) parts.push(`${tok.join(" · ")} /百万`);
		if (p.tiers?.length) parts.push(`${p.tiers.length} 档阶梯（${p.tiers.map((t) => `>${t.above / 1000}K`).join("、")}）`);
		return parts.join("；") || "未定价";
	};

	function PricesCard({ m, own, data, rows }) {
		const saved = rec(rec(own?.value).usagePrices);
		// Rows exist only because the user added them: nothing is ever listed
		// automatically, so the card cannot grow on its own.
		const [draft, setDraft] = useState(() => Object.fromEntries(Object.entries(saved).map(([k, p]) => [k, priceDraft(p)])));
		const [q, setQ] = useState("");
		const [provider, setProvider] = useState("");
		const [sort, setSort] = useState("name");
		const [adding, setAdding] = useState(false);
		const [addProvider, setAddProvider] = useState("");
		const [addModel, setAddModel] = useState("");
		const [open, setOpen] = useState(() => new Set());
		// Billed models, used only for the "暂无调用" hint on an existing row.
		const used = [...new Set(rows.filter((r) => r.kind !== "probe").map((r) => `${r.provider}/${r.model}`))];
		const needle = q.trim().toLowerCase();
		const keys = priceRowKeys({ saved, draft, needle, provider, sort });
		const catalogKeys = catalogModels(data.catalog).map((x) => `${x.provider}/${x.id}`);
		const providers = [...new Set([...Object.keys(saved), ...Object.keys(draft), ...catalogKeys.map((k) => k.split("/")[0])])].sort();
		const catalogFor = (prov) => catalogKeys.filter((k) => k.split("/")[0] === prov).map((k) => k.split("/").slice(1).join("/"));
		const get = (k) => draft[k] ?? priceDraft(undefined);
		const patch = (k, fn) => setDraft((s) => ({ ...s, [k]: fn(s[k] ?? priceDraft(undefined)) }));
		const set = (k, f, v) => patch(k, (d) => ({ ...d, [f]: v }));
		const setTier = (k, id, f, v) => patch(k, (d) => ({ ...d, tiers: d.tiers.map((t) => (t.id === id ? { ...t, [f]: v } : t)) }));
		const addTier = (k) => patch(k, (d) => ({ ...d, tiers: [...d.tiers, { id: ++tierSeq, above: d.tiers.length ? "" : "272", input: "", cacheRead: "", cacheWrite: "", output: "" }] }));
		const delTier = (k, id) => patch(k, (d) => ({ ...d, tiers: d.tiers.filter((t) => t.id !== id) }));
		const toggle = (k) => setOpen((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
		const clear = (k) => setDraft((s) => { const n = { ...s }; delete n[k]; return n; });
		/** Add one row by hand; nothing else can create a row. */
		const addRow = (prov, model) => {
			const wantProvider = String(prov ?? "").trim();
			const wantModel = String(model ?? "").trim();
			if (!wantProvider || !wantModel) return m.notify("err", "请选择服务商并填写模型 ID");
			if (wantModel.includes("/")) return m.notify("err", "模型 ID 里不要再带服务商前缀");
			const key = `${wantProvider}/${wantModel}`;
			if (key in draft) return m.notify("err", `${key} 已经在列表里`);
			setDraft((s) => ({ ...s, [key]: priceDraft(undefined) }));
			setOpen((s) => new Set(s).add(key));
			setAddModel("");
			setAdding(false);
		};
		/** Drop the row, deleting the saved price too. */
		const removeRow = (k) => m.run("已删除该模型单价", async () => {
			if (Object.prototype.hasOwnProperty.call(saved, k)) await m.write(OWN_NS, [{ op: "unset", path: ["usagePrices", k] }]);
			setDraft((s) => { const n = { ...s }; delete n[k]; return n; });
			setOpen((s) => { const n = new Set(s); n.delete(k); return n; });
		});
		const save = () => m.run("单价已保存（历史费用已按新价格重新估算）", () => {
			const value = {};
			for (const [k, d] of Object.entries(draft)) {
				const v = priceValue(k, d);
				if (v) value[k] = v;
			}
			return m.write(OWN_NS, [{ op: "set", path: ["usagePrices"], value }]);
		});
		const priceInput = (k, value, onChange, label, placeholder) => h(TextInput, { value, onChange, placeholder, ariaLabel: `${k} ${label}`, style: { width: 76 } });
		const fieldGrid = (k, src, onChange, prefix, isTier) => PRICE_FIELDS.map(([f, label]) => h("label", { key: f, style: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: C.fg2 } },
			label, priceInput(k, src[f] ?? "", (v) => onChange(f, v), `${prefix}${label}单价`, f === "input" || f === "output" ? (isTier ? "同基础" : "0") : isTier ? "同基础" : "同输入")));
		const rowStyle = { padding: "10px 0", borderTop: `1px solid ${C.b1}` };
		const pricedCount = Object.keys(saved).length;
		return h(Card, {
			id: "prices", title: "单价（用于估算费用）", summary: pricedCount ? `已配置 ${pricedCount} 个模型` : "未配置",
			right: h(React.Fragment, null,
				h(TextInput, { value: q, onChange: setQ, placeholder: "筛选服务商或模型", ariaLabel: "筛选模型单价", style: { width: 150 } }),
				h(Select, { value: provider, onChange: setProvider, options: [["", "全部服务商"], ...providers.map((x) => [x, x])], ariaLabel: "按服务商筛选单价", style: { width: 130 } }),
				h(Select, { value: sort, onChange: setSort, options: PRICE_SORTS, ariaLabel: "单价排序", style: { width: 130 } }),
				h(Btn, { kind: "primary", onClick: save, disabled: !own || !data.writable || m.busy }, "保存单价"))
		},
			h("div", { style: { ...S.hint, marginTop: 0 } },
				"DSH 不提供模型价格，请按服务商官网填写。按量单位是每百万 tokens，缓存命中 / 写入留空时按输入单价算；按次是每次调用的价格，失败的调用不计，中断的照常计。",
				h("br"),
				"阶梯价格：单次调用的提示词（输入 + 缓存命中 + 缓存写入）超过阈值时，这次调用整体按该档计价，没填的项沿用基础价格。阈值单位是 K tokens（272 = 272,000）。修改价格会重新估算历史费用；新加的阈值只能精确区分之后的调用，之前的调用按基础价格算。",
				h("br"),
				"单价完全手动：列表里只会有你自己添加的模型，用量统计和测试调用都不会自动塞条目。测试调用也不计入费用。"),
			h("div", { style: { ...S.row, margin: "10px 0" } },
				adding
					? h(React.Fragment, null,
						h(Select, { value: addProvider, onChange: setAddProvider, options: [["", "选择服务商…"], ...providers.map((x) => [x, x])], ariaLabel: "新增单价的服务商", style: { width: 150 } }),
						h(TextInput, { value: addModel, onChange: setAddModel, placeholder: "模型 ID，例如 gpt-4o", ariaLabel: "新增单价的模型", style: { width: 200 } }),
						catalogFor(addProvider).length ? h(Select, { value: "", onChange: (v) => setAddModel(v), options: [["", "从模型目录选…"], ...catalogFor(addProvider).map((m0) => [m0, m0])], ariaLabel: "从模型目录选择", style: { width: 170 } }) : null,
						h(Btn, { kind: "primary", onClick: () => addRow(addProvider, addModel), disabled: m.busy || !data.writable || !addProvider || !addModel.trim() }, "添加"),
						h(Btn, { onClick: () => { setAdding(false); setAddModel(""); } }, "取消"))
					: h(Btn, { onClick: () => setAdding(true), disabled: m.busy || !data.writable }, "＋ 添加模型价格")),
			keys.length === 0 ? h("div", { style: { color: C.fg2 } }, needle ? "没有匹配的单价。" : "还没有单价。需要时用上面的输入框或下拉框自己添加一个模型。") : keys.map((k) => {
				const d = get(k);
				const isOpen = open.has(k);
				const tokenOn = d.mode !== "call";
				const callOn = d.mode !== "token";
				let pending;
				try { pending = priceValue(k, d); } catch { pending = undefined; }
				const changed = JSON.stringify(pending ?? null) !== JSON.stringify(saved[k] ? priceValue(k, priceDraft(saved[k])) ?? null : null);
				return h("div", { key: k, style: rowStyle },
					h("div", { style: { ...S.row, justifyContent: "space-between" } },
						h("div", { style: { ...S.row, minWidth: 0 } },
							h("span", { style: { ...S.mono, wordBreak: "break-all" } }, k),
							used.includes(k) ? null : h("span", { style: { ...S.chip, fontSize: 11 } }, "暂无调用"),
							changed ? h("span", { style: { ...S.chip, fontSize: 11, color: C.warn } }, "未保存") : null),
						h("div", { style: S.row },
							h(Select, { value: d.mode, onChange: (v) => set(k, "mode", v), options: PRICE_MODES, ariaLabel: `${k} 计费方式` }),
							h(Select, { value: d.currency, onChange: (v) => set(k, "currency", v), options: CURRENCIES, ariaLabel: `${k} 币种` }),
							callOn ? h("label", { style: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: C.fg2 } }, "每次", priceInput(k, d.perCall, (v) => set(k, "perCall", v), "每次价格", "0")) : null,
							tokenOn ? h(Btn, { onClick: () => toggle(k), "aria-expanded": isOpen }, isOpen ? "收起" : `按量价格${d.tiers.length ? ` · ${d.tiers.length} 档阶梯` : ""}`) : null,
							draft[k] ? h(Btn, { onClick: () => clear(k), title: "只清空当前编辑内容（点“保存单价”后才写入）" }, "清空") : null,
							h(Btn, { kind: "danger", onClick: () => removeRow(k), disabled: m.busy || !data.writable, title: "删除这个模型的单价（已保存的会一起删除）" }, "删除"))),
					tokenOn && !isOpen ? h("div", { style: { fontSize: 12, color: C.fg2, marginTop: 4 } }, priceSummary(pending, d.currency)) : null,
					tokenOn && isOpen ? h("div", { style: { marginTop: 8, padding: "8px 10px", borderRadius: 8, background: C.bg, border: `1px solid ${C.b1}` } },
						h("div", { style: { ...S.row, gap: 10 } },
							h("span", { style: { fontSize: 12, fontWeight: 600, width: 150 } }, d.tiers.length ? "基础价格（默认档）" : "价格 / 百万 tokens"),
							fieldGrid(k, d, (f, v) => set(k, f, v), "", false)),
						d.tiers.map((t) => h("div", { key: t.id, style: { ...S.row, gap: 10, marginTop: 8 } },
							h("label", { style: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, width: 150 } }, "提示词 >", priceInput(k, t.above, (v) => setTier(k, t.id, "above", v), "阶梯阈值（K tokens）", "272"), "K"),
							fieldGrid(k, t, (f, v) => setTier(k, t.id, f, v), `>${t.above || "?"}K 档`, true),
							h(Btn, { kind: "danger", onClick: () => delTier(k, t.id), title: "删除这一档" }, "删除"))),
						h("div", { style: { marginTop: 8 } }, h(Btn, { onClick: () => addTier(k) }, "+ 阶梯价格"))) : null);
			}));
	}

	// ---------------------------------------------------------------- page
	const TABS = [["providers", "服务商与模型"], ["default", "默认模型"], ["subagent", "子代理"], ["failover", "故障切换/重定向"], ["usage", "用量统计"], ["diagnostics", "测试/诊断"]];

	function Page({ api }) {
		const m = useManager(api);
		const [tab, setTab] = useState("providers");
		// Keep the diagnostics tab mounted once opened so running tests and results survive tab switches.
		const [diagSeen, setDiagSeen] = useState(false);
		useEffect(() => { if (tab === "diagnostics") setDiagSeen(true); }, [tab]);
		const { state } = m;
		let body;
		if (state.status === "loading" && !state.data) body = h("div", { style: { color: C.fg2 } }, "加载中…");
		else if (!state.data) body = h("div", { style: S.card }, `加载失败：${state.error ?? "未知错误"} `, h(Btn, { onClick: m.reload }, "重试"));
		else if (tab === "providers") body = h(ProvidersTab, { m, api });
		else if (tab === "default") body = h(DefaultTab, { m, key: state.data.desc?.namespaces?.length });
		else if (tab === "subagent") body = h(SubagentTab, { m });
		else if (tab === "failover") body = h(FailoverTab, { m, api, active: true });
		else if (tab === "usage") body = h(UsageTab, { m, api, active: true });
		else body = null;
		const diag = state.data && (diagSeen || tab === "diagnostics")
			? h("div", { style: { display: tab === "diagnostics" ? "block" : "none" } }, h(DiagnosticsTab, { m, api, active: tab === "diagnostics" }))
			: null;
		return h("div", { style: S.page },
			h("div", { style: S.inner },
				m.flash ? h("div", { role: "status", style: S.flash(m.flash.kind) }, m.flash.text) : null,
				h("div", { style: { ...S.row, justifyContent: "space-between" } },
					h("div", null,
						h("h1", { style: S.h1 }, "模型管理"),
						h("p", { style: S.sub }, "第三方服务商、模型推理档位、默认模型与子代理设置。修改即时生效，无需重启。")),
					h(Btn, { onClick: m.reload, disabled: m.busy }, "刷新")),
				state.data && !state.data.writable ? h("div", { style: S.warnBox }, "当前配置文档不可写，修改不会被保存。") : null,
				h("div", { role: "tablist", style: S.tabs },
					TABS.map(([k, label]) => h("button", { key: k, type: "button", role: "tab", "aria-selected": tab === k, style: S.tab(tab === k), onClick: () => setTab(k) }, label))),
				body,
				diag));
	}

	// ---------------------------------------------------------------- plugin entry
	const name = "dsh-model-manager";
	const inject = ["slots", "locale", "remote", "remote.settings", "remote.credentials", "remote.llm", "remote.session"];
	const LOCALE_NS = "model-manager";

	function apply(ctx) {
		const api = createApi(ctx);
		ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh: { panel: "模型管理" }, en: { panel: "Models" } }), "model-manager: dictionaries");
		const t = ctx.locale.bind(LOCALE_NS);
		function ModelManagerPage() {
			return h(Page, { api });
		}
		ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: PANEL_ID, locale: LOCALE_NS, inject: () => ({}) }, ModelManagerPage));
		ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
			name: "sidebar.panellist",
			id: PANEL_ID,
			order: 20,
			locale: LOCALE_NS,
			label: () => t("panel")
		}, ModelIcon));
		// Subagent Sessions: DSH renders no model seat there, so offer ours before the submit action.
		ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
			name: "conversation.input.right",
			id: "model-manager.subagent-model",
			order: 50,
			locale: LOCALE_NS,
			inject: () => ({ api })
		}, SubagentModelSeat));
	}

	exports.name = name;
	exports.inject = inject;
	exports.apply = apply;
	return module.exports;
} });
