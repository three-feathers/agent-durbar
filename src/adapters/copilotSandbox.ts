/**
 * Spec 087 (T012): Copilot's local sandbox as the floor under Durbar's Read-only and Ask first. Pure: structural types only (no SDK
 * import), every platform fact injected. The shapes follow `@github/copilot-sdk` 1.0.22 `rpc.d.ts` (`SandboxConfig`,
 * `SandboxHostSupport`, all `@experimental`; `read:` research R4). Nothing here was run on a real session (K8, K9, K10).
 */
import * as path from 'path';
import type { SandboxHostView, SandboxState } from '../shared/api';
import { sandboxReason } from '../shared/sandbox';
import type { PermissionMode } from './capabilities';
import { normalizeRoot } from './sandboxRoots';

/** FR-010/FR-020: platforms where a real session recorded that the floor held (T060-T062). Empty until then. */
export const COPILOT_SANDBOX_VERIFIED: readonly string[] = Object.freeze([]);
export const COPILOT_NO_REPORT = 'this Copilot cannot report its sandbox';

/** `SandboxHostSupport`, checked (FR-006). */
export interface CopilotHostSupport {
  supported: boolean;
  reason?: string;
  capabilities: string[];
}

/** The answer of `client.rpc.sandbox.getHostSupport()`, or undefined when it is malformed (then: unavailable, fail closed). */
export function copilotHostSupport(raw: unknown): CopilotHostSupport | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as { supported?: unknown; reason?: unknown; capabilities?: unknown };
  if (typeof o.supported !== 'boolean') return undefined;
  const caps = Array.isArray(o.capabilities)
    ? o.capabilities.slice(0, 50).filter((c): c is { name: string; supported?: unknown } => !!c && typeof c === 'object' && typeof (c as { name?: unknown }).name === 'string').filter((c) => c.supported !== false).map((c) => c.name.slice(0, 60))
    : [];
  return { supported: o.supported, ...(typeof o.reason === 'string' ? { reason: o.reason } : {}), capabilities: o.supported ? caps : [] };
}

/** The `SandboxConfig` Durbar sends (a structural copy: only the fields used). */
export interface CopilotSandboxConfig {
  enabled: true;
  addCurrentWorkingDirectory: false;
  userPolicy: {
    filesystem: { readwritePaths: string[]; readonlyPaths: string[]; deniedPaths?: string[] };
    network: { allowOutbound: false; allowLocalNetwork: false };
  };
  sandboxMcpServers: true;
  sandboxLspServers: true;
  auth: { git: false; gh: false };
  allowDevToolAccess: false;
}

const fold = (p: string, platform: string): string => (platform === 'win32' || platform === 'darwin' ? p.toLowerCase() : p);

/**
 * FR-004: the folders of the session's `PATH` entries as read-only grants (instead of `allowDevToolAccess`, which also grants writes).
 * Normalised by FR-015's rule (absolute, no `..`, no filesystem root, no quote or control character); dropped when the entry equals
 * the home folder, is an ancestor of it (`/home`, `/Users`, `C:\Users`) or is any user's profile root (a folder directly in such a
 * parent), compared case-insensitively on Windows and macOS. So `~/.ssh` and `~/.aws` never become readable through `PATH`; a folder
 * under home such as `~/.local/bin` is kept (its contents become readable, said in the tooltip details).
 */
export function copilotPathReadDirs(pathDirs: readonly unknown[], home: string, platform: string): string[] {
  const api = platform === 'win32' ? path.win32 : path.posix;
  const h = normalizeRoot(home);
  const homeKey = h ? fold(h.path, platform) : undefined;
  const sep = platform === 'win32' ? '\\' : '/';
  const parents = new Set<string>();
  if (h) {
    const up = api.dirname(h.path);
    if (up !== api.parse(up).root) parents.add(fold(up, platform)); // `/root` has `/` as its parent: no "profile parent" then
  }
  if (platform === 'win32') {
    const drive = h ? api.parse(h.path).root : 'C:\\';
    parents.add(fold(api.join(drive, 'Users'), platform));
  } else for (const p of ['/home', '/Users', '/var/home']) parents.add(fold(p, platform));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const d of Array.isArray(pathDirs) ? pathDirs : []) {
    if (typeof d !== 'string') continue;
    const n = normalizeRoot(d);
    if (!n) continue;
    const k = fold(n.path, platform);
    if (homeKey && (k === homeKey || homeKey.startsWith(k + sep))) continue; // home, or an ancestor of it
    if (parents.has(k) || parents.has(fold(api.dirname(n.path), platform))) continue; // a profile parent, or some user's profile root
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n.path);
  }
  return out.slice(0, 200);
}

/**
 * FR-001/FR-002/FR-004/FR-014: the config for a mode. Allow all: undefined (nothing is sent; the app default). Any other value is
 * Read-only. Never `allowBypass` (fail closed: omitting it offers no bypass), never credential injection (`auth` off, no `credentials`),
 * never `allowDevToolAccess` (it grants writes). `deniedPaths` only where the host reports `denied_paths` (else it is not claimed).
 */
