/*
 * Check for spec 005 FR-210: a long chat is laid out only near the view (`.chat-inner>*{content-visibility:auto}`), and nothing else
 * about the chat changes. Simulator only (no AI credits).
 *
 *   npm run check:ui -- --only check-chat-visibility
 *   DURBAR_CV_MUTANT=off|hidden|nosize|zero node scripts/ui-suite.js --only check-chat-visibility     (must FAIL; see below)
 *
 * At 1440x900 and 1280x800 the first agent's chat is filled with 4000 simulated messages (copies of its own, with texts of 1 to 23
 * sentences and a unique token each, so the heights differ), then:
 *   1. SKIPPED: most messages are skipped (not laid out) and the last one is not; the reopen time is measured with the rule on and
 *      with it forced off in this same page (printed, not asserted: a wall-clock ratio is flaky, the skipped count is the proof).
 *   2. REOPEN: closing and opening the chat lands at the end, as it always did, and stays there.
 *   3. SCROLL: from the end to the start in steps (and then by the mouse wheel), the message in view never moves by itself after the
 *      step (no jump), and every message in view has the height it has with the rule off (real heights); the total height is the same
 *      after one pass, and the copy button hanging under a bubble is not cut off.
 *   4. STREAM: a turn that streams keeps the chat at its end (pinned); a chat scrolled up is not moved by it.
 *   5. COPY: a selection across skipped messages gives the same text, by the selection and by the real Copy.
 *   6. FIND: Chromium's find-in-page (the app has no Find box of its own) finds a token in a skipped message and scrolls to it.
 *   7. FOCUS: focus() and Tab reach a button in a skipped message and bring it into view.
 * Mutants (DURBAR_CV_MUTANT, an override style added after the page loads), each run and caught on 2026-11-02: off = the rule removed (fails 1),
 * hidden = content-visibility:hidden (fails at the first real-height check), nosize = no remembered size and zero = a 0px guess (both fail 4, the pinned
 * end while a turn streams). CVBASE=1 skips the 'is skipped' checks, CVLOG=1 prints every scroll step instead of asserting. The app has no Print and no Find box.
 * A miss prints DRIVER FAILED (Electron still exits 0), so the npm script exits non-zero unless "all checks passed" is printed.
 */
