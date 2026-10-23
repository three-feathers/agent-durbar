/**
 * Spec 073: the composer's "/" entries. `npm run test:slashcommands`. No Electron, no network, no credits.
 *
 *  - front matter, names, `user-invocable: false`, de-duplication and order (folder, user, app);
 *  - the places of each app (Claude Code, Copilot, Codex), also as Windows paths;
 *  - safety: symbolic links out of a folder or user directory, links to secrets inside it (`.env`, `.git/…`, `auth.json`), a file
 *    swapped after discovery (a link out, a FIFO), oversized files, the per-directory and total caps, bad names;
 *  - expansion: `$ARGUMENTS`, `$1`..`$9`, no placeholder, skills, built-ins and unknown names left alone, a vanished file;
 *  - the built-in allow list (FR-007: an unknown built-in is not offered) and what crosses to the window (`publicSlash`);
 *  - the per-folder cache (review on #535): a message that is not `/name` reads nothing, a warm `/name` reads only its file, and the
 *    cache is renewed by a changed directory, by age and by the list opening;
 *  - the Claude adapter merges files with the probe's built-ins; the Copilot and Codex adapters list their places;
 *  - the renderer's pure helpers (`slashsuggest.js`): the word at the caret, filtering with the shared `DurbarNav.rank`, insertion,
 *    and the option row's escaping (a hostile entry).
 */
import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import {
  BUILTIN_ALLOW, MAX_SLASH_BYTES, MAX_SLASH_FILES, MAX_SLASH_PER_DIR, SlashCache, claudeSlashPlaces, cleanBuiltins, codexSlashPlaces,
  copilotHomeDir, copilotSlashPlaces, discoverSlash, displayBase, expandSlash, mergeSlash, parseFrontMatter, publicSlash, slashLineName,
} from '../src/adapters/slashcommands';
import type { SlashFs, SlashPlace } from '../src/adapters/slashcommands';
import { parseClaudeAgent } from '../src/adapters/claudeAgents';
import { ClaudeAdapter } from '../src/adapters/claude';
import { CodexAdapter } from '../src/adapters/codex';

let passed = 0;
const test = async (name: string, fn: () => void | Promise<void>): Promise<void> => {
  await fn();
  passed++;
  console.log('ok -', name);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-slash-'));
const write = (p: string, text: string): string => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return p;
};
const canLink = (() => {
  try {
    fs.symlinkSync(tmp, path.join(tmp, 'probe-link'), 'dir');
    fs.unlinkSync(path.join(tmp, 'probe-link'));
    return true;
  } catch {
    return false;
  }
})();

