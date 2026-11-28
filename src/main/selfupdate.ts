/**
 * Spec 118 T010 (FR-004, FR-005, FR-006, FR-021, FR-024): Durbar's own update checker in main. The scheduler (the pure `cadenceDue`,
 * an injected clock and timer, at most one timer and only while the daily check is on), the request (only through `makeFeedGet`, for
 * the policy's or the baked slug), the result (in memory; only `updates.lastCheck`, versions and a time, is written) and the handlers
 * of the version-only IPC channels (`ipc/selfupdate.ts` wires them). T014 (FR-462..FR-464): main.ts starts it after the first load and refreshes it
 * on a wake from sleep (`wireSelfUpdateResume`); the switch, the dialog's text, the release page and one toast per version. No Electron import:
 * `scripts/test-selfupdate-checker.ts`, `scripts/test-selfupdate-ipc.ts` and `scripts/test-selfupdate-wiring.ts` run it.
 */
import { cadenceDue, decodeUtf8Strict, dialogNotes, feedUrl, isBreaking, manualCheckAllowed, notesText, parseReleasesJson, pickTarget, releasesJsonUrl, selfCheckOn, selfPolicyView, snoozeState, validateFeed, parseUpdatesPatch, parseRepoSlug, sameRepo, SNOOZE_MS } from '../shared/selfupdate';
import { redact } from '../shared/redact';
import { announceOnce } from '../shared/updatecheck';
import type { Breaking, CadenceInput, Feed, ReleaseNote, SelfPolicy, SelfUpdateSettings, SourceOrigin, UpdateSource } from '../shared/selfupdate';
import { MAX_VERSION_LENGTH } from '../shared/versionfield';
import { ShownError } from '../shared/shownerror';
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
  /** `updateFeedGet()` (`makeFeedGet` on the update session, T507): the only network path. */
  get: FeedGet;
  now(): number;
  timer: FeedTimer;
  /** T011: the native confirmation (`nativeConfirm` with the window); without it no source change is saved. */
  confirm?(o: { message: string; detail: string; ok: string }): Promise<boolean>;
  /** T014 (FR-462): the window is told of every finished check (`selfupdate:changed`); `announce` is the version to toast, once (FR-463). */
  changed?(v: SelfUpdateView & { announce?: string }): void;
  /** T014 (FR-462, FR-024): `shell.openExternal`, called only with a release's validated `html_url` from main's own feed. */
  openExternal?(url: string): unknown;
}

