/**
 * Spec 087 (T011): Claude Code's own OS sandbox as the floor under Durbar's Read-only and Ask first. Pure: no process, no I/O; every
 * platform fact is injected (constitution VI). The vendor keys (`sandbox.*` of the `--settings` JSON, `read:` research R2) stay here and
 * in `claude.ts`, never in `src/shared` (constitution II). Nothing here was run on a real session (K1, K2, K4).
 */
import type { SandboxHostView, SandboxState } from '../shared/api';
import { sandboxReason } from '../shared/sandbox';
import type { PermissionMode } from './capabilities';
import { compareVersions, parseVersion } from './detect';
import { HOME_SECRETS, homeSecretPaths, secretRelation } from './sandboxRoots';

/** FR-003: the newest key the block relies on (`network.strictAllowlist`, v2.1.219+, `read:` research R2); older or unreadable = unavailable. */
export const CLAUDE_SANDBOX_MIN_VERSION = '2.1.219';
/**
 * FR-010/FR-020: the platforms where a real session recorded that a sandboxed command could not write outside the folder or reach the
 * network (T060-T062). A platform not listed keeps "Requested; not verified on a real session." at the end of every tooltip.
 * `linux`: T060 (2026-10-25, real: Claude Code 2.1.309, bubblewrap 0.9.0): a Read-only `touch` in the folder failed with
 * "Read-only file system" (spec 087 *Changes*, 2026-10-25 T060).
 */
export const CLAUDE_SANDBOX_VERIFIED: readonly string[] = Object.freeze(['linux']);

/** The `sandbox` key of the `--settings` JSON (FR-003). Built only here. */
export interface ClaudeSandboxBlock {
  enabled: true;
  failIfUnavailable: true;
  allowUnsandboxedCommands: false;
  autoAllowBashIfSandboxed: false;
  excludedCommands: [];
  filesystem: { denyRead: string[]; allowRead: string[]; denyWrite: string[] };
  network: { allowedDomains: []; strictAllowlist: true };
}

/**
 * FR-001..FR-003: the block for a mode and the session roots (already normalised by `sandboxRoots`). Allow all: undefined (the app's
 * default). Any other value is Read-only (fail toward stricter). Never an auto-approve, a bypass or an unsandboxed retry (FR-002):
 * `autoAllowBashIfSandboxed` would approve sandboxed Bash without Durbar's card, `allowUnsandboxedCommands` would let Claude retry
 * a command outside the sandbox. Reads: the home folder denied except the roots (decision Q4); Read-only also denies writes to the
 * roots (K2); network: no domain and a strict allow-list, so an unlisted host is refused, never asked (decision Q2).
 */
export function claudeSandboxSettings(mode: PermissionMode | string, roots: readonly string[], home?: string, realpath: (p: string) => string = (p) => p, platform: string = process.platform): ClaudeSandboxBlock | undefined {
  if (mode === 'allow') return undefined;
  // review round 2 on PR 733: a link in place of a credential folder is denied at its target too (Claude follows it only on macOS);
  // a root that is a credential folder or inside one is left out of allowRead (the docs give no rule for an allow and a deny on one path)
  const hs = home ? homeSecretPaths(home, realpath) : { literal: [], targets: [] };
  const r = roots.filter((x) => secretRelation(x, [...hs.literal, ...hs.targets], platform) !== 'inside');
  const secrets = [...HOME_SECRETS.map((x) => `~/${x}`), ...hs.targets];
  return {
    enabled: true,
    failIfUnavailable: true,
    allowUnsandboxedCommands: false,
    autoAllowBashIfSandboxed: false,
    excludedCommands: [],
    // the credential folders are denied even when a root is the home folder or a parent of it: for reads the narrower rule wins
    // (`read:` docs "the rule with the narrower path applies"; a deny "holds inside a wider allow"); for writes the docs give no rule (K2)
    filesystem: { denyRead: ['~/', ...secrets], allowRead: r, denyWrite: [...(mode === 'ask' ? [] : [...roots]), ...secrets] },
    network: { allowedDomains: [], strictAllowlist: true },
  };
}

/** The `--settings` JSON with Durbar's block as its `sandbox` key (replacing any other), or without a `sandbox` key when `block` is undefined. */
export function withSandboxSettings(settingsJson: string | undefined, block: ClaudeSandboxBlock | undefined): string | undefined {
  let base: Record<string, unknown> = {};
  if (settingsJson) {
    try {
      const v = JSON.parse(settingsJson) as unknown;
      if (v && typeof v === 'object' && !Array.isArray(v)) base = v as Record<string, unknown>;
    } catch {
      base = {};
    }
  }
  const { sandbox: _drop, ...rest } = base; // FR-003: a folder's own `sandbox` key never survives; Durbar's block (or none) wins
  void _drop;
  const out = block ? { ...rest, sandbox: block } : rest;
  return Object.keys(out).length ? JSON.stringify(out) : undefined;
}

/** What Durbar knows about the host before it tries (FR-006). Injected; the adapter fills it from detection (no shell). */
export interface ClaudeSandboxFacts {
  platform: string;
  /** `claude --version` as printed (parsed with `parseVersion`); undefined = unreadable. */
  version?: string;
  haveBwrap?: boolean;
  haveSocat?: boolean;
}