const { helpers, jsLiteral } = require('./driver-helpers');
const assert = require('assert');
module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const installFrames = () => js(`window.__cvF=n=>new Promise(r=>{let i=0;const f=()=>++i>=n?r():requestAnimationFrame(f);requestAnimationFrame(f)});true`);
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

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
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
    /* 2. REOPEN: at the end, and it stays (the skipped heights settle) */
    await js(`document.getElementById('chat').scrollTop=3000`); await ctx.sleep(150);
    await reopen(id); await ctx.sleep(300);
    assert.ok(await until(`${gap}<=1`, 4000), `${tag}: after a reopen the chat is at its end and stays: ${await js(gap)}`);

    /* 3. SCROLL: no jump, real heights */
    /* delta > 0: scroll up by delta px. A small step keeps one message in view, so its place after the step must be where the step puts it
       (what you look at moves by the scroll and nothing else); then, for every step, a message in view does not drift while the page settles. */
    const bigJumps = []; // jumps of 3 screens into messages never seen: the unseen ones are guessed (KNOWN GAP, printed, not asserted)
    const stepCheck = async (label, delta) => {
      const r = await js(`(async()=>{const c=document.getElementById('chat'),cr=c.getBoundingClientRect(),D=${jsLiteral(delta || 0)};
        const inView=()=>[...c.querySelectorAll('.chat-inner>.msg[data-cv]')].filter(e=>{const r=e.getBoundingClientRect();return r.bottom>cr.top+4&&r.top<cr.bottom-4;});
        let E=null,top0=0,applied=0;
        if(D&&D<c.clientHeight*0.6){E=inView().pop();if(E)top0=E.getBoundingClientRect().top;}
        if(D){const s0=c.scrollTop;c.scrollTop=Math.max(0,s0-D);applied=s0-c.scrollTop;}
        await __cvF(2);
        const v=inView();const e=v[0];if(!e)return {none:true};const snap=()=>{const o={};for(let k=+e.dataset.cv-45;k<=+e.dataset.cv+12;k++){const x=c.querySelector('.chat-inner>[data-cv="'+k+'"]');if(x)o[k]=Math.round(x.getBoundingClientRect().height)+(x.firstElementChild.checkVisibility({contentVisibilityAuto:true})?'v':'s');}return o;};const sn1=snap();const t1=e.getBoundingClientRect().top-cr.top,s1=Math.round(c.scrollTop),h1=c.scrollHeight;
        await __cvF(3);await new Promise(r=>setTimeout(r,40));const t2=e.getBoundingClientRect().top-cr.top;
        const sn2=snap();const chg=Object.keys(sn2).filter(k=>sn1[k]!==sn2[k]).map(k=>k+':'+sn1[k]+'>'+sn2[k]).join(' ');const place=E?Math.round((E.getBoundingClientRect().top-(top0+applied))*10)/10:0;
        return {chg,s1,s2:Math.round(c.scrollTop),h1,h2:c.scrollHeight,i:+e.dataset.cv,jump:Math.round((t2-t1)*10)/10,place,seen:inView().map(x=>[+x.dataset.cv,Math.round(x.getBoundingClientRect().height*10)/10])}})()`);
      if (process.env.CVLOG) { console.log('STEP', label, delta, r.i, r.jump, r.place, r.s1, r.s2, r.h1, r.h2, Math.abs(r.jump)>1?r.chg:''); return r; }
      assert.ok(!r.none, `${tag} ${label}: a message is in view`);
      if (delta > 900) { bigJumps.push(Math.abs(r.jump)); }
      else assert.ok(Math.abs(r.jump) <= 1, `${tag} ${label}: the message in view does not drift while the page settles: ${JSON.stringify({ i: r.i, jump: r.jump })}`);
      assert.ok(Math.abs(r.place) <= 1, `${tag} ${label}: the message that stayed in view moved by the scroll only (off by ${r.place}px)`);
      for (const [i, hh] of r.seen) assert.ok(Math.abs(hh - hv.h[i]) <= 0.6, `${tag} ${label}: message ${i} has its real height ${hv.h[i]}, not ${hh}`);
      return r;
    };
    await js(`document.getElementById('chat').scrollTop=1e7`); await ctx.sleep(150);
    let steps = 0;
    for (let i = 0; i < 70; i++) { await stepCheck(`step ${i}`, i % 3 === 0 ? 1500 : 380); steps++; }
    for (let i = 0; i < 6; i++) { // the mouse wheel
      const p = await js(`(()=>{const r=document.getElementById('chat').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
      H.wc().sendInputEvent({ type: 'mouseWheel', x: p.x, y: p.y, deltaX: 0, deltaY: 120 * (i < 3 ? 1 : -1), canScroll: true });
      await ctx.sleep(600); await stepCheck(`wheel ${i}`, 0);
    }
    console.log(`KNOWN GAP ${tag}: ${bigJumps.filter((x) => x > 1).length} of ${bigJumps.length} jumps of 1500px into never-seen messages moved the view (largest ${Math.max(0, ...bigJumps)}px); steps of 380px and the wheel: none`);
    await js(`document.getElementById('chat').scrollTop=0`); await ctx.sleep(150);
    await ctx.sleep(400);
    assert.strictEqual(await js(`document.getElementById('chat').scrollTop`), 0, `${tag}: the start of the chat stays the start (no late shift)`);
    // one pass over everything remembers the real heights: the whole chat is as tall as with the rule off
    await js(`(async()=>{const c=document.getElementById('chat');for(let y=0;y<c.scrollHeight;y+=c.clientHeight*0.8){c.scrollTop=y;await new Promise(r=>requestAnimationFrame(r));}})()`);
    await js(`document.getElementById('chat').scrollTop=0`); await ctx.sleep(200);
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
    const sample = (ms, scrolled) => js(`(async()=>{const c=document.getElementById('chat');const out={max:0,n:0,s0:c.scrollTop};const end=performance.now()+${jsLiteral(ms)};
      while(performance.now()<end){await new Promise(r=>requestAnimationFrame(r));await new Promise(r=>setTimeout(r,0));const g=c.scrollHeight-c.scrollTop-c.clientHeight;out.n++;
        const bad=${scrolled ? 'Math.abs(c.scrollTop-out.s0)>1' : 'g>60'};if(bad&&out.prev){out.max=Math.max(out.max,${scrolled ? 'Math.abs(c.scrollTop-out.s0)' : 'g'});}out.prev=bad;}
      out.busy=!!document.querySelector('#chat .typing');return out})()`);
    await js(`document.getElementById('chat').scrollTop=1e7`); await ctx.sleep(200);
    await send('quick links please');
    assert.ok(await until(`!!document.querySelector('#chat .typing')||document.querySelectorAll('#chat .chat-inner>.msg').length>${jsLiteral(N + 2)}`, 8000), `${tag}: a turn starts`);
    const s1 = await sample(2500, false);
    assert.ok(s1.max === 0 && s1.n > 20, `${tag}: a streaming turn stays pinned to the end of the chat (largest gap ${s1.max}px in ${s1.n} frames)`);
    assert.ok(await until(`!document.querySelector('#chat .typing')`, 30000), `${tag}: the turn ends`);
    await ctx.sleep(300);
    assert.ok(await until(`${gap}<=1`, 4000), `${tag}: the end stays in view after the turn: ${await js(gap)}`);
    await js(`document.getElementById('chat').scrollTop=document.getElementById('chat').scrollTop-3000`); await ctx.sleep(300);
    const before = await js(`document.getElementById('chat').scrollTop`);
    await send('and one more');
    assert.ok(await until(`!!document.querySelector('#chat .typing')`, 8000), `${tag}: a second turn starts`);
    const s2 = await sample(2000, true);
    assert.ok(s2.max === 0 && s2.n > 20, `${tag}: a chat scrolled up is not moved by a turn (moved ${s2.max}px in ${s2.n} frames)`);
    assert.ok(await until(`!document.querySelector('#chat .typing')`, 30000), `${tag}: the second turn ends`);

    /* 5. COPY across skipped messages */
    await js(`document.getElementById('chat').scrollTop=0`); await ctx.sleep(250);
    const sel = await js(`(()=>{const e=[...document.querySelectorAll('#chat .chat-inner>.msg[data-cv]')];const a=e[5].querySelector('.bubble'),b=e[40].querySelector('.bubble');
      const skipped=e.slice(6,40).filter(x=>!(x.firstElementChild||x).checkVisibility({contentVisibilityAuto:true})).length;const r=document.createRange();r.setStart(a.firstChild,0);r.setEnd(b.firstChild,b.firstChild.length);const s=getSelection();s.removeAllRanges();s.addRange(r);
      return {skipped,text:s.toString()}})()`);
    if (!process.env.CVBASE) assert.ok(sel.skipped >= 20, `${tag}: the messages between the ends of the selection are skipped: ${sel.skipped}`);
    const { clipboard } = require('electron');
    await clipboard.writeText('');
    H.wc().copy(); await ctx.sleep(200);
    const copied = String(await clipboard.readText());
    assert.ok(copied.includes('⟦' + '00020' + '⟧') && copied.includes('⟦' + '00040' + '⟧') && copied.length >= sel.text.length * 0.95, `${tag}: Copy gives the whole selection: ${copied.length} of ${sel.text.length} chars`);
    await js(`getSelection().removeAllRanges()`);

    /* 6. FIND (Chromium's own; the app has no Find box) */
    await js(`document.getElementById('chat').scrollTop=0`); await ctx.sleep(250);
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
    await js(`document.getElementById('chat').scrollTop=0`); await ctx.sleep(250);
    const foc = await js(`(async()=>{const c=document.getElementById('chat');const t=document.querySelector('#chat .chat-inner>[data-cv="3000"]'),btn=t&&t.querySelector('.cvfocus');
      if(!btn)return {none:true};const was=t.firstElementChild.checkVisibility({contentVisibilityAuto:true});
      btn.focus();await __cvF(3);const cr=c.getBoundingClientRect(),r=btn.getBoundingClientRect();
      return {was,active:document.activeElement===btn,inView:r.bottom>cr.top&&r.top<cr.bottom,top:c.scrollTop}})()`);
    assert.ok(!foc.none, `${tag}: message 3000 has a button`);
    assert.ok((foc.was === false || process.env.CVBASE) && foc.active && foc.inView, `${tag}: focus() on a button in a skipped message works and shows it: ${JSON.stringify(foc)}`);
    // Tab walks on through the next messages; each stop is in view
    await js(`document.getElementById('chat').scrollTop=0`); await ctx.sleep(250);
    await js(`(()=>{const b=document.querySelector('#chat .chat-inner>[data-cv="10"] .cvfocus');if(b)b.focus();})()`);
    const seen = [];
    for (let i = 0; i < 14; i++) {
      await H.key('Tab', [], { char: 'never', pause: 0 });
      await ctx.sleep(60);
      seen.push(await js(`(()=>{const c=document.getElementById('chat'),cr=c.getBoundingClientRect(),a=document.activeElement,m=a&&a.closest('.chat-inner>*[data-cv]');if(!m)return {out:true};const r=a.getBoundingClientRect();return {i:+m.dataset.cv,inView:r.bottom>cr.top-1&&r.top<cr.bottom+1}})()`));
    }
    const inChat = seen.filter((s) => !s.out);
    assert.ok(inChat.length >= 10 && new Set(inChat.map((s) => s.i)).size >= 4 && inChat.every((s, k) => s.inView && (k === 0 || s.i >= inChat[k - 1].i)), `${tag}: Tab moves through the messages and each stop is in view: ${JSON.stringify(seen)}`);
    console.log(`OK ${tag}: ${steps} scroll steps, ${N} messages, ${sk.skipped} skipped on reopen`);
  }
  console.log('all checks passed');
};
