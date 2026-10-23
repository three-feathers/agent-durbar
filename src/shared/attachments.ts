/**
 * Attachment rules shared by the main process (and unit tests): size/count caps, name sanitizing,
 * image sniffing and staging of in-memory files (pasted / dropped) into a private temp folder.
 * Pure Node (no Electron import). The renderer repeats the two caps in app.js to fail fast.
 */
import * as fs from 'fs';
import * as path from 'path';

export const MAX_ATTACH_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACH_FILES = 5;

export const IMAGE_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };

export const fmtSize = (n: number): string => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace(/\.0$/, '')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Detect a supported raster image by its magic bytes (the declared MIME type / extension is not trusted). SVG is never accepted. */
export function sniffImage(b: Uint8Array): { ext: string; mime: string } | null {
  const eq = (off: number, sig: number[]) => sig.every((v, i) => b[off + i] === v);
  if (b.length >= 8 && eq(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: 'png', mime: IMAGE_EXT.png };
  if (b.length >= 3 && eq(0, [0xff, 0xd8, 0xff])) return { ext: 'jpg', mime: IMAGE_EXT.jpg };
  if (b.length >= 6 && (eq(0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || eq(0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))) return { ext: 'gif', mime: IMAGE_EXT.gif };
  if (b.length >= 12 && eq(0, [0x52, 0x49, 0x46, 0x46]) && eq(8, [0x57, 0x45, 0x42, 0x50])) return { ext: 'webp', mime: IMAGE_EXT.webp };
  if (b.length >= 26 && eq(0, [0x42, 0x4d])) return { ext: 'bmp', mime: IMAGE_EXT.bmp };
  return null;
}

/** File name only: no directories, no control characters, no leading dots, bounded length. */
export function sanitizeName(name: string, fallback: string): string {
  let n = String(name ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  n = n.normalize('NFKC').replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  if (n.length > 80) {
    const ext = path.extname(n).slice(0, 12);
    n = n.slice(0, 80 - ext.length) + ext;
  }
  return n || fallback;
}

export type StageResult = { ok: true; path: string; name: string; kind: 'file' | 'image'; size: number } | { ok: false; error: string };

/** Write an in-memory file into `dir` (created private, mode 0700) after checking the caps and, for images, the real format. */
export function stageAttachment(dir: string, nameIn: string, mimeIn: string, data: Uint8Array): StageResult {
  const size = data.byteLength;
  if (!size) return { ok: false, error: 'The file is empty.' };
  if (size > MAX_ATTACH_BYTES) return { ok: false, error: `"${sanitizeName(nameIn, 'file')}" is ${fmtSize(size)}, over the ${fmtSize(MAX_ATTACH_BYTES)} per-file limit.` };
  const wantsImage = /^image\//i.test(String(mimeIn ?? ''));
  const img = sniffImage(data);
  if (wantsImage && !img) return { ok: false, error: `"${sanitizeName(nameIn, 'image')}" is not a PNG, JPEG, GIF, WebP or BMP image (SVG is not accepted).` };
  let name = sanitizeName(nameIn, img ? `pasted-image.${img.ext}` : 'attachment');
  if (img) name = name.replace(/\.[A-Za-z0-9]{1,5}$/, '') + '.' + img.ext; // extension follows the real format
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const sub = fs.mkdtempSync(path.join(dir, 'a-'));
  const file = path.join(sub, name);
  fs.writeFileSync(file, data, { mode: 0o600 });
  return { ok: true, path: file, name, kind: img ? 'image' : 'file', size };
}

/** spec 004 FR-009: the kind of a file on disk by its first bytes (an extension alone never makes an image). Unreadable = file. */
export function kindOfFile(file: string): 'image' | 'file' {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const head = Buffer.alloc(32);
      const n = fs.readSync(fd, head, 0, 32, 0);
      return sniffImage(head.subarray(0, n)) ? 'image' : 'file';
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return 'file';
  }
}

export const STAGE_PREFIX = 'agent-durbar-att-';

/**
 * spec 004 FR-010: staging folders left by a crash (`agent-durbar-att-*` in the temp folder, older than `maxAgeMs`) are removed
 * at start. Only folders with that prefix, directly in `tmp`, and never a symbolic link. Returns how many were removed.
 */
export function sweepStaleStageDirs(tmp: string, now = Date.now(), maxAgeMs = 24 * 3600_000): number {
  return sweepStaleTempDirs(tmp, [STAGE_PREFIX], now, maxAgeMs);
}

/**
 * Folders under `tmp` whose name starts with one of `prefixes`, older than `maxAgeMs`, removed (at most 500 a call). Only real
 * directories directly in `tmp`: a symbolic link (or anything else) is never followed or removed. Spec 004 FR-010 (staging) and spec
 * 051 FR-022 (the account probe's `durbar-acct-` and the one-shots' `durbar-gen-` folders a quit mid-call left behind).
 */
export function sweepStaleTempDirs(tmp: string, prefixes: readonly string[], now = Date.now(), maxAgeMs = 24 * 3600_000): number {
  const ok = prefixes.filter((p) => /^[a-z][a-z-]{2,30}-$/.test(p));
  if (!ok.length) return 0;
  let removed = 0;
  let names: string[];
  try {
    names = fs.readdirSync(tmp).filter((n) => ok.some((p) => n.startsWith(p)));
  } catch {
    return 0;
  }
  for (const n of names.slice(0, 500)) {
    const p = path.join(tmp, n);
    try {
      const st = fs.lstatSync(p);
      if (!st.isDirectory() || st.isSymbolicLink() || now - st.mtimeMs < maxAgeMs) continue;
      fs.rmSync(p, { recursive: true, force: true });
      removed++;
    } catch {
      /* not ours to remove, or gone */
    }
  }
  return removed;
}

