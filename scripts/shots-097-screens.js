/*
 * Real office mode, phase P2 (spec 097 T030..T032): live screens and the hover zoom, in the simulator; the motion is check-097-motion.js. No real agent
 * session, no account, no AI credits (constitution IV). In ui-suite.js; `node scripts/ui-suite.js --only shots-097-screens`.
 *
 * At 1440x900 and 1280x800 with 15 agents it fails (exit 1) when:
 *   - a screen is a placeholder: an awake desk's screen has no real text, its text is under 10.5 px, or text does not change when the agent writes (FR-030, FR-032);
 *   - the newest line is not at the bottom of the glass, or a repaint comes sooner than 2 s after the last under a stream of lines (FR-033);
 *   - a hostile line (token, home path, markup, a link, ANSI, 1 MB) shows on a screen or in the zoom other than masked, inert and capped (FR-031, SC-005);
 *   - a status screen is wrong: amber frame, red tint, dark glass with no text when asleep, a green done line (FR-035);
 *   - the zoom, for every one of the 15 screens by real pointer moves: covers its own plate or a needs-you plate, leaves the window, is not 380-480 px wide or 12.5 px
 *     text, or stays after the pointer left; Esc closes it and it stays closed until the pointer has left; Tab to a desk's plate opens the same zoom, Esc closes it
 *     with the focus kept; it is a named region and not a live one (FR-034);
 *   - 3 agents at both sizes: a screen shows fewer than 8 lines of real text at 11 px or more (FR-020, SC-003, T032);
 * Screenshots: <SHOTS_OUT>/097-zoom-<w>x<h>.png, 097-real-big-<w>x<h>.png
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-097-screens-'));
const SIZES = [[1440, 900], [1280, 800]];
const TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const T0 = Date.now(), mark = (m) => console.log(`[097-screens] ${Math.round((Date.now() - T0) / 1000)} s: ${m}`);
  const wc = () => ctx.win.webContents;
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
  const PICS = `[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`;
  /* a frozen simulator (nothing changes but what the driver emits); romotion=1: the people move, as outside a driver */
  const loadReal = async (w, h, query = {}) => {
    await H.load({ w, h, query: { officeview: 'real', romotion: '1', ...query }, ready: REAL, settle: false });
    await must(PICS, 'the pictures');
    await must(`document.querySelectorAll('#stage .ro-stext:not(.off) .ro-sl').length>0`, 'text on the screens');
    await H.calm();
  };
  const emit = (e) => js(`void window.__durbarSimEmit(Object.assign({timestamp:Date.now()},${jsLiteral(e)}));0`);
  /* a screen's text box lies exactly over its glass: find it by the desk's glass rectangle from the layout */
  const INSTALL = `window.__scr=(id)=>{const L=window.__durbarSimUi.realLayout(),d=L.zones.flatMap(z=>z.desks).find(x=>x.id===id),ro=document.querySelector('#stage .ro').getBoundingClientRect();if(!d)return null;
      return [...document.querySelectorAll('#stage .ro-stext')].find(e=>{const b=e.getBoundingClientRect();return Math.abs(b.left-ro.left-d.glass.x)<1&&Math.abs(b.top-ro.top-d.glass.y)<1;})||null;};0`;
  const pickWorking = `window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks).filter(d=>d.state==='working').map(d=>d.id)`;

  /* ---- FR-030, FR-032, FR-033, FR-035, SC-005: the screens at 15 agents ---- */
  for (const [w, h] of SIZES) {
    await loadReal(w, h);
    await js(INSTALL);
    const all = await js(`(()=>{const L=window.__durbarSimUi.realLayout(),out=[];for(const d of L.zones.flatMap(z=>z.desks)){const e=window.__scr(d.id);if(!e){out.push({id:d.id,state:d.state,none:true});continue;}
      const rows=[...e.querySelectorAll('.ro-sl')];out.push({id:d.id,state:d.state,text:e.textContent,small:e.classList.contains('small'),glass:[Math.round(d.glass.w),Math.round(d.glass.h)],
        fonts:rows.map(r=>parseFloat(getComputedStyle(r).fontSize)),color:rows.length?getComputedStyle(rows[rows.length-1]).color:'',k:rows.length?rows[rows.length-1].dataset.k:'',
        head:rows.length&&e.classList.contains('small')?rows[rows.length-1].getBoundingClientRect().top-e.querySelector('.ro-clip').getBoundingClientRect().top:0,bars:e.querySelectorAll('.ro-bars i').length,tags:[...e.querySelectorAll('a,img,script,svg')].length});}return out;})()`);
    console.log('[097-screens]', w, h, all.map((s) => `${s.state}:${(s.text || '').slice(0, 30)}|${s.bars}`).join(' ; '));
    assert.strictEqual(all.length, 15, '15 desks');
    for (const s of all) {
      assert.ok(!s.none, 'a text box for ' + s.id);
      if (s.state === 'asleep') { assert.strictEqual(s.text, '', 'asleep: no text'); continue; }
      assert.ok(s.text.trim().length > 3, `${s.id} (${s.state}) has real text: "${s.text}"`);
      assert.ok(s.fonts.length && s.fonts.every((f) => f >= 10.5), `${s.id}: text at least 10.5 px: ${s.fonts}`);
      assert.strictEqual(s.tags, 0, 'no element but text on a screen');
      assert.ok(s.head >= -0.5, `${s.id}: a small screen shows its newest line from the start, not a cut tail: "${s.text}" ${s.head}`);
    }
    assert.ok(all.some((s) => s.bars > 0), 'FR-032: bars from earlier lines on small screens');
    // FR-035: status screens, computed
    const look = await js(`(()=>{const q=(st,sel,prop,pe)=>{const e=document.querySelector('#stage .ro-screen.st-'+st+' '+sel);return e?getComputedStyle(e,pe)[prop]:null;};
      return {waitFrame:q('waiting','.ro-bezel','boxShadow'),errGlass:q('error','.ro-glass','backgroundColor'),workGlass:q('working','.ro-glass','backgroundColor'),
        done:(()=>{const e=[...document.querySelectorAll('#stage .ro-stext.st-done .ro-rows .ro-sl')].pop();return e?[e.dataset.k,getComputedStyle(e).color]:null;})(),
        ask:(()=>{const e=[...document.querySelectorAll('#stage .ro-stext.st-waiting .ro-rows .ro-sl')].pop();return e?[e.dataset.k,e.textContent]:null;})()};})()`);
    console.log('[097-screens] status', JSON.stringify(look));
    assert.ok(/rgb\(240, 160, 48\)/.test(look.waitFrame || ''), 'needs-you: an amber frame: ' + look.waitFrame);
    assert.ok(look.errGlass && look.errGlass !== look.workGlass, 'error: a red tint on the glass');
    assert.ok(look.done && look.done[0] === 'done' && /rgb\(159, 220, 174\)/.test(look.done[1]), 'done: the newest line green: ' + look.done);
    assert.ok(look.ask && look.ask[0] === 'ask' && look.ask[1].length > 3 && !/^Went to see/.test(look.ask[1]), 'needs-you: the question itself on the glass: ' + look.ask);

    // the text truly changes, and at the bottom
    const id = (await js(pickWorking))[0];
    assert.ok(id, 'a working agent');
    await js(`window.__before=window.__scr(${jsLiteral(id)}).textContent;0`);
    await emit({ type: 'toolCall', sessionId: id, callId: 'drv-1', tool: 'read_file', phase: 'start', args: { path: 'src/driver/first-line.ts' } });
    await must(`window.__scr(${jsLiteral(id)}).textContent.includes('first-line')`, 'the new line on the screen');
    await must(`window.__scr(${jsLiteral(id)}).getAnimations({subtree:true}).filter(a=>a.effect.target.classList.contains('ro-lines')).length===0`, 'the slide over');
    const pos = await js(`(()=>{const e=window.__scr(${jsLiteral(id)}),rows=[...e.querySelectorAll('.ro-rows .ro-sl')],l=rows[rows.length-1].getBoundingClientRect(),b=e.getBoundingClientRect();return {before:window.__before,after:e.textContent,gap:b.bottom-l.bottom,inside:l.left>=b.left-0.5&&l.right<=b.right+0.5,last:rows[rows.length-1].textContent};})()`);
    assert.notStrictEqual(pos.before, pos.after, 'the text changed');
    assert.ok(pos.last.includes('first-line'), 'the newest line is last: ' + pos.last);
    assert.ok(pos.gap >= 0 && pos.gap <= 8 && pos.inside, 'the newest line stands at the bottom of the glass: ' + JSON.stringify(pos));

    // FR-033: the pace, under a stream of a line every 250 ms for about 7 s: at least two repaints, none sooner than 2 s after the last
    await js(`(()=>{const e=window.__scr(${jsLiteral(id)});window.__paints=[];window.__seen=e.textContent;const o=new MutationObserver(()=>{if(e.textContent!==window.__seen){window.__seen=e.textContent;window.__paints.push(performance.now());}});o.observe(e,{childList:true,subtree:true,characterData:true});window.__po=o;
      let i=0;window.__st=setInterval(()=>{window.__durbarSimEmit({type:'toolCall',sessionId:${jsLiteral(id)},timestamp:Date.now(),callId:'drv-s'+i,tool:'read_file',phase:'start',args:{path:'src/stream/f'+(i++)+'.ts'}});},250);})();0`);
    await must(`window.__paints.length>=3`, 'three repaints of the stream', 20000);
    const paints = await js(`(()=>{clearInterval(window.__st);window.__po.disconnect();return window.__paints;})()`);
    const gaps = paints.slice(1).map((t, i) => t - paints[i]);
    console.log('[097-screens] repaint gaps ms', gaps.map(Math.round).join(','));
    assert.ok(gaps.every((g) => g >= 1950), 'FR-033: at most one repaint every 2 s: ' + gaps);
    const lastText = await js(`window.__scr(${jsLiteral(id)}).textContent`);
    await must(`/f\\d+\\.ts/.test(window.__scr(${jsLiteral(id)}).textContent)`, 'the stream on the screen');
    assert.ok(/f\d+\.ts/.test(lastText), 'the streamed lines are what it shows: ' + lastText);

    mark('hostile');
    // SC-005: hostile lines through the event path; read the screen and the zoom
    const victim = (await js(pickWorking))[1] || id;
    const hostile = 'See ' + TOKEN + ` and /Users/alice/.ssh/id and <img src=x onerror=window.__pwned=1> and [click](https://evil.example/x) \u001b[31mred\u001b[0m \u001b]0;title\u0007end. `;
    await emit({ type: 'output', sessionId: victim, delta: hostile });
    await must(`window.__scr(${jsLiteral(victim)}).textContent.includes('onerror')`, 'the hostile line on the screen');
    await emit({ type: 'output', sessionId: victim, delta: 'word '.repeat(220000) });
    await emit({ type: 'toolCall', sessionId: victim, callId: 'drv-h', tool: 'bash', phase: 'start', args: { command: 'curl -H "Authorization: Bearer ' + TOKEN + '" /home/alice/x' } });
    await must(`window.__scr(${jsLiteral(victim)}).textContent.includes('curl')`, 'the hostile command on the screen', 10000);
    const evil = await js(`(()=>{const e=window.__scr(${jsLiteral(victim)});return {text:e.textContent,tags:e.querySelectorAll('a,img,script').length,pwned:!!window.__pwned};})()`);
    for (const bad of ['ghp_', 'A1b2C3d4', 'alice', 'evil.example', '\u001b', 'Bearer ghp']) assert.ok(!evil.text.includes(bad), `the screen shows "${bad}": ${evil.text.slice(0, 200)}`);
    assert.strictEqual(evil.tags, 0, 'no element from the text');
    assert.ok(!evil.pwned, 'nothing ran');

    mark('zoom');
    // ---- FR-034: the zoom on every screen, by real pointer moves, with the plates read from the page ----
    ctx.win.show(); ctx.win.focus(); wc().focus();
    await must(`document.hasFocus()`, 'the window active', 8000);
    const deskIds = await js(`window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks).filter(d=>d.state!=='asleep').map(d=>d.id)`);
    const moveTo = async (x, y) => { wc().sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) }); await must(`true`, 'a tick'); };
    const OPENED = (i) => `(document.getElementById('roZoom')||{dataset:{}}).dataset.for===${jsLiteral(i)}`;
    await moveTo(1, 1);
    let placed = {};
    for (const i of deskIds) {
      const p = await js(`(()=>{const b=document.querySelector('#stage .ro-screen[data-for="'+CSS.escape(${jsLiteral(i)})+'"]').getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/3};})()`);
      await moveTo(p.x, p.y);
      await must(OPENED(i), 'the zoom of ' + i);
      const z = await js(`(()=>{const P=document.getElementById('roZoom'),b=P.getBoundingClientRect(),fl=document.getElementById('floor').getBoundingClientRect();
        const hit=(e)=>{const a=e.getBoundingClientRect();return a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom;};
        const own=document.querySelector('.ro-plate[data-id="'+CSS.escape(${jsLiteral(i)})+'"]');
        const rows=[...P.querySelectorAll('.ro-sl')];
        return {w:b.width,h:b.height,side:P.dataset.side,inWin:b.left>=0&&b.top>=0&&b.right<=innerWidth&&b.bottom<=innerHeight,inFloor:b.left>=fl.left-0.5&&b.right<=fl.right+0.5&&b.top>=fl.top-0.5&&b.bottom<=fl.bottom+0.5,
          own:hit(own),needs:[...document.querySelectorAll('.ro-plate:is(.st-waiting,.st-limit),.ro-lplate.wait,.ro-chip.wait')].filter(hit).map(e=>e.textContent.slice(0,20)),
          font:rows.length?parseFloat(getComputedStyle(rows[0]).fontSize):0,fonts:[...P.querySelectorAll('.ro-zh *')].map(e=>parseFloat(getComputedStyle(e).fontSize)),role:P.getAttribute('role'),name:P.getAttribute('aria-label'),live:P.getAttribute('aria-live'),
          blur:getComputedStyle(P).backdropFilter,desc:own.getAttribute('aria-describedby'),head:P.querySelector('.ro-zh').textContent,rows:rows.length,text:P.textContent,
          lastVisible:rows.length?(()=>{const l=rows[rows.length-1].getBoundingClientRect();return l.bottom<=b.bottom&&l.top>=b.top;})():false,
          tags:P.querySelectorAll('a,img,script').length,under:document.elementFromPoint(${p.x},${p.y})&&document.elementFromPoint(${p.x},${p.y}).closest('.ro-zoom')?1:0};})()`);
      assert.ok(z.w >= 380 && z.w <= 480, i + ': 380-480 px wide: ' + z.w);
      assert.ok(z.inWin && z.inFloor, i + ': stays on screen: ' + JSON.stringify(z));
      assert.ok(!z.own, i + ': does not cover its own plate');
      assert.deepStrictEqual(z.needs, [], i + ': covers no needs-you plate');
      assert.strictEqual(z.font, 12.5, 'the last lines at 12.5 px');
      assert.ok(z.fonts.every((f) => f >= 10.5), 'the head at least 10.5 px');
      assert.strictEqual(z.role, 'region'); assert.ok(/^Screen of /.test(z.name), 'named: ' + z.name); assert.strictEqual(z.live, null, 'not a live region');
      assert.strictEqual(z.desc, 'roZoom', 'its plate is described by it');
      assert.strictEqual(z.blur, 'none', 'FR-182: no blur');
      assert.ok(z.rows >= 1 && z.lastVisible, 'the newest line in view');
      assert.strictEqual(z.tags, 0, 'text only');
      assert.strictEqual(z.under, 0, 'it does not cover the pointer\'s screen');
      for (const bad of ['ghp_', 'A1b2C3d4', 'alice', 'evil.example']) assert.ok(!z.text.includes(bad), `the zoom shows "${bad}"`);
      placed[z.side] = (placed[z.side] || 0) + 1;
    }
    console.log('[097-screens] zoom sides', w, h, JSON.stringify(placed));
    // the picture: the zoom of a desk in the middle
    const mid = deskIds[Math.floor(deskIds.length / 2)];
    const mp = await js(`(()=>{const b=document.querySelector('#stage .ro-screen[data-for="'+CSS.escape(${jsLiteral(mid)})+'"]').getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/3};})()`);
    await moveTo(1, 1);
    await must(`!document.getElementById('roZoom')`, 'the zoom closed when the pointer left');
    await moveTo(mp.x, mp.y);
    await must(OPENED(mid), 'the zoom of the middle desk');
    await H.shot(path.join(OUT, `097-zoom-${w}x${h}.png`), { prep: 'calm', keepHover: true });
    assert.ok(await js(OPENED(mid)), 'the picture has the zoom');
    // Esc: closes; a move inside the same screen does not bring it back; leaving and coming back does
    wc().sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); wc().sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await must(`!document.getElementById('roZoom')`, 'Esc closes the zoom');
    assert.strictEqual(await js(`document.body.classList.contains('panel-open')`), false, 'Esc did nothing else');
    await moveTo(mp.x + 3, mp.y + 2);
    await js(`new Promise(r=>setTimeout(r,300))`); // longer than the open delay: it must not open (a bound on a negative, not a wait for a state)
    assert.strictEqual(await js(`!!document.getElementById('roZoom')`), false, 'closed until the pointer has left');
    await moveTo(1, 1);
    await must(`true`, 'a tick');
    await js(`document.activeElement&&document.activeElement.blur&&document.activeElement.blur();0`);
    // keyboard parity: real Tab presses reach a plate; the same zoom opens; Esc closes it and keeps the focus; the next Tab moves on and opens the next
    await js(`(()=>{const s=document.querySelector('.ro-sign .ro-sb');s&&s.focus();})()`);
    let got = false;
    for (let t = 0; t < 12 && !got; t++) {
      wc().sendInputEvent({ type: 'keyDown', keyCode: 'Tab' }); wc().sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
      got = await H.until(`!!document.getElementById('roZoom')&&document.activeElement&&document.activeElement.classList.contains('ro-plate')`, 500);
    }
    assert.ok(got, 'Tab to a desk opens the zoom');
    const kb = await js(`(()=>{const a=document.activeElement,P=document.getElementById('roZoom');return {plate:a.dataset.id,zoom:P.dataset.for,desc:a.getAttribute('aria-describedby'),visible:a.matches(':focus-visible')};})()`);
    assert.strictEqual(kb.zoom, kb.plate, 'the zoom of the focused desk');
    assert.strictEqual(kb.desc, 'roZoom');
    wc().sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); wc().sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await must(`!document.getElementById('roZoom')`, 'Esc closes the keyboard zoom');
    assert.strictEqual(await js(`document.activeElement.dataset.id`), kb.plate, 'the focus stays on the plate');
    assert.strictEqual(await js(`document.activeElement.hasAttribute('aria-describedby')`), false, 'no description left');
    await js(`document.activeElement.blur();0`);
  }

  /* review of P2: Live activity off (the setting itself, stored before load): a working screen shows its word and bars, not the task or the last reply; a question is cut at 200 */
  mark('live off');
  await js(`localStorage.setItem('durbar.liveActivity','off');0`);
  await loadReal(1440, 900);
  await js(INSTALL);
  const quiet = await js(`(()=>{const L=window.__durbarSimUi.realLayout(),out=[];for(const d of L.zones.flatMap(z=>z.desks)){if(d.state!=='working'&&d.state!=='thinking')continue;const e=window.__scr(d.id),a=window.__durbarSimUi.agents().find(x=>x.id===d.id);out.push({id:d.id,text:e.textContent,rows:e.querySelectorAll('.ro-sl').length,bars:e.querySelectorAll('.ro-bars i').length,word:document.querySelector('.ro-plate[data-id="'+CSS.escape(d.id)+'"]').querySelector('.ro-l2').textContent,reply:String(a.lastOutput||'').slice(0,20)});}return out;})()`);
  console.log('[097-screens] live off', JSON.stringify(quiet.slice(0, 3)));
  assert.ok(quiet.length > 0, 'working desks with Live activity off');
  for (const q of quiet) {
    assert.strictEqual(q.rows, 1, q.id + ': one line: ' + q.text);
    assert.ok(q.word.includes(q.text), q.id + ': only its status word: "' + q.text + '" against "' + q.word + '"');
    assert.ok(q.bars >= 1, q.id + ': bars keep it looking at work');
    assert.ok(!q.reply || !q.text.includes(q.reply), q.id + ': not the last reply');
  }
  await js(`localStorage.removeItem('durbar.liveActivity');0`);

  mark('big');
  /* ---- T032, FR-020, SC-003: 3 agents, real lines, big ---- */
  for (const [w, h] of SIZES) {
    await loadReal(w, h, { sim: '3' });
    await js(INSTALL);
    const ids = await js(`window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks).map(d=>d.id)`);
    for (const id of ids) for (let i = 0; i < 14; i++) await emit({ type: 'toolCall', sessionId: id, callId: 'big' + i, tool: 'read_file', phase: 'start', args: { path: `src/big/line-${i}.ts` } });
    await must(`${jsLiteral(ids)}.every(id=>window.__scr(id).textContent.includes('line-13'))`, 'the lines on the big screens');
    const big = await js(`${jsLiteral(ids)}.map(id=>{const e=window.__scr(id),b=e.getBoundingClientRect(),rows=[...e.querySelectorAll('.ro-sl')];
      /* lines really inside the glass: drawn line boxes, not rows that the clip hides */
      let n=0;for(const r of rows){const g=document.createRange();g.selectNodeContents(r);for(const c of g.getClientRects())if(c.top>=b.top-0.5&&c.bottom<=b.bottom+0.5)n++;}
      return {id,h:Math.round(b.height),lines:n,font:rows.length?parseFloat(getComputedStyle(rows[0]).fontSize):0,small:e.classList.contains('small')};})`);
    console.log('[097-screens] big', w, h, JSON.stringify(big));
    assert.strictEqual(await js(`document.querySelector('#stage .ro').dataset.big`), '1', 'big screens with 3 agents');
    for (const s of big) { assert.ok(!s.small, 'not small'); assert.ok(s.lines >= 8, `SC-003: at least 8 lines: ${JSON.stringify(s)}`); assert.ok(s.font >= 11, 'at 11 px or more'); assert.strictEqual(s.font, s.h - 6 > 200 ? 13 : 11, 'FR-020: 13 px over 200 px tall: ' + JSON.stringify(s)); }
    await H.shot(path.join(OUT, `097-real-big-${w}x${h}.png`), { prep: 'calm' });
  }

  console.log('[097-screens] OK');
};
