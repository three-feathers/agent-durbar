/** Unit tests for the rename operation of main (spec 059 FR-013, FR-007, FR-010, FR-011): `npm run test:sessionnames`. Fakes only. */
import * as assert from 'assert';
import { FakeAdapter } from '../src/adapters/fake';
import { renameOp, titleSyncOf } from '../src/main/sessionnames';
import type { RenameAgent, RenameDeps } from '../src/main/sessionnames';

interface Saved { agentId: string; src: string; id: string; name: string | undefined; inApp: boolean; pending: boolean }

function setup(cap: 'any' | 'next-turn' | undefined, o: { agents?: RenameAgent[]; previous?: string[]; saveFails?: boolean; omitMember?: boolean } = {}) {
  const ad = new FakeAdapter({ id: 'copilot', displayName: 'GitHub Copilot', capabilities: { renameSession: cap }, omit: o.omitMember ? ['renameSession'] : [] });
  const agents = o.agents ?? [{ id: 'a1', adapterId: 'copilot' }, { id: 'a2', adapterId: 'copilot' }];
  const saved: Saved[] = [];
  const aliases: Array<{ id: string; alias: string | undefined }> = [];
  const deps: RenameDeps = {
    agent: (id) => agents.find((x) => x.id === id),
    adapter: () => ad,
    resumeIdFor: (id) => `r-${id}`,
    otherOpenIds: (id) => agents.filter((x) => x.id !== id).map((x) => `r-${x.id}`),
    previousIds: async () => o.previous ?? ['old-1'],
    save: (agentId, src, id, name, f) => (o.saveFails ? false : (saved.push({ agentId, src, id, name, inApp: f.inApp, pending: f.pending }), true)),
    applyAlias: (_a, id, alias) => void aliases.push({ id, alias }),
  };
  return { ad, run: renameOp(deps), saved, aliases };
}

