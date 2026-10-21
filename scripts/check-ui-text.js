/*
 * Spec 052 FR-171 (issue #464): the help and UI text check. Opens every dialog, popover, menu, screen and chat surface of
 * FR-165..FR-170 in the simulator at 1440x900 and 1280x800, in Clean Office and in a dark fixture theme
 * (scripts/fixtures/themes/dark-audit.json), and asserts, with the measuring code in scripts/ui-text-page.js:
 *   font-size (>= 10.5px), word-split (no word of 4+ letters cut across lines in prose), clipped (text cut by overflow),
 *   x-scroll (nothing in a dialog, popover or menu wider than its box), offscreen, dialog-width (the S/M/L tokens),
 *   dialog-padding (--dlg-pad), field-weight (values in dialog fields are 400/500), measure (--measure), and, in the dark
 *   theme only, dark-contrast (4.5:1 for the controls of FR-169).
 * Part 2 (T150-T155): orphan + menu-width + menu-hints (menus), tooltip-length (static 120, data 300 characters / 8 lines), ellipsis-title,
 *   label-wrap, kbd-align (the shortcut sheet), x-scroll on screens (also with simnames=long), heading-lines (Needs you), copy-overlap,
 *   caret-after-copy and toast-over-composer (the chat), and tone-contrast (every rule that moved from a literal light colour to the
 *   --tone-* tokens reads at 4.5:1 in the 6 built-in themes and the dark fixture; the CSS is parsed here, the colours are resolved in the page).
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


/* the rules of a renderer stylesheet as {sel, decls[]} (comments dropped; @media blocks are read through, their inner rules counted) */
const cssRules = (file) => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const out = []; const re = /([^{}@][^{}]*)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(css))) out.push({ sel: m[1].trim().replace(/\s+/g, ' '), decls: m[2].split(';') });
  return out;
};
/* T152 round 2: the rules that used literal light colours before (their text colours were literal too). Each must read at 4.5:1 in every built-in theme and the dark fixture. */
const TONE_RULES = [
 "styles.css | .note .btn.session",
 "styles.css | .note .btn.session:hover",
 "styles.css | button.lrow[aria-pressed=\"true\"]",
 "styles.css | .btn.danger:hover",
 "styles.css | .quick button",
 "styles.css | .quick button:hover",
 "styles.css | .chip.fail",
 "styles.css | .chip.att-chip",
 "styles.css | .chip.att-chip.img",
 "styles.css | .att",
 "styles.css | .att.img",
 "styles.css | .send[aria-disabled=\"true\"]",
 "styles.css | .sitem.sel",
 "styles.css | .fl-sw[aria-pressed=\"true\"]",
 "styles.css | .nothink",
 "styles.css | .md code",
 "styles.css | .md th",
 "styles.css | .md pre",
 "styles.css | .subblk",
 "styles.css | .subblk.failed",
 "styles.css | .subblk.done",
 "styles.css | .subblk.done .sub-st,.sub-st.done",
 "styles.css | .sub-ro",
 "styles.css | .mode-chip.mode-ask",
 "styles.css | .btn.primary.warn:hover",
 "styles.css | .mode-menu .mm-pend",
 "styles.css | html:not([data-ui]) .inbox-btn.attn",
 "screens.css | .scr-note.warn",
 "screens.css | .scr-warn",
 "screens.css | .srv.amb",
 "screens.css | .mtag",
 "screens.css | .mtag.warn",
 "screens.css | .swt",
 "screens.css | .dlg .derr",
 "screens.css | .note.limit",
 "screens.css | .note.limit.settled",
 "screens.css | .mtag.extra",
 "screens.css | .mtag.src",
 "screens.css | .imp-block",
 "screens.css | .pico-opt:has(input:checked)",
 "screens.css | .hs-ok"
];
const toneList = () => {
  const by = new Map();
  for (const file of ['styles.css', 'screens.css']) for (const r of cssRules(file)) { const k = file + ' | ' + r.sel; by.set(k, Object.assign(by.get(k) || {}, ...r.decls.map((d) => { const m = /^\s*(background(?:-color)?|color)\s*:\s*(.+?)\s*$/.exec(d); return m ? { [m[1] === 'color' ? 'color' : 'bg']: m[2] } : {}; }))); }
  const list = [];
  for (const k of TONE_RULES) {
    const r = by.get(k); if (!r || !r.bg) { list.push({ sel: k, bg: 'transparent', color: 'var(--ink)', missing: true }); continue; }
    let color = r.color; if (!color && /:hover$/.test(k)) { const b = by.get(k.replace(/:hover$/, '')); color = b && b.color; } // a hover state keeps its base text colour
    list.push({ sel: k, bg: r.bg.replace(/\s*!important/, ''), color });
  }
  return list;
};

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until, settle } = H;
  const key = (k, mods = [], char = 'always') => H.key(k, mods, { char });
  const q = (theme, extra) => ({ simkinds: 'mixed', simfloors: '1', simgrants: 'many', simquestion: '1', simtotals: '1', ...(extra || {}), ...(theme === 'dark' ? { theme: 'audit-dark', usertheme: DARK } : { theme: themeId || 'clean-office' }) });
  let theme = 'light', W = 1440, Hh = 900, extraQuery = {}, themeId = '';
  const found = []; // every violation: { surface, theme, size, rule, el, detail }
  const opened = new Set();

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
  add('chat-first', 'chat', ['#panel'], async () => !!(await openChatWhere('true'))); // the first desk, whoever it is (the 60-character names pass)
  // T155: a toast ends above the composer while a chat is open (the real toast(): More > Copy resume command toasts either way)
  add('chat-toast', 'chat', ['#panel'], async () => {
    if (!(await openChat('Ada'))) return false;
    await js(`document.getElementById('shotCalm')&&document.getElementById('shotCalm').remove()`); // H.calm() freezes the toast's pop animation at scale 0
    await H.clearToasts();
    await H.click('#moreBtn'); if (!(await H.exists('#copyResBtn'))) return false; await H.click('#copyResBtn');
    if (!(await until(`document.querySelectorAll('#toasts .toast').length>0`, 3000))) return false;
    await ctx.sleep(500); // the toast's pop animation scales it from 0
    const over = await js(`(()=>{const t=[...document.querySelectorAll('#toasts .toast')].pop().getBoundingClientRect(),c=document.querySelector('#panel .composer').getBoundingClientRect();return t.bottom>c.top+1?'toast bottom '+Math.round(t.bottom)+' is below the composer top '+Math.round(c.top):''})()`);

    if (over) found.push({ surface: 'chat-toast', theme: themeId || theme, size: `${W}x${Hh}`, rule: 'toast-over-composer', el: '#toasts', detail: over });
    return true;
  });
  add('chat-reply', 'chat', ['#panel'], async () => !!(await openChatWhere(`document.querySelector('#chat .msg.agent .cp-btn')`))); // T155: a chat with an agent reply (its Copy button)
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
  const PASSES = [ // surfaces that need their own page address
    { name: 'chat-question-long', base: 'chat-question', query: { simquestion: 'long' } }, // T145: a 2,000-character question
    { name: 'send-several-long', base: 'send-several', query: { simnames: 'long' } }, // T148: 60-character names
    { name: 'tools-agents-long', base: 'tools-agents-tab', query: { simnames: 'long' } }, // T154: Tools > Models and context with 60-character names
    { name: 'inbox-long', base: 'inbox', query: { simnames: 'long' } }, // T154: the Needs you headings
    { name: 'list-view-long', base: 'list-view', query: { simnames: 'long' } },
    { name: 'palette-long', base: 'palette', query: { simnames: 'long' } },
    { name: 'chat-first-long', base: 'chat-first', query: { simnames: 'long' } },
  ];
  const CONTRAST_SURFACES = ['tools-screen', 'settings-theme', 'settings-places', 'settings-cap', 'place-dialog', 'chat-waiting', 'agent-strip'];
  const BUILTIN = ['clean-office', 'corporate', 'retro', 'durbar-indian', 'durbar-european', 'durbar-japanese'];

  const tones = async (id) => { // T152 round 2: the contrast of the rules that moved to the --tone-* tokens, in this theme
    const list = toneList();
    for (const r of list) if (r.missing) found.push({ surface: '(tones)', theme: id, size: '-', rule: 'tone-rule-missing', el: r.sel, detail: 'the rule is not in the CSS (or has no background): update TONE_RULES' });
    for (const x of await js(`window.__uitext.pairs(${jsLiteral(list.filter((r) => !r.missing))})`)) found.push({ surface: '(tones)', theme: id, size: '-', ...x });
  };

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
    let v = await js(`window.__uitext.check(${jsLiteral(s.kind)},${jsLiteral(s.roots)},{dark:${jsLiteral(dark)}})`);
    if (v.some((x) => x.rule === 'no-root')) { await ctx.sleep(400); v = await js(`window.__uitext.check(${jsLiteral(s.kind)},${jsLiteral(s.roots)},{dark:${jsLiteral(dark)}})`); }
    if (s.contrast) v = v.filter((x) => x.rule === 'dark-contrast'); // every built-in theme: the FR-169 controls only
    for (const x of v) {
      found.push({ ...tag, ...x });
    }
    if (!s.contrast && /^settings-/.test(s.name) && !/harnesses/.test(s.name)) for (const x of await js(`window.__uitext.measureRule()`)) found.push({ ...tag, ...x });
    if (dark) for (const sel of await js(`window.__uitext.darkControls.filter(s=>[...document.querySelectorAll(s)].some(window.__uitext.vis))`)) opened.add('dark-control ' + sel);
    if (s.kind === 'chat') for (const sel of ['.cp-btn', '.sub-prompt .pt', '.bubble.caret']) if (await js(`document.querySelectorAll(${jsLiteral('#panel ' + sel)}).length>0`)) opened.add('chat ' + sel);
    if (!s.contrast) for (const x of await js(`window.__uitext.tooltips()`)) found.push({ ...tag, ...x });
    if (SHOTS && OUT) await H.shot(path.join(OUT, `${s.name}-${theme === 'dark' ? 'dark' : 'light'}-${W}x${Hh}.png`), { prep: 'mouse', delay: 250 });
    console.log(`[ui-text] ${s.name} ${themeId || theme} ${W}x${Hh}: ${v.length} violations`);
  };

  for (const [w, h] of SIZES) {
    for (const th of THEMES) {
      W = w; Hh = h; theme = th; extraQuery = {};
      await load();
      if (th === 'dark' && w === SIZES[SIZES.length - 1][0]) await tones('audit-dark');
      for (const s of S) {
        if (ONLY && !ONLY.has(s.name)) continue;
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
      await tones(id);
      for (const n of CONTRAST_SURFACES) {
        const base = S.find((x) => x.name === n);
        try { await run({ ...base, contrast: true }); } catch (e) { found.push({ surface: n, theme: id, size: '1280x800', rule: 'error', el: '', detail: String((e && e.message) || e).slice(0, 200) }); }
        await reset();
      }
    }
    themeId = '';
  }

  // FR-169, source side: the simulator cannot reach every control, so the CSS is read too. A literal light background (a hex of luminance over 0.6)
  // in styles.css or screens.css fails: use a theme token (the --tone-* set in styles.css :root). The one exception is the switch knob (.swt i):
  // it is a white disc with no text on a track that is a token, so there is no text contrast to keep. There is no allow-list.
  {
    const lum = (h) => { h = h.slice(1); if (h.length === 3) h = [...h].map((c) => c + c).join(''); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; const [r, g, b] = [0, 2, 4].map((i) => f(parseInt(h.slice(i, i + 2), 16))); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    for (const file of ['styles.css', 'screens.css']) {
      for (const { sel, decls } of cssRules(file)) {
        for (const d of decls) {
          const x = /^\s*background(?:-color)?\s*:\s*(?:[^;]*?\s)?(#[0-9a-fA-F]{3,8})\b/.exec(d);
          if (!x || lum(x[1].slice(0, 7)) <= 0.6) continue;
          if (file === 'screens.css' && sel === '.swt i') continue; // the knob carries no text
          found.push({ surface: `(${file})`, theme: 'dark', size: '-', rule: 'literal-light', el: sel.slice(0, 80), detail: `background ${x[1]}: use a theme token` });
        }
      }
    }
  }

  // the dark run has to have exercised every control FR-169 names, or the contrast rule checked nothing
  if (THEMES.includes('dark') && !ONLY) {
    const { darkControls } = { darkControls: JSON.parse(await js(`JSON.stringify(window.__uitext.darkControls)`)) };
    for (const sel of darkControls) if (!opened.has('dark-control ' + sel)) found.push({ surface: '(dark run)', theme: 'dark', size: '-', rule: 'dark-control-missing', el: sel, detail: 'never on screen in the dark run, so its contrast was not checked' });
  }

  console.log('[ui-text] chat parts on screen: ' + [...opened].filter((x) => x.startsWith('chat ')).join(', '));
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
  if (found.length) throw new Error(`ui-text: ${found.length} violations in ${byRule.size} rules (${[...byRule.keys()].join(', ')})`);
  console.log('[ui-text] all checks passed');
};
