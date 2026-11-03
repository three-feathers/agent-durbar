/*
 * Check for spec 052 FR-237 (owner bug report 2026-11-03: "when I enter text in rename popups, the popup closed; I think when I select
 * all"). Simulator only (no AI credits, no agent app).
 *
 *   npm run check:ui -- --only check-edit-popups
 *
 * At 1440x900 and 1280x800, for every kind of small text-entry popup (the Rename dialog of dialog.js, the Rename floor dialog over the
 * floors popover, the new floor name in the floors popover, the Place dialog of screens.js, the rename-in-place field on the chat title,
 * on a desk card and in the Folders panel, the command palette, Schedules, the spending limit dialog and the New profile dialog), with
 * real input events (webContents.sendInputEvent / insertText, never a synthetic DOM event):
 *   1. a click in the field, Ctrl/Cmd+A and typed text;
 *   2. a mouse drag that starts in the field and ends outside the popup (on the backdrop, or beside the popover): the popup stays open,
 *      the text is unchanged and the drag's selection is there (the bug: the browser sends that click to the backdrop);
 *   3. Ctrl/Cmd+A selects the whole text and nothing else happens;
 *   4. live events while typing (status ticks on every desk, permission requests, a toast, a full render): open, text, selection and
 *      focus intact;
 *   5. a stray focus() on the page behind it (a modal dialog takes the focus back to the field, with its selection);
 *   6. Home, Shift+End and the letters n, i (global shortcuts outside text fields) type into the field;
 *   7. a double-click on a word selects it and the popup stays;
 *   8. a real click on the backdrop (or outside a popover) still closes it, so the guard is not a trap; Escape for the field kinds.
 * A miss prints DRIVER FAILED (Electron still exits 0), so the suite fails unless "all checks passed" is printed.
 */
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');
const Q = { sim: '15', simfreeze: '1', simfloors: '1' }; // simfloors: the floors popover and its fields are shown
const TEXT0 = 'Draft name 42';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const js = H.js;
  const wc = () => ctx.win.webContents;
  const until = (expr, ms = 4000) => H.until(expr, ms);
  const MOD = process.platform === 'darwin' ? 'meta' : 'control';
  const log = (...a) => console.log('[edit-popups]', ...a);
  const field = (sel) => js(`(()=>{const i=document.querySelector(${jsLiteral(sel)});if(!i||!i.getClientRects().length)return null;return {v:i.value,s:i.selectionStart,e:i.selectionEnd,focus:document.activeElement===i}})()`);
  const rect = (sel) => js(`(()=>{const e=document.querySelector(${jsLiteral(sel)});if(!e||!e.getClientRects().length)return null;const r=e.getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom}})()`);
  const mouse = (type, x, y, extra = {}) => wc().sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, ...extra });
  const clickAt = async (x, y, n = 1) => { for (let c = 1; c <= n; c++) { mouse('mouseDown', x, y, { clickCount: c }); mouse('mouseUp', x, y, { clickCount: c }); } await ctx.sleep(150); };
  /* the point just outside the popup's box: to its left on the field's line when there is room, else above it */
  const outside = (box, fy) => (box.l > 40 ? { x: box.l - 24, y: fy } : { x: (box.l + box.r) / 2, y: box.t > 40 ? box.t - 20 : box.b + 20 });
  const reset = async () => {
    await js(`(()=>{if(window.DurbarInlineName&&window.DurbarInlineName.current().open)window.DurbarInlineName.close('gone');document.querySelectorAll('.dlg-ov').forEach(d=>d.remove());['modeMenu','agentMenu','modelMenu'].forEach(i=>{const e=document.getElementById(i);if(e)e.remove();});['topMoreMenu','defaultsPop','foldersPop','floorsPop'].forEach(i=>{const e=document.getElementById(i);if(e)e.hidden=true;});const c=document.getElementById('scrClose');if(c)c.click();})()`);
    if (await js(`document.body.classList.contains('panel-open')`)) { await H.click('#backBtn'); await until(`!document.body.classList.contains('panel-open')`, 3000); }
    await ctx.sleep(150);
  };
  const ids = () => js(`[...document.querySelectorAll('#stage .desk[data-id]')].filter(d=>d.getClientRects().length).map(d=>d.dataset.id)`);
  const openChat = async (id) => { await reset(); await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"]`)}).click()`); await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('panelTitle')`, 4000); await ctx.sleep(500); };
  const openChatWhere = async (expr) => { for (const id of await ids()) { await openChat(id); if (await js(`(()=>{try{return !!(${expr})}catch(e){return false}})()`)) return id; } return null; };
  const openSettings = async () => { await reset(); await H.click('#settingsBtn'); await until(`!!document.getElementById('themeH')`, 4000); await js(`document.querySelectorAll('#screen details.scr-more').forEach(d=>d.open=true)`); await ctx.sleep(300); };
  /* live events while the popup is open: a status tick on every desk, permission requests on three, a toast and a full render */
  const live = () => js(`(()=>{const U=__durbarSimUi,ids=[...document.querySelectorAll('#stage .desk[data-id]')].map(d=>d.dataset.id),t=Date.now();
    ids.forEach(id=>U.emit({type:'status',sessionId:id,timestamp:t,status:'working',intent:'tick'}));
    ids.slice(0,3).forEach((id,k)=>U.emit({type:'status',sessionId:id,timestamp:t,status:'needs-permission',intent:'write',permission:{requestId:'fr237-'+t+'-'+k,kind:'write',summary:'write notes.md',scopeKey:'k'+k,scopeLabel:'notes.md'}}));
    if(U.toast)U.toast('A live toast while you type',3000);if(U.render)U.render();return true})()`);
  /* a stray focus() on something behind the popup, as a re-render that restores a list row's focus would do */
  const strayFocus = () => js(`(()=>{let got=null;const on=e=>{got=e.target;};document.addEventListener('focusin',on,true);
    for(const sel of ['#msgInput','#settingsBtn','#stage .desk[data-id]']){const e=document.querySelector(sel);if(!e)continue;e.focus();if(got===e)break;}
    document.removeEventListener('focusin',on,true);return !!got&&!got.closest('.dlg')})()`);

  /* k: {name, open(), input, box, modal (has a focus trap), backdrop (selector of the overlay; null for a popover), close: 'escape'|'backdrop'|'outside'} */
  async function exercise(tag, k) {
    const t = `${tag} ${k.name}`;
    const TEXT = k.text || TEXT0, num = !!k.text; /* a number field has no text selection (selectionStart is null): its selection checks are skipped */
    const sel = (f, a, b) => num || (f.s === a && f.e === b);
    assert.ok(await k.open(), `${t}: the popup opens`);
    assert.ok(await until(`(()=>{const i=document.querySelector(${jsLiteral(k.input)});return !!i&&i.getClientRects().length>0})()`, 4000), `${t}: the field is shown`);
    const isOpen = () => js(`(()=>{const b=document.querySelector(${jsLiteral(k.box)});return !!b&&b.getClientRects().length>0})()`);
    let ri = await rect(k.input), box = await rect(k.box);
    const fy = Math.min((ri.t + ri.b) / 2, ri.t + 14); /* the first text line (a textarea's middle is under its text) */
    // 1. click in the field, select all, type
    await clickAt(ri.l + 8, fy);
    assert.ok(await isOpen(), `${t}: a click in the field keeps the popup open`);
    await H.key('A', [MOD], { char: 'never' }); wc().insertText(TEXT); await ctx.sleep(150);
    let f = await field(k.input);
    assert.ok(f && f.v === TEXT && f.focus, `${t}: typed into the field: ${jsLiteral(f)}`);
    // 2. a drag from the field's end to outside the popup
    ri = await rect(k.input); box = await rect(k.box);
    const o = outside(box, fy), sx = Math.min(ri.r - 6, ri.l + 200);
    mouse('mouseDown', sx, fy);
    for (let s = 1; s <= 8; s++) { mouse('mouseMove', sx + (o.x - sx) * s / 8, fy + (o.y - fy) * s / 8, { modifiers: ['leftButtonDown'] }); await ctx.sleep(15); }
    mouse('mouseUp', o.x, o.y); await ctx.sleep(300);
    assert.ok(await isOpen(), `${t}: a drag from the field that ends outside the popup keeps it open`);
    f = await field(k.input);
    assert.ok(f && f.v === TEXT && (num || f.s < f.e) && f.focus, `${t}: after the drag the text is intact, selected and focused: ${jsLiteral(f)}`);
    // 3. Ctrl/Cmd+A
    await H.key('A', [MOD], { char: 'never' }); await ctx.sleep(150);
    f = await field(k.input);
    assert.ok(await isOpen() && f && f.v === TEXT && sel(f, 0, TEXT.length), `${t}: Ctrl/Cmd+A selects the whole text and keeps the popup: ${jsLiteral(f)}`);
    // 4. live events
    await live(); await ctx.sleep(700);
    f = await field(k.input);
    assert.ok(await isOpen() && f && f.v === TEXT && sel(f, 0, TEXT.length) && f.focus, `${t}: live events keep the popup, text, selection and focus: ${jsLiteral(f)}`);
    // 5. a stray focus() behind a modal dialog comes back to the field with its selection
    if (k.modal) {
      assert.ok(await strayFocus(), `${t}: something behind the dialog took the focus (the step is real)`); await ctx.sleep(150);
      f = await field(k.input);
      assert.ok(await isOpen() && f && f.focus && sel(f, 0, TEXT.length), `${t}: a stray focus behind the dialog comes back to the field, selection kept: ${jsLiteral(f)}`);
    }
    // 6. Home, Shift+End, letters that are shortcuts outside text fields (a number field takes no letters: 6 and 7 are for text)
    if (!num) {
    await H.key('Home', [], { char: 'never' }); await H.key('End', ['shift'], { char: 'never' }); await ctx.sleep(100);
    f = await field(k.input);
    assert.ok(f && f.s === 0 && f.e === TEXT.length, `${t}: Home, Shift+End select in the field: ${jsLiteral(f)}`);
    await H.key('End', [], { char: 'never' }); await H.key('n', [], { char: 'always' }); await H.key('i', [], { char: 'always' }); await ctx.sleep(200);
    f = await field(k.input);
    assert.ok(await isOpen() && f && f.v === TEXT + 'ni' && f.focus, `${t}: the letters n and i are typed, not taken by a shortcut: ${jsLiteral(f)}`);
    // 7. a double-click on the first word
    ri = await rect(k.input);
    await clickAt(ri.l + 14, fy, 2); await ctx.sleep(150);
    f = await field(k.input);
    assert.ok(await isOpen() && f && f.v === TEXT + 'ni' && f.s === 0 && f.e > 0 && f.e < f.v.length, `${t}: a double-click selects a word and keeps the popup: ${jsLiteral(f)}`);
    }
    // 8. a real click outside still closes it
    if (k.close === 'escape') { await H.key('Escape', [], { char: 'never' }); await ctx.sleep(200); }
    else { box = await rect(k.box); const p = outside(box, fy); await clickAt(p.x, p.y); }
    assert.ok(await until(`(()=>{const b=document.querySelector(${jsLiteral(k.box)});return !b||!b.getClientRects().length})()`, 3000), `${t}: ${k.close === 'escape' ? 'Escape' : 'a click outside'} closes it`);
    log(`${t}: ok`);
    await reset();
  }

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, query: Q, ready: 'fit', settle: false });
    await until(`document.querySelectorAll('#stage .desk[data-id]').length>=3`, 10000);
    await H.focusPage({ emulate: true });
    const tag = `${w}x${h}`;
    const [A, B] = await ids();
    const KINDS = [
      { name: 'rename dialog', input: '#mdIn', box: '#modeDlg .dlg', modal: true, close: 'backdrop',
        open: async () => { await openChat(A); await H.click('#moreBtn'); await until(`!!document.getElementById('renameSessBtn')`, 2000); await H.click('#renameSessBtn'); return until(`!!document.getElementById('mdIn')`, 3000); } },
      { name: 'title in place', input: '.inl-input', box: '.inl-layer', close: 'escape',
        open: async () => { await openChat(B); await H.click('#panelTitleBtn'); return until(`!!document.querySelector('.inl-input')`, 3000); } },
      { name: 'card in place', input: '.inl-input', box: '.inl-layer', close: 'escape',
        open: async () => { await reset(); await js(`document.querySelector(${jsLiteral(`#stage .ren[data-ren="${A}"]`)}).click()`); return until(`!!document.querySelector('.inl-input')`, 3000); } },
      { name: 'folder in place (Folders panel)', input: '.inl-input', box: '#foldersPop', close: 'outside',
        open: async () => { await reset(); await H.click('#foldersBtn'); await until(`!document.getElementById('foldersPop').hidden`, 3000); if (!(await js(`(()=>{const b=document.querySelector('#foldersPop .ren[data-renfolder]');if(!b)return false;b.click();return true})()`))) return false; return until(`!!document.querySelector('.inl-input')`, 3000); } },
      { name: 'new floor name (floors popover)', input: '#floorsPop .fl-new input', box: '#floorsPop', close: 'outside',
        open: async () => { await reset(); if (await js(`document.getElementById('floorsBtn').hidden`)) return false; await H.click('#floorsBtn'); return until(`!document.getElementById('floorsPop').hidden`, 3000); } },
      { name: 'rename floor dialog', input: '#mdIn', box: '#modeDlg .dlg', modal: true, close: 'backdrop',
        open: async () => { await reset(); await H.click('#floorsBtn'); await until(`!document.getElementById('floorsPop').hidden`, 3000); await H.click('#floorsPop [data-fl="rename"]'); return until(`!!document.getElementById('mdIn')`, 3000); } },
      { name: 'place dialog', input: '#scrDlg input[type="text"]', box: '#scrDlg .dlg', close: 'backdrop',
        open: async () => { await openSettings(); const ok = await js(`(()=>{const b=[...document.querySelectorAll('#screen button')].find(x=>/^\\+?\\s*(Add|New) (a )?place/i.test(x.textContent.trim()));if(!b)return false;b.click();return true})()`); return ok && until(`!!document.querySelector('#scrDlg input[type="text"]')`, 3000); } },
      { name: 'command palette', input: '#palDlg input', box: '#palDlg .dlg', close: 'backdrop',
        open: async () => { await reset(); await js(`document.activeElement&&document.activeElement.blur()`); await H.key('K', [MOD], { char: 'never' }); return until(`!!document.querySelector('#palDlg input')`, 3000); } },
      { name: 'schedules', input: '#scPrompt', box: '#schedDlg .dlg', close: 'backdrop',
        open: async () => { await openChat(A); await H.click('#moreBtn'); await until(`!!document.getElementById('schedHdrBtn')`, 2000); await H.click('#schedHdrBtn'); return until(`!!document.getElementById('scPrompt')`, 3000); } },
      { name: 'spending limit', input: '#cdVal', text: '42', box: '#capDlg .dlg', close: 'backdrop',
        open: async () => { await reset(); if (!(await openChatWhere(`document.getElementById('capChip')`))) return false; await H.click('#capChip'); return until(`!!document.getElementById('cdVal')`, 3000); } },
      { name: 'new profile', input: '#peNName', box: '#peNewOv .dlg', close: 'backdrop',
        open: async () => { await openSettings(); if (!(await until(`!!document.getElementById('pfNew')`, 4000))) return false; await H.click('#pfNew'); return until(`!!document.getElementById('peNName')`, 3000); } },
    ];
    const only = process.env.EP_ONLY ? new RegExp(process.env.EP_ONLY) : null;
    for (const k of KINDS) {
      if (only && !only.test(k.name)) continue;
      if (process.env.EP_KEEP !== '1') { await exercise(tag, k); continue; }
      try { await exercise(tag, k); } catch (e) { log(`MISS ${String(e.message).split('\n')[0]}`); await reset(); } /* EP_KEEP=1: list every miss (to compare with an older build); never a pass */
    }
  }
  if (process.env.EP_KEEP === '1') log('EP_KEEP=1: a survey, not a check'); else log('all checks passed');
};
