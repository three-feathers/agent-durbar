/*
 * Checks + screenshots for spec 033 (floors: groups of rooms you can switch off). Simulator only (no AI credits, no Copilot login):
 *
 *   npm run build
 *   SHOTS_033=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 DURBAR_SIM_FLOORS=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-033.js npx electron .        (xvfb-run -a ... --no-sandbox on Linux)
 *
 * It reads and clicks only the page and exits non-zero (driver failure) on a miss, at 1440x900 and 1280x800:
 *   FR-012  three floors on: every room header carries its floor tag, rooms of one floor are next to each other in floor order.
 *   SC-002  after a floor is switched off, the Working/Waiting/Idle/Errors/Done pills equal the agents visible in the office.
 *   SC-003  the office and the pills update in under 0.5 s after the switch.
 *   FR-020  no agent of a floor that is off is listed at a place of the lobby or walks there.
 *   FR-016  the office credit total is unchanged and its tooltip names the part from floors that are off.
 *   FR-022  Only: one floor on, no floor tags.
 *   US2 #7  the full-screen chat of an agent closes when its floor is switched off; FR-013 the all-off message.
 * Screenshots: 033-floors-on, 033-floors-panel, 033-floor-off at both sizes.
 */
const path = require('path');
const assert = require('assert');
const OUT = process.env.SHOTS_033 || '/tmp';
const SIZES = [[1440, 900], [1280, 800]];

