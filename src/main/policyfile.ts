/**
 * Spec 076 FR-209 (P1, first slice; issue #734): the machine `policy.json`, read for spec 087's `permissions.requireOsSandbox`.
 * Pure apart from the injected file system: a fixed path per OS (FR-002), FR-005's trust check on every folder of the literal path and of
 * every link's target, FR-009's size cap, and FR-010's whole-file failure as `'unreadable'` (which the sandbox rule reads as "required").
 * Windows reads nothing in this slice (`[KNOWN GAP]`, issue #1124).
 */
import * as nodeFs from 'fs';
import * as path from 'path';
import { readCapped } from '../shared/cappedread';
import type { CappedFlags, CappedFs } from '../shared/cappedread';

/** The fixed machine paths are POSIX paths on every platform that reads them (review of #1123: the platform `path` broke them on Windows). */
const P = path.posix;

/** FR-009: the largest `policy.json` read. */
export const POLICY_MAX_BYTES = 256 * 1024;

/** FR-002: the machine folder per OS, fixed in code (no environment variable, hook or setting moves it); `undefined` where none is read yet. */
export function machinePolicyDir(platform: string): string | undefined {
  if (platform === 'darwin') return '/Library/Application Support/AgentDurbar/managed';
  if (platform === 'linux') return '/etc/agent-durbar/managed';
  return undefined; // win32: [KNOWN GAP] (issue #1124: FR-002 needs SHGetKnownFolderPath through koffi)
}

export interface PolicyStat { uid: number; mode: number; ino: number; dev: number; size: number; nlink: number; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }
/** The same, read with `{ bigint: true }`: `ino` and `dev` are compared only in this form (issue #1491: a 64-bit file ID loses its low bit as a number). */
export interface PolicyBigStat { uid: bigint; mode: bigint; ino: bigint; dev: bigint; isFile(): boolean; isSymbolicLink(): boolean }
export interface PolicyFs extends CappedFs {
  readlinkSync(p: string): string;
  lstatSync(p: string): PolicyStat;
  lstatSync(p: string, opts: { bigint: true }): PolicyBigStat;
  fstatSync(fd: number): PolicyStat;
  fstatSync(fd: number, opts: { bigint: true }): PolicyBigStat;
}

/** The real file system. */
export const nodePolicyFs: PolicyFs = {
  readlinkSync: (p) => nodeFs.readlinkSync(p),
  lstatSync: ((p: string, o?: { bigint: true }) => nodeFs.lstatSync(p, o)) as PolicyFs['lstatSync'],
  openSync: (p, flags) => nodeFs.openSync(p, flags),
  fstatSync: ((fd: number, o?: { bigint: true }) => Object.assign(nodeFs.fstatSync(fd, o), { isSymbolicLink: () => false })) as PolicyFs['fstatSync'],
  readSync: (fd, buf, off, len, pos) => nodeFs.readSync(fd, buf, off, len, pos),
  closeSync: (fd) => nodeFs.closeSync(fd),
};

export type MachinePolicy = { layer: undefined } | { layer: Record<string, unknown> } | { layer: 'unreadable'; problem: string };

/**
 * FR-005 (POSIX): owned by root and not group- or world-writable. `[KNOWN GAP]` macOS ACLs (`chmod +a`) are not visible in the mode, so a
 * folder whose ACL lets a group write passes (review of #1123).
 */
const trusted = (st: { uid: number | bigint; mode: number | bigint }): boolean => Number(st.uid) === 0 && (Number(st.mode) & 0o022) === 0;
const noEnt = (e: unknown): boolean => (e as { code?: string } | null)?.code === 'ENOENT';

/** The most links followed on the way to the policy folder (Linux's own limit is 40). */
const MAX_HOPS = 40;
type Walk = { real: string } | { missing: true } | { why: string };

/**
 * FR-005 on the literal path (review of #1123, finding A): `dir` is resolved one name at a time from `/`, so every folder passed through
 * on the way is checked, not only the folders of the resolved path. A folder must be a real, trusted folder before anything in it is
 * believed: a link is followed only when the folder that holds it is trusted (so only root could have made it), and its target is walked
 * the same way. A missing name inside a trusted folder is "no folder" (only root could have removed it).
 */
