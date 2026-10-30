/*
 * Check for spec 083 (folder notes, issue 699), the MVP: save a message, the Notes drawer, Insert, and notes in the "/" list.
 * Simulator only (no AI credits, nothing written to disk: the simulator keeps notes in memory).
 *
 *   npm run check:ui -- --only check-notes
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
/* the page's mod key: Meta (⌘) on a Mac, Control elsewhere (the pattern of check-sched-top.js); the texts the app shows follow it */
const MAC = process.platform === 'darwin';
const MOD = MAC ? 'meta' : 'control';
const CTRL = [MOD, 'shift'];
const KEYTXT = MAC ? '⇧⌘M' : 'Ctrl+Shift+M';
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
  const open = async (name, o = {}) => {
    const id = await H.idOf(name);
    assert.ok(id, `${name} is on the floor`);
    if (await js(`document.body.classList.contains('panel-open')`)) { await js(`document.getElementById('backBtn').click()`); await until(`!document.body.classList.contains('panel-open')`, 4000); }
    await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"]`)}).click()`);
    await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('msgInput')&&window.__durbarSimUi.notes.all().length>=0`, 15000);
    await settle();
    if (!o.busy) await until(`(()=>{const v=e=>!!e&&e.getClientRects().length>0;return v(document.getElementById('sendBtn'))})()`, 15000); /* a working agent shows Stop, not Send */
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
  const inject = () => js(`window.__ntd={textNode:(b,min)=>{const w=document.createTreeWalker(b,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.parentElement.closest('.cp-btn,.nt-btn,.nt-mark')?NodeFilter.FILTER_REJECT:(n.textContent.trim().length>=min?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_SKIP)});return w.nextNode();},pick:(b,from,to)=>{const t=__ntd.textNode(b,to+1);const r=document.createRange();r.setStart(t,from);r.setEnd(t,to);const s=getSelection();s.removeAllRanges();s.addRange(r);return s.toString();},across:(b1,b2)=>{const t1=__ntd.textNode(b1,3),t2=__ntd.textNode(b2,3);const r=document.createRange();r.setStart(t1,0);r.setEnd(t2,3);const s=getSelection();s.removeAllRanges();s.addRange(r);return s.toString();},dots:()=>{const b=[...document.querySelectorAll('#chat .msg.agent .bubble')].find(x=>x.querySelector(':scope > .nt-btn'));return b?b.querySelector(':scope > .nt-btn'):null},row:t=>[...document.querySelectorAll('#notesDrawer .nt-row')].find(r=>r.querySelector('.nt-title').textContent.includes(t))};true`);
  const pressDots = async () => { check(await until('!!__ntd.dots()', 8000), 'a finished reply has a ⋯'); await js('__ntd.dots().click()'); return until(`!!document.querySelector('#modeMenu [data-nact]')`, 3000); };
  /* every text node, title and aria-* value in some root, for the secret checks */
  const texts = (sel) => js(`(()=>{const out=[];for(const r of document.querySelectorAll(${jsLiteral(sel)})){out.push(r.textContent);for(const e of [r,...r.querySelectorAll('*')])for(const a of e.attributes)if(a.name==='title'||a.name==='aria-label'||a.name==='aria-description')out.push(a.name+'='+a.value);}return out;})()`);

  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    await load(w, h, { simnotes: undefined });
    check((await js(`document.querySelectorAll('#stage .desk[data-id]').length`)) === 15, `${tag}: 15 desks on the floor`);
    /* ---- where the ⋯ is NOT (FR-010, FR-027): thinking blocks, tool chips, a streaming reply, the VS Code view, a demo chat ---- */
    await open('Ada', { busy: true });
    const ada = await js(`JSON.stringify({think:document.querySelectorAll('#chat .think').length,chips:document.querySelectorAll('#chat .chip').length,streaming:document.querySelectorAll('#chat .bubble.caret').length,bad:document.querySelectorAll('#chat .think .nt-btn,#chat .think-body .nt-btn,#chat .chip .nt-btn,#chat .note .nt-btn,#chat .caret .nt-btn,#chat .bubble.caret > .nt-btn').length,own:document.querySelectorAll('#chat .msg.user .nt-btn').length})`).then(JSON.parse);
    check(ada.think >= 1 && ada.chips >= 1 && ada.streaming >= 1, `${tag}: Ada's chat has thinking blocks, tool chips and a streaming reply, so the next check means something (${JSON.stringify(ada)})`);
    check(ada.bad === 0 && ada.own >= 1, `${tag}: no ⋯ on a thinking block, a tool chip, a request card or a streaming reply; one on the user's message (${JSON.stringify(ada)})`);
    /* the ⋯ is as visible as Copy: the same computed opacity (Copy is readable at rest, spec 052) */
    const ops = await js(`JSON.stringify({nt:getComputedStyle(document.querySelector('#chat .nt-btn')).opacity,cp:[...document.querySelectorAll('#chat .cp-msg')].map(b=>getComputedStyle(b).opacity)})`).then(JSON.parse);
    check(ops.cp.length === 0 || ops.cp.every((o) => o === ops.nt), `${tag}: the ⋯ has Copy's opacity (${JSON.stringify(ops)})`);
    /* a streaming reply (unfinished) cannot be saved from yet: a selection inside it shows no button */
    const strSel = await js(`(()=>{const b=document.querySelector('#chat .bubble.caret');if(!b)return '';const t=__ntd.textNode(b,5);if(!t)return '';const r=document.createRange();r.setStart(t,0);r.setEnd(t,5);const s=getSelection();s.removeAllRanges();s.addRange(r);return s.toString()})()`);
    check(strSel.length > 0 && !(await js(`window.__durbarSimUi.notes.selNow()`)), `${tag}: a selection in a streaming reply shows no button (selected "${strSel}")`);
    await js(`getSelection().removeAllRanges();true`);
    /* the read-only VS Code chat view has no ⋯ (it would open nothing) */
    if (!(await js(`!!document.querySelector('#prev [data-pv="view"]')`))) { await js(`document.getElementById('prevBtn').click()`); }
    check(await until(`!!document.querySelector('#prev [data-pv="view"]')`, 6000), `${tag}: a VS Code chat can be viewed`);
    await js(`document.querySelector('#prev [data-pv="view"]').click()`);
    check(await until(`!!document.querySelector('#chat .vsview .vsbody')&&document.querySelectorAll('#chat .vsview .bubble').length>0`, 8000), `${tag}: the VS Code view shows its messages`);
    check(await js(`document.querySelectorAll('#chat .nt-btn').length===0`), `${tag}: no ⋯ in the read-only VS Code view`);
    const vsSel = await js(`(()=>{const b=document.querySelector('#chat .vsview .bubble');const t=__ntd.textNode(b,5);const r=document.createRange();r.setStart(t,0);r.setEnd(t,5);const s=getSelection();s.removeAllRanges();s.addRange(r);return s.toString()})()`);
    check(vsSel.length > 0 && !(await js(`window.__durbarSimUi.notes.selNow()`)), `${tag}: a selection in the read-only VS Code view shows no button (selected "${vsSel}")`);
    await js(`getSelection().removeAllRanges();true`);
    await js(`document.getElementById('vsBack').click()`);
    await until(`!document.querySelector('#chat .vsview')`, 4000);
    if (await js(`document.getElementById('prevBtn')&&document.getElementById('prevBtn').getAttribute('aria-expanded')==='true'`)) await js(`document.getElementById('prevBtn').click()`); /* Previous sessions stays closed: its state is remembered and would show in the pictures */
    await until(`document.getElementById('prevBtn').getAttribute('aria-expanded')!=='true'`, 3000);
    /* a canned demo chat (not live) has none either, and no Notes… item */
    await js(`document.getElementById('backBtn').click()`);
    await until(`!document.body.classList.contains('panel-open')`, 4000);
    /* a HELPER's chat (it has a parent) has no notes (FR-042): the same message markup and a selection give no button */
    {
      const hp = await js(`(()=>{const h=window.__durbarSimUi.agents().find(a=>a.parent&&document.querySelector('#stage .helper[data-id="'+CSS.escape(a.id)+'"]'));return h?{id:h.id,parent:h.parent}:null})()`);
      check(!!hp, `${tag}: a helper is on the office floor`);
      if (hp) {
        await js(`document.querySelector('#stage .helper[data-id="'+CSS.escape(${jsLiteral(hp.id)})+'"]').click()`);
        check(await until(`document.body.classList.contains('panel-open')&&!!document.querySelector('#panel .panel-in.ro')`, 10000), `${tag}: the helper's chat is open`);
        await settle();
        /* the helper is made live in the page only, and a notes-enabled message is planted in its log, so only the parent test can hide the button */
        const hs = await js(`(()=>{const U=window.__durbarSimUi,h=U.agents().find(a=>a.id===${jsLiteral(hp.id)}),was=h.live;h.live=true;const root=document.createElement('div');root.className='chat-inner';root.setAttribute('data-notes','1');root.innerHTML='<div class="msg agent"><div class="bubble"><button type="button" class="nt-btn" aria-label="Message actions">x</button>A planted helper reply with enough words to select.</div></div>';document.getElementById('chat').appendChild(root);const b=root.querySelector('.bubble');const t=[...b.childNodes].find(n=>n.nodeType===3);const r=document.createRange();r.setStart(t,2);r.setEnd(t,20);const s=getSelection();s.removeAllRanges();s.addRange(r);const sel=s.toString().length;const par=h.parent;h.parent='';const without=U.notes.selNow();h.parent=par;const withP=U.notes.selNow();h.live=was;root.remove();getSelection().removeAllRanges();return JSON.stringify({sel,without,withP,par:!!par})})()`).then(JSON.parse);
        check(hs.sel > 0 && hs.par && hs.without === true, `${tag}: the planted message would show the button without the parent (the precondition: ${JSON.stringify(hs)})`);
        check(hs.withP === false, `${tag}: a selection inside a message of a helper chat shows NO Save to notes button`);
      }
      await js(`document.getElementById('backBtn').click()`);
      await until(`!document.body.classList.contains('panel-open')`, 4000);
    }
    await js(`(()=>{const t=document.getElementById('demoToggle');t.checked=true;t.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    check(await until(`document.querySelectorAll('#stage .desk[data-id]').length>0&&!!document.getElementById('demoToggle').checked`, 6000), `${tag}: the demo is on`);
    await js(`document.querySelector('#stage .desk[data-id]').click()`);
    check(await until(`document.body.classList.contains('panel-open')&&document.querySelectorAll('#chat .msg .bubble').length>0`, 10000), `${tag}: a demo chat is open`);
    await settle();
    check(await js(`document.querySelectorAll('#chat .nt-btn').length===0&&!document.getElementById('notesHdrBtn')&&!document.getElementById('notesDrawer')`), `${tag}: no ⋯, no Notes… and no drawer in a demo chat`);
    await js(`document.getElementById('backBtn').click()`);
    await until(`!document.body.classList.contains('panel-open')`, 4000);
    await js(`(()=>{const t=document.getElementById('demoToggle');t.checked=false;t.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await load(w, h, { simnotes: undefined });
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

    /* ---- T033: saving a selection (FR-042) ---- */
    const replyB = `__ntd.dots().parentElement`;
    const userB = `document.querySelector('#chat .msg.user .bubble')`;
    const countSel = () => js(`window.__durbarSimUi.notes.all().filter(n=>n.from==='selection').length`);
    await js(`window.getSelection().removeAllRanges();true`);
    const picked = await js(`__ntd.pick(${replyB},2,16)`);
    check(picked.trim().length >= 10, `${tag}: a selection of ${picked.length} characters is made inside one reply (the precondition)`);
    check(await until(`(()=>{const b=document.getElementById('ntSelBtn');return !!b&&!b.hidden&&b.getClientRects().length>0})()`, 3000), `${tag}: a selection inside one message shows the button`);
    const sb = await js(`(()=>{const b=document.getElementById('ntSelBtn'),R=b.getBoundingClientRect(),c=document.querySelector('#panel .composer').getBoundingClientRect(),sel=getSelection().getRangeAt(0).getBoundingClientRect();return JSON.stringify({t:b.textContent,l:b.getAttribute('aria-label'),r:R.right,btm:R.bottom,top:R.top,left:R.left,cTop:c.top,w:innerWidth,h:innerHeight,selBottom:sel.bottom,selTop:sel.top,fs:parseFloat(getComputedStyle(b).fontSize),hgt:R.height})})()`).then(JSON.parse);
    check(sb.t === 'Save to notes' && /selected text/.test(sb.l) && sb.fs >= 10.5 && sb.hgt >= 24, `${tag}: the button is named and readable (${JSON.stringify(sb)})`);
    check(sb.left >= 0 && sb.r <= sb.w && sb.top >= 0 && sb.btm <= sb.h, `${tag}: the button is inside the window`);
    check(sb.btm <= sb.cTop + 0.5, `${tag}: the button is not over the composer (${sb.btm} vs ${sb.cTop})`);
    check(sb.top >= sb.selTop - 40 && sb.top <= sb.selBottom + 40, `${tag}: the button is next to the selection (${sb.top} vs ${sb.selTop}..${sb.selBottom})`);
    await shot(`083-notes-selection-${tag}.png`);
    const s0 = await countSel();
    await js(`document.getElementById('ntSelBtn').click()`);
    check(await until(`/Saved to notes/.test([...document.querySelectorAll('#toasts .toast')].map(t=>t.textContent).join(' '))`, 5000), `${tag}: the button saves (${await toastText()})`);
    check(await until(`window.__durbarSimUi.notes.all().filter(n=>n.from==='selection').length===${jsLiteral(s0 + 1)}`, 5000), `${tag}: one note with from selection is stored`);
    const sn = await js(`JSON.stringify(window.__durbarSimUi.notes.all().filter(n=>n.from==='selection').pop())`).then(JSON.parse);
    check(sn.text.replace(/\s+/g, ' ') === picked.trim().replace(/\s+/g, ' ') && sn.source && sn.source.role === 'agent' && /^sim-\d+$/.test(sn.source.session), `${tag}: only the selected text is saved, with the message's source (${JSON.stringify(sn).slice(0, 160)})`);
    check(await until(`getSelection().isCollapsed&&document.getElementById('ntSelBtn').hidden`, 3000), `${tag}: the selection and the button are gone after the save`);
    /* a selection across two messages, or outside the log: no button */
    const across = await js(`__ntd.across(${userB},${replyB})`);
    check(across.length > 3 && !(await js(`window.__durbarSimUi.notes.selNow()`)), `${tag}: a selection across two messages shows no button (selected ${across.length} characters)`);
    const outside = await js(`(()=>{const t=document.getElementById('panelTitle');const r=document.createRange();r.selectNodeContents(t);const s=getSelection();s.removeAllRanges();s.addRange(r);return s.toString()})()`);
    check(outside.length > 0 && !(await js(`window.__durbarSimUi.notes.selNow()`)), `${tag}: a selection outside the chat log shows no button (selected "${outside.slice(0, 20)}")`);
    await js(`getSelection().removeAllRanges();true`);
    check(!(await js(`window.__durbarSimUi.notes.selNow()`)), `${tag}: no selection, no button`);
    /* the keyboard path: the message's ⋯ has the item while a selection lies inside it, and not without one */
    await js(`window.getSelection().removeAllRanges();true`);
    await js(`__ntd.dots().click()`);
    check(await until(`!!document.querySelector('#modeMenu [data-nact]')`, 3000), `${tag}: ⋯ opens the menu (no selection)`);
    check(await js(`!document.querySelector('#modeMenu [data-nact="savesel"]')`), `${tag}: no selection: no Save selection item`);
    await key('Escape');
    await until(`!document.getElementById('modeMenu')`, 2000);
    const picked2 = await js(`__ntd.pick(${replyB},20,34)`);
    check(picked2.trim().length >= 10, `${tag}: a second selection is made (the precondition)`);
    /* FR-042: the selection lies in reply A; the menu of ANOTHER message (the user's) does not offer the item */
    check(await js(`(()=>{const u=document.querySelector('#chat .msg.user .bubble'),r=__ntd.dots().parentElement;return !!u&&u!==r&&!!u.querySelector(':scope > .nt-btn')&&!getSelection().isCollapsed&&r.contains(getSelection().anchorNode)})()`), `${tag}: the selection is in the reply and the user's message has its own ⋯ (the precondition)`);
    await js(`document.querySelector('#chat .msg.user .bubble > .nt-btn').click()`);
    check(await until(`!!document.querySelector('#modeMenu [data-nact="save"]')`, 3000), `${tag}: another message's ⋯ opens its menu`);
    check(await js(`!document.querySelector('#modeMenu [data-nact="savesel"]')`), `${tag}: a selection in one message adds no Save selection item to another message's menu`);
    await key('Escape');
    await until(`!document.getElementById('modeMenu')`, 2000);
    await js(`__ntd.pick(${replyB},20,34)`);
    await js(`__ntd.dots().click()`);
    check(await until(`!!document.querySelector('#modeMenu [data-nact="savesel"]')`, 3000), `${tag}: with a selection inside the message, ⋯ offers Save selection to notes`);
    check(await js(`[...document.querySelectorAll('#modeMenu [data-nact] b')].map(b=>b.textContent).join()==='Save to notes,Save selection to notes,Copy'||[...document.querySelectorAll('#modeMenu [data-nact] b')].map(b=>b.textContent).join()==='Show in notes,Save selection to notes,Copy'`), `${tag}: the menu order is Save, Save selection, Copy`);
    await key('Down');
    check(await js(`document.activeElement.getAttribute('data-nact')==='savesel'`), `${tag}: the arrow keys reach the item`);
    const s1 = await countSel();
    await key('Return');
    check(await until(`window.__durbarSimUi.notes.all().filter(n=>n.from==='selection').length===${jsLiteral(s1 + 1)}`, 5000), `${tag}: Enter on the item saves the selection`);
    const sn2 = await js(`JSON.stringify(window.__durbarSimUi.notes.all().filter(n=>n.from==='selection').pop())`).then(JSON.parse);
    check(sn2.text.replace(/\s+/g, ' ') === picked2.trim().replace(/\s+/g, ' '), `${tag}: ...with only the selected text (${sn2.text.slice(0, 40)})`);
    await js(`window.getSelection().removeAllRanges();true`);
    await until(`!document.querySelector('#modeMenu')`, 2000);
    /* ---- T033 review round: real mouse input, a selection scrolled out of the log, the drawer, a too-long selection ---- */
    const btnVisible = `(()=>{const b=document.getElementById('ntSelBtn');return !!b&&!b.hidden&&b.getClientRects().length>0})()`;
    const centerOf = (expr) => js(`(()=>{const e=${expr};if(!e)return null;const r=e.getBoundingClientRect();return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)})})()`).then((t) => (t ? JSON.parse(t) : null));
    const mouseClick = async (pt) => { wc().sendInputEvent({ type: 'mouseMove', x: pt.x, y: pt.y }); await ctx.sleep(80); wc().sendInputEvent({ type: 'mouseDown', x: pt.x, y: pt.y, button: 'left', clickCount: 1 }); wc().sendInputEvent({ type: 'mouseUp', x: pt.x, y: pt.y, button: 'left', clickCount: 1 }); };
    /* real input: pressing the floating button keeps the selection (its mousedown is not a focus move), so the click saves it */
    const pr = await js(`__ntd.pick(${replyB},3,17)`);
    check(pr.trim().length >= 10 && await until(btnVisible, 3000), `${tag}: (real input) a selection is made and the button shows (the precondition)`);
    const bp = await centerOf(`document.getElementById('ntSelBtn')`);
    const r0 = await countSel();
    await js(`window.__ev=[];for(const t of ['mousedown','mouseup','click'])document.addEventListener(t,e=>window.__ev.push(t+':'+(e.target.id||e.target.className||e.target.tagName)+':'+e.defaultPrevented+':'+getSelection().isCollapsed),true);true`);
    await mouseClick(bp);
    check(await until(`window.__durbarSimUi.notes.all().filter(n=>n.from==='selection').length===${jsLiteral(r0 + 1)}`, 5000), `${tag}: a real mouse press on the floating button saves the selection (the selection survived the press) ${await js(`JSON.stringify(window.__ev)+getSelection().isCollapsed`)} at ${JSON.stringify(bp)}`);
    /* real input: a left-click on the message's ⋯ while a selection exists keeps it, so the menu offers Save selection */
    await until(`getSelection().isCollapsed`, 3000);
    const pr2 = await js(`__ntd.pick(${replyB},20,34)`);
    check(pr2.trim().length >= 10, `${tag}: (real input) a selection is made before the ⋯ is clicked (the precondition)`);
    await mouseClick(await centerOf(`__ntd.dots()`));
    check(await until(`!!document.querySelector('#modeMenu [data-nact="savesel"]')`, 3000), `${tag}: a real left-click on ⋯ keeps the selection, so the menu offers Save selection to notes`);
    await key('Escape');
    await until(`!document.getElementById('modeMenu')`, 2000);
    /* a selection scrolled out of the log (both ways) shows no button, and it never lands on the composer or the header */
    for (const dir of ['above', 'below']) {
      await js(`window.getSelection().removeAllRanges();true`);
      const ps = await js(`__ntd.pick(${replyB},2,16)`);
      check(ps.trim().length >= 10 && await until(btnVisible, 3000), `${tag}: (${dir}) a selection is made and the button shows (the precondition)`);
      const away = await js(`(()=>{const lg=document.getElementById('chat'),inner=lg.querySelector('.chat-inner'),sp=document.createElement('div');sp.id='ntSpacer';sp.style.cssText='height:4000px;flex:none';
        const bub=__ntd.dots().parentElement;
        if(${jsLiteral(dir)}==='above'){inner.appendChild(sp);lg.scrollTop=lg.scrollHeight;}else{inner.insertBefore(sp,inner.firstChild);lg.scrollTop=lg.scrollTop===0?1:0;}
        const c=lg.getBoundingClientRect(),b=bub.getBoundingClientRect();return JSON.stringify({c:[c.top,c.bottom],b:[b.top,b.bottom],st:lg.scrollTop,sh:lg.scrollHeight,ch:lg.clientHeight})})()`).then(JSON.parse);
      check(dir === 'above' ? away.b[1] < away.c[0] : away.b[0] > away.c[1], `${tag}: (${dir}) the log really scrolled: the message is out of the log (${JSON.stringify(away)})`);
      check(!(await js(`getSelection().isCollapsed`)), `${tag}: (${dir}) the selection is still there`);
      check(await until(`(()=>{const b=document.getElementById('ntSelBtn');return !b||b.hidden})()`, 3000), `${tag}: (${dir}) a selection scrolled out of the log shows no button`);
      check(!(await js(`window.__durbarSimUi.notes.selNow()`)), `${tag}: (${dir}) nor does a re-check`);
      await js(`(()=>{const sp=document.getElementById('ntSpacer');if(sp)sp.remove();getSelection().removeAllRanges();__ntd.dots().parentElement.scrollIntoView({block:'center'});return true})()`);
    }
    /* the Notes drawer: opening it hides the button although the selection survives; a new selection after closing shows it again */
    await js(`window.getSelection().removeAllRanges();true`);
    const pd = await js(`__ntd.pick(${replyB},2,16)`);
    check(pd.trim().length >= 10 && await until(btnVisible, 3000), `${tag}: (drawer) a selection is made and the button shows (the precondition)`);
    check(await openDrawer(), `${tag}: (drawer) the drawer opens`);
    check(!(await js(`getSelection().isCollapsed`)), `${tag}: (drawer) the selection survived the drawer opening (the precondition)`);
    check(await until(`(()=>{const b=document.getElementById('ntSelBtn');return !b||b.hidden})()`, 3000), `${tag}: (drawer) the button is gone while the drawer is open`);
    check(!(await js(`window.__durbarSimUi.notes.selNow()`)), `${tag}: (drawer) and a re-check does not bring it back`);
    await closeDrawer();
    await js(`window.getSelection().removeAllRanges();true`);
    const pd2 = await js(`__ntd.pick(${replyB},2,16)`);
    check(pd2.trim().length >= 10 && await until(btnVisible, 3000), `${tag}: (drawer) after closing it, a new selection shows the button again`);
    await js(`window.getSelection().removeAllRanges();true`);
    /* a selection over 64K characters has its own words and stores nothing (the text is planted in the reply and put back) */
    const big = await js(`(()=>{const b=__ntd.dots().parentElement,t=__ntd.textNode(b,5);window.__ntOrig=t.data;t.data='word '.repeat(14000);const r=document.createRange();r.setStart(t,0);r.setEnd(t,t.data.length);const s=getSelection();s.removeAllRanges();s.addRange(r);b.scrollIntoView({block:'end'});return s.toString().length})()`);
    check(big > 65536 && await until(btnVisible, 3000), `${tag}: (too long) a selection of ${big} characters shows the button (the precondition)`);
    const l0 = await countSel();
    await js(`document.getElementById('ntSelBtn').click()`);
    check(await until(`/That selection is too long to save\./.test([...document.querySelectorAll('#toasts .toast')].map(t=>t.textContent).join(' '))`, 4000), `${tag}: (too long) its own toast, not the message wording (${await toastText()})`);
    check((await countSel()) === l0, `${tag}: (too long) nothing was stored`);
    await js(`(()=>{const t=__ntd.textNode(__ntd.dots().parentElement,5);if(window.__ntOrig!=null)t.data=window.__ntOrig;getSelection().removeAllRanges();return true})()`);
    /* the notes of this block are removed again, so the scenarios below see what they saw before */
    await js(`(async()=>{const U=window.__durbarSimUi,b=U.bridge(),ag=U.agents().find(x=>x.name==='Noor');for(const n of U.notes.all().filter(x=>x.from==='selection'))await b.notesDelete(ag.id,n.id,n.rev);return true})()`);
    check(await until(`window.__durbarSimUi.notes.all().filter(n=>n.from==='selection').length===0&&window.__durbarSimUi.notes.all().length===1`, 5000), `${tag}: the selection notes are removed (one note left)`);
    await js(`document.getElementById('msgInput').focus()`);

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
    check((await js(`document.getElementById('notesHdrBtn').textContent`)).includes(KEYTXT), `${tag}: the More item names the shortcut ${KEYTXT}`);
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
    await key('K', [MOD], { char: 'never' });
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

    /* a stale rev (FR-008): the note is changed elsewhere; the window shows the saved version (masked) and both buttons work */
    const staleRun = async (button, want) => {
      const cur = JSON.parse(await js(`JSON.stringify(window.__durbarSimUi.notes.all().find(n=>n.title==='Renamed idea'||n.title.startsWith('Saved elsewhere')||n.title==='Mine'))`));
      const elsewhere = 'Saved elsewhere ' + TOKEN;
      await js(`(async()=>{const b=window.__durbarSimUi.bridge(),a=window.__durbarSimUi.agents().find(x=>x.name==='Noor');await b.notesUpdate(a.id,${jsLiteral(cur.id)},${jsLiteral(cur.rev)},{title:${jsLiteral(elsewhere)}});return true})()`);
      await js(`window.__stale=window.__durbarSimUi.notes.change(${jsLiteral(cur)},{title:'Mine'});true`);
      check(await until(`!!document.querySelector('#modeDlg')&&/This note changed/.test(document.querySelector('#modeDlg').textContent)`, 4000), `${tag}: a stale change asks (${button})`);
      const dlg = await js(`document.querySelector('#modeDlg')?document.querySelector('#modeDlg').textContent:''`);
      check(/Saved version: Saved elsewhere/.test(dlg) && !leak(dlg), `${tag}: the dialog shows the saved version, masked (${dlg.slice(0, 120)})`);
      await js(`[...document.querySelectorAll('#modeDlg .btn')].find(b=>b.textContent===${jsLiteral(button)}).click()`);
      check(await until(`!document.querySelector('#modeDlg')`, 3000), `${tag}: ${button} closes the dialog`);
      check(await until(`window.__durbarSimUi.notes.all().some(n=>n.title===${jsLiteral(want)}||(${jsLiteral(want)}==='saved'&&n.title.startsWith('Saved elsewhere')))`, 4000), `${tag}: ${button} leaves the right title (${want})`);
      const t = JSON.parse(await js(`JSON.stringify(window.__durbarSimUi.notes.all().map(n=>n.title))`));
      check(!t.some((x) => leak(x)), `${tag}: no token in a title after a stale change`);
    };
    await staleRun('Use the saved one', 'saved');
    check(!(await js(`window.__durbarSimUi.notes.all().some(n=>n.title==='Mine')`)), `${tag}: Use the saved one did not apply my change`);
    await staleRun('Keep mine', 'Mine');
    await js(`(async()=>{const n=window.__durbarSimUi.notes.all().find(x=>x.title==='Mine');const b=window.__durbarSimUi.bridge(),a=window.__durbarSimUi.agents().find(x=>x.name==='Noor');await b.notesUpdate(a.id,n.id,n.rev,{title:'Renamed idea'});return true})()`);
    check(await until(`!!__ntd.row("Renamed idea")`, 4000), `${tag}: the note is back to its title for the next steps`);

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
    /* deleting a MIDDLE row: focus goes to the next row (not the previous) */
    await js(`(async()=>{const b=window.__durbarSimUi.bridge(),id=window.__durbarSimUi.agents().find(x=>x.name==='Noor').id;await b.notesAdd(id,{text:'Middle A\\n\\nbody'});await b.notesAdd(id,{text:'Middle B\\n\\nbody'});return true})()`);
    check(await until(`!!__ntd.row("Middle A")&&!!__ntd.row("Middle B")`, 5000), `${tag}: two more notes are listed`);
    const ids = await js(`[...document.querySelectorAll('#notesDrawer .nt-row')].map(r=>r.dataset.id).join()`);
    const delId = await js(`__ntd.row("Middle A").dataset.id`);
    const order = ids.split(',');
    check(order.indexOf(delId) > 0 && order.indexOf(delId) < order.length - 1, `${tag}: the row to delete is in the middle (${order.indexOf(delId)} of ${order.length})`);
    const wantNext = order[order.indexOf(delId) + 1];
    const count1 = (await notes()).length;
    await js(`__ntd.row("Middle A").querySelector('[data-nt="more"]').click()`);
    await until(`!!document.querySelector('#modeMenu [data-nmact="delete"]')`, 2000);
    await js(`document.querySelector('#modeMenu [data-nmact="delete"]').click()`);
    await until(`!!document.querySelector('#modeDlg')`, 3000);
    await js(`[...document.querySelectorAll('#modeDlg .btn')].find(b=>b.textContent==='Delete').click()`);
    check(await until(`!document.querySelector('#modeDlg')&&window.__durbarSimUi.notes.all().length===${jsLiteral(count1 - 1)}`, 4000), `${tag}: the note is deleted`);
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
    await until(`document.getElementById('msgInput').value.includes('Back up the tables')`, 4000); /* the pick lands after the key's own handler */
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
    /* a selection that holds the token is saved through the same masking: nothing raw is stored */
    const tokSel = await js(`(()=>{const b=[...document.querySelectorAll('#chat .msg.user .bubble')].find(x=>x._raw&&x._raw.includes('please keep'));const t=__ntd.textNode(b,20);const i=t.textContent.indexOf('ghp_');const r=document.createRange();r.setStart(t,i-5);r.setEnd(t,i+${jsLiteral(TOKEN.length)}+4);const s=getSelection();s.removeAllRanges();s.addRange(r);return s.toString()})()`);
    check(tokSel.includes(TOKEN), `${tag}: the selection holds the token (the precondition: ${tokSel.length} characters)`);
    check(await until(`(()=>{const b=document.getElementById('ntSelBtn');return !!b&&!b.hidden})()`, 3000), `${tag}: the button shows for a selection in the user's message`);
    const sel6 = await js(`window.__durbarSimUi.notes.all().filter(n=>n.from==='selection').length`);
    await js(`document.getElementById('ntSelBtn').click()`);
    check(await until(`window.__durbarSimUi.notes.all().filter(n=>n.from==='selection').length===${jsLiteral(sel6 + 1)}`, 5000), `${tag}: the selection with the token is saved`);
    const tsn = await js(`JSON.stringify(window.__durbarSimUi.notes.all().filter(n=>n.from==='selection').pop())`);
    check(!leak(tsn) && /\[redacted\]/.test(tsn) && JSON.parse(tsn).source.role === 'user', `${tag}: ...masked, from the user's message (${tsn.slice(0, 140)})`);
    /* the toast's Rename… (entry point 1): the field holds the stored, masked title */
    await js(`[...document.querySelectorAll('#toasts .toast .toast-act')].find(b=>b.textContent==='Rename…').click()`);
    check(await until(`!!document.querySelector('#modeDlg input')`, 3000), `${tag}: the toast's Rename… opens the title field`);
    const tf = await js(`document.querySelector('#modeDlg input').value`);
    check(tf.length > 0 && !leak(tf), `${tag}: the toast's Rename… field has no token (${tf})`);
    await key('Escape');
    await until(`!document.querySelector('#modeDlg')`, 2000);
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
    const plantRaw = () => js(`window.__durbarSimUi.notes.plant(${jsLiteral({ id: 'n-' + 'p'.repeat(12), title: 'Raw ' + TOKEN, text: 'body ' + TOKEN + ' and more', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), rev: 1, done: false, from: 'typed', fileEdited: false, hidden: false })})`);
    await plantRaw();
    check(await until(`[...document.querySelectorAll('#notesDrawer .nt-title')].some(t=>t.textContent.startsWith('Raw '))`, 3000), `${tag}: the planted note is listed`);
    for (const t of await texts('#notesDrawer')) check(!leak(t), `${tag}: a raw token in a note shows in the drawer: ${String(t).slice(0, 100)}`);
    /* every way a planted raw-token note leaves the drawer is masked: Insert (box and announcement), Edit… (the field), Copy (the clipboard) */
    await js(`document.getElementById('msgInput').value='';`);
    await js(`__ntd.row("Raw ").querySelector('[data-nt="insert"]').click()`);
    check(await until(`document.getElementById('msgInput').value.includes('body')`, 3000), `${tag}: the planted note was inserted from the drawer`);
    check(!leak(await value()) && /\[redacted\]/.test(await value()), `${tag}: Insert masks the text again (${(await value()).slice(0, 50)})`);
    check(await until(`/Inserted the note/.test(document.getElementById('srAnnounce').textContent)`, 3000), `${tag}: the insert is announced`);
    check(!leak(await ann()) && /\[redacted\]/.test(await ann()), `${tag}: the Insert announcement is masked (${await ann()})`);
    await js(`(()=>{const m=document.getElementById('msgInput');m.value='';m.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await openDrawer();
    await plantRaw(); /* opening the drawer fetched the store again: the planted note is put back */
    await js(`__ntd.row("Raw ").querySelector('[data-nt="edit"]').click()`);
    check(await until(`!!document.querySelector('#modeDlg textarea')`, 3000), `${tag}: Edit… opens on the planted note`);
    check(!leak(await js(`document.querySelector('#modeDlg textarea').value`)) && /\[redacted\]/.test(await js(`document.querySelector('#modeDlg textarea').value`)), `${tag}: Edit… shows the text masked again`);
    await key('Escape');
    await until(`!document.querySelector('#modeDlg')`, 2000);
    await js(`window.__clip=[];navigator.clipboard.writeText=t=>{window.__clip.push(String(t));return Promise.resolve();};true`);
    await js(`__ntd.row("Raw ").querySelector('[data-nt="more"]').click()`);
    await until(`!!document.querySelector('#modeMenu [data-nmact="copy"]')`, 2000);
    await js(`document.querySelector('#modeMenu [data-nmact="copy"]').click()`);
    const copied = await until(`window.__clip.length===1`, 2000);
    const clip0 = copied ? String(await js(`window.__clip[0]`)) : '';
    check(copied && !leak(clip0) && /\[redacted\]/.test(clip0), `${tag}: Copy writes the masked text (${clip0})`);
    /* Rename… (the row menu, and the same function the toast calls) and the Delete dialog show a planted raw-token title masked */
    await js(`__ntd.row("Raw ").querySelector('[data-nt="more"]').click()`);
    await until(`!!document.querySelector('#modeMenu [data-nmact="rename"]')`, 2000);
    await js(`document.querySelector('#modeMenu [data-nmact="rename"]').click()`);
    check(await until(`!!document.querySelector('#modeDlg input')`, 3000), `${tag}: the row's Rename… opens the title field`);
    const rf = await js(`document.querySelector('#modeDlg input').value`);
    check(!leak(rf) && /\[redacted\]/.test(rf), `${tag}: the row's Rename… field is masked (${rf})`);
    await key('Escape');
    await until(`!document.querySelector('#modeDlg')`, 2000);
    await js(`window.__durbarSimUi.notes.rename(${jsLiteral({ id: 'n-' + 'p'.repeat(12), title: 'Raw ' + TOKEN, text: 'x', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), rev: 1, done: false, from: 'typed', fileEdited: false, hidden: false })});true`);
    check(await until(`!!document.querySelector('#modeDlg input')`, 3000), `${tag}: Rename… from the toast's entry opens the title field`);
    const rf2 = await js(`document.querySelector('#modeDlg input').value`);
    check(!leak(rf2) && /\[redacted\]/.test(rf2), `${tag}: ...and its field is masked (${rf2})`);
    await key('Escape');
    await until(`!document.querySelector('#modeDlg')`, 2000);
    await js(`__ntd.row("Raw ").querySelector('[data-nt="more"]').click()`);
    await until(`!!document.querySelector('#modeMenu [data-nmact="delete"]')`, 2000);
    await js(`document.querySelector('#modeMenu [data-nmact="delete"]').click()`);
    check(await until(`!!document.querySelector('#modeDlg')`, 3000), `${tag}: Delete… asks about the planted note`);
    const dd = await js(`document.querySelector('#modeDlg').textContent`);
    check(!leak(dd) && /\[redacted\]/.test(dd), `${tag}: the Delete dialog names the note masked (${dd.slice(0, 100)})`);
    await key('Escape');
    await until(`!document.querySelector('#modeDlg')`, 2000);
    await key('Escape');
    await until(`document.getElementById('notesDrawer').hidden`, 3000);
    /* the "/" list, its tooltips and the announcement */
    await typeChars('/');
    await until(`!!document.querySelector('#slashList .sl-note')`, 4000);
    for (const t of await texts('#slashList')) check(!leak(t), `${tag}: a token piece shows in the "/" list: ${String(t).slice(0, 100)}`);
    check(await js(`[...document.querySelectorAll('#slashList .sl-note .sl-name')].some(n=>n.textContent.startsWith('Raw '))`), `${tag}: the planted raw note is in the "/" list, masked`);
    check(!leak(await ann()), `${tag}: the "/" announcement has no token piece`);
    /* the planted raw note, picked from the "/" list: the box and the announcement are masked */
    await js(`[...document.querySelectorAll('#slashList .sl-note')].find(o=>o.querySelector('.sl-name').textContent.startsWith('Raw ')).click()`);
    check(await until(`document.getElementById('msgInput').value.includes('body')`, 3000) && !leak(await value()) && /\[redacted\]/.test(await value()), `${tag}: a raw note picked from the "/" list is inserted masked (${(await value()).slice(0, 50)})`);
    check(await until(`/Inserted the note/.test(document.getElementById('srAnnounce').textContent)`, 3000) && !leak(await ann()), `${tag}: ...and the announcement is masked (${await ann()})`);
    await js(`(()=>{const m=document.getElementById('msgInput');m.value='';m.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await typeChars('/');
    await until(`!!document.querySelector('#slashList .sl-note')`, 4000);
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
