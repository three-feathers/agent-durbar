/*
 * Check for spec 083 T042 (issue 699): the project-file switch on the Notes screen and its states (FR-050, FR-055). Simulator only:
 * no AI credits, nothing on disk (the simulator answers "Demo: no file written" and never turns the switch on).
 *
 *   npm run check:ui -- --only check-notes-switch
 *   OUT=docs/screenshots  (optional) where the screenshots go (default: a temp folder)
 *   NOTES_ONE_SIZE=1      one size only (a quick run, the planted-mutation runs)
 *
 * At 1440x900 and 1280x800 with 15 agents (simnotes=some; simnotesfile= picks the state):
 *   AC1  the switch is offered off; turning it on shows the FR-050 warning with Cancel focused (Esc sends nothing);
 *   AC2  not offered for a .code-workspace; greyed with its reason when the folder is missing (a click opens nothing);
 *   AC3  the conflict and the write-error texts show on the screen and in the drawer;
 *   AC4  turning off asks Leave the file / Delete the file, Leave focused; the choice is what the window sends;
 *   AC5  the simulator answers "Demo: no file written" and the switch stays off;
 *   AC6  an existing file: "4 notes in the existing file will be added, marked "From the project file"."; an unreadable one says so,
 *        offers only Close and sends nothing;
 *   AC7  in a repository the box "Keep these notes in git" (off) and the already-committed line; outside one neither;
 *   AC8  the warning says text outside notes is removed when Durbar writes the file.
 * Every state's layout: inside the window, no text under 10.5px, the dialog's buttons inside it. A screenshot of the warning at each size.
 * A miss is collected; the run fails at the end unless "all checks passed" is printed.
 */
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const OUT = process.env.OUT || process.env.SHOTS_OUT || require('os').tmpdir();
const SIZES = process.env.NOTES_ONE_SIZE ? [[1440, 900]] : [[1440, 900], [1280, 800]];
const MAC = process.platform === 'darwin';
const MOD = MAC ? 'meta' : 'control';
const WARN = 'Durbar will write every note of this folder to .durbar/notes/notes.md in the project. Agents and anyone with the folder can read it, and it may get committed and pushed with your code. Secrets are masked, but private ideas are not. Git ignores it unless you choose to keep it in git below.';
const STRAY = 'Text outside notes in an existing notes.md is removed when Durbar writes the file.';
const OWN = "This is Durbar's own write: it also happens in Read-only mode.";
const COMMITTED = 'If .durbar/notes/notes.md was already committed, ignoring does not remove it from the repository.';
const GIT = 'Keep these notes in git (Durbar will not ignore them, so they can be committed and pushed)';
const TRACKED = 'This file is already in the project. If git tracks it, git keeps tracking it: the notes written to it will be committed, whatever is ignored.';
const CONFLICT = '.durbar/notes/notes.md has merge conflicts or could not be read. Fix it in your editor; Durbar will not overwrite it until then.';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js, key, wc } = H;
  const fails = [];
  wc().on('console-message', (...a) => { const m = a[0] && a[0].message !== undefined ? a[0] : { level: a[1], message: a[2] }; if (m.level === 'error' || m.level === 3) console.log('PAGE ERROR', String(m.message).slice(0, 300)); });
  const check = (cond, msg) => { if (!cond) { fails.push(msg); console.log('FAIL ' + msg); } };
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'calm', tag: 'notes-switch', keepActions: false });
  /* the simulator bridge's two switch calls are recorded, so an assert can say what the window sent (or that it sent nothing) */
  const record = () => js(`(()=>{const b=window.__durbarSimUi.bridge();window.__nsCalls=[];for(const k of ['notesSetFile','notesFileCount']){const f=b[k];if(!f||f.__rec)continue;const w=function(...a){window.__nsCalls.push([k,...a.slice(1)]);return f.apply(this,a);};w.__rec=1;b[k]=w;}return !!(b.notesSetFile&&b.notesSetFile.__rec)})()`);
  const calls = () => js(`JSON.stringify(window.__nsCalls||[])`).then(JSON.parse);
  const load = async (w, h, file) => {
    await H.load({ w, h, query: { simkinds: 'mixed', simnotes: 'some', ...(file ? { simnotesfile: file } : {}) }, ready: 'fit' });
    check(await record(), `${w}x${h} ${file || 'off'}: the bridge calls are recorded`);
  };
  const roomOf = async (name) => { const id = await H.idOf(name); return js(`(()=>{const d=document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"]`)});const r=d&&d.closest('section.room');const b=r&&r.querySelector('[data-foldermenu]');return b?b.dataset.foldermenu:''})()`); };
  const openScreen = async (tag) => {
    const rid = await roomOf('Noor');
    assert.ok(rid, `${tag}: Noor's folder has its ⋯`);
    await js(`document.querySelector(${jsLiteral(`[data-foldermenu="${rid}"]`)}).click()`);
    assert.ok(await until(`!!document.querySelector('#modeMenu [data-fact="notes"]')`, 5000), `${tag}: the folder ⋯ has a Notes item`);
    await js(`document.querySelector('#modeMenu [data-fact="notes"]').click()`);
    assert.ok(await until(`!!document.getElementById('nsHost')&&document.querySelectorAll('#nsList .nt-row').length===3&&!!document.getElementById('nsFile')&&document.getElementById('nsFile').children.length>0`, 8000), `${tag}: the Notes screen with its switch row`);
  };
  const closeScreen = async () => { if (await js(`document.body.classList.contains('screen-open')`)) { await js(`document.getElementById('scrClose').click()`); await until(`!document.body.classList.contains('screen-open')`, 3000); } };
  const sw = () => js(`(()=>{const b=document.getElementById('nsFileSw');return b?{role:b.getAttribute('role'),checked:b.getAttribute('aria-checked'),disabled:b.disabled,label:b.getAttribute('aria-label'),row:(document.querySelector('.ns-file-row')||{}).innerText||'',why:(document.getElementById('nsFileWhy')||{}).textContent||'',msg:(document.getElementById('nsFileMsg')||{}).textContent||''}:null})()`);
  const dlg = () => js(`(()=>{const d=document.querySelector('#modeDlg .dlg');if(!d)return null;const a=document.activeElement;return {title:d.querySelector('#mdT').textContent,body:d.querySelector('#mdB').textContent,lines:[...d.querySelectorAll('#mdL li')].map(l=>l.textContent),check:d.querySelector('#mdChk')?{on:d.querySelector('#mdChk').checked,label:(d.querySelector('.chk span')||{}).textContent||''}:null,buttons:[...d.querySelectorAll('.dbtn button')].map(b=>b.textContent),focus:a&&d.contains(a)?a.textContent:'(outside)'};})()`);
  const press = async (label) => { await js(`[...document.querySelectorAll('#modeDlg .dbtn button')].find(b=>b.textContent===${jsLiteral(label)}).click()`); return until(`!document.getElementById('modeDlg')`, 3000); };
  const openDialog = async (tag) => {
    await js(`document.getElementById('nsFileSw').click()`);
    return until(`!!document.querySelector('#modeDlg .dlg')`, 4000);
  };
  /* the screen and an open dialog: inside the window, no page scroll, no text under 10.5px, the dialog's buttons inside it */
  const layout = () => js(`(()=>{const P=[],R=e=>e.getBoundingClientRect();
    if(document.documentElement.scrollWidth>innerWidth+1||document.documentElement.scrollHeight>innerHeight+1)P.push('the page scrolls');
    const roots=[document.getElementById('screen'),document.getElementById('modeDlg')].filter(Boolean);
    for(const s of roots)for(const e of s.querySelectorAll('*')){if(!e.getClientRects().length||e.closest('details:not([open])'))continue;const t=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());if(!t)continue;
      if(parseFloat(getComputedStyle(e).fontSize)<10.5)P.push('text under 10.5px: '+(e.id||e.className||e.tagName));const r=R(e);if(r.right>innerWidth+1||r.left<-1||r.bottom>innerHeight+1)P.push('outside the window: '+(e.id||e.className||e.tagName));}
    const d=document.querySelector('#modeDlg .dlg');if(d){const dr=R(d);for(const b of d.querySelectorAll('.dbtn button')){const r=R(b);if(r.left<dr.left-0.5||r.right>dr.right+0.5||r.bottom>dr.bottom+0.5)P.push('a dialog button outside the dialog: '+b.textContent);}}
    const row=document.querySelector('.ns-file-row'),b=document.getElementById('nsFileSw');if(row&&b){const rr=R(row),br=R(b);if(br.right>rr.right+0.5||br.left<rr.left-0.5)P.push('the switch is outside its row');const l=row.querySelector('.ns-file-l');if(l&&R(l).right>br.left+0.5)P.push('the label runs under the switch');}
    return [...new Set(P)];})()`);
  const drawerText = async (tag) => {
    await closeScreen();
    const id = await H.idOf('Noor');
    if (await js(`document.body.classList.contains('panel-open')`)) { await js(`document.getElementById('backBtn').click()`); await until(`!document.body.classList.contains('panel-open')`, 4000); }
    await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"]`)}).click()`);
    assert.ok(await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('msgInput')`, 15000), `${tag}: Noor's chat opens`);
    await settle();
    await js(`document.getElementById('msgInput').focus()`);
    await key('M', [MOD, 'shift'], { char: 'never' });
    assert.ok(await until(`!document.getElementById('notesDrawer').hidden&&document.querySelectorAll('#notesDrawer .nt-row').length>0`, 5000), `${tag}: the drawer opens with its notes`);
    const t = await js(`(()=>{const e=document.querySelector('#notesDrawer .nt-file-err');return e?{text:e.textContent,role:e.getAttribute('role'),vis:e.getClientRects().length>0}:null})()`);
    await key('Escape');
    await until(`document.getElementById('notesDrawer').hidden`, 3000);
    return t;
  };

  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;

    /* ===== AC1, AC5, AC7, AC8: off by default; the warning; Cancel focused; the demo answer ===== */
    await load(w, h);
    check((await js(`document.querySelectorAll('#stage .desk[data-id]').length`)) === 15, `${tag}: 15 desks`);
    check(!(await js(`!!document.querySelector('#stage #nsFileSw,#stage .ns-file')`)), `${tag}: nothing of the switch on the office floor`);
    await openScreen(tag);
    let s = await sw();
    check(s && s.role === 'switch' && s.checked === 'false' && !s.disabled, `${tag}: a switch, off by default (${JSON.stringify(s)})`);
    check(s && s.label === 'Also keep these notes as .durbar/notes/notes.md in the project' && /Off: nothing is written in the project\./.test(s.row), `${tag}: the switch's name and its off line (${s && s.row})`);
    let lay = await layout();
    check(!lay.length, `${tag}: the screen with the switch: ${lay.join('; ')}`);
    check(await openDialog(tag), `${tag}: turning it on asks first`);
    let d = await dlg();
    check(d && d.title === 'Keep these notes in the project?' && d.body === WARN, `${tag}: the FR-050 warning (${d && d.body})`);
    check(d && d.focus === 'Cancel', `${tag}: Cancel has the focus (${d && d.focus})`);
    check(d && d.lines.includes(STRAY), `${tag}: AC8, the stray-text line (${d && d.lines.join(' | ')})`);
    check(d && d.lines.includes(OWN), `${tag}: the dialog says it also happens in Read-only`);
    check(d && !d.lines.some((l) => /of your text in the existing file will be removed/.test(l)), `${tag}: no file: no lost-text line`);
    check(d && d.lines.includes(COMMITTED) && d.check && d.check.on === false && d.check.label === GIT, `${tag}: in a repository the box is there, off, with the already-committed line (${JSON.stringify(d && d.check)})`);
    check(d && !d.lines.some((l) => /will be added/.test(l)), `${tag}: no file in the folder: no count line`);
    check(d && d.buttons.join('|') === 'Cancel|Turn on', `${tag}: Cancel and Turn on (${d && d.buttons.join('|')})`);
    lay = await layout();
    check(!lay.length, `${tag}: the warning's layout: ${lay.join('; ')}`);
    await shot(`083-notes-switch-${tag}.png`);
    await key('Escape');
    check(await until(`!document.getElementById('modeDlg')&&document.activeElement&&document.activeElement.id==='nsFileSw'`, 3000), `${tag}: Esc closes the warning, the focus back on the switch`);
    check(JSON.stringify((await calls()).filter((c) => c[0] === 'notesSetFile')) === '[]', `${tag}: Esc sends nothing`);
    check((await sw()).checked === 'false', `${tag}: still off after Esc`);
    await openDialog(tag);
    await js(`document.getElementById('mdChk').click()`); // the box ticked: the window sends the choice for git
    check(await press('Turn on'), `${tag}: Turn on closes the warning`);
    check(await until(`(document.getElementById('nsFileMsg')||{}).textContent==='Demo: no file written'`, 4000), `${tag}: AC5, the simulator answers Demo: no file written (${(await sw()).msg})`);
    s = await sw();
    check(s.checked === 'false', `${tag}: the demo switch stays off`);
    check(await until(`document.activeElement&&document.activeElement.id==='nsFileSw'`, 2000), `${tag}: the focus is back on the switch after the answer`);
    const sent = (await calls()).filter((c) => c[0] === 'notesSetFile');
    check(sent.length === 1 && sent[0][1] === true && JSON.stringify(sent[0][2]) === '{"git":true}', `${tag}: the window sends on and the box, no path (${JSON.stringify(sent)})`);
    check(!JSON.stringify(sent).includes('/'), `${tag}: nothing path-like is sent`);
    await closeScreen();

    /* ===== AC6: an existing file; an unreadable one ===== */
    await load(w, h, 'existing');
    await openScreen(tag);
    await openDialog(tag);
    d = await dlg();
    check(d && d.lines[0] === '4 notes in the existing file will be added, marked "From the project file".', `${tag}: the count of an existing file (${d && d.lines[0]})`);
    check(d && d.lines.includes(TRACKED) && !d.lines.includes(COMMITTED), `${tag}: an existing file in a repository: git keeps tracking it, said plainly`);
    await press('Cancel');
    await closeScreen();
    await load(w, h, 'stray');
    await openScreen(tag);
    await openDialog(tag);
    d = await dlg();
    check(d && d.lines[0] === '3 lines of your text in the existing file will be removed.' && d.focus === 'Cancel', `${tag}: text outside notes is counted, Cancel focused (${d && d.lines[0]})`);
    await press('Cancel');
    await closeScreen();
    /* the box for git is off by default and only a ticked box sends the choice */
    await load(w, h, 'existing');
    await openScreen(tag);
    await openDialog(tag);
    await press('Turn on');
    check(await until(`(document.getElementById('nsFileMsg')||{}).textContent==='Demo: no file written'`, 4000), `${tag}: turning on with the box off`);
    check(JSON.stringify((await calls()).filter((c) => c[0] === 'notesSetFile').map((c) => c[2])) === '[null]', `${tag}: the box is off by default, so no choice is sent`);
    await closeScreen();
    await load(w, h, 'unreadable');
    await openScreen(tag);
    await openDialog(tag);
    d = await dlg();
    check(d && /existing file cannot be read; Durbar will not change it/.test(d.body) && d.buttons.join('|') === 'Close' && !d.check, `${tag}: an unreadable file says so and offers only Close (${JSON.stringify(d)})`);
    await press('Close');
    check(await until(`/The switch stays off/.test((document.getElementById('nsFileMsg')||{}).textContent)`, 3000), `${tag}: the screen says the switch stays off`);
    check((await calls()).filter((c) => c[0] === 'notesSetFile').length === 0 && (await sw()).checked === 'false', `${tag}: an unreadable file: nothing sent, still off`);
    await closeScreen();

    /* ===== AC7: outside a repository, no box and no committed line; the stray-text line stays ===== */
    await load(w, h, 'norepo');
    await openScreen(tag);
    await openDialog(tag);
    d = await dlg();
    check(d && !d.check && !d.lines.includes(COMMITTED) && d.lines.includes(STRAY) && d.focus === 'Cancel', `${tag}: outside a repository: no box, no committed line, Cancel focused (${JSON.stringify(d)})`);
    await press('Turn on');
    await until(`(document.getElementById('nsFileMsg')||{}).textContent==='Demo: no file written'`, 4000);
    const sent2 = (await calls()).filter((c) => c[0] === 'notesSetFile');
    check(sent2.length === 1 && sent2[0][2] === null, `${tag}: outside a repository no git option is sent (${JSON.stringify(sent2)})`);
    await closeScreen();

    /* ===== AC2: greyed when the folder is missing; not offered for a .code-workspace ===== */
    await load(w, h, 'missing');
    await openScreen(tag);
    s = await sw();
    check(s && s.disabled && s.why === 'The folder is not there, so Durbar cannot keep .durbar/notes/notes.md in it.', `${tag}: greyed with its reason (${JSON.stringify(s)})`);
    check(await js(`document.getElementById('nsFileSw').getAttribute('aria-describedby')==='nsFileWhy'`), `${tag}: the reason names the switch`);
    await js(`document.getElementById('nsFileSw').click()`);
    await settle();
    check(!!(await sw()) && !(await js(`!!document.getElementById('modeDlg')`)) && (await calls()).length === 0, `${tag}: a greyed switch opens nothing and sends nothing`);
    lay = await layout();
    check(!lay.length, `${tag}: the greyed switch's layout: ${lay.join('; ')}`);
    await closeScreen();
    await load(w, h, 'workspace');
    await openScreen(tag);
    check(await until(`!document.getElementById('nsFileSw')&&/not offered for a VS Code workspace/.test(document.getElementById('nsFile').textContent)`, 3000), `${tag}: no switch for a .code-workspace, and it says why`);
    await closeScreen();

    /* ===== AC3: the conflict and the write error, on the screen and in the drawer; AC4: turning off ===== */
    for (const [mode, re] of [['conflict', CONFLICT], ['writefail', 'Could not write .durbar/notes/notes.md: EACCES'], ['replaced', 'This folder looks replaced, or its drive was remounted. Turn the switch off and on again to write .durbar/notes/notes.md here.']]) {
      await load(w, h, mode);
      await openScreen(tag);
      const t = await js(`(()=>{const e=document.querySelector('#nsList .nt-file-err');return e?{text:e.textContent,role:e.getAttribute('role'),vis:e.getClientRects().length>0}:null})()`);
      check(t && t.text === re && t.role === 'alert' && t.vis, `${tag}: ${mode} shows its words on the screen (${JSON.stringify(t)})`);
      check((await sw()).checked === 'true', `${tag}: ${mode}: the switch shows on`);
      lay = await layout();
      check(!lay.length, `${tag}: the ${mode} screen's layout: ${lay.join('; ')}`);
      const dt = await drawerText(tag);
      check(dt && dt.text === re && dt.role === 'alert' && dt.vis, `${tag}: ${mode} shows its words in the drawer (${JSON.stringify(dt)})`);
    }
    await load(w, h, 'on');
    await openScreen(tag);
    check(await until(`/2 lines of text outside notes in notes\\.md were removed/.test((document.querySelector('#nsList .nt-file-info')||{}).textContent||'')`, 3000), `${tag}: the info line shows quietly`);
    s = await sw();
    check(s.checked === 'true' && /On: Durbar keeps the file in step/.test(s.row), `${tag}: on (${s.row})`);
    await openDialog(tag);
    d = await dlg();
    check(d && d.title === 'Stop keeping .durbar/notes/notes.md?' && d.buttons.join('|') === 'Cancel|Delete the file|Leave the file' && d.focus === 'Leave the file', `${tag}: turning off asks Leave or Delete, Leave focused (${JSON.stringify(d)})`);
    check(d && /deletes it only when it holds exactly what Durbar would write/.test(d.body) && d.lines.includes('If the file is tracked in git, deleting it shows as a deletion.'), `${tag}: the delete rule and the git line are said (${d && d.body})`);
    lay = await layout();
    check(!lay.length, `${tag}: the turn-off dialog's layout: ${lay.join('; ')}`);
    await press('Delete the file');
    check(await until(`(document.getElementById('nsFileMsg')||{}).textContent==='Demo: no file written'`, 4000), `${tag}: the demo answers the turn-off too`);
    const off = (await calls()).filter((c) => c[0] === 'notesSetFile');
    check(off.length === 1 && off[0][1] === false && JSON.stringify(off[0][2]) === '{"deleteFile":true}', `${tag}: the window sends off and the choice (${JSON.stringify(off)})`);
    await openDialog(tag);
    await press('Leave the file');
    const off2 = (await calls()).filter((c) => c[0] === 'notesSetFile');
    check(off2.length === 2 && JSON.stringify(off2[1][2]) === '{"deleteFile":false}', `${tag}: Leave sends deleteFile false (${JSON.stringify(off2)})`);
    await closeScreen();
  }
  console.log('[notes-switch] screenshots in ' + OUT);
  assert.deepStrictEqual(fails, [], fails.join('\n'));
  console.log('[notes-switch] all checks passed');
};
