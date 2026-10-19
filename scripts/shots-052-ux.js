/*
 * Spec 052 (usability pass): simulator checks and screenshots at 1440x900 and 1280x800. No AI credits.
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 DURBAR_SIM_KINDS=mixed \
 *     DURBAR_DRIVER=$PWD/scripts/shots-052-ux.js xvfb-run -a npx electron . --no-sandbox
 *
 * Checks: the restore banner (Got it, no timer, bottom left); room counts in words; a waiting chat shows how to answer without
 * scrolling (its card in view, or the answer bar); at most 3 header actions; the More menu by keyboard; Previous sessions closed
 * for a chat with a conversation; the list header straight; N opens the next agent that needs you. Prints "[052] PASS".
 */
const assert = require('assert');
const path = require('path');
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
  const deskId = (name) => js(`(()=>{const d=[...document.querySelectorAll('#stage .desk[data-id]')].find(x=>x.innerText.trim().startsWith(${JSON.stringify(name)}));return d?d.dataset.id:null})()`);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await load(w, h);
    // FR-004: the restore banner stays, has Got it, and sits bottom left
    const ban = await js(`(()=>{const t=document.querySelector('#toasts .toast.warn');if(!t)return null;const r=t.getBoundingClientRect();return {text:t.innerText,left:r.left,act:!!t.querySelector('.toast-act')}})()`);
    assert.ok(ban, 'the restore banner is shown');
    assert.match(ban.text, /can still act without asking you/);
    assert.ok(ban.act && ban.left < 40, 'Got it, bottom left');
    // FR-006: room counts in words
    const dots = await js(`[...document.querySelectorAll('#stage .room-dots[role="img"]')].map(x=>x.getAttribute('aria-label'))`);
    assert.ok(dots.length && dots.every((l) => /\d+ (waiting for you|error|working|done|idle)/.test(l)), 'room counts have words: ' + dots[0]);
    await shot(`052-office-${w}x${h}.png`);
    await ctx.sleep(10000);
    assert.ok(await js(`!!document.querySelector('#toasts .toast.warn')`), 'the banner is still there after 10 s');
    await js(`document.querySelector('#toasts .toast.warn .toast-act').click()`); await ctx.sleep(500);
    assert.ok(await js(`!document.querySelector('#toasts .toast.warn')`), 'Got it closes it');

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
    console.log('[052]', w, JSON.stringify({ hdr, more: mm.items.length, first, second }));
  }
  console.log('[052] PASS');
};
