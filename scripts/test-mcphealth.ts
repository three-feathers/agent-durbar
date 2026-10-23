/** Spec 058 FR-092 (issue #603, T141): when an MCP server's state started, and whether it failed after Running. `npm run test:mcphealth`. No credits spent. */
import * as assert from 'assert';
import { MCP_HEALTH_MAX, mcpHealthUpdate } from '../src/shared/mcphealth';
import type { McpHealthMark } from '../src/shared/mcphealth';

const step = (prev: Map<string, McpHealthMark> | undefined, list: { name: string; status?: string }[], now: number) => mcpHealthUpdate(prev, list, now);

// a server that starts, runs, then fails: the failure is after running, and its time is the failure's
{
  let h = step(undefined, [{ name: 'a', status: 'pending' }], 1000);
  assert.deepStrictEqual(h.get('a'), { status: 'pending', since: 1000, ran: false, afterRunning: false });
  h = step(h, [{ name: 'a', status: 'connected' }], 2000);
  assert.deepStrictEqual(h.get('a'), { status: 'connected', since: 2000, ran: true, afterRunning: false });
  h = step(h, [{ name: 'a', status: 'failed' }], 3000);
  assert.deepStrictEqual(h.get('a'), { status: 'failed', since: 3000, ran: true, afterRunning: true }, 'failed after Running');
  h = step(h, [{ name: 'a', status: 'failed' }], 4000);
  assert.strictEqual(h.get('a')?.since, 3000, 'an unchanged state keeps the time it was first seen');
  assert.strictEqual(h.get('a')?.afterRunning, true);
  // a restart (pending) starts over: a failure now is on start
  h = step(h, [{ name: 'a', status: 'pending' }], 5000);
  assert.deepStrictEqual(h.get('a'), { status: 'pending', since: 5000, ran: false, afterRunning: false });
  h = step(h, [{ name: 'a', status: 'failed' }], 6000);
  assert.deepStrictEqual(h.get('a'), { status: 'failed', since: 6000, ran: false, afterRunning: false }, 'failed on start after a restart');
}
// first seen failed: not after running (never guessed)
{
  const h = step(undefined, [{ name: 'b', status: 'failed' }, { name: 'c', status: 'needs-auth' }, { name: 'd' }], 10);
  assert.deepStrictEqual(h.get('b'), { status: 'failed', since: 10, ran: false, afterRunning: false });
  assert.strictEqual(h.get('c')?.afterRunning, false);
  assert.deepStrictEqual(h.get('d'), { status: '', since: 10, ran: false, afterRunning: false }, 'no state yet');
}
// needs-auth after Running is after running; a later connected and a second failure too
{
  let h = step(undefined, [{ name: 'e', status: 'connected' }], 1);
  h = step(h, [{ name: 'e', status: 'needs-auth' }], 2);
  assert.strictEqual(h.get('e')?.afterRunning, true);
  h = step(h, [{ name: 'e', status: 'connected' }], 3);
  assert.strictEqual(h.get('e')?.afterRunning, false, 'only failure states carry it');
  h = step(h, [{ name: 'e', status: 'failed' }], 4);
  assert.deepStrictEqual(h.get('e'), { status: 'failed', since: 4, ran: true, afterRunning: true });
  // failed -> needs-auth (a state change between failures) keeps "ran"
  h = step(h, [{ name: 'e', status: 'needs-auth' }], 5);
  assert.deepStrictEqual(h.get('e'), { status: 'needs-auth', since: 5, ran: true, afterRunning: true });
  // disabled then failed (no new start seen): still ran before
  h = step(h, [{ name: 'e', status: 'disabled' }], 6);
  assert.strictEqual(h.get('e')?.afterRunning, false);
}
// the full list replaces: a missing server is dropped; bad names, duplicates and the cap
{
  let h = step(undefined, [{ name: 'x', status: 'connected' }, { name: 'y', status: 'connected' }], 1);
  h = step(h, [{ name: 'y', status: 'failed' }], 2);
  assert.deepStrictEqual([...h.keys()], ['y']);
  const odd = mcpHealthUpdate(undefined, [{ name: '' }, { name: 5 }, null as unknown as { name: string }, { name: 'z'.repeat(201) }, { name: 'ok', status: 7 }, { name: 'ok', status: 'failed' }], 1);
  assert.deepStrictEqual([...odd.keys()], ['ok']);
  assert.strictEqual(odd.get('ok')?.status, '', 'a status that is not a string is no state; the first entry of a name wins');
  assert.strictEqual(mcpHealthUpdate(undefined, undefined, 1).size, 0);
  const many = Array.from({ length: MCP_HEALTH_MAX + 50 }, (_, i) => ({ name: 's' + i, status: 'connected' }));
  assert.strictEqual(mcpHealthUpdate(undefined, many, 1).size, MCP_HEALTH_MAX);
}
// the previous map is never changed (main keeps it until the next event)
{
  const h1 = step(undefined, [{ name: 'a', status: 'connected' }], 1);
  const snap = JSON.stringify([...h1]);
  step(h1, [{ name: 'a', status: 'failed' }], 2);
  assert.strictEqual(JSON.stringify([...h1]), snap);
}
console.log('test-mcphealth: OK');
