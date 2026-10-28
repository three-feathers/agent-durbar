/*
 * Spec 087 T030-T032, T022 AC3 (FR-007, FR-009, FR-010, FR-012, FR-017, FR-021): the OS sandbox floor in the window, on the simulator
 * (simkinds=mixed: its fixed sandbox table), at 1440x900 and 1280x800. Simulator only, no real session, no credits:
 *
 *   npm run build
 *   OUT=/tmp/087 DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/check-sandbox-floor.js xvfb-run -a npx electron . --no-sandbox
 *
 * Checks: the chat chip says each state after the mode (Read-only · Sandboxed, Read-only · Sandbox: checking, Ask first · Not sandboxed,
 * Allow all · Sandboxed (managed), Allow all · Sandboxed (until a new session)), in text at least 10.5px, and its tooltip says what is
 * covered and ends with "Requested; not verified on a real session." (Claude: MCP servers are not covered; Codex Ask first: an approved
 * command may run outside the sandbox); the card's mode icon and the mode menu carry the same words; Codex's Ask first card shows its
 * sandbox line whole (not clipped); simsendfail=sandbox-choice: a Claude Code send shows the note (nothing sent, the message marked Not
 * sent) with Continue without the OS sandbox, Always continue on this computer and the existing Change mode…; Always goes through the
 * shared askDialog; Settings > Agent apps shows the OS sandbox line per app (reason at most 200 characters) and undoes Always. Every
 * wait is an until(). T070 (FR-022, FR-022e, issue #806): the kept floor in Allow all (Copilot sim-15) has the chip button and the mode menu item
 * Restart without the sandbox (tooltip, keyboard, Escape back to the chip); its own dialog (busy, grants, remote control, next-message lines;
 * no MCP wording) where Cancel calls nothing and confirming calls the existing restart with reason 'sandbox', after which the word and the action
 * go; Copilot's Allow all dialog says its OS sandbox is also turned off (FR-022c, T072) and the switch leaves no word, Claude Code's and Codex's do
 * not say it and never show the action; with simsbxlower=refuse a refused lowering keeps the floor and its action and toasts once (review on PR #833); managed and the office card's
 * menu never have it. Prints "[087-sandbox] PASS".
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';
const NOT_VERIFIED = 'Requested; not verified on a real session.';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until, settle } = H;
  const chip = () => js(`(()=>{const c=document.getElementById('modeChip');if(!c)return null;const s=c.querySelector('.mode-sbx');return {text:c.innerText.replace(/\\s+/g,' ').trim(),chipTitle:c.title,title:s?s.title:'',px:s?parseFloat(getComputedStyle(s).fontSize):0,inBox:(()=>{if(!s)return false;const r=s.getBoundingClientRect(),R=c.getBoundingClientRect();return r.right<=R.right+0.5&&r.left>=R.left-0.5&&r.width>0})()}})()`);
  const openAgent = async (id) => {
    if (await js(`document.body.classList.contains('panel-open')`)) {
      await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
      assert.ok(await until(`!document.body.classList.contains('panel-open')`, 8000), 'back to the office');
    }
    await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"]`)}).click()`);
    assert.ok(await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('msgInput')`, 10000), `${id}: the chat opens`);
    await settle();
  };
  const expectChip = async (w, id, re, more = () => true) => {
    await openAgent(id);
    assert.ok(await until(`(()=>{const c=document.getElementById('modeChip');return !!c&&new RegExp(${jsLiteral(re.source)}).test(c.innerText.replace(/\\s+/g,' '))})()`, 8000), `${w}: ${id} chip ${re}: ${JSON.stringify(await chip())}`);
    const c = await chip();
    assert.ok(c.px >= 10.5 && c.inBox, `${w}: ${id}: the segment is legible text inside the chip: ${JSON.stringify(c)}`);
    assert.ok(c.chipTitle.length <= 120 && c.title.length <= 300, `${w}: ${id}: tooltips within their limits (chip ${c.chipTitle.length}, segment ${c.title.length})`);
    assert.ok(more(c), `${w}: ${id}: tooltip ${c.title}`);
    return c;
  };
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, query: { simkinds: 'mixed', simsendfail: 'sandbox-choice' } });
    // ---- FR-009/FR-010: each state, in words; the tooltip says what is covered and how far it was checked ----
    const ada = await expectChip(w, 'sim-1', /Read-only · Sandboxed\b/, (c) => c.title.endsWith(NOT_VERIFIED) && /MCP servers, hooks, the status line, file reads and edits are outside it/.test(c.title) && /writes: none, network: off/.test(c.title));
    await H.shot(path.join(OUT, `087-sandbox-chip-${w}x${h}.png`), { prep: 'mouse' });
    // the mode menu says it too
    await js(`document.getElementById('modeChip').click()`);
    assert.ok(await until(`!!document.querySelector('#modeMenu .mm-sbx')`, 5000), `${w}: the mode menu has the sandbox note`);
    const menuNote = await js(`document.querySelector('#modeMenu .mm-sbx').innerText`);
    assert.ok(/Sandboxed\./.test(menuNote) && menuNote.includes(NOT_VERIFIED), `${w}: mode menu note: ${menuNote}`);
    await H.shot(path.join(OUT, `087-sandbox-menu-${w}x${h}.png`), { prep: 'mouse' });
    await js(`document.querySelector('#modeMenu').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    assert.ok(await until(`!document.getElementById('modeMenu')`, 3000), 'menu closed');
    void ada;
    await expectChip(w, 'sim-13', /Read-only · Sandbox: checking/, (c) => /^Checked when Copilot starts\./.test(c.title));
    await expectChip(w, 'sim-11', /Ask first · Not sandboxed/, (c) => /^Copilot says this computer cannot run its sandbox/.test(c.title) && /Durbar.s own checks still apply/.test(c.title));
    await expectChip(w, 'sim-6', /Allow all · Sandboxed \(managed\)/, (c) => /Your organization keeps/.test(c.title));
    // the kept floor in Allow all: its segment is the Restart without the sandbox button (T070 below); the state's own tooltip is in the mode menu
    await openAgent('sim-15');
    assert.ok(await until(`/^Allow all/.test(document.getElementById('modeChip').innerText.trim())&&(document.getElementById('sbxRestartBtn')||{}).textContent==='Sandboxed (until a new session)'`, 8000), `${w}: sim-15: Allow all + the kept-floor button`);
    await js(`document.getElementById('modeChip').click()`);
    assert.ok(await until(`!!document.querySelector('#modeMenu .mm-sbx')`, 5000));
    const keptNote = await js(`document.querySelector('#modeMenu .mm-sbx').innerText`);
    assert.ok(/stays until a new session/.test(keptNote) && /Shell commands and MCP servers run in bubblewrap/.test(keptNote), `${w}: the kept floor's note: ${keptNote}`);
    await js(`document.querySelector('#modeMenu').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    assert.ok(await until(`!document.getElementById('modeMenu')`, 3000));
    // ---- FR-021a (K15): Copilot Ask first with the floor on: the tooltip says an approved command may leave it, and stays not verified ----
    await expectChip(w, 'sim-2', /Ask first · Sandboxed \(partial\)/, (c) => /writes: not only this folder/.test(c.title) && /An approved command could write outside the folder \(Copilot, seen on Linux, 2026-10-25\)\./.test(c.title) && c.title.endsWith(NOT_VERIFIED));
    // ---- FR-021 (T022 AC3): Codex Ask first: the card's sandbox line, whole; the chip tooltip says it too ----
    await expectChip(w, 'sim-8', /Ask first · Sandboxed(?! \(partial)/, (c) => /If you approve a command, Codex may run it outside the sandbox/.test(c.title) && /Commands and file changes run in the Codex sandbox/.test(c.title));
    assert.ok(await until(`!!document.querySelector('#chat .note.perm.pending .psbx')`, 8000), `${w}: Codex's waiting card has its sandbox line`);
    const psbx = await js(`(()=>{const p=document.querySelector('#chat .note.perm.pending .psbx');p.scrollIntoView({block:'nearest'});const n=p.closest('.note').getBoundingClientRect(),r=p.getBoundingClientRect(),cs=getComputedStyle(p);return {text:p.textContent,whole:p.scrollWidth<=p.clientWidth+0.5&&cs.textOverflow!=='ellipsis',inside:r.right<=n.right+0.5&&r.left>=n.left-0.5,px:parseFloat(cs.fontSize),sum:p.closest('.note').querySelector('.psum').textContent}})()`);
    assert.strictEqual(psbx.text, 'If you approve, Codex may run this outside its sandbox.', `${w}: the exact line`);
    assert.ok(psbx.whole && psbx.inside && psbx.px >= 10.5, `${w}: the line is whole and legible: ${JSON.stringify(psbx)}`);
    assert.ok(!/sandbox/.test(psbx.sum), `${w}: the summary itself is unchanged`);
    await H.shot(path.join(OUT, `087-codex-card-${w}x${h}.png`), { prep: 'mouse' });
    // ---- FR-021a (K15): Copilot Ask first: Kenji (Copilot without simkinds=mixed) waits on a shell command; the card has its own line ----
    await H.load({ w, h, query: {} });
    await expectChip(w, 'sim-8', /Ask first · Sandboxed \(partial\)/, (c) => /An approved command could write outside the folder/.test(c.title));
    assert.ok(await until(`!!document.querySelector('#chat .note.perm.pending .psbx')`, 8000), `${w}: Copilot's waiting shell card has its sandbox line`);
    const cps = await js(`(()=>{const p=document.querySelector('#chat .note.perm.pending .psbx');p.scrollIntoView({block:'nearest'});const n=p.closest('.note').getBoundingClientRect(),r=p.getBoundingClientRect(),cs=getComputedStyle(p);return {text:p.textContent,whole:p.scrollWidth<=p.clientWidth+0.5&&cs.textOverflow!=='ellipsis',inside:r.right<=n.right+0.5&&r.left>=n.left-0.5,px:parseFloat(cs.fontSize)}})()`);
    assert.strictEqual(cps.text, 'If you approve, Copilot’s sandbox may still let this write outside the folder (seen on Linux, 2026-10-25).', `${w}: Copilot's exact line`);
    assert.ok(cps.whole && cps.inside && cps.px >= 10.5, `${w}: Copilot's line is whole and legible: ${JSON.stringify(cps)}`);
    await H.shot(path.join(OUT, `087-copilot-card-${w}x${h}.png`), { prep: 'mouse' });
    await H.load({ w, h, query: { simkinds: 'mixed', simsendfail: 'sandbox-choice' } });
    await openAgent('sim-8'); // back to Codex's chat for the hostile-text checks
    // ---- hostile text: a reason and a note with markup and a token are shown as masked text, never as markup ----
    const TOK = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
    await js(`window.__durbarSimEmit({type:'sandbox',sessionId:'sim-8',timestamp:Date.now(),sandbox:{state:'off',covers:['shell'],verified:false,reason:${jsLiteral('<img src=x class=evil> blocked by ' + TOK)}},notice:{text:${jsLiteral('<b class=evil>bad</b> could not start its OS sandbox: ' + TOK + '. Nothing was sent.')},actions:['continue']}})`);
    assert.ok(await until(`[...document.querySelectorAll('#chat .note.sbx-note')].some(n=>n.textContent.includes('<b class=evil>'))`, 5000), `${w}: the note shows the markup as text`);
    const hostile = await js(`(()=>{const c=document.getElementById('modeChip');const n=[...document.querySelectorAll('#chat .note.sbx-note')].pop();const t=(c.querySelector('.mode-sbx')||{}).title||'';return {evil:!!document.querySelector('#chat .evil, #modeChip .evil'),tok:(c.title+t+n.textContent).includes(${jsLiteral(TOK)}),chipTitle:t}})()`);
    assert.ok(!hostile.evil && !hostile.tok, `${w}: no markup, no token: ${JSON.stringify(hostile)}`);
    assert.ok(/<img src=x class=evil>/.test(hostile.chipTitle) && /redacted/.test(hostile.chipTitle), `${w}: the reason is text, masked`);
    // ---- the card's mode icon tooltip (no new word on the office card: decision Q5) ----
    await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    assert.ok(await until(`!document.body.classList.contains('panel-open')`, 8000));
    const deskTip = await js(`(()=>{const d=document.querySelector('#stage .desk[data-id="sim-1"]');const m=d&&d.querySelector('.modeic,.modebadge');return {title:m?m.title:'',words:/Sandbox/.test(d?d.innerText:'')}})()`);
    assert.ok(/Sandboxed\. Right-click for options\.$/.test(deskTip.title), `${w}: the card's mode icon tooltip: ${deskTip.title}`);
    assert.ok(!deskTip.words, `${w}: no sandbox word on the office card`);
    // ---- FR-007 (T032): a Claude Code send whose sandbox cannot start: nothing sent, Continue / Always / Change mode… ----
    await openAgent('sim-1');
    await js(`(()=>{const i=document.getElementById('msgInput');i.value='Please run the tests.';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('sendBtn').click();})()`);
    assert.ok(await until(`!!document.querySelector('#chat .note.sbx-note')`, 8000), `${w}: the sandbox note`);
    const note = await js(`(()=>{const n=[...document.querySelectorAll('#chat .note.sbx-note')].pop();const b=[...n.querySelectorAll('.note-actions button')];const u=[...document.querySelectorAll('#chat .msg.user')].pop();const R=n.getBoundingClientRect();return {text:n.innerText,btns:b.map(x=>x.textContent),inside:b.every(x=>{const r=x.getBoundingClientRect();return r.right<=R.right+0.5&&r.bottom<=R.bottom+0.5}),px:Math.min(...b.map(x=>parseFloat(getComputedStyle(x).fontSize))),unsent:!!(u&&u.querySelector('.unsent')&&u.classList.contains('not-sent')),perm:n.classList.contains('perm')}})()`);
    assert.ok(/could not start its OS sandbox/.test(note.text) && /Nothing was sent\./.test(note.text), `${w}: the note says why and that nothing was sent: ${note.text}`);
    assert.deepStrictEqual(note.btns, ['Continue without the OS sandbox', 'Always continue on this computer', 'Change mode…'], `${w}: the choices`);
    assert.ok(note.inside && note.px >= 10.5, `${w}: the buttons sit in the note, legible`);
    assert.ok(note.unsent, `${w}: the message is marked Not sent`);
    assert.ok(!note.perm, `${w}: not a permission card (the answer bar leaves it alone)`);
    assert.ok(await until(`/Read-only · Not sandboxed/.test(((document.getElementById('modeChip')||{}).innerText||'').replace(/\\s+/g,' '))`, 5000), `${w}: the chip turns Not sandboxed`);
    await js(`(()=>{const n=[...document.querySelectorAll('#chat .note.sbx-note')].pop();let p=n.parentElement;while(p&&p.scrollHeight<=p.clientHeight+1)p=p.parentElement;if(p&&p!==document.body&&p!==document.documentElement)p.scrollTop=p.scrollHeight;})()`);
    await H.shot(path.join(OUT, `087-sandbox-note-${w}x${h}.png`), { prep: 'mouse' });
    // Change mode… is the usual mode menu
    await js(`[...document.querySelectorAll('#chat .note.sbx-note [data-act="modeRefusal"]')].pop().click()`);
    assert.ok(await until(`document.querySelectorAll('#modeMenu [data-mode]').length===3`, 5000), `${w}: Change mode… opens the mode menu`);
    await js(`document.querySelector('#modeMenu').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    assert.ok(await until(`!document.getElementById('modeMenu')`, 3000));
    // Always continue: the shared askDialog first (Cancel keeps everything), then the note settles
    await js(`[...document.querySelectorAll('#chat .note.sbx-note [data-act="sbxAlways"]')].pop().click()`);
    assert.ok(await until(`!!document.querySelector('#modeDlg [aria-modal="true"]')`, 5000), `${w}: the confirmation is the shared dialog`);
    const dlg = await js(`document.querySelector('#modeDlg').innerText`);
    assert.ok(/Durbar.s own checks still apply/.test(dlg) && /still tries the sandbox at each start/.test(dlg) && /Settings > Agent apps/.test(dlg), `${w}: the dialog says what it means: ${dlg}`);
    await js(`[...document.querySelectorAll('#modeDlg button')].find(b=>b.textContent==='Always continue').click()`);
    assert.ok(await until(`!document.getElementById('modeDlg')&&!![...document.querySelectorAll('#chat .note.sbx-note .sbx-done')].length`, 5000), `${w}: the note settles after the choice`);
    assert.ok(await until(`!document.querySelector('#chat .note.sbx-note .note-actions')`, 3000), `${w}: no buttons left on the settled note`);
    // ---- FR-012 (T031): Settings > Agent apps: one OS sandbox line per app; Always shown and undone there ----
    await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    assert.ok(await until(`!document.body.classList.contains('panel-open')`, 8000));
    await js(`document.getElementById('settingsBtn').click()`);
    assert.ok(await until(`document.querySelectorAll('.hs-sbx-line').length>=3`, 10000), `${w}: an OS sandbox line per app`);
    const lines = await js(`[...document.querySelectorAll('.hs-card')].map(c=>{const l=c.querySelector('.hs-sbx-line');return [c.dataset.kind,l?l.textContent:null,l?parseFloat(getComputedStyle(l).fontSize):0]})`);
    const by = Object.fromEntries(lines.map((x) => [x[0], x[1]]));
    assert.match(String(by.codex), /^OS sandbox: available \(bubblewrap\)$/, `${w}: codex line`);
    assert.match(String(by.claude), /^OS sandbox: not available: Claude Code has no OS sandbox on Windows/, `${w}: claude line`);
    assert.match(String(by.copilot), /^OS sandbox: not available: Copilot says/, `${w}: copilot line`);
    assert.ok(lines.every((x) => !x[1] || (x[1].length <= 230 && x[2] >= 10.5)), `${w}: short and legible: ${JSON.stringify(lines)}`);
    assert.ok(await js(`!!document.querySelector('.hs-card[data-kind="copilot"] .hs-sbx-fix')`), `${w}: the fix is named`);
    assert.ok(await until(`!!document.querySelector('.hs-card[data-kind="claude"] [data-hs="sbxundo"]')`, 5000), `${w}: the stored Always choice is shown with Undo`);
    await js(`document.querySelector('.hs-card[data-kind="claude"] .hs-sbx').scrollIntoView({block:'center'})`);
    await H.shot(path.join(OUT, `087-settings-sandbox-${w}x${h}.png`), { prep: 'mouse' });
    await js(`document.querySelector('.hs-card[data-kind="claude"] [data-hs="sbxundo"]').click()`);
    assert.ok(await until(`!document.querySelector('.hs-card[data-kind="claude"] [data-hs="sbxundo"]')&&!!document.querySelector('.hs-card[data-kind="claude"] .hs-sbx-line')`, 5000), `${w}: Undo removes the stored choice`);
    // ---- T070 (FR-022, FR-022b, FR-022e; issue #806): Restart without the sandbox, on the chat chip and in the mode menu only ----
    await H.load({ w, h, query: { simkinds: 'mixed' } });
    await js(`(()=>{const b=window.__durbarSimUi.bridge();window.__sbxCalls=[];if(!b.__sbxWrapped){b.__sbxWrapped=true;const s=b.agentMcpRestartSession;b.agentMcpRestartSession=(...x)=>{window.__sbxCalls.push(x);return s(...x);};}})()`);
    const RESTART_TIP = 'Copilot did not confirm turning its sandbox off in this running session, so it stays until a new one. Restart keeps this conversation and starts a new session in Allow all. ' + NOT_VERIFIED;
    const sbxBtn = () => js(`(()=>{const b=document.getElementById('sbxRestartBtn'),c=document.getElementById('modeChip');if(!b)return null;const r=b.getBoundingClientRect(),cs=getComputedStyle(b);return {tag:b.tagName,type:b.type,text:b.textContent,title:b.title,label:b.getAttribute('aria-label'),px:parseFloat(cs.fontSize),shown:r.width>0&&r.height>0&&r.right<=innerWidth+0.5,next:c&&c.nextElementSibling===b,chip:c?c.innerText.replace(/\\s+/g,' ').trim():''}})()`);
    await openAgent('sim-15');
    assert.ok(await until(`!!document.getElementById('sbxRestartBtn')`, 8000), `${w}: the kept floor in Allow all has the chip button`);
    const sb = await sbxBtn();
    assert.ok(sb.tag === 'BUTTON' && sb.type === 'button' && sb.next && sb.shown, `${w}: a real button right after the mode chip: ${JSON.stringify(sb)}`);
    assert.strictEqual(sb.text, 'Sandboxed (until a new session)', `${w}: the chip word, unchanged`);
    assert.ok(/^Allow all\b/.test(sb.chip) && !/Sandboxed/.test(sb.chip), `${w}: the mode chip keeps the mode: ${sb.chip}`);
    assert.strictEqual(sb.title, RESTART_TIP, `${w}: the tooltip says what Durbar does`);
    assert.ok(sb.title.length <= 300 && sb.px >= 10.5 && /Restart without the sandbox/.test(sb.label), `${w}: legible, named, tooltip within 300: ${JSON.stringify(sb)}`);
    await H.shot(path.join(OUT, `087-restart-nosbx-chip-${w}x${h}.png`), { prep: 'mouse' });
    // the mode menu item, under the three modes; keyboard reachable; Escape returns focus to the chip
    await js(`document.getElementById('modeChip').click()`);
    assert.ok(await until(`!!document.querySelector('#modeMenu [data-act="sbxRestart"]')`, 5000), `${w}: the mode menu has Restart without the sandbox`);
    const mi = await js(`(()=>{const m=document.getElementById('modeMenu'),b=m.querySelector('[data-act="sbxRestart"]'),it=[...m.querySelectorAll('[data-mode],[data-act],[data-op]')];return {title:b.title,role:b.getAttribute('role'),text:b.innerText.replace(/\\s+/g,' '),after:it.indexOf(b)===it.findIndex(x=>x.dataset.mode==='allow')+1,px:Math.min(...[...b.querySelectorAll('b,small')].map(x=>parseFloat(getComputedStyle(x).fontSize)))}})()`);
    assert.ok(mi.title === RESTART_TIP && mi.role === 'menuitem' && /^Restart without the sandbox/.test(mi.text) && mi.after && mi.px >= 10.5, `${w}: the menu item: ${JSON.stringify(mi)}`);
    await js(`document.getElementById('modeMenu').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`);
    assert.ok(await until(`(document.activeElement||{}).dataset&&document.activeElement.dataset.act==='sbxRestart'`, 3000), `${w}: ArrowDown from Allow all reaches the item`);
    await H.shot(path.join(OUT, `087-restart-nosbx-menu-${w}x${h}.png`), { prep: 'mouse' });
    await js(`document.getElementById('modeMenu').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    assert.ok(await until(`!document.getElementById('modeMenu')&&document.activeElement===document.getElementById('modeChip')`, 3000), `${w}: Escape closes the menu, focus back on the chip`);
    // AC4 + AC2: busy, grants and remote control on: the dialog's lines; Cancel changes nothing and calls nothing
    await js(`(()=>{const a=window.__durbarSimUi.agents().find(x=>x.id==='sim-15');a.remote={url:'',steerable:true,visibility:''};a.grants=[{kind:'shell',label:'npm',key:'shell:npm'}];})()`);
    await js(`window.__durbarSimEmit({type:'status',sessionId:'sim-15',timestamp:Date.now(),status:'working',intent:'Running the tests'})`);
    assert.ok(await until(`(window.__durbarSimUi.agents().find(x=>x.id==='sim-15')||{}).state==='working'`, 5000), `${w}: sim-15 is busy`);
    await js(`document.getElementById('sbxRestartBtn').click()`);
    assert.ok(await until(`!!document.querySelector('#modeDlg [aria-modal="true"]')`, 5000), `${w}: the shared dialog asks first`);
    const dl = await js(`(()=>{const d=document.getElementById('modeDlg');return {title:d.querySelector('h3').textContent,body:d.querySelector('#mdB').textContent,lines:[...d.querySelectorAll('#mdL li')].map(l=>l.textContent),btns:[...d.querySelectorAll('.dbtn button')].map(b=>b.textContent)}})()`);
    assert.strictEqual(dl.title, 'Restart ' + (await js(`window.__durbarSimUi.agents().find(x=>x.id==='sim-15').name`)) + ' without the OS sandbox?', `${w}: the title`);
    assert.ok(/^The conversation continues in a new session in Allow all\. Shell commands will no longer be limited to this folder and can reach the network\. Nothing is re-sent;/.test(dl.body), `${w}: the body: ${dl.body}`);
    for (const l of ['The conversation is kept and resuming spends no AI credits.', 'The running turn stops.', '"Approve for this session" grants are cleared.', 'Remote control turns off.', 'Its MCP servers start again with your next message.'])
      assert.ok(dl.lines.includes(l), `${w}: the line "${l}": ${JSON.stringify(dl.lines)}`);
    assert.deepStrictEqual(dl.btns, ['Cancel', 'Restart without the sandbox'], `${w}: the buttons`);
    assert.ok(!/MCP/.test(dl.title + dl.body + dl.btns.join(' ')), `${w}: no MCP restart wording in the title, body or buttons`);
    await H.shot(path.join(OUT, `087-restart-nosbx-dialog-${w}x${h}.png`), { prep: 'mouse' });
    await js(`[...document.querySelectorAll('#modeDlg .dbtn button')].find(b=>b.textContent==='Cancel').click()`);
    assert.ok(await until(`!document.getElementById('modeDlg')`, 3000), `${w}: Cancel closes it`);
    await ctx.sleep(300); // nothing is expected to happen: give a wrong call time to show
    assert.deepStrictEqual(await js(`window.__sbxCalls.length`), 0, `${w}: Cancel calls nothing`);
    assert.ok((await sbxBtn()) && /Sandboxed \(until a new session\)/.test((await sbxBtn()).text), `${w}: Cancel keeps the chip and its button`);
    // confirm: the existing restart, reason 'sandbox'; the chip loses its word and the action goes
    await js(`window.__durbarSimEmit({type:'status',sessionId:'sim-15',timestamp:Date.now(),status:'idle',intent:'Ready'})`);
    await js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove())`);
    await js(`document.getElementById('sbxRestartBtn').click()`);
    assert.ok(await until(`!!document.querySelector('#modeDlg [aria-modal="true"]')`, 5000), `${w}: an idle agent is asked too (always)`);
    await js(`[...document.querySelectorAll('#modeDlg .dbtn button')].find(b=>b.textContent==='Restart without the sandbox').click()`);
    assert.ok(await until(`/session restarted without the OS sandbox\\./.test([...document.querySelectorAll('#toasts .toast')].map(x=>x.textContent).join(' '))`, 8000), `${w}: the toast says it`);
    assert.deepStrictEqual(await js(`window.__sbxCalls.map(c=>[c[0],c[1],c[2]])`), [['sim-15', true, 'sandbox']], `${w}: one call on the existing channel, confirmed, reason sandbox`);
    assert.ok(!/MCP/.test(await js(`[...document.querySelectorAll('#toasts .toast')].map(x=>x.textContent).join(' ')`)), `${w}: no MCP wording in the toast`);
    assert.ok(await until(`!document.getElementById('sbxRestartBtn')&&/^Allow all\\b/.test(document.getElementById('modeChip').innerText.trim())&&!/Sandbox/.test(document.getElementById('modeChip').innerText)`, 8000), `${w}: after the restart: Allow all with no word and no action`);
    await js(`document.getElementById('modeChip').click()`);
    assert.ok(await until(`!!document.getElementById('modeMenu')`, 3000));
    assert.ok(!(await js(`!!document.querySelector('#modeMenu [data-act="sbxRestart"]')`)), `${w}: and no menu item`);
    await js(`document.getElementById('modeMenu').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    assert.ok(await until(`!document.getElementById('modeMenu')`, 3000));
    // AC1: never on the office card's menu
    await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    assert.ok(await until(`!document.body.classList.contains('panel-open')`, 8000));
    // FR-022c (T072 AC2, replaces FR-022e's sentence): Copilot Ask first with the floor (sim-2): no action; the Allow all dialog says the sandbox is
    // also turned off; after the switch (the sim's lowering resolves) Allow all with no word and no action
    await openAgent('sim-2');
    assert.ok(!(await js(`!!document.getElementById('sbxRestartBtn')`)), `${w}: Copilot in Ask first: no action`);
    const allowDlg = async (id) => {
      await js(`document.getElementById('modeChip').click()`);
      assert.ok(await until(`!!document.querySelector('#modeMenu [data-mode="allow"]')`, 5000), `${w}: ${id} mode menu`);
      assert.ok(!(await js(`!!document.querySelector('#modeMenu [data-act="sbxRestart"]')`)), `${w}: ${id}: no Restart without the sandbox before Allow all`);
      await js(`document.querySelector('#modeMenu [data-mode="allow"]').click()`);
      assert.ok(await until(`!!document.querySelector('#modeDlg [aria-modal="true"]')`, 5000), `${w}: ${id}: the Allow all dialog`);
      return js(`document.querySelector('#modeDlg #mdB').textContent`);
    };
    const OFF = 'Copilot’s OS sandbox is also turned off for this session.';
    const cpBody = await allowDlg('sim-2');
    assert.ok(cpBody.endsWith(' ' + OFF), `${w}: Copilot's Allow all dialog says the sandbox is also turned off: ${cpBody}`);
    assert.ok(!/stays on for shell commands/.test(cpBody), `${w}: FR-022e's sentence is gone: ${cpBody}`);
    await js(`[...document.querySelectorAll('#modeDlg .dbtn button')].find(b=>b.textContent==='Allow all').click()`);
    assert.ok(await until(`/^Allow all\\b/.test(((document.getElementById('modeChip')||{}).innerText||'').trim())&&!/Sandbox/.test(document.getElementById('modeChip').innerText)&&!document.getElementById('sbxRestartBtn')`, 8000), `${w}: after the switch the floor is off: Allow all with no word and no action`);
    for (const [id, app] of [['sim-1', 'Claude'], ['sim-10', 'Codex']]) {
      await openAgent(id);
      const body = await allowDlg(id);
      assert.ok(!/OS sandbox (stays on|is also turned off)/.test(body), `${w}: ${app}: today's Allow all text: ${body}`);
      await js(`[...document.querySelectorAll('#modeDlg .dbtn button')].find(b=>b.textContent==='Allow all').click()`);
      assert.ok(await until(`/^Allow all/.test((document.getElementById('modeChip')||{}).innerText||'')`, 8000), `${w}: ${app} is in Allow all`);
      await ctx.sleep(200); // the sandbox event follows the switch in the simulator; give a wrong button time to show
      assert.ok(!(await js(`!!document.getElementById('sbxRestartBtn')`)), `${w}: ${app} never shows the action`);
    }
    // review on PR #833 (item 4): simsbxlower=refuse: Copilot refuses the lowering: the floor is kept with its action, and a calm toast says so
    await H.load({ w, h, query: { simkinds: 'mixed', simsbxlower: 'refuse' } });
    await openAgent('sim-2');
    const rBody = await allowDlg('sim-2');
    assert.ok(rBody.endsWith(' ' + OFF), `${w}: refused case: the dialog said it is turned off: ${rBody}`);
    await js(`[...document.querySelectorAll('#modeDlg .dbtn button')].find(b=>b.textContent==='Allow all').click()`);
    const NOT_LOWERED = 'Copilot did not turn its sandbox off; use Restart without the sandbox.';
    assert.ok(await until(`[...document.querySelectorAll('#toasts .toast')].some(t=>t.textContent===${jsLiteral(NOT_LOWERED)})`, 8000), `${w}: the toast after a refused lowering`);
    assert.ok(await until(`!!document.getElementById('sbxRestartBtn')&&/Sandboxed \\(until a new session\\)/.test(document.getElementById('modeChip').innerText+document.getElementById('sbxRestartBtn').textContent)`, 8000), `${w}: refused: the kept floor and its action`);
    for (const [id, app] of [['sim-1', 'Claude']]) {
      await openAgent(id);
      await allowDlg(id);
      await js(`[...document.querySelectorAll('#modeDlg .dbtn button')].find(b=>b.textContent==='Allow all').click()`);
      assert.ok(await until(`/^Allow all/.test((document.getElementById('modeChip')||{}).innerText||'')`, 8000), `${w}: ${app} is in Allow all`);
      await ctx.sleep(200);
      assert.strictEqual(await js(`[...document.querySelectorAll('#toasts .toast')].filter(t=>t.textContent===${jsLiteral(NOT_LOWERED)}).length`), 1, `${w}: ${app}: no second toast`);
    }
    // managed (sim-6, Claude Code here; Copilot in the default roster below): no action
    await openAgent('sim-6');
    assert.ok(await until(`/Sandboxed \\(managed\\)/.test(document.getElementById('modeChip').innerText)`, 5000) && !(await js(`!!document.getElementById('sbxRestartBtn')`)), `${w}: managed: no action`);
    // the default roster: every agent is Copilot; sim-6 is Allow all · Sandboxed (managed): no action; the office card's menu never has it
    await H.load({ w, h, query: {} });
    await openAgent('sim-6');
    assert.ok(await until(`/Allow all · Sandboxed \\(managed\\)/.test(document.getElementById('modeChip').innerText.replace(/\\s+/g,' '))`, 5000), `${w}: Copilot managed`);
    assert.ok(!(await js(`!!document.getElementById('sbxRestartBtn')`)), `${w}: Copilot managed: no action`);
    await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    assert.ok(await until(`!document.body.classList.contains('panel-open')`, 8000));
    await js(`(()=>{const d=document.querySelector('#stage .desk[data-id="sim-15"]');const r=d.getBoundingClientRect();d.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+20,clientY:r.top+20}))})()`);
    assert.ok(await until(`!!document.getElementById('modeMenu')`, 5000), `${w}: the office card's menu opens`);
    assert.ok(!(await js(`!!document.querySelector('#modeMenu [data-act="sbxRestart"]')`)), `${w}: the office card's menu has no Restart without the sandbox (Q3)`);
    await js(`document.getElementById('modeMenu').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    assert.ok(await until(`!document.getElementById('modeMenu')`, 3000));
    await openAgent('sim-15');
    assert.ok(await until(`!!document.getElementById('sbxRestartBtn')`, 8000), `${w}: the default roster's kept floor (sim-15) has it in the chat`);
    // review on PR 823 (question 1): End session (the card menu) ends the kept floor too: an ended agent does not claim "until a new session"
    await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    assert.ok(await until(`!document.body.classList.contains('panel-open')`, 8000));
    await js(`(()=>{const d=document.querySelector('#stage .desk[data-id="sim-15"]');const r=d.getBoundingClientRect();d.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+20,clientY:r.top+20}))})()`);
    assert.ok(await until(`!!document.querySelector('#modeMenu [data-op="end"]')`, 5000), `${w}: the card menu has End session`);
    await js(`document.querySelector('#modeMenu [data-op="end"]').click()`);
    if (await until(`!!document.querySelector('#modeDlg [aria-modal="true"]')`, 1500)) await js(`[...document.querySelectorAll('#modeDlg .dbtn button')].find(b=>b.textContent==='End session').click()`);
    assert.ok(await until(`(()=>{const a=window.__durbarSimUi.agents().find(x=>x.id==='sim-15');return !!a&&!!a.info&&!a.info.sandbox})()`, 8000), `${w}: End session clears the kept floor`);
    await openAgent('sim-15');
    assert.ok(await until(`/^Allow all/.test(document.getElementById('modeChip').innerText.trim())&&!/Sandbox/.test(document.getElementById('modeChip').innerText)&&!document.getElementById('sbxRestartBtn')`, 8000), `${w}: after End session: Allow all, no word, no action`);
  }
  console.log('[087-sandbox] PASS');
};
