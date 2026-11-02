/*
 * Spec 011 FR-012, issue #1023: a Settings row whose save fails goes back to the value in force and says so, in the same words for every row
 * ("Could not save this setting. It stays on."). The simulator's bridge is made to answer `ok: false` (what main now answers when the
 * settings file cannot be written); then the row is changed and the control, the message and the stored value are read. With a working
 * bridge the normal text shows. Simulator only (no AI credits, no agent app).
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

    // Chat links: the list goes back to the value in force
    await failing('setChatLinksIn', { ok: false, chatLinksIn: 'session' });
    await js(`(()=>{const s=document.getElementById('chatLinksSel');s.value='system';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await ok(`document.getElementById('chatLinksMsg').textContent.startsWith('Could not save')`, `${w}: chat links say it could not save`);
    assert.strictEqual(await text('chatLinksMsg'), WORDS('in the session browser'));
    assert.strictEqual(await js(`document.getElementById('chatLinksSel').value`), 'session', `${w}: the list is back at the value in force`);
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
    await js(`window.DurbarScreens.close();0`);
  }
  console.log('[011] settings save checks passed');
};
