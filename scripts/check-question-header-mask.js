/*
 * Check for spec 012 (2026-11-22 delta, issue #1937, T428): the question card's header tag and the automatic-answer question (Autopilot) show masked text.
 * Simulator only (no AI credits). An invented token, built from pieces (never written whole in this file), is put in a question's header and in an
 * automatic-answer question's text by events emitted through the simulator's bridge; no text, title or label of the chat may hold any piece of it, and the
 * rest of both texts is still shown. At 1440x900 and 1280x800, in the Flat office and the Real office. Mutants (a patched copy of dist, each dies at its label):
 *   HDRMASK_MUTANT=header   the tag shows the raw header (`h.textContent=safeMask(String(q.header))` -> `h.textContent=q.header`)   => "the header tag"
 *   HDRMASK_MUTANT=auto     the paragraph shows the raw text (`p.textContent=safeMask(String(q&&q.question||''))` -> `p.textContent=String(q&&q.question||'')`)   => "the automatic-answer question"
 * A miss prints DRIVER FAILED (Electron still exits 0), so the npm script exits non-zero unless "all checks passed" is printed.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');
const MUTANT = process.env.HDRMASK_MUTANT || '';
const WORLDS = (process.env.HDRM_WORLDS || 'flat,real').split(',');
const PATCH = {
  header: ['h.textContent=safeMask(String(q.header))', 'h.textContent=q.header'],
  auto: ["p.textContent=safeMask(String(q&&q.question||''))", "p.textContent=String(q&&q.question||'')"],
};
const TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4'; // invented, built from pieces
module.exports = async (ctx) => {
  let INDEX;
  if (MUTANT) {
    assert.ok(PATCH[MUTANT], `HDRMASK_MUTANT is header or auto, not ${MUTANT}`);
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-hdrm-'));
    fs.cpSync(path.join(__dirname, '..', 'dist'), copy, { recursive: true }); // the page reads ../shared too
    const f = path.join(copy, 'renderer', 'app.js'); const src = fs.readFileSync(f, 'utf8'); const [from, to] = PATCH[MUTANT];
    assert.strictEqual(src.split(from).length - 1, 1, `the ${MUTANT} mutant finds its line in app.js once`);
    fs.writeFileSync(f, src.replace(from, () => to));
    INDEX = path.join(copy, 'renderer', 'index.html');
  }
  const H = helpers(ctx);
  const { settle, js } = H;
  for (const world of WORLDS) for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${world} ${w}x${h}`;
    const query = { sim: '15', simquestion: '1', ...(world === 'flat' ? {} : { officeview: 'real' }) };
    await H.load({ w, h, query, ready: 'fit', ...(INDEX ? { index: INDEX } : {}) });
    let id;
    if (world === 'flat') { const o = await H.openSimAgent(`a=>!a.parent&&a.question`, '#chat .note.question .q-opt'); assert.ok(o.ok, `${tag}: an agent has the question in its chat`); id = o.id; }
    else {
      id = await js(`(()=>{const a=window.__durbarSimUi.agents().find(a=>!a.parent&&a.question);return a&&a.id})()`);
      assert.ok(id, `${tag}: an agent asks a question`);
      await js(`window.__durbarSimUi.crew.openPanel(${jsLiteral(id)})`);
      assert.ok(await H.until(`document.body.classList.contains('panel-open')&&!!document.querySelector('#chat .note.question .q-opt')`, 15000), `${tag}: the chat shows the question`);
    }
    await settle();
    // a question whose HEADER holds the token, and an automatic answer whose question text holds it (spec 099 FR-030)
    await js(`(()=>{const e=window.__durbarSimEmit,id=${jsLiteral(id)},t=${jsLiteral(TOKEN)};
      e({type:'question',sessionId:id,timestamp:Date.now(),phase:'asked',requestId:'hdrm-1',questions:[{question:'Which branch should I use?',header:'hdr '+t,multiSelect:false,options:[{label:'main'},{label:'dev'}]}]});
      e({type:'question',sessionId:id,timestamp:Date.now(),phase:'asked',requestId:'hdrm-2',autoAnswered:true,questions:[{question:'Auto question '+t+' tail',multiSelect:false,options:[{label:'a'}]}]});return 1})()`);
    assert.ok(await H.until(`[...document.querySelectorAll('#chat .note.question .q-text .tag')].some(t=>t.textContent.indexOf('hdr')===0)&&!!document.querySelector('#chat .note.ap-question')`, 10000), `${tag}: both events are in the chat`);
    const r = await js(`(()=>{const chat=document.getElementById('chat');const all=[chat.innerHTML,chat.textContent,...[...chat.querySelectorAll('[title],[aria-label],[placeholder]')].map(e=>(e.title||'')+(e.getAttribute('aria-label')||'')+(e.getAttribute('placeholder')||''))].join('\\n');
      const tags=[...chat.querySelectorAll('.note.question .q-text .tag')].map(t=>t.textContent).filter(t=>t.indexOf('hdr')===0);
      const auto=[...chat.querySelectorAll('.note.ap-question .q-text')].map(p=>p.textContent).filter(t=>t.indexOf('Auto question')===0);
      return {leak:/ghp_|A1b2C3d4|E5f6G7h8|I9j0K1l2|M3n4/.test(all),tags,auto,tagLeak:tags.some(t=>/ghp_|A1b2C3d4|E5f6G7h8/.test(t)),autoLeak:auto.some(t=>/ghp_|A1b2C3d4|E5f6G7h8/.test(t))}})()`);
    assert.ok(r.tags.length === 1 && !r.tagLeak, `${tag}: the header tag shows no piece of the token: ${JSON.stringify(r.tags)}`);
    assert.ok(r.auto.length === 1 && !r.autoLeak, `${tag}: the automatic-answer question shows no piece of the token: ${JSON.stringify(r.auto)}`);
    assert.ok(r.tags[0].startsWith('hdr ') && r.auto[0].startsWith('Auto question ') && r.auto[0].endsWith(' tail'), `${tag}: the rest of both texts is still shown: ${JSON.stringify([r.tags[0], r.auto[0]])}`);
    assert.ok(!r.leak, `${tag}: the token is in no text, title or label of the chat`);
  }
  console.log('[hdrmask] all checks passed');
};
