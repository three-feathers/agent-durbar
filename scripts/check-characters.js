/*
 * Characters, separate from themes (spec 077 FR-064..FR-069, issue #814). Simulator only (DURBAR_SIM=15 DURBAR_SIM_FREEZE=1), no AI credits.
 *
 * At 1440x900 and 1280x800, on Retro Pixel (the one built-in theme with a dark floor; Clean Office is the other), everything through Settings (the real path):
 *   - the Characters section is right after Theme, lists The theme's own, Minimalist, Cheeky, Prehistoric, Pirate, Monster, Royal and Animal Rebels, each with a preview figure, and names the
 *     theme's own figures; it fits the window (no page overflow);
 *   - Cheeky: every desk scene draws the crew kit with a portrait, the theme stays the one picked, the choice is announced;
 *   - a theme switch with Cheeky keeps the crew on the new theme;
 *   - The theme's own: Retro's pixel figures come back, no portrait is left;
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

const THEMES = [['retro', 'pixel', 'Pixel figures']];
const CREW_IMG = 'image[href*="crew/art/"]';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const out = process.env.SHOTS_OUT || path.join(os.tmpdir(), 'characters-shots');
  fs.mkdirSync(out, { recursive: true });
  /* the desk scenes on screen: how many, how many draw each kit (the kit is the last part of a kit scene's signature) and how many hold a portrait */
  const desks = () => H.js(`(()=>{const sc=[...document.querySelectorAll('#stage .desk[data-id] svg.scene')].filter(s=>s.getClientRects().length);
    const kit=(s)=>{const m=/\\|(pixel|crew)(\\||$)/.exec(s.dataset.sig||'');return m?m[1]:'office';};
    const by={};for(const s of sc){const k=kit(s);by[k]=(by[k]||0)+1;}
    return {n:sc.length,by,pics:sc.filter(s=>s.querySelector(${jsLiteral(CREW_IMG)})).length,anyPic:document.querySelectorAll(${jsLiteral('#stage ' + CREW_IMG)}).length};})()`);
  /* issue 839: what the app holds when a crew step times out (it only failed on the macOS runner, never on a Mac at scale 1 or 2 or under reduced
     motion): the next nightly says why instead of only "timed out" */
  const why = async () => (await whyNow()) + ' ' + (await afterRender());
  /* the state is read only when a step fails: a forced redraw on a passing step would change what the next step sees */
  /* ui-suite shows a failure's last 25 log lines cut at 240 characters (and the message at 300): the state goes out as short [why] lines first */
  const must = async (ok, msg) => {
    if (ok) return;
    const w = await why().catch((e) => 'diagnostic failed: ' + e.message);
    for (let i = 0; i < w.length; i += 200) console.log('[why] ' + w.slice(i, i + 200));
    assert.fail(msg + ' (the state is in the [why] lines above)');
  };
  /* the state now; then the same after a forced full redraw (render(): layout key reset): signatures that change there mean the office skipped those
     desks, signatures that stay mean the crew map itself holds the old crew (issue 839, run 42205363015: the Royal "king" still drawn under Rebels) */
  const afterRender = async () => { const r0 = await H.js(`window.__durbarSimUi.ops().renders`); await H.js(`window.__durbarSimUi.render();true`); await H.until(`window.__durbarSimUi.ops().renders>${jsLiteral(r0)}`, 5000); return 'after a full redraw: ' + (await H.js(`JSON.stringify({map:[...new Set(Object.values(window.__durbarSimUi.crew.state().map))].slice(0,6),sigs:[...new Set([...document.querySelectorAll('#stage .desk[data-id] svg.scene')].map(s=>(s.dataset.sig||'').split('|').slice(3).join('|')))].slice(0,4)})`)); };
  const whyNow = () => H.js(`JSON.stringify({chars:window.THEME.characters(),kit:window.THEME.sceneKit(),theme:window.THEME.current().id,settings:!!document.getElementById('chList'),sceneOut:document.querySelectorAll('.scene-out').length,renders:(window.__durbarSimUi&&window.__durbarSimUi.ops?window.__durbarSimUi.ops().renders:-1),vis:document.visibilityState,focus:document.hasFocus(),map:[...new Set(Object.values(window.__durbarSimUi.crew.state().map))].slice(0,6),sigs:[...new Set([...document.querySelectorAll('#stage .desk[data-id] svg.scene')].map(s=>(s.dataset.sig||'').split('|').slice(3).join('|')))].slice(0,4)})`);
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
    assert.ok(await H.until(`document.querySelector(${jsLiteral(`#chList [data-characters="${v}"]`)}).getAttribute('aria-pressed')==='true'`, 3000), `characters ${v}: the list shows the choice at once`);
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
    await H.office(15);
    assert.strictEqual(await H.js(`window.THEME.characters()`), 'theme', `${tag}: The theme's own is the default`);
    for (const [theme, kit, own] of THEMES) {
      const where = `${tag} ${theme}`;
      await pickTheme(theme);
      // the section: after Theme, four choices with a preview each, the theme's own named
      assert.ok(await H.until(`(document.querySelector('#chList [data-characters="theme"]')||{}).textContent&&document.querySelector('#chList [data-characters="theme"]').textContent.includes(${jsLiteral(own)})`, 4000), `${where}: The theme's own follows the theme (${own})`);
      const sc = await section();
      assert.ok(sc.afterTheme, `${where}: Characters comes right after Theme`);
      assert.deepStrictEqual(sc.items.map((i) => i.id), ['theme', 'office', 'minimalist', 'cheeky', 'prehistoric', 'pirate', 'monster', 'royal', 'rebels', 'retro'], `${where}: the ten choices in order: Office people right after the default (spec 102 FR-321), Retro pixel always listed (FR-320)`);
      assert.deepStrictEqual(sc.items.map((i) => i.pressed), ['true', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false'], `${where}: the default is pressed`);
      for (const i of sc.items) {
        assert.ok(i.svg, `${where}: ${i.id} has a preview figure`);
        assert.ok(i.minFont >= 10.5, `${where}: ${i.id}: text is at least 10.5px (${i.minFont})`);
        assert.ok(/^Characters /.test(i.label), `${where}: ${i.id} has a name (${i.label})`);
      }
      assert.ok(sc.items.find((i) => i.id === 'cheeky').pic, `${where}: the Cheeky preview is a portrait`);
      assert.ok(sc.items.find((i) => i.id === 'prehistoric').pic, `${where}: the Prehistoric preview is a portrait (spec 077 FR-072)`);
      assert.ok(sc.items.find((i) => i.id === 'pirate').pic, `${where}: the Pirate preview is a portrait (spec 077 FR-074)`);
      assert.ok(sc.items.find((i) => i.id === 'monster').pic, `${where}: the Monster preview is a portrait (spec 077 FR-075)`);
      assert.ok(sc.items.find((i) => i.id === 'royal').pic, `${where}: the Royal preview is a portrait (spec 077 FR-076)`);
      assert.ok(sc.items.find((i) => i.id === 'rebels').pic, `${where}: the Animal Rebels preview is a portrait (spec 077 FR-077)`);
      assert.ok(!sc.items.find((i) => i.id === 'minimalist').pic && !sc.items.find((i) => i.id === 'theme').pic, `${where}: the other previews are drawn figures`);
      /* spec 102 FR-320, FR-321: the two set entries show the set's own picture; the flag is closed here, so Retro pixel is disabled and says so (name and label) */
      const setPic = await H.js(`['office','retro'].map(id=>{const b=document.querySelector('#chList [data-characters="'+id+'"]'),im=b.querySelector('.chsw image');return {id,href:im?im.getAttribute('href'):'',disabled:b.disabled,label:b.getAttribute('aria-label'),sub:(b.querySelector('small')||{}).textContent}})`);
      assert.ok(/sets\/office\/p01-typeA/.test(setPic[0].href) && /sets\/retro\/p01-typeA/.test(setPic[1].href), `${where}: the set previews are the sets' own pictures (${JSON.stringify(setPic)})`);
      assert.strictEqual(setPic[0].disabled, false, `${where}: Office people can be picked`);
      assert.ok(setPic[1].disabled && /Not open yet$/.test(setPic[1].label) && setPic[1].sub === 'Not open yet', `${where}: the retro flag is closed: Retro pixel is disabled and its name says "Not open yet" (${JSON.stringify(setPic[1])})`);
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
      await must(await H.until(`(()=>{const sc=[...document.querySelectorAll('#stage .desk[data-id] svg.scene')].filter(s=>s.getClientRects().length);return sc.length>=12&&sc.every(s=>/\\|crew(\\||$)/.test(s.dataset.sig||'')&&s.querySelector(${jsLiteral(CREW_IMG)}));})()`, 10000), `${where}: Cheeky: every desk draws the crew kit with a portrait (${JSON.stringify(await desks())})`);
      assert.strictEqual(await H.js(`window.THEME.current().id`), theme, `${where}: the theme stays ${theme}`);
      assert.strictEqual(await H.js(`window.THEME.themeKit()`), kit, `${where}: the theme's own kit is unchanged`);
      await H.clearToasts();
      await H.shot(path.join(out, `077-characters-cheeky-${theme}-${tag}.png`), { prep: 'calm' }); // the pointer off the desks (no hover pencil), no toast
      // Prehistoric on top of the theme (FR-072): the crew kit with a Prehistoric picture on every desk
      await pickChars('prehistoric');
      await close();
      await must(await H.until(`(()=>{const sc=[...document.querySelectorAll('#stage .desk[data-id] svg.scene')].filter(s=>s.getClientRects().length);return sc.length>=12&&sc.every(s=>/\\|crew(\\||$)/.test(s.dataset.sig||'')&&s.querySelector('image[href*="crew/art/prehistoric-"]'));})()`, 10000), `${where}: Prehistoric: every desk draws the crew kit with a Prehistoric portrait`);
      assert.strictEqual(await H.js(`window.THEME.current().id`), theme, `${where}: the theme stays ${theme} under Prehistoric`);
      assert.ok(await H.until(`document.querySelectorAll('#stage image[href^="crew/art/"]:not([href*="prehistoric-"])').length===0`, 3000), `${where}: no Cheeky picture under Prehistoric`);
      // Pirate on top of the theme (FR-074): the crew kit with a Pirate picture on every desk
      await pickChars('pirate');
      await close();
      await must(await H.until(`(()=>{const sc=[...document.querySelectorAll('#stage .desk[data-id] svg.scene')].filter(s=>s.getClientRects().length);return sc.length>=12&&sc.every(s=>/\\|crew(\\||$)/.test(s.dataset.sig||'')&&s.querySelector('image[href*="crew/art/pirate-"]'));})()`, 10000), `${where}: Pirate: every desk draws the crew kit with a Pirate portrait`);
      assert.strictEqual(await H.js(`window.THEME.current().id`), theme, `${where}: the theme stays ${theme} under Pirate`);
      assert.ok(await H.until(`document.querySelectorAll('#stage image[href^="crew/art/"]:not([href*="pirate-"])').length===0`, 3000), `${where}: no other crew's picture under Pirate`); // waits like the Prehistoric line above: the desks repaint a moment after the pick
      // Monster on top of the theme (FR-075): the crew kit with a Monster picture on every desk
      await pickChars('monster');
      await close();
      await must(await H.until(`(()=>{const sc=[...document.querySelectorAll('#stage .desk[data-id] svg.scene')].filter(s=>s.getClientRects().length);return sc.length>=12&&sc.every(s=>/\\|crew(\\||$)/.test(s.dataset.sig||'')&&s.querySelector('image[href*="crew/art/monster-"]'));})()`, 10000), `${where}: Monster: every desk draws the crew kit with a Monster portrait`);
      assert.strictEqual(await H.js(`window.THEME.current().id`), theme, `${where}: the theme stays ${theme} under Monster`);
      assert.ok(await H.until(`document.querySelectorAll('#stage image[href^="crew/art/"]:not([href*="monster-"])').length===0`, 3000), `${where}: no other crew's picture under Monster`); // waits for the repaint like the Prehistoric and Pirate lines (FR-048b)
      // Royal on top of the theme (FR-076): the crew kit with a Royal picture on every desk
      await pickChars('royal');
      await close();
      await must(await H.until(`(()=>{const sc=[...document.querySelectorAll('#stage .desk[data-id] svg.scene')].filter(s=>s.getClientRects().length);return sc.length>=12&&sc.every(s=>/\\|crew(\\||$)/.test(s.dataset.sig||'')&&s.querySelector('image[href*="crew/art/royal-"]'));})()`, 10000), `${where}: Royal: every desk draws the crew kit with a Royal portrait`);
      assert.strictEqual(await H.js(`window.THEME.current().id`), theme, `${where}: the theme stays ${theme} under Royal`);
      assert.ok(await H.until(`document.querySelectorAll('#stage image[href^="crew/art/"]:not([href*="royal-"])').length===0`, 3000), `${where}: no other crew's picture under Royal`); // waits for the repaint like the Prehistoric, Pirate and Monster lines (FR-048b)
      // Animal Rebels on top of the theme (FR-077): the crew kit with an Animal Rebels picture on every desk
      await pickChars('rebels');
      await close();
      await must(await H.until(`(()=>{const sc=[...document.querySelectorAll('#stage .desk[data-id] svg.scene')].filter(s=>s.getClientRects().length);return sc.length>=12&&sc.every(s=>/\\|crew(\\||$)/.test(s.dataset.sig||'')&&s.querySelector('image[href*="crew/art/rebels-"]'));})()`, 10000), `${where}: Animal Rebels: every desk draws the crew kit with an Animal Rebels portrait`);
      assert.strictEqual(await H.js(`window.THEME.current().id`), theme, `${where}: the theme stays ${theme} under Animal Rebels`);
      assert.ok(await H.until(`document.querySelectorAll('#stage image[href^="crew/art/"]:not([href*="rebels-"])').length===0`, 3000), `${where}: no other crew's picture under Animal Rebels`); // waits for the repaint like the other crews' lines (FR-048b)
      // Minimalist on top of the theme
      await pickChars('minimalist');
      await close();
      await must(await H.until(`(()=>{const sc=[...document.querySelectorAll('#stage .desk[data-id] svg.scene')].filter(s=>s.getClientRects().length);return sc.length>=12&&sc.every(s=>!/\\|(pixel|crew)(\\||$)/.test(s.dataset.sig||''))&&!document.querySelector(${jsLiteral('#stage ' + CREW_IMG)});})()`, 10000), `${where}: Minimalist: the office figure on every desk (${JSON.stringify(await desks())})`);
      // back to Cheeky, then The theme's own: the theme's figures come back
      await pickChars('cheeky');
      await close();
      assert.ok(await H.until(`document.querySelectorAll(${jsLiteral('#stage .desk[data-id] svg.scene ' + CREW_IMG)}).length>=12`, 10000), `${where}: Cheeky again`);
      await pickChars('theme');
      await close();
      await must(await H.until(`(()=>{const sc=[...document.querySelectorAll('#stage .desk[data-id] svg.scene')].filter(s=>s.getClientRects().length);return sc.length>=12&&sc.every(s=>(s.dataset.sig||'').includes(${jsLiteral('|' + kit)}))&&!document.querySelector(${jsLiteral('#stage ' + CREW_IMG)});})()`, 10000), `${where}: The theme's own: ${kit} figures back, no portrait left (${JSON.stringify(await desks())})`);
    }
    // a theme switch keeps the chosen crew: Cheeky on Retro, then Clean Office
    // the loop above ends on Retro: picking it again would repaint the Characters list late and race the next click
    assert.strictEqual(await H.js(`window.THEME.current().id`), 'retro', `${tag}: Retro is the theme here`);
    await pickChars('cheeky');
    await pickTheme('clean-office');
    assert.ok(await H.until(`(document.querySelector('#chList [data-characters="theme"]')||{}).textContent.includes('Minimalist figures')`, 4000), `${tag}: the theme's own figures follow a theme switch in open Settings`);
    assert.strictEqual(await H.js(`document.querySelector('#chList [data-characters="cheeky"]').getAttribute('aria-pressed')`), 'true', `${tag}: Cheeky stays pressed after a theme switch`);
    await close();
    assert.ok(await H.until(`window.THEME.sceneKit()==='crew'&&document.querySelectorAll(${jsLiteral('#stage .desk[data-id] svg.scene ' + CREW_IMG)}).length>=12`, 10000), `${tag}: the crew stays on the new theme`);
    await pickChars('theme');
    await close();
    // spec 102 T291 (FR-320..FR-322): Retro pixel while its flag is closed (a click changes nothing), a saved Retro pixel with the flag closed (kept, the line says what is drawn), and open (a normal pick)
    await openSettings();
    await H.clearToasts();
    await H.js(`document.querySelector('#chList [data-characters="retro"]').click()`);
    await H.settle(); // a refused click has no event to wait for: the page settles, then the state must be as it was
    assert.strictEqual(await H.js(`window.THEME.characters()`), 'theme', `${tag}: a click on the closed Retro pixel changes nothing`);
    assert.strictEqual(await H.js(`document.querySelector('#chList [data-characters="retro"]').getAttribute('aria-pressed')`), 'false', `${tag}: and does not press it`);
    await pickChars('office');
    assert.strictEqual(await H.js(`window.THEME.sceneKit()`), 'office', `${tag}: Office people in Flat draw the theme's own figures until Flat has their heads (T294)`);
    await close();
    await H.load({ w, h, query: { characters: 'retro' }, ready: 'fit', settle: false });
    await H.office(15);
    assert.strictEqual(await H.js(`window.THEME.characters()`), 'retro', `${tag}: a saved Retro pixel is kept while its flag is closed`);
    await openSettings();
    assert.strictEqual(await H.js(`document.getElementById('chNote').textContent`), 'Real office shows Office people until Retro pixel is open in Real office. Flat draws the theme\u2019s own figures until then.', `${tag}: the line under the list says what is drawn meanwhile`);
    await close();
    await H.load({ w, h, query: { worldflags: 'retro' }, ready: 'fit', settle: false });
    await H.office(15);
    await pickChars('retro');
    assert.strictEqual(await H.js(`document.getElementById('chNote').textContent`), '', `${tag}: flag open: a normal pick, no line`);
    assert.strictEqual(await H.js(`document.querySelector('#chList [data-characters="retro"]').disabled`), false, `${tag}: flag open: Retro pixel is not disabled`);
    await close();
    console.log(`[characters] ${tag} ok`, JSON.stringify(await desks()));
  }
  console.log('[characters] checks passed');
  process.exitCode = 0;
};
