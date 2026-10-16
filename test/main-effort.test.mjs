import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

async function loadEffortHelpers() {
  const source = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8');
  const start = source.indexOf('export function clampLevel');
  const end = source.indexOf('export function explainEffort');
  if (start < 0 || end < 0 || end <= start) throw new Error('helper anchors not found');
  const body = source.slice(start, end).replaceAll('export ', '');
  const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
  const str = (v) => (typeof v === 'string' && v.length > 0 ? v : undefined);
  const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  return new Function('LEVELS', 'str', 'isRecord', `${body}\nreturn { resolveMainEffort, clampLevel };`)(LEVELS, str, isRecord);
}

test('main agent defaults to high and respects explicit or model-supported levels', async () => {
  const { resolveMainEffort } = await loadEffortHelpers();
  assert.equal(resolveMainEffort({}, { provider: 'p', model: 'm' }, undefined), 'high');
  assert.equal(resolveMainEffort({}, { provider: 'p', model: 'm', reasoningEffort: 'low' }, ['low', 'high']), 'low');
  assert.equal(resolveMainEffort({}, { provider: 'p', model: 'm' }, ['off', 'medium']), 'medium');
  assert.equal(resolveMainEffort({}, { provider: 'p', model: 'm' }, []), undefined);
  assert.equal(resolveMainEffort({ reasoningEffort: 'medium' }, { provider: 'p', model: 'm' }, ['low', 'medium', 'high']), 'medium');
  // A model that only supports "off" resolves to "off"; the caller then drops the
  // field entirely instead of sending a thinking payload the provider may reject.
  assert.equal(resolveMainEffort({}, { provider: 'p', model: 'm' }, ['off']), 'off');
  // An explicit level that the model cannot take is clamped too, so a session-level
  // "high" cannot bypass an adaptive-only model's restriction.
  assert.equal(resolveMainEffort({}, { provider: 'p', model: 'm', reasoningEffort: 'high' }, ['off']), 'off');
  assert.equal(resolveMainEffort({}, { provider: 'p', model: 'm', reasoningEffort: 'max' }, ['low', 'medium']), 'medium');
});
