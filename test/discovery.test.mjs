import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { resolveDep } from './deps.mjs';

async function loadPlugin() {
  let source = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8');
  for (const spec of ['undici', '@deepseek-ai/schemastery']) source = source.replace(`from "${spec}"`, `from ${JSON.stringify(pathToFileURL(resolveDep(spec)).href)}`);
  for (const spec of ['./usage.js', './routing.js']) source = source.replace(`from "${spec}"`, `from ${JSON.stringify(new URL('../lib/' + spec.slice(2), import.meta.url).href)}`);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('model discovery uses the selected Key, keeps results separate, and never falls back for missing secrets', async () => {
  const { apply, ROUTES } = await loadPlugin();
  const seen = [];
  const server = createServer((req, res) => {
    seen.push(req.headers.authorization);
    assert.equal(req.url, '/v1/models');
    const group = req.headers.authorization.replace('Bearer secret-', '');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: [{ id: 'gpt-4o' }, { id: group + '-only' }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseURL = `http://127.0.0.1:${server.address().port}/v1`;
  const cleanup = [];
  const routes = new Map();
  const secrets = { P_API_KEY: 'secret-default', MODEL_MANAGER_P_CHEAP_API_KEY: 'secret-cheap', MODEL_MANAGER_P_FAST_API_KEY: 'secret-fast' };
  const credentials = { async resolve(ref) { return secrets[ref] ? { value: secrets[ref], source: 'test' } : undefined; } };
  const own = { providerKeys: { p: { keys: [{ id: 'default', credentialRef: 'P_API_KEY', models: [] }, { id: 'cheap', models: [] }, { id: 'fast', models: [], enabled: false }, { id: 'missing', models: [] }] } } };
  const profile = { baseURL, api: 'openai-completions', apiKeyEnv: 'P_API_KEY' };
  const effect = (fn) => cleanup.push(fn());
  const ctx = {
    settings: { describe: () => [{ ns: 'model-manager', value: own }, { ns: 'llm-pi-ai', value: { providers: { p: profile } } }] },
    get: (name) => name === 'credentials' ? credentials : undefined,
    on() {}, effect,
    plugin(plugin) {
      if (plugin.name === 'dsh-model-manager/diagnostics') plugin.apply({
        effect, credentials,
        connection: { fetch: { register: (route) => { routes.set(route.path, route.fetch); return () => {}; } } },
        llm: { listConfigurableProviders: () => [], async resolveModelInfo() { throw new Error('not configured'); }, async discoverModels() { throw new Error('Key discovery must not use static catalogs'); } }
      });
    }
  };
  try {
    apply(ctx, own);
    const request = async (keyId) => routes.get(ROUTES.models)(new Request('http://local' + ROUTES.models, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'p', keyId }) }));
    for (const keyId of ['default', 'cheap', 'fast']) {
      const response = await request(keyId);
      assert.equal(response.status, 200);
      const value = await response.json();
      assert.equal(value.keyId, keyId);
      assert.deepEqual(value.models.map((x) => x.id), ['gpt-4o', keyId + '-only']);
      assert.equal(JSON.stringify(value).includes('secret-'), false);
    }
    const missing = await request('missing');
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).error.code, 'MISSING_CREDENTIAL');
    assert.equal((await request('unknown')).status, 404);
    assert.deepEqual(seen, ['Bearer secret-default', 'Bearer secret-cheap', 'Bearer secret-fast']);
  } finally {
    for (const dispose of cleanup.reverse()) await dispose?.();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
