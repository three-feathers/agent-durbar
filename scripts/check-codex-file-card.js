/*
 * Check for spec 052 FR-172: a Codex write request's permission card names the files and shows the change. Simulator only (no AI credits).
 *
 *   npm run check:ui -- --only check-codex-file-card
 *   OUT=docs/screenshots  (optional) also saves the screenshots
 *
 * `simkinds=mixed` makes Lena a Codex agent waiting for a write; `simcodexfile=1` gives her request the shape the Codex adapter now
 * builds from the `fileChange` item (the first file, "+1 more", a two-file diff); `simcodexfile=none` the shape for a request whose item
 * is not known ("write (Codex did not say which file)"). At 1440x900 and 1280x800, the card names the file, "Show the change (+3 −1)" opens the diff of both files; without an item the
 * card says Codex did not say which file, with no diff. A miss prints DRIVER FAILED.
 */
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || require('os').tmpdir();
module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const card = () => js(`(()=>{const n=document.querySelector('#chat .note.perm:not(.settled)');if(!n)return null;const d=n.querySelector('details.pdiff');
    return {sum:n.querySelector('.psum').textContent,diff:d?d.querySelector('summary').textContent:'',lines:d?[...d.querySelectorAll('.dl')].map(x=>x.textContent):[],btns:[...n.querySelectorAll('.note-actions button')].map(b=>b.textContent)}})()`);
  const openLena = async (w, h, v) => {
    const query = { simkinds: 'mixed', simcodexfile: v };
    await H.load({ w, h, query, ready: 'fit' });
    // the office must be in view with Lena's desk drawn (a slower runner may still show the chat restored by the reload, where desks have no innerText)
    await until(`(()=>{const b=document.getElementById('backBtn');if(b&&document.body.classList.contains('panel-open'))b.click();return [...document.querySelectorAll('#stage .desk[data-id]')].some((x)=>x.innerText.trim().startsWith('Lena'))})()`, 8000);
    const id = await H.idOf('Lena');
    assert.ok(id, `${w}: Lena is in the office`);
    await js(`document.querySelector('#stage .desk[data-id="'+${jsLiteral(id)}+'"]').click()`);
    await until(`!!document.querySelector('#chat .note.perm:not(.settled)')`); await settle();
  };
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    {
      const tag = `${w}`;
      await openLena(w, h, '1');
      const c = await card();
      assert.strictEqual(c.sum, 'write src/styles/focus.css (+1 more)', `${tag}: the card names the file: ${JSON.stringify(c)}`);
      assert.strictEqual(c.diff, 'Show the change (+3 −1)', `${tag}: the change and its counts: ${JSON.stringify(c)}`);
      await js(`document.querySelector('#chat .note.perm:not(.settled) details.pdiff').open=true`); await settle();
      const c2 = await card();
      assert.ok(c2.lines.includes('+++ b/docs/a11y.md') && c2.lines.includes('+  outline: 2px solid var(--blue);'), `${tag}: the diff of both files: ${JSON.stringify(c2.lines)}`);
      assert.ok(c2.btns.includes('Allow once') && c2.btns.includes('Deny'), `${tag}: the answers: ${JSON.stringify(c2.btns)}`);
      // review on #470: the session grant names the folder of every file
      assert.ok(c2.btns.includes('Allow “write in src/styles/, docs/” for this session'), `${tag}: the session grant names both folders: ${JSON.stringify(c2.btns)}`);
      await js(`document.querySelector('#chat .note.perm:not(.settled)').scrollIntoView({block:'end'})`); await settle();
      await H.shot(path.join(OUT, `052-codex-file-card-${w}x${h}.png`), { prep: 'mouse', tag: 'codex-file-card' });
      // review on #470: approving it for the session gives one grant chip per folder, as the broker does
      {
        await js(`document.querySelector('#chat .note.perm:not(.settled) .note-actions button.session').click()`);
        await until(`document.querySelectorAll('#grants:not([hidden]) .gchip').length>=2`);
        const chips = await js(`[...document.querySelectorAll('#grants:not([hidden]) .gchip')].map(c=>c.textContent.trim())`);
        assert.ok(chips.length === 2 && chips.some((c) => c.includes('styles/')) && chips.some((c) => c.includes('docs/')), `${tag}: one chip per granted folder: ${JSON.stringify(chips)}`);
      }
      // review on #470: a write in five folders: the session button keeps every folder or "and N more folders" (never cut away)
      await openLena(w, h, 'many');
      const m = await card();
      assert.strictEqual(m.btns[1], 'Allow “write in components/, documentation/, scripts/ and 2 more folders” for this session', `${tag}: five folders: ${JSON.stringify(m.btns)}`);
      await openLena(w, h, 'none');
      const n = await card();
      assert.strictEqual(n.sum, 'write (Codex did not say which file)', `${tag}: no item: the card says so: ${JSON.stringify(n)}`);
      assert.strictEqual(n.diff, '', `${tag}: no item: no diff`);
      await H.shot(path.join(OUT, `052-codex-file-card-none-${w}x${h}.png`), { prep: 'mouse', tag: 'codex-file-card' });
      console.log('[codex-file-card]', tag, 'ok');
    }
  }
  console.log('[codex-file-card] all checks passed');
};