export type ClaudeSandboxPre =
  | { try: true; mechanism: 'seatbelt' | 'bubblewrap' }
  | { try: false; reason: string; fix?: string; /** FR-007c: the host can never sandbox this app (native Windows). */ permanent: boolean };

export const CLAUDE_WIN_REASON = "Claude Code has no OS sandbox on Windows; Durbar's own checks still apply (only WSL2 has one).";

/** FR-006: whether to try. These checks never set `on`: only the CLI's `system`/`init` with `failIfUnavailable: true` does. */
export function claudeSandboxPrecheck(f: ClaudeSandboxFacts): ClaudeSandboxPre {
  const v = typeof f?.version === 'string' ? parseVersion(f.version) : undefined;
  if (f?.platform === 'win32') return { try: false, reason: CLAUDE_WIN_REASON, permanent: true };
  if (!v || compareVersions(v, CLAUDE_SANDBOX_MIN_VERSION) < 0)
    return { try: false, reason: "This Claude Code is too old for Durbar's sandbox settings.", fix: `Update Claude Code to ${CLAUDE_SANDBOX_MIN_VERSION} or later (Settings > Agent apps).`, permanent: false };
  if (f.platform === 'darwin') return { try: true, mechanism: 'seatbelt' };
  if (f.platform === 'linux') {
    const missing = [...(f.haveBwrap ? [] : ['bubblewrap']), ...(f.haveSocat ? [] : ['socat'])];
    if (missing.length) return { try: false, reason: `Claude Code's Linux sandbox needs ${missing.join(' and ')}, which ${missing.length > 1 ? 'are' : 'is'} not installed.`, fix: `Install ${missing.join(' and ')} (for example: sudo apt install ${missing.join(' ')}). On Ubuntu 24.04+ AppArmor may also block bubblewrap: see the README (Safety model).`, permanent: false };
    return { try: true, mechanism: 'bubblewrap' };
  }
  return { try: false, reason: 'Claude Code has no OS sandbox Durbar knows on this system.', permanent: false };
}

/**
 * FR-006 (K4): an exit before Claude's `system`/`init` that is the sandbox's own refusal, told by its stderr tail (masked), or undefined
 * for any other exit (the crash path). The CLI's exact message and exit code are not known (no real run), so the rule is narrow: the
 * word "sandbox" and a failure word on one line. Never a guess from the exit code alone.
 */
export function claudeSandboxExit(info: { code: number | null; stderrTail: string }): string | undefined {
  const lines = typeof info?.stderrTail === 'string' ? info.stderrTail.split(/\r?\n/) : [];
  const hit = lines.find((l) => /\bsandbox/i.test(l) && /\b(unavailable|not available|cannot|can't|could not|couldn't|failed|failure|unsupported|not supported|missing|requires?|blocked|denied|not permitted)\b|failIfUnavailable/i.test(l));
  return hit === undefined ? undefined : sandboxReason(hit) ?? 'Claude Code could not start its sandbox.';
}

/**
 * FR-006/FR-011: Claude's normalized state. Allow all: null (nothing shown). `continued`: the person chose *Continue without the OS
 * sandbox* (or *Always continue*, FR-007c). `startExit`: the classified reason of a sandbox exit before `init`. `started`: `init`
 * arrived from a CLI launched with the block. Nothing else gives `on`. `pre`: a pre-check the caller already made (the SDK transport).
 */
export function claudeSandboxState(i: { mode: PermissionMode | string; facts: ClaudeSandboxFacts; started?: boolean; startExit?: string; continued?: boolean; pre?: ClaudeSandboxPre }): SandboxState | null {
  if (i.mode === 'allow') return null;
  const writes = i.mode === 'ask' ? 'folders' : 'none';
  const verified = CLAUDE_SANDBOX_VERIFIED.includes(i.facts.platform);
  const pre = i.pre ?? claudeSandboxPrecheck(i.facts);
  const base = { covers: ['shell'] as SandboxState['covers'], writes, verified } as const;
  if (!pre.try) return { ...base, state: 'off', reason: sandboxReason(pre.reason) };
  if (i.startExit !== undefined) return { ...base, state: 'off', mechanism: pre.mechanism, reason: sandboxReason(i.startExit) ?? 'Claude Code could not start its sandbox.' };
  if (i.continued) return { ...base, state: 'off', mechanism: pre.mechanism, reason: 'You chose to continue without the OS sandbox for this session.' };
  if (i.started) return { ...base, state: 'on', mechanism: pre.mechanism };
  return { ...base, state: 'unknown', mechanism: pre.mechanism, reason: 'Waiting for Claude Code to confirm its sandbox at the start.' };
}

/** FR-012: the Settings > Agent apps line. */
export function claudeSandboxHost(f: ClaudeSandboxFacts): SandboxHostView {
  const pre = claudeSandboxPrecheck(f);
  return pre.try ? { available: true, mechanism: pre.mechanism } : { available: false, reason: sandboxReason(pre.reason), ...(pre.fix ? { fix: pre.fix } : {}) };
}
