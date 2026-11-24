/*
 * Spec 001 FR-038, FR-039, FR-179, FR-271 and spec 097 FR-023..FR-027, FR-377 (issues #2011, #2012, #2013, #2014, found by a visual check of the 15-agent
 * simulator at 1440x900 and 1280x800): text that does not fit is cut at the right place, and a title that has room is shown. Simulator only
 * (DURBAR_SIM=15, a frozen simulator), no AI credits; every wait is an until().
 *
 *   npm run check:ui -- --only check-097-textfit        (builds first)
 *   SHOTS_OUT=<dir>   where its pictures go (097-textfit-<world>-<w>x<h>.png; a temporary folder by default)
 *
 * Fails (exit 1) when, with 15 agents, at 1440x900 and 1280x800, in the Flat office, the Photo office, the cave and the Retro arcade:
 *   - (#2011) a room header (a Flat head or a Real office sign) whose name is cut (its start, its tail or all of it) still shows its path: the path
 *     gives way before the name does (FR-037); or a cut name has no whole name in the head's tooltip text (`data-tip`);
 *   - (#2012) a visitor's name chip in the lobby is cut ("Ro…") though the lobby has a free spot for the whole name: a name is cut only when no spot
 *     is free (the whole name stays in the chip's title);
 *   - (#2013) a visitor's name chip touches the lobby band's bottom edge or the first folder sign (the room frame line), or stands off its place;
 *   - (#2014) (Flat) the Postbox tile has no visible name ("Postbox" or the theme's word) at its minimum width, or the name is cut;
 *   - (#2018, #2041) (Flat) a place name in the lobby row cut while another tile has free width, or a people chip of fewer than 3 letters (whole names shorter than that excepted);
 *   - a text under 10.5 px in what it reads, or the office scrolls.
 * Mutants (edit the file, `npm run build`, run, `git checkout -- <file>`; each must fail its assert):
 *   cutchild   in app.js nameCut() drop the two `.rn-h`/`.rn-t` lines          -> "a cut name hides its path" (Flat 1440x900)
 *   chipcut    in realoffice.js stagger() drop the `c.dataset.full` restore in the last-resort branch -> "name chips are whole"
 *   nofigure   in realoffice-layout.ts roLobby() put back `chipY = Lb - CHIP_H` for a visitor without a figure   -> "name chips stay clear of the frame line"
 *   nokey      in realoffice.js fitSigns() take `'|' + sg._sc.textContent` out of the key   -> "a sign whose counts grew is measured again" (photo 1440x900)
 *   postnamed  in places.js set POST_NAMED back to 240                       -> "the Postbox tile shows its name"
 *   noshare    in places.js lobbyShare() return null at its top                -> "a place name is whole while the row has room" (Flat, both sizes)
 *   twoletters in places.js shortName() cut to 2 (`cutText(name,2,`)            -> "a people chip shows 3 letters or the whole name"
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const SIZES = [[1440, 900], [1280, 800]];
const WORLDS = [['flat', null], ['photo', {}], ['cave', { worldflags: 'cave', world: 'cave' }], ['retro', { worldflags: 'retro', world: 'retro' }]];

/* in the page: a text is cut when its text is wider than its box, even by a fraction of a pixel (the browser then draws an ellipsis; scrollWidth is a whole number and misses it) */
const CUT = (e) => { if (e.scrollWidth > e.clientWidth + 0.5) return true; const cs = getComputedStyle(e), r = document.createRange(); r.selectNodeContents(e); return r.getBoundingClientRect().width > e.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) + 0.01; };
/* every room header of the Flat office, name and path as drawn (a path with no width is not drawn) */
const HEADS = (sel, nameSel, pathSel, tipOf) => [...document.querySelectorAll(sel)].filter((h) => h.getClientRects().length && h.querySelector(nameSel)).map((hd) => {
  const n = hd.querySelector(nameSel), p = hd.querySelector(pathSel), kids = [...n.querySelectorAll(':scope>.rn-h, :scope>.rn-t')];
  return { name: n.textContent, cut: (kids.length ? kids : [n]).some(CUT), path: !!p && p.getBoundingClientRect().width > 1, tip: tipOf(hd), font: parseFloat(getComputedStyle(n).fontSize) };
});
const FLAT_HEADS = () => HEADS('#stage .room-head', '.room-name', '.room-path', (h) => h.dataset.tip || '');
/* the same for the Real office signs (the continued sign of a split folder carries no path) */
const SIGNS = () => HEADS('#stage .ro-sign:not(.ro-stag)', ':scope>b', ':scope>.ro-path', (h) => h.dataset.tip || '');

