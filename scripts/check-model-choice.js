/*
 * Spec 030 FR-060..FR-066 (owner report 2026-10-31): model, reasoning effort and context chosen one after another stay together, in any order,
 * for each agent app, and the words say when they apply. Simulator only (no AI credits, no account).
 *
 *   npm run check:ui -- --only check-model-choice
 *   OUT=<folder>            (optional) where the screenshots go (default: a temp folder)
 *   MC_ONE_SIZE=1           one size only (a quick run, the planted-mutation runs)
 *
 * At 1440x900 and 1280x800 with 15 agents, with `simmodels=rich` (a second Copilot model with a long tier, a Claude `[1m]` alias, a Codex list):
 *   - every order of model, effort and context on an idle Copilot agent: what the adapter call gets, what the chip names, what the next menu ticks;
 *   - the same during a reply (queued): one queued switch holds all three, the older ones are cancelled, Cancel leaves nothing behind, and a reply
 *     that ends applies all three;
 *   - the same on a session that has not started (main answers `applied` and no model event comes);
 *   - Claude Code and Codex, both orders, idle and during a reply (they apply at once, used from the next message);
 *   - a stale menu (the state changes while it is open), a rapid double selection with a slow answer, a choice the new model cannot keep (said, not silent);
 *   - Undo after merged choices; the words of each app, never "next session".
 * A miss is listed and fails the run at the end (DRIVER FAILED).
 */
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const OUT = process.env.OUT || process.env.SHOTS_OUT || require('os').tmpdir();
const SIZES = process.env.MC_ONE_SIZE ? [[1440, 900]] : [[1440, 900], [1280, 800]];
const PERMS = [['model', 'effort', 'tier'], ['model', 'tier', 'effort'], ['effort', 'model', 'tier'], ['effort', 'tier', 'model'], ['tier', 'model', 'effort'], ['tier', 'effort', 'model']];
const STEP = { model: (m) => `[data-pick=${jsLiteral(m)}]`, effort: (e) => `[data-effort=${jsLiteral(e)}]`, tier: () => '[data-tier="1"]' };

