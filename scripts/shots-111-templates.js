/*
 * Spec 111 T008 (FR-020, FR-021, FR-131, FR-132): Settings > Team templates in the simulator (templates in memory, no AI credits, nothing written).
 * Checks, at 1440x900 and 1280x800:
 *  - starters (set with DurbarTeams.setStarters) show Use and Duplicate only; an own and an imported template show every action, Export disabled;
 *  - keyboard only: Tab walks the buttons in order (a disabled Export is skipped), Enter on Duplicate adds "<name> copy" then "<name> copy 2"
 *    (the store's naming), Delete asks first (Cancel focused), Cancel keeps it, Delete removes it and the focus goes to New template…;
 *  - the form's rules are the store's: a 9th member is refused in words (the simulator's put runs the shared validator);
 *  - text >= 10.5px in the section; the office is not scrolled and the page does not overflow.
 *  - the seeds simteams=blocked|changed|failed: the file-set-aside and cannot-save notices, a refused Duplicate in words (no value), `changed` refreshes the
 *    list with the other template and the copy then works, nothing changed on `failed`/`blocked`.
 * Shots: 111-templates-<w>x<h>.png and 111-templates-<seed>-<w>x<h>.png. Prints "[111] templates PASS". Linux with xvfb-run (never display :99):
 *
 *   npm run build
 *   OUT=/tmp DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-111-templates.js xvfb-run -a npx electron . --no-sandbox
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const member = (i) => ({ name: 'Member ' + i, role: 'Dev', app: i % 2 ? 'claude' : 'codex', permMode: 'read-only', sendBrief: false });
  const rows = () => js(`[...document.querySelectorAll('#teamsBox .tm-row')].map(r=>({id:r.dataset.tid,origin:r.dataset.origin,name:r.querySelector('.tm-name').textContent,tag:r.querySelector('.mtag').textContent,acts:[...r.querySelectorAll('button')].map(b=>b.textContent+(b.disabled?'|off':''))}))`);
  const active = () => js(`(()=>{const e=document.activeElement;return e?(e.id||'')+'/'+(e.dataset&&e.dataset.act||'')+'/'+(e.closest&&e.closest('.tm-row')?e.closest('.tm-row').querySelector('.tm-name').textContent:''):''})()`);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, query: { simteams: 'imported' } });
    // seed through the simulator's own bridge (the driver's `bridge` is the real preload, which main refuses under DURBAR_SIM)
    const put = await js(`window.__durbarSimUi.bridge().teamsPut(${jsLiteral({ name: 'Alpha team', description: 'Plain example', members: [member(1), member(2)] })}).then(r=>r.ok)`);
    assert.strictEqual(put, true, 'a template was saved through the shared validator');
    const nine = await js(`window.__durbarSimUi.bridge().teamsPut(${jsLiteral({ name: 'Too big', members: Array.from({ length: 9 }, (_, i) => member(i)) })}).then(r=>JSON.stringify([r.ok,r.code,r.errors]))`);
    assert.ok(/^\[false,"invalid",\["Members: at most 8\."\]\]$/.test(nine), `${w}: a 9th member is refused as the store refuses it: ${nine}`);
    await js(`window.DurbarTeams.setStarters([{id:'starter-example',name:'Example starter',members:[{app:'claude'},{app:'codex'}]}]);true`);

    await H.click('#settingsBtn');
    assert.ok(await until(`!!document.querySelector('#teamsBox #tmNew')&&document.querySelectorAll('#teamsBox .tm-row').length===3`), `${w}: Settings > Team templates lists the starter, the imported and the own template`);
    assert.ok(await js(`[...document.querySelectorAll('#scrNav a,#scrNav button')].some(x=>/Team templates/.test(x.textContent))`), `${w}: the section is in the Settings list`);
    const r = await rows();
    const by = (n) => r.find((x) => x.name === n);
    assert.deepStrictEqual(r.map((x) => x.name), ['Example starter', 'Review crew', 'Alpha team'], `${w}: starters first`);
    assert.deepStrictEqual(by('Example starter').acts, ['Use…', 'Duplicate'], `${w}: a starter shows Use and Duplicate only`);
    assert.strictEqual(by('Example starter').tag, 'Built in');
    assert.strictEqual(by('Review crew').tag, 'Imported');
    assert.strictEqual(by('Alpha team').tag, 'Yours');
    assert.deepStrictEqual(by('Alpha team').acts, ['Use…', 'Edit…', 'Duplicate', 'Export…|off', 'Delete'], `${w}: Export is disabled`);

    // every button is named with its template (a screen reader hears which one): the labels are exact
    const labels = await js(`[...[...document.querySelectorAll('#teamsBox .tm-row')].find(r=>r.querySelector('.tm-name').textContent==='Alpha team').querySelectorAll('button')].map(b=>b.getAttribute('aria-label'))`);
    assert.deepStrictEqual(labels, ['Use Alpha team', 'Edit Alpha team', 'Duplicate Alpha team', 'Export Alpha team (not available yet)', 'Delete Alpha team'], `${w}: buttons are named with their template: ${JSON.stringify(labels)}`);
    assert.strictEqual(await js(`document.querySelector('#teamsBox .tm-row[data-origin="starter"] .tm-acts').getAttribute('aria-labelledby')===document.querySelector('#teamsBox .tm-row[data-origin="starter"] .tm-name').id`), true, `${w}: a row's group is named by its template`);

    // keyboard only: from New template… Tab reaches each enabled button in order
    await js(`document.getElementById('tmNew').focus()`);
    const seen = [];
    for (let i = 0; i < 8; i++) { await H.key('Tab'); seen.push(await active()); }
    assert.deepStrictEqual(seen, ['/use/Example starter', '/duplicate/Example starter', '/use/Review crew', '/edit/Review crew', '/duplicate/Review crew', '/delete/Review crew', '/use/Alpha team', '/edit/Alpha team'], `${w}: Tab order: ${JSON.stringify(seen)}`);

    // Enter on Duplicate (own template), twice: the store's naming
    for (const want of ['Alpha team copy', 'Alpha team copy 2']) {
      await js(`document.querySelector('#teamsBox .tm-row[data-origin="own"] button[data-act="duplicate"]').focus()`);
      await H.key('Enter');
      assert.ok(await until(`[...document.querySelectorAll('#teamsBox .tm-name')].some(b=>b.textContent===${jsLiteral(want)})`), `${w}: Enter on Duplicate made "${want}"`);
    }
    assert.ok(/Copied as "Alpha team copy 2"/.test(await H.text('#tmNotice')), `${w}: the copy is announced in words`);

    // Delete asks; Cancel is focused; Escape keeps it
    const del = `document.querySelector('#teamsBox .tm-row[data-origin="own"] button[data-act="delete"]')`;
    const target = await js(`(()=>{const r=[...document.querySelectorAll('#teamsBox .tm-row')].find(x=>x.querySelector('.tm-name').textContent==='Alpha team copy 2');r.querySelector('button[data-act="delete"]').focus();return r.dataset.tid})()`);
    await H.key('Enter');
    assert.ok(await until(`!!document.getElementById('modeDlg')`), `${w}: Delete opens a question`);
    assert.deepStrictEqual(await js(`[...document.querySelectorAll('#modeDlg .dbtn button')].map(b=>b.textContent)`), ['Cancel', 'Delete'], `${w}: Cancel first, then Delete`);
    assert.strictEqual(await js(`document.activeElement.textContent`), 'Cancel', `${w}: Cancel has the focus, so Enter never deletes unread`);
    await H.shot(path.join(OUT, `111-templates-delete-${w}x${h}.png`), { prep: 'calm', blur: false, delay: 300 });
    await H.key('Escape');
    assert.ok(await until(`!document.getElementById('modeDlg')`), `${w}: Escape closed the question`);
    assert.ok(await js(`!!document.querySelector('#teamsBox [data-tid=${jsLiteral(target)}]')`), `${w}: Escape kept the template`);
    // Tab to Delete in the question, Enter
    await js(`document.querySelector('#teamsBox [data-tid=${jsLiteral(target)}] button[data-act="delete"]').focus()`);
    await H.key('Enter');
    assert.ok(await until(`!!document.getElementById('modeDlg')`), `${w}: the question again`);
    await js(`[...document.querySelectorAll('#modeDlg button')].find(b=>b.textContent==='Delete').focus()`);
    await H.key('Enter');
    assert.ok(await until(`!document.getElementById('modeDlg')&&!document.querySelector('#teamsBox [data-tid=${jsLiteral(target)}]')`), `${w}: Delete removed the template`);
    assert.strictEqual(await active(), 'tmNew//', `${w}: the focus went to New template…`);
    void del;

    // New, Edit and Use go to the member editor hook (T009): in words, nothing changes
    await H.click('#tmNew');
    assert.ok(await until(`/member editor is not available/.test(document.getElementById('srAnnounce').textContent)||[...document.querySelectorAll('#toasts .toast')].some(t=>/member editor is not available/.test(t.textContent))`), `${w}: New says the editor is not there yet (T009)`);

    // sizes and overflow
    const small = await js(`[...document.querySelectorAll('#teamsBox *')].filter(e=>e.childNodes.length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).map(e=>parseFloat(getComputedStyle(e).fontSize)).filter(f=>f<10.5).length`);
    assert.strictEqual(small, 0, `${w}: no text under 10.5px`);
    assert.ok(await js(`(()=>{const b=document.getElementById('teamsBox').getBoundingClientRect();const s=document.querySelector('.scr-body').getBoundingClientRect();return b.right<=s.right+1&&b.left>=s.left-1&&document.documentElement.scrollWidth<=innerWidth})()`), `${w}: the section fits its column, no page overflow`);
    await js(`(()=>{const h=document.getElementById('tmH');h.scrollIntoView({block:'start'})})()`);
    await H.clearToasts();
    await H.shot(path.join(OUT, `111-templates-${w}x${h}.png`), { prep: 'calm', blur: true, delay: 300 });
    // back to the office: the office itself is not scrolled
    if (await H.exists('#scrClose')) await H.click('#scrClose');
    await H.office(15);
    assert.ok(await js(`document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth`), `${w}: the office does not scroll`);
  }
  // the seeded refusals (sim.ts): words only, the list stays as it was
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    for (const seed of ['blocked', 'failed', 'changed']) {
      await H.load({ w, h, query: { simteams: seed } });
      await H.click('#settingsBtn');
      assert.ok(await until(`document.querySelectorAll('#teamsBox .tm-row').length>=1`), `${w} ${seed}: the list is there`);
      if (seed === 'blocked') {
        const aside = await H.text('#tmAside');
        assert.ok(/kept aside/.test(aside) && /cannot be read or set aside/.test(await H.text('#teamsBox .scr-note.warn:not(#tmAside)')), `${w}: blocked shows both notices in words: ${aside}`);
      }
      const before = JSON.stringify((await rows()).map((x) => x.name));
      await js(`document.querySelector('#teamsBox .tm-row button[data-act="duplicate"]').focus()`);
      await H.key('Enter');
      assert.ok(await until(`/\\.$/.test(document.getElementById('tmNotice').textContent)&&document.getElementById('tmNotice').textContent.length>5`), `${w} ${seed}: a notice in words`);
      const note = await H.text('#tmNotice');
      if (seed === 'changed') {
        assert.ok(/changed somewhere else/.test(note), `${w}: changed says so: ${note}`);
        assert.ok((await rows()).some((x) => x.name === 'Changed elsewhere'), `${w}: the list was refreshed with the other template`);
        await js(`document.querySelector('#teamsBox .tm-row button[data-act="duplicate"]').focus()`);
        await H.key('Enter');
        assert.ok(await until(`/Copied as/.test(document.getElementById('tmNotice').textContent)`), `${w}: the same copy works after the refresh`);
      } else {
        assert.ok(/could not be saved/.test(note), `${w} ${seed}: failed says so: ${note}`);
        assert.strictEqual(JSON.stringify((await rows()).map((x) => x.name)), before, `${w} ${seed}: nothing changed`);
        assert.ok(await js(`document.activeElement&&document.activeElement.dataset.act==='duplicate'`), `${w} ${seed}: the focus stays on the button`);
        // a refused Delete: the question, Delete, then the focus is back on that row's Delete button (not on the page)
        await js(`document.querySelector('#teamsBox .tm-row button[data-act="delete"]').focus()`);
        await H.key('Enter');
        assert.ok(await until(`!!document.getElementById('modeDlg')`), `${w} ${seed}: the delete question`);
        await js(`[...document.querySelectorAll('#modeDlg button')].find(b=>b.textContent==='Delete').focus()`);
        await H.key('Enter');
        assert.ok(await until(`!document.getElementById('modeDlg')&&/delete/i.test(document.getElementById('tmNotice').textContent)`), `${w} ${seed}: the refused delete is told in words`);
        assert.strictEqual(await active(), '/delete/Example team', `${w} ${seed}: the focus is back on the row's Delete button`);
        assert.strictEqual((await rows()).length, 1, `${w} ${seed}: the template is still there`);
      }
      await js(`document.getElementById('tmH').scrollIntoView({block:'start'})`);
      await H.clearToasts();
      await H.shot(path.join(OUT, `111-templates-${seed}-${w}x${h}.png`), { prep: 'calm', blur: true, delay: 300 });
    }
  }
  // a name that is markup is shown as text: no element made from it, nothing runs
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, query: { simteams: 'hostile' } });
    await H.click('#settingsBtn');
    assert.ok(await until(`document.querySelectorAll('#teamsBox .tm-row').length===1`), `${w}: the hostile row is listed`);
    const info = await js(`(()=>{const n=document.querySelector('#teamsBox .tm-name');return JSON.stringify({kids:n.children.length,text:n.textContent,imgs:document.querySelectorAll('#teamsBox img').length,ran:typeof window.__tmXss,label:document.querySelector('#teamsBox button[data-act="delete"]').getAttribute('aria-label')})})()`);
    const o = JSON.parse(info);
    assert.deepStrictEqual([o.kids, o.imgs, o.ran], [0, 0, 'undefined'], `${w}: no element came from the name: ${info}`);
    assert.strictEqual(o.text, '<img src=x onerror=window.__tmXss=1>', `${w}: the name is shown literally`);
    assert.strictEqual(o.label, 'Delete <img src=x onerror=window.__tmXss=1>', `${w}: and named literally`);
    await js(`document.querySelector('#teamsBox button[data-act="delete"]').focus()`);
    await H.key('Enter');
    assert.ok(await until(`!!document.getElementById('modeDlg')`), `${w}: the question opens`);
    assert.strictEqual(await js(`document.querySelectorAll('#modeDlg img').length+':'+typeof window.__tmXss`), '0:undefined', `${w}: the question holds the name as text too`);
    await H.key('Escape');
  }
  console.log('[111] templates PASS');
};