/** What the window may see as a failure: a closed set (FR-025). `aborted` never reaches it. */
export type SelfUpdateReason = Exclude<FeedFailure, 'aborted'> | 'feed-invalid';
/** Versions, booleans, times, the source slug and closed codes only (FR-024): no URL, path, header or feed text. */
export interface SelfUpdateView {
  shown: boolean; blocked: boolean; canCheck: boolean; dailyCheck: boolean; checking: boolean; running: string;
  source?: string; sourceBy?: 'built-in' | 'organization' | 'you'; origin?: SourceOrigin;
  checkedAt?: number; latest?: string;
  state: 'none' | 'up-to-date' | 'newer' | 'update' | 'failed';
  target?: string; versions?: string[]; breaking?: Breaking; gap?: boolean; notice?: 'show' | 'snoozed' | 'skipped'; reason?: SelfUpdateReason;
  /** Review of PR 2128, item 6: when a snooze ends, so the About line names the days left. */
  snoozeUntil?: number;
}
interface Result { at: number; slug: string; failed?: SelfUpdateReason; feed?: Feed; target?: string; versions?: string[]; newer?: boolean; breaking?: Breaking; gap?: boolean; marks?: ReadonlyMap<string, ReleaseNote> }
/** T014 (FR-464, FR-010): the dialog's text, already cleaned and capped in main (`dialogNotes`, `notesText`); the window shows it with `textContent`. */
export interface SelfUpdateNotes {
  running: string; target?: string; breaking?: Breaking; gap?: boolean; source?: string; sourceBy?: SelfUpdateView['sourceBy'];
  releases: { version: string; date: string; text: string; clipped: boolean }[];
  /** The breaking versions in the range, with the tag's `releases.json` words (FR-009). */
  marks: { version: string; notes: string; action: string }[];
}

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
  /** A check dropped because its source changed: a fresh one is considered when it settles. */
  private moved = false;
  /** T014 (FR-463): the version a finished daily check announces, sent with the next `changed`. */
  private announce: string | undefined;
  /** Review of PR 2128, item 2: a *Check now* joined the running check, so that check is a manual one (never a toast). */
  private manualJoin = false;
  /** Review of PR 2128, item 1: when the last request to a source STARTED (finished, failed or aborted alike), in memory only. */
  private attempt: { at: number; slug: string } | undefined;

  constructor(private readonly d: SelfUpdateDeps) {}

  private input(): CadenceInput {
    const u = this.d.store()?.updates ?? {};
    return { now: this.d.now(), packaged: this.d.packaged, simulator: this.d.simulator, origin: this.d.source?.origin, selfCheck: u.selfCheck, policy: this.d.policy(), lastCheckAt: this.current()?.at ?? u.lastCheck?.at };
  }
  /** FR-002, FR-003, FR-005: the organization's `feedUrl`, else the person's override (T011), else the built-in source. */
  private slug(): string | undefined {
    return selfPolicyView(this.d.policy()).feedSlug ?? (this.d.source ? this.d.store()?.updates.source : undefined) ?? this.d.source?.slug;
  }
  /** The kept result, only for the source in force now: another repository's result is never shown under this name. */
  private current(): Result | undefined {
    return this.result !== undefined && this.result.slug === this.slug() ? this.result : undefined;
  }

  /** Review of PR 2128, item 1: the time left before another request to the source in force may start (`MANUAL_GAP_MS` from the last START). */
  private gapLeft(anySource = false): number {
    const a = this.attempt;
    const now = this.d.now();
    // T596 (#2138): `setSource` asks with `anySource`: its read is for another repository, so the time counts whatever source it was recorded under
    if (!a || (!anySource && a.slug !== this.slug()) || now < a.at) return 0;
    return Math.max(0, MANUAL_GAP_MS - (now - a.at));
  }
  /** A running check that has not been aborted (a call joins it, no new request). */
  private joinable(): boolean {
    return this.inflight !== undefined && this.abort?.signal.aborted !== true;
  }
  /** Review of PR 2128, item 3 (FR-005): the organization turned updates off, or its policy cannot be read. */
  policyOff(): boolean {
    const pv = selfPolicyView(this.d.policy());
    return pv.hidden || pv.blocked;
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
    let wait = c.waitMs;
    if (c.due) {
      // review of PR 2128, item 1: a request started under a minute ago (even one aborted at once) holds the next one back; the timer comes back then
      const left = this.joinable() ? 0 : this.gapLeft();
      if (left > 0) wait = left;
      else void this.run(false);
    }
    this.handle = this.d.timer.set(() => { this.handle = undefined; this.refresh(); }, wait);
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
    const r = this.current();
    const recent = r !== undefined && i.now >= r.at && i.now - r.at < MANUAL_GAP_MS;
    const join = this.joinable();
    // review of PR 2128, item 1: at most one request START a minute, whatever became of the last one (an aborted check counts too)
    if (manualCheckAllowed(i) && (join || (!recent && this.gapLeft() === 0))) {
      if (join) this.manualJoin = true; // item 2: the joined check is now a manual one (no toast)
      await this.run(true);
      this.refresh();
    }
    return this.view();
  }

  private run(manual: boolean): Promise<void> {
    if (this.inflight && !this.abort?.signal.aborted) return this.inflight; // an aborted check is never joined: a fresh one starts
    const p: Promise<void> = this.check(manual).finally(() => {
      if (this.inflight === p) { this.inflight = undefined; this.abort = undefined; this.manualJoin = false; }
      if (this.moved) { this.moved = false; this.refresh(); }
      const announce = this.announce;
      this.announce = undefined;
      this.d.changed?.(announce !== undefined ? { ...this.view(), announce } : this.view()); // T014: the window repaints; a toast only with `announce`
    });
    this.inflight = p;
    return p;
  }

  private async check(manual: boolean): Promise<void> {
    const allowed = (): boolean => (manual ? manualCheckAllowed : selfCheckOn)(this.input());
    const slug = this.slug();
    const url = feedUrl(slug);
    if (!slug || !url || !allowed() || this.gapLeft() > 0) return; // the start gap, asked once more where the request is made
    this.attempt = { at: this.d.now(), slug };
    const ac = new AbortController();
    this.abort = ac;
    const moved = (): boolean => this.slug() !== slug && (this.moved = true);
    const live = (): boolean => !ac.signal.aborted && allowed() && !moved();
    const list = await this.d.get(url, slug, ac.signal);
    if (!live()) return;
    if (!list.ok) { if (list.reason !== 'aborted') this.finish({ slug, failed: list.reason }, manual); return; }
    const text = decodeUtf8Strict(list.bytes); // fatal UTF-8, a byte-order mark kept (so JSON.parse refuses it)
    let json: unknown;
    try { json = text === undefined ? undefined : JSON.parse(text); } catch { json = undefined; }
    const feed = validateFeed(json, slug);
    // a page whose every stable entry failed the schema is not "up to date": it is a feed that could not be read
    if (!feed || (feed.releases.length === 0 && (feed.dropped.length > 0 || feed.unplaced))) { this.finish({ slug, failed: 'feed-invalid' }, manual); return; }
    const pick = pickTarget(this.d.running, feed);
    const raw = pick.target && releasesJsonUrl(slug, pick.target.tag);
    let marks: ReadonlyMap<string, ReleaseNote> | undefined;
    if (raw) {
      const r = await this.d.get(raw, slug, ac.signal);
      if (!live()) return;
      marks = r.ok ? parseReleasesJson(decodeUtf8Strict(r.bytes)) : undefined;
    }
    this.finish({ slug, feed, target: pick.target?.version, versions: pick.between.map((r) => r.version), newer: pick.installedNewer, breaking: pick.target ? isBreaking(this.d.running, pick, marks) : undefined, gap: pick.gap, marks }, manual);
  }

  /** Every check that ended is recorded (no retry loop, FR-004); `latest` only from a valid feed, else the last known one stays. */
  private finish(r: Omit<Result, 'at'>, manual: boolean): void {
    const at = this.d.now();
    this.result = { at, ...r };
    const store = this.d.store();
    const latest = r.feed ? r.feed.releases[0]?.version : store?.updates.lastCheck?.latest;
    // a patch with a bad field is refused whole (FR-021): a feed version the strict rule does not take (leading zeros) is left out, the time kept
    store?.setUpdates({ lastCheck: latest !== undefined && parseUpdatesPatch({ lastCheck: { at, latest } }) ? { at, latest } : { at } });
    // T014 (FR-463): one toast per version, spec 081's rule (`announceOnce`); none while snoozed or skipped (FR-016); Check now saves it without one (the card says it)
    if (!r.target || !store) return;
    const u = store.updates;
    if (snoozeState(at, r.target, u.snooze, u.skip) !== 'show') return;
    const a = announceOnce(r.target, u.announced, manual || this.manualJoin);
    // a version the strict settings rule refuses (leading zeros) is never toasted: it could not be kept, so it would come again each day
    if (a.save !== undefined && parseUpdatesPatch({ announced: a.save }) && store.setUpdates({ announced: a.save }) && a.toast) this.announce = a.save;
  }

  /** Is `v` exactly a version of main's last validated feed (FR-024)? */
  hasVersion(v: string): boolean {
    if (this.policyOff()) return false; // review of PR 2128, item 3: no feed version counts while the policy turns updates off
    return this.current()?.feed?.releases.some((r) => r.version === v) === true; // the feed of the source in force only (review of PR 2073)
  }

  snooze(version: string): { ok: boolean; update: SelfUpdateView } {
    const ok = this.d.store()?.setUpdates({ snooze: { version, until: this.d.now() + SNOOZE_MS } }) ?? false;
    return { ok, update: this.view() };
  }

  skip(version: string): { ok: boolean; update: SelfUpdateView } {
    const ok = this.d.store()?.setUpdates({ skip: version }) ?? false;
    return { ok, update: this.view() };
  }

  private sourcing = false;

  /**
   * T011 (FR-003): `slug` is already the parsed pair (the handler parsed the text). Locked, not allowed or the same source: a closed code and
   * no request. Then the new source's list is read first (a failed read changes nothing), then the native confirmation; only a yes saves.
   */
  async setSource(slug: string): Promise<{ ok: boolean; reason?: SourceRefusal; update: SelfUpdateView }> {
    const answer = (ok: boolean, reason?: SourceRefusal) => ({ ok, ...(reason ? { reason } : {}), update: this.view() });
    // asked before the read, again after it (no dialog when it would be refused) and again after the dialog, right before the save
    const blocked = (): SourceRefusal | undefined => {
      const i = this.input();
      if (selfPolicyView(i.policy).feedSlug) return 'locked';
      return !manualCheckAllowed(i) || !this.d.source || !this.d.confirm ? 'not-allowed' : undefined;
    };
    const first = blocked();
    if (first) return answer(false, first);
    if (sameRepo(slug, this.slug())) return answer(true);
    if (this.sourcing) return answer(false, 'busy');
    // T596 (#2138): the read-first request is a request START like Check now's: the same `attempt` and `MANUAL_GAP_MS`. A call inside the minute gets
    // `busy` (as one while a read runs), no request, nothing changed; recorded under the source in force, so Check now and the daily check wait too.
    if (this.gapLeft(true) > 0) return answer(false, 'busy');
    this.attempt = { at: this.d.now(), slug: this.slug() ?? slug };
    this.sourcing = true;
    try {
      const url = feedUrl(slug);
      const r = url ? await this.d.get(url, slug) : { ok: false as const, reason: 'not-allowed' as const };
      if (!r.ok) return answer(false, r.reason === 'aborted' ? 'network' : r.reason);
      const text = decodeUtf8Strict(r.bytes);
      let json: unknown;
      try { json = text === undefined ? undefined : JSON.parse(text); } catch { json = undefined; }
      const feed = validateFeed(json, slug);
      if (!feed || (feed.releases.length === 0 && (feed.dropped.length > 0 || feed.unplaced))) return answer(false, 'feed-invalid');
      const afterRead = blocked();
      if (afterRead || !this.d.source || !this.d.confirm) return answer(false, afterRead ?? 'not-allowed');
      const builtIn = this.d.source.slug;
      let yes: boolean;
      try {
        yes = await this.d.confirm({
          message: `Get Durbar updates from ${slug}?`,
          detail: `Updates will then come from a repository you chose. Updates from ${slug} are made by whoever controls that GitHub repository, not by the makers of this build (${builtIn}). Durbar can only check that a download matches that repository's own list. Only switch to a repository you trust.`,
          ok: 'Use this source',
        });
      } catch { return answer(false, 'dialog-failed'); } // a dialog that fails is no yes
      if (!yes) return answer(false, 'declined');
      const afterDialog = blocked();
      if (afterDialog) return answer(false, afterDialog);
      const saved = this.d.store()?.setUpdates({ source: slug, lastCheck: undefined }) ?? false;
      this.refresh();
      return answer(saved, saved ? undefined : 'unsaved');
    } finally {
      this.sourcing = false;
    }
  }

  /** T011: back to the built-in source, without a read; the kept result of the override is dropped with it. */
  useBuiltInSource(): { ok: boolean; update: SelfUpdateView } {
    const ok = this.d.store()?.updates.source === undefined || (this.d.store()?.setUpdates({ source: undefined, lastCheck: undefined }) ?? false);
    this.refresh();
    return { ok, update: this.view() };
  }

  /** T014 (FR-464): the dialog's text for main's own target; nothing from the window chooses what is read. Empty without an update. */
  notes(): SelfUpdateNotes {
    const v = this.view();
    const r = this.current();
    if (this.policyOff() || v.state !== 'update' || !r?.feed || !r.versions) return { running: this.d.running, releases: [], marks: [] };
    const versions = r.versions;
    const rels = r.feed.releases.filter((x) => versions.includes(x.version));
    const texts = dialogNotes(rels);
    const marks = versions.flatMap((ver) => {
      const m = r.marks?.get(ver);
      return m?.breaking ? [{ version: ver, notes: notesText(m.notes).text, action: notesText(m.action).text }] : [];
    });
    return {
      running: this.d.running, target: v.target, breaking: v.breaking, gap: v.gap, source: v.source, sourceBy: v.sourceBy,
      releases: rels.map((x, i) => ({ version: x.version, date: x.publishedAt.slice(0, 10), text: texts[i].text, clipped: texts[i].clipped })),
      marks,
    };
  }

  /** T014 (FR-024): `version` is one of the kept feed (the handler checked it); only that release's validated `html_url` is opened. */
  async openReleasePage(version: string): Promise<{ ok: boolean }> {
    const rel = this.policyOff() ? undefined : this.current()?.feed?.releases.find((x) => x.version === version);
    if (!rel || !this.d.openExternal) return { ok: false };
    try { await this.d.openExternal(rel.htmlUrl); return { ok: true }; } catch { return { ok: false }; }
  }

  view(): SelfUpdateView {
    const i = this.input();
    const pv = selfPolicyView(i.policy);
    const base = { shown: false, blocked: pv.blocked, canCheck: manualCheckAllowed(i), dailyCheck: selfCheckOn(i), checking: this.inflight !== undefined, running: this.d.running, state: 'none' as SelfUpdateView['state'] };
    if (pv.hidden || !i.packaged || i.simulator || !this.d.source) return base;
    const u = this.d.store()?.updates ?? {};
    const r = this.current();
    const v: SelfUpdateView = { ...base, shown: true, origin: this.d.source.origin };
    // review of PR 2128, round 2 (FR-005): a policy that blocks the check (a feedUrl that is no github.com repository) offers no update and no
    // result: the dialog, toast and About never show an action that the policy would refuse (the same test as `policyOff`, `selfPolicyView`)
    if (pv.blocked) return v;
    v.source = this.slug(); v.sourceBy = pv.feedSlug ? 'organization' : u.source !== undefined ? 'you' : 'built-in';
    const checkedAt = r?.at ?? u.lastCheck?.at;
    if (checkedAt !== undefined) v.checkedAt = checkedAt;
    const latest = r?.feed ? r.feed.releases[0]?.version : u.lastCheck?.latest;
    if (latest !== undefined) v.latest = latest;
    if (r?.failed) { v.state = 'failed'; v.reason = r.failed; }
    else if (r?.target) {
      const notice = snoozeState(i.now, r.target, u.snooze, u.skip);
      Object.assign(v, { state: 'update', target: r.target, versions: r.versions, breaking: r.breaking, gap: r.gap, notice, ...(notice === 'snoozed' && u.snooze ? { snoozeUntil: u.snooze.until } : {}) });
    }
    else if (r) v.state = r.newer ? 'newer' : 'up-to-date';
    return v;
  }
}

