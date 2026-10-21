/*
 * Spec 043 FR-020..FR-024 (T014c): Create an Agent Success Profile with AI, in the simulator (canned generation, no AI credits).
 * New Agent Success Profile -> Create with AI: the cost line and the button name the app and the one prompt; Questionnaire answers
 * -> a draft opens in Split view, Unsaved, "not saved yet", with all eight sections and the answers in the preview; Ctrl/Cmd+S
 * creates the file (listed in Settings). An error keeps the answers. Screenshots of the questionnaire and the result at 1440x900
 * and 1280x800. Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-043-ai.js xvfb-run -a npx electron . --no-sandbox
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const MOD = process.platform === 'darwin' ? 'meta' : 'control';
  let first = true;
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h });
    await H.click('#settingsBtn');
    assert.ok(await until(`!!document.querySelector('#pfSec #pfNew')`), 'Settings > Agent Success Profiles');
    await H.click('#pfNew');
    assert.ok(await until(`!!document.getElementById('peNewOv')&&!!document.getElementById('peNAi')`), 'Create with AI in the form');
    await js(`document.querySelector('input[name="peNTpl"][value="standard"]').click()`);
    assert.ok(await js(`document.getElementById('peNAi').hidden`), 'not offered for the Standard agent template');
    await js(`document.querySelector('input[name="peNTpl"][value="success"]').click()`);
    await js(`(()=>{document.getElementById('peNApp').value='copilot';document.getElementById('peNApp').dispatchEvent(new Event('change',{bubbles:true}));const n=document.getElementById('peNName');n.value=${jsLiteral('pay-reviewer-' + w)};n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await H.click('#peNAi');
    assert.ok(await until(`!!document.getElementById('peAiOv')&&!!document.getElementById('peAGo')`), 'the AI dialog');
    const cost = await js(`({c:document.getElementById('peACost').textContent,b:document.getElementById('peAGo').textContent,by:document.getElementById('peABy').value})`);
    assert.ok(/1 prompt/.test(cost.c) && /Uses your own/.test(cost.c) && /1 prompt, Copilot/.test(cost.b) && cost.by === 'copilot', 'cost before sending: ' + JSON.stringify(cost));
    if (first) {
      // an error keeps what was typed
      await js(`(()=>{const t=document.getElementById('peADescT');t.value='Please fail now so the error shows up';t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await H.click('#peAGo');
      assert.ok(await until(`!document.getElementById('peAErr').hidden&&/no answer/.test(document.getElementById('peAErr').textContent)`, 5000), 'error shown');
      assert.ok(await js(`document.getElementById('peADescT').value==='Please fail now so the error shows up'&&!document.getElementById('peAGo').hidden`), 'the text is kept, Create is back');
    }
    await H.click('[data-am="questions"]');
    await js(`(()=>{const set=(id,v)=>{const t=document.querySelector('#peAQ textarea[data-q="'+id+'"]');t.value=v;t.dispatchEvent(new Event('input',{bubbles:true}));};set('title','Reviewer for the payments service');set('reportsTo','Me, before any change is merged');set('success','No missed security or rounding issue; notes under ten lines');set('tools','Read, Grep and Glob only; never edits files');})()`);
    await H.shot(path.join(OUT, `043-ai-questionnaire-${w}x${h}.png`), { prep: 'calm', delay: 250 });
    const fit = await js(`(()=>{const d=document.querySelector('.dlg.pe-ai').getBoundingClientRect();return d.top>=0&&d.bottom<=innerHeight&&d.right<=innerWidth})()`);
    assert.ok(fit, 'the questionnaire fits the window');
    await H.click('#peAGo');
    assert.ok(await until(`!!document.getElementById('peOv')&&!document.getElementById('peAiOv')&&!document.getElementById('peNewOv')`, 6000), 'the draft opens');
    const d = await js(`({mode:document.getElementById('peMain').dataset.mode,dirty:!document.getElementById('peDirty').hidden,sub:document.getElementById('peSub').textContent,h2:[...document.querySelectorAll('#peMd h2')].map(x=>x.textContent),txt:document.getElementById('peMd').textContent,st:document.getElementById('peStatus').textContent,vs:document.getElementById('peVs')&&document.getElementById('peVs').hidden})`);
    assert.strictEqual(d.mode, 'split', 'Split view');
    assert.ok(d.dirty && /not saved yet/.test(d.sub) && d.vs, 'an unsaved draft');
    assert.deepStrictEqual(d.h2, ['Title', 'People responsibility', 'Reporting to', 'Behaviors', 'Key Success Criteria', 'Skills', 'Tools and accountability', 'Key responsibilities']);
    assert.ok(/payments service/.test(d.txt) && /rounding/.test(d.txt) && /Written by .*AI credits/.test(d.st), 'answers in the draft');
    await H.shot(path.join(OUT, `043-ai-result-split-${w}x${h}.png`), { prep: 'calm', blur: true, delay: 250 });
    await js(`document.getElementById('peSrc').focus()`);
    await H.key('S', [MOD], { char: 'never' });
    assert.ok(await until(`document.getElementById('peDirty').hidden&&!/not saved yet/.test(document.getElementById('peSub').textContent)`), 'Save created the file');
    await H.click('#peClose');
    assert.ok(await until(`!document.getElementById('peOv')`));
    assert.ok(await until(`[...document.querySelectorAll('#pfSec .pf-row b')].some(b=>b.textContent===${jsLiteral('pay-reviewer-' + w)})`), 'listed in Settings');
    first = false;
  }
  console.log('[043-ai] PASS');
};
