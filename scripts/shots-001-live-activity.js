/*
 * Spec 001 FR-028..FR-032: live activity on the desks. Simulator only (events sent through the simulator's test hook), no credits.
 * Sparse office (3 agents, `density=full`: by default few agents get grown desks, spec 001 FR-042): the side panel next to each desk. Dense office (15 agents): the readout in the desk's text line, the name
 * still shown. Checks: the office page rules (overlap, clipping, text >= 10.5px), no secret in the readout, at most 4 paints a second,
 * no layout shift while text streams, and the setting off restores today's text. Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-001-live-activity.js xvfb-run -a npx electron . --no-sandbox
 */
const assert = require('assert');
const path = require('path');
const { pageCheck } = require('./check-office-overlap.js');
const { helpers, waits, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';
const q = jsLiteral; /* every value spliced into page code goes through jsLiteral (CodeQL js/bad-code-sanitization) */
const SECRET = 'S3cr3tV4lue9xQzz';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const js = (c) => ctx.js(c);
  const emit = (e) => js(`window.__durbarSimEmit(Object.assign({timestamp:Date.now()},${q(e)}))`);
  /* extra: more page address values; the sparse office forces `full` (spec 001 FR-042: a few agents get grown desks by default,
     checked in check-office-fill.js), so the side panel is still checked here */
  const load = async (n, w, h, extra) => {
    await H.load({ w, h, query: { sim: String(n), ...(extra || {}) }, ready: `document.querySelectorAll('#stage .desk[data-id]').length>=${q(n)}`, settle: false });
    await ctx.sleep(300);
  };
  const think = (id, rid, delta) => emit({ type: 'thinking', sessionId: id, reasoningId: rid, delta });
  const feed = async () => {
    await think('sim-2', 'drv-r1', '**Checking callers**\n\nA rename here is a breaking change for any client that pins tool names. ');
    await think('sim-2', 'drv-r1', 'So I will list every caller first and keep the old name as an alias for one release. ');
    await emit({ type: 'toolCall', sessionId: 'sim-1', callId: 'drv-c1', tool: 'bash', phase: 'start', args: { command: `curl -H "Authorization: Bearer ${SECRET}" https://api.example.com/v1/tools` } });
    await ctx.sleep(400); // one throttle window
  };
  const deskName = (id) => js(`(()=>{const d=document.querySelector('#stage .desk[data-id=${q(id)}]');const n=d&&d.querySelector('.name');const r=n&&n.getBoundingClientRect();return n?{t:n.textContent,w:r.width,label:d.getAttribute('aria-label')}:null})()`);
  const rects = () => js(`[...document.querySelectorAll('#stage .desk, #stage .liveside, #stage .helper')].map(e=>{const r=e.getBoundingClientRect();return [Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)].join(',')}).join(';')`);
  const { until } = waits(ctx);
  /* the live simulator sends figures to places at any time: measure once no figure is mid-walk (a walking one is not on a slot yet;
     check-office-overlap re-measures the same way). Found by `npm run shots:docs` (spec 001 FR-082): this driver is not in ui-suite. */
  const page = async (label) => { await until(`![...document.querySelectorAll('#walkers .walker')].some((w)=>w.classList.contains('walking')||w.getAnimations().some((a)=>a.playState==='running'))`, 3000); const r = await js(`(${pageCheck.toString()})(false, 5)`); assert.deepStrictEqual(r.problems, [], `${label}: office page rules`); return r.info; };

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    /* ---- sparse: the side panel ---- */
    await load(3, w, h, { density: 'full' });
    await feed();
    let st = await js(`({side:document.getElementById('stage').dataset.side,d:document.getElementById('stage').dataset.d})`);
    assert.deepStrictEqual(st, { side: '1', d: 'full' }, `${w}: 3 agents use the side panel`);
    const side = (id) => js(`(()=>{const p=document.querySelector('#stage [data-side=${q(id)}]');if(!p)return null;const t=p.querySelector('.ls-t');return {empty:p.classList.contains('is-empty'),k:p.querySelector('.ls-k').textContent,t:t.textContent,font:Math.min(parseFloat(getComputedStyle(t).fontSize),parseFloat(getComputedStyle(p.querySelector('.ls-k')).fontSize)),over:t.classList.contains('over'),vis:getComputedStyle(p).visibility}})()`);
    let p3 = await side('sim-2');
    assert.strictEqual(p3.empty, false, `${w}: Mira's panel shows`);
    assert.strictEqual(p3.k, 'Thinking');
    assert.match(p3.t, /So I will list every caller first and keep the old name as an alias for one release\.$/, `${w}: newest thinking sentence: ${p3.t}`);
    assert.ok(!/Checking callers/.test(p3.t), 'the heading is left out');
    assert.ok(p3.font >= 10.5, `${w}: legible`);
    const p2 = await side('sim-1');
    assert.strictEqual(p2.k, 'Working');
    assert.match(p2.t, /^Running curl -H/, `${w}: tool phrase: ${p2.t}`);
    assert.ok(!p2.t.includes(SECRET), `${w}: the secret is masked: ${p2.t}`);
    const p1 = await side('sim-3');
    assert.ok(p1 && p1.empty && p1.vis === 'hidden', `${w}: a waiting agent's panel is empty (its request stays on the desk): ${JSON.stringify(p1)}`);
    const n3 = await deskName('sim-2');
    assert.ok(n3 && n3.t === 'Mira' && n3.w > 20 && /^Mira, /.test(n3.label), `${w}: the name stays on the desk and in its label`);
    const info = await page(`${w} sparse`);
    assert.ok(info.minFont >= 10.5, `${w}: min font ${info.minFont}`);
    /* FR-030: a burst of 40 deltas in 2 s gives at most 4 paints a second, the text changes, and nothing moves */
    const before = await rects();
    await js(`(()=>{window.__lpaints=0;const t=document.querySelector('#stage [data-side="sim-2"] .ls-t');window.__lobs=new MutationObserver(()=>{window.__lpaints++;});window.__lobs.observe(t,{childList:true,characterData:true,subtree:true});})()`);
    const t0 = Date.now();
    for (let i = 0; i < 40; i++) { await think('sim-2', 'drv-r1', `Step ${i} is checked. `); await ctx.sleep(50); }
    await ctx.sleep(400);
    const paints = await js(`(window.__lobs.disconnect(),window.__lpaints)`), secs = (Date.now() - t0) / 1000;
    assert.ok(paints >= 4 && paints <= Math.ceil(secs * 4) + 1, `${w}: ${paints} paints for 40 deltas in ${secs.toFixed(1)} s (at most 4 a second)`);
    assert.ok(paints < 40, `${w}: fewer paints than deltas`);
    p3 = await side('sim-2');
    assert.match(p3.t, /Step 39 is checked\.$/, `${w}: the newest text is painted last`);
    assert.strictEqual(await rects(), before, `${w}: no layout shift while text streams`);
    await think('sim-2', 'drv-r2', 'Long thoughts: ' + 'the parser keeps every clause in order and checks each one twice. '.repeat(4));
    await ctx.sleep(400);
    p3 = await side('sim-2');
    assert.ok(p3.over, `${w}: long text keeps its newest lines in view`);
    await page(`${w} sparse, long text`);
    await think('sim-2', 'drv-r3', 'So I will list every caller first and keep the old name as an alias for one release. ');
    await ctx.sleep(400);
    await ctx.shot(path.join(OUT, `001-live-activity-side-${w}x${h}.png`));
    /* a finished turn clears it */
    await emit({ type: 'status', sessionId: 'sim-1', status: 'idle' });
    await ctx.sleep(400);
    assert.strictEqual((await side('sim-1')).empty, true, `${w}: cleared when the turn ends`);

    /* ---- dense: the text line under the name ---- */
    await load(15, w, h);
    await feed();
    st = await js(`({side:document.getElementById('stage').dataset.side,d:document.getElementById('stage').dataset.d})`);
    assert.strictEqual(st.side, '0', `${w}: 15 agents: no side panel (${st.d})`);
    const line = (id) => js(`(()=>{const e=document.querySelector('#stage .desk[data-id=${q(id)}] .intent');return e?{t:e.textContent,lk:e.dataset.lk||'',font:parseFloat(getComputedStyle(e).fontSize)}:null})()`);
    const l3 = await line('sim-2');
    assert.strictEqual(l3.t, 'Thinking: So I will list every caller first and keep the old name as an alias for one release.', `${w}: dense line: ${l3.t}`);
    assert.strictEqual(l3.lk, 'think');
    assert.ok(l3.font >= 10.5);
    const l2 = await line('sim-1');
    assert.match(l2.t, /^Running curl -H/); assert.ok(!l2.t.includes(SECRET), `${w}: masked in the dense line too`);
    const l1 = await line('sim-3');
    assert.match(l1.t, /OK|rename/i, `${w}: a waiting agent keeps its request text: ${l1.t}`);
    const d3 = await deskName('sim-2');
    assert.ok(d3 && d3.t === 'Mira' && d3.w > 20, `${w}: the name stays in the dense office`);
    const dBefore = await rects();
    for (let i = 0; i < 12; i++) { await think('sim-2', 'drv-r1', `Dense step ${i} done. `); await ctx.sleep(60); }
    await ctx.sleep(400);
    assert.strictEqual(await rects(), dBefore, `${w}: no layout shift in the dense office`);
    await think('sim-2', 'drv-r4', 'So I will list every caller first and keep the old name as an alias for one release. ');
    await ctx.sleep(400);
    await page(`${w} dense`);
    await ctx.shot(path.join(OUT, `001-live-activity-dense-${w}x${h}.png`));

    /* ---- the setting off: today's text, no side panel ---- */
    await js(`localStorage.setItem('durbar.liveActivity','off')`);
    await load(3, w, h, { density: 'full' });
    await feed();
    st = await js(`({side:document.getElementById('stage').dataset.side,n:document.querySelectorAll('#stage .liveside').length,t:(document.querySelector('#stage .desk[data-id="sim-2"] .task')||{}).textContent})`);
    assert.deepStrictEqual([st.side, st.n], ['0', 0], `${w}: off: no side panel`);
    assert.ok(!/^Thinking:/.test(st.t), `${w}: off: the desk text is today's (${st.t})`);
    await load(15, w, h);
    await feed();
    assert.ok(!/^Thinking:/.test((await line('sim-2')).t), `${w}: off: dense text is today's`);
    await js(`localStorage.removeItem('durbar.liveActivity')`);
    /* Simple (spec 052 FR-081): the tool in plain words, never the command */
    await js(`localStorage.setItem('durbar.detail','simple')`);
    await load(15, w, h);
    await feed();
    assert.strictEqual((await line('sim-1')).t, 'Running a command', `${w}: Simple: plain words`);
    await js(`localStorage.removeItem('durbar.detail')`);
  }
  /* the Settings switch (default on) turns it off and on */
  await load(3, 1440, 900);
  await js(`document.getElementById('settingsBtn').click()`);
  await ctx.waitFor(`!!document.getElementById('liveActSw')`, 8000);
  assert.strictEqual(await js(`document.getElementById('liveActSw').getAttribute('aria-checked')`), 'true', 'on by default');
  await js(`document.getElementById('liveActSw').scrollIntoView({block:'center'})`);
  await ctx.sleep(200);
  await ctx.shot(path.join(OUT, '001-live-activity-setting-1440x900.png'));
  await js(`document.getElementById('liveActSw').click()`);
  assert.strictEqual(await js(`[document.getElementById('liveActSw').getAttribute('aria-checked'),localStorage.getItem('durbar.liveActivity')].join()`), 'false,off', 'switched off and kept');
  await js(`document.getElementById('liveActSw').click()`);
  assert.strictEqual(await js(`localStorage.getItem('durbar.liveActivity')`), 'on', 'switched on again');
  console.log('[001 live activity] PASS');
};
