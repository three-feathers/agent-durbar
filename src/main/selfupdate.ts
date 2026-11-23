/**
 * Spec 118 T010 (FR-004, FR-005, FR-006, FR-021, FR-024): Durbar's own update checker in main. The scheduler (the pure `cadenceDue`,
 * an injected clock and timer, at most one timer and only while the daily check is on), the request (only through `makeFeedGet`, for
 * the policy's or the baked slug), the result (in memory; only `updates.lastCheck`, versions and a time, is written) and the handlers
 * of the version-only IPC channels come with the second part of T010. Not wired into main.ts yet (dead code, tested). No Electron import:
 * `scripts/test-selfupdate-checker.ts` runs it.
 */
import { cadenceDue, decodeUtf8Strict, feedUrl, isBreaking, manualCheckAllowed, parseReleasesJson, pickTarget, releasesJsonUrl, selfCheckOn, selfPolicyView, snoozeState, validateFeed } from '../shared/selfupdate';
import type { Breaking, CadenceInput, Feed, ReleaseMarks, SelfPolicy, SelfUpdateSettings, SourceOrigin, UpdateSource } from '../shared/selfupdate';
import type { FeedFailure, FeedGet, FeedTimer } from './netget';

/** The settings store as the checker needs it (`SettingsStore` is one). */
export interface SelfUpdateStore { readonly updates: SelfUpdateSettings; setUpdates(patch: Partial<SelfUpdateSettings>): boolean }

export interface SelfUpdateDeps {
  /** `app.isPackaged`: a dev run never checks (FR-004). */
  packaged: boolean;
  simulator: boolean;
  /** `loadUpdateSource()`: the baked source; undefined = no check (FR-001). */
  source: UpdateSource | undefined;
  /** `app.getVersion()`. */
  running: string;
  /** `updatePolicy()`, read again before each request and when each answer arrives (FR-005). */
  policy(): SelfPolicy | undefined;
  store(): SelfUpdateStore | undefined;
  /** `makeFeedGet(electronRequestFactory())`: the only network path. */
  get: FeedGet;
  now(): number;
  timer: FeedTimer;
}

/** What the window may see as a failure: a closed set (FR-025). `aborted` never reaches it. */
export type SelfUpdateReason = Exclude<FeedFailure, 'aborted'> | 'feed-invalid';
/** Versions, booleans, times, the source slug and closed codes only (FR-024): no URL, path, header or feed text. */
export interface SelfUpdateView {
  shown: boolean; blocked: boolean; canCheck: boolean; dailyCheck: boolean; checking: boolean; running: string;
  source?: string; sourceBy?: 'built-in' | 'organization'; origin?: SourceOrigin;
  checkedAt?: number; latest?: string;
  state: 'none' | 'up-to-date' | 'newer' | 'update' | 'failed';
  target?: string; versions?: string[]; breaking?: Breaking; gap?: boolean; notice?: 'show' | 'snoozed' | 'skipped'; reason?: SelfUpdateReason;
}
interface Result { at: number; failed?: SelfUpdateReason; feed?: Feed; target?: string; versions?: string[]; newer?: boolean; breaking?: Breaking; gap?: boolean; marks?: ReleaseMarks }

