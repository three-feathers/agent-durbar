/*
 * The nine world moments of Real office, in the simulator only (spec 097 FR-118..FR-129, tasks T128..T141): no real session, no account, no AI credits.
 *
 *   npm run build
 *   SHOTS_OUT=<dir> DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 DURBAR_SIM_FLOORS=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-097-moments.js npx electron .        (xvfb-run -a ... --no-sandbox on Linux)
 *
 * For each world (Photo office; the Prehistoric cave behind its flag) at 1440x900 and 1280x800 it checks the moments listed in MOMENTS below
 * (each states what it asserts) and writes <SHOTS_OUT>/<world>-<moment>-<w>x<h>.png. Driver waits use until(); nothing sleeps for a fixed time.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');
const { AT_CLOCK } = require('./shots-068-coffee');
/* the plate's words after "Coffee break — ": "resumes at 14:30" today, "resumes Tue 12:08 AM" when the reset is on the next day (a run just before midnight UTC); test-coffeebreak checks it against untilText */
const RESUMES = `resumes ${AT_CLOCK}`;

const SIZES = [[1440, 900], [1280, 800]];
const WORLDS = (process.env.MOMENTS_WORLDS || 'photo').split(',');
const ONLY = (process.env.MOMENTS_ONLY || '').split(',').filter(Boolean);

