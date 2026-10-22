/*
 * Spec 044 FR-022..FR-026 (issue #522): edit a schedule. Simulator only (no AI credits). Linux with xvfb-run:
 *
 *   npm run check:sched-edit
 *
 * At 1440x900 and 1280x800: every Durbar row in the folder's Schedules dialog shows Edit..., Pause and Delete inside the dialog; Edit
 * fills the form (title "Edit schedule", Save, Cancel, no template picker); Save changes the row in place (same data-id and order);
 * Cancel and Escape change nothing; a paused schedule stays paused; a done one-time schedule edited to a future time runs again
 * and a past time is refused; the prompt toggle works with a 2,000-character prompt and the dialog does not scroll sideways;
 * Settings > Schedules has the folder button on one line, nothing overlapping, and its Edit... opens the dialog in edit mode.
 * The clock is moved in the page (never slept) to finish a one-time schedule. A miss prints DRIVER FAILED (Electron still exits 0),
 * so the npm script exits non-zero unless "all checks passed" is printed. Writes 044-edit-form-<w>x<h>.png and 044-edit-settings-<w>x<h>.png.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';
const LONG = ('Check the build, then list what changed since yesterday and what is still open. ').repeat(30).slice(0, 1999) + 'x'; // exactly 2,000 characters, none of them trailing space

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const openDlg = async () => {
    await js(`document.getElementById('foldersBtn').click()`); await until(`!!document.querySelector('[data-fp="sched"]')`);
    await js(`document.querySelector('[data-fp="sched"]').click()`); await until(`!!document.getElementById('scAdd')`); await settle();
  };
  // adds through the form, like a user; `o` says what differs from the defaults: { kind, every, daily, cap }
  const add = async (prompt, o = {}) => {
    const n = await js(`document.querySelectorAll('#sdList .sc-row').length`);
    await js(`(()=>{const o=${jsLiteral(o)};document.getElementById('scPrompt').value=${jsLiteral(prompt)};if(o.kind)document.querySelector('input[name="scKind"][value="'+o.kind+'"]').checked=true;if(o.every)document.getElementById('scEvery').value=o.every;if(o.daily)document.getElementById('scDaily').value=o.daily;if(o.cap)document.getElementById('scCap').value=o.cap;return true})()`);
    await js(`document.getElementById('scAdd').click()`); await until(`document.querySelectorAll('#sdList .sc-row').length===${jsLiteral(n + 1)}`);
  };
  const rows = () => js(`[...document.querySelectorAll('#sdList .sc-row')].map(r=>({id:r.dataset.id,p:r.querySelector('.sc-p').textContent,line:r.querySelector('small').textContent,off:r.classList.contains('off'),btns:[...r.querySelectorAll('button:not(.sc-p)')].map(b=>b.textContent.trim())}))`);
  const edit = async (id) => { await js(`document.querySelector(${jsLiteral(`#sdList [data-sc="edit"][data-id="${id}"]`)}).click()`); await until(`!document.getElementById('scFormT').hidden`); await settle(); };
  const form = () => js(`({title:document.getElementById('scFormT').hidden?null:document.getElementById('scFormT').textContent,add:document.getElementById('scAdd').textContent,cancel:!document.getElementById('scCancel').hidden,tpl:(()=>{const l=document.getElementById('scTplL');return !l||l.hidden||!l.getClientRects().length})(),prompt:document.getElementById('scPrompt').value,kind:document.querySelector('input[name="scKind"]:checked').value,every:document.getElementById('scEvery').value,daily:document.getElementById('scDaily').value,at:document.getElementById('scAt').value,target:document.getElementById('scTarget').value,cap:document.getElementById('scCap').value,capVisible:!document.getElementById('scCapL').hidden})`);
  const toast = () => js(`[...document.querySelectorAll('#toasts .toast')].map(t=>t.textContent).join(' | ')`);
  const small = (tag) => js(`(()=>{const bad=[];for(const root of [document.getElementById('schedDlg'),document.getElementById('schedSet')]){if(!root)continue;for(const e of root.querySelectorAll('*')){if(!e.getClientRects().length)continue;if(![...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))continue;const f=parseFloat(getComputedStyle(e).fontSize);if(f<10.5)bad.push(e.tagName+':'+f)}}return bad})()`).then((bad) => assert.deepStrictEqual(bad, [], `${tag}: all text is at least 10.5px`));

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${w}x${h}`;
    await H.load({ w, h });
    await H.calm();
    await openDlg();

    // four schedules through the form: interval, calendar, one-time, and a 2,000-character prompt with a limit
    await add('alpha interval', { every: '45' });
    await add('bravo daily', { kind: 'daily', daily: '09:15' });
    await add('charlie once', { kind: 'once' });
    await add(LONG, { kind: 'every', every: '120', cap: '3' });
    let before = await rows();
    assert.strictEqual(before.length, 4);
    const [A, B, C, D] = before.map((r) => r.id);

    // FR-022: every Durbar row has Edit..., Pause and Delete, inside the dialog (the owner's report)
    for (const r of before) assert.deepStrictEqual(r.btns, ['Edit…', 'Pause', 'Delete'], `${tag}: buttons of "${r.p.slice(0, 20)}"`);
    let g = await js(`(()=>{const d=document.querySelector('#schedDlg .dlg').getBoundingClientRect();return {sw:document.querySelector('#schedDlg .dlg').scrollWidth-document.querySelector('#schedDlg .dlg').clientWidth,out:[...document.querySelectorAll('#sdList .sc-row button:not(.sc-p)')].filter(b=>{const r=b.getBoundingClientRect();return !b.getClientRects().length||r.left<d.left-0.5||r.right>d.right+0.5}).map(b=>b.textContent)}})()`);
    assert.deepStrictEqual(g.out, [], `${tag}: every row button is visible inside the dialog`);
    assert.ok(g.sw <= 1, `${tag}: no horizontal scroll in the dialog (${g.sw})`);

    // FR-025: the prompt toggle with a 2,000-character prompt
    const tg = await js(`(()=>{const b=document.querySelector(${jsLiteral(`#sdList [data-id="${D}"] .sc-p`)});const f=b.nextElementSibling;const a=[b.getAttribute('aria-expanded'),f.hidden];b.click();const o=[b.getAttribute('aria-expanded'),f.hidden,f.textContent.length];const d=document.querySelector('#schedDlg .dlg');return {a,o,title:b.title.length,sw:d.scrollWidth-d.clientWidth}})()`);
    assert.deepStrictEqual([tg.a, tg.o], [['false', true], ['true', false, 2000]], `${tag}: the toggle opens the whole prompt`);
    assert.ok(tg.title <= 300, `${tag}: tooltip is ${tg.title} characters`);
    assert.ok(tg.sw <= 1, `${tag}: no horizontal scroll with the whole prompt open (${tg.sw})`);
    await js(`document.querySelector(${jsLiteral(`#sdList [data-id="${D}"] .sc-p`)}).click()`);
    assert.strictEqual(await js(`document.querySelector(${jsLiteral(`#sdList [data-id="${D}"] .sc-p`)}).getAttribute('aria-expanded')`), 'false', `${tag}: the toggle folds it again`);
    await small(tag);

    // FR-022: Edit fills the form
    await edit(B);
    let f = await form();
    assert.deepStrictEqual([f.title, f.add, f.cancel, f.tpl, f.prompt, f.kind, f.daily, f.target], ['Edit schedule', 'Save', true, true, 'bravo daily', 'daily', '09:15', ''], `${tag}: edit form of the calendar schedule`);
    await edit(D);
    f = await form();
    assert.deepStrictEqual([f.prompt, f.kind, f.every, f.cap, f.capVisible], [LONG, 'every', '120', '3', true], `${tag}: edit form of the long prompt with a limit`);
    await edit(C);
    f = await form();
    assert.deepStrictEqual([f.prompt, f.kind], ['charlie once', 'once']);
    assert.match(f.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d$/, `${tag}: the one-time schedule shows its time`);
    await edit(B);
    await ctx.shot(path.join(OUT, `044-edit-form-${tag}.png`));

    // Cancel changes nothing
    await js(`document.getElementById('scPrompt').value='typed and abandoned';document.getElementById('scCancel').click()`);
    await until(`document.getElementById('scFormT').hidden`);
    f = await form();
    assert.deepStrictEqual([f.title, f.add, f.prompt, f.cancel], [null, 'Add schedule', '', false], `${tag}: Cancel goes back to the add form`);
    assert.deepStrictEqual(await rows(), before, `${tag}: Cancel changed nothing`);

    // Save changes the row in place
    await edit(B);
    await js(`document.getElementById('scPrompt').value='bravo daily, edited';document.getElementById('scDaily').value='10:45'`);
    await js(`document.getElementById('scAdd').click()`); await until(`document.querySelector(${jsLiteral(`#sdList [data-id="${B}"] .sc-p`)}).textContent==='bravo daily, edited'`);
    let after = await rows();
    assert.deepStrictEqual(after.map((r) => r.id), [A, B, C, D], `${tag}: Save keeps the order and the ids`);
    assert.match(after[1].line, /every day at 10:45/, `${tag}: the row shows the new time`);
    for (const i of [0, 2, 3]) assert.deepStrictEqual(after[i], before[i], `${tag}: the other rows are untouched`);
    assert.strictEqual((await form()).title, null, `${tag}: Save leaves edit mode`);
    // the limit of an edited schedule stays
    await edit(D); await js(`document.getElementById('scAdd').click()`);
    await until(`document.getElementById('scFormT').hidden`);
    assert.match((await rows())[3].line, /of 3 AIU/, `${tag}: saving without touching the limit keeps it`);
    before = await rows();

    // Escape closes the dialog and changes nothing
    await edit(A);
    await js(`document.getElementById('scPrompt').value='abandoned by Escape';document.getElementById('schedDlg').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    await until(`!document.getElementById('schedDlg')`);
    await openDlg();
    assert.deepStrictEqual(await rows(), before, `${tag}: Escape changed nothing`);
    assert.strictEqual((await form()).title, null, `${tag}: the dialog opens as the add form`);

    // a paused schedule stays paused after Save
    await js(`document.querySelector(${jsLiteral(`#sdList [data-sc="pause"][data-id="${A}"]`)}).click()`); await until(`document.querySelector(${jsLiteral(`#sdList [data-id="${A}"]`)}).classList.contains('off')`);
    await edit(A);
    await js(`document.getElementById('scPrompt').value='alpha interval, edited';document.getElementById('scAdd').click()`);
    await until(`document.querySelector(${jsLiteral(`#sdList [data-id="${A}"] .sc-p`)}).textContent==='alpha interval, edited'`);
    const pa = (await rows())[0];
    assert.deepStrictEqual([pa.off, pa.btns[1], /paused/.test(pa.line)], [true, 'Resume', true], `${tag}: still paused after Save`);

    // Settings > Schedules
    await js(`document.getElementById('scClose').click()`); await until(`!document.getElementById('schedDlg')`);
    await js(`document.getElementById('settingsBtn').click()`); await until(`document.querySelectorAll('#schedSet .sc-row').length===4`); await settle();
    const st = await js(`(()=>{const b=document.querySelector('#schedSet [data-ss="open"]'),head=b.parentElement;const box=e=>{const r=e.getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom}};const kids=[...head.children].map(box),bb=box(b);const ov=[...head.children].filter(c=>c!==b).some(c=>{const r=box(c);return r.l<bb.r-0.5&&bb.l<r.r-0.5&&r.t<bb.b-0.5&&bb.t<r.b-0.5});const lh=parseFloat(getComputedStyle(b).lineHeight)||parseFloat(getComputedStyle(b).fontSize)*1.3;const sec=b.closest('section').getBoundingClientRect();const rowBtns=[...document.querySelectorAll('#schedSet .sc-row')].map(r=>[...r.querySelectorAll('button:not(.sc-p)')].map(x=>x.textContent.trim()).join('/'));return {text:b.textContent.trim(),h:b.getBoundingClientRect().height,lh,ov,inside:bb.r<=sec.right+0.5,rowBtns}})()`);
    assert.strictEqual(st.text, 'Schedules for this folder…');
    assert.ok(st.h <= st.lh * 1.5 + 14, `${tag}: the folder button is one line (height ${st.h})`); // padding included; two lines would be well over it
    assert.ok(!st.ov && st.inside, `${tag}: nothing overlaps the folder button`);
    assert.ok(st.rowBtns.every((x) => x === 'Edit…/Pause/Delete' || x === 'Edit…/Resume/Delete'), `${tag}: Settings rows: ${st.rowBtns}`);
    await small(tag);
    await js(`(()=>{const sec=document.getElementById('schH').closest('section');sec.scrollIntoView({block:'start'})})()`); await settle();
    await ctx.shot(path.join(OUT, `044-edit-settings-${tag}.png`));
    await js(`document.querySelector(${jsLiteral(`#schedSet [data-ss="edit"][data-id="${C}"]`)}).click()`); await until(`!!document.getElementById('scFormT')&&!document.getElementById('scFormT').hidden`);
    f = await form();
    assert.deepStrictEqual([f.title, f.add, f.prompt], ['Edit schedule', 'Save', 'charlie once'], `${tag}: Settings Edit opens the dialog in edit mode`);
    await js(`document.getElementById('scClose').click()`); await until(`!document.getElementById('schedDlg')`);

    // a done one-time schedule: finish it by moving the page's clock, then edit it
    await H.load({ w, h });
    await H.calm();
    await openDlg();
    await add('once and done', { kind: 'once' });
    const O = (await rows())[0].id;
    await js(`(()=>{if(!window.__realNow)window.__realNow=Date.now;const o=window.__realNow;window.__skew=3*3600e3;Date.now=()=>o.call(Date)+window.__skew;return true})()`);
    await until(`document.querySelector('#sdList .sc-row small').textContent.includes('done')`, 15000);
    await js(`(()=>{Date.now=window.__realNow;return true})()`);
    assert.ok((await rows())[0].line.includes('done'), `${tag}: the one-time schedule is done`);
    await edit(O);
    await js(`(()=>{const x=new Date(Date.now()-3600e3),p=n=>String(n).padStart(2,'0');document.getElementById('scAt').value=x.getFullYear()+'-'+p(x.getMonth()+1)+'-'+p(x.getDate())+'T'+p(x.getHours())+':'+p(x.getMinutes());document.getElementById('scAdd').click();return true})()`);
    await until(`[...document.querySelectorAll('#toasts .toast')].some(t=>/future/.test(t.textContent))`);
    assert.match(await toast(), /Pick a time in the future to run it again\./, `${tag}: a past time is refused with the message`);
    assert.ok((await rows())[0].line.includes('done'), `${tag}: still done after the refusal`);
    assert.notStrictEqual((await form()).title, null, `${tag}: the form stays open after a refusal`);
    await js(`(()=>{const x=new Date(Date.now()+2*3600e3),p=n=>String(n).padStart(2,'0');document.getElementById('scAt').value=x.getFullYear()+'-'+p(x.getMonth()+1)+'-'+p(x.getDate())+'T'+p(x.getHours())+':'+p(x.getMinutes());document.getElementById('scAdd').click();return true})()`);
    await until(`document.getElementById('scFormT').hidden&&!document.querySelector('#sdList .sc-row small').textContent.includes('done')`);
    const again = (await rows())[0];
    assert.deepStrictEqual([again.id, again.off, /done/.test(again.line), again.btns], [O, false, false, ['Edit…', 'Pause', 'Delete']], `${tag}: a future time runs it again`);
    console.log('[sched-edit]', tag, 'ok');
  }
  console.log('[sched-edit] all checks passed');
};
