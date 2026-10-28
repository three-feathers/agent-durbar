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

/** Step 4: after A, Ask first again must block both (narrowing works); after B (or cannot-tell), the resumed Allow all session must free both. */
export function step4Expected(v: Verdict): StepOutcome {
  return v === 'A' ? 'both-blocked' : 'both-ok';
}
