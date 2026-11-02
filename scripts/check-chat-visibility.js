/*
 * Check for spec 005 FR-210/FR-211: closing a long chat marks its older messages (`cvMark`: class `cvo` plus their measured height as
 * the fallback size), so reopening lays out only the ones near the view, and nothing else about the chat changes. Simulator only.
 *
 *   node scripts/ui-suite.js --only check-chat-visibility            (npm run check:ui runs it with the rest)
 *   DURBAR_CV_MUTANT=off|hidden|nosize|zero node scripts/ui-suite.js --only check-chat-visibility     (must FAIL)
 *   CVWH=1280x520 ...   one other window size; CVBASE=1 skips the "is skipped" checks (with DURBAR_CV_MUTANT=off: the rule-off baseline)
 *
 * At 1440x900 and 1280x800 the first agent's chat is filled with 4000 simulated messages (copies of its own with 1 to 9 sentences, a
 * unique token each and a button on every tenth, so heights differ), then, waiting on state (until(), two frames after a scroll, the chat's
 * scroll position and height unchanged for three frames), never on a fixed sleep:
 *   1. SKIPPED: 3993+ of 4004 are skipped and the newest is not; reopen time with the rule off and on in the same page is printed, not asserted.
 *      A fresh copy skipped from its first layout is 90px; a skipped message has the height it was measured at (the size guess mutants fail here).
 *   2. REOPEN: lands at the end and stays there.
 *   3. SCROLL: 70 steps from the end, every third three screens, then the wheel: the message in view never moves by itself, a message that
 *      stays in view moves by the scroll only, every message in view has its rule-off height, the chat is as tall as with the rule off,
 *      a seen message keeps its height while skipped, and the copy button under a reply is not cut off.
 *   4. STREAM: a turn keeps the chat pinned to its end; a chat scrolled up is not moved by it.
 *   5. COPY: a selection across skipped messages copies in full (selection and real Copy).
 *   6. FIND: Chromium's find-in-page (the app has no Find box and no Print) finds a token in a skipped message and scrolls to it.
 *   7. FOCUS: focus() and Tab reach a button in a skipped message and bring it into view.
 *   8. RESIZE: close, narrow the window to 820px, reopen: the marks are dropped (spec 005 FR-213); after one more close the new heights are stored.
 * Mutants caught on 2026-11-02: off (1), hidden (3, real heights), nosize and zero (1, the 90px and measured sizes).
 * A miss prints DRIVER FAILED (Electron still exits 0), so the npm script exits non-zero unless "all checks passed" is printed.
 */
