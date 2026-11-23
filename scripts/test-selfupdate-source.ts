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
function source(o: { yes?: boolean; ravi?: FeedAnswer; settings?: unknown; packaged?: boolean } = {}) {
  const asked: { message: string; detail: string; ok: string }[] = [];
  const r = rig({
    settings: o.settings,
    packaged: o.packaged,
    script: (u) => (u === RAVI_LIST ? (o.ravi ?? ok(feedBytes(RAVI, ['0.1.31']))) : u.includes(`/${RAVI}/`) ? NO : standard(u) ?? NO),
    confirm: async (q) => { asked.push(q); return o.yes ?? true; },
  });
  const patches: unknown[] = [];
  const real = r.store;
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

  exit.done();
  console.log('selfupdate-source: ok');
}

main().catch((e) => { console.error(e); process.exit(1); });
