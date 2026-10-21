/*
 * Spec 012 FR-087 (owner 2026-10-20, option c): when Codex refuses Read-only / Ask first (its sandbox could not start), the error
 * note never suggests a mode in its text, and offers a "Change mode…" button that opens the usual mode menu (all three modes and
 * their help). Simulator only (`simsendfail=sandbox`), no credits. Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/check-mode-refusal.js xvfb-run -a npx electron . --no-sandbox
 */
const assert = require('assert');
const path = require('path');
const { helpers } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-097: shared plumbing
  const { js } = H;
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, query: { simkinds: 'mixed', simsendfail: 'sandbox' } });
    // a Read-only agent (sim-1 is read-only); its send is refused like Codex's sandbox refusal
    await js(`document.querySelector('#stage .desk[data-id="sim-1"]').click()`);
    await ctx.waitFor(`!!document.getElementById('msgInput')`, 8000);
    await js(`(()=>{const i=document.getElementById('msgInput');i.value='Reply with only the word ok.';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('sendBtn').click();})()`);
    await ctx.waitFor(`!![...document.querySelectorAll('.note.err')].find(n=>/Read-only and Ask first need/.test(n.textContent))`, 8000);
    const note = await js(`(()=>{const n=[...document.querySelectorAll('.note.err')].pop();const b=n.querySelector('[data-act="modeRefusal"]');const r=b&&b.getBoundingClientRect(),R=n.getBoundingClientRect();return {text:n.textContent,btn:b&&b.textContent,inside:!!b&&r.left>=R.left&&r.right<=R.right+0.5&&r.bottom<=R.bottom+0.5,font:b&&parseFloat(getComputedStyle(b).fontSize)}})()`);
    assert.strictEqual(note.btn, 'Change mode…', `${w}: the note offers Change mode…`);
    assert.ok(note.inside, `${w}: the button sits inside the note`);
    assert.ok(note.font >= 10.5, `${w}: legible`);
    assert.ok(!/allow all/i.test(note.text.replace('Change mode…', '')), `${w}: the text suggests no mode`);
    await ctx.sleep(150);
    await H.shot(path.join(OUT, `012-mode-refusal-${w}x${h}.png`), { delay: 0 });
    await js(`document.querySelector('.note.err [data-act="modeRefusal"]').click()`);
    await ctx.waitFor(`!!document.getElementById('modeMenu')`, 5000);
    const items = await js(`[...document.querySelectorAll('#modeMenu [data-mode]')].map(b=>b.dataset.mode)`);
    assert.deepStrictEqual(items, ['read-only', 'ask', 'allow'], `${w}: the usual mode menu, every mode`);
    await ctx.sleep(150);
    await H.shot(path.join(OUT, `012-mode-refusal-menu-${w}x${h}.png`), { delay: 0 });
    await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  }
  console.log('[mode-refusal] PASS');
};
