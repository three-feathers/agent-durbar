/*
 * Check for spec 083 T050 (issue 699): Open source on a note (FR-046). Simulator only: no AI credits, nothing on disk.
 *
 *   npm run check:ui -- --only check-notes-source
 *   OUT=docs/screenshots  (optional) where the screenshot goes (default: a temp folder)
 *   NOTES_ONE_SIZE=1      one size only (a quick run)
 *
 * At 1440x900 and 1280x800 with 15 agents (Ada and Noor share a folder; Noor's chat is made long; that folder has Previous sessions):
 *   AC1  a note from an office session: its chat opens, the message is revealed inside #chat (the page does not scroll) and outlined 1.2 s;
 *        under reduced motion the outline stays but nothing animates;
 *   AC2  a note from a previous session opens it through the Previous sessions path (resumeSession, nothing sent), then reveals the message;
 *   AC3  a gone session and a missing message give the FR-046 toasts, and the note stays.
 * A miss is collected; the run fails at the end unless "all checks passed" is printed.
 */
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const OUT = process.env.OUT || process.env.SHOTS_OUT || require('os').tmpdir();
const SIZES = process.env.NOTES_ONE_SIZE ? [[1440, 900]] : [[1440, 900], [1280, 800]];
const GONE = 'The session this note came from is no longer available. The note stays.';
const NOMSG = 'Could not find the message in this session.';
const PREV_USER = 'Rename the filings handler to filingsSearch and update its tests.'; // the first message of the simulator's prev-1 history

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js, wc } = H;
  const fails = [];
  wc().on('console-message', (...a) => { const m = a[0] && a[0].message !== undefined ? a[0] : { level: a[1], message: a[2] }; if (m.level === 'error' || m.level === 3) console.log('PAGE ERROR', String(m.message).slice(0, 300)); });
  const check = (cond, msg) => { if (!cond) { fails.push(msg); console.log('FAIL ' + msg); } };
  const motion = async (reduce) => {
    const d = wc().debugger;
    if (!d.isAttached()) d.attach('1.3');
    await d.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] });
  };
  const load = async (w, h) => {
    await H.load({ w, h, query: {}, ready: 'fit' });
    await js(`(()=>{const b=window.__durbarSimUi.bridge();window.__calls=[];for(const k of ['send','resumeSession']){const f=b[k];if(!f||f.__rec)continue;const w=function(...a){window.__calls.push(k);return f.apply(this,a)};w.__rec=1;b[k]=w;}})()`);
  };
  const calls = (k) => js(`window.__calls.filter(c=>c===${jsLiteral(k)}).length`);
  const open = async (name) => {
    const id = await H.idOf(name);
    assert.ok(id, `${name} is on the floor`);
    if (await js(`document.body.classList.contains('panel-open')`)) { await js(`document.getElementById('backBtn').click()`); await until(`!document.body.classList.contains('panel-open')`, 4000); }
    await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"]`)}).click()`);
    await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('msgInput')`, 15000);
    await settle();
    return id;
  };
  const notesOf = () => js(`JSON.stringify(window.__durbarSimUi.notes.all())`).then(JSON.parse);
  const toasts = () => js(`[...document.querySelectorAll('#toasts .toast')].map(t=>t.textContent).join(' | ')`);
  const panelName = () => js(`(document.getElementById('panelTitle')||{}).textContent||''`);
  /* a note of the folder from a given session, through the simulator's own save (digest as main computes it) */
  const save = (id, role, ord, text, session) => js(`window.__durbarSimUi.bridge().notesSave(${jsLiteral(id)},{role:${jsLiteral(role)},ord:${jsLiteral(ord)},text:${jsLiteral(text)},from:${jsLiteral(role)},simSession:${jsLiteral(session)}}).then(r=>!!r.ok)`);
  const openDrawer = async () => {
    await js(`window.__durbarSimUi.notes.open()`);
    return until(`(()=>{const d=document.getElementById('notesDrawer');return !!d&&!d.hidden&&!!d.querySelector('.nt-row')})()`, 8000);
  };
  /* the ⋯ of the drawer row of the note whose text holds `part`, then Open source */
  const openSource = async (part) => {
    const ok = await js(`(()=>{const n=window.__durbarSimUi.notes.all().find(x=>x.text.includes(${jsLiteral(part)}));const r=n&&document.querySelector('#notesDrawer .nt-row[data-id="'+n.id+'"]');const m=r&&r.querySelector('.nt-more');if(!m)return false;m.click();return true})()`);
    if (!ok) return false;
    if (!await until(`!!document.querySelector('#modeMenu [data-nmact="source"]')`, 4000)) return false;
    await js(`document.querySelector('#modeMenu [data-nmact="source"]').click()`);
    return true;
  };
  /* the chat's first reply (above the fold: a chat opens at its end, so the reveal has to scroll up) */
  const firstReply = () => js(`(()=>{const all=[...document.querySelectorAll('#chat .chat-inner .msg.agent .bubble')],i=0,b=all[i];return b?{ord:i,text:b._raw||''}:null})()`);
  const found = () => js(`(()=>{const b=document.querySelector('#chat .bubble.nt-found');if(!b)return null;const c=document.getElementById('chat').getBoundingClientRect(),r=b.getBoundingClientRect(),s=getComputedStyle(b);return {text:(b._raw||b.textContent||'').slice(0,80),inside:r.top>=c.top-1&&(r.bottom<=c.bottom+1||r.height>c.height),page:document.scrollingElement.scrollTop,top:document.getElementById('chat').scrollTop,outline:s.outlineStyle,anim:s.animationName}})()`).then((v) => v);

  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    await load(w, h);

    /* ---- AC1: a note from an office session ---- */
    const srcId = await open('Noor');
    /* a long chat: a few turns with the simulator, so the reveal has to scroll */
    for (let i = 1; i <= 4; i++) {
      const n0 = await js(`document.querySelectorAll('#chat .msg.user').length`);
      await js(`(()=>{const m=document.getElementById('msgInput');m.focus();m.value=${jsLiteral('Please list the open items, number ' + i + ', with one line each.')};m.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('sendBtn').click();})()`);
      await until(`document.querySelectorAll('#chat .msg.user').length>${jsLiteral(n0)}&&!document.querySelector('#chat .bubble.caret')&&!!document.querySelector('#chat .msg.agent .bubble > .nt-btn')&&(()=>{const b=document.getElementById('sendBtn');return !!b&&b.getClientRects().length>0})()`, 20000);
    }
    await until(`!!document.querySelector('#chat .chat-inner .msg.agent .bubble > .nt-btn')`, 15000);
    const reply = await firstReply();
    check(reply && reply.text, `${tag}: Noor has a finished reply to save`);
    check(await save(srcId, 'agent', reply.ord, reply.text, srcId), `${tag}: the note from Noor's session is saved`);
    await open('Ada');
    check(await openDrawer(), `${tag}: the drawer opens from another chat of the folder`);
    /* the picture is taken inside the 1.2 s: the fade is held still for it (a style only the driver adds) */
    await js(`(()=>{const e=document.createElement('style');e.id='ntShotStyle';e.textContent='.bubble.nt-found{animation:none!important}';document.head.appendChild(e)})()`);
    check(await openSource(reply.text.slice(0, 20)), `${tag}: the row's ⋯ offers Open source`);
    check(await until(`/Noor/.test((document.getElementById('panelTitle')||{}).textContent||'')&&!!document.querySelector('#chat .bubble.nt-found')`, 8000), `${tag}: Noor's chat opens with the message outlined`);
    const f1 = await found();
    check(f1 && f1.inside && f1.page === 0, `${tag}: the message is inside #chat and the page did not scroll (${JSON.stringify(f1)})`);
    check(await js(`document.getElementById('notesDrawer').hidden`), `${tag}: the drawer closed so the chat is uncovered`);
    await H.shot(path.join(OUT, `083-notes-source-${w}x${h}.png`), { prep: 'calm', tag: 'notes-source', keepActions: false });
    await js(`document.getElementById('ntShotStyle').remove()`);
    check(await until(`!document.querySelector('#chat .bubble.nt-found')`, 4000), `${tag}: the outline ends`);
    /* a second Open source within the 1.2 s starts the 1.2 s again (one timer on the bubble; the class's last add and its removal are timed in the page) */
    await js(`(()=>{window.__nt={add:0,gone:0};const was=new WeakMap();new MutationObserver(ms=>{for(const m of ms){const e=m.target,on=e.classList.contains('nt-found');if(!!was.get(e)===on)continue;was.set(e,on);if(on)window.__nt.add=performance.now();else window.__nt.gone=performance.now();}}).observe(document.body,{subtree:true,attributes:true,attributeFilter:['class'],attributeOldValue:false})})()`);
    await openDrawer();
    check(await openSource(reply.text.slice(0, 20)), `${tag}: Open source once more`);
    check(await until(`!!document.querySelector('#chat .bubble.nt-found')`, 8000), `${tag}: outlined again`);
    await openDrawer();
    await until(`performance.now()-window.__nt.add>300`, 1000); // well inside the first 1.2 s: the first timer is still running
    await js(`void (window.__t2=performance.now())`);
    check(await openSource(reply.text.slice(0, 20)), `${tag}: and a second time at once`);
    check(await until(`window.__nt.gone>window.__nt.add&&!document.querySelector('#chat .bubble.nt-found')`, 8000), `${tag}: the outline ends again`);
    const span = await js(`window.__nt.gone-window.__t2`);
    check(span >= 1100, `${tag}: the outline lasts the full 1.2 s from the second click (${Math.round(span)} ms)`);
    /* reduced motion: the outline stays, nothing animates */
    await motion(true);
    await open('Ada'); await openDrawer();
    check(await openSource(reply.text.slice(0, 20)), `${tag}: Open source again under reduced motion`);
    check(await until(`!!document.querySelector('#chat .bubble.nt-found')`, 8000), `${tag}: outlined under reduced motion`);
    const f2 = await found();
    check(f2 && f2.outline === 'solid' && f2.anim === 'none', `${tag}: no animation under reduced motion (${JSON.stringify(f2)})`);
    check(await until(`!document.querySelector('#chat .bubble.nt-found')`, 4000), `${tag}: the outline ends under reduced motion too`);
    await motion(false);

    await js(`window.__calls=[]`); // the turns above used send; from here Open source must send nothing
    /* ---- the same from the Notes screen, over the office: the screen closes, the chat opens ---- */
    await js(`document.getElementById('backBtn').click()`);
    check(await until(`!document.body.classList.contains('panel-open')`, 4000), `${tag}: back to the office`);
    const rid = await js(`(()=>{const d=document.querySelector(${jsLiteral(`#stage .desk[data-id="${srcId}"]`)});const r=d&&d.closest('section.room');const b=r&&r.querySelector('[data-foldermenu]');return b?b.dataset.foldermenu:''})()`);
    await js(`document.querySelector(${jsLiteral(`[data-foldermenu="${rid}"]`)}).click()`);
    check(await until(`!!document.querySelector('#modeMenu [data-fact="notes"]')`, 5000), `${tag}: the folder ⋯ has Notes`);
    await js(`document.querySelector('#modeMenu [data-fact="notes"]').click()`);
    check(await until(`!!document.getElementById('nsHost')&&document.querySelectorAll('#nsList .nt-row').length>0`, 8000), `${tag}: the Notes screen shows`);
    const okScr = await js(`(()=>{const n=window.__durbarSimUi.notes.all().find(x=>x.text.includes(${jsLiteral(reply.text.slice(0, 20))}));const r=n&&document.querySelector('#nsList .nt-row[data-id="'+n.id+'"]');const m=r&&r.querySelector('.nt-more');if(!m)return false;m.click();return true})()`);
    check(okScr && await until(`!!document.querySelector('#modeMenu [data-nmact="source"]')`, 4000), `${tag}: the screen's row menu offers Open source`);
    await js(`document.querySelector('#modeMenu [data-nmact="source"]').click()`);
    check(await until(`!document.body.classList.contains('screen-open')&&document.body.classList.contains('panel-open')&&!!document.querySelector('#chat .bubble.nt-found')`, 8000), `${tag}: the screen closed and the chat opened with the message outlined`);
    check(await until(`!document.querySelector('#chat .bubble.nt-found')`, 4000), `${tag}: the outline ends`);

    /* ---- AC3: a missing message, then a gone session; the note stays ---- */
    const GHOST = 'A saved idea that is not in any chat of this simulated session.';
    check(await save(srcId, 'agent', 0, GHOST, srcId), `${tag}: a note whose message is not in the chat is saved`);
    await open('Ada'); await openDrawer();
    check(await openSource(GHOST.slice(0, 20)), `${tag}: Open source on the missing message`);
    check(await until(`/Noor/.test((document.getElementById('panelTitle')||{}).textContent||'')&&document.body.textContent.includes(${jsLiteral(NOMSG)})`, 8000), `${tag}: the chat opens and the toast says the message was not found`);
    check(!(await found()), `${tag}: nothing is outlined when the message is missing`);
    const openerId = await open('Ada');
    check(await save(openerId, 'user', 0, 'An idea from a session that is gone.', 'sim-gone-session'), `${tag}: a note from a gone session is saved`);
    await openDrawer();
    check(await openSource('An idea from a session'), `${tag}: Open source on the gone session`);
    check(await until(`[...document.querySelectorAll('#toasts .toast')].some(t=>t.textContent===${jsLiteral(GONE)})`, 8000), `${tag}: the toast says the session is gone (${await toasts()})`);
    check(await js(`!document.getElementById('notesDrawer').hidden`) && (await notesOf()).some((n) => n.text.startsWith('An idea from a session')) && (await notesOf()).some((n) => n.text === GHOST), `${tag}: the drawer stays open and both notes stay`);
    check((await calls('resumeSession')) === 0, `${tag}: a gone session resumes nothing`);

    /* a failed resume leaves the drawer open (the toast says why) */
    check(await save(openerId, 'user', 0, 'Another idea from a previous session.', 'prev-2'), `${tag}: a note from prev-2 is saved`);
    await js(`(()=>{const b=window.__durbarSimUi.bridge();window.__rs=b.resumeSession;b.resumeSession=async()=>({ok:false,error:'Simulated failure'})})()`);
    await js(`window.__durbarSimUi.notes.close()`);
    await openDrawer();
    check(await openSource('Another idea from a previous'), `${tag}: Open source when the resume will fail`);
    check(await until(`document.body.textContent.includes('Could not resume: Simulated failure')`, 8000), `${tag}: the toast says why`);
    check(await js(`!document.getElementById('notesDrawer').hidden`), `${tag}: a failed resume leaves the drawer open`);
    await js(`void (window.__durbarSimUi.bridge().resumeSession=window.__rs)`);

    /* ---- AC2: a note from a previous session opens it the Previous sessions way ---- */
    check(await save(openerId, 'user', 0, PREV_USER, 'prev-1'), `${tag}: a note from a previous session is saved`);
    await js(`window.__durbarSimUi.notes.close()`);
    await openDrawer();
    check(await openSource(PREV_USER.slice(0, 20)), `${tag}: Open source on the previous session`);
    check(await until(`!!document.querySelector('#chat .bubble.nt-found')`, 10000), `${tag}: the previous session opened and its message is outlined`);
    const f3 = await found();
    check(f3 && f3.text.includes('filingsSearch') && f3.inside && f3.page === 0, `${tag}: the previous session's message is revealed inside #chat (${JSON.stringify(f3)})`);
    check((await calls('resumeSession')) === 1 && (await calls('send')) === 0, `${tag}: it resumed once and sent nothing`);
    check(await js(`document.getElementById('notesDrawer').hidden`), `${tag}: the drawer closed`);

    /* ---- the saved session id is not the agent's id (simresumeid=1, as with a Codex thread id): the office session is still found ---- */
    await H.load({ w, h, query: { simresumeid: '1' }, ready: 'fit' });
    await js(`(()=>{const b=window.__durbarSimUi.bridge();window.__calls=[];for(const k of ['send','resumeSession']){const f=b[k];if(!f||f.__rec)continue;const x=function(...a){window.__calls.push(k);return f.apply(this,a)};x.__rec=1;b[k]=x;}})()`);
    const nid = await open('Noor');
    const nreply = await firstReply();
    check(nreply && nreply.text, `${tag}: Noor has a reply (resume id differs)`);
    check(await save(nid, 'agent', nreply.ord, nreply.text, 'resume-' + nid), `${tag}: a note saved under the resume id`);
    await open('Ada'); await openDrawer();
    check(await openSource(nreply.text.slice(0, 20)), `${tag}: Open source on the note with another resume id`);
    check(await until(`/Noor/.test((document.getElementById('panelTitle')||{}).textContent||'')&&!!document.querySelector('#chat .bubble.nt-found')`, 8000), `${tag}: the office chat opens and the message is outlined`);
    check((await calls('resumeSession')) === 0, `${tag}: the office session is not resumed from Previous sessions`);
  }
  await motion(false);
  console.log('[notes-source] screenshots in ' + OUT);
  assert.deepStrictEqual(fails, [], fails.join('\n'));
  console.log('[notes-source] all checks passed');
};
