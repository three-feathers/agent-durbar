/*
 * Spec 043 FR-021..FR-025 (T015c): Create an Agent Success Profile with AI, in the simulator (canned generation, no AI credits).
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
    const cost = await js(`({c:document.getElementById('peACost').textContent,b:document.getElementById('peAGo').textContent,by:document.getElementById('peABy').value,first:document.getElementById('peABy').options[0].value})`);
    assert.ok(/1 prompt/.test(cost.c) && /Uses your own/.test(cost.c) && /1 prompt, Copilot/.test(cost.b) && cost.by === 'copilot' && cost.first === 'copilot', 'cost before sending, the target app first (FR-023): ' + JSON.stringify(cost));
    if (first) {
      // an error keeps what was typed
      await js(`(()=>{const t=document.getElementById('peADescT');t.value='Please fail now so the error shows up';t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await H.click('#peAGo');
      assert.ok(await until(`!document.getElementById('peAErr').hidden&&/no answer/.test(document.getElementById('peAErr').textContent)`, 5000), 'error shown');
      assert.ok(await js(`document.getElementById('peADescT').value==='Please fail now so the error shows up'&&!document.getElementById('peAGo').hidden`), 'the text is kept, Create is back');
      // FR-031: Stop waiting (the simulator answers after 700 ms): loading text, answers kept, Create disabled until the first request ends, late reply dropped
      const stop = await js(`(()=>{const t=document.getElementById('peADescT');t.value='A careful reviewer that reads the code';t.dispatchEvent(new Event('input',{bubbles:true}));
        document.getElementById('peAGo').click();
        const waitShown=!document.getElementById('peAWait').hidden&&/Writing the profile/.test(document.getElementById('peAWait').textContent)&&!document.getElementById('peAStop').hidden&&document.getElementById('peAGo').hidden;
        document.getElementById('peAStop').click();
        const g=document.getElementById('peAGo');
        return {waitShown,kept:t.value==='A careful reviewer that reads the code'&&!t.disabled,goDisabled:!g.hidden&&g.disabled,late:!document.getElementById('peALate').hidden,err:document.getElementById('peAErr').textContent,waitGone:document.getElementById('peAWait').hidden};})()`);
      assert.ok(stop.waitShown && stop.kept && stop.goDisabled && stop.late && stop.waitGone && /may still finish/.test(stop.err), 'Stop waiting: ' + JSON.stringify(stop));
      assert.ok(await until(`!document.getElementById('peAGo').disabled&&document.getElementById('peALate').hidden`, 5000), 'Create comes back when the first request ends');
      assert.ok(await js(`!!document.getElementById('peAiOv')&&!document.getElementById('peOv')`), 'the late reply is dropped (no draft opened)');
    }
    // FR-026: tools only from the Extra tools line; the dialog says so
    const tn = await js(`({note:document.getElementById('peAToolsNote').textContent,ph:document.getElementById('peATools').placeholder,rows:[...document.querySelectorAll('#peAQ textarea')].every(x=>x.rows===2),w:document.querySelector('.dlg.pe-ai').getBoundingClientRect().width})`);
    assert.ok(/read-only tools \(view, grep, glob\)/.test(tn.note) && /Tools named in your text are not granted/.test(tn.note) && /shell/.test(tn.ph), 'the tools note: ' + JSON.stringify(tn));
    assert.ok(tn.rows && tn.w <= 760, 'two-row answers and the shared dialog width (--dlg-w-l): ' + JSON.stringify(tn));
    await H.click('[data-am="questions"]');
    await js(`(()=>{const set=(id,v)=>{const t=document.querySelector('#peAQ textarea[data-q="'+id+'"]');t.value=v;t.dispatchEvent(new Event('input',{bubbles:true}));};set('title','Reviewer for the payments service');set('reportsTo','Me, before any change is merged');set('success','No missed security or rounding issue; notes under ten lines');set('tools','Reads code only; never uses powershell');const x=document.getElementById('peATools');x.value='shell';x.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await H.shot(path.join(OUT, `043-ai-questionnaire-${w}x${h}.png`), { prep: 'calm', delay: 250 });
    const fit = await js(`(()=>{const d=document.querySelector('.dlg.pe-ai').getBoundingClientRect();return d.top>=0&&d.bottom<=innerHeight&&d.right<=innerWidth})()`);
    assert.ok(fit, 'the questionnaire fits the window');
    assert.ok(await js(`(()=>{const d=document.querySelector('.dlg.pe-ai');return d.scrollHeight<=d.clientHeight+1})()`), 'the questionnaire needs no scrolling inside the dialog');
    await H.click('#peAGo');
    assert.ok(await until(`!!document.getElementById('peOv')&&!document.getElementById('peAiOv')&&!document.getElementById('peNewOv')`, 6000), 'the draft opens');
    const d = await js(`({mode:document.getElementById('peMain').dataset.mode,dirty:!document.getElementById('peDirty').hidden,sub:document.getElementById('peSub').textContent,h2:[...document.querySelectorAll('#peMd h2')].map(x=>x.textContent),txt:document.getElementById('peMd').textContent,st:document.getElementById('peStatus').textContent,vs:document.getElementById('peVs')&&document.getElementById('peVs').hidden})`);
    assert.strictEqual(d.mode, 'split', 'Split view');
    assert.ok(d.dirty && /not saved yet/.test(d.sub) && d.vs, 'an unsaved draft');
    assert.deepStrictEqual(d.h2, ['Title', 'People responsibility', 'Reporting to', 'Behaviors', 'Key Success Criteria', 'Skills', 'Tools and accountability', 'Key responsibilities']);
    assert.ok(/payments service/.test(d.txt) && /rounding/.test(d.txt) && /Written by .*AI credits/.test(d.st), 'answers in the draft');
    // FR-028: the granted extra tool and the tool only mentioned in the text
    assert.ok(/Tools beyond read-only: shell\. Check them before saving/.test(d.st) && /You mentioned powershell; it is not granted unless listed under Extra tools/.test(d.st), 'the tools note in the draft: ' + d.st);
    assert.ok(await js(`/^tools: \\[view, grep, glob, shell\\]$/m.test(document.getElementById('peSrc').value)`), 'the draft grants exactly the listed tool');
    await H.shot(path.join(OUT, `043-ai-result-split-${w}x${h}.png`), { prep: 'calm', blur: true, delay: 600 });
    await js(`document.getElementById('peSrc').focus()`);
    await H.key('S', [MOD], { char: 'never' });
    assert.ok(await until(`document.getElementById('peDirty').hidden&&!/not saved yet/.test(document.getElementById('peSub').textContent)`), 'Save created the file');
    assert.ok(await js(`/payments service/.test(document.getElementById('peSrc').value)&&!/The role in a few words/.test(document.getElementById('peSrc').value)`), 'the saved file is the draft, not the empty template');
    await H.click('#peClose');
    assert.ok(await until(`!document.getElementById('peOv')`));
    assert.ok(await until(`[...document.querySelectorAll('#pfSec .pf-row b')].some(b=>b.textContent===${jsLiteral('pay-reviewer-' + w)})`), 'listed in Settings');
    first = false;
  }
  console.log('[043-ai] PASS');
};
