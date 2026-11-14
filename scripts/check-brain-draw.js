/*
 * Spec 106 T005 (P1 G2 first slice): the brain on its temporary floating host, in the simulator, at both sizes with 15 agents. No credits.
 * In ui-suite.js; `node scripts/ui-suite.js --only check-brain-draw`. It fails (exit 1) when:
 *   - the flag is off (the default) and anything of Brain view loads, or a `.bv` exists (FR-105);
 *   - with `?brain=1`: no brain after an event; a canary token in a command reaches any text of the host, its labels or its canvas alternative (FR-021, FR-085);
 *   - a text of the host is under 12 px (FR-097); the host moves a desk (the office layout must be unchanged); the canvas is not decorative or not drawn;
 *   - a step does not change the picture; a failed step is not drawn as a cross (the cross is checked in the unit test; here the picture must differ);
 *   - a loop is left running when nothing happens (FR-103); a frame draws more points than the largest lit lobe (FR-102);
 *   - Still (the button, by keyboard) or reduced motion (emulated) starts an animation frame loop (SC-004); a hidden page draws a frame; forced colours keep it still.
 * Reported, not asserted: how many desks the floating host covers (it is fixed at the corner until T006's dock; the covering is why it stays off by default).
 * Screenshots: <SHOTS_OUT>/106-brain-<state>-<w>x<h>.png
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-106-brain-'));
const SIZES = [[1440, 900], [1280, 800]];
const CANARY = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const wc = () => ctx.win.webContents;
  const must = async (expr, what, ms = 15000) => {
    const ok = await H.until(expr, ms);
    if (!ok) console.log('[106-brain] page state: ' + JSON.stringify(await js(`({flag:window.__durbarSimUi.brain.flag,load:window.__durbarSimUi.brain.state()+' '+window.__durbarSimUi.brain.why(),queued:window.__durbarSimUi.brain.queued(),host:!!document.querySelector('.bv'),txt:(document.querySelector('.bv')||{innerText:''}).innerText.slice(0,160),tags:0,errs:window.__errs,mods:['GLYPHS','WAITING_CARD','relPath','sentenceFor','officeTag','cardLines','currentStep'].map(k=>k in window.exports?1:0).join('')})`)));
    assert.ok(ok, 'timed out waiting for ' + what);
  };
  const dbg = () => { const d = wc().debugger; if (!d.isAttached()) d.attach('1.3'); return d; };
  const media = (features) => dbg().sendCommand('Emulation.setEmulatedMedia', { features });
  const emit = (e) => js(`void window.__durbarSimEmit(Object.assign({timestamp:Date.now()},${jsLiteral(e)}));0`);
  const stats = () => js(`window.__durbarSimUi.brain.host().stats()`);
  const calmDown = async () => { await H.until(`window.__durbarSimUi.brain.host()&&!window.__durbarSimUi.brain.host().stats().loopRunning`, 8000); };
  const DESKS = `[...document.querySelectorAll('#stage .desk[data-id]')].map(d=>{const r=d.getBoundingClientRect();return [d.dataset.id,Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)].join(':')})`;
  await media([{ name: 'prefers-reduced-motion', value: 'no-preference' }, { name: 'forced-colors', value: 'none' }]);

  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    // ---- off by default: nothing loads, nothing shows (FR-105)
    await H.load({ w, h });
    const id = await js(`document.querySelector('#stage .desk[data-id]').dataset.id`);
    assert.ok(id, 'an agent');
    await emit({ type: 'toolCall', sessionId: id, callId: 'off-1', tool: 'bash', phase: 'start', args: { command: 'npm test' } });
    await new Promise((r) => setTimeout(r, 600));
    assert.strictEqual(await js(`!!document.querySelector('.bv')`), false, 'off by default: no brain on the page');
    assert.strictEqual(await js(`document.querySelectorAll('script[src*=brain],link[href*=brain]').length>0`), false, 'off by default: no Brain view file is loaded (FR-105)');
    await emit({ type: 'toolCall', sessionId: id, callId: 'off-1', tool: 'bash', phase: 'complete', output: 'ok' });

    // ---- no masking, no brain (fail closed): with the redact module "missing" the loader gives up and shows nothing
    await H.load({ w, h, query: { brain: '1', noredact: '1' } });
    await emit({ type: 'toolCall', sessionId: id, callId: 'nr-1', tool: 'bash', phase: 'start', args: { command: 'npm test' } });
    await must(`window.__durbarSimUi.brain.state()==='failed'&&window.__durbarSimUi.brain.why()==='no mask'`, 'the brain refuses to start without masking');
    assert.strictEqual(await js(`!!document.querySelector('.bv')`), false, 'no masking, no brain: nothing is shown');

    // ---- on: the layout is unchanged, the brain follows the agent
    await H.load({ w, h, query: { brain: '1' } });
    // the OS may take the focus from a driver (three run at a time): an unfocused page draws Still, which would make the "no loop" checks below pass for any code
    await H.focusPage({ emulate: 'first' });
    const before = await js(DESKS);
    assert.strictEqual(before.length, 15, '15 desks');
    await js(`window.__errs=[];addEventListener('error',e=>window.__errs.push(String(e.message)+' '+String(e.filename).split('/').pop()));0`);
    const cmd = `curl -H "Authorization: Bearer ${CANARY}" https://example.test/x`;
    await emit({ type: 'toolCall', sessionId: id, callId: 'b-1', tool: 'bash', phase: 'start', args: { command: cmd } });
    await must(`!!document.querySelector('.bv .bv-c1')&&/running/.test(document.querySelector('.bv .bv-c1').textContent)`, 'the card of a running command');
    await calmDown();
    assert.strictEqual(await js(`window.__durbarSimUi.brain.host().draw.mode()`), 'full', 'the brain is in Full (the page has focus), so the Still checks below test something');
    assert.ok((await stats()).loops >= 1, 'a step in Full ran an animation loop');
    assert.deepStrictEqual(await js(DESKS), before, 'the floating brain moves no desk');
    const everything = await js(`document.querySelector('.bv').outerHTML+'|'+document.querySelector('.bv').innerText+'|'+document.querySelector('.bv canvas').toDataURL().length`);
    assert.ok(!everything.includes(CANARY) && !everything.includes('ghp_'), 'a token in a command reaches no text of the brain (FR-021)');
    assert.ok((await js(`document.querySelector('.bv-lobe').textContent`)).startsWith('Shell, cerebellum'), 'the lobe is also text');
    assert.strictEqual(await js(`document.querySelector('.bv canvas').getAttribute('aria-hidden')`), 'true', 'the canvas is decorative; its meaning is text');
    assert.ok((await js(`document.querySelector('.bv').getAttribute('aria-label')`)).startsWith('Brain view, '), 'the region is named');
    const small = await js(`[...document.querySelectorAll('.bv, .bv *')].filter(e=>[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).map(e=>parseFloat(getComputedStyle(e).fontSize)).filter(s=>s<12)`);
    assert.deepStrictEqual(small, [], 'every text of the brain is at least 12 px (FR-097)');
    const lit = (cv) => js(`(()=>{const c=document.querySelector('.bv canvas'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0,s=0;for(let i=3;i<d.length;i+=4){if(d[i]>0){n++;s+=d[i-3]*3+d[i-2]*7+d[i-1]*11;}}return {n,s};})()`);
    const shell = await lit();
    assert.ok(shell.n > 1500, 'the brain is drawn: ' + shell.n + ' lit pixels');
    const covered = await js(`(()=>{const b=document.querySelector('.bv').getBoundingClientRect();return [...document.querySelectorAll('#stage .desk[data-id]')].filter(d=>{const r=d.getBoundingClientRect();return r.left<b.right&&r.right>b.left&&r.top<b.bottom&&r.bottom>b.top;}).length;})()`);
    console.log(`[106-brain] ${tag}: the floating host covers ${covered} of 15 desks (reported; T006's dock replaces it)`);
    await H.shot(path.join(OUT, `106-brain-running-${tag}.png`), { prep: 'calm' });

    // ---- a second tool lights another lobe and changes the picture; idle is free
    await emit({ type: 'toolCall', sessionId: id, callId: 'b-1', tool: 'bash', phase: 'complete', output: 'ok' });
    await emit({ type: 'toolCall', sessionId: id, callId: 'b-2', tool: 'view', phase: 'start', args: { path: '/home/someone/project/src/registry.ts' } });
    await must(`/Read/.test(document.querySelector('.bv-lobe').textContent)`, 'the Read lobe');
    await calmDown();
    const read = await lit();
    assert.notStrictEqual(read.s, shell.s, 'another tool, another picture');
    assert.ok((await js(`document.querySelector('.bv-c2').textContent`)).includes('registry.ts'), 'the card names the file');
    assert.ok(!(await js(`document.querySelector('.bv').innerText`)).includes('/home/someone'), 'a home path is masked (FR-085)');
    let s = await stats();
    assert.strictEqual(s.loopRunning, false, 'FR-103: no frame loop is left');
    const litMax = await js(`window.DurbarBrainPoints.build('dock').byLobe.reduce((m,l)=>Math.max(m,l.length),0)`);
    assert.ok(s.pointsMax > 0 && s.pointsMax <= litMax, 'FR-102: a frame draws only the lit lobe, at most ' + litMax + ' points: ' + s.pointsMax);
    assert.strictEqual(s.basePoints, 6000, 'the base layer holds the 6,000 dock points, built outside any frame');
    assert.strictEqual(s.canvases, 1, 'one canvas');
    const f0 = s.frames; await new Promise((r) => setTimeout(r, 1500));
    assert.strictEqual((await stats()).frames, f0, 'FR-103: 1.5 s of nothing, 0 frames drawn');
    await emit({ type: 'toolCall', sessionId: id, callId: 'b-2', tool: 'view', phase: 'complete', output: 'x' });
    await emit({ type: 'toolCall', sessionId: id, callId: 'b-3', tool: 'bash', phase: 'start', args: { command: 'false' } });
    await emit({ type: 'toolCall', sessionId: id, callId: 'b-3', tool: 'bash', phase: 'failed', output: 'boom' });
    await must(`/failed/.test(document.querySelector('.bv-c1').textContent)`, 'a failed step in words');
    await calmDown();
    await H.shot(path.join(OUT, `106-brain-failed-${tag}.png`), { prep: 'calm' });

    // ---- Still by keyboard: no animation frame loop (SC-004)
    await js(`document.querySelector('.bv [data-bv=motion]').focus();0`);
    await H.key('Return'); // Full -> Calm
    await H.key('Return'); // Calm -> Still
    await must(`/Still/.test(document.querySelector('.bv [data-bv=motion]').textContent)`, 'Still by keyboard');
    s = await stats(); const loops = s.loops, fr = s.frames;
    await emit({ type: 'toolCall', sessionId: id, callId: 'b-4', tool: 'grep', phase: 'start', args: { pattern: 'x' } });
    await must(`/Read/.test(document.querySelector('.bv-lobe').textContent)`, 'a step under Still');
    await new Promise((r) => setTimeout(r, 600));
    s = await stats();
    assert.strictEqual(s.loops, loops, 'Still: no animation loop started');
    assert.ok(s.frames - fr <= 2 && s.frames - fr >= 1, 'Still: one frame for the change (' + (s.frames - fr) + ')');
    assert.strictEqual(s.loopRunning, false);
    await H.shot(path.join(OUT, `106-brain-still-${tag}.png`), { prep: 'calm' });
    // back to Full for the next checks
    await H.key('Return'); await must(`/Full/.test(document.querySelector('.bv [data-bv=motion]').textContent)`, 'Full again');

    // ---- hidden: nothing draws (the page is told it is hidden; a real hidden window cannot be made under xvfb); shown: one frame
    await js(`Object.defineProperty(document,'hidden',{get:()=>true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));0`);
    const hf = (await stats()).frames;
    await emit({ type: 'toolCall', sessionId: id, callId: 'b-5', tool: 'edit', phase: 'start', args: { path: 'a.ts' } });
    await must(`/Edit/.test(document.querySelector('.bv-lobe').textContent)`, 'a step while hidden');
    await new Promise((r) => setTimeout(r, 600));
    s = await stats();
    assert.strictEqual(s.frames, hf, 'FR-104: a hidden page draws 0 frames');
    assert.strictEqual(s.loopRunning, false);
    await js(`delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));0`);
    await must(`window.__durbarSimUi.brain.host().stats().frames===${jsLiteral(hf + 1)}`, 'one frame when shown again', 3000);

    // ---- reduced motion (emulated): forced Still, the button says why
    await media([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await must(`/system/.test(document.querySelector('.bv [data-bv=motion]').textContent)`, 'the button says reduced motion decides');
    assert.strictEqual(await js(`document.querySelector('.bv [data-bv=motion]').getAttribute('aria-disabled')`), 'true');
    s = await stats(); const rl = s.loops;
    await emit({ type: 'toolCall', sessionId: id, callId: 'b-6', tool: 'fetch', phase: 'start', args: { url: 'https://example.test/' } });
    await must(`/Web/.test(document.querySelector('.bv-lobe').textContent)`, 'a step under reduced motion');
    await new Promise((r) => setTimeout(r, 500));
    assert.strictEqual((await stats()).loops, rl, 'reduced motion: no animation loop');
    await media([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);

    // ---- forced colours: still, drawn
    await media([{ name: 'forced-colors', value: 'active' }]);
    await must(`window.__durbarSimUi.brain.host().draw.mode()==='still'`, 'forced colours draw Still');
    assert.ok((await lit()).n > 1000, 'forced colours: still drawn');
    await H.shot(path.join(OUT, `106-brain-forced-${tag}.png`), { prep: 'calm' });
    await media([{ name: 'forced-colors', value: 'none' }]);
    // ---- no overlap with the chat: the floating box is for the office only; with a chat open it is hidden and the composer is not under it
    await H.focusPage({ emulate: 'first' });
    const opened = await H.openSimAgent(`a=>a.id===${jsLiteral(id)}`, '#msgInput');
    assert.ok(opened.ok, 'the chat opens: ' + JSON.stringify(opened.seen));
    const under = await js(`(()=>{const out=[];for(const sel of ['#msgInput','#sendBtn','.composer']){const e=document.querySelector(sel);if(!e)continue;const r=e.getBoundingClientRect();if(!r.width)continue;
      for(const [fx,fy] of [[0.5,0.5],[0.1,0.5],[0.9,0.5],[0.5,0.2],[0.5,0.8]]){const h=document.elementFromPoint(r.left+r.width*fx,r.top+r.height*fy);if(h&&h.closest('.bv'))out.push(sel+'@'+fx+','+fy);}}
      const b=document.querySelector('.bv').getBoundingClientRect();return {out,w:b.width,composer:!!document.querySelector('.composer')};})()`);
    assert.ok(under.composer, 'the composer exists');
    assert.deepStrictEqual(under.out, [], 'FR-105: the brain box is not over the composer, the message box or Send at ' + tag);
    assert.strictEqual(under.w, 0, 'with a chat open the floating box takes no room at all (' + tag + ')');
    console.log(`[106-brain] ${tag}: ok`);
  }
  console.log('[106-brain] screenshots in ' + OUT);
};
