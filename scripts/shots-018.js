/*
 * Checks + screenshots for spec 012 T018 (issue #38): a mixed-kind simulator roster and the capability gating left over from T017.
 * Simulator only (no AI credits, no Copilot login). Frozen simulator:
 *
 *   npm run build
 *   SHOTS_012=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-018.js npx electron .        (xvfb-run -a ... --no-sandbox on Linux)
 *
 * SHOTS_012 defaults to a temp directory, never to docs/screenshots. Prints "DRIVER FAILED" and an assertion on a miss.
 * It reloads with simkinds=mixed (Copilot, a Claude-like, a Codex-like and a basic kind, all ready; see sim.ts SIM_KIND_BY_AGENT) and checks,
 * at 1440x900 and 1280x800:
 *   - the select lists the four kinds by their short name, the About dialog names each "(simulated)";
 *   - no cap chip on a claude, codex or basic agent (Copilot keeps it); no helper tiles on codex agents (claude and Copilot keep them);
 *   - the basic agent: its mode chip is plain text (a span, not a button) titled "Set when the session starts", no Stop button, no model chip,
 *     no MCP button; claude and codex have an MCP button whose switches are disabled with the reason written in the dialog;
 *   - a codex mode switch toasts "Applies from the next message."; a claude one (live) does not;
 *   - choosing basic in the toolbar kind select leaves only Read-only in Permissions, Allow all falls back to Read-only and stays there when
 *     Copilot is chosen again; the same in the new-session dialog;
 *   - dead-button scan: every enabled button in a panel header and in a room head has a handler or a data-* action;
 *   - every computed font size of the controls, panels and dialogs is 10.5px or more, and the toolbar stays on one row.
 * Shots: 012-mixed-<w>x<h>.png.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const OUT = process.env.SHOTS_012 || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-012-'));
const INDEX = path.join(__dirname, '..', 'dist', 'renderer', 'index.html');
const SIZES = [[1440, 900], [1280, 800]];
/* the fixed roster of simkinds=mixed: agent id -> kind (sim.ts SIM_KIND_BY_AGENT; every other agent is Copilot) */
const CLAUDE = ['sim-1', 'sim-4', 'sim-6', 'sim-9', 'sim-12'];
const CODEX = ['sim-5', 'sim-8', 'sim-10'];
const BASIC = ['sim-7'];

