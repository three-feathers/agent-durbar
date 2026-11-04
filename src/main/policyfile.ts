/**
 * Spec 076 FR-209 (P1, first slice; issue #734): the machine `policy.json`, read for spec 087's `permissions.requireOsSandbox`.
 * Pure apart from the injected file system: a fixed path per OS (FR-002), FR-005's trust check after `realpath` on every component up to
 * the root, FR-009's size cap, and FR-010's whole-file failure as `'unreadable'` (which the sandbox rule reads as "required").
 * Windows reads nothing in this slice (`[KNOWN GAP]`, its reader needs `SHGetKnownFolderPath`).
 */
import * as nodeFs from 'fs';
import * as path from 'path';

/** FR-009: the largest `policy.json` read. */
export const POLICY_MAX_BYTES = 256 * 1024;

/** FR-002: the machine folder per OS, fixed in code (no environment variable, hook or setting moves it); `undefined` where none is read yet. */
export function machinePolicyDir(platform: string): string | undefined {
  if (platform === 'darwin') return '/Library/Application Support/AgentDurbar/managed';
  if (platform === 'linux') return '/etc/agent-durbar/managed';
  return undefined; // win32: [KNOWN GAP] (FR-002 needs SHGetKnownFolderPath through koffi)
}

export interface PolicyStat { uid: number; mode: number; ino: number; size: number; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }
export interface PolicyFs {
  realpathSync(p: string): string;
  lstatSync(p: string): PolicyStat;
  /** Opens without following a final link, reads at most `max + 1` bytes, and returns them with the stat of the opened file. */
  readNoFollow(p: string, max: number): { bytes: Buffer; st: PolicyStat };
}

/** The real file system: `O_NOFOLLOW` where the OS has it, and the opened file's own stat (so a swap after the checks is seen). */
export const nodePolicyFs: PolicyFs = {
  realpathSync: (p) => nodeFs.realpathSync(p),
  lstatSync: (p) => nodeFs.lstatSync(p),
  readNoFollow(p, max) {
    const fd = nodeFs.openSync(p, nodeFs.constants.O_RDONLY | (nodeFs.constants.O_NOFOLLOW ?? 0));
    try {
      const st = nodeFs.fstatSync(fd);
      const buf = Buffer.alloc(Math.min(st.size, max) + 1);
      const n = nodeFs.readSync(fd, buf, 0, buf.length, 0);
      return { bytes: buf.subarray(0, n), st: Object.assign(st, { isSymbolicLink: () => false }) };
    } finally {
      nodeFs.closeSync(fd);
    }
  },
};

export type MachinePolicy = { layer: undefined } | { layer: Record<string, unknown> } | { layer: 'unreadable'; problem: string };

/** FR-005 (POSIX): owned by root and not group- or world-writable. */
const trusted = (st: PolicyStat): boolean => st.uid === 0 && (st.mode & 0o022) === 0;

/**
 * The machine layer: `undefined` with no machine folder; the parsed object when it passes every check; else `'unreadable'` with a short
 * problem for the log (never the file's content).
 */
export function readMachinePolicy(platform: string = process.platform, fs: PolicyFs = nodePolicyFs): MachinePolicy {
  const dir = machinePolicyDir(platform);
  if (!dir) return { layer: undefined };
  let realDir: string;
  try {
    realDir = fs.realpathSync(dir);
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') return { layer: undefined }; // no machine policy: nothing changes
    return { layer: 'unreadable', problem: 'the policy folder cannot be resolved' };
  }
  const bad = (problem: string): MachinePolicy => ({ layer: 'unreadable', problem });
  try {
    if (!fs.lstatSync(realDir).isDirectory()) return bad('the policy folder is not a folder');
    const file = path.join(dir, 'policy.json');
    let real: string;
    try {
      real = fs.realpathSync(file);
    } catch {
      return bad('policy.json is missing in the policy folder');
    }
    // FR-005 after realpath: the file and every folder up to the root, each checked with lstat (no component is a link any more)
    const own = fs.lstatSync(real);
    if (own.isSymbolicLink() || !own.isFile()) return bad('policy.json is not a regular file');
    if (!trusted(own)) return bad('policy.json is not owned by root or is writable by others');
    for (let d = path.dirname(real); ; d = path.dirname(d)) {
      const st = fs.lstatSync(d);
      if (st.isSymbolicLink() || !st.isDirectory() || !trusted(st)) return bad(`a folder above policy.json (${d}) is not owned by root or is writable by others`);
      if (path.dirname(d) === d) break;
    }
    const { bytes, st } = fs.readNoFollow(real, POLICY_MAX_BYTES);
    if (st.ino !== own.ino || !st.isFile() || !trusted(st)) return bad('policy.json changed while it was checked');
    if (bytes.length > POLICY_MAX_BYTES) return bad('policy.json is larger than 256 KiB');
    let text = bytes.toString('utf8');
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
