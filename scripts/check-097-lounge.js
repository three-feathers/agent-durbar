/*
 * Spec 097 FR-246..FR-249 (owner decision 2026-11-06, issue #1220): finished, read agents sit in a compact lounge row, in the Photo office and in the
 * Retro arcade. Simulator only (DURBAR_SIM=15, a frozen simulator), no AI credits; every wait is an until().
 *
 *   npm run check:ui -- --only check-097-lounge      (builds first)
 *   SHOTS_OUT=<dir>   where its pictures go (<world>-lounge-<w>x<h>.png; a temporary folder by default)
 *   romotion=1 is in its query: under simfreeze the people (and so the layout ease) stand still
 *   LOUNGE_MUTANT=unread|ease|still   an unread agent goes to the lounge / the move does not ease / reduced motion still eases (each must fail)
 *
 * In each world at 1440x900 and 1280x800 it fails (exit 1) when:
 *   - a finished agent with an unread reply (New reply) leaves its desk, or its screen is not green;
 *   - once read (the app's own Mark as read) it is not in the lounge row: a seat with its person seated, the small desk, the monitor and a plate
 *     saying "resting in the lounge"; or an agent that is not finished sits there;
 *   - an agent asleep (finished 34 minutes ago) is not in the row with lamp and screen off, "z z" and "asleep in the lounge";
 *   - a seat overlaps a desk's plate, screen, face or sign, or another seat, leaves the floor, or the office scrolls; text is under 10.5 px;
 *   - a click on a seat's plate does not open that agent's chat;
 *   - the agent that works again is not back at a full desk, or its person and plate do not ease there (280 to 520 ms), or under reduced
 *     motion anything animates.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const MUTANT = process.env.LOUNGE_MUTANT || '';
const SIZES = [[1440, 900], [1280, 800]];
const WORLDS = (process.env.LOUNGE_WORLDS || 'photo,retro').split(',');

module.exports = async (ctx) => {
  const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-097-lounge-'));
  const H = helpers(ctx);
  const { js } = H;
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
  const PICS = `[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`;
  const q = (world) => ({ officeview: 'real', simfreeze: '1', romotion: '1', /* the people move, so the ease can be seen */ ...(world === 'retro' ? { worldflags: 'retro', world: 'retro' } : {}) });
  const emulate = async (features) => { const dbg = ctx.win.webContents.debugger; if (!dbg.isAttached()) dbg.attach('1.3'); await dbg.sendCommand('Emulation.setEmulatedMedia', { features }); };
  const SIM = 'window.__durbarSimUi';
  const lay = () => js(`(()=>{const L=${SIM}.realLayout();return {scroll:L.scroll,height:L.height,lounge:L.lounge?L.lounge.desks.map(d=>({id:d.id,state:d.state,pose:d.person&&d.person.pose,plate:d.plate,face:d.face,screen:d.screen,table:d.table,slot:d.slot})):[],desks:L.zones.flatMap(z=>z.desks.map(d=>({id:d.id,state:d.state,plate:d.plate,face:d.face,screen:d.screen}))),signs:L.zones.map(z=>z.sign)}})()`);
  const inLounge = async (id) => (await lay()).lounge.some((d) => d.id === id);
  /* reads one agent's drawn parts in the page */
  const parts = (id) => js(`(()=>{const k=${jsLiteral(id)},S=CSS.escape(k),q=s=>document.querySelector('#stage '+s);const pl=q('.ro-plate[data-id="'+S+'"]'),sc=q('.ro-screen[data-for="'+S+'"]');
    return {plate:pl&&pl.className,label:pl&&pl.getAttribute('aria-label'),text:pl&&pl.textContent,surface:pl&&pl.dataset.surface,screen:sc&&sc.className,table:!!q('.ro-ltable[data-for="'+S+'"]'),desk:!!q('.ro-desk[data-for="'+S+'"]'),
      person:(q('.ro-person[data-for="'+S+'"]')||{dataset:{}}).dataset.pose||null,zz:!!q('.ro-zz'),newTag:!!q('.ro-newtag.on[data-for="'+S+'"]')}})()`);

  if (MUTANT === 'unread') console.log('[lounge] mutant: an unread agent goes to the lounge');
  await H.load({ w: 1440, h: 900, query: q('photo'), ready: REAL, settle: false });
  const OS_REDUCED = await js(`matchMedia('(prefers-reduced-motion: reduce)').matches`);
  if (OS_REDUCED) console.log('[lounge] the OS asks for reduced motion: the ease is checked as absent only');
  const shots = [];
  for (const world of WORLDS) for (const [w, h] of SIZES) {
    const tag = `${world} ${w}x${h}`;
    await H.load({ w, h, query: q(world), ready: REAL, settle: false });
    await must(PICS, 'the pictures');
    if (world === 'retro') assert.strictEqual(await js(`document.querySelector('#stage .ro').dataset.world`), 'retro', `${tag}: the arcade is shown`);
    /* the agents that finish: two of the simulator's agents in a folder where another one keeps working (the room rule, spec 001 FR-051), finished just now, replies unread */
    await must(`${SIM}.visitsSettled()`, `${tag}: no visit about to start or end`);
    const pick = await js(`(()=>{const A=${SIM}.agents(),M=A.filter(a=>!a.parent),fin=a=>['done','idle'].includes(a.state)&&!a.paused&&!a.limit,out=[];
      const home=new Set(${SIM}.realLayout().zones.flatMap(z=>z.desks).filter(d=>!d.away).map(d=>d.id)); /* not visiting a place (an away agent keeps its desk, FR-051) */
      /* idle ones first: they have no tool call open, so no visit can start under them (a call still open turns into a visit after its debounce) */
      const cand=M.filter(a=>['idle','working','thinking'].includes(a.state)&&home.has(a.id)&&!a.paused&&!a.limit&&!A.some(h=>h.parent===a.id)).sort((x,y)=>(x.state==='idle'?0:1)-(y.state==='idle'?0:1));
      for(const a of cand){
        if(out.length===2)break;
        const next=out.concat(a.id); /* each picked agent's room keeps an agent that is not finished, the picked ones excluded */
        if(next.every(id=>{const r=A.find(x=>x.id===id).room;return M.some(o=>o.room===r&&!next.includes(o.id)&&!fin(o))}))out.push(a.id);
      }
      return out})()`);
    assert.ok(pick.length === 2, `${tag}: two agents to finish, each in a room where others work: ${JSON.stringify(pick)}`);
    const [D, S] = pick;
    await js(`(()=>{for(const id of ${jsLiteral(pick)}){const a=${SIM}.agents().find(x=>x.id===id);a.state='done';a.lastOutput=a.lastOutput||'Finished the change and ran the tests.';a.lastEventAt=Date.now();${SIM}.unread.mark(id);}${SIM}.crew.renderAll();return 1})()`);
    if (MUTANT === 'unread') await js(`(()=>{for(const id of ${jsLiteral(pick)})${SIM}.unread.read(id);${SIM}.crew.renderAll();return 1})()`);
    await must(`(()=>{const p=document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(${jsLiteral(D)})+'"]');return !!p&&p.classList.contains('st-done')})()`, `${tag}: the finished desk`);
    /* FR-246: unread keeps the full desk, the green screen and the New reply tag */
    for (const id of pick) {
      assert.strictEqual(await inLounge(id), false, `${tag}: a done agent with an unread reply keeps its desk (spec 001 FR-173)`);
      const p = await parts(id);
      assert.ok(p.desk && !p.table && /tint-green/.test(p.screen) && p.newTag && !/lounge/.test(p.plate), `${tag}: at its desk, green screen, New reply: ${JSON.stringify(p)}`);
    }
    /* read: both move to the lounge row; S finished 34 minutes ago, so it is asleep */
    await js(`(()=>{const s=${SIM}.agents().find(x=>x.id===${jsLiteral(S)});s.lastEventAt=Date.now()-34*60000;for(const id of ${jsLiteral(pick)})${SIM}.unread.read(id);${SIM}.crew.renderAll();return 1})()`);
    await must(`document.querySelectorAll('#stage .ro-plate.lounge').length>=2`, `${tag}: the lounge row once read`);
    await must(PICS, 'the pictures');
    const L = await lay();
    console.log(`[lounge] ${tag}: picked ${D} ${S}; in the lounge`, JSON.stringify(L.lounge.map((d) => d.id + ':' + d.state)));
    const seats = Object.fromEntries(L.lounge.map((d) => [d.id, d]));
    assert.ok(seats[D] && seats[S], `${tag}: both read agents sit in the lounge row: ${JSON.stringify(L.lounge.map((d) => d.id))}`);
    assert.ok(!L.desks.some((d) => d.id === D || d.id === S), `${tag}: and have no desk any more`);
    const finished = await js(`${SIM}.agents().filter(a=>!a.parent&&(a.state==='done'||a.state==='idle')).map(a=>a.id)`);
    assert.deepStrictEqual(L.lounge.filter((d) => !finished.includes(d.id)).map((d) => d.id), [], `${tag}: only finished agents sit in the lounge`);
    const seatPose = world === 'retro' ? 'sit' : 'rest';
    const pd = await parts(D), ps = await parts(S);
    assert.ok(pd.table && !pd.desk && pd.person === seatPose && /ro-lmon/.test(pd.screen) && pd.surface === 'lounge', `${tag}: a seat: the person seated (${seatPose}), the small desk and the monitor: ${JSON.stringify(pd)}`);
    assert.ok(/, resting in the lounge, finished (just now|\d+ minutes? ago): .+ Open chat panel\.$/.test(pd.label), `${tag}: the resting seat's name: ${pd.label}`);
    assert.ok(/asleep/.test(ps.plate) && /\boff\b/.test(ps.screen) && ps.zz && /, asleep in the lounge, finished 34 minutes ago: .+ Open chat panel\.$/.test(ps.label), `${tag}: the asleep seat: ${JSON.stringify(ps)}`);
    assert.ok(/Asleep · finished 34 min ago/.test(ps.text), `${tag}: the asleep plate's words: ${ps.text}`);
    if (world !== 'retro') assert.ok(await js(`!!document.querySelector('#stage .ro-lights .ro-lamp.lamp-off[data-for="'+CSS.escape(${jsLiteral(S)})+'"]')`), `${tag}: the sleeper's lamp is off`);
    /* the geometry as drawn: nothing over a desk's plate, screen, face or sign, or another seat; inside the floor; no scroll */
    const hit = (a, b) => a && b && a.x + 0.5 < b.x + b.w && b.x + 0.5 < a.x + a.w && a.y + 0.5 < b.y + b.h && b.y + 0.5 < a.y + a.h;
    const bad = [];
    for (const s of L.lounge) {
      for (const d of L.desks) for (const r of [d.plate, d.screen, d.face]) for (const [nm, x] of [['plate', s.plate], ['face', s.face], ['screen', s.screen], ['table', s.table]]) if (hit(x, r)) bad.push(`${s.id} ${nm} on desk ${d.id}`);
      for (const r of L.signs) if (hit(s.slot, r)) bad.push(`${s.id} under a sign`);
      for (const o of L.lounge) if (o.id !== s.id && hit(s.slot, o.slot)) bad.push(`${s.id} on ${o.id}`);
      if (hit(s.face, s.screen) || hit(s.face, s.table) || hit(s.face, s.plate)) bad.push(`${s.id}: its face is covered`);
      if (s.slot.y + s.slot.h > L.height + 0.5) bad.push(`${s.id} leaves the floor`);
    }
    assert.deepStrictEqual(bad, [], `${tag}: the lounge overlaps nothing`);
    assert.strictEqual(L.scroll, false, `${tag}: no scroll`);
    const small = await js(`[...document.querySelectorAll('#stage .ro-plate.lounge *')].filter(e=>e.children.length===0&&e.textContent.trim()&&getComputedStyle(e).display!=='none'&&parseFloat(getComputedStyle(e).fontSize)<10.5).length`);
    assert.strictEqual(small, 0, `${tag}: lounge text at least 10.5 px`);
    const floorOk = await js(`(()=>{const f=document.getElementById('floor');return !f||f.scrollHeight<=f.clientHeight+1})()`);
    assert.ok(floorOk, `${tag}: the office does not scroll`);
    const file = path.join(OUT, `${world}-lounge-${w}x${h}.png`);
    await H.shot(file, { prep: 'calm', settle: true, tag: 'lounge', what: `${world}-lounge-${w}x${h}` });
    shots.push(file);
    /* FR-249: a seat's plate is the agent's button: a click opens its chat */
    await js(`document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(${jsLiteral(D)})+'"]').click();1`);
    await must(`document.body.classList.contains('panel-open')`, `${tag}: the chat opens from a lounge seat`);
    ctx.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); ctx.win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await must(`!document.body.classList.contains('panel-open')&&!!document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(${jsLiteral(D)})+'"]')`, `${tag}: back in the room`);
    await must(`(()=>{const R=document.querySelector('#stage .ro');return !!R&&!R.classList.contains('paused')})()`, `${tag}: the room drawn again`);
    /* FR-249: D works again: back at a full desk, its person and plate easing there (unless the OS asks for reduced motion) */
    await must(`document.querySelector('#stage .ro')._ready===true`, 'the room is ready to move (READY_MS)');
    if (MUTANT === 'ease') await emulate([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    const back = await js(`(()=>{const a=${SIM}.agents().find(x=>x.id===${jsLiteral(D)});a.state='working';a.lastEventAt=Date.now();${SIM}.crew.renderAll();
      const S=CSS.escape(${jsLiteral(D)}),eased=e=>!!e&&e.getAnimations().filter(n=>!n.animationName&&n.effect.getKeyframes().some(k=>k.translate)).map(n=>n.effect.getTiming().duration);
      return {person:eased(document.querySelector('#stage .ro-person[data-for="'+S+'"]')),plate:eased(document.querySelector('#stage .ro-plate[data-id="'+S+'"]')),
        moving:!matchMedia('(prefers-reduced-motion: reduce)').matches,inLounge:(${SIM}.realLayout().lounge||{desks:[]}).desks.some(d=>d.id===${jsLiteral(D)})}})()`);
    if (MUTANT === 'ease') await emulate([]);
    assert.strictEqual(back.inLounge, false, `${tag}: an agent that works again leaves the lounge`);
    await must(`!!document.querySelector('#stage .ro-desk[data-for="'+CSS.escape(${jsLiteral(D)})+'"]')&&!document.querySelector('#stage .ro-ltable[data-for="'+CSS.escape(${jsLiteral(D)})+'"]')`, `${tag}: back at a full desk`);
    if (!OS_REDUCED) {
      assert.ok(back.person.length >= 1 && back.plate.length >= 1, `${tag}: the person and the plate ease to the desk, never a jump: ${JSON.stringify(back)}`);
      assert.ok([...back.person, ...back.plate].every((ms) => ms >= 280 && ms <= 520), `${tag}: a short ease (280 to 520 ms): ${JSON.stringify(back)}`);
    }
    /* reduced motion: S (asleep) works again and nothing animates */
    await must(`!document.querySelector('#stage .ro').getAnimations({subtree:true}).some(a=>!a.animationName&&a.playState==='running')`, `${tag}: the ease back is over`, 5000);
    if (MUTANT !== 'still') await emulate([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    const still = await js(`(()=>{const a=${SIM}.agents().find(x=>x.id===${jsLiteral(S)});a.state='working';a.lastEventAt=Date.now();${SIM}.crew.renderAll();
      const S=CSS.escape(${jsLiteral(S)});return [...document.querySelectorAll('#stage [data-for="'+S+'"],#stage [data-id="'+S+'"]')].flatMap(e=>e.getAnimations().filter(n=>!n.animationName).map(n=>e.className+' '+n.effect.getTiming().duration))})()`);
    await emulate([]);
    assert.deepStrictEqual(still, [], `${tag}: reduced motion: the move back does not animate`);
    assert.strictEqual(await inLounge(S), false, `${tag}: under reduced motion it is back at its desk at once`);
    console.log(`[lounge] ${tag} ok: ${L.lounge.length} in the lounge`);
  }
  console.log('[lounge] pictures:', shots.join(' '));
};
