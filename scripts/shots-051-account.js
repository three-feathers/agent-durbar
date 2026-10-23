/*
 * Spec 051 FR-013..FR-015 (issue #617): the signed-in account per agent app, in the simulator at 1440x900 and 1280x800. The simulator
 * answers a fake identity (octo-sim, sim@example.com), never a real account.
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-051-account.js xvfb-run -a npx electron . --no-sandbox
 *
 * Checks: Settings > Agent apps shows the account line on each ready card (and none on a card that is not ready or not signed in), at
 * least 10.5px and inside its card; the name is masked and blurred, and the eye button (labelled, keyboard) reveals it in that view
 * only; the agent-app picker's options and the select carry the masked line as a tooltip; "About agent apps" lists it masked; no
 * clear name is in the page before a reveal; the API-key and unknown forms. FR-018: the reported plan replaces the generic blurb once
 * signed in (none when not reported), and the name and its eye stay on one line, also in narrow cards. Prints "[051-account] PASS".
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

// spec 051 FR-016: every line is masked until the eye button reveals it in Settings (the clear names are the simulator's fakes)
// FR-018: Settings shows the line without the plan and the plan on its own line in place of the generic blurb; the tooltips keep it
const COPILOT = 'Signed in as o••• (GitHub, through the GitHub CLI)';
const CLAUDE = 'Signed in as s•••@example.com (Claude)';
const COPILOT_TIP = 'Signed in as o••• · Copilot Individual';
const CLAUDE_TIP = 'Signed in as s•••@example.com · Claude Pro';
const BLURB = { copilot: 'Uses your GitHub account; a free plan works', claude: 'Uses your Claude plan (Pro or Max) or an Anthropic API key', codex: 'Uses your ChatGPT plan (Plus, Pro or Team)' };
const CLEAR = ['octo-sim', 'sim@example.com'];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'mouse', tag: '051-account' });
  const openSettings = async () => {
    await js(`document.getElementById('settingsBtn').click()`);
    assert.ok(await until(`document.querySelectorAll('.hs-card').length===3&&!document.querySelector('.hs-acct[aria-busy]')&&document.querySelectorAll('.hs-acct').length>0`), 'the account lines are filled in');
    await settle();
  };
  // the plan slot per card: [kind, text or null when hidden]
  const plans = () => js(`[...document.querySelectorAll('.hs-card')].map(c=>{const p=c.querySelector('[data-plan-for]');return [c.dataset.kind,p&&!p.hidden&&p.getClientRects().length?p.textContent:null]})`);
  // FR-018 (owner): the masked name and its eye button sit on one line, side by side, in every card
  const oneLine = () => js(`[...document.querySelectorAll('.hs-acct-who')].map(w=>{const n=w.querySelector('.hs-acct-name').getBoundingClientRect(),b=w.querySelector('.hs-reveal').getBoundingClientRect(),c=w.closest('.hs-card').getBoundingClientRect();const nm=(n.top+n.bottom)/2,bm=(b.top+b.bottom)/2;return {sameLine:Math.abs(nm-bm)<Math.max(n.height,b.height)/2,next:b.left>=n.right-1&&b.left-n.right<=10,inCard:b.right<=c.right+0.5,rects:w.getClientRects().length}})`);
  const lines = () => js(`[...document.querySelectorAll('.hs-card')].map(c=>{const p=c.querySelector('.hs-acct');return [c.dataset.kind,p?p.textContent:null]})`);
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    // simkinds=1: Copilot and Claude Code ready (the picker shows), Codex too old
    await H.load({ w, h, query: { simkinds: '1' }, ready: 'fit' });
    await openSettings();
    assert.deepStrictEqual(await lines(), [['copilot', COPILOT], ['claude', CLAUDE], ['codex', null]], 'one line per ready card, none for a card that is not ready');
    assert.deepStrictEqual(await plans(), [['copilot', 'Plan: Copilot Individual'], ['claude', 'Plan: Claude Pro'], ['codex', BLURB.codex]], 'signed in: the reported plan replaces the blurb; not ready: the blurb stays');
    const ol = await oneLine();
    assert.ok(ol.length === 2 && ol.every((x) => x.sameLine && x.next && x.inCard && x.rects === 1), 'name and eye on one line: ' + JSON.stringify(ol));
    // narrow cards: the unit still does not break; the rest of the line wraps around it
    await js(`document.querySelector('.hs-list').style.maxWidth='560px'`); await settle();
    const narrow = await oneLine();
    const wraps = await js(`[...document.querySelectorAll('.hs-acct')].map(p=>p.getClientRects().length&&Math.round(p.getBoundingClientRect().height/parseFloat(getComputedStyle(p).lineHeight||'16')))`);
    assert.ok(narrow.every((x) => x.sameLine && x.next && x.inCard && x.rects === 1), 'narrow cards keep name and eye together: ' + JSON.stringify(narrow));
    assert.ok(wraps.some((n) => n >= 2), 'the narrow line wraps elsewhere: ' + JSON.stringify(wraps));
    await js(`document.querySelector('.hs-list').style.maxWidth=''`); await settle();
    const fit = await js(`[...document.querySelectorAll('.hs-acct')].map(p=>{const c=p.closest('.hs-card').getBoundingClientRect(),r=p.getBoundingClientRect();return {in:r.left>=c.left-0.5&&r.right<=c.right+0.5,px:parseFloat(getComputedStyle(p).fontSize),h:r.height}})`);
    assert.ok(fit.every((f) => f.in && f.px >= 10.5 && f.h > 0), 'inside the card, at least 10.5px: ' + JSON.stringify(fit));
    // FR-016: masked and blurred, with a labelled eye button; no clear name anywhere in the page yet
    const hid = await js(`[...document.querySelectorAll('.hs-acct .hs-acct-name')].map(n=>({t:n.textContent,hidden:n.classList.contains('is-hidden'),blur:getComputedStyle(n).filter}))`);
    assert.deepStrictEqual(hid.map((x) => [x.t, x.hidden]), [['o•••', true], ['s•••@example.com', true]], 'names masked: ' + JSON.stringify(hid));
    assert.ok(hid.every((x) => /blur/.test(x.blur)), 'and blurred');
    const clearIn = () => js(`(()=>{const t=document.body.innerText+' '+[...document.querySelectorAll('[title],[aria-label]')].map(e=>e.title+' '+e.getAttribute('aria-label')).join(' ');return ${jsLiteral(CLEAR)}.filter(n=>t.includes(n))})()`);
    assert.deepStrictEqual(await clearIn(), [], 'no clear name in the page before a reveal');
    const btns = await js(`[...document.querySelectorAll('.hs-acct .hs-reveal')].map(b=>({l:b.getAttribute('aria-label'),p:b.getAttribute('aria-pressed'),tag:b.tagName,w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height}))`);
    assert.ok(btns.length === 2 && btns.every((b) => b.tag === 'BUTTON' && b.l === 'Show the account name' && b.p === 'false' && b.w >= 24 && b.h >= 24), 'a labelled button, at least 24px: ' + JSON.stringify(btns));
    await js(`document.getElementById('hsH').scrollIntoView()`); await settle();
    await shot(`051-account-${w}x${h}.png`); // blurred: the picture shows no name
    // keyboard: focus the Claude button and press Enter, then Space to hide again
    await js(`document.querySelector('.hs-card[data-kind="claude"] .hs-reveal').focus()`);
    await H.key('Return'); await settle();
    const shown = await js(`(()=>{const c=document.querySelector('.hs-card[data-kind="claude"]'),b=c.querySelector('.hs-reveal'),n=c.querySelector('.hs-acct-name');return {t:n.textContent,hidden:n.classList.contains('is-hidden'),p:b.getAttribute('aria-pressed'),l:b.getAttribute('aria-label'),focus:document.activeElement===b,other:document.querySelector('.hs-card[data-kind="copilot"] .hs-acct-name').textContent}})()`);
    assert.deepStrictEqual(shown, { t: 'sim@example.com', hidden: false, p: 'true', l: 'Hide the account name', focus: true, other: 'o•••' }, 'Enter reveals this one name only: ' + JSON.stringify(shown));
    await H.key('Space'); await settle();
    assert.strictEqual(await js(`document.querySelector('.hs-card[data-kind="claude"] .hs-acct-name').textContent`), 's•••@example.com', 'Space hides it again');
    // per view, never saved: reveal, leave Settings, come back: hidden again
    await js(`document.querySelector('.hs-card[data-kind="copilot"] .hs-reveal').click()`);
    assert.strictEqual(await js(`document.querySelector('.hs-card[data-kind="copilot"] .hs-acct-name').textContent`), 'octo-sim', 'a click reveals too');
    await H.key('Escape'); await settle();
    await openSettings();
    assert.deepStrictEqual(await js(`[...document.querySelectorAll('.hs-acct .hs-acct-name')].map(n=>n.textContent)`), ['o•••', 's•••@example.com'], 'a new visit shows them hidden again');
    // the picker: each ready option's tooltip and the select's own tooltip for the chosen app
    await H.key('Escape'); await settle();
    const pick = await js(`(()=>{const s=document.getElementById('kindSel');return {title:s.title,opts:[...s.options].map(o=>[o.value,o.title||''])}})()`);
    assert.deepStrictEqual(pick.opts.find((o) => o[0] === 'copilot'), ['copilot', 'Copilot: ' + COPILOT_TIP], 'the Copilot option says the account: ' + JSON.stringify(pick));
    assert.deepStrictEqual(pick.opts.find((o) => o[0] === 'claude'), ['claude', 'Claude Code: ' + CLAUDE_TIP]);
    assert.deepStrictEqual(pick.opts.find((o) => o[0] === 'codex'), ['codex', ''], 'no account on an app that is not ready');
    assert.ok(/^Agent app for new folders and sessions\. (Copilot|Claude Code): Signed in as /.test(pick.title), 'the select names the chosen app\'s account: ' + pick.title);
    // About agent apps lists it after the state
    await js(`document.getElementById('kindHelp').click()`);
    assert.ok(await until(`document.querySelectorAll('.dlist li').length>=3`), 'About agent apps opened');
    const about = await js(`[...document.querySelectorAll('.dlist li')].map(l=>l.textContent)`);
    // FR-020: About says "ready" already, so it lists only the masked name and the plan
    assert.ok(about.some((t) => t.startsWith('Copilot: ready · o••• · Copilot Individual')), 'About lists the Copilot account: ' + JSON.stringify(about));
    assert.ok(about.some((t) => t.startsWith('Claude Code: ready · s•••@example.com · Claude Pro')), 'About lists the Claude account');
    assert.ok(about.some((t) => /^Codex: too old/.test(t) && !/Signed in/.test(t)), 'no account on an app that is not ready');
    assert.deepStrictEqual(await clearIn(), [], 'the tooltips and About agent apps hold no clear name');
    await H.key('Escape'); await settle();
  }
  // the other forms (one size each): an API key, unknown, and not signed in
  await H.load({ w: 1280, h: 800, query: { simkinds: '1', simacct: 'apikey' }, ready: 'fit' });
  await openSettings();
  assert.deepStrictEqual((await lines())[1], ['claude', 'Signed in with an Anthropic API key']);
  assert.deepStrictEqual((await plans())[1], ['claude', null], 'signed in without a reported plan: no blurb and no plan line');
  await H.load({ w: 1280, h: 800, query: { simkinds: '1', simacct: 'noplan' }, ready: 'fit' });
  await openSettings();
  assert.deepStrictEqual((await plans())[0], ['copilot', null], 'Copilot without a plan: no blurb, no guess');
  await H.load({ w: 1440, h: 900, query: { simkinds: '1', simacct: 'unknown' }, ready: 'fit' });
  await openSettings();
  assert.deepStrictEqual((await lines())[1], ['claude', 'Account unknown']);
  assert.deepStrictEqual((await plans())[1], ['claude', BLURB.claude], 'unknown: the blurb stays');
  await H.load({ w: 1440, h: 900, query: { simkinds: '1', simauth: 'out' }, ready: 'fit' });
  await js(`document.getElementById('settingsBtn').click()`);
  assert.ok(await until(`document.querySelectorAll('.hs-card').length===3&&[...document.querySelectorAll('.hs-card .hs-st')].every(s=>!/Checking/i.test(s.textContent))`));
  await settle(300);
  assert.deepStrictEqual(await lines(), [['copilot', null], ['claude', null], ['codex', null]], 'a card that is not signed in says so with its chip, not a second line');
  assert.deepStrictEqual(await plans(), [['copilot', BLURB.copilot], ['claude', BLURB.claude], ['codex', BLURB.codex]], 'not signed in: the blurbs stay');
  console.log('[051-account] PASS');
};
