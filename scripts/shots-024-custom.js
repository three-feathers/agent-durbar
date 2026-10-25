/*
 * Checks + screenshots for spec 024 custom places (issue #115, FR-018..FR-026): the lobby tiles, the Add / Edit dialog, Settings > Your places.
 * Simulator only (no AI credits, no Copilot login). Frozen simulator, so the open calls are fixed:
 *
 *   npm run build
 *   SHOTS_024=$(mktemp -d) DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 [DURBAR_SIM_PLACES=3] \
 *     DURBAR_DRIVER=$PWD/scripts/shots-024-custom.js npx electron .        (xvfb-run -a ... --no-sandbox on Linux)
 *
 * With DURBAR_SIM_PLACES=3 (main passes ?simplaces=3) the first part checks the seeded state: three custom tiles after the five built-ins, one
 * 24-character name ellipsized with its full name in the tooltip and label, my-notes and playwright visits going to the seeded places, no Add
 * button at the cap. It then deletes the three places through Settings (an agent standing at one walks back) so the scenarios start from none.
 * Without it the driver starts from none directly (the seeding path is then not covered: it says so).
 * Scenarios 1-7 of the 2026-10-18 delta (#115) follow, then the 15-agent fit with three 24-character names at both sizes and the screenshots
 * (SHOTS_024, default the system temp dir; docs/screenshots is not written). Matches places by data-place ids, never by their words.
 * The simulator's pg-tools server stands in for a user's server: it is introduced by one call. A miss prints DRIVER FAILED (Electron still exits 0):
 * look for '[024c] all checks passed' in the output.
 */
const os = require('os');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const assert = require('assert');
const OUT = process.env.SHOTS_024 || os.tmpdir();
const SIZES = [[1440, 900], [1280, 800]];
const LOBBY_H = 58; // the tile height since spec 001 FR-034 (a header row and a row of who is there); it was 36 in spec 024's first version
const LONG = ['Customer support desk 01', 'Customer support desk 02', 'Customer support desk 03'];

