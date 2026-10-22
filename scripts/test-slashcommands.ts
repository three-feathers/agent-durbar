/**
 * Spec 072: the composer's "/" entries. `npm run test:slashcommands`. No Electron, no network, no credits.
 *
 *  - front matter, names, `user-invocable: false`, de-duplication and order (folder, user, app);
 *  - the places of each app (Claude Code, Copilot, Codex), also as Windows paths;
 *  - safety: symbolic links out of a folder or user directory, oversized files, the per-directory and total caps, bad names;
 *  - expansion: `$ARGUMENTS`, `$1`..`$9`, no placeholder, skills, built-ins and unknown names left alone, a vanished file;
 *  - the built-in filter (FR-007) and what crosses to the window (`publicSlash`);
 *  - the Claude adapter merges files with the probe's built-ins; the Copilot and Codex adapters list their places;
 *  - the renderer's pure helpers (`slashsuggest.js`): the word at the caret, filtering, insertion.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import {
  BUILTIN_DENY, MAX_SLASH_BYTES, MAX_SLASH_FILES, MAX_SLASH_PER_DIR, claudeSlashPlaces, cleanBuiltins, codexSlashPlaces, copilotSlashPlaces,
  discoverSlash, displayBase, expandSlash, mergeSlash, parseFrontMatter, publicSlash,
} from '../src/adapters/slashcommands';
import type { SlashPlace } from '../src/adapters/slashcommands';
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
    const cp = copilotSlashPlaces(['/w/a'], '/h').map((p) => p.dir.split(path.sep).join('/'));
    assert.deepStrictEqual(cp.map((d) => d.replace(/^[A-Za-z]:/, '')), ['/w/a/.github/skills', '/w/a/.claude/skills', '/w/a/.agents/skills', '/h/.copilot/skills', '/h/.agents/skills']);
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

  await test('built-ins: the FR-007 list is never offered; removed and renamed ones neither', () => {
    const raw = [...BUILTIN_DENY].map((name) => ({ name, description: 'x' })).concat([
      { name: 'compact', description: 'Free up context' }, { name: 'context', description: 'Show context' }, { name: 'init', description: 'Init' },
      { name: 'design-sync', description: 'x' }, { name: '__remote-workflow', description: 'x' }, { name: 'extra', description: 'Renamed to /usage-credits' },
      { name: 'old', description: '(removed) gone' }, { name: 'bad name', description: 'x' },
    ]);
    const b = cleanBuiltins(raw);
    assert.deepStrictEqual(b.map((e) => e.name), ['compact', 'context', 'init']);
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
        return { request: async () => ({ models: [], commands: [{ name: 'compact', description: 'Free up context' }, { name: 'model', description: 'Set model' }, { name: 'review-pr', description: 'shadowed' }] }), close: async () => undefined };
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
    vm.runInNewContext(src, ctx); // like the page: no `module`, the API lands on the global object
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
