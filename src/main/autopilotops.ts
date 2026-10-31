/**
 * Spec 099 Phase 3: main's side of Autopilot, with nothing of Electron in it: `test:autopilot-ipc` drives it on fake adapters. Main is the authority: the window's
 * form grants nothing (FR-055), and the one consent is the native dialog, asked here with text written here from main's own state (D12).
 *
 * `enabled` is false in the default build (spec *Changes*, Phase 3 gate): turning on refuses before anything else, so nothing below is reachable there.
 * Stopping needs no gate, and acts before anything is awaited (FR-050): a person can always get down.
 */
import { AUTOPILOT_ENDS, DEFAULT_HOURS, DEFAULT_LIMIT, hoursWarn, limitWarns, MAX_HOURS, MAX_LIMIT, MIN_HOURS, NO_PROGRESS_AFTER, validHours, validLimit } from '../adapters/autopilot';
import { LINE_CLOSED, LINE_UNCONFIRMED } from '../adapters/autopilotHost';
import { eventProblems } from '../adapters/eventguard';
import type { AdapterRouter } from '../adapters/router';
import type { AgentEvent, AutopilotEnd, AutopilotEvent, AutopilotSettings } from '../adapters/types';
import type { AgentInfo, PermMode } from '../shared/api';
import { HIDDEN_ALL_RE } from '../shared/names';
import { redact } from '../shared/redact';
import { errText, setModeOp } from './agentops';
import type { OpsDeps } from './agentops';

type Unit = 'aiu' | 'usd' | 'tokens';
export type AutopilotResult = { ok: boolean; error?: string; cancelled?: true; mode?: PermMode; autopilot?: AgentInfo['autopilot']; pending?: number; note?: string };

export const NOT_AVAILABLE = 'Autopilot is not available yet.';
export const REMOTE_ON = 'Stop remote control first: Autopilot and remote control from GitHub are never on together.';
export const ORG_UNREAD = "Durbar could not read your organization's policy for this agent app, so it cannot start Autopilot. Try again in a moment.";
export const CHANGED = 'This session changed while you were deciding, so Autopilot did not start. Choose it again.';
export const WARN_LIMIT = 'Above 20 extra turns, this run can spend much more before it stops.';
export const WARN_HOURS = 'Above 2 hours, this run can spend much more before it stops.';
export const NOT_VERIFIED = 'Not verified on a real session yet.';
export const COPILOT_MIN_CAP = 30;
/** FR-072 (proposed): the dialog warns when this many or more are already on Autopilot. */
export const SESSIONS_WARN_FROM = 3;

