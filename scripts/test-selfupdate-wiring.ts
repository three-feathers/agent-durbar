/**
 * Spec 118 T014 (FR-462, FR-463, FR-464; FR-004, FR-016, FR-024, SC-004 main part): the check turned on. The switch (default on, a `local`
 * build off, invalid values on read, the one boolean channel, start and stop when it flips), packaged builds only, the wake from sleep on a fake
 * `powerMonitor`, one toast per version (spec 081's rule, `announceOnce`), the dialog's text on a hostile body, the release page opened only from
 * main's own feed, and the simulator's address named only by the window's simulator. `npm run test:selfupdate-wiring`. No Electron, no network,
 * no real timer (`selfupdate-rig.ts`). Secret-shaped values are built from pieces at run time.
 */
import * as assert from 'assert';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { selfUpdateHandlers, wireSelfUpdateResume, SELFUPDATE_REFUSED } from '../src/main/selfupdate';
import type { SelfUpdateView } from '../src/main/selfupdate';
import { DAY_MS } from '../src/shared/selfupdate';
import { announceOnce } from '../src/shared/updatecheck';
import { feedBytes, fire, guardExit, ok, rel, rig, settle, standard, LIST, RAW29, RELEASES_OK, SLUG, T0 } from './selfupdate-rig';
import type { Rig } from './selfupdate-rig';

const exit = guardExit('selfupdate-wiring');
const lists = (r: Rig): number => r.calls.filter((c) => c.url === LIST).length;
const refused = async (f: () => unknown, what: string): Promise<void> => {
  await assert.rejects(async () => f(), (e: Error) => e.message === SELFUPDATE_REFUSED, `FR-024: ${what} is refused with the fixed text`);
};

