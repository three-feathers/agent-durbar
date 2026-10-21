/* spec 052 FR-164 (owner, 2026-10-21): + Folder and + Workspace sit at the left end of the top bar, first in tab order, and the Mac
   File menu has Add Folder… (⌘O) and Add VS Code Workspace… (⇧⌘O) that press the same buttons. Simulator only, no credits.
     npm run build && DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 DURBAR_DRIVER=$PWD/scripts/shots-052-addleft.js xvfb-run -a npx electron . --no-sandbox
   Per size (1440x900, 1280x800), level (Expert, Simple) and built-in theme, with floors and several agent apps (the widest bar):
     - the add buttons are the first controls after the brand (leftmost, and first in tab order), labelled, text at least 10.5px;
     - the top bar is one row (about 48px) and no control leaves the window or overlaps another.
   Then, once: the File menu built from the real template (src/main/appmenu.ts, darwin) as the application menu: File > Add Folder…
   adds a room through the page's own button, File > Add VS Code Workspace… presses + Workspace, Ctrl+O (Windows and Linux, in the
   page) adds a room too, and on this platform (not a Mac) the app has no menu at all (FR-083).
   Saves docs/screenshots/052-add-left-<size>.png and 052-add-left-simple-<size>.png (Clean Office; SHOTS_OUT=<folder> elsewhere).
   A failure throws (DRIVER FAILED, exit 1); `npm run check:ui` runs it. */
const path = require('path');
const { Menu } = require('electron');
const { helpers, jsLiteral } = require('./driver-helpers');

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'dist', 'renderer', 'index.html');
const SIZES = [[1440, 900], [1280, 800]];
const THEMES = ['clean', 'corporate', 'retro', 'durbar-indian', 'durbar-european', 'durbar-japanese'];

/* runs in the page */
function topCheck(simple) {
  const P = [];
  const R = (e) => e.getBoundingClientRect();
  const vis = (e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
  const bar = document.querySelector('.topbar');
  const ctl = [...bar.querySelectorAll('button, select')].filter(vis);
  const f = document.getElementById('addFolder'), w = document.getElementById('addWs');
  if (!f || !vis(f)) P.push('+ Folder is not shown');
  if (simple ? w && vis(w) : !w || !vis(w)) P.push(simple ? '+ Workspace shows in Simple' : '+ Workspace is not shown');
  if (f && f.textContent.trim() !== '+ Folder') P.push('+ Folder label: ' + f.textContent.trim());
  if (!simple && w && w.textContent.trim() !== '+ Workspace') P.push('+ Workspace label: ' + w.textContent.trim());
  const adds = simple ? [f] : [f, w];
  const others = ctl.filter((c) => !adds.includes(c));
  const brand = R(document.querySelector('.brand'));
  if (f && R(f).left < brand.right) P.push('+ Folder is not after the brand');
  if (f && others.some((c) => R(c).left < R(f).left)) P.push('a control sits left of + Folder: ' + others.filter((c) => R(c).left < R(f).left).map((c) => c.id).join(','));
  if (!simple && w && f && (R(w).left < R(f).right || others.some((c) => R(c).left < R(w).left))) P.push('+ Workspace is not right after + Folder');
  /* tab order: the first tabbable controls of the bar are the add buttons */
  const tabbable = [...bar.querySelectorAll('button, select, input, a[href], [tabindex]')].filter((e) => vis(e) && e.tabIndex >= 0 && !e.disabled);
  const firstIds = tabbable.slice(0, adds.length).map((e) => e.id);
  if (firstIds.join(',') !== adds.map((e) => e && e.id).join(',')) P.push('tab order starts with ' + firstIds.join(','));
  adds.forEach((b) => { if (b && parseFloat(getComputedStyle(b).fontSize) < 10.5) P.push(b.id + ' text below 10.5px'); });
  const h = R(bar).height;
  if (h > 52.5) P.push(`top bar is ${Math.round(h)}px tall (wrapped)`);
  ctl.forEach((e) => { const b = R(e); if (b.right > innerWidth + 0.5 || b.left < -0.5) P.push('sticks out: ' + (e.id || e.textContent.trim().slice(0, 16))); });
  for (let i = 0; i < ctl.length; i++) for (let j = i + 1; j < ctl.length; j++) {
    if (ctl[i].contains(ctl[j]) || ctl[j].contains(ctl[i])) continue;
    const p = R(ctl[i]), q = R(ctl[j]);
    if (Math.min(p.right, q.right) - Math.max(p.left, q.left) > 0.5 && Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top) > 0.5) P.push(`overlap ${ctl[i].id} x ${ctl[j].id}`);
  }
  return P;
}

