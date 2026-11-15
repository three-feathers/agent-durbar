/**
 * The one identity-checked read of a file main finds on disk (spec 096 FR-020, FR-030; review of #956, FR-031): the character store's files and the returned
 * picture sheet both use it, so a fix lands in one place.
 *  - `lstat` first, with bigints: a link, a FIFO or any other non-regular file is never opened (on Windows, with no `O_NOFOLLOW`, this is the link guard), and a
 *    file already over `cap` is refused without opening it.
 *  - Then the shared capped, no-follow, non-blocking read (`readCapped`, `src/shared/cappedread.ts`), which refuses a file with more than one hard link.
 *  - The opened file must be the one `lstat` saw: device and inode compared as bigints (issue #1491: a 64-bit NTFS file ID loses its low bit as a number).
 * `[KNOWN GAP]` only the last part of the path is guarded: a parent folder swapped for a link between the caller's checks and the open is followed (Node has no
 * portable `openat`); it needs write access to the folder as the same user (spec 096 *Changes 2026-11-15, round 2*).
 */
import * as fs from 'fs';
import { readCapped } from '../shared/cappedread';
import type { CappedRead, CappedVetoed } from '../shared/cappedread';

/** An `lstat` failure: only ENOENT is `missing`; EACCES, ELOOP, ENOTDIR, EIO and the rest are `error` with their code, as `readCapped` maps an open (third review of #956). */
export function lstatFailure(e: unknown): CappedRead {
  const c = (e as { code?: unknown } | null)?.code;
  const errno = typeof c === 'string' && /^[A-Z0-9_]{2,24}$/.test(c) ? c : 'ERROR';
  return errno === 'ENOENT' ? { ok: false, code: 'missing' } : { ok: false, code: 'error', errno };
}

/** Never throws; nothing it returns carries a path. */
export function readSameFile(file: string, cap: number): CappedRead | CappedVetoed {
  let st: fs.BigIntStats;
  try { st = fs.lstatSync(file, { bigint: true }); } catch (e) { return lstatFailure(e); }
  if (!st.isFile()) return { ok: false, code: st.isSymbolicLink() ? 'link' : 'not-file' };
  if (st.size > BigInt(cap)) return { ok: false, code: 'too-big' };
  return readCapped(fs, fs.constants, file, cap, (_now: fs.Stats, fd: number) => {
    const id = fs.fstatSync(fd, { bigint: true });
    return id.ino !== st.ino || id.dev !== st.dev ? 'replaced' : undefined;
  });
}
