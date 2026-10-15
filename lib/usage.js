// dsh-model-manager — model usage accounting (Host half).
//
// Every model call passes the `llm/stream` waterfall; `tapUsage` forwards the
// chunks unchanged and observes the adapter-reported `usage` chunk plus the
// terminal `finish`. DSH ships no price metadata, so cost is an estimate from
// user-entered per-million-token prices (see `costOf`).
//
// Prices may be per token (optionally tiered by prompt size), per call, or both.
//
// Persisted: daily buckets per provider/model/kind (storageDomain global slot).
// In memory only: the recent-call ring and per-session totals.

export const USAGE_FIELDS = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokens"];
export const USAGE_KINDS = ["main", "subagent", "probe", "other"];
export const USAGE_LIMITS = {
	retainDays: 400,
	recent: 300,
	sessions: 1000,
	flushMs: 15000,
	maxRangeDays: 400
};

const num = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
const pad = (n) => String(n).padStart(2, "0");

/** Local calendar day key (YYYY-MM-DD) in the Host time zone. */
export function dayKey(t = Date.now()) {
	const d = new Date(t);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const emptyCounter = () => ({
	calls: 0, errors: 0, aborted: 0, noUsage: 0,
	inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0,
	durationMs: 0, firstTokenMs: 0, firstTokenCalls: 0
});
const COUNTER_KEYS = Object.keys(emptyCounter());

// Prompt-size bands. Tiered prices ("input > 272K costs more") depend on each
// call's prompt size, which a daily sum loses. So every counter also keeps the
// share of calls whose prompt (input + cache read + cache write) exceeded each
// configured tier threshold: bands["272000"] = {calls, errors, tokens…}.
// Band "0" (below every threshold) is the remainder and is not stored.
const BAND_KEYS = ["calls", "errors", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"];
const MAX_BANDS = 16;
const BAND_RE = /^[1-9]\d{0,9}$/;
export const promptTokens = (c) => num(c.inputTokens) + num(c.cacheReadTokens) + num(c.cacheWriteTokens);

const speedOfCall = (call) => {
	const output = num(call?.usage?.outputTokens);
	const total = num(call?.durationMs);
	const first = num(call?.firstTokenMs);
	const generation = total - first;
	return output > 0 && generation > 50 ? Math.round((output / generation) * 10000) / 10 : null;
};

/** Add one call (or another counter) into `into`, bands included. */
export function addInto(into, src) {
	for (const k of COUNTER_KEYS) into[k] = num(into[k]) + num(src?.[k]);
	if (src?.bands && typeof src.bands === "object" && !Array.isArray(src.bands)) {
		for (const [b, sub] of Object.entries(src.bands)) {
			if (!BAND_RE.test(b) || !sub || typeof sub !== "object") continue;
			into.bands ??= {};
			if (!into.bands[b] && Object.keys(into.bands).length >= MAX_BANDS) continue;
			const dst = (into.bands[b] ??= Object.fromEntries(BAND_KEYS.map((k) => [k, 0])));
			for (const k of BAND_KEYS) dst[k] = num(dst[k]) + num(sub[k]);
		}
	}
	return into;
}

/** Largest bound strictly below the prompt size (0 when none). */
const bandOf = (prompt, bounds) => {
	let band = 0;
	for (const b of bounds ?? []) if (prompt > b && b > band) band = b;
	return band;
};

function counterOfCall(call) {
	const c = emptyCounter();
	c.calls = 1;
	if (call.outcome === "error") c.errors = 1;
	if (call.outcome === "aborted") c.aborted = 1;
	if (!call.usage) c.noUsage = 1;
	for (const f of USAGE_FIELDS) c[f] = num(call.usage?.[f]);
	c.durationMs = num(call.durationMs);
	if (typeof call.firstTokenMs === "number") {
		c.firstTokenMs = num(call.firstTokenMs);
		c.firstTokenCalls = 1;
	}
	const band = bandOf(promptTokens(c), call.bounds);
	if (band > 0) c.bands = { [band]: Object.fromEntries(BAND_KEYS.map((k) => [k, c[k]])) };
	return c;
}

const PRICE_FIELDS = ["input", "output", "cacheRead", "cacheWrite"];
const priceNum = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
const tokenCost = (c, r) => (num(c.inputTokens) * (r.input ?? 0) + num(c.outputTokens) * (r.output ?? 0)
	+ num(c.cacheReadTokens) * (r.cacheRead ?? 0) + num(c.cacheWriteTokens) * (r.cacheWrite ?? 0)) / 1e6;

/** Token rates for prompts above `band`: the highest tier whose threshold ≤ band, falling back to the base price. */
function ratesFor(price, band) {
	let tier;
	for (const t of price.tiers ?? []) if (t.above <= band) tier = t;
	const pick = (k) => tier?.[k] ?? price[k];
	const input = pick("input");
	return {
		input,
		output: pick("output"),
		// Unset cache prices fall back to the (tier's) input price.
		cacheRead: tier?.cacheRead ?? price.cacheRead ?? input,
		cacheWrite: tier?.cacheWrite ?? price.cacheWrite ?? input
	};
}

/**
 * Estimated cost for one counter (a call, a daily bucket or a session).
 * Token prices are per million tokens; adapters report input excluding cache
 * hits, so cache reads/writes are priced separately. Per-call prices charge
 * every call that did not fail. Tiered prices apply to the whole call once its
 * prompt exceeds the tier threshold (how providers bill long context).
 * @returns the cost, or null when the model has no price.
 */
export function costOf(counter, price) {
	if (!price || typeof price !== "object") return null;
	const hasToken = PRICE_FIELDS.some((k) => price[k] !== undefined) || (price.tiers?.length ?? 0) > 0;
	const hasCall = price.perCall !== undefined;
	if (!hasToken && !hasCall) return null;
	let total = 0;
	if (hasCall) total += Math.max(0, num(counter.calls) - num(counter.errors)) * price.perCall;
	if (hasToken) {
		const rest = Object.fromEntries(BAND_KEYS.map((k) => [k, num(counter[k])]));
		for (const [b, sub] of Object.entries(counter.bands ?? {})) {
			total += tokenCost(sub, ratesFor(price, Number(b)));
			for (const k of BAND_KEYS) rest[k] = Math.max(0, rest[k] - num(sub[k]));
		}
		total += tokenCost(rest, ratesFor(price, 0));
	}
	return total;
}

/**
 * Normalize the `usagePrices` settings value: "provider/model" →
 * { mode, currency, input?, output?, cacheRead?, cacheWrite?, perCall?, tiers? }.
 * mode: "token" | "call" | "mixed"; fields the mode does not use are dropped.
 */
export function normalizePrices(value) {
	const out = {};
	if (!value || typeof value !== "object" || Array.isArray(value)) return out;
	for (const [key, raw] of Object.entries(value)) {
		const slash = key.indexOf("/");
		if (slash <= 0 || slash === key.length - 1 || !raw || typeof raw !== "object") continue;
		const price = {};
		for (const k of PRICE_FIELDS) if (priceNum(raw[k]) !== undefined) price[k] = raw[k];
		const tiers = [];
		for (const t of Array.isArray(raw.tiers) ? raw.tiers : []) {
			const above = Number.isInteger(t?.above) && t.above > 0 ? t.above : undefined;
			if (!above || tiers.some((x) => x.above === above)) continue;
			const tier = { above };
			for (const k of PRICE_FIELDS) if (priceNum(t[k]) !== undefined) tier[k] = t[k];
			if (Object.keys(tier).length > 1) tiers.push(tier);
		}
		tiers.sort((a, b) => a.above - b.above);
		if (tiers.length) price.tiers = tiers.slice(0, MAX_BANDS);
		if (priceNum(raw.perCall) !== undefined) price.perCall = raw.perCall;
		const hasToken = PRICE_FIELDS.some((k) => price[k] !== undefined) || !!price.tiers;
		const hasCall = price.perCall !== undefined;
		const mode = raw.mode === "token" || raw.mode === "call" || raw.mode === "mixed" ? raw.mode : hasCall && hasToken ? "mixed" : hasCall ? "call" : "token";
		if (mode === "token") delete price.perCall;
		if (mode === "call") {
			for (const k of PRICE_FIELDS) delete price[k];
			delete price.tiers;
		}
		if (!PRICE_FIELDS.some((k) => price[k] !== undefined) && !price.tiers && price.perCall === undefined) continue;
		price.mode = mode;
		price.currency = typeof raw.currency === "string" && raw.currency ? raw.currency.slice(0, 8) : "CNY";
		out[key] = price;
	}
	return out;
}

/** Sorted tier thresholds across all prices; used as prompt-size band bounds. */
export function priceBounds(prices) {
	const set = new Set();
	for (const p of Object.values(prices ?? {})) for (const t of p.tiers ?? []) set.add(t.above);
	return [...set].sort((a, b) => a - b).slice(0, MAX_BANDS * 2);
}
export const priceKey = (provider, model) => `${provider}/${model}`;

const bucketKey = (provider, model, kind) => JSON.stringify([provider, model, kind]);
const parseBucketKey = (k) => {
	try {
		const v = JSON.parse(k);
		return Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "string") ? v : undefined;
	} catch {
		return undefined;
	}
};
const keyBucketKey = (provider, keyId, model, kind) => JSON.stringify([provider, keyId, model, kind]);
const parseKeyBucketKey = (k) => {
	try {
		const v = JSON.parse(k);
		return Array.isArray(v) && v.length === 4 && v.every((x) => typeof x === "string") ? v : undefined;
	} catch {
		return undefined;
	}
};

const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Validate (leniently) a persisted state; drops malformed buckets. */
export function sanitizeState(raw) {
	const days = {};
	const keySpend = {};
	if (isPlain(raw) && isPlain(raw.keySpend)) {
		for (const [k, v] of Object.entries(raw.keySpend)) {
			if (!/^.{1,200}$/.test(k) || !isPlain(v)) continue;
			const spent = num(v.spent);
			keySpend[k] = { spent, resetAt: typeof v.resetAt === "number" ? v.resetAt : Date.now() };
		}
	}
	if (isPlain(raw) && isPlain(raw.days)) {
		for (const [day, buckets] of Object.entries(raw.days)) {
			if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !isPlain(buckets)) continue;
			const clean = {};
			for (const [k, c] of Object.entries(buckets)) {
				if (!parseBucketKey(k) || !isPlain(c)) continue;
				clean[k] = addInto(emptyCounter(), c);
			}
			days[day] = clean;
		}
	}
	return { version: 1, since: isPlain(raw) && typeof raw.since === "number" ? raw.since : Date.now(), days, keySpend };
}

