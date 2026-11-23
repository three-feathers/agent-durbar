/**
 * Spec 118 T010 (FR-004, FR-005, FR-006, FR-021, FR-024): Durbar's own update checker in main (`src/main/selfupdate.ts`) and its four
 * version-only IPC channels (the settings keys and the abort are tested in test-selfupdate-settings.ts and test-selfupdate-feedget.ts). `npm run test:selfupdate-ipc`. No Electron, no network, no real timer: a fake clock, a fake timer
 * and a fake feed request (or `makeFeedGet` on a fake request layer, to count request objects). Forged arguments on every channel.
 */
import * as assert from 'assert';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SelfUpdater, selfUpdateHandlers, MANUAL_GAP_MS, SELFUPDATE_REFUSED } from '../src/main/selfupdate';
import type { SelfUpdateDeps, SelfUpdateStore, SelfUpdateView } from '../src/main/selfupdate';
import { makeFeedGet } from '../src/main/netget';
import type { FeedAnswer, FeedTimer, NetRequestLike } from '../src/main/netget';
import { SettingsStore } from '../src/main/settings';
import { DAY_MS, SNOOZE_MS } from '../src/shared/selfupdate';
import type { SelfPolicy } from '../src/shared/selfupdate';
import { preloadChannels, stripComments } from './ipc-channel-list';

const SLUG = 'three-feathers/agent-durbar';
const LIST = `https://api.github.com/repos/${SLUG}/releases?per_page=30`;
const RAW29 = `https://raw.githubusercontent.com/${SLUG}/v0.1.29/releases.json`;
const T0 = 1_800_000_000_000;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-selfupdate-ipc-'));
let files = 0;

const rel = (slug: string, v: string, body = 'notes') => ({ tag_name: 'v' + v, draft: false, prerelease: false, published_at: '2026-11-20T10:00:00Z', html_url: `https://github.com/${slug}/releases/tag/v${v}`, body, assets: [] });
const feedBytes = (slug = SLUG, versions = ['0.1.29', '0.1.28', '0.1.27']): Buffer => Buffer.from(JSON.stringify(versions.map((v) => rel(slug, v))));
const ok = (bytes: Buffer): FeedAnswer => ({ ok: true, kind: 'list', bytes });
const NO: FeedAnswer = { ok: false, reason: 'status' };
const RELEASES_OK = Buffer.from(JSON.stringify({ schema: 1, versions: { '0.1.28': { breaking: false, notes: 'n', action: '' }, '0.1.29': { breaking: false, notes: 'n', action: '' } } }));

interface Call { url: string; slug: string; signal?: AbortSignal; answer(a: FeedAnswer): void }
interface Rig { u: SelfUpdater; calls: Call[]; timers: Map<number, { cb: () => void; ms: number }>; clock: { t: number }; store: SettingsStore; file: string; policy: { p: SelfPolicy | undefined } }

/** A checker on a temp settings file; `auto` answers each request at once from `script` (else the test answers it). */
function rig(o: { packaged?: boolean; simulator?: boolean; origin?: 'env' | 'ci' | 'local' | null; settings?: unknown; script?: (url: string) => FeedAnswer | undefined; running?: string; store?: SelfUpdateStore } = {}): Rig {
  const file = path.join(tmp, `s${files++}.json`);
  if (o.settings !== undefined) fs.writeFileSync(file, JSON.stringify(o.settings));
  const store = new SettingsStore(file);
  store.load();
  const calls: Call[] = [];
  const timers = new Map<number, { cb: () => void; ms: number }>();
  let id = 0;
  const timer: FeedTimer = { set: (cb, ms) => { timers.set(++id, { cb, ms }); return id; }, clear: (h) => { timers.delete(h as number); } };
  const clock = { t: T0 };
  const policy: { p: SelfPolicy | undefined } = { p: { state: 'none' } };
  const deps: SelfUpdateDeps = {
    packaged: o.packaged ?? true,
    simulator: o.simulator ?? false,
    source: o.origin === null ? undefined : { slug: SLUG, origin: o.origin ?? 'ci' },
    running: o.running ?? '0.1.27',
    policy: () => policy.p,
    store: () => o.store ?? store,
    get: (url, slug, signal) => new Promise<FeedAnswer>((resolve) => {
      const c: Call = { url, slug, signal, answer: resolve };
      calls.push(c);
      const a = o.script?.(url);
      if (a) resolve(a);
    }),
    now: () => clock.t,
    timer,
  };
  return { u: new SelfUpdater(deps), calls, timers, clock, store, file, policy };
}
const settle = (): Promise<void> => new Promise((r) => setImmediate(r));
const fire = async (r: Rig): Promise<void> => {
  const all = [...r.timers.entries()];
  r.timers.clear();
  for (const [, t] of all) { r.clock.t += t.ms; t.cb(); }
  await settle(); await settle();
};
const standard = (url: string): FeedAnswer | undefined => (url === LIST ? ok(feedBytes()) : url === RAW29 ? { ok: true, kind: 'releases', bytes: RELEASES_OK } : undefined);