/** What main puts in a native dialog: one plain line, no control or hidden characters a folder or an agent's name could carry. */
export function plainLine(v: unknown, max = 120): string {
  const s = String(v ?? '').replace(HIDDEN_ALL_RE, '').replace(/[‎‏؜⁪-⁯]|[\u{e0000}-\u{e007f}]/gu, '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export const capWords = (unit: Unit, v: number): string => (unit === 'usd' ? `$${v} (Claude's estimate)` : unit === 'tokens' ? `${v} tokens` : `${v} AI credits`);

/** The window's values, read here: only exact numbers in their bounds, never a string. Returns the settings or the refusal. */
export function readSettings(raw: unknown, unit: Unit | null): { ok: true; settings: AutopilotSettings; raised?: true } | { ok: false; error: string } {
  const x = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : undefined) as { limit?: unknown; hours?: unknown; cap?: unknown } | undefined;
  if (!x) return { ok: false, error: 'Invalid Autopilot settings.' };
  const limit = x.limit === undefined ? DEFAULT_LIMIT : x.limit;
  if (!validLimit(limit)) return { ok: false, error: `The turn limit must be a whole number from 1 to ${MAX_LIMIT}.` };
  const hours = x.hours === undefined ? DEFAULT_HOURS : x.hours;
  if (!validHours(hours)) return { ok: false, error: `The time limit must be from ${MIN_HOURS} to ${MAX_HOURS} hours.` };
  const settings: AutopilotSettings = { limit, hours };
  if (x.cap === undefined || x.cap === null) return { ok: true, settings };
  if (unit === null) return { ok: false, error: 'This agent app has no spend cap.' };
  const c = x.cap;
  if (typeof c !== 'number' || !Number.isFinite(c) || c <= 0) return { ok: false, error: 'The spend cap must be a number above 0.' };
  if (unit === 'tokens' && !Number.isInteger(c)) return { ok: false, error: 'The spend cap must be a whole number of tokens.' };
  if (unit === 'usd' && c < 0.01) return { ok: false, error: 'The spend cap must be at least $0.01.' };
  if (unit === 'aiu' && c < COPILOT_MIN_CAP) return { ok: true, settings: { ...settings, cap: COPILOT_MIN_CAP }, raised: true }; // D9
  return { ok: true, settings: { ...settings, cap: c } };
}

export interface DialogFacts {
  name: string;
  app: string;
  folder: string;
  mode: PermMode;
  settings: AutopilotSettings;
  raised?: boolean;
  unit: Unit | null;
  /** What the session has spent, in `unit`, where main saw it. */
  spent?: number;
  /** The session's own cap (`a.maxAiCredits`). */
  ownCap?: number;
  others: number;
  sandboxOff?: boolean;
  verified: boolean;
}

/** FR-055: the native dialog, written from main's state and the validated values, never from page text. */
export function dialogText(f: DialogFacts): { message: string; detail: string; ok: string } {
  const app = plainLine(f.app, 60) || 'The agent app';
  const folder = plainLine(f.folder, 200) || 'this folder';
  const s = f.settings;
  const hours = s.hours ?? DEFAULT_HOURS;
  const parts: string[] = [
    `${app} will keep working on each message until it judges the task done, without stopping for you. Edits, shell commands, web requests and tools run without asking, in ${folder}. When it has a question, it decides by itself. Nothing is undone automatically. Stop ends Autopilot at once.`,
  ];
  if (f.mode !== 'allow') {
    const was = f.mode === 'ask' ? 'Ask first' : 'Read-only';
    parts.push(`This also changes ${folder} from ${was} to Allow all, and it stays Allow all after Autopilot ends. New sessions in ${folder} start in Allow all.${f.sandboxOff ? ` ${app}’s OS sandbox is also turned off for this session.` : ''}`);
  }
  const lines = [`Up to ${s.limit} more turn${s.limit === 1 ? '' : 's'} per message, for at most ${hours} hour${hours === 1 ? '' : 's'}.`];
  if (limitWarns(s.limit)) lines.push(WARN_LIMIT);
  if (hoursWarn(hours)) lines.push(WARN_HOURS);
  const spent = f.unit && f.spent !== undefined ? capWords(f.unit, Math.round(f.spent * 1e4) / 1e4) : undefined;
  if (s.cap !== undefined && f.unit) {
    if (f.unit === 'tokens') lines.push(`Spend cap: ${capWords(f.unit, s.cap)} for this run. Codex finishes the turn it is in, so it can go a little over.`);
    else lines.push(`Spend cap: ${capWords(f.unit, s.cap)} for this session in total${spent ? ` (${spent} so far)` : ''}.`);
    if (f.raised) lines.push("Copilot's smallest cap is 30 AI credits, so Autopilot uses 30.");
    if (f.ownCap !== undefined && f.ownCap < s.cap) lines.push(`This session's limit of ${capWords(f.unit, f.ownCap)} is lower, so it stays in force.`);
  } else {
    lines.push(`No spend cap: Autopilot stops when the task is done, at the turn limit, after ${hours} hour${hours === 1 ? '' : 's'}, when it makes no progress, or when you press Stop.`);
    if (f.ownCap !== undefined && f.unit) lines.push(`This session's limit of ${capWords(f.unit, f.ownCap)} still applies.`);
    if (spent) lines.push(`Spent so far in this session: ${spent}.`);
  }
  if (f.others >= SESSIONS_WARN_FROM) lines.push(`${f.others} sessions are already on Autopilot. Each one spends on its own.`);
  if (!f.verified) lines.push(NOT_VERIFIED);
  parts.push(lines.join('\n'));
  return { message: `Autopilot for ${plainLine(f.name, 80) || 'this session'}?`, detail: parts.join('\n\n'), ok: 'Start Autopilot' };
}

