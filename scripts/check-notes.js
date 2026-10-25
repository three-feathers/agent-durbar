/*
 * Check for spec 083 (folder notes, issue 699), the MVP: save a message, the Notes drawer, Insert, and notes in the "/" list.
 * Simulator only (no AI credits, nothing written to disk: the simulator keeps notes in memory).
 *
 *   npm run check:notes
 *   OUT=docs/screenshots  (optional) where the screenshots go (default: a temp folder)
 *
 * At 1440x900 and 1280x800 with 15 agents (US1 scenarios 1..6 of the spec):
 *   1. a reply's ⋯ -> Save to notes: a toast with Rename… and Show; a note with the reply's text, a title from its first line and a
 *      link to this session; the 4-action loop of SC-001 (⋯, Save, Show, Insert) puts the text in the message box and sends nothing;
 *   2. the same reply again: the menu says Show in notes and a second save says Already in notes (no second note);
 *   3. Ctrl+Shift+M opens the drawer with focus on its first row, This session first; the same keys close it and focus goes back;
 *      Esc closes the drawer, a second Esc closes the chat; More > Notes… and Ctrl+K Notes open it too;
 *   4. Insert puts the text at the caret (a blank line when the box has text), sends nothing, focuses the box and announces it;
 *   5. "/pla" lists the note after the commands (a chat whose agent app lists no commands opens the list for notes too, and not
 *      without notes); Enter replaces the /word with the text and sends nothing;
 *   6. simnotes=secret and a user message holding a fake token: no token in the store, the drawer, the "/" list, any title or ARIA
 *      value, the message box or the announcements; the notice above the box says parts were hidden.
 * Also: + Note, Edit…, Rename…, Delete… (Cancel focused, then the next row, else the previous, else + Note), roving tabindex, a hostile
 * title is text (never HTML), the drawer covers the chat log only and fits the panel, text is at least 10.5px, the office still
 * shows 15 desks. A miss throws (DRIVER FAILED); the npm script exits non-zero unless "all checks passed" is printed.
 */
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const OUT = process.env.OUT || process.env.SHOTS_OUT || require('os').tmpdir();
const SIZES = process.env.NOTES_ONE_SIZE ? [[1440, 900]] : [[1440, 900], [1280, 800]]; /* NOTES_ONE_SIZE=1: one size, for a quick run (the planted-mutation runs) */
const CTRL = ['control', 'shift'];
/* fake token, built at run time (push protection) */
const BODY = 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5';
const TOKEN = 'gh' + 'p_' + BODY;
const leak = (t) => { const x = String(t || ''); for (let i = 0; i + 8 <= BODY.length; i++) if (x.includes(BODY.slice(i, i + 8))) return BODY.slice(i, i + 8); return ''; };

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js, key, wc } = H;
  const fails = [];
  wc().on('console-message', (...a) => { const m = a[0] && a[0].message !== undefined ? a[0] : { level: a[1], message: a[2] }; if (m.level === 'error' || m.level === 3) console.log('PAGE ERROR', String(m.message).slice(0, 300)); });
  const check = (cond, msg) => { if (!cond) { fails.push(msg); console.log('FAIL ' + msg); } };
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'calm', tag: 'notes', keepActions: false });
  const load = async (w, h, q) => { await H.load({ w, h, query: { simkinds: 'mixed', ...(q || {}) }, ready: 'fit' }); await inject(); };
  const typeChars = async (t) => { for (const ch of t) { wc().sendInputEvent({ type: 'char', keyCode: ch }); await ctx.sleep(25); } await ctx.sleep(60); };
  const open = async (name) => {
    const id = await H.idOf(name);
    assert.ok(id, `${name} is on the floor`);
    if (await js(`document.body.classList.contains('panel-open')`)) { await js(`document.getElementById('backBtn').click()`); await until(`!document.body.classList.contains('panel-open')`, 4000); }
    await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"]`)}).click()`);
    await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('msgInput')&&window.__durbarSimUi.notes.all().length>=0`, 15000);
    await settle();
    await until(`(()=>{const v=e=>!!e&&e.getClientRects().length>0;return v(document.getElementById('sendBtn'))})()`, 15000);
    return id;
  };
  const focusBox = (v) => js(`(()=>{const m=document.getElementById('msgInput');m.focus();m.value=${jsLiteral(v || '')};m.setSelectionRange(m.value.length,m.value.length);m.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const value = () => js(`document.getElementById('msgInput').value`);
  const users = () => js(`document.querySelectorAll('#panel .msg.user').length`);
  const notes = () => js(`JSON.stringify(window.__durbarSimUi.notes.all())`).then((t) => JSON.parse(t));
  const ann = () => js(`document.getElementById('srAnnounce').textContent`);
  const drawerOpen = () => js(`(()=>{const d=document.getElementById('notesDrawer');return !!d&&!d.hidden&&d.getClientRects().length>0})()`);
  const active = () => js(`(()=>{const a=document.activeElement;return a?(a.id||a.className||a.tagName):''})()`);
  const toastText = () => js(`[...document.querySelectorAll('#toasts .toast')].map(t=>t.textContent).join(' | ')`);
  const openDrawer = async () => { await key('M', CTRL, { char: 'never' }); return until(`(()=>{const d=document.getElementById('notesDrawer');return !!d&&!d.hidden&&!!d.querySelector('.nt-row,.nt-empty')})()`, 5000); };
  const closeDrawer = async () => { if (await drawerOpen()) { await key('Escape'); await until(`document.getElementById('notesDrawer').hidden`, 3000); } };
  /* the first finished reply of the open chat: its ⋯ and index */
  /* page helpers, installed after every load: the first finished reply's ⋯ and a drawer row by title text (no value is spliced into page code) */
  const inject = () => js(`window.__ntd={dots:()=>{const b=[...document.querySelectorAll('#chat .msg.agent .bubble')].find(x=>x.querySelector(':scope > .nt-btn'));return b?b.querySelector(':scope > .nt-btn'):null},row:t=>[...document.querySelectorAll('#notesDrawer .nt-row')].find(r=>r.querySelector('.nt-title').textContent.includes(t))};true`);
  const pressDots = async () => { check(await until('!!__ntd.dots()', 8000), 'a finished reply has a ⋯'); await js('__ntd.dots().click()'); return until(`!!document.querySelector('#modeMenu [data-nact]')`, 3000); };
  /* every text node, title and aria-* value in some root, for the secret checks */
  const texts = (sel) => js(`(()=>{const out=[];for(const r of document.querySelectorAll(${jsLiteral(sel)})){out.push(r.textContent);for(const e of [r,...r.querySelectorAll('*')])for(const a of e.attributes)if(a.name==='title'||a.name==='aria-label'||a.name==='aria-description')out.push(a.name+'='+a.value);}return out;})()`);

  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    await load(w, h, { simnotes: undefined });
    check((await js(`document.querySelectorAll('#stage .desk[data-id]').length`)) === 15, `${tag}: 15 desks on the floor`);
    await open('Noor');
    await js(`document.getElementById('msgInput').focus()`);

    /* ---- scenario 1: ⋯ -> Save to notes (and the 4-action loop of SC-001) ---- */
    const u0 = await users();
    check(await js(`document.querySelectorAll('#chat .msg.user .nt-btn').length>0`), `${tag}: the user's message has a ⋯ too`);
    check(await js(`document.querySelectorAll('#chat .think-body .nt-btn,#chat .chip .nt-btn,#chat .note .nt-btn').length===0`), `${tag}: no ⋯ on a thinking block, a tool chip or a request card`);
    const dots = await js(`(()=>{const b=__ntd.dots();return b?{label:b.getAttribute('aria-label'),haspopup:b.getAttribute('aria-haspopup'),w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height,cp:!!b.parentElement.querySelector(':scope > .cp-msg')}:null})()`);
    check(dots && dots.label === 'Actions for this message' && dots.haspopup === 'menu' && dots.cp, `${tag}: the ⋯ is named and sits next to Copy (${JSON.stringify(dots)})`);
    const replyText = await js(`__ntd.dots().parentElement._raw||''`);
    let actions = 0;
    check(await pressDots(), `${tag}: ⋯ opens the menu`); actions++;
    const items = await js(`[...document.querySelectorAll('#modeMenu [data-nact] b')].map(b=>b.textContent).join(',')`);
    check(items === 'Save to notes,Copy', `${tag}: the menu holds ${items}`);
    check(await js(`document.getElementById('modeMenu').getAttribute('role')==='menu'&&document.activeElement.getAttribute('data-nact')==='save'`), `${tag}: the menu is a menu and focus is on Save to notes`);
    await key('Down'); await key('Up'); /* arrows wrap */
    check(await js(`document.activeElement.getAttribute('data-nact')==='save'`), `${tag}: arrows move and wrap in the menu`);
    await key('Return'); actions++; /* Save to notes */
    check(await until(`/Saved to notes/.test([...document.querySelectorAll('#toasts .toast')].map(t=>t.textContent).join(' '))`, 5000), `${tag}: no "Saved to notes" toast (${await toastText()})`);
    const tbtn = await js(`[...document.querySelectorAll('#toasts .toast .toast-act')].map(b=>b.textContent).join(',')`);
    check(tbtn === 'Rename…,Show', `${tag}: the toast has ${tbtn}`);
    let all = await notes();
    check(all.length === 1, `${tag}: one note after one save (${all.length})`);
    const n1 = all[0] || {};
    check(n1.from === 'agent' && n1.source && n1.source.role === 'agent' && /^sim-\d+$/.test(n1.source.session) && n1.rev === 1 && !n1.done, `${tag}: the note's fields ${JSON.stringify(n1).slice(0, 200)}`);
    const wantTitle = (replyText.split('\n').find((l) => l.trim()) || '').replace(/[#*`_>\-\s]+/g, ' ').trim().slice(0, 30);
    check(wantTitle && n1.title && n1.title.replace(/[#*`_>\-\s]+/g, ' ').trim().startsWith(wantTitle.slice(0, 20)), `${tag}: the title comes from the first line ("${n1.title}" vs "${wantTitle}")`);
    check(n1.text && n1.text.replace(/\s+/g, ' ').trim() === replyText.replace(/\s+/g, ' ').trim(), `${tag}: the note holds the reply's text`);
    /* Show in the toast opens the drawer (action 3), Insert (action 4) */
    await js(`[...document.querySelectorAll('#toasts .toast .toast-act')].find(b=>b.textContent==='Show').click()`); actions++;
    check(await until(`(()=>{const d=document.getElementById('notesDrawer');return !!d&&!d.hidden&&!!d.querySelector('.nt-row')})()`, 5000), `${tag}: Show opens the drawer`);
    check(await until(`document.activeElement&&document.activeElement.classList.contains('nt-row')`, 3000), `${tag}: focus is on the saved note's row (${await active()})`);
    await focusBox('');
    await js(`document.getElementById('notesDrawer').querySelector('[data-nt="insert"]').click()`); actions++;
    check(actions === 4, `${tag}: the loop took ${actions} actions`);
    check(await until(`document.getElementById('msgInput').value.length>0`, 3000), `${tag}: Insert put no text in the box`);
    check((await value()).replace(/\s+/g, ' ').trim() === n1.text.replace(/\s+/g, ' ').trim(), `${tag}: the box holds the note's text`);
    check((await users()) === u0 && !(await js(`!!document.querySelector('#panel .typing')`)), `${tag}: Insert sent nothing (messages ${await users()} vs ${u0})`);
    check(!(await drawerOpen()) && (await active()) === 'msgInput', `${tag}: after Insert the drawer is closed and the box has focus (${await active()})`);
    check(await until(`/Inserted the note/.test(document.getElementById('srAnnounce').textContent)`, 3000), `${tag}: Insert is announced (${await ann()})`);

    /* ---- scenario 2: the same reply again ---- */
    await focusBox('');
    check(await pressDots(), `${tag}: ⋯ opens the menu again`);
    check(await until(`document.querySelector('#modeMenu [data-nact]').getAttribute('data-nact')==='show'`, 3000), `${tag}: a saved reply's menu reads Show in notes`);
    check(/Show in notes/.test(await js(`document.querySelector('#modeMenu [data-nact] b').textContent`)), `${tag}: the first item is Show in notes`);
    await key('Escape'); /* Esc closes the menu and focus returns to the ⋯ */
    check(await until(`!document.getElementById('modeMenu')`, 2000) && (await js(`document.activeElement===__ntd.dots()`)), `${tag}: Esc closes the menu and returns focus to the ⋯ (${await active()})`);
    check(await js(`document.body.classList.contains('panel-open')`), `${tag}: Esc in the menu did not close the chat`);
    await js(`window.__durbarSimUi.notes.saveMsg(__ntd.dots())`);
    check(await until(`/Already in notes/.test([...document.querySelectorAll('#toasts .toast')].map(t=>t.textContent).join(' '))`, 4000), `${tag}: a second save says Already in notes (${await toastText()})`);
    check((await notes()).length === 1, `${tag}: no second note`);
    /* Tab also leaves the menu and returns focus */
    await pressDots(); await key('Tab');
    check(await until(`!document.getElementById('modeMenu')`, 2000) && (await js(`document.activeElement===__ntd.dots()`)), `${tag}: Tab closes the menu and returns focus to the ⋯`);
    /* right click on a message opens the same menu */
    await js(`(()=>{const b=__ntd.dots().parentElement;b.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:300,clientY:300}));})()`);
    check(await until(`!!document.querySelector('#modeMenu [data-nact]')`, 2000), `${tag}: right-click opens the message menu`);
    await key('Escape');

    /* ---- scenario 3: the drawer and its keys ---- */
    await focusBox('');
    check(await openDrawer(), `${tag}: Ctrl+Shift+M opens the drawer`);
    check(await until(`document.activeElement&&document.activeElement.classList.contains('nt-row')`, 3000), `${tag}: focus is on the first row (${await active()})`);
    const geo = await js(`(()=>{const R=e=>e.getBoundingClientRect();const d=document.getElementById('notesDrawer'),c=document.getElementById('chat'),p=document.getElementById('panel'),cm=document.querySelector('#panel .composer'),hd=document.getElementById('panelHead');
      const dr=R(d),cr=R(c),pr=R(p),mr=R(cm),hr=R(hd);const P=[];
      if(Math.abs(dr.top-cr.top)>1.5||Math.abs(dr.bottom-cr.bottom)>1.5||Math.abs(dr.left-cr.left)>1.5||Math.abs(dr.right-cr.right)>1.5)P.push('the drawer is not the chat log\\'s box '+JSON.stringify([dr.top,dr.bottom,cr.top,cr.bottom]));
      if(dr.bottom>mr.top+0.5)P.push('the drawer covers the message box');
      if(dr.top<hr.bottom-0.5)P.push('the drawer covers the header');
      if(dr.left<pr.left-1||dr.right>pr.right+1)P.push('the drawer leaves the panel');
      const small=[...d.querySelectorAll('*')].filter(e=>e.getClientRects().length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&parseFloat(getComputedStyle(e).fontSize)<10.5).map(e=>e.className||e.tagName);
      if(small.length)P.push('text under 10.5px: '+small.slice(0,3).join());
      const inp=document.getElementById('msgInput');if(!inp||inp.getClientRects().length===0)P.push('the message box is not visible');
      return {P,role:d.getAttribute('role'),name:d.getAttribute('aria-label'),composerVisible:R(inp).height>0};})()`);
    (geo.P || []).forEach((p) => check(false, `${tag}: ${p}`));
    check(geo.role === 'region' && geo.name === 'Notes', `${tag}: the drawer is a region named Notes`);
    const grp = await js(`[...document.querySelectorAll('#notesDrawer h4')].map(h=>h.textContent).join(',')`);
    check(grp === 'This session', `${tag}: the groups are ${grp}`);
    check(await js(`document.getElementById('chat').getClientRects().length>0`), `${tag}: the chat log still exists under the drawer`);
    /* the composer stays usable while the drawer is open */
    await js(`document.getElementById('msgInput').focus()`); await typeChars('x');
    check((await value()).endsWith('x'), `${tag}: the message box takes text while the drawer is open`);
    await focusBox('');
    await shot(`083-notes-drawer-${tag}.png`);
    /* the same keys close it and focus goes back to where it was */
    await js(`document.getElementById('msgInput').focus()`);
    await key('M', CTRL, { char: 'never' });
    check(await until(`document.getElementById('notesDrawer').hidden`, 3000) && (await active()) === 'msgInput', `${tag}: the same keys close it and focus goes back (${await active()})`);
    /* More > Notes… */
    await js(`document.getElementById('moreBtn').click()`);
    check(await until(`!!document.getElementById('notesHdrBtn')&&!document.getElementById('moreMenu').hidden`, 2000), `${tag}: More has Notes…`);
    check(/Ctrl\+Shift\+M|Shift\+M|M/.test(await js(`document.getElementById('notesHdrBtn').textContent`)), `${tag}: the More item names the shortcut`);
    await js(`document.getElementById('notesHdrBtn').click()`);
    check(await until(`!document.getElementById('notesDrawer').hidden`, 4000), `${tag}: More > Notes… opens the drawer`);
    /* FR-025 / T022 AC7: with the Browser tab selected, opening Notes selects Chat first (spec 080's tabs) */
    await key('Escape');
    await until(`document.getElementById('notesDrawer').hidden`, 3000);
    await js(`document.getElementById('tabBrowser').click()`);
    check(await until(`document.getElementById('tabBrowser').getAttribute('aria-selected')==='true'`, 8000), `${tag}: the Browser tab is selected`);
    await key('M', CTRL, { char: 'never' });
    check(await until(`document.getElementById('tabChat').getAttribute('aria-selected')==='true'&&!document.getElementById('notesDrawer').hidden&&document.getElementById('chat').getClientRects().length>0`, 8000), `${tag}: Notes from the Browser tab selects Chat first and opens the drawer over the chat log`);
    await key('Escape');
    await until(`document.getElementById('notesDrawer').hidden`, 3000);
    await js(`document.getElementById('moreBtn').click()`);
    await until(`!!document.getElementById('notesHdrBtn')`, 2000);
    await js(`document.getElementById('notesHdrBtn').click()`);
    await until(`!document.getElementById('notesDrawer').hidden`, 4000);
    /* Esc closes the drawer and returns focus; a second Esc closes the chat */
    await key('Escape');
    check(await until(`document.getElementById('notesDrawer').hidden`, 3000) && (await js(`document.body.classList.contains('panel-open')`)), `${tag}: Esc closes the drawer, the chat stays`);
    check(await until(`document.activeElement&&document.activeElement.id==='moreBtn'`, 2000), `${tag}: focus returns to More (${await active()})`);
    await key('Escape');
    check(await until(`!document.body.classList.contains('panel-open')`, 3000), `${tag}: a second Esc closes the chat`);
    /* Ctrl+K Notes */
    await open('Noor');
    await key('K', ['control'], { char: 'never' });
    check(await until(`!!document.getElementById('palDlg')`, 3000), `${tag}: Ctrl+K opens the palette`);
    await typeChars('notes');
    check(await until(`[...document.querySelectorAll('#palDlg [role="option"]')].some(o=>/^Notes/.test(o.textContent.trim()))`, 3000), `${tag}: Ctrl+K lists Notes`);
    await key('Return');
    check(await until(`!document.getElementById('notesDrawer').hidden`, 4000), `${tag}: Ctrl+K Notes opens the drawer`);
    await key('Escape');

    /* ---- scenario 4 and the row buttons: Insert at the caret, + Note, Edit…, Rename…, Delete… ---- */
    await focusBox('draft');
    await openDrawer();
    await js(`(()=>{const m=document.getElementById('msgInput');m.setSelectionRange(5,5);})()`);
    await js(`document.querySelector('#notesDrawer [data-nt="insert"]').click()`);
    const v4 = await value();
    check(v4.startsWith('draft\n\n') && v4.length > 10, `${tag}: Insert after text adds a blank line (${JSON.stringify(v4.slice(0, 20))})`);
    check((await users()) === u0, `${tag}: Insert sent nothing again`);
    check(await js(`document.activeElement.id==='msgInput'&&document.getElementById('msgInput').selectionStart===document.getElementById('msgInput').value.length`), `${tag}: the caret is after the inserted text`);
    await focusBox('');

    /* + Note by hand: a hostile first line is text, never HTML */
    await openDrawer();
    await js(`document.getElementById('ntAdd').click()`);
    check(await until(`!!document.querySelector('#modeDlg textarea')`, 3000), `${tag}: + Note opens a dialog with a multiline field`);
    const hostile = '<img src=x onerror="window.__pwn=1"> <b>bold</b>';
    await js(`(()=>{const t=document.querySelector('#modeDlg textarea');t.value=${jsLiteral(hostile + '\n\nplan: step one')};t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await js(`document.querySelector('#modeDlg .primary').click()`);
    check(await until(`[...document.querySelectorAll('#notesDrawer .nt-title')].some(t=>t.textContent.includes('onerror'))`, 4000), `${tag}: the new note is listed`);
    check(await js(`document.querySelectorAll('#notesDrawer img,#notesDrawer .nt-title b').length===0&&!window.__pwn`), `${tag}: a hostile title is text, not HTML`);
    check(await js(`[...document.querySelectorAll('#notesDrawer .nt-title')].some(t=>t.textContent.includes('<img'))||[...document.querySelectorAll('#notesDrawer .nt-title')].some(t=>/img src/.test(t.textContent))`), `${tag}: the hostile title shows as words`);
    /* Rename… */
        await js(`__ntd.row("onerror").querySelector('[data-nt="more"]').click()`);
    check(await until(`!!document.querySelector('#modeMenu [data-nmact="rename"]')`, 2000), `${tag}: a row's ⋯ opens the menu`);
    check(await js(`[...document.querySelectorAll('#modeMenu [data-nmact] b')].map(b=>b.textContent).join()==='Rename…,Copy,Delete…'`), `${tag}: the row menu holds Rename…, Copy, Delete…`);
    await js(`document.querySelector('#modeMenu [data-nmact="rename"]').click()`);
    check(await until(`!!document.querySelector('#modeDlg input')`, 3000), `${tag}: Rename… asks for the title`);
    await js(`(()=>{const t=document.querySelector('#modeDlg input');t.value='Renamed idea';t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await js(`document.querySelector('#modeDlg .primary').click()`);
    check(await until(`[...document.querySelectorAll('#notesDrawer .nt-title')].some(t=>t.textContent==='Renamed idea')`, 4000), `${tag}: the title changed`);
    /* Edit… */
    await js(`__ntd.row("Renamed idea").querySelector('[data-nt="edit"]').click()`);
    check(await until(`!!document.querySelector('#modeDlg textarea')&&document.querySelector('#modeDlg textarea').value.includes('plan: step one')`, 3000), `${tag}: Edit… opens the text`);
    await js(`(()=>{const t=document.querySelector('#modeDlg textarea');t.value='edited body line';t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await js(`document.querySelector('#modeDlg .primary').click()`);
    check(await until(`[...document.querySelectorAll('#notesDrawer .nt-row')].some(r=>/edited body line/.test(r.textContent)&&r.querySelector('.nt-title').textContent==='Renamed idea')`, 4000), `${tag}: the text changed and the title stayed`);

    /* roving tabindex and arrows */
    const tabs = await js(`[...document.querySelectorAll('#notesDrawer .nt-row')].map(r=>r.tabIndex).join()`);
    check(/^0(,-1)+$/.test(tabs), `${tag}: roving tabindex ${tabs}`);
    await js(`document.querySelector('#notesDrawer .nt-row').focus()`);
    await key('Down');
    check(await js(`(()=>{const r=[...document.querySelectorAll('#notesDrawer .nt-row')];return document.activeElement===r[1]&&r[1].tabIndex===0&&r[0].tabIndex===-1})()`), `${tag}: ArrowDown moves to the second row`);
    await key('End'); await key('Home');
    check(await js(`document.activeElement===document.querySelector('#notesDrawer .nt-row')`), `${tag}: Home goes to the first row`);

    /* Delete…: Cancel is focused; cancelling keeps the note; deleting focuses the next row, else the previous, else + Note */
    const count0 = (await notes()).length;
    await js(`__ntd.row("Renamed idea").querySelector('[data-nt="more"]').click()`);
    await until(`!!document.querySelector('#modeMenu [data-nmact="delete"]')`, 2000);
    await js(`document.querySelector('#modeMenu [data-nmact="delete"]').click()`);
    check(await until(`!!document.querySelector('#modeDlg')`, 3000), `${tag}: Delete… asks first`);
    check(await js(`document.activeElement&&document.activeElement.dataset.cancel==='1'`), `${tag}: Cancel is focused in the delete dialog`);
    check(/Delete the note "Renamed idea"\? This cannot be undone\./.test(await js(`document.querySelector('#modeDlg').textContent`)), `${tag}: the delete text names the note`);
    await key('Escape');
    check(await until(`!document.querySelector('#modeDlg')`, 2000) && (await notes()).length === count0, `${tag}: Esc keeps the note`);
    const ids = await js(`[...document.querySelectorAll('#notesDrawer .nt-row')].map(r=>r.dataset.id).join()`);
    const delId = await js(`__ntd.row("Renamed idea").dataset.id`);
    const order = ids.split(',');
    const wantNext = order[order.indexOf(delId) + 1] || order[order.indexOf(delId) - 1];
    await js(`__ntd.row("Renamed idea").querySelector('[data-nt="more"]').click()`);
    await until(`!!document.querySelector('#modeMenu [data-nmact="delete"]')`, 2000);
    await js(`document.querySelector('#modeMenu [data-nmact="delete"]').click()`);
    await until(`!!document.querySelector('#modeDlg')`, 3000);
    await js(`[...document.querySelectorAll('#modeDlg .btn')].find(b=>b.textContent==='Delete').click()`);
    check(await until(`!document.querySelector('#modeDlg')&&window.__durbarSimUi.notes.all().length===${jsLiteral(count0 - 1)}`, 4000), `${tag}: the note is deleted`);
    const focusOk = await until(`document.activeElement&&document.activeElement.dataset&&document.activeElement.dataset.id===${jsLiteral(wantNext)}`, 3000);
    const gotFocus = await active();
    check(focusOk, `${tag}: focus goes to the next row, else the previous (got ${gotFocus}, wanted the row ${wantNext})`);
    /* delete the last one: + Note gets the focus */
    while (await js(`document.querySelectorAll('#notesDrawer .nt-row').length`) > 0) {
      await js(`document.querySelector('#notesDrawer .nt-row [data-nt="more"]').click()`);
      await until(`!!document.querySelector('#modeMenu [data-nmact="delete"]')`, 2000);
      await js(`document.querySelector('#modeMenu [data-nmact="delete"]').click()`);
      await until(`!!document.querySelector('#modeDlg')`, 3000);
      await js(`[...document.querySelectorAll('#modeDlg .btn')].find(b=>b.textContent==='Delete').click()`);
      await until(`!document.querySelector('#modeDlg')`, 3000);
      await ctx.sleep(120);
    }
    check(await until(`document.activeElement&&document.activeElement.id==='ntAdd'`, 3000), `${tag}: with no note left, + Note has the focus (${await active()})`);
    check(await js(`/No notes yet\\. Save a message with its ⋯ menu, or add one\\./.test(document.getElementById('notesDrawer').textContent)`), `${tag}: the empty state says what to do`);
    await key('Escape');
    check((await notes()).length === 0, `${tag}: no notes left`);

    /* ---- scenario 5: notes in the "/" list ---- */
    await load(w, h, { simnotes: 'some' });
    await open('Noor');
    await focusBox('');
    await typeChars('/');
    check(await until(`!!document.querySelector('#slashList .sl-note')`, 5000), `${tag}: "/" lists notes`);
    let rows = await js(`JSON.stringify([...document.querySelectorAll('#slashList [role="option"]')].map(o=>({n:o.querySelector('.sl-name').textContent,note:o.classList.contains('sl-note')})))`).then(JSON.parse);
    const firstNote = rows.findIndex((r) => r.note);
    check(firstNote > 0 && rows.slice(0, firstNote).every((r) => !r.note) && rows.slice(firstNote).every((r) => r.note), `${tag}: the notes come after the commands (${rows.map((r) => (r.note ? 'N' : 'c')).join('')})`);
    const noteRows = rows.filter((r) => r.note);
    check(noteRows.length === 3 && noteRows[noteRows.length - 1].n === 'All notes…' && noteRows.length - 1 <= 5, `${tag}: at most 5 notes and All notes… last (${noteRows.map((r) => r.n).join('|')})`);
    check(!noteRows.some((r) => /rename the config keys/i.test(r.n)), `${tag}: a done note is not listed`);
    check(await js(`!!document.querySelector('#slashList .sl-grp')&&/Notes/.test(document.querySelector('#slashList .sl-grp').textContent)`), `${tag}: the Notes group has its heading`);
    check(await until(`/\\d+ commands?, 2 notes/.test(document.getElementById('srAnnounce').textContent)`, 3000), `${tag}: commands and notes are counted apart (${await ann()})`);
    await js(`document.getElementById('slashList').scrollTop=1e6`); /* the picture shows the Notes group at the end of the list */
    await shot(`083-notes-slash-${tag}.png`);
    await focusBox('');
    await typeChars('/pla');
    check(await until(`[...document.querySelectorAll('#slashList .sl-note .sl-name')].some(n=>/Plan for the migration/.test(n.textContent))`, 4000), `${tag}: "/pla" lists the plan note after the matching command`);
    check(await js(`document.querySelector('#slashList [role="option"]').classList.contains('sl-note')===false`), `${tag}: the matching command is first`);
    await js(`(()=>{const m=document.getElementById('msgInput');m.value='/migra';m.setSelectionRange(6,6);m.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    check(await until(`document.querySelectorAll('#slashList [role="option"]').length===1&&document.querySelector('#slashList .sl-note')`, 3000), `${tag}: "/migra" lists only the plan note`);
    const u5 = await users();
    await key('Return');
    const v5 = await value();
    check(/Plan for the migration/.test(v5) && /Back up the tables/.test(v5) && !/^\/pla/.test(v5), `${tag}: Enter replaced /pla with the note's text (${JSON.stringify(v5.slice(0, 40))})`);
    check((await users()) === u5 && !(await js(`!!document.getElementById('slashList')`)), `${tag}: Enter on a note sent nothing and closed the list`);
    check(await js(`document.getElementById('ntNotice').hidden`), `${tag}: a clean note shows no notice`);
    /* a click on a row inserts too; All notes… opens the drawer */
    await focusBox('');
    await typeChars('/');
    await until(`!!document.querySelector('#slashList .sl-note')`, 3000);
    await js(`[...document.querySelectorAll('#slashList .sl-note')].find(o=>/All notes/.test(o.textContent)).click()`);
    check(await until(`!document.getElementById('notesDrawer').hidden`, 4000) && (await value()) === '', `${tag}: All notes… opens the drawer and removes the typed /`);
    await key('Escape');
    /* a chat whose agent app lists no commands (simslash=none: Priya's app): the list opens for notes, and not without notes */
    await load(w, h, { simnotes: 'some', simslash: 'none' });
    await open('Priya');
    check(await js(`window.__durbarSimUi.notes.noCommands()`) === 'Priya', `${tag}: Priya's agent app lists no commands`);
    await focusBox('');
    await typeChars('/');
    check(await until(`!!document.querySelector('#slashList .sl-note')`, 4000), `${tag}: a chat without agent commands lists the notes`);
    check(await js(`!document.querySelector('#slashList .sl-opt:not(.sl-note)')&&document.getElementById('slashList').getAttribute('aria-label')==='Notes'`), `${tag}: ...only notes, and the list is named Notes`);
    check(await until(`/^2 notes\\./.test(document.getElementById('srAnnounce').textContent)`, 3000), `${tag}: ...announced as notes (${await ann()})`);
    await key('Escape');
    await load(w, h, { simnotes: undefined, simslash: 'none' });
    await open('Priya');
    await focusBox('');
    await typeChars('/');
    check(!(await js(`!!document.getElementById('slashList')`)), `${tag}: a chat without commands and without notes opens no list (spec 073 unchanged)`);

    /* ---- scenario 6: a message that held a token (SC-002) ---- */
    await load(w, h, { simnotes: 'secret' });
    await open('Noor');
    await focusBox(`please keep ${TOKEN} out of the notes`);
    await key('Return');
    check(await until(`[...document.querySelectorAll('#chat .msg.user .bubble')].some(b=>b._raw&&b._raw.includes('please keep'))`, 5000), `${tag}: the user message with the token is in the chat`);
    await js(`(()=>{const b=[...document.querySelectorAll('#chat .msg.user .bubble')].find(b=>b._raw&&b._raw.includes('please keep'));b.querySelector(':scope > .nt-btn').click();})()`);
    await until(`!!document.querySelector('#modeMenu [data-nact="save"]')`, 3000);
    await js(`document.querySelector('#modeMenu [data-nact="save"]').click()`);
    check(await until(`/Saved to notes/.test([...document.querySelectorAll('#toasts .toast')].map(t=>t.textContent).join(' '))`, 5000), `${tag}: the user message is saved`);
    const store = JSON.stringify(await notes());
    check(!leak(store) && /\[redacted\]/.test(store), `${tag}: no token in the store, the token is [redacted] (${leak(store)})`);
    await openDrawer();
    const dtexts = await texts('#notesDrawer');
    for (const t of dtexts) check(!leak(t), `${tag}: a token piece shows in the drawer: ${String(t).slice(0, 100)}`);
    check(await js(`/\\[redacted\\]/.test(document.getElementById('notesDrawer').textContent)`), `${tag}: the drawer shows [redacted] where the token was`);
    const rowsSecret = await js(`document.querySelectorAll('#notesDrawer .nt-row').length`);
    check(rowsSecret >= 2, `${tag}: the seeded secret note and the new one are listed (${rowsSecret})`);
    await focusBox('');
    await js(`[...document.querySelectorAll('#notesDrawer .nt-row')].find(r=>/please keep/.test(r.textContent)).querySelector('[data-nt="insert"]').click()`);
    check(await until(`document.getElementById('msgInput').value.length>0`, 3000), `${tag}: the secret note was inserted`);
    const boxV = await value();
    check(!leak(boxV) && /\[redacted\]/.test(boxV), `${tag}: the message box holds [redacted], no token (${boxV.slice(0, 60)})`);
    check(await until(`!document.getElementById('ntNotice').hidden`, 2000) && /Parts of this note were hidden when it was saved/.test(await js(`document.getElementById('ntNotice').textContent`)), `${tag}: the notice above the box says parts were hidden`);
    check(await js(`document.getElementById('ntNotice').getAttribute('role')==='status'`), `${tag}: the notice is a status`);
    check(!leak(await ann()), `${tag}: the announcement has no token piece`);
    await js(`(()=>{const m=document.getElementById('msgInput');m.value='';m.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    check(await until(`document.getElementById('ntNotice').hidden`, 2000), `${tag}: the notice goes when the box is emptied`);
    /* the window masks again for every display: a note that reached it with a raw token (a hand-edited file, an old version) is shown masked */
    await openDrawer();
    await js(`window.__durbarSimUi.notes.plant(${jsLiteral({ id: 'n-' + 'p'.repeat(12), title: 'Raw ' + TOKEN, text: 'body ' + TOKEN + ' and more', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), rev: 1, done: false, from: 'typed', fileEdited: false, hidden: false })})`);
    check(await until(`[...document.querySelectorAll('#notesDrawer .nt-title')].some(t=>t.textContent.startsWith('Raw '))`, 3000), `${tag}: the planted note is listed`);
    for (const t of await texts('#notesDrawer')) check(!leak(t), `${tag}: a raw token in a note shows in the drawer: ${String(t).slice(0, 100)}`);
    await key('Escape');
    await until(`document.getElementById('notesDrawer').hidden`, 3000);
    /* the "/" list, its tooltips and the announcement */
    await typeChars('/');
    await until(`!!document.querySelector('#slashList .sl-note')`, 4000);
    for (const t of await texts('#slashList')) check(!leak(t), `${tag}: a token piece shows in the "/" list: ${String(t).slice(0, 100)}`);
    check(await js(`[...document.querySelectorAll('#slashList .sl-note .sl-name')].some(n=>n.textContent.startsWith('Raw '))`), `${tag}: the planted raw note is in the "/" list, masked`);
    check(!leak(await ann()), `${tag}: the "/" announcement has no token piece`);
    await js(`[...document.querySelectorAll('#slashList .sl-note')].find(o=>/Deploy script token/.test(o.textContent)).click()`);
    check(await until(`document.getElementById('msgInput').value.includes('deploy script')`, 3000), `${tag}: the secret note from the list was inserted`);
    check(!leak(await value()) && !(await js(`document.getElementById('ntNotice').hidden`)), `${tag}: ...masked, with the notice`);
    for (const t of await texts('#toasts')) check(!leak(t), `${tag}: a token piece shows in a toast`);
    await js(`(()=>{const m=document.getElementById('msgInput');m.value='';m.dispatchEvent(new Event('input',{bubbles:true}));})()`);

    /* ---- the office behind still shows 15 desks, the chat closes, the drawer state is not kept ---- */
    await closeDrawer();
    await js(`document.getElementById('backBtn').click()`);
    await until(`!document.body.classList.contains('panel-open')`, 4000);
    check((await js(`document.querySelectorAll('#stage .desk[data-id]').length`)) === 15, `${tag}: 15 desks on the floor after closing the chat`);
  }
  console.log('[notes] screenshots in ' + OUT);
  assert.deepStrictEqual(fails, [], fails.join('\n'));
  console.log('[notes] all checks passed');
};
