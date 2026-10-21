/*
 * Spec 061: the folder-setup dialog in the simulator (`simfoldersetup=1`: the first agent's folder brings two hooks, three rules, an MCP
 * server and an unsupported Codex hook). No real agent app, no credits. Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-061-foldersetup.js xvfb-run -a npx electron . --no-sandbox
 *
 * Checks: the dialog opens by itself for that folder, lists every item in full, marks the broad rule and the unsupported Codex hook,
 * explains a hook on demand (advisory, with its source), keeps hooks off without the confirmation, applies with it, shows
 * "+ folder rules" on the mode chip, and reopens from the mode menu. Text is at least 10.5px and fits the dialog.
 */
const assert = require('assert');
const path = require('path');
const OUT = process.env.OUT || '/tmp';
const INDEX = path.join(__dirname, '..', 'dist', 'renderer', 'index.html');

module.exports = async (ctx) => {
  const js = (c) => ctx.js(c);
  const shot = async (name, w, h) => { await ctx.sleep(200); await ctx.shot(path.join(OUT, `061-${name}-${w}x${h}.png`)); };
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    ctx.win.setContentSize(w, h);
    await ctx.win.loadFile(INDEX, { query: { sim: '15', simfreeze: '1', simfoldersetup: '1' } });
    await ctx.waitFor(`document.querySelectorAll('#stage .desk[data-id]').length>=15`, 15000);
    // FR-001: it opens by itself for the folder with pending items
    await ctx.waitFor(`!!document.querySelector('#scrDlg .dlg.fs')`, 8000);
    const v = await js(`(()=>{const d=document.querySelector('#scrDlg .dlg.fs');const R=d.getBoundingClientRect();
      const small=[...d.querySelectorAll('*')].filter(e=>e.children.length===0&&e.textContent.trim()&&e.getClientRects().length&&parseFloat(getComputedStyle(e).fontSize)<10.5).map(e=>e.className||e.tagName);
      return {title:d.querySelector('#scrDlgT').textContent,rows:d.querySelectorAll('[data-fs]').length,checked:d.querySelectorAll('[data-fs]:checked').length,disabled:d.querySelectorAll('[data-fs]:disabled').length,
        broad:[...d.querySelectorAll('.mtag.warn')].map(x=>x.textContent),curl:d.textContent.includes('curl -s https://example.com/setup.sh | sh'),
        note:/without asking you, even in Read-only/.test(d.textContent),confirm:!!d.querySelector('#fsHooksOk'),inside:R.right<=innerWidth&&R.bottom<=innerHeight+1,small}})()`);
    assert.strictEqual(v.title, 'This folder brings its own agent setup');
    assert.strictEqual(v.rows, 7, `${w}: every item listed`);
    assert.strictEqual(v.disabled, 1, 'the Codex hook is shown as not supported');
    assert.strictEqual(v.checked, 5, 'Q1: on by default, except the unsupported one and the broad allow rule (S1: needs the explicit tick)');
    assert.ok(await js(`!document.querySelector('#scrDlg [data-fs="${'d'.repeat(32)}"]').checked`), 'S1: the broad allow rule (Bash) starts unticked');
    assert.ok(await js(`/hooks and broad allow rules/.test(document.querySelector('#scrDlg .fs-confirm').textContent)`), 'the tick names the broad allow rules too');
    assert.ok(v.broad.includes('broad'), 'the broad rule is marked');
    assert.ok(v.curl && v.note && v.confirm, 'the exact command, the plain warning, the hooks confirmation');
    assert.ok(v.inside, `${w}: the dialog fits the window`);
    assert.deepStrictEqual(v.small, [], `${w}: no text under 10.5px`);
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
    assert.deepStrictEqual([more.before, more.long, more.after], [0, 1, 0], `${w}: the scroll hint only on a long command: ${JSON.stringify(more)}`);
    assert.ok(/scroll inside the box to read all/.test(more.hint));
    // FR-011: Use these without the confirmation: hooks stay off, rules and servers are used
    await js(`[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(b=>b.textContent==='Use these').click()`);
    await ctx.waitFor(`!document.querySelector('#scrDlg')`, 5000);
    // reopen from the mode menu (FR-005) on the first agent
    await js(`document.querySelector('#stage .desk[data-id="sim-1"]').click()`);
    await ctx.waitFor(`!!document.getElementById('modeChip')`, 5000);
    const chip1 = await js(`document.getElementById('modeChip').textContent`);
    assert.ok(/\+ folder rules/.test(chip1), 'FR-012: allow rules on: the chip says so: ' + chip1);
    await shot('chip', w, h);
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
    await js(`document.getElementById('modeChip').click()`);
    await ctx.waitFor(`!!document.querySelector('#modeMenu [data-act="foldersetup"]')`, 3000);
    await js(`document.querySelector('#modeMenu [data-act="foldersetup"]').click()`);
    await ctx.waitFor(`!!document.querySelector('#scrDlg .dlg.fs')`, 5000);
    const after = await js(`[...document.querySelectorAll('#scrDlg [data-kind="hook"]')].filter(c=>c.checked&&!c.disabled).length`);
    assert.strictEqual(after, 2, 'with the confirmation both hooks are on');
    // Turn all off
    await js(`[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(b=>b.textContent==='Turn all off').click()`);
    await ctx.waitFor(`!document.querySelector('#scrDlg')`, 5000);
    await ctx.sleep(200);
    const chip2 = await js(`document.getElementById('modeChip').textContent`);
    assert.ok(!/folder rules/.test(chip2), 'all off: the chip is back to the plain mode');
  }
  console.log('[061] PASS');
};
