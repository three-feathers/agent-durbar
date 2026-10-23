/*
 * Spec 001 FR-034..FR-040 (owner, 2026-10-22): office metaphors in the lobby. The Boss (questions and permissions queue there), the Bank
 * (Durbar's spending cap), the Postbox (the next scheduled runs, a letter flies when one fires), who is at a place and the room header words.
 * Simulator only (no credits): `simsched=1` seeds three schedules (one missed its last run), `simschedfire=N` adds a one-off run for the
 * first idle agent N s after start, `simbreak=8` puts Tomas and Rosa on provider breaks (coffee corner); Omar hits his Durbar cap at load.
 * Checks at 1440x900 and 1280x800, 15 agents and a sparse office, Clean Office and Retro Pixel (the built-in theme with a dark page):
 * the Boss is the middle tile; the agents with a pending question or permission stand in its queue in the inbox's order, with a badge and
 * the longest wait; their desks are empty with the note; a new permission makes an idle agent walk there; an entry opens the chat with the
 * request in view, and answering it sends the figure back; Omar waits at the Bank and his entry opens the limit card; the Postbox lists the
 * next three runs soonest first with "today" and the missed flag, opens Settings > Schedules, and a fired schedule flies one letter; the
 * office page rules (overlap, clipping, no scroll, text >= 10.5 px). With LOBBY_REDUCED=1 (and --force-prefers-reduced-motion): no walk and
 * no letter. Linux:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_DRIVER=$PWD/scripts/shots-001-lobby.js xvfb-run -a npx electron . --no-sandbox
 *   LOBBY_REDUCED=1 OUT=/tmp DURBAR_USER_DATA=$(mktemp -d) DURBAR_DRIVER=$PWD/scripts/shots-001-lobby.js xvfb-run -a npx electron . --no-sandbox --force-prefers-reduced-motion
 */
const assert = require('assert');
const path = require('path');
const { pageCheck } = require('./check-office-overlap.js');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';
const FORCED_REDUCED = process.env.LOBBY_REDUCED === '1';
/* Whether the page animates comes from the page itself (prefers-reduced-motion), not only from LOBBY_REDUCED: a CI desktop can report reduced
   motion on its own (review on PR 511: the Windows runner reached the end state with no walk). Set after the first load and printed. */