const { helpers, jsLiteral } = require('./driver-helpers');
const assert = require('assert');
module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const installFrames = () => js(`window.__cvF=n=>new Promise(r=>{let i=0;const f=()=>++i>=n?r():requestAnimationFrame(f);requestAnimationFrame(f)});window.__cvFo=0;document.addEventListener('focusin',()=>{window.__cvFo++;},true);window.__cvQ=async()=>{const c=document.getElementById('chat');await window.__cvF(2);let last='',n=0;for(let i=0;i<240&&n<3;i++){await window.__cvF(1);const k=c.scrollTop+'/'+c.scrollHeight;if(k===last)n++;else{n=0;last=k;}}return n>=3};true`);
  /* waits on state, not time: two frames after a scroll, then until the chat's scroll position and height stop changing for three frames */
  const quiet = async (what) => assert.ok(await js('window.__cvQ()'), `the chat settles after ${what}`);
  const MUT = process.env.DURBAR_CV_MUTANT || '';
  const MUTANTS = {
    off: '.chat-inner>*{content-visibility:visible!important}',
    hidden: '.chat-inner>*{content-visibility:hidden!important}',
    nosize: '.chat-inner>*{contain-intrinsic-block-size:none!important}',
    zero: '.chat-inner>*{contain-intrinsic-block-size:0!important}',
  };
  assert.ok(!MUT || MUTANTS[MUT] || MUT === 'size', `known mutant: ${MUT}`);
  const N = 4000;
  const forceOff = (on) => js(`(()=>{let s=document.getElementById('cvOff');if(${jsLiteral(!!on)}){if(!s){s=document.createElement('style');s.id='cvOff';s.textContent=${jsLiteral(MUTANTS.off)};document.head.appendChild(s);}}else if(s)s.remove();})()`);
  if (process.env.CVSIZE) MUTANTS.size = `.chat-inner>*{contain-intrinsic-block-size:auto ${Number(process.env.CVSIZE)}px!important}`;
  const mutant = () => js(`(()=>{let s=document.getElementById('cvMut');if(s)s.remove();const css=${jsLiteral(MUT ? MUTANTS[MUT] : '')};if(css){s=document.createElement('style');s.id='cvMut';s.textContent=css;document.head.appendChild(s);}})()`);
  const gap = `(()=>{const c=document.getElementById('chat');return Math.round(c.scrollHeight-c.scrollTop-c.clientHeight)})()`;

  /* the chat of an agent, filled with N simulated messages of different heights */
  const open = async (w, h) => {
    await H.load({ w, h, ready: 'fit', focus: true });
    const o = await H.openSimAgent(`a=>!a.parent&&!a.question&&(a.state==='done'||a.state==='idle')`, '#chat .msg');
    assert.ok(o.ok, `${w}x${h}: a chat is open: ${JSON.stringify(o.seen)}`);
    assert.ok(await until(`!document.querySelector('#chat .typing')`, 20000), 'the first turn is over: '+(await js(`document.querySelector('#chat').innerHTML.slice(0,700)`)));
    await js(`(()=>{const el=document.querySelector('#chat .chat-inner');const seed=[...el.children].filter(e=>e.classList.contains('msg'));
      const words="The build passes and the tests are green. ".split(' ');
      const frag=document.createDocumentFragment();
      for(let i=0;i<${N};i++){const m=seed[i%seed.length].cloneNode(true);m.removeAttribute('id');m.dataset.cv=String(i);
        const b=m.querySelector('.bubble');
        if(b){const t='\\u27e6'+String(i).padStart(5,'0')+'\\u27e7 Message '+i+'. '+Array.from({length:1+(i*7)%9},(_,k)=>words.join(' ')).join(' ');b.textContent=t;}
        if(i%10===0){const f=document.createElement('button');f.type='button';f.className='btn sm cvfocus';f.textContent='Action '+i;m.appendChild(f);}
        frag.appendChild(m);}
      el.appendChild(frag);window.__cvId=${jsLiteral('')};})()`);
    await installFrames();
    await mutant();
    return o.id;
  };
  const reopen = (id, off) => js(`(async()=>{document.getElementById('backBtn').click();await __cvF(2);
    const d=document.querySelector('#stage .desk[data-id='+JSON.stringify(${jsLiteral(String(id))})+']');const t0=performance.now();d.click();
    void document.getElementById('chat').scrollHeight;await __cvF(2);return performance.now()-t0;})()`);
  const pending = `window.__durbarSimUi&&document.body.classList.contains('panel-open')&&!!document.querySelector('#chat .chat-inner')`;
  const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];

  for (const [w, h] of (process.env.CVWH ? [process.env.CVWH.split('x').map(Number)] : [[1440, 900], [1280, 800]])) {
    const tag = `${w}x${h}`;
    const id = await open(w, h);

    /* heights with the rule off: the truth for 3. (every message, once) */
    await forceOff(true);
    await js(`document.getElementById('chat').scrollTop=0`);
    const hv = await js(`(()=>{const e=[...document.querySelectorAll('#chat .chat-inner>.msg[data-cv]')];return {h:e.map(x=>Math.round(x.getBoundingClientRect().height*10)/10),total:document.getElementById('chat').scrollHeight}})()`);
    await forceOff(false);

    /* 1. SKIPPED and the timing, rule off against rule on, same page */
    const t = { off: [], on: [] };
    for (let i = 0; i < (process.env.CVSKIP ? 1 : 4); i++) {
      for (const k of i % 2 ? ['on', 'off'] : ['off', 'on']) { await forceOff(k === 'off'); t[k].push(Math.round(await reopen(id))); }
    }
    await forceOff(false);
    console.log(`TIMING ${tag}: reopen of a ${N}-message chat, rule off ${JSON.stringify(t.off)} ms (median ${median(t.off)}), rule on ${JSON.stringify(t.on)} ms (median ${median(t.on)})`);
    assert.ok(await until(`${gap}<=1`, 4000), `${tag}: the reopened chat is at its end: ${await js(gap)}`);
    const sk = await js(`(()=>{const e=[...document.querySelectorAll('#chat .chat-inner>*')];const sk=e.filter(x=>!(x.firstElementChild||x).checkVisibility({contentVisibilityAuto:true}));return {n:e.length,skipped:sk.length,lastSkipped:!(e[e.length-1].firstElementChild).checkVisibility({contentVisibilityAuto:true})}})()`);
    if (!process.env.CVBASE && (!MUT || MUT === 'off')) assert.ok(sk.skipped > N * 0.9 && !sk.lastSkipped, `${tag}: most messages are skipped, the last one is not: ${JSON.stringify(sk)}`);

    const ap = await js(`(()=>{const el=document.querySelector('#chat .chat-inner'),src=el.children[el.children.length-3];const t0=performance.now();for(let i=0;i<100;i++){const m=src.cloneNode(true);m.removeAttribute('id');el.appendChild(m);void m.getBoundingClientRect().height;}const t=performance.now()-t0;for(let i=0;i<100;i++)el.lastElementChild.remove();return Math.round(t)})()`);
    console.log(`TIMING ${tag}: appending 100 messages one by one with a layout read each: ${ap} ms (rule ${MUT === 'off' || process.env.CVBASE ? 'off' : 'on'})`);
    /* a message never laid out is guessed at 90px (nosize and zero guess 0): a fresh copy that is skipped from its first layout, removed again at once */
    const guess = await js(`(async()=>{const el=document.querySelector('#chat .chat-inner'),m=el.children[el.children.length-12].cloneNode(true);m.removeAttribute('id');m.dataset.cv='probe';m.classList.add('cvo');m.style.containIntrinsicBlockSize='';
      el.insertBefore(m,el.children[50]);await __cvF(2);const h=m.getBoundingClientRect().height;m.remove();await __cvF(2);return h})()`);
    if (!process.env.CVBASE) assert.ok(Math.abs(guess - 90) <= 0.6, `${tag}: a skipped message never laid out is guessed at 90px: ${guess}`);
    /* the fallback of a skipped message is its measured height (cvMark), not a guess: the reopened chat is as tall as it was */
    const est = await js(`[1500,2500,3000].map(i=>document.querySelector('#chat .chat-inner>[data-cv="'+i+'"]').getBoundingClientRect().height)`);
    if (!process.env.CVBASE) [1500, 2500, 3000].forEach((i, k) => assert.ok(Math.abs(est[k] - hv.h[i]) <= 0.6, `${tag}: skipped message ${i} has its measured height ${hv.h[i]}, not ${est[k]}`));
    /* 2. REOPEN: at the end, and it stays (the skipped heights settle) */
    await js(`document.getElementById('chat').scrollTop=3000`); await quiet('a scroll');
    await reopen(id); await quiet('a reopen');
    assert.ok(await until(`${gap}<=1`, 4000), `${tag}: after a reopen the chat is at its end and stays: ${await js(gap)}`);

    /* 3. SCROLL: no jump, real heights */
    /* delta > 0: scroll up by delta px. A small step keeps one message in view, so its place after the step must be where the step puts it
       (what you look at moves by the scroll and nothing else); then, for every step, a message in view does not drift while the page settles. */
    const chat_h = await js(`document.getElementById('chat').clientHeight`); // steps are sized by the chat's own height: a screen differs by machine
    const stepCheck = async (label, delta) => {
      const r = await js(`(async()=>{const c=document.getElementById('chat'),cr=c.getBoundingClientRect(),D=${jsLiteral(delta || 0)};
        const inView=()=>[...c.querySelectorAll('.chat-inner>.msg[data-cv]')].filter(e=>{const r=e.getBoundingClientRect();return r.bottom>cr.top+4&&r.top<cr.bottom-4;});
        let E=null,top0=0,applied=0;
        if(D&&D<c.clientHeight*0.6){E=inView().pop();if(E)top0=E.getBoundingClientRect().top;}
        if(D){const s0=c.scrollTop;c.scrollTop=Math.max(0,s0-D);applied=s0-c.scrollTop;}
        await __cvF(2);
        const v=inView();const e=v[0];if(!e)return {none:true};const snap=()=>{const o={};for(let k=+e.dataset.cv-45;k<=+e.dataset.cv+12;k++){const x=c.querySelector('.chat-inner>[data-cv="'+k+'"]');if(x)o[k]=Math.round(x.getBoundingClientRect().height)+(x.firstElementChild.checkVisibility({contentVisibilityAuto:true})?'v':'s');}return o;};const sn1=snap();const t1=e.getBoundingClientRect().top-cr.top,s1=Math.round(c.scrollTop),h1=c.scrollHeight;
        await window.__cvQ();const t2=e.getBoundingClientRect().top-cr.top;
        const sn2=snap();const chg=Object.keys(sn2).filter(k=>sn1[k]!==sn2[k]).map(k=>k+':'+sn1[k]+'>'+sn2[k]).join(' ');const place=E?Math.round((E.getBoundingClientRect().top-(top0+applied))*10)/10:0;
        return {chg,s1,s2:Math.round(c.scrollTop),h1,h2:c.scrollHeight,i:+e.dataset.cv,jump:Math.round((t2-t1)*10)/10,place,seen:inView().map(x=>[+x.dataset.cv,Math.round(x.getBoundingClientRect().height*10)/10])}})()`);
      if (process.env.CVLOG) { console.log('STEP', label, delta, r.i, r.jump, r.place, r.s1, r.s2, r.h1, r.h2, Math.abs(r.jump)>1?r.chg:''); return r; }
      assert.ok(!r.none, `${tag} ${label}: a message is in view`);
      assert.ok(Math.abs(r.jump) <= 1, `${tag} ${label}: the message in view does not drift while the page settles: ${JSON.stringify({ i: r.i, jump: r.jump })}`);
      assert.ok(Math.abs(r.place) <= 1, `${tag} ${label}: the message that stayed in view moved by the scroll only (off by ${r.place}px)`);
      for (const [i, hh] of r.seen) assert.ok(Math.abs(hh - hv.h[i]) <= 0.6, `${tag} ${label}: message ${i} has its real height ${hv.h[i]}, not ${hh}`);
      return r;
    };
    await js(`document.getElementById('chat').scrollTop=1e7`); await quiet('a scroll');
    let steps = 0;
    for (let i = 0; i < 70; i++) { await stepCheck(`step ${i}`, i % 3 === 0 ? chat_h * 3 : Math.round(chat_h * 0.5)); steps++; } // half a screen, and every third step three screens
    for (let i = 0; i < 6; i++) { // the mouse wheel
      const p = await js(`(()=>{const r=document.getElementById('chat').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
      const wheelFrom = await js(`document.getElementById('chat').scrollTop`);
      H.wc().sendInputEvent({ type: 'mouseWheel', x: p.x, y: p.y, deltaX: 0, deltaY: 120 * (i < 3 ? 1 : -1), canScroll: true });
      assert.ok(await until(`document.getElementById('chat').scrollTop!==${jsLiteral(wheelFrom)}`, 3000), `${tag}: the wheel scrolled the chat`);
      await quiet('a wheel step'); await stepCheck(`wheel ${i}`, 0);
    }
    /* a seen message keeps its height while it is skipped (contain-intrinsic-size auto): the mutants without it collapse to 0 */
    await js(`document.querySelector('#chat .chat-inner>[data-cv="3500"]').scrollIntoView({block:'center'})`); await quiet('showing message 3500');
    const h1 = await js(`document.querySelector('#chat .chat-inner>[data-cv="3500"]').getBoundingClientRect().height`);
    await js(`document.getElementById('chat').scrollTop=0`); await quiet('leaving message 3500');
    const kept = await js(`(()=>{const m=document.querySelector('#chat .chat-inner>[data-cv="3500"]');return {h:m.getBoundingClientRect().height,skipped:!m.firstElementChild.checkVisibility({contentVisibilityAuto:true})}})()`);
    assert.ok(h1 > 0 && Math.abs(kept.h - h1) <= 0.6 && (kept.skipped || process.env.CVBASE || MUT === 'hidden'), `${tag}: a seen message keeps its height ${h1} while skipped: ${JSON.stringify(kept)}`);
    console.log(`CHAT HEIGHT ${tag}: ${chat_h}px`);
    await js(`document.getElementById('chat').scrollTop=0`); await quiet('a scroll');
    await quiet('the jump to the start');
    assert.strictEqual(await js(`document.getElementById('chat').scrollTop`), 0, `${tag}: the start of the chat stays the start (no late shift)`);
    // one pass over everything remembers the real heights: the whole chat is as tall as with the rule off
    await js(`(async()=>{const c=document.getElementById('chat');for(let y=0;y<c.scrollHeight;y+=c.clientHeight*0.8){c.scrollTop=y;await new Promise(r=>requestAnimationFrame(r));}})()`);
    await js(`document.getElementById('chat').scrollTop=0`); await quiet('a scroll');
    const tot = await js(`document.getElementById('chat').scrollHeight`);
    assert.ok(Math.abs(tot - hv.total) <= 2, `${tag}: after one pass the chat is as tall as with the rule off: ${tot} against ${hv.total}`);
    // the copy button hangs under the bubble (bottom:-11px): it must not be cut off by the skipped box
    const cut = await js(`(()=>{const c=document.getElementById('chat');const b=[...c.querySelectorAll('.msg.agent .bubble>.cp-msg')][0];if(!b)return {none:true};b.scrollIntoView({block:'center'});
      const r=b.getBoundingClientRect(),el=document.elementFromPoint(r.left+r.width/2,r.bottom-2);return {hit:!!el&&(el===b||b.contains(el)),box:Math.round(r.height)}})()`);
    assert.ok(cut.none || cut.hit, `${tag}: the copy button under a reply is not cut off: ${JSON.stringify(cut)}`);

    /* 4. STREAM: a turn keeps the end pinned; a chat scrolled up stays where it is */
    const send = async (txt) => {
      await js(`(()=>{const i=document.getElementById('msgInput');i.value=${jsLiteral(txt)};i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('sendBtn').click();})()`);
    };
    const sample = (ms, scrolled) => js(`(async()=>{const c=document.getElementById('chat');const out={max:0,n:0,s0:c.scrollTop,ser:[],ev:[]};c.addEventListener('scroll',()=>out.ev.push([out.n,Math.round(c.scrollHeight-c.scrollTop-c.clientHeight),Math.round(c.scrollTop),c.dataset.pin]),{passive:true});const end=performance.now()+${jsLiteral(ms)};
      while(performance.now()<end){await new Promise(r=>requestAnimationFrame(r));await new Promise(r=>setTimeout(r,0));const g=c.scrollHeight-c.scrollTop-c.clientHeight;out.n++;
        const bad=${scrolled ? 'Math.abs(c.scrollTop-out.s0)>1' : 'g>60'};if(bad&&out.prev){out.max=Math.max(out.max,${scrolled ? 'Math.abs(c.scrollTop-out.s0)' : 'g'});}out.prev=bad;if(out.ser.length<400)out.ser.push(Math.round(g)+(c.dataset.pin==='1'?'':'p0'));}
      out.busy=!!document.querySelector('#chat .typing');return out})()`);
    await reopen(id); await quiet('a reopen'); // the app's own way to the end
    assert.ok(await until(`${gap}<=1`, 4000), `${tag}: the reopened chat is at its end before the turn: ${await js(gap)}`);
    const pre = await js(`(()=>{const c=document.getElementById('chat');return {gap:Math.round(c.scrollHeight-c.scrollTop-c.clientHeight),pin:c.dataset.pin,st:Math.round(c.scrollTop),sh:c.scrollHeight}})()`);
    await send('quick links please');
    assert.ok(await until(`!!document.querySelector('#chat .typing')||document.querySelectorAll('#chat .chat-inner>.msg').length>${jsLiteral(N + 2)}`, 8000), `${tag}: a turn starts`);
    const s1 = await sample(2500, false);
    assert.ok(s1.max === 0 && s1.n > 20, `${tag}: a streaming turn stays pinned to the end of the chat (largest gap ${s1.max}px in ${s1.n} frames; pre-send ${JSON.stringify(pre)}; gaps ${s1.ser.slice(0, 30).join(' ')}; scroll events [frame,gap,top,pin] ${JSON.stringify(s1.ev.slice(0, 12))})`);
    assert.ok(await until(`!document.querySelector('#chat .typing')`, 30000), `${tag}: the turn ends`);
    await quiet('the turn');
    assert.ok(await until(`${gap}<=1`, 4000), `${tag}: the end stays in view after the turn: ${await js(gap)}`);
    await js(`document.getElementById('chat').scrollTop=document.getElementById('chat').scrollTop-3000`); await quiet('a scroll');
    const before = await js(`document.getElementById('chat').scrollTop`);
    await send('and one more');
    assert.ok(await until(`!!document.querySelector('#chat .typing')`, 8000), `${tag}: a second turn starts`);
    const s2 = await sample(2000, true);
    assert.ok(s2.max === 0 && s2.n > 20, `${tag}: a chat scrolled up is not moved by a turn (moved ${s2.max}px in ${s2.n} frames)`);
    assert.ok(await until(`!document.querySelector('#chat .typing')`, 30000), `${tag}: the second turn ends`);

    /* 5. COPY across skipped messages */
    await js(`document.getElementById('chat').scrollTop=0`); await quiet('a scroll');
    const sel = await js(`(()=>{const e=[...document.querySelectorAll('#chat .chat-inner>.msg[data-cv]')];const a=e[5].querySelector('.bubble'),b=e[40].querySelector('.bubble');
      const skipped=e.slice(6,40).filter(x=>!(x.firstElementChild||x).checkVisibility({contentVisibilityAuto:true})).length;const r=document.createRange();r.setStart(a.firstChild,0);r.setEnd(b.firstChild,b.firstChild.length);const s=getSelection();s.removeAllRanges();s.addRange(r);
      return {skipped,text:s.toString()}})()`);
    if (!process.env.CVBASE) assert.ok(sel.skipped >= 20, `${tag}: the messages between the ends of the selection are skipped: ${sel.skipped}`);
    const { clipboard } = require('electron');
    await clipboard.writeText('');
    H.wc().copy();
    let copied = '';
    for (let k = 0; k < 50 && !copied; k++) { copied = String(await clipboard.readText()); if (!copied) await ctx.sleep(60); }
    assert.ok(copied.includes('⟦' + '00020' + '⟧') && copied.includes('⟦' + '00040' + '⟧') && copied.length >= sel.text.length * 0.95, `${tag}: Copy gives the whole selection: ${copied.length} of ${sel.text.length} chars`);
    await js(`getSelection().removeAllRanges()`);

    /* 6. FIND (Chromium's own; the app has no Find box) */
    await js(`document.getElementById('chat').scrollTop=0`); await quiet('a scroll');
    const tok = '⟦' + '02500' + '⟧';
    const found = await new Promise((resolve) => {
      const wc = H.wc(); let res = null;
      const on = (_e, r) => { if (r.finalUpdate) { res = r; wc.removeListener('found-in-page', on); resolve(r); } };
      wc.on('found-in-page', on); wc.findInPage(tok);
      setTimeout(() => { wc.removeListener('found-in-page', on); resolve(res); }, 6000);
    });
    assert.ok(found && found.matches === 1, `${tag}: find-in-page finds the token in a skipped message: ${JSON.stringify(found && { m: found.matches, o: found.activeMatchOrdinal })}`);
    const landed = await until(`(()=>{const c=document.getElementById('chat'),cr=c.getBoundingClientRect(),e=document.querySelector('#chat .chat-inner>[data-cv="2500"]');if(!e)return false;const r=e.getBoundingClientRect();return r.bottom>cr.top&&r.top<cr.bottom&&e.firstElementChild.checkVisibility({contentVisibilityAuto:true})})()`, 4000);
    H.wc().stopFindInPage('clearSelection');
    assert.ok(landed, `${tag}: the chat scrolled to the hit (message 2500 is in view)`);

    /* 7. FOCUS: a button in a skipped message */
    await js(`document.getElementById('chat').scrollTop=0`); await quiet('a scroll');
    const foc = await js(`(async()=>{const c=document.getElementById('chat');const t=document.querySelector('#chat .chat-inner>[data-cv="3000"]'),btn=t&&t.querySelector('.cvfocus');
      if(!btn)return {none:true};const was=t.firstElementChild.checkVisibility({contentVisibilityAuto:true});
      btn.focus();for(let i=0;i<60;i++){await __cvF(1);const q=btn.getBoundingClientRect(),w=c.getBoundingClientRect();if(document.activeElement===btn&&q.bottom>w.top&&q.top<w.bottom)break;}const cr=c.getBoundingClientRect(),r=btn.getBoundingClientRect();
      return {was,active:document.activeElement===btn,inView:r.bottom>cr.top&&r.top<cr.bottom,top:c.scrollTop}})()`);
    assert.ok(!foc.none, `${tag}: message 3000 has a button`);
    assert.ok((foc.was === false || process.env.CVBASE) && foc.active && foc.inView, `${tag}: focus() on a button in a skipped message works and shows it: ${JSON.stringify(foc)}`);
    // Tab walks on through the next messages; each stop is in view
    await js(`document.getElementById('chat').scrollTop=0`); await quiet('a scroll');
    await js(`(()=>{const b=document.querySelector('#chat .chat-inner>[data-cv="10"] .cvfocus');if(b)b.focus();})()`);
    const seen = [];
    for (let i = 0; i < 14; i++) {
      const was = await js(`window.__cvFo`);
      await H.key('Tab', [], { char: 'never', pause: 0 });
      assert.ok(await until(`window.__cvFo>${jsLiteral(was)}`, 2000), `${tag}: Tab moved the focus`);
      await quiet('a Tab');
      seen.push(await js(`(()=>{const c=document.getElementById('chat'),cr=c.getBoundingClientRect(),a=document.activeElement,m=a&&a.closest('.chat-inner>*[data-cv]');if(!m)return {out:true};const r=a.getBoundingClientRect();return {i:+m.dataset.cv,inView:r.bottom>cr.top-1&&r.top<cr.bottom+1}})()`));
    }
    const inChat = seen.filter((s) => !s.out);
    assert.ok(inChat.length >= 10 && new Set(inChat.map((s) => s.i)).size >= 4 && inChat.every((s, k) => s.inView && (k === 0 || s.i >= inChat[k - 1].i)), `${tag}: Tab moves through the messages and each stop is in view: ${JSON.stringify(seen)}`);
    /* 8. RESIZE: the stored heights belong to the width they were measured at. Close, make the window narrower, reopen: the marks are dropped
       (nothing skipped, so nothing stale), then three-screen jumps still have real heights; one more close and reopen marks again with fresh heights. */
    await reopen(id); await quiet('a reopen'); // marked at the old width
    assert.ok((await js(`document.querySelectorAll('#chat .chat-inner>.cvo').length`)) > N * 0.9, `${tag}: marked before the resize`);
    await js(`document.getElementById('backBtn').click()`);
    ctx.win.setContentSize(820, h); // the chat is capped at 865px, so only a window below that changes its width
    assert.ok(await until(`innerWidth<=830`, 5000), `${tag}: the window is narrower`);
    await js(`(()=>{document.querySelector('#stage .desk[data-id='+JSON.stringify(${jsLiteral(String(id))})+']').click()})()`);
    assert.ok(await until(`document.body.classList.contains('panel-open')&&!!document.querySelector('#chat .chat-inner')`, 15000), `${tag}: the chat is open again`);
    await quiet('the reopen at the new width');
    assert.strictEqual(await js(`document.querySelectorAll('#chat .chat-inner>.cvo').length`), 0, `${tag}: a changed width drops the marks`);
    await forceOff(true); await js(`document.getElementById('chat').scrollTop=0`); await quiet('measuring');
    const hv2 = await js(`[...document.querySelectorAll('#chat .chat-inner>.msg[data-cv]')].map(x=>Math.round(x.getBoundingClientRect().height*10)/10)`);
    await forceOff(false);
    hv.h = hv2;
    await reopen(id); await quiet('the reopen after the resize'); // marks again, with heights measured at the new width
    const est2 = await js(`[1500,2500,3000].map(i=>document.querySelector('#chat .chat-inner>[data-cv="'+i+'"]').getBoundingClientRect().height)`);
    [1500, 2500, 3000].forEach((i, k) => assert.ok(Math.abs(est2[k] - hv2[i]) <= 0.6, `${tag}: after the resize message ${i} is skipped with its new height ${hv2[i]}, not ${est2[k]}`));
    await js(`document.getElementById('chat').scrollTop=1e7`); await quiet('the end');
    for (let i = 0; i < 12; i++) await stepCheck(`resized step ${i}`, chat_h * 3);
    ctx.win.setContentSize(w, h);
    console.log(`OK ${tag}: ${steps} scroll steps, ${N} messages, ${sk.skipped} skipped on reopen`);
  }
  console.log('all checks passed');
};