/** T011: what a refused source change answers: closed codes, never the text that was sent. */
export type SourceRefusal = 'locked' | 'not-allowed' | 'busy' | 'declined' | 'dialog-failed' | 'unsaved' | SelfUpdateReason;
/** T011: the free text of `setSource` is capped before it is parsed. */
export const SOURCE_TEXT_MAX = 200;

/** The one refusal text of every forged call (FR-024): no echo of what was sent. */
export const SELFUPDATE_REFUSED = 'Agent Durbar refused this update request.';
const refuse = (): never => { throw new ShownError(SELFUPDATE_REFUSED); };

/**
 * FR-024: the handlers of `selfupdate:get`, `check`, `snooze(version)`, `skip(version)`, `setSource(text)`, `useBuiltInSource`, and (T014) `setDailyCheck(boolean)`,
 * `notes`, `openReleasePage(version)`. A channel that takes nothing refuses any argument; a
 * version channel takes exactly one string of at most 64 characters equal to a version of main's last validated feed. Nothing is read from
 * an argument before its type is checked, so a getter never runs.
 */
export function selfUpdateHandlers(checker: () => SelfUpdater | undefined) {
  const none = (a: unknown[]): SelfUpdater => {
    const c = checker();
    return c && a.length === 0 ? c : refuse();
  };
  // a version's shape only (exactly one string of at most 64 characters); the feed check comes after the policy check
  const shape = (a: unknown[]): [SelfUpdater, string] => {
    const c = checker();
    const v = a[0];
    return c && a.length === 1 && typeof v === 'string' && v.length <= MAX_VERSION_LENGTH ? [c, v] : refuse();
  };
  const version = (a: unknown[]): [SelfUpdater, string] => {
    const [c, v] = shape(a);
    return c.hasVersion(v) ? [c, v] : refuse();
  };
  // review of PR 2128, item 3 (FR-005): with updates off by policy, snooze, skip and the release page answer this plain result: nothing saved or opened
  const off = (a: unknown[]): SelfUpdater | undefined => { const [c] = shape(a); return c.policyOff() ? c : undefined; };
  const offAnswer = (c: SelfUpdater) => ({ ok: false, reason: 'policy-off' as const, update: c.view() });
  return {
    get: (...a: unknown[]) => none(a).view(),
    check: (...a: unknown[]) => none(a).checkNow(),
    snooze: (...a: unknown[]) => { const o = off(a); if (o) return offAnswer(o); const [c, v] = version(a); return c.snooze(v); },
    skip: (...a: unknown[]) => { const o = off(a); if (o) return offAnswer(o); const [c, v] = version(a); return c.skip(v); },
    // the ONE free-text channel (T011): capped, then only the parsed pair goes on; refused text is never echoed (the fixed text)
    setSource: (...a: unknown[]) => {
      const c = checker();
      const v = a[0];
      const slug = c && a.length === 1 && typeof v === 'string' && v.length <= SOURCE_TEXT_MAX ? parseRepoSlug(v) : undefined;
      // a pair the shared mask would change (token-shaped) is refused like text that does not parse: no request, nothing shown or saved
      return slug && c && redact(slug) === slug ? c.setSource(slug) : refuse();
    },
    useBuiltInSource: (...a: unknown[]) => none(a).useBuiltInSource(),
    // T014 (FR-462): the ONE boolean channel: exactly `true` or `false`, nothing read from anything else
    setDailyCheck: (...a: unknown[]) => {
      const c = checker();
      const on = a[0];
      if (!c || a.length !== 1 || typeof on !== 'boolean') return refuse();
      return { ok: c.setSelfCheck(on), update: c.view() };
    },
    notes: (...a: unknown[]) => none(a).notes(),
    openReleasePage: (...a: unknown[]) => { if (off(a)) return { ok: false, reason: 'policy-off' as const }; const [c, v] = version(a); return c.openReleasePage(v); },
  };
}

/** T014 (FR-462, review of PR 2073): a wake from sleep looks again at once, so a wall-clock jump past 24 h does not wait for the old timer. */
export function wireSelfUpdateResume(pm: { on(event: 'resume', cb: () => void): unknown }, checker: () => SelfUpdater | undefined): void {
  pm.on('resume', () => checker()?.refresh());
}