let REDUCED = FORCED_REDUCED;
const q = jsLiteral; /* every value spliced into page code goes through jsLiteral (CodeQL js/bad-code-sanitization) */

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const js = (c) => H.js(c);
  const emit = (e) => js(`window.__durbarSimEmit(Object.assign({timestamp:Date.now()},${q(e)}))`);
  const page = async (label) => { const r = await js(`(${pageCheck.toString()})(false, 5)`); assert.deepStrictEqual(r.problems, [], `${label}: office page rules`); return r.info; };
  /* a page load that the start-up page interrupts (ERR_FAILED -2, seen under heavy machine load) is tried once more */
  const hload = async (o) => { try { await H.load(o); } catch (e) { if (!/ERR_FAILED|ERR_ABORTED/.test(String(e && e.message))) throw e; await ctx.sleep(500); await H.load(o); } };
  const { settleWalk } = H; // shared with calm and every shot (driver-helpers, spec 001 FR-085)
  const load = async (n, w, h, extra = {}) => {
    await hload({ w, h, query: { sim: String(n), simsched: '1', ...extra }, ready: `document.querySelectorAll('#stage .desk[data-id]').length>=${q(n)}&&!!document.querySelector('#stage .place.boss')` });
    await H.until(`document.querySelector('#stage .place.boss.busy')`, 6000); await ctx.sleep(1500); await settleWalk(); await ctx.sleep(300);
  };
  const tiles = () => js(`[...document.querySelectorAll('#stage .lobby .place')].map(p=>p.dataset.place)`);
  const tile = (id) => js(`(()=>{const p=document.querySelector('#stage .place[data-place="'+${q(id)}+'"]');if(!p)return null;return {label:p.getAttribute('aria-label'),count:(p.querySelector('.pc')||{}).textContent||'',wait:(p.querySelector('.bw')||{}).textContent||'',mode:p.dataset.chips,
    pv:[...p.querySelectorAll('.pv:not(.pv-more)')].map(e=>({id:e.dataset.visitor,ask:e.dataset.ask||'',n:e.querySelector('.pv-n').textContent,title:e.title,go:e.tagName==='BUTTON'})),more:(p.querySelector('.pv-more .slot')||{}).textContent||'',
    lines:[...p.querySelectorAll('.pb-line')].map(x=>x.textContent),today:(p.querySelector('.pb-n')||{}).textContent||'',flag:(p.querySelector('.pb-flag')||{}).textContent||'',w:p.getBoundingClientRect().width}})()`);
  const nameOf = (id) => js(`(window.__durbarSimUi.agents().find(a=>a.id===${q(id)})||{}).name`);
  /* who should be at the Boss: live main agents waiting on a question or a permission (not the cap, not a coffee break) */
  const askers = () => js(`window.__durbarSimUi.agents().filter(a=>!a.parent&&a.live&&a.state==='waiting'&&!a.coffee&&!a.limit).map(a=>a.name)`);
  const inboxNames = async () => {
    await js(`document.getElementById('inboxBtn').click()`); await H.until(`document.getElementById('inboxDlg')`);
    const names = await js(`[...document.querySelectorAll('#inboxDlg .inbox-row')].map(r=>r.querySelector('.ib-h b').textContent.trim())`);
    await js(`document.getElementById('inboxClose').click()`); await H.until(`!document.getElementById('inboxDlg')`);
    return names;
  };
  const SEEDED = ['PR and issue sweep', 'Cut the pre-release notes', 'Morning summary of failing checks'];

  for (const theme of ['clean-office', 'retro']) for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tq = theme === 'clean-office' ? {} : { theme };
    const tag = theme === 'clean-office' ? '' : '-' + theme;
    /* ---- 15 agents: Boss, Bank, coffee corner, Postbox ---- */
    await load(15, w, h, { simbreak: '8', simquestion: '1', ...tq });
    const order = await tiles();
    const pageReduced = await js(`matchMedia('(prefers-reduced-motion: reduce)').matches`);
    if (FORCED_REDUCED) assert.ok(pageReduced, 'LOBBY_REDUCED=1 needs --force-prefers-reduced-motion');
    if (pageReduced !== REDUCED || (theme === 'clean-office' && w === 1440)) console.log(`[001-lobby] prefers-reduced-motion: ${pageReduced ? 'reduce' : 'no-preference'}${pageReduced && !FORCED_REDUCED ? ' (set by this desktop, not by LOBBY_REDUCED)' : ''}`);
    REDUCED = pageReduced;
    assert.deepStrictEqual(order, ['library', 'software', 'terminal', 'web', 'boss', 'other', 'coffee', 'bank', 'postbox'], `${w} ${theme}: lobby order, the Boss in the middle`);
    const boss = await tile('boss'), want = await askers(), inbox = await inboxNames();
    const queue = boss.label.replace(/^[^:]+: /, '').replace(/\. Longest wait.*$/, '').split('; ').map((x) => x.replace(/ \(.*$/, ''));
    assert.ok(want.length >= 3, `${w}: the simulator has agents with a question or a permission: ${want}`);
    assert.deepStrictEqual([...queue].sort(), [...want].sort(), `${w} ${theme}: the Boss's queue is exactly the agents with a question or a permission`);
    assert.deepStrictEqual(queue, inbox.filter((n) => want.includes(n)), `${w} ${theme}: queue order = the inbox's order (who came first)`);
    assert.strictEqual(Number(boss.count), want.length, `${w}: the Boss counts its queue`);
    assert.ok(/^(<1 min|\d+ min|\d+ h( \d+ min)?)$/.test(boss.wait), `${w}: the longest wait in the header: ${boss.wait}`);
    assert.ok(boss.pv.length >= 2 && boss.pv.every((v) => v.go && (v.ask === 'q' || v.ask === 'p')), `${w}: queue entries are buttons with a kind: ${JSON.stringify(boss.pv)}`);
    assert.strictEqual(boss.pv.length + (boss.more ? Number(boss.more.replace('+', '')) : 0), want.length, `${w}: entries + "+N" = the queue`);
    const badges = await js(`[...document.querySelectorAll('#walkers .walker[data-ask] .wb')].map(b=>b.closest('.walker').dataset.ask)`);
    assert.strictEqual(badges.length, boss.pv.length, `${w}: one badge per figure at the Boss`);
    assert.deepStrictEqual(badges, boss.pv.map((v) => v.ask), `${w}: each figure's badge is its entry's kind`);
    assert.ok(/: question/.test(boss.label) && /: asks for your OK/.test(boss.label), `${w}: the queue holds a question and a permission (simquestion=1): ${boss.label}`);
    const marks = await js(`[...document.querySelectorAll('#walkers .walker[data-ask] .wb')].map(b=>b.closest('.walker').dataset.ask==='q'?b.textContent:(b.querySelector('svg')?'key':''))`);
    assert.ok(marks.every((m) => m === '?' || m === 'key'), `${w}: ? for a question, a key for a permission: ${marks}`);
    const desks = await js(`[...document.querySelectorAll('#stage .desk.is-away[data-place="boss"]')].map(d=>({n:d.querySelector('.name').textContent.trim(),t:(d.querySelector('.intent,.task')||{}).textContent||''}))`);
    assert.strictEqual(desks.length, want.length, `${w}: every agent in the queue left an empty chair`);
    assert.ok(desks.every((d) => /^Went to .+ · /.test(d.t) && (theme !== 'clean-office' || /^Went to see the boss · /.test(d.t))), `${w}: the desk's note: ${JSON.stringify(desks)}`);
    /* the Bank: Omar's Durbar cap; the coffee corner: Tomas and Rosa (provider limits) */
    assert.ok(await H.until(`(document.querySelector('#stage .place.bank .pc')||{}).textContent==='1'`, 8000), `${w}: one agent at the Bank`);
    const bank = await tile('bank'), coffee = await tile('coffee');
    assert.ok(/: Omar \(until you raise the limit\)/.test(bank.label), `${w}: Omar waits at the Bank: ${bank.label}`);
    assert.ok(!/Omar/.test(coffee.label) && /Rosa/.test(coffee.label), `${w}: provider limits in the coffee corner, not the cap: ${coffee.label}`);
    const omar = await js(`(()=>{const d=[...document.querySelectorAll('#stage .desk[data-id]')].find(x=>x.querySelector('.name').textContent.trim()==='Omar');return d&&{place:d.dataset.place,txt:d.textContent}})()`);
    assert.ok(omar && omar.place === 'bank' && /Limit reached/.test(omar.txt) && !/Coffee break/.test(omar.txt), `${w}: Omar's card says Limit reached: ${JSON.stringify(omar)}`);
    /* the Postbox */
    const post = await tile('postbox');
    assert.strictEqual(post.lines.length, 3, `${w}: the next three runs`);
    SEEDED.forEach((p, i) => assert.ok(post.lines[i].includes(p.slice(0, 12)), `${w}: run ${i} soonest first: ${post.lines[i]}`));
    assert.ok(/^\d+ today$/.test(post.today) && Number(post.today.split(' ')[0]) >= 1, `${w}: letters today: ${post.today}`);
    assert.strictEqual(post.flag, '1 missed', `${w}: the missed run is flagged`);
    assert.ok(/1 missed/.test(post.label) && /Open Settings > Schedules/.test(post.label), `${w}: the Postbox's label: ${post.label}`);
    const words = await js(`[...document.querySelectorAll('#stage .room-head:not(.no-words) .rd')].filter(x=>x.querySelector('.rdw')&&x.querySelector('.rdw').getClientRects().length).map(x=>x.textContent.trim())`);
    assert.ok(words.some((t) => /^\d+ (working|waiting)$/.test(t)), `${w}: a header counts in words: ${words}`);
    let info = await page(`${w} ${theme} 15`);
    const widths = await js(`[...document.querySelectorAll('#stage .lobby .place')].map(p=>p.dataset.place+':'+Math.round(p.getBoundingClientRect().width)).join(' ')`);
    console.log('[001-lobby]', `${w}x${h}`, theme, '15: d=' + info.d, 'minFont=' + info.minFont, 'boss=' + JSON.stringify(queue), 'wait=' + boss.wait, 'tiles=' + widths);
    await H.shot(path.join(OUT, `001-lobby-15-${w}x${h}${tag}.png`), { prep: 'calm', blur: true });

    if (theme === 'clean-office') {
      /* click the first entry: its chat opens with the request in view; answering it sends the figure back to its desk */
      const first = boss.pv[0];
      await js(`document.querySelector('#stage .place.boss .pv[data-pvopen]').click()`);
      await H.until(`document.body.classList.contains('panel-open')`);
      assert.strictEqual(await H.text('#panelTitle', 'textContent'), first.n.length > 2 ? first.n : await nameOf(first.id), `${w}: the entry opens that agent's chat`);
      const inView = await H.until(`(()=>{const c=[...document.querySelectorAll('#chat .note.perm:not(.settled)')][0],ch=document.getElementById('chat');if(!c)return false;const r=c.getBoundingClientRect(),b=ch.getBoundingClientRect();return r.top>=b.top-2&&r.top<b.bottom&&(document.activeElement===c||c.contains(document.activeElement))})()`, 3000);
      assert.ok(inView, `${w}: the request is in view and focused`);
      await H.shot(path.join(OUT, `001-lobby-boss-chat-${w}x${h}.png`), { prep: 'calm' });
      const answered = await js(`(()=>{const c=[...document.querySelectorAll('#chat .note.perm:not(.settled)')][0];if(c.classList.contains('question')){const o=c.querySelector('.q-opt');if(o)o.click();}const b=c.querySelector(':scope > .note-actions .btn.primary');if(!b)return false;b.click();return true})()`);
      assert.ok(answered, `${w}: the request has a primary answer`);
      await H.until(`![...document.querySelectorAll('#chat .note.perm:not(.settled)')].some(c=>c.querySelector(':scope > .note-actions button'))`, 4000);
      await H.click('#backBtn'); await H.office(15);
      const back = await H.until(`!document.querySelector('#stage .place.boss .pv[data-visitor="'+CSS.escape(${q(first.id)})+'"]')`, 3000);
      assert.ok(back, `${w}: once answered it leaves the Boss`);
      assert.ok(await H.until(`!document.querySelector('#stage .desk.is-away[data-id="'+CSS.escape(${q(first.id)})+'"]')`, 4000), `${w}: and is back at its desk`);
      /* the Bank's entry opens the limit card with the raise action */
      await js(`document.querySelector('#stage .place.bank [data-pvopen]').click()`);
      await H.until(`document.body.classList.contains('panel-open')`);
      assert.strictEqual(await H.text('#panelTitle', 'textContent'), 'Omar', `${w}: the Bank's entry opens Omar's chat`);
      assert.ok(await H.until(`!!document.querySelector('#chat .note.perm.limit:not(.settled) .limit-amt')`, 3000), `${w}: with the limit card and its raise action`);
      await H.click('#backBtn'); await H.office(15);
      /* the Postbox opens Settings > Schedules */
      await js(`document.querySelector('#stage .place.postbox').click()`);
      assert.ok(await H.until(`!document.getElementById('screen').hidden&&document.getElementById('schedSet')`, 3000), `${w}: the Postbox opens Settings > Schedules`);
      /* review on #511 (Paco): openSettings('schedules'): the heading is focused and at the top of the screen's own scroller (scrollInBody, spec 052 FR-055); the outer page never scrolls */
      const at = await js(`(()=>{const h=document.getElementById('schH'),sc=h&&h.closest('.scr-body');return {focus:(document.activeElement||{}).id||'',off:h&&sc?Math.round(h.getBoundingClientRect().top-sc.getBoundingClientRect().top):null,scrolled:sc?sc.scrollTop:0,page:[document.documentElement.scrollTop,document.body.scrollTop,window.scrollY]};})()`);
      assert.ok(at.focus === 'schH' && at.off !== null && Math.abs(at.off - 12) <= 2 && at.scrolled > 0 && at.page.every((v) => v === 0), `${w}: Settings opens at Schedules (heading focused, at the top of its scroller, page not scrolled): ${JSON.stringify(at)}`);
      await H.click('#scrClose'); await H.until(`document.getElementById('screen').hidden`);
    }

    /* ---- sparse office ---- */
    await load(3, w, h, tq);
    const sb = await tile('boss');
    assert.ok(sb.pv.length >= 1 && sb.pv[0].go, `${w} ${theme}: the sparse office's Boss shows its visitor`);
    info = await page(`${w} ${theme} 3`);
    console.log(`[001-lobby] ${w}x${h} ${theme} 3: d=${info.d} minFont=${info.minFont} boss=${sb.label}`);
    await H.shot(path.join(OUT, `001-lobby-3-${w}x${h}${tag}.png`), { prep: 'calm', blur: true });
    if (theme === 'clean-office') {
      /* a new permission: an agent at its desk gets up and walks to the Boss (FR-034) */
      const idle = await js(`(window.__durbarSimUi.agents().find(a=>!a.parent&&a.live&&!document.querySelector('#stage .desk.is-away[data-id="'+CSS.escape(a.id)+'"]'))||{}).id`);
      assert.ok(idle, `${w}: an agent at its desk`);
      /* record a walk when it starts (the walk takes about 1 s; a slow runner may poll only after it ended: review on PR 511, Windows CI), then
         wait for the end state: the desk is empty at the Boss and the agent is in the Boss queue */
      await js(`window.__walkSeen=false;window.__walkObs&&window.__walkObs.disconnect();window.__walkObs=new MutationObserver(()=>{if(document.querySelector('#walkers .walker.walking'))window.__walkSeen=true;});window.__walkObs.observe(document.getElementById('walkers'),{childList:true,subtree:true,attributes:true,attributeFilter:['class']})`);
      await emit({ type: 'status', sessionId: idle, status: 'needs-permission', intent: 'Wants to run npm publish', permission: { requestId: 'drv-lobby-' + w, kind: 'shell', summary: 'run npm publish --dry-run', scopeKey: 'shell:npm', scopeLabel: 'run npm', state: 'pending' } });
      const there = await H.until(`!!document.querySelector('#stage .desk.is-away[data-place="boss"][data-id="'+CSS.escape(${q(idle)})+'"]')&&!!document.querySelector('#stage .place.boss [data-visitor="'+CSS.escape(${q(idle)})+'"]')`, 6000);
      const seen = await js(`(window.__walkObs.disconnect(),window.__walkSeen)`);
      const vis = await js(`document.visibilityState+', reduced motion '+matchMedia('(prefers-reduced-motion: reduce)').matches+', figures '+document.querySelectorAll('#walkers .walker').length`);
      assert.ok(there, `${w}: ${await nameOf(idle)} reaches the Boss queue and its desk is empty (visibility ${vis})`);
      assert.strictEqual(seen, !REDUCED, `${w}: ${await nameOf(idle)} ${REDUCED ? 'appears at the Boss with no walk (reduced motion)' : 'walks to the Boss'} (visibility ${vis})`);
      await settleWalk(); await ctx.sleep(300);
      const b2 = await tile('boss'), nm = await nameOf(idle);
      assert.ok(b2.label.includes(nm + ' (') && b2.label.indexOf(nm + ' (') > b2.label.indexOf(sb.label.replace(/^[^:]+: /, '').split(' (')[0] + ' (') && b2.pv.some((v) => v.id === idle), `${w}: ${nm} joins the end of the queue (and is drawn): ${b2.label}`);
      await page(`${w} after a new permission`);
      await H.shot(path.join(OUT, `001-lobby-boss-walk-${w}x${h}.png`), { prep: 'calm', blur: true });
    }
  }

  /* ---- long names (review on #511): entries, the queue and the Postbox lines cut with an ellipsis, nothing leaves its tile ---- */
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await load(15, w, h, { simnames: 'long', simquestion: '1' });
    const cut = await js(`[...document.querySelectorAll('#stage .lobby .pv-n, #stage .lobby .pv-a, #stage .lobby .pb-line, #stage .lobby .pn')].filter(e=>e.scrollWidth>e.clientWidth+0.5).map(e=>getComputedStyle(e).textOverflow)`);
    assert.ok(cut.every((t) => t === 'ellipsis'), `${w}: every cut lobby text ends in an ellipsis: ${cut}`);
    const info = await page(`${w} long names`);
    console.log('[001-lobby]', `${w}x${h}`, 'long names: d=' + info.d, 'cut texts=' + cut.length);
  }

  /* ---- hostile names (review on #511, Paco 23:45 UTC): session titles and a schedule prompt with markup stay text everywhere in the lobby,
     and the desk card's title is masked before its 200-character cut (a token across the cut leaves no piece of itself; spec 041 FR-065) ---- */
  {
    const [w, h] = [1440, 900];
    await load(15, w, h, { simbreak: '8', simquestion: '1' });
    assert.ok(await H.until(`(document.querySelector('#stage .place.bank .pc')||{}).textContent==='1'&&!!document.querySelector('#stage .place.coffee .pv')`, 8000), 'hostile: someone at the Bank and in the coffee corner');
    /* fill the Boss until it shows a "+N" (more permissions from agents at their desks) */
    for (let i = 0; i < 12 && !(await js(`!!document.querySelector('#stage .place.boss .pv-more')`)); i++) {
      const idle = await js(`(window.__durbarSimUi.agents().find(a=>!a.parent&&a.live&&!a.coffee&&!a.limit&&!document.querySelector('#stage .desk.is-away[data-id="'+CSS.escape(a.id)+'"]'))||{}).id`);
      if (!idle) break;
      await emit({ type: 'status', sessionId: idle, status: 'needs-permission', intent: 'Wants to run npm publish', permission: { requestId: 'drv-hostile-' + i, kind: 'shell', summary: 'run npm publish --dry-run', scopeKey: 'shell:npm', scopeLabel: 'run npm', state: 'pending' } });
      await H.until(`!!document.querySelector('#stage .place.boss [data-visitor="'+CSS.escape(${q(idle)})+'"]')`, 4000); await ctx.sleep(200);
    }
    assert.ok(await js(`!!document.querySelector('#stage .place.boss .pv-more')`), 'hostile: the Boss shows a "+N"');
    await settleWalk();
    const hostile = (n) => `<img src=x onerror="window.__pwn=${n}"><b>Mal${n}</b>`;
    const at = await js(`(()=>{const q=s=>[...document.querySelectorAll(s)].map(e=>e.dataset.visitor);return {boss:q('#stage .place.boss .pv[data-visitor]'),bank:q('#stage .place.bank .pv[data-visitor]'),coffee:q('#stage .place.coffee .pv[data-visitor]')}})()`);
    const rest = await js(`(()=>{const shown=new Set([...document.querySelectorAll('#stage .place.boss .pv[data-visitor]')].map(e=>e.dataset.visitor));return window.__durbarSimUi.agents().filter(a=>!a.parent&&a.live&&!shown.has(a.id)&&!!document.querySelector('#stage .desk.is-away[data-place="boss"][data-id="'+CSS.escape(a.id)+'"]')).map(a=>a.id)})()`);
    assert.ok(at.boss.length && at.bank.length && at.coffee.length && rest.length, `hostile: visitors everywhere and one inside "+N": ${JSON.stringify({ ...at, rest })}`);
    const targets = [at.boss[0], at.bank[0], at.coffee[0], rest[0]];
    for (const [i, id] of targets.entries()) await emit({ type: 'title', sessionId: id, title: hostile(i + 1) });
    const folder = await js(`(()=>{const a=window.__durbarSimUi.agents().find(a=>!a.parent&&a.live);return a?(a.info.workspaceFile||a.info.cwd||''):''})()`);
    const saved = await js(`window.__durbarSimUi.bridge().saveSchedule({folder:${q(folder)},prompt:${q(hostile(9) + ' sweep')},at:Date.now()+60000})`);
    assert.ok(saved && saved.ok !== false, `hostile: the schedule is saved: ${JSON.stringify(saved)}`);
    assert.ok(await H.until(`[...document.querySelectorAll('#stage .place.boss .pv-n, #stage .place.bank .pv-n, #stage .place.coffee .pv-n')].some(e=>e.textContent.includes('<img'))&&(document.querySelector('#stage .place.postbox').getAttribute('aria-label')||'').includes('<img src=x')`, 6000), 'hostile: the new names and the prompt are drawn');
    await settleWalk();
    const none = `!document.querySelector('#stage img, #walkers img, #modeMenu img')&&![...document.querySelectorAll('#stage b, #walkers b, #modeMenu b')].some(b=>/^Mal\\d$/.test(b.textContent))&&window.__pwn===undefined`;
    assert.ok(await js(none), 'hostile: no element created in the office or the walkers, nothing ran');
    const seen = await js(`(()=>{const tx=s=>[...document.querySelectorAll(s)].map(e=>e.textContent),lb=s=>[...document.querySelectorAll(s)].map(e=>(e.getAttribute('aria-label')||'')+' | '+(e.title||''));
      return {entries:tx('#stage .lobby .pv-n'),labels:lb('#stage .lobby .place, #stage .lobby .pv, #stage .lobby .pv-more'),post:tx('#stage .place.postbox .pb-line')}})()`);
    for (const n of [1, 2, 3]) assert.ok(seen.labels.some((l) => l.includes(hostile(n))), `hostile: tile label or tooltip ${n} shows the literal title: ${JSON.stringify(seen.labels)}`);
    assert.ok(seen.entries.filter((e) => e.includes('<img src=x')).length >= 1 || seen.entries.some((e) => e.startsWith('<')), `hostile: an entry shows the literal name: ${JSON.stringify(seen.entries)}`);
    assert.ok(seen.post.some((l) => l.includes('<img src=x')), `hostile: the Postbox line shows the literal prompt: ${JSON.stringify(seen.post)}`);
    /* the "+N" list (#modeMenu): the hidden visitor's literal name, no element */
    await js(`document.querySelector('#stage .place.boss .pv-more').click()`);
    assert.ok(await H.until(`!!document.getElementById('modeMenu')`, 3000), 'hostile: the "+N" list opens');
    const menu = await js(`[...document.querySelectorAll('#modeMenu [data-pvopen] b')].map(b=>b.textContent)`);
    assert.ok(menu.includes(hostile(4)), `hostile: the "+N" list shows the literal title: ${JSON.stringify(menu)}`);
    assert.ok(await js(none), 'hostile: no element created in the "+N" list, nothing ran');
    await js(`document.getElementById('modeMenu').querySelector('[data-pvopen]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    await H.until(`!document.getElementById('modeMenu')`, 2000);
    /* a token across the desk title's 200th character: masked first, then cut, so no piece of it is left */
    const tok = 'ghp_' + 'Q7'.repeat(18);
    const desk = await js(`(window.__durbarSimUi.agents().find(a=>!a.parent&&a.live&&!a.coffee&&!a.limit&&!document.querySelector('#stage .desk.is-away[data-id="'+CSS.escape(a.id)+'"]'))||{}).id`);
    await emit({ type: 'status', sessionId: desk, status: 'working', intent: 'MARKSTART' });
    assert.ok(await H.until(`(document.querySelector('#stage .desk[data-id="'+CSS.escape(${q(desk)})+'"]')||{title:''}).title.includes('MARKSTART')`, 4000), 'token: the desk title shows the task');
    const pre = await js(`document.querySelector('#stage .desk[data-id="'+CSS.escape(${q(desk)})+'"]').title.indexOf('MARKSTART')`);
    const pad = Math.max(0, 200 - pre - 12);
    await emit({ type: 'status', sessionId: desk, status: 'working', intent: 'x'.repeat(pad) + ' ' + tok + ' and more after it' });
    assert.ok(await H.until(`!(document.querySelector('#stage .desk[data-id="'+CSS.escape(${q(desk)})+'"]')||{title:'MARKSTART'}).title.includes('MARKSTART')`, 4000), 'token: the desk title has the new task');
    const dt = await js(`(()=>{const d=document.querySelector('#stage .desk[data-id="'+CSS.escape(${q(desk)})+'"]');return {title:d.title,label:d.getAttribute('aria-label')}})()`);
    const head = dt.title.split('…')[0];
    assert.ok(head.length >= 190 && !/ghp_|Q7Q7/.test(dt.title) && !/ghp_|Q7Q7/.test(dt.label), `token: no piece of the token in the desk title or label: ${JSON.stringify(dt)}`);
    console.log('[001-lobby] hostile names: text only; token across the desk title cut: masked');
  }

  /* ---- a schedule fires: one letter flies from the Postbox to that desk (none under reduced motion) ---- */
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await hload({ w, h, query: { sim: '15', simsched: '1', simschedfire: '6' }, ready: `document.querySelectorAll('#stage .desk[data-id]').length>=15&&!!document.querySelector('#stage .place.postbox')` });
    await js(`window.__letters=0;new MutationObserver(m=>m.forEach(r=>r.addedNodes.forEach(n=>{if(n.classList&&n.classList.contains('letter'))window.__letters++;}))).observe(document.getElementById('walkers'),{childList:true})`);
    assert.ok(await H.until(`(document.querySelector('#stage .place.postbox').getAttribute('aria-label')||'').includes('Scheduled check-in')`, 4000), `${w}: the one-off run is listed`);
    if (!REDUCED) {
      assert.ok(await H.until(`!!document.querySelector('#walkers .letter.flying')`, 12000), `${w}: a letter flies when the schedule fires`);
      await ctx.sleep(250);
      await H.shot(path.join(OUT, `001-lobby-letter-${w}x${h}.png`), { prep: 'calm', blur: true });
      assert.ok(await H.until(`!document.querySelector('#walkers .letter')`, 3000), `${w}: the letter is gone after it lands`);
      assert.strictEqual(await js(`window.__letters`), 1, `${w}: exactly one letter`);
    } else {
      await H.until(`!(document.querySelector('#stage .place.postbox').getAttribute('aria-label')||'').includes('Scheduled check-in')`, 12000);
      await ctx.sleep(1500);
      assert.strictEqual(await js(`window.__letters`), 0, `${w}: no letter under reduced motion`);
    }
    assert.ok(await H.until(`!(document.querySelector('#stage .place.postbox').getAttribute('aria-label')||'').includes('Scheduled check-in')`, 4000), `${w}: the fired run leaves the Postbox`);
  }
  console.log(`[001-lobby] all checks passed${REDUCED ? ' (reduced motion)' : ''}`);
};
