/*
 * Spec 052 (usability pass): simulator checks and screenshots at 1440x900 and 1280x800. No AI credits.
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 DURBAR_SIM_KINDS=mixed \
 *     DURBAR_DRIVER=$PWD/scripts/shots-052-ux.js xvfb-run -a npx electron . --no-sandbox
 *
 * Checks: the restore strip under the top bar (names the folders, covers nothing, Switch to Ask first / Keep); room counts in words; a waiting chat shows how to answer without
 * scrolling (its card in view, or the answer bar); at most 3 header actions; the More menu by keyboard; Previous sessions closed
 * for a chat with a conversation; the list header straight; N opens the next agent that needs you. Prints "[052] PASS".
 */
const assert = require('assert');
const path = require('path');
const { jsLiteral } = require('./check-office-overlap.js'); /* CodeQL js/bad-code-sanitization: values spliced into page code */
const OUT = process.env.OUT || '/tmp';
const INDEX = path.join(process.cwd(), 'dist', 'renderer', 'index.html');

module.exports = async (ctx) => {
  const js = (c) => ctx.js(c);
  const key = (k) => { ctx.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: k }); ctx.win.webContents.sendInputEvent({ type: 'char', keyCode: k }); ctx.win.webContents.sendInputEvent({ type: 'keyUp', keyCode: k }); };
  const shot = async (name) => { ctx.win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 }); await ctx.sleep(400); await ctx.shot(path.join(OUT, name)); console.log('[052] saved', name); };
  const load = async (w, h) => {
    ctx.win.setContentSize(w, h);
    await ctx.win.loadFile(INDEX, { query: { sim: '15', simfreeze: '1', simkinds: 'mixed' } });
    await ctx.waitFor(`document.getElementById('stage')&&document.getElementById('stage').dataset.fit`, 15000);
    await ctx.sleep(2000);
  };
  const deskId = (name) => js(`(()=>{const d=[...document.querySelectorAll('#stage .desk[data-id]')].find(x=>x.innerText.trim().startsWith(${jsLiteral(name)}));return d?d.dataset.id:null})()`);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await load(w, h);
    // FR-015 (round 2): the restore notice is a strip under the top bar that names the folders and covers nothing
    const strip = await js(`(()=>{const e=document.getElementById('restoreStrip');if(!e||e.hidden)return null;const r=e.getBoundingClientRect(),f=document.getElementById('floor').getBoundingClientRect();return {text:e.innerText,below:f.top>=r.bottom-1,btns:[...e.querySelectorAll('button')].map(b=>b.textContent)}})()`);
    assert.ok(strip, 'the restore strip is shown');
    assert.match(strip.text, /Allow all, restored from your last run: .+/);
    assert.ok(/swisscontract-ai|command-center/.test(strip.text), 'it names the folders: ' + strip.text);
    assert.ok(strip.below, 'the office starts below it (nothing covered)');
    assert.deepStrictEqual(strip.btns, ['Ask me first (safer)', 'Keep as it is']);
    // FR-006: room counts in words
    const dots = await js(`[...document.querySelectorAll('#stage .room-dots[role="img"]')].map(x=>x.getAttribute('aria-label'))`);
    assert.ok(dots.length && dots.every((l) => /\d+ (waiting for you|error|working|done|idle)/.test(l)), 'room counts have words: ' + dots[0]);
    await shot(`052-office-${w}x${h}.png`);
    // #308: the defaults are one group; doors and the demo live under ⋯
    assert.ok(await js(`!!document.querySelector('.defaults-grp #permMode')&&!!document.querySelector('.defaults-grp #modelSel')`), 'defaults grouped');
    await js(`document.getElementById('topMoreBtn').focus()`); key('Down'); await ctx.sleep(300);
    const tm = await js(`({open:!document.getElementById('topMoreMenu').hidden,ids:['closeAll','openAll','demoToggle'].map(i=>!!document.querySelector('#topMoreMenu #'+i))})`);
    assert.ok(tm.open && tm.ids.every(Boolean), 'the ⋯ menu holds the doors and the demo: ' + JSON.stringify(tm));
    await shot(`052-topbar-more-${w}x${h}.png`);
    key('Escape'); await ctx.sleep(250);
    assert.ok(await js(`document.getElementById('topMoreMenu').hidden&&document.activeElement.id==='topMoreBtn'`), '⋯ closes on Esc');

    // FR-027 (#305): the inbox lists every agent that needs you; a row's Approve settles that agent's card
    await js(`document.activeElement&&document.activeElement.blur()`);
    key('I'); await ctx.sleep(900);
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
        key('A'); await ctx.sleep(700);
        const n1 = await js(`document.querySelectorAll('#inboxDlg .inbox-row').length`);
        assert.ok(n1 === n0 - 1, `A approves the focused row (${target}: ${n0} -> ${n1})`);
        assert.ok(await js(`document.activeElement&&document.activeElement.classList.contains('ib-h')`), 'after an answer, focus is on the next heading');
        assert.match(await js(`document.getElementById('srAnnounce').textContent`), /Approved .+\. /, 'the answer is announced');
      }
      // approve the first request that is not Jonas's (the chat checks below use Jonas)
      const before2 = await js(`document.querySelectorAll('#inboxDlg .inbox-row').length`);
      const who = await js(`(()=>{const r=[...document.querySelectorAll('#inboxDlg .inbox-row')].find(x=>x.querySelector('.ib-h b').textContent!=='Jonas'&&[...x.querySelectorAll('.ib-act button')].some(b=>b.textContent==='Approve'));if(!r)return null;[...r.querySelectorAll('.ib-act button')].find(b=>b.textContent==='Approve').click();return r.querySelector('.ib-h b').textContent;})()`); await ctx.sleep(700);
      const after = await js(`document.querySelectorAll('#inboxDlg .inbox-row').length`); 
      if (who) assert.ok(after === before2 - 1, `approving ${who} from the inbox removes the row (${before2} -> ${after})`);
      else console.log('[052] note: no second permission request in the simulator; inbox approval checked only by its buttons');
    }
    key('Escape'); await ctx.sleep(300);
    assert.ok(await js(`!document.getElementById('inboxDlg')`), 'Esc closes the inbox');
    // FR-035: Ctrl+Shift+A opens the inbox even from a text field
    await js(`(()=>{const i=document.createElement('input');i.id='tmpIn';document.body.appendChild(i);i.focus();})()`);
    ctx.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control', 'shift'] }); ctx.win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control', 'shift'] }); await ctx.sleep(700);
    assert.ok(await js(`!!document.getElementById('inboxDlg')`), 'Ctrl+Shift+A opens the inbox from a text field');
    key('Escape'); await ctx.sleep(300); await js(`document.getElementById('tmpIn').remove()`);

    // waiting agent's chat
    const jonas = await deskId('Jonas');
    await js(`document.querySelector('#stage [data-id="${jonas}"]').click()`); await ctx.sleep(1500);
    const hdr = await js(`[...document.querySelectorAll('#panelHead .actions > button')].filter(b=>b.getClientRects().length).map(b=>b.id)`);
    assert.ok(hdr.length <= 3, 'at most 3 header actions: ' + hdr.join(','));
    assert.strictEqual(await js(`(document.querySelector('.prev-toggle')||{}).getAttribute?document.querySelector('.prev-toggle').getAttribute('aria-expanded'):'none'`), 'false', 'Previous sessions closed for a chat with a conversation');
    // SC-001: the request is answerable without scrolling (card in view, or the bar)
    const answerable = () => js(`(()=>{const c=document.getElementById('chat').getBoundingClientRect();const card=[...document.querySelectorAll('#chat .note.perm:not(.settled)')].pop();const r=card&&card.getBoundingClientRect();const inView=r&&r.top>=c.top-1&&r.bottom<=c.bottom+1;const bar=document.getElementById('answerBar');return {inView:!!inView,bar:!bar.hidden,btns:[...bar.querySelectorAll('button')].map(b=>b.textContent)}})()`);
    let st = await answerable();
    assert.ok(st.inView || st.bar, 'the request is visible or the bar is shown');
    await shot(`052-chat-waiting-${w}x${h}.png`);
    await js(`document.getElementById('chat').scrollTop=0`); await ctx.sleep(600);
    st = await answerable();
    assert.ok(!st.inView && st.bar && st.btns.includes('Approve') && st.btns.includes('Deny'), 'scrolled away: the bar answers: ' + JSON.stringify(st));
    assert.ok(st.btns.some((t) => /^Approve “.+” for this session$/.test(t)), 'the session approval names its scope (FR-019): ' + st.btns.join(' | '));
    await shot(`052-chat-answerbar-${w}x${h}.png`);
    // the bar's Approve presses the card's own Approve
    await js(`[...document.querySelectorAll('#answerBar button')].find(b=>b.textContent==='Approve').click()`); await ctx.sleep(700);
    assert.ok(await js(`document.getElementById('answerBar').hidden`), 'answered: the bar goes away');
    assert.ok(await js(`!!document.querySelector('#chat .note.perm.settled.approved')`), 'the card shows it was approved');
    // FR-003: More by keyboard
    await js(`document.getElementById('moreBtn').focus()`); key('Down'); await ctx.sleep(300);
    const mm = await js(`({open:!document.getElementById('moreMenu').hidden,focus:document.activeElement&&document.activeElement.getAttribute('role'),items:[...document.querySelectorAll('#moreMenu [role=menuitem]')].map(b=>b.textContent.trim())})`);
    assert.ok(mm.open && mm.focus === 'menuitem', 'Down opens the menu on its first item');
    assert.ok(/Remove|End session/.test(mm.items[mm.items.length - 1]), 'destructive items last: ' + mm.items.join(' | '));
    await shot(`052-more-menu-${w}x${h}.png`);
    key('Escape'); await ctx.sleep(300);
    assert.ok(await js(`document.getElementById('moreMenu').hidden&&document.activeElement.id==='moreBtn'`), 'Esc closes and returns focus to More');
    await js(`document.getElementById('backBtn').click()`); await ctx.sleep(800);

    // FR-008: the list header is straight
    await js(`document.getElementById('vList').click()`); await ctx.sleep(2500);
    const tops = await js(`[...document.querySelector('.lrow.lhead').children].map(c=>Math.round(c.getBoundingClientRect().top))`);
    assert.ok(Math.max(...tops) - Math.min(...tops) <= 1, 'list header straight: ' + tops.join(','));
    await shot(`052-list-${w}x${h}.png`);
    await js(`document.getElementById('vOffice').click()`); await ctx.sleep(800);

    // FR-014: N opens the next agent that needs you, and the next
    await js(`document.activeElement&&document.activeElement.blur()`);
    key('N'); await ctx.sleep(1000);
    const first = await js(`(document.getElementById('panelTitle')||{}).textContent||''`);
    key('N'); await ctx.sleep(1000);
    const second = await js(`(document.getElementById('panelTitle')||{}).textContent||''`);
    assert.ok(first && second && first !== second, `N moves between agents that need you: ${first} -> ${second}`);
    // FR-031 (#306): Simple hides the developer details, keeps answering; plain verbs on cards
    await js(`document.getElementById('backBtn')&&document.getElementById('backBtn').click()`); await ctx.sleep(600);
    await js(`document.getElementById('settingsBtn').click()`); await ctx.sleep(900);
    await js(`document.querySelector('[data-detail="simple"]').click()`); await ctx.sleep(600);
    assert.ok(await js(`document.body.classList.contains('simple')`), 'Simple is on');
    await js(`document.getElementById('scrClose')&&document.getElementById('scrClose').click()`); await ctx.sleep(600);
    const simpleOffice = await js(`({paths:[...document.querySelectorAll('#stage .room-path')].filter(e=>e.getClientRects().length).length,at:[...document.querySelectorAll('#stage .desk')].some(t=>/\bAt [^:]{1,40}: /.test(t.innerText)),verb:[...document.querySelectorAll('#stage .desk')].some(t=>/(Running a command|Searching (code|the web)|Reading notes|Using a tool) · /.test(t.innerText))})`);
    assert.ok(simpleOffice.paths === 0 && !simpleOffice.at, 'Simple office: no paths, no "At <place>: <tool>": ' + JSON.stringify(simpleOffice));
    console.log('[052] simple verbs on cards now:', simpleOffice.verb);
    await shot(`052-simple-office-${w}x${h}.png`);
    const jonasS = await deskId('Jonas'); await js(`document.querySelector('#stage [data-id="${jonasS}"]').click()`); await ctx.sleep(1200);
    const simpleChat = await js(`({hidden:['modelChip','ctxChip','vscodeBtn'].every(i=>{const e=document.getElementById(i);return !e||!e.getClientRects().length}),answer:!!document.querySelector('#chat .note.perm .note-actions button, #chat .note.perm.settled'),mode:!!document.getElementById('modeChip')&&document.getElementById('modeChip').getClientRects().length>0})`);
    assert.ok(simpleChat.hidden && simpleChat.answer && simpleChat.mode, 'Simple chat: developer chips gone, mode and answering kept: ' + JSON.stringify(simpleChat));
    await shot(`052-simple-chat-${w}x${h}.png`);
    await js(`document.getElementById('backBtn').click()`); await ctx.sleep(500);
    await js(`document.getElementById('settingsBtn').click()`); await ctx.sleep(900);
    await js(`document.querySelector('[data-detail="expert"]').click()`); await ctx.sleep(500);
    await js(`document.getElementById('scrClose')&&document.getElementById('scrClose').click()`); await ctx.sleep(500);
    assert.ok(await js(`!document.body.classList.contains('simple')`), 'back to Expert');
    // FR-015: the strip's two actions (last, so the chat checks above see the agents as they started)
    await js(`document.getElementById('backBtn')&&document.getElementById('backBtn').click()`); await ctx.sleep(500);
    if (w === 1440) {
      await js(`document.querySelector('#restoreStrip [data-ns="ask"]').click()`); await ctx.sleep(900);
      assert.ok(await js(`document.getElementById('restoreStrip').hidden`), 'Switch to Ask first clears it');
    } else {
      await js(`document.querySelector('#restoreStrip [data-ns="keep"]').click()`); await ctx.sleep(500);
      assert.ok(await js(`document.getElementById('restoreStrip').hidden`), 'Keep dismisses it');
    }
    console.log('[052]', w, JSON.stringify({ hdr, more: mm.items.length, first, second }));
  }
  console.log('[052] PASS');
};
