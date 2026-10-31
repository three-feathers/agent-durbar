/*
 * The AI character maker and My characters (spec 096 US1, US2 scenarios 3 and 4, US4, FR-034, FR-035, FR-040..FR-044, T041a..T045). Simulator only, the fake generator, no AI credits.
 * Reads computed values and rectangles, not classes: a class with no effect, or a line under the fold, fails here.
 *
 *   the maker at 1440x900 and 1280x800: the texts, ideas, Made by, Cancel, preview, Try again, Discard, Save (names), the 24-character cap;
 *   the login gate (T041a): `chatgpt`, `unknown`, no answer, `apikey`: question or refusal, Cancel starts nothing, a call around the dialog makes nothing;
 *   honest limits: no adapter has `imageGen` (every real app today): the dialog says it cannot make one, offers only Close, and Settings says so before anyone opens it;
 *   My characters in the office: least used, 15 desks, pins (2 sessions in one folder), under a crew too, the desks' tooltip, URLs given back;
 *   manage rows: rename, pin, export, delete (pins counted), the last one deleted;
 *   a hostile name in the maker, the list, the rows, a toast and a tooltip stays text.
 *
 *   DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 DURBAR_DRIVER=$PWD/scripts/check-charmaker.js electron . --no-sandbox   (in check:ui)
 *   SHOTS_OUT=<folder>    screenshots (default: charmaker-shots in the OS temp folder)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const OUT = process.env.SHOTS_OUT || path.join(os.tmpdir(), 'charmaker-shots');
const COST_CHATGPT = "Uses your own Codex (ChatGPT plan): about a minute and one picture from your plan's limits per try. No API money.";
const ASK = 'If Codex is signed in with an API key, OpenAI charges this picture. Make it?';
const REFUSED = 'Codex is signed in with an API key, so each picture would be charged by OpenAI. Sign in to Codex with ChatGPT to make characters.';
const NEEDS = 'This needs OpenAI Codex, installed and signed in with ChatGPT on this computer.';
const NOT_YET_RE = /cannot make characters yet/;
const HOSTILE = '"><img src=x onerror="window.__pwned=1"><b>Eve</b>&amp;';

/* in the page: what a person gets from a dialog: every text at least 10.5px and painted, the dialog and its buttons inside the window, nothing to scroll */
function dialogFacts(sel) {
  const d = document.querySelector(sel), r = d.getBoundingClientRect(), bad = [], cut = [];
  const w = document.createTreeWalker(d, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    const p = n.parentElement, cs = getComputedStyle(p), rr = document.createRange();
    if (p.closest('option')) continue;
    rr.selectNodeContents(n);
    const b = rr.getBoundingClientRect();
    if (parseFloat(cs.fontSize) < 10.5) bad.push(n.nodeValue.trim().slice(0, 30) + ' ' + cs.fontSize);
    if (cs.visibility === 'hidden' || cs.display === 'none' || b.bottom > innerHeight || b.right > innerWidth || b.top < 0 || b.bottom > r.bottom + 0.5 || b.right > r.right + 0.5) cut.push(n.nodeValue.trim().slice(0, 40));
  }
  const btns = [...d.querySelectorAll('.dbtn button')].map((b) => { const x = b.getBoundingClientRect(); return { t: b.textContent, inside: x.left >= r.left && x.right <= r.right && x.bottom <= r.bottom && x.bottom <= innerHeight }; });
  return { rect: [r.left, r.top, r.right, r.bottom], inWindow: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, scrolls: d.scrollHeight > d.clientHeight + 1, bad, cut, btns, text: d.innerText.replace(/\s+/g, ' ').trim() };
}

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  fs.mkdirSync(OUT, { recursive: true });
  const need = async (expr, what, ms = 8000) => assert.ok(await until(expr, ms), what + ' (waited for ' + String(expr).slice(0, 120) + ')');
  const DLG = '#scrDlg .dlg';
  const load = async (q, w = 1280, h = 800) => {
    await H.load({ w, h, ready: 'fit', settle: false, query: Object.assign({ simkinds: 'mixed', simfast: '1' }, q) });
    await H.office(15).catch(() => undefined);
  };
  const facts = () => js(`(${dialogFacts})(${jsLiteral(DLG)})`);
  const fits = async (where) => {
    const f = await facts();
    assert.ok(f.inWindow, `${where}: the dialog is inside the window (${f.rect})`);
    assert.ok(!f.scrolls, `${where}: the dialog has nothing below its fold`);
    assert.deepStrictEqual(f.bad, [], `${where}: text at least 10.5px`);
    assert.deepStrictEqual(f.cut, [], `${where}: no text outside the dialog or the window`);
    assert.ok(f.btns.every((b) => b.inside), `${where}: every button is inside (${JSON.stringify(f.btns)})`);
    return f;
  };
  const openSettings = async () => {
    if (!(await js(`!!document.getElementById('chMake')`))) await js(`document.getElementById('settingsBtn').click()`);
    await need(`!!document.getElementById('chMake')&&!!document.getElementById('chList')`, 'Settings shows the maker button');
    await js(`(()=>{const sc=document.querySelector('#screen .scr-body'),h=document.getElementById('chH');sc.scrollTop+=h.getBoundingClientRect().top-sc.getBoundingClientRect().top-8;})()`);
  };
  const closeSettings = async () => { await js(`window.DurbarScreens.close()`); await need(`!document.getElementById('chMake')`, 'Settings closed'); await H.settle(); };
  const btn = (label) => `[...document.querySelectorAll('#scrDlg .dbtn button, .dlg-ov .dbtn button')].find(b=>b.textContent===${jsLiteral(label)})`;
  const press = async (label) => { await need(`!!${btn(label)}&&!${btn(label)}.disabled`, `a ${label} button`); await js(`${btn(label)}.click();0`); };
  const openMaker = async () => {
    await openSettings();
    await js(`document.getElementById('chMake').click();0`);
    await need(`!!document.querySelector(${jsLiteral(DLG)})`, 'the maker dialog opens');
  };
  const calls = () => js(`window.__simCharCalls`);
  const describe = (t) => js(`(()=>{const d=document.getElementById('cmDesc');d.value=${jsLiteral(t)};d.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const preview = () => need(`!!document.getElementById('cmName')`, 'the preview opens', 10000);
  const list = () => js(`window.__durbarSimUi.bridge().characterList()`);
  const toastSeen = (re) => need(`[...document.querySelectorAll('#toasts .toast')].some(t=>new RegExp(${jsLiteral(re.source)}).test(t.textContent))`, `a toast ${re}`);
  const noMarkup = async (where) => {
    assert.strictEqual(await js(`window.__pwned===undefined`), true, `${where}: no script ran from a name`);
    assert.strictEqual(await js(`document.querySelectorAll('img[src="x"],[onerror]').length`), 0, `${where}: a name made no element`);
  };
  const deskWear = () => js(`(()=>{const s=window.__durbarSimUi.crew.state().map,a=window.__durbarSimUi.agents().filter(x=>!x.parent);return a.map(x=>({id:x.id,room:x.room,c:s[x.id]||''}));})()`);

  /* ---------- the maker, at both sizes ---------- */
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${w}x${h}`;
    await load({ simfast: undefined }, w, h);
    assert.strictEqual(await js(`document.querySelector('meta[http-equiv="Content-Security-Policy"]').content`), "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;", `${tag}: the CSP has blob: in img-src and nothing else new (FR-043)`);
    await openMaker();
    assert.strictEqual(await js(`document.getElementById('scrDlgT').textContent`), 'Make a character with AI');
    assert.strictEqual(await js(`document.getElementById('cmDesc').maxLength`), 300, `${tag}: at most 300 characters`);
    assert.strictEqual(await js(`document.querySelectorAll('#cmIdeas .ai-idea').length`), 4, `${tag}: 4 ideas`);
    assert.deepStrictEqual(await js(`[...document.getElementById('cmKind').options].map(o=>o.value)`), ['codex'], `${tag}: Made by lists only apps with imageGen, here Codex of the mixed roster`);
    assert.strictEqual(await js(`document.getElementById('cmCost').textContent`), COST_CHATGPT, `${tag}: the cost line (FR-034: "No API money" for chatgpt)`);
    assert.deepStrictEqual(await js(`[...document.querySelectorAll('#cmPoints li')].map(l=>l.textContent)`), ['One picture, about a minute', 'Durbar keeps nothing from your description (Codex keeps its own copy of the picture)', 'Preview before saving'], `${tag}: the points (T041b)`);
    assert.match(await js(`document.getElementById('cmCopies').textContent`), /~\/\.codex\/generated_images\/.*neither reads nor deletes/, `${tag}: where Codex's copies are (FR-035)`);
    let f = await fits(`${tag} maker`);
    assert.ok(f.text.includes('generated_images'), `${tag}: the copies line is on screen`);
    await H.shot(path.join(OUT, `096-charmaker-dialog-${tag}.png`), { prep: 'mouse' });
    // More ideas draws others; a chip fills the box
    const ideas0 = await js(`[...document.querySelectorAll('#cmIdeas .ai-idea')].map(b=>b.textContent).join('|')`);
    for (let i = 0; i < 8; i++) { await js(`document.getElementById('cmMore').click()`); if ((await js(`[...document.querySelectorAll('#cmIdeas .ai-idea')].map(b=>b.textContent).join('|')`)) !== ideas0) break; }
    assert.notStrictEqual(await js(`[...document.querySelectorAll('#cmIdeas .ai-idea')].map(b=>b.textContent).join('|')`), ideas0, `${tag}: More ideas changes them`);
    await js(`document.querySelector('#cmIdeas .ai-idea').click()`);
    assert.ok((await js(`document.getElementById('cmDesc').value`)).length > 3, `${tag}: an idea fills the description`);
    // too short: says so, starts nothing
    await describe('ab');
    await press('Make the character');
    await need(`!document.getElementById('scrDlgErr').hidden`, `${tag}: too short is refused`);
    assert.strictEqual((await calls()).generate, 0, `${tag}: nothing started`);
    // busy line, Cancel
    await describe('a tall woman with round glasses');
    await press('Make the character');
    await need(`!!document.getElementById('cmBusy')`, `${tag}: the busy line`);
    assert.match(await js(`document.getElementById('cmElapsed').textContent`), /^\d:\d\d$/, `${tag}: elapsed time`);
    assert.match(await js(`document.getElementById('cmBusy').textContent`), /about a minute per try/);
    assert.strictEqual(await js(`document.activeElement.textContent`), 'Cancel', `${tag}: Cancel has the focus`);
    await fits(`${tag} busy`);
    await press('Cancel');
    await need(`!!document.getElementById('cmDesc')`, `${tag}: Cancel goes back to the description`);
    assert.strictEqual(await js(`document.getElementById('cmDesc').value`), 'a tall woman with round glasses', `${tag}: the description is still there`);
    assert.deepStrictEqual(await list(), [], `${tag}: Cancel kept nothing`);
    // preview: 4 frames at the desk's portrait size and a round crop
    await press('Make the character');
    await preview();
    f = await fits(`${tag} preview`);
    assert.ok(f.text.includes('Made in 1 try, about 1 minute, with Codex'), `${tag}: the made line (${f.text})`);
    await need(`[...document.querySelectorAll('.cm-pic img')].every(i=>i.complete&&i.naturalWidth===352)`, `${tag}: the frames decode under the CSP`);
    const pics = await js(`[...document.querySelectorAll('.cm-pic')].map(p=>{const i=p.querySelector('img');return {alt:i.getAttribute('alt'),w:i.offsetWidth,h:i.offsetHeight,src:i.getAttribute('src').slice(0,5)}})`);
    assert.deepStrictEqual(pics.map((p) => p.alt), ['Working', 'Waiting', 'Resting', 'Blink'], `${tag}: four frames`);
    assert.ok(pics.every((p) => p.w === 88 && p.h === 88 && p.src === 'blob:'), `${tag}: 88 px, blob: (${JSON.stringify(pics)})`);
    const round = await js(`(()=>{const r=document.querySelector('.cm-round'),c=getComputedStyle(r);return {w:r.offsetWidth,h:r.offsetHeight,br:c.borderRadius,of:c.overflow,img:!!r.querySelector('svg image[href^="blob:"]')}})()`);
    assert.ok(round.w === round.h && round.br === '50%' && round.of === 'hidden' && round.img, `${tag}: a round crop that really clips (${JSON.stringify(round)})`);
    assert.strictEqual(await js(`document.activeElement.id`), 'cmName', `${tag}: the name has the focus`);
    await H.shot(path.join(OUT, `096-charmaker-preview-${tag}.png`), { prep: 'mouse' });
    // a click outside must not throw away a picture
    await js(`document.getElementById('scrDlg').click()`);
    assert.ok(await js(`!!document.getElementById('cmName')`), `${tag}: a click outside keeps the preview`);
    // Try again asks nothing with chatgpt, and makes another
    const c1 = await calls();
    await press('Try again');
    await need(`!document.getElementById('cmName')`, `${tag}: the try runs again`);
    await preview();
    assert.strictEqual((await calls()).started, c1.started + 1, `${tag}: one more picture, on the click`);
    assert.ok((await facts()).text.includes('Made in 2 tries'), `${tag}: it counts tries`);
    // Discard: nothing stored
    await press('Discard');
    await need(`!document.querySelector(${jsLiteral(DLG)})`, `${tag}: Discard closes`);
    assert.deepStrictEqual(await list(), [], `${tag}: Discard stored nothing`);
    assert.strictEqual((await js(`window.__durbarSimUi.bridge().characterSave('nope','x')`)).ok, false, `${tag}: no try is held`);
    // Make one first: does nothing else
    const mine0 = await js(`(()=>{const b=document.querySelector('#chList [data-characters="mine"]');return {t:b.textContent,off:b.getAttribute('aria-disabled'),cursor:getComputedStyle(b).cursor}})()`);
    assert.ok(mine0.t.includes('Make one first') && mine0.off === 'true' && mine0.cursor === 'default', `${tag}: no character yet (${JSON.stringify(mine0)})`);
    await js(`document.querySelector('#chList [data-characters="mine"]').click()`);
    await H.clearToasts();
    assert.strictEqual(await js(`window.DurbarScreens&&window.THEME.characters()`), 'theme', `${tag}: the button changed nothing`);
    assert.strictEqual(await js(`window.__durbarSimUi.bridge().getSettings().then(s=>s.characters)`), 'theme', `${tag}: nothing was saved`);
    assert.strictEqual(await js(`document.querySelector('#chList [data-characters="mine"]').getAttribute('aria-pressed')`), 'false', `${tag}: not pressed`);
    // Save with a name, then with none
    await js(`document.getElementById('chMake').click();0`);
    await need(`!!document.getElementById('cmDesc')`, `${tag}: the maker again`);
    await describe('a retired sea captain');
    await press('Make the character');
    await preview();
    await js(`(()=>{const n=document.getElementById('cmName');n.value='Greta';n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await press('Save to My characters');
    await need(`!!document.querySelector('#chmList .chm-row')`, `${tag}: the row appears`);
    await toastSeen(/Greta is saved in My characters/);
    let l = await list();
    assert.deepStrictEqual(l.map((c) => c.name), ['Greta'], `${tag}: stored under the name`);
    assert.ok(!JSON.stringify(l).includes('sea captain'), `${tag}: no description in what is stored (D3)`);
    const item = await js(`(()=>{const b=document.querySelector('#chList [data-characters="mine"]');return {t:b.textContent,off:b.getAttribute('aria-disabled'),pic:(b.querySelector('.chsw image')||{getAttribute(){return ''}}).getAttribute('href')}})()`);
    assert.ok(item.t.includes('1 character') && item.off === null && item.pic.startsWith('blob:'), `${tag}: the list shows it with its working pose (${JSON.stringify(item)})`);
    await js(`document.getElementById('chMake').click();0`);
    await need(`!!document.getElementById('cmDesc')`, `${tag}: the maker again`);
    assert.strictEqual(await js(`document.getElementById('cmDesc').value`), '', `${tag}: the description is not kept after a save`);
    await describe('another one');
    await press('Make the character');
    await preview();
    await press('Save to My characters');
    await need(`document.querySelectorAll('#chmList .chm-row').length===2`, `${tag}: a second row`);
    l = await list();
    assert.deepStrictEqual(l.map((c) => c.name).sort(), ['Greta', 'My character 2'], `${tag}: an empty name gets My character N`);
    await H.clearToasts();
    await js(`(()=>{const sc=document.querySelector('#screen .scr-body'),h=document.getElementById('chH');sc.scrollTop+=h.getBoundingClientRect().top-sc.getBoundingClientRect().top-8;})()`);
    await H.shot(path.join(OUT, `096-charmaker-settings-${tag}.png`), { prep: 'mouse' });
    console.log(`[charmaker] maker ${tag} ok`);
  }

  /* ---------- T041a: the login gate ---------- */
  for (const kind of ['unknown', 'absent', 'nonsense']) {
    const where = `login ${kind}`;
    await load({ simlogin: kind });
    await openMaker();
    const line = await js(`document.getElementById('cmCost').textContent`);
    assert.ok(!/No API money/.test(line), `${where}: never "No API money" (${line})`);
    assert.match(line, /API key, OpenAI charges each picture/, `${where}: the line says it`);
    await describe('a calm yoga teacher');
    await press('Make the character');
    await need(`document.getElementById('cmAskCost')&&document.getElementById('cmAskCost').textContent===${jsLiteral(ASK)}`, `${where}: asks first`);
    assert.deepStrictEqual((await calls()), { generate: 0, started: 0 }, `${where}: no call while it asks`);
    assert.deepStrictEqual(await js(`[...document.querySelectorAll('#scrDlg .dbtn button')].map(b=>b.textContent)`), ['Cancel', 'Make it'], `${where}: Cancel, then Make it`);
    assert.strictEqual(await js(`document.activeElement.textContent`), 'Cancel', `${where}: Cancel has the focus`);
    if (kind === 'unknown') await H.shot(path.join(OUT, `096-charmaker-ask-1280x800.png`), { prep: 'mouse' });
    await press('Cancel');
    await need(`!!document.getElementById('cmDesc')`, `${where}: Cancel goes back`);
    assert.deepStrictEqual((await calls()), { generate: 0, started: 0 }, `${where}: Cancel made no call (FR-034)`);
    await press('Make the character');
    await need(`!!document.getElementById('cmAskCost')`, `${where}: asks again`);
    await js(`document.getElementById('cmAskCost').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    await need(`!!document.getElementById('cmDesc')`, `${where}: Escape is Cancel`);
    assert.deepStrictEqual((await calls()), { generate: 0, started: 0 }, `${where}: Escape made no call`);
    // a window around the dialog gets no try
    const around = await js(`window.__durbarSimUi.bridge().characterGenerate('around the gate','codex')`);
    assert.strictEqual(around.ok, false, `${where}: a call around the question is refused`);
    assert.strictEqual((await calls()).started, 0, `${where}: and nothing started`);
    // Make it goes; Try again asks again; Cancel there starts nothing
    await press('Make the character');
    await need(`!!document.getElementById('cmAskCost')`, `${where}: asks`);
    await press('Make it');
    await preview();
    assert.strictEqual((await calls()).started, 1, `${where}: one picture after Make it`);
    await press('Try again');
    await need(`!!document.getElementById('cmAskCost')`, `${where}: Try again asks again (FR-034: every try)`);
    await press('Cancel');
    await preview();
    assert.strictEqual((await calls()).started, 1, `${where}: Cancel at Try again started nothing`);
    await press('Save to My characters');
    await need(`document.querySelectorAll('#chmList .chm-row').length===1`, `${where}: the picture before it can still be saved`);
  }
  await load({ simlogin: 'apikey' });
  await openMaker();
  assert.ok(!/No API money/.test(await js(`document.getElementById('cmCost').textContent`)), 'apikey: never "No API money"');
  await describe('a farmer in clean overalls');
  await press('Make the character');
  await need(`!!document.getElementById('cmSay')`, 'apikey: refused');
  assert.strictEqual(await js(`document.getElementById('cmSay').textContent`), REFUSED, 'apikey: the refusal text');
  assert.deepStrictEqual(await js(`[...document.querySelectorAll('#scrDlg .dbtn button')].map(b=>b.textContent)`), ['Close'], 'apikey: only Close');
  assert.deepStrictEqual((await calls()), { generate: 0, started: 0 }, 'apikey: no call at all (no process)');
  assert.strictEqual((await js(`window.__durbarSimUi.bridge().characterGenerate('around the gate','codex')`)).ok, false, 'apikey: a call around the dialog is refused');
  assert.strictEqual((await calls()).started, 0, 'apikey: nothing started');
  await press('Close');
  console.log('[charmaker] gate ok');

  /* ---------- honest limits: nothing has imageGen, which is every real app today ---------- */
  for (const [q, what] of [[{ simimagegen: '0' }, 'Codex ready, no imageGen'], [{ simkinds: undefined }, 'Copilot only']]) {
    await load(q);
    await openSettings();
    await need(`!document.getElementById('chMakeNote').hidden`, `${what}: Settings says so before the dialog`);
    const note = await js(`(()=>{const n=document.getElementById('chMakeNote'),b=n.getBoundingClientRect(),c=getComputedStyle(n),sc=document.querySelector('#screen .scr-body').getBoundingClientRect();return {t:n.textContent,fs:parseFloat(c.fontSize),d:c.display,inView:b.top>=sc.top&&b.bottom<=sc.bottom}})()`);
    assert.ok(/Not available in this version/.test(note.t) && note.fs >= 10.5 && note.d !== 'none' && note.inView, `${what}: the note shows (${JSON.stringify(note)})`);
    await H.shot(path.join(OUT, `096-charmaker-off-settings-1280x800.png`), { prep: 'mouse' });
    await js(`document.getElementById('chMake').click();0`);
    await need(`!!document.getElementById('cmSay')`, `${what}: the dialog`);
    assert.match(await js(`document.getElementById('cmSay').textContent`), NOT_YET_RE, `${what}: it says it cannot make one`);
    assert.ok(!(await js(`document.getElementById('cmSay').textContent`)).includes('signed in with ChatGPT'), `${what}: and does not suggest that signing in would help`);
    assert.ok(!(await js(`!!document.getElementById('cmDesc')||!!document.getElementById('cmKind')`)), `${what}: no description box, no Made by`);
    assert.deepStrictEqual(await js(`[...document.querySelectorAll('#scrDlg .dbtn button')].map(b=>b.textContent)`), ['Close'], `${what}: only Close`);
    await fits(what);
    await H.shot(path.join(OUT, `096-charmaker-off-1280x800.png`), { prep: 'mouse' });
    await press('Close');
    assert.strictEqual((await calls()).generate, 0, `${what}: nothing was called`);
  }
  // US1 scenario 5: an app with imageGen exists but is not ready (Codex too old)
  await load({ simkinds: '1' });
  await openMaker();
  await need(`!!document.getElementById('cmSay')`, 'not ready: the dialog');
  assert.strictEqual(await js(`document.getElementById('cmSay').textContent`), NEEDS, 'not ready: what it needs');
  assert.deepStrictEqual(await js(`[...document.querySelectorAll('#scrDlg .dbtn button')].map(b=>b.textContent)`), ['Close'], 'not ready: only Close');
  assert.ok(await js(`document.getElementById('chMakeNote').hidden`), 'not ready: no "not available" note: it would be false here');
  await press('Close');
  // many characters: a warning the person can pass (owner's principle of 2026-10-31; it replaces Q5's cap)
  await load({ simmine: '24' });
  await openMaker();
  await need(`!!document.getElementById('cmSay')`, 'many: the warning');
  assert.match(await js(`document.getElementById('cmSay').textContent`), /You have 24 characters\. You can make more/, 'many: says so');
  assert.deepStrictEqual(await js(`[...document.querySelectorAll('#scrDlg .dbtn button')].map(b=>b.textContent)`), ['Cancel', 'Manage', 'Make another'], 'many: it can be passed');
  await fits('many');
  await H.shot(path.join(OUT, `096-charmaker-many-1280x800.png`), { prep: 'mouse' });
  await press('Manage');
  await need(`!document.querySelector(${jsLiteral(DLG)})&&document.querySelectorAll('#chmList .chm-row').length===24`, 'many: Manage shows the rows');
  assert.ok(await js(`document.activeElement&&document.activeElement.closest('#chmList')!==null`), 'many: the focus is in the rows');
  await js(`document.getElementById('chMake').click();0`);
  await need(`!!document.getElementById('cmSay')`, 'many: the warning again');
  await press('Cancel');
  await need(`!document.querySelector(${jsLiteral(DLG)})`, 'many: Cancel closes');
  assert.strictEqual((await calls()).generate, 0, 'many: nothing started');
  await js(`document.getElementById('chMake').click();0`);
  await press('Make another');
  await need(`!!document.getElementById('cmDesc')`, 'many: Make another opens the form');
  await describe('the twenty-fifth person');
  await press('Make the character');
  await preview();
  await press('Save to My characters');
  await need(`document.querySelectorAll('#chmList .chm-row').length===25`, 'many: the 25th is kept');
  assert.match(await js(`document.getElementById('chmH').textContent`), /25/, 'many: the heading counts it, with no "of 24"');
  console.log('[charmaker] limits ok');

  /* ---------- US2: My characters at the desks ---------- */
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${w}x${h}`;
    await H.load({ w, h, ready: 'fit', settle: false });
    await js(`localStorage.setItem('durbar.doorsigns','off')`);
    await load({ simmine: '3', characters: 'mine' }, w, h);
    await need(`window.THEME.characters()==='mine'&&window.THEME.sceneKit()==='crew'`, `${tag}: My characters are drawn`, 8000);
    await need(`document.querySelectorAll('#stage .desk[data-id] svg.scene image.crew-pic[href^="blob:"]').length>=12`, `${tag}: desks draw blob: portraits`, 10000);
    await H.settle();
    const decoded = await js(`Promise.all([...new Set([...document.querySelectorAll('image.crew-pic')].map(i=>i.getAttribute('href')))].map(u=>new Promise(r=>{const i=new Image();i.onload=()=>r(i.naturalWidth);i.onerror=()=>r(0);i.src=u;})))`);
    assert.ok(decoded.length >= 3 && decoded.every((n) => n === 352), `${tag}: every picture decodes at 352 under the CSP (${decoded})`);
    const wear = await deskWear();
    const count = {};
    for (const x of wear) count[x.c] = (count[x.c] || 0) + 1;
    const ids = (await list()).map((c) => c.id);
    assert.deepStrictEqual(Object.keys(count).sort(), [...ids].sort(), `${tag}: only my three (${JSON.stringify(count)})`);
    assert.ok(Math.max(...Object.values(count)) - Math.min(...Object.values(count)) <= 1, `${tag}: least used first (${JSON.stringify(count)})`);
    const tip = await js(`[...document.querySelectorAll('#stage .desk[data-id]')].filter(d=>d.getClientRects().length).map(d=>d.title).filter(Boolean)`);
    assert.ok(tip.length >= 12 && tip.every((t) => / · Wearing (Greta|Bo|Ines)$/.test(t) || /Wearing (Greta|Bo|Ines)$/.test(t)), `${tag}: the desks' tooltips name the character (${tip.slice(0, 2)})`);
    await H.shot(path.join(OUT, `096-mycharacters-office-${tag}.png`), { prep: 'calm' });
    console.log(`[charmaker] office ${tag} ok`);
  }

  /* ---------- US2 scenario 3, FR-044: a pin ---------- */
  await load({ simmine: '3', characters: 'mine' });
  await need(`window.THEME.characters()==='mine'`, 'mine');
  await need(`document.querySelectorAll('#stage image.crew-pic[href^="blob:"]').length>=12`, 'portraits');
  const wear0 = await deskWear();
  const byRoom = {};
  for (const x of wear0) (byRoom[x.room] = byRoom[x.room] || []).push(x);
  const twoRoom = Object.keys(byRoom).find((r) => byRoom[r].length >= 2);
  assert.ok(twoRoom, 'a folder with two sessions');
  const roomName = await js(`(()=>{const a=window.__durbarSimUi.agents().find(x=>x.room===${jsLiteral(twoRoom)}&&!x.parent);return a.info.workspaceFile||a.info.cwd})()`);
  const short = roomName.split(/[\\/]/).filter(Boolean).pop();
  const chars = await list();
  const target = chars[2], rowOf = (id) => `document.querySelector(${jsLiteral(`#chmList [data-chid="${id}"]`)})`;
  await openSettings();
  await need(`!!${rowOf(target.id)}`, 'its row');
  const rowBtn = (id, act) => `document.querySelector(${jsLiteral(`#chmList [data-chid="${id}"] [data-chact="${act}"]`)})`;
  const dlgPick = async (act, id) => { await js(rowBtn(id, act) + `.click();0`); await need(`!!document.querySelector('.dlg-ov .dlg,#scrDlg .dlg')`, `the ${act} dialog`); };
  const checkFolder = (label, on) => js(`(()=>{const l=[...document.querySelectorAll('.dlg .dpick')].find(x=>x.querySelector('.dpick-t').textContent===${jsLiteral(label)});if(!l)return false;const c=l.querySelector('input');if(c.checked!==${jsLiteral(on)})c.click();return true})()`);
  await dlgPick('pin', target.id);
  const folderLabel = await js(`(()=>{const rs=[...document.querySelectorAll('.dlg .dpick .dpick-t')].map(x=>x.textContent);return rs})()`);
  assert.ok(folderLabel.length >= 2, `the open folders are listed (${folderLabel})`);
  const room = await js(`(()=>{const a=window.__durbarSimUi.agents().find(x=>x.room===${jsLiteral(twoRoom)}&&!x.parent);const s=document.querySelector('.room[data-room="'+a.room+'"] .room-name, .room-name');return a.roomName||''})()`);
  /* the dialog's label for that folder: the room's shown name */
  const roomLabel = room || (await js(`window.__durbarSimUi.agents().find(x=>x.room===${jsLiteral(twoRoom)}&&!x.parent).info.folderLabel||''`)) || short;
  const hit = (await checkFolder(roomLabel, true)) || (await checkFolder(short, true));
  assert.ok(hit, `a checkbox for ${roomLabel} / ${short} in ${folderLabel}`);
  await H.shot(path.join(OUT, `096-charmaker-pin-1280x800.png`), { prep: 'mouse' });
  await press('Save pins');
  await need(`/Pinned to /.test(${rowOf(target.id)}.textContent)`, 'the row names the folder');
  const pins1 = await js(`window.__durbarSimUi.crew.own().pins`);
  assert.deepStrictEqual(Object.values(pins1), [target.id], `one pin, to it (${JSON.stringify(pins1)})`);
  await closeSettings();
  const pinnedOK = `(()=>{const m=window.__durbarSimUi.crew.state().map;return window.__durbarSimUi.agents().filter(x=>!x.parent&&x.room===${jsLiteral(twoRoom)}).every(x=>m[x.id]===${jsLiteral(target.id)})})()`;
  await need(pinnedOK, 'every session of that folder wears it');
  const wear1 = await deskWear();
  assert.ok(wear1.filter((x) => x.room === twoRoom).length >= 2, 'two sessions in the folder');
  const othersOf = wear1.filter((x) => x.room !== twoRoom);
  assert.ok(othersOf.every((x) => ids3(chars).includes(x.c)), 'the others wear my characters too');
  const shownHref = await js(`(()=>{const a=window.__durbarSimUi.agents().find(x=>x.room===${jsLiteral(twoRoom)}&&!x.parent);const i=document.querySelector('#stage .desk[data-id="'+a.id+'"] image.crew-pic');return i?i.getAttribute('href'):''})()`);
  assert.ok(shownHref.startsWith('blob:'), `the desk draws it at once (${shownHref})`);
  // under a crew too (Q3), and not under Minimalist
  await openSettings();
  await js(`document.querySelector('#chList [data-characters="cheeky"]').click()`);
  await need(`window.THEME.characters()==='cheeky'`, 'Cheeky');
  await closeSettings();
  await need(pinnedOK, 'the pin holds under Cheeky');
  await need(`document.querySelectorAll('#stage image.crew-pic[href^="crew/art/"]').length>0&&document.querySelectorAll('#stage image.crew-pic[href^="blob:"]').length>=2`, 'Cheeky desks and the pinned desks');
  assert.ok((await js(`window.__durbarSimUi.crew.own().urls`)).length === 3, 'the URLs stay while a pin draws them');
  await openSettings();
  await js(`document.querySelector('#chList [data-characters="minimalist"]').click()`);
  await need(`window.THEME.sceneKit()==='office'`, 'Minimalist');
  await closeSettings();
  assert.strictEqual(await js(`document.querySelectorAll('#stage image.crew-pic').length`), 0, 'Minimalist draws no portraits: the pin waits');
  assert.deepStrictEqual(Object.values(await js(`window.__durbarSimUi.crew.own().pins`)), [target.id], 'and it stays');
  await need(`window.__durbarSimUi.crew.own().urls.length===0`, 'nothing shows them: the URLs are given back (FR-043)');
  await openSettings();
  await js(`document.querySelector('#chList [data-characters="cheeky"]').click()`);
  await need(`window.THEME.characters()==='cheeky'`, 'Cheeky again');
  // unpin under Cheeky: the sessions go back to the crew
  await need(`!!${rowOf(target.id)}`, 'the row');
  await dlgPick('pin', target.id);
  assert.ok((await checkFolder(roomLabel, false)) || (await checkFolder(short, false)), 'uncheck it');
  await press('Save pins');
  await need(`!/Pinned to /.test(${rowOf(target.id)}.textContent)`, 'the row no longer names it');
  await closeSettings();
  await need(`document.querySelectorAll('#stage image.crew-pic[href^="blob:"]').length===0&&document.querySelectorAll('#stage image.crew-pic[href^="crew/art/"]').length>=12`, 'no pin: only the crew at the desks');
  await need(`window.__durbarSimUi.crew.own().urls.length===0`, 'and the URLs are gone again');
  console.log('[charmaker] pins ok');

  // US2 scenario 3, the pin order: a pin in place at load: the sessions of its folder wear it, and it counts as in use for the rest, so the three stay evenly used
  await load({ simmine: '3', characters: 'mine', simminepin: '~/work/mcp-swiss' });
  await need(`document.querySelectorAll('#stage image.crew-pic[href^="blob:"]').length>=12`, 'portraits, with a pin in place');
  await H.settle();
  {
    const pinnedId = Object.values(await js(`window.__durbarSimUi.crew.own().pins`))[0];
    const wear2 = await js(`(()=>{const s=window.__durbarSimUi.crew.state().map;return window.__durbarSimUi.agents().filter(x=>!x.parent).map(x=>({c:s[x.id]||'',f:x.info.workspaceFile||x.info.cwd}));})()`);
    const inFolder = wear2.filter((x) => x.f === '~/work/mcp-swiss');
    assert.ok(inFolder.length >= 2 && inFolder.every((x) => x.c === pinnedId), `every session in the folder wears the pin (${JSON.stringify(inFolder)})`);
    const n = {};
    for (const x of wear2) n[x.c] = (n[x.c] || 0) + 1;
    assert.ok(Object.keys(n).length === 3 && Math.max(...Object.values(n)) - Math.min(...Object.values(n)) <= 1, `pinned first: the pinned character counts as in use for the others (${JSON.stringify(n)})`);
  }

  /* ---------- US4: manage rows ---------- */
  await load({ simmine: '3', characters: 'mine' });
  await need(`document.querySelectorAll('#stage image.crew-pic[href^="blob:"]').length>=12`, 'portraits');
  await openSettings();
  await need(`document.querySelectorAll('#chmList .chm-row').length===3`, 'three rows');
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    ctx.win.setContentSize(w, h);
    await need(`innerWidth===${w}`, `the window is ${w} wide`);
    const row = await js(`(()=>{const r=document.querySelector('#chmList .chm-row'),b=r.getBoundingClientRect(),c=getComputedStyle(r),img=r.querySelector('img').getBoundingClientRect();return {d:c.display,inRow:[...r.querySelectorAll('button')].every(x=>{const y=x.getBoundingClientRect();return y.left>=b.left&&y.right<=b.right&&y.bottom<=b.bottom}),min:Math.min(...[...r.querySelectorAll('b,small,button')].map(e=>parseFloat(getComputedStyle(e).fontSize))),img:[img.width,img.height],pic:r.querySelector('img').naturalWidth,labels:[...r.querySelectorAll('button')].map(x=>x.getAttribute('aria-label'))}})()`);
    assert.strictEqual(row.d, 'flex', `${w}: a row is a row`);
    assert.ok(row.inRow, `${w}: its buttons are inside it`);
    assert.ok(row.min >= 10.5, `${w}: text at least 10.5px (${row.min})`);
    assert.deepStrictEqual(row.img, [44, 44], `${w}: the portrait's size`);
    assert.strictEqual(row.pic, 352, `${w}: the portrait decoded`);
    assert.ok(row.labels.every((t) => /(Greta|Bo|Ines)/.test(t)), `${w}: accessible names (${row.labels})`);
  }
  const rows = await list();
  const greta = rows.find((c) => c.name === 'Greta');
  // rename: the id stays; list and tooltips follow
  await dlgPick('rename', greta.id);
  await need(`!!document.getElementById('mdIn')`, 'the rename box');
  assert.strictEqual(await js(`document.getElementById('mdIn').value`), 'Greta');
  await js(`(()=>{const n=document.getElementById('mdIn');n.value='bad\\u0007name';n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await press('Rename');
  await need(`document.getElementById('mdErr')&&!document.getElementById('mdErr').hidden&&/control or hidden/.test(document.getElementById('mdErr').textContent)`, 'a bad name is refused, in the dialog');
  await js(`(()=>{const n=document.getElementById('mdIn');n.value='Greta B';n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await press('Rename');
  await need(`/Greta B/.test(${rowOf(greta.id)}.textContent)`, 'the row has the new name');
  await toastSeen(/Renamed to Greta B/);
  assert.strictEqual((await list()).find((c) => c.id === greta.id).name, 'Greta B', 'the store has it, same id');
  assert.strictEqual(await js(`document.activeElement.dataset.chact`), 'rename', 'focus stays on Rename');
  await closeSettings();
  await need(`[...document.querySelectorAll('#stage .desk[data-id]')].some(d=>/Wearing Greta B$/.test(d.title))`, 'a desk\'s tooltip has the new name');
  await openSettings();
  await need(`!!${rowOf(greta.id)}`, 'the row again');
  // export: main's folder pick is `test:charstore`'s and test:charipc's; here the reply reaches the window
  await js(rowBtn(greta.id, 'export') + `.click();0`);
  await toastSeen(/Exported to \/simulated\/export/);
  // delete in use, with a pin: confirm, desks repick, the toast counts the pin
  const fresh = await list();
  const doomed = fresh[0];
  await dlgPick('pin', doomed.id);
  await js(`document.querySelector('.dlg .dpick input').click()`);
  await press('Save pins');
  await need(`/Pinned to /.test(${rowOf(doomed.id)}.textContent)`, 'pinned');
  await need(`window.__durbarSimUi.crew.state().map&&Object.values(window.__durbarSimUi.crew.state().map).includes(${jsLiteral(doomed.id)})`, 'it is in use');
  const doomedUrl = await js(rowOf(doomed.id) + `.querySelector('img').getAttribute('src')`);
  await dlgPick('delete', doomed.id);
  await need(`!!document.getElementById('mdL')`, 'the confirmation');
  assert.ok((await js(`document.getElementById('mdL').textContent`)).includes(doomed.name), 'it names the character');
  assert.match(await js(`document.getElementById('mdL').textContent`), /1 folder pin removed/, 'and the pins');
  assert.strictEqual(await js(`document.activeElement.textContent`), 'Cancel', 'Cancel has the focus');
  await press('Cancel');
  await need(`!document.getElementById('mdL')`, 'Cancel closes');
  assert.ok((await list()).some((c) => c.id === doomed.id), 'Cancel deleted nothing');
  await dlgPick('delete', doomed.id);
  await press('Delete');
  await need(`!${rowOf(doomed.id)}`, 'the row is gone');
  await toastSeen(/deleted\. 1 folder pin removed\./);
  assert.ok(!(await list()).some((c) => c.id === doomed.id), 'the store no longer has it');
  assert.deepStrictEqual(await js(`window.__durbarSimUi.crew.own().pins`), {}, 'its pin is gone');
  assert.ok(!(await js(`Object.values(window.__durbarSimUi.crew.state().map)`)).includes(doomed.id), 'no desk wears it (a new pick at once)');
  assert.strictEqual(await js(`new Promise(r=>{const i=new Image();i.onload=()=>r('loaded');i.onerror=()=>r('gone');i.src=${jsLiteral(doomedUrl)};})`), 'gone', 'its URL was revoked');
  await H.clearToasts();
  // delete them all: the theme's own figures, the stored value stays, a toast says so (US2 scenario 4)
  for (const c of await list()) {
    await dlgPick('delete', c.id);
    await press('Delete');
    await need(`!${rowOf(c.id)}`, 'the row is gone');
  }
  await toastSeen(/no characters left, so the desks show the theme/);
  assert.strictEqual(await js(`window.THEME.characters()`), 'theme', 'draws the theme\'s own');
  assert.strictEqual(await js(`window.__durbarSimUi.bridge().getSettings().then(s=>s.characters)`), 'mine', 'the stored value stays mine');
  assert.strictEqual(await js(`document.querySelector('#chList [data-characters="mine"]').getAttribute('aria-pressed')`), 'true', 'My characters stays pressed');
  assert.ok((await js(`document.querySelector('#chList [data-characters="mine"]').textContent`)).includes('Make one first'), 'and says Make one first');
  await closeSettings();
  assert.strictEqual(await js(`document.querySelectorAll('#stage image.crew-pic').length`), 0, 'no portrait is left');
  // a new one is used once made
  await openMaker();
  await describe('a new hire');
  await press('Make the character');
  await preview();
  await press('Save to My characters');
  await need(`window.THEME.characters()==='mine'`, 'a new character is used once made');
  await closeSettings();
  await need(`document.querySelectorAll('#stage image.crew-pic[href^="blob:"]').length>=12`, 'at the desks');
  // switching away gives the URLs back (FR-043)
  await openSettings();
  const usedUrl = await js(`document.querySelector('#chmList img').getAttribute('src')`);
  await js(`document.querySelector('#chList [data-characters="theme"]').click()`);
  await need(`window.THEME.characters()==='theme'&&window.__durbarSimUi.bridge&&window.DurbarScreens.isOpen()`, 'The theme\'s own');
  assert.strictEqual(await js(`document.querySelector('#chmList img').complete&&document.querySelector('#chmList img').naturalWidth`), 352, 'the rows still show pictures while Settings is open');
  await closeSettings();
  await need(`window.__durbarSimUi.crew.own().urls.length===0`, 'Settings closed: no URL is kept');
  assert.strictEqual(await js(`new Promise(r=>{const i=new Image();i.onload=()=>r('loaded');i.onerror=()=>r('gone');i.src=${jsLiteral(usedUrl)};})`), 'gone', 'and it no longer loads');
  console.log('[charmaker] manage ok');

  /* ---------- US2 scenario 5 in the window: a picture that fails ---------- */
  await load({ simmine: '2', characters: 'mine' });
  await need(`document.querySelectorAll('#stage image.crew-pic[href^="blob:"]').length>=12`, 'portraits');
  const victim = (await list())[0].id;
  assert.ok(await js(`window.__durbarSimUi.crew.fallOwn(${jsLiteral(victim)})`), 'one character\'s picture fails');
  await need(`window.__durbarSimUi.crew.state().bad.includes(${jsLiteral(victim)})`, 'it is marked unusable (CREW_BAD)');
  await need(`[...document.querySelectorAll('#stage .desk[data-id] svg.scene')].filter(s=>s.getClientRects().length&&s.querySelector('circle[r="12.5"]')).length>=1`, 'its desks draw the plain figure');

  /* ---------- a hostile name: maker, list, rows, toast, tooltip ---------- */
  // few agents: the full desk has its own tooltip
  await H.load({ w: 1440, h: 900, ready: `document.querySelectorAll('#stage .desk[data-id]').length>=2&&document.getElementById('stage').dataset.fit`, settle: false, query: { sim: '3', density: 'full', simhelpers: '0', simmine: '1', simminename: 'hostile', characters: 'mine' } });
  await need(`document.querySelectorAll('#stage .desk[data-id] image.crew-pic[href^="blob:"]').length>=1`, 'hostile, full desks: portraits');
  await need(`[...document.querySelectorAll('#stage .desk:not(.card)[data-id]')].some(d=>(d.title||'').includes(${jsLiteral('Wearing ' + HOSTILE)}))`, 'hostile, full desks: the tooltip holds the name as text');
  await noMarkup('hostile, a full desk');
  await load({ simmine: '2', simminename: 'hostile', characters: 'mine' });
  await need(`document.querySelectorAll('#stage image.crew-pic[href^="blob:"]').length>=12`, 'hostile: portraits');
  await noMarkup('hostile, the office');
  await need(`[...document.querySelectorAll('#stage .desk[data-id]')].some(d=>d.title.endsWith(${jsLiteral('Wearing ' + HOSTILE)}))`, 'hostile: the tooltip holds the name as text');
  await noMarkup('hostile, the tooltip');
  await openSettings();
  await need(`document.querySelectorAll('#chmList .chm-row').length===2`, 'hostile: two rows');
  await noMarkup('hostile, the rows');
  const hrow = await js(`(()=>{const r=[...document.querySelectorAll('#chmList .chm-row')].find(x=>x.querySelector('.chm-name').textContent.includes('Eve'));return {t:r.querySelector('.chm-name').textContent,title:r.querySelector('.chm-name').title,label:r.querySelector('[data-chact="rename"]').getAttribute('aria-label'),kids:r.querySelector('.chm-name').children.length,id:r.dataset.chid}})()`);
  assert.deepStrictEqual([hrow.t, hrow.title, hrow.label, hrow.kids], [HOSTILE, HOSTILE, 'Rename ' + HOSTILE, 0], 'hostile: the row shows it as text');
  // the maker: a hostile name typed in the preview, and main's reply name in the toast
  await js(`document.getElementById('chMake').click();0`);
  await need(`!!document.getElementById('cmDesc')`, 'hostile: the maker');
  await describe('"><img src=x onerror="window.__pwned=1">');
  await press('Make the character');
  await preview();
  await noMarkup('hostile, the preview');
  await js(`(()=>{const n=document.getElementById('cmName');n.value=${jsLiteral(HOSTILE)};n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await press('Try again');
  await need(`!document.getElementById('cmName')`, 'hostile: runs again');
  await preview();
  assert.strictEqual(await js(`document.getElementById('cmName').value`), HOSTILE, 'hostile: the name field keeps it as a value');
  await noMarkup('hostile, the name field');
  await press('Save to My characters');
  await need(`document.querySelectorAll('#chmList .chm-row').length===3`, 'hostile: a third row');
  await need(`[...document.querySelectorAll('#toasts .toast')].some(t=>t.textContent.includes(${jsLiteral(HOSTILE)}))`, 'hostile: the toast shows it as text');
  await noMarkup('hostile, the toast');
  // rename, pin and delete dialogs and their toasts
  await H.clearToasts();
  await dlgPick('rename', hrow.id);
  await need(`document.getElementById('mdIn')&&document.getElementById('mdIn').value===${jsLiteral(HOSTILE)}`, 'hostile: the rename box holds it');
  await js(`(()=>{const n=document.getElementById('mdIn');n.value='Eve';n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await press('Rename');
  await need(`[...document.querySelectorAll('#toasts .toast')].some(t=>t.textContent.includes('Renamed to'))`, 'hostile: the rename toast');
  await noMarkup('hostile, the rename toast');
  await dlgPick('pin', hrow.id);
  await noMarkup('hostile, the pin dialog');
  await press('Cancel');
  await dlgPick('delete', hrow.id);
  await need(`!!document.getElementById('mdL')`, 'hostile: the delete dialog');
  await noMarkup('hostile, the delete dialog');
  await press('Delete');
  await need(`[...document.querySelectorAll('#toasts .toast')].some(t=>t.textContent.includes('deleted'))`, 'hostile: the delete toast');
  await noMarkup('hostile, the delete toast');
  await H.clearToasts();
  await closeSettings();
  await noMarkup('hostile, the end');
  console.log('[charmaker] hostile name ok');
  console.log('[charmaker] checks passed');
  process.exitCode = 0;
};
const ids3 = (l) => l.map((c) => c.id);
