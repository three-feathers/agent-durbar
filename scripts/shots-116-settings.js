/*
 * Spec 116 T007 (FR-002, FR-003, FR-053, FR-054, FR-070; US1.2, US1.3): Settings > Office memory in the simulator (memory in RAM, example path, no AI credits,
 * nothing written, no real folder dialog). In each world at 1440x900 and 1280x800:
 *  - every element: the path with ~, Choose folder..., Stop using, the switch, the status line, the Allow all sentence, the prompt-injection line, the
 *    "running sessions keep it" line; the section is in the Settings list;
 *  - seeded states (page address simmemory=): none, on, notfound, refusedstate: each says its state in words;
 *  - keyboard only: Enter on Choose folder... opens the confirmation with Cancel focused (US1.2 lines; the git remote line only with simmemory=remote);
 *    Enter on Cancel changes nothing; Tab then Enter on "Use this folder" turns it on; the switch off needs no question, on asks; Esc cancels; Stop using clears;
 *  - text >= 10.5px in the section, no sideways overflow in the section or the page.
 * Worlds: Flat and Real office in one run; the Retro world with DRIVER_WORLD=retro (the arcade; `officeview=real`). Shots: 116-settings-<world>-<state>-<w>x<h>.png.
 * Prints "[116] settings PASS <world>". Linux with xvfb-run (never display :99):
 *
 *   npm run build
 *   OUT=$PWD/test-results/116-settings DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-116-settings.js xvfb-run -a npx electron . --no-sandbox
 *   (add DRIVER_WORLD=retro for the Retro world)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  fs.mkdirSync(OUT, { recursive: true });
  const H = helpers(ctx);
  const { js, until } = H;
  const retro = process.env.DRIVER_WORLD === 'retro';
  const worlds = retro ? [['retro', { officeview: 'real' }]] : [['flat', {}], ['real', { officeview: 'real' }]];
  const readyReal = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
  const readyRetro = `!!document.querySelector('#stage .ro[data-world="retro"]')`;
  const memText = (sel) => js(`(document.querySelector(${jsLiteral(sel)})||{}).textContent||''`);
  const active = () => js(`(()=>{const e=document.activeElement;return e?(e.id||'')+'|'+(e.dataset&&e.dataset.cancel?'cancel':'')+'|'+(e.textContent||'').slice(0,40):''})()`);
  const dlgOpen = () => js(`!!document.getElementById('modeDlg')`);
  const open = async (w, h, query, world) => {
    await H.load({ w, h, query, ...(world === 'real' ? { ready: readyReal, settle: false } : retro ? { ready: readyRetro, settle: false } : {}) });
    await H.click('#settingsBtn');
    assert.ok(await until(`!!document.querySelector('#memBox #memChoose')&&!!document.querySelector('#memBox #memStatus').textContent`), `${world} ${w}: the memory section is in Settings`);
    await js(`document.getElementById('memH').scrollIntoView({block:'start'});true`);
  };

  for (const [world, base] of worlds) {
    for (const [w, h] of [[1440, 900], [1280, 800]]) {
      const tag = `${world}-%S-${w}x${h}`;
      const shot = (state) => H.shot(path.join(OUT, `116-settings-${tag.replace('%S', state)}.png`), { prep: 'calm', blur: false, delay: 300 });
      // none: the default (off, no folder)
      await open(w, h, { ...base }, world);
      assert.ok(await js(`[...document.querySelectorAll('#scrNav a,#scrNav button')].some(x=>/Office memory/.test(x.textContent))`), `${world} ${w}: in the Settings list`);
      assert.ok(/^Not set up/.test(await memText('#memStatus')), 'none: not set up');
      assert.ok(await js(`document.getElementById('memStop').disabled&&document.getElementById('memSw').disabled`), 'none: Stop and the switch are disabled');
      const box = await memText('#memBox');
      for (const s of ['An agent in Allow all can also change files in your memory folder.', 'Running sessions keep it until they restart', 'Read-only stays read-only', 'Choose folder…', 'Stop using']) assert.ok(box.includes(s), `${world} ${w}: the section says "${s}"`);
      const geo = await js(`(()=>{const b=document.getElementById('memBox'),r=b.getBoundingClientRect();let min=99;for(const e of b.querySelectorAll('*')){if(!e.childNodes.length)continue;const t=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());if(t){const f=parseFloat(getComputedStyle(e).fontSize);if(f<min)min=f;}}return {min,over:b.scrollWidth>b.clientWidth+1,page:document.documentElement.scrollWidth>innerWidth+1,right:r.right<=innerWidth}})()`);
      assert.ok(geo.min >= 10.5, `${world} ${w}: text is ${geo.min}px, at least 10.5`);
      assert.ok(!geo.over && !geo.page && geo.right, `${world} ${w}: no sideways overflow ${JSON.stringify(geo)}`);
      await shot('none');

      // keyboard only: Choose folder... (Enter) -> the confirmation, Cancel focused, no remote line
      await js(`document.getElementById('memChoose').focus();true`);
      await H.key('Enter');
      assert.ok(await until(`!!document.getElementById('modeDlg')`), 'the confirmation opens from the keyboard');
      assert.strictEqual((await active()).split('|')[1], 'cancel', `${world} ${w}: Cancel is focused: ${await active()}`);
      const dl = await memText('#modeDlg');
      assert.ok(/every file in it, in every mode/i.test(dl) && /never runs git/.test(dl) && /never chat text/.test(dl) && /~\/notes\/brain/.test(dl), `${world} ${w}: US1.2 text with the ~ path`);
      assert.ok(!/git remote/.test(dl), 'no remote line without a remote');
      await shot('confirm');
      await H.key('Enter'); // Cancel
      assert.ok(await until(`!document.getElementById('modeDlg')`), 'Cancel closes it');
      assert.ok(/^Not set up/.test(await memText('#memStatus')), 'Cancel changed nothing');
      assert.strictEqual((await active()).split('|')[0], 'memChoose', 'the focus returns to Choose folder...');
      // Choose again: Tab to "Use this folder", Enter -> on
      await H.key('Enter'); assert.ok(await until(`!!document.getElementById('modeDlg')`));
      await H.key('Tab'); assert.ok(/Use this folder/.test(await active()), `Tab reaches the confirming button: ${await active()}`);
      await H.key('Enter');
      assert.ok(await until(`/^On\\./.test((document.getElementById('memStatus')||{}).textContent||'')`), 'confirming turns it on');
      assert.ok(await js(`document.querySelector('#memSw').getAttribute('aria-checked')==='true'&&document.getElementById('memPathText').textContent==='~/notes/brain'`), 'the switch is on and the path shows ~');
      await shot('on');
      // the switch off: no question; on again: asks, Esc cancels
      await js(`document.getElementById('memSw').focus();true`); await H.key('Enter');
      assert.ok(await until(`/^Off\\./.test(document.getElementById('memStatus').textContent)`), 'off needs no question');
      assert.ok(!(await dlgOpen()), 'no dialog for turning off');
      await js(`document.getElementById('memSw').focus();true`); await H.key('Enter');
      assert.ok(await until(`!!document.getElementById('modeDlg')`), 'turning on asks'); await H.key('Escape');
      assert.ok(await until(`!document.getElementById('modeDlg')`) && /^Off\./.test(await memText('#memStatus')), 'Esc cancels: still off');
      await js(`document.getElementById('memStop').focus();true`); await H.key('Enter');
      assert.ok(await until(`/^Not set up/.test(document.getElementById('memStatus').textContent)`), 'Stop using clears the folder');

      // seeded states
      for (const [seed, re] of [['on', /^On\./], ['notfound', /^Not found: ~\/notes\/brain/], ['refusedstate', /^Refused: .*office.*~\/notes\/brain/]]) {
        await open(w, h, { ...base, simmemory: seed }, world);
        assert.ok(re.test(await memText('#memStatus')), `${world} ${w} ${seed}: ${await memText('#memStatus')}`);
        if (seed === 'refusedstate') assert.ok(await js(`document.getElementById('memSw').disabled`), 'refused: the switch is disabled');
        await shot(seed);
      }
      // a remote: the line is in the confirmation
      await open(w, h, { ...base, simmemory: 'remote' }, world);
      await js(`document.getElementById('memChoose').focus();true`); await H.key('Enter');
      assert.ok(await until(`!!document.getElementById('modeDlg')`));
      assert.ok(/git remote \(host\.example\.invalid\)\. Durbar cannot tell whether it is public\./.test(await memText('#modeDlg')), 'US1.3 line with a remote');
      assert.strictEqual((await active()).split('|')[1], 'cancel', 'Cancel is focused with a remote too');
      await shot('remote'); await H.key('Escape');
      assert.ok(await until(`!document.getElementById('modeDlg')`));
      // a refused pick says why
      await open(w, h, { ...base, simmemory: 'refused' }, world);
      await js(`document.getElementById('memChoose').focus();true`); await H.key('Enter');
      assert.ok(await until(`/Refused: It is your home folder\\./.test(document.getElementById('memNotice').textContent)`), 'a refused pick names the reason');
      await shot('refusedpick');
    }
    console.log(`[116] settings PASS ${world}`);
  }
};
