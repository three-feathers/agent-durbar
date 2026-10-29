/*
 * Characters, separate from themes (spec 077 FR-064..FR-069, issue #814). Simulator only (DURBAR_SIM=15 DURBAR_SIM_FREEZE=1), no AI credits.
 *
 * At 1440x900 and 1280x800, on Retro Pixel and on Corporate (no built-in theme has a dark surface; Retro's floor is dark, so it stands in
 * for "one dark"), everything through Settings (the real path):
 *   - the Characters section is right after Theme, lists The theme's own, Minimalist, Cheeky and Prehistoric, each with a preview figure, and names the
 *     theme's own figures; it fits the window (no page overflow);
 *   - Cheeky: every desk scene draws the crew kit with a portrait, the theme stays the one picked, the choice is announced;
 *   - a theme switch with Cheeky keeps the crew on the new theme;
 *   - The theme's own: Retro's pixel figures and Corporate's suits come back, no portrait is left;
 *   - Minimalist: the office figure on top of the theme.
 * Screenshots of the Settings section and of the office (SHOTS_OUT, default characters-shots in the OS temp folder).
 *
 *   DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 DURBAR_DRIVER=$PWD/scripts/check-characters.js electron . --no-sandbox   (in check:ui)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const THEMES = [['retro', 'pixel', 'Pixel figures'], ['corporate', 'corporate', 'Corporate figures']];
const CREW_IMG = 'image[href*="crew/art/"]';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const out = process.env.SHOTS_OUT || path.join(os.tmpdir(), 'characters-shots');
  fs.mkdirSync(out, { recursive: true });
  /* the desk scenes on screen: how many, how many draw each kit (the kit is the last part of a kit scene's signature) and how many hold a portrait */
  const desks = () => H.js(`(()=>{const sc=[...document.querySelectorAll('#stage .desk[data-id] svg.scene')].filter(s=>s.getClientRects().length);
    const kit=(s)=>{const m=/\\|(pixel|corporate|crew|court-[a-z]+)(\\||$)/.exec(s.dataset.sig||'');return m?m[1]:'office';};
    const by={};for(const s of sc){const k=kit(s);by[k]=(by[k]||0)+1;}
    return {n:sc.length,by,pics:sc.filter(s=>s.querySelector(${jsLiteral(CREW_IMG)})).length,anyPic:document.querySelectorAll(${jsLiteral('#stage ' + CREW_IMG)}).length};})()`);
  const openSettings = async () => {
    if (!(await H.js(`!!document.getElementById('chList')`))) await H.js(`document.getElementById('settingsBtn').click()`);
    assert.ok(await H.until(`!!document.getElementById('chList')&&!!document.getElementById('thList')`, 6000), 'Settings shows the Theme and Characters lists');
  };
  const close = async () => {
    await H.js(`window.DurbarScreens.close()`);
    assert.ok(await H.until(`!document.getElementById('chList')`, 4000), 'Settings closed');
    await H.until(`!document.querySelector('.scene-out')`, 3000);
    await H.settle();
  };
  const pickTheme = async (id) => {
    await openSettings();
    await H.js(`document.querySelector(${jsLiteral(`#thList [data-theme="${id}"]`)}).click()`);
    assert.ok(await H.until(`window.THEME.current().id===${jsLiteral(id)}`, 4000), `theme ${id} applied`);
  };
  const pickChars = async (v) => {
    await openSettings();
    await H.clearToasts();
    await H.js(`document.querySelector(${jsLiteral(`#chList [data-characters="${v}"]`)}).click()`);
    assert.ok(await H.until(`window.THEME.characters()===${jsLiteral(v)}`, 4000), `characters ${v} applied`);
    assert.ok(await H.until(`[...document.querySelectorAll('#toasts .toast')].some(t=>/^Characters: /.test(t.textContent))`, 4000), `characters ${v}: the choice is announced`);
    assert.ok(!(await H.js(`[...document.querySelectorAll('#toasts .toast')].some(t=>/could not be saved/.test(t.textContent))`)), `characters ${v}: saved (no refusal toast)`);
    assert.strictEqual(await H.js(`document.querySelector(${jsLiteral(`#chList [data-characters="${v}"]`)}).getAttribute('aria-pressed')`), 'true', `characters ${v}: the list shows the choice at once`);
  };
  /* the Characters section, read in Settings */
  const section = () => H.js(`(()=>{const h=document.getElementById('chH'),th=document.getElementById('themeH');const sec=h.closest('section'),prev=sec.previousElementSibling;
    return {afterTheme:!!prev&&prev.contains(th),items:[...document.querySelectorAll('#chList [data-characters]')].map(b=>({id:b.dataset.characters,pressed:b.getAttribute('aria-pressed'),label:b.getAttribute('aria-label'),
      text:b.textContent.replace(/\\s+/g,' ').trim(),svg:!!b.querySelector('.chsw svg'),pic:!!b.querySelector(${jsLiteral('.chsw ' + CREW_IMG)}),
      kit:(b.querySelector('.chsw svg')||{getAttribute:()=>''}).getAttribute('shape-rendering')||'',minFont:Math.min(...[...b.querySelectorAll('b,small')].map(e=>parseFloat(getComputedStyle(e).fontSize)))})),
      pageX:document.documentElement.scrollWidth<=innerWidth,pageY:document.scrollingElement.scrollTop===0};})()`);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${w}x${h}`;
    await H.load({ w, h, ready: 'fit', settle: false });
    // spec 017: with the cabins on a busy or waiting desk is a closed door; this check reads desk scenes, so the cabins are off here
    if (await H.js(`localStorage.getItem('durbar.doorsigns')!=='off'`)) { await H.js(`localStorage.setItem('durbar.doorsigns','off')`); await H.load({ w, h, ready: 'fit', settle: false }); }
    await H.office(15);
    assert.strictEqual(await H.js(`window.THEME.characters()`), 'theme', `${tag}: The theme's own is the default`);
    for (const [theme, kit, own] of THEMES) {
      const where = `${tag} ${theme}`;
      await pickTheme(theme);
      // the section: after Theme, four choices with a preview each, the theme's own named
      assert.ok(await H.until(`(document.querySelector('#chList [data-characters="theme"]')||{}).textContent&&document.querySelector('#chList [data-characters="theme"]').textContent.includes(${jsLiteral(own)})`, 4000), `${where}: The theme's own follows the theme (${own})`);
      const sc = await section();
      assert.ok(sc.afterTheme, `${where}: Characters comes right after Theme`);
      assert.deepStrictEqual(sc.items.map((i) => i.id), ['theme', 'minimalist', 'cheeky', 'prehistoric'], `${where}: the four choices in order`);
      assert.deepStrictEqual(sc.items.map((i) => i.pressed), ['true', 'false', 'false', 'false'], `${where}: the default is pressed`);
      for (const i of sc.items) {
        assert.ok(i.svg, `${where}: ${i.id} has a preview figure`);
        assert.ok(i.minFont >= 10.5, `${where}: ${i.id}: text is at least 10.5px (${i.minFont})`);
        assert.ok(/^Characters /.test(i.label), `${where}: ${i.id} has a name (${i.label})`);
      }
      assert.ok(sc.items.find((i) => i.id === 'cheeky').pic, `${where}: the Cheeky preview is a portrait`);
      assert.ok(sc.items.find((i) => i.id === 'prehistoric').pic, `${where}: the Prehistoric preview is a portrait (spec 077 FR-072)`);
      assert.ok(!sc.items.find((i) => i.id === 'minimalist').pic && !sc.items.find((i) => i.id === 'theme').pic, `${where}: the other previews are drawn figures`);
      if (kit === 'pixel') assert.strictEqual(sc.items.find((i) => i.id === 'theme').kit, 'crispEdges', `${where}: The theme's own preview is a pixel figure`);
      assert.ok(sc.pageX && sc.pageY, `${where}: Settings does not overflow the page`);
      if (theme === 'retro') {
        // the picture shows Theme and Characters together: scroll the Settings body (not the page) until the Theme heading is at its top
        const inView = `(()=>{const sc=document.querySelector('#screen .scr-body'),h=document.getElementById('themeH');if(!sc||!h)return false;const d=h.getBoundingClientRect().top-sc.getBoundingClientRect().top;if(Math.abs(d-8)>4){sc.scrollTop+=d-8;return false;}return !document.querySelector('.scene-out')&&document.scrollingElement.scrollTop===0;})()`;
        assert.ok(await H.until(inView, 6000), `${where}: the Theme heading scrolled to the top of Settings`);
        await H.clearToasts();
        await ctx.sleep(400);
        assert.ok(await H.until(inView, 3000), `${where}: still in view before the picture`);
        await H.shot(path.join(out, `077-characters-settings-${tag}.png`), { prep: 'mouse' });
      }
      await close();
      let d = await desks();
      assert.ok(d.n >= 12 && d.by[kit] === d.n && d.anyPic === 0, `${where}: The theme's own draws ${kit} on every desk, no portrait (${JSON.stringify(d)})`);
      // Cheeky on top of the theme
      await pickChars('cheeky');
      await close();
      assert.ok(await H.until(`(()=>{const sc=[...document.querySelectorAll('#stage .desk[data-id] svg.scene')].filter(s=>s.getClientRects().length);return sc.length>=12&&sc.every(s=>/\\|crew(\\||$)/.test(s.dataset.sig||'')&&s.querySelector(${jsLiteral(CREW_IMG)}));})()`, 10000), `${where}: Cheeky: every desk draws the crew kit with a portrait (${JSON.stringify(await desks())})`);
      assert.strictEqual(await H.js(`window.THEME.current().id`), theme, `${where}: the theme stays ${theme}`);
      assert.strictEqual(await H.js(`window.THEME.themeKit()`), kit, `${where}: the theme's own kit is unchanged`);
      await H.clearToasts();
      await H.shot(path.join(out, `077-characters-cheeky-${theme}-${tag}.png`), { prep: 'calm' }); // the pointer off the desks (no hover pencil), no toast
      // Prehistoric on top of the theme (FR-072): the crew kit with a Prehistoric picture on every desk
      await pickChars('prehistoric');
      await close();
      assert.ok(await H.until(`(()=>{const sc=[...document.querySelectorAll('#stage .desk[data-id] svg.scene')].filter(s=>s.getClientRects().length);return sc.length>=12&&sc.every(s=>/\\|crew(\\||$)/.test(s.dataset.sig||'')&&s.querySelector('image[href*="crew/art/prehistoric-"]'));})()`, 10000), `${where}: Prehistoric: every desk draws the crew kit with a Prehistoric portrait`);
      assert.strictEqual(await H.js(`window.THEME.current().id`), theme, `${where}: the theme stays ${theme} under Prehistoric`);
      assert.strictEqual(await H.js(`document.querySelectorAll('#stage image[href^="crew/art/"]:not([href*="prehistoric-"])').length`), 0, `${where}: no Cheeky picture under Prehistoric`);
      // Minimalist on top of the theme
      await pickChars('minimalist');
      await close();
      assert.ok(await H.until(`(()=>{const sc=[...document.querySelectorAll('#stage .desk[data-id] svg.scene')].filter(s=>s.getClientRects().length);return sc.length>=12&&sc.every(s=>!/\\|(pixel|corporate|crew|court-[a-z]+)(\\||$)/.test(s.dataset.sig||''))&&!document.querySelector(${jsLiteral('#stage ' + CREW_IMG)});})()`, 10000), `${where}: Minimalist: the office figure on every desk (${JSON.stringify(await desks())})`);
      // back to Cheeky, then The theme's own: the theme's figures come back
      await pickChars('cheeky');
      await close();
      assert.ok(await H.until(`document.querySelectorAll(${jsLiteral('#stage .desk[data-id] svg.scene ' + CREW_IMG)}).length>=12`, 10000), `${where}: Cheeky again`);
      await pickChars('theme');
      await close();
      assert.ok(await H.until(`(()=>{const sc=[...document.querySelectorAll('#stage .desk[data-id] svg.scene')].filter(s=>s.getClientRects().length);return sc.length>=12&&sc.every(s=>(s.dataset.sig||'').includes(${jsLiteral('|' + kit)}))&&!document.querySelector(${jsLiteral('#stage ' + CREW_IMG)});})()`, 10000), `${where}: The theme's own: ${kit} figures back, no portrait left (${JSON.stringify(await desks())})`);
    }
    // a theme switch keeps the chosen crew: Cheeky on Retro, then Corporate
    await pickTheme('retro');
    await pickChars('cheeky');
    await pickTheme('corporate');
    assert.ok(await H.until(`(document.querySelector('#chList [data-characters="theme"]')||{}).textContent.includes('Corporate figures')`, 4000), `${tag}: the theme's own figures follow a theme switch in open Settings`);
    assert.strictEqual(await H.js(`document.querySelector('#chList [data-characters="cheeky"]').getAttribute('aria-pressed')`), 'true', `${tag}: Cheeky stays pressed after a theme switch`);
    await close();
    assert.ok(await H.until(`window.THEME.sceneKit()==='crew'&&document.querySelectorAll(${jsLiteral('#stage .desk[data-id] svg.scene ' + CREW_IMG)}).length>=12`, 10000), `${tag}: the crew stays on the new theme`);
    await pickChars('theme');
    await close();
    console.log(`[characters] ${tag} ok`, JSON.stringify(await desks()));
  }
  console.log('[characters] checks passed');
  process.exitCode = 0;
};
