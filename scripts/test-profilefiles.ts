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
import { listClaudeAgents, MAX_AGENT_BYTES, parseClaudeAgent } from '../src/adapters/claudeAgents';
import { DEFAULT_TEMPLATE, PROFILE_TEMPLATES, profileTemplate, SAFETY_LINES, SUCCESS_SECTIONS } from '../src/shared/profiletemplates';
import { atomicOps, deleteOps, createProfileFile, createProfileFreshness, defaultProfileEnv, listAgentProfilesFresh, deleteProfileFile, encodeLike, fileIdOf, folderIdOf, headOf, isProfileName, listProfileFiles, maxBytesFor, MAX_PROFILE_BYTES, pathOfProfile, profileDirs, profileFolders, readProfileFile, saveProfileFile, userAgentDirs } from '../src/main/profilefiles';

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

// review on #488 (change 7): CLAUDE_CONFIG_DIR moves the Claude user folder, and profiles:listFiles hands the real user folders to the New profile hint
{
  const CFG = path.join(tmp, 'cfg');
  assert.strictEqual(defaultProfileEnv({ CLAUDE_CONFIG_DIR: CFG }, HOME).claudeConfigDir, CFG, 'CLAUDE_CONFIG_DIR is used');
  assert.strictEqual(defaultProfileEnv({}, HOME).claudeConfigDir, path.join(HOME, '.claude'), 'without it: ~/.claude');
  const d = profileDirs([WS], { home: HOME, claudeConfigDir: CFG });
  assert.strictEqual(d.find((x) => x.app === 'claude' && x.scope === 'user')!.dir, path.join(CFG, 'agents'), 'the Claude user folder follows the config dir');
  assert.deepStrictEqual(userAgentDirs(d), { copilot: path.join(HOME, '.copilot', 'agents'), claude: path.join(CFG, 'agents') }, 'the user folders for the hint');
  assert.deepStrictEqual(userAgentDirs(profileDirs([], env)), { copilot: path.join(HOME, '.copilot', 'agents'), claude: path.join(CLAUDE, 'agents') });
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
  const ino0 = fs.statSync(REV).ino;
  const s = saveProfileFile(dirs(), revId, r.text.replace('You review.', 'You review carefully.'), r.sha256, false);
  assert.ok(s.ok, JSON.stringify(s));
  // review on #488 (change 3): a new file was renamed over the old one, not written in place (POSIX inode; Windows has no stable one here)
  if (process.platform !== 'win32') assert.notStrictEqual(fs.statSync(REV).ino, ino0, 'the save renamed a new file over the original (atomic)');
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

// review on #488 (change 3): a rename that fails leaves the original bytes and no temporary file
{
  const r = readProfileFile(dirs(), revId);
  if (!r.ok) throw new Error('read');
  const before = fs.readFileSync(REV);
  const rename = atomicOps.rename;
  let called = 0;
  atomicOps.rename = () => {
    called++;
    throw new Error('EBUSY: simulated');
  };
  try {
    const s = saveProfileFile(dirs(), revId, 'replaced text\n', r.sha256, false);
    assert.ok(!s.ok && !s.conflict, 'a failed rename is a failed save');
  } finally {
    atomicOps.rename = rename;
  }
  assert.strictEqual(called, 1, 'the save goes through the rename');
  assert.ok(fs.readFileSync(REV).equals(before), 'the original bytes are untouched');
  assert.deepStrictEqual(fs.readdirSync(path.dirname(REV)).filter((n) => n.endsWith('.tmp')), [], 'and the temporary file is removed');
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

// review on #488 (change 4): the cap is checked on the bytes written (CRLF and BOM restored), so a save never makes a file too big to reopen
{
  const crlf = path.join(WS, '.github', 'agents', 'crlf.agent.md');
  const orig = Buffer.from('\ufeff---\r\nname: c\r\n---\r\n\r\nshort\r\n', 'utf8');
  fs.writeFileSync(crlf, orig);
  const id = fileIdOf(crlf);
  const r = readProfileFile(dirs(), id);
  if (!r.ok) throw new Error('read');
  const lines = Math.floor(MAX_PROFILE_BYTES / 2) - 8; // as LF text a little under the cap; with CRLF and the BOM over it
  const over = 'x\n'.repeat(lines);
  assert.ok(Buffer.byteLength(over) <= MAX_PROFILE_BYTES && encodeLike(over, orig).length > MAX_PROFILE_BYTES, 'fixture: under the cap as LF text, over it as the file');
  const s = saveProfileFile(dirs(), id, over, r.sha256, false);
  assert.ok(!s.ok && !s.conflict && /larger than 256 KB/.test(s.error), 'refused: the file would pass the cap');
  assert.ok(fs.readFileSync(crlf).equals(orig), 'nothing written');
  assert.deepStrictEqual(fs.readdirSync(path.dirname(crlf)).filter((n) => n.endsWith('.tmp')), [], 'no temp file');
  const fits = 'x\n'.repeat(Math.floor((MAX_PROFILE_BYTES - 3) / 3)); // CRLF + BOM: exactly within the cap
  assert.ok(encodeLike(fits, orig).length <= MAX_PROFILE_BYTES);
  const ok = saveProfileFile(dirs(), id, fits, r.sha256, false);
  assert.ok(ok.ok, 'a file that fits once encoded saves');
  assert.strictEqual(readProfileFile(dirs(), id).ok, true, 'and opens again');
  fs.unlinkSync(crlf);
}

// review on #488 (change 5): Claude Code files use the Claude adapter's cap (64 KB), so the editor never keeps a file the Profile menu then drops
{
  assert.strictEqual(maxBytesFor('claude'), MAX_AGENT_BYTES, 'one constant: the adapter\'s');
  assert.strictEqual(maxBytesFor('copilot'), MAX_PROFILE_BYTES);
  const head = '---\nname: big65\ndescription: d\n---\n\n';
  const c65 = path.join(WS, '.claude', 'agents', 'big65.md');
  fs.writeFileSync(c65, head + 'x'.repeat(65 * 1024 - head.length));
  const info = listProfileFiles(dirs()).find((f) => f.fileName === 'big65.md')!;
  assert.ok(info.tooBig && !info.writable && /Claude Code does not load it/.test(info.note || ''), 'a 65 KB Claude file is listed with a warning, not editable');
  assert.strictEqual(readProfileFile(dirs(), info.id).ok, false, 'and does not open here');
  assert.ok(!listClaudeAgents([WS], CLAUDE).some((a) => a.profile.id === 'big65'), 'the adapter skips it too (same cap)');
  fs.unlinkSync(c65);
  const cop65 = path.join(WS, '.github', 'agents', 'big65.agent.md');
  fs.writeFileSync(cop65, head + 'x'.repeat(65 * 1024 - head.length));
  const ci = listProfileFiles(dirs()).find((f) => f.fileName === 'big65.agent.md')!;
  assert.ok(!ci.tooBig && ci.writable, 'a 65 KB Copilot file is fine (256 KB cap)');
  fs.unlinkSync(cop65);
  // saving a small Claude file up to 65 KB is refused; exactly 64 KB saves and stays in the adapter's list
  const small = path.join(WS, '.claude', 'agents', 'grow.md');
  fs.writeFileSync(small, '---\nname: grow\ndescription: d\n---\n\nx\n');
  const gid = fileIdOf(small);
  const g = readProfileFile(dirs(), gid);
  if (!g.ok) throw new Error('read');
  const before = fs.readFileSync(small);
  const s = saveProfileFile(dirs(), gid, head.replace('big65', 'grow') + 'x'.repeat(65 * 1024), g.sha256, false);
  assert.ok(!s.ok && /Claude Code does not load/.test(s.error), 'a Claude file over 64 KB is not saved');
  assert.ok(fs.readFileSync(small).equals(before), 'nothing written');
  const h2 = head.replace('big65', 'grow');
  const s64 = saveProfileFile(dirs(), gid, h2 + 'x'.repeat(MAX_AGENT_BYTES - Buffer.byteLength(h2)), g.sha256, false);
  assert.ok(s64.ok, 'exactly 64 KB saves');
  assert.ok(listClaudeAgents([WS], CLAUDE).some((a) => a.profile.id === 'grow'), 'and Claude Code still loads it');
  fs.unlinkSync(small);
}

const W0 = folderIdOf(WS);
// create: name rules, place = folder id or user, exclusive, template, Copilot .agent.md / Claude .md, folder made inside the office folder
{
  // Windows device names (review on #488, change 6): any case, with or without an extension
  const RESERVED = ['CON', 'con', 'Prn', 'AUX', 'nul', 'NUL.txt', 'con.backup', 'COM1', 'com9', 'LPT1', 'lpt9.x'];
  for (const bad of ['../x', 'a/b', 'a\\b', '..', 'a..b', '.hidden', '', 'x'.repeat(65), 'a b', 'ok\0', 42, ...RESERVED]) {
    const r = createProfileFile(dirs(), 'claude', W0, bad);
    assert.ok(!r.ok, `name refused: ${JSON.stringify(bad)}`);
  }
  for (const n of RESERVED) assert.ok(/reserved on Windows/.test((createProfileFile(dirs(), 'copilot', W0, n) as { error: string }).error), `${n}: says why`);
  assert.deepStrictEqual(fs.readdirSync(path.join(WS, '.claude', 'agents')).filter((n) => /^(con|prn|aux|nul|com|lpt)/i.test(n)), [], 'no device-named file written');
  for (const good of ['console', 'com10', 'com0', 'lpt', 'nullable', 'auxiliary', 'conx', 'my-con']) assert.ok(isProfileName(good), `allowed: ${good}`);
  // the form's copy of the rule (profileeditor.js validName) answers the same as main for every name
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const PEN = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'profileeditor.js')) as { validName(n: unknown): boolean };
  for (const n of ['reviewer', 'Docs_writer-2.1', 'console', 'com10', 'a..b', '../x', '.x', '', 'x'.repeat(64), 'x'.repeat(65), ...RESERVED]) assert.strictEqual(PEN.validName(n), isProfileName(n), `form and main agree on ${JSON.stringify(n)}`);
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

// spec 043 FR-029 (review on #505, change 4): create with a reviewed AI draft's text: checked like a save, exclusive
{
  for (const [bad, why] of [['', 'empty'], ['  \n ', 'blank'], [42, 'not a string'], [{}, 'an object'], ['é'.repeat(MAX_PROFILE_BYTES / 2 + 1), 'too large in bytes']] as [unknown, string][]) {
    const r = createProfileFile(dirs(), 'claude', W0, 'draft-x', 'success', bad);
    assert.ok(!r.ok && /empty or too large/.test(r.error), `text refused: ${why}`);
    assert.ok(!fs.existsSync(path.join(WS, '.claude', 'agents', 'draft-x.md')), `nothing written: ${why}`);
  }
  const text = '---\nname: draft-x\ndescription: d\ntools: Read\n---\n\n# Draft é\n';
  const ok = createProfileFile(dirs(), 'claude', W0, 'draft-x', 'success', text);
  assert.ok(ok.ok, JSON.stringify(ok));
  assert.strictEqual(fs.readFileSync(path.join(WS, '.claude', 'agents', 'draft-x.md'), 'utf8'), text, 'the draft text is written, not the template');
  const again = createProfileFile(dirs(), 'claude', W0, 'draft-x', 'success', 'other text');
  assert.ok(!again.ok && /exists/.test(again.error), 'exclusive: an existing file is never overwritten');
  assert.strictEqual(fs.readFileSync(path.join(WS, '.claude', 'agents', 'draft-x.md'), 'utf8'), text, 'unchanged');
  assert.ok(!createProfileFile(dirs(), 'claude', W0, 'draft-z', 'success', 'x'.repeat(maxBytesFor('claude') + 1)).ok, 'Claude: one byte over its 64 KB is refused');
  assert.ok(createProfileFile(dirs(), 'claude', W0, 'draft-y', 'success', 'x'.repeat(maxBytesFor('claude'))).ok, 'Claude: exactly its limit is accepted');
  assert.ok(createProfileFile(dirs(), 'copilot', W0, 'draft-c', 'success', 'x'.repeat(MAX_PROFILE_BYTES)).ok, 'Copilot: exactly 256 KB is accepted');
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

// spec 043 FR-040 (issue #570): delete by id from main's list only: the file goes, its folder and the other files stay; unknown,
// malformed and stale ids are refused; a read-only file is refused and kept
{
  const made = createProfileFile(dirs(), 'claude', W0, 'to-delete');
  assert.ok(made.ok, 'made a file to delete');
  const file = path.join(WS, '.claude', 'agents', 'to-delete.md');
  const others = listProfileFiles(dirs()).filter((f) => f.fileName !== 'to-delete.md').map((f) => f.path);
  for (const bad of [undefined, null, 1, '', '../x', 'f'.repeat(32), file, { id: (made as { id: string }).id }]) assert.ok(!deleteProfileFile(dirs(), bad).ok, `refused: ${String(bad).slice(0, 40)}`);
  assert.ok(fs.existsSync(file), 'still there after the refusals');
  const del = deleteProfileFile(dirs(), (made as { id: string }).id);
  assert.ok(del.ok, 'deleted: ' + JSON.stringify(del));
  assert.ok(!fs.existsSync(file), 'the file is gone from disk');
  assert.ok(fs.statSync(path.join(WS, '.claude', 'agents')).isDirectory(), 'its agent folder stays');
  assert.ok(!listProfileFiles(dirs()).some((f) => f.fileName === 'to-delete.md'), 'and from the list');
  for (const o of others) assert.ok(fs.existsSync(o), 'other profile files stay: ' + path.basename(o));
  const again = deleteProfileFile(dirs(), (made as { id: string }).id);
  assert.ok(!again.ok && /not in the list/.test(again.error), 'a second delete of the same id is refused');
  // a file of a folder that left the office: its id is not in the list any more
  const gone = createProfileFile(dirs(), 'copilot', W0, 'left-office');
  assert.ok(gone.ok);
  assert.ok(!deleteProfileFile(profileDirs([], env), (gone as { id: string }).id).ok, 'a folder no longer in the office: refused');
  assert.ok(fs.existsSync(path.join(WS, '.github', 'agents', 'left-office.agent.md')), 'and kept');
  assert.ok(deleteProfileFile(dirs(), (gone as { id: string }).id).ok);
  if (process.platform !== 'win32') {
    const ro = path.join(WS, '.github', 'agents', 'keep-ro.agent.md');
    fs.writeFileSync(ro, 'read only\n');
    fs.chmodSync(path.join(WS, '.github', 'agents'), 0o555); // unlink needs the folder writable
    let realRo = true;
    try {
      fs.accessSync(path.join(WS, '.github', 'agents'), fs.constants.W_OK);
      realRo = false;
    } catch {
      /* read-only as expected */
    }
    if (realRo) {
      const info = listProfileFiles(dirs()).find((f) => f.fileName === 'keep-ro.agent.md')!;
      assert.ok(!info.writable, 'listed read-only');
      const r = deleteProfileFile(dirs(), info.id);
      assert.ok(!r.ok && r.error === info.note, 'a read-only file is refused with its note');
    }
    fs.chmodSync(path.join(WS, '.github', 'agents'), 0o755);
    assert.ok(fs.existsSync(ro), 'kept');
    fs.unlinkSync(ro);
  }
}

// spec 043 FR-041 (issue #570): main counts file changes made through Durbar; a session lists with a reload once per change it has not seen
{
  const fr = createProfileFreshness();
  assert.strictEqual(fr.needsReload('a'), false, 'nothing changed yet: no reload');
  fr.changed();
  assert.strictEqual(fr.needsReload('a'), true, 'a change: the next list reloads');
  fr.seen('a');
  assert.strictEqual(fr.needsReload('a'), false, 'once seen, no second reload');
  assert.strictEqual(fr.needsReload('b'), true, 'another session has not seen it');
  fr.changed();
  fr.changed();
  assert.strictEqual(fr.needsReload('a'), true, 'a new change after it was seen');
  fr.seen('a');
  fr.forget('a');
  assert.strictEqual(fr.needsReload('a'), true, 'a forgotten (ended) session starts over and reloads');
  // review on #572: prune drops sessions that left the office (folders:remove, a replaced session), keeps the others
  const pr = createProfileFreshness();
  pr.changed();
  pr.seen('keep');
  pr.seen('gone');
  pr.prune((id) => id === 'keep');
  assert.strictEqual(pr.needsReload('keep'), false, 'a kept session keeps what it saw');
  assert.strictEqual(pr.needsReload('gone'), true, 'a pruned session has no entry any more');
}

// review on #572: the last lstat before the unlink refuses an entry swapped for a link or a folder after it was resolved
{
  const made = createProfileFile(dirs(), 'claude', W0, 'swapped');
  assert.ok(made.ok);
  const file = path.join(WS, '.claude', 'agents', 'swapped.md');
  const real = deleteOps.lstat;
  for (const kind of ['link', 'folder']) {
    deleteOps.lstat = (p: string) => ({ ...real(p), isFile: () => false, isSymbolicLink: () => kind === 'link', isDirectory: () => kind === 'folder' }) as fs.Stats;
    try {
      const r = deleteProfileFile(dirs(), (made as { id: string }).id);
      assert.ok(!r.ok && /plain file/.test(r.error), `a ${kind} swapped in: refused`);
    } finally {
      deleteOps.lstat = real;
    }
    assert.ok(fs.existsSync(file), `and nothing was deleted (${kind})`);
  }
  assert.ok(deleteProfileFile(dirs(), (made as { id: string }).id).ok, 'the real file then deletes');
}

// FR-041: the profile list of a session asks the adapter to read the agent files again once after a change; an adapter without the
// member (Claude Code reads the folders each time) lists as before; a failed reload lists the old list and tries again next time
void (async () => {
  const calls: string[] = [];
  let fail = false;
  const ad = {
    listAgentProfiles: async (id: string) => (calls.push('list:' + id), [{ id: 'p', name: 'p', source: 'user' as const }]),
    reloadAgentProfiles: async (id: string) => {
      calls.push('reload:' + id);
      if (fail) throw new Error('rpc missing');
    },
  };
  const fr = createProfileFreshness();
  await listAgentProfilesFresh(ad, 's1', fr);
  assert.deepStrictEqual(calls.splice(0), ['list:s1'], 'no change yet: list only');
  fr.changed();
  const l = await listAgentProfilesFresh(ad, 's1', fr);
  assert.deepStrictEqual(calls.splice(0), ['reload:s1', 'list:s1'], 'after a change: reload, then list');
  assert.strictEqual(l[0].id, 'p');
  await listAgentProfilesFresh(ad, 's1', fr);
  assert.deepStrictEqual(calls.splice(0), ['list:s1'], 'reloaded once per change');
  fr.changed();
  fail = true;
  await listAgentProfilesFresh(ad, 's1', fr);
  assert.deepStrictEqual(calls.splice(0), ['reload:s1', 'list:s1'], 'a failed reload still lists');
  fail = false;
  await listAgentProfilesFresh(ad, 's1', fr);
  assert.deepStrictEqual(calls.splice(0), ['reload:s1', 'list:s1'], 'and tries again next time');
  const plain = { listAgentProfiles: async (id: string) => (calls.push('list:' + id), []) };
  fr.changed();
  await listAgentProfilesFresh(plain, 's2', fr);
  assert.deepStrictEqual(calls.splice(0), ['list:s2'], 'no reload member: list only');
  assert.deepStrictEqual(await listAgentProfilesFresh({}, 's3', fr), [], 'no list member: empty');
  console.log('profile list freshness checked');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

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
      // the fixed safety lines (FR-043) forbid secrets by name; apart from them, no paths, URLs or secrets
      assert.ok(!/[~\\]|\/[a-z]|https?:|token|secret|password|api[_-]?key/i.test(SAFETY_LINES.reduce((x, l) => x.replace(l, ''), t)), `${app}/${kind}: no paths, URLs or secrets`);
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
  assert.ok(std.ok && !fs.readFileSync(path.join(WS, '.claude', 'agents', 'plain.md'), 'utf8').includes('## Working method'), 'Standard agent template written');
  const def = createProfileFile(dirs(), 'claude', W0, 'asp');
  assert.ok(def.ok && fs.readFileSync(path.join(WS, '.claude', 'agents', 'asp.md'), 'utf8').includes('## Quality bar and definition of done'), 'no template given: the Agent Success Profile');
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
  // FR-040: a link is never deleted (neither the link nor what it points to); the id of a link out is not in the list
  assert.ok(!deleteProfileFile(dirs(), alias.id).ok && fs.existsSync(path.join(WS, '.github', 'agents', 'alias.agent.md')) && fs.existsSync(REV), 'a link inside is not deleted, nor its target');
  assert.ok(!deleteProfileFile(dirs(), fileIdOf(path.join(WS, '.github', 'agents', 'escape.agent.md'))).ok && fs.existsSync(path.join(OUTSIDE, 'secret.md')), 'a link out: refused, the outside file stays');
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
  // review on #488 (change 2): .claude links to an existing outside folder that has no agents yet: refused BEFORE mkdir, so agents/ is never made out there
  const OUT2 = path.join(tmp, 'outside2');
  fs.mkdirSync(OUT2);
  const WS4 = path.join(tmp, 'ws4');
  fs.mkdirSync(WS4);
  fs.symlinkSync(OUT2, path.join(WS4, '.claude'), 'dir');
  const r4 = createProfileFile(profileDirs([WS4], env), 'claude', folderIdOf(WS4), 'w');
  assert.ok(!r4.ok && /outside this folder/.test(r4.error), 'a .claude linked to an outside folder is refused');
  assert.ok(!fs.existsSync(path.join(OUT2, 'agents')), 'and no agents folder was created outside');
  // a linked home folder for the user scope is fine (dotfiles setups): the agent folder itself is the root
  console.log('symlink cases checked');
} else console.log('symlink cases skipped: this account cannot create symbolic links');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('profile file tests passed');
