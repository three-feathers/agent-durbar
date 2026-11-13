/*
 * Spec 111 T009 (FR-002, FR-022, FR-023, FR-131, FR-132): the team member editor in the simulator (templates in memory, no AI credits, nothing written).
 * Checks, at 1440x900 and 1280x800:
 *  - keyboard only: New template… opens the editor (size l, focus on the template name), Tab walks the fields of a member in order, Enter presses buttons;
 *  - errors on the field: Save on an empty form sends nothing, marks each field (aria-invalid) and links it to its error with aria-describedby; the focus is on the first one;
 *  - the limit is typed in the app's unit and is empty after the app changes; the app select says each app's state in words;
 *  - the limit of 8: Add member is disabled at 8 and says why; a 9th sent to the simulator's put is refused as main refuses it;
 *  - Remove and Move down renumber the legends (Member N of M: name); the focus stays on a button;
 *  - Mark as mine on an imported brief asks first (the focus starts on the safe button), Keep changes nothing, the yes calls teams:markMine and the mark is gone;
 *  - a save is kept and listed; a hostile name is shown as text (no element, nothing runs);
 *  - text >= 10.5px in the editor, the dialog fits the window, the office is not scrolled afterwards.
 * Shots: 111-editor-<world>-<w>x<h>.png in Open office, Real office and Retro arcade. Prints "[111] editor PASS". Linux with xvfb-run (never display :99):
 *
 *   npm run build
 *   OUT=/tmp DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-111-editor.js xvfb-run -a npx electron . --no-sandbox
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

const fs = require('fs');
/* TEAMS_EDITOR_MUTANT=<name>: the driver rewrites the built dist/renderer/teameditor.js for the run (restored at the end, also on a failure), so a mutant must die at
   its own label. nostate: the status words of a member are not painted; noappstate: the app select shows no state word; nodescribe: no aria-describedby. */
const MUTANTS = {
  nostate: ["v.status.textContent=stateWords(m,st).join(' · ');", "v.status.textContent='';"],
  noappstate: ["(k.shortName||k.name||k.id)+' ('+(k.stateText||'ready')+')'", "(k.shortName||k.name||k.id)"],
  nodescribe: ["if(ids2.length)f.control.setAttribute('aria-describedby',ids2.join(' '));", ''],
};

module.exports = async (ctx) => {
  const MUT = process.env.TEAMS_EDITOR_MUTANT || '';
  const file = path.join(__dirname, '..', 'dist', 'renderer', 'teameditor.js');
  const good = fs.readFileSync(file, 'utf8');
  if (MUT) {
    assert.ok(Object.prototype.hasOwnProperty.call(MUTANTS, MUT), `TEAMS_EDITOR_MUTANT=${MUT} is not one of ${Object.keys(MUTANTS).join('|')}`);
    assert.ok(good.includes(MUTANTS[MUT][0]), `TEAMS_EDITOR_MUTANT=${MUT}: the anchor is not in teameditor.js any more`);
    fs.writeFileSync(file, good.split(MUTANTS[MUT][0]).join(MUTANTS[MUT][1]));
    console.log('[111] TEAMS_EDITOR_MUTANT=' + MUT + ': teameditor.js rewritten for this run');
  }
  try { await body(ctx); } finally { if (MUT) fs.writeFileSync(file, good); }
};