/** *Check now* within this time of the last finished check answers the kept result (no loop a window could drive). */
export const MANUAL_GAP_MS = 60_000;
/** The app's timer (a test hands in a fake one). */
export const realSelfUpdateTimer: FeedTimer = { set: (cb, ms) => setTimeout(cb, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

export class SelfUpdater {
  private result: Result | undefined;
  private inflight: Promise<void> | undefined;
  private abort: AbortController | undefined;
  private handle: unknown;
  private started = false;

  constructor(private readonly d: SelfUpdateDeps) {}

  private input(): CadenceInput {
    const u = this.d.store()?.updates ?? {};
    return { now: this.d.now(), packaged: this.d.packaged, simulator: this.d.simulator, origin: this.d.source?.origin, selfCheck: u.selfCheck, policy: this.d.policy(), lastCheckAt: this.result?.at ?? u.lastCheck?.at };
  }
  private slug(): string | undefined {
    return selfPolicyView(this.d.policy()).feedSlug ?? this.d.source?.slug;
  }

  /** After the office is shown and the start-up detection is done (main.ts, with spec 081's start check). */
  start(): void {
    this.started = true;
    this.refresh();
  }

  /** The switch or the policy may have changed: a check no longer allowed is aborted; the timer is re-armed only while the daily check is on. */
  refresh(): void {
    if (this.handle !== undefined) { this.d.timer.clear(this.handle); this.handle = undefined; }
    if (!manualCheckAllowed(this.input())) this.abort?.abort();
    if (!this.started) return;
    const c = cadenceDue(this.input());
    if (c.waitMs === undefined) return;
    if (c.due) void this.run(false);
    this.handle = this.d.timer.set(() => { this.handle = undefined; this.refresh(); }, c.waitMs);
  }

  /** The Settings switch (its channel comes with the switch, T014). Off aborts a running check and disarms the timer. */
  setSelfCheck(on: unknown): boolean {
    if (typeof on !== 'boolean') return false;
    const saved = this.d.store()?.setUpdates({ selfCheck: on }) ?? false;
    if (!on) this.abort?.abort();
    this.refresh();
    return saved;
  }

  /** *Check now*: allowed with the switch off (FR-004), joins a running check, answers the kept result within `MANUAL_GAP_MS`. */
  async checkNow(): Promise<SelfUpdateView> {
    const i = this.input();
    const recent = this.result !== undefined && i.now >= this.result.at && i.now - this.result.at < MANUAL_GAP_MS;
    if (manualCheckAllowed(i) && (this.inflight || !recent)) {
      await this.run(true);
      this.refresh();
    }
    return this.view();
  }

  private run(manual: boolean): Promise<void> {
    if (this.inflight) return this.inflight;
    const p: Promise<void> = this.check(manual).finally(() => { if (this.inflight === p) { this.inflight = undefined; this.abort = undefined; } });
    this.inflight = p;
    return p;
  }

  private async check(manual: boolean): Promise<void> {
    const allowed = (): boolean => (manual ? manualCheckAllowed : selfCheckOn)(this.input());
    const slug = this.slug();
    const url = feedUrl(slug);
    if (!slug || !url || !allowed()) return;
    const ac = new AbortController();
    this.abort = ac;
    const live = (): boolean => !ac.signal.aborted && allowed();
    const list = await this.d.get(url, slug, ac.signal);
    if (!live()) return;
    if (!list.ok) { if (list.reason !== 'aborted') this.finish({ failed: list.reason }); return; }
    const text = decodeUtf8Strict(list.bytes); // fatal UTF-8, a byte-order mark kept (so JSON.parse refuses it)
    let json: unknown;
    try { json = text === undefined ? undefined : JSON.parse(text); } catch { json = undefined; }
    const feed = validateFeed(json, slug);
    // a page whose every stable entry failed the schema is not "up to date": it is a feed that could not be read
    if (!feed || (feed.releases.length === 0 && (feed.dropped.length > 0 || feed.unplaced))) { this.finish({ failed: 'feed-invalid' }); return; }
    const pick = pickTarget(this.d.running, feed);
    const raw = pick.target && releasesJsonUrl(slug, pick.target.tag);
    let marks: ReleaseMarks | undefined;
    if (raw) {
      const r = await this.d.get(raw, slug, ac.signal);
      if (!live()) return;
      marks = r.ok ? parseReleasesJson(decodeUtf8Strict(r.bytes)) : undefined;
    }
    this.finish({ feed, target: pick.target?.version, versions: pick.between.map((r) => r.version), newer: pick.installedNewer, breaking: pick.target ? isBreaking(this.d.running, pick, marks) : undefined, gap: pick.gap, marks });
  }

  /** Every check that ended is recorded (no retry loop, FR-004); `latest` only from a valid feed, else the last known one stays. */
  private finish(r: Omit<Result, 'at'>): void {
    const at = this.d.now();
    this.result = { at, ...r };
    const store = this.d.store();
    const latest = r.feed ? r.feed.releases[0]?.version : store?.updates.lastCheck?.latest;
    store?.setUpdates({ lastCheck: latest === undefined ? { at } : { at, latest } });
  }

  view(): SelfUpdateView {
    const i = this.input();
    const pv = selfPolicyView(i.policy);
    const base = { shown: false, blocked: pv.blocked, canCheck: manualCheckAllowed(i), dailyCheck: selfCheckOn(i), checking: this.inflight !== undefined, running: this.d.running, state: 'none' as SelfUpdateView['state'] };
    if (pv.hidden || !i.packaged || i.simulator || !this.d.source) return base;
    const u = this.d.store()?.updates ?? {};
    const r = this.result;
    const v: SelfUpdateView = { ...base, shown: true, origin: this.d.source.origin };
    if (!pv.blocked) { v.source = this.slug(); v.sourceBy = pv.feedSlug ? 'organization' : 'built-in'; }
    const checkedAt = r?.at ?? u.lastCheck?.at;
    if (checkedAt !== undefined) v.checkedAt = checkedAt;
    const latest = r?.feed ? r.feed.releases[0]?.version : u.lastCheck?.latest;
    if (latest !== undefined) v.latest = latest;
    if (r?.failed) { v.state = 'failed'; v.reason = r.failed; }
    else if (r?.target) Object.assign(v, { state: 'update', target: r.target, versions: r.versions, breaking: r.breaking, gap: r.gap, notice: snoozeState(i.now, r.target, u.snooze, u.skip) });
    else if (r) v.state = r.newer ? 'newer' : 'up-to-date';
    return v;
  }
}
