/*
 * Spec 070 A14 (T033, T035, T036, T039, T044; FR-061..FR-066, FR-075): Flat's modern look behind html[data-flat-look] (src/renderer/flatlook.js), in the
 * simulator. No real agent, no AI credits.
 *
 *   npm run build
 *   SHOTS_OUT=<dir> DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-070-flat-look.js npx electron .      (xvfb-run -a ... --no-sandbox on Linux)
 *
 * Fails when:
 *   - the flag is off (the default) and anything differs from today: `data-flat-look` set, --h-ctl not 32, a control not 32 px, Clean Office's old page colour gone;
 *   - the flag is on in Flat and a visible `.btn`, `.ib`, `.fl-ib` or `.ptab` outside #stage and the note cards is not 24 px (approvals stay 28), or the page is not white;
 *   - the flag is on and another pack (Retro) or a world (Photo office) changes: the computed colours, radii and control heights of a probe set must equal the flag-off ones (FR-066);
 *   - the top bar leaves its one row, text is under 10.5 px, or 15 agents do not fit.
 * Screenshots: <SHOTS_OUT>/070-flat-{off,on}-{office,chat,settings,dialog,menu,toast}-<w>x<h>.png, and 070-real-on-office-<w>x<h>.png.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers } = require('./driver-helpers');

const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-070-'));
const SIZES = [[1440, 900], [1280, 800]];
const PROBE = `(()=>{const q=s=>document.querySelector(s),g=(e,p)=>e?getComputedStyle(e)[p]:null;const root=getComputedStyle(document.documentElement);
  return {flag:document.documentElement.hasAttribute('data-flat-look'),ui:document.documentElement.dataset.ui||'',world:document.documentElement.dataset.world||'',hctl:root.getPropertyValue('--h-ctl').trim(),rmd:root.getPropertyValue('--r-md').trim(),
   bodyBg:g(document.body,'backgroundColor'),barBg:g(q('.topbar'),'backgroundColor'),barH:q('.topbar').getBoundingClientRect().height,
   btnH:g(q('.topbar .btn')||q('.btn'),'height'),btnR:g(q('.topbar .btn')||q('.btn'),'borderTopLeftRadius'),btnBd:g(q('.topbar .btn')||q('.btn'),'borderTopColor'),ink:g(q('.topbar h1'),'color')}})()`;
const SIZE_BAD = `(()=>{const bad=[];for(const e of document.querySelectorAll('.btn,.ib,.fl-ib,.ptab')){if(!e.getClientRects().length||e.closest('#stage,.note,.ph,.notice-strip,.topbar')||e.id==='railDoor')continue;const r=e.getBoundingClientRect();if(Math.round(r.height)!==24&&!/\\bsend\\b|\\bstop\\b/.test(e.className))bad.push((e.id||e.className)+':'+r.height)}return bad})()`;

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const close = () => js(`(()=>{document.querySelectorAll('.dlg-ov .close,.dlg .close').forEach(b=>b.click());document.querySelectorAll('#toasts .toast').forEach(t=>t.remove());const m=document.getElementById('topMoreMenu');if(m&&!m.hidden)document.getElementById('topMoreBtn').click();if(document.body.classList.contains('screen-open')&&window.DurbarScreens&&DurbarScreens.close)DurbarScreens.close();if(document.body.classList.contains('panel-open')){const b=document.getElementById('panelBack')||document.querySelector('#panel .back');if(b)b.click()}})()`);
  for (const [w, h] of SIZES) {
    const probes = {};
    for (const flag of ['off', 'on']) {
      const query = flag === 'on' ? { flatlook: '1' } : {};
      await H.load({ w, h, query });
      const p = await js(PROBE);
      probes[flag] = p;
      console.log(`[070] flat ${flag} ${w}x${h}`, JSON.stringify(p));
      const fit = await js(`(()=>{const d=[...document.querySelectorAll('#stage .desk[data-id]')];return {n:d.length,cut:d.filter(x=>{const r=x.getBoundingClientRect();return r.right>innerWidth+1||r.bottom>innerHeight+1}).length,minFont:Math.min(...[...document.querySelectorAll('.topbar *')].filter(e=>e.childNodes.length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&e.getClientRects().length).map(e=>parseFloat(getComputedStyle(e).fontSize)))}})()`);
      assert.ok(fit.n >= 15 && fit.cut === 0, `15 agents fit ${w}x${h} (${flag}): ` + JSON.stringify(fit));
      assert.ok(fit.minFont >= 10.5, `top bar text at least 10.5 px (${flag}): ${fit.minFont}`);
      assert.ok(p.barH <= 52.5, `the top bar keeps its one row (${flag}): ${p.barH}`);
      if (flag === 'off') {
        assert.strictEqual(p.flag, false, 'off by default: no data-flat-look');
        assert.strictEqual(p.hctl, '32px', 'off: --h-ctl is 32px');
        assert.strictEqual(p.bodyBg, 'rgb(247, 246, 243)', 'off: Clean Office page colour is today\'s');
      } else {
        assert.strictEqual(p.flag, true, 'on: data-flat-look set');
        assert.strictEqual(p.hctl, '24px', 'on: --h-ctl is 24px');
        assert.strictEqual(p.bodyBg, 'rgb(255, 255, 255)', 'on: the page is white');
        assert.strictEqual(p.rmd, '4px', 'on: --r-md 4px');
      }
      await H.shot(path.join(OUT, `070-flat-${flag}-office-${w}x${h}.png`), { prep: 'calm' });
      // chat: open the first desk's chat
      await js(`(document.querySelector('#stage .desk[data-id]')||{click(){}}).click()`);
      await must(`document.body.classList.contains('panel-open')`, 'a chat');
      await H.settle?.();
      if (flag === 'on') assert.deepStrictEqual(await js(SIZE_BAD), [], 'on: chat controls are 24 px');
      await H.shot(path.join(OUT, `070-flat-${flag}-chat-${w}x${h}.png`), { prep: 'calm' });
      await H.load({ w, h, query });
      await js(`window.DurbarScreens.openSettings()`);
      await must(`document.body.classList.contains('screen-open')`, 'Settings');
      if (flag === 'on') assert.deepStrictEqual(await js(SIZE_BAD), [], 'on: Settings controls are 24 px');
      await H.shot(path.join(OUT, `070-flat-${flag}-settings-${w}x${h}.png`), { prep: 'calm' });
      await H.load({ w, h, query });
      // a dialog: Add folder (the bar's button)
      await js(`(document.getElementById('addFolder')||{click(){}}).click()`);
      await ctx.sleep(500);
      await H.shot(path.join(OUT, `070-flat-${flag}-dialog-${w}x${h}.png`), { prep: 'calm' });
      await close();
      await H.load({ w, h, query });
      await js(`document.getElementById('topMoreBtn').click()`);
      await must(`!document.getElementById('topMoreMenu').hidden`, 'the More menu');
      await H.shot(path.join(OUT, `070-flat-${flag}-menu-${w}x${h}.png`), { prep: 'calm' });
      await js(`document.getElementById('topMoreBtn').click()`);
      await js(`window.__durbarSimUi.toast('Session resumed.','Undo')`);
      await must(`!!document.querySelector('#toasts .toast')`, 'a toast');
      await js(`(document.getElementById('shotCalm')||{remove(){}}).remove()`);
      await H.shot(path.join(OUT, `070-flat-${flag}-toast-${w}x${h}.png`), { prep: 'calm', keepActions: true });
    }
    // FR-066: another pack and a world look exactly as without the flag
    const other = {};
    for (const flag of ['off', 'on']) {
      const query = flag === 'on' ? { flatlook: '1' } : {};
      await H.load({ w, h, query });
      await js(`(()=>{const st=document.createElement('style');st.textContent='*{transition:none!important}';document.head.appendChild(st);window.THEME.setTheme('retro')})()`);
      await ctx.sleep(500);
      const r = await js(PROBE);
      await H.load({ w, h, query: { officeview: 'real', ...query }, ready: `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`, settle: false });
      await ctx.sleep(1500);
      const real = await js(PROBE);
      if (flag === 'on') await H.shot(path.join(OUT, `070-real-on-office-${w}x${h}.png`), { prep: 'calm' });
      console.log('[070] other', flag, JSON.stringify(r), JSON.stringify(real));
      other[flag] = { retro: r, real };
    }
    for (const k of ['retro', 'real']) {
      const a = { ...other.off[k], flag: 0 }, b = { ...other.on[k], flag: 0 };
      assert.deepStrictEqual(b, a, `FR-066: ${k} is unchanged with the flag on (${w}x${h})`);
    }
    console.log(`[070] ${w}x${h}: retro and real office equal with the flag on; 15 agents fit; top bar one row`);
  }
};