async function body(ctx) {
  const H = helpers(ctx);
  const { js, until } = H;
  const tab = (shift) => H.key('Tab', shift ? ['shift'] : []);
  const type = async (text) => { H.wc().insertText(text); await ctx.sleep(40); };
  const active = () => js(`(()=>{const e=document.activeElement;if(!e)return '';const id=e.id||'';return (id.replace(/^tmEd-(m\\d+-)?/,'')||e.dataset.act||e.textContent.trim()).replace(/^tname$/,'tname')})()`);
  const fsets = () => js(`[...document.querySelectorAll('#modeDlg fieldset.tm-mem legend')].map(l=>l.textContent)`);
  // a call on the simulator's own bridge (the driver's `bridge` is the real preload, which main refuses under DURBAR_SIM); the answer comes back as data
  const call = (method, ...args) => js(`Promise.resolve(window.__durbarSimUi.bridge()[${jsLiteral(method)}](...${jsLiteral(args)})).then(r=>JSON.parse(JSON.stringify(r===undefined?null:r)))`);
  const importedMarks = async () => (await call('teamsList')).templates.find((t) => t.id === 'sim-imported').members.map((m) => m.briefFrom || '').join();
  const member = (i, app) => ({ name: 'Member ' + i, role: 'Dev', app, permMode: 'read-only', sendBrief: false });
  const openSettings = async () => { await H.click('#settingsBtn'); assert.ok(await until(`!!document.querySelector('#teamsBox #tmNew')`), 'Settings > Team templates is there'); };
  const focusSel = (sel) => js(`(()=>{const e=document.querySelector(${jsLiteral(sel)});if(!e)return false;e.focus();return true})()`);
  const fieldOf = (n, suffix) => `#modeDlg fieldset.tm-mem:nth-of-type(${n}) [id$="${suffix}"]`;

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, query: { simteams: 'imported', simkinds: 'mixed' } });
    await openSettings();
    await focusSel('#tmNew');
    await H.key('Enter');
    assert.ok(await until(`!!document.querySelector('#modeDlg .dlg.l .tm-ed')`), `${w}: New template… opens the editor (dialog size l)`);
    assert.strictEqual(await active(), 'tname', `${w}: the focus starts on the template name`);
    assert.strictEqual(await js(`document.querySelector('#modeDlg fieldset.tm-mem legend').textContent`), 'Member 1 of 1', `${w}: the member's legend`);

    // Save on an empty form: nothing is sent, each field says why, linked with aria-describedby
    await focusSel('#modeDlg .dbtn .primary');
    await H.key('Enter');
    assert.ok(await until(`document.querySelectorAll('#modeDlg [aria-invalid="true"]').length===3`), `${w}: three fields are marked`);
    const linked = await js(`[...document.querySelectorAll('#modeDlg [aria-invalid="true"]')].map(c=>(c.getAttribute('aria-describedby')||'').split(' ').map(i=>document.getElementById(i)).filter(e=>e&&!e.hidden&&/^Give the/.test(e.textContent)).length)`);
    assert.deepStrictEqual(linked, [1, 1, 1], `${w}: each marked field is linked (aria-describedby) to its error: ${JSON.stringify(linked)}`);
    assert.strictEqual(await js(`document.activeElement===document.querySelector('#modeDlg [aria-invalid="true"]')`), true, `${w}: the focus is on the first marked field`);
    assert.strictEqual(await js(`document.querySelectorAll('#teamsBox .tm-row').length`), 1, `${w}: nothing was saved`);

    // keyboard: name, then Tab walks the member's fields in order
    await type('Crew one');
    await tab();
    assert.strictEqual(await active(), 'tdesc', `${w}: Tab goes to the description`);
    const order = [];
    for (let i = 0; i < 16; i++) { await tab(); order.push(await active()); }
    const want = ['name', 'role', 'app', 'perm', 'cap', 'prof', 'char', 'brief', 'send', 'add'];
    const pos = want.map((x) => order.findIndex((o) => o === x || o.endsWith('-' + x) || o === x));
    assert.ok(pos.every((p, i) => p >= 0 && (i === 0 || p > pos[i - 1])), `${w}: Tab order of a member's fields: ${JSON.stringify(order)}`);
    assert.ok(order.includes('Cancel') && order.includes('Save template'), `${w}: Tab reaches Cancel and Save inside the dialog: ${JSON.stringify(order)}`);

    // fill the member by keyboard, then the limit and the app change
    await focusSel(fieldOf(1, '-name'));
    await type('Ana'); await tab(); await type('Lead');
    const apps = await js(`[...document.querySelector(${jsLiteral(fieldOf(1, '-app'))}).options].map(o=>({v:o.value,t:o.textContent}))`);
    assert.ok(apps.length >= 2 && apps.every((a) => /\((ready|not installed|too old|not signed in|unknown)\)$/.test(a.t)), `${w}: the app select says each app's state in words: ${JSON.stringify(apps)}`);
    const withCap = await js(`(()=>{const sel=document.querySelector(${jsLiteral(fieldOf(1, '-app'))});for(const o of sel.options){sel.value=o.value;sel.dispatchEvent(new Event('change',{bubbles:true}));const c=document.querySelector(${jsLiteral(fieldOf(1, '-cap'))});if(c&&!c.closest('.tm-f').hidden)return o.value;}return ''})()`);
    assert.ok(withCap, `${w}: an app with a spending limit exists`);
    await focusSel(fieldOf(1, '-cap')); await type('45');
    assert.strictEqual(await js(`document.querySelector(${jsLiteral(fieldOf(1, '-cap'))}).value`), '45', `${w}: the limit is typed`);
    const other = apps.find((a) => a.v !== withCap).v;
    await focusSel(fieldOf(1, '-app'));
    await js(`(()=>{const s=document.querySelector(${jsLiteral(fieldOf(1, '-app'))});s.value=${jsLiteral(other)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    const capAfter = await js(`document.querySelector(${jsLiteral(fieldOf(1, '-cap'))}).value`);
    assert.strictEqual(capAfter, '', `${w}: changing the app cleared the limit`);
    await js(`(()=>{const s=document.querySelector(${jsLiteral(fieldOf(1, '-app'))});s.value=${jsLiteral(withCap)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`);

    // the limit of 8 by keyboard: Enter on Add member
    for (let i = 0; i < 7; i++) {
      await focusSel('#modeDlg button[data-act="add"]'); await H.key('Enter');
      const n = i + 2;
      // each Enter repaints the members: wait for the new row, and for the focus to reach its name (the next Enter must find Add member again)
      assert.ok(await until(`document.querySelectorAll('#modeDlg fieldset.tm-mem').length===${n}&&!!document.activeElement&&document.activeElement===document.querySelector('#modeDlg fieldset.tm-mem:nth-of-type(${n}) [id$="-name"]')`), `${w}: Add member #${i + 1} made member ${i + 2} and moved the focus to it`);
    }
    assert.ok(await until(`document.querySelectorAll('#modeDlg fieldset.tm-mem').length===8`), `${w}: eight members`);
    assert.strictEqual(await js(`document.querySelector('#modeDlg button[data-act="add"]').disabled`), true, `${w}: Add member is disabled at 8`);
    assert.strictEqual(await H.text('#tmEdAddNote'), 'A team has at most 8 members.', `${w}: and says why`);
    const nine = await call('teamsPut', { name: 'Nine', members: Array.from({ length: 9 }, (_, i) => member(i, withCap)) });
    assert.deepStrictEqual([nine.ok, nine.code], [false, 'invalid'], `${w}: a 9th member sent to the store is refused`);
    // name the others, remove the last, move the first down: legends renumber
    await js(`(()=>{const set=(el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}))};document.querySelectorAll('#modeDlg fieldset.tm-mem').forEach((f,i)=>{if(i>0){set(f.querySelector('[id$="-name"]'),'Dev '+i);set(f.querySelector('[id$="-role"]'),'Role '+i);}})})()`);
    await focusSel('#modeDlg fieldset.tm-mem:nth-of-type(8) button[data-act="remove"]'); await H.key('Enter');
    assert.ok(await until(`document.querySelectorAll('#modeDlg fieldset.tm-mem').length===7`), `${w}: Remove took one out`);
    assert.strictEqual(await js(`document.querySelector('#modeDlg button[data-act="add"]').disabled`), false, `${w}: Add member is back`);
    await focusSel('#modeDlg fieldset.tm-mem:nth-of-type(1) button[data-act="down"]'); await H.key('Enter');
    await until(`document.querySelector('#modeDlg fieldset.tm-mem legend').textContent==='Member 1 of 7: Dev 1'`);
    assert.deepStrictEqual((await fsets()).slice(0, 2), ['Member 1 of 7: Dev 1', 'Member 2 of 7: Ana'], `${w}: Move down renumbers`);
    assert.strictEqual(await js(`document.activeElement.dataset.act`), 'down', `${w}: the focus stays on the button`);
    // two names that read the same are marked
    await js(`(()=>{const f=document.querySelectorAll('#modeDlg fieldset.tm-mem')[2].querySelector('[id$="-name"]');f.value='ana';f.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    assert.ok(await js(`/Looks like Ana/.test(document.querySelectorAll('#modeDlg fieldset.tm-mem')[2].querySelector('.tm-marks').textContent)`), `${w}: a name that reads the same as another is marked`);
    await js(`(()=>{const f=document.querySelectorAll('#modeDlg fieldset.tm-mem')[2].querySelector('[id$="-name"]');f.value='Dev 2';f.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    // sizes and fit
    const small = await js(`[...document.querySelectorAll('#modeDlg .tm-ed *, #modeDlg h3, #modeDlg .dbtn *')].filter(e=>e.childNodes.length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).map(e=>parseFloat(getComputedStyle(e).fontSize)).filter(f=>f<10.5).length`);
    assert.strictEqual(small, 0, `${w}: no text under 10.5px in the editor`);
    assert.ok(await js(`(()=>{const r=document.querySelector('#modeDlg .dlg').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth})()`), `${w}: the dialog fits the window`);
    // Save with the keyboard
    await focusSel('#modeDlg .dbtn .primary'); await H.key('Enter');
    assert.ok(await until(`!document.getElementById('modeDlg')&&[...document.querySelectorAll('#teamsBox .tm-name')].some(n=>n.textContent==='Crew one')`), `${w}: Save closed the editor and the template is listed`);
    const saved = (await call('teamsList')).templates.find((t) => t.name === 'Crew one');
    assert.strictEqual(saved.members.length, 7, `${w}: seven members saved`);
    assert.strictEqual(saved.members[1].name, 'Ana', `${w}: in the order on screen`);
    assert.ok(saved.members.every((m) => !('briefFrom' in m)), `${w}: no file mark invented`);
    assert.strictEqual(await js(`document.activeElement&&document.activeElement.closest&&!!document.activeElement.closest('#teamsBox')`), true, `${w}: the focus went back to the list`);

    // Edit an imported template: Mark as mine asks first
    await focusSel('#teamsBox .tm-row[data-origin="imported"] button[data-act="edit"]'); await H.key('Enter');
    assert.ok(await until(`!!document.querySelector('#modeDlg .tm-ed')&&document.querySelectorAll('#modeDlg button[data-act="mark"]').length===2`), `${w}: Edit opens the imported template with two marked briefs`);
    assert.ok(await js(`/Brief from a file/.test(document.querySelector('#modeDlg fieldset.tm-mem [id$="-st"]').textContent)`), `${w}: the file mark is in the member's description`);
    await js(`(()=>{const t=document.querySelector('#modeDlg fieldset.tm-mem textarea');t.focus()})()`);
    await type(' Plus a line.');
    await focusSel('#modeDlg fieldset.tm-mem button[data-act="mark"]'); await H.key('Enter');
    assert.ok(await until(`/Mark this brief as yours/.test(document.querySelector('#modeDlg h3').textContent)`), `${w}: Mark as mine asks first`);
    assert.strictEqual(await js(`document.activeElement.textContent`), 'Keep as from the file', `${w}: the focus starts on the safe button`);
    assert.ok(/It will be sent as your own text/.test(await H.text('#modeDlg .dsub')), `${w}: FR-023's words`);
    await H.key('Enter');
    assert.ok(await until(`!!document.querySelector('#modeDlg .tm-ed')`), `${w}: Keep returns to the editor`);
    assert.strictEqual(await js(`document.querySelectorAll('#modeDlg button[data-act="mark"]').length`), 2, `${w}: both briefs are still from the file`);
    assert.ok(/Plus a line\./.test(await js(`document.querySelector('#modeDlg fieldset.tm-mem textarea').value`)), `${w}: what was typed is kept`);
    assert.strictEqual(await importedMarks(), 'file,file', `${w}: the store still has both marks`);
    await focusSel('#modeDlg fieldset.tm-mem button[data-act="mark"]'); await H.key('Enter');
    assert.ok(await until(`/Mark this brief as yours/.test(document.querySelector('#modeDlg h3').textContent)`), `${w}: asked again`);
    await js(`[...document.querySelectorAll('#modeDlg .dbtn button')].find(b=>b.textContent==='Mark as mine').focus()`); await H.key('Enter');
    assert.ok(await until(`!!document.querySelector('#modeDlg .tm-ed')&&document.querySelectorAll('#modeDlg button[data-act="mark"]').length===1`), `${w}: the yes removed that mark`);
    assert.strictEqual(await importedMarks(), ',file', `${w}: the store lost that mark only`);
    assert.ok(await js(`/Plus a line\\./.test(document.querySelector('#modeDlg fieldset.tm-mem textarea').value)`), `${w}: the text is still there after the question`);
    // Esc with unsaved changes asks "Discard changes?" (Cancel focused); Cancel brings the editor back as it was; Discard closes
    await H.key('Escape');
    assert.ok(await until(`/Discard changes/.test((document.querySelector('#modeDlg h3')||{}).textContent||'')`), `${w}: Escape with unsaved changes asks`);
    assert.strictEqual(await js(`document.activeElement.textContent`), 'Cancel', `${w}: Cancel has the focus`);
    await H.key('Enter');
    assert.ok(await until(`!!document.querySelector('#modeDlg .tm-ed')&&/Plus a line\\./.test(document.querySelector('#modeDlg fieldset.tm-mem textarea').value)`), `${w}: Cancel brings the editor back with what was typed`);
    await H.key('Escape');
    assert.ok(await until(`/Discard changes/.test((document.querySelector('#modeDlg h3')||{}).textContent||'')`), `${w}: asked again`);
    await js(`[...document.querySelectorAll('#modeDlg .dbtn button')].find(b=>b.textContent==='Discard').focus()`); await H.key('Enter');
    assert.ok(await until(`!document.getElementById('modeDlg')`), `${w}: Discard closes the editor`);
  }

  // the app's state in words: an app that is not installed or too old says so in the select and in the member's description (simkinds=solo seeds both)
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, query: { simteams: 'imported', simkinds: 'solo' } });
    const put = await call('teamsPut', { name: 'State team', members: [{ ...member(1, 'claude'), role: 'Writer' }, { ...member(2, 'copilot'), role: 'Tester' }] });
    assert.strictEqual(put.ok, true, `${w}: a template with a member on an app that is not installed`);
    await openSettings();
    await focusSel('#teamsBox .tm-row[data-origin="own"] button[data-act="edit"]'); await H.key('Enter');
    assert.ok(await until(`!!document.querySelector('#modeDlg .tm-ed')`), `${w}: the editor opens`);
    const opts = await js(`[...document.querySelector('#modeDlg fieldset.tm-mem [id$="-app"]').options].map(o=>o.textContent)`);
    assert.deepStrictEqual(opts, ['Copilot (ready)', 'Claude Code (not installed)', 'Codex (too old)'], `${w}: each app says its state in words: ${JSON.stringify(opts)}`);
    const st = await js(`[...document.querySelectorAll('#modeDlg fieldset.tm-mem [id$="-st"]')].map(e=>e.textContent)`);
    assert.deepStrictEqual(st, ['App not installed', ''], `${w}: the member on the missing app says so, the ready one says nothing: ${JSON.stringify(st)}`);
    assert.strictEqual(await js(`document.querySelector('#modeDlg fieldset.tm-mem').getAttribute('aria-describedby')===document.querySelector('#modeDlg fieldset.tm-mem [id$="-st"]').id`), true, `${w}: the fieldset is described by its state`);
    await H.shot(path.join(OUT, `111-editor-state-${w}x${h}.png`), { prep: 'calm', blur: false, delay: 300 });
    await H.key('Escape');
    assert.ok(await until(`!document.getElementById('modeDlg')`), `${w}: Escape closes (nothing changed)`);
  }

  // a hostile name is text
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, query: { simteams: 'hostile', simkinds: 'mixed' } });
    await openSettings();
    await focusSel('#teamsBox button[data-act="edit"]'); await H.key('Enter');
    assert.ok(await until(`!!document.querySelector('#modeDlg .tm-ed')`), `${w}: the hostile template opens`);
    assert.strictEqual(await js(`document.querySelectorAll('#modeDlg img').length+':'+typeof window.__tmXss+':'+document.getElementById('tmEd-tname').value`), '0:undefined:<img src=x onerror=window.__tmXss=1>', `${w}: the name is a value, no element, nothing ran`);
    await H.key('Escape');
    assert.ok(await until(`!document.getElementById('modeDlg')`), `${w}: Escape with nothing changed closes at once`);
  }

  // the seeded refusals keep what was typed
  for (const seed of ['failed', 'changed']) {
    const [w, h] = [1280, 800];
    await H.load({ w, h, query: { simteams: seed, simkinds: 'mixed' } });
    await openSettings();
    await focusSel('#tmNew'); await H.key('Enter');
    assert.ok(await until(`!!document.querySelector('#modeDlg .tm-ed')`), `${seed}: editor open`);
    assert.ok(await until(`document.activeElement&&document.activeElement.id==='tmEd-tname'`), `${seed}: the focus starts on the template name`);
    await type('Keep me');
    assert.ok(await until(`document.getElementById('tmEd-tname').value==='Keep me'`), `${seed}: the template name was typed`);
    await js(`(()=>{const f=document.querySelector('#modeDlg fieldset.tm-mem');for(const [s,v] of [['-name','Ana'],['-role','Lead']]){const e=f.querySelector('[id$="'+s+'"]');e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))}})()`);
    await focusSel('#modeDlg .dbtn .primary'); await H.key('Enter');
    assert.ok(await until(`/What you typed is kept/.test(document.getElementById('tmEdErr').textContent)`), `${seed}: words, the dialog stays (note: ${await H.text('#tmEdErr')})`);
    assert.strictEqual(await js(`document.querySelector('#modeDlg fieldset.tm-mem [id$="-name"]').value`), 'Ana', `${seed}: what was typed is kept`);
    assert.ok(!/errors/.test(await H.text('#tmEdErr')), `${seed}: words only`);
    await H.shot(path.join(OUT, `111-editor-${seed}-${w}x${h}.png`), { prep: 'calm', blur: false, delay: 300 });
    await focusSel('#modeDlg .dbtn .primary'); await H.key('Enter');
    assert.ok(await until(seed === 'changed' ? `!document.getElementById('modeDlg')` : `!!document.querySelector('#modeDlg .tm-ed')`), `${seed}: ${seed === 'changed' ? 'Save again works after the refresh' : 'Save tries again and stays'}`);
    if (await H.exists('#modeDlg')) {
      await H.key('Escape');
      assert.ok(await until(`/Discard changes/.test((document.querySelector('#modeDlg h3')||{}).textContent||'')`), `${seed}: Escape with what was typed asks`);
      await js(`[...document.querySelectorAll('#modeDlg .dbtn button')].find(b=>b.textContent==='Discard').focus()`); await H.key('Enter');
    }
  }

  // shots in the three worlds, both sizes: an own template with members on three apps, the editor open
  const WORLDS = [
    ['open', {}, undefined],
    ['real', { officeview: 'real' }, `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`],
    ['retro', { officeview: 'real', worldflags: 'retro', world: 'retro' }, `!!document.querySelector('#stage .ro[data-world="retro"]')`],
  ];
  for (const [world, query, ready] of WORLDS) {
    for (const [w, h] of [[1440, 900], [1280, 800]]) {
      await H.load({ w, h, query: { simteams: 'imported', simkinds: 'mixed', ...query }, ...(ready ? { ready, settle: false } : {}) });
      const apps = (await call('listAdapters')).map((a) => a.id);
      const put = await call('teamsPut', { name: 'Shot team', description: 'A plain example', members: apps.slice(0, 3).map((a, i) => ({ ...member(i + 1, a), role: 'Role ' + (i + 1), brief: 'Read the change and list the risks.', sendBrief: true })) });
      assert.strictEqual(put.ok, true, `${world} ${w}: a template with members on ${apps.length} apps`);
      await openSettings();
      await focusSel('#teamsBox .tm-row[data-origin="own"] button[data-act="edit"]'); await H.key('Enter');
      assert.ok(await until(`!!document.querySelector('#modeDlg .tm-ed')`), `${world} ${w}: the editor opens`);
      assert.ok(await js(`(()=>{const r=document.querySelector('#modeDlg .dlg').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.right<=innerWidth})()`), `${world} ${w}: the dialog fits`);
      assert.strictEqual(await js(`[...document.querySelectorAll('#modeDlg .tm-ed *')].filter(e=>e.childNodes.length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).map(e=>parseFloat(getComputedStyle(e).fontSize)).filter(f=>f<10.5).length`), 0, `${world} ${w}: no text under 10.5px`);
      await H.shot(path.join(OUT, `111-editor-${world}-${w}x${h}.png`), { prep: 'calm', blur: false, delay: 400 });
      await H.key('Escape');
      assert.ok(await until(`!document.getElementById('modeDlg')`), `${world} ${w}: closed`);
      if (await H.exists('#scrClose')) await H.click('#scrClose');
      assert.ok(await js(`document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth`), `${world} ${w}: the office does not scroll`);
    }
  }
  console.log('[111] editor PASS');}
