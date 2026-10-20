/*
 * Spec 051 (harness setup inside the app): simulator checks and screenshots at 1440x900 and 1280x800. Nothing is installed and no
 * real sign-in runs (the simulator plays canned output).
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-051-setup.js xvfb-run -a npx electron . --no-sandbox
 *
 * Checks: Settings > Agent apps shows one card per agent app with its state (Ready / Not installed / Update needed); Install shows the
 * exact commands before anything runs and finishes; the sign-in dialog shows the link button and the one-time code. Prints "[051] PASS".
 */
const assert = require('assert');
const path = require('path');
const { waits } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';
const INDEX = path.join(process.cwd(), 'dist', 'renderer', 'index.html');

module.exports = async (ctx) => {
  const { until, settle } = waits(ctx); // spec 008 FR-096: wait for the page, not a fixed time
  const js = (c) => ctx.js(c);
  const shot = async (name) => { ctx.win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 }); await ctx.sleep(150); await ctx.shot(path.join(OUT, name)); console.log('[051] saved', name); };
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    ctx.win.setContentSize(w, h);
    await ctx.win.loadFile(INDEX, { query: { sim: '15', simfreeze: '1', simkinds: 'solo' } });
    await ctx.waitFor(`document.getElementById('stage')&&document.getElementById('stage').dataset.fit`, 15000);
    await settle();
    await js(`document.getElementById('settingsBtn').click()`); await until(`document.querySelectorAll('.hs-card').length===3&&[...document.querySelectorAll('.hs-card .hs-st')].every(s=>s.textContent&&!/Checking/i.test(s.textContent))`); await settle();
    const cards = await js(`[...document.querySelectorAll('.hs-card')].map(c=>({kind:c.dataset.kind,st:c.querySelector('.hs-st').textContent,act:[...c.querySelectorAll('[data-hs]')].map(b=>b.textContent)}))`);
    assert.deepStrictEqual(cards.map((c) => c.kind), ['copilot', 'claude', 'codex'], 'one card per harness: ' + JSON.stringify(cards));
    assert.deepStrictEqual(cards.map((c) => c.st), ['Ready', 'Not installed', 'Update needed']);
    assert.ok(cards[1].act.includes('Install…') && cards[2].act.includes('Update…'), 'one next step each');
    assert.strictEqual(await js(`document.getElementById('hsH').textContent`), 'Agent apps', 'the section is called Agent apps (spec 052 FR-051)');
    await js(`document.getElementById('hsH').scrollIntoView()`); await settle();
    await shot(`051-harnesses-${w}x${h}.png`);
    // Install: the exact commands first
    await js(`document.querySelector('.hs-card[data-kind="claude"] [data-hs="install"]').click()`); await until(`document.querySelectorAll('#hsDlg .hs-cmds code').length>0`);
    const plans = await js(`[...document.querySelectorAll('#hsDlg .hs-cmds code')].map(c=>c.textContent)`);
    assert.ok(plans.length === 2 && /brew install --cask claude-code/.test(plans[0]), 'the commands are shown before they run: ' + plans.join(' | '));
    await shot(`051-install-plan-${w}x${h}.png`);
    await js(`[...document.querySelectorAll('#hsDlg .btn')].find(b=>b.textContent==='Install').click()`); await until(`!!document.getElementById('hsLog')`);
    assert.ok(await js(`!!document.getElementById('hsLog')`), 'the progress dialog shows the output');
    await until(`!document.getElementById('hsDlg')`, 15000);
    assert.ok(await js(`!document.getElementById('hsDlg')`), 'it closes when the install ends');
    // Sign-in: link and code
    await js(`(()=>{const b=document.createElement('button');b.dataset.hs='signin';b.dataset.kind='codex';b.innerHTML='<span>x</span>';const c=document.querySelector('.hs-card[data-kind="codex"]');c.appendChild(b);b.click();b.remove();})()`); await until(`!!document.getElementById('hsDlg')&&(document.getElementById('hsCode')||{}).textContent==='SIM1-ABCDE'`);
    const sign = await js(`({open:!!document.getElementById('hsDlg'),link:!!document.getElementById('hsOpen')&&!document.getElementById('hsSign').hidden,code:(document.getElementById('hsCode')||{}).textContent})`);
    assert.ok(sign.open && sign.link && sign.code === 'SIM1-ABCDE', 'the sign-in shows the link and the code: ' + JSON.stringify(sign));
    await shot(`051-signin-${w}x${h}.png`);
    await js(`[...document.querySelectorAll('#hsDlg .btn')].find(b=>b.textContent==='Cancel').click()`); await until(`!document.getElementById('hsDlg')`);
    console.log('[051]', w, JSON.stringify(cards.map((c) => c.st)));
  }
  console.log('[051] PASS');
};
