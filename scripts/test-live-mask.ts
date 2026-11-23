/**
 * Spec 012 FR-195 (issue #1419): toasts (`#toasts`, a polite live region) and the notice strips (`#restoreStrip`, `#crashStrip`,
 * `#awayStrip`, `#mcpStrip`) show and say an agent's, a folder's or an MCP server's name only through FR-178's announcement mask.
 * `liveMask(root, blocks)` in `src/renderer/app.js` masks every text node, `title` and `aria-label` with `annPart`, then reads each block
 * once more as one joined text (a value split across markup) and keeps the union. The page's own definitions are cut out of app.js and
 * run in jsdom with the compiled shared mask, so a change to the page's code is what is tested. A differential fuzz compares with a frozen
 * copy of `main`'s announcement mask: no word `main` hides in a line may be shown in the same text as a toast. Fake values only, built
 * from pieces of at most six characters at run time. `npm run test:livemask`. No credits spent.
 */
import './safetext-shared';
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import * as shared from '../src/shared/redact';
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => { window: Window & typeof globalThis } };

const R_DIR = path.join(__dirname, '..', '..', 'src', 'renderer');
const app = fs.readFileSync(path.join(R_DIR, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const LINES = app.split('\n');
let n = 0;
const ok = (c: unknown, m: string): void => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string): void => { assert.deepStrictEqual(a, b, m); n++; };

// one whole line of app.js that starts with `head`
const line = (head: string): string => {
  const l = LINES.filter((x) => x.startsWith(head));
  assert.strictEqual(l.length, 1, `app.js has exactly one line starting with ${head}`);
  return l[0];
};
// a definition that starts on a line with `head` and ends at the next line that is exactly `}` (or on the line after, for two-line ones)
const block = (head: string): string => {
  const i = LINES.findIndex((x) => x.startsWith(head));
  assert.ok(i >= 0, `app.js has a line starting with ${head}`);
  const j = LINES.findIndex((x, k) => k > i && x === '}');
  return LINES.slice(i, j + 1).join('\n');
};
const twoLines = (head: string): string => { const i = LINES.findIndex((x) => x.startsWith(head)); assert.ok(i >= 0, head); return LINES[i] + '\n' + LINES[i + 1]; };

const DEFS = ['const homeMask=', 'const helperMask=', 'const deskMask=', 'const SHORT=', 'const RED=', 'const STX=', 'const SAFE=',
  'const safeExcerpt=', 'const esc=', 'function annHome(', 'function annPart(', 'function liveText(', 'function liveMask(', 'function stripMask(', 'function toast('].map(line).join('\n')
  + '\n' + twoLines('function mountToast(') + '\n' + block('function toastActions(') + '\n' + block('function paintMcpStrip(') + '\n' + block('function renderRestoreStrip(') + '\n' + ['const crashSt=', 'const crashLeft='].map(line).join('\n')
  + '\n' + block('function paintCrashStrip(') + '\n' + twoLines('const awayWords=') + '\n' + block('async function renderAwayStrip(') + '\n' + block('function afRender(');

// main's announcement mask on 2026-11-23 (ee96eefb3), frozen: the reference of the differential fuzz below
const FROZEN_MAIN: string[] = [
  "const homeMask=t=>{const R=window.DurbarRedact;if(!R||typeof R.maskHomePaths!=='function')return t;const h=R.maskHomePaths(t);return typeof h==='string'?h:'';};",
  "const deskMask=t=>safeMask(t); /* the one mask (DurbarSafeText, FR-065): unescaped, Markdown-aware, '' when redact is missing */",
  "const SHORT=(v,n)=>DurbarCutText.cutText(v,n);",
  "const RED=!NO_REDACT&&window.DurbarRedact&&typeof window.DurbarRedact.redact==='function'?window.DurbarRedact:null;",
  "const STX=window.DurbarSafeText; /* if safetext.js did not load the page still draws, and shows no agent text */",
  "const SAFE=STX?STX.create({redact:RED?t=>RED.redact(t):null,cut:SHORT}):{ready:false,mask:()=>'',excerpt:(t,n,fb)=>t?(fb==null?'Finished.':fb):''}; /* spec 041 FR-065: agent text is masked on the raw text, then made plain, then cut; no redact module: neutral words, never the raw text */",
  "const safeExcerpt=(t,n,fb)=>SAFE.excerpt(t,n,fb),safeMask=t=>SAFE.mask(t);",
  "function annHome(s){const R=window.DurbarRedact,c=R&&typeof R.unhide==='function'?R.unhide(s):s;let w=s,h=homeMask(s);if(typeof c==='string'&&c!==s){const hc=homeMask(c);if(hc!==c){w=c;h=hc;}} /* the copy without hidden characters, when it holds a home folder */if(typeof h!=='string'||!STX||typeof STX.unesc!=='function')return h;const u=STX.unesc(w),hu=homeMask(u);return typeof hu!=='string'||hu===u||STX.unesc(h)===hu?h:'[redacted]';} /* review of PR 1484: a home folder whose name holds a Markdown escape (/home/a\\_b) is cut short by the home mask as written; when the escape-undone copy holds a home folder and masks to something else, the part is said as [redacted] (never with its escapes undone, as annPart) */",
  "function annPart(t){const s=String(t==null?'':t);if(!s)return '';const h=annHome(s);if(typeof h!=='string'||!h)return null;const m=deskMask(h);if(typeof m!=='string'||!m||m.includes('[redaction failed]')||!STX||typeof STX.unesc!=='function')return null;const u=STX.unesc(h);return m===u?h:u===h?m:'[redacted]';}",
];

type Mode = boolean | 'throws' | 'failed' | 'noredact' | 'nokeep';
type Page = { doc: Document; toast(html: string): HTMLElement; toastActions(html: string, labels: string[]): HTMLElement;
  liveMask(root: Element, blocks: Element[]): Element; mcp(items: Record<string, string>[], open: boolean): HTMLElement; ref(t: string): string | null;
  restore(folder: string): HTMLElement; crash(folder: string): HTMLElement; away(folder: string, prompt: string): Promise<HTMLElement>; follow(name: string): HTMLElement };
// what the strips' stubs hand out (the away strip's main reply, the followed agent's name)
const STRIP: { away: unknown; follow: string } = { away: null, follow: '' };
const page = (mode: Mode): Page => {
  const dom = new JSDOM('<!doctype html><body><div id="toasts"></div>' + ['mcpStrip', 'restoreStrip', 'crashStrip', 'awayStrip', 'followStrip'].map((i) => `<div id="${i}" hidden></div>`).join('') + '</body>');
  const doc = dom.window.document;
  const R = mode === 'throws' ? { ...shared, maskHomePaths: () => { throw new Error('boom'); } }
    : mode === 'failed' ? { ...shared, maskHomePaths: () => '[redaction failed]' } : mode === 'nokeep' ? { ...shared, keepShownBy: undefined } : mode ? shared : undefined;
  const base = {
    window: { DurbarRedact: R, DurbarSafeText: require(path.join(R_DIR, 'safetext.js')), DurbarScreens: { openSettings() {} } },
    DurbarCutText: require(path.join(R_DIR, 'cuttext.js')),
    document: doc, NodeFilter: dom.window.NodeFilter,
    NO_REDACT: !mode || mode === 'noredact',
    $: (id: string) => doc.getElementById(id),
    setTimeout: () => 1, clearTimeout: () => {},
  };
  const ctx = vm.createContext({ ...base, placeToasts() {}, holdTimer() {}, scheduleRender() {}, focusIn() {}, ResizeObserver: undefined,
    mcpL: { closed: false, open: false, items: new Map() }, liveById: (id: string) => ({ id, info: { resumeLast: true } }),
    agents: [] as unknown[], roomOf: (a: { room: { id: string; name: string } }) => a.room, ui: {}, updatePanelHeader() {}, busy: () => () => {},
    bridge: { sinceAway: async () => STRIP.away, runScheduleNow: async () => ({ ok: true }) }, demoOn: false, SSUM: null,
    AF_ON: true, AF_PAUSED: false, AF_HOLD: '', afLive: () => [], afPanelId: () => null, byId: (id: string) => ({ id, name: STRIP.follow }), afCanOpen: () => true,
    afGo() {}, afSetPaused() {},
    AF: { position: () => ({ index: -1, count: 0 }), positionText: () => 'none', statusText: (o: { name?: string }) => 'Following ' + (o.name || '') + '.' },
    AFT: { ids: () => ['f1'], pendingList: () => [], size: 1 } });
  vm.runInContext(DEFS + '\nthis.toast=toast;this.toastActions=toastActions;this.liveMask=liveMask;this.paintMcpStrip=paintMcpStrip;this.renderRestoreStrip=renderRestoreStrip;this.paintCrashStrip=paintCrashStrip;this.renderAwayStrip=renderAwayStrip;this.afRender=afRender;this.crashSt=crashSt;', ctx);
  const refCtx = vm.createContext({ ...base, window: { ...base.window, DurbarRedact: mode ? shared : undefined }, NO_REDACT: !mode });
  vm.runInContext(FROZEN_MAIN.join('\n') + '\nthis.annPart=annPart;', refCtx);
  const C = ctx as unknown as { toast(h: string, ms?: number): HTMLElement; toastActions(h: string, a: { label: string; onClick(): void }[], ms?: number): HTMLElement;
    liveMask(r: Element, b: Element[]): Element; paintMcpStrip(): void; mcpL: { closed: boolean; open: boolean; items: Map<string, unknown> } };
  return {
    doc,
    toast: (h) => C.toast(h, 1000),
    toastActions: (h, labels) => C.toastActions(h, labels.map((label) => ({ label, onClick() {} })), 1000),
    liveMask: (r, b) => C.liveMask(r, b),
    mcp(items, open) { C.mcpL.items = new Map(items.map((f) => [f.key, f])); C.mcpL.open = open; C.mcpL.closed = false; C.paintMcpStrip(); return doc.getElementById('mcpStrip') as HTMLElement; },
    ref: (t) => (refCtx as unknown as { annPart(t: string): string | null }).annPart(t),
    restore(folder) { (ctx as unknown as { agents: unknown[] }).agents = [{ id: 'a1', live: true, info: { permMode: 'allow', permRestored: true }, room: { id: 'r1', name: folder } }];
      const el = doc.getElementById('restoreStrip') as HTMLElement; delete el.dataset.kept; (ctx as unknown as { renderRestoreStrip(): void }).renderRestoreStrip(); return el; },
    crash(folder) { const cs = (ctx as unknown as { crashSt: { items: unknown[]; pick: boolean; missing: number } }).crashSt; cs.items = [{ id: 'c1', folderName: folder, adapterId: 'claude' }]; cs.pick = true; cs.missing = 0;
      (ctx as unknown as { paintCrashStrip(): void }).paintCrashStrip(); return doc.getElementById('crashStrip') as HTMLElement; },
    async away(folder, prompt) { STRIP.away = { awayMs: 3600000, missed: [{ id: 's1', folderName: folder, prompt }] }; await (ctx as unknown as { renderAwayStrip(): Promise<void> }).renderAwayStrip(); return doc.getElementById('awayStrip') as HTMLElement; },
    follow(name) { STRIP.follow = name; (ctx as unknown as { afRender(): void }).afRender(); return doc.getElementById('followStrip') as HTMLElement; },
  };
};
const escH = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
// everything a toast or strip shows or says: its text and its labels
const shown = (el: Element): string => [el.textContent || '', ...[el, ...Array.from(el.querySelectorAll('*'))].flatMap((e) => ['title', 'aria-label'].map((k) => e.getAttribute(k) || ''))].join('\n');

// fake secrets, never real ones, from pieces of at most six characters
const P = (...p: string[]): string => p.join('');
const BODY = P('A1b2C3', 'd4E5f6', 'G7h8I9', 'j0K1l2', 'M3n4O5', 'p6Q7r8');
const GHP = P('gh', 'p_', BODY);
const SK = P('s', 'k-', 'proj-', 'AbCdEf', 'GhIjKl', 'MnOpQr', 'StUvWx', 'Yz0123', '456789');
const USER = P('zqxus', 'ername');
const PW = P('Vq7k', 'Zp9m', 'Lw3x');
const NAMES: [string, string][] = [
  ['a GitHub token', 'fix ' + GHP],
  ['an OpenAI key', 'agent ' + SK],
  ['a Linux home folder', '/home/' + USER + '/repo'],
  ['a macOS home folder', '/Users/' + USER + '/repo'],
  ['a Windows home folder', 'C:\\Users\\' + USER + '\\repo'],
  ['a UNC home folder', '\\\\host\\share\\' + USER + '\\repo'],
  ['a Markdown-escaped token', P('gh', 'p\\_') + BODY],
  ['a home folder with a zero-width space', '/ho\u200bme/' + USER + '/repo'],
  ['a home user name with an escape', '/home/zq\\_' + USER + '/repo'],
];
const NEEDLES = [GHP, BODY.slice(0, 12), SK.slice(8, 20), USER, P('gh', 'p_A1b2')];
const hides = (s: string, what: string): void => { for (const x of NEEDLES) ok(!s.includes(x), `${what}: no piece ${x.slice(0, 4)}… is shown`); };

const pg = page(true);

// 1. a plain toast, per hostile name, in the forms the call sites use
for (const [what, nm] of NAMES) {
  for (const [form, html] of [
    ['bold name', 'Theme <b>' + escH(nm) + '</b> removed. Clean Office is on.'],
    ['name first', escH(nm) + ' was deleted.'],
    ['error text', 'Could not run it: ' + escH('failed in ' + nm)],
  ] as const) {
    const t = pg.toast(html);
    hides(shown(t), `FR-195 toast, ${form}, ${what}`);
    ok(pg.doc.getElementById('toasts')!.contains(t), `FR-195 toast, ${form}, ${what}: the toast is shown`);
  }
}
// 2. a toast with action buttons: the message is masked, the buttons keep their labels and stay buttons
{
  const t = pg.toastActions(escH('fix ' + GHP) + ' moved to <b>Floor 2</b>.', ['Undo', 'Show']);
  hides(shown(t), 'FR-195 toast with actions');
  eq(Array.from(t.querySelectorAll('button.toast-act')).map((b) => b.textContent), ['Undo', 'Show'], 'FR-195 toast with actions: the buttons are kept');
  ok(/moved to Floor 2\./.test(t.textContent || ''), 'FR-195 toast with actions: the fixed words are kept');
}
// 3. benign text is kept byte for byte, markup included (nothing to hide: no change)
{
  const html = 'Theme <b>Night shift</b> removed. Run <code>git log \\*.md</code> again, echo \\\\$(id).';
  const t = pg.toast(html);
  eq(t.innerHTML, html, 'FR-195 a benign toast is kept as written, markup and backslashes included');
}
// 4. a value split across markup: the joined reading hides it (union with the per-node reading)
{
  const t = pg.toast('Not written: password=<b>' + PW + '</b> was refused.');
  ok(!(t.textContent || '').includes(PW), 'FR-195 a value split across markup is hidden by the joined reading');
  eq(pg.ref('Not written: password=' + PW + ' was refused.')!.includes(PW), false, 'FR-195 (control) main\'s announcement hides the joined value');
  const t2 = pg.toast('<b>' + GHP.slice(0, 20) + '</b>' + GHP.slice(20) + ' done');
  ok(!(t2.textContent || '').includes(BODY.slice(0, 12)), 'FR-195 a token split by markup is hidden by the joined reading');
}
// 4b. the union: a word the joined reading of the text as built hides (a line with a secret and an escape is hidden whole) is never shown
{
  const t = pg.toast(escH('--password ' + PW) + ' <b>' + escH(P('gh', 'p\\_') + BODY) + '</b>');
  eq(pg.ref('--password ' + PW + ' ' + P('gh', 'p\\_') + BODY), '[redacted]', 'FR-195 (control) main\'s announcement hides the whole line');
  ok(!(t.textContent || '').includes(PW), 'FR-195 union: a word the joined reading hides is not shown');
}
// 4b2. piece level: a value cut by markup where one side is masked alone keeps no piece of the other side that the joined reading hides
{
  const t = pg.toast('Saved in <b>/home/' + P('zqxus') + '</b>' + P('ername') + '/r.');
  ok(!(t.textContent || '').includes(P('erna')), 'FR-195 piece level: no piece of a value cut by markup is shown');
}
// 4c. without the shared piece-level union the block fails closed
{
  const t = page('nokeep').toast('Not written: password=<b>' + PW + '</b> was refused.');
  eq(t.textContent, '[redacted]', 'FR-195 no keepShownBy: the block is hidden whole');
}
// 5. labels: title and aria-label are masked too
{
  const t = pg.toast('<span title="' + escH('fix ' + GHP) + '" aria-label="' + escH('/home/' + USER + '/repo') + '">Saved.</span>');
  hides(shown(t), 'FR-195 toast labels');
  ok((t.textContent || '').includes('Saved.'), 'FR-195 toast labels: the text is kept');
}
// 6. the MCP strip, built by its own function: names, where and the reason text
{
  const items = [{ key: 'k1', name: 'srv ' + GHP, where: '/home/' + USER + '/proj', reason: 'it said ' + SK, fix: 'Sign in again', kind: 'file' }];
  for (const open of [false, true]) {
    const el = pg.mcp(items, open);
    hides(shown(el), `FR-195 MCP strip (${open ? 'list open' : 'one line'})`);
    ok(!el.hidden && !!el.querySelector('[data-ml="close"]'), `FR-195 MCP strip (${open ? 'list open' : 'one line'}): it is shown with its buttons`);
    ok(/MCP problem needs attention/.test(el.textContent || ''), `FR-195 MCP strip (${open ? 'list open' : 'one line'}): its fixed words are kept`);
  }
  const sp = pg.mcp([{ key: 'k3', name: P('gh', 'p\\_') + BODY, where: '', reason: '--password ' + PW, fix: 'Sign in', kind: 'file' }], true);
  ok(!(sp.textContent || '').includes(PW), 'FR-195 MCP strip: a list item is read as one text too (the union)');
  const el = pg.mcp([{ key: 'k2', name: 'github', where: 'Copilot', reason: 'not signed in', fix: 'Sign in', kind: 'file' }], true);
  ok(/: github\./.test(el.textContent || '') && /not signed in\. Sign in/.test(el.textContent || ''), 'FR-195 MCP strip: a benign entry is kept');
}
// 6b. the restore, interrupted-sessions, away and Auto-follow strips, each built by its own function, with a hostile folder or agent name
async function stripsByBehaviour(): Promise<void> {
  for (const [what, nm] of NAMES) {
    const r = pg.restore(nm);
    hides(shown(r), `FR-195 restore strip, ${what}`);
    ok(!r.hidden && /lets agents change files without asking|^\[redacted\]$/.test(r.querySelector('.ns-t')!.textContent || ''), `FR-195 restore strip, ${what}: shown with its fixed words`);
    const c = pg.crash(nm);
    hides(shown(c), `FR-195 crash strip, ${what}`);
    ok(!c.hidden && !!c.querySelector('[data-crrow]'), `FR-195 crash strip, ${what}: shown with its Pick list`);
    const a = await pg.away(nm, 'check the build');
    hides(shown(a), `FR-195 away strip, ${what}`);
    ok(!a.hidden && /Since you were away/.test(a.textContent || ''), `FR-195 away strip, ${what}: shown with its fixed words`);
    const f = pg.follow(nm);
    hides(shown(f), `FR-195 Auto-follow strip, ${what}`);
    ok(!f.hidden && /^Following |^\[redacted\]$/.test(f.querySelector('#afText')!.textContent || ''), `FR-195 Auto-follow strip, ${what}: shown with its fixed words`);
  }
  eq(pg.restore('web-app').querySelector('.ns-t')!.textContent, 'One folder (web-app) lets agents change files without asking.', 'FR-195 restore strip: a benign name is kept');
  eq(pg.follow('Noor').querySelector('#afText')!.textContent, 'Following Noor.', 'FR-195 Auto-follow strip: a benign name is kept');
}
// 7. fails closed: no mask module, ?noredact=1, a throw, the module's own failure text
for (const mode of [false, 'noredact', 'throws', 'failed'] as Mode[]) {
  const p = page(mode);
  const t = p.toast('Theme <b>' + escH('fix ' + GHP) + '</b> removed.');
  hides(shown(t), `FR-195 fails closed (${String(mode)})`);
  ok((t.textContent || '').includes('[not checked]'), `FR-195 fails closed (${String(mode)}): the fixed words [not checked] are shown`);
  const s = p.toast('<i title="' + escH('/home/' + USER) + '">x</i>');
  ok(!shown(s).includes(USER), `FR-195 fails closed (${String(mode)}): a label is not shown`);
}
// 8. source checks: every toast and each strip goes through liveMask before it is shown
{
  const mt = twoLines('function mountToast(');
  ok(/liveMask\(t,/.test(mt) && mt.indexOf('liveMask(') < mt.indexOf('appendChild('), 'FR-195 mountToast masks the toast before it is added');
  ok(/mountToast\(t\)/.test(line('function toast(')) && /mountToast\(t\)/.test(block('function toastActions(')), 'FR-195 toast and toastActions go through mountToast');
  eq(app.split('\n').filter((l) => /\$\('toasts'\)\.append|#toasts'\)\.append|toasts\.append/.test(l)).length, 0, 'FR-195 nothing else appends to #toasts');
  for (const [fn, head] of [['renderRestoreStrip', 'function renderRestoreStrip('], ['paintCrashStrip', 'function paintCrashStrip('],
    ['renderAwayStrip', 'async function renderAwayStrip('], ['paintMcpStrip', 'function paintMcpStrip(']]) {
    const b = block(head), i = b.indexOf('stripMask(el)'), lastSet = Math.max(b.lastIndexOf("el.innerHTML='<"), b.lastIndexOf(".textContent=rooms"));
    ok(i > 0 && i > lastSet, `FR-195 ${fn} masks the strip after it is built`);
    ok(i < b.indexOf('el.hidden=false'), `FR-195 ${fn} masks the strip before it is shown`);
    const after = b.slice(i, b.indexOf('onclick', i) < 0 ? b.length : b.indexOf('onclick', i));
    ok(!/innerHTML|textContent|insertAdjacent|setAttribute\('(title|aria-label)'/.test(after), `FR-195 ${fn} writes no text or label after stripMask`);
  }
}

// 9. differential fuzz against main's announcement mask (frozen above), PIECE level: no 4-character piece of a value that main's reading of the line
// hides is shown by the toast of that line, also when markup cuts the value at a random point. A fixed seed and a work counter, never wall time.
{
  let seed = 0x1419;
  const rnd = (k: number): number => { seed = (seed * 1103515245 + 12345) >>> 0; return seed % k; };
  const pick = <T,>(a: T[]): T => a[rnd(a.length)];
  const WORDS = ['Theme', 'removed', 'Could', 'not', 'run', 'it:', 'saved', 'folder', 'agent', 'moved', 'to', 'Floor', 'git', 'log', '--oneline', '-n', '5',
    'echo', 'done.', 'path', '(backup', 'file)', 'error', 'ENOENT', 'Copilot', 'Claude', 'Codex', 'grep', '-r', 'TODO', 'src/', 'x=1'];
  const SECRETS = [GHP, SK, '/home/' + USER + '/r', '/Users/' + USER, 'C:\\Users\\' + USER + '\\a', '\\\\h\\s\\' + USER, P('gh', 'p\\_') + BODY,
    '--password ' + PW, 'token=' + PW, '/ho\u200bme/' + USER + '/x', 'Authorization: Bearer ' + P('eyJhbG', 'ciOiJI', 'UzI1Ni', 'J9xyzA')];
  const FIXED = WORDS.join(' ') + ' [redacted] [not checked] ~';
  const TAGS = ['b', 'code', 'small', 'i'];
  let texts = 0, mainHid = 0, mainHidShown = 0, newOnlyHidden = 0, cut = 0;
  for (let i = 0; i < 1500; i++) {
    const parts: string[] = [], secrets: string[] = [];
    const k = 2 + rnd(8);
    for (let j = 0; j < k; j++) { const sec = rnd(3) === 0; const p = sec ? pick(SECRETS) : pick(WORDS); parts.push(p); if (sec) secrets.push(p); }
    const plain = parts.join(' ');
    // the same text as a toast: some parts in markup, and some values cut by markup at a random point (as a name next to fixed words can be)
    const html = parts.map((p) => {
      const r = rnd(6), tg = pick(TAGS);
      if (r <= 1 && p.length > 2) { const at = 1 + rnd(p.length - 1); cut++; return r === 0 ? `<${tg}>` + escH(p.slice(0, at)) + `</${tg}>` + escH(p.slice(at)) : escH(p.slice(0, at)) + `<${tg}>` + escH(p.slice(at)) + `</${tg}>`; }
      return r === 2 ? `<${tg}>` + escH(p) + `</${tg}>` : escH(p);
    }).join(' ');
    const ref = pg.ref(plain);
    assert.ok(typeof ref === 'string', 'the frozen reference masks');
    const got = pg.toast(html).textContent || '';
    texts++;
    const seen = new Set<string>();
    for (const sec of secrets) for (let q = 0; q + 4 <= sec.length; q++) {
      const pc = sec.slice(q, q + 4);
      if (/\s/.test(pc) || seen.has(pc) || FIXED.includes(pc)) continue;
      seen.add(pc);
      if (!(ref as string).includes(pc)) { mainHid++; if (got.includes(pc)) { mainHidShown++; if (process.env.LIVEMASK_DEBUG && mainHidShown < 6) console.log(JSON.stringify({ pc, plain, ref, got })); } }
      else if (!got.includes(pc)) newOnlyHidden++;
    }
  }
  eq(mainHidShown, 0, `FR-195 differential fuzz: pieces main's announcement hides and the toast shows = 0 (${texts} texts, ${mainHid} pieces hidden by main)`);
  ok(mainHid > 1000 && cut > 500, 'FR-195 differential fuzz: the fuzz exercises hidden pieces and values cut by markup');
  console.log(`test-live-mask fuzz: ${texts} texts (${cut} values cut by markup), ${mainHid} pieces main hides, ${mainHidShown} of them shown, ${newOnlyHidden} pieces hidden only by the toast (over-masking vs main's announcement)`);
}

void stripsByBehaviour().then(() => console.log(`test-live-mask: ${n} asserts passed`), (e) => { console.error(e); process.exit(1); });