function walkTrusted(fs: PolicyFs, dir: string): Walk {
  const where = (d: string): string => `a folder of the policy path (${d}) is not owned by root or is writable by others`;
  let st: PolicyStat;
  try {
    st = fs.lstatSync('/');
  } catch {
    return { why: 'a folder of the policy path (/) cannot be read' };
  }
  if (!st.isDirectory() || !trusted(st)) return { why: where('/') };
  let cur = '/'; // invariant: `cur` and every folder above it is a real, trusted folder
  const rest = dir.split('/');
  let hops = 0;
  while (rest.length) {
    const name = rest.shift()!;
    if (name === '' || name === '.') continue;
    if (name === '..') {
      cur = P.dirname(cur);
      continue;
    }
    const next = P.join(cur, name);
    try {
      st = fs.lstatSync(next);
    } catch (e) {
      return noEnt(e) ? { missing: true } : { why: `a folder of the policy path (${next}) cannot be read` };
    }
    if (st.isSymbolicLink()) {
      // `cur` is trusted, so the link is root's; its target is walked from `cur` (relative) or from `/` (absolute)
      if (++hops > MAX_HOPS) return { why: `the policy path has more than ${MAX_HOPS} links` };
      let to: string;
      try {
        to = fs.readlinkSync(next);
      } catch {
        return { why: `a link of the policy path (${next}) cannot be read` };
      }
      if (to.startsWith('/')) cur = '/';
      rest.unshift(...to.split('/'));
      continue;
    }
    if (!st.isDirectory() || !trusted(st)) return { why: where(next) };
    cur = next;
  }
  return { real: cur };
}

/**
 * The machine layer: `undefined` only when the folder is missing inside a trusted folder reached through trusted folders; the parsed
 * object when every check passes; else `'unreadable'` with a short problem for the log (never the file's content).
 */
export function readMachinePolicy(platform: string = process.platform, fs: PolicyFs = nodePolicyFs, flags: CappedFlags = nodeFs.constants): MachinePolicy {
  const dir = machinePolicyDir(platform);
  if (!dir) return { layer: undefined };
  const bad = (problem: string): MachinePolicy => ({ layer: 'unreadable', problem });
  try {
    // FR-005: every folder on the literal path and on every link's target, before anything inside the policy folder is trusted
    const w = walkTrusted(fs, dir);
    if ('why' in w) return bad(w.why);
    if ('missing' in w) return { layer: undefined };
    const realDir = w.real;
    const file = P.join(realDir, 'policy.json');
    let own: PolicyBigStat;
    try {
      own = fs.lstatSync(file, { bigint: true }); // never followed: a link is refused outright (review of #1123: a link to any root-owned JSON passed)
    } catch (e) {
      return bad(noEnt(e) ? 'policy.json is missing in the policy folder' : 'policy.json cannot be read');
    }
    if (own.isSymbolicLink()) return bad('policy.json is a link');
    if (!own.isFile()) return bad('policy.json is not a regular file');
    if (!trusted(own)) return bad('policy.json is not owned by root or is writable by others');
    // FR-031: the shared capped, no-follow, one-link read; the opened file must be the checked one and still trusted
    // the identity as bigints from a second `fstat` of the same descriptor (issue #1491)
    const r = readCapped(fs, flags, file, POLICY_MAX_BYTES, (st: PolicyStat, fd: number) => {
      const id = fs.fstatSync(fd, { bigint: true });
      return id.ino !== own.ino || id.dev !== own.dev || !trusted(st) ? 'policy.json changed while it was checked' : undefined;
    });
    if (!r.ok) return bad(r.code === 'vetoed' ? r.why : r.code === 'too-big' ? 'policy.json is larger than 256 KiB' : `policy.json cannot be read (${r.code})`);
    let text = r.buf.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      return bad('policy.json is not valid JSON');
    }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return bad('policy.json is not a JSON object');
    if ((v as { version?: unknown }).version !== 1) return bad('policy.json has no version 1');
    return { layer: v as Record<string, unknown> };
  } catch {
    return bad('policy.json cannot be read');
  }
}