async function main(): Promise<void> {
  // ---- FR-462: the switch. Default on (D2 = A), a local build off (FR-001), invalid values on read take the default (FR-021) ------------------
  {
    const on = rig({ script: standard });
    on.u.start(); await settle(); await settle();
    assert.strictEqual(lists(on), 1, 'FR-462: switch absent = on: start makes one list request');
    assert.deepStrictEqual([...on.timers.values()].map((t) => t.ms), [DAY_MS], 'FR-462: switch absent = on: one 24 h timer');
    assert.strictEqual(on.u.view().dailyCheck, true, 'FR-462: the view says the daily check is on');

    const local = rig({ origin: 'local', script: standard });
    local.u.start(); await settle();
    assert.strictEqual(local.calls.length + local.timers.size, 0, 'FR-462: a local build has the switch off by default');
    assert.strictEqual(local.u.view().dailyCheck, false, 'FR-462: the view says off for a local build');

    for (const bad of ['no', 'false', 0, 1, null, {}, [], 'true']) {
      const r = rig({ settings: { updates: { selfCheck: bad } }, script: standard });
      r.u.start(); await settle(); await settle();
      assert.strictEqual(lists(r), 1, `FR-462: selfCheck ${JSON.stringify(bad)} on read is absent, so the default (on) holds`);
      assert.strictEqual(r.store.updates.selfCheck, undefined, `FR-021: selfCheck ${JSON.stringify(bad)} is not read as a value`);
    }
  }

  // ---- FR-462: setDailyCheck, the one boolean channel: forged arguments refused, no write, no request ---------------------------------------
  {
    const r = rig({ script: standard });
    const h = selfUpdateHandlers(() => r.u);
    const before = [r.calls.length, fs.existsSync(r.file) ? fs.readFileSync(r.file, 'utf8') : ''];
    let gets = 0;
    const forged: [unknown[], string][] = [
      [['true'], 'the text true'], [['false'], 'the text false'], [[1], 'a number'], [[0], 'zero'], [[null], 'null'], [[undefined], 'undefined'], [[{}], 'an object'],
      [[new Boolean(false)], 'a Boolean object'], [[[true]], 'an array'], [[], 'no argument'], [[true, true], 'two arguments'],
      [[Object.defineProperty({}, 'valueOf', { get: () => { gets++; return () => true; } })], 'an object with a getter'],
    ];
    for (const [args, what] of forged) await refused(() => h.setDailyCheck(...args), `setDailyCheck(${what})`);
    assert.strictEqual(gets, 0, 'FR-024: a getter on a forged argument is never run');
    assert.deepStrictEqual([r.calls.length, fs.existsSync(r.file) ? fs.readFileSync(r.file, 'utf8') : ''], before, 'FR-462: a refused setDailyCheck writes nothing and requests nothing');
    await refused(() => selfUpdateHandlers(() => undefined).setDailyCheck(true), 'setDailyCheck before the checker exists');
  }

  // ---- FR-462: start and stop when the switch flips (timer and requests counted), and packaged builds only ----------------------------------
  {
    const r = rig({ script: standard });
    const h = selfUpdateHandlers(() => r.u);
    r.u.start(); await settle(); await settle();
    assert.strictEqual(lists(r), 1, 'flip: on at start, one request');
    const off = h.setDailyCheck(false) as { ok: boolean; update: SelfUpdateView };
    assert.ok(off.ok && off.update.dailyCheck === false, 'FR-462: switching off answers ok and the view says off');
    assert.strictEqual(r.store.updates.selfCheck, false, 'FR-462: off is saved as selfCheck false');
    assert.strictEqual(r.timers.size, 0, 'FR-462: off disarms the timer at once');
    for (let i = 0; i < 3; i++) { r.clock.t += DAY_MS; await fire(r); }
    assert.strictEqual(lists(r), 1, 'FR-462 (SC-001): off, three days pass, no request');
    const on = h.setDailyCheck(true) as { ok: boolean; update: SelfUpdateView };
    await settle(); await settle();
    assert.ok(on.ok && (r.store.updates as { selfCheck?: boolean }).selfCheck === true, 'FR-462: on is saved as selfCheck true');
    assert.strictEqual(lists(r), 2, 'FR-462: on again with the last check over 24 h old checks at once');
    assert.strictEqual(r.timers.size, 1, 'FR-462: on again arms one timer');

    // off while a check is running aborts it and nothing is written (FR-004)
    const slow = rig();
    const hs = selfUpdateHandlers(() => slow.u);
    slow.u.start(); await settle();
    assert.strictEqual(slow.calls.length, 1, 'mid-check: one request open');
    hs.setDailyCheck(false);
    assert.strictEqual(slow.calls[0].signal?.aborted, true, 'FR-462: off mid-check aborts the running request');
    slow.calls[0].answer(ok(feedBytes())); await settle(); await settle();
    assert.strictEqual(slow.store.updates.lastCheck, undefined, 'FR-462: the answer of an aborted check is discarded (no lastCheck)');

    const dev = rig({ packaged: false, script: standard });
    const hd = selfUpdateHandlers(() => dev.u);
    dev.u.start(); hd.setDailyCheck(true); await settle(); await fire(dev);
    assert.strictEqual(dev.calls.length + dev.timers.size, 0, 'FR-004: a dev run never checks, even with the switch turned on');
    assert.strictEqual(dev.u.view().shown, false, 'FR-464: a dev run shows no Updates block');
  }

  // ---- FR-462 (review of PR 2073): a wake from sleep looks again at once (fake powerMonitor) ------------------------------------------------
  {
    const r = rig({ settings: { updates: { lastCheck: { at: T0 - 3_600_000, latest: '0.1.29' } } }, script: standard });
    const pm = new EventEmitter();
    wireSelfUpdateResume(pm as unknown as { on(e: 'resume', cb: () => void): unknown }, () => r.u);
    r.u.start(); await settle();
    assert.strictEqual(r.calls.length, 0, 'resume: no check at start, the last one is 1 h old');
    r.clock.t += 30 * 3_600_000; // the machine slept 30 h: the old timer has not fired
    pm.emit('resume'); await settle(); await settle();
    assert.strictEqual(lists(r), 1, 'FR-462: a resume after a 30 h clock jump checks at once');
    assert.deepStrictEqual([...r.timers.values()].map((t) => t.ms), [DAY_MS], 'FR-462: and re-arms one 24 h timer');
    pm.emit('resume'); await settle();
    assert.strictEqual(lists(r), 1, 'FR-462: a second resume right after does not check again (not due)');
    const off = rig({ settings: { updates: { selfCheck: false, lastCheck: { at: T0 - DAY_MS * 3 } } }, script: standard });
    const pm2 = new EventEmitter();
    wireSelfUpdateResume(pm2 as unknown as { on(e: 'resume', cb: () => void): unknown }, () => off.u);
    off.u.start(); pm2.emit('resume'); await settle();
    assert.strictEqual(off.calls.length + off.timers.size, 0, 'FR-462: a resume with the switch off makes no request and arms no timer');
    const none = new EventEmitter();
    wireSelfUpdateResume(none as unknown as { on(e: 'resume', cb: () => void): unknown }, () => undefined);
    none.emit('resume'); // before the checker exists: nothing happens, nothing throws
    assert.strictEqual(pm.listenerCount('resume'), 1, 'FR-462: one resume listener');
  }

  // ---- FR-463: one toast per version (spec 081's rule, shared as announceOnce) -------------------------------------------------------------
  {
    assert.deepStrictEqual(announceOnce('0.1.29', undefined, false), { toast: true, save: '0.1.29' }, 'announceOnce: a first version is toasted and saved');
    assert.deepStrictEqual(announceOnce('0.1.29', '0.1.29', false), { toast: false }, 'announceOnce: the same version is not news');
    assert.deepStrictEqual(announceOnce('0.1.29', '0.1.30', false), { toast: false }, 'announceOnce: an older version is not news');
    assert.deepStrictEqual(announceOnce('0.1.30', '0.1.29', true), { toast: false, save: '0.1.30' }, 'announceOnce: with the card on screen it is saved, not toasted');

    const seen: SelfUpdateView[] = [];
    let feed = feedBytes();
    const r = rig({ script: (u) => (u === LIST ? ok(feed) : u.endsWith('/releases.json') ? { ok: true, kind: 'releases', bytes: RELEASES_OK } : undefined), changed: (v) => { seen.push(v); } });
    r.u.start(); await settle(); await settle();
    assert.strictEqual(seen.length, 1, 'FR-462: the window is told once when the check ends');
    assert.strictEqual((seen[0] as { announce?: string }).announce, '0.1.29', 'FR-463: a daily check that finds v0.1.29 announces it');
    assert.strictEqual(seen[0].checking, false, 'FR-462: the view sent at the end is no longer checking');
    assert.strictEqual(r.store.updates.announced, '0.1.29', 'FR-463: the announced version is saved');
    await fire(r);
    assert.strictEqual(seen.length, 2, 'FR-463: the next daily check tells the window again');
    assert.strictEqual((seen[1] as { announce?: string }).announce, undefined, 'FR-463: the same version is not toasted twice');
    feed = feedBytes(SLUG, ['0.1.30', '0.1.29', '0.1.28', '0.1.27']);
    await fire(r);
    assert.strictEqual((seen[2] as { announce?: string }).announce, '0.1.30', 'FR-463: a newer version is toasted once');

    const known = rig({ settings: { updates: { announced: '0.1.29' } }, script: standard, changed: (v) => { seen.push(v); } });
    const n0 = seen.length;
    known.u.start(); await settle(); await settle();
    assert.strictEqual((seen[n0] as { announce?: string }).announce, undefined, 'FR-463: a version announced in an earlier run is not toasted after a restart');

    const manual: SelfUpdateView[] = [];
    const m = rig({ script: standard, changed: (v) => { manual.push(v); } });
    await m.u.checkNow();
    assert.strictEqual((manual[0] as { announce?: string }).announce, undefined, 'FR-463: Check now does not toast (the card says it)');
    assert.strictEqual(m.store.updates.announced, '0.1.29', 'FR-463: Check now saves the version, so no toast follows later');

    const sn: SelfUpdateView[] = [];
    const snoozed = rig({ settings: { updates: { snooze: { version: '0.1.29', until: T0 + DAY_MS } } }, script: standard, changed: (v) => { sn.push(v); } });
    snoozed.u.start(); await settle(); await settle();
    assert.strictEqual((sn[0] as { announce?: string }).announce, undefined, 'FR-016: a snoozed version is not toasted');
    assert.strictEqual(snoozed.store.updates.announced, undefined, 'FR-016: a snoozed version is not marked announced');
    const sk: SelfUpdateView[] = [];
    const skipped = rig({ settings: { updates: { skip: '0.1.29' } }, script: standard, changed: (v) => { sk.push(v); } });
    skipped.u.start(); await settle(); await settle();
    assert.strictEqual((sk[0] as { announce?: string }).announce, undefined, 'FR-016: a skipped version is not toasted');
    const up: SelfUpdateView[] = [];
    const current = rig({ running: '0.1.29', script: standard, changed: (v) => { up.push(v); } });
    current.u.start(); await settle(); await settle();
    assert.ok(up[0].state === 'up-to-date' && (up[0] as { announce?: string }).announce === undefined, 'FR-463: up to date, no toast');
  }

  // ---- FR-464, FR-010, SC-004 (main part): the dialog's text, cleaned in main; nothing from the window chooses it -----------------------------
  {
    const ch = (...cps: number[]): string => String.fromCodePoint(...cps);
    const token = ['gh', 'p_', 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2'].join('');
    const hostile = '<img src=x onerror=alert(1)><script>x()</script> [x](javascript:alert(1)) a' + ch(0x202e) + 'b' + ch(7) + 'c ' + token;
    const body = Buffer.from(JSON.stringify([rel(SLUG, '0.1.29', hostile), rel(SLUG, '0.1.28', 'Fixed things.'), rel(SLUG, '0.1.27')]));
    const marks = Buffer.from(JSON.stringify({ schema: 1, versions: { '0.1.28': { breaking: false, notes: 'n', action: '' }, '0.1.29': { breaking: true, notes: 'Floors are renamed.', action: 'Check your floor names.' } } }));
    const r = rig({ script: (u) => (u === LIST ? ok(body) : u === RAW29 ? { ok: true, kind: 'releases', bytes: marks } : undefined) });
    const h = selfUpdateHandlers(() => r.u);
    assert.deepStrictEqual(h.notes(), { running: '0.1.27', releases: [], marks: [] }, 'FR-464: no update, no text');
    await h.check();
    const n = h.notes() as ReturnType<typeof r.u.notes>;
    assert.deepStrictEqual(n.releases.map((x) => x.version), ['0.1.29', '0.1.28'], 'FR-464: the releases that come with the update, newest first');
    assert.strictEqual(n.releases[0].date, '2026-11-20', 'FR-464: the date of each release');
    assert.ok(n.releases[0].text.includes('<img src=x onerror=alert(1)><script>x()</script> [x](javascript:alert(1))'), 'SC-004: markup stays as text (the window shows it with textContent)');
    assert.ok(!/[‮\u0007]/.test(n.releases[0].text) && n.releases[0].text.includes('abc'), 'SC-004: bidi and control characters are removed in main');
    assert.ok(!n.releases[0].text.includes(token.slice(4, 14)), 'FR-010: a secret-shaped value in a release body is masked');
    assert.deepStrictEqual(n.marks, [{ version: '0.1.29', notes: 'Floors are renamed.', action: 'Check your floor names.' }], 'FR-464: the breaking card has the tag releases.json words of each breaking version');
    assert.ok(n.breaking === 'breaking' && n.target === '0.1.29' && n.source === SLUG && n.sourceBy === 'built-in', 'FR-464, FR-002: target, breaking mark and source come with the text');
    await refused(() => h.notes('0.1.29'), 'notes(a version)');
    await refused(() => h.notes(LIST), 'notes(a URL)');
  }

  // ---- FR-024: the release page is main's own validated html_url, for a version of main's feed ------------------------------------------------
  {
    const opened: string[] = [];
    const r = rig({ script: standard, openExternal: (u) => { opened.push(u); } });
    const h = selfUpdateHandlers(() => r.u);
    await refused(() => h.openReleasePage('0.1.29'), 'openReleasePage before any check');
    await h.check();
    for (const [arg, what] of [[`https://github.com/${SLUG}/releases/tag/v0.1.29`, 'a URL'], ['https://evil.example/', 'another host'], ['0.1.99', 'a version not in the feed'], ['v0.1.29', 'the tag form'], ['../x', 'a path'], [{ version: '0.1.29' }, 'an object'], [SLUG, 'a slug']] as [unknown, string][]) {
      await refused(() => h.openReleasePage(arg), `openReleasePage(${what})`);
    }
    await refused(() => h.openReleasePage('0.1.29', 'x'), 'openReleasePage with an extra argument');
    assert.deepStrictEqual(opened, [], 'FR-024: no forged call opened anything');
    assert.deepStrictEqual(await h.openReleasePage('0.1.29'), { ok: true }, 'FR-024: a version of the feed opens');
    assert.deepStrictEqual(opened, [`https://github.com/${SLUG}/releases/tag/v0.1.29`], 'FR-024: exactly the validated html_url of that release is opened');
    const noOpen = rig({ script: standard });
    await noOpen.u.checkNow();
    assert.deepStrictEqual(await selfUpdateHandlers(() => noOpen.u).openReleasePage('0.1.29'), { ok: false }, 'FR-024: without the opener nothing is opened');
    const failing = rig({ script: standard, openExternal: () => Promise.reject(new Error('no browser')) });
    await failing.u.checkNow();
    assert.deepStrictEqual(await selfUpdateHandlers(() => failing.u).openReleasePage('0.1.29'), { ok: false }, 'FR-024: a failed open answers ok false, never a rejection');
  }

  // ---- FR-464: the simulator's canned feed is named only by the window's simulator; main never reads it --------------------------------------
  {
    const root = path.join(__dirname, '..', '..', 'src');
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const named = walk(root).filter((f) => /\.(ts|js|html)$/.test(f) && /simselfupd/i.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(root, f).replace(/\\/g, '/'));
    assert.deepStrictEqual(named, ['renderer/sim.ts'], 'FR-464: only the window simulator names its canned update feed (main and the preload never read it)');
  }

  // ---- FR-464, SC-004: the window's helpers (selfupdatecard.js): the menu line, the words, and no markup path anywhere in the file ----------
  {
    const file = path.join(__dirname, '..', '..', 'src', 'renderer', 'selfupdatecard.js');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const W = require(file) as { menuLine(v: unknown): string; stateText(v: unknown, now?: number): string; sourceText(v: unknown): string; reasonText(c: unknown): string };
    const upd = { shown: true, state: 'update', target: '0.1.31', notice: 'show', running: '0.1.29', checkedAt: T0 - 2 * 3_600_000 };
    assert.strictEqual(W.menuLine(upd), 'Update available: v0.1.31', 'FR-464: the More menu line while an update is shown');
    assert.strictEqual(W.menuLine({ ...upd, notice: 'snoozed' }), '', 'FR-016: no menu line while snoozed');
    assert.strictEqual(W.menuLine({ ...upd, notice: 'skipped' }), '', 'FR-016: no menu line for a skipped version');
    assert.strictEqual(W.menuLine({ ...upd, shown: false }), '', 'FR-464: no menu line when the block is not shown');
    assert.strictEqual(W.menuLine({ ...upd, state: 'up-to-date' }), '', 'FR-464: no menu line when up to date');
    assert.strictEqual(W.stateText(upd, T0), 'Update available: v0.1.31 · checked 2 h ago', 'FR-011: the update line with the time of the check');
    assert.strictEqual(W.stateText({ ...upd, state: 'up-to-date', target: undefined }, T0), 'Up to date · v0.1.29 · checked 2 h ago', 'FR-011: the up-to-date line');
    assert.strictEqual(W.stateText({ ...upd, state: 'failed', reason: 'timeout' }, T0), 'Could not check: GitHub did not answer within 10 seconds · checked 2 h ago', 'FR-011: a failure in words');
    assert.strictEqual(W.reasonText('<b>x</b>'), 'the answer could not be read', 'FR-025: an unknown code never shows its own text');
    assert.strictEqual(W.sourceText({ source: SLUG, sourceBy: 'you' }), `Updates from ${SLUG} (changed by you)`, 'FR-002: the source line says who chose it');
    const src = fs.readFileSync(file, 'utf8');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|DOMParser|createContextualFragment/.test(src), 'SC-004: selfupdatecard.js has no path that parses markup (textContent and DOM calls only)');
  }

  exit.done();
  console.log('selfupdate-wiring: ok');
}

main().catch((e) => { console.error(e); process.exit(1); });
