/** Pure parts of `copilot-giveup-real.ts` (spec 052, review of #1038), so `test:copilotcap` can check them without a runtime or a credit. */

/** `--max-prompts`: a positive integer or the run is refused; anything else would make the prompt limit never true. */
export function parseMaxPrompts(value: string | undefined): number {
  if (!/^[1-9]\d*$/.test(value ?? '')) throw new Error('refused: --max-prompts takes a positive integer');
  return Number(value);
}

/** The one gate right before every real send: why it may not go, or null. NaN in any field refuses. */
export function spendRefusal(s: { prompts: number; maxPrompts: number; aiu: number; maxAiu: number }): string | null {
  if (!(s.prompts < s.maxPrompts)) return `refused: ${s.maxPrompts} prompts used`;
  if (!(s.aiu < s.maxAiu)) return `refused: ${s.aiu} AI credits used`;
  return null;
}

/**
 * The pids of an exact `sleep <n>` under `root`, from `ps -o pid=,ppid=,args=` text: only the runtime's descendants, never another
 * process of this user that happens to run the same command.
 */
export function ownSleepers(psText: string, root: number, n: number): number[] {
  const rows = psText.split('\n').map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), args: m[3].trim() }));
  const ours = new Set<number>([root]);
  for (let grew = true; grew;) {
    grew = false;
    for (const r of rows) if (ours.has(r.ppid) && !ours.has(r.pid)) { ours.add(r.pid); grew = true; }
  }
  return rows.filter((r) => r.pid !== root && ours.has(r.pid) && r.args === `sleep ${n}`).map((r) => r.pid);
}
