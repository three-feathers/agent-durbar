/*
 * Spec 044 FR-040..FR-044 (issue #624): a schedule's run history and "Schedules here (N)". Simulator only (no AI credits). Linux with xvfb-run:
 *
 *   npm run check:sched-history
 *
 * At 1440x900 and 1280x800 with `simsched=1&simws=1` (four seeded schedules over two folders, each with a seeded past history, and one
 * multi-root workspace room with a schedule of its own):
 *  - the folder menu (the room's ⋯, a right-click on its header, the List view's Folder cell) and the Folders panel button read
 *    "Schedules here (N)" with that folder's count, "Schedules here" with none (owner Q4), and a workspace counts under its .code-workspace key;
 *    the item opens that folder's own "Schedules for <folder>" dialog listing exactly its schedules, opening it leaves the top-bar badge as it
 *    was (FR-029), and Settings > Schedules has no folder filter;
 *  - every Durbar row, in the dialog and in Settings, has Edit..., Pause, Delete and History inside its panel; History toggles an inline list
 *    (aria-expanded, aria-controls) newest first, every item in words with an icon, a folded busy skip says "4 times, until", a failed run shows
 *    its reason's words, the first 10 show and "Show all (12)" shows the rest, an empty log says so, Tab goes History then Open chat;
 *  - Open chat on a run to a live agent closes Settings and opens that chat; a run to a chat that is gone says "chat closed" with no button;
 *  - a run while the list is open appears at the top without reopening;
 *  - all text is at least 10.5px and neither panel scrolls sideways.
 * A miss prints DRIVER FAILED (Electron still exits 0), so the npm script exits non-zero unless "all checks passed" is printed.
 * Writes 044-history-<w>x<h>.png (Settings), 044-history-dialog-<w>x<h>.png and 044-folder-here-<w>x<h>.png.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  let failed = 0, total = 0;
  const check = (ok, msg) => { total++; if (!ok) { failed++; console.log('FAIL ' + msg); } };
  const shotsDir = process.env.SHOTS_OUT || process.env.OUT || OUT;
  const load = async (w, h) => {
    await H.load({ w, h, query: { simsched: '1', simws: '1' }, ready: 'fit', settle: false });
    await js(`localStorage.removeItem('durbar.schedSeen');true`);
    await H.load({ w, h, query: { simsched: '1', simws: '1' }, ready: 'fit', settle: false });
    await until(`!document.getElementById('schedTopBtn').hidden&&document.querySelectorAll('#stage .desk[data-id]').length>=15`);
    await H.calm();
    H.wc().focus();
  };
  /* the rooms of the simulated office (the page's internals are not reachable from here): id, the folder key (the workspace file, else the folder), its first agent */
  const rooms = () => js(`(()=>{const by=new Map();for(const a of window.__durbarSimUi.agents().filter(x=>!x.parent))if(!by.has(a.room))by.set(a.room,{id:a.room,key:a.info.workspaceFile||a.info.cwd,first:a.id});return [...by.values()]})()`);
  const menuLabel = () => js(`(document.querySelector('#modeMenu [data-fact="sched"] b')||{}).textContent||''`);
  const closeMenu = async () => { await H.key('Escape'); await until(`!document.getElementById('modeMenu')`); };
  const openMenuBy = async (how, room) => {
    if (how === 'dots') await js(`document.querySelector(${jsLiteral(`#stage [data-foldermenu="${room.id}"]`)}).click()`);
    else if (how === 'context') await js(`(()=>{const h=document.querySelector(${jsLiteral(`#stage .room [data-door="${room.id}"]`)}).closest('.room-head');const b=h.getBoundingClientRect();h.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:b.left+40,clientY:b.top+10}));return true})()`);
    else await js(`(()=>{const c=document.querySelector('#list .lrow[data-id="'+CSS.escape(${jsLiteral(room.first)})+'"] .lfold');const b=c.getBoundingClientRect();c.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:b.left+8,clientY:b.top+8}));return true})()`);
    return until(`!!document.querySelector('#modeMenu [data-fact="sched"]')`);
  };
  const dlgIds = () => js(`[...document.querySelectorAll('#sdList .sc-row')].map(r=>r.dataset.id)`);
  const closeDlg = async () => { await js(`document.getElementById('scClose').click()`); await until(`!document.getElementById('schedDlg')`); };
  /* runs in the page: sizes and overflow of a panel, with its buttons */
  const geometry = (rootSel, scrollSel) => js(`(()=>{
    const root=document.querySelector(${jsLiteral(rootSel)}),sc=document.querySelector(${jsLiteral(scrollSel)});
    const R=e=>e.getBoundingClientRect(),box=R(root),bad=[],small=[];
    root.querySelectorAll('.sc-row').forEach(r=>{const rb=R(r);r.querySelectorAll(':scope > button, :scope > .sc-t button').forEach(b=>{const x=R(b);if(!b.getClientRects().length)return;if(x.right>box.right+0.5||x.left<box.left-0.5||x.right>rb.right+0.5||x.left<rb.left-0.5)bad.push((b.dataset.sc||b.dataset.ss||b.className)+' '+Math.round(x.left)+'-'+Math.round(x.right)+' of '+Math.round(box.left)+'-'+Math.round(box.right))})});
    root.querySelectorAll('*').forEach(e=>{if(!e.getClientRects().length)return;const own=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());if(own&&parseFloat(getComputedStyle(e).fontSize)<10.5)small.push(e.tagName+'.'+e.className+' '+getComputedStyle(e).fontSize)});
    return {bad,small,sw:sc.scrollWidth-sc.clientWidth,rootSw:root.scrollWidth-root.clientWidth}})()`);
  const items = (id, k) => js(`[...document.querySelectorAll(${jsLiteral(`#sh-${k}-${id} > li.sh-i`)})].map(li=>({at:Number(li.dataset.at),text:li.innerText.replace(/\\s+/g,' ').trim(),words:(li.querySelector('.sh-w')||{}).textContent||'',icon:!!li.querySelector('svg[aria-hidden="true"]'),chat:(li.querySelector('[data-hchat]')||{}).dataset?.hchat||'',label:(li.querySelector('[data-hchat]')||{}).ariaLabel||'',closed:/chat closed/.test(li.innerText)}))`);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${w}x${h}`;
    await load(w, h);
    const R = await rooms();
    /* the seeds: sched-s1 and sched-s3 in the folder of sim-1, sched-s2 and sched-s4 in the first other folder, sched-ws1 in the workspace room */
    const roomOfA = await js(`window.__durbarSimUi.agents().find(a=>a.id==='sim-1').room`);
    const A = R.find((r) => r.id === roomOfA);
    const B = R.find((r) => r.id !== roomOfA && !/\.code-workspace$/.test(r.key));
    const WS = R.find((r) => /\.code-workspace$/.test(r.key));
    const NONE = R.find((r) => r !== A && r !== B && r !== WS);
    check(!!A && !!B && !!WS && !!NONE, `${tag}: the simulated office has no folder for each case: ${JSON.stringify(R)}`);
    if (!A || !B || !WS || !NONE) continue;
    A.name = 'the folder of sim-1'; B.name = 'the other folder'; WS.name = 'the workspace'; NONE.name = 'a folder with no schedules';
    A.ids = ['sched-s1', 'sched-s3']; B.ids = ['sched-s2', 'sched-s4']; WS.ids = ['sched-ws1']; NONE.ids = [];
    const seenBefore = await js(`({seen:localStorage.getItem('durbar.schedSeen'),cls:document.getElementById('schedTopBtn').className})`);

    /* FR-042: the label on the folder menu, from the three ways to open it, and the dialog behind it */
    for (const how of ['dots', 'context', 'list']) {
      if (how === 'list') { await js(`document.getElementById('vList').click()`); await until(`document.getElementById('vList').getAttribute('aria-pressed')==='true'&&!!document.querySelector('#list .lrow[data-id] .lfold')`); }
      for (const [room, want] of [[A, 'Schedules here (2)'], [B, 'Schedules here (2)'], [WS, 'Schedules here (1)'], [NONE, 'Schedules here']]) {
        const opened = await openMenuBy(how, room);
        check(opened, `${tag} ${how}: the folder menu did not open for ${room.name}`);
        if (!opened) continue;
        const label = await menuLabel();
        check(label === want, `${tag} ${how}: "${label}" for ${room.name} (${room.key}), expected "${want}"`);
        if (how === 'dots' && room === A) await H.shot(path.join(shotsDir, `044-folder-here-${tag}.png`), { prep: 'mouse', settle: true });
        await js(`document.querySelector('#modeMenu [data-fact="sched"]').click()`);
        check(await until(`!!document.getElementById('schedDlg')&&document.querySelectorAll('#sdList .sc-row, #sdList .sc-empty').length>0`), `${tag} ${how}: the item did not open the dialog`);
        const title = await js(`document.getElementById('sdhT').textContent`);
        check(/^Schedules for .+/.test(title), `${tag} ${how}: dialog title "${title}"`);
        const ids = await dlgIds();
        check(JSON.stringify(ids) === JSON.stringify(room.ids), `${tag} ${how}: the dialog of ${room.name} lists ${JSON.stringify(ids)}, expected ${JSON.stringify(room.ids)}`);
        if (room === NONE) {
          const empty = await js(`(()=>{const e=document.querySelector('#sdList .sc-empty'),f=document.getElementById('scAdd');return {text:e&&e.textContent,above:!!e&&!!f&&!!(e.compareDocumentPosition(f)&Node.DOCUMENT_POSITION_FOLLOWING)}})()`);
          check(empty.text === 'No schedules for this folder yet.' && empty.above, `${tag} ${how}: the empty dialog ${JSON.stringify(empty)}`);
        }
        await closeDlg();
      }
    }
    await js(`document.getElementById('vOffice').click()`);
    await until(`document.getElementById('vOffice').getAttribute('aria-pressed')==='true'`);
    /* the Folders panel button: same label */
    await js(`document.getElementById('foldersBtn').click()`);
    await until(`!!document.querySelector('[data-fp="sched"]')`);
    for (const [room, want] of [[A, 'Schedules here (2)'], [B, 'Schedules here (2)'], [WS, 'Schedules here (1)'], [NONE, 'Schedules here']]) {
      const t = await js(`(document.querySelector(${jsLiteral(`[data-fp="sched"][data-room="${room.id}"]`)})||{}).textContent||''`);
      check(t === want, `${tag}: the Folders panel button for ${room.name} reads "${t}", expected "${want}"`);
    }
    await js(`document.querySelector(${jsLiteral(`[data-fp="sched"][data-room="${A.id}"]`)}).click()`);
    check(await until(`!!document.getElementById('schedDlg')`), `${tag}: the Folders panel button did not open the dialog`);
    check(JSON.stringify(await dlgIds()) === JSON.stringify(A.ids), `${tag}: Folders panel dialog lists ${JSON.stringify(await dlgIds())}`);
    /* FR-040: History in the dialog, four buttons inside it */
    const btns = await js(`[...document.querySelectorAll('#sdList .sc-row')].map(r=>[...r.querySelectorAll(':scope > button')].map(b=>b.textContent.trim()))`);
    check(btns.length === 2 && btns.every((b) => JSON.stringify(b) === JSON.stringify(['Edit…', 'Pause', 'Delete', 'History'])), `${tag}: dialog buttons ${JSON.stringify(btns)}`);
    await js(`document.querySelector('#sdList [data-sc="hist"][data-id="sched-s1"]').click()`);
    check(await until(`document.querySelector('#sdList [data-sc="hist"][data-id="sched-s1"]').getAttribute('aria-expanded')==='true'&&document.querySelectorAll('#sh-sc-sched-s1 > li.sh-i').length>=10`), `${tag}: History did not open in the dialog`);
    check(await js(`document.querySelector('#sdList [data-sc="hist"][data-id="sched-s1"]').getAttribute('aria-controls')==='sh-sc-sched-s1'`), `${tag}: History's aria-controls`);
    const dg = await geometry('#schedDlg .dlg', '#schedDlg .dlg');
    check(dg.bad.length === 0 && dg.sw <= 1, `${tag}: dialog geometry ${JSON.stringify(dg)}`);
    check(dg.small.length === 0, `${tag}: dialog text under 10.5px: ${JSON.stringify(dg.small.slice(0, 4))}`);
    const listBox = await js(`(()=>{const l=document.getElementById('sdList');return {sw:l.scrollWidth-l.clientWidth}})()`);
    check(listBox.sw <= 1, `${tag}: the dialog's list scrolls sideways (${listBox.sw})`);
    await settle();
    await H.shot(path.join(shotsDir, `044-history-dialog-${tag}.png`), { prep: 'mouse', settle: true });
    await closeDlg();
    await js(`document.getElementById('foldersBtn').click()`);
    /* FR-042: opening a folder's dialog leaves the badge and its stamp as they were (FR-029) */
    const seenAfter = await js(`({seen:localStorage.getItem('durbar.schedSeen'),cls:document.getElementById('schedTopBtn').className})`);
    check(JSON.stringify(seenAfter) === JSON.stringify(seenBefore), `${tag}: the dialogs changed the top-bar badge: ${JSON.stringify(seenBefore)} -> ${JSON.stringify(seenAfter)}`);

    /* FR-040: Settings > Schedules through the top-bar button */
    await js(`document.getElementById('schedTopBtn').click()`);
    check(await until(`!document.getElementById('screen').hidden&&document.querySelectorAll('#schedSet .sc-row').length===5`), `${tag}: Settings > Schedules does not list 5 rows`);
    await settle();
    const srows = await js(`[...document.querySelectorAll('#schedSet .sc-row')].map(r=>({id:r.dataset.id,btns:[...r.querySelectorAll(':scope > button')].map(b=>b.textContent.trim()),open:r.querySelector('[data-ss="hist"]').getAttribute('aria-expanded')}))`);
    check(srows.every((r) => JSON.stringify(r.btns) === JSON.stringify(['Edit…', 'Pause', 'Delete', 'History']) && r.open === 'false'), `${tag}: Settings rows ${JSON.stringify(srows)}`);
    /* no folder filter: the same controls as before (a folder button per group, one "Add a schedule to" select), no "Schedules here" */
    const filt = await js(`({selects:[...document.querySelectorAll('#schedSet select')].map(s=>s.id),here:/Schedules here/.test(document.getElementById('schedSet').innerText)})`);
    check(JSON.stringify(filt.selects) === JSON.stringify(['ssRoom']) && !filt.here, `${tag}: Settings > Schedules has a folder filter or the new label: ${JSON.stringify(filt)}`);

    /* the seeded history of sched-s1: newest first, words with icons, folded skip, Show all */
    await js(`document.querySelector('#schedSet [data-ss="hist"][data-id="sched-s1"]').click()`);
    check(await until(`document.querySelectorAll('#sh-ss-sched-s1 > li.sh-i').length===10&&!!document.querySelector('#sh-ss-sched-s1 .sh-more button')`), `${tag}: the first 10 runs and Show all did not appear`);
    let it = await items('sched-s1', 'ss');
    check(it.length === 10 && it.every((x, i) => i === 0 || x.at <= it[i - 1].at), `${tag}: times are not newest first: ${JSON.stringify(it.map((x) => x.at))}`);
    check(it.every((x) => x.icon && x.words.length > 3 && /^[A-Z]/.test(x.words)), `${tag}: an item has no icon or no words: ${JSON.stringify(it.filter((x) => !x.icon || x.words.length <= 3))}`);
    const more = await js(`document.querySelector('#sh-ss-sched-s1 .sh-more button').textContent`);
    check(more === 'Show all (12)', `${tag}: "${more}"`);
    await js(`document.querySelector('#sh-ss-sched-s1 .sh-more button').click()`);
    check(await until(`document.querySelectorAll('#sh-ss-sched-s1 > li.sh-i').length===12&&!document.querySelector('#sh-ss-sched-s1 .sh-more')`), `${tag}: Show all did not show the 12 runs`);
    it = await items('sched-s1', 'ss');
    check(it.length === 12 && it.every((x, i) => i === 0 || x.at <= it[i - 1].at), `${tag}: all 12 runs, newest first`);
    const fold = it.find((x) => /Skipped: the agent was busy/.test(x.words));
    check(!!fold && /4 times, until/.test(fold.text), `${tag}: the folded busy skip: ${JSON.stringify(fold)}`);
    const gone = it.filter((x) => x.closed);
    check(gone.length === 2 && gone.every((x) => !x.chat), `${tag}: runs to a chat that is gone: ${JSON.stringify(gone)} (expected 2 "chat closed" with no button)`);
    check(it[0].chat === 'sim-1' && /^Open chat: .+/.test(it[0].label), `${tag}: the newest run does not offer Open chat for sim-1: ${JSON.stringify(it[0])}`);
    const lst = await js(`(()=>{const o=document.getElementById('sh-ss-sched-s1');return {tag:o.tagName,name:o.getAttribute('aria-label')}})()`);
    check(lst.tag === 'OL' && /^Runs of PR and issue sweep/.test(lst.name), `${tag}: the list is an ordered list named "${lst.name}"`);
    /* failed, missed and empty */
    for (const [id, re, what] of [['sched-s4', /Could not send: the agent app refused it/, 'failed with its reason'], ['sched-s3', /Missed: the app was closed/, 'missed']]) {
      await js(`document.querySelector(${jsLiteral(`#schedSet [data-ss="hist"][data-id="${id}"]`)}).click()`);
      check(await until(`document.querySelectorAll(${jsLiteral(`#sh-ss-${id} > li.sh-i`)}).length===1`), `${tag}: ${id} shows no run`);
      const one = await items(id, 'ss');
      check(one.length === 1 && re.test(one[0].words) && one[0].icon, `${tag}: ${what}: ${JSON.stringify(one)}`);
    }
    for (const id of ['sched-s2', 'sched-ws1']) {
      await js(`document.querySelector(${jsLiteral(`#schedSet [data-ss="hist"][data-id="${id}"]`)}).click()`);
      check(await until(`(document.querySelector(${jsLiteral(`#sh-ss-${id} > li.sh-empty`)})||{}).textContent==='No runs yet.'`), `${tag}: ${id}: the empty text`);
    }
    const sg = await geometry('#schedSet', '#schedSet .scr-body, .scr-body');
    check(sg.bad.length === 0 && sg.sw <= 1, `${tag}: Settings geometry ${JSON.stringify(sg)}`);
    check(sg.small.length === 0, `${tag}: Settings text under 10.5px: ${JSON.stringify(sg.small.slice(0, 4))}`);
    await js(`document.querySelector('#schedSet [data-ss="hist"][data-id="sched-s1"]').scrollIntoView({block:'start'})`);
    await H.shot(path.join(shotsDir, `044-history-${tag}.png`), { prep: 'mouse', settle: true });

    /* keyboard: Tab goes History, then its Open chat buttons, in order */
    await js(`document.querySelector('#schedSet [data-ss="hist"][data-id="sched-s1"]').focus()`);
    await H.key('Tab', [], { pause: 50 });
    const tabbed = await js(`(()=>{const a=document.activeElement;return {chat:a.dataset.hchat||'',inList:!!a.closest('#sh-ss-sched-s1')}})()`);
    check(tabbed.inList && tabbed.chat === 'sim-1', `${tag}: Tab after History did not reach the first Open chat: ${JSON.stringify(tabbed)}`);

    /* a run while the list is open appears at the top without reopening */
    const before = (await items('sched-s1', 'ss')).length;
    check(await js(`window.__durbarSimSched.fail('sched-s1')`), `${tag}: the simulator could not record a run`);
    check(await until(`document.querySelectorAll('#sh-ss-sched-s1 > li.sh-i').length===${before + 1}&&/Could not send: no agent in this folder/.test(document.querySelector('#sh-ss-sched-s1 > li.sh-i .sh-w').textContent)`), `${tag}: a new run did not appear at the top of the open list`);
    check(await js(`document.querySelector('#schedSet [data-ss="hist"][data-id="sched-s1"]').getAttribute('aria-expanded')==='true'`), `${tag}: the list closed itself on a change`);
    /* History closes again */
    await js(`document.querySelector('#schedSet [data-ss="hist"][data-id="sched-s1"]').click()`);
    check(await until(`document.getElementById('sh-ss-sched-s1').hidden&&document.querySelector('#schedSet [data-ss="hist"][data-id="sched-s1"]').getAttribute('aria-expanded')==='false'`), `${tag}: History did not close`);
    await js(`document.querySelector('#schedSet [data-ss="hist"][data-id="sched-s1"]').click()`);
    await until(`!document.getElementById('sh-ss-sched-s1').hidden&&!!document.querySelector('#sh-ss-sched-s1 [data-hchat]')`);

    /* FR-041: Open chat closes Settings and opens that chat */
    await js(`document.querySelector('#sh-ss-sched-s1 [data-hchat="sim-1"]').click()`);
    check(await until(`document.getElementById('screen').hidden&&document.body.classList.contains('panel-open')&&document.getElementById('panelTitle').textContent===window.__durbarSimUi.agents().find(a=>a.id==='sim-1').name`), `${tag}: Open chat did not close Settings and open the chat of sim-1`);
    await H.key('Escape'); await until(`!document.body.classList.contains('panel-open')`);
    console.log(`[sched-history] ${tag} done`);
  }

  assert.ok(total > 60, 'too few checks ran: ' + total);
  console.log(`[sched-history] ${total - failed}/${total} checks passed`);
  if (failed) throw new Error(`${failed} check(s) failed`);
  console.log('[sched-history] all checks passed');
};
