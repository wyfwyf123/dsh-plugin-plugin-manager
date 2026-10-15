// Local model aliases retain their identity in catalogs and accounting.
export function parseModelRoute(raw) {
	const text = String(raw ?? "").trim();
	const parts = text.split("=").map((x) => x.trim());
	if (!text || parts.length > 2 || parts.some((x) => !x)) throw new Error(`Invalid model route: ${text}`);
	const [alias, target] = parts;
	if (target && (alias.includes("*") || target.includes("*"))) throw new Error("Alias mappings must use exact model IDs");
	if (alias.includes("*") && (alias.indexOf("*") !== alias.length - 1)) throw new Error("Only a trailing wildcard is supported");
	return { alias, upstreamModel: target ?? alias, mapped: parts.length === 2 };
}

/**
 * Upstream model ID for one local model alias. Multi-Key routing is retired, so
 * this only answers "what model must go upstream" and never touches credentials,
 * quotas or enabled state: an alias that exists must always be rewritten, or the
 * provider receives a model ID it does not know (the 404 this replaced).
 */
export function aliasUpstream(keys, model) {
	let best = null;
	for (const key of keys ?? []) {
		for (const raw of key.models ?? []) {
			let route;
			try { route = parseModelRoute(raw); } catch { continue; }
			const specificity = route.alias === model ? 2 : route.alias.endsWith("*") && model.startsWith(route.alias.slice(0, -1)) ? 1 : -1;
			if (specificity < 0) continue;
			if (!best || specificity > best.specificity) best = { specificity, upstreamModel: route.mapped ? route.upstreamModel : model };
		}
	}
	return best ? best.upstreamModel : null;
}

/** Rewrite only the selected provider's JSON model call, never unrelated fetches. */
export async function aliasFetchArgs(input, init, context) {
	if (!context?.upstreamModel || context.upstreamModel === context.model) return [input, init];
	const request = input instanceof Request ? input : null;
	const url = new URL(request?.url ?? String(input));
	const base = new URL(context.baseURL);
	const prefix = base.pathname.replace(/\/$/, "");
	if (url.origin !== base.origin || !url.pathname.startsWith(`${prefix}/`) || !/\/(chat\/completions|responses|messages)\/?$/.test(url.pathname)) return [input, init];
	if (String(init?.method ?? request?.method ?? "GET").toUpperCase() !== "POST") return [input, init];
	const headers = new Headers(init?.headers ?? request?.headers);
	if (!/json/i.test(headers.get("content-type") ?? "")) throw new Error("Model alias routing requires a JSON request");
	const body = init?.body ?? (request ? await request.clone().text() : undefined);
	if (typeof body !== "string") throw new Error("Unsupported model alias request body");
	const parsed = JSON.parse(body);
	if (parsed?.model !== context.model) throw new Error("Model alias request identity mismatch");
	headers.delete("content-length");
	const mapped = JSON.stringify({ ...parsed, model: context.upstreamModel });
	if (request) return [new Request(request, { ...init, headers, body: mapped }), undefined];
	return [input, { ...init, headers, body: mapped }];
}
