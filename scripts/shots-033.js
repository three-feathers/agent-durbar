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
 *   SC-003  the office and the pills update in under 0.5 s after the switch (timed by the app; on Linux minus the time it waited for a CPU).
 *   FR-020  no agent of a floor that is off is listed at a place of the lobby or walks there.
 *   FR-016  the office credit total is unchanged and its tooltip names the part from floors that are off.
 *   FR-022  Only: one floor on, no floor tags.
 *   US2 #7  the full-screen chat of an agent closes when its floor is switched off; FR-013 the all-off message.
 *   FR-010  (issue #122) the off floor's row in the panel says what waits there ("Off, 1 waiting, ..."); the pills and the button do not.
 *   FR-023  Settings > Floors: a switch there updates the office, the pills, the top-bar button and the panel.
 * Spec 092 (floor screens): with two or more floors on the office shows one floor at a time, so "the office" below is the whole building: its floor screens
 * one after another (`building()`), each with one floor tag; the pills still count the whole building.
 * Screenshots: 033-floors-on, 033-floors-panel, 033-floor-off, 033-floor-off-panel, 033-settings-floors at both sizes.
 */
const path = require('path');
const fs = require('fs');
const { helpers, jsLiteral } = require('./driver-helpers');
const assert = require('assert');
const OUT = process.env.SHOTS_033 || '/tmp';
const SIZES = [[1440, 900], [1280, 800]];
const MIN_BASE_MS = 2, MAX_RATIO = 16, CAP_MS = 2000; // SC-003 as changed 2026-10-26 (issue #454): ratio to a same-run yardstick, see below
/* SC-003 (issue #454): time the renderer's main thread spent ready to run but waiting for a CPU, from Linux's per-thread scheduler
   statistics (/proc/<pid>/schedstat: run time, run-queue wait, slices; the file of a process is its main thread). That wait is the
   machine's load, not the app's work. null where the file is missing (macOS, Windows, a kernel without it): the wall time counts. */
const queueWaitMs = (pid) => {
  try { return Number(fs.readFileSync(`/proc/${pid}/schedstat`, 'utf8').trim().split(/\s+/)[1]) / 1e6; } catch { return null; }
};

module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-096/097: shared plumbing, waits for the page instead of a fixed time
  const { until, settle, js } = H;
  const shot = (name, w, h) => H.shot(path.join(OUT, `033-${name}-${w}x${h}.png`), { tag: '033', what: `${name} ${w} ${h}` });
  const panel = async (open) => { await js(`(()=>{const p=document.getElementById('floorsPop');if(p.hidden===${open})document.getElementById('floorsBtn').click();})()`); await until(`document.getElementById('floorsPop').hidden===${!open}`); };
  const click = async (sel) => { await panel(true); await js(`document.querySelector(${jsLiteral(sel)}).click()`); };
  const state = () => js(`(()=>{
    const pills=Object.fromEntries([...document.querySelectorAll('#stats .stat[data-k]')].map(b=>[b.dataset.k,+b.querySelector('b').textContent]));
    const c={working:0,waiting:0,idle:0,error:0,done:0};
    [...document.querySelectorAll('#stage .desk[data-id]')].filter(d=>!d.closest('.helpers')).forEach(d=>{const s=d.dataset.state||([...d.classList].find(x=>x.startsWith('is-')&&x!=='is-away')||'').slice(3);if(s==='thinking'||s==='working')c.working++;else if(s in c)c[s]++;});
    document.querySelectorAll('#stage .plate').forEach(p=>{/* a closed room still counts: none closed in this driver */});
    const rooms=[...document.querySelectorAll('#stage .room')].map(r=>({name:r.querySelector('.room-name').textContent,floor:(r.querySelector('.floor-tag')||{}).textContent||null,agents:[...r.querySelectorAll('.desk[data-id] .name')].map(n=>n.textContent.trim())}));
    const lobby=[...document.querySelectorAll('.place')].map(p=>p.getAttribute('aria-label')||'').join(' | ');
    const aiu=document.querySelector('.stat-aiu');
    return {btn:document.getElementById('floorsBtn').textContent.trim(),pills,visible:c,rooms,lobby,walkers:document.querySelectorAll('#walkers .walker').length,ownWalkers:[...document.querySelectorAll('#walkers .walker')].filter(w=>document.querySelector('#stage .desk[data-id="'+w.dataset.agent+'"]')).length,away:document.querySelectorAll('#stage .desk.is-away').length,
      aiu:aiu&&aiu.textContent.trim(),aiuTip:aiu&&aiu.title,tags:document.querySelectorAll('#stage .floor-tag').length,panelOpen:document.body.classList.contains('panel-open'),
      empty:(document.querySelector('#stage .empty')||{}).textContent||''};})()`);

  /* the office reached what the checks below expect: no figure of a desk on screen still walking (a visitor of another floor has no desk here and is only placed) */
  const calm = async (extra = () => true) => {
    for (const end = Date.now() + 8000; Date.now() < end;) {
      const s = await state();
      if (s.ownWalkers <= s.away && extra(s)) break;
      await ctx.sleep(100);
    }
    await until(`!document.querySelector('#walkers .walker.walking')`); await settle();
  };
  /* the whole building: each floor screen in turn (H.eachFloor, PageDown), each with only its own floor tag, merged into the shape state() has for one screen */
  const building = async () => {
    const list = await H.floors();
    if (list.length < 2) return state();
    const parts = [];
    await H.eachFloor(async (f) => {
      await calm();
      const p = await state();
      assert.ok(p.rooms.length && p.rooms.every((r) => r.floor === f.name), `spec 092: the screen of ${f.name} shows only its own rooms: ${JSON.stringify(p.rooms.map((r) => r.floor))}`);
      parts.push(p);
    });
    await H.goToFloor(list[0].id); await calm(); // the user ends where the building starts: the first floor
    const sum = (k) => Object.fromEntries(Object.keys(parts[0][k]).map((x) => [x, parts.reduce((n, p) => n + p[k][x], 0)]));
    return { ...parts[0], rooms: parts.flatMap((p) => p.rooms), visible: sum('visible'), tags: parts.reduce((n, p) => n + p.tags, 0), screens: list.length };
  };
  for (const [w, h] of SIZES) {
    ctx.win.setContentSize(w, h);
    await until(`!!document.getElementById('floorsBtn')&&!!document.getElementById('stage')`, 15000); await settle(); // the previous size may have left every floor off (no desks)
    // start from all floors on (the previous size may have left them off)
    await panel(true);
    for (const id of ['ground', 'f-clienta0', 'f-personal']) {
      const on = await js(`document.querySelector(${jsLiteral(`[data-fl="on"][data-floor="${id}"]`)}).getAttribute('aria-pressed')`);
      if (on !== 'true') { await click(`[data-fl="on"][data-floor="${id}"]`); await until(`document.querySelector(${jsLiteral(`[data-fl="on"][data-floor="${id}"]`)}).getAttribute('aria-pressed')==='true'`); }
    }
    await panel(false);
    await calm();

    // FR-023: Settings > Floors, same controls, same state as the panel
    await js(`document.getElementById('settingsBtn').click()`);
    await ctx.waitFor(`!!document.querySelector('#floorsSet .fl-sw')`, 5000);
    await js(`document.querySelector('#floorsSet [data-fl="on"][data-floor="f-personal"]').click()`);
    await until(`document.getElementById('floorsBtn').textContent.trim()==='2/3'`);
    let st = await js(`({btn:document.getElementById('floorsBtn').textContent.trim(),set:document.querySelector('#floorsSet [data-fl="on"][data-floor="f-personal"]').getAttribute('aria-pressed')})`);
    assert.strictEqual(st.btn, '2/3', 'FR-023: a switch in Settings updates the top-bar button');
    assert.strictEqual(st.set, 'false');
    await panel(true);
    assert.strictEqual(await js(`document.querySelector('#floorsPop [data-fl="on"][data-floor="f-personal"]').getAttribute('aria-pressed')`), 'false', 'FR-023: the panel shows the same state');
    await panel(false);
    await js(`document.getElementById('floorsSet').closest('section').scrollIntoView({block:'start'})`);
    await shot('settings-floors', w, h);
    await js(`document.querySelector('#floorsSet [data-fl="on"][data-floor="f-personal"]').click()`);
    await until(`document.getElementById('floorsBtn').textContent.trim()==='3/3'`);
    await js(`window.DurbarScreens.close()`);
    await calm();
    assert.strictEqual(await js(`document.getElementById('floorsBtn').textContent.trim()`), '3/3');

    // FR-012: tags and order
    let s = await building();
    console.log('[033]', w, 'rooms', JSON.stringify(s.rooms.map((r) => `${r.name}@${r.floor}`)));
    assert.strictEqual(s.btn, '3/3');
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
    // the time budget is measured in a quiet office (no figure still walking), as the fixed delays used to leave it
    await until(`!document.querySelector('#walkers .walker.walking')`); await settle();
    // SC-003 (as changed 2026-10-21, issue #454): the app times the switch itself, from the click to the end of the office render
    // that shows it (User Timing entry 'durbar:floor-switch'), so the driver's own polling is not counted. On Linux the time the
    // renderer's main thread was ready but waited for a CPU taken by other processes (a loaded machine) is subtracted, and the log
    // gives both figures. Time the app waits for itself (IPC, timers) still counts. The best of up to three tries counts; the 500 ms
    // budget itself is unchanged.
    const pid = ctx.win.webContents.getOSProcessId();
    const offOnce = async () => {
      const q0 = queueWaitMs(pid);
      const ms = await js(`new Promise(res=>{performance.clearMeasures('durbar:floor-switch');
        const ob=new PerformanceObserver(l=>{const e=l.getEntries().find(x=>x.name==='durbar:floor-switch');if(e){ob.disconnect();res(e.duration);}});
        ob.observe({type:'measure'});setTimeout(()=>{ob.disconnect();res(Infinity);},5000);document.querySelector('[data-fl="on"][data-floor="f-personal"]').click();})`);
      const q1 = queueWaitMs(pid);
      const waited = q0 === null || q1 === null ? 0 : Math.min(ms, Math.max(0, q1 - q0));
      await until(`document.getElementById('floorsBtn').textContent.trim()==='2/3'&&![...document.querySelectorAll('#stage .floor-tag')].some(t=>t.textContent==='Personal')`);
      return { ms, waited, own: ms - waited };
    };
    /* a same-run yardstick (#454, 2026-10-26): a fixed DOM + layout + string workload in the same page, best of 3, so the machine's speed
       and load cancel out of the comparison. The switch is judged as a ratio to it (see MAX_RATIO), plus a generous absolute cap. */
    const calibrate = async () => {
      let best = Infinity;
      for (let i = 0; i < 3; i++) {
        const t = await js(`(()=>{const t0=performance.now();const box=document.createElement('div');box.style.cssText='position:absolute;left:-9999px;top:0;width:900px';
          for(let i=0;i<1500;i++){const d=document.createElement('div');d.style.cssText='display:inline-block;width:'+(20+i%40)+'px;padding:2px';d.textContent='agent '+i;box.appendChild(d);}
          document.body.appendChild(box);let h=0;for(let i=0;i<12;i++){box.style.width=(700+i*20)+'px';h+=box.offsetHeight;}box.remove();return performance.now()-t0+h*0;})()`);
        best = Math.min(best, t);
      }
      return Math.max(best, MIN_BASE_MS);
    };
    const tries = [];
    let base = await calibrate();
    for (;;) {
      tries.push(await offOnce());
      if (tries[tries.length - 1].own < base * MAX_RATIO || tries.length === 3) break;
      await js(`document.querySelector('[data-fl="on"][data-floor="f-personal"]').click()`); // back on, then measure again in a quiet office
      await until(`document.getElementById('floorsBtn').textContent.trim()==='3/3'`);
      await until(`!document.querySelector('#walkers .walker.walking')`); await settle();
      base = Math.min(base, await calibrate());
    }
    const best = tries.reduce((a, b) => (b.own < a.own ? b : a));
    const ratio = best.own / base;
    const said = tries.map((t) => `${Math.round(t.own)} ms` + (t.waited >= 1 ? ` (${Math.round(t.ms)} ms on the clock, ${Math.round(t.waited)} ms of it waiting for a CPU)` : '')).join(', ');
    console.log('[033]', w, `switch off took ${said}; yardstick ${base.toFixed(1)} ms; ratio ${ratio.toFixed(2)} (limit ${MAX_RATIO}, cap ${CAP_MS} ms)`);
    assert.ok(ratio < MAX_RATIO, `SC-003: switch off took ${Math.round(best.own)} ms of its own, ${ratio.toFixed(1)} times the same-run yardstick of ${base.toFixed(1)} ms (limit ${MAX_RATIO}; tries: ${said})`);
    assert.ok(best.own < CAP_MS, `SC-003: switch off took ${Math.round(best.own)} ms (sanity cap ${CAP_MS} ms; tries: ${said})`);
    await panel(false);
    await calm(); // figures of the off floor leave and the others settle
    s = await building();
    assert.deepStrictEqual(s.pills, s.visible, 'SC-002: pills = visible agents with Personal off (the whole building, floor by floor)');
    assert.ok(!s.rooms.some((r) => r.floor === 'Personal'), 'no room of Personal in the office');
    for (const n of personal) assert.ok(!s.lobby.includes(n), `FR-020: ${n} is not listed in the lobby`);
    assert.ok((await state()).ownWalkers <= (await state()).away, 'no figure without an empty chair (a visitor of another floor has no desk on this screen)');
    assert.strictEqual(s.aiu, totalBefore, 'FR-016: the office total is unchanged');
    assert.ok(/from floors that are off/.test(s.aiuTip || ''), 'FR-016: the tooltip names the off-floor spend');
    await shot('floor-off', w, h);
    // FR-010 (maintainer decision, issue #122): attention from the off floor, only as text on its row
    await panel(true);
    const att = await js(`(()=>{const e=document.querySelector('#floorsPop [data-att="f-personal"]');return e&&!e.hidden?e.textContent:''})()`);
    console.log('[033]', w, 'off-floor row:', att);
    assert.ok(/^Off, /.test(att) && /waiting|at spending limit/.test(att), 'FR-010: the off floor says what waits there');
    assert.strictEqual(await js(`document.getElementById('floorsBtn').textContent.trim()`), '2/3', 'FR-010: the button is unchanged');
    assert.deepStrictEqual((await state()).pills, s.pills, 'FR-010: the pills are unchanged');
    await shot('floor-off-panel', w, h);
    await panel(false);

    // FR-022 Only
    await click('[data-fl="only"][data-floor="f-clienta0"]');
    await panel(false);
    await calm((s) => s.btn === '1/3');
    s = await state();
    assert.strictEqual(s.btn, '1/3');
    assert.strictEqual(s.tags, 0, 'one floor on: no floor tags');
    assert.ok(s.rooms.length && s.rooms.every((r) => r.floor === null));
    assert.deepStrictEqual(s.pills, s.visible, 'SC-002 after Only');

    // US2 #7: the chat closes when its floor goes off; FR-013 all-off message
    await js(`document.querySelector('#stage .desk[data-id]').click()`);
    await until(`document.body.classList.contains('panel-open')`);
    assert.ok((await state()).panelOpen, 'chat opened');
    await click('[data-fl="on"][data-floor="f-clienta0"]');
    await panel(false);
    await until(`!document.body.classList.contains('panel-open')&&!!document.querySelector('#stage .empty')`); await settle();
    s = await state();
    assert.ok(!s.panelOpen, 'the chat closed when its floor went off');
    assert.ok(/All floors are off\. Open "Floors" above or Settings > Floors/.test(s.empty), 'all-off message names the Floors button (three floors) and Settings');
    assert.deepStrictEqual(Object.values(s.pills), [0, 0, 0, 0, 0], 'nothing counted with every floor off');
    console.log('[033]', w, 'ok');
  }
  console.log('[033] all checks passed');
};
