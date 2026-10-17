import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

async function loadSessionMeta() {
  const source = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8');
  const start = source.indexOf('export function sessionMetaFrom');
  const end = source.indexOf('/** Levels a provider/model accepts');
  if (start < 0 || end < 0 || end <= start) throw new Error('sessionMetaFrom anchors not found');
  const body = source.slice(start, end).replaceAll('export ', '');
  return new Function(`${body}\nreturn sessionMetaFrom;`)();
}

test('DSH 0.2 agents expose only an id; the header comes from the session store', async () => {
  const sessionMetaFrom = await loadSessionMeta();
  // DSH 0.2 shape: Agent = { id }, header read through the lookup.
  const lookup = (id) => (id === 's-child' ? { id: 's-child', parentSession: 's-root', origin: 'subagent', delegationDepth: 2 } : { id });
  assert.deepEqual(sessionMetaFrom({ id: 's-child' }, lookup), { sessionId: 's-child', parentSessionId: 's-root', depth: 2, subagent: true });
  assert.deepEqual(sessionMetaFrom({ id: 's-main' }, lookup), { sessionId: 's-main', parentSessionId: null, depth: null, subagent: false });
  // A missing store entry still yields the id, just with no lineage.
  assert.deepEqual(sessionMetaFrom({ id: 's-unknown' }, () => undefined), { sessionId: 's-unknown', parentSessionId: null, depth: null, subagent: false });
  // A throwing lookup must not break model calls.
  assert.deepEqual(sessionMetaFrom({ id: 's-x' }, () => { throw new Error('boom'); }), { sessionId: 's-x', parentSessionId: null, depth: null, subagent: false });
});

test('legacy agent.session.header still wins when a build provides it', async () => {
  const sessionMetaFrom = await loadSessionMeta();
  const legacy = { id: 's-legacy', session: { id: 's-legacy', header: { id: 's-legacy', parentSession: 's-p', origin: 'subagent', delegationDepth: 1 } } };
  let asked = false;
  assert.deepEqual(sessionMetaFrom(legacy, () => { asked = true; return undefined; }), { sessionId: 's-legacy', parentSessionId: 's-p', depth: 1, subagent: true });
  assert.equal(asked, false, 'the legacy header must not be overridden by the store');
  // No agent at all is tolerated.
  assert.deepEqual(sessionMetaFrom(undefined, () => undefined), { sessionId: null, parentSessionId: null, depth: null, subagent: false });
});
