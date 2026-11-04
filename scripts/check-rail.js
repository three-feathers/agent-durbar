/*
 * Spec 005 FR-190, FR-194, FR-195, FR-197, FR-216 (tasks T113..T115, T134) and spec 052 FR-215, FR-216 (T222): the agent rail's List view.
 * Simulator only (no AI credits, no agent app).
 *
 *   npm run check:ui -- --only check-rail
 *
 * At 1440x900 and 1280x800, 15 agents, with a chat open:
 *   - fit: the rail is a 220px column on the left, full height under the notice bar; no strip; the chat header starts at the rail's top; all
 *     15 main agents are rows, the same list as the office; no page overflow; the rail scrolls at most 34px at 1280 and not at 1440 (FR-195);
 *     every text in the rail at least 10.5px; the measured chat column is printed (RAIL lines).
 *   - order (FR-194): folders with someone needing you first, then the office's room order; inside a folder whoever needs you first; after a
 *     request arrives in a quiet folder it moves up, and after it is answered it goes back.
 *   - two row heights only, 30 and 52px (T115): tall for whoever needs you; with the clock 25 minutes on, the ages say so and no row changes
 *     height or place; two lines of a request fit unclipped; text on tall rows at 4.5:1 in the default, Retro and a dark user theme.
 *   - folders collapse (FR-216): Enter and Space on the heading, a real click, a real double click (once, and no chat opens); a collapsed
 *     folder keeps its count and a needs-you mark with its number (live, 1 included), says when the open chat is in it, and its focused
 *     heading keeps the focus when the folder moves; the state survives switching chats and a status change; opening a chat
 *     in a collapsed folder (from the office) expands it; a long folder name is cut with an ellipsis and keeps its title; nothing is saved
 *     while rememberOn() is off (the simulator), and with railstore=1 the state is saved by folder path and comes back after a reload.
 *   - Your door (052 FR-216): its count is the Needs you count; it opens the queue and Escape gives the focus back.
 *   - Mac (052 FR-215): with data-platform="darwin" the rail's top row and the chat header are drag areas, their controls are not, and the
 *     top row keeps 78px for the traffic lights.
 * Every wait is until() and its result is asserted.
 */
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');
const path = require('path');
const OUT = process.env.OUT || require('os').tmpdir();

