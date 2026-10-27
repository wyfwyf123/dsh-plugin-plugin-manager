import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

async function loadPriceHelpers() {
  let code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  code = code.replace('return module.exports;', 'exports.Test = { priceRowKeys }; return module.exports;');
  let exported;
  const react = { createElement() {}, useState() {}, useEffect() {}, useCallback: (x) => x, useMemo: (fn) => fn(), useRef() {} };
  vm.runInNewContext(code, { window: { __ModuleLoader__: { load: (entry) => { exported = entry.factory(() => react); } } } });
  return exported.Test;
}

const saved = { 'p/gpt-4o': { mode: 'token' } };
const draft = { 'p/gpt-4o': {}, 'p/claude-opus-5-5': {} };

test('price rows are exactly what the user added', async () => {
  const { priceRowKeys } = await loadPriceHelpers();
  assert.deepEqual(Array.from(priceRowKeys({ saved, draft, needle: '' })), ['p/claude-opus-5-5', 'p/gpt-4o']);
  // Only saved prices, nothing typed yet.
  assert.deepEqual(Array.from(priceRowKeys({ saved, draft: {}, needle: '' })), ['p/gpt-4o']);
  // Nothing at all: the card stays empty.
  assert.deepEqual(Array.from(priceRowKeys({ saved: {}, draft: {}, needle: '' })), []);
  // A search filters the already-added rows (the caller lowercases the query).
  assert.deepEqual(Array.from(priceRowKeys({ saved, draft, needle: 'claude' })), ['p/claude-opus-5-5']);
  assert.deepEqual(Array.from(priceRowKeys({ saved, draft, needle: 'nomatch' })), []);
});

test('provider filter and sorting work on the added rows', async () => {
  const { priceRowKeys } = await loadPriceHelpers();
  const priced = {
    'a6api/deepseek-v4.1-flash': { mode: 'token', input: 0.2, output: 1 },
    'areas/gpt-6.1-sol': { mode: 'token', input: 0.1, output: 0.5 },
    'aihub/claude-opus-5-5': { mode: 'token', input: 0.64, output: 3.2 }
  };
  // Provider filter keeps only that provider's rows.
  assert.deepEqual(Array.from(priceRowKeys({ saved: priced, draft: {}, provider: 'areas' })), ['areas/gpt-6.1-sol']);
  assert.deepEqual(Array.from(priceRowKeys({ saved: priced, draft: {}, provider: 'nope' })), []);
  // Sorting by input/output price, highest first.
  assert.deepEqual(Array.from(priceRowKeys({ saved: priced, draft: {}, sort: 'input' })), ['aihub/claude-opus-5-5', 'a6api/deepseek-v4.1-flash', 'areas/gpt-6.1-sol']);
  assert.deepEqual(Array.from(priceRowKeys({ saved: priced, draft: {}, sort: 'output' })), ['aihub/claude-opus-5-5', 'a6api/deepseek-v4.1-flash', 'areas/gpt-6.1-sol']);
  // Provider grouping, and "recent" reverses insertion order.
  assert.deepEqual(Array.from(priceRowKeys({ saved: priced, draft: {}, sort: 'provider' })), ['a6api/deepseek-v4.1-flash', 'aihub/claude-opus-5-5', 'areas/gpt-6.1-sol']);
  assert.deepEqual(Array.from(priceRowKeys({ saved: priced, draft: {}, sort: 'recent' })), ['aihub/claude-opus-5-5', 'areas/gpt-6.1-sol', 'a6api/deepseek-v4.1-flash']);
  // Filter and sort combine.
  assert.deepEqual(Array.from(priceRowKeys({ saved: priced, draft: { 'a6api/gpt-5.5': {} }, provider: 'a6api', sort: 'name' })), ['a6api/deepseek-v4.1-flash', 'a6api/gpt-5.5']);
});

test('usage rows and the catalog never add a price row on their own', async () => {
  const { priceRowKeys } = await loadPriceHelpers();
  // Extra inputs are ignored: usage and catalog data cannot inject rows.
  const withAutomaticInputs = {
    saved: {},
    draft: {},
    used: ['p/some-model-i-used', 'p/another'],
    catalogKeys: ['p/catalog-model'],
    unpriced: ['p/unpriced'],
    hidden: new Set(),
    showAll: true,
    showUnpriced: true,
    showHidden: true,
    needle: ''
  };
  assert.deepEqual(Array.from(priceRowKeys(withAutomaticInputs)), []);
});
