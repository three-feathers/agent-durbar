/**
 * Spec 087 T060 (review on PR #753): what `scripts/sandbox-floor-real.ts` records must hold no session id. Pure, unit-tested in
 * `scripts/test-sandbox-floor.ts`. `maskIds` replaces every UUID-shaped run in a text; `maskArgv` also replaces the value after an id
 * flag (`--session-id`, `--resume`, `--continue-session`, `--fork-session`, also in `--flag=value` form) whatever its shape.
 */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ID_FLAGS = new Set(['--session-id', '--resume', '--continue-session', '--fork-session', '-r']);
export const ID_MASK = '<session-id>';

export function maskIds(text: string): string {
  return String(text).replace(UUID_RE, ID_MASK);
}

export function maskArgv(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    const eq = a.indexOf('=');
    if (eq > 0 && ID_FLAGS.has(a.slice(0, eq))) { out.push(`${a.slice(0, eq)}=${ID_MASK}`); continue; }
    out.push(maskIds(a));
    if (ID_FLAGS.has(a) && i + 1 < args.length) { out.push(ID_MASK); i++; }
  }
  return out;
}
