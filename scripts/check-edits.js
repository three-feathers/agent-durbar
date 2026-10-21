/*
 * Check for spec 005 FR-020..FR-026: file edits stream into the chat. Simulator only (`simedits=1`), no agent app, no AI credits.
 *
 *   npm run check:edits
 *   OUT=docs/screenshots  (optional) also saves the screenshots 005-edit-{expert,simple}-{1440x900,1280x800}.png
 *
 * The first agent (sim-1) applies a two-file patch, creates a file that holds a token-shaped value (the page must mask it), then starts an Edit whose
 * arguments stream in and stay open. At 1440x900 and 1280x800, in Expert and in Simple: the streamed edit has its row while it
 * runs (not only at completion), with the file name, its folder relative to the agent's folder and "+N −M"; its diff shows 12 lines
 * and "Show all"; the waiting line names the action; the patch row lists both files; the token is masked by the page; Simple uses plain words and keeps the diff closed; nothing overflows and text is >= 10.5px.
 * A miss prints DRIVER FAILED (Electron still exits 0), so the npm script exits non-zero unless "all checks passed" is printed.
 */
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers'); /* jsLiteral: CodeQL js/bad-code-sanitization, values spliced into page code */
const OUT = process.env.OUT || require('os').tmpdir();
const Q = { simedits: '1' };
module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-096/097: shared plumbing
  const { until, settle, js } = H;
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'mouse', tag: 'edits' });
  const rows = async () => { const v = await rows0(); if (typeof v === 'string') throw new Error(v); return v; };
  const rows0 = () => js(`(()=>{try{return [...document.querySelectorAll('#chat .chip.editchip')].map(c=>{const d=c._ed&&c._ed.diffEl;return {
      verb:(c.querySelector('.ed-verb')||{}).textContent||'',name:(c.querySelector('.ed-name')||{}).textContent||'',dir:(c.querySelector('.ed-dir')||{}).textContent||'',
      count:(c.querySelector('.ed-head>.ed-count')||{}).textContent||'',run:c.classList.contains('run'),
      diff:d?{open:d.open,summary:d.querySelector('summary').textContent,lines:d.querySelectorAll('pre>.dl').length,files:[...d.querySelectorAll('pre>.dl.file')].map(x=>x.textContent),all:(d.querySelector('.xall')||{}).textContent||'',text:d.textContent}:null}})}catch(e){return 'ERR '+e.message+' '+e.stack}})()`);
  /* the detail level switched live, through the same click handler as the welcome screen's level buttons */
  const level = (l) => js(`(()=>{const b=document.createElement('button');b.dataset.wlLevel=${jsLiteral(l)};document.body.appendChild(b);b.click();b.remove();return document.body.classList.contains('simple')})()`);
  const typing = () => js(`(document.querySelector('#chat .typing .t-l')||{}).textContent||''`);
  const layout = () => js(`(()=>{const ch=document.getElementById('chat'),R=ch.getBoundingClientRect(),bad=[];
      if(ch.scrollWidth>ch.clientWidth+1)bad.push('chat scrolls sideways');
      document.querySelectorAll('#chat .chip.editchip,#chat .ediff').forEach(e=>{if(e.hidden)return;const r=e.getBoundingClientRect();if(r.width&&(r.left<R.left-0.5||r.right>R.right+0.5))bad.push('outside the chat: '+e.className);});
      document.querySelectorAll('#chat .chip.editchip *,#chat .ediff summary,#chat .ediff pre,#chat .ediff .xall,#chat .typing .t-l').forEach(e=>{if(!e.getClientRects().length)return;const f=parseFloat(getComputedStyle(e).fontSize);if(f<10.5)bad.push('font '+f+' '+e.className);});
      const hs=[...document.querySelectorAll('#chat .chip.editchip')].filter(c=>!c.hidden).map(c=>c.querySelector('.ed-head').getBoundingClientRect());
      [...document.querySelectorAll('#chat .chip.editchip')].forEach(c=>{if(c.hidden)return;const r=c.getBoundingClientRect(),h=c.querySelector('.ed-head').getBoundingClientRect();if(h.right>r.right+0.5)bad.push('row text leaves its row');});
      return bad;})()`);
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, query: Q, settle: false });
    await level('expert');
    await js(`document.querySelector('#stage .desk[data-id="sim-1"]').click()`);
    await until(`document.querySelectorAll('#chat .chip.editchip').length>=3&&[...document.querySelectorAll('#chat .chip.editchip .ed-name')].some(n=>n.textContent==='app.js')`, 10000);
    await until(`(()=>{const c=[...document.querySelectorAll('#chat .chip.editchip')].find(c=>c.querySelector('.ed-name').textContent==='app.js');return c&&/\\+3[0-9]/.test(c.querySelector('.ed-count').textContent)})()`, 6000);
    await settle();
    let r = await rows();
    const stream = r.find((x) => x.name === 'app.js');
    assert.ok(stream, `${w}: the streamed edit has a row: ${JSON.stringify(r.map((x) => x.name))}`);
    assert.strictEqual(stream.run, true, `${w}: the row is there while the edit still runs (FR-019)`);
    assert.strictEqual(stream.verb, 'Editing');
    assert.strictEqual(stream.dir, 'src/server', `${w}: folder relative to the agent's folder (FR-020)`);
    assert.match(stream.count, /^\+3\d−2$/, `${w}: counts ${stream.count}`);
    assert.ok(stream.diff && stream.diff.open, `${w}: Expert shows the diff open (FR-021)`);
    assert.strictEqual(stream.diff.lines, 12, `${w}: 12 lines before Show all`);
    assert.match(stream.diff.all, /^Show all \(\d+ lines\)$/);
    assert.match(await typing(), /^Editing app\.js · \d+s$/, `${w}: the waiting line names the action (FR-022)`);
    const patch = r.find((x) => x.name === '2 files');
    assert.ok(patch && patch.verb === 'Edited' && patch.count === '+4−1', `${w}: the patch row ${JSON.stringify(patch)}`);
    assert.deepStrictEqual(patch.diff.files.map((t) => t.replace(/\s+\+\d+−\d+$/, '')), ['src/routes/users.ts', 'src/routes/index.ts'], `${w}: each file listed`);
    const env = r.find((x) => x.name === '.env.example');
    assert.ok(env && env.verb === 'Created' && env.dir === 'config', `${w}: the new file ${JSON.stringify(env)}`);
    assert.ok(!/ghp_/.test(env.diff.text) && /\[redacted\]/.test(env.diff.text), `${w}: the token is masked in the page (FR-024)`);
    assert.deepStrictEqual(await layout(), [], `${w}: layout`);
    // scroll the streamed row into view for the picture
    await js(`(()=>{const c=[...document.querySelectorAll('#chat .chip.editchip')].find(c=>c.querySelector('.ed-name').textContent==='app.js');c.scrollIntoView({block:'start'});document.getElementById('chat').scrollTop-=60})()`);
    await shot(`005-edit-expert-${w}x${h}.png`);
    // Show all: every line of the streamed diff
    await js(`[...document.querySelectorAll('#chat .ediff .xall')].pop().click()`);
    await until(`[...document.querySelectorAll('#chat .ediff')].pop().querySelectorAll('pre>.dl').length>12`, 3000);
    r = await rows();
    assert.ok(r.find((x) => x.name === 'app.js').diff.lines > 12 && !r.find((x) => x.name === 'app.js').diff.all, `${w}: Show all opens every line`);
    // Simple: plain words, diff behind a toggle (FR-023)
    await js(`window.__errs=[];window.addEventListener('error',x=>window.__errs.push(String(x.message)))`);
    assert.strictEqual(await level('simple'), true, `${w}: Simple is on`);
    assert.deepStrictEqual(await js(`window.__errs`), [], `${w}: no page error while switching`);
    await settle();
    r = await rows();
    const s2 = r.find((x) => x.name === 'app.js');
    assert.strictEqual(s2.verb, 'Changing', `${w}: plain verb`);
    assert.strictEqual(s2.diff.open, false, `${w}: Simple keeps the diff closed`);
    assert.match(s2.diff.summary, /^See what changes \(\+3\d −2\)$/);
    assert.strictEqual(r.find((x) => x.name === '2 files').verb, 'Changed');
    assert.match(await typing(), /^Changing app\.js · \d+s$/);
    assert.deepStrictEqual(await layout(), [], `${w}: layout in Simple`);
    await shot(`005-edit-simple-${w}x${h}.png`);
    // a diff the user opened stays open when the level switches back and forth
    await js(`(()=>{const d=[...document.querySelectorAll('#chat .ediff')].pop();d.open=true;})()`);
    await ctx.sleep(50);
    await level('expert'); await level('simple');
    assert.strictEqual((await rows()).find((x) => x.name === 'app.js').diff.open, true, `${w}: the user's choice is kept`);
    await level('expert');
  }
  console.log('[edits] all checks passed');
};
