/*
 * Check for spec 083 T034b (issue 699): Export…, Delete all… and Remove folder's "Also delete its notes" (FR-048). Simulator only:
 * no AI credits, nothing on disk (the simulator answers "Demo: nothing written" and keeps notes in memory).
 *
 *   npm run check:ui -- --only check-notes-export
 *   OUT=docs/screenshots  (optional) where the screenshots go (default: a temp folder)
 *   NOTES_ONE_SIZE=1      one size only (a quick run, the planted-mutation runs)
 *
 * At 1440x900 and 1280x800 with 15 agents (simnotes=some: 3 notes, one done and folded):
 *   AC3  Export… sends only the chat's id (never a path) and says what the demo did;
 *   AC4  Delete all… asks with the count, Cancel focused, Esc sends nothing; confirming sends the call, the list empties, both buttons
 *        are disabled and the focus goes to the search field; with the switch on it says notes.md is written again;
 *   AC6  Remove folder's dialog has "Also delete its notes (3)", unticked, with the line that the notes stay; Cancel removes nothing;
 *        unticked, Remove sends no option; ticked, the window sends {deleteNotes:true}; a folder without notes has no box and sends no option; with the switch on it says
 *        .durbar/notes/notes.md stays in the project.
 * Every dialog's layout: inside the window, no text under 10.5px, the buttons inside the dialog. Screenshots of the Delete all… and
 * Remove folder dialogs at each size. A miss is collected; the run fails at the end unless "all checks passed" is printed.
 */
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const OUT = process.env.OUT || process.env.SHOTS_OUT || require('os').tmpdir();
const SIZES = process.env.NOTES_ONE_SIZE ? [[1440, 900]] : [[1440, 900], [1280, 800]];
const STAYS = 'Unticked, its notes stay and come back if you add the folder again.';
const MD_STAYS = '.durbar/notes/notes.md stays in the project either way; Durbar stops updating it.';
const MD_AGAIN = '.durbar/notes/notes.md is written again without them.';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, js, key, wc } = H;
  const fails = [];
  wc().on('console-message', (...a) => { const m = a[0] && a[0].message !== undefined ? a[0] : { level: a[1], message: a[2] }; if (m.level === 'error' || m.level === 3) console.log('PAGE ERROR', String(m.message).slice(0, 300)); });
  const check = (cond, msg) => { if (!cond) { fails.push(msg); console.log('FAIL ' + msg); } };
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'calm', tag: 'notes-export', keepActions: false });
  /* the simulator bridge's calls are recorded (with every argument), so an assert can say what the window sent, or that it sent nothing */
  const record = () => js(`(()=>{const b=window.__durbarSimUi.bridge();window.__nxCalls=[];for(const k of ['notesExport','notesDeleteAll','removeFolder']){const f=b[k];if(!f||f.__rec)continue;const w=function(...a){window.__nxCalls.push([k,a.length,...a.slice(1)]);return f.apply(this,a);};w.__rec=1;b[k]=w;}return !!(b.notesExport&&b.notesExport.__rec&&b.removeFolder&&b.removeFolder.__rec)})()`);
  const calls = () => js(`JSON.stringify(window.__nxCalls||[])`).then(JSON.parse);
  const load = async (w, h, q) => {
    await H.load({ w, h, query: { simkinds: 'mixed', ...q }, ready: 'fit' });
    check(await record(), `${w}x${h}: the bridge calls are recorded`);
  };
  const roomOf = async (name) => { const id = await H.idOf(name); return js(`(()=>{const d=document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"]`)});const r=d&&d.closest('section.room');const b=r&&r.querySelector('[data-foldermenu]');return b?b.dataset.foldermenu:''})()`); };
  const rooms = () => js(`[...document.querySelectorAll('#stage .room [data-foldermenu]')].map(b=>b.dataset.foldermenu)`);
  const folderMenu = async (rid, tag) => {
    await js(`document.querySelector(${jsLiteral(`[data-foldermenu="${rid}"]`)}).click()`);
    assert.ok(await until(`!!document.querySelector('#modeMenu [data-fact="rm"]')`, 5000), `${tag}: the folder ⋯ has Remove folder`);
  };
  const openScreen = async (tag, rows) => {
    const rid = await roomOf('Noor');
    assert.ok(rid, `${tag}: Noor's folder has its ⋯`);
    await js(`document.querySelector(${jsLiteral(`[data-foldermenu="${rid}"]`)}).click()`);
    assert.ok(await until(`!!document.querySelector('#modeMenu [data-fact="notes"]')`, 5000), `${tag}: the folder ⋯ has a Notes item`);
    await js(`document.querySelector('#modeMenu [data-fact="notes"]').click()`);
    assert.ok(await until(`!!document.getElementById('nsHost')&&document.querySelectorAll('#nsList .nt-row').length===${jsLiteral(rows)}&&!!document.getElementById('nsExport')`, 8000), `${tag}: the Notes screen with ${rows} rows and its tools`);
  };
  const closeScreen = async () => { if (await js(`document.body.classList.contains('screen-open')`)) { await js(`document.getElementById('scrClose').click()`); await until(`!document.body.classList.contains('screen-open')`, 3000); } };
  const tools = () => js(`(()=>{const x=document.getElementById('nsExport'),d=document.getElementById('nsDelAll');return {ex:x?{t:x.textContent,dis:x.disabled}:null,da:d?{t:d.textContent,dis:d.disabled}:null}})()`);
  const dlg = () => js(`(()=>{const d=document.querySelector('#modeDlg .dlg');if(!d)return null;const a=document.activeElement;return {title:d.querySelector('#mdT').textContent,body:d.querySelector('#mdB').textContent,lines:[...d.querySelectorAll('#mdL li')].map(l=>l.textContent),check:d.querySelector('#mdChk')&&d.querySelector('#mdChk').getClientRects().length?{on:d.querySelector('#mdChk').checked,label:(d.querySelector('.chk span')||{}).textContent||''}:null,buttons:[...d.querySelectorAll('.dbtn button')].map(b=>b.textContent),focus:a&&d.contains(a)?a.textContent:'(outside)'};})()`);
  const press = async (label) => { await js(`[...document.querySelectorAll('#modeDlg .dbtn button')].find(b=>b.textContent===${jsLiteral(label)}).click()`); return until(`!document.getElementById('modeDlg')`, 3000); };
  const toasts = () => js(`[...document.querySelectorAll('.toast')].map(t=>t.textContent).join(' | ')`);
  /* an open dialog and the screen: inside the window, no page scroll, no text under 10.5px, the dialog's buttons inside it */
  const layout = () => js(`(()=>{const P=[],R=e=>e.getBoundingClientRect();
    if(document.documentElement.scrollWidth>innerWidth+1||document.documentElement.scrollHeight>innerHeight+1)P.push('the page scrolls');
    const roots=[document.getElementById('screen'),document.getElementById('modeDlg')].filter(Boolean);
    for(const s of roots)for(const e of s.querySelectorAll('*')){if(!e.getClientRects().length||e.closest('details:not([open])'))continue;const t=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());if(!t)continue;
      if(parseFloat(getComputedStyle(e).fontSize)<10.5)P.push('text under 10.5px: '+(e.id||e.className||e.tagName));const r=R(e);if(r.right>innerWidth+1||r.left<-1||r.bottom>innerHeight+1)P.push('outside the window: '+(e.id||e.className||e.tagName));}
    const d=document.querySelector('#modeDlg .dlg');if(d){const dr=R(d);for(const b of d.querySelectorAll('.dbtn button')){const r=R(b);if(r.left<dr.left-0.5||r.right>dr.right+0.5||r.bottom>dr.bottom+0.5)P.push('a dialog button outside the dialog: '+b.textContent);}}
    const tl=document.querySelector('.ns-tools');if(tl){const tr=R(tl);for(const b of tl.querySelectorAll('button')){const r=R(b);if(r.right>tr.right+0.5)P.push('a tool button outside its row: '+b.textContent);}}
    return [...new Set(P)];})()`);

  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    // ---- Export… and Delete all… on the screen ----
    await load(w, h, { simnotes: 'some' });
    await openScreen(tag, 3);
    let t = await tools();
    check(t.ex && t.ex.t === 'Export…' && !t.ex.dis && t.da && t.da.t === 'Delete all…' && !t.da.dis, `${tag}: Export… and Delete all… are offered (${JSON.stringify(t)})`);
    let lay = await layout();
    check(!lay.length, `${tag}: the screen's layout with the new tools: ${lay.join('; ')}`);
    await js(`document.getElementById('nsExport').click()`);
    check(await until(`[...document.querySelectorAll('.toast')].some(t=>t.textContent==='Demo: nothing written')`, 4000), `${tag}: the demo says nothing was written (${await toasts()})`);
    let c = (await calls()).filter((x) => x[0] === 'notesExport');
    check(c.length === 1 && c[0][1] === 1, `${tag}: Export… sends only the chat's id, never a path (${JSON.stringify(c)})`);
    // Delete all…: asks with the count, Cancel focused; Esc sends nothing
    await js(`document.getElementById('nsDelAll').click()`);
    check(await until(`!!document.querySelector('#modeDlg .dlg')`, 4000), `${tag}: Delete all… opens a dialog`);
    let d = await dlg();
    check(d && d.title === 'Delete all notes?' && /^Delete all 3 notes of .+, done ones included\? This cannot be undone\.$/.test(d.body), `${tag}: the count, done ones included (${d && d.body})`);
    check(d && d.buttons.join('|') === 'Cancel|Delete all' && d.focus === 'Cancel', `${tag}: Cancel focused (${JSON.stringify(d)})`);
    check(d && d.lines.includes('Durbar remembers the last 300 deleted notes, so they don\'t come back from an older copy.') && !d.lines.includes(MD_AGAIN), `${tag}: the tombstone line, no notes.md line while the switch is off (${d && d.lines.join(' / ')})`);
    lay = await layout();
    check(!lay.length, `${tag}: the Delete all dialog's layout: ${lay.join('; ')}`);
    await shot(`083-notes-export-${tag}.png`);
    await key('Escape');
    check(await until(`!document.getElementById('modeDlg')`, 3000), `${tag}: Esc closes it`);
    c = (await calls()).filter((x) => x[0] === 'notesDeleteAll');
    check(c.length === 0 && (await js(`document.querySelectorAll('#nsList .nt-row').length`)) === 3, `${tag}: Esc sends nothing and keeps the notes (${JSON.stringify(c)})`);
    await js(`document.getElementById('nsDelAll').click()`);
    check(await until(`!!document.querySelector('#modeDlg .dlg')`, 4000), `${tag}: Delete all… again`);
    await press('Delete all');
    check(await until(`document.querySelectorAll('#nsList .nt-row').length===0&&document.getElementById('nsDelAll').disabled&&document.getElementById('nsExport').disabled`, 4000), `${tag}: the list empties and both buttons are disabled`);
    c = (await calls()).filter((x) => x[0] === 'notesDeleteAll');
    check(c.length === 1 && c[0][1] === 1, `${tag}: Delete all sends only the chat's id (${JSON.stringify(c)})`);
    check(await until(`document.activeElement&&document.activeElement.id==='nsSearch'`, 2000), `${tag}: the focus goes to the search field`);
    check(await until(`[...document.querySelectorAll('.toast')].some(t=>t.textContent==='3 notes deleted.')`, 3000), `${tag}: it says how many (${await toasts()})`);
    await closeScreen();

    // ---- with the project-file switch on: both dialogs say what happens to notes.md ----
    await load(w, h, { simnotes: 'some', simnotesfile: 'on' });
    await openScreen(tag, 3);
    await js(`document.getElementById('nsDelAll').click()`);
    check(await until(`!!document.querySelector('#modeDlg .dlg')`, 4000), `${tag} on: Delete all… opens a dialog`);
    d = await dlg();
    check(d && d.lines.includes(MD_AGAIN), `${tag} on: Delete all says notes.md is written again (${d && d.lines.join(' / ')})`);
    await press('Cancel');
    await closeScreen();
    let rid = await roomOf('Noor');
    await folderMenu(rid, `${tag} on`);
    await js(`document.querySelector('#modeMenu [data-fact="rm"]').click()`);
    check(await until(`!!document.querySelector('#modeDlg .dlg')`, 4000), `${tag} on: Remove folder opens a dialog`);
    d = await dlg();
    check(d && d.lines.includes(MD_STAYS) && d.check && d.check.on === false, `${tag} on: Remove says notes.md stays, the box unticked (${JSON.stringify(d)})`);
    await press('Cancel');

    // ---- Remove folder with notes: the box, unticked; Cancel removes nothing; ticked sends deleteNotes ----
    await load(w, h, { simnotes: 'some' });
    rid = await roomOf('Noor');
    const before = await rooms();
    await folderMenu(rid, tag);
    await js(`document.querySelector('#modeMenu [data-fact="rm"]').click()`);
    check(await until(`!!document.querySelector('#modeDlg .dlg')&&!!document.querySelector('#modeDlg #mdChk')`, 6000), `${tag}: Remove folder opens a dialog with the box (the notes are fetched first)`);
    d = await dlg();
    check(d && d.title === 'Remove folder?' && d.check && d.check.label === 'Also delete its notes (3)' && d.check.on === false, `${tag}: Also delete its notes (3), unticked (${JSON.stringify(d && d.check)})`);
    check(d && d.lines.includes(STAYS) && !d.lines.includes(MD_STAYS), `${tag}: the notes stay unless ticked (${d && d.lines.join(' / ')})`);
    check(d && d.buttons.join('|') === 'Cancel|Remove folder' && d.focus === 'Cancel', `${tag}: Cancel focused (${JSON.stringify(d)})`);
    lay = await layout();
    check(!lay.length, `${tag}: the Remove folder dialog's layout: ${lay.join('; ')}`);
    await shot(`083-notes-remove-${tag}.png`);
    await press('Cancel');
    c = (await calls()).filter((x) => x[0] === 'removeFolder');
    check(c.length === 0 && JSON.stringify(await rooms()) === JSON.stringify(before), `${tag}: Cancel removes nothing (${JSON.stringify(c)})`);
    // unticked: the folder goes, its notes stay (no deleteNotes sent)
    await folderMenu(rid, tag);
    await js(`document.querySelector('#modeMenu [data-fact="rm"]').click()`);
    check(await until(`!!document.querySelector('#modeDlg #mdChk')`, 6000), `${tag}: the dialog with the box (unticked case)`);
    check(!(await js(`document.getElementById('mdChk').checked`)), `${tag}: precondition: the box is unticked`);
    await press('Remove folder');
    check(await until(`![...document.querySelectorAll('#stage .room [data-foldermenu]')].some(b=>b.dataset.foldermenu===${jsLiteral(rid)})`, 5000), `${tag}: unticked: the folder is removed`);
    c = (await calls()).filter((x) => x[0] === 'removeFolder');
    check(c.length === 1 && c[0][2] == null, `${tag}: unticked sends no deleteNotes (${JSON.stringify(c)})`);
    check(await until(`[...document.querySelectorAll('.toast')].some(t=>/ removed\\.$/.test(t.textContent)&&!/notes deleted/.test(t.textContent))`, 3000), `${tag}: unticked says only removed (${await toasts()})`);
    // ticked: a fresh office, the same folder
    await load(w, h, { simnotes: 'some' });
    rid = await roomOf('Noor');
    await folderMenu(rid, tag);
    await js(`document.querySelector('#modeMenu [data-fact="rm"]').click()`);
    check(await until(`!!document.querySelector('#modeDlg #mdChk')`, 6000), `${tag}: the dialog again`);
    await js(`document.getElementById('mdChk').click()`);
    check(await js(`document.getElementById('mdChk').checked`), `${tag}: the box ticks`);
    await press('Remove folder');
    check(await until(`![...document.querySelectorAll('#stage .room [data-foldermenu]')].some(b=>b.dataset.foldermenu===${jsLiteral(rid)})`, 5000), `${tag}: the folder is removed`);
    c = (await calls()).filter((x) => x[0] === 'removeFolder');
    check(c.length === 1 && c[0][1] === 2 && JSON.stringify(c[0][2]) === '{"deleteNotes":true}', `${tag}: ticked sends deleteNotes (${JSON.stringify(c)})`);
    check(await until(`[...document.querySelectorAll('.toast')].some(t=>/removed and its notes deleted\\.$/.test(t.textContent))`, 3000), `${tag}: it says the notes were deleted (${await toasts()})`);

    // ---- a folder without notes: no box, no option sent ----
    await load(w, h, {});
    rid = await roomOf('Noor');
    await folderMenu(rid, `${tag} empty`);
    await js(`document.querySelector('#modeMenu [data-fact="rm"]').click()`);
    check(await until(`!!document.querySelector('#modeDlg .dlg')`, 6000), `${tag} empty: Remove folder opens a dialog`);
    d = await dlg();
    check(d && d.title === 'Remove folder?' && d.check === null && !d.lines.includes(STAYS), `${tag} empty: no box and no notes line (${JSON.stringify(d)})`);
    await press('Remove folder');
    check(await until(`![...document.querySelectorAll('#stage .room [data-foldermenu]')].some(b=>b.dataset.foldermenu===${jsLiteral(rid)})`, 5000), `${tag} empty: the folder is removed`);
    c = (await calls()).filter((x) => x[0] === 'removeFolder');
    check(c.length === 1 && c[0][2] == null, `${tag} empty: no option sent (${JSON.stringify(c)})`);
  }
  console.log('[notes-export] screenshots in ' + OUT);
  assert.deepStrictEqual(fails, [], fails.join('\n'));
  console.log('[notes-export] all checks passed');
};
