/**
 * Profile files (spec 043 FR-010..FR-013, T012a): main lists, reads and writes custom agent files by id only. Path escapes (a
 * crafted id, a name with `..` or a separator, a symbolic link out of an agent folder, a linked `.github`), the size cap, the
 * atomic save round trip in a temp folder with line endings and BOM kept, the external-change conflict, overwrite, create and
 * read-only files. `npm run test:profilefiles`. No Electron, no agent app, no credits.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseClaudeAgent } from '../src/adapters/claudeAgents';
import { DEFAULT_TEMPLATE, PROFILE_TEMPLATES, profileTemplate, SUCCESS_SECTIONS } from '../src/shared/profiletemplates';
import { createProfileFile, encodeLike, fileIdOf, folderIdOf, headOf, listProfileFiles, MAX_PROFILE_BYTES, pathOfProfile, profileDirs, profileFolders, readProfileFile, saveProfileFile } from '../src/main/profilefiles';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-profilefiles-'));
const WS = path.join(tmp, 'ws');
const HOME = path.join(tmp, 'home');
const CLAUDE = path.join(HOME, '.claude');
const OUTSIDE = path.join(tmp, 'outside');
for (const d of [path.join(WS, '.github', 'agents'), path.join(WS, '.claude', 'agents'), path.join(HOME, '.copilot', 'agents'), OUTSIDE]) fs.mkdirSync(d, { recursive: true });
const env = { home: HOME, claudeConfigDir: CLAUDE };
const dirs = () => profileDirs([WS], env);
const canLink = (() => {
  try {
    fs.symlinkSync(path.join(OUTSIDE), path.join(tmp, 'probe-link'), 'dir');
    fs.unlinkSync(path.join(tmp, 'probe-link'));
    return true;
  } catch {
    return false; // Windows without the symlink right: the link cases are skipped and said so
  }
})();

// the folders are the adapters' own: Copilot .github/agents and ~/.copilot/agents, Claude .claude/agents and <config>/agents
{
  const d = dirs();
  assert.deepStrictEqual(d.map((x) => `${x.app}:${x.scope}:${path.relative(tmp, x.dir).replace(/\\/g, '/')}`), ['copilot:folder:ws/.github/agents', 'copilot:user:home/.copilot/agents', 'claude:folder:ws/.claude/agents', 'claude:user:home/.claude/agents']);
  assert.deepStrictEqual(profileDirs(['relative/path'], env).filter((x) => x.scope === 'folder'), [], 'relative folders are ignored');
}

// list: front matter name and description, file name, writable; non-md and dot files skipped
const REV = path.join(WS, '.github', 'agents', 'reviewer.agent.md');
fs.writeFileSync(REV, '---\r\nname: Reviewer\r\ndescription: "Reviews changes"\r\ntools: [view, grep]\r\n---\r\n\r\nYou review.\r\n');
fs.writeFileSync(path.join(WS, '.github', 'agents', 'notes.txt'), 'x');
fs.writeFileSync(path.join(WS, '.github', 'agents', '.hidden.md'), 'x');
fs.writeFileSync(path.join(HOME, '.copilot', 'agents', 'docs.agent.md'), '# no front matter\n');
{
  const list = listProfileFiles(dirs());
  assert.deepStrictEqual(list.map((f) => f.fileName).sort(), ['docs.agent.md', 'reviewer.agent.md']);
  const r = list.find((f) => f.fileName === 'reviewer.agent.md')!;
  assert.strictEqual(r.name, 'Reviewer');
  assert.strictEqual(r.description, 'Reviews changes');
  assert.strictEqual(r.app, 'copilot');
  assert.strictEqual(r.scope, 'folder');
  assert.strictEqual(r.folder, WS);
  assert.strictEqual(r.id, fileIdOf(REV));
  assert.match(r.id, /^[0-9a-f]{32}$/);
  assert.strictEqual(list.find((f) => f.fileName === 'docs.agent.md')!.name, 'docs', 'no front matter: the file name');
  assert.deepStrictEqual(headOf('---\nname: a\u0007b\n---\n'), { name: 'a b' }, 'control characters become spaces');
}

// read: by id only, LF text without BOM, CRLF noted, sha256 of the bytes
const revId = fileIdOf(REV);
{
  const r = readProfileFile(dirs(), revId);
  assert.ok(r.ok);
  if (!r.ok) throw new Error();
  assert.strictEqual(r.eol, 'crlf');
  assert.ok(!r.text.includes('\r'), 'the editor gets LF');
  assert.ok(r.text.startsWith('---\nname: Reviewer'));
  for (const bad of [REV, '../../etc/passwd', 'x'.repeat(32), revId.toUpperCase(), 42, null, { id: revId }]) {
    const x = readProfileFile(dirs(), bad);
    assert.strictEqual(x.ok, false, `refused: ${String(bad)}`);
  }
  assert.strictEqual(pathOfProfile(dirs(), REV), undefined, 'a path is never accepted as an id');
  assert.strictEqual(readProfileFile(profileDirs([], env), revId).ok, false, 'a folder no longer in the office: the id no longer resolves');
}

// save round trip in the temp folder: atomic (no temp file left), CRLF kept, a BOM kept, the new hash returned
{
  const r = readProfileFile(dirs(), revId);
  if (!r.ok) throw new Error('read');
  const s = saveProfileFile(dirs(), revId, r.text.replace('You review.', 'You review carefully.'), r.sha256, false);
  assert.ok(s.ok, JSON.stringify(s));
  const disk = fs.readFileSync(REV, 'utf8');
  assert.ok(disk.includes('You review carefully.\r\n'), 'CRLF kept');
  assert.ok(!/[^\r]\n/.test(disk), 'no bare LF');
  assert.deepStrictEqual(fs.readdirSync(path.dirname(REV)).filter((n) => n.endsWith('.tmp')), [], 'no temp file left');
  if (s.ok) {
    const again = saveProfileFile(dirs(), revId, 'second', s.sha256, false);
    assert.ok(again.ok, 'the returned hash is the new base');
  }
  const bom = encodeLike('a\nb\n', Buffer.from('﻿x\r\ny\r\n', 'utf8')).toString('utf8');
  assert.strictEqual(bom, '﻿a\r\nb\r\n', 'BOM and CRLF kept');
  assert.strictEqual(encodeLike('a\r\nb', Buffer.from('x\ny', 'utf8')).toString('utf8'), 'a\nb', 'LF file stays LF');
}

// conflict: changed elsewhere since it was read -> nothing written; overwrite writes; a removed file is a conflict
{
  const r = readProfileFile(dirs(), revId);
  if (!r.ok) throw new Error('read');
  fs.writeFileSync(REV, 'changed by another editor\n');
  const s = saveProfileFile(dirs(), revId, 'mine\n', r.sha256, false);
  assert.ok(!s.ok && s.conflict, 'conflict on external change');
  assert.strictEqual(fs.readFileSync(REV, 'utf8'), 'changed by another editor\n', 'nothing written');
  assert.ok(!saveProfileFile(dirs(), revId, 'mine\n', undefined, false).ok, 'no base hash: conflict');
  const o = saveProfileFile(dirs(), revId, 'mine\n', r.sha256, true);
  assert.ok(o.ok, 'overwrite');
  assert.strictEqual(fs.readFileSync(REV, 'utf8'), 'mine\n');
  const gone = path.join(WS, '.github', 'agents', 'gone.agent.md');
  fs.writeFileSync(gone, 'x\n');
  const g = readProfileFile(dirs(), fileIdOf(gone));
  fs.unlinkSync(gone);
  const sg = saveProfileFile(dirs(), fileIdOf(gone), 'y', g.ok ? g.sha256 : '', false);
  assert.ok(!sg.ok && sg.conflict, 'a removed file is a conflict');
  assert.ok(!fs.existsSync(gone), 'and is not written back');
}

// size cap on read and save
{
  const big = path.join(WS, '.github', 'agents', 'big.agent.md');
  fs.writeFileSync(big, 'x'.repeat(MAX_PROFILE_BYTES + 1));
  const info = listProfileFiles(dirs()).find((f) => f.fileName === 'big.agent.md')!;
  assert.ok(info.tooBig && !info.writable && info.note);
  assert.strictEqual(readProfileFile(dirs(), info.id).ok, false, 'too big to open');
  const r = readProfileFile(dirs(), revId);
  if (!r.ok) throw new Error('read');
  const s = saveProfileFile(dirs(), revId, 'y'.repeat(MAX_PROFILE_BYTES + 1), r.sha256, false);
  assert.ok(!s.ok && !s.conflict, 'too big to save');
  fs.unlinkSync(big);
}

const W0 = folderIdOf(WS);
// create: name rules, place = folder id or user, exclusive, template, Copilot .agent.md / Claude .md, folder made inside the office folder
{
  for (const bad of ['../x', 'a/b', 'a\\b', '..', '.hidden', '', 'x'.repeat(65), 'a b', 'ok\0', 42]) {
    const r = createProfileFile(dirs(), 'claude', W0, bad);
    assert.ok(!r.ok, `name refused: ${JSON.stringify(bad)}`);
  }
  assert.ok(!createProfileFile(dirs(), 'codex', W0, 'x').ok, 'unknown app');
  assert.ok(!createProfileFile(dirs(), 'claude', 0, 'x').ok, 'an index is not a place any more (review on #488)');
  assert.ok(!createProfileFile(dirs(), 'claude', 'f'.repeat(32), 'x').ok, 'an unknown folder id is refused');
  assert.ok(!createProfileFile(dirs(), 'claude', WS, 'x').ok, 'a path is not a place');
  const c = createProfileFile(dirs(), 'claude', W0, 'helper');
  assert.ok(c.ok, JSON.stringify(c));
  const file = path.join(WS, '.claude', 'agents', 'helper.md');
  assert.ok(fs.readFileSync(file, 'utf8').startsWith('---\nname: helper\ndescription: '));
  assert.ok(!createProfileFile(dirs(), 'claude', W0, 'helper').ok, 'exists: refused');
  fs.rmSync(path.join(HOME, '.copilot', 'agents'), { recursive: true, force: true });
  const u = createProfileFile(dirs(), 'copilot', 'user', 'mine');
  assert.ok(u.ok && fs.existsSync(path.join(HOME, '.copilot', 'agents', 'mine.agent.md')), 'user folder created when missing');
  if (u.ok) assert.strictEqual(readProfileFile(dirs(), u.id).ok, true, 'the new id opens');
}

// review on #488: the form's folder is an id (a hash of the path), checked against the office's folders at create time
{
  const A = path.join(tmp, 'fa');
  const B = path.join(tmp, 'fb');
  fs.mkdirSync(A);
  fs.mkdirSync(B);
  const open1 = profileFolders(profileDirs([A, 'relative/x', B], env)); // the list the form opened with: relative paths dropped
  assert.deepStrictEqual(open1.map((f) => f.path), [A, B], 'only absolute folders are offered, in order');
  assert.ok(open1.every((f) => /^[0-9a-f]{32}$/.test(f.id)) && open1[0].id !== open1[1].id, 'one id per folder');
  const idB = open1[1].id;
  // a session in A ends while the form is open: index 1 would now be nothing (or another folder); the id still means B
  const nowB = createProfileFile(profileDirs([B], env), 'claude', idB, 'stays');
  assert.ok(nowB.ok && fs.existsSync(path.join(B, '.claude', 'agents', 'stays.md')), 'the file goes to the folder that was shown');
  assert.ok(!fs.existsSync(path.join(A, '.claude')), 'and nothing goes to another folder');
  // a folder added in front shifts every index; the id does not move
  const C = path.join(tmp, 'fc');
  fs.mkdirSync(C);
  const shifted = createProfileFile(profileDirs([C, A, B], env), 'copilot', idB, 'still');
  assert.ok(shifted.ok && fs.existsSync(path.join(B, '.github', 'agents', 'still.agent.md')) && !fs.existsSync(path.join(C, '.github')), 'an added folder does not change where it goes');
  // the folder left the office while the form was open: refused, nothing written
  const gone = createProfileFile(profileDirs([A, C], env), 'claude', idB, 'nope');
  assert.ok(!gone.ok && /not in the office/.test(gone.error), 'a folder that left the office is refused');
  assert.ok(!fs.existsSync(path.join(A, '.claude')) && !fs.existsSync(path.join(C, '.claude')), 'and nothing is written elsewhere');
}

// read-only file: listed, opens, cannot be saved (POSIX permissions; root can write anyway, so only checked when it really is read-only)
if (process.platform !== 'win32') {
  const ro = path.join(WS, '.github', 'agents', 'ro.agent.md');
  fs.writeFileSync(ro, 'read only\n');
  fs.chmodSync(ro, 0o444);
  let realRo = true;
  try {
    fs.accessSync(ro, fs.constants.W_OK);
    realRo = false;
  } catch {
    /* read-only as expected */
  }
  if (realRo) {
    const info = listProfileFiles(dirs()).find((f) => f.fileName === 'ro.agent.md')!;
    assert.ok(!info.writable && info.note);
    const r = readProfileFile(dirs(), info.id);
    assert.ok(r.ok, 'opens');
    if (r.ok) assert.ok(!saveProfileFile(dirs(), info.id, 'x', r.sha256, true).ok, 'not saved, even with overwrite');
    assert.strictEqual(fs.readFileSync(ro, 'utf8'), 'read only\n');
  }
  fs.chmodSync(ro, 0o644);
  fs.unlinkSync(ro);
}

