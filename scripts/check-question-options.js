/*
 * Check for spec 052 FR-140 (issue #365): the options of an agent's question card are never cut off. Simulator only (no AI credits).
 *
 *   npm run check:ui -- --only check-question-options
 *   OUT=docs/screenshots  (optional) also saves the screenshots
 *
 * `simquestion=long` asks a long question with long options. At 1440x900 and 1280x800, in Expert and in Simple, every option button
 * must show its full label (no ellipsis: scrollWidth <= clientWidth, text equals the label, title starts with the label), stay inside
 * the card, and the question text must not be clipped. The inbox row must show the question text in full. A miss prints
 * (spec 052 FR-160/FR-161) The 1,117-character question, the 284-character label and the 501-character description are in the card in full,
 * the description is visible inside its button, nothing on them has an ellipsis, a line clamp or hidden overflow. In the custom answer box:
 * Enter with nothing typed sends nothing, Shift+Enter adds a line, typing chooses the box, a long answer stays visible (the box grows),
 * and Enter sends the card (the second question's box gets the focus first, as the Answer button does). A miss prints
 * DRIVER FAILED (Electron still exits 0), so the npm script exits non-zero unless "all checks passed" is printed.
 */
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const assert = require('assert');
const OUT = process.env.OUT || require('os').tmpdir();
module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-096/097: shared plumbing, waits for the page instead of a fixed time
  const { until, settle, js } = H;
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'mouse', tag: 'question-options' });
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    for (const level of ['expert', 'simple']) {
      await H.load({ w, h, query: { simquestion: 'long' }, ready: 'fit' });
      await js(`localStorage.setItem('durbar.detail',${jsLiteral(level)})`); // the level is remembered: reload so the office is drawn in it
      await H.load({ query: { simquestion: 'long' }, ready: 'fit' });
      assert.ok(await js(`document.body.classList.contains('simple')===${level === 'simple'}`), `${w} ${level}: the detail level is on`);
      // Wait for the simulated question itself (the simulator asks it 300 ms after the load; a busy runner is later), then open the asking
      // agent's chat from its desk and wait for its card: the shared openSimAgent (driver-helpers.js). The old way clicked every desk in one
      // synchronous sweep for at most 8 s and could never see a question that arrived, or a chat that rendered, between two sweeps.
      const opened = await H.openSimAgent('a=>!a.parent&&a.question', '#chat .note.question .q-opt');
      assert.ok(opened.ok, `${w} ${level}: an agent has the question in its chat: ${JSON.stringify({ id: opened.id, ...opened.seen })}`);
      await settle();
      await js(`document.querySelector('#chat .note.question').scrollIntoView({block:'center'})`); await settle();
      const r = await js(`(()=>{const card=document.querySelector('#chat .note.question'),cr=card.getBoundingClientRect();
        const cut=el=>{const c=getComputedStyle(el);return el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1||c.textOverflow==='ellipsis'||c.whiteSpace==='nowrap'||(c.webkitLineClamp&&c.webkitLineClamp!=='none')||((c.overflow==='hidden'||c.overflowY==='hidden')&&el.scrollHeight>el.clientHeight+1);};
        const descs=[...card.querySelectorAll('.q-opt .q-desc')].map(d=>{const r=d.getBoundingClientRect();return {text:d.textContent,cut:cut(d),visible:r.height>0&&r.width>0,fs:parseFloat(getComputedStyle(d).fontSize)};});
        const opts=[...card.querySelectorAll('.q-opt')].map(b=>{const br=b.getBoundingClientRect();return {label:b.querySelector('.q-lbl').textContent,lblCut:cut(b.querySelector('.q-lbl')),title:b.title,clipped:b.scrollWidth>b.clientWidth+1||b.scrollHeight>b.clientHeight+1,ellipsis:getComputedStyle(b).textOverflow==='ellipsis',nowrap:getComputedStyle(b).whiteSpace==='nowrap',inside:br.left>=cr.left-0.5&&br.right<=cr.right+0.5,h:br.height}});
        const qs=[...card.querySelectorAll('.q-text')].map(p=>({text:p.textContent,clipped:cut(p),h:p.getBoundingClientRect().height,lh:parseFloat(getComputedStyle(p).lineHeight)}));
        return {opts,qs,descs}})()`);
      assert.ok(r.opts.length >= 5, `${w} ${level}: the long options are there: ${r.opts.length}`);
      for (const o of r.opts) {
        assert.ok(!o.clipped && !o.ellipsis && !o.nowrap, `${w} ${level}: option "${o.label.slice(0, 40)}" is cut off: ${JSON.stringify({ clipped: o.clipped, ellipsis: o.ellipsis, nowrap: o.nowrap })}`);
        assert.ok(o.inside, `${w} ${level}: option "${o.label.slice(0, 40)}" sticks out of the card`);
        assert.ok(o.title.startsWith(o.label.trim()), `${w} ${level}: the title holds the label: ${o.title}`);
        assert.ok(!o.lblCut, `${w} ${level}: label "${o.label.slice(0, 40)}" is cut`);
      }
      // FR-160: the long texts arrive whole and the description is on screen
      assert.ok(r.opts.some((o) => o.label.length >= 280 && o.label.endsWith('before anyone can merge it')), `${w} ${level}: the 284-character label is whole`);
      assert.ok(r.descs.length >= 1 && r.descs.every((d) => d.visible && !d.cut && d.fs >= 10.5), `${w} ${level}: descriptions visible and whole: ${JSON.stringify(r.descs.map((d) => ({ ...d, text: d.text.length })))}`);
      assert.ok(r.descs.some((d) => d.text.length > 500 && d.text.endsWith('a machine we did not test.')), `${w} ${level}: the 501-character description is whole`);
      assert.ok(r.opts.some((o) => o.h > 34), `${w} ${level}: a long label wraps onto more than one line: ${r.opts.map((o) => Math.round(o.h))}`);
      assert.ok(r.opts.some((o) => / — /.test(o.title)), `${w} ${level}: a described option has "label — description" in its title`);
      for (const q of r.qs) {
        assert.ok(!q.clipped, `${w} ${level}: the question text is clipped: ${q.text.slice(0, 60)}`);
        assert.ok(q.h >= q.lh * 2 - 1 || q.text.length < 200, `${w} ${level}: a long question takes several lines (${q.h}px): ${JSON.stringify(q)}`);
      }
      assert.ok(r.qs.some((q) => q.text.includes('knowing that the second one touches every theme')) && r.qs.some((q) => q.text.endsWith('should stay?')), `${w} ${level}: the full question texts are in the card`);
      assert.ok(r.qs.some((q) => q.text.length > 1100 && q.text.endsWith('write your own plan below.')), `${w} ${level}: the 1,117-character question is whole`);
      if (level === 'expert') await shot(`052-question-options-${w}x${h}.png`);
      // the inbox row: the question text in full, nothing clipped
      await js(`document.activeElement&&document.activeElement.blur()`);
      H.key('I', [], { char: 'always', pause: 0 });
      await until(`[...document.querySelectorAll('#inboxDlg .inbox-row .ib-t')].some(p=>/Before I change/.test(p.textContent))`); await settle();
      const ib = await js(`(()=>{const d=document.getElementById('inboxDlg');if(!d)return null;const t=[...d.querySelectorAll('.inbox-row .ib-t')].find(p=>/Before I change/.test(p.textContent));if(!t)return {found:false};
        const br=t.getBoundingClientRect(),rr=t.closest('.inbox-row').getBoundingClientRect();return {found:true,text:t.textContent,clipped:t.scrollWidth>t.clientWidth+1||t.scrollHeight>t.clientHeight+1,inside:br.right<=rr.right+0.5}})()`);
      assert.ok(ib && ib.found, `${w} ${level}: the inbox row shows the question: ${JSON.stringify(ib)}`);
      assert.ok(!ib.clipped && ib.inside && ib.text.includes('migration of the saved preferences'), `${w} ${level}: the inbox question is in full: ${JSON.stringify(ib)}`);
      await js(`[...document.querySelectorAll('#inboxDlg .inbox-row .ib-t')].find(p=>/Before I change/.test(p.textContent)).scrollIntoView({block:'center'})`); await settle();
      if (level === 'expert') await shot(`052-question-options-inbox-${w}x${h}.png`);
      // FR-161: the custom answer box. Close the inbox, then Enter / Shift+Enter / typing / Enter
      await js(`(()=>{const d=document.getElementById('inboxDlg');if(d)d.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));})()`);
      await until(`!document.getElementById('inboxDlg')`); await settle();
      const key = (k, m = []) => H.key(k, m, { pause: 120 });
      const box = (i) => `document.querySelectorAll('#chat .note.question:not(.settled) .q-other')[${i}]`;
      await js(`${box(0)}.scrollIntoView({block:'center'});${box(0)}.focus()`); await settle();
      const a11y = await js(`({tag:${box(0)}.tagName,label:${box(0)}.getAttribute('aria-label'),hint:(document.getElementById(${box(0)}.getAttribute('aria-describedby')||'x')||{}).textContent,keys:${box(0)}.getAttribute('aria-keyshortcuts')})`);
      assert.ok(a11y.tag === 'TEXTAREA' && /^Other answer: Before I change/.test(a11y.label) && /Enter sends this answer/.test(a11y.hint || '') && a11y.keys === 'Enter', `${w} ${level}: the box is labelled and described: ${JSON.stringify(a11y)}`);
      await key('Enter');
      assert.ok(await js(`!!document.querySelector('#chat .note.question:not(.settled)')&&${box(0)}.value===''&&document.activeElement===${box(0)}`), `${w} ${level}: Enter in an empty box sends nothing and adds no line`);
      // choose an option first: typing must unchoose it and choose the box
      await js(`document.querySelector('#chat .note.question:not(.settled) .q-opt').click();${box(0)}.focus()`);
      const answer = 'Do the settings screen first, then ask me again before the office view; keep a backup of the saved preferences for one release and tell me which themes changed when you are done, with a short list of the screens you looked at and the ones you did not get to yet.';
      const cutAt = answer.indexOf('; ') + 1; // Shift+Enter between two clauses
      ctx.win.webContents.insertText(answer.slice(0, cutAt)); await ctx.sleep(80);
      await key('Enter', ['shift']);
      ctx.win.webContents.insertText(answer.slice(cutAt + 1)); await ctx.sleep(150);
      const typed = await js(`(()=>{const b=${box(0)},q=b.closest('.q-item');return {v:b.value,chosen:b.classList.contains('chosen'),picked:q.querySelectorAll('.q-opt[aria-checked="true"]').length,cut:b.scrollHeight>b.clientHeight+1,h:b.getBoundingClientRect().height,open:!!document.querySelector('#chat .note.question:not(.settled)')}})()`);
      assert.ok(typed.open && typed.v === answer.slice(0, cutAt) + '\n' + answer.slice(cutAt + 1), `${w} ${level}: Shift+Enter adds a line and sends nothing: ${JSON.stringify(typed.v.slice(0, 90))}`);
      assert.ok(typed.chosen && typed.picked === 0, `${w} ${level}: typing chooses the box and unchooses the option: ${JSON.stringify(typed)}`);
      assert.ok(!typed.cut && typed.h > 40, `${w} ${level}: the long answer stays visible (the box grows): ${JSON.stringify({ cut: typed.cut, h: typed.h })}`);
      if (level === 'expert') { await js(`${box(0)}.scrollIntoView({block:'center'})`); await settle(); await shot(`052-question-custom-${w}x${h}.png`); }
      await key('Enter');
      assert.ok(await js(`!!document.querySelector('#chat .note.question:not(.settled)')&&document.activeElement===${box(1)}`), `${w} ${level}: with the second question open, Enter moves to its box instead of sending`);
      ctx.win.webContents.insertText('Keep the short ones'); await ctx.sleep(80);
      await key('Enter');
      await until(`!!document.querySelector('#chat .note.question.settled')`);
      const st = await js(`document.querySelector('#chat .note.question.settled .pstate').textContent`);
      assert.ok(st.includes('answered: Do the settings screen first') && st.includes('Keep the short ones'), `${w} ${level}: Enter sent the typed answers: ${st.slice(0, 120)}`);
      console.log('[question-options]', w, level, 'ok');
    }
  }
  console.log('[question-options] all checks passed');
};