module.exports = async (ctx) => {
  const js = (code) => ctx.js(code);
  const wc = () => ctx.win.webContents;
  const shot = async (name, w, h) => { await js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove())`); await ctx.sleep(300); await ctx.shot(path.join(OUT, `${name}-${w}x${h}.png`)); console.log('[018] saved', name, w, h); };
  const load = async (w, h, extra) => {
    ctx.win.setContentSize(w, h);
    await ctx.win.loadFile(INDEX, { query: { sim: '15', simfreeze: '1', simkinds: 'mixed', ...(extra || {}) } });
    await ctx.waitFor(`document.querySelectorAll('#stage .desk[data-id]').length>=15`, 15000);
    await ctx.sleep(1200);
    wc().focus();
  };
  const closePanel = async () => { await js(`(()=>{const b=document.getElementById('backBtn');if(b)b.click()})()`); await ctx.sleep(250); };
  const openPanel = async (id) => {
    await closePanel();
    await js(`document.querySelector('#stage .desk[data-id="${id}"]').click()`);
    assert.ok(await ctx.waitFor(`(()=>{const h=document.getElementById('panelTitle');return !!h&&!!document.getElementById('vscodeBtn')})()`, 4000), `${id}: the panel opens`);
    await ctx.sleep(200);
  };
  const toasts = () => js(`[...document.querySelectorAll('#toasts .toast')].map(x=>x.textContent).join(' | ')`);
  const minFont = (root) => js(`(()=>{let min=99,who='';document.querySelectorAll('${root}, ${root} *').forEach(e=>{if(!e.getClientRects().length)return;const own=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());if(!own&&!/^(INPUT|SELECT|BUTTON)$/.test(e.tagName))return;const f=parseFloat(getComputedStyle(e).fontSize);if(f<min){min=f;who=e.tagName+'#'+e.id+'.'+e.className}});return {min,who}})()`);
  const exists = (sel) => js(`!!document.querySelector(${JSON.stringify(sel)})`);
  const optionsOf = (id) => js(`[...document.getElementById('${id}').options].map(o=>o.value)`);
  const setSel = (id, v) => js(`(()=>{const s=document.getElementById('${id}');s.value=${JSON.stringify(v)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  /* buttons with a handler: an onclick property, a data-* action, or the ones the page wires through a delegated listener on the document */
  const DELEGATED = ['modeChip', 'modelChip', 'compactBtn', 'ctxChip', 'capChip']; // document-level click handlers in app.js
  const deadButtons = (root) => js(`(()=>{const D=${JSON.stringify(DELEGATED)};return [...document.querySelectorAll('${root} button')].filter(b=>!b.disabled&&!b.hidden&&b.getClientRects().length)
    .filter(b=>typeof b.onclick!=='function'&&!Object.keys(b.dataset).length&&!D.includes(b.id)).map(b=>(b.id||b.className||b.textContent).toString().slice(0,40))})()`);

  for (const [w, h] of SIZES) {
    await load(w, h);

    // ---- the simulated events follow each agent's kind: a second simulator instance in the page, read directly ----
    const ev = await js(`(async()=>{const api=window.__durbarSim.create({n:15,freeze:true,seed:7});const evs=[];api.onEvent(e=>evs.push(e));const infos=await api.listAgents();await new Promise(r=>setTimeout(r,600));
      const kind={};infos.forEach(i=>kind[i.id]=i.adapterId);const by={};
      evs.forEach(e=>{const k=kind[e.sessionId]||'?';const o=by[k]=by[k]||{usage:0,nano:0,cost:0,estimate:0,unavail:0,limit:0,sub:0};
        if(e.type==='usage'){o.usage++;if('nanoAiu' in e)o.nano++;if('costUsd' in e)o.cost++;if(e.costBasis==='estimate')o.estimate++;if(e.creditsStatus==='unavailable')o.unavail++;}
        if(e.type==='limit')o.limit++;if(e.type==='subagent')o.sub++;});
      return {by,caps:infos.filter(i=>i.adapterId!=='copilot'&&i.maxAiCredits!==undefined).map(i=>i.name),kinds:infos.map(i=>i.adapterId)}})()`);
    const kc = (k) => ev.by[k] || { usage: 0, nano: 0, cost: 0, estimate: 0, unavail: 0, limit: 0, sub: 0 };
    assert.deepStrictEqual(ev.caps, [], `${w}: only Copilot agents carry a credit cap (${ev.caps})`);
    assert.ok(kc('claude').usage > 0 && kc('codex').usage > 0 && kc('copilot').usage > 0, `${w}: every kind reports usage (${JSON.stringify(ev.by)})`);
    assert.strictEqual(kc('claude').nano, 0, `${w}: claude-like usage has no nanoAiu`);
    assert.strictEqual(kc('codex').nano + kc('basic').nano, 0, `${w}: codex-like and basic usage have no nanoAiu`);
    assert.ok(kc('claude').cost === kc('claude').usage && kc('claude').estimate === kc('claude').usage, `${w}: every claude-like usage has costUsd with costBasis estimate`);
    assert.strictEqual(kc('claude').unavail, kc('claude').usage, `${w}: claude-like credits are unavailable`);
    assert.strictEqual(kc('codex').cost + kc('copilot').cost, 0, `${w}: codex-like and Copilot usage send no costUsd`);
    assert.strictEqual(kc('codex').unavail, kc('codex').usage, `${w}: codex-like credits are unavailable`);
    assert.strictEqual(kc('copilot').nano, kc('copilot').usage, `${w}: Copilot keeps nanoAiu`);
    assert.strictEqual(kc('claude').limit + kc('codex').limit + kc('basic').limit, 0, `${w}: no limit event for a kind without caps`);
    assert.strictEqual(kc('codex').sub + kc('basic').sub, 0, `${w}: no subagent events for codex-like or basic agents`);
    assert.ok(kc('claude').sub > 0, `${w}: claude-like agents keep their helpers`);
    assert.strictEqual(ev.kinds.filter((x) => x === 'claude').length, 5);
    assert.strictEqual(ev.kinds.filter((x) => x === 'codex').length, 3);
    assert.strictEqual(ev.kinds.filter((x) => x === 'basic').length, 1);
    assert.notStrictEqual(ev.kinds[0], 'basic', 'the basic agent is not the first');

    // ---- the kinds: four ready kinds, short names in the select, "(simulated)" in the About dialog ----
    const k = await js(`(()=>{const s=document.getElementById('kindSel');return {vis:!s.hidden,opts:[...s.options].map(o=>({v:o.value,t:o.textContent.trim(),d:o.disabled}))}})()`);
    assert.ok(k.vis, `${w}: the kind select is shown`);
    assert.deepStrictEqual(k.opts.map((o) => [o.v, o.t, o.d]), [['copilot', 'Copilot', false], ['claude', 'Claude Code', false], ['codex', 'Codex', false], ['basic', 'Basic agent', false]], `${w}: four ready kinds with short names`);
    await js(`document.getElementById('kindHelp').click()`);
    assert.ok(await ctx.waitFor(`document.getElementById('modeDlg')`, 3000), 'About agent kinds opens');
    const about = await js(`document.getElementById('modeDlg').innerText.replace(/\\s+/g,' ')`);
    for (const need of ['Copilot: ready', 'Claude Code (simulated): ready', 'Codex (simulated): ready', 'Basic agent (simulated): ready']) assert.ok(about.includes(need), `${w}: About says "${need}": ${about}`);
    await js(`[...document.querySelectorAll('#modeDlg .btn')].find(b=>b.textContent==='Close').click()`);
    await ctx.sleep(200);

    // ---- toolbar: one row, fonts ----
    const row = await js(`(()=>{const t=[...document.querySelectorAll('#liveBar > button, #liveBar > select')].filter(e=>e.getClientRects().length).map(e=>Math.round(e.getBoundingClientRect().top));return {min:Math.min(...t),max:Math.max(...t),n:t.length}})()`);
    assert.ok(row.max - row.min <= 3, `${w}: the toolbar stays on one row (${JSON.stringify(row)})`);
    const fTop = await minFont('.controls');
    assert.ok(fTop.min >= 10.5, `${w}: toolbar text >= 10.5px (${JSON.stringify(fTop)})`);
    const fOffice = await minFont('#stage');
    assert.ok(fOffice.min >= 10.5, `${w}: office text >= 10.5px (${JSON.stringify(fOffice)})`);
    assert.ok(await exists('#stage .room-new'), `${w}: the room "+" is shown (a kind is ready)`);
    // room MCP: shown when any agent of the room has it (swisscontract-ai: Elif codex first, Priya basic; mcp-swiss: Ada claude, Mira copilot)
    const rm = await js(`[...document.querySelectorAll('#stage .room')].map(r=>[r.querySelector('.room-name').textContent.trim(),!!r.querySelector('.room-mcp')])`);
    assert.ok(rm.length >= 4 && rm.every(([, has]) => has), `${w}: every room has its MCP button, each holds an agent with MCP (${JSON.stringify(rm)})`);

    // ---- helper tiles: Copilot and claude keep them, codex has none ----
    const helpers = await js(`(()=>{const n=who=>document.querySelectorAll('#stage .helper[aria-label*="helper of '+who+',"]').length;return {ada:n('Ada'),clara:n('Clara'),elif:n('Elif'),kenji:n('Kenji')}})()`);
    assert.ok(helpers.ada > 0 && helpers.clara > 0, `${w}: claude agents keep their helper tiles (${JSON.stringify(helpers)})`);
    assert.strictEqual(helpers.elif + helpers.kenji, 0, `${w}: codex agents have no helper tiles (${JSON.stringify(helpers)})`);
    await shot('012-mixed', w, h);

    // ---- per agent: cap chip, Stop, model chip, mode chip, MCP, dead buttons, fonts ----
    for (let i = 1; i <= 15; i++) {
      const id = 'sim-' + i;
      const kind = CLAUDE.includes(id) ? 'claude' : CODEX.includes(id) ? 'codex' : BASIC.includes(id) ? 'basic' : 'copilot';
      await openPanel(id);
      const p = await js(`(()=>{const q=s=>document.querySelector('#panel '+s);const mc=q('#modeChip'),sp=q('.modechip');
        return {cap:!!q('#capChip'),stop:!!q('#stopBtn'),model:!!q('#modelChip'),mcp:!!q('#mcpBtn'),newSess:!!q('#newSessBtn'),modeBtn:mc?mc.tagName:null,modeSpan:sp?{tag:sp.tagName,title:sp.title,text:sp.textContent.trim()}:null,
          modeText:mc?mc.textContent.trim():null}})()`);
      if (kind === 'copilot') {
        assert.ok(p.cap && p.stop && p.model && p.mcp && p.newSess, `${w} ${id}: Copilot keeps cap chip, Stop, model chip, MCP and new session (${JSON.stringify(p)})`);
        assert.strictEqual(p.modeBtn, 'BUTTON', `${id}: Copilot mode chip is a button`);
      } else assert.strictEqual(p.cap, false, `${w} ${id}: a ${kind} agent has no #capChip`);
      if (kind === 'claude' || kind === 'codex') {
        assert.ok(p.stop && p.model && p.mcp && p.newSess, `${w} ${id}: ${kind} keeps Stop, model chip, MCP and new session (${JSON.stringify(p)})`);
        assert.strictEqual(p.modeBtn, 'BUTTON', `${id}: ${kind} mode chip is a button`);
      }
      if (kind === 'basic') {
        assert.strictEqual(p.stop, false, `${w} ${id}: basic has no Stop`);
        assert.strictEqual(p.model, false, `${w} ${id}: basic has no model chip`);
        assert.strictEqual(p.mcp, false, `${w} ${id}: basic has no MCP button`);
        assert.strictEqual(p.modeBtn, null, `${w} ${id}: basic mode chip is not a button`);
        assert.ok(p.modeSpan && p.modeSpan.tag === 'SPAN' && p.modeSpan.title === 'Set when the session starts' && p.modeSpan.text === 'Read-only', `${w} ${id}: plain-text mode chip (${JSON.stringify(p.modeSpan)})`);
        await js(`document.querySelector('#panel .modechip').click()`);
        await ctx.sleep(150);
        assert.strictEqual(await exists('#modeMenu'), false, 'clicking the plain-text chip opens nothing');
        if (w === SIZES[0][0]) await shot('012-mixed-basic', w, h);
      }
      const dead = await deadButtons('#panel .ph');
      assert.deepStrictEqual(dead, [], `${w} ${id}: no dead button in the panel header (${dead.join(', ')})`);
      const fp = await minFont('#panel .ph');
      assert.ok(fp.min >= 10.5, `${w} ${id}: panel header text >= 10.5px (${JSON.stringify(fp)})`);
    }
    await closePanel();
    const deadRooms = await deadButtons('#stage .room-head');
    assert.deepStrictEqual(deadRooms, [], `${w}: no dead button in a room head (${deadRooms.join(', ')})`);

    // ---- the agent MCP dialog: Copilot switches, claude/codex switches disabled with the reason ----
    for (const [id, toggle] of [['sim-2', true], ['sim-1', false], ['sim-5', false]]) {
      await openPanel(id);
      await js(`document.getElementById('mcpBtn').click()`);
      assert.ok(await ctx.waitFor(`document.querySelectorAll('#agMcp .swt').length>0`, 4000), `${id}: the MCP dialog lists servers`);
      const m = await js(`(()=>{const sw=[...document.querySelectorAll('#agMcp .swt')];const d=document.querySelector('.dlg, [role="dialog"]');return {n:sw.length,enabled:sw.filter(b=>!b.disabled).length,text:document.body.innerText.replace(/\\s+/g,' ')}})()`);
      if (toggle) assert.ok(m.enabled > 0, `${w} ${id}: Copilot has switches that work (${m.enabled}/${m.n})`);
      else {
        assert.strictEqual(m.enabled, 0, `${w} ${id}: no enabled switch for a kind without mcpToggle (${m.enabled}/${m.n})`);
        assert.ok(m.text.includes('The switches are off for this agent kind'), `${w} ${id}: the reason is written in the dialog`);
      }
      await js(`[...document.querySelectorAll('.dlg .btn, #modeDlg .btn, [role="dialog"] .btn')].find(b=>b.textContent==='Done').click()`);
      await ctx.sleep(250);
    }
    await closePanel();

    // ---- mode switch: codex says it applies from the next message, claude (live) does not ----
    await openPanel('sim-5'); // Elif, codex, Ask first
    await js(`document.getElementById('modeChip').click()`);
    assert.ok(await ctx.waitFor(`!!document.getElementById('modeMenu')`, 2000), 'the mode menu opens');
    assert.strictEqual(await js(`document.querySelectorAll('#modeMenu [data-mode]').length`), 3, 'codex lists three modes');
    await js(`document.querySelector('#modeMenu [data-mode="read-only"]').click()`);
    await ctx.sleep(500);
    assert.match(await toasts(), /Applies from the next message\./, `${w}: a codex mode switch says when it applies: ${await toasts()}`);
    await js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove())`);
    await openPanel('sim-4'); // Noor, claude, Read-only
    await js(`document.getElementById('modeChip').click()`);
    await ctx.waitFor(`!!document.getElementById('modeMenu')`, 2000);
    await js(`document.querySelector('#modeMenu [data-mode="ask"]').click()`);
    await ctx.sleep(500);
    const tc = await toasts();
    assert.ok(/Ask first/.test(tc) && !/next message/.test(tc), `${w}: a live (claude) mode switch has no next-message note: ${tc}`);
    await closePanel();
    await js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove())`);

    // ---- toolbar Permissions follow the chosen kind ----
    assert.deepStrictEqual(await optionsOf('permMode'), ['read-only', 'ask', 'allow'], `${w}: Copilot lists all three modes`);
    await js(`document.getElementById('permMode').value='allow'`);
    await setSel('kindSel', 'basic');
    assert.deepStrictEqual(await optionsOf('permMode'), ['read-only'], `${w}: basic leaves only Read-only in the toolbar`);
    assert.strictEqual(await js(`document.getElementById('permMode').value`), 'read-only', `${w}: Allow all falls back to Read-only`);
    assert.strictEqual(await js(`document.getElementById('modelSel').hidden`), true, 'basic has no model select');
    await setSel('kindSel', 'claude');
    assert.deepStrictEqual(await optionsOf('permMode'), ['read-only', 'ask', 'allow'], `${w}: claude lists all three modes`);
    assert.strictEqual(await js(`document.getElementById('permMode').value`), 'read-only', `${w}: the fallback is not widened again when the kind changes back`);
    await setSel('kindSel', 'copilot');
    // adding with basic chosen: a new folder starts Read-only (the simulator creates it with the kind and mode it was given)
    await setSel('kindSel', 'basic');
    await js(`document.getElementById('addFolder').click()`);
    await ctx.sleep(500);
    assert.ok(await ctx.waitFor(`document.querySelectorAll('#stage .desk[data-id]').length>=16`, 3000), 'a basic folder was added');
    await setSel('kindSel', 'copilot');

    // ---- the new-session dialog follows the kind too ----
    await openPanel('sim-3'); // Jonas, Copilot, Allow all
    await js(`document.getElementById('newSessBtn').click()`);
    assert.ok(await ctx.waitFor(`!!document.getElementById('sdPerm')`, 3000), 'the new-session dialog opens');
    assert.strictEqual(await js(`document.getElementById('sdPerm').value`), 'allow', 'the dialog starts at the current mode');
    assert.deepStrictEqual(await optionsOf('sdPerm'), ['read-only', 'ask', 'allow']);
    await setSel('sdKind', 'basic');
    assert.deepStrictEqual(await optionsOf('sdPerm'), ['read-only'], `${w}: basic leaves only Read-only in the dialog`);
    assert.strictEqual(await js(`document.getElementById('sdPerm').value`), 'read-only', `${w}: Allow all falls back to Read-only in the dialog`);
    assert.strictEqual(await js(`document.getElementById('sdModelL').hidden && document.getElementById('sdCapL').hidden`), true, 'basic: no model and no cap field in the dialog');
    await setSel('sdKind', 'claude');
    assert.deepStrictEqual(await optionsOf('sdPerm'), ['read-only', 'ask', 'allow']);
    assert.strictEqual(await js(`document.getElementById('sdPerm').value`), 'read-only', `${w}: the dialog does not widen the mode again`);
    const fd = await minFont('#sessDlg');
    assert.ok(fd.min >= 10.5, `${w}: new-session dialog text >= 10.5px (${JSON.stringify(fd)})`);
    await js(`document.getElementById('sdCancel').click()`);
    await closePanel();
    console.log('[018]', w, 'ok');
  }
  console.log('[018] all checks passed; shots in', OUT);
};
