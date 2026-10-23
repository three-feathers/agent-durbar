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
 * Spec 001 FR-051..FR-057 (finished agents rest in the lounge), at 1440x900 and 1280x800: a folder with 2 working agents, 2 that finished
 * minutes ago (couch) and 3 long ago (nap beds), next to a busy folder: the lounge is in the desk row at its height and its width is counted,
 * the bubbles are inside it and >= 10.5px (a masked token), every resting agent is a focusable character button with its label and in the
 * arrow-key order, the dreams take turns (a deterministic tick), the peek card opens beside the lounge without moving anything, Enter
 * opens the chat, the working desks are wider than with the setting off and the row no taller, the couch agents go to bed after 10
 * minutes and past 4 sleepers there is "+N asleep", an agent that starts again gets its desk back; and the simulator's 15 agents (Noor
 * and Maya on the couch) still fit with no scroll and are not grown, the lounge as tall as the desks in its room. FR-051's input in the
 * page (review of #554): a Done agent with a working helper keeps its desk and the helper, and goes back to the couch when the helper
 * finishes; an agent away at a lobby place is not in the lounge.
 * Screenshots: 001-shutters-{1440x900,1280x800}.png and 001-shutters-peek-1440x900.png.
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
/* review of #554: each open desk's scene, in the page: its box inside its card (size and position) and its own flat colours (fills drawn at full
   opacity, not the halo or the glow), to measure how sharp it is drawn */
function SCENES() {
  return [...document.querySelectorAll('#stage .desk.card[data-id]')].map((d) => {
    const s = d.querySelector('svg.scene');
    if (!s || !s.getClientRects().length) return null;
    const c = d.getBoundingClientRect(), r = s.getBoundingClientRect(), flat = new Set();
    s.querySelectorAll('[fill^="#"]').forEach((e) => { const v = e.getAttribute('fill').toLowerCase(); if (v.length === 7 && !e.closest('[opacity],.halo,.glow')) flat.add(v); });
    return { id: d.dataset.id, grown: !!document.getElementById('stage').dataset.grow, card: [c.width, c.height].map((x) => Math.round(x * 100) / 100), rel: [r.left - c.left, r.top - c.top, r.width, r.height].map((x) => Math.round(x * 100) / 100), box: [r.left, r.top, r.width, r.height].map(Math.round), flat: [...flat] };
  }).filter(Boolean);
}
/* issue 576: in the lounge, a resting agent's chat badge must not sit on its name. The name's text box is the range of its text clipped to
   the name element (an ellipsis cuts it); it lists the ids whose badge rect meets it. */
const BADGE_ON_NAME_JS = `[...document.querySelectorAll('#stage .desk.shut')].filter(e=>{const c=e.querySelector('.chatno'),n=e.querySelector('.lg-name');if(!c||!n||!c.getClientRects().length)return false;
  const rg=document.createRange();rg.selectNodeContents(n);const t=rg.getBoundingClientRect(),el=n.getBoundingClientRect(),b=c.getBoundingClientRect();
  const l=Math.max(t.left,el.left),r=Math.min(t.right,el.right),tp=Math.max(t.top,el.top),bt=Math.min(t.bottom,el.bottom);
  return b.left<r&&b.right>l&&b.top<bt&&b.bottom>tp;}).map(e=>e.dataset.id)`;
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

  /* the lounge setting, as a person turns it (Settings) */
  const toggle = async () => { await js(`window.DurbarScreens.openSettings()`); await H.until(`!!document.getElementById('shutSw')`, 4000); await js(`document.getElementById('shutSw').click()`); await H.key('Escape'); await ctx.sleep(500); };
  /* how sharp a scene is drawn: the share (%) of its pixels that are exactly one of its flat colours (+-2 per channel); a blurred drawing
     loses most of them. Under load a capture can show an older frame: read again (up to 3 times) and keep the best */
  const sharp = async (sc) => {
    const cs = sc.flat.map((h) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; });
    let best = 0;
    for (let i = 0; i < 3; i++) {
      if (i) await js(`new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`);
      const img = await ctx.win.webContents.capturePage({ x: sc.box[0], y: sc.box[1], width: Math.max(1, sc.box[2]), height: Math.max(1, sc.box[3]) });
      const buf = img.toBitmap();
      let n = 0;
      for (let k = 0; k < buf.length; k += 4) if (cs.some((c) => Math.abs(c[0] - buf[k + 2]) <= 2 && Math.abs(c[1] - buf[k + 1]) <= 2 && Math.abs(c[2] - buf[k]) <= 2)) n++;
      best = Math.max(best, Math.round((1000 * n) / (buf.length / 4)) / 10);
    }
    return best;
  };
  const looks = async () => { const out = new Map(); for (const sc of await js(`(${SCENES.toString()})()`)) out.set(sc.id, { grown: sc.grown, card: sc.card, rel: sc.rel, sharp: await sharp(sc) }); return out; };

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
      /* FR-053: Noor and Maya (done, each in a folder where others work) roll in; the 15 agents still fit (checked by one()) */
      if (n === 15) { const sh = await js(`[...document.querySelectorAll('#stage .desk.shut')].map(e=>(e.getAttribute('aria-label')||'').split(',')[0]).sort().join(',')`); check(sh === 'Maya,Noor', `15 agents at ${w}x${h}: rolled ${sh}, not Maya,Noor`);
        if (w !== 1920) { const cb = await js(`${BADGE_ON_NAME_JS}.join(',')`); check(cb === '', `15 agents at ${w}x${h}: the chat badge covers the name of ${cb} in the lounge (issue 576)`); }
        const hh = await js(`[...document.querySelectorAll('#stage .lounge')].map(e=>{const d=e.closest('.room').querySelector('.desk.card');return d?Math.abs(e.getBoundingClientRect().height-d.getBoundingClientRect().height):99})`);
        check(hh.every((x) => x <= 1), `15 agents at ${w}x${h}: a rolled agent is not as tall as the desks in its room (${hh})`);
        /* review of #554 (Paco): the lounge changes no working desk's scene. Every desk open with the setting on and off has the same scene box
           inside its card (size and position), and is drawn as sharp (its flat colours, within 3 points); Jonas's scene was drawn blurred
           beside the lounge at 1280x800 (21% against 33%) while its box was the same */
        await H.settle(); await ctx.sleep(300);
        const lon = await looks();
        await toggle(); await H.settle(); await ctx.sleep(300);
        const loff = await looks();
        await toggle();
        check(await H.until(`document.querySelectorAll('#stage .desk.shut').length===2`, 3000), `15 agents at ${w}x${h}: the lounge does not come back on`);
        let same = 0;
        for (const [id, a] of lon) {
          const b = loff.get(id);
          if (!b) continue;
          same++;
          /* a desk of the same size: the same box; a grown desk the lounge made wider (1920x1080): the same rules, i.e. the same aspect, the
             same left inset and centred in its card's height */
          if (a.card.every((x, i) => Math.abs(x - b.card[i]) <= 0.5)) check(a.rel.every((x, i) => Math.abs(x - b.rel[i]) <= 0.5), `15 agents at ${w}x${h}: desk ${id} (${a.card}) has its scene at ${a.rel} with the lounge, ${b.rel} without`);
          else if (a.grown && b.grown) for (const [k, v] of [['on', a], ['off', b]]) check(Math.abs(v.rel[0] - b.rel[0]) <= 0.5 && Math.abs(v.rel[2] / v.rel[3] - b.rel[2] / b.rel[3]) <= 0.01 && Math.abs(v.rel[1] - (v.card[1] - v.rel[3]) / 2) <= 1, `15 agents at ${w}x${h}: desk ${id}'s scene (lounge ${k}) is at ${v.rel} in a ${v.card} card: not the grown desk's aspect, inset or centring`);
          /* a card that is not grown but changed width with the lounge: its scene may sit by design off the card's centre; the box must still be
             inside its card and keep its height within 1 px and its aspect; the sharpness check below applies to every desk */
          else for (const [k, v] of [['on', a], ['off', b]]) check(v.rel[0] >= -0.5 && v.rel[1] >= -0.5 && v.rel[0] + v.rel[2] <= v.card[0] + 0.5 && v.rel[1] + v.rel[3] <= v.card[1] + 0.5 && Math.abs(v.rel[2] / v.rel[3] - b.rel[2] / b.rel[3]) <= 0.01, `15 agents at ${w}x${h}: desk ${id}'s scene (lounge ${k}) is at ${v.rel} in a ${v.card} card: outside the card or another aspect`);
          check(a.sharp >= b.sharp - 3, `15 agents at ${w}x${h}: desk ${id}'s scene is drawn less sharp with the lounge (${a.sharp}% of its pixels in its flat colours, ${b.sharp}% without)`);
        }
        check(same >= 10, `15 agents at ${w}x${h}: only ${same} desks open with the lounge on and off`);
        rows.push(`15 agents at ${w}x${h}: ${same} scenes the same with the lounge on and off (sharpness ${[...lon].map(([id, a]) => id + ' ' + a.sharp + '/' + (loff.get(id) || {}).sharp).join(', ')})`);
      }
      if (OUT && w !== 1920) await ctx.shot(path.join(OUT, `001-fill-${n}-${w}x${h}.png`));
    }
  }

  /* ---- what a grown desk shows (FR-043) ---- */
  /* Ada finishes below while Mira and Jonas work in her folder, so she would roll in (FR-051): this part runs with that setting off */
  await js(`localStorage.setItem('durbar.shutters','off')`);
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

  await js(`localStorage.removeItem('durbar.shutters')`);

  /* ---- finished agents rest in the lounge (FR-051..FR-057) ---- */
  const finish = async (id, text) => {
    await emit({ type: 'status', sessionId: id, status: 'working', intent: 'Working' });
    await emit({ type: 'output', sessionId: id, final: true, text });
    await emit({ type: 'status', sessionId: id, status: 'idle' });
  };
  /* the time an agent finished is its last event (FR-052): set it back, then lay out again (simulator-only hook) */
  const ago = (id, min) => js(`(()=>{const a=window.__durbarSimUi.agents().find(x=>x.id===${q(id)});a.lastEventAt=Date.now()-${q(min)}*60000;window.__durbarSimUi.render();})()`);
  const lounge = () => js(`(()=>{const s=document.getElementById('stage'),room=s.querySelector('.room'),f=document.getElementById('floor'),lg=room.querySelector('.lounge');
    const R=e=>{const r=e.getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width,h:r.height};};
    const rs=[...room.querySelectorAll('.desk.shut')];
    const small=[...s.querySelectorAll('.lounge *')].filter(e=>e.getClientRects().length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).map(e=>parseFloat(getComputedStyle(e).fontSize)).filter(x=>x<10.5);
    const cards=[...room.querySelectorAll('.desk.card, .desk:not(.shut):not(.card)')].map(e=>e.getBoundingClientRect());
    const rm=R(room), L=lg?R(lg):null;
    const bubs=[...room.querySelectorAll('.lg-bub:not(.none)')].map(b=>{const r=R(b),on=b.querySelector('.lg-t.on');return {cls:b.className,in:r.l>=rm.l-0.5&&r.r<=rm.r+0.5&&r.t>=rm.t-0.5&&r.b<=rm.b+0.5&&(!L||(r.l>=L.l-0.5&&r.r<=L.r+0.5)),
      on:on?on.textContent:'',lines:on?(getComputedStyle(on).whiteSpace==='nowrap'?1:Math.min(parseInt(getComputedStyle(on).webkitLineClamp,10)||1,Math.round(on.clientHeight/(parseFloat(getComputedStyle(on).lineHeight)||15)))):0,all:[...b.querySelectorAll('.lg-t')].map(t=>t.textContent),font:on?parseFloat(getComputedStyle(on).fontSize):0,tail:b.style.getPropertyValue('--tail'),tip:b.getAttribute('title')||''};});
    return {d:s.dataset.d,gf:parseFloat(s.style.getPropertyValue('--gf'))||0,fit:s.dataset.fit,floorScroll:f.scrollHeight>f.clientHeight+1,
      open:cards.length,deskW:cards.length?Math.round(Math.min(...cards.map(r=>r.width))):0,deskH:cards.length?Math.round(Math.min(...cards.map(r=>r.height))):0,
      deskTop:cards.length?Math.round(Math.min(...cards.map(r=>r.top))):0,
      recent:rs.filter(e=>e.classList.contains('rest-recent')).map(e=>e.dataset.id),old:rs.filter(e=>e.classList.contains('rest-old')).map(e=>e.dataset.id).sort(),
      labels:rs.map(e=>({id:e.dataset.id,tag:e.tagName,tab:e.tabIndex,l:e.getAttribute('aria-label')||'',inL:!!L&&R(e).l>=L.l-0.5&&R(e).r<=L.r+0.5&&R(e).t>=L.t-0.5&&R(e).b<=L.b+0.5,av:!!e.querySelector('.lg-av svg'),nm:(()=>{const n=e.querySelector('.lg-name'),r=n.getBoundingClientRect(),b=e.getBoundingClientRect();return {t:n.textContent,font:parseFloat(getComputedStyle(n).fontSize),shown:r.width>8&&r.height>=10&&getComputedStyle(n).visibility!=='hidden',in:r.left>=b.left-0.5&&r.right<=b.right+0.5&&r.top>=b.top-0.5&&r.bottom<=b.bottom+0.5};})(),avH:Math.round((e.querySelector('.lg-av')||{getBoundingClientRect:()=>({height:0})}).getBoundingClientRect().height)})),
      small,bubs,roomH:Math.round(rm.h),lg:L?{t:Math.round(L.t),h:Math.round(L.h),w:Math.round(L.w),inRoom:L.l>=rm.l-0.5&&L.r<=rm.r+0.5}:null,
      more:(room.querySelector('.lounge .shut-more')||{}).textContent||'',
      wVar:parseFloat(room.style.getPropertyValue('--w'))||0,cols:parseFloat((room.querySelector('.units-in')||room.querySelector('.units')).style.getPropertyValue('--cols'))||1,
      shw:lg?parseFloat(lg.style.getPropertyValue('--shw'))||0:0}})()`);
  const openShot = (w, h) => (OUT ? ctx.shot(path.join(OUT, `001-shutters-${w}x${h}.png`)) : null);
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `lounge ${w}x${h}`;
    /* 14 agents in 2 folders: Ada, Mira, Jonas, Noor, Elif, Tomas, Priya | Kenji ... Rosa. Ada and Elif work; Mira and Jonas finished
       a few minutes ago (couch); Noor, Tomas and Priya long ago (beds). */
    await load(14, w, h, { simrooms: '2', simhelpers: '0' });
    await finish('sim-2', `**Done.** The edge cases for the canton lookup are listed and tested, key \`${GHP}\` removed.`);
    await finish('sim-3', 'Renamed the tool and kept the old name as an alias for one release.');
    await finish('sim-4', 'The README tool table is updated and linked from the docs index.');
    await finish('sim-6', 'The eval ran again after the rate limit and the baseline is saved.');
    await finish('sim-7', 'Migration 0007 adds the clauses table with an index on the contract id.');
    await ago('sim-4', 25); await ago('sim-6', 50); await ago('sim-7', 70); await ago('sim-3', 4); await ago('sim-2', 2);
    await H.until(`document.querySelectorAll('#stage .desk.shut').length===5`, 4000);
    await ctx.sleep(400);
    const a = await lounge(), problems = await page();
    check(JSON.stringify(a.recent) === '["sim-2","sim-3"]' && JSON.stringify(a.old) === '["sim-4","sim-6","sim-7"]', `${tag}: couch ${a.recent}, beds ${a.old}`);
    check(a.open === 2, `${tag}: ${a.open} open desks in the folder, not 2 (Ada and Elif)`);
    /* FR-052, FR-053: the corner is in the desk row at its height, its width counted by the room */
    check(a.lg && a.lg.inRoom && Math.abs(a.lg.h - a.deskH) <= 1 && Math.abs(a.lg.t - a.deskTop) <= 1 && Math.abs(a.lg.w - a.shw) <= 1, `${tag}: lounge ${JSON.stringify(a.lg)} vs desks ${a.deskH}px at ${a.deskTop}, width ${a.shw}`);
    const CW = { roomy: 262, card: 236, mini: 216, micro: 190 }[a.d] || 0;
    check(a.shw > 0 && a.wVar >= a.cols * CW + a.shw, `${tag}: the room's width (${a.wVar}) does not count the lounge (${a.shw}px) beside ${a.cols} columns of ${CW}px`);
    check(a.fit === 'ok' && !a.floorScroll, `${tag}: does not fit (fit=${a.fit}, floor scroll ${a.floorScroll})`);
    check(!problems.length, `${tag}: ${problems.slice(0, 4).join('; ')}`);
    check(!a.small.length, `${tag}: lounge text under 10.5px: ${a.small.join(', ')}`);
    for (const x of a.labels) {
      check(x.tag === 'BUTTON' && x.tab === 0 && x.inL && x.av, `${tag}: ${x.id} is not a focusable character inside the lounge (${JSON.stringify(x)})`);
      check(/, (resting on the couch|asleep on a nap bed), finished (just now|\d+ (minute|hour|day)s? ago): /.test(x.l) && /[^.]\. Open chat panel\.$/.test(x.l), `${tag}: ${x.id} label "${x.l}"`);
    }
    for (const x of a.labels) check(x.nm.shown && x.nm.in && x.nm.font >= 10.5 && x.l.startsWith(x.nm.t + ','), `${tag}: ${x.id} does not show its name on its character (${JSON.stringify(x.nm)})`);
    { const cb = await js(`${BADGE_ON_NAME_JS}.join(',')`); check(cb === '', `${tag}: the chat badge covers the name of ${cb} (issue 576)`); }
    check(a.labels.filter((x) => a.recent.includes(x.id)).every((x) => x.avH >= (a.lg.h >= 150 ? 44 : 24)), `${tag}: the couch characters are too small for a ${a.lg.h}px lounge (${a.labels.map((x) => x.avH)})`);
    check(/resting on the couch, finished 2 minutes ago: Done\. The edge cases/.test((a.labels.find((x) => x.id === 'sim-2') || {}).l || ''), `${tag}: Mira's label`);
    /* the bubbles: a speech bubble over the couch, a dream cloud over the beds, inside the lounge, >= 10.5px, masked */
    const say = a.bubs.find((b) => /\bsay\b/.test(b.cls)), dream = a.bubs.find((b) => /\bdream\b/.test(b.cls));
    check(say && dream && a.bubs.every((b) => b.in && b.font >= 10.5), `${tag}: bubbles ${JSON.stringify(a.bubs)}`);
    check(a.bubs.every((b) => b.lines >= (a.lg.h - 7 >= 150 ? 3 : a.lg.h - 7 >= 100 ? 2 : 1)), `${tag}: bubbles of ${a.bubs.map((b) => b.lines)} lines in a ${a.lg.h}px lounge`);
    check(say && /^Done\. The edge cases/.test(say.on) && say.all.length === 2, `${tag}: the couch bubble says what Mira did: ${say && say.on}`);
    check(say && !say.all.join(' ').match(/Fill0Token0Value|0123456789ab/) && /\[redacted\]/.test(say.all.join(' ')), `${tag}: the token is masked in the bubble: ${say && say.all}`);
    check(dream && /^z z The README tool table/.test(dream.on) && dream.all.length === 3 && /Noor: .*\nTomas: .*\nPriya: /.test(dream.tip), `${tag}: the dream shows Noor's work first and the tooltip lists every dream: ${dream && dream.on} / ${dream && dream.tip}`);
    /* FR-055: the dreams take turns (the frozen simulator has no timer: one tick moves to the next sleeper, its tail follows) */
    await js(`window.__durbarSimUi.loungeTurn()`);
    const b2 = (await lounge()).bubs.find((b) => /\bdream\b/.test(b.cls)) || {};
    check(/^z z The eval ran again/.test(b2.on || '') && b2.tail === dream.tail, `${tag}: one turn later the dream is Tomas's, in the same bunk as Noor (${b2.on}, tail ${dream && dream.tail} -> ${b2.tail})`);
    await js(`window.__durbarSimUi.loungeTurn()`);
    const b4 = (await lounge()).bubs.find((b) => /\bdream\b/.test(b.cls)) || {};
    check(/^z z Migration 0007/.test(b4.on || '') && b4.tail !== dream.tail, `${tag}: two turns later the dream is Priya's and its tail points at the next bunk (${b4.on}, tail ${dream && dream.tail} -> ${b4.tail})`);
    await js(`window.__durbarSimUi.loungeTurn()`);
    const b3 = (await lounge()).bubs.find((b) => /\bdream\b/.test(b.cls)) || {};
    check(/^z z The README tool table/.test(b3.on || ''), `${tag}: three turns later the dream is Noor's again (${b3.on})`);
    /* keyboard: the arrow keys of FR-019 reach every resting agent */
    const nav = await js(`[...document.querySelectorAll('#stage .desk, #stage .helper, #stage .plate')].filter(x=>x.getClientRects().length).map(x=>x.dataset.id||'')`);
    check(['sim-2', 'sim-3', 'sim-4', 'sim-6', 'sim-7'].every((id) => nav.includes(id)), `${tag}: resting agents missing from the arrow-key order: ${nav}`);
    await openShot(w, h);
    /* hover opens the peek card beside the lounge, inside the room, and nothing moves */
    const rects = () => js(`[...document.querySelectorAll('#stage .desk, #stage .lounge, #stage .lg-bub')].map(e=>{const r=e.getBoundingClientRect();return [r.left,r.top,r.width,r.height].map(Math.round).join(',')}).join(';')`);
    const before = await rects();
    const c = await js(`(()=>{const e=document.querySelector('#stage .desk.shut[data-id="sim-4"]').getBoundingClientRect();return {x:Math.round(e.left+e.width/2),y:Math.round(e.top+e.height/2)}})()`);
    ctx.win.webContents.sendInputEvent({ type: 'mouseMove', x: c.x, y: c.y });
    await ctx.sleep(350);
    const pk = await js(`(()=>{const p=document.querySelector('#stage .desk.shut[data-id="sim-4"] .peek'),room=p.closest('.room').getBoundingClientRect(),r=p.getBoundingClientRect(),f=document.getElementById('floor');
      const g=p.closest('.lounge').getBoundingClientRect();
      return {shown:getComputedStyle(p).display!=='none'&&r.height>0,inRoom:r.left>=room.left-1&&r.right<=room.right+1,side:r.right<=g.left+1||r.left>=g.right-1,text:p.innerText,floorScroll:f.scrollHeight>f.clientHeight+1||f.scrollWidth>f.clientWidth+1}})()`);
    check(pk.shown && pk.inRoom && pk.side && !pk.floorScroll, `${tag}: peek card (beside the lounge, inside the room) ${JSON.stringify(pk)}`);
    check(/^Noor/.test(pk.text) && /finished 25 min ago/.test(pk.text) && /asleep on a nap bed/.test(pk.text) && /README tool table/.test(pk.text), `${tag}: the peek says who, when, where and what: ${pk.text}`);
    check((await rects()) === before, `${tag}: hovering a sleeper moved something`);
    if (OUT && w === 1440) await ctx.shot(path.join(OUT, '001-shutters-peek-1440x900.png'));
    ctx.win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
    /* Enter opens that agent's chat, as on a desk */
    await js(`document.querySelector('#stage .desk.shut[data-id="sim-6"]').focus()`);
    await H.key('Enter');
    check(await H.until(`document.body.classList.contains('panel-open')&&(document.getElementById('panelTitle')||{}).textContent==='Tomas'`, 4000), `${tag}: Enter on a sleeper does not open the chat`);
    await H.key('Escape'); await H.until(`!document.body.classList.contains('panel-open')`, 3000); await ctx.sleep(300);
    /* the width goes to the working desks: wider than with the setting off, the row no taller */
    const on = await lounge();
    await toggle();
    const off = await lounge();
    check(off.recent.length + off.old.length === 0 && off.open === 7, `${tag}: with the setting off ${off.open} desks and ${off.recent.length + off.old.length} resting`);
    check(on.deskW > off.deskW && on.roomH <= off.roomH + 1, `${tag}: the width did not go to the working desks or the row grew: on ${on.deskW}px wide, room ${on.roomH}px; off ${off.deskW}px, room ${off.roomH}px`);
    rows.push(`${tag}: on ${on.d}${on.gf ? ' f=' + on.gf : ''} desk ${on.deskW}x${on.deskH}, room ${on.roomH}px; off ${off.d}${off.gf ? ' f=' + off.gf : ''} desk ${off.deskW}x${off.deskH}, room ${off.roomH}px`);
    await toggle();
    check((await lounge()).old.length === 3, `${tag}: the setting does not turn back on`);
    /* after 10 minutes the couch agents go to bed; past 4 sleepers, 3 beds and "+N asleep" */
    await ago('sim-2', 11); await ago('sim-3', 12);
    check(await H.until(`!!document.querySelector('#stage .desk.shut.rest-old[data-id="sim-2"]')&&!document.querySelector('#stage .desk.shut.rest-recent')`, 3000), `${tag}: the couch agents did not go to bed after 10 minutes`);
    const m = await lounge();
    check(m.old.length === 3 && /^\+2 asleep$/.test(m.more.trim()), `${tag}: 5 sleepers show ${m.old.length} beds and "${m.more}"`);
    const p3 = await page(); check(!p3.length, `${tag} with "+N asleep": ${p3.slice(0, 4).join('; ')}`);
    /* an agent that starts again goes back to its desk */
    await emit({ type: 'status', sessionId: 'sim-6', status: 'working', intent: 'Running the eval again' });
    check(await H.until(`!document.querySelector('#stage .desk.shut[data-id="sim-6"]')&&!!document.querySelector('#stage .desk.card[data-id="sim-6"]')`, 3000), `${tag}: Tomas did not get his desk back when he started again`);
    const p2 = await page(); check(!p2.length, `${tag} after changes: ${p2.slice(0, 4).join('; ')}`);
  }

  /* FR-051 in the page (review of #554): the room rule's input (shutInput). A Done agent whose helper still works keeps its desk and the
     helper stays drawn (the lounge draws no helpers); an agent away at a lobby place is never in the lounge, even when its turn has a reply */
  {
    const tag = 'lounge rules 1440x900';
    await load(14, 1440, 900, { simrooms: '2', simhelpers: '0' });
    await finish('sim-2', 'The edge cases for the canton lookup are listed and tested.');
    await finish('sim-3', 'Renamed the tool and kept the old name as an alias for one release.');
    await finish('sim-4', 'The README tool table is updated and linked from the docs index.');
    await ago('sim-3', 4); await ago('sim-4', 25);
    check(await H.until(`['sim-2','sim-3','sim-4'].every(id=>!!document.querySelector('#stage .desk.shut[data-id="'+id+'"]'))`, 4000), `${tag}: Mira, Jonas and Noor are not resting before the checks`);
    /* a helper starts under Jonas (on the couch): Jonas stays Done, gets his desk back, and his working helper is drawn next to it */
    await emit({ type: 'subagent', sessionId: 'sim-3', subagentId: 'fill-h1', name: 'Scout', phase: 'started', task: 'Reading every caller of the old name', agentName: 'explore' });
    const hb = await H.until(`(()=>{const d=document.querySelector('#stage .desk[data-id="sim-3"]');const u=d&&d.closest('.unit');return !!d&&!d.classList.contains('shut')&&!!u&&[...u.querySelectorAll('.helper')].some(h=>h.dataset.state==='working'||h.classList.contains('is-working'))})()`, 3000);
    const hs = await js(`(()=>{const d=document.querySelector('#stage .desk[data-id="sim-3"]');const u=d&&d.closest('.unit');return {state:d&&d.dataset.state,shut:!!d&&d.classList.contains('shut'),helpers:u?[...u.querySelectorAll('.helper')].map(h=>h.className):[]}})()`);
    check(hb && hs.state === 'done', `${tag}: a Done agent with a working helper went to the lounge or lost its helper (${JSON.stringify(hs)})`);
    await emit({ type: 'subagent', sessionId: 'sim-3', subagentId: 'fill-h1', name: 'Scout', phase: 'completed', agentName: 'explore', durationMs: 4000, totalTokens: 900, totalToolCalls: 1 });
    check(await H.until(`!!document.querySelector('#stage .desk.shut[data-id="sim-3"]')`, 3000), `${tag}: Jonas did not go back to the couch when his helper finished`);
    /* Noor (asleep, Idle after a reply) calls a tool at a lobby place without a new turn: she is away, so she leaves the lounge */
    await emit({ type: 'toolCall', sessionId: 'sim-4', callId: 'fill-away', tool: 'playwright-browser_snapshot', phase: 'start', mcpServer: 'playwright', mcpTool: 'browser_snapshot' });
    const aw = await H.until(`!!document.querySelector('#stage .desk.is-away[data-id="sim-4"]')&&!document.querySelector('#stage .desk.shut[data-id="sim-4"]')`, 4000);
    const as = await js(`(()=>{const d=document.querySelector('#stage .desk[data-id="sim-4"]');return d?{cls:d.className,state:d.dataset.state}:null})()`);
    check(aw && as && /^(done|idle)$/.test(as.state), `${tag}: an agent away at a place is in the lounge, or the case did not keep it finished (${JSON.stringify(as)})`);
    await H.until(`!document.querySelector('.walker.walking')`, 6000); await ctx.sleep(250);
    const pr = await page(); check(!pr.length, `${tag}: ${pr.slice(0, 4).join('; ')}`);
  }

  /* spec 001 FR-051 (change 2026-10-23, the Windows flake "Mira, Jonas and Noor are not resting before the checks"): with reduced motion
     (the Windows runner reports it by itself) a figure coming back from the Boss is dropped without a walk. The office must be drawn again
     then, or Jonas keeps his empty chair and stays out of the lounge until some other change draws it (about 4 s here, longer on CI).
     Reduced motion is emulated before the page loads (the app reads it once); the three events arrive in one frame, so only the drop
     can draw the lounge. */
  {
    const tag = 'lounge after the Boss, reduced motion';
    const dbg = ctx.win.webContents.debugger;
    if (!dbg.isAttached()) dbg.attach('1.3');
    await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    try {
      await load(14, 1440, 900, { simrooms: '2', simhelpers: '0' });
      const pre = await js(`({reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,away:!!document.querySelector('#stage .desk.is-away[data-id="sim-3"]'),boss:!!document.querySelector('.walker')})`);
      check(pre.reduced && pre.away, `${tag}: the case did not start with reduced motion and Jonas at the Boss ${JSON.stringify(pre)}`);
      await js(`(()=>{const E=(e)=>window.__durbarSimEmit(Object.assign({timestamp:Date.now()},e));E({type:'status',sessionId:'sim-3',status:'working',intent:'Working'});E({type:'output',sessionId:'sim-3',final:true,text:'Renamed the tool and kept the old name as an alias for one release.'});E({type:'status',sessionId:'sim-3',status:'idle'});return true})()`);
      const ok = await H.until(`!!document.querySelector('#stage .desk.shut[data-id="sim-3"]')`, 1500);
      const st = await js(`(()=>{const d=document.querySelector('#stage .desk[data-id="sim-3"]');return {cls:d?d.className:'',vis:document.visibilityState,walkers:document.querySelectorAll('.walker').length}})()`);
      check(ok, `${tag}: Jonas, back from the Boss and finished, is not in the lounge within 1.5 s ${JSON.stringify(st)}`);
    } finally {
      await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [] });
      dbg.detach();
    }
  }

  rows.forEach((r) => console.log('[office-fill]', r));
  if (failures.length) { failures.forEach((f) => console.log('[office-fill] FAIL', f)); assert.fail(`${failures.length} problems`); }
  console.log(`[office-fill] all checks passed (${rows.length} layouts)`);
};