/** The organization's verdict on Autopilot: a refusal's words, or none. A read that failed or never came refuses too (FR-070, spec *Changes*). */
export type OrgRead = (a: AgentInfo) => Promise<string | undefined>;

export interface AutopilotOpsDeps {
  agents: Map<string, AgentInfo>;
  router: Pick<AdapterRouter, 'forAgent'>;
  ops: OpsDeps;
  /** False in the default build: `AUTOPILOT_WIRED || autopilotTestGate(...)`. */
  enabled(): boolean;
  /** Remote control is on, or on its way (`remoteOps.engaged`). */
  remoteOn(id: string): boolean;
  org: OrgRead;
  confirm(o: { message: string; detail: string; ok: string }): Promise<boolean>;
  ensureLive(a: AgentInfo): Promise<void>;
  appName(a: AgentInfo): string;
  folderLabel(a: AgentInfo): string;
  /** FR-023: the folders' fingerprint through the read-only git runner; `null`: not a git folder; rejects or undefined: not known. */
  fingerprint?(a: AgentInfo): Promise<string | null | undefined>;
  log?(a: AgentInfo, decision: 'autopilot-on' | 'autopilot-end' | 'autopilot-off', action: string): void;
  /** A line in the chat. */
  say?(a: AgentInfo, line: string, err?: boolean): void;
  rememberLimit?(limit: number): void;
  warn?(line: string): void;
  now?(): number;
}

interface Turning { stopped: boolean }
interface Progress { runId: string; last?: string | null; have: boolean; unchanged: number; activity: boolean; chain: Promise<void> }

/** FR-082: a masked, cut log line for a bad event; the event's text is never logged as it came. */
const problemLine = (p: string[]): string => plainLine(redact(p.join('; ')), 300);

