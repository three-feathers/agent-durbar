/*
 * Check for spec 052 FR-140 (issue #365): the options of an agent's question card are never cut off. Simulator only (no AI credits).
 *
 *   npm run check:question-options
 *   OUT=docs/screenshots  (optional) also saves the screenshots
 *
 * `simquestion=long` asks a long question with long options. At 1440x900 and 1280x800, in Expert and in Simple, every option button
 * must show its full label (no ellipsis: scrollWidth <= clientWidth, text equals the label, title starts with the label), stay inside
 * the card, and the question text must not be clipped. The inbox row must show the question text in full. A miss prints
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
      let id = null;
      for (const end = Date.now() + 8000; !id && Date.now() < end;) { id = await js(`(()=>{for(const d of document.querySelectorAll('#stage .desk[data-id]')){d.click();const c=document.querySelector('#chat .note.question');if(c)return d.dataset.id;const b=document.getElementById('backBtn');if(b)b.click();}return ''})()`); if (!id) await ctx.sleep(100); }
      assert.ok(id, `${w} ${level}: an agent has the question in its chat`);
      await until(`!!document.querySelector('#chat .note.question .q-opt')`); await settle();
      await js(`document.querySelector('#chat .note.question').scrollIntoView({block:'center'})`); await settle();
      const r = await js(`(()=>{const card=document.querySelector('#chat .note.question'),cr=card.getBoundingClientRect();
        const opts=[...card.querySelectorAll('.q-opt')].map(b=>{const br=b.getBoundingClientRect();return {label:b.textContent.replace(/^\\u2713\\s*/,''),title:b.title,clipped:b.scrollWidth>b.clientWidth+1||b.scrollHeight>b.clientHeight+1,ellipsis:getComputedStyle(b).textOverflow==='ellipsis',nowrap:getComputedStyle(b).whiteSpace==='nowrap',inside:br.left>=cr.left-0.5&&br.right<=cr.right+0.5,h:br.height}});
        const qs=[...card.querySelectorAll('.q-text')].map(p=>({text:p.textContent,clipped:p.scrollWidth>p.clientWidth+1||p.scrollHeight>p.clientHeight+1,h:p.getBoundingClientRect().height,lh:parseFloat(getComputedStyle(p).lineHeight)}));
        return {opts,qs,srcLabels:null}})()`);
      assert.ok(r.opts.length >= 5, `${w} ${level}: the long options are there: ${r.opts.length}`);
      for (const o of r.opts) {
        assert.ok(!o.clipped && !o.ellipsis && !o.nowrap, `${w} ${level}: option "${o.label.slice(0, 40)}" is cut off: ${JSON.stringify({ clipped: o.clipped, ellipsis: o.ellipsis, nowrap: o.nowrap })}`);
        assert.ok(o.inside, `${w} ${level}: option "${o.label.slice(0, 40)}" sticks out of the card`);
        assert.ok(o.title.startsWith(o.label.trim()), `${w} ${level}: the title holds the label: ${o.title}`);
      }
      assert.ok(r.opts.some((o) => o.h > 34), `${w} ${level}: a long label wraps onto more than one line: ${r.opts.map((o) => Math.round(o.h))}`);
      assert.ok(r.opts.some((o) => / — /.test(o.title)), `${w} ${level}: a described option has "label — description" in its title`);
      for (const q of r.qs) {
        assert.ok(!q.clipped, `${w} ${level}: the question text is clipped: ${q.text.slice(0, 60)}`);
        assert.ok(q.h >= q.lh * 2 - 1 || q.text.length < 200, `${w} ${level}: a long question takes several lines (${q.h}px): ${JSON.stringify(q)}`);
      }
      assert.ok(r.qs.some((q) => q.text.includes('knowing that the second one touches every theme')) && r.qs.some((q) => q.text.endsWith('should stay?')), `${w} ${level}: the full question texts are in the card`);
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
      console.log('[question-options]', w, level, 'ok');
    }
  }
  console.log('[question-options] all checks passed');
};
