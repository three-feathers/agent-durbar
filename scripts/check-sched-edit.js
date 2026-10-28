/*
 * Spec 044 FR-022..FR-026 (issue #522): edit a schedule. Simulator only (no AI credits). Linux with xvfb-run:
 *
 *   npm run check:sched-edit
 *
 * At 1440x900 and 1280x800: every Durbar row in the folder's Schedules dialog shows Edit..., Pause, Delete and History (spec 044 FR-040) inside the dialog; Edit
 * fills the form (title "Edit schedule", Save, Cancel, no template picker); Save changes the row in place (same data-id and order);
 * Cancel and Escape change nothing; a paused schedule stays paused; a done one-time schedule edited to a future time runs again
 * and a past time is refused; the prompt toggle works with a 10,000-character prompt (the limit) and the dialog does not scroll sideways;
 * the prompt box never cuts a paste: 12,000 characters stay, with the error in words, aria-describedby and aria-invalid, and Save disabled; the counter from 80%;
 * a stored prompt over the limit (the simulator's `addRaw`) shows Needs review on its row, with Edit... (spec 044 FR-121..FR-124);
 * Settings > Schedules has the folder button on one line, nothing overlapping, and its Edit... opens the dialog in edit mode.
 * The clock is moved in the page (never slept) to finish a one-time schedule. A miss prints DRIVER FAILED (Electron still exits 0),
 * so the npm script exits non-zero unless "all checks passed" is printed. Writes 044-edit-form-<w>x<h>.png and 044-edit-settings-<w>x<h>.png.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';
const LIMIT = 10000; // spec 044 FR-120 (issue #843): the longest prompt
const text = (n) => ('Check the build, then list what changed since yesterday and what is still open. ').repeat(Math.ceil(n / 70) + 1).slice(0, n - 1) + 'x'; // exactly n characters, none of them trailing space
const LONG = text(LIMIT);

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

    // four schedules through the form: interval, calendar, one-time, and a 10,000-character prompt (the limit) with a limit
    await add('alpha interval', { every: '45' });
    await add('bravo daily', { kind: 'daily', daily: '09:15' });
    await add('charlie once', { kind: 'once' });
    await add(LONG, { kind: 'every', every: '120', cap: '3' });
    let before = await rows();
    assert.strictEqual(before.length, 4);
    const [A, B, C, D] = before.map((r) => r.id);

    // FR-022: every Durbar row has Edit..., Pause and Delete, inside the dialog (the owner's report)
    for (const r of before) assert.deepStrictEqual(r.btns, ['Edit…', 'Pause', 'Delete', 'History'], `${tag}: buttons of "${r.p.slice(0, 20)}"`);
    let g = await js(`(()=>{const d=document.querySelector('#schedDlg .dlg').getBoundingClientRect();return {sw:document.querySelector('#schedDlg .dlg').scrollWidth-document.querySelector('#schedDlg .dlg').clientWidth,out:[...document.querySelectorAll('#sdList .sc-row button:not(.sc-p)')].filter(b=>{const r=b.getBoundingClientRect();return !b.getClientRects().length||r.left<d.left-0.5||r.right>d.right+0.5}).map(b=>b.textContent)}})()`);
    assert.deepStrictEqual(g.out, [], `${tag}: every row button is visible inside the dialog`);
    assert.ok(g.sw <= 1, `${tag}: no horizontal scroll in the dialog (${g.sw})`);

    // FR-025: the prompt toggle with a 10,000-character prompt
    const tg = await js(`(()=>{const b=document.querySelector(${jsLiteral(`#sdList [data-id="${D}"] .sc-p`)});const f=b.nextElementSibling;const a=[b.getAttribute('aria-expanded'),f.hidden];b.click();const o=[b.getAttribute('aria-expanded'),f.hidden,f.textContent.length];const d=document.querySelector('#schedDlg .dlg');return {a,o,title:b.title.length,sw:d.scrollWidth-d.clientWidth}})()`);
    assert.deepStrictEqual([tg.a, tg.o], [['false', true], ['true', false, LIMIT]], `${tag}: the toggle opens the whole prompt`);
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
    assert.ok(st.rowBtns.every((x) => x === 'Edit…/Pause/Delete/History' || x === 'Edit…/Resume/Delete/History'), `${tag}: Settings rows: ${st.rowBtns}`);
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
    assert.deepStrictEqual([again.id, again.off, /done/.test(again.line), again.btns], [O, false, false, ['Edit…', 'Pause', 'Delete', 'History']], `${tag}: a future time runs it again`);
    // FR-022: a schedule sent to one session, edited from Settings, shows that session's name in Send to
    await js(`document.getElementById('scClose').click()`); await until(`!document.getElementById('schedDlg')`);
    await js(`document.querySelector('#stage .desk[data-id]').click()`); await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('schedHdrBtn')`); await settle();
    await js(`document.getElementById('schedHdrBtn').click()`); await until(`!!document.getElementById('scTarget')&&document.getElementById('scTarget').options.length===2`);
    const sess = await js(`(()=>{const t=document.getElementById('scTarget');t.value=t.options[1].value;t.dispatchEvent(new Event('change'));return {id:t.value,name:document.getElementById('scToHint').textContent}})()`);
    assert.ok(sess.id && sess.name, `${tag}: This session has a name`);
    await add('for one session');
    const T = (await rows()).find((r) => r.p === 'for one session');
    assert.match(T.line, /→/, `${tag}: the row says it goes to a session`);
    await js(`document.getElementById('scClose').click()`); await until(`!document.getElementById('schedDlg')`);
    await js(`document.getElementById('backBtn').click()`); await until(`!document.body.classList.contains('panel-open')`); await settle();
    await js(`document.getElementById('settingsBtn').click()`); await until(`!!document.querySelector(${jsLiteral(`#schedSet [data-ss="edit"][data-id="${T.id}"]`)})`);
    await js(`document.querySelector(${jsLiteral(`#schedSet [data-ss="edit"][data-id="${T.id}"]`)}).click()`); await until(`!!document.getElementById('scFormT')&&!document.getElementById('scFormT').hidden`); await settle();
    const sd = await js(`({v:document.getElementById('scTarget').value,hint:document.getElementById('scToHint').textContent,hidden:document.getElementById('scToHint').hidden})`);
    assert.deepStrictEqual([sd.v, sd.hint, sd.hidden], [sess.id, sess.name, false], `${tag}: Send to shows the session's name when edited from Settings`);
    // a Limit typed for one unit is cleared when Send to moves to an agent that counts in another (simkinds=mixed: Lena's room agent counts in dollars, Lena's own app (Codex) reports no unit)
    await js(`document.getElementById('scClose').click()`); await until(`!document.getElementById('schedDlg')`);
    await js(`(()=>{const b=document.getElementById('backBtn');if(b&&document.body.classList.contains('panel-open'))b.click();return true})()`);
    await H.load({ w, h, query: { simkinds: 'mixed' } });
    await H.calm();
    const ada = await H.idOf('Lena');
    assert.ok(ada, `${tag}: Lena is in the mixed roster`);
    await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${ada}"]`)}).click()`); await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('schedHdrBtn')`); await settle();
    await js(`document.getElementById('schedHdrBtn').click()`); await until(`!!document.getElementById('scTarget')&&document.getElementById('scTarget').options.length===2`);
    const un = await js(`(()=>{const t=document.getElementById('scTarget'),c=document.getElementById('scCap'),u=document.getElementById('scCapU');const out={};c.value='3';const a=u.textContent;t.value=t.options[1].value;t.dispatchEvent(new Event('change'));out.sess=[u.textContent,c.value];t.value='';t.dispatchEvent(new Event('change'));out.folder=[u.textContent,c.value];out.first=a;return out})()`);
    assert.notStrictEqual(un.sess[0], un.folder[0], `${tag}: the session and the folder's agent count in different units (${JSON.stringify(un)})`);
    assert.strictEqual(un.sess[1], '', `${tag}: Limit is cleared when the unit changes`);
    // a capped schedule moved to an agent app that reports no cost: the note says the limit will be removed, and Save succeeds without it
    await js(`(()=>{const t=document.getElementById('scTarget'),c=document.getElementById('scCap');t.value='';t.dispatchEvent(new Event('change'));c.value='3';return true})()`);
    await add('capped for the folder');
    const CF = (await rows()).find((r) => r.p === 'capped for the folder');
    assert.match(CF.line, /of \$3\.00/, `${tag}: the schedule has a limit`);
    await edit(CF.id);
    assert.strictEqual(await js(`document.getElementById('scCapKeep').hidden`), true, `${tag}: no note while the limit field shows`);
    await js(`(()=>{const t=document.getElementById('scTarget');t.value=t.options[1].value;t.dispatchEvent(new Event('change'));return true})()`);
    const note = await js(`({hidden:document.getElementById('scCapKeep').hidden,text:document.getElementById('scCapKeep').textContent,field:document.getElementById('scCapL').hidden})`);
    assert.deepStrictEqual(note, { hidden: false, text: 'This agent app does not report what a run costs, so the limit will be removed.', field: true }, `${tag}: the note says the limit will be removed`);
    await js(`document.getElementById('scAdd').click()`); await until(`document.getElementById('scFormT').hidden`);
    const moved = (await rows()).find((r) => r.id === CF.id);
    assert.ok(moved && !/ of /.test(moved.line) && /→/.test(moved.line), `${tag}: saved, sent to the session, no limit (${moved && moved.line})`);

    // spec 044 FR-121/FR-122 (issue #843): the box never cuts a paste; the counter from 80%; over the limit the error in words and Save disabled
    {
      const q = (e) => js(e);
      const count = () => q(`(()=>{const c=document.getElementById('scCount'),p=document.getElementById('scPrompt'),a=document.getElementById('scAdd');return {len:p.value.length,max:p.hasAttribute('maxlength'),desc:p.getAttribute('aria-describedby'),inv:p.getAttribute('aria-invalid'),dis:a.disabled,text:c.textContent,hidden:c.hidden,own:c.id}})()`);
      const type = async (s) => { await js(`(()=>{const p=document.getElementById('scPrompt');p.value='';p.dispatchEvent(new Event('input',{bubbles:true}));p.focus();return true})()`); ctx.win.webContents.insertText(s); await until(`document.getElementById('scPrompt').value.length===${jsLiteral(s.length)}`); };
      const nRows = await js(`document.querySelectorAll('#sdList .sc-row').length`);
      await type(text(12000));
      let c = await count();
      assert.deepStrictEqual([c.len, c.max, c.desc, c.inv, c.dis, c.text, c.hidden], [12000, false, 'scCount', 'true', true, '12,000 of 10,000 characters: shorten it to save', false], `${tag}: 12,000 typed characters stay whole, with the error and Save disabled`);
      assert.strictEqual(await js(`document.getElementById('scPrompt').value`), text(12000), `${tag}: the whole text is kept, nothing cut`);
      await js(`document.getElementById('scAdd').click()`); await settle();
      assert.strictEqual(await js(`document.querySelectorAll('#sdList .sc-row').length`), nRows, `${tag}: a disabled Save adds nothing`);
      await small(tag);
      const fit = await js(`(()=>{const d=document.querySelector('#schedDlg .dlg'),c=document.getElementById('scCount').getBoundingClientRect(),r=d.getBoundingClientRect();return {sw:d.scrollWidth-d.clientWidth,inside:c.left>=r.left&&c.right<=r.right,h:c.height,col:getComputedStyle(document.getElementById('scCount')).color}})()`);
      assert.ok(fit.sw <= 1 && fit.inside && fit.h > 0, `${tag}: the error fits the dialog (${JSON.stringify(fit)})`);
      await js(`document.getElementById('scCount').scrollIntoView({block:'center'})`); await settle();
      await ctx.shot(path.join(OUT, `044-length-error-${tag}.png`));
      await type(text(7999)); c = await count();
      assert.deepStrictEqual([c.hidden, c.text, c.inv, c.dis], [true, '', 'false', false], `${tag}: no counter below 80%`);
      await type(text(8412)); c = await count();
      assert.deepStrictEqual([c.hidden, c.text, c.inv, c.dis], [false, '8,412 / 10,000', 'false', false], `${tag}: the counter from 80%`);
      await js(`document.getElementById('scCount').scrollIntoView({block:'center'})`); await settle();
      await ctx.shot(path.join(OUT, `044-length-counter-${tag}.png`));
      await type(text(10001)); c = await count();
      assert.deepStrictEqual([c.inv, c.dis, c.text], ['true', true, '10,001 of 10,000 characters: shorten it to save'], `${tag}: one over the limit is an error`);
      await type(text(10000)); c = await count();
      assert.deepStrictEqual([c.inv, c.dis, c.text], ['false', false, '10,000 / 10,000'], `${tag}: exactly at the limit saves`);
      // a template fills the box through the same check
      await js(`(()=>{const p=document.getElementById('scPrompt');p.value='';p.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
      c = await count();
      assert.deepStrictEqual([c.hidden, c.dis], [true, false], `${tag}: an empty box has no counter and Save is on`);
      // the limit itself saved whole, then its row
      await type(text(LIMIT));
      await js(`document.getElementById('scAdd').click()`); await until(`document.querySelectorAll('#sdList .sc-row').length===${jsLiteral(nRows + 1)}`);
      const top = await js(`(()=>{const r=[...document.querySelectorAll('#sdList .sc-row')].pop(),b=r.querySelector('.sc-p'),d=document.querySelector('#schedDlg .dlg');b.click();return {len:r.querySelector('.sc-full').textContent.length,title:b.title.length,sw:d.scrollWidth-d.clientWidth,count:document.getElementById('scPrompt').value.length}})()`);
      assert.deepStrictEqual([top.len, top.sw <= 1, top.title <= 300, top.count], [LIMIT, true, true, 0], `${tag}: the 10,000-character prompt was saved whole and shows without sideways scroll`);
      await small(tag);
      // a stored prompt over the limit (as a hand-edited file would hold it) needs review: the row says why and offers Edit...
      const raw = await js(`window.__durbarSimSched.addRaw(${jsLiteral(text(12345))})`);
      await until(`!!document.querySelector(${jsLiteral(`#sdList [data-id="${raw}"]`)})`);
      const rr = (await rows()).find((r) => r.id === raw);
      assert.match(rr.line, /Needs review: the prompt is over 10,000 characters, shorten it with Edit…/, `${tag}: the row says why it is not sent`);
      assert.strictEqual(rr.btns[0], 'Edit…', `${tag}: the needs-review row has Edit…`);
      await js(`document.querySelector(${jsLiteral(`#sdList [data-sc="pause"][data-id="${raw}"]`)}).click()`); await until(`document.querySelector(${jsLiteral(`#sdList [data-id="${raw}"]`)}).classList.contains('off')`);
      assert.strictEqual(await js(`document.querySelector(${jsLiteral(`#sdList [data-id="${raw}"] .sc-full`)}).textContent.length`), 12345, `${tag}: Pause keeps the long prompt whole`);
      await js(`document.querySelector(${jsLiteral(`#sdList [data-sc="pause"][data-id="${raw}"]`)}).click()`); await until(`!document.querySelector(${jsLiteral(`#sdList [data-id="${raw}"]`)}).classList.contains('off')`);
      await edit(raw);
      c = await count();
      assert.deepStrictEqual([c.len, c.inv, c.dis, c.text], [12345, 'true', true, '12,345 of 10,000 characters: shorten it to save'], `${tag}: Edit… shows the whole prompt and the error, Save disabled`);
      await js(`document.getElementById('scFormT').scrollIntoView({block:'start'})`); await settle();
      await ctx.shot(path.join(OUT, `044-length-review-${tag}.png`));
      await type(text(500)); c = await count();
      assert.deepStrictEqual([c.inv, c.dis], ['false', false], `${tag}: shortened, Save is on`);
      await js(`document.getElementById('scAdd').click()`); await until(`document.getElementById('scFormT').hidden`);
      assert.doesNotMatch((await rows()).find((r) => r.id === raw).line, /Needs review/, `${tag}: saved short, no longer needs review`);
    }
    console.log('[sched-edit]', tag, 'ok');
  }
  console.log('[sched-edit] all checks passed');
};
