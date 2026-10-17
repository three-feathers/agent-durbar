/*
 * Checks + screenshots for spec 024 (places in the office: lobby, walking figures, place per MCP server).
 * Simulator only (no AI credits, no Copilot login). Frozen simulator so the open calls are fixed:
 *
 *   npm run build
 *   SHOTS_024=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-024.js npx electron .        (xvfb-run -a ... --no-sandbox on Linux)
 *
 * It reads only the page (app.js keeps its state private) and exits non-zero (driver failure) on a miss:
 *   SC-001  every agent at a place is at the place its open call belongs to (bash -> Terminal, github -> Software library,
 *           playwright -> Web, my-notes -> Library), its desk shows the empty chair and its card says so; after a call ends the
 *           agent walks back to its desk.
 *   SC-003  a place chosen in Settings decides where the next call of that server goes. (The "survives a restart" part is the
 *           SettingsStore unit test in test-credits: the simulator keeps settings in memory.)
 *   Edge    figures stay on their slots after a window resize and after the full-screen chat was opened and closed; a status
 *           filter hides filtered-out agents in the lobby too; at most 3 figures walk at once; Demo mode hides the lobby.
 * A one-off call is sent with the simulator-only hook window.__durbarSimEmit (spec 010 dev/test infrastructure).
 */
const path = require('path');
const assert = require('assert');
const OUT = process.env.SHOTS_024 || '/tmp';
const SIZES = [[1440, 900], [1280, 800]];