// templates (FR-018): both kinds for both apps parse with no front matter error, Claude's discovery accepts the Claude ones, the
// Agent Success Profile has its eight sections in order, the default is the Agent Success Profile, and no paths or secrets
{
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const PE = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'profileeditor.js')) as { parseFrontmatter(t: string): { closed: boolean; errors: unknown[]; entries: { key: string; value: string }[] } };
  assert.strictEqual(DEFAULT_TEMPLATE, 'success');
  assert.deepStrictEqual(PROFILE_TEMPLATES.map((t) => t.id), ['success', 'standard'], 'the default is listed first');
  for (const app of ['copilot', 'claude'] as const) {
    for (const kind of ['success', 'standard'] as const) {
      const t = profileTemplate(app, 'helper-1', kind);
      const fm = PE.parseFrontmatter(t);
      assert.ok(fm.closed && fm.errors.length === 0, `${app}/${kind}: front matter parses ${JSON.stringify(fm.errors)}`);
      const v = Object.fromEntries(fm.entries.map((e) => [e.key, e.value]));
      assert.strictEqual(v.name, 'helper-1');
      assert.ok(v.description && v.tools, `${app}/${kind}: description and tools`);
      assert.match(v.tools, app === 'claude' ? /^Read, Grep, Glob$/ : /^view, grep, glob$/, 'read-only tools only');
      assert.ok(!/[~\\]|\/[a-z]|https?:|token|secret|password|api[_-]?key/i.test(t), `${app}/${kind}: no paths, URLs or secrets`);
      if (app === 'claude') {
        const def = parseClaudeAgent(t, 'helper-1.md', 'repo');
        assert.ok(def && def.profile.id === 'helper-1' && def.prompt.length > 20, `${kind}: Claude Code discovery accepts it`);
        assert.deepStrictEqual(def!.profile.tools, ['Read', 'Grep', 'Glob']);
      }
      if (kind === 'success') {
        const heads = [...t.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
        assert.deepStrictEqual(heads, SUCCESS_SECTIONS.map((s) => s.heading), 'the eight sections in order');
        assert.ok(t.includes('# Agent Success Profile: helper-1'));
      }
    }
  }
  const std = createProfileFile(dirs(), 'claude', W0, 'plain', 'standard');
  assert.ok(std.ok && !fs.readFileSync(path.join(WS, '.claude', 'agents', 'plain.md'), 'utf8').includes('## Behaviors'), 'Standard agent template written');
  const def = createProfileFile(dirs(), 'claude', W0, 'asp');
  assert.ok(def.ok && fs.readFileSync(path.join(WS, '.claude', 'agents', 'asp.md'), 'utf8').includes('## Key Success Criteria'), 'no template given: the Agent Success Profile');
  assert.ok(!createProfileFile(dirs(), 'claude', W0, 'odd', 'evil').ok, 'unknown template refused');
}

