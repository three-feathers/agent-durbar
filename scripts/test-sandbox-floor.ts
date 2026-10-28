/**
 * Spec 087 T014 (SC-001, SC-002, FR-016, FR-018): the OS sandbox floor of every app × OS × mode cell, from the pure modules, with
 * injected platform facts. Plus the shared roots rule (T010), the normalized state (T013), Codex's card line (T022) and the scans that
 * no cell sends an auto-approve, a bypass, the dev-tool grants or credential injection. No process, no account, no credits.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { CLAUDE_SANDBOX_MIN_VERSION, claudeSandboxExit, claudeSandboxPrecheck, claudeSandboxSettings, claudeSandboxState, withSandboxSettings } from '../src/adapters/claudeSandbox';
import { COPILOT_SANDBOX_NOTE_COMMAND, copilotHostSupport, copilotPathReadDirs, copilotSandboxConfig, copilotSandboxState } from '../src/adapters/copilotSandbox';
import { CODEX_SANDBOX_NOTE_COMMAND, CODEX_SANDBOX_NOTE_FILE, codexModeSettings, codexPermission, codexSandboxState } from '../src/adapters/codexModes';
import { HOME_SECRETS, leftOutFields, normalizeRoot, sandboxRoots, splitFolders } from '../src/adapters/sandboxRoots';
import * as os from 'os';
import { cleanSandboxState, outwardSandboxEvent, sandboxReason } from '../src/shared/sandbox';
import { requireOsSandbox, requireOsSandboxFrom } from '../src/main/sandboxpolicy';
import { parseSettings } from '../src/shared/credits';

const ok = (m: string): void => console.log('ok - ' + m);
// review on PR 733 (7): a run that stops early must not exit 0
let FLOOR_DONE = false;
process.on('exit', (code) => {
  if (!FLOOR_DONE && code === 0) {
    console.error('sandbox floor: the run ended before its last check');
    process.exitCode = 1;
  }
});
const ident = (p: string): string => p;
const OSES = ['darwin', 'linux', 'win32'] as const;
const MODES = ['read-only', 'ask', 'allow'] as const;
const ROOTS: Record<string, string[]> = { darwin: ['/Users/me/proj'], linux: ['/home/me/proj'], win32: ['C:\\Users\\me\\proj'] };
const HOME: Record<string, string> = { darwin: '/Users/me', linux: '/home/me', win32: 'C:\\Users\\me' };
const FULL_HOST = { supported: true, capabilities: ['shell', 'denied_paths', 'network'] };

/** Every key/value pair of a nested object, as `a.b.c` = value. */
function flat(o: unknown, pre = ''): Array<[string, unknown]> {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return [[pre, o]];
  return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, pre ? `${pre}.${k}` : k));
}
/** FR-002/FR-016: nothing that approves, bypasses, retries unsandboxed, grants dev-tool writes or injects credentials. */
function scan(cell: string, settings: unknown): void {
  for (const [k, v] of flat(settings)) {
    if (/autoAllow|allowUnsandboxed/i.test(k)) assert.strictEqual(v, false, `${cell}: ${k} must be false`);
    if (/allowBypass|dangerouslyDisable|bypass/i.test(k)) assert.fail(`${cell}: ${k} must never be sent`);
    if (/allowDevToolAccess/.test(k)) assert.strictEqual(v, false, `${cell}: ${k} must be false`);
    if (/^auth\.|credentials/.test(k)) assert.ok(v === false || v === undefined, `${cell}: credential injection ${k}=${String(v)}`);
    if (/excludedCommands/.test(k)) assert.ok(v === undefined || (Array.isArray(v) && v.length === 0), `${cell}: no command left out of the sandbox`);
    if (/allowOutbound|allowLocalNetwork/.test(k)) assert.strictEqual(v, false, `${cell}: network off (decision Q2)`);
  }
}

// ---- SC-001: the 27 cells ----
let cells = 0;
for (const os of OSES) {
  for (const mode of MODES) {
    // Claude Code
    {
      const cell = `claude/${os}/${mode}`;
      const block = claudeSandboxSettings(mode, ROOTS[os]);
      const pre = claudeSandboxPrecheck({ platform: os, version: '2.1.300', haveBwrap: true, haveSocat: true });
      if (mode === 'allow') assert.strictEqual(block, undefined, `${cell}: the app default`);
      else {
        assert.ok(block, `${cell}: a block`);
        assert.strictEqual(block.failIfUnavailable, true, `${cell}: failIfUnavailable (FR-007)`);
        assert.strictEqual(block.enabled, true);
        assert.deepStrictEqual(block.filesystem.denyRead, ['~/', ...HOME_SECRETS.map((x) => '~/' + x)], `${cell}: reads denied in home (Q4) and the credential folders always`);
        assert.deepStrictEqual(block.filesystem.allowRead, ROOTS[os]);
        assert.deepStrictEqual(block.filesystem.denyWrite, [...(mode === 'read-only' ? ROOTS[os] : []), ...HOME_SECRETS.map((x) => '~/' + x)], `${cell}: Read-only denies writes to the roots (K2); the credential folders always`);
        assert.deepStrictEqual(block.network, { allowedDomains: [], strictAllowlist: true }, `${cell}: network off (Q2)`);
        scan(cell, block);
        assert.strictEqual(pre.try, os !== 'win32', `${cell}: tried except on native Windows`);
      }
      cells++;
    }
    // Copilot
    {
      const cell = `copilot/${os}/${mode}`;
      const cfg = copilotSandboxConfig({ mode, roots: ROOTS[os], pathDirs: [], host: FULL_HOST, home: HOME[os], platform: os });
      if (mode === 'allow') assert.strictEqual(cfg, undefined, `${cell}: nothing sent`);
      else {
        assert.ok(cfg);
        assert.strictEqual(cfg.allowDevToolAccess, false, `${cell}: allowDevToolAccess false (SC-001)`);
        assert.strictEqual(cfg.addCurrentWorkingDirectory, false);
        assert.deepStrictEqual(cfg.userPolicy.filesystem.readwritePaths, mode === 'ask' ? ROOTS[os] : [], `${cell}: writes`);
        assert.ok(!('allowBypass' in cfg) && !('credentials' in cfg), `${cell}: no bypass, no credentials`);
        scan(cell, cfg);
      }
      cells++;
    }
    // Codex (unchanged, spec 012)
    {
      const cell = `codex/${os}/${mode}`;
      const s = codexModeSettings(mode);
      if (mode === 'allow') assert.deepStrictEqual(s, { approvalPolicy: 'never', sandbox: 'danger-full-access' });
      else assert.deepStrictEqual(s, { approvalPolicy: mode === 'ask' ? 'on-request' : 'never', permissions: 'durbar_ro' }, `${cell}: durbar_ro (Q3)`);
      const st = codexSandboxState(mode, os);
      assert.deepStrictEqual(st && { state: st.state, leave: !!st.approvedMayLeave }, mode === 'allow' ? null : { state: 'on', leave: mode === 'ask' }, `${cell}: state`);
      cells++;
    }
  }
}
assert.strictEqual(cells, 27);
ok('SC-001: 27 app × OS × mode cells match FR-001..FR-005; no auto-approve, bypass, dev-tool grant or credential injection');

