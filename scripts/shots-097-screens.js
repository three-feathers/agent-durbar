/*
 * Real office mode, phase P2 (spec 097 T030..T032): live screens and the hover zoom, in the simulator; the motion is check-097-motion.js. No real agent
 * session, no account, no AI credits (constitution IV). In ui-suite.js; `node scripts/ui-suite.js --only shots-097-screens`.
 *
 * At 1440x900 and 1280x800 with 15 agents it fails (exit 1) when:
 *   - a screen is a placeholder: an awake desk's screen has no real text, its text is under 10.5 px, or text does not change when the agent writes (FR-030, FR-032);
 *   - the newest line is not at the bottom of the glass, or a repaint comes sooner than 2 s after the last under a stream of lines (FR-033);
 *   - a hostile line (token, home path, markup, a link, ANSI, 1 MB) shows on a screen or in the zoom other than masked, inert and capped (FR-031, SC-005);
 *   - a status screen is wrong: an amber screen with no ring when it needs you, a red screen on an error (FR-236), dark glass with no text when asleep, a green done line (FR-035);
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
/* what no screen, zoom or fact may show: the token whole or in its parts around an escape, a home folder, a link, a terminal or text-direction control */
const BAD = ['ghp_', 'A1b2C3d4', 'E5f6G7h8', 'f6G7h8', 'alice', 'evil.example', '\u001b', '\u202e', 'Bearer ghp'];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const T0 = Date.now(), mark = (m) => console.log(`[097-screens] ${Math.round((Date.now() - T0) / 1000)} s: ${m}`);
  const wc = () => ctx.win.webContents;
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  /* FR-034 by real pointer moves. The zoom closes when the window loses the focus, and it does not open while the office is hidden; on CI drivers run side by side, so another window can take the focus or cover this one. That, and a move the page never got, are tried again: neither is the hover. A move it got that opens nothing is a failure, with what was under the pointer and the last move. A reload loses the listeners, so each use arms them */
  const arm = () => js(`(()=>{if(window.__blurs!==undefined)return;window.__blurs=0;window.__mv='';addEventListener('blur',()=>{window.__blurs++;});document.addEventListener('visibilitychange',()=>{if(document.hidden)window.__blurs++;});addEventListener('mousemove',(e)=>{window.__mv=e.clientX+','+e.clientY;},true);})();0`);
  const moveTo = async (x, y) => { await arm(); const X = Math.round(x), Y = Math.round(y); wc().sendInputEvent({ type: 'mouseMove', x: X, y: Y }); return H.until(`window.__mv===${jsLiteral(X + ',' + Y)}`, 3000); };
  const OPENED = (i) => `(document.getElementById('roZoom')||{dataset:{}}).dataset.for===${jsLiteral(i)}`;
  const blurs = () => js(`window.__blurs`);
  const refocus = async () => { ctx.win.show(); ctx.win.focus(); wc().focus(); await must(`document.hasFocus()&&!document.hidden`, 'the window active again', 8000); };
  const hover = async (i, p) => {
    await arm();
    for (let t = 0; t < 5; t++) {
      const was = await blurs();
      await moveTo(p.x - 2, p.y); /* issue 1040: after the room returns, the first event only marks where the pointer is; the next move is the hover */
      if (!(await moveTo(p.x, p.y))) { console.log('[097-screens] the page did not get the pointer move for', i, JSON.stringify(await js(`({got:window.__mv,focus:document.hasFocus(),hidden:document.hidden})`))); await refocus(); await moveTo(1, 1); continue; }
      await H.until('(' + OPENED(i) + ')||window.__blurs!==' + jsLiteral(was), 15000);
      if (await js(OPENED(i))) return;
      if ((await blurs()) === was) break;
      console.log('[097-screens] the window lost the focus or was covered during the hover of', i);
      await refocus(); await moveTo(1, 1);
      await must(`!document.getElementById('roZoom')`, 'closed before trying again');
    }
      assert.fail('the zoom of ' + i + ': ' + JSON.stringify(await js(`(()=>{const e=document.elementFromPoint(${jsLiteral(p.x)},${jsLiteral(p.y)}),a=document.activeElement;return {at:e&&(e.className||e.tagName),for:e&&e.dataset&&e.dataset.for,focus:document.hasFocus(),blurs:window.__blurs,hidden:document.hidden,zoom:(document.getElementById('roZoom')||{dataset:{}}).dataset.for,active:a&&a.className,moved:window.__mv,state:(window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks).find(d=>d.id===${jsLiteral(i)})||{}).state};})()`)));
  };
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
  const PICS = `[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`;
  /* a frozen simulator (nothing changes but what the driver emits); romotion=1: the people move, as outside a driver */
  const loadReal = async (w, h, query = {}) => {
    await H.load({ w, h, query: { officeview: 'real', romotion: '1', ...query }, ready: REAL, settle: false });
    await must(PICS, 'the pictures');
    /* spec 097 FR-246: a done agent whose reply is read sits in the lounge row (a monitor without text); these checks read done screens at desks, so their replies stay unread */
    await js(`(()=>{const U=window.__durbarSimUi;U.agents().filter(a=>!a.parent&&a.state==='done').forEach(a=>{a.lastOutput=a.lastOutput||'Done.';U.unread.mark(a.id);});U.crew.renderAll();return 1})()`);
    await must(`!(window.__durbarSimUi.realLayout().lounge)`, 'every done agent at its desk');
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
    const seats = await js(`(window.__durbarSimUi.realLayout().lounge||{desks:[]}).desks.length`); /* spec 097 FR-246: a finished, read agent sits in the lounge row, its monitor without text */
    assert.strictEqual(all.length + seats, 15, '15 desks and lounge seats');
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
      return {waitFrame:q('waiting','.ro-bezel','boxShadow'),waitGlass:q('waiting','.ro-glass','backgroundColor'),errGlass:q('error','.ro-glass','backgroundColor'),workGlass:q('working','.ro-glass','backgroundColor'),
        done:(()=>{const e=[...document.querySelectorAll('#stage .ro-stext.st-done .ro-rows .ro-sl')].pop();return e?[e.dataset.k,getComputedStyle(e).color]:null;})(),
        ask:(()=>{const e=[...document.querySelectorAll('#stage .ro-stext.st-waiting .ro-rows .ro-sl')].pop();return e?[e.dataset.k,e.textContent]:null;})()};})()`);
    console.log('[097-screens] status', JSON.stringify(look));
    /* spec 097 FR-236 (owner, 2026-11-05): the screen itself is the cue: an amber glass, no amber ring around the bezel; a red glass on an error */
    assert.ok(!/rgb\(240, 160, 48\)/.test(look.waitFrame || ''), 'needs-you: no amber ring around the monitor (FR-236): ' + look.waitFrame);
    assert.strictEqual(look.waitGlass, 'rgb(85, 58, 0)', 'needs-you: an amber screen (FR-236)');
    assert.strictEqual(look.errGlass, 'rgb(101, 20, 20)', 'error: a red screen (FR-236)');
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
    /* FR-317 (issue #1284): a token-shaped TOOL NAME (an MCP server chooses it), plain and split by an escape and U+202E, shows as `Using tool` on the screen and no
       surface of the page (text, title, aria-label, any attribute) holds the token or a part of it */
    const NAME = 'ghp_' + 'Zq9Xw8Vu7Ts6Rp5On4Ml3Kj2Ih1G';
    for (const [n, tn] of [['plain', NAME], ['split', NAME.slice(0, 9) + '\u001b[0m' + NAME.slice(9, 15) + '\u202e' + NAME.slice(15)]]) {
      await emit({ type: 'toolCall', sessionId: victim, callId: 'drv-n-' + n, tool: tn, phase: 'start', args: {} });
      await must(`window.__scr(${jsLiteral(victim)}).textContent.includes('Using tool')`, 'the masked tool name (' + n + ') as a generic word on the screen', 10000);
      const all = await js(`document.documentElement.outerHTML+' '+document.body.innerText`);
      for (const bad of ['ghp_Z', 'Zq9Xw8', 'Ts6Rp5', 'Kj2Ih1']) assert.ok(!all.includes(bad), `${n} tool name: the page shows "${bad}"`);
    }
    /* review of PR 1272, FR-314: a token split by an escape and by U+202E, in a tool label, must be masked on the screen, in the zoom and on the flat desk alike (the tool fact is
       built from the cleared input); markup in it stays text; then the agent thinks, so the zoom names it "Last tool" */
    await emit({ type: 'toolCall', sessionId: victim, callId: 'drv-h2', tool: 'read_file', phase: 'start', args: { path: '/tmp/' + TOKEN.slice(0, 14) + '\u001b[0m' + TOKEN.slice(14, 20) + '\u202e' + TOKEN.slice(20) + ' <img src=x onerror=window.__pwned=1> /Users/alice/x' } });
    await must(`window.__scr(${jsLiteral(victim)}).textContent.includes('/tmp/')`, 'the split-token tool line on the screen', 10000);
    const evil = await js(`(()=>{const e=window.__scr(${jsLiteral(victim)});return {text:e.textContent,tags:e.querySelectorAll('a,img,script').length,pwned:!!window.__pwned};})()`);
    for (const bad of BAD) assert.ok(!evil.text.includes(bad), `the screen shows "${bad}": ${evil.text.slice(0, 200)}`);
    await emit({ type: 'thinking', sessionId: victim, reasoningId: 'drv-r', delta: 'Checking the result. Then the next step. ' });
    assert.strictEqual(evil.tags, 0, 'no element from the text');
    assert.ok(!evil.pwned, 'nothing ran');

    mark('zoom');
    // ---- FR-034: the zoom on every screen, by real pointer moves, with the plates read from the page ----
    ctx.win.show(); ctx.win.focus(); wc().focus();
    await must(`document.hasFocus()`, 'the window active', 8000);
    const deskIds = await js(`window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks).filter(d=>d.state!=='asleep').map(d=>d.id)`);
    await moveTo(1, 1);
    let placed = {};
    const seen = { victim: false, lastTool: 0 };
    for (const i of deskIds) {
      const p = await js(`(()=>{const b=document.querySelector('#stage .ro-screen[data-for="'+CSS.escape(${jsLiteral(i)})+'"]').getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/3};})()`);
      await hover(i, p);
      const z = await js(`(()=>{const P=document.getElementById('roZoom'),b=P.getBoundingClientRect(),fl=document.getElementById('floor').getBoundingClientRect();
        const hit=(e)=>{const a=e.getBoundingClientRect();return a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom;};
        const own=document.querySelector('.ro-plate[data-id="'+CSS.escape(${jsLiteral(i)})+'"]');
        const rows=[...P.querySelectorAll('.ro-sl')];
        return {w:b.width,h:b.height,side:P.dataset.side,inWin:b.left>=0&&b.top>=0&&b.right<=innerWidth&&b.bottom<=innerHeight,inFloor:b.left>=fl.left-0.5&&b.right<=fl.right+0.5&&b.top>=fl.top-0.5&&b.bottom<=fl.bottom+0.5,
          own:hit(own),needs:[...document.querySelectorAll('.ro-plate:is(.st-waiting,.st-limit),.ro-lplate.wait,.ro-chip.wait')].filter(hit).map(e=>e.textContent.slice(0,20)),
          font:rows.length?parseFloat(getComputedStyle(rows[0]).fontSize):0,fonts:[...P.querySelectorAll('.ro-zh *')].map(e=>parseFloat(getComputedStyle(e).fontSize)),role:P.getAttribute('role'),name:P.getAttribute('aria-label'),live:P.getAttribute('aria-live'),
          blur:getComputedStyle(P).backdropFilter,desc:own.getAttribute('aria-describedby'),head:P.querySelector('.ro-zh').textContent,rows:rows.length,text:P.textContent,facts:[...P.querySelectorAll('.ro-zk .ro-zi')].map(e=>e.textContent),kfonts:[...P.querySelectorAll('.ro-zk *')].map(e=>parseFloat(getComputedStyle(e).fontSize)),kclip:[...P.querySelectorAll('.ro-zk .ro-zi')].filter(e=>!/^(Now|Last tool) /.test(e.textContent)).some(e=>e.scrollWidth>e.clientWidth+1),zkh:(()=>{const k=P.querySelector('.ro-zk');return k&&!k.hidden?k.getBoundingClientRect().height:0;})(),ph:b.height,zbh:P.querySelector('.ro-zb').getBoundingClientRect().height,narrow:[...P.querySelectorAll('.ro-zk .ro-zi')].filter(e=>/^(Model|Now|Last tool|Usage) /.test(e.textContent)).filter(e=>e.getBoundingClientRect().width<P.querySelector('.ro-zk').clientWidth*0.9).map(e=>e.textContent.slice(0,12)),marks:P.querySelectorAll('.ro-zk *:not(.ro-zi):not(.ro-zy):not(.ro-zv)').length,kin:(()=>{const k=P.querySelector('.ro-zk');if(!k||k.hidden)return true;const q=k.getBoundingClientRect();return q.bottom<=b.bottom&&q.top>=b.top&&q.right<=b.right+0.5;})(),
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
      /* spec 097 FR-312..FR-314: the facts in the flat office's words, readable, inside the panel, nothing but text */
      assert.ok(z.facts.some((f) => /^Model /.test(f)), i + ': the zoom names the model: ' + JSON.stringify(z.facts));
      assert.ok(z.facts.every((f) => /^(Model|Now|Last tool|Usage|Cost|Context|On this task|Last activity) /.test(f)), i + ': only the flat office\'s labels: ' + JSON.stringify(z.facts));
      assert.ok(z.kfonts.length && z.kfonts.every((f) => f >= 10.5), i + ': the facts at least 10.5 px');
      assert.ok(z.kin && !z.kclip, i + ': the facts inside the panel, no clipped item: ' + JSON.stringify(z.facts));
      assert.strictEqual(z.tags, 0, 'text only');
      assert.strictEqual(z.under, 0, 'it does not cover the pointer\'s screen');
      for (const bad of BAD) assert.ok(!z.text.includes(bad), `the zoom shows "${bad}": ${JSON.stringify(z.facts)} ${z.head}`);
      /* review of PR 1272 (7): the facts are text (innerHTML would make elements), Model, Now, Last tool and Usage take a whole line (FR-313), and the panel is as tall as its head,
         its facts and the least number of lines (FR-315: height includes the facts) */
      assert.strictEqual(z.marks, 0, i + ': a fact is text, no element inside the value: ' + JSON.stringify(z.facts));
      assert.deepStrictEqual(z.narrow, [], i + ': Model, Now, Last tool and Usage have a whole line: ' + JSON.stringify(z.facts));
      assert.ok(z.zbh >= 4 * 17 - 0.5, i + ': the lines area keeps the 4 lines least, under the facts: ' + z.zbh + ' of ' + z.ph + ' (facts ' + z.zkh + ')');
      if (i === victim) {
        const lt = z.facts.find((f) => /^Last tool /.test(f));
        assert.ok(lt, 'the thinking victim names its Last tool: ' + JSON.stringify(z.facts));
        assert.ok(lt.startsWith('Last tool Reading /tmp/[redacted] '), 'the split token is masked in the zoom as on the screen: ' + lt);
        assert.ok(lt.includes('<img src=x onerror=window.__pwned=1>') && lt.includes('~/x'), 'markup stays text, the home folder is ~: ' + lt);
        seen.victim = true;
      }
      if (z.facts.some((f) => /^Last tool /.test(f))) seen.lastTool++;
      placed[z.side] = (placed[z.side] || 0) + 1;
    }
    assert.strictEqual(await js(`!!window.__pwned`), false, 'nothing ran from a fact');
    assert.ok(seen.victim && seen.lastTool >= 1, 'the zoom of the hostile desk was read: ' + JSON.stringify(seen));
    console.log('[097-screens] zoom sides', w, h, JSON.stringify(placed));
    // the picture: the zoom of a desk in the middle
    const mid = deskIds[Math.floor(deskIds.length / 2)];
    const mp = await js(`(()=>{const b=document.querySelector('#stage .ro-screen[data-for="'+CSS.escape(${jsLiteral(mid)})+'"]').getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/3};})()`);
    await moveTo(1, 1);
    await must(`!document.getElementById('roZoom')`, 'the zoom closed when the pointer left');
    await hover(mid, mp);
    const CHIPS = `(()=>{const R=e=>e.getBoundingClientRect(),hit=(a,b)=>a.left<b.right-0.3&&b.left<a.right-0.3&&a.top<b.bottom-0.3&&b.top<a.bottom-0.3,C=[...document.querySelectorAll('#stage .ro-chip')],P=[...document.querySelectorAll('#stage .ro-lplate')],out=[];for(const c of C){for(const p of P)if(hit(R(c),R(p)))out.push(c.textContent+' on '+p.textContent);for(const d of C)if(c!==d&&R(c).left<=R(d).left&&hit(R(c),R(d)))out.push(c.textContent+' on '+d.textContent);}return out;})()`;
    await H.until(`${CHIPS}.length===0`, 5000);
    assert.deepStrictEqual(await js(CHIPS), [], 'no chip on a plate or a chip in the zoom picture ' + w);
    for (let t = 0; t < 5; t++) {
      const was = await blurs();
      await H.shot(path.join(OUT, `097-zoom-${w}x${h}.png`), { prep: 'calm', keepHover: true });
      if (await js(OPENED(mid))) break;
      assert.notStrictEqual(await blurs(), was, 'the picture has the zoom, and the window kept the focus: ' + JSON.stringify(await js(`({focus:document.hasFocus(),blurs:window.__blurs})`)));
      console.log('[097-screens] the window lost the focus during the picture');
      await refocus(); await moveTo(1, 1); await hover(mid, mp);
    }
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
    await refocus();
    /* issue 1040: Esc back to the office (the panel closes) with the pointer resting on a screen opens no zoom; the browser's pointerover there carries no move (here sent by hand, as macOS does). The first real move opens it as before */
    await js(`document.body.classList.add('panel-open');0`);
    await must(`document.querySelector('#stage .ro').classList.contains('paused')`, 'the office paused under the panel');
    await js(`document.body.classList.remove('panel-open');0`);
    await must(`!document.querySelector('#stage .ro').classList.contains('paused')`, 'the office back');
    await js(`(()=>{const s=document.querySelector('#stage .ro-screen[data-for="'+CSS.escape(${jsLiteral(mid)})+'"]');s.dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:'mouse',clientX:${jsLiteral(mp.x)},clientY:${jsLiteral(mp.y)}}));})();0`);
    await must(`(()=>{const h=window.DurbarRealOffice.hoverState();return h.still&&!h.armed;})()`, 'back under a still pointer: nothing can open (still, no hover timer armed)');
    assert.strictEqual(await js(`!!document.getElementById('roZoom')`), false, 'back under a still pointer: no zoom opens');
    await hover(mid, { x: mp.x + 4, y: mp.y + 2 });
    await moveTo(1, 1);
    await must(`!document.getElementById('roZoom')`, 'the zoom closed when the pointer left');
    /* FR-230: a sign redrawing under the keyboard keeps the focus on the same button. The changed counts prove the redraw happened; since spec 097 T149 the sign keeps its nodes (signFill) when only its counts change, so the button itself stays. Whether the button is the same node is not asserted in this first part (the simulator's cost line can appear during a run, which builds the sign again); the rebuild path, with new buttons, is the second part below */
    {
      const zone = (await js(`window.__durbarSimUi.realLayout().zones.filter(z=>z.desks.some(d=>d.state==='working')).map(z=>({id:z.id,desk:z.desks.find(d=>d.state==='working').id}))[0]`));
      const SIGN = `.ro-sign[data-folder=${JSON.stringify(zone.id)}]`;
      const counts = () => js(`document.querySelector(${jsLiteral(SIGN + ' .ro-sc')}).textContent`);
      const c0 = await counts();
      for (const [i, attr] of ['newsess', 'foldermenu'].entries()) {
        await js(`(()=>{const b=document.querySelector(${jsLiteral(SIGN + ' [data-' + attr + ']')});b.__marked=1;b.focus();})();0`);
        const was = await counts();
        await emit({ type: 'status', sessionId: zone.desk, status: i ? 'working' : 'idle', intent: 'Driver work' });
        await must(`document.querySelector(${jsLiteral(SIGN + ' .ro-sc')}).textContent!==${jsLiteral(was)}`, 'the sign redrawn');
        assert.notStrictEqual(await counts(), was, 'the sign\'s counts changed after the redraw: a redraw that did not happen fails here');
        await must(`(()=>{const a=document.activeElement;return a.dataset[${jsLiteral(attr)}]===${jsLiteral(zone.id)};})()`, 'the focus on the redrawn sign\'s ' + attr + ' button');
      }
      assert.strictEqual(await counts(), c0, 'the desk back as it was');
      /* FR-230, the rebuild path (review on #969): a sign whose cost line comes or goes is built again (signFill's signature), so its + and menu button are new
         elements; the render's focus keep (app.js) gives the focus to the new one. The cost line is hidden and shown by the simulator's quietHeads(['aiu']), the
         app's own head-line switch, so the rebuild is the real one; the old button gone from the page proves it happened */
      const COST = `!!document.querySelector(${jsLiteral(SIGN + ' .ro-cost')})`;
      assert.ok(await js(COST), 'the sign has a cost line to take away');
      for (const [i, attr] of ['newsess', 'foldermenu'].entries()) {
        const had = await js(COST);
        await js(`(()=>{const b=document.querySelector(${jsLiteral(SIGN + ' [data-' + attr + ']')});b.__marked=1;window.__oldBtn=b;b.focus();})();0`);
        assert.ok(await js(`document.activeElement===window.__oldBtn`), 'the ' + attr + ' button has the focus before the rebuild');
        await js(`window.__durbarSimUi.quietHeads(${jsLiteral(had ? ['aiu'] : [])});0`);
        await emit({ type: 'status', sessionId: zone.desk, status: i ? 'working' : 'idle', intent: 'Driver work' });
        await must((had ? '!' : '') + COST + '&&!window.__oldBtn.isConnected', 'the sign built again, its cost line ' + (had ? 'gone' : 'back') + ' and the old ' + attr + ' button out of the page');
        await must(`(()=>{const a=document.activeElement;return !!a&&a.dataset[${jsLiteral(attr)}]===${jsLiteral(zone.id)}&&!a.__marked&&!!a.closest(${jsLiteral(SIGN)});})()`, 'the focus on the rebuilt sign\'s new ' + attr + ' button');
      }
      await js(`window.__durbarSimUi.quietHeads([]);window.__oldBtn=null;0`);
    }
    /* FR-016, FR-184 (review on #969), spec 097 FR-306 (#1139): a plate keeps its nodes on a status change, and a new helper is one more tile in the desk's helper strip (the plate's "+N" is gone while the
       strip is drawn); the helper failing changes its tile's class. Through the event path, as an agent app reports a helper (a `subagent` event) */
    {
      /* a working desk with no helpers yet, so the new one's tile is the strip's first */
      const desk = (await js(`window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks).filter(d=>d.state==='working').map(d=>d.id).find(id=>{const p=document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(id)+'"]');if(!p)return false;let e=p.nextElementSibling;if(e&&e.matches('.ren'))e=e.nextElementSibling;return !(e&&e.matches('.ro-hstrip'))&&!p.querySelector('.ro-help');})`));
      assert.ok(desk, 'a working desk with no helpers');
      await js(`window.__pl=()=>document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(${jsLiteral(desk)})+'"]');window.__st=()=>{const p=window.__pl();let e=p&&p.nextElementSibling;if(e&&e.matches('.ren'))e=e.nextElementSibling;return e&&e.matches('.ro-hstrip')?e:null};0`);
      const help = () => js(`(()=>{const s=window.__st();return s?{n:s.querySelectorAll('.ro-hd').length,cls:[...s.querySelectorAll('.ro-hd')].map(t=>t.className).join('|')}:{n:0,cls:''};})()`);
      const h0 = await help();
      await js(`window.__nm=window.__pl().querySelector('b');0`);
      const sub = 'drv-helper-1', base = { sessionId: desk };
      await emit({ ...base, type: 'subagent', subagentId: sub, name: 'Driver helper', phase: 'started', task: 'Check the driver', agentName: 'explore' });
      await emit({ ...base, type: 'status', status: 'working', agentId: sub, intent: 'Check the driver' });
      await must(`(window.__st()||{querySelectorAll:()=>[]}).querySelectorAll('.ro-hd').length===${jsLiteral(h0.n + 1)}`, 'the desk\'s helper strip one tile up (was ' + JSON.stringify(h0) + ')');
      const h1 = await help();
      assert.strictEqual(h1.n, h0.n + 1, 'a new helper adds one tile: ' + JSON.stringify([h0, h1]));
      assert.ok(await js(`!window.__pl().querySelector('.ro-help')`), 'the plate shows no "+N" while its helpers are drawn');
      await emit({ ...base, type: 'subagent', subagentId: sub, name: 'Driver helper', phase: 'failed', task: 'Failed', error: 'Failed', agentName: 'explore' });
      await must(`(()=>{const s=window.__st();return !!s&&[...s.querySelectorAll('.ro-hd')].map(t=>t.className).join('|')!==${jsLiteral(h1.cls)};})()`, 'the helper tile changed when the helper failed (was ' + h1.cls + ')');
      assert.ok(await js(`window.__pl().querySelector('b')===window.__nm`), 'FR-184: the plate kept its name node while its helper list changed');
    }
    // keyboard parity: real Tab presses reach a plate; the same zoom opens; Esc closes it and keeps the focus; the next Tab moves on and opens the next
    const toSign = () => js(`(()=>{const s=document.querySelector('.ro-sign .ro-sb');s&&s.focus();})()`);
    await toSign();
    let got = false, lost = 0;
    for (let t = 0; t < 12 && !got; t++) {
      /* this can be a machine in use: without the window's focus a plate reached by Tab is not focus-visible and opens nothing, so those Tabs prove nothing */
      if (!(await js(`document.hasFocus()`)) && lost++ < 5) { console.log('[097-screens] the window lost the focus before a Tab'); await refocus(); await toSign(); t = 0; }
      wc().sendInputEvent({ type: 'keyDown', keyCode: 'Tab' }); wc().sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
      got = await H.until(`!!document.getElementById('roZoom')&&document.activeElement&&document.activeElement.classList.contains('ro-plate')`, 500);
    }
    if (!got) assert.fail('Tab to a desk opens the zoom: ' + JSON.stringify(await js(`(()=>{const a=document.activeElement;return {focus:document.hasFocus(),hidden:document.hidden,active:a&&a.tagName+'.'+a.className,id:a&&a.dataset&&a.dataset.id,fv:a&&a.matches&&a.matches(':focus-visible'),zoom:(document.getElementById('roZoom')||{dataset:{}}).dataset.for,panel:document.body.classList.contains('panel-open')};})()`)));
    const kb = await js(`(()=>{const a=document.activeElement,P=document.getElementById('roZoom');return {plate:a.dataset.id,zoom:P.dataset.for,desc:a.getAttribute('aria-describedby'),visible:a.matches(':focus-visible')};})()`);
    assert.strictEqual(kb.zoom, kb.plate, 'the zoom of the focused desk');
    assert.strictEqual(kb.desc, 'roZoom');
    wc().sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); wc().sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await must(`!document.getElementById('roZoom')`, 'Esc closes the keyboard zoom');
    assert.strictEqual(await js(`document.activeElement.dataset.id`), kb.plate, 'the focus stays on the plate');
    assert.strictEqual(await js(`document.activeElement.hasAttribute('aria-describedby')`), false, 'no description left');
    await js(`document.activeElement.blur();0`);
  }

  /* review of the rework: what is shown follows the setting and the desk at once, not at the next line */
  mark('live switched');
  await loadReal(1440, 900);
  await js(INSTALL);
  {
    ctx.win.show(); ctx.win.focus(); wc().focus();
    await must(`document.hasFocus()`, 'the window active', 8000);
    const SECRET = 'A line the setting must hide ';
    const at = (i) => js(`(()=>{const b=document.querySelector('#stage .ro-screen[data-for="'+CSS.escape(${jsLiteral(i)})+'"]').getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/3};})()`);
    const wk = (await js(pickWorking))[0];
    await emit({ type: 'output', sessionId: wk, delta: SECRET });
    await must(`window.__scr(${jsLiteral(wk)}).textContent.includes(${jsLiteral(SECRET.trim().slice(0, 12))})`, 'the line on the screen');
    const w0 = await at(wk);
    await moveTo(1, 1); await hover(wk, w0);
    await js(`window.__durbarSimUi.setLive(false);0`);
    assert.ok(await H.until(`!window.__scr(${jsLiteral(wk)}).textContent.includes(${jsLiteral(SECRET.trim().slice(0, 12))})`, 1000), 'Live activity off takes the text off the screen at once');
    assert.ok(await H.until(`!document.getElementById('roZoom')||!document.getElementById('roZoom').textContent.includes(${jsLiteral(SECRET.trim().slice(0, 12))})`, 1000), 'and off the open zoom');
    await js(`window.__durbarSimUi.setLive(true);0`);
    assert.ok(await H.until(`window.__scr(${jsLiteral(wk)}).textContent.includes(${jsLiteral(SECRET.trim().slice(0, 12))})`, 1000), 'on again brings it back at once');
    /* a status change: the open zoom says it, at the screen's repaint pace (FR-033) */
    const zs0 = await js(`document.querySelector('#roZoom .ro-zs').textContent`);
    await js(`(()=>{const a=window.__durbarSimUi.agents().find(x=>x.id===${jsLiteral(wk)});a.state='done';a.lastEventAt=Date.now();window.__durbarSimUi.setLive(true);})();0`);
    assert.ok(await H.until(`(()=>{const e=document.querySelector('#roZoom .ro-zs');return !!e&&e.textContent!==${jsLiteral(zs0)};})()`, 5000), 'the open zoom shows the new status: was ' + zs0);
    await moveTo(1, 1);
    await must(`!document.getElementById('roZoom')`, 'the zoom closed when the pointer left');
    /* an open zoom of a desk that goes to sleep closes: an asleep screen is off (FR-035) */
    const sl = await js(`(()=>{const d=window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks).find(x=>(x.state==='done'||x.state==='idle')&&document.querySelector('#stage .ro-person[data-for="'+CSS.escape(x.id)+'"]'));return d&&d.id;})()`);
    assert.ok(sl, 'an idle desk to send to sleep');
    const s0 = await at(sl);
    await hover(sl, s0);
    await js(`(()=>{const a=window.__durbarSimUi.agents().find(x=>x.id===${jsLiteral(sl)});a.state='done';a.lastOutput=a.lastOutput||'done';a.unread=false;a.lastEventAt=Date.now()-30*864e5;window.__durbarSimUi.unread.read(a.id);window.__durbarSimUi.setLive(true);})();0`);
    await must(`(()=>{const L=window.__durbarSimUi.realLayout();return L.zones.flatMap(z=>z.desks).concat(L.lounge?L.lounge.desks:[]).find(x=>x.id===${jsLiteral(sl)}).state==='asleep'})()`, 'the agent asleep (in the lounge row, spec 097 FR-246)');
    assert.ok(await H.until(`!document.getElementById('roZoom')`, 1000), 'the zoom of a desk gone to sleep closes');
    await moveTo(1, 1);
  }

  /* Ruben's review of #979: a chat opening and closing pauses and resumes at once; leaving Real office leaves no key listener behind */
  mark('leave');
  await loadReal(1440, 900);
  await js(INSTALL);
  {
    ctx.win.show(); ctx.win.focus(); wc().focus();
    await must(`document.hasFocus()`, 'the window active', 8000);
    await must(`!document.querySelector('#stage .ro').classList.contains('paused')`, 'the room running');
    await js(`document.body.classList.add('panel-open');0`);
    assert.ok(await H.until(`document.querySelector('#stage .ro').classList.contains('paused')`, 1000), 'a panel over the office pauses it, with no draw');
    await js(`document.body.classList.remove('panel-open');0`);
    assert.ok(await H.until(`!document.querySelector('#stage .ro').classList.contains('paused')`, 1000), 'and it resumes');
    /* opened by the pointer: its plate is not what holds it, and the pointer stays there when the office goes */
    const one = (await js(pickWorking))[0];
    const hp = await js(`(()=>{const b=document.querySelector('#stage .ro-screen[data-for="'+CSS.escape(${jsLiteral(one)})+'"]').getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/3)};})()`);
    await moveTo(1, 1); await hover(one, hp);
    await js(`window.DurbarRealOffice.leave();0`); /* directly: leaving closes it, whatever the elements do */
    assert.strictEqual(await js(`!!document.getElementById('roZoom')`), false, 'leave closes the zoom');
    await js(`window.__durbarSimUi.setLive(true);0`);
    await must(`!!document.querySelector('#stage .ro .ro-plate')`, 'the room drawn again after leave');
    await js(`window.__escs=0;document.addEventListener('keydown',(e)=>{if(e.key==='Escape')window.__escs++;});0`);
    await js(`window.__durbarSimUi.setOfficeView('flat');0`);
    await must(`document.getElementById('stage').dataset.d!=='real'&&!document.getElementById('roZoom')`, 'flat office, no zoom');
    wc().sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); wc().sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    assert.ok(await H.until(`window.__escs===1`, 3000), 'Escape reaches the app after leaving Real office');
    await js(`window.__durbarSimUi.setOfficeView('real');0`);
    await must(REAL, 'back in Real office');
    await must(`!!document.querySelector('#stage .ro .ro-plate')`, 'the room drawn again');
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

  mark('facts change');
  /* spec 097 FR-315 (review of PR 1272, 7): a fact that comes while the zoom is open changes its height, and the zoom is placed again: the panel grows by the new line and
     its facts stay inside it. The one working desk has a tool fact; its turn ends (a `user` event) and a new tool starts, under the pointer. */
  {
    await loadReal(1440, 900, { sim: '3' });
    await js(INSTALL);
    ctx.win.show(); ctx.win.focus(); wc().focus();
    await must(`document.hasFocus()`, 'the window active', 8000);
    const ids = await js(`window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks).filter(d=>d.state==='working').map(d=>d.id)`);
    const ZS = `(()=>{const P=document.getElementById('roZoom');if(!P)return null;const b=P.getBoundingClientRect(),k=P.querySelector('.ro-zk').getBoundingClientRect();return {h:b.height,facts:[...P.querySelectorAll('.ro-zk .ro-zi')].map(e=>e.textContent),kin:k.bottom<=b.bottom&&k.top>=b.top,zb:P.querySelector('.ro-zb').getBoundingClientRect().height};})()`;
    await moveTo(1, 1);
    const id = ids[0];
    const pt = await js(`(()=>{const b=document.querySelector('#stage .ro-screen[data-for="'+CSS.escape(${jsLiteral(id)})+'"]').getBoundingClientRect();
      for(const fy of [.33,.2,.5,.65,.8,.12])for(const fx of [.5,.3,.7,.15,.85]){const x=b.left+b.width*fx,y=b.top+b.height*fy,e=document.elementFromPoint(x,y);if(e&&!e.closest('.ro-slip,.ro-lplate,.ro-chip,.ro-sign'))return {x,y};}return null;})()`);
    assert.ok(pt, 'a point of the working desk\'s screen that nothing covers');
    await hover(id, pt);
    const TOOL = `(()=>{const P=document.getElementById('roZoom');return !!P&&[...P.querySelectorAll('.ro-zk .ro-zi')].some(e=>/^(Now|Last tool) /.test(e.textContent));})()`;
    const z0 = await js(ZS);
    assert.ok(z0.facts.some((f) => /^(Now|Last tool) /.test(f)), 'the working desk has a tool fact to start from: ' + JSON.stringify(z0));
    /* the turn ends: the tool fact goes, its line goes with it, and the panel is placed again, shorter */
    await emit({ type: 'user', sessionId: id });
    await must('!(' + TOOL + ")&&!!document.getElementById('roZoom')", 'the tool fact gone from the open zoom', 15000);
    await js(`new Promise(r=>setTimeout(r,250))`); // the placement follows the fill in the same call; a bound on a negative
    const z1 = await js(ZS);
    assert.ok(z1.h <= z0.h - 16, 'FR-315: the panel is shorter by the fact line that went (it is placed again): ' + z0.h + ' to ' + z1.h + ' ' + JSON.stringify(z1.facts));
    /* a tool starts under the pointer: the fact comes and the panel grows by its line */
    await emit({ type: 'toolCall', sessionId: id, callId: 'drv-f', tool: 'read_file', phase: 'start', args: { path: 'src/facts/one.ts' } });
    await must(`(()=>{const P=document.getElementById('roZoom');return !!P&&[...P.querySelectorAll('.ro-zk .ro-zi')].some(e=>/^Now /.test(e.textContent));})()`, 'the Now fact in the open zoom', 15000);
    await js(`new Promise(r=>setTimeout(r,250))`);
    const z2 = await js(ZS);
    assert.ok(z2.h >= z1.h + 16, 'FR-315: the panel grew by the new fact line: ' + z1.h + ' to ' + z2.h);
    assert.ok(z1.kin && z2.kin && z2.zb >= 4 * 17 - 0.5, 'the facts inside the panel and the 4 lines kept: ' + JSON.stringify(z2));
    await moveTo(1, 1);
    await must(`!document.getElementById('roZoom')`, 'the zoom closed');
  }

  mark('no redact');
  /* review of PR 1272 (4, 7): without the redact module the zoom fails closed, tidily: no fact, not even a label with nothing after it, and the facts block is hidden */
  {
    await loadReal(1440, 900, { sim: '3', noredact: '1' });
    await js(INSTALL);
    ctx.win.show(); ctx.win.focus(); wc().focus();
    await must(`document.hasFocus()`, 'the window active', 8000);
    const ids = await js(`window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks).filter(d=>d.state!=='asleep').map(d=>d.id)`);
    await moveTo(1, 1);
    const pt = await js(`(()=>{const b=document.querySelector('#stage .ro-screen[data-for="'+CSS.escape(${jsLiteral(ids[0])})+'"]').getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/3};})()`);
    await hover(ids[0], pt);
    const nz = await js(`(()=>{const P=document.getElementById('roZoom');const k=P.querySelector('.ro-zk');return {items:k.querySelectorAll('.ro-zi').length,hidden:k.hidden,empty:[...k.querySelectorAll('.ro-zv')].filter(e=>!e.textContent.trim()).length,text:P.textContent};})()`);
    assert.deepStrictEqual([nz.items, nz.hidden, nz.empty], [0, true, 0], 'no redact: no fact, no empty label, the block hidden: ' + JSON.stringify(nz));
    await moveTo(1, 1);
    await must(`!document.getElementById('roZoom')`, 'the zoom closed');
  }

  console.log('[097-screens] OK');
};
