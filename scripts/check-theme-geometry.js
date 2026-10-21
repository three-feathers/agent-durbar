/*
 * Theme geometry check (spec 008 FR-031, spec 035 FR-010): a theme may change colours, borders, textures and display fonts,
 * never sizes. So the full office layout check runs in Clean Office only, and this check proves every other theme lays out
 * the same: for each theme, at 1440x900 and 1280x800 with 15 and 12 simulated agents (and again with a `+N more` chip
 * expanded):
 *   1. geometry: with display text neutralised for the measurement (one font family, weight, case and letter spacing; a theme
 *      may pick its own display font), the box of every element of the office, the lobby and the top bar (SVG art excluded) and
 *      the font size of every text element must equal Clean Office's, within 0.5px. This catches any size, padding, border,
 *      gap or font-size change;
 *   2. real fonts: the office check's own rules (overlap, clipping, room headers, text at least 10.5px) on the same layouts in
 *      the theme's own fonts, where a wider display font could push header parts. Motion is reduced; a few seconds per theme.
 *
 *   npm run check:geometry                     the 5 other built-in themes, scripts/fixtures/themes/check-user.json and pink-studio.json
 *   GEOMETRY_THEMES=retro,corporate npm run check:geometry
 *
 * The full layout matrix in every theme stays available on demand: npm run check:themes.
 */
const fs = require('fs');
const { pageCheck } = require('./check-office-overlap.js');
const { helpers, jsLiteral } = require('./driver-helpers');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'dist', 'renderer', 'index.html');
const SIZES = [[1440, 900], [1280, 800]];
const SIMS = [15, 12];
/* user packs by name: `user` (check-user.json) and the sample AI-style pack with fonts, corners, shadows and clothes (spec 070) */
const FIXTURES = { user: 'check-user.json', 'pink-studio': 'pink-studio.json' };
const THEMES = (process.env.GEOMETRY_THEMES || 'corporate,retro,durbar-indian,durbar-european,durbar-japanese,user,pink-studio').split(',').map((s) => s.trim()).filter(Boolean);

/* runs in the page: the box of EVERY element of the office, the lobby and the top bar (SVG art inside excluded: scene kits draw
   their own), keyed by order and class, plus the font size of each text element; the DOM must be the same in every theme */
function measure() {
  const out = {};
  const st = document.createElement('style');
  st.textContent = '#stage *, .lobby *, header *{font-family:sans-serif!important;font-weight:400!important;font-style:normal!important;letter-spacing:normal!important;text-transform:none!important;word-spacing:normal!important;font-variant:normal!important;font-feature-settings:normal!important;font-stretch:normal!important}';
  document.head.appendChild(st);
  if (window.DurbarFit) window.DurbarFit(); /* fit the usage lines and room headers in the forced font, as the app does in its own */
  const els = [...document.querySelectorAll('#stage, #stage *, .lobby, .lobby *, header, header *')].filter((e) => !e.closest('svg') && e.getClientRects().length);
  els.forEach((e, i) => {
    const b = e.getBoundingClientRect();
    const key = `${i} ${e.tagName.toLowerCase()}.${String(e.className || '').trim().split(/\s+/).slice(0, 2).join('.')}`.slice(0, 60);
    out[key] = [b.left, b.top, b.width, b.height].map((v) => Math.round(v * 10) / 10);
    if (!e.children.length && e.textContent.trim()) out[key].push(parseFloat(getComputedStyle(e).fontSize));
  });
  st.remove();
  if (window.DurbarFit) window.DurbarFit();
  return out;
}

