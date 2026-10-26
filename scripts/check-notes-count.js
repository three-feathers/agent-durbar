/*
 * Check for spec 083 T030..T032 (issue 699): the header count, the marker on a saved message, and the drawer's search.
 * Simulator only (no AI credits, nothing on disk).
 *
 *   npm run check:notes-count
 *   OUT=docs/screenshots  (optional) where the screenshots go (default: a temp folder)
 *   NOTES_ONE_SIZE=1      one size only (a quick run, the planted-mutation runs)
 *
 * At 1440x900 and 1280x800 with 15 agents:
 *   T030  the header shows "Notes N" (N = not-done notes of the folder) only when N > 0, with the tooltip "M from this session, N in this
 *         folder"; it opens and closes the drawer (aria-expanded, aria-controls); the header fits a 480px panel without overlap; it is
 *         hidden in the read-only VS Code view, and a helper's chat has none;
 *   T031  a saved message (a reply or the user's own) shows the marker with the name and tooltip "Saved to notes: <title>"; the icon opens
 *         the drawer on its note; deleting the note removes it; equal texts are told apart by their place; a resumed (replayed) chat gets
 *         it too and rebuilds it from scratch; a title that held a token is masked in the name and the tooltip;
 *   T032  the search field filters both groups by title rank then text words (case-insensitive, on masked text), the no-match line names
 *         the words masked, Esc clears the search before it closes the drawer, ArrowDown goes to the first row; with simnotes=many the
 *         drawer opens and a search runs in under 100 ms (best of 3, performance.measure).
 * A miss throws (DRIVER FAILED); the npm script exits non-zero unless "all checks passed" is printed.
 */
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const OUT = process.env.OUT || process.env.SHOTS_OUT || require('os').tmpdir();
const SIZES = process.env.NOTES_ONE_SIZE ? [[1440, 900]] : [[1440, 900], [1280, 800]];
/* the page's mod key: Meta (⌘) on a Mac, Control elsewhere (the pattern of check-sched-top.js) */
const MAC = process.platform === 'darwin';
const MOD = MAC ? 'meta' : 'control';
const CTRL = [MOD, 'shift'];
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
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'calm', tag: 'notes-count' });
  const inject = () => js(`window.__ntd={dots:()=>{const b=[...document.querySelectorAll('#chat .msg.agent .bubble')].find(x=>x.querySelector(':scope > .nt-btn'));return b?b.querySelector(':scope > .nt-btn'):null},row:t=>[...document.querySelectorAll('#notesDrawer .nt-row')].find(r=>r.querySelector('.nt-title').textContent.includes(t)),titles:()=>[...document.querySelectorAll('#notesDrawer .nt-title')].map(x=>x.textContent)};true`);
  const load = async (w, h, q) => { await H.load({ w, h, query: { simkinds: 'mixed', ...(q || {}) }, ready: 'fit' }); await inject(); };
  const open = async (name, o = {}) => {
    const id = await H.idOf(name);
    assert.ok(id, `${name} is on the floor`);
    if (await js(`document.body.classList.contains('panel-open')`)) { await js(`document.getElementById('backBtn').click()`); await until(`!document.body.classList.contains('panel-open')`, 4000); }
    await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"]`)}).click()`);
    await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('msgInput')`, 15000);
    await settle();
    if (!o.busy) await until(`(()=>{const v=e=>!!e&&e.getClientRects().length>0;return v(document.getElementById('sendBtn'))})()`, 15000);
    return id;
  };
  const drawerHidden = () => js(`document.getElementById('notesDrawer').hidden`);
  const titles = () => js(`JSON.stringify(__ntd.titles())`).then(JSON.parse);
  const ann = () => js(`document.getElementById('srAnnounce').textContent`);
  const dotsOf = `__ntd.dots()`;
  /* the header's chips and buttons: inside the window and the panel, nothing overlapping (spec 005 SC-001's rule, for the count) */
  const headCheck = () => js(`(()=>{const P=[],R=e=>e.getBoundingClientRect(),pr=R(document.getElementById('panel')),c=document.getElementById('ntCount');
    if(!c||c.hidden||!c.getClientRects().length)return ['the count is not shown'];
    const cr=R(c);if(cr.left<pr.left-1||cr.right>pr.right+1||cr.right>innerWidth+1)P.push('the count leaves the panel');
    for(const g of document.querySelectorAll('#panelHead .ph-meta, #panelHead .actions')){const kids=[...g.children].filter(k=>k.getClientRects().length&&R(k).width>0);
      for(const k of kids){const r=R(k);if(r.left<pr.left-1||r.right>pr.right+1)P.push((k.id||k.className.split(' ')[0])+' leaves the panel');}
      for(let i=0;i<kids.length;i++)for(let j=i+1;j<kids.length;j++){const a=R(kids[i]),b=R(kids[j]);if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>0.5&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>0.5)P.push((kids[i].id||kids[i].className.split(' ')[0])+' overlaps '+(kids[j].id||kids[j].className.split(' ')[0]));}}
    const small=cr.height<20;if(small)P.push('the count is too small');
    if(parseFloat(getComputedStyle(c).fontSize)<10.5)P.push('the count text is under 10.5px');
    return P;})()`);

  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;

    /* ================= T030: the header count ================= */
    await load(w, h, { simnotes: 'some' });
    check((await js(`document.querySelectorAll('#stage .desk[data-id]').length`)) === 15 && !(await js(`!!document.getElementById('ntCount')||!!document.querySelector('#stage .nt-mark,#stage .nt-count')`)), `${tag}: 15 desks and nothing of the notes on the office floor`);
    await open('Noor');
    check(await until(`!!document.getElementById('ntCount')&&!document.getElementById('ntCount').hidden`, 8000), `${tag}: the count shows with notes in the folder`);
    const c1 = await js(`JSON.stringify({t:document.getElementById('ntCount').textContent,title:document.getElementById('ntCount').title,label:document.getElementById('ntCount').getAttribute('aria-label'),ctl:document.getElementById('ntCount').getAttribute('aria-controls'),exp:document.getElementById('ntCount').getAttribute('aria-expanded'),drawer:!!document.getElementById('notesDrawer')})`).then(JSON.parse);
    check(c1.t === 'Notes 2' && c1.title === '1 from this session, 2 in this folder' && c1.ctl === 'notesDrawer' && c1.exp === 'false' && c1.drawer, `${tag}: Notes 2 (3 notes, one done), the tooltip, aria-controls and aria-expanded=false (${JSON.stringify(c1)})`);
    check(/^Notes 2\./.test(c1.label), `${tag}: the accessible name starts with the count (${c1.label})`);
    (await headCheck()).forEach((p) => check(false, `${tag}: ${p}`));
    await shot(`083-notes-count-${tag}.png`);
    /* it opens and closes the drawer, and follows the other ways in */
    await js(`document.getElementById('ntCount').click()`);
    check(await until(`!document.getElementById('notesDrawer').hidden&&document.getElementById('ntCount').getAttribute('aria-expanded')==='true'`, 5000), `${tag}: the count opens the drawer and says it is expanded`);
    await js(`document.getElementById('ntCount').click()`);
    check(await until(`document.getElementById('notesDrawer').hidden&&document.getElementById('ntCount').getAttribute('aria-expanded')==='false'`, 5000), `${tag}: the count closes it again`);
    await js(`document.getElementById('msgInput').focus()`);
    await key('M', CTRL, { char: 'never' });
    check(await until(`document.getElementById('ntCount').getAttribute('aria-expanded')==='true'`, 5000), `${tag}: Ctrl+Shift+M is reflected on the count`);
    await key('Escape');
    check(await until(`document.getElementById('ntCount').getAttribute('aria-expanded')==='false'`, 5000), `${tag}: Esc is reflected on the count`);
    /* the header fits a 480px panel with the count */
    await js(`(()=>{const s=document.createElement('style');s.id='narrowPanel';s.textContent='#panel{flex:0 0 480px!important;max-width:480px!important}';document.head.append(s);})()`);
    check(await until(`Math.round(document.getElementById('panel').getBoundingClientRect().width)===480`, 4000), `${tag}: the panel is 480px wide`);
    const hn = await headCheck();
    hn.forEach((p) => check(false, `${tag} (480px): ${p}`));
    await shot(`083-notes-count-480-${tag}.png`);
    await js(`document.getElementById('narrowPanel').remove()`);
    /* the count follows the notes: not shown at 0, shown after a save, gone after the delete */
    await load(w, h, { simnotes: undefined });
    await open('Noor');
    check(await until(`!!document.getElementById('ntCount')`, 5000) && await js(`document.getElementById('ntCount').hidden`), `${tag}: no notes: the count is not shown`);
    check(await until(`!!${dotsOf}`, 8000), `${tag}: a finished reply has a ⋯`);
    await js(`${dotsOf}.click()`);
    await until(`!!document.querySelector('#modeMenu [data-nact="save"]')`, 3000);
    await js(`document.querySelector('#modeMenu [data-nact="save"]').click()`);
    const dbg108 = await js(`document.getElementById('ntCount').textContent+' | '+document.getElementById('ntCount').title`);
    check(await until(`!document.getElementById('ntCount').hidden&&document.getElementById('ntCount').textContent==='Notes 1'&&document.getElementById('ntCount').title==='1 from this session, 1 in this folder'`, 5000), `${tag}: a save shows Notes 1 (${dbg108})`);

    /* ================= T031: the marker ================= */
    const dbg112 = await js(`document.querySelectorAll('#chat .nt-mark').length`);
    check(await until(`document.querySelectorAll('#chat .nt-mark').length===1`, 5000), `${tag}: exactly one marker after the save (${dbg112})`);
    const mk = await js(`(()=>{const m=document.querySelector('#chat .nt-mark');const n=window.__durbarSimUi.notes.all()[0];const R=m.getBoundingClientRect();return JSON.stringify({label:m.getAttribute('aria-label'),title:m.title,id:m.dataset.noteid,nid:n.id,ntitle:n.title,w:R.width,h:R.height,svg:m.querySelector('svg')?m.querySelector('svg').getBoundingClientRect().width:0,inBubble:!!m.closest('.msg.agent .bubble'),text:m.textContent})})()`).then(JSON.parse);
    check(mk.label === 'Saved to notes: ' + mk.ntitle && mk.title === mk.label && mk.id === mk.nid && mk.inBubble && mk.text === '', `${tag}: the marker is named "Saved to notes: <title>" with no emoji or text (${JSON.stringify(mk)})`);
    check(mk.svg >= 12 && mk.w >= 20 && mk.h >= 20, `${tag}: the icon is at least 12px (${mk.svg}) in a target of 20px+ (${mk.w}x${mk.h})`);
    check(await js(`document.querySelectorAll('#chat .msg.user .bubble').length>0&&document.querySelectorAll('#chat .msg.user .nt-mark,#chat .msg.user .meta .nt-mark').length===0`), `${tag}: the user's message (a precondition: it is in the chat) has no marker`);
    await shot(`083-notes-marker-${tag}.png`);
    /* the icon opens the drawer on its note */
    await js(`document.querySelector('#chat .nt-mark').click()`);
    check(await until(`!document.getElementById('notesDrawer').hidden&&document.activeElement&&document.activeElement.dataset&&document.activeElement.dataset.id===${jsLiteral(mk.nid)}`, 5000), `${tag}: the marker opens the drawer on its note (focus on its row)`);
    /* deleting the note removes the marker on repaint */
    await js(`document.querySelector('#notesDrawer .nt-row [data-nt="more"]').click()`);
    await until(`!!document.querySelector('#modeMenu [data-nmact="delete"]')`, 3000);
    await js(`document.querySelector('#modeMenu [data-nmact="delete"]').click()`);
    await until(`!!document.querySelector('#modeDlg')`, 3000);
    await js(`[...document.querySelectorAll('#modeDlg .btn')].find(b=>b.textContent==='Delete').click()`);
    check(await until(`document.querySelectorAll('#chat .nt-mark').length===0&&document.getElementById('ntCount').hidden`, 6000), `${tag}: deleting the note removes the marker and the count`);
    await key('Escape');
    await until(`document.getElementById('notesDrawer').hidden`, 3000);
    /* the user's own message: the marker is in its meta line */
    await js(`(()=>{const b=document.querySelector('#chat .msg.user .bubble');b.querySelector(':scope > .nt-btn').click();})()`);
    await until(`!!document.querySelector('#modeMenu [data-nact="save"]')`, 3000);
    await js(`document.querySelector('#modeMenu [data-nact="save"]').click()`);
    check(await until(`document.querySelectorAll('#chat .msg.user .meta .nt-mark').length===1`, 5000), `${tag}: a saved user message has the marker in its meta line`);
    /* equal texts are told apart by their place: send the same words twice, save the second, one marker on the second */
    for (const n of [1, 2]) {
      await js(`(()=>{const m=document.getElementById('msgInput');m.focus();m.value='same words twice';m.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await key('Return');
      check(await until(`[...document.querySelectorAll('#chat .msg.user .bubble')].filter(b=>b._raw==='same words twice').length===${jsLiteral(n)}`, 6000), `${tag}: the message was sent (${n})`);
      await until(`(()=>{const v=e=>!!e&&e.getClientRects().length>0;return v(document.getElementById('sendBtn'))})()`, 20000);
    }
    check(await js(`[...document.querySelectorAll('#chat .msg.user .bubble')].filter(b=>b._raw==='same words twice').length===2`), `${tag}: two bubbles hold the same text (the precondition)`);
    await js(`(()=>{const b=[...document.querySelectorAll('#chat .msg.user .bubble')].filter(b=>b._raw==='same words twice')[1];b.querySelector(':scope > .nt-btn').click();})()`);
    await until(`!!document.querySelector('#modeMenu [data-nact="save"]')`, 3000);
    await js(`document.querySelector('#modeMenu [data-nact="save"]').click()`);
    const dbg148 = await js(`[...document.querySelectorAll('#chat .msg.user .bubble')].filter(b=>b._raw==='same words twice').map(b=>!!b.closest('.msg').querySelector('.meta .nt-mark')).join()`);
    check(await until(`[...document.querySelectorAll('#chat .msg.user .bubble')].filter(b=>b._raw==='same words twice').map(b=>!!b.closest('.msg').querySelector('.meta .nt-mark')).join()==='false,true'`, 6000), `${tag}: only the second of two equal messages has the marker (${dbg148})`);

    /* a title that held a token is masked in the name and the tooltip (a note that reached the window raw) */
    await js(`window.__durbarSimUi.notes.plant(${jsLiteral({ id: 'n-' + 'm'.repeat(12), title: 'Raw ' + TOKEN, text: 'x', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), rev: 1, done: false, from: 'agent', fileEdited: false, hidden: false, source: { app: 'copilot', session: 'x', role: 'agent', ord: 0, digest: '0'.repeat(16), at: new Date().toISOString() } })});true`);
    await js(`window.__durbarSimUi.notes.marks.clear();true`);
    /* a marker built from a raw title: put a note for the first reply's real session and digest, with a token title */
    const ses = await js(`window.__durbarSimUi.notes.all().length?window.__durbarSimUi.notes.all()[0].source.session:'sim-4'`);
    const dg = await js(`(async()=>{const b=document.querySelector('#chat .msg.agent .bubble');return await window.DurbarNotes.digestOf(b._raw,crypto.subtle)})()`);
    await js(`window.__durbarSimUi.notes.plant(${jsLiteral({ id: 'n-' + 't'.repeat(12), title: 'Token ' + TOKEN, text: 'y', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), rev: 1, done: false, from: 'agent', fileEdited: false, hidden: false, source: { app: 'claude', session: ses, role: 'agent', ord: 0, digest: dg, at: new Date().toISOString() } })});true`);
    await js(`window.__durbarSimUi.notes.marks.run()`);
    check(await until(`[...document.querySelectorAll('#chat .nt-mark')].some(m=>/^Saved to notes: Token/.test(m.getAttribute('aria-label')))`, 5000), `${tag}: the planted raw-title note marks its message`);
    const mm = await js(`JSON.stringify([...document.querySelectorAll('#chat .nt-mark')].map(m=>m.getAttribute('aria-label')+'|'+m.title))`);
    check(!leak(mm) && /Saved to notes: Token \[redacted\]/.test(mm), `${tag}: the marker's name and tooltip are masked (${mm.slice(0, 120)})`);

    /* a resumed chat (replayed history) is marked too, and the markers are rebuilt from scratch */
    await load(w, h, { simnotes: undefined, simresume: '1' });
    await open('Priya', { busy: true });
    check(await until(`[...document.querySelectorAll('#chat .note')].some(n=>/Continued after restart|Resumed/.test(n.textContent))&&document.querySelectorAll('#chat .msg .bubble').length>0`, 15000), `${tag}: Priya's chat is a replayed history (the precondition)`);
    check(await until(`document.querySelectorAll('#chat .msg.user .bubble > .nt-btn').length>0`, 6000), `${tag}: a replayed message has the ⋯`);
    await js(`document.querySelector('#chat .msg.user .bubble > .nt-btn').click()`);
    await until(`!!document.querySelector('#modeMenu [data-nact="save"]')`, 3000);
    await js(`document.querySelector('#modeMenu [data-nact="save"]').click()`);
    check(await until(`document.querySelectorAll('#chat .msg.user .meta .nt-mark').length===1`, 6000), `${tag}: a saved replayed message has the marker`);
    await js(`window.__durbarSimUi.notes.marks.clear();true`);
    check(await js(`document.querySelectorAll('#chat .nt-mark').length===0`), `${tag}: the markers are cleared (the precondition of the rebuild)`);
    await js(`window.__durbarSimUi.notes.marks.run()`);
    check(await until(`document.querySelectorAll('#chat .msg.user .meta .nt-mark').length===1`, 6000), `${tag}: the markers are rebuilt from the replayed messages and the notes`);

    /* not in the read-only VS Code view (and no count there), not in a helper's chat */
    await load(w, h, { simnotes: 'some' });
    await open('Ada', { busy: true });
    check(await until(`!!document.getElementById('ntCount')&&!document.getElementById('ntCount').hidden`, 8000), `${tag}: Ada's chat shows the count (the precondition)`);
    if (!(await js(`!!document.querySelector('#prev [data-pv="view"]')`))) await js(`document.getElementById('prevBtn').click()`);
    check(await until(`!!document.querySelector('#prev [data-pv="view"]')`, 8000), `${tag}: a VS Code chat can be viewed`);
    await js(`document.querySelector('#prev [data-pv="view"]').click()`);
    check(await until(`!!document.querySelector('#chat .vsview .vsbody')&&document.querySelectorAll('#chat .vsview .bubble').length>0`, 8000), `${tag}: the VS Code view shows its messages`);
    check(await js(`document.querySelectorAll('#chat .nt-mark').length===0&&document.getElementById('ntCount').hidden`), `${tag}: no marker and no count in the read-only VS Code view`);
    check(await js(`document.querySelectorAll('#chat .vsview .bubble').length>0`), `${tag}: (the view had messages, so the absence means something)`);
    await js(`document.getElementById('vsBack').click()`);
    check(await until(`!document.getElementById('ntCount').hidden`, 6000), `${tag}: back in the chat the count returns`);
    if (await js(`document.getElementById('prevBtn')&&document.getElementById('prevBtn').getAttribute('aria-expanded')==='true'`)) await js(`document.getElementById('prevBtn').click()`);
    await js(`document.getElementById('backBtn').click()`);
    await until(`!document.body.classList.contains('panel-open')`, 4000);
    await load(w, h, { simnotes: 'some' });
    const helper = await js(`(()=>{const h=document.querySelector('#stage .helper[data-id]');return h?h.dataset.id:''})()`);
    check(!!helper, `${tag}: the floor has a helper card (the precondition)`);
    if (helper) {
      await js(`document.querySelector(${jsLiteral(`#stage .helper[data-id="${helper}"]`)}).click()`);
      check(await until(`document.body.classList.contains('panel-open')&&!!document.querySelector('#panel .panel-in.ro')`, 10000), `${tag}: a helper's chat is open (the precondition)`);
      check(await js(`!document.getElementById('ntCount')&&!document.getElementById('notesDrawer')&&document.querySelectorAll('#chat .nt-mark,#chat .nt-btn').length===0`), `${tag}: no count, no drawer and no marker in a helper's chat`);
    }

    /* ================= T032: the drawer's search ================= */
    await load(w, h, { simnotes: 'some' });
    await open('Noor');
    await js(`document.getElementById('msgInput').focus()`);
    await key('M', CTRL, { char: 'never' });
    check(await until(`!document.getElementById('notesDrawer').hidden&&!!document.querySelector('#notesDrawer .nt-row')`, 6000), `${tag}: the drawer opens`);
    check(await js(`(()=>{const f=document.getElementById('ntSearch');return !!f&&f.type==='search'&&f.getAttribute('aria-label')==='Search notes'&&f.getClientRects().length>0})()`), `${tag}: a search field named Search notes is at the top`);
    const all = await titles();
    check(all.length === 2, `${tag}: two notes are listed before a search (${all.join('|')})`);
    await shot(`083-notes-search-${tag}.png`);
    const search = async (q) => { await js(`window.__durbarSimUi.notes.search(${jsLiteral(q)})`); await until(`document.getElementById('ntSearch').value===${jsLiteral(q)}`, 2000); };
    await search('PLAN');
    check(await until(`__ntd.titles().length===1&&__ntd.titles()[0]==='Plan for the migration'`, 3000), `${tag}: "PLAN" finds the plan note by its title, case-insensitive (${(await titles()).join('|')})`);
    await search('tables');
    check(await until(`__ntd.titles().length===1&&__ntd.titles()[0]==='Plan for the migration'`, 3000), `${tag}: "tables" finds it by its text (${(await titles()).join('|')})`);
    await search('migration quota');
    check(await until(`__ntd.titles().length===0`, 3000), `${tag}: every word must match (no note has both)`);
    check(await until(`/No notes match "migration quota"/.test(document.getElementById('notesDrawer').textContent)`, 3000), `${tag}: the no-match line names the words`);
    check(await until(`/No notes match/.test(document.getElementById('srAnnounce').textContent)`, 3000), `${tag}: the no match is announced (${await ann()})`);
    /* the window searches the MASKED text: a note that reached it with the token in its title and its text is found by the words beside the token, never by the token */
    await js(`window.__durbarSimUi.notes.plant(${jsLiteral({ id: 'n-' + 'k'.repeat(12), title: 'Tok ' + TOKEN, text: 'beside ' + TOKEN + ' here', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), rev: 1, done: false, from: 'typed', fileEdited: false, hidden: false })});true`);
    check(await js(`JSON.stringify(window.__durbarSimUi.notes.all()).includes(${jsLiteral(BODY)})`), `${tag}: the window holds a note with the raw token (the precondition of the next checks)`);
    await search('beside');
    check(await until(`__ntd.titles().some(t=>t.startsWith('Tok '))`, 3000), `${tag}: the words beside the token find that note (its text is searched)`);
    await search(BODY);
    check(await until(`!__ntd.titles().some(t=>t.startsWith('Tok '))`, 3000) && await js(`!__ntd.titles().some(t=>t.startsWith('Tok '))`), `${tag}: the token itself finds nothing (the masked text is what is searched)`);
    await search(BODY.slice(0, 12));
    check(await until(`!__ntd.titles().some(t=>t.startsWith('Tok '))`, 3000), `${tag}: ...nor a piece of it`);
    await search(TOKEN);
    check(await until(`/No notes match/.test(document.getElementById('notesDrawer').textContent)`, 3000), `${tag}: a pasted token matches nothing`);
    const nm = await js(`document.getElementById('notesDrawer').textContent+'|'+document.getElementById('srAnnounce').textContent+'|'+[...document.querySelectorAll('#notesDrawer [title],#notesDrawer [aria-label]')].map(e=>(e.title||'')+(e.getAttribute('aria-label')||'')).join('|')`);
    check(!leak(nm) && /No notes match "\[redacted\]"/.test(nm), `${tag}: the no-match line masks the words (${nm.slice(0, 120)})`);
    check(!leak(await js(`document.getElementById('ntSearch').getAttribute('aria-label')+document.getElementById('ntSearch').placeholder`)), `${tag}: the field's own texts hold no token`);
    /* Esc clears the search first; the second closes the drawer */
    await js(`document.getElementById('ntSearch').focus()`);
    await key('Escape');
    check(await until(`document.getElementById('ntSearch').value===''&&__ntd.titles().length===2&&!document.getElementById('notesDrawer').hidden`, 3000), `${tag}: Esc clears the search and keeps the drawer open`);
    await key('Escape');
    check(await until(`document.getElementById('notesDrawer').hidden`, 3000), `${tag}: a second Esc closes the drawer`);
    /* ArrowDown from the field goes to the first row */
    await key('M', CTRL, { char: 'never' });
    await until(`!document.getElementById('notesDrawer').hidden&&!!document.querySelector('#notesDrawer .nt-row')`, 5000);
    await js(`document.getElementById('ntSearch').focus()`);
    await key('Down');
    check(await until(`document.activeElement&&document.activeElement.classList.contains('nt-row')`, 3000), `${tag}: ArrowDown from the field goes to the first row`);
    await key('Escape');
    check(await until(`document.getElementById('notesDrawer').hidden&&document.getElementById('ntSearch').value===''`, 3000), `${tag}: closing the drawer clears the search`);

    /* leaving the chat takes the search with it: the field and the list agree when the drawer is opened again */
    await key('M', CTRL, { char: 'never' });
    await until(`!document.getElementById('notesDrawer').hidden&&!!document.querySelector('#notesDrawer .nt-row')`, 5000);
    await search('quota');
    check(await until(`__ntd.titles().length===1`, 3000), `${tag}: "quota" leaves one row (the precondition)`);
    await js(`document.getElementById('backBtn').click()`);
    await until(`!document.body.classList.contains('panel-open')`, 4000);
    await open('Noor');
    await js(`document.getElementById('msgInput').focus()`);
    await key('M', CTRL, { char: 'never' });
    check(await until(`!document.getElementById('notesDrawer').hidden&&document.querySelectorAll('#notesDrawer .nt-row').length===2&&document.getElementById('ntSearch').value===''`, 6000), `${tag}: back in the chat the field is empty and both notes are listed (${(await titles()).join('|')})`);
    await key('Escape');
    await until(`document.getElementById('notesDrawer').hidden`, 3000);

    /* title rank before text words, in both groups (a planted set) */
    await js(`window.__durbarSimUi.notes.open();true`);
    await until(`!document.getElementById('notesDrawer').hidden`, 5000);
    const mkN = (id, title, text, session) => ({ id: 'n-' + id.repeat(12), title, text, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), rev: 1, done: false, from: 'agent', fileEdited: false, hidden: false, ...(session ? { source: { app: 'claude', session, role: 'agent', ord: 0, digest: '0'.repeat(16), at: new Date().toISOString() } } : {}) });
    const ses2 = await js(`window.__durbarSimUi.notes.all().find(n=>n.source&&n.source.session)?window.__durbarSimUi.notes.all().find(n=>n.source&&n.source.session).source.session:''`);
    for (const n of [mkN('a', 'Release checklist', 'we migrate tables first', ses2), mkN('b', 'Migrate users', 'plain', ses2), mkN('c', 'Lunch', 'Migrate the Cache', '')]) await js(`window.__durbarSimUi.notes.plant(${jsLiteral(n)});true`);
    await search('migrate');
    check(await until(`__ntd.titles().join('|')==='Migrate users|Release checklist|Lunch'`, 3000), `${tag}: title matches before text matches, this session's group first, then the folder's: exactly the three (${(await titles()).join('|')})`);
    await js(`window.__durbarSimUi.notes.close();true`);

    /* SC-005: with 300 notes the drawer opens and a search runs in under 100 ms (best of 3, performance.measure) */
    await load(w, h, { simnotes: 'many' });
    await open('Noor');
    await until(`document.getElementById('ntCount')&&!document.getElementById('ntCount').hidden`, 8000);
    const dbg254 = await js(`document.getElementById('ntCount').textContent`);
    check((await js(`document.getElementById('ntCount').textContent`)) === 'Notes 300', `${tag}: simnotes=many has 300 notes (${dbg254})`);
    const perf = await js(`(async()=>{const U=window.__durbarSimUi.notes,out={open:[],search:[],text:[]};
      const one=async(kind,fn)=>{performance.clearMarks();performance.clearMeasures();performance.mark('a');await fn();performance.mark('b');performance.measure(kind,'a','b');out[kind].push(performance.getEntriesByName(kind)[0].duration);};
      for(let i=0;i<3;i++){U.close();await one('open',()=>U.open());}
      for(let i=0;i<3;i++)await one('search',async()=>{U.search('idea number 1');U.search('');});
      for(let i=0;i<3;i++)await one('text',async()=>{U.search('short body');U.search('');});
      U.close();return JSON.stringify({open:Math.min(...out.open),search:Math.min(...out.search),text:Math.min(...out.text)});})()`).then(JSON.parse);
    console.log(`[notes-count] ${tag}: open ${perf.open.toFixed(1)} ms, title search ${perf.search.toFixed(1)} ms, text search ${perf.text.toFixed(1)} ms (best of 3)`);
    check(perf.open < 100 && perf.search < 100 && perf.text < 100, `${tag}: 300 notes: open ${perf.open.toFixed(1)} ms, search ${perf.search.toFixed(1)} ms, text search ${perf.text.toFixed(1)} ms must each be under 100`);
    check(await js(`window.__durbarSimUi.notes.open().then(()=>document.querySelectorAll('#notesDrawer .nt-row').length)`) === 300, `${tag}: all 300 rows are listed`);
    await js(`window.__durbarSimUi.notes.close();true`);
  }
  console.log('[notes-count] screenshots in ' + OUT);
  assert.deepStrictEqual(fails, [], fails.join('\n'));
  console.log('[notes-count] all checks passed');
};
