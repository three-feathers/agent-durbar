/**
 * Spec 118 T011 (FR-002, FR-003, FR-024): the source override. `setSource(text)` is the one free-text channel: capped, parsed by
 * `parseRepoSlug`, never echoed; the new source is read first, then a native confirmation, and only a yes saves. `useBuiltInSource()`
 * goes back without a read. `npm run test:selfupdate-source`. No Electron, no network (`selfupdate-rig.ts`).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import { selfUpdateHandlers, SELFUPDATE_REFUSED, SOURCE_TEXT_MAX } from '../src/main/selfupdate';
import type { SelfUpdateStore, SelfUpdateView } from '../src/main/selfupdate';
import type { FeedAnswer } from '../src/main/netget';
import { feedBytes, guardExit, ok, rig, standard, LIST, NO, SLUG } from './selfupdate-rig';

const exit = guardExit('selfupdate-source');
const RAVI = 'ravi/durbar';
const RAVI_LIST = `https://api.github.com/repos/${RAVI}/releases?per_page=30`;
type Answer = { ok: boolean; reason?: string; update: SelfUpdateView };

/** A rig whose feed answers for both sources, a recorded confirmation and a recorded store. */
function source(o: { yes?: boolean; ravi?: FeedAnswer | null; settings?: unknown; packaged?: boolean; confirm?: (q: { message: string; detail: string; ok: string }) => Promise<boolean>; failSave?: boolean } = {}) {
  const asked: { message: string; detail: string; ok: string }[] = [];
  const r = rig({
    settings: o.settings,
    packaged: o.packaged,
    script: (u) => (u === RAVI_LIST ? (o.ravi === null ? undefined : (o.ravi ?? ok(feedBytes(RAVI, ['0.1.31'])))) : u.includes(`/${RAVI}/`) ? NO : standard(u) ?? NO),
    confirm: async (q) => { asked.push(q); return o.confirm ? o.confirm(q) : (o.yes ?? true); },
  });
  const patches: unknown[] = [];
  const real = r.store;
  if (o.failSave) (real as unknown as { save(): boolean }).save = () => false; // an injected failing write: part 1's rollback runs
  const rec: SelfUpdateStore = { get updates() { return real.updates; }, setUpdates: (p) => { patches.push(p); return real.setUpdates(p); } };
  (r.u as unknown as { d: { store(): SelfUpdateStore } }).d.store = () => rec;
  const h = selfUpdateHandlers(() => r.u);
  const set = (...a: unknown[]): Promise<Answer> => Promise.resolve(h.setSource(...a) as Promise<Answer>);
  return { ...r, asked, patches, h, set };
}

