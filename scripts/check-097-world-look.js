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
 *   - the drop overlay's text is under 4.5:1 on its fill, or the fill is transparent (FR-351: the arcade's was 1.0:1 composited over its surface);
 *   - the arcade's stylesheet, loaded into the Photo office, the cave or the flat office without a reload, changes the overlay (an unscoped rule).
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
  /* the overlay as the chat builds it (class `drop-ov on`), measured now */
  const DROP = `(()=>{const d=document.createElement('div');d.className='drop-ov on';d.innerHTML='<span>Drop</span>';document.body.appendChild(d);const c=getComputedStyle(d);const r={backgroundColor:c.backgroundColor,color:c.color};d.remove();return r;})`;
  const PROBE = `(()=>{const DROP=${DROP};
    const P=['backgroundColor','color','fontFamily','fontWeight','borderRadius','boxShadow','borderTopColor'];
    const g=s=>{const e=document.querySelector(s);if(!e)return null;const c=getComputedStyle(e);return Object.fromEntries(P.map(p=>[p,c[p]]));};
    const o={ui:document.documentElement.dataset.ui||'',world:document.documentElement.dataset.world||'',dark:document.documentElement.dataset.dark!==undefined,id:window.THEME.current().id};
    for(const s of ['.topbar','.ro-plate','.ro-lplate','.ro-sign','.topbar .btn'])o[s]=g(s);
    o.drop=DROP();
    return o;})()`;
  const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const out = {};
  /* the arcade's stylesheet loaded under another world or the flat office (no reload: what a visit to the arcade leaves in the page) must not
     change the overlay's fill: its rule is scoped to html[data-world="retro"] (FR-351) */
  const leak = async (before) => {
    await js(`(()=>{const l=document.createElement('link');l.rel='stylesheet';l.id='wlLeak';l.href='realoffice/worlds/retro/world.css';document.head.appendChild(l);})()`);
    assert.ok(await H.until(`[...document.styleSheets].some(s=>/worlds\\/retro\\/world\\.css/.test(s.href||'')&&s.cssRules.length>0)`, 15000), 'the arcade stylesheet loaded');
    const after = await js(`(${DROP})()`);
    await js(`document.getElementById('wlLeak').remove()`);
    return { before, after };
  };
  for (const [wid, q, wantUi] of WORLDS) {
    for (const [tid, lit] of Object.entries(THEMES)) {
      await H.load({ w: 1440, h: 900, query: { officeview: 'real', ...q }, ready: `!!document.querySelector('#stage .ro .ro-plate')`, settle: false });
      await js(`window.THEME.setTheme(${jsLiteral(lit)})`);
      assert.ok(await H.until(`window.THEME.current().id===${jsLiteral(tid)}&&!!document.querySelector('#stage .ro .ro-plate')`, 15000), `${wid}/${tid}: the theme was applied`);
      // settled: the plate's computed ink is the same on two reads 100 ms apart
      assert.ok(await H.until(`(()=>{const e=document.querySelector('.ro-plate');const c=e?getComputedStyle(e).color+'|'+getComputedStyle(document.documentElement).getPropertyValue('--ink'):'';const same=window.__wl===c&&c!=='';window.__wl=c;return same;})()`, 15000), `${wid}/${tid}: the page settled`);
      out[`${wid}/${tid}`] = await js(PROBE);
      if (tid === 'clean-office') out[`${wid}/leak`] = await leak(out[`${wid}/${tid}`].drop);
    }
  }
  // the flat office too
  await H.load({ w: 1440, h: 900, query: {}, settle: false });
  out['flat/leak'] = await leak(await js(`(${DROP})()`));
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
      const al = m.drop.backgroundColor.match(/rgba\(\d+, \d+, \d+, ([\d.]+)\)/);
      assert.ok(!al || Number(al[1]) >= 0.9, `${tag}: the drop overlay fill ${m.drop.backgroundColor} is not (nearly) opaque, so its text cannot be measured against it`);
      assert.ok(ratio(m.drop.color, m.drop.backgroundColor.replace(/rgba\((\d+), (\d+), (\d+), [\d.]+\)/, 'rgb($1, $2, $3)')) >= 4.5, `${tag}: the drop overlay text ${m.drop.color} on ${m.drop.backgroundColor} is under 4.5:1`);
      for (const s of ['.ro-plate', '.ro-lplate', '.ro-sign']) assert.ok(ratio(m[s].color, m[s].backgroundColor) >= 4.5, `${tag}: ${s} text ${m[s].color} on ${m[s].backgroundColor} is under 4.5:1`);
    }
  }
  for (const k of ['photo', 'cave', 'flat']) assert.deepStrictEqual(out[`${k}/leak`].after, out[`${k}/leak`].before, `${k}: the arcade's stylesheet changed the drop overlay (an unscoped rule): ${JSON.stringify(out[`${k}/leak`])}`);
  console.log('check-097-world-look: the world keeps its own colours under 3 themes in 3 worlds and the drop overlay reads; ' + Object.keys(out).length + ' measurements');
};
