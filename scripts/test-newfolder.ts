/**
 * Spec 093 (create a folder from + Folder), phase 1: the name rule (FR-010) with an adversarial corpus, the remembered parent's
 * rule (FR-006), the one Windows device-name constant, and the window's flow (src/renderer/newfolder.js) on fakes: the choice,
 * the Allow all confirmation before anything, main's refusals shown with the typed text kept, no path ever sent.
 * Pure: no Electron, no git, no network, no credits. `npm run test:newfolder`.
 */
import * as assert from 'assert';
import * as path from 'path';
import { NEW_FOLDER_LIMITS, WINDOWS_RESERVED_NAME, checkNewFolderName, parseNewFolderParent } from '../src/shared/newfolder';
import { WINDOWS_RESERVED_NAME as PROFILE_RESERVED } from '../src/main/profilefiles';

// ---- FR-010: refused names, each with the rule's own message ----
const MSG = {
  empty: 'Type a name for the new folder.',
  long: 'Use at most 100 characters.',
  sep: 'A single folder name, without / or \\.',
  dots: 'Use a name other than . or ..',
  hidden: 'Remove control or hidden characters.',
  chars: 'Remove these characters: < > : " | ? *',
  reserved: 'That name is reserved on Windows (CON, PRN, AUX, NUL, CONIN$, CONOUT$, COM0-9, LPT0-9). Choose another.',
  trail: 'Do not end the name with a dot or a space.',
  dash: 'Do not start the name with -.',
  git: 'Use a name other than .git.',
  secret: 'That looks like a secret. Use another name.',
};
const REFUSED: Array<[unknown, keyof typeof MSG]> = [
  ['', 'empty'], [undefined, 'empty'], [null, 'empty'], [42, 'empty'], [{}, 'empty'], [['a'], 'empty'],
  ['x'.repeat(101), 'long'], ['\u{1F600}'.repeat(101), 'long'],
  ['a/b', 'sep'], ['a\\b', 'sep'], ['/abs', 'sep'], ['../x', 'sep'], ['C:\\x', 'sep'], ['\\\\srv\\share', 'sep'], ['x/', 'sep'],
  ['.', 'dots'], ['..', 'dots'],
  ['a\u0007b', 'hidden'], ['a\u0000', 'hidden'], ['a\nb', 'hidden'], ['a\tb', 'hidden'], ['a\u200bb', 'hidden'], ['a\u202eb', 'hidden'], ['a\u0085b', 'hidden'], ['\ufeffa', 'hidden'],
  ['a:b', 'chars'], ['C:x', 'chars'], ['a*b', 'chars'], ['a?b', 'chars'], ['a|b', 'chars'], ['a"b', 'chars'], ['a<b', 'chars'], ['a>b', 'chars'],
  ['CON', 'reserved'], ['con.txt', 'reserved'], ['Nul', 'reserved'], ['AUX', 'reserved'], ['prn.backup.md', 'reserved'], ['COM1', 'reserved'], ['com9', 'reserved'], ['LPT9.x', 'reserved'],
  ['CON .txt', 'reserved'], ['con .txt', 'reserved'], ['nul .tar.gz', 'reserved'], ['com1 .x', 'reserved'], ['AUX   .md', 'reserved'],
  ['CONIN$', 'reserved'], ['conout$', 'reserved'], ['CONIN$.txt', 'reserved'], ['COM0', 'reserved'], ['lpt0.x', 'reserved'], ['LPT0', 'reserved'],
  ['COM\u00b9', 'reserved'], ['lpt\u00b3.md', 'reserved'], ['com\u00b2', 'reserved'],
  ['a.', 'trail'], ['a ', 'trail'], ['shop.', 'trail'], ['a. ', 'trail'], ['...', 'trail'],
  ['-a', 'dash'], ['--upload-pack=x', 'dash'], ['-', 'dash'],
  ['.git', 'git'], ['.GIT', 'git'], ['.Git', 'git'],
  // git's is_hfs_dotgit (CVE-2014-9390): HFS+ ignores these characters, so each of these is .git on a Mac
  ['.git\u200c', 'git'], ['.g\u200dit', 'git'], ['\u200e.git', 'git'], ['.GI\u200fT', 'git'], ['.g\u206ait', 'git'], ['.git\u206f', 'git'],
  ['.g\u202ait', 'hidden'], ['.git\ufeff', 'hidden'], // also hidden characters: refused by that rule first
  // git's is_ntfs_dotgit: the 8.3 short name of .git
  ['GIT~1', 'git'], ['git~1', 'git'], ['Git~12', 'git'],
  ['ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8', 'secret'], ['sk-ant-api03-' + 'x'.repeat(40), 'secret'],
];
assert.ok(REFUSED.length >= 30, `at least 30 refused names (${REFUSED.length})`);
for (const [n, rule] of REFUSED) {
  const r = checkNewFolderName(n);
  assert.deepStrictEqual(r, { ok: false, error: MSG[rule] }, `${JSON.stringify(n)} is refused by the ${rule} rule`);
}
assert.strictEqual(new Set(Object.values(MSG)).size, Object.keys(MSG).length, 'each rule has its own message');
for (const rule of Object.keys(MSG)) assert.ok(REFUSED.some(([, r]) => r === rule), `the corpus covers the ${rule} rule`);

