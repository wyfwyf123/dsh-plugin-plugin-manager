import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

async function loadRowEditor() {
  let code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  code = code.replace('return module.exports;', 'exports.TestRow = ModelRowEditor; return module.exports;');
  const state = [];
  let cursor = 0;
  let exported;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(init) { const i = cursor++; if (!(i in state)) state[i] = typeof init === 'function' ? init() : init; return [state[i], (value) => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
    useEffect() {}, useCallback: (x) => x, useMemo: (fn) => fn(), useRef(init) { const i = cursor++; return state[i] ??= { current: init }; }
  };
  vm.runInNewContext(code, { window: { __ModuleLoader__: { load: (entry) => { exported = entry.factory(() => react); } } } });
  return { render: (props) => { cursor = 0; return exported.TestRow(props); } };
}

const nodes = (tree, match) => (!tree || typeof tree !== 'object' ? [] : [...(match(tree) ? [tree] : []), ...(tree.children ?? []).flat(Infinity).flatMap((n) => nodes(n, match))]);

test('a price can be added right beside the reasoning levels', async () => {
  const { render } = await loadRowEditor();
  const saved = [];
  const props = () => ({ row: { id: 'gpt-4o' }, mode: 'models', price: undefined, priceKey: 'openai/gpt-4o', onSavePrice: (v) => saved.push(v), onError: (m) => { throw new Error(m); }, disabled: false, onChange: () => {} });
  const field = (label) => nodes(render(props()), (n) => n.props.ariaLabel === `gpt-4o ${label}单价`)[0];
  field('输入').props.onChange('0.1');
  nodes(render(props()), (n) => n.props.ariaLabel === 'gpt-4o 输出单价')[0].props.onChange('0.5');
  nodes(render(props()), (n) => n.children.includes('添加价格'))[0].props.onClick();
  assert.equal(saved.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(saved[0])), { mode: 'token', currency: 'CNY', input: 0.1, output: 0.5 });
});

test('an existing price is prefilled and can be deleted from the same place', async () => {
  const { render } = await loadRowEditor();
  const saved = [];
  const props = () => ({ row: { id: 'gpt-4o' }, mode: 'models', price: { mode: 'token', currency: 'USD', input: 2, output: 10 }, priceKey: 'openai/gpt-4o', onSavePrice: (v) => saved.push(v), onError: (m) => { throw new Error(m); }, disabled: false, onChange: () => {} });
  const tree = render(props());
  assert.equal(nodes(tree, (n) => n.props.ariaLabel === 'gpt-4o 输入单价')[0].props.value, '2');
  const del = nodes(tree, (n) => n.children.includes('删除价格'))[0];
  assert.ok(del, 'an existing price shows a delete button');
  del.props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), [null]);
});

test('invalid price input is reported instead of silently saved', async () => {
  const { render } = await loadRowEditor();
  const saved = [];
  const errors = [];
  const props = () => ({ row: { id: 'gpt-4o' }, mode: 'models', price: undefined, priceKey: 'openai/gpt-4o', onSavePrice: (v) => saved.push(v), onError: (m) => errors.push(m), disabled: false, onChange: () => {} });
  nodes(render(props()), (n) => n.props.ariaLabel === 'gpt-4o 输入单价')[0].props.onChange('-1');
  nodes(render(props()), (n) => n.children.includes('添加价格'))[0].props.onClick();
  assert.deepEqual(saved, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /有效的非负数/);
});
