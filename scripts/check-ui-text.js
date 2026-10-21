/*
 * Spec 052 FR-171 (issue #464): the help and UI text check. Opens every dialog, popover, menu, screen and chat surface of
 * FR-165..FR-170 in the simulator at 1440x900 and 1280x800, in Clean Office and in a dark fixture theme
 * (scripts/fixtures/themes/dark-audit.json), and asserts, with the measuring code in scripts/ui-text-page.js:
 *   font-size (>= 10.5px), word-split (no word of 4+ letters cut across lines in prose), clipped (text cut by overflow),
 *   x-scroll (nothing in a dialog, popover or menu wider than its box), offscreen, dialog-width (the S/M/L tokens),
 *   dialog-padding (--dlg-pad), field-weight (values in dialog fields are 400/500), measure (--measure), and, in the dark
 *   theme only, dark-contrast (4.5:1 for the controls of FR-169).
 * TODO (PR 2, tasks T150-T155; the hooks exist, nothing is asserted yet): orphan menu hints, tooltip length (120/300),
 *   ellipsis without a title, long names (simnames=long), Tools/Settings sideways scroll, chat overlap (caret, Copy, toast).
 *
 *   npm run check:ui-text
 *
 * Simulator only: no real agent, no AI credits. Linux with xvfb-run (the npm script). All violations are listed, then the driver
 * fails (DRIVER FAILED, Electron itself exits 0), so the npm script exits non-zero unless "all checks passed" is printed.
 * UITEXT_ONLY=a,b limits the surfaces; UITEXT_THEMES=light,dark; UITEXT_SIZES=1440x900,1280x800 (for a quick run).
 */
const fs = require('fs');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');

