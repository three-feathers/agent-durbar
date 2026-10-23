/*
 * Check for spec 073 (owner request, 2026-10-22): the "/" list in the chat's message box. Simulator only (no AI credits).
 *
 *   npm run check:slash-suggest
 *   OUT=docs/screenshots  (optional) where the screenshots go (default: a temp folder)
 *
 * At 1440x900 and 1280x800 (simkinds=mixed: Noor is an idle Claude Code agent, Hugo an idle Copilot one):
 *   - "/" at the start of the box opens a listbox (ARIA: combobox on the box, aria-expanded, aria-controls, aria-activedescendant);
 *     folder entries, then user, then app built-ins; at most 8 rows visible, the rest scroll inside the list;
 *   - the list sits above the message box, inside the panel, never over the box; no text under 10.5px; a name of up to 24 characters
 *     is never cut by a long argument hint (review on #535);
 *   - typing filters; ArrowDown / ArrowUp move and wrap; Tab and Enter insert "/name " and do not send; a click inserts;
 *   - Esc closes only the list (the chat stays open), a second Esc then closes the chat as before;
 *   - "/" inside a word or a URL opens nothing;
 *   - sending "/<folder or user entry> words" shows the note "Sent the text of …";
 *   - a Copilot chat lists no app built-ins (spec 073 FR-009);
 *   - with the entries fetched, the list opens in under 100 ms (SC-002);
 *   - a dark user theme: the same geometry; screenshots;
 *   - simslash=secret (spec 073 FR-012, issue #608): a folder skill and a command with fake token shapes in the name, hint,
 *     description and place, split by Markdown, escaped, and one at the tooltip's 300-character cut: no raw token (not even 6
 *     characters of one) in the list's text, any `title` or `aria-*`, the announcement or the "Sent the text of" note.
 * A miss throws (DRIVER FAILED); the npm script exits non-zero unless "all checks passed" is printed.
 */
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const OUT = process.env.OUT || process.env.SHOTS_OUT || require('os').tmpdir();
const DARK = fs.readFileSync(path.join(__dirname, 'fixtures', 'themes', 'dark-audit.json'), 'utf8');
const SIZES = [[1440, 900], [1280, 800]];