let finished = false;
// a request nobody answers would let node exit 0 with the test half run: that is a failure
process.on('exit', (code) => { if (code === 0 && !finished) { console.error('selfupdate ipc: the test stopped before its end (an answer never came)'); process.exitCode = 1; } });

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

  // ---- FR-024: forged arguments on every channel -------------------------------------------------------------------
  {
    const r = rig({ script: standard });
    const h = selfUpdateHandlers(() => r.u);
    const refused = async (f: () => unknown, what: string): Promise<void> => {
      const before = [r.calls.length, fs.existsSync(r.file) ? fs.readFileSync(r.file, 'utf8') : '', JSON.stringify(r.u.view())];
      await assert.rejects(async () => f(), (e: Error) => e.message === SELFUPDATE_REFUSED, `FR-024: ${what} is refused with the fixed text`);
      assert.deepStrictEqual([r.calls.length, fs.existsSync(r.file) ? fs.readFileSync(r.file, 'utf8') : '', JSON.stringify(r.u.view())], before, `FR-024: ${what}: no request, no settings write, no change`);
    };
    await refused(() => h.snooze('0.1.29'), 'snooze before any check (no feed in memory)');
    await h.check();
    const calls = r.calls.length;
    let gets = 0;
    const forged: [unknown, string][] = [
      ['0.1.99', 'a version not in the feed'], ['v0.1.29', 'the tag form'], [LIST, 'a URL'], ['../../etc/passwd', 'a path'], ['..\\..\\x', 'a Windows path'], [SLUG, 'a slug'],
      ['0.1.29\u0000', 'a version with a NUL'], ['0.1.29 ', 'a version with a space'], ['9'.repeat(1_000_000), 'a huge string'], [{ version: '0.1.29' }, 'an object'], [['0.1.29'], 'an array'],
      [Object.defineProperty({}, 'toString', { get: () => { gets++; return () => '0.1.29'; } }), 'an object with a getter'], [JSON.parse('{"__proto__":{"version":"0.1.29"}}'), 'a __proto__ object'],
      [new String('0.1.29'), 'a String object'], [129, 'a number'], [null, 'null'], [undefined, 'undefined'],
    ];
    for (const name of ['snooze', 'skip'] as const) {
      for (const [arg, what] of forged) await refused(() => h[name](arg), `${name}(${what})`);
      await refused(() => h[name](), `${name}() with no argument`);
      await refused(() => h[name]('0.1.29', 'x'), `${name} with an extra argument`);
    }
    for (const name of ['get', 'check'] as const) {
      for (const [arg, what] of forged) await refused(() => h[name](arg), `${name}(${what})`);
    }
    assert.strictEqual(gets, 0, 'FR-024: a getter on a forged argument is never run');
    assert.strictEqual(r.calls.length, calls, 'FR-024: no forged call made a request');
    await refused(() => selfUpdateHandlers(() => undefined).get(), 'a call before the checker exists');

    const s = h.snooze('0.1.29') as { ok: boolean; update: SelfUpdateView };
    assert.deepStrictEqual(r.store.updates.snooze, { version: '0.1.29', until: T0 + SNOOZE_MS }, 'FR-016: snooze saves version + 7 days');
    assert.ok(s.ok && s.update.notice === 'snoozed', 'FR-016: the view says snoozed');
    const k = h.skip('0.1.29') as { ok: boolean; update: SelfUpdateView };
    assert.ok(k.ok && r.store.updates.skip === '0.1.29' && k.update.notice === 'skipped', 'FR-016: skip saves the version and the view says skipped');
    assert.strictEqual((h.get() as SelfUpdateView).target, '0.1.29', 'FR-024: get answers the view');

    // the IPC module wires exactly these four channels to these handlers, through ipcHandle
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'ipc', 'selfupdate.ts'), 'utf8').replace(/\r\n/g, '\n');
    const regs = [...src.matchAll(/ipcHandle\('([^']+)', \(_e, \.\.\.a: unknown\[\]\) => h\.(\w+)\(\.\.\.a\)\);/g)].map((m) => `${m[1]}=${m[2]}`);
    assert.deepStrictEqual(regs, ['selfupdate:get=get', 'selfupdate:check=check', 'selfupdate:snooze=snooze', 'selfupdate:skip=skip'], 'FR-024: four channels, each to its own handler, every argument passed to the validator');
    assert.strictEqual((src.match(/ipcHandle\(/g) ?? []).length, 4, 'FR-024: no other channel in the module');
  }

  // ---- not active until T014: nothing in the window can call the channels, and main.ts never starts the checker ----------
  {
    const root = path.join(__dirname, '..', '..');
    assert.deepStrictEqual([...preloadChannels().all].filter((c) => c.startsWith('selfupdate:')), [], 'inert: the preload calls no selfupdate channel (the window API comes with T014)');
    assert.ok(!/selfupdate/i.test(stripComments(fs.readFileSync(path.join(root, 'src', 'preload', 'preload.ts'), 'utf8'))), 'inert: the preload names no selfupdate channel in any form');
    const mainSrc = stripComments(fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8').replace(/\r\n/g, '\n'));
    assert.ok(/selfUpdater = new SelfUpdater\(/.test(mainSrc) && /registerSelfUpdateIpc\(/.test(mainSrc), 'inert: main.ts creates the checker and registers its channels');
    // T014 flips this assert when it adds the start call together with the visible switch and card
    assert.ok(!mainSrc.split('\n').some((l) => /selfUpdater/.test(l) && /\bstart\b/.test(l)), 'inert: main.ts does not start the checker before T014 (no request in a packaged build)');
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  finished = true;
  console.log('selfupdate ipc tests passed');
}

main().catch((e) => { console.error(e); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); });
