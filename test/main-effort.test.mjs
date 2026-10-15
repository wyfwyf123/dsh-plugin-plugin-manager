import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

async function loadEffortHelpers() {
  const source = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8');
  const start = source.indexOf('export function clampLevel');
  const end = source.indexOf('export function explainEffort');
  const body = source.slice(start, end).replaceAll('export ', '');
  const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  const str = (v) => typeof v === 'string' && v.length > 0 ? v : undefined;
  const run = new Function('LEVELS', 'str', `${body}\nreturn resolveMainEffort;`);
  return { resolveMainEffort: run(LEVELS, str) };
}

test('main agent defaults to high and respects explicit or model-supported levels', async () => {
  const { resolveMainEffort } = await loadEffortHelpers();
  assert.equal(resolveMainEffort({}, { provider: 'p', model: 'm' }, undefined), 'high');
  assert.equal(resolveMainEffort({}, { provider: 'p', model: 'm', reasoningEffort: 'low' }, ['low', 'high']), 'low');
  assert.equal(resolveMainEffort({}, { provider: 'p', model: 'm' }, ['off', 'medium']), 'medium');
  assert.equal(resolveMainEffort({}, { provider: 'p', model: 'm' }, []), undefined);
  assert.equal(resolveMainEffort({ reasoningEffort: 'medium' }, { provider: 'p', model: 'm' }, ['low', 'medium', 'high']), 'medium');
});