// ---- accepted names (kept exactly as given) ----
const ACCEPTED = ['shop', 'notes-app', 'My Project', 'über', '日本語', 'a.b', '.hidden', '.gitignore', 'git', 'console', 'com10', 'lpt', 'conin', 'CONOUT', 'COM10.txt', 'con-.txt', 'git~', 'git~x', '.gi t', '..git', '.git2', 'xgit~1',  'con-x', 'a-', 'a_b', ' lead', 'x'.repeat(100), '\u{1F600}'.repeat(100), 'v1.2.3', 'a%20b', 'a#b', "o'brien", 'a+b', 'a@b'];
for (const n of ACCEPTED) assert.deepStrictEqual(checkNewFolderName(n), { ok: true, name: n }, `${JSON.stringify(n)} is accepted`);
assert.strictEqual(NEW_FOLDER_LIMITS.name, 100);
assert.strictEqual(NEW_FOLDER_LIMITS.winPath, 200);

// ---- one Windows device-name constant (spec 043's profile names re-export it), and the window's copy in profileeditor.js ----
assert.strictEqual(PROFILE_RESERVED, WINDOWS_RESERVED_NAME, 'profilefiles.ts re-exports the same constant');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PEN = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'profileeditor.js'));
for (const n of ['CON', 'con.md', 'CON .txt', 'CONIN$', 'conout$.x', 'LPT0', 'COM1', 'COM\u00b9', 'lpt\u00b2.x', 'LPT\u00b3', 'nul', 'COM0', 'com10', 'console', 'x', 'COM\u2074', 'aux.'])
  assert.strictEqual(PEN.RESERVED_RE.test(n), WINDOWS_RESERVED_NAME.test(n), `profileeditor.js keeps the same rule for ${n}`);

// ---- FR-006: the remembered parent ----
for (const ok of ['/home/u/code', '/', 'C:\\Users\\u\\code', 'c:/code', '\\\\server\\share\\x', '/a b/ü']) assert.strictEqual(parseNewFolderParent(ok), ok, `kept: ${ok}`);
for (const bad of ['', 'code', './x', '../x', '~/code', 'C:', 'C:x', '\\\\server', '/a\nb', '/a\u0000', '/a\u202eb', '/' + 'x'.repeat(4096), 42, null, undefined, {}, ['/x']]) assert.strictEqual(parseNewFolderParent(bad), undefined, `dropped: ${JSON.stringify(bad)}`);
assert.strictEqual(parseNewFolderParent('/' + 'x'.repeat(4095)), '/' + 'x'.repeat(4095), 'exactly 4096 characters is kept');

