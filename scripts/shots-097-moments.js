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

const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-097-moments-'));
const SIZES = [[1440, 900], [1280, 800]];
const WORLDS = (process.env.MOMENTS_WORLDS || 'photo').split(',');
const ONLY = (process.env.MOMENTS_ONLY || '').split(',').filter(Boolean);

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
  const PICS = `[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`;
  const q = (world, extra = {}) => ({ officeview: 'real', ...(world === 'cave' ? { worldflags: 'cave', world: 'cave' } : {}), ...extra });
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

  for (const world of WORLDS) for (const [w, h] of SIZES) {
    const tag = `${world} ${w}x${h}`;
    // ---- FR-118 first run ----
    if (run('first-run')) {
      if (world === 'cave') {
        /* the cave is behind a flag the simulator's page address switches on, so its first run is a simulator page whose agents are all gone (no real folder, no agent) */
        await H.load({ w, h, query: q(world), ready: REAL, settle: false });
        await js(`window.__durbarSimUi.agents().splice(0);window.__durbarSimUi.crew.renderAll()`);
        await must(`!!document.querySelector('#stage .welcome')`, 'the first-run card');
      } else {
        await H.load({ w, h, query: q(world), settle: false });
        await js(`localStorage.setItem('durbar.officeview','real');localStorage.setItem('durbar.world',${jsLiteral(world)})`);
        await H.load({ w, h, query: q(world, { sim: undefined, officeview: undefined }), ready: `!!document.querySelector('#stage .welcome')`, settle: false });
      }
      await must(`!!document.getElementById('roWorldCss-${world}')`, 'the world stylesheet');
      await must(`document.documentElement.dataset.world===${jsLiteral(world)}`, 'the world on html');
      const fr = await js(`(()=>{try{const c=document.querySelector('#stage .welcome');return {surface:c.dataset.surface,labelled:c.getAttribute('aria-labelledby'),h:document.getElementById('wlT').textContent,lift:!!document.querySelector('#lift:not([hidden])'),lobby:!!document.querySelector('#stage .lobby,#stage .ro-lobby'),counts:getComputedStyle(document.getElementById('stats')).visibility,ring:!!document.querySelector('#addFolder.ring,#addFolder[data-ring]'),
        btns:[...c.querySelectorAll('button')].map(b=>b.textContent.trim()),small:[...c.querySelectorAll('*')].filter(e=>e.children.length===0&&e.textContent.trim()&&parseFloat(getComputedStyle(e).fontSize)<10.5).length}}catch(e){return {err:String(e)}}})()`);
      assert.ok(!fr.err, fr.err);
      assert.strictEqual(fr.surface, 'first-run', `${tag}: the card is the first-run moment`);
      assert.strictEqual(fr.h, 'Welcome to Agent Durbar', `${tag}: heading word for word`);
      assert.deepStrictEqual(fr.btns, ['Connect an AI account…', '+ Add a folder', 'Look around in the demo', 'Yes, show me the details', 'No, keep it simple'], `${tag}: buttons and order equal flat`);
      assert.strictEqual(fr.lobby, false, `${tag}: no lobby on a first run`);
      assert.strictEqual(fr.counts, 'hidden', `${tag}: no counts in the top bar`);
      assert.strictEqual(fr.small, 0, `${tag}: no text under 10.5px`);
      if (world === 'photo') { /* 052 FR-070: + Folder rings once, not under reduced motion */
        await emulate([{ name: 'prefers-reduced-motion', value: 'reduce' }], async () => {
          await H.load({ w, h, query: q(world, { sim: undefined, officeview: undefined }), ready: `!!document.querySelector('#stage .welcome')`, settle: false });
          await must(`performance.now()>1500`, 'the time the ring would have started');
          assert.strictEqual(await js(`document.getElementById('addFolder').classList.contains('ring-once')`), false, `${tag}: reduced motion: no ring`);
        });
        await H.load({ w, h, query: q(world, { sim: undefined, officeview: undefined }), ready: `!!document.querySelector('#stage .welcome')`, settle: false });
        await must(`document.getElementById('addFolder').classList.contains('ring-once')`, '+ Folder rings once');
        await must(`!document.getElementById('addFolder').classList.contains('ring-once')`, 'the ring over');
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
    // ---- FR-120 asleep, FR-126 walk ----
    if (run('asleep')) {
      await H.load({ w, h, query: q(world), ready: REAL, settle: false });
      await must(PICS, 'the pictures');
      /* the simulator's finished agents finished just now (the couch); make them finish 34 minutes ago (asleep), as the app's own clock reads it */
      await js(`window.__durbarSimUi.agents().filter(a=>!a.parent&&a.state==='done').forEach(a=>{a.lastEventAt=Date.now()-34*60000});window.__durbarSimUi.crew.renderAll()`);
      await must(`document.querySelectorAll('#stage .ro-plate.asleep').length>=1`, 'an asleep desk');
      const sl = await js(`(()=>{const P=[...document.querySelectorAll('#stage .ro-plate.asleep')];return P.map(p=>({id:p.dataset.id,l:p.getAttribute('aria-label'),t:p.getAttribute('title'),x:p.textContent,
        person:!!document.querySelector('#stage .ro-person.asleep[data-for="'+p.dataset.id+'"]'),zz:!!document.querySelector('#stage .ro-zz'),w:p.getBoundingClientRect().width,
        scr:(document.querySelector('#stage .ro-screen.asleep[data-for="'+p.dataset.id+'"]')||{className:''}).className}))})()`);
      for (const x of sl) {
        assert.ok(/^.+, .+, folder .+, asleep at the desk, finished 34 minutes ago: .+ Open chat panel\.$/.test(x.l), `${tag}: the screen-reader name: ${x.l}`);
        assert.ok(/^Asleep \u00B7 .+ \u00B7 finished 34 min ago \u00B7 Lamp off\n.+/.test(x.t), `${tag}: the hover card: ${x.t}`);
        assert.ok(/Asleep \u00B7 finished 34 min ago$/.test(x.x), `${tag}: the plate: ${x.x}`);
        assert.ok(x.person && x.zz, `${tag}: a person rests at the desk and the z z is drawn`);
      }
      const geo = await js(`(()=>{const L=window.__durbarSimUi.realLayout(),D=L.zones.flatMap(z=>z.desks),a=D.filter(d=>d.state==='asleep'),full=d=>L.zones.find(z=>z.desks.includes(d)).desks.find(x=>!x.narrow&&!x.away);
        return {ratio:a.map(d=>d.slot.w/full(d).slot.w),pose:a.map(d=>d.person&&d.person.pose),shades:document.querySelectorAll('#stage .ro-lamp.lamp-off').length,asleep:a.length,screensOff:document.querySelectorAll('#stage .ro-screen.asleep.off').length,
          chair:a.filter(d=>d.away).length,small:[...document.querySelectorAll('#stage .ro-plate.asleep *,#stage .ro-zz')].filter(e=>parseFloat(getComputedStyle(e).fontSize)<10.5).length}})()`);
      assert.ok(geo.ratio.every((r) => Math.abs(r - 0.62) < 0.02), `${tag}: an asleep desk is 0.62 wide: ${geo.ratio}`);
      assert.deepStrictEqual(geo.pose, geo.pose.map(() => 'rest'), `${tag}: the person is in rest`);
      assert.strictEqual(geo.shades, geo.asleep, `${tag}: a shade over each asleep desk only`);
      assert.strictEqual(geo.screensOff, geo.asleep, `${tag}: their screens are off`);
      assert.strictEqual(geo.chair + geo.small, 0, `${tag}: no empty-chair marker on an asleep desk; no text under 10.5px`);
      console.log('[moments] asleep ok', sl.length);
      await shot(world, 'asleep', w, h);
    }
    // ---- FR-121 inbox as a queue at the Boss door, FR-122 limit slip at the Bank, FR-124 MCP bubble ----
    if (run('inbox')) for (const n of ['15', '3']) {
      await H.load({ w, h, query: q(world, { simelicit: '1', sim: n }), ready: REAL, settle: false });
      await must(PICS, 'the pictures');
      await must(`!!document.querySelector('#stage .ro-slip.ro-queue:not([hidden])')`, 'the queue slip');
      const sl = await js(`(()=>{const e=document.querySelector('#stage .ro-slip.ro-queue');return {variant:e.dataset.variant,btns:[...e.querySelectorAll('button')].map(b=>b.textContent.trim()),sub:[...e.querySelectorAll('button')].map(b=>b.title),h:(e.querySelector('.sl-h')||{}).textContent,
        r:e.getBoundingClientRect().toJSON(),lobby:document.querySelector('#stage .ro-lobby').getBoundingClientRect().bottom,small:[...e.querySelectorAll('*')].filter(x=>x.children.length===0&&parseFloat(getComputedStyle(x).fontSize)<10.5).length}})()`);
      assert.ok(sl.r.top >= sl.lobby - 0.5, `${tag}: the slip sits under the lobby band`);
      assert.strictEqual(sl.small, 0, `${tag}: slip text >= 10.5px`);
      /* the inbox's own words for the same request, to compare: its first row, its buttons in its order */
      await js(`document.getElementById('inboxBtn').click()`);
      await must(`!!document.querySelector('#inboxDlg .inbox-row')`, 'the inbox');
      const dlg = await js(`(()=>{const r=document.querySelector('#inboxDlg .inbox-row'),h=document.querySelector('#inboxDlg .ib-world');return {title:document.getElementById('inboxT').textContent,first:r.querySelector('.ib-n').textContent,btns:[...r.querySelectorAll('.ib-ans button')].map(b=>b.textContent.trim()),
        focus:document.activeElement&&document.activeElement.className,header:!!h,aria:h&&h.getAttribute('aria-hidden'),door:h&&h.querySelector('img.ibw-door').getAttribute('src'),faces:h&&h.querySelectorAll('.ibw-face').length,bg:getComputedStyle(document.querySelector('#inboxDlg .inbox-dlg')).backdropFilter,
        small:[...document.querySelectorAll('#inboxDlg *')].filter(x=>x.children.length===0&&x.textContent.trim()&&parseFloat(getComputedStyle(x).fontSize)<10.5).length}})()`);
      assert.strictEqual(dlg.title, 'Needs you', `${tag}: the dialog keeps its heading`);
      assert.ok(dlg.header && dlg.aria === 'true' && dlg.faces >= 1 && dlg.door === `realoffice/worlds/${world}/fx-boss.webp`, `${tag}: the header with the world's Boss door and the queue's faces, aria-hidden: ${JSON.stringify(dlg)}`);
      assert.ok(/ib-h/.test(dlg.focus), `${tag}: focus lands on the first row's heading, never a button`);
      assert.strictEqual(dlg.bg, 'none', `${tag}: no blur behind the dialog text: ${dlg.bg}`);
      assert.strictEqual(dlg.small, 0, `${tag}: the dialog's text >= 10.5px`);
      if (sl.variant === 'full') {
        const flat = dlg.btns.filter((b) => !/^Open$/.test(b));
        assert.deepStrictEqual(sl.btns.slice(0, flat.length), flat, `${tag}: the slip's buttons are the inbox's, in its order`);
        assert.strictEqual(sl.btns[flat.length], 'Show in chat', `${tag}: then Show in chat`);
        assert.ok(sl.h.startsWith(dlg.first), `${tag}: the first slip is the inbox's first row`);
      }
      await js(`document.getElementById('inboxClose').click()`);
      await must(`!document.getElementById('inboxDlg')`, 'the inbox closed');
      await shot(world, n === '15' ? 'inbox' : 'inbox-3', w, h);
      assert.deepStrictEqual(await slipOverlaps(), [], `${tag}: no slip covers a plate, a sign, a chair label, a chip or a cue`);
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
      if (sl.variant === 'full' && n === '3') {
        const who = await js(`document.querySelector('#stage .ro-slip.ro-queue .sl-h b').textContent`);
        await js(`[...document.querySelectorAll('#stage .ro-slip.ro-queue .ro-sbtn')].find(b=>b.textContent.trim()==='Deny').click()`);
        await must(`(()=>{const e=document.querySelector('#stage .ro-slip.ro-queue');return !e||e.hidden||(e.querySelector('.sl-h b')||{}).textContent!==${jsLiteral(who)}})()`, 'the denied request gone from the slip');
      }
      await js(`document.querySelector('#stage .ro-slip.ro-bubble [data-slipact="open"]').click()`);
      await must(`document.body.classList.contains('panel-open')`, 'the chat opened from the bubble');
      await must(`!!document.querySelector('#chat .note.elicit')`, 'the card in the chat');
      assert.ok(await js(`document.getElementById('chat').querySelector('.note.elicit').textContent`).then((t) => /An MCP server asks for input/.test(t)), `${tag}: the chat holds the flat card`);
    }
    // ---- T139: reduced motion and forced colours ----
    if (run('emulation')) {
      await emulate([{ name: 'prefers-reduced-motion', value: 'reduce' }], async () => {
        await H.load({ w, h, query: q(world, { simrooms: '2', simhelpers: '0' }), ready: REAL, settle: false });
        await must(PICS, 'the pictures');
        await js(`window.__durbarSimUi.agents().filter(a=>!a.parent).forEach(a=>{window.__durbarSimUi.unvisit(a.id)})`);
        const who = await js(`(()=>{const d=window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks).find(d=>d.person&&!d.away&&d.state!=='asleep');return d&&d.id})()`);
        await js(`window.__durbarSimUi.visit(${jsLiteral(who)},'terminal')`);
        await must(`!!document.querySelector('#stage .ro-visitor[data-for="'+CSS.escape(${jsLiteral(who)})+'"]')&&!document.querySelector('#stage .ro-person[data-for="'+CSS.escape(${jsLiteral(who)})+'"]')`, 'the settled state at once');
        assert.deepStrictEqual(await js(`[window.DurbarRealOffice.walks().length,document.querySelectorAll('#stage .ro-trail,#stage .ro-gone,#stage .ro-in').length,document.querySelector('#stage .ro').classList.contains('still')]`), [0, 0, true], `${tag}: reduced motion: the settled state at once, no trail, no fade, the scene still`);
        assert.ok(!(await js(`document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(${jsLiteral(who)})+'"]').textContent`)).includes('\u2192'), `${tag}: and no "going" words`);
      });
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
    // ---- FR-125 jumps ride the lift ----
    if (run('jumps')) {
      await js(`localStorage.removeItem('durbar.floor')`); /* the first floor, whatever an earlier size left */
      await H.load({ w, h, query: q(world, { simfloors: '1' }), ready: REAL, settle: false, focus: true });
      await must(PICS, 'the pictures');
      await must(`!!document.querySelector('#lift:not([hidden]) [data-lift]')`, 'the lift');
      const floor0 = await H.shownFloor();
      await H.key('PageDown', [], { pause: 30 });
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
      // reduced motion: the floor changes at once, no cover
      await js(`localStorage.removeItem('durbar.floor')`);
      await emulate([{ name: 'prefers-reduced-motion', value: 'reduce' }], async () => {
        await H.load({ w, h, query: q(world, { simfloors: '1' }), ready: REAL, settle: false, focus: true });
        await must(`!!document.querySelector('#lift:not([hidden]) [data-lift]')`, 'the lift');
        const f1 = await H.shownFloor();
        await H.key('PageDown', [], { pause: 30 });
        await must(`localStorage.getItem('durbar.floor')!==${jsLiteral(f1)}`, 'the floor changed');
        assert.strictEqual(await js(`document.querySelectorAll('.ro-ride').length`), 0, `${tag}: reduced motion: no ride, the floor changes at once`);
      });
    }
    // ---- FR-123 coffee break ----
    if (run('coffee')) {
      await H.load({ w, h, query: q(world, { simbreak: '600' }), ready: REAL, settle: false });
      await must(`(window.__durbarSimUi.agents().find(a=>a.name==='Tomas')||{}).paused||[...document.querySelectorAll('#stage .ro-plate')].some(p=>/Tomas/.test(p.textContent)&&/Coffee/i.test(p.textContent))`, 'Tomas on a coffee break', 30000);
      const cf = await js(`(()=>{const p=[...document.querySelectorAll('#stage .ro-plate')].find(p=>/Tomas/.test(p.textContent));return {plate:p.textContent,label:p.getAttribute('aria-label'),title:p.getAttribute('title'),state:p.dataset.state,away:[...document.querySelectorAll('#stage .ro-away')].map(e=>e.textContent),
        chips:[...document.querySelectorAll('#stage .ro-chip')].filter(c=>c.dataset.coffeeid).map(c=>[c.textContent,c.getAttribute('aria-label')]),tent:[...document.querySelectorAll('#stage .ro-tent')].map(e=>e.textContent)}})()`);
      assert.ok(/^TomasPrompt tuner Coffee break \u00B7 Coffee break \u2014 resumes at /.test(cf.plate) && cf.state === 'waiting', `${tag}: the plate and the status (Waiting, never Error): ${cf.plate} ${cf.state}`);
      assert.ok(/^Tomas, Prompt tuner, Coffee break, .*at Coffee corner\. Open chat panel\.$/.test(cf.label), `${tag}: the name: ${cf.label}`);
      assert.ok(cf.away.includes('at Coffee corner \u2191'), `${tag}: the empty chair says "at Coffee corner"`);
      assert.deepStrictEqual(cf.tent.length === 1 && /^Coffee break \u00B7 until /.test(cf.tent[0]), true, `${tag}: one tent card: ${cf.tent}`);
      assert.strictEqual(cf.chips.length, 1, `${tag}: only the agent on a coffee break stands at the corner (FR-128): ${JSON.stringify(cf.chips)}`);
      assert.ok(/^Tomas \(until .* back in \d+ min\)\. Open the chat\.$/.test(cf.chips[0][1]), `${tag}: the corner chip's name: ${cf.chips[0][1]}`);
      await shot(world, 'coffee', w, h);
      await H.load({ w, h, query: q(world), ready: REAL, settle: false });
      await must(PICS, 'the pictures');
      assert.strictEqual(await js(`[...document.querySelectorAll('#stage .ro-chip')].filter(c=>c.dataset.coffeeid).length+document.querySelectorAll('#stage .ro-tent').length`), 0, `${tag}: with no coffee break nobody stands at the corner and no tent card is shown`);
    }
    // ---- FR-126 walk: leave and arrive, a pair of 300 ms; FR-127 the desk keeps its size ----
    if (run('walk')) {
      await H.load({ w, h, query: q(world, { simrooms: '2', simhelpers: '0' }), ready: REAL, settle: false });
      await must(PICS, 'the pictures');
      await js(`window.__durbarSimUi.agents().filter(a=>!a.parent).forEach(a=>{window.__durbarSimUi.unvisit(a.id)})`);
      await must(`window.DurbarRealOffice.walks().length===0`, 'no pair running');
      const who = await js(`(()=>{const L=window.__durbarSimUi.realLayout();const d=L.zones.flatMap(z=>z.desks).find(d=>d.person&&!d.away&&d.state!=='asleep');return d&&d.id})()`);
      assert.ok(who, `${tag}: a seated agent to send away`);
      const rects = () => js(`(()=>{const L=window.__durbarSimUi.realLayout();return JSON.stringify([L.height,L.lobbyH,L.zones.map(z=>z.desks.map(d=>[d.id,d.slot,d.desk,d.plate]))])})()`);
      await js(`window.DurbarRealOffice.walkMs(2500)`); /* the pair is 300 ms in the app; a driver that must look at it in between holds it (the CSS fades stay 150 ms) */
      const aways = () => js(`JSON.stringify(window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks.map(d=>[d.id,d.state,!!d.away,d.narrow,!!d.person])))`);
      /* the simulator's own agents also come and go between places, which is a real layout change of its own: the rule is about THIS visit, so a try
         during which another desk changed is repeated (at most 8 times) and the rule is asserted on the first clean one */
      const others = (x) => JSON.stringify(JSON.parse(x).filter((d) => d[0] !== who));
      let clean = false, mid = null;
      for (let attempt = 0; attempt < 8 && !clean; attempt++) {
        await must(`window.DurbarRealOffice.walks().length===0`, 'no pair running');
        const a0 = await aways(), before = await rects();
        await js(`window.__durbarSimUi.visit(${jsLiteral(who)},'terminal')`);
        if (!(await H.until(`window.DurbarRealOffice.walks().includes(${jsLiteral(who)})`, 6000))) console.log('[moments] DEBUG', attempt, await js(`JSON.stringify({info:window.DurbarRealOffice.walkInfo(),lay:window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks).filter(d=>d.id===${jsLiteral(who)}).map(d=>[d.state,d.away,d.narrow]),ro:document.querySelector('#stage .ro')&&document.querySelector('#stage .ro').className,hidden:document.hidden,vis:document.visibilityState})`));
        await must(`window.DurbarRealOffice.walks().includes(${jsLiteral(who)})`, 'the leaving pair');
        mid = await js(`(()=>{const k=${jsLiteral(who)};const pl=document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(k)+'"]');return {gone:document.querySelectorAll('#stage .ro-person.ro-gone[data-for="'+CSS.escape(k)+'"]').length,
          trail:document.querySelectorAll('#stage .ro-trail').length,plate:pl.textContent,info:window.DurbarRealOffice.walkInfo(),visitor:!!document.querySelector('#stage .ro-visitor[data-for="'+CSS.escape(k)+'"]')}})()`);
        if (attempt === 0) { /* a frame of the pair: the trail held at full strength (its 300 ms fade is a CSS animation) */
          await js(`(()=>{const s=document.createElement('style');s.id='holdTrail';s.textContent='.ro-trail{animation:none!important;opacity:1}';document.head.appendChild(s)})()`);
          await H.shot(path.join(OUT, `${world}-walk-f1-${w}x${h}.png`), { prep: 'mouse', delay: 200, tag: 'moments', what: `${world}-walk-f1-${w}x${h}` });
          await js(`document.getElementById('holdTrail').remove()`);
        }
        await must(`window.DurbarRealOffice.walks().length===0`, 'the pair over');
        await must(`!document.querySelector('#stage .ro-person.ro-gone')&&!document.querySelector('#stage .ro-trail')`, 'the settled state');
        const during = await rects(), a1 = await aways();
        if (others(a0) === others(a1)) { clean = true; assert.strictEqual(during, before, `${tag}: the desks keep their size during the visit (FR-127)`); }
        else { await js(`window.__durbarSimUi.unvisit(${jsLiteral(who)})`); await must(`window.DurbarRealOffice.walks().includes(${jsLiteral(who)})`, 'the pair back'); await must(`window.DurbarRealOffice.walks().length===0`, 'back'); }
      }
      assert.ok(clean, `${tag}: a clean try (no other desk changed) within 8 attempts`);
      assert.ok(mid.plate.includes('\u2192 Terminal'), `${tag}: the plate says where it goes during the pair: ${mid.plate} ${mid.info}`);
      assert.ok(mid.trail >= 1, `${tag}: a trail is drawn during the pair`);
      const settled = await js(`(()=>{const k=${jsLiteral(who)};const a=document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(k)+'"]');return {chair:[...document.querySelectorAll('#stage .ro-away')].map(e=>e.textContent).join('|'),person:!!document.querySelector('#stage .ro-person[data-for="'+CSS.escape(k)+'"]'),visitor:!!document.querySelector('#stage .ro-visitor[data-for="'+CSS.escape(k)+'"]')}})()`);
      assert.ok(/at Terminal \u2191/.test(settled.chair) && !settled.person && settled.visitor, `${tag}: settled: the empty chair says where, the figure is at the place: ${JSON.stringify(settled)}`);
      await shot(world, 'walk-away', w, h);
      await js(`window.__durbarSimUi.unvisit(${jsLiteral(who)})`);
      await must(`window.DurbarRealOffice.walks().includes(${jsLiteral(who)})`, 'the returning pair');
      await must(`window.DurbarRealOffice.walks().length===0&&!!document.querySelector('#stage .ro-person[data-for="'+CSS.escape(${jsLiteral(who)})+'"]')`, 'back at the desk');
      assert.strictEqual(await js(`document.querySelectorAll('#stage .ro-person[data-for="'+CSS.escape(${jsLiteral(who)})+'"]').length`), 1, `${tag}: one person back at the desk`);
    }
  }
};