async function main(): Promise<void> {
  // ---- the free-text rule: capped, parsed, never echoed ------------------------------------------------------------
  {
    const s = source();
    const bytes = fs.existsSync(s.file) ? fs.readFileSync(s.file, 'utf8') : '';
    const forged: [unknown, string][] = [
      ['https://evil.example/ravi/durbar', 'another host'], ['ravi/durbar/extra', 'a path'], ['../../etc/passwd', 'a parent path'], ['git@github.com:ravi/durbar', 'an ssh address'],
      ['https://u:p@github.com/ravi/durbar', 'credentials'], ['ravi/durbar?x=1', 'a query'], [' ravi/durbar', 'a leading space'], ['<img src=x onerror=alert(1)>/x', 'markup'],
      ['r'.repeat(SOURCE_TEXT_MAX - 7) + '/durbar' + 'x', 'over the cap'], ['a'.repeat(1_000_000), 'a huge string'], [{ toString: () => RAVI }, 'an object'], [[RAVI], 'an array'], [null, 'null'], [42, 'a number'],
    ];
    for (const [arg, what] of forged) {
      await assert.rejects(async () => s.set(arg), (e: Error) => typeof arg !== 'string' || !e.message.includes(arg.slice(0, 40)), `FR-003: refused text is never echoed (${what})`);
      await assert.rejects(async () => s.set(arg), (e: Error) => e.message === SELFUPDATE_REFUSED, `FR-003: ${what} is refused with the fixed text`);
    }
    await assert.rejects(async () => s.set(), (e: Error) => e.message === SELFUPDATE_REFUSED, 'FR-003: no argument is refused');
    await assert.rejects(async () => s.set(RAVI, 'x'), (e: Error) => e.message === SELFUPDATE_REFUSED, 'FR-003: an extra argument is refused');
    assert.deepStrictEqual([s.calls.length, s.asked.length, s.patches.length], [0, 0, 0], 'FR-003: a refused text makes no request, asks nothing, writes nothing');
    assert.strictEqual(fs.existsSync(s.file) ? fs.readFileSync(s.file, 'utf8') : '', bytes, 'FR-003: a refused text leaves the settings file unchanged');

    // a spelling the parser takes is shown only as the parsed pair
    const r = await s.set('https://github.com/ravi/durbar.git/');
    assert.ok(r.ok, 'FR-003: a GitHub address is accepted');
    const q = s.asked[0];
    assert.ok(q.message.includes(RAVI) && q.detail.includes(RAVI) && q.detail.includes(SLUG), 'FR-003: the confirmation names the parsed pair and the built-in source');
    assert.ok(!/https:|\.git|github\.com/.test(q.message + q.detail), 'FR-003: the confirmation shows the parsed pair only, never the text as typed');
    assert.ok(/a repository you chose/.test(q.detail) && /Only switch to a repository you trust/.test(q.detail), 'FR-003: the confirmation says the person chose the place, with the trust warning');
  }

  // ---- read first, then the confirmation, and only a yes saves ------------------------------------------------------
  {
    const fail = source({ ravi: { ok: false, reason: 'redirect' } });
    const a = await fail.set(RAVI);
    assert.deepStrictEqual([a.ok, a.reason, fail.asked.length, fail.patches.length, fail.store.updates.source], [false, 'redirect', 0, 0, undefined], 'FR-003: a failed read changes nothing and asks nothing');
    assert.deepStrictEqual(fail.calls.map((c) => c.url), [RAVI_LIST], 'FR-003: the new source is read first');
    const bad = source({ ravi: ok(feedBytes('evil/repo')) });
    assert.deepStrictEqual([(await bad.set(RAVI)).reason, bad.patches.length], ['feed-invalid', 0], 'FR-003: an unreadable list of the new source changes nothing');

    const no = source({ yes: false });
    const n = await no.set(RAVI);
    assert.deepStrictEqual([n.ok, n.reason, no.asked.length, no.patches.length, no.store.updates.source], [false, 'declined', 1, 0, undefined], 'FR-003: a declined confirmation saves nothing');

    const yes = source({ settings: { updates: { lastCheck: { at: 5, latest: '0.1.29' } } } });
    const before = await yes.h.check();
    assert.strictEqual((before as SelfUpdateView).target, '0.1.29', 'source: the built-in source has an update kept');
    yes.patches.length = 0;
    const y = await yes.set(RAVI);
    assert.deepStrictEqual(yes.patches, [{ source: RAVI, lastCheck: undefined }], 'FR-003: a yes saves exactly the source and drops the last check');
    assert.deepStrictEqual([y.ok, y.update.source, y.update.sourceBy], [true, RAVI, 'you'], 'FR-002: the view says the source was changed by you');
    assert.deepStrictEqual([y.update.state, y.update.target], ['none', undefined], 'source: the kept result of the old source is dropped');
    await assert.rejects(async () => yes.h.skip('0.1.29'), (e: Error) => e.message === SELFUPDATE_REFUSED, 'source: a version of the old feed is refused after the change');
    const after = (await yes.h.check()) as SelfUpdateView;
    assert.deepStrictEqual([yes.calls[yes.calls.length - 1].slug, after.latest], [RAVI, '0.1.31'], 'source: the next check reads the chosen source');
  }

  // ---- closed answers without a request ---------------------------------------------------------------------------
  {
    const locked = source();
    locked.policy.p = { state: 'ok', feedUrl: 'https://github.com/org/fork' };
    assert.deepStrictEqual([(await locked.set(RAVI)).reason, locked.calls.length, locked.asked.length], ['locked', 0, 0], 'FR-005: an organization source locks the override');
    const dev = source({ packaged: false });
    assert.deepStrictEqual([(await dev.set(RAVI)).reason, dev.calls.length], ['not-allowed', 0], 'FR-004: a dev run never reads a source');
    const same = source();
    assert.deepStrictEqual([(await same.set('Three-Feathers/Agent-Durbar')).ok, same.calls.length, same.asked.length, same.patches.length], [true, 0, 0, 0], 'FR-003: the source in force (any case) changes nothing');
    const busy = source();
    const first = busy.set(RAVI);
    const second = await busy.set('other/repo');
    assert.deepStrictEqual([second.ok, second.reason], [false, 'busy'], 'FR-003: one source change at a time');
    assert.ok((await first).ok, 'FR-003: the first change goes on');
  }

  // ---- back to the built-in source; a hand-edited settings file ----------------------------------------------------
  {
    const s = source({ settings: { updates: { source: RAVI, lastCheck: { at: 5, latest: '0.1.31' } } } });
    assert.deepStrictEqual([s.u.view().source, s.u.view().sourceBy], [RAVI, 'you'], 'FR-002: a saved override is in force and shown as changed by you');
    const b = s.h.useBuiltInSource() as { ok: boolean; update: SelfUpdateView };
    assert.deepStrictEqual([b.ok, b.update.source, b.update.sourceBy, s.calls.length, s.asked.length], [true, SLUG, 'built-in', 0, 0], 'FR-003: Use the built-in source goes back without a read or a question');
    assert.deepStrictEqual(s.patches, [{ source: undefined, lastCheck: undefined }], 'FR-003: it removes exactly the override and the last check');
    const hand = source({ settings: { updates: { source: 'https://evil.example/a/b' } } });
    assert.strictEqual(hand.u.view().source, SLUG, 'FR-021: a hand-edited source that does not parse is ignored');
  }

  // ---- review of PR 2087 ------------------------------------------------------------------------------------------
  {
    // (1) a token-shaped owner or repository name parses as a pair, but the shared mask would change it: refused like unparsable text.
    // The values are generated here (never written out whole) in the shapes of several credential families.
    const gen = (n: number, cs: string): string => Array.from({ length: n }, (_, i) => cs[(i * 7 + 3) % cs.length]).join('');
    const AN = 'aB3dE5fG7hJ9kL2mN4pQ6rS8tU0vW1xY';
    const UP = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const shaped: [string, string][] = [
      ['acme/' + 'gh' + 'p_' + gen(36, AN), 'a classic source-host token as the repository'],
      ['acme/' + 'github' + '_pat_' + gen(22, AN) + '_' + gen(59, AN), 'a fine-grained source-host token as the repository'],
      ['AK' + 'IA' + gen(16, UP) + '/durbar', 'a cloud access-key id as the owner'],
      ['acme/' + 'sk-' + 'ant-' + gen(40, AN), 'an AI-provider key as the repository'],
      ['acme/' + 'xo' + 'xb-' + gen(10, '1234567890') + '-' + gen(24, AN), 'a chat-bot token as the repository'],
      ['acme/' + 'gl' + 'pat-' + gen(20, AN), 'a code-host token as the repository'],
      ['acme/' + 'np' + 'm_' + gen(36, AN), 'a package-registry token as the repository'],
    ];
    const t = source();
    for (const [text, what] of shaped) {
      await assert.rejects(async () => t.set(text), (e: Error) => e.message === SELFUPDATE_REFUSED && !e.message.includes(text.slice(5, 20)), `review 1: ${what} is refused with the fixed text`);
    }
    assert.deepStrictEqual([t.calls.length, t.asked.length, t.patches.length], [0, 0, 0], 'review 1: a token-shaped pair makes no request, shows no dialog, writes nothing');
    const hand = source({ settings: { updates: { source: shaped[0][0] } } });
    assert.deepStrictEqual([hand.u.view().source, hand.u.view().sourceBy], [SLUG, 'built-in'], 'review 1: a token-shaped source in the settings file is ignored like one that does not parse');

    // (2) the lock and the policy are checked again after the read and after the dialog
    for (const [change, want, what] of [[{ state: 'ok', feedUrl: 'https://github.com/org/fork' }, 'locked', 'a lock'], [{ state: 'ok', updatesMode: 'off' }, 'not-allowed', 'the policy off']] as [object, string, string][]) {
      const r = source({ ravi: null });
      const pending = r.set(RAVI);
      await new Promise((x) => setImmediate(x));
      r.policy.p = change as never;
      r.calls[0].answer(ok(feedBytes(RAVI, ['0.1.31'])));
      const a = await pending;
      assert.deepStrictEqual([a.ok, a.reason, r.asked.length, r.patches.length], [false, want, 0, 0], `review 2: ${what} during the read: no dialog, nothing saved`);
      const d = source({ confirm: async () => { d.policy.p = change as never; return true; } });
      const b = await d.set(RAVI);
      assert.deepStrictEqual([b.ok, b.reason, d.patches.length, d.store.updates.source], [false, want, 0, undefined], `review 2: ${what} during the dialog: a yes saves nothing`);
    }

    // (3) a dialog that throws: nothing saved, a clear answer, and the next change works
    let throws = true;
    const th = source({ confirm: async () => { if (throws) { throws = false; throw new Error('no window'); } return true; } });
    const f = await th.set(RAVI);
    assert.deepStrictEqual([f.ok, f.reason, th.patches.length], [false, 'dialog-failed', 0], 'review 3: a throwing dialog saves nothing and says so');
    const g = await th.set(RAVI);
    assert.deepStrictEqual([g.ok, th.asked.length, th.store.updates.source], [true, 2, RAVI], 'review 3: the next change reaches the dialog and saves (the busy flag was cleared)');

    // (4) a failed save: rolled back, answers unsaved, the kept feed and result untouched, the busy flag cleared
    const fs2 = source({ failSave: true });
    const kept = (await fs2.h.check()) as SelfUpdateView;
    const u = await fs2.set(RAVI);
    assert.deepStrictEqual([u.ok, u.reason, fs2.store.updates.source, fs2.patches.length], [false, 'unsaved', undefined, 2], 'review 4: a failed save answers unsaved and is rolled back (the old source stays)');
    assert.deepStrictEqual([u.update.source, u.update.target, u.update.state], [SLUG, kept.target, kept.state], 'review 4: the kept feed and result are untouched');
    assert.strictEqual((await fs2.set(RAVI)).reason, 'unsaved', 'review 4: the next change is not busy');
  }

  exit.done();
  console.log('selfupdate-source: ok');
}

main().catch((e) => { console.error(e); process.exit(1); });
