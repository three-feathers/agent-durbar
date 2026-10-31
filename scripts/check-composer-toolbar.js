/*
 * Check for spec 005 FR-037..FR-043 (owner request, 2026-10-21): the chat's settings sit in a toolbar under the message box, and one
 * Send / Stop slot sits inside the box's right edge. Simulator only (no AI credits).
 *
 *   npm run check:ui -- --only check-composer-toolbar
 *   OUT=docs/screenshots  (optional) where the screenshots go (default: a temp folder)
 *
 * At 1440x900 and 1280x800, in Clean Office:
 *   - the header no longer holds the mode, model, profile, context chips or Stop; More no longer holds MCP servers;
 *   - the toolbar is under the message box, inside the composer, one row, in the order Profile, Mode, Model, Context, MCP, files;
 *   - the model chip shows a context window size, the MCP chip a count, and opens the existing MCP dialog;
 *   - the context chip opens a menu above it with Compact; Escape returns focus to the chip;
 *   - Send is inside the box's right edge; a sent message shows Stop with the spinner left of it (Send hidden), typing during the
 *     turn shows Send beside it, and Stop brings Send back;
 *   - nothing in the toolbar overlaps or leaves the panel, no text under 10.5px;
 *   - with the panel 480px wide: still one row, "⋯" appears, the mode stays in the row, the moved controls are in its popover;
 *   - Simple: mode, attachments and Send only (profile, model and MCP hidden); the memory chip of an agent that cannot compact
 *     (2026-10-22) opens an info-only popup (aria-haspopup="dialog", no "tidy up" promise), Escape back to the chip;
 *   - demo (2026-10-22, once): Stop in a demo chat ends the canned turn: Stop and the spinner go and the reply stops growing;
 *   - a dark user theme (scripts/fixtures/themes/dark-audit.json): the same layout; screenshots.
 *   - compact toolbar (2026-10-23, issue 627): the model chip shows the name only; the context is a ring with a name and the tooltip
 *     "Context N% of …" that opens the token summary (one bar per reported type; "Breakdown not reported by Claude Code." for a
 *     Claude Code agent); the MCP chip shows on/total; at full width and with a 760px panel everything incl. MCP is in the row; the six
 *     built-in themes lay out the same (1440x900).
 * A miss throws (DRIVER FAILED); the npm script exits non-zero unless "all checks passed" is printed.
 */
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const OUT = process.env.OUT || process.env.SHOTS_OUT || require('os').tmpdir();
const DARK = fs.readFileSync(path.join(__dirname, 'fixtures', 'themes', 'dark-audit.json'), 'utf8');
const SIZES = [[1440, 900], [1280, 800]];

/* runs in the page: the toolbar's geometry and contents */
function measure() {
  const R = (e) => e.getBoundingClientRect();
  const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const $ = (id) => document.getElementById(id);
  const P = [];
  const bar = $('cToolbar'), row = $('ctItems'), box = document.querySelector('#panel .inbox'), comp = document.querySelector('#panel .composer'), panel = $('panel');
  if (!bar || !row || !box) return { P: ['no composer toolbar'] };
  const head = $('panelHead');
  for (const id of ['modeChip', 'modelChip', 'agentChip', 'ctxChip', 'stopBtn', 'compactBtn', 'mcpBtn']) if (head.querySelector('#' + id)) P.push(id + ' is still in the chat header');
  if ($('moreMenu') && $('moreMenu').querySelector('#mcpBtn')) P.push('MCP servers is still in More');
  const br = R(bar), bx = R(box), cr = R(comp), pr = R(panel);
  if (br.top < bx.bottom - 0.5) P.push(`the toolbar is not under the message box (${br.top} < ${bx.bottom})`);
  if (br.left < cr.left - 0.5 || br.right > cr.right + 0.5) P.push('the toolbar leaves the composer');
  const items = [...row.children].filter((e) => vis(e) && R(e).width > 0);
  const tops = items.map((e) => Math.round(R(e).top));
  if (tops.length && Math.max(...tops) - Math.min(...tops) > 2) P.push('the toolbar wraps ' + JSON.stringify(tops));
  if (row.scrollWidth > row.clientWidth + 1) P.push(`the toolbar row overflows (${row.scrollWidth} > ${row.clientWidth})`);
  const order = ['agentChip', 'modeChip', 'modelChip', 'ctxChip', 'mcpBtn', 'attFile', 'attImg'];
  const seen = [...row.querySelectorAll(order.map((x) => '#' + x).join(','))].filter(vis).map((e) => e.id);
  const want = order.filter((x) => seen.includes(x));
  if (seen.join() !== want.join()) P.push('toolbar order ' + seen.join());
  const kids = [...bar.querySelectorAll('#ctItems > .ct > *, #ctMoreBtn')].filter(vis);
  for (const k of kids) { const r = R(k); if (r.left < pr.left - 1 || r.right > pr.right + 1) P.push(`${k.id || k.className} leaves the panel`); if (r.height > 0 && (r.height < 27.5 || r.height > 28.5)) P.push(`${k.id || k.className} is ${r.height}px high, not 28`); }
  for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
    const a = R(kids[i]), b = R(kids[j]); if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5) P.push(`${kids[i].id} overlaps ${kids[j].id}`);
  }
  const small = [...comp.querySelectorAll('*')].filter((e) => vis(e) && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 10.5).map((e) => e.id || e.className);
  if (small.length) P.push('text under 10.5px: ' + small.slice(0, 4).join(', '));
  const slot = $('runSlot'), send = $('sendBtn');
  if (!slot || !box.contains(slot)) P.push('the Send / Stop slot is not inside the message box');
  const shown = [send, $('stopBtn')].filter(vis);
  for (const b of shown) { const r = R(b); if (r.left < bx.left || r.right > bx.right + 0.5 || r.top < bx.top - 0.5 || r.bottom > bx.bottom + 0.5) P.push(`${b.id} is not inside the box`); }
  const last = shown.length ? R(shown[shown.length - 1]) : null;
  if (last && last.right < bx.right - 14) P.push('the primary button is not at the box\'s right edge');
  const ta = $('msgInput');
  if (ta && shown.length && R(ta).right > Math.min(...shown.map((b) => R(b).left)) + 0.5) P.push('the message box text runs under the button');
  return {
    P, more: vis($('ctMoreBtn')), popIds: [...$('ctMorePop').querySelectorAll('button,[id]')].map((e) => e.id).filter(Boolean),
    rowIds: seen, model: ($('modelChip') || {}).innerText || '', mcp: ($('mcpBtn') || {}).innerText || '',
    /* spec 005 FR-050..FR-053 (issue 627): the model chip's name, the MCP chip's n/m and the context ring */
    modelLabel: ($('modelChip') || { getAttribute: () => '' }).getAttribute('aria-label') || '',
    mcpN: ((($('mcpBtn') || document).querySelector('.ct-n') || {}).textContent || '').trim(), mcpLabel: ($('mcpBtn') || { getAttribute: () => '' }).getAttribute('aria-label') || '',
    ring: $('ctxChip') ? { text: $('ctxChip').innerText.trim(), name: $('ctxChip').getAttribute('aria-label') || '', title: $('ctxChip').title, svg: !!$('ctxChip').querySelector('svg.ring'), cls: $('ctxChip').className, pop: $('ctxChip').getAttribute('aria-haspopup') } : null,
    send: vis(send), stop: vis($('stopBtn')), spin: vis($('runSpin')),
  };
}

