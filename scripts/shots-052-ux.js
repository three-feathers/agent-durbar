/*
 * Spec 052 (usability pass): simulator checks and screenshots at 1440x900 and 1280x800. No AI credits.
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 DURBAR_SIM_KINDS=mixed \
 *     DURBAR_DRIVER=$PWD/scripts/shots-052-ux.js xvfb-run -a npx electron . --no-sandbox
 *
 * Checks: the restore strip under the top bar (names the folders, covers nothing, Make it ask me first / Keep as it is); room counts in words; a waiting chat shows how to answer without
 * scrolling (its card in view, or the answer bar); at most 3 header actions; the More menu by keyboard; Previous sessions closed
 * for a chat with a conversation; the list header straight; N opens the next agent that needs you. Round 6: Allow all badges inside their cards,
 * Sven reads Failing with a last-activity tooltip, 34px list rows with the new columns, sorting (aria-sort) and J/K, Jonas's "Show the change".
 * Prints "[052] PASS".
 */
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');
const path = require('path');
const OUT = process.env.OUT || '/tmp';

/* spec 052 FR-084: the palette and inbox shortcuts are Cmd on a Mac, Ctrl elsewhere (Ctrl+` stays Control everywhere, FR-091) */
const MOD = process.platform === 'darwin' ? 'meta' : 'control';

