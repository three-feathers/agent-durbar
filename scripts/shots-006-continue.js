/*
 * Spec 006 FR-021: after a restart a folder continues its last session. Simulator only (no AI credits). Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-006-continue.js xvfb-run -a npx electron . --no-sandbox
 *
 * With `simresume=1` Priya's folder came back as its last session. Before her chat is opened her card says so; opening it
 * resumes the session (the simulator's canned one): the earlier turn is shown with the "Continued after restart" note.
 * Writes continue-last-1440x900.png and continue-last-1280x800.png and fails on a miss.
 */
const assert = require('assert');
const path = require('path');
const OUT = process.env.OUT || '/tmp';
const INDEX = path.join(__dirname, '..', 'dist', 'renderer', 'index.html');

module.exports = async (ctx) => {
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    ctx.win.setContentSize(w, h);
    await ctx.win.loadFile(INDEX, { query: { sim: '15', simfreeze: '1', simresume: '1' } });
    await ctx.waitFor(`document.querySelectorAll('#stage .desk[data-id]').length>=15`, 15000);
    await ctx.sleep(1200);
    const card = await ctx.js(`(()=>{const d=[...document.querySelectorAll('#stage .desk[data-id]')].find(x=>/Priya/.test(x.innerText));return d?{id:d.dataset.id,text:d.innerText.replace(/\\s+/g,' ')}:null})()`);
    console.log('[006-cont]', w, JSON.stringify(card));
    assert.ok(card && /last session/i.test(card.text), 'the card says it continues the last session');
    await ctx.js(`document.querySelector('#stage .desk[data-id="${card.id}"]').click()`);
    await ctx.waitFor(`/Continued after restart/.test(document.getElementById('chat').innerText)`, 5000);
    const chat = await ctx.js(`document.getElementById('chat').innerText.replace(/\\s+/g,' ')`);
    assert.ok(/clause_type column/.test(chat), 'the earlier prompt is shown');
    assert.ok(/0007_clause_type\.sql/.test(chat), 'the earlier reply is shown');
    assert.ok(/Continued after restart: Add the clause-type column migration\. New messages continue this session\./.test(chat), 'the note names the session');
    const status = await ctx.js(`document.querySelector('#panelHead [data-f="status"]').innerText`);
    assert.ok(/Idle/.test(status), `the agent is idle (${status})`);
    await ctx.js(`(()=>{const s=document.createElement('style');s.textContent='#toasts{display:none!important}';document.head.appendChild(s);})()`);
    await ctx.sleep(300);
    await ctx.shot(path.join(OUT, `continue-last-${w}x${h}.png`));
  }
  console.log('[006-cont] PASS');
};
