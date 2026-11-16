/**
 * When a test may skip a hard-link case (spec 096 FR-030, FR-070; third review of #956). A skipped case is not a pass: a refused `linkSync` once turned into a skip and
 * exit 0 with the one-link refusal removed. Only Windows outside CI may skip, and only for the codes a refused link gives there (a FAT or network drive):
 * on Linux and macOS hard links work, so any refusal fails the test, and under CI every case must run.
 */
export const HARD_LINK_REFUSALS: readonly string[] = ['EPERM', 'EXDEV', 'ENOTSUP', 'EMLINK'];

/** `null`: the case may be skipped. Otherwise why the refusal fails the test. */
export function hardLinkSkip(code: unknown, platform: string = process.platform, env: Record<string, string | undefined> = process.env): string | null {
  const c = typeof code === 'string' ? code : String(code);
  if (platform !== 'win32') return `a hard link was refused (${c}) on ${platform}, where hard links work: the case must run`;
  if (env.CI !== undefined && env.CI !== '') return `a hard link was refused (${c}) under CI: the case must run`;
  if (!HARD_LINK_REFUSALS.includes(c)) return `a hard link failed with ${c}, not a refused link (${HARD_LINK_REFUSALS.join(', ')})`;
  return null;
}

/** Make the hard link: `true`; `false` after a note where a skip is allowed; otherwise it throws with `who` and the reason. */
export function hardLinkOrSkip(who: string, target: string, at: string, link: (target: string, at: string) => void, log: (line: string) => void): boolean {
  try {
    link(target, at);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException | null)?.code;
    const why = hardLinkSkip(code);
    if (why !== null) throw new Error(`${who}: ${why}`);
    log(`${who}: this file system refused a hard link (${String(code)}), a hard-link case is skipped`);
    return false;
  }
}
