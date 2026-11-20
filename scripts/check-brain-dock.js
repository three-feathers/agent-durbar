/*
 * Spec 106 T006, T426 (FR-014, FR-015, FR-025, FR-030, FR-031, FR-033, FR-037, FR-060, SC-007): the dock at the top of the chat's right rail, ON BY DEFAULT
 * (Settings > Brain view; `?brain=0` is the run override that turns it off), in the simulator with 15 agents, at 1440x900 and 1280x800, in Flat, the Photo office, the Retro arcade and the Prehistoric cave. No credits.
 * In ui-suite.js; `node scripts/ui-suite.js --only check-brain-dock`. It fails (exit 1) when:
 *   - Brain view off (the run override, or Settings > Brain view switched off) and a chat has a right rail, loads anything of Brain view (FR-105), or loses width;
 *   - the switch does not bring the rail back when turned on again; a window under 1100 px wide does not start with the rail collapsed (T426);
 *   - on (the default, no query): the rail is not 360 px at the right of the chat, the chat is not the window less the agent rail and 360 px (FR-030), the page scrolls sideways,
 *     the dock is not above Your door, or any part of the rail is outside the window (15 agents fit, FR-037);
 *   - the region is not named "Brain view, <name>", the canvas is not decorative, or the dock shows another agent than the open chat's (a switch of chat follows);
 *   - Your door's heading and count are not visible, or its count differs from the agent rail's Your door count (SC-007), in the compact, legend and roomy states;
 *   - compact while Your door has items is taller than 280 px at 1440x900 (the mockup's about 230), or the dock does not grow when Your door is empty (FR-031),
 *     or grows over 60 % of the rail;
 *   - Legend does not show "A picture of tools, not a real brain" with the seven glyph words inside the brain area, or moves Your door's heading (FR-014);
 *   - Latest steps does not say "N steps this turn" and list the steps as text (FR-025);
 *   - a text of the rail is under 12 px (FR-097), or a canary token in a command reaches any text, title or label of the rail (FR-021);
 *   - Collapse does not hide the rail and give the chat its width back, or the header's Brain button does not bring it back (FR-031);
 *   - the skin is not the world's (neutral in Flat and the Photo office, arcade, cave).
 * Screenshots (looked at by the author): <SHOTS_OUT>/106-dock-<world>-<state>-<w>x<h>.png
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-106-dock-'));
const SIZES = [[1440, 900], [1280, 800]];
const CANARY = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab';
const WORLDS = [
  { id: 'flat', query: {}, skin: 'neutral' },
  { id: 'photo', query: { officeview: 'real' }, skin: 'neutral' },
  { id: 'retro', query: { officeview: 'real', world: 'retro', worldflags: 'retro' }, skin: 'arcade' },
  { id: 'cave', query: { officeview: 'real', world: 'cave', worldflags: 'cave' }, skin: 'cave' },
];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const emit = (e) => js(`void window.__durbarSimEmit(Object.assign({timestamp:Date.now()},${jsLiteral(e)}));0`);
  const box = (sel) => js(`(()=>{const e=document.querySelector(${jsLiteral(sel)});if(!e||!e.getClientRects().length)return null;const r=e.getBoundingClientRect();return {l:Math.round(r.left),t:Math.round(r.top),r:Math.round(r.right),b:Math.round(r.bottom),w:Math.round(r.width),h:Math.round(r.height)};})()`);
  const must = async (expr, what, ms = 15000) => {
    const ok = await H.until(expr, ms);
    if (!ok) console.log('[106-dock] page state: ' + JSON.stringify(await js(`({load:window.__durbarSimUi.brain.state()+' '+window.__durbarSimUi.brain.why(),rail:!!document.getElementById('brainRail'),bv:!!document.querySelector('#brainRail .bv'),panel:document.body.className,txt:((document.getElementById('brainRail')||{}).innerText||'').slice(0,200),errs:window.__errs||[]})`)));
    assert.ok(ok, 'timed out waiting for ' + what);
  };
  const openChat = async (id) => {
    await js(`(()=>{const d=document.querySelector('#stage .desk[data-id="'+CSS.escape(${jsLiteral(id)})+'"],#stage .ro-plate[data-id="'+CSS.escape(${jsLiteral(id)})+'"]');if(d)d.click();})()`);
    await must(`document.body.classList.contains('panel-open')&&!!document.getElementById('chat')`, 'the chat of ' + id);
  };
  const doorCount = () => js(`({rail:(document.querySelector('#railDoor b')||{}).textContent,dock:(document.getElementById('brailDoorN')||{}).textContent,rows:document.querySelectorAll('#brailDoorL [data-door]').length})`);
  const visibleIn = (sel, w, h) => js(`(()=>{const e=document.querySelector(${jsLiteral(sel)});if(!e||!e.getClientRects().length)return false;const r=e.getBoundingClientRect();return r.top>=0&&r.left>=0&&r.bottom<=${h}&&r.right<=${w}&&r.width>0&&r.height>0;})()`);
  const small = () => js(`[...document.querySelectorAll('#brainRail, #brainRail *')].filter(e=>e.getClientRects().length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).map(e=>[e.className||e.tagName,parseFloat(getComputedStyle(e).fontSize)]).filter(x=>x[1]<12)`);
  const pageScroll = () => js(`document.scrollingElement.scrollWidth>innerWidth||document.scrollingElement.scrollHeight>innerHeight`);

  const settingsSwitch = async (on) => {
    await js(`document.getElementById('backBtn')&&document.getElementById('backBtn').click()`);
    await must(`!document.body.classList.contains('panel-open')`, 'the office');
    await js(`document.getElementById('settingsBtn').click()`);
    await must(`!!document.getElementById('brainSw')`, 'Settings > Brain view');
    if ((await js(`document.getElementById('brainSw').getAttribute('aria-checked')==='true'`)) !== on) await js(`document.getElementById('brainSw').click()`);
    await must(`document.getElementById('brainSw').getAttribute('aria-checked')===${jsLiteral(String(on))}&&/Brain view is /.test(document.getElementById('brainMsg').textContent)`, 'Brain view ' + (on ? 'on' : 'off'));
    if (!on) {
      await js(`document.getElementById('brainH').scrollIntoView({block:'center'})`);
      assert.deepStrictEqual(await js(`[...document.querySelectorAll('#brainH, #brainH ~ *, #brainH ~ * *')].filter(e=>e.getClientRects().length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).map(e=>parseFloat(getComputedStyle(e).fontSize)).filter(x=>x<10.5)`), [], 'Settings > Brain view: text at least 10.5 px');
      await H.shot(path.join(OUT, `106-dock-settings-${await js('innerWidth')}x${await js('innerHeight')}.png`), { prep: 'calm', tag: '106-dock' });
    }
    await js(`document.getElementById('scrClose').click()`);
    await must(`!document.getElementById('brainSw')`, 'Settings closed');
  };
  // ---- off: the run override, and Settings > Brain view switched off: no right rail, nothing of Brain view loads (FR-105), the chat keeps its width
  for (const [w, h] of SIZES) {
    await H.load({ w, h, query: { brain: '0' } });
    const id = await js(`document.querySelector('#stage .desk[data-id]').dataset.id`);
    await openChat(id);
    const chatOff = await box('#panel>.panel-in');
    assert.strictEqual(await js(`!!document.getElementById('brainRail')`), false, `override off: no right rail in a chat at ${w}x${h}`);
    assert.strictEqual(await js(`document.querySelectorAll('script[src*=brain],link[href*=brain]').length`), 0, 'override off: no Brain view file is loaded (FR-105)');
    assert.ok(chatOff && chatOff.r === w, `off: the chat reaches the window's right edge (${JSON.stringify(chatOff)})`);
  }
  {
    const [w, h] = SIZES[1];
    await H.load({ w, h });
    const id = await js(`document.querySelector('#stage .desk[data-id]').dataset.id`);
    await openChat(id);
    await must(`!!document.querySelector('#brainRail .bv')`, 'on by default: the rail with no query (T426)');
    await H.shot(path.join(OUT, `106-dock-default-on-${w}x${h}.png`), { prep: 'calm', tag: '106-dock' });
    await settingsSwitch(false);
    await openChat(id);
    assert.strictEqual(await js(`!!document.getElementById('brainRail')||!!document.getElementById('brainBack')`), false, 'Settings off: no rail and no Brain button in the chat');
    assert.strictEqual((await box('#panel>.panel-in')).r, w, 'Settings off: the chat has the full width again');
    const f0 = await js(`window.__durbarSimUi.brain.host().stats().frames`);
    await emit({ type: 'toolCall', sessionId: id, callId: 'off-2', tool: 'view', phase: 'start', args: { path: 'a.ts' } });
    await new Promise((r) => setTimeout(r, 600));
    assert.strictEqual(await js(`window.__durbarSimUi.brain.host().stats().frames`), f0, 'Settings off: nothing is drawn');
    await settingsSwitch(true);
    await openChat(id);
    await must(`!!document.querySelector('#brainRail .bv')`, 'Settings on again: the rail is back');
    // a narrow window: the rail starts collapsed (not saved); the header's Brain button opens it for this window
    await H.load({ w: 1024, h: 768 });
    await openChat(id);
    await must(`!!document.getElementById('brainBack')&&!document.getElementById('brainBack').hidden&&!(document.getElementById('brainRail')||{getClientRects:()=>[]}).getClientRects().length`, 'under 1100 px: the rail starts collapsed with the Brain button shown');
    assert.strictEqual((await box('#panel>.panel-in')).r, 1024, 'under 1100 px: the chat has the window\'s width');
    await H.shot(path.join(OUT, `106-dock-narrow-1024x768.png`), { prep: 'calm', tag: '106-dock' });
    await js(`document.getElementById('brainBack').click()`);
    await must(`!!document.getElementById('brainRail').getClientRects().length`, 'the Brain button opens the rail in a narrow window');
  }

  for (const world of WORLDS) {
    for (const [w, h] of SIZES) {
      const tag = `${world.id}-${w}x${h}`;
      const real = !!world.query.officeview;
      await H.load({ w, h, query: { ...world.query }, ...(real ? { ready: `document.querySelectorAll('#stage .ro-plate[data-id]').length>=15`, readyMs: 30000 } : {}) });
      await js(`window.__errs=[];addEventListener('error',e=>window.__errs.push(String(e.message)+' '+String(e.filename).split('/').pop()));0`);
      const SEL = real ? '#stage .ro-plate[data-id]' : '#stage .desk[data-id]';
      const ids = await js(`[...new Set([...document.querySelectorAll(${jsLiteral(SEL)})].map(d=>d.dataset.id))]`);
      assert.strictEqual(ids.length, 15, `15 agents in ${tag}`);
      if (world.id === 'retro' || world.id === 'cave') assert.ok(await js(`!!document.querySelector(${jsLiteral(`#stage .ro[data-world="${world.id}"]`)})`), `the ${world.id} world is drawn`);
      const id = ids[0];
      const name = await js(`(window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(id)})||{}).name||''`);
      // masking first, on another agent's chat (the chat's own tool row shows its command, so the pictures below are taken on a chat without the canary)
      const sec = ids[2];
      await openChat(sec);
      await must(`!!document.querySelector('#brainRail #brainSlot .bv')&&window.__durbarSimUi.brain.host().shown()===${jsLiteral(sec)}`, `the dock of the open chat in ${tag}`);
      await emit({ type: 'toolCall', sessionId: sec, callId: 's-1', tool: 'bash', phase: 'start', args: { command: `curl -H "Authorization: Bearer ${CANARY}" https://example.test/x` } });
      await emit({ type: 'toolCall', sessionId: sec, callId: 's-1', tool: 'bash', phase: 'complete', output: 'ok' });
      await emit({ type: 'toolCall', sessionId: sec, callId: 's-2', tool: 'bash', phase: 'start', args: { command: `npm run deploy -- --token=${CANARY}` } });
      await emit({ type: 'toolCall', sessionId: sec, callId: 's-3', tool: 'view', phase: 'start', args: { path: '/home/someone/project/src/registry.ts' } });
      await must(`/Read/.test(document.querySelector('#brainRail .bv-c1').textContent)&&document.querySelectorAll('#brainRail .bv-list li').length>=3`, `the masked steps in ${tag}`);
      await js(`document.querySelector('#brainRail .bv-steps').open=true`);
      const secret = await js(`(()=>{const r=document.getElementById('brainRail');return r.outerHTML+'|'+r.innerText+'|'+[...r.querySelectorAll('[title],[aria-label]')].map(e=>(e.title||'')+(e.getAttribute('aria-label')||'')).join('|');})()`);
      assert.ok(!secret.includes(CANARY) && !secret.includes('ghp_') && !secret.includes('--token=ghp'), `a token in a command reaches no text, title or label of the rail in ${tag} (FR-021)`);
      assert.ok(secret.includes('[redacted]'), `the masked command is shown with redact's own mark in ${tag}`);
      assert.ok(!secret.includes('/home/someone'), `a home path is masked in ${tag} (FR-085)`);
      await js(`document.querySelector('#brainRail .bv-steps').open=false`);
      await openChat(id);
      await must(`window.__durbarSimUi.brain.host().shown()===${jsLiteral(id)}`, `the dock follows the open chat in ${tag}`);
      await emit({ type: 'toolCall', sessionId: id, callId: 'k-1', tool: 'bash', phase: 'start', args: { command: 'git status' } });
      await emit({ type: 'toolCall', sessionId: id, callId: 'k-1', tool: 'bash', phase: 'complete', output: 'ok' });
      await emit({ type: 'toolCall', sessionId: id, callId: 'k-2', tool: 'view', phase: 'start', args: { path: '/home/someone/project/src/registry.ts' } });
      await emit({ type: 'toolCall', sessionId: id, callId: 'k-2', tool: 'view', phase: 'complete', output: 'x' });
      await emit({ type: 'toolCall', sessionId: id, callId: 'k-3', tool: 'bash', phase: 'start', args: { command: 'npm run test -- --run' } });
      await must(`/Shell/.test(document.querySelector('#brainRail .bv-c1').textContent)&&/running/.test(document.querySelector('#brainRail .bv-c1').textContent)`, `the card of a running command in ${tag}`);
      await must(`/^\\d+ steps this turn/.test(document.querySelector('#brainRail .bv-sum').textContent)&&document.querySelectorAll('#brainRail .bv-list li').length>=3`, `Latest steps in ${tag}`);

      // placement (FR-030, FR-037)
      const rail = await box('#brainRail'), chat = await box('#panel>.panel-in'), agents = await box('#panel>.rail');
      assert.ok(rail && agents && rail.w === 360 && rail.r === w && rail.t === agents.t && rail.b === h, `the right rail is 360 px at the window's right edge, as tall as the agent rail, in ${tag}: ${JSON.stringify(rail)} ${JSON.stringify(agents)}`);
      assert.ok(chat && agents && chat.l === agents.r && chat.r === rail.l && chat.w === w - agents.w - 360, `the chat keeps the window less the agent rail (${agents && agents.w}) and 360 px in ${tag}: ${JSON.stringify(chat)}`);
      assert.strictEqual(await pageScroll(), false, `no page scroll in ${tag}`);
      const dock = await box('#brainRail .bv'), doorH = await box('#brailDoorT');
      assert.ok(dock && doorH && dock.b <= doorH.t, `the dock is above Your door in ${tag}`);
      assert.ok(await visibleIn('#brailDoorT', w, h) && await visibleIn('#brailDoorN', w, h), `Your door's heading and count are visible in ${tag} (SC-007)`);
      assert.ok(await visibleIn('#brainRail .bv', w, h), `the whole dock is inside the window in ${tag}`);
      // the region and its text (FR-090 basics)
      assert.strictEqual(await js(`document.querySelector('#brainRail .bv').getAttribute('aria-label')`), 'Brain view, ' + name, `the region is named for the open chat's agent in ${tag}`);
      assert.strictEqual(await js(`document.querySelector('#brainRail .bv canvas').getAttribute('aria-hidden')`), 'true', 'the canvas is decorative');
      assert.ok((await js(`document.querySelector('#brainRail .bv-lobe').textContent`)).startsWith('Shell, cerebellum'), 'the lobe is text');
      const steps = await js(`({sum:document.querySelector('#brainRail .bv-sum').textContent,rows:[...document.querySelectorAll('#brainRail .bv-list li')].map(l=>l.textContent)})`);
      assert.ok(steps.rows.length === Math.min(24, Number(steps.sum.split(' ')[0])) && steps.rows.some((r) => /Read · .*registry\.ts · done/.test(r)), `Latest steps lists the turn's steps as text: ${JSON.stringify(steps)}`);
      assert.deepStrictEqual(await small(), [], `every text of the rail is at least 12 px in ${tag} (FR-097)`);
      assert.strictEqual(await js(`document.querySelector('#brainRail .bv').dataset.skin`), world.skin, `the dock wears the ${world.skin} skin in ${tag}`);
      // Your door: the same count as the agent rail's (SC-007); compact while it has items (FR-031)
      const c0 = await doorCount();
      assert.strictEqual(c0.dock, c0.rail, `Your door's count in the right rail equals the agent rail's in ${tag}: ${JSON.stringify(c0)}`);
      assert.ok(Number(c0.dock) > 0 && c0.rows === Number(c0.dock), `the simulator has someone at your door, one row each, in ${tag}: ${JSON.stringify(c0)}`);
      assert.ok(dock.h <= 280, `compact while Your door has items: the dock is ${dock.h} px tall in ${tag} (about 230, at most 280)`);
      assert.strictEqual(await js(`window.__durbarSimUi.brain.host().roomy()`), false, 'compact, not roomy, while Your door has items');
      await H.shot(path.join(OUT, `106-dock-${world.id}-running-${w}x${h}.png`), { prep: 'calm', tag: '106-dock' });

      // Latest steps open: the list stays inside the dock, Your door's heading stays visible
      await js(`document.querySelector('#brainRail .bv-steps').open=true`);
      assert.ok(await visibleIn('#brailDoorT', w, h), `Your door's heading stays visible with Latest steps open in ${tag}`);
      await js(`document.querySelector('#brainRail .bv-steps').open=false`);

      // Legend (FR-014): inside the brain area; the header, the cost line and Your door do not move
      const costBefore = await box('#brainRail .bv-cost');
      await js(`document.querySelector('#brainRail [data-bv=legend]').click()`);
      await must(`!document.getElementById('bvLegend').hidden`, 'the legend');
      const legend = await js(`document.getElementById('bvLegend').innerText`);
      assert.ok(legend.includes('A picture of tools, not a real brain'), 'the legend says it is a picture of tools, not a real brain');
      for (const word of ['Think', 'Read', 'Edit', 'Shell', 'Web', 'MCP', 'You', 'looping?', 'bloom']) assert.ok(legend.includes(word), `the legend names ${word}`);
      assert.strictEqual(await js(`document.querySelector('#brainRail [data-bv=legend]').getAttribute('aria-expanded')`), 'true', 'Legend says it is open');
      assert.deepStrictEqual(await box('#brailDoorT'), doorH, `the legend does not move Your door in ${tag}`);
      assert.deepStrictEqual(await box('#brainRail .bv-cost'), costBefore, `the legend does not move the cost line in ${tag}`);
      const lg = await box('#bvLegend'), body = await box('#brainRail .bv-body');
      assert.ok(lg.t >= body.t && lg.b <= body.b, 'the legend is inside the brain area');
      const fits = await js(`(()=>{const l=document.getElementById('bvLegend');return {sh:l.scrollHeight,ch:l.clientHeight};})()`);
      assert.ok(fits.sh <= fits.ch + 1, `the legend fits its area with no scroll (no half-cut line) in ${tag}: ${JSON.stringify(fits)}`);
      assert.deepStrictEqual(await small(), [], `the legend's text is at least 12 px in ${tag}`);
      assert.strictEqual((await js(`window.__durbarSimUi.brain.host().stats().loopRunning`)), false, 'the picture is not drawn behind the legend');
      await H.shot(path.join(OUT, `106-dock-${world.id}-legend-${w}x${h}.png`), { prep: 'calm', tag: '106-dock' });
      await js(`document.querySelector('#brainRail [data-bv=legend]').click()`);
      await must(`document.getElementById('bvLegend').hidden`, 'the legend closes');

      // another chat: the dock follows it (FR-030)
      const other = ids[1];
      await js(`document.querySelector('#stripList [data-sw="'+CSS.escape(${jsLiteral(other)})+'"]').click()`);
      await must(`window.__durbarSimUi.brain.host().shown()===${jsLiteral(other)}&&/^Brain view, /.test(document.querySelector('#brainRail .bv').getAttribute('aria-label'))`, 'the dock follows the open chat');
      assert.strictEqual(await js(`document.querySelectorAll('#brainRail').length`), 1, 'one rail after a switch');
      await openChat(id);
      await must(`window.__durbarSimUi.brain.host().shown()===${jsLiteral(id)}&&/Shell/.test(document.querySelector('#brainRail .bv-c1').textContent)`, 'back on the first chat, its brain is as it was');

      // Collapse (FR-031): the chat gets its width back; the header's Brain button brings the rail back
      await js(`document.getElementById('brailHide').click()`);
      await must(`!document.getElementById('brainRail').getClientRects().length&&!!document.getElementById('brainBack')&&!document.getElementById('brainBack').hidden`, 'the rail collapses');
      const chatC = await box('#panel>.panel-in');
      assert.strictEqual(chatC.r, w, `collapsed: the chat reaches the window's edge in ${tag}`);
      assert.strictEqual(await js(`document.activeElement&&document.activeElement.id`), 'brainBack', 'collapsed: focus goes to the Brain button');
      assert.strictEqual(await pageScroll(), false, `collapsed: no page scroll in ${tag}`);
      assert.ok(await visibleIn('#brainBack', w, h), `the Brain button is visible in the chat header in ${tag}`);
      await H.shot(path.join(OUT, `106-dock-${world.id}-collapsed-${w}x${h}.png`), { prep: 'calm', tag: '106-dock' });
      await js(`document.getElementById('brainBack').click()`);
      await must(`!!document.getElementById('brainRail').getClientRects().length&&document.getElementById('brainBack').hidden`, 'the rail comes back');
      assert.strictEqual(await js(`document.activeElement&&document.activeElement.id`), 'brailHide', 'shown again: focus goes to Collapse');

      const errs = await js(`window.__errs`);
      assert.deepStrictEqual(errs, [], `no page error in ${tag}`);

      // Your door empty: the dock grows (FR-031). The simulator's 2 agents (Ada working, Mira thinking) need nobody: no hook, no faked state
      await H.load({ w, h, query: { ...world.query, sim: '2' }, ready: `document.querySelectorAll(${jsLiteral(SEL)}).length>=2`, readyMs: 30000 });
      const two = await js(`[...new Set([...document.querySelectorAll(${jsLiteral(SEL)})].map(d=>d.dataset.id))]`);
      await openChat(two[0]);
      await must(`!!document.querySelector('#brainRail .bv')&&window.__durbarSimUi.brain.host().shown()===${jsLiteral(two[0])}`, `the dock with 2 agents in ${tag}`);
      await emit({ type: 'toolCall', sessionId: two[0], callId: 'e-1', tool: 'view', phase: 'start', args: { path: 'src/registry.ts' } });
      await emit({ type: 'toolCall', sessionId: two[0], callId: 'e-1', tool: 'view', phase: 'complete', output: 'x' });
      await emit({ type: 'toolCall', sessionId: two[0], callId: 'e-2', tool: 'edit', phase: 'start', args: { path: 'src/registry.ts' } });
      await must(`/Edit/.test(document.querySelector('#brainRail .bv-c1').textContent)`, `the card of an edit in ${tag}`);
      const c1 = await doorCount();
      assert.ok(c1.dock === '0' && c1.rail === '0' && c1.rows === 0, `empty: Your door counts 0, as the agent rail (${JSON.stringify(c1)})`);
      await must(`window.__durbarSimUi.brain.host().roomy()&&document.getElementById('brainRail').classList.contains('door-empty')`, 'the dock grows when Your door is empty');
      assert.ok(await visibleIn('#brailDoorT', w, h) && await visibleIn('#brailDoorN', w, h), `empty: Your door's heading and count stay visible in ${tag} (SC-007)`);
      const big = await box('#brainRail .bv'), r2 = await box('#brainRail');
      assert.ok(big.h > dock.h + 60, `empty: the dock grows (${dock.h} -> ${big.h}) in ${tag}`);
      assert.ok(big.h <= Math.ceil(r2.h * 0.6) + 1, `empty: the dock is at most 60 % of the rail (${big.h} of ${r2.h}) in ${tag}`);
      const cv = await js(`(()=>{const c=document.querySelector('#brainRail .bv canvas').getBoundingClientRect(),b=document.querySelector('#brainRail .bv').getBoundingClientRect();return {cw:Math.round(c.width),bw:Math.round(b.width)};})()`);
      assert.ok(cv.cw >= cv.bw - 40, `empty: the brain takes the rail's width (${JSON.stringify(cv)}) in ${tag}`);
      assert.ok(await visibleIn('#brainRail .bv', w, h), `empty: the whole dock is inside the window in ${tag}`);
      assert.deepStrictEqual(await small(), [], `empty: every text is at least 12 px in ${tag}`);
      assert.strictEqual(await pageScroll(), false, `empty: no page scroll in ${tag}`);
      await H.shot(path.join(OUT, `106-dock-${world.id}-roomy-${w}x${h}.png`), { prep: 'calm', tag: '106-dock' });
      await js(`document.querySelector('#brainRail [data-bv=legend]').click()`);
      await must(`!document.getElementById('bvLegend').hidden`, 'the legend when roomy');
      assert.ok(await visibleIn('#brailDoorT', w, h) && await visibleIn('#bvLegend', w, h), `empty: the legend and Your door's heading are visible in ${tag}`);
      assert.deepStrictEqual(await js(`[...new Set([...document.querySelectorAll(${jsLiteral(SEL)})].map(d=>d.dataset.id))].length`), 2, 'still 2 agents');
      console.log(`[106-dock] ${tag}: rail ${rail.w}x${rail.h}, chat ${chat.w}, dock ${dock.h} px compact and ${big.h} px roomy, Your door ${c0.dock} then 0`);
    }
  }
  console.log('[106-dock] pictures in ' + OUT);
};
