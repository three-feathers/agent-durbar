/*
 * Spec 100 T017, T024: what MCP tool definitions take in a session's window. Simulator only (fixture figures, no agent app call, no AI credits).
 *
 *   npm run build
 *   OUT=/tmp DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-100-mcp-context.js xvfb-run -a npx electron . --no-sandbox
 *
 * Checks, at 1440x900 and 1280x800:
 * - the owner's case (Copilot, 200k window, 31 %): chip, name and tooltip, one strong line with the three heaviest servers, the dialog's
 *   rows and footnote, the token summary bar; nothing changes until the person presses a switch (FR-010, FR-011, FR-013, FR-021..FR-023, SC-001);
 * - Copilot "not reported": no figure, no estimate, no line (FR-001, FR-044);
 * - 10/20/35 %, 1M window, window unknown, failed server, deferred tools, a Codex estimate, a Claude Code report (T024);
 * - dismiss per session: back only when it rises from warn to strong (FR-022);
 * - the compaction hint: only after more than 3 in 30 minutes, once, on the folded line (FR-030);
 * - Settings: the levels, their validation, Off, the last figures (FR-012, FR-020);
 * - text >= 10.5px; the chip, dialog and line fit; no page overflow (FR-045).
 * Shots: 100-<name>-<w>x<h>.png. Prints "[100] mcp context PASS".
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

const rep = (rows, window, extra = {}) => ({ servers: rows.map(([name, tokens, source = 'reported']) => ({ name, tokens, source })), ...(window ? { window } : {}), ...extra });

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'mouse', tag: '100 context' });
  const emit = (id, e) => js(`window.__durbarSimEmit(Object.assign({sessionId:${jsLiteral(id)},timestamp:Date.now()},${jsLiteral(e)}))`);
  const setFig = (id, r) => js(`window.__durbarSimMcpCtx.set(${jsLiteral(id)},${jsLiteral(r)});true`);
  const closePanel = async () => { await js(`(()=>{const b=document.getElementById('backBtn');if(b)b.click()})()`); await until(`!document.body.classList.contains('panel-open')`); };
  const closeDlg = async () => { await js(`(()=>{const b=[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(x=>x.textContent==='Done');if(b)b.click();})()`); await until(`!document.getElementById('scrDlg')`); };
  const openChat = async (id) => {
    await closePanel();
    await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"]`)}).click()`);
    assert.ok(await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('mcpBtn')`), 'the chat opened with its MCP chip');
    await settle();
  };
  const openDlg = async () => {
    await js(`document.getElementById('mcpBtn').click()`);
    assert.ok(await until(`document.querySelectorAll('#agMcp li.srv').length>0`), 'the MCP dialog opened');
    await settle();
  };
  const chip = () => js(`(()=>{const b=document.getElementById('mcpBtn');if(!b)return null;const k=b.querySelector('.ct-mcpk');return {text:b.innerText.replace(/\\s+/g,' ').trim(),k:k?k.textContent:'',kShown:!!k&&!!k.getClientRects().length,name:b.getAttribute('aria-label'),title:b.title,warn:b.classList.contains('mcp-warn'),strong:b.classList.contains('mcp-strong')};})()`);
  const lines = () => js(`[...document.querySelectorAll('.mcp-line')].filter(x=>x.getClientRects().length).map(x=>({text:x.querySelector('.mcp-line-t').textContent,strong:x.classList.contains('mcp-strong'),btns:[...x.querySelectorAll('button')].map(b=>b.textContent)}))`);
  const cost = (n) => js(`(()=>{const li=[...document.querySelectorAll('#agMcp li.srv')].find(x=>x.dataset.n===${jsLiteral(n)});const c=li&&li.querySelector('.mcp-cost');return c?c.textContent:null;})()`);
  /* the line is really seen: inside the chat's scroll area, not only in the page */
  const lineSeen = async (tag) => {
    const seen = await until(`(()=>{const c=document.getElementById('chat'),l=document.querySelector('.mcp-line');if(!c||!l)return false;const a=c.getBoundingClientRect(),b=l.getBoundingClientRect();return b.top>=a.top-1&&b.bottom<=a.bottom+1;})()`);
    const where = await js(`(()=>{const c=document.getElementById('chat'),l=document.querySelector('.mcp-line'),a=c.getBoundingClientRect(),b=l.getBoundingClientRect();return {top:c.scrollTop,h:c.scrollHeight,ch:c.clientHeight,pin:c.dataset.pin,chatB:a.bottom,lineT:b.top,lineB:b.bottom,last:(c.lastElementChild&&c.lastElementChild.className),lastInner:(l.parentNode.lastElementChild===l)};})()`);
    assert.ok(seen, tag + ': the line is in view ' + JSON.stringify(where));
  };
  /* the colour is really drawn, not only the class */
  const chipBg = () => js(`getComputedStyle(document.getElementById('mcpBtn')).backgroundColor`);
  const total = () => js(`(document.getElementById('mcpTotal')||{}).textContent||''`);
  const pressInLine = async (label) => {
    const ok = await js(`(()=>{const b=[...document.querySelectorAll('.mcp-line button')].find(x=>x.textContent===${jsLiteral(label)}&&x.getClientRects().length);if(!b)return false;b.click();return true;})()`);
    assert.ok(ok, `the line has ${label}`);
  };
  const minFont = (sel) => js(`(()=>{let min=99,who='';document.querySelectorAll(${jsLiteral(sel)}).forEach(e=>{if(!e.getClientRects().length)return;const own=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());if(!own)return;const s=parseFloat(getComputedStyle(e).fontSize);if(s<min){min=s;who=e.className||e.tagName;}});return {min,who};})()`);
  const noOverflow = () => js(`document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight`);
  const fitsDlg = () => js(`(()=>{const d=document.querySelector('#scrDlg .dlg').getBoundingClientRect();return d.top>=0&&d.left>=0&&d.bottom<=innerHeight+1&&d.right<=innerWidth+1;})()`);
  const toolbarFits = () => js(`(()=>{const r=document.getElementById('ctItems');return r.scrollWidth<=r.clientWidth+1;})()`);
  const liveOf = async (kind) => {
    const cands = await js(`window.__durbarSimUi.agents().filter(a=>a.live&&!a.parent&&(a.info&&a.info.adapterId||'copilot')===${jsLiteral(kind)}).map(a=>a.id)`);
    const out = [];
    for (const c of cands) {
      const r = await js(`window.__durbarSimUi.bridge().agentMcp(${jsLiteral(c)})`);
      if (r && r.ok && r.live && (r.servers || []).filter((x) => x.status === 'connected').length >= 3) out.push(c);
    }
    return out;
  };

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    // ---- the owner's case: Copilot, a 200k window, MCP over 30 %: the warning with the first figure, before any compaction ----
    await H.load({ w, h, ready: 'fit', focus: true, query: { simmcpctx: 'owner' } });
    const ids = await liveOf('copilot');
    assert.ok(ids.length >= 4, `${w}: running Copilot chats with connected servers: ${ids.length}`);
    const [A, B, C, D] = ids;
    await openChat(A);
    assert.ok(await until(`!!document.querySelector('#mcpBtn .ct-mcpk')`), `${w}: the figure reaches the chip`);
    let c = await chip();
    assert.strictEqual(c.k, '· 62k', `${w}: reported: no mark ${JSON.stringify(c)}`);
    assert.ok(c.strong && !c.warn, `${w}: red at the strong level ${JSON.stringify(c)}`);
    for (const t of [c.name, c.title]) assert.ok(/MCP tool definitions: 62 thousand tokens, 31 % of the window, reported\. Far above the warning level of 30 %/.test(t), `${w}: the level in words: ${t}`);
    let l = await lines();
    assert.strictEqual(l.length, 1, `${w}: one line ${JSON.stringify(l)}`);
    assert.strictEqual(l[0].text, 'MCP tool definitions take 31 % of this 200k window (github 41k, my-notes 12k, github-mcp-server 9k). This can make the conversation compact often.');
    assert.ok(l[0].strong);
    assert.deepStrictEqual(l[0].btns, ['Switch off for this session…', 'Open MCP servers', 'Dismiss']);
    assert.ok(await toolbarFits(), `${w}: the toolbar row fits with the figure`);
    assert.ok(await noOverflow(), `${w}: no page overflow`);
    const fChat = await minFont('.mcp-line, .mcp-line *, #mcpBtn, #mcpBtn *');
    assert.ok(fChat.min >= 10.5, `${w}: chat text >= 10.5px ${JSON.stringify(fChat)}`);
    await lineSeen(`${w} owner`);
    const bgStrong = await chipBg();
    await shot(`100-owner-chat-${w}x${h}.png`);

    // FR-022, FR-023: the dialog with the heaviest focused; pressing the action changes nothing
    await pressInLine('Switch off for this session…');
    assert.ok(await until(`document.querySelectorAll('#agMcp li.srv').length>0`), 'the action opens the dialog');
    assert.ok(await until(`document.activeElement&&document.activeElement.dataset&&document.activeElement.dataset.n==='github'`), `${w}: the heaviest server's switch has the focus`);
    await settle();
    let st = await js(`window.__durbarSimUi.bridge().agentMcp(${jsLiteral(A)})`);
    assert.ok(!st.servers.find((x) => x.name === 'github').off, `${w}: nothing was switched by opening`);
    assert.strictEqual(await cost('github'), '41k tokens, largest', `${w}: reported, no ≈, the heaviest in words`);
    assert.strictEqual(await cost('my-notes'), '12k tokens');
    assert.match(await total(), /Tool definitions of these servers: 62k tokens, 31 % of the 200k window\. Reported by Copilot\./, `${w}: total and footnote`);
    assert.ok(await fitsDlg(), `${w}: the dialog fits`);
    const fDlg = await minFont('#scrDlg .dlg, #scrDlg .dlg *');
    assert.ok(fDlg.min >= 10.5, `${w}: dialog text >= 10.5px ${JSON.stringify(fDlg)}`);
    await js(`document.querySelectorAll('#toasts .toast').forEach(x=>x.remove());document.activeElement&&document.activeElement.blur();true`);
    await shot(`100-owner-dialog-${w}x${h}.png`);
    // the person's own switch: the figure follows; that server shows "not loaded" and leaves the total
    await js(`[...document.querySelectorAll('#agMcp button.swt')].find(x=>x.dataset.n==='github').click()`);
    assert.ok(await until(`(()=>{const c=[...document.querySelectorAll('#agMcp li.srv')].find(x=>x.dataset.n==='github');return !!c&&(c.querySelector('.mcp-cost')||{}).textContent==='not loaded';})()`), `${w}: a switched-off server is not loaded`);
    assert.ok(await until(`/21k tokens, 11 %/.test((document.getElementById('mcpTotal')||{}).textContent||'')`), `${w}: it left the total: ${await total()}`);
    await closeDlg();
    assert.deepStrictEqual(await lines(), [], `${w}: 10.5 %: the line goes`);
    assert.ok(!(await chip()).strong, 'and the colour');
    await js(`window.__durbarSimUi.bridge().setAgentMcp(${jsLiteral(A)},'github',true)`);
    assert.ok(await until(`document.querySelectorAll('.mcp-line').length===1`), `${w}: on again: the line is back`);

    // FR-013: the token summary bar
    await js(`document.getElementById('ctxChip').click()`);
    assert.ok(await until(`!!document.getElementById('ctxMenu')`), 'the token summary opens');
    const bar = await js(`(()=>{const r=document.querySelector('#ctxMenu .cb-mcp');return r?r.innerText.replace(/\\s+/g,' '):null;})()`);
    assert.ok(bar && /MCP tools/.test(bar) && /62k/.test(bar) && !/estimated/.test(bar), `${w}: an MCP tools bar: ${bar}`);
    await shot(`100-owner-summary-${w}x${h}.png`);
    await js(`document.getElementById('ctxChip').click()`);
    await until(`!document.getElementById('ctxMenu')`);

    // ---- T024: the levels, on chat B ----
    await openChat(B);
    await setFig(B, rep([['github', 20_000]], 200_000));
    assert.ok(await until(`/20k/.test((document.querySelector('#mcpBtn .ct-mcpk')||{}).textContent||'')`), `${w}: 10 % shows its figure`);
    assert.deepStrictEqual(await lines(), [], `${w}: 10 %: no line`);
    const bgCalm = await chipBg();
    assert.notStrictEqual(bgCalm, bgStrong, `${w}: red is drawn: ${bgStrong}`);
    c = await chip();
    assert.ok(!c.warn && !c.strong && /10 % of the window/.test(c.name) && !/warning level/.test(c.name), `${w}: 10 %: calm ${JSON.stringify(c)}`);
    await setFig(B, rep([['github', 40_000]], 200_000));
    assert.ok(await until(`document.querySelectorAll('.mcp-line').length===1`), `${w}: 20 %: a line`);
    l = await lines();
    assert.ok(!l[0].strong && /take 20 % of this 200k window \(github 40k\)/.test(l[0].text), `${w}: amber ${JSON.stringify(l)}`);
    c = await chip();
    assert.ok(c.warn && !c.strong && /Above the warning level of 15 %/.test(c.name), `${w}: the chip at warn ${JSON.stringify(c)}`);
    await lineSeen(`${w} 20 %`);
    const bgWarn = await chipBg();
    assert.ok(bgWarn !== bgCalm && bgWarn !== bgStrong, `${w}: amber is drawn: ${bgWarn}`);
    await shot(`100-warn-20-${w}x${h}.png`);
    // finding: the action follows the current heaviest server, not the one of the first figure
    await setFig(B, rep([['my-notes', 45_000], ['github', 40_000]], 200_000));
    assert.ok(await until(`/my-notes 45k/.test((document.querySelector('.mcp-line-t')||{}).textContent||'')`), `${w}: the line follows`);
    await pressInLine('Switch off for this session\u2026');
    assert.ok(await until(`document.activeElement&&document.activeElement.dataset&&document.activeElement.dataset.n==='my-notes'`), `${w}: the current heaviest is focused`);
    await closeDlg();
    await setFig(B, rep([['github', 40_000]], 200_000));
    await pressInLine('Dismiss');
    assert.ok(await until(`document.querySelectorAll('.mcp-line').length===0`), 'Dismiss takes it away');
    await setFig(B, rep([['github', 44_000]], 200_000));
    await until(`/44k/.test((document.querySelector('#mcpBtn .ct-mcpk')||{}).textContent||'')`);
    assert.deepStrictEqual(await lines(), [], `${w}: dismissed: not back at warn`);
    assert.ok((await chip()).warn, 'the chip keeps its colour');
    await setFig(B, rep([['github', 70_000]], 200_000));
    assert.ok(await until(`document.querySelectorAll('.mcp-line').length===1`), `${w}: 35 %: back at strong`);
    assert.ok((await lines())[0].strong && (await chip()).strong, `${w}: red`);
    await lineSeen(`${w} 35 %`);
    await shot(`100-strong-35-${w}x${h}.png`);
    await pressInLine('Dismiss');
    await until(`document.querySelectorAll('.mcp-line').length===0`);
    await setFig(B, rep([['github', 71_000]], 200_000));
    await until(`/71k/.test((document.querySelector('#mcpBtn .ct-mcpk')||{}).textContent||'')`);
    assert.deepStrictEqual(await lines(), [], `${w}: dismissed at strong: never again`);

    // the 1M window: the same rule, and the tokens
    await openChat(C);
    await setFig(C, rep([['github', 200_000]], 1_000_000));
    assert.ok(await until(`document.querySelectorAll('.mcp-line').length===1`), `${w}: 20 % of 1M`);
    assert.match((await lines())[0].text, /take 20 % of this 1M window, 200k tokens/, `${w}: with the tokens`);
    // a window not known yet: tokens, no percentage, no line; the share comes when it is known
    await setFig(C, rep([['github', 28_000]], undefined));
    await until(`/28k/.test((document.querySelector('#mcpBtn .ct-mcpk')||{}).textContent||'')`);

    // a failed server: partial
    await openChat(D);
    await setFig(D, rep([['github', 10_000, 'estimated']], 200_000, { partial: true, servers: [{ name: 'github', tokens: 10_000, source: 'estimated' }, { name: 'my-notes', source: 'unknown', error: 'list failed' }] }));
    await until(`/10k/.test((document.querySelector('#mcpBtn .ct-mcpk')||{}).textContent||'')`);
    assert.deepStrictEqual(await lines(), [], `${w}: partial below the level: no line`);
    await setFig(D, { servers: [{ name: 'github', tokens: 40_000, source: 'estimated' }, { name: 'my-notes', source: 'unknown', error: 'list failed' }, { name: 'github-mcp-server', source: 'unknown' }], window: 200_000, partial: true });
    assert.ok(await until(`document.querySelectorAll('.mcp-line').length===1`), `${w}: partial above the level`);
    assert.match((await lines())[0].text, /take at least 20 %/, `${w}: at least`);
    assert.match((await chip()).name, /at least 40 thousand tokens, at least 20 % of the window/, `${w}: the chip says at least too`);
    await openDlg();
    assert.strictEqual(await cost('my-notes'), 'size not known', `${w}: the failed list's row`);
    assert.match(await total(), /Tool definitions of the servers that answered: ≈40k tokens, 20 % of the 200k window/, `${w}: the partial total`);
    assert.match(await total(), /about 4 characters per token; the real figure can differ by a third/, `${w}: an estimate says how`);
    await shot(`100-failed-${w}x${h}.png`);
    await closeDlg();

    // ---- the compaction hint (US3): on a chat whose line was dismissed, at 31 %: 4 completes in 10 simulated minutes ----
    await openChat(B);
    await setFig(B, rep([['github', 41_000], ['my-notes', 21_000]], 200_000));
    await until(`/62k/.test((document.querySelector('#mcpBtn .ct-mcpk')||{}).textContent||'')`);
    const T0 = await js(`Date.now()`);
    const comp = (i) => emit(B, { type: 'compaction', phase: 'complete', trigger: 'auto', tokensAfter: 40_000, limit: 200_000, timestamp: T0 + i * 200_000 });
    for (let i = 0; i < 3; i++) await comp(i);
    await settle();
    assert.strictEqual(await js(`document.querySelectorAll('.mcp-hint').length`), 0, `${w}: 3 compactions: no hint`);
    await comp(3);
    assert.ok(await until(`document.querySelectorAll('.mcp-hint').length===1`), `${w}: the 4th brings the hint`);
    const hint = await js(`(()=>{const x=document.querySelector('.mcp-hint');const p=x.closest('.cline');return {t:x.innerText.replace(/\\s+/g,' '),line:p&&p.textContent,btns:[...x.querySelectorAll('button')].map(b=>b.textContent)};})()`);
    assert.match(hint.t, /MCP tool definitions take 31 % of the window, so each compaction frees less\. Switching off github would free 41k\./, `${w}: ${hint.t}`);
    assert.match(hint.line, /Context compacted 4 times/, `${w}: on the folded line: ${hint.line}`);
    assert.deepStrictEqual(hint.btns, ['Switch off for this session…', 'Open MCP servers', 'Dismiss']);
    await shot(`100-compaction-hint-${w}x${h}.png`);
    await comp(4);
    await settle();
    assert.strictEqual(await js(`document.querySelectorAll('.mcp-hint').length`), 1, `${w}: once, and it survives the next fold`);
    assert.match(await js(`document.querySelector('.mcp-hint').closest('.cline').textContent`), /Context compacted 5 times/);
    await js(`[...document.querySelectorAll('.mcp-hint button')].find(x=>x.textContent==='Dismiss').click()`);
    await until(`document.querySelectorAll('.mcp-hint').length===0`);
    await comp(5);
    await settle();
    assert.strictEqual(await js(`document.querySelectorAll('.mcp-hint').length`), 0, `${w}: dismissed, not back at this level`);

    // ---- spec 100: per session: Restart session starts over: the figures, a dismissal and the compaction times ----
    await js(`window.__durbarSimUi.bridge().agentMcpRestartSession(${jsLiteral(B)},true)`);
    assert.ok(await until(`!document.querySelector('#mcpBtn .ct-mcpk')||/62k/.test(document.querySelector('#mcpBtn .ct-mcpk').textContent)`), `${w}: restarted`);
    assert.ok(await until(`document.querySelectorAll('.mcp-line').length===1`), `${w}: a new session: the dismissed line can show again`);
    await settle();
    assert.strictEqual(await js(`document.querySelectorAll('.mcp-hint').length`), 0, `${w}: and no hint from the last session`);
    for (let i = 0; i < 3; i++) await comp(i + 20);
    await settle();
    assert.strictEqual(await js(`document.querySelectorAll('.mcp-hint').length`), 0, `${w}: 3 compactions of the new session: its times started over`);
    await comp(23);
    assert.ok(await until(`document.querySelectorAll('.mcp-hint').length===1`), `${w}: the 4th of this session brings it, once per session`);
    // ...and a session that ended shows nothing until the next one reports
    await emit(B, { type: 'status', status: 'stopped' });
    assert.ok(await until(`!document.querySelector('#mcpBtn .ct-mcpk')&&!document.querySelector('.mcp-line')&&!document.querySelector('.mcp-hint')`), `${w}: ended: no figure, line or hint`);
    await emit(B, { type: 'status', status: 'idle' });
    await js(`window.__durbarSimMcpCtx.push(${jsLiteral(B)});true`);
    assert.ok(await until(`document.querySelectorAll('.mcp-line').length===1`), `${w}: resumed: the figures come back`);

    // ---- names as written: joiners stay in the line ----
    const FA = 'می\u200cخواهم';
    await setFig(B, rep([[FA, 80_000]], 200_000));
    assert.ok(await until(`(document.querySelector('.mcp-line-t')||{}).textContent&&document.querySelector('.mcp-line-t').textContent.includes(${jsLiteral(FA)})`), `${w}: the Persian name keeps its joiner`);

    // ---- hostile names: markup stays text, in the line, the hint and Settings ----
    const EVIL = '<img id=pwn src=x onerror=window.__pwned=1>';
    await setFig(B, rep([[EVIL, 80_000]], 200_000));
    assert.ok(await until(`(document.querySelector('.mcp-line-t')||{}).textContent&&document.querySelector('.mcp-line-t').textContent.includes(${jsLiteral(EVIL)})`), `${w}: the line shows the name as text`);
    await js(`window.__durbarSimMcpCtx.costs={copilot:{${jsLiteral(EVIL)}:{tokens:5,source:'reported',capped:true,at:Date.now()-30*86400000}}};true`);
    await js(`window.DurbarScreens.openSettings('mcp')`);
    assert.ok(await until(`!!document.getElementById('mcpCosts')`), `${w}: Settings lists it`);
    const evilRow = await js(`document.getElementById('mcpCosts').innerText.replace(/\\s+/g,' ')`);
    assert.ok(evilRow.includes(EVIL) && /\u22655 in Copilot|\u22650 in Copilot|in Copilot/.test(evilRow) && /20\d\d/.test(evilRow), `${w}: as text, with the date: ${evilRow}`);
    assert.ok(await js(`!document.getElementById('pwn')&&!window.__pwned`), `${w}: no element came from the name`);
    await js(`window.__durbarSimMcpCtx.refuseSave=true;document.getElementById('mcpWarnPct').value='15';document.getElementById('mcpStrongPct').value='30';document.getElementById('mcpWarnMsg').textContent='';document.getElementById('mcpWarnSave').click();true`);
    assert.ok(await until(`document.getElementById('mcpWarnMsg').textContent==='Not saved.'`), `${w}: a save that failed says so`);
    await js(`window.__durbarSimMcpCtx.refuseSave=false;window.__durbarSimMcpCtx.costs=undefined;window.DurbarScreens.close&&window.DurbarScreens.close();true`);

    // ---- Copilot "not reported": no figure, no estimate, no line ----
    await H.load({ w, h, ready: 'fit', focus: true, query: { simmcpctx: 'notreported' } });
    const [N] = await liveOf('copilot');
    await openChat(N);
    assert.ok(await until(`/not reported by/.test(document.getElementById('mcpBtn').getAttribute('aria-label'))`), `${w}: the chip's name says it`);
    c = await chip();
    assert.ok(!c.k && !c.warn && !c.strong, `${w}: no figure ${JSON.stringify(c)}`);
    assert.deepStrictEqual(await lines(), []);
    await openDlg();
    assert.strictEqual(await cost('github'), 'size not known', `${w}: never an estimate`);
    assert.match(await total(), /^Size not reported by Copilot\./, `${w}: ${await total()}`);
    await shot(`100-not-reported-${w}x${h}.png`);
    await closeDlg();

    // ---- the other apps: a Codex estimate, a Claude Code report with deferred tools; Settings ----
    await H.load({ w, h, ready: 'fit', focus: true, query: { simkinds: 'mixed', simmcpctx: 'mixed' } });
    const [X] = await liveOf('codex');
    assert.ok(X, `${w}: a running Codex chat`);
    await openChat(X);
    assert.ok(await until(`/≈38k/.test((document.querySelector('#mcpBtn .ct-mcpk')||{}).textContent||'')`), `${w}: the ≈ mark`);
    // a real Codex report has no window: it comes from the context event
    await emit(X, { type: 'context', tokens: 50_000, limit: 200_000 });
    assert.ok(await until(`/19 % of the window/.test(document.getElementById('mcpBtn').getAttribute('aria-label'))`), `${w}: the share against the reported window`);
    c = await chip();
    assert.ok(/about 38 thousand tokens, 19 % of the window, estimated/.test(c.name) && c.warn, `${w}: estimated ${JSON.stringify(c)}`);
    assert.match((await lines())[0].text, /github ≈26k/, `${w}: the line marks estimates`);
    await openDlg();
    assert.strictEqual(await cost('github'), '≈26k tokens (estimated), largest');
    assert.match(await total(), /Estimated by Agent Durbar from the tool definitions/);
    await shot(`100-codex-${w}x${h}.png`);
    await closeDlg();
    // FR-030 on Codex: its compactions do not say the new size and its report has no window: the hint still comes (finding 4)
    const T1 = await js(`Date.now()`);
    for (let i = 0; i < 4; i++) await emit(X, { type: 'compaction', phase: 'complete', trigger: 'auto', timestamp: T1 + i * 200_000 });
    assert.ok(await until(`document.querySelectorAll('.mcp-hint').length===1`), `${w}: the hint on Codex, after a compaction with no size`);
    assert.match(await js(`document.querySelector('.mcp-hint').innerText`), /19 % of the window/, `${w}: of the window last reported`);
    // the window after a model change is not the old model's, also when a compaction comes first (finding 5)
    assert.ok(await until(`document.querySelectorAll('.mcp-hint').length===1`), `${w}: still the hint`);
    await emit(X, { type: 'model', model: 'other-model', cause: 'user' });
    await emit(X, { type: 'compaction', phase: 'complete', trigger: 'auto', timestamp: T1 + 900_000 });
    assert.ok(await until(`!/19 % of the window/.test(document.getElementById('mcpBtn').getAttribute('aria-label'))`), `${w}: not the old window: ${(await chip()).name}`);
    await emit(X, { type: 'context', tokens: 50_000, limit: 500_000 });
    assert.ok(await until(`/8 % of the window/.test(document.getElementById('mcpBtn').getAttribute('aria-label'))`), `${w}: a known window`);
    // a compaction that says its size after a model change must not carry the old window over
    await emit(X, { type: 'model', model: 'third-model', cause: 'user' });
    await emit(X, { type: 'compaction', phase: 'complete', trigger: 'auto', tokensAfter: 5000, timestamp: T1 + 950_000 });
    assert.ok(await until(`!/8 % of the window/.test(document.getElementById('mcpBtn').getAttribute('aria-label'))`), `${w}: not the old window after a sized compaction: ${(await chip()).name}`);
    await emit(X, { type: 'context', tokens: 50_000, limit: 100_000 });
    assert.ok(await until(`/38 % of the window/.test(document.getElementById('mcpBtn').getAttribute('aria-label'))`), `${w}: the new model's window`);
    const [K] = await liveOf('claude');
    assert.ok(K, `${w}: a running Claude Code chat`);
    await openChat(K);
    assert.ok(await until(`!!document.querySelector('#mcpBtn .ct-mcpk')`), `${w}: Claude's figure`);
    assert.deepStrictEqual(await lines(), [], `${w}: tool search on: 1 %, no line (deferred tools are not in the window)`);
    assert.ok(!(await chip()).warn);
    await openDlg();
    assert.match(await cost('github'), /^1\.5k tokens, loaded on demand: 40k/, `${w}: deferred`);
    assert.match(await total(), /Reported by Claude Code\..*not in this total/, `${w}: ${await total()}`);
    await shot(`100-claude-deferred-${w}x${h}.png`);
    await closeDlg();

    // Settings: the levels and the last figures
    await js(`window.DurbarScreens.openSettings('mcp')`);
    assert.ok(await until(`!!document.getElementById('mcpWarnPct')`), `${w}: the levels in Settings`);
    await settle();
    assert.deepStrictEqual(await js(`[document.getElementById('mcpWarnPct').value,document.getElementById('mcpStrongPct').value,document.getElementById('mcpWarnOff').checked]`), ['15', '30', false]);
    const costLine = await js(`[...document.querySelectorAll('#mcpCosts li')].map(x=>x.innerText.replace(/\\s+/g,' '))`);
    assert.ok(costLine.some((t) => /^github 41k in Copilot, 0\.4k on demand in Claude Code, ≈38k in Codex, measured /.test(t)), `${w}: the last figures ${JSON.stringify(costLine)}`);
    await js(`document.getElementById('mcpWarnH').scrollIntoView({block:'start'});true`);
    await settle();
    assert.ok(await js(`document.getElementById('mcpWarnH').compareDocumentPosition(document.getElementById('ambList'))&Node.DOCUMENT_POSITION_FOLLOWING`), 'the section sits above the list');
    assert.ok(await js(`document.getElementById('mcpWarnOff').getBoundingClientRect().width<30`), `${w}: Off is a plain checkbox`);
    await shot(`100-settings-${w}x${h}.png`);
    const setLv = async (a, b, off) => { await js(`(()=>{document.getElementById('mcpWarnPct').value=${jsLiteral(a)};document.getElementById('mcpStrongPct').value=${jsLiteral(b)};document.getElementById('mcpWarnOff').checked=${jsLiteral(off)};document.getElementById('mcpWarnMsg').textContent='';document.getElementById('mcpWarnSave').click();})()`); };
    for (const [a, b] of [['4', '30'], ['15', '91'], ['30', '30'], ['15.5', '30'], ['', '30']]) {
      await setLv(a, b, false);
      assert.ok(await until(`/whole percents from 5 to 90/.test(document.getElementById('mcpWarnMsg').textContent)`), `${w}: refused: ${a}, ${b}`);
    }
    assert.deepStrictEqual(await js(`window.__durbarSimUi.bridge().getSettings().then(s=>s.mcpWarnLevels)`), { warn: 15, strong: 30, off: false }, `${w}: a refusal changes nothing`);
    await setLv('5', '10', true);
    assert.ok(await until(`document.getElementById('mcpWarnMsg').textContent==='Saved.'`), `${w}: saved`);
    await js(`(()=>{const b=document.querySelector('#screen [data-close],#screen .scr-close,#scrClose');if(b)b.click();})()`);
    await js(`window.DurbarScreens.close&&window.DurbarScreens.close()`);
    await openChat(X);
    assert.ok(await until(`!document.getElementById('mcpBtn').classList.contains('mcp-warn')`), `${w}: Off: no colour`);
    assert.deepStrictEqual(await lines(), [], `${w}: Off: no line`);
    await js(`window.__durbarSimUi.bridge().setMcpWarnLevels({warn:15,strong:30,off:false})`);
  }
  console.log('[100] mcp context PASS');
};