// ---- the window's flow (src/renderer/newfolder.js) on fakes ----
// eslint-disable-next-line @typescript-eslint/no-var-requires
const NF = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'newfolder.js'));
type Dlg = { title: string; body: string; lines?: string[]; input?: { value?: string; error?: string }; buttons: Array<{ label: string; value: string | null; cls?: string }> };
function rig(answers: Array<null | { value: string; text?: string }>, o: { mode?: string; confirm?: boolean; pick?: unknown[]; check?: unknown[]; create?: unknown[]; options?: unknown } = {}) {
  const log: string[] = [];
  const dialogs: Dlg[] = [];
  const sent: unknown[] = [];
  const results: unknown[] = [];
  const picks = [...(o.pick ?? [{ ok: true, token: 't1', parent: '/home/u/code' }])];
  const checks = [...(o.check ?? [])];
  const creates = [...(o.create ?? [])];
  const ctx = {
    bridge: {
      createPickParent: async () => { log.push('pick'); return picks.length ? picks.shift() : { ok: false, cancelled: true }; },
      createCheck: async (req: unknown) => { log.push('check'); sent.push(['check', req]); return checks.length ? checks.shift() : { ok: true }; },
      createFolder: async (req: unknown, mode: unknown, opts: unknown) => { log.push('create'); sent.push(['create', req, mode, opts]); return creates.length ? creates.shift() : { ok: true, agents: [{ id: 'x' }], name: (req as { name: string }).name }; },
    },
    askDialog: async (d: Dlg) => { log.push('dialog:' + d.title); dialogs.push(d); return answers.length ? answers.shift() : null; },
    toast: (h: string) => { log.push('toast:' + h); },
    esc: (s: string) => String(s).replace(/</g, '&lt;'),
    mode: () => ({ value: o.mode ?? 'read-only', label: o.mode === 'allow' ? 'Allow all' : o.mode === 'ask' ? 'Ask first' : 'Read-only' }),
    confirmAllow: async (what: string) => { log.push('confirm:' + what); return o.confirm !== false; },
    addOptions: () => { log.push('options'); return o.options === undefined ? { floor: 'f1' } : o.options; },
    addExisting: () => { log.push('existing'); },
    applyResult: (r: unknown, text: string) => { log.push('done:' + text); results.push(r); },
  };
  return { flow: NF.create(ctx), log, dialogs, sent, results };
}
async function flows(): Promise<void> {
  // FR-001: the choice; Add existing first, primary (focused, so Enter keeps today's behaviour); it is today's path
  {
    const t = rig([{ value: 'existing' }]);
    await t.flow.choose(false);
    const d = t.dialogs[0];
    assert.strictEqual(d.title, 'Add a folder');
    assert.deepStrictEqual(d.buttons.map((b) => [b.label, b.value, b.cls ?? '']), [['Add existing folder…', 'existing', 'primary'], ['New repository…', 'init', ''], ['Empty folder…', 'empty', ''], ['Cancel', null, '']]);
    assert.deepStrictEqual(d.lines, ['New repository: an empty folder with git, on this computer only.', 'Empty folder: no git.']);
    assert.deepStrictEqual(t.log, ['dialog:Add a folder', 'existing'], 'Add existing is the existing path, nothing else');
  }
  // Cancel or Escape at the choice: nothing
  {
    const t = rig([null]);
    await t.flow.choose(false);
    assert.deepStrictEqual(t.log, ['dialog:Add a folder']);
  }
  // FR-001a: File > New Folder… offers only the kinds
  {
    const t = rig([null]);
    await t.flow.choose(true);
    assert.deepStrictEqual(t.dialogs[0].buttons.map((b) => b.value), ['init', 'empty', null]);
    assert.strictEqual(t.dialogs[0].buttons[0].cls, 'primary');
  }
  // the happy path: pick -> name -> check -> create; no path is ever sent, only kind, token and the trimmed name
  {
    const t = rig([{ value: 'init' }, { value: 'ok', text: '  notes-app  ' }]);
    await t.flow.choose(false);
    assert.deepStrictEqual(t.log, ['dialog:Add a folder', 'options', 'pick', 'dialog:New repository', 'check', 'create', 'done:New repository notes-app created.']);
    assert.deepStrictEqual(t.sent, [['check', { kind: 'init', name: 'notes-app' }], ['create', { kind: 'init', token: 't1', name: 'notes-app' }, 'read-only', { floor: 'f1' }]]);
    assert.strictEqual(t.dialogs[1].body, 'In /home/u/code. It starts in Read-only.', 'the name dialog shows the place and the mode');
    assert.deepStrictEqual(t.dialogs[1].buttons.map((b) => [b.label, b.value]), [['Cancel', null], ['Change place…', 'place'], ['Create', 'ok']]);
  }
  // FR-061, Q2 = b: Allow all asks first, before the picker; a No ends the flow with nothing asked of main
  {
    const t = rig([], { mode: 'allow', confirm: false });
    await t.flow.start('empty');
    assert.deepStrictEqual(t.log, ['confirm:the folder you create next'], 'no pick, no create after a No');
    const y = rig([{ value: 'ok', text: 'x' }], { mode: 'allow' });
    await y.flow.start('empty');
    assert.deepStrictEqual(y.log.slice(0, 3), ['confirm:the folder you create next', 'options', 'pick'], 'the confirmation comes first');
    assert.strictEqual((y.sent[1] as unknown[])[2], 'allow', "the top bar's mode is passed");
    assert.match(y.dialogs[0].body, /It starts in Allow all\./);
    const r = rig([{ value: 'ok', text: 'x' }], { mode: 'ask' });
    await r.flow.start('empty');
    assert.ok(!r.log.some((l) => l.startsWith('confirm:')), 'Ask first needs no confirmation');
  }
  // an agent app that is not ready: addOptions says so and nothing happens
  {
    const t = rig([], { options: null });
    await t.flow.start('init');
    assert.deepStrictEqual(t.log, ['options']);
  }
  // the picker cancelled: nothing; main's pick error is shown
  {
    const t = rig([], { pick: [{ ok: false, cancelled: true }] });
    await t.flow.start('init');
    assert.deepStrictEqual(t.log, ['options', 'pick']);
    const e = rig([], { pick: [{ ok: false, error: 'Choose a <b>folder</b> on this computer.' }] });
    await e.flow.start('init');
    assert.deepStrictEqual(e.log, ['options', 'pick', 'toast:Choose a &lt;b>folder&lt;/b> on this computer.'], 'escaped');
  }
  // a refused name (createCheck) and a refused create (EEXIST) keep the typed text and show main's reason; Escape then ends it
  {
    const t = rig([{ value: 'ok', text: 'CON' }, { value: 'ok', text: 'shop' }, null], { check: [{ ok: false, error: 'That name is reserved on Windows.' }], create: [{ ok: false, agents: [], error: 'A folder or file named shop already exists there.', retry: 'name' }] });
    await t.flow.start('empty');
    assert.deepStrictEqual([t.dialogs[1].input?.value, t.dialogs[1].input?.error], ['CON', 'That name is reserved on Windows.']);
    assert.deepStrictEqual([t.dialogs[2].input?.value, t.dialogs[2].input?.error], ['shop', 'A folder or file named shop already exists there.']);
    assert.strictEqual(t.log.filter((l) => l === 'create').length, 1, 'a name refused by the check is never sent to create');
    assert.ok(!t.log.some((l) => l.startsWith('done:')), 'nothing added');
  }
  // Change place… picks again (a cancelled re-pick keeps the old place), keeps the name, and the new token is used
  {
    const t = rig([{ value: 'place', text: 'n1' }, { value: 'place', text: 'n1' }, { value: 'ok', text: 'n1' }], { pick: [{ ok: true, token: 't1', parent: '/a' }, { ok: true, token: 't2', parent: '/b' }, { ok: false, cancelled: true }] });
    await t.flow.start('init');
    assert.deepStrictEqual(t.dialogs.map((d) => d.body), ['In /a. It starts in Read-only.', 'In /b. It starts in Read-only.', 'In /b. It starts in Read-only.']);
    assert.strictEqual(t.dialogs[1].input?.value, 'n1');
    assert.deepStrictEqual((t.sent[1] as unknown[])[1], { kind: 'init', token: 't2', name: 'n1' });
  }
  // one flow at a time; an unknown kind starts nothing
  {
    const t = rig([]);
    await t.flow.start('clone');
    await t.flow.start('../x');
    assert.deepStrictEqual(t.log, []);
  }
}

flows().then(() => {
  console.log(`newfolder: ${REFUSED.length} refused and ${ACCEPTED.length} accepted names, one device-name rule, the remembered parent, the window's flow OK`);
}).catch((e) => { console.error(e); process.exit(1); });
