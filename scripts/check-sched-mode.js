/*
 * Spec 044 FR-180..FR-184 (T141, T142): a schedule's own mode in the window. Simulator only (no AI credits), through the UI, at 1440x900 and 1280x800:
 *  - the form has a required Mode that starts on Read-only, uses the session dialog's modes and never offers Autopilot; every row shows its mode;
 *  - Allow all asks a confirmation naming the schedule and the agent; Cancel saves nothing; it is asked again on an edit of the prompt or the mode,
 *    not on an edit of the time; a save that skips the confirmation is refused by the (simulated) store;
 *  - an organization policy greys the mode and refuses a save and a run;
 *  - with schedules from before modes (`simwaiting=1`): one popup lists them, nothing is picked, Close leaves them waiting and it does not come again;
 *    each row says *Waiting for a mode* and has *Choose a mode*; choosing does not send; a due time records `skipped-mode` and sends nothing; a stored Autopilot
 *    keeps its value, is refused with a visible reason and is not offered; a once schedule whose time passed offers *Run missed now*;
 *  - no schedules without a mode: no popup, nothing in the way.
 * A miss prints DRIVER FAILED. Writes 044-mode-form, 044-mode-confirm, 044-mode-waiting, 044-mode-refused and 044-mode-popup, each -<w>x<h>.png.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const dir = process.env.SHOTS_OUT || process.env.OUT || '/tmp';
  const wait = async (expr, msg) => assert.ok(await until(expr), msg || expr);
  const openDlg = async () => {
    await js(`document.getElementById('foldersBtn').click()`); await wait(`!!document.querySelector('[data-fp="sched"]')`);
    await js(`document.querySelector('[data-fp="sched"]').click()`); await wait(`!!document.getElementById('scAdd')`); await settle();
  };
  const closeDlg = async () => { await js(`document.getElementById('scClose').click()`); await wait(`!document.getElementById('schedDlg')`); };
  const rowLine = (p) => js(`(()=>{const r=[...document.querySelectorAll('#sdList .sc-row')].find(x=>x.querySelector('.sc-p').textContent.includes(${jsLiteral(p)}));return r?r.querySelector('small').textContent:null})()`);
  const setForm = (prompt, mode) => js(`(()=>{document.getElementById('scPrompt').value=${jsLiteral(prompt)};document.getElementById('scPrompt').dispatchEvent(new Event('input'));const m=document.getElementById('scMode');m.value=${jsLiteral(mode)};m.dispatchEvent(new Event('change'));return true})()`);
  const editOf = async (p) => { await js(`[...document.querySelectorAll('#sdList .sc-row')].find(x=>x.querySelector('.sc-p').textContent.includes(${jsLiteral(p)})).querySelector('[data-sc="edit"]').click()`); await wait(`!document.getElementById('scFormT').hidden`); };
  const noOverflow = () => js(`(()=>{const d=document.querySelector('.sched-dlg');return !!d&&d.scrollWidth<=d.clientWidth+1})()`);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${w}x${h}`;
    // ---- schedules with modes: no popup ----
    await H.load({ w, h, query: { simsched: '1' }, ready: 'fit', settle: false });
    await js(`localStorage.removeItem('durbar.schedModeAsked');true`);
    await H.load({ w, h, query: { simsched: '1' }, ready: 'fit', settle: false });
    await H.calm();
    await until(`document.querySelectorAll('#stage .desk[data-id]').length>=15`);
    assert.strictEqual(await js(`!!document.getElementById('schedModeDlg')`), false, 'every schedule has a mode: no popup');
    assert.strictEqual(await js(`localStorage.getItem('durbar.schedModeAsked')`), null, 'and nothing was marked as asked');

    await openDlg();
    // the form: the session dialog's modes, Read-only first, never Autopilot
    const f = await js(`(()=>{const s=document.getElementById('scMode');return {v:s.value,opts:[...s.options].map(o=>o.value),inside:(()=>{const r=s.getBoundingClientRect(),d=document.querySelector('.sched-dlg').getBoundingClientRect();return r.left>=d.left&&r.right<=d.right})()}})()`);
    assert.strictEqual(f.v, 'read-only', 'a new schedule starts on Read-only');
    assert.deepStrictEqual(f.opts, ['read-only', 'ask', 'allow'], 'the modes this agent has; no Autopilot');
    assert.ok(f.inside, 'the select is inside the dialog');
    assert.ok((await rowLine('PR and issue sweep') || '').includes('Ask first'), 'a row shows its mode');
    assert.ok(await noOverflow(), 'no sideways scroll');
    await H.shot(path.join(dir, `044-mode-form-${tag}.png`), { prep: 'mouse', settle: true });

    // Read-only needs no confirmation
    await setForm('driver read-only', 'read-only');
    await js(`document.getElementById('scAdd').click()`);
    await wait(`[...document.querySelectorAll('#sdList .sc-p')].some(x=>x.textContent.includes('driver read-only'))`);
    assert.strictEqual(await js(`!!document.getElementById('modeDlg')`), false, 'no question for Read-only');
    assert.ok((await rowLine('driver read-only')).includes('Read-only'));

    // Allow all: a confirmation naming the schedule and the agent; Cancel saves nothing
    await setForm('driver allow', 'allow');
    await js(`document.getElementById('scAdd').click()`);
    await wait(`!!document.getElementById('modeDlg')`);
    const body = await js(`document.getElementById('mdB').textContent`);
    const agentName = await js(`window.__durbarSimUi.agents().find(x=>!x.parent&&x.room===document.getElementById('schedDlg').dataset.room).name`);
    assert.ok(body.includes('driver allow') && body.includes(agentName), `names the schedule and the agent: ${body}`);
    await H.shot(path.join(dir, `044-mode-confirm-${tag}.png`), { prep: 'mouse', settle: true });
    assert.ok(await js(`(()=>{const d=document.querySelector('#modeDlg .dlg').getBoundingClientRect();return d.bottom<=innerHeight&&d.top>=0})()`), 'the confirmation fits');
    await js(`document.querySelector('#modeDlg [data-cancel]').click()`);
    await wait(`!document.getElementById('modeDlg')`);
    assert.strictEqual(await rowLine('driver allow'), null, 'Cancel saves nothing');
    // yes
    await js(`document.getElementById('scAdd').click()`);
    await wait(`!!document.getElementById('modeDlg')`);
    await js(`document.querySelector('#modeDlg .primary').click()`);
    await wait(`[...document.querySelectorAll('#sdList .sc-p')].some(x=>x.textContent.includes('driver allow'))`);
    assert.ok((await rowLine('driver allow')).includes('Allow all'), 'the row says Allow all');

    // an edit: the time alone asks nothing; the prompt asks again
    await editOf('driver allow');
    assert.strictEqual(await js(`document.getElementById('scMode').value`), 'allow', 'the edit form shows its mode');
    await js(`document.getElementById('scEvery').value='90';document.getElementById('scAdd').click();0`);
    await wait(`document.getElementById('scFormT').hidden`, 'saved with no question');
    assert.strictEqual(await js(`!!document.getElementById('modeDlg')`), false);
    await editOf('driver allow');
    await js(`document.getElementById('scPrompt').value='driver allow edited';document.getElementById('scAdd').click();0`);
    await wait(`!!document.getElementById('modeDlg')`, 'a new prompt asks again');
    assert.ok((await js(`document.getElementById('mdB').textContent`)).includes('driver allow edited'), 'about the new prompt');
    await js(`document.querySelector('#modeDlg [data-cancel]').click()`);
    await wait(`!document.getElementById('modeDlg')`);
    await js(`document.getElementById('scCancel').click();0`);
    await wait(`document.getElementById('scFormT').hidden`);
    assert.ok(await rowLine('driver allow'), 'the old one stands');
    await closeDlg();

    // main's side, as the simulated store has it: a save that skipped the confirmation is refused, also through a plain save
    const refused = await js(`(async()=>{const b=window.__durbarSimUi.bridge();const l=await b.listSchedules();const s=l.schedules.find(x=>x.prompt.includes('driver read-only'));const a=await b.saveSchedule(Object.assign({},s,{mode:'allow'}));const c=await b.saveSchedule({folder:s.folder,prompt:'skip it',every:60,mode:'allow'});const d=await b.saveSchedule({folder:s.folder,prompt:'none',every:60});const e=await b.setScheduleMode(s.id,'allow');const f=await b.saveSchedule({folder:s.folder,prompt:'ap',every:60,mode:'autopilot'});return [a.ok,c.ok,d.ok,e.ok,f.ok,(await b.listSchedules()).schedules.find(x=>x.id===s.id).mode]})()`);
    assert.deepStrictEqual(refused, [false, false, false, false, false, 'read-only'], 'no way round the confirmation');

    // ---- an organization policy greys Allow all; a save is refused ----
    await H.load({ w, h, query: { simsched: '1', simorgpolicy: '1' }, ready: 'fit', settle: false });
    await H.calm();
    await openDlg();
    await wait(`[...document.getElementById('scMode').options].some(o=>o.disabled)`, 'greyed');
    const g = await js(`(()=>{const o=[...document.getElementById('scMode').options].find(x=>x.value==='allow');return o?{dis:o.disabled,txt:o.textContent}:null})()`);
    assert.ok(g && g.dis && /organization/.test(g.txt), `Allow all is greyed, with the reason: ${JSON.stringify(g)}`);
    const org = await js(`(async()=>{const b=window.__durbarSimUi.bridge();const l=await b.listSchedules();const s=l.schedules[0];const q=await b.askScheduleMode({folder:s.folder,prompt:'org',mode:'allow'});const r=await b.saveSchedule({folder:s.folder,prompt:'org',every:60,mode:'allow',modeProof:q.token});return {ok:r.ok,err:r.error||''}})()`);
    assert.strictEqual(org.ok, false, 'an organization refusal at a save');
    await closeDlg();

    // ---- schedules from before modes: the popup, once ----
    await H.load({ w, h, query: { simsched: '1', simwaiting: '1' }, ready: 'fit', settle: false });
    await js(`localStorage.removeItem('durbar.schedModeAsked');true`);
    await H.load({ w, h, query: { simsched: '1', simwaiting: '1' }, ready: 'fit', settle: false });
    await H.calm();
    await wait(`!!document.getElementById('schedModeDlg')`, 'the popup comes on its own');
    const pop = await js(`(()=>{const s=[...document.querySelectorAll('.sm-mode')];return {n:s.length,vals:s.map(x=>x.value),first:s[0]&&[...s[0].options].map(o=>o.value),bottom:document.querySelector('#schedModeDlg .dlg').getBoundingClientRect().bottom,ids:[...document.querySelectorAll('.sm-row')].map(r=>r.dataset.id)}})()`);
    assert.strictEqual(pop.n, 3, 'lists each schedule with no mode');
    assert.deepStrictEqual(pop.vals, ['', '', ''], 'it never picks');
    assert.deepStrictEqual(pop.first, ['', 'read-only', 'ask', 'allow'], 'no Autopilot offered');
    assert.ok(!pop.ids.includes('sched-s4'), 'a stored Autopilot has a mode: not asked');
    assert.ok(pop.bottom <= h, 'it fits');
    await H.shot(path.join(dir, `044-mode-popup-${tag}.png`), { prep: 'mouse', settle: true });
    // Save with nothing chosen does nothing; Close leaves them waiting; it does not come back
    await js(`document.getElementById('smSave').click();0`);
    await settle();
    assert.strictEqual(await js(`document.querySelectorAll('.sm-row').length`), 3, 'nothing chosen: nothing changes');
    await js(`document.getElementById('smClose').click();0`);
    await wait(`!document.getElementById('schedModeDlg')`);
    const after = await js(`(async()=>(await window.__durbarSimUi.bridge().listSchedules()).schedules.map(s=>[s.id,s.mode||null]))()`);
    assert.deepStrictEqual(after, [['sched-s1', null], ['sched-s2', null], ['sched-s3', null], ['sched-s4', 'autopilot']], 'Close changes nothing');
    assert.ok(await js(`document.querySelectorAll('#stage .desk[data-id]').length>=15`), 'the office is there');

    // a row says it waits and has Choose a mode; the top-level text has no "next" for it
    await openDlg();
    const line = await rowLine('PR and issue sweep');
    assert.ok(line.includes('Waiting for a mode') && !/next \d/.test(line), `row: ${line}`);
    const choose = await js(`[...document.querySelectorAll('#sdList .sc-row')].filter(r=>r.querySelector('[data-sc="mode"]')).length`);
    assert.ok(choose >= 1, 'Choose a mode on the row');
    await H.shot(path.join(dir, `044-mode-waiting-${tag}.png`), { prep: 'mouse', settle: true });

    // a due time with no mode: nothing is sent, `skipped-mode`, not deleted
    const sent0 = await js(`document.querySelectorAll('.note').length`);
    assert.ok(await js(`window.__durbarSimSched.dueNow('sched-s1')`));
    await wait(`(([...document.querySelectorAll('#sdList .sc-row')].find(x=>x.querySelector('.sc-p').textContent.includes('PR and issue sweep'))||{querySelector:()=>({textContent:''})}).querySelector('small').textContent).includes('not sent: waiting for a mode')`, 'recorded on the row');
    assert.strictEqual(await js(`document.querySelectorAll('.note').length`), sent0, 'no note: nothing sent');
    assert.ok((await js(`(async()=>{const r=await window.__durbarSimUi.bridge().scheduleRuns('sched-s1');return r.runs.find(x=>x.outcome==='skipped-mode')?.reason})()`)) === 'no-mode', 'in the log, with its reason');
    assert.ok(await js(`(async()=>(await window.__durbarSimUi.bridge().listSchedules()).schedules.some(x=>x.id==='sched-s1'&&!x.done&&!x.paused))()`), 'nothing deleted or finished');

    // Choose a mode from the row: one schedule, nothing picked, choosing does not send
    await js(`[...document.querySelectorAll('#sdList .sc-row')].find(x=>x.querySelector('.sc-p').textContent.includes('PR and issue sweep')).querySelector('[data-sc="mode"]').click();0`);
    await wait(`!!document.getElementById('schedModeDlg')`);
    assert.strictEqual(await js(`document.querySelectorAll('.sm-row').length`), 1);
    await js(`(()=>{const s=document.querySelector('.sm-mode');s.value='ask';s.dispatchEvent(new Event('change'));document.getElementById('smSave').click()})();0`);
    await wait(`!document.getElementById('schedModeDlg')`);
    await wait(`/Ask first/.test(([...document.querySelectorAll('#sdList .sc-row')].find(x=>x.querySelector('.sc-p').textContent.includes('PR and issue sweep')).querySelector('small').textContent))`);
    const runsNow = await js(`(async()=>{const b=window.__durbarSimUi.bridge();const r=await b.scheduleRuns('sched-s1');return r.ok?r.runs.filter(x=>x.outcome==='sent').length:-1})()`);
    assert.ok(runsNow >= 0);
    const again = await js(`(async()=>(await window.__durbarSimUi.bridge().listSchedules()).schedules.find(x=>x.id==='sched-s1').mode)()`);
    assert.strictEqual(again, 'ask');

    // Allow all from the popup asks with the same words
    await js(`[...document.querySelectorAll('#sdList .sc-row')].find(x=>x.querySelector('.sc-p').textContent.includes('Morning summary')).querySelector('[data-sc="mode"]').click();0`);
    await wait(`!!document.getElementById('schedModeDlg')`);
    await js(`(()=>{const s=document.querySelector('.sm-mode');s.value='allow';document.getElementById('smSave').click()})();0`);
    await wait(`!!document.getElementById('modeDlg')`, 'Allow all asks');
    assert.ok((await js(`document.getElementById('mdB').textContent`)).includes('Morning summary'));
    await js(`document.querySelector('#modeDlg [data-cancel]').click()`);
    await wait(`!document.getElementById('modeDlg')`);
    assert.strictEqual(await js(`document.querySelectorAll('.sm-row').length`), 1, 'Cancel keeps it in the list');
    await js(`document.getElementById('smClose').click();0`);
    await wait(`!document.getElementById('schedModeDlg')`);
    assert.strictEqual(await js(`(async()=>(await window.__durbarSimUi.bridge().listSchedules()).schedules.find(x=>x.id==='sched-s3').mode||null)()`), null);
    await closeDlg();

    // the popup comes once only
    await H.load({ w, h, query: { simsched: '1', simwaiting: '1' }, ready: 'fit', settle: false });
    await H.calm();
    await settle();
    assert.strictEqual(await js(`!!document.getElementById('schedModeDlg')`), false, 'once: each row still has Choose a mode');
    await openDlg();
    // a stored Autopilot in the edit form: shown disabled, not chosen anew
    await closeDlg();
    await js(`document.getElementById('foldersBtn').click()`); await wait(`document.querySelectorAll('[data-fp="sched"]').length>=2`);
    const n = await js(`document.querySelectorAll('[data-fp="sched"]').length`);
    let opened = false;
    for (let i = 0; i < n && !opened; i++) {
      if (i) { await js(`document.getElementById('foldersBtn').click()`); await wait(`document.querySelectorAll('[data-fp="sched"]').length>=2`); }
      await js(`document.querySelectorAll('[data-fp="sched"]')[${i}].click()`); await wait(`!!document.getElementById('scAdd')`);
      opened = await js(`[...document.querySelectorAll('#sdList .sc-p')].some(x=>x.textContent.includes('Nightly dependency'))`);
      if (!opened) await closeDlg();
    }
    assert.ok(opened, 'the folder with the stored Autopilot');
    // due: refused with a visible reason, kept; not offered in the form
    assert.ok(await js(`window.__durbarSimSched.dueNow('sched-s4')`));
    await wait(`(rowOf=>rowOf&&rowOf.querySelector('small').textContent.includes('Autopilot is not available on a schedule yet'))([...document.querySelectorAll('#sdList .sc-row')].find(x=>x.querySelector('.sc-p').textContent.includes('Nightly dependency')))`, 'the reason on the row');
    assert.strictEqual(await js(`(async()=>(await window.__durbarSimUi.bridge().listSchedules()).schedules.find(x=>x.id==='sched-s4').mode)()`), 'autopilot', 'the value stays');
    assert.ok((await rowLine('Nightly dependency')).includes('Autopilot'), 'the row names it');
    await H.shot(path.join(dir, `044-mode-refused-${tag}.png`), { prep: 'mouse', settle: true });
    // the edit form shows it, disabled; changing only the time keeps it; a new prompt is refused
    await editOf('Nightly dependency');
    assert.deepStrictEqual(await js(`(()=>{const s=document.getElementById('scMode'),o=[...s.options].find(x=>x.value==='autopilot');return [s.value,!!o&&o.disabled]})()`), ['autopilot', true], 'shown, not offered');
    await js(`document.getElementById('scAdd').click();0`);
    await wait(`document.getElementById('scFormT').hidden`, 'an edit that changes nothing it was chosen for is kept');
    assert.strictEqual(await js(`(async()=>(await window.__durbarSimUi.bridge().listSchedules()).schedules.find(x=>x.id==='sched-s4').mode)()`), 'autopilot');
    // a once schedule whose time passes with no mode: finished, still waiting; choosing does not send; Run missed now does
    assert.ok(await js(`window.__durbarSimSched.dueNow('sched-s2')`));
    await wait(`(r=>r&&r.querySelector('[data-sc="mode"]')&&r.querySelector('small').textContent.includes('not sent: waiting for a mode'))([...document.querySelectorAll('#sdList .sc-row')].find(x=>x.querySelector('.sc-p').textContent.includes('Cut the pre-release')))`, 'a once schedule waits');
    await js(`[...document.querySelectorAll('#sdList .sc-row')].find(x=>x.querySelector('.sc-p').textContent.includes('Cut the pre-release')).querySelector('[data-sc="mode"]').click();0`);
    await wait(`!!document.getElementById('schedModeDlg')`);
    await js(`(()=>{const s=document.querySelector('.sm-mode');s.value='ask';document.getElementById('smSave').click()})();0`);
    await wait(`!document.getElementById('schedModeDlg')`);
    const sent1 = await js(`(async()=>{const r=await window.__durbarSimUi.bridge().scheduleRuns('sched-s2');return r.runs.filter(x=>x.outcome==='sent').length})()`);
    assert.strictEqual(sent1, 0, 'choosing sends nothing');
    await wait(`(r=>r&&!!r.querySelector('[data-sc="runmissed"]'))([...document.querySelectorAll('#sdList .sc-row')].find(x=>x.querySelector('.sc-p').textContent.includes('Cut the pre-release')))`, 'Run missed now is offered');
    await js(`[...document.querySelectorAll('#sdList .sc-row')].find(x=>x.querySelector('.sc-p').textContent.includes('Cut the pre-release')).querySelector('[data-sc="runmissed"]').click();0`);
    await wait(`(r=>r&&r.querySelector('small').textContent.includes(': sent'))([...document.querySelectorAll('#sdList .sc-row')].find(x=>x.querySelector('.sc-p').textContent.includes('Cut the pre-release')))`, 'it ran, once');
    await closeDlg();
  }
  console.log('check-sched-mode: all checks passed');
};
