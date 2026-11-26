/*
 * Spec 113 P6 (FR-040..FR-045, SC-005; tasks T033..T035, T038): the agent rail's Recent order. Simulator only (no AI credits, no agent app). Needs the
 * window's focus (the keyboard steps). The filter (P1/P2) does not exist yet, so the cases that need it are not here.
 *
 *   npm run check:ui -- --only check-rail-recent
 *
 * At 1440x900 and 1280x800, 15 agents (frozen clock), a chat open, railstore=1 (the simulator saves the choices only with it) and `simstarted` (the
 * simulator's stand-in for main's `startedAt`, fixed across the reloads of one step):
 *   - FR-040: "Folders | Recent" is a .seg group labelled Order, two buttons with aria-pressed (no radiogroup), text at least 10.5px, in its own row between
 *     Your door and the list, no overlap; keyboard only (Tab focus, Enter); Folders is today's list; the sort button is disabled in Recent and works
 *     again in Folders; the choice is stored and comes back after a reload; Folders removes the key; not remembering (no railstore) stores nothing;
 *   - FR-041/FR-045: a fresh start (nothing sent): the rows that need you, the open chat's row, then one folded group "Not used since Durbar started (N)"
 *     with aria-expanded and the count, its rows hidden; keyboard only unfolds and folds it, the fold is stored and kept after a reload;
 *   - FR-042/SC-005: a send you type moves that row to the first place below the rows that need you, from the next paint; a second send puts the second
 *     session first and the first one second; a failed send (simsendfail) stamps nothing; the stored value holds ids and times only (no message text);
 *     a reload keeps the order and the split; a stamp from before the start sits in the group, ahead of never-sent rows;
 *   - FR-043: each row shows its folder (text at least 10.5px, a title with the path), the age of your last send only on rows that do not need you, rows
 *     keep their heights (36 and 66px), nothing overlaps, no sideways scroll, at 180px too; same-name folders differ (parent/name), `iot-platform-form-2`
 *     and `-3` do not read the same; a folder named like a secret shows masked in its text, tooltip and accessible name;
 *   - the folds of Folders (durbar.railFolds) are neither read nor written in Recent.
 * Screenshots (OUT or the temp folder): 113-rail-recent-<w>x<h>.png.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || require('os').tmpdir();

process.exitCode = 1;
const SIZES = [[1440, 900], [1280, 800]];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const ok = async (expr, what, ms) => assert.ok(await until(expr, ms || 8000), what);
  const STARTED = Date.now() - 600000; // the app "started" ten minutes ago: a send now is this run's
  const q = (extra) => Object.assign({ railstore: '1', simstarted: String(STARTED) }, extra || {});
  const open = async (tag, query, openId) => {
    await H.load({ w: query.__w, h: query.__h, query: Object.fromEntries(Object.entries(query).filter(([k]) => !k.startsWith('__'))), focus: true });
    await H.needFocus(tag);
    await js(openId ? `document.querySelector('#stage .desk[data-id=${jsLiteral(openId)}]').click()` : `document.querySelector('#stage .desk[data-id]').click()`);
    await ok(`document.body.classList.contains('panel-open')&&document.querySelectorAll('#stripList .sitem').length>=15&&!!document.querySelector('.rail-order')`, `${tag}: a chat is open, the rail lists 15 rows and has the order control`, 15000);
    await js(`document.activeElement&&document.activeElement.blur()`);
  };
  /* the painted list in order: flat rows (head and open row), then the group's rows */
  const list = () => js(`(()=>{const box=document.getElementById('stripList');const rows=[...box.children].filter(c=>c.matches('.sitem')).map(r=>r.dataset.sw);
    const g=box.querySelector('.rgrp[data-key="rg:idle"]');const gr=g?[...g.querySelectorAll('.sitem')].map(r=>r.dataset.sw):[];
    const h=g&&g.querySelector('.rg-h');
    return {flat:rows,group:gr,heading:h?{text:h.textContent,expanded:h.getAttribute('aria-expanded'),label:h.getAttribute('aria-label'),count:h.querySelector('.rg-c').textContent}:null,folderHeads:box.querySelectorAll('[data-rgfold]').length,
      tall:[...box.querySelectorAll('.sitem.tall')].map(r=>r.dataset.sw),hidden:g?g.querySelector('.rg-rows').hidden:null};})()`);
  /* a session's folder name as the office draws it (the page's own state is not reachable: app.js is one closure) */
  const ROOMNAME = `(id=>{const a=window.__durbarSimUi.agents().find(x=>x.id===id);const e=a&&document.querySelector('#stage .room[data-key="room:'+CSS.escape(a.room)+'"] .room-name');return e?e.textContent.trim():null;})`;
  const press = async (sel, key) => { await js(`document.querySelector(${jsLiteral(sel)}).focus()`); await H.key(key || 'Return'); };
  const pressed = (k) => js(`document.querySelector('[data-rorder=${k}]').getAttribute('aria-pressed')`);
  const stored = (k) => js(`localStorage.getItem(${jsLiteral(k)})`);
  const sendTo = async (id, text) => {
    await js(`document.querySelector('#stripList .sitem[data-sw=${jsLiteral(id)}]').click()`);
    await ok(`document.body.classList.contains('panel-open')&&!!document.getElementById('msgInput')&&document.querySelector('#stripList .sitem.sel')&&document.querySelector('#stripList .sitem.sel').dataset.sw===${jsLiteral(id)}`, `the chat of ${id} is open`, 10000);
    await js(`(()=>{const m=document.getElementById('msgInput');m.value=${jsLiteral(text)};m.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('sendBtn').click();})();0`);
  };

  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    const Q = (extra) => Object.assign(q(extra), { __w: w, __h: h });
    await open(tag, Q());
    await js(`['durbar.railOrder','durbar.railYouAt','durbar.railIdleOpen'].forEach(k=>localStorage.removeItem(k))`);

    // ---- FR-040: the control ----
    const ctl = await js(`(()=>{const c=document.querySelector('.rail-order'),g=c.querySelector('[role=group]'),bs=[...c.querySelectorAll('button')],r=c.getBoundingClientRect(),door=document.querySelector('.rail-door').getBoundingClientRect(),lst=document.getElementById('stripList').getBoundingClientRect(),rail=document.querySelector('.rail');
      return {label:g.getAttribute('aria-label'),seg:g.classList.contains('seg'),names:bs.map(b=>b.textContent),pressed:bs.map(b=>b.getAttribute('aria-pressed')),radios:!!c.querySelector('[role=radiogroup],[role=radio]'),font:Math.min(...bs.map(b=>parseFloat(getComputedStyle(b).fontSize))),
        below:r.top>=door.bottom-0.5,above:r.bottom<=lst.top+0.5,inside:r.left>=rail.getBoundingClientRect().left&&r.right<=rail.getBoundingClientRect().right+0.5,h:Math.round(r.height)};})()`);
    assert.strictEqual(ctl.label, 'Order', `${tag}: the group is named Order`);
    assert.ok(ctl.seg && !ctl.radios, `${tag}: the existing .seg control, not a radiogroup`);
    assert.deepStrictEqual(ctl.names, ['Folders', 'Recent'], `${tag}: Folders | Recent`);
    assert.deepStrictEqual(ctl.pressed, ['true', 'false'], `${tag}: Folders is pressed by default`);
    assert.ok(ctl.font >= 10.5, `${tag}: the control text is ${ctl.font}px, at least 10.5px`);
    assert.ok(ctl.below && ctl.above && ctl.inside, `${tag}: the control has its own row between Your door and the list (${JSON.stringify(ctl)})`);
    const folders0 = await list();
    assert.ok(folders0.folderHeads > 1 && folders0.flat.length === 0, `${tag}: Folders is today's list with folder headings`);
    assert.strictEqual(await js(`document.getElementById('railSortBtn').disabled`), false, `${tag}: the sort button works in Folders`);
    const foldsBefore = await stored('durbar.railFolds');

    // keyboard only: Tab reaches the buttons, Enter chooses
    await js(`document.getElementById('railDoor').focus()`);
    await H.key('Tab');
    assert.strictEqual(await js(`document.activeElement.dataset.rorder`), 'folders', `${tag}: Tab from Your door reaches Folders`);
    await H.key('Tab');
    assert.strictEqual(await js(`document.activeElement.dataset.rorder`), 'recent', `${tag}: Tab again reaches Recent`);
    await H.key('Return');
    await ok(`document.querySelector('[data-rorder=recent]').getAttribute('aria-pressed')==='true'&&document.querySelectorAll('#stripList [data-rgfold]').length===0`, `${tag}: Enter on Recent switches the list (no folder headings)`);
    assert.strictEqual(await pressed('folders'), 'false', `${tag}: Folders is no longer pressed`);
    assert.strictEqual(await stored('durbar.railOrder'), 'recent', `${tag}: the choice is stored`);
    assert.strictEqual(await js(`document.activeElement.dataset.rorder`), 'recent', `${tag}: the focus stays on the control`);
    // the sort button is off in Recent
    assert.strictEqual(await js(`document.getElementById('railSortBtn').disabled`), true, `${tag}: the sort button is disabled in Recent`);
    assert.ok(/Folders order/.test(await js(`document.getElementById('railSortBtn').title`)), `${tag}: its tooltip says why`);

    // ---- FR-041/FR-045: a fresh start ----
    let L = await list();
    const openId = await js(`document.querySelector('#stripList .sitem.sel').dataset.sw`);
    assert.strictEqual(L.folderHeads, 0, `${tag}: no folder headings in Recent`);
    const all = [...L.flat, ...L.group];
    assert.strictEqual(all.length, 15, `${tag}: all 15 sessions are listed once (${all.length})`);
    assert.strictEqual(new Set(all).size, 15, `${tag}: none twice`);
    assert.ok(L.tall.every((id) => L.flat.includes(id)), `${tag}: whoever needs you is never in the folded group`);
    assert.ok(L.flat.slice(0, L.tall.length).every((id) => L.tall.includes(id)), `${tag}: the rows that need you come first`);
    const tallN = L.tall.length;
    const openNeeds = L.tall.includes(openId);
    assert.deepStrictEqual(L.flat, [...L.tall, ...(openNeeds ? [] : [openId])], `${tag}: a fresh start: the rows that need you, then the open chat's row (${JSON.stringify(L.flat)})`);
    assert.ok(L.heading, `${tag}: the group heading is painted`);
    assert.strictEqual(L.heading.expanded, 'false', `${tag}: the group is folded by default`);
    assert.strictEqual(L.hidden, true, `${tag}: its rows are hidden`);
    assert.strictEqual(L.heading.count, String(15 - tallN - (openNeeds ? 0 : 1)), `${tag}: the heading counts the rows in the group`);
    assert.ok(/^Not used since Durbar started/.test(L.heading.text) && /sessions?$/.test(L.heading.label), `${tag}: the heading says what it is (${L.heading.label})`);
    assert.ok((await js(`document.querySelector('#stripList .sitem.sel').getAttribute('aria-current')`)) === 'true', `${tag}: the open row has aria-current`);
    const idleIds = L.group;

    // keyboard only: fold and unfold the group
    await press('[data-rgidle]');
    await ok(`document.querySelector('[data-rgidle]').getAttribute('aria-expanded')==='true'&&!document.querySelector('#rgRowsIdle').hidden`, `${tag}: Enter unfolds the group`);
    assert.strictEqual(await stored('durbar.railIdleOpen'), '1', `${tag}: the unfold is stored`);
    assert.strictEqual(await js(`document.activeElement.hasAttribute('data-rgidle')`), true, `${tag}: the focus stays on the heading`);
    await H.key('Space');
    await ok(`document.querySelector('[data-rgidle]').getAttribute('aria-expanded')==='false'`, `${tag}: Space folds it again`);
    assert.strictEqual(await stored('durbar.railIdleOpen'), null, `${tag}: folded: the key is removed`);
    await press('[data-rgidle]');
    await ok(`document.querySelector('[data-rgidle]').getAttribute('aria-expanded')==='true'`, `${tag}: unfolded again for the checks below`);

    // fit: heights, folder text, nothing overlapping, no sideways scroll
    const fit = async (what) => js(`(()=>{const box=document.getElementById('stripList');const rows=[...box.querySelectorAll('.sitem')].filter(r=>r.getClientRects().length);
      const bad=[];let minFont=99;
      for(const r of rows){const b=r.getBoundingClientRect(),want=r.classList.contains('tall')?66:36;if(Math.abs(b.height-want)>0.6)bad.push(r.dataset.sw+' is '+b.height+'px, not '+want);
        const f=r.querySelector('.sfold'),a=r.querySelector('.sago'),s=r.querySelector('.sst');
        if(!f){bad.push(r.dataset.sw+' has no folder text');continue;}
        minFont=Math.min(minFont,parseFloat(getComputedStyle(f).fontSize));if(a)minFont=Math.min(minFont,parseFloat(getComputedStyle(a).fontSize));
        const fb=f.getBoundingClientRect();
        if(f.scrollWidth>0&&fb.width<8)bad.push(r.dataset.sw+' folder text is '+fb.width+'px wide: '+JSON.stringify([...r.querySelectorAll('.stx,.stop,.sfl,.sfold,.sfp,.sfn,.sago,.sst,b')].map(e=>e.className+':'+Math.round(e.getBoundingClientRect().width)+':'+e.textContent.slice(0,14))));
        if(a&&!r.classList.contains('tall')){const ab=a.getBoundingClientRect();if(fb.right>ab.left+0.5)bad.push(r.dataset.sw+' folder overlaps the age');}
        if(s&&!r.classList.contains('tall')){const sb=s.getBoundingClientRect(),nb=r.querySelector('.stop b').getBoundingClientRect(),rb=r.getBoundingClientRect();if(nb.right>sb.left+0.5)bad.push(r.dataset.sw+' name overlaps the status');if(sb.right>rb.right+0.5)bad.push(r.dataset.sw+' status leaves the row');if(a&&a.getBoundingClientRect().right>rb.right+0.5)bad.push(r.dataset.sw+' age leaves the row');}
        if(r.scrollWidth>r.clientWidth+1)bad.push(r.dataset.sw+' scrolls sideways');
        if(r.classList.contains('tall')&&r.querySelector('.sago'))bad.push(r.dataset.sw+' needs you and shows two ages');}
      const l=document.getElementById('stripList');return {bad,minFont,sideways:l.scrollWidth>l.clientWidth+1,rail:document.querySelector('.rail').scrollWidth>document.querySelector('.rail').clientWidth+1,n:rows.length};})()`);
    let f = await fit('unfolded');
    assert.deepStrictEqual(f.bad, [], `${tag}: rows fit: ${JSON.stringify(f.bad)}`);
    assert.ok(f.minFont >= 10.5, `${tag}: row text is ${f.minFont}px, at least 10.5px`);
    assert.ok(!f.sideways && !f.rail, `${tag}: no sideways scroll`);
    assert.strictEqual(f.n, 15, `${tag}: 15 rows shown`);
    // one row's names
    const row0 = await js(`(()=>{const r=document.querySelector('#stripList .sitem.rec:not(.tall)');return {fold:r.querySelector('.sfold').textContent,tip:r.dataset.tip,aria:r.getAttribute('aria-label'),room:${ROOMNAME}(r.dataset.sw),age:!!r.querySelector('.sago')};})()`);
    assert.ok(row0.fold.includes(row0.room.slice(0, 6)), `${tag}: the folder name is in the row (${row0.fold} / ${row0.room})`);
    assert.ok(row0.tip.includes('Folder: '), `${tag}: the tooltip has the folder path`);
    assert.ok(/Folder: /.test(row0.aria), `${tag}: the accessible name has the folder (${row0.aria})`);
    assert.ok(!row0.age, `${tag}: a never-sent row shows no age`);

    // ---- the sort button: Folders again ----
    await press('[data-rorder=folders]');
    await ok(`document.querySelectorAll('#stripList [data-rgfold]').length>1&&document.getElementById('railSortBtn').disabled===false`, `${tag}: back to Folders: the headings and the sort button return`);
    assert.strictEqual(await stored('durbar.railOrder'), null, `${tag}: Folders removes the key`);
    assert.strictEqual(await stored('durbar.railFolds'), foldsBefore, `${tag}: Recent never wrote the folds`);
    await press('[data-rorder=recent]');
    await ok(`document.querySelectorAll('#stripList [data-rgfold]').length===0`, `${tag}: Recent again`);

    // ---- FR-042, SC-005: sends ----
    const idle = idleIds.filter((id) => id !== openId);
    const [A, B] = [idle[0], idle[1]];
    const secretText = 'a-private-sentence-' + Date.now();
    await sendTo(A, secretText);
    await ok(`(()=>{const f=[...document.getElementById('stripList').children].filter(c=>c.matches('.sitem')).map(r=>r.dataset.sw);return f[${tallN}]===${jsLiteral(A)}})()`, `${tag}: after a send the row of A is the first below the rows that need you`);
    L = await list();
    assert.ok(!L.group.includes(A), `${tag}: A left the group`);
    await ok(`!!document.querySelector('#stripList .sitem[data-sw=${jsLiteral(A)}] .sago')`, `${tag}: A shows the age of your send`);
    const ageText = await js(`document.querySelector('#stripList .sitem[data-sw=${jsLiteral(A)}] .sago').textContent`);
    assert.ok(/^(just now|\d+[mhd])$/.test(ageText), `${tag}: the age is short (${ageText})`);
    const ys = JSON.parse(await stored('durbar.railYouAt'));
    assert.deepStrictEqual(Object.keys(ys), [A], `${tag}: only A is stamped`);
    assert.ok(typeof ys[A] === 'number' && Math.abs(Date.now() - ys[A]) < 120000, `${tag}: the stamp is a recent time`);
    const dump = await js(`JSON.stringify(Object.entries(localStorage))`);
    assert.ok(!dump.includes(secretText), `${tag}: the message text is stored nowhere`);
    await sendTo(B, 'second message');
    await ok(`(()=>{const f=[...document.getElementById('stripList').children].filter(c=>c.matches('.sitem')).map(r=>r.dataset.sw);return f[${tallN}]===${jsLiteral(B)}&&f[${tallN + 1}]===${jsLiteral(A)}})()`, `${tag}: B is first, A second`);
    await sendTo(A, 'third message');
    await ok(`(()=>{const f=[...document.getElementById('stripList').children].filter(c=>c.matches('.sitem')).map(r=>r.dataset.sw);return f[${tallN}]===${jsLiteral(A)}&&f[${tallN + 1}]===${jsLiteral(B)}})()`, `${tag}: a new send puts A first again`);
    // a neighbour's status change moves nobody in the group
    const grp0 = (await list()).group;
    const other = grp0[0];
    for (const st of ['working', 'idle']) await js(`window.__durbarSimUi.emit(${jsLiteral({ type: 'status', sessionId: other, timestamp: Date.now(), status: st, intent: 'x' })});0`);
    await js(`new Promise(r=>setTimeout(r,300))`);
    assert.deepStrictEqual((await list()).group, grp0, `${tag}: a neighbour's status change leaves the group's order alone`);
    await js(`document.querySelector('#stripList .sitem[data-sw=${jsLiteral(A)}]').click()`);
    L = await list();
    const keepOrder = L.flat;
    assert.deepStrictEqual(keepOrder.slice(tallN, tallN + 2), [A, B], `${tag}: the order before the reload`);
    await H.shot(path.join(OUT, `113-rail-recent-${tag}.png`), { prep: 'calm', blur: true, tag: 'rail' });

    // ---- reload: the order, the split and the choice are kept ----
    await open(tag, Q(), A);
    assert.strictEqual(await pressed('recent'), 'true', `${tag}: Recent is back after a reload`);
    L = await list();
    assert.deepStrictEqual(L.flat.slice(tallN, tallN + 2), [A, B], `${tag}: the order is kept after a reload`);
    assert.ok(!L.group.includes(A) && !L.group.includes(B), `${tag}: the split is kept: A and B (stamped this run) are not in the group`);
    assert.strictEqual(L.heading.expanded, 'true', `${tag}: the group's fold is kept (it was left open)`);
    // a stamp from before the start is in the group, ahead of never-sent rows
    const old = L.group[2], older = L.group[0];
    await js(`localStorage.setItem('durbar.railYouAt',${jsLiteral(JSON.stringify({ [A]: Date.now(), [B]: Date.now() - 1000, [old]: STARTED - 5000 }))})`);
    await open(tag, Q(), A);
    L = await list();
    assert.ok(L.group[0] === old && L.group.length >= 2, `${tag}: a send from before the start leads the group (${JSON.stringify(L.group.slice(0, 3))} wants ${old} first)`);
    assert.ok(!L.group.includes(A) && !L.group.includes(B), `${tag}: this run's sends are out of the group`);
    // corrupt storage loads as empty (no error): everything is unstamped
    await js(`localStorage.setItem('durbar.railYouAt','{not json')`);
    await open(tag, Q(), A);
    L = await list();
    assert.strictEqual(L.group.length, 15 - L.tall.length - (L.tall.includes(A) ? 0 : 1), `${tag}: corrupt stamps load as none: everything but the rows that need you and the open one is in the group (${L.group.length})`);
    assert.strictEqual(L.flat.length, tallN + (L.tall.includes(A) ? 0 : 1), `${tag}: only the rows that need you and the open row are above the group`);
    void older;

    // ---- a failed send stamps nothing ----
    await js(`localStorage.removeItem('durbar.railYouAt')`);
    await open(tag, Q({ simsendfail: 'secret' }));
    const Lf = await list();
    const D = Lf.group[0];
    await sendTo(D, 'this will fail');
    await ok(`[...document.querySelectorAll('#chat .note.err, #chat .note')].some(n=>/Send failed/.test(n.textContent))`, `${tag}: the send failed`, 10000);
    await js(`new Promise(r=>setTimeout(r,300))`);
    assert.strictEqual(await stored('durbar.railYouAt'), null, `${tag}: a failed send stamps nothing`);
    assert.ok((await list()).group.includes(D) || (await list()).flat.includes(D), `${tag}: D is still listed`);

    // ---- not remembering: nothing is stored ----
    await js(`['durbar.railOrder','durbar.railYouAt','durbar.railIdleOpen'].forEach(k=>localStorage.removeItem(k))`);
    await H.load({ w, h, query: { simstarted: String(STARTED) }, focus: true });
    await H.needFocus(tag);
    await js(`document.querySelector('#stage .desk[data-id]').click()`);
    await ok(`document.body.classList.contains('panel-open')&&document.querySelectorAll('#stripList .sitem').length>=15`, `${tag}: without railstore a chat opens`, 15000);
    await press('[data-rorder=recent]');
    await ok(`document.querySelectorAll('#stripList [data-rgfold]').length===0`, `${tag}: Recent applies for this run`);
    const L2 = await list();
    await sendTo(L2.group[0], 'x');
    await js(`new Promise(r=>setTimeout(r,300))`);
    await press('[data-rgidle]');
    for (const k of ['durbar.railOrder', 'durbar.railYouAt', 'durbar.railIdleOpen']) assert.strictEqual(await stored(k), null, `${tag}: not remembering: ${k} is not stored`);
    assert.strictEqual((await list()).flat[tallN], L2.group[0], `${tag}: the send still moved the row for this run`);

    // ---- the narrowest rail ----
    await js(`document.documentElement.style.setProperty('--rail-w','180px')`);
    await ok(`Math.round(document.querySelector('.rail').getBoundingClientRect().width)===180`, `${tag}: rail at 180px`);
    f = await fit('180');
    assert.deepStrictEqual(f.bad, [], `${tag} 180px: rows fit: ${JSON.stringify(f.bad)}`);
    assert.ok(f.minFont >= 10.5 && !f.sideways && !f.rail, `${tag} 180px: text at least 10.5px, no sideways scroll`);
    const c180 = await js(`(()=>{const b=[...document.querySelectorAll('.rail-order button')].map(x=>x.getBoundingClientRect()),r=document.querySelector('.rail-order').getBoundingClientRect(),t=document.querySelector('.rail-top').getBoundingClientRect();return {over:b[0].right>b[1].left+0.5||b[1].right>r.right+0.5||b[0].left<r.left-0.5,w:b.map(x=>Math.round(x.width)),top:r.top>=t.bottom-0.5,cut:[...document.querySelectorAll('.rail-order button')].some(x=>x.scrollWidth>x.clientWidth+1)}})()`);
    assert.ok(!c180.over && c180.top && !c180.cut, `${tag} 180px: the control fits its row (${JSON.stringify(c180)})`);
    await js(`document.documentElement.style.removeProperty('--rail-w')`);
  }

  // ---- FR-043: same-name folders, long names, a secret-shaped name ----
  {
    const [w, h] = SIZES[0], tag = `${w}x${h} alike`;
    await H.load({ w, h, query: { railstore: '1', simstarted: String(STARTED), simrooms: 'solo', simnames: 'alike' }, focus: true });
    await H.needFocus(tag);
    await js(`localStorage.setItem('durbar.railOrder','recent');0`);
    await H.load({ w, h, query: { railstore: '1', simstarted: String(STARTED), simrooms: 'solo', simnames: 'alike' }, focus: true });
    await H.needFocus(tag);
    await js(`document.querySelector('#stage .desk[data-id]').click()`);
    await ok(`document.body.classList.contains('panel-open')&&document.querySelectorAll('#stripList .sitem').length>=15`, `${tag}: a chat opens`, 15000);
    await ok(`document.querySelector('[data-rorder=recent]').getAttribute('aria-pressed')==='true'`, `${tag}: Recent from storage`);
    await press('[data-rgidle]');
    await ok(`document.querySelector('[data-rgidle]').getAttribute('aria-expanded')==='true'`, `${tag}: the group is open`);
    const rows = await js(`[...document.querySelectorAll('#stripList .sitem')].map(r=>{return {id:r.dataset.sw,name:${ROOMNAME}(r.dataset.sw),text:r.querySelector('.sfold').textContent,par:(r.querySelector('.sfp')||{textContent:''}).textContent,tip:r.dataset.tip,aria:r.getAttribute('aria-label'),w:r.querySelector('.sfold').getBoundingClientRect().width}})`);
    const portals = rows.filter((r) => r.name === 'iot-portal');
    assert.ok(portals.length >= 2, `${tag}: the simulator has two folders named iot-portal`);
    assert.strictEqual(new Set(portals.map((r) => r.text)).size, portals.length, `${tag}: same-name folders read differently (${JSON.stringify(portals.map((r) => r.text))})`);
    assert.ok(portals.every((r) => /^(acme|globex)\/iot-portal$/.test(r.text)), `${tag}: parent/name (${JSON.stringify(portals.map((r) => r.text))})`);
    assert.ok(portals.every((r) => /Folder: ~\/clients\/(acme|globex)\/iot-portal/.test(r.tip)), `${tag}: the tooltip has the full path (${JSON.stringify(portals.map((r) => r.tip))})`);
    const unique = rows.find((r) => r.name === 'itdse-ism-portal');
    assert.ok(unique && !unique.par, `${tag}: a folder with a unique name shows no parent`);
    const f23 = rows.filter((r) => /^iot-platform-form-[23]$/.test(r.name));
    assert.strictEqual(f23.length, 2, `${tag}: both iot-platform-form folders are listed`);
    assert.ok(f23.every((r) => /form-[23]$/.test(r.text)) || f23.every((r) => r.text.length >= 6), `${tag}: the tail of a long name stays`);
    assert.strictEqual(new Set(f23.map((r) => r.text)).size, 2, `${tag}: iot-platform-form-2 and -3 do not read the same (${JSON.stringify(f23.map((r) => r.text))})`);
    const tailsOk = await js(`[...document.querySelectorAll('#stripList .sfn .rn-t')].every(t=>t.textContent.length>=6)`);
    assert.ok(tailsOk, `${tag}: a cut name keeps its tail (nameTail)`);
    // a folder named like a secret: masked in the text, the tooltip and the accessible name
    const tok = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
    const id0 = rows[0].id;
    await js(`window.__durbarSimUi.renameRoomElsewhere(window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(id0)}).room,${jsLiteral('proj-' + tok)})`);
    await ok(`document.querySelector('#stripList .sitem[data-sw=${jsLiteral(id0)}] .sfold').textContent.indexOf('proj')>=0`, `${tag}: the renamed folder is painted`);
    const sec = await js(`(()=>{const r=document.querySelector('#stripList .sitem[data-sw=${jsLiteral(id0)}]');return {text:r.textContent,tip:r.dataset.tip,aria:r.getAttribute('aria-label')}})()`);
    for (const [k, v] of Object.entries(sec)) assert.ok(!v.includes(tok) && !v.includes(tok.slice(4, 20)), `${tag}: the secret-shaped folder name is masked in the row's ${k}`);
    assert.ok(/redacted/i.test(sec.text + sec.tip + sec.aria) || sec.text.length > 0, `${tag}: the row still shows a folder text`);
  }

  console.log('check-rail-recent: all checks passed');
  process.exitCode = 0;
};
