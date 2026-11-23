/**
 * Spec 118 T010: the shared rig of the update-checker tests (test-selfupdate-checker.ts, test-selfupdate-ipc.ts): a checker on a temp
 * settings file, a fake clock, a fake timer and a fake feed request that records every call. No Electron, no network, no real timer.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SelfUpdater } from '../src/main/selfupdate';
import type { SelfUpdateDeps, SelfUpdateStore } from '../src/main/selfupdate';
import type { FeedAnswer, FeedTimer } from '../src/main/netget';
import { SettingsStore } from '../src/main/settings';
import type { SelfPolicy } from '../src/shared/selfupdate';

export const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-selfupdate-'));
export const SLUG = 'three-feathers/agent-durbar';
export const LIST = `https://api.github.com/repos/${SLUG}/releases?per_page=30`;
export const RAW29 = `https://raw.githubusercontent.com/${SLUG}/v0.1.29/releases.json`;
export const T0 = 1_800_000_000_000;
let files = 0;

export const rel = (slug: string, v: string, body = 'notes') => ({ tag_name: 'v' + v, draft: false, prerelease: false, published_at: '2026-11-20T10:00:00Z', html_url: `https://github.com/${slug}/releases/tag/v${v}`, body, assets: [] });
export const feedBytes = (slug = SLUG, versions = ['0.1.29', '0.1.28', '0.1.27']): Buffer => Buffer.from(JSON.stringify(versions.map((v) => rel(slug, v))));
export const ok = (bytes: Buffer): FeedAnswer => ({ ok: true, kind: 'list', bytes });
export const NO: FeedAnswer = { ok: false, reason: 'status' };
export const RELEASES_OK = Buffer.from(JSON.stringify({ schema: 1, versions: { '0.1.28': { breaking: false, notes: 'n', action: '' }, '0.1.29': { breaking: false, notes: 'n', action: '' } } }));

export interface Call { url: string; slug: string; signal?: AbortSignal; answer(a: FeedAnswer): void }
export interface Rig { u: SelfUpdater; calls: Call[]; timers: Map<number, { cb: () => void; ms: number }>; clock: { t: number }; store: SettingsStore; file: string; policy: { p: SelfPolicy | undefined } }

/** A checker on a temp settings file; `auto` answers each request at once from `script` (else the test answers it). */
export function rig(o: { packaged?: boolean; simulator?: boolean; origin?: 'env' | 'ci' | 'local' | null; settings?: unknown; script?: (url: string) => FeedAnswer | undefined; running?: string; store?: SelfUpdateStore; confirm?: SelfUpdateDeps['confirm'] } = {}): Rig {
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
    ...(o.confirm ? { confirm: o.confirm } : {}),
  };
  return { u: new SelfUpdater(deps), calls, timers, clock, store, file, policy };
}
export const settle = (): Promise<void> => new Promise((r) => setImmediate(r));
export const fire = async (r: Rig): Promise<void> => {
  const all = [...r.timers.entries()];
  r.timers.clear();
  for (const [, t] of all) { r.clock.t += t.ms; t.cb(); }
  await settle(); await settle();
};
export const standard = (url: string): FeedAnswer | undefined => (url === LIST ? ok(feedBytes()) : url === RAW29 ? { ok: true, kind: 'releases', bytes: RELEASES_OK } : undefined);

/** A request nobody answers would let node exit 0 with the test half run: `done()` at the end, else the exit is a failure. The temp folder is removed on every exit, a failed assert included. */
export function guardExit(name: string): { done(): void } {
  let finished = false;
  process.on('exit', (code) => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort: the temp folder goes whatever the exit code */ }
    if (code === 0 && !finished) { console.error(`${name}: the test stopped before its end (an answer never came)`); process.exitCode = 1; }
  });
  return { done: () => { finished = true; } };
}
