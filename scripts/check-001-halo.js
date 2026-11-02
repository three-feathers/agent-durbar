/*
 * Spec 001 FR-210 (owner 2026-11-02): the Flat office's waiting halo is a still glow, so it costs nothing per frame. Simulator only, no credits.
 * In ui-suite.js; `node scripts/ui-suite.js --only check-001-halo`. It fails (exit 1) when, at the simulator's 15 agents:
 *   - any `@keyframes halo` exists, or any animation runs on a `.halo` or inside one (fill-opacity restyled the page 60 times a second;
 *     opacity moved the figure and desk to a layer that draws their edges a pixel soft, measured 2026-11-02);
 *   - a halo is not drawn (computed opacity 0), at 1440x900 and 1280x800, at normal and 2x zoom, also under prefers-reduced-motion (emulated).
 * It prints the renderer's CPU over 6 s (`[001-halo] cpu`) as a measurement, not a limit, and writes a picture per size and zoom.
 * Screenshots: <SHOTS_OUT>/001-halo-<w>x<h>-<zoom>x.png
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-001-halo-'));
fs.mkdirSync(OUT, { recursive: true });
const SIZES = [[1440, 900], [1280, 800]];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const wc = () => ctx.win.webContents;
  const dbg = () => { const d = wc().debugger; if (!d.isAttached()) d.attach('1.3'); return d; };
  const media = (v) => dbg().sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: v }] });
  const failures = [];
  const frames = () => js(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))`);
  const inspect = () => js(`(()=>{
    let kf=0;const walk=(rs)=>{for(const r of rs){if(r.type===7&&r.name==='halo')kf++;else if(r.cssRules)walk(r.cssRules);}};
    for(const s of document.styleSheets){try{walk(s.cssRules)}catch(e){}}
    const halos=[...document.querySelectorAll('#stage .halo')];
    const anim=document.getAnimations().filter(a=>{const t=a.effect&&a.effect.target;return t&&t.closest&&(t.closest('.halo')||t.matches('.halo'))}).length;
    const drawn=halos.filter(h=>parseFloat(getComputedStyle(h).opacity)>0).length;
    return {kf,halos:halos.length,anim,drawn};})()`);

  for (const reduced of [false, true]) {
    await media(reduced ? 'reduce' : 'no-preference');
    for (const [w, h] of SIZES) for (const z of [1, 2]) {
      await H.load({ w, h });
      wc().setZoomFactor(z);
      await H.until(`Math.abs(window.devicePixelRatio-${jsLiteral(z)})<0.01`);
      await frames(); /* the zoomed layout is painted before the single read */
      const r = await inspect();
      const tag = `${w}x${h} zoom ${z}${reduced ? ' reduced motion' : ''}`;
      console.log(`[001-halo] ${tag}:`, JSON.stringify(r));
      if (r.kf) failures.push(`${tag}: @keyframes halo exists`);
      if (r.anim) failures.push(`${tag}: ${r.anim} animations run on a halo`);
      if (!r.halos) failures.push(`${tag}: no halo at 15 agents`);
      if (r.drawn !== r.halos) failures.push(`${tag}: ${r.halos - r.drawn} halos are not drawn`);
      if (!reduced) { await H.calm(); await frames(); await ctx.shot(path.join(OUT, `001-halo-${w}x${h}-${z}x.png`)); }
      wc().setZoomFactor(1);
    }
  }
  await H.load({ w: 1440, h: 900 });
  const { app } = require('electron');
  const cpu = () => app.getAppMetrics().filter((m) => m.type === 'Tab').reduce((s, m) => s + m.cpu.percentCPUUsage, 0);
  cpu();
  await ctx.sleep(1500); /* the measurement window itself, not a wait for a state */
  const samples = [];
  for (let i = 0; i < 6; i++) { await ctx.sleep(1000); samples.push(Math.round(cpu() * 10) / 10); }
  console.log('[001-halo] cpu: renderer % of a core, 6 one-second samples', samples.join(' '), 'mean', Math.round(samples.reduce((a, b) => a + b, 0) / samples.length * 10) / 10);

  await media('no-preference'); // the machine's own setting is back, and the debugger is let go
  try { wc().debugger.detach(); } catch { /* not attached */ }
  assert.strictEqual(failures.length, 0, failures.join('; '));
  console.log('[001-halo] ok');
};