module.exports = async (ctx) => {
  const js = (code) => ctx.js(code);
  const shot = async (name, w, h) => { await ctx.sleep(300); await ctx.shot(path.join(OUT, `024-${name}-${w}x${h}.png`)); console.log('[024] saved', name, w, h); };
  const settle = async () => { await ctx.waitFor(`!!document.querySelector('.place.busy')`, 6000); await ctx.waitFor(`!document.querySelector('.walker.walking')`, 6000); await ctx.sleep(200); };
  /* every figure must stand on a lit slot of the lobby */
  const onSlots = () => js(`(()=>{const sl=[...document.querySelectorAll('.lobby .slot.on')].map(e=>e.getBoundingClientRect());const bad=[];document.querySelectorAll('#walkers .walker').forEach(w=>{const b=w.getBoundingClientRect(),cx=b.left+b.width/2,cy=b.top+b.height/2;if(!sl.some(s=>Math.abs(s.left+s.width/2-cx)<4&&Math.abs(s.top+s.height/2-cy)<4))bad.push([Math.round(cx),Math.round(cy)]);});return {walkers:document.querySelectorAll('#walkers .walker').length,bad}})()`);
  /* what each card with an empty chair says: "At <Place>: <tool> · <task>" */
  const visits = () => js(`[...document.querySelectorAll('#stage .desk.is-away')].map(d=>{const t=((d.querySelector('.intent, .task')||{}).textContent||'').trim(),m=t.match(/^At (.+?): (.+?) · /);return {id:d.dataset.id,name:d.querySelector('.name').textContent.trim(),place:m&&m[1],label:m&&m[2]};})`);
  const placeOf = async (id) => (await visits()).find((v) => v.id === id)?.place || null;
  const expect = { bash: 'Terminal', github: 'Software library', playwright: 'Web', 'my-notes': 'Library' };

  for (const [w, h] of SIZES) {
    ctx.win.setContentSize(w, h);
    await ctx.sleep(1500);
    await settle();

    // SC-001: the right place for each open call, empty chair at the desk, figures on slots
    const vs = await visits();
    console.log('[024]', w, 'visits', JSON.stringify(vs.map((v) => `${v.name}@${v.place}:${v.label}`)));
    assert.ok(vs.length >= 3, 'several agents are in the lobby');
    for (const v of vs) {
      const key = Object.keys(expect).find((k) => v.label === k || (v.label || '').startsWith(k + ' '));
      assert.ok(key, `${v.name}: known open call (${v.label})`);
      assert.strictEqual(v.place, expect[key], `${v.name}: ${v.label} goes to ${expect[key]}`);
    }
    assert.ok(new Set(vs.map((v) => v.place)).size >= 3, 'at least three different places are in use');
    let s = await onSlots(); assert.deepStrictEqual(s.bad, [], 'figures stand on slots'); assert.ok(s.walkers >= 3);
    const label = await js(`document.querySelector('.place.busy').getAttribute('aria-label')`);
    assert.ok(/: [A-Z]/.test(label), 'a busy place names who is there: ' + label);
    await shot('lobby', w, h);

    // Edge: a resize moves the slots; the figures follow without a walk
    ctx.win.setContentSize(w - 120, h - 40); await ctx.sleep(700);
    s = await onSlots(); assert.deepStrictEqual(s.bad, [], 'figures on slots after a resize');
    ctx.win.setContentSize(w, h); await ctx.sleep(700);
    s = await onSlots(); assert.deepStrictEqual(s.bad, [], 'figures on slots after resizing back');

    // Edge: open the full-screen chat of a visiting agent and close it again
    await js(`document.querySelector('#stage .desk.is-away').click()`); await ctx.sleep(600);
    await js(`document.getElementById('backBtn').click()`); await ctx.sleep(700);
    s = await onSlots(); assert.deepStrictEqual(s.bad, [], 'figures on slots after the chat was closed'); assert.ok(s.walkers >= 3);

    // Edge: a status filter hides filtered-out agents in the lobby too
    await js(`document.querySelector('.stat[data-k="waiting"]').click()`); await ctx.sleep(500);
    const filtered = await js(`({walkers:document.querySelectorAll('#walkers .walker').length,busy:document.querySelectorAll('.place.busy').length})`);
    assert.deepStrictEqual(filtered, { walkers: 0, busy: 0 }, 'only Waiting agents shown: none of them is at a place');
    await js(`document.querySelector('.stat[data-k="waiting"]').click()`); await ctx.sleep(600);
    s = await onSlots(); assert.ok(s.walkers >= 3, 'filter cleared: the figures are back');
  }

  // a walk (mid-walk picture) and the walk back: one github call of an agent at its desk, then its end
  const [w, h] = SIZES[1];
  ctx.win.setContentSize(w, h); await ctx.sleep(800);
  const who = await js(`(()=>{const d=[...document.querySelectorAll('#stage .desk:not(.is-away)')].find(d=>/is-(idle|done)/.test(d.className));return d&&d.dataset.id})()`);
  assert.ok(who, 'an idle agent at its desk to send for a walk');
  const call = (n, phase) => js(`window.__durbarSimEmit({type:'toolCall',sessionId:${JSON.stringify(who)},timestamp:Date.now(),callId:'shots-024-${n}',tool:'github-search_issues',phase:'${phase}',mcpServer:'github',mcpTool:'search_issues'})`);
  await call(1, 'start');
  await ctx.waitFor(`!!document.querySelector('.walker.walking')`, 3000); await ctx.sleep(380);
  const walking = await js(`document.querySelectorAll('.walker.walking').length`);
  assert.ok(walking >= 1 && walking <= 3, 'at most 3 figures walk at once');
  await ctx.shot(path.join(OUT, `024-walking-${w}x${h}.png`)); console.log('[024] saved walking', w, h);
  await ctx.waitFor(`!document.querySelector('.walker.walking')`, 4000);
  assert.strictEqual(await placeOf(who), 'Software library', 'github goes to Software library');
  await call(1, 'complete');
  await ctx.waitFor(`!document.querySelector('#stage [data-id=${JSON.stringify(who)}].is-away')`, 6000);
  assert.strictEqual(await placeOf(who), null, 'back at the desk after the call, the 2 s stay and the walk back');

  // SC-003: Settings sends github to Terminal; the next github call of that agent goes there
  await js(`document.getElementById('settingsBtn').click()`); await ctx.sleep(900);
  const row = await js(`(()=>{const s=document.querySelector('#plList .plrow[data-srv="github"] select');if(!s)return false;s.value='terminal';s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  assert.ok(row, 'Settings lists the github server');
  await ctx.sleep(600);
  await shot('settings-places', w, h);
  await js(`document.getElementById('scrClose').click()`); await ctx.sleep(400);
  await call(2, 'start');
  await ctx.waitFor(`!!document.querySelector('#stage [data-id=${JSON.stringify(who)}].is-away')`, 3000);
  assert.strictEqual(await placeOf(who), 'Terminal', 'the mapping decides the place of the next call');
  await call(2, 'complete');

  // Demo mode hides the lobby and every figure
  await js(`document.getElementById('demoToggle').click()`); await ctx.sleep(800);
  assert.deepStrictEqual(await js(`({lobby:!!document.querySelector('.lobby'),walkers:document.querySelectorAll('#walkers .walker').length})`), { lobby: false, walkers: 0 }, 'Demo mode: no lobby');
  console.log('[024] all checks passed');
};
