/**
 * Spec 076 FR-198/FR-201: reading the agent apps' machine policy files, read-only, with the limits every reader shares. The per-app
 * readers (`claudeOrgPolicy.ts`, `copilotOrgPolicy.ts`, `codexOrgPolicy.ts`) pass the paths and parse the text; this file only opens
 * files. Nothing read is logged; a problem names the path and its kind, never a value.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ORG_LIMITS } from '../shared/orgpolicy';
import type { OrgPolicy } from '../shared/orgpolicy';

/** The file-system calls a reader uses, injectable for tests. */
export interface OrgFs {
  lstat(p: string): { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean; size: number; uid: number; mode: number } | undefined;
  stat(p: string): { isFile(): boolean; isDirectory(): boolean; size: number } | undefined;
  readFile(p: string): string;
  readdir(p: string): string[];
}

const missing = (e: unknown): boolean => {
  const c = (e as { code?: string } | null)?.code;
  return c === 'ENOENT' || c === 'ENOTDIR';
};

export const nodeOrgFs: OrgFs = {
  lstat: (p) => {
    try {
      return fs.lstatSync(p);
    } catch (e) {
      if (missing(e)) return undefined;
      throw e;
    }
  },
  stat: (p) => {
    try {
      return fs.statSync(p);
    } catch (e) {
      if (missing(e)) return undefined;
      throw e;
    }
  },
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  readdir: (p) => fs.readdirSync(p),
};

export type ReadOne = { kind: 'missing' } | { kind: 'text'; text: string } | { kind: 'denied'; problem: string } | { kind: 'tooLarge'; problem: string } | { kind: 'bad'; problem: string };

/** The operating system refused the read (a root-only file): Claude Code then starts without that source (read: managed-settings). */
const deniedCode = (e: unknown): boolean => {
  const c = (e as { code?: string } | null)?.code;
  return c === 'EACCES' || c === 'EPERM';
};

/** One policy file: missing, its text, denied by the OS, over Durbar's size limit, or another read problem. Never throws. */
export function readPolicyFile(fsx: OrgFs, p: string): ReadOne {
  try {
    const st = fsx.stat(p);
    if (!st) return { kind: 'missing' };
    if (!st.isFile()) return { kind: 'bad', problem: `${p}: not a file` };
    if (st.size > ORG_LIMITS.fileBytes) return { kind: 'tooLarge', problem: `${p}: larger than Agent Durbar reads` };
    const text = fsx.readFile(p);
    if (text.length > ORG_LIMITS.fileBytes) return { kind: 'tooLarge', problem: `${p}: larger than Agent Durbar reads` };
    return { kind: 'text', text };
  } catch (e) {
    return deniedCode(e) ? { kind: 'denied', problem: `${p}: the system refused the read` } : { kind: 'bad', problem: `${p}: could not be read` };
  }
}

/** The `*.json` files of a drop-in folder, sorted; `denied` / `problem` when the folder exists but cannot be listed, `tooMany` over the limit. */
export function dropInFiles(fsx: OrgFs, dir: string, join: (a: string, b: string) => string = path.join): { files: string[] } | { denied: string } | { tooMany: string } | { problem: string } {
  try {
    const st = fsx.stat(dir);
    if (!st) return { files: [] };
    if (!st.isDirectory()) return { problem: `${dir}: not a folder` };
    const names = fsx.readdir(dir).filter((n) => n.endsWith('.json') && !n.startsWith('.')).sort(); // exactly what Claude Code reads: lower-case `.json`, no hidden files
    if (names.length > ORG_LIMITS.files) return { tooMany: `${dir}: more files than Agent Durbar reads` };
    return { files: names.map((n) => join(dir, n)) };
  } catch (e) {
    return deniedCode(e) ? { denied: `${dir}: the system refused the read` } : { problem: `${dir}: could not be read` };
  }
}

/** The text as a JSON object, or a problem; `JSON.parse` builds own data properties only (no prototype change). */
export function jsonObject(text: string, p: string): { ok: true; value: Record<string, unknown> } | { ok: false; problem: string } {
  try {
    const v: unknown = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) return { ok: true, value: v as Record<string, unknown> };
  } catch {
    /* fall through */
  }
  return { ok: false, problem: `${p}: not a JSON object` };
}

/** Path joining for the target OS (tests read Windows paths on Linux). */
export const joinFor = (platform: string): ((a: string, b: string) => string) => (platform === 'win32' ? path.win32.join : path.posix.join);

/** Windows' Program Files and ProgramData folders from the environment, with the usual defaults (FR-198). */
const absWin = (v: string | undefined): string | undefined => (v && path.win32.isAbsolute(v) && /^[A-Za-z]:[\\/]/.test(v) ? v : undefined); // a drive path only, never relative or UNC
export const programFiles = (env: Readonly<Record<string, string | undefined>>): string => absWin(env.ProgramFiles) ?? absWin(env.PROGRAMFILES) ?? 'C:\\Program Files';
export const programData = (env: Readonly<Record<string, string | undefined>>): string => absWin(env.ProgramData) ?? absWin(env.PROGRAMDATA) ?? 'C:\\ProgramData';

/**
 * FR-201 (review on PR 644 item 3): the work is skipped when nothing changed. The last read of one source is kept with the SHA-256 of
 * the text it was made from (`textKey`, after the size cap). The same key gives back the same `OrgPolicy` object, which also keeps its
 * verdict memo. A different text, whatever its size and times, is read again; `undefined` means no reuse.
 */
export interface LastRead {
  key?: string;
  policy?: OrgPolicy;
}

export function reuseOrRead(slot: LastRead, key: string | undefined, read: () => OrgPolicy): OrgPolicy {
  if (key !== undefined && slot.key === key && slot.policy) return slot.policy;
  const p = read();
  if (key !== undefined) {
    slot.key = key;
    slot.policy = p;
  } else {
    slot.key = undefined;
    slot.policy = undefined;
  }
  return p;
}

/** The SHA-256 of what a source was made from (the file texts read, the problems), as the key of `reuseOrRead`. Reading the bytes is cheap next to parsing them, and a swapped link, a reset time or a same-size edit are all a different text. */
export function textKey(parts: unknown): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}
