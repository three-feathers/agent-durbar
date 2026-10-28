/**
 * Spec 087 T066 (K16, FR-022c): the pure verdict of the `switch` probe in `scripts/sandbox-floor-real.ts`. Unit-tested in
 * `scripts/test-sandbox-floor.ts`. A step runs the command `C` (`touch P/probe.txt; echo "touch=$?"; curl ...; echo "curl=$?"`); its
 * outcome comes from the exit codes the shell tool printed AND whether the probe file exists on disk (a model's own words never count).
 */
export type StepOutcome = 'both-ok' | 'both-blocked' | 'mixed' | 'not-run';
export type UpdateResult = 'resolved' | 'refused' | 'not-tried';
export type Verdict = 'A' | 'B' | 'cannot-tell';

/** The last `touch=N` / `curl=N` line of the tool's output (the command prints them; nothing else is read). */
export function parseExitCodes(output: string): { touch?: number; curl?: number } {
  const last = (name: string): number | undefined => {
    const all = [...String(output ?? '').matchAll(new RegExp(`(?:^|\\n)\\s*${name}=(\\d{1,3})\\s*(?=\\n|$)`, 'g'))];
    return all.length ? Number(all[all.length - 1][1]) : undefined;
  };
  const touch = last('touch');
  const curl = last('curl');
  return { ...(touch !== undefined ? { touch } : {}), ...(curl !== undefined ? { curl } : {}) };
}

/**
 * One step: `both-ok` only when the write succeeded (exit 0 AND the file is there) and curl exited 0; `both-blocked` only when the write
 * failed (non-zero AND no file) and curl failed; `not-run` when the command did not run or a code is missing; anything else is `mixed`.
 */
export function stepOutcome(r: { ran: boolean; touch?: number; curl?: number; fileExists: boolean }): StepOutcome {
  if (!r.ran || typeof r.touch !== 'number' || typeof r.curl !== 'number') return 'not-run';
  const wrote = r.touch === 0 && r.fileExists;
  const writeBlocked = r.touch !== 0 && !r.fileExists;
  if (wrote && r.curl === 0) return 'both-ok';
  if (writeBlocked && r.curl !== 0) return 'both-blocked';
  return 'mixed';
}

/**
 * The verdict after step 3. The control (step 1, Ask first, floor on) must be `both-blocked`, or the probe cannot tell anything.
 * **A** only when the update resolved AND step 3 is `both-ok`. A refused update, or an accepted one whose command is still blocked
 * ("accepted, not honoured") or only half free, is **B**. A step 3 that did not run, or that succeeded although the update was refused
 * (something else cleared it), cannot tell.
 */
export function switchVerdict(s: { control: StepOutcome; update: UpdateResult; after: StepOutcome }): { verdict: Verdict; why: string } {
  if (s.control !== 'both-blocked') return { verdict: 'cannot-tell', why: `control (Ask first, floor on) was ${s.control}, not both-blocked` };
  if (s.after === 'not-run') return { verdict: 'cannot-tell', why: 'step 3 did not run the command' };
  if (s.after === 'both-ok') return s.update === 'resolved' ? { verdict: 'A', why: 'the update resolved and the write and the network both succeeded' } : { verdict: 'cannot-tell', why: `step 3 succeeded although the update was ${s.update}` };
  if (s.update === 'resolved') return { verdict: 'B', why: `accepted, not honoured: step 3 was ${s.after}` };
  return { verdict: 'B', why: `the update was ${s.update}; step 3 was ${s.after}` };
}

/** Step 4 (only after A or B; a cannot-tell after step 3 stops there): A narrows back to Ask first, which must block both; B resumes in Allow all, which must free both. */
export function step4Expected(v: Verdict): StepOutcome {
  return v === 'A' ? 'both-blocked' : 'both-ok';
}

/** The owner's budget for T066 (about 3 Copilot prompts) and the script's own stop; the 30-credit session cap is the runtime's minimum, not the budget. */
export const SWITCH_MAX_PROMPTS = 3;
export const SWITCH_MAX_AIU = 1;