process.exitCode = 1;
const DARK = { id: 'rail-night', name: 'Night (rail check)', extends: 'clean-office', tokens: { '--bg': '#14171c', '--surface': '#1d2127', '--surface-2': '#262b33', '--raised': '#22272e', '--card': '#1d2127', '--soft': '#20252c', '--note': '#2a2f37', '--warn-bg': '#3a3020', '--card-waiting': '#2a2112', '--card-waiting-line': '#7a5a1e', '--card-error': '#2c1518', '--card-error-line': '#7a3a38', '--line': '#3a414c', '--line-2': '#4b5361', '--line-ctl': '#5a6372', '--ink': '#e8eaee', '--ink-2': '#c4c9d1', '--muted': '#9aa2ae', '--blue-ink': '#8fb8ff', '--amber-ink': '#f0c36a', '--red-ink': '#ff9a8f' } };

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const wc = ctx.win.webContents;
  const ok = async (expr, what, ms) => assert.ok(await until(expr, ms || 8000), what);
  const emit = (id, e) => js(`window.__durbarSimEmit(Object.assign({timestamp:Date.now(),sessionId:${jsLiteral(id)}},${jsLiteral(e)}))`);
  const rows = () => js(`[...document.querySelectorAll('#stripList .rgrp')].map(g=>({key:g.dataset.key.slice(3),open:g.querySelector('.rg-h').getAttribute('aria-expanded')==='true',ids:[...g.querySelectorAll('.sitem')].map(r=>({id:r.dataset.sw,tall:r.classList.contains('tall')}))}))`);
  const heights = () => js(`Object.fromEntries([...document.querySelectorAll('#stripList .sitem')].filter(r=>r.getClientRects().length).map(r=>[r.dataset.sw,+r.getBoundingClientRect().height.toFixed(1)]))`);
  /* page helpers, set again after every load: a folder's heading and a session's row, looked up by value */
  const railHelpers = () => js(`window.__rail={head:k=>document.querySelector('#stripList .rgrp[data-key="rg:'+CSS.escape(k)+'"] .rg-h'),row:id=>document.querySelector('#stripList .sitem[data-sw="'+CSS.escape(id)+'"]')};0`);
  const headQ = (room) => '__rail.head(' + jsLiteral(room) + ')';
  const expanded = (room) => js(`__rail.head(${jsLiteral(room)}).getAttribute('aria-expanded')`);
  const selected = () => js(`(document.querySelector('#stripList .sitem.sel')||{dataset:{}}).dataset.sw||''`);
  const center = (q) => js('(()=>{const e=' + q + ';if(!e)return null;const b=e.getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}})()');
  /* real input (FR-045 note in agent-notes: el.click() has detail 0 like a key) */
  const mouse = async (q, clicks) => {
    const p = await center(q); assert.ok(p, 'there is something to click: ' + q);
    wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
    for (let c = 1; c <= clicks; c++) { wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: c }); wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: c }); }
  };
  /* counts aria-expanded flips on a heading and whether a dblclick arrived, so a double click is read after it has fully happened */
  const watch = (room) => js(`(()=>{window.__flips=0;window.__dbl=0;window.__c2=0;const h=__rail.head(${jsLiteral(room)});if(window.__mo)window.__mo.disconnect();window.__mo=new MutationObserver(m=>{window.__flips+=m.filter(x=>x.attributeName==='aria-expanded').length;});window.__mo.observe(h.closest('.rgrp'),{attributes:true,subtree:true,attributeFilter:['aria-expanded']});if(!window.__dblOn){window.__dblOn=1;document.addEventListener('dblclick',()=>{window.__dbl++;},true);document.addEventListener('click',e=>{if(e.detail>=2)window.__c2++;},true);}})()`);
  const contrast = () => js(`(()=>{
    const lin=c=>{c/=255;return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);};
    const parse=s=>{let m=s.match(/rgba?\\(([^)]+)\\)/);if(m){const p=m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number);return [p[0],p[1],p[2],p.length>3?p[3]:1];}
      m=s.match(/color\\(srgb ([^)]+)\\)/);if(m){const p=m[1].split(/[ \\/]+/).filter(Boolean).map(Number);return [p[0]*255,p[1]*255,p[2]*255,p.length>3?p[3]:1];}return null;};
    const L=c=>0.2126*lin(c[0])+0.7152*lin(c[1])+0.0722*lin(c[2]);
    const bgOf=e=>{for(let n=e;n;n=n.parentElement){const c=parse(getComputedStyle(n).backgroundColor);if(c&&c[3]>0.99)return c;}return [255,255,255,1];};
    const out=[];
    document.querySelectorAll('#stripList .sitem.tall').forEach(r=>{const bg=bgOf(r);r.querySelectorAll('b,.sage,.sreq').forEach(t=>{const c=parse(getComputedStyle(t).color);if(!c)return;const a=L(c),b=L(bg);out.push({id:r.dataset.sw,el:t.className||t.tagName,ratio:+((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)).toFixed(2)});});});
    return out;})()`);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${w}x${h}`;
    await H.load({ w, h });
    await H.calm({ blur: true });
    await railHelpers();
    assert.strictEqual(await js(`localStorage.getItem('durbar.railFolds')`), null, `${tag}: nothing saved at start`);
    const first = 'sim-1';
    await js(`document.querySelector('#stage .desk[data-id="sim-1"]').click()`);
    await ok(`document.body.classList.contains('panel-open')&&!!document.querySelector('#panel .rail #stripList .sitem.sel')`, `${tag}: the chat opens with the rail`);
    await H.settle();

    // ---- fit (FR-190, FR-195) ----
    const fit = await js(`(()=>{const r=document.querySelector('#panel>.rail').getBoundingClientRect(),pi=document.querySelector('#panel>.panel-in').getBoundingClientRect(),hd=document.getElementById('panelHead').getBoundingClientRect(),c=document.getElementById('chat').getBoundingClientRect(),l=document.getElementById('stripList'),se=document.scrollingElement;
      const small=[...document.querySelectorAll('.rail *')].filter(e=>e.getClientRects().length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).map(e=>parseFloat(getComputedStyle(e).fontSize)).filter(s=>s<10.5);
      return {rail:{x:r.left,y:r.top,w:r.width,bottom:r.bottom},panelX:pi.left,headY:hd.top,log:Math.round(c.height),logW:Math.round(c.width),share:Math.round(100*c.height/innerHeight),strip:!!document.querySelector('.strip,.strip-list'),
        scroll:l.scrollHeight-l.clientHeight,rows:document.querySelectorAll('#stripList .sitem').length,nav:(document.querySelector('nav.rail')||{}).getAttribute&&document.querySelector('nav.rail').getAttribute('aria-label'),
        over:se.scrollHeight>innerHeight||se.scrollWidth>innerWidth,railOver:document.querySelector('.rail').scrollWidth>document.querySelector('.rail').clientWidth+1,small:small.length,
        header:Math.round(hd.height),composer:Math.round(document.querySelector('.composer').getBoundingClientRect().height),notice:[...document.querySelectorAll('.notice-strip')].filter(n=>!n.hidden&&n.getClientRects().length).reduce((s,n)=>s+n.getBoundingClientRect().height,0)}})()`);
    console.log(`RAIL ${tag} ${JSON.stringify(fit)}`);
    assert.ok(!fit.strip, `${tag}: the strip is gone`);
    assert.strictEqual(fit.nav, 'Agents', `${tag}: a nav named Agents`);
    // heading outline (FR-216 item 1): h1 > h2 Agents (visually hidden, first in the nav) > h3 per folder
    const outline = await js(`(()=>{const n=document.querySelector('#panel nav.rail'),hs=[...n.querySelectorAll('h1,h2,h3,h4,h5,h6')],h2=hs[0],b=h2&&h2.getBoundingClientRect();return {first:h2?h2.tagName+':'+h2.textContent.trim():'',h2s:hs.filter(h=>h.tagName==='H2').length,rest:[...new Set(hs.slice(1).map(h=>h.tagName))],folders:n.querySelectorAll('.rg-h').length,inH3:[...n.querySelectorAll('.rg-h')].every(x=>x.parentElement.tagName==='H3'),seen:!!b&&b.width>1&&b.height>1}})()`);
    assert.ok(outline.first === 'H2:Agents' && outline.h2s === 1 && outline.folders > 0 && outline.inH3 && JSON.stringify(outline.rest) === '["H3"]', `${tag}: the rail's headings are an h2 Agents then one h3 per folder: ${JSON.stringify(outline)}`);
    assert.ok(!outline.seen, `${tag}: the h2 Agents is visually hidden: ${JSON.stringify(outline)}`);
    assert.ok(fit.rail.x === 0 && fit.rail.w === 220 && Math.abs(fit.rail.bottom - h) < 1, `${tag}: the rail is a 220px column on the left, to the bottom: ${JSON.stringify(fit.rail)}`);
    assert.ok(Math.abs(fit.rail.y - fit.notice) < 1 && Math.abs(fit.headY - fit.rail.y) < 1, `${tag}: the rail and the chat header start under the notice bar, nothing above the header: ${JSON.stringify(fit)}`);
    assert.strictEqual(fit.panelX, 220, `${tag}: the chat starts right of the rail`);
    const officeN = await js(`window.__durbarSimUi.agents().filter(a=>!a.parent).length`);
    assert.strictEqual(fit.rows, officeN, `${tag}: every main agent is a row (${fit.rows} of ${officeN})`);
    assert.ok(!fit.over && !fit.railOver, `${tag}: no page or rail overflow`);
    assert.strictEqual(fit.small, 0, `${tag}: rail text at least 10.5px`);
    assert.ok(fit.scroll <= (w === 1280 ? 34 : 0), `${tag}: the rail scrolls ${fit.scroll}px (at most ${w === 1280 ? 34 : 0})`);
    // the same without the notice bar (052 FR-218 removes it): the rail does not scroll at either size
    // one synchronous task: hide the bars, lay out, measure, show them again (layout is read synchronously, nothing repaints in between)
    const bare = await js(`(()=>{const ns=[...document.querySelectorAll('.notice-strip')].filter(n=>!n.hidden);ns.forEach(n=>{n.hidden=true;});const l=document.getElementById('stripList');const o={top:document.querySelector('#panel>.rail').getBoundingClientRect().top,scroll:l.scrollHeight-l.clientHeight,log:Math.round(document.getElementById('chat').getBoundingClientRect().height)};ns.forEach(n=>{n.hidden=false;});return o;})()`);
    assert.strictEqual(bare.top, 0, `${tag}: with the notice bar hidden the rail starts at the top`);
    console.log(`RAIL_NOTICE ${tag} without the notice bar: ${JSON.stringify(bare)}`);
    assert.strictEqual(bare.scroll, 0, `${tag}: without the notice bar the rail does not scroll`);

    // ---- order (FR-194) ----
    const roomOrder = await js(`[...document.querySelectorAll('#stage .room[data-key^="room:"]')].map(r=>r.dataset.key.slice(5))`);
    const checkOrder = (gs, what) => {
      const needN = gs.map((g) => g.ids.filter((r) => r.tall).length);
      const firstQuiet = needN.indexOf(0);
      assert.ok(firstQuiet < 0 || needN.slice(firstQuiet).every((n) => n === 0), `${tag} ${what}: folders with someone needing you come first: ${JSON.stringify(needN)}`);
      const quiet = gs.filter((g, i) => needN[i] === 0).map((g) => roomOrder.indexOf(g.key));
      assert.deepStrictEqual(quiet, [...quiet].sort((a, b) => a - b), `${tag} ${what}: the other folders in the office's order`);
      for (const g of gs) { const t = g.ids.map((r) => r.tall); assert.ok(t.indexOf(false) < 0 || t.slice(t.indexOf(false)).every((x) => !x), `${tag} ${what}: in ${g.key} whoever needs you comes first`); }
    };
    let gs = await rows();
    assert.ok(gs.length >= 3, `${tag}: several folders`);
    checkOrder(gs, 'at start');
    const quietG = [...gs].reverse().find((g) => g.ids.every((r) => !r.tall) && g.ids.length >= 2);
    assert.ok(quietG, `${tag}: a folder where nobody needs you`);
    const asker = quietG.ids[quietG.ids.length - 1].id;
    const before = gs.map((g) => g.key).indexOf(quietG.key);
    await emit(asker, { type: 'status', status: 'needs-permission', intent: 'Waiting for permission: run ls' });
    await ok(`(()=>{const r=__rail.row(${jsLiteral(asker)});return !!r&&r.classList.contains('tall')&&r.parentElement.firstElementChild===r})()`, `${tag}: ${asker} asks: a tall row, first in its folder`);
    gs = await rows();
    checkOrder(gs, 'after a request');
    assert.ok(gs.map((g) => g.key).indexOf(quietG.key) < before, `${tag}: its folder moved up`);
    assert.ok(/, waiting [^:]*: .+\. Open chat\.$/.test(await js(`__rail.row(${jsLiteral(asker)}).getAttribute('aria-label')`)), `${tag}: the tall row says who, how long and what, then Open chat`);
    await emit(asker, { type: 'status', status: 'working', intent: 'Working' });
    await ok(`!__rail.row(${jsLiteral(asker)}).classList.contains('tall')`, `${tag}: answered: a plain row again`);
    gs = await rows();
    checkOrder(gs, 'after the answer');
    assert.strictEqual(gs.map((g) => g.key).indexOf(quietG.key), before, `${tag}: its folder is back in its place`);

    // ---- markup in a name or a request stays text (FR-197: names and tall rows escape what they show) ----
    {
      const NAME = '<b>N</b><img src=x>', LIT = '<i>x</i><img src=x> "q" &amp;', REQ = 'Waiting for permission: ' + LIT; // a quote and an entity too: an unescaped attribute breaks on them
      assert.ok(await js(`window.__durbarSimUi.renamedElsewhere(${jsLiteral(asker)},${jsLiteral(NAME)})`), `${tag}: ${asker} renamed`);
      await emit(asker, { type: 'status', status: 'needs-permission', intent: REQ });
      await ok(`(()=>{const r=__rail.row(${jsLiteral(asker)});return !!r&&r.classList.contains('tall')&&r.querySelector('.stop b').textContent.startsWith(${jsLiteral(NAME)})})()`, `${tag}: the renamed asker is a tall row`);
      const e = await js(`(()=>{const r=__rail.row(${jsLiteral(asker)}),q=r.querySelector('.sreq'),b=r.querySelector('.stop b');return {img:!!r.querySelector('img,i'),nameKids:[...b.children].filter(c=>/^(B|IMG)$/.test(c.tagName)).length,req:q.textContent,reqKids:q.children.length,label:r.getAttribute('aria-label'),title:r.title}})()`);
      assert.ok(!e.img && e.nameKids === 0 && e.reqKids === 0, `${tag}: no markup became elements in the row: ${JSON.stringify(e)}`);
      assert.ok(e.req.includes(LIT), `${tag}: the request is shown as text: ${e.req}`);
      assert.ok(e.label.startsWith(NAME) && e.label.includes(LIT) && e.title.includes(NAME) && e.title.includes(LIT), `${tag}: the name and title carry the literal text: ${JSON.stringify(e)}`);
      await emit(asker, { type: 'status', status: 'working', intent: 'Working' });
      await js(`window.__durbarSimUi.renamedElsewhere(${jsLiteral(asker)},'')`);
      await ok(`!__rail.row(${jsLiteral(asker)}).classList.contains('tall')`, `${tag}: back to a plain row`);
    }
    // ---- the focused row keeps the keyboard focus when its folder moves (morphHTML re-inserts the folder) ----
    {
      await H.focusPage();
      gs = await rows();
      const mover = gs.map((g, i) => ({ g, i })).reverse().find(({ g, i }) => i > 0 && g.ids.length >= 2 && g.ids.every((r) => !r.tall) && gs[i - 1].ids.every((r) => !r.tall)); // the folder above is quiet too, so asking moves it up
      assert.ok(mover, `${tag}: a quiet folder that can move up`);
      const keep = mover.g.ids[0].id, sib = mover.g.ids[1].id;
      await js(`__rail.row(${jsLiteral(keep)}).focus()`);
      await ok(`document.activeElement===__rail.row(${jsLiteral(keep)})`, `${tag}: ${keep}'s row has the focus`);
      await emit(sib, { type: 'status', status: 'needs-permission', intent: 'Waiting for permission: run ls' });
      await ok(`__rail.row(${jsLiteral(sib)}).classList.contains('tall')`, `${tag}: ${sib} asks`);
      assert.ok((await rows()).map((g) => g.key).indexOf(mover.g.key) < mover.i, `${tag}: the folder moved up`);
      assert.ok(await js(`document.activeElement===__rail.row(${jsLiteral(keep)})`), `${tag}: the focus stayed on ${keep}'s row after its folder moved`);
      await emit(sib, { type: 'status', status: 'working', intent: 'Working' });
      await ok(`!__rail.row(${jsLiteral(sib)}).classList.contains('tall')`, `${tag}: ${sib} answered`);
    }
    // ---- a collapsed quiet folder: a request shows the needs-you mark at 1, live; the folder moves up and its focused heading keeps the focus ----
    {
      await H.focusPage();
      gs = await rows();
      const mover = gs.map((g, i) => ({ g, i })).reverse().find(({ g, i }) => i > 0 && g.ids.length >= 2 && g.ids.every((r) => !r.tall && r.id !== first) && gs[i - 1].ids.every((r) => !r.tall));
      assert.ok(mover, `${tag}: a quiet folder without the open chat that can move up`);
      const k = mover.g.key, n = mover.g.ids.length, sib = mover.g.ids[1].id;
      await js(`__rail.head(${jsLiteral(k)}).click()`);
      await ok(`__rail.head(${jsLiteral(k)}).getAttribute('aria-expanded')==='false'`, `${tag}: ${k} collapsed`);
      assert.ok(!(await js(`!!__rail.head(${jsLiteral(k)}).querySelector('.rg-need')`)), `${tag}: a quiet collapsed folder has no needs-you mark`);
      await js(`__rail.head(${jsLiteral(k)}).focus()`);
      await ok(`document.activeElement===__rail.head(${jsLiteral(k)})`, `${tag}: ${k}'s heading has the focus`);
      await emit(sib, { type: 'status', status: 'needs-permission', intent: 'Waiting for permission: run ls' });
      await ok(`(()=>{const m=__rail.head(${jsLiteral(k)}).querySelector('.rg-need');return !!m&&m.textContent.trim()==='1'})()`, `${tag}: live, the collapsed folder's needs-you mark shows 1`);
      assert.ok(new RegExp(`: ${n} sessions, 1 needs you$`).test(await js(`__rail.head(${jsLiteral(k)}).getAttribute('aria-label')`)), `${tag}: the heading's name says 1 needs you`);
      assert.ok((await rows()).map((g) => g.key).indexOf(k) < mover.i, `${tag}: the collapsed folder moved up`);
      assert.ok(await js(`document.activeElement===__rail.head(${jsLiteral(k)})`), `${tag}: the focus stayed on ${k}'s heading after its folder moved`);
      await emit(sib, { type: 'status', status: 'working', intent: 'Working' });
      await ok(`!__rail.head(${jsLiteral(k)}).querySelector('.rg-need')`, `${tag}: answered, the mark is gone`);
      await js(`__rail.head(${jsLiteral(k)}).click()`);
      await ok(`__rail.head(${jsLiteral(k)}).getAttribute('aria-expanded')==='true'`, `${tag}: ${k} expanded again`);
    }

    // ---- two heights, never by time (T115) ----
    const h0 = await heights();
    const set = [...new Set(Object.values(h0))].sort((a, b) => a - b);
    assert.deepStrictEqual(set, [30, 52], `${tag}: exactly two row heights: ${JSON.stringify(set)}`);
    const clip = await js(`[...document.querySelectorAll('#stripList .sitem.tall .sreq')].map(e=>({id:e.closest('.sitem').dataset.sw,lines:Math.round(e.getBoundingClientRect().height/parseFloat(getComputedStyle(e).lineHeight)),in:e.getBoundingClientRect().bottom<=e.closest('.sitem').getBoundingClientRect().bottom-1}))`);
    assert.ok(clip.length && clip.every((c) => c.in && c.lines <= 2), `${tag}: a request shows up to two lines, inside its row: ${JSON.stringify(clip)}`);
    const order0 = JSON.stringify(await rows());
    const age0 = await js(`[...document.querySelectorAll('#stripList .sage')].map(e=>e.textContent).join('|')`);
    assert.ok(/Waiting/.test(age0), `${tag}: ages in words: ${age0}`);
    await js(`(()=>{if(!window.__realNow){window.__realNow=Date.now;}const R=window.__realNow;Date.now=()=>R()+25*60000;window.__durbarSimUi.render();})()`);
    await ok(`[...document.querySelectorAll('#stripList .sage')].some(e=>/2[4-6] min/.test(e.textContent))`, `${tag}: 25 minutes on, the ages say so`);
    assert.deepStrictEqual(await heights(), h0, `${tag}: no row changed height with time`);
    assert.strictEqual(JSON.stringify(await rows()), order0, `${tag}: no row moved with time`);
    await js(`Date.now=window.__realNow;window.__durbarSimUi.render()`);
    for (const theme of ['default', 'retro', 'dark']) {
      if (theme === 'retro') await js(`window.THEME.setTheme('retro')`);
      if (theme === 'dark') await js(`window.THEME.setTheme(${jsLiteral(DARK)})`);
      await H.settle();
      const cs = await contrast();
      assert.ok(cs.length >= 3 && cs.every((c) => c.ratio >= 4.5), `${tag} ${theme}: text on tall rows at 4.5:1: ${JSON.stringify(cs.filter((c) => c.ratio < 4.5).slice(0, 4))} (${cs.length} read)`);
      console.log(`RAIL ${tag} contrast ${theme}: min ${Math.min(...cs.map((c) => c.ratio))}`);
    }
    await js(`window.THEME.setTheme('clean-office')`);

    // ---- collapse and expand (FR-216) ----
    gs = await rows();
    const selRoom = gs.find((g) => g.ids.some((r) => r.id === first)).key;
    const needG = gs.find((g) => g.key !== selRoom && g.ids.some((r) => r.tall));
    assert.ok(needG, `${tag}: a folder with someone needing you, not the open chat's`);
    const needN = needG.ids.filter((r) => r.tall).length;
    // the open chat's folder, collapsed, says the open chat is in it (FR-216 item 5)
    await js(`__rail.head(${jsLiteral(selRoom)}).click()`);
    await ok(`__rail.head(${jsLiteral(selRoom)}).getAttribute('aria-expanded')==='false'`, `${tag}: the open chat's folder collapses`);
    const here = await js(`(()=>{const h=__rail.head(${jsLiteral(selRoom)});return {sel:h.classList.contains('has-sel'),label:h.getAttribute('aria-label')}})()`);
    assert.ok(here.sel && /, the open chat is here$/.test(here.label), `${tag}: collapsed, the open chat's folder is marked and says the open chat is here: ${JSON.stringify(here)}`);
    await js(`__rail.head(${jsLiteral(selRoom)}).click()`);
    await ok(`__rail.head(${jsLiteral(selRoom)}).getAttribute('aria-expanded')==='true'&&!__rail.head(${jsLiteral(selRoom)}).classList.contains('has-sel')`, `${tag}: expanded, no open-chat mark`);
    // keyboard: Enter collapses, Space expands
    await H.focusPage();
    await js(`__rail.head(${jsLiteral(needG.key)}).focus()`);
    await ok(`document.activeElement===__rail.head(${jsLiteral(needG.key)})`, `${tag}: the heading takes the focus`);
    await H.key('Enter');
    await ok(`__rail.head(${jsLiteral(needG.key)}).getAttribute('aria-expanded')==='false'&&__rail.head(${jsLiteral(needG.key)}).closest('.rgrp').querySelector('.rg-rows').hidden`, `${tag}: Enter collapses ${needG.key}`);
    const shut = await js(`(()=>{const h=__rail.head(${jsLiteral(needG.key)}),m=h.querySelector('.rg-need'),c=h.querySelector('.rg-c');return {focus:document.activeElement===h,mark:!!m&&m.getClientRects().length>0&&m.getBoundingClientRect().width>0,markText:m?m.textContent.trim():'',markFont:m?parseFloat(getComputedStyle(m).fontSize):0,count:c?c.textContent.trim():'',countShown:!!c&&c.getBoundingClientRect().width>0,label:h.getAttribute('aria-label'),rows:h.closest('.rgrp').querySelectorAll('.sitem').length,shown:[...h.closest('.rgrp').querySelectorAll('.sitem')].filter(r=>r.getClientRects().length).length}})()`);
    assert.ok(shut.focus, `${tag}: the focus stays on the heading`);
    assert.ok(shut.mark && shut.markText === String(needN) && shut.markFont >= 10.5, `${tag}: collapsed, the needs-you mark shows ${needN}: ${JSON.stringify(shut)}`);
    assert.ok(shut.countShown && shut.count === String(needG.ids.length), `${tag}: collapsed, the count shows: ${JSON.stringify(shut)}`);
    assert.ok(new RegExp(`${needG.ids.length} sessions, ${needN} needs? you`).test(shut.label), `${tag}: the heading's name says the count and who needs you: ${shut.label}`);
    assert.strictEqual(shut.shown, 0, `${tag}: its rows are hidden`);
    await H.key('Space', [], { char: 'always' });
    await ok(`__rail.head(${jsLiteral(needG.key)}).getAttribute('aria-expanded')==='true'`, `${tag}: Space expands it`);
    assert.ok(!(await js(`!!__rail.head(${jsLiteral(needG.key)}).querySelector('.rg-need')`)), `${tag}: expanded, the tall rows say it, no mark`);
    // a real click toggles
    await watch(needG.key);
    await mouse(headQ(needG.key), 1);
    await ok(`window.__flips>=1`, `${tag}: a click collapses`);
    assert.strictEqual(await expanded(needG.key), 'false', `${tag}: collapsed by a click`);
    // a real double click toggles once and opens no chat
    const sel0 = await selected();
    const title0 = await H.text('#panelTitle', 'textContent');
    await watch(needG.key);
    await mouse(headQ(needG.key), 2);
    await ok(`window.__c2>=1`, `${tag}: the second click arrives`);
    assert.strictEqual(await selected(), sel0, `${tag}: a double click on a heading opens no chat`);
    assert.strictEqual(await H.text('#panelTitle', 'textContent'), title0, `${tag}: the same chat stays open`);
    await ok(`window.__dbl>=1`, `${tag}: the double click arrives`);
    assert.strictEqual(await js('window.__flips'), 1, `${tag}: a double click toggles once`);
    assert.strictEqual(await expanded(needG.key), 'true', `${tag}: expanded by the double click`);
    // kept across a chat switch and a status change; nothing saved in the simulator (rememberOn() is off)
    await js(`__rail.head(${jsLiteral(needG.key)}).click()`);
    await ok(`__rail.head(${jsLiteral(needG.key)}).getAttribute('aria-expanded')==='false'`, `${tag}: collapsed again`);
    const other = gs.find((g) => g.key !== needG.key && g.key !== selRoom);
    const otherId = other.ids[0].id;
    await js(`__rail.row(${jsLiteral(otherId)}).click()`);
    await ok(`(document.querySelector('#stripList .sitem.sel')||{dataset:{}}).dataset.sw===${jsLiteral(otherId)}`, `${tag}: another chat opens from the rail`);
    assert.strictEqual(await expanded(needG.key), 'false', `${tag}: the folder stays collapsed after a chat switch`);
    await emit(otherId, { type: 'status', status: 'working', intent: 'Still working' });
    await emit(otherId, { type: 'status', status: 'idle' });
    await ok(`(()=>{const r=__rail.row(${jsLiteral(otherId)});return !!r&&(r.classList.contains('st-idle')||r.classList.contains('st-done'))})()`, `${tag}: a status change repaints the rail`);
    assert.strictEqual(await expanded(needG.key), 'false', `${tag}: and the folder stays collapsed`);
    assert.strictEqual(await js(`localStorage.getItem('durbar.railFolds')`), null, `${tag}: nothing saved while rememberOn() is off`);
    // opening a chat in a collapsed folder, from the office, expands it and shows its row
    const inside = needG.ids[needG.ids.length - 1].id;
    await H.key('Escape');
    await ok(`!document.body.classList.contains('panel-open')`, `${tag}: back to the office`);
    await js(`document.querySelector('#stage .desk[data-id="'+CSS.escape(${jsLiteral(inside)})+'"]').click()`);
    await ok(`(document.querySelector('#stripList .sitem.sel')||{dataset:{}}).dataset.sw===${jsLiteral(inside)}`, `${tag}: ${inside}'s chat opens`);
    assert.strictEqual(await expanded(needG.key), 'true', `${tag}: opening a chat expands its folder`);
    assert.ok(await js(`(()=>{const r=document.querySelector('#stripList .sitem.sel'),l=document.getElementById('stripList');const a=r.getBoundingClientRect(),b=l.getBoundingClientRect();return r.getClientRects().length>0&&a.top>=b.top-1&&a.bottom<=b.bottom+1})()`), `${tag}: and its row is in view`);
    // ---- the picture for the docs (features.md): a collapsed folder with its count and needs-you mark, 1440x900 ----
    if (w === 1440) {
      const cg = (await rows()).find((g) => g.ids.some((r) => r.tall) && !g.ids.some((r) => r.id === inside)) || (await rows()).find((g) => !g.ids.some((r) => r.id === inside));
      await js(`__rail.head(${jsLiteral(cg.key)}).click()`);
      await ok(`__rail.head(${jsLiteral(cg.key)}).getAttribute('aria-expanded')==='false'`, `${tag}: a folder collapsed for the picture`);
      await js(`(()=>{const l=document.getElementById('stripList');l.scrollTop=0;})()`);
      await H.shot(path.join(OUT, '005-rail-collapsed-1440x900.png'), { prep: 'calm', blur: true, tag: 'rail' });
      await js(`__rail.head(${jsLiteral(cg.key)}).click()`);
      await ok(`__rail.head(${jsLiteral(cg.key)}).getAttribute('aria-expanded')==='true'`, `${tag}: expanded again after the picture`);
    }

    // a long folder name: ellipsis, title, no overflow
    const long = '<i>x</i>&amp;' + 'a-very-long-folder-name-that-goes-on-and-on-'.repeat(3); // markup in a name stays text
    assert.ok(await js(`window.__durbarSimUi.renameRoomElsewhere(${jsLiteral(needG.key)},${jsLiteral(long)})`), `${tag}: the folder is renamed`);
    await ok(`__rail.head(${jsLiteral(needG.key)}).title===${jsLiteral(long)}`, `${tag}: the long name is in the heading's title`);
    const ln = await js(`(()=>{const h=__rail.head(${jsLiteral(needG.key)}),n=h.querySelector('.rg-n');const cs=getComputedStyle(n);return {cut:n.scrollWidth>n.clientWidth,ell:cs.textOverflow,font:parseFloat(cs.fontSize),over:document.querySelector('.rail').scrollWidth>document.querySelector('.rail').clientWidth+1,text:n.textContent,markup:!!h.querySelector('i')}})()`);
    assert.ok(ln.cut && ln.ell === 'ellipsis' && ln.font >= 10.5 && !ln.over, `${tag}: a long name is cut with an ellipsis: ${JSON.stringify(ln)}`);
    assert.ok(ln.text === long && !ln.markup, `${tag}: a folder name with markup is shown as text: ${JSON.stringify(ln.text.slice(0, 30))}`);

    // ---- a double click on the last heading of a scrolled rail opens no chat (the first click collapses it and moves rows under the pointer) ----
    {
      await js(`document.querySelectorAll('#stripList .rg-h[aria-expanded="false"]').forEach(h=>h.click())`);
      await ok(`!document.querySelector('#stripList .rg-h[aria-expanded="false"]')`, `${tag}: every folder open`);
      ctx.win.setContentSize(w, h - 250); // a shorter window, so the rail scrolls whatever the statuses are now
      await ok(`(()=>{const l=document.getElementById('stripList');return l.scrollHeight-l.clientHeight>40})()`, `${tag}: the rail scrolls in a shorter window`);
      await js(`(()=>{const l=document.getElementById('stripList');l.scrollTop=l.scrollHeight;})()`);
      await ok(`(()=>{const l=document.getElementById('stripList');return l.scrollTop>0&&l.scrollTop>=l.scrollHeight-l.clientHeight-1})()`, `${tag}: the rail is scrolled to its end`);
      const lastKey = await js(`[...document.querySelectorAll('#stripList .rgrp')].pop().dataset.key.slice(3)`);
      const s0 = await selected(), t0 = await H.text('#panelTitle', 'textContent');
      await watch(lastKey);
      await mouse(headQ(lastKey), 2);
      await ok(`window.__c2>=1`, `${tag}: the second click of the double click arrives`);
      assert.strictEqual(await selected(), s0, `${tag}: a double click on the last heading of a scrolled rail opens no chat`);
      assert.strictEqual(await H.text('#panelTitle', 'textContent'), t0, `${tag}: the same chat stays open`);
      if (await expanded(lastKey) === 'false') { await js(`__rail.head(${jsLiteral(lastKey)}).click()`); await ok(`__rail.head(${jsLiteral(lastKey)}).getAttribute('aria-expanded')==='true'`, `${tag}: expanded again`); }
      ctx.win.setContentSize(w, h);
      await ok(`innerHeight===${h}`, `${tag}: the window is back to its size`);
    }

    // ---- Your door (052 FR-216) ----
    const door = await js(`(()=>{const b=document.getElementById('railDoor');return {n:+b.querySelector('b').textContent,need:window.__durbarSimUi.needsCount(),label:b.getAttribute('aria-label'),text:b.innerText.replace(/\\s+/g,' ').trim()}})()`);
    assert.ok(door.n === door.need && /^Your door \d+$/.test(door.text) && new RegExp(`^Your door: ${door.need} agents? needs? you`).test(door.label), `${tag}: Your door shows the Needs you count: ${JSON.stringify(door)}`);
    await js(`document.getElementById('railDoor').focus()`);
    await H.key('Enter');
    await ok(`!!document.getElementById('inboxDlg')`, `${tag}: Your door opens the Needs you queue`);
    await H.key('Escape');
    await ok(`!document.getElementById('inboxDlg')&&document.activeElement===document.getElementById('railDoor')`, `${tag}: Escape closes it and the focus comes back to Your door`);

    // ---- Mac drag areas (052 FR-215) ----
    const mac = await js(`(()=>{const root=document.documentElement,was=root.dataset.platform;root.dataset.platform='darwin';const r=s=>{const e=document.querySelector(s);return e?getComputedStyle(e).webkitAppRegion||getComputedStyle(e).getPropertyValue('-webkit-app-region'):'none';};
      const o={top:r('.rail-top'),office:r('#backBtn'),head:r('#panelHead'),title:r('#panelTitle'),more:r('#moreBtn'),list:r('#stripList'),row:r('#stripList .sitem'),pad:getComputedStyle(document.querySelector('.rail-top')).paddingLeft};
      if(was===undefined)delete root.dataset.platform;else root.dataset.platform=was;return o;})()`);
    assert.ok(mac.top === 'drag' && mac.head === 'drag' && mac.office === 'no-drag' && mac.title === 'no-drag' && mac.more === 'no-drag' && mac.list !== 'drag' && mac.row !== 'drag' && mac.pad === '8px', `${tag}: Mac drag areas: ${JSON.stringify(mac)}`);
    const macNoNotice = await js(`(()=>{const root=document.documentElement,was=root.dataset.platform;root.dataset.platform='darwin';const ns=[...document.querySelectorAll('.notice-strip')].filter(n=>!n.hidden);ns.forEach(n=>n.hidden=true);const p=getComputedStyle(document.querySelector('.rail-top')).paddingLeft;ns.forEach(n=>n.hidden=false);if(was===undefined)delete root.dataset.platform;else root.dataset.platform=was;return p;})()`);
    assert.strictEqual(macNoNotice, '78px', `${tag}: Mac: with no notice bar the top row keeps 78px for the traffic lights`);
    await H.key('Escape');
    await ok(`!document.body.classList.contains('panel-open')`, `${tag}: chat closed`);
  }

  // ---- saved by folder path with railstore=1, back after a reload (FR-216) ----
  await H.load({ w: 1280, h: 800, query: { railstore: '1' } });
  await railHelpers();
  await js(`document.querySelector('#stage .desk[data-id="sim-1"]').click()`);
  await ok(`!!document.querySelector('#stripList .sitem.sel')`, 'railstore: a chat opens');
  const g = (await rows()).find((x) => !x.ids.some((r) => r.id === 'sim-1'));
  const cwd = await js(`(window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(g.ids[0].id)})||{}).cwd||''`);
  await js(`__rail.head(${jsLiteral(g.key)}).click()`);
  await ok(`__rail.head(${jsLiteral(g.key)}).getAttribute('aria-expanded')==='false'`, 'railstore: collapsed');
  const saved = JSON.parse(await js(`localStorage.getItem('durbar.railFolds')`) || 'null');
  assert.ok(saved && saved.v === 1 && Array.isArray(saved.closed) && saved.closed.length === 1 && typeof saved.closed[0] === 'string' && !/sim-/.test(saved.closed[0]), `railstore: saved as one folder path: ${JSON.stringify(saved)}`);
  if (cwd) assert.ok(saved.closed[0] === cwd || cwd.startsWith(saved.closed[0]) || saved.closed[0].endsWith(cwd.split(/[\\/]/).pop()), `railstore: the saved key is the folder's path: ${saved.closed[0]} vs ${cwd}`);
  await H.load({ w: 1280, h: 800, query: { railstore: '1' } });
  await railHelpers();
  await js(`document.querySelector('#stage .desk[data-id="sim-1"]').click()`);
  await ok(`!!document.querySelector('#stripList .sitem.sel')`, 'railstore: after a reload a chat opens');
  assert.strictEqual(await expanded(g.key), 'false', 'railstore: the folder is still collapsed after a reload');
  await js(`__rail.head(${jsLiteral(g.key)}).click()`);
  await ok(`localStorage.getItem('durbar.railFolds')===null`, 'railstore: nothing collapsed: the key is removed');

  process.exitCode = 0;
  console.log('check-rail: OK');
};