// symbolic links: a file linking out is not listed; a link inside is read-only; a .claude that links out of the folder is ignored
if (canLink) {
  fs.writeFileSync(path.join(OUTSIDE, 'secret.md'), '---\nname: secret\n---\nsecret\n');
  fs.symlinkSync(path.join(OUTSIDE, 'secret.md'), path.join(WS, '.github', 'agents', 'escape.agent.md'));
  fs.symlinkSync(REV, path.join(WS, '.github', 'agents', 'alias.agent.md'));
  const list = listProfileFiles(dirs());
  assert.ok(!list.some((f) => f.fileName === 'escape.agent.md'), 'a link out of the agent folder is not listed');
  assert.strictEqual(readProfileFile(dirs(), fileIdOf(path.join(WS, '.github', 'agents', 'escape.agent.md'))).ok, false, 'and its id does not open');
  const alias = list.find((f) => f.fileName === 'alias.agent.md')!;
  assert.ok(alias && !alias.writable && /link/i.test(alias.note || ''), 'a link inside: read-only');
  const r = readProfileFile(dirs(), alias.id);
  if (r.ok) assert.ok(!saveProfileFile(dirs(), alias.id, 'x', r.sha256, true).ok, 'a link is never written');
  // a linked .claude folder that points outside the office folder
  const WS2 = path.join(tmp, 'ws2');
  fs.mkdirSync(WS2);
  fs.mkdirSync(path.join(OUTSIDE, 'agents'));
  fs.writeFileSync(path.join(OUTSIDE, 'agents', 'x.md'), '---\nname: x\n---\nx\n');
  fs.symlinkSync(OUTSIDE, path.join(WS2, '.claude'), 'dir');
  const WS3 = path.join(tmp, 'ws3');
  fs.mkdirSync(WS3);
  fs.symlinkSync(path.join(OUTSIDE, 'nothere'), path.join(WS3, '.github'), 'dir'); // dangling link: mkdir would follow it
  assert.ok(!createProfileFile(profileDirs([WS3], env), 'copilot', folderIdOf(WS3), 'z').ok, 'a dangling linked .github is refused');
  assert.ok(!fs.existsSync(path.join(OUTSIDE, 'nothere')), 'and nothing was made outside');
  const d2 = profileDirs([WS2], env);
  assert.ok(!listProfileFiles(d2).some((f) => f.folder === WS2), 'files behind a linked .claude are not listed');
  assert.ok(!createProfileFile(d2, 'claude', folderIdOf(WS2), 'y').ok, 'and nothing is created through it');
  assert.ok(!fs.existsSync(path.join(OUTSIDE, 'agents', 'y.md')));
  // a linked home folder for the user scope is fine (dotfiles setups): the agent folder itself is the root
  console.log('symlink cases checked');
} else console.log('symlink cases skipped: this account cannot create symbolic links');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('profile file tests passed');