const PAGE = fs.readFileSync(path.join(__dirname, 'ui-text-page.js'), 'utf8');
const DARK = fs.readFileSync(path.join(__dirname, 'fixtures', 'themes', 'dark-audit.json'), 'utf8');
const ONLY = process.env.UITEXT_ONLY ? new Set(process.env.UITEXT_ONLY.split(',')) : null;
const THEMES = (process.env.UITEXT_THEMES || 'light,dark').split(',');
const SIZES = (process.env.UITEXT_SIZES || '1440x900,1280x800').split(',').map((s) => s.split('x').map(Number));
const OUT = process.env.OUT || process.env.UITEXT_OUT || '';
const SHOTS = process.env.UITEXT_SHOTS === '1';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until, settle } = H;
  const key = (k, mods = [], char = 'always') => H.key(k, mods, { char });
  const q = (theme, extra) => ({ simkinds: 'mixed', simfloors: '1', simgrants: 'many', simquestion: '1', simtotals: '1', ...(extra || {}), ...(theme === 'dark' ? { theme: 'audit-dark', usertheme: DARK } : { theme: themeId || 'clean-office' }) });
  let theme = 'light', W = 1440, Hh = 900, extraQuery = {}, themeId = '';
  const found = []; // every violation: { surface, theme, size, rule, el, detail }
  const todo = new Map(); // the PR 2 rules: counted, not asserted
  const opened = new Set();
  const ALLOWFILE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ui-text-light-allow.json'), 'utf8'));
  const ALLOW_TEXT = new Set(ALLOWFILE.text || []); // elements whose text is under 4.5:1 in the dark fixture and are older debt
  const allowedText = new Set();

  const load = async () => {
    await H.load({ w: W, h: Hh, query: q(theme, extraQuery), ready: 'fit', settle: false });
    await H.office(15);
    await js(PAGE);
    ctx.win.show(); ctx.win.focus(); H.wc().focus();
    if (theme === 'dark') await until(`window.THEME&&THEME.current().id==='audit-dark'`, 6000);
  };
  const reset = async () => {
    for (let i = 0; i < 3; i++) {
      const open = await js(`!!document.querySelector('.dlg-ov,#modeMenu,#agentMenu,#modelMenu,#moreMenu:not([hidden]),#topMoreMenu:not([hidden]),#defaultsPop:not([hidden]),#foldersPop:not([hidden]),#floorsPop:not([hidden])')`);
      if (!open) break;
      await js(`document.activeElement&&document.activeElement.blur&&document.activeElement.blur()`);
      await key('Escape'); await ctx.sleep(150);
    }
    await js(`(()=>{document.querySelectorAll('.dlg-ov').forEach(d=>d.remove());['modeMenu','agentMenu','modelMenu'].forEach(i=>{const e=document.getElementById(i);if(e)e.remove();});['topMoreMenu','defaultsPop','foldersPop','floorsPop'].forEach(i=>{const e=document.getElementById(i);if(e)e.hidden=true;});const c=document.getElementById('scrClose');if(c)c.click();})()`);
    await ctx.sleep(100);
  };
  const closeChat = async () => { await reset(); if (await js(`document.body.classList.contains('panel-open')`)) { await H.click('#backBtn'); await until(`!document.body.classList.contains('panel-open')`, 3000); } };
  const openChat = async (name) => {
    await closeChat();
    const id = await H.idOf(name); if (!id) return false;
    await js(`document.querySelector(${jsLiteral(`#stage [data-id="${id}"]`)}).click()`);
    await H.chatOf(name); return true;
  };
  const openChatWhere = async (expr) => { // the first desk whose chat satisfies expr
    await closeChat();
    const ids = await js(`[...document.querySelectorAll('#stage .desk[data-id]')].map(d=>d.dataset.id)`);
    for (const id of ids) {
      await js(`document.querySelector(${jsLiteral(`#stage [data-id="${id}"]`)}).click()`);
      await until(`document.body.classList.contains('panel-open')`, 3000); await settle(1500);
      if (await js(`(()=>{try{return !!(${expr})}catch(e){return false}})()`)) return id;
    }
    return null;
  };
  const clickSel = async (sel, wait) => { const ok = await H.click(sel); if (wait) await until(wait, 4000); return ok; };
  const openSettingsAt = async (h3) => {
    await closeChat();
    await clickSel('#settingsBtn', `!!document.getElementById('themeH')`); await settle(2000);
    await js(`document.querySelectorAll('#screen details.scr-more').forEach(d=>d.open=true)`); await ctx.sleep(150);
    if (h3) await js(`(()=>{const h=document.getElementById(${jsLiteral(h3)});if(!h)return;const sc=h.closest('.scr-body');if(sc)sc.scrollTop+=h.getBoundingClientRect().top-sc.getBoundingClientRect().top-12;})()`);
    return true;
  };

  const S = [];
  const add = (name, kind, roots, open) => S.push({ name, kind, roots, open });
  const scrollChatTo = (sel) => js(`(()=>{const c=document.getElementById('chat'),e=document.querySelector(${jsLiteral(sel)});if(!c||!e)return false;c.scrollTop+=e.getBoundingClientRect().top-c.getBoundingClientRect().top-80;return true})()`);
  add('office-toasts', 'screen', ['#toasts', 'header.topbar', '#restoreStrip', '#awayStrip'], async () => { await closeChat(); return true; });
  add('kbd-help', 'dialog', ['#kbdDlg .dlg'], async () => { await closeChat(); await js(`document.activeElement&&document.activeElement.blur()`); await key('?', ['shift']); if (!(await until(`!!document.getElementById('kbdDlg')`, 2000))) { await H.click('#topMoreBtn'); await H.click('#kbdHelpBtn'); } return until(`!!document.getElementById('kbdDlg')`, 3000); });
  add('defaults-pop', 'popover', ['#defaultsPop'], async () => { await closeChat(); await H.click('#defaultsBtn'); return until(`!document.getElementById('defaultsPop').hidden`, 3000); });
  add('about-agent-apps', 'dialog', ['#modeDlg .dlg'], async () => { await closeChat(); await H.click('#defaultsBtn'); await until(`!document.getElementById('defaultsPop').hidden`, 3000); if (!(await js(`!document.getElementById('kindHelp').hidden`))) return false; await H.click('#kindHelp'); return until(`!!document.querySelector('#modeDlg .dlg')`, 3000); });
  add('top-more-menu', 'menu', ['#topMoreMenu'], async () => { await closeChat(); await H.click('#topMoreBtn'); return until(`!document.getElementById('topMoreMenu').hidden`, 3000); });
  add('folders-pop', 'popover', ['#foldersPop'], async () => { await closeChat(); await H.click('#foldersBtn'); return until(`!document.getElementById('foldersPop').hidden`, 3000); });
  add('floors-pop', 'popover', ['#floorsPop'], async () => { await closeChat(); if (await js(`document.getElementById('floorsBtn').hidden`)) return false; await H.click('#floorsBtn'); return until(`!document.getElementById('floorsPop').hidden`, 3000); });
  add('palette', 'dialog', ['#palDlg .dlg', '#palDlg'], async () => { await closeChat(); await js(`document.activeElement&&document.activeElement.blur()`); await key('K', [process.platform === 'darwin' ? 'meta' : 'control'], 'never'); return until(`!!document.getElementById('palDlg')`, 3000); });
  add('inbox', 'dialog', ['#inboxDlg .dlg', '#inboxDlg'], async () => { await closeChat(); await js(`document.activeElement&&document.activeElement.blur()`); await key('I'); return until(`!!document.getElementById('inboxDlg')`, 3000); });
  add('folder-menu', 'menu', ['#modeMenu'], async () => { await closeChat(); await js(`(()=>{const h=document.querySelector('#stage .room-head');const r=h.getBoundingClientRect();h.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+40,clientY:r.top+10}));})()`); return until(`!!document.getElementById('modeMenu')`, 2000); });
  add('card-mode-menu', 'menu', ['#modeMenu'], async () => { await closeChat(); await js(`(()=>{const d=[...document.querySelectorAll('#stage .desk[data-id]')][1];const r=d.getBoundingClientRect();d.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+30,clientY:r.top+30}));})()`); return until(`!!document.getElementById('modeMenu')`, 2000); });
  add('end-all', 'dialog', ['#modeDlg .dlg'], async () => { await closeChat(); await H.click('#topMoreBtn'); if (await js(`document.getElementById('endAllBtn').hidden`)) return false; await H.click('#endAllBtn'); return until(`!!document.querySelector('#modeDlg .dlg')`, 3000); });
  add('send-several', 'dialog', ['#modeDlg .dlg'], async () => { await closeChat(); await H.click('#topMoreBtn'); if (await js(`document.getElementById('sendSeveralBtn').hidden`)) return false; await H.click('#sendSeveralBtn'); return until(`!!document.querySelector('#modeDlg .dlg')`, 3000); });
  add('list-view', 'screen', ['#list'], async () => { await closeChat(); await H.click('#vList'); return until(`document.getElementById('list').getClientRects().length>0&&document.querySelectorAll('#list .lrow').length>0`, 3000); });
  add('settings-harnesses', 'screen', ['#screen'], async () => { await closeChat(); await js(`window.DurbarScreens&&window.DurbarScreens.openSettings('harnesses')`); return until(`!document.getElementById('screen').hidden`, 3000); });
  add('settings-mcp', 'screen', ['#screen'], async () => { await openSettingsAt(null); await js(`(()=>{const d=document.getElementById('advMcp');if(d&&d.tagName==='DETAILS')d.open=true;else{const b=document.querySelector('.scr-adv-h button,[aria-controls="advMcp"],#advMcpBtn');if(b)b.click();}})()`); await ctx.sleep(400); await js(`(()=>{const h=document.getElementById('mcpH')||document.querySelector('.scr-adv-h');if(!h)return;const sc=h.closest('.scr-body');if(sc)sc.scrollTop+=h.getBoundingClientRect().top-sc.getBoundingClientRect().top-12;})()`); return true; });
  add('place-dialog', 'dialog', ['#scrDlg .dlg'], async () => { await openSettingsAt('plH'); const ok = await js(`(()=>{const b=[...document.querySelectorAll('#screen button')].find(x=>/^\\+?\\s*(Add|New) (a )?place/i.test(x.textContent.trim()));if(!b)return false;b.click();return true})()`); return ok && until(`!!document.querySelector('#scrDlg .dlg')`, 3000); });
  add('theme-maker', 'dialog', ['#scrDlg .dlg'], async () => { await openSettingsAt('themeH'); await H.click('#thAi'); return until(`!!document.querySelector('#scrDlg .dlg')`, 3000); });
  add('tools-screen', 'screen', ['#screen'], async () => { await closeChat(); await H.click('#toolsBtn'); return until(`!document.getElementById('screen').hidden`, 3000); });
  add('tools-agents-tab', 'screen', ['#screen'], async () => { await closeChat(); await js(`window.DurbarScreens.openTools(null,'agents')`); return until(`!document.getElementById('screen').hidden`, 3000); });
  add('tools-activity-tab', 'screen', ['#screen'], async () => { await closeChat(); await H.click('#toolsBtn'); await until(`!document.getElementById('screen').hidden`, 3000); return js(`(()=>{const b=[...document.querySelectorAll('#screen [role=tab],#screen .ttab-btn,#screen button')].find(x=>/^Activity/.test(x.textContent.trim()));if(!b)return false;b.click();return true})()`); });
  add('tools-cost-tab', 'screen', ['#screen'], async () => { await closeChat(); await H.click('#toolsBtn'); await until(`!document.getElementById('screen').hidden`, 3000); return js(`(()=>{const b=[...document.querySelectorAll('#screen [role=tab],#screen button')].find(x=>/^(Cost|Spend|Usage)/.test(x.textContent.trim()));if(!b)return false;b.click();return true})()`); });
  add('chat-waiting', 'chat', ['#panel'], () => openChat('Jonas'));
  add('chat-question', 'chat', ['#panel'], async () => !!(await openChatWhere(`document.querySelector('#chat .note.question')`)) && js(`(document.querySelector('#chat .note.question').scrollIntoView({block:'center'}),true)`));
  add('chat-more-menu', 'menu', ['#moreMenu'], async () => { if (!(await openChat('Ada'))) return false; await H.click('#moreBtn'); return until(`!document.getElementById('moreMenu').hidden`, 2000); });
  add('chat-mode-menu', 'menu', ['#modeMenu'], async () => { if (!(await openChat('Ada'))) return false; await H.click('#modeChip'); return until(`!!document.getElementById('modeMenu')`, 2000); });
  add('allow-all-confirm', 'dialog', ['#modeDlg .dlg'], async () => { if (!(await openChat('Ada'))) return false; await H.click('#modeChip'); await until(`!!document.getElementById('modeMenu')`, 2000); await H.click('#modeMenu [data-mode="allow"]'); return until(`!!document.querySelector('#modeDlg .dlg')`, 2000); });
  add('chat-model-menu', 'menu', ['#modelMenu'], async () => { if (!(await openChat('Ada'))) return false; await H.click('#modelChip'); return until(`!!document.getElementById('modelMenu')`, 2000); });
  add('chat-agent-menu', 'menu', ['#agentMenu'], async () => { if (!(await openChatWhere(`document.getElementById('agentChip')`))) return false; await H.click('#agentChip'); return until(`!!document.getElementById('agentMenu')`, 2000); });
  add('cap-dialog', 'dialog', ['#capDlg .dlg', '#capDlg'], async () => { if (!(await openChatWhere(`document.getElementById('capChip')`))) return false; await H.click('#capChip'); return until(`!!document.getElementById('capDlg')`, 2000); });
  add('agent-mcp', 'dialog', ['#scrDlg .dlg', '.dlg-ov .dlg'], async () => { if (!(await openChat('Ada'))) return false; await H.click('#moreBtn'); await H.click('#mcpBtn'); return until(`!!document.querySelector('.dlg-ov .dlg')`, 3000); });
  add('schedules', 'dialog', ['#schedDlg .dlg', '#schedDlg'], async () => { if (!(await openChat('Ada'))) return false; await H.click('#moreBtn'); await H.click('#schedHdrBtn'); return until(`!!document.getElementById('schedDlg')`, 3000); });
  add('new-session', 'dialog', ['#sessDlg .dlg', '#sessDlg'], async () => { if (!(await openChat('Ada'))) return false; await H.click('#newSessHdrBtn'); return until(`!!document.getElementById('sessDlg')`, 3000); });
  add('handover', 'dialog', ['#sessDlg .dlg', '#sessDlg'], async () => { if (!(await openChat('Ada'))) return false; await H.click('#moreBtn'); if (!(await H.exists('#handoverBtn'))) return false; await H.click('#handoverBtn'); return until(`!!document.getElementById('sessDlg')`, 3000); });
  add('remote-control', 'dialog', ['#modeDlg .dlg', '.dlg-ov .dlg'], async () => { if (!(await openChatWhere(`document.getElementById('remoteBtn')`))) return false; await H.click('#moreBtn'); await H.click('#remoteBtn'); return until(`!!document.querySelector('.dlg-ov .dlg')`, 3000); });
  add('rename-session', 'dialog', ['#modeDlg .dlg'], async () => { if (!(await openChat('Ada'))) return false; await H.click('#moreBtn'); if (!(await H.exists('#renameSessBtn'))) return false; await H.click('#renameSessBtn'); return until(`!!document.querySelector('#modeDlg .dlg')`, 3000); });
  add('folder-status', 'dialog', ['#modeDlg .dlg', '.dlg-ov .dlg'], async () => { if (!(await openChatWhere(`document.querySelector('#panelHead .folder[role=button]')`))) return false; await js(`document.querySelector('#panelHead .folder[role=button]').click()`); return until(`!!document.querySelector('.dlg-ov .dlg')`, 3000); });
  add('compact', 'dialog', ['#modeDlg .dlg'], async () => { if (!(await openChatWhere(`document.querySelector('#compactBtn:not([aria-disabled])')`))) return false; await H.click('#compactBtn'); return until(`!!document.querySelector('#modeDlg .dlg')`, 3000); });
  add('grants', 'chat', ['#grants', '#grantsPop'], async () => { if (!(await openChatWhere(`document.querySelector('#grants .grant,#grants button')`))) return false; return true; });
  add('grants-pop', 'popover', ['#grantsPop'], async () => { if (!(await openChatWhere(`document.querySelector('#grants button')`))) return false; await js(`(()=>{const b=[...document.querySelectorAll('#grants button')].find(x=>x.getAttribute('aria-haspopup')||/more|\\+\\d/i.test(x.textContent))||document.querySelector('#grants button');b.click();})()`); return until(`!!document.getElementById('grantsPop')`, 2000); });
  add('prev-sessions', 'chat', ['#prev'], async () => { if (!(await openChat('Ada'))) return false; await js(`(()=>{const t=document.querySelector('.prev-toggle[aria-expanded="false"]')||document.getElementById('prevBtn');if(t&&t.getAttribute('aria-expanded')!=='true')t.click();})()`); return until(`document.querySelectorAll('#prev .prev-row').length>0`, 3000); });
  add('prev-row-menu', 'menu', ['#modeMenu'], async () => { if (!(await openChat('Ada'))) return false; await js(`(()=>{const t=document.querySelector('.prev-toggle[aria-expanded="false"]')||document.getElementById('prevBtn');if(t&&t.getAttribute('aria-expanded')!=='true')t.click();})()`); await until(`!!document.querySelector('#prev .prev-more')`, 3000); await H.click('#prev .prev-more'); return until(`!!document.getElementById('modeMenu')`, 2000); });
  add('harness-cards', 'screen', ['#screen'], async () => { await closeChat(); await js(`window.DurbarScreens.openSettings('harnesses')`); await until(`document.querySelectorAll('.hs-card').length>=3&&[...document.querySelectorAll('.hs-card .hs-st')].every(s=>s.textContent&&!/Checking/i.test(s.textContent))`, 5000); return true; });
  add('revoke-all', 'dialog', ['#modeDlg .dlg', '.dlg-ov .dlg'], async () => { if (!(await openChatWhere(`document.querySelector('#grants button')`))) return false; await js(`(()=>{const b=[...document.querySelectorAll('#grants button')].find(x=>x.getAttribute('aria-haspopup'))||document.querySelector('#grants button');b.click();})()`); await until(`!!document.getElementById('grantsPop')`, 2000); const ok = await js(`(()=>{const b=[...document.querySelectorAll('#grantsPop button')].find(x=>/Revoke all/.test(x.textContent));if(!b)return false;b.click();return true})()`); return ok && until(`!!document.querySelector('.dlg-ov .dlg')`, 2000); });
  add('folder-screen', 'screen', ['#screen'], async () => { if (!(await openChat('Ada'))) return false; await H.click('#moreBtn'); await H.click('#mcpBtn'); await until(`!!document.querySelector('.dlg-ov .dlg')`, 3000); const ok = await js(`(()=>{const b=[...document.querySelectorAll('.dlg-ov .dlg button')].find(x=>/Folder extras/.test(x.textContent));if(!b)return false;b.click();return true})()`); return ok && until(`!document.getElementById('screen').hidden`, 3000); });
  add('theme-maker-result', 'dialog', ['.dlg-ov .dlg'], async () => { await openSettingsAt('themeH'); await H.click('#thAi'); await until(`!!document.getElementById('aiDesc')`, 3000); await js(`(()=>{const t=document.getElementById('aiDesc');t.value='a night-shift newsroom';t.dispatchEvent(new Event('input'));})()`); await js(`[...document.querySelectorAll('#scrDlg .dbtn button')].find(b=>b.textContent==='Make the theme').click()`); return until(`!!document.querySelector('#scrDlg .dlg')&&/Try it|Save/.test(document.querySelector('#scrDlg .dlg').innerText)`, 5000); });
  for (const [n, h3] of [['settings-top', null], ['settings-theme', 'themeH'], ['settings-places', 'plH'], ['settings-floors', 'flH'], ['settings-schedules', 'schH'], ['settings-cap', 'capH'], ['settings-notify', 'ntfH'], ['settings-detail', 'detH'], ['settings-mood', 'moodH'], ['settings-notdo', 'notH'], ['settings-about', 'aboutH']]) add(n, 'screen', ['#screen'], () => openSettingsAt(h3));
  add('agent-strip', 'chat', ['#stripList'], async () => !!(await openChatWhere(`document.querySelector('#stripList .sitem.attn.st-error')`)));

  // T145, T148 and the old problems of FR-165/FR-167 (long names, a long URL in a toast, a long path in a dialog list)
  add('toast-long-url', 'menu', ['#toasts .toast'], async () => {
    await js(`document.getElementById('shotCalm')&&document.getElementById('shotCalm').remove()`); await H.clearToasts();
    // app.js keeps toast() private, so the element is built the way toast() builds it: a .toast in #toasts
    await js(`(()=>{const t=document.createElement('div');t.className='toast';t.textContent='Copied https://example.com/'+'a'.repeat(300)+' to the clipboard';document.getElementById('toasts').appendChild(t);})()`);
    return until(`document.querySelectorAll('#toasts .toast').length>0`, 3000);
  });
  add('dialog-long-path', 'dialog', ['#modeDlg .dlg'], async () => {
    await closeChat();
    await js(`(()=>{window.DurbarDialog(document)({title:'Remove this folder?',body:'These are listed so you can check them.',lines:['/home/someone/' + 'a'.repeat(200) + '.txt','Short line'],buttons:[{label:'Cancel',value:null},{label:'Remove',value:'ok',cls:'primary'}]});return true})()`); // not awaited: the promise settles when the dialog closes
    return until(`!!document.querySelector('#modeDlg .dlg')`, 3000);
  });
  // spec 061: the folder-setup dialog opens by itself for the first folder when the page address has simfoldersetup=1
  add('folder-setup', 'dialog', ['#scrDlg .dlg.fs'], async () => until(`!!document.querySelector('#scrDlg .dlg.fs')`, 8000));
  S.find((x) => x.name === 'folder-setup').onlyPass = true;
  const PASSES = [
    { name: 'folder-setup', base: 'folder-setup', query: { simfoldersetup: '1' } }, // surfaces that need their own page address
    { name: 'chat-question-long', base: 'chat-question', query: { simquestion: 'long' } }, // T145: a 2,000-character question
    { name: 'send-several-long', base: 'send-several', query: { simnames: 'long' } }, // T148: 60-character names
  ];
  const CONTRAST_SURFACES = ['tools-screen', 'settings-theme', 'settings-places', 'settings-cap', 'place-dialog', 'chat-waiting', 'agent-strip'];
  const BUILTIN = ['clean-office', 'corporate', 'retro', 'durbar-indian', 'durbar-european', 'durbar-japanese'];

  const run = async (s) => {
    if (!/toast/.test(s.name)) await H.calm();
    let ok = await s.open();
    if (!ok) { await reset(); ok = await s.open(); } // one more try: the first open can lose a race with the render
    const tag = { surface: s.name, theme: themeId || theme, size: `${W}x${Hh}` };
    if (!ok) { found.push({ ...tag, rule: 'not-opened', el: s.name, detail: 'the surface could not be opened' }); return; }
    opened.add(s.name);
    await settle(3000);
    await until(`[...document.querySelectorAll('.dlg,.dlg-ov,.toast')].every(e=>e.getAnimations().every(a=>a.playState!=='running'))`, 2000); // the open animation (dlgin scales the box)
    const dark = theme === 'dark' || !!s.contrast;
    const darkAll = theme === 'dark' && !s.contrast; // the dark fixture: every text element, not only the FR-169 controls
    const call = () => js(`window.__uitext.check(${jsLiteral(s.kind)},${jsLiteral(s.roots)},{dark:${jsLiteral(dark)},darkAll:${jsLiteral(darkAll)}})`);
    let v = await call();
    if (v.some((x) => x.rule === 'no-root')) { await ctx.sleep(400); v = await call(); }
    if (s.contrast) v = v.filter((x) => x.rule === 'dark-contrast'); // every built-in theme: the FR-169 controls only
    for (const x of v) {
      if (x.rule === 'dark-text' && ALLOW_TEXT.has(x.key)) { allowedText.add(x.key); continue; } // older debt, listed in the allow file
      if (x.rule.startsWith('todo-')) { todo.set(x.rule, (todo.get(x.rule) || 0) + 1); continue; }
      found.push({ ...tag, ...x });
    }
    if (!s.contrast && /^settings-/.test(s.name) && !/harnesses/.test(s.name)) for (const x of await js(`window.__uitext.measureRule()`)) found.push({ ...tag, ...x });
    if (dark) for (const sel of await js(`window.__uitext.darkControls.filter(s=>[...document.querySelectorAll(s)].some(window.__uitext.vis))`)) opened.add('dark-control ' + sel);
    const pr2 = await js(`window.__uitext.pr2()`);
    if (pr2.tooltips) todo.set('todo-tooltip-over-120', Math.max(todo.get('todo-tooltip-over-120') || 0, pr2.tooltips));
    if (SHOTS && OUT) await H.shot(path.join(OUT, `${s.name}-${theme === 'dark' ? 'dark' : 'light'}-${W}x${Hh}.png`), { prep: 'mouse', delay: 250 });
    console.log(`[ui-text] ${s.name} ${themeId || theme} ${W}x${Hh}: ${v.filter((x) => !x.rule.startsWith('todo-')).length} violations`);
  };

  for (const [w, h] of SIZES) {
    for (const th of THEMES) {
      W = w; Hh = h; theme = th; extraQuery = {};
      await load();
      for (const s of S) {
        if (s.onlyPass || (ONLY && !ONLY.has(s.name))) continue;
        try { await run(s); } catch (e) {
          found.push({ surface: s.name, theme, size: `${W}x${Hh}`, rule: 'error', el: s.name, detail: String((e && e.message) || e).slice(0, 200) });
          try { await load(); } catch (_) { /* next */ }
        }
        await reset();
      }
      for (const ps of PASSES) {
        if (ONLY && !ONLY.has(ps.name)) continue;
        extraQuery = ps.query; await load();
        const base = S.find((x) => x.name === ps.base);
        try { await run({ ...base, name: ps.name }); } catch (e) { found.push({ surface: ps.name, theme, size: `${W}x${Hh}`, rule: 'error', el: '', detail: String((e && e.message) || e).slice(0, 200) }); }
        await reset();
      }
    }
  }

  // FR-169: the contrast of the controls that carried a light literal, in EVERY built-in theme (Clean Office, Corporate, Retro Pixel and
  // the three courts), not only the dark fixture. 1280x800 only: a theme does not change a control's size.
  if (!ONLY || ONLY.has('contrast')) {
    W = 1280; Hh = 800; theme = 'light'; extraQuery = {};
    for (const id of BUILTIN) {
      themeId = id; await load();
      for (const n of CONTRAST_SURFACES) {
        const base = S.find((x) => x.name === n);
        try { await run({ ...base, contrast: true }); } catch (e) { found.push({ surface: n, theme: id, size: '1280x800', rule: 'error', el: '', detail: String((e && e.message) || e).slice(0, 200) }); }
        await reset();
      }
      extraQuery = { simfoldersetup: '1' }; await load(); // the permission tags of the folder-setup dialog
      try { await run({ ...S.find((x) => x.name === 'folder-setup'), contrast: true }); } catch (e) { found.push({ surface: 'folder-setup', theme: id, size: '1280x800', rule: 'error', el: '', detail: String((e && e.message) || e).slice(0, 200) }); }
      await reset(); extraQuery = {};
    }
    themeId = '';
  }

  // FR-169, source side: the simulator cannot reach every control, so every stylesheet of the renderer is read too. A light colour
  // (relative luminance over 0.6, from src/shared/themegen.ts) in a background must be in scripts/fixtures/ui-text-light-allow.json
  // (older debt, listed); the switch knob is the one intended white. Hex, named colours, rgb()/hsl() with numbers and gradients are read;
  // translucent colours (alpha under 0.6) and var() are not light by themselves.
  {
    const { luminance } = require('../dist/shared/themegen.js'); // one luminance helper; the check runs after the build
    const allow = new Set(ALLOWFILE.allow);
    const NAMED = { white: '#ffffff', snow: '#fffafa', ivory: '#fffff0', ghostwhite: '#f8f8ff', whitesmoke: '#f5f5f5', floralwhite: '#fffaf0', linen: '#faf0e6', seashell: '#fff5ee', beige: '#f5f5dc', lightyellow: '#ffffe0', azure: '#f0ffff', mintcream: '#f5fffa', aliceblue: '#f0f8ff', lavenderblush: '#fff0f5', honeydew: '#f0fff0', cornsilk: '#fff8dc', oldlace: '#fdf5e6', lightgray: '#d3d3d3', lightgrey: '#d3d3d3', gainsboro: '#dcdcdc', lavender: '#e6e6fa', mistyrose: '#ffe4e1', papayawhip: '#ffefd5', antiquewhite: '#faebd7', bisque: '#ffe4c4', wheat: '#f5deb3', lemonchiffon: '#fffacd', lightcyan: '#e0ffff', moccasin: '#ffe4b5', silver: '#c0c0c0' };
    const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    const hsl = (h, sa, l) => { sa /= 100; l /= 100; const a = sa * Math.min(l, 1 - l); const f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return '#' + [f(0), f(8), f(4)].map((v) => hex2(v * 255)).join(''); };
    /** the light colours literally written in a background value: [{ text, hex }] */
    const lights = (val) => {
      const out = [];
      const v = val.replace(/var\([^)]*\)/g, ' ');
      for (const m of v.matchAll(/#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g)) {
        let h = m[1]; if (h.length <= 4) h = [...h].map((c) => c + c).join('');
        const alpha = h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1;
        if (alpha >= 0.6 && luminance('#' + h.slice(0, 6)) > 0.6) out.push({ text: m[0].toLowerCase(), hex: '#' + h.slice(0, 6) });
      }
      for (const m of v.matchAll(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/g)) {
        const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
        const hx = '#' + [m[1], m[2], m[3]].map((n) => hex2(+n)).join('');
        if (a >= 0.6 && luminance(hx) > 0.6) out.push({ text: m[0].replace(/\s+/g, ''), hex: hx });
      }
      for (const m of v.matchAll(/hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:\s*[,/]\s*([\d.]+%?))?\s*\)/g)) {
        const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
        const hx = hsl(+m[1], +m[2], +m[3]);
        if (a >= 0.6 && luminance(hx) > 0.6) out.push({ text: m[0].replace(/\s+/g, ''), hex: hx });
      }
      for (const m of v.matchAll(/\b([a-z]+)\b/g)) if (NAMED[m[1]] && luminance(NAMED[m[1]]) > 0.6) out.push({ text: m[1], hex: NAMED[m[1]] });
      return out;
    };
    const dir = path.join(__dirname, '..', 'src', 'renderer');
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.css')).sort()) {
      const css = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      const re = /([^{}@][^{}]*)\{([^{}]*)\}/g; let m;
      while ((m = re.exec(css))) {
        const sel = m[1].trim().replace(/\s+/g, ' ');
        for (const d of m[2].split(/;(?![^(]*\))/)) {
          const x = /^\s*(background(?:-color|-image)?)\s*:\s*([\s\S]*)$/.exec(d);
          if (!x) continue;
          for (const l of lights(x[2])) {
            if (file === 'screens.css' && sel === '.swt i') continue; // the knob carries no text
            if (!allow.has(`${file} | ${sel} | ${l.text}`)) found.push({ surface: `(${file})`, theme: 'dark', size: '-', rule: 'literal-light', el: sel, detail: `${x[1]}: ${l.text}: use a theme token` });
          }
        }
      }
    }
  }
  for (const k of ALLOW_TEXT) if (!ONLY && !allowedText.has(k)) console.log(`[ui-text] note: allow-list text entry never needed: ${k}`);

  // the dark run has to have exercised every control FR-169 names, or the contrast rule checked nothing
  if (THEMES.includes('dark') && !ONLY) {
    const { darkControls } = { darkControls: JSON.parse(await js(`JSON.stringify(window.__uitext.darkControls)`)) };
    for (const sel of darkControls) if (!opened.has('dark-control ' + sel)) found.push({ surface: '(dark run)', theme: 'dark', size: '-', rule: 'dark-control-missing', el: sel, detail: 'never on screen in the dark run, so its contrast was not checked' });
  }

  // report: grouped by rule, then surface
  const byRule = new Map();
  for (const f of found) { if (!byRule.has(f.rule)) byRule.set(f.rule, []); byRule.get(f.rule).push(f); }
  for (const [rule, list] of byRule) {
    console.log(`\n[ui-text] FAIL ${rule}: ${list.length}`);
    const seen = new Set();
    for (const f of list) {
      const k = `${f.surface}|${f.el}|${f.detail}`;
      if (seen.has(k)) { continue; } seen.add(k);
      const where = [...new Set(list.filter((x) => `${x.surface}|${x.el}|${x.detail}` === k).map((x) => `${x.theme === 'dark' ? 'D' : x.theme === 'light' ? 'L' : x.theme}${x.size.split('x')[0]}`))].join(',');
      console.log(`  ${f.surface} [${where}] ${f.el}: ${f.detail}`);
    }
  }
  for (const [rule, n] of todo) console.log(`[ui-text] TODO (PR 2, not asserted) ${rule}: ${n}`);
  if (found.length) throw new Error(`ui-text: ${found.length} violations in ${byRule.size} rules (${[...byRule.keys()].join(', ')})`);
  console.log('[ui-text] all checks passed');
};
