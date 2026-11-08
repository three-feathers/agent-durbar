/*
 * Spec 097 FR-350, FR-351 (issue #1153, superseded by worlds; owner 2026-11-08): a world keeps its own colours, and the arcade's drop overlay reads.
 * Simulator only (DURBAR_SIM=15, frozen), no AI credits; every wait is an until(). Run: `npm run check:ui -- --only check-097-world-look`.
 *   WORLD_LOOK_DUMP=<file>   write every measurement as JSON
 *   WORLD_LOOK_MUTANT=ink    the check sees a theme's ink on a plate (must fail)
 *
 * In the Photo office, the cave (`worldflags=cave`) and the arcade (`worldflags=retro`), at 1440x900, with Clean Office, Retro Pixel or the dark
 * user fixture picked, it fails (exit 1) when:
 *   - html[data-world|data-ui|data-dark] is not the world's;
 *   - the top bar, a name plate, a lobby plate, a folder sign or a bar button has a fill, ink, shadow or border other than the same element
 *     under Clean Office in the same world (a theme colour reached the world's chrome, FR-130), or a plate or sign pair is under 4.5:1;
 *   - the drop overlay's text is under 4.5:1 on its fill (FR-351: the arcade's was 1.2:1).
 */
const fs = require('fs');
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');

const FX = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'themes', n), 'utf8'));
const MUTANT = process.env.WORLD_LOOK_MUTANT || '';
const WORLDS = [['photo', {}, 'clean'], ['cave', { world: 'cave', worldflags: 'cave' }, 'clean'], ['retro', { world: 'retro', worldflags: 'retro' }, 'retro']];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const THEMES = { 'clean-office': 'clean-office', retro: 'retro', 'audit-dark': FX('dark-audit.json') };
  const PROBE = `(()=>{
    const P=['backgroundColor','color','fontFamily','fontWeight','borderRadius','boxShadow','borderTopColor'];
    const g=s=>{const e=document.querySelector(s);if(!e)return null;const c=getComputedStyle(e);return Object.fromEntries(P.map(p=>[p,c[p]]));};
    const o={ui:document.documentElement.dataset.ui||'',world:document.documentElement.dataset.world||'',dark:document.documentElement.dataset.dark!==undefined,id:window.THEME.current().id};
    for(const s of ['.topbar','.ro-plate','.ro-lplate','.ro-sign','.ro-stext','.topbar .btn'])o[s]=g(s);
    o.drop=(()=>{const d=document.createElement('div');d.className='drop-ov on';d.innerHTML='<span>Drop</span>';document.body.appendChild(d);const c=getComputedStyle(d);const r={backgroundColor:c.backgroundColor,color:c.color};d.remove();return r;})();
    return o;})()`;
  const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const out = {};
  for (const [wid, q, wantUi] of WORLDS) {
    for (const [tid, lit] of Object.entries(THEMES)) {
      await H.load({ w: 1440, h: 900, query: { officeview: 'real', ...q }, ready: `!!document.querySelector('#stage .ro .ro-plate')`, settle: false });
      await js(`window.THEME.setTheme(${jsLiteral(lit)})`);
      assert.ok(await H.until(`window.THEME.current().id===${jsLiteral(tid)}&&!!document.querySelector('#stage .ro .ro-plate')`, 15000), `${wid}/${tid}: the theme was applied`);
      await new Promise((r) => setTimeout(r, 600));
      out[`${wid}/${tid}`] = await js(PROBE);
    }
  }
  if (process.env.WORLD_LOOK_DUMP) fs.writeFileSync(process.env.WORLD_LOOK_DUMP, JSON.stringify(out, null, 1));
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
    }
  }
  console.log('check-097-world-look: the world keeps its own colours under 3 themes in 3 worlds and the drop overlay reads; ' + Object.keys(out).length + ' measurements');
};