module.exports = async (ctx) => {
  // made when the driver runs, not when the file is required (test-coffeebreak requires it for RESUMES: spec 012 FR-166)
  const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-097-moments-'));
  const H = helpers(ctx);
  const { js } = H;
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
  const PICS = `[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`;
  const q = (world, extra = {}) => ({ officeview: 'real', ...(world === 'cave' || world === 'retro' ? { worldflags: world, world } : {}), ...extra });
  const run = (id) => !ONLY.length || ONLY.includes(id);
  const shot = (world, name, w, h) => H.shot(path.join(OUT, `${world}-${name}-${w}x${h}.png`), { prep: 'calm', settle: true, tag: 'moments', what: `${world}-${name}-${w}x${h}` });
  /* CDP media emulation (reduced motion, forced colours), always undone */
  const emulate = async (features, fn) => {
    const dbg = ctx.win.webContents.debugger;
    if (!dbg.isAttached()) dbg.attach('1.3');
    try { await dbg.sendCommand('Emulation.setEmulatedMedia', { features }); await fn(); }
    finally { await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [] }).catch(() => undefined); }
  };
  /* what a slip covers: the drawn boxes of every plate, sign, chair label, chip, cue and the empty floor's plate that touch a shown slip */
  const slipOverlaps = () => js(`(()=>{const R=e=>e.getBoundingClientRect(),hit=(a,b)=>a.left<b.right-0.5&&b.left<a.right-0.5&&a.top<b.bottom-0.5&&b.top<a.bottom-0.5;
    const S=[...document.querySelectorAll('#stage .ro-slip:not([hidden])')],A=[...document.querySelectorAll('#stage .ro-plate,#stage .ro-sign,#stage .ro-away,#stage .ro-chip,#stage .ro-lplate,#stage .ro-bub,#stage .ro-bang,#stage .ro-eplate')];
    const ro=R(document.querySelector('#stage .ro')),F=window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks.map(d=>d.face)).filter(Boolean).map(f=>({left:ro.left+f.x,right:ro.left+f.x+f.w,top:ro.top+f.y,bottom:ro.top+f.y+f.h}));
    return S.flatMap(s=>A.filter(a=>hit(R(s),R(a))).map(a=>s.className+' x '+a.className+' '+(a.textContent||'').slice(0,20)).concat(F.filter(f=>hit(R(s),f)).map(()=>s.className+' x a face')))})()`);
  const fontsOk = `[...document.querySelectorAll('#stage .ro-plate,#stage .ro-eplate,#stage .ro-zz,#stage .welcome *')].every(e=>parseFloat(getComputedStyle(e).fontSize)>=10.5)`;

  /* a runner whose OS asks for reduced motion (a Windows VM often does) draws the still scene: the moving parts are then asserted by the emulation block (nothing moves), not looked at */
  if (process.env.MOMENTS_FORCE_REDUCED === '1') { /* a developer aid: pretend to be such a runner (the emulation block below resets it) */
    const dbg = ctx.win.webContents.debugger; if (!dbg.isAttached()) dbg.attach('1.3');
    await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  }
  await H.load({ w: 1440, h: 900, query: { simfreeze: '1' }, ready: 'fit', settle: false });
  const OS_REDUCED = await js(`matchMedia('(prefers-reduced-motion: reduce)').matches`);
  if (OS_REDUCED) console.log('[moments] the OS asks for reduced motion: the ring and the ride are checked in their reduced form only');
  for (const world of WORLDS) for (const [w, h] of SIZES) {
    const tag = `${world} ${w}x${h}`;
    // ---- FR-118 first run ----
    if (run('first-run')) {
      if (world === 'cave' || world === 'retro') {
        /* the cave and the arcade are behind a flag the simulator's page address switches on, so its first run is a simulator page whose agents are all gone (no real folder, no agent) */
        await H.load({ w, h, query: q(world), ready: REAL, settle: false });
        await js(`window.__durbarSimUi.agents().splice(0);window.__durbarSimUi.crew.renderAll()`);
        await must(`!!document.querySelector('#stage .welcome')`, 'the first-run card');
      } else {
        await H.load({ w, h, query: q(world), settle: false });
        await js(`localStorage.setItem('durbar.officeview','real');localStorage.setItem('durbar.world',${jsLiteral(world)})`);
        await H.load({ w, h, query: q(world, { sim: undefined, officeview: undefined }), ready: `!!document.querySelector('#stage .welcome')`, settle: false });
      }
      await must(`!!document.getElementById('roWorldCss-'+${jsLiteral(world)})`, 'the world stylesheet');
      await must(`document.documentElement.dataset.world===${jsLiteral(world)}`, 'the world on html');
      const fr = await js(`(()=>{try{const c=document.querySelector('#stage .welcome');return {surface:c.dataset.surface,labelled:c.getAttribute('aria-labelledby'),h:document.getElementById('wlT').textContent,lift:!!document.querySelector('#lift:not([hidden])'),lobby:!!document.querySelector('#stage .lobby,#stage .ro-lobby'),counts:getComputedStyle(document.getElementById('stats')).visibility,ring:!!document.querySelector('#addFolder.ring,#addFolder[data-ring]'),
        btns:[...c.querySelectorAll('button')].map(b=>b.textContent.trim()),small:[...c.querySelectorAll('*')].filter(e=>e.children.length===0&&e.textContent.trim()&&parseFloat(getComputedStyle(e).fontSize)<10.5).length}}catch(e){return {err:String(e)}}})()`);
      assert.ok(!fr.err, fr.err);
      assert.strictEqual(fr.surface, 'first-run', `${tag}: the card is the first-run moment`);
      assert.strictEqual(fr.h, 'Welcome to Agent Durbar', `${tag}: heading word for word`);
      assert.deepStrictEqual(fr.btns, ['Connect an AI account…', '+ Add a folder', 'Look around in the demo'], `${tag}: buttons and order equal flat`);
      assert.strictEqual(fr.lobby, false, `${tag}: no lobby on a first run`);
      assert.strictEqual(fr.counts, 'hidden', `${tag}: no counts in the top bar`);
      assert.strictEqual(fr.small, 0, `${tag}: no text under 10.5px`);
      if (world === 'photo') { /* 052 FR-070: + Folder rings once, not under reduced motion */
        await emulate([{ name: 'prefers-reduced-motion', value: 'reduce' }], async () => {
          await H.load({ w, h, query: q(world, { sim: undefined, officeview: undefined }), ready: `!!document.querySelector('#stage .welcome')`, settle: false });
          await must(`performance.now()>1500`, 'the time the ring would have started');
          assert.strictEqual(await js(`document.getElementById('addFolder').classList.contains('ring-once')`), false, `${tag}: reduced motion: no ring`);
        });
        if (!OS_REDUCED) {
          await H.load({ w, h, query: q(world, { sim: undefined, officeview: undefined }), ready: `!!document.querySelector('#stage .welcome')`, settle: false });
          await must(`document.getElementById('addFolder').classList.contains('ring-once')`, '+ Folder rings once');
          await must(`!document.getElementById('addFolder').classList.contains('ring-once')`, 'the ring over');
        }
      }
      await shot(world, 'firstrun', w, h);
    }
    // ---- FR-119 empty office ----
    if (run('empty-office')) {
      await H.load({ w, h, query: q(world, { simfloors: 'ground' }), ready: REAL, settle: false });
      await must(PICS, 'the pictures');
      await H.goToFloor((await H.floors())[1].id);
      await must(`!!document.querySelector('#stage .ro-eplate')&&!document.querySelector('#stage .ro-ride')`, 'the empty plate, the ride over');
      await must(PICS, 'the pictures');
      const em = await js(`(()=>{const p=document.querySelector('#stage .ro-eplate');return {text:p.textContent,desks:document.querySelectorAll('#stage .ro-edesk').length,screens:document.querySelectorAll('#stage .ro-escreen.off').length,lobby:!!document.querySelector('#stage .ro-lobby'),
        lift:!!document.querySelector('#lift:not([hidden])'),amb:document.querySelector('#stage .ro').dataset.ambient,small:parseFloat(getComputedStyle(p).fontSize)}})()`);
      assert.ok(/^Nothing on .+ yet\. Move a folder here from its ⋯ menu \(Move to floor\)\.$/.test(em.text), `${tag}: the flat sentence: ${em.text}`);
      assert.strictEqual(em.desks, 3, `${tag}: three empty desks`);
      assert.strictEqual(em.screens, 3, `${tag}: screens off`);
      assert.ok(em.lobby && em.lift, `${tag}: the lobby and the lift stay`);
      assert.strictEqual(em.amb, '0.7', `${tag}: room at 70 %`);
      assert.ok(em.small >= 10.5, `${tag}: plate text >= 10.5px`);
      assert.deepStrictEqual(await slipOverlaps(), [], `${tag}: no slip covers the empty floor's plate`);
      await shot(world, 'empty', w, h);
    }
    // ---- FR-120 asleep ----
    if (run('asleep')) {
      await H.load({ w, h, query: q(world), ready: REAL, settle: false });
      await must(PICS, 'the pictures');
      /* the simulator's finished agents finished just now (the couch); make them finish 34 minutes ago, named with nine characters (longer than the simulator's own), with their last message UNREAD: an unread reply keeps its full desk (spec 001 FR-173), so nobody sleeps yet (owner 2026-11-02) */
      const widths = () => js(`(()=>{const L=window.__durbarSimUi.realLayout();return {face:Math.round(L.faceH*10)/10,u:L.u,desks:L.zones.flatMap(z=>z.desks).map(d=>[d.id,d.state,Math.round(d.slot.w*10)/10]).sort(),lounge:(L.lounge?L.lounge.desks:[]).map(d=>[d.id,d.state])}})()`);
      await js(`window.__durbarSimUi.agents().filter(a=>!a.parent&&a.state==='done').forEach(a=>{a.lastEventAt=Date.now()-34*60000;a.name='Alexandre';window.__durbarSimUi.unread.mark(a.id)});window.__durbarSimUi.crew.renderAll()`);
      await must(PICS, 'the pictures');
      const before = await widths();
      assert.strictEqual(before.desks.filter((x) => x[1] === 'asleep').length, 0, `${tag}: an unread reply does not sleep`);
      assert.strictEqual(await js(`document.querySelectorAll('#stage .ro-plate.asleep').length`), 0, `${tag}: no asleep plate while the message is unread`);
      await shot(world, 'asleep-unread', w, h);
      /* the message is read (the app's own Mark as read): the agent is asleep and leaves its desk for the lounge row (spec 097 FR-246, owner 2026-11-06), the desks take the freed room */
      await js(`window.__durbarSimUi.agents().filter(a=>!a.parent&&a.state==='done').forEach(a=>window.__durbarSimUi.unread.read(a.id))`);
      await must(`document.querySelectorAll('#stage .ro-plate.asleep').length>=1`, 'an asleep agent once read');
      const after = await widths();
      const sleepers = after.lounge.filter((x) => x[1] === 'asleep');
      assert.ok(sleepers.length >= 1 && !after.desks.some((x) => x[1] === 'asleep'), `${tag}: an asleep agent whose message is read sits in the lounge row, not at a desk: ${JSON.stringify(after.lounge)}`);
      assert.ok(after.u >= before.u - 1e-6, `${tag}: the room it leaves goes to the desks: u ${before.u} -> ${after.u}`);
      console.log('[moments] when the message is read', `desk faces ${before.face} -> ${after.face} px; lounge`, JSON.stringify(after.lounge));
      const sl = await js(`(()=>{const P=[...document.querySelectorAll('#stage .ro-plate.asleep')];return P.map(p=>({id:p.dataset.id,l:p.getAttribute('aria-label'),t:p.getAttribute('title'),x:p.textContent,
        person:!!document.querySelector('#stage .ro-person.asleep[data-for="'+p.dataset.id+'"]'),zz:!!document.querySelector('#stage .ro-zz'),w:p.getBoundingClientRect().width,
        scr:(document.querySelector('#stage .ro-screen.asleep[data-for="'+p.dataset.id+'"]')||{className:''}).className}))})()`);
      for (const x of sl) {
        assert.ok(/^.+, .+, folder .+, asleep in the lounge, finished 34 minutes ago: .+ Open chat panel\.$/.test(x.l), `${tag}: the screen-reader name: ${x.l}`);
        assert.ok(/^Asleep \u00B7 .+ \u00B7 finished 34 min ago \u00B7 Lamp off\n.+/.test(x.t), `${tag}: the hover card: ${x.t}`);
        assert.ok(/Asleep \u00B7 finished 34 min ago$/.test(x.x), `${tag}: the plate: ${x.x}`);
        assert.ok(x.person && x.zz, `${tag}: a person rests in the lounge and the z z is drawn`);
      }
      const geo = await js(`(()=>{const L=window.__durbarSimUi.realLayout(),a=(L.lounge?L.lounge.desks:[]).filter(d=>d.state==='asleep');
        return {seat:a.map(d=>!!d.lounge&&!!d.table),pose:a.map(d=>d.person&&d.person.pose),shades:document.querySelectorAll('#stage .ro-lamp.lamp-off').length,asleep:a.length,screensOff:document.querySelectorAll('#stage .ro-screen.asleep.off').length,
          chair:a.filter(d=>d.away).length,small:[...document.querySelectorAll('#stage .ro-plate.asleep *,#stage .ro-zz')].filter(e=>parseFloat(getComputedStyle(e).fontSize)<10.5).length}})()`);
      assert.ok(geo.seat.length >= 1 && geo.seat.every(Boolean), `${tag}: each sleeper has a lounge seat with its small desk: ${geo.seat}`);
      assert.deepStrictEqual(geo.pose, geo.pose.map(() => (world === 'retro' ? 'sit' : 'rest')), `${tag}: the person is in ${world === 'retro' ? 'sit (the arcade draws it beside the cabinet, 102 FR-264)' : 'rest'}`);
      assert.strictEqual(geo.shades, geo.asleep, `${tag}: a lamp-off marker on each asleep desk only`);
      /* review 2026-11-02: no dark oval over the room behind a sleeper; the person dims instead */
      const dim = await js(`(()=>{const L=[...document.querySelectorAll('#stage .ro-lights .ro-lamp.lamp-off')].map(e=>{const c=getComputedStyle(e);return [c.backgroundImage,c.backgroundColor]});const P=[...document.querySelectorAll('#stage .ro-person.asleep')].map(e=>getComputedStyle(e).filter);const A=[...document.querySelectorAll('#stage .ro-person:not(.asleep)')].map(e=>getComputedStyle(e).filter);return {L,P,A}})()`);
      assert.ok(dim.L.length >= 1 && dim.L.every(([i, c]) => i === 'none' && /rgba\(0, 0, 0, 0\)|transparent/.test(c)), `${tag}: no shade over the room behind a sleeper: ${JSON.stringify(dim.L)}`);
      assert.ok(dim.P.length >= 1 && dim.P.every((f) => /brightness\(0\.7/.test(f)) && dim.A.every((f) => f === 'none'), `${tag}: the sleeping person dims, awake people do not: ${JSON.stringify([dim.P, dim.A])}`);
      assert.strictEqual(geo.screensOff, geo.asleep, `${tag}: their screens are off`);
      assert.strictEqual(geo.chair + geo.small, 0, `${tag}: no empty-chair marker on an asleep desk; no text under 10.5px`);
      console.log('[moments] asleep ok', sl.length);
      await shot(world, 'asleep', w, h);
      /* the name has priority in a narrow plate: no name is cut, at any desk (review 2026-11-02) */
      const CUT = `[...document.querySelectorAll('#stage .ro-plate .ro-l1 b')].filter(b=>{const r=document.createRange();r.selectNodeContents(b);return r.getBoundingClientRect().width>b.getBoundingClientRect().width+0.01}).map(b=>b.textContent)`;
      await H.until(CUT + '.length===0', 4000).catch(() => undefined); /* plates are fitted after the draw */
      const cut = await js(CUT);
      assert.deepStrictEqual(cut, [], `${tag}: a plate cuts a name: ${JSON.stringify(cut)}`);
      /* a role with no room for about three characters is hidden, not shown as a sliver (review 2026-11-02) */
      const sliver = await js(`[...document.querySelectorAll('#stage .ro-plate .ro-role')].filter(r=>!r.hidden&&getComputedStyle(r).display!=='none'&&r.getBoundingClientRect().width<19).map(r=>[r.textContent,Math.round(r.getBoundingClientRect().width)])`);
      assert.deepStrictEqual(sliver, [], `${tag}: a role is shown as a sliver: ${JSON.stringify(sliver)}`);
    }
    // ---- FR-121 inbox as a queue at the Boss door, FR-122 limit slip at the Bank, FR-124 MCP bubble ----
    let staleRan = 0;
    if (run('inbox')) for (const n of ['15', '3']) {
      await H.load({ w, h, query: q(world, { simelicit: '1', sim: n }), ready: REAL, settle: false });
      await must(PICS, 'the pictures');
      await must(`!!document.querySelector('#stage .ro-slip.ro-queue:not([hidden])')`, 'the queue slip');
      const sl = await js(`(()=>{const e=document.querySelector('#stage .ro-slip.ro-queue');return {variant:e.dataset.variant,act:[...e.querySelectorAll('.sl-act button')].map(b=>b.textContent.trim()),total:(window.__durbarSimUi.slips().queue||{}).total,btns:[...e.querySelectorAll('button')].map(b=>b.textContent.trim()),sub:[...e.querySelectorAll('button')].map(b=>b.title),h:(e.querySelector('.sl-h')||{}).textContent,
        r:e.getBoundingClientRect().toJSON(),lobby:document.querySelector('#stage .ro-lobby').getBoundingClientRect().bottom,small:[...e.querySelectorAll('*')].filter(x=>x.children.length===0&&parseFloat(getComputedStyle(x).fontSize)<10.5).length}})()`);
      assert.ok(sl.r.top >= sl.lobby - 0.5, `${tag}: the slip sits under the lobby band`);
      assert.strictEqual(sl.small, 0, `${tag}: slip text >= 10.5px`);
      /* the inbox's own words for the same request, to compare: its first row, its buttons in its order */
      /* the simulator's MCP request arrives a little after the first draw: wait for it and for the slip to count every request, so the dialog (built once, when opened) and the slip are compared at the same set */
      await must(`window.__durbarSimUi.slips().elicit.length>=1`, 'the MCP request');
      await must(`(()=>{const e=document.querySelector('#stage .ro-slip.ro-queue'),m=e&&/^(\\d+) /.exec(e.getAttribute('aria-label')||'');return !!m&&Number(m[1])===window.__durbarSimUi.needsCount()})()`, 'the slip to count every request that needs you');
      await js(`document.getElementById('inboxBtn').click()`);
      await must(`!!document.querySelector('#inboxDlg .inbox-row')`, 'the inbox');
      const dlg = await js(`(()=>{const r=document.querySelector('#inboxDlg .inbox-row'),h=document.querySelector('#inboxDlg .ib-world');return {title:document.getElementById('inboxT').textContent,first:r.querySelector('.ib-n').textContent,btns:[...r.querySelectorAll('.ib-ans button')].map(b=>b.textContent.trim()),
        focus:document.activeElement&&document.activeElement.className,header:!!h,aria:h&&h.getAttribute('aria-hidden'),door:h&&h.querySelector('img.ibw-door').getAttribute('src'),faces:h&&h.querySelectorAll('.ibw-face').length,bg:getComputedStyle(document.querySelector('#inboxDlg .inbox-dlg')).backdropFilter,
        small:[...document.querySelectorAll('#inboxDlg *')].filter(x=>x.children.length===0&&x.textContent.trim()&&parseFloat(getComputedStyle(x).fontSize)<10.5).length}})()`);
      assert.strictEqual(dlg.title, 'Needs you', `${tag}: the dialog keeps its heading`);
            /* the slip's drawn count (its aria-label) and the inbox's rows are read in the same moment, waiting until() the draw has caught up with a request that arrived meanwhile (a slower runner showed 5 against 6) */
      await must(`(()=>{const e=document.querySelector('#stage .ro-slip.ro-queue'),m=e&&/^(\\d+) /.exec(e.getAttribute('aria-label')||'');return !!m&&Number(m[1])===document.querySelectorAll('#inboxDlg .inbox-row').length})()`, 'the slip count to equal the inbox row count');
      assert.ok(dlg.header && dlg.aria === 'true' && dlg.faces >= 1 && dlg.door === `realoffice/worlds/${world}/fx-boss.webp`, `${tag}: the header with the world's Boss door and the queue's faces, aria-hidden: ${JSON.stringify(dlg)}`);
      assert.ok(/ib-h/.test(dlg.focus), `${tag}: focus lands on the first row's heading, never a button`);
      assert.strictEqual(dlg.bg, 'none', `${tag}: no blur behind the dialog text: ${dlg.bg}`);
      assert.strictEqual(dlg.small, 0, `${tag}: the dialog's text >= 10.5px`);
      const rowDetail = await js(`!!document.querySelector('#inboxDlg .inbox-row details.pdiff')`);
      if (sl.variant === 'full' && rowDetail) {
        /* the inbox row shows a change or a command to read: the slip offers no Allow, only the way to it (review on #994) */
        assert.deepStrictEqual(sl.act, ['Show in chat', 'Review in the inbox'], `${tag}: no Allow on a slip whose card has a change or command to read (the .sl-act buttons): ${JSON.stringify(sl.act)}`);
      }
      if (sl.variant === 'full' && !rowDetail) {
        const flat = dlg.btns.filter((b) => !/^Open$/.test(b));
        assert.deepStrictEqual(sl.act.slice(0, flat.length), flat, `${tag}: the slip's buttons are the inbox's, in its order`);
        assert.strictEqual(sl.act[flat.length], 'Show in chat', `${tag}: then Show in chat`);
        assert.ok(sl.h.startsWith(dlg.first), `${tag}: the first slip is the inbox's first row`);
      }
      await js(`document.getElementById('inboxClose').click()`);
      await must(`!document.getElementById('inboxDlg')`, 'the inbox closed');
      await shot(world, n === '15' ? 'inbox' : 'inbox-' + n, w, h);
      assert.deepStrictEqual(await slipOverlaps(), [], `${tag}: no slip covers a plate, a sign, a chair label, a chip or a cue`);
      if (n !== '3' && sl.variant === 'full') assert.deepStrictEqual(await js(`(()=>{const R=e=>e.getBoundingClientRect(),hit=(a,b)=>a.left<b.right-0.5&&b.left<a.right-0.5&&a.top<b.bottom-0.5&&b.top<a.bottom-0.5;const S=[...document.querySelectorAll('#stage .ro-slip:not([hidden])')],M=[...document.querySelectorAll('#stage .ro-screen:not(.ro-escreen)')];
        return S.flatMap(s=>M.filter(m=>hit(R(s),R(m))).map(()=>s.className))})()`), [], `${tag}: with ${n} agents a full slip covers no monitor (a pill may, when nothing else is free)`);
      const lim = await js(`(()=>{const e=document.querySelector('#stage .ro-slip.ro-limit');return e&&!e.hidden?{v:e.dataset.variant,btns:[...e.querySelectorAll('button')].map(b=>b.textContent.trim()),tips:[...e.querySelectorAll('button')].map(b=>b.title),input:(e.querySelector('input.limit-amt')||{}).ariaLabel,text:e.textContent}:null})()`);
      if (n === '15') {
        assert.ok(lim, `${tag}: the limit is shown at the Bank`);
        if (lim.v === 'full') {
          assert.deepStrictEqual(lim.btns, ['Raise limit', 'Remove limit', 'Stop here', 'Show in chat'], `${tag}: the limit slip's buttons`);
          assert.ok(/^Omar \u00B7 .+ \u00B7 at the BankSpending limit reached: used \d+\.\d\d of \d+ AIU\. The agent waits for you\./.test(lim.text), `${tag}: ${lim.text}`);
          assert.strictEqual(lim.input, 'AI credits to add to the limit', `${tag}: the amount field's name`);
          assert.ok(/Raise the limit by this many AI credits/.test(lim.tips[0]) && /Remove the limit/.test(lim.tips[1]) && /Cancel the blocked request/.test(lim.tips[2]), `${tag}: the flat tooltips`);
        } else assert.strictEqual(lim.v, 'pill', `${tag}: the limit is a full slip or a pill`);
      }
      const el = await js(`[...document.querySelectorAll('#stage .ro-slip.ro-bubble')].map(e=>({btns:[...e.querySelectorAll('button')].map(b=>b.textContent.trim()),fields:e.querySelectorAll('input,textarea,select').length,head:e.querySelector('.sl-h').textContent,text:e.textContent}))`);
      assert.strictEqual(el.length, 1, `${tag}: one MCP request, one bubble`);
      assert.deepStrictEqual(el[0].btns, ['Answer in chat', 'Show in chat'], `${tag}: the bubble offers Answer in chat and Show in chat only`);
      assert.strictEqual(el[0].fields, 0, `${tag}: the bubble has no input field (a form is answered in the chat)`);
      assert.ok(/^\S.*: \[MCP\] An MCP server asks for input$/.test(el[0].head), `${tag}: ${el[0].head}`);
      /* the buttons act: Deny on the first full slip answers the card; Answer in chat opens the chat */
      if (sl.variant === 'full' && n !== '15' && !rowDetail) {
        const who = await js(`(document.querySelector('#stage .ro-slip.ro-queue .sl-h b')||{}).textContent||''`);
        const reqA0 = await js(`((document.querySelector('#stage .ro-slip.ro-queue .ro-sbtn[data-slipreq]')||{dataset:{}}).dataset.slipreq)||''`);
        await js(`(()=>{const d=[...document.querySelectorAll('#stage .ro-slip.ro-queue .ro-sbtn')].find(b=>b.textContent.trim()==='Deny');if(d)d.click()})()`);
        await must(`(()=>{const e=document.querySelector('#stage .ro-slip.ro-queue');return !e||e.hidden||(e.querySelector('.sl-h b')||{}).textContent!==${jsLiteral(who)}})()`, 'the denied request gone from the slip');
        /* a stale button (a double click, or a request that arrived meanwhile) must not answer the NEXT request: a button that names an old request id, aimed at the first request now */
      }
      {
        const q0 = await js(`JSON.stringify(((window.__durbarSimUi.slips().queue)||{}).first?{id:window.__durbarSimUi.slips().queue.first.id,req:window.__durbarSimUi.slips().queue.first.req,total:window.__durbarSimUi.slips().queue.total}:null)`);
        if (q0 !== 'null') {
          staleRan++;
          const f = JSON.parse(q0);
          await js(`(()=>{const b=document.createElement('button');b.dataset.slipact='perm';b.dataset.slipid=${jsLiteral(f.id)};b.dataset.slipreq='rq-stale';b.dataset.slipidx='0';document.body.appendChild(b);b.click();b.remove()})()`);
          const t0 = await js(`performance.now()`);
          await must(`performance.now()>${t0 + 600}`, 'a short while for a wrong answer to show');
          assert.strictEqual(await js(`JSON.stringify(((window.__durbarSimUi.slips().queue)||{}).first?{id:window.__durbarSimUi.slips().queue.first.id,req:window.__durbarSimUi.slips().queue.first.req,total:window.__durbarSimUi.slips().queue.total}:null)`), q0, `${tag}: a stale request id answered nothing`);
        }
      }
      await js(`document.querySelector('#stage .ro-slip.ro-bubble [data-slipact="open"]').click()`);
      await must(`document.body.classList.contains('panel-open')`, 'the chat opened from the bubble');
      await must(`!!document.querySelector('#chat .note.elicit')`, 'the card in the chat');
      assert.ok(await js(`document.getElementById('chat').querySelector('.note.elicit').textContent`).then((t) => /An MCP server asks for input/.test(t)), `${tag}: the chat holds the flat card`);
    }
    // ---- T139: reduced motion and forced colours ----
    if (run('emulation')) {
      await emulate([{ name: 'forced-colors', value: 'active' }], async () => {
        await H.load({ w, h, query: q(world), ready: REAL, settle: false });
        await must(PICS, 'the pictures');
        await js(`window.__durbarSimUi.agents().filter(a=>!a.parent&&a.state==='done').forEach(a=>{a.lastEventAt=Date.now()-34*60000});window.__durbarSimUi.crew.renderAll()`);
        await must(`document.querySelectorAll('#stage .ro-plate.asleep').length>=1`, 'an asleep desk');
        const fc = await js(`({zz:getComputedStyle(document.querySelector('#stage .ro-zz')).display,lights:getComputedStyle(document.querySelector('#stage .ro-lights')).display,plate:document.querySelector('#stage .ro-plate.asleep').textContent})`);
        assert.strictEqual(fc.zz + fc.lights, 'nonenone', `${tag}: forced colours: the z z and the lights are hidden`);
        assert.ok(/Asleep \u00B7 finished 34 min ago$/.test(fc.plate), `${tag}: the plate's words carry it: ${fc.plate}`);
        await shot(world, 'asleep-forced', w, h);
      });
    }
    if (run('inbox')) assert.ok(staleRan > 0, `${tag}: the stale-button check ran (a queue of two or more in a full slip)`);
    // ---- spec 097 FR-004 / Codex sweep: choosing an Office layout keeps keyboard focus on the choice; FR-122: Show in chat from the limit slip focuses the amount field ----
    if (run('focus') && world === 'photo') {
      await H.load({ w, h, query: q(world), ready: REAL, settle: false, focus: true });
      await js(`window.DurbarScreens.openSettings()`);
      await must(`!!document.querySelector('[data-officelayout="open"]')`, 'Settings');
      await js(`document.querySelector('[data-officelayout="open"]').focus()`);
      await H.key('Return');
      await must(`document.querySelector('[data-officelayout="open"]').getAttribute('aria-pressed')==='true'`, 'Open office chosen');
      assert.strictEqual(await js(`(document.activeElement.dataset||{}).officelayout`), 'open', `${tag}: after the repaint the focus is on the choice just made`);
      await js(`document.querySelector('[data-officelayout="real"]').focus()`);
      await H.key('Return');
      await must(`document.querySelector('[data-officelayout="real"]').getAttribute('aria-pressed')==='true'`, 'Real office chosen');
      assert.strictEqual(await js(`(document.activeElement.dataset||{}).officelayout`), 'real', `${tag}: and back`);
      await js(`document.getElementById('scrClose').click()`);
    }
    if (run('limitfocus')) {
      await H.load({ w, h, query: q(world), ready: REAL, settle: false });
      await must(`!!document.querySelector('#stage .ro-slip.ro-limit:not([hidden]) [data-slipfocus="limit"]')`, 'the limit slip');
      await js(`document.querySelector('#stage .ro-slip.ro-limit [data-slipfocus="limit"]').click()`);
      await must(`document.activeElement&&document.activeElement.classList.contains('limit-amt')&&!!document.activeElement.closest('#chat')`, 'the amount field in the chat has focus');
      assert.strictEqual(await js(`document.activeElement.getAttribute('aria-label')`), 'AI credits to add to the limit', `${tag}: the flat field`);
    }
    // ---- FR-125 jumps ride the lift ----
    if (run('jumps')) {
      if (!OS_REDUCED) {
        await js(`localStorage.removeItem('durbar.floor')`); /* the first floor, whatever an earlier size left */
        await H.load({ w, h, query: q(world, { simfloors: '1' }), ready: REAL, settle: false, focus: true });
        await must(PICS, 'the pictures');
        await must(`!!document.querySelector('#lift:not([hidden]) [data-lift]')`, 'the lift');
        const floor0 = await H.shownFloor();
        await H.key('PageUp', [], { pause: 30 });
        await must(`!!document.querySelector('#stage .ro-ride')`, 'the ride');
        const rd = await js(`(()=>{const r=document.querySelector('#stage .ro-ride'),L=window.__durbarSimUi.realLayout();return {top:parseFloat(r.style.top),lobbyH:L.lobbyH,doors:r.querySelectorAll('.rr-door').length,disp:r.querySelector('.rr-disp').textContent,aria:r.getAttribute('aria-hidden'),
          glow:!!document.querySelector('#lift .ride-to'),size:parseFloat(getComputedStyle(r.querySelector('.rr-disp')).fontSize),tabbable:r.querySelectorAll('button,[tabindex]').length}})()`);
        assert.strictEqual(rd.top, rd.lobbyH, `${tag}: the ride covers the desk area only, the lobby stays`);
        assert.strictEqual(rd.doors, 2, `${tag}: two doors`);
        assert.ok(/^[\u25B2\u25BC] \d \u00B7 \S/.test(rd.disp), `${tag}: the display says where: ${rd.disp}`);
        assert.ok(rd.aria === 'true' && rd.tabbable === 0 && rd.size >= 10.5 && rd.glow, `${tag}: aria-hidden, no tab stop, text >= 10.5px, the target button glows: ${JSON.stringify(rd)}`);
        assert.notStrictEqual(await H.shownFloor(), floor0, `${tag}: the floor changed`);
        await H.shot(path.join(OUT, `${world}-jump-f1-${w}x${h}.png`), { prep: 'mouse', delay: 120, tag: 'moments', what: `${world}-jump-f1-${w}x${h}` });
        await must(`!!document.querySelector('#stage .ro-ride.opening')`, 'the cover opening');
        await H.shot(path.join(OUT, `${world}-jump-f2-${w}x${h}.png`), { prep: 'mouse', delay: 10, tag: 'moments', what: `${world}-jump-f2-${w}x${h}` });
        await must(`!document.querySelector('#stage .ro-ride')&&!document.querySelector('#lift .ride-to')`, 'the ride over');
        assert.strictEqual(await js(`document.getElementById('srAnnounce').textContent`).then((t) => /^Floor .+, \d of \d$/.test(t)), true, `${tag}: one announcement of the floor`);
      }
      // reduced motion: the floor changes at once, no cover
      await js(`localStorage.removeItem('durbar.floor')`);
      await emulate([{ name: 'prefers-reduced-motion', value: 'reduce' }], async () => {
        await H.load({ w, h, query: q(world, { simfloors: '1' }), ready: REAL, settle: false, focus: true });
        await must(`!!document.querySelector('#lift:not([hidden]) [data-lift]')`, 'the lift');
        const f1 = await H.shownFloor();
        await H.key('PageUp', [], { pause: 30 });
        await must(`localStorage.getItem('durbar.floor')!==${jsLiteral(f1)}`, 'the floor changed');
        assert.strictEqual(await js(`document.querySelectorAll('.ro-ride').length`), 0, `${tag}: reduced motion: no ride, the floor changes at once`);
      });
    }
    // ---- FR-123 coffee break ----
    if (run('coffee')) {
      await H.load({ w, h, query: q(world, { simbreak: '600' }), ready: REAL, settle: false });
      await must(`(window.__durbarSimUi.agents().find(a=>a.name==='Tomas')||{}).paused||[...document.querySelectorAll('#stage .ro-plate')].some(p=>/Tomas/.test(p.textContent)&&/Coffee/i.test(p.textContent))`, 'Tomas on a coffee break', 30000);
      if (process.env.MOMENTS_FONT) { await js(`(()=>{const s=document.createElement('style');s.textContent='#stage .ro *{font-family:'+${jsLiteral(process.env.MOMENTS_FONT)}+' !important}';document.head.appendChild(s);window.__durbarSimUi.crew.renderAll();})()`); await H.until(PICS, 10000); } /* a developer aid: another font's widths (CI's Linux fonts are wider) */
      const cf = await js(`(()=>{const p=[...document.querySelectorAll('#stage .ro-plate')].find(p=>/Tomas/.test(p.textContent));return {plate:p.textContent,label:p.getAttribute('aria-label'),title:p.getAttribute('title'),state:p.dataset.state,away:[...document.querySelectorAll('#stage .ro-away')].map(e=>e.textContent),
        chips:[...document.querySelectorAll('#stage .ro-chip')].filter(c=>c.dataset.coffeeid).map(c=>[c.textContent,c.getAttribute('aria-label')])}})()`);
      assert.ok(new RegExp(`^TomasPrompt tuner Coffee break \\u00B7 Coffee break \\u2014 ${RESUMES}`).test(cf.plate) && cf.state === 'waiting', `${tag}: the plate and the status (Waiting, never Error): ${cf.plate} ${cf.state}`);
      assert.ok(/^Tomas, Prompt tuner, Coffee break, .*at Coffee corner\. Open chat panel\.$/.test(cf.label), `${tag}: the name: ${cf.label}`);
      assert.ok(cf.away.some((t) => /^at Coffee corner until /.test(t)), `${tag}: the coffee-break post-it says where and until when (owner 2026-11-02): ${JSON.stringify(cf.away)}`);
      assert.strictEqual(await js(`document.querySelectorAll('#stage .ro-tent').length`), 0, `${tag}: no tent card (replaced by the post-it)`);
      assert.deepStrictEqual(await js(`(()=>{const R=e=>e.getBoundingClientRect(),N=[...document.querySelectorAll('#stage .ro-away')],o=[];for(let i=0;i<N.length;i++)for(let j=i+1;j<N.length;j++){const a=R(N[i]),b=R(N[j]);if(a.left<b.right-0.5&&b.left<a.right-0.5&&a.top<b.bottom-0.5&&b.top<a.bottom-0.5)o.push([N[i].textContent,N[j].textContent])}return o})()`), [], `${tag}: no post-it overlaps another, a wide font included`);
      /* the arcade's ticket is a dark card with a neon edge (102 FR-264, owner 2026-11-03): its own colour is the edge and the words, not the paper */
      const NOTE_PROP = world === 'retro' ? 'borderTopColor' : 'backgroundColor';
      assert.ok(await js(`getComputedStyle(document.querySelector('#stage .ro-away[data-place="coffee"]'))[${jsLiteral(NOTE_PROP)}]`) !== await js(`getComputedStyle(document.querySelector('#stage .ro-away:not([data-place="coffee"])')||document.body)[${jsLiteral(NOTE_PROP)}]`), `${tag}: the coffee post-it has its own colour`);
      assert.strictEqual(cf.chips.length, 1, `${tag}: only the agent on a coffee break stands at the corner (FR-128): ${JSON.stringify(cf.chips)}`);
      assert.ok(/^Tomas \(until .* back in \d+ min\)\. Open the chat\.$/.test(cf.chips[0][1]), `${tag}: the corner chip's name: ${cf.chips[0][1]}`);
      await shot(world, 'coffee', w, h);
      await H.load({ w, h, query: q(world), ready: REAL, settle: false });
      await must(PICS, 'the pictures');
      assert.strictEqual(await js(`[...document.querySelectorAll('#stage .ro-chip')].filter(c=>c.dataset.coffeeid).length`), 0, `${tag}: with no coffee break nobody stands at the corner `);
    }
    // ---- review on #994 (2026-11-02): a slip never offers Allow without the change or command the inbox row shows; other approve rules ----
    if (run('review') && world === 'retro') {
      /* the arcade shows one-line pills only (102 FR-257, T273): the slip's Allow and Review buttons are not drawn, the pill opens the inbox, which holds the words and buttons */
      await H.load({ w, h, query: q(world, { sim: '3', simfloors: '1' }), ready: REAL, settle: false });
      await must(PICS, 'the pictures');
      await must(`!!document.querySelector('#stage .ro-slip.ro-queue[data-variant="pill"]')`, 'the queue pill');
      const pill = await js(`(()=>{const e=document.querySelector('#stage .ro-slip.ro-queue');return {btns:[...e.querySelectorAll('button')].map(b=>b.textContent.trim()),perm:e.querySelectorAll('[data-slipact="perm"]').length,lines:e.getBoundingClientRect().height}})()`);
      assert.ok(pill.perm === 0 && pill.btns.length === 1 && /^\d+ needs? you \u00B7 Open the inbox$|^\d+ need you \u00B7 Open the inbox$/.test(pill.btns[0]), `${tag}: the arcade's queue is one pill that opens the inbox: ${JSON.stringify(pill)}`);
      await js(`document.querySelector('#stage .ro-slip.ro-queue [data-slipact="inbox"]').click()`);
      await must(`!!document.querySelector('#inboxDlg .inbox-row')`, 'the pill opens the inbox');
      await js(`document.getElementById('inboxClose').click()`);
    }
    if (run('review') && world !== 'retro') {
      await H.load({ w, h, query: q(world, { sim: '3', simfloors: '1' }), ready: REAL, settle: false });
      await must(PICS, 'the pictures');
      await must(`!!document.querySelector('#stage .ro-slip.ro-queue[data-variant="full"]')`, 'the full queue slip');
      const PERM = `document.querySelectorAll('#stage .ro-slip.ro-queue [data-slipact="perm"]').length`;
      const first = await js(`window.__durbarSimUi.slips().queue.first.id`);
      assert.ok(await js(`window.__durbarSimUi.clearDetail(${jsLiteral(first)})`), `${tag}: the first card is there to clear`);
      await must(PERM + '>=1', 'the slip with the inbox buttons once the card has no change to read');
      assert.ok(await js(PERM) >= 1, `${tag}: with no change to read, the slip offers the inbox's buttons`);
      const pending = () => js(`document.querySelectorAll('#chat .note.perm:not(.settled)').length+':'+window.__durbarSimUi.agents().filter(a=>a.state==='waiting').length`);
      const before = await pending();
      /* keys: a plain A, S, D, J or K from outside a slip answers nothing */
      for (const k of ['a', 's', 'd', 'j', 'k']) await H.key(k, []);
      assert.strictEqual(await pending(), before, `${tag}: plain keys pressed outside a slip or the inbox answer nothing`);
      assert.ok(await js(`window.__durbarSimUi.addDetail(${jsLiteral(first)})`), `${tag}: the card gets a change to read`);
      await must(`document.querySelectorAll('#stage .ro-slip.ro-queue [data-slipact="perm"]').length===0&&/Review in the inbox/.test(document.querySelector('#stage .ro-slip.ro-queue').textContent)`, 'the slip without Allow, with a way to the inbox');
      assert.ok(await js(`/Show in chat/.test(document.querySelector('#stage .ro-slip.ro-queue').textContent)`), `${tag}: Show in chat stays`);
      await shot(world, 'review-slip', w, h);
      /* a stale button that names this very request, pressed after the change arrived: it opens the inbox, it answers nothing */
      const req = await js(`window.__durbarSimUi.slips().queue.first.req`);
      await js(`(()=>{const b=document.createElement('button');b.dataset.slipact='perm';b.dataset.slipid=${jsLiteral(first)};b.dataset.slipreq=${jsLiteral(req)};b.dataset.slipidx='0';document.body.appendChild(b);b.click();b.remove()})()`);
      await must(`!!document.querySelector('#inboxDlg .inbox-row')`, 'the inbox opens instead of an answer');
      assert.strictEqual(await js(`window.__durbarSimUi.agents().filter(a=>a.id===${jsLiteral(first)})[0].state`), 'waiting', `${tag}: nothing was answered`);
      await js(`document.getElementById('inboxClose').click()`);
      /* a planted secret in an MCP message is masked on the slip's text path (requestText) */
      const tok = 'ghp_' + 'A1b2'.repeat(9);
      const masked = await js(`window.__durbarSimUi.requestText(${jsLiteral('Allow ' + tok + ' to run')})`);
      assert.ok(!masked.includes(tok.slice(4, 24)), `${tag}: a token-like value is masked in a slip's text: ${masked}`);
      /* Motion off (Serious mode no longer stops motion, issue 1182): no ride */
      await js(`window.__durbarSimUi.setMotion(false)`);
      const f0 = await js(`localStorage.getItem('durbar.floor')`);
      await H.key('PageUp', [], { pause: 30 });
      await must(`localStorage.getItem('durbar.floor')!==${jsLiteral(f0)}`, 'the floor changed');
      assert.strictEqual(await js(`document.querySelectorAll('.ro-ride').length`), 0, `${tag}: no ride with Motion off`);
      await js(`window.__durbarSimUi.setMotion(true)`);
    }
    // ---- owner 2026-11-02: one post-it colour per reason (the place), dark ink, the words stay ----
    if (run('notes')) {
      await H.load({ w, h, query: q(world), ready: REAL, settle: false }); /* the Boss's post-its are the simulator's own waiting agents (a visit to the Boss is not pinned) */
      await must(PICS, 'the pictures');
      const PL = ['boss', 'bank', 'coffee', 'library', 'software', 'terminal', 'web', 'other'];
      await js('window.__durbarSimUi.uncrowd();' + PL.filter((id) => id !== 'boss').map((id, i) => 'window.__durbarSimUi.crowd(' + jsLiteral(id) + ',1,' + (8 + i) + ')').join(';'));
      const CONTRAST = `const P=s=>{const m=/rgba?\\(([^)]+)\\)/.exec(s);return m?m[1].split(/[ ,\\/]+/).filter(Boolean).slice(0,3).map(Number):[0,0,0]},Lm=c=>{const f=x=>{x/=255;return x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4)};return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2])},K=(a,b)=>{const x=Lm(P(a)),y=Lm(P(b));return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)};`;
      const readNotes = () => js('(()=>{' + CONTRAST + "const ARC=" + jsLiteral(world === 'retro') + ";return [...document.querySelectorAll('#stage .ro-away')].map(e=>{const c=getComputedStyle(e);return {place:e.dataset.place,text:e.textContent,bg:c.backgroundColor,key:ARC?c.color:c.backgroundColor,ink:c.color,ratio:K(c.color,c.backgroundColor),size:parseFloat(c.fontSize)}})})()");
      await must(`document.querySelectorAll('#stage .ro-away').length>=8`, 'a post-it for each place');
      const ns = await readNotes();
      assert.deepStrictEqual([...new Set(ns.map((x) => x.place))].sort(), PL.slice().sort(), `${tag}: one post-it for each place: ${JSON.stringify(ns.map((x) => [x.place, x.text]))}`);
      /* the arcade's ticket is a dark card whose edge and words carry the place's colour (102 FR-264, owner 2026-11-03) */
      assert.strictEqual(new Set(ns.map((x) => x.key)).size, PL.length, `${tag}: one colour per place, all different: ${JSON.stringify(ns.map((x) => [x.place, x.key]))}`);
      for (const x of ns) {
        assert.ok(x.ratio >= 4.5 && x.size >= 10.5, `${tag}: ${x.place} ink contrast ${x.ratio.toFixed(2)}:1 at ${x.size}px`);
        assert.ok(/^at [A-Z]/.test(x.text), `${tag}: the words stay: ${x.text}`);
      }
      await shot(world, 'notes', w, h);
      await emulate([{ name: 'forced-colors', value: 'active' }], async () => {
        const fc = await readNotes();
        assert.ok(fc.length >= 8 && fc.every((x) => x.ratio >= 4.5), `${tag}: forced colours keep the post-it text readable: ${JSON.stringify(fc.map((x) => [x.place, x.ratio.toFixed(1)]))}`);
      });
      console.log('[moments] notes ok', ns.length);
    }
    // ---- 102 T223: the cells that are not one of the nine, looked at in the arcade (chat with a request, the All floors view): pictures and no text under 10.5px ----
    if (run('cells') && world === 'retro') {
      await H.load({ w, h, query: q(world, { sim: '15', simfloors: '1' }), ready: REAL, settle: false });
      await must(PICS, 'the pictures');
      await js(`(()=>{const p=[...document.querySelectorAll('#stage .ro-plate')].find(x=>x.textContent.startsWith('Jonas'));p.click()})()`);
      await must(`document.body.classList.contains('panel-open')&&!!document.querySelector('#chat .note.perm')`, 'the chat of Jonas with its request');
      await H.settle();
      const small = await js(`[...document.querySelectorAll('#panel *')].filter(e=>e.children.length===0&&e.textContent.trim()&&e.getClientRects().length&&parseFloat(getComputedStyle(e).fontSize)<10.5).length`);
      assert.strictEqual(small, 0, `${tag}: the chat has no text under 10.5px`);
      await shot(world, 'cell-chat', w, h);
      await H.load({ w, h, query: q(world, { sim: '15', simfloors: '1' }), ready: REAL, settle: false });
      await must(PICS, 'the pictures');
      await js(`(()=>{const b=document.querySelector('#lift .lift-all');if(b)b.click()})()`);
      if (await H.until(`!!document.querySelector('#stage .ro-building,#stage .allfloors,#stage [data-d="all"]')`, 4000)) await shot(world, 'cell-allfloors', w, h);
      await js(`localStorage.removeItem('durbar.floor');localStorage.removeItem('durbar.floorView')`); /* the next size starts on one floor */
    }
  }
};
module.exports.RESUMES = RESUMES;
