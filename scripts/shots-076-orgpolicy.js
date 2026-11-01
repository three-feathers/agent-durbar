/*
 * Spec 076 section O (FR-202, FR-203, FR-205; issue #602, T196): what the agent app's own organization policy blocks is greyed out
 * before a start, with the reason. Simulator only (no AI credits, no agent app, no policy file): `?simorgpolicy=1` gives the simulator
 * its canned policy (Claude Code and Copilot block Allow all; Claude Code blocks the `haiku` model and the `create_issue` tool of
 * `github`; Copilot blocks the `my-notes` MCP server).
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-076-orgpolicy.js xvfb-run -a npx electron . --no-sandbox
 *
 * Checks, at 1440x900 and 1280x800 (simkinds=mixed):
 * - the defaults' Permissions select lists Allow all disabled with the reason as its tooltip and "(blocked by your organization)" in its
 *   label, and never holds it; with the Claude Code kind the `haiku` model is disabled the same way;
 * - a Claude Code chat's mode menu shows Allow all aria-disabled with the reason as its visible text; choosing it changes nothing;
 * - its model menu shows `haiku` aria-disabled with the reason;
 * - a Copilot chat's MCP dialog shows `my-notes` with the "Blocked by your organization" tag, the reason line, and a disabled switch
 *   described by that line; the other rows have none;
 * - a Claude Code chat's `github` tools list shows `create_issue` unticked, aria-disabled, with the reason next to it;
 * - text >= 10.5px in the menus and the dialog;
 * - without `simorgpolicy` nothing is greyed (the same selects and rows are enabled).
 * Shots: 076-orgpolicy-mode-<w>x<h>.png (the mode menu), 076-orgpolicy-server-<w>x<h>.png (a Copilot chat's MCP dialog),
 * 076-orgpolicy-mcp-<w>x<h>.png (a Claude Code chat's MCP dialog with the github tools open).
 * Prints "[076] orgpolicy PASS".
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-076-'));
const SIZES = [[1440, 900], [1280, 800]];
const CLAUDE_TEXT = "Blocked by your organization's Claude Code policy";
const COPILOT_TEXT = "Blocked by your organization's Copilot policy";
const CODEX_MAYBE = "Your organization's Codex policy may block this (Agent Durbar could not read all of it)";
/* simkinds=mixed: the first running main agent of each kind (sim.ts SIM_KIND_BY_AGENT) */
const pickKind = (k) => `a=>!a.parent&&a.live&&a.info&&a.info.adapterId===${jsLiteral(k)}`;

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const shot = (name, w, h) => H.shot(path.join(OUT, `${name}-${w}x${h}.png`), { prep: 'calm', tag: '076', what: `${name} ${w} ${h}` });
  const option = (sel, v) => js(`(()=>{const o=[...document.getElementById(${jsLiteral(sel)}).options].find(x=>x.value===${jsLiteral(v)});return o?{dis:o.disabled,title:o.title,text:o.textContent}:null})()`);
  const setSel = (id, v) => js(`(()=>{const s=document.getElementById(${jsLiteral(id)});if(!s)return false;s.value=${jsLiteral(v)};s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  const minFont = (root) => js(`(()=>{let min=99,who='';document.querySelectorAll(${jsLiteral(`${root}, ${root} *`)}).forEach(e=>{if(!e.getClientRects().length)return;const own=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());if(!own)return;const f=parseFloat(getComputedStyle(e).fontSize);if(f<min){min=f;who=e.tagName+'.'+e.className;}});return {min,who}})()`);
  const closeAll = async () => {
    await js(`(()=>{for(const id of ['modeMenu','modelMenu']){const m=document.getElementById(id);if(m)m.remove();}const d=document.querySelector('.dlg-ov');if(d){const b=[...d.querySelectorAll('button')].find(x=>/^(Done|Cancel|Close)$/.test(x.textContent.trim()));if(b)b.click();}})()`);
    await until(`!document.querySelector('.dlg-ov')&&!document.getElementById('modeMenu')&&!document.getElementById('modelMenu')`);
  };
  const openChat = async (kind) => {
    await closeAll();
    const r = await H.openSimAgent(pickKind(kind), '#modeChip');
    assert.ok(r.ok, `${kind}: a chat opened with a mode chip: ${JSON.stringify(r.seen)}`);
    await settle();
    return r.id;
  };
  const permOf = (id) => js(`((window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(id)})||{}).info||{}).permMode`);

  for (const [w, h] of SIZES) {
    await H.load({ w, h, ready: 'fit', focus: true, query: { simkinds: 'mixed', simorgpolicy: '1' } });

    // ---- the defaults for new sessions: Allow all disabled with the reason; the select never holds it ----
    assert.ok(await until(`(()=>{const o=[...document.getElementById('permMode').options].find(x=>x.value==='allow');return !!o&&o.disabled})()`), 'defaults: Allow all is disabled');
    const allow = await option('permMode', 'allow');
    assert.strictEqual(allow.title, COPILOT_TEXT, 'defaults: the reason (Copilot, the default kind) is the tooltip');
    assert.ok(allow.text.endsWith('(blocked by your organization)'), `defaults: the label says so: ${allow.text}`);
    assert.notStrictEqual(await js(`document.getElementById('permMode').value`), 'allow', 'defaults: the select does not hold Allow all');
    assert.ok(!(await option('permMode', 'ask')).dis, 'defaults: Ask first stays enabled');
    await js(`document.getElementById('permMode').value='allow'`); // as if it held Allow all before the policy came
    assert.ok(await setSel('kindSel', 'claude'), 'defaults: the kind select exists (simkinds=mixed)');
    assert.strictEqual(await js(`document.getElementById('permMode').value`), 'read-only', 'defaults: a select holding a blocked mode falls back to the most restrictive one');
    {
      assert.ok(await until(`(()=>{const o=[...document.getElementById('modelSel').options].find(x=>x.value==='haiku');return !!o&&o.disabled})()`), 'defaults: Claude Code kind: haiku is disabled');
      const hk = await option('modelSel', 'haiku');
      assert.strictEqual(hk.title, CLAUDE_TEXT, 'defaults: the model reason');
      assert.notStrictEqual(await js(`document.getElementById('modelSel').value`), 'haiku', 'defaults: the select does not hold haiku');
      assert.strictEqual((await option('permMode', 'allow')).title, CLAUDE_TEXT, 'defaults: the mode reason follows the kind');
      await setSel('kindSel', 'copilot');
    }

    // ---- a Claude Code chat: the mode menu and the model menu ----
    const CLAUDE_ID = await openChat('claude');
    const before = await permOf(CLAUDE_ID);
    await js(`document.getElementById('modeChip').click()`);
    assert.ok(await until(`!!document.querySelector('#modeMenu [data-mode="allow"]')`), 'mode menu: open');
    const item = await js(`(()=>{const b=document.querySelector('#modeMenu [data-mode="allow"]');return {dis:b.getAttribute('aria-disabled'),small:b.querySelector('small').textContent,title:b.title}})()`);
    assert.deepStrictEqual(item, { dis: 'true', small: CLAUDE_TEXT, title: CLAUDE_TEXT }, 'mode menu: Allow all is aria-disabled with the reason as its text');
    assert.strictEqual(await js(`document.querySelector('#modeMenu [data-mode="ask"]').getAttribute('aria-disabled')`), null, 'mode menu: Ask first is not');
    const mf = await minFont('#modeMenu');
    assert.ok(mf.min >= 10.5, `mode menu: text >= 10.5px (${mf.min} ${mf.who})`);
    await shot('076-orgpolicy-mode', w, h);
    // review on PR 644 (item 6): the menu itself must not send the request (the simulator's setPermMode refuses too, so the mode alone proves nothing)
    await js(`(()=>{const b=window.__durbarSimUi.bridge();window.__orgModeCalls=[];if(!b.__orgWrapped){const f=b.setPermMode;b.setPermMode=function(...a){window.__orgModeCalls.push(a[1]);return f.apply(this,a);};b.__orgWrapped=true;}document.querySelectorAll('#toasts .toast').forEach(t=>t.remove());})()`);
    await js(`document.querySelector('#modeMenu [data-mode="allow"]').click()`);
    await settle();
    assert.strictEqual(await permOf(CLAUDE_ID), before, 'mode menu: choosing Allow all changes nothing');
    assert.deepStrictEqual(await js(`window.__orgModeCalls`), [], 'mode menu: choosing Allow all sends no setPermMode request at all');
    assert.strictEqual(await js(`[...document.querySelectorAll('#toasts .toast')].some(t=>t.textContent.includes(${jsLiteral(CLAUDE_TEXT)}))`), false, 'mode menu: and shows no refusal toast');
    assert.ok(await js(`!!document.getElementById('modeMenu')`), 'mode menu: and stays open (nothing was chosen)');
    await closeAll();
    assert.ok(await js(`!!document.getElementById('modelChip')`), 'the Claude Code chat has a model chip');
    {
      await js(`document.getElementById('modelChip').click()`);
      assert.ok(await until(`!!document.querySelector('#modelMenu [data-pick="haiku"]')`), 'model menu: open with haiku');
      const hk = await js(`(()=>{const b=document.querySelector('#modelMenu [data-pick="haiku"]');return {dis:b.getAttribute('aria-disabled'),small:b.querySelector('small').textContent}})()`);
      assert.deepStrictEqual(hk, { dis: 'true', small: CLAUDE_TEXT }, 'model menu: haiku is aria-disabled with the reason');
      await closeAll();
      // review on PR 644 (item 4): the current model, when blocked, still shows the reason
      const was = await js(`window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(CLAUDE_ID)}).info.model`);
      await js(`window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(CLAUDE_ID)}).info.model='haiku'`);
      await js(`document.getElementById('modelChip').click()`);
      assert.ok(await until(`!!document.querySelector('#modelMenu [data-pick="haiku"][aria-checked="true"]')`), 'model menu: haiku is the current model');
      assert.strictEqual(await js(`document.querySelector('#modelMenu [data-pick="haiku"] small').textContent`), CLAUDE_TEXT, 'model menu: the blocked current model shows the reason');
      await closeAll();
      await js(`window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(CLAUDE_ID)}).info.model=${jsLiteral(was)}`);
    }
    // review on PR 644 (item 6): the new-session dialog's Permissions select
    await js(`(document.getElementById('newSessHdrBtn')||document.getElementById('newSessBtn')).click()`);
    assert.ok(await until(`!!document.getElementById('sdPerm')&&[...document.getElementById('sdPerm').options].some(o=>o.value==='allow'&&o.disabled)`), 'new session: Allow all is disabled in #sdPerm');
    const sd = await option('sdPerm', 'allow');
    assert.strictEqual(sd.title, CLAUDE_TEXT, 'new session: the reason is the tooltip');
    assert.notStrictEqual(await js(`document.getElementById('sdPerm').value`), 'allow', 'new session: the select does not hold Allow all');
    await js(`document.getElementById('sdCancel').click()`);
    await until(`!document.getElementById('sessDlg')`);

    // ---- a Codex chat: Durbar could not read all of its policy: advice, still selectable (FR-201) ----
    await openChat('codex');
    await js(`document.getElementById('modeChip').click()`);
    assert.ok(await until(`!!document.querySelector('#modeMenu [data-mode="allow"]')`), 'codex mode menu: open');
    const cx = await js(`(()=>{const b=document.querySelector('#modeMenu [data-mode="allow"]');return {dis:b.getAttribute('aria-disabled'),small:b.querySelector('small').textContent,doubt:b.classList.contains('mm-orgdoubt')}})()`);
    assert.deepStrictEqual(cx, { dis: null, small: CODEX_MAYBE, doubt: true }, 'codex mode menu: Allow all shows the advice and stays selectable');
    await closeAll();
    // FR-203 (re-check on PR 644): a session started under advice shows the advice once (the start guard's note, a toast)
    await js(`(document.getElementById('newSessHdrBtn')||document.getElementById('newSessBtn')).click()`);
    assert.ok(await until(`!!document.getElementById('sdPerm')&&[...document.getElementById('sdPerm').options].some(o=>o.value==='allow'&&!o.disabled)`), 'codex new session: Allow all is selectable (advice)');
    assert.strictEqual((await option('sdPerm', 'allow')).title, CODEX_MAYBE, 'codex new session: the advice is the tooltip');
    await js(`(()=>{const s=document.getElementById('sdPerm');s.value='allow';s.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('sdGo').click()})()`);
    assert.ok(await until(`[...document.querySelectorAll('.dlg-ov')].some(d=>/^Allow all for/.test(d.textContent.trim()))`), 'codex new session: Allow all asks to confirm');
    await js(`(()=>{const d=[...document.querySelectorAll('.dlg-ov')].find(x=>/^Allow all for/.test(x.textContent.trim()));const b=d&&d.querySelector('button.primary');if(b)b.click()})()`);
    const okToast = await until(`[...document.querySelectorAll('#toasts .toast')].some(t=>t.textContent.includes(${jsLiteral(CODEX_MAYBE)}))`);
    if (!okToast) console.log('[076 debug]', JSON.stringify(await js(`({toasts:[...document.querySelectorAll('#toasts .toast')].map(t=>t.textContent),dlg:[...document.querySelectorAll('.dlg-ov')].map(d=>d.textContent.slice(0,200)),last:(()=>{const a=window.__durbarSimUi.agents();const x=a[a.length-1];return x&&x.info?{id:x.id,k:x.info.adapterId,m:x.info.permMode}:null})()})`)));
    assert.ok(okToast, 'codex new session: the advice is shown as a toast once the session starts');
    await closeAll();

    // ---- a Copilot chat's MCP dialog: my-notes greyed with the reason; the switch cannot be turned on ----
    await openChat('copilot');
    await js(`document.getElementById('mcpBtn').click()`);
    assert.ok(await until(`!!document.querySelector('#agMcp li.srv[data-n="my-notes"]')`), 'MCP: the dialog lists my-notes');
    const row = await js(`(()=>{const li=document.querySelector('#agMcp li.srv[data-n="my-notes"]');const sw=li.querySelector('button.swt');const hint=li.querySelector('.srv-org');
      return {tag:(li.querySelector('.org-tag')||{}).textContent||'',hint:hint?hint.textContent:'',swDis:!!sw&&sw.disabled&&sw.getAttribute('aria-checked')==='false',desc:sw&&hint?sw.getAttribute('aria-describedby')===hint.id:false}})()`);
    assert.deepStrictEqual(row, { tag: 'Blocked by your organization', hint: COPILOT_TEXT + '.', swDis: true, desc: true }, 'MCP: tag, reason, switch off and disabled and described by the reason');
    assert.strictEqual(await js(`document.querySelectorAll('#agMcp .org-tag').length`), 1, 'MCP: only that row is tagged');
    await shot('076-orgpolicy-server', w, h);
    const df = await minFont('#agMcp');
    assert.ok(df.min >= 10.5, `MCP: text >= 10.5px (${df.min} ${df.who})`);
    // review on PR 644 (item 6): Settings' live MCP list shows the reason in that chat's row
    await js(`[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(b=>b.textContent==='Settings').click()`);
    assert.ok(await until(`!!document.querySelector('#liveList button[data-lv="my-notes"]')`), 'Settings: the live list has my-notes');
    await js(`document.querySelector('#liveList button[data-lv="my-notes"]').click()`);
    assert.ok(await until(`[...document.querySelectorAll('#liveList li.lv-chat .srv-org')].some(x=>x.textContent===${jsLiteral(COPILOT_TEXT + '.')})`), 'Settings: the live list shows the reason in the Copilot chat');
    await js(`document.getElementById('scrClose').click()`);
    await until(`!document.getElementById('liveList')`);
    await closeAll();

    // ---- a Claude Code chat's tools list: create_issue unticked, aria-disabled, the reason next to it ----
    await openChat('claude');
    await js(`document.getElementById('mcpBtn').click()`);
    assert.ok(await until(`!!document.querySelector('#agMcp button[data-tools="github"]')`), 'tools: github can be expanded');
    await js(`document.querySelector('#agMcp button[data-tools="github"]').click()`);
    const toolsOk = await until(`!!document.querySelector('#agMcp input[data-tool="create_issue"]')||/Start the session/.test((document.getElementById('mt-github')||{}).textContent||'')`);
    assert.ok(toolsOk, 'tools: the list or its not-running line shows');
    const box = await js(`(()=>{const i=document.querySelector('#agMcp input[data-tool="create_issue"]');if(!i)return null;const n=document.getElementById(i.getAttribute('aria-describedby'));return {checked:i.checked,dis:i.getAttribute('aria-disabled'),note:n?n.textContent:''}})()`);
    if (box) {
      assert.deepStrictEqual(box, { checked: false, dis: 'true', note: CLAUDE_TEXT }, 'tools: create_issue is unticked, aria-disabled, with the reason');
      await js(`document.querySelector('#agMcp input[data-tool="create_issue"]').click()`);
      assert.strictEqual(await js(`document.querySelector('#agMcp input[data-tool="create_issue"]').checked`), false, 'tools: a click does not tick it');
      assert.strictEqual(await js(`document.querySelector('#agMcp input[data-tool="search_issues"]').getAttribute('aria-disabled')`), null, 'tools: the other tools are not disabled');
      // review on PR 644 (item 5): the blocked tool is left out of the count and the tri-state
      const head = await js(`(()=>{const b=document.querySelector('#agMcp button[data-tall="github"]');return {checked:b.getAttribute('aria-checked'),text:b.textContent}})()`);
      assert.ok(head.checked === 'true' && !/\boff\b/.test(head.text), `tools: the header is all on, no "off" count for the blocked tool: ${JSON.stringify(head)}`);
      await js(`document.querySelector('#agMcp button[data-tall="github"]').click()`);
      assert.ok(await until(`document.querySelector('#agMcp button[data-tall="github"]').getAttribute('aria-checked')==='false'`), 'tools: "all off" can be reached with a blocked tool in the list');
      await js(`document.querySelector('#agMcp button[data-tall="github"]').click()`);
      assert.ok(await until(`document.querySelector('#agMcp button[data-tall="github"]').getAttribute('aria-checked')==='true'`), 'tools: and back on');
    } else assert.fail('tools: the Claude Code session is not running, so the tools list was not checked');
    await shot('076-orgpolicy-mcp', w, h);
    await closeAll();

    // ---- FR-208: Settings > Organization lists each app; a partly read policy is "unknown", never "no policy" ----
    await js(`document.getElementById('settingsBtn').click()`);
    assert.ok(await until(`document.querySelectorAll('#orgSet li.orgrow').length===3`), 'Organization: three apps listed');
    const orgRows = await js(`[...document.querySelectorAll('#orgSet li.orgrow')].map(l=>({id:l.dataset.org,state:l.dataset.state,text:l.textContent}))`);
    const byId = Object.fromEntries(orgRows.map((r) => [r.id, r]));
    assert.strictEqual(byId.claude.state, 'applies');
    assert.ok(byId.claude.text.includes('Allow all: ' + CLAUDE_TEXT), 'Organization: Claude Code row has the reason');
    assert.strictEqual(byId.codex.state, 'unknown', 'Organization: Codex (partly read) is unknown');
    assert.ok(/so what it blocks is unknown/.test(byId.codex.text) && !/No policy file found/.test(byId.codex.text), 'Organization: Codex is not "no policy"');
    await js(`document.getElementById('orgH').scrollIntoView({block:'start'})`);
    await settle();
    const of = await minFont('#orgSec');
    assert.ok(of.min >= 10.5, `Organization: text >= 10.5px (${of.min} ${of.who})`);
    await shot('076-orgpolicy-organization', w, h);
    await js(`document.getElementById('scrClose').click()`);
    await until(`!document.getElementById('orgSec')`);
  }

  // ---- without the canned policy nothing is greyed ----
  await H.load({ w: 1440, h: 900, ready: 'fit', focus: true, query: { simkinds: 'mixed' } });
  assert.ok(await until(`!!document.getElementById('permMode')&&[...document.getElementById('permMode').options].some(x=>x.value==='allow')`), 'no policy: the select lists Allow all');
  assert.strictEqual((await option('permMode', 'allow')).dis, false, 'no policy: Allow all is enabled');
  await openChat('copilot');
  await js(`document.getElementById('mcpBtn').click()`);
  assert.ok(await until(`!!document.querySelector('#agMcp li.srv[data-n="my-notes"]')`), 'no policy: the dialog lists my-notes');
  assert.strictEqual(await js(`document.querySelectorAll('#agMcp .org-tag,#agMcp .srv-org').length`), 0, 'no policy: no row is greyed');
  await closeAll();

  // no canned policy: the view is empty, so the section is not shown
  await js(`document.getElementById('settingsBtn').click()`);
  assert.ok(await until(`!!document.getElementById('scrClose')&&!document.getElementById('orgSec')`), 'no policy: no Organization section');
  await js(`document.getElementById('scrClose').click()`);

  /* sweep: a slow reply of an earlier paint does not overwrite the section of a later one */
  await H.load({ w: 1440, h: 900, ready: 'fit', focus: true, query: { simkinds: 'mixed', simorgpolicy: '1' } });
  await js(`(()=>{const b=window.__durbarSimUi.bridge(),f=b.orgPolicyView;let n=0;window.__orgLate=null;b.orgPolicyView=function(...a){n++;if(n===1)return new Promise((_ok,no)=>{window.__orgLate=()=>no(new Error('late'));});return f.apply(this,a);};})();0`);
  await js(`document.getElementById('settingsBtn').click()`);
  assert.ok(await until(`!!window.__orgLate&&!!document.getElementById('orgSet')`), 'the first read is held');
  await js(`document.getElementById('scrClose').click()`);
  await js(`document.getElementById('settingsBtn').click()`);
  assert.ok(await until(`document.querySelectorAll('#orgSet li.orgrow').length===3`), 'the later read fills the section');
  await js(`window.__orgLate();new Promise(r=>setTimeout(r,200))`); // a bound on a negative
  assert.strictEqual(await js(`document.querySelectorAll('#orgSet li.orgrow').length`), 3, 'the earlier reply, a failure, does not overwrite it');
  assert.strictEqual(await js(`!!document.querySelector('#orgSet p.scr-note.warn')`), false, 'no failure line from the earlier read');
  await js(`document.getElementById('scrClose').click()`);

  console.log('[076] orgpolicy PASS');
};