/** Schema object accepted by storageDomain's global slot (zod-like surface). */
export const usageStateSchema = {
	parse(v) {
		if (!isPlain(v) || !isPlain(v.days)) throw new Error("model-manager usage: malformed state");
		return sanitizeState(v);
	},
	safeParse(v) {
		try {
			return { success: true, data: this.parse(v) };
		} catch (error) {
			return { success: false, error };
		}
	}
};
export const USAGE_DOMAIN = {
	name: "model_manager_usage",
	version: 1,
	tables: {},
	global: { schema: usageStateSchema, initial: { version: 1, since: 0, days: {}, keySpend: {} } }
};

export function createUsageStore({ now = () => Date.now() } = {}) {
	let state = { version: 1, since: now(), days: {}, keySpend: {} };
	let dirty = false;
	let loaded = false;
	const recent = [];
	let recentSeq = 0;
	/** sessionId → { sessionId, subagent, lastAt, total, models: Map<bucketKey(provider,model,""), {provider,model,counter}> } */
	const sessions = new Map();

	const prune = () => {
		const days = Object.keys(state.days).sort();
		while (days.length > USAGE_LIMITS.retainDays) delete state.days[days.shift()];
	};

	return {
		/** Add priced spend to one provider Key's lifetime ledger. */
		addKeySpend(provider, keyId, amount) {
			if (typeof provider !== "string" || typeof keyId !== "string" || !Number.isFinite(amount) || amount <= 0) return;
			const k = JSON.stringify([provider, keyId]);
			const row = (state.keySpend[k] ??= { spent: 0, resetAt: now() });
			row.spent = num(row.spent) + amount;
			dirty = true;
		},
		keySpends() {
			return Object.entries(state.keySpend).flatMap(([k, v]) => {
			try { const [provider, keyId] = JSON.parse(k); return [{ provider, keyId, spent: num(v.spent), resetAt: v.resetAt ?? null }]; } catch { return []; }
			});
		},
		resetKeySpend(provider, keyId) {
			if (typeof provider !== "string" || typeof keyId !== "string") return;
			state.keySpend[JSON.stringify([provider, keyId])] = { spent: 0, resetAt: now() };
			dirty = true;
		},
		/** Record one finished (or abandoned) model call. */
		record(call) {
			const at = typeof call.at === "number" ? call.at : now();
			const kind = USAGE_KINDS.includes(call.kind) ? call.kind : "other";
			const c = counterOfCall(call);
			const day = (state.days[dayKey(at)] ??= {});
			const k = bucketKey(call.provider, call.model, kind);
			day[k] = addInto(day[k] ?? emptyCounter(), c);
			prune();
			dirty = true;
			recent.push({
				seq: ++recentSeq, at, kind, provider: call.provider, model: call.model,
				reasoningEffort: call.reasoningEffort ?? null, sessionId: call.sessionId ?? null,
				outcome: call.outcome, finish: call.finish ?? null, errorCode: call.errorCode ?? null,
				usage: call.usage ?? null, durationMs: call.durationMs ?? null, firstTokenMs: call.firstTokenMs ?? null,
				tokensPerSec: speedOfCall(call),
				promptTokens: promptTokens(c),
				counter: c // for pricing (bands included); stripped from API output
			});
			if (recent.length > USAGE_LIMITS.recent) recent.splice(0, recent.length - USAGE_LIMITS.recent);
			if (call.sessionId) {
				const prev = sessions.get(call.sessionId);
				sessions.delete(call.sessionId);
				const s = prev ?? { sessionId: call.sessionId, subagent: kind === "subagent", total: emptyCounter(), models: new Map(), tokensPerSec: null };
				s.lastAt = at;
				s.tokensPerSec = speedOfCall(call);
				addInto(s.total, c);
				const mk = bucketKey(call.provider, call.model, "");
				const entry = s.models.get(mk) ?? { provider: call.provider, model: call.model, counter: emptyCounter() };
				addInto(entry.counter, c);
				s.models.set(mk, entry);
				sessions.set(call.sessionId, s);
				while (sessions.size > USAGE_LIMITS.sessions) sessions.delete(sessions.keys().next().value);
			}
		},
		/** Flat rows: { day, provider, model, kind, ...counter } within [fromDay, toDay]. */
		rows(fromDay, toDay) {
			const out = [];
			for (const [day, buckets] of Object.entries(state.days)) {
				if ((fromDay && day < fromDay) || (toDay && day > toDay)) continue;
				for (const [k, c] of Object.entries(buckets)) {
					const parsed = parseBucketKey(k);
					if (parsed) out.push({ day, provider: parsed[0], model: parsed[1], kind: parsed[2], ...c });
				}
			}
			return out;
		},
		recent(limit = USAGE_LIMITS.recent) {
			return limit > 0 ? recent.slice(-limit).reverse() : [];
		},
		session(id) {
			const s = sessions.get(id);
			if (!s) return null;
			return { sessionId: s.sessionId, subagent: s.subagent, lastAt: s.lastAt, tokensPerSec: s.tokensPerSec ?? null, total: { ...s.total }, models: [...s.models.values()].map((e) => ({ provider: e.provider, model: e.model, ...e.counter })) };
		},
		sessionIds() {
			return [...sessions.keys()].reverse();
		},
		since: () => state.since,
		/** Clear everything (persisted buckets included). */
		reset() {
			state = { version: 1, since: now(), days: {}, keySpend: state.keySpend };
			recent.length = 0;
			sessions.clear();
			loaded = true; // a pending load must not resurrect cleared data
			dirty = true;
		},
		/**
		 * Merge the persisted state once per process. Calls recorded before the
		 * storage opened are kept; later reopen calls (hot reload) are ignored
		 * because memory is then already the superset.
		 */
		load(raw) {
			if (loaded) return false;
			loaded = true;
			const persisted = sanitizeState(raw);
			for (const [k, v] of Object.entries(persisted.keySpend)) {
				const pending = state.keySpend[k];
				state.keySpend[k] = { ...v, spent: num(v.spent) + num(pending?.spent) };
			}
			for (const [day, buckets] of Object.entries(persisted.days)) {
				const into = (state.days[day] ??= {});
				for (const [k, c] of Object.entries(buckets)) into[k] = addInto(into[k] ?? emptyCounter(), c);
			}
			if (persisted.since > 0 && persisted.since < state.since) state.since = persisted.since;
			prune();
			return true;
		},
		isLoaded: () => loaded,
		isDirty: () => dirty,
		/** Snapshot for persistence; marks the store clean. */
		takeSnapshot() {
			dirty = false;
			return JSON.parse(JSON.stringify(state));
		},
		markDirty() {
			dirty = true;
		}
	};
}

