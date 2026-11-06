/*
 * Check for spec 052 FR-237 (owner bug report 2026-11-03: a rename popup closed while its text was being selected). Simulator only
 * (no AI credits, no agent app).
 *
 *   npm run check:ui -- --only check-edit-popups
 *
 * At 1440x900 and 1280x800, for every kind of small text-entry popup (the Rename dialog of dialog.js, the Rename floor dialog over the
 * floors popover, the new floor name in the floors popover, the Place dialog of screens.js, the rename-in-place field on the chat title,
 * on a desk card and in the Folders panel, the command palette, Schedules, the spending limit, New session and New profile dialogs).
 * Popups are opened and put away with synthetic clicks and page calls; the numbered steps use real input (webContents.sendInputEvent
 * and insertText):
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
 * The inbox and the keyboard sheet have no field: a drag from inside the box that ends on the backdrop keeps them, a click there closes.
 * macOS (issue #683): a synthetic Cmd+A, Home or Shift+End reaches the renderer but does not select or move there, so on darwin those
 * steps assert only that the app does not take the key (the popup stays, the text is unchanged); the page selects or moves the caret
 * itself where a later step needs it, and the selection checks of the mouse steps (drag, double-click) are skipped too. A number field
 * has no setSelectionRange (selectionStart is null), so on darwin the page calls its select() instead (#1103), and typing must replace it.
 * EP_ONLY=<regex> runs some kinds; EP_KEEP=1 lists every miss instead of stopping (a survey of an older build, never a pass).
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
  const MAC = process.platform === 'darwin';
  const MOD = MAC ? 'meta' : 'control';
  const log = (...a) => console.log('[edit-popups]', ...a);
  const field = (sel) => js(`(()=>{const i=document.querySelector(${jsLiteral(sel)});if(!i||!i.getClientRects().length)return null;return {v:i.value,s:i.selectionStart,e:i.selectionEnd,focus:document.activeElement===i}})()`);
  const rect = (sel) => js(`(()=>{const e=document.querySelector(${jsLiteral(sel)});if(!e||!e.getClientRects().length)return null;const r=e.getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom}})()`);
  const mouse = (type, x, y, extra = {}) => wc().sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, ...extra });
  const clickAt = (x, y, n = 1) => { for (let c = 1; c <= n; c++) { mouse('mouseDown', x, y, { clickCount: c }); mouse('mouseUp', x, y, { clickCount: c }); } };
  /* a "the popup did NOT close" check has no event to wait for: give the click or key the time it needs to act, then read once */
  const SETTLE = 350;
  /* wait until the field meets `cond` (page code over i = the field, f = it has the focus); the field's state for the message */
  const fieldUntil = async (sel, cond, ms = 3000) => { const ok = await until('(()=>{const i=document.querySelector(' + jsLiteral(sel) + ');if(!i||!i.getClientRects().length)return false;const f=document.activeElement===i;return !!(' + cond + ')})()', ms); return { ok, f: await field(sel) }; }; /* cond is this driver's own page code, never data */
  const pageSel = (sel, a, b) => js(`(()=>{const i=document.querySelector(${jsLiteral(sel)}),a=${jsLiteral(a)},b=${jsLiteral(b)};i.setSelectionRange(a===null?i.value.length:a,b===null?i.value.length:b);return true})()`); /* null: the end of the text */
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
    if(U.toast)U.toast('A live toast while you type');if(U.render)U.render();return true})()`);
  /* a stray focus() on something behind the popup, as a re-render that restores a list row's focus would do */
  const strayFocus = () => js(`(()=>{let got=null;const on=e=>{got=e.target;};document.addEventListener('focusin',on,true);
    for(const sel of ['#msgInput','#settingsBtn','#stage .desk[data-id]']){const e=document.querySelector(sel);if(!e)continue;e.focus();if(got===e)break;}
    document.removeEventListener('focusin',on,true);return !!got&&!got.closest('.dlg')})()`);

  /* k: {name, open(), input, box, modal (has a focus trap), text (a number field's value), close: 'escape'|'backdrop'|'outside'} */
  async function exercise(tag, k) {
    const t = `${tag} ${k.name}`;
    const TEXT = k.text || TEXT0, num = !!k.text; /* a number field has no text selection (selectionStart is null): its selection checks are skipped */
    const L = TEXT.length;
    assert.ok(await k.open(), `${t}: the popup opens`);
    assert.ok(await until(`(()=>{const i=document.querySelector(${jsLiteral(k.input)});return !!i&&i.getClientRects().length>0})()`, 4000), `${t}: the field is shown`);
    const isOpen = () => js(`(()=>{const b=document.querySelector(${jsLiteral(k.box)});return !!b&&b.getClientRects().length>0})()`);
    let ri = await rect(k.input), box = await rect(k.box), r;
    const fy = Math.min((ri.t + ri.b) / 2, ri.t + 14); /* the first text line (a textarea's middle is under its text) */
    // 1. click in the field, select all, type
    if (num) { /* #1103: the number field must hold an old value, or "typing replaces it" is not tested (it starts empty when no limit was set yet) */
      const old = await js(`(()=>{const i=document.querySelector(${jsLiteral(k.input)});if(i.value==='')i.value='50';return i.value})()`);
      assert.ok(old !== '' && old !== TEXT, `${t}: the number field holds another value before the typing: ${jsLiteral(old)}`);
    }
    clickAt(ri.l + 8, fy); await ctx.sleep(SETTLE);
    assert.ok(await isOpen(), `${t}: a click in the field keeps the popup open`);
    await H.key('A', [MOD], { char: 'never' });
    if (MAC && !num) await pageSel(k.input, 0, null); /* #683: a synthetic Cmd+A does not select on macOS; the page does, so typing replaces */
    if (MAC && num) await js(`document.querySelector(${jsLiteral(k.input)}).select()`); /* #1103: a number field has no setSelectionRange, but select() selects its value, so typing replaces it */
    wc().insertText(TEXT);
    r = await fieldUntil(k.input, `i.value===${jsLiteral(TEXT)}&&f`);
    assert.ok(r.ok, `${t}: typed into the field: ${jsLiteral(r.f)}`);
    // 2. a drag from the field's end to outside the popup
    ri = await rect(k.input); box = await rect(k.box);
    const o = outside(box, fy), sx = Math.min(ri.r - 6, ri.l + 200);
    mouse('mouseDown', sx, fy);
    for (let s = 1; s <= 8; s++) { mouse('mouseMove', sx + (o.x - sx) * s / 8, fy + (o.y - fy) * s / 8, { modifiers: ['leftButtonDown'] }); await ctx.sleep(15); }
    mouse('mouseUp', o.x, o.y); await ctx.sleep(SETTLE);
    assert.ok(await isOpen(), `${t}: a drag from the field that ends outside the popup keeps it open`);
    r = await fieldUntil(k.input, `i.value===${jsLiteral(TEXT)}&&f${num || MAC ? '' : '&&i.selectionStart<i.selectionEnd'}`);
    assert.ok(r.ok, `${t}: after the drag the text is intact${num || MAC ? '' : ', selected'} and focused: ${jsLiteral(r.f)}`);
    // 3. Ctrl/Cmd+A
    await H.key('A', [MOD], { char: 'never' });
    if (num || MAC) { await ctx.sleep(SETTLE); r = await fieldUntil(k.input, `i.value===${jsLiteral(TEXT)}&&f`); if (MAC && !num) await pageSel(k.input, 0, null); }
    else r = await fieldUntil(k.input, `i.value===${jsLiteral(TEXT)}&&f&&i.selectionStart===0&&i.selectionEnd===${L}`);
    assert.ok(r.ok && await isOpen(), `${t}: Ctrl/Cmd+A ${num || MAC ? 'is not taken by the app' : 'selects the whole text'} and keeps the popup: ${jsLiteral(r.f)}`);
    const sb = r.f; /* the selection the next steps must keep */
    const sameSel = num ? '' : `&&i.selectionStart===${sb.s}&&i.selectionEnd===${sb.e}`;
    // 4. live events
    await live(); await ctx.sleep(SETTLE * 2); /* the events re-render the page; nothing to wait for when the popup stays */
    assert.ok(await isOpen(), `${t}: live events keep the popup`);
    r = await fieldUntil(k.input, `i.value===${jsLiteral(TEXT)}&&f${sameSel}`);
    assert.ok(r.ok, `${t}: live events keep the text, selection and focus: ${jsLiteral(r.f)}`);
    // 5. a stray focus() behind a modal dialog comes back to the field with its selection
    if (k.modal) {
      assert.ok(await strayFocus(), `${t}: something behind the dialog took the focus (the step is real)`);
      r = await fieldUntil(k.input, `f${sameSel}`);
      assert.ok(r.ok && await isOpen(), `${t}: a stray focus behind the dialog comes back to the field, selection kept: ${jsLiteral(r.f)}`);
    }
    // 6. Home, Shift+End, letters that are shortcuts outside text fields (a number field takes no letters: 6 and 7 are for text)
    if (!num) {
      await H.key('Home', [], { char: 'never' }); await H.key('End', ['shift'], { char: 'never' });
      if (MAC) { await ctx.sleep(SETTLE); r = await fieldUntil(k.input, `i.value===${jsLiteral(TEXT)}&&f`); }
      else r = await fieldUntil(k.input, `i.selectionStart===0&&i.selectionEnd===${L}`);
      assert.ok(r.ok && await isOpen(), `${t}: Home, Shift+End ${MAC ? 'are not taken by the app' : 'select in the field'}: ${jsLiteral(r.f)}`);
      await H.key('End', [], { char: 'never' });
      if (MAC) await pageSel(k.input, null, null); /* #683: End does not move the caret on macOS */
      await H.key('n', [], { char: 'always' }); await H.key('i', [], { char: 'always' });
      r = await fieldUntil(k.input, `i.value===${jsLiteral(TEXT + 'ni')}&&f`);
      assert.ok(r.ok && await isOpen(), `${t}: the letters n and i are typed, not taken by a shortcut: ${jsLiteral(r.f)}`);
      // 7. a double-click on the first word
      ri = await rect(k.input);
      clickAt(ri.l + 14, fy, 2); await ctx.sleep(SETTLE);
      assert.ok(await isOpen(), `${t}: a double-click in the field keeps the popup`);
      r = await fieldUntil(k.input, `i.value===${jsLiteral(TEXT + 'ni')}${MAC ? '' : `&&i.selectionStart===0&&i.selectionEnd>0&&i.selectionEnd<${L + 2}`}`);
      assert.ok(r.ok, `${t}: ${MAC ? 'the text is intact' : 'a double-click selects a word'}: ${jsLiteral(r.f)}`);
    }
    // 8. a real click outside still closes it
    if (k.close === 'escape') await H.key('Escape', [], { char: 'never' });
    else { box = await rect(k.box); const p = outside(box, fy); clickAt(p.x, p.y); }
    assert.ok(await until(`(()=>{const b=document.querySelector(${jsLiteral(k.box)});return !b||!b.getClientRects().length})()`, 3000), `${t}: ${k.close === 'escape' ? 'Escape' : 'a click outside'} closes it`);
    log(`${t}: ok`);
    await reset();
  }
  /* a dialog with no field (the inbox, the keyboard sheet): a drag from inside its box that ends on the backdrop keeps it; a click on the backdrop closes it */
  async function dragOnly(tag, k) {
    const t = `${tag} ${k.name}`;
    assert.ok(await k.open(), `${t}: the popup opens`);
    const box = await rect(k.box);
    const sx = box.l + 30, sy = box.t + 14, o = outside(box, sy);
    mouse('mouseDown', sx, sy);
    for (let s = 1; s <= 8; s++) { mouse('mouseMove', sx + (o.x - sx) * s / 8, sy + (o.y - sy) * s / 8, { modifiers: ['leftButtonDown'] }); await ctx.sleep(15); }
    mouse('mouseUp', o.x, o.y); await ctx.sleep(SETTLE); /* nothing to wait for when it stays */
    assert.ok(await js(`(()=>{const b=document.querySelector(${jsLiteral(k.box)});return !!b&&b.getClientRects().length>0})()`), `${t}: a drag from inside that ends on the backdrop keeps it open`);
    clickAt(o.x, o.y);
    assert.ok(await until(`!document.querySelector(${jsLiteral(k.box)})`, 3000), `${t}: a click on the backdrop closes it`);
    log(`${t}: ok`);
    await reset();
  }

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, query: Q, ready: 'fit', settle: false });
    await until(`document.querySelectorAll('#stage .desk[data-id]').length>=3`, 10000);
    await H.focusPage({ emulate: 'first' });
    try {
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
      { name: 'new session', input: '#sdCap', text: '5', box: '#sessDlg .dlg', close: 'backdrop',
        open: async () => { await reset(); if (!(await openChatWhere(`document.getElementById('newSessHdrBtn')`))) return false; await H.click('#newSessHdrBtn'); return until(`(()=>{const c=document.getElementById('sdCap');return !!c&&c.getClientRects().length>0})()`, 4000); } },
      { name: 'inbox', dragOnly: true, box: '#inboxDlg .dlg',
        open: async () => { await reset(); await js(`document.activeElement&&document.activeElement.blur()`); await H.key('I', [], { char: 'never' }); return until(`!!document.querySelector('#inboxDlg .dlg')`, 3000); } },
      { name: 'keyboard sheet', dragOnly: true, box: '#kbdDlg .dlg',
        open: async () => { await reset(); await js(`document.activeElement&&document.activeElement.blur()`); await H.key('/', ['shift'], { char: 'always' }); if (!(await until(`!!document.getElementById('kbdDlg')`, 2000))) { await H.click('#topMoreBtn'); await H.click('#kbdHelpBtn'); } return until(`!!document.querySelector('#kbdDlg .dlg')`, 3000); } },
    ];
    const only = process.env.EP_ONLY ? new RegExp(process.env.EP_ONLY) : null;
    for (const k of KINDS) {
      if (only && !only.test(k.name)) continue;
      const run = k.dragOnly ? dragOnly : exercise;
      if (process.env.EP_KEEP !== '1') { await run(tag, k); continue; }
      try { await run(tag, k); } catch (e) { log(`MISS ${String(e.message).split('\n')[0]}`); await reset(); } /* EP_KEEP=1: list every miss (to compare with an older build); never a pass */
    }
    } finally { await H.releaseFocus(); } /* the focus emulation of focusPage({emulate}) hides blurs: always ended (driver-helpers) */
  }
  if (process.env.EP_KEEP === '1') log('EP_KEEP=1: a survey, not a check'); else log('all checks passed');
};
