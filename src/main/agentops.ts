/**
 * The bodies of the IPC handlers that decide what happens when an agent's adapter lacks a member, plus the restore filter
 * (spec 012 FR-054). Moved verbatim from `main.ts` and `mcpipc.ts` so they can be tested: no Electron, no file system.
 */
import type { AdapterRouter } from '../adapters/router';
import type { AgentAdapter, AgentMessage } from '../adapters/types';
import { interruptOf, refusesLive, setCapOf, setMcpEnabledOf, setPermModeOf } from '../adapters/router';
import { parseCapIn } from '../shared/credits';
import { readAnswerPayload } from '../adapters/questions';
import type { AgentInfo, PermMode } from '../shared/api';
import { adapterOf, modeForSession } from './folders';
import type { FolderStore, SavedFolder } from './folders';

export interface OpsDeps {
  agents: Map<string, AgentInfo>;
  router: Pick<AdapterRouter, 'forAgent'>;
  store?: Pick<FolderStore, 'setPermMode' | 'setMaxAiCredits' | 'setSessionMode'>;
  wsKey(a: AgentInfo): string;
  /** The id the session is resumed under (Codex: its thread id); its mode is remembered under it (spec 003, 2026-10-21). Default: the agent id. */
  sessionKey?(a: AgentInfo): string;
  /** Local activity log (spec 052 FR-071): one row per applied mode or limit change. Recorded here, in main, never by the window. */
  log?(a: AgentInfo, decision: 'mode-change' | 'limit-change', action: string): void;
}

const MODE_WORDS: Record<PermMode, string> = { 'read-only': 'Read-only', ask: 'Ask first', allow: 'Allow all' };

const NO_INTERRUPT = 'This agent cannot stop a running turn. End the session instead.';
const NO_LIVE_SETTING = 'This agent cannot change that setting while its session is running. Start a new session with it.';
export const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
export const validMode = (m: unknown): PermMode => (m === 'ask' || m === 'allow' ? m : 'read-only');
const trunc = (v: unknown, n: number): string => String(v ?? '').slice(0, n);

