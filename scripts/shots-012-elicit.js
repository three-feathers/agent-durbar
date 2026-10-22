/*
 * Checks + screenshots for spec 012 FR-151..FR-155 (issue #290): an MCP elicitation as a form in the question card, and the URL mode.
 * Simulator only (no AI credits). Frozen simulator:
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-012-elicit.js xvfb-run -a npx electron . --no-sandbox
 * Prints "[012-elicit] PASS", or "DRIVER FAILED" with an assertion.
 */
const path = require('path');
const { helpers } = require('./driver-helpers');
const assert = require('assert');
const OUT = process.env.OUT || require('os').tmpdir();
module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-097: shared plumbing
  const { js } = H;
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'mouse', delay: 400, tag: '012-elicit' });
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    for (const mode of ['1', 'url']) {
      await H.load({ w, h, query: { simelicit: mode }, ready: 'fit' });
      // the simulator raises the request 400 ms after start: wait for the simulator's own state, then open that one agent's chat
      // (no sweep over every desk: docs/agent-notes.md)
      const o = await H.openSimAgent(`a=>a.question&&a.question.elicit`, '#chat .note.elicit');
      assert.ok(o.ok, `${w} ${mode}: an agent has the MCP request in its chat: ${JSON.stringify({ id: o.id, ...o.seen })}`);
      await ctx.sleep(600);
      await js(`(()=>{const c=document.querySelector('#chat .note.elicit');if(c)c.scrollIntoView({block:'center'});})()`); await ctx.sleep(300);
      if (mode === '1') {
        const f = await js(`(()=>{const c=document.querySelector('#chat .note.elicit');return {select:!!c.querySelector('select'),number:!!c.querySelector('input[type=number]'),check:!!c.querySelector('input[type=checkbox]'),labels:[...c.querySelectorAll('label')].map(l=>l.textContent.trim()).filter(Boolean).length,btns:[...c.querySelectorAll('button')].map(b=>b.textContent.trim())}})()`);
        assert.ok(f.select && f.number && f.check, `${w}: the form shows a select, a number and a checkbox: ` + JSON.stringify(f));
        assert.ok(f.btns.includes('Submit') && f.btns.includes('Decline') && f.btns.includes('Cancel'), 'Submit / Decline / Cancel: ' + JSON.stringify(f.btns));
        await shot(`012-elicit-form-${w}x${h}.png`);
        // submitting with the required ticket empty shows a plain message and sends nothing
        await js(`[...document.querySelectorAll('#chat .note.elicit button')].find(b=>b.textContent.trim()==='Submit').click()`); await ctx.sleep(300);
        const err = await js(`[...document.querySelectorAll('#chat .note.elicit [aria-invalid="true"]')].length`);
        assert.ok(err >= 1, 'a required empty field is flagged');
        await js(`(()=>{const c=document.querySelector('#chat .note.elicit');const sel=c.querySelector('select');sel.value=sel.options[1].value;sel.dispatchEvent(new Event('change',{bubbles:true}));const n=c.querySelector('input[type=number]');n.value='4521';n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
        await js(`[...document.querySelectorAll('#chat .note.elicit button')].find(b=>b.textContent.trim()==='Submit').click()`); await ctx.sleep(800);
        const done = await js(`(document.querySelector('#chat .note.elicit')||{}).textContent||''`);
        assert.ok(/submitted/.test(done) && !/4521/.test(done), 'the card says submitted and never shows the values: ' + done.slice(0, 200));
      } else {
        const u = await js(`(()=>{const c=document.querySelector('#chat .note.elicit');return {text:c.textContent,btns:[...c.querySelectorAll('button')].map(b=>b.textContent.trim())}})()`);
        assert.ok(/auth\.example\.com/.test(u.text), 'the URL mode shows the host: ' + u.text.slice(0, 200));
        assert.ok(u.btns.some((b) => /Open in browser/.test(b)), 'Open in browser: ' + JSON.stringify(u.btns));
        await shot(`012-elicit-url-${w}x${h}.png`);
      }
      console.log('[012-elicit]', w, mode, 'ok');
    }
  }
  console.log('[012-elicit] PASS');
};
