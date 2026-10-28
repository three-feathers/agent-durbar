/**
 * Agent-app updates (spec 081): versions, install sources, the official-Codex rule, check commands and parsers, lookups, the decision,
 * failure classes, the announce rule, the policy filter, start scheduling, the update lock and gate, settings, and the exec with its
 * tree kill. `npm run test:updatecheck`. Nothing runs, nothing is contacted: tools and the network are fakes; every fixture names its source.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { displayWhere, withWhere, killChildTree, makeExec } from '../src/adapters/detect';
import type { DetectEnv, ExecResult } from '../src/adapters/detect';
import { CASKS, PACKAGES } from '../src/shared/harnesssetup';
import type { SetupKind } from '../src/shared/harnesssetup';
import {
  CODEX_UPDATE_COMMAND, LOOKUPS, MAX_VERSION_LENGTH, announceRule, brewInfoCmd, brewOutdatedCmd, classifyFailure, codexNeedsFallback, codexUpdateEnv, copilotVersionFromPath, decide, decideClaudeChannels,
  isOfficialCodex, lookupAllowed, pathWithToolDir, lookupLatest, npmCheck, npmOwns, parseBrewInfo, parseBrewOutdated, parseNpmView, parseVersionField, parseWingetList, policyView, sourceOf, startCheckAllowed, updateDecision,
  updateOutcomeNote, versionFromCaskroom, versionFromPackageJson, versionFromWingetPath, versionLabel, wingetCheck,
} from '../src/shared/updatecheck';
import type { CheckResult, LookupGet, UpdatePolicy } from '../src/shared/updatecheck';
import { FIXED_HEADERS, makeDownloadGet, makeLookupGet } from '../src/main/netget';
import type { NetRequestFactory, NetRequestLike, NetRequestOptions } from '../src/main/netget';
import { UpdateChecker } from '../src/main/updatecheck';
import type { CheckerDeps, UpdatesView } from '../src/main/updatecheck';
import { wingetTermsQuestion } from '../src/shared/updatecheck';
import { ASK_LIMIT_MS, UpdateGate, startHeldBy, updateRunRefusal } from '../src/main/updategate';
import type { RunReply, SessionCount } from '../src/main/updategate';
import { SettingsStore } from '../src/main/settings';
import { HOLD_RETRY_MS, Scheduler } from '../src/main/schedules';
import { parseSettings } from '../src/shared/credits';

// ---- fixtures: each one names its source (T001) ----
const FIX = path.join(__dirname, '..', '..', 'scripts', 'fixtures', 'updatecheck');
const fixtureNames = fs.readdirSync(FIX).filter((f) => f.endsWith('.fixture'));
const fx = (name: string): string => {
  const raw = fs.readFileSync(path.join(FIX, name + '.fixture'), 'utf8').split('\n');
  return raw.filter((l) => !l.startsWith('# ')).join('\n').trim();
};
for (const n of fixtureNames) {
  const head = fs.readFileSync(path.join(FIX, n), 'utf8').split('\n')[0];
  assert.ok(/^# source: (read|real|PLACEHOLDER)/.test(head), `${n}: the first line names its source (read:, real: or PLACEHOLDER)`);
}
assert.ok(fixtureNames.length >= 25, 'fixtures exist');
const location = (name: string): string => /^location: (.+)$/m.exec(fx(name))?.[1] as string;

const HOME = '/home/u';
const senv = (env: Record<string, string | undefined> = {}, homedir = HOME) => ({ homedir, env });

// ---------------------------------------------------------------------------------------------------------------------
// FR-005, T008: strict version fields
{
  assert.strictEqual(MAX_VERSION_LENGTH, 64);
  assert.strictEqual(parseVersionField('0.164.0'), '0.164.0');
  assert.strictEqual(parseVersionField('v1.0.103'), '1.0.103');
  assert.strictEqual(parseVersionField('2.1.308'), '2.1.308');
  assert.strictEqual(parseVersionField('2.2.0-beta.1'), '2.2.0-beta.1');
  assert.strictEqual(parseVersionField(parseNpmView(fx('npm-view-codex'))), '0.164.0');
  assert.strictEqual(parseVersionField(/rust-v(.+)$/.exec(location('github-location-codex'))?.[1]), '0.164.0');
  // anything that is not exactly a version field is rejected
  for (const bad of ['', ' 1.2.3', '1.2.3 ', '1.2.3\n', '1.2', '1.2.3.4', 'x1.2.3', '1.2.3-', '1.2.3-<b>x</b>', '1.2.3; rm -rf', '1234567890.1.1', 'npm ERR! node v22.11.0', '1.2.3\u0000', '１.２.３']) assert.strictEqual(parseVersionField(bad), undefined, JSON.stringify(bad));
  for (const bad of [undefined, null, 5, {}, [], ['1.2.3']]) assert.strictEqual(parseVersionField(bad), undefined);
  // 65 to 71 characters with a valid-looking pre-release are rejected, never cut (FR-005)
  const pre = (n: number) => '1.2.3-' + 'a'.repeat(n);
  assert.strictEqual(pre(40).length, 46);
  assert.strictEqual(parseVersionField('123456789.123456789.123456789-' + 'a'.repeat(34)), '123456789.123456789.123456789-' + 'a'.repeat(34), '64 characters is accepted');
  assert.strictEqual(parseVersionField('123456789.123456789.123456789-' + 'a'.repeat(35)), undefined, '65 characters is rejected, not cut to 64');
  assert.strictEqual(parseVersionField('123456789.123456789.123456789-' + 'a'.repeat(40)), undefined, '71 characters is rejected');
  assert.strictEqual(parseVersionField('1.2.3-' + 'a'.repeat(41)), undefined, 'a pre-release over 40 is rejected');
  // the npm error line holds node v22.11.0 and is never a version
  assert.strictEqual(parseNpmView(fx('npm-error-node')), undefined);
  assert.strictEqual(parseNpmView('"0.164.0 node v22.11.0"'), undefined);
  // 64 KiB of digits within a CPU-time limit (agent-notes: measure CPU time, not wall time) and never a version
  const digits = '1'.repeat(64 * 1024);
  const before = process.cpuUsage();
  for (const text of [digits, `"${digits}"`, digits + '.' + digits + '.' + digits]) {
    assert.strictEqual(parseVersionField(text), undefined);
    assert.strictEqual(parseNpmView(text), undefined);
    assert.strictEqual(parseBrewInfo(`{"casks":[{"token":"codex","version":"${digits}"}]}`, 'codex'), undefined);
    assert.strictEqual(parseWingetList(text, 'Anthropic.ClaudeCode').kind, 'unknown');
  }
  const cpu = process.cpuUsage(before);
  assert.ok((cpu.user + cpu.system) / 1000 < 500, `hostile 64 KiB answers stay linear (CPU ${(cpu.user + cpu.system) / 1000} ms)`);
}

// ---------------------------------------------------------------------------------------------------------------------
// FR-004: decision rules
{
  assert.deepStrictEqual(decide('0.163.0', '0.164.0'), { state: 'update-available' });
  assert.deepStrictEqual(decide('0.164.0', '0.164.0'), { state: 'up-to-date' });
  assert.deepStrictEqual(decide('0.165.0', '0.164.0'), { state: 'up-to-date', installedNewer: true }, 'a source behind the installed version offers nothing');
  assert.strictEqual(decide('2.2.0-beta.1', '2.1.9').state, 'up-to-date', 'a pre-release installed is never a downgrade offer');
  assert.strictEqual(decide('2.2.0-beta.1', '2.2.0').state, 'update-available', 'its stable release is an update');
  assert.strictEqual(decide('2.1.0', '2.2.0-beta.1').state, 'up-to-date', 'a pre-release source version is not "latest" for a stable install');
  assert.strictEqual(decide('2.2.0-beta.1', '2.2.0-beta.2').state, 'update-available', 'a newer pre-release of the same line counts');
  // Claude native: stable decides (Q7 = C); the three positions
  assert.deepStrictEqual(decideClaudeChannels('2.1.300', '2.1.308', '2.1.309'), { state: 'update-available' }, 'below stable');
  assert.deepStrictEqual(decideClaudeChannels('2.1.308', '2.1.308', '2.1.309'), { state: 'up-to-date', newerOnLatest: '2.1.309' }, 'between stable and latest: a quiet note');
  assert.deepStrictEqual(decideClaudeChannels('2.1.309', '2.1.308', '2.1.309'), { state: 'up-to-date' }, 'at latest');
  assert.deepStrictEqual(decideClaudeChannels('2.1.310', '2.1.308', '2.1.309'), { state: 'up-to-date', installedNewer: true }, 'above latest');
}

// ---------------------------------------------------------------------------------------------------------------------
// FR-001, FR-006, T003: install source
{
  const src = (app: SetupKind, p: string, platform: string, env = senv()) => sourceOf(app, p, platform, env);
  // macOS Apple Silicon cask, Intel cask (a link from /usr/local/bin resolves into Caskroom), Linuxbrew
  assert.deepStrictEqual(src('codex', '/opt/homebrew/Caskroom/codex/0.163.0/codex-aarch64-apple-darwin', 'darwin'), { kind: 'brew', prefix: '/opt/homebrew', cask: 'codex' });
  assert.deepStrictEqual(src('codex', '/usr/local/Caskroom/codex/0.163.0/codex', 'darwin'), { kind: 'brew', prefix: '/usr/local', cask: 'codex' });
  assert.deepStrictEqual(src('claude', '/opt/homebrew/Caskroom/claude-code@latest/2.1.309/claude', 'darwin'), { kind: 'brew', prefix: '/opt/homebrew', cask: 'claude-code@latest' });
  assert.deepStrictEqual(src('claude', '/opt/homebrew/Caskroom/claude-code/2.1.308/claude', 'darwin'), { kind: 'brew', prefix: '/opt/homebrew', cask: 'claude-code' });
  assert.deepStrictEqual(src('copilot', '/home/linuxbrew/.linuxbrew/Caskroom/copilot-cli/1.0.103/copilot', 'linux'), { kind: 'brew', prefix: '/home/linuxbrew/.linuxbrew', cask: 'copilot-cli' });
  // a symlinked /usr/local/bin on an Intel Mac that is not (yet) resolved into Caskroom is NOT Homebrew (the real path is required)
  assert.deepStrictEqual(src('codex', '/usr/local/bin/codex', 'darwin'), { kind: 'outside' });
  assert.deepStrictEqual(src('codex', '/usr/local/Cellar/codex/0.163.0/bin/codex', 'darwin'), { kind: 'outside', hint: 'formula' }, 'a formula copy is named, not updated with cask commands');
  // look-alikes and hostile cask names are not Homebrew
  assert.strictEqual(src('codex', '/opt/homebrew-evil/Caskroom/codex/1.0.0/codex', 'darwin').kind, 'outside');
  assert.strictEqual(src('codex', '/tmp/x/Caskroom/codex/1.0.0/codex', 'darwin').kind, 'outside');
  assert.strictEqual(src('codex', '/opt/homebrew/Caskroom/codex;rm -rf/1.0.0/codex', 'darwin').kind, 'outside');
  assert.strictEqual(src('codex', '/opt/homebrew/Caskroom/claude-code/1.0.0/codex', 'darwin').kind, 'outside', 'a cask of another app');
  // npm: the npm beside the node_modules folder (version managers keep one per Node.js version)
  assert.deepStrictEqual(src('codex', '/home/u/.nvm/versions/node/v22.3.0/lib/node_modules/@openai/codex/bin/codex.js', 'linux'), { kind: 'npm', npm: '/home/u/.nvm/versions/node/v22.3.0/bin/npm' });
  assert.deepStrictEqual(src('codex', '/usr/local/lib/node_modules/@openai/codex/bin/codex.js', 'linux'), { kind: 'npm', npm: '/usr/local/bin/npm' });
  assert.deepStrictEqual(src('claude', 'C:\\Users\\Me\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js', 'win32', senv({}, 'C:\\Users\\Me')), { kind: 'npm', npm: 'C:\\Users\\Me\\AppData\\Roaming\\npm\\npm.cmd' });
  assert.deepStrictEqual(src('codex', 'C:\\Users\\Me\\AppData\\Roaming\\npm\\codex.cmd', 'win32', senv({}, 'C:\\Users\\Me')), { kind: 'npm', npm: 'C:\\Users\\Me\\AppData\\Roaming\\npm\\npm.cmd' });
  assert.strictEqual(npmOwns('/home/u/.nvm/versions/node/v22.3.0/bin/npm', '/home/u/.nvm/versions/node/v22.3.0/lib/node_modules/@openai/codex/bin/codex.js', 'linux'), true);
  assert.strictEqual(npmOwns('/usr/bin/npm', '/home/u/.nvm/versions/node/v22.3.0/lib/node_modules/@openai/codex/bin/codex.js', 'linux'), false, 'a first npm whose prefix does not hold the copy is not its npm');
  // winget
  assert.deepStrictEqual(src('claude', 'C:\\Users\\Me\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe\\claude.exe', 'win32', senv({}, 'C:\\Users\\Me')), { kind: 'winget', id: 'Anthropic.ClaudeCode' });
  assert.deepStrictEqual(src('copilot', 'C:\\Users\\Me\\AppData\\Local\\Microsoft\\WinGet\\Packages\\GitHub.Copilot_Microsoft.Winget.Source_8wekyb3d8bbwe\\copilot.exe', 'win32', senv({}, 'C:\\Users\\Me')), { kind: 'winget', id: 'GitHub.Copilot' });
  assert.deepStrictEqual(src('codex', 'C:\\Users\\Me\\AppData\\Local\\Microsoft\\WinGet\\Packages\\OpenAI.Codex_x\\codex.exe', 'win32', senv({}, 'C:\\Users\\Me')), { kind: 'outside', hint: 'winget' }, 'Codex has no winget route');
  assert.strictEqual(src('claude', 'C:\\Users\\Me\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Evil.Thing_x\\claude.exe', 'win32', senv({}, 'C:\\Users\\Me')).kind, 'outside', 'a package folder of another id');
  // case: Windows and macOS compare without case, Linux does not
  assert.strictEqual(src('claude', 'c:\\users\\me\\appdata\\local\\microsoft\\winget\\packages\\anthropic.claudecode_x\\claude.exe', 'win32', senv({}, 'C:\\Users\\Me')).kind, 'winget');
  assert.strictEqual(src('codex', '/OPT/HOMEBREW/Caskroom/codex/1.0.0/codex', 'darwin').kind, 'outside', 'a different prefix spelling is no known prefix even on macOS');
  assert.strictEqual(src('codex', '/home/u/.nvm/versions/node/v22/lib/NODE_MODULES/@openai/codex/x', 'linux').kind, 'outside', 'Linux compares with case');
  assert.strictEqual(src('codex', '/home/u/.nvm/versions/node/v22/lib/NODE_MODULES/@openai/codex/x', 'darwin').kind, 'npm');
  // the vendors' own installers
  assert.deepStrictEqual(src('claude', '/home/u/.local/share/claude/versions/2.1.309', 'linux'), { kind: 'official', app: 'claude' });
  assert.deepStrictEqual(src('codex', '/home/u/.codex/packages/standalone/releases/0.163.0-x86_64/codex', 'linux'), { kind: 'official', app: 'codex' });
  assert.deepStrictEqual(src('codex', '/data/codex-home/packages/standalone/releases/0.163.0/codex', 'linux', senv({ CODEX_HOME: '/data/codex-home' })), { kind: 'official', app: 'codex' });
  assert.deepStrictEqual(src('copilot', '/home/u/.copilot/pkg/universal/1.0.103/copilot', 'linux'), { kind: 'official', app: 'copilot' });
  assert.deepStrictEqual(src('codex', 'C:\\Users\\Me\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe', 'win32', senv({}, 'C:\\Users\\Me')), { kind: 'official', app: 'codex' });
  // outside
  assert.deepStrictEqual(src('claude', '/usr/bin/claude', 'linux'), { kind: 'outside', hint: 'distro' });
  assert.deepStrictEqual(src('claude', '/snap/claude/12/bin/claude', 'linux'), { kind: 'outside', hint: 'snap' });
  assert.deepStrictEqual(src('claude', 'C:\\Users\\Me\\scoop\\apps\\claude\\current\\claude.exe', 'win32', senv({}, 'C:\\Users\\Me')), { kind: 'outside', hint: 'scoop' });
  assert.deepStrictEqual(src('claude', '/srv/tools/claude', 'linux'), { kind: 'outside' });
  // hostile and long paths: relative, empty, a very long one
  for (const p of ['', 'claude', './claude', '../../node_modules/x', '/'.repeat(5000), '/a/'.repeat(2000) + 'node_modules/x']) assert.strictEqual(src('claude', p, 'linux').kind, 'outside', p.slice(0, 20));
}

// ---------------------------------------------------------------------------------------------------------------------
// FR-009, T020: the official Codex CLI, written once
{
  const base = { platform: 'linux', env: senv(), label: 'codex-cli', trusted: true, regular: true };
  const root = '/home/u/.codex/packages/standalone/releases';
  const ok = (over: Record<string, unknown> & { realPath?: string }) => isOfficialCodex({ realPath: `${root}/0.163.0-x/codex`, ...base, ...over } as never);
  assert.strictEqual(ok({}), true);
  assert.strictEqual(ok({ realPath: `${root}x/0.163.0/codex` }), false, 'a look-alike folder without a separator at the boundary');
  assert.strictEqual(ok({ realPath: '/home/u/.codex/packages/standalone/codex' }), false, 'not under releases/');
  assert.strictEqual(ok({ realPath: `${root}/../../../../evil/codex` }), false, 'a path with .. is refused');
  assert.strictEqual(ok({ realPath: '/home/u/.codex/packages/standalone/releases' }), false, 'the root itself');
  assert.strictEqual(ok({ realPath: '/home/u/.nvm/lib/node_modules/@openai/codex/bin/codex.js' }), false, 'an npm copy goes to npm, never codex update');
  assert.strictEqual(ok({ realPath: '/opt/homebrew/Caskroom/codex/0.163.0/codex' }), false, 'a Homebrew copy goes to brew');
  assert.strictEqual(ok({ env: senv({ CODEX_HOME: 'relative/codex' }) }), false, 'a relative CODEX_HOME');
  assert.strictEqual(ok({ env: senv({ CODEX_HOME: '/data/ch' }), realPath: '/data/ch/packages/standalone/releases/1.0.0/codex' }), true);
  assert.strictEqual(ok({ env: senv({ CODEX_HOME: '/data/ch' }) }), false, 'CODEX_HOME moves the root');
  assert.strictEqual(ok({ trusted: false }), false, 'a world-writable folder');
  assert.strictEqual(ok({ regular: false }), false);
  assert.strictEqual(ok({ label: undefined }), false, 'a missing codex-cli label');
  assert.strictEqual(ok({ label: 'codex' }), false);
  assert.strictEqual(ok({ label: 'my-codex-fork' }), false);
  // macOS and Windows: the same layout on every OS, compared without case
  assert.strictEqual(isOfficialCodex({ realPath: '/Users/u/.codex/packages/standalone/releases/0.163.0/codex', platform: 'darwin', env: senv({}, '/Users/u'), label: 'codex-cli', trusted: true, regular: true }), true);
  assert.strictEqual(isOfficialCodex({ realPath: '/Users/u/.CODEX/Packages/Standalone/Releases/0.163.0/codex', platform: 'darwin', env: senv({}, '/Users/u'), label: 'codex-cli', trusted: true, regular: true }), true, 'macOS: no case');
  const win = (p: string, env = senv({}, 'C:\\Users\\Me')) => isOfficialCodex({ realPath: p, platform: 'win32', env, label: 'codex-cli', trusted: true, regular: true });
  assert.strictEqual(win('C:\\Users\\Me\\.codex\\packages\\standalone\\releases\\0.163.0\\codex.exe'), true);
  assert.strictEqual(win('c:\\users\\me\\.CODEX\\Packages\\Standalone\\Releases\\0.163.0\\codex.exe'), true, 'Windows: no case');
  assert.strictEqual(win('C:\\Users\\Me\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe'), false, 'the install.ps1 folder is not the standalone layout: it goes to the checked 060 route');
  assert.strictEqual(win('D:\\Users\\Me\\.codex\\packages\\standalone\\releases\\1\\codex.exe'), false);
  // Linux compares with case
  assert.strictEqual(ok({ realPath: '/home/u/.codex/Packages/standalone/releases/1/codex' }), false);
  // the label comes from the first word of `codex --version`
  assert.strictEqual(versionLabel('codex-cli 0.163.0\n'), 'codex-cli');
  assert.strictEqual(versionLabel('codex 0.163.0'), 'codex');
  assert.strictEqual(versionLabel('Error: something 1.2.3'), undefined);
  assert.strictEqual(versionLabel('x'.repeat(5000)), undefined);
  assert.ok(CODEX_UPDATE_COMMAND.posix.includes('CODEX_NON_INTERACTIVE=1 sh') && CODEX_UPDATE_COMMAND.win32.includes('-ExecutionPolicy Bypass') && CODEX_UPDATE_COMMAND.win32.includes('irm https://chatgpt.com/codex/install.ps1 | iex'));
}

// ---------------------------------------------------------------------------------------------------------------------
// FR-009: the codex update child's environment
{
  const base = { PATH: '/home/u/evil:/usr/bin', HOME: '/home/u', CODEX_MANAGED_BY_NPM: '1', CODEX_MANAGED_BY_PNPM: '1', CODEX_MANAGED_BY_BUN: '1', CODEX_MANAGED_BY_VITE_PLUS: '1', CODEX_HOME: '/data/ch' };
  const e = codexUpdateEnv(base, 'linux');
  for (const k of Object.keys(e)) assert.ok(!k.startsWith('CODEX_MANAGED_BY_'), k);
  assert.strictEqual(e.PATH, '/usr/bin:/bin:/usr/sbin:/sbin', 'a fixed PATH, not the user\'s');
  assert.strictEqual(e.HOME, '/home/u');
  assert.strictEqual(e.CODEX_HOME, '/data/ch', 'CODEX_HOME is passed on');
  const w = codexUpdateEnv({ Path: 'C:\\evil', PATH: 'C:\\evil2', SystemRoot: 'C:\\Windows', codex_managed_by_npm: '1' }, 'win32');
  assert.strictEqual(w.Path, 'C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\WindowsPowerShell\\v1.0');
  assert.ok(!('PATH' in w) && !Object.keys(w).some((k) => /managed_by/i.test(k)), 'one PATH spelling, no lower-case managed-by variable');
  assert.ok(codexUpdateEnv({ SystemRoot: 'relative' }, 'win32').Path?.startsWith('C:\\Windows\\System32'), 'SystemRoot is used only when absolute');
}

// ---------------------------------------------------------------------------------------------------------------------
// FR-004, T004: check commands and parsers
{
  assert.deepStrictEqual(npmCheck('codex'), { tool: 'npm', args: ['view', '@openai/codex', 'version', '--json', '--no-update-notifier'], env: { npm_config_update_notifier: 'false' } });
  assert.deepStrictEqual(brewInfoCmd('codex'), { tool: 'brew', args: ['info', '--cask', '--json=v2', 'codex'], env: { HOMEBREW_NO_AUTO_UPDATE: '1' } });
  assert.deepStrictEqual(brewOutdatedCmd('codex', false).args, ['outdated', '--cask', '--json=v2', 'codex']);
  assert.deepStrictEqual(brewOutdatedCmd('copilot-cli', true).args, ['outdated', '--cask', '--json=v2', '--greedy', 'copilot-cli']);
  assert.ok(!wingetCheck('Anthropic.ClaudeCode').args.some((a) => /agreements/.test(a)), 'the background check never accepts source agreements');
  assert.deepStrictEqual(wingetCheck('Anthropic.ClaudeCode').args, ['list', '--id', 'Anthropic.ClaudeCode', '-e', '--upgrade-available', '--source', 'winget']);
  assert.ok(wingetCheck('Anthropic.ClaudeCode', true).args.includes('--accept-source-agreements'), 'an explicit check, after the terms note, may');
  for (const app of ['claude', 'codex', 'copilot'] as const) assert.ok(npmCheck(app).args.includes(PACKAGES[app]));
  // the three packages' answers
  assert.strictEqual(parseNpmView(fx('npm-view-codex')), '0.164.0');
  assert.strictEqual(parseNpmView(fx('npm-view-claude')), '2.1.309');
  assert.strictEqual(parseNpmView(fx('npm-view-copilot')), '1.0.103');
  // hostile output: markup, a prototype key, a JSON object, an array, a huge answer
  for (const bad of ['"<b>1.2.3</b>"', '{"__proto__":{"version":"1.2.3"}}', '{"version":"1.2.3"}', '["1.2.3"]', 'null', '1.2.3', '"1.2.3', '"' + '1'.repeat(70000) + '"']) assert.strictEqual(parseNpmView(bad), undefined, bad.slice(0, 30));
  // brew
  assert.deepStrictEqual(parseBrewInfo(fx('brew-info-codex-outdated'), 'codex'), { latest: '0.164.0', installed: '0.163.0', outdated: true, autoUpdates: false });
  assert.deepStrictEqual(parseBrewInfo(fx('brew-info-codex-current'), 'codex'), { latest: '0.164.0', installed: '0.164.0', outdated: false, autoUpdates: false });
  assert.deepStrictEqual(parseBrewInfo(fx('brew-info-codex-nooutdated'), 'codex'), { latest: '0.164.0', installed: '0.163.0', autoUpdates: false }, 'the ,build suffix is removed and no outdated field is not guessed');
  assert.strictEqual(parseBrewInfo(fx('brew-info-copilot-auto'), 'copilot-cli')?.autoUpdates, true);
  assert.strictEqual(parseBrewInfo(fx('brew-info-codex-outdated'), 'claude-code'), undefined, 'another cask');
  assert.strictEqual(parseBrewInfo('{"casks":[{"token":"codex","version":"<b>"}]}', 'codex'), undefined);
  assert.strictEqual(parseBrewInfo('{"casks":[{"token":"codex","version":"' + '1.0.0,' + 'x'.repeat(70) + '"}]}', 'codex'), undefined, 'the length check is on the whole field before the comma cut');
  assert.deepStrictEqual(parseBrewOutdated(fx('brew-outdated-codex'), 'codex'), { current: '0.164.0' });
  assert.deepStrictEqual(parseBrewOutdated(fx('brew-outdated-copilot-greedy'), 'copilot-cli'), { current: '1.0.103' });
  assert.strictEqual(parseBrewOutdated(fx('brew-outdated-empty'), 'codex'), null);
  assert.strictEqual(parseBrewOutdated('not json', 'codex'), undefined);
  // winget
  assert.deepStrictEqual(parseWingetList(fx('winget-upgrade-available'), 'Anthropic.ClaudeCode'), { kind: 'available', available: '2.1.308', installed: '2.1.300' });
  assert.deepStrictEqual(parseWingetList(fx('winget-none'), 'Anthropic.ClaudeCode'), { kind: 'current' });
  assert.deepStrictEqual(parseWingetList(fx('winget-terms'), 'Anthropic.ClaudeCode'), { kind: 'terms' });
  assert.strictEqual(parseWingetList(fx('winget-upgrade-available'), 'GitHub.Copilot').kind, 'unknown', 'another id');
  assert.strictEqual(parseWingetList('garbage', 'GitHub.Copilot').kind, 'unknown');
  // the Copilot CLI's own files (never `copilot --version`)
  assert.strictEqual(versionFromPackageJson(fx('copilot-package-json')), '1.0.100');
  assert.strictEqual(versionFromPackageJson('{"version":"<x>"}'), undefined);
  assert.strictEqual(versionFromPackageJson('{"__proto__":{"version":"1.0.0"}}'), undefined);
  assert.strictEqual(versionFromCaskroom('/opt/homebrew/Caskroom/copilot-cli/1.0.103/copilot'), '1.0.103');
  assert.strictEqual(copilotVersionFromPath('/home/u/.copilot/pkg/universal/1.0.103/copilot', 'linux', senv()), '1.0.103');
  assert.strictEqual(copilotVersionFromPath('/home/u/.copilot/pkg/1.0.103/index.js', 'linux', senv()), '1.0.103');
  assert.strictEqual(copilotVersionFromPath('/home/u/.copilot/pkgx/1.0.103/copilot', 'linux', senv()), undefined);
  assert.strictEqual(copilotVersionFromPath('C:\\Users\\Me\\.copilot\\pkg\\universal\\1.0.103\\copilot.exe', 'win32', senv({}, 'C:\\Users\\Me')), '1.0.103');
  assert.strictEqual(versionFromWingetPath('C:\\Users\\Me\\AppData\\Local\\Microsoft\\WinGet\\Packages\\GitHub.Copilot_1.0.103\\copilot.exe'), '1.0.103');
  assert.strictEqual(CASKS.claude.length, 2);
}

// ---------------------------------------------------------------------------------------------------------------------
// FR-014, T005: failure classes (each fixture shows its own message)
{
  const c = (name: string, extra: Record<string, unknown> = {}) => classifyFailure({ text: fx(name), platform: 'linux', code: 1, ...extra });
  assert.strictEqual(c('npm-eacces'), 'admin');
  assert.strictEqual(c('npm-eacces', { errorCode: 'EACCES', text: '' }), 'admin');
  assert.strictEqual(c('win-ebusy', { platform: 'win32' }), 'in-use');
  assert.strictEqual(classifyFailure({ platform: 'win32', code: 1, text: 'The process cannot access the file because it is being used by another process.' }), 'in-use');
  assert.strictEqual(classifyFailure({ platform: 'win32', code: 1, text: "EPERM: operation not permitted, unlink 'C:\\x\\codex.exe'" }), 'in-use', 'the Windows EPERM on the binary');
  assert.strictEqual(c('win-uac-cancelled', { platform: 'win32', code: 1223 }), 'uac-cancelled');
  assert.strictEqual(c('claude-update-disabled'), 'managed');
  assert.strictEqual(classifyFailure({ platform: 'win32', code: 1, text: 'This operation is disabled by Group Policy' }), 'managed');
  assert.strictEqual(c('claude-update-uptodate', { code: 0 }), 'vendor-up-to-date', '"up to date" is its own non-error result');
  assert.notStrictEqual(c('claude-update-uptodate', { code: 0 }), 'managed', 'claude update saying up to date is not Managed');
  assert.strictEqual(c('network-enotfound'), 'network');
  assert.strictEqual(classifyFailure({ platform: 'linux', code: null, text: '', timedOut: true }), 'network');
  assert.strictEqual(classifyFailure({ platform: 'linux', code: 2, text: 'segfault' }), 'other');
  assert.strictEqual(classifyFailure({ platform: 'linux', code: 1, text: 'Some tool: the update is now managed' }), 'other', '"managed" alone is not a vendor message');
  // the Codex fallback: unknown subcommand, no install method, another failing exit; never for in-use, managed, a cancel or a timeout
  const fb = (name: string, extra: Record<string, unknown> = {}) => codexNeedsFallback({ ok: false, cls: c(name), ...extra });
  assert.strictEqual(fb('codex-unknown-subcommand'), true);
  assert.strictEqual(fb('codex-no-method'), true);
  assert.strictEqual(codexNeedsFallback({ ok: false, cls: 'other' }), true);
  assert.strictEqual(codexNeedsFallback({ ok: false, cls: 'in-use' }), false);
  assert.strictEqual(codexNeedsFallback({ ok: false, cls: 'managed' }), false);
  assert.strictEqual(codexNeedsFallback({ ok: false, cls: 'other', reason: 'cancelled' }), false);
  assert.strictEqual(codexNeedsFallback({ ok: false, cls: 'other', reason: 'timeout' }), false);
  assert.strictEqual(codexNeedsFallback({ ok: true, cls: 'other' }), false);
}

// ---------------------------------------------------------------------------------------------------------------------
// FR-026, T006: the lookups through net.request, modelled as an event emitter
class FakeRes extends EventEmitter {
  constructor(public statusCode: number, public headers: Record<string, string> = {}) { super(); }
}
class FakeReq extends EventEmitter {
  headers: Record<string, string> = {};
  ended = false;
  aborted = false;
  followed = false;
  constructor(public opts: NetRequestOptions, private script: (r: FakeReq) => void) { super(); }
  setHeader(k: string, v: string): void { this.headers[k] = v; }
  end(): void { this.ended = true; setImmediate(() => this.script(this)); }
  abort(): void { this.aborted = true; }
  followRedirect(): void { this.followed = true; }
}
function netWith(script: (r: FakeReq) => void): { factory: NetRequestFactory; reqs: FakeReq[] } {
  const reqs: FakeReq[] = [];
  return { reqs, factory: (o) => { const r = new FakeReq(o, script); reqs.push(r); return r as unknown as NetRequestLike; } };
}
const redirectTo = (status: number, url: string) => (r: FakeReq) => { r.emit('redirect', status, 'GET', url); };
const bodyOf = (text: string | Buffer, status = 200) => (r: FakeReq) => { const res = new FakeRes(status); r.emit('response', res); setImmediate(() => { res.emit('data', Buffer.from(text)); res.emit('end'); }); };

(async () => {
  // the allow-list: exact host and path
  for (const u of ['https://github.com/openai/codex/releases/latest', 'https://github.com/github/copilot-cli/releases/latest', 'https://downloads.claude.ai/claude-code-releases/stable', 'https://downloads.claude.ai/claude-code-releases/latest']) assert.ok(lookupAllowed(u), u);
  for (const u of ['https://github.com.evil.example/openai/codex/releases/latest', 'https://evilgithub.com/openai/codex/releases/latest', 'http://github.com/openai/codex/releases/latest', 'https://github.com/openai/codex/releases', 'https://github.com/openai/codex/releases/latest/', 'https://github.com/openai/codex/releases/latest?x=1', 'https://github.com/openai/other/releases/latest', 'https://downloads.claude.ai/claude-code-releases/other', 'https://downloads.claude.ai:8443/claude-code-releases/stable', 'https://user@github.com/openai/codex/releases/latest']) assert.ok(!lookupAllowed(u), u);
  {
    // an off-list URL is refused before any request is made
    const n = netWith(redirectTo(302, location('github-location-codex')));
    const get = makeLookupGet(n.factory);
    for (const u of ['https://github.com.evil.example/openai/codex/releases/latest', 'https://github.com/openai/codex/releases/latest/x']) await assert.rejects(get(u, { method: 'HEAD', maxBytes: 0, timeoutMs: 1000 }), /not allowed/);
    assert.strictEqual(n.reqs.length, 0, 'no request for an off-list address');
  }
  for (const [app, fix, want] of [['codex', 'github-location-codex', '0.164.0'], ['copilot', 'github-location-copilot', '1.0.103']] as const) {
    const n = netWith(redirectTo(302, location(fix)));
    const got = await lookupLatest(app, makeLookupGet(n.factory));
    assert.deepStrictEqual(got, { latest: want });
    const r = n.reqs[0];
    assert.deepStrictEqual([r.opts.method, r.opts.redirect, r.opts.credentials, r.opts.useSessionCookies], ['HEAD', 'manual', 'omit', false]);
    assert.deepStrictEqual(r.headers, { 'User-Agent': 'AgentDurbar', 'Accept': '*/*', 'Accept-Language': 'en' }, 'FR-017: fixed headers; Accept-Language fixed, never the user\'s locale');
    assert.strictEqual(r.followed, false, 'the redirect is read from the event, never followed');
    assert.strictEqual(r.aborted, true, 'and the request is aborted, so no body is fetched');
  }
  {
    // the Location must be exactly the tag of that repository
    for (const bad of ['https://evil.example/openai/codex/releases/tag/rust-v0.164.0', 'https://github.com/openai/other/releases/tag/rust-v0.164.0', 'https://github.com/openai/codex/releases/tag/rust-v0.164.0/../x', 'https://github.com/openai/codex/releases/tag/rust-v0.164.0?x', 'https://github.com/openai/codex/releases/tag/rust-v<b>', 'https://github.com/openai/codex/releases/tag/v0.164.0', 'http://github.com/openai/codex/releases/tag/rust-v0.164.0', 'https://github.com/openai/codex/releases/tag/rust-v' + '1'.repeat(70)]) {
      await assert.rejects(lookupLatest('codex', makeLookupGet(netWith(redirectTo(302, bad)).factory)), /unexpected answer/, bad.slice(0, 80));
    }
    await assert.rejects(lookupLatest('codex', makeLookupGet(netWith(redirectTo(200, location('github-location-codex'))).factory)), /unexpected answer/, 'only 301, 302, 303, 307, 308');
    // a response with no redirect (a 200) is "could not check"
    const n = netWith((r) => { const res = new FakeRes(200); r.emit('response', res); });
    await assert.rejects(lookupLatest('codex', makeLookupGet(n.factory)), /unexpected answer/);
    // the realistic-size body (about 570 KB) is never read: no data listener is attached, and the request is aborted
    const big = Buffer.alloc(570 * 1024, 'x');
    const res = new FakeRes(200);
    const n2 = netWith((r) => { r.emit('response', res); res.emit('data', big); });
    await assert.rejects(lookupLatest('codex', makeLookupGet(n2.factory)));
    assert.strictEqual(res.listenerCount('data'), 0, 'the body is never read');
    assert.strictEqual(n2.reqs[0].aborted, true);
  }
  {
    // Claude: both channels, a body of at most 64 bytes
    const n = netWith((r) => bodyOf(r.opts.url.endsWith('/stable') ? fx('claude-channel-stable') : fx('claude-channel-latest') + '\n')(r));
    assert.deepStrictEqual(await lookupLatest('claude', makeLookupGet(n.factory)), { latest: '2.1.309', stable: '2.1.308' });
    assert.deepStrictEqual(n.reqs.map((r) => r.opts.method), ['GET', 'GET']);
    await assert.rejects(lookupLatest('claude', makeLookupGet(netWith(bodyOf('1'.repeat(65))).factory)), /unexpected answer/, 'an oversized body is refused, not cut');
    await assert.rejects(lookupLatest('claude', makeLookupGet(netWith(bodyOf('<html>no</html>')).factory)), /unexpected answer/);
    await assert.rejects(lookupLatest('claude', makeLookupGet(netWith(bodyOf('2.1.308', 404)).factory)), /unexpected answer/);
    await assert.rejects(lookupLatest('claude', makeLookupGet(netWith(redirectTo(302, 'https://evil.example/x')).factory)), /unexpected answer/, 'a channel that redirects is not an answer');
    // the time limit aborts
    const slow = netWith(() => undefined);
    await assert.rejects(makeLookupGet(slow.factory)(LOOKUPS.claude[0].url, { method: 'GET', maxBytes: 64, timeoutMs: 20 }), /timed out/);
    assert.strictEqual(slow.reqs[0].aborted, true);
    // an error event rejects
    await assert.rejects(makeLookupGet(netWith((r) => r.emit('error', new Error('net::ERR_NAME_NOT_RESOLVED'))).factory)(LOOKUPS.claude[0].url, { method: 'GET', maxBytes: 64, timeoutMs: 1000 }), /ERR_NAME/);
  }
  {
    // T024: the installer download through net.request: a redirect is reported, not followed, so the caller checks the next hop first
    const n = netWith(redirectTo(302, 'https://releases.openai.com/x/install.sh'));
    const get = makeDownloadGet(n.factory);
    const r = await get('https://chatgpt.com/codex/install.sh', { timeoutMs: 1000, maxBytes: 1024 });
    assert.deepStrictEqual([r.status, r.location, r.body.length], [302, 'https://releases.openai.com/x/install.sh', 0]);
    assert.strictEqual(n.reqs[0].followed, false);
    assert.strictEqual(n.reqs.length, 1, 'one request per hop');
    const ok = await makeDownloadGet(netWith(bodyOf('#!/bin/sh\necho hi\n')).factory)('https://chatgpt.com/codex/install.sh', { timeoutMs: 1000, maxBytes: 1024 });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.body.toString(), '#!/bin/sh\necho hi\n');
    await assert.rejects(makeDownloadGet(netWith(bodyOf(Buffer.alloc(2048))).factory)('https://chatgpt.com/codex/install.sh', { timeoutMs: 1000, maxBytes: 1024 }), /larger than expected/);
    await assert.rejects(makeDownloadGet(netWith(() => undefined).factory)('https://chatgpt.com/codex/install.sh', { timeoutMs: 20, maxBytes: 1024 }), /too long/);
  }

  // -------------------------------------------------------------------------------------------------------------------
  // T010, T011: the checker with fake tools and a fake network
  type Call = { file: string; args: string[]; env?: Record<string, string> };
  function checkerWith(o: {
    platform?: NodeJS.Platform;
    real: Partial<Record<SetupKind, string>>;
    copies: Partial<Record<SetupKind, { state: string; version?: string }>>;
    tools?: Record<string, string>;
    answers?: (c: Call) => ExecResult;
    lookup?: LookupGet;
    policy?: UpdatePolicy;
    userSwitch?: boolean;
    simulator?: boolean;
    settingsVisible?: boolean;
    announced?: Record<string, string>;
    texts?: Record<string, string>;
  }) {
    const calls: Call[] = [];
    const lookups: string[] = [];
    const emitted: UpdatesView[] = [];
    const saved: Array<[string, string]> = [];
    const files = new Set(Object.values(o.tools ?? {}));
    const platform = o.platform ?? 'darwin';
    const detectEnv: DetectEnv = { platform, env: {}, homedir: HOME, isFile: (p) => files.has(p) };
    const deferred: Array<() => void> = [];
    const deps: CheckerDeps = {
      detectEnv,
      trustedPath: () => true,
      exec: async (file, args, opts) => { const c = { file, args: [...args], ...(opts.env ? { env: { ...opts.env } } : {}) }; calls.push(c); return o.answers ? o.answers(c) : { code: 0, stdout: '', stderr: '' }; },
      lookup: o.lookup ?? (async (url, opts) => { lookups.push(url + ' ' + opts.method); throw new Error('no network in this test'); }),
      copies: async () => o.copies,
      locate: (app) => o.real[app],
      findTool: (n) => o.tools?.[n],
      readText: (f) => o.texts?.[f],
      policy: () => o.policy ?? { state: 'none' },
      userSwitch: () => o.userSwitch ?? true,
      simulator: o.simulator ?? false,
      wall: () => 1_700_000_000_000,
      announced: () => o.announced ?? {},
      saveAnnounced: (a, v) => { saved.push([a, v]); },
      settingsVisible: () => o.settingsVisible ?? false,
      emit: (v) => emitted.push(v),
      defer: (fn) => deferred.push(fn),
    };
    const checker = new UpdateChecker(deps);
    return { checker, calls, lookups, emitted, saved, deferred, run: async () => { for (const d of deferred.splice(0)) d(); await (checker as unknown as { all?: Promise<void> }).all; } };
  }
  const brewReal = '/opt/homebrew/Caskroom/codex/0.163.0/codex-aarch64-apple-darwin';
  const brewTools = { brew: '/opt/homebrew/bin/brew' };
  {
    // Codex from the Homebrew cask: one `brew info`, no second run when `outdated` is there, HOMEBREW_NO_AUTO_UPDATE for that child only
    const t = checkerWith({ real: { codex: brewReal }, copies: { codex: { state: 'too-old', version: '0.163.0' } }, tools: brewTools, answers: () => ({ code: 0, stdout: fx('brew-info-codex-outdated'), stderr: '' }) });
    await t.checker.checkAll();
    assert.strictEqual(t.calls.length, 1);
    assert.deepStrictEqual(t.calls[0], { file: '/opt/homebrew/bin/brew', args: ['info', '--cask', '--json=v2', 'codex'], env: { HOMEBREW_NO_AUTO_UPDATE: '1' } });
    const r = t.checker.result('codex') as CheckResult;
    assert.deepStrictEqual([r.state, r.installed, r.latest, r.asHomebrew, r.source], ['update-available', '0.163.0', '0.164.0', true, 'Homebrew']);
    assert.strictEqual(r.checkedAt, 1_700_000_000_000);
    assert.strictEqual(t.checker.checkedVersion('codex'), '0.164.0');
    assert.strictEqual(t.checker.result('claude'), undefined, 'not installed: no result, no call');
    // the kept result is returned, a second `view` runs nothing
    t.checker.view(); t.checker.view();
    assert.strictEqual(t.calls.length, 1);
  }
  {
    // no `outdated` in the first answer: a second run (at most two for brew), without --greedy
    const t = checkerWith({ real: { codex: brewReal }, copies: { codex: { state: 'ready', version: '0.163.0' } }, tools: brewTools, answers: (c) => ({ code: 0, stdout: c.args[0] === 'info' ? fx('brew-info-codex-nooutdated') : fx('brew-outdated-codex'), stderr: '' }) });
    await t.checker.checkAll();
    assert.deepStrictEqual(t.calls.map((c) => c.args.join(' ')), ['info --cask --json=v2 codex', 'outdated --cask --json=v2 codex']);
    assert.strictEqual(t.checker.result('codex')?.state, 'update-available');
    // a self-updating cask is asked with --greedy
    const g = checkerWith({ real: { copilot: '/opt/homebrew/Caskroom/copilot-cli/1.0.100/copilot' }, copies: {}, tools: brewTools, answers: (c) => ({ code: 0, stdout: c.args[0] === 'info' ? fx('brew-info-copilot-auto') : fx('brew-outdated-copilot-greedy'), stderr: '' }) });
    await g.checker.checkAll();
    assert.deepStrictEqual(g.calls.map((c) => c.args.join(' ')), ['info --cask --json=v2 copilot-cli', 'outdated --cask --json=v2 --greedy copilot-cli']);
    assert.deepStrictEqual([g.checker.result('copilot')?.installed, g.checker.result('copilot')?.latest, g.checker.result('copilot')?.state], ['1.0.100', '1.0.103', 'update-available'], 'the Copilot CLI version comes from the Caskroom folder, never from running copilot');
    assert.ok(!g.calls.some((c) => /copilot$/.test(c.file)), 'copilot is never run');
    // up to date
    const u = checkerWith({ real: { codex: brewReal }, copies: { codex: { state: 'ready', version: '0.164.0' } }, tools: brewTools, answers: () => ({ code: 0, stdout: fx('brew-info-codex-current'), stderr: '' }) });
    await u.checker.checkAll();
    assert.strictEqual(u.checker.result('codex')?.state, 'up-to-date');
    assert.strictEqual(u.checker.checkedVersion('codex'), undefined);
    // Homebrew's data is behind the installed version: no Update (a source behind the installed version)
    const d = checkerWith({ real: { codex: brewReal }, copies: { codex: { state: 'ready', version: '0.165.0' } }, tools: brewTools, answers: () => ({ code: 0, stdout: fx('brew-info-codex-outdated'), stderr: '' }) });
    await d.checker.checkAll();
    assert.strictEqual(d.checker.result('codex')?.state, 'up-to-date');
    assert.strictEqual(d.checker.result('codex')?.installedNewer, true);
  }
  {
    // npm: the npm that owns the copy, update notifier off for that child only
    const real = '/home/u/.nvm/versions/node/v22.3.0/lib/node_modules/@openai/codex/bin/codex.js';
    const npm = '/home/u/.nvm/versions/node/v22.3.0/bin/npm';
    const t = checkerWith({ platform: 'linux', real: { codex: real }, copies: { codex: { state: 'ready', version: '0.163.0' } }, tools: { npm: '/usr/bin/npm', [`x`]: npm }, answers: () => ({ code: 0, stdout: fx('npm-view-codex'), stderr: '' }) });
    await t.checker.checkAll();
    assert.deepStrictEqual(t.calls.map((c) => [c.file, c.args.join(' '), c.env]), [[npm, 'view @openai/codex version --json --no-update-notifier', { npm_config_update_notifier: 'false', PATH: '/home/u/.nvm/versions/node/v22.3.0/bin' }]], 'FR-042: the npm folder is first on the child PATH, so npm\'s `env node` finds the node beside it');
    assert.strictEqual(t.checker.result('codex')?.state, 'update-available');
    // npm's error line is not a version
    const e = checkerWith({ platform: 'linux', real: { codex: real }, copies: { codex: { state: 'ready', version: '0.163.0' } }, tools: { x: npm }, answers: () => ({ code: 0, stdout: fx('npm-error-node'), stderr: '' }) });
    await e.checker.checkAll();
    assert.deepStrictEqual([e.checker.result('codex')?.state, e.checker.result('codex')?.reason], ['could-not-check', 'unexpected answer']);
    // an npm failure becomes a short reason, never the raw output
    const f = checkerWith({ platform: 'linux', real: { codex: real }, copies: { codex: { state: 'ready', version: '0.163.0' } }, tools: { x: npm }, answers: () => ({ code: 1, stdout: '', stderr: fx('network-enotfound') }) });
    await f.checker.checkAll();
    assert.strictEqual(f.checker.result('codex')?.reason, 'network problem');
    // no npm for this copy
    const m = checkerWith({ platform: 'linux', real: { codex: real }, copies: { codex: { state: 'ready', version: '0.163.0' } }, tools: { npm: '/usr/bin/npm' }, answers: () => ({ code: 0, stdout: fx('npm-view-codex'), stderr: '' }) });
    await m.checker.checkAll();
    assert.match(m.checker.result('codex')?.reason ?? '', /npm for this copy was not found/);
    assert.strictEqual(m.calls.length, 0);
    // the Copilot CLI from npm: version from its package.json
    const cp = '/home/u/.nvm/versions/node/v22.3.0/lib/node_modules/@github/copilot/index.js';
    const pj = '/home/u/.nvm/versions/node/v22.3.0/lib/node_modules/@github/copilot/package.json';
    const c = checkerWith({ platform: 'linux', real: { copilot: cp }, copies: {}, tools: { x: npm }, texts: { [pj]: fx('copilot-package-json') }, answers: () => ({ code: 0, stdout: fx('npm-view-copilot'), stderr: '' }) });
    await c.checker.checkAll();
    assert.deepStrictEqual([c.checker.result('copilot')?.installed, c.checker.result('copilot')?.latest, c.checker.result('copilot')?.state], ['1.0.100', '1.0.103', 'update-available']);    // review on #721: the package.json path is joined in the TARGET platform's flavour (a Windows copy read on any host, and the reverse)
    const wcp = 'C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\@github\\copilot\\index.js';
    const wpj = 'C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\@github\\copilot\\package.json';
    const wnpm = 'C:\\Users\\u\\AppData\\Roaming\\npm\\npm.cmd';
    const wc = checkerWith({ platform: 'win32', real: { copilot: wcp }, copies: {}, tools: { x: wnpm }, texts: { [wpj]: fx('copilot-package-json') }, answers: () => ({ code: 0, stdout: fx('npm-view-copilot'), stderr: '' }) });
    await wc.checker.checkAll();
    assert.strictEqual(wc.checker.result('copilot')?.installed, '1.0.100', 'win32 flavour: ' + JSON.stringify(wc.checker.result('copilot')));
  }
  {
    // winget: no agreement flags in the background; the terms answer is a card message
    const wreal = 'C:\\Users\\Me\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Anthropic.ClaudeCode_x\\claude.exe';
    const mk = (out: string, extra: Partial<Parameters<typeof checkerWith>[0]> = {}) => checkerWith({ platform: 'win32', real: { claude: wreal }, copies: { claude: { state: 'ready', version: '2.1.300' } }, tools: { winget: 'C:\\w\\winget.exe' }, answers: () => ({ code: 0, stdout: out, stderr: '' }), ...extra });
    const a = mk(fx('winget-upgrade-available'));
    await a.checker.checkAll();
    assert.deepStrictEqual(a.calls[0].args, ['list', '--id', 'Anthropic.ClaudeCode', '-e', '--upgrade-available', '--source', 'winget']);
    assert.strictEqual(a.checker.result('claude')?.latest, '2.1.308');
    const tm = mk(fx('winget-terms'));
    await tm.checker.checkAll();
    assert.deepStrictEqual([tm.checker.result('claude')?.state, tm.checker.result('claude')?.reason], ['could-not-check', 'winget needs its terms accepted']);
    await tm.checker.checkApp('claude', { acceptTerms: true });
    assert.ok(tm.calls[tm.calls.length - 1].args.includes('--accept-source-agreements'), 'only an explicit check after the note carries the flag');
    const n = mk(fx('winget-none'));
    await n.checker.checkAll();
    assert.strictEqual(n.checker.result('claude')?.state, 'up-to-date');
  }
  {
    // official installer copies: the lookups, never the app itself
    const cl = checkerWith({ platform: 'linux', real: { claude: '/home/u/.local/share/claude/versions/2.1.300', codex: '/home/u/.codex/packages/standalone/releases/0.163.0/codex' }, copies: { claude: { state: 'ready', version: '2.1.300' }, codex: { state: 'ready', version: '0.163.0' } },
      lookup: async (url, opts) => { cl.lookups.push(url + ' ' + opts.method); return url.includes('claude') ? { kind: 'body', status: 200, text: url.endsWith('stable') ? '2.1.308' : '2.1.309' } : { kind: 'redirect', status: 302, url: location('github-location-codex') }; } });
    await cl.checker.checkAll();
    assert.strictEqual(cl.calls.length, 0, 'no process runs for an official-installer copy');
    assert.deepStrictEqual(cl.lookups, ['https://downloads.claude.ai/claude-code-releases/stable GET', 'https://downloads.claude.ai/claude-code-releases/latest GET', 'https://github.com/openai/codex/releases/latest HEAD']);
    const r = cl.checker.result('claude') as CheckResult;
    assert.deepStrictEqual([r.state, r.stable, r.latest, r.newerOnLatest], ['update-available', '2.1.308', '2.1.309', undefined], 'below stable');
    assert.strictEqual(cl.checker.checkedVersion('claude'), '2.1.308', 'stable is what an update installs');
    // between stable and latest: a quiet note and no update
    // review on #721: offline (Chromium's net::ERR_*) is a network problem on the card, not "unexpected answer"
    for (const msg of ['net::ERR_INTERNET_DISCONNECTED', 'net::ERR_NAME_NOT_RESOLVED', 'net::ERR_PROXY_CONNECTION_FAILED', 'getaddrinfo ENOTFOUND downloads.claude.ai']) {
      const off = checkerWith({ platform: 'linux', real: { claude: '/home/u/.local/share/claude/versions/2.1.308' }, copies: { claude: { state: 'ready', version: '2.1.308' } }, lookup: async () => { throw new Error(msg); } });
      await off.checker.checkAll();
      assert.deepStrictEqual([off.checker.result('claude')?.state, off.checker.result('claude')?.reason], ['could-not-check', 'network problem'], msg);
    }
    const q = checkerWith({ platform: 'linux', real: { claude: '/home/u/.local/share/claude/versions/2.1.308' }, copies: { claude: { state: 'ready', version: '2.1.308' } }, lookup: async (url) => ({ kind: 'body', status: 200, text: url.endsWith('stable') ? '2.1.308' : '2.1.309' }) });
    await q.checker.checkAll();
    assert.deepStrictEqual([q.checker.result('claude')?.state, q.checker.result('claude')?.newerOnLatest], ['up-to-date', '2.1.309']);
    assert.strictEqual(q.emitted.every((v) => !v.announce), true, 'the quiet note has no toast');
    // a copy outside Durbar's routes: no call, no lookup, no update
    const o = checkerWith({ platform: 'linux', real: { claude: '/usr/bin/claude' }, copies: { claude: { state: 'ready', version: '2.1.300' } } });
    await o.checker.checkAll();
    assert.deepStrictEqual([o.checker.result('claude')?.state, o.checker.result('claude')?.hint, o.calls.length, o.lookups.length], ['outside', 'distro', 0, 0]);
    // the lookup fails: could not check, the installed version stays
    const bad = checkerWith({ platform: 'linux', real: { codex: '/home/u/.codex/packages/standalone/releases/0.163.0/codex' }, copies: { codex: { state: 'ready', version: '0.163.0' } } });
    await bad.checker.checkAll();
    assert.deepStrictEqual([bad.checker.result('codex')?.state, bad.checker.result('codex')?.installed], ['could-not-check', '0.163.0']);
  }
  {
    // a manual check during the start check joins it (no doubling); one app at a time
    let active = 0, peak = 0;
    const t = checkerWith({ real: { codex: brewReal }, copies: { codex: { state: 'ready', version: '0.163.0' } }, tools: brewTools });
    t.checker['d'].exec = async (file, args) => { active++; peak = Math.max(peak, active); await new Promise((r) => setImmediate(r)); active--; t.calls.push({ file, args: [...args] }); return { code: 0, stdout: fx('brew-info-codex-outdated'), stderr: '' }; };
    const a = t.checker.checkAll();
    const b = t.checker.checkAll();
    const c = t.checker.checkApp('codex');
    await Promise.all([a, b, c]);
    assert.strictEqual(t.calls.length, 1, 'one run for three asks');
    assert.strictEqual(peak, 1);
    assert.strictEqual(a, b, 'a manual check joins the running one');
  }
  {
    // T011/SC-002: start scheduling counts runner calls
    const mk = (over: Partial<Parameters<typeof checkerWith>[0]>) => checkerWith({ real: { codex: brewReal }, copies: { codex: { state: 'ready', version: '0.163.0' } }, tools: brewTools, answers: () => ({ code: 0, stdout: fx('brew-info-codex-outdated'), stderr: '' }), ...over });
    const count = async (over: Partial<Parameters<typeof checkerWith>[0]>) => { const t = mk(over); const scheduled = t.checker.scheduleStart(); await t.run(); return { scheduled, calls: t.calls.length }; };
    assert.deepStrictEqual(await count({}), { scheduled: true, calls: 1 }, 'one check per installed app per start');
    assert.deepStrictEqual(await count({ userSwitch: false }), { scheduled: false, calls: 0 });
    assert.deepStrictEqual(await count({ simulator: true }), { scheduled: false, calls: 0 });
    for (const policy of [{ state: 'ok', featureAgentAppUpdateCheck: false }, { state: 'ok', updatesMode: 'off' }, { state: 'ok', allowInAppInstall: false }, { state: 'unreadable' }, { state: 'ok', updatesMode: 'someFutureMode' }, { state: 'ok', featureAgentAppUpdateCheck: 'no' }] as UpdatePolicy[]) {
      assert.deepStrictEqual(await count({ policy }), { scheduled: false, calls: 0 }, JSON.stringify(policy));
    }
    assert.deepStrictEqual(await count({ policy: { state: 'ok', updatesMode: 'notify' } }), { scheduled: true, calls: 1 }, 'notify and auto are about Durbar\'s own updater');
    assert.deepStrictEqual(await count({ policy: { state: 'none' } }), { scheduled: true, calls: 1 });
    // opening Settings or starting a session never contacts: view() and result() run nothing; the start check runs once
    const t = mk({});
    assert.strictEqual(t.checker.scheduleStart(), true);
    assert.strictEqual(t.checker.scheduleStart(), false, 'once per start');
    t.checker.view(); t.checker.result('codex');
    assert.strictEqual(t.calls.length, 0, 'nothing runs before the deferred start check');
    await t.run();
    t.checker.view();
    assert.strictEqual(t.calls.length, 1);
    // with the feature hidden by policy, an explicit check contacts nothing either
    const h = mk({ policy: { state: 'ok', updatesMode: 'off' } });
    await h.checker.checkAll(); await h.checker.checkApp('codex');
    assert.strictEqual(h.calls.length, 0);
    // a policy that is only allowInAppInstall: false keeps the explicit, read-only check
    const ro = mk({ policy: { state: 'ok', allowInAppInstall: false } });
    await ro.checker.checkAll();
    assert.strictEqual(ro.calls.length, 1);
    // startCheckAllowed is the one rule
    assert.strictEqual(startCheckAllowed({ simulator: false, userSwitch: true, policy: undefined }), true);
    assert.strictEqual(startCheckAllowed({ simulator: false, userSwitch: true, policy: { state: 'unreadable' } }), false, 'unreadable fails closed');
  }
  {
    // T034: the announce rule: one toast per app and version, saved; none while Settings shows the card, for a failed check or a quiet note
    const mk = (over: Partial<Parameters<typeof checkerWith>[0]> = {}) => checkerWith({ real: { codex: brewReal }, copies: { codex: { state: 'ready', version: '0.163.0' } }, tools: brewTools, answers: () => ({ code: 0, stdout: fx('brew-info-codex-outdated'), stderr: '' }), ...over });
    const a = mk();
    await a.checker.checkAll();
    assert.deepStrictEqual(a.saved, [['codex', '0.164.0']]);
    assert.deepStrictEqual(a.emitted.map((v) => v.announce).filter(Boolean), [{ app: 'codex', version: '0.164.0', name: 'the Codex CLI' }]);
    const same = mk({ announced: { codex: '0.164.0' } });
    await same.checker.checkAll();
    assert.deepStrictEqual([same.saved.length, same.emitted.some((v) => v.announce)], [0, false], 'the same version on the next start: no toast');
    const newer = mk({ announced: { codex: '0.163.5' } });
    await newer.checker.checkAll();
    assert.strictEqual(newer.saved.length, 1, 'a newer one gets its own toast');
    const seen = mk({ settingsVisible: true });
    await seen.checker.checkAll();
    assert.deepStrictEqual([seen.saved, seen.emitted.some((v) => v.announce)], [[['codex', '0.164.0']], false], 'the card is the announcement; the version still counts as announced');
    const failed = mk({ answers: () => ({ code: 1, stdout: '', stderr: 'boom' }) });
    await failed.checker.checkAll();
    assert.strictEqual(failed.saved.length, 0);
    // compare against the announced version, not the installed one (mutation: compare with installed)
    const base: CheckResult = { app: 'codex', state: 'update-available', installed: '0.163.0', latest: '0.164.0', source: 'Homebrew', sourceKind: 'brew' };
    assert.deepStrictEqual(announceRule(base, { codex: '0.164.0' }, false), { toast: false });
    assert.deepStrictEqual(announceRule(base, { codex: '0.165.0' }, false), { toast: false }, 'a lower source version than announced is not news');
    assert.deepStrictEqual(announceRule(base, {}, false), { toast: true, save: '0.164.0' });
    assert.deepStrictEqual(announceRule({ ...base, state: 'up-to-date' }, {}, false), { toast: false });
    assert.deepStrictEqual(announceRule({ ...base, newerOnLatest: '1.0.0' }, {}, false), { toast: false });
  }
  {
    // afterUpdate: the card learns the new version without contacting any source
    const t = checkerWith({ real: { codex: brewReal }, copies: { codex: { state: 'ready', version: '0.163.0' } }, tools: brewTools, answers: () => ({ code: 0, stdout: fx('brew-info-codex-outdated'), stderr: '' }) });
    await t.checker.checkAll();
    const before = t.calls.length;
    const c = (t.checker['d'] as CheckerDeps);
    c.copies = async () => ({ codex: { state: 'ready', version: '0.164.0' } });
    await t.checker.afterUpdate('codex');
    assert.deepStrictEqual([t.checker.result('codex')?.state, t.checker.result('codex')?.installed, t.calls.length], ['up-to-date', '0.164.0', before]);
    c.copies = async () => ({ codex: { state: 'ready', version: '0.163.0' } });
    await t.checker.afterUpdate('codex');
    assert.strictEqual(t.checker.result('codex'), undefined, 'still old: the answer is dropped, not shown stale');
  }
  {
    // FR-042 (the owner's Mac): a GUI app's PATH has no node; npm answers 127 -> an honest message, and the PATH given to npm has its own folder first
    const real = '/home/u/.nvm/versions/node/v22.3.0/lib/node_modules/@github/copilot/index.js';
    const npm = '/home/u/.nvm/versions/node/v22.3.0/bin/npm';
    const mk = (answers: (c: Call) => ExecResult) => checkerWith({ platform: 'darwin', real: { copilot: real }, copies: {}, tools: { npm }, texts: { '/home/u/.nvm/versions/node/v22.3.0/lib/node_modules/@github/copilot/package.json': '{"version":"1.0.98"}' }, answers });
    const noNode = mk((c) => ((c.env?.PATH ?? '').split(':').includes('/home/u/.nvm/versions/node/v22.3.0/bin') ? { code: 0, stdout: '"1.0.103"', stderr: '' } : { code: 127, stdout: '', stderr: 'env: node: No such file or directory' }));
    await noNode.checker.checkApp('copilot');
    assert.strictEqual(noNode.checker.result('copilot')?.state, 'update-available', 'with the npm folder on PATH the check works');
    const lost = mk(() => ({ code: 127, stdout: '', stderr: 'env: node: No such file or directory' }));
    await lost.checker.checkApp('copilot');
    assert.deepStrictEqual([lost.checker.result('copilot')?.state, lost.checker.result('copilot')?.reason], ['could-not-check', 'npm or node was not found'], '127 is never shown as "exit 127"');
    const gone = mk(() => ({ code: null, stdout: '', stderr: '', errorCode: 'ENOENT' }));
    await gone.checker.checkApp('copilot');
    assert.strictEqual(gone.checker.result('copilot')?.reason, 'npm or node was not found');
    const other = mk(() => ({ code: 2, stdout: '', stderr: '' }));
    await other.checker.checkApp('copilot');
    assert.strictEqual(other.checker.result('copilot')?.reason, 'exit 2', 'other codes keep their number');
    // the pure PATH builder: the npm folder first, no duplicates, only absolute folders, the Windows key spelling kept
    assert.deepStrictEqual(pathWithToolDir({ PATH: '/usr/bin:/bin' }, '/opt/homebrew/bin/npm', 'darwin', ['/usr/bin', '/opt/x', 'rel']), { PATH: '/opt/homebrew/bin:/usr/bin:/bin:/opt/x' });
    assert.deepStrictEqual(pathWithToolDir({}, '/a/npm', 'linux'), { PATH: '/a' });
    assert.deepStrictEqual(pathWithToolDir({ Path: 'C:\\Windows;c:\\nodejs' }, 'C:\\Nodejs\\npm.cmd', 'win32'), { Path: 'C:\\Nodejs;C:\\Windows' });
  }
  {
    // FR-042: the folder goes on PATH only when it passes the runner's trust rule (a folder anyone can write could plant its own `node`)
    const real = '/home/u/.nvm/versions/node/v22.3.0/lib/node_modules/@github/copilot/index.js';
    const npm = '/home/u/.nvm/versions/node/v22.3.0/bin/npm';
    const mk = (trusted: boolean) => {
      const t = checkerWith({ platform: 'darwin', real: { copilot: real }, copies: {}, tools: { npm }, texts: { '/home/u/.nvm/versions/node/v22.3.0/lib/node_modules/@github/copilot/package.json': '{"version":"1.0.98"}' }, answers: () => ({ code: 127, stdout: '', stderr: '' }) });
      (t.checker['d'] as CheckerDeps).trustedPath = (p) => { assert.strictEqual(p, npm, 'the npm as found is checked'); return trusted; };
      return t;
    };
    const bad = mk(false);
    await bad.checker.checkApp('copilot');
    assert.strictEqual(bad.calls[0].env?.PATH, undefined, 'untrusted folder: no PATH given');
    assert.strictEqual(bad.checker.result('copilot')?.reason, 'npm or node was not found, and the npm folder is not trusted');
    const good = mk(true);
    await good.checker.checkApp('copilot');
    assert.strictEqual(good.calls[0].env?.PATH, '/home/u/.nvm/versions/node/v22.3.0/bin');
    // the detector wiring: a system path is shown in full in `where`
    assert.strictEqual((withWhere({ state: 'ready', version: '1', hint: '', path: '/opt/homebrew/bin/codex' } as never, { platform: 'darwin', homedir: '/Users/v', env: {}, isFile: () => true }) as { where?: string }).where, '/opt/homebrew/bin/codex');
  }
  {
    // FR-042: "Found at" is a path (a system path in full, ~/ under home, only the name inside another person's folder)
    const e = { platform: 'darwin' as const, homedir: '/Users/vikram' };
    assert.strictEqual(displayWhere('/opt/homebrew/bin/codex', e), '/opt/homebrew/bin/codex');
    assert.strictEqual(displayWhere('/Users/vikram/.nvm/bin/codex', e), '~/.nvm/bin/codex');
    assert.strictEqual(displayWhere('/Users/other/bin/codex', e), 'codex');
    assert.strictEqual(displayWhere('/home/other/bin/codex', { platform: 'linux', homedir: '/home/me' }), 'codex');
    assert.strictEqual(displayWhere('C:\\Program Files\\nodejs\\codex.cmd', { platform: 'win32', homedir: 'C:\\Users\\a' }), 'C:\\Program Files\\nodejs\\codex.cmd');
    assert.strictEqual(displayWhere('C:\\Users\\b\\codex.cmd', { platform: 'win32', homedir: 'C:\\Users\\a' }), 'codex.cmd');
  }
  {
    // the timeout (30 s in the app, injected here) ends a check that never answers
    const t = checkerWith({ real: { codex: brewReal }, copies: { codex: { state: 'ready', version: '0.163.0' } }, tools: brewTools });
    (t.checker['d'] as CheckerDeps).limitMs = 20;
    (t.checker['d'] as CheckerDeps).exec = () => new Promise(() => undefined);
    await t.checker.checkAll();
    assert.deepStrictEqual([t.checker.result('codex')?.state, t.checker.result('codex')?.reason], ['could-not-check', 'timed out']);
  }

  // -------------------------------------------------------------------------------------------------------------------
  // policy, `max` and pinning (FR-022, FR-023)
  {
    assert.deepStrictEqual(policyView(undefined), { checkHidden: false, installBlocked: false, unreadable: false, startAllowed: true });
    assert.strictEqual(policyView({ state: 'ok', allowInAppInstall: false }).installBlocked, true);
    assert.strictEqual(policyView({ state: 'ok', allowInAppInstall: 'false' }).installBlocked, true, 'an unknown value is a lock');
    assert.strictEqual(policyView({ state: 'ok', featureAgentAppUpdateCheck: false }).checkHidden, true);
    assert.strictEqual(policyView({ state: 'ok', updatesMode: 'off' }).checkHidden, true);
    assert.strictEqual(policyView({ state: 'ok', updatesMode: 'auto' }).checkHidden, false);
    assert.strictEqual(policyView({ state: 'unreadable' }).startAllowed, false);
    // pinning: npm and winget only
    assert.deepStrictEqual(updateDecision({ kind: 'npm' }, '0.164.0', undefined), { allowed: true, pinned: true });
    assert.deepStrictEqual(updateDecision({ kind: 'brew', prefix: '/opt/homebrew', cask: 'codex' }, '0.164.0', undefined), { allowed: true, pinned: false });
    assert.strictEqual(updateDecision({ kind: 'brew', prefix: '/opt/homebrew', cask: 'codex' }, '0.164.0', '0.170.0').allowed, false, 'a route that cannot pin is not offered under a max');
    assert.match(updateDecision({ kind: 'brew', prefix: '/opt/homebrew', cask: 'codex' }, '0.164.0', '0.170.0').reason ?? '', /cannot install a chosen version/);
    assert.strictEqual(updateDecision({ kind: 'npm' }, '0.171.0', '0.170.0').allowed, false, 'above the max');
    assert.strictEqual(updateDecision({ kind: 'npm' }, '0.170.0', '0.170.0').allowed, true);
    assert.strictEqual(updateDecision({ kind: 'winget', id: 'GitHub.Copilot' }, undefined, '1.0.0').allowed, false, 'no checked version under a max');
    // after an update (FR-011)
    assert.strictEqual(updateOutcomeNote('Codex', { version: '0.163.0', where: '/opt/homebrew/bin/codex' }, { version: '0.164.0', where: '/opt/homebrew/bin/codex' }, '0.164.0'), undefined);
    assert.match(updateOutcomeNote('Codex', { version: '0.163.0', where: '/usr/local/bin/codex' }, { version: '0.163.0', where: '/usr/local/bin/codex' }, '0.164.0') ?? '', /Updated, but Durbar still finds 0\.163\.0 at \/usr\/local\/bin\/codex/);
    assert.match(updateOutcomeNote('Codex', { version: '0.163.0', where: '/opt/homebrew/bin/codex' }, { version: '0.163.0', where: '/usr/local/bin/codex' }, '0.164.0') ?? '', /updated at \/opt\/homebrew\/bin\/codex, but Durbar now finds 0\.163\.0 at \/usr\/local\/bin\/codex first/);
  }

  // -------------------------------------------------------------------------------------------------------------------
  // FR-013: a scheduled prompt that would start or resume a session of an updating app is held, then sent when the lock is released
  {
    let now = 1_000_000_000_000;
    const sent: string[] = [];
    let held: string | undefined = 'the app is updating';
    const timers: Array<{ at: number; fn: () => void }> = [];
    const sch = new Scheduler({ pausedAll: false, schedules: [] }, {
      now: () => now, isBusy: () => false, hasSession: () => true, capUnitOf: () => 'aiu',
      send: async (_f, p) => { sent.push(p); return 's1'; },
      heldBy: () => held,
      setTimer: (ms, fn) => { const t = { at: now + ms, fn }; timers.push(t); return t; },
      clearTimer: (t) => { const i = timers.indexOf(t as never); if (i >= 0) timers.splice(i, 1); },
      save: () => undefined,
    });
    sch.start();
    const r = sch.save({ folder: '/w', prompt: 'summarise', every: 30 }, () => true);
    assert.ok(r.ok);
    const advance = async (ms: number) => { now += ms; for (;;) { const d = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)[0]; if (!d) return; timers.splice(timers.indexOf(d), 1); d.fn(); await new Promise((x) => setImmediate(x)); } };
    await advance(30 * 60_000);
    assert.deepStrictEqual([sent, sch.doc.schedules[0].last?.outcome, sch.heldFor(() => true)], [[], 'held', 1], 'held, not sent, not failed');
    await advance(HOLD_RETRY_MS);
    assert.deepStrictEqual(sent, [], 'still held at the retry');
    held = undefined;
    sch.releaseHeld();
    await advance(1);
    assert.deepStrictEqual([sent, sch.heldFor(() => true), sch.doc.schedules[0].last?.outcome], [['summarise'], 0, 'sent'], 'sent once the lock is released');
  }

  // -------------------------------------------------------------------------------------------------------------------
  // T030: the update lock and the gate
  {
    type G = { open: number; busy?: number };
    const mk = (init: G) => {
      const st = { ...init, ended: 0, changed: 0, failed: [] as RunReply[], released: 0 };
      const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
      const gate = new UpdateGate({
        count: (): SessionCount => ({ open: st.open, busy: st.busy ?? 0, pendingPermissions: 0, heldPrompts: 0 }),
        endAll: async () => { st.ended++; st.open = 0; },
        setTimer: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
        clearTimer: (t) => { (t as { live: boolean }).live = false; },
        changed: () => { st.changed++; },
        failed: (_k, r) => { st.failed.push(r); },
        released: () => { st.released++; },
      });
      const tick = async () => { const t = timers.filter((x) => x.live).pop(); if (t) { t.live = false; t.fn(); } await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); };
      return { st, gate, tick };
    };
    // no sessions: the lock is taken first, the run goes, the lock stays to the end
    {
      const { gate, st } = mk({ open: 0 });
      let sawLock = false;
      const r = await gate.request('codex', undefined, async () => { sawLock = gate.blocksStart('codex'); return { ok: true }; });
      assert.deepStrictEqual([r.ok, sawLock, gate.blocksStart('codex'), gate.blocksStart('claude')], [true, true, true, false], 'the lock is held before the count and kept until release');
      assert.deepStrictEqual((await gate.request('codex', undefined, async () => ({ ok: true }))).ok, false, 'a second Update… while one holds the lock is refused');
      gate.release('codex');
      assert.deepStrictEqual([gate.blocksStart('codex'), st.released], [false, 1]);
    }
    // sessions open: the dialog is asked for, the lock stays (no session can start meanwhile); Cancel releases
    {
      const { gate } = mk({ open: 3, busy: 1 });
      let ran = 0;
      const r = await gate.request('codex', undefined, async () => { ran++; return { ok: true }; });
      assert.deepStrictEqual(r, { ok: false, needsGate: { open: 3, busy: 1, pendingPermissions: 0, heldPrompts: 0 } });
      assert.deepStrictEqual([ran, gate.blocksStart('codex')], [0, true], 'no run while sessions are open (SC-004); the lock is held');
      const c = await gate.request('codex', 'cancel', async () => ({ ok: true }));
      assert.deepStrictEqual([c.ok, (c as { cancelled?: boolean }).cancelled, gate.blocksStart('codex'), ran], [false, true, false, 0], 'cancel releases the lock');
      assert.strictEqual((await gate.request('codex', 'end', async () => ({ ok: true }))).ok, false, 'a gate answer without a pending question is refused');
    }
    // End N sessions: ended first (stopTurnOp then endSessionOp are main's endAll), then the run
    {
      const { gate, st } = mk({ open: 2 });
      await gate.request('codex', undefined, async () => ({ ok: true }));
      let ran = 0;
      const r = await gate.request('codex', 'end', async () => { ran++; return { ok: true }; });
      assert.deepStrictEqual([r.ok, st.ended, ran], [true, 1, 1]);
    }
    // the count again after the confirmation: a session open by then sends the user back to the dialog, no run
    {
      const { gate, st } = mk({ open: 0 });
      let started = 0;
      const r = await gate.request('codex', undefined, async (recount) => { st.open = 1; if (recount() > 0) return { ok: false, recount: true }; started++; return { ok: true }; });
      assert.deepStrictEqual([r.ok, 'needsGate' in r, started, gate.blocksStart('codex')], [false, true, 0, true]);
    }
    // Update when they end: waits, then the confirmation comes again (the live-session rule itself: startHeldBy below)
    {
      const { gate, st, tick } = mk({ open: 2 });
      await gate.request('codex', undefined, async () => ({ ok: true }));
      let ran = 0;
      const w = await gate.request('codex', 'wait', async () => { ran++; return { ok: true }; });
      assert.deepStrictEqual([w, gate.waiting(), gate.blocksStart('codex')], [{ ok: true, waiting: 2 }, { codex: 2 }, true]);
      await tick();
      assert.strictEqual(ran, 0, 'still open sessions: still waiting');
      st.open = 0;
      await tick();
      assert.deepStrictEqual([ran, gate.waiting()], [1, {}], 'the last session ended: the run (with its own confirmation) goes');
      assert.strictEqual(gate.blocksStart('codex'), true, 'the lock is held to the finish');
    }
    // a waiting update that is cancelled at its confirmation, or fails, tells the window and releases
    {
      const { gate, st, tick } = mk({ open: 1 });
      await gate.request('codex', undefined, async () => ({ ok: true }));
      await gate.request('codex', 'wait', async () => ({ ok: false, cancelled: true, error: 'Cancelled.' }));
      st.open = 0;
      await tick();
      assert.deepStrictEqual([st.failed.length, st.failed[0]?.cancelled, gate.blocksStart('codex')], [1, true, false]);
    }
    // Cancel of a waiting update releases it
    {
      const { gate } = mk({ open: 1 });
      await gate.request('codex', undefined, async () => ({ ok: true }));
      await gate.request('codex', 'wait', async () => ({ ok: true }));
      await gate.request('codex', 'cancel', async () => ({ ok: true }));
      assert.deepStrictEqual([gate.blocksStart('codex'), gate.waiting()], [false, {}]);
    }
    // a run that fails to start frees the lock; one that starts keeps it
    {
      const { gate } = mk({ open: 0 });
      await gate.request('codex', undefined, async () => ({ ok: false, error: 'nope' }));
      assert.strictEqual(gate.blocksStart('codex'), false);
    }
    // review on #721: a lock waiting for the window's answer is released when the window reloads or goes away, and after ASK_LIMIT_MS
    {
      const { gate, st } = mk({ open: 2 });
      await gate.request('codex', undefined, async () => ({ ok: true }));
      assert.strictEqual(gate.blocksStart('codex'), true);
      gate.releaseAsking();
      assert.deepStrictEqual([gate.blocksStart('codex'), st.released], [false, 1], 'released on reload');
      // a waiting (or running) update keeps its lock: main finishes it without the window
      await gate.request('codex', undefined, async () => ({ ok: true }));
      await gate.request('codex', 'wait', async () => ({ ok: true }));
      gate.releaseAsking();
      assert.strictEqual(gate.blocksStart('codex'), true, 'a waiting update is not dropped by a reload');
      const r = mk({ open: 0 });
      await r.gate.request('claude', undefined, async () => ({ ok: true }));
      r.gate.releaseAsking();
      assert.strictEqual(r.gate.blocksStart('claude'), true, 'a running update keeps its lock');
    }
    {
      const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
      const gate = new UpdateGate({ count: () => ({ open: 1, busy: 0, pendingPermissions: 0, heldPrompts: 0 }), endAll: async () => undefined, setTimer: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; }, clearTimer: (t) => { (t as { live: boolean }).live = false; }, changed: () => undefined, failed: () => undefined });
      await gate.request('codex', undefined, async () => ({ ok: true }));
      const ask = timers.find((t) => t.live && t.ms === ASK_LIMIT_MS);
      assert.ok(ask, 'the asking phase has a time limit');
      ask!.live = false; ask!.fn();
      assert.strictEqual(gate.blocksStart('codex'), false, 'no answer within the limit: released');
      await gate.request('codex', undefined, async () => ({ ok: true }));
      await gate.request('codex', 'wait', async () => ({ ok: true }));
      assert.ok(timers.filter((t) => t.ms === ASK_LIMIT_MS).every((t) => !t.live), 'answering stops the limit');
    }
    // review on #721: a RUNNING update never loses its lock to the asking limit: the limit is cleared when the run starts (leaveAsking),
    // and a limit that fires anyway (fired here even when cleared) checks the phase first. With no sessions, and after 'end'.
    for (const how of ['no sessions', 'end'] as const) {
      const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
      let open = how === 'end' ? 2 : 0;
      const gate = new UpdateGate({ count: () => ({ open, busy: 0, pendingPermissions: 0, heldPrompts: 0 }), endAll: async () => { open = 0; }, setTimer: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; }, clearTimer: (t) => { (t as { live: boolean }).live = false; }, changed: () => undefined, failed: () => undefined });
      const first = await gate.request('codex', undefined, async () => ({ ok: true }));
      if (how === 'end') {
        assert.ok('needsGate' in first);
        assert.strictEqual((await gate.request('codex', 'end', async () => ({ ok: true }))).ok, true);
      } else assert.strictEqual(first.ok, true);
      const asks = timers.filter((t) => t.ms === ASK_LIMIT_MS);
      assert.ok(asks.length > 0 && asks.every((t) => !t.live), `${how}: the asking limit is cleared when the run starts`);
      for (const t of asks) t.fn(); // even a limit that fires late
      assert.strictEqual(gate.blocksStart('codex'), true, `${how}: the running update keeps its lock after ASK_LIMIT_MS`);
    }
    // the window side: another dialog replacing the open-sessions dialog answers Cancel (harnesses.js modal's onReplaced)
    {
      const hs = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'harnesses.js'), 'utf8');
      assert.ok(/const old = document\.getElementById\('hsDlg'\); if \(old\) \{ const h = old\.__onReplaced;[^}]*h\(\); \}/.test(hs), 'modal() runs the replaced dialog\'s handler');
      assert.ok(/\{ onReplaced: \(\) => res\(null\) \}/.test(hs.slice(hs.indexOf('function gateDialog'))), 'the gate dialog answers Cancel when replaced');
      const main = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'), 'utf8');
      assert.ok(/did-start-navigation', \(d\) => \{ if \(d\.isMainFrame && !d\.isSameDocument\) harnessIpc\.releaseAsking\(\); \}/.test(main) && /render-process-gone', \(\) => harnessIpc\.releaseAsking\(\)/.test(main), 'main releases on reload and on a crash');
    }
    // FR-013, the one rule (review on #721, mutants M21-M22): an open session is never held; a start or a resume while the lock is on is
    {
      assert.strictEqual(startHeldBy({ locked: true, live: true, name: 'Codex' }, 'schedule'), undefined, 'a scheduled prompt to a live session goes through');
      assert.strictEqual(startHeldBy({ locked: true, live: true, name: 'Codex' }, 'start'), undefined, 'a message to a live session goes through');
      assert.strictEqual(startHeldBy({ locked: true, live: false, name: 'Codex' }, 'schedule'), 'Codex is updating', 'one that would resume an ended session is held');
      assert.match(startHeldBy({ locked: true, live: false, name: 'Codex' }, 'start') ?? '', /Codex is being updated/);
      assert.strictEqual(startHeldBy({ locked: false, live: false, name: 'Codex' }, 'start'), undefined);
      // the call sites use it with the real liveness (source checks: main.ts cannot be loaded in a test)
      const main = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'), 'utf8');
      const ensure = main.slice(main.indexOf('async function ensureLive('), main.indexOf('let p = starting.get(a.id);'));
      assert.ok(/if \(ad\.isLive\(a\.id\)\) return;[\s\S]*updateBlocks\(router\.adapterIdOf\(a\.id\) \?\? a\.adapterId, ad\.isLive\(a\.id\)\)/.test(ensure), 'ensureLive: a live session returns first, the lock is asked with its liveness');
      assert.ok(/const blocked = updateBlocks\(adapterId, false\);/.test(main), 'addWorkspace: a new session is never live');
      assert.ok(/const updateBlocks = \(adapterId: string \| undefined, live: boolean\)[^\n]*startHeldBy\(\{ locked: harnessIpc\.blocksStart\(adapterId\), live,/.test(main), 'updateBlocks is startHeldBy');
      const held = main.slice(main.indexOf('  heldBy: (s) => {'), main.indexOf('  capUnitOf: (s) => {'));
      assert.ok(/startHeldBy\(\{ locked: harnessIpc\.blocksStart\(kind\), live: router\.forAgent\(a\.id\)\?\.isLive\(a\.id\) === true,[^}]*\}, 'schedule'\)/.test(held), 'the scheduler holds with the same rule');
    }
    // FR-004, review on #721: winget's terms are accepted only after main's own native question, and only when the kept result says so
    {
      assert.strictEqual(wingetTermsQuestion({ reason: 'winget needs its terms accepted' }), true);
      for (const k of [undefined, { reason: 'network problem' }, { reason: 'unexpected answer' }]) assert.strictEqual(wingetTermsQuestion(k), false);
      const ipc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'ipc', 'harness.ts'), 'utf8');
      const upd = ipc.slice(ipc.indexOf("ipcHandle('harness:updates'"), ipc.indexOf("ipcHandle('harness:visible'"));
      assert.ok(/ipcHandle\('harness:updates', async \(e, what\?: unknown, app\?: unknown\) =>/.test(upd), 'the window sends no terms answer (no third argument)');
      assert.ok(/const acceptTerms = !simulatorOn\(dev\) && wingetTermsQuestion\(checker\.result\(app\)\) \? await askWingetTerms\(\) : false;/.test(upd), 'main decides, with its own dialog');
      assert.ok(/dialog\.showMessageBox/.test(ipc.slice(ipc.indexOf('const askWingetTerms'), ipc.indexOf("ipcHandle('harness:updates'"))), 'a native dialog');
      // review on #721 item 7: another frame gets an empty view, not the kept results
      assert.ok(/if \(!fromApp\(e\)\) return emptyView\(\);/.test(upd));
      const pre = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'preload', 'preload.ts'), 'utf8');
      assert.ok(!/acceptTerms/.test(pre), 'the preload passes no terms flag');
    }
    // FR-017 (review on #721): the README and the Settings note name the headers, as sent (netget FIXED_HEADERS)
    for (const f of ['README.md', path.join('src', 'renderer', 'harnesses.js')]) {
      const t = fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
      assert.match(t, /set by Durbar: `?User-Agent: AgentDurbar`?, `?Accept: \*\/\*`? and `?Accept-Language: en`? \(never your locale\); added by Chromium: its fixed `?Accept-Encoding`? and `?Sec-Fetch/, f);
      assert.ok(!/Chromium's fixed `?Accept[`,]/.test(t), f + ': Accept is Durbar\'s own header, not Chromium\'s (review on #721)');
    }
    assert.deepStrictEqual(FIXED_HEADERS, { 'User-Agent': 'AgentDurbar', 'Accept': '*/*', 'Accept-Language': 'en' });
    // FR-022 (mutant M23): an update the organization does not allow is refused in main's harness:run
    {
      assert.strictEqual(updateRunRefusal({ installBlocked: true, checkHidden: false }), 'Updates are managed by your organization.');
      assert.strictEqual(updateRunRefusal({ installBlocked: false, checkHidden: false }), undefined);
      const ipc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'ipc', 'harness.ts'), 'utf8');
      const run = ipc.slice(ipc.indexOf("ipcHandle('harness:run'"), ipc.indexOf("ipcHandle('harness:updates'"));
      const i = run.indexOf('const refused = updateRunRefusal(policyView(updatePolicy()));'), j = run.indexOf('if (refused) return'), k = run.indexOf('gate.request(');
      assert.ok(i > 0 && j > i && k > j, 'harness:run refuses before the gate takes a lock');
    }
    // the Copilot CLI has no gate: main's count for it is 0 (sessions run Durbar's bundled runtime), so the run goes at once
    {
      const { gate } = mk({ open: 0 });
      assert.strictEqual((await gate.request('copilot', undefined, async () => ({ ok: true }))).ok, true);
    }
  }

  // -------------------------------------------------------------------------------------------------------------------
  // T007: settings
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-081-'));
    const file = path.join(dir, 'settings.json');
    const s = new SettingsStore(file);
    s.load();
    assert.strictEqual(s.checkUpdatesAtStart, true, 'on by default (Q6 = A)');
    assert.strictEqual(s.setCheckUpdatesAtStart('no'), true, 'only a real boolean changes it');
    assert.strictEqual(s.setCheckUpdatesAtStart(false), false);
    assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).checkUpdatesAtStart, false);
    assert.strictEqual(s.setCheckUpdatesAtStart(true), true);
    assert.ok(!('checkUpdatesAtStart' in JSON.parse(fs.readFileSync(file, 'utf8'))), 'only false is written');
    // announced versions: an allowed app id and a valid version; anything else is dropped
    for (const [app, v] of [['__proto__', '1.0.0'], ['constructor', '1.0.0'], ['codex', '<b>'], ['codex', '1.0'], ['codex', 5], ['codex', '1'.repeat(70)], ['bash', '1.0.0'], [5, '1.0.0'], ['codex', null]] as Array<[unknown, unknown]>) assert.strictEqual(s.setAnnouncedVersion(app, v), false, `${String(app)} ${String(v)}`);
    assert.deepStrictEqual(s.announcedVersions, {});
    assert.strictEqual(s.setAnnouncedVersion('codex', '0.164.0'), true);
    assert.strictEqual(s.setAnnouncedVersion('claude', 'v2.1.308'), true);
    const back = new SettingsStore(file);
    back.load();
    assert.deepStrictEqual(back.announcedVersions, { codex: '0.164.0', claude: '2.1.308' }, 'kept across a restart');
    // a hostile file: nested objects, prototype keys, wrong types, huge strings
    const hostile = parseSettings(JSON.stringify({ announcedVersions: { codex: '0.164.0', claude: { v: 1 }, copilot: '1'.repeat(1000), evil: '1.0.0' }, checkUpdatesAtStart: 'false' }));
    assert.deepStrictEqual(hostile, { announcedVersions: { codex: '0.164.0' } });
    assert.deepStrictEqual(parseSettings('{"announcedVersions":{"__proto__":{"codex":"1.0.0"},"codex":["1.0.0"]}}'), {});
    assert.deepStrictEqual(parseSettings('{"announcedVersions":[["codex","1.0.0"]],"checkUpdatesAtStart":false}'), { checkUpdatesAtStart: false });
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // -------------------------------------------------------------------------------------------------------------------
  // T009: exec with an environment for that child only, and the tree kill
  {
    const seen: Array<{ file: string; opts: Record<string, unknown> }> = [];
    const killed: unknown[] = [];
    const mkExec = (platform: NodeJS.Platform, finish: 'now' | 'on-kill') => {
      let cb: ((e: Error | null, so: string, se: string) => void) | undefined;
      const child = { pid: 4242 } as never;
      const exec = makeExec({
        execFile: ((file: string, _args: string[], opts: Record<string, unknown>, done: typeof cb) => { seen.push({ file, opts }); cb = done; if (finish === 'now') setImmediate(() => done?.(null, 'out', '')); return child; }) as never,
        killTree: (c) => { killed.push(c); setImmediate(() => cb?.(Object.assign(new Error('killed'), { killed: true, code: null }), '', '')); },
        platform, env: { PATH: '/bin', KEEP: '1' },
      });
      return exec;
    };
    const r1 = await mkExec('linux', 'now')('npm', ['view'], { timeoutMs: 1000, env: { npm_config_update_notifier: 'false' } });
    assert.strictEqual(r1.code, 0);
    assert.deepStrictEqual((seen[0].opts.env as Record<string, string>), { PATH: '/bin', KEEP: '1', npm_config_update_notifier: 'false' }, 'merged over the environment, for that child');
    assert.strictEqual(seen[0].opts.detached, true, 'a POSIX child is its own process group, so the tree kill can end it');
    assert.strictEqual(seen[0].opts.shell, false);
    await mkExec('linux', 'now')('npm', ['view'], { timeoutMs: 1000 });
    assert.ok(!('env' in seen[1].opts), 'no env option: the child inherits as before (detection is unchanged)');
    assert.strictEqual(seen[1].opts.detached, true);
    const w = await mkExec('win32', 'now')('npm.cmd', [], { timeoutMs: 1000 });
    assert.strictEqual(w.code, 0);
    assert.strictEqual(seen[2].opts.detached, false);
    // a timeout ends the whole tree, not only the direct child
    const t = await mkExec('linux', 'on-kill')('npm', ['view'], { timeoutMs: 10 });
    assert.deepStrictEqual([killed.length, t.timedOut], [1, true], 'the timeout calls the tree kill');
    // the tree kill itself: POSIX signals the group; Windows runs taskkill /T /F from System32
    const sig: Array<[number, string | number]> = [];
    const later: Array<() => void> = [];
    const alive = { pid: 77, kill: () => true, exitCode: null, signalCode: null };
    killChildTree(alive as never, 'linux', {}, (() => undefined) as never, (pid, s) => { sig.push([pid, s]); }, (fn, ms) => { assert.strictEqual(ms, 3000); later.push(fn); });
    assert.deepStrictEqual(sig, [[-77, 'SIGTERM']], 'the process group (a negative pid), not the child alone');
    later.splice(0).forEach((f) => f());
    assert.deepStrictEqual(sig, [[-77, 'SIGTERM'], [-77, 'SIGKILL']], 'still running after 3 s: SIGKILL to the group');
    // spec 093 FR-107: the child exited on SIGTERM; its group is probed (signal 0) before any SIGKILL
    const gone = { pid: 80, kill: () => true, exitCode: 0, signalCode: null };
    const sig2: Array<[number, string | number]> = [];
    const esrch = (pid: number, s: NodeJS.Signals | 0): void => { sig2.push([pid, s]); if (s === 0) throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' }); };
    killChildTree(gone as never, 'linux', {}, (() => undefined) as never, esrch, (fn) => later.push(fn));
    later.splice(0).forEach((f) => f());
    assert.deepStrictEqual(sig2, [[-80, 'SIGTERM'], [-80, 0]], 'exited and its group is empty: no SIGKILL (its group id may belong to something else later)');
    // exited, but a descendant ignored SIGTERM (macOS: git ended, git-remote-https kept its connection): the group still has
    // members, so its id cannot have been reused, and the SIGKILL ends them
    const leftover = { pid: 81, kill: () => true, exitCode: null as number | null, signalCode: 'SIGTERM' };
    const sig3: Array<[number, string | number]> = [];
    killChildTree(leftover as never, 'darwin', {}, (() => undefined) as never, (pid, s) => { sig3.push([pid, s]); }, (fn) => later.push(fn));
    later.splice(0).forEach((f) => f());
    assert.deepStrictEqual(sig3, [[-81, 'SIGTERM'], [-81, 0], [-81, 'SIGKILL']], 'exited with a descendant left in its group: SIGKILL to the group');
    // a group the probe may not signal (EPERM): nothing more is sent
    const sig4: Array<[number, string | number]> = [];
    killChildTree({ ...gone, pid: 82 } as never, 'linux', {}, (() => undefined) as never, (pid, s) => { sig4.push([pid, s]); if (s === 0) throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' }); }, (fn) => later.push(fn));
    later.splice(0).forEach((f) => f());
    assert.deepStrictEqual(sig4, [[-82, 'SIGTERM'], [-82, 0]], 'a probe that fails: no SIGKILL');
    const ran: Array<[string, string[]]> = [];
    killChildTree({ pid: 78 } as never, 'win32', { SystemRoot: 'C:\\Windows' }, ((f: string, a: string[]) => { ran.push([f, a]); }) as never);
    assert.deepStrictEqual(ran, [['C:\\Windows\\System32\\taskkill.exe', ['/pid', '78', '/t', '/f']]]);
    killChildTree({ pid: 79 } as never, 'win32', { SystemRoot: 'relative' }, ((f: string) => { ran.push([f, []]); }) as never);
    assert.strictEqual(ran[1][0], 'C:\\Windows\\System32\\taskkill.exe', 'SystemRoot is used only when absolute');
    killChildTree({} as never, 'linux', {}, (() => undefined) as never, () => { throw new Error('no pid: nothing to kill'); });
    // review on #721: one tree kill: the setup runner uses this one too
    assert.match(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'ipc', 'harness.ts'), 'utf8'), /killTree: \(c\) => killChildTree\(/);
  }

  console.log('updatecheck: versions, sources, official Codex, commands, parsers, failures, lookups, checker, policy, announce, gate, settings, exec OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
