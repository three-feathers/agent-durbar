/**
 * Profile file editor (spec 043 FR-014/FR-015, T012c): the front matter check, the preview throttle, the remembered mode, and the
 * preview's sanitisation in a real page (jsdom): the editor wired to the chat's Markdown renderer must not run or keep `<script>`,
 * `onerror`, `javascript:` links or images, and front matter values are text. `npm run test:profileeditor`. No Electron, no credits.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string, o?: unknown) => { window: any } }; // eslint-disable-line @typescript-eslint/no-explicit-any

const root = path.join(__dirname, '..', '..');
const R = (f: string): string => path.join(root, 'src', 'renderer', f);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PE = require(R('profileeditor.js')) as {
  parseFrontmatter(t: string): { has: boolean; closed: boolean; entries: { key: string; value: string; line: number }[]; errors: { line: number; msg: string }[]; body: string; bodyLine: number };
  throttle(fn: () => void, ms: number, timers?: unknown): (() => void) & { flush(): void; cancel(): void };
  loadMode(s: unknown): string;
  saveMode(s: unknown, m: string): void;
  NAME_RE: RegExp;
  validName(n: unknown): boolean;
  newFileName(app: string, n: string): string;
  newDirHint(app: string, scope: string, userDirs?: unknown): string;
  joinHint(dir: string, file: string): string;
  samePath(a: string, b: string, platform: string): boolean;
};

// ---- spec 043 FR-040 (review on #572): the Delete path match folds case only on Windows and macOS ----
{
  assert.strictEqual(PE.samePath('/w/App/.github/agents/x.agent.md', '/w/app/.github/agents/x.agent.md', 'linux'), false, 'Linux: /w/App and /w/app are two folders');
  assert.strictEqual(PE.samePath('/w/app/x.md', '/w/app/x.md', 'linux'), true, 'Linux: the same path');
  assert.strictEqual(PE.samePath('/w/App/x.md', '/w/app/x.md', ''), false, 'unknown platform: no folding');
  assert.strictEqual(PE.samePath('/w/App/x.md', '/w/app/x.md', 'darwin'), true, 'macOS: case folded');
  assert.strictEqual(PE.samePath('C:\\W\\x.md', 'c:/w/x.md', 'win32'), true, 'Windows: separators and drive letter case');
  assert.strictEqual(PE.samePath('a\\b', 'a/b', 'linux'), true, 'separators normalised everywhere');
}

// ---- front matter (FR-015) ----
{
  const ok = PE.parseFrontmatter('---\nname: Reviewer\ndescription: "Reviews: changes"   # a comment\ntools: [view, "grep", \'glob\']\nmodel: sim-deep\nlist:\n  - a\n  - "b"\nmcp-servers:\n  github:\n    type: http\nprompt: |\n  line one\n  line two\n---\n\n# Body\n');
  assert.strictEqual(ok.has && ok.closed, true);
  assert.deepStrictEqual(ok.errors, []);
  const v = Object.fromEntries(ok.entries.map((e) => [e.key, e.value]));
  assert.strictEqual(v.name, 'Reviewer');
  assert.strictEqual(v.description, 'Reviews: changes', 'quoted value with ": " and a trailing comment');
  assert.strictEqual(v.tools, 'view, grep, glob');
  assert.strictEqual(v.list, 'a, b');
  assert.strictEqual(v['mcp-servers'], 'github:; type: http', 'nested block shown as text');
  assert.strictEqual(v.prompt, 'line one line two');
  assert.strictEqual(ok.body, '\n# Body\n');
  assert.strictEqual(ok.bodyLine, 16);
  const none = PE.parseFrontmatter('# Just markdown\n');
  assert.strictEqual(none.has, false);
  assert.strictEqual(none.body, '# Just markdown\n');
  assert.deepStrictEqual(PE.parseFrontmatter('﻿---\r\nname: x\r\n---\r\nb').entries.map((e) => e.value), ['x'], 'BOM and CRLF');
  const cases: [string, RegExp][] = [
    ['---\nname: x\n', /no closing ---/],
    ['---\nname: "x\n---\n', /Line 2: a quote " is not closed/],
    ["---\nname: 'x\n---\n", /Line 2: a quote ' is not closed/],
    ['---\ntools: [a, b\n---\n', /Line 2: a list \[ is not closed/],
    ['---\njust words\n---\n', /Line 2: expected "key: value"/],
    ['---\nname: a\nname: b\n---\n', /Line 3: the key "name" is given twice/],
    ['---\nname: a\n\tx: 1\n---\n', /Line 3: a tab is used to indent/],
    ['---\n  x: 1\n---\n', /Line 2: an indented line with no key above it/],
    ['---\n- a\n---\n', /Line 2: a list item with no key above it/],
    ['---\ndescription: Use when: drafting\n---\n', /Line 2: a value with ": " in it needs quotes/],
    ['---\nk:\n  - a\n  b: c\n---\n', /Line 4: a key inside a list/],
  ];
  for (const [t, re] of cases) {
    const r = PE.parseFrontmatter(t);
    assert.ok(r.errors.some((e) => re.test(e.msg)), `${JSON.stringify(t)} -> ${JSON.stringify(r.errors)}`);
  }
  const many = PE.parseFrontmatter('---\n' + 'bad line\n'.repeat(100) + '---\n');
  assert.strictEqual(many.errors.length, 20, 'at most 20 errors');
  const t0 = Date.now();
  PE.parseFrontmatter('---\n' + 'k: "' + 'a'.repeat(200000) + '\n---\n' + 'x'.repeat(200000));
  assert.ok(Date.now() - t0 < 1000, 'a long line is parsed quickly');
}

// ---- names, file names, mode memory ----
{
  for (const n of ['reviewer', 'a', 'Docs_writer-2.1']) assert.ok(PE.NAME_RE.test(n), n);
  for (const n of ['', '.x', '../x', 'a/b', 'a b', 'x'.repeat(65)]) assert.ok(!PE.NAME_RE.test(n), n);
  assert.strictEqual(PE.newFileName('copilot', 'r'), 'r.agent.md');
  assert.strictEqual(PE.newFileName('claude', 'r'), 'r.md');
  // review on #488 (change 6): Windows device names are refused in the form too (main's copy: test:profilefiles keeps them equal)
  for (const n of ['CON', 'con', 'nul.txt', 'Aux', 'PRN', 'COM1', 'lpt9', 'con.backup']) assert.ok(!PE.validName(n), n);
  for (const n of ['console', 'com10', 'reviewer']) assert.ok(PE.validName(n), n);
  // review on #488 (change 7): the hint shows main's real user folders (CLAUDE_CONFIG_DIR), with the folder's own separator
  assert.strictEqual(PE.newDirHint('claude', 'user', { claude: '/cfg/claude/agents', copilot: '/h/.copilot/agents' }), '/cfg/claude/agents');
  assert.strictEqual(PE.newDirHint('copilot', 'user', { claude: '/cfg/claude/agents', copilot: '/h/.copilot/agents' }), '/h/.copilot/agents');
  assert.strictEqual(PE.newDirHint('claude', 'user'), '~/.claude/agents', 'an older main without userDirs: the ~ form');
  assert.strictEqual(PE.newDirHint('claude', 'folder', { claude: '/cfg' }), '.claude/agents');
  assert.strictEqual(PE.joinHint('C:\\Users\\me\\cfg\\agents', 'r.md'), 'C:\\Users\\me\\cfg\\agents\\r.md');
  assert.strictEqual(PE.joinHint('/cfg/agents/', 'r.md'), '/cfg/agents/r.md');
  const mem: Record<string, string> = {};
  const store = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v; } };
  assert.strictEqual(PE.loadMode(store), 'split', 'default Split');
  PE.saveMode(store, 'preview');
  assert.strictEqual(PE.loadMode(store), 'preview');
  PE.saveMode(store, 'bogus');
  assert.strictEqual(PE.loadMode(store), 'preview', 'unknown modes are not saved');
  const throwing = { getItem: () => { throw new Error('no storage'); }, setItem: () => { throw new Error('no storage'); } };
  assert.strictEqual(PE.loadMode(throwing), 'split', 'storage blocked: default');
  PE.saveMode(throwing, 'edit');
}

// ---- throttle: at most once per window, the last call is kept ----
{
  let now = 0;
  const q: { at: number; f: () => void }[] = [];
  const timers = { set: (f: () => void, d: number) => { const t = { at: now + d, f }; q.push(t); return t; }, clear: (t: unknown) => { const i = q.indexOf(t as never); if (i >= 0) q.splice(i, 1); }, now: () => now };
  const tick = (ms: number) => { now += ms; for (const t of q.filter((x) => x.at <= now)) { q.splice(q.indexOf(t), 1); t.f(); } };
  let n = 0;
  const th = PE.throttle(() => n++, 150, timers);
  th(); assert.strictEqual(n, 1, 'the first call runs at once');
  th(); th(); th(); assert.strictEqual(n, 1);
  tick(149); assert.strictEqual(n, 1);
  tick(1); assert.strictEqual(n, 2, 'one trailing call');
  th(); assert.strictEqual(n, 2); th.flush(); assert.strictEqual(n, 3, 'flush runs it now');
  th(); th.cancel(); tick(500); assert.strictEqual(n, 3, 'cancel drops it');
}

// ---- the editor in a page: preview sanitisation, front matter header as text, modes, dirty, save, unsaved guard ----
(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', url: 'http://localhost/index.html' });
  const w = dom.window;
  for (const f of [path.join(root, 'node_modules', 'marked', 'lib', 'marked.umd.js'), path.join(root, 'node_modules', 'dompurify', 'dist', 'purify.min.js'), R('markdown.js'), R('dialog.js'), R('profileeditor.js')]) w.eval(fs.readFileSync(f, 'utf8'));
  let ran = 0;
  w.__pwned = () => { ran++; };
  const EVIL = '---\nname: <img src=x onerror=__pwned()>\ndescription: "<script>__pwned()</script>"\n---\n\n<script>__pwned()</script>\n\n<img src="x" onerror="__pwned()">\n\n[click](javascript:__pwned()) [ok](https://example.com) [data](data:text/html,<script>__pwned()</script>)\n\n![pic](file:///etc/passwd)\n\n<a href="javascript:__pwned()" onclick="__pwned()">raw</a>\n';
  const info = { id: 'a'.repeat(32), app: 'copilot', scope: 'folder', folder: '/w', fileName: 'evil.agent.md', path: '/w/.github/agents/evil.agent.md', name: 'evil', size: 1, writable: true };
  const saved: { text: string; base: string; over: boolean }[] = [];
  const opened: string[] = [];
  let conflictOnce = false;
  const created: unknown[][] = [];
  const bridge = {
    readProfileFile: async () => ({ ok: true, info, text: EVIL, sha256: 'h0', eol: 'lf' }),
    saveProfileFile: async (_id: string, text: string, base: string, over: boolean) => {
      saved.push({ text, base, over });
      if (conflictOnce && !over) { conflictOnce = false; return { ok: false, conflict: true, error: 'The file changed on disk since you opened it.' }; }
      return { ok: true, sha256: 'h' + saved.length, info };
    },
    listProfileFiles: async () => ({ ok: true, folders: [{ id: 'a'.repeat(32), path: '/w' }], files: [info], userDirs: { copilot: '/home/me/.copilot/agents', claude: '/cfg/claude/agents' } }),
    createProfileFile: async (...a: unknown[]) => { created.push(a); return { ok: false, error: 'not in this test' }; },
    openExternal: async (u: string) => { opened.push(u); },
  };
  const askDialog = w.DurbarDialog(w.document);
  w.DurbarProfileEditor.init({ bridge, askDialog, toast: () => undefined, esc: (s: string) => String(s) });
  await w.DurbarProfileEditor.open(info.id);
  const $ = (id: string) => w.document.getElementById(id);
  const md = $('peMd'), fm = $('peFm');
  assert.ok(md && fm, 'editor open');
  assert.strictEqual(md.querySelectorAll('script,img,iframe,object,embed,svg').length, 0, 'no script or image elements in the preview');
  assert.strictEqual(fm.querySelectorAll('*:not(dt):not(dd)').length, 0, 'front matter header holds only dt/dd');
  for (const el of [...md.querySelectorAll('*'), ...fm.querySelectorAll('*')]) {
    for (const a of [...el.attributes]) assert.ok(!/^on/i.test(a.name), `no ${a.name} attribute`);
  }
  const hrefs = [...md.querySelectorAll('a[href]')].map((a: { getAttribute(n: string): string }) => a.getAttribute('href'));
  assert.deepStrictEqual(hrefs, ['https://example.com'], 'only the https link keeps its href');
  assert.ok(fm.textContent.includes('<img src=x onerror=__pwned()>'), 'a front matter value is shown as text');
  assert.ok(md.textContent.includes('<script>__pwned()</script>'), 'raw HTML in the body is shown as text');
  assert.strictEqual(ran, 0, 'nothing ran');
  // a click on a link goes through openExternal (http/https only), never navigates
  md.querySelector('a[href]').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.deepStrictEqual(opened, ['https://example.com']);
  // modes: Split by default, Edit / Preview hide the other half, and the choice is kept
  assert.strictEqual($('peMain').dataset.mode, 'split');
  w.document.querySelector('#peModes [data-pm="preview"]').click();
  assert.strictEqual($('peMain').dataset.mode, 'preview');
  assert.strictEqual(w.localStorage.getItem('durbar.profileEditor.mode'), 'preview');
  w.document.querySelector('#peModes [data-pm="split"]').click();
  // dirty, Ctrl+S, base hash
  const src = $('peSrc');
  assert.strictEqual($('peDirty').hidden, true);
  assert.strictEqual($('peSave').disabled, true, 'nothing to save yet');
  src.value = '---\nname: fixed\n---\n\nHello';
  src.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.strictEqual($('peDirty').hidden, false, 'Unsaved shows');
  src.dispatchEvent(new w.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 20));
  assert.deepStrictEqual(saved[0], { text: '---\nname: fixed\n---\n\nHello', base: 'h0', over: false });
  assert.strictEqual($('peDirty').hidden, true, 'saved: Unsaved goes');
  // conflict: Overwrite sends overwrite=true
  conflictOnce = true;
  src.value = 'changed again';
  src.dispatchEvent(new w.Event('input', { bubbles: true }));
  $('peSave').click();
  await new Promise((r) => setTimeout(r, 20));
  const btns = [...w.document.querySelectorAll('#modeDlg .dbtn button')] as { textContent: string; click(): void }[];
  assert.deepStrictEqual(btns.map((b) => b.textContent), ['Cancel', 'Reload', 'Overwrite'], 'conflict question');
  btns[2].click();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepStrictEqual(saved.slice(-2).map((s) => [s.base, s.over]), [['h1', false], ['h1', true]], 'the new base, then overwrite');
  // unsaved guard: Escape asks; Keep editing keeps it open; Discard closes
  src.value = 'unsaved';
  src.dispatchEvent(new w.Event('input', { bubbles: true }));
  src.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 20));
  assert.ok($('modeDlg'), 'asks before closing');
  ([...w.document.querySelectorAll('#modeDlg .dbtn button')] as { textContent: string; click(): void }[]).find((b) => b.textContent === 'Keep editing')!.click();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok($('peOv'), 'still open');
  $('peClose').click();
  await new Promise((r) => setTimeout(r, 20));
  ([...w.document.querySelectorAll('#modeDlg .dbtn button')] as { textContent: string; click(): void }[]).find((b) => b.textContent === 'Discard')!.click();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(!$('peOv'), 'closed after Discard');
  assert.strictEqual(saved.length, 3, 'nothing saved on Discard');
  assert.strictEqual(ran, 0);
  // New profile (review on #488, changes 6 and 7): the hint names the user folder main sent (CLAUDE_CONFIG_DIR), and a Windows device name is refused before main is asked
  void w.DurbarProfileEditor.newProfile();
  await new Promise((r) => setTimeout(r, 20));
  const sel = (id: string) => $(id) as unknown as { value: string; dispatchEvent(e: unknown): boolean };
  sel('peNApp').value = 'claude';
  sel('peNPlace').value = 'user';
  sel('peNName').value = 'helper';
  sel('peNName').dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.strictEqual($('peNHint').textContent, 'File: /cfg/claude/agents/helper.md', 'the real Claude user folder');
  sel('peNApp').value = 'copilot';
  sel('peNApp').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.strictEqual($('peNHint').textContent, 'File: /home/me/.copilot/agents/helper.agent.md', 'the real Copilot user folder');
  sel('peNName').value = 'CON';
  $('peNGo').click();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(/reserved on Windows/.test($('peNErr').textContent) && !$('peNErr').hidden, 'CON is refused in the form');
  assert.strictEqual(created.length, 0, 'and main is not asked');
  $('peNCancel').click();
  console.log('profile editor tests passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
