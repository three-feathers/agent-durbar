/*
 * Check for spec 059 (issue #636): rename in place, in the simulator (no AI credits, no agent app). Simulator only.
 *
 *   npm run check:rename-inline
 *   OUT=docs/screenshots  (optional) also saves the screenshots of the field open on the header, a card, a Previous sessions row and a folder
 *
 * At 1440x900 and 1280x800, in Expert and in Simple: every surface of FR-020 (chat title by click, F2 and Enter; desk card pencil and F2;
 * list row pencil and F2; Previous sessions rows (also a hidden one; no pencil on VS Code rows); the room header, the Folders panel and the
 * closed-room plate; none on helpers or in the list's Folder cell), every item of FR-021 (Enter, blur, window blur, Tab, Esc that never
 * closes the chat, unchanged = no call, empty reset, a rule error on Enter and on blur, IME, paste, busy, one edit at a time), every item
 * of FR-023 (a late title, a rename elsewhere, an ended session, a removed one, a re-render, a view switch), the box of the item not
 * moving (D8), the field's font size, the macOS title bar not a drag region over the title, and the escaped EVIL name. Page code that must
 * see the "chat just opened" state runs in ONE js call with the click that opens it (a round trip under load takes longer than 400 ms).
 * A miss prints DRIVER FAILED (Electron still exits 0), so the npm script exits non-zero unless "all checks passed" is printed.
 */
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || require('os').tmpdir();
const Q = { sim: '15', simfreeze: '1' };
const EVIL = '<img src=x onerror=window.__xss=1> & "q"';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const js = H.js;
  const until = (expr, ms = 4000) => H.until ? H.until(expr, ms) : (async () => { const end = Date.now() + ms; for (;;) { if (await js(`(()=>{try{return !!(${expr})}catch(e){return false}})()`)) return true; if (Date.now() > end) return false; await ctx.sleep(50); } })();
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'mouse', delay: 300, tag: 'rename-inline', what: name });
  const st = async () => JSON.parse(await js(`JSON.stringify(window.DurbarInlineName.current())`));
  const calls = () => js(`JSON.parse(JSON.stringify(window.__simRenameCalls))`);
  const nSess = async () => (await calls()).session.length;
  const nFold = async () => (await calls()).folder.length;
  const box = (sel) => js(`(()=>{const e=document.querySelector(${jsLiteral(sel)});if(!e)return null;const r=e.getBoundingClientRect();return [r.left,r.top,r.width,r.height].map(v=>Math.round(v*10)/10).join(',')})()`);
  const fld = () => js(`(()=>{const i=document.querySelector('.inl-input');if(!i)return null;const r=i.getBoundingClientRect();return {v:i.value,s:i.selectionStart,e:i.selectionEnd,fs:parseFloat(getComputedStyle(i).fontSize),focus:document.activeElement===i,ro:i.readOnly,busy:i.getAttribute('aria-busy'),max:i.maxLength,label:i.getAttribute('aria-label'),desc:i.getAttribute('aria-describedby'),x:r.left,y:r.top,r:r.right,b:r.bottom}})()`);
  /* FR-025: the field fills the item's free inner width: its right edge is within 4px of min(clip.right-4, left+maxWidth) (review of #636) */
  const fills = (clipSel, max = 480) => js(`(()=>{const i=document.querySelector('.inl-input').getBoundingClientRect(),c=document.querySelector(${jsLiteral(clipSel)}).getBoundingClientRect();return {w:Math.round(i.width),gap:Math.abs(i.right-Math.min(c.right-4,i.left+${jsLiteral(max)}))}})()`);
  const err = () => js(`(()=>{const e=document.querySelector('.inl-err');return e&&!e.hidden?{t:e.textContent,role:e.getAttribute('role'),fs:parseFloat(getComputedStyle(e).fontSize)}:null})()`);
  const type = (v) => js(`(()=>{const i=document.querySelector('.inl-input');i.maxLength=500;i.value=${jsLiteral(v)};i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const ae = () => js(`(()=>{const a=document.activeElement;if(!a||a===document.body)return 'body';return (a.id||a.tagName.toLowerCase()+(a.className?'.'+String(a.className).split(' ')[0]:''))+'|'+((a.dataset&&(a.dataset.id||a.dataset.ren||a.dataset.renfolder||a.dataset.renprev||a.dataset.door||a.dataset.pk))||'')})()`);
  const aliasOf = (id) => js(`(()=>{const a=__durbarSimUi.agents().find(x=>x.id===${jsLiteral(id)});return a?(a.alias||''):null})()`);
  const nameOf = (id) => js(`(()=>{const a=__durbarSimUi.agents().find(x=>x.id===${jsLiteral(id)});return a?a.name:null})()`);
  const cardName = (id) => js(`(()=>{const e=document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"] .name`)});return e?e.textContent:null})()`);
  const click = (sel, detail = 1) => js(`(()=>{const e=document.querySelector(${jsLiteral(sel)});if(!e)return false;e.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:${jsLiteral(detail)}}));return true})()`);
  const focus = (sel) => js(`(()=>{const e=document.querySelector(${jsLiteral(sel)});if(!e)return false;e.focus();return document.activeElement===e})()`);
  const key = (k, mods) => H.key(k, mods);
  const announce = () => js(`document.getElementById('srAnnounce').textContent`);
  const panelOpen = () => js(`document.body.classList.contains('panel-open')`);
  const closePanel = async () => { await js(`(()=>{const b=document.getElementById('backBtn');if(b)b.click();})()`); await until(`!document.body.classList.contains('panel-open')`); await ctx.sleep(200); };
  const openChat = async (id) => { await js(`document.querySelector(${jsLiteral(`#stage [data-id="${id}"], #list [data-id="${id}"]`)}).click()`); await until(`document.body.classList.contains('panel-open')&&document.getElementById('panelTitle')`); await ctx.sleep(600); };
  const none = async (tag) => assert.strictEqual((await st()).open, false, `${tag}: no field is open`);
  const closeField = async () => { if ((await st()).open) { await key('Escape'); await ctx.sleep(120); } };

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    for (const level of ['expert', 'simple']) {
      await H.load({ w, h, query: Q, ready: 'fit', settle: false });
      await js(`localStorage.setItem('durbar.detail',${jsLiteral(level)})`);
      await H.load({ query: Q, ready: 'fit', settle: false });
      await ctx.sleep(1800);
      ctx.win.show(); ctx.win.focus(); ctx.win.webContents.focus();
      const tag = `${w} ${level}`;
      assert.ok(await js(`document.body.classList.contains('simple')===${level === 'simple'}`), `${tag}: the detail level is on`);
      assert.ok(await js(`typeof __durbarSimUi.inline==='function'&&!!window.__simRenameCalls`), `${tag}: the simulator hooks exist`);
      const ids = await js(`[...document.querySelectorAll('#stage .unit>.ren[data-ren]')].map(b=>b.dataset.ren)`);
      assert.ok(ids.length >= 6, `${tag}: pencils on the desks: ${ids.length}`);
      const [A, B, C, D, E] = ids;

      // the screenshots of the edit state, on the fresh page (no rename has happened yet, so no leftover names), Expert only
      if (level === 'expert') {
        await openChat(A); await click('#panelTitleBtn', 1); await ctx.sleep(150); await type('Billing refactor'); await shot(`059-rename-inline-header-${w}x${h}.png`); await key('Escape'); await ctx.sleep(120); await closePanel();
        await click(`#stage .ren[data-ren="${C}"]`, 1); await ctx.sleep(150); await type('Billing refactor'); await shot(`059-rename-inline-card-${w}x${h}.png`); await key('Escape'); await ctx.sleep(120);
        const fpa = await js(`(()=>{const a=__durbarSimUi.agents().find(x=>x.live&&!x.parent&&x.info&&x.info.cwd==='~/work/mcp-swiss');return a?a.id:null})()`);
        await openChat(fpa);
        await js(`(()=>{const b=document.getElementById('prevBtn');if(b&&b.getAttribute('aria-expanded')!=='true')b.click();})()`);
        await until(`document.querySelectorAll('#prevLists .prev-row[data-pg="cli"] .ren[data-renprev]').length>=2`, 5000);
        await js(`document.querySelector('#prevLists .prev-row[data-pg="cli"] .ren[data-renprev]').click()`); await ctx.sleep(150); await type('Billing refactor'); await shot(`059-rename-inline-prev-${w}x${h}.png`); await key('Escape'); await ctx.sleep(120); await closePanel();
        const frid = await js(`document.querySelector('#stage .room-head [data-door]').dataset.door`);
        await click(`#stage .ren[data-renfolder="${frid}"]`, 1); await ctx.sleep(150); await type('Billing room'); await shot(`059-rename-inline-folder-${w}x${h}.png`); await key('Escape'); await ctx.sleep(120);
        await none(`${tag}: the screenshots left no field open`);
      }

      // ---- the pencil: a sibling, never inside the card button; hidden with opacity (never display or visibility); in the Tab order ----
      assert.strictEqual(await js(`document.querySelectorAll('#stage .desk .ren, #list .lrow .ren').length`), 0, `${tag}: no pencil inside a card or row button`);
      const pen = await js(`(()=>{const b=document.querySelector('#stage .unit>.ren');const c=getComputedStyle(b);return {op:c.opacity,vis:c.visibility,disp:c.display,tag:b.tagName,type:b.type,label:b.getAttribute('aria-label'),tip:b.title,w:b.offsetWidth,h:b.offsetHeight,svg:!!b.querySelector('svg'),emoji:/\\p{Extended_Pictographic}/u.test(b.textContent)}})()`);
      assert.deepStrictEqual([pen.op, pen.vis, pen.disp !== 'none', pen.tag, pen.type, pen.svg, pen.emoji], ['0', 'visible', true, 'BUTTON', 'button', true, false], `${tag}: the pencil is a hidden-by-opacity SVG button: ${jsLiteral(pen)}`);
      assert.ok(pen.w >= 24 && pen.h >= 24, `${tag}: the pencil is a 24px target: ${pen.w}x${pen.h}`);
      assert.ok(/^Rename .+/.test(pen.label) && pen.tip === pen.label && pen.label.length <= 120, `${tag}: the pencil's label and tooltip: ${pen.label}`);
      await focus(`#stage .desk[data-id="${A}"]`); await key('Tab'); await ctx.sleep(100);
      assert.strictEqual(await ae(), `button.ren|${A}`, `${tag}: Tab from the card reaches its pencil`);
      assert.ok(await until(`getComputedStyle(document.activeElement).opacity==='1'`, 2000), `${tag}: a focused pencil is shown`);
      await js(`document.activeElement.blur()`);

      // ---- helpers: no pencil, a plain title, F2 does nothing ----
      assert.strictEqual(await js(`document.querySelectorAll('#stage .helper .ren, #stage .helpers .ren').length`), 0, `${tag}: no pencil on helpers`);
      const hid = await js(`(()=>{const h=document.querySelector('#stage .helper[data-id]');return h?h.dataset.id:null})()`);
      if (hid) {
        await focus(`#stage .helper[data-id="${hid}"]`); await key('F2'); await ctx.sleep(120); await none(`${tag} helper card F2`);
        await openChat(hid);
        assert.strictEqual(await js(`!!document.getElementById('panelTitleBtn')`), false, `${tag}: a helper chat's title is plain text`);
        await js(`document.getElementById('panelTitle').focus()`); await key('F2'); await key('Return'); await ctx.sleep(120); await none(`${tag} helper title`);
        await closePanel();
      }

      // ---- 1. the chat header: a click right after the chat opened, or a double-click, edits nothing (FR-020 item 1; one js call: no round trip) ----
      await js(`(()=>{document.querySelector(${jsLiteral(`#stage [data-id="${A}"]`)}).click();document.getElementById('panelTitle').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));})()`);
      await ctx.sleep(80); await none(`${tag}: a click in the first 400 ms`);
      await until(`!!document.getElementById('panelTitleBtn')`); await ctx.sleep(600);
      await click('#panelTitle', 2); await none(`${tag}: the second click of a double-click`);
      const th = await js(`(()=>{const h=document.getElementById('panelTitle');return {role:h.tagName,aria:h.getAttribute('aria-label'),tip:h.title,btn:document.getElementById('panelTitleBtn').getAttribute('aria-label'),name:__durbarSimUi.agents().find(a=>a.id===${jsLiteral(A)}).name,pen:!!h.querySelector('.ttl-pen[aria-hidden="true"]')}})()`);
      assert.ok(th.aria === th.name && th.btn === 'Rename session ' + th.name && / Click or press F2 to rename\.$/.test(th.tip) && th.tip.length <= 300 && th.pen, `${tag}: the header's labels: ${jsLiteral(th)}`);
      // focus on open never edits (spec 074 FR-019 fallback, remoteBack)
      await js(`document.getElementById('panelTitle').focus()`); await ctx.sleep(120); await none(`${tag}: focusing the title`);
      const hb = await box('#panelHead');
      await key('F2'); await ctx.sleep(150);
      let f = await fld();
      assert.ok(f && f.focus && f.s === 0 && f.e === f.v.length && f.v === th.name.slice(0, 60), `${tag}: F2 on the title opens the field, name selected: ${jsLiteral(f)}`);
      assert.ok(f.fs >= 10.5 && f.max === 60 && /^Name of session /.test(f.label) && !!f.desc, `${tag}: field font, limit, label: ${jsLiteral(f)}`);
      { const fw = await fills('#panelHead'); assert.ok(fw.w >= 300 && fw.gap <= 4, `${tag}: the header field fills the free width: ${jsLiteral(fw)}`); }
      assert.strictEqual(await box('#panelHead'), hb, `${tag}: the header did not change while editing (D8)`);
      // 2. Esc cancels, the chat stays open (the Esc never reaches the global handler), focus back on the title button
      const n0 = await nSess();
      await type('Not saved'); await key('Escape'); await ctx.sleep(150);
      await none(`${tag} Esc`); assert.ok(await panelOpen(), `${tag}: Esc in the field does not close the chat`);
      assert.strictEqual(await nSess(), n0, `${tag}: Esc makes no call`);
      assert.strictEqual(await ae(), 'panelTitleBtn|', `${tag}: focus is on the title button after Esc`);
      await key('Escape'); await until(`!document.body.classList.contains('panel-open')`, 2000);
      assert.ok(!(await panelOpen()), `${tag}: a second Esc (field closed) closes the chat as before`);
      await openChat(A);
      // Enter on the focused heading, then a click on the title; unchanged = no call and no announcement
      await js(`document.getElementById('panelTitle').focus()`); await key('Return'); await ctx.sleep(150);
      assert.ok((await st()).open, `${tag}: Enter on the focused title opens the field`);
      assert.strictEqual(await aliasOf(A), '', `${tag}: no user name yet`);
      await js(`document.getElementById('srAnnounce').textContent=''`);
      await key('Return'); await ctx.sleep(200);
      assert.strictEqual(await nSess(), n0, `${tag}: Enter on unchanged text makes no call (7)`);
      assert.strictEqual(await aliasOf(A), '', `${tag}: the runtime title did not become a user name (7)`);
      assert.strictEqual(await announce(), '', `${tag}: unchanged: nothing announced`);
      // 1. click, type, Enter: one call, every surface, "Renamed.", focus on the title button, header height unchanged
      await click('#panelTitleBtn', 1); await ctx.sleep(120);
      await type('Billing refactor'); await key('Return'); await ctx.sleep(120);
      assert.strictEqual(await js(`(()=>{const i=document.querySelector('.inl-input');return !i||i.readOnly})()`), true, `${tag}: busy or closed right after Enter`);
      await ctx.sleep(300);
      assert.strictEqual(await nSess(), n0 + 1, `${tag}: exactly one call`);
      assert.deepStrictEqual((await calls()).session[n0], { id: A, sessionId: null, name: 'Billing refactor' });
      assert.strictEqual(await aliasOf(A), 'Billing refactor');
      assert.strictEqual(await js(`document.getElementById('panelTitleBtn').textContent`), 'Billing refactor');
      assert.strictEqual(await js(`document.getElementById('panelTitle').getAttribute('aria-label')`), 'Billing refactor');
      assert.strictEqual(await announce(), 'Renamed.', `${tag}: Renamed. is announced`);
      assert.strictEqual(await ae(), 'panelTitleBtn|', `${tag}: focus is on the title button after saving`);
      assert.strictEqual(await box('#panelHead'), hb, `${tag}: the header kept its box after saving`);
      assert.strictEqual(await nameOf(A), 'Billing refactor');
      // the macOS title bar is not a drag region over the title (the header .ph is not one)
      await js(`document.documentElement.dataset.platform='darwin'`);
      const regions = await js(`['#panelTitle','#panelTitleBtn','#panelHead','.ph-top'].map(s=>getComputedStyle(document.querySelector(s)).webkitAppRegion||'none')`);
      assert.ok(regions.every((x) => x !== 'drag'), `${tag}: the title and header are not a drag region on a Mac: ${regions}`);
      await js(`delete document.documentElement.dataset.platform`);
      // empty resets (6): the runtime title comes back, "Name reset." is announced, the call carries ''
      await click('#panelTitleBtn', 1); await ctx.sleep(120); await type('   '); await key('Return'); await ctx.sleep(400);
      assert.strictEqual(await aliasOf(A), '', `${tag}: an empty name resets (6)`);
      assert.strictEqual((await calls()).session[n0 + 1].name, '', `${tag}: the reset call carries an empty name`);
      assert.strictEqual(await announce(), 'Name reset.');
      // a rule error: Enter keeps the field open with the reason and sends nothing (8); blur reverts with a toast
      const n1 = await nSess();
      await click('#panelTitleBtn', 1); await ctx.sleep(120); await type('x'.repeat(61)); await key('Return'); await ctx.sleep(200);
      assert.ok((await st()).open && (await err()).t === 'Use 1 to 60 characters.' && (await err()).role === 'alert' && (await err()).fs >= 12 && (await fld()).focus, `${tag}: a 61-character name stays open with the reason`);
      assert.strictEqual(await nSess(), n1, `${tag}: nothing was sent`);
      await type('bad\u0007name'); await key('Return'); await ctx.sleep(150);
      assert.strictEqual((await err()).t, 'Remove control or hidden characters.');
      await type('x'.repeat(61)); await js(`document.querySelector('.inl-input').blur()`); await ctx.sleep(300);
      await none(`${tag} blur with a rule breaker`);
      assert.ok(await js(`[...document.querySelectorAll('.toast')].some(t=>/^Not renamed: Use 1 to 60 characters\\./.test(t.textContent))`), `${tag}: blur with a rule breaker says "Not renamed: ..."`);
      assert.strictEqual(await nSess(), n1, `${tag}: and sends nothing`);
      assert.strictEqual(await aliasOf(A), '');
      // a token-looking name: main refuses with its reason, the field stays open
      await click('#panelTitleBtn', 1); await ctx.sleep(120); await type('ghp_' + 'abcdefghijklmnopqrstuvwxyz0123456789'); await key('Return'); await ctx.sleep(300);
      assert.ok((await st()).open && /secret/.test((await err()).t), `${tag}: main's refusal is shown under the field`);
      assert.ok(!(await fld()).ro && (await fld()).busy === null, `${tag}: and the field is usable again`);
      await closeField();
      // IME: Enter during a composition only commits it (9); paste turns line breaks into spaces (10)
      await click('#panelTitleBtn', 1); await ctx.sleep(120); await type('Candidate');
      const n2 = await nSess();
      await js(`(()=>{const i=document.querySelector('.inl-input');for(const k of ['Enter','Escape'])i.dispatchEvent(new KeyboardEvent('keydown',{key:k,isComposing:true,bubbles:true,cancelable:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:229,bubbles:true,cancelable:true}));})()`); await ctx.sleep(150);
      assert.ok((await st()).open && (await nSess()) === n2 && (await panelOpen()), `${tag}: composing Enter or Esc saves nothing, cancels nothing, closes no chat (9)`);
      await type(''); await js(`(()=>{const i=document.querySelector('.inl-input');const dt=new DataTransfer();dt.setData('text/plain','Billing\\nrefactor\\r\\n');i.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));})()`);
      assert.strictEqual((await fld()).v, 'Billing refactor ', `${tag}: paste: line breaks become spaces (10)`);
      await key('Return'); await ctx.sleep(400);
      assert.strictEqual((await calls()).session[n2].name, 'Billing refactor', `${tag}: the trimmed text is saved`);
      // Tab saves (like blur) and puts focus back; the window losing focus keeps the field (FR-021 items 2, 3)
      await click('#panelTitleBtn', 1); await ctx.sleep(120); await type('Tabbed');
      await key('Tab'); await ctx.sleep(400);
      assert.strictEqual(await aliasOf(A), 'Tabbed'); assert.strictEqual(await ae(), 'panelTitleBtn|', `${tag}: Tab saves and focus returns to the title`);
      await click('#panelTitleBtn', 1); await ctx.sleep(120); await type('Away');
      const n3 = await nSess();
      await js(`(()=>{document.hasFocus=()=>false;document.querySelector('.inl-input').dispatchEvent(new Event('blur'));})()`); await ctx.sleep(200);
      assert.ok((await st()).open && (await nSess()) === n3, `${tag}: the window losing focus keeps the field open, no call (2)`);
      await js(`delete document.hasFocus`);
      await js(`document.querySelector('.inl-input').focus()`);
      await js(`document.querySelector('.inl-input').blur()`); await ctx.sleep(400);
      assert.strictEqual(await aliasOf(A), 'Away', `${tag}: a blur inside the window saves`);
      // the EVIL name saved through the chat header: text in the title and the labels, no element, no script (review of #636, item 3)
      await click('#panelTitleBtn', 1); await ctx.sleep(120); await type(EVIL); await key('Return'); await ctx.sleep(400);
      assert.strictEqual(await js(`document.getElementById('panelTitleBtn').textContent`), EVIL, `${tag}: the header shows the name as text`);
      assert.strictEqual(await js(`document.querySelectorAll('#panelHead img, #panelHead script, #panelTitle [onerror]').length`), 0, `${tag}: no element came out of the name in the header`);
      assert.strictEqual(await js(`window.__xss===undefined`), true, `${tag}: no script ran from the header save`);
      assert.strictEqual(await js(`document.getElementById('panelTitleBtn').getAttribute('aria-label')`), 'Rename session ' + EVIL);
      await click('#panelTitleBtn', 1); await ctx.sleep(120);
      assert.strictEqual((await fld()).v, EVIL, `${tag}: and it is the field's value`); await closeField();
      // two edits at once: the second saves the first (10 of FR-021); a second Enter while busy sends nothing more
      await closePanel();
      // ---- 11. a late runtime title while editing; 2. renamed elsewhere ----
      await openChat(B); await click('#panelTitleBtn', 1); await ctx.sleep(120); await type('Typed text');
      await js(`__durbarSimUi.retitle(${jsLiteral(B)},'A late runtime title')`); await ctx.sleep(250);
      assert.strictEqual((await fld()).v, 'Typed text', `${tag}: a late title leaves the typed text (FR-023 item 1)`);
      assert.strictEqual(await js(`document.getElementById('panelTitleBtn').textContent`), 'A late runtime title', `${tag}: the name under the field follows`);
      await key('Escape'); await ctx.sleep(150);
      assert.strictEqual(await js(`document.getElementById('panelTitleBtn').textContent`), 'A late runtime title', `${tag}: Esc shows the new title`);
      await click('#panelTitleBtn', 1); await ctx.sleep(120); await type('Typed again');
      await js(`__durbarSimUi.renamedElsewhere(${jsLiteral(B)},'Elsewhere name')`); await ctx.sleep(250);
      assert.strictEqual((await fld()).v, 'Typed again', `${tag}: a rename elsewhere leaves the typed text (item 2)`);
      await key('Escape'); await ctx.sleep(150);
      assert.strictEqual(await js(`document.getElementById('panelTitleBtn').textContent`), 'Elsewhere name', `${tag}: Esc restores the CURRENT name`);
      await click('#panelTitleBtn', 1); await ctx.sleep(120); await type('Typed again');
      await js(`__durbarSimUi.renamedElsewhere(${jsLiteral(B)},'Other name')`); await ctx.sleep(200);
      await key('Return'); await ctx.sleep(400);
      assert.strictEqual(await aliasOf(B), 'Typed again', `${tag}: saving sends the typed text (the newest act wins)`);
      // 12. the session ends while editing: the field stays and saving works
      await click('#panelTitleBtn', 1); await ctx.sleep(120); await type('Ended and renamed');
      await js(`__durbarSimUi.endAgent(${jsLiteral(B)})`); await ctx.sleep(300);
      assert.ok((await st()).open, `${tag}: an ended session keeps the field (item 3)`);
      await key('Return'); await ctx.sleep(400);
      assert.strictEqual(await aliasOf(B), 'Ended and renamed', `${tag}: and saving works`);
      await closePanel();

      // ---- 4, 5. desk cards: a click opens the chat; the pencil edits and does not; F2 + Tab saves and focus returns ----
      const cb = await box(`#stage .desk[data-id="${C}"]`);
      await click(`#stage .desk[data-id="${C}"]`, 1); await until(`document.body.classList.contains('panel-open')`);
      assert.ok(await panelOpen(), `${tag}: a click on the card opens the chat`); await closePanel(); await none(`${tag} card click`);
      const cb2 = await box(`#stage .desk[data-id="${C}"]`);
      await click(`#stage .ren[data-ren="${C}"]`, 1); await ctx.sleep(150);
      f = await fld();
      assert.ok(f && f.focus && f.s === 0 && f.e === f.v.length && !(await panelOpen()), `${tag}: the pencil opens the field and not the chat: ${jsLiteral(f)}`);
      assert.ok(f.fs >= 10.5, `${tag}: the card field is at least 10.5px`);
      { const fw = await fills(`#stage .desk[data-id=${jsLiteral(C)}]`); assert.ok(fw.w >= 150 && fw.gap <= 4, `${tag}: the card field fills the free width: ${jsLiteral(fw)}`); }
      assert.strictEqual(await box(`#stage .desk[data-id="${C}"]`), cb2, `${tag}: the card did not move or resize while editing`);
      // a status tick / re-render keeps the field, its text and its selection (FR-023 item 5)
      await js(`(()=>{const i=document.querySelector('.inl-input');i.value='Keep me please';i.setSelectionRange(2,6);})()`);
      await js(`__durbarSimUi.render()`); await ctx.sleep(500);
      f = await fld();
      assert.ok(f && f.v === 'Keep me please' && f.s === 2 && f.e === 6, `${tag}: a re-render keeps the field, value and selection: ${jsLiteral(f)}`);
      await js(`__durbarSimUi.emit({type:'status',sessionId:${jsLiteral(C)},timestamp:Date.now(),status:'working',intent:'tick'})`); await ctx.sleep(300);
      assert.ok((await fld()) && (await fld()).v === 'Keep me please', `${tag}: a status tick keeps the field`);
      assert.ok((await st()).open, `${tag}: still open`);
      await closeField();
      assert.strictEqual(await ae(), `button.ren|${C}`, `${tag}: focus returns to the pencil after Esc`);
      // F2 on the focused card, type, Tab: saved, focus back on the card (5)
      await focus(`#stage .desk[data-id="${D}"]`); await key('F2'); await ctx.sleep(150);
      assert.strictEqual((await st()).anchorKey, 'desk:' + D, `${tag}: F2 on a card opens its field`);
      const n4 = await nSess();
      await type('From the card'); await key('Tab'); await ctx.sleep(400);
      assert.strictEqual(await nSess(), n4 + 1); assert.strictEqual(await cardName(D), 'From the card');
      assert.strictEqual(await js(`document.activeElement.dataset.id`), D);
      // 16. a 60-character name on a card at this size: nothing moves, the text is >= 10.5px and scrolls inside the field
      const LONG = 'Sixty characters long name for the layout check, ends here..';
      await click(`#stage .ren[data-ren="${E}"]`, 1); await ctx.sleep(150);
      const eb = await box(`#stage .desk[data-id="${E}"]`); await type(LONG); await ctx.sleep(100);
      f = await fld();
      assert.ok(f.fs >= 10.5 && f.r <= w && f.b <= h && f.x >= 0, `${tag}: the long text stays inside the window at >= 10.5px: ${jsLiteral(f)}`);
      assert.strictEqual(await box(`#stage .desk[data-id="${E}"]`), eb, `${tag}: and nothing moved (16)`);
      await closeField();
      // EVIL: the name is text in the field, the labels and the card
      await click(`#stage .ren[data-ren="${E}"]`, 1); await ctx.sleep(120); await type(EVIL); await key('Return'); await ctx.sleep(400);
      assert.strictEqual(await cardName(E), EVIL); assert.strictEqual(await js(`window.__xss===undefined`), true, `${tag}: no script ran`);
      assert.strictEqual(await js(`document.querySelector(${jsLiteral(`#stage .ren[data-ren="${E}"]`)}).getAttribute('aria-label')`), 'Rename ' + EVIL);
      await click(`#stage .ren[data-ren="${E}"]`, 1); await ctx.sleep(120);
      assert.strictEqual((await fld()).v, EVIL, `${tag}: the escaped name is the field's value`);
      assert.strictEqual((await fld()).label, 'Name of session ' + EVIL);
      await closeField();
      // 12 (second half): the item leaves the window: the field closes without a call and focus is not lost to the page
      await click(`#stage .ren[data-ren="${D}"]`, 1); await ctx.sleep(120); await type('Never saved');
      const n5 = await nSess();
      await js(`__durbarSimUi.removeAgent(${jsLiteral(D)})`); await ctx.sleep(500);
      await none(`${tag} removed session`); assert.strictEqual(await nSess(), n5, `${tag}: a removed session closes the field without a call (item 4)`);
      assert.notStrictEqual(await ae(), 'body', `${tag}: and focus is not lost to the page`);

      // ---- one edit at a time (FR-021 item 10): starting another saves the open one ----
      await click(`#stage .ren[data-ren="${A}"]`, 1); await ctx.sleep(120); await type('First of two');
      const n6 = await nSess();
      await click(`#stage .ren[data-ren="${B}"]`, 1); await ctx.sleep(400);
      assert.strictEqual(await nSess(), n6 + 1, `${tag}: the second edit saved the first`); assert.strictEqual(await aliasOf(A), 'First of two');
      assert.strictEqual((await st()).anchorKey, 'desk:' + B); assert.strictEqual(await js(`document.querySelectorAll('.inl-input').length`), 1);
      await closeField();

      // item 1 of the review: a save still running (Enter) when another edit opens: one field on screen, and its late answer does not take focus back
      await js(`(()=>{const b=__durbarSimUi.bridge();if(!b.__slowOrig){b.__slowOrig=b.renameSession;b.renameSession=(...a)=>new Promise((r)=>setTimeout(()=>r(b.__slowOrig(...a)),900));}})()`);
      await click(`#stage .ren[data-ren="${A}"]`, 1); await ctx.sleep(120); await type('Slow save'); await key('Return'); await ctx.sleep(150);
      assert.ok((await fld()).busy === 'true', `${tag}: the first field is busy`);
      await click(`#stage .ren[data-ren="${B}"]`, 1); await ctx.sleep(150);
      assert.strictEqual(await js(`document.querySelectorAll('.inl-input').length`), 1, `${tag}: one field on screen while a save runs`);
      assert.strictEqual((await st()).anchorKey, 'desk:' + B);
      await ctx.sleep(1300);
      assert.strictEqual(await js(`document.querySelectorAll('.inl-input').length`), 1, `${tag}: still one field after the late answer`);
      assert.ok((await fld()).focus, `${tag}: the late answer did not take focus from the second field`);
      assert.strictEqual(await aliasOf(A), 'Slow save', `${tag}: the slow save went through`);
      await closeField();
      await js(`(()=>{const b=__durbarSimUi.bridge();if(b.__slowOrig){b.renameSession=b.__slowOrig;b.__slowOrig=null;}})()`);
      // item 2 of the review: Enter on a focused card opens the chat, not the field
      await focus(`#stage .desk[data-id="${C}"]`); await key('Return'); await until(`document.body.classList.contains('panel-open')`, 3000); await ctx.sleep(200);
      assert.ok(await panelOpen(), `${tag}: Enter on a focused card opens the chat`); await none(`${tag}: Enter on a card`);
      await closePanel();
      // ---- list view: pencil on a main row, none on helper rows or in the Folder cell; F2 on a row; J/K still move ----
      await js(`document.getElementById('vList').click()`); await until(`document.querySelectorAll('#list button.lrow').length>=15`);
      assert.strictEqual(await js(`document.querySelectorAll('#list .lfold .ren, #list .ren[data-renfolder]').length`), 0, `${tag}: no pencil in the list's Folder cell`);
      assert.strictEqual(await js(`document.querySelectorAll('#list .lrow .sub').length>0?[...document.querySelectorAll('#list .lrow-w')].filter(w=>w.querySelector('.sub')).length:0`), 0, `${tag}: no pencil row for a helper`);
      const lr = await box(`#list .lrow[data-id="${C}"]`);
      await click(`#list .ren[data-ren="${C}"]`, 1); await ctx.sleep(150);
      f = await fld(); assert.ok(f && f.focus && f.fs >= 10.5 && !(await panelOpen()), `${tag}: the list pencil opens the field`);
      assert.strictEqual(await box(`#list .lrow[data-id="${C}"]`), lr, `${tag}: the row did not move`);
      await js(`__durbarSimUi.render()`); await ctx.sleep(400);
      assert.ok((await st()).open, `${tag}: a list rebuild keeps the field`);
      await closeField(); assert.strictEqual(await ae(), `button.ren|${C}`, `${tag}: focus back on the row's pencil`);
      await focus(`#list button.lrow[data-id="${C}"]`); await key('F2'); await ctx.sleep(120);
      assert.strictEqual((await st()).anchorKey, 'list:' + C, `${tag}: F2 on a row`);
      await type('From the list'); await key('Return'); await ctx.sleep(400);
      assert.strictEqual(await aliasOf(C), 'From the list'); assert.strictEqual(await js(`document.activeElement.dataset.id`), C, `${tag}: focus on the row`);
      await focus(`#list button.lrow[data-id="${C}"]`); await key('j'); await ctx.sleep(100);
      assert.ok(await js(`document.activeElement.classList.contains('lrow')&&document.activeElement.dataset.id!==${jsLiteral(C)}`), `${tag}: J still moves between rows`);
      await focus(`#list button.lrow[data-id="${C}"]`); await key('Return'); await until(`document.body.classList.contains('panel-open')`, 3000); await ctx.sleep(200);
      assert.ok(await panelOpen(), `${tag}: Enter on a focused list row opens the chat`); await none(`${tag}: Enter on a row`);
      await closePanel();
      // an edit open in the list when the view switches to the office: the name is not on screen, the field saves like blur (item 5)
      await click(`#list .ren[data-ren="${C}"]`, 1); await ctx.sleep(120); await type('Switched away');
      await js(`document.getElementById('vOffice').click()`); await ctx.sleep(600);
      await none(`${tag} view switch`); assert.strictEqual(await aliasOf(C), 'Switched away', `${tag}: a view switch saves like blur`);

      // ---- 3. Previous sessions rows (agent rows, hidden ones too; none on VS Code rows) ----
      const pa = await js(`(()=>{const a=__durbarSimUi.agents().find(x=>x.live&&!x.parent&&x.info&&x.info.cwd==='~/work/mcp-swiss');return a?a.id:null})()`);
      await openChat(pa);
      await js(`(()=>{const b=document.getElementById('prevBtn');if(b&&b.getAttribute('aria-expanded')!=='true')b.click();})()`);
      await until(`document.querySelectorAll('#prevLists .prev-row[data-pg="cli"]').length>=2`, 5000);
      assert.strictEqual(await js(`document.querySelectorAll('#prevLists .prev-row[data-pg="vs"] .ren').length`), 0, `${tag}: no pencil on VS Code chat rows`);
      const pks = await js(`[...document.querySelectorAll('#prevLists .prev-row[data-pg="cli"]')].map(r=>r.dataset.pk)`);
      const pk = pks[0], pk2 = pks[1];
      assert.strictEqual(await js(`document.querySelectorAll('#prevLists .prev-row[data-pg="cli"] .ren[data-renprev]').length`), pks.length, `${tag}: every agent row has a pencil`);
      const rowSel = (k) => `#prevLists .prev-row[data-pk="${k}"]`;
      const rb = await box(rowSel(pk));
      await click(`${rowSel(pk)} .ren[data-renprev]`, 1); await ctx.sleep(150);
      f = await fld(); assert.ok(f && f.focus, `${tag}: the Previous row pencil opens the field`);
      assert.strictEqual(await box(rowSel(pk)), rb, `${tag}: the row did not move`);
      await type('Prev renamed'); const n7 = await nSess(); await key('Return'); await ctx.sleep(500);
      assert.deepStrictEqual((await calls()).session[n7], { id: pa, sessionId: pk, name: 'Prev renamed' }, `${tag}: the Previous row call carries the row's id`);
      assert.strictEqual(await js(`document.querySelector(${jsLiteral(rowSel(pk) + ' .prev-t')}).textContent`), 'Prev renamed', `${tag}: the row title`);
      assert.strictEqual(await js(`document.querySelector(${jsLiteral(rowSel(pk) + ' .prev-tx b')}).title`), 'Prev renamed', `${tag}: the row tooltip`);
      assert.ok(await js(`!!document.activeElement.dataset.renprev&&document.activeElement.dataset.renprev===${jsLiteral(pk)}`), `${tag}: focus is on the row's pencil`);
      await js(`(()=>{const q=document.getElementById('prevQ');if(q){q.value='renamed';q.dispatchEvent(new Event('input',{bubbles:true}));}})()`); await ctx.sleep(300);
      assert.strictEqual(await js(`[...document.querySelectorAll('#prevLists .prev-row[data-pg="cli"] .prev-t')].some(e=>e.textContent==='Prev renamed')`), true, `${tag}: the search finds the new name`);
      assert.ok(await js(`!!document.querySelector(${jsLiteral(rowSel(pk) + ' [data-pv="resume"]')})`), `${tag}: Resume is still there`);
      await js(`(()=>{const q=document.getElementById('prevQ');if(q){q.value='';q.dispatchEvent(new Event('input',{bubbles:true}));}})()`); await ctx.sleep(200);
      // F2 inside a row, and a hidden row (shown) has the pencil too
      await focus(`${rowSel(pk2)} [data-pv="resume"]`); await key('F2'); await ctx.sleep(120);
      assert.strictEqual((await st()).anchorKey, 'prev:' + pk2, `${tag}: F2 on a control of the row`); await closeField();
      assert.strictEqual(await js(`!!document.activeElement.dataset.renprev`), true, `${tag}: Esc returns to the pencil`);
      await js(`__durbarSimUi.hidePrev(${jsLiteral(pa)},${jsLiteral(pk2)})`); await ctx.sleep(400);
      await js(`(()=>{const b=document.querySelector('#prevLists [data-pv="showhidden"]');if(b)b.click();})()`); await ctx.sleep(400);
      assert.strictEqual(await js(`!!document.querySelector(${jsLiteral(rowSel(pk2) + '.is-hidden .ren[data-renprev]')})`), true, `${tag}: a hidden row has a pencil`);
      await click(`${rowSel(pk2)} .ren[data-renprev]`, 1); await ctx.sleep(120); await type('Hidden renamed'); await key('Return'); await ctx.sleep(500);
      assert.strictEqual(await js(`document.querySelector(${jsLiteral(rowSel(pk2) + ' .prev-t')}).textContent`), 'Hidden renamed', `${tag}: a hidden row renames`);
      await closePanel();

      // ---- 4. folders: the room header, the Folders panel, the closed-room plate; a rename elsewhere; F2 on the door ----
      const rid = await js(`document.querySelector('#stage .room-head [data-door]').dataset.door`);
      const nf = await nFold();
      const hdb = await box(`#stage .room-head:has([data-door="${rid}"])`);
      assert.strictEqual(await js(`document.querySelectorAll('#stage .room-head .ren[data-renfolder]').length`), await js(`document.querySelectorAll('#stage .room-head').length`), `${tag}: every open room has a pencil`);
      await click(`#stage .ren[data-renfolder="${rid}"]`, 1); await ctx.sleep(150);
      f = await fld(); assert.ok(f && f.focus && f.max === 40 && f.fs >= 10.5 && /^Name of folder /.test(f.label), `${tag}: the room header pencil opens the folder field: ${jsLiteral(f)}`);
      assert.strictEqual(await box(`#stage .room-head:has([data-door="${rid}"])`), hdb, `${tag}: the room header did not move`);
      await type('Typed folder'); await js(`__durbarSimUi.renameRoomElsewhere(${jsLiteral(rid)},'Changed elsewhere')`); await ctx.sleep(300);
      assert.strictEqual((await fld()).v, 'Typed folder', `${tag}: the typed folder name stays when the name changes by another path (13)`);
      await key('Escape'); await ctx.sleep(150);
      assert.strictEqual(await js(`document.querySelector(${jsLiteral(`#stage .room-head:has([data-door="${rid}"]) .room-name`)}).textContent`), 'Changed elsewhere', `${tag}: Esc shows the new folder name`);
      assert.strictEqual(await nFold(), nf, `${tag}: no folder call yet`);
      await click(`#stage .ren[data-renfolder="${rid}"]`, 1); await ctx.sleep(120);
      await key('Return'); await ctx.sleep(200); assert.strictEqual(await nFold(), nf, `${tag}: unchanged folder text makes no call`);
      await click(`#stage .ren[data-renfolder="${rid}"]`, 1); await ctx.sleep(120); await type('Folder renamed'); await key('Return'); await ctx.sleep(400);
      assert.strictEqual(await nFold(), nf + 1); assert.strictEqual((await calls()).folder[nf], 'Folder renamed');
      assert.strictEqual(await js(`document.querySelector(${jsLiteral(`#stage .room-head:has([data-door="${rid}"]) .room-name`)}).textContent`), 'Folder renamed');
      await click(`#stage .ren[data-renfolder="${rid}"]`, 1); await ctx.sleep(120); await type(''); await key('Return'); await ctx.sleep(400);
      assert.strictEqual((await calls()).folder[nf + 1], '', `${tag}: an empty folder name resets`);
      assert.notStrictEqual(await js(`document.querySelector(${jsLiteral(`#stage .room-head:has([data-door="${rid}"]) .room-name`)}).textContent`), 'Folder renamed', `${tag}: the folder's own name is back`);
      // one folder-name rule (spec 059 delta 2026-10-24): hidden and control characters are refused with the reason, in the field and in the dialog
      const nf3 = await nFold();
      for (const bad of ['Proj\u0007x', 'Proj\u202eexe', 'zero\u200bwidth', 'x'.repeat(41)]) {
        await click(`#stage .ren[data-renfolder="${rid}"]`, 1); await ctx.sleep(120); await type(bad); await key('Return'); await ctx.sleep(250);
        const want = bad.length > 40 ? 'Use 1 to 40 characters.' : 'Remove control or hidden characters.';
        assert.ok((await st()).open && (await err()) && (await err()).t === want, `${tag}: the folder field refuses ${JSON.stringify(bad)} with its reason: ${jsLiteral(await err())}`);
        await closeField();
      }
      assert.strictEqual(await nFold(), nf3, `${tag}: and sends nothing`);
      await js(`document.getElementById('foldersBtn').click()`); await until(`!document.getElementById('foldersPop').hidden`);
      for (const bad of ['Proj\u0007x', 'Proj\u202eexe', 'zero\u200bwidth']) {
        await js(`document.querySelector(${jsLiteral(`#foldersPop [data-fp="rename"][data-room="${rid}"]`)}).click()`); await until(`!!document.getElementById('mdIn')`, 2000);
        await js(`(()=>{const i=document.getElementById('mdIn');i.value=${jsLiteral(bad)};i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
        await js(`document.querySelector('#modeDlg .btn.primary').click()`); await ctx.sleep(200);
        assert.strictEqual(await js(`(()=>{const e=document.getElementById('mdErr');return e&&!e.hidden?e.textContent:null})()`), 'Remove control or hidden characters.', `${tag}: the folder dialog refuses ${JSON.stringify(bad)} with the reason`);
        await key('Escape'); await ctx.sleep(200);
      }
      assert.strictEqual(await nFold(), nf3, `${tag}: the dialog sent nothing either`);
      await js(`(()=>{if(!document.getElementById('foldersPop').hidden)document.getElementById('foldersBtn').click();})()`); await until(`document.getElementById('foldersPop').hidden`);
      // F2 on the door and on the folder ⋯ button
      await focus(`#stage .room-head [data-door="${rid}"]`); await key('F2'); await ctx.sleep(150);
      assert.strictEqual((await st()).anchorKey, 'folder:room:' + rid, `${tag}: F2 on the door`); await closeField();
      if (await js(`!!document.querySelector(${jsLiteral(`#stage [data-foldermenu="${rid}"]`)})`)) { await focus(`#stage [data-foldermenu="${rid}"]`); await key('F2'); await ctx.sleep(150); assert.strictEqual((await st()).anchorKey, 'folder:room:' + rid, `${tag}: F2 on the folder menu button`); await closeField(); }
      // the Folders panel row
      await js(`document.getElementById('foldersBtn').click()`); await until(`!document.getElementById('foldersPop').hidden`);
      await click(`#foldersPop .ren[data-renfolder="${rid}"]`, 1); await ctx.sleep(150);
      assert.ok((await st()).open && (await st()).anchorKey === 'folder:fp:' + rid, `${tag}: the Folders panel pencil opens the field`);
      assert.ok(await js(`!document.getElementById('foldersPop').hidden`), `${tag}: the panel stays`);
      await key('Escape'); await ctx.sleep(150); assert.ok(await js(`!document.getElementById('foldersPop').hidden`), `${tag}: Esc closes only the field, not the Folders panel`);
      assert.strictEqual(await js(`!!document.querySelector('#foldersPop [data-fp="rename"]')`), true, `${tag}: the Rename button (dialog) stays`);
      await key('Escape'); await ctx.sleep(200);
      // a closed room's plate: F2 on the plate
      await js(`document.querySelector(${jsLiteral(`#stage .room-head [data-door="${rid}"]`)}).click()`); await until(`!!document.querySelector(${jsLiteral(`#stage .plate[data-door="${rid}"]`)})`);
      await focus(`#stage .plate[data-door="${rid}"]`); await key('F2'); await ctx.sleep(150);
      assert.strictEqual((await st()).anchorKey, 'folder:room:' + rid, `${tag}: F2 on a closed room's plate`);
      // the room opens again while the field is open: the name moves, the field follows; the folder leaves: it closes without a call
      await closeField();
      await js(`document.querySelector(${jsLiteral(`#stage .plate[data-door="${rid}"]`)}).click()`); await until(`!!document.querySelector(${jsLiteral(`#stage .room-head [data-door="${rid}"]`)})`);

      // item 7 of the review (FR-023 item 4, folders): a room hidden or removed while its field is open: it closes, no folder call, focus on a real control
      const rids = await js(`[...document.querySelectorAll('#stage .room-head [data-door]')].map(d=>d.dataset.door)`);
      assert.ok(rids.length >= 3, `${tag}: rooms to hide and remove`);
      const nf2 = await nFold();
      await click(`#stage .ren[data-renfolder="${rids[1]}"]`, 1); await ctx.sleep(120); await type('Never saved folder');
      await js(`__durbarSimUi.hideRoom(${jsLiteral(rids[1])})`); await ctx.sleep(500);
      await none(`${tag} hidden room`); assert.strictEqual(await nFold(), nf2, `${tag}: a hidden room closes the field without a folder call`);
      assert.notStrictEqual(await ae(), 'body', `${tag}: and focus stays on a real control (hide)`);
      await js(`document.getElementById('foldersBtn').click()`); await until(`!document.getElementById('foldersPop').hidden`);
      await click(`#foldersPop .ren[data-renfolder="${rids[2]}"]`, 1); await ctx.sleep(120); await type('Never saved either');
      await js(`__durbarSimUi.removeRoom(${jsLiteral(rids[2])})`); await ctx.sleep(500);
      await none(`${tag} removed room`); assert.strictEqual(await nFold(), nf2, `${tag}: a removed room closes the field without a folder call`);
      assert.notStrictEqual(await ae(), 'body', `${tag}: and focus stays on a real control (remove)`);
      await key('Escape'); await ctx.sleep(200);

      // ---- the dialogs are still there (D6): the card menu's Rename… opens the dialog ----
      await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${A}"]`)}).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:300,clientY:300}))`); await ctx.sleep(300);
      assert.ok(await js(`!!document.querySelector('#modeMenu [data-op="rename"]')`), `${tag}: the card menu still has Rename…`);
      await js(`document.querySelector('#modeMenu [data-op="rename"]').click()`); await ctx.sleep(300);
      assert.ok(await js(`!!document.getElementById('modeDlg')`), `${tag}: it opens the dialog`);
      // F2 does nothing under a dialog (FR-024)
      await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${A}"]`)}).dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true,cancelable:true}))`); await ctx.sleep(150);
      await none(`${tag}: F2 under a dialog`);
      await key('Escape'); await ctx.sleep(200);
      console.log(`[rename-inline] ${tag} ok`);
    }
  }
  // the shortcut sheet lists F2 (T077)
  await js(`document.activeElement&&document.activeElement.blur()`); await key('?', ['shift']); await ctx.sleep(300);
  assert.ok(await js(`[...document.querySelectorAll('#kbdDlg tr')].some(r=>/^F2/.test(r.querySelector('.kb-k').textContent.trim())&&/Rename the focused session or folder/.test(r.textContent))`), 'the shortcut sheet has the F2 row');
  console.log('[rename-inline] all checks passed');

};