module.exports = async (ctx) => {
  const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-097-textfit-'));
  const H = helpers(ctx);
  const { js } = H;
  const problems = [];
  const bad = (m) => { problems.push(m); console.log('[textfit] FAIL', m); };
  for (const [w, h] of SIZES) for (const [world, wq] of WORLDS) {
    const tag = `${world} ${w}x${h}`;
    if (wq === null) await H.load({ w, h, query: { officeview: undefined } });
    else {
      await H.load({ w, h, query: { officeview: 'real', ...wq }, ready: `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`, readyMs: 30000, settle: false });
      assert.ok(await H.until(`[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`, 15000), `${tag}: the pictures load`);
      await ctx.sleep(1200); /* the lobby's chips are placed after the pictures */
    }
    const heads = await js(`(()=>{const CUT=${CUT},HEADS=${HEADS};return (${wq === null ? FLAT_HEADS : SIGNS})();})()`);
    assert.ok(heads.length >= 4, `${tag}: room headers are drawn (${heads.length})`);
    for (const hd of heads) {
      if (hd.cut && hd.path) bad(`${tag}: a cut name hides its path: "${hd.name}" is cut and its path still shows (#2011)`);
      if (hd.cut && !hd.tip.includes(hd.name)) bad(`${tag}: a cut name has the whole name in its tooltip: "${hd.name}" not in "${hd.tip}"`);
      if (hd.font < 10.5) bad(`${tag}: head text under 10.5 px: ${hd.font}`);
    }
    if (wq === null) {
      const pb = await js(`(()=>{const p=document.querySelector('#stage .place.postbox'),n=p&&p.querySelector('.pn');return {named:!!n&&n.getClientRects().length>0,cut:!!n&&n.scrollWidth>n.clientWidth+0.5,w:p?p.getBoundingClientRect().width:0}})()`);
      if (!pb.named || pb.cut) bad(`${tag}: the Postbox tile shows its name, whole: ${JSON.stringify(pb)} (#2014)`);
      /* (#2018, #2041) the row of places shares its width by need: a place name is whole while the row has free width (a tile whose content leaves 8 px or more of its width unused),
         and a people chip never reads as fewer than 3 letters plus the ellipsis unless the whole name is shorter; the whole name is in the chip's title and label */
      const row = await js(`(()=>{const R=[...document.querySelectorAll('#stage .lobby .place:not(.postbox)')].filter(p=>p.getClientRects().length).map(p=>{const n=p.querySelector('.pn'),pb=p.getBoundingClientRect(),cs=getComputedStyle(p),inner=pb.width-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight)-2,used=n?[...p.querySelectorAll('.plh>*')].reduce((t,e)=>t+e.getBoundingClientRect().width,0)+7*(p.querySelectorAll('.plh>*').length-1):0,fs=n?parseFloat(getComputedStyle(n).fontSize):99;
        const r=document.createRange();if(n)r.selectNodeContents(n);
        return {id:p.dataset.place,full:n?n.textContent:'',cut:!!n&&(n.scrollWidth>n.clientWidth||r.getBoundingClientRect().width>n.getBoundingClientRect().width+0.05),slack:p.dataset.place==='boss'||p.classList.contains('postbox')?0:inner-used,font:fs,
          chips:[...p.querySelectorAll('.pv:not(.pv-more)')].map(c=>{const t=c.querySelector('.pv-n');return {shown:t?t.textContent:'',cut:!!t&&t.scrollWidth>t.clientWidth+0.5,title:c.title||'',label:c.getAttribute('aria-label')||c.title||''}})};});
        const bo=document.querySelector('#stage .lobby .place.boss'),iw=parseFloat(((document.querySelector('#stage .lobby')||{}).style||{}).getPropertyValue('--iw'))||54;
        return {tiles:R,bossGive:bo?Math.floor(bo.getBoundingClientRect().width)-Math.max(194,3*iw+32):0,slackMax:Math.max(0,...R.filter(t=>!t.chips.length&&!/^(boss|coffee|bank)$/.test(t.id)).map(t=>t.slack))}})()`);
      for (const t of row.tiles) {
        if (t.font < 10.5) bad(`${tag}: lobby text under 10.5 px: ${t.font}`);
        if (t.cut && row.bossGive >= 1) bad(`${tag}: a place name is whole while the Boss tile can still give: "${t.full}" is cut and the Boss is ${row.bossGive} px above its minimum (#2078)`);
        if (t.cut && row.slackMax >= 8) bad(`${tag}: a place name is whole while the row has room: "${t.full}" is cut and a tile beside it has ${row.slackMax.toFixed(0)} px unused (#2018, #2041)`);
        for (const c of t.chips) {
          const m = c.title.match(/^(\S+)/); const name = m ? m[1] : '';
          if (c.shown.replace(/…$/, '').length < 3 && c.shown !== name) bad(`${tag}: a people chip shows 3 letters or the whole name: "${c.shown}" at ${t.id} (#2018)`);
          if (!c.label.includes(name)) bad(`${tag}: a people chip has the whole name in its label: ${name}`);
        }
      }
    } else {
      const chips = await js(`(()=>{const ro=document.querySelector('#stage .ro'),o=ro.getBoundingClientRect(),R=e=>{const b=e.getBoundingClientRect();return {x0:b.left-o.left,x1:b.right-o.left,y0:b.top-o.top,y1:b.bottom-o.top}};
        const top=Math.min(...[...ro.querySelectorAll('.ro-sign')].filter(e=>e.getClientRects().length).map(e=>R(e).y0));
        return {top,chips:[...ro.querySelectorAll('.ro-chip')].filter(e=>e.getClientRects().length).map(c=>({name:c.dataset.name,shown:(c.querySelector('.ro-cn')||c).textContent,r:R(c),title:c.title||c.getAttribute('aria-label')||''}))}})()`);
      assert.ok(chips.chips.length >= 8, `${tag}: the lobby has its visitors' chips (${chips.chips.length})`);
      for (const c of chips.chips) {
        if (c.shown !== c.name) bad(`${tag}: name chips are whole: "${c.shown}" for ${c.name} (#2012)`);
        if (c.shown !== c.name && !c.title.includes(c.name)) bad(`${tag}: a cut chip has its whole name in its title: ${c.name}`);
        if (c.r.y1 > chips.top - 2) bad(`${tag}: name chips stay clear of the frame line: ${c.name} bottom ${c.r.y1.toFixed(1)}, first sign top ${chips.top.toFixed(1)} (#2013)`);
      }
    }
    if (world === 'photo' && w === 1440) {
      /* the fit key holds the sign's counts and cost text (review of #2017): under the DejaVu faces forced, with the counts' side made wide enough to cut every name, a status
         update that changes a sign's counts text must measure that sign again and drop its path (`nopath`); a key without the count text leaves it as it was (mutant `nokey`) */
      await js(`(()=>{const s=document.createElement('style');s.id='tf-dejavu';s.textContent='.ro-sign,.ro-sign b{font-family:"DejaVu Sans"!important}.ro-sign .ro-path{font-family:"DejaVu Sans Mono"!important}.ro-sign .ro-sc{margin-left:300px!important}';document.head.appendChild(s)})()`);
      const scs = () => js(`Object.fromEntries([...document.querySelectorAll('#stage .ro-sign:not(.ro-stag):not(.short)')].filter(e=>e.querySelector('.ro-path')).map(e=>[e.dataset.folder,[e.querySelector('.ro-sc').textContent,e.classList.contains('nopath')]]))`);
      /* the fit key holds the counts text by length: same-length texts must be as wide (tabular figures; DejaVu's own digits are already tabular, so the width itself cannot tell, the rule is asserted) */
      const tab = await js(`[...document.querySelectorAll('#stage .ro-sign .ro-sc')].map(e=>getComputedStyle(e).fontVariantNumeric)`);
      if (!tab.length || tab.some((v) => !/tabular-nums/.test(v))) bad(`${tag}: the counts and the cost have tabular figures (${JSON.stringify(tab)})`);
      /* a status update that makes a sign's counts text LONGER (a state with no pill yet gets one) measures that sign again: it must drop its path; a shorter or equal text costs no read (growKey) */
      const plates = await js(`[...document.querySelectorAll('#stage .ro-plate')].filter(x=>x.dataset.state==='working').map(x=>x.dataset.id)`);
      let grownSeen = 0;
      for (const id of plates.slice(0, 10)) {
        const before = await scs();
        await js(`window.__durbarSimEmit({type:'status',sessionId:${jsLiteral(id)},timestamp:Date.now(),status:'error'})`);
        await H.until(`(document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(${jsLiteral(id)})+'"]')||{dataset:{}}).dataset.state!=='working'`, 8000);
        await ctx.sleep(500);
        const after = await scs();
        for (const k of Object.keys(after)) if (before[k] && after[k][0].length > before[k][0].length) { grownSeen++; if (!after[k][1]) bad(`${tag}: a sign whose counts grew is measured again and drops its path (count text key): ${k}`); }
        if (grownSeen) break;
      }
      assert.ok(grownSeen >= 1, `${tag}: a status update made a sign's counts text longer`);
      await js(`document.getElementById('tf-dejavu').remove()`);
    }
    const scroll = await js(`(()=>{const f=document.getElementById('floor');return f.scrollHeight-f.clientHeight>1})()`);
    if (scroll) bad(`${tag}: the office scrolls`);
    await H.shot(path.join(OUT, `097-textfit-${world}-${w}x${h}.png`), { prep: 'calm' });
  }
  assert.strictEqual(problems.length, 0, problems.length + ' text-fit problems:\n' + problems.join('\n'));
  console.log('[textfit] checks passed; shots in', OUT);
};
