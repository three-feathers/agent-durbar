/*
 * Spec 051 (harness setup inside the app): simulator checks and screenshots at 1440x900 and 1280x800. Nothing is installed and no
 * real sign-in runs (the simulator plays canned output).
 *
 *   npm run build
 *   (add DURBAR_SIM_PLATFORM=win32 for Windows' routes and commands on any OS, spec 060 FR-011)
 *   OUT=docs/screenshots DURBAR_SIM_MANAGERS=winget,brew,npm DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-051-setup.js xvfb-run -a npx electron . --no-sandbox
 *
 * Checks: Settings > Agent apps shows one card per agent app with its state (Ready / Not installed / Update needed); Install shows the
 * exact commands before anything runs and finishes; the sign-in dialog shows the link button and the one-time code. Prints "[051] PASS".
 */
const assert = require('assert');
const path = require('path');
const { helpers } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';
// spec 060 FR-011: DURBAR_SIM_PLATFORM=win32 shows Windows' routes and commands on any OS (screenshots get a -win32 suffix)
const OS = ['win32', 'darwin', 'linux'].includes(process.env.DURBAR_SIM_PLATFORM) ? process.env.DURBAR_SIM_PLATFORM : process.platform;
const SFX = OS !== process.platform ? '-' + OS : '';

module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-096/097: shared plumbing, waits for the page instead of a fixed time
  const { until, settle, js } = H;
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'mouse', tag: '051' });
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, query: { simkinds: 'solo' }, ready: 'fit' });
    await js(`document.getElementById('settingsBtn').click()`); await until(`document.querySelectorAll('.hs-card').length===3&&[...document.querySelectorAll('.hs-card .hs-st')].every(s=>s.textContent&&!/Checking/i.test(s.textContent))`); await settle();
    const cards = await js(`[...document.querySelectorAll('.hs-card')].map(c=>({kind:c.dataset.kind,st:c.querySelector('.hs-st').textContent,act:[...c.querySelectorAll('[data-hs]')].map(b=>b.textContent)}))`);
    assert.deepStrictEqual(cards.map((c) => c.kind), ['copilot', 'claude', 'codex'], 'one card per harness: ' + JSON.stringify(cards));
    assert.deepStrictEqual(cards.map((c) => c.st), ['Ready', 'Not installed', 'Update needed']);
    assert.ok(cards[1].act.includes('Install…') && cards[2].act.includes('Update…'), 'one next step each');
    // spec 060 FR-003: where an installed app was found (home shortened to ~); nothing for an app that is not installed
    const where = await js(`[...document.querySelectorAll('.hs-card')].map(c=>(c.querySelector('.hs-where')||{}).textContent||'')`);
    assert.deepStrictEqual(where, ['', '', 'Found at ~/.nvm/versions/node/v22.3.0/bin/codex'], 'Found at: ' + JSON.stringify(where));
    assert.ok(await js(`(()=>{const c=document.querySelector('.hs-card[data-kind="codex"]'),w=c.querySelector('.hs-where');return w.getBoundingClientRect().right<=c.getBoundingClientRect().right+0.5&&parseFloat(getComputedStyle(w.querySelector('code')).fontSize)>=10.5})()`), 'the path stays inside its card, at least 10.5px');
    assert.strictEqual(await js(`document.getElementById('hsH').textContent`), 'Agent apps', 'the section is called Agent apps (spec 052 FR-051)');
    await js(`document.getElementById('hsH').scrollIntoView()`); await settle();
    await shot(`051-harnesses-${w}x${h}.png`);
    // Install: the exact commands first
    await js(`document.querySelector('.hs-card[data-kind="claude"] [data-hs="install"]').click()`); await until(`document.querySelectorAll('#hsDlg .hs-cmds:not(.hs-manual) code').length>0`);
    const plans = await js(`[...document.querySelectorAll('#hsDlg .hs-cmds:not(.hs-manual) code')].map(c=>c.textContent)`);
    // spec 060 FR-002: the routes are the real ones for this OS (the suite runs this driver with DURBAR_SIM_MANAGERS=winget,brew,npm)
    const first = OS === 'win32' ? /^winget install --id Anthropic\.ClaudeCode/ : /^brew install --cask claude-code/;
    assert.ok(plans.length === 2 && first.test(plans[0]) && /^npm install -g @anthropic-ai\/claude-code/.test(plans[1]), 'the commands are shown before they run: ' + plans.join(' | '));
    assert.ok(OS === 'win32' ? !plans.some((p) => /^brew /.test(p)) : !plans.some((p) => /^winget /.test(p)), 'no other OS\'s package manager is offered');
    await shot(`051-install-plan${SFX}-${w}x${h}.png`);
    // spec 060 FR-009: the vendor's own commands, to copy and run yourself, labelled for this OS, each with a Copy button
    await js(`document.querySelector('#hsDlg .hs-manual').open=true`); await settle();
    const man = await js(`[...document.querySelectorAll('#hsDlg .hs-man')].map(r=>({l:r.querySelector('.hs-man-l').firstChild.textContent.trim(),c:r.querySelector('code').textContent,b:!!r.querySelector('button.cp-btn.cp-code')}))`);
    const want = OS === 'win32' ? ['PowerShell', 'PowerShell (winget)', 'npm'] : ['Terminal', 'Homebrew', 'npm'];
    assert.deepStrictEqual(man.map((m) => m.l), want, 'manual commands for ' + OS + ': ' + JSON.stringify(man));
    assert.ok(man.every((m) => m.b), 'each has a Copy button');
    if (OS === 'win32') assert.deepStrictEqual(man.map((m) => m.c), ['irm https://claude.ai/install.ps1 | iex', 'winget install Anthropic.ClaudeCode', 'npm install -g @anthropic-ai/claude-code']);
    assert.ok(await js(`[...document.querySelectorAll('#hsDlg .hs-man')].every(r=>{const b=r.querySelector('.cp-btn').getBoundingClientRect(),c=r.querySelector('code').getBoundingClientRect(),o=r.getBoundingClientRect();return b.right<=o.right+0.5&&c.right<=b.left+0.5&&parseFloat(getComputedStyle(r.querySelector('code')).fontSize)>=10.5})`), 'Copy sits beside the command, inside its row, text at least 10.5px');
    // the shared Copy handler (app.js .cp-btn) copies the row's command; it says "Copied ✓" (or shows an error toast if the clipboard refuses)
    // the label goes back to "Copy" after 1200 ms, which a slow runner can miss: a MutationObserver records that it said "Copied ✓"
    await js(`(()=>{const b=document.querySelector('#hsDlg .hs-man .cp-btn');window.__hsCopied=false;new MutationObserver(()=>{if(b.textContent==='Copied ✓')window.__hsCopied=true;}).observe(b,{childList:true,characterData:true,subtree:true});b.click();})()`);
    await until(`window.__hsCopied||!!document.querySelector('.toast.err')`);
    // the shared handler answered: "Copied ✓", or its "Could not copy" toast when a runner's window has no clipboard focus
    const cp = await js(`({ok:window.__hsCopied,err:((document.querySelector('.toast.err')||{}).textContent||'')})`);
    assert.ok(cp.ok || /Could not copy/.test(cp.err), 'Copy is wired to the shared copy handler: ' + JSON.stringify(cp));
    if (!cp.ok) console.log('[051] clipboard refused on this runner:', cp.err);
    await js(`document.querySelector('#hsDlg .hs-dlg-scroll, #hsDlg .dbody').scrollTop=1e6`); await settle();
    await shot(`051-install-manual${SFX}-${w}x${h}.png`);
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
