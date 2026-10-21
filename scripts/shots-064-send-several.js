/*
 * Spec 064: one message to several running sessions. Simulator only (no credits). Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-064-send-several.js xvfb-run -a npx electron . --no-sandbox
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-097: shared plumbing
  const { js } = H;
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h });
    // a draft in the open chat must survive a group send
    await js(`document.querySelector('#stage .desk[data-id="sim-1"]').click()`);
    await ctx.waitFor(`!!document.getElementById('msgInput')`, 8000);
    await js(`(()=>{const i=document.getElementById('msgInput');i.value='my unsent draft';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    // the top bar's ⋯ menu offers it
    await js(`document.getElementById('topMoreBtn').click()`);
    await ctx.waitFor(`!!document.getElementById('sendSeveralBtn')&&!document.getElementById('sendSeveralBtn').hidden`, 3000);
    await js(`document.getElementById('sendSeveralBtn').click()`);
    await ctx.waitFor(`!!document.getElementById('mdP')`, 3000);
    const d0 = await js(`({t:document.getElementById('mdT').textContent,ta:document.getElementById('mdIn').tagName,n:document.querySelectorAll('#mdP input').length,off:document.querySelectorAll('#mdP input:disabled').length,
      offNotes:[...document.querySelectorAll('#mdP .dpick.is-off small')].map(s=>s.textContent),btn:document.querySelector('#modeDlg .btn.primary').textContent,dis:document.querySelector('#modeDlg .btn.primary').disabled,
      font:Math.min(...[...document.querySelectorAll('#mdP .dpick-t,#mdP small')].map(e=>parseFloat(getComputedStyle(e).fontSize))),
      fits:(()=>{const D=document.querySelector('#modeDlg .dlg').getBoundingClientRect();return D.bottom<=innerHeight&&D.right<=innerWidth&&D.top>=0})()})`);
    assert.strictEqual(d0.t, 'Send to several sessions');
    assert.strictEqual(d0.ta, 'TEXTAREA');
    assert.ok(d0.n >= 10, `${w}: the running sessions are listed (${d0.n})`);
    assert.ok(d0.off >= 1 && d0.offNotes.every((x) => /busy|waits for you|spending limit|sign-in/.test(x)), `${w}: busy sessions cannot be picked, with a reason: ${JSON.stringify(d0.offNotes)}`);
    assert.ok(d0.dis && d0.btn === 'Send', `${w}: nothing to send yet`);
    assert.ok(d0.font >= 10.5, `${w}: legible (${d0.font}px)`);
    assert.ok(d0.fits, `${w}: the dialog fits the window`);
    const tall = await js(`[...document.querySelectorAll('#mdP .dpick')].filter(l=>l.getBoundingClientRect().height>30).length`);
    assert.strictEqual(tall, 0, `${w}: each session is one line (checkbox, name, reason side by side)`);
    await js(`(()=>{const t=document.getElementById('mdIn');t.value='Pull the latest main and run the tests again.';t.dispatchEvent(new Event('input',{bubbles:true}));
      const free=[...document.querySelectorAll('#mdP input:not(:disabled)')].slice(0,2);free.forEach(cb=>{cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}));});})()`);
    const picked = await js(`[...document.querySelectorAll('#mdP input:checked')].map(cb=>cb.closest('.dpick').querySelector('.dpick-t').textContent.split(' · ')[0])`);
    assert.strictEqual(picked.length, 2);
    assert.strictEqual(await js(`document.querySelector('#modeDlg .btn.primary').textContent`), 'Send to 2 sessions');
    await ctx.sleep(450);
    await ctx.shot(path.join(OUT, `064-send-several-${w}x${h}.png`));
    await js(`document.querySelector('#modeDlg .btn.primary').click()`);
    await ctx.waitFor(`!document.getElementById('modeDlg')`, 3000);
    await ctx.waitFor(`[...document.querySelectorAll('.toast')].some(t=>/Sent to 2 sessions/.test(t.textContent))`, 5000);
    assert.strictEqual(await js(`document.getElementById('msgInput').value`), 'my unsent draft', `${w}: the open chat's draft is untouched`);
    // each picked session got the message in its own chat (open one and look)
    const names = picked;
    for (const nm of names) {
      await js(`document.getElementById('backBtn')&&document.getElementById('backBtn').click()`); await ctx.sleep(300);
      await js(`[...document.querySelectorAll('#stage .desk[data-id]')].find(x=>x.innerText.split('\\n').some(l=>l.trim()===${jsLiteral(nm)}))?.click()`);
      await ctx.waitFor(`!!document.getElementById('chat')`, 5000); await ctx.sleep(400);
      const has = await js(`[...document.querySelectorAll('#chat .msg, #chat .user, #chat [data-role="user"]')].some(m=>/Pull the latest main and run the tests again/.test(m.textContent))||/Pull the latest main and run the tests again/.test(document.getElementById('chat')?document.getElementById('chat').textContent:'')`);
      assert.ok(has, `${w}: ${nm} got the message`);
    }
  }
  console.log('[064] PASS');
};
