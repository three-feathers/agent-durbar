/*
 * Spec 001 FR-041..FR-046: the office uses the space when there are few agents (grown desks). Simulator only, no credits.
 *
 * Matrix (no helpers, `simhelpers=0`): 1, 2, 4, 6, 10 and 15 agents in 1, 2 and 3 folders (`simrooms=<n>`) at 1280x800, 1440x900 and
 * 1920x1080; spot checks at 1024x700 and 2560x1440 (2 folders) and with the simulator's helpers (its own folders). For every layout:
 *   - the office fits: no page scroll, no floor scroll, `data-fit="ok"`;
 *   - the office page rules of check:office (`pageCheck`: no overlap, nothing outside its room or unit, no clipped icon or cost, text at
 *     least 10.5px, names not cut to nothing);
 *   - a grown desk's text box shows whole lines, at most 8;
 *   - the size never grows when agents are added (same window, same folder count): the grown factor (1.0 when not grown) is not larger
 *     than the one with fewer agents;
 *   - 1 and 2 agents always get grown desks; the simulator's 15 agents (5 folders, helpers) never do at 1440x900 and 1280x800.
 * Then, at 1440x900 and 1280x800 with 3 agents (default folders): a thinking stream shows its newest sentences on the grown desk,
 * streaming text moves nothing, and a finished reply shows its start, with a secret in it masked.
 * Then (FR-047..FR-050, owner 2026-10-22), 1 and 2 agents at 1440x900, 1280x800 and 1920x1080: the desk shows its columns (main, last reply
 *   masked, facts), every grown line is at most 90 characters (measured per line), the columns stay apart and inside the desk, side text is
 *   at least 10.5px, the desk stays at most 92 x 2.5 px tall, streaming moves nothing.
 * Screenshots (simulator, `OUT=<folder>`): 001-fill-{4,6,15}-{1440x900,1280x800}.png (the simulator's own folders and helpers),
 *   001-fill-1-{1440x900,1920x1080}.png (one agent, the columns).
 *
 *   npm run check:office-fill            (builds first; Linux runs it under xvfb)
 */