// ---- SC-002: unavailable cells give a visible off with a reason; no on before the app confirmed it ----
{
  const facts = [
    { platform: 'win32', version: '2.1.300' },
    { platform: 'linux', version: '2.1.300', haveBwrap: false, haveSocat: true },
    { platform: 'linux', version: '2.1.300', haveBwrap: true, haveSocat: false },
    { platform: 'darwin', version: '2.1.218' },
    { platform: 'darwin' },
    { platform: 'freebsd', version: '2.1.300' },
  ];
  for (const f of facts) for (const mode of ['read-only', 'ask'] as const) {
    const st = claudeSandboxState({ mode, facts: f, started: true });
    assert.strictEqual(st?.state, 'off', `claude ${JSON.stringify(f)}: off even if init came`);
    assert.ok(st?.reason && st.reason.length <= 200, 'with a reason');
  }
  assert.deepStrictEqual(claudeSandboxPrecheck({ platform: 'win32', version: '2.1.300' }), { try: false, reason: "Claude Code has no OS sandbox on Windows; Durbar's own checks still apply (only WSL2 has one).", permanent: true });
  assert.strictEqual((claudeSandboxPrecheck({ platform: 'linux', version: CLAUDE_SANDBOX_MIN_VERSION, haveBwrap: true, haveSocat: true }) as { try: boolean }).try, true, 'the minimum version itself is enough');
  assert.strictEqual((claudeSandboxPrecheck({ platform: 'linux', version: '2.1.219-beta.1', haveBwrap: true, haveSocat: true }) as { try: boolean }).try, false, 'a pre-release of the minimum is older');
  const lin = { platform: 'linux', version: '2.1.300', haveBwrap: true, haveSocat: true };
  assert.strictEqual(claudeSandboxState({ mode: 'read-only', facts: lin })?.state, 'unknown', 'no init yet: unknown (checking)');
  assert.strictEqual(claudeSandboxState({ mode: 'read-only', facts: lin, started: true })?.state, 'on');
  assert.strictEqual(claudeSandboxState({ mode: 'read-only', facts: lin, started: true, startExit: 'x' })?.state, 'off', 'a sandbox exit wins');
  assert.strictEqual(claudeSandboxState({ mode: 'allow', facts: lin, started: true }), null);
  for (const host of [undefined, { supported: false, reason: 'no bwrap', capabilities: [] }]) {
    assert.strictEqual(copilotSandboxState({ mode: 'ask', platform: 'linux', host, applied: true })?.state, 'off', 'copilot unsupported: off even if "applied"');
  }
  assert.strictEqual(copilotSandboxState({ mode: 'ask', platform: 'linux', host: FULL_HOST })?.state, 'unknown', 'copilot: not on before the update was accepted');
  assert.strictEqual(copilotSandboxState({ mode: 'ask', platform: 'linux', host: FULL_HOST, applied: true, warning: 'lost' })?.state, 'off', 'a sandbox warning wins (FR-008)');
  assert.strictEqual(copilotSandboxState({ mode: 'allow', platform: 'linux', keptFloor: true })?.untilNewSession, true);
  assert.strictEqual(copilotSandboxState({ mode: 'allow', platform: 'linux' }), null);
  ok('SC-002: every unavailable cell is off with a reason; on only after the app confirmed it');
}

// ---- the Claude exit classifier (K4): narrow, masked; anything else is the crash path ----
{
  assert.ok(claudeSandboxExit({ code: 1, stderrTail: 'boot\nError: Sandbox is not available: bwrap failed\n' }));
  assert.ok(claudeSandboxExit({ code: 1, stderrTail: 'sandbox.failIfUnavailable is set and the sandbox cannot start' }));
  for (const t of ['Error: ECONNREFUSED', 'segfault', '', 'sandbox ready', 'could not read settings']) assert.strictEqual(claudeSandboxExit({ code: 1, stderrTail: t }), undefined, `unclassified: ${t}`);
  const masked = claudeSandboxExit({ code: 1, stderrTail: 'sandbox failed for token ghp_abcdefghijklmnopqrstuvwxyz0123456789' }) ?? '';
  assert.ok(!masked.includes('ghp_abc') && masked.includes('redacted'), 'the reason is masked');
  ok('claudeSandboxExit: a sandbox line only, masked');
}

// ---- withSandboxSettings: the folder setup is kept, a folder `sandbox` key never survives ----
{
  const folder = JSON.stringify({ hooks: { PreToolUse: [] }, permissions: { allow: ['Bash(npm test:*)'] }, sandbox: { enabled: false, allowUnsandboxedCommands: true } });
  const block = claudeSandboxSettings('ask', ['/w'])!;
  const out = JSON.parse(withSandboxSettings(folder, block)!);
  assert.deepStrictEqual(out.sandbox, block, 'Durbar’s block replaces any sandbox key');
  assert.deepStrictEqual(out.permissions, { allow: ['Bash(npm test:*)'] });
  assert.ok(!('sandbox' in JSON.parse(withSandboxSettings(folder, undefined)!)), 'without a block: no sandbox key at all (a folder one is dropped)');
  assert.strictEqual(withSandboxSettings(undefined, undefined), undefined);
  assert.deepStrictEqual(JSON.parse(withSandboxSettings('not json', block)!), { sandbox: block });
  ok('withSandboxSettings: Durbar’s block is the sandbox key, the folder part is unchanged');
}

// ---- T010: the shared roots rule ----
{
  assert.deepStrictEqual(sandboxRoots(['/a/b', '/a/b/', '/', 'rel', '', '/a/../..', '/x"y', '/x\ny', '/x\u0007', 'C:\\', '\\\\srv\\share', '\\\\srv\\share\\p', 'C:\\P', 'c:\\p\\', 7, null], ident), ['/a/b', '\\\\srv\\share\\p', 'C:\\P'], 'roots, share roots, .., quotes, control characters and relative entries dropped; Windows compare case-insensitive');
  assert.deepStrictEqual(sandboxRoots(['/a', '/A'], ident), ['/a', '/A'], 'posix case-sensitive');
  assert.deepStrictEqual(sandboxRoots(['/link'], () => '/'), [], 'a link to / is dropped (resolved path checked)');
  assert.deepStrictEqual(sandboxRoots(['/gone'], () => { throw new Error('ENOENT'); }), [], 'a resolver error drops the root');
  assert.deepStrictEqual(sandboxRoots(undefined, ident), []);
  // review round 6 (2): Windows extended-length and device forms: a share root or a drive root is dropped like `\\srv\sh` and `C:\`
  assert.deepStrictEqual(sandboxRoots(['\\\\?\\UNC\\srv\\sh', '\\\\?\\UNC\\srv\\sh\\', '\\\\srv\\sh', '\\\\?\\C:\\', '\\\\.\\C:\\x', '\\\\?\\Volume{1}\\x', '//?/UNC/srv/sh'], ident), [], 'share roots, drive roots, device and volume forms dropped');
  assert.deepStrictEqual(sandboxRoots(['\\\\?\\UNC\\srv\\sh\\p', '\\\\?\\C:\\w'], ident), ['\\\\srv\\sh\\p', 'C:\\w'], 'a folder below them is kept, in its plain form');
  for (const x of ['\\\\srv', '\\\\srv\\', '\\\\?\\UNC\\srv', '\\\\?\\UNC\\srv\\']) assert.strictEqual(normalizeRoot(x), undefined, `normalizeRoot itself drops ${x} (Node normalises it to \\srv)`);
  // review round 7 (4): a UNC path without a share names no folder; a Windows name with a trailing space or dot is what Windows trims
  assert.deepStrictEqual(sandboxRoots(['/home/u/proj.', '/home/u/my proj ', '/home/u/a. /b'], ident), ['/home/u/proj.', '/home/u/my proj ', '/home/u/a. /b'], 'POSIX keeps a trailing dot or space (only Windows trims them)');
  assert.deepStrictEqual(sandboxRoots(['\\\\srv', '\\\\srv\\', '\\\\?\\UNC\\srv', '\\\\?\\UNC\\srv\\', 'C:\\ ', 'C:\\. ', 'C:\\w.', 'C:\\w \\x', 'C:\\my proj'], ident), ['C:\\my proj'], 'no share; trailing space or dot dropped; a space inside a name kept');
  // review round 5: splitFolders is an allow-list: kept only when the block holds it; everything else is named with why
  const sp = splitFolders(['/w', '/', '/a/../..', '/x"y', '/gone', '/w/sub', '/home/me/.ssh'], '/w', ['/w', '/w/sub'], (p) => { if (p === '/gone') throw new Error('ENOENT'); return p; });
  assert.deepStrictEqual(sp.kept, ['/w/sub']);
  assert.deepStrictEqual(sp.leftOut, [{ folder: '/', why: 'unusable' }, { folder: '/a/../..', why: 'unusable' }, { folder: '/x"y', why: 'unusable' }, { folder: '/gone', why: 'unusable' }, { folder: '/home/me/.ssh', why: 'credential' }]);
  ok('T010: sandboxRoots drops what could widen the floor or break a settings string');
}

