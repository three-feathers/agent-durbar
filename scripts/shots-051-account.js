/*
 * Spec 051 FR-013..FR-015 (issue #617): the signed-in account per agent app, in the simulator at 1440x900 and 1280x800. The simulator
 * answers a fake identity (octo-sim, sim@example.com), never a real account.
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-051-account.js xvfb-run -a npx electron . --no-sandbox
 *
 * Checks: Settings > Agent apps shows the account line on each ready card (and none on a card that is not ready or not signed in), at
 * least 10.5px and inside its card; the agent-app picker's options and the select carry it as a tooltip; "About agent apps" lists it;
 * the API-key and unknown forms. Prints "[051-account] PASS".
 */
const assert = require('assert');
const path = require('path');
const { helpers } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

const COPILOT = 'Signed in as octo-sim (GitHub, through the GitHub CLI)';
const CLAUDE = 'Signed in as sim@example.com · Claude Pro';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'mouse', tag: '051-account' });
  const openSettings = async () => {
    await js(`document.getElementById('settingsBtn').click()`);
    assert.ok(await until(`document.querySelectorAll('.hs-card').length===3&&!document.querySelector('.hs-acct[aria-busy]')&&document.querySelectorAll('.hs-acct').length>0`), 'the account lines are filled in');
    await settle();
  };
  const lines = () => js(`[...document.querySelectorAll('.hs-card')].map(c=>{const p=c.querySelector('.hs-acct');return [c.dataset.kind,p?p.textContent:null]})`);
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    // simkinds=1: Copilot and Claude Code ready (the picker shows), Codex too old
    await H.load({ w, h, query: { simkinds: '1' }, ready: 'fit' });
    await openSettings();
    assert.deepStrictEqual(await lines(), [['copilot', COPILOT], ['claude', CLAUDE], ['codex', null]], 'one line per ready card, none for a card that is not ready');
    const fit = await js(`[...document.querySelectorAll('.hs-acct')].map(p=>{const c=p.closest('.hs-card').getBoundingClientRect(),r=p.getBoundingClientRect();return {in:r.left>=c.left-0.5&&r.right<=c.right+0.5,px:parseFloat(getComputedStyle(p).fontSize),h:r.height}})`);
    assert.ok(fit.every((f) => f.in && f.px >= 10.5 && f.h > 0), 'inside the card, at least 10.5px: ' + JSON.stringify(fit));
    await js(`document.getElementById('hsH').scrollIntoView()`); await settle();
    await shot(`051-account-${w}x${h}.png`);
    // the picker: each ready option's tooltip and the select's own tooltip for the chosen app
    await js(`(document.querySelector('.scr-back')||document.querySelector('[data-scr-close]')||{click(){}}).click()`);
    await H.key('Escape'); await settle();
    const pick = await js(`(()=>{const s=document.getElementById('kindSel');return {title:s.title,opts:[...s.options].map(o=>[o.value,o.title||''])}})()`);
    assert.deepStrictEqual(pick.opts.find((o) => o[0] === 'copilot'), ['copilot', 'Copilot: ' + COPILOT], 'the Copilot option says the account: ' + JSON.stringify(pick));
    assert.deepStrictEqual(pick.opts.find((o) => o[0] === 'claude'), ['claude', 'Claude Code: ' + CLAUDE]);
    assert.deepStrictEqual(pick.opts.find((o) => o[0] === 'codex'), ['codex', ''], 'no account on an app that is not ready');
    assert.ok(/^Agent app for new folders and sessions\. (Copilot|Claude Code): Signed in as /.test(pick.title), 'the select names the chosen app\'s account: ' + pick.title);
    // About agent apps lists it after the state
    await js(`document.getElementById('kindHelp').click()`);
    assert.ok(await until(`document.querySelectorAll('.dlist li').length>=3`), 'About agent apps opened');
    const about = await js(`[...document.querySelectorAll('.dlist li')].map(l=>l.textContent)`);
    assert.ok(about.some((t) => t.startsWith('Copilot: ready · ' + COPILOT)), 'About lists the Copilot account: ' + JSON.stringify(about));
    assert.ok(about.some((t) => t.startsWith('Claude Code: ready · ' + CLAUDE)), 'About lists the Claude account');
    assert.ok(about.some((t) => /^Codex: too old/.test(t) && !/Signed in/.test(t)), 'no account on an app that is not ready');
    await H.key('Escape'); await settle();
  }
  // the other forms (one size each): an API key, unknown, and not signed in
  await H.load({ w: 1280, h: 800, query: { simkinds: '1', simacct: 'apikey' }, ready: 'fit' });
  await openSettings();
  assert.deepStrictEqual((await lines())[1], ['claude', 'Signed in with an Anthropic API key']);
  await H.load({ w: 1440, h: 900, query: { simkinds: '1', simacct: 'unknown' }, ready: 'fit' });
  await openSettings();
  assert.deepStrictEqual((await lines())[1], ['claude', 'Account unknown']);
  await H.load({ w: 1440, h: 900, query: { simkinds: '1', simauth: 'out' }, ready: 'fit' });
  await js(`document.getElementById('settingsBtn').click()`);
  assert.ok(await until(`document.querySelectorAll('.hs-card').length===3&&[...document.querySelectorAll('.hs-card .hs-st')].every(s=>!/Checking/i.test(s.textContent))`));
  await settle(300);
  assert.deepStrictEqual(await lines(), [['copilot', null], ['claude', null], ['codex', null]], 'a card that is not signed in says so with its chip, not a second line');
  console.log('[051-account] PASS');
};
