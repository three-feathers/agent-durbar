/*
 * Spec 040 FR-014..FR-019: the AI theme maker and theme export. Simulator only (a canned theme, no harness, no credits).
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 DURBAR_SIM_KINDS=mixed \
 *     DURBAR_DRIVER=$PWD/scripts/shots-040-aitheme.js xvfb-run -a npx electron . --no-sandbox
 *
 * At both sizes: Export on a built-in theme says why (no silent nothing); Make a theme with AI asks for a look and a harness,
 * shows the result (swatches, style, place names), Try it closes Settings and shows the office with a bar (Save, Details, Try again, Discard), Discard goes back, Save as my theme
 * adds it to the list as "yours" and makes it active, and Export now works for it. Writes 040-aitheme-preview-<w>x<h>.png and 040-aitheme-<w>x<h>.png (the office while trying).
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-097: shared plumbing
  const { js } = H;
  const lastToast = () => js(`(()=>{const t=[...document.querySelectorAll('#toasts .toast')].pop();return t?t.innerText:''})()`);
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, query: { simkinds: 'mixed' } });
    await js(`document.getElementById('settingsBtn').click()`);
    await ctx.waitFor(`!!document.getElementById('thAi')`, 6000);
    // the theme picker with a built-in theme picked (website gallery, issue #573): the same click as a person's, then back to Clean Office
    const pick = (id) => js(`(()=>{const b=document.querySelector('#thList [data-theme='+${jsLiteral(JSON.stringify(id))}+']');if(!b)return false;b.click();return true})()`);
    assert.ok(await pick('retro'), 'the picker lists the built-in Retro Pixel');
    await H.until(`window.THEME.current().id==='retro'&&document.querySelector('#thList [data-theme="retro"]').getAttribute('aria-pressed')==='true'`, 3000);
    assert.strictEqual(await js(`window.THEME.current().id`), 'retro', 'a click in the picker applies the theme at once');
    await js(`(()=>{const l=document.getElementById('thList'),sec=l.closest('section')||l;let p=sec.parentElement;while(p&&p.scrollHeight<=p.clientHeight+1)p=p.parentElement;if(p)p.scrollTop+=sec.getBoundingClientRect().top-p.getBoundingClientRect().top-12;return true})()`);
    await H.until(`(()=>{const r=document.getElementById('thList').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()`, 3000);
    await H.shot(path.join(OUT, `040-theme-picker-${w}x${h}.png`), { prep: 'toasts', delay: 300 });
    assert.ok(await pick('clean-office')); await H.until(`window.THEME.current().id==='clean-office'`, 3000);
    // export on a built-in theme explains instead of doing nothing
    await js(`document.getElementById('thExport').click()`); await ctx.sleep(300);
    assert.match(await lastToast(), /built into the app/);
    const before = await js(`window.THEME.current().id`);
    // make a theme
    await js(`document.getElementById('thAi').click()`); await ctx.sleep(300);
    assert.ok(await js(`!!document.getElementById('aiDesc')&&document.getElementById('aiKind').options.length>=1`), 'description and harness');
    assert.ok(await js(`[...document.getElementById('aiKind').options].some(o=>o.value==='copilot')`), 'Copilot is offered (oneShot, spec 040 T026)');
    // FR-021: four example looks; a click fills the description; More ideas shows others
    assert.strictEqual(await js(`document.querySelectorAll('#aiIdeas .ai-idea').length`), 4);
    await js(`document.querySelector('#aiIdeas .ai-idea').click()`);
    assert.strictEqual(await js(`document.getElementById('aiDesc').value`), await js(`document.querySelector('#aiIdeas .ai-idea').dataset.idea`));
    await js(`document.getElementById('aiMore').click()`);
    assert.strictEqual(await js(`document.querySelectorAll('#aiIdeas .ai-idea').length`), 4);
    await js(`(()=>{const t=document.getElementById('aiDesc');t.value='a night-shift newsroom';t.dispatchEvent(new Event('input'));return true})()`);
    await js(`[...document.querySelectorAll('#scrDlg .dbtn button')].find(b=>b.textContent==='Make the theme').click()`);
    await ctx.waitFor(`!!document.querySelector('#scrDlg .ai-sws')`, 8000); await ctx.sleep(200);
    await ctx.waitFor(`(()=>{const d=document.querySelector('#scrDlg .dlg');return !!d&&getComputedStyle(d).opacity==='1'})()`, 5000); // fully opened before the picture (a loaded machine shot it mid-fade)
    const pv = await js(`({title:document.getElementById('scrDlgT').textContent,sw:document.querySelectorAll('#scrDlg .ai-sw').length,words:document.querySelectorAll('#scrDlg .ai-words li').length})`);
    console.log('[040-ai]', w, JSON.stringify(pv));
    assert.match(pv.title, /^Theme: Night-shift newsroom/);
    assert.ok(pv.sw >= 5 && pv.words >= 5);
    // Try it: applied live, not saved
    await H.shot(path.join(OUT, `040-aitheme-preview-${w}x${h}.png`), { prep: 'toasts' }); // no toasts from the steps before (the landing page shows it)
    await js(`[...document.querySelectorAll('#scrDlg .dbtn button')].find(b=>b.textContent==='Try it').click()`); await ctx.sleep(700);
    assert.match(await js(`window.THEME.current().id`), /^ai-night-shift-newsroom/);
    assert.ok(await js(`!!document.getElementById('aiTryBar')&&document.getElementById('screen').hidden`), 'Settings closed; the try bar is over the office');
    await js(`(()=>{document.querySelectorAll('#toasts .toast').forEach(t=>t.remove());return true})()`);
    await ctx.shot(path.join(OUT, `040-aitheme-${w}x${h}.png`));
    // Discard on the bar: back to the theme before; then reopen Settings for the next steps
    await js(`document.querySelector('#aiTryBar [data-t="discard"]').click()`); await ctx.sleep(400);
    assert.ok(!(await js(`!!document.getElementById('aiTryBar')`)));
    assert.strictEqual(await js(`window.THEME.current().id`), before, 'Discard restores the theme');
    await js(`document.getElementById('settingsBtn').click()`); await ctx.waitFor(`!!document.getElementById('thAi')`, 6000);
    // make again and save
    await js(`document.getElementById('thAi').click()`); await ctx.sleep(300);
    await js(`(()=>{const t=document.getElementById('aiDesc');t.value='a night-shift newsroom';t.dispatchEvent(new Event('input'));return true})()`);
    await js(`[...document.querySelectorAll('#scrDlg .dbtn button')].find(b=>b.textContent==='Make the theme').click()`);
    await ctx.waitFor(`!!document.querySelector('#scrDlg .ai-sws')`, 8000);
    await js(`[...document.querySelectorAll('#scrDlg .dbtn button')].find(b=>b.textContent==='Save as my theme').click()`); await ctx.sleep(1200);
    const id = await js(`window.THEME.current().id`);
    assert.match(id, /^ai-night-shift-newsroom/);
    await ctx.waitFor(`!!document.querySelector(${jsLiteral(`#thList [data-theme="${id}"]`)})`, 5000);
    assert.ok(await js(`/yours/.test(document.querySelector(${jsLiteral(`#thList [data-theme="${id}"]`)}).innerText)`), 'listed as yours');
    // export now works for the active (own) theme
    await js(`document.getElementById('thExport').click()`); await ctx.sleep(400);
    assert.match(await lastToast(), /Theme copied to/);
    await js(`document.querySelector('#thList [data-theme="clean-office"]').click()`); await ctx.sleep(400);
    assert.strictEqual(await js(`document.querySelector('#thList [data-theme="clean-office"]').getAttribute('aria-pressed')`), 'true', 'the picker shows the new choice at once');
    await js(`document.getElementById('scrClose').click()`); await ctx.sleep(300);
  }
  console.log('[040-ai] PASS');
};
