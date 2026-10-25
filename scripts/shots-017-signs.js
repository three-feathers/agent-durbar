/*
 * Meeting-room door signs on session desks (spec 017 FR-003..FR-010, owner request 2026-10-23, issue #616). Simulator only
 * (DURBAR_SIM=15 DURBAR_SIM_FREEZE=1): no real agent session, no account, no AI credits (constitution IV).
 *
 *   npm run build
 *   SHOTS_OUT=<dir> DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-017-signs.js npx electron .        (xvfb-run -a ... --no-sandbox on Linux)
 *   node scripts/ui-suite.js --only shots-017-signs
 *
 * At 1440x900 and 1280x800, with mixed states (the simulator's own plus, set through __durbarSimUi: one agent paused, one ended, one on
 * a coffee break), it fails (exit 1) when:
 *   - a main desk has no sign, or its key, word, icon, door (pill signs; open only for Available) or colour class is not the one its state calls
 *     for (the expected sign is computed here from the state, independently of roomsummary.js); not every one of the 8 signs is seen;
 *   - (owner 2026-10-23, cabins) a busy, waiting, DND or away session does not show its closed cabin door with its photo and sign in place of
 *     the desk scene, or a done, free or failing-to-error session does not show the open scene with an open leaf and its tag; a door sign
 *     is cut, below 10.5px or below 3:1; a session waiting for you does not stand in front of its closed door, waving (owner 13:59 UTC), with
 *     its sign on top and readable; a click on a closed door does not open that agent's chat;
 *   - a helper tile shows a sign (a helper is not a session);
 *   - the desk's accessible name lost its plain status word, or the sign's tooltip does not name both;
 *   - sign text is below 10.5px, an icon is not in the text colour, or text contrast against the plate is below 3:1 in any of the
 *     6 built-in themes (4.5:1 is printed, not required);
 *   - a sign word is cut at all with these 15 agents (a long name may cut it elsewhere, never below three characters), or a glyph leaves its desk;
 *   - the mini/micro status word does not use the short word, or shows a door (icon and short word only there) (Alert, Waiting, DND, Away, Meeting, Busy, Available);
 *   - the office breaks a layout rule (check-office-overlap's pageCheck: overlap, clipping, office scroll, text size) or shows fewer than 15 desks;
 *   - a resting agent's lounge peek does not say Away;
 *   - Settings > Office layout > Open office does not bring back the plain desks (no cabin part, office rules) and Office with cabins the signs;
 *   - (review on PR 631) Open office hides a door you closed (it must ask, list it, keep the cabins on Keep cabins, open it on Send all,
 *     and keep a door still closed visible with its button); remote control behind a closed door does not offer Open the door; a held
 *     prompt with a token-shaped secret reaches the dialog unmasked; a name with markup is not escaped on the door button; a door you
 *     closed has no DND word on a card desk or is not in the desk's accessible name; an agent compacting has no Compacting sign.
 * Screenshots: <SHOTS_OUT>/017-signs-<w>x<h>.png (default: a temp folder, never docs/screenshots).
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');
const { pageCheck } = require('./check-office-overlap.js');

const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-017-signs-'));
const SIZES = [[1440, 900], [1280, 800]];
const THEMES = ['clean-office', 'corporate', 'durbar-european', 'durbar-indian', 'durbar-japanese', 'retro'];
/* the oracle: spec 017 FR-003's table, written out again here (not imported) so a wrong mapping in the app fails */
const TABLE = {
  attention: { word: 'Error', short: 'Alert', icon: 'alert', open: true },
  limit: { word: 'Limit reached', short: 'Limit', icon: 'wallet', open: false, wallet: true },
  waiting: { word: 'Waiting for you', short: 'Waiting', icon: 'hourglass', open: false, wave: true },
  shut: { word: 'Do not disturb · by you', short: 'DND', icon: 'lock', open: false, tip: 'Do not disturb (you closed it)' },
  dnd: { word: 'Do not disturb', short: 'DND', icon: 'bar', open: false },
  away: { word: 'Away', short: 'Away', icon: 'clock', open: false },
  meeting: { word: 'In a meeting', short: 'Meeting', icon: 'people', open: false },
  retrying: { word: 'Retrying', short: 'Retrying', icon: 'retry', open: false },
  compacting: { word: 'Compacting', short: 'Compact', icon: 'compress', open: false },
  failing: { word: 'Failing', short: 'Failing', icon: 'bolt', open: false },
  thinking: { word: 'Thinking', short: 'Thinking', icon: 'bubble', open: false },
  busy: { word: 'Busy', short: 'Busy', icon: 'dot', open: false },
  done: { word: 'Done', short: 'Done', icon: 'check', open: true },
  available: { word: 'Available', short: 'Available', icon: 'ring', open: true },
};
function expected(d) {
  const work = (s) => s === 'working' || s === 'thinking';
  if (d.state === 'error') return ['attention', 'error'];
  if (d.state === 'waiting' && d.limit) return ['limit', 'waiting'];
  if (d.coffee && !d.limit) return [d.userClosed ? 'shut' : 'dnd', 'idle']; // review on #631: a break is entered as waiting
  if (d.state === 'waiting') return ['waiting', 'waiting'];
  if (d.userClosed) return ['shut', 'idle'];
  if (d.paused) return ['dnd', 'idle'];
  if (d.ended) return ['away', 'idle'];
  if (work(d.state)) return d.retrying ? ['retrying', 'retrying'] : d.compacting ? ['compacting', 'compacting'] : d.failing ? ['failing', 'failing'] : d.helpers.some(work) ? ['meeting', d.state] : d.state === 'thinking' ? ['thinking', 'thinking'] : ['busy', 'working'];
  return d.state === 'done' ? ['done', 'done'] : ['available', 'idle'];
}

