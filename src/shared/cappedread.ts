/**
 * The one capped, non-blocking, no-follow read of a file that a project or a user folder ships (issue #917, spec 083 T043).
 * It had three copies (`notesfile.ts`, `mcp/auth.ts`, `adapters/slashcommands.ts`). It lives in `src/shared` so `src/adapters` and
 * `src/main` both use it. No imports (`docs/agent-notes.md`: a `src/shared` module with imports can no longer load in the page); the
 * file system and the open flags are passed in, so tests drive it with a fake or without `O_NOFOLLOW`, like Windows.
 */

/** The four calls used; `node:fs` fits. */
export interface CappedFs {
  openSync(file: string, flags: number): number;
  fstatSync(fd: number): { isFile(): boolean; size: number; nlink: number };
  readSync(fd: number, buf: Buffer, offset: number, length: number, position: number): number;
  closeSync(fd: number): void;
}
/** `fs.constants`, or a set without `O_NOFOLLOW` / `O_NONBLOCK` (both are 0 or missing on Windows). */
export interface CappedFlags { O_RDONLY: number; O_NOFOLLOW?: number; O_NONBLOCK?: number }

export type CappedFailCode = 'missing' | 'link' | 'not-file' | 'links' | 'too-big' | 'changing' | 'error';
export type CappedRead = { ok: true; buf: Buffer } | { ok: false; code: CappedFailCode; errno?: string };
/** A caller's own descriptor check refused the file (`why` is the caller's text). */
export type CappedVetoed = { ok: false; code: 'vetoed'; why: string };

const errCode = (e: unknown): string => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' && /^[A-Z0-9_]{2,24}$/.test(c) ? c : 'ERROR';
};

/**
 * Read at most `cap` bytes, never blocking and never following a final link: open `O_RDONLY | O_NOFOLLOW | O_NONBLOCK` (each where
 * defined; a FIFO opens at once and fails the regular-file check), `fstat` the descriptor: a regular file with one link and a size
 * within `cap`, then at most `size + 1` bytes are read (a file that grows meanwhile is `changing`). The bytes are returned undecoded, so
 * the cap is checked before any decoding. `vet` (optional) sees the `fstat` after the file and link checks and before the size check;
 * a string it returns refuses the file (`vetoed`). Never throws.
 */
export function readCapped(fs: CappedFs, k: CappedFlags, file: string, cap: number): CappedRead;
export function readCapped<S extends { isFile(): boolean; size: number; nlink: number }>(fs: CappedFs, k: CappedFlags, file: string, cap: number, vet: (st: S) => string | undefined): CappedRead | CappedVetoed;
export function readCapped(fs: CappedFs, k: CappedFlags, file: string, cap: number, vet?: (st: never) => string | undefined): CappedRead | CappedVetoed {
  let fd: number;
  try {
    fd = fs.openSync(file, k.O_RDONLY | (k.O_NOFOLLOW ?? 0) | (k.O_NONBLOCK ?? 0));
  } catch (e) {
    const c = errCode(e);
    return c === 'ENOENT' ? { ok: false, code: 'missing' } : c === 'ELOOP' || c === 'EMLINK' ? { ok: false, code: 'link' } : { ok: false, code: 'error', errno: c };
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return { ok: false, code: 'not-file' };
    if (st.nlink > 1) return { ok: false, code: 'links' };
    const why = vet?.(st as never);
    if (why !== undefined) return { ok: false, code: 'vetoed', why };
    if (st.size > cap) return { ok: false, code: 'too-big' };
    const buf = Buffer.alloc(st.size + 1);
    let n = 0;
    while (n < buf.length) {
      const r = fs.readSync(fd, buf, n, buf.length - n, n);
      if (r <= 0) break;
      n += r;
    }
    if (n > st.size) return n > cap ? { ok: false, code: 'too-big' } : { ok: false, code: 'changing' };
    return { ok: true, buf: buf.subarray(0, n) };
  } catch (e) {
    return { ok: false, code: 'error', errno: errCode(e) };
  } finally {
    try { fs.closeSync(fd); } catch { /* gone */ }
  }
}
