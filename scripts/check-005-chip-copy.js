/*
 * Spec 005 FR-411 (issue #2060 item 4, T504): Copy on a tool chip copies the real argument text, and asks first when something in it was masked.
 * Simulator only (no agent app, no AI credits). Needs the window's focus (the dialog's keyboard steps).
 *
 *   npm run check:ui -- --only check-005-chip-copy
 *
 * The simulator has no main in the path: its bridge's `copyToolArg` stands in for main (it keeps the raw argument of the calls it emitted and
 * writes it with the page's clipboard); main's own store and handler are tested in `test:toolargcopy`. The page's clipboard is read back by a
 * stub of `navigator.clipboard.writeText` (as check-notes does). The secret-like values are invented and built from pieces.
 *
 * At 1440x900 and 1280x800, light and the dark fixture, a chat open:
 *   - a chip whose command holds a masked word: the chip stays masked; Copy opens the confirm (role alertdialog, "Copy the real command?",
 *     "This copy may contain a secret. It is not masked.", Cancel and Copy anyway, the focus on Cancel, text at least 10.5px, no value in it);
 *     Cancel and Escape copy nothing and give the focus back to Copy; Copy anyway puts the real multi-line text on the clipboard and the button
 *     says "Copied ✓"; the chip still shows no value;
 *   - a chip with nothing masked: Copy copies the real multi-line text at once, with no confirm;
 *   - main's flag (review round 1): a chip whose text the window's mask finds harmless but whose event says `argsMasked: true` asks first,
 *     before any request reaches main (CONFIRM-MAIN, ASK-FIRST-MAIN); the same kind of text with `argsMasked: false` copies at once
 *     (NO-CONFIRM-FLAG-FALSE); main answering `ask` to an unconfirmed request (its value masked after the window's hint, the stand-in's
 *     `mark`) opens the same confirm, Cancel copies nothing, Copy anyway copies (ASK-RETRY). The stand-in logs only `confirmed` and the answer.
 *   - no page overflow with the confirm open. Screenshots (OUT or the temp folder): 005-chip-copy-confirm-<w>x<h>-<light|dark>.png.
 * Review of #2100: no request before any click (CALLS-AT-LOAD) and exactly one per Copy (PER-CLICK); a refused Copy (`unknown`, `failed`)
 * writes nothing more and says why (REFUSED-UNKNOWN, REFUSED-FAILED); main's flag going back down drops the question (HINT-DOWN).
 * Source mutants run by hand at build time (T504): the confirm skipped when masked dies at CONFIRM-MASKED; the window ignoring main's flag at
 * ASK-FIRST-MAIN; the window ignoring an `ask` answer at ASK-RETRY.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral, CHECK_DARK_QUERY, darkFixtureProblem } = require('./driver-helpers');
const OUT = process.env.OUT || require('os').tmpdir();

process.exitCode = 1;
const j = (...p) => p.join('');
const BEARER = j('Qx7', 'Mw2Rt9', 'Lp4Vz8', 'Nc3Hk');
const MASKED = j('cd app &&\n  curl -s -H "Authorization', ': Bearer ', BEARER, '" \\\n  https://api.example.test/v1/items');
const PLAIN = 'for f in src/*.ts; do\n  wc -l "$f"\ndone';
/* texts the window's own mask leaves alone: only main's flag (or main's answer) says something was masked */
const FLAGGED = 'git status --short\n  && git log -1 --oneline';
const UNFLAGGED = 'ls -la src\n  | head -5';
const LATE = 'npm run build\n  && npm test';
const GONE = 'git fetch origin\n  && git status';
const FAILS = 'du -sh src\n  | sort -h';
const DOWN = 'node -v\n  && npm -v';
const SIZES = [[1440, 900], [1280, 800]];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const ok = async (expr, what, ms) => assert.ok(await until(expr, ms || 8000), what);
  const emit = (e) => js(`window.__durbarSimEmit(Object.assign(${jsLiteral(e)},{timestamp:Date.now()}))`);
  /* page helpers (set after each load): the chip of a call, and the open confirm */
  const pageHelpers = () => js(`window.__cc=(id,c)=>window.__durbarSimUi.chipEl(id,c);window.__ccd=()=>document.querySelector('#modeDlg [role=alertdialog]');true`);
  const clips = () => js(`window.__clip.slice()`);
  const leak = (t) => String(t).includes(BEARER) || String(t).includes(BEARER.slice(0, 8));

  for (const [w, h] of SIZES) {
    for (const theme of ['light', 'dark']) {
      const tag = `${w}x${h}-${theme}`;
      await H.load({ w, h, focus: true, query: theme === 'dark' ? CHECK_DARK_QUERY : {} });
      if (theme === 'dark') { const bad = await darkFixtureProblem(H); assert.ok(!bad, `${tag}: ${bad}`); }
      await H.needFocus(tag);
      await pageHelpers();
      const id = await js(`(()=>{const a=window.__durbarSimUi.agents().find(x=>!x.parent&&x.live);return a?a.id:''})()`);
      assert.ok(id, `${tag}: a live agent`);
      await js(`window.__durbarSimUi.crew.openPanel(${jsLiteral(id)})`);
      await ok(`document.body.classList.contains('panel-open')&&!!document.getElementById('chat')`, `${tag}: the chat is open`, 10000);
      /* the page's clipboard, read back (the simulator's stand-in writes with it) */
      await js(`window.__clip=[];window.__clipTry=0;window.__clipFail=false;navigator.clipboard.writeText=t=>{window.__clipTry++;if(window.__clipFail)return Promise.reject(new Error('busy'));window.__clip.push(String(t));return Promise.resolve();};true`);
      // review of #2100: nothing calls the stand-in before any click (a caller by a built name, at load, would)
      assert.strictEqual(await js(`window.__durbarSimToolCopy.calls.length`), 0, `${tag}: CALLS-AT-LOAD no request reached the stand-in before any click`);

      // the masked chip and the plain chip, both opened
      await emit({ type: 'toolCall', sessionId: id, callId: 'cc-m', tool: 'bash', phase: 'start', args: { command: MASKED, description: 'Fetch the items' } });
      await emit({ type: 'toolCall', sessionId: id, callId: 'cc-p', tool: 'bash', phase: 'start', args: { command: PLAIN } });
      await ok(`!!__cc(${jsLiteral(id)},'cc-m')&&!!__cc(${jsLiteral(id)},'cc-p')`, `${tag}: both chips are in the chat`);
      for (const c of ['cc-p', 'cc-m']) {
        await js(`(()=>{const c=__cc(${jsLiteral(id)},${jsLiteral(c)});if(!c.classList.contains('open'))c.click();c.scrollIntoView({block:'center'});return true;})()`);
        await ok(`__cc(${jsLiteral(id)},${jsLiteral(c)}).classList.contains('open')&&!!__cc(${jsLiteral(id)},${jsLiteral(c)}).querySelector('.cp-cmd')`, `${tag}: chip ${c} is open with Copy`);
      }

      // nothing masked: Copy copies at once, the real text with its line breaks, no confirm
      await js(`__cc(${jsLiteral(id)},'cc-p').querySelector('.cp-cmd').click()`);
      await ok(`window.__clip.length===1`, `${tag}: COPY-PLAIN Copy on the plain chip copies`);
      assert.deepStrictEqual(await js(`window.__durbarSimToolCopy.calls.slice()`), [{ confirmed: false, answer: 'ok' }], `${tag}: PER-CLICK one Copy on the plain chip, exactly one unconfirmed request`);
      assert.ok(!(await js(`!!__ccd()`)), `${tag}: NO-CONFIRM-PLAIN no question when nothing was masked`);
      assert.deepStrictEqual(await clips(), [PLAIN], `${tag}: COPY-PLAIN the real text, line breaks kept`);

      // something masked: the chip stays masked, Copy asks first
      const shown = await js(`(()=>{const c=__cc(${jsLiteral(id)},'cc-m');return {code:c.querySelector('code').textContent,pre:c.querySelector('pre.cmd').textContent,title:c.title,html:c.outerHTML};})()`);
      assert.ok(!leak(shown.html) && /\[redacted\]/.test(shown.pre), `${tag}: the chip shows the command masked: ${shown.pre.slice(0, 100)}`);
      await js(`__cc(${jsLiteral(id)},'cc-m').querySelector('.cp-cmd').focus();__cc(${jsLiteral(id)},'cc-m').querySelector('.cp-cmd').click()`);
      assert.ok(await until(`!!__ccd()`, 2000), `${tag}: CONFIRM-MASKED Copy on a chip with a masked word asks first`);
      const d = await js(`(()=>{const d=__ccd(),px=e=>parseFloat(getComputedStyle(e).fontSize);return {title:d.querySelector('#mdT').textContent,body:d.querySelector('#mdB').textContent,
        buttons:[...d.querySelectorAll('.dbtn button')].map(b=>b.textContent),focus:document.activeElement&&document.activeElement.textContent,inside:d.contains(document.activeElement),
        sizes:[...d.querySelectorAll('h3,p,button')].map(px),html:d.outerHTML,over:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight};})()`);
      assert.strictEqual(d.title, 'Copy the real command?', `${tag}: the confirm's title`);
      assert.strictEqual(d.body, 'This copy may contain a secret. It is not masked.', `${tag}: the confirm's one line`);
      assert.deepStrictEqual(d.buttons, ['Cancel', 'Copy anyway'], `${tag}: the confirm's buttons`);
      assert.ok(d.inside && d.focus === 'Cancel', `${tag}: the focus starts on Cancel (${d.focus})`);
      assert.ok(d.sizes.every((s) => s >= 10.5), `${tag}: text at least 10.5px: ${d.sizes.join(',')}`);
      assert.ok(!leak(d.html), `${tag}: the confirm holds no value`);
      assert.ok(!d.over, `${tag}: no page overflow with the confirm open`);
      assert.deepStrictEqual(await clips(), [PLAIN], `${tag}: nothing copied while the confirm is open`);
      await H.shot(path.join(OUT, `005-chip-copy-confirm-${tag}.png`), { prep: 'toasts', tag: 'chip-copy' });

      // Cancel, then Escape: nothing copied, the focus back on Copy
      await js(`__ccd().querySelector('[data-cancel]').click()`);
      await ok(`!__ccd()`, `${tag}: Cancel closes the confirm`);
      await ok(`document.activeElement===__cc(${jsLiteral(id)},'cc-m').querySelector('.cp-cmd')`, `${tag}: FOCUS-BACK the focus is back on Copy`);
      assert.deepStrictEqual(await clips(), [PLAIN], `${tag}: CANCEL-NOTHING Cancel copies nothing`);
      await js(`__cc(${jsLiteral(id)},'cc-m').querySelector('.cp-cmd').click()`);
      await ok(`!!__ccd()`, `${tag}: the confirm again`);
      await H.key('Escape');
      await ok(`!__ccd()`, `${tag}: Escape closes the confirm`);
      assert.deepStrictEqual(await clips(), [PLAIN], `${tag}: ESCAPE-NOTHING Escape copies nothing`);

      // Copy anyway: the real text, line breaks kept; the chip stays masked
      await js(`__cc(${jsLiteral(id)},'cc-m').querySelector('.cp-cmd').click()`);
      await ok(`!!__ccd()`, `${tag}: the confirm a third time`);
      await js(`[...__ccd().querySelectorAll('.dbtn button')].find(b=>b.textContent==='Copy anyway').click()`);
      await ok(`window.__clip.length===2`, `${tag}: COPY-REAL Copy anyway copies`);
      assert.deepStrictEqual(await js(`window.__durbarSimToolCopy.calls.slice(1)`), [{ confirmed: true, answer: 'ok' }], `${tag}: PER-CLICK Cancel and Escape sent nothing; Copy anyway sent exactly one confirmed request`);
      assert.strictEqual((await clips())[1], MASKED, `${tag}: COPY-REAL the clipboard gets the real text with its line breaks`);
      await ok(`__cc(${jsLiteral(id)},'cc-m').querySelector('.cp-cmd').textContent==='Copied ✓'`, `${tag}: the button says Copied`);
      assert.ok(!leak(await js(`__cc(${jsLiteral(id)},'cc-m').outerHTML`)), `${tag}: CHIP-STAYS-MASKED the chip shows no value after the copy`);
      // main's flag on a chip the window's mask finds harmless; the flag false; main's own `ask` answer
      const calls = () => js(`window.__durbarSimToolCopy.calls.slice()`);
      const anyway = () => js(`[...__ccd().querySelectorAll('.dbtn button')].find(b=>b.textContent==='Copy anyway').click()`);
      const copyOn = (c) => js(`__cc(${jsLiteral(id)},${jsLiteral(c)}).querySelector('.cp-cmd').click()`);
      await emit({ type: 'toolCall', sessionId: id, callId: 'cc-a', tool: 'bash', phase: 'start', args: { command: FLAGGED }, argsMasked: true });
      await emit({ type: 'toolCall', sessionId: id, callId: 'cc-n', tool: 'bash', phase: 'start', args: { command: UNFLAGGED }, argsMasked: false });
      await emit({ type: 'toolCall', sessionId: id, callId: 'cc-r', tool: 'bash', phase: 'start', args: { command: LATE }, argsMasked: false });
      for (const c of ['cc-a', 'cc-n', 'cc-r']) {
        await ok(`!!__cc(${jsLiteral(id)},${jsLiteral(c)})`, `${tag}: chip ${c} is in the chat`);
        await js(`(()=>{const c=__cc(${jsLiteral(id)},${jsLiteral(c)});if(!c.classList.contains('open'))c.click();c.scrollIntoView({block:'center'});return true;})()`);
        await ok(`__cc(${jsLiteral(id)},${jsLiteral(c)}).classList.contains('open')&&!!__cc(${jsLiteral(id)},${jsLiteral(c)}).querySelector('.cp-cmd')`, `${tag}: chip ${c} is open with Copy`);
        assert.ok(!/\[redacted\]/.test(await js(`__cc(${jsLiteral(id)},${jsLiteral(c)}).querySelector('pre.cmd').textContent`)), `${tag}: chip ${c}: the window's own mask hides nothing`);
      }
      const n0 = (await calls()).length;
      await copyOn('cc-a');
      assert.ok(await until(`!!__ccd()`, 2000), `${tag}: CONFIRM-MAIN main's flag makes Copy ask first`);
      assert.strictEqual((await calls()).length, n0, `${tag}: ASK-FIRST-MAIN no request reached main before the confirm`);
      await anyway();
      await ok(`window.__clip.length===3`, `${tag}: Copy anyway on the flagged chip copies`);
      assert.strictEqual((await clips())[2], FLAGGED, `${tag}: the flagged chip's text`);
      assert.deepStrictEqual((await calls()).slice(n0), [{ confirmed: true, answer: 'ok' }], `${tag}: one confirmed request`);
      await copyOn('cc-n');
      await ok(`window.__clip.length===4`, `${tag}: NO-CONFIRM-FLAG-FALSE the flag false copies at once`);
      assert.ok(!(await js(`!!__ccd()`)), `${tag}: NO-CONFIRM-FLAG-FALSE no question`);
      assert.strictEqual((await clips())[3], UNFLAGGED, `${tag}: the unflagged chip's text`);
      assert.ok(await js(`window.__durbarSimToolCopy.mark(${jsLiteral(id)},'cc-r')`), `${tag}: the stand-in holds cc-r`);
      await copyOn('cc-r');
      assert.ok(await until(`!!__ccd()`, 2000), `${tag}: ASK-RETRY main's ask answer opens the confirm`);
      assert.deepStrictEqual((await calls()).slice(-1), [{ confirmed: false, answer: 'ask' }], `${tag}: ASK-RETRY main answered ask to the unconfirmed request`);
      await js(`__ccd().querySelector('[data-cancel]').click()`);
      await ok(`!__ccd()`, `${tag}: Cancel closes it`);
      assert.strictEqual((await clips()).length, 4, `${tag}: ASK-RETRY Cancel copies nothing`);
      await copyOn('cc-r');
      assert.ok(await until(`!!__ccd()`, 2000), `${tag}: ASK-RETRY the confirm again`);
      await anyway();
      await ok(`window.__clip.length===5`, `${tag}: ASK-RETRY Copy anyway copies`);
      assert.strictEqual((await clips())[4], LATE, `${tag}: ASK-RETRY the text main holds`);
      assert.deepStrictEqual((await calls()).slice(-1), [{ confirmed: true, answer: 'ok' }], `${tag}: ASK-RETRY the second request is confirmed`);
      // review of #2100: a refused Copy copies nothing (no fallback to the masked text) and says why in plain words
      const lastToast = () => js(`(()=>{const t=[...document.querySelectorAll('#toasts .toast')].pop();return t?t.textContent:''})()`);
      const tries = () => js(`window.__clipTry`);
      await emit({ type: 'toolCall', sessionId: id, callId: 'cc-u', tool: 'bash', phase: 'start', args: { command: GONE }, argsMasked: false });
      await emit({ type: 'toolCall', sessionId: id, callId: 'cc-f', tool: 'bash', phase: 'start', args: { command: FAILS }, argsMasked: false });
      for (const c of ['cc-u', 'cc-f']) {
        await ok(`!!__cc(${jsLiteral(id)},${jsLiteral(c)})`, `${tag}: chip ${c} is in the chat`);
        await js(`(()=>{const c=__cc(${jsLiteral(id)},${jsLiteral(c)});if(!c.classList.contains('open'))c.click();c.scrollIntoView({block:'center'});return true;})()`);
        await ok(`__cc(${jsLiteral(id)},${jsLiteral(c)}).classList.contains('open')&&!!__cc(${jsLiteral(id)},${jsLiteral(c)}).querySelector('.cp-cmd')`, `${tag}: chip ${c} is open with Copy`);
      }
      assert.ok(await js(`window.__durbarSimToolCopy.forget(${jsLiteral(id)},'cc-u')`), `${tag}: the stand-in let cc-u go`);
      let t0 = await tries(), n1 = (await calls()).length;
      await copyOn('cc-u');
      await ok(`(()=>{const t=[...document.querySelectorAll('#toasts .toast')].pop();return !!t&&/no longer holds/.test(t.textContent)})()`, `${tag}: REFUSED-UNKNOWN the toast says why`);
      assert.strictEqual(await lastToast(), 'Could not copy: Durbar no longer holds this command (copy it from the chat or the agent app).', `${tag}: REFUSED-UNKNOWN the toast's words`);
      assert.strictEqual((await tries()) - t0, 0, `${tag}: REFUSED-UNKNOWN nothing was written to the clipboard (no fallback to the masked text)`);
      assert.deepStrictEqual((await calls()).slice(n1), [{ confirmed: false, answer: 'unknown' }], `${tag}: REFUSED-UNKNOWN exactly one request, answered unknown`);
      await js(`window.__clipFail=true;true`);
      t0 = await tries(); n1 = (await calls()).length;
      await copyOn('cc-f');
      await ok(`(()=>{const t=[...document.querySelectorAll('#toasts .toast')].pop();return !!t&&t.textContent==='Could not copy to the clipboard.'})()`, `${tag}: REFUSED-FAILED the toast says the clipboard failed`);
      assert.strictEqual((await tries()) - t0, 1, `${tag}: REFUSED-FAILED only the stand-in's own write was tried (no second write of the masked text)`);
      assert.deepStrictEqual((await calls()).slice(n1), [{ confirmed: false, answer: 'failed' }], `${tag}: REFUSED-FAILED exactly one request, answered failed`);
      await js(`window.__clipFail=false;true`);
      assert.strictEqual((await clips()).length, 5, `${tag}: REFUSED nothing reached the clipboard`);
      // review of #2100: the hint goes back down: main's flag says masked, a later update says not masked: Copy copies at once
      await emit({ type: 'toolCall', sessionId: id, callId: 'cc-d', tool: 'bash', phase: 'start', args: { command: DOWN }, argsMasked: true });
      await emit({ type: 'toolCall', sessionId: id, callId: 'cc-d', tool: 'bash', phase: 'update', args: { command: DOWN }, argsMasked: false });
      await ok(`!!__cc(${jsLiteral(id)},'cc-d')`, `${tag}: chip cc-d is in the chat`);
      await js(`(()=>{const c=__cc(${jsLiteral(id)},'cc-d');if(!c.classList.contains('open'))c.click();c.scrollIntoView({block:'center'});return true;})()`);
      await ok(`__cc(${jsLiteral(id)},'cc-d').classList.contains('open')&&!!__cc(${jsLiteral(id)},'cc-d').querySelector('.cp-cmd')`, `${tag}: chip cc-d is open with Copy`);
      n1 = (await calls()).length;
      await copyOn('cc-d');
      await ok(`window.__clip.length===6`, `${tag}: HINT-DOWN the update said nothing is masked: Copy copies`);
      assert.ok(!(await js(`!!__ccd()`)), `${tag}: HINT-DOWN no question once the hint went back down`);
      assert.strictEqual((await clips())[5], DOWN, `${tag}: HINT-DOWN the text`);
      assert.deepStrictEqual((await calls()).slice(n1), [{ confirmed: false, answer: 'ok' }], `${tag}: HINT-DOWN exactly one unconfirmed request`);
      console.log(`[chip-copy] ${tag}: plain copies at once; masked asks (Cancel, Escape, Copy anyway); the real text copied; main's flag and ask answer honoured`);
    }
  }
  console.log('[chip-copy] all checks passed');
  process.exitCode = 0;
};
