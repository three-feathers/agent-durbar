/*
 * Spec 081 (agent-app updates): simulator checks and screenshots at 1440x900 and 1280x800. Nothing is contacted, nothing is installed:
 * the simulator plays canned check results (`simupd=avail|mixed|off`), canned update runs (`simupdrun=ok|managed|admin|fallback|uptodate`)
 * and pretend open sessions (`simsessions=2`). Every wait is a condition (`until`), never a fixed sleep.
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-081-updates.js xvfb-run -a npx electron . --no-sandbox
 *
 * Checks: the cards show "Installed x . source" and Latest after Check for updates; the chip says a word; the start-check switch;
 * Update shows the owner route first and "Show other ways"; the open-sessions dialog (wait / end / cancel); the waiting line;
 * a finished update; Managed, admin and the Codex fallback advice; the organization's "Turned off" word; the office is not
 * delayed (SC-007). Prints "[081] PASS".
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'mouse', tag: '081' });
  const settings = async () => { await js(`document.getElementById('settingsBtn').click()`); await until(`document.querySelectorAll('.hs-card').length===3`); await settle(); };
  const card = (k) => `.hs-card[data-kind="${k}"]`;
  const dlgBtn = (label) => js(`(()=>{const b=[...document.querySelectorAll('#hsDlg .btn')].find(x=>x.textContent.trim()===${jsLiteral(label)});if(!b)return false;b.click();return true})()`);
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    // ---- SC-007: the office is shown before anything about updates matters (the simulator never checks by itself)
    await H.load({ w, h, query: { simkinds: '1', simupd: 'avail' }, ready: 'fit' });
    assert.ok(await js(`document.querySelectorAll('#stage .desk[data-id]').length>=15`), 'the office is shown');
    assert.strictEqual(await js(`document.querySelector('#settingsBtn .upd-badge')`), null, 'no badge before anything was checked');
    await settings();
    assert.ok(await js(`/Not checked/.test(document.querySelector(${jsLiteral(card('claude'))}).textContent)`), 'nothing is checked until the user asks (the simulator never checks by itself)');

    // ---- the start check found updates (simupdstart): a badge with a number on the Settings entry and one toast, no window opened
    await H.load({ w, h, query: { simkinds: '1', simupd: 'avail', simupdstart: '1' }, ready: 'fit' });
    await until(`(document.querySelector('#settingsBtn .upd-badge')||{}).textContent==='2'`);
    await until(`/Codex 0\.164\.0 is available/.test(document.getElementById('toasts').textContent)`);
    assert.strictEqual(await js(`document.querySelectorAll('#toasts .toast').length`), 1, 'one toast');
    await shot(`081-updates-badge-${w}x${h}.png`);
    await H.load({ w, h, query: { simkinds: '1', simupd: 'avail' }, ready: 'fit' });
    await settings();
    // ---- Check for updates: results, chips with a word, the latest line, the time, the badge with a number
    await js(`document.querySelector('[data-hs="checkall"]').click()`);
    await until(`document.querySelector(${jsLiteral(card('claude'))}+' .hs-upd .hs-st')&&/Update available/.test(document.querySelector(${jsLiteral(card('claude'))}+' .hs-upd').textContent)`);
    await settle();
    const t = await js(`({claude:document.querySelector(${jsLiteral(card('claude'))}+' .hs-upd').textContent,codex:document.querySelector(${jsLiteral(card('codex'))}+' .hs-upd').textContent,copilot:document.querySelector(${jsLiteral(card('copilot'))}+' .hs-upd').textContent,badge:(document.querySelector('#settingsBtn .upd-badge')||{}).textContent})`);
    assert.match(t.claude, /Update available.*Installed 2\.1\.300 · the official installer/);
    assert.match(t.claude, /Latest 2\.1\.309 · stable 2\.1\.308/);
    assert.match(t.codex, /Latest 0\.164\.0 \(as Homebrew knows it\)/);
    assert.match(t.copilot, /Copilot runtime 1\.0\.22, bundled with Durbar \(updates with Durbar\)/);
    assert.match(t.copilot, /GitHub Copilot CLI 1\.0\.103 · Homebrew \(used to sign in\)/);
    assert.match(t.copilot, /Up to date/);
    assert.ok(/Checked \d/.test(t.claude), 'the time of the check');
    assert.strictEqual(t.badge, '2', 'a number on the Settings entry, not only a colour');
    assert.match(await js(`document.getElementById('settingsBtn').getAttribute('aria-label')`), /2 agent app updates available/);
    assert.ok(await js(`!!document.querySelector('[data-hs="startchk"]:checked')`), 'the start-check switch is on by default');
    assert.match(await js(`document.getElementById('hsBar').textContent`), /Check for updates when Durbar starts[\s\S]*checks for updates each time it starts/);
    assert.ok(await js(`[...document.querySelectorAll('.hs-card .hs-upd, .hs-bar')].every(e=>{const f=parseFloat(getComputedStyle(e).fontSize);return f>=10.5})`), 'text is at least 10.5px');
    await js(`document.getElementById('hsH').scrollIntoView()`); await settle();
    await shot(`081-updates-avail-${w}x${h}.png`);
    // a hostile value would be escaped: nothing in the cards is markup
    assert.strictEqual(await js(`document.querySelectorAll('.hs-card .hs-upd *').length>0&&[...document.querySelectorAll('.hs-card .hs-upd *')].every(e=>['P','SPAN','BUTTON'].includes(e.tagName))`), true);

    // ---- Update…: the owner route first, the others behind "Show other ways", the exact command shown
    await js(`document.querySelector(${jsLiteral(card('claude'))}+' [data-hs="update"]').click()`);
    await until(`!!document.querySelector('#hsDlg .hs-plan')`);
    const plan = await js(`({first:document.querySelector('#hsDlg .hs-plan b').textContent,others:!!document.querySelector('#hsDlg details.hs-other'),cmd:document.querySelector('#hsDlg .hs-cmds code').textContent})`);
    assert.match(plan.first, /own updater \(installed this copy\)/);
    assert.ok(plan.others, 'other ways are behind Show other ways');
    assert.strictEqual(plan.cmd, 'claude update');
    await shot(`081-updates-plan-${w}x${h}.png`);
    // ---- open sessions are warned about: Update when they end / End 2 sessions and update / Cancel (the lock was taken first)
    await H.load({ w, h, query: { simkinds: '1', simupd: 'avail', simsessions: '2' }, ready: 'fit' });
    await settings();
    await js(`document.querySelector('[data-hs="checkall"]').click()`); await until(`/Update available/.test(document.querySelector(${jsLiteral(card('claude'))}+' .hs-upd').textContent)`);
    await js(`document.querySelector(${jsLiteral(card('claude'))}+' [data-hs="update"]').click()`); await until(`!!document.querySelector('#hsDlg .hs-plan')`);
    assert.ok(await dlgBtn('Update'));
    await until(`/2 Claude Code sessions are open/.test((document.getElementById('hsDlgT')||{}).textContent||'')`);
    const gate = await js(`({t:document.getElementById('hsDlgT').textContent,b:[...document.querySelectorAll('#hsDlg .btn')].map(x=>x.textContent),n:document.querySelector('#hsDlg .dbody').textContent})`);
    assert.deepStrictEqual(gate.b, ['Cancel', 'Update when they end', 'End 2 sessions and update']);
    assert.match(gate.n, /2 sessions end and frees their places \(1 still working: its reply stops\)\. The chats stay; send a message to pick up where you left off\./, 'the End all sessions? wording');
    assert.ok(await js(`[...document.querySelectorAll('#hsDlg .dbtn .btn')].every(b=>{const r=b.getBoundingClientRect(),d=document.querySelector('#hsDlg .dlg').getBoundingClientRect();return r.left>=d.left&&r.right<=d.right+0.5})`), 'every button of the dialog is inside it, Cancel too');
    await shot(`081-updates-sessions-${w}x${h}.png`);
    assert.ok(await dlgBtn('Update when they end'));
    await until(`!!document.querySelector(${jsLiteral(card('claude'))}+' .hs-wait')`);
    assert.match(await js(`document.querySelector(${jsLiteral(card('claude'))}+' .hs-wait').textContent`), /Update waiting for 2 sessions\s*Cancel/);
    assert.strictEqual(await js(`!!document.querySelector(${jsLiteral(card('claude'))}+' [data-hs="update"]')`), false, 'no second Update while one waits');
    await shot(`081-updates-waiting-${w}x${h}.png`);
    // the sessions end (the simulator ends them after a moment): the update runs by itself and shows its progress, then ends
    await until(`!!document.getElementById('hsLog')`, 15000);
    await until(`!document.getElementById('hsDlg')`, 15000);
    await until(`!document.querySelector(${jsLiteral(card('claude'))}+' .hs-wait')&&/Up to date/.test(document.querySelector(${jsLiteral(card('claude'))}+' .hs-upd').textContent)`, 15000);
    assert.match(await js(`document.querySelector(${jsLiteral(card('claude'))}+' .hs-upd').textContent`), /Installed 2\.1\.308/);

    // ---- Cancel at the gate releases (nothing runs)
    await H.load({ w, h, query: { simkinds: '1', simupd: 'avail', simsessions: '1' }, ready: 'fit' });
    await settings();
    await js(`document.querySelector('[data-hs="checkall"]').click()`); await until(`/Update available/.test(document.querySelector(${jsLiteral(card('claude'))}+' .hs-upd').textContent)`);
    await js(`document.querySelector(${jsLiteral(card('claude'))}+' [data-hs="update"]').click()`); await until(`!!document.querySelector('#hsDlg .hs-plan')`);
    await dlgBtn('Update'); await until(`/session is open/.test((document.getElementById('hsDlgT')||{}).textContent||'')`);
    await dlgBtn('Cancel'); await until(`!document.getElementById('hsDlg')`);
    assert.match(await js(`document.querySelector(${jsLiteral(card('claude'))}+' .hs-upd').textContent`), /Update available/, 'still an update; nothing ran');

    // ---- an update that runs: progress, then the toast
    await H.load({ w, h, query: { simkinds: '1', simupd: 'avail' }, ready: 'fit' });
    await settings();
    await js(`document.querySelector('[data-hs="checkall"]').click()`); await until(`/Update available/.test(document.querySelector(${jsLiteral(card('codex'))}+' .hs-upd').textContent)`);
    await js(`document.querySelector(${jsLiteral(card('codex'))}+' [data-hs="update"]').click()`); await until(`!!document.querySelector('#hsDlg .hs-plan')`);
    assert.ok(await dlgBtn('Update'));
    await until(`!!document.getElementById('hsLog')`);
    assert.deepStrictEqual(await js(`window.__simHarnessLast`), { kind: 'codex', op: 'update', planIndex: 0 }, 'only the route index is sent');
    await shot(`081-updates-running-${w}x${h}.png`);
    await until(`!document.getElementById('hsDlg')&&/Up to date/.test(document.querySelector(${jsLiteral(card('codex'))}+' .hs-upd').textContent)`, 15000);
    assert.match(await js(`document.getElementById('toasts').textContent`), /updated/);

    // ---- failures say what to do: Managed, administrator rights, the Codex fallback
    for (const [run, re, btn] of [['managed', /managed by your organization/, null], ['admin', /Durbar never runs sudo[\s\S]*claude update|Durbar never runs sudo/, null], ['fallback', /own updater did not work/, "Use the vendor's installer…"]]) {
      await H.load({ w, h, query: { simkinds: '1', simupd: 'avail', simupdrun: run }, ready: 'fit' });
      await settings();
      await js(`document.querySelector('[data-hs="checkall"]').click()`); await until(`/Update available/.test(document.querySelector(${jsLiteral(card('claude'))}+' .hs-upd').textContent)`);
      await js(`document.querySelector(${jsLiteral(card('claude'))}+' [data-hs="update"]').click()`); await until(`!!document.querySelector('#hsDlg .hs-plan')`);
      await dlgBtn('Update');
      await until(`/That did not finish/.test((document.getElementById('hsDlgT')||{}).textContent||'')`, 15000);
      const body = await js(`document.querySelector('#hsDlg .dbody').textContent`);
      assert.match(body, re, run + ': ' + body);
      if (run === 'managed') assert.ok(!(await js(`[...document.querySelectorAll('#hsDlg .btn')].some(b=>/retry|try again/i.test(b.textContent))`)), 'no retry for Managed');
      if (btn) assert.ok(await js(`[...document.querySelectorAll('#hsDlg .btn')].some(b=>b.textContent===${jsLiteral(btn)})`), 'the fallback is offered, not run');
      if (run === 'managed') await shot(`081-updates-managed-${w}x${h}.png`);
      if (run === 'admin') await shot(`081-updates-admin-${w}x${h}.png`);
    }

    // ---- could not check, a quiet note, a copy outside Durbar's routes
    await H.load({ w, h, query: { simkinds: '1', simupd: 'mixed' }, ready: 'fit' });
    await settings();
    await js(`document.querySelector('[data-hs="checkall"]').click()`); await until(`/Could not check: network problem/.test(document.querySelector(${jsLiteral(card('codex'))}+' .hs-upd').textContent)`);
    const m = await js(`({claude:document.querySelector(${jsLiteral(card('claude'))}+' .hs-upd').textContent,copilot:document.querySelector(${jsLiteral(card('copilot'))}+' .hs-upd').textContent,badge:document.querySelector('#settingsBtn .upd-badge'),act:[...document.querySelectorAll(${jsLiteral(card('claude'))}+' .hs-act .btn')].map(b=>b.textContent)})`);
    assert.match(m.claude, /Up to date[\s\S]*A newer latest-channel build exists \(2\.1\.309\)/, 'a quiet note');
    assert.strictEqual(m.badge, null, 'no badge for the quiet note');
    assert.ok(!m.act.includes('Update…'), 'no Update for the quiet note');
    assert.match(m.copilot, /Outside Durbar[\s\S]*installed outside Durbar's routes[\s\S]*package manager/);
    await shot(`081-updates-mixed-${w}x${h}.png`);

    // ---- the organization turns the check off (spec 076 key): nothing but its word, no button, no Latest lines
    await H.load({ w, h, query: { simkinds: '1', simupd: 'off' }, ready: 'fit' });
    await settings();
    assert.match(await js(`document.getElementById('hsBar').textContent`), /Turned off by your organization/);
    assert.strictEqual(await js(`document.querySelectorAll('[data-hs="checkall"],[data-hs="updcheck"],[data-hs="startchk"],.hs-latest').length`), 0);
    await shot(`081-updates-off-${w}x${h}.png`);
    console.log('[081]', w, 'ok');
  }
  console.log('[081] PASS');
};
