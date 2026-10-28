/**
 * Spec 093 (create a folder from + Folder): the name rule (FR-010) and the clone URL rule (FR-020..FR-023, phase 2) with adversarial
 * corpora, the suggested name (FR-011), git's failure texts (FR-071) and progress lines (FR-040), the remembered parent's rule
 * (FR-006), the one Windows device-name constant, and the window's flow (src/renderer/newfolder.js) on fakes: the choice, the URL
 * step, the Allow all confirmation (with the clone's host sentence), main's refusals shown with the typed text kept, the clone's
 * progress and Cancel, no path ever sent.
 * Pure: no Electron, no git, no network, no credits. `npm run test:newfolder`.
 */
// an async test whose promise never settles lets Node exit 0 without the OK line: fail unless the success path is reached
process.exitCode = 1;
import * as assert from 'assert';
import * as path from 'path';
import { CLONE_URL_MSG, NEW_FOLDER_LIMITS, WINDOWS_RESERVED_NAME, checkCloneUrl, checkNewFolderName, gitFailureText, parseCloneProgress, parseNewFolderParent, suggestedName } from '../src/shared/newfolder';
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
  surrogate: 'The name has a broken character. Type it again.',
};
const REFUSED: Array<[unknown, keyof typeof MSG]> = [
  ['', 'empty'], [undefined, 'empty'], [null, 'empty'], [42, 'empty'], [{}, 'empty'], [['a'], 'empty'],
  ['x'.repeat(101), 'long'], ['\u{1F600}'.repeat(101), 'long'],
  ['a/b', 'sep'], ['a\\b', 'sep'], ['/abs', 'sep'], ['../x', 'sep'], ['C:\\x', 'sep'], ['\\\\srv\\share', 'sep'], ['x/', 'sep'],
  ['.', 'dots'], ['..', 'dots'],
  ['a\u0007b', 'hidden'], ['a\u0000', 'hidden'], ['a\nb', 'hidden'], ['a\tb', 'hidden'], ['a\u200bb', 'hidden'], ['a\u202eb', 'hidden'], ['a\u0085b', 'hidden'], ['\ufeffa', 'hidden'],
  ['x\ud800y', 'surrogate'], ['x\udc00', 'surrogate'], ['\udbffz', 'surrogate'], ['\ude00\ud83d', 'surrogate'], ['\ud83d\ude00\ud800', 'surrogate'],
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
const ACCEPTED = ['shop', 'notes-app', 'My Project', 'über', '日本語', 'a.b', '.hidden', '.gitignore', 'git', 'console', 'com10', 'lpt', 'conin', 'CONOUT', 'COM10.txt', 'con-.txt', 'git~', 'git~x', '.gi t', '..git', '.git2', 'xgit~1',  'con-x', 'a-', 'a_b', ' lead', 'x'.repeat(100), '\u{1F600}'.repeat(100), 'a\ud83d\ude00b', '\u{10FFFD}x', 'v1.2.3', 'a%20b', 'a#b', "o'brien", 'a+b', 'a@b'];
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

// ---- FR-020..FR-023: clone URLs refused, each with its reason ----
const U = CLONE_URL_MSG;
const URL_REFUSED: Array<[unknown, keyof typeof U]> = [
  ['', 'empty'], [undefined, 'empty'], [null, 'empty'], [42, 'empty'], [{}, 'empty'], [['https://h/x'], 'empty'],
  ['https://h/' + 'x'.repeat(2049 - 'https://h/'.length), 'long'],
  ['https://h/x y', 'space'], ['https://h/x\ty', 'space'], ['https://h/x\ny', 'space'], ['https://h/x\u0000', 'space'], ['ext::sh -c touch x', 'space'], [' https://h/x', 'space'], ['https://h/x\u00a0', 'space'], ['https://h/x\u2028', 'space'],
  ['https://exämple.com/x', 'ascii'], ['https://h/ü', 'ascii'], ['https://h\uff0fx/y', 'ascii'],
  // other schemes and transports
  ['file:///x', 'form'], ['FILE:///x', 'form'], ['file:x', 'form'], ['file://h/x', 'form'], ['git://h/x', 'form'], ['http://h/x', 'form'], ['HTTP://h/x', 'form'], ['ftp://h/x', 'form'], ['ftps://h/x', 'form'], ['git+ssh://h/x', 'form'], ['ssh+git://h/x', 'form'],
  ['fd::17', 'form'], ['ext::sh', 'form'], ['foo::https://h/x', 'form'], ['https://h/x::y', 'form'], ['u@h:x::y', 'form'], ['u@[::1:x', 'form'],
  // local paths
  ['/abs/x', 'form'], ['./x', 'form'], ['../x', 'form'], ['~/x', 'form'], ['C:\\x', 'form'], ['C:/x', 'form'], ['\\\\srv\\share\\x', 'form'], ['x', 'form'], ['h:x', 'form'],
  // a leading - anywhere it could become an option
  ['-uhelp', 'dash'], ['--upload-pack=x', 'dash'], ['https://-h/x', 'dash'], ['ssh://-oProxyCommand=x/y', 'dash'], ['git@-oProxyCommand=x:y', 'dash'], ['-x@h:y', 'dash'], ['u@h:-x', 'dash'], ['https://-u@h/x', 'dash'], ['u@-h:x', 'dash'],
  // a password (Q3 = a), also hidden in percent-encoded userinfo (R3)
  ['https://u:p@h/x', 'password'], ['ssh://u:p@h/x', 'password'], ['u:p@h:x', 'password'], ['https://u:@h/x', 'password'], ['https://:p@h/x', 'password'], ['https://u:p@[::1]/x', 'password'],
  ['https://u%3Ap@h/x', 'encodedUser'], ['ssh://u%3Ap@h/x', 'encodedUser'], ['u%3Ap@h:x', 'encodedUser'], ['https://u%40x@h/x', 'encodedUser'], ['https://%75@h/x', 'encodedUser'], ['https://u%3ap@h/x', 'encodedUser'],
  // host, port and path shapes
  ['https://h', 'form'], ['https://h/', 'form'], ['https://h:0/x', 'form'], ['https://h:70000/x', 'form'], ['https://h:/x', 'form'], ['https://h:123456/x', 'form'], ['https://h/x#f', 'form'], ['https://h/x?q', 'form'], ['https://h\\x', 'form'],
  ['u@h:', 'form'], ['@h:x', 'form'], ['https://@h/x', 'form'], ['https://a@b@h/x', 'form'], ['u@h@x:y', 'form'], ['https://h-/x', 'form'], ['https://h..c/x', 'form'], ['https://h_x/x', 'form'], ['https://[zz]/x', 'form'], ['https://[1.2.3.4]/x', 'form'],
  ['https://h/a%2', 'form'], ['https://h/a%zz', 'form'], ['https://h/a%0a', 'form'], ['https://h/a%7f', 'form'], ['https://h/a%1F', 'form'], ['https://h/a"b', 'form'], ['https://h/a<b', 'form'], ['https://h/a`b', 'form'], ['https://h/a{b}', 'form'], ['https://h/a^b', 'form'], ['https://h/a|b', 'form'],
  ['https://' + 'a'.repeat(64) + '/x', 'form'], ['u/x@h:y', 'form'], ['u!@h:x', 'form'],
];
assert.ok(URL_REFUSED.length >= 40, `at least 40 refused URLs (${URL_REFUSED.length})`);
for (const [u, rule] of URL_REFUSED) assert.deepStrictEqual(checkCloneUrl(u), { ok: false, error: U[rule] }, `${JSON.stringify(u)} is refused by the ${rule} rule`);
for (const rule of Object.keys(U)) assert.ok(URL_REFUSED.some(([, r]) => r === rule), `the URL corpus covers the ${rule} rule`);
assert.strictEqual(new Set(Object.values(U)).size, Object.keys(U).length, 'each URL rule has its own message');
assert.strictEqual(U.form, 'Use an https:// or ssh address (for example git@github.com:owner/repo.git).', 'the spec\'s message (US2)');
assert.strictEqual(U.password, 'Remove the password from the address. Durbar uses your own git credentials.', 'Q3 = a: the spec\'s message');
// ---- accepted URLs: the form and the host (the host part only: never the user, port or path) ----
const URL_ACCEPTED: Array<[string, string, string]> = [
  ['https://github.com/o/r.git', 'https', 'github.com'], ['HTTPS://github.com/o/r', 'https', 'github.com'], ['https://u@h:8443/a/b.git', 'https', 'h'],
  ['ssh://git@h/o/r.git', 'ssh', 'h'], ['ssh://git@h:2222/o/r', 'ssh', 'h'], ['SSH://h/~u/r', 'ssh', 'h'], ['git@github.com:o/r.git', 'scp', 'github.com'], ['git@h:/srv/r.git', 'scp', 'h'],
  ['u@[2001:db8::1]:r.git', 'scp', '[2001:db8::1]'], ['https://[2001:db8::1]:443/r.git', 'https', '[2001:db8::1]'], ['https://192.0.2.1/r.git', 'https', '192.0.2.1'], ['https://h/a%20b.git', 'https', 'h'],
  ['https://gitlab.example.co.uk/group/sub/r.git/', 'https', 'gitlab.example.co.uk'], ['first.last+x@h-1.example:a@b.git', 'scp', 'h-1.example'], ['https://xn--exmple-cua.com/x', 'https', 'xn--exmple-cua.com'],
  ['https://h/' + 'x'.repeat(2048 - 'https://h/'.length), 'https', 'h'],
];
// the URL comes back with its scheme lower-cased (git 2.43 refuses "transport 'HTTPS'"); scp addresses are unchanged
const norm = (u: string): string => u.replace(/^[A-Za-z]+:\/\//, (m) => m.toLowerCase());
for (const [u, form, host] of URL_ACCEPTED) assert.deepStrictEqual(checkCloneUrl(u), { ok: true, url: norm(u), form, host }, `${u} is accepted`);
for (const [u, want] of [['HTTPS://github.com/o/r', 'https://github.com/o/r'], ['SSH://h/~u/r', 'ssh://h/~u/r'], ['Https://H/A.git', 'https://H/A.git'], ['sSh://git@h:22/x', 'ssh://git@h:22/x']]) {
  const c = checkCloneUrl(u);
  assert.strictEqual(c.ok && c.url, want, `${u}: only the scheme is lower-cased`);
}
assert.strictEqual(NEW_FOLDER_LIMITS.url, 2048);
// ---- FR-011: the suggested name ----
for (const [u, n] of [['https://github.com/lena/shop.git', 'shop'], ['git@github.com:lena/shop.git', 'shop'], ['git@h:shop', 'shop'], ['u@[2001:db8::1]:r.git', 'r'], ['https://h/o/r/', 'r'], ['https://h/o/r.GIT', 'r'], ['ssh://h:22/a%20b.git', 'a b'], ['https://h/o/CON.git', ''], ['https://h/o/.git', ''], ['https://h/o/-x', ''], ['https://h/o/a.', ''], ['https://h/o/%2e%2e', ''], ['https://h/o/a%2fb', ''], ['https://h/o/%E0%A4%A', ''], ['file:///x/y.git', ''], [42, '']] as Array<[unknown, string]>) {
  assert.strictEqual(suggestedName(u), n, `suggested name of ${String(u)}`);
}
// ---- FR-071: git's failures in plain words; Q4 = a for an unknown host key ----
for (const [tail, want] of [
  ["fatal: Authentication failed for 'https://h/x.git/'", /^Sign-in failed: Durbar uses your own git credentials/],
  ["fatal: could not read Username for 'https://h': terminal prompts disabled", /^Sign-in failed/],
  ['git@h: Permission denied (publickey).\r\nfatal: Could not read from remote repository.', /^Sign-in failed/],
  ['Host key verification failed.\nfatal: Could not read from remote repository.', /^The ssh host key of h\.example is not known yet\. Connect once with ssh in a terminal, then try again\.$/],
  ['ERROR: Repository not found.\nfatal: Could not read from remote repository.', /^The repository was not found/],
  ["fatal: repository 'https://h/x/' not found", /^The repository was not found/],
  ['fatal: unable to access \'https://h/\': Could not resolve host: h', /^Could not reach the server/],
  ["fatal: unable to access 'https://127.0.0.1:9/x.git/': Failed to connect to 127.0.0.1 port 9 after 0 ms: Couldn't connect to server", /^Could not reach the server/],
  ['fatal: write error: No space left on device', /^The disk is full/],
  ['error: unable to create file a/b: Filename too long', /^A file in this repository has a path too long/],
  ["fatal: transport 'file' not allowed", /^Git refused that kind of address/],
  ["fatal: unable to access 'https://h/': SSL certificate problem: unable to get local issuer certificate", /^The secure connection failed\. Durbar does not pass GIT_SSL_NO_VERIFY, GIT_SSL_CERT, GIT_SSL_KEY, GIT_PROXY_COMMAND or your other GIT_\* variables to git \(only GIT_SSL_CAINFO and GIT_SSL_CAPATH, as absolute paths\): if you set one of them, put the setting in your git config instead \(http\.sslCAInfo, http\.proxy\)\.$/],
  ['fatal: unable to access: Proxy CONNECT aborted', /^The secure connection failed/],
  ["fatal: URL 'https://u:<redacted>@h/x' uses plaintext credentials", /^Remove the password from the address/],
] as Array<[string, RegExp]>) assert.match(gitFailureText(tail, 'h.example'), want, tail);
 // the exact sign-in text (FR-071, US1 scenario 4)
assert.strictEqual(gitFailureText('git@github.com: Permission denied (publickey).\r\nfatal: Could not read from remote repository.', 'github.com'), 'Sign-in failed: Durbar uses your own git credentials and cannot ask for a password. Set up a credential helper or an ssh agent, then try again.');
assert.strictEqual(gitFailureText('fatal: something else', 'h'), '', 'no match: the caller says "The clone failed." and git\'s line');
assert.strictEqual(gitFailureText(undefined, 'h'), '');
// ---- FR-040: progress lines ----
assert.deepStrictEqual(parseCloneProgress('Receiving objects:  45% (540/1200), 2.1 MiB | 3.0 MiB/s'), { phase: 'Receiving objects', percent: 45 });
assert.deepStrictEqual(parseCloneProgress('remote: Counting objects: 100% (2/2), done.        '), { phase: 'Counting objects', percent: 100 });
assert.deepStrictEqual(parseCloneProgress('Resolving deltas:   7% (1/14)'), { phase: 'Resolving deltas', percent: 7 });
assert.deepStrictEqual(parseCloneProgress('Updating files: 100% (3/3), done.'), { phase: 'Updating files', percent: 100 });
assert.deepStrictEqual(parseCloneProgress('remote: Enumerating objects: 1200, done.'), { phase: 'Enumerating objects' });
assert.deepStrictEqual(parseCloneProgress('Receiving objects: 999% (1/1)'), { phase: 'Receiving objects' }, 'a percent over 100 is dropped');
for (const x of ["Cloning into '.'...", 'fatal: x', 'remote: Receiving everything you have', '', undefined, 42]) assert.strictEqual(parseCloneProgress(x), undefined, `not a progress line: ${String(x)}`);

// ---- the window's flow (src/renderer/newfolder.js) on fakes ----
// eslint-disable-next-line @typescript-eslint/no-var-requires
const NF = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'newfolder.js'));
type Dlg = { title: string; body: string; lines?: string[]; input?: { value?: string; error?: string }; buttons: Array<{ label: string; value: string | null; cls?: string }> };
function rig(answers: Array<null | { value: string; text?: string }>, o: { mode?: string; confirm?: boolean; pick?: unknown[]; check?: unknown[]; create?: unknown[]; options?: unknown; createNow?: (req: unknown) => Promise<unknown>; noCancel?: boolean } = {}) {
  const log: string[] = [];
  const dialogs: Dlg[] = [];
  const sent: unknown[] = [];
  const results: unknown[] = [];
  const picks = [...(o.pick ?? [{ ok: true, token: 't1', parent: '/home/u/code' }])];
  const checks = [...(o.check ?? [])];
  const creates = [...(o.create ?? [])];
  const confirms: Array<[string, string | undefined]> = [];
  const views: Array<{ title: string; cancel: () => void; updates: unknown[]; closed: boolean }> = [];
  const progressCbs: Array<(p: unknown) => void> = [];
  const ctx = {
    bridge: {
      ...(o.noCancel ? {} : {
        createCancel: async () => { log.push('cancel'); return { ok: true }; },
        onCreateProgress: (cb: (p: unknown) => void) => { log.push('subscribe'); progressCbs.push(cb); return () => { log.push('unsubscribe'); progressCbs.splice(progressCbs.indexOf(cb), 1); }; },
      }),
      createPickParent: async () => { log.push('pick'); return picks.length ? picks.shift() : { ok: false, cancelled: true }; },
      createCheck: async (req: unknown) => { log.push('check'); sent.push(['check', req]); return checks.length ? checks.shift() : { ok: true }; },
      createFolder: async (req: unknown, mode: unknown, opts: unknown) => { log.push('create'); sent.push(['create', req, mode, opts]); if (o.createNow) return o.createNow(req); return creates.length ? creates.shift() : { ok: true, agents: [{ id: 'x' }], name: (req as { name: string }).name }; },
    },
    progress: (title: string, cancel: () => void) => {
      const v = { title, cancel, updates: [] as unknown[], closed: false };
      views.push(v);
      log.push('progress:' + title);
      return { update: (p: unknown) => { v.updates.push(p); }, close: () => { v.closed = true; log.push('progress-close'); } };
    },
    announce: (t: string) => { log.push('announce:' + t); },
    askDialog: async (d: Dlg) => { log.push('dialog:' + d.title); dialogs.push(d); return answers.length ? answers.shift() : null; },
    toast: (h: string) => { log.push('toast:' + h); },
    esc: (s: string) => String(s).replace(/</g, '&lt;'),
    mode: () => ({ value: o.mode ?? 'read-only', label: o.mode === 'allow' ? 'Allow all' : o.mode === 'ask' ? 'Ask first' : 'Read-only' }),
    confirmAllow: async (what: string, extra?: string) => { log.push('confirm:' + what); confirms.push([what, extra]); return o.confirm !== false; },
    addOptions: () => { log.push('options'); return o.options === undefined ? { floor: 'f1' } : o.options; },
    addExisting: () => { log.push('existing'); },
    applyResult: (r: unknown, text: string) => { log.push('done:' + text); results.push(r); },
  };
  return { flow: NF.create(ctx), log, dialogs, sent, results, confirms, views, progressCbs };
}
async function flows(): Promise<void> {
  // FR-001: the choice; Add existing first, primary (focused, so Enter keeps today's behaviour); it is today's path
  {
    const t = rig([{ value: 'existing' }]);
    await t.flow.choose(false);
    const d = t.dialogs[0];
    assert.strictEqual(d.title, 'Add a folder');
    assert.deepStrictEqual(d.buttons.map((b) => [b.label, b.value, b.cls ?? '']), [['Add existing folder…', 'existing', 'primary'], ['Clone a repository…', 'clone', ''], ['New repository…', 'init', ''], ['Empty folder…', 'empty', ''], ['Cancel', null, '']]);
    assert.deepStrictEqual(d.lines, ['Clone: copy a repository from GitHub or another git server.', 'New repository: an empty folder with git, on this computer only.', 'Empty folder: no git.']);
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
    assert.deepStrictEqual(t.dialogs[0].buttons.map((b) => b.value), ['clone', 'init', 'empty', null]);
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
  // an unknown kind starts nothing
  {
    const t = rig([]);
    await t.flow.start('status');
    await t.flow.start('../x');
    assert.deepStrictEqual(t.log, []);
  }

  // ---- phase 2: clone ----
  const URL1 = 'git@github.com:lena/shop.git';
  const OKURL = { ok: true, host: 'github.com', suggested: 'shop', shown: URL1 };
  // the happy path: URL (checked by main) -> options -> pick -> name (the suggested name) -> check -> progress -> create; no path sent
  {
    const c = rig([{ value: 'clone' }, { value: 'ok', text: '  ' + URL1 + ' ' }, { value: 'ok', text: 'shop' }], { check: [OKURL, { ok: true }] });
    await c.flow.choose(false);
    assert.deepStrictEqual(c.log, ['dialog:Add a folder', 'dialog:Clone a repository', 'check', 'options', 'pick', 'dialog:Clone a repository', 'check', 'progress:Cloning into shop', 'subscribe', 'create', 'unsubscribe', 'progress-close', 'done:Cloned into shop.']);
    assert.deepStrictEqual(c.sent, [['check', { kind: 'clone', url: URL1 }], ['check', { kind: 'clone', url: URL1, name: 'shop' }], ['create', { kind: 'clone', token: 't1', name: 'shop', url: URL1 }, 'read-only', { floor: 'f1' }]], 'only kind, token, name and url are sent; the URL is trimmed');
    const [ud, nd] = [c.dialogs[1], c.dialogs[2]];
    assert.deepStrictEqual(ud.buttons.map((b) => [b.label, b.value]), [['Cancel', null], ['Next', 'ok']]);
    assert.strictEqual(nd.input?.value, 'shop', 'FR-011: the suggested name');
    assert.strictEqual(nd.body, 'In /home/u/code. It starts in Read-only.');
    assert.deepStrictEqual(nd.lines, ['From ' + URL1 + '.'], 'the masked URL from main');
    assert.deepStrictEqual(nd.buttons.map((b) => [b.label, b.value]), [['Cancel', null], ['Change place…', 'place'], ['Clone', 'ok']]);
    assert.deepStrictEqual(c.confirms, [], 'Read-only needs no confirmation');
  }
  // FR-022: a refused URL keeps the typed text and shows main's reason; nothing else is asked of main; Escape ends it
  {
    const t = rig([{ value: 'ok', text: 'file:///etc' }, null], { check: [{ ok: false, error: 'Use an https:// or ssh address (for example git@github.com:owner/repo.git).', retry: 'url' }] });
    await t.flow.start('clone');
    assert.deepStrictEqual([t.dialogs[1].input?.value, t.dialogs[1].input?.error], ['file:///etc', 'Use an https:// or ssh address (for example git@github.com:owner/repo.git).']);
    assert.deepStrictEqual(t.log, ['dialog:Clone a repository', 'check', 'dialog:Clone a repository'], 'no options, pick or create');
    const n = rig([null]);
    await n.flow.start('clone');
    assert.deepStrictEqual(n.log, ['dialog:Clone a repository'], 'Escape at the URL: nothing');
  }
  // FR-061, Q6 = a: in Allow all the confirmation comes after the URL and names the host only (never the user part or path)
  {
    const u = 'https://lena@github.com/o/r.git';
    const t = rig([{ value: 'ok', text: u }, { value: 'ok', text: 'r' }], { mode: 'allow', check: [{ ok: true, host: 'github.com', suggested: 'r', shown: 'https://[redacted]@github.com/o/r.git' }, { ok: true }] });
    await t.flow.start('clone');
    assert.deepStrictEqual(t.log.slice(0, 5), ['dialog:Clone a repository', 'check', 'confirm:the repository you clone next', 'options', 'pick']);
    assert.deepStrictEqual(t.confirms, [['the repository you clone next', 'This code comes from github.com; agents can run it without asking.']]);
    assert.ok(!/lena|\/o\/r/.test(String(t.confirms[0][1])), 'no user part or path in the sentence');
    assert.strictEqual((t.sent[2] as unknown[])[2], 'allow');
    const no = rig([{ value: 'ok', text: u }], { mode: 'allow', confirm: false, check: [{ ok: true, host: 'github.com', suggested: 'r', shown: u }] });
    await no.flow.start('clone');
    assert.deepStrictEqual(no.log, ['dialog:Clone a repository', 'check', 'confirm:the repository you clone next'], 'a No: no pick, no create');
    // a hostile host-like string is passed on as plain text (the page's askDialog sets it with textContent; shots-093 checks the DOM)
    const h = rig([{ value: 'ok', text: u }], { mode: 'allow', confirm: false, check: [{ ok: true, host: '<img src=x onerror=alert(1)>', suggested: '', shown: u }] });
    await h.flow.start('clone');
    assert.strictEqual(h.confirms[0][1], 'This code comes from <img src=x onerror=alert(1)>; agents can run it without asking.', 'text, not HTML: no escaping here, none undone');
    // empty folder and new repository keep today's text (no extra sentence)
    const e = rig([{ value: 'ok', text: 'x' }], { mode: 'allow' });
    await e.flow.start('init');
    assert.deepStrictEqual(e.confirms, [['the folder you create next', undefined]]);
  }
  // FR-040, FR-041: progress events reach the dialog; Cancel asks main, the result says nothing was kept and nothing is added
  {
    let release: (v: unknown) => void = () => undefined;
    const t = rig([{ value: 'ok', text: URL1 }, { value: 'ok', text: 'shop' }], { check: [OKURL, { ok: true }], createNow: () => new Promise((r) => { release = r; }) });
    const run = t.flow.start('clone');
    for (let i = 0; i < 20 && !t.progressCbs.length; i++) await new Promise((r) => setImmediate(r));
    assert.strictEqual(t.progressCbs.length, 1, 'subscribed while the clone runs');
    t.progressCbs[0]({ phase: 'Receiving objects', percent: 45, lines: ['Receiving objects:  45%'], elapsedMs: 900 });
    assert.deepStrictEqual(t.views[0].updates, [{ phase: 'Receiving objects', percent: 45, lines: ['Receiving objects:  45%'], elapsedMs: 900 }]);
    assert.strictEqual(t.flow.busy(), true);
    t.views[0].cancel();
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    assert.ok(t.log.includes('cancel'), 'Cancel asks main to end the clone');
    release({ ok: false, agents: [], cancelled: true, error: 'Cancelled. Nothing was kept.' });
    await run;
    assert.deepStrictEqual(t.log.slice(-4), ['unsubscribe', 'progress-close', 'toast:Cancelled. Nothing was kept.', 'announce:Cancelled. Nothing was kept.']);
    assert.ok(!t.log.some((l) => l.startsWith('done:')) && [...t.progressCbs].length === 0 && t.views[0].closed, 'nothing added, unsubscribed, the dialog closed');
    assert.strictEqual(t.flow.busy(), false);
  }
  // a failed clone: back to the name step with main's message and the name kept; a later try works; the submodule note
  {
    const t = rig([{ value: 'ok', text: URL1 }, { value: 'ok', text: 'shop' }, { value: 'ok', text: 'shop' }], { check: [OKURL, { ok: true }, { ok: true }], create: [{ ok: false, agents: [], error: 'Sign-in failed: Durbar uses your own git credentials and cannot ask for a password.' }, { ok: true, agents: [{ id: 'x' }], name: 'shop', submodules: true }] });
    await t.flow.start('clone');
    assert.deepStrictEqual([t.dialogs[2].input?.value, t.dialogs[2].input?.error], ['shop', 'Sign-in failed: Durbar uses your own git credentials and cannot ask for a password.']);
    assert.strictEqual(t.log[t.log.length - 1], 'done:Cloned into shop. Submodules were not cloned.');
    assert.strictEqual(t.views.length, 2, 'a progress dialog per try');
  }
  // without Cancel or progress in the bridge, a clone is not offered to start
  {
    const t = rig([], { noCancel: true });
    await t.flow.start('clone');
    assert.deepStrictEqual(t.log, ['toast:Creating a folder is not available here.']);
  }
  assert.strictEqual(NF.hostSentence('h.example'), 'This code comes from h.example; agents can run it without asking.');
}

flows().then(() => {
  process.exitCode = 0;
  console.log(`newfolder: ${REFUSED.length} refused and ${ACCEPTED.length} accepted names, ${URL_REFUSED.length} refused and ${URL_ACCEPTED.length} accepted clone URLs, suggested names, failure texts, progress lines, one device-name rule, the remembered parent, the window's flow (clone included) OK`);
}).catch((e) => { console.error(e); process.exit(1); });
