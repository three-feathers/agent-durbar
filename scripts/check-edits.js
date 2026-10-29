/*
 * Check for spec 005 FR-020..FR-026: file edits stream into the chat. Simulator only (`simedits=1`), no agent app, no AI credits.
 *
 *   npm run check:ui -- --only check-edits
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
  /* review on #463: with two tools open the waiting line goes back to the one still running when the newer ends; while a permission
     card waits it says so instead of "Editing" (events sent with the simulator's test hook, the same path as its own events) */
  const emit = (e) => js(`window.__durbarSimEmit(Object.assign(${jsLiteral(e)},{timestamp:Date.now()}))`);
  const waitingLine = async () => {
    const line = (re, why) => until(`new RegExp(${jsLiteral(re)}).test((document.querySelector('#chat .typing .t-l')||{}).textContent||'')`, 3000).then(async (ok) => assert.ok(ok, `${why}: "${await typing()}"`));
    await emit({ type: 'toolCall', sessionId: 'sim-1', callId: 'sim-1-x-grep', tool: 'grep', phase: 'start', args: { pattern: 'listen' } });
    await line('^(?!Editing app\\.js|Working|Waiting)\\S.* · \\d+s$', 'a newer tool names itself');
    await emit({ type: 'toolCall', sessionId: 'sim-1', callId: 'sim-1-x-grep', tool: 'grep', phase: 'complete', output: '2 matches' });
    await line('^Editing app\\.js · \\d+s$', 'the newer tool ended: the edit still running is named again, not "Working"');
    const perm = { requestId: 'sim-1-x-perm', kind: 'write', summary: 'Write src/server/app.js', state: 'pending' };
    await emit({ type: 'status', sessionId: 'sim-1', status: 'needs-permission', permission: perm });
    await line('^Waiting for your OK · \\d+s$', 'a pending permission card: the line does not say Editing');
    await emit({ type: 'permission', sessionId: 'sim-1', permission: { requestId: perm.requestId, state: 'approved', via: 'user', summary: perm.summary } });
    await line('^Editing app\\.js · \\d+s$', 'answered: back to the edit');
  };
  /* review on #463 (FR-021): while an Edit streams, its growing diff keeps a chat pinned at the bottom there, and leaves a chat the user
     scrolled up where it is. Diffs under the 12-line cap, so each update makes the row taller (events through the simulator's test hook). */
  const scrollPin = async () => {
    const diffOf = (n) => { const ls = []; for (let i = 0; i < n; i++) ls.push('+line ' + i); return { diff: '@@ -0,0 +1,' + n + ' @@\n' + ls.join('\n'), added: n, removed: 0 }; };
    const upd = (id, n) => emit({ type: 'toolCall', sessionId: 'sim-1', callId: id, tool: 'Edit', phase: 'update', edit: { files: [{ path: '~/work/pin/' + id + '.js', kind: 'edit', ...diffOf(n) }], partial: true } });
    const frames = () => js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(()=>r(true),60))))`);
    const gap = () => js(`(()=>{const c=document.getElementById('chat');return Math.round(c.scrollHeight-c.scrollTop-c.clientHeight)})()`);
    for (const id of ['pin-a', 'pin-b']) {
      await emit({ type: 'toolCall', sessionId: 'sim-1', callId: id, tool: 'Edit', phase: 'start', args: { path: '~/work/pin/' + id + '.js' } });
      await upd(id, 1);
      await until(`!![...document.querySelectorAll('#chat .chip.editchip .ed-name')].find(n=>n.textContent===${jsLiteral(id + '.js')})`, 3000);
      await frames();
    }
    // pinned: scrolled to the bottom (the chat's own scroll handler sets the pin), then the diff grows
    await js(`(()=>{const c=document.getElementById('chat');c.scrollTop=c.scrollHeight;c.dispatchEvent(new Event('scroll'));})()`);
    await frames();
    assert.ok(await js(`document.getElementById('chat').scrollHeight>document.getElementById('chat').clientHeight`), 'the chat scrolls (else the pin is not tested)');
    assert.strictEqual(await js(`document.getElementById('chat').dataset.pin`), '1');
    const h0 = await js(`document.getElementById('chat').scrollHeight`);
    await upd('pin-b', 6);
    await until(`document.getElementById('chat').scrollHeight>${jsLiteral(h0 + 40)}`, 3000);
    await frames();
    assert.ok((await gap()) <= 2, `pinned at the bottom, the chat follows the growing diff (gap ${await gap()}px)`);
    // scrolled up: the same diff grows further down (below the view) and scrollTop stays
    await js(`(()=>{const c=document.getElementById('chat');c.scrollTop=Math.max(0,c.scrollTop-300);c.dispatchEvent(new Event('scroll'));})()`);
    await frames();
    assert.strictEqual(await js(`document.getElementById('chat').dataset.pin`), '0', 'scrolled up: not pinned');
    const top = await js(`document.getElementById('chat').scrollTop`);
    const h1 = await js(`document.getElementById('chat').scrollHeight`);
    await upd('pin-b', 12);
    await until(`document.getElementById('chat').scrollHeight>${jsLiteral(h1 + 40)}`, 3000);
    await frames();
    assert.strictEqual(await js(`document.getElementById('chat').scrollTop`), top, 'scrolled up, the chat does not move while a diff grows');
    // pinned again, Show all on the bottom row: only edDiff repaints (no event), and the chat still follows it to the bottom
    await upd('pin-b', 30);
    await until(`(()=>{const n=[...document.querySelectorAll('#chat .chip.editchip')].find(c=>c.querySelector('.ed-name').textContent==='pin-b.js');return !!(n&&n._ed&&n._ed.diffEl&&n._ed.diffEl.querySelector('.xall'))})()`, 3000);
    await js(`(()=>{const c=document.getElementById('chat');c.scrollTop=c.scrollHeight;c.dispatchEvent(new Event('scroll'));})()`);
    await frames();
    assert.ok((await gap()) <= 2 && (await js(`document.getElementById('chat').dataset.pin`)) === '1', 'pinned again before Show all');
    const h2 = await js(`document.getElementById('chat').scrollHeight`);
    await js(`[...document.querySelectorAll('#chat .chip.editchip')].find(c=>c.querySelector('.ed-name').textContent==='pin-b.js')._ed.diffEl.querySelector('.xall').click()`);
    await until(`document.getElementById('chat').scrollHeight>${jsLiteral(h2 + 100)}`, 3000);
    await frames();
    assert.ok((await gap()) <= 2, `pinned, Show all on the last diff keeps the chat at the bottom (gap ${await gap()}px)`);
    for (const id of ['pin-a', 'pin-b']) await emit({ type: 'toolCall', sessionId: 'sim-1', callId: id, tool: 'Edit', phase: 'complete', output: 'ok' });
  };
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, query: Q, settle: false });
    await level('expert');
    await js(`document.querySelector('#stage .desk[data-id="sim-1"]').click()`);
    await until(`document.querySelectorAll('#chat .chip.editchip').length>=4&&[...document.querySelectorAll('#chat .chip.editchip .ed-name')].some(n=>n.textContent==='app.js')`, 10000);
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
    // a refused edit never reads as done (review on #463)
    const refused = r.find((x) => x.name === 'old-routes.js');
    assert.ok(refused && refused.verb === 'Could not delete' && refused.dir === 'src/legacy' && !refused.run, `${w}: the refused delete ${JSON.stringify(refused)}`);
    assert.match(refused.diff.summary, /^The change \(not made\)/, `${w}: its diff says it was not made`);
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
    assert.strictEqual(r.find((x) => x.name === 'old-routes.js').verb, 'Not deleted', `${w}: the refused delete in plain words`);
    assert.match(await typing(), /^Changing app\.js · \d+s$/);
    assert.deepStrictEqual(await layout(), [], `${w}: layout in Simple`);
    await shot(`005-edit-simple-${w}x${h}.png`);
    // a diff the user opened stays open when the level switches back and forth
    await js(`(()=>{const d=[...document.querySelectorAll('#chat .ediff')].pop();d.open=true;})()`);
    await ctx.sleep(50);
    await level('expert'); await level('simple');
    assert.strictEqual((await rows()).find((x) => x.name === 'app.js').diff.open, true, `${w}: the user's choice is kept`);
    await level('expert');
    if (w === 1440) await scrollPin(); // FR-021: a growing diff follows the chat only while it is pinned at the bottom (review on #463)
    if (w === 1440) await waitingLine(); // a second tool and a permission card: once (it does not depend on the size), after the pictures
  }
  console.log('[edits] all checks passed');
};
