/**
 * *Export…* of a folder's notes (spec 083 FR-048, T034b, issue 699): the file the person picked in main's save dialog, written
 * atomically. The window never sends the path: `NotesOps.export` gets it from the dialog main shows. The text is already FR-052's
 * format and masked (the caller); this module only writes it safely:
 *
 * - the chosen folder must exist (its real path is used from then on); the chosen name must be missing or a regular file with one
 *   link: a link, a hard link, a folder, a device, a FIFO or a socket is refused and nothing is written;
 * - a temp file in the same real folder is opened `O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW` (where defined), 0600 (and `fchmod`
 *   0600 on POSIX), written, synced, closed; right before the rename the folder and the name are checked again (still missing, or the
 *   same file by device, inode, birth and modification times and size,
 *   one link); a rename replaces a link put there in the last moment and never follows it; on
 *   Windows a refused rename is tried once more after 200 ms, checked again first; on a failure the temp file is removed by its path
 *   (best effort: when the chosen folder was moved away meanwhile, the temp file stays in it, spec `[KNOWN GAP]`).
 * The steps follow `NotesFile.syncOut` (`notesfile.ts`), not shared with it: there the re-check is a hash, here the file's identity.
 *
 * No Electron import (the dialog is injected into `NotesOps`); nothing here logs; a refusal is a short reason without a path.
 */
import * as nodeFs from 'fs';
import * as path from 'path';
import { randomInt } from 'crypto';
import { NOTES_LIMITS } from '../shared/notes';

export type NotesExportFs = Pick<typeof nodeFs, 'realpathSync' | 'lstatSync' | 'openSync' | 'writeSync' | 'fsyncSync' | 'fchmodSync' | 'closeSync' | 'renameSync' | 'unlinkSync'>;
export type NotesExportFlags = Pick<typeof nodeFs.constants, 'O_WRONLY' | 'O_CREAT' | 'O_EXCL'> & { O_NOFOLLOW?: number };

export interface NotesExportOptions {
  fs?: NotesExportFs;
  /** Tests pass a set without `O_NOFOLLOW` to act like Windows. */
  flags?: NotesExportFlags;
  /** Whether modes apply and the Windows rename retry runs. Default `process.platform`. */
  platform?: string;
  rand?: (n: number) => number;
  sleep?: (ms: number) => Promise<void>;
  pid?: number;
}

export type ExportWrote = { ok: true; name: string; bytes: number } | { ok: false; error: string };

const errCode = (e: unknown): string => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' && /^[A-Z0-9_]{2,24}$/.test(c) ? c : 'ERROR';
};
export const EXPORT_FAIL = (why: string): string => `Could not export the notes: ${why}.`;

/**
 * The default file name the dialog offers: `<folder>-notes.md`, with every character a file name cannot hold on Windows, macOS or
 * Linux (`< > : " / \ | ? *`, controls) and the bidi controls (U+200E, U+200F, U+202A..U+202E, U+2066..U+2069) replaced
 * by `-`, no leading dot, no trailing dot or space, at most 60 characters of the name.
 */
export function exportFileName(folderName: string): string {
  let n = String(folderName ?? '').replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '-').replace(/\s+/g, ' ').trim();
  n = n.replace(/^\.+/, '').slice(0, 60).replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(n)) n += '-';
  return `${n || 'folder'}-notes.md`;
}

/** What main passes to `dialog.showSaveDialog` (Electron's `SaveDialogOptions` shape; no Electron type here). */
export interface ExportDialogOptions {
  title: string;
  defaultPath: string;
  filters: { name: string; extensions: string[] }[];
  properties: ('createDirectory' | 'showOverwriteConfirmation')[];
}

/** FR-048: the save dialog's options. `showOverwriteConfirmation` makes the Linux dialog ask before replacing (Windows and macOS always ask). */
export function exportDialogOptions(folderName: string): ExportDialogOptions {
  return { title: 'Export notes', defaultPath: exportFileName(folderName), filters: [{ name: 'Markdown', extensions: ['md'] }], properties: ['createDirectory', 'showOverwriteConfirmation'] };
}

/** What is at the name: device, inode, birth time, modification time and size (an inode number alone is reused after a delete). */
type Ident = string;
type Target = { ok: true; dir: string; file: string; name: string; was: Ident | null } | { ok: false; error: string };

/**
 * Write `text` to the chosen `file`. Returns the base name written, or a short reason (no path). Never throws.
 */
