import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

async function managerFixture() {
  let code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  code = code.replace('return module.exports;', 'exports.TestPanel = ProviderKeysSettings; return module.exports;');
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
  const calls = [];
  const requests = [];
  const saved = [
    { id: 'default', label: 'Default', credentialRef: 'P_API_KEY', models: [], enabled: true },
    { id: 'cheap', label: '0.05', models: ['gpt-4o-0.05=gpt-4o'], availableModels: ['old-cheap'], enabled: true },
    { id: 'fast', label: '0.5', models: ['gpt-4o-0.5=gpt-4o'], availableModels: ['old-fast'], enabled: true }
  ];
  const data = { own: { value: { providerKeys: { p: { keys: saved } } } }, writable: true, configurable: [] };
  const p = { id: 'p', ref: 'P_API_KEY', value: { api: 'openai-completions', baseURL: 'https://example.test/v1', models: [{ id: 'gpt-4o', contextWindow: 128000, maxTokens: 16000 }] } };
  const m = { busy: false, run: async (_message, fn) => fn(), write: async (ns, ops) => calls.push({ ns, ops }) };
  const api = { discoverProvider: async (body) => { requests.push(body); return { keyId: body.keyId, models: [{ id: body.keyId + '-model' }] }; } };
  const render = () => { cursor = 0; return exported.TestPanel({ p, m, api, data }); };
  return { render, calls, requests };
}

function nodes(tree, matches) {
  if (!tree || typeof tree !== 'object') return [];
  return [...(matches(tree) ? [tree] : []), ...(tree.children ?? []).flat(Infinity).flatMap((node) => nodes(node, matches))];
}

test('one Key can pause immediately without a bulk save or affecting the others', async () => {
  const f = await managerFixture();
  const toggles = nodes(f.render(), (node) => node.props.label === '启用' && typeof node.props.onChange === 'function');
  assert.equal(toggles.length, 3);
  await toggles[1].props.onChange(false);
  const keys = f.calls.at(-1).ops[0].value.keys;
  assert.equal(keys.find((x) => x.id === 'cheap').enabled, false);
  assert.equal(keys.find((x) => x.id === 'fast').enabled, true);
  assert.equal(keys.find((x) => x.id === 'default').enabled, true);
  const togglesAfter = nodes(f.render(), (node) => node.props.label === '启用' && typeof node.props.onChange === 'function');
  await togglesAfter[1].props.onChange(true);
  assert.equal(f.calls.at(-1).ops[0].value.keys.find((x) => x.id === 'cheap').enabled, true);
});

test('fetching one Key stores its own available models and leaves other Key models untouched', async () => {
  const f = await managerFixture();
  const buttons = nodes(f.render(), (node) => node.children.includes('获取模型'));
  await buttons[1].props.onClick();
  assert.equal(f.requests[0].keyId, 'cheap');
  const keys = f.calls.at(-1).ops[0].value.keys;
  assert.deepEqual(Array.from(keys.find((x) => x.id === 'cheap').availableModels), ['cheap-model']);
  assert.deepEqual(Array.from(keys.find((x) => x.id === 'fast').availableModels), ['old-fast']);
  assert.deepEqual(Array.from(keys.find((x) => x.id === 'cheap').models), ['gpt-4o-0.05=gpt-4o']);
});
