/*
 * Check for spec 010 FR-022..FR-026 (incident on PR #505, 2026-10-22): under DURBAR_SIM the main process never reaches a real agent app,
 * even when a page script calls the REAL preload API (`window.agentDurbar`) instead of the simulator's bridge. Simulator only; spends nothing:
 * every call below is refused by main before its handler runs, and the check fails if one is not.
 *
 *   npm run check:sim-guard          (also in scripts/ui-suite.js, so CI runs it on Linux, macOS and Windows)
 *
 * Asserts: the one-shot prompts (theme maker, folder-setup explainer), new folders and sessions, send, resume, deleting a previous session,
 * listing the agent apps and their models, installs and the CLI sign-in are all refused with the simulator message; `harnessPlans`
 * (an open channel, like `app:version`) still answers; main has created no real adapter (`ctx.createdAdapters()`); the simulator itself still works.
 * FR-030 (review on #514): a driver's `ctx.addMany(..., { adapterId: 'claude' })`, which reaches detection without IPC, starts no
 * child process (no `claude --version` / `auth status`), and main tried none since startup (`ctx.childProcessAttempts()`).
 * FR-032 (review on #514): a plain simulator start refuses no channel (`ctx.simRefused()`) and logs no unhandled rejection in the page.
 */
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers'); /* shared plumbing; jsLiteral: values spliced into page code */

/** Each call on the real preload API, as page code (the arguments are fixed, made-up values; none of them is ever used). */
const CALLS = {
  'theme:generate': "window.agentDurbar.generateTheme('a calm blue office','claude')",
  'folderSetup:explain': "window.agentDurbar.folderSetupExplain('/tmp/x','claude')",
  'agents:addFolder': "window.agentDurbar.addFolder('read-only',{})",
  'agents:newSession': "window.agentDurbar.newSession('sim-1',{})",
  'agents:send': "window.agentDurbar.send('sim-1','hello',[],{})",
  'sessions:resume': "window.agentDurbar.resumeSession('sim-1','00000000-0000-0000-0000-000000000000',false)",
  'sessions:delete': "window.agentDurbar.deletePrevious('sim-1','00000000-0000-0000-0000-000000000000')",
  'adapters:list': 'window.agentDurbar.listAdapters(true)',
  'models:list': "window.agentDurbar.listModels('claude')",
  'harness:run': "window.agentDurbar.harnessRun('claude','signin',0)",
  'settings:get': 'window.agentDurbar.getSettings()',
};

module.exports = async (ctx) => {
  const H = helpers(ctx);
  /* FR-032 (review on #514): a plain simulator start refuses no channel and leaves no unhandled rejection in the page (renderer.ts asked for
     app:version, refused and uncaught, on every load). Listen to the page's console from before the load, then check both. */
  const logged = [];
  const onConsole = (e, _level, message) => { logged.push(String((e && e.message) || message || '')); };
  ctx.win.webContents.on('console-message', onConsole);
  await H.load({ w: 1280, h: 800 });
  await ctx.sleep(1500); /* the version call and the first renders settle */
  ctx.win.webContents.removeListener('console-message', onConsole);
  const atStart = ctx.simRefused();
  assert.ok(Array.isArray(atStart), 'the driver context reports the refused channels under the simulator');
  assert.deepStrictEqual(atStart, [], `a plain simulator start refuses no channel (refused: ${JSON.stringify(atStart)})`);
  const unhandled = logged.filter((m) => /Uncaught \(in promise\)|Unhandled( promise)? rejection|Error invoking remote method/i.test(m));
  assert.deepStrictEqual(unhandled, [], `a plain simulator start logs no unhandled rejection: ${JSON.stringify(unhandled)}`);
  console.log(`[sim-guard] plain start: 0 channels refused, no unhandled rejection (${logged.length} console lines read)`);
  assert.ok(await H.js('!!window.agentDurbar'), 'the real preload API is in the page');
  assert.ok(await H.js("document.querySelectorAll('#stage .desk').length >= 15"), 'the simulator still runs (15 desks)');
  for (const [channel, call] of Object.entries(CALLS)) {
    const r = await H.js(`(async()=>{try{const v=await ${call};return {ok:true,v:JSON.stringify(v)}}catch(e){return {ok:false,m:String(e&&e.message||e)}}})()`);
    assert.ok(!r.ok, `${channel}: refused under DURBAR_SIM (it answered ${r.v})`);
    assert.ok(r.m.includes('The simulator never starts or talks to a real agent app') && r.m.includes(channel), `${channel}: the simulator message (${r.m})`);
    console.log(`[sim-guard] refused ${channel}`);
  }
  const plans = await H.js(`window.agentDurbar.harnessPlans(${jsLiteral('claude')},${jsLiteral('install')})`);
  assert.ok(plans && Array.isArray(plans.plans) && plans.plans.length > 0, 'harness:plans (open) still answers with the simulated routes');
  // FR-030: addMany with a picked agent app goes through detection (readyAdapterIds) without IPC; under the simulator it asks no app
  const fs = require('fs'); const os = require('os'); const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-simguard-'));
  let added;
  try {
    added = await ctx.addMany([dir], 'read-only', { adapterId: 'claude' });
  } catch (e) {
    added = { error: String(e && e.message || e) };
  }
  console.log(`[sim-guard] addMany with adapterId claude: ${JSON.stringify(added).slice(0, 200)}`);
  const tried = ctx.childProcessAttempts();
  assert.ok(Array.isArray(tried), 'the driver context counts child process attempts under the simulator');
  assert.deepStrictEqual(tried, [], `main tried no child process under DURBAR_SIM (it tried: ${JSON.stringify(tried)})`);
  console.log('[sim-guard] child processes tried by main since startup: 0');
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* the stand-in agent may still hold it; it is in the temp folder */ }
  const created = ctx.createdAdapters();
  assert.ok(created.every((a) => a.simBlocked), `no real adapter was created (${JSON.stringify(created)})`);
  console.log(`[sim-guard] adapters created in main: ${created.length} (all stand-ins)`);
  console.log('[sim-guard] all checks passed');
};
