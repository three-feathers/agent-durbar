/*
 * Check for spec 052 FR-181 (owner, 2026-10-31): the top bar has no Demo / Live badge, in the simulator, in demo mode and
 * with the themes; the cues that remain say it is a demo. Simulator only (no AI credits).
 *
 *   npm run check:ui -- --only check-no-demo-badge
 *
 * At 1440x900 and 1280x800, default theme, Retro:
 *   1. no `#protoBadge` / `.proto` anywhere, and no top bar text "Demo" or "Live" (simulator, demo off);
 *   2. the app name is the brand's only text and is vertically centred on the brand mark;
 *   3. the demo cues remain: the composer hint of a simulator chat says "Demo, no credits used";
 *   4. with demo on: still no badge, the demo item in the more menu is checked and says "Turn off demo", the top bar does not overflow.
 * A miss prints DRIVER FAILED (Electron still exits 0), so the npm script exits non-zero unless "all checks passed" is printed.
 */
const { helpers, jsLiteral } = require('./driver-helpers');
const assert = require('assert');
module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const THEMES = (process.env.NO_BADGE_THEMES || ',retro').split(',');
  const topbar = () => js(`(()=>{const R=e=>e.getBoundingClientRect(),t=document.querySelector('.topbar'),b=t.querySelector('.brand'),h=b.querySelector('h1'),m=b.querySelector('.brand-mark');
    const words=[...t.querySelectorAll('*')].filter(e=>!e.children.length&&/\\b(Demo|Live)\\b/.test(e.textContent)&&e.getClientRects().length&&!e.closest('.more-menu,[hidden]')).map(e=>e.textContent.trim());
    return {badge:!!document.getElementById('protoBadge')||!!document.querySelector('.proto'),words,brandText:b.innerText.trim(),
      dy:Math.abs((R(h).top+R(h).height/2)-(R(m).top+R(m).height/2)),over:t.scrollWidth>t.clientWidth+1,right:Math.round(R(t).right),win:innerWidth}})()`);
  for (const [w, h, theme] of [[1440, 900], [1280, 800]].flatMap(([a, b]) => THEMES.map((t) => [a, b, t]))) {
    const at = `${w}x${h}${theme ? ' ' + theme : ''}`;
    await H.load({ w, h, query: { simquestion: 'compact' }, ready: 'fit' });
    if (theme) { await js(`window.THEME.setTheme(${jsLiteral(theme)})`); await settle(); }
    const a = await topbar();
    assert.ok(!a.badge, `${at} simulator: no badge element: ${JSON.stringify(a)}`);
    assert.deepStrictEqual(a.words, [], `${at} simulator: no Demo or Live word in the top bar: ${JSON.stringify(a)}`);
    assert.strictEqual(a.brandText.toLowerCase(), 'agent durbar', `${at}: the brand holds the app name only: ${JSON.stringify(a)}`);
    assert.ok(a.dy <= 1.5, `${at}: the app name is centred on the mark (off by ${a.dy}px): ${JSON.stringify(a)}`);
    assert.ok(!a.over, `${at}: the top bar does not overflow: ${JSON.stringify(a)}`);
    const o = await H.openSimAgent(`a=>!a.parent`, '#panelTitle');
    assert.ok(o.ok, `${at}: a chat is open`);
    assert.ok(await until(`/Demo, no credits used/.test((document.querySelector('#panel .hint')||{}).textContent||'')`), `${at}: the composer hint still says "Demo, no credits used"`);
    await js(`(()=>{const t=document.getElementById('demoToggle');t.checked=true;t.dispatchEvent(new Event('change'));})()`);
    assert.ok(await until(`document.getElementById('demoWord').textContent==='Turn off demo'`), `${at}: the demo item says "Turn off demo"`);
    const d = await topbar();
    assert.ok(!d.badge && d.words.length === 0, `${at} demo on: no badge, no Demo or Live word: ${JSON.stringify(d)}`);
    assert.ok(await js(`document.getElementById('demoToggle').checked`), `${at} demo on: the demo item is checked`);
    assert.ok(!d.over && d.dy <= 1.5, `${at} demo on: the top bar fits: ${JSON.stringify(d)}`);
    console.log('[no-demo-badge]', at, 'ok');
  }
  console.log('[no-demo-badge] all checks passed');
};
