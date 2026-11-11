/*
 * A parent keeps its newest finished helpers (spec 005 FR-240, FR-241, issue 1418). With the simulator frozen, events go at full speed
 * through the normal event path (`__durbarSimEmit`) to sim-1: one open turn (it never ends) that holds a helper that never ends
 * ("keep-run"), then helpers of CHR_EVENTS events each (thinking, a tool call, its result, text), one in seven failing. The page's heap
 * is collected twice before each sample; then Performance.getMetrics (Nodes, JSEventListeners) and Runtime.getHeapUsage, at each
 * total of CHR_PHASES helpers (default 300,600). It fails when, from the first total to the last, nodes, listeners or the heap grow past a
 * limit set from the measured plateau (spec 005, 2026-11-10 delta); when sim-1 keeps more than 50 done or 20 failed helpers in its
 * record or its cards (helpersOf); when the running helper, the open one or the one holding the focus is retired (and when, let go, the
 * next end does not retire them); when a retired helper's card, record, own chat or view is still reachable; when a late event for a
 * retired helper makes a record, a card or a block, or does not add its usage to the parent; when a helper's view is still in a chat's
 * subViews right after its retirement (read in the same task); when one held by a text selection or an open message menu is retired; when a retired block keeps a body, an Open button or any button; when the line
 * "N earlier helpers are not kept in this view" is missing, wrong, doubled or under 10.5px; and, at 1440x900 and 1280x800, when the
 * office shows sim-1's helpers (heads or tiles plus "+K", or the plate's count words) as other than the kept ones, scrolls, or a helper
 * part leaves the window or covers another desk.
 * CHR_WORLD=real|retro runs it with the Real office or the Retro arcade on. CHR_MEASURE=1 only prints the table (no retirement assertions:
 * the "before" numbers, on a build without the retirement, e.g. CHR_PHASES=50,100,200).
 * Simulator only, no credits:
 *
 *   npm run build
 *   DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 DURBAR_DRIVER=$PWD/scripts/check-helper-retention.js xvfb-run -a npx electron . --no-sandbox
 */
'use strict';
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

