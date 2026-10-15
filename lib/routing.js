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

export function selectModelKey(keys, model, spent = () => 0) {
	const candidates = [];
	for (const key of keys ?? []) {
		const routes = (key.models ?? []).map(parseModelRoute);
		const route = routes.map((r) => ({ ...r, specificity: r.alias === model ? 2 : r.alias.endsWith("*") && model.startsWith(r.alias.slice(0, -1)) ? 1 : -1 }))
			.filter((r) => r.specificity >= 0).sort((a, b) => b.specificity - a.specificity)[0];
		if (route) candidates.push({ key, route });
		else if (!routes.length && !key.onlyBound) candidates.push({ key, route: { alias: model, upstreamModel: model, specificity: 0 } });
	}
	if (!candidates.length) return null;
	const priority = Math.max(...candidates.map((x) => x.route.specificity));
	const exactGroup = candidates.filter((x) => x.route.specificity === priority);
	const mapped = exactGroup.filter((x) => x.route.mapped);
	if (mapped.length && exactGroup.length > 1) throw new Error(`Model alias ${model} is bound to multiple Keys`);
	for (const { key, route } of exactGroup) {
		if (key.enabled === false) continue;
		if (Number(key.limit) > 0 && spent(key.id) >= Number(key.limit)) continue;
		return { keyId: key.id, upstreamModel: route.mapped ? route.upstreamModel : model };
	}
	throw new Error(`Model group ${model} is disabled or its Key quota is exhausted`);
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