/* In the page: every setModel and cancelQueuedModel call, in order. `quiet`: answer as main does for a session that has not started (FR-013: applied, no event). `delay`: a slow answer. */
const SPY = `(()=>{if(window.__mc)return;const b=window.__durbarSimUi.bridge(),M=window.__mc={reqs:[],cancels:[],busy:0,done:0,delay:0,quiet:false};
  const set=b.setModel.bind(b),can=b.cancelQueuedModel.bind(b);
  b.setModel=async(id,req)=>{M.busy++;M.reqs.push(JSON.parse(JSON.stringify(req)));try{if(M.delay)await new Promise(r=>setTimeout(r,M.delay));
    if(M.refuse>0){M.refuse--;return {ok:false,error:'That model is not in the list your account offers.'};}
    if(M.quiet)return {ok:true,result:{status:'applied',model:req.model,message:'Used from the first message: this agent has not started yet.'}};const r=await set(id,req);M.queued=(M.queued||0)+(r&&r.result&&r.result.status==='queued'?1:0);return r;}finally{M.busy--;M.done++;}};
  b.cancelQueuedModel=async(id,q)=>{M.cancels.push(q);return can(id,q);};})()`;

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js, click, text, exists } = H;
  const fails = [];
  const check = (cond, msg) => { if (!cond) { fails.push(msg); console.log('FAIL ' + msg); } };
  const same = (got, want, msg) => check(JSON.stringify(got) === JSON.stringify(want), `${msg}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  const jval = async (expr) => JSON.parse(await js(`JSON.stringify(${expr})`) ?? 'null');

  const agentExpr = (id) => `window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(id)})`;
  const stateOf = (id) => jval(`(a=>({model:a.info.model,effort:a.info.effort||null,tier:a.info.tier||'default'}))(${agentExpr(id)})`);
  const pendingOf = (id) => jval(`(a=>a.pendingModel&&a.pendingModel.req?{model:a.pendingModel.req.model,effort:a.pendingModel.req.effort||null,tier:a.pendingModel.req.contextTier||'default'}:(a.pendingModel?'no request kept':null))(${agentExpr(id)})`);
  const lastReq = async () => { const r = await jval(`__mc.reqs[__mc.reqs.length-1]||null`); return r && { model: r.model, effort: r.effort || null, tier: r.contextTier || 'default' }; };
  const resetSpy = (o = {}) => js(`Object.assign(__mc,{reqs:[],cancels:[],queued:0,delay:${Number(o.delay) || 0},quiet:${!!o.quiet},refuse:0})`);
  /* the agent's state as this scenario starts: through the simulator's own switch, whose event sets the window's state; `keepSim`: an agent mid-reply, whose switch would queue */
  const putOn = async (id, model, o = {}) => {
    await js(`(async(id,model,keep)=>{const a=window.__durbarSimUi.agents().find(x=>x.id===id);__mc.quiet=false;if(keep){a.info.model=model;a.info.effort=undefined;a.info.tier=undefined;}else await window.__durbarSimUi.bridge().setModel(id,{model,effort:null,contextTier:'default'});})(${jsLiteral(id)},${jsLiteral(model)},${jsLiteral(!!o.keepSim)})`);
    await until(`__mc.busy===0`); await settle(); await H.clearToasts(); await resetSpy(o);
  };
  const open = async (id) => {
    if (await js(`document.body.classList.contains('panel-open')`)) { await js(`document.getElementById('backBtn').click()`); await until(`!document.body.classList.contains('panel-open')`, 4000); }
    await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"]`)}).click()`);
    await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('modelChip')`, 15000); await settle();
  };
  const openMenu = async () => { await click('#modelChip'); await until(`!!document.getElementById('modelMenu')`); };
  /* one choice through the real menu; the dialog of a costlier choice is answered; waits for the answer, never a fixed time */
  const choose = async (sel, what) => {
    const before = await js(`__mc.done`);
    await openMenu();
    if (!(await exists(`#modelMenu ${sel}`))) { check(false, `${what}: the menu has no ${sel}: ${(await text('#modelMenu')).replace(/\s+/g, ' ').slice(0, 200)}`); await H.key('Escape'); await until(`!document.getElementById('modelMenu')`); return; }
    await click(`#modelMenu ${sel}`);
    const end = Date.now() + 5000;
    for (;;) {
      if (await exists('#modeDlg')) await js(`(b=>{if(b)b.click();})(document.querySelector('#modeDlg .btn.primary'))`);
      else if ((await js(`__mc.done`)) > before && (await js(`__mc.busy`)) === 0) break;
      if (Date.now() > end) { check(false, `${what}: no answer after ${sel}`); break; }
      await ctx.sleep(30);
    }
    await until(`!document.getElementById('modelMenu')&&!document.getElementById('modeDlg')`);
  };
  const ticks = async () => { await openMenu(); const t = await jval(`({model:(document.querySelector('#modelMenu [data-pick][aria-checked="true"]')||{dataset:{}}).dataset.pick||null,effort:(document.querySelector('#modelMenu [data-effort][aria-pressed="true"]')||{dataset:{}}).dataset.effort||null,tier:(document.querySelector('#modelMenu [data-tier][aria-checked="true"]')?'long':'default')})`); return t; };
  const closeMenu = async () => { await H.key('Escape'); await until(`!document.getElementById('modelMenu')`); };
  const chipName = () => js(`(document.getElementById('modelChip')||{getAttribute:()=>''}).getAttribute('aria-label')||''`);
  const noNextSession = async (what) => { const t = await js(`[...document.querySelectorAll('#toasts .toast,#modelMenu')].map(e=>e.innerText).join(' ')`); check(!/next session/i.test(t), `${what}: the words say "next session": ${t.slice(0, 160)}`); };

  for (const [W, H_] of SIZES) {
    const tag = `${W}x${H_}`;
    const shot = (name) => H.shot(path.join(OUT, `030-choice-${name}-${tag}.png`), { prep: 'calm', keepActions: true, tag: 'model-choice', what: name });
    const menuFits = async (what) => { const r = await jval(`(m=>{const r=m.getBoundingClientRect();return {t:r.top,b:r.bottom,l:r.left,r:r.right,iw:innerWidth,ih:innerHeight}})(document.getElementById('modelMenu'))`); check(r.t >= 0 && r.l >= 0 && r.b <= r.ih && r.r <= r.iw, `${what}: the menu leaves the window at ${tag}: ${JSON.stringify(r)}`); };

    // ---- Copilot ----
    await H.load({ w: W, h: H_, query: { simmodels: 'rich' }, ready: 'fit' }); await js(SPY);
    const idle = await js(`window.__durbarSimUi.agents().find(a=>a.name==='Noor').id`), busy = await js(`window.__durbarSimUi.agents().find(a=>a.name==='Ada').id`);
    const want = { model: 'sim-wide', effort: 'high', tier: 'long' };
    const steps = { model: STEP.model('sim-wide'), effort: STEP.effort('high'), tier: STEP.tier() };
    await open(idle);
    for (const perm of PERMS) {
      const what = `Copilot idle ${perm.join(' > ')} at ${tag}`;
      await putOn(idle, 'sim-deep');
      for (const k of perm) await choose(steps[k], what);
      same(await lastReq(), want, `${what}: the adapter call`);
      same(await stateOf(idle), want, `${what}: the session`);
      const nm = await chipName();
      check(/Sim Wide/.test(nm) && /high effort/.test(nm) && /long context/.test(nm), `${what}: the chip's name: ${nm}`);
      same(await ticks(), want, `${what}: the next menu`); await noNextSession(what); await closeMenu();
      check(/from the next message/.test(await text('#toasts')), `${what}: the toast says when: ${await text('#toasts')}`);
    }

    // not started: main answers applied, no event comes (FR-013)
    for (const perm of PERMS) {
      const what = `Copilot not started ${perm.join(' > ')} at ${tag}`;
      await putOn(idle, 'sim-deep', { quiet: true });
      for (const k of perm) await choose(steps[k], what);
      same(await lastReq(), want, `${what}: the call to main`);
      same(await stateOf(idle), want, `${what}: the session`);
      same(await ticks(), want, `${what}: the next menu`); await closeMenu();
    }
    await resetSpy();

    // a stale menu: the state changes while it is open; the click in it changes only what it names
    {
      const what = `stale menu at ${tag}`;
      await putOn(idle, 'sim-deep');
      await openMenu();
      await js(`window.__durbarSimUi.bridge().setModel(${jsLiteral(idle)},{model:'sim-wide',effort:'low',contextTier:'default'})`); await until(`${agentExpr(idle)}.info.model==='sim-wide'`);
      const n = await js(`__mc.done`);
      await click(`#modelMenu ${STEP.effort('high')}`); await until(`__mc.done>${n}&&__mc.busy===0`);
      same(await lastReq(), { model: 'sim-wide', effort: 'high', tier: 'default' }, `${what}: the runtime's model is kept`);
      same(await stateOf(idle), { model: 'sim-wide', effort: 'high', tier: 'default' }, `${what}: the session`);
    }

    // a rapid double selection with a slow answer: the second is built on the first
    {
      const what = `rapid double at ${tag}`;
      await putOn(idle, 'sim-deep', { delay: 200 });
      await js(`(()=>{document.getElementById('modelChip').click();document.querySelector(${jsLiteral(`#modelMenu ${STEP.model('sim-wide')}`)}).click();document.getElementById('modelChip').click();document.querySelector(${jsLiteral(`#modelMenu ${STEP.effort('high')}`)}).click();})()`);
      await until(`__mc.reqs.length>=2&&__mc.busy===0&&!document.getElementById('modeDlg')`);
      same(await lastReq(), { model: 'sim-wide', effort: 'high', tier: 'default' }, `${what}: the last call`);
      same(await stateOf(idle), { model: 'sim-wide', effort: 'high', tier: 'default' }, `${what}: the session`);
      same(await js(`__mc.reqs.length`), 2, `${what}: one call per choice`);
    }

    // a choice the next model cannot keep is dropped and said, and Undo brings everything back
    {
      const what = `dropped choice at ${tag}`;
      await putOn(idle, 'sim-deep');
      await choose(STEP.effort('high'), what); await choose(STEP.tier(), what); await H.clearToasts();
      await choose(STEP.model('sim-fast'), what); // cheaper, no efforts, no long tier
      same(await stateOf(idle), { model: 'sim-fast', effort: null, tier: 'default' }, `${what}: the session`);
      const t = await text('#toasts');
      check(/long context/i.test(t) && /effort/i.test(t) && /Sim Fast/.test(t), `${what}: the toast says what was dropped: ${t}`);
      await click('#toasts .toast-act'); await until(`${agentExpr(idle)}.info.model==='sim-deep'`); await until(`__mc.busy===0`);
      same(await stateOf(idle), { model: 'sim-deep', effort: 'high', tier: 'long' }, `undo after merged choices at ${tag}`);
    }


    // a refused switch leaves the state alone and says why (main refuses a stale or unknown model); the chip and the next menu are as before
    {
      const what = `refused switch at ${tag}`;
      await open(idle); await putOn(idle, 'sim-deep');
      await js(`__mc.refuse=1`);
      await choose(STEP.model('sim-wide'), what);
      same(await stateOf(idle), { model: 'sim-deep', effort: null, tier: 'default' }, `${what}: the session`);
      check(/Sim Deep/.test(await chipName()) && !/Sim Wide/.test(await chipName()), `${what}: the chip: ${await chipName()}`);
      check(/Could not change the model/.test(await text('#toasts')), `${what}: the toast says why: ${await text('#toasts')}`);
      same(await ticks(), { model: 'sim-deep', effort: null, tier: 'default' }, `${what}: the next menu`); await closeMenu();
    }

    // during a reply, a costlier model on top of a queued one still asks (FR-061); the effort on the queued model does not ask again
    {
      const what = `ask with a queued switch at ${tag}`;
      await open(busy); await putOn(busy, 'sim-fast', { keepSim: true });
      /* true when the dialog came up (and is answered Switch); false when the call went out without one */
      const dialogAfter = async (sel) => {
        await openMenu(); const n = await js('__mc.done'); await click(`#modelMenu ${sel}`);
        let asked = false;
        const end = Date.now() + 3000;
        while (Date.now() < end) {
          if (await exists('#modeDlg')) { asked = true; break; }
          if ((await js('__mc.done')) > n && (await js('__mc.busy')) === 0) break;
          await ctx.sleep(25);
        }
        if (asked) await js(`(b=>{if(b)b.click();})(document.querySelector('#modeDlg .btn.primary'))`);
        await until(`!document.getElementById('modeDlg')&&__mc.busy===0`); await H.clearToasts();
        return asked;
      };
      check(await dialogAfter(STEP.model('sim-mid')), `${what}: the first, costlier model asks`);
      check(await dialogAfter(STEP.model('sim-wide')), `${what}: another costlier model on top of the queued one asks`);
      check(!(await dialogAfter(STEP.effort('high'))), `${what}: only the effort on the queued model does not ask again`);
      same(await pendingOf(busy), { model: 'sim-wide', effort: 'high', tier: 'default' }, `${what}: the queued choice`);
      await openMenu(); await click('#modelMenu [data-cancelq]'); await until(`!${agentExpr(busy)}.pendingModel`);
    }

    // a refused replacement keeps the earlier queued switch (review on PR 935)
    {
      const what = `refused replacement at ${tag}`;
      await open(busy); await putOn(busy, 'sim-deep', { keepSim: true });
      await choose(STEP.model('sim-wide'), what);
      same(await pendingOf(busy), { model: 'sim-wide', effort: null, tier: 'default' }, `${what}: queued first`);
      await js(`__mc.refuse=1`);
      await choose(STEP.effort('high'), what);
      same(await pendingOf(busy), { model: 'sim-wide', effort: null, tier: 'default' }, `${what}: the earlier switch is still queued`);
      same(await js(`${agentExpr(busy)}.pendingModel&&${agentExpr(busy)}.pendingModel.queueId?1:0`), 1, `${what}: with a queue id of its own`);
      check(/Could not change the model/.test(await text('#toasts')) && !/was cancelled/.test(await text('#toasts')), `${what}: the toast: ${await text('#toasts')}`);
      await openMenu(); check(/Sim Wide/.test(await text('#modelMenu .mm-pend')), `${what}: the menu still names it`);
      await click('#modelMenu [data-cancelq]'); await until(`!${agentExpr(busy)}.pendingModel`);
    }

    // during a reply: one queued switch holds all three
    await open(busy);
    for (const perm of PERMS) {
      const what = `Copilot during a reply ${perm.join(' > ')} at ${tag}`;
      await putOn(busy, 'sim-deep', { keepSim: true });
      for (const k of perm) await choose(steps[k], what);
      same(await lastReq(), want, `${what}: the adapter call`);
      same(await pendingOf(busy), want, `${what}: the queued choice`);
      same(await stateOf(busy), { model: 'sim-deep', effort: null, tier: 'default' }, `${what}: the current model is unchanged until the reply ends`);
      same((await jval(`__mc.cancels`)).length, perm.length - 1, `${what}: the older queued switches are cancelled`);
      same(await ticks(), want, `${what}: the menu ticks what comes next`);
      const pend = await text('#modelMenu .mm-pend');
      check(/Sim Wide/.test(pend) && /long context/.test(pend) && /high effort/.test(pend) && /when this reply ends/.test(pend), `${what}: the pending line: ${pend}`);
      await noNextSession(what);
      if (perm === PERMS[0]) { await menuFits(what); await shot('queued'); }
      await click('#modelMenu [data-cancelq]'); await until(`!${agentExpr(busy)}.pendingModel`);
      same(await pendingOf(busy), null, `${what}: Cancel leaves nothing`);
    }

    // a reply that ends applies all three, one switch; a cancelled one applies nothing (frozen replies, ended by the simulator's hook, so the queue is always in play)
    for (const [name, cancel] of [['Mira', true], ['Ada', false]]) {
      const id = await js(`window.__durbarSimUi.agents().find(a=>a.name===${jsLiteral(name)}).id`);
      const what = `reply ends${cancel ? ' after Cancel' : ''} at ${tag}`;
      await open(id);
      await putOn(id, 'sim-deep', { keepSim: true });
      for (const k of ['tier', 'model', 'effort']) await choose(steps[k], what);
      same(await js(`__mc.queued`), 3, `${what}: each choice was queued`);
      same(await lastReq(), want, `${what}: the adapter call`);
      if (cancel) { await openMenu(); await click('#modelMenu [data-cancelq]'); await until(`!${agentExpr(id)}.pendingModel`); }
      const models = `document.getElementById('chat').innerText.split('Model set to').length`, before = await js(models);
      await js(`window.__simFinishTurn(${jsLiteral(id)})`);
      await until(`!${agentExpr(id)}.pendingModel&&${agentExpr(id)}.state!=='working'&&${agentExpr(id)}.state!=='thinking'`, 8000); await settle();
      same(await stateOf(id), cancel ? { model: 'sim-deep', effort: null, tier: 'default' } : want, `${what}: the session`);
      same((await js(models)) - before, cancel ? 0 : 1, `${what}: lines in the chat for the switch`);
    }

    // ---- Claude Code and Codex: the other model lists; they take the choice at once and use it from the next message ----
    await H.load({ w: W, h: H_, query: { simmodels: 'rich', simkinds: 'mixed' }, ready: 'fit' }); await js(SPY);
    const pickAgent = (kind, busyOne) => js(`(window.__durbarSimUi.agents().find(a=>!a.parent&&a.live&&(a.info||{}).adapterId===${jsLiteral(kind)}&&${jsLiteral(busyOne ? ['working', 'thinking'] : ['idle', 'done', 'error'])}.includes(a.state))||{}).id||''`);
    for (const [kind, from, to, name] of [['claude', 'sonnet', 'sonnet[1m]', 'Sim Sonnet (1M context)'], ['codex', 'sim-codex-a', 'sim-codex-b', 'Sim Codex B']]) {
      for (const busyOne of [false, true]) {
        const id = await pickAgent(kind, busyOne);
        if (!id) { check(!busyOne, `no idle ${kind} agent at ${tag}`); console.log(`[model-choice] no busy ${kind} agent in this roster`); continue; }
        await open(id);
        for (const [order, list] of [['model > effort', [STEP.model(to), STEP.effort('high')]], ['effort > model', [STEP.effort('high'), STEP.model(to)]]]) {
          for (const quiet of busyOne ? [false] : [false, true]) {
            const what = `${kind} ${busyOne ? 'during a reply' : quiet ? 'not started' : 'idle'} ${order} at ${tag}`;
            await putOn(id, from, { quiet });
            for (const s of list) await choose(s, what);
            same(await lastReq(), { model: to, effort: 'high', tier: 'default' }, `${what}: the adapter call`);
            same(await stateOf(id), { model: to, effort: 'high', tier: 'default' }, `${what}: the session`);
            same(await pendingOf(id), null, `${what}: nothing queued`);
            check((await text('#modelChip')).includes(name), `${what}: the chip: ${await text('#modelChip')}`);
            check(/from the next message/.test(await text('#toasts')), `${what}: the toast: ${await text('#toasts')}`);
            const t = await ticks();
            same(t, { model: to, effort: 'high', tier: 'default' }, `${what}: the next menu`);
            check(/Applies from the next message/.test(await text('#modelMenu')), `${what}: the menu's words`);
            await noNextSession(what);
            if (order === 'model > effort' && !quiet && !busyOne) { await menuFits(what); await shot(kind); }
            await closeMenu();
          }
        }
        await resetSpy();
      }
    }
    // Claude Code's own default: `auto` in the session is the list's `default` entry, so its effort can be set
    {
      const id = await pickAgent('claude', false);
      await open(id); await putOn(id, 'auto');
      await openMenu();
      check(await exists(`#modelMenu ${STEP.effort('high')}`), `Claude on its default offers the efforts at ${tag}`);
      same(await js(`(document.querySelector('#modelMenu [data-pick][aria-checked="true"]')||{dataset:{}}).dataset.pick||null`), 'default', `Claude's default is ticked at ${tag}`);
      await closeMenu();
      await choose(STEP.effort('high'), `Claude default effort at ${tag}`);
      const eff = await stateOf(id);
      same(eff.effort, 'high', `Claude default keeps the effort at ${tag}`);
    }
  }

  assert.ok(!fails.length, `${fails.length} check(s) failed:\n${fails.join('\n')}`);
  console.log('[model-choice] all checks passed');
};
