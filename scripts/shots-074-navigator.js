/*
 * Spec 074 (issue #548): the keyboard navigator ("Go to"). Simulator only (no AI credits, no login). Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 DURBAR_SIM_FLOORS=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-074-navigator.js xvfb-run -a npx electron . --no-sandbox
 *
 * Real key presses (sendInputEvent) and typed text (insertText), at 1440x900 and 1280x800; exits non-zero on a miss:
 *   US2  Ctrl+J (⌘J on a Mac) opens the palette in Go-to mode at the floor level; a number picks a floor; typing filters folders;
 *        Enter picks one; a number picks the agent; the chat opens with the cursor in the message box; Enter sends the typed text.
 *   US1  Ctrl+J, c, 3: chat 3 opens with the cursor in its message box; its header, desk card and list row say C3.
 *   US3  Esc steps back agent -> folders -> start -> closed, and focus returns to the desk that had it; Backspace in an empty box too.
 *   US4  Settings > Keyboard: Ctrl+K is refused with a reason, Ctrl+Shift+G is saved, Ctrl+J then does nothing and Ctrl+Shift+G
 *        opens Go to; Reset brings Ctrl+J back.
 *   FR-012 / V  every badge and navigator text is at least 10.5px; badges stay inside their desk; the box fits the window.
 * Screenshots: 074-navigator-{start,floor,chats,chat,settings,office,list}-<w>x<h>.png
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
  const open = async () => { await key('J', [MOD], { char: 'never' }); await until(`!!document.getElementById('palDlg')`, 3000); };
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
      names:Math.min(...ds.map(d=>{const n=d.querySelector('.name');return n?n.getBoundingClientRect().width:99;})),
      first:ds.filter(d=>{const n=d.querySelector('.name');return n&&!d.innerText.trim().startsWith(n.innerText.trim());}).map(d=>d.innerText.trim().slice(0,20)),
      aria:ds.filter(d=>/, chat \\d+,/.test(d.getAttribute('aria-label')||'')).length,
      uniq:new Set([...document.querySelectorAll('#stage .chatno')].map(b=>b.dataset.n)).size,
      overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight}})()`);
    assert.ok(badges.n >= 15 && badges.with === badges.n, `${w}: every main desk has a chat number (${badges.with}/${badges.n})`);
    assert.ok(badges.font >= 10.5, `${w}: badge text ${badges.font}px`);
    assert.ok(badges.inside, `${w}: every badge stays inside its desk`);
    assert.deepStrictEqual(badges.onScene, [], `${w}: every desk card's badge sits on its scene, clear of the name`);
    assert.ok(badges.names >= 20, `${w}: names keep room next to the badge (${badges.names}px)`);
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
    assert.strictEqual(await js(`document.activeElement&&document.activeElement.dataset.id`), deskId, `${w}: focus is back on the desk`);
    // the shortcut again closes an open navigator (toggle); Ctrl+K and the shortcut share one box
    await open();
    await key('J', [MOD], { char: 'never' });
    assert.ok(!(await H.exists('#palDlg')), `${w}: the shortcut again closes it`);
    await key('K', [MOD], { char: 'never' });
    await until(`!!document.getElementById('palDlg')`, 3000);
    assert.strictEqual((await nav()).label, 'Command palette');
    await key('J', [MOD], { char: 'never' });
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
    assert.ok(/J$/.test(defText), `${w}: the default is shown (${defText})`);
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
    await key('J', [MOD], { char: 'never' });
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
