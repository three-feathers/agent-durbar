/*
 * Spec 001 FR-034..FR-038: the office rail (Needs you, Scheduled, How to read this), who is at a place (names and what they do there)
 * and the room header words. Simulator only (no credits): `simsched=1` seeds three schedules; tool starts are sent through the
 * simulator's test hook. Checks, at 1440x900 and 1280x800, 15 agents and a sparse office (3), Clean Office and Retro (the one theme with
 * a dark page): the rail lists exactly the inbox's agents in its order and the schedules soonest first; a row opens the chat or the
 * folder's Schedules; the strip opens the inbox and Settings; place entries name their visitors with the masked activity; +N lists
 * everyone; eight places switch to initials; the coffee corner (spec 068, `simbreak=8`) uses the same entries; the office page rules (overlap, clipping, no scroll, text >= 10.5px) hold. Linux:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-001-rail.js xvfb-run -a npx electron . --no-sandbox
 */
const assert = require('assert');
const path = require('path');
const { pageCheck } = require('./check-office-overlap.js');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';
const q = jsLiteral; /* every value spliced into page code goes through jsLiteral (CodeQL js/bad-code-sanitization) */
const SECRET = 'S3cr3tV4lue9xQzz';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const js = (c) => H.js(c);
  const emit = (e) => js(`window.__durbarSimEmit(Object.assign({timestamp:Date.now()},${q(e)}))`);
  const page = async (label, places = 5) => { const r = await js(`(${pageCheck.toString()})(false, ${q(places)})`); assert.deepStrictEqual(r.problems, [], `${label}: office page rules`); return r.info; };
  const settleWalk = () => H.until(`!document.querySelector('.walker.walking')`, 6000);
  const load = async (n, w, h, extra = {}) => {
    await js(`(()=>{try{localStorage.removeItem('durbar.railLegend')}catch(e){}})()`); /* the legend's first view */
    await H.load({ w, h, query: { sim: String(n), simsched: '1', ...extra }, ready: `document.querySelectorAll('#stage .desk[data-id]').length>=${q(n)}&&!document.getElementById('rail').hidden` });
    await H.until(`document.querySelector('#stage .place.busy')`, 6000); await settleWalk(); await ctx.sleep(300);
  };
  const rail = () => js(`(()=>{const r=document.getElementById('rail');return {mode:r.dataset.mode,need:[...r.querySelectorAll('[data-railneed]')].map(b=>b.querySelector('.rl-n').firstChild.textContent),needMore:(r.querySelector('.rl-need .rl-more')||{}).textContent||'',needCount:(r.querySelector('.rl-need .rl-c')||{}).textContent,sched:[...r.querySelectorAll('[data-railsched]')].map(b=>b.querySelector('.rl-p').textContent),legendOpen:!!(r.querySelector('.rl-legend')||{}).open,strip:[...r.querySelectorAll('.rs-btn')].map(b=>({k:b.dataset.rail,n:b.querySelector('b').textContent,label:b.getAttribute('aria-label')}))}})()`);
  const inboxNames = async () => {
    await js(`document.getElementById('inboxBtn').click()`); await H.until(`document.getElementById('inboxDlg')`);
    const names = await js(`[...document.querySelectorAll('#inboxDlg .inbox-row')].map(r=>r.querySelector('.ib-h b').textContent.trim())`);
    await js(`document.getElementById('inboxClose').click()`); await H.until(`!document.getElementById('inboxDlg')`);
    return names;
  };
  const entries = () => js(`[...document.querySelectorAll('#stage .place')].map(p=>({id:p.dataset.place,mode:p.dataset.chips,count:(p.querySelector('.pc')||{}).textContent||'',label:p.getAttribute('aria-label'),pv:[...p.querySelectorAll('.pv:not(.pv-more)')].map(e=>({id:e.dataset.visitor,n:e.querySelector('.pv-n').textContent,a:(e.querySelector('.pv-a')||{}).textContent||'',title:e.title,font:Math.min(...[...e.querySelectorAll('.pv-n,.pv-a')].map(t=>parseFloat(getComputedStyle(t).fontSize)))})),more:(p.querySelector('.pv-more .slot')||{}).textContent||''}))`);
  const names = () => js(`Object.fromEntries(window.__durbarSimUi.agents().map(a=>[a.id,a.name]))`);
  const SEEDED = ['PR and issue sweep', 'Cut the pre-release notes', 'Morning summary of failing checks'];

  for (const theme of ['clean-office', 'retro']) for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tq = theme === 'clean-office' ? {} : { theme };
    const tag = theme === 'clean-office' ? '' : '-' + theme;
    /* ---- 15 agents ---- */
    await load(15, w, h, tq);
    let r = await rail();
    const st = await js(`({d:document.getElementById('stage').dataset.d,fit:document.getElementById('stage').dataset.fit})`);
    assert.ok(r.mode === 'strip' || (st.fit === 'ok' && st.d !== 'micro'), `${w} ${theme}: the full rail only when the office fits at mini or richer (FR-035): ${r.mode} ${JSON.stringify(st)}`);
    const inbox = await inboxNames();
    assert.ok(inbox.length >= 4, `${w}: the simulator has agents that need you: ${inbox}`);
    if (r.mode === 'rail') {
      assert.ok(r.need.length >= 2 && r.need.length <= 6, `${w}: 2 to 6 rows`);
      assert.deepStrictEqual(r.need, inbox.slice(0, r.need.length), `${w} ${theme}: Needs you lists the inbox, same order`);
      assert.strictEqual(r.needMore, r.need.length < inbox.length ? `+${inbox.length - r.need.length} more` : '', `${w}: the rest under "+N more"`);
      assert.strictEqual(Number(r.needCount), inbox.length);
      assert.ok(r.sched.length >= 2, `${w}: the schedules`);
      SEEDED.slice(0, r.sched.length).forEach((p, i) => assert.ok(r.sched[i].startsWith(p.slice(0, 20)), `${w}: schedule ${i} soonest first: ${r.sched[i]}`));
      assert.ok(r.legendOpen, `${w}: the legend is open on its first view`);
    } else {
      assert.deepStrictEqual(r.strip.map((b) => [b.k, b.n]), [['inbox', String(inbox.length)], ['schedset', '3']], `${w}: the strip's two counts`);
      assert.ok(inbox.every((n) => r.strip[0].label.includes(n)), `${w}: the strip's Needs you names every agent in its label`);
    }
    let info = await page(`${w} ${theme} 15`);
    console.log(`[001-rail] ${w}x${h} ${theme} 15: rail=${r.mode} d=${info.d} minFont=${info.minFont}`);
    /* who is at a place: names, masked activity, counts (FR-036) */
    const nm = await names();
    const working = await js(`window.__durbarSimUi.agents().filter(a=>!a.parent&&(a.state==='working'||a.state==='thinking')&&!document.querySelector('#stage .place[data-place="terminal"] .pv[data-visitor="'+CSS.escape(a.id)+'"]')).map(a=>a.id)`);
    assert.ok(working.length >= 3, 'three working agents to send to the Terminal');
    const cmds = ['npm run lint', `curl -H "Authorization: Bearer ${SECRET}" https://api.example.com/v1`, 'gh pr list'];
    for (let i = 0; i < 3; i++) await emit({ type: 'toolCall', sessionId: working[i], callId: 'rail-' + i, tool: 'bash', phase: 'start', args: { command: cmds[i] } });
    await ctx.sleep(900); await H.until(`document.querySelectorAll('#stage .place[data-place="terminal"] .pv').length>=2`, 6000); await settleWalk(); await ctx.sleep(300);
    const ent = await entries();
    const term = ent.find((p) => p.id === 'terminal');
    const termN = term.pv.length + (term.more ? Number(term.more.replace('+', '')) : 0);
    assert.ok(termN >= 3 && Number(term.count) === termN, `${w}: the Terminal counts its visitors: ${term.count} / ${termN}`);
    for (const p of ent) for (const v of p.pv) {
      assert.ok(v.font >= 10.5, `${w}: entry text ${v.font}px`);
      assert.ok(v.title.startsWith(nm[v.id]), `${w}: the tooltip names ${nm[v.id]}: ${v.title}`);
      assert.ok(!v.title.includes(SECRET) && !p.label.includes(SECRET), `${w}: no secret at a place`);
      if (p.mode === 'named') { assert.strictEqual(v.n, nm[v.id], `${w}: the entry shows the name`); assert.ok(v.a.length > 0, `${w}: the entry shows what ${v.n} does`); }
    }
    const lint = term.pv.find((v) => v.id === working[0]);
    if (lint) assert.strictEqual(lint.a, 'npm run lint', `${w}: the activity is the command without the verb`);
    const all = await js(`(${q(working.slice(0, 3))}).every(id=>document.querySelector('#stage .place[data-place="terminal"]').getAttribute('aria-label').includes(window.__durbarSimUi.agents().find(a=>a.id===id).name))`);
    assert.ok(all, `${w}: the Terminal's label names every visitor`);
    if (term.more) {
      await js(`document.querySelector('#stage .place[data-place="terminal"] .pv-more').click()`); await H.until(`document.getElementById('modeMenu')`);
      const items = await js(`[...document.querySelectorAll('#modeMenu [data-pvopen]')].map(b=>b.querySelector('b').textContent)`);
      assert.strictEqual(items.length, termN, `${w}: +N lists every visitor`);
      await js(`document.querySelector('#modeMenu [data-pvopen]').click()`); await H.until(`document.body.classList.contains('panel-open')`);
      assert.strictEqual(await H.text('#panelTitle', 'textContent'), items[0], `${w}: choosing a visitor opens its chat`);
      await H.click('#backBtn'); await H.office(15);
    }
    /* room header words (FR-037): some header shows "N working" in words */
    const words = await js(`[...document.querySelectorAll('#stage .room-head:not(.no-words) .rd')].filter(x=>x.querySelector('.rdw')&&x.querySelector('.rdw').getClientRects().length).map(x=>x.textContent.trim())`);
    assert.ok(words.some((t) => /^\d+ working$/.test(t)), `${w}: a header says "N working": ${words}`);
    info = await page(`${w} ${theme} 15 with visitors`);
    await H.shot(path.join(OUT, `001-rail-15-${w}x${h}${tag}.png`), { prep: 'calm', blur: true });
    /* click-through */
    if (r.mode === 'rail') {
      await js(`document.querySelector('#rail [data-railneed]').click()`); await H.until(`document.body.classList.contains('panel-open')`);
      assert.strictEqual(await H.text('#panelTitle', 'textContent'), r.need[0], `${w}: a Needs you row opens that chat`);
      await H.click('#backBtn'); await H.office(15);
      const room = await js(`document.querySelector('#rail [data-railsched]').dataset.railsched`);
      await js(`document.querySelector('#rail [data-railsched]').click()`); await H.until(`document.getElementById('schedDlg')`);
      assert.strictEqual(await js(`document.getElementById('schedDlg').dataset.room`), room, `${w}: a schedule row opens that folder's Schedules`);
      await H.click('#scClose'); await H.until(`!document.getElementById('schedDlg')`);
      await js(`document.querySelector('#rail .rl-foot').click()`); await H.until(`document.getElementById('inboxDlg')`);
      await js(`document.getElementById('inboxClose').click()`); await H.until(`!document.getElementById('inboxDlg')`);
    } else {
      await js(`document.querySelector('#rail [data-rail="inbox"]').click()`); assert.ok(await H.until(`document.getElementById('inboxDlg')`), `${w}: the strip opens the inbox`);
      await js(`document.getElementById('inboxClose').click()`); await H.until(`!document.getElementById('inboxDlg')`);
      await js(`document.querySelector('#rail [data-rail="schedset"]').click()`);
      assert.ok(await H.until(`!document.getElementById('screen').hidden&&document.getElementById('schedSet')`), `${w}: the strip opens Settings > Schedules`);
      await H.click('#scrClose'); await H.until(`document.getElementById('screen').hidden`);
    }
    /* ---- sparse office: the full rail at both sizes ---- */
    await load(3, w, h, tq);
    r = await rail();
    assert.strictEqual(r.mode, 'rail', `${w} ${theme}: a sparse office has the full rail`);
    info = await page(`${w} ${theme} 3`);
    console.log(`[001-rail] ${w}x${h} ${theme} 3: rail=${r.mode} d=${info.d} minFont=${info.minFont}`);
    const sw = await js(`[...document.querySelectorAll('#stage .rd .rdw')].filter(x=>x.getClientRects().length).length`);
    assert.ok(sw > 0, `${w}: the sparse office's header shows its words`);
    await H.shot(path.join(OUT, `001-rail-3-${w}x${h}${tag}.png`), { prep: 'calm', blur: true });
  }

  /* ---- a narrow window: the strip (FR-035) and its two buttons ---- */
  {
    const [w, h] = [1100, 800];
    await load(15, w, h);
    const r = await rail(), inbox = await inboxNames();
    assert.strictEqual(r.mode, 'strip', `${w}: 15 agents in a narrow window fold the rail to the strip`);
    assert.deepStrictEqual(r.strip.map((b) => [b.k, b.n]), [['inbox', String(inbox.length)], ['schedset', '3']], `${w}: the strip's two counts`);
    assert.ok(inbox.every((n) => r.strip[0].label.includes(n)), `${w}: the strip's Needs you names every agent in its label`);
    const info = await page(`${w} strip`);
    console.log(`[001-rail] ${w}x${h} 15: rail=${r.mode} d=${info.d} fit=${info.fit} minFont=${info.minFont}`);
    await H.shot(path.join(OUT, `001-rail-strip-${w}x${h}.png`), { prep: 'calm', blur: true });
    await js(`document.querySelector('#rail [data-rail="inbox"]').click()`); assert.ok(await H.until(`document.getElementById('inboxDlg')`), `${w}: the strip opens the inbox`);
    await js(`document.getElementById('inboxClose').click()`); await H.until(`!document.getElementById('inboxDlg')`);
    await js(`document.querySelector('#rail [data-rail="schedset"]').click()`);
    assert.ok(await H.until(`!document.getElementById('screen').hidden&&document.getElementById('schedSet')`), `${w}: the strip opens Settings > Schedules`);
    await H.click('#scrClose'); await H.until(`document.getElementById('screen').hidden`);
  }

  /* ---- eight places: initials where two named entries do not fit (FR-036) ---- */
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await load(15, w, h, { simplaces: '3' });
    const working = await js(`window.__durbarSimUi.agents().filter(a=>!a.parent&&(a.state==='working'||a.state==='thinking')&&!document.querySelector('#stage .place[data-place="terminal"] .pv[data-visitor="'+CSS.escape(a.id)+'"]')).map(a=>a.id)`);
    for (let i = 0; i < 3; i++) await emit({ type: 'toolCall', sessionId: working[i], callId: 'p8-' + i, tool: 'bash', phase: 'start', args: { command: 'npm test' } });
    await ctx.sleep(900); await settleWalk(); await ctx.sleep(300);
    const ent = await entries(), nm = await names();
    const ini = ent.filter((p) => p.mode === 'initials' && p.pv.length);
    assert.ok(ini.length > 0, `${w}: eight places use initials where names do not fit: ${JSON.stringify(ent.map((p) => [p.id, p.mode, p.pv.length]))}`);
    ini.forEach((p) => p.pv.forEach((v) => { assert.ok(v.n.length <= 2 && v.n.length > 0, `${w}: initials ${v.n}`); assert.ok(v.title.startsWith(nm[v.id]), `${w}: the full name in the tooltip`); }));
    const info = await page(`${w} eight places`, 8);
    console.log(`[001-rail] ${w}x${h} eight places: d=${info.d} initials tiles=${ini.length}`);
    await H.shot(path.join(OUT, `001-rail-places8-${w}x${h}.png`), { prep: 'calm', blur: true });
  }
  /* ---- the coffee corner (spec 068) on the rail's place tiles: the same entries, count, label and +N (2026-10-22, night stack) ---- */
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await load(15, w, h, { simbreak: '8' });
    assert.ok(await H.until(`document.querySelectorAll('#stage .place[data-place="coffee"] .pv').length>=1&&(document.querySelector('#stage .place[data-place="coffee"] .pc')||{}).textContent==='3'`, 8000), `${w}: three agents on a break in the coffee corner`);
    await settleWalk(); await ctx.sleep(300);
    const ent = await entries(), nm = await names();
    assert.strictEqual(ent[ent.length - 1].id, 'coffee', `${w}: the coffee corner is the last tile`);
    const cf = ent[ent.length - 1];
    const cfN = cf.pv.length + (cf.more ? Number(cf.more.replace('+', '')) : 0);
    assert.ok(cf.pv.length >= 1 && cfN === 3 && Number(cf.count) === 3, `${w}: the corner shows a visitor and counts all three: ${JSON.stringify(cf)}`);
    assert.ok(/^Coffee corner: /.test(cf.label) && /Omar \(until you raise the limit\)/.test(cf.label) && /Rosa \(until the limit resets\)/.test(cf.label), `${w}: the corner's label says who and until when: ${cf.label}`);
    for (const v of cf.pv) {
      assert.ok(v.font >= 10.5, `${w}: corner entry text ${v.font}px`);
      assert.ok(v.title.startsWith(nm[v.id]) && /\(until /.test(v.title), `${w}: the corner entry's tooltip names ${nm[v.id]} and until when: ${v.title}`);
      if (cf.mode === 'named') { assert.strictEqual(v.n, nm[v.id]); assert.ok(/^until /.test(v.a), `${w}: the entry says until when, not a tool: ${v.a}`); }
      else assert.ok(v.n.length > 0 && v.n.length <= 2, `${w}: initials ${v.n}`);
    }
    if (cf.more) {
      await js(`document.querySelector('#stage .place[data-place="coffee"] .pv-more').click()`); await H.until(`document.getElementById('modeMenu')`);
      const items = await js(`[...document.querySelectorAll('#modeMenu [data-pvopen]')].map(b=>b.querySelector('b').textContent)`);
      assert.strictEqual(items.length, 3, `${w}: +N at the corner lists everyone on a break`);
      await js(`document.querySelector('#modeMenu [data-pvopen]').click()`); await H.until(`document.body.classList.contains('panel-open')`);
      assert.strictEqual(await H.text('#panelTitle', 'textContent'), items[0], `${w}: choosing one opens its chat`);
      await H.click('#backBtn'); await H.office(15);
    }
    const info = await page(`${w} coffee corner`);
    console.log(`[001-rail] ${w}x${h} coffee corner: mode=${cf.mode} shown=${cf.pv.length} more=${cf.more || 0} d=${info.d}`);
    await H.shot(path.join(OUT, `001-rail-coffee-${w}x${h}.png`), { prep: 'calm', blur: true });
  }
  console.log('[001-rail] all checks passed');
};
