import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { adaptiveFetchArgs, adaptiveThinkingBody, aliasFetchArgs, aliasUpstream, parseModelRoute } from '../lib/routing.js';
import { createUsageStore } from '../lib/usage.js';
import { resolveDep } from './deps.mjs';

const keys = [
  { id: 'fallback', models: [] },
  { id: 'cheap', models: ['gpt-*', 'gpt-4o-0.05=gpt-4o'], limit: 10 },
  { id: 'fast', models: ['gpt-4o-0.5=gpt-4o'], limit: 100 }
];

test('aliases map to the upstream model regardless of Key state (the 404 regression)', () => {
  assert.equal(aliasUpstream(keys, 'gpt-4o-0.05'), 'gpt-4o');
  assert.equal(aliasUpstream(keys, 'gpt-4o-0.5'), 'gpt-4o');
  assert.equal(aliasUpstream(keys, 'gpt-other'), 'gpt-other');
  assert.equal(aliasUpstream([], 'gpt-4o-0.05'), null);
  // Exact aliases win over a wildcard on another group.
  assert.equal(aliasUpstream([{ models: ['gpt-*'] }, { models: ['gpt-4o-0.05=gpt-4o'] }], 'gpt-4o-0.05'), 'gpt-4o');
  // Disabled or exhausted groups must still rewrite: an alias that exists must
  // never be sent upstream as its own model ID.
  assert.equal(aliasUpstream(keys.map((k) => k.id === 'fast' ? { ...k, enabled: false, limit: 0 } : k), 'gpt-4o-0.5'), 'gpt-4o');
  assert.equal(aliasUpstream(keys.map((k) => k.id === 'cheap' ? { ...k, limit: 0 } : k), 'gpt-4o-0.05'), 'gpt-4o');
  // A malformed binding is skipped rather than breaking every request.
  assert.equal(aliasUpstream([{ models: ['broken='] }, { models: ['gpt-4o-0.05=gpt-4o'] }], 'gpt-4o-0.05'), 'gpt-4o');
  assert.throws(() => parseModelRoute('alias='), /Invalid/);
  assert.throws(() => parseModelRoute('alias*=model'), /exact/);
});

test('both Request and URL init bodies map model without mutating inputs', async () => {
  const context = { model: 'gpt-4o-0.5', upstreamModel: 'gpt-4o', baseURL: 'https://api.example/v1' };
  for (const endpoint of ['chat/completions', 'responses', 'messages']) {
    const init = { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '99' }, body: JSON.stringify({ model: context.model, messages: [] }) };
    const url = `https://api.example/v1/${endpoint}`;
    const [, mapped] = await aliasFetchArgs(url, init, context);
    assert.equal(JSON.parse(mapped.body).model, 'gpt-4o');
    assert.equal(JSON.parse(init.body).model, context.model);
    assert.equal(mapped.headers.has('content-length'), false);
    const request = new Request(url, init);
    const [result] = await aliasFetchArgs(request, undefined, context);
    assert.equal(JSON.parse(await result.text()).model, 'gpt-4o');
    assert.equal(JSON.parse(await request.text()).model, context.model);
    const [unrelated, sameInit] = await aliasFetchArgs('https://other.example/v1/responses', init, context);
    assert.equal(unrelated, 'https://other.example/v1/responses');
    assert.equal(sameInit, init);
  }
});

test('Key spend survives persistence and resets independently', () => {
  const store = createUsageStore({ now: () => 123 });
  store.addKeySpend('p', 'cheap', 0.05);
  store.addKeySpend('p', 'fast', 0.5);
  const restored = createUsageStore();
  restored.load(store.takeSnapshot());
  assert.equal(restored.keySpends().find((x) => x.keyId === 'fast').spent, 0.5);
  restored.resetKeySpend('p', 'cheap');
  assert.equal(restored.keySpends().find((x) => x.keyId === 'cheap').spent, 0);
  assert.equal(restored.keySpends().find((x) => x.keyId === 'fast').spent, 0.5);
});

