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
 * wait is an until(); prints "[087-sandbox] PASS".
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';
const NOT_VERIFIED = 'Requested; not verified on a real session.';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until, settle } = H;
  const chip = () => js(`(()=>{const c=document.getElementById('modeChip');if(!c)return null;const s=c.querySelector('.mode-sbx');return {text:c.innerText.replace(/\\s+/g,' ').trim(),title:c.title,px:s?parseFloat(getComputedStyle(s).fontSize):0,inBox:(()=>{if(!s)return false;const r=s.getBoundingClientRect(),R=c.getBoundingClientRect();return r.right<=R.right+0.5&&r.left>=R.left-0.5&&r.width>0})()}})()`);
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
    assert.ok(await until(`(()=>{const c=document.getElementById('modeChip');return !!c&&${re}.test(c.innerText.replace(/\\s+/g,' '))})()`, 8000), `${w}: ${id} chip ${re}: ${JSON.stringify(await chip())}`);
    const c = await chip();
    assert.ok(c.px >= 10.5 && c.inBox, `${w}: ${id}: the segment is legible text inside the chip: ${JSON.stringify(c)}`);
    assert.ok(more(c), `${w}: ${id}: tooltip ${c.title}`);
    return c;
  };
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, query: { simkinds: 'mixed', simsendfail: 'sandbox-choice' } });
    // ---- FR-009/FR-010: each state, in words; the tooltip says what is covered and how far it was checked ----
    const ada = await expectChip(w, 'sim-1', /Read-only · Sandboxed\b/, (c) => c.title.endsWith(NOT_VERIFIED) && /MCP servers, file reads and edits are checked by Durbar, not the OS/.test(c.title) && /writes: none, network: off/.test(c.title));
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
    await expectChip(w, 'sim-13', /Read-only · Sandbox: checking/, (c) => /confirms its sandbox when it starts/.test(c.title));
    await expectChip(w, 'sim-11', /Ask first · Not sandboxed/, (c) => /Not sandboxed\. Copilot says this computer cannot run its sandbox/.test(c.title) && /Durbar.s own checks still apply/.test(c.title));
    await expectChip(w, 'sim-6', /Allow all · Sandboxed \(managed\)/, (c) => /Your organization keeps/.test(c.title));
    await expectChip(w, 'sim-15', /Allow all · Sandboxed \(until a new session\)/, (c) => /stays until a new session/.test(c.title) && /Shell commands and MCP servers run in bubblewrap/.test(c.title));
    // ---- FR-021 (T022 AC3): Codex Ask first: the card's sandbox line, whole; the chip tooltip says it too ----
    await expectChip(w, 'sim-8', /Ask first · Sandboxed/, (c) => /If you approve a command, Codex may run it outside the sandbox/.test(c.title) && /Commands and file changes run in the Codex sandbox/.test(c.title));
    assert.ok(await until(`!!document.querySelector('#chat .note.perm.pending .psbx')`, 8000), `${w}: Codex's waiting card has its sandbox line`);
    const psbx = await js(`(()=>{const p=document.querySelector('#chat .note.perm.pending .psbx');p.scrollIntoView({block:'nearest'});const n=p.closest('.note').getBoundingClientRect(),r=p.getBoundingClientRect(),cs=getComputedStyle(p);return {text:p.textContent,whole:p.scrollWidth<=p.clientWidth+0.5&&cs.textOverflow!=='ellipsis',inside:r.right<=n.right+0.5&&r.left>=n.left-0.5,px:parseFloat(cs.fontSize),sum:p.closest('.note').querySelector('.psum').textContent}})()`);
    assert.strictEqual(psbx.text, 'If you approve, Codex may run this outside its sandbox.', `${w}: the exact line`);
    assert.ok(psbx.whole && psbx.inside && psbx.px >= 10.5, `${w}: the line is whole and legible: ${JSON.stringify(psbx)}`);
    assert.ok(!/sandbox/.test(psbx.sum), `${w}: the summary itself is unchanged`);
    await H.shot(path.join(OUT, `087-codex-card-${w}x${h}.png`), { prep: 'mouse' });
    // ---- the card's mode icon tooltip (no new word on the office card: decision Q5) ----
    await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    assert.ok(await until(`!document.body.classList.contains('panel-open')`, 8000));
    const deskTip = await js(`(()=>{const d=document.querySelector('#stage .desk[data-id="sim-1"]');const m=d&&d.querySelector('.modeic,.modebadge');return {title:m?m.title:'',words:/Sandbox/.test(d?d.innerText:'')}})()`);
    assert.ok(/Sandboxed\. Shell commands run in/.test(deskTip.title), `${w}: the card's mode icon tooltip: ${deskTip.title}`);
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
  }
  console.log('[087-sandbox] PASS');
};