async function main(): Promise<void> {
  // own session, app renames now
  {
    const t = setup('any');
    const r = await t.run('a1', null, '  Billing   refactor ');
    assert.deepStrictEqual(r, { ok: true, name: 'Billing refactor', inApp: true });
    assert.deepStrictEqual(t.ad.renameCalls, [{ sessionId: 'r-a1', name: 'Billing refactor' }]);
    assert.deepStrictEqual(t.saved, [{ agentId: 'a1', src: 'copilot', id: 'r-a1', name: 'Billing refactor', inApp: true, pending: false }]);
    assert.deepStrictEqual(t.aliases, [{ id: 'r-a1', alias: 'Billing refactor' }]);
  }
  // next-turn: pending
  {
    const t = setup('next-turn');
    const r = await t.run('a1', null, 'Name');
    assert.deepStrictEqual(r, { ok: true, name: 'Name', inApp: false, pending: true });
    assert.strictEqual(t.saved[0].pending, true);
    assert.strictEqual(t.saved[0].inApp, false);
  }
  // no capability: Durbar only, the adapter is never called
  for (const t of [setup(undefined), setup('any', { omitMember: true })]) {
    const r = await t.run('a1', null, 'Name');
    assert.deepStrictEqual(r, { ok: true, name: 'Name', inApp: false });
    assert.strictEqual(t.ad.renameCalls.length, 0);
    assert.strictEqual(t.saved[0].inApp, false);
  }
  // the app refuses: Durbar-only plus a note (secrets masked, cut)
  {
    const t = setup('any');
    t.ad.failRename = 'not allowed ghp_abcdefghijklmnopqrstuvwxyz0123456789 ' + 'x'.repeat(300);
    const r = await t.run('a1', null, 'Name');
    assert.ok(r.ok && r.inApp === false && r.name === 'Name');
    assert.ok(r.ok && r.note && r.note.startsWith('Renamed in Agent Durbar only. GitHub Copilot did not accept the name: not allowed'), String(r.ok && r.note));
    assert.ok(r.ok && r.note && !r.note.includes('ghp_abc') && r.note.length < 220);
    assert.deepStrictEqual(t.saved.map((s) => [s.name, s.inApp]), [['Name', false]]);
    t.ad.failRename = undefined;
  }
  // other office session of the folder, and a previous row (re-checked)
  {
    const t = setup('any');
    assert.ok((await t.run('a1', 'r-a2', 'Other')).ok);
    assert.ok((await t.run('a1', 'old-1', 'Old')).ok);
    assert.deepStrictEqual(t.ad.renameCalls.map((c) => c.sessionId), ['r-a2', 'old-1']);
    const bad = await t.run('a1', 'not-in-this-folder', 'X');
    assert.deepStrictEqual(bad, { ok: false, error: 'That session is no longer available for this folder.' });
    assert.strictEqual(t.ad.renameCalls.length, 2);
    for (const evil of [5, '../../etc', 'a b', '', {}, 'x'.repeat(300)]) assert.deepStrictEqual(await t.run('a1', evil, 'X'), { ok: false, error: 'Unknown session.' }, JSON.stringify(evil));
  }
  // bad names and unknown agents: nothing stored, nothing called
  {
    const t = setup('any');
    assert.deepStrictEqual(await t.run('a1', null, 'x'.repeat(61)), { ok: false, error: 'Use 1 to 60 characters.' });
    assert.deepStrictEqual(await t.run('a1', null, 'a\u0000b'), { ok: false, error: 'Remove control or hidden characters.' });
    assert.deepStrictEqual(await t.run('a1', null, 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'), { ok: false, error: 'That looks like a secret. Use another name.' });
    assert.deepStrictEqual(await t.run('a1', null, 5), { ok: false, error: 'Use 1 to 60 characters.' });
    assert.deepStrictEqual(await t.run('nope', null, 'x'), { ok: false, error: 'Unknown session.' });
    assert.deepStrictEqual(await t.run(5, null, 'x'), { ok: false, error: 'Unknown session.' });
    assert.strictEqual(t.saved.length + t.ad.renameCalls.length + t.aliases.length, 0);
  }
  // reset: only Durbar's copy; the adapter is not called
  {
    const t = setup('any');
    assert.deepStrictEqual(await t.run('a1', null, '   '), { ok: true, inApp: false });
    assert.strictEqual(t.ad.renameCalls.length, 0);
    assert.deepStrictEqual(t.saved, [{ agentId: 'a1', src: 'copilot', id: 'r-a1', name: undefined, inApp: false, pending: false }]);
    assert.deepStrictEqual(t.aliases, [{ id: 'r-a1', alias: undefined }]);
  }
  // a store failure: nothing changes on screen
  {
    const t = setup('any', { saveFails: true });
    assert.deepStrictEqual(await t.run('a1', null, 'Name'), { ok: false, error: 'Could not rename the session.' });
    assert.strictEqual(t.aliases.length, 0);
    assert.deepStrictEqual(await t.run('a1', null, ''), { ok: false, error: 'Could not rename the session.' });
  }
  // a card that never started has no session in the app yet: Durbar-only, the adapter is not called
  {
    const t = setup('any', { agents: [{ id: 'a1', adapterId: 'copilot', lazy: true }] });
    assert.deepStrictEqual(await t.run('a1', null, 'Name'), { ok: true, name: 'Name', inApp: false });
    assert.strictEqual(t.ad.renameCalls.length, 0);
    const t2 = setup('any', { agents: [{ id: 'a1', adapterId: 'copilot', lazy: true, resumeLast: true }] });
    assert.strictEqual((await t2.run('a1', null, 'Name')).ok && t2.ad.renameCalls.length, 1, 'a restored earlier session is renamed in the app');
  }
  // a second rename while one is in flight is refused
  {
    const t = setup('any');
    let release: () => void = () => undefined;
    t.ad.renameSession = (sid, name) => (t.ad.renameCalls.push({ sessionId: sid, name }), new Promise<void>((res) => (release = res)));
    const first = t.run('a1', null, 'One');
    await new Promise((r) => setTimeout(r, 5));
    assert.deepStrictEqual(await t.run('a1', null, 'Two'), { ok: false, error: 'Already renaming this session.' });
    release();
    assert.ok((await first).ok);
    assert.ok((await t.run('a1', null, 'Three')).ok, 'free again');
  }
  // titleSyncOf (FR-011)
  {
    const e = { src: 'copilot', id: 'x', name: 'Mine' };
    assert.deepStrictEqual(titleSyncOf(undefined, 'T'), { action: 'none' });
    assert.deepStrictEqual(titleSyncOf(e, 'Other'), { action: 'none' }, 'a Durbar-only name wins');
    assert.deepStrictEqual(titleSyncOf({ ...e, inApp: true }, 'Mine'), { action: 'none' });
    assert.deepStrictEqual(titleSyncOf({ ...e, inApp: true }, 'Renamed in the CLI'), { action: 'drop' });
    assert.deepStrictEqual(titleSyncOf({ ...e, pending: true }, 'Mine'), { action: 'update', entry: { ...e, inApp: true } });
    assert.deepStrictEqual(titleSyncOf({ ...e, pending: true }, 'Older'), { action: 'none' });
  }
  console.log('sessionnames: ok');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