// ---- FR-004: PATH folders ----
{
  assert.deepStrictEqual(copilotPathReadDirs(['/usr/bin', '/home/me', '/home', '/home/other', '/', 'rel/bin', '/home/me/.local/bin', '/usr/bin', '/var/home', '/Users'], '/home/me', 'linux'), ['/usr/bin', '/home/me/.local/bin']);
  assert.deepStrictEqual(copilotPathReadDirs(['/usr/bin', '/root/bin', '/root'], '/root', 'linux'), ['/usr/bin', '/root/bin'], 'home /root: its own folders kept, /usr not taken for a profile root');
  assert.deepStrictEqual(copilotPathReadDirs(['C:\\USERS', 'c:\\users\\ME', 'C:\\Users\\x', 'C:\\Windows'], 'C:\\Users\\me', 'win32'), ['C:\\Windows']);
  assert.deepStrictEqual(copilotPathReadDirs(['/users/ME', '/opt/homebrew/bin'], '/Users/me', 'darwin'), ['/opt/homebrew/bin'], 'macOS compares case-insensitively');
  assert.deepStrictEqual(copilotPathReadDirs(['/HOME/ME'], '/home/me', 'linux'), ['/HOME/ME'], 'Linux compares case-sensitively');
  assert.deepStrictEqual(copilotPathReadDirs(['c:\\users\\OTHER', 'C:\\Tools'], 'C:\\Users\\me', 'win32'), ['C:\\Tools'], 'another user\'s profile root, in another case, is dropped on Windows');
  assert.deepStrictEqual(copilotPathReadDirs(['/USERS/other', '/opt/x'], '/Users/me', 'darwin'), ['/opt/x'], 'and on macOS');
  // review round 3 (4): a credential folder in another case is the same folder on macOS (and not on Linux)
  assert.deepStrictEqual(copilotSandboxConfig({ mode: 'ask', roots: ['/Users/bob/.SSH', '/Users/bob/p'], pathDirs: [], host: FULL_HOST, home: '/Users/bob', platform: 'darwin' })!.userPolicy.filesystem.readwritePaths, ['/Users/bob/p'], 'macOS: ~/.SSH is ~/.ssh');
  assert.deepStrictEqual(claudeSandboxSettings('ask', ['/Users/bob/.SSH', '/Users/bob/p'], '/Users/bob', (p) => p, 'darwin')!.filesystem.allowRead, ['/Users/bob/p'], 'Claude, macOS: the same');
  assert.deepStrictEqual(claudeSandboxSettings('ask', ['/home/bob/.SSH'], '/home/bob', (p) => p, 'linux')!.filesystem.allowRead, ['/home/bob/.SSH'], 'Linux: another case is another folder');
  assert.deepStrictEqual(copilotPathReadDirs(['/srv', '/srv/users', '/srv/users/me', '/srv/users/me/bin', '/srv/tools/bin'], '/srv/users/me', 'linux'), ['/srv/users/me/bin', '/srv/tools/bin'], 'a home outside /home: every ancestor of it is dropped');
  const winDenied = copilotSandboxConfig({ mode: 'ask', roots: ['C:\\w'], pathDirs: [], host: FULL_HOST, home: 'C:\\Users\\me', platform: 'linux' })!.userPolicy.filesystem.deniedPaths;
  assert.deepStrictEqual(winDenied!.slice(0, 5), ['C:\\w\\.git\\hooks', 'C:\\w\\.git\\config', 'C:\\Users\\me\\.ssh', 'C:\\Users\\me\\.aws', 'C:\\Users\\me\\.config\\gh'], 'protected paths are joined in the form of their root');
  // FR-004 + review on PR 733: a PATH entry that is a LINK to the home folder (or to a parent of it) is checked where it leads
  {
    const fs2 = require('fs') as typeof import('fs');
    const tmp = fs2.realpathSync.native(fs2.mkdtempSync(path.join(os.tmpdir(), 'durbar-087-path-')));
    const home = path.join(tmp, 'home', 'me');
    fs2.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
    fs2.mkdirSync(path.join(tmp, 'opt'), { recursive: true });
    fs2.symlinkSync(home, path.join(tmp, 'opt', 'bin'), 'dir');
    fs2.symlinkSync(path.join(tmp, 'home'), path.join(tmp, 'opt', 'up'), 'dir');
    const real = (p: string): string => fs2.realpathSync.native(p);
    const plat = process.platform === 'win32' ? 'win32' : 'linux';
    const got = copilotPathReadDirs([path.join(tmp, 'opt', 'bin'), path.join(tmp, 'opt', 'up'), path.join(home, '.local', 'bin'), path.join(tmp, 'gone')], home, plat, real);
    assert.deepStrictEqual(got, [path.join(home, '.local', 'bin')], 'a link to home or to its parent is dropped; a missing entry is dropped; a folder under home is kept');
    fs2.rmSync(tmp, { recursive: true, force: true });
  }
  // review round 2 (2, 5): a credential folder that is a LINK is denied at its target too; a linked home folder is compared where it leads
  {
    const fs3 = require('fs') as typeof import('fs');
    const tmp = fs3.realpathSync.native(fs3.mkdtempSync(path.join(os.tmpdir(), 'durbar-087-link-')));
    const realHomeDir = path.join(tmp, 'var', 'home', 'me');
    fs3.mkdirSync(path.join(realHomeDir, 'dotfiles', 'ssh'), { recursive: true });
    fs3.mkdirSync(path.join(realHomeDir, '.local', 'bin'), { recursive: true });
    fs3.symlinkSync(path.join(realHomeDir, 'dotfiles', 'ssh'), path.join(realHomeDir, '.ssh'), 'dir');
    fs3.symlinkSync(path.join(tmp, 'var', 'home'), path.join(tmp, 'home'), 'dir');
    const linkedHome = path.join(tmp, 'home', 'me');
    const real = (p: string): string => fs3.realpathSync.native(p);
    const plat = process.platform === 'win32' ? 'win32' : 'linux';
    const target = path.join(realHomeDir, 'dotfiles', 'ssh');
    const cl2 = claudeSandboxSettings('ask', [realHomeDir], linkedHome, real, plat)!;
    assert.ok(cl2.filesystem.denyRead.includes('~/.ssh') && cl2.filesystem.denyRead.includes(target) && cl2.filesystem.denyWrite.includes(target), 'Claude: the link and its target are denied');
    const cp2 = copilotSandboxConfig({ mode: 'read-only', roots: [realHomeDir], pathDirs: [], host: FULL_HOST, home: linkedHome, platform: plat, realpath: real })!;
    assert.ok(cp2.userPolicy.filesystem.deniedPaths!.includes(target), 'Copilot: the target is denied too');
    // the home folder is a link (/home -> /var/home): a PATH entry and a session folder in the other form are still the home folder
    assert.deepStrictEqual(copilotPathReadDirs([realHomeDir, path.join(realHomeDir, '.local', 'bin')], linkedHome, plat, real), [path.join(realHomeDir, '.local', 'bin')], 'PATH: the home folder in its real form is dropped');
    const cp3 = copilotSandboxConfig({ mode: 'ask', roots: [realHomeDir], pathDirs: [], host: { supported: true, capabilities: ['shell'] }, home: linkedHome, platform: plat, realpath: real })!;
    assert.deepStrictEqual(cp3.userPolicy.filesystem.readwritePaths, [], 'the home folder in its real form is left out without denied_paths');
    fs3.rmSync(tmp, { recursive: true, force: true });
  }
  // FR-004/Q4 + review on PR 733: a session folder that IS the home folder or a parent of it
  {
    const h = '/home/me';
    const noDeny = copilotSandboxConfig({ mode: 'ask', roots: ['/home/me', '/home', '/work/p'], pathDirs: [], host: { supported: true, capabilities: ['shell'] }, home: h, platform: 'linux' })!;
    assert.deepStrictEqual(noDeny.userPolicy.filesystem.readwritePaths, ['/work/p'], 'without denied_paths, home and its parents are never granted (deny by default)');
    const withDeny = copilotSandboxConfig({ mode: 'read-only', roots: ['/home/me'], pathDirs: [], host: FULL_HOST, home: h, platform: 'linux' })!;
    assert.deepStrictEqual(withDeny.userPolicy.filesystem.readonlyPaths, ['/home/me']);
    assert.deepStrictEqual(withDeny.userPolicy.filesystem.deniedPaths, HOME_SECRETS.map((x) => path.posix.join(h, x)), 'with denied_paths: every credential folder denied inside it');
    // review round 2 (3): a session folder that CONTAINS a credential folder (~/.config) is treated like the home folder; one INSIDE a
    // credential folder (~/.ssh itself) is never granted (an allow and a deny on one path: no documented rule)
    const cfgNoDeny = copilotSandboxConfig({ mode: 'ask', roots: ['/home/me/.config', '/home/me/.ssh', '/home/me/work'], pathDirs: [], host: { supported: true, capabilities: ['shell'] }, home: h, platform: 'linux' })!;
    assert.deepStrictEqual(cfgNoDeny.userPolicy.filesystem.readwritePaths, ['/home/me/work'], 'without denied_paths: ~/.config and ~/.ssh left out');
    const cfgDeny = copilotSandboxConfig({ mode: 'ask', roots: ['/home/me/.config', '/home/me/.ssh'], pathDirs: [], host: FULL_HOST, home: h, platform: 'linux' })!;
    assert.deepStrictEqual(cfgDeny.userPolicy.filesystem.readwritePaths, ['/home/me/.config'], 'with denied_paths: ~/.config kept (gh and gcloud denied inside), ~/.ssh never');
    const clIn = claudeSandboxSettings('read-only', ['/home/me/.ssh', '/home/me/work'], h)!;
    assert.deepStrictEqual(clIn.filesystem.allowRead, ['/home/me/work'], 'Claude: a root inside a credential folder is left out of allowRead');
    const cl = claudeSandboxSettings('ask', ['/home/me'])!;
    assert.ok(cl.filesystem.allowRead.includes('/home/me') && ['~/.ssh', '~/.aws', '~/.config/gh'].every((x) => cl.filesystem.denyRead.includes(x)), 'Claude: the narrower deny keeps the credential folders out of a home root (read: docs)');
  }
  ok('FR-004: PATH folders: home, its ancestors and any profile root dropped');
}

