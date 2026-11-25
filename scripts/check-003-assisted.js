/*
 * Spec 003 T054 (FR-120, FR-122, FR-126, FR-127, FR-130, FR-131, FR-133): Copilot's reviewer (assisted approvals) in the window, on the
 * simulator (0 credits, 15 agents), at 1440x900 and 1280x800. Exits non-zero on a miss:
 *   FR-120  the switch is in the mode menu of a Copilot session in Ask first only (not Read-only, Allow all, Claude Code, Codex); its words,
 *           its cost sentence (FR-131) and text of 10.5px or more, inside the window; on: the chip reads "Ask first + review"
 *   FR-133  the simulator's fixed verdicts: approve runs with no card (and the app tag), the others give a card with the fixed line (FR-130)
 *   FR-126  a switch to Read-only turns it off and it is not back in Ask first
 *   FR-127  `simassisted=policy`: the fallback's one fixed note and plain Ask first; `simassisted=blocked`: the switch disabled with the reason
 * Run alone:
 *   npm run build; OUT=<dir> DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_DRIVER=$PWD/scripts/check-003-assisted.js npx electron . --no-sandbox
 * Screenshots (OUT): 003-assisted-menu-<w>x<h>.png, 003-assisted-chip-<w>x<h>.png
 */
const assert = require('assert');
const os = require('os');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || os.tmpdir();
const SIZES = [[1440, 900], [1280, 800]];
const LABEL = "Let Copilot's reviewer approve safe requests";
const POLICY = "Your organization turned off Copilot's assisted approvals. This session stays in Ask first.";

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const must = async (expr, msg, ms = 8000) => assert.ok(await until(expr, ms), msg + ' (' + expr.slice(0, 140) + ')');
  const pick = (kind, mode) => `(a=>a.live&&!a.parent&&a.info&&(a.info.adapterId||'copilot')===${jsLiteral(kind)}${mode ? `&&a.info.permMode===${jsLiteral(mode)}` : ''}&&(a.state==='idle'||a.state==='done')&&!(a.grants||[]).length)`;
  /* an idle Copilot session, switched to Ask first through the menu when it is not */
  const openAskCopilot = async (tag) => {
    const o = await H.openSimAgent(pick('copilot', 'read-only'), '#modeChip');
    assert.ok(o.ok, `${tag}: open an idle Copilot agent ${jsLiteral(o.seen)}`);
    await H.click('#modeChip');
    await must(`!!document.querySelector('#modeMenu [data-mode="ask"]')`, 'the mode menu opened');
    await H.click('#modeMenu [data-mode="ask"]');
    await must(`/^Ask first/.test(((document.getElementById('modeChip')||{}).innerText||'').trim())`, `${tag}: in Ask first`);
    await H.clearToasts();
    return o;
  };
  const small = (sel) => js(`(()=>{const o=[];for(const r of document.querySelectorAll(${jsLiteral(sel)}))for(const n of [r,...r.querySelectorAll('*')]){if(!n.getClientRects().length)continue;const own=[...n.childNodes].some(c=>c.nodeType===3&&c.textContent.trim());if(own&&parseFloat(getComputedStyle(n).fontSize)<10.5)o.push(n.tagName+':'+n.textContent.trim().slice(0,30));}return o;})()`);
  const inView = (sel) => js(`(()=>{const e=document.querySelector(${jsLiteral(sel)});if(!e)return false;const r=e.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&r.width>0;})()`);
  const openMenu = async () => { await H.click('#modeChip'); await must(`!!document.querySelector('#modeMenu [data-mode]')`, 'the mode menu opened'); };
  const closeMenu = async () => { await H.key('Escape'); await must(`!document.getElementById('modeMenu')`, 'the menu closed', 3000); };
  const item = () => js(`(()=>{const b=document.querySelector('#modeMenu [data-act="assisted"]');return b?{text:b.innerText.replace(/\\s+/g,' ').trim(),title:b.title,checked:b.getAttribute('aria-checked'),disabled:b.getAttribute('aria-disabled')==='true',role:b.getAttribute('role')}:null;})()`);
  const chip = () => js(`((document.getElementById('modeChip')||{}).innerText||'').replace(/\\s+/g,' ').trim()`);
  const send = (id, text) => js(`window.__durbarSimUi.bridge().send(${jsLiteral(id)},${jsLiteral(text)})`);

  for (const [w, h] of SIZES) {
    await H.load({ w, h, query: { simkinds: 'mixed' }, focus: true });
    await H.calm();
    // ---- FR-120: not for Claude Code or Codex, not in Read-only or Allow all ----
    for (const [kind, mode] of [['claude', 'ask'], ['codex', 'ask'], ['copilot', 'read-only'], ['copilot', 'allow']]) {
      const any = await js('!!window.__durbarSimUi.agents().find(' + pick(kind, mode) + ')'); // page code built here, not data
      if (!any) continue;
      const o = await H.openSimAgent(pick(kind, mode), '#modeChip');
      assert.ok(o.ok, `${w}: open a ${kind} agent in ${mode} ${jsLiteral(o.seen)}`);
      await openMenu();
      assert.strictEqual(await item(), null, `${w}: FR-120: no switch for ${kind} in ${mode}`);
      await closeMenu();
    }
    // ---- a Copilot session in Ask first: the switch, its words, its cost sentence ----
    const o = await openAskCopilot(String(w));
    const id = o.id;
    await openMenu();
    const it = await item();
    assert.ok(it, `${w}: FR-120: the switch is in the menu`);
    assert.strictEqual(it.role, 'menuitemcheckbox');
    assert.strictEqual(it.checked, 'false', 'off by default');
    assert.ok(it.text.startsWith(LABEL), `${w}: C4: its words: ${it.text}`);
    assert.match(it.title, /model call on your Copilot account \(gpt-5\.5 by default\) and may use AI credits/, `${w}: FR-131: the cost sentence`);
    assert.match(it.text, /may use AI credits/, `${w}: FR-131: the cost in its visible line`);
    assert.ok(it.title.includes("Copilot's reviewer is a model, not a security boundary: text the agent has read can mislead it, so turn it on only in folders and with content you trust."), `${w}: FR-131 (2026-11-25): the honest line in its help`);
    assert.deepStrictEqual(await small('#modeMenu'), [], `${w}: no text under 10.5px in the menu`);
    assert.ok(await inView('#modeMenu [data-act="assisted"]'), `${w}: the switch is inside the window`);
    const order = await js(`[...document.querySelectorAll('#modeMenu [data-mode],#modeMenu [data-act]')].map(b=>b.dataset.mode||b.dataset.act).join(',')`);
    assert.ok(/^read-only,ask,allow,assisted/.test(order), `${w}: under the modes: ${order}`);
    await H.shot(path.join(OUT, `003-assisted-menu-${w}x${h}.png`), { prep: 'calm', keepHover: true, tag: '003', what: `menu ${w}x${h}` });
    await H.click('#modeMenu [data-act="assisted"]');
    await must(`((document.getElementById('modeChip')||{}).innerText||'').includes('Ask first + review')`, `${w}: C4: the chip reads Ask first + review`);
    assert.match(await H.text('#panel .hint'), / · Ask first \+ review$/, `${w}: FR-120 (2026-11-25): the composer hint says the chip's word`);
    assert.strictEqual(await js(`window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(id)}).info.assisted.on`), true, 'main\'s answer is on');
    await H.clearToasts();
    // FR-133: verdict 1 approve: the edit runs, no card; the next one (requireApproval) is a card with its fixed line (FR-130)
    const cards0 = await js(`document.querySelectorAll('#chat .note.perm').length`);
    await send(id, 'fix the file');
    await must(`window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(id)}).state!=='working'`, `${w}: the first turn ends`, 15000);
    assert.strictEqual(await js(`document.querySelectorAll('#chat .note.perm.pending').length`), 0, `${w}: FR-133: the judge's approve gives no card`);
    assert.strictEqual(await js(`document.querySelectorAll('#chat .note.perm').length`), cards0, `${w}: FR-124: no card at all for it, not even a settled one`);
    await must(`[...document.querySelectorAll('#chat .wtag,#chat [class*="why"]')].some(t=>/agent app/.test(t.textContent))||/Allowed: agent app/.test(document.getElementById('chat').innerText)`, `${w}: FR-124: the tool card carries the app tag`);
    await send(id, 'fix the file again');
    await must(`!!document.querySelector('#chat .note.perm.pending .pjudge')`, `${w}: FR-130: a requireApproval card says why`, 15000);
    assert.strictEqual(await H.text('#chat .note.perm.pending .pjudge'), "Copilot's reviewer did not approve this.", `${w}: FR-130: the fixed line`);
    assert.ok((await js(`document.querySelectorAll('#chat .note.perm').length`)) > cards0);
    assert.deepStrictEqual(await small('#chat .note.perm.pending'), [], `${w}: the card's text is 10.5px or more`);
    await H.shot(path.join(OUT, `003-assisted-chip-${w}x${h}.png`), { prep: 'calm', tag: '003', what: `chip ${w}x${h}` });
    await js(`[...document.querySelectorAll('#chat .note.perm.pending .note-actions button')].find(b=>b.textContent==='Deny').click()`);
    // ---- FR-126: Read-only turns it off; back in Ask first it stays off ----
    await openMenu();
    await H.click('#modeMenu [data-mode="read-only"]');
    await must(`((document.getElementById('modeChip')||{}).innerText||'').includes('Read-only')`, `${w}: switched to Read-only`);
    await openMenu();
    assert.strictEqual(await item(), null, `${w}: FR-120: no switch in Read-only`);
    await H.click('#modeMenu [data-mode="ask"]');
    await must(`/Ask first/.test((document.getElementById('modeChip')||{}).innerText||'')`, `${w}: back in Ask first`);
    assert.ok(/^Ask first/.test(await chip()) && !/review/.test(await chip()), `${w}: FR-126: not restored: ${await chip()}`);
    assert.match(await H.text('#panel .hint'), / · Ask first$/, `${w}: FR-120: and the hint says plain Ask first`);
    assert.strictEqual(await js(`!!window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(id)}).info.assisted`), false);
  }

  // ---- FR-127: a live fallback (simassisted=policy): one fixed note, plain Ask first after ----
  {
    await H.load({ w: 1440, h: 900, query: { simkinds: 'mixed', simassisted: 'policy' }, focus: true });
    await H.calm();
    const o = await openAskCopilot('policy');
    await openMenu();
    await H.click('#modeMenu [data-act="assisted"]');
    await must(`((document.getElementById('modeChip')||{}).innerText||'').includes('Ask first + review')`, 'policy: on first');
    await send(o.id, 'fix the file');
    await must(`[...document.querySelectorAll('#chat .note')].some(n=>n.textContent===${jsLiteral(POLICY)})`, 'FR-127: the fixed note', 15000);
    await must(`!!document.querySelector('#chat .note.perm.pending')`, 'FR-127: the request is a plain card', 15000);
    assert.strictEqual(await js(`[...document.querySelectorAll('#chat .note')].filter(n=>n.textContent===${jsLiteral(POLICY)}).length`), 1, 'one note');
    assert.ok(/^Ask first/.test(await chip()) && !/review/.test(await chip()), `FR-127: the chip is plain Ask first: ${await chip()}`);
    assert.strictEqual(await js(`!!document.querySelector('#chat .note.perm.pending .pjudge')`), false, 'no reviewer line after the fallback');
  }
  // ---- FR-127: the policy blocks the switch (simassisted=blocked): shown disabled with the reason ----
  {
    await H.load({ w: 1280, h: 800, query: { simkinds: 'mixed', simassisted: 'blocked' }, focus: true });
    await H.calm();
    await openAskCopilot('blocked');
    await openMenu();
    const it = await item();
    assert.ok(it && it.disabled, `blocked: the switch is disabled ${jsLiteral(it)}`);
    assert.match(it.text, /Your organization turned off Copilot's assisted approvals/, 'blocked: the reason is its text');
    await H.click('#modeMenu [data-act="assisted"]');
    assert.ok(await js(`!!document.getElementById('modeMenu')`), 'a disabled switch does nothing');
    await closeMenu();
    assert.ok(/^Ask first/.test(await chip()) && !/review/.test(await chip()), 'blocked: plain Ask first');
  }
  console.log('check-003-assisted: OK');
};