/* runs in the page: the open token summary (spec 005 FR-052) */
function SUMMARY() {
  const m = document.getElementById('ctxMenu'), c = document.getElementById('ctxChip');
  if (!m || !c) return null;
  const vis = (e) => !!e && e.getClientRects().length > 0;
  const r = m.getBoundingClientRect();
  return {
    role: m.getAttribute('role'), above: r.bottom <= c.getBoundingClientRect().top + 0.5, exp: c.getAttribute('aria-expanded'),
    inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
    compact: !!m.querySelector('#compactBtn'), tools: /Models and context/.test(m.innerText),
    total: ((m.querySelector('.cb-total') || {}).textContent || '').trim(), totalBar: vis(m.querySelector('.cb-total-bar i')),
    labels: [...m.querySelectorAll('.cb-row .cb-l')].map((e) => e.textContent.trim()), bars: [...m.querySelectorAll('.cb-row .cb-bar i')].filter(vis).length,
    note: ((m.querySelector('.cb-note') || {}).textContent || '').trim(),
    itemRoles: [...m.querySelectorAll('button')].map((b) => b.getAttribute('role')).filter(Boolean),
    small: [...m.querySelectorAll('*')].filter((e) => vis(e) && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 10.5).map((e) => e.className),
  };
}

const THEMES = ['clean-office', 'retro'];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js, key } = H;
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'calm', blur: true, tag: 'composer' });
  const fails = [];
  const check = (cond, msg) => { if (!cond) { fails.push(msg); console.log('FAIL ' + msg); } };
  const M = () => js(`(${measure.toString()})()`);
  const type = (t) => js(`(()=>{const i=document.getElementById('msgInput');i.value=${jsLiteral(t)};i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  /* Noor: an idle Copilot agent near its context limit that can compact (the simulator's fixed cast, as in shots-model) */
  const openIdle = async () => {
    const id = await H.idOf('Noor');
    assert.ok(id, 'Noor is on the floor');
    await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"]`)}).click()`);
    await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('cToolbar')`);
    await settle();
    await until(`!!document.querySelector('#mcpBtn .ct-n')`, 4000);
    return id;
  };
  const load = (w, h, q) => H.load({ w, h, query: q || {}, ready: 'fit' });

  /* spec 005 FR-044..FR-048 (issue 592): the message box's size. Geometry in the page; the drag and the keys are real input events. */
  const wc = () => ctx.win.webContents;
  const box = () => js(`(()=>{const R=e=>e.getBoundingClientRect(),t=document.getElementById('msgInput'),g=document.getElementById('composerGrip'),c=document.getElementById('chat'),p=document.querySelector('#panel .panel-in');
    if(!t||!g||!c||!p)return null;const gr=R(g);
    return {h:Math.round(R(t).height),sh:t.scrollHeight,ch:t.clientHeight,chat:c.clientHeight,panel:p.clientHeight,gx:Math.round(gr.left+gr.width/2),gy:Math.round(gr.top+gr.height/2),gh:gr.height,
      role:g.getAttribute('role'),name:g.getAttribute('aria-label'),ctl:g.getAttribute('aria-controls'),orient:g.getAttribute('aria-orientation'),tab:g.tabIndex,
      now:+g.getAttribute('aria-valuenow'),min:+g.getAttribute('aria-valuemin'),max:+g.getAttribute('aria-valuemax'),
      stored:(()=>{try{return localStorage.getItem('durbar.composerHeight')}catch(e){return 'ERR'}})(),
      focus:(document.activeElement||{}).id||'',sel:[t.selectionStart,t.selectionEnd],small:parseFloat(getComputedStyle(g).fontSize)}})()`);
  const drag = async (b, dy) => {
    wc().sendInputEvent({ type: 'mouseMove', x: b.gx, y: b.gy });
    wc().sendInputEvent({ type: 'mouseDown', x: b.gx, y: b.gy, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 6; i++) { wc().sendInputEvent({ type: 'mouseMove', x: b.gx, y: Math.round(b.gy + (dy * i) / 6), button: 'left', modifiers: ['leftButtonDown'] }); await ctx.sleep(30); }
    wc().sendInputEvent({ type: 'mouseUp', x: b.gx, y: b.gy + dy, button: 'left', clickCount: 1 });
    await ctx.sleep(120);
  };
  const LONG = Array.from({ length: 80 }, (_, i) => `Line ${i + 1}: please review the plan before you change anything in the folder.`).join('\n');
  const resizeSteps = async (tag, w, h) => {
    await js(`(()=>{try{localStorage.removeItem('durbar.composerHeight')}catch(e){}})()`);
    await load(w, h); await openIdle();
    let b = await box();
    check(!!b, `${tag} resize: no handle (#composerGrip) or no message box`);
    if (!b) return;
    check(b.role === 'separator' && b.name === 'Resize message box' && b.ctl === 'msgInput' && b.orient === 'horizontal' && b.tab === 0, `${tag} resize: handle ARIA ${JSON.stringify(b)}`);
    check(b.h >= 35 && b.h <= 40 && b.sh <= b.ch + 1, `${tag} resize: an empty box is not one line (${b.h}px)`);
    /* FR-044: a long prompt grows past the old 110px to the cap, then scrolls; the transcript keeps 140px */
    await type(LONG);
    await ctx.sleep(80);
    b = await box();
    const want = Math.min(Math.max(110, Math.round(0.4 * b.panel)), b.h + b.chat - 140);
    check(b.h > 110 && Math.abs(b.h - want) <= 2, `${tag} resize: a long prompt grows to ${b.h}px, want the cap ${want}px (40% of ${b.panel}, transcript floor)`);
    check(b.sh > b.ch + 20, `${tag} resize: a long prompt above the cap does not scroll inside the box (${b.sh} <= ${b.ch})`);
    check(b.chat >= 139, `${tag} resize: the transcript keeps ${b.chat}px (< 140)`);
    const capH = b.h;
    console.log(`[composer-toolbar] ${tag} resize: cap ${capH}px (panel ${b.panel}px, transcript ${b.chat}px)`);
    await type('one\ntwo\nthree');
    b = await box();
    check(b.h > 40 && b.h < capH && b.sh <= b.ch + 1, `${tag} resize: three lines are ${b.h}px high and should fit without scrolling`);
    await type('');
    b = await box();
    check(b.h <= 40, `${tag} resize: an emptied box does not shrink back (${b.h}px)`);
    /* FR-045: drag up 150px: taller, chosen, remembered; the caret stays; the box keeps the focus */
    await js(`(()=>{const t=document.getElementById('msgInput');t.focus();t.value='keep the caret here';t.dispatchEvent(new Event('input',{bubbles:true}));t.setSelectionRange(5,9);})()`);
    b = await box();
    const h0 = b.h;
    await drag(b, -150);
    b = await box();
    check(Math.abs(b.h - (h0 + 150)) <= 3, `${tag} resize: dragging up 150px makes the box ${b.h}px (from ${h0})`);
    check(String(b.stored) === String(b.h), `${tag} resize: the dragged size is not remembered (stored ${b.stored}, box ${b.h})`);
    check(b.focus === 'msgInput' && b.sel[0] === 5 && b.sel[1] === 9, `${tag} resize: the drag moved the focus or the caret ${JSON.stringify({ focus: b.focus, sel: b.sel })}`);
    check(Math.abs(b.now - b.h) <= 1 && b.min === 36 && b.max >= b.h, `${tag} resize: aria values ${JSON.stringify({ now: b.now, min: b.min, max: b.max })}`);
    /* a chosen size does not follow the text */
    await type('short');
    const chosen = b.h;
    b = await box();
    check(Math.abs(b.h - chosen) <= 1, `${tag} resize: a chosen size follows the text (${b.h} != ${chosen})`);
    /* FR-046: drag far up: clamped so the transcript keeps 140px; far down: one line */
    await drag(b, -(b.gy - 2));
    b = await box();
    check(b.chat >= 139 && b.chat <= 142, `${tag} resize: dragged to the top, the transcript keeps ${b.chat}px (want 140)`);
    check(Math.abs(b.h - b.max) <= 1, `${tag} resize: the top clamp ${b.h} is not aria-valuemax ${b.max}`);
    await shot(`005-composer-resized-${tag}.png`);
    await drag(b, h - b.gy - 2);
    b = await box();
    check(b.h >= 35 && b.h <= 37, `${tag} resize: dragged to the bottom, the box is ${b.h}px (want 36)`);
    /* FR-048: keys on the focused handle */
    await js(`document.getElementById('composerGrip').focus()`);
    await key('Up'); b = await box();
    check(b.h === 52, `${tag} resize: Arrow Up gives ${b.h}px (want 36 + 16)`);
    await key('PageUp'); b = await box();
    check(b.h === 116, `${tag} resize: Page Up gives ${b.h}px (want 52 + 64)`);
    await key('Down'); b = await box();
    check(b.h === 100, `${tag} resize: Arrow Down gives ${b.h}px (want 116 - 16)`);
    await key('End'); b = await box();
    check(Math.abs(b.h - b.max) <= 1 && b.chat >= 139, `${tag} resize: End gives ${b.h}px (max ${b.max}, transcript ${b.chat})`);
    await key('Home'); b = await box();
    check(b.h === 36, `${tag} resize: Home gives ${b.h}px`);
    await key('PageUp'); await key('PageUp'); b = await box();
    const kept = b.h;
    check(kept === 164 && b.focus === 'composerGrip' && (await js(`document.body.classList.contains('panel-open')`)), `${tag} resize: keys left the chat or the handle ${JSON.stringify({ h: b.h, focus: b.focus })}`);
    /* FR-047: a reload keeps the size (one value for the app) */
    await load(w, h); await openIdle();
    b = await box();
    check(b.h === kept && String(b.stored) === String(kept), `${tag} resize: after a reload the box is ${b.h}px (want ${kept}, stored ${b.stored})`);
    /* FR-045: double-click resets to automatic growth and forgets the size */
    wc().sendInputEvent({ type: 'mouseMove', x: b.gx, y: b.gy });
    for (const c of [1, 2]) { wc().sendInputEvent({ type: 'mouseDown', x: b.gx, y: b.gy, button: 'left', clickCount: c }); wc().sendInputEvent({ type: 'mouseUp', x: b.gx, y: b.gy, button: 'left', clickCount: c }); }
    await ctx.sleep(150);
    b = await box();
    check(b.h <= 40 && b.stored === null, `${tag} resize: double-click does not reset (${b.h}px, stored ${b.stored})`);
    await type(LONG); b = await box();
    check(Math.abs(b.h - capH) <= 2, `${tag} resize: after the reset a long prompt grows to ${b.h}px again (want ${capH})`);
    /* Enter on the handle resets too */
    await js(`document.getElementById('composerGrip').focus()`);
    await key('PageUp'); await key('Return'); b = await box();
    check(Math.abs(b.h - capH) <= 2 && b.stored === null, `${tag} resize: Enter on the handle does not reset (${b.h}px, stored ${b.stored})`);
    await type('');
    /* FR-046, FR-047 (review on PR 599): a stored size too tall for the window is shown clamped (and kept); junk is ignored (automatic) */
    await type('');
    await js(`localStorage.setItem('durbar.composerHeight','3900')`);
    await load(w, h); await openIdle();
    b = await box();
    check(b.h <= b.max && b.now <= b.max && Math.abs(b.now - b.h) <= 1 && Math.abs(b.h - b.max) <= 1 && b.chat >= 139, `${tag} resize: a stored 3900px is not clamped ${JSON.stringify({ h: b.h, now: b.now, max: b.max, chat: b.chat })}`);
    check(b.stored === '3900', `${tag} resize: the clamp rewrote the stored size (${b.stored})`);
    for (const junk of ['abc', '99999']) { /* not a number, and out of parse()'s range (36..4000) */
      await js(`localStorage.setItem('durbar.composerHeight',${jsLiteral(junk)})`);
      await load(w, h); await openIdle();
      b = await box();
      check(b.h <= 40, `${tag} resize: a stored "${junk}" does not give an automatic one-line box (${b.h}px)`);
      await type(LONG); b = await box();
      check(Math.abs(b.h - capH) <= 2 && b.sh > b.ch + 20, `${tag} resize: with a stored "${junk}" a long prompt grows to ${b.h}px (want the cap ${capH})`);
      await type('');
    }
    await js(`localStorage.removeItem('durbar.composerHeight')`);
    await type('');
    const mm = await M();
    mm.P.forEach((p) => check(false, `${tag} after resize: ${p}`));
  };

  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    await load(w, h);
    await js(`localStorage.setItem('durbar.detail','expert')`);
    await load(w, h);
    await openIdle();
    let m = await M();
    m.P.forEach((p) => check(false, `${tag}: ${p}`));
    check(!m.more, `${tag}: "⋯" shows at full width`);
    check(['modeChip', 'modelChip', 'ctxChip', 'mcpBtn', 'attFile', 'attImg'].every((x) => m.rowIds.includes(x)), `${tag}: toolbar items ${m.rowIds}`);
    /* spec 005 FR-050: the model chip's text is the model's name only; effort, tier and window are in its name and tooltip */
    check(/^Sim Fast$/.test(m.model.trim()), `${tag}: the model chip text is not the name only (${m.model})`);
    check(/^Model: Sim Fast.*, \d[\d.]*[kM] tokens context window$/.test(m.modelLabel), `${tag}: the model chip's name lost the window (${m.modelLabel})`);
    /* FR-053: MCP on/total, named in words */
    const nm = /^(\d+)\/(\d+)$/.exec(m.mcpN);
    check(!!nm && +nm[1] <= +nm[2] && /^MCP\s*\d+\/\d+$/.test(m.mcp.replace(/\s+/g, ' ').trim()), `${tag}: the MCP chip does not show on/total (${m.mcp})`);
    check(!!nm && m.mcpLabel === `${nm[1]} of ${nm[2]} MCP servers on. Open the list`, `${tag}: the MCP chip's name (${m.mcpLabel})`);
    /* FR-051: the context ring: no text, a name, the short tooltip, an SVG ring in the level's class */
    check(m.ring && m.ring.text === '' && m.ring.svg && /\b(ok|warn|high)\b/.test(m.ring.cls) && m.ring.pop === 'dialog', `${tag}: the context ring ${JSON.stringify(m.ring)}`);
    check(m.ring && /^Context \d+% of \d[\d.]*[kM]$/.test(m.ring.title), `${tag}: the ring's tooltip "${m.ring && m.ring.title}"`);
    check(m.ring && /^Context window \d+% used: \d[\d.]*[kM]? of \d[\d.]*[kM] tokens\. Open the token summary$/.test(m.ring.name), `${tag}: the ring's name "${m.ring && m.ring.name}"`);
    check(m.send && !m.stop && !m.spin, `${tag}: idle shows Send only ${JSON.stringify(m)}`);
    check(await js(`document.getElementById('sendBtn').getAttribute('aria-disabled')==='true'`), `${tag}: Send is not disabled while the box is empty`);
    await shot(`005-composer-expert-light-${tag}.png`);

    /* spec 005 T070 (review on #498): the context chip's tooltip ends one sentence with one full stop, also when the size line ends with one */
    const ctxTitle = () => js(`(document.getElementById('ctxChip')||{}).title||''`);
    let ct = await ctxTitle();
    check(/^Context \d+% of /.test(ct) && !/\.\./.test(ct), `${tag}: context ring tooltip "${ct}"`);
    if (w === SIZES[0][0]) {
      const unk = await js(`(()=>{const a=window.__durbarSimUi.agents().find(x=>x.live&&!x.parent&&/unknown|after the first message/i.test((window.DurbarScreens.ctxChip(x)||{}).title||''));return a?a.name:null})()`);
      /* an unknown figure: an empty dashed ring, "Context: not known yet" */
      check(!!unk, `${tag}: no agent with an unknown context to check the tooltip`);
      if (unk) {
        const uid = await H.idOf(unk);
        await js(`document.getElementById('backBtn')&&document.getElementById('backBtn').click()`);
        await until(`!!document.querySelector(${jsLiteral(`#stage .desk[data-id="${uid}"]`)})`, 4000);
        await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${uid}"]`)}).click()`);
        await until(`!!document.getElementById('ctxChip')&&document.body.classList.contains('panel-open')`, 4000);
        ct = await ctxTitle();
        check(ct === 'Context: not known yet' && (await js(`document.getElementById('ctxChip').classList.contains('unk')`)), `${tag}: context ring tooltip (unknown) "${ct}"`);
        await openIdle();
      }
    }
    /* the context menu: above the chip, Compact in it, Escape back to the chip */
    await js(`document.getElementById('ctxChip').click()`);
    check(await until(`!!document.getElementById('ctxMenu')`, 3000), `${tag}: the context chip opens no menu`);
    const cm = await js(`(${SUMMARY.toString()})()`);
    check(cm && cm.above && cm.compact && cm.tools && cm.exp === 'true' && cm.role === 'dialog', `${tag}: context summary ${JSON.stringify(cm)}`);
    /* review on PR 632: a dialog holds plain buttons, not menu items */
    check(cm && cm.itemRoles.length === 0, `${tag}: the summary (a dialog) has buttons with roles ${JSON.stringify(cm && cm.itemRoles)}`);
    /* review on PR 632: the ring's window is the model chip's (modelWindow, with the tier), not a second lookup */
    { const rw = (/ of (\d[\d.]*[kM]) tokens\./.exec(m.ring && m.ring.name || '') || [])[1], mw = (/, (\d[\d.]*[kM]) tokens context window/.exec(m.modelLabel) || [])[1];
      check(!!rw && rw === mw, `${tag}: the ring's window ${rw} is not the model chip's ${mw}`); }
    /* FR-052: VS Code style: the total line with its bar, one bar per type Copilot reports (system, tool definitions, chat), no note */
    check(cm && /^\d[\d.]*[kM]? of \d[\d.]*[kM] tokens · \d+%$/.test(cm.total) && cm.totalBar, `${tag}: the summary's total line "${cm && cm.total}"`);
    check(cm && ['System instructions', 'Tool definitions', 'Chat messages'].every((l) => cm.labels.includes(l)) && cm.bars === cm.labels.length && !cm.note, `${tag}: the summary's bars ${JSON.stringify(cm)}`);
    check(cm && !cm.small.length && cm.inside, `${tag}: the summary has text under 10.5px or leaves the window ${JSON.stringify(cm)}`);
    await shot(`005-composer-ctxsummary-${tag}.png`);
    await js(`(()=>{const b=document.querySelector('#ctxMenu button');if(b)b.focus();})()`); /* the screenshot blurs the page */
    await key('Escape');
    check(await until(`!document.getElementById('ctxMenu')&&(document.activeElement||{}).id==='ctxChip'`, 3000), `${tag}: Escape does not close the context menu back to its chip`);

    /* the mode menu opens above its chip */
    await js(`document.getElementById('modeChip').click()`);
    await until(`!!document.getElementById('modeMenu')`, 3000);
    check(await js(`(()=>{const m=document.getElementById('modeMenu'),c=document.getElementById('modeChip');return !!m&&m.getBoundingClientRect().bottom<=c.getBoundingClientRect().top+0.5})()`), `${tag}: the mode menu does not open above its chip`);
    await key('Escape'); await until(`!document.getElementById('modeMenu')`, 3000);

    /* the MCP chip opens the existing dialog */
    await js(`document.getElementById('mcpBtn').click()`);
    check(await until(`/MCP servers for /.test((document.querySelector('#scrDlg h3, .dlg-ov h3, .dlg h3')||{}).textContent||'')`, 4000), `${tag}: the MCP chip does not open the MCP dialog`);
    /* spec 005 T072 (review on #498): switching a server off in the dialog drops the chip's count by one when it closes (FR-037 item 5: on and not switched off) */
    const MCP_ON = `parseInt(((document.querySelector('#mcpBtn .ct-n')||{}).textContent||'').split('/')[0],10)`, MCP_ALL = `parseInt(((document.querySelector('#mcpBtn .ct-n')||{}).textContent||'').split('/')[1],10)`;
    const mcpN = () => js(MCP_ON);
    const all0 = await js(MCP_ALL);
    const n0 = await mcpN();
    const swOff = await until(`!!document.querySelector('.dlg .srv-act button.swt[aria-checked="true"]:not([disabled])')`, 4000)
      && await js(`(()=>{const b=document.querySelector('.dlg .srv-act button.swt[aria-checked="true"]:not([disabled])');const n=b.dataset.n;b.click();return n})()`);
    check(!!swOff, `${tag}: the MCP dialog has no server to switch off`);
    if (swOff) await until(`!!document.querySelector(${jsLiteral(`.dlg .srv-act button.swt[aria-checked="false"][data-n="${swOff}"]`)})`, 4000);
    await key('Escape'); await until(`!/MCP servers for /.test((document.querySelector('.dlg h3')||{}).textContent||'')`, 3000);
    check(await until(`${MCP_ON}===${jsLiteral(n0 - 1)}&&${MCP_ALL}===${jsLiteral(all0)}`, 4000), `${tag}: switching ${swOff} off does not drop the MCP count from ${n0} to ${n0 - 1} of ${all0} (now ${await mcpN()})`);
    if (swOff) { /* switch it back on, so the rest of the run sees the same servers */
      await js(`document.getElementById('mcpBtn').click()`);
      await until(`!!document.querySelector(${jsLiteral(`.dlg .srv-act button.swt[data-n="${swOff}"]`)})`, 4000);
      await js(`document.querySelector(${jsLiteral(`.dlg .srv-act button.swt[data-n="${swOff}"]`)}).click()`);
      await until(`!!document.querySelector(${jsLiteral(`.dlg .srv-act button.swt[aria-checked="true"][data-n="${swOff}"]`)})`, 4000);
      await key('Escape'); await until(`!/MCP servers for /.test((document.querySelector('.dlg h3')||{}).textContent||'')`, 3000);
      check(await until(`${MCP_ON}===${jsLiteral(n0)}`, 4000), `${tag}: switching ${swOff} back on does not restore the MCP count ${n0}`);
    }

    /* Send -> Stop with the spinner -> Send */
    await type('Please look at the README.');
    check(await js(`document.getElementById('sendBtn').getAttribute('aria-disabled')==='false'`), `${tag}: Send stays disabled with text`);
    await js(`document.getElementById('sendBtn').click()`);
    check(await until(`(()=>{const v=e=>!!e&&e.getClientRects().length>0;return v(document.getElementById('stopBtn'))&&v(document.getElementById('runSpin'))&&!v(document.getElementById('sendBtn'))})()`, 12000), `${tag}: a running turn does not show Stop with the spinner`); /* 12 s: the Windows and macOS runners are slow under load */
    m = await M();
    m.P.forEach((p) => check(false, `${tag} running: ${p}`));
    check(await js(`document.getElementById('runSpin').getBoundingClientRect().right<=document.getElementById('stopBtn').getBoundingClientRect().left+0.5`), `${tag}: the spinner is not left of Stop`);
    /* spec 005 T074: the spinner is decorative (no empty role="status"); the shared live region says the turn started */
    check(await js(`(()=>{const s=document.getElementById('runSpin');return s.getAttribute('aria-hidden')==='true'&&!s.hasAttribute('role')})()`), `${tag}: the spinner is not decorative (aria-hidden, no role)`);
    const said = () => js(`document.getElementById('srAnnounce').textContent`);
    const workSaid = await until(`/Working/.test(document.getElementById('srAnnounce').textContent)`, 3000);
    if (!workSaid) check(false, `${tag}: a starting turn is not announced (live region: ${await said()})`);
    await shot(`005-composer-running-${tag}.png`);
    await type('and the tests');
    check(await until(`(()=>{const v=e=>!!e&&e.getClientRects().length>0;return v(document.getElementById('sendBtn'))&&v(document.getElementById('stopBtn'))})()`, 3000), `${tag}: typing during a turn does not offer Send beside Stop`);
    m = await M();
    m.P.forEach((p) => check(false, `${tag} running+text: ${p}`));
    await type('');
    /* spec 005 T073 (review on #498): a second click while the first Stop is under way is ignored (aria-busy guard): one bridge.stop call.
       The fake's stop is held for 400 ms so the second click lands while the first is still running. */
    const stops = await js(`(async()=>{const b=window.__durbarSimUi.bridge(),orig=b.stop;let n=0;b.stop=async(...x)=>{n++;await new Promise(r=>setTimeout(r,400));return orig.apply(b,x);};
      try{const s=document.getElementById('stopBtn');s.click();s.click();await new Promise(r=>setTimeout(r,700));return {n};}finally{b.stop=orig;}})()`);
    check(stops.n === 1, `${tag}: two clicks on Stop call bridge.stop ${stops.n} times (want 1)`);
    check(await until(`(()=>{const v=e=>!!e&&e.getClientRects().length>0;return v(document.getElementById('sendBtn'))&&!v(document.getElementById('stopBtn'))&&!v(document.getElementById('runSpin'))})()`, 6000), `${tag}: Stop does not bring Send back`);

    /* spec 005 FR-044..FR-048 (issue 592): the message box grows to its cap and scrolls, the handle drags, clamps, is remembered and resets */
    await resizeSteps(tag, w, h);

    /* spec 005 FR-054 (issue 627): the owner's medium width (a 760px panel): everything, MCP and the ring included, in the row; no "⋯" */
    await js(`(()=>{const s=document.createElement('style');s.id='midPanel';s.textContent='#panel{flex:0 0 760px!important;max-width:760px!important}';document.head.append(s);})()`);
    await ctx.sleep(150); await settle();
    m = await M();
    m.P.forEach((p) => check(false, `${tag} 760px: ${p}`));
    check(!m.more && ['agentChip', 'modeChip', 'modelChip', 'ctxChip', 'mcpBtn', 'attFile', 'attImg'].every((x) => m.rowIds.includes(x)), `${tag} 760px: not everything fits ${JSON.stringify({ more: m.more, row: m.rowIds, pop: m.popIds })}`);
    await js(`document.getElementById('midPanel').remove()`);
    /* narrow panel (spec #452's docking may give it 480px): one row, "⋯", the mode stays */
    await js(`(()=>{const s=document.createElement('style');s.id='narrowPanel';s.textContent='#panel{flex:0 0 480px!important;max-width:480px!important}';document.head.append(s);})()`);
    await until(`(()=>{const b=document.getElementById('ctMoreBtn');return !!b&&!b.hidden})()`, 3000);
    await settle();
    m = await M();
    m.P.forEach((p) => check(false, `${tag} narrow: ${p}`));
    check(m.more && m.rowIds.includes('modeChip') && m.popIds.length > 0, `${tag} narrow: overflow ${JSON.stringify({ more: m.more, row: m.rowIds, pop: m.popIds })}`);
    /* FR-054: the order: Profile, Attach image, Attach file, Model, MCP, Context; what stays is a tail of that order */
    { const ORDER = ['agentChip', 'attImg', 'attFile', 'modelChip', 'mcpBtn', 'ctxChip']; const out = ORDER.filter((x) => m.popIds.includes(x)), kept = ORDER.filter((x) => m.rowIds.includes(x));
      check(out.length > 0 && out.every((x) => ORDER.indexOf(x) < Math.min(...kept.map((k) => ORDER.indexOf(k)), 99)) && m.popIds.includes('agentChip'), `${tag} narrow: overflow order ${JSON.stringify({ out, kept })}`); }
    await js(`document.getElementById('ctMoreBtn').click()`);
    check(await until(`!document.getElementById('ctMorePop').hidden`, 2000), `${tag} narrow: "⋯" does not open`);
    const pop = await js(`(()=>{const p=document.getElementById('ctMorePop'),r=p.getBoundingClientRect(),pr=document.getElementById('panel').getBoundingClientRect();return {inside:r.left>=pr.left-1&&r.right<=pr.right+1&&r.top>=0,focus:p.contains(document.activeElement)}})()`);
    check(pop.inside && pop.focus, `${tag} narrow: the "⋯" popover ${JSON.stringify(pop)}`);
    await H.shot(path.join(OUT, `005-composer-narrow-${tag}.png`), { prep: 'calm', tag: 'composer' }); // focus stays in the popover
    await key('Escape');
    check(await until(`document.getElementById('ctMorePop').hidden&&(document.activeElement||{}).id==='ctMoreBtn'`, 2000), `${tag} narrow: Escape does not close "⋯" back to its button`);
    await js(`document.getElementById('narrowPanel').remove()`);
    check(await until(`document.getElementById('ctMoreBtn').hidden`, 3000), `${tag}: "⋯" stays after the panel is wide again`);

    /* Simple: mode, attachments and Send; profile, model and MCP hidden */
    await js(`localStorage.setItem('durbar.detail','simple')`);
    await load(w, h);
    await openIdle().catch(() => {});
    m = await M();
    m.P.forEach((p) => check(false, `${tag} simple: ${p}`));
    check(m.rowIds.includes('modeChip') && m.rowIds.includes('attFile') && !m.rowIds.includes('modelChip') && !m.rowIds.includes('mcpBtn') && !m.rowIds.includes('agentChip'), `${tag} simple: toolbar ${m.rowIds}`);
    await shot(`005-composer-simple-light-${tag}.png`);

    /* Simple, memory chip: Noor can compact (a menu with Tidy up); Priya's app cannot compact (sim i = 6): an info-only popup, never a dead button */
    const chipOf = () => js(`(()=>{const c=document.getElementById('ctxChip');return c?{pop:c.getAttribute('aria-haspopup'),title:c.title}:null})()`);
    let ch = await chipOf();
    check(ch && ch.pop === 'menu' && /tidy up/i.test(ch.title), `${tag} simple: compactable memory chip ${JSON.stringify(ch)}`);
    const pid = await H.idOf('Priya');
    await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${pid}"]`)}).click()`);
    await until(`!!document.getElementById('ctxChip')&&/Priya/.test((document.getElementById('panelHead')||{}).textContent||'')`, 4000);
    ch = await chipOf();
    check(ch && ch.pop === 'dialog' && !/tidy up/i.test(ch.title), `${tag} simple: memory chip without Compact ${JSON.stringify(ch)}`);
    await js(`document.getElementById('ctxChip').classList.remove('mem-low')`); /* shown from 70% only: made visible so it can take focus back */
    await js(`document.getElementById('ctxChip').click()`);
    const im = await until(`!!document.getElementById('ctxMenu')`, 3000) && await js(`(()=>{const m=document.getElementById('ctxMenu');return {role:m.getAttribute('role'),info:!!m.querySelector('.mm-info'),btns:m.querySelectorAll('button').length,focus:document.activeElement===m}})()`);
    check(im && im.role === 'dialog' && im.info && im.btns === 0 && im.focus, `${tag} simple: the memory chip without Compact opens no info popup ${JSON.stringify(im)}`);
    await key('Escape');
    check(await until(`!document.getElementById('ctxMenu')&&(document.activeElement||{}).id==='ctxChip'`, 3000), `${tag} simple: Escape does not close the info popup back to the chip`);
    await js(`localStorage.setItem('durbar.detail','expert')`);

    /* demo Stop (once): the canned turn ends, Stop and the spinner go, the reply stops growing */
    if (w === SIZES[0][0]) {
      await js(`(()=>{const b=document.getElementById('backBtn');if(b)b.click();const t=document.getElementById('demoToggle');t.checked=true;t.dispatchEvent(new Event('change'));})()`);
      await until(`!!document.querySelector('#stage .desk[data-id]')`, 3000);
      await js(`document.querySelector('#stage .desk[data-id]').click()`);
      await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('msgInput')`, 3000);
      await until(`(()=>{const v=e=>!!e&&e.getClientRects().length>0,g=x=>document.getElementById(x);return v(g('sendBtn'))&&!v(g('stopBtn'))})()`, 15000); /* the opening canned turn */
      await js(`(()=>{const m=document.getElementById('msgInput');m.focus();m.select&&m.select();})()`); /* keys go to the box (on macOS the focus stayed on the desk) */
      await type('Please look at the README.');
      check(await until(`document.getElementById('sendBtn').getAttribute('aria-disabled')==='false'`, 5000), `${tag} demo: the typed text did not reach the box`);
      /* Send, look and Stop in one page task (spec 005 T075). The canned turn is a transient: under reduced motion (or on a slow runner) it can
         end between two polls, so a separate "wait for Stop" step could miss it (the macOS drivers job failed there). Read synchronously after
         the click, Stop is either there or the app is wrong; Stop then cancels the turn before its first await, so the reply must never come. */
      const sent = await js(`(()=>{const v=e=>!!e&&e.getClientRects().length>0,g=x=>document.getElementById(x);g('sendBtn').click();
        const r={stop:v(g('stopBtn')),spin:v(g('runSpin')),send:v(g('sendBtn')),users:document.querySelectorAll('#panel .msg.user .bubble').length,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,hidden:document.hidden,focus:document.hasFocus()};
        if(r.stop)g('stopBtn').click();return r;})()`);
      check(sent.stop && sent.spin && !sent.send, `${tag} demo: a canned turn shows no Stop with the spinner ${JSON.stringify(sent)}`);
      check(await until(`(()=>{const v=e=>!!e&&e.getClientRects().length>0,g=x=>document.getElementById(x);return !v(g('stopBtn'))&&!v(g('runSpin'))&&v(g('sendBtn'))})()`, 4000), `${tag} demo: Stop does not end the canned turn`);
      const stopSaid = await until(`/^Stopped$/.test(document.getElementById('srAnnounce').textContent)`, 3000); /* spec 005 T074 */
      if (!stopSaid) check(false, `${tag} demo: Stop is not announced (live region: ${await said()})`);
      const len = () => js(`(document.querySelector('#panel .chat-inner')||{textContent:''}).textContent.length`);
      const l0 = await len(); await ctx.sleep(900);
      check((await len()) === l0, `${tag} demo: the reply keeps streaming after Stop`);
      check(!(await js(`/Got it\\. I looked at/.test((document.querySelector('#panel .chat-inner')||{textContent:''}).textContent)`)), `${tag} demo: the stopped turn's reply arrived anyway`);
      await js(`(()=>{const t=document.getElementById('demoToggle');t.checked=false;t.dispatchEvent(new Event('change'));})()`);
    }

    /* spec 005 FR-052, FR-056 (once): a Claude Code agent reports a total only: no type bars, the summary says so (mixed kinds) */
    if (w === SIZES[0][0]) {
      await load(w, h, { simkinds: 'mixed' });
      const cl = await js(`(()=>{const a=window.__durbarSimUi.agents().find(x=>x.live&&!x.parent&&x.info&&x.info.adapterId==='claude'&&window.DurbarScreens.ctxChip(x).cls!=='unk');return a?a.name:null})()`);
      check(!!cl, `${tag}: no Claude Code agent with a context figure (simkinds=mixed)`);
      if (cl) {
        const cid = await H.idOf(cl);
        await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${cid}"]`)}).click()`);
        await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('ctxChip')`, 4000);
        await settle();
        await js(`document.getElementById('ctxChip').click()`);
        await until(`!!document.getElementById('ctxMenu')`, 3000);
        const cs = await js(`(${SUMMARY.toString()})()`);
        check(cs && cs.note === 'Breakdown not reported by Claude Code.' && cs.labels.length === 0 && /tokens · \d+%$/.test(cs.total), `${tag}: Claude Code's summary ${JSON.stringify(cs)}`);
        await shot(`005-composer-ctxsummary-total-${tag}.png`);
        await js(`(()=>{const b=document.querySelector('#ctxMenu button');if(b)b.focus();})()`);
        await key('Escape');
        check(await until(`!document.getElementById('ctxMenu')&&(document.activeElement||{}).id==='ctxChip'`, 3000), `${tag}: Escape does not close the summary back to the ring`);
      }
      /* FR-055: the built-in themes lay the row out the same: no overlap, 28px, 10.5px, everything incl. MCP in the row */
      for (const th of THEMES) {
        await load(w, h, { theme: th });
        await until(`window.THEME&&THEME.current().id===${jsLiteral(th)}`, 6000);
        await openIdle();
        const tm = await M();
        tm.P.forEach((p) => check(false, `${tag} ${th}: ${p}`));
        check(!tm.more && tm.rowIds.includes('mcpBtn') && tm.rowIds.includes('ctxChip'), `${tag} ${th}: not everything is in the row ${JSON.stringify({ more: tm.more, row: tm.rowIds })}`);
        const ringColour = await js(`(()=>{const a=document.querySelector('#ctxChip svg.ring .rv');return a?getComputedStyle(a).stroke:''})()`);
        check(!!ringColour && ringColour !== 'none' && !/rgba\(0, 0, 0, 0\)/.test(ringColour), `${tag} ${th}: the ring has no colour (${ringColour})`);
      }
    }

    /* a dark user theme: the same checks */
    await load(w, h, { theme: 'audit-dark', usertheme: DARK });
    await until(`window.THEME&&THEME.current().id==='audit-dark'`, 6000);
    await openIdle();
    m = await M();
    m.P.forEach((p) => check(false, `${tag} dark: ${p}`));
    await shot(`005-composer-expert-dark-${tag}.png`);
    await js(`localStorage.setItem('durbar.detail','simple')`);
    await load(w, h, { theme: 'audit-dark', usertheme: DARK });
    await openIdle().catch(() => {});
    m = await M();
    m.P.forEach((p) => check(false, `${tag} dark simple: ${p}`));
    await shot(`005-composer-simple-dark-${tag}.png`);
    await js(`localStorage.setItem('durbar.detail','expert')`);
  }
  console.log('[composer-toolbar] screenshots in ' + OUT);
  assert.deepStrictEqual(fails, [], fails.join('\n'));
  console.log('[composer-toolbar] all checks passed');
};
