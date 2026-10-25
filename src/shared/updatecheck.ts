/**
 * Agent-app update check (spec 081): the pure part. Which install source owns a copy, the fixed check commands, the strict
 * parsers for what those tools and the vendors' release endpoints answer, the decision, the failure classes, the announce rule
 * and the policy filter. No I/O: `src/main/updatecheck.ts` runs the checks, `src/main/harnesssetup.ts` runs the updates.
 *
 * Everything that comes back from a tool or a server is untrusted: a version is taken from one structured field only, rejected
 * (never cut) when longer than 64 characters, and matched by one anchored, bounded pattern (FR-005).
 */
import * as path from 'path';
import { compareVersions } from '../adapters/detect';
import { CASKS, PACKAGES, routeOwning } from './harnesssetup';
import { MAX_VERSION_LENGTH, parseVersionField } from './versionfield';
import type { SetupKind } from './harnesssetup';

// ---------------------------------------------------------------------------------------------------------------------
// Versions (FR-005, SC-008)

export { MAX_VERSION_LENGTH, parseVersionField } from './versionfield';
/** Output cap for every tool and every body (64 KiB). */
export const MAX_TOOL_OUTPUT = 64 * 1024;

const isPre = (v: string): boolean => v.includes('-');
const core = (v: string): string => v.split('-')[0];

/** The decision of one check (FR-004, FR-005): a source behind the installed version offers nothing; a pre-release counts only on the same line. */
export function decide(installed: string, latest: string): { state: 'update-available' | 'up-to-date'; installedNewer?: boolean } {
  const c = compareVersions(installed, latest);
  if (c >= 0) return { state: 'up-to-date', ...(c > 0 ? { installedNewer: true } : {}) };
  // "latest" is the newest stable version: a pre-release of the source counts only when the installed one is a pre-release of the same line
  if (isPre(latest) && !(isPre(installed) && core(installed) === core(latest))) return { state: 'up-to-date' };
  return { state: 'update-available' };
}

// ---------------------------------------------------------------------------------------------------------------------
// Install source (FR-001, FR-006, plan D2)

export { PACKAGES, CASKS } from './harnesssetup';
export const WINGET_IDS: Readonly<Partial<Record<SetupKind, string>>> = Object.freeze({ claude: 'Anthropic.ClaudeCode', copilot: 'GitHub.Copilot' });

export type OutsideHint = 'distro' | 'snap' | 'scoop' | 'formula' | 'winget';
export type UpdateSource =
  | { kind: 'npm'; npm?: string }
  | { kind: 'brew'; prefix: string; cask: string }
  | { kind: 'winget'; id: string }
  | { kind: 'official'; app: SetupKind }
  | { kind: 'outside'; hint?: OutsideHint };

export interface SourceEnv {
  homedir: string;
  env: Readonly<Record<string, string | undefined>>;
}

export const pathFor = (platform: string): path.PlatformPath => (platform === 'win32' ? path.win32 : path.posix);
const caseless = (platform: string): boolean => platform === 'win32' || platform === 'darwin';
const MAX_PATH = 1024;

/** Words for the card (FR-001). */
export function sourceLabel(s: UpdateSource): string {
  switch (s.kind) {
    case 'npm': return 'npm';
    case 'brew': return 'Homebrew';
    case 'winget': return 'winget';
    case 'official': return 'the official installer';
    default: return "installed outside Durbar's routes";
  }
}

function brewPrefixes(env: SourceEnv, platform: string): string[] {
  const p = pathFor(platform);
  const out = ['/opt/homebrew', '/usr/local', '/home/linuxbrew/.linuxbrew'];
  if (env.homedir && p.isAbsolute(env.homedir)) out.push(`${env.homedir.replace(/\\/g, '/').replace(/\/+$/, '')}/.linuxbrew`);
  return out;
}

/**
 * Which source installed the copy at this real path (symlinks already resolved by the caller), and which tool belongs to it.
 * Built on `routeOwning` for the kind. `/usr/local` counts as Homebrew only when the real path is under `Caskroom` (an Intel Mac
 * links `/usr/local/bin/x` into it), never by the prefix alone (research R5).
 */
