/**
 * Spec 076 FR-209 (P1, first slice; issue #734): the machine `policy.json`, read for spec 087's `permissions.requireOsSandbox`.
 * Pure apart from the injected file system: a fixed path per OS (FR-002), FR-005's trust check on the policy folder and every folder above
 * it, FR-009's size cap, and FR-010's whole-file failure as `'unreadable'` (which the sandbox rule reads as "required").
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
export interface PolicyFs extends CappedFs {
  realpathSync(p: string): string;
  lstatSync(p: string): PolicyStat;
  fstatSync(fd: number): PolicyStat;
}

/** The real file system. */
export const nodePolicyFs: PolicyFs = {
  realpathSync: (p) => nodeFs.realpathSync(p),
  lstatSync: (p) => nodeFs.lstatSync(p),
  openSync: (p, flags) => nodeFs.openSync(p, flags),
  fstatSync: (fd) => Object.assign(nodeFs.fstatSync(fd), { isSymbolicLink: () => false }),
  readSync: (fd, buf, off, len, pos) => nodeFs.readSync(fd, buf, off, len, pos),
  closeSync: (fd) => nodeFs.closeSync(fd),
};

export type MachinePolicy = { layer: undefined } | { layer: Record<string, unknown> } | { layer: 'unreadable'; problem: string };

/**
 * FR-005 (POSIX): owned by root and not group- or world-writable. `[KNOWN GAP]` macOS ACLs (`chmod +a`) are not visible in the mode, so a
 * folder whose ACL lets a group write passes (review of #1123).
 */
const trusted = (st: PolicyStat): boolean => st.uid === 0 && (st.mode & 0o022) === 0;
const noEnt = (e: unknown): boolean => (e as { code?: string } | null)?.code === 'ENOENT';

/**
 * The machine layer: `undefined` only when the folder is missing and every folder above it that exists is trusted; the parsed object when
 * every check passes; else `'unreadable'` with a short problem for the log (never the file's content).
 */
export function readMachinePolicy(platform: string = process.platform, fs: PolicyFs = nodePolicyFs, flags: CappedFlags = nodeFs.constants): MachinePolicy {
  const dir = machinePolicyDir(platform);
  if (!dir) return { layer: undefined };
  const bad = (problem: string): MachinePolicy => ({ layer: 'unreadable', problem });
  /** The folder `real` (already resolved) and every folder above it up to the root: real folders, root-owned, not writable by others. */
  const chainBad = (real: string): string | undefined => {
    for (let d = real; ; d = P.dirname(d)) {
      let st: PolicyStat;
      try {
        st = fs.lstatSync(d);
      } catch {
        return `a folder of the policy path (${d}) cannot be read`;
      }
      if (st.isSymbolicLink() || !st.isDirectory() || !trusted(st)) return `a folder of the policy path (${d}) is not owned by root or is writable by others`;
      if (P.dirname(d) === d) return undefined;
    }
  };
  try {
    let realDir: string;
    try {
      realDir = fs.realpathSync(dir);
    } catch (e) {
      if (!noEnt(e)) return bad('the policy folder cannot be resolved');
      // review of #1123: a missing folder is "no policy" only when no one but root could have removed it: the nearest folder above it
      // that exists, and every folder above that, must pass the trust check
      for (let up = P.dirname(dir); ; up = P.dirname(up)) {
        let real: string;
        try {
          real = fs.realpathSync(up);
        } catch (e2) {
          if (noEnt(e2) && P.dirname(up) !== up) continue;
          return bad('a folder above the policy folder cannot be resolved');
        }
        const why = chainBad(real);
        return why ? bad(`the policy folder is missing and ${why}`) : { layer: undefined };
      }
    }
    // FR-005: the policy folder itself and every folder above it, before anything inside it is trusted (review of #1123)
    const why = chainBad(realDir);
    if (why) return bad(why);
    const file = P.join(realDir, 'policy.json');
    let own: PolicyStat;
    try {
      own = fs.lstatSync(file); // never followed: a link is refused outright (review of #1123: a link to any root-owned JSON passed)
    } catch (e) {
      return bad(noEnt(e) ? 'policy.json is missing in the policy folder' : 'policy.json cannot be read');
    }
    if (own.isSymbolicLink()) return bad('policy.json is a link');
    if (!own.isFile()) return bad('policy.json is not a regular file');
    if (!trusted(own)) return bad('policy.json is not owned by root or is writable by others');
    // FR-031: the shared capped, no-follow, one-link read; the opened file must be the checked one and still trusted
    const r = readCapped(fs, flags, file, POLICY_MAX_BYTES, (st: PolicyStat) =>
      st.ino !== own.ino || st.dev !== own.dev || !trusted(st) ? 'policy.json changed while it was checked' : undefined,
    );
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
