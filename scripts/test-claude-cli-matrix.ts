/**
 * Spec 012 FR-163 (T136): the parts of the Claude CLI matrix that need no binary (`npm test`): DURBAR_CLAUDE_BIN (honoured, validated,
 * dev-only) and the `--help` flag parser, against a fixture of option lines trimmed from Claude Code 2.1.309's help. No process, no credits.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { CLAUDE_BINARY, claudeConfiguredPath, configureDevClaudeBin, detectClaude, devClaudeBin } from '../src/adapters/detect';
import type { DetectEnv, Exec } from '../src/adapters/detect';
import { compare, emittedFlags, findBinaries, flagsOf, gatesOf, MIN_FLAGS_CHECKED, mentionedFlags, parseHelpFlags, representativeLaunches, versionOf } from './claude-cli-matrix';

const root = path.join(__dirname, '..', '..');
const fixture = fs.readFileSync(path.join(root, 'scripts', 'fixtures', 'claude-help', '2.1.309-options.txt'), 'utf8');

// --- DURBAR_CLAUDE_BIN -----------------------------------------------------------------------------------------------------------
const mk = (files: string[], platform: NodeJS.Platform = 'linux'): DetectEnv => ({ platform, env: { PATH: '/usr/bin' }, homedir: '/home/u', isFile: (p) => files.includes(p) });
{
  const env = mk(['/opt/old/claude', '/usr/bin/claude']);
  assert.strictEqual(devClaudeBin({ DURBAR_CLAUDE_BIN: '/opt/old/claude' }, env).path, '/opt/old/claude', 'an absolute existing file is used');
  assert.ok(devClaudeBin({ DURBAR_CLAUDE_BIN: '/opt/old/claude' }, env).warning, 'and a dev-only warning is given');
  for (const bad of ['claude', './claude', '../x/claude', '/opt/none/claude', '', '/opt/old/claude\u0000', '/opt/old/\nclaude']) {
    const r = devClaudeBin({ DURBAR_CLAUDE_BIN: bad }, env);
    assert.strictEqual(r.path, undefined, `refused: ${JSON.stringify(bad)}`);
  }
  assert.ok(devClaudeBin({ DURBAR_CLAUDE_BIN: 'rel' }, env).warning, 'a refused value says so');
  assert.deepStrictEqual(devClaudeBin({}, env), {}, 'unset: nothing');
  assert.strictEqual(devClaudeBin({ DURBAR_CLAUDE_BIN: 'C:\\tools\\claude.exe' }, mk(['C:\\tools\\claude.exe'], 'win32')).path, 'C:\\tools\\claude.exe', 'Windows absolute path');
  assert.strictEqual(devClaudeBin({ DURBAR_CLAUDE_BIN: 'tools\\claude.exe' }, mk(['tools\\claude.exe'], 'win32')).path, undefined, 'a relative Windows path is refused');
}
// the configured path wins over PATH in detection, through the existing candidates() mechanism; a packaged build passes an empty `dev`
(async () => {
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    const env = mk(['/opt/old/claude', '/usr/bin/claude']);
    const ran: string[] = [];
    const exec: Exec = async (file, args) => {
      ran.push(`${file} ${args.join(' ')}`);
      return { code: 0, stdout: file === '/opt/old/claude' ? '2.1.302 (Claude Code)' : '2.1.309 (Claude Code)', stderr: '' };
    };
    configureDevClaudeBin({ DURBAR_CLAUDE_BIN: '/opt/old/claude' }, env);
    assert.strictEqual(claudeConfiguredPath(), '/opt/old/claude', 'configured');
    const r = await detectClaude(env, exec, claudeConfiguredPath());
    assert.strictEqual(r.path, '/opt/old/claude', 'detection uses DURBAR_CLAUDE_BIN first');
    assert.strictEqual(r.version, '2.1.302');
    assert.ok(ran.every((c) => c.startsWith('/opt/old/claude ')), 'only the configured file was run');
    configureDevClaudeBin({}, env); // a packaged build: `devEnv` is empty
    assert.strictEqual(claudeConfiguredPath(), undefined, 'cleared when the hook is absent');
    const r2 = await detectClaude(env, exec, claudeConfiguredPath());
    assert.strictEqual(r2.path, '/usr/bin/claude', 'back to PATH');
    assert.ok(CLAUDE_BINARY.name === 'claude');
  } finally {
    console.warn = warn;
  }

  // --- the help parser, on the 2.1.309 fixture --------------------------------------------------------------------------------------
  const lines = fixture.split(/\r?\n/).filter(Boolean);
  assert.ok(lines.length >= 60 && lines.every((l) => /^ {2}-/.test(l)), 'the fixture holds only option lines');
  const flags = parseHelpFlags(fixture);
  assert.ok(flags.size >= 70, `parsed ${flags.size} flags from the fixture`);
  for (const f of ['-p', '--print', '--add-dir', '--allowedTools', '--allowed-tools', '--disallowedTools', '--setting-sources', '--strict-mcp-config', '--mcp-config', '--name', '-n', '--max-budget-usd',
    '--include-partial-messages', '--input-format', '--output-format', '--session-id', '-r', '--resume', '--forward-subagent-text', '--agents', '--agent', '--effort', '--model', '--settings', '--verbose',
    '--allow-dangerously-skip-permissions', '--permission-mode', '--append-system-prompt', '--remote-control-session-name-prefix', '--exclude-dynamic-system-prompt-sections', '--no-chrome']) assert.ok(flags.has(f), `parsed ${f}`);
  assert.ok(!flags.has('--permission-prompt-tool') && !flags.has('--bogus'), 'a flag that is not declared is not invented');
  assert.deepStrictEqual([...parseHelpFlags('Options:\r\n  -x, --xray <v>   Does\r\n                   --not-a-flag here\r\n  --yank\r\nCommands:\r\n  mcp   --nope')].sort(), ['--xray', '--yank', '-x'], 'CRLF, wrapped description and command lines');
  assert.deepStrictEqual([...mentionedFlags('see --permission-prompt-tool or (--hidden-one) x--no')].sort(), ['--hidden-one', '--permission-prompt-tool']);
  assert.deepStrictEqual(flagsOf(['-p', '--output-format', 'stream-json', '--settings', '{"a":1}', '--session-id', 'abc']), ['-p', '--output-format', '--settings', '--session-id']);
  assert.strictEqual(versionOf('2.1.309 (Claude Code)\n'), '2.1.309');
  assert.strictEqual(versionOf('nothing'), undefined);

  // --- the flags come from the real claudeArgs, not a copied list -------------------------------------------------------------------
  const emitted = emittedFlags('2.1.309');
  assert.ok(emitted.length >= MIN_FLAGS_CHECKED, `claudeArgs emits ${emitted.length} distinct flags over the representative launches`);
  for (const f of ['-p', '--output-format', '--permission-mode', '--allowedTools', '--disallowedTools', '--setting-sources', '--strict-mcp-config', '--mcp-config', '--settings', '--model', '--effort',
    '--append-system-prompt', '--agents', '--agent', '--add-dir', '--max-budget-usd', '--name', '--resume', '--session-id', '--allow-dangerously-skip-permissions']) assert.ok(emitted.includes(f), `claudeArgs can emit ${f}`);
  assert.strictEqual(representativeLaunches('2.1.309').length, 6);
  // every flag claudeArgs can emit is in the 2.1.309 fixture's declared options, or named in the help (hidden)
  // `--permission-prompt-tool` is hidden: no option line, only named in the prose of --permission-prompts (the fixture keeps option lines only)
  const row = compare('2.1.309', fixture, emitted, gatesOf());
  assert.deepStrictEqual(row.missing, ['--permission-prompt-tool'], 'only the hidden flag is not an option line in the fixture');
  const prose = compare('2.1.309', `${fixture}\n                                        --print: "host" (the SDK host or\n                                        --permission-prompt-tool) or "none"\n`, emitted, gatesOf());
  assert.deepStrictEqual(prose.missing, [], 'named in the help text: hidden, not missing');
  assert.deepStrictEqual(prose.hidden, ['--permission-prompt-tool']);

  // --- compare(): missing, hidden and gated ------------------------------------------------------------------------------------------
  const help = '  --aaa <x>   A\n  -b, --bbb   B\nSomething about --ccc here.\n';
  const c = compare('2.1.100', help, ['--aaa', '--bbb', '--ccc', '--ddd', '-b'], [{ flag: '--ddd', min: '2.1.211' }, { flag: '--aaa', min: '2.1.50' }]);
  assert.deepStrictEqual(c.missing, ['--ddd']);
  assert.deepStrictEqual(c.hidden, ['--ccc']);
  assert.strictEqual(c.listed, 3);
  assert.deepStrictEqual(c.gated, ['--ddd (needs 2.1.211)'], 'a flag emitted below its minimum version is reported; one at or above is not');
  assert.deepStrictEqual(compare('2.1.211', help, ['--ddd'], [{ flag: '--ddd', min: '2.1.211' }]).gated, [], 'the minimum itself is allowed');
  // gates come from the adapter's own exports
  assert.deepStrictEqual(gatesOf({ CLAUDE_FORWARD_SUBAGENT_MIN_VERSION: '2.1.211' }), [{ flag: '--forward-subagent-text', min: '2.1.211' }]);
  assert.deepStrictEqual(gatesOf({}), []);
  const withGate = { claudeForwardsSubagentText: (v?: string) => v === '2.1.300' };
  assert.strictEqual((representativeLaunches('2.1.300', withGate)[0] as { forwardSubagentText?: boolean }).forwardSubagentText, true);
  assert.strictEqual((representativeLaunches('2.1.100', withGate)[0] as { forwardSubagentText?: boolean }).forwardSubagentText, false);

  // --- finding binaries ----------------------------------------------------------------------------------------------------------------
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR ?? require('os').tmpdir(), 'cli-matrix-'));
  try {
    const home = path.join(tmp, 'home');
    const dir = path.join(home, '.local', 'share', 'claude', 'versions');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '2.1.1'), '');
    fs.writeFileSync(path.join(dir, '2.1.2'), '');
    assert.deepStrictEqual(findBinaries({ PATH: '' }, home), [path.join(dir, '2.1.1'), path.join(dir, '2.1.2')], 'every versions file');
    assert.deepStrictEqual(findBinaries({ DURBAR_CLAUDE_BINS: [path.join(dir, '2.1.2'), 'rel', path.join(tmp, 'none')].join(path.delimiter) }, home), [path.join(dir, '2.1.2')], 'the list: absolute existing files only');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log('claude cli matrix (unit): ok');
})().catch((e) => { console.error(e); process.exit(1); });
