/*
 * Spec 011 FR-085..FR-092 (issue #690): account limits per agent app in Settings > Agent apps, in the simulator at 1440x900 and 1280x800.
 * Fixtures only (simquota=...); no adapter, no network, no account, no credits.
 *
 *   npm run build
 *   node scripts/ui-suite.js --only shots-011-quota
 *
 * Checks: separate block per ready card, units and source, "not reported" and never zero; stale and failed never read as current, also as
 * the clock passes with the window open; a failed read keeps the figures; hostile text stays text; near a limit: the suggestion, the
 * existing dialog on a person's click and nothing started; the one timer stops; the floors hold; text at least 10.5px, inside the card.
 * Prints "[011-quota] PASS".
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'mouse', tag: '011-quota' });
  const openSettings = async () => {
    await js(`document.getElementById('settingsBtn').click()`);
    assert.ok(await until(`document.querySelectorAll('.hs-quota').length>0&&[...document.querySelectorAll('.hs-quota [data-qstate]')].every(s=>s.textContent!=='Checking…')&&!document.querySelector('.hs-acct[aria-busy]')`), 'the limit blocks are filled in');
    await settle();
  };
  const load = async (w, h, simquota, extra = {}) => {
    await H.load({ w, h, query: { simkinds: 'ready', ...(simquota ? { simquota } : {}), ...extra }, ready: 'fit' });
    await openSettings();
  };
  const blocks = () => js(`Object.fromEntries([...document.querySelectorAll('.hs-quota')].map(q=>[q.dataset.quota,{state:q.querySelector('[data-qstate]').textContent,text:q.innerText.replace(/\\s+/g,' '),rows:q.querySelectorAll('.hs-q-row').length,near:q.querySelectorAll('.hs-q-row[data-level="near"]').length,used:q.querySelectorAll('.hs-q-row[data-level="exhausted"]').length,sug:!!q.querySelector('.hs-q-sug'),btn:q.querySelectorAll('[data-hs="qhand"]').length}]))`);
  // every piece of text in every block: at least 10.5px, inside its card and the window; no sideways scroll
  const fit = async (tag) => {
    const r = await js(`(()=>{const out=[];for(const q of document.querySelectorAll('.hs-quota')){const c=q.closest('.hs-card').getBoundingClientRect();const w=document.createTreeWalker(q,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode())){if(!n.textContent.trim())continue;const p=n.parentElement,cs=getComputedStyle(p);const px=parseFloat(cs.fontSize);const rg=document.createRange();rg.selectNodeContents(n);const b=rg.getBoundingClientRect();if(px<10.5||b.left<c.left-0.5||b.right>c.right+0.5||b.right>innerWidth)out.push({t:n.textContent.slice(0,30),px,l:b.left,r:b.right,cl:c.left,cr:c.right});}}return {out,page:document.scrollingElement.scrollTop,side:document.scrollingElement.scrollWidth-innerWidth,body:parseFloat(getComputedStyle(document.querySelector('.hs-quota')).fontSize)}})()`);
    assert.deepStrictEqual(r.out, [], tag + ': text at least 10.5px inside its card');
    assert.ok(r.page === 0 && r.side <= 0, tag + ': the page does not scroll: ' + JSON.stringify(r));
    assert.ok(r.body >= 10.5, tag + ': block font ' + r.body);
  };
  const checkAgain = (kind = 'copilot') => js(`document.querySelector('[data-hs="check"][data-kind='+${jsLiteral(JSON.stringify(kind))}+']').click();0`);
  const reads = () => js(`(window.__durbarSimQuotaReads||[]).slice()`);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const size = `${w}x${h}`;
    // ---- the plain view: per app its own unit, source and time; Claude Code not reported; apart from the account facts
    await load(w, h, '');
    let b = await blocks();
    assert.deepStrictEqual(Object.keys(b).sort(), ['claude', 'codex', 'copilot'], 'a block in each ready card');
    assert.strictEqual(b.copilot.state, 'Current');
    assert.match(b.copilot.text, /From the provider; not a bill and not this session's usage/);
    assert.match(b.copilot.text, /Premium requests Used: 506 requests Limit: 1,500 requests Left: 66\.3% Resets: /);
    assert.match(b.copilot.text, /reported in UTC/);
    assert.match(b.copilot.text, /Chat requests Used: 0 requests Limit: Unlimited/);
    assert.match(b.copilot.text, /Source: GitHub Copilot, account\.getQuota \(experimental; can lag a few minutes\) Checked /);
    assert.match(b.codex.text, /5-hour window Used: 12% Limit: not reported Window: 5 hours Resets: /);
    assert.ok(!/requests/.test(b.codex.text), 'Codex percent is never requests');
    assert.strictEqual(b.claude.state, 'Not reported');
    assert.match(b.claude.text, /no free, read-only call/);
    assert.ok(!/\b0\b/.test(b.claude.text), 'not reported is never a zero: ' + b.claude.text);
    assert.ok(await js(`!document.querySelector('.hs-quota').closest('.hs-facts')&&document.querySelector('.hs-card .hs-acct-box').nextElementSibling.classList.contains('hs-quota')`), 'separate, right after the account block');
    assert.ok(!(await js(`/\\bAIU\\b|tokens/.test([...document.querySelectorAll('.hs-quota')].map(q=>q.innerText).join(' '))`)), 'no per-session unit in here');
    assert.ok(!(await js(`[...document.querySelectorAll('.hs-quota')].some(q=>/total/i.test(q.innerText))`)), 'no total across apps');
    await fit(size + ' plain');
    await shot(`690-plain-${size}.png`);
    await js(`document.querySelector('.hs-card[data-kind="codex"]').scrollIntoView({block:'center'});0`);
    await settle();
    await shot(`690-plain-codex-${size}.png`);
    // the floors: no second read while the window is open or re-opened, nor on an early Check again
    let n = (await reads()).length;
    assert.strictEqual(n, 2, 'one read per app with a call');
    await js(`document.getElementById('scrClose').click();0`);
    assert.ok(await until(`!document.querySelector('.hs-quota')`), 'Settings closed');
    await openSettings();
    await checkAgain();
    await until(`document.querySelectorAll('.hs-quota').length===3`);
    await settle();
    assert.strictEqual((await reads()).length, n, 'the floors hold: opening again and an early Check again ask nothing');

    // ---- near: warning, the suggestion, the dialog on a click; nothing starts by itself
    await load(w, h, 'copilot:near,codex:current', { simquotafloor: '1' });
    b = await blocks();
    assert.strictEqual(b.copilot.near, 1);
    assert.strictEqual(b.codex.near, 0);
    assert.match(b.copilot.text, /Near a reported limit/);
    assert.match(b.copilot.text, /Past the limit: the provider says use can continue; it may cost money/);
    assert.match(b.copilot.text, /Also ready: Claude Code \(its limits are not known\), Codex\. Each app has its own limits; they are not interchangeable\. Nothing switches unless you choose it\./);
    assert.ok(!b.codex.sug, 'no suggestion on a card with room');
    assert.ok(b.copilot.btn >= 1 && b.copilot.btn <= 3, 'a button per live session, at most 3: ' + b.copilot.btn);
    await fit(size + ' near');
    const clipped = await js(`[...document.querySelectorAll('[data-hs="qhand"]')].filter(b=>b.scrollHeight>b.clientHeight+1||b.getBoundingClientRect().right>b.closest('.hs-quota').getBoundingClientRect().right).map(b=>b.textContent)`);
    assert.deepStrictEqual(clipped, [], 'the session buttons show their whole text');
    const chip = await js(`(()=>{const a=document.querySelector('.hs-q-row[data-level="near"] .hs-q-label span').getBoundingClientRect(),b=document.querySelector('.hs-q-lvl').getBoundingClientRect();return a.bottom<=b.top+1||a.right<=b.left+1})()`);
    assert.ok(chip, 'the near chip does not overlap its label');
    await js(`document.querySelector('.hs-card[data-kind="copilot"] .hs-quota').scrollIntoView({block:'start'});0`);
    await settle();
    await shot(`690-near-${size}.png`);
    const before = await js(`({n:window.__durbarSimUi.agents().length,st:window.__durbarSimUi.agents().map(a=>a.state).join()})`);
    await settle();
    assert.ok(!(await js(`!!document.getElementById('sessDlg')`)), 'the warning alone opens nothing');
    // an ended session: its button gets a note, and no dialog
    await js(`(()=>{const x=document.querySelector('[data-hs="qhand"]');const keep=x.dataset.agent;x.dataset.agent='gone-session';x.click();x.dataset.agent=keep;})();0`);
    assert.ok(await until(`[...document.querySelectorAll('#toasts .toast')].some(t=>/session has ended/.test(t.textContent))`), 'an ended session says so');
    assert.ok(!(await js(`!!document.getElementById('sessDlg')`)), 'and opens nothing');
    await H.clearToasts();
    // the person's click: the existing reviewed dialog, the alternative only preselected
    await js(`document.querySelector('[data-hs="qhand"]').click();0`);
    assert.ok(await until(`!!document.getElementById('sessDlg')`), 'the dialog opens');
    const dlg = await js(`(()=>{const d=document.getElementById('sessDlg'),t=d.querySelector('#sdT').textContent,k=d.querySelector('#sdKind');const r=d.querySelector('.dlg').getBoundingClientRect();const top=document.elementFromPoint(r.left+r.width/2,r.top+10);return {t,kind:k&&k.value,sum:d.querySelector('#sdSum')&&d.querySelector('#sdSum').checked,onTop:d.contains(top),bottom:r.bottom,ih:innerHeight}})()`);
    assert.strictEqual(dlg.t, 'Continue in another agent app');
    assert.strictEqual(dlg.sum, true, 'with the reviewed summary');
    assert.strictEqual(dlg.kind, 'claude', 'the first alternative, only preselected');
    assert.ok(dlg.onTop, 'the dialog is above Settings');
    assert.ok(dlg.bottom <= dlg.ih, 'the dialog fits: ' + JSON.stringify(dlg));
    // FR-089: the line follows the choice; a late answer for an app no longer chosen is dropped; it says "You can still start"
    assert.ok(await until(`/not reported/.test((document.getElementById('sdQuota')||{}).textContent||'')`), 'the line for Claude Code: not reported');
    const px = await js(`parseFloat(getComputedStyle(document.getElementById('sdQuota')).fontSize)`);
    assert.ok(px >= 10.5, 'the line is at least 10.5px: ' + px);
    await js(`(()=>{window.__durbarSimQuotaGates={copilot:new Promise(r=>{window.__durbarSimQuotaLet=r})};const k=document.getElementById('sdKind');k.value='copilot';k.dispatchEvent(new Event('change'));k.value='codex';k.dispatchEvent(new Event('change'));})();0`);
    assert.ok(await until(`/5-hour window/.test((document.getElementById('sdQuota')||{}).textContent||'')`), 'the line for Codex');
    await js(`window.__durbarSimQuotaGates={};window.__durbarSimQuotaLet();0`); // Copilot's answer now comes after Codex's
    await settle();
    assert.ok(await js(`/5-hour window/.test(document.getElementById('sdQuota').textContent)`), 'the late Copilot answer is dropped');
    await js(`(()=>{const k=document.getElementById('sdKind');k.value='copilot';k.dispatchEvent(new Event('change'));})();0`);
    assert.ok(await until(`/Near a reported limit: Premium requests.*You can still start\\./.test((document.getElementById('sdQuota')||{}).textContent||'')`), 'near, as a note: still startable');
    assert.ok(!(await js(`document.getElementById('sdGo').disabled`)), 'Start stays available');
    await shot(`690-dialog-${size}.png`);
    await js(`document.getElementById('sdCancel').click();0`);
    const after = await js(`({n:window.__durbarSimUi.agents().length,st:window.__durbarSimUi.agents().map(a=>a.state).join()})`);
    assert.strictEqual(after.n, before.n, 'no session was started');

    // ---- stale: never current
    await load(w, h, 'copilot:stale');
    b = await blocks();
    assert.strictEqual(b.copilot.state, 'Last reading, not current');
    assert.match(b.copilot.text, /This reading is old/);
    assert.match(b.copilot.text, /Last good reading /);
    assert.ok(!/ Checked /.test(b.copilot.text), 'never "Checked" on an old reading');
    assert.match(b.copilot.text, /Used: 506 requests/);
    assert.strictEqual(await js(`document.querySelector('.hs-quota[data-quota="copilot"] [data-qstate]').classList.contains('hs-ok')`), false, 'not painted as good');
    await fit(size + ' stale');
    await shot(`690-stale-${size}.png`);

    // ---- a failed read keeps the figures, and says so; the IPC refused too
    await load(w, h, 'copilot:failagain', { simquotafloor: '0' });
    b = await blocks();
    assert.strictEqual(b.copilot.state, 'Current');
    await checkAgain();
    assert.ok(await until(`document.querySelector('.hs-quota[data-quota="copilot"] [data-qstate]').textContent==='Last reading, not current'`), 'not current after a failed read');
    b = await blocks();
    assert.match(b.copilot.text, /Used: 506 requests/, 'a failed read does not wipe the good figures');
    assert.match(b.copilot.text, /Could not read at .*: no answer within the time limit\./);
    await fit(size + ' failagain');
    await shot(`690-failagain-${size}.png`);
    await load(w, h, 'copilot:current');
    await js(`window.__durbarSimQuotaReject=true;0`);
    await js(`window.DurbarHarnesses.loadQuota('check');0`);
    assert.ok(await until(`document.querySelector('.hs-quota[data-quota="copilot"] [data-qstate]').textContent==='Last reading, not current'`), 'a refused call is not a success');
    b = await blocks();
    assert.match(b.copilot.text, /Used: 506 requests/);
    assert.match(b.copilot.text, /Could not read at /);
    await js(`window.__durbarSimQuotaReject=false;0`);

    // ---- a failed read with nothing earlier, and not reported: no figures, no zero
    await load(w, h, 'failed');
    b = await blocks();
    assert.strictEqual(b.copilot.state, 'Could not read');
    assert.strictEqual(b.copilot.rows, 0);
    assert.ok(!/\b0\b|Current/.test(b.copilot.text), 'no figures: ' + b.copilot.text);
    await fit(size + ' failed');
    await shot(`690-failed-${size}.png`);
    await load(w, h, 'notreported');
    b = await blocks();
    assert.deepStrictEqual([b.copilot.state, b.codex.state, b.claude.state], ['Not reported', 'Not reported', 'Not reported']);
    assert.match(b.codex.text, /API key/);
    assert.ok(!/\b0\b/.test(b.copilot.text + b.codex.text), 'never zero');
    await shot(`690-notreported-${size}.png`);

    // ---- hostile text stays text; hostile numbers go
    await load(w, h, 'hostile');
    const title = await js(`document.title`);
    const hostile = await js(`(()=>{const q=document.querySelector('.hs-quota[data-quota="copilot"]');return {imgs:q.querySelectorAll('img,script,b:not(.hs-q-title)').length,text:q.innerText,bidi:/[\\u202e\\u2066]/.test(q.innerText)}})()`);
    assert.strictEqual(hostile.imgs, 0, 'no element from the vendor text');
    assert.ok(hostile.text.includes('<img src=x'), 'shown as text');
    assert.ok(hostile.text.includes('<b>bold</b>'), 'shown as text');
    assert.ok(!hostile.bidi, 'no bidi control');
    assert.ok(!/Infinity|NaN|-5|e\+/.test(hostile.text), 'no absurd number: ' + hostile.text);
    assert.ok(!/gone/.test(hostile.text), 'an unknown unit is dropped');
    assert.strictEqual(await js(`document.title`), title, 'no script ran');
    await fit(size + ' hostile');
    await shot(`690-hostile-${size}.png`);
  }

  // ---- the other fixtures, one size
  const [w, h] = [1280, 800];
  for (const [mode, want, re] of [
    ['exhausted', 'Current', /At a reported limit/],
    ['ratelimited', 'Could not read', /fewer requests/],
    ['signedout', 'Could not read', /not signed in/],
    ['malformed', 'Could not read', /could not be understood/],
    ['resetpast', 'Last reading, not current', /passed at /],
    ['unlimited', 'Current', /Limit: Unlimited/],
  ]) {
    await load(w, h, mode);
    const b = await blocks();
    assert.strictEqual(b.copilot.state, want, mode);
    assert.match(b.copilot.text, re, mode);
    await fit(mode);
    if (mode === 'resetpast') assert.deepStrictEqual([b.copilot.near, b.copilot.used, b.copilot.sug], [0, 0, false], 'a passed reset is no warning');
  }

  // ---- FR-082: a window with unusable figures stays, reading "not reported"; FR-095: another account, and none to compare
  await load(w, h, 'partial');
  let more = await blocks();
  assert.strictEqual(more.copilot.rows, 2);
  assert.match(more.copilot.text, /Chat requests Used: not reported Limit: not reported Left: not reported Resets: not reported/);
  assert.match(more.codex.text, /Weekly window Used: not reported/);
  await load(w, h, 'copilot:switched', { simquotafloor: '0' });
  more = await blocks();
  assert.match(more.copilot.text, /Used: 506 requests/);
  assert.ok(!/sign-in change/.test(more.copilot.text), 'a known account is not labelled');
  await checkAgain();
  assert.ok(await until(`document.querySelector('.hs-quota[data-quota="copilot"] [data-qstate]').textContent==='Could not read'`), 'another account: the figures go');
  more = await blocks();
  assert.ok(!/506/.test(more.copilot.text), 'the earlier account\'s figures are gone');
  await load(w, h, 'copilot:nokey');
  more = await blocks();
  assert.strictEqual(more.copilot.state, 'Current');
  assert.match(more.copilot.text, /These figures may be from before a sign-in change\./);
  await fit('nokey');

  // ---- FR-088: eligibility: an app not known to be signed in, or near its own limit, is not suggested
  await load(w, h, 'copilot:near,codex:near', { simacct: 'unknown' });
  const none = await blocks();
  assert.match(none.copilot.text, /No other agent app is known to be ready and signed in/);
  assert.strictEqual(none.copilot.btn, 0);

  // a hostile session name in the button; a session gone at the repaint loses its button (no state outlives it)
  await load(w, h, 'copilot:near');
  const named = await js(`(()=>{const x=window.__durbarSimUi.agents().find(a=>a.live&&!a.parent&&(a.info&&a.info.adapterId||'copilot')==='copilot');x.name='<img src=x onerror=document.title=9>';return x.id})()`);
  await js(`window.DurbarHarnesses.loadQuota('cached');0`);
  assert.ok(await until(`[...document.querySelectorAll('[data-hs="qhand"]')].some(b=>b.dataset.agent===${jsLiteral(named)}&&b.textContent.includes('<img src=x'))`), 'the name is text');
  assert.strictEqual(await js(`document.querySelectorAll('.hs-quota img').length`), 0);
  await js(`window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(named)}).live=false;window.DurbarHarnesses.loadQuota('cached');0`);
  assert.ok(await until(`![...document.querySelectorAll('[data-hs="qhand"]')].some(b=>b.dataset.agent===${jsLiteral(named)})`), 'a session that ended is not offered');

  // ---- FR-085: with the window open and no action, Current turns; the timer stops when Settings closes
  await load(w, h, 'copilot:agingsoon');
  const first = await js(`document.querySelector('.hs-quota[data-quota="copilot"] [data-qstate]').textContent`);
  assert.strictEqual(first, 'Current');
  assert.strictEqual(await js(`window.DurbarHarnesses.quotaTimerArmed()`), true);
  assert.ok(await until(`document.querySelector('.hs-quota[data-quota="copilot"] [data-qstate]').textContent==='Last reading, not current'`, 6000), 'it goes stale by itself');
  const readsAged = (await reads()).length;
  await load(w, h, 'copilot:resetsoon,codex:noread');
  let aged = await blocks();
  assert.strictEqual(aged.copilot.near, 1);
  assert.ok(await until(`document.querySelector('.hs-quota[data-quota="copilot"] .hs-q-row').dataset.level===''`, 6000), 'near ends at the reset');
  aged = await blocks();
  assert.strictEqual(aged.copilot.state, 'Last reading, not current');
  assert.match(aged.copilot.text, /passed at /);
  assert.ok(!aged.copilot.sug, 'no suggestion after the reset');
  // close Settings: no timer stays
  await load(w, h, 'copilot:current');
  assert.strictEqual(await js(`window.DurbarHarnesses.quotaTimerArmed()`), true);
  await js(`document.getElementById('scrClose').click();0`);
  assert.ok(await until(`!document.querySelector('.hs-quota')`), 'Settings closed');
  assert.strictEqual(await js(`window.DurbarHarnesses.quotaTimerArmed()`), false, 'the timer stops with Settings');
  assert.ok(readsAged >= 1);
  // nothing else is polling: reads do not grow while the clock runs
  const n0 = (await reads()).length;
  await new Promise((r) => setTimeout(r, 2500));
  assert.strictEqual((await reads()).length, n0, 'no polling');
  await js(`0`);
  await settle();
  console.log('[011-quota] PASS');
};