module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-097: shared plumbing
  const { js } = H;
  const q = jsLiteral; /* CodeQL js/bad-code-sanitization: values spliced into page code go through jsLiteral */
  const shot = (name, w, h) => H.shot(path.join(OUT, `024-custom-${name}-${w}x${h}.png`), { delay: 300, tag: '024c', what: `024-custom-${name}-${w}x${h}.png` });
  /* ctx.waitFor returns false on a timeout: a miss must fail the driver */
  const W = async (expr, ms, what) => { assert.ok(await ctx.waitFor(expr, ms), 'timed out waiting for ' + (what || expr)); };
  const settle = async () => { await W(`!document.querySelector('.walker.walking')`, 6000, 'the walks to end'); await ctx.sleep(250); };
  /* the places of spec 024 only: the fixed tiles of spec 001 FR-034..FR-040 (Boss queue, Coffee, Bank, Postbox) are not places a server can map to */
  const PLACES = '#stage .place:not([data-place="boss"],[data-place="coffee"],[data-place="bank"],[data-place="postbox"])';
  const tiles = () => js(`[...document.querySelectorAll(${q(PLACES)})].map(p=>({id:p.dataset.place,name:p.querySelector('.pn').textContent,label:p.getAttribute('aria-label'),title:p.title,clipped:p.querySelector('.pn').scrollWidth>p.querySelector('.pn').clientWidth,busy:p.classList.contains('busy')}))`);
  const custom = async () => (await tiles()).filter((t) => /^c-/.test(t.id));
  /* what the desk says about the agent's place: the title of its task line holds taskOf(), which the live readout ("Replying: ...") does not replace (spec 001 live activity) */
  const card = (id) => js(`(()=>{const d=document.querySelector('#stage .desk[data-id=${q(id)}]');return d?{away:d.classList.contains('is-away'),text:((d.querySelector('.intent, .task')||{}).title||(d.querySelector('.intent, .task')||{}).textContent||'').trim()}:null})()`);
  const away = () => js(`[...document.querySelectorAll('#stage .desk.is-away')].map(d=>({id:d.dataset.id,place:d.dataset.place||'',text:((d.querySelector('.intent, .task')||{}).title||(d.querySelector('.intent, .task')||{}).textContent||'').trim()}))`);
  const idle = (n, skip = []) => js(`[...document.querySelectorAll('#stage .desk:not(.is-away)')].filter(d=>/is-(idle|done)/.test(d.className)&&!${q(skip)}.includes(d.dataset.id)).slice(0,${n}).map(d=>d.dataset.id)`);
  let seq = 0;
  const call = (who, phase, server, tool, n) => js(`window.__durbarSimEmit({type:'toolCall',sessionId:${q(who)},timestamp:Date.now(),callId:${q('c024-' + n)},tool:${q(server + '-' + tool)},phase:${q(phase)},mcpServer:${q(server)},mcpTool:${q(tool)}})`);
  const visit = async (who, server, tool) => { const n = ++seq; await call(who, 'start', server, tool, n); await W(`!!document.querySelector('#stage [data-id=${q(who)}].is-away')`, 4000); await settle(); return n; };
  const finish = async (who, server, tool, n) => { await call(who, 'complete', server, tool, n); await W(`!document.querySelector('#stage [data-id=${q(who)}].is-away')`, 8000); await settle(); };
  const openSettings = async () => { await js(`document.getElementById('settingsBtn').click()`); await W(`!!document.querySelector('#myPlaces, #plList')`, 5000); await ctx.sleep(300); };
  /* bring the Places section to the top of the Settings scroll area (never the page) and let the toasts fade */
  const scrollPlaces = async () => { await ctx.sleep(3600); await js(`(()=>{const c=document.querySelector('#screen .scr-body'),sec=document.getElementById('plH').closest('.scr-sec');c.scrollTop+=sec.getBoundingClientRect().top-c.getBoundingClientRect().top-16})()`); await ctx.sleep(400); };
  const closeSettings = async () => { await js(`document.getElementById('scrClose').click()`); await ctx.sleep(400); };
  const dlgOpen = () => W(`!!document.querySelector('#scrDlg')`, 3000);
  const dlgClosed = () => W(`!document.querySelector('#scrDlg')`, 4000);
  const clickBtn = (scope, text) => js(`(()=>{const b=[...document.querySelectorAll(${q(scope)})].find(b=>b.textContent.trim()===${q(text)});if(!b)return false;b.click();return true})()`);
  /* fill the Add / Edit dialog (name, icon id) and press Save; returns the error text next to the field ('' when it closed) */
  const fillSave = async (name, icon) => {
    const iconClick = icon ? `document.querySelector(${q(`input[name="plIcon"][value="${icon}"]`)}).click();` : '';
    await js(`(()=>{const i=document.getElementById('plName');i.value=${q(name)};i.dispatchEvent(new Event('input',{bubbles:true}));${iconClick}})()`);
    await clickBtn('#scrDlg .dbtn button', 'Save'); await ctx.sleep(500);
    return js(`(()=>{const e=document.getElementById('plNameErr');return document.getElementById('scrDlg')&&e&&!e.hidden?e.textContent:''})()`);
  };
  const focused = () => js(`(()=>{const a=document.activeElement;return {act:(a.dataset&&a.dataset.plAct)||'',place:(a.closest&&a.closest('li')&&a.closest('li').dataset.place)||'',tile:(a.classList&&a.classList.contains('place')&&a.dataset.place)||'',add:!!(a.classList&&a.classList.contains('place-add')),id:a.id||''}})()`);
  const addViaLobby = async (name, icon) => { await js(`document.querySelector('.place-add').click()`); await dlgOpen(); const err = await fillSave(name, icon); if (!err) await dlgClosed(); await ctx.sleep(300); return err; };
  const cancelDlg = async () => { await clickBtn('#scrDlg .dbtn button', 'Cancel'); await dlgClosed(); };
  const myPlaces = () => js(`[...document.querySelectorAll('#myPlaces li')].map(l=>({id:l.dataset.place,name:l.querySelector('.plname').textContent.trim()}))`);
  const rowOf = (srv) => js(`(()=>{const r=document.querySelector('#plList .plrow[data-srv=${q(srv)}]');if(!r)return null;const s=r.querySelector('select');return {value:s.value,shown:s.options[s.selectedIndex].textContent.trim(),options:[...s.options].map(o=>o.value)}})()`);
  const setRow = async (srv, value) => { await js(`(()=>{const s=document.querySelector('#plList .plrow[data-srv=${q(srv)}] select');s.value=${q(value)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`); await ctx.sleep(500); };
  const rowBtn = (name, act) => js(`(()=>{const l=[...document.querySelectorAll('#myPlaces li')].find(l=>l.querySelector('.plname').textContent.trim()===${q(name)});const b=l&&l.querySelector('[data-pl-act=${q(act)}]');if(!b)return false;b.click();return true})()`);
  const onSlots = () => js(`(()=>{const sl=[...document.querySelectorAll('.lobby .slot.on')].map(e=>e.getBoundingClientRect());const bad=[];document.querySelectorAll('#walkers .walker').forEach(w=>{const b=w.getBoundingClientRect(),cx=b.left+b.width/2,cy=b.top+b.height/2;if(!sl.some(s=>Math.abs(s.left+s.width/2-cx)<4&&Math.abs(s.top+s.height/2-cy)<4))bad.push([Math.round(cx),Math.round(cy)]);});return bad})()`);
  /* the lobby stays one row and every tile is inside it */
  const lobbyFits = () => js(`(()=>{const L=document.querySelector('#stage .lobby').getBoundingClientRect();const bad=[];[...document.querySelectorAll('#stage .lobby .place, #stage .lobby .place-add')].forEach(p=>{const b=p.getBoundingClientRect();if(b.left<L.left-1||b.right>L.right+1||b.top<L.top-1||b.bottom>L.bottom+1)bad.push(p.dataset.place||'add');});[...document.querySelectorAll('#stage .lobby .place')].forEach(pl=>{const P=pl.getBoundingClientRect();pl.querySelectorAll('.pic, .pn, .prow, .slot').forEach(e=>{const b=e.getBoundingClientRect();if(b.left<P.left-1||b.right>P.right+1||b.top<P.top-1||b.bottom>P.bottom+1)bad.push((pl.dataset.place||'?')+' '+e.className);});});const ys=new Set([...document.querySelectorAll('#stage .lobby .place')].map(p=>Math.round(p.getBoundingClientRect().top)));return {h:Math.round(L.height),rows:ys.size,bad,fit:document.getElementById('stage').dataset.fit}})()`);

  ctx.win.setContentSize(1280, 800); await ctx.sleep(1800);
  await settle();

  // ---- DURBAR_SIM_PLACES=3: the seeded state (T022) ----
  let t0 = await tiles();
  if (t0.filter((t) => /^c-/.test(t.id)).length) {
    const cs = t0.filter((t) => /^c-/.test(t.id));
    assert.strictEqual(cs.length, 3, 'DURBAR_SIM_PLACES=3 seeds three custom places');
    assert.deepStrictEqual(t0.slice(0, 5).map((t) => t.id), ['library', 'software', 'terminal', 'web', 'other'], 'the five built-in places come first, in order');
    assert.deepStrictEqual(cs.map((t) => t.name), ['Database', 'Ticket desk', 'Data analytics reporting'], 'seeded names, after the built-ins');
    assert.strictEqual(await js(`!!document.querySelector('.place-add')`), false, 'three custom places: no Add button in the lobby');
    for (const [w, h] of SIZES) {
      ctx.win.setContentSize(w, h); await ctx.sleep(900); await settle();
      const t = await custom(); const long = t[2];
      assert.ok(long.label.startsWith('Data analytics reporting:') && long.title.startsWith('Data analytics reporting:'), 'the full 24-character name is in the tooltip and the label');
      assert.ok(long.clipped, `${w}: the 24-character name is ellipsized in its tile`);
      const f = await lobbyFits(); assert.deepStrictEqual([f.h, f.rows, f.bad, f.fit], [LOBBY_H, 1, [], 'ok'], `${w}: one ${LOBBY_H}px row, every tile inside it, the office does not scroll: ` + JSON.stringify(f));
      assert.deepStrictEqual(await onSlots(), [], `${w}: figures on slots`);
      await shot('seeded-lobby', w, h);
    }
    const vs = await away();
    console.log('[024c] seeded visits', JSON.stringify(vs.map((v) => v.text.slice(0, 40))));
    /* by the desk's data-place, not its words: with Live activity the card says the command ("At Database: registerTool options"), not the server */
    assert.ok(vs.some((v) => cs.slice(0, 2).some((c) => c.id === v.place)), 'my-notes / playwright calls go to the seeded places');
    assert.ok(!vs.some((v) => v.place === 'library' || v.place === 'web'), 'and not to their default places (Library, Web)');
    // delete them through Settings (the walk back, FR-025); the agent at Database goes home
    const dbVisitor = vs.find((v) => v.place === cs[0].id);
    await openSettings();
    assert.deepStrictEqual((await myPlaces()).map((p) => p.name), ['Database', 'Ticket desk', 'Data analytics reporting']);
    assert.strictEqual(await js(`document.getElementById('plCapNote')&&document.getElementById('plCapNote').textContent`), 'Up to 3 places of your own.', 'at the cap Settings says so');
    assert.strictEqual(await js(`!!document.querySelector('[data-pl-act="add"]')`), false, 'and has no Add button');
    await scrollPlaces(); await shot('seeded-settings', 1280, 800);
    for (const name of ['Database', 'Ticket desk', 'Data analytics reporting']) {
      assert.ok(await rowBtn(name, 'delete'), 'Delete ' + name); await dlgOpen();
      if (name === 'Database') assert.ok(/my-notes/.test(await js(`document.querySelector('#scrDlg').textContent`)), 'the Delete dialog names the server that goes back to its default');
      await clickBtn('#scrDlg .dbtn button', 'Delete'); await dlgClosed(); await ctx.sleep(400);
    }
    assert.deepStrictEqual(await myPlaces(), [], 'all seeded places deleted');
    await closeSettings();
    if (dbVisitor) { await W(`!document.querySelector('#stage [data-id=${q(dbVisitor.id)}].is-away')`, 6000); }
    await settle();
    assert.deepStrictEqual((await tiles()).map((t) => t.id), ['library', 'software', 'terminal', 'web', 'other'], 'back to the five built-ins');
    console.log('[024c] seeded part passed');
  } else console.log('[024c] DURBAR_SIM_PLACES is not set: the seeding path is not covered by this run');

  ctx.win.setContentSize(1280, 800); await ctx.sleep(900); await settle();
  assert.strictEqual((await tiles()).length, 5, 'start from the five built-in places');

  // ---- scenario 7 (refusals) first, while it is cheap: terminal, blank, then a duplicate ----
  assert.ok(await js(`!!document.querySelector('.place-add')`), 'the Add button is in the lobby');
  assert.strictEqual(await js(`document.querySelector('.place-add').getAttribute('aria-label')`), 'Add a place', 'the Add button has an accessible name');
  await js(`document.querySelector('.place-add').click()`); await dlgOpen();
  assert.strictEqual(await js(`document.activeElement&&document.activeElement.id`), 'plName', 'the name field has focus');
  assert.strictEqual(await js(`document.querySelectorAll('#scrDlg input[name="plIcon"]').length`), 12, 'twelve icons');
  assert.strictEqual(await js(`document.querySelector('#scrDlg [role=radiogroup]').getAttribute('aria-label')`), 'Icon');
  assert.ok(await js(`[...document.querySelectorAll('#scrDlg .pico-opt')].every(l=>l.textContent.trim().length>2)`), 'every icon has an accessible name');
  await shot('dialog', 1280, 800);
  let err = await fillSave('terminal', 'star'); assert.strictEqual(err, 'A place with this name already exists.', 'terminal: name-taken, shown next to the field: ' + err);
  err = await fillSave('   ', 'star'); assert.strictEqual(err, 'Type a name for the place.', 'blank: name-empty');
  err = await fillSave('x'.repeat(25), 'star'); assert.strictEqual(err, 'Use 24 characters or fewer.', 'too long');
  err = await fillSave('Stay at Desk', 'star'); assert.strictEqual(err, 'A place with this name already exists.', 'reserved ignoring case');
  assert.strictEqual(await js(`!!document.querySelector('#scrDlg')&&document.getElementById('plNameErr').getAttribute('role')`), 'alert', 'the error is announced');
  await js(`document.getElementById('scrDlg').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await dlgClosed();
  assert.strictEqual((await tiles()).length, 5, 'refused adds create nothing, Esc closes the dialog');

  // ---- scenario 1: add Database from the lobby ----
  err = await addViaLobby('Database', 'database'); assert.strictEqual(err, '', 'Database saved');
  let t = await tiles();
  assert.deepStrictEqual(t.map((x) => x.name).slice(4), ['Other tools', 'Database'], 'a sixth tile, after Other tools');
  const dbId = t[5].id; assert.ok(/^c-[a-z0-9]{6}$/.test(dbId), 'custom id ' + dbId);
  assert.ok(await js(`!!document.querySelector('.place-add')`), 'still room for more: the Add button stays');
  err = await addViaLobby('database', 'star'); assert.strictEqual(err, 'A place with this name already exists.', 'scenario 7: duplicate ignoring case'); await cancelDlg();
  await openSettings();
  assert.deepStrictEqual((await myPlaces()).map((p) => p.name), ['Database'], 'Settings lists it under Your places');

  // ---- scenario 2: pg-tools -> Database ----
  await closeSettings();
  const [a1] = await idle(1);
  let n = await visit(a1, 'pg-tools', 'query'); assert.ok(/^At Other tools: pg-tools/.test((await card(a1)).text), 'pg-tools starts at Other tools: ' + (await card(a1)).text); await finish(a1, 'pg-tools', 'query', n);
  await openSettings();
  const r0 = await rowOf('pg-tools'); assert.ok(r0 && r0.shown === 'Default (Other tools)' && r0.options.includes(dbId), 'the pg-tools row lists the custom place: ' + JSON.stringify(r0));
  assert.strictEqual(await js(`[...document.querySelectorAll('#plList .plrow[data-srv="pg-tools"] option')].find(o=>o.value===${q(dbId)}).textContent`), 'Database', 'the dropdown shows the place by name');
  await setRow('pg-tools', dbId); await closeSettings();
  n = await visit(a1, 'pg-tools', 'query');
  assert.match((await card(a1)).text.split(' · ')[0], /^At Database: pg-tools[- ]query$/, /* the tool's name, spelled as the visit labels it */ 'the next call walks to Database and the card says so: ' + (await card(a1)).text);
  assert.ok((await tiles()).find((x) => x.id === dbId).busy, 'the Database tile is busy');
  assert.deepStrictEqual(await onSlots(), [], 'figure on a slot');

  // ---- scenario 3: rename keeps the mapping, redraws, nobody walks ----
  await openSettings(); assert.ok(await rowBtn('Database', 'edit')); await dlgOpen();
  assert.strictEqual(await js(`document.getElementById('plName').value`), 'Database', 'Edit starts with the current name');
  assert.strictEqual(await js(`document.querySelector('input[name="plIcon"]:checked').value`), 'database', 'and the current icon');
  err = await fillSave('Data warehouse', 'cloud'); assert.strictEqual(err, ''); await dlgClosed(); await ctx.sleep(600);
  assert.deepStrictEqual(await focused(), { act: 'edit', place: dbId, tile: '', add: false, id: '' }, 'after Save in Settings, focus is on that place\'s Edit button');
  await closeSettings(); await ctx.sleep(300);
  assert.strictEqual(await js(`document.querySelectorAll('.walker.walking').length`), 0, 'no agent walks after a rename');
  assert.strictEqual((await tiles()).find((x) => x.id === dbId).name, 'Data warehouse', 'the tile shows the new name');
  assert.match((await card(a1)).text.split(' · ')[0], /^At Data warehouse: pg-tools[- ]query$/, 'and so does the card');
  assert.strictEqual((await card(a1)).away, true, 'the agent is still there');
  await finish(a1, 'pg-tools', 'query', n);
  n = await visit(a1, 'pg-tools', 'query'); assert.ok(/^At Data warehouse/.test((await card(a1)).text), 'the mapping survived the rename');

  // ---- escaping: a name with markup is text everywhere ----
  await openSettings(); assert.ok(await rowBtn('Data warehouse', 'edit')); await dlgOpen();
  err = await fillSave('<b>x</b> "q"', 'bolt'); assert.strictEqual(err, ''); await dlgClosed();
  const escS = await js(`({opt:[...document.querySelectorAll('#plList .plrow[data-srv="pg-tools"] option')].find(o=>o.value===${q(dbId)}).textContent,list:document.querySelector('#myPlaces .plname').textContent.trim(),bold:document.querySelectorAll('#myPlaces b, #plList b').length})`);
  assert.strictEqual(escS.opt, '<b>x</b> "q"', 'Settings option is text'); assert.strictEqual(escS.list, '<b>x</b> "q"', 'Settings list is text'); assert.strictEqual(escS.bold, 0);
  await closeSettings(); await ctx.sleep(300);
  /* other <b> exist now (agent names in tiles and desks); the one the name would inject holds "x" */
  const esc1 = await js(`({pn:document.querySelector('#stage .place[data-place=${q(dbId)}] .pn').textContent,bold:[...document.querySelectorAll('#stage b')].filter(b=>b.textContent==='x').length,card:document.querySelector('#stage .desk[data-id=${q(a1)}] .intent, #stage .desk[data-id=${q(a1)}] .task').textContent,lbl:document.querySelector('#stage .place[data-place=${q(dbId)}]').getAttribute('aria-label')})`);
  assert.strictEqual(esc1.pn, '<b>x</b> "q"', 'tile name is text'); assert.strictEqual(esc1.bold, 0, 'no element was made from the name');
  assert.ok(esc1.card.startsWith('At <b>x</b> "q": pg-tools'), 'card text is text: ' + esc1.card); 
  assert.ok(esc1.lbl.startsWith('<b>x</b> "q":'), 'accessible label is text');
  await openSettings(); assert.ok(await rowBtn('<b>x</b> "q"', 'edit')); await dlgOpen();
  assert.strictEqual(await js(`document.getElementById('plName').value`), '<b>x</b> "q"', 'the edit field holds the text');
  err = await fillSave('Data warehouse', 'cloud'); assert.strictEqual(err, ''); await dlgClosed(); await closeSettings();
  await finish(a1, 'pg-tools', 'query', n);

  // ---- scenario 4: delete with an agent standing there ----
  n = await visit(a1, 'pg-tools', 'query');
  await openSettings(); assert.ok(await rowBtn('Data warehouse', 'delete')); await dlgOpen();
  const dtext = await js(`document.querySelector('#scrDlg .dsub').textContent`);
  assert.ok(/pg-tools goes back to its default place/.test(dtext), 'Delete names the server: ' + dtext);
  await clickBtn('#scrDlg .dbtn button', 'Cancel'); await dlgClosed();
  assert.ok((await tiles()).some((x) => x.id === dbId), 'Cancel keeps the place');
  assert.ok(await rowBtn('Data warehouse', 'delete')); await dlgOpen();
  await clickBtn('#scrDlg .dbtn button', 'Delete'); await dlgClosed(); await ctx.sleep(600);
  assert.ok((await js(`[...document.querySelectorAll('#toasts .toast')].map(t=>t.textContent)`)).includes('Data warehouse was deleted.'), 'the delete toast names the place');
  assert.strictEqual((await focused()).act, 'add', 'after Delete, focus is on Add a place');
  const r4 = await rowOf('pg-tools'); assert.strictEqual(r4.shown, 'Default (Other tools)', 'the pg-tools row shows the default again'); await closeSettings();
  assert.ok(!(await tiles()).some((x) => x.id === dbId), 'the tile is gone');
  await W(`!document.querySelector('#stage [data-id=${q(a1)}].is-away')`, 8000);
  assert.strictEqual((await card(a1)).away, false, 'the agent walked back to its desk');
  await call(a1, 'complete', 'pg-tools', 'query', n); await settle();
  n = await visit(a1, 'pg-tools', 'query'); assert.ok(/^At Other tools: pg-tools/.test((await card(a1)).text), 'its next call goes to Other tools: ' + (await card(a1)).text); await finish(a1, 'pg-tools', 'query', n);

  // ---- scenario 5: three places, the Add button goes, a fourth through IPC is refused ----
  for (const [i, nm] of LONG.entries()) {
    err = await addViaLobby(nm, 'chat'); assert.strictEqual(err, '', 'added ' + nm); await ctx.sleep(200);
    const fo = await focused(), last = (await custom()).pop();
    if (i < 2) assert.ok(fo.add, 'while the Add button exists, focus returns to it after an add');
    else assert.strictEqual(fo.tile, last.id, 'after the third add the button is gone: focus moves to the new tile');
  }
  assert.strictEqual(await js(`!!document.querySelector('.place-add')`), false, 'at the cap the Add button is gone');
  assert.strictEqual((await tiles()).length, 8);
  // one label path: every place name drawn (tile text, tooltip, label, Settings options and list) must come from placeLabel -> DurbarPlaces.placeName
  const MARK = ' [L]';
  const redraw = async () => { await js(`document.querySelector('.stat[data-k="waiting"]').click();document.querySelector('.stat[data-k="waiting"]').click()`); await ctx.sleep(600); };
  // placeLabel takes a built-in place's name from the theme's words (spec 036: themes rename places) and a custom place's from
  // DurbarPlaces.placeName, so both sources are marked; anything drawn without placeLabel stays unmarked and fails below
  await js(`(()=>{const P=window.DurbarPlaces,T=window.THEME;P.__orig=P.placeName;P.placeName=(id,c)=>P.__orig(id,c)+${q(MARK)};T.__origWord=T.word;T.word=(k)=>{const w=T.__origWord(k);return /^place-/.test(k)?w+${q(MARK)}:w};return 0})()`); await redraw();
  const marked = await js(`[...document.querySelectorAll(${q(PLACES)})].map(p=>({pn:p.querySelector('.pn').textContent,title:p.title,label:p.getAttribute('aria-label')}))`);
  assert.strictEqual(marked.length, 8);
  marked.forEach((m) => { assert.ok(m.pn.endsWith(MARK) && m.title.includes(MARK) && m.label.includes(MARK), 'the tile bypasses placeLabel: ' + JSON.stringify(m)); });
  await openSettings();
  const markedS = await js(`({opts:[...[...document.querySelectorAll('#plList .plrow')][0].querySelector('select').options].map(o=>o.textContent),list:[...document.querySelectorAll('#myPlaces .plname')].map(e=>e.textContent.trim())})`);
  assert.ok(markedS.opts.slice(1, 9).every((t) => t.endsWith(MARK)), 'Settings options bypass placeLabel: ' + JSON.stringify(markedS.opts));
  assert.ok(/^Default \(.*\[L\]\)$/.test(markedS.opts[0]), 'the Default (...) option bypasses placeLabel: ' + markedS.opts[0]);
  assert.ok(markedS.list.every((t) => t.endsWith(MARK)), 'Your places list bypasses placeLabel');
  await js(`window.DurbarPlaces.placeName=window.DurbarPlaces.__orig;window.THEME.word=window.THEME.__origWord;0`); await closeSettings(); await redraw();
  // (the refusal of a fourth add by the IPC, `limit`, is covered by test-credits and test-places: the page keeps its bridge private)
  await openSettings();
  assert.strictEqual(await js(`document.getElementById('plCapNote').textContent`), 'Up to 3 places of your own.');
  assert.strictEqual(await js(`!!document.querySelector('[data-pl-act="add"]')`), false);
  const opts = await js(`[...document.querySelectorAll('#plList .plrow')][0].querySelector('select').options.length`);
  assert.strictEqual(opts, 1 + 5 + 3 + 1, 'every dropdown: default, five places, three of your own, stay at desk');
  await scrollPlaces(); await shot('settings', 1280, 800);
  await closeSettings();

  // ---- scenario 6 + FR-026: 15 agents, three 24-character names, both sizes ----
  const ids = (await tiles()).filter((x) => /^c-/.test(x.id));
  const cust = ids.map((x) => x.id);
  const [b1, b2] = await idle(2);
  await openSettings(); await setRow('my-notes', cust[0]); await setRow('playwright', cust[1]); await closeSettings();
  const m1 = await visit(b1, 'my-notes', 'search_notes'); const m2 = await visit(b2, 'playwright', 'browser_snapshot');
  for (const [w, h] of SIZES) {
    ctx.win.setContentSize(w, h); await ctx.sleep(900); await settle();
    const tl = await tiles(); const cs = tl.filter((x) => /^c-/.test(x.id));
    assert.deepStrictEqual(cs.map((x) => x.name), LONG);
    cs.forEach((x) => { assert.ok(x.label.startsWith(x.name + ':') && x.title.startsWith(x.name + ':'), 'full name in label and tooltip'); });
    assert.ok(cs.every((x) => x.clipped) || w >= 1440, `${w}: long names ellipsize when the tile is narrow`);
    const f = await lobbyFits(); assert.deepStrictEqual([f.h, f.rows, f.bad, f.fit], [LOBBY_H, 1, [], 'ok'], `${w}: one row, inside, no scrolling: ` + JSON.stringify(f));
    assert.deepStrictEqual(await onSlots(), [], `${w}: figures on slots`);
    assert.ok(cs.some((x) => x.busy), 'visitors are in the custom tiles');
    await shot('lobby', w, h);
  }
  await finish(b1, 'my-notes', 'search_notes', m1); await finish(b2, 'playwright', 'browser_snapshot', m2);
  console.log('[024c] all checks passed');
};
