/*
 * Spec 003 (2026-10-21 delta, owner's report "a session I had set to Allow all came back in Read-only"): a session that comes back
 * is in the mode last chosen for it, and its chat says so. Simulator only (no AI credits). Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-003-mode-back.js xvfb-run -a npx electron . --no-sandbox
 *
 * 1. Previous sessions: Ada (Read-only) resumes "prev-1", which was last in Allow all. The resumed session is in Allow all, its
 *    mode chip says "restored", and the chat note names the mode and that Ada is in Read-only (the activity log row is unit-tested:
 *    scripts/test-agentops.ts, resumeModeOp).
 *    A session with nothing remembered ("prev-2") comes back in the opener's mode and the note says that too.
 * 2. After a restart (`simresume=1`): Priya's continued session says which mode it is in.
 * Writes 003-mode-back-<w>x<h>.png at 1440x900 and 1280x800 and fails on a miss.
 */
const assert = require('assert');
const path = require('path');
const { waits } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';
const INDEX = path.join(__dirname, '..', 'dist', 'renderer', 'index.html');

module.exports = async (ctx) => {
  const { settle } = waits(ctx);
  const js = (c) => ctx.js(c);
  const log = (...a) => console.log('[003-back]', ...a);
  const hideToasts = () => js(`(()=>{if(!document.getElementById('shotsNoToast')){const s=document.createElement('style');s.id='shotsNoToast';s.textContent='#toasts{display:none!important}';document.head.appendChild(s);}})()`);
  const load = async (w, h, query) => {
    ctx.win.setContentSize(w, h);
    await ctx.win.loadFile(INDEX, { query: { sim: '15', simfreeze: '1', ...query } });
    await ctx.waitFor(`document.querySelectorAll('#stage .desk[data-id]').length>=15`, 15000);
    await settle();
  };
  const openAda = async () => {
    await js(`(()=>{const d=[...document.querySelectorAll('#stage .desk[data-id]')].find(x=>/Ada/.test(x.innerText));d.click();})()`);
    await ctx.waitFor(`!!document.getElementById('prevBtn')&&!document.getElementById('prevBtn').hidden`, 8000);
    if (!(await js(`!!document.querySelector('#prev .prev-row')`))) await js(`document.getElementById('prevBtn').click()`);
    await ctx.waitFor(`document.querySelectorAll('#prevLists .prev-row').length>=4`, 8000);
  };
  const chip = () => js(`(()=>{const c=document.getElementById('modeChip');return c?{text:c.innerText.replace(/\\s+/g,' ').trim(),title:c.title}:null})()`);
  const lastNote = () => js(`(()=>{const n=[...document.querySelectorAll('#chat .note.modeback')].pop();return n?n.innerText.replace(/\\s+/g,' '):''})()`);
  const resume = async (key) => {
    const before = await js(`document.querySelectorAll('#stage .desk[data-id]').length`);
    await js(`document.querySelector('#prevLists .prev-row[data-pk="${key}"] [data-pv="resume"]').click()`);
    await ctx.waitFor(`!!document.querySelector('#chat .note.modeback')&&document.querySelectorAll('#stage .desk[data-id]').length>=${before}`, 8000);
    await settle();
  };

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await load(w, h, {});
    await openAda();
    const adaMode = await js(`(()=>{const c=document.getElementById('modeChip');return c?c.innerText:''})()`);
    assert.ok(/Read-only/.test(adaMode), `Ada starts in Read-only (${adaMode})`);
    await resume('prev-1');
    const c = await chip();
    const note = await lastNote();
    log(w, JSON.stringify(c), note);
    assert.ok(c && /Allow all/.test(c.text) && /restored/.test(c.text), `the resumed session is in Allow all, marked restored (${c && c.text})`);
    assert.ok(/the mode you last chose for this session/.test(c.title), 'the chip tooltip says where it came from');
    assert.ok(/Permissions: Allow all, the mode you last chose for this session\. The session you opened it from is in Read-only\./.test(note), `the chat note says it (${note})`);
    await hideToasts();
    await ctx.sleep(200);
    await ctx.shot(path.join(OUT, `003-mode-back-${w}x${h}.png`));
    if (w === 1440) {
      // nothing remembered for prev-2: the opener's mode, said so
      await openAda();
      await resume('prev-2');
      const c2 = await chip();
      const n2 = await lastNote();
      assert.ok(c2 && /Read-only/.test(c2.text) && !/restored/.test(c2.text), `prev-2 is in the opener's mode (${c2 && c2.text})`);
      assert.ok(/Permissions: Read-only, the same as the session you opened it from \(no mode was remembered for this session\)\./.test(n2), `the note says why (${n2})`);
    }
  }
  // after a restart: the continued session says its mode
  await load(1440, 900, { simresume: '1' });
  await js(`(()=>{const d=[...document.querySelectorAll('#stage .desk[data-id]')].find(x=>/Priya/.test(x.innerText));d.click();})()`);
  await ctx.waitFor(`/Continued after restart/.test(document.getElementById('chat').innerText)&&!!document.querySelector('#chat .note.modeback')`, 8000);
  const n3 = await lastNote();
  log('restart', n3);
  assert.ok(/^Permissions: (Read-only|Ask first|Allow all), the mode you last chose for this session\./.test(n3), `the continued session names its mode (${n3})`);
  console.log('[003-back] PASS');
};