export function sourceOf(app: SetupKind, realPath: string, platform: string, env: SourceEnv): UpdateSource {
  const outside = (hint?: OutsideHint): UpdateSource => ({ kind: 'outside', ...(hint ? { hint } : {}) });
  const p = pathFor(platform);
  if (typeof realPath !== 'string' || !realPath || realPath.length > MAX_PATH || !p.isAbsolute(realPath)) return outside();
  const norm = platform === 'win32' ? realPath.replace(/\\/g, '/') : realPath;
  const fold = (s: string): string => (caseless(platform) ? s.toLowerCase() : s);
  const segs = norm.split('/').filter(Boolean);
  const lsegs = segs.map(fold);
  const joinAbs = (parts: string[]): string => (platform === 'win32' ? parts.join('\\') : '/' + parts.join('/'));

  if (lsegs.includes('scoop') && (lsegs.includes('apps') || lsegs.includes('shims'))) return outside('scoop');
  if (platform === 'linux' && lsegs[0] === 'snap') return outside('snap');

  // npm: the copy lives in a node_modules folder, or is an npm shim (%APPDATA%\npm\x.cmd)
  const nm = lsegs.indexOf('node_modules');
  const shim = platform === 'win32' && lsegs.length >= 2 && lsegs[lsegs.length - 2] === 'npm' && /\.cmd$/.test(lsegs[lsegs.length - 1]);
  if (nm >= 0 || shim) {
    let npm: string | undefined;
    if (shim) npm = joinAbs([...segs.slice(0, -1), 'npm.cmd']);
    else if (platform === 'win32') npm = joinAbs([...segs.slice(0, nm), 'npm.cmd']);
    else if (lsegs[nm - 1] === 'lib') npm = joinAbs([...segs.slice(0, nm - 1), 'bin', 'npm']);
    return { kind: 'npm', ...(npm ? { npm } : {}) };
  }

  const bi = lsegs.findIndex((s) => s === 'caskroom' || s === 'cellar');
  if (bi >= 0) {
    const prefix = joinAbs(segs.slice(0, bi));
    if (!brewPrefixes(env, platform).includes(prefix)) return outside();
    if (lsegs[bi] === 'cellar') return outside('formula'); // a formula copy: Durbar's routes are casks only
    const cask = segs[bi + 1];
    if (!cask || !CASKS[app].includes(cask)) return outside();
    return { kind: 'brew', prefix, cask };
  }
  const bp = brewPrefixes(env, platform).find((x) => x !== '/usr/local' && (norm === x || norm.startsWith(x + '/')));
  if (bp && platform !== 'win32') return { kind: 'brew', prefix: bp, cask: CASKS[app][0] };

  const wi = lsegs.indexOf('winget');
  if (wi >= 0 && (lsegs[wi + 1] === 'packages' || lsegs[wi + 1] === 'links')) {
    const id = WINGET_IDS[app];
    if (!id) return outside('winget');
    if (lsegs[wi + 1] === 'packages' && segs[wi + 2] && !fold(segs[wi + 2]).startsWith(fold(id))) return outside();
    return { kind: 'winget', id };
  }

  if (platform === 'linux' && (lsegs[0] === 'usr' && (lsegs[1] === 'bin' || lsegs[1] === 'sbin') || lsegs[0] === 'bin')) return outside('distro');

  // the vendor's own installer: Codex's standalone folder, the Copilot CLI's pkg folder, and what routeOwning counts as official
  if (app === 'codex' && isInsideCodexStandalone(norm, platform, env, false)) return { kind: 'official', app };
  const home = env.homedir && p.isAbsolute(env.homedir) ? fold(env.homedir.replace(/\\/g, '/').replace(/\/+$/, '')) : undefined;
  const lnorm = fold(norm);
  if (app === 'copilot' && home && lnorm.startsWith(home + '/.copilot/pkg/')) return { kind: 'official', app };
  if (routeOwning(norm) === 'official' && home && lnorm.startsWith(home + '/')) return { kind: 'official', app };
  if (routeOwning(norm) === 'official' && platform === 'win32' && /\/programs\//i.test(norm)) return { kind: 'official', app };
  return outside();
}

/** The npm that owns an npm copy: the one next to the node_modules folder if it exists, else a found npm whose folder holds the copy (FR-006). */
export function npmOwns(npmPath: string, realPath: string, platform: string): boolean {
  const p = pathFor(platform);
  const f = (s: string): string => (caseless(platform) ? s.toLowerCase() : s);
  const dir = p.dirname(npmPath);
  const prefix = platform === 'win32' ? dir : p.dirname(dir); // POSIX: <prefix>/bin/npm
  const rel = p.relative(f(prefix), f(realPath));
  return !!rel && !rel.startsWith('..') && !p.isAbsolute(rel);
}

// ---------------------------------------------------------------------------------------------------------------------
// The official Codex CLI (FR-009, plan D3): the one place the standalone rule is written

function isInsideCodexStandalone(realPath: string, platform: string, env: SourceEnv, releases: boolean): boolean {
  const p = pathFor(platform);
  const f = (s: string): string => (caseless(platform) ? s.toLowerCase() : s);
  const ch = env.env.CODEX_HOME;
  let base: string;
  if (ch !== undefined && ch !== '') {
    if (!p.isAbsolute(ch)) return false;
    base = ch;
  } else {
    if (!env.homedir || !p.isAbsolute(env.homedir)) return false;
    base = p.join(env.homedir, '.codex');
  }
  const real = platform === 'win32' ? realPath.replace(/\//g, '\\') : realPath;
  if (!p.isAbsolute(real) || real.split(/[\\/]/).includes('..')) return false;
  const root = p.join(base, 'packages', 'standalone', ...(releases ? ['releases'] : []));
  const rel = p.relative(f(p.normalize(root)), f(p.normalize(real)));
  return !!rel && rel !== '..' && !rel.startsWith('..' + p.sep) && !p.isAbsolute(rel);
}

export interface OfficialCodexInput {
  realPath: string;
  platform: string;
  env: SourceEnv;
  /** The first word of `codex --version` (the official label is `codex-cli`). */
  label?: string;
  /** `trustedPath` passed (not in a folder anyone can change). */
  trusted: boolean;
  /** The file is a regular file. */
  regular: boolean;
}

/**
 * True only for the official Codex CLI in OpenAI's standalone layout (owner decision Q3 = C, limited): the real path inside
 * `<CODEX_HOME or ~/.codex>/packages/standalone/releases/` on every OS (a separator at the boundary, no `..`, case-insensitive on
 * Windows and macOS), a trusted regular file, and the label `codex-cli`. The Windows `install.ps1` folder is not that layout.
 */
export function isOfficialCodex(i: OfficialCodexInput): boolean {
  return i.trusted && i.regular && i.label === 'codex-cli' && isInsideCodexStandalone(i.realPath, i.platform, i.env, true);
}

/** The first word of `codex --version` through detection's bounded first-line rule (the label is `codex-cli` for OpenAI's build). */
export function versionLabel(stdout: string): string | undefined {
  const line = String(stdout ?? '').slice(0, 201).split(/[\r\n]/, 1)[0];
  const m = /^[ \t]*([A-Za-z][A-Za-z-]{0,20})[ \t]+v?\d/.exec(line.slice(0, 200));
  return m ? m[1] : undefined;
}

/** Read from Codex's source (`codex-rs/tui/src/update_action.rs` @970111f6): the command `codex update` runs for the standalone layout. */
export const CODEX_UPDATE_COMMAND: Readonly<Record<'posix' | 'win32', string>> = Object.freeze({
  posix: 'sh -c "curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh"',
  win32: 'powershell -ExecutionPolicy Bypass -c "$env:CODEX_NON_INTERACTIVE=1; irm https://chatgpt.com/codex/install.ps1 | iex"',
});

const MANAGED_BY = ['CODEX_MANAGED_BY_NPM', 'CODEX_MANAGED_BY_PNPM', 'CODEX_MANAGED_BY_BUN', 'CODEX_MANAGED_BY_VITE_PLUS'];

/**
 * The environment of the `codex update` child: no `CODEX_MANAGED_BY_*` (Codex reads them before its path checks, so one set would
 * make it run `npm install -g` while the confirmation shows the installer script), and a fixed system `PATH` so `sh`, `curl` and
 * `powershell` cannot come from a user's folder. Windows gets System32 and friends from an absolute `SystemRoot` only.
 */
export function codexUpdateEnv(base: NodeJS.ProcessEnv, platform: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    const up = k.toUpperCase();
    if (MANAGED_BY.includes(up)) continue;
    if (up === 'PATH' && platform === 'win32') continue; // set below, one spelling
    if (up === 'PATH') continue;
    env[k] = v;
  }
  if (platform === 'win32') {
    const root = base.SystemRoot ?? base.SYSTEMROOT;
    const sys = root && path.win32.isAbsolute(root) ? root : 'C:\\Windows';
    env.Path = [path.win32.join(sys, 'System32'), sys, path.win32.join(sys, 'System32', 'WindowsPowerShell', 'v1.0')].join(';');
  } else {
    env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
  }
  return env;
}

// ---------------------------------------------------------------------------------------------------------------------
// Check commands (FR-004, plan D3): fixed argv tables

export interface CheckCmd {
  tool: 'npm' | 'brew' | 'winget';
  args: string[];
  /** Added to that child's environment only. */
  env: Record<string, string>;
}

export const npmCheck = (app: SetupKind): CheckCmd => ({ tool: 'npm', args: ['view', PACKAGES[app], 'version', '--json', '--no-update-notifier'], env: { npm_config_update_notifier: 'false' } });
export const brewInfoCmd = (cask: string): CheckCmd => ({ tool: 'brew', args: ['info', '--cask', '--json=v2', cask], env: { HOMEBREW_NO_AUTO_UPDATE: '1' } });
export const brewOutdatedCmd = (cask: string, greedy: boolean): CheckCmd => ({ tool: 'brew', args: ['outdated', '--cask', '--json=v2', ...(greedy ? ['--greedy'] : []), cask], env: { HOMEBREW_NO_AUTO_UPDATE: '1' } });
/** The background check never accepts source agreements for the user; only an explicit check, after the terms note, adds the flag. */
export const wingetCheck = (id: string, acceptAgreements = false): CheckCmd => ({ tool: 'winget', args: ['list', '--id', id, '-e', '--upgrade-available', '--source', 'winget', ...(acceptAgreements ? ['--accept-source-agreements'] : [])], env: {} });

// ---------------------------------------------------------------------------------------------------------------------
// Parsers for the structured answers (FR-005): every one is size-capped, own properties only, and ends in parseVersionField

const own = (o: unknown, k: string): unknown => (o && typeof o === 'object' && !Array.isArray(o) && Object.prototype.hasOwnProperty.call(o, k) ? (o as Record<string, unknown>)[k] : undefined);
function json(text: string): unknown {
  if (typeof text !== 'string' || text.length > MAX_TOOL_OUTPUT) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}

/** `npm view <pkg> version --json` prints one JSON string. An error line (`node v22.11.0`) is not JSON, so it is never a version. */
export function parseNpmView(stdout: string): string | undefined {
  const v = json(String(stdout ?? '').trim());
  return typeof v === 'string' ? parseVersionField(v) : undefined;
}

/** A version field with Homebrew's `,build` suffix removed at the first comma (the length check is on the whole field first). */
function brewVersion(field: unknown): string | undefined {
  if (typeof field !== 'string' || field.length > MAX_VERSION_LENGTH) return undefined;
  return parseVersionField(field.split(',', 1)[0]);
}

export interface BrewInfo { latest: string; installed?: string; outdated?: boolean; autoUpdates: boolean }
/** `brew info --cask --json=v2 <cask>`. */
export function parseBrewInfo(stdout: string, cask: string): BrewInfo | undefined {
  const casks = own(json(String(stdout ?? '').trim()), 'casks');
  if (!Array.isArray(casks)) return undefined;
  for (const c of casks.slice(0, 20)) {
    if (own(c, 'token') !== cask) continue;
    const latest = brewVersion(own(c, 'version'));
    if (!latest) return undefined;
    const installed = brewVersion(own(c, 'installed'));
    const o = own(c, 'outdated');
    return { latest, ...(installed ? { installed } : {}), ...(typeof o === 'boolean' ? { outdated: o } : {}), autoUpdates: own(c, 'auto_updates') === true };
  }
  return undefined;
}

/** `brew outdated --cask --json=v2 <cask>`: the cask's `current_version` when it is listed, `null` when the list is empty, undefined when unreadable. */
export function parseBrewOutdated(stdout: string, cask: string): { current: string } | null | undefined {
  const casks = own(json(String(stdout ?? '').trim()), 'casks');
  if (!Array.isArray(casks)) return undefined;
  for (const c of casks.slice(0, 20)) {
    if (own(c, 'name') !== cask) continue;
    const current = brewVersion(own(c, 'current_version'));
    return current ? { current } : undefined;
  }
  return null;
}

export type WingetAnswer = { kind: 'available'; installed?: string; available: string } | { kind: 'current' } | { kind: 'terms' } | { kind: 'unknown' };
/** `winget list --id <id> -e --upgrade-available`: the `Available` column of the one row. Column names are English only (`[KNOWN GAP]`, T041). */
export function parseWingetList(stdout: string, id: string): WingetAnswer {
  const text = String(stdout ?? '').slice(0, MAX_TOOL_OUTPUT).replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
  if (/source agreements|terms of transaction|agree to all the source/i.test(text)) return { kind: 'terms' };
  if (/no installed package found|no applicable upgrade|no newer package versions/i.test(text)) return { kind: 'current' };
  const lines = text.split(/\r?\n/);
  const h = lines.findIndex((l) => /\bAvailable\b/.test(l) && /\bVersion\b/.test(l) && /\bId\b/.test(l));
  if (h < 0) return { kind: 'unknown' };
  const head = lines[h];
  const col = (name: string): number => head.indexOf(name);
  const iId = col('Id'), iVer = col('Version'), iAvail = col('Available'), iSrc = col('Source');
  for (const row of lines.slice(h + 1, h + 40)) {
    if (!row.trim() || /^-+$/.test(row.trim())) continue;
    if (row.slice(iId, iVer).trim() !== id) continue;
    const available = parseVersionField(row.slice(iAvail, iSrc > iAvail ? iSrc : undefined).trim());
    const installed = parseVersionField(row.slice(iVer, iAvail).trim());
    return available ? { kind: 'available', available, ...(installed ? { installed } : {}) } : { kind: 'unknown' };
  }
  return { kind: 'unknown' };
}

// ---------------------------------------------------------------------------------------------------------------------
// Lookups on the vendors' release endpoints (FR-004, FR-026, plan D4)

export interface Lookup {
  /** Exact https URL, exact host and path. */
  url: string;
  method: 'HEAD' | 'GET';
  /** `location`: a 3xx whose Location matches `pattern`, the body never read. `text`: a body of at most `maxBytes` bytes. */
  mode: 'location' | 'text';
  pattern?: RegExp;
  maxBytes: number;
}
const loc = (re: RegExp): RegExp => re;
export const LOOKUPS: Readonly<Record<SetupKind, readonly Lookup[]>> = Object.freeze({
  codex: [{ url: 'https://github.com/openai/codex/releases/latest', method: 'HEAD', mode: 'location', pattern: loc(/^https:\/\/github\.com\/openai\/codex\/releases\/tag\/rust-v([0-9A-Za-z.-]{1,64})$/), maxBytes: 0 }],
  copilot: [{ url: 'https://github.com/github/copilot-cli/releases/latest', method: 'HEAD', mode: 'location', pattern: loc(/^https:\/\/github\.com\/github\/copilot-cli\/releases\/tag\/v([0-9A-Za-z.-]{1,64})$/), maxBytes: 0 }],
  claude: [
    { url: 'https://downloads.claude.ai/claude-code-releases/stable', method: 'GET', mode: 'text', maxBytes: 64 },
    { url: 'https://downloads.claude.ai/claude-code-releases/latest', method: 'GET', mode: 'text', maxBytes: 64 },
  ],
});
const REDIRECTS = [301, 302, 303, 307, 308];

/** True when a URL is exactly one of the allow-listed lookups (the network layer refuses everything else). */
export const lookupAllowed = (url: string): boolean => Object.values(LOOKUPS).some((l) => l.some((x) => x.url === url));
export const lookupFor = (url: string): Lookup | undefined => Object.values(LOOKUPS).flat().find((x) => x.url === url);

/** What the network layer reports for one lookup. */
export type LookupResponse = { kind: 'redirect'; status: number; url: string } | { kind: 'body'; status: number; text: string };
export type LookupGet = (url: string, opts: { method: 'HEAD' | 'GET'; maxBytes: number; timeoutMs: number }) => Promise<LookupResponse>;

export function versionFromLocation(lk: Lookup, status: number, location: string): string | undefined {
  if (!REDIRECTS.includes(status) || typeof location !== 'string' || location.length > 300 || !lk.pattern) return undefined;
  const m = lk.pattern.exec(location);
  return m ? parseVersionField(m[1]) : undefined;
}

export interface LatestAnswer { latest: string; stable?: string }
/** Runs an app's lookups through `get`. Throws a short reason (`unexpected answer`, or the network's own) when an answer is not as expected. */
export async function lookupLatest(app: SetupKind, get: LookupGet, timeoutMs = 10_000): Promise<LatestAnswer> {
  const list = LOOKUPS[app];
  const out: string[] = [];
  for (const lk of list) {
    const r = await get(lk.url, { method: lk.method, maxBytes: lk.maxBytes, timeoutMs });
    let v: string | undefined;
    if (lk.mode === 'location') v = r.kind === 'redirect' ? versionFromLocation(lk, r.status, r.url) : undefined;
    else v = r.kind === 'body' && r.status === 200 ? parseVersionField(r.text.trim()) : undefined;
    if (!v) throw new Error('unexpected answer');
    out.push(v);
  }
  // Claude: [stable, latest]. `stable` decides (Q7 = C); the channel above it is the quiet note
  return app === 'claude' ? { latest: out[1], stable: out[0] } : { latest: out[0] };
}

// ---------------------------------------------------------------------------------------------------------------------
// Results and the Claude channel rule (Q7 = C)

export type CheckState = 'up-to-date' | 'update-available' | 'could-not-check' | 'outside' | 'checking' | 'not-checked';
export interface CheckResult {
  app: SetupKind;
  state: CheckState;
  installed?: string;
  latest?: string;
  /** Claude native: the stable channel. `latest` is then the latest channel. */
  stable?: string;
  /** Claude native: installed is at or above stable but below latest. Shown as a quiet note only. */
  newerOnLatest?: string;
  installedNewer?: boolean;
  source: string;
  sourceKind: UpdateSource['kind'];
  hint?: OutsideHint;
  /** A short, masked reason for `could-not-check` and `not-checked`. */
  reason?: string;
  /** Wall time (ms since the epoch) of the check, for the card. */
  checkedAt?: number;
  /** Homebrew answers from its local data (the card says so). */
  asHomebrew?: boolean;
}

/** Claude native: `stable` decides. Below stable = update; between stable and latest = a quiet note; at or above latest = up to date. */
export function decideClaudeChannels(installed: string, stable: string, latest: string): { state: 'update-available' | 'up-to-date'; newerOnLatest?: string; installedNewer?: boolean } {
  const d = decide(installed, stable);
  if (d.state === 'update-available') return { state: 'update-available' };
  return { state: 'up-to-date', ...(compareVersions(installed, latest) > 0 ? { installedNewer: true } : {}), ...(compareVersions(installed, latest) < 0 && !isPre(latest) ? { newerOnLatest: latest } : {}) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Announce (FR-016, plan D7)

export type Announced = Partial<Record<SetupKind, string>>;
/** One toast per app and version, saved across restarts. No toast when the card is the announcement (Settings is open); the version still counts. */
export function announceRule(r: CheckResult, announced: Announced, settingsVisible: boolean): { toast: boolean; save?: string } {
  if (r.state !== 'update-available' || !r.latest || r.newerOnLatest) return { toast: false };
  const before = announced[r.app];
  if (before !== undefined && compareVersions(r.latest, before) <= 0) return { toast: false };
  return { toast: !settingsVisible, save: r.latest };
}

// ---------------------------------------------------------------------------------------------------------------------
// Policy (FR-022, spec 076)

export type UpdatePolicy =
  | { state: 'none' }
  | { state: 'unreadable' }
  | { state: 'ok'; allowInAppInstall?: unknown; featureAgentAppUpdateCheck?: unknown; updatesMode?: unknown; max?: Partial<Record<SetupKind, string>> };

export interface PolicyView {
  /** The whole check is hidden and nothing is contacted (`features.agentAppUpdateCheck: false`, `updates.mode: "off"`). */
  checkHidden: boolean;
  /** Update is hidden (`agentApps.allowInAppInstall: false`); the button stays as a read-only check. */
  installBlocked: boolean;
  /** The policy is present but cannot be read: the start check does not run. */
  unreadable: boolean;
  /** Does the start check run (the user's switch is a separate input)? */
  startAllowed: boolean;
}
/** A value we do not know is a lock, not a pass (fail closed). */
export function policyView(p: UpdatePolicy | undefined): PolicyView {
  if (!p || p.state === 'none') return { checkHidden: false, installBlocked: false, unreadable: false, startAllowed: true };
  if (p.state === 'unreadable') return { checkHidden: false, installBlocked: false, unreadable: true, startAllowed: false };
  const modeOk = p.updatesMode === undefined || p.updatesMode === 'notify' || p.updatesMode === 'auto';
  const featureOk = p.featureAgentAppUpdateCheck === undefined || p.featureAgentAppUpdateCheck === true;
  const installOk = p.allowInAppInstall === undefined || p.allowInAppInstall === true;
  const checkHidden = !modeOk || !featureOk;
  return { checkHidden, installBlocked: !installOk, unreadable: false, startAllowed: !checkHidden && installOk };
}

/** The start check runs only on a real machine, with the user's switch on and the policy allowing it (SC-002). */
export function startCheckAllowed(i: { simulator: boolean; userSwitch: boolean; policy: UpdatePolicy | undefined }): boolean {
  return !i.simulator && i.userSwitch && policyView(i.policy).startAllowed;
}

// ---------------------------------------------------------------------------------------------------------------------
// Pinning and the organization's `max` (FR-023)

export const pinnable = (s: UpdateSource): boolean => s.kind === 'npm' || s.kind === 'winget';

/** What an update may do for this copy, given the checked version and the organization's `max`. */
export function updateDecision(s: UpdateSource, checked: string | undefined, max: string | undefined): { allowed: boolean; pinned: boolean; reason?: string } {
  const pin = pinnable(s) && !!checked;
  if (!max) return { allowed: true, pinned: pin };
  if (!pinnable(s)) return { allowed: false, pinned: false, reason: `Update not available: your organization limits the version, and ${sourceLabel(s)} cannot install a chosen version.` };
  if (!checked) return { allowed: false, pinned: false, reason: 'Update not available: the version to install could not be checked.' };
  if (compareVersions(checked, max) > 0) return { allowed: false, pinned: true, reason: `Update not available: ${checked} is above the version your organization allows (${max}).` };
  return { allowed: true, pinned: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// Failure classes (FR-014, plan D8)

export type FailureClass = 'admin' | 'in-use' | 'managed' | 'vendor-up-to-date' | 'uac-cancelled' | 'network' | 'other';
export interface FailureInput {
  code?: number | null;
  errorCode?: string;
  /** Already masked output (the last lines). */
  text?: string;
  platform: string;
  sourceKind?: UpdateSource['kind'];
  timedOut?: boolean;
}

/** Patterns run on masked text, case-insensitively. `managed` matches Durbar's policy, winget and Group Policy, and recorded vendor text only. */
export function classifyFailure(i: FailureInput): FailureClass {
  const t = String(i.text ?? '').slice(-4000);
  const ec = i.errorCode ?? '';
  if (i.code === 0 && /\bis up to date\b|already (?:on|at) the latest|you(?:'re| are) up to date/i.test(t)) return 'vendor-up-to-date';
  if (i.platform === 'win32' && (i.code === 1223 || i.code === -2147023673 || /cancell?ed (?:by the user|at the)|operation was cancell?ed|user cancell?ed/i.test(t))) return 'uac-cancelled';
  if (/disabled by (?:group )?policy|blocked by (?:group )?policy|(?:updates?|auto-?updates?) (?:are|is) disabled|DISABLE_UPDATES|managed by your organi[sz]ation|0x8a150(?:0)?6c/i.test(t)) return 'managed';
  if (ec === 'EBUSY' || ec === 'ETXTBSY' || /\bEBUSY\b|\bETXTBSY\b|being used by another process|text file busy|file is in use|is currently running/i.test(t) || (i.platform === 'win32' && /\bEPERM\b.*\b(?:unlink|rename|\.exe)\b/i.test(t))) return 'in-use';
  if (ec === 'EACCES' || ec === 'EPERM' || /\bEACCES\b|permission denied|requires? (?:administrator|elevat)|run (?:as|with) (?:root|administrator)|operation not permitted|access is denied|\bEPERM\b/i.test(t)) return 'admin';
  if (i.timedOut || ['ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN', 'ENETUNREACH'].includes(ec) || /\b(?:ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ENETUNREACH)\b|getaddrinfo|socket hang up|could not resolve|network (?:is )?unreachable|timed? ?out|\bHTTP (?:4|5)\d\d\b|unexpected answer/i.test(t)) return 'network';
  return 'other';
}

/** The Codex fallback (FR-009): a failing `codex update` that is neither in-use, managed nor cancelled offers the checked 060 installer. */
export function codexNeedsFallback(i: { ok: boolean; reason?: string; cls: FailureClass }): boolean {
  if (i.ok || i.reason === 'cancelled' || i.reason === 'timeout') return false;
  return i.cls !== 'in-use' && i.cls !== 'managed' && i.cls !== 'uac-cancelled' && i.cls !== 'vendor-up-to-date';
}

// ---------------------------------------------------------------------------------------------------------------------
// Copilot CLI version from the copy's own files (FR-002): never by running `copilot`

/** The version folder under `~/.copilot/pkg/<ver>/` that the real path points into (the first of its first four segments that is a version). */
export function copilotVersionFromPath(realPath: string, platform: string, env: SourceEnv): string | undefined {
  const p = pathFor(platform);
  if (!env.homedir || !p.isAbsolute(env.homedir)) return undefined;
  const f = (s: string): string => (caseless(platform) ? s.toLowerCase() : s);
  const real = platform === 'win32' ? realPath.replace(/\//g, '\\') : realPath;
  const rel = p.relative(f(p.join(env.homedir, '.copilot', 'pkg')), f(real));
  if (!rel || rel === '..' || rel.startsWith('..' + p.sep) || p.isAbsolute(rel)) return undefined;
  for (const seg of rel.split(p.sep).slice(0, 4)) {
    const v = parseVersionField(seg);
    if (v) return v;
  }
  return undefined;
}
/** The version folder of `Caskroom/copilot-cli/<ver>/`. */
export function versionFromCaskroom(realPath: string): string | undefined {
  const segs = realPath.replace(/\\/g, '/').split('/').filter(Boolean);
  const i = segs.findIndex((s) => s.toLowerCase() === 'caskroom');
  return i >= 0 ? brewVersion(segs[i + 2]) : undefined;
}
/** `@github/copilot/package.json` `version`, own property only (the caller read at most 64 KiB). */
export function versionFromPackageJson(text: string): string | undefined {
  const v = own(json(text), 'version');
  return parseVersionField(v);
}
/** winget keeps a package in `Packages\GitHub.Copilot_<source>\`, so the version is not in its folder name in every layout: a best effort (`[KNOWN GAP]`, T041). */
export function versionFromWingetPath(realPath: string): string | undefined {
  for (const s of realPath.replace(/\\/g, '/').split('/')) {
    const m = /^[A-Za-z0-9.-]+?[_-]v?(\d{1,9}\.\d{1,9}\.\d{1,9}(?:-[0-9A-Za-z.-]{1,40})?)$/.exec(s.length > MAX_VERSION_LENGTH + 40 ? '' : s);
    if (m) return parseVersionField(m[1]);
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// After an update (FR-011)

/**
 * What Durbar says after an update ended well when the answer is not simply "the new version": the version did not change, or
 * another copy is found first. `before` and `after` are what detection said (version and display path). Durbar never removes or
 * reorders copies.
 */
export function updateOutcomeNote(name: string, before: { version?: string; where?: string } | undefined, after: { version?: string; where?: string } | undefined, target: string | undefined): string | undefined {
  if (!after?.version) return undefined;
  const at = after.where ? ` at ${after.where}` : '';
  if (before?.where && after.where && before.where !== after.where) return `${name} was updated at ${before.where}, but Durbar now finds ${after.version}${at} first.`;
  const reached = target ? compareVersions(after.version, target) >= 0 : before?.version ? compareVersions(after.version, before.version) > 0 : true;
  if (!reached) return `Updated, but Durbar still finds ${after.version}${at}.`;
  return undefined;
}

/** FR-004: the reason a winget check gives when its source terms are not accepted (the card shows it; main then asks itself). */
export const WINGET_TERMS_REASON = 'winget needs its terms accepted';
/**
 * Review on #721 (constitution III): only main decides to add `--accept-source-agreements`, after its own native question, and only
 * for one app's explicit Check whose kept result says the terms are not accepted. The window's word is never enough.
 */
export const wingetTermsQuestion = (kept: { reason?: string; sourceKind?: string } | undefined): boolean => kept?.reason === WINGET_TERMS_REASON;
