/*
 * Check for spec 052 FR-180 (issue #789): the chat header's first row gives the session title (and the line under it) all the width
 * that is free up to the buttons; it is cut with an ellipsis only when the row is really full. Simulator only (no AI credits).
 *
 *   npm run check:ui -- --only check-chat-title
 *
 * At 1440x900 and 1280x800, with `simtitles=long` (a 120-character session title):
 *   1. wide panel (the full-screen chat): if the title or the line under it is cut, no free room is left between it and the next
 *      item on its row (the buttons); the free room is not wasted. The title keeps its full text in `title`;
 *   2. a 480px panel: the title is cut (the row is really full) and nothing in the first row overlaps;
 *   3. (review on PR 796) a title far wider than the row (450 characters), wide and in a 480px panel: the title is cut and the buttons
 *      (`.actions`) stay on the title's row, inside the panel (spec 052 FR-095: the actions never move down).
 * It runs in the default theme, Retro and Corporate (CHAT_TITLE_THEMES=,retro,corporate; `window.THEME.setTheme`).
 * A miss prints DRIVER FAILED (Electron still exits 0), so the npm script exits non-zero unless "all checks passed" is printed.
 */
const { helpers, jsLiteral } = require('./driver-helpers');
const assert = require('assert');
module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const SPARE = 24; /* room left to the next item that still counts as "full" (the row gap is 12px) */
  const measure = () => js(`(()=>{
    const R=e=>e.getBoundingClientRect(), top=document.querySelector('#panelHead .ph-top'), id=top.querySelector('.ph-id');
    const h=document.getElementById('panelTitle'), sub=id.querySelector('.sub'), ir=R(id), kids=[...top.children].filter(e=>e.getClientRects().length);
    const next=kids.filter(e=>e!==id&&R(e).left>=ir.right-1&&R(e).top<ir.bottom&&R(e).bottom>ir.top).map(e=>R(e).left);
    const stop=next.length?Math.min(...next):R(top).right;
    const cut=e=>!!e&&e.scrollWidth>e.clientWidth+1;
    const over=[];for(let i=0;i<kids.length;i++)for(let j=i+1;j<kids.length;j++){const a=R(kids[i]),b=R(kids[j]);
      if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>0.5&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>0.5)over.push((kids[i].className||kids[i].id)+' x '+(kids[j].className||kids[j].id));}
    const act=top.querySelector('.actions'),ar=act&&R(act),pr=R(document.getElementById('panel'));
    return {idTop:Math.round(ir.top),actTop:ar?Math.round(ar.top):null,actRight:ar?Math.round(ar.right):null,panelRight:Math.round(pr.right),titleCut:cut(h),subCut:cut(sub),free:Math.round(stop-ir.right),w:Math.round(ir.width),ttl:(h.getAttribute('title')||''),text:h.textContent.length,over}})()`);
  const THEMES = (process.env.CHAT_TITLE_THEMES || ',retro,corporate').split(',');
  for (const [w, h, theme] of [[1440, 900], [1280, 800]].flatMap(([a, b]) => THEMES.map((t) => [a, b, t]))) {
    const at = `${w}x${h}${theme ? ' ' + theme : ''}`;
    await H.load({ w, h, query: { simtitles: 'long' }, ready: 'fit' });
    if (theme) { await js(`window.THEME.setTheme(${jsLiteral(theme)})`); await settle(); }
    const o = await H.openSimAgent(`a=>!a.parent`, '#panelTitle');
    assert.ok(o.ok, `${at}: a chat is open: ${JSON.stringify({ id: o.id })}`);
    await settle();
    const m1 = await measure();
    assert.ok(m1.ttl.length > 40 && m1.text > 40, `${at}: the title is long (else this proves nothing): ${JSON.stringify(m1)}`);
    assert.ok(!m1.titleCut || m1.free < SPARE, `${at} wide: the title is cut while ${m1.free}px are free: ${JSON.stringify(m1)}`);
    assert.ok(!m1.subCut || m1.free < SPARE, `${at} wide: the line under the title is cut while ${m1.free}px are free: ${JSON.stringify(m1)}`);
    assert.ok(m1.w >= 300, `${at} wide: the title block is not squeezed to ${m1.w}px by the chips row (review on PR 796): ${JSON.stringify(m1)}`);
    assert.deepStrictEqual(m1.over, [], `${at} wide: nothing in the first row overlaps: ${JSON.stringify(m1)}`);
    await js(`(()=>{const s=document.createElement('style');s.id='narrowPanel';s.textContent='#panel{flex:0 0 480px!important;max-width:480px!important}';document.head.append(s);})()`);
    assert.ok(await until(`document.getElementById('panel').getBoundingClientRect().width<=481`), `${at}: the panel is 480px`);
    await settle();
    const m2 = await measure();
    assert.ok(m2.titleCut, `${at} 480px: the long title is cut (the row is full): ${JSON.stringify(m2)}`);
    assert.ok(m2.ttl === m1.ttl && m2.ttl.length > 40, `${at} 480px: the full title stays in its tooltip: ${JSON.stringify(m2)}`);
    assert.deepStrictEqual(m2.over, [], `${at} 480px: nothing in the first row overlaps: ${JSON.stringify(m2)}`);
    /* 3. a title far wider than the row: the buttons stay on its row */
    const wideLong = async (label) => {
      await js(`(()=>{const h=document.getElementById('panelTitle');h.firstChild.textContent=Array.from({length:60},(_,i)=>'Quarterly-planning-item-'+i).join(' ').slice(0,450);})()`);
      await settle();
      const m = await measure();
      assert.ok(m.titleCut, `${at} ${label}: the 450-character title is cut: ${JSON.stringify(m)}`);
      assert.ok(m.actTop !== null && Math.abs(m.actTop - m.idTop) <= 4, `${at} ${label}: the buttons share the title's row (id top ${m.idTop}, buttons top ${m.actTop}): ${JSON.stringify(m)}`);
      assert.ok(m.actRight <= m.panelRight + 1, `${at} ${label}: the buttons are inside the panel: ${JSON.stringify(m)}`);
      assert.deepStrictEqual(m.over, [], `${at} ${label}: nothing in the first row overlaps: ${JSON.stringify(m)}`);
    };
    await wideLong('480px');
    await js(`document.getElementById('narrowPanel').remove()`);
    assert.ok(await until(`document.getElementById('panel').getBoundingClientRect().width>600`), `${at}: the panel is wide again`);
    await settle();
    await wideLong('wide');
    console.log('[chat-title]', at, 'ok', JSON.stringify({ wide: m1, narrow: m2 }));
  }
  console.log('[chat-title] all checks passed');
};