module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-097: shared plumbing
  let failed = 0, total = 0;
  const fail = (m) => { failed++; console.log('FAIL ' + m); };
  const load = async (q, w, h) => {
    await H.load({ w, h, query: { sim: undefined, simfreeze: undefined, ...q }, ready: 'fit', settle: false }); // this check says which of sim and simfreeze it wants
    await ctx.sleep(500);
  };
  for (const [w, h] of SIZES) {
    for (const level of ['expert', 'simple']) {
      await load({ sim: '15', simfreeze: '1' }, w, h);
      await ctx.js(`localStorage.setItem('durbar.detail',${jsLiteral(level)});true`);
      for (const theme of THEMES) {
        await load({ sim: '15', simfreeze: '1', simfloors: '1', simkinds: 'mixed', theme }, w, h);
        const p = await ctx.js(`(${topCheck.toString()})(${level === 'simple'})`);
        total++;
        if (p.length) fail(`${w}x${h} ${level} ${theme}: ${p.join('; ')}`);
      }
      await load({ sim: '15', simfreeze: '1' }, w, h);
      await ctx.js(`document.querySelectorAll('#toasts > *').forEach((t)=>t.remove());true`);
      await ctx.shot(path.join(process.env.SHOTS_OUT || path.join(ROOT, 'docs', 'screenshots'), `052-add-left${level === 'simple' ? '-simple' : ''}-${w}x${h}.png`));
    }
  }
  await ctx.js(`localStorage.setItem('durbar.detail','expert');true`);

  /* FR-083: no application menu on Windows and Linux */
  if (process.platform !== 'darwin') { total++; if (Menu.getApplicationMenu() !== null) fail('an application menu exists on ' + process.platform); }
  /* the Mac menu, built from the real template, as the application menu; its actions do what main.ts does (send menu:add) */
  const { appMenuTemplate } = require(path.join(ROOT, 'dist', 'main', 'appmenu.js'));
  const before = Menu.getApplicationMenu();
  Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate('darwin', { openSettings() {}, openRepo() {}, add: (k) => ctx.win.webContents.send('menu:add', k) })));
  try {
    await load({ sim: '15', simfreeze: '1' }, 1440, 900);
    const file = Menu.getApplicationMenu().items.find((m) => m.label === 'File');
    total++;
    if (!file) { fail('no File menu'); return; }
    const items = file.submenu.items.map((m) => (m.type === 'separator' ? '-' : m.role === 'close' ? 'close' : `${m.label} ${m.accelerator}`));
    if (items.join('|') !== 'Add Folder… CommandOrControl+O|Add VS Code Workspace… CommandOrControl+Shift+O|-|close') fail('File menu: ' + items.join(' | '));
    const rooms = () => ctx.js(`document.querySelectorAll('#stage .room-name, #stage .plate-tx b').length`);
    await ctx.js(`window.__wsClicks=0;document.getElementById('addWs').addEventListener('click',()=>{window.__wsClicks++});true`);
    const r0 = await rooms();
    file.submenu.items[0].click();
    await ctx.waitFor(`[...document.querySelectorAll('#stage .room-name, #stage .plate-tx b')].some((n)=>/^new-folder-/.test(n.textContent.trim()))`, 5000).catch(() => undefined);
    const r1 = await rooms();
    total++;
    if (r1 !== r0 + 1) fail(`File > Add Folder… did not add a room (${r0} -> ${r1})`);
    file.submenu.items[1].click();
    await ctx.sleep(400);
    total++;
    if ((await ctx.js('window.__wsClicks')) !== 1) fail('File > Add VS Code Workspace… did not press + Workspace');
    /* Ctrl+O in the page (Windows and Linux; on a Mac the File menu owns ⌘O) */
    if (process.platform !== 'darwin') {
      ctx.win.webContents.focus();
      await H.key('O', ['control'], { char: 'never', pause: 600 });
      total++;
      const r2 = await rooms();
      if (r2 !== r1 + 1) fail(`Ctrl+O did not add a room (${r1} -> ${r2})`);
      await H.key('O', ['control', 'shift'], { char: 'never', pause: 400 });
      total++;
      if ((await ctx.js('window.__wsClicks')) !== 2) fail('Ctrl+Shift+O did not press + Workspace');
    }
  } finally {
    Menu.setApplicationMenu(before);
  }
  console.log(`[shots-052-addleft] ${total - failed}/${total} checks passed`);
  if (failed) throw new Error(`${failed} check(s) failed`);
};
