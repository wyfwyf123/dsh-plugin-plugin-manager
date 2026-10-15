import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

test('saving two Key groups creates two alias models with inherited capability metadata', async () => {
  let source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  source = source.replace('return module.exports;', 'exports.TestSave = saveKeyBindings; return module.exports;');
  let exported;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {}, useCallback: (x) => x, useMemo: (fn) => fn(), useRef: () => ({})
  };
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: (definition) => { exported = definition.factory(() => react); } } } });
  const calls = [];
  const rows = [
    { id: 'cheap', models: ['gpt-4o-0.05=gpt-4o'], enabled: true },
    { id: 'fast', models: ['gpt-4o-0.5=gpt-4o'], enabled: true }
  ];
  const original = { id: 'gpt-4o', name: 'GPT 4o', contextWindow: 128000, maxTokens: 16000, input: ['text', 'image'] };
  const provider = { id: 'p', ref: 'P_API_KEY', value: { api: 'openai-completions', baseURL: 'https://example.test/v1', models: [original] } };
  const data = { own: { value: { providerKeys: { p: { keys: rows } } } }, catalog: { groups: [] }, writable: true };
  const manager = { write: async (ns, ops) => calls.push({ ns, ops }), run: async (_message, fn) => fn() };
  await exported.TestSave(provider, manager, data, rows);
  const op = calls.find((x) => x.ns === 'llm-pi-ai').ops.find((x) => x.path.at(-1) === 'models');
  assert.equal(op.value.length, 3);
  assert.deepEqual(Array.from(op.value, (x) => x.id), ['gpt-4o', 'gpt-4o-0.05', 'gpt-4o-0.5']);
  assert.equal(op.value[1].contextWindow, 128000);
  assert.equal(op.value[2].maxTokens, 16000);
  assert.equal(calls.at(-1).ns, 'model-manager');
  assert.equal(calls.at(-1).ops[0].value.keys.length, 2);
});
