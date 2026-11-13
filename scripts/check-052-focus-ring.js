/*
 * Spec 052 FR-052 (issue #1615): the keyboard focus ring of every control in the top bar, and of the items of its ⋯ menu, reads at 3:1 against the pixels beside it
 * (WCAG 2.4.11 / 1.4.11), in the looks where `themes.css` gives the top bar a fixed ring colour: the Flat office under the built-in retro theme, the user-theme
 * fixture whose ui is retro (scripts/fixtures/themes/check-user.json), the arcade world; Photo and the dark fixture (ui clean) are the controls. Simulator only
 * (DURBAR_SIM=15, frozen), no AI credits. Run: `npm run check:ui -- --only check-052-focus-ring`.
 *
 * Per look, at 1440x900 and 1280x800: a Tab key press puts the page in keyboard modality, then each visible focusable of the top bar (and, with the ⋯ menu open, each of its
 * items) is focused, the window is captured (`capturePage`, real pixels), and the ring is read from the picture: its own colour at the middle of its band on the element's
 * top edge, the pixel just outside the band and the first pixel past its inner edge. An outside ring (outline-offset > 0) is judged by the first only (its inner side is the control's own 1px border line), an inset ring (offset <= 0) by both: each must be >= 3:1 against the ring; the ring pixel must also be
 * the computed outline colour (a guard on the geometry). The halo box-shadow is not counted (the outline alone). FOCUS_NO_TAB=1 sends no Tab (dies at the Tab label). FOCUS_MUTANT=old puts main's rule back (yellow over the whole bar, the segment rules deleted); =menu gives the menu items the yellow back; =seg gives the segment buttons the yellow back. Each fails with its own element names. FOCUS_REPORT=1 does not assert and writes every line to
 * $OUT/focus-report.txt. OUT=dir (optional) also saves focus-<look>-<size>-<element>.png of the elements that fail or are named in FOCUS_SHOTS (comma list of ids).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { helpers, jsLiteral, CHECK_DARK } = require('./driver-helpers');
const OUT = process.env.OUT || require('os').tmpdir();
const CHECK_USER = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'themes', 'check-user.json'), 'utf8'));
const SHOTS = new Set((process.env.FOCUS_SHOTS || '').split(',').filter(Boolean));

const LOOKS = [
  ['flat+pixel theme', {}, 'retro'],
  ['check-user (retro ui)', {}, CHECK_USER],
  ['arcade', { officeview: 'real', world: 'retro', worldflags: 'retro' }, null, 'print'], // printed, not asserted: its pressed segment is a dark ring on yellow on a dark strip (issue #1615 files it apart)
  ['photo', { officeview: 'real' }, null], // control: ui is clean
  ['dark fixture', {}, CHECK_DARK], // control: ui is clean
];
const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const rgbOf = (s) => (String(s).match(/[\d.]+/g) || []).slice(0, 3).map(Number);

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  /* a colour as the page paints it (canvas turns oklab(), color(srgb ...) into bytes) */
  const INSTALL_PX = `window.__px=(()=>{const cv=document.createElement('canvas');cv.width=cv.height=1;const g=cv.getContext('2d',{willReadFrequently:true});
    return c=>{g.clearRect(0,0,1,1);g.fillStyle='#000';g.fillStyle=c;g.fillRect(0,0,1,1);const d=g.getImageData(0,0,1,1).data;return [d[0],d[1],d[2],d[3]]}})();0`;
  /* FOCUS_MUTANT=old: main's rule (yellow over the whole bar, no segment rules); =menu: the menu items back to yellow; =seg: the segment buttons back to yellow */
  const mutate = (kind) => js(`(()=>{let n=0;const kind=${jsLiteral(kind)};for(const s of document.styleSheets){let rules;try{rules=s.cssRules}catch(e){continue}
    for(let i=rules.length-1;i>=0;i--){const t=rules[i].selectorText||'';
      if(/\\.topbar \\.seg button(\\[aria-pressed="true"\\])?:focus-visible/.test(t)){if(kind==='old'){s.deleteRule(i);n++}continue}
      if(!/\\.topbar :focus-visible/.test(t))continue;const body=rules[i].style.cssText;s.deleteRule(i);
      s.insertRule('html[data-ui="retro"] .topbar :focus-visible'+(kind==='menu'?':not(.seg button)':kind==='seg'?':not(.more-menu *)':'')+'{'+body+'}',i);n++}
    if(kind==='seg'){s.insertRule('html[data-ui="retro"] .topbar .seg button:focus-visible{outline-color:#ffec27}',s.cssRules.length);n++}}return n})()`);
  const pixel = async (img, x, y) => { const { width, height } = img.getSize(); x = Math.max(0, Math.min(width - 1, x)); y = Math.max(0, Math.min(height - 1, y)); const b = img.toBitmap(); const o = (y * width + x) * 4; return [b[o + 2], b[o + 1], b[o]]; }; // BGRA
  const lines = [];
  const fails = [];
  for (const [look, query, theme, mode] of LOOKS) {
    for (const [w, h] of [[1440, 900], [1280, 800]]) {
      const tag = `${look} ${w}x${h}`;
      await H.load({ w, h, query, settle: false, ready: query.officeview ? `!!document.querySelector('#stage .ro .ro-plate')` : undefined });
      if (theme) await js(`window.THEME.setTheme(${jsLiteral(theme)})`);
      await H.settle();
      await js(INSTALL_PX);
      /* the focusables of the bar (menu = false) or of the open ⋯ menu (true), found again by position each time (a chip may be redrawn between two reads) */
      await js(`window.__list=()=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'};
        return window.__fm?[...document.querySelectorAll('#topMoreMenu button.more-it, #topMoreMenu input')].filter(vis)
          :[...document.querySelectorAll('.topbar button, .topbar select, .topbar a[href], .topbar input')].filter(e=>vis(e)&&!e.closest('#topMoreMenu'))};window.__pick=()=>window.__list()[window.__fn];0`);
      if (process.env.FOCUS_MUTANT) console.log(`[focus] mutant ${process.env.FOCUS_MUTANT}: changed ${await mutate(process.env.FOCUS_MUTANT)} rule(s)`);
      const dpr = await js(`window.devicePixelRatio`);
      // keyboard modality: :focus-visible matches on a script focus() only after a key press. sendInputEvent returns before the page handles the key, so wait until the Tab has moved focus: a late Tab would move focus off control 0 after the first focus() below (#1651). FOCUS_NO_TAB=1 (mutant) sends none.
      if (!process.env.FOCUS_NO_TAB) await H.key('Tab');
      assert.ok(await until(`!!document.activeElement&&document.activeElement!==document.body`, 3000), `${tag}: the Tab key press did not move focus off the body: the key event was not handled in 3000 ms`);
      for (const menu of [false, true]) {
        if (menu) {
          await js(`document.getElementById('topMoreBtn').focus()`); await H.key('Down');
          assert.ok(await until(`!document.getElementById('topMoreMenu').hidden`, 5000), `${tag}: the ⋯ menu opened`);
        }
        await js(`window.__fm=${jsLiteral(menu)};0`);
        const count = await js(`window.__list().length`);
        assert.ok(count >= (menu ? 3 : 8), `${tag}: ${count} focusables found ${menu ? 'in the ⋯ menu' : 'in the bar'}`);
        for (let n = 0; n < count; n++) {
          await js(`window.__fn=${n};0`);
          const id = await js(`(()=>{const e=window.__pick();return (e.id||String(e.className)||e.tagName).replace(/\\W+/g,'-').slice(0,30)})()`);
          await js(`window.__pick().focus()`);
          assert.ok(await until(`window.__pick().matches(':focus-visible')`, 2000), `${tag}: ${id} is focus-visible`);
          // capturePage can return an older frame (the previous control's ring, a frame inside the 0.12s transition of .btn,.more-it): wait two animation frames and the transition, and retake while the ring pixel is not the computed outline colour, bounded (the ratio is never retried)
          let m, img, rp, po, pi, oc, geo = false;
          for (let attempt = 0; attempt <= 6 && !geo; attempt++) {
            await js(`new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))`);
            await new Promise((r) => setTimeout(r, attempt ? 200 : 150));
            m = await js(`(()=>{const e=window.__pick(),s=getComputedStyle(e),r=e.getBoundingClientRect();return {x:r.left+r.width/2,top:r.top,left:r.left,oc:s.outlineColor,ow:parseFloat(s.outlineWidth),oo:parseFloat(s.outlineOffset),os:s.outlineStyle,txt:(e.textContent||e.getAttribute('aria-label')||'').trim().slice(0,18)}})()`);
            img = await H.wc().capturePage();
            const k = dpr || 1, X = Math.round(m.x * k);
            const yRing = Math.round((m.top - m.oo - m.ow / 2) * k), yOut = Math.round((m.top - m.oo - m.ow) * k) - 2, yIn = Math.round((m.top - m.oo) * k);
            rp = await pixel(img, X, yRing); po = await pixel(img, X, yOut); pi = await pixel(img, X, yIn);
            oc = (await js(`window.__px(${jsLiteral(m.oc)})`)).slice(0, 3);
            geo = Math.max(...rp.map((v, i) => Math.abs(v - oc[i]))) <= 12;
          }
          // an outside ring (offset > 0) is read against what is behind it only: its inner side is the control's own 1px border or shadow line, never a surface; an inset ring has both neighbours
          const ro = ratio(rp, po), ri = ratio(rp, pi), min = m.oo > 0 ? ro : Math.min(ro, ri);
          const line = `${tag} ${menu ? 'menu' : 'bar'} ${id} "${m.txt}": ring rgb(${rp}) (outline rgb(${oc}), ${m.ow}px at ${m.oo}), outside rgb(${po}) ${ro.toFixed(2)}:1, inside rgb(${pi}) ${ri.toFixed(2)}:1${geo ? '' : ' [ring pixel is not the outline colour: geometry guard]'}`;
          lines.push(line);
          const bad = m.os === 'none' || !geo || min < 3;
          if (bad && mode !== 'print') fails.push(`${tag} ${id} "${m.txt}": min ${min.toFixed(2)}:1`);
          if ((bad && mode !== 'print') || SHOTS.has(id) || SHOTS.has(`${menu ? 'menu' : 'bar'}${n}`)) await H.shot(path.join(OUT, `focus-${look.replace(/\W+/g, '-')}-${w}x${h}-${menu ? 'menu' : 'bar'}${n}-${id}.png`), { prep: 'none', settle: false, tag: 'focus' });
        }
        if (menu) { await H.key('Escape'); await until(`document.getElementById('topMoreMenu').hidden`, 3000); }
      }
    }
  }
  fs.writeFileSync(path.join(OUT, 'focus-report.txt'), lines.join('\n') + '\n');
  if (process.env.FOCUS_REPORT) { console.log(`[focus] ${lines.length} lines, ${fails.length} below 3:1 (report only)`); throw new Error('FOCUS_REPORT: failing on purpose; lines in focus-report.txt'); }
  for (const l of lines) console.log('[focus] ' + l);
  assert.deepStrictEqual(fails, [], `focus ring below 3:1 (or not the outline colour): ${fails.slice(0, 6).join('; ')}`);
  console.log('[focus] all checks passed');
};