module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-096/097: shared plumbing, waits for the page instead of a fixed time
  const { until, settle, office, chatOf, js } = H;
  const key = (k) => H.key(k, [], { char: 'always' }); // not awaited: the events are sent at once
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'mouse', tag: '052' });
  const load = async (w, h) => {
    await H.load({ w, h, query: { simkinds: 'mixed' }, ready: 'fit', settle: false });
    await office(15); await until(`!!document.getElementById('restoreStrip')&&!document.getElementById('restoreStrip').hidden`);
  };
  const deskId = H.idOf;

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await load(w, h);
    // FR-015 (round 2): the restore notice is a strip under the top bar that names the folders and covers nothing
    const strip = await js(`(()=>{const e=document.getElementById('restoreStrip');if(!e||e.hidden)return null;const r=e.getBoundingClientRect(),f=document.getElementById('floor').getBoundingClientRect();return {text:e.innerText,below:f.top>=r.bottom-1,btns:[...e.querySelectorAll('button')].map(b=>b.textContent)}})()`);
    assert.ok(strip, 'the restore strip is shown');
    assert.match(strip.text, /^(One folder \(.+\) lets|\d+ folders \(.+\) let) agents change files without asking\.$/m);
    assert.ok(/swisscontract-ai|command-center/.test(strip.text), 'it names the folders: ' + strip.text);
    assert.ok(strip.below, 'the office starts below it (nothing covered)');
    assert.deepStrictEqual(strip.btns, ['Make it ask me first', 'Keep as it is']);
    // FR-065 (round 6): every card in an Allow all folder shows the red Allow all icon, inside its card (the text badge is in the list row); FR-062: Sven (3 failed tool calls in the simulator) reads Failing
    const aa = await js(`(()=>{const b=[...document.querySelectorAll('#stage .desk .modeic.mode-allow')];return {n:b.length,text:[...new Set(b.map(x=>x.textContent))],inside:b.every(x=>{const r=x.getBoundingClientRect(),c=x.closest('.desk').getBoundingClientRect();return r.width>0&&r.left>=c.left-0.5&&r.right<=c.right+0.5&&r.top>=c.top-0.5&&r.bottom<=c.bottom+0.5;}),allow:[...document.querySelectorAll('#stage .desk[aria-label*="Allow all"]')].length}})()`);
    assert.ok(aa.n > 0 && aa.n === aa.allow, 'one Allow all icon per Allow all card: ' + JSON.stringify(aa));
    assert.ok(aa.inside, 'the icon stays inside its card');
    const sv = await js(`(()=>{const d=[...document.querySelectorAll('#stage .desk[data-id]')].find(x=>x.innerText.trim().startsWith('Sven'));const p=d&&[...d.querySelectorAll('.pill,.stl')].find(x=>x.getClientRects().length);return p?{text:p.innerText.trim(),cls:p.className,title:d.getAttribute('title')||''}:null})()`);
    assert.ok(sv && /^Failing/.test(sv.text) && /st-failing/.test(sv.cls), 'Sven reads Failing: ' + JSON.stringify(sv));
    assert.ok(/Last activity (just now|\d+ min ago)/.test(sv.title), 'the card says when it last did something: ' + sv.title);
    // FR-006: room counts in words
    const dots = await js(`[...document.querySelectorAll('#stage .room-dots[role="img"]')].map(x=>x.getAttribute('aria-label'))`);
    assert.ok(dots.length && dots.every((l) => /\d+ (waiting for you|error|working|done|idle)/.test(l)), 'room counts have words: ' + dots[0]);
    await shot(`052-office-${w}x${h}.png`);
    // #308: the defaults are one group; doors and the demo live under ⋯
    assert.ok(await js(`!!document.querySelector('.defaults-grp #permMode')&&!!document.querySelector('.defaults-grp #modelSel')`), 'defaults grouped');
    await js(`document.getElementById('topMoreBtn').focus()`); key('Down'); await until(`!document.getElementById('topMoreMenu').hidden`);
    const tm = await js(`({open:!document.getElementById('topMoreMenu').hidden,ids:['closeAll','openAll','demoToggle','endAllBtn'].map(i=>!!document.querySelector('#topMoreMenu #'+i))})`);
    assert.ok(tm.open && tm.ids.every(Boolean), 'the ⋯ menu holds the doors, the demo and End all sessions (FR-090): ' + JSON.stringify(tm));
    await shot(`052-topbar-more-${w}x${h}.png`);
    key('Escape'); await until(`document.getElementById('topMoreMenu').hidden&&document.activeElement.id==='topMoreBtn'`);
    assert.ok(await js(`document.getElementById('topMoreMenu').hidden&&document.activeElement.id==='topMoreBtn'`), '⋯ closes on Esc');

    // FR-027 (#305): the inbox lists every agent that needs you; a row's Allow once settles that agent's card
    await js(`document.activeElement&&document.activeElement.blur()`);
    key('I'); await until(`!!document.getElementById('inboxDlg')&&document.activeElement&&document.activeElement.classList.contains('ib-h')`);
    const ib = await js(`(()=>{const d=document.getElementById('inboxDlg');if(!d)return null;return {rows:[...d.querySelectorAll('.inbox-row')].map(r=>r.querySelector('.ib-h b').textContent),btn:document.getElementById('inboxBtn').innerText}})()`);
    assert.ok(ib && ib.rows.length >= 3, 'the inbox lists the agents that need you: ' + JSON.stringify(ib));
    // FR-033: it opens on the first request's heading, never on a button
    assert.ok(await js(`document.activeElement&&document.activeElement.classList.contains('ib-h')`), 'the inbox opens on a heading, not a button');
    await shot(`052-inbox-${w}x${h}.png`);
    if (w === 1440) {
      const before = ib.rows.length;
      // FR-033: J moves to a row, A approves it (keys act on the focused row)
      const target = await js(`(()=>{const rows=[...document.querySelectorAll('#inboxDlg .inbox-row')];const i=rows.findIndex(x=>x.querySelector('.ib-h b').textContent!=='Jonas'&&x.querySelector('[data-k="approve"]'));if(i<0)return null;rows[i].querySelector('.ib-h').focus();return rows[i].querySelector('.ib-h b').textContent;})()`);
      if (target) {
        const n0 = await js(`document.querySelectorAll('#inboxDlg .inbox-row').length`);
        key('A');
        // the answered row shows its answer (600ms) and folds (200ms) before the list repaints: wait for it, up to 4 s
        let n1 = n0;
        for (let t = 0; t < 40 && n1 === n0; t++) { await ctx.sleep(100); n1 = await js(`document.querySelectorAll('#inboxDlg .inbox-row').length`); }
        assert.ok(n1 === n0 - 1, `A approves the focused row (${target}: ${n0} -> ${n1})`);
        assert.ok(await js(`document.activeElement&&document.activeElement.classList.contains('ib-h')`), 'after an answer, focus is on the next heading');
        assert.match(await js(`document.getElementById('srAnnounce').textContent`), /Allowed .+\. /, 'the answer is announced');
      }
      // approve the first request that is not Jonas's (the chat checks below use Jonas)
      const before2 = await js(`document.querySelectorAll('#inboxDlg .inbox-row').length`);
      const who = await js(`(()=>{const r=[...document.querySelectorAll('#inboxDlg .inbox-row')].find(x=>x.querySelector('.ib-h b').textContent!=='Jonas'&&[...x.querySelectorAll('.ib-act button')].some(b=>b.textContent==='Allow once'));if(!r)return null;[...r.querySelectorAll('.ib-act button')].find(b=>b.textContent==='Allow once').click();return r.querySelector('.ib-h b').textContent;})()`); await ctx.sleep(700);
      let after = await js(`document.querySelectorAll('#inboxDlg .inbox-row').length`);
      for (let t = 0; t < 40 && who && after === before2; t++) { await ctx.sleep(100); after = await js(`document.querySelectorAll('#inboxDlg .inbox-row').length`); } 
      if (who) assert.ok(after === before2 - 1, `approving ${who} from the inbox removes the row (${before2} -> ${after})`);
      else console.log('[052] note: no second permission request in the simulator; inbox approval checked only by its buttons');
    }
    key('Escape'); await until(`!document.getElementById('inboxDlg')`);
    assert.ok(await js(`!document.getElementById('inboxDlg')`), 'Esc closes the inbox');
    // FR-035: Ctrl+Shift+A opens the inbox even from a text field
    await js(`(()=>{const i=document.createElement('input');i.id='tmpIn';document.body.appendChild(i);i.focus();})()`);
    const mod = MOD; H.key('A', [mod, 'shift'], { char: 'never', pause: 0 }); await until(`!!document.getElementById('inboxDlg')`);
    assert.ok(await js(`!!document.getElementById('inboxDlg')`), 'Ctrl+Shift+A opens the inbox from a text field');
    key('Escape'); await until(`!document.getElementById('inboxDlg')`); await js(`document.getElementById('tmpIn').remove()`);

    // waiting agent's chat
    const jonas = await deskId('Jonas');
    await js(`document.querySelector(${jsLiteral(`#stage [data-id="${jonas}"]`)}).click()`); await chatOf('Jonas');
    // round 10 (FR-095): "Previous (N)" was a toggle, not an action; since spec 006 FR-033 it is not in the header at all (the :not() stays harmless)
    const hdr = await js(`[...document.querySelectorAll('#panelHead .actions > button:not(#prevBtn):not(#newSessHdrBtn)')].filter(b=>b.getClientRects().length).map(b=>b.id)`);
    assert.ok(hdr.length <= 3, 'at most 3 header actions besides Previous and + New (FR-139): ' + hdr.join(','));
    assert.strictEqual(await js(`(document.querySelector('.prev-toggle')||{}).getAttribute?document.querySelector('.prev-toggle').getAttribute('aria-expanded'):'none'`), 'false', 'Previous sessions closed for a chat with a conversation');
    // SC-001: the request is answerable without scrolling (card in view, or the bar)
    const answerable = () => js(`(()=>{const c=document.getElementById('chat').getBoundingClientRect();const card=[...document.querySelectorAll('#chat .note.perm:not(.settled)')].pop();const r=card&&card.getBoundingClientRect();const inView=r&&r.top>=c.top-1&&r.bottom<=c.bottom+1;const bar=document.getElementById('answerBar');return {inView:!!inView,bar:!bar.hidden,btns:[...bar.querySelectorAll('button')].map(b=>b.textContent)}})()`);
    let st = await answerable();
    assert.ok(st.inView || st.bar, 'the request is visible or the bar is shown');
    // FR-063 (round 6): Jonas's edit request has a collapsed "Show the change" with + and - lines; the chat header says when it was last active
    const df = await js(`(()=>{const d=[...document.querySelectorAll('#chat .note.perm:not(.settled) > details.pdiff')].pop();if(!d)return null;const was=d.open;d.open=true;const r={was,sum:d.querySelector('summary').textContent,add:d.querySelectorAll('.dl.add').length,del:d.querySelectorAll('.dl.del').length};d.open=false;return r;})()`);
    assert.ok(df && !df.was && /^Show the change/.test(df.sum) && df.add > 0 && df.del > 0, 'Jonas: a collapsed diff: ' + JSON.stringify(df));
    assert.match(await js(`(document.querySelector('#panelHead [data-f=ago]')||{}).textContent||''`), /^active (just now|\d+m ago)$/);
    await shot(`052-chat-waiting-${w}x${h}.png`);
    await js(`document.getElementById('chat').scrollTop=0`); await until(`(()=>{const b=document.getElementById('answerBar');return b&&!b.hidden&&b.querySelectorAll('button').length>0})()`);
    st = await answerable();
    assert.ok(!st.inView && st.bar && st.btns.includes('Allow once') && st.btns.includes('Deny'), 'scrolled away: the bar answers: ' + JSON.stringify(st));
    assert.ok(st.btns.some((t) => /^Allow “.+” for this session$/.test(t)), 'the session approval names its scope (FR-019): ' + st.btns.join(' | '));
    await shot(`052-chat-answerbar-${w}x${h}.png`);
    // the bar's Allow once presses the card's own Allow once
    await js(`[...document.querySelectorAll('#answerBar button')].find(b=>b.textContent==='Allow once').click()`); await until(`document.getElementById('answerBar').hidden&&!!document.querySelector('#chat .note.perm.settled.approved')`);
    assert.ok(await js(`document.getElementById('answerBar').hidden`), 'answered: the bar goes away');
    assert.ok(await js(`!!document.querySelector('#chat .note.perm.settled.approved')`), 'the card shows it was approved');
    // FR-003: More by keyboard
    await js(`document.getElementById('moreBtn').focus()`); key('Down'); await until(`!document.getElementById('moreMenu').hidden&&document.activeElement&&document.activeElement.getAttribute('role')==='menuitem'`);
    const mm = await js(`({open:!document.getElementById('moreMenu').hidden,focus:document.activeElement&&document.activeElement.getAttribute('role'),items:[...document.querySelectorAll('#moreMenu [role=menuitem]')].map(b=>b.textContent.trim())})`);
    assert.ok(mm.open && mm.focus === 'menuitem', 'Down opens the menu on its first item');
    assert.ok(/Remove|End session/.test(mm.items[mm.items.length - 1]), 'destructive items last: ' + mm.items.join(' | '));
    await shot(`052-more-menu-${w}x${h}.png`);
    key('Escape'); await until(`document.getElementById('moreMenu').hidden&&document.activeElement.id==='moreBtn'`);
    assert.ok(await js(`document.getElementById('moreMenu').hidden&&document.activeElement.id==='moreBtn'`), 'Esc closes and returns focus to More');
    await js(`document.getElementById('backBtn').click()`); await office(15);

    // FR-008: the list header is straight
    await js(`document.getElementById('vList').click()`); await until(`document.querySelectorAll('#list button.lrow').length>=15&&!!document.querySelector('.lrow.lhead')`); await settle();
    const tops = await js(`[...document.querySelector('.lrow.lhead').children].map(c=>Math.round(c.getBoundingClientRect().top))`);
    assert.ok(Math.max(...tops) - Math.min(...tops) <= 1, 'list header straight: ' + tops.join(','));
    // FR-064 (round 6): 34px rows, the new columns, sorting by a header (aria-sort), J/K between rows
    const lv = await js(`(()=>{const rows=[...document.querySelectorAll('#list button.lrow')];return {n:rows.length,h:Math.max(...rows.map(r=>r.getBoundingClientRect().height)),cols:[...document.querySelectorAll('.lrow.lhead .lsort')].map(b=>b.firstChild.textContent),cells:rows.length?rows[0].children.length:0,pageW:document.documentElement.scrollWidth<=innerWidth+1}})()`);
    assert.ok(lv.n >= 15 && lv.h <= 35, 'list rows are 34px: ' + JSON.stringify(lv));
    assert.deepStrictEqual(lv.cols, ['Agent', 'Agent app', 'Role', 'Folder', 'Current task', 'Active', 'Usage', 'Status']);
    assert.strictEqual(lv.cells, 8, 'one cell per column'); assert.ok(lv.pageW, 'the list does not widen the page');
    // FR-101, FR-104 (round 10): a status that needs nothing is a dot and a word (no fill), Waiting/Error/Failing keep the fill; numbers right-aligned
    const pf = await js(`(()=>{const ps=[...document.querySelectorAll('#list button.lrow .pill')].map(p=>({c:(p.className.match(/st-(\\w+)/)||[])[1],bg:getComputedStyle(p).backgroundColor,h:p.getBoundingClientRect().height}));const num=document.querySelector('#list button.lrow .lcell.num');return {ps,align:num?getComputedStyle(num).textAlign:''}})()`);
    const clear = (bg) => bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent';
    assert.ok(pf.ps.filter((p) => /^(working|thinking|idle|done)$/.test(p.c)).every((p) => clear(p.bg)), 'calm statuses have no fill: ' + JSON.stringify(pf.ps.slice(0, 6)));
    assert.ok(pf.ps.filter((p) => /^(waiting|error|failing)$/.test(p.c)).every((p) => !clear(p.bg)), 'statuses that need you keep the filled pill');
    assert.ok(pf.ps.every((p) => Math.abs(p.h - 22) < 0.6), 'the pill keeps its 22px height');
    assert.strictEqual(pf.align, 'right', 'number columns are right-aligned');
    await js(`document.querySelector('#list [data-lsort="name"]').click()`); await until(`document.querySelector('#list [data-lsort="name"]').parentNode.getAttribute('aria-sort')==='ascending'`);
    const asc = await js(`({sort:document.querySelector('#list [data-lsort="name"]').parentNode.getAttribute('aria-sort'),focus:document.activeElement&&document.activeElement.dataset.lsort,names:[...document.querySelectorAll('#list button.lrow .lname > span:nth-child(2)')].filter(n=>!n.classList.contains('sub')).map(n=>n.textContent.trim())})`);
    assert.strictEqual(asc.sort, 'ascending'); assert.strictEqual(asc.focus, 'name', 'focus stays on the header');
    assert.deepStrictEqual(asc.names, asc.names.slice().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })), 'sorted by name: ' + asc.names.join(','));
    await js(`document.querySelector('#list [data-lsort="name"]').click()`); await until(`document.querySelector('#list [data-lsort="name"]').parentNode.getAttribute('aria-sort')==='descending'`);
    assert.strictEqual(await js(`document.querySelector('#list [data-lsort="name"]').parentNode.getAttribute('aria-sort')`), 'descending');
    // FR-173: a background re-render (an agent's status changes) keeps the focus on the same row; it used to fall to the page, which made J/K flaky on a busy runner
    await js(`document.querySelectorAll('#list button.lrow')[1].focus()`);
    const fid = await js(`document.activeElement.dataset.id`);
    await js(`document.activeElement.__before=1;window.__durbarSimEmit({type:'status',sessionId:${jsLiteral(fid)},timestamp:Date.now(),status:'idle',intent:'Ready'})`);
    const redrawn = await until(`(()=>{const r=document.querySelector('#list button.lrow[data-id="'+CSS.escape(${jsLiteral(fid)})+'"]');return !!r&&!r.__before})()`); // the list was drawn again
    const kept = await js(`(()=>{const a=document.activeElement;return {tag:a.tagName,cls:a.className,id:a.dataset&&a.dataset.id||'',inList:!!a.closest('#list')}})()`);
    assert.ok(redrawn && kept.inList && kept.id === fid, `a re-render keeps the focus on the list row ${fid}: ${JSON.stringify({ redrawn, ...kept })}`);
    await js(`document.querySelector('#list button.lrow').focus()`); key('J'); await until(`document.activeElement===document.querySelectorAll('#list button.lrow')[1]`);
    assert.ok(await js(`document.activeElement===document.querySelectorAll('#list button.lrow')[1]`), 'J moves to the next row');
    key('K'); await until(`document.activeElement===document.querySelectorAll('#list button.lrow')[0]`);
    assert.ok(await js(`document.activeElement===document.querySelectorAll('#list button.lrow')[0]`), 'K moves back');
    await js(`document.querySelector('#list [data-lsort="name"]').click()`); await until(`document.querySelector('#list [data-lsort="name"]').parentNode.getAttribute('aria-sort')==='ascending'`); await settle(); /* back to ascending for the picture */
    await js(`document.activeElement&&document.activeElement.blur()`);
    await shot(`052-list-${w}x${h}.png`);
    await js(`document.getElementById('vOffice').click()`); await office(15);
    // FR-173, office half: the same re-render in the office view keeps the focus on the same desk in #stage (the lookup is scoped to the
    // view the focus was in; the list rows keep the same data-id)
    await js(`document.querySelectorAll('#stage .desk[data-id]')[1].focus()`);
    const did = await js(`document.activeElement&&document.activeElement.closest('#stage')?document.activeElement.dataset.id||'':''`);
    assert.ok(did, 'a desk in the office takes the focus');
    // a status change alone morphs the desks in place (the node and its focus survive); a change of density draws the stage afresh. Clear
    // the stage's density mark so the re-render rebuilds every desk, as a resize or a new agent does, and the restore has to find it again
    await js(`document.activeElement.__before=1;document.getElementById('stage').dataset.d='';window.__durbarSimEmit({type:'status',sessionId:${jsLiteral(did)},timestamp:Date.now(),status:'working',intent:'Back at it'})`);
    const redrawnDesk = await until(`(()=>{const d=document.querySelector('#stage .desk[data-id="'+CSS.escape(${jsLiteral(did)})+'"]');return !!d&&!d.__before})()`); // the office was drawn again
    const keptDesk = await js(`(()=>{const a=document.activeElement;return {tag:a.tagName,cls:String(a.className),id:a.dataset&&a.dataset.id||'',inStage:!!a.closest('#stage')}})()`);
    assert.ok(redrawnDesk && keptDesk.inStage && keptDesk.id === did, `a re-render keeps the focus on the office desk ${did}: ${JSON.stringify({ redrawnDesk, ...keptDesk })}`);

    // FR-014: N opens the next agent that needs you, and the next
    await js(`document.activeElement&&document.activeElement.blur()`);
    key('N'); await until(`document.body.classList.contains('panel-open')&&!!(document.getElementById('panelTitle')||{}).textContent`); await settle();
    const first = await js(`(document.getElementById('panelTitle')||{}).textContent||''`);
    key('N'); await until(`(document.getElementById('panelTitle')||{}).textContent!==${jsLiteral(first)}`); await settle();
    const second = await js(`(document.getElementById('panelTitle')||{}).textContent||''`);
    assert.ok(first && second && first !== second, `N moves between agents that need you: ${first} -> ${second}`);
    // FR-031 (#306): Simple hides the developer details, keeps answering; plain verbs on cards
    await js(`document.getElementById('backBtn')&&document.getElementById('backBtn').click()`); await office(15);
    await js(`document.getElementById('settingsBtn').click()`); await until(`!!document.querySelector('[data-detail="simple"]')`);
    await js(`document.querySelector('[data-detail="simple"]').click()`); await until(`document.body.classList.contains('simple')`);
    assert.ok(await js(`document.body.classList.contains('simple')`), 'Simple is on');
    await js(`document.getElementById('scrClose')&&document.getElementById('scrClose').click()`); await office(15);
    const simpleOffice = await js(`({paths:[...document.querySelectorAll('#stage .room-path')].filter(e=>e.getClientRects().length).length,at:[...document.querySelectorAll('#stage .desk')].some(t=>/\bAt [^:]{1,40}: /.test(t.innerText)),verb:[...document.querySelectorAll('#stage .desk')].some(t=>/(Running a command|Searching (files|code|the web)|Reading notes|Using a tool) · /.test(t.innerText))})`);
    assert.ok(simpleOffice.paths === 0 && !simpleOffice.at, 'Simple office: no paths, no "At <place>: <tool>": ' + JSON.stringify(simpleOffice));
    console.log('[052] simple verbs on cards now:', simpleOffice.verb);
    await shot(`052-simple-office-${w}x${h}.png`);
    // a fresh office in Simple (the level is remembered): Jonas's request is drawn in Simple from the start (round 7 FR-080)
    ctx.win.webContents.reload(); await ctx.waitFor(`document.getElementById('stage')&&document.getElementById('stage').dataset.fit`, 15000); await office(15);
    assert.ok(await js(`document.body.classList.contains('simple')`), 'Simple is remembered after a reload');
    const jonasS = await deskId('Jonas'); await js(`document.querySelector(${jsLiteral(`#stage [data-id="${jonasS}"]`)}).click()`); await chatOf('Jonas');
    const simpleChat = await js(`({hidden:['modelChip','vscodeBtn','copyResBtn','mcpBtn','toolsHdrBtn'].every(i=>{const e=document.getElementById(i);return !e||!e.getClientRects().length}),answer:!!document.querySelector('#chat .note.perm .note-actions button, #chat .note.perm.settled'),mode:!!document.getElementById('modeChip')&&document.getElementById('modeChip').getClientRects().length>0})`);
    assert.ok(simpleChat.hidden && simpleChat.answer && simpleChat.mode, 'Simple chat: developer chips gone, mode and answering kept: ' + JSON.stringify(simpleChat));
    // round 7 FR-081: the memory chip stays in Simple, in plain words
    assert.match(await js(`(document.getElementById('ctxChip')||{}).textContent||''`), /Memory \d+% full/, 'Simple: the context chip reads Memory N% full');
    // round 9 FR-093: in Simple it shows only from 70% full
    { const m = await js(`(()=>{const e=document.getElementById('ctxChip');if(!e)return null;const p=/Memory (\\d+)% full/.exec(e.textContent);return {pct:p?+p[1]:-1,vis:e.getClientRects().length>0};})()`);
      assert.ok(!m || m.vis === (m.pct >= 70), 'Simple: the memory chip shows only from 70% full: ' + JSON.stringify(m)); }
    // FR-080/FR-081 (round 7): the request in plain words, the folder in small text, "See what changes"; memory chip, no tokens, no remote item
    const plainChat = await js(`(()=>{const cs=[...document.querySelectorAll('#chat .note.perm:not(.limit):not(.question)')],c=cs.find(x=>!x.classList.contains('settled'))||cs[cs.length-1],v=e=>!!e&&e.getClientRects().length>0,cc=document.getElementById('ctxChip'),cb=document.getElementById('compactBtn'),ph=document.querySelector('#panel .ph');
      return {sum:c?c.querySelector('.psum').textContent:'',fold:c&&v(c.querySelector('.pfold'))?c.querySelector('.pfold').textContent:'',diff:c&&c.querySelector('.pdiff>summary')?c.querySelector('.pdiff>summary').textContent:'',
        ctx:v(cc)?cc.textContent.trim():null,compact:v(cb)?cb.textContent.trim():null,tok:/\btok(ens)?\b/.test(ph?ph.innerText:''),remote:v(document.getElementById('remoteBtn'))&&!document.getElementById('remoteBtn').classList.contains('on'),
        chips:[...document.querySelectorAll('#chat .chip')].filter(v).map(x=>x.innerText.trim()).slice(-4),code:[...document.querySelectorAll('#chat .chip>code')].some(v)};})()`);
    assert.ok(/^Jonas wants to change companies\.ts$/.test(plainChat.sum) && /^\s*in tools$/.test(plainChat.fold) && /^See what changes/.test(plainChat.diff), 'Simple request in plain words: ' + JSON.stringify(plainChat));
    assert.ok((plainChat.ctx === null || /^Memory /.test(plainChat.ctx)) && (plainChat.compact === null || plainChat.compact === 'Tidy up memory') && !plainChat.tok && !plainChat.remote && !plainChat.code, 'Simple header and tool rows: ' + JSON.stringify(plainChat));
    console.log('[052] simple tool rows:', plainChat.chips.join(' | '));
    await shot(`052-simple-chat-${w}x${h}.png`);
    const kenjiS = await deskId('Kenji');
    if (kenjiS) {
      await js(`document.getElementById('backBtn').click()`); await office(15);
      await js(`document.querySelector(${jsLiteral(`#stage [data-id="${kenjiS}"]`)}).click()`); await chatOf('Kenji');
      const k = await js(`(()=>{const c=document.querySelector('#chat .note.perm:not(.settled)');if(!c)return null;const d=c.querySelector('details.pcmd');return {sum:c.querySelector('.psum').textContent,open:d?d.open:null,cmd:d?d.querySelector('pre').textContent:'',vis:!!d&&d.getClientRects().length>0}})()`);
      if (k) assert.ok(k.sum === 'Kenji wants to run a command' && k.vis && k.open === false && /baseline\.py/.test(k.cmd), 'Simple shell request: the command under a collapsed "Show the command": ' + JSON.stringify(k));
    }
    await js(`document.getElementById('backBtn').click()`); await office(15);
    await js(`document.getElementById('settingsBtn').click()`); await until(`!!document.querySelector('[data-detail="expert"]')`);
    await js(`document.querySelector('[data-detail="expert"]').click()`); await until(`!document.body.classList.contains('simple')`);
    await js(`document.getElementById('scrClose')&&document.getElementById('scrClose').click()`); await office(15);
    assert.ok(await js(`!document.body.classList.contains('simple')`), 'back to Expert');
    // FR-042 (#316): Ctrl+K opens the palette; typing filters it; Enter opens the agent's chat
    await js(`document.activeElement&&document.activeElement.blur()`);
    H.key('K', [MOD], { char: 'never', pause: 0 }); await until(`!!document.getElementById('palDlg')&&document.activeElement&&document.activeElement.id==='palIn'`);
    assert.ok(await js(`!!document.getElementById('palDlg')&&document.activeElement&&document.activeElement.id==='palIn'`), 'Ctrl+K opens the palette with focus in its input');
    await js(`(()=>{const i=document.getElementById('palIn');i.value=${jsLiteral('lena')};i.dispatchEvent(new Event('input',{bubbles:true}));})()`); await until(`(document.querySelector('#palList [role="option"] .pal-l')||{}).textContent==='Lena'`);
    const pal = await js(`({opts:[...document.querySelectorAll('#palList [role="option"]')].map(o=>o.querySelector('.pal-l').textContent),active:document.getElementById('palIn').getAttribute('aria-activedescendant'),said:document.getElementById('srAnnounce').textContent})`);
    assert.ok(pal.opts.includes('Lena'), 'the palette lists Lena: ' + JSON.stringify(pal));
    assert.strictEqual(pal.opts[0], 'Lena', 'prefix matches first: ' + pal.opts.join(' | '));
    assert.ok(pal.active === 'palO0', 'the first option is active');
    await shot(`052-palette-${w}x${h}.png`);
    key('Return'); await until(`!document.getElementById('palDlg')`); await chatOf('Lena');
    assert.ok(await js(`!document.getElementById('palDlg')`), 'Enter closes the palette');
    assert.strictEqual(await js(`(document.getElementById('panelTitle')||{}).textContent||''`), 'Lena', 'Enter opens Lena\'s chat');
    await js(`document.getElementById('backBtn').click()`); await office(15);
    // FR-091 (round 8): with an empty search the palette starts with Recent (Lena, just opened); Ctrl+` goes back to her chat
    H.key('K', [MOD], { char: 'never', pause: 0 }); await until(`!!document.querySelector('#palList [role="option"]')`);
    const rec = await js(`({g:(document.querySelector('#palList .pal-g')||{}).textContent,first:(document.querySelector('#palList [role="option"] .pal-l')||{}).textContent,end:[...document.querySelectorAll('#palList .pal-l')].some(x=>x.textContent==='End all sessions')})`);
    assert.ok(rec.g === 'Recent' && rec.first === 'Lena', 'the palette lists recent chats first: ' + JSON.stringify(rec));
    key('Escape'); await until(`!document.getElementById('palDlg')`);
    await js(`document.activeElement&&document.activeElement.blur()`);
    H.key('`', ['control'], { char: 'never', pause: 0 }); await chatOf('Lena');
    assert.strictEqual(await js(`(document.getElementById('panelTitle')||{}).textContent||''`), 'Lena', 'Ctrl+` opens the previous chat');
    await js(`document.getElementById('backBtn').click()`); await office(15);
    // FR-043: ? opens the shortcut sheet; Esc closes it
    await js(`document.activeElement&&document.activeElement.blur()`);
    // a synthetic Shift+/ keyDown arrives as key '/' on macOS (a real keyboard gives '?'), so there the page gets the '?' keydown itself
    if (process.platform === 'darwin') await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'?',shiftKey:true,bubbles:true,cancelable:true}))`);
    else { ctx.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: '/', modifiers: ['shift'] }); ctx.win.webContents.sendInputEvent({ type: 'char', keyCode: '?', modifiers: ['shift'] }); ctx.win.webContents.sendInputEvent({ type: 'keyUp', keyCode: '/', modifiers: ['shift'] }); }
    await ctx.waitFor(`!!document.getElementById('kbdDlg')`, 5000).catch(() => undefined);
    if (!(await js(`!!document.getElementById('kbdDlg')`))) {
      // macOS CI failed here twice in a row (not a timing flake): say what blocks the '?' shortcut
      const why = await js(`({active:(document.activeElement&&(document.activeElement.id||document.activeElement.tagName))||'none',dialogs:[...document.querySelectorAll('[role="dialog"]')].map(d=>(d.id||d.className)+(d.getAttribute('aria-modal')==='true'?' (modal)':'')),menus:[...document.querySelectorAll('[role="menu"]')].map(m=>m.id||m.className)})`);
      assert.fail('? opens the shortcut sheet; blocked by: ' + JSON.stringify(why));
    }
    assert.ok(await js(`/Ctrl.*K|⌘.*K|Cmd.*K/.test(document.getElementById('kbdDlg').innerText)`), 'the shortcut sheet lists the palette shortcut');
    await shot(`052-shortcuts-${w}x${h}.png`);
    key('Escape'); await until(`!document.getElementById('kbdDlg')`);
    assert.ok(await js(`!document.getElementById('kbdDlg')`), 'Esc closes the shortcut sheet');
    // FR-015: the strip's two actions (last, so the chat checks above see the agents as they started)
    await js(`document.getElementById('backBtn')&&document.getElementById('backBtn').click()`); await office(15);
    if (w === 1440) {
      await js(`document.querySelector('#restoreStrip [data-ns="ask"]').click()`); await until(`document.getElementById('restoreStrip').hidden`);
      assert.ok(await js(`document.getElementById('restoreStrip').hidden`), 'Make it ask me first clears it');
    } else {
      await js(`document.querySelector('#restoreStrip [data-ns="keep"]').click()`); await until(`document.getElementById('restoreStrip').hidden`);
      assert.ok(await js(`document.getElementById('restoreStrip').hidden`), 'Keep dismisses it');
    }
    console.log('[052]', w, JSON.stringify({ hdr, more: mm.items.length, first, second }));
  }
  console.log('[052] PASS');
};
