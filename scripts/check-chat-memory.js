/*
 * A chat keeps a bounded transcript (spec 005 FR-238, FR-239, issue 1380). With the simulator frozen, events go at full speed through the
 * normal event path (`__durbarSimEmit`) to seven agents:
 *   sim-1..sim-3  a turn that never ends (as the simulator's background agents); sim-2 has a tool call that never ends (its chip is trimmed:
 *                 the waiting line must name the next one), sim-3 a helper that never ends (its own timeline grows);
 *   sim-4         short turns, each with a Read-only denial (never settled; only the newest has its button) and the same reply text
 *                 (a saved note tells such messages apart by place);
 *   sim-5         short turns, a helper in each of the first 60 (their blocks are trimmed later: nothing may keep them);
 *   sim-6         long closed turns (about 30 blocks each): the chat's budget of 2,000 blocks binds before its 300 messages;
 *   sim-7         a fresh-session note first (a live card that is not a waiting card), then short turns.
 * The page's heap is collected twice before each sample; then Performance.getMetrics (Nodes, JSEventListeners) and Runtime.getHeapUsage.
 * A fill until every pumped chat has reached its caps (counted and printed), 5,000 events of warm-up, a sample, 20,000 more, a sample. Fails when nodes, listeners or the heap grow past a limit set from the measured
 * plateau, when a chat is over a cap, keeps a reference to a removed block or helper view, loses a live or waiting card, when the waiting
 * line names a removed chip, when the line is missing, wrong or under 10.5px, when a trim moves what the person reads in an open chat
 * scrolled up (with the page's scroll anchoring on, as people have it, and off), when a chat at its caps takes the slow path on a frame
 * that adds no block, and when a saved note's marker moves to another message with the same text after trims.
 * It does not assert resident memory (noisy, differs by OS). CCM_WORLD=real|retro runs it with the Real office or the Retro arcade on.
 * Simulator only, no credits:
 *
 *   npm run build
 *   DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 DURBAR_DRIVER=$PWD/scripts/check-chat-memory.js xvfb-run -a npx electron . --no-sandbox
 */