/**
 * Wrap one `llm/stream` result: forward every chunk unchanged, observe usage
 * and finish, then report exactly once (also when the consumer stops early).
 */
export async function* tapUsage(source, report, clock = () => performance.now()) {
	const t0 = clock();
	let firstToken;
	let usage;
	let finish;
	let thrown;
	try {
		for await (const chunk of source) {
			if (firstToken === undefined && (chunk?.type === "text-delta" || chunk?.type === "reasoning-delta" || chunk?.type === "tool-call-delta")) firstToken = clock();
			if (chunk?.type === "usage") usage = chunk.usage;
			else if (chunk?.type === "finish") finish = chunk.reason;
			yield chunk;
		}
	} catch (error) {
		thrown = error;
		throw error;
	} finally {
		const outcome = thrown !== undefined ? "error"
			: finish === undefined ? "aborted"
				: finish.kind === "error" ? "error"
					: finish.kind === "aborted" ? "aborted" : "ok";
		const clean = usage && typeof usage === "object"
			? Object.fromEntries(USAGE_FIELDS.filter((f) => typeof usage[f] === "number" && Number.isFinite(usage[f])).map((f) => [f, usage[f]]))
			: undefined;
		try {
			report({
				outcome,
				finish: finish?.kind ?? (thrown !== undefined ? "exception" : "incomplete"),
				errorCode: (finish?.failure?.code ?? thrown?.code) || null,
				usage: clean && Object.keys(clean).length ? clean : undefined,
				durationMs: Math.round(clock() - t0),
				firstTokenMs: firstToken === undefined ? undefined : Math.round(firstToken - t0)
			});
		} catch (error) {
			console.warn("[model-manager] usage report failed:", error);
		}
	}
}