// ---- copilotHostSupport: malformed answers are unavailable (fail closed) ----
{
  assert.strictEqual(copilotHostSupport(undefined), undefined);
  assert.strictEqual(copilotHostSupport({ supported: 'yes' }), undefined);
  assert.deepStrictEqual(copilotHostSupport({ supported: true, capabilities: [{ name: 'denied_paths', supported: true }, { name: 'network', supported: false }, 'x', null] }), { supported: true, capabilities: ['denied_paths'] });
  assert.deepStrictEqual(copilotHostSupport({ supported: false, reason: 'r', capabilities: [{ name: 'shell' }] }), { supported: false, reason: 'r', capabilities: [] });
  ok('copilotHostSupport: own known fields; a capability Copilot calls unsupported is not claimed');
}

// ---- T022 (FR-021): Codex's card line is its own field; summary unchanged ----
{
  const run = codexPermission('item/commandExecution/requestApproval', { command: 'npm test' });
  assert.strictEqual(run.summary, 'run npm test', 'summary unchanged');
  assert.strictEqual(run.sandboxNote, CODEX_SANDBOX_NOTE_COMMAND);
  assert.strictEqual(CODEX_SANDBOX_NOTE_COMMAND, 'If you approve, Codex may run this outside its sandbox.');
  const w = codexPermission('item/fileChange/requestApproval', { itemId: 'i' }, [{ path: '/w/a.ts', kind: 'update', diff: '@@\n-a\n+b' }]);
  assert.ok(w.summary.startsWith('write /w/a.ts') && !w.summary.includes('sandbox'));
  assert.strictEqual(w.sandboxNote, 'If you approve, Codex writes this outside its read-only sandbox.');
  assert.strictEqual(w.sandboxNote, CODEX_SANDBOX_NOTE_FILE);
  assert.strictEqual(codexPermission('mcpServer/elicitation/request', {}).sandboxNote, undefined, 'only commands and file changes');
  ok('T022: Codex sandboxNote on command and file-change cards; summary unchanged');
}