'use strict';
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const WARM = 5000, LOAD = 20000;
// limits for the 20,000 events after the warm-up, from the plateau measured with the fix, with a margin (numbers: spec 005, 2026-11-09 delta)
const MAX_NODES = 20000, MAX_LISTENERS = 200, MAX_HEAP_MB = 2;
const CAP = { messages: 300, blocks: 300, budget: 2000 }; // src/renderer/chattrim.js CHAT_KEEP (checked against the page below)
const WORLD = process.env.CCM_WORLD || '';
const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
const LINE = /^Earlier messages and steps are not kept in this view \([\d,]+ removed\)$/;

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const query = { simtrimtick: '400', ...(WORLD === 'real' ? { officeview: 'real' } : WORLD === 'retro' ? { officeview: 'real', worldflags: 'retro', world: 'retro' } : {}) }; // simtrimtick: the hidden-window timer every 400 ms, not 30 s
  await H.load({ w: 1440, h: 900, query, ...(WORLD ? { ready: REAL, settle: false } : {}) });
  const wc = ctx.win.webContents;
  const d = wc.debugger;
  if (!d.isAttached()) d.attach('1.3');
  await d.sendCommand('Performance.enable');
  const sample = async () => {
    await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())))');
    await d.sendCommand('HeapProfiler.collectGarbage');
    await d.sendCommand('HeapProfiler.collectGarbage');
    const h = await d.sendCommand('Runtime.getHeapUsage');
    const m = await d.sendCommand('Performance.getMetrics');
    const g = (n) => (m.metrics.find((x) => x.name === n) || {}).value || 0;
    return { nodes: g('Nodes'), listeners: g('JSEventListeners'), heapMB: Math.round(h.usedSize / 1048576 * 10) / 10 };
  };
  assert.deepStrictEqual(await js('window.DurbarChatTrim?{...window.DurbarChatTrim.CHAT_KEEP}:null'), CAP, 'the page loads chattrim.js with the caps this check expects');
  if (WORLD) assert.strictEqual(await js(`document.getElementById('stage').dataset.d`), 'real', `the ${WORLD} world is on`);

  // the pump: per agent a script of events, round robin; a frame every 250 events so stickyFlush runs as it would
  await js(`(()=>{const e=window.__durbarSimEmit;if(!e)throw new Error('no __durbarSimEmit');
    const step={},ts=()=>Date.now(),S='Done, all green.';
    const ev={
      forever:(sid,i)=>{const p=i%4,out=[];
        if(p===1)out.push({type:'thinking',sessionId:sid,timestamp:ts(),reasoningId:sid+'-r'+i,delta:'Looking at step '+i+'. '});
        else if(p===2)out.push({type:'toolCall',sessionId:sid,timestamp:ts(),callId:sid+'-t'+i,tool:'read_file',phase:'start',args:{path:'src/f'+(i%9)+'.ts'}});
        else if(p===3)out.push({type:'toolCall',sessionId:sid,timestamp:ts(),callId:sid+'-t'+(i-1),tool:'read_file',phase:'complete',output:'120 lines'});
        else out.push({type:'output',sessionId:sid,timestamp:ts(),delta:'Step '+i+' checked.',final:true,text:'Step '+i+' checked.'});
        if(sid==='sim-3'&&p===1)out.push({type:'thinking',sessionId:sid,agentId:'sim-3-helper',timestamp:ts(),reasoningId:'h-r'+i,delta:'Helper step '+i+'. '});
        return out;},
      denials:(sid,i)=>{const p=i%5;
        return [p===1?{type:'user',sessionId:sid,timestamp:ts(),text:'Next step '+i}
          :p===2?{type:'status',sessionId:sid,timestamp:ts(),status:'needs-permission',intent:'Denied (read-only mode): write src/f'+i+'.ts',permission:{requestId:sid+'-d'+i,kind:'write',summary:'Write src/f'+i+'.ts',state:'denied'}}
          :p===3?{type:'toolCall',sessionId:sid,timestamp:ts(),callId:sid+'-c'+i,tool:'read_file',phase:'start',args:{path:'src/f.ts'}}
          :p===4?{type:'output',sessionId:sid,timestamp:ts(),delta:S,final:true,text:S}
          :{type:'status',sessionId:sid,timestamp:ts(),status:'idle'}];},
      helpers:(sid,i)=>{const p=i%6,turn=Math.floor(i/6),h=sid+'-h'+turn,withHelper=turn<60;
        if(p===1)return [{type:'user',sessionId:sid,timestamp:ts(),text:'Turn '+turn}];
        if(p===2)return withHelper?[{type:'toolCall',sessionId:sid,timestamp:ts(),callId:h,tool:'task',phase:'start',args:{description:'Helper '+turn,prompt:'Look at f'+turn}}]:[{type:'thinking',sessionId:sid,timestamp:ts(),reasoningId:h+'-r',delta:'Thinking.'}];
        if(p===3)return withHelper?[{type:'thinking',sessionId:sid,agentId:h,timestamp:ts(),reasoningId:h+'-x',delta:'Helper looks.'}]:[];
        if(p===4)return withHelper?[{type:'toolCall',sessionId:sid,timestamp:ts(),callId:h,tool:'task',phase:'complete',output:'Helper done'}]:[];
        if(p===5)return [{type:'output',sessionId:sid,timestamp:ts(),delta:'Turn '+turn+' done.',final:true,text:'Turn '+turn+' done.'}];
        return [{type:'status',sessionId:sid,timestamp:ts(),status:'idle'}];},
      big:(sid,i)=>{const p=i%32;
        if(p===0)return [{type:'user',sessionId:sid,timestamp:ts(),text:'Big turn '+i}];
        if(p===31)return [{type:'output',sessionId:sid,timestamp:ts(),delta:'Done '+i,final:true,text:'Done '+i},{type:'status',sessionId:sid,timestamp:ts(),status:'idle'}];
        return p%2?[{type:'thinking',sessionId:sid,timestamp:ts(),reasoningId:sid+'-r'+i,delta:'Step '+i+'. '}]
          :[{type:'toolCall',sessionId:sid,timestamp:ts(),callId:sid+'-t'+i,tool:'read_file',phase:'start',args:{path:'a.ts'}},{type:'toolCall',sessionId:sid,timestamp:ts(),callId:sid+'-t'+i,tool:'read_file',phase:'complete',output:'ok'}];},
      plain:(sid,i)=>{const p=i%3;return [p===1?{type:'user',sessionId:sid,timestamp:ts(),text:'Q'+i}:p===2?{type:'output',sessionId:sid,timestamp:ts(),delta:'A'+i,final:true,text:'A'+i}:{type:'status',sessionId:sid,timestamp:ts(),status:'idle'}];},
    };
    const kind={'sim-1':'forever','sim-2':'forever','sim-3':'forever','sim-4':'denials','sim-5':'helpers','sim-6':'big','sim-7':'plain'};
    window.__ccmEmit=e;
    window.__ccmPump=async(k,only)=>{const list=only||Object.keys(kind);let n=0,f=0;
      while(n<k){for(const sid of list){if(n>=k)break;const i=step[sid]=(step[sid]||0)+1;for(const x of ev[kind[sid]](sid,i)){e(x);n++;}
        if(Math.floor(n/250)>f){f=Math.floor(n/250);await new Promise(r=>requestAnimationFrame(()=>r()));}}}
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));return n;};})()`);
  const sizes = () => js('window.__durbarSimUi.chatSizes()');
  const of = (all, id) => all.find((x) => x.id === id) || {};

  // set-up: sim-2's tool call that never ends; sim-3's helper that never ends; sim-7's fresh-session note (idle, compacted once, 95% full)
  await js(`(()=>{const e=window.__ccmEmit,t=Date.now();
    e({type:'toolCall',sessionId:'sim-2',timestamp:t,callId:'sim-2-long',tool:'run_in_terminal',phase:'start',args:{command:'npm run watch'}});
    e({type:'toolCall',sessionId:'sim-3',timestamp:t,callId:'sim-3-helper',tool:'task',phase:'start',args:{description:'A long helper',prompt:'Keep going'}});
    e({type:'status',sessionId:'sim-7',timestamp:t,status:'idle'});
    e({type:'compaction',sessionId:'sim-7',timestamp:t,phase:'complete',trigger:'auto',tokensBefore:90000,tokensAfter:40000});
    e({type:'status',sessionId:'sim-7',timestamp:t,status:'idle'});
    e({type:'context',sessionId:'sim-7',timestamp:t,tokens:95000,limit:100000});})()`);
  await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())))');
  const set = await sizes();
  assert.strictEqual(of(set, 'sim-2').actId, 'sim-2-long', 'set-up: the waiting line names the long tool call');
  assert.ok(of(set, 'sim-7').freshNote, 'set-up: sim-7 shows the fresh-session note');
  // mark that note (its chat open for a moment): at the end the same element must still be there, not a new one
  await js(`window.__durbarSimUi.crew.openPanel('sim-7')`);
  assert.ok(await ctx.waitFor(`!!document.querySelector('#chat .note.fresh')`, 5000), 'set-up: the fresh-session note is in the open chat');
  await js(`document.querySelector('#chat .note.fresh').dataset.ccm='first'`);

  // fill: every pumped chat first reaches its caps (some need more events than others), so the warm-up and the load see the plateau
  const ids = ['sim-1', 'sim-2', 'sim-3', 'sim-4', 'sim-5', 'sim-6', 'sim-7'];
  let fill = 0;
  // CCM_FILL=0: no fill (the numbers before the fix, where no chat ever reaches a cap)
  for (; process.env.CCM_FILL !== '0' && fill < 60000; fill += 1000) { const z = await sizes(); if (process.env.CCM_LOG) console.log('[chat-memory] fill ' + fill + ' ' + ids.map((id) => id + ':' + of(z, id).trimmed + '/' + of(z, id).messages + '/' + of(z, id).leaves).join(' ')); if (ids.every((id) => of(z, id).trimmed > 0)) break; await js('window.__ccmPump(1000)'); }
  assert.ok(process.env.CCM_FILL === '0' || fill < 60000, 'every pumped chat reached its caps in the fill');
  await js(`window.__ccmPump(${jsLiteral(WARM)})`);
  const a = await sample();
  const t0 = Date.now();
  await js(`window.__ccmPump(${jsLiteral(LOAD)})`);
  const b = await sample();
  const grow = { nodes: b.nodes - a.nodes, listeners: b.listeners - a.listeners, heapMB: Math.round((b.heapMB - a.heapMB) * 10) / 10 };
  const all = await sizes();
  const pumped = all.filter((s) => ids.includes(s.id)).map((s) => ({ id: s.id, messages: s.messages, blocks: s.blocks, leaves: s.leaves, trimmed: s.trimmed, denials: s.denials, subBlocksMax: s.subBlocksMax, subViews: s.subViews, staleViews: s.staleViews }));
  console.log('[chat-memory] ' + JSON.stringify({ world: WORLD || 'flat', fill, warm: WARM, load: LOAD, loadMs: Date.now() - t0, after: a, end: b, growth: grow, chats: pumped }));

  // the caps, and no reference to a removed block or helper view
  assert.strictEqual(pumped.length, 7, 'the seven pumped agents each have a chat');
  for (const s of all) {
    assert.ok(s.messages <= CAP.messages, `${s.id}: at most ${CAP.messages} messages in its chat, has ${s.messages}`);
    assert.ok(s.blocks <= CAP.blocks, `${s.id}: at most ${CAP.blocks} blocks in its open turn, has ${s.blocks}`);
    assert.ok(s.subBlocksMax <= CAP.blocks, `${s.id}: at most ${CAP.blocks} blocks in a running helper's timeline, has ${s.subBlocksMax}`);
    assert.ok(s.leaves <= CAP.budget, `${s.id}: at most ${CAP.budget} blocks in the whole chat, has ${s.leaves}`);
    assert.strictEqual(s.stale, 0, `${s.id}: the open turn keeps no reference to a removed chip or thinking block`);
    assert.ok(s.chipRefs <= s.chipsInTurn, `${s.id}: the turn's chip references (${s.chipRefs}) are chips still in it (${s.chipsInTurn})`);
    assert.strictEqual(s.staleViews, 0, `${s.id}: no helper keeps a view of a removed block (${s.staleViews})`);
    assert.strictEqual(s.subBlockGone, 0, `${s.id}: no helper keeps its removed block (${s.subBlockGone})`);
    assert.ok(s.actIn, `${s.id}: the waiting line names a tool still in the turn (${s.actId})`);
  }
  for (const id of ['sim-1', 'sim-2', 'sim-3']) { const s = of(all, id); assert.ok(s.blocks >= CAP.blocks - 5 && s.trimmed > 0, `${id}: its never-ending turn was trimmed to the cap (${s.blocks} blocks, ${s.trimmed} removed)`); }
  assert.ok(of(all, 'sim-3').subBlocksMax >= CAP.blocks - 5, `sim-3: its running helper's timeline reached the cap and was trimmed (${of(all, 'sim-3').subBlocksMax})`);
  assert.notStrictEqual(of(all, 'sim-2').actId, 'sim-2-long', 'sim-2: the long call\'s chip went, and the waiting line no longer names it');
  for (const id of ['sim-4', 'sim-5', 'sim-7']) { const s = of(all, id); assert.ok(s.messages >= CAP.messages - 5 && s.trimmed > 0, `${id}: its chat was trimmed to the cap (${s.messages} messages, ${s.trimmed} removed)`); }
  { const s = of(all, 'sim-4'); assert.ok(s.denials > 10 && s.denials < 200 && s.denialButtons <= 1, `sim-4: Read-only denials are trimmed like any message, the newest keeps its button (${s.denials} denials, ${s.denialButtons} buttons)`); }
  { const s = of(all, 'sim-6'); assert.ok(s.leaves <= CAP.budget && s.leaves > CAP.budget - 60 && s.messages < CAP.messages - 50, `sim-6: long closed turns are held by the budget (${s.leaves} blocks in ${s.messages} messages)`); }
  { const s = of(all, 'sim-5'); assert.ok(s.subViews < 30, `sim-5: the trimmed helpers' views are gone (${s.subViews} left of 60)`); }
  assert.strictEqual(of(all, 'sim-7').freshMark, 'first', 'sim-7: the first fresh-session note stays through the trims (a live card), and no other was added');
  for (const id of ids) assert.ok(LINE.test(of(all, id).note), `${id}: the first line says earlier messages and steps are not kept: "${of(all, id).note}"`);

  // the growth after the warm-up
  assert.ok(grow.nodes < MAX_NODES, `nodes grew by ${grow.nodes} over ${LOAD} events (limit ${MAX_NODES})`);
  assert.ok(grow.listeners < MAX_LISTENERS, `listeners grew by ${grow.listeners} over ${LOAD} events (limit ${MAX_LISTENERS})`);
  assert.ok(grow.heapMB < MAX_HEAP_MB, `the JS heap grew by ${grow.heapMB} MB over ${LOAD} events (limit ${MAX_HEAP_MB})`);

  // a saved note on a reply whose text repeats (sim-4): after more trims its marker is still on that same reply
  { const o = await js(`(()=>{try{return window.__durbarSimUi.crew.openPanel('sim-4')}catch(e){return String(e&&e.stack).slice(0,600)}})()`); assert.strictEqual(o, true, 'the chat of sim-4 opens: ' + o); }
  assert.ok(await ctx.waitFor(`!!document.querySelector('#chat > .chat-inner > .chat-trim')&&document.querySelectorAll('#chat .msg.agent .bubble > .nt-btn').length>20`, 8000), 'sim-4: the open chat shows the line and finished replies');
  const n0 = await js('window.__durbarSimUi.notes.all().length');
  const pick = await js(`(()=>{const bs=[...document.querySelectorAll('#chat .msg.agent .bubble')].filter(b=>b.querySelector(':scope > .nt-btn')&&b.textContent.includes(${jsLiteral('Done, all green.')}));const b=bs[bs.length-5];if(!b)return {at:-1,same:bs.length,btns:document.querySelectorAll('#chat .msg.agent .bubble > .nt-btn').length,sample:[...document.querySelectorAll('#chat .msg.agent .bubble')].slice(-3).map(x=>x.textContent.slice(0,60))};b.dataset.ccmNote='1';
    const all=[...document.querySelectorAll('#chat .chat-inner .msg.agent .bubble')];return {at:all.indexOf(b),same:bs.length};})()`);
  assert.ok(pick.at >= 0, 'sim-4: five finished replies with the same text: ' + JSON.stringify(pick));
  await js(`window.__durbarSimUi.notes.saveMsg(document.querySelector('[data-ccm-note="1"] > .nt-btn'))`);
  assert.ok(await ctx.waitFor(`window.__durbarSimUi.notes.all().length>${jsLiteral(n0)}`, 5000), 'sim-4: the reply was saved to notes');
  const gone0 = (of(await sizes(), 'sim-4').ordGone || {}).agent || 0;
  const saved = await js(`(()=>{const n=window.__durbarSimUi.notes.all();return n[n.length-1].source;})()`);
  assert.strictEqual(saved.ord, gone0 + pick.at, `sim-4: the note's place counts the replies a trim removed (${gone0} + ${pick.at})`);
  await js(`window.__ccmPump(100,['sim-4'])`);
  const marks = await js(`new Promise(r=>setTimeout(()=>{const m=[...document.querySelectorAll('#chat .msg.agent .bubble')].filter(b=>b.querySelector(':scope > .nt-mark'));r({n:m.length,same:m.length===1&&m[0].dataset.ccmNote==='1'});},300))`);
  const gone1 = (of(await sizes(), 'sim-4').ordGone || {}).agent || 0;
  console.log('[chat-memory] note: ' + JSON.stringify({ pick, saved: saved.ord, gone0, gone1, marks }));
  assert.ok(gone1 > gone0, 'sim-4: more replies were trimmed after the save');
  assert.ok(marks.same, `sim-4: the saved note marks the same reply after the trims (${marks.n} marked)`);

  // an open chat, scrolled up: the line is readable, a trim does not move what the person reads (scroll anchoring on, as people have it,
  // then off: Chromium's anchoring alone would hide a missing keep-the-place step), and a frame that adds no block costs nothing
  assert.ok(await js(`window.__durbarSimUi.crew.openPanel('sim-1')`), 'the chat of sim-1 opens');
  assert.ok(await ctx.waitFor(`!!document.querySelector('#chat > .chat-inner > .chat-trim')`, 5000), 'the open chat shows the line');
  const font = await js(`parseFloat(getComputedStyle(document.querySelector('#chat .chat-trim')).fontSize)`);
  assert.ok(font >= 10.5, `the line's text is at least 10.5px, is ${font}`);
  for (const anchoring of ['auto', 'none']) {
    const before = await js(`new Promise(r=>{const c=document.getElementById('chat');c.style.overflowAnchor=${jsLiteral(anchoring)};c.scrollTop=Math.round(c.scrollHeight/2);c.dispatchEvent(new Event('scroll'));
      requestAnimationFrame(()=>{c.scrollTop=Math.round(c.scrollHeight/2)-1;c.dispatchEvent(new Event('scroll'));requestAnimationFrame(()=>{
        c.querySelectorAll('[data-ccm-mark]').forEach(x=>delete x.dataset.ccmMark);
        const top=c.getBoundingClientRect().top,el=[...c.querySelectorAll('.chat-inner .tl > *')].find(x=>x.getBoundingClientRect().bottom>top+40);
        el.dataset.ccmMark='1';r({pin:c.dataset.pin,y:Math.round(el.getBoundingClientRect().top),scroll:c.scrollTop});});});})`);
    assert.strictEqual(before.pin, '0', `anchoring ${anchoring}: the chat counts as scrolled up`);
    await js(`window.__ccmPump(40,['sim-1'])`);
    const after = await js(`(()=>{const c=document.getElementById('chat'),el=c.querySelector('[data-ccm-mark="1"]');return el?{pin:c.dataset.pin,y:Math.round(el.getBoundingClientRect().top),scroll:c.scrollTop,trim:c.querySelector('.chat-trim').textContent}:null;})()`);
    console.log('[chat-memory] scrolled up, anchoring ' + anchoring + ': ' + JSON.stringify({ before, after }));
    assert.ok(after, `anchoring ${anchoring}: the block in view is still in the chat`);
    assert.ok(after.scroll !== before.scroll, `anchoring ${anchoring}: blocks above it were removed (the chat scrolled to keep it)`);
    assert.ok(Math.abs(after.y - before.y) <= 2, `anchoring ${anchoring}: the block in view stays where it was: ${before.y} -> ${after.y}`);
    assert.strictEqual(after.pin, '0', `anchoring ${anchoring}: the chat is still scrolled up (a trim does not jump to the end)`);
  }
  // the waiting line: a tool call that never ends, in a chip row that is no longer the live one, then only new thinking blocks until
  // its row is trimmed: the line must not name the removed chip (tActNext names the next running one, or none)
  await js(`(async()=>{const e=window.__ccmEmit,t=()=>Date.now(),s='sim-1';
    e({type:'toolCall',sessionId:s,timestamp:t(),callId:'sim-1-long2',tool:'run_in_terminal',phase:'start',args:{command:'npm run serve'}});
    e({type:'thinking',sessionId:s,timestamp:t(),reasoningId:'sim-1-gap',delta:'Gap. '});
    e({type:'toolCall',sessionId:s,timestamp:t(),callId:'sim-1-x',tool:'read_file',phase:'start',args:{path:'b.ts'}});
    e({type:'toolCall',sessionId:s,timestamp:t(),callId:'sim-1-x',tool:'read_file',phase:'complete',output:'ok'});
    await new Promise(r=>requestAnimationFrame(()=>r()));})()`);
  const act0 = of(await sizes(), 'sim-1');
  assert.strictEqual(act0.actId, 'sim-1-long2', 'the waiting line names the long call while its chip is in the turn');
  await js(`(async()=>{for(let i=0;i<400;i++){window.__ccmEmit({type:'thinking',sessionId:'sim-1',timestamp:Date.now(),reasoningId:'sim-1-only'+i,delta:'Only thinking '+i+'. '});if(i%50===49)await new Promise(r=>requestAnimationFrame(()=>r()));}await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));})()`);
  const act1 = of(await sizes(), 'sim-1');
  console.log('[chat-memory] waiting line: ' + JSON.stringify({ before: act0.actId, after: act1.actId, actIn: act1.actIn }));
  assert.ok(act1.actId !== 'sim-1-long2' && act1.actIn, `the long call's chip went: the waiting line no longer names it (${act1.actId})`);
  // FR-238: text streaming into the same thinking block adds no block: a chat at its caps takes the cheap path, nothing measured
  await js(`(()=>{window.__ccmEmit({type:'thinking',sessionId:'sim-1',timestamp:Date.now(),reasoningId:'sim-1-same',delta:'One. '});})()`);
  await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())))');
  const s0 = of(await sizes(), 'sim-1');
  await js(`(async()=>{for(let i=0;i<60;i++){window.__ccmEmit({type:'thinking',sessionId:'sim-1',timestamp:Date.now(),reasoningId:'sim-1-same',delta:'More '+i+'. '});await new Promise(r=>requestAnimationFrame(()=>r()));}})()`);
  const s1 = of(await sizes(), 'sim-1');
  console.log('[chat-memory] streaming: ' + JSON.stringify({ slow: [s0.slow, s1.slow], measured: [s0.measured, s1.measured], blocks: [s0.blocks, s1.blocks] }));
  assert.strictEqual(s1.blocks, s0.blocks, 'the streaming added no block');
  assert.strictEqual(s1.slow, s0.slow, `60 frames of streaming in a chat at its caps take the cheap path (slow path ${s1.slow - s0.slow} times)`);
  assert.strictEqual(s1.measured, s0.measured, 'and measure nothing');
  await js(`window.__durbarSimUi.crew.openPanel('sim-4')`);
  await js(`(()=>{window.__ccmEmit({type:'thinking',sessionId:'sim-4',timestamp:Date.now(),reasoningId:'sim-4-same',delta:'One. '});})()`);
  await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())))');
  const q0 = of(await sizes(), 'sim-4');
  await js(`(async()=>{for(let i=0;i<60;i++){window.__ccmEmit({type:'thinking',sessionId:'sim-4',timestamp:Date.now(),reasoningId:'sim-4-same',delta:'More '+i+'. '});await new Promise(r=>requestAnimationFrame(()=>r()));}})()`);
  const q1 = of(await sizes(), 'sim-4');
  console.log('[chat-memory] streaming at the message cap: ' + JSON.stringify({ messages: q1.messages, slow: [q0.slow, q1.slow] }));
  assert.ok(q1.messages >= CAP.messages - 1, 'sim-4 is at its message cap');
  assert.strictEqual(q1.slow, q0.slow, `a chat at its message cap (and its line) takes the cheap path while text streams (slow path ${q1.slow - q0.slow} times)`);
  // review round 2: a burst with no frame between (a closed turn of 2,600 calls, then the question's answer) must never empty the chat:
  // the newest two messages stay, and the giant one loses only its oldest blocks
  const burst = await js(`(()=>{const e=window.__ccmEmit,s='sim-6',t=()=>Date.now();
    e({type:'user',sessionId:s,timestamp:t(),text:'Q-BIG'});
    for(let i=0;i<1300;i++){e({type:'thinking',sessionId:s,timestamp:t(),reasoningId:'big-r'+i,delta:'Step '+i+'. '});
      e({type:'toolCall',sessionId:s,timestamp:t(),callId:'big-t'+i,tool:'read_file',phase:'start',args:{path:'f'+i+'.ts'}});
      e({type:'toolCall',sessionId:s,timestamp:t(),callId:'big-t'+i,tool:'read_file',phase:'complete',output:'ok'});}
    e({type:'output',sessionId:s,timestamp:t(),delta:'FINAL-REPLY-MARK',final:true,text:'FINAL-REPLY-MARK'});
    e({type:'status',sessionId:s,timestamp:t(),status:'idle'});
    for(let i=0;i<2;i++)e({type:'compaction',sessionId:s,timestamp:t(),phase:'complete',trigger:'truncation',tokensBefore:90000,tokensAfter:40000}); /* two notes after the reply (round 3): they must not use up the protection */
    const before=window.__durbarSimUi.chatSizes().find(x=>x.id===s).lastIsNote;
    const removed=window.__durbarSimUi.chatTrimNow();
    const z=window.__durbarSimUi.chatSizes().find(x=>x.id===s);return {removed,notesBefore:before,messages:z.messages,leaves:z.leaves,lastUser:z.lastUser,lastAgent:z.lastAgent};})()`);
  console.log('[chat-memory] burst with no frame: ' + JSON.stringify(burst));
  assert.ok(burst.removed > 0, 'the burst was trimmed');
  assert.ok(burst.notesBefore, 'before the trim the chat ended with notes after the reply (they may go: only `.msg` elements are protected)');
  assert.ok(burst.messages >= 2 && burst.lastUser === 'Q-BIG' && burst.lastAgent.includes('FINAL-REPLY-MARK'), `the question and the final reply stay (${burst.messages} messages, "${burst.lastUser}", "${burst.lastAgent}")`);
  assert.ok(burst.leaves <= CAP.budget, `sim-6 within the budget after the burst (${burst.leaves})`);

  // a hidden window draws no frame: the slow timer trims what grows meanwhile, and stops when the window shows again
  ctx.win.hide();
  const realHide = await H.until('document.hidden', 3000);
  // no window manager (Xvfb): the page is not hidden by hide(); then the page's own signals stand in: document.hidden is true and
  // requestAnimationFrame queues its callbacks without running them (they run when the window "shows" again)
  if (!realHide) await js(`(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});const real=window.requestAnimationFrame.bind(window),q=[];
    window.__ccmRaf={real,q};window.requestAnimationFrame=cb=>{q.push(cb);return 1e9+q.length;};document.dispatchEvent(new Event('visibilitychange'));})()`);
  console.log('[chat-memory] hidden: ' + (realHide ? 'a real hide (no frames)' : 'emulated: document.hidden and no frames (the window manager did not hide it)'));
  const h0 = of(await sizes(), 'sim-7');
  await js(`(()=>{const e=window.__ccmEmit,s='sim-7',t=()=>Date.now();for(let i=0;i<400;i++){e({type:'user',sessionId:s,timestamp:t(),text:'HQ'+i});e({type:'output',sessionId:s,timestamp:t(),delta:'HA'+i,final:true,text:'HA'+i});e({type:'status',sessionId:s,timestamp:t(),status:'idle'});}})()`);
  const timerOn = await js('window.__durbarSimUi.hiddenTrimTimer().on');
  await ctx.sleep(1500);
  const h1 = of(await sizes(), 'sim-7');
  console.log('[chat-memory] hidden window: ' + JSON.stringify({ timerOn, messages: [h0.messages, h1.messages], hiddenRuns: [h0.hiddenRuns, h1.hiddenRuns], runs: [h0.runs, h1.runs] }));
  assert.ok(timerOn, 'an append while hidden starts the slow timer');
  assert.ok(h1.hiddenRuns > h0.hiddenRuns && h1.messages <= CAP.messages, `the timer trimmed sim-7 while hidden (${h1.messages} messages, ${h1.hiddenRuns - h0.hiddenRuns} timer passes)`);
  assert.strictEqual(h1.runs - h0.runs, h1.hiddenRuns - h0.hiddenRuns, 'every trim while hidden came from the timer (no frame ran)');
  await ctx.sleep(1000);
  assert.strictEqual(await js('window.__durbarSimUi.hiddenTrimTimer().on'), false, 'with nothing added, the timer stops by itself');
  ctx.win.show();
  if (!realHide) await js(`(()=>{delete document.hidden;const r=window.__ccmRaf;window.requestAnimationFrame=r.real;r.q.splice(0).forEach(cb=>r.real(cb));document.dispatchEvent(new Event('visibilitychange'));})()`);
  assert.ok(await H.until('!document.hidden', 3000), 'the window shows again');
  console.log('[chat-memory] ok');
};