/**
 * Called right before every send (review on PR #827). No prompt once `SWITCH_MAX_PROMPTS` were sent, once the run used
 * `SWITCH_MAX_AIU` or more, while the usage of an earlier step is unknown (no usage event with a number came: unknown is never 0),
 * after a turn that did not end, or after the model ran a command that is not exactly the probe command.
 */
export function mayPrompt(s: { prompts: number; aiu: number; usageKnown: boolean; timedOut: boolean; strayCall: boolean }): { ok: boolean; why: string } {
  if (!Number.isInteger(s.prompts) || s.prompts < 0 || s.prompts >= SWITCH_MAX_PROMPTS) return { ok: false, why: `${s.prompts} prompts sent; the budget is ${SWITCH_MAX_PROMPTS}` };
  if (s.usageKnown !== true) return { ok: false, why: 'usage unreadable' };
  if (typeof s.aiu !== 'number' || !Number.isFinite(s.aiu) || s.aiu < 0 || s.aiu >= SWITCH_MAX_AIU) return { ok: false, why: `${s.aiu} AIU used; the stop is ${SWITCH_MAX_AIU} AIU` };
  if (s.timedOut !== false) return { ok: false, why: 'a turn did not end' };
  if (s.strayCall !== false) return { ok: false, why: 'the model ran a command that is not the probe command' };
  return { ok: true, why: 'within the budget' };
}

/**
 * The permission gate of the probe session (review on PR #827): only a shell request whose full command text is exactly `C` may go
 * on to Durbar's broker; anything else (another command, extra or missing spaces, another kind, no text, no request) is rejected
 * before it runs. `read:` SDK 1.0.22 `session-events.d.ts`: a shell permission request has `fullCommandText: string`.
 */
export function probeGateAllows(req: unknown, C: string): boolean {
  if (!req || typeof req !== 'object' || typeof C !== 'string' || !C) return false;
  const r = req as { kind?: unknown; fullCommandText?: unknown };
  return r.kind === 'shell' && typeof r.fullCommandText === 'string' && r.fullCommandText === C;
}

/**
 * The shell command of a tool call's arguments, or undefined. `read:` the SDK 1.0.22 typings give a tool start only `arguments?: JsonValue`
 * (`session-events.d.ts` `ToolExecutionStartData`), so the field name comes from the runtime's own bash tool schema (`tools.list`,
 * recorded by the dry run as `shellToolParams`; the spend run refuses when it has no `command`). Fail safe: a start with no string
 * `command` is stray (the turn is interrupted, and it never counts as the probe).
 */
export function commandOf(args: unknown): string | undefined {
  const c = args && typeof args === 'object' ? (args as { command?: unknown }).command : undefined;
  return typeof c === 'string' ? c : undefined;
}

/**
 * Review on PR #827: the result is read ONLY from a call whose command is exactly `C` (the first one that finished); any other started
 * call (another command, or none given) is `stray`, and the script interrupts the turn at once. A model's `echo curl=0` never counts.
 */
export function probeCalls(events: ReadonlyArray<{ callId?: unknown; phase?: unknown; args?: unknown; output?: unknown }>, C: string): { stray: boolean; exactRan: boolean; output?: string } {
  const exact = new Set<unknown>();
  let stray = false;
  let output: string | undefined;
  let exactRan = false;
  for (const e of events) {
    // No other tool can start: the probe session's tools are limited to bash and read back as exactly [bash] before any prompt, so a
    // `report_intent` or other start is not expected; if one comes anyway it is stray (fail safe), never ignored.
    if (e.phase === 'start') {
      // only the FIRST exact call counts; a second exact run is stray too (review on PR #827), so the first result is never replaced
      if (commandOf(e.args) === C && e.callId !== undefined && exact.size === 0) exact.add(e.callId);
      else stray = true;
    } else if ((e.phase === 'complete' || e.phase === 'failed') && exact.has(e.callId) && !exactRan) {
      exactRan = true;
      output = typeof e.output === 'string' ? e.output : '';
    }
  }
  return { stray, exactRan, ...(output !== undefined ? { output } : {}) };
}
