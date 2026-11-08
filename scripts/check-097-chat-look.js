/*
 * The chat's look follows the Office layout setting for every chat (spec 097 Changes 2026-11-04, issue #1140): the simulator only, no real
 * session, no account, no AI credits.
 *
 *   npm run build
 *   SHOTS_OUT=<dir> DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/check-097-chat-look.js npx electron .        (xvfb-run -a ... --no-sandbox on Linux)
 *
 * At 1440x900 and 1280x800 it fails (exit 1) when, in Real office:
 *   - a main session's chat and a helper's chat of that session do not carry the same world look: html[data-world] set, the same panel
 *     surface, and no picture behind the text (the helper's read-only panel once had the class `ro`, the Real office root's, and took
 *     the room's floor picture and corners);
 *   - any element of the chat panel carries the class `ro`;
 *   - with a chat open, switching to Open office does not give the flat look back, or switching back to Real office does not bring the
 *     world look (and, on a main chat, the header portrait) back without reopening the chat.
 * Screenshots: <SHOTS_OUT>/chatlook-<main|helper>-<w>x<h>.png.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-097-chatlook-'));
const SIZES = [[1440, 900], [1280, 800]];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
  /* the chat's key styles: the world on the page, the panel's surface, and any picture behind the panel's text */
  const LOOK = `(()=>{const p=document.getElementById('panel'),pi=p.querySelector('.panel-in'),cs=e=>getComputedStyle(e);
    const pics=[p,...p.querySelectorAll('*')].filter(e=>e.id!=='roPortrait'&&!e.closest('#roPortrait,.avatar,.sitem,.strip')&&/url\\(/.test(cs(e).backgroundImage)).map(e=>e.id||e.className);
    return {world:document.documentElement.dataset.world||'',panelBg:cs(p).backgroundColor,innerBg:cs(pi).backgroundColor,innerImg:cs(pi).backgroundImage,pics,
      roClass:[...p.querySelectorAll('.ro')].length+(p.classList.contains('ro')?1:0),roChat:document.body.classList.contains('ro-chat'),portrait:!!document.getElementById('roPortrait')};})()`;
  const openChat = async (id, name) => {
    await js(`window.__durbarSimUi.crew.openPanel(${jsLiteral(id)})`);
    await must(`document.body.classList.contains('panel-open')&&(document.getElementById('panelTitle')||{}).textContent===${jsLiteral(name)}`, 'the chat of ' + name);
    await H.settle();
  };
  const back = async () => { await js(`document.getElementById('backBtn').click()`); await must(`!document.body.classList.contains('panel-open')`, 'back to the office'); };

  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    await H.load({ w, h, query: { officeview: 'real' }, ready: REAL, settle: false });
    await must(`[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`, 'the pictures');
    await H.settle();
    /* a main session that has helpers, and one of its helpers */
    const pair = await js(`(()=>{const all=window.__durbarSimUi.agents();const k=all.find(a=>a.parent&&a.live&&all.some(m=>m.id===a.parent&&!m.parent));if(!k)return null;const m=all.find(x=>x.id===k.parent);return {main:{id:m.id,name:m.name},helper:{id:k.id,name:k.name}};})()`);
    assert.ok(pair, `${tag}: the simulator has a main session with a live helper`);

    await openChat(pair.main.id, pair.main.name);
    const main = await js(LOOK);
    await H.shot(path.join(OUT, `chatlook-main-${tag}.png`), { prep: 'calm', settle: true, tag: 'chatlook', what: `main ${pair.main.name} ${tag}` });
    await back();
    await openChat(pair.helper.id, pair.helper.name);
    const helper = await js(LOOK);
    await H.shot(path.join(OUT, `chatlook-helper-${tag}.png`), { prep: 'calm', settle: true, tag: 'chatlook', what: `helper ${pair.helper.name} ${tag}` });
    console.log('[097-chatlook]', tag, JSON.stringify({ main, helper }));

    for (const [who, s] of [['main', main], ['helper', helper]]) {
      assert.ok(s.world, `${tag}: the ${who} chat is shown with a world on the page`);
      assert.strictEqual(s.roClass, 0, `${tag}: no element of the ${who} chat carries the Real office root's class "ro"`);
      assert.strictEqual(s.innerImg, 'none', `${tag}: no picture behind the ${who} chat's text (.panel-in background-image ${s.innerImg})`);
      assert.deepStrictEqual(s.pics, [], `${tag}: no picture under the ${who} chat's text`);
    }
    assert.strictEqual(helper.panelBg, main.panelBg, `${tag}: the helper's chat has the main chat's world surface`);
    assert.strictEqual(helper.innerBg, main.innerBg, `${tag}: the helper's chat panel has the main chat's background`);
    assert.ok(main.roChat && main.portrait, `${tag}: the main chat has the world's header portrait`);

    /* the setting changes while a chat is open: Open office gives the flat look back at once, Real office brings the world back, no reopening */
    await js(`window.__durbarSimUi.setOfficeView('flat')`);
    await must(`!document.documentElement.dataset.world`, 'the flat look with the helper chat open');
    const flatH = await js(LOOK);
    assert.notStrictEqual(flatH.panelBg, helper.panelBg, `${tag}: Open office changes the open helper chat's surface`);
    await js(`window.__durbarSimUi.setOfficeView('real')`);
    await must(`!!document.documentElement.dataset.world&&getComputedStyle(document.getElementById('panel')).backgroundColor===${jsLiteral(helper.panelBg)}`, 'the world look back on the open helper chat');
    assert.strictEqual((await js(LOOK)).innerImg, 'none', `${tag}: after switching back, still no picture behind the helper chat's text`);
    await back();
    await openChat(pair.main.id, pair.main.name);
    await js(`window.__durbarSimUi.setOfficeView('flat')`);
    await must(`!document.documentElement.dataset.world&&!document.getElementById('roPortrait')&&!document.body.classList.contains('ro-chat')`, 'the flat look with the main chat open');
    const flatM = await js(LOOK);
    assert.strictEqual(flatM.panelBg, flatH.panelBg, `${tag}: in Open office the main and helper chats share the flat surface`);
    await js(`window.__durbarSimUi.setOfficeView('real')`);
    await must(`!!document.documentElement.dataset.world&&getComputedStyle(document.getElementById('panel')).backgroundColor===${jsLiteral(main.panelBg)}&&!!document.getElementById('roPortrait')`, 'the world look and the portrait back on the open main chat', 20000);
    await back();
  }
  console.log('[097-chatlook] ok');
};