module.exports = async (ctx) => {
  const js = (code) => ctx.js(code);
  const shot = async (name, w, h) => { await ctx.sleep(300); await ctx.shot(path.join(OUT, `033-${name}-${w}x${h}.png`)); console.log('[033] saved', name, w, h); };
  const panel = async (open) => { await js(`(()=>{const p=document.getElementById('floorsPop');if(p.hidden===${open})document.getElementById('floorsBtn').click();})()`); await ctx.sleep(120); };
  const click = async (sel) => { await panel(true); await js(`document.querySelector(${JSON.stringify(sel)}).click()`); };
  const state = () => js(`(()=>{
    const pills=Object.fromEntries([...document.querySelectorAll('#stats .stat[data-k]')].map(b=>[b.dataset.k,+b.querySelector('b').textContent]));
    const c={working:0,waiting:0,idle:0,error:0,done:0};
    [...document.querySelectorAll('#stage .desk[data-id]')].filter(d=>!d.closest('.helpers')).forEach(d=>{const s=([...d.classList].find(x=>x.startsWith('is-')&&x!=='is-away')||'').slice(3);if(s==='thinking'||s==='working')c.working++;else if(s in c)c[s]++;});
    document.querySelectorAll('#stage .plate').forEach(p=>{/* a closed room still counts: none closed in this driver */});
    const rooms=[...document.querySelectorAll('#stage .room')].map(r=>({name:r.querySelector('.room-name').textContent,floor:(r.querySelector('.floor-tag')||{}).textContent||null,agents:[...r.querySelectorAll('.desk[data-id] .name')].map(n=>n.textContent.trim())}));
    const lobby=[...document.querySelectorAll('.place')].map(p=>p.getAttribute('aria-label')||'').join(' | ');
    const aiu=document.querySelector('.stat-aiu');
    return {btn:document.getElementById('floorsBtn').textContent,pills,visible:c,rooms,lobby,walkers:document.querySelectorAll('#walkers .walker').length,away:document.querySelectorAll('#stage .desk.is-away').length,
      aiu:aiu&&aiu.textContent.trim(),aiuTip:aiu&&aiu.title,tags:document.querySelectorAll('#stage .floor-tag').length,panelOpen:document.body.classList.contains('panel-open'),
      empty:(document.querySelector('#stage .empty')||{}).textContent||''};})()`);

  for (const [w, h] of SIZES) {
    ctx.win.setContentSize(w, h);
    await ctx.sleep(1500);
    // start from all floors on (the previous size may have left them off)
    await panel(true);
    for (const id of ['ground', 'f-clienta0', 'f-personal']) {
      const on = await js(`document.querySelector('[data-fl="on"][data-floor="${id}"]').getAttribute('aria-pressed')`);
      if (on !== 'true') { await click(`[data-fl="on"][data-floor="${id}"]`); await ctx.sleep(150); }
    }
    await panel(false);
    await ctx.sleep(600);

    // FR-012: tags and order
    let s = await state();
    console.log('[033]', w, 'rooms', JSON.stringify(s.rooms.map((r) => `${r.name}@${r.floor}`)));
    assert.strictEqual(s.btn, 'Floors 3/3');
    assert.ok(s.rooms.every((r) => r.floor), 'every room carries its floor tag');
    const order = ['Ground floor', 'Client A', 'Personal'];
    const seen = s.rooms.map((r) => order.indexOf(r.floor));
    assert.deepStrictEqual(seen, [...seen].sort((a, b) => a - b), 'rooms are grouped in floor order');
    assert.deepStrictEqual(s.pills, s.visible, 'pills = visible agents (all on)');
    const totalBefore = s.aiu;
    const personal = s.rooms.filter((r) => r.floor === 'Personal').flatMap((r) => r.agents);
    assert.ok(personal.length, 'Personal has agents');
    await shot('floors-on', w, h);
    await panel(true);
    await shot('floors-panel', w, h);

    // SC-003 + SC-002 + FR-020 + FR-016: switch Personal off
    const ms = await js(`new Promise(res=>{const t0=performance.now();document.querySelector('[data-fl="on"][data-floor="f-personal"]').click();
      const chk=()=>{const b=document.getElementById('floorsBtn').textContent==='Floors 2/3';const gone=![...document.querySelectorAll('#stage .floor-tag')].some(t=>t.textContent==='Personal');
        if(b&&gone)res(performance.now()-t0);else requestAnimationFrame(chk);};chk();})`);
    console.log('[033]', w, 'switch off took', Math.round(ms), 'ms');
    assert.ok(ms < 500, `SC-003: updated in ${Math.round(ms)} ms`);
    await panel(false);
    await ctx.sleep(1200); // let figures of the off floor leave and the others settle
    s = await state();
    assert.deepStrictEqual(s.pills, s.visible, 'SC-002: pills = visible agents with Personal off');
    assert.ok(!s.rooms.some((r) => r.floor === 'Personal'), 'no room of Personal in the office');
    for (const n of personal) assert.ok(!s.lobby.includes(n), `FR-020: ${n} is not listed in the lobby`);
    assert.ok(s.walkers <= s.away, 'no figure without an empty chair');
    assert.strictEqual(s.aiu, totalBefore, 'FR-016: the office total is unchanged');
    assert.ok(/from floors that are off/.test(s.aiuTip || ''), 'FR-016: the tooltip names the off-floor spend');
    await shot('floor-off', w, h);

    // FR-022 Only
    await click('[data-fl="only"][data-floor="f-clienta0"]');
    await panel(false);
    await ctx.sleep(300);
    s = await state();
    assert.strictEqual(s.btn, 'Floors 1/3');
    assert.strictEqual(s.tags, 0, 'one floor on: no floor tags');
    assert.ok(s.rooms.length && s.rooms.every((r) => r.floor === null));
    assert.deepStrictEqual(s.pills, s.visible, 'SC-002 after Only');

    // US2 #7: the chat closes when its floor goes off; FR-013 all-off message
    await js(`document.querySelector('#stage .desk[data-id]').click()`);
    await ctx.sleep(300);
    assert.ok((await state()).panelOpen, 'chat opened');
    await click('[data-fl="on"][data-floor="f-clienta0"]');
    await panel(false);
    await ctx.sleep(300);
    s = await state();
    assert.ok(!s.panelOpen, 'the chat closed when its floor went off');
    assert.ok(/All floors are off/.test(s.empty), 'all-off message');
    assert.deepStrictEqual(Object.values(s.pills), [0, 0, 0, 0, 0], 'nothing counted with every floor off');
    console.log('[033]', w, 'ok');
  }
  console.log('[033] all checks passed');
};
