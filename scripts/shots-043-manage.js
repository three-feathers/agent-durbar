/*
 * Spec 043 FR-040..FR-043 (T020e, issue #570): managing Agent Success Profiles in the simulator (files in memory, no AI credits).
 *  - nothing is written before Save (FR-042): Cancel or Escape in the New form, in the Create with AI dialog, Enter in the Name box
 *    then Close, Create then typing then Discard, and a Create with AI draft then Discard all leave no file;
 *  - a saved profile is in the Profile menu of a running session at once (FR-041);
 *  - Delete from the Profile menu and from Settings asks first (askDialog, Cancel focused), Cancel keeps the file, Delete removes it
 *    from both lists at once; a read-only file offers no Delete (FR-040).
 * Screenshots at 1440x900 and 1280x800. Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-043-manage.js xvfb-run -a npx electron . --no-sandbox
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  /** The profile names main's list has now: Settings is closed and opened again, so the list is read afresh (not a stale paint). */
  const toOffice = async () => {
    if (await H.exists('#scrClose')) await H.click('#scrClose');
    if (await js(`document.body.classList.contains('panel-open')`)) await H.click('#backBtn');
    await H.office(15);
  };
  const listed = async () => {
    await toOffice();
    await H.click('#settingsBtn');
    assert.ok(await until(`!!document.querySelector('#pfSec #pfNew')&&document.querySelectorAll('#pfSec .pf-row').length>0`), 'Settings > Agent Success Profiles');
    return js(`[...document.querySelectorAll('#pfSec .pf-row b')].map(b=>b.textContent)`);
  };
  const openNew = async (name, app = 'copilot') => {
    await H.click('#pfNew');
    assert.ok(await until(`!!document.getElementById('peNewOv')&&!!document.getElementById('peNName')`), 'the New form');
    await js(`(()=>{const a=document.getElementById('peNApp');a.value=${jsLiteral(app)};a.dispatchEvent(new Event('change',{bubbles:true}));const p=document.getElementById('peNPlace');const o=[...p.options].find(x=>/mcp-swiss/.test(x.textContent));if(o){p.value=o.value;p.dispatchEvent(new Event('change',{bubbles:true}));}const n=document.getElementById('peNName');n.focus();n.value=${jsLiteral(name)};n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  };
  const keyIn = (sel, key) => js(`document.querySelector(${jsLiteral(sel)}).dispatchEvent(new KeyboardEvent('keydown',{key:${jsLiteral(key)},bubbles:true,cancelable:true}))`);
  /** A Copilot chat with the Profile chip (the simulator's Copilot sessions list profiles). */
  const copilotChat = async () => {
    await toOffice();
    const got = await js(`(()=>{for(const d of document.querySelectorAll('#stage .desk[data-id]')){d.click();if(document.getElementById('agentChip'))return true;const b=document.getElementById('backBtn');if(b)b.click();}return false})()`);
    assert.ok(got, 'a Copilot chat with the Profile chip');
  };
  const menuNames = async () => {
    await H.click('#agentChip');
    assert.ok(await until(`!!document.querySelector('#agentMenu')&&!/Looking for profiles/.test(document.getElementById('agentMenu').textContent)`), 'the Profile menu');
    return js(`[...document.querySelectorAll('#agentMenu button[data-prof] .mt b')].map(b=>b.firstChild.textContent.trim())`);
  };

  /**
   * Review on #572: a dialog or menu fades in (styles.css `dlgin`, `dlgov`); a capture taken too soon on a loaded machine is half
   * faded. Wait until its animations have finished and it is fully opaque, and fail if that never happens.
   */
  const steady = async (sel) => {
    const ok = await until(`(()=>{const e=document.querySelector(${jsLiteral(sel)});if(!e)return false;const all=[e,...e.querySelectorAll('*')];return e.getAnimations({subtree:true}).every(a=>a.playState==='finished')&&all.every(x=>getComputedStyle(x).opacity==='1')})()`, 5000);
    assert.ok(ok, `${sel} finished its animations and is fully opaque before the capture`);
  };
  let first = true;
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h });
    const before = await listed();

    if (first) {
      // FR-042 (a): Cancel in the New form
      await openNew('cancel-form');
      await H.click('#peNCancel');
      assert.ok(await until(`!document.getElementById('peNewOv')`), 'the form closed');
      // (b) Create with AI, Cancel there, then Cancel the form
      await openNew('cancel-ai');
      await H.click('#peNAi');
      assert.ok(await until(`!!document.getElementById('peAiOv')`), 'the AI dialog');
      await H.click('#peACancel');
      assert.ok(await until(`!document.getElementById('peAiOv')&&!!document.getElementById('peNewOv')`), 'back in the form');
      await H.click('#peNCancel');
      // (c) Create with AI, Escape there, Escape in the form
      await openNew('escape-ai');
      await H.click('#peNAi');
      assert.ok(await until(`!!document.getElementById('peAiOv')`), 'the AI dialog again');
      await keyIn('#peAiOv', 'Escape');
      assert.ok(await until(`!document.getElementById('peAiOv')&&!!document.getElementById('peNewOv')`), 'Escape closed only the AI dialog');
      await keyIn('#peNewOv', 'Escape');
      assert.ok(await until(`!document.getElementById('peNewOv')`), 'Escape closed the form');
      // (d) Enter in the Name box opens a draft (no file); Close on an untouched draft asks nothing and writes nothing
      await openNew('enter-draft');
      await keyIn('#peNName', 'Enter');
      assert.ok(await until(`!!document.getElementById('peOv')&&/not saved yet/.test(document.getElementById('peSub').textContent)`), 'Enter opened a draft, not a file');
      assert.ok(await js(`!document.getElementById('peDirty').hidden&&!document.getElementById('peSave').disabled&&/Not saved yet/.test(document.getElementById('peStatus').textContent)`), 'the draft says Unsaved and Save is on');
      await H.click('#peClose');
      assert.ok(await until(`!document.getElementById('peOv')`, 3000) && !(await H.exists('#modeDlg')), 'an untouched draft closes without a question');
      // (e) Create, type, Close: the discard question; Discard writes nothing
      await openNew('typed-draft');
      await H.click('#peNGo');
      assert.ok(await until(`!!document.getElementById('peOv')`), 'the draft');
      await js(`(()=>{const t=document.getElementById('peSrc');t.value+='\\nMore text.';t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await H.click('#peClose');
      assert.ok(await until(`!!document.getElementById('modeDlg')`), 'a changed draft asks before closing');
      await H.clickText('#modeDlg .dbtn button', 'Discard');
      assert.ok(await until(`!document.getElementById('peOv')`), 'discarded');
      // (f) Create with AI -> a draft -> Close -> Discard
      await openNew('ai-draft');
      await H.click('#peNAi');
      assert.ok(await until(`!!document.getElementById('peAGo')`), 'the AI dialog with Create');
      await js(`(()=>{const t=document.getElementById('peADescT');t.value='A careful reviewer that reads the code and lists risks';t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await H.click('#peAGo');
      assert.ok(await until(`!!document.getElementById('peOv')&&/not saved yet/.test(document.getElementById('peSub').textContent)`, 6000), 'the AI draft');
      await H.click('#peClose');
      assert.ok(await until(`!!document.getElementById('modeDlg')`), 'an AI draft asks before closing');
      await H.clickText('#modeDlg .dbtn button', 'Discard');
      assert.ok(await until(`!document.getElementById('peOv')`), 'discarded');
      const after = await listed();
      assert.deepStrictEqual(after, before, 'no file after any cancel (FR-042): ' + JSON.stringify(after));
    }

    // FR-041: create and save; the Settings list shows it at once, and so does the Profile menu of a running session
    const name = 'triager-' + w;
    await openNew(name);
    await H.click('#peNGo');
    assert.ok(await until(`!!document.getElementById('peOv')`), 'the draft');
    await H.click('#peSave');
    assert.ok(await until(`!/not saved yet/.test(document.getElementById('peSub').textContent)&&/Saved/.test(document.getElementById('peStatus').textContent)`), 'saved');
    await H.click('#peClose');
    assert.ok(await until(`!document.getElementById('peOv')`), 'closed');
    assert.ok(await until(`[...document.querySelectorAll('#pfSec .pf-row b')].some(b=>b.textContent===${jsLiteral(name)})`), 'Settings lists the new profile at once (no reopen)');
    await copilotChat();
    assert.ok((await menuNames()).includes(name), 'the Profile menu lists the new profile at once');
    // FR-040: Delete in the Profile menu, beside Edit; none for a file it cannot write
    assert.ok(await js(`!!document.querySelector('#agentMenu .mm-del[aria-label=${jsLiteral('Delete the file of ' + name)}]')`), 'Delete beside the new profile');
    await steady('#agentMenu');
    await H.shot(path.join(OUT, `043-profile-menu-delete-${w}x${h}.png`), { prep: 'calm', delay: 0 });
    await js(`document.querySelector('#agentMenu .mm-del[aria-label=${jsLiteral('Delete the file of ' + name)}]').click()`);
    assert.ok(await until(`!!document.getElementById('modeDlg')`), 'the confirmation');
    const dlg = await js(`({t:document.getElementById('mdT').textContent,b:document.getElementById('mdB').textContent,l:document.getElementById('mdL')?document.getElementById('mdL').textContent:'',focus:document.activeElement&&document.activeElement.textContent,danger:!![...document.querySelectorAll('#modeDlg .dbtn button')].find(b=>b.textContent==='Delete'&&/danger/.test(b.className))})`);
    assert.ok(dlg.t === `Delete the profile ${name}?` && /deleted from disk/.test(dlg.b) && /goes back to its default agent/.test(dlg.b) && /triager-/.test(dlg.l) && dlg.focus === 'Cancel' && dlg.danger, 'askDialog with Cancel focused and a red Delete: ' + JSON.stringify(dlg));
    await steady('#modeDlg');
    await H.shot(path.join(OUT, `043-profile-delete-confirm-${w}x${h}.png`), { prep: 'calm', delay: 0 });
    await H.clickText('#modeDlg .dbtn button', 'Cancel');
    assert.ok(await until(`!document.getElementById('modeDlg')`), 'Cancel closes');
    assert.ok((await menuNames()).includes(name), 'Cancel keeps it');
    await js(`document.querySelector('#agentMenu .mm-del[aria-label=${jsLiteral('Delete the file of ' + name)}]').click()`);
    assert.ok(await until(`!!document.getElementById('modeDlg')`), 'the confirmation again');
    await H.clickText('#modeDlg .dbtn button', 'Delete');
    assert.ok(await until(`!document.getElementById('modeDlg')`), 'deleted');
    assert.ok(!(await menuNames()).includes(name), 'gone from the Profile menu at once');
    await H.key('Escape');

    // FR-040 in Settings: Delete… on a row; a read-only file has none; the row goes at once
    const second = 'scratch-' + w;
    await listed();
    assert.ok(await js(`(()=>{const r=[...document.querySelectorAll('#pfSec .pf-row')].find(x=>x.querySelector('b').textContent==='house-style');return !!r&&!r.querySelector('[data-pf-del]')})()`), 'no Delete for a read-only file');
    await openNew(second, 'claude');
    await H.click('#peNGo');
    assert.ok(await until(`!!document.getElementById('peOv')`), 'the draft');
    await H.click('#peSave');
    assert.ok(await until(`!/not saved yet/.test(document.getElementById('peSub').textContent)`), 'saved');
    await H.click('#peClose');
    assert.ok(await until(`[...document.querySelectorAll('#pfSec .pf-row b')].some(b=>b.textContent===${jsLiteral(second)})`), 'listed');
    // the new row in view: scroll the Settings pane itself (scrollIntoView would also move the page under the top bar)
    await js(`(()=>{const r=[...document.querySelectorAll('#pfSec .pf-row')].find(x=>x.querySelector('b').textContent===${jsLiteral(second)});let el=r.parentElement;while(el&&el!==document.body&&!(el.scrollHeight>el.clientHeight+1&&/auto|scroll/.test(getComputedStyle(el).overflowY)))el=el.parentElement;if(el&&el!==document.body)el.scrollTop+=r.getBoundingClientRect().top-el.getBoundingClientRect().top-160;})()`);
    await H.shot(path.join(OUT, `043-profile-settings-delete-${w}x${h}.png`), { prep: 'calm', blur: true, delay: 250 });
    await js(`[...document.querySelectorAll('#pfSec .pf-row')].find(x=>x.querySelector('b').textContent===${jsLiteral(second)}).querySelector('[data-pf-del]').click()`);
    assert.ok(await until(`!!document.getElementById('modeDlg')&&document.activeElement&&document.activeElement.textContent==='Cancel'`), 'asks, Cancel focused');
    await H.clickText('#modeDlg .dbtn button', 'Delete');
    assert.ok(await until(`![...document.querySelectorAll('#pfSec .pf-row b')].some(b=>b.textContent===${jsLiteral(second)})`), 'the row goes at once');
    assert.ok(await until(`document.activeElement&&document.activeElement.id==='pfNew'`), 'focus on New after the row is gone');
    assert.deepStrictEqual(await listed(), before, 'and main\'s list agrees');
    first = false;
  }
  console.log('[043-manage] PASS');
};
