/*
 * Spec 097 FR-350 (issue #1153): what a theme reaches in Real office, measured on the page's computed styles. Simulator only (DURBAR_SIM=15,
 * frozen), no AI credits; every wait is an until(). Run: `npm run check:ui -- --only check-097-themes` (builds first).
 *   THEMES_DUMP=<file>   write every measurement as JSON (the spec's table comes from it)
 *   THEMES_MUTANT=ink  the check sees the dark pack's ink on a plate (must fail)
 *
 * In the Photo office, the cave (`worldflags=cave`) and the arcade (`worldflags=retro`), at 1440x900, under Clean Office, Retro Pixel, the dark
 * user fixture, Pink Studio and the Retro-style user pack, it fails (exit 1) when:
 *   - the picked theme is not applied (THEME.current().id), or html[data-world|data-ui|data-dark] is not the world's;
 *   - the top bar, a name plate, a lobby plate, a folder sign or a button has a colour, fill or shadow other than the same element under Clean
 *     Office in the same world (a theme colour reached the chrome), or a plate or sign pair is under 4.5:1;
 *   - Pink Studio's own font is not on the plates and signs, or a heading under Retro Pixel is monospace in a world whose data-ui is `clean`
 *     (or not monospace in the arcade, whose data-ui is `retro`);
 *   - a theme's scene word is missing from the lobby plates (Retro Pixel: "Arcade");
 *   - the drop overlay's text is under 4.5:1 on its fill (FR-351: the arcade's was 1.2:1).
 */
const fs = require('fs');
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');

const FX = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'themes', n), 'utf8'));
const MUTANT = process.env.THEMES_MUTANT || '';
const WORLDS = [['photo', {}, 'clean'], ['cave', { world: 'cave', worldflags: 'cave' }, 'clean'], ['retro', { world: 'retro', worldflags: 'retro' }, 'retro']];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const THEMES = { 'clean-office': 'clean-office', retro: 'retro', 'audit-dark': FX('dark-audit.json'), 'ai-pink-studio': FX('pink-studio.json'), 'check-user': FX('check-user.json') };
  const PROBE = `(()=>{
    const P=['backgroundColor','color','fontFamily','fontWeight','borderRadius','boxShadow','borderTopColor'];
    const g=s=>{const e=document.querySelector(s);if(!e)return null;const c=getComputedStyle(e);return Object.fromEntries(P.map(p=>[p,c[p]]));};
    const o={ui:document.documentElement.dataset.ui||'',world:document.documentElement.dataset.world||'',dark:document.documentElement.dataset.dark!==undefined,id:window.THEME.current().id};
    for(const s of ['.topbar','.ro-plate','.ro-lplate','.ro-sign','.ro-stext','.topbar .btn'])o[s]=g(s);
    o.h2scr=(()=>{const d=document.createElement('div');d.className='scr';d.innerHTML='<div class="scr-head"><h2>Heading</h2></div>';document.body.appendChild(d);const c=getComputedStyle(d.querySelector('h2'));const r={fontFamily:c.fontFamily};d.remove();return r;})();
    o.drop=(()=>{const d=document.createElement('div');d.className='drop-ov on';d.innerHTML='<span>Drop</span>';document.body.appendChild(d);const c=getComputedStyle(d);const r={backgroundColor:c.backgroundColor,color:c.color};d.remove();return r;})();
    o.places=[...document.querySelectorAll('.ro-lplate')].map(e=>e.textContent.trim()).slice(0,3);
    return o;})()`;
  const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const out = {};
  for (const [wid, q, wantUi] of WORLDS) {
    for (const [tid, lit] of Object.entries(THEMES)) {
      await H.load({ w: 1440, h: 900, query: { officeview: 'real', ...q }, ready: `!!document.querySelector('#stage .ro .ro-plate')`, settle: false });
      await js(`window.THEME.setTheme(${jsLiteral(lit)})`);
      assert.ok(await H.until(`window.THEME.current().id===${jsLiteral(tid)}&&!!document.querySelector('#stage .ro .ro-plate')`, 15000), `${wid}/${tid}: the theme was applied`);
      if (tid === 'retro') assert.ok(await H.until(`[...document.querySelectorAll('.ro-lplate')].some(e=>/Arcade/.test(e.textContent))`, 15000), `${wid}/${tid}: the lobby shows Retro Pixel's words`);
      await new Promise((r) => setTimeout(r, 600));
      out[`${wid}/${tid}`] = await js(PROBE);
    }
  }
  if (process.env.THEMES_DUMP) fs.writeFileSync(process.env.THEMES_DUMP, JSON.stringify(out, null, 1));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const COLOURS = (e) => e && { backgroundColor: e.backgroundColor, color: e.color, boxShadow: e.boxShadow, borderTopColor: e.borderTopColor };
  for (const [wid, , wantUi] of WORLDS) {
    const base = out[`${wid}/clean-office`];
    for (const tid of Object.keys(THEMES)) {
      const m = out[`${wid}/${tid}`], tag = `${wid}/${tid}`;
      assert.deepStrictEqual([m.world, m.ui, m.dark], [wid, wantUi, wid === 'retro'], `${tag}: data-world, data-ui and the dark flag are the world's`);
      for (const s of ['.topbar', '.ro-plate', '.ro-lplate', '.ro-sign', '.topbar .btn']) {
        assert.ok(m[s], `${tag}: ${s} exists`);
        const a = COLOURS(m[s]), b = COLOURS(base[s]);
        if (MUTANT === 'ink' && tid === 'audit-dark' && s === '.ro-plate') a.color = 'rgb(185, 199, 194)';
        assert.ok(same(a, b), `${tag}: ${s} colours differ from Clean Office's in the same world: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
      }
      assert.ok(ratio(m.drop.color, m.drop.backgroundColor.replace(/rgba\((\d+), (\d+), (\d+), [\d.]+\)/, 'rgb($1, $2, $3)')) >= 4.5, `${tag}: the drop overlay text ${m.drop.color} on ${m.drop.backgroundColor} is under 4.5:1`);
      for (const s of ['.ro-plate', '.ro-lplate', '.ro-sign']) assert.ok(ratio(m[s].color, m[s].backgroundColor) >= 4.5, `${tag}: ${s} text ${m[s].color} on ${m[s].backgroundColor} is under 4.5:1`);
      if (tid === 'ai-pink-studio') for (const s of ['.ro-plate', '.ro-lplate', '.ro-sign', '.topbar']) assert.ok(/Avenir Next/.test(m[s].fontFamily) && m[s].fontWeight !== undefined, `${tag}: Pink Studio's font is on ${s} (${m[s].fontFamily})`);
      else assert.ok(!/Avenir Next/.test(m['.ro-plate'].fontFamily), `${tag}: no Avenir Next without Pink Studio`);
      const mono = /mono/i.test(m.h2scr.fontFamily);
      if (tid === 'ai-pink-studio') assert.ok(/Didot/.test(m.h2scr.fontFamily), `${tag}: the pack's display font is on the heading`);
      else assert.strictEqual(mono, wantUi === 'retro', `${tag}: a settings or dialog heading is monospace only where data-ui is retro (${m.h2scr.fontFamily})`);
      if (tid === 'retro') assert.ok(m.places.some((p) => /Arcade/.test(p)), `${tag}: Retro Pixel's scene word on a lobby plate (${m.places})`);
    }
  }
  console.log('check-097-themes: the world wins every colour under 5 themes in 3 worlds; fonts and words follow the theme; ' + Object.keys(out).length + ' measurements');
};
