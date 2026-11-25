/**
 * Spec 118 T010, the checker (FR-004, FR-005, FR-006, FR-008, FR-009, FR-021): `SelfUpdater` in `src/main/selfupdate.ts`: packaged builds
 * only, the default, the timer, the policy, the abort, the result and one check at a time. `npm run test:selfupdate-checker`. No Electron,
 * no network, no real timer (`selfupdate-rig.ts`).
 */
import * as assert from 'assert';
import { EventEmitter } from 'events';
import { MANUAL_GAP_MS } from '../src/main/selfupdate';
import type { SelfUpdateDeps, SelfUpdateStore } from '../src/main/selfupdate';
import { makeFeedGet } from '../src/main/netget';
import type { FeedTimer, NetRequestLike } from '../src/main/netget';
import { DAY_MS } from '../src/shared/selfupdate';
import type { SelfPolicy } from '../src/shared/selfupdate';
import { feedBytes, fire, guardExit, ok, rel, rig, settle, standard, LIST, NO, RAW29, SLUG, T0 } from './selfupdate-rig';

const exit = guardExit('selfupdate-checker');

async function main(): Promise<void> {
  // ---- FR-004: packaged builds only, default on, no timer when off ---------------------------------------------------
  {
    const dev = rig({ packaged: false, script: standard });
    dev.u.start(); await dev.u.checkNow(); await fire(dev);
    assert.strictEqual(dev.calls.length, 0, 'FR-004: a dev run (not packaged) never checks, not even Check now');
    assert.strictEqual(dev.timers.size, 0, 'FR-004: a dev run arms no timer');
    const sim = rig({ simulator: true, script: standard });
    sim.u.start(); await sim.u.checkNow();
    assert.strictEqual(sim.calls.length + sim.timers.size, 0, 'FR-004: the simulator never checks');
    const none = rig({ origin: null, script: standard });
    none.u.start(); await none.u.checkNow();
    assert.strictEqual(none.calls.length + none.timers.size, 0, 'FR-001: no baked source, no check');
    assert.strictEqual(none.u.view().shown, false, 'FR-001: no baked source, nothing shown');

    const on = rig({ script: standard });
    on.u.start(); await settle(); await settle();
    assert.deepStrictEqual(on.calls.map((c) => c.url), [LIST, RAW29], 'FR-004 (D2 = A): on by default, one list request at start, then the target tag releases.json');
    assert.deepStrictEqual([...on.timers.values()].map((t) => t.ms), [DAY_MS], 'FR-004: one timer, 24 h');
    on.u.start();
    assert.strictEqual(on.timers.size, 1, 'FR-004: at most one timer');
    await fire(on);
    assert.strictEqual(on.calls.filter((c) => c.url === LIST).length, 2, 'FR-004: every 24 h while open');

    const local = rig({ origin: 'local', script: standard });
    local.u.start(); await settle();
    assert.strictEqual(local.calls.length + local.timers.size, 0, 'FR-001: a local build has the daily check off by default');
    await local.u.checkNow();
    assert.strictEqual(local.calls[0]?.url, LIST, 'FR-001: Check now works in a local build');

    const off = rig({ settings: { updates: { selfCheck: false } }, script: standard });
    off.u.start();
    for (let h = 0; h < 24; h++) { off.clock.t += 3_600_000; await fire(off); }
    assert.strictEqual(off.calls.length, 0, 'SC-001: switch off, 24 h simulated, zero requests');
    assert.strictEqual(off.timers.size, 0, 'FR-004: switch off, no timer armed');
    await off.u.checkNow();
    assert.strictEqual(off.calls[0]?.url, LIST, 'FR-004: Check now still works with the switch off');

    const recent = rig({ settings: { updates: { lastCheck: { at: T0 - 3_600_000, latest: '0.1.29' } } }, script: standard });
    recent.u.start(); await settle();
    assert.strictEqual(recent.calls.length, 0, 'FR-004 (D5 = B): no check at start when the last one is under 24 h old');
    assert.deepStrictEqual([...recent.timers.values()].map((t) => t.ms), [DAY_MS - 3_600_000], 'FR-004: the timer waits for the rest of the 24 h');
    await fire(recent);
    assert.strictEqual(recent.calls[0]?.url, LIST, 'FR-004: checked when the 24 h are over');

    // the in-memory time counts when the settings file cannot be written: no second request after a check
    const ro: SelfUpdateStore = { get updates() { return {}; }, setUpdates: () => false };
    const unsaved = rig({ store: ro, script: standard });
    unsaved.u.start(); await settle(); await settle();
    unsaved.u.setSelfCheck(true); await settle();
    assert.strictEqual(unsaved.calls.filter((c) => c.url === LIST).length, 1, 'FR-004: an unsaved last check still counts (no request again at once)');
  }

  // ---- FR-005: the organization policy, read through updatePolicy() ---------------------------------------------------
  {
    for (const p of [{ state: 'ok', updatesMode: 'off' }, { state: 'unreadable' }, undefined] as (SelfPolicy | undefined)[]) {
      const r = rig({ script: standard });
      r.policy.p = p;
      r.u.start(); await r.u.checkNow(); await fire(r);
      assert.strictEqual(r.calls.length + r.timers.size, 0, `FR-005: policy ${JSON.stringify(p)}: no request, no timer`);
      assert.strictEqual(r.u.view().shown, false, `FR-005: policy ${JSON.stringify(p)}: the feature is hidden`);
    }
    const org = rig({ script: (u) => (u.includes('org/fork/releases') ? ok(feedBytes('org/fork')) : NO) });
    org.policy.p = { state: 'ok', feedUrl: 'https://github.com/org/fork' };
    await org.u.checkNow();
    assert.deepStrictEqual(org.calls.map((c) => c.slug), ['org/fork', 'org/fork'], 'FR-005: the organization feedUrl is the source');
    assert.strictEqual(org.u.view().sourceBy, 'organization', 'FR-002: the source says it was set by the organization');
    const bad = rig({ script: standard });
    bad.policy.p = { state: 'ok', feedUrl: 'https://example.com/a/b' };
    bad.u.start(); await bad.u.checkNow();
    assert.strictEqual(bad.calls.length, 0, 'FR-005: an unsupported feedUrl fails closed');
    assert.strictEqual(bad.u.view().blocked, true, 'FR-005: the view says the check is blocked');
  }

  // ---- FR-004: turning it off mid-check aborts the request and discards the answer -----------------------------------
  {
    const r = rig();
    r.u.start(); await settle();
    assert.strictEqual(r.calls.length, 1, 'abort: the check is running');
    r.u.setSelfCheck(false);
    assert.strictEqual(r.calls[0].signal?.aborted, true, 'abort: switching off aborts the running request');
    r.calls[0].answer(ok(feedBytes())); await settle(); await settle();
    assert.strictEqual(r.calls.length, 1, 'abort: no further request after switching off');
    assert.strictEqual(r.u.view().state, 'none', 'abort: the answer of an aborted check is discarded');
    assert.strictEqual(r.store.updates.lastCheck, undefined, 'abort: an aborted check writes no last check');
    assert.strictEqual(r.timers.size, 0, 'abort: the timer is disarmed');

    const p = rig({ script: (u) => (u === LIST ? undefined : standard(u)) });
    p.u.start(); await settle();
    p.policy.p = { state: 'ok', updatesMode: 'off' };
    p.calls[0].answer(ok(feedBytes())); await settle(); await settle();
    assert.strictEqual(p.calls.length, 1, 'abort: a policy turned off while the request runs: no releases.json read');
    assert.strictEqual(p.u.view().state, 'none', 'abort: the policy is read again when the answer arrives');
    p.u.refresh();
    assert.strictEqual(p.timers.size, 0, 'abort: a refresh under a blocking policy disarms the timer');

    const q = rig();
    q.u.start(); await settle();
    q.policy.p = { state: 'ok', updatesMode: 'off' };
    q.u.refresh();
    assert.strictEqual(q.calls[0].signal?.aborted, true, 'abort: a policy turned off aborts the running request on refresh');

    // the real request function: the request object is aborted, and none is created when off
    const reqs: { aborted: boolean }[] = [];
    const factory = (): NetRequestLike => { const e = new EventEmitter() as EventEmitter & { aborted: boolean }; e.aborted = false; const q = Object.assign(e, { setHeader: () => undefined, end: () => undefined, abort: () => { q.aborted = true; } }); reqs.push(q); return q as unknown as NetRequestLike; };
    const fakeTimer: FeedTimer = { set: () => 0, clear: () => undefined };
    const real = rig();
    const deps = (real.u as unknown as { d: SelfUpdateDeps }).d;
    deps.get = makeFeedGet(factory, fakeTimer);
    real.u.start(); await settle();
    assert.strictEqual(reqs.length, 1, 'abort: one request object for the start check');
    real.u.setSelfCheck(false); await settle();
    assert.strictEqual(reqs[0].aborted, true, 'abort: makeFeedGet aborts the request object');
    for (let h = 0; h < 24; h++) { real.clock.t += 3_600_000; await fire(real); }
    assert.strictEqual(reqs.length, 1, 'SC-001: no request object is created while off');
  }

  // ---- FR-006, FR-007..FR-009: the request and the in-memory result -------------------------------------------------
  {
    const r = rig({ script: standard });
    const v = await r.u.checkNow();
    assert.deepStrictEqual({ state: v.state, target: v.target, versions: v.versions, breaking: v.breaking }, { state: 'update', target: '0.1.29', versions: ['0.1.29', '0.1.28'], breaking: 'no' }, 'result: the update, the releases in between, and the tag releases.json read');
    assert.deepStrictEqual(r.store.updates.lastCheck, { at: T0, latest: '0.1.29' }, 'result: the last check is written, versions only');
    const unk = rig({ script: (u) => (u === LIST ? ok(feedBytes()) : { ok: false, reason: 'status' }) });
    assert.strictEqual((await unk.u.checkNow()).breaking, 'unknown', 'FR-009: no releases.json is Breaking: unknown');
    const text = JSON.stringify(v);
    assert.ok(!/https?:|notes|\\|\/\//.test(text), 'FR-024: the view holds no URL, path or feed text');
    const allowed = new Set(['shown', 'blocked', 'canCheck', 'dailyCheck', 'checking', 'running', 'source', 'sourceBy', 'origin', 'checkedAt', 'latest', 'state', 'target', 'versions', 'breaking', 'gap', 'notice', 'reason']);
    assert.deepStrictEqual(Object.keys(v).filter((k) => !allowed.has(k)), [], 'FR-024: the view has only the listed fields');

    const fail = rig({ settings: { updates: { lastCheck: { at: T0 - 2 * DAY_MS, latest: '0.1.28' } } }, script: () => ({ ok: false, reason: 'redirect' }) });
    const fv = await fail.u.checkNow();
    assert.deepStrictEqual({ state: fv.state, reason: fv.reason }, { state: 'failed', reason: 'redirect' }, 'result: a failure is a closed reason code');
    assert.deepStrictEqual(fail.store.updates.lastCheck, { at: T0, latest: '0.1.28' }, 'result: a failed check is recorded (no retry loop), the last known version kept');

    const [pre, post] = JSON.stringify([rel(SLUG, '0.1.29', 'AAAA')]).split('AAAA');
    const bad = Buffer.concat([Buffer.from(pre), Buffer.from([0xff]), Buffer.from(post)]); // a lone 0xFF inside the body string
    const inv = rig({ script: (u) => (u === LIST ? ok(bad) : NO) });
    assert.strictEqual((await inv.u.checkNow()).reason, 'feed-invalid', 'FR-008: invalid UTF-8 in the body refuses the feed (strict decoding)');
    const bom = rig({ script: (u) => (u === LIST ? ok(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), feedBytes()])) : NO) });
    assert.strictEqual((await bom.u.checkNow()).reason, 'feed-invalid', 'FR-008: a byte-order mark refuses the feed');
    const other = rig({ script: (u) => (u === LIST ? ok(feedBytes('evil/repo')) : NO) });
    assert.strictEqual((await other.u.checkNow()).reason, 'feed-invalid', 'FR-008: another repository\'s releases refuse the feed');
    const zeros = rig({ script: (u) => (u === LIST ? ok(feedBytes(SLUG, ['0.1.030', '0.1.28'])) : NO) });
    await zeros.u.checkNow();
    assert.deepStrictEqual(zeros.store.updates.lastCheck, { at: T0 }, 'result: a latest the strict rule refuses is left out, the check time still written');
    const same = rig({ running: '0.1.29', script: standard });
    assert.strictEqual((await same.u.checkNow()).state, 'up-to-date', 'result: up to date');
    const newer = rig({ running: '0.2.0', script: standard });
    assert.strictEqual((await newer.u.checkNow()).state, 'newer', 'result: this build is newer than the latest release');

    // one check at a time, and no loop the window could drive
    const j = rig();
    const a = j.u.checkNow();
    const b = j.u.checkNow();
    await settle();
    assert.strictEqual(j.calls.length, 1, 'concurrency: a second Check now joins the running one');
    j.calls[0].answer(ok(feedBytes())); await settle();
    j.calls[1]?.answer({ ok: false, reason: 'status' });
    const [va, vb] = await Promise.all([a, b]);
    assert.deepStrictEqual(va, vb, 'concurrency: both get the same answer');
    const third = j.u.checkNow();
    await settle();
    assert.strictEqual(j.calls.filter((c) => c.url === LIST).length, 1, 'concurrency: Check now within 60 s answers the kept result without a request');
    await third;
    j.clock.t += MANUAL_GAP_MS;
    const later = j.u.checkNow(); await settle();
    j.calls[j.calls.length - 1].answer(ok(feedBytes())); await settle(); j.calls[j.calls.length - 1].answer({ ok: false, reason: 'status' });
    await later;
    assert.strictEqual(j.calls.filter((c) => c.url === LIST).length, 2, 'concurrency: after 60 s Check now asks again');
  }

  // ---- review of PR 2073 -------------------------------------------------------------------------------------------
  {
    // (1) off and on in the same tick: the aborted check is not joined; a fresh one starts and its result is stored
    const r = rig();
    r.u.start(); await settle();
    r.u.setSelfCheck(false);
    r.u.setSelfCheck(true);
    await settle();
    assert.strictEqual(r.calls.filter((c) => c.url === LIST).length, 2, 'review 1: off and on in the same tick starts a fresh request (the aborted one is not joined)');
    assert.ok(r.calls[0].signal?.aborted && !r.calls[1].signal?.aborted, 'review 1: the first request is aborted, the fresh one is not');
    r.calls[0].answer({ ok: false, reason: 'aborted' });
    r.calls[1].answer(ok(feedBytes())); await settle(); await settle();
    r.calls[2]?.answer(NO); await settle(); await settle();
    assert.strictEqual(r.u.view().target, '0.1.29', 'review 1: the fresh check result is stored');

    // (2) the source changes mid-check: the answer is dropped, never shown under the new name, and a fresh check starts
    const m = rig({ script: (u) => (u.includes('org-b/') && u.includes('/releases?') ? ok(feedBytes('org-b/durbar', ['0.1.27'])) : u.includes('org-b/') ? NO : undefined) });
    m.policy.p = { state: 'ok', feedUrl: 'https://github.com/org-a/durbar' };
    m.u.start(); await settle();
    assert.strictEqual(m.calls[0]?.slug, 'org-a/durbar', 'review 2: the check runs for the source in force');
    m.policy.p = { state: 'ok', feedUrl: 'https://github.com/org-b/durbar' };
    m.calls[0].answer(ok(feedBytes('org-a/durbar'))); await settle(); await settle(); await settle();
    assert.deepStrictEqual(m.calls.map((c) => c.slug), ['org-a/durbar', 'org-b/durbar'], 'review 2: a source change drops the answer and a fresh check starts for the new source');
    const mv = m.u.view();
    assert.deepStrictEqual([mv.source, mv.state, mv.target], ['org-b/durbar', 'up-to-date', undefined], 'review 2: the old repository\'s update is never shown under the new name');

    const done = rig({ script: (u) => (u.includes('org-a/') && u.includes('/releases?') ? ok(feedBytes('org-a/durbar')) : NO) });
    done.policy.p = { state: 'ok', feedUrl: 'https://github.com/org-a/durbar' };
    assert.strictEqual((await done.u.checkNow()).target, '0.1.29', 'review 2: a finished check for org-a');
    done.policy.p = { state: 'ok', feedUrl: 'https://github.com/org-b/durbar' };
    assert.deepStrictEqual([done.u.view().state, done.u.view().target], ['none', undefined], 'review 2: a kept result is never shown once the source changed');

    // (3) finish writes exactly { lastCheck }, on every path
    const patches: unknown[] = [];
    const recorder = (base: SelfUpdateStore): SelfUpdateStore => ({ get updates() { return base.updates; }, setUpdates: (p) => { patches.push(p); return base.setUpdates(p); } });
    const s1 = rig({ settings: { updates: { selfCheck: false, lastCheck: { at: T0 - 2 * DAY_MS, latest: '0.1.28' } } }, script: standard });
    const st1 = recorder(s1.store);
    (s1.u as unknown as { d: SelfUpdateDeps }).d.store = () => st1;
    await s1.u.checkNow();
    // T014 (FR-463): then exactly { announced } when it finds a version not announced before (a patch of its own: nothing else rides along)
    assert.deepStrictEqual(patches, [{ lastCheck: { at: T0, latest: '0.1.29' } }, { announced: '0.1.29' }], 'review 3: a successful check writes exactly { lastCheck } (and, T014, exactly { announced } for a new version)');
    assert.strictEqual(s1.store.updates.selfCheck, false, 'review 3: the switch stays off after a check');
    patches.length = 0;
    s1.clock.t += MANUAL_GAP_MS;
    (s1.u as unknown as { d: SelfUpdateDeps }).d.get = async () => ({ ok: false, reason: 'timeout' });
    await s1.u.checkNow();
    assert.deepStrictEqual(patches, [{ lastCheck: { at: T0 + MANUAL_GAP_MS, latest: '0.1.29' } }], 'review 3: a failed check writes exactly { lastCheck } with the last known version');
    patches.length = 0;
    s1.clock.t += MANUAL_GAP_MS;
    (s1.u as unknown as { d: SelfUpdateDeps }).d.get = async (u) => (u === LIST ? ok(feedBytes(SLUG, ['0.1.030'])) : NO);
    await s1.u.checkNow();
    assert.deepStrictEqual(patches, [{ lastCheck: { at: T0 + 2 * MANUAL_GAP_MS } }], 'review 3: a version the strict rule refuses: exactly { lastCheck } with the time only');

    // (4) an aborted Check now whose answer still arrives: nothing stored, the caller sees no result, the next one works
    const a = rig({ settings: { updates: { selfCheck: false } }, script: (u) => (u === LIST ? undefined : NO) });
    const pending = a.u.checkNow(); await settle();
    a.u.setSelfCheck(false);
    a.calls[0].answer(ok(feedBytes())); await settle();
    assert.deepStrictEqual([(await pending).state, a.store.updates.lastCheck], ['none', undefined], 'review 4: an aborted Check now stores nothing, even when its answer arrives');
    const n0 = a.calls.length;
    const next = a.u.checkNow(); await settle();
    a.calls[n0].answer(ok(feedBytes()));
    assert.strictEqual((await next).target, '0.1.29', 'review 4: the next Check now works');

    // (5) switched off between the list and releases.json: no result stored
    const b = rig({ script: (u) => (u === LIST ? ok(feedBytes()) : undefined) });
    b.u.start(); await settle(); await settle();
    assert.strictEqual(b.calls[1]?.url, RAW29, 'review 5: the releases.json read is running');
    b.policy.p = { state: 'ok', updatesMode: 'off' };
    b.calls[1].answer({ ok: true, kind: 'releases', bytes: Buffer.from('{}') }); await settle();
    b.policy.p = { state: 'none' };
    assert.strictEqual(b.u.view().state, 'none', 'review 5: a policy turned off between the two requests stores no result');

    // (6) releases.json is decoded strictly: invalid UTF-8 inside a note makes it unreadable (Breaking: unknown)
    const notes = JSON.stringify({ schema: 1, versions: { '0.1.28': { breaking: false, notes: 'AAAA', action: '' }, '0.1.29': { breaking: false, notes: 'n', action: '' } } });
    const [pre, post] = notes.split('AAAA');
    const badUtf8 = Buffer.concat([Buffer.from(pre), Buffer.from([0xff]), Buffer.from(post)]);
    for (const [bytes, what] of [[badUtf8, 'invalid UTF-8'], [Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(notes.replace('AAAA', 'n'))]), 'a byte-order mark']] as [Buffer, string][]) {
      const d = rig({ script: (u) => (u === LIST ? ok(feedBytes()) : { ok: true, kind: 'releases', bytes }) });
      assert.strictEqual((await d.u.checkNow()).breaking, 'unknown', `review 6: releases.json with ${what} is refused (Breaking: unknown)`);
    }

    // (7) the 60 s window does not hold when the clock went back, and an unplaced entry is never "up to date"
    const c = rig({ script: standard });
    await c.u.checkNow();
    c.clock.t -= 10_000;
    await c.u.checkNow();
    assert.strictEqual(c.calls.filter((x) => x.url === LIST).length, 2, 'review 7: a clock set back opens the 60 s window again (no stale answer)');
    const un = rig({ script: (u) => (u === LIST ? ok(Buffer.from('[7]')) : NO) });
    assert.strictEqual((await un.u.checkNow()).reason, 'feed-invalid', 'review 7: a page with only an unplaced entry is feed-invalid, not up to date');
  }

  exit.done();
  console.log('selfupdate-checker: ok');
}

main().catch((e) => { console.error(e); process.exit(1); });
