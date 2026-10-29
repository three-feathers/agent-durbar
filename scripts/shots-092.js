/*
 * Checks + screenshots for spec 092 phase 1 (floors as places: floor screens). Simulator only (no AI credits, no Copilot login):
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 DURBAR_SIM_FLOORS=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-092.js npx electron .        (xvfb-run -a ... --no-sandbox on Linux)
 *
 * Real key presses (sendInputEvent) and clicks, at 1440x900 and 1280x800; every wait is a condition (until), and the driver exits non-zero on a miss:
 *   US1 / FR-001  three floors on: the office shows one floor's rooms (every floor tag the same), the three floors together hold the 15 agents once,
 *                 and the shared lobby is there. The pills keep counting the whole building (FR-017).
 *   FR-011/FR-012 PageDown / PageUp (the keys of this platform: none are modified) change the floor at once, skipping nothing that is on, with exactly one
 *                 announcement "Floor <name>, <n> of <m>" per change; at the first or last floor nothing happens and nothing is announced.
 *   FR-011        the key keeps its own meaning in a select, in the composer of an open chat and under a dialog (the palette): the floor does not change.
 *   T038          a floor screen that scrolls (15 agents on one floor, a short window) scrolls on PageDown and changes floor only from the edge:
 *                 a press that reaches the bottom does not also change floor.
 *   FR-022        the current floor survives a reload; a saved floor that is off is replaced by the first floor that is on.
 *   FR-023        the current floor switched off: the view moves at once to the next floor that is on (else the previous) and says so; switching a floor on
 *                 does not move the user; Show only makes that floor current.
 *   FR-004        one floor on: nothing changes (every desk drawn, no floor tags) and PageDown does nothing.
 *   edge case     a floor with no agents says so and keeps the lobby (simfloors=ground).
 *   FR-020/21     a visitor of a floor that is not on screen is in the lobby with its floor in the label and without a walk.
 * Screenshots: 092-floor-{ground,clienta,personal,empty}-<w>x<h>.png
 */
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';
const SIZES = [[1440, 900], [1280, 800]];
const MOD = process.platform === 'darwin' ? 'meta' : 'control'; // the command palette's key; PageUp/PageDown are the same on every platform (Fn+Up/Down on a Mac laptop)

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until, settle, key } = H;
  const T0 = Date.now(), lap = (what) => console.log(`[092] ${what} at ${Math.round((Date.now() - T0) / 1000)} s`); // where the time goes (the driver has to stay well under the suite's 600 s)
  const shot = (name, w, h) => H.shot(path.join(OUT, `092-floor-${name}-${w}x${h}.png`), { tag: '092', what: `${name} ${w}x${h}` });

  /* announcements: every non-empty text that reaches #srAnnounce, in order (installed after each load) */
  const watch = () => js(`(()=>{window.__ann=[];const el=document.getElementById('srAnnounce');new MutationObserver(()=>{const t=el.textContent;if(t)window.__ann.push(t);}).observe(el,{childList:true,characterData:true,subtree:true});})()`);
  const annEq = async (want, msg) => { if (want.length) await until(`JSON.stringify(window.__ann.filter(t=>/^Floor /.test(t)))===${jsLiteral(JSON.stringify(want))}`, 3000); assert.deepStrictEqual(await ann(), want, msg); }; // announce() speaks 60 ms after the change: wait for what is expected
  const ann = () => js(`window.__ann.filter(t=>/^Floor /.test(t))`); // the palette and other parts announce too: only the floor announcements are counted
  /* what the office shows now */
  const view = () => js(`(()=>{
    const tags=[...new Set([...document.querySelectorAll('#stage .room-head .floor-tag, #stage .plate .floor-tag')].map(t=>t.textContent.trim()))];
    const desks=[...document.querySelectorAll('#stage .desk[data-id]')].filter(d=>!d.closest('.helpers')).map(d=>d.dataset.id);
    const pills=[...document.querySelectorAll('#stats .stat[data-k] b')].reduce((n,b)=>n+(+b.textContent||0),0);
    const fl=document.getElementById('floor');
    return {tags,desks,rooms:[...document.querySelectorAll('#stage .room-name')].map(e=>e.textContent.trim()),pills,lobby:!!document.querySelector('#stage .lobby'),
      empty:(document.querySelector('#stage .floor-empty')||{}).textContent||'',scrolls:fl.classList.contains('scrolls'),top:fl.scrollTop,max:fl.scrollHeight-fl.clientHeight,
      btn:document.getElementById('floorsBtn').textContent.trim(),pref:localStorage.getItem('durbar.floor')};})()`);
  const onFloor = (name) => until(`(()=>{const t=[...new Set([...document.querySelectorAll('#stage .room-head .floor-tag')].map(t=>t.textContent.trim()))];return t.length===1&&t[0]===${jsLiteral(name)}})()`);
  const emptyOn = (name) => until(`(document.querySelector('#stage .floor-empty')||{}).textContent&&document.querySelector('#stage .floor-empty').textContent.includes(${jsLiteral(name)})`);
  const reset = async (w, h, query) => {
    await js(`localStorage.removeItem('durbar.floor')`); // from the page that is open (same origin): the saved floor is read at start
    await H.load({ w, h, query, focus: true });
    await watch(); await H.calm();
  };
  const panel = async (open) => { await js(`(()=>{const p=document.getElementById('floorsPop');if(p.hidden===${open})document.getElementById('floorsBtn').click();})()`); await until(`document.getElementById('floorsPop').hidden===${!open}`); };
  const floorSw = async (id, want) => { await panel(true); const on = await js(`document.querySelector(${jsLiteral(`[data-fl="on"][data-floor="${id}"]`)}).getAttribute('aria-pressed')==='true'`); if (on !== want) await js(`document.querySelector(${jsLiteral(`[data-fl="on"][data-floor="${id}"]`)}).click()`); await until(`document.querySelector(${jsLiteral(`[data-fl="on"][data-floor="${id}"]`)}).getAttribute('aria-pressed')===${jsLiteral(want ? 'true' : 'false')}`); await panel(false); };
  const only = async (id) => { await panel(true); await js(`document.querySelector(${jsLiteral(`[data-fl="only"][data-floor="${id}"]`)}).click()`); await until(`document.getElementById('floorsBtn').hidden||document.getElementById('floorsBtn').textContent.trim().startsWith('1/')`); await panel(false); };
  const pressUntilTag = async (k, name) => { await key(k); assert.ok(await onFloor(name), `${k} should show ${name}`); await settle(); };

  const ONLY = process.env.SHOTS_092_ONLY || ''; // a developer aid: `scroll` or `lobby` runs that block only
  for (const [w, h] of ONLY ? [] : SIZES) {
    const tag = `${w}x${h}`;
    // ---- US1, FR-001, FR-017: one floor at a time, the whole building in the counts ----
    await reset(w, h, { simfloors: '1' });
    let v = await view();
    assert.strictEqual(v.btn, '3/3', `${tag}: precondition: three floors on`);
    assert.strictEqual(v.pills, 15, `${tag}: the pills count the whole building (15), not the floor`);
    assert.strictEqual(v.tags.length, 1, `${tag}: one floor shown, tags ${JSON.stringify(v.tags)}`);
    assert.strictEqual(v.tags[0], 'Ground floor', `${tag}: starts on the first floor that is on`);
    assert.ok(v.lobby, `${tag}: the shared lobby is on the floor screen`);
    const seen = { 'Ground floor': v };
    await shot('ground', w, h);

    lap(`${tag} one floor at a time done`);
    // ---- FR-011, FR-012: PageDown / PageUp, one announcement per change, nothing at the ends ----
    await pressUntilTag('PageDown', 'Client A'); seen['Client A'] = await view();
    assert.ok(seen['Client A'].lobby && seen['Client A'].pills === 15, `${tag}: lobby and whole-building pills on Client A`);
    await shot('clienta', w, h);
    await pressUntilTag('PageDown', 'Personal'); seen.Personal = await view();
    await shot('personal', w, h);
    await annEq(['Floor Client A, 2 of 3', 'Floor Personal, 3 of 3'], `${tag}: one announcement per change`);
    await key('PageDown'); // the last floor: nothing
    await key('PageUp'); assert.ok(await onFloor('Client A'), `${tag}: PageUp from the last floor`); await settle();
    await pressUntilTag('PageUp', 'Ground floor');
    await key('PageUp'); // the first floor: nothing
    await key('PageDown'); assert.ok(await onFloor('Client A'), `${tag}: PageDown after a no-op PageUp`); await settle();
    await annEq(['Floor Client A, 2 of 3', 'Floor Personal, 3 of 3', 'Floor Client A, 2 of 3', 'Floor Ground floor, 1 of 3', 'Floor Client A, 2 of 3'], `${tag}: nothing was announced at the ends`);
    const all = Object.values(seen).flatMap((s) => s.desks);
    assert.strictEqual(new Set(all).size, 15, `${tag}: the three floors hold the 15 agents once (${all.length} desks, ${new Set(all).size} distinct)`);
    assert.strictEqual(all.length, 15, `${tag}: no agent on two floors`);
    for (const a of Object.values(seen)) for (const b of Object.values(seen)) if (a !== b) assert.ok(!a.rooms.some((r) => b.rooms.includes(r)), `${tag}: a room on two floors`);

    lap(`${tag} keys done`);
    // ---- FR-022: the floor survives a reload; a saved floor that is off gives way to the first floor that is on ----
    assert.strictEqual((await view()).pref.length > 0, true, `${tag}: the current floor is saved`);
    await H.load({ w, h, query: { simfloors: '1' }, focus: true }); await watch();
    assert.ok(await onFloor('Client A'), `${tag}: Client A after a reload`);
    await H.load({ w, h, query: { simfloors: '1', floorsoff: 'Client A' }, focus: true }); await watch();
    assert.ok(await onFloor('Ground floor'), `${tag}: the saved floor is off: the first floor that is on`);

    lap(`${tag} reload done`);
    // ---- FR-011: the key keeps its meaning where text or a choice is edited ----
    await reset(w, h, { simfloors: '1' });
    const pref0 = (await view()).pref;
    assert.ok(pref0, `${tag}: precondition: a current floor is saved`);
    // the select takes the key for its own choice (the folder filter moves to the next folder); the floor stays and nothing is announced.
    // The key goes through the OS focus and the select's own handling, so on a busy runner it can land late (or, with the window not focused, not at all):
    // the window owns the focus first, the select's value is waited for (not read once after a fixed pause), and one more press if the first was lost
    const ownFocus = async () => { for (let i = 0; i < 3; i++) { ctx.win.show(); ctx.win.focus(); ctx.win.webContents.focus(); if (await until('document.hasFocus()', 3000)) return true; } return false; };
    assert.ok(await ownFocus(), `${tag}: the window owns the focus before the key`);
    const used = `document.getElementById('wsFilter').value!=='all'`;
    for (let tries = 0; tries < 2 && !(await js(used)); tries++) {
      await js(`document.getElementById('wsFilter').focus()`);
      await key('PageDown');
      await until(used, 4000);
      if (!(await js(used))) await ownFocus();
    }
    assert.ok(await until(used), `${tag}: the select used the key`);
    await settle();
    assert.strictEqual((await view()).pref, pref0, `${tag}: PageDown in the folder select does not change the floor`);
    await annEq([], `${tag}: and nothing was announced`);
    await js(`(()=>{const s=document.getElementById('wsFilter');s.value='all';s.dispatchEvent(new Event('change',{bubbles:true}));s.blur();})()`);
    assert.ok(await onFloor('Ground floor'), `${tag}: the floor is the same`);
    await key('K', [MOD], { char: 'never' }); assert.ok(await until(`!!document.getElementById('palDlg')`), `${tag}: the palette opens`);
    await key('PageDown'); await settle();
    await key('Escape'); assert.ok(await until(`!document.getElementById('palDlg')`));
    assert.ok(await onFloor('Ground floor'), `${tag}: PageDown under the palette does not change the floor`);
    await annEq([], `${tag}: and nothing was announced`);
    await js(`document.querySelector('#stage .desk[data-id]').click()`);
    assert.ok(await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('msgInput')`), `${tag}: the chat opens`);
    await js(`document.getElementById('msgInput').focus()`);
    await key('PageDown'); await settle();
    await annEq([], `${tag}: nothing announced for the composer`);
    await js(`document.getElementById('backBtn').click()`);
    assert.ok(await until(`!document.body.classList.contains('panel-open')`), `${tag}: back to the office`);
    assert.ok(await onFloor('Ground floor'), `${tag}: PageDown in the composer does not change the floor`);
    await annEq([], `${tag}: and nothing was announced on the way back`);

    lap(`${tag} text and dialogs done`);
    // ---- FR-023: floors going off and on ----
    await reset(w, h, { simfloors: '1' });
    await pressUntilTag('PageDown', 'Client A');
    await js(`window.__ann.length=0`);
    await floorSw('f-clienta0', false); // the current floor goes off: the next floor that is on
    assert.ok(await onFloor('Personal'), `${tag}: the current floor went off: Personal`);
    await annEq(['Floor Personal, 2 of 2'], `${tag}: and it says so`);
    await floorSw('f-clienta0', true); // switching on does not move the user
    await settle();
    assert.ok(await onFloor('Personal'), `${tag}: switching a floor on does not move the user`);
    await annEq(['Floor Personal, 2 of 2'], `${tag}: and says nothing`);
    await floorSw('f-personal', false); // the last floor goes off: the previous one
    assert.ok(await onFloor('Client A'), `${tag}: the last floor went off: the previous floor`);
    await floorSw('f-clienta0', false); // one floor on: the building is one screen again
    assert.ok(await until(`document.querySelectorAll('#stage .floor-tag').length===0&&document.querySelectorAll('#stage .desk[data-id]').length>0`), `${tag}: one floor on: no tags`);
    v = await view();
    assert.strictEqual(v.btn, '1/3');
    await js(`window.__ann.length=0`);
    await key('PageDown'); await settle();
    await annEq([], `${tag}: PageDown with one floor on does nothing`);
    // Show only: one floor on, every desk of the floor drawn; all rooms of the other floors are not
    await floorSw('f-clienta0', true); await floorSw('f-personal', true);
    await only('f-personal');
    assert.ok(await until(`document.querySelectorAll('#stage .floor-tag').length===0&&document.querySelectorAll('#stage .desk[data-id]').length>0`), `${tag}: Show only: one floor, no tags`);
    await floorSw('ground', true); // Personal stays the current floor
    assert.ok(await onFloor('Personal'), `${tag}: after Show only, the chosen floor is the current one`);
    // a floor between: Client A off, Ground floor current, PageDown skips it
    await reset(w, h, { simfloors: '1', floorsoff: 'Client A' });
    assert.ok(await onFloor('Ground floor'));
    await key('PageDown'); assert.ok(await onFloor('Personal'), `${tag}: PageDown skips a floor that is off`);
    await annEq(['Floor Personal, 2 of 2'], `${tag}: announced as 2 of 2`);

    lap(`${tag} floors off and on done`);
    // ---- one floor on: the office is as before ----
    await reset(w, h, { simfloors: '1', floorsoff: 'Client A,Personal' });
    v = await view();
    assert.strictEqual(v.tags.length, 0, `${tag}: one floor on: no floor tags`);
    assert.ok(v.desks.length > 0 && v.pref, `${tag}: one floor on: desks drawn`);

    lap(`${tag} one floor on done`);
    // ---- an empty floor ----
    await reset(w, h, { simfloors: 'ground' });
    v = await view();
    assert.strictEqual(v.btn, '3/3', `${tag}: precondition: three floors on`);
    assert.strictEqual(v.desks.length, 15, `${tag}: every agent is on the Ground floor`);
    await key('PageDown');
    assert.ok(await emptyOn('Client A'), `${tag}: an empty floor says so`);
    v = await view();
    assert.ok(v.lobby && v.desks.length === 0 && /Move a folder here/.test(v.empty), `${tag}: the empty floor keeps the lobby: ${JSON.stringify({ lobby: v.lobby, desks: v.desks.length, empty: v.empty })}`);
    await shot('empty', w, h);
    lap(`${tag} empty floor done`);
  }

  // ---- T038, FR-011: a floor screen that scrolls scrolls first and changes floor only from an edge ----
  if (!ONLY || ONLY === 'scroll') {
    const [w, h] = [1100, 430]; // 15 agents on one floor in a short window: the Ground floor screen scrolls (spec 001)
    const tag = `${w}x${h}`;
    await reset(w, h, { simfloors: 'ground' });
    let v = await view();
    assert.strictEqual(v.btn, '3/3', `${tag}: precondition: three floors on`);
    assert.ok(v.scrolls && v.max > 50, `${tag}: precondition: the Ground floor screen scrolls (scrolls ${v.scrolls}, ${v.max}px to scroll)`);
    assert.strictEqual(v.top, 0, `${tag}: precondition: at the top`);
    await js(`document.getElementById('floor').focus?0:0`);
    let presses = 0;
    for (; presses < 40; presses++) {
      v = await view();
      if (v.top >= v.max - 1) break;
      const before = v.top;
      await key('PageDown');
      assert.ok(await until(`document.getElementById('floor').scrollTop>${jsLiteral(before)}`), `${tag}: PageDown scrolls the floor screen (at ${before} of ${v.max})`);
      await settle();
      assert.ok((await view()).tags.includes('Ground floor') || (await view()).rooms.length > 0, `${tag}: still the Ground floor while it scrolls`);
      assert.strictEqual((await view()).pref, v.pref, `${tag}: a press that scrolls does not change the floor`);
    }
    v = await view();
    assert.ok(presses >= 1 && v.top >= v.max - 1, `${tag}: the screen was scrolled to its bottom edge in ${presses} presses`);
    assert.ok(v.desks.length > 0 && !v.empty, `${tag}: the press that reached the bottom did not also change floor`);
    await annEq([], `${tag}: and announced nothing`);
    await key('PageDown'); // from the edge: the next floor
    assert.ok(await emptyOn('Client A'), `${tag}: from the bottom edge PageDown goes to the next floor`);
    await annEq(['Floor Client A, 2 of 3'], `${tag}: once`);
    await key('PageUp'); // up the building: the floor above, at its bottom edge
    assert.ok(await until(`!document.querySelector('#stage .floor-empty')&&document.querySelectorAll('#stage .desk[data-id]').length>0`), `${tag}: PageUp goes back to the Ground floor`);
    v = await view();
    assert.ok(v.top >= v.max - 1, `${tag}: arriving from below lands at the bottom edge (${v.top} of ${v.max})`);
    const top1 = v.top;
    await key('PageUp');
    assert.ok(await until(`document.getElementById('floor').scrollTop<${jsLiteral(top1)}`), `${tag}: PageUp scrolls up inside the floor first`);
    assert.ok(!(await view()).empty, `${tag}: PageUp inside a scrolling floor stays on the floor`);
  }

  // ---- FR-020, FR-021: a visitor of a floor that is not on screen is in the lobby, with its floor in the label, without a walk ----
  if (!ONLY || ONLY === 'lobby') {
    for (const [w, h] of SIZES) {
      const tag = `${w}x${h}`;
      await reset(w, h, { simfloors: '1' });
      assert.ok(await until(`document.querySelectorAll('.lobby .pv[data-visitor]').length>0`), `${tag}: precondition: the lobby has visitors`);
      const info = () => js(`(()=>{const cur=[...new Set([...document.querySelectorAll('#stage .room-head .floor-tag')].map(t=>t.textContent.trim()))][0];
        const mine=new Set([...document.querySelectorAll('#stage .desk[data-id]')].map(d=>d.dataset.id));
        const vs=[...document.querySelectorAll('.lobby .pv[data-visitor]')].map(e=>({id:e.dataset.visitor,mine:mine.has(e.dataset.visitor),label:e.getAttribute('aria-label')||e.title||'',txt:e.textContent}));
        return {cur,vs,walking:document.querySelectorAll('#walkers .walker.walking').length,figures:document.querySelectorAll('#walkers .walker').length};})()`);
      const i0 = await info();
      const others = i0.vs.filter((x) => !x.mine);
      assert.ok(others.length > 0, `${tag}: precondition: a visitor of another floor is in the lobby (${JSON.stringify(i0.vs.map((x) => [x.id, x.mine]))})`);
      // the place's accessible name names the floor of a visitor that is not on screen
      const labels = await js(`[...document.querySelectorAll('.lobby .place')].map(p=>p.getAttribute('aria-label')||'').join(' | ')`);
      assert.ok(/\((?:[^()]*, )(?:Ground floor|Client A|Personal)\)/.test(labels), `${tag}: a visitor of another floor has its floor in the label: ${labels.slice(0, 300)}`);
      assert.strictEqual(i0.walking, 0, `${tag}: no walk is drawn for them`);
      // The lobby's visitors are drawn from the agents' state by a render that may still be queued (a frame on a busy runner), so a set read from the DOM can be older than the
      // model, and the render that a floor change does at once then shows the newer set: that is not the lobby changing with the floor. So everything runs in one page task, where
      // nothing can be queued in between: a floor change and back (each renders at once from the model), then the set, a PageDown and the set again.
      const same = await js(`(()=>{const ids=()=>[...document.querySelectorAll('.lobby .pv[data-visitor]')].map(e=>e.dataset.visitor).sort().join();
        const press=k=>document.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true}));
        press('PageDown');press('PageUp');const a=ids();
        press('PageDown');return {a,b:ids(),walking:document.querySelectorAll('#walkers .walker.walking').length};})()`);
      assert.ok(await onFloor('Client A'), `${tag}: PageDown went to Client A`); await settle();
      assert.ok(same.a, `${tag}: precondition: visitors at the moment of the change`);
      assert.strictEqual(same.b, same.a, `${tag}: the lobby keeps the same visitors on every floor`);
      assert.strictEqual(same.walking, 0, `${tag}: no figure walks across a floor change`);
    }
  }
  console.log('shots-092: ok');
};