test('plugin middleware rewrites aliases and keeps the provider single credential', async () => {
  // Resolve the plugin's existing dependencies without modifying node_modules.
  let source = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8');
  for (const spec of ['undici', '@deepseek-ai/schemastery']) source = source.replace(`from "${spec}"`, `from ${JSON.stringify(pathToFileURL(resolveDep(spec)).href)}`);
  for (const spec of ['./usage.js', './routing.js']) source = source.replace(`from "${spec}"`, `from ${JSON.stringify(new URL('../lib/' + spec.slice(2), import.meta.url).href)}`);
  const { apply } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const seen = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    seen.push({ body: JSON.parse(body), key: req.headers.authorization });
    res.end('ok');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseURL = `http://127.0.0.1:${server.address().port}/v1`;
  const callbacks = new Map();
  const cleanups = [];
  const credentials = { async resolve(ref) { return { value: ref, source: 'test' }; } };
  const originalResolve = credentials.resolve;
  const originalFetch = globalThis.fetch;
  const own = { providerKeys: { p: { keys } }, usagePrices: { 'p/gpt-4o-0.05': { input: 0.05, output: 0.1 }, 'p/gpt-4o-0.5': { input: 0.5, output: 1 } } };
  let persisted;
  const ctx = {
    settings: { describe: () => [{ ns: 'model-manager', value: own }, { ns: 'llm-pi-ai', value: { providers: { p: { baseURL, api: 'openai-completions', apiKeyEnv: 'P_API_KEY', transport: 'sse' } } } }] },
    get: (name) => name === 'credentials' ? credentials : undefined,
    on: (name, listener) => callbacks.set(name, listener),
    effect: (fn) => cleanups.push(fn()),
    plugin: (plugin) => {
      if (plugin.name === 'dsh-model-manager/usage-store') plugin.apply({
        storageDomain: { async open() { return { global: { get: () => ({ version: 1, since: 0, days: {} }), set: (value) => { persisted = value; } }, close() {} }; } },
        effect: (fn) => cleanups.push(fn())
      });
    }
  };
  try {
    apply(ctx, own);
    const middleware = callbacks.get('llm/stream');
    async function call(model, asRequest) {
      const options = Object.freeze({ provider: 'p', model });
      const result = middleware(options, () => (async function* () {
        const key = (await credentials.resolve('P_API_KEY')).value;
        await new Promise((resolve) => setImmediate(resolve));
        const init = { method: 'POST', headers: { 'content-type': 'application/json', authorization: key }, body: JSON.stringify({ model }) };
        const url = `${baseURL}/chat/completions`;
        const response = asRequest ? await fetch(new Request(url, init)) : await fetch(url, init);
        assert.equal(await response.text(), 'ok');
        yield { type: 'usage', usage: { inputTokens: 1000, outputTokens: 500 } };
        yield { type: 'finish', reason: { kind: 'stop' } };
      })());
      for await (const chunk of result) assert.ok(chunk);
    }
    await Promise.all([call('gpt-4o-0.05', true), call('gpt-4o-0.5', false)]);
    assert.equal(seen.length, 2);
    assert.ok(seen.every((x) => x.body.model === 'gpt-4o'));
    // Multi-Key routing is retired: both concurrent calls use the provider's own key.
    assert.deepEqual(seen.map((x) => x.key), ['P_API_KEY', 'P_API_KEY']);
    assert.equal((await credentials.resolve('P_API_KEY')).value, 'P_API_KEY');
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup?.();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(credentials.resolve, originalResolve);
  assert.equal(globalThis.fetch, originalFetch);
  // No per-Key spend is accumulated any more, but daily usage still splits by alias.
  assert.deepEqual(Object.keys(persisted.keySpend ?? {}), []);
  const models = Object.keys(Object.values(persisted.days)[0]).map((k) => JSON.parse(k)[1]).sort();
  assert.deepEqual(models, ['gpt-4o-0.05', 'gpt-4o-0.5']);
});

test('adaptive thinking conversion matches the Claude adaptive wire format', () => {
  // Classic payload → adaptive + output_config.effort (budget_tokens must go away).
  const high = adaptiveThinkingBody({ model: 'm', max_tokens: 100, thinking: { type: 'enabled', budget_tokens: 16384 } }, 'high');
  assert.deepEqual(high.thinking, { type: 'adaptive' });
  assert.deepEqual(high.output_config, { effort: 'high' });
  assert.equal('budget_tokens' in high.thinking, false);
  assert.equal(high.max_tokens, 100);
  // Level → effort mapping, including the extended levels.
  assert.equal(adaptiveThinkingBody({ thinking: { type: 'enabled', budget_tokens: 1 } }, 'minimal').output_config.effort, 'low');
  assert.equal(adaptiveThinkingBody({ thinking: { type: 'enabled', budget_tokens: 1 } }, 'xhigh').output_config.effort, 'high');
  assert.equal(adaptiveThinkingBody({ thinking: { type: 'enabled', budget_tokens: 1 } }, 'max').output_config.effort, 'max');
  // Existing output_config keys survive.
  assert.equal(adaptiveThinkingBody({ output_config: { format: 'x' }, thinking: { type: 'enabled', budget_tokens: 1 } }, 'medium').output_config.format, 'x');
  // "off" drops a legacy thinking block instead of sending one the provider rejects.
  const off = adaptiveThinkingBody({ model: 'm', thinking: { type: 'enabled', budget_tokens: 1 } }, 'off');
  assert.equal('thinking' in off, false);
  assert.equal(adaptiveThinkingBody({ model: 'm' }, 'off'), null);
  assert.equal(adaptiveThinkingBody({ model: 'm' }, undefined), null);
  // Already-adaptive bodies just get the effort refreshed.
  assert.equal(adaptiveThinkingBody({ thinking: { type: 'adaptive' }, output_config: { effort: 'low' } }, 'high').output_config.effort, 'high');
});

test('adaptive rewriting is limited to the opted-in provider Messages endpoint', async () => {
  const context = { baseURL: 'https://relay.test/v1', adaptive: true, effort: 'high' };
  const init = () => ({ method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '9' }, body: JSON.stringify({ model: 'claude-opus-5-5', thinking: { type: 'enabled', budget_tokens: 8000 } }) });
  const [, mapped] = await adaptiveFetchArgs('https://relay.test/v1/messages', init(), context);
  assert.deepEqual(JSON.parse(mapped.body).thinking, { type: 'adaptive' });
  assert.equal(JSON.parse(mapped.body).output_config.effort, 'high');
  // A Request body is rewritten without mutating the original.
  const original = new Request('https://relay.test/v1/messages', init());
  const [rewritten] = await adaptiveFetchArgs(original, undefined, context);
  assert.equal(JSON.parse(await rewritten.text()).thinking.type, 'adaptive');
  assert.equal(JSON.parse(await original.text()).thinking.type, 'enabled');
  // Everything else stays untouched: other paths, other hosts, non-opt-in providers.
  const untouched = [
    ['https://relay.test/v1/chat/completions', context],
    ['https://other.test/v1/messages', context],
    ['https://relay.test/v1/messages', { ...context, adaptive: false }],
    ['https://relay.test/v1/messages', { ...context, baseURL: undefined }]
  ];
  for (const [url, ctx] of untouched) {
    const [, same] = await adaptiveFetchArgs(url, init(), ctx);
    assert.equal(JSON.parse(same.body).thinking.type, 'enabled', url);
  }
  const [, got] = await adaptiveFetchArgs('https://relay.test/v1/messages', { ...init(), method: 'GET' }, context);
  assert.equal(JSON.parse(got.body).thinking.type, 'enabled');
});