// limits for the helpers between the first and the last total (300 more helpers of 500 events), from the plateau measured with the
// retirement on, with a margin (numbers: spec 005, 2026-11-10 delta, FR-241)
const MAX_NODES = 20000, MAX_LISTENERS = 300, MAX_HEAP_MB = 3;
const KEEP = { done: 50, failed: 20 }; // src/renderer/subretire.js SUB_KEEP (checked against the page below)
const WORLD = process.env.CHR_WORLD || '';
const MEASURE = process.env.CHR_MEASURE === '1';
const PHASES = (process.env.CHR_PHASES || '300,600').split(',').map(Number).filter((n) => n > 0);
const EVENTS = Math.max(4, Number(process.env.CHR_EVENTS) || 500);
const FRAME = Math.max(50, Number(process.env.CHR_FRAME) || 1000); // events between two frames (each frame trims and draws, as stickyFlush and a render would)
const FAIL_EVERY = 7; // one helper in seven fails
// with the retirement on, what the first total leaves is its newest 50 done and 20 failed helpers, the running ones, one-line stubs and the
// ring of retired ids: helpers older than the newest 20 failed (one in seven fails, so the last 140 helpers, plus a margin) only become
// stubs, so they are pumped short (4 events) to save minutes; every helper kept at the first total, and every helper after it, is full.
// CHR_MEASURE pumps every helper full.
const SHORT = MEASURE ? 0 : Math.max(0, (PHASES[0] || 0) - KEEP.failed * FAIL_EVERY - 20);
const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
const NOTE = /^([\d,]+) earlier helpers? (?:is|are) not kept in this view$/;
const SID = 'sim-1';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const query = WORLD === 'real' ? { officeview: 'real' } : WORLD === 'retro' ? { officeview: 'real', worldflags: 'retro', world: 'retro' } : {};
  await H.load({ w: 1440, h: 900, query, ...(WORLD ? { ready: REAL, settle: false } : {}) });
  const wc = ctx.win.webContents;
  const d = wc.debugger;
  if (!d.isAttached()) d.attach('1.3');
  await d.sendCommand('Performance.enable');
  const frames = () => js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())))');
  const sample = async () => {
    await frames();
    await d.sendCommand('HeapProfiler.collectGarbage');
    await d.sendCommand('HeapProfiler.collectGarbage');
    const h = await d.sendCommand('Runtime.getHeapUsage');
    const m = await d.sendCommand('Performance.getMetrics');
    const g = (n) => (m.metrics.find((x) => x.name === n) || {}).value || 0;
    return { nodes: g('Nodes'), listeners: g('JSEventListeners'), heapMB: Math.round(h.usedSize / 1048576 * 10) / 10 };
  };
  if (WORLD) assert.strictEqual(await js(`document.getElementById('stage').dataset.d`), 'real', `the ${WORLD} world is on`);
  const hasStats = await js('!!(window.__durbarSimUi&&window.__durbarSimUi.helperStats)');
  if (!MEASURE) assert.ok(hasStats, 'the page has the helper stats hook (a build with FR-240)');
  const stats = () => js(`window.__durbarSimUi.helperStats(${jsLiteral(SID)})`);
  // what any build can count: the parent's records and the events their logs hold
  const raw = () => js(`(()=>{const a=window.__durbarSimUi.agents().find(x=>x.id===${jsLiteral(SID)});const subs=a&&a.subs?[...a.subs.values()]:[];
    return {subs:subs.length,log:subs.reduce((n,s)=>n+(s.log?s.log.length:0),0),cards:window.__durbarSimUi.agents().filter(x=>x.parent===${jsLiteral(SID)}).length,blocks:document.querySelectorAll('.subblk').length};})()`);

  // the pump: helpers of EVENTS events each in sim-1's open turn, a frame every 250 events (stickyFlush runs as it would)
  await js(`(()=>{const e=window.__durbarSimEmit;if(!e)throw new Error('no __durbarSimEmit');const sid=${jsLiteral(SID)},ts=()=>Date.now();let n=0,f=0,k=0;
    const F=${jsLiteral(FRAME)},tick=async()=>{n++;if(Math.floor(n/F)>f){f=Math.floor(n/F);await new Promise(r=>requestAnimationFrame(()=>r()));}};
    window.__chrEmit=e;
    window.__chrHelper=async(id,fail,E)=>{
      e({type:'toolCall',sessionId:sid,timestamp:ts(),callId:id,tool:'task',phase:'start',args:{description:'Helper '+id,prompt:'Look at '+id}});await tick();
      for(let i=0;i<E-2;i++){const p=i%4;
        e(p===0?{type:'thinking',sessionId:sid,agentId:id,timestamp:ts(),reasoningId:id+'-r'+i,delta:'Helper step '+i+'. '}
          :p===1?{type:'toolCall',sessionId:sid,agentId:id,timestamp:ts(),callId:id+'-t'+i,tool:'read_file',phase:'start',args:{path:'src/f'+(i%9)+'.ts'}}
          :p===2?{type:'toolCall',sessionId:sid,agentId:id,timestamp:ts(),callId:id+'-t'+(i-1),tool:'read_file',phase:'complete',output:'120 lines'}
          :{type:'output',sessionId:sid,agentId:id,timestamp:ts(),delta:'Checked '+i+'.',final:true,text:'Checked '+i+'.'});await tick();}
      e(fail?{type:'toolCall',sessionId:sid,timestamp:ts(),callId:id,tool:'task',phase:'failed',output:'Helper '+id+' failed'}
        :{type:'toolCall',sessionId:sid,timestamp:ts(),callId:id,tool:'task',phase:'complete',output:'Helper '+id+' done'});await tick();};
    window.__chrPump=async(count,short)=>{for(let j=0;j<count;j++){k++;await window.__chrHelper('h'+k,k%${jsLiteral(FAIL_EVERY)}===0,k<=(short||0)?4:${jsLiteral(EVENTS)});}
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));return k;};
    e({type:'user',sessionId:sid,timestamp:ts(),text:'Spread the work over helpers'});
    e({type:'toolCall',sessionId:sid,timestamp:ts(),callId:'keep-run',tool:'task',phase:'start',args:{description:'A helper that never ends',prompt:'Keep going'}});
    e({type:'thinking',sessionId:sid,agentId:'keep-run',timestamp:ts(),reasoningId:'kr',delta:'Still going. '});})()`);
  await frames();
  if (!MEASURE) assert.deepStrictEqual((await stats()).keep, KEEP, 'the page keeps the limits this check expects');

  // the table: a sample at each total
  const table = [];
  let total = 0;
  table.push({ helpers: 0, ...(await sample()), ...(await raw()) });
  for (const want of PHASES) {
    const t0 = Date.now();
    await js(`window.__chrPump(${jsLiteral(want - total)},${jsLiteral(SHORT)})`);
    total = want;
    table.push({ helpers: total, events: EVENTS, short: total === PHASES[0] ? SHORT : 0, ms: Date.now() - t0, ...(await sample()), ...(await raw()), ...(hasStats ? await (async () => { const z = await stats(); const c = (await js('window.__durbarSimUi.chatSizes()')).find((x) => x.id === SID) || {}; return { kept: z.subs, gone: z.gone, stubs: z.stubs, fullBlocks: z.blocks, turnBlocks: c.blocks, leaves: c.leaves, messages: c.messages }; })() : {}) });
  }
  console.log('[helper-retention] ' + JSON.stringify({ world: WORLD || 'flat', measure: MEASURE, table }));
  for (const r of table) console.log(`[helper-retention] | ${r.helpers} | ${r.events || ''} | ${r.ms || ''} ms | ${r.nodes} | ${r.listeners} | ${r.heapMB} MB | ${r.log} | ${r.subs} | ${r.cards} |`);
  if (MEASURE) { console.log('[helper-retention] measure only: ok'); return; }

  // the plateau
  const first = table[1], last = table[table.length - 1];
  const grow = { nodes: last.nodes - first.nodes, listeners: last.listeners - first.listeners, heapMB: Math.round((last.heapMB - first.heapMB) * 10) / 10 };
  console.log('[helper-retention] growth ' + JSON.stringify({ from: first.helpers, to: last.helpers, grow }));
  assert.ok(PHASES.length >= 2, 'at least two totals to compare');
  assert.ok(grow.nodes < MAX_NODES, `nodes grew by ${grow.nodes} over ${last.helpers - first.helpers} helpers (limit ${MAX_NODES})`);
  assert.ok(grow.listeners < MAX_LISTENERS, `listeners grew by ${grow.listeners} (limit ${MAX_LISTENERS})`);
  assert.ok(grow.heapMB < MAX_HEAP_MB, `the JS heap grew by ${grow.heapMB} MB (limit ${MAX_HEAP_MB})`);

  // what sim-1 keeps
  const checkKept = async (tag) => {
    const s = await stats();
    assert.ok(s.done <= KEEP.done && s.failed <= KEEP.failed, `${tag}: at most ${KEEP.done} done and ${KEEP.failed} failed kept (${s.done}, ${s.failed})`);
    assert.ok(s.helpers === s.subs && s.cards === s.subs, `${tag}: the cards (helpersOf) are the kept records (${s.helpers}, ${s.cards}, ${s.subs})`);
    assert.ok(s.running.includes('keep-run'), `${tag}: the running helper is never retired`);
    assert.deepStrictEqual(s.orphans, [], `${tag}: every kept record has its card in the office`);
    for (const k of ['staleCards', 'staleChats', 'staleViews', 'retiredLeft']) assert.strictEqual(s[k], 0, `${tag}: no retired helper is reachable (${k} ${s[k]})`);
    assert.ok(s.retiredSeen > 0 && s.gone > 0 && s.ring === Math.min(s.gone, 500), `${tag}: helpers were retired (${s.gone}, ring ${s.ring})`);
    const m = NOTE.exec(s.note);
    assert.ok(m && Number(m[1].replace(/,/g, '')) === s.gone && s.notes === 1, `${tag}: one line "${s.gone} earlier helpers are not kept in this view": "${s.note}" (${s.notes})`);
    assert.ok(s.stubs > 0 && s.stubBodies === 0, `${tag}: retired blocks are one-line stubs (${s.stubs}, ${s.stubBodies} bodies or buttons)`);
    return s;
  };
  const s1 = await checkKept('after the pump');
  assert.strictEqual(s1.done, KEEP.done, 'the done limit is reached');
  assert.strictEqual(s1.failed, KEEP.failed, 'the failed limit is reached');

  // a late event for a retired helper: no record, card or block
  const dead = s1.goneIds[s1.goneIds.length - 1];
  const u0 = s1.usageCalls;
  const b0 = await js(`document.querySelectorAll('.subblk[data-sub="'+CSS.escape(${jsLiteral(dead)})+'"]').length`);
  await js(`(()=>{const e=window.__chrEmit,s=${jsLiteral(SID)},id=${jsLiteral(dead)},t=Date.now();
    e({type:'toolCall',sessionId:s,timestamp:t,callId:id,tool:'task',phase:'complete',output:'late'});
    e({type:'toolCall',sessionId:s,timestamp:t,callId:id,tool:'Agent',phase:'start',args:{description:'late'}});
    e({type:'subagent',sessionId:s,timestamp:t,subagentId:id,phase:'completed',name:'late'});
    e({type:'thinking',sessionId:s,agentId:id,timestamp:t,reasoningId:'late',delta:'late'});
    e({type:'usage',sessionId:s,agentId:id,timestamp:t,inputTokens:1,outputTokens:1});})()`);
  await frames();
  const s2 = await stats();
  const b1 = await js(`document.querySelectorAll('.subblk[data-sub="'+CSS.escape(${jsLiteral(dead)})+'"]').length`);
  assert.ok(!s2.ids.includes(dead) && s2.subs === s1.subs && s2.cards === s1.cards && b1 === b0, `a late event for retired ${dead} makes no record, card or block (${s2.subs}/${s1.subs}, ${s2.cards}/${s1.cards}, ${b1}/${b0})`);
  assert.strictEqual(await js(`[...document.querySelectorAll('.chip')].filter(c=>/late/.test(c.textContent)).length`), 0, 'and no chip');
  assert.strictEqual(s2.usageCalls, u0 + 1, `its late usage still adds one call to the parent's totals (${u0} -> ${s2.usageCalls})`);

  // a retirement and the reachability read in one task (no frame, so no trim has emptied the chat's helper views first): 60 short helpers
  // start and end at once, so the ones that end in this task are retired in it too; none of their views may stay in chat.subViews
  const burst = await js(`(()=>{const e=window.__chrEmit,s=${jsLiteral(SID)},t=Date.now(),g0=window.__durbarSimUi.helperStats(s).gone;
    for(let i=0;i<60;i++){const id='burst'+i;e({type:'toolCall',sessionId:s,timestamp:t,callId:id,tool:'task',phase:'start',args:{description:'Burst '+i}});
      e({type:'thinking',sessionId:s,agentId:id,timestamp:t,reasoningId:id+'-r',delta:'Burst.'});
      e({type:'output',sessionId:s,agentId:id,timestamp:t,delta:'Burst '+i+' read.',final:true,text:'Burst '+i+' read.'});
      e({type:'toolCall',sessionId:s,timestamp:t,callId:id,tool:'task',phase:'complete',output:'ok'});}
    const z=window.__durbarSimUi.helperStats(s);return {retired:z.gone-g0,burstGone:z.goneIds.filter(x=>/^burst/.test(x)).length,staleViews:z.staleViews,staleCards:z.staleCards,staleChats:z.staleChats};})()`);
  console.log('[helper-retention] burst in one task: ' + JSON.stringify(burst));
  assert.ok(burst.retired >= 60 && burst.burstGone >= 1, `the burst retired helpers that ended in the same task (${JSON.stringify(burst)})`);
  assert.ok(burst.staleViews === 0 && burst.staleCards === 0 && burst.staleChats === 0, `right after a retirement, no view, card or chat of it is reachable (${JSON.stringify(burst)})`);
  await frames();

  // the open one: a helper's full activity open is never retired; closed, the next end retires it
  const oldest = (s) => s.doneIds[0]; // the oldest done helper kept (the record's order is the order they came in); the next done end retires it
  const open = oldest(await stats()); // after the burst
  assert.ok(await js(`window.__durbarSimUi.crew.openPanel(${jsLiteral(SID + ':' + open)})`), 'the oldest kept helper opens');
  assert.ok(await H.until(`!!document.querySelector('#chat .sub-ro')`, 5000), 'its Sub-agent activity view is open');
  await js('window.__chrPump(12)');
  assert.ok((await stats()).ids.includes(open), `the open helper ${open} is not retired`);
  await checkKept('with one open');
  await js(`window.__durbarSimUi.crew.openPanel(${jsLiteral(SID)})`);
  await js('window.__chrPump(2)'); // two: at least one ends done
  assert.ok(!(await stats()).ids.includes(open), `closed, ${open} is retired by the next done end`);

  // the focused one: a button in its block holds the focus; let go, the next end retires it
  assert.ok(await H.until(`!!document.querySelector('#chat .subblk')`, 5000), 'sim-1\'s chat is open');
  await js(`new Promise(r=>{const c=document.getElementById('chat');c.scrollTop=c.scrollHeight;c.dispatchEvent(new Event('scroll'));requestAnimationFrame(()=>requestAnimationFrame(()=>r()));})`);
  const foc = oldest(await stats());
  const f0 = await js(`(()=>{const b=document.querySelector('#chat .subblk[data-sub="'+CSS.escape(${jsLiteral(foc)})+'"] .sub-toggle');if(!b)return false;b.focus({preventScroll:true});return document.activeElement===b;})()`);
  assert.ok(f0, `the block of ${foc} holds the focus`);
  await js('window.__chrPump(12)');
  assert.ok((await stats()).ids.includes(foc), `the focused helper ${foc} is not retired`);
  assert.ok(await js(`document.activeElement&&!!document.activeElement.closest('.subblk[data-sub="'+CSS.escape(${jsLiteral(foc)})+'"]')`), 'and keeps the focus');
  await js(`(()=>{const i=document.getElementById('msgInput');if(i)i.focus();else document.activeElement.blur();})()`);
  await js('window.__chrPump(2)'); // two: at least one ends done
  assert.ok(!(await stats()).ids.includes(foc), `let go, ${foc} is retired by the next done end`);

  // the selected one: a text selection over its block keeps it; cleared, the next end retires it
  const sel = oldest(await stats());
  const sl0 = await js(`(()=>{const b=document.querySelector('#chat .subblk[data-sub="'+CSS.escape(${jsLiteral(sel)})+'"] .sub-head');if(!b)return false;const r=document.createRange();r.selectNodeContents(b);const g=getSelection();g.removeAllRanges();g.addRange(r);return g.toString().length>0;})()`);
  assert.ok(sl0, `text in the block of ${sel} is selected`);
  await js('window.__chrPump(12)');
  assert.ok((await stats()).ids.includes(sel), `the selected helper ${sel} is not retired`);
  await js('getSelection().removeAllRanges()');
  await js('window.__chrPump(2)'); // two: at least one ends done
  assert.ok(!(await stats()).ids.includes(sel), `selection cleared, ${sel} is retired by the next done end`);

  // the one with an open message menu: the ⋯ of a reply inside its block opens the menu; closed, the next end retires it
  const men = oldest(await stats());
  const mn0 = await js(`(()=>{const b=document.querySelector('#chat .subblk[data-sub="'+CSS.escape(${jsLiteral(men)})+'"] .bubble > .nt-btn');if(!b)return {btn:false};b.click();const m=document.querySelector('#modeMenu.nt-menu');return {btn:true,open:!!m,anchored:!!(m&&m._anchor===b),focusOut:!!(document.activeElement&&!document.activeElement.closest('.subblk'))};})()`);
  assert.ok(mn0.btn && mn0.open && mn0.anchored && mn0.focusOut, `the menu of a reply in the block of ${men} is open, the focus in the menu: ${JSON.stringify(mn0)}`);
  await js('window.__chrPump(12)');
  assert.ok(await js(`!!document.querySelector('#modeMenu.nt-menu')`), 'the menu is still open');
  assert.ok((await stats()).ids.includes(men), `the helper ${men} with an open menu is not retired`);
  await js(`document.querySelector('#modeMenu.nt-menu').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await js(`(()=>{const i=document.getElementById('msgInput');if(i)i.focus();else document.activeElement.blur();getSelection().removeAllRanges();})()`); // Escape gives the focus back to the ⋯ (in the block): the person moves on
  assert.ok(await H.until(`!document.querySelector('#modeMenu.nt-menu')&&!(document.activeElement&&document.activeElement.closest('.subblk'))`, 3000), 'the menu is closed and the focus left the block');
  await js('window.__chrPump(2)'); // two: at least one ends done
  assert.ok(!(await stats()).ids.includes(men), `menu closed, ${men} is retired by the next done end`);
  await checkKept('after the held ones');

  // the head with the focus (spec 005 FR-242, issue 1483): in the Real office strip a head button holds the focus; it is not retired, let go it is
  if (WORLD === 'real') {
    await js(`(()=>{const b=document.getElementById('backBtn');if(b)b.click();return true;})()`); // the office, not the chat, is in view
    assert.ok(await H.until(`!document.body.classList.contains('panel-open')`, 5000), 'the office is in view');
    await frames();
    await js(`(()=>{const m=document.querySelector('#stage .ro-hstrip [data-more]');if(m&&m.getAttribute('aria-expanded')!=='true')m.click();})()`);
    assert.ok(await H.until(`document.querySelectorAll('#stage .ro-hstrip button[data-id]').length>10`, 5000), 'the strip is open (all heads)');
    const hd = oldest(await stats());
    const hq = `#stage .ro-hstrip button[data-id=${JSON.stringify(SID + ':' + hd)}]`; // a CSS string, quoted
    const h0 = await js(`(()=>{const b=document.querySelector(${jsLiteral(hq)});if(!b)return false;b.focus({preventScroll:true});return document.activeElement===b;})()`);
    assert.ok(h0, `the head of ${hd} in the strip holds the focus`);
    await js('window.__chrPump(12)'); await frames();
    assert.ok((await stats()).ids.includes(hd), `the helper ${hd} whose head holds the focus is not retired`);
    assert.ok(await js(`document.activeElement===document.querySelector(${jsLiteral(hq)})`), 'and its head keeps the focus');
    await js(`(()=>{const i=document.getElementById('msgInput');if(i)i.focus();else document.activeElement.blur();})()`);
    await js('window.__chrPump(2)');
    assert.ok(!(await stats()).ids.includes(hd), `let go, ${hd} is retired by the next done end`);
    await checkKept('after the head');
    await js(`(()=>{const m=document.querySelector('#stage .ro-hstrip [data-more]');if(m&&m.getAttribute('aria-expanded')==='true')m.click();})()`); // fold the strip again (the office checks below read it closed)
    await js(`window.__durbarSimUi.crew.openPanel(${jsLiteral(SID)})`); // the chat again, for the line below
    assert.ok(await H.until(`!!document.querySelector('#chat .sub-gone')`, 5000), "sim-1's chat is open again");
  }

  // the line, readable in the open chat
  await js(`new Promise(r=>{const c=document.getElementById('chat');c.scrollTop=0;requestAnimationFrame(()=>r());})`);
  const line = await js(`(()=>{const n=document.querySelector('#chat .sub-gone');if(!n)return null;const cs=getComputedStyle(n),r=n.getBoundingClientRect();return {text:n.textContent,fs:parseFloat(cs.fontSize),w:r.width,h:r.height,shown:cs.display!=='none'&&cs.visibility!=='hidden'};})()`);
  console.log('[helper-retention] line: ' + JSON.stringify(line));
  assert.ok(line && NOTE.test(line.text) && line.fs >= 10.5 && line.w > 0 && line.h > 0 && line.shown, `the line is shown, at least 10.5px: ${JSON.stringify(line)}`);
  assert.ok(await js(`document.querySelectorAll('#chat .subblk.stub').length>0`), 'the open chat shows at least one #chat .subblk.stub before the stub checks');
  const stubFs = await js(`(()=>{const n=document.querySelector('#chat .subblk.stub .sub-task');return n?parseFloat(getComputedStyle(n).fontSize):0;})()`);
  assert.ok(stubFs >= 10.5, `a stub's text is at least 10.5px (${stubFs})`);
  assert.ok(await js(`document.querySelector('#chat .subblk.stub')?document.querySelector('#chat .subblk.stub').getBoundingClientRect().height<60:false`), 'a stub is one line');

  // the office at both sizes: sim-1's helpers shown are the kept ones; no scroll, nothing outside the window or over another desk
  const closeBtn = `(()=>{const b=document.getElementById('backBtn');if(b)b.click();return true;})()`;
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await js(closeBtn);
    ctx.win.setContentSize(w, h);
    assert.ok(await H.until(`innerWidth===${jsLiteral(w)}&&innerHeight===${jsLiteral(h)}&&!document.body.classList.contains('panel-open')`, 5000), `${w}x${h}: the window and the office`);
    await js('window.__durbarSimUi.settleNow?window.__durbarSimUi.settleNow():0');
    await frames();
    const s = await stats();
    const o = await js(`(()=>{const id=${jsLiteral(SID)},q=s=>document.querySelector(s),box=e=>{const r=e.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height};};
      const doc=document.scrollingElement,fl=q('#floor');const out={scroll:doc.scrollHeight>innerHeight+1||doc.scrollWidth>innerWidth+1||(fl?fl.scrollHeight>fl.clientHeight+1&&getComputedStyle(fl).overflowY!=='visible':false)};
      let parts=[],others=[];
      if(${jsLiteral(!!WORLD)}){const p=q('#stage .ro-plate[data-id="'+CSS.escape(id)+'"]');out.plate=!!p;if(!p)return out;
        let e=p.nextElementSibling;while(e&&!e.matches('.ro-hstrip')&&!e.matches('.ro-plate'))e=e.nextElementSibling;
        const st=e&&e.matches('.ro-hstrip')?e:null;
        if(st){const m=st.querySelector('.ro-hmore');out.heads=st.querySelectorAll('.ro-hd').length;out.more=m?Number((m.textContent.match(/\\d+/)||[0])[0]):0;out.moreFs=m?parseFloat(getComputedStyle(m).fontSize):0;parts=[...st.querySelectorAll('.ro-hd,.ro-hmore')];}
        else{const t=(p.getAttribute('aria-label')||'')+' '+(p.title||'');const k=t.match(/(\\d+) helpers?/);out.words=k?Number(k[1]):0;}
        others=[...document.querySelectorAll('#stage .ro-plate')].filter(x=>x!==p);}
      else{const u=q('#stage .unit[data-key="unit:'+CSS.escape(id)+'"]');out.plate=!!u;if(!u)return out;const st=u.querySelector('.helpers');
        if(st){const m=st.querySelector('.more:not(.fewer)');out.heads=st.querySelectorAll('[data-id]').length;out.more=m?Number((m.textContent.match(/\\d+/)||[0])[0]):0;out.moreFs=m?parseFloat(getComputedStyle(m).fontSize):0;parts=[...st.children].filter(x=>x.matches('[data-id],.more'));}
        else{const t=u.querySelector('.desk').getAttribute('aria-label')||'';const k=t.match(/(\\d+) helpers?/);out.words=k?Number(k[1]):0;}
        others=[...document.querySelectorAll('#stage .desk')].filter(x=>!u.contains(x));}
      const hit=(a,b)=>a.x<b.x+b.w-1&&b.x<a.x+a.w-1&&a.y<b.y+b.h-1&&b.y<a.y+a.h-1;
      out.outside=parts.filter(e=>{const b=box(e);return b.w>0&&(b.x<-1||b.y<-1||b.x+b.w>innerWidth+1||b.y+b.h>innerHeight+1);}).length;
      out.over=parts.filter(e=>{const b=box(e);return b.w>0&&others.some(x=>{const c=box(x);return c.w>0&&hit(b,c);});}).length;
      return out;})()`);
    console.log(`[helper-retention] office ${w}x${h}: ` + JSON.stringify({ ...o, kept: s.helpers }));
    const tag = `${WORLD || 'flat'} ${w}x${h}`;
    assert.ok(o.plate, `${tag}: sim-1 is drawn`);
    assert.ok(!o.scroll, `${tag}: the office does not scroll`);
    const shown = o.heads != null ? o.heads + o.more : o.words;
    assert.strictEqual(shown, s.helpers, `${tag}: the office counts the kept helpers (${JSON.stringify(o)}, kept ${s.helpers})`);
    assert.ok(s.helpers <= KEEP.done + KEEP.failed + s.running.length, `${tag}: never more than the limits plus the running ones`);
    if (o.more) assert.ok(o.moreFs >= 10.5, `${tag}: "+K" is at least 10.5px (${o.moreFs})`);
    assert.strictEqual(o.outside, 0, `${tag}: no helper part leaves the window`);
    assert.strictEqual(o.over, 0, `${tag}: no helper part covers another desk`);
  }
  console.log('[helper-retention] ok');
};
