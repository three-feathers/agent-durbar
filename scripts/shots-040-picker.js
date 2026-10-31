/*
 * The theme picker and removing a saved theme (spec 040 FR-032, T039; spec 035 FR-017). Simulator only, no AI credits.
 *
 * At 1440x900 and 1280x800, with one saved theme of your own (the simulator reads it from `?usertheme=`):
 *   - Settings > Theme lists Clean Office, Retro Pixel and the saved theme ("yours"); there is no "Make a theme with AI" and no
 *     "Import a theme" button any more (spec 040 FR-031), and Export and Remove stay;
 *   - Remove on a built-in theme only says why it stays, and asks nothing;
 *   - Remove on the saved theme asks first; Cancel keeps it; Remove theme deletes it, Clean Office is applied, the list shrinks to
 *     the two built-in themes, and the Remove button is gone with the last saved theme.
 * Pictures: 040-theme-picker-<size>.png (Retro Pixel picked, linked from the website gallery) and 040-remove-theme-<size>.png
 * (the question). SHOTS_OUT, default theme-picker-shots in the OS temp folder.
 *
 *   npm run check:ui -- --only shots-040-picker
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const MINE = { id: 'my-sunrise', name: 'My Sunrise', author: 'Me', version: '1.0', tokens: { '--bg': '#fff1dc', '--surface': '#fffaf2' }, words: {} };

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const out = process.env.SHOTS_OUT || path.join(os.tmpdir(), 'theme-picker-shots');
  fs.mkdirSync(out, { recursive: true });
  const { js, until } = H;
  const ids = () => js(`[...document.querySelectorAll('#thList [data-theme]')].map(b=>b.dataset.theme)`);
  const pick = (id) => js(`(()=>{const b=document.querySelector('#thList [data-theme='+${jsLiteral(JSON.stringify(id))}+']');if(!b)return false;b.click();return true})()`);
  const dlgButton = (label) => js(`(()=>{const b=[...document.querySelectorAll('#scrDlg .dbtn button')].find(x=>x.textContent===${jsLiteral(label)});if(!b)return false;b.click();return true})()`);
  const toasts = () => js(`[...document.querySelectorAll('#toasts .toast')].map(t=>t.innerText).join(' | ')`);
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${w}x${h}`;
    await H.load({ w, h, query: { usertheme: JSON.stringify(MINE) } });
    await js(`document.getElementById('settingsBtn').click()`);
    assert.ok(await until(`!!document.getElementById('thList')`, 6000), `${tag}: Settings shows the theme list`);
    assert.deepStrictEqual(await ids(), ['clean-office', 'retro', 'my-sunrise'], `${tag}: the two built-in themes and the saved one`);
    assert.ok(await js(`!document.getElementById('thAi')&&!document.getElementById('thImport')`), `${tag}: no AI maker and no Import button (spec 040 FR-031)`);
    assert.ok(await js(`!!document.getElementById('thExport')&&!!document.getElementById('thRemove')`), `${tag}: Export and Remove are there`);
    assert.ok(await js(`document.querySelector('#thList [data-theme="my-sunrise"] .mtag').textContent==='yours'`), `${tag}: the saved theme is tagged "yours"`);
    // the picture for the website (Retro Pixel picked, the list scrolled into view)
    assert.ok(await pick('retro'));
    await until(`window.THEME.current().id==='retro'`, 3000);
    await js(`(()=>{const l=document.getElementById('thList'),sec=l.closest('section')||l;let p=sec.parentElement;while(p&&p.scrollHeight<=p.clientHeight+1)p=p.parentElement;if(p)p.scrollTop+=sec.getBoundingClientRect().top-90;return true})()`);
    await until(`(()=>{const r=document.getElementById('thList').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()`, 3000);
    await H.shot(path.join(out, `040-theme-picker-${tag}.png`), { prep: 'toasts', delay: 300 });
    // a built-in theme says why it stays; no question
    await js(`document.getElementById('thRemove').click()`);
    assert.ok(await until(`/built into the app/.test([...document.querySelectorAll('#toasts .toast')].map(t=>t.innerText).join(' '))`, 3000), `${tag}: a built-in theme is not removed (${await toasts()})`);
    assert.ok(await js(`!document.querySelector('#scrDlg .dlg')`), `${tag}: no question for a built-in theme`);
    // the saved theme: the question, Cancel keeps it
    assert.ok(await pick('my-sunrise'));
    await until(`window.THEME.current().id==='my-sunrise'`, 3000);
    await H.clearToasts();
    await js(`document.getElementById('thRemove').click()`);
    assert.ok(await until(`!!document.querySelector('#scrDlg .dlg')&&/Remove this theme\\?/.test(document.getElementById('scrDlgT').textContent)`, 3000), `${tag}: the question is asked`);
    await H.shot(path.join(out, `040-remove-theme-${tag}.png`), { delay: 200 });
    assert.ok(await dlgButton('Cancel'));
    assert.ok(await until(`!document.querySelector('#scrDlg .dlg')`, 3000));
    assert.deepStrictEqual(await ids(), ['clean-office', 'retro', 'my-sunrise'], `${tag}: Cancel keeps the theme`);
    assert.strictEqual(await js(`window.THEME.current().id`), 'my-sunrise', `${tag}: Cancel changes nothing`);
    // Remove theme: gone, Clean Office applied
    await js(`document.getElementById('thRemove').click()`);
    assert.ok(await until(`!!document.querySelector('#scrDlg .dlg')`, 3000));
    assert.ok(await dlgButton('Remove theme'));
    assert.ok(await until(`window.THEME.current().id==='clean-office'&&!document.querySelector('#thList [data-theme="my-sunrise"]')`, 5000), `${tag}: removed, Clean Office is on (${await toasts()})`);
    assert.deepStrictEqual(await ids(), ['clean-office', 'retro'], `${tag}: the list shrinks to the two built-in themes`);
    assert.ok(await js(`!document.getElementById('thRemove')`), `${tag}: no Remove button when nothing of yours is left`);
    assert.ok(await js(`document.querySelector('#thList [data-theme="clean-office"]').getAttribute('aria-pressed')==='true'`), `${tag}: Clean Office shows as picked`);
    console.log(`[picker] ${tag} ok`);
  }
  console.log('[picker] checks passed');
  process.exitCode = 0;
};