/** `agents:setMode`. */
export function setModeOp(d: OpsDeps, id: unknown, mode: unknown, opts: unknown): { ok: boolean; error?: string; mode?: PermMode; pending?: number } {
  const { agents, router } = d;
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  const ad = a ? router.forAgent(a.id) : undefined;
  if (!a || !ad) return { ok: false, error: 'unknown agent' };
  const o = (opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>;
  const m = validMode(mode);
  const r = setPermModeOf(ad, a.id, m, { clearGrants: o.clearGrants === true, approvePending: o.approvePending === true });
  // A live session that cannot switch keeps its old mode: say so and save nothing (constitution III, spec 012 FR-050). Not live: it applies at the next start.
  if (refusesLive(ad, a.id, r.applied)) return { ok: false, error: NO_LIVE_SETTING };
  const was = a.permMode;
  a.permMode = m;
  a.permRestored = undefined; // a fresh choice, no longer "restored"
  a.permFrom = undefined;
  d.store?.setPermMode(d.wsKey(a), m); // the folder's mode: new sessions and sessions with nothing remembered
  d.store?.setSessionMode(d.wsKey(a), d.sessionKey?.(a) ?? a.id, m); // this session's own mode (spec 003, 2026-10-21)
  const extra = [o.clearGrants === true ? 'session permissions cleared' : '', o.approvePending === true && m === 'allow' ? 'waiting requests approved' : ''].filter(Boolean).join(', ');
  d.log?.(a, 'mode-change', `${MODE_WORDS[validMode(was)]} to ${MODE_WORDS[m]}${extra ? ` (${extra})` : ''}`);
  return { ok: true, mode: m, pending: r.pending };
}

/**
 * Spec 003 (2026-10-21): the mode a session resumed from Previous sessions starts in. Its own remembered mode wins over the mode of
 * the session the list was opened from; the chat and the activity log say so when the two differ (a mode never changes unseen).
 */
export function resumeModeOp(saved: Pick<SavedFolder, 'sessionModes'> | undefined, sessionId: string, opener: PermMode): { mode: PermMode; permFrom: 'session' | 'opener'; permRestored?: true; modeWas?: PermMode; logLine?: string } {
  const sm = modeForSession(saved, [sessionId], opener);
  const modeWas = sm.mode !== opener ? opener : undefined;
  return {
    mode: sm.mode,
    permFrom: sm.fromSession ? 'session' : 'opener',
    ...(sm.fromSession && sm.mode === 'allow' ? { permRestored: true as const } : {}),
    ...(modeWas ? { modeWas, logLine: `Resumed in ${MODE_WORDS[sm.mode]}, the mode last chosen for this session (opened from a session in ${MODE_WORDS[modeWas]})` } : {}),
  };
}

/** `agents:setCap`. */
export async function setCapOp(d: OpsDeps, id: unknown, credits: unknown): Promise<{ ok: boolean; error?: string; maxAiCredits?: number }> {
  const { agents, router } = d;
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  const ad = a ? router.forAgent(a.id) : undefined;
  if (!a || !ad) return { ok: false, error: 'unknown agent' };
  const usd = ad.capabilities?.capUnit === 'usd';
  const cap = credits === null ? undefined : parseCapIn(ad.capabilities?.capUnit, credits);
  if (credits !== null && cap === undefined) return { ok: false, error: usd ? 'The spending limit must be at least $0.01.' : 'The spending limit must be a number of at least 30 AI credits (the runtime minimum).' };
  try {
    // Not started yet: nothing to change now, the cap goes in the start options. A live session whose adapter cannot take it is refused, not saved (spec 012 FR-050).
    if (ad.isLive(a.id) && refusesLive(ad, a.id, await setCapOf(ad, a.id, cap ?? null))) return { ok: false, error: NO_LIVE_SETTING };
    a.maxAiCredits = cap;
    if (!usd) d.store?.setMaxAiCredits(d.wsKey(a), cap); // a dollar cap is per session only (FR-150)
    d.log?.(a, 'limit-change', cap === undefined ? 'Spending limit removed' : `Spending limit set to ${usd ? `$${cap.toFixed(2)}` : `${cap} AI credits`}`);
    return { ok: true, maxAiCredits: cap };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
}

/** `agents:stop`: interrupts the running turn only. */
export async function stopTurnOp(d: OpsDeps, id: string): Promise<{ ok: false; error: string } | undefined> {
  const ad = d.agents.has(id) ? d.router.forAgent(id) : undefined;
  if (ad && refusesLive(ad, id, await interruptOf(ad, id))) return { ok: false, error: NO_INTERRUPT };
}

/**
 * `agents:answerQuestion` (spec 012 FR-128; spec 052 FR-178): the window's answer to an agent's question goes to the adapter as it was given.
 * Strings only, capped (`readAnswerPayload`); `null` is a skip; an answer with nothing usable is refused, never turned into a skip.
 */
export function answerQuestionOp(d: Pick<OpsDeps, 'agents' | 'router'>, id: unknown, requestId: unknown, answers: unknown): { ok: boolean; error?: string } {
  const a = typeof id === 'string' ? d.agents.get(id) : undefined;
  const ad = a ? d.router.forAgent(a.id) : undefined;
  if (!a || !ad?.answerQuestion || typeof requestId !== 'string' || requestId.length > 200) return { ok: false, error: 'unknown agent or question' };
  const clean = readAnswerPayload(answers);
  if (clean === undefined) return { ok: false, error: 'That answer could not be read. Try again, or Skip.' };
  ad.answerQuestion(a.id, requestId, clean);
  return { ok: true };
}

/** `agents:setMcp`; `off` holds, per agent id, the servers switched off for this run. */
export async function setMcpOp(d: OpsDeps, off: Map<string, Set<string>>, id: unknown, name: unknown, enabled: unknown): Promise<{ ok: boolean; error?: string }> {
  const a = typeof id === 'string' ? d.agents.get(id) : undefined;
  if (!a || typeof name !== 'string' || !name || name.length > 64) return { ok: false, error: 'unknown agent or server' };
  const ad = d.router.forAgent(a.id);
  // A live session whose adapter cannot switch servers keeps them as they are: refuse and save nothing (spec 012 FR-050).
  if (ad && refusesLive(ad, a.id, !!ad.setMcpEnabled)) return { ok: false, error: 'This agent cannot switch MCP servers while its session is running.' };
  const set = off.get(a.id) ?? new Set<string>();
  if (enabled === true) set.delete(name);
  else set.add(name);
  off.set(a.id, set);
  if (!ad || !ad.isLive(a.id)) return { ok: true };
  try {
    await setMcpEnabledOf(ad, a.id, name, enabled === true);
    return { ok: true };
  } catch (err) {
    // e.g. a server that was not part of this session at start: it comes in with the next start
    return { ok: true, error: `Saved for this agent. The running session could not apply it now (${trunc(err instanceof Error ? err.message : err, 120)}); it applies at the next start.` };
  }
}

/** The saved folders whose adapter this build knows. The others stay in the file, are not shown, and are never started as another adapter. One warning per unknown id, no path in it. */
export function restorable(folders: SavedFolder[], has: (id: string) => boolean, warn: (m: string) => void): Array<{ folder: SavedFolder; adapterId: string }> {
  const out: Array<{ folder: SavedFolder; adapterId: string }> = [];
  const warned = new Set<string>();
  for (const f of folders) {
    const adapterId = adapterOf(f);
    if (!has(adapterId)) {
      // Saved by a build that knows more adapters: stays in the file, is not shown, and is never started as another adapter. No path in the log.
      if (!warned.has(adapterId)) warn(`Skipping saved folders of unknown adapter ${JSON.stringify(adapterId.slice(0, 40))}`);
      warned.add(adapterId);
      continue;
    }
    out.push({ folder: f, adapterId });
  }
  return out;
}

/**
 * *End session* (spec 005), also *Restart session*'s first step (spec 058 FR-022): remote control off first (spec 054 FR-003 and
 * FR-011, off on GitHub too), then the adapter frees the session. In this order so remote control never outlives the session.
 */
export async function endSessionOp(d: { release(id: string): Promise<void>; router: Pick<AdapterRouter, 'forAgent'> }, id: string): Promise<void> {
  await d.release(id);
  await d.router.forAgent(id)?.stop(id);
}

/**
 * Spec 073 FR-005: main's one send step (scheduled prompts too). A leading `/name` of a folder or user entry is sent as that entry's
 * text; built-ins and anything else go as typed, and so does the typed text when the expansion fails. `slash` is the entry's place,
 * `slashNote` what a VS Code prompt file could not carry over (2026-10-23 delta).
 */
export async function sendWithSlash(
  ad: Pick<AgentAdapter, 'send' | 'expandSlashCommand'>,
  id: string,
  msg: AgentMessage,
): Promise<{ slash?: string; slashNote?: string }> {
  const text = String(msg.text ?? '');
  const slash = ad.expandSlashCommand ? await ad.expandSlashCommand(id, text).catch(() => undefined) : undefined;
  const expanded = slash && !slash.asTyped ? slash : undefined; // asTyped: over the size cap, the line goes as typed (review on #615)
  await ad.send(id, { ...msg, text: expanded ? expanded.text : text });
  if (slash?.asTyped) return slash.note ? { slashNote: slash.note } : {};
  return expanded ? { slash: expanded.where, ...(expanded.note ? { slashNote: expanded.note } : {}) } : {};
}
