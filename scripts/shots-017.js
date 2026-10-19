/*
 * Checks + screenshots for spec 012 T017 (issue #37): choose the agent kind, unavailable kinds, controls gated by capability.
 * Simulator only (no AI credits, no Copilot login). Frozen simulator:
 *
 *   npm run build
 *   SHOTS_012=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-017.js npx electron .        (xvfb-run -a ... --no-sandbox on Linux)
 *
 * SHOTS_012 defaults to a temp directory, never to docs/screenshots. Exits non-zero ("DRIVER FAILED") on a miss. What it checks:
 *   - One adapter (default): #kindSel and the "?" button are hidden, the new-session dialog has no kind select, and the toolbar
 *     has the same height as with the picker (FR-059). Shots: 012-single-<w>x<h>.png.
 *   - simkinds=solo (Copilot ready, Claude Code not installed, Codex too old): one ready harness, so no picker (FR-136).
 *   - simkinds=1 (Copilot and Claude Code ready, Codex too old):
 *     the select is visible, has a label, sits before Permissions; Copilot is enabled, the others are disabled and name their
 *     state; a not-ready kind is blocked by the UI (toolbar and new-session dialog) and by the simulator; the About dialog opens
 *     with the keyboard, lists every kind with its state and hint, keeps focus inside, "Check again" works and Esc returns focus;
 *     a kind other than the default hides model and effort; the toolbar does not wrap at 1280x800; every computed font size of
 *     the controls and dialogs is 10.5px or more. Shots: 012-picker-<w>x<h>.png and the dialog.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const OUT = process.env.SHOTS_012 || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-012-'));
const INDEX = path.join(__dirname, '..', 'dist', 'renderer', 'index.html');
const SIZES = [[1440, 900], [1280, 800]];

module.exports = async (ctx) => {
  const js = (code) => ctx.js(code);
  const wc = () => ctx.win.webContents;
  const key = async (keyCode, modifiers) => {
    wc().sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (keyCode === 'Return') wc().sendInputEvent({ type: 'char', keyCode: '\r', modifiers }); // Enter activates a button on the char event
    wc().sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await ctx.sleep(120);
  };
  const shot = async (name, w, h) => { await js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove())`); await ctx.sleep(300); await ctx.shot(path.join(OUT, `${name}-${w}x${h}.png`)); console.log('[017] saved', name, w, h); };
  const load = async (w, h, extra) => {
    ctx.win.setContentSize(w, h);
    await ctx.win.loadFile(INDEX, { query: { sim: '15', simfreeze: '1', ...(extra || {}) } });
    await ctx.waitFor(`document.querySelectorAll('#stage .desk[data-id]').length>=15`, 15000);
    await ctx.sleep(1200);
    wc().focus();
  };
  const vis = (id) => `(()=>{const e=document.getElementById('${id}');return !!e&&!e.hidden&&e.getClientRects().length>0})()`;
  const headerH = () => js(`Math.round(document.querySelector('.controls').getBoundingClientRect().height)`);
  /* the smallest computed font size among visible elements with their own text, inside `root` */
  const minFont = (root) => js(`(()=>{let min=99,who='';document.querySelectorAll('${root}, ${root} *').forEach(e=>{if(!e.getClientRects().length)return;const own=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());if(!own&&!/^(INPUT|SELECT|BUTTON)$/.test(e.tagName))return;const f=parseFloat(getComputedStyle(e).fontSize);if(f<min){min=f;who=e.tagName+'#'+e.id+'.'+e.className}});return {min,who}})()`);
  const inDialog = () => js(`(()=>{const d=document.getElementById('modeDlg');return !!d&&d.contains(document.activeElement)})()`);

  const heights = {};
  for (const [w, h] of SIZES) {
    // ---- one adapter: nothing new is visible ----
    await load(w, h);
    assert.strictEqual(await js(vis('kindSel')), false, `${w}: single adapter, #kindSel hidden`);
    assert.strictEqual(await js(vis('kindHelp')), false, `${w}: single adapter, "?" hidden`);
    assert.strictEqual(await js(vis('modelSel')), true, `${w}: model select still shown`);
    heights[w] = await headerH();
    await shot('012-single', w, h);
    console.log('[017]', w, 'one adapter: picker hidden, header height', heights[w]);

    // ---- FR-136: three kinds but only Copilot ready: no picker, no "?" ----
    await load(w, h, { simkinds: 'solo' });
    assert.strictEqual(await js(vis('kindSel')), false, `${w}: one ready harness, #kindSel hidden`);
    assert.strictEqual(await js(vis('kindHelp')), false, `${w}: one ready harness, "?" hidden`);
    assert.strictEqual(await js(`document.getElementById('kindSel').value`), 'copilot', 'the hidden select holds the ready harness');

    // ---- three kinds, two ready ----
    await load(w, h, { simkinds: '1' });
    assert.strictEqual(await js(vis('kindSel')), true, `${w}: #kindSel visible`);
    assert.strictEqual(await js(vis('kindHelp')), true, `${w}: "?" visible`);
    const k = await js(`(()=>{const s=document.getElementById('kindSel'),l=document.querySelector('label.sr-only[for="kindSel"]'),p=document.getElementById('permMode'),b=document.getElementById('kindHelp');
      return {opts:[...s.options].map(o=>({v:o.value,t:o.textContent.trim(),d:o.disabled})),value:s.value,label:l?l.textContent.trim():null,
        before:!!(s.compareDocumentPosition(p)&Node.DOCUMENT_POSITION_FOLLOWING),helpBefore:!!(b.compareDocumentPosition(p)&Node.DOCUMENT_POSITION_FOLLOWING),helpLabel:b.getAttribute('aria-label')}})()`);
    console.log('[017]', w, 'kinds', JSON.stringify(k.opts.map((o) => `${o.v}${o.d ? ' (disabled)' : ''}: ${o.t}`)));
    assert.deepStrictEqual(k.opts.map((o) => [o.v, o.d]), [['copilot', false], ['claude', false], ['codex', true]], `${w}: Copilot and Claude Code can be chosen`);
    assert.match(k.opts[1].t, /^Claude Code$/, 'a ready harness has no state words');
    assert.match(k.opts[2].t, /Codex.*too old/, 'Codex says too old');
    assert.strictEqual(k.value, 'copilot', 'the default is the registry default');
    assert.ok(k.label && /agent kind/i.test(k.label), `${w}: the select has a label (${k.label})`);
    assert.ok(k.before && k.helpBefore, `${w}: the kind control comes before Permissions`);
    assert.strictEqual(k.helpLabel, 'About agent kinds');
    assert.strictEqual(await js(vis('modelSel')), true, 'Copilot keeps the model select');

    // the toolbar does not wrap: all controls of the live bar on one row, and the header is as tall as with one adapter
    const row = await js(`(()=>{const t=[...document.querySelectorAll('#liveBar > button, #liveBar > select')].filter(e=>e.getClientRects().length).map(e=>Math.round(e.getBoundingClientRect().top));return {min:Math.min(...t),max:Math.max(...t),n:t.length}})()`);
    assert.ok(row.max - row.min <= 3, `${w}: the toolbar stays on one row (${JSON.stringify(row)})`);
    assert.strictEqual(await headerH(), heights[w], `${w}: the header is as tall as with one adapter`);
    assert.ok(await js(`document.querySelectorAll('#stage .desk[data-id]').length>=15`), '15 agents are shown');
    const f1 = await minFont('.controls');
    assert.ok(f1.min >= 10.5, `${w}: toolbar text >= 10.5px (${JSON.stringify(f1)})`);
    await shot('012-picker', w, h);

    // About agent kinds: keyboard open, focus kept inside, state and hint as text, Check again, Esc returns focus
    await js(`document.getElementById('kindHelp').focus()`);
    await key('Return');
    assert.ok(await ctx.waitFor(`document.getElementById('modeDlg')`, 3000), 'the dialog opens with Enter');
    assert.ok(await inDialog(), 'focus moved into the dialog');
    const txt = await js(`document.getElementById('modeDlg').innerText.replace(/\\s+/g,' ')`);
    for (const need of ['About agent kinds', 'Copilot: ready', 'Claude Code: ready', 'Codex: too old', 'version 0.9.0', 'Update Codex', 'Check again']) assert.ok(txt.includes(need), `dialog text has "${need}": ${txt}`);
    for (let i = 0; i < 6; i++) { await key('Tab'); assert.ok(await inDialog(), `focus stays inside after Tab ${i + 1}`); }
    await key('Tab', ['shift']); assert.ok(await inDialog(), 'focus stays inside after Shift+Tab');
    const f2 = await minFont('#modeDlg');
    assert.ok(f2.min >= 10.5, `${w}: dialog text >= 10.5px (${JSON.stringify(f2)})`);
    if (w === SIZES[0][0]) await shot('012-about', w, h);
    // Check again keeps the dialog open (it asks the list again)
    await js(`[...document.querySelectorAll('#modeDlg .btn')].find(b=>b.textContent==='Check again').click()`);
    await ctx.sleep(400);
    assert.ok(await js(`!!document.getElementById('modeDlg')`), 'Check again shows the dialog again');
    assert.ok(await inDialog(), 'focus is back inside after Check again');
    await key('Escape');
    assert.strictEqual(await js(`!document.getElementById('modeDlg')`), true, 'Esc closes the dialog');
    assert.strictEqual(await js(`document.activeElement&&document.activeElement.id`), 'kindHelp', 'focus returns to the "?" button');

    // a not-ready kind cannot be started from the toolbar (the UI blocks it before the bridge is called)
    const before = await js(`document.querySelectorAll('#stage .desk[data-id]').length`);
    await js(`(()=>{const s=document.getElementById('kindSel');s.options[2].disabled=false;s.value='codex';s.options[2].disabled=true;s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    assert.strictEqual(await js(vis('modelSel')), false, 'a kind other than the default hides the model select');
    assert.strictEqual(await js(vis('effortSel')), false, 'and the effort select');
    await js(`document.getElementById('addFolder').click()`);
    await ctx.sleep(400);
    const t = await js(`[...document.querySelectorAll('#toasts .toast')].map(x=>x.textContent).join(' | ')`);
    assert.match(t, /not ready/, `${w}: starting a not-ready kind is blocked: ${t}`);
    assert.doesNotMatch(t, /Could not add/, 'the UI blocked it, the bridge was not asked');
    assert.strictEqual(await js(`document.querySelectorAll('#stage .desk[data-id]').length`), before, 'no folder was added');
    await js(`(()=>{const s=document.getElementById('kindSel');s.value='copilot';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    assert.strictEqual(await js(vis('modelSel')), true, 'back to Copilot: the model select is back');

    // new-session dialog: the kind select, disabled kinds, blocked start; the model field follows the kind
    await load(w, h, { simkinds: '1', open: 'sim-1' });
    await ctx.waitFor(`document.getElementById('newSessBtn')`, 5000);
    await js(`document.getElementById('newSessBtn').click()`);
    await ctx.sleep(300);
    const sd = await js(`(()=>{const s=document.getElementById('sdKind');return s?{opts:[...s.options].map(o=>[o.value,o.disabled,o.textContent.trim()]),value:s.value,model:!document.getElementById('sdModelL').hidden,cap:!document.getElementById('sdCapL').hidden}:null})()`);
    assert.ok(sd, `${w}: the new-session dialog has a kind select`);
    assert.deepStrictEqual(sd.opts.map((o) => [o[0], o[1]]), [['copilot', false], ['claude', false], ['codex', true]]);
    assert.match(sd.opts[2][2], /too old/);
    assert.strictEqual(await js(`document.getElementById('sdKind').closest('label').firstChild.textContent.trim()`), 'Harness', 'FR-136: the dialog calls it Harness');
    assert.strictEqual(sd.value, 'copilot', 'the dialog defaults to the current agent kind');
    assert.ok(sd.model && sd.cap, 'Copilot: model and cap fields shown');
    const f3 = await minFont('#sessDlg');
    assert.ok(f3.min >= 10.5, `${w}: new-session dialog text >= 10.5px (${JSON.stringify(f3)})`);
    // force a disabled kind: model and cap follow the kind's capabilities; the start is blocked
    await js(`(()=>{const s=document.getElementById('sdKind');s.value='claude';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    const sd2 = await js(`({cap:!document.getElementById('sdCapL').hidden})`);
    assert.deepStrictEqual(sd2, { cap: false }, `${w}: Claude Code has no credit cap, so the cap field is hidden`);
    await js(`(()=>{const s=document.getElementById('sdKind');s.options[2].disabled=false;s.value='codex';s.options[2].disabled=true;s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    const n0 = await js(`document.querySelectorAll('#stage .desk[data-id]').length`);
    await js(`document.getElementById('sdGo').click()`);
    await ctx.sleep(400);
    assert.ok(await js(`!!document.getElementById('sessDlg')`), 'a not-ready kind keeps the dialog open');
    assert.match(await js(`[...document.querySelectorAll('#toasts .toast')].map(x=>x.textContent).join(' | ')`), /not ready/);
    assert.strictEqual(await js(`document.querySelectorAll('#stage .desk[data-id]').length`), n0, 'no session was started');
    if (w === SIZES[0][0]) await shot('012-session', w, h);
    await js(`(()=>{const s=document.getElementById('sdKind');s.value='copilot';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await js(`document.getElementById('sdGo').click()`);
    assert.ok(await ctx.waitFor(`!document.getElementById('sessDlg')`, 4000), 'Copilot starts a session');

    // one adapter: the new-session dialog has no kind select
    await load(w, h, { open: 'sim-1' });
    await ctx.waitFor(`document.getElementById('newSessBtn')`, 5000);
    // Copilot keeps every control the capability gates could hide (FR-061): Stop, cap chip, mode menu with 3 modes, history box
    assert.ok(await js(`(()=>{const e=document.getElementById('stopBtn');return !!e&&!e.hidden&&e.getClientRects().length>0})()`), `${w}: Copilot keeps the Stop button`);
    assert.ok(await js(`(()=>{const e=document.getElementById('capChip');return !!e&&e.getClientRects().length>0})()`), `${w}: Copilot keeps the cap chip`);
    assert.ok(await js(`!!document.getElementById('modeChip')`), `${w}: Copilot keeps the mode chip`);
    await js(`document.getElementById('modeChip').click()`);
    await ctx.sleep(200);
    assert.strictEqual(await js(`document.querySelectorAll('#modeMenu [role="menuitemradio"]').length`), 3, `${w}: the mode menu lists 3 modes`);
    await key('Escape');
    assert.ok(await ctx.waitFor(`(()=>{const e=document.getElementById('prev');return !!e&&!e.hidden&&/[1-9]\\d* Copilot/.test(e.innerText)})()`, 3000), `${w}: Copilot keeps its history (earlier Copilot sessions listed)`);
    await js(`document.getElementById('newSessBtn').click()`);
    await ctx.sleep(300);
    assert.strictEqual(await js(`!!document.getElementById('sdKind')`), false, 'one adapter: no kind select in the dialog');
    assert.ok(await js(`!document.getElementById('sdModelL').hidden`), 'one adapter: model field as before');
    console.log('[017]', w, 'ok');
  }
  console.log('[017] all checks passed; shots in', OUT);
};