const assert = require('assert');
const path = require('path');
const { pageCheck } = require('./check-office-overlap.js');
const { helpers, jsLiteral } = require('./driver-helpers');
const q = jsLiteral; /* every value put into page code goes through jsLiteral (CodeQL js/bad-code-sanitization) */
const OUT = process.env.OUT || '';
const SECRET = 'sk-Fill0Secret0Value0123456789';
/* review of #532: `plain` strips `_`, so these must be masked before it (raw text first); each in a Markdown form */
/* FR-048: the longest line (in characters) of any grown desk text, measured per line in the page (a Range per character, grouped by its top) */
function MEASURE(root) {
  let worst = 0;
  for (const el of root.querySelectorAll('.desk.card .intent, .desk.card .gx-t, .desk.card .gx-l, .desk.card .l1 .name')) {
    if (!el.getClientRects().length) continue;
    const box = el.getBoundingClientRect(), tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), rows = new Map(), g = document.createRange();
    for (let t = tw.nextNode(); t; t = tw.nextNode()) for (let i = 0; i < t.data.length; i++) {
      g.setStart(t, i); g.setEnd(t, i + 1); const r = g.getClientRects()[0];
      if (!r || r.bottom <= box.top || r.top >= box.bottom || r.left >= box.right || r.right <= box.left) continue; /* only characters that show (a one-line fact ends in an ellipsis) */
      const k = Math.round(r.top); rows.set(k, (rows.get(k) || 0) + 1);
    }
    for (const v of rows.values()) worst = Math.max(worst, v);
  }
  return worst;
}
const MAX_CHARS = 90; /* owner 2026-10-22: a readable measure, about 80-90 characters a line */
const GHP = 'ghp_' + 'Fill0Token0Value0123456789ab', PAT = 'github_pat_' + '11FILL0TOKEN_value0123456789abcdef';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const js = (c) => H.js(c);
  const emit = (e) => js(`window.__durbarSimEmit(Object.assign({timestamp:Date.now()},${q(e)}))`);
  const load = async (n, w, h, query) => {
    await H.load({ w, h, query: { sim: String(n), ...(query || {}) }, ready: `document.querySelectorAll('#stage .desk[data-id]').length>=${q(n)}&&document.getElementById('stage').dataset.fit` });
    /* lobby visits walk for about a second: measure where the figures stand, as check:office does (a visit may start a moment
       after the load, so wait for one briefly first; none is fine) */
    await H.until(`!!document.querySelector('.place.busy')`, 800);
    assert.ok(await H.until(`!document.querySelector('.walker.walking')`, 6000), 'the walking figures stop');
    await ctx.sleep(250);
    assert.ok(await H.until(`!document.querySelector('.walker.walking')`, 6000), 'the walking figures stop');
    await ctx.sleep(150);
  };
  const state = () => js(`(()=>{const s=document.getElementById('stage'),f=document.getElementById('floor'),de=document.documentElement;
    const ds=[...s.querySelectorAll('.desk[data-id]')].map(e=>e.getBoundingClientRect());
    const lines=[...s.querySelectorAll('.desk.card .intent')].filter(()=>!!s.dataset.grow).map(e=>e.clientHeight/(parseFloat(getComputedStyle(e).lineHeight)||16));
    return {d:s.dataset.d,fit:s.dataset.fit,gf:parseFloat(s.style.getPropertyValue('--gf'))||0,grow:s.dataset.grow||'',desks:ds.length,
      deskH:ds.length?Math.round(Math.min(...ds.map(r=>r.height))):0,deskW:ds.length?Math.round(Math.min(...ds.map(r=>r.width))):0,
      floorScroll:f.scrollHeight>f.clientHeight+1,pageScroll:de.scrollHeight>innerHeight+1||de.scrollWidth>innerWidth+1,
      rooms:s.querySelectorAll('.room').length,lines,used:Math.round(s.getBoundingClientRect().height/f.clientHeight*100),
      gcs:[...s.querySelectorAll('.desk.card')].map(c=>+(c.dataset.gc||1)),measure:s.dataset.grow?(${MEASURE.toString()})(s):0}})()`);
  const page = async () => (await js(`(${pageCheck.toString()})(false, 5)`)).problems;
  const failures = [];
  const check = (cond, msg) => { if (!cond) failures.push(msg); };
  const rows = [];

  const one = async (label, n, w, h, query) => {
    await load(n, w, h, query);
    const st = await state(), problems = await page();
    rows.push(`${label}: ${st.d}${st.gf ? ' f=' + st.gf : ''} desk ${st.deskW}x${st.deskH}, ${st.rooms} rooms, ${st.used}% of the floor`);
    check(st.desks === n, `${label}: ${st.desks} desks, not ${n}`);
    check(st.fit === 'ok' && !st.floorScroll && !st.pageScroll, `${label}: does not fit (fit=${st.fit}, floor scroll ${st.floorScroll}, page scroll ${st.pageScroll})`);
    check(!problems.length, `${label}: ${problems.slice(0, 4).join('; ')}`);
    check(st.lines.every((l) => l <= 8.01 && Math.abs(l - Math.round(l)) < 0.02), `${label}: grown text boxes of ${st.lines.map((l) => l.toFixed(2)).join(', ')} lines`);
    if (st.gf) check(st.d === 'roomy' && st.gf >= 1.1 && st.gf <= 2.5, `${label}: grown f=${st.gf} on ${st.d}`);
    check(st.measure <= MAX_CHARS, `${label}: a grown desk line of ${st.measure} characters (limit ${MAX_CHARS})`);
    return st;
  };

  /* ---- the matrix, no helpers ---- */
  for (const [w, h] of [[1280, 800], [1440, 900], [1920, 1080]]) {
    for (const k of [1, 2, 3]) {
      let prev = null;
      for (const n of [1, 2, 4, 6, 10, 15]) {
        if (n < k) continue;
        const st = await one(`${n} agents, ${k} folder${k > 1 ? 's' : ''}, ${w}x${h}`, n, w, h, { simrooms: String(k), simhelpers: '0' });
        const f = st.gf || 1;
        if (n <= 2) check(st.gf >= 1.5, `${n} agents at ${w}x${h} in ${k} folders are not grown (f=${st.gf})`);
        if (prev) check(f <= prev.f + 1e-6, `${w}x${h}, ${k} folders: f grew from ${prev.f} (${prev.n} agents) to ${f} (${n} agents)`);
        prev = { n, f };
      }
    }
  }
  /* ---- the smallest and the largest window (FR-045) ---- */
  for (const [w, h] of [[1024, 700], [2560, 1440]]) {
    for (const n of [1, 2, 4, 6, 15]) { const k = n > 1 ? 2 : 1; await one(`${n} agents, ${k} folder${k > 1 ? 's' : ''}, ${w}x${h}`, n, w, h, { simrooms: String(k), simhelpers: '0' }); }
  }
  /* ---- the simulator's own folders and helpers ---- */
  for (const [w, h] of [[1280, 800], [1440, 900], [1920, 1080]]) {
    for (const n of [4, 6, 15]) {
      const st = await one(`${n} agents with helpers, ${w}x${h}`, n, w, h);
      if (n === 15 && w !== 1920) check(!st.gf, `15 agents with helpers at ${w}x${h} are grown`);
      if (OUT && w !== 1920) await ctx.shot(path.join(OUT, `001-fill-${n}-${w}x${h}.png`));
    }
  }

  /* ---- what a grown desk shows (FR-043) ---- */
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await load(3, w, h);
    const st = await state();
    check(!!st.gf, `3 agents at ${w}x${h} are not grown`);
    const rects = () => js(`[...document.querySelectorAll('#stage .desk, #stage .helper, #stage .intent')].map(e=>{const r=e.getBoundingClientRect();return [r.left,r.top,r.width,r.height].map(Math.round).join(',')}).join(';')`);
    const before = await rects();
    await emit({ type: 'thinking', sessionId: 'sim-2', reasoningId: 'fill-r1', delta: '**Checking callers**\n\nA rename here is a breaking change for any client that pins tool names. ' });
    await emit({ type: 'thinking', sessionId: 'sim-2', reasoningId: 'fill-r1', delta: 'So I will list every caller first and keep the old name as an alias for one release. ' });
    for (let i = 0; i < 12; i++) { await emit({ type: 'thinking', sessionId: 'sim-2', reasoningId: 'fill-r1', delta: `Step ${i} of the plan is checked against the tests. ` }); await ctx.sleep(40); }
    await ctx.sleep(400);
    /* the end of the text (the newest words) is inside the box: either all of it fits, or it is bottom-anchored (.over) */
    const t = await js(`(()=>{const e=document.querySelector('#stage .desk[data-id="sim-2"] .intent');if(!e)return null;const g=document.createRange();g.selectNodeContents(e);const tr=g.getBoundingClientRect(),b=e.getBoundingClientRect();
      return {t:e.textContent,over:e.classList.contains('over'),lk:e.dataset.lk||'',endIn:tr.bottom<=b.bottom+1,allIn:tr.top>=b.top-1}})()`);
    check(t && /Step 11 of the plan is checked against the tests\.$/.test(t.t), `${w}: the newest thinking sentence is last on the grown desk: ${t && t.t}`);
    check(t && /Step 10 of the plan/.test(t.t) && /Step 9 of the plan/.test(t.t), `${w}: the grown desk shows several sentences: ${t && t.t}`);
    check(t && t.lk === 'think' && t.endIn && (t.over || t.allIn), `${w}: the newest lines are in view (${JSON.stringify(t && { lk: t.lk, over: t.over, endIn: t.endIn, allIn: t.allIn })})`);
    check((await rects()) === before, `${w}: streaming text moved a box`);
    const p1 = await page(); check(!p1.length, `${w} streaming: ${p1.join('; ')}`);
    /* a finished turn: the start of the last reply, masked */
    await emit({ type: 'status', sessionId: 'sim-1', status: 'working', intent: 'Working' });
    await emit({ type: 'output', sessionId: 'sim-1', final: true, text: `**Done.** I moved the handlers and kept the public API. The key ${SECRET} was in the old config, so I removed it, with \`${GHP}\` and _${PAT}_.\n\n## Next\n\n- run the filings module` });
    await emit({ type: 'status', sessionId: 'sim-1', status: 'idle' });
    await ctx.sleep(500);
    const d = await js(`(()=>{const e=document.querySelector('#stage .desk[data-id="sim-1"] .intent');return e?e.textContent:''})()`);
    check(/^Done\. I moved the handlers and kept the public API\./.test(d), `${w}: a done desk shows the start of its reply: ${d}`);
    check(!d.includes(SECRET) && /\[redacted\]/.test(d), `${w}: the secret in the reply is masked: ${d}`);
    check(!/Fill0Token0Value|0123456789ab|FILL0TOKEN|value0123456789/.test(d) && (d.match(/\[redacted\]/g) || []).length === 3, `${w}: the ghp_ and github_pat_ tokens are masked too: ${d}`);
  }

  /* ---- FR-047..FR-049 (owner 2026-10-22): one and two agents: the wide grown desk shows more, in columns, with a readable measure ---- */
  for (const [w, h] of [[1440, 900], [1280, 800], [1920, 1080]]) {
    for (const n of [1, 2]) {
      const label = `${n} agent${n > 1 ? 's' : ''} in columns, ${w}x${h}`;
      await load(n, w, h, { simrooms: '1', simhelpers: '0' });
      /* a reply from an earlier turn, a tool and then a long thinking stream on sim-1: main, reply and facts all have something to show */
      await emit({ type: 'output', sessionId: 'sim-1', final: true, text: `**Earlier.** I moved the handlers into registry.ts and kept a thin re-export, so the public API is unchanged. The old key ${SECRET} and \`${GHP}\` were in the config; both are gone now. Next I would run the filings module against the staging data.` });
      await emit({ type: 'toolCall', sessionId: 'sim-1', callId: 'col-' + n, tool: 'view', phase: 'start', args: { path: 'src/tools/registry.ts' } });
      for (let i = 0; i < 10; i++) await emit({ type: 'thinking', sessionId: 'sim-1', reasoningId: 'col-r' + n, delta: `Step ${i}: the request touches a few files, so I read them before changing anything and keep the public API stable for every client. ` });
      await ctx.sleep(600);
      const rects = () => js(`[...document.querySelectorAll('#stage .desk, #stage .desk .gx, #stage .desk .gx-r, #stage .desk .gx-f, #stage .intent')].map(e=>{const r=e.getBoundingClientRect();return [r.left,r.top,r.width,r.height].map(Math.round).join(',')}).join(';')`);
      const st = await state(), problems = await page();
      const c = await js(`(()=>{const d=document.querySelector('#stage .desk.card[data-id="sim-1"]');if(!d)return null;const b=d.getBoundingClientRect(),cols=[d.querySelector('.ci'),d.querySelector('.gx-r'),d.querySelector('.gx-f')].map(e=>e&&e.getClientRects().length?e.getBoundingClientRect():null);
        const font=Math.min(...[...d.querySelectorAll('.gx, .gx *')].filter(e=>e.getClientRects().length&&[...e.childNodes].some(t=>t.nodeType===3&&t.data.trim())).map(e=>parseFloat(getComputedStyle(e).fontSize)));
        const inside=cols.every(r=>!r||(r.left>=b.left-0.5&&r.right<=b.right+0.5&&r.top>=b.top-0.5&&r.bottom<=b.bottom+0.5));
        const apart=cols.every((r,i)=>cols.every((q,j)=>j<=i||!r||!q||r.right<=q.left+0.5||q.right<=r.left+0.5||r.bottom<=q.top+0.5||q.bottom<=r.top+0.5));
        return {gc:+(d.dataset.gc||1),w:Math.round(b.width),h:Math.round(b.height),font,inside,apart,rep:(d.querySelector('.gx-t')||{}).textContent||'',facts:[...d.querySelectorAll('.gx-l')].map(e=>e.textContent)}})()`);
      rows.push(`${label}: f=${st.gf} desk ${c && c.w}x${c && c.h}, ${c && c.gc} columns, longest line ${st.measure} characters`);
      check(st.gf >= 1.5 && c && c.gc >= 2, `${label}: no multi-column desk (f=${st.gf}, ${JSON.stringify(c)})`);
      check(c && c.gc === 3 && /^Earlier\. I moved the handlers/.test(c.rep), `${label}: the reply column shows the last reply (${c && c.gc}: ${c && c.rep})`);
      check(c && !c.rep.includes(SECRET) && !/Fill0Token0Value/.test(c.rep) && (c.rep.match(/\[redacted\]/g) || []).length === 2, `${label}: the reply column is masked: ${c && c.rep}`);
      check(c && c.facts.some((f) => /^Last tool Reading src\/tools\/registry\.ts/.test(f)) && c.facts.some((f) => /^Usage /.test(f)), `${label}: the facts show the tool and the usage: ${c && c.facts.join(' | ')}`);
      check(c && c.inside && c.apart, `${label}: the columns overlap or leave the desk`);
      check(c && c.font >= 10.5, `${label}: side text of ${c && c.font}px`);
      check(c && c.h <= 231, `${label}: the desk is ${c && c.h}px tall (capped at 92 x 2.5)`);
      check(st.measure > 40 && st.measure <= MAX_CHARS, `${label}: longest line ${st.measure} characters (limit ${MAX_CHARS})`);
      check(!problems.length, `${label}: ${problems.slice(0, 4).join('; ')}`);
      const before = await rects();
      for (let i = 10; i < 16; i++) { await emit({ type: 'thinking', sessionId: 'sim-1', reasoningId: 'col-r' + n, delta: `Step ${i} streams in while nothing moves. ` }); await ctx.sleep(40); }
      await ctx.sleep(400);
      check((await rects()) === before, `${label}: streaming text moved a box`);
      if (OUT && n === 1 && (w === 1440 || w === 1920)) await ctx.shot(path.join(OUT, `001-fill-1-${w}x${h}.png`));
    }
  }

  rows.forEach((r) => console.log('[office-fill]', r));
  if (failures.length) { failures.forEach((f) => console.log('[office-fill] FAIL', f)); assert.fail(`${failures.length} problems`); }
  console.log(`[office-fill] all checks passed (${rows.length} layouts)`);
};
