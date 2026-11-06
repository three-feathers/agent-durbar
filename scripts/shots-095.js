/*
 * Spec 095 phase 3 (T050; SC-004): search conversations, on the simulator (no AI credits, no login). Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-095.js xvfb-run -a npx electron . --no-sandbox
 *
 * Real key presses (sendInputEvent) and typed text (insertText), at 1440x900 and 1280x800; exits non-zero on a miss:
 *   FR-001  the box sits after the view toggle (or its magnifier on a narrow bar), with no overflow and text of 10.5px or more
 *   FR-003  Ctrl+Shift+F (⇧⌘F) focuses it from a desk; Escape with a query clears it, goes back to the Office view and to that desk
 *   FR-033  "ab" says "Type at least 3 characters" and keeps the view; a query switches to the List view (FR-002)
 *   US1     results in two groups, marks in the excerpts, the live region's final text; Down goes to the first result, J moves on
 *   US2     Enter on an office result opens its chat with the message in view and marked; an earlier Claude Code session resumes
 *           at its message (simkinds=mixed: Ada is Claude Code); a VS Code chat opens in the viewer at its message; an earlier
 *           Copilot session (title only) resumes at the end; `simsearch=older`: "That message is older than the chat shows."
 *   FR-015  `simsearch=slow`: "Searching, N of M sessions" and Stop, then "Stopped."
 *   FR-014  every end-state note the scan sent (owner answer D: `simsearch=locked`, the exact text); FR-023: Office ends the search
 *   FR-003  the palette's "Search conversations" only focuses the box; the ? sheet lists the shortcut; Settings > Keyboard changes it
 *   FR-050  a mark has a non-colour cue and readable contrast in Clean Office and Retro; Real office: the same box and results;
 *           reduced motion: the jump's outline without its fade
 *   FR-052  rows never overlap, an excerpt is at most two lines, the list scrolls inside its area
 * Screenshots: 095-search-{results,jump,searching}-<w>x<h>.png
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';
const MOD = process.platform === 'darwin' ? 'meta' : 'control';
const LOCKED = 'Some saved MCP values are locked; excerpts may show them.';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until, key } = H;
  const wc = H.wc();
  const shot = (name, w, h, o = {}) => H.shot(path.join(OUT, `095-search-${name}-${w}x${h}.png`), { tag: '095', what: `${name} ${w}x${h}`, ...o });
  const type = async (t) => { wc.insertText(t); await ctx.sleep(60); };
  const ok = async (expr, msg, ms = 8000) => assert.ok(await until(expr, ms), msg);
  const shortcut = () => key('F', [MOD, 'shift'], { char: 'never' });
  const results = () => js(`(()=>{const L=document.getElementById('list');return {list:document.body.classList.contains('list-mode'),
    state:(L.querySelector('.cs-st')||{}).textContent||'',notes:(L.querySelector('.cs-notes')||{}).textContent||'',groups:[...L.querySelectorAll('.cs-ghead')].map(g=>g.textContent.trim()),
    hits:[...L.querySelectorAll('.cs-hit')].map(h=>({k:h.dataset.csk,ex:h.querySelectorAll('.cs-ex').length,marks:h.querySelectorAll('mark').length})),stop:!!document.getElementById('csStop')};})()`);
  const typeQuery = async (q) => {
    await js(`(()=>{const s=document.getElementById('convSearch');s.value='';s.dispatchEvent(new Event('input'));})()`);
    await ok(`!document.querySelector('#list .cs-wrap')`, 'an emptied box ends the search (no results left from the last one)', 3000);
    await shortcut();
    await ok(`document.activeElement&&document.activeElement.id==='convSearch'`, 'the shortcut focuses the box');
    await type(q);
  };
  const doneWith = (n) => ok(`!!document.querySelector('#list .cs-notes')&&document.querySelectorAll('#list .cs-hit').length>=${n}`, `the search ends with ${n}+ results`);
  /* a fit and legibility probe of the results view (FR-050, FR-052) */
  const fit = () => js(`(()=>{const L=document.getElementById('list'),rs=[...L.querySelectorAll('.cs-hit')].map(e=>e.getBoundingClientRect());
    const fonts=[...L.querySelectorAll('.cs-hit *, .cs-st, .cs-notes, .cs-ghead, .lhead *')].filter(e=>e.childNodes.length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).map(e=>parseFloat(getComputedStyle(e).fontSize));
    const over=rs.some((r,i)=>i>0&&r.top<rs[i-1].bottom-0.5);
    const ex=[...L.querySelectorAll('.cs-ex')].map(e=>{const lh=parseFloat(getComputedStyle(e).lineHeight);return e.getBoundingClientRect().height/lh;});
    const de=document.documentElement;return {min:Math.min(...fonts),over,maxLines:Math.max(0,...ex),pageScroll:de.scrollHeight>innerHeight+1||de.scrollWidth>innerWidth+1,inner:getComputedStyle(L).overflowY};})()`);
  /* the marked bubble in the chat: inside the chat's view */
  const jumped = (vs) => js(`(()=>{const c=document.getElementById('chat'),b=c&&c.querySelector('${vs ? '.vsbody ' : ''}.bubble.nt-found');if(!b)return null;const r=b.getBoundingClientRect(),q=c.getBoundingClientRect();return {text:b.textContent.slice(0,80),inView:r.top>=q.top-1&&r.bottom<=q.bottom+1};})()`);
  /* Escape until the chat is closed (the VS Code viewer takes one Escape back to the chat first) */
  const closeChat = async () => { for (let i = 0; i < 3 && (await js(`document.body.classList.contains('panel-open')`)); i++) { await key('Escape', [], { char: 'never' }); await until(`!document.body.classList.contains('panel-open')`, 1500); } };
  const watchAnnounce = () => js(`(()=>{window.__ann=[];const el=document.getElementById('srAnnounce');new MutationObserver(()=>{if(el.textContent)window.__ann.push(el.textContent);}).observe(el,{childList:true,characterData:true,subtree:true});})()`);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, query: { simkinds: 'mixed' }, focus: true });
    await H.calm();
    await watchAnnounce();

    // ---- FR-001: the box (or its magnifier) in the top bar ----
    const bar = await js(`(()=>{const b=document.querySelector('.topbar'),w=document.getElementById('convSearchWrap'),s=document.getElementById('convSearch'),m=document.getElementById('convSearchBtn'),v=document.querySelector('[aria-label="View"]');
      const shown=e=>e.getClientRects().length>0&&getComputedStyle(e).display!=='none';const r=(shown(s)?s:m).getBoundingClientRect(),vr=v.getBoundingClientRect(),br=b.getBoundingClientRect();
      return {collapsed:b.classList.contains('tb-search'),field:shown(s),mag:shown(m),after:r.left>=vr.right-1,inBar:r.top>=br.top&&r.bottom<=br.bottom,font:parseFloat(getComputedStyle(shown(s)?s:m).fontSize),label:(shown(s)?s:m).getAttribute('aria-label'),overflow:document.documentElement.scrollWidth>innerWidth};})()`);
    assert.ok(bar.field !== bar.mag && bar.collapsed === bar.mag, `${w}: the field, or on a narrow bar its magnifier: ${JSON.stringify(bar)}`);
    assert.ok(bar.after && bar.inBar && !bar.overflow, `${w}: after the view toggle, inside the bar: ${JSON.stringify(bar)}`);
    assert.strictEqual(bar.label, 'Search conversations');
    assert.ok(bar.font >= 10.5, `${w}: box text ${bar.font}px`);

    // ---- FR-003, FR-033: from a desk, the shortcut; "ab" is too short and keeps the Office view ----
    const desk = await js(`(()=>{const d=document.querySelector('#stage .desk[data-id]');d.focus();return d.dataset.id})()`);
    await shortcut();
    await ok(`document.activeElement&&document.activeElement.id==='convSearch'`, `${w}: Ctrl+Shift+F focuses the box`);
    await ok(`document.getElementById('convSearchBtn').getAttribute('aria-expanded')==='true'`, `${w}: the box says it is open`);
    await type('re');
    await ok(`(document.getElementById('convSearchHint').textContent||'')==='Type at least 3 characters'&&!document.getElementById('convSearchHint').hidden`, `${w}: "Type at least 3 characters"`);
    assert.ok(!(await js(`document.body.classList.contains('list-mode')`)), `${w}: a short query keeps the Office view`);

    // ---- US1: a query switches to the List view; groups, marks, the final line ----
    await type('gistry');
    await ok(`document.body.classList.contains('list-mode')`, `${w}: the List view shows the results`);
    await doneWith(2);
    let r = await results();
    assert.ok(r.groups.some((g) => /^In the office · \d+ sessions?$/.test(g)) && r.groups.some((g) => /^Earlier sessions · \d+ sessions?$/.test(g)), `${w}: two groups: ${JSON.stringify(r.groups)}`);
    assert.ok(r.hits.every((x) => x.marks > 0), `${w}: every result marks the query: ${JSON.stringify(r.hits)}`);
    assert.ok(/^\d+ results? in \d+ sessions?$/.test(r.state), `${w}: the final line: ${r.state}`);
    assert.ok(/^Searched \d+ sessions in \d+ folders\./.test(r.notes), `${w}: the end state: ${r.notes}`);
    await ok(`(window.__ann||[]).some(t=>/^\\d+ results? in \\d+ sessions?$/.test(t))`, `${w}: the live region says the final count`);
    const f1 = await fit();
    assert.ok(f1.min >= 10.5, `${w}: results text ${f1.min}px`);
    assert.ok(!f1.over && f1.maxLines <= 2.05 && !f1.pageScroll && f1.inner === 'auto', `${w}: no overlap, excerpts within two lines, the list scrolls inside: ${JSON.stringify(f1)}`);
    await shot('results', w, h, { prep: 'calm', keepHover: true });

    // ---- FR-033: an event for another id is ignored (the window's own check, besides main's) ----
    const before = await js(`document.querySelectorAll('#list .cs-hit').length`);
    await js(`window.__durbarSimUi.cs.event({kind:'batch',searchId:'f'.repeat(32),hits:[{adapter:'copilot',sessionId:'stale',agentId:window.__durbarSimUi.agents()[0].id,group:'office',app:'x',folderName:'x',title:'stale',titleMarks:[],time:0,excerpts:[],more:0}],progress:{done:1,total:1},groups:{office:1,earlier:0}})`);
    await ctx.sleep(400);
    assert.strictEqual(await js(`document.querySelectorAll('#list .cs-hit').length`), before, `${w}: a stale id's batch adds nothing`);
    // ---- FR-026: clearing the box tells main (convSearchClear), counted on the simulator's bridge ----
    await js(`(()=>{const b=window.__durbarSimUi.bridge();if(b.__csClears===undefined){b.__csClears=0;const f=b.convSearchClear;b.convSearchClear=(...a)=>{b.__csClears++;return f(...a);};}})()`);

    // ---- US3.3: Down from the box to the first result, J to the next ----
    await js(`document.getElementById('convSearch').focus()`);
    await key('Down', [], { char: 'never' });
    await ok(`!!document.activeElement&&document.activeElement.matches('#list [data-csnav]')`, `${w}: Down goes to the first result`);
    const first = await js(`document.activeElement.dataset.csk`);
    await key('J', [], { char: 'never' });
    await ok(`document.activeElement&&document.activeElement.dataset.csk!==${jsLiteral(first)}&&document.activeElement.matches('#list [data-csnav]')`, `${w}: J moves to the next result`);
    await key('K', [], { char: 'never' });
    await ok(`document.activeElement&&document.activeElement.dataset.csk===${jsLiteral(first)}`, `${w}: K comes back`);

    // ---- US2.1: Enter on an office result opens its chat at the message ----
    assert.ok(/^office:/.test(first), `${w}: the office group comes first`);
    await key('Return');
    await ok(`document.body.classList.contains('panel-open')`, `${w}: the chat opens`);
    await ok(`!!document.querySelector('#chat .bubble.nt-found')`, `${w}: the message is marked`);
    let j = await jumped(false);
    assert.ok(j && j.inView && /registry/i.test(j.text), `${w}: the matching message is in view: ${JSON.stringify(j)}`);
    await ok(`(window.__ann||[]).includes('Message shown.')`, `${w}: and said`);
    await shot('jump', w, h, { prep: 'calm' });
    await closeChat();
    await ok(`!document.body.classList.contains('panel-open')&&!!document.querySelector('#list .cs-hit')`, `${w}: closing the chat comes back to the results`);

    // ---- US2.3: a VS Code chat opens in the viewer at its message ----
    await js(`(()=>{const h=[...document.querySelectorAll('#list .cs-hit')].find(x=>/^earlier:vscode/.test(x.dataset.csk)&&x.querySelectorAll('.cs-ex').length>2);h.querySelectorAll('.cs-ex')[2].click();})()`);
    await ok(`!!document.querySelector('#chat .vsbody .bubble.nt-found')`, `${w}: the VS Code viewer marks the message`);
    j = await jumped(true);
    assert.ok(j && j.inView && /Follow-up 1/.test(j.text), `${w}: the third excerpt's message: ${JSON.stringify(j)}`);
    await closeChat();
    await ok(`!document.body.classList.contains('panel-open')`, `${w}: back from the viewer`);

    // ---- US2.2: an earlier Claude Code session resumes at its message (Resume, the Previous sessions path) ----
    await typeQuery('filings handler');
    await doneWith(1);
    await js(`(()=>{const h=[...document.querySelectorAll('#list .cs-hit')].find(x=>/^earlier:claude:/.test(x.dataset.csk)&&x.querySelector('.cs-ex'));h.querySelector('.cs-ex').click();})()`);
    await ok(`document.body.classList.contains('panel-open')&&!!document.querySelector('#chat .bubble.nt-found')`, `${w}: the resumed session shows the message`, 12000);
    j = await jumped(false);
    assert.ok(j && j.inView && /filings/i.test(j.text), `${w}: the resumed session's message: ${JSON.stringify(j)}`);
    await closeChat();
    await ok(`!document.body.classList.contains('panel-open')`, `${w}: back`);
    await ok(`[...document.querySelectorAll('#list .cs-act')].some(b=>b.textContent==='Open')`, `${w}: the resumed one now says Open (it is in the office)`);

    // ---- US3.2: Escape in the results clears the query and goes back to the Office view and the desk ----
    await js(`document.getElementById('convSearch').focus()`);
    await key('Escape', [], { char: 'never' }); // in the box: cleared, back to the office
    await ok(`!document.body.classList.contains('list-mode')&&document.getElementById('convSearch').value===''`, `${w}: Escape in the box ends it`);
    await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${desk}"]`)}).focus()`);
    await shortcut();
    await ok(`document.activeElement&&document.activeElement.id==='convSearch'`, `${w}: the shortcut again, from the desk`);
    await type('registry');
    await doneWith(1);
    await js(`document.querySelector('#list [data-csnav]').focus()`);
    await key('Escape', [], { char: 'never' });
    await ok(`!document.body.classList.contains('list-mode')&&document.getElementById('convSearch').value===''&&!document.querySelector('#list .cs-hit')`, `${w}: Escape clears and goes back to the Office view`);
    assert.ok((await js(`window.__durbarSimUi.bridge().__csClears`)) >= 2, `${w}: every clear told main (convSearchClear)`);
    await ok(`document.activeElement&&document.activeElement.dataset&&document.activeElement.dataset.id===${jsLiteral(desk)}`, `${w}: and to the desk it came from`);

    // ---- US2.4 (simsearch=older), FR-015 (simsearch=slow), FR-014 / owner answer D (simsearch=locked) ----
    await H.load({ w, h, query: { simsearch: 'older' }, focus: true });
    await H.calm();
    // US5.2: an earlier Copilot session is a title hit: Resume opens it at the end, no message marked
    await typeQuery('backoff');
    await doneWith(1);
    await ok(`[...document.querySelectorAll('#list .cs-hit')].some(x=>/^earlier:copilot:/.test(x.dataset.csk)&&!x.querySelector('.cs-ex')&&x.querySelector('mark'))`, `${w}: an earlier Copilot session matches by its title, marked, with no excerpt`);
    assert.ok(/Not searched: earlier GitHub Copilot sessions, by title only \(\d+\)\./.test((await results()).notes), `${w}: the end state says Copilot's earlier sessions are searched by title only (Q4)`);
    await js(`[...document.querySelectorAll('#list .cs-hit')].find(x=>/^earlier:copilot:/.test(x.dataset.csk)).querySelector('.cs-act').click()`);
    await ok(`document.body.classList.contains('panel-open')`, `${w}: Resume opens it`, 12000);
    await ctx.sleep(400);
    assert.ok(!(await js(`!!document.querySelector('#chat .bubble.nt-found')`)), `${w}: a title hit opens at the end, no message marked`);
    await closeChat();
    await typeQuery('pipeline');
    await doneWith(1);
    await js(`document.querySelector('#list .cs-row ~ .cs-exs .cs-ex').click()`);
    await ok(`document.body.classList.contains('panel-open')`, `${w}: the chat opens`);
    await ok(`[...document.querySelectorAll('#toasts .toast')].some(t=>t.textContent.includes('That message is older than the chat shows.'))`, `${w}: "That message is older than the chat shows."`);
    assert.ok(!(await js(`!!document.querySelector('#chat .bubble.nt-found')`)), `${w}: and no wrong message is marked`);

    await H.load({ w, h, query: { simsearch: 'slow' }, focus: true });
    await H.calm();
    await typeQuery('registry');
    await ok(`/^Searching, \\d+ of \\d+ sessions$/.test((document.querySelector('#list .cs-st')||{}).textContent||'')&&!!document.getElementById('csStop')`, `${w}: "Searching, N of M sessions" with Stop`);
    await ok(`(window.__durbarSimUi?1:1)&&document.querySelector('#list .cs-st').textContent!=='Searching, 0 of 0 sessions'`, `${w}: the progress moves`);
    await shot('searching', w, h, { prep: 'calm' });
    await js(`document.getElementById('csStop').click()`);
    await ok(`(document.querySelector('#list .cs-notes')||{}).textContent==='Stopped.'&&!document.getElementById('csStop')`, `${w}: Stop says "Stopped."`);
    await ok(`document.activeElement&&document.activeElement.id==='convSearch'`, `${w}: and the focus goes back to the box`);

    await H.load({ w, h, query: { simsearch: 'locked' }, focus: true });
    await H.calm();
    await typeQuery('registry');
    await doneWith(1);
    r = await results();
    assert.ok(r.notes.endsWith(LOCKED), `${w}: owner answer D, the exact note: ${r.notes}`);
    // FR-023: leaving the List view ends the search (the box is emptied, no result is left)
    await js(`document.getElementById('vOffice').click()`);
    await ok(`!document.body.classList.contains('list-mode')&&document.getElementById('convSearch').value===''&&!document.querySelector('#list .cs-wrap')`, `${w}: the Office button ends the search`);

    // ---- FR-003: the palette entry only focuses the box; the ? sheet lists the shortcut ----
    await key('Escape', [], { char: 'never' });
    await js(`document.querySelector('#stage .desk[data-id]').focus()`);
    await key('K', [MOD], { char: 'never' });
    await ok(`!!document.getElementById('palDlg')`, `${w}: the palette opens`);
    await type('search conv');
    await ok(`[...document.querySelectorAll('#palDlg [role="option"][aria-selected="true"]')].some(o=>/Search conversations/.test(o.textContent))`, `${w}: "Search conversations" is offered`);
    await key('Return');
    await ok(`!document.getElementById('palDlg')&&document.activeElement&&document.activeElement.id==='convSearch'&&!document.body.classList.contains('list-mode')`, `${w}: it focuses the box and searches nothing`);
    await key('Escape', [], { char: 'never' });
    await js(`document.querySelector('#stage .desk[data-id]').focus()`);
    await key('/', ['shift'], { char: 'always' });
    if (!(await until(`!!document.getElementById('kbdDlg')`, 1500))) await js(`document.getElementById('kbdHelpBtn').click()`);
    await ok(`!!document.getElementById('kbdDlg')&&/Search conversations/.test(document.getElementById('kbdDlg').textContent)`, `${w}: the ? sheet lists Search conversations`);
    await key('Escape', [], { char: 'never' });
  }

  // ---- FR-003: Settings > Keyboard changes the shortcut (once, at 1440x900) ----
  await H.load({ w: 1440, h: 900, focus: true });
  await H.calm();
  await js(`document.getElementById('settingsBtn').click()`);
  await ok(`!!document.getElementById('csKeyRec')`, 'Settings > Keyboard has the Search conversations row');
  assert.ok(/Shift/.test(await js(`document.getElementById('csKeyNow').textContent`)) || /⇧/.test(await js(`document.getElementById('csKeyNow').textContent`)), 'it shows the default');
  await js(`document.getElementById('csKeyRec').focus();document.getElementById('csKeyRec').click()`);
  await key('K', [MOD], { char: 'never' });
  await ok(`/cannot be used\\. Already used for the command palette\\./.test(document.getElementById('csKeyMsg').textContent)`, 'a taken one is refused with a reason');
  await key('G', [MOD, 'shift'], { char: 'never' });
  await ok(`/^Saved: .+ focuses Search conversations\\.$/.test(document.getElementById('csKeyMsg').textContent)`, 'a free one is saved');
  await key('Escape', [], { char: 'never' });
  await until(`!document.getElementById('csKeyRec')`, 3000);
  await js(`document.querySelector('#stage .desk[data-id]')&&document.querySelector('#stage .desk[data-id]').focus()`);
  await shortcut();
  await ctx.sleep(300);
  assert.ok(!(await js(`document.activeElement&&document.activeElement.id==='convSearch'`)), 'the old shortcut no longer focuses the box');
  await key('G', [MOD, 'shift'], { char: 'never' });
  await ok(`document.activeElement&&document.activeElement.id==='convSearch'`, 'the new one does');
  await key('Escape', [], { char: 'never' });
  await js(`document.getElementById('settingsBtn').click()`);
  await ok(`!!document.getElementById('csKeyReset')`, 'Settings again');
  await js(`document.getElementById('csKeyReset').click()`);
  await ok(`/^Back to /.test(document.getElementById('csKeyMsg').textContent)`, 'Reset brings the default back');

  // ---- FR-050: the mark in Clean Office and Retro: bold plus an underline, and readable contrast ----
  for (const theme of ['clean-office', 'retro']) {
    await H.load({ w: 1440, h: 900, query: { theme }, focus: true });
    await H.calm();
    await typeQuery('registry');
    await doneWith(1);
    const m = await js(`(()=>{const e=document.querySelector('#list mark'),cs=getComputedStyle(e);
      const rgb=s=>{const m=String(s).match(/rgba?\\(([^)]+)\\)/);return m?m[1].split(',').map(Number):[255,255,255,1];};
      const bgOf=el=>{for(let x=el;x;x=x.parentElement){const c=rgb(getComputedStyle(x).backgroundColor);if((c[3]===undefined?1:c[3])>0.5)return c;}return [255,255,255];};
      const L=c=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]);};
      const a=L(rgb(cs.color)),b=L(bgOf(e));return {ratio:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05),weight:+cs.fontWeight,line:cs.textDecorationLine,ui:document.documentElement.dataset.ui||''};})()`);
    assert.ok(m.ratio >= 4.5 && m.weight >= 600 && /underline/.test(m.line), `${theme}: the mark reads (contrast ${m.ratio.toFixed(2)}, weight ${m.weight}, ${m.line})`);
  }
  // ---- Real office (spec 097): the same top bar and List view; a result opens at its message ----
  await H.load({ w: 1440, h: 900, query: { officeview: 'real' }, ready: `!!document.querySelector('#stage .ro .ro-plate')`, settle: false, focus: true });
  await H.calm();
  await typeQuery('registry');
  await doneWith(1);
  await js(`document.querySelector('#list .cs-row ~ .cs-exs .cs-ex').click()`);
  await ok(`!!document.querySelector('#chat .bubble.nt-found')`, 'Real office: a result opens at its message');
  // ---- FR-050: reduced motion: the jump marks the message without a fade (the outline stays, no animation) ----
  {
    const dbg = ctx.win.webContents.debugger;
    if (!dbg.isAttached()) dbg.attach('1.3');
    try {
      await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await H.load({ w: 1280, h: 800, focus: true });
      await H.calm();
      assert.ok(await js(`matchMedia('(prefers-reduced-motion: reduce)').matches`), 'reduced motion is emulated');
      await typeQuery('registry');
      await doneWith(1);
      await js(`document.querySelector('#list .cs-row ~ .cs-exs .cs-ex').click()`);
      await ok(`!!document.querySelector('#chat .bubble.nt-found')`, 'reduced motion: the message is marked');
      const st = await js(`(()=>{const b=document.querySelector('#chat .bubble.nt-found'),cs=getComputedStyle(b);return {anim:cs.animationName,outline:cs.outlineStyle};})()`);
      assert.ok(st.anim === 'none' && st.outline === 'solid', `reduced motion: an outline, no fade: ${JSON.stringify(st)}`);
    } finally { await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [] }).catch(() => undefined); }
  }
  console.log('[095] search conversations: all checks passed');
};