/* runs in the page: every main desk with its sign, its agent's flags and the sign's measured colours */
function readDesks() {
  const ui = window.__durbarSimUi, list = ui.agents();
  const rgb = (c) => {
    let m = /^rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?\)$/.exec(c);
    if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
    m = /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/.exec(c);
    if (m) return [m[1] * 255, m[2] * 255, m[3] * 255, m[4] === undefined ? 1 : +m[4]];
    return null;
  };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  /* the plate's colour, laid over the first opaque ancestor when it is see-through */
  const bgOf = (e) => {
    const stack = [];
    for (let n = e; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c && c[3] > 0) { stack.push(c); if (c[3] >= 1) break; } }
    let out = [255, 255, 255];
    for (let i = stack.length - 1; i >= 0; i--) { const c = stack[i]; out = [0, 1, 2].map((k) => c[k] * c[3] + out[k] * (1 - c[3])); }
    return out;
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  return [...document.querySelectorAll('#stage .desk[data-id]:not(.shut)')].filter((d) => d.getClientRects().length).map((d) => {
    const a = list.find((x) => x.id === d.dataset.id) || {};
    const kids = list.filter((x) => x.parent === a.id).map((h) => (h.paused ? 'idle' : h.state));
    /* FR-011..FR-013: the cabin in the scene's place (closed) or over it (open) */
    const cab = d.querySelector('[data-cabin]'), csg = cab && cab.querySelector('.cb-sign'), cw = csg && csg.querySelector('.cb-w'), cic = csg && csg.querySelector('.ds-ic');
    const scn = [...d.querySelectorAll('svg.scene')].some((x) => x.getClientRects().length && x.getBoundingClientRect().height > 4);
    const ctc = cw && rgb(getComputedStyle(cw).color), cbg = csg && bgOf(csg), D0 = d.getBoundingClientRect(), CR = csg && csg.getBoundingClientRect();
    /* the waving figure: its avatar and arm, the arm moving (unless reduced motion), and the sign on top of it (the point in the sign's middle is the sign) */
    const arm = cab && cab.querySelector('.cb-arm'), fig = cab && cab.querySelector('.cb-figure');
    const onTop = !!CR && (() => { const e = document.elementFromPoint(CR.left + CR.width / 2, CR.top + CR.height / 2); return !!e && !!e.closest('.cb-sign'); })();
    /* FR-021: the flames, inside the scene box and clear of the tag; FR-015: the door button, on the scene, clear of the desk's words */
    const fire = cab && cab.querySelector('.cb-fire'), FR = fire && fire.getBoundingClientRect(), SB = cab && (cab.closest('.cb-scene') || cab).getBoundingClientRect();
    const meets = (p, q) => p.left < q.right - 0.5 && q.left < p.right - 0.5 && p.top < q.bottom - 0.5 && q.top < p.bottom - 0.5;
    const tg = d.parentElement && d.parentElement.querySelector(':scope > .cb-toggle'), TG = tg && tg.getBoundingClientRect();
    const tgHits = TG ? [...d.querySelectorAll('.name,.intent,.task,.pill,.stl,.role,.chatno,.cb-sign')].filter((e) => e.getClientRects().length && meets(TG, e.getBoundingClientRect())).map((e) => e.className) : [];
    const cno = d.querySelector('.chatno'), CN = cno && cno.getClientRects().length ? cno.getBoundingClientRect() : null;
    const cabin = cab ? { underBadge: !!(CN && CR && meets(CN, CR)), wordShown: !!cw && getComputedStyle(cw).display !== 'none', density: document.getElementById('stage').dataset.d, kind: cab.dataset.cabin, wallet: !!cab.querySelector('.cb-wallet'), fire: !!fire, fireIn: !!FR && FR.left >= SB.left - 0.5 && FR.right <= SB.right + 0.5 && FR.top >= SB.top - 0.5 && FR.bottom <= SB.bottom + 0.5 && !(CR && meets(FR, CR)), flicker: !!fire && [...fire.querySelectorAll('.fl')].some((g) => g.getAnimations().length > 0), figure: !!(fig && fig.querySelector('svg:not(.cb-arm)')), arm: !!arm, waving: !!arm && arm.getAnimations().length > 0, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, onTop, photo: !!cab.querySelector('.cb-photo svg'), door: !!cab.querySelector('.cb-door'), leaf: !!cab.querySelector('.cb-leaf-open'), sign: csg && csg.dataset.sign, word: cw && cw.dataset.w, icon: cic && cic.dataset.icon,
      font: cw ? parseFloat(getComputedStyle(cw).fontSize) : 0, contrast: ctc ? Math.round(ratio(ctc, cbg) * 100) / 100 : 0, cut: !!cw && cw.scrollWidth > cw.clientWidth + 0.5,
      inDesk: !!CR && CR.width > 1 && CR.left >= D0.left - 0.5 && CR.right <= D0.right + 0.5 && CR.top >= D0.top - 0.5 && CR.bottom <= D0.bottom + 0.5 } : null;
    const base = { toggle: tg ? { pressed: tg.getAttribute('aria-pressed'), label: tg.getAttribute('aria-label') || '', hits: tgHits, w: Math.round(TG.width), h: Math.round(TG.height) } : null, userClosed: !!tg && tg.getAttribute('aria-pressed') === 'true', limit: !!a.limit, cabin, scene: scn, id: d.dataset.id, name: a.name, parent: !!a.parent, state: d.dataset.state, paused: !!a.paused, coffee: !!a.coffee, ended: d.dataset.state === 'idle' && a.label === 'Ended', helpers: kids, failing: d.classList.contains('is-failing'), retrying: d.classList.contains('is-retrying'), compacting: !d.classList.contains('is-retrying') && !!(window.DurbarModels && window.DurbarModels.compactingNow(a)), label: d.getAttribute('aria-label') || '', helper: d.classList.contains('helper') };
    /* review on PR 631 (shots-034-retry): the desk's pill and status word stay the plain ones (Working, Retrying with spec 034's line,
       Error ...); the meeting-room sign is on the cabin door */
    const pl = [...d.querySelectorAll('.pill,.stl')].find((x) => x.getClientRects().length);
    return Object.assign(base, {
      sign: csg && csg.dataset.sign, cls: csg ? csg.className : '', icon: cic && cic.dataset.icon, title: csg ? csg.getAttribute('title') || '' : '',
      icColor: cic && getComputedStyle(cic).color, txColor: cw && getComputedStyle(cw).color,
      pill: pl ? pl.textContent.trim() : '', pillCls: pl ? pl.className : '', pillSign: !!(pl && (pl.classList.contains('dsign') || pl.querySelector('.ds-ic'))),
    });
  });
}

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const desks = () => js(`(${readDesks.toString()})()`);
  /* redraw, then let the figures that walk (a coffee break walks to the coffee corner) arrive before anything is measured */
  const walksDone = `![...document.querySelectorAll('#walkers .walker')].some((w)=>w.classList.contains('walking')||w.getAnimations().some((a)=>a.playState==='running'))`;
  /* the usage line is fitted after a render (fitUsage); a sign is measured once that has run, i.e. once no sign word is cut (at most 3 s; the
     assertions below then report any that stays cut) */
  const settled = `![...document.querySelectorAll('#stage .cb-sign .cb-w')].some((e)=>e.getClientRects().length&&e.scrollWidth>e.clientWidth+0.5)`;
  const rerender = async () => { await js(`window.__durbarSimUi.render()`); await ctx.sleep(400); await until(walksDone, 8000); await until(settled, 3000); await ctx.sleep(200); };
  /* mixed states the simulator does not make by itself: one paused, one ended, one on a coffee break (Durbar's paths set these flags) */
  const mix = () => js(`(()=>{const L=window.__durbarSimUi.agents().filter(a=>!a.parent);const pick=(n,f)=>{const a=L.find(x=>x.name===n)||L.find(f);return a;};
    const p=pick('Hugo',a=>a.state==='idle'&&!a.paused);if(p)p.paused=true;
    const all=window.__durbarSimUi.agents(), solo=a=>(a.state==='working'||a.state==='thinking')&&!all.some(h=>h.parent===a.id);
    const plain=a=>{const d=document.querySelector('#stage .desk[data-id="'+CSS.escape(a.id)+'"]');return a.state==='working'&&!(d&&d.classList.contains('is-failing'));};
    const e=L.find(a=>solo(a)&&plain(a));if(e){e.state='idle';e.label='Ended';}
    const dn=L.find(a=>a.state==='working'&&all.some(h=>h.parent===a.id&&h.state==='working'));if(dn){dn.state='done';dn.label=null;}
    return {paused:p&&p.name,ended:e&&e.name,done:dn&&dn.name};})()`);

  /* every main desk against the oracle; the signs seen go into `seen` (the passes together must show every sign) */
  const checkDesks = (w, ds, seen) => {
    for (const d of ds) {
      if (d.helper || d.parent) { assert.ok(!d.sign, `${w}: helper ${d.name} shows no sign`); continue; }
      const [key, tone] = expected(d), t = TABLE[key];
      const tag = `${w} ${d.name} (${d.state}${d.paused ? ', paused' : ''}${d.coffee ? ', coffee' : ''}${d.ended ? ', ended' : ''})`;
      assert.strictEqual(d.sign, key, `${tag}: sign`);
      assert.ok(d.cls.split(' ').includes('st-' + tone), `${tag}: colour st-${tone} (${d.cls})`);
      assert.strictEqual(d.icColor, d.txColor, `${tag}: the icon is drawn in the text colour`);
      /* review on PR 631: the pill or status word stays the plain one (other features read it: spec 034's Retrying line, 052's Failing) */
      assert.ok(!d.pillSign && /^(Working|Thinking|Retrying|Compacting|Failing|Waiting|Idle|Error|Done|Paused|Ended|Limit reached|Stopped|Coffee break|Away)/.test(d.pill), `${tag}: the pill keeps the plain status word: ${d.pill}`);
      /* owner 2026-10-23: a real office cabin */
      const c = d.cabin;
      assert.ok(c, `${tag}: has a cabin`);
      assert.strictEqual(c.kind, t.open ? 'open' : t.wave ? 'waiting' : t.wallet ? 'limit' : 'closed', `${tag}: the cabin is ${t.open ? 'open' : t.wave ? 'a closed door with the agent waving in front' : 'closed'}`);
      if (t.open) assert.ok(d.scene && c.leaf && !c.door, `${tag}: open: the desk scene shows, with an open leaf`);
      else if (t.wallet) assert.ok(c.kind === 'limit' && !d.scene && c.door && !c.photo && c.figure && c.wallet && c.onTop, `${tag}: spending limit: the agent at its closed door holding an empty wallet, under a readable sign: ${JSON.stringify(c)}`);
      else if (t.wave) assert.ok(c.kind === 'waiting' && !d.scene && c.door && !c.photo && c.figure && c.arm && (c.waving || c.reduced) && c.onTop, `${tag}: waiting: the agent stands in front of its closed door, waving, under a readable sign: ${JSON.stringify(c)}`);
      else assert.ok(!d.scene && c.door && c.photo && !c.figure, `${tag}: closed: the door with the agent's photo in place of the desk scene`);
      assert.strictEqual(c.sign, key, `${tag}: the door's sign`);
      assert.strictEqual(c.word, t.short, `${tag}: the door's sign word`);
      assert.strictEqual(c.wordShown, ['roomy', 'full'].includes(c.density) || d.sign === 'shut', `${tag}: the door's sign shows its word where the desk is wide, and a door you closed everywhere (FR-028) (${c.density})`);
      assert.ok(!c.underBadge, `${tag}: the chat number does not cover the door's sign`);
      assert.strictEqual(c.icon, t.icon, `${tag}: the door's sign icon`);
      assert.ok(c.font >= 10.5 && c.contrast >= 3 && !c.cut && c.inDesk, `${tag}: the door's sign is legible and whole: ${JSON.stringify(c)}`);
      if (t.tip) assert.ok(d.title.startsWith(t.tip), `${tag}: the door sign's tooltip: ${d.title}`);
      else assert.strictEqual(d.title, t.word, `${tag}: the door sign's tooltip is its full word`);
      /* owner Q6: an error burns, inside its scene, clear of its tag, flickering unless motion is reduced */
      assert.strictEqual(c.fire, key === 'attention', `${tag}: ${key === 'attention' ? 'flames on the desk' : 'no flames'}`);
      if (c.fire) assert.ok(c.fireIn && (c.flicker || c.reduced), `${tag}: the flames stay in the scene, clear of the tag, and flicker: ${JSON.stringify(c)}`);
      /* FR-015: every main desk has its door button: 24px, pressed exactly when the user closed the door, on the scene and clear of the words */
      assert.ok(d.toggle && d.toggle.w >= 24 && d.toggle.h >= 24 && d.toggle.hits.length === 0, `${tag}: the door button is there, 24px, clear of the words: ${JSON.stringify(d.toggle)}`);
      assert.ok(key === 'shut' ? /^Open the door: /.test(d.toggle.label) : /^Close the door \(do not disturb\): /.test(d.toggle.label), `${tag}: the door button says what it does: ${d.toggle.label}`);
      assert.ok(/(Working|Thinking|Retrying|Compacting|Failing|Waiting|Idle|Error|Done|Paused|Ended|Limit reached|Stopped|Coffee break)/.test(d.label), `${tag}: the accessible name keeps the plain word: ${d.label.slice(0, 120)}`);
      seen.add(key);
    }
  };
  const seen = new Set();
  for (const [w, h] of SIZES) {
    await H.load({ w, h, focus: true });
    const m = await mix();
    console.log('[017-signs]', w, 'mixed', JSON.stringify(m));
    assert.ok(m.paused && m.ended && m.done, `${w}: found agents to pause, end and finish: ${JSON.stringify(m)}`);
    await rerender();
    /* FR-015: close one door with the keyboard (focus its button, Enter): the paused agent's door, so plain DND is still seen elsewhere */
    await js(`document.querySelector('#stage .unit [data-doorset="'+CSS.escape(window.__durbarSimUi.agents().find((a)=>a.name===${jsLiteral(m.paused)}).id)+'"]').focus()`);
    await H.key('Return');
    assert.ok(await until(`document.querySelector('#stage .unit .cb-toggle[aria-pressed="true"]')!==null`, 4000), `${w}: Enter on the door button closes the door`);
    assert.ok(await until(`[...document.querySelectorAll('#stage .desk[data-id] .cb-sign')].some((e)=>e.dataset.sign==='shut')`, 4000), `${w}: the closed door shows Do not disturb (you closed it)`);
    await H.clearToasts();
    await rerender();
    const ds = await desks();
    assert.ok(ds.filter((d) => !d.helper).length >= 13, `${w}: the main desks are shown (${ds.length})`);
    checkDesks(w, ds, seen);
    console.log('[017-signs]', w, ds.filter((d) => d.sign).map((d) => `${d.name}=${d.sign}:${d.cabin && d.cabin.contrast}`).join(' '));
    assert.deepStrictEqual(ds.filter((d) => d.cabin && d.cabin.cut).map((d) => `${d.name} "${d.cabin.word}"`), [], `${w}: no door sign word is cut with 15 agents`);
    const page = await js(`(${pageCheck.toString()})(false, 5)`);
    assert.deepStrictEqual(page.problems, [], `${w}: office layout rules`);
    /* FR-007: next to a long sign, a token count is dropped whole, never cut to a misleading "1" */
    const cutTok = await js(`[...document.querySelectorAll('#stage .desk .use .tok')].filter(t=>t.getClientRects().length&&t.scrollWidth>t.clientWidth+0.5).map(t=>t.closest('.desk').querySelector('.name').textContent+': '+t.textContent)`);
    assert.deepStrictEqual(cutTok, [], `${w}: no token count is cut`);
    assert.ok(await js(`document.querySelectorAll('#stage .desk[data-id]').length>=15`), `${w}: 15 agents shown`);
    /* FR-009: a resting agent in the lounge says Away */
    const peeks = await js(`[...document.querySelectorAll('#stage .desk.shut .peek .dsign-tx')].map(x=>({k:x.dataset.sign,t:x.textContent.trim(),i:(x.querySelector('.ds-ic')||{dataset:{}}).dataset.icon}))`);
    assert.ok(peeks.length >= 1 && peeks.every((p) => p.k === 'away' && p.t === 'Away' && p.i === 'clock'), `${w}: lounge peeks say Away: ${JSON.stringify(peeks)}`);
    /* FR-019, FR-020: in the lobby the spending limit holds the empty wallet (at the Bank) and a wait at the Boss waves; nobody else carries a prop */
    const figs = await js(`[...document.querySelectorAll('#walkers .walker[data-agent]')].map((el)=>{const a=window.__durbarSimUi.agents().find((x)=>x.id===el.dataset.agent)||{};const p=el.querySelector('.wprop svg');return {name:a.name,limit:!!a.limit,ask:el.dataset.ask||'',prop:p?(p.classList.contains('w-wallet')?'wallet':p.classList.contains('w-arm')?'wave':'?'):'',moving:!!p&&p.getAnimations().length>0,still:!!p&&(p.classList.contains('still')||matchMedia('(prefers-reduced-motion: reduce)').matches)}})`);
    console.log('[017-signs]', w, 'lobby figures', JSON.stringify(figs));
    assert.ok(figs.some((f) => f.limit && f.prop === 'wallet'), `${w}: the agent at its spending limit holds the wallet in the lobby: ${JSON.stringify(figs)}`);
    assert.ok(figs.some((f) => !f.limit && f.ask && f.prop === 'wave' && (f.moving || f.still)), `${w}: an agent waiting at the Boss waves (a still raised hand with reduced motion, as on the Windows runner): ${JSON.stringify(figs)}`);
    assert.deepStrictEqual(figs.filter((f) => f.prop !== (f.limit ? 'wallet' : f.ask ? 'wave' : '')).map((f) => f.name), [], `${w}: props only where they belong`);
    await H.shot(path.join(OUT, `017-signs-${w}x${h}.png`), { prep: 'calm', blur: true, tag: '017-signs', what: `${w}x${h}` });
    /* FR-014: a click on a closed door opens that agent's chat */
    const shut = ds.find((d) => d.cabin && d.cabin.kind === 'closed');
    await js(`document.querySelector('#stage .desk[data-id="'+CSS.escape(${jsLiteral(shut.id)})+'"] .cabin').click()`);
    const opened = await until(`document.body.classList.contains('panel-open')&&(document.getElementById('panelTitle')||{}).textContent===${jsLiteral(String(shut.name))}`, 6000);
    const seenTitle = opened ? '' : await js(`document.body.className+' | '+((document.getElementById('panelTitle')||{}).textContent||'')`);
    assert.ok(opened, w + ': clicking ' + shut.name + "'s closed door opens its chat (" + seenTitle + ')');
    await H.key('Escape'); await until(`!document.body.classList.contains('panel-open')`, 4000); await rerender();

    /* FR-005: contrast and size in every built-in theme (the theme path the Settings picker uses) */
    if (w === SIZES[0][0]) {
      for (const th of THEMES) {
        await js(`window.THEME.setTheme(${jsLiteral(th)})`);
        await js(`(()=>{document.getElementById('stage').innerHTML='';window.dispatchEvent(new Event('resize'));return true})()`);
        assert.ok(await until(`window.THEME.current().id===${jsLiteral(th)}&&document.querySelectorAll('#stage .cb-sign').length>=13`, 8000), `${th}: theme applied and signs drawn`);
        await ctx.sleep(500); await until(walksDone, 8000);
        const tds = (await desks()).filter((d) => d.sign);
        const low = tds.filter((d) => d.icColor !== d.txColor || !d.cabin || !(d.cabin.contrast >= 3) || !(d.cabin.font >= 10.5) || d.cabin.cut);
        console.log('[017-signs]', th, 'door signs below 4.5:', tds.filter((d) => d.cabin && d.cabin.contrast < 4.5).map((d) => `${d.sign}:${d.cabin.contrast}`).join(' ') || 'none');
        console.log('[017-signs]', th, 'door signs min contrast', Math.min(...tds.map((d) => (d.cabin ? d.cabin.contrast : 0))));
        assert.deepStrictEqual(low.map((d) => `${d.name} ${d.sign} ${JSON.stringify(d.cabin)}`), [], `${th}: every sign (pill and door) >= 3:1, >= 10.5px, whole, icons in the text colour`);
        if (w === SIZES[0][0]) await H.shot(path.join(OUT, `017-cabins-${th}-${w}x${h}.png`), { prep: 'calm', blur: true, tag: '017-signs', what: th });
        const tp = await js(`(${pageCheck.toString()})(false, 5)`);
        assert.deepStrictEqual(tp.problems, [], `${th} ${w}: office layout rules`);
      }
      await js(`window.THEME.setTheme('clean-office')`);
    }

    /* FR-008, FR-027 (owner 2026-10-24): Settings > Office layout: Open office brings back the plain desks, Office with cabins the signs */
    const toggle = async (which) => {
      await js(`window.DurbarScreens.openSettings()`);
      assert.ok(await until(`!!document.querySelector('[data-officelayout="${which}"]')`, 4000), 'Settings has Office layout: ' + which);
      await js(`document.querySelector('[data-officelayout="${which}"]').click()`);
      /* FR-027: a door closed earlier in this pass: Open office asks first; open it (nothing is held here) */
      if (which === 'open' && await until(`!!document.getElementById('modeDlg')`, 1500)) {
        const b = await js(`[...document.querySelectorAll('#modeDlg .dbtn button')].map((x)=>x.textContent)`);
        assert.deepStrictEqual(b, ['Keep cabins', 'Open the doors'], 'Open office asks about the door you closed: ' + JSON.stringify(b));
        await js(`[...document.querySelectorAll('#modeDlg .dbtn button')].find((x)=>x.textContent==='Open the doors').click()`);
      }
      assert.ok(await until(`document.querySelector('[data-officelayout="${which}"]').getAttribute('aria-pressed')==='true'`, 3000), which + ' is pressed: ' + (await js(`JSON.stringify({dlg:!!document.getElementById('modeDlg'),dt:(document.querySelector('#modeDlg h3')||{}).textContent,segs:[...document.querySelectorAll('[data-officelayout]')].map((b)=>b.dataset.officelayout+'='+b.getAttribute('aria-pressed')),ls:localStorage.getItem('durbar.doorsigns'),doors:Object.keys(window.__durbarSimUi.agents()).length})`)));
      if (w === 1440 && which === 'open') await js(`document.querySelector('[data-officelayout]').closest('.scr-row').scrollIntoView({block:'center'})`);
      if (w === 1440 && which === 'open') await H.shot(path.join(OUT, '017-office-layout-1440x900.png'), { prep: 'none', tag: '017-signs', what: 'Office layout setting' });
      await H.key('Escape'); await ctx.sleep(500);
    };
    await toggle('open');
    assert.ok(await until(`document.querySelectorAll('#stage .cb-sign').length===0`, 4000), `${w}: switch off: no sign`);
    const plain = await js(`[...document.querySelectorAll('#stage .desk[data-id]:not(.helper):not(.shut)')].map(d=>[...d.querySelectorAll('.pill,.stl')].find(x=>x.getClientRects().length)).filter(Boolean).map(x=>x.textContent.trim())`);
    assert.ok(plain.length >= 13 && plain.some((t) => /^(Working|Thinking)/.test(t)) && plain.some((t) => /^Waiting/.test(t)), `${w}: switch off: plain words ${JSON.stringify(plain)}`);
    assert.strictEqual(await js(`localStorage.getItem('durbar.doorsigns')`), 'off', 'kept per computer');
    /* FR-027: an open office is the office from before the cabins: no cabin, door button, sign or door figure anywhere */
    assert.strictEqual(await js(`document.querySelectorAll('#stage .cabin,#stage .cb-toggle,#stage .cb-sign,#stage .dsign-tx,#stage .cb-arm,#stage .cb-wallet,#stage .cb-fire').length`), 0, `${w}: open office: no cabin parts`);
    await until(settled, 3000);
    const op = await js(`(${pageCheck.toString()})(false, 5)`);
    assert.deepStrictEqual(op.problems, [], `${w}: open office: office layout rules`);
    await H.shot(path.join(OUT, `017-open-office-${w}x${h}.png`), { prep: 'calm', tag: '017-signs', what: 'open office' });
    await toggle('cabins');
    assert.ok(await until(`document.querySelectorAll('#stage .cb-sign').length>=13`, 4000), `${w}: switch on: signs back`);
    console.log('[017-signs]', w, 'ok');
  }
  /* ---- review on #631 (Paco): a coffee break that resumes by itself, from the app's real sequence (simbreak: Tomas hits a 5-hour
     window, Rosa the monthly quota; startCoffee enters them as `waiting` with no `limit`): Do not disturb, not Waiting for you ---- */
  {
    await H.load({ w: 1440, h: 900, focus: true, query: { simbreak: '30', simretry: '1' } }); // simretry: spec 034 FR-020, an agent app retrying (Retrying sign)
    assert.ok(await until(`window.__durbarSimUi.agents().some((a)=>!a.parent&&a.coffee&&!a.limit&&a.state==='waiting')`, 20000), 'break: an agent is on a coffee break that resumes by itself (state waiting, no limit)');
    await until(walksDone, 8000);
    await until(settled, 3000);
    const ds = await desks();
    checkDesks('break', ds, seen);
    const br = ds.filter((d) => d.coffee && !d.limit);
    assert.ok(br.length >= 1 && br.every((d) => d.state === 'waiting' && d.sign === 'dnd' && d.cabin && d.cabin.kind === 'closed'), 'break: shown as Do not disturb behind a closed door: ' + JSON.stringify(br.map((d) => [d.name, d.state, d.sign, d.cabin && d.cabin.kind])));
    console.log('[017-signs] break:', br.map((d) => `${d.name}=${d.sign}`).join(' '));
  }
  /* ---- FR-026: spec 015's Compacting (simcompact=1: Clara mid-compaction) has its own sign, after Retrying, before Failing ---- */
  {
    await H.load({ w: 1440, h: 900, focus: true, query: { simcompact: '1' } });
    assert.ok(await until(`window.__durbarSimUi.agents().some((a)=>!a.parent&&window.DurbarModels.compactingNow(a))`, 10000), 'compact: an agent is compacting');
    await until(settled, 3000);
    const ds = await desks();
    checkDesks('compact', ds, seen);
    const cp = ds.filter((d) => d.compacting);
    assert.ok(cp.length >= 1 && cp.every((d) => d.sign === 'compacting' && /\bst-compacting\b/.test(d.cls) && d.icon === 'compress'), 'FR-026: an agent compacting shows its own Compacting sign: ' + JSON.stringify(cp.map((d) => [d.name, d.sign, d.icon])));
  }
  /* ---- FR-015..FR-017, spec 044 FR-110: a scheduled run for an agent behind a door you closed is held (not sent, not lost), and Send all
     sends it when you open the door. The simulator's one-off schedule (simschedfire) targets the first idle agent. ---- */
  {
    await H.load({ w: 1440, h: 900, focus: true, query: { simschedfire: '6' } });
    await until(settled, 3000);
    checkDesks('held', await desks(), seen); // the untouched office (Busy, among others)
    const sb = 'window.__durbarSimUi.bridge()';
    const target = await js(`${sb}.listSchedules().then((d)=>{const s=d.schedules.find((x)=>x.id==='sched-fire');return s&&s.target?s.target.session:null})`);
    assert.ok(target, 'the simulator has a one-off schedule for an agent');
    const btn = `document.querySelector('#stage .unit [data-doorset="'+CSS.escape(${jsLiteral(target)})+'"]')`;
    const roleText = `(document.querySelector('#stage .desk[data-id="'+CSS.escape(${jsLiteral(target)})+'"] .role')||{}).textContent||''`;
    /* spec 054 FR-040 (review on #631): remote control on first; closing the door turns it off and the window drops the Remote tag */
    const rem = await js(`window.__durbarSimUi.bridge().setRemote(${jsLiteral(target)},true).then((r)=>{const a=window.__durbarSimUi.agents().find((x)=>x.id===${jsLiteral(target)});if(r.ok&&a){a.remote={on:true,url:r.url};window.__durbarSimUi.render();}return !!r.ok;})`);
    assert.ok(rem, 'remote control turned on in the simulator');
    assert.ok(await until(`/Remote/.test(${roleText})`, 3000), 'the card says Remote');
    await js(`${btn}.focus()`);
    await H.key('Return');
    assert.ok(await until(`${btn}.getAttribute('aria-pressed')==='true'`, 4000), 'held: the door is closed');
    assert.ok(await until(`!/Remote/.test(${roleText})`, 4000) && await until(`!(window.__durbarSimUi.agents().find((x)=>x.id===${jsLiteral(target)})||{}).remote`, 1000), 'closing the door turned remote control off, and the card no longer says Remote');
    assert.ok(await until(`[...document.querySelectorAll('#toasts .toast')].some((t)=>/door closed.*remote control is off/.test(t.textContent))`, 3000), 'the toast says remote control is off (only because it really went off)');
    const userMsgs = () => js(`(window.__durbarSimUi.agents().find((a)=>a.id===${jsLiteral(target)})||{}).state`);
    const before = await userMsgs();
    assert.ok(await until(`${sb}.listSchedules().then((d)=>(d.schedules.find((x)=>x.id==='sched-fire')||{}).last?.outcome==='held')`, 15000), 'the scheduled run is held');
    assert.ok(await until(`${sb}.doorsList().then((d)=>(d[${jsLiteral(target)}]||{}).held===1)`, 3000), 'one run waits at the door');
    assert.strictEqual(await userMsgs(), before, 'the held run did not reach the agent (its state did not change)');
    assert.ok(await until(`[...document.querySelectorAll('#stage .desk[data-id="'+CSS.escape(${jsLiteral(target)})+'"] .cb-sign')].some((e)=>/^Do not disturb \\(you closed it\\) · 1 held$/.test(e.getAttribute('title')||''))`, 8000), 'the door sign says Do not disturb (you closed it) · 1 held: ' + (await js(`[...document.querySelectorAll('#stage .desk[data-id="'+CSS.escape(${jsLiteral(target)})+'"] .cb-sign')].map((e)=>e.dataset.sign+'='+e.getAttribute('title')).join(' | ')`)));
    assert.match(await js(`${btn}.getAttribute('aria-label')`), /^Open the door: .+ \(1 held\)$/, 'the button names the held run');
    await H.shot(path.join(OUT, '017-held-1440x900.png'), { prep: 'calm', tag: '017-signs', what: 'held' });
    // opening asks; Escape keeps the door closed (the safer default) and keeps the run
    await js(`${btn}.click()`);
    assert.ok(await until(`!!document.getElementById('modeDlg')`, 4000), 'opening with a held run asks');
    const dlg = await js(`({t:document.querySelector('#modeDlg h3').textContent,b:[...document.querySelectorAll('#modeDlg .dbtn button')].map((x)=>x.textContent),f:document.activeElement&&document.activeElement.textContent})`);
    assert.deepStrictEqual(dlg.b, ['Keep closed', 'Discard', 'Send all (1)'], 'Keep closed, Discard, Send all: ' + JSON.stringify(dlg));
    /* review on #631: the dialog lists what it would send (masked, then cut) */
    const lines = await js(`[...document.querySelectorAll('#modeDlg li')].map((x)=>x.textContent)`);
    assert.deepStrictEqual(lines, ['Scheduled check-in: summarise what changed'], 'the dialog lists the held prompt: ' + JSON.stringify(lines));
    assert.strictEqual(dlg.f, 'Keep closed', 'focus starts on Keep closed, so Enter never sends by accident');
    await H.shot(path.join(OUT, '017-held-dialog-1440x900.png'), { prep: 'none', tag: '017-signs', what: 'held dialog' });
    await H.key('Escape');
    assert.ok(await until(`!document.getElementById('modeDlg')`, 3000));
    assert.strictEqual(await js(`${btn}.getAttribute('aria-pressed')`), 'true', 'Escape keeps the door closed');
    assert.strictEqual(await js(`${sb}.doorsList().then((d)=>(d[${jsLiteral(target)}]||{}).held)`), 1, 'and keeps the held run');
    // review on #631: Send all goes through the schedules: with Pause all on it stops, and the open door still shows the held run
    assert.ok(await js(`${sb}.setSchedulesPaused(true).then((r)=>r.ok)`), 'Pause all on');
    await H.clearToasts();
    await js(`${btn}.click()`);
    assert.ok(await until(`!!document.getElementById('modeDlg')`, 4000));
    await js(`[...document.querySelectorAll('#modeDlg .dbtn button')].find((x)=>/^Send all/.test(x.textContent)).click()`);
    assert.ok(await until(`${btn}.getAttribute('aria-pressed')==='false'`, 4000), 'Send all opens the door');
    assert.ok(await until(`[...document.querySelectorAll('#toasts .toast')].some((t)=>/Remote control stays off/.test(t.textContent))`, 3000), 'reopening says remote control stays off');
    assert.ok(await until(`[...document.querySelectorAll('#toasts .toast')].some((t)=>/Send all stopped because schedules are paused .Pause all./.test(t.textContent))`, 6000), 'Pause all stops Send all and says why: ' + (await js(`[...document.querySelectorAll('#toasts .toast')].map((t)=>t.textContent).join(' | ')`)) + ' held=' + (await js(`window.__durbarSimUi.bridge().doorsList().then((d)=>JSON.stringify(d))`)));
    assert.strictEqual(await js(`${sb}.doorsList().then((d)=>(d[${jsLiteral(target)}]||{}).held)`), 1, 'the run is still held (not sent, not lost)');
    assert.ok(await until(`[...document.querySelectorAll('#stage .desk[data-id="'+CSS.escape(${jsLiteral(target)})+'"] .cb-sign')].some((e)=>/^(Available|Done) · 1 held$/.test(e.getAttribute('title')||''))`, 4000), 'an open door with a held run is not plain Available');
    assert.match(await js(`${btn}.getAttribute('aria-label')`), /^Send or discard 1 held: /, 'its button offers the choice');
    await js(`${sb}.setSchedulesPaused(false)`);
    await js(`${btn}.click()`);
    assert.ok(await until(`!!document.getElementById('modeDlg')`, 4000));
    assert.deepStrictEqual(await js(`[...document.querySelectorAll('#modeDlg .dbtn button')].map((x)=>x.textContent)`), ['Not now', 'Close the door', 'Discard', 'Send all (1)'], 'an open door with held runs asks the same, plus Close the door');
    await js(`[...document.querySelectorAll('#modeDlg .dbtn button')].find((x)=>/^Send all/.test(x.textContent)).click()`);
    assert.ok(await until(`${sb}.doorsList().then((d)=>!d[${jsLiteral(target)}])`, 8000), 'nothing is held any more');
    assert.ok(await until(`['working','thinking'].includes((window.__durbarSimUi.agents().find((a)=>a.id===${jsLiteral(target)})||{}).state)`, 8000), 'the held run reached the agent');
    console.log('[017-signs] held run: held at the closed door, kept by Escape, sent by Send all');
  }
  /* ---- review on #631 (Ruben): (2, FR-027) Open office never hides a door you closed while it holds prompts, and remote control offers to
     open it; (7) held prompts are masked in the dialog, a name with markup is escaped on the door button; (10, FR-028) a door you
     closed has its word on narrow desks and in the desk's name. Card density at 1280x800. ---- */
  {
    await H.load({ w: 1280, h: 800, focus: true, query: { density: 'card' } });
    await until(settled, 3000);
    const sb = 'window.__durbarSimUi.bridge()';
    const target = await js(`(window.__durbarSimUi.agents().find((a)=>!a.parent&&a.state==='idle')||{}).id||''`);
    assert.ok(target, 'an idle main agent');
    const NAME = 'Eve" data-x="1 <b>bold</b> & co';
    await js(`(()=>{const a=window.__durbarSimUi.agents().find((x)=>x.id===${jsLiteral(target)});a.name=${jsLiteral(NAME)};window.__durbarSimUi.render();})()`);
    const desk = `document.querySelector('#stage .desk[data-id="'+CSS.escape(${jsLiteral(target)})+'"]')`;
    const btn = `document.querySelector('#stage .unit [data-doorset="'+CSS.escape(${jsLiteral(target)})+'"]')`;
    assert.ok(await until(`!!${btn}&&(${btn}.getAttribute('aria-label')||'').includes('Eve')`, 4000), 'the door button, with the new name');
    const b0 = await js(`({l:${btn}.getAttribute('aria-label'),t:${btn}.getAttribute('title'),x:!!document.querySelector('#stage [data-x]'),b:!!${btn}.querySelector('b')})`);
    assert.strictEqual(b0.l, 'Close the door (do not disturb): ' + NAME, 'the button names the agent whole, as text (escaped): ' + b0.l);
    assert.ok(b0.t.endsWith(NAME) && !b0.x && !b0.b, 'its tooltip too, and no markup from the name reached the page: ' + JSON.stringify(b0));
    await js(`${btn}.click()`);
    assert.ok(await until(`${btn}.getAttribute('aria-pressed')==='true'`, 4000), 'the door is closed');
    /* a held prompt with a token-shaped secret in it (built here, never a real token) */
    const TOKEN = ['ghp', '_', 'Z9'.repeat(18)].join('');
    const saved = await js(`${sb}.saveSchedule({folder:(window.__durbarSimUi.agents().find((a)=>a.id===${jsLiteral(target)}).info||{}).cwd||window.__durbarSimUi.agents().find((a)=>a.id===${jsLiteral(target)}).cwd,prompt:${jsLiteral('deploy with ' + TOKEN + ' please')},at:Date.now()+1500,target:{session:${jsLiteral(target)}}}).then((r)=>!!r.ok||JSON.stringify(r))`);
    assert.strictEqual(saved, true, 'a one-off schedule for that agent: ' + saved);
    assert.ok(await until(`${sb}.doorsList().then((d)=>(d[${jsLiteral(target)}]||{}).held===1)`, 10000), 'its run is held at the closed door');
    /* FR-028: on a card desk the door you closed shows its word, and the desk's name says it */
    assert.ok(await until(`(()=>{const w=${desk}.querySelector('.cb-sign[data-sign="shut"] .cb-w');return !!w&&getComputedStyle(w).display!=='none'&&/^DND/.test(w.dataset.w)})()`, 4000), 'card desk: the DND word is shown for a door you closed');
    await until(`/, 1 held, /.test(${desk}.getAttribute('aria-label'))`, 8000);
    const dl = await js(`${desk}.getAttribute('aria-label')`);
    assert.ok(dl.startsWith(NAME) && /, door closed by you \(do not disturb\), 1 held, /.test(dl), 'the desk name says the door is closed by you and what it holds: ' + dl);
    /* spec 054 FR-040: remote control offers to open the door */
    await js(`${desk}.click()`);
    assert.ok(await until(`!!document.getElementById('moreBtn')`, 4000), 'the chat is open');
    await js(`document.getElementById('moreBtn').click()`); await until(`!!document.getElementById('remoteBtn')`, 3000);
    await H.clearToasts();
    await js(`document.getElementById('remoteBtn').click()`);
    assert.ok(await until(`[...document.querySelectorAll('#toasts .toast')].some((t)=>/door is closed/.test(t.textContent)&&!!t.querySelector('.toast-act'))`, 4000), 'remote control says the door is closed and offers to open it');
    assert.strictEqual(await js(`[...document.querySelectorAll('#toasts .toast-act')].map((b)=>b.textContent).join('|')`), 'Open the door');
    await js(`[...document.querySelectorAll('#toasts .toast-act')].find((b)=>b.textContent==='Open the door').click()`);
    assert.ok(await until(`!!document.getElementById('modeDlg')`, 4000), 'Open the door asks about the held prompt');
    /* (7) mask, then cut: the token never reaches the dialog */
    const ln = await js(`[...document.querySelectorAll('#modeDlg li')].map((x)=>x.textContent)`);
    assert.ok(ln.length === 1 && /^deploy with /.test(ln[0]) && !ln[0].includes(TOKEN) && !ln[0].includes('Z9Z9Z9Z9'), 'the held prompt is listed masked: ' + JSON.stringify(ln));
    await H.key('Escape');
    assert.ok(await until(`!document.getElementById('modeDlg')`, 3000));
    assert.strictEqual(await js(`${btn}.getAttribute('aria-pressed')`), 'true', 'Escape keeps it closed');
    await H.key('Escape');
    /* (2, FR-027) Open office asks first; Keep cabins keeps them */
    await js(`window.DurbarScreens.openSettings()`);
    assert.ok(await until(`!!document.querySelector('[data-officelayout="open"]')`, 4000));
    await js(`document.querySelector('[data-officelayout="open"]').click()`);
    assert.ok(await until(`!!document.getElementById('modeDlg')`, 4000), 'switching to Open office with a door you closed asks first');
    const od = await js(`({t:document.querySelector('#modeDlg h3').textContent,b:[...document.querySelectorAll('#modeDlg .dbtn button')].map((x)=>x.textContent),l:[...document.querySelectorAll('#modeDlg li')].map((x)=>x.textContent)})`);
    assert.deepStrictEqual(od.b, ['Keep cabins', 'Discard', 'Send all (1)'], 'Keep cabins, Discard, Send all: ' + JSON.stringify(od));
    assert.deepStrictEqual(od.l, [NAME + ' · door closed · 1 held'], 'it names the door');
    await H.key('Escape');
    assert.ok(await until(`!document.getElementById('modeDlg')`, 3000));
    assert.ok(await until(`document.querySelector('[data-officelayout="cabins"]').getAttribute('aria-pressed')==='true'`, 3000), 'Keep cabins: the office keeps its cabins');
    assert.strictEqual(await js(`localStorage.getItem('durbar.doorsigns')`), 'on');
    /* Send all: the door opens, the office switches, the prompt goes to the agent */
    await js(`document.querySelector('[data-officelayout="open"]').click()`);
    assert.ok(await until(`!!document.getElementById('modeDlg')`, 4000));
    await js(`[...document.querySelectorAll('#modeDlg .dbtn button')].find((x)=>/^Send all/.test(x.textContent)).click()`);
    assert.ok(await until(`document.querySelector('[data-officelayout="open"]').getAttribute('aria-pressed')==='true'`, 4000), 'then Open office');
    await H.key('Escape');
    assert.ok(await until(`${sb}.doorsList().then((d)=>!d[${jsLiteral(target)}])`, 10000), 'the door is open and nothing is held');
    assert.ok(await until(`document.querySelectorAll('#stage .cabin,#stage .cb-toggle,#stage .cb-sign').length===0`, 4000), 'an open office: no doors left');
    /* a door still closed in an open office (main kept it, e.g. a restart) stays visible with its button, so it can be opened */
    await js(`${sb}.setDoor(${jsLiteral(target)},true)`);
    await js(`window.__durbarSimUi.render()`);
    assert.ok(await until(`!!${btn}&&${btn}.getAttribute('aria-pressed')==='true'&&!!${desk}.querySelector('.cb-sign[data-sign="shut"]')`, 4000), 'open office: a door closed by you still shows its cabin, sign and button');
    await js(`${btn}.click()`);
    assert.ok(await until(`${btn}===null||${btn}.getAttribute('aria-pressed')==='false'`, 4000), 'and can be opened');
    assert.ok(await until(`document.querySelectorAll('#stage .cabin,#stage .cb-toggle').length===0`, 4000), 'then the open office is plain again');
    await js(`localStorage.setItem('durbar.doorsigns','on')`);
    console.log('[017-signs] open office, masked held prompt, escaped name, DND word on a card desk, remote offers to open the door');
  }
  assert.deepStrictEqual([...seen].sort(), Object.keys(TABLE).sort(), 'every sign is seen at least once across the passes');
  console.log('[017-signs] all checks passed; shots in', OUT);
};