export async function writeNotesExport(file: unknown, text: string, opts: NotesExportOptions = {}): Promise<ExportWrote> {
  const fs = opts.fs ?? nodeFs;
  const k = opts.flags ?? nodeFs.constants;
  const platform = opts.platform ?? process.platform;
  const rand = opts.rand ?? ((n: number) => randomInt(n));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pid = opts.pid ?? process.pid;
  const p = path; // paths of this machine; `platform` only picks modes and the Windows rename retry
  const fail = (why: string): ExportWrote => ({ ok: false, error: EXPORT_FAIL(why) });
  if (typeof file !== 'string' || !file || file.length > 4096 || file.includes('\u0000') || !p.isAbsolute(file)) return fail('that is not a file path');
  const bytes = Buffer.from(String(text), 'utf8');
  if (bytes.length > NOTES_LIMITS.mdBytes) return fail('the notes are too large for one file');
  const name = p.basename(file);
  if (!name || name === '.' || name === '..' || /[\\/]$/.test(file)) return fail('that is not a file name');

  /** The chosen folder's real path and what is at the name now (`was`: its device and inode, `null`: missing), or why not. */
  const look = (): Target => {
    let dir: string;
    try {
      dir = fs.realpathSync(p.dirname(file));
      if (!fs.lstatSync(dir).isDirectory()) return { ok: false, error: EXPORT_FAIL('the chosen folder is not a folder') };
    } catch { return { ok: false, error: EXPORT_FAIL('the chosen folder is not there') }; }
    const at = p.join(dir, name);
    let st: nodeFs.BigIntStats;
    try { st = fs.lstatSync(at, { bigint: true }) as nodeFs.BigIntStats; } catch (e) {
      if (errCode(e) === 'ENOENT') return { ok: true, dir, file: at, name, was: null };
      return { ok: false, error: EXPORT_FAIL(`the chosen file could not be checked (${errCode(e)})`) };
    }
    if (st.isSymbolicLink()) return { ok: false, error: EXPORT_FAIL('the chosen file is a link') };
    if (st.isDirectory()) return { ok: false, error: EXPORT_FAIL('the chosen name is a folder') };
    if (!st.isFile()) return { ok: false, error: EXPORT_FAIL('the chosen file is not a regular file (a device, a pipe or a socket)') };
    if (st.nlink > BigInt(1)) return { ok: false, error: EXPORT_FAIL('the chosen file has more than one link (a hard link)') };
    return { ok: true, dir, file: at, name, was: `${st.dev}:${st.ino}:${st.birthtimeNs}:${st.mtimeNs}:${st.size}` };
  };
  const first = look();
  if (!first.ok) return first;
  /** Right before the rename: the same real folder, and the name still missing or still the same single-link regular file. */
  const recheck = (): string | undefined => {
    const now = look();
    if (!now.ok) return now.error;
    if (now.dir !== first.dir) return EXPORT_FAIL('the chosen folder changed while Durbar was writing');
    if (now.was !== first.was) return EXPORT_FAIL('the chosen file changed while Durbar was writing');
    return undefined;
  };
  const tmp = p.join(first.dir, `.durbar-export.${pid}.${rand(36 ** 6).toString(36)}.tmp`);
  let fd: number | undefined;
  let made = false;
  try {
    fd = fs.openSync(tmp, k.O_CREAT | k.O_EXCL | k.O_WRONLY | (k.O_NOFOLLOW ?? 0), 0o600);
    made = true;
    // best effort: opened 0600 it is never wider where the file system has modes; FAT/exFAT refuse a chmod (EPERM), which must not fail the export
    if (platform !== 'win32') { try { fs.fchmodSync(fd, 0o600); } catch { /* no modes here */ } }
    let off = 0;
    while (off < bytes.length) off += fs.writeSync(fd, bytes, off, bytes.length - off);
    try { fs.fsyncSync(fd); } catch { /* best effort */ }
    fs.closeSync(fd);
    fd = undefined;
    const late = recheck();
    if (late) return { ok: false, error: late };
    try {
      fs.renameSync(tmp, first.file);
    } catch (e) {
      if (platform !== 'win32' || !['EPERM', 'EBUSY', 'EACCES'].includes(errCode(e))) throw e;
      await sleep(200); // Windows: another program holds the file; once more, checked again first
      const again = recheck();
      if (again) return { ok: false, error: again };
      fs.renameSync(tmp, first.file);
    }
    made = false;
    return { ok: true, name, bytes: bytes.length };
  } catch (e) {
    return fail(`the file could not be written (${errCode(e)})`);
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* gone */ } }
    if (made) { try { fs.unlinkSync(tmp); } catch { /* not there */ } }
  }
}
