/**
 * Spec 087 T014 (SC-001, SC-002, FR-016, FR-018): the OS sandbox floor of every app × OS × mode cell, from the pure modules, with
 * injected platform facts. Plus the shared roots rule (T010), the normalized state (T013), Codex's card line (T022) and the scans that
 * no cell sends an auto-approve, a bypass, the dev-tool grants or credential injection. No process, no account, no credits.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { CLAUDE_SANDBOX_MIN_VERSION, claudeSandboxExit, claudeSandboxPrecheck, claudeSandboxSettings, claudeSandboxState, withSandboxSettings } from '../src/adapters/claudeSandbox';
import { copilotHostSupport, copilotPathReadDirs, copilotSandboxConfig, copilotSandboxState } from '../src/adapters/copilotSandbox';
import { CODEX_SANDBOX_NOTE_COMMAND, CODEX_SANDBOX_NOTE_FILE, codexModeSettings, codexPermission, codexSandboxState } from '../src/adapters/codexModes';
import { HOME_SECRETS, sandboxRoots } from '../src/adapters/sandboxRoots';
import * as os from 'os';
import { cleanSandboxState, sandboxReason } from '../src/shared/sandbox';
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
  const T = require('../../src/renderer/sandboxtext.js') as { chipWord(s: unknown): string; tooltip(s: unknown, app: string, mask?: (t: string) => string): string; hostLine(v: unknown): string; NOT_VERIFIED: string };
  const on = { state: 'on', mechanism: 'bubblewrap', covers: ['shell'], writes: 'none', verified: false };
  assert.strictEqual(T.chipWord(on), 'Sandboxed');
  assert.strictEqual(T.chipWord({ ...on, state: 'unknown' }), 'Sandbox: checking');
  assert.strictEqual(T.chipWord({ ...on, state: 'off' }), 'Not sandboxed');
  assert.strictEqual(T.chipWord({ ...on, managed: true }), 'Sandboxed (managed)');
  assert.strictEqual(T.chipWord({ ...on, untilNewSession: true }), 'Sandboxed (until a new session)');
  assert.strictEqual(T.chipWord(null), '', 'no state: nothing (the UI degrades, constitution II)');
  assert.strictEqual(T.chipWord({ ...on, mechanism: 'landlock' }), '', 'malformed: nothing');
  const tip = T.tooltip(on, 'Claude Code');
  assert.ok(tip.endsWith(T.NOT_VERIFIED) && T.NOT_VERIFIED === 'Requested; not verified on a real session.', 'ends with the not-verified sentence');
  assert.ok(/MCP servers, hooks, the status line, file reads and edits are outside it\./.test(tip), 'Claude: MCP not covered');
  assert.ok(!T.tooltip({ ...on, verified: true }, 'Claude Code').includes('not verified'), 'a verified state drops it');
  assert.ok(/Shell commands and MCP servers run in the macOS sandbox \(writes: this folder/.test(T.tooltip({ ...on, mechanism: 'seatbelt', covers: ['shell', 'mcp'], writes: 'folders' }, 'Copilot')));
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
  ok('FR-009/FR-010: the chip words and the tooltip per app; the reason only through the mask');
}
console.log('sandbox floor (spec 087): all checks passed');
FLOOR_DONE = true;
