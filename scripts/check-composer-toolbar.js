/*
 * Check for spec 005 FR-037..FR-043 (owner request, 2026-10-21): the chat's settings sit in a toolbar under the message box, and one
 * Send / Stop slot sits inside the box's right edge. Simulator only (no AI credits).
 *
 *   npm run check:composer-toolbar
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
    send: vis(send), stop: vis($('stopBtn')), spin: vis($('runSpin')),
  };
}

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
    check(/·\s*\d+(\.\d+)?\s*[KM]/i.test(m.model), `${tag}: the model chip shows no window size (${m.model})`);
    check(/MCP\s*\d+/.test(m.mcp.replace(/\s+/g, ' ')), `${tag}: the MCP chip shows no count (${m.mcp})`);
    check(m.send && !m.stop && !m.spin, `${tag}: idle shows Send only ${JSON.stringify(m)}`);
    check(await js(`document.getElementById('sendBtn').getAttribute('aria-disabled')==='true'`), `${tag}: Send is not disabled while the box is empty`);
    await shot(`005-composer-expert-light-${tag}.png`);

    /* the context menu: above the chip, Compact in it, Escape back to the chip */
    await js(`document.getElementById('ctxChip').click()`);
    check(await until(`!!document.getElementById('ctxMenu')`, 3000), `${tag}: the context chip opens no menu`);
    const cm = await js(`(()=>{const m=document.getElementById('ctxMenu'),c=document.getElementById('ctxChip');if(!m)return null;return {above:m.getBoundingClientRect().bottom<=c.getBoundingClientRect().top+0.5,compact:!!m.querySelector('#compactBtn'),tools:/Models and context/.test(m.innerText),exp:c.getAttribute('aria-expanded')}})()`);
    check(cm && cm.above && cm.compact && cm.tools && cm.exp === 'true', `${tag}: context menu ${JSON.stringify(cm)}`);
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
    await key('Escape'); await until(`!/MCP servers for /.test((document.querySelector('.dlg h3')||{}).textContent||'')`, 3000);

    /* Send -> Stop with the spinner -> Send */
    await type('Please look at the README.');
    check(await js(`document.getElementById('sendBtn').getAttribute('aria-disabled')==='false'`), `${tag}: Send stays disabled with text`);
    await js(`document.getElementById('sendBtn').click()`);
    check(await until(`(()=>{const v=e=>!!e&&e.getClientRects().length>0;return v(document.getElementById('stopBtn'))&&v(document.getElementById('runSpin'))&&!v(document.getElementById('sendBtn'))})()`, 5000), `${tag}: a running turn does not show Stop with the spinner`);
    m = await M();
    m.P.forEach((p) => check(false, `${tag} running: ${p}`));
    check(await js(`document.getElementById('runSpin').getBoundingClientRect().right<=document.getElementById('stopBtn').getBoundingClientRect().left+0.5`), `${tag}: the spinner is not left of Stop`);
    await shot(`005-composer-running-${tag}.png`);
    await type('and the tests');
    check(await until(`(()=>{const v=e=>!!e&&e.getClientRects().length>0;return v(document.getElementById('sendBtn'))&&v(document.getElementById('stopBtn'))})()`, 3000), `${tag}: typing during a turn does not offer Send beside Stop`);
    m = await M();
    m.P.forEach((p) => check(false, `${tag} running+text: ${p}`));
    await type('');
    await js(`document.getElementById('stopBtn').click()`);
    check(await until(`(()=>{const v=e=>!!e&&e.getClientRects().length>0;return v(document.getElementById('sendBtn'))&&!v(document.getElementById('stopBtn'))&&!v(document.getElementById('runSpin'))})()`, 6000), `${tag}: Stop does not bring Send back`);

    /* narrow panel (spec #452's docking may give it 480px): one row, "⋯", the mode stays */
    await js(`(()=>{const s=document.createElement('style');s.id='narrowPanel';s.textContent='#panel{flex:0 0 480px!important;max-width:480px!important}';document.head.append(s);})()`);
    await until(`(()=>{const b=document.getElementById('ctMoreBtn');return !!b&&!b.hidden})()`, 3000);
    await settle();
    m = await M();
    m.P.forEach((p) => check(false, `${tag} narrow: ${p}`));
    check(m.more && m.rowIds.includes('modeChip') && m.popIds.length > 0, `${tag} narrow: overflow ${JSON.stringify({ more: m.more, row: m.rowIds, pop: m.popIds })}`);
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
      await type('Please look at the README.');
      await js(`document.getElementById('sendBtn').click()`);
      check(await until(`(()=>{const v=e=>!!e&&e.getClientRects().length>0,g=x=>document.getElementById(x);return v(g('stopBtn'))})()`, 3000), `${tag} demo: a canned turn shows no Stop`);
      await js(`document.getElementById('stopBtn').click()`);
      check(await until(`(()=>{const v=e=>!!e&&e.getClientRects().length>0,g=x=>document.getElementById(x);return !v(g('stopBtn'))&&!v(g('runSpin'))&&v(g('sendBtn'))})()`, 1500), `${tag} demo: Stop does not end the canned turn`);
      const len = () => js(`(document.querySelector('#panel .chat-inner')||{textContent:''}).textContent.length`);
      const l0 = await len(); await ctx.sleep(900);
      check((await len()) === l0, `${tag} demo: the reply keeps streaming after Stop`);
      await js(`(()=>{const t=document.getElementById('demoToggle');t.checked=false;t.dispatchEvent(new Event('change'));})()`);
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
