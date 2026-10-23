/**
 * Spec 076 FR-198/FR-201: reading the agent apps' machine policy files, read-only, with the limits every reader shares. The per-app
 * readers (`claudeOrgPolicy.ts`, `copilotOrgPolicy.ts`, `codexOrgPolicy.ts`) pass the paths and parse the text; this file only opens
 * files. Nothing read is logged; a problem names the path and its kind, never a value.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ORG_LIMITS } from '../shared/orgpolicy';

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

export type ReadOne = { kind: 'missing' } | { kind: 'text'; text: string } | { kind: 'bad'; problem: string };

/** One policy file: missing, its text, or a problem ("too large", "could not be read"). Never throws. */
export function readPolicyFile(fsx: OrgFs, p: string): ReadOne {
  try {
    const st = fsx.stat(p);
    if (!st) return { kind: 'missing' };
    if (!st.isFile()) return { kind: 'bad', problem: `${p}: not a file` };
    if (st.size > ORG_LIMITS.fileBytes) return { kind: 'bad', problem: `${p}: too large` };
    const text = fsx.readFile(p);
    if (text.length > ORG_LIMITS.fileBytes) return { kind: 'bad', problem: `${p}: too large` };
    return { kind: 'text', text };
  } catch {
    return { kind: 'bad', problem: `${p}: could not be read` };
  }
}

/** The `*.json` files of a drop-in folder, sorted; `bad` when the folder exists but cannot be listed or holds too many. */
export function dropInFiles(fsx: OrgFs, dir: string, join: (a: string, b: string) => string = path.join): { files: string[] } | { problem: string } {
  try {
    const st = fsx.stat(dir);
    if (!st) return { files: [] };
    if (!st.isDirectory()) return { problem: `${dir}: not a folder` };
    const names = fsx.readdir(dir).filter((n) => n.toLowerCase().endsWith('.json') && !n.startsWith('.')).sort();
    if (names.length > ORG_LIMITS.files) return { problem: `${dir}: too many files` };
    return { files: names.map((n) => join(dir, n)) };
  } catch {
    return { problem: `${dir}: could not be read` };
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
export const programFiles = (env: Readonly<Record<string, string | undefined>>): string => env.ProgramFiles || env.PROGRAMFILES || 'C:\\Program Files';
export const programData = (env: Readonly<Record<string, string | undefined>>): string => env.ProgramData || env.PROGRAMDATA || 'C:\\ProgramData';
