/*
 * Spec 001 FR-182..FR-184 (issues #812, #813): List columns follow their content; the room's bottom wall is whole; the room header's
 * pencil is only an icon. Simulator only (no AI credits). Linux with xvfb-run:
 *
 *   npm run check:listcols
 *
 * List, at 1440x900, 1280x800, 1024x700 and the window's minimum (640x480), 15 agents: the page has no horizontal scroll and no row
 * sticks out of the list; text is at least 10.5px; Agent app, Active, Usage and Status stay within their caps and the Agent app column
 * is narrower than Agent and Folder (the report that started this); at the two big sizes only Current task is cut; every cell carries
 * its full text in its tooltip (the existing `title`) and the row's accessible name keeps the full role, folder and task; a role that
 * starts with the agent app ("Copilot (no prompts) · gpt-5") shows without it; a long name is cut with its whole text in the tooltip and
 * the accessible name; sorting and J/K are unchanged. Office, at both big sizes, Clean Office and Retro: no room paints an ::after notch,
 * the header pencil has no background at rest and gets one on hover and on keyboard focus (24px target and a focus ring kept), and sits
 * on the name's line. Every wait is until(); a miss prints DRIVER FAILED (Electron still exits 0), so the npm script exits non-zero
 * unless "all checks passed" is printed.
 */
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');
const LONG = 'ayudame a renombrar el registro de herramientas y a documentar cada paso del cambio';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const ok = async (expr, what, ms) => assert.ok(await until(expr, ms || 8000), what);
  const toList = async () => {
    await js(`document.getElementById('vList').click()`);
    await ok(`document.querySelectorAll('#list button.lrow').length>=15`, 'List shows the 15 agents');
    await H.settle();
  };
  const cells = `(()=>{const rows=[...document.querySelectorAll('#list button.lrow')];return rows.map(r=>({id:r.dataset.id,sub:!!r.querySelector('.lnm.sub'),label:r.getAttribute('aria-label'),
    c:[...r.children].map(c=>({t:(c.querySelector('.lnm')||c).textContent.replace(/\\s+/g,' ').trim(),title:(c.querySelector('.lnm')||c).title||c.title||'',w:Math.round(c.getBoundingClientRect().width),cut:c.scrollWidth>c.clientWidth+1,
      hidden:getComputedStyle(c).display==='none',fs:parseFloat(getComputedStyle(c).fontSize)}))}))})()`;

  for (const [w, h, big] of [[1440, 900, true], [1280, 800, true], [1024, 700, false], [640, 480, false]]) {
    const tag = `${w}x${h}`;
    await H.load({ w, h });
    await H.calm({ blur: true });
    // an agent app in the role, and a long name, so the cases are not vacuous (the simulator's roles do not carry the app word)
    await js(`(()=>{const a=window.__durbarSimUi.agents().filter(x=>!x.parent);a[0].role='Copilot (no prompts) · gpt-5.2';a[0].name=${jsLiteral(LONG)};a[1].role='Copilot (asks first)';window.__durbarSimUi.crew.renderAll();})()`);
    const ids = await js(`window.__durbarSimUi.agents().filter(x=>!x.parent).slice(0,2).map(x=>x.id)`);
    await toList();
    await ok(`[...document.querySelectorAll('#list .lnm')].some(e=>e.textContent.trim()===${jsLiteral(LONG)})`, `${tag}: the long name is drawn`);
    const rows = await js(cells);
    const head = await js(`[...document.querySelectorAll('#list .lhead>span')].map(s=>({t:s.textContent.replace(/[▲▼↕]/g,'').trim(),hidden:getComputedStyle(s).display==='none',fs:parseFloat(getComputedStyle(s.querySelector('.lsort')).fontSize)}))`);
    assert.strictEqual(head.length, 8, `${tag}: eight headers`);

    // no horizontal scroll, nothing sticks out
    const box = await js(`(()=>{const l=document.getElementById('list'),wr=document.querySelector('#list .list-wrap').getBoundingClientRect();return {sw:l.scrollWidth,cw:l.clientWidth,out:[...document.querySelectorAll('#list .lrow')].filter(r=>r.getBoundingClientRect().right>wr.right+1).length}})()`);
    assert.ok(box.sw <= box.cw, `${tag}: the List has no horizontal scroll (${box.sw} > ${box.cw})`);
    assert.strictEqual(box.out, 0, `${tag}: no row sticks out of the list`);

    // text floor
    const small = rows.flatMap((r) => r.c.filter((c) => !c.hidden && c.fs < 10.5)).length + head.filter((x) => !x.hidden && x.fs < 10.5).length;
    assert.strictEqual(small, 0, `${tag}: no List text under 10.5px`);

    // 15 agents are all there; columns shown at this width
    assert.ok(rows.filter((r) => !r.sub).length === 15 || rows.length >= 15, `${tag}: the agents are listed`);
    const main = rows.find((r) => r.c[0].t === LONG), second = rows.find((r) => r.id === ids[1]);
    assert.ok(main && second, `${tag}: the two edited agents are listed`);
    // Role does not repeat the agent app
    assert.strictEqual(main.c[1].t, 'Copilot', `${tag}: Agent app says Copilot`);
    assert.ok(main.c[2].t === 'no prompts · gpt-5.2' && main.c[2].title === 'Copilot (no prompts) · gpt-5.2', `${tag}: Role without the app: "${main.c[2].t}" (tooltip "${main.c[2].title}")`);
    assert.strictEqual(second.c[2].t, 'asks first', `${tag}: a role with only a mode`);
    assert.ok(rows.every((r) => !/^Copilot/.test(r.c[2].t)), `${tag}: no Role starts with the agent app`);

    const shown = (i) => !main.c[i].hidden;
    if (w >= 1024) assert.ok([0, 1, 2, 3, 4, 5, 6, 7].every(shown), `${tag}: all eight columns show`);
    else assert.ok([0, 1, 4, 5, 6, 7].every(shown) && !shown(2) && !shown(3), `${tag}: Role and Folder give way, the other six stay`);
    assert.strictEqual(head.filter((x) => x.hidden).length, w >= 1024 ? 0 : 2, `${tag}: the headers of the hidden columns go with them`);

    // caps: the short columns fit their content (header included) up to a cap; Agent app is not wider than Agent
    const CAP = { 1: 150, 5: 84, 6: 110, 7: 130 };
    for (const r of rows) for (const [i, cap] of Object.entries(CAP)) if (shown(+i)) assert.ok(r.c[i].w <= cap, `${tag}: column ${i} is ${r.c[i].w}px, cap ${cap}px`);
    assert.ok(main.c[1].w < main.c[0].w, `${tag}: Agent app (${main.c[1].w}px) is narrower than Agent (${main.c[0].w}px)`);
    if (shown(3)) assert.ok(main.c[1].w < main.c[3].w, `${tag}: Agent app is narrower than Folder`);
    if (big) {
      assert.ok(main.c[0].w >= 170 && main.c[3].w >= 130, `${tag}: Agent and Folder keep their larger minimum (${main.c[0].w}, ${main.c[3].w})`);
      assert.ok(main.c[4].w > main.c[0].w, `${tag}: Current task takes what is left`);
      const cutOthers = rows.flatMap((r) => r.c.map((c, i) => (c.cut && ![0, 4].includes(i) ? `${r.id}:${i}` : null)).filter(Boolean));
      assert.deepStrictEqual(cutOthers, [], `${tag}: only Agent (the long name) and Current task are cut, not ${cutOthers.join(',')}`);
    }

    // every cell carries its full text in the tooltip, cut or not
    for (const r of rows) r.c.forEach((c, i) => {
      if (c.hidden || !c.t || i === 7) return;
      const want = i === 4 ? c.t.replace(/^.*? · /, '') : c.t; // the task cell starts with the mood words, the tooltip has them as a sentence
      assert.ok(c.title.replace(/ · /g, '. ').includes(want.replace(/ · /g, '. ')) || c.title.includes(want) || c.title.replace(/[()]/g, '').includes(want), `${tag}: row ${r.id} column ${i}: tooltip "${c.title}" lacks "${want}"`);
    });
    const cutCells = rows.flatMap((r) => r.c.filter((c) => c.cut));
    assert.ok(cutCells.length > 0, `${tag}: some cell is cut, so the tooltip case is not vacuous`);
    // the accessible name keeps the whole text, whatever column is shown
    const roleOf = await js(`(()=>{const a=window.__durbarSimUi.agents().filter(x=>!x.parent);return [a[0].role,a[1].role]})()`);
    assert.ok(main.label.includes(LONG) && main.label.includes(roleOf[0]), `${tag}: the row's name keeps the long name and the whole role: ${main.label}`);
    assert.ok(main.label.includes(main.c[3].t) && main.label.includes(main.c[4].t.replace(/^.*? · /, '')), `${tag}: the row's name keeps the folder and the task`);

    // sorting and J/K are unchanged
    await js(`document.querySelector('#list [data-lsort="name"]').click()`);
    await ok(`document.querySelector('#list [aria-sort="ascending"]')`, `${tag}: a header click sorts ascending`);
    await js(`document.querySelector('#list [data-lsort="name"]').click()`);
    await ok(`document.querySelector('#list [aria-sort="descending"]')`, `${tag}: and then descending`);
    await js(`(()=>{const b=document.querySelectorAll('#list button.lrow');b[0].focus();b[0].dispatchEvent(new KeyboardEvent('keydown',{key:'j',bubbles:true}));})()`);
    await ok(`document.activeElement===document.querySelectorAll('#list button.lrow')[1]`, `${tag}: J moves to the next row`);
    await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'k',bubbles:true}))`);
    await ok(`document.activeElement===document.querySelectorAll('#list button.lrow')[0]`, `${tag}: K moves back`);
    console.log(`[listcols] ${tag} ok`, JSON.stringify(main.c.map((c) => c.hidden ? 0 : c.w)));
  }

  // A column the list is sorted by never gives way (the order would stay while its header and arrow vanished): sort wide, then narrow
  for (const [w, h] of [[900, 700], [640, 480]]) for (const key of ['role', 'folder']) {
    const tag = `${w}x${h} sorted by ${key}`;
    await H.load({ w: 1440, h: 900 });
    await toList();
    await js(`document.querySelector('#list [data-lsort=${jsLiteral(key)}]').click()`);
    await ok(`document.querySelector('#list [aria-sort="ascending"] [data-lsort=${jsLiteral(key)}]')`, `${tag}: sorted`);
    ctx.win.setContentSize(w, h);
    const idx = { role: 2, folder: 3 }[key];
    await ok(`document.getElementById('list').clientWidth<${jsLiteral(w >= 900 ? 900 + 48 : 800)}`, `${tag}: the window narrowed`);
    await ok(`getComputedStyle(document.querySelectorAll('#list .lhead>span')[${jsLiteral(idx)}]).display!=='none'`, `${tag}: the sorted column's header stays`);
    const m = await js(`(()=>{const l=document.getElementById('list');const h=document.querySelectorAll('#list .lhead>span')[${jsLiteral(idx)}];const r=document.querySelector('#list button.lrow');return {sw:l.scrollWidth,cw:l.clientWidth,arrow:h.querySelector('.sarr').textContent,cell:getComputedStyle(r.children[${jsLiteral(idx)}]).display,cellW:Math.round(r.children[${jsLiteral(idx)}].getBoundingClientRect().width),shown:[...document.querySelectorAll('#list .lhead>span')].filter(x=>getComputedStyle(x).display!=='none').length}})()`);
    assert.ok(m.sw <= m.cw, `${tag}: no horizontal scroll (${m.sw} > ${m.cw})`);
    assert.ok(m.arrow === '▲' && m.cell !== 'none' && m.cellW > 0, `${tag}: the arrow and the cells of the sorted column show ${JSON.stringify(m)}`);
    assert.ok(m.shown >= 6 && m.shown <= 7, `${tag}: the other columns still give way (${m.shown} shown)`);
    console.log(`[listcols] ${tag} ok`, JSON.stringify(m));
  }

  // The room: whole bottom wall, a header pencil that is only an icon until hover or focus
  const rect = (sel) => js(`(()=>{const b=document.querySelector(${jsLiteral(sel)}).getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2,w:b.width,h:b.height}})()`);
  const bg = (sel) => js(`getComputedStyle(document.querySelector(${jsLiteral(sel)})).backgroundColor`);
  const SEL = '#stage .room-head>.ren.ren-in';
  await H.load({ w: 1440, h: 900 });
  const themes = await js(`window.THEME.list().map(t=>t.id)`);
  assert.ok(themes.length >= 6, 'the built-in themes are listed');
  for (const theme of themes) for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${theme} ${w}x${h}`;
    await H.load({ w, h, focus: true }); // the page has to own the focus, or :focus and :focus-visible never match
    await js(`window.THEME.setTheme(${jsLiteral(theme)})`);
    await ok(`window.THEME.current().id===${jsLiteral(theme)}`, `${tag}: theme applied`);
    await H.settle();
    const notches = await js(`[...document.querySelectorAll('#stage .room')].filter(r=>getComputedStyle(r,'::after').content!=='none').length`);
    assert.strictEqual(notches, 0, `${tag}: no room paints an ::after notch in its bottom wall`);
    assert.ok(await js(`document.querySelectorAll('#stage .room').length>0`), `${tag}: rooms are drawn`);
    await ok(`!!document.querySelector(${jsLiteral(SEL)})&&getComputedStyle(document.querySelector(${jsLiteral(SEL)})).display!=='none'`, `${tag}: a header pencil shows`);
    await js(`document.activeElement&&document.activeElement.blur();`);
    ctx.win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
    await ok(`getComputedStyle(document.querySelector(${jsLiteral(SEL)})).opacity==='0'`, `${tag}: the pencil rests hidden`);
    const clear = (c) => /^rgba\(\d+, \d+, \d+, 0\)$/.test(c) || c === 'transparent';
    assert.ok(clear(await bg(SEL)), `${tag}: no background at rest: ${await bg(SEL)}`);
    const r = await rect(SEL);
    assert.ok(r.w >= 24 && r.h >= 24, `${tag}: the 24px target is kept (${r.w}x${r.h})`);
    const nm = await rect(`${SEL.replace('>.ren.ren-in', '')} .room-name`);
    assert.ok(Math.abs(nm.y - r.y) <= 3, `${tag}: the pencil sits on the name's line (${r.y} vs ${nm.y})`);
    ctx.win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(r.x), y: Math.round(r.y) });
    await ok(`document.querySelector(${jsLiteral(SEL)}).matches(':hover')&&getComputedStyle(document.querySelector(${jsLiteral(SEL)})).opacity==='1'&&!/, 0\\)$/.test(getComputedStyle(document.querySelector(${jsLiteral(SEL)})).backgroundColor)`, `${tag}: hover shows the icon on a tile`);
    ctx.win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
    await ok(`!document.querySelector(${jsLiteral(SEL)}).matches(':hover')`, `${tag}: the pointer left`);
    // a real Tab from the control before the pencil (a programmatic focus() plus a key press gives no :focus-visible on Windows)
    await js(`(()=>{const T='button,a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])',vis=e=>!e.disabled&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden',all=[...document.querySelectorAll(T)].filter(vis),p=document.querySelector(${jsLiteral(SEL)});window.__prevTab=all[all.indexOf(p)-1];window.__prevTab.focus();})()`);
    await ok(`document.activeElement===window.__prevTab`, `${tag}: the control before the pencil has focus`);
    await H.key('Tab', [], { pause: 100 });
    await ok(`document.activeElement===document.querySelector(${jsLiteral(SEL)})`, `${tag}: Tab reaches the pencil`);
    const st = () => js(`(()=>{const e=document.querySelector(${jsLiteral(SEL)}),s=getComputedStyle(e);return JSON.stringify({pageFocus:document.hasFocus(),active:document.activeElement===e,focus:e.matches(':focus'),fv:e.matches(':focus-visible'),opacity:s.opacity,transition:s.transitionProperty+' '+s.transitionDuration})})()`);
    assert.ok(await until(`document.querySelector(${jsLiteral(SEL)}).matches(':focus-visible')`), `${tag}: Tab gives the pencil :focus-visible ${await st()}`);
    assert.ok(await until(`parseFloat(getComputedStyle(document.querySelector(${jsLiteral(SEL)})).opacity)>=0.99`), `${tag}: the focused pencil is fully shown ${await st()}`);
    const f = await js(`(()=>{const e=document.querySelector(${jsLiteral(SEL)}),s=getComputedStyle(e);return {fv:e.matches(':focus-visible'),bg:s.backgroundColor,op:s.opacity,ow:parseFloat(s.outlineWidth),os:s.outlineStyle}})()`);
    assert.ok(f.fv && f.op === '1' && !clear(f.bg) && f.ow >= 2 && f.os !== 'none', `${tag}: keyboard focus shows a tile, a focus ring and the icon ${JSON.stringify(f)}`);
    console.log(`[listcols] ${tag} room ok`);
  }
  console.log('[listcols] all checks passed');
};
