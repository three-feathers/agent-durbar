/*
 * Spec 116 T009 (FR-022; US1.2): the memory note in the simulator (memory in RAM, example path, no AI credits, nothing written). At 1440x900 and 1280x800:
 *  - with the memory on (page address simmemory=on) an agent's composer shows "Sent with your next message: memory note" as a closed disclosure holding the
 *    exact text; with the memory off (default) it shows nothing;
 *  - the person's first typed message goes; a "Memory note sent" line sits right above the bubble and opens the same text, byte for byte;
 *  - the second message carries none, and no preview is shown again;
 *  - text >= 10.5px, no sideways overflow in the composer.
 * Worlds: Flat and Real office in one run; the Retro world with DRIVER_WORLD=retro (`officeview=real`). Shots: 116-note-[<world>-]<state>-<w>x<h>.png in OUT (Flat has no world word). Prints "[116] note PASS". Linux with xvfb-run (never display :99):
 *
 *   npm run build
 *   OUT=$PWD/test-results/116-note DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-116-note.js xvfb-run -a npx electron . --no-sandbox
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  fs.mkdirSync(OUT, { recursive: true });
  const H = helpers(ctx);
  const { js, until } = H;
  const retro = process.env.DRIVER_WORLD === 'retro';
  const worlds = retro ? [['retro', { officeview: 'real' }]] : [['flat', {}], ['real', { officeview: 'real' }]];
  const readyReal = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
  const readyRetro = `!!document.querySelector('#stage .ro[data-world="retro"]')`;
  const opts = (world) => (world === 'real' ? { ready: readyReal, settle: false } : world === 'retro' ? { ready: readyRetro, settle: false } : {});
  const openAgent = (world) => world !== 'flat' ? js(`(()=>{const d=[...document.querySelectorAll('#stage .ro .ro-plate[data-id]')].find(x=>!/needs your|asks you|waiting/i.test(x.innerText));if(d)d.click();return d?d.dataset.id:''})()`) : js(`(()=>{const d=[...document.querySelectorAll('#stage .desk[data-id]')].find(x=>!/needs your|asks you|waiting/i.test(x.innerText));if(d)d.click();return d?d.dataset.id:''})()`);
  const type = (t) => js(`(()=>{const i=document.getElementById('msgInput');i.value=${jsLiteral(t)};i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('sendBtn').click();})()`);
  for (const [world, base] of worlds) for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const shot = (state) => H.shot(path.join(OUT, `116-note-${world === 'flat' ? '' : world + '-'}${state}-${w}x${h}.png`), { prep: 'calm', blur: false, delay: 300 });
    // off (the default): no preview
    await H.load({ w, h, query: { ...base }, ...opts(world) });
    await openAgent(world);
    assert.ok(await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('msgInput')`), 'the chat is open');
    assert.ok(await js(`document.getElementById('memNote').hidden===true&&document.getElementById('memNote').children.length===0`), `${w}: memory off: no note in the composer`);
    // on: the preview
    await H.load({ w, h, query: { ...base, simmemory: 'on' }, ...opts(world) });
    await openAgent(world);
    assert.ok(await until(`!!document.querySelector('#memNote:not([hidden]) details summary')`), `${w}: the preview is in the composer`);
    assert.strictEqual(await js(`document.querySelector('#memNote summary').textContent`), 'Sent with your next message: memory note');
    assert.strictEqual(await js(`document.querySelector('#memNote .mem-note-lead').textContent`), 'This is what the agent reads first:');
    const text = await js(`document.querySelector('#memNote pre').textContent`);
    assert.ok(/^\[Memory note [0-9a-f]{16} from Agent Durbar\./.test(text) && /Memory folder: ~\/notes\/brain/.test(text) && /\[End of memory note [0-9a-f]{16}\]$/.test(text), 'the preview holds the framed text');
    assert.ok(await js(`!document.querySelector('#memNote details').open`), 'closed by default');
    await shot('preview');
    await js(`document.querySelector('#memNote summary').click();true`);
    assert.ok(await until(`document.querySelector('#memNote details').open`), 'the summary opens it');
    await shot('preview-open');
    const small = await js(`[...document.querySelectorAll('#memNote summary,#memNote pre')].filter(e=>parseFloat(getComputedStyle(e).fontSize)<10.5).length`);
    assert.strictEqual(small, 0, 'text is at least 10.5px');
    assert.ok(await js(`(()=>{const c=document.querySelector('.composer');return c.scrollWidth<=c.clientWidth+1})()`), `${w}: no sideways overflow in the composer`);
    // the first typed message
    await type('Please read the notes and tell me what you find');
    assert.ok(await until(`!!document.querySelector('#chat .mem-note-sent')`), `${w}: the Memory note sent line appears`);
    assert.strictEqual(await js(`document.querySelector('#chat .mem-note-sent summary').textContent`), 'Memory note sent');
    assert.strictEqual(await js(`document.querySelector('#chat .mem-note-sent pre').textContent`), text, 'the line opens the exact text that was previewed');
    assert.ok(await js(`document.querySelector('#chat .mem-note-sent').nextElementSibling.classList.contains('msg')&&document.querySelector('#chat .mem-note-sent').nextElementSibling.classList.contains('user')`), 'the line is right above the bubble');
    assert.ok(await until(`document.getElementById('memNote').hidden===true`), 'the preview is gone after the send');
    await js(`document.querySelector('#chat .mem-note-sent summary').click();document.querySelector('#chat .mem-note-sent').scrollIntoView({block:'center'});true`);
    await shot('sent');
    // the second message carries none
    await type('And one more thing');
    assert.ok(await until(`[...document.querySelectorAll('#chat .msg.user .bubble')].some(b=>b.textContent==='And one more thing')`), 'the second message is in the chat');
    assert.strictEqual(await js(`document.querySelectorAll('#chat .mem-note-sent').length`), 1, 'one note line only');
    assert.ok(await js(`document.getElementById('memNote').hidden===true`), 'no preview again');
    // a long chat: the note at the top does not push the person's message out of sight (Vikram's check)
    for (let i = 0; i < 8; i++) {
      await type('Follow-up question number ' + (i + 1) + ': what does the registry export, and which callers still use the old names?');
      const want = 'Follow-up question number ' + (i + 1) + ':';
      assert.ok(await until(`[...document.querySelectorAll('#chat .msg.user .bubble')].some(b=>b.textContent.startsWith(${jsLiteral(want)}))`), 'follow-up ' + (i + 1) + ' is in the chat');
    }
    await js(`(()=>{const n=document.querySelector('#chat .mem-note-sent');n.open=true;n.scrollIntoView({block:'start'});return true})()`);
    await H.settle();
    assert.ok(await js(`(()=>{const c=document.getElementById('chat').getBoundingClientRect();const e=document.querySelector('#chat .mem-note-sent');const b=e.nextElementSibling.querySelector('.bubble').getBoundingClientRect();return b.top>=c.top&&b.bottom<=c.bottom+1&&e.getBoundingClientRect().top>=c.top-1})()`), `${world} ${w}: with the note open at the top of a long chat, the person's first message is still in view`);
    assert.ok(await js(`document.querySelector('#chat .mem-note-sent .mem-note-lead').textContent==='This is what the agent reads first:'`), 'the opened line says what it is');
    await shot('long');
  }
  console.log('[116] note PASS ' + worlds.map((x) => x[0]).join(','));
};
