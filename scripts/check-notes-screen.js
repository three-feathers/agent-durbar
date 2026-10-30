/*
 * Check for spec 083 T034a (issue 699): the per-folder Notes screen (FR-044, FR-045). Simulator only (no AI credits, nothing on disk).
 *
 *   npm run check:ui -- --only check-notes-screen
 *   OUT=docs/screenshots  (optional) where the screenshots go (default: a temp folder)
 *   NOTES_ONE_SIZE=1      one size only (a quick run, the planted-mutation runs)
 *
 * At 1440x900 and 1280x800 with 15 agents (simnotes=some: the folder of Noor has 3 notes, one done):
 *   AC1  the folder's ⋯ has "Notes (2)…" and opens the screen ("Notes · <folder>"); the drawer's "All notes of this folder…" opens it
 *        (the drawer closes) and Ctrl+K "Notes of <folder>" opens it; nothing of the notes is on the office floor;
 *   AC2  all notes, not done first, newest first, then "Done (1)" folded (its row not reachable); the search filters both groups and
 *        Esc clears it before it closes the screen; Mark done moves a note to Done and out of the header count and the "/" list;
 *        Mark not done brings it back; the focus goes to the next row; Close and Esc put the focus back where the screen was opened;
 *        Insert shows only over a chat of the folder, closes the screen and puts the text in the box without sending;
 *        + Note on the screen; a hostile title is text, never HTML;
 *   AC5  a screenshot of the screen at each size; the screen fits (no overflow, text at least 10.5px); a token in a note never shows.
 * A miss is collected; the run fails at the end unless "all checks passed" is printed.
 */
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const OUT = process.env.OUT || process.env.SHOTS_OUT || require('os').tmpdir();
const SIZES = process.env.NOTES_ONE_SIZE ? [[1440, 900]] : [[1440, 900], [1280, 800]];
const MAC = process.platform === 'darwin';
const MOD = MAC ? 'meta' : 'control';
/* the token piece the secret seed holds (sim.ts builds it at run time, so does this file: push protection) */
const BODY = 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4';
const leak = (t) => { const x = String(t || ''); for (let i = 0; i + 8 <= BODY.length; i++) if (x.includes(BODY.slice(i, i + 8))) return BODY.slice(i, i + 8); return ''; };

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js, key, wc } = H;
  const fails = [];
  wc().on('console-message', (...a) => { const m = a[0] && a[0].message !== undefined ? a[0] : { level: a[1], message: a[2] }; if (m.level === 'error' || m.level === 3) console.log('PAGE ERROR', String(m.message).slice(0, 300)); });
  const check = (cond, msg) => { if (!cond) { fails.push(msg); console.log('FAIL ' + msg); } };
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'calm', tag: 'notes-screen', keepActions: false });
  const load = async (w, h, q) => { await H.load({ w, h, query: { simkinds: 'mixed', ...(q || {}) }, ready: 'fit' }); };
  const typeChars = async (t) => { for (const ch of t) { wc().sendInputEvent({ type: 'char', keyCode: ch }); await ctx.sleep(25); } await ctx.sleep(60); };
  const active = () => js(`(()=>{const e=document.activeElement;return e?(e.id||e.dataset.id||e.dataset.foldermenu||e.className||e.tagName):''})()`);
  const open = async (name) => {
    const id = await H.idOf(name);
    assert.ok(id, `${name} is on the floor`);
    if (await js(`document.body.classList.contains('panel-open')`)) { await js(`document.getElementById('backBtn').click()`); await until(`!document.body.classList.contains('panel-open')`, 4000); }
    await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"]`)}).click()`);
    await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('msgInput')`, 15000);
    await settle();
    await until(`(()=>{const v=e=>!!e&&e.getClientRects().length>0;return v(document.getElementById('sendBtn'))})()`, 15000);
    return id;
  };
  /* the room of an agent, from the page's own data (the folder ⋯ button carries the room id) */
  const roomOf = async (name) => { const id = await H.idOf(name); return js(`(()=>{const d=document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"]`)});const r=d&&d.closest('section.room');const b=r&&r.querySelector('[data-foldermenu]');return b?b.dataset.foldermenu:''})()`); };
  /* the folder's name as the app shows it: the folder menu is named "Folder <name>" */
  const menuName = () => js(`(document.getElementById('modeMenu').getAttribute('aria-label')||'').replace(/^Folder /,'')`);
  const shown = () => js(`!!document.getElementById('nsHost')&&document.body.classList.contains('screen-open')`);
  const rows = () => js(`JSON.stringify([...document.querySelectorAll('#nsList .nt-row')].map(r=>({t:r.querySelector('.nt-title').textContent,vis:!r.closest('details:not([open])')&&r.getClientRects().length>0,done:!!r.closest('#nsDone'),ins:!!r.querySelector('[data-nt="insert"]')})))`).then(JSON.parse);
  const menuOf = async (title) => {
    await js(`(()=>{const r=[...document.querySelectorAll('#nsList .nt-row')].find(x=>x.querySelector('.nt-title').textContent===${jsLiteral(title)});r.querySelector('[data-nt="more"]').click();})()`);
    return until(`!!document.querySelector('#modeMenu [data-nmact]')`, 3000);
  };
  const closeScreen = async () => { if (await shown()) { await js(`document.getElementById('scrClose').click()`); await until(`!document.body.classList.contains('screen-open')`, 3000); } };
  /* the layout of the screen: inside the window, nothing scrolls sideways, no text under 10.5px, no two rows overlap */
  const layout = () => js(`(()=>{const P=[],R=e=>e.getBoundingClientRect(),s=document.getElementById('screen'),V=e=>e.getClientRects().length>0&&(!e.closest('details:not([open])')||!!e.closest('summary'));
    if(document.documentElement.scrollWidth>innerWidth+1||document.documentElement.scrollHeight>innerHeight+1)P.push('the page scrolls');
    const b=s.querySelector('.scr-body');if(b&&b.scrollWidth>b.clientWidth+1)P.push('the screen scrolls sideways');
    for(const e of s.querySelectorAll('*')){if(!V(e))continue;const t=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());if(t&&parseFloat(getComputedStyle(e).fontSize)<10.5)P.push('text under 10.5px: '+(e.className||e.tagName));
      const r=R(e);if(t&&(r.right>innerWidth+1||r.left<-1))P.push('outside the window: '+(e.className||e.tagName));}
    const rs=[...s.querySelectorAll('.nt-row')].filter(V).map(R);
    for(let i=1;i<rs.length;i++)if(rs[i].top<rs[i-1].bottom-0.5)P.push('rows overlap');
    for(const r of s.querySelectorAll('.nt-row'))if(V(r)){const a=r.querySelector('.nt-acts'),m=r.querySelector('.nt-main');if(a&&m&&R(m).right>R(a).left+0.5&&R(m).bottom>R(a).top+0.5&&R(a).bottom>R(m).top+0.5)P.push('a title runs under its buttons');}
    return [...new Set(P)];})()`);

  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    await load(w, h, { simnotes: 'some' });
    check((await js(`document.querySelectorAll('#stage .desk[data-id]').length`)) === 15, `${tag}: 15 desks`);
    check(!(await js(`!!document.querySelector('#stage .nt-mark,#stage .nt-count,#stage .ns-sec,#stage [data-fact="notes"]')`)), `${tag}: nothing of the notes on the office floor`);
    const rid = await roomOf('Noor');
    check(!!rid, `${tag}: Noor's folder has its ⋯`);

    /* ===== AC1: the folder's ⋯ ===== */
    await js(`document.querySelector(${jsLiteral(`[data-foldermenu="${rid}"]`)}).click()`);
    check(await until(`!!document.querySelector('#modeMenu [data-fact="notes"]')`, 4000), `${tag}: the folder ⋯ has a Notes item`);
    const fname = await menuName();
    check(!!fname, `${tag}: the folder has a name`);
    check(await until(`(document.querySelector('#modeMenu [data-fact="notes"] b')||{}).textContent==='Notes (2)…'`, 5000), `${tag}: it reads Notes (2)… (3 notes, one done): ${await js(`(document.querySelector('#modeMenu [data-fact="notes"] b')||{}).textContent`)}`);
    await js(`document.querySelector('#modeMenu [data-fact="notes"]').click()`);
    check(await until(`!!document.getElementById('nsHost')&&document.querySelectorAll('#nsList .nt-row').length===3`, 6000), `${tag}: the folder ⋯ opens the Notes screen with the 3 notes`);
    const head = await js(`(document.querySelector('#screen .scr-head h2')||{}).textContent`);
    check(head === 'Notes · ' + fname, `${tag}: the heading names the folder (${head} / ${fname})`);
    /* ===== AC2: all notes, Done folded ===== */
    let rs = await rows();
    check(rs.map((r) => r.t).join('|') === 'Plan for the migration|Ask about the staging quota|Done: rename the config keys', `${tag}: not done newest first, then the done note (${rs.map((r) => r.t).join('|')})`);
    check(rs[2] && rs[2].done && !rs[2].vis && rs[0].vis && rs[1].vis, `${tag}: the done note is in the folded Done group (${JSON.stringify(rs)})`);
    check((await js(`document.querySelector('#nsDone > summary').textContent`)) === 'Done (1)' && !(await js(`document.getElementById('nsDone').open`)), `${tag}: Done (1), folded`);
    check(rs.every((r) => !r.ins), `${tag}: no Insert when the screen is not over a chat of this folder`);
    const meta3 = await js(`(()=>{const r=[...document.querySelectorAll('#nsList .nt-row')].find(x=>x.querySelector('.nt-title').textContent==='Done: rename the config keys');return r?r.querySelector('.nt-meta').textContent:''})()`);
    check(/· The agent$/.test(meta3), `${tag}: a note from another session does not name this chat's agent (${meta3})`);
    check(await until(`document.activeElement&&document.activeElement.classList.contains('nt-row')&&document.activeElement.querySelector('.nt-title').textContent==='Plan for the migration'`, 3000), `${tag}: the focus is on the first row (${await active()})`);
    await key('End');
    check(await until(`document.activeElement.querySelector&&document.activeElement.querySelector('.nt-title')&&document.activeElement.querySelector('.nt-title').textContent==='Ask about the staging quota'`, 2000), `${tag}: End goes to the last row shown (not into the folded group)`);
    let lay = await layout();
    check(!lay.length, `${tag}: the screen layout: ${lay.join('; ')}`);
    await js(`document.querySelector('#nsDone > summary').click()`);
    check(await until(`document.getElementById('nsDone').open&&document.querySelector('#nsDone .nt-row').getClientRects().length>0`, 2000), `${tag}: Done opens`);
    lay = await layout();
    check(!lay.length, `${tag}: the screen layout with Done open: ${lay.join('; ')}`);
    await shot(`083-notes-screen-${tag}.png`);
    /* search over both groups; Esc clears it first */
    await js(`document.getElementById('nsSearch').focus()`);
    await typeChars('rename');
    check(await until(`[...document.querySelectorAll('#nsList .nt-row')].map(r=>r.querySelector('.nt-title').textContent).join('|')==='Done: rename the config keys'&&document.querySelector('#nsDone > summary').textContent==='Done (1)'`, 3000), `${tag}: the search finds the done note in Done`);
    await js(`(()=>{const f=document.getElementById('nsSearch');f.value='';f.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await typeChars('zzqx');
    check(await until(`document.querySelectorAll('#nsList .nt-row').length===0&&/No notes match "zzqx"/.test(document.getElementById('nsList').textContent)`, 3000), `${tag}: no match names the words`);
    await key('Escape');
    check(await until(`document.getElementById('nsSearch')&&document.getElementById('nsSearch').value===''&&document.querySelectorAll('#nsList .nt-row').length===3`, 2000) && (await shown()), `${tag}: Esc clears the search first, the screen stays`);
    await key('Escape');
    check(await until(`!document.body.classList.contains('screen-open')`, 3000), `${tag}: a second Esc closes the screen`);
    check(await until(`document.activeElement&&document.activeElement.dataset&&document.activeElement.dataset.foldermenu===${jsLiteral(rid)}`, 2000), `${tag}: the focus goes back to the folder ⋯ (${await active()})`);

    /* ===== AC2: Mark done / Mark not done ===== */
    await open('Noor');
    check(await until(`(document.getElementById('ntCount')||{}).textContent==='Notes 2'`, 6000), `${tag}: the header count is 2 before`);
    await js(`document.getElementById('msgInput').focus()`);
    await key('M', [MOD, 'shift'], { char: 'never' });
    check(await until(`!document.getElementById('notesDrawer').hidden&&!!document.getElementById('ntAll')`, 4000), `${tag}: the drawer has All notes of this folder…`);
    check((await js(`document.getElementById('ntAll').textContent`)) === 'All notes of this folder…', `${tag}: its text`);
    await js(`document.getElementById('ntAll').click()`);
    check(await until(`!!document.getElementById('nsHost')&&document.querySelectorAll('#nsList .nt-row').length===3`, 6000), `${tag}: the drawer's All notes… opens the screen`);
    check(await js(`document.getElementById('notesDrawer').hidden`), `${tag}: the drawer closed`);
    rs = await rows();
    check(rs.filter((r) => r.ins).length === 3, `${tag}: over a chat of this folder every row has Insert (${JSON.stringify(rs)})`);
    check(await menuOf('Ask about the staging quota'), `${tag}: the row ⋯ opens`);
    const items = await js(`JSON.stringify([...document.querySelectorAll('#modeMenu [data-nmact] b')].map(b=>b.textContent))`).then(JSON.parse);
    check(items.join('|') === 'Rename…|Copy|Mark done|Delete…', `${tag}: the row menu (${items.join('|')})`);
    await js(`document.querySelector('#modeMenu [data-nmact="done"]').click()`);
    check(await until(`document.querySelector('#nsDone > summary')&&document.querySelector('#nsDone > summary').textContent==='Done (2)'&&[...document.querySelectorAll('#nsList .ns-list .nt-row')].length===1`, 4000), `${tag}: Mark done moves it to Done (2)`);
    check(await until(`window.__durbarSimUi.notes.all().some(n=>n.title==='Ask about the staging quota'&&n.done===true)`, 2000), `${tag}: the store has it done`);
    check(await until(`document.activeElement&&document.activeElement.classList.contains('nt-row')&&document.activeElement.querySelector('.nt-title').textContent==='Plan for the migration'`, 2000), `${tag}: the focus goes to the previous row (it was the last): ${await active()}`);
    check(/Marked done/.test(await js(`document.getElementById('srAnnounce').textContent`)) || (await until(`/Marked done/.test(document.getElementById('srAnnounce').textContent)`, 1500)), `${tag}: announced`);
    /* the done note is out of the count and the "/" list */
    await closeScreen();
    check(await until(`(document.getElementById('ntCount')||{}).textContent==='Notes 1'`, 4000), `${tag}: the header count drops to 1`);
    await js(`(()=>{const m=document.getElementById('msgInput');m.focus();m.value='/';m.setSelectionRange(1,1);m.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    check(await until(`!!document.querySelector('#slashList .sl-note')`, 5000), `${tag}: "/" lists notes`);
    const sl = await js(`JSON.stringify([...document.querySelectorAll('#slashList .sl-note .sl-name')].map(n=>n.textContent))`).then(JSON.parse);
    check(sl.some((t) => /Plan for the migration/.test(t)) && !sl.some((t) => /staging quota|rename the config/.test(t)), `${tag}: the "/" list has no done note (${sl.join('|')})`);
    await key('Escape');
    await js(`(()=>{const m=document.getElementById('msgInput');m.value='';m.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    /* Mark not done from the Done group */
    await js(`document.getElementById('msgInput').focus()`);
    await key('M', [MOD, 'shift'], { char: 'never' });
    await until(`!document.getElementById('notesDrawer').hidden`, 4000);
    await js(`document.getElementById('ntAll').click()`);
    await until(`!!document.getElementById('nsHost')&&document.querySelectorAll('#nsList .nt-row').length===3`, 6000);
    check(!(await js(`document.getElementById('nsDone').open`)), `${tag}: Done is folded again at each open`);
    await js(`document.querySelector('#nsDone > summary').click()`);
    await until(`document.getElementById('nsDone').open`, 2000);
    check(await menuOf('Ask about the staging quota'), `${tag}: the done row's ⋯ opens`);
    check((await js(`[...document.querySelectorAll('#modeMenu [data-nmact] b')].map(b=>b.textContent).join('|')`)) === 'Rename…|Copy|Mark not done|Delete…', `${tag}: a done note offers Mark not done`);
    await js(`document.querySelector('#modeMenu [data-nmact="undone"]').click()`);
    check(await until(`document.querySelector('#nsDone > summary')&&document.querySelector('#nsDone > summary').textContent==='Done (1)'&&document.querySelectorAll('#nsList .ns-list .nt-row').length===2`, 4000), `${tag}: Mark not done brings it back`);
    /* Insert from the screen: it closes, the text is in the box, nothing is sent */
    const u0 = await js(`document.querySelectorAll('#panel .msg.user').length`);
    await js(`[...document.querySelectorAll('#nsList .nt-row')].find(r=>r.querySelector('.nt-title').textContent==='Ask about the staging quota').querySelector('[data-nt="insert"]').click()`);
    check(await until(`!document.body.classList.contains('screen-open')&&document.getElementById('msgInput').value.includes('Ask about the staging quota before Friday.')`, 4000), `${tag}: Insert closes the screen and fills the box`);
    check(await until(`document.activeElement&&document.activeElement.id==='msgInput'`, 2000), `${tag}: the box has the focus`);
    check((await js(`document.querySelectorAll('#panel .msg.user').length`)) === u0, `${tag}: Insert sent nothing`);
    await js(`(()=>{const m=document.getElementById('msgInput');m.value='';m.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    /* Close from the drawer's path: back to the message box */
    await key('M', [MOD, 'shift'], { char: 'never' });
    await until(`!document.getElementById('notesDrawer').hidden`, 4000);
    await js(`document.getElementById('ntAll').click()`);
    await until(`!!document.getElementById('nsHost')`, 6000);
    await js(`document.getElementById('scrClose').click()`);
    check(await until(`!document.body.classList.contains('screen-open')&&document.activeElement&&document.activeElement.id==='msgInput'`, 3000), `${tag}: Close puts the focus back in the message box (${await active()})`);

    /* ===== AC1: Ctrl+K "Notes of <folder>" ===== */
    await js(`document.getElementById('backBtn').click()`);
    await until(`!document.body.classList.contains('panel-open')`, 4000);
    await key('K', [MOD], { char: 'never' });
    check(await until(`!!document.getElementById('palDlg')`, 3000), `${tag}: Ctrl+K opens the palette`);
    await typeChars('notes of ' + (fname || '').slice(0, 6));
    check(await until(`[...document.querySelectorAll('#palDlg [role="option"]')].some(o=>o.textContent.includes(${jsLiteral('Notes of ' + fname)}))`, 3000), `${tag}: Ctrl+K lists Notes of ${fname}`);
    await js(`[...document.querySelectorAll('#palDlg [role="option"]')].find(o=>o.textContent.includes(${jsLiteral('Notes of ' + fname)})).click()`);
    check(await until(`!!document.getElementById('nsHost')&&document.querySelectorAll('#nsList .nt-row').length===3`, 6000), `${tag}: Ctrl+K Notes of <folder> opens the screen`);
    check((await rows()).every((r) => !r.ins), `${tag}: from the office (no chat open), no Insert`);
    await closeScreen();

    /* ===== a token in a note never shows on the screen ===== */
    await load(w, h, { simnotes: 'secret' });
    const rid2 = await roomOf('Noor');
    await js(`document.querySelector(${jsLiteral(`[data-foldermenu="${rid2}"]`)}).click()`);
    await until(`!!document.querySelector('#modeMenu [data-fact="notes"]')`, 4000);
    await js(`document.querySelector('#modeMenu [data-fact="notes"]').click()`);
    check(await until(`document.querySelectorAll('#nsList .nt-row').length===1`, 6000), `${tag}: the secret note is listed`);
    const all = await js(`(()=>{const s=document.getElementById('screen');return s.innerText+' '+[...s.querySelectorAll('*')].map(e=>[e.getAttribute('aria-label'),e.title].join(' ')).join(' ')})()`);
    check(!leak(all), `${tag}: no piece of the token on the screen (${leak(all)})`);
    /* + Note on the screen; a hostile title is text, never HTML (escaping has a test) */
    const hostile = '<img src=x onerror="window.__nsx=1"><b>bold</b> idea';
    await js(`document.getElementById('nsAdd').click()`);
    check(await until(`!!document.querySelector('#modeDlg textarea')`, 3000), `${tag}: + Note on the screen opens the dialog`);
    await js(`(()=>{const t=document.querySelector('#modeDlg textarea');t.value=${jsLiteral(hostile + '\n\nmore')};t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await js(`document.querySelector('#modeDlg .primary').click()`);
    check(await until(`document.querySelectorAll('#nsList .nt-row').length===2`, 5000), `${tag}: the new note is on the screen`);
    check(await js(`!document.querySelector('#nsList img,#nsList .nt-title b')&&!window.__nsx&&[...document.querySelectorAll('#nsList .nt-title')].some(t=>t.textContent.includes('<img'))`), `${tag}: a hostile title shows as text`);
    check(await until(`document.activeElement&&document.activeElement.classList.contains('nt-row')&&document.activeElement.querySelector('.nt-title').textContent.includes('<img')`, 3000), `${tag}: the focus is on the new row (${await active()})`);
    await closeScreen();
  }
  console.log('[notes-screen] screenshots in ' + OUT);
  assert.deepStrictEqual(fails, [], fails.join('\n'));
  console.log('[notes-screen] all checks passed');
};
