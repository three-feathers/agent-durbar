/*
 * Spec 011 FR-012, issue #1023: a Settings row whose save fails goes back to the value in force and says so, in the same words for every row
 * ("Could not save this setting. It stays on."). The simulator's bridge is made to answer `ok: false` (what main now answers when the
 * settings file cannot be written); then the row is changed and the control and the message are read (the bridge is a stand-in, so no stored
 * value is read here: main's own handlers and store are tested in test-credits). With a working bridge the normal text shows. Simulator only (no AI credits, no agent app).
 *
 *   npm run check:ui -- --only check-settings-save
 *   OUT=docs/screenshots  (optional) also saves 011-settings-save-{1440x900,1280x800}.png
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || require('os').tmpdir();

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const ok = async (expr, what) => assert.ok(await until(expr, 6000), what);
  const text = (id) => js(`(document.getElementById(${jsLiteral(id)})||{}).textContent||''`);
  const checked = (id) => js(`document.getElementById(${jsLiteral(id)}).getAttribute('aria-checked')`);
  const WORDS = (stays) => `Could not save this setting. It stays ${stays}.`;
  // the bridge the Settings screen calls: replace one setter, keep the original to put back
  const failing = (name, reply) => js(`(()=>{const b=window.__durbarSimUi.bridge(),n=${jsLiteral(name)},r=${jsLiteral(reply)};b.__orig=b.__orig||{};b.__orig[n]=b.__orig[n]||b[n];b[n]=async()=>r;})()`);
  const working = (name) => js(`(()=>{const b=window.__durbarSimUi.bridge(),n=${jsLiteral(name)};if(b.__orig&&b.__orig[n])b[n]=b.__orig[n];})()`);
  const show = (id) => js(`document.getElementById(${jsLiteral(id)}).scrollIntoView({block:'center'})`);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, ready: 'fit', focus: true });
    await js(`document.getElementById('settingsBtn').click()`);
    await ok(`!!document.getElementById('seriousSw')&&!!document.getElementById('notifySw')&&!!document.getElementById('breakSw')&&!!document.getElementById('chatLinksSel')&&!!document.getElementById('capSave')`, `${w}: the rows are there`);

    // Serious mode (off): the save fails, the switch stays off and the row says so
    assert.strictEqual(await checked('seriousSw'), 'false');
    await failing('setSeriousMode', { ok: false, seriousMode: false });
    await js(`document.getElementById('seriousSw').click()`);
    await ok(`document.getElementById('seriousMsg').textContent.startsWith('Could not save')`, `${w}: serious mode says it could not save`);
    assert.strictEqual(await text('seriousMsg'), WORDS('off'));
    assert.strictEqual(await checked('seriousSw'), 'false', `${w}: the switch stays off`);
    await show('seriousSw');
    await H.shot(path.join(OUT, `011-settings-save-${w}x${h}.png`), { prep: 'mouse', tag: '011' });
    await working('setSeriousMode');
    await js(`document.getElementById('seriousSw').click()`);
    await ok(`document.getElementById('seriousSw').getAttribute('aria-checked')==='true'`, `${w}: with a working save it turns on`);
    assert.strictEqual(await text('seriousMsg'), 'Serious mode is on: no mood drawings.');
    await js(`document.getElementById('seriousSw').click()`);
    await ok(`document.getElementById('seriousSw').getAttribute('aria-checked')==='false'`, `${w}: and off again`);

    // Notifications (off in the simulator): a failed save keeps the value in force
    const ntf = await checked('notifySw');
    await failing('setNotifyNeedsMe', { ok: false, notifyNeedsMe: ntf === 'true' });
    await js(`document.getElementById('notifySw').click()`);
    await ok(`document.getElementById('notifyMsg').textContent.startsWith('Could not save')`, `${w}: notifications say it could not save`);
    assert.strictEqual(await text('notifyMsg'), WORDS(ntf === 'true' ? 'on' : 'off'));
    assert.strictEqual(await checked('notifySw'), ntf, `${w}: the switch is unchanged`);
    await working('setNotifyNeedsMe');

    // Coffee break resume (on = auto)
    const brk = await checked('breakSw');
    await failing('setBreakResume', { ok: false, breakResume: brk === 'true' ? 'auto' : 'ask' });
    await js(`document.getElementById('breakSw').click()`);
    await ok(`document.getElementById('breakMsg').textContent.startsWith('Could not save')`, `${w}: coffee break says it could not save`);
    assert.strictEqual(await text('breakMsg'), WORDS(brk === 'true' ? 'on' : 'off'));
    assert.strictEqual(await checked('breakSw'), brk, `${w}: the switch is unchanged`);
    await working('setBreakResume');

    // Chat links: the list goes back to the value in force, from either value (a reset that always picks 'session' would fail the second)
    await js(`(()=>{const s=document.getElementById('chatLinksSel');s.value='system';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await ok(`document.getElementById('chatLinksMsg').textContent.startsWith('Chat links open in your usual')`, `${w}: with a working save it changes`);
    await failing('setChatLinksIn', { ok: false, chatLinksIn: 'system' });
    await js(`(()=>{const s=document.getElementById('chatLinksSel');s.value='session';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await ok(`document.getElementById('chatLinksMsg').textContent.startsWith('Could not save')`, `${w}: chat links say it could not save`);
    assert.strictEqual(await text('chatLinksMsg'), WORDS('in your usual browser'));
    assert.strictEqual(await js(`document.getElementById('chatLinksSel').value`), 'system', `${w}: the list is back at the value in force (system)`);
    await working('setChatLinksIn');
    await js(`(()=>{const s=document.getElementById('chatLinksSel');s.value='session';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await ok(`document.getElementById('chatLinksMsg').textContent.startsWith('Chat links open in the session')`, `${w}: and back to the session browser`);
    await failing('setChatLinksIn', { ok: false, chatLinksIn: 'session' });
    await js(`(()=>{const s=document.getElementById('chatLinksSel');s.value='system';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await ok(`document.getElementById('chatLinksMsg').textContent.startsWith('Could not save')`, `${w}: chat links say it could not save again`);
    assert.strictEqual(await text('chatLinksMsg'), WORDS('in the session browser'));
    assert.strictEqual(await js(`document.getElementById('chatLinksSel').value`), 'session', `${w}: the list is back at the value in force (session)`);
    await working('setChatLinksIn');

    // Spending limit: a failed save is not "Saved"
    await failing('setDefaultCap', { ok: false, defaultMaxAiCredits: undefined });
    await js(`document.getElementById('capDef').value='75';document.getElementById('capSave').click()`);
    await ok(`document.getElementById('capMsg').textContent.startsWith('Could not save')`, `${w}: the spending limit says it could not save`);
    assert.strictEqual(await text('capMsg'), WORDS('as it was'));
    assert.strictEqual(await js(`document.getElementById('capDef').value`), '', `${w}: the box shows the limit in force (none)`);
    await working('setDefaultCap');
    await js(`document.getElementById('capDef').value='75';document.getElementById('capSave').click()`);
    await ok(`/^Saved/.test(document.getElementById('capMsg').textContent)`, `${w}: with a working save it says Saved`);
    // the call itself fails (no reply): the box goes back to the limit the window holds (75), never to empty
    await failing('setDefaultCap', null);
    await js(`document.getElementById('capDef').value='90';document.getElementById('capSave').click()`);
    await ok(`document.getElementById('capMsg').textContent.startsWith('Could not save')`, `${w}: a failed call says it could not save`);
    assert.strictEqual(await js(`document.getElementById('capDef').value`), '75', `${w}: the box keeps the limit in force`);
    // a tighter limit that could not be saved stays in force for this run, and says so
    await failing('setDefaultCap', { ok: false, unsaved: true, defaultMaxAiCredits: 60 });
    await js(`document.getElementById('capDef').value='60';document.getElementById('capSave').click()`);
    await ok(`document.getElementById('capMsg').textContent.startsWith('Applied for this run only')`, `${w}: a kept limit says this run only`);
    await working('setDefaultCap');
    // Agent apps: the checkbox and the sandbox undo, through the page's own click handler with stand-in elements (a real card needs a running app)
    const toasts = () => js(`[...document.querySelectorAll('#toasts .toast')].map(t=>t.textContent).join(' | ')`);
    const click = (kind, extra) => js(`(()=>{const b=Object.assign({dataset:{hs:${jsLiteral(kind)},kind:'claude'},closest:q=>q==='.hs-card'?{querySelector:()=>({textContent:'Claude Code'})}:null},${jsLiteral(extra || {})});window.__sbEl=b;return window.DurbarHarnesses.onClick({target:{closest:()=>b}});})()`);
    await failing('setCheckUpdatesAtStart', { ok: false, checkUpdatesAtStart: false });
    await click('startchk', { checked: false }); // the person unticked it (it is on in the simulator)
    await ok(`[...document.querySelectorAll('#toasts .toast')].some(t=>t.textContent==='Could not save this setting. It stays on.')`, `${w}: the update-check checkbox says it could not save: ` + await toasts());
    assert.strictEqual(await js(`window.__sbEl.checked`), true, `${w}: and goes back to the value in force (on)`);
    await js(`(()=>{const b=window.__durbarSimUi.bridge();b.setCheckUpdatesAtStart=async()=>{throw new Error('ipc rejected');};})()`);
    await js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove())`);
    await click('startchk', { checked: false });
    await ok(`[...document.querySelectorAll('#toasts .toast')].some(t=>t.textContent==='Could not save this setting. It stays on.')`, `${w}: a rejected call says it too`);
    assert.strictEqual(await js(`window.__sbEl.checked`), true, `${w}: and the box is back on`);
    await working('setCheckUpdatesAtStart');
    for (const [reply, want] of [[{ ok: false }, 'Could not turn this off for Claude Code.'], [{ ok: true, saved: false }, 'for this run only'], [{ ok: true }, 'The OS sandbox note shows again for Claude Code.']]) {
      await js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove())`);
      await failing('sandboxAlwaysOff', reply);
      await click('sbxundo');
      await ok(`[...document.querySelectorAll('#toasts .toast')].some(t=>t.textContent.includes(${jsLiteral(want)}))`, `${w}: sandbox undo ${JSON.stringify(reply)} says "${want}": ` + (await toasts()));
    }
    await working('sandboxAlwaysOff');
    // a limit kept for this run only is the one the new-session dialog starts with, and Settings says so again when it is reopened
    await failing('setDefaultCap', { ok: false, unsaved: true, defaultMaxAiCredits: 60 });
    await js(`document.getElementById('capDef').value='60';document.getElementById('capSave').click()`);
    await ok(`document.getElementById('capMsg').textContent.startsWith('Applied for this run only')`, `${w}: kept limit: this run only`);
    await js(`window.DurbarScreens.close();0`);
    await js(`document.querySelector('#stage .desk').click()`);
    await ok(`!!document.getElementById('newSessBtn')`, `${w}: the New session button`);
    await js(`document.getElementById('newSessBtn').click()`);
    await ok(`!!document.getElementById('sdCap')`, `${w}: the new-session dialog opened`);
    assert.strictEqual(await js(`document.getElementById('sdCap').value`), '60', `${w}: the dialog starts with the kept limit`);
    await js(`(document.querySelector('#scrDlg .dbtn .btn')||{click(){}}).click();0`);
    await H.key('Escape');
    await working('setDefaultCap');
    // reopened: Settings says again that the limit is for this run only (main lists it in settings:get)
    await js(`(()=>{const b=window.__durbarSimUi.bridge(),g=b.getSettings;b.__getOrig=g;b.getSettings=async()=>Object.assign({},await g(),{unsaved:['defaultMaxAiCredits']});})()`);
    await js(`document.getElementById('settingsBtn').click()`);
    await ok(`!!document.getElementById('capMsg')&&document.getElementById('capMsg').textContent.startsWith('This limit is in force for this run only')`, `${w}: reopened Settings says the limit is for this run only`);
    await js(`(()=>{const b=window.__durbarSimUi.bridge();b.getSettings=b.__getOrig;})()`);
    await js(`window.DurbarScreens.close();0`);
  }
  console.log('[011] settings save checks passed');
};
