/*
 * Spec 074 (issue #548): the keyboard navigator ("Go to"). Simulator only (no AI credits, no login). Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 DURBAR_SIM_FLOORS=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-074-navigator.js xvfb-run -a npx electron . --no-sandbox
 *
 * Real key presses (sendInputEvent) and typed text (insertText), at 1440x900 and 1280x800; exits non-zero on a miss:
 *   US2  Ctrl+F (⌘F on a Mac; Ctrl+J until 2026-10-23, issue #587) opens the palette in Go-to mode at the floor level; a number picks a floor; typing filters folders;
 *        Enter picks one; a number picks the agent; the chat opens with the cursor in the message box; Enter sends the typed text.
 *   US1  Ctrl+F, c, 3: chat 3 opens with the cursor in its message box; its header, desk card and list row say C3.
 *   US3  Esc steps back agent -> folders -> start -> closed, and focus returns to the desk that had it; Backspace in an empty box too.
 *   US4  Settings > Keyboard: Ctrl+K is refused with a reason, Ctrl+Shift+G is saved, Ctrl+F then does nothing and Ctrl+Shift+G
 *        opens Go to; Reset brings Ctrl+F back.
 *   #587 Ctrl+J no longer opens Go to; the cursor lands in the message box after a mouse click or Enter on a desk, a list row, a
 *        Ctrl+K pick and the inbox (a waiting chat: the message box, never the answer bar, and nothing is answered); in the message
 *        box Ctrl+Backspace and Ctrl+A edit text as always (the chat stays, Needs you stays closed, an empty box too); outside
 *        text Ctrl+A opens Needs you and Ctrl+Backspace goes back to the office, but not in the chat log (Ctrl+A) or with a
 *        selection; unsent text is back when the chat opens again.
 *   #612 a draft in chat A, switch to B: A's strip item, then its desk and list row show the pencil ("Unsent draft", >= 10.5px, inside,
 *        no text); back in A its text is intact; sending clears A's pencil, emptying B's box clears B's.
 *   FR-012 / V  every badge and navigator text is at least 10.5px; badges stay inside their desk; the box fits the window.
 * Screenshots: 074-navigator-{start,floor,chats,chat,settings,office,list,drafts}-<w>x<h>.png
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';
const MOD = process.platform === 'darwin' ? 'meta' : 'control';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until, settle, key } = H;
  const wc = H.wc();
  const shot = (name, w, h) => H.shot(path.join(OUT, `074-navigator-${name}-${w}x${h}.png`), { tag: '074', what: `${name} ${w}x${h}` });
  const type = async (t) => { wc.insertText(t); await ctx.sleep(80); };
  const open = async () => { await key('F', [MOD], { char: 'never' }); await until(`!!document.getElementById('palDlg')`, 3000); };
  const nav = () => js(`(()=>{const d=document.getElementById('palDlg');if(!d)return null;const D=d.querySelector('.pal-dlg').getBoundingClientRect();
    return {crumb:(document.getElementById('palCrumb')||{}).textContent||'',label:d.querySelector('.pal-dlg').getAttribute('aria-label'),focus:document.activeElement&&document.activeElement.id,
      opts:[...d.querySelectorAll('[role="option"]')].map(o=>({n:(o.querySelector('.pal-n')||{}).textContent||'',l:o.querySelector('.pal-l').lastChild.textContent,h:(o.querySelector('.pal-h')||{}).textContent||'',sel:o.getAttribute('aria-selected')==='true'})),
      empty:(d.querySelector('.pal-empty')||{}).textContent||'',
      font:Math.min(...[...d.querySelectorAll('.pal-crumb,.pal-n,.pal-l,.pal-h,.pal-foot,kbd,input')].map(e=>parseFloat(getComputedStyle(e).fontSize))),
      fits:D.top>=0&&D.left>=0&&D.bottom<=innerHeight&&D.right<=innerWidth}})()`);
  const panel = () => js(`({open:document.body.classList.contains('panel-open'),title:(document.getElementById('panelTitle')||{}).textContent||'',
    no:((document.querySelector('#panelHead .sub .chatno')||{}).dataset||{}).n||'',focus:document.activeElement&&document.activeElement.id,
    caret:(()=>{const m=document.getElementById('msgInput');return m?m.selectionStart===m.value.length:false})()})`);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, query: { simfloors: '1' }, focus: true });
    await H.calm();

    // ---- FR-012: the badges in the office ----
    const badges = await js(`(()=>{const ds=[...document.querySelectorAll('#stage .desk[data-id]')];return {n:ds.length,
      with:ds.filter(d=>d.querySelector('.chatno')).length,
      font:Math.min(...[...document.querySelectorAll('#stage .chatno')].map(e=>parseFloat(getComputedStyle(e).fontSize))),
      inside:ds.every(d=>{const b=d.querySelector('.chatno');if(!b)return true;const r=b.getBoundingClientRect(),q=d.getBoundingClientRect();return r.width>0&&r.left>=q.left-0.5&&r.right<=q.right+0.5&&r.top>=q.top-0.5&&r.bottom<=q.bottom+0.5;}),
      /* 2026-10-23 (Windows UI failure at 1280): on a desk card the badge sits on the scene, never in the name row */
      onScene:ds.filter(d=>{const b=d.querySelector('.chatno'),n=d.querySelector('.name'),sc=d.querySelector('.sc');if(!b||!n||!sc||!d.classList.contains('card'))return false;
        const r=b.getBoundingClientRect(),q=n.getBoundingClientRect(),c=sc.getBoundingClientRect(),hit=(x,y)=>x.left<y.right&&y.left<x.right&&x.top<y.bottom&&y.top<x.bottom;
        return !(hit(r,c)&&!hit(r,q));}).map(d=>d.innerText.trim().slice(0,20)),
      /* a name is squeezed when its text is wider than its box. (Not "the box is at least 20px": Elif is 19.3px wide in Windows fonts, 20px
         on Linux, with no badge near it; the width of a short name is its text, so a fixed floor tests the font, not the badge.) */
      squeezed:ds.filter(d=>{const n=d.querySelector('.name');if(!n)return false;const rg=document.createRange();rg.selectNodeContents(n);
        return rg.getBoundingClientRect().width>n.getBoundingClientRect().width+0.5||n.scrollWidth>n.clientWidth+0.5;}).map(d=>d.innerText.trim().slice(0,20)),
      first:ds.filter(d=>{const n=d.querySelector('.name');return n&&!d.innerText.trim().startsWith(n.innerText.trim());}).map(d=>d.innerText.trim().slice(0,20)),
      aria:ds.filter(d=>/, chat \\d+,/.test(d.getAttribute('aria-label')||'')).length,
      uniq:new Set([...document.querySelectorAll('#stage .chatno')].map(b=>b.dataset.n)).size,
      overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight}})()`);
    assert.ok(badges.n >= 15 && badges.with === badges.n, `${w}: every main desk has a chat number (${badges.with}/${badges.n})`);
    assert.ok(badges.font >= 10.5, `${w}: badge text ${badges.font}px`);
    assert.ok(badges.inside, `${w}: every badge stays inside its desk`);
    assert.deepStrictEqual(badges.onScene, [], `${w}: every desk card's badge sits on its scene, clear of the name`);
    assert.deepStrictEqual(badges.squeezed, [], `${w}: no desk name is squeezed or cut by the badge`);
    assert.deepStrictEqual(badges.first, [], `${w}: a desk's text still starts with its name (drivers and the office check find desks that way)`);
    assert.strictEqual(badges.aria, badges.n, `${w}: screen readers hear "chat N"`);
    assert.strictEqual(badges.uniq, badges.with, `${w}: chat numbers are unique`);
    assert.ok(!badges.overflow, `${w}: no page overflow`);
    await shot('office', w, h);

    // ---- US2: floor -> folder -> agent -> type -> Enter sends ----
    const deskId = await js(`(()=>{const d=document.querySelector('#stage .desk[data-id]');d.focus();return d.dataset.id})()`);
    await open();
    let s = await nav();
    assert.strictEqual(s.label, 'Go to', `${w}: the palette opened in Go-to mode`);
    assert.strictEqual(s.crumb, 'Go to');
    assert.strictEqual(s.focus, 'palIn', `${w}: the cursor is in the box`);
    assert.deepStrictEqual(s.opts.slice(0, 2).map((o) => o.l), ['Folders', 'Chats'], `${w}: Folders and Chats rows first`);
    const floors = s.opts.slice(2);
    assert.ok(floors.length >= 2 && floors.every((o, i) => o.n === String(i + 1) && /folders?$/.test(o.h)), `${w}: the floors, numbered: ${JSON.stringify(floors)}`);
    assert.ok(s.font >= 10.5 && s.fits, `${w}: legible (${s.font}px) and inside the window`);
    await shot('start', w, h);
    await type('2');
    await until(`(document.getElementById('palCrumb')||{}).textContent===${jsLiteral('Go to › ' + floors[1].l)}`, 3000);
    s = await nav();
    assert.ok(s.opts.length >= 1 && s.opts.every((o, i) => o.n === String(i + 1)), `${w}: the floor's folders, numbered`);
    await shot('floor', w, h);
    // filter by the start of a folder that has two or more chats (so the agent level shows), else the first one
    const target = s.opts.find((o) => /^([2-9]|\d\d+) chats$/.test(o.h)) || s.opts[0];
    await type(target.l.slice(0, 3));
    s = await nav();
    assert.ok(s.opts.some((o) => o.l === target.l), `${w}: the filter keeps "${target.l}"`);
    // move to it with the arrows and pick it with Enter
    for (let i = s.opts.findIndex((o) => o.sel); i < s.opts.findIndex((o) => o.l === target.l); i++) await key('Down', [], { char: 'never' });
    await key('Return', [], { char: 'never' });
    let p = await panel();
    if (!p.open) {
      s = await nav();
      assert.strictEqual(s.crumb, `Go to › ${floors[1].l} › ${target.l}`, `${w}: the agent level of ${target.l}`);
      assert.ok(s.opts.length >= 2 && s.opts.every((o) => /^C\d+$/.test(o.n)), `${w}: agents carry their chat number`);
      const want = s.opts[s.opts.length - 1];
      await type(want.n.slice(1));
      if (!(await panel()).open) await key('Return', [], { char: 'never' });
      await until(`document.body.classList.contains('panel-open')`, 3000);
      p = await panel();
      assert.strictEqual(p.title, want.l, `${w}: the picked agent's chat`);
    }
    assert.ok(p.open && p.focus === 'msgInput' && p.caret, `${w}: the chat is open with the cursor in the message box: ${JSON.stringify(p)}`);
    assert.ok(!(await H.exists('#palDlg')), `${w}: the box closed`);
    await type('hello from Go to');
    await key('Return', [], { char: 'never' });
    await until(`[...document.querySelectorAll('#chat .msg.user .bubble')].some(b=>b.textContent==='hello from Go to')&&document.getElementById('msgInput').value===''`, 5000);
    assert.ok(await js(`[...document.querySelectorAll('#chat .msg.user .bubble')].some(b=>b.textContent==='hello from Go to')`), `${w}: Enter sent the message through the composer`);
    await key('Escape', [], { char: 'never' });
    await H.office();

    // ---- US1: C 3 from the office; the number shows everywhere ----
    await open();
    await type('c');
    s = await nav();
    assert.strictEqual(s.opts[0].l, 'Chats', `${w}: "c" alone filters, with Chats first`);
    await type(' ');
    s = await nav();
    assert.strictEqual(s.crumb, 'Go to › Chats', `${w}: "c " switches to the chat level`);
    assert.ok(s.opts.every((o, i, a) => /^C\d+$/.test(o.n) && (!i || +o.n.slice(1) > +a[i - 1].n.slice(1))), `${w}: chats in number order`);
    await shot('chats', w, h);
    await key('Escape', [], { char: 'never' });
    s = await nav();
    assert.ok(s && s.crumb === 'Go to' && s.opts[0].l === 'Folders', `${w}: Esc from Chats goes back to the start, with an empty filter`);
    await type('c');
    await type('3');
    await until(`document.body.classList.contains('panel-open')`, 3000);
    p = await panel();
    assert.ok(p.no === 'C3' && p.focus === 'msgInput', `${w}: c 3 opened chat 3 with the cursor in the message box: ${JSON.stringify(p)}`);
    const selId = await js(`document.querySelector('#stage .desk[aria-pressed="true"], #stage .desk.sel')?.dataset.id||''`);
    const c3 = await js(`(()=>{const b=[...document.querySelectorAll('#stage .desk[data-id] .chatno')].find(x=>x.dataset.n==='C3');return b?b.closest('.desk').dataset.id:''})()`);
    assert.ok(c3 && (!selId || selId === c3), `${w}: the desk labelled C3 is the open chat`);
    assert.ok(await js(`parseFloat(getComputedStyle(document.querySelector('#panelHead .sub .chatno')).fontSize)>=10.5`), `${w}: header badge legible`);
    await shot('chat', w, h);
    await key('Escape', [], { char: 'never' });
    await H.office();

    // ---- issue #587 (spec Changes 2026-10-23, FR-019..FR-023) ----
    await key('J', [MOD], { char: 'never' });
    await ctx.sleep(150);
    assert.ok(!(await H.exists('#palDlg')), `${w}: Ctrl/⌘+J no longer opens Go to (no alias)`);
    const mclick = async (sel) => {
      const r = await js(`(()=>{const e=document.querySelector(${jsLiteral(sel)});if(!e)return null;e.scrollIntoView({block:'nearest'});const b=e.getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}})()`);
      assert.ok(r, `${w}: ${sel} is there to click`);
      for (const type of ['mouseDown', 'mouseUp']) wc.sendInputEvent({ type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
      await ctx.sleep(150);
    };
    const box = () => js(`(()=>{const m=document.getElementById('msgInput'),a=document.activeElement;return {open:document.body.classList.contains('panel-open'),title:(document.getElementById('panelTitle')||{}).textContent||'',
      focus:a&&(a.id||a.tagName),v:m?m.value:null,s:m?m.selectionStart:-1,e:m?m.selectionEnd:-1,inbox:!!document.getElementById('inboxDlg'),pal:!!document.getElementById('palDlg'),
      pend:document.querySelectorAll('#chat .note.perm:not(.settled)').length,inReq:!!(a&&a.closest&&a.closest('#answerBar,#chat .note'))}})()`);
    // FR-019: the cursor lands in the message box, whatever opened the chat
    const opened = async (how) => {
      await until(`document.body.classList.contains('panel-open')`, 3000);
      await until(`document.activeElement&&document.activeElement.id==='msgInput'`, 3000); /* the condition, not a fixed sleep (review #597) */
      const q = await box();
      assert.ok(q.focus === 'msgInput' && q.v === '' && q.s === 0, `${w}: ${how}: the cursor is in the message box: ${JSON.stringify(q)}`);
      return q;
    };
    const deskSel = '#stage .desk[data-id="' + (await js(`[...document.querySelectorAll('#stage .desk[data-id]')][1].dataset.id`)) + '"]';
    await mclick(deskSel + ' .name');
    const q1 = await opened('a mouse click on a desk');
    await key('Escape', [], { char: 'never' });
    await H.office();
    await js(`document.querySelector(${jsLiteral(deskSel)}).focus()`);
    await key('Return', []);
    await opened('Enter on a desk');
    await key('Escape', [], { char: 'never' });
    await H.office();
    await key('K', [MOD], { char: 'never' });
    await until(`!!document.getElementById('palDlg')`, 3000);
    await type(q1.title);
    await key('Return', [], { char: 'never' });
    assert.strictEqual((await opened('a Ctrl+K pick')).title, q1.title, `${w}: Ctrl+K opened ${q1.title}`);
    await key('Escape', [], { char: 'never' });
    await H.office();
    await js(`document.getElementById('vList').click()`);
    await until(`document.querySelectorAll('#list button.lrow').length>=15`, 5000);
    await mclick('#list button.lrow');
    await opened('a mouse click on a list row');
    await js(`document.getElementById('msgInput').blur()`);
    await mclick('#stripList .sitem[aria-current="false"]');
    await opened('a mouse click on another agent in the chat strip');
    await key('Escape', [], { char: 'never' });
    await js(`document.getElementById('vOffice').click()`);
    await H.office();
    // a chat that waits for an answer: the message box, never the answer bar, and nothing is answered (I opens Needs you)
    await js(`document.querySelector(${jsLiteral(deskSel)}).focus()`);
    await key('I', [], { char: 'always' });
    await until(`!!document.querySelector('#inboxDlg [data-act="open"], #inboxDlg button')`, 3000);
    const answerIn = await js(`(()=>{const b=[...document.querySelectorAll('#inboxDlg button')].find(x=>/^(Answer in chat|Open)$/.test(x.textContent.trim()));if(!b)return '';b.click();return b.textContent.trim()})()`);
    assert.ok(answerIn, `${w}: the simulator's Needs you lists a waiting chat`);
    const qw = await opened(`Needs you, ${answerIn}`);
    assert.ok(qw.pend > 0 && !qw.inReq, `${w}: the chat waits for an answer and focus is not on the request or the answer bar: ${JSON.stringify(qw)}`);
    await ctx.sleep(400);
    assert.strictEqual((await box()).pend, qw.pend, `${w}: nothing was answered by opening the chat`);
    // FR-020 / FR-021: in the message box, Ctrl+Backspace and Ctrl+A keep their text meaning
    const TXT = 'keep this text';
    await type(TXT);
    await key('Backspace', [MOD], { char: 'never' });
    let c = await box();
    assert.ok(c.open && c.focus === 'msgInput' && !c.inbox && !c.pal, `${w}: Ctrl/⌘+Backspace in the message box keeps the chat open: ${JSON.stringify(c)}`);
    assert.ok(c.v.length < TXT.length && TXT.startsWith(c.v), `${w}: Ctrl/⌘+Backspace deleted text the normal way, nothing else: ${JSON.stringify(c.v)}`);
    await type(TXT.slice(c.v.length));
    await key('A', [MOD], { char: 'never' });
    c = await box();
    assert.ok(c.open && !c.inbox && c.v === TXT && c.s === 0 && c.e === TXT.length, `${w}: Ctrl/⌘+A in the message box selects all and Needs you stays closed: ${JSON.stringify(c)}`);
    await key('Backspace', [], { char: 'never' });
    await key('Backspace', [MOD], { char: 'never' });
    c = await box();
    assert.ok(c.open && c.focus === 'msgInput' && c.v === '', `${w}: an empty message box: Ctrl/⌘+Backspace still keeps the chat (Esc is back from here): ${JSON.stringify(c)}`);
    // FR-022: unsent text comes back when the chat opens again
    const titleW = c.title;
    await type('half-written prompt');
    await key('Escape', [], { char: 'never' });
    await H.office();
    await js(`(()=>{const d=[...document.querySelectorAll('#stage .desk[data-id]')].find(x=>x.querySelector('.name')&&x.querySelector('.name').textContent.trim()===${jsLiteral(titleW)});d.focus();})()`);
    await key('Return', []);
    await until(`document.body.classList.contains('panel-open')`, 3000);
    await until(`document.activeElement&&document.activeElement.id==='msgInput'`, 3000); /* the condition, not a fixed sleep (review #597) */
    c = await box();
    assert.ok(c.title === titleW && c.v === 'half-written prompt' && c.focus === 'msgInput' && c.s === c.v.length, `${w}: the unsent text is back, cursor at its end: ${JSON.stringify(c)}`);
    // outside text: Ctrl+A opens Needs you, but not in the chat log or with a selection; Ctrl+Backspace goes back to the office
    await js(`document.getElementById('panelTitle').focus()`);
    await key('A', [MOD], { char: 'never' });
    await until(`!!document.getElementById('inboxDlg')`, 3000);
    assert.ok((await box()).inbox, `${w}: Ctrl/⌘+A outside text opens Needs you`);
    await key('Escape', [], { char: 'never' });
    await until(`!document.getElementById('inboxDlg')`, 3000);
    await js(`document.getElementById('chat').focus()`);
    await key('A', [MOD], { char: 'never' });
    await ctx.sleep(150);
    assert.ok(!(await box()).inbox, `${w}: Ctrl/⌘+A in the chat log selects the conversation, not Needs you`);
    await js(`(()=>{const t=document.getElementById('panelTitle');getSelection().removeAllRanges();t.focus();const r=document.createRange();r.selectNodeContents(t);getSelection().addRange(r);})()`);
    await key('A', [MOD], { char: 'never' });
    await key('Backspace', [MOD], { char: 'never' });
    await ctx.sleep(150);
    c = await box();
    assert.ok(c.open && !c.inbox, `${w}: with text selected, Ctrl/⌘+A and Ctrl/⌘+Backspace are left alone: ${JSON.stringify(c)}`);
    await js(`getSelection().removeAllRanges();document.getElementById('panelTitle').focus()`);
    await key('Backspace', [MOD], { char: 'never' });
    await until(`!document.body.classList.contains('panel-open')`, 3000);
    assert.ok(!(await box()).open, `${w}: Ctrl/⌘+Backspace outside text goes back to the office`);
    await H.office();
    // clean up the kept text so later checks start from an empty box
    await js(`(()=>{const d=[...document.querySelectorAll('#stage .desk[data-id]')].find(x=>x.querySelector('.name')&&x.querySelector('.name').textContent.trim()===${jsLiteral(titleW)});d.focus();})()`);
    await key('Return', []);
    await until(`document.body.classList.contains('panel-open')`, 3000);
    assert.strictEqual((await box()).v, 'half-written prompt', `${w}: still kept after going back with Ctrl/⌘+Backspace`);
    await key('A', [MOD], { char: 'never' });
    await key('Backspace', [], { char: 'never' });
    await key('Escape', [], { char: 'never' });
    await H.office();

    // ---- issue #612 (FR-022, FR-024): each chat keeps its unsent text, and a pencil marks the chats that have one ----
    const pair = await js(`[...document.querySelectorAll('#stage .desk[data-id]')].filter(d=>/^(idle|done)$/.test(d.dataset.state)).slice(0,2).map(d=>d.dataset.id)`);
    assert.strictEqual(pair.length, 2, `${w}: two idle desks to draft in`);
    const [dA, dB] = pair;
    const marks = (id) => js(`(()=>{const e=CSS.escape(${jsLiteral(id)}),q=s=>document.querySelector(s);
      const desk=q('#stage .desk[data-id="'+e+'"]'),row=q('#list .lrow[data-id="'+e+'"]'),strip=q('#stripList .sitem[data-sw="'+e+'"]'),m=x=>x&&x.querySelector('.draft-mark');
      const shown=x=>!!x&&x.getBoundingClientRect().width>0;
      const px=x=>{const k=m(x);if(!k||!shown(x))return 99;const r=k.querySelector('svg').getBoundingClientRect();return Math.min(r.width,r.height)};
      const inside=x=>{const k=m(x);if(!k||!shown(x))return true;const r=k.getBoundingClientRect(),b=x.getBoundingClientRect(),top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return r.width>0&&!!top&&k.contains(top)&&r.left>=b.left-0.5&&r.right<=b.right+0.5&&r.top>=b.top-0.5&&r.bottom<=b.bottom+0.5};
      const aria=x=>x?/, unsent draft/.test(x.getAttribute('aria-label')||''):null;
      return {desk:!!m(desk),deskAria:aria(desk),row:!!m(row),rowAria:aria(row),strip:!!m(strip),stripAria:aria(strip),title:(m(desk)||m(row)||m(strip)||{}).title||'',
        px:Math.min(px(desk),px(row),px(strip)),inside:inside(desk)&&inside(row)&&inside(strip)}})()`);
    const openDesk = async (id) => {
      await js(`document.querySelector('#stage .desk[data-id="'+CSS.escape(${jsLiteral(id)})+'"]').focus()`);
      await key('Return', []);
      await until(`document.body.classList.contains('panel-open')`, 3000);
      await until(`document.activeElement&&document.activeElement.id==='msgInput'`, 3000); /* the condition, not a fixed sleep (review #597) */
      return box();
    };
    let ma = await marks(dA);
    assert.ok(!ma.desk && !ma.deskAria, `${w}: no pencil before any draft: ${JSON.stringify(ma)}`);
    await openDesk(dA);
    await type('draft for A');
    await js(`document.querySelector('#stripList .sitem[data-sw="'+CSS.escape(${jsLiteral(dB)})+'"]').click()`);
    await until(`(document.querySelector('#stripList .sitem.sel')||{}).dataset.sw===${jsLiteral(dB)}`, 3000);
    await until(`!!document.querySelector('#stripList .sitem[data-sw="'+CSS.escape(${jsLiteral(dA)})+'"] .draft-mark')`, 3000);
    ma = await marks(dA);
    let mb = await marks(dB);
    assert.ok(ma.strip && ma.stripAria && ma.title === 'Unsent draft', `${w}: after switching chats, A's strip item has the pencil, "Unsent draft" for screen readers and as tooltip: ${JSON.stringify(ma)}`);
    assert.ok(!mb.strip, `${w}: the open chat B has no pencil`);
    c = await box();
    assert.ok(c.focus === 'msgInput' && c.v === '', `${w}: B opens with an empty box and the cursor in it: ${JSON.stringify(c)}`);
    await type('draft for B');
    await key('Escape', [], { char: 'never' });
    await H.office();
    ma = await marks(dA); mb = await marks(dB);
    assert.ok(ma.desk && ma.deskAria && mb.desk && mb.deskAria, `${w}: both desks show the pencil and say "unsent draft": ${JSON.stringify({ ma, mb })}`);
    assert.ok(ma.px >= 10.5 && ma.inside && mb.inside, `${w}: the pencil is at least 10.5px, inside its desk and not covered: ${JSON.stringify(ma)}`);
    assert.ok(await js(`(()=>{const d=document.querySelector('#stage .desk[data-id="'+CSS.escape(${jsLiteral(dA)})+'"]'),n=d.querySelector('.name');return d.innerText.trim().startsWith(n.innerText.trim())&&n.scrollWidth<=n.clientWidth+0.5})()`), `${w}: the pencil adds no text and does not squeeze the name`);
    await shot('drafts', w, h);
    await js(`document.getElementById('vList').click()`);
    await until(`document.querySelectorAll('#list button.lrow').length>=15`, 5000);
    ma = await marks(dA);
    assert.ok(ma.row && ma.rowAria && ma.inside && ma.px >= 10.5, `${w}: the list row shows the pencil too: ${JSON.stringify(ma)}`);
    await js(`document.getElementById('vOffice').click()`);
    await H.office();
    c = await openDesk(dA);
    assert.ok(c.v === 'draft for A' && c.focus === 'msgInput' && c.s === c.v.length, `${w}: A's text is intact, cursor at its end: ${JSON.stringify(c)}`);
    assert.ok(!(await marks(dA)).strip && (await marks(dB)).strip, `${w}: while A is open its own strip item has no pencil; B's has one`);
    await key('Return', [], { char: 'never' });
    await until(`[...document.querySelectorAll('#chat .msg.user .bubble')].some(b=>b.textContent==='draft for A')&&document.getElementById('msgInput').value===''`, 5000);
    await key('Escape', [], { char: 'never' });
    await H.office();
    ma = await marks(dA); mb = await marks(dB);
    assert.ok(!ma.desk && !ma.deskAria && mb.desk, `${w}: sent: A's pencil is gone, B's stays: ${JSON.stringify({ ma, mb })}`);
    c = await openDesk(dB);
    assert.strictEqual(c.v, 'draft for B', `${w}: then B's text is intact`);
    await key('A', [MOD], { char: 'never' });
    await key('Backspace', [], { char: 'never' });
    await key('Escape', [], { char: 'never' });
    await H.office();
    mb = await marks(dB);
    assert.ok(!mb.desk && !mb.deskAria, `${w}: emptied: B's pencil is gone: ${JSON.stringify(mb)}`);

    // ---- review on #597 (fjcabello): Ctrl+A and Ctrl+Backspace do nothing of ours while a dialog (askDialog) is open; spec 052 FR-175:
    // nor do the other global shortcuts (Ctrl+O, Ctrl+`, Ctrl+Shift+H, Alt+N / ⌥⌘N, I, ?, N) ----
    await openDesk(dA);
    /* a probe on + Folder (Ctrl+O): counts the clicks and stops them, so the check has no side effect */
    await js(`(()=>{window.__addProbe=0;if(!window.__addProbeOn){window.__addProbeOn=1;document.addEventListener('click',e=>{if(e.target&&e.target.closest&&e.target.closest('#addFolder')&&window.__addProbeArm){window.__addProbe++;e.preventDefault();e.stopImmediatePropagation();}},true);}window.__addProbeArm=1;})()`);
    const ctrlO = process.platform !== 'darwin' && (await js(`document.body.classList.contains('has-bridge')&&!!document.getElementById('addFolder')&&!document.getElementById('addFolder').disabled`));
    if (ctrlO) {
      await key('O', ['control'], { char: 'never' });
      assert.ok(await until(`window.__addProbe===1`, 2000), `${w}: control: without a dialog Ctrl+O reaches + Folder (the probe works)`);
      await js(`window.__addProbe=0`);
    }
    const before = await js(`({title:document.getElementById('panelTitle').textContent,prev:(document.getElementById('prevBtn')||{getAttribute:()=>''}).getAttribute('aria-expanded')})`);
    await key('K', [MOD], { char: 'never' });
    await until(`!!document.getElementById('palDlg')`, 3000);
    await type('End all sessions');
    await key('Return', [], { char: 'never' });
    assert.ok(await until(`[...document.querySelectorAll('.dlg-ov [aria-modal="true"]')].some(d=>/End all sessions\?/.test(d.textContent))`, 3000), `${w}: the End all sessions dialog is open`);
    assert.ok(await until(`!!document.activeElement&&!!document.activeElement.closest('[aria-modal="true"]')&&document.activeElement.tagName==='BUTTON'`, 3000), `${w}: focus is on a dialog button (not a text field, so only the dialog guard applies)`);
    await key('A', [MOD], { char: 'never' });
    await key('Backspace', [MOD], { char: 'never' });
    await key('F', [MOD], { char: 'never' });
    if (ctrlO) await key('O', ['control'], { char: 'never' });
    await key('`', ['control'], { char: 'never' });
    await key('H', [MOD, 'shift'], { char: 'never' });
    await key('N', process.platform === 'darwin' ? ['alt', 'meta'] : ['alt'], { char: 'never' });
    for (const k of ['i', '?', 'n']) await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:${jsLiteral(k)},shiftKey:${jsLiteral(k === '?')},bubbles:true,cancelable:true}))`);
    await ctx.sleep(150); // nothing may happen: give a wrong handler its chance
    const after = await js(`({title:(document.getElementById('panelTitle')||{}).textContent,prev:(document.getElementById('prevBtn')||{getAttribute:()=>''}).getAttribute('aria-expanded'),kbd:!!document.getElementById('kbdDlg'),add:window.__addProbe})`);
    assert.ok(after.title === before.title && after.prev === before.prev && !after.kbd && !after.add, `${w}: under the dialog, Ctrl+O, Ctrl+\`, Ctrl+Shift+H, Alt+N, I, ? and N do nothing (spec 052 FR-175): ${JSON.stringify({ before, after, ctrlO })}`);
    await js(`window.__addProbeArm=0`);
    c = await box();
    assert.ok(c.open && !c.inbox && !c.pal && (await js(`!!document.querySelector('.dlg-ov [aria-modal="true"]')`)), `${w}: with a dialog open, Ctrl/⌘+A opens no Needs you and Ctrl/⌘+Backspace closes no chat and Ctrl/⌘+F opens no Go to: ${JSON.stringify(c)}`);
    await key('Escape', [], { char: 'never' });
    assert.ok(await until(`!document.querySelector('.dlg-ov [aria-modal="true"]')`, 3000), `${w}: Esc cancels the dialog (nothing ended)`);

    // ---- #612 after review: ending a session drops its draft, also from its open box ----
    await js(`document.getElementById('msgInput').focus()`);
    await type('to be dropped');
    await js(`document.getElementById('endBtn').click()`);
    assert.ok(await until(`document.getElementById('msgInput')&&document.getElementById('msgInput').value===''`, 5000), `${w}: End session empties the open box (the draft is dropped)`);
    await key('Escape', [], { char: 'never' });
    await H.office();
    ma = await marks(dA);
    assert.ok(!ma.desk && !ma.deskAria, `${w}: the ended session has no pencil: ${JSON.stringify(ma)}`);

    // ---- review 2026-10-23: the empty reason is announced; a hostile agent name stays plain text ----
    await open();
    await type('c 99');
    s = await nav();
    assert.ok(s.crumb === 'Go to › Chats' && s.opts.length === 0 && /^No chat 99 here/.test(s.empty), `${w}: no chat 99: ${JSON.stringify(s.empty)}`);
    assert.ok(await js(`!document.querySelector('#palList [role="status"]')`), `${w}: no status role inside the listbox`);
    assert.ok(await until(`/^Chats: No chat 99 here/.test(document.getElementById('srAnnounce').textContent)`, 3000), `${w}: the reason is announced, not "0 results"`);
    await key('Escape', [], { char: 'never' });
    await key('Escape', [], { char: 'never' });
    const HOSTILE = '<img src=x onerror="window.__pwned074=1">"\'&<b>bold</b>';
    const hostileId = await js(`(()=>{const a=window.__durbarSimUi.agents().find(x=>!x.parent&&x.name==='Mira')||window.__durbarSimUi.agents().find(x=>!x.parent);a.__name074=a.name;a.name=${jsLiteral(HOSTILE)};return a.id})()`);
    await open();
    await type('c ');
    const hostile = await js(`(()=>{const d=document.getElementById('palDlg');return {els:d.querySelectorAll('img,b,script,iframe').length,
      label:[...d.querySelectorAll('[role="option"] .pal-l')].map(l=>l.lastChild.textContent).includes(${jsLiteral(HOSTILE)}),pwned:!!window.__pwned074}})()`);
    await ctx.sleep(200);
    assert.ok(hostile.els === 0 && hostile.label && !hostile.pwned && !(await js(`!!window.__pwned074`)), `${w}: a hostile agent name is literal text in Go to: ${JSON.stringify(hostile)}`);
    await key('Escape', [], { char: 'never' });
    await key('Escape', [], { char: 'never' });
    await js(`(()=>{const a=window.__durbarSimUi.agents().find(x=>x.id===${jsLiteral(hostileId)});a.name=a.__name074;delete a.__name074;})()`);

    // ---- US3: the Esc chain and focus return ----
    await js(`document.querySelector('#stage .desk[data-id="'+CSS.escape(${jsLiteral(deskId)})+'"]').focus()`);
    await open();
    await type('f ');
    s = await nav();
    assert.strictEqual(s.crumb, 'Go to › Folders', `${w}: "f " lists every folder`);
    const multi = s.opts.find((o) => /^([2-9]|\d\d+) chats$/.test(o.h));
    assert.ok(multi, `${w}: some folder has two or more chats`);
    for (let i = s.opts.findIndex((o) => o.sel); i < s.opts.indexOf(multi); i++) await key('Down', [], { char: 'never' });
    await key('Return', [], { char: 'never' });
    s = await nav();
    assert.strictEqual(s.crumb, `Go to › Folders › ${multi.l}`, `${w}: the agent level`);
    await key('Escape', [], { char: 'never' });
    s = await nav();
    assert.ok(s.crumb === 'Go to › Folders' && s.opts.find((o) => o.sel).l === multi.l, `${w}: Esc: back to the folders, the same one highlighted`);
    await key('Backspace', [], { char: 'never' });
    s = await nav();
    assert.strictEqual(s.crumb, 'Go to', `${w}: Backspace in an empty box: back to the start`);
    await key('Escape', [], { char: 'never' });
    assert.ok(!(await H.exists('#palDlg')), `${w}: Esc at the start closes`);
    await until(`(document.activeElement&&document.activeElement.dataset.id)===${jsLiteral(deskId)}`, 3000); /* review #597: it flaked when read once */
    assert.strictEqual(await js(`document.activeElement&&document.activeElement.dataset.id`), deskId, `${w}: focus is back on the desk`);
    // the shortcut again closes an open navigator (toggle); Ctrl+K and the shortcut share one box
    await open();
    await key('F', [MOD], { char: 'never' });
    assert.ok(!(await H.exists('#palDlg')), `${w}: the shortcut again closes it`);
    await key('K', [MOD], { char: 'never' });
    await until(`!!document.getElementById('palDlg')`, 3000);
    assert.strictEqual((await nav()).label, 'Command palette');
    await key('F', [MOD], { char: 'never' });
    assert.strictEqual((await nav()).label, 'Go to', `${w}: the shortcut inside Ctrl+K switches to Go to`);
    await key('Escape', [], { char: 'never' });

    // ---- list view: the numbers there too ----
    await js(`document.getElementById('vList').click()`);
    await until(`document.querySelectorAll('#list .lrow .chatno').length>=15`, 5000);
    assert.ok(await js(`[...document.querySelectorAll('#list button.lrow')].filter(r=>!r.querySelector('.sub')).every(r=>r.querySelector('.chatno')&&parseFloat(getComputedStyle(r.querySelector('.chatno')).fontSize)>=10.5)`), `${w}: every main list row shows its number`);
    await shot('list', w, h);
    await js(`document.getElementById('vOffice').click()`);
    await H.office();

    // ---- US4: Settings > Keyboard ----
    await js(`document.getElementById('settingsBtn').click()`);
    await until(`!!document.getElementById('navKeyRec')`, 8000);
    const defText = await H.text('#navKeyNow');
    assert.ok(/F$/.test(defText), `${w}: the default is shown (${defText})`);
    await js(`document.getElementById('navKeyRec').focus();document.getElementById('navKeyRec').click()`);
    await key('K', [MOD], { char: 'never' });
    assert.ok(/command palette/.test(await H.text('#navKeyMsg')), `${w}: Ctrl+K is refused with a reason`);
    assert.ok(!(await H.exists('#palDlg')), `${w}: recording swallowed Ctrl+K`);
    await key('G', [MOD, 'shift'], { char: 'never' });
    assert.ok(/^Saved/.test(await H.text('#navKeyMsg')) && /G$/.test(await H.text('#navKeyNow')), `${w}: Ctrl+Shift+G saved`);
    await js(`document.getElementById('keyH').scrollIntoView({block:'center'})`);
    await shot('settings', w, h);
    await key('Escape', [], { char: 'never' });
    await until(`!document.getElementById('navKeyRec')`, 3000);
    await key('F', [MOD], { char: 'never' });
    await ctx.sleep(150);
    assert.ok(!(await H.exists('#palDlg')), `${w}: the old shortcut no longer opens Go to`);
    await key('G', [MOD, 'shift'], { char: 'never' });
    await until(`!!document.getElementById('palDlg')`, 3000);
    await key('Escape', [], { char: 'never' });
    await js(`document.getElementById('settingsBtn').click()`);
    await until(`!!document.getElementById('navKeyReset')`, 8000);
    await js(`document.getElementById('navKeyReset').click()`);
    assert.strictEqual(await H.text('#navKeyNow'), defText, `${w}: Reset brings the default back`);
    await key('Escape', [], { char: 'never' });
    await until(`!document.getElementById('navKeyRec')`, 3000);
    await open();
    await key('Escape', [], { char: 'never' });
    await settle();
  }
  console.log('[074] navigator checks passed');
};