export function copilotSandboxConfig(i: { mode: PermissionMode | string; roots: readonly string[]; pathDirs: readonly unknown[]; host: CopilotHostSupport; home: string; platform: string }): CopilotSandboxConfig | undefined {
  if (i.mode === 'allow') return undefined;
  const ask = i.mode === 'ask';
  const api = i.platform === 'win32' ? path.win32 : path.posix;
  const tools = copilotPathReadDirs(i.pathDirs, i.home, i.platform);
  const denied = i.host.capabilities.includes('denied_paths');
  const h = normalizeRoot(i.home);
  const deniedPaths = denied
    ? [...(ask ? i.roots.flatMap((r) => [api.join(r, '.git', 'hooks'), api.join(r, '.git', 'config')]) : []), ...(h ? [api.join(h.path, '.ssh'), api.join(h.path, '.aws'), api.join(h.path, '.config', 'gh')] : [])]
    : undefined;
  return {
    enabled: true,
    addCurrentWorkingDirectory: false,
    userPolicy: {
      filesystem: { readwritePaths: ask ? [...i.roots] : [], readonlyPaths: [...(ask ? [] : i.roots), ...tools], ...(deniedPaths ? { deniedPaths } : {}) },
      network: { allowOutbound: false, allowLocalNetwork: false },
    },
    sandboxMcpServers: true,
    sandboxLspServers: true,
    auth: { git: false, gh: false },
    allowDevToolAccess: false,
  };
}

/** The mechanism Copilot names per platform (SDK `SandboxHostSupport`: Seatbelt, Bubblewrap, ProcessContainer). */
const mechanismOf = (platform: string): SandboxState['mechanism'] => (platform === 'darwin' ? 'seatbelt' : platform === 'win32' ? 'processcontainer' : 'bubblewrap');

/**
 * FR-006/FR-008/FR-011: Copilot's normalized state. Allow all: null, unless a floor set earlier in this session stays (`untilNewSession`).
 * `on` only after `options.update` was accepted (`applied`). `host` missing or `supported: false`, a refused update (`refused`) or a
 * `session.warning` of type `sandbox` (`warning`) give `off` with the masked reason.
 */
export function copilotSandboxState(i: { mode: PermissionMode | string; platform: string; host?: CopilotHostSupport; applied?: boolean; refused?: string; warning?: string; continued?: boolean; keptFloor?: boolean }): SandboxState | null {
  const verified = COPILOT_SANDBOX_VERIFIED.includes(i.platform);
  const covers: SandboxState['covers'] = ['shell', 'mcp'];
  const mechanism = mechanismOf(i.platform);
  if (i.mode === 'allow') return i.keptFloor && !i.warning ? { state: 'on', mechanism, covers, untilNewSession: true, verified } : null;
  const writes = i.mode === 'ask' ? 'folders' : 'none';
  const base = { covers, writes, verified } as const;
  if (!i.host) return { ...base, state: 'off', reason: sandboxReason(COPILOT_NO_REPORT) };
  if (!i.host.supported) return { ...base, state: 'off', reason: sandboxReason(i.host.reason) ?? 'Copilot says this computer cannot run its sandbox.' };
  if (i.warning !== undefined) return { ...base, state: 'off', mechanism, reason: sandboxReason(i.warning) ?? 'Copilot reported a sandbox problem.' };
  if (i.refused !== undefined) return { ...base, state: 'off', mechanism, reason: sandboxReason(`Copilot refused the sandbox settings: ${i.refused}`) };
  if (i.continued) return { ...base, state: 'off', mechanism, reason: 'You chose to continue without the OS sandbox for this session.' };
  if (i.applied) return { ...base, state: 'on', mechanism };
  return { ...base, state: 'unknown', mechanism, reason: 'Waiting for Copilot to accept the sandbox settings.' };
}

/** FR-012 and research R4: the fix for an unsupported host, by platform. */
export function copilotSandboxFix(platform: string): string | undefined {
  if (platform === 'linux') return 'Install bubblewrap 0.5.0 or later and slirp4netns (for example: sudo apt install bubblewrap slirp4netns). On Ubuntu 24.04+ AppArmor may also block bubblewrap: see the README (Safety model).';
  if (platform === 'win32') return 'Copilot needs Windows 11 25H2 with KB5124010 or later, or 26H1 with KB5124006 or later.';
  return undefined;
}

/** FR-012: the Settings > Agent apps line. */
export function copilotSandboxHost(host: CopilotHostSupport | undefined, platform: string): SandboxHostView {
  if (!host) return { available: false, reason: sandboxReason(COPILOT_NO_REPORT) };
  if (!host.supported) return { available: false, reason: sandboxReason(host.reason) ?? 'Copilot says this computer cannot run its sandbox.', ...(copilotSandboxFix(platform) ? { fix: copilotSandboxFix(platform) } : {}) };
  return { available: true, mechanism: mechanismOf(platform) };
}
