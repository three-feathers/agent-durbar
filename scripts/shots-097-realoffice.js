/*
 * Real office mode, phase P1 (spec 097 T015..T020): the scene and the lights in the simulator. No real agent session, no account, no
 * AI credits (constitution IV).
 *
 *   npm run build
 *   SHOTS_OUT=<dir> DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-097-realoffice.js npx electron .        (xvfb-run -a ... --no-sandbox on Linux)
 *   node scripts/ui-suite.js --only shots-097-realoffice
 *
 * At 1440x900 and 1280x800 it fails (exit 1) when:
 *   - flat is not the default (no Real office element, no Real office file requested: FR-002, SC-004);
 *   - Settings > Office layout has no third button, or choosing it does not draw the Real office, or Open office / Office with cabins do
 *     not bring the flat office back (FR-001, FR-003; durbar.doorsigns untouched), or a broken stored value is not flat;
 *   - with 15 agents: a main agent without its one focusable plate (button, accessible name with the status word, FR-090), a plate
 *     without a status word, a desk without a person that is not away or asleep, an away desk without "at <place>" (FR-017);
 *   - a status cue is missing: a waiting agent without its "?" and amber call light, an error agent without "!" and its red call light,
 *     a light shown without a word (FR-038, FR-041, FR-046);
 *   - the lights move under reduced motion (no running animation on .ro-lights) or Serious mode (FR-047), or show under forced colours (FR-051);
 *   - the room is not dimmer with fewer active agents (FR-043);
 *   - a click on a person or a plate does not open that agent's chat (FR-006);
 *   - a picture that fails to load leaves a broken image instead of the initials disc (FR-065).
 *   - the world chrome (FR-113): in Real office the top bar, More menu, a toast, Settings and a dialog do not use the photo world's
 *     tokens (glass, bar ink, page ink), text under 10.5px, or leaving Real office does not restore the theme exactly; flat has no world.
 * Screenshots: <SHOTS_OUT>/097-world-{menu,toast,settings,dialog}-<w>x<h>.png, 097-real-15-<w>x<h>.png, 097-real-lobby-<w>x<h>.png (the lobby band, with the Terminal runner), 097-real-3-<w>x<h>.png, 097-real-lights-1440x900.png, 097-office-layout-1440x900.png.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-097-'));
const SIZES = [[1440, 900], [1280, 800]];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
  /* every picture of the office has decoded (or failed): no half-drawn screenshot */
  const PICS = `[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`;
  const loadReal = async (w, h, query = {}) => {
    await H.load({ w, h, query: { officeview: 'real', ...query }, ready: REAL, settle: false });
    await must(PICS, 'the pictures');
  };
  /* the requests the page made (performance entries): what flat mode must never fetch (SC-004) */
  const realFiles = () => js(`performance.getEntriesByType('resource').map(e=>e.name).filter(n=>/realoffice|\\/shared\\/(lights|realoffice-layout)\\.js/.test(n)).length`);

  // ---- FR-002, SC-004: flat is the default and loads nothing of Real office ----
  await H.load({ w: 1440, h: 900 });
  assert.strictEqual(await js(`!!document.querySelector('.ro')`), false, 'flat by default');
  assert.strictEqual(await realFiles(), 0, 'flat mode requested a Real office file');
  assert.strictEqual(await js(`!!window.DurbarRealOffice`), false, 'flat mode loaded realoffice.js');

  // ---- FR-001, FR-003, FR-004: the Settings button and the stored choice ----
  await js(`localStorage.setItem('durbar.doorsigns','off')`);
  await H.load({ w: 1440, h: 900 });
  await js(`window.DurbarScreens.openSettings()`);
  await must(`!!document.querySelector('[data-officelayout="real"]')`, 'the Real office button');
  const seg = await js(`[...document.querySelectorAll('[data-officelayout]')].map(b=>b.dataset.officelayout+':'+b.getAttribute('aria-pressed')).join(' ')`);
  assert.strictEqual(seg, 'cabins:false open:true real:false', 'three buttons, Open office pressed: ' + seg);
  await js(`document.querySelector('[data-officelayout="real"]').scrollIntoView({block:'center'})`);
  await H.shot(path.join(OUT, '097-office-layout-1440x900.png'), { prep: 'calm' });
  await js(`document.querySelector('[data-officelayout="real"]').click()`);
  await must(`document.querySelector('[data-officelayout="real"]').getAttribute('aria-pressed')==='true'`, 'Real office pressed');
  assert.strictEqual(await js(`localStorage.getItem('durbar.officeview')`), 'real', 'stored as real');
  assert.strictEqual(await js(`localStorage.getItem('durbar.doorsigns')`), 'off', 'durbar.doorsigns untouched');
  await js(`document.getElementById('scrClose').click()`);
  await must(REAL, 'the Real office after the Settings choice');
  await js(`window.DurbarScreens.openSettings()`);
  await must(`!!document.querySelector('[data-officelayout="open"]')`, 'the Office layout row');
  await js(`document.querySelector('[data-officelayout="open"]').click()`);
  await must(`localStorage.getItem('durbar.officeview')==='flat'`, 'back to flat');
  await js(`document.getElementById('scrClose').click()`);
  await must(`!document.querySelector('#stage .ro')&&document.querySelectorAll('#stage .desk[data-id]').length>=15`, 'the flat desks again');
  await js(`localStorage.setItem('durbar.officeview','nonsense')`);
  await H.load({ w: 1440, h: 900 });
  assert.strictEqual(await js(`!!document.querySelector('.ro')`), false, 'a broken stored value means flat');

  for (const [w, h] of SIZES) {
    await loadReal(w, h);
    // ---- FR-090, FR-016, FR-017, FR-036: plates, people, away desks ----
    const d = await js(`(()=>{const ids=window.__durbarSimUi.agents().filter(a=>!a.parent).map(a=>a.id);
      const plates=[...document.querySelectorAll('#stage .ro-plate')];
      return {ids:ids.length,plates:plates.length,missing:ids.filter(id=>!plates.some(p=>p.dataset.id===id)),
        noWord:plates.filter(p=>!/(Working|Thinking|Waiting|Error|Done|Idle|Paused|Limit|Retrying|Compacting|Failing|Ended|Ready|break|asleep|Stopped)/i.test(p.getAttribute('aria-label')||'')).map(p=>p.getAttribute('aria-label')),
        notButton:plates.filter(p=>p.tagName!=='BUTTON').length,
        away:document.querySelectorAll('#stage .ro-away').length,visitors:document.querySelectorAll('#stage .ro-visitor').length,
        persons:document.querySelectorAll('#stage .ro-person').length,fixtures:document.querySelectorAll('#stage .ro-fx').length,
        face:+document.querySelector('#stage .ro').dataset.face,states:[...new Set(plates.map(p=>p.dataset.state))].sort().join(',')}})()`);
    console.log('[097]', w, h, JSON.stringify(d));
    assert.deepStrictEqual(d.missing, [], 'every main agent has its plate');
    assert.strictEqual(d.plates, d.ids, 'one plate per main agent');
    assert.strictEqual(d.notButton, 0, 'plates are buttons');
    assert.deepStrictEqual(d.noWord, [], 'every plate names its status in words');
    assert.ok(d.persons >= 8, 'people sit at their desks: ' + d.persons);
    assert.ok(d.fixtures >= 8, 'the lobby fixtures are drawn: ' + d.fixtures);
    const aw = await js(`[...document.querySelectorAll('#stage .ro-away')].every(e=>/^at .+ ↑$/.test(e.textContent))`);
    assert.ok(aw, 'away desks say where');
    // ---- FR-038, FR-041, FR-046: cues and lights by status ----
    const cues = await js(`(()=>{const o={};for(const p of document.querySelectorAll('#stage .ro-plate')){const id=p.dataset.id,st=p.dataset.state;
      const call=[...document.querySelectorAll('#stage .ro-call')].find(c=>c.dataset.for===id);(o[st]=o[st]||[]).push(call?call.className.replace(/ro-call |pulse|fade/g,'').trim():'none');}return o;})()`);
    console.log('[097] call lights by state', JSON.stringify(cues));
    if (cues.waiting) assert.ok(cues.waiting.every((c) => c === 'call-amber'), 'waiting: amber call light');
    if (cues.error) assert.ok(cues.error.every((c) => c === 'call-red'), 'error: red call light');
    if (cues.limit) assert.ok(cues.limit.every((c) => c === 'call-orange'), 'limit: orange call light');
    for (const st of ['working', 'thinking', 'idle', 'asleep']) if (cues[st]) assert.ok(cues[st].every((c) => c === 'none'), `${st}: no call light`);
    const bub = await js(`({e:document.querySelectorAll('#stage .ro-plate[data-state="error"]').length,x:document.querySelectorAll('#stage .ro-bang').length})`);
    assert.strictEqual(bub.x, bub.e, 'one "!" per error desk');
    // ---- owner 2026-10-31 10:19 and 10:48: every visitor's feet (its measured foot line) on the FRONT floor plane (in front of the
    //      fixtures, FRONT_DEPTH of the strip below the wall line) within 2 px, with a contact shadow there; no chip over a figure's lower 25 % ----
    const FEET = `(()=>{const A=self.DurbarRealOfficeArt,sr=document.querySelector('#stage .ro-strip').getBoundingClientRect(),wl=sr.top+3,fl=wl+self.exports.FRONT_DEPTH*(sr.bottom-wl),out=[];
      const chips=[...document.querySelectorAll('#stage .ro-chip')].map(c=>c.getBoundingClientRect());
      for(const im of document.querySelectorAll('#stage .ro-visitor')){const m=/(p\\d\\d)-(\\w+)\\.webp$/.exec(im.getAttribute('src'));const f=A.stand[m[1]].feet[m[2]],t=A.stand[m[1]].top[m[2]];
        const r=im.getBoundingClientRect(),y=r.top+r.height*f,cx=r.left+r.width/2,lo=r.top+r.height*(f-0.25*(f-t));
        const sh=[...document.querySelectorAll('#stage .ro-shadow')].some(s=>{const q=s.getBoundingClientRect();return q.left<cx&&q.right>cx&&Math.abs((q.top+q.bottom)/2-fl)<=2;});
        const legs=chips.filter(q=>q.left<r.left+r.width*0.8&&q.right>r.left+r.width*0.2&&q.top<y&&q.bottom>lo).length;
        out.push({who:im.dataset.for,pose:m[2],off:Math.round((y-fl)*10)/10,wall:Math.round((y-wl)*10)/10,sh,legs});}
      return out;})()`;
    const feet = await js(FEET);
    console.log('[097] feet vs front floor plane', w, JSON.stringify(feet.map((f) => f.pose + ':' + f.off + ' (wall +' + f.wall + ')')));
    assert.ok(feet.length >= 3, 'visitors stand in the lobby');
    for (const f of feet) {
      assert.ok(Math.abs(f.off) <= 2, `${f.who} (${f.pose}) floats or sinks: ${f.off} px from the front floor plane`);
      assert.ok(f.wall >= 6, `${f.who} stands in front of the fixtures, not on the wall's base line (${f.wall} px below it)`);
      assert.ok(f.sh, `${f.who} has a contact shadow`);
      assert.strictEqual(f.legs, 0, `${f.who}: no name chip covers the feet or legs`);
    }
    await H.shot(path.join(OUT, `097-real-15-${w}x${h}.png`), { prep: 'calm' });
    // ---- owner 2026-10-31 ("make a real running pose"): someone at the Terminal jogs in place (stride A in P1), no treadmill; a
    //      close crop of the lobby band shows it ----
    // A simulator visit comes and goes, so wait for one, let its pictures decode, take the crop, and keep the crop only if the runner is still there.
    const RUNNER = `[...document.querySelectorAll('#stage .ro-visitor')].some(i=>/-runA\\.webp$/.test(i.getAttribute('src'))&&i.complete&&i.naturalWidth>0)`;
    let crop = null, run = null, runners = [];
    for (let t = 0; t < 8 && !crop; t++) {
      await must(RUNNER, 'someone running at the Terminal', 40000);
      run = await js(`(async()=>{const v=[...document.querySelectorAll('#stage .ro-visitor')];await Promise.all(v.map(i=>i.decode().catch(()=>0)));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const lob=document.querySelector('#stage .ro-lobby').getBoundingClientRect();
        return {tread:v.filter(i=>/tread/.test(i.getAttribute('src'))).length,poses:v.map(i=>i.dataset.pose).join(','),lobby:[lob.left,lob.top,lob.width,lob.height].map(Math.round)}})()`);
      runners = (await js(FEET)).filter((x) => x.pose === 'runA');
      const [lx, ly, lw, lh] = run.lobby;
      const c = await ctx.win.webContents.capturePage({ x: lx, y: ly, width: lw, height: lh });
      if (runners.length && await js(RUNNER)) crop = c;
    }
    assert.ok(crop, 'a lobby crop with someone running at the Terminal');
    console.log('[097] lobby poses', w, run.poses);
    assert.strictEqual(run.tread, 0, 'no treadmill picture');
    for (const f of runners) assert.ok(Math.abs(f.off) <= 2 && f.sh && f.legs === 0, `the runner ${f.who} is on the floor with a shadow and no chip on the legs (${f.off} px)`);
    fs.writeFileSync(path.join(OUT, `097-real-lobby-${w}x${h}.png`), crop.toPNG());
  }

  // ---- FR-020: few agents, big screens ----
  for (const [w, h] of SIZES) {
    await loadReal(w, h, { sim: '3' });
    const big = await js(`document.querySelector('#stage .ro').dataset.big`);
    assert.strictEqual(big, '1', 'big screens with 3 agents');
    await H.shot(path.join(OUT, `097-real-3-${w}x${h}.png`), { prep: 'calm' });
  }

  // ---- FR-006: a click on a person opens its chat ----
  await loadReal(1440, 900);
  const pid = await js(`(document.querySelector('#stage .ro-person')||{dataset:{}}).dataset.for||''`);
  assert.ok(pid, 'a person is drawn');
  await js(`document.querySelector('#stage .ro-person[data-for="'+CSS.escape(${jsLiteral(pid)})+'"]').click()`);
  await must(`document.body.classList.contains('panel-open')`, 'the chat after a click on a person');
  await js(`document.getElementById('backBtn').click()`);
  await must(`!document.body.classList.contains('panel-open')&&!!document.querySelector('#stage .ro .ro-plate')`, 'the office again');

  // ---- FR-037: a session keeps its person, also across a status filter that hides it ----
  const who = `JSON.stringify(Object.fromEntries([...document.querySelectorAll('#stage .ro-person')].map(i=>[i.dataset.for,i.getAttribute('src').replace(/-\\w+\\.webp$/,'')])))`;
  const before = await js(who);
  const all = await js(`document.querySelectorAll('#stage .ro-plate').length`);
  await js(`document.querySelector('.stat[data-k="waiting"]').click()`);
  await must(`document.querySelectorAll('#stage .ro-plate').length<${jsLiteral(Number(all))}`, 'the filter');
  await js(`document.querySelector('.stat[data-k="waiting"]').click()`);
  await must(`document.querySelectorAll('#stage .ro-plate').length===window.__durbarSimUi.agents().filter(a=>!a.parent).length`, 'the filter off');
  await must(PICS, 'the pictures');
  assert.strictEqual(await js(who), before, 'every session keeps its person across a filter');
  // ---- FR-047: Serious mode: no light animation ----
  await js(`document.documentElement.setAttribute('data-serious','')`);
  const anim = await js(`[...document.querySelectorAll('#stage .ro-lights *')].filter(e=>getComputedStyle(e).animationName!=='none').length`);
  assert.strictEqual(anim, 0, 'Serious mode: no light moves');
  await js(`document.documentElement.removeAttribute('data-serious')`);
  const reduced = await js(`matchMedia('(prefers-reduced-motion: reduce)').matches`);
  if (reduced) assert.strictEqual(await js(`[...document.querySelectorAll('#stage .ro-lights *')].filter(e=>getComputedStyle(e).animationName!=='none').length`), 0, 'reduced motion: no light moves');

  // ---- FR-043: fewer active agents, a dimmer room (8 agents: bigger desks, every light visible in the picture) ----
  const amb15 = Number(await js(`document.querySelector('#stage .ro').dataset.ambient`));
  await loadReal(1440, 900, { sim: '8' });
  const amb = Number(await js(`document.querySelector('#stage .ro').dataset.ambient`));
  assert.ok(amb >= 0.7 && amb <= 1 && amb15 >= 0.7 && amb15 <= 1, 'ambient in 0.7..1: ' + amb + ', ' + amb15);
  console.log('[097] ambient: 15 agents', amb15, '8 agents', amb);
  await H.shot(path.join(OUT, '097-real-lights-1440x900.png'), { prep: 'calm' });

  // ---- FR-065: a picture that fails: no broken image, the initials disc ----
  const victim = await js(`(()=>{const i=document.querySelector('#stage .ro-person');const f=i.dataset.for;i.src='realoffice/art/missing.webp';return f})()`);
  await must(`!!document.querySelector('#stage .ro-initials[data-for="'+CSS.escape(${jsLiteral(victim)})+'"]')`, 'the initials disc after a failed picture');
  assert.strictEqual(await js(`[...document.querySelectorAll('#stage .ro img')].filter(i=>i.complete&&!i.naturalWidth).length`), 0, 'no broken image left on screen');

  // ---- FR-100, FR-113 (owner 2026-10-31 10:46: "the top bar and menu ... should follow the same design"): the world's token set ----
  // on the top bar, the More menu, Settings, a dialog and a toast, at both sizes; flat keeps the user's theme; leaving restores it
  const RGB = (hex) => { const h = hex.replace('#', ''); return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`; };
  /* contrast helpers, installed in the page once per load (ensureLum) as window.__roRatio */
  const lumJs = `{const lum=c=>{const k=/^color\\(/.test(c)?1:255;const v=(c.replace(/^color\\(srgb/,'').match(/[\\d.]+/g)||[]).slice(0,3).map(Number).map(x=>x/k).map(x=>x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4));return .2126*v[0]+.7152*v[1]+.0722*v[2]};const ratio=(a,b)=>{const[x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+.05)/(y+.05)};window.__roRatio=ratio;}true;`;
  const ensureLum = () => js(lumJs);
  const W = await js(`JSON.stringify(window.THEME.worldTokens('photo'))`).then(JSON.parse);
  await H.load({ w: 1440, h: 900 });
  const flat = await js(`({w:document.documentElement.dataset.world||'',bar:getComputedStyle(document.querySelector('.topbar')).backgroundColor,img:getComputedStyle(document.querySelector('.topbar')).backgroundImage,css:!!document.getElementById('roWorldCss')})`);
  assert.deepStrictEqual(flat, { w: '', bar: 'rgb(255, 253, 249)', img: 'none', css: false }, 'flat: the Clean Office bar, no world, no world CSS loaded: ' + JSON.stringify(flat));
  for (const [w, h] of SIZES) {
    await loadReal(w, h);
    await ensureLum();
    await must(`document.documentElement.dataset.world==='photo'&&!!document.getElementById('roWorldCss')&&getComputedStyle(document.querySelector('.topbar')).backgroundImage.includes('gradient')&&getComputedStyle(document.getElementById('addFolder')).backgroundColor===${jsLiteral(RGB(W['--wb-surface']))}`, 'the world chrome (after the buttons\' colour transition)');
    const bar = await js(`(()=>{const ratio=window.__roRatio;const b=document.querySelector('.topbar'),cs=getComputedStyle(b),bg=getComputedStyle(document.documentElement).getPropertyValue('--wb-bg').trim();
      const texts=[...b.querySelectorAll('h1,.btn,.seg button,select,.stat')].filter(e=>e.getClientRects().length&&!e.closest('.more-menu'));
      const ink=getComputedStyle(b.querySelector('h1')).color, btn=getComputedStyle(document.getElementById('addFolder'));
      return {ink,btnInk:btn.color,btnBg:btn.backgroundColor,h:b.getBoundingClientRect().height,minFont:Math.min(...texts.map(e=>parseFloat(getComputedStyle(e).fontSize))),bg};})()`);
    console.log('[097] world top bar', w, JSON.stringify(bar));
    assert.strictEqual(bar.ink, RGB(W['--wb-ink']), 'the title is the bar ink');
    assert.strictEqual(bar.btnBg, RGB(W['--wb-surface']), 'a bar button is on the bar surface: ' + JSON.stringify(bar));
    assert.ok(bar.h <= 52.5, 'the top bar keeps its one row: ' + bar.h);
    assert.ok(bar.minFont >= 10.5, 'top bar text at least 10.5px: ' + bar.minFont);
    // every text in the bar reads on what is behind it (its own background, else the bar's): 4.5:1
    const low = await js(`(()=>{const ratio=window.__roRatio;const out=[];const bgOf=e=>{for(let x=e;x&&x!==document.body;x=x.parentElement){const c=getComputedStyle(x).backgroundColor;if(c&&!/rgba\\(0, 0, 0, 0\\)|transparent/.test(c))return c;}return 'rgb(42, 35, 30)';};
      for(const e of document.querySelectorAll('.topbar h1,.topbar .btn,.topbar .seg button,.topbar select,.topbar .stat b,.topbar .stat span.l,.topbar .inbox-btn b,.topbar .inbox-btn,.topbar .sched-top,.topbar .proto'))if(e.getClientRects().length&&!e.closest('.more-menu')){const r=ratio(getComputedStyle(e).color,bgOf(e));if(r<4.5)out.push((e.id||e.className||e.tagName)+' '+r.toFixed(2));}return out;})()`);
    assert.deepStrictEqual(low, [], 'top bar text at 4.5:1 or more');
    // the More menu: frosted glass with the page values back (dark text on the cream glass), inside the bar
    await js(`document.getElementById('topMoreBtn').click()`);
    await must(`!document.getElementById('topMoreMenu').hidden`, 'the More menu');
    const menu = await js(`(()=>{const m=document.getElementById('topMoreMenu'),cs=getComputedStyle(m),it=m.querySelector('.more-it .mt');return {bf:cs.backdropFilter,bg:cs.backgroundColor,ink:getComputedStyle(it).color,font:parseFloat(getComputedStyle(it.querySelector('small')||it).fontSize)};})()`);
    console.log('[097] world More menu', w, JSON.stringify(menu));
    assert.ok(/blur/.test(menu.bf), 'the menu is frosted glass');
    assert.ok(/color-mix|rgba|color\(srgb/.test(menu.bg) || menu.bg !== RGB(W['--surface']), 'the menu fill is translucent: ' + menu.bg);
    assert.strictEqual(menu.ink, RGB(W['--ink']), 'menu text is the page ink, not the bar ink');
    assert.ok(menu.font >= 10.5, 'menu text at least 10.5px');
    await H.shot(path.join(OUT, `097-world-menu-${w}x${h}.png`), { prep: 'calm' });
    await js(`document.getElementById('topMoreBtn').click()`);
    await must(`document.getElementById('topMoreMenu').hidden`, 'the More menu closed');
    // a toast (with its button): the bar's dark glass
    await js(`window.__durbarSimUi.toast('Real office: 3 sessions resumed.','Undo')`);
    await must(`!!document.querySelector('#toasts .toast')`, 'a toast');
    const toast = await js(`(()=>{const ratio=window.__roRatio;const t=document.querySelector('#toasts .toast'),cs=getComputedStyle(t);return {ink:cs.color,bf:cs.backdropFilter,font:parseFloat(cs.fontSize)};})()`);
    assert.strictEqual(toast.ink, RGB(W['--wb-ink']), 'toast text is the bar ink');
    assert.ok(/blur/.test(toast.bf), 'the toast is glass');
    await js(`(document.getElementById('shotCalm')||{remove(){}}).remove()`); /* the calm style hides every toast once made without keepActions */
    await H.shot(path.join(OUT, `097-world-toast-${w}x${h}.png`), { prep: 'calm', keepActions: true });
    await js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove());(document.getElementById('shotCalm')||{remove(){}}).remove()`);
    // Settings: the page set, and the theme note
    await js(`window.DurbarScreens.openSettings()`);
    await must(`!!document.getElementById('thWorld')`, 'Settings');
    const set = await js(`({note:document.getElementById('thWorld').hidden?'':document.getElementById('thWorld').textContent,sec:getComputedStyle(document.querySelector('.scr-sec')).backgroundColor,ink:getComputedStyle(document.querySelector('.scr-sec h3')).color,bg:getComputedStyle(document.body).backgroundColor})`);
    console.log('[097] world Settings', w, JSON.stringify(set));
    assert.ok(/Real office uses the colours of its world \(Photo office\)/.test(set.note), 'Settings says the theme shows in the flat office');
    assert.strictEqual(set.sec, RGB(W['--surface']), 'Settings sections are the world surface');
    assert.strictEqual(set.ink, RGB(W['--ink']), 'Settings text is the world ink');
    await H.shot(path.join(OUT, `097-world-settings-${w}x${h}.png`), { prep: 'calm' });
    await js(`document.getElementById('scrClose').click()`);
    // a dialog: the keyboard shortcuts sheet, frosted glass on a warm scrim
    await js(`document.getElementById('kbdHelpBtn').click()`);
    await must(`!!document.querySelector('.dlg-ov .dlg')`, 'a dialog');
    const dlg = await js(`(()=>{const d=document.querySelector('.dlg-ov .dlg'),cs=getComputedStyle(d);return {bf:cs.backdropFilter,ink:cs.color,h2:getComputedStyle(d.querySelector('h2,h3')).color};})()`);
    assert.ok(/blur/.test(dlg.bf), 'the dialog is frosted glass');
    assert.strictEqual(dlg.h2, RGB(W['--ink']), 'dialog text is the world ink');
    await H.shot(path.join(OUT, `097-world-dialog-${w}x${h}.png`), { prep: 'calm' });
    await js(`document.getElementById('kbdClose').click()`);
    await must(`!document.querySelector('.dlg-ov .dlg')`, 'the dialog closed');
  }
  // forced colours: the system colours win (no glass, no gradient); reduced transparency: opaque panels (emulated media)
  {
    const dbg = ctx.win.webContents.debugger;
    if (!dbg.isAttached()) dbg.attach('1.3');
    try {
      for (const [name, value] of [['forced-colors', 'active'], ['prefers-reduced-transparency', 'reduce']]) {
        await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name, value }] });
        const on = await js(`matchMedia('(${name}: ${value})').matches`);
        await js(`document.getElementById('topMoreBtn').click()`);
        await must(`!document.getElementById('topMoreMenu').hidden`, 'the More menu');
        const m = await js(`(()=>{const m=getComputedStyle(document.getElementById('topMoreMenu')),b=getComputedStyle(document.querySelector('.topbar'));return {bf:m.backdropFilter,bg:m.backgroundColor,img:b.backgroundImage,sh:b.boxShadow};})()`);
        console.log('[097] world under', name, on, JSON.stringify(m));
        assert.ok(on, `${name} is emulated`);
        assert.strictEqual(m.bf, 'none', `${name}: no glass blur`);
        if (name === 'forced-colors') assert.ok(m.img === 'none' && m.sh === 'none', 'forced colours: no gradient or shadow on the bar');
        else assert.strictEqual(m.bg, RGB(W['--surface']), 'reduced transparency: the menu is opaque');
        await js(`document.getElementById('topMoreBtn').click()`);
        await must(`document.getElementById('topMoreMenu').hidden`, 'the More menu closed');
      }
    } finally {
      await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [] }).catch(() => undefined);
      dbg.detach();
    }
  }
  // leaving Real office gives the user's theme back, exactly (Clean Office: the bar is its light surface again)
  await js(`window.DurbarScreens.openSettings()`);
  await must(`!!document.querySelector('[data-officelayout="open"]')`, 'the Office layout row');
  await js(`document.querySelector('[data-officelayout="open"]').click()`);
  await must(`localStorage.getItem('durbar.officeview')==='flat'&&!document.documentElement.dataset.world`, 'flat again');
  assert.ok(await js(`document.getElementById('thWorld').hidden`), 'the theme note goes with the world');
  await js(`document.getElementById('scrClose').click()`);
  const back = await js(`({bar:getComputedStyle(document.querySelector('.topbar')).backgroundColor,img:getComputedStyle(document.querySelector('.topbar')).backgroundImage,surface:getComputedStyle(document.documentElement).getPropertyValue('--surface').trim(),wb:getComputedStyle(document.documentElement).getPropertyValue('--wb-bg').trim()})`);
  assert.deepStrictEqual(back, { bar: 'rgb(255, 253, 249)', img: 'none', surface: '#fffdf9', wb: '' }, 'leaving Real office restores Clean Office: ' + JSON.stringify(back));
  console.log('[097] real office checks passed; shots in', OUT);
};