async function driver(ctx) {
  const H = helpers(ctx); // spec 008 FR-097: shared plumbing
  const packs = Object.fromEntries(Object.entries(FIXTURES).map(([k, f]) => [k, JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'fixtures', 'themes', f), 'utf8'))]));
  const query = (theme, sim) => {
    const q = { sim: String(sim), simfreeze: '1' };
    if (packs[theme]) { q.theme = packs[theme].id; q.usertheme = JSON.stringify(packs[theme]); } else q.theme = theme;
    return q;
  };
  const snap = async (theme, sim, w, h) => {
    await H.load({ w, h, query: query(theme, sim), ready: 'fit', settle: false });
    const want = packs[theme] ? packs[theme].id : theme;
    await ctx.waitFor(`window.THEME&&window.THEME.current().id===${jsLiteral(want)}`, 5000);
    const on = await ctx.js(`window.THEME.current().id`);
    if (on !== want) throw new Error(`theme ${want} was not applied (on screen: ${on})`);
    await ctx.js(`document.fonts.ready.then(()=>true)`);
    // agents go to the lobby after about 600 ms (instant with reduced motion): wait until somebody is there
    // (spec 068: not the coffee corner, where an agent on a break stands at once)
    await ctx.waitFor(`!!document.querySelector('.place.busy:not([data-place="coffee"])')`, 3000);
    // the pointer of the virtual display rests mid-window: a hover style (retro nudges a card by 1px) is not layout
    ctx.win.webContents.sendInputEvent({ type: 'mouseMove', x: 0, y: 0 });
    await ctx.sleep(300);
    // a settled layout: measure until two snapshots 300 ms apart agree (a slow runner, macOS in CI, once caught the reference
    // mid-change: every theme then "differed" from it the same way)
    let base = await ctx.js(`(${measure.toString()})()`);
    for (let i = 0; i < 10; i++) {
      await ctx.sleep(300);
      const again = await ctx.js(`(${measure.toString()})()`);
      if (JSON.stringify(again) === JSON.stringify(base)) break;
      base = again;
    }
    // the theme's real fonts: the office check's own overlap, clipping, header and font-size rules on this layout
    const real = [await ctx.js(`(${pageCheck.toString()})(false, 5)`)];
    const more = await ctx.js(`(()=>{const m=document.querySelector('#stage .more[aria-expanded="false"]');if(!m)return false;m.click();return true})()`);
    let expanded = null;
    if (more) { await ctx.sleep(300); expanded = await ctx.js(`(${measure.toString()})()`); real.push(await ctx.js(`(${pageCheck.toString()})(true, 5)`)); }
    return { base, expanded, real: real.flatMap((r) => r.problems) };
  };
  const diff = (a, b) => {
    const out = [];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a)) { out.push(`${k}: only in the theme`); continue; }
      if (!(k in b)) { out.push(`${k}: missing in the theme`); continue; }
      // place names are a theme's own words (spec 036): their width, and so the seats beside them, may change; the real-font
      // step checks that both stay inside the place's tile. Their top and height must still match.
      const idx = /span\.(pn|prow)$/.test(k) ? [1, 3, 4] : [0, 1, 2, 3, 4];
      if (idx.some((i) => a[k][i] !== undefined && Math.abs(a[k][i] - b[k][i]) > 0.5)) out.push(`${k}: ${a[k].join(',')} -> ${b[k].join(',')}`);
    }
    return out;
  };
  let failed = 0, total = 0;
  const ref = {};
  for (const sim of SIMS) for (const [w, h] of SIZES) ref[`${sim}-${w}`] = await snap('clean-office', sim, w, h);
  for (const theme of THEMES) {
    for (const sim of SIMS) for (const [w, h] of SIZES) {
      const r = ref[`${sim}-${w}`], t = await snap(theme, sim, w, h);
      total++;
      if (t.real.length) { failed++; console.log(`FAIL ${theme} sim${sim}-${w}x${h} real fonts: ${t.real.slice(0, 6).join('; ')}`); }
      else console.log(`  ok   ${theme} sim${sim}-${w}x${h} real fonts: office checks pass`);
      for (const part of ['base', 'expanded']) {
        if (!r[part] && !t[part]) continue;
        total++;
        const d = r[part] && t[part] ? diff(r[part], t[part]) : [`${part}: present in only one of them`];
        const label = `${theme} sim${sim}-${w}x${h}${part === 'expanded' ? ' +expanded' : ''}`;
        if (d.length) { failed++; console.log(`FAIL ${label}: ${d.length} differences: ${d.slice(0, 8).join('; ')}${d.length > 8 ? ' ...' : ''}`); }
        else console.log(`  ok   ${label} (${Object.keys(r[part]).length} boxes and fonts)`);
      }
    }
  }
  console.log(`\ntheme geometry: ${total - failed}/${total} checks passed, ${failed} failed`);
  if (failed || !total) fs.writeFileSync(process.env.OFFICE_FAIL_MARKER, String(failed || 'none'));
}

// any error (a theme not applied, a page that never fits) fails the run: the app itself exits 0 after a driver error
module.exports = (ctx) => driver(ctx).catch((e) => { console.log('FAIL ' + (e && e.message)); fs.writeFileSync(process.env.OFFICE_FAIL_MARKER, 'error'); });

if (require.main === module) {
  const { spawnSync } = require('child_process');
  if (!fs.existsSync(INDEX)) { console.error('dist/ missing: run npm run build first'); process.exit(2); }
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-geometry-'));
  const marker = path.join(userData, 'geometry.fail');
  const electron = require('electron'); /* path to the binary */
  const env = { ...process.env, DURBAR_DRIVER: __filename, DURBAR_USER_DATA: userData, OFFICE_FAIL_MARKER: marker, DURBAR_SIM: '15', DURBAR_SIM_FREEZE: '1' };
  const args = ['.', '--no-sandbox', '--force-prefers-reduced-motion'];
  const useXvfb = process.platform === 'linux' && !process.env.DISPLAY;
  const r = useXvfb ? spawnSync('xvfb-run', ['-a', electron, ...args], { cwd: ROOT, env, stdio: 'inherit' }) : spawnSync(electron, args, { cwd: ROOT, env, stdio: 'inherit' });
  if (r.error) { console.error(r.error.message); process.exit(2); }
  process.exit(fs.existsSync(marker) ? 1 : r.status === 0 ? 0 : r.status || 1);
}