export function createAutopilotOps(d: AutopilotOpsDeps) {
  const turning = new Map<string, Turning>();
  const spend = new Map<string, Record<Unit, number>>();
  const progress = new Map<string, Progress>();
  const now = (): number => (d.now ? d.now() : Date.now());
  const say = (a: AgentInfo, line: string, err?: boolean): void => d.say?.(a, line, err);
  const spentOf = (id: string, unit: Unit | null): number | undefined => (unit && unit !== 'tokens' ? spend.get(id)?.[unit] : undefined);
  const refuse = (error: string): AutopilotResult => ({ ok: false, error });

  /** Main's state down, now. The adapter's `ended` event may follow; the window's next look already reads the truth. */
  const dropState = (a: AgentInfo, how: string): void => {
    if (!a.autopilot) return;
    const hadRun = !!a.autopilot.run;
    a.autopilot = undefined;
    if (!hadRun) d.log?.(a, 'autopilot-off', how); // with a run, its `ended` event logs the end
  };

  /** FR-054: the stop could not be confirmed. A known state whatever happens: Allow all, no Autopilot, the session's process gone. */
  const failClosed = async (a: AgentInfo): Promise<void> => {
    const ad = d.router.forAgent(a.id);
    await Promise.resolve().then(() => ad?.stop(a.id)).catch(() => undefined);
    say(a, LINE_UNCONFIRMED, true);
  };

  /** FR-050, FR-051: everything that happens before the first await is the stop. Also ends a turning-on that is under way. */
  const off = (id: string, reason: AutopilotEnd = 'stopped'): Promise<AutopilotResult> => {
    const t = turning.get(id);
    if (t) t.stopped = true;
    const a = d.agents.get(id);
    const ad = a ? d.router.forAgent(a.id) : undefined;
    if (!a || !ad) return Promise.resolve(refuse('unknown agent'));
    if (!a.autopilot) return Promise.resolve({ ok: true, mode: a.permMode });
    const asked = reason === 'no-progress' ? 'no progress' : 'Turned off';
    dropState(a, asked);
    const stopped = (async () => ad.setAutopilot?.(a.id, null, reason))(); // the adapter's own sync part runs here, before anything else
    return stopped.then(() => ({ ok: true, mode: a.permMode }), async (err: unknown) => {
      await failClosed(a);
      return { ok: true, mode: a.permMode, note: plainLine(errText(err), 200) };
    });
  };

  /** Everything checked again where an await has passed. Returns the refusal. */
  const recheck = (a: AgentInfo, ad: unknown, t: Turning, mode: PermMode): string | undefined => {
    if (!d.enabled()) return NOT_AVAILABLE;
    if (t.stopped || d.agents.get(a.id) !== a || d.router.forAgent(a.id) !== ad || a.permMode !== mode) return CHANGED;
    if (d.remoteOn(a.id)) return REMOTE_ON;
    return undefined;
  };

  const on = async (id: unknown, raw: unknown): Promise<AutopilotResult> => {
    if (!d.enabled()) return refuse(NOT_AVAILABLE);
    const a = typeof id === 'string' ? d.agents.get(id) : undefined;
    const ad = a ? d.router.forAgent(a.id) : undefined;
    if (!a || !ad) return refuse('unknown agent');
    const cap = ad.capabilities?.autopilot;
    if (!cap || typeof ad.setAutopilot !== 'function') return refuse('This agent app has no Autopilot.');
    if (a.autopilot) return refuse('This session is already on Autopilot.');
    if (turning.has(a.id)) return refuse('Autopilot is already being turned on for this session.');
    const unit = cap.capUnit;
    const read = readSettings(raw, unit);
    if (!read.ok) return refuse(read.error);
    const settings = read.settings;
    const spent = spentOf(a.id, unit);
    if (settings.cap !== undefined && unit && spent !== undefined && settings.cap <= spent) return refuse(`A cap of ${capWords(unit, settings.cap)} is not above what this session has spent (${capWords(unit, Math.round(spent * 1e4) / 1e4)}).`);
    if (d.remoteOn(a.id)) return refuse(REMOTE_ON);
    const mode = a.permMode;
    const t: Turning = { stopped: false };
    turning.set(a.id, t);
    try {
      const no = await d.org(a).catch(() => ORG_UNREAD); // a read that failed refuses, never fails open
      if (no) return refuse(no);
      let bad = recheck(a, ad, t, mode);
      if (bad) return refuse(bad);
      const text = dialogText({
        name: a.alias || a.label || a.name, app: d.appName(a), folder: d.folderLabel(a), mode, settings, raised: read.raised, unit, spent,
        ownCap: unit && unit !== 'tokens' ? a.maxAiCredits : undefined, others: [...d.agents.values()].filter((x) => x.autopilot).length,
        sandboxOff: !!(a.sandbox && a.sandbox.heldFloor && !a.sandbox.managed && !a.sandbox.untilNewSession), verified: cap.verified === true,
      });
      if (!(await d.confirm(text))) return { ok: false, cancelled: true, error: 'Cancelled.' }; // nothing has changed yet
      if (!ad.isLive(a.id)) await d.ensureLive(a); // a resume sends nothing
      const after = await d.org(a).catch(() => ORG_UNREAD); // the policy may have changed behind the dialog
      if (after) return refuse(after);
      // from here to the adapter's call there is no await: remote control, a stop or a mode change during the dialog are all seen here
      bad = recheck(a, ad, t, mode);
      if (bad) return refuse(bad);
      let pending: number | undefined;
      if (mode !== 'allow') {
        const r = setModeOp(d.ops, a.id, 'allow', {}); // saves Allow all as the folder's mode, which the dialog said; waiting requests stay waiting (spec *Changes*)
        if (!r.ok) return refuse(r.error ?? 'Could not change the mode.');
        pending = r.pending;
      }
      try {
        await ad.setAutopilot(a.id, settings);
      } catch (err) {
        if (mode !== 'allow') say(a, `Autopilot did not start, and this session and its folder stay in Allow all: ${plainLine(errText(err), 200)}`, true);
        return { ...refuse(plainLine(errText(err), 300)), mode: a.permMode };
      }
      if (t.stopped || d.remoteOn(a.id) || a.permMode !== 'allow' || d.agents.get(a.id) !== a) {
        await Promise.resolve().then(() => ad.setAutopilot?.(a.id, null, 'stopped')).catch(() => failClosed(a));
        return { ...refuse(d.remoteOn(a.id) ? REMOTE_ON : CHANGED), mode: a.permMode };
      }
      a.autopilot = { limit: settings.limit, hours: settings.hours ?? DEFAULT_HOURS, ...(settings.cap !== undefined ? { cap: settings.cap } : {}) };
      d.log?.(a, 'autopilot-on', `Autopilot on: up to ${settings.limit} more turns, ${settings.cap !== undefined && unit ? capWords(unit, settings.cap) : 'no spend cap'}`);
      d.rememberLimit?.(settings.limit);
      return { ok: true, mode: a.permMode, autopilot: a.autopilot, ...(pending ? { pending } : {}) };
    } catch (err) {
      return refuse(plainLine(errText(err), 300));
    } finally {
      turning.delete(a.id);
    }
  };

  /** FR-023: the fingerprint at a run's start and at each continuation, one at a time per run. Two unchanged in a row end the run. */
  const noteProgress = (a: AgentInfo, e: AutopilotEvent): void => {
    if (!d.fingerprint) return;
    let p = progress.get(a.id);
    if (e.phase === 'started' || !p || p.runId !== e.runId) {
      p = { runId: e.runId, have: false, unchanged: 0, activity: false, chain: Promise.resolve() };
      progress.set(a.id, p);
    }
    const run = p;
    const isStart = e.phase === 'started';
    const sawActivity = run.activity;
    run.activity = false;
    run.chain = run.chain.then(async () => {
      const fp = await d.fingerprint!(a).catch(() => undefined);
      if (progress.get(a.id) !== run) return; // the run ended meanwhile
      if (isStart) { run.last = fp; run.have = fp !== undefined; return; }
      // a fingerprint that cannot be read says nothing: it counts as progress (spec *Changes*)
      let same: boolean;
      if (fp === undefined || !run.have) same = false;
      else if (fp === null) same = !sawActivity; // not a git folder: no write or edit, no shell command (FR-023)
      else same = fp === run.last;
      run.last = fp;
      run.have = fp !== undefined;
      run.unchanged = same ? run.unchanged + 1 : 0;
      if (run.unchanged >= NO_PROGRESS_AFTER) await off(a.id, 'no-progress');
    });
  };

  return {
    enabled: (): boolean => d.enabled(),
    setAutopilot: (id: unknown, settings: unknown): Promise<AutopilotResult> => {
      if (settings === null) return typeof id === 'string' ? off(id) : Promise.resolve(refuse('unknown agent'));
      return on(id, settings);
    },
    off,
    /** `setModeOp`: a mode chosen on Autopilot ends it first (FR-051); before anything is awaited. */
    endForMode: (a: AgentInfo): void => { void off(a.id); },
    /** `agents:stop`: the adapter's interrupt is its own stop order, so only main's state comes down here. */
    stopSeen: (id: string): void => {
      const t = turning.get(id);
      if (t) t.stopped = true;
      const a = d.agents.get(id);
      if (a) dropState(a, 'Stopped');
    },
    /** A session is on Autopilot or on its way (the schedulers, remote control). */
    engaged: (id: string): boolean => !!d.agents.get(id)?.autopilot || turning.has(id),
    /** T098: Stop, and only Stop, from a remote or phone control. No transport reaches this yet (spec *Changes*): `[KNOWN GAP]`. */
    remoteStop: async (id: unknown, request: unknown): Promise<AutopilotResult> => {
      const x = request as { kind?: unknown } | null | undefined;
      if (!x || typeof x !== 'object' || x.kind !== 'stop' || Object.keys(x).length !== 1 || typeof id !== 'string') return refuse('Only Stop is accepted here.');
      const a = d.agents.get(id);
      if (!a?.autopilot) return refuse('This session is not on Autopilot.');
      return off(id, 'stopped');
    },
    /**
     * FR-082: main's check on every `autopilot` event and `question.autoAnswered` before anything uses or forwards it. False drops it, with a masked log line.
     * FR-008: a helper's event is not the session's. A question "decided" on a session main does not have on Autopilot would hide the buttons of one that waits.
     */
    accepts: (e: AgentEvent): boolean => {
      const raw = e as unknown as { type?: unknown; autoAnswered?: unknown; agentId?: unknown; sessionId?: unknown };
      const auto = raw.type === 'autopilot';
      const q = raw.type === 'question' && 'autoAnswered' in raw;
      if (!auto && !q) return true;
      const problems = eventProblems(e);
      const a = typeof raw.sessionId === 'string' ? d.agents.get(raw.sessionId) : undefined;
      if (!problems.length && raw.agentId !== undefined) problems.push(`${String(raw.type)} from a helper`);
      if (!problems.length && !a) problems.push(`${String(raw.type)} for an unknown session`);
      if (!problems.length && q && !a?.autopilot) problems.push('question.autoAnswered on a session not on Autopilot');
      if (!problems.length && auto && (e as AutopilotEvent).phase !== 'ended' && !a?.autopilot) problems.push('autopilot event on a session not on Autopilot');
      if (!problems.length) return true;
      d.warn?.(`[autopilot] dropped a bad event: ${problemLine(problems)}`);
      return false;
    },
    /** Main's state follows the (checked) events. Every way a session ends comes through here. */
    onEvent: (e: AgentEvent): void => {
      if (e.agentId) return;
      const a = d.agents.get(e.sessionId);
      if (e.type === 'status' && (e.status === 'stopped' || e.intent === LINE_CLOSED)) {
        // FR-005, FR-052: no card and no event, but the session is no longer on Autopilot
        if (e.status === 'stopped') spend.delete(e.sessionId);
        progress.delete(e.sessionId);
        if (a) dropState(a, 'The session closed');
        return;
      }
      if (e.type === 'usage') {
        const s = spend.get(e.sessionId) ?? { aiu: 0, usd: 0, tokens: 0 };
        s.aiu += typeof e.nanoAiu === 'number' && e.nanoAiu > 0 ? e.nanoAiu / 1e9 : 0;
        s.usd += typeof e.costUsd === 'number' && e.costUsd > 0 ? e.costUsd : 0;
        spend.set(e.sessionId, s);
        return;
      }
      if (e.type === 'toolCall') {
        const p = progress.get(e.sessionId);
        if (p && e.phase === 'start' && (e.edit || /^(bash|shell|powershell|run_in_terminal|commandexecution|exec)/i.test(e.tool))) p.activity = true;
        return;
      }
      if (e.type !== 'autopilot' || !a) return;
      if (e.phase === 'ended') {
        progress.delete(a.id);
        if (a.autopilot) {
          a.autopilot.run = undefined;
          if (e.reason !== 'done') a.autopilot = undefined; // S3, D8
        }
        d.log?.(a, 'autopilot-end', `Autopilot ended: ${(AUTOPILOT_ENDS as readonly string[]).includes(String(e.reason)) ? e.reason : 'error'}, after ${e.n} more turn${e.n === 1 ? '' : 's'}`);
        return;
      }
      if (!a.autopilot) return;
      a.autopilot.run = e.phase === 'started' ? { continuation: 0, startedAt: now() } : { continuation: e.n, startedAt: a.autopilot.run?.startedAt ?? now() };
      noteProgress(a, e);
    },
    /** The session is gone (End session, removed): nothing of it stays. */
    forget: (id: string): void => {
      progress.delete(id);
      spend.delete(id);
      const a = d.agents.get(id);
      if (a) a.autopilot = undefined;
    },
  };
}

export type AutopilotOps = ReturnType<typeof createAutopilotOps>;

/** The window's list of agent apps: no `autopilot` capability while it is off, so no surface offers it. */
export function windowAdapters<T extends { capabilities?: unknown }>(list: T[], enabled: boolean): T[] {
  if (enabled) return list;
  return list.map((i) => {
    const c = i.capabilities as Record<string, unknown> | undefined;
    if (!c || !('autopilot' in c)) return i;
    const { autopilot: _gone, ...rest } = c;
    return { ...i, capabilities: rest };
  });
}
