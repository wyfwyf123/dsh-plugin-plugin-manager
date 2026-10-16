import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

async function loadVisionHelpers() {
  let code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  code = code.replace('return module.exports;', 'exports.Test = { inferredImage, defaultInputModalities }; return module.exports;');
  let exported;
  const react = { createElement() {}, useState() {}, useEffect() {}, useCallback: (x) => x, useMemo: (fn) => fn(), useRef() {} };
  vm.runInNewContext(code, { window: { __ModuleLoader__: { load: (entry) => { exported = entry.factory(() => react); } } } });
  return exported.Test;
}

test('known vision model families are detected', async () => {
  const { inferredImage } = await loadVisionHelpers();
  const vision = [
    'claude-opus-5-5', 'claude-sonnet-4-5', 'claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-4-1-sonnet',
    'gpt-4o', 'gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4-turbo', 'gpt-5', 'chatgpt-4o-latest',
    'o1', 'o1-preview', 'o3', 'o4-mini',
    'deepseek-vl2', 'deepseek-vision',
    'glm-4v', 'glm-4v-plus', 'glm-4.5v',
    'grok-4', 'grok-4-fast', 'grok-2-vision-1212',
    'gemini-2.5-pro', 'qwen-vl-max', 'qwen2.5-vl-72b-instruct', 'llava-1.6', 'pixtral-12b'
  ];
  for (const id of vision) assert.equal(inferredImage(id), true, `${id} should be vision`);
  const text = [
    'gpt-4', 'gpt-4-0613', 'gpt-3.5-turbo', 'o1-mini', 'o3-mini',
    'deepseek-chat', 'deepseek-reasoner',
    'glm-4.5', 'glm-4.6', 'glm-4-plus',
    'grok-3', 'grok-2-1212',
    'qwen-max', 'qwen3-235b', 'text-embedding-3-large'
  ];
  for (const id of text) assert.equal(inferredImage(id), false, `${id} should be text-only`);
});

test('reported modalities win over the family table', async () => {
  const { defaultInputModalities } = await loadVisionHelpers();
  // A provider that explicitly reports text-only is respected, even for a known family.
  assert.deepEqual(Array.from(defaultInputModalities('gpt-4o', ['text'])), ['text']);
  // Reported image support is preserved as-is.
  assert.deepEqual(Array.from(defaultInputModalities('my-custom-model', ['text', 'image'])), ['text', 'image']);
  // Nothing reported: the family table fills the gap.
  assert.deepEqual(Array.from(defaultInputModalities('claude-opus-5-5', undefined)), ['text', 'image']);
  assert.deepEqual(Array.from(defaultInputModalities('claude-3-5-sonnet-20241022', [])), ['text', 'image']);
  // Nothing reported and no match: stay text-only.
  assert.equal(defaultInputModalities('internal-llm-v2', undefined), undefined);
});
