import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

test('merge creation appends one Key and model aliases to an existing provider', async () => {
  let source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  source = source.replace('return module.exports;', 'exports.TestMerge = mergeProviderDraft; return module.exports;');
  let exported;
  const react = { createElement() {}, useState() {}, useEffect() {}, useCallback(x) { return x; }, useMemo(fn) { return fn(); }, useRef() {} };
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: (entry) => { exported = entry.factory(() => react); } } } });
  const target = { id: 'openai', value: { models: [{ id: 'gpt-4o', name: 'GPT 4o', contextWindow: 128000 }] } };
  const data = { own: { value: { providerKeys: { openai: { keys: [{ id: 'default', models: [] }] } } } }, catalog: { groups: [] } };
  const result = exported.TestMerge({ target, data, keyId: 'cheap', keyLabel: '0.05', modelText: 'gpt-4o-0.05=gpt-4o, o3-mini-0.05=o3-mini', preset: 'standard' });
  assert.equal(JSON.stringify(Array.from(result.key.models)), JSON.stringify(['gpt-4o-0.05=gpt-4o', 'o3-mini-0.05=o3-mini']));
  assert.equal(result.models.find((x) => x.id === 'gpt-4o-0.05').contextWindow, 128000);
  assert.equal(JSON.stringify(result.models.find((x) => x.id === 'gpt-4o-0.05').reasoningEfforts), JSON.stringify({ off: null, low: 'low', medium: 'medium', high: 'high' }));
  assert.equal(result.models.find((x) => x.id === 'o3-mini-0.05').name, 'o3-mini-0.05 · 0.05');
});
