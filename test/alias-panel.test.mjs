import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

test('alias panel adds a binding to the provider and keeps the single credential', async () => {
  let code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  code = code.replace('return module.exports;', 'exports.TestAlias = ProviderAliasSettings; return module.exports;');
  const state = [];
  let cursor = 0;
  let exported;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(init) { const i = cursor++; if (!(i in state)) state[i] = typeof init === 'function' ? init() : init; return [state[i], (value) => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
    useRef(init) { const i = cursor++; return state[i] ??= { current: init }; },
    useEffect() {}, useCallback: (x) => x, useMemo: (fn) => fn()
  };
  vm.runInNewContext(code, { window: { confirm: () => true, __ModuleLoader__: { load: (entry) => { exported = entry.factory(() => react); } } } });

  const writes = [];
  const provider = { id: 'p', ref: 'P_API_KEY', value: { api: 'openai-completions', baseURL: 'https://example.test/v1', transport: 'sse', models: [{ id: 'gpt-4o', name: 'GPT 4o', contextWindow: 128000 }] } };
  const data = { own: { value: { providerKeys: {} } }, catalog: { groups: [] }, writable: true };
  const m = { busy: false, notify: () => {}, run: async (_t, fn) => fn(), write: async (ns, ops) => writes.push({ ns, ops }) };

  const render = () => { cursor = 0; return exported.TestAlias({ p: provider, m, data }); };
  const nodes = (tree, match) => !tree || typeof tree !== 'object' ? [] : [...(match(tree) ? [tree] : []), ...(tree.children ?? []).flat(Infinity).flatMap((n) => nodes(n, match))];

  // Fill the alias/upstream fields exactly as the user would, then press the button.
  const isInput = (n) => typeof n.props.onChange === 'function' && typeof n.props.value === 'string';
  // Re-render between edits, exactly as React would after each keystroke.
  const type = (i, value) => nodes(render(), isInput)[i].props.onChange(value);
  type(0, 'cheap');
  type(1, 'gpt-4o-0.05');
  type(2, 'gpt-4o');
  const add = nodes(render(), (n) => n.children.includes('添加别名'))[0];
  await add.props.onClick();

  const own = writes.find((w) => w.ns === 'model-manager');
  assert.equal(own.ops[0].value.keys.length, 1);
  assert.deepEqual(Array.from(own.ops[0].value.keys[0].models), ['gpt-4o-0.05=gpt-4o']);
  const llm = writes.find((w) => w.ns === 'llm-pi-ai');
  assert.deepEqual(Array.from(llm.ops[0].value, (x) => x.id), ['gpt-4o', 'gpt-4o-0.05']);
  assert.equal(JSON.stringify(own.ops).includes('API_KEY'), false);
});
