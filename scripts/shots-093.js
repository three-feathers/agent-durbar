/* Spec 093 phase 1 (T022): create a folder from + Folder, in the simulator (its bridge fakes folders:* in the window; main keeps the
   channels closed under DURBAR_SIM). No process, nothing on disk, no credits.
     npm run build && DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 DURBAR_DRIVER=$PWD/scripts/shots-093.js xvfb-run -a npx electron . --no-sandbox
   At 1440x900 and 1280x800, every wait on a condition (until):
     - + Folder opens the choice: Add existing folder… (primary, focused), New repository…, Empty folder…, Cancel; text at least 10.5px;
       Escape closes it and focus goes back to + Folder; the welcome screen's add button opens the same choice;
     - Q1 = a: Ctrl+O (not on a Mac, where the File menu owns ⌘O), File > Add Folder… and the palette's Add folder add directly (no
       choice); File > New Folder… opens the choice of kind; the palette's New repository and New empty folder open their name step;
     - a refused name: the reason under the field, the typed text kept, nothing added; Escape at the name step adds nothing;
     - a cancelled picker shows no name step;
     - Empty folder and New repository rooms in the top bar's mode: Read-only, and Allow all after its confirmation (Escape at the
       confirmation starts nothing); the request carries only kind, token and name (no path);
     - main refused no channel (the window used the simulator's fakes).
   Saves 093-choice-<size>.png, 093-name-refused-<size>.png and 093-new-room-<size>.png in docs/screenshots (SHOTS_OUT=<folder> elsewhere).
   A failure throws (DRIVER FAILED, exit 1); `npm run check:ui` runs it. */
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.SHOTS_OUT || path.join(ROOT, 'docs', 'screenshots');
const SIZES = [[1440, 900], [1280, 800]];
const MAC = process.platform === 'darwin';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, js, key } = H;
  let total = 0, failed = 0;
  const check = (ok, msg) => { total++; if (!ok) { failed++; console.log('FAIL ' + msg); } };
  const title = `((document.querySelector('#modeDlg #mdT')||{}).textContent||'')`;
  const open = (t) => until(`${title}===${jsLiteral(t)}&&!!document.querySelector('#modeDlg [aria-modal="true"]')`, 8000);
  const closed = () => until(`!document.getElementById('modeDlg')`, 8000);
  const buttons = () => js(`[...document.querySelectorAll('#modeDlg .dbtn button')].map(b=>b.textContent)`);
  const press = (label) => js(`(()=>{const b=[...document.querySelectorAll('#modeDlg .dbtn button')].find(x=>x.textContent===${jsLiteral(label)});if(!b)return false;b.click();return true})()`);
  const typeName = async (text) => { await js(`(()=>{const i=document.getElementById('mdIn');i.focus();i.value='';return true})()`); ctx.win.webContents.insertText(text); await until(`(document.getElementById('mdIn')||{}).value===${jsLiteral(text)}`, 4000); };
  const room = (cwd) => `((window.__durbarSimUi.agents().find(a=>a.info&&a.info.cwd===${jsLiteral(cwd)})||{}).info||null)`;
  const count = () => js(`window.__durbarSimUi.agents().length`);
  const esc = async () => { ctx.win.webContents.focus(); await key('Escape', [], { char: 'never' }); };
  /* every button of the dialog inside it (a row too wide for the dialog pushed the first button out on the left) */
  const fits = () => js(`(()=>{const d=document.querySelector('#modeDlg .dlg');if(!d)return ['no dialog'];const r=d.getBoundingClientRect();return [...d.querySelectorAll('.dbtn button')].filter(b=>{const q=b.getBoundingClientRect();return q.left<r.left-0.5||q.right>r.right+0.5||b.scrollWidth>b.clientWidth+1}).map(b=>b.textContent)})()`);
  const smallText = () => js(`[...document.querySelectorAll('#modeDlg .dlg *')].filter(e=>e.childNodes.length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&e.getClientRects().length).filter(e=>parseFloat(getComputedStyle(e).fontSize)<10.5).map(e=>e.tagName+':'+e.textContent.slice(0,20))`);

  for (const [w, h] of SIZES) {
    const at = `${w}x${h}`;
    await H.load({ w, h });
    await H.calm();
    await js(`(()=>{window.__sawDlg=0;new MutationObserver(()=>{if(document.getElementById('modeDlg'))window.__sawDlg++;}).observe(document.body,{childList:true});return true})()`);

    // ---- FR-001: + Folder opens the choice ----
    await js(`document.getElementById('addFolder').focus();document.getElementById('addFolder').click()`);
    check(await open('Add a folder'), `${at}: + Folder opens "Add a folder"`);
    check(JSON.stringify(await buttons()) === JSON.stringify(['Add existing folder…', 'New repository…', 'Empty folder…', 'Cancel']), `${at}: the choice's buttons: ${JSON.stringify(await buttons())}`);
    check(await until(`(document.activeElement||{}).textContent==='Add existing folder…'`, 3000), `${at}: Add existing folder… has the focus (Enter keeps today's behaviour)`);
    check(/New repository: an empty folder with git, on this computer only\.[\s\S]*Empty folder: no git\./.test(await H.text('#modeDlg #mdL')), `${at}: one line per create option`);
    const out = await fits();
    check(out.length === 0, `${at}: every button fits in the dialog: ${JSON.stringify(out)}`);
    const small = await smallText();
    check(small.length === 0, `${at}: dialog text at least 10.5px: ${JSON.stringify(small)}`);
    await H.shot(path.join(OUT, `093-choice-${at}.png`), { tag: 'shots-093' });
    await esc();
    check(await closed(), `${at}: Escape closes the choice`);
    check(await until(`(document.activeElement||{}).id==='addFolder'`, 3000), `${at}: focus goes back to + Folder`);
    // the welcome screen's add button presses the same + Folder (its handler is a document listener on [data-wl="add"])
    await js(`(()=>{const b=document.createElement('button');b.dataset.wl='add';b.id='wlProbe';document.body.appendChild(b);b.click();return true})()`);
    check(await open('Add a folder'), `${at}: the welcome screen's add button opens the same choice`);
    await esc();
    await closed();
    await js(`document.getElementById('wlProbe').remove()`);

    // ---- Q1 = a: Ctrl+O, File > Add Folder… and the palette's Add folder add directly; no choice ----
    await js(`window.__sawDlg=0;window.__simAddFolderProbe={n:0};true`);
    if (!MAC) {
      ctx.win.webContents.focus();
      await key('O', ['control'], { char: 'never', pause: 200 });
      check(await until(`window.__simAddFolderProbe.n===1`, 4000), `${at}: Ctrl+O adds a folder directly`);
    }
    ctx.win.webContents.send('menu:add', 'folder');
    check(await until(`window.__simAddFolderProbe.n===${MAC ? 1 : 2}`, 4000), `${at}: File > Add Folder… adds a folder directly`);
    ctx.win.webContents.focus();
    await key('K', [MAC ? 'meta' : 'control'], { char: 'never' });
    await until(`!!document.getElementById('palDlg')`, 4000);
    ctx.win.webContents.insertText('Add folder');
    check(await until(`/^Add folder/.test(((document.querySelector('#palDlg [role="option"][aria-selected="true"]')||document.querySelector('#palDlg [role="option"]')||{}).textContent||''))`, 4000), `${at}: the palette offers Add folder first`);
    await key('Return', [], { char: 'never', pause: 200 });
    check(await until(`window.__simAddFolderProbe.n===${MAC ? 2 : 3}`, 4000), `${at}: the palette's Add folder adds a folder directly`);
    check((await js('window.__sawDlg')) === 0, `${at}: none of them showed the choice`);
    await js(`delete window.__simAddFolderProbe;true`);
    // FR-001a: File > New Folder… opens the choice of kind; the palette's entries open their name step
    ctx.win.webContents.send('menu:add', 'new');
    check(await open('New folder'), `${at}: File > New Folder… opens "New folder"`);
    check(JSON.stringify(await buttons()) === JSON.stringify(['New repository…', 'Empty folder…', 'Cancel']), `${at}: only the kinds: ${JSON.stringify(await buttons())}`);
    check((await fits()).length === 0, `${at}: New folder: every button fits: ${JSON.stringify(await fits())}`);
    await esc();
    await closed();
    for (const [entry, step] of [['New repository', 'New repository'], ['New empty folder', 'Empty folder']]) {
      ctx.win.webContents.focus();
      await key('K', [MAC ? 'meta' : 'control'], { char: 'never' });
      await until(`!!document.getElementById('palDlg')`, 4000);
      ctx.win.webContents.insertText(entry);
      await until(`[...document.querySelectorAll('#palDlg [role="option"]')].some(o=>o.textContent.startsWith(${jsLiteral(entry)}))`, 4000);
      await js(`(()=>{const o=[...document.querySelectorAll('#palDlg [role="option"]')].find(o=>o.textContent.startsWith(${jsLiteral(entry)}));o.click();return true})()`);
      check(await open(step), `${at}: the palette's ${entry} opens the ${step} name step`);
      await esc();
      check(await closed(), `${at}: Escape at the name step`);
    }

    // ---- a refused name keeps the typed text; Escape adds nothing ----
    const n0 = await count();
    await js(`document.getElementById('addFolder').click()`);
    await open('Add a folder');
    await press('New repository…');
    check(await open('New repository'), `${at}: New repository… goes to its name step (after the simulated picker)`);
    check(/In ~\/work\. It starts in Read-only\./.test(await H.text('#modeDlg #mdB')), `${at}: the name step shows the place and the mode: ${await H.text('#modeDlg #mdB')}`);
    check(JSON.stringify(await buttons()) === JSON.stringify(['Cancel', 'Change place…', 'Create']), `${at}: Cancel, Change place…, Create`);
    check((await fits()).length === 0, `${at}: name step: every button fits: ${JSON.stringify(await fits())}`);
    await typeName('CON');
    await press('Create');
    check(await until(`(()=>{const e=document.getElementById('mdErr');return !!e&&!e.hidden&&/reserved on Windows/.test(e.textContent)&&document.getElementById('mdIn').value==='CON'&&document.getElementById('mdIn').getAttribute('aria-invalid')==='true'})()`, 6000), `${at}: the reason under the field, the text kept`);
    await H.shot(path.join(OUT, `093-name-refused-${at}.png`), { tag: 'shots-093' });
    await esc();
    check(await closed(), `${at}: Escape closes the name step`);
    check((await count()) === n0, `${at}: nothing was added`);
    // a cancelled picker: no name step
    await js(`window.__simNewFolderPickCancel=true;window.__sawDlg=0;true`);
    await js(`document.getElementById('addFolder').click()`);
    await open('Add a folder');
    await press('Empty folder…');
    await closed();
    await ctx.sleep(300); // nothing may follow: give a wrong flow its chance
    check((await js(`!document.getElementById('modeDlg')&&window.__sawDlg===1`)), `${at}: a cancelled picker shows no name step`);
    await js(`delete window.__simNewFolderPickCancel;true`);

    // ---- Empty folder in Read-only (the top bar's default) ----
    await js(`document.getElementById('addFolder').click()`);
    await open('Add a folder');
    await press('Empty folder…');
    check(await open('Empty folder'), `${at}: Empty folder… goes to its name step`);
    await typeName('notes');
    await key('Return', [], { pause: 100 });
    check(await until(`(${room('~/work/notes')}||{}).permMode==='read-only'`, 6000), `${at}: the new room "notes" is in the office, Read-only`);
    const last = await js(`window.__simNewFolderLast`);
    check(last && JSON.stringify(Object.keys(last.req).sort()) === JSON.stringify(['kind', 'name', 'token']) && last.req.kind === 'empty' && last.mode === 'read-only', `${at}: only kind, token and name are sent (no path), with the mode: ${JSON.stringify(last)}`);
    check(await until(`[...document.querySelectorAll('#toasts .toast')].some(t=>t.textContent.includes('New folder notes created.'))||/New folder notes created\./.test((document.getElementById('srAnnounce')||{}).textContent||'')`, 4000), `${at}: the result is said`);
    await H.shot(path.join(OUT, `093-new-room-${at}.png`), { tag: 'shots-093', prep: 'calm' });

    // ---- Allow all: the confirmation first (Escape there starts nothing), then the room in Allow all ----
    await js(`(()=>{const s=document.getElementById('permMode');s.value='allow';s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    await js(`window.__simNewFolderLast=null;true`);
    await js(`document.getElementById('addFolder').click()`);
    await open('Add a folder');
    await press('Empty folder…');
    check(await open('Allow all for the folder you create next?'), `${at}: Allow all asks first`);
    await esc();
    check(await closed(), `${at}: Escape at the confirmation`);
    await ctx.sleep(300);
    check((await js(`!document.getElementById('modeDlg')&&window.__simNewFolderLast===null`)), `${at}: nothing started after Escape at the confirmation`);
    await js(`document.getElementById('addFolder').click()`);
    await open('Add a folder');
    await press('New repository…');
    await open('Allow all for the folder you create next?');
    await press('Allow all');
    check(await open('New repository'), `${at}: after Allow all, the name step`);
    check(/It starts in Allow all\./.test(await H.text('#modeDlg #mdB')), `${at}: the name step says Allow all`);
    await typeName('allowed-repo');
    await press('Create');
    check(await until(`(${room('~/work/allowed-repo')}||{}).permMode==='allow'`, 6000), `${at}: the new repository's room is in Allow all`);
    check((await js(`(window.__simNewFolderLast||{}).mode`)) === 'allow' && (await js(`(window.__simNewFolderLast||{req:{}}).req.kind`)) === 'init', `${at}: sent as init in Allow all`);
    await js(`(()=>{const s=document.getElementById('permMode');s.value='read-only';s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  }

  const refused = ctx.simRefused ? ctx.simRefused() : [];
  check(Array.isArray(refused) && refused.length === 0, `main refused no channel (the window used the simulator's fakes): ${JSON.stringify(refused)}`);
  console.log(`[shots-093] ${total - failed}/${total} checks passed`);
  if (failed) throw new Error(`${failed} check(s) failed`);
};