/* runs in the page: the list's geometry, rows and attributes */
function measure() {
  const R = (e) => e.getBoundingClientRect();
  const $ = (id) => document.getElementById(id);
  const P = [];
  const list = $('slashList'), input = $('msgInput'), box = document.querySelector('#panel .inbox'), panel = $('panel');
  if (!list) return { open: false, P: [] };
  const lr = R(list), br = R(box), pr = R(panel);
  if (lr.bottom > br.top + 0.5) P.push(`the list covers the message box (${lr.bottom} > ${br.top})`);
  if (lr.left < pr.left - 1 || lr.right > pr.right + 1) P.push('the list leaves the panel');
  if (lr.top < 0) P.push('the list leaves the window');
  const opts = [...list.querySelectorAll('[role="option"]')];
  const full = opts.filter((o) => { const r = R(o); return r.top >= lr.top - 0.5 && r.bottom <= lr.bottom + 0.5; });
  if (full.length > 8) P.push(`${full.length} rows visible (at most 8)`);
  const small = [...list.querySelectorAll('*')].filter((e) => e.getClientRects().length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 10.5).map((e) => e.className);
  if (small.length) P.push('text under 10.5px: ' + small.slice(0, 3).join(', '));
  // review on #535: a long hint gives way before the name; a name of up to 24 characters is never cut
  for (const o of opts) {
    const n = o.querySelector('.sl-name'), has = R(n).width;
    n.style.flex = 'none'; const need = R(n).width; n.style.flex = ''; /* its own width: an ellipsis shows for a fraction of a pixel */
    if (n.textContent.length <= 24 && need > has + 0.01) P.push(`the name ${n.textContent} is cut (${has.toFixed(3)} of ${need.toFixed(3)}px)`);
  }
  if (list.getAttribute('role') !== 'listbox') P.push('the list is not a listbox');
  if (input.getAttribute('role') !== 'combobox' || input.getAttribute('aria-expanded') !== 'true' || input.getAttribute('aria-controls') !== 'slashList') P.push('the box is not an expanded combobox for the list');
  const act = input.getAttribute('aria-activedescendant');
  if (opts.length && (!act || !$(act) || $(act).getAttribute('aria-selected') !== 'true')) P.push('aria-activedescendant does not name the selected option');
  return {
    open: true, P, n: opts.length, visible: full.length, scrolls: list.scrollHeight > list.clientHeight + 1,
    names: opts.map((o) => o.querySelector('.sl-name').textContent), sources: opts.map((o) => (o.querySelector('.sl-src').className.match(/sl-(folder|user|app)/) || [])[1]),
    active: act, empty: (list.querySelector('.sl-empty') || {}).textContent || '',
  };
}

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js, key, wc } = H;
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'calm', tag: 'slash' }); /* no blur: the list closes with the box's focus */
  const fails = [];
  const check = (cond, msg) => { if (!cond) { fails.push(msg); console.log('FAIL ' + msg); } };
  const M = () => js(`(${measure.toString()})()`);
  const focusBox = () => js(`(()=>{const m=document.getElementById('msgInput');m.focus();m.value='';m.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const typeChars = async (t) => { for (const ch of t) { wc().sendInputEvent({ type: 'char', keyCode: ch }); await ctx.sleep(25); } await ctx.sleep(60); };
  const value = () => js(`document.getElementById('msgInput').value`);
  const open = async (name) => {
    const id = await H.idOf(name);
    assert.ok(id, `${name} is on the floor`);
    if (await js(`document.body.classList.contains('panel-open')`)) { await js(`document.getElementById('backBtn').click()`); await until(`!document.body.classList.contains('panel-open')`, 4000); }
    await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"]`)}).click()`);
    await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('msgInput')`);
    await settle();
    await until(`(()=>{const v=e=>!!e&&e.getClientRects().length>0;return v(document.getElementById('sendBtn'))})()`, 15000);
    await focusBox();
  };
  const load = (w, h, q) => H.load({ w, h, query: { simkinds: 'mixed', ...(q || {}) }, ready: 'fit' });

  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    await load(w, h);
    await open('Noor');
    check(await js(`document.getElementById('msgInput').getAttribute('role')==='combobox'&&document.getElementById('msgInput').getAttribute('aria-expanded')==='false'`), `${tag}: the box is not a collapsed combobox before "/"`);

    /* "/" opens the list: folder, user, app; 10 entries, 8 rows visible, the rest scroll */
    await typeChars('/');
    check(await until(`!!document.querySelector('#slashList [role="option"]')`, 4000), `${tag}: "/" opens no list`);
    let m = await M();
    m.P.forEach((p) => check(false, `${tag}: ${p}`));
    check(m.n === 10 && m.visible <= 8 && m.scrolls, `${tag}: rows ${JSON.stringify({ n: m.n, visible: m.visible, scrolls: m.scrolls })}`);
    const ord = m.sources.join(',');
    check(/^(folder,)+(user,)+(app,?)+$/.test(ord + ','), `${tag}: order folder, user, app (${ord})`);
    check(m.active === 'slashOpt-0', `${tag}: the first row is not active (${m.active})`);
    check(await until(`/10 commands/.test(document.getElementById('srAnnounce').textContent)`, 2000), `${tag}: the count is not announced`);
    await shot(`073-slash-${tag}.png`);
    (await M()).P.forEach((p) => check(false, `${tag} (at the screenshot, fonts loaded): ${p}`));

    /* arrows wrap; typing filters */
    await key('Down'); m = await M();
    check(m.active === 'slashOpt-1', `${tag}: ArrowDown does not move to the second row (${m.active})`);
    await key('Up'); await key('Up'); m = await M();
    check(m.active === `slashOpt-${m.n - 1}`, `${tag}: ArrowUp does not wrap to the last row (${m.active})`);
    await typeChars('rel'); m = await M();
    check(m.names.join() === '/release-notes', `${tag}: "/rel" lists ${m.names.join()}`);
    await typeChars('zzz'); m = await M();
    check(m.open && m.n === 0 && /No matching commands/.test(m.empty), `${tag}: no match does not say so (${JSON.stringify(m)})`);
    for (let i = 0; i < 6; i++) await key('Backspace');
    m = await M();
    check(m.n === 10, `${tag}: Backspace back to "/" does not list all again (${m.n})`);

    /* Tab inserts "/name " and keeps the focus in the box */
    await typeChars('re');
    await key('Tab');
    check(await value() === '/review-pr ', `${tag}: Tab inserted "${await value()}"`);
    check(!(await js(`!!document.getElementById('slashList')`)) && await js(`document.activeElement&&document.activeElement.id==='msgInput'&&document.getElementById('msgInput').getAttribute('aria-expanded')==='false'`), `${tag}: after Tab the list is still open or the focus left the box`);

    /* Enter inserts and does not send; then Enter sends, and the chat says which file's text was sent */
    const users = () => js(`document.querySelectorAll('#panel .msg.user').length`);
    await focusBox();
    const u0 = await users();
    await typeChars('/expl');
    await key('Return');
    check(await value() === '/explain ' && (await users()) === u0, `${tag}: Enter on the list inserted "${await value()}" or sent`);
    await typeChars('src/app.js');
    await key('Return');
    check(await until(`[...document.querySelectorAll('#panel .note')].some(n=>/Sent the text of/.test(n.textContent)&&/explain\\.md/.test(n.textContent))`, 5000), `${tag}: no "Sent the text of" note after sending /explain`);

    /* Esc closes only the list; a second Esc closes the chat as before */
    await until(`(()=>{const v=e=>!!e&&e.getClientRects().length>0;return v(document.getElementById('sendBtn'))})()`, 15000);
    await focusBox();
    await typeChars('/');
    await until(`!!document.getElementById('slashList')`, 3000);
    await key('Escape');
    check(!(await js(`!!document.getElementById('slashList')`)) && await js(`document.body.classList.contains('panel-open')`) && (await value()) === '/', `${tag}: Esc did not close only the list`);
    await key('Escape');
    check(await until(`!document.body.classList.contains('panel-open')`, 3000), `${tag}: a second Esc does not close the chat`);

    /* "/" inside a word or a URL opens nothing; a click on a row inserts it */
    await open('Noor');
    await typeChars('see http://x');
    check(!(await js(`!!document.getElementById('slashList')`)), `${tag}: a URL opened the list`);
    await focusBox();
    await typeChars('a/b');
    check(!(await js(`!!document.getElementById('slashList')`)), `${tag}: "/" inside a word opened the list`);
    await focusBox();
    await typeChars('/');
    await until(`!!document.querySelector('#slashOpt-2')`, 3000);
    const third = await js(`document.querySelector('#slashOpt-2 .sl-name').textContent`);
    await js(`document.getElementById('slashOpt-2').click()`);
    check(await value() === third + ' ', `${tag}: a click inserted "${await value()}" (want "${third} ")`);

    /* SC-002: with the entries fetched, "/" shows the list at once */
    await focusBox();
    const t = await js(`(()=>{const i=document.getElementById('msgInput');const t0=performance.now();i.value='/';i.setSelectionRange(1,1);i.dispatchEvent(new Event('input',{bubbles:true}));return {ms:performance.now()-t0,open:!!document.querySelector('#slashList [role="option"]')}})()`);
    check(t.open && t.ms < 100, `${tag}: the list took ${t.ms.toFixed(1)} ms (open ${t.open})`);
    await key('Escape');

    /* a Copilot chat: its skills, no app built-ins */
    await open('Hugo');
    await typeChars('/');
    await until(`!!document.querySelector('#slashList [role="option"]')`, 4000);
    m = await M();
    m.P.forEach((p) => check(false, `${tag} copilot: ${p}`));
    check(m.n > 0 && !m.sources.includes('app'), `${tag}: the Copilot list ${m.sources.join()}`);
    await key('Escape');

    /* a dark user theme: same geometry */
    await load(w, h, { theme: 'audit-dark', usertheme: DARK });
    await until(`window.THEME&&THEME.current().id==='audit-dark'`, 6000);
    await open('Noor');
    await typeChars('/');
    await until(`!!document.querySelector('#slashList [role="option"]')`, 4000);
    m = await M();
    m.P.forEach((p) => check(false, `${tag} dark: ${p}`));
    if (w === SIZES[0][0]) await shot(`073-slash-dark-${tag}.png`);
  }
  /* FR-012 (issue #608): token shapes never reach the list, its tooltips, ARIA, the announcement or the note. Checked once (one size):
     masking does not depend on the layout. The bodies are built at run time like the simulator's (push protection). */
  {
    const BODY = ['A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8', '11ABCDEFG0aBcDeFgHiJkL_mNoPqRsTuVwXyZ0123456789abcdefghij', 'proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'];
    const ghp = 'gh' + 'p_' + BODY[0];
    const leak = (t) => { const x = String(t || ''); for (const b of BODY) for (let i = 0; i + 6 <= b.length; i++) if (x.includes(b.slice(i, i + 6))) return b.slice(i, i + 6); return ''; };
    /* every text node, title and aria-* value under the list, the box's ARIA, and the live region */
    const texts = () => js(`(()=>{const out=[];const l=document.getElementById('slashList');if(!l)return null;
      out.push(l.textContent);for(const e of [l,...l.querySelectorAll('*')])for(const a of e.attributes)if(a.name==='title'||a.name.startsWith('aria-'))out.push(a.name+'='+a.value);
      const i=document.getElementById('msgInput');for(const a of i.attributes)if(a.name.startsWith('aria-'))out.push(a.name+'='+a.value);
      out.push(document.getElementById('srAnnounce').textContent);return out;})()`);
    await load(SIZES[0][0], SIZES[0][1], { simslash: 'secret' });
    await open('Noor');
    await typeChars('/');
    check(await until(`document.querySelectorAll('#slashList [role="option"]').length>=2`, 4000), 'secret: "/" opens no list');
    const all = await texts();
    check(Array.isArray(all) && all.length > 3, 'secret: nothing read from the list');
    for (const t of all || []) { const l = leak(t); check(!l, `secret: a token piece "${l}" shows in ${t.slice(0, 160)}`); }
    const m = await M();
    check(m.names[0] === '/[redacted]' && m.names.includes('/deploy-check'), `secret: the rows ${m.names.slice(0, 3).join()}`);
    const tip = await js(`document.getElementById('slashOpt-1').getAttribute('title')`);
    check(/\[redacted\]/.test(tip) && tip.length <= 300, `secret: the long tooltip ${tip.length}: ${tip.slice(-60)}`);
    /* Tab inserts the real name (it must match the file), and the read-out is masked */
    await key('Tab');
    check(await value() === '/' + ghp + ' ', 'secret: Tab did not insert the real name');
    await until(`/Inserted/.test(document.getElementById('srAnnounce').textContent)`, 2000);
    const ann = await js(`document.getElementById('srAnnounce').textContent`);
    check(/Inserted \/\[redacted\]/.test(ann) && !leak(ann), `secret: the announcement ${ann.slice(0, 80)}`);
    /* sending it: the "Sent the text of" note names the place masked */
    await typeChars('go');
    await key('Return');
    check(await until(`[...document.querySelectorAll('#panel .note')].some(n=>/Sent the text of/.test(n.textContent))`, 5000), 'secret: no "Sent the text of" note');
    const note = await js(`[...document.querySelectorAll('#panel .note')].filter(n=>/Sent the text of/.test(n.textContent)).map(n=>n.textContent+' '+(n.getAttribute('title')||'')).join(' | ')`);
    check(!leak(note) && /\[redacted\]/.test(note), `secret: the note ${note.slice(0, 120)}`);
  }
  console.log('[slash-suggest] screenshots in ' + OUT);
  assert.deepStrictEqual(fails, [], fails.join('\n'));
  console.log('[slash-suggest] all checks passed');
};