async function main(): Promise<void> {
  await test('front matter: keys, quotes, lists, BOM, CRLF, and a file without it', () => {
    const a = parseFrontMatter('\uFEFF---\r\nname: "x"\r\ndescription: Say hi\r\ntools:\r\n  - Read\r\n---\r\nBody $ARGUMENTS\r\n');
    assert.strictEqual(a.fm.name, 'x');
    assert.strictEqual(a.fm.description, 'Say hi');
    assert.deepStrictEqual(a.lists.tools, ['Read']);
    assert.strictEqual(a.body.trim(), 'Body $ARGUMENTS');
    const b = parseFrontMatter('Just text');
    assert.deepStrictEqual(b.fm, {});
    assert.strictEqual(b.body, 'Just text');
    // spec 043 keeps working on the shared reader
    const ag = parseClaudeAgent('---\nname: rev\ndescription: Reviews\ntools: Read, Grep\n---\nYou review.', 'rev.md', 'repo');
    assert.ok(ag && ag.profile.name === 'rev' && ag.profile.tools?.join() === 'Read,Grep' && ag.prompt === 'You review.');
  });

  // a folder with every Claude kind, and a user directory
  const repo = path.join(tmp, 'repo');
  const cfg = path.join(tmp, 'home', '.claude');
  write(path.join(repo, '.claude', 'commands', 'review-pr.md'), '---\ndescription: Review a pull request\nargument-hint: <number>\n---\nReview PR $1 carefully. Notes: $ARGUMENTS');
  write(path.join(repo, '.claude', 'commands', 'plain.md'), 'Do the plain thing.');
  write(path.join(repo, '.claude', 'commands', 'notes.txt'), 'not markdown');
  write(path.join(repo, '.claude', 'skills', 'release-notes', 'SKILL.md'), '---\nname: release-notes\ndescription: Write release notes\n---\nCollect the merged PRs.');
  write(path.join(repo, '.claude', 'skills', 'hidden', 'SKILL.md'), '---\nname: hidden\nuser-invocable: false\n---\nModel only.');
  write(path.join(repo, '.claude', 'skills', 'bad name', 'SKILL.md'), '---\nname: "bad name"\n---\nx');
  write(path.join(cfg, 'commands', 'review-pr.md'), '---\ndescription: The user one\n---\nUser review.');
  write(path.join(cfg, 'commands', 'mine.md'), '---\ndescription: Mine\n---\nMine $ARGUMENTS');
  write(path.join(cfg, 'skills', 'aa-skill', 'SKILL.md'), '---\ndescription: User skill\n---\nUser skill body.');

  const claudeList = (): ReturnType<typeof discoverSlash> => discoverSlash(claudeSlashPlaces([repo], cfg, path.join(tmp, 'home')));

  await test('Claude places: folder skills and commands, then the user ones; first name wins; order folder, user', () => {
    const l = claudeList();
    const names = l.map((e) => `${e.source}:${e.kind}:${e.name}`);
    assert.deepStrictEqual(names, ['folder:skill:release-notes', 'folder:command:plain', 'folder:command:review-pr', 'user:skill:aa-skill', 'user:command:mine']);
    const pr = l.find((e) => e.name === 'review-pr')!;
    assert.strictEqual(pr.description, 'Review a pull request');
    assert.strictEqual(pr.argumentHint, '<number>');
    assert.strictEqual(pr.where, '.claude/commands/review-pr.md');
    assert.strictEqual(l.find((e) => e.name === 'mine')!.where, '~/.claude/commands/mine.md');
    assert.ok(!l.some((e) => e.name === 'hidden'), 'user-invocable: false is left out');
    assert.ok(!l.some((e) => e.name === 'notes' || /\s|bad/.test(e.name)), 'non-Markdown files and bad names are left out');
  });

  await test('places per app, also with Windows paths', () => {
    const posix = (d: string): string => d.split(path.sep).join('/').replace(/^[A-Za-z]:/, '');
    const c = claudeSlashPlaces(['/w/a', '/w/b'], '/h/.claude', '/h');
    assert.deepStrictEqual(c.map((p) => [posix(p.dir), p.scope, p.kind, p.whereBase]), [
      ['/w/a/.claude/skills', 'folder', 'skill', 'a'], ['/w/a/.claude/commands', 'folder', 'command', 'a'],
      ['/w/b/.claude/skills', 'folder', 'skill', 'b'], ['/w/b/.claude/commands', 'folder', 'command', 'b'],
      ['/h/.claude/skills', 'user', 'skill', '~/.claude'], ['/h/.claude/commands', 'user', 'command', '~/.claude'],
    ]);
    assert.strictEqual(claudeSlashPlaces(['/w/a'], '/h/.claude', '/h')[0].whereBase, '', 'one folder: paths relative to it');
    const cp = copilotSlashPlaces(['/w/a'], copilotHomeDir({}, '/h'), '/h').map((p) => p.dir.split(path.sep).join('/'));
    assert.deepStrictEqual(cp.map((d) => d.replace(/^[A-Za-z]:/, '')), ['/w/a/.github/skills', '/w/a/.claude/skills', '/w/a/.agents/skills', '/h/.copilot/skills', '/h/.agents/skills']);
    // COPILOT_HOME replaces the whole ~/.copilot path (GitHub's config-dir reference, read:)
    const ch = copilotSlashPlaces(['/w/a'], copilotHomeDir({ COPILOT_HOME: '/c/cop' }, '/h'), '/h').filter((p) => p.scope === 'user');
    assert.deepStrictEqual(ch.map((p) => [p.dir.split(path.sep).join('/').replace(/^[A-Za-z]:/, ''), p.whereBase]), [['/c/cop/skills', 'c/cop'], ['/h/.agents/skills', '~/.agents']]);
    const cx = codexSlashPlaces(['/w/a'], '/h/.codex', '/h');
    assert.deepStrictEqual(cx.map((p) => [p.dir.split(path.sep).join('/').replace(/^[A-Za-z]:/, ''), p.kind, p.prefix ?? '']), [
      ['/w/a/.agents/skills', 'skill', ''], ['/h/.agents/skills', 'skill', ''], ['/h/.codex/skills', 'skill', ''], ['/h/.codex/prompts', 'prompt', 'prompts:'],
    ]);
    assert.strictEqual(path.win32.join('C:\\w\\a', '.claude', 'skills'), 'C:\\w\\a\\.claude\\skills'); // the places are built with path.join only
    assert.strictEqual(displayBase('/opt/claude-cfg', '/h'), 'opt/claude-cfg', 'outside home: no absolute path');
  });

  await test('safety: a symbolic link out of the folder or the user directory is skipped (file and directory)', () => {
    if (!canLink) return console.log('  (skipped: this OS refuses symbolic links here)');
    const outside = path.join(tmp, 'outside');
    write(path.join(outside, 'secret.md'), '---\ndescription: SECRET\n---\nsecret');
    write(path.join(outside, 'skill', 'SKILL.md'), '---\nname: leak\n---\nleak');
    const r = path.join(tmp, 'linkrepo');
    write(path.join(r, '.claude', 'commands', 'ok.md'), 'fine');
    fs.symlinkSync(path.join(outside, 'secret.md'), path.join(r, '.claude', 'commands', 'secret.md'), 'file');
    fs.mkdirSync(path.join(r, '.claude', 'skills'), { recursive: true });
    fs.symlinkSync(path.join(outside, 'skill'), path.join(r, '.claude', 'skills', 'leak'), 'dir');
    // inside the folder: a link that stays inside is fine
    write(path.join(r, 'docs', 'inside.md'), '---\ndescription: Inside\n---\ninside');
    fs.symlinkSync(path.join(r, 'docs', 'inside.md'), path.join(r, '.claude', 'commands', 'inside.md'), 'file');
    // a whole commands directory linked out of the user directory
    const u = path.join(tmp, 'linkhome', '.claude');
    fs.mkdirSync(u, { recursive: true });
    fs.symlinkSync(outside, path.join(u, 'commands'), 'dir');
    const l = discoverSlash(claudeSlashPlaces([r], u, path.join(tmp, 'linkhome')));
    assert.deepStrictEqual(l.map((e) => e.name), ['inside', 'ok']);
    assert.ok(!JSON.stringify(l).includes('SECRET'));
  });

  await test('safety (review on #535): a link inside the folder to a secret is neither listed nor expanded', () => {
    if (!canLink) return console.log('  (skipped: this OS refuses symbolic links here)');
    const r = path.join(tmp, 'secretrepo');
    write(path.join(r, '.env'), 'API_KEY=SECRET-ENV');
    write(path.join(r, '.git', 'config'), '[remote] url = https://SECRET-GIT@example');
    write(path.join(r, '.git', 'notes.md'), 'SECRET-GITMD');
    write(path.join(r, '.claude', 'commands', 'ok.md'), 'fine');
    const cmds = path.join(r, '.claude', 'commands');
    fs.symlinkSync(path.join(r, '.env'), path.join(cmds, 'review.md'), 'file');
    fs.symlinkSync(path.join(r, '.git', 'config'), path.join(cmds, 'gitcfg.md'), 'file');
    fs.symlinkSync(path.join(r, '.git', 'notes.md'), path.join(cmds, 'gitmd.md'), 'file');
    fs.mkdirSync(path.join(r, '.claude', 'skills', 'envskill'), { recursive: true });
    fs.symlinkSync(path.join(r, '.env'), path.join(r, '.claude', 'skills', 'envskill', 'SKILL.md'), 'file');
    // a Codex home: prompts/x.md -> ../auth.json
    const home = path.join(tmp, 'secrethome');
    const cx = path.join(home, '.codex');
    write(path.join(cx, 'auth.json'), '{"token":"SECRET-AUTH"}');
    fs.mkdirSync(path.join(cx, 'prompts'), { recursive: true });
    fs.symlinkSync(path.join('..', 'auth.json'), path.join(cx, 'prompts', 'x.md'), 'file');
    const claude = discoverSlash(claudeSlashPlaces([r], path.join(home, '.claude'), home));
    assert.deepStrictEqual(claude.map((e) => e.name), ['ok'], 'only the real Markdown file is listed');
    const codex = discoverSlash(codexSlashPlaces([r], cx, home));
    assert.ok(!codex.some((e) => e.name === 'prompts:x'), 'a prompt linked to auth.json is not listed');
    assert.ok(!JSON.stringify([claude, codex]).includes('SECRET'));
    // expansion checks again, even for an entry that claims such a file (forged or from an older list)
    const forged = (file: string, root: string, kind: 'command' | 'skill' | 'prompt', name = 'x') => expandSlash(`/${name} go`, [{ name, source: 'folder', kind, file, root }]);
    for (const [f, root, kind] of [
      [path.join(cmds, 'review.md'), r, 'command'], [path.join(cmds, 'gitcfg.md'), r, 'command'], [path.join(cmds, 'gitmd.md'), r, 'command'],
      [path.join(r, '.claude', 'skills', 'envskill', 'SKILL.md'), r, 'skill'], [path.join(cx, 'prompts', 'x.md'), cx, 'prompt'],
      [path.join(r, '.env'), r, 'command'], [path.join(cx, 'auth.json'), cx, 'prompt'],
    ] as const) assert.strictEqual(forged(f, root, kind), undefined, `${path.relative(tmp, f)} is not expanded`);
    assert.ok(forged(path.join(cmds, 'ok.md'), r, 'command'), 'the real command still expands');
  });

  await test('safety (review on #535): a SKILL.md swapped after discovery for a link out of the folder is not sent', () => {
    if (!canLink) return console.log('  (skipped: this OS refuses symbolic links here)');
    const r = path.join(tmp, 'swaprepo');
    const out = write(path.join(tmp, 'swap-outside', 'SKILL.md'), '---\nname: s\n---\nSECRET-OUTSIDE');
    const skill = write(path.join(r, '.claude', 'skills', 's', 'SKILL.md'), '---\nname: s\n---\ninside body');
    const places = claudeSlashPlaces([r], path.join(tmp, 'swaphome', '.claude'), path.join(tmp, 'swaphome'));
    const list = discoverSlash(places);
    assert.ok(expandSlash('/s', list)?.text.includes('inside body'));
    fs.unlinkSync(skill);
    fs.symlinkSync(out, skill, 'file');
    assert.strictEqual(expandSlash('/s', list), undefined, 'the swapped file is checked again and refused');
  });

  await test('safety (review on #535): a SKILL.md that grows past 64 KB after discovery is refused, not sent cut off', () => {
    const r = path.join(tmp, 'growrepo');
    const skill = write(path.join(r, '.claude', 'skills', 'x', 'SKILL.md'), '---\nname: x\n---\nsmall body');
    const list = discoverSlash(claudeSlashPlaces([r], path.join(tmp, 'growhome', '.claude'), path.join(tmp, 'growhome')));
    assert.ok(expandSlash('/x', list)?.text.includes('small body'));
    fs.writeFileSync(skill, '---\nname: x\n---\n' + 'a'.repeat(MAX_SLASH_BYTES + 1));
    assert.strictEqual(expandSlash('/x', list), undefined, 'over MAX_SLASH_BYTES on the re-read: the typed text is sent');
  });

  await test('safety (review on #535): a FIFO swapped in after discovery gives no expansion at once (no hang)', () => {
    if (process.platform === 'win32') return console.log('  (skipped on Windows: no mkfifo; the regular-file check still applies)');
    const r = path.join(tmp, 'fiforepo');
    write(path.join(r, '.claude', 'skills', 'f', 'SKILL.md'), '---\nname: f\n---\nbody');
    write(path.join(r, '.claude', 'commands', 'c.md'), 'body');
    const mod = path.join(__dirname, '..', 'src', 'adapters', 'slashcommands.js');
    // discovery, then the swap, then the send, in a child with a time limit: a blocking open would hang it, not this suite
    const code = `
      const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
      const S = require(${JSON.stringify(mod)});
      const r = ${JSON.stringify(r)};
      const list = S.discoverSlash(S.claudeSlashPlaces([r], path.join(r, 'nohome'), r));
      if (list.length !== 2) throw new Error('setup: ' + list.length);
      for (const f of [path.join(r, '.claude', 'skills', 'f', 'SKILL.md'), path.join(r, '.claude', 'commands', 'c.md')]) {
        fs.unlinkSync(f); execFileSync('mkfifo', [f]);
      }
      const a = S.expandSlash('/f hi', list), b = S.expandSlash('/c hi', list);
      process.stdout.write(JSON.stringify([a === undefined, b === undefined]));`;
    const t0 = Date.now();
    const res = execFileSync(process.execPath, ['-e', code], { timeout: 8000, encoding: 'utf8' });
    assert.deepStrictEqual(JSON.parse(res), [true, true], 'both FIFOs are refused');
    assert.ok(Date.now() - t0 < 8000);
  });

  await test('safety: oversized files, the per-directory cap and the total cap', () => {
    const r = path.join(tmp, 'caps');
    write(path.join(r, '.claude', 'commands', 'big.md'), 'x'.repeat(MAX_SLASH_BYTES + 1));
    write(path.join(r, '.claude', 'commands', 'small.md'), 'ok');
    assert.deepStrictEqual(discoverSlash(claudeSlashPlaces([r], path.join(tmp, 'none'), tmp)).map((e) => e.name), ['small']);
    const many = path.join(tmp, 'many');
    for (let i = 0; i < MAX_SLASH_PER_DIR + 20; i++) write(path.join(many, '.claude', 'commands', `c${String(i).padStart(3, '0')}.md`), 'x');
    assert.strictEqual(discoverSlash(claudeSlashPlaces([many], path.join(tmp, 'none'), tmp)).length, MAX_SLASH_PER_DIR);
    const places: SlashPlace[] = [];
    for (let k = 0; k < 4; k++) {
      const d = path.join(tmp, `tot${k}`);
      for (let i = 0; i < MAX_SLASH_PER_DIR; i++) write(path.join(d, 'cmds', `k${k}x${String(i).padStart(3, '0')}.md`), 'x');
      places.push({ dir: path.join(d, 'cmds'), root: d, scope: 'folder', kind: 'command', layout: 'md-files', whereBase: '' });
    }
    assert.strictEqual(discoverSlash(places).length, MAX_SLASH_FILES);
  });

  await test('expansion: placeholders, no placeholder, skills, user entries; built-ins and unknown names stay as typed', () => {
    const l = claudeList();
    assert.deepStrictEqual(expandSlash('/review-pr 42 look at tests', l), { text: 'Review PR 42 carefully. Notes: 42 look at tests', where: '.claude/commands/review-pr.md' });
    assert.strictEqual(expandSlash('/plain', l)!.text, 'Do the plain thing.');
    assert.strictEqual(expandSlash('/plain with words', l)!.text, 'Do the plain thing.\n\nARGUMENTS: with words');
    const sk = expandSlash('/release-notes for 1.2', l)!;
    assert.ok(sk.text.startsWith('Use the "release-notes" skill below. Its folder is '), sk.text);
    assert.ok(sk.text.includes('Collect the merged PRs.') && sk.text.endsWith('ARGUMENTS: for 1.2'));
    assert.ok(!sk.text.includes('description:'), 'front matter is not sent');
    assert.strictEqual(expandSlash('/mine a b', l)!.text, 'Mine a b');
    assert.strictEqual(expandSlash('/REVIEW-PR 1', l)!.where, '.claude/commands/review-pr.md', 'names match case-insensitively');
    assert.strictEqual(expandSlash('/compact', mergeSlash(l, cleanBuiltins([{ name: 'compact' }]))), undefined, 'a built-in is sent as typed');
    assert.strictEqual(expandSlash('/nope', l), undefined);
    assert.strictEqual(expandSlash('please /review-pr 1', l), undefined, 'only at the start of the message');
    assert.strictEqual(expandSlash('/review-pr\n2', l)!.text, 'Review PR 2 carefully. Notes: 2', 'a new line (Shift+Enter) also starts the arguments');
    assert.strictEqual(expandSlash('/review-prx', l), undefined, 'the whole name must match');
    // the file went away after listing
    const gone = path.join(tmp, 'gone');
    write(path.join(gone, '.claude', 'commands', 'temp.md'), 'temp');
    const gl = discoverSlash(claudeSlashPlaces([gone], path.join(tmp, 'none'), tmp));
    fs.rmSync(path.join(gone, '.claude', 'commands', 'temp.md'));
    assert.strictEqual(expandSlash('/temp', gl), undefined);
  });

  await test('Codex prompts are `prompts:<name>` and expand with $1..$9', () => {
    const ch = path.join(tmp, 'codexhome');
    write(path.join(ch, 'prompts', 'fix.md'), '---\ndescription: Fix an issue\nargument-hint: ISSUE\n---\nFix issue $1 in $2.');
    const l = discoverSlash(codexSlashPlaces([repo], ch, path.join(tmp, 'home')));
    const e = l.find((x) => x.name === 'prompts:fix')!;
    assert.ok(e && e.kind === 'prompt' && e.source === 'user' && e.argumentHint === 'ISSUE');
    assert.strictEqual(expandSlash('/prompts:fix 7 auth', l)!.text, 'Fix issue 7 in auth.');
  });

  await test('built-ins: only the FR-007 allow list; an unknown or new built-in is not offered; removed ones neither', () => {
    assert.deepStrictEqual([...BUILTIN_ALLOW].sort(), ['compact', 'context', 'cost', 'init', 'review', 'security-review']);
    // the old deny list and built-ins a later Claude Code may add: none of them is offered by default (constitution III)
    const others = ['config', 'permissions', 'model', 'effort', 'mcp', 'clear', 'rename', 'agents', 'login', 'resume', 'remote-control',
      'sandbox', 'add-dir', 'hooks', 'privacy-settings', 'design-sync', '__remote-workflow', 'brand-new-thing'];
    const raw = others.map((name) => ({ name, description: 'x' })).concat([
      { name: '/compact', description: 'Free up context' }, { name: 'context', description: 'Show context' }, { name: 'INIT', description: 'Init' },
      { name: 'review', description: '(removed) gone' }, { name: 'cost', description: 'Renamed to /usage' }, { name: 'bad name', description: 'x' },
    ]);
    const b = cleanBuiltins(raw);
    assert.deepStrictEqual(b.map((e) => e.name), ['compact', 'context', 'INIT']);
    assert.deepStrictEqual(cleanBuiltins([{ name: 'sandbox', description: 'Run in a sandbox' }]), [], 'an unknown built-in from the startup list is not offered');
    assert.ok(b.every((e) => e.source === 'app' && e.kind === 'builtin'));
    assert.deepStrictEqual(cleanBuiltins('nope'), []);
  });

  await test('what crosses to the window: no file, no absolute path, cut strings, at most 300', () => {
    const l = claudeList();
    const pub = publicSlash(l);
    assert.ok(pub.every((e) => !('file' in e) && !('root' in e) && !('dir' in e)));
    const odd = publicSlash([
      { name: 'a', source: 'folder', kind: 'command', where: '/etc/passwd' },
      { name: 'b', source: 'folder', kind: 'command', where: 'C:\\x' },
      { name: 'c', source: 'nope' as 'folder', kind: 'command' },
      { name: '../x', source: 'folder', kind: 'command' },
      { name: 'd', source: 'user', kind: 'skill', description: 'y'.repeat(500) },
    ]);
    assert.deepStrictEqual(odd.map((e) => [e.name, e.where]), [['a', undefined], ['b', undefined], ['d', undefined]]);
    assert.ok(odd[2].description!.length <= 200);
    assert.strictEqual(publicSlash(Array.from({ length: 400 }, (_, i) => ({ name: `n${i}`, source: 'folder' as const, kind: 'command' as const }))).length, MAX_SLASH_FILES);
  });

  await test('Claude adapter: files first, then the initialize built-ins (one probe for models and commands)', async () => {
    let probes = 0;
    const ad = new ClaudeAdapter({
      claudePath: async () => '/usr/bin/claude',
      configDir: cfg,
      sessionExists: () => false,
      claudeMd: () => undefined,
      env: () => ({}),
      makeTransport: (() => {
        probes++;
        return { request: async () => ({ models: [], commands: [{ name: 'compact', description: 'Free up context' }, { name: 'model', description: 'Set model' }, { name: 'sandbox', description: 'A new built-in' }, { name: 'review-pr', description: 'shadowed' }] }), close: async () => undefined };
      }) as unknown as ConstructorParameters<typeof ClaudeAdapter>[0]['makeTransport'],
    });
    const sid = await ad.start({ workspace: repo, quiet: true });
    const l = await ad.listSlashCommands(sid);
    assert.deepStrictEqual(l.map((e) => `${e.source}:${e.name}`), ['folder:release-notes', 'folder:plain', 'folder:review-pr', 'user:aa-skill', 'user:mine', 'app:compact']);
    await ad.listModelOptions();
    assert.strictEqual(probes, 1, 'the model list and the built-ins share one probe');
    assert.strictEqual((await ad.expandSlashCommand(sid, '/plain'))!.text, 'Do the plain thing.');
    assert.strictEqual(await ad.expandSlashCommand(sid, '/compact'), undefined);
    assert.deepStrictEqual(await ad.listSlashCommands('unknown'), []);
    // review on #535: a plain message reads nothing from disk (spied on the real fs; the call's synchronous part is the expansion)
    const realFsMod = require('fs') as Record<string, unknown>;
    const spied = ['readdirSync', 'openSync', 'readSync', 'statSync', 'lstatSync', 'realpathSync', 'fstatSync'];
    const saved = spied.map((k) => realFsMod[k]);
    let calls = 0;
    spied.forEach((k, i) => { realFsMod[k] = (...a: unknown[]) => { calls++; return (saved[i] as (...x: unknown[]) => unknown)(...a); }; });
    let plain: Promise<unknown>, named: Promise<unknown>;
    let plainCalls: number;
    try {
      plain = ad.expandSlashCommand(sid, 'hi');
      plainCalls = calls;
      calls = 0;
      named = ad.expandSlashCommand(sid, '/plain');
    } finally {
      spied.forEach((k, i) => { realFsMod[k] = saved[i]; });
    }
    assert.strictEqual(await plain, undefined);
    assert.strictEqual(plainCalls, 0, '"hi" reads nothing');
    assert.strictEqual(((await named) as { text: string }).text, 'Do the plain thing.');
    assert.ok(calls > 0 && calls < 20, `a warm "/plain" stats the places and reads its one file (${calls} calls)`);
  });

  await test('cache (review on #535): "hi" does no IO, a warm "/name" reads one file, renewed by a changed directory, age and refresh', () => {
    const real: SlashFs = { realpath: (p) => fs.realpathSync(p), lstat: (p) => fs.lstatSync(p), readdir: (p) => fs.readdirSync(p),
      readHead: (p, max) => fs.readFileSync(p, 'utf8').slice(0, max), mtime: (p) => fs.statSync(p).mtimeMs };
    const n = { realpath: 0, lstat: 0, readdir: 0, readHead: 0, mtime: 0 };
    const bump = new Map<string, number>();
    const spy: SlashFs = {
      realpath: (p) => (n.realpath++, real.realpath(p)), lstat: (p) => (n.lstat++, real.lstat(p)), readdir: (p) => (n.readdir++, real.readdir(p)),
      readHead: (p, m, l) => (n.readHead++, real.readHead(p, m, l)), mtime: (p) => (n.mtime++, real.mtime(p) + (bump.get(p) ?? 0)),
    };
    const reset = (): void => { for (const k of Object.keys(n) as (keyof typeof n)[]) n[k] = 0; };
    const total = (): number => Object.values(n).reduce((a, b) => a + b, 0);
    let t = 1000;
    const cache = new SlashCache({ fs: spy, now: () => t });
    const places = claudeSlashPlaces([repo], cfg, path.join(tmp, 'home'));
    let asked = 0;
    const get = (): SlashPlace[] => (asked++, places);
    for (const msg of ['hi', '', 'please /plain', '/usr/bin/env is here', '//x', 'hi\n/plain']) {
      assert.strictEqual(cache.expand(msg, get), undefined, msg);
    }
    assert.strictEqual(total(), 0, 'a message that is not "/name" causes no IO');
    assert.strictEqual(asked, 0, 'nor even builds the places');
    assert.strictEqual(slashLineName('  /plain  x'), 'plain');
    // cold: one discovery
    assert.strictEqual(cache.expand('/plain', get)!.text, 'Do the plain thing.');
    assert.ok(n.readdir > 0 && n.readHead > 1);
    // warm: no directory listing, one file read
    reset();
    assert.strictEqual(cache.expand('/plain go', get)!.text, 'Do the plain thing.\n\nARGUMENTS: go');
    assert.deepStrictEqual([n.readdir, n.lstat, n.readHead, n.mtime], [0, 0, 1, places.length]);
    reset();
    assert.strictEqual(cache.expand('/compact', get), undefined);
    assert.deepStrictEqual([n.readdir, n.readHead], [0, 0], 'a built-in or unknown name reads no file when warm');
    // a changed directory (new file): read again
    reset();
    bump.set(places[1].dir, 5);
    cache.expand('/plain', get);
    assert.ok(n.readdir > 0, 'a changed directory mtime renews the discovery');
    // age: after 30 s, read again
    reset();
    cache.expand('/plain', get);
    assert.strictEqual(n.readdir, 0);
    t += 30_001;
    cache.expand('/plain', get);
    assert.ok(n.readdir > 0, 'a discovery older than 30 s is renewed');
    // the window opening its list always reads afresh
    reset();
    cache.list(places, { refresh: true });
    assert.ok(n.readdir > 0);
    reset();
    cache.list(places);
    assert.strictEqual(n.readdir, 0, 'without refresh a fresh discovery is reused');
    // a missing place directory is stamped too (an added .claude/skills folder renews it)
    const r2 = path.join(tmp, 'noskills');
    write(path.join(r2, '.claude', 'commands', 'one.md'), 'One.');
    const p2 = claudeSlashPlaces([r2], path.join(tmp, 'none'), tmp);
    cache.list(p2);
    write(path.join(r2, '.claude', 'skills', 'two', 'SKILL.md'), 'Two.');
    assert.ok(cache.list(p2).some((e) => e.name === 'two'), 'a place directory that appears renews the discovery');
  });

  await test('Codex adapter: lists the folder skills and CODEX_HOME prompts of its session', async () => {
    const ch = path.join(tmp, 'codexhome2');
    write(path.join(ch, 'prompts', 'p1.md'), 'P1 $ARGUMENTS');
    const r = path.join(tmp, 'cxrepo');
    write(path.join(r, '.agents', 'skills', 'cx-skill', 'SKILL.md'), '---\ndescription: Codex skill\n---\nbody');
    const ad = new CodexAdapter({ env: { CODEX_HOME: ch } }) as unknown as { sessions: Map<string, { roots: string[] }>; listSlashCommands(id: string): Promise<{ name: string; source: string }[]>; expandSlashCommand(id: string, t: string): Promise<{ text: string } | undefined> };
    ad.sessions.set('s1', { roots: [r] });
    const l = await ad.listSlashCommands('s1');
    assert.deepStrictEqual(l.map((e) => `${e.source}:${e.name}`).filter((x) => /cx-skill|p1/.test(x)), ['folder:cx-skill', 'user:prompts:p1']);
    assert.strictEqual((await ad.expandSlashCommand('s1', '/prompts:p1 go'))!.text, 'P1 go');
  });

  await test('renderer helpers (slashsuggest.js): word at the caret, filter, insert', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'slashsuggest.js'), 'utf8');
    const ctx: { DurbarSlash?: Record<string, (...a: unknown[]) => unknown> } = {};
    vm.createContext(ctx);
    // like the page: no `module`, the APIs land on the global object; the shared matcher (navigator.js) is there too
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'navigator.js'), 'utf8'), ctx);
    vm.runInContext(src, ctx);
    // results come from another realm: compare them as plain JSON
    const S = Object.fromEntries(Object.entries(ctx.DurbarSlash!).map(([k, f]) => [k, typeof f === 'function' ? (...a: unknown[]) => JSON.parse(JSON.stringify(f(...a) ?? null)) : f])) as Record<string, (...a: unknown[]) => unknown>;
    assert.deepStrictEqual(S.tokenAt('/', 1), { start: 0, query: '' });
    assert.deepStrictEqual(S.tokenAt('hello /re', 9), { start: 6, query: 're' });
    assert.deepStrictEqual(S.tokenAt('a\n/x', 4), { start: 2, query: 'x' });
    assert.strictEqual(S.tokenAt('http://x', 8), null, 'not inside a word or a URL');
    assert.strictEqual(S.tokenAt('a/b', 3), null);
    assert.strictEqual(S.tokenAt('/re view', 8), null, 'the word ended');
    assert.strictEqual(S.tokenAt('/re', 1), null, 'the caret must be at the end of the word');
    const entries = [
      { name: 'review-pr', source: 'folder', kind: 'command' }, { name: 'release-notes', source: 'folder', kind: 'skill' },
      { name: 'mine', source: 'user', kind: 'command' }, { name: 'compact', source: 'app', kind: 'builtin' }, { name: 'pre-release', source: 'user', kind: 'skill' },
    ];
    assert.deepStrictEqual((S.filter(entries, '') as { name: string }[]).map((e) => e.name), ['review-pr', 'release-notes', 'mine', 'pre-release', 'compact'], 'folder, user, app');
    assert.deepStrictEqual((S.filter(entries, 'rel') as { name: string }[]).map((e) => e.name), ['release-notes', 'pre-release'], 'prefix matches first, then others');
    assert.deepStrictEqual((S.filter(entries, 'zzz') as unknown[]), []);
    // the shared matcher (DurbarNav.rank): a word of the name before a name that only contains the text, then the description
    const more = [
      { name: 'mynotes', source: 'folder', kind: 'command' }, { name: 'release-notes', source: 'folder', kind: 'skill' },
      { name: 'zz', source: 'user', kind: 'command', description: 'Takes notes' }, { name: 'notes', source: 'app', kind: 'builtin' },
    ];
    assert.deepStrictEqual((S.filter(more, 'notes') as { name: string }[]).map((e) => e.name), ['notes', 'release-notes', 'mynotes', 'zz']);
    // the option row escapes every field (FR-008, the XSS guard)
    const bad = '<img src=x onerror=alert(1)>"><b>&';
    const html = String(S.optionHtml({ name: 'ok', description: bad, argumentHint: bad, source: 'folder', kind: 'command' }, 0, true, bad));
    const html2 = String(S.optionHtml({ name: bad, source: bad, kind: bad }, '1" onclick="x', false, ''));
    for (const h of [html, html2]) {
      assert.ok(!/<img|<b>|onerror=alert\(1\)>|" onclick=/.test(h.replace(/<b class="sl-name">/g, '')), 'no element or attribute from the entry');
      assert.ok(h.includes('&lt;img src=x onerror=alert(1)&gt;&quot;&gt;&lt;b&gt;&amp;'), 'the text shows literally');
    }
    assert.ok(html.includes('aria-selected="true"') && html.includes('id="slashOpt-0"'));
    assert.deepStrictEqual(S.insert('hello /re', 6, 9, 'review-pr'), { value: 'hello /review-pr ', caret: 17 });
    assert.deepStrictEqual(S.insert('/re tail', 0, 3, 'review-pr'), { value: '/review-pr tail', caret: 11 }, 'no double space before existing text');
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nslash commands: ${passed} checks passed`);
}

main().catch((e) => {
  console.error(e);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(1);
});
