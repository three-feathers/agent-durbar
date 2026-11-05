/*
 * Check for spec 097 Changes 2026-11-05 (issue #1193): one agent is one picture. With an agent's chat open, its row in the rail
 * (.sav), the chat header (#roPortrait in Real office, .avatar in the flat office) and its inbox faces (.ib-av) come from the same
 * source: the same picture file in Real office (the image src and the data-face key), the same drawing in the flat office, in
 * Flat with the theme's own people and with at least two crews. Simulator only (no AI credits).
 *   npm run check:ui -- --only check-097-one-face
 */
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');
const SIZES = [[1440, 900], [1280, 800]];
module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
  // the face of one place as {key, src, sig}: data-face, the picture file (if any), and the drawing with ids removed
  const FACE = `const face=e=>{if(!e)return null;const i=e.querySelector('img');return {key:e.dataset.face||'',src:i?i.getAttribute('src'):'',sig:e.innerHTML.replace(/ (id|clip-path|fill|href|xlink:href|mask|filter)="[^"]*(url\\(#|#)[^"]*"/g,'').replace(/ id="[^"]*"/g,'')};};`;
  const probe = (id) => js(`(()=>{${FACE}
    const row=document.querySelector('#stripList .sitem[data-sw=${jsLiteral(id)}] .sav'), real=document.body.classList.contains('ro-chat'),visiting=real&&!!(((document.getElementById('roPortrait')||{})._k||'').split('|')[5]),
      head=real?document.getElementById('roPortrait'):document.querySelector('#panelHead .avatar');
    return {real, visiting, rail:face(row), head:face(head), avatar:face(document.querySelector('#panelHead .avatar'))};})()`);
  const openChat = async (id, name) => {
    await js(`window.__durbarSimUi.crew.openPanel(${jsLiteral(id)})`);
    await must(`document.body.classList.contains('panel-open')&&(document.getElementById('panelTitle')||{}).textContent===${jsLiteral(name)}&&!!document.querySelector('#stripList .sitem[data-sw=${jsLiteral(id)}] .sav')`, 'the chat of ' + name);
    await H.settle();
  };
  const back = async () => { await js(`document.getElementById('backBtn').click()`); await must(`!document.body.classList.contains('panel-open')`, 'back to the office'); };
  const pickChars = async (v) => {
    if (!(await js(`!!document.getElementById('chList')`))) await js(`document.getElementById('settingsBtn').click()`);
    await must(`!!document.getElementById('chList')`, 'Settings Characters list');
    await js(`document.querySelector(${jsLiteral(`#chList [data-characters="${v}"]`)}).click()`);
    await must(`window.THEME.characters()===${jsLiteral(v)}`, 'characters ' + v);
    await js(`window.DurbarScreens.close()`);
    await must(`!document.getElementById('chList')`, 'Settings closed');
    await H.settle();
  };
  const same = (tag, p) => {
    const at = tag + ': ' + JSON.stringify(p).slice(0, 600);
    assert.ok(p.rail && p.head, `${at}: the rail row and the chat header both show a face`);
    assert.strictEqual(p.rail.key, p.head.key, `${at}: the rail row and the chat header have the same face key`);
    assert.strictEqual(p.rail.key, p.avatar.key, `${at}: the header avatar and the rail row have the same face key`);
    if (p.real) {
      assert.strictEqual(p.rail.src, p.head.src, `${at}: in Real office the rail row and the chat header show the same picture file`);
      assert.ok(!p.rail.src || p.rail.src.startsWith('realoffice/'), `${at}: in Real office the rail row shows the Real office picture`);
      assert.ok(p.rail.src ? p.rail.key === p.rail.src : /^initial\|/.test(p.rail.key), `${at}: the face key is the picture file, or the initial of an agent away from its desk`);
    } else {
      assert.ok(!p.rail.src.startsWith('realoffice/'), `${at}: the flat office draws no Real office picture`);
      assert.strictEqual(p.rail.sig, p.avatar.sig, `${at}: in the flat office the rail row and the chat header draw the same figure`);
    }
  };
  for (const [w, h] of SIZES) {
    // Real office
    await H.load({ w, h, query: { officeview: 'real' }, ready: REAL, settle: false });
    await must(`[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`, 'the pictures');
    await H.settle();
    const ids = await js(`window.__durbarSimUi.agents().filter(a=>!a.parent).slice(0,6).map(a=>({id:a.id,name:a.name}))`);
    assert.ok(ids.length >= 2, 'the simulator has agents');
    let pics = 0, away = 0;
    for (const a of ids) {
      await openChat(a.id, a.name);
      await must(`!!document.getElementById('roPortrait')`, 'the Real office header portrait of ' + a.name);
      const p = await probe(a.id);
      assert.ok(p.rail.src && p.head.src, `${w}x${h} real ${a.name}: every agent with a person shows a picture in the rail and the header, not a letter: ${JSON.stringify(p.rail.key)}`);
      pics++;
      if (p.visiting) away++;
      same(`${w}x${h} real ${a.name}`, p);
      await back();
    }
    assert.ok(away > 0, `${w}x${h}: at least one agent is away from its desk (visiting) and still has its picture`);
    assert.ok(pics > 0, `${w}x${h}: at least one agent at its desk shows a Real office picture in the header`);
    // Flat: the theme's own people and two crews
    await H.load({ w, h, settle: true });
    await js(`document.getElementById('settingsBtn').click()`);
    await must(`!!document.getElementById('chList')`, 'Settings Characters list');
    const crews = await js(`[...document.querySelectorAll('#chList [data-characters]')].map(b=>b.dataset.characters).filter(v=>v!=='theme'&&v!=='minimalist')`);
    assert.ok(crews.length >= 2, 'at least two crews are offered: ' + JSON.stringify(crews));
    for (const v of ['theme', 'minimalist', crews[0], crews[1]]) {
      await pickChars(v);
      for (const a of ids.slice(0, 2)) {
        await openChat(a.id, a.name);
        same(`${w}x${h} flat ${v} ${a.name}`, await probe(a.id));
        await back();
      }
    }
    console.log('[097-one-face]', `${w}x${h}`, 'ok', JSON.stringify(crews.slice(0, 2)));
  }
  console.log('check-097-one-face: all checks passed');
};