// ---- T013: SandboxState is normalized (no vendor key in src/shared/api.ts); cleanSandboxState and sandboxReason ----
{
  const api = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'shared', 'api.ts'), 'utf8');
  for (const k of ['autoAllowBash', 'sandboxConfig', 'durbar_ro', 'allowBypass', 'failIfUnavailable', 'allowDevToolAccess']) assert.ok(!api.includes(k), `api.ts has no ${k}`);
  const good = { state: 'on', mechanism: 'bubblewrap', covers: ['shell', 'mcp'], writes: 'none', verified: false };
  assert.deepStrictEqual(cleanSandboxState(good), good);
  for (const bad of [null, [], { ...good, state: 'yes' }, { ...good, covers: ['net'] }, { ...good, mechanism: 'landlock' }, { ...good, verified: 'no' }, { ...good, managed: 1 }, { ...good, reason: 5 }, { ...good, writes: 'all' }, { covers: [], verified: true }])
    assert.strictEqual(cleanSandboxState(bad), undefined, `rejected: ${JSON.stringify(bad)}`);
  const inherited = Object.assign(Object.create({ managed: true, reason: 'inherited', approvedMayLeave: true }), { state: 'on', covers: [], verified: true });
  const ci = cleanSandboxState(inherited);
  assert.ok(ci && ci.managed === undefined && ci.reason === undefined && ci.approvedMayLeave === undefined, 'own properties only: ' + JSON.stringify(ci));
  const long = sandboxReason('x '.repeat(400) + 'ghp_abcdefghijklmnopqrstuvwxyz0123456789')!;
  assert.ok(long.length <= 200, 'at most 200 characters');
  for (const n of [150, 170, 185, 190, 194]) {
    const tok = sandboxReason('a'.repeat(n) + ' ghp_abcdefghijklmnopqrstuvwxyz0123456789 tail')!;
    assert.ok(!/ghp_/.test(tok) && tok.length <= 200, `masked before it is cut (token at ${n}): no token prefix survives: ${tok.slice(-30)}`);
  }
  assert.strictEqual(sandboxReason('  \u0007\n '), undefined);
  assert.strictEqual(sandboxReason('line1\nline2\u2028x'), 'line1 line2 x');
  ok('T013: the normalized state holds no vendor key; malformed states are dropped; reasons masked, then cut');
}
// ---- T050 (FR-019): permissions.requireOsSandbox: narrow-only, fail closed ----
{
  assert.strictEqual(requireOsSandboxFrom([]), false, 'no policy: not required');
  assert.strictEqual(requireOsSandboxFrom([{}]), false, 'absent: false');
  assert.strictEqual(requireOsSandboxFrom([{ permissions: {} }]), false);
  assert.strictEqual(requireOsSandboxFrom([{ permissions: { requireOsSandbox: false } }]), false);
  assert.strictEqual(requireOsSandboxFrom([{ permissions: { requireOsSandbox: true } }]), true);
  for (const bad of ['yes', 1, null, 0, 'false', {}, []]) assert.strictEqual(requireOsSandboxFrom([{ permissions: { requireOsSandbox: bad } }]), true, `bad value ${JSON.stringify(bad)}: fail closed`);
  assert.strictEqual(requireOsSandboxFrom([{ permissions: 'x' }]), true, 'a malformed permissions section: fail closed');
  assert.strictEqual(requireOsSandboxFrom(['unreadable']), true, 'a policy that is present but unreadable: fail closed');
  assert.strictEqual(requireOsSandboxFrom([{ permissions: { requireOsSandbox: true } }, { permissions: { requireOsSandbox: false } }]), true, 'a later layer cannot set it back to false');
  assert.strictEqual(requireOsSandboxFrom([JSON.parse('{"__proto__":{"permissions":{"requireOsSandbox":true}}}')]), false, 'own properties only');
  assert.strictEqual(requireOsSandbox(), false, 'no spec 076 reader yet: not required ([KNOWN GAP])');
  // FR-007c: the stored choice: known app ids only
  assert.deepStrictEqual(parseSettings(JSON.stringify({ sandboxAlwaysContinue: ['claude', 'evil', 'claude', 3] })).sandboxAlwaysContinue, ['claude']);
  assert.strictEqual(parseSettings(JSON.stringify({ sandboxAlwaysContinue: 'claude' })).sandboxAlwaysContinue, undefined);
  ok('T050: requireOsSandbox is narrow-only and fails closed; the stored Always choice keeps known app ids only');
}
// ---- FR-009/FR-010: the window's words (src/renderer/sandboxtext.js) ----
{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  // review on PR 753 (item 1): the real-run script's records never hold a session id
  {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { maskArgv, maskIds, ID_MASK } = require('./sandbox-real-mask') as typeof import('./sandbox-real-mask');
    const id = '30447328-47f2-4f4c-8177-831c1b0f0031';
    assert.deepStrictEqual(maskArgv(['-p', '--session-id', id, '--model', 'haiku']), ['-p', '--session-id', ID_MASK, '--model', 'haiku']);
    assert.deepStrictEqual(maskArgv(['--resume', 'not-a-uuid-shape', '--resume=abc']), ['--resume', ID_MASK, `--resume=${ID_MASK}`], 'any value after an id flag');
    assert.ok(!maskArgv(['--settings', `{"x":"${id.toUpperCase()}"}`]).join(' ').toLowerCase().includes(id), 'a UUID anywhere is masked');
    assert.strictEqual(maskIds(`session ${id} done`), `session ${ID_MASK} done`);
    assert.deepStrictEqual(maskArgv(['--model', 'haiku']), ['--model', 'haiku'], 'other args unchanged');
  }
  // T066 (K16): the switch probe's verdict comes from the printed exit codes AND the file on disk, never from the model's words
  {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const V = require('./sandbox-switch-verdict') as typeof import('./sandbox-switch-verdict');
    assert.deepStrictEqual(V.parseExitCodes('touch: cannot touch \'x\': Read-only file system\ntouch=1\ncurl: (6) Could not resolve host\ncurl=6\n'), { touch: 1, curl: 6 });
    assert.deepStrictEqual(V.parseExitCodes('touch=0\ncurl=0'), { touch: 0, curl: 0 });
    assert.deepStrictEqual(V.parseExitCodes('touch=1\ntouch=0\ncurl=7'), { touch: 0, curl: 7 }, 'the last line wins');
    assert.deepStrictEqual(V.parseExitCodes('echo "touch=$?" said touch=0 inline'), {}, 'only a line of its own counts');
    assert.deepStrictEqual(V.parseExitCodes(''), {});
    const ok = { ran: true, touch: 0, curl: 0, fileExists: true };
    const blocked = { ran: true, touch: 1, curl: 7, fileExists: false };
    assert.strictEqual(V.stepOutcome(ok), 'both-ok');
    assert.strictEqual(V.stepOutcome(blocked), 'both-blocked');
    assert.strictEqual(V.stepOutcome({ ...ok, fileExists: false }), 'mixed', 'exit 0 without the file is not a write');
    assert.strictEqual(V.stepOutcome({ ...blocked, fileExists: true }), 'mixed', 'a file that exists is not a blocked write');
    assert.strictEqual(V.stepOutcome({ ...ok, curl: 6 }), 'mixed', 'write ok, network blocked');
    assert.strictEqual(V.stepOutcome({ ...blocked, curl: 0 }), 'mixed', 'write blocked, network ok');
    assert.strictEqual(V.stepOutcome({ ...ok, ran: false }), 'not-run');
    assert.strictEqual(V.stepOutcome({ ran: true, touch: 0, fileExists: true }), 'not-run', 'a missing code');
    assert.strictEqual(V.switchVerdict({ control: 'both-blocked', update: 'resolved', after: 'both-ok' }).verdict, 'A');
    for (const control of ['both-ok', 'mixed', 'not-run'] as const) assert.strictEqual(V.switchVerdict({ control, update: 'resolved', after: 'both-ok' }).verdict, 'cannot-tell', `control ${control}: cannot tell`);
    for (const after of ['both-blocked', 'mixed'] as const) {
      assert.strictEqual(V.switchVerdict({ control: 'both-blocked', update: 'resolved', after }).verdict, 'B', `accepted, not honoured (${after})`);
      assert.strictEqual(V.switchVerdict({ control: 'both-blocked', update: 'refused', after }).verdict, 'B', `refused (${after})`);
    }
    assert.ok(V.switchVerdict({ control: 'both-blocked', update: 'resolved', after: 'both-blocked' }).why.startsWith('accepted, not honoured'));
    assert.strictEqual(V.switchVerdict({ control: 'both-blocked', update: 'refused', after: 'both-ok' }).verdict, 'cannot-tell', 'free although refused: not A');
    assert.strictEqual(V.switchVerdict({ control: 'both-blocked', update: 'resolved', after: 'not-run' }).verdict, 'cannot-tell');
    assert.strictEqual(V.step4Expected('A'), 'both-blocked', 'A: narrowing must block again');
    assert.strictEqual(V.step4Expected('B'), 'both-ok', 'B: the resumed Allow all session is free');
    assert.strictEqual(V.step4Expected('cannot-tell'), 'both-ok');
    // review on PR #827: the spend gate before every send
    assert.strictEqual(V.SWITCH_MAX_PROMPTS, 3, 'the owner approved about 3 prompts');
    assert.strictEqual(V.SWITCH_MAX_AIU, 1, 'the script stops at 1 AIU');
    const fresh = { prompts: 0, aiu: 0, usageKnown: true, timedOut: false, strayCall: false };
    assert.strictEqual(V.mayPrompt(fresh).ok, true, 'the first prompt');
    assert.strictEqual(V.mayPrompt({ ...fresh, prompts: 2, aiu: 0.3 }).ok, true, 'the third prompt within the budget');
    assert.strictEqual(V.mayPrompt({ ...fresh, prompts: 3, aiu: 0.3 }).ok, false, 'no 4th prompt');
    assert.strictEqual(V.mayPrompt({ ...fresh, prompts: 1, aiu: 1 }).ok, false, 'no prompt at 1 AIU');
    assert.strictEqual(V.mayPrompt({ ...fresh, prompts: 1, aiu: 1.5 }).ok, false, 'no prompt over 1 AIU');
    assert.strictEqual(V.mayPrompt({ ...fresh, prompts: 1, aiu: 0.999 }).ok, true, 'just under the stop');
    assert.strictEqual(V.mayPrompt({ ...fresh, prompts: 1, aiu: Number.NaN }).ok, false, 'an unreadable sum');
    assert.strictEqual(V.mayPrompt({ ...fresh, prompts: 1, usageKnown: false }).ok, false, 'unknown usage is never 0');
    assert.strictEqual(V.mayPrompt({ ...fresh, prompts: 1, timedOut: true }).ok, false, 'after a turn that did not end');
    assert.strictEqual(V.mayPrompt({ ...fresh, prompts: 1, strayCall: true }).ok, false, 'after a command that is not C');
    assert.strictEqual(V.mayPrompt({ ...fresh, prompts: -1 }).ok, false, 'a bad count');
    // only the exact call counts; any other start is stray
    const C = 'touch /h/p/probe.txt; echo "touch=$?"; curl -sS -m 5 -o /dev/null https://example.com; echo "curl=$?"';
    const exactOnly = V.probeCalls([{ callId: 'a', phase: 'start', args: { command: C } }, { callId: 'a', phase: 'complete', output: 'touch=1\ncurl=7' }], C);
    assert.deepStrictEqual(exactOnly, { stray: false, exactRan: true, output: 'touch=1\ncurl=7' });
    const strayLater = V.probeCalls([{ callId: 'a', phase: 'start', args: { command: C } }, { callId: 'a', phase: 'complete', output: 'touch=1\ncurl=7' }, { callId: 'b', phase: 'start', args: { command: 'echo curl=0' } }, { callId: 'b', phase: 'complete', output: 'curl=0' }], C);
    assert.strictEqual(strayLater.stray, true, 'another command is stray');
    assert.strictEqual(strayLater.output, 'touch=1\ncurl=7', 'the result comes from the exact call, not the last one');
    const onlyStray = V.probeCalls([{ callId: 'b', phase: 'start', args: { command: C + ' ' } }, { callId: 'b', phase: 'complete', output: 'touch=0\ncurl=0' }], C);
    assert.deepStrictEqual(onlyStray, { stray: true, exactRan: false }, 'near-miss commands never count');
    assert.strictEqual(V.probeCalls([{ callId: 'c', phase: 'start', args: {} }], C).stray, true, 'a call with no command is stray');
    assert.strictEqual(V.probeCalls([{ callId: 'c', phase: 'start' }], C).stray, true, 'a call with no arguments is stray');
    const twice = V.probeCalls([{ callId: 'a', phase: 'start', args: { command: C } }, { callId: 'a', phase: 'complete', output: 'touch=1\ncurl=7' }, { callId: 'b', phase: 'start', args: { command: C } }, { callId: 'b', phase: 'complete', output: 'touch=0\ncurl=0' }], C);
    assert.strictEqual(twice.stray, true, 'a second exact run is stray');
    assert.strictEqual(twice.output, 'touch=1\ncurl=7', 'only the first exact run is read');
    const twiceLateFirst = V.probeCalls([{ callId: 'a', phase: 'start', args: { command: C } }, { callId: 'b', phase: 'start', args: { command: C } }, { callId: 'b', phase: 'complete', output: 'touch=0\ncurl=0' }, { callId: 'a', phase: 'complete', output: 'touch=1\ncurl=7' }], C);
    assert.strictEqual(twiceLateFirst.output, 'touch=1\ncurl=7', 'the first exact call, even when the second ends first');
    const dupEnd = V.probeCalls([{ callId: 'a', phase: 'start', args: { command: C } }, { callId: 'a', phase: 'failed', output: 'touch=1\ncurl=7' }, { callId: 'a', phase: 'complete', output: 'touch=0\ncurl=0' }], C);
    assert.strictEqual(dupEnd.output, 'touch=1\ncurl=7', 'a call that reports its end twice: the first end is read');
    assert.strictEqual(V.probeCalls([{ callId: 'r', phase: 'start', args: { intent: 'x' } }, { callId: 'a', phase: 'start', args: { command: C } }], C).stray, true, 'another tool (report_intent-like) is stray, not ignored');
    // the permission gate: only exactly C, as a shell request
    assert.strictEqual(V.probeGateAllows({ kind: 'shell', fullCommandText: C }, C), true, 'exact C');
    for (const [req, why] of [
      [{ kind: 'shell', fullCommandText: C + '; curl evil' }, 'C; curl evil'],
      [{ kind: 'shell', fullCommandText: C + ' ' }, 'a trailing space'],
      [{ kind: 'shell', fullCommandText: ' ' + C }, 'a leading space'],
      [{ kind: 'write', fullCommandText: C }, 'not a shell request'],
      [{ kind: 'shell' }, 'no command text'],
      [{ kind: 'shell', fullCommandText: 42 }, 'not a string'],
      [null, 'no request'],
      [undefined, 'undefined'],
      ['shell', 'not an object'],
    ] as Array<[unknown, string]>) assert.strictEqual(V.probeGateAllows(req, C), false, `refused: ${why}`);
    assert.strictEqual(V.probeGateAllows({ kind: 'shell', fullCommandText: '' }, ''), false, 'an empty C allows nothing');
    assert.strictEqual(V.stepOutcome({ ran: onlyStray.exactRan, ...V.parseExitCodes(onlyStray.output ?? ''), fileExists: true }), 'not-run');
    // source checks: one send, gated right before it; exactly 3 steps; the limits come from the tested module; Windows refused
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'sandbox-floor-real.ts'), 'utf8').replace(/\r/g, ''); // a Windows checkout has CRLF (as #825)
    const sw = src.slice(src.indexOf('async function runSwitchSteps'), src.indexOf('async function main()'));
    assert.ok(sw.length > 1000, 'the switch steps are found');
    assert.strictEqual((sw.match(/\ba\.send\(/g) ?? []).length, 1, 'one send in the switch probe');
    assert.match(sw, /const gate = mayPrompt\(\{ prompts, aiu: usageOf\(0\)\.aiu, usageKnown, timedOut: anyTimedOut, strayCall: anyStray \|\| strayAsks > 0 \}\);\n\s*if \(!gate\.ok\) throw new Error\([^\n]*\);\n\s*prompts\+\+;\n[^\n]*\n\s*await a\.send\(/, 'mayPrompt gates the send, right before it');
    assert.strictEqual((sw.match(/await runStep\(/g) ?? []).length, 3, 'at most three prompts');
    assert.ok(!/SWITCH_MAX_(AIU|PROMPTS)\s*=/.test(src), 'the limits are the tested module constants');
    assert.match(sw, /if \(stray \|\| timed \|\| !usageKnown\) throw new Error\(/, 'a stray call, a timeout or unknown usage stops after the step');
    assert.match(sw, /if \(usageOf\(from\)\.priced === 0\) usageKnown = false;/, 'no usage with a number means unknown');
    assert.match(sw, /if \(v\.verdict === 'cannot-tell'\) \{[\s\S]{0,300}?return;/, 'a cannot-tell after step 3 stops there');
    assert.match(src, /if \(switchProbe && process\.platform === 'win32'\) throw new Error\('switch: Linux\/macOS only/, 'Windows refused up front');
    assert.match(sw, /if \(curlExit !== 0 \|\| !writeOk\) throw new Error\('refused: the baseline failed/, 'the baseline gates the spend');
    assert.match(sw, /if \(!probeGateAllows\(req, C\) \|\| !inner2\) \{/, 'the permission handler uses the tested gate');
    assert.match(sw, /\n\s*if \(!shellToolParams\.properties\.includes\('command'\)\) throw new Error\('refused|\n\s*if \(!shellToolParams\.properties\.includes\('command'\)\) throw new Error\(`refused/, 'the spend run refuses a bash tool with no command argument');
  }
  // FR-021a (K15): the Copilot state says it only in Ask first with the floor on; the card line is the agreed sentence
  const host = { supported: true, capabilities: [] };
  assert.strictEqual(copilotSandboxState({ mode: 'ask', platform: 'linux', host, applied: true })?.approvedMayLeave, true, 'Ask first, on: may leave');
  assert.strictEqual(copilotSandboxState({ mode: 'read-only', platform: 'linux', host, applied: true })?.approvedMayLeave, undefined, 'Read-only: never asks');
  assert.strictEqual(copilotSandboxState({ mode: 'ask', platform: 'linux', host })?.approvedMayLeave, undefined, 'not on yet: no claim');
  assert.strictEqual(COPILOT_SANDBOX_NOTE_COMMAND, 'If you approve, Copilot’s sandbox may still let this write outside the folder (seen on Linux, 2026-10-25).');
  const T = require('../../src/renderer/sandboxtext.js') as { chipWord(s: unknown): string; tooltip(s: unknown, app: string, mask?: (t: string) => string): string; hostLine(v: unknown): string; NOT_VERIFIED: string };
  const on = { state: 'on', mechanism: 'bubblewrap', covers: ['shell'], writes: 'none', verified: false };
  assert.strictEqual(T.chipWord(on), 'Sandboxed');
  assert.strictEqual(T.chipWord({ ...on, state: 'unknown' }), 'Sandbox: checking');
  assert.strictEqual(T.chipWord({ ...on, state: 'off' }), 'Not sandboxed');
  assert.strictEqual(T.chipWord({ ...on, managed: true }), 'Sandboxed (managed)');
  assert.strictEqual(T.chipWord({ ...on, untilNewSession: true }), 'Sandboxed (until a new session)');
  // FR-021b (K15): Copilot in Ask first (covers MCP, may leave) is not a bare "Sandboxed"; Claude, Codex and Read-only keep their words
  assert.strictEqual(T.chipWord({ ...on, covers: ['shell', 'mcp'], approvedMayLeave: true }), 'Sandboxed (partial)');
  assert.strictEqual(T.chipWord({ ...on, covers: ['shell', 'mcp'] }), 'Sandboxed', 'Read-only Copilot: unchanged');
  assert.strictEqual(T.chipWord({ ...on, covers: ['shell', 'files'], approvedMayLeave: true }), 'Sandboxed', 'Codex: unchanged');
  assert.strictEqual(T.chipWord({ ...on, covers: ['shell', 'mcp'], approvedMayLeave: true, managed: true }), 'Sandboxed (managed)', 'managed keeps precedence');
  assert.strictEqual(T.chipWord(null), '', 'no state: nothing (the UI degrades, constitution II)');
  assert.strictEqual(T.chipWord({ ...on, mechanism: 'landlock' }), '', 'malformed: nothing');
  const tip = T.tooltip(on, 'Claude Code');
  assert.ok(tip.endsWith(T.NOT_VERIFIED) && T.NOT_VERIFIED === 'Requested; not verified on a real session.', 'ends with the not-verified sentence');
  assert.ok(/MCP servers, hooks, the status line, file reads and edits are outside it\./.test(tip), 'Claude: MCP not covered');
  assert.ok(!T.tooltip({ ...on, verified: true }, 'Claude Code').includes('not verified'), 'a verified state drops it');
  assert.ok(/Shell commands and MCP servers run in the macOS sandbox \(writes: this folder/.test(T.tooltip({ ...on, mechanism: 'seatbelt', covers: ['shell', 'mcp'], writes: 'folders' }, 'Copilot')));
  // FR-021a (K15): Copilot in Ask first says an approved command may leave the sandbox, and still ends with the not-verified sentence
  const cpAsk = T.tooltip({ ...on, covers: ['shell', 'mcp'], writes: 'folders', approvedMayLeave: true }, 'Copilot');
  assert.ok(cpAsk.includes('(writes: not only this folder, network: off). File reads and edits are checked by Durbar. An approved command could write outside the folder (Copilot, seen on Linux, 2026-10-25).'), cpAsk);
  assert.ok(!cpAsk.includes('writes: this folder'), 'no this-folder claim the run refuted');
  assert.ok(cpAsk.endsWith(T.NOT_VERIFIED) && cpAsk.length <= 300, 'not cut: the not-verified sentence is kept');
  const cpRo = T.tooltip({ ...on, covers: ['shell', 'mcp'] }, 'Copilot');
  assert.ok(!cpRo.includes('An approved command'), 'Read-only: no such sentence');
  assert.ok(cpRo.includes('(writes: none asked; Copilot may add one, network: off)') && !cpRo.includes('writes: none,'), `Read-only: no bare "writes: none" (K15): ${cpRo}`);
  assert.ok(cpRo.endsWith(T.NOT_VERIFIED), 'Read-only keeps the not-verified ending');
  const cpKept = T.tooltip({ ...on, covers: ['shell', 'mcp'], untilNewSession: true, managed: true }, 'Copilot');
  assert.ok(cpKept.endsWith(T.NOT_VERIFIED) && cpKept.length <= 300, `the longest Copilot tooltip still ends with the not-verified sentence (${cpKept.length})`);
  assert.ok(T.tooltip(on, 'Claude Code').includes('(writes: none, network: off)'), 'Claude keeps its own wording (its Read-only refusal was seen)');
  assert.ok(/Commands and file changes run in the Codex sandbox \(writes: none, network: off\)\. If you approve a command, Codex may run it outside the sandbox\./.test(T.tooltip({ state: 'on', mechanism: 'vendor', covers: ['shell', 'files'], approvedMayLeave: true, verified: false }, 'Codex')));
  const off = T.tooltip({ state: 'off', covers: ['shell'], verified: false, reason: 'no bwrap ghp_abcdefghijklmnopqrstuvwxyz0123456789' }, 'Claude Code', () => '');
  assert.ok(!off.includes('ghp_') && !off.includes('no bwrap'), 'no mask: the reason is not shown (fail closed)');
  assert.ok(/own checks still apply/.test(off));
  assert.strictEqual(T.hostLine({ available: true, mechanism: 'processcontainer' }), 'OS sandbox: available (Windows ProcessContainer)');
  assert.strictEqual(T.hostLine({ available: false, reason: 'r' }), 'OS sandbox: not available: r');
  const longest = T.tooltip({ state: 'unknown', mechanism: 'processcontainer', managed: true, untilNewSession: true, covers: ['shell', 'mcp'], writes: 'folders', verified: false }, 'GitHub Copilot');
  assert.ok(longest.length <= 300, 'a data tooltip: at most 300 characters (' + longest.length + ')');
  assert.ok(T.tooltip({ state: 'off', covers: ['shell'], verified: false, reason: 'x'.repeat(200) }, 'Claude Code', (t) => t).length <= 300);
  assert.ok(/PATH folders/.test((T as unknown as { details(s: unknown, a: string): string }).details({ ...on, covers: ['shell', 'mcp'] }, 'Copilot')), 'the mode menu says what PATH grants (FR-004)');
  const lo = { ...on, reason: 'Some session folders are left out of the sandbox: credential folders, or paths it cannot use.', leftOut: ['/h/.aws (credential folder)'] };
  assert.ok(/Some session folders are left out/.test(T.tooltip(lo, 'Claude Code', (t) => t)) && T.tooltip(lo, 'Claude Code', (t) => t).endsWith(T.NOT_VERIFIED), 'the tooltip says folders are left out and still ends as required');
  assert.ok((T as unknown as { details(s: unknown, a: string, m: (t: string) => string): string }).details(lo, 'Claude Code', (t) => t).startsWith('Left out of the sandbox: /h/.aws (credential folder).'), 'the mode menu names them');
  // review round 6 (1): a long list: every folder up to the cap is named (no 200-character cut), the rest counted; masked per entry
  const many = leftOutFields(Array.from({ length: 14 }, (_, i) => ({ folder: `/very/long/path/number/${i}/` + 'x'.repeat(60), why: i % 2 ? 'credential' as const : 'unusable' as const })))!;
  assert.strictEqual(many.leftOut.length, 10);
  assert.strictEqual(many.leftOutMore, 4);
  assert.ok(many.reason.length <= 200);
  const cleaned = cleanSandboxState({ ...on, ...many })!;
  assert.strictEqual(cleaned.leftOut!.length, 10, 'main keeps all ten');
  const d = (T as unknown as { details(s: unknown, a: string, m: (t: string) => string): string }).details(cleaned, 'Claude Code', (t) => t);
  for (let i = 0; i < 10; i++) assert.ok(d.includes(`/very/long/path/number/${i}/`), 'named: ' + i);
  assert.ok(/and 4 more/.test(d));
  const three = leftOutFields([{ folder: '/', why: 'unusable' }, { folder: '/home/me/.aws', why: 'credential' }, { folder: '/home/me/x', why: 'unusable' }])!;
  assert.deepStrictEqual(three.leftOut, ['/ (not usable)', '/home/me/.aws (credential folder)', '/home/me/x (not usable)'], 'the third folder is named too');
  assert.strictEqual(cleanSandboxState({ ...on, leftOut: new Array(11).fill('x') }), undefined, 'over the cap: malformed');
  // review round 7 (3): non-string entries make the state malformed; each entry is masked by main
  assert.strictEqual(cleanSandboxState({ ...on, leftOut: ['/a (not usable)', 7] }), undefined, 'a non-string entry: malformed');
  assert.strictEqual(cleanSandboxState({ ...on, leftOut: ['/a', null] }), undefined);
  const TOKEN = 'ghp_' + 'abcdefghijklmnopqrstuvwxyz0123456789';
  const maskedEntry = cleanSandboxState({ ...on, leftOut: [`/h/${TOKEN} (not usable)`] })!.leftOut![0];
  assert.ok(!maskedEntry.includes('ghp_') && /redacted/.test(maskedEntry), 'main masks each entry: ' + maskedEntry);
  // review round 7 (1): masked BEFORE it is shortened: a token across the cut point never leaves a part of itself
  for (const pad of [20, 30, 36, 40, 45, 60, 90]) {
    const lf = leftOutFields([{ folder: '/' + 'a'.repeat(pad) + '/' + TOKEN + '/' + 'b'.repeat(100), why: 'unusable' }])!.leftOut[0];
    assert.ok(!/ghp_[A-Za-z0-9]/.test(lf) && !/[a-z0-9]{8,}…|…[a-z0-9]{0,3}[0-9]{4}/.test(lf.replace(/a{5,}|b{5,}/g, '')), `token at ${pad}: no part of it survives: ${lf}`);
    assert.ok(!lf.includes('abcdefgh') && !lf.includes('0123456789'), `token at ${pad}: ${lf}`);
  }
  const tail = leftOutFields([{ folder: '/' + 'a'.repeat(100) + '/' + TOKEN + '/bb', why: 'unusable' }])!.leftOut[0];
  assert.ok(!tail.includes('ghp_') && /redacted/.test(tail), 'a token kept by the shortening is masked by the adapter itself: ' + tail);
  // review round 8 (2, 5): never half an emoji or a combining sequence at either cut; the tail starts at a word boundary
  const emoji = '\u{1F600}', comb = 'e\u0301';
  for (const n of [36, 37, 38, 39, 40, 41]) {
    for (const ch of [emoji, comb, '\u{1F469}\u200D\u{1F4BB}']) {
      const lf = leftOutFields([{ folder: '/' + 'x'.repeat(n) + ch + 'y'.repeat(20) + '/' + 'z'.repeat(120) + ch + '/end', why: 'unusable' }])!.leftOut[0];
      assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(lf), `no lone surrogate (${n}): ${JSON.stringify(lf)}`);
      assert.ok(!/(^|[^e])\u0301/.test(lf) && !/\u200D(…|$)|(^|…)\u200D/.test(lf), `no broken sequence (${n}): ${JSON.stringify(lf)}`);
    }
  }
  // review round 9: the HEAD cut never ends mid-word or mid-[redacted] mark (a word and a mark both cross the 40th character)
  for (const pre of [30, 33, 35, 37, 39]) {
    const head = leftOutFields([{ folder: '/' + 'p'.repeat(pre) + '/wordacrossthecut/' + TOKEN + '/' + 'q'.repeat(150), why: 'unusable' }])!.leftOut[0].split('…')[0];
    assert.ok(/[^A-Za-z0-9_\-.~+=:@%[\]]$/.test(head) || head === '', `the head ends at a boundary (${pre}): ${JSON.stringify(head)}`);
    assert.ok(!/word[a-z]*$/.test(head) && !/\[[a-z]*$/.test(head), `no half word or half mark at the head (${pre}): ${JSON.stringify(head)}`);
  }
  for (const pre of [24, 27, 30, 32]) {
    const head = leftOutFields([{ folder: '/' + 'p'.repeat(pre) + '/' + TOKEN + '/' + 'q'.repeat(150), why: 'unusable' }])!.leftOut[0].split('…')[0];
    assert.ok(!/\[[a-z]*$/.test(head) && !/\[redacted$/.test(head), `a [redacted] mark is never cut at the head (${pre}): ${JSON.stringify(head)}`);
  }
  const cutTail = leftOutFields([{ folder: '/a/' + 'b'.repeat(200) + '/tailword' + 'c'.repeat(90), why: 'unusable' }])!.leftOut[0];
  const afterCut = cutTail.split('…')[1] ?? '';
  assert.ok(afterCut === '' || !/^[A-Za-z0-9]/.test(afterCut) || afterCut.length >= 79, 'the tail starts at a word boundary, never mid-word: ' + JSON.stringify(cutTail));
  assert.ok(!/…c{1,88}\s/.test(cutTail) && !/…c+ \(/.test(cutTail), 'no word cut in half after the …: ' + JSON.stringify(cutTail));
  // review round 7 (2): the event the window gets is cleaned too: a malformed state becomes null, every entry and the note masked
  const raw = { type: 'sandbox', sessionId: 's', timestamp: 1, sandbox: { ...on, reason: 'r ' + TOKEN, leftOut: [`/x/${TOKEN} (not usable)`] }, notice: { text: `could not start: ${TOKEN}\u0007 Nothing was sent.`, actions: ['continue', 'evil'] } };
  const out = outwardSandboxEvent(raw) as unknown as { sandbox: { reason?: string; leftOut?: string[] } | null; notice: { text: string; actions: string[] } };
  assert.ok(!JSON.stringify(out).includes('ghp_'), 'no token reaches the window: ' + JSON.stringify(out));
  assert.deepStrictEqual(out.notice.actions, ['continue'], 'unknown actions dropped');
  assert.ok(!/\u0007/.test(out.notice.text));
  assert.strictEqual((outwardSandboxEvent({ type: 'sandbox', sandbox: { state: 'on', covers: [42], verified: false } }) as { sandbox: unknown }).sandbox, null, 'a malformed state: null');
  const other = { type: 'output', delta: TOKEN };
  assert.strictEqual(outwardSandboxEvent(other), other, 'other events pass unchanged (outward() handles them)');
  assert.ok(!(T as unknown as { details(s: unknown, a: string, m: (t: string) => string): string }).details({ ...on, leftOut: ['/h/ghp_abcdefghijklmnopqrstuvwxyz0123456789 (not usable)'] }, 'C', () => '').includes('ghp_'), 'each entry only through the mask');
  ok('FR-009/FR-010: the chip words and the tooltip per app; the reason only through the mask');
}
// ---- T067 (FR-022, FR-022a, FR-022e; issue #806): Restart without the sandbox, the pure rule and its words (src/renderer/sandboxtext.js) ----
{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const T = require('../../src/renderer/sandboxtext.js') as { canRestartWithoutSandbox(o: unknown): boolean; restartTip(s: unknown, app: string): string; allowAllNote(s: unknown, app: string): string; NOT_VERIFIED: string };
  const can = (sandbox: unknown, mode: string, caps: unknown = { resume: true }) => T.canRestartWithoutSandbox({ sandbox, mode, caps });
  const host = { supported: true, capabilities: [] };
  // the Copilot states, from the adapter's own state function
  const kept = copilotSandboxState({ mode: 'allow', platform: 'linux', keptFloor: true });
  assert.ok(kept?.untilNewSession === true, 'Copilot: a floor kept in Allow all says untilNewSession');
  assert.strictEqual(can(kept, 'allow'), true, 'AC1: Allow all + untilNewSession + not managed + resume');
  assert.strictEqual(can(kept, 'allow', { resume: false }), false, 'no resume: no action');
  assert.strictEqual(can(kept, 'allow', {}), false, 'resume missing: no action');
  assert.strictEqual(can(kept, 'allow', { resume: 'yes' }), false, 'only resume === true');
  assert.strictEqual(can(kept, 'allow', null), false, 'no caps: no action');
  for (const mode of ['read-only', 'ask', 'plan', '', undefined]) assert.strictEqual(can(kept, mode as string), false, `mode ${String(mode)}: no action`);
  assert.strictEqual(can({ ...kept, managed: true }, 'allow'), false, 'managed: no action (the new session would be sandboxed again)');
  assert.strictEqual(can({ ...kept, state: 'off' }, 'allow'), false, 'off: no action');
  assert.strictEqual(can({ ...kept, state: 'unknown' }, 'allow'), false, 'unknown: no action');
  const { untilNewSession: _u, ...noKeep } = kept!;
  void _u;
  assert.strictEqual(can(noKeep, 'allow'), false, 'a state without untilNewSession: no action');
  assert.strictEqual(can(copilotSandboxState({ mode: 'allow', platform: 'linux' }), 'allow'), false, 'a fresh Allow all session (no floor): no action');
  for (const mode of ['read-only', 'ask'] as const) {
    assert.strictEqual(can(copilotSandboxState({ mode, platform: 'linux', host, applied: true }), mode), false, `Copilot ${mode}, floor on: no action`);
    assert.strictEqual(can(copilotSandboxState({ mode, platform: 'linux', host, applied: true }), 'allow'), false, `Copilot ${mode} state read as Allow all: no action (no untilNewSession)`);
  }
  // Claude Code and Codex never produce it (their own state functions, every mode and platform)
  const lin = { platform: 'linux', version: '2.1.300', haveBwrap: true, haveSocat: true };
  for (const mode of MODES) for (const m2 of MODES) {
    for (const extra of [{ started: true }, {}, { continued: true }, { startExit: 'x' }]) assert.strictEqual(can(claudeSandboxState({ mode, facts: lin, ...extra }), m2), false, `Claude ${mode}/${m2}: never`);
    for (const os2 of OSES) assert.strictEqual(can(codexSandboxState(mode, os2), m2), false, `Codex ${mode}/${m2} ${os2}: never`);
  }
  // AC2: malformed input fails closed (as clean())
  for (const bad of [null, undefined, 'x', 42, [], { mode: 'allow' }, { sandbox: kept }, { sandbox: { ...kept, mechanism: 'landlock' }, mode: 'allow', caps: { resume: true } }, { sandbox: { ...kept, covers: 'shell' }, mode: 'allow', caps: { resume: true } }, { sandbox: { ...kept, untilNewSession: 'true' }, mode: 'allow', caps: { resume: true } }, { sandbox: [kept], mode: 'allow', caps: { resume: true } }])
    assert.strictEqual(T.canRestartWithoutSandbox(bad), false, `malformed ${JSON.stringify(bad)}: false`);
  assert.strictEqual(can(Object.assign(Object.create({ untilNewSession: true }), noKeep), 'allow'), false, 'own properties only (an inherited untilNewSession does not count)');
  // FR-022: the tooltip says what Durbar does (no vendor fact), names the app given, keeps "not verified", at most 300
  const tip = T.restartTip(kept, 'Copilot');
  assert.strictEqual(tip, 'Durbar does not turn Copilot’s sandbox off inside a running session; it stays until a new one. Restart keeps this conversation and starts a new session in Allow all. ' + T.NOT_VERIFIED);
  assert.ok(T.restartTip(kept, 'X'.repeat(200)).length <= 300, 'a long app name: at most 300');
  assert.ok(!T.restartTip({ ...kept, verified: true }, 'Copilot').includes('not verified'), 'a verified state drops the sentence');
  assert.ok(T.restartTip(kept, 'Some App').includes('Some App’s sandbox'), 'the app name is the one given (the adapter display name)');
  // FR-022e: the Allow all dialog's sentence only for a floor the switch keeps (Copilot Read-only / Ask first, on)
  const NOTE = 'Copilot’s OS sandbox stays on for shell commands until a new session; use Restart without the sandbox to lift it.';
  for (const mode of ['read-only', 'ask'] as const) assert.strictEqual(T.allowAllNote(copilotSandboxState({ mode, platform: 'linux', host, applied: true }), 'Copilot'), NOTE, `Copilot ${mode}: the sentence`);
  assert.strictEqual(T.allowAllNote(copilotSandboxState({ mode: 'ask', platform: 'linux', host, refused: 'no' }), 'Copilot'), '', 'Copilot off (refused): no floor, no sentence');
  assert.strictEqual(T.allowAllNote(copilotSandboxState({ mode: 'ask', platform: 'linux', host, continued: true }), 'Copilot'), '', 'Copilot continued without it: no sentence');
  assert.strictEqual(T.allowAllNote(kept, 'Copilot'), '', 'already kept in Allow all: no sentence');
  assert.strictEqual(T.allowAllNote(null, 'Copilot'), '', 'no state: no sentence');
  for (const mode of ['read-only', 'ask'] as const) {
    assert.strictEqual(T.allowAllNote(claudeSandboxState({ mode, facts: lin, started: true }), 'Claude Code'), '', `Claude ${mode}: no sentence`);
    assert.strictEqual(T.allowAllNote(codexSandboxState(mode, 'linux'), 'Codex'), '', `Codex ${mode}: no sentence`);
  }
  ok('T067: Restart without the sandbox only for a kept floor in Allow all (not managed, resume); never for Claude Code or Codex; fails closed; its tooltip and the Allow all sentence');
}
console.log('sandbox floor (spec 087): all checks passed');
FLOOR_DONE = true;
