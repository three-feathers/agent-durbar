/*
 * Spec 001 FR-180 (issue #790): while a status pill filters, the office and the List say so and offer Show all. Simulator only
 * (no AI credits, no agent app). Linux with xvfb-run:
 *
 *   npm run check:ui -- --only check-status-filter
 *
 * At 1440x900 and 1280x800 (SIM=15): with no pill on there is no notice and Noor and Maya (done, on the lounge couch) are shown; the Idle
 * pill shows "Showing only idle · N hidden · Show all" (N is the other four pills' counts added up, an independent source), the notice
 * is at least 10.5px, sits above the first room and covers nothing, the page rules still hold (no overlap, no scrolling), the lounge of
 * the hidden finished agents is not drawn and the layout is not sized for it (`sizingLounges` is 0, 2 without the pill), and a screen
 * reader is told once; Show all (the same toggle as the pill: focus goes back to it) brings Noor and Maya back to the lounge and the
 * notice goes. The Done pill keeps the lounge (the layout is sized for it). In List the same notice shows above the rows, the rows leave
 * out Noor and Maya, and Show all brings both back. Every wait is until() and its result is asserted. A miss prints DRIVER FAILED
 * (Electron still exits 0), so the npm script exits non-zero unless "all checks passed" is printed.
 * The suite entry `check-status-filter retro` (DRIVER_WORLD set, spec 102 delta 2026-11-11, issue 1559) skips the flat behaviour above and
 * measures, in the arcade at both sizes, the office notice and the List notice (text, bold part, Show all) and the List's empty line at 4.5:1,
 * with an opaque colour, no opacity and an underline that is drawn; FILTER_MUTANT=old puts the old colours back (it must fail).
 *   OUT=docs/screenshots  (optional) also saves 001-status-filter-{1440x900,1280x800}.png
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { helpers, jsLiteral, CHECK_DARK } = require('./driver-helpers');
const { pageCheck } = require('./check-office-overlap.js');
const OUT = process.env.OUT || require('os').tmpdir();

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const ok = async (expr, what, ms) => assert.ok(await until(expr, ms || 8000), what);
  const ARCADE = !!process.env.DRIVER_WORLD;
  fs.rmSync(path.join(OUT, 'statusfilter-contrast.txt'), { force: true });
  const pill = (k) => `.stat[data-k="${k}"]`;
  const clickPill = (k) => js(`document.querySelector(${jsLiteral(pill(k))}).click()`);
  const count = (k) => js(`+document.querySelector(${jsLiteral(pill(k) + ' b')}).textContent`);
  const note = () => js(`(()=>{const e=document.getElementById('filterNote');return e&&!e.hidden&&e.getClientRects().length?e.textContent.replace(/\\s+/g,' ').trim():null})()`);
  const listNote = () => js(`(()=>{const e=document.querySelector('#list .filter-note');return e?e.textContent.replace(/\\s+/g,' ').trim():null})()`);
  const names = (where) => js(`[...document.querySelectorAll(${jsLiteral(where)})].map(e=>e.dataset.id)`);
  const idOf = (name) => js(`(window.__durbarSimUi.agents().find(a=>!a.parent&&a.name===${jsLiteral(name)})||{}).id`);
  const inLounge = (id) => js(`!!document.querySelector('#stage .lounge .desk.shut[data-id="'+CSS.escape(${jsLiteral(id)})+'"]')`);
  const inList = (id) => js(`!!document.querySelector('#list .lrow[data-id="'+CSS.escape(${jsLiteral(id)})+'"]')`);

  for (const [w, h] of ARCADE ? [] : [[1440, 900], [1280, 800]]) {
    const tag = `${w}x${h}`;
    await H.load({ w, h });
    await H.calm({ blur: true });
    await js(`(()=>{window.__ann=[];new MutationObserver(()=>{const t=document.getElementById('srAnnounce').textContent;if(t)window.__ann.push(t);}).observe(document.getElementById('srAnnounce'),{childList:true,characterData:true,subtree:true});})()`);
    const noor = await idOf('Noor'), maya = await idOf('Maya');
    assert.ok(noor && maya, `${tag}: the simulator has Noor and Maya`);

    // no filter: no notice, the finished agents rest in the lounge, the layout is sized for their lounges
    assert.strictEqual(await note(), null, `${tag}: no notice without a filter`);
    await ok(`!!document.querySelector('#stage .lounge')`, `${tag}: the lounge is drawn`);
    assert.ok(await inLounge(noor) && await inLounge(maya), `${tag}: Noor and Maya rest in the lounge`);
    assert.strictEqual(await js(`window.__durbarSimUi.sizingLounges()`), 2, `${tag}: the layout is sized for two lounges without a filter`);
    const mains0 = await js(`window.__durbarSimUi.sizingMains()`);

    // Idle pill: the notice, no lounge, no reserved lounge width
    const hiddenIdle = (await count('working')) + (await count('waiting')) + (await count('error')) + (await count('done'));
    const needIdle = (await count('waiting')) + (await count('error')); // hidden agents that need you (the inbox's predicate: waiting, error, limit; the simulator has no limit)
    assert.ok(needIdle >= 1, `${tag}: the simulator has an agent that needs you`);
    const needWord = `${needIdle} ${needIdle === 1 ? 'needs' : 'need'} you`;
    await clickPill('idle');
    await ok(`document.getElementById('filterNote')&&!document.getElementById('filterNote').hidden`, `${tag}: the notice shows`);
    assert.strictEqual(await note(), `Showing only idle · ${hiddenIdle} hidden (${needWord}) · Show all`, `${tag}: notice text: ${await note()}`);
    await H.settle(); await H.settleWalk();
    assert.strictEqual(await js(`document.querySelectorAll('#stage .lounge, #stage .desk.shut, #stage .units.has-shut').length`), 0, `${tag}: no lounge and no empty lounge band under the Idle pill`);
    assert.ok(!(await inLounge(noor)) && !(await inLounge(maya)), `${tag}: Noor and Maya are hidden by the filter`);
    assert.strictEqual(await js(`window.__durbarSimUi.sizingLounges()`), 0, `${tag}: the layout reserves no lounge width for hidden rolled agents`);
    assert.strictEqual(await js(`window.__durbarSimUi.sizingMains()`), mains0, `${tag}: the cards are still sized for every desk, so a pill does not reshape them`);
    const g = await js(`(()=>{const n=document.getElementById('filterNote'),r=n.getBoundingClientRect(),f=document.getElementById('floor').getBoundingClientRect(),first=document.querySelector('#stage > *'),q=first.getBoundingClientRect();return {font:parseFloat(getComputedStyle(n).fontSize),top:r.top,bottom:r.bottom,left:r.left,right:r.right,fl:f.left,fr:f.right,ft:f.top,qtop:q.top,over:document.documentElement.scrollHeight-innerHeight,btn:!!n.querySelector('button.fn-all')}})()`);
    assert.ok(g.font >= 10.5, `${tag}: notice text is at least 10.5px: ${g.font}`);
    assert.ok(g.top >= g.ft && g.left >= g.fl && g.right <= g.fr, `${tag}: the notice is inside the floor: ${JSON.stringify(g)}`);
    assert.ok(g.bottom <= g.qtop + 0.5, `${tag}: the notice does not cover the first room: ${JSON.stringify(g)}`);
    assert.ok(g.btn && g.over <= 0, `${tag}: Show all is a button and the page does not scroll: ${JSON.stringify(g)}`);
    const probs = (await js(`(${pageCheck.toString()})(false, 5)`)).problems;
    assert.deepStrictEqual(probs, [], `${tag}: page rules under the Idle pill: ${probs.join('; ')}`);
    await ok(`window.__ann.some(t=>t.startsWith('Showing only idle.')&&t.includes(' '+${jsLiteral(String(hiddenIdle))}+' hidden, '+${jsLiteral(needWord)}))`, tag + ': a screen reader is told');
    assert.strictEqual(await js(`window.__ann.filter(t=>/Showing only/.test(t)).length`), 1, `${tag}: told once`);
    if (w === 1440) await H.shot(path.join(OUT, `001-status-filter-${tag}.png`), { prep: 'calm', settle: true, blur: true, tag: 'statusfilter' });

    // Show all: the pill's own toggle
    await js(`document.querySelector('#filterNote .fn-all').click()`);
    await ok(`document.getElementById('filterNote').hidden`, `${tag}: the notice goes`);
    assert.strictEqual(await js(`document.querySelector(${jsLiteral(pill('idle'))}).getAttribute('aria-pressed')`), 'false', `${tag}: the pill is off`);
    assert.strictEqual(await js(`document.activeElement&&document.activeElement.dataset&&document.activeElement.dataset.k`), 'idle', `${tag}: focus goes to the pill`);
    await ok(`!!document.querySelector('#stage .lounge .desk.shut')`, `${tag}: the lounge is back`);
    assert.ok(await inLounge(noor) && await inLounge(maya), `${tag}: Noor and Maya are back in the lounge`);
    assert.strictEqual(await js(`window.__durbarSimUi.sizingLounges()`), 2, `${tag}: sized for two lounges again`);
    assert.strictEqual(await js(`document.getElementById('floor').classList.contains('has-fnote')`), false, `${tag}: the floor gives the line back`);
    await ok(`window.__ann.some(t=>/Showing all agents/.test(t))`, `${tag}: Show all is announced`);

    // Done pill: the finished agents are shown, the lounge stays and the layout is sized for it
    const hiddenDone = (await count('working')) + (await count('waiting')) + (await count('error')) + (await count('idle'));
    await clickPill('done');
    await ok(`document.getElementById('filterNote')&&!document.getElementById('filterNote').hidden`, `${tag}: the notice shows for Done`);
    const needDone = (await count('waiting')) + (await count('error'));
    assert.strictEqual(await note(), `Showing only done · ${hiddenDone} hidden (${needDone} ${needDone === 1 ? 'needs' : 'need'} you) · Show all`, `${tag}: Done notice: ${await note()}`);
    await ok(`!!document.querySelector('#stage .lounge .desk.shut')`, `${tag}: Done shows the lounge`);
    assert.strictEqual(await js(`window.__durbarSimUi.sizingLounges()`), 2, `${tag}: Done keeps the lounge width`);
    await clickPill('done');
    await ok(`document.getElementById('filterNote').hidden`, `${tag}: the Done notice goes with its pill`);

    // the Error pill hides only waiting agents that need you: singular wording, the count of the Waiting pill
    const waitN = await count('waiting');
    const allMains = (await count('working')) + waitN + (await count('idle')) + (await count('error')) + (await count('done'));
    await clickPill('error');
    await ok(`document.getElementById('filterNote')&&!document.getElementById('filterNote').hidden`, `${tag}: the notice shows for Error`);
    assert.strictEqual(await note(), `Showing only error · ${allMains - (await count('error'))} hidden (${waitN} ${waitN === 1 ? 'needs' : 'need'} you) · Show all`, `${tag}: Error notice: ${await note()}`);
    await clickPill('error');
    await ok(`document.getElementById('filterNote').hidden`, `${tag}: the Error notice goes with its pill`);

    // List
    await js(`document.getElementById('vList').click()`);
    await ok(`document.body.classList.contains('list-mode')&&document.querySelectorAll('#list .lrow[data-id]').length>=15`, `${tag}: the list is shown`);
    assert.strictEqual(await listNote(), null, `${tag}: no notice in the list without a filter`);
    assert.ok(await inList(noor) && await inList(maya), `${tag}: List shows Noor and Maya`);
    await clickPill('idle');
    await ok(`!!document.querySelector('#list .filter-note')`, `${tag}: the notice shows in the list`);
    assert.strictEqual(await listNote(), `Showing only idle · ${hiddenIdle} hidden (${needWord}) · Show all`, `${tag}: List notice: ${await listNote()}`);
    assert.ok(!(await inList(noor)) && !(await inList(maya)), `${tag}: List leaves out Noor and Maya under the Idle pill`);
    assert.strictEqual(await js(`document.querySelectorAll('#list .lrow[data-id]').length`), 15 - hiddenIdle, `${tag}: List rows are the idle ones`);
    await js(`document.querySelector('#list .fn-all').click()`);
    await ok(`!document.querySelector('#list .filter-note')&&document.querySelectorAll('#list .lrow[data-id]').length>=15`, `${tag}: Show all clears the list notice`);
    assert.ok(await inList(noor) && await inList(maya), `${tag}: List shows Noor and Maya again`);
    await js(`document.getElementById('vOffice').click()`);
    await ok(`!document.body.classList.contains('list-mode')`, `${tag}: back to the office`);
    console.log(`[statusfilter] ${tag} ok`);
  }

  // Contrast of the note's three texts against their real background, Clean Office (the default) and the dark fixture theme (spec 102 T226): 12px text needs 4.5:1
  const contrast = (sel) => js(`(()=>{const rgb=c=>c.match(/[\\d.]+/g).map(Number);const lum=c=>{const [r,g,b]=c.map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});return 0.2126*r+0.7152*g+0.0722*b;};
    const e=document.querySelector(${jsLiteral(sel)});let bg=null;for(let n=e;n&&!bg;n=n.parentElement){const c=getComputedStyle(n).backgroundColor;const m=rgb(c);if(m.length<4||m[3]>0.99)bg=m.slice(0,3);}
    const fg=rgb(getComputedStyle(e).color).slice(0,3),a=lum(fg),b=lum(bg),r=(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);const al=rgb(getComputedStyle(e).color)[3];let op=1;for(let n=e;n;n=n.parentElement)op*=+getComputedStyle(n).opacity;return {alpha:al===undefined?1:al,op,fg:fg.join(','),bg:bg.join(','),ratio:Math.round(r*100)/100};})()`);
  // spec 102 delta 2026-11-11 (issue 1559): with DRIVER_WORLD set (the suite entry for the arcade) the Real office loads draw the arcade, and the notice is measured there at both sizes
  const LOOKS = ARCADE ? [['arcade', null, { officeview: 'real' }]] : [['clean-office', 'clean-office', null], [CHECK_DARK.id, CHECK_DARK, null]];
  for (const [theme, manifest, query] of LOOKS) {
    for (const [w, h] of query ? [[1440, 900], [1280, 800]] : [[1440, 900]]) {
      await H.load({ w, h, ...(query ? { query, ready: `!!document.querySelector('#stage .ro .ro-plate')`, readyMs: 30000 } : {}) });
      if (manifest) {
        await js(`window.THEME.setTheme(${jsLiteral(manifest)})`);
        await ok(`window.THEME.current().id===${jsLiteral(typeof manifest === 'string' ? manifest : manifest.id)}`, theme + ' applied');
      } else await ok(`document.documentElement.dataset.ui===document.documentElement.dataset.world`, theme + ': the arcade look is on');
      // mutants (each must fail by its own label): old = the pre-fix colours everywhere; list = only the List's notice; empty = only the empty lines
      const MUT = { old: 'html[data-ui="retro"][data-world] :is(.filter-note,.filter-note b,.filter-note .fn-all,.empty)', list: '#list .filter-note,#list .filter-note b,#list .filter-note .fn-all', empty: 'html[data-ui="retro"][data-world] .empty' }[process.env.FILTER_MUTANT || ''];
      if (MUT) await ctx.win.webContents.insertCSS(`${MUT}{color:var(--surface)!important}`);
      await clickPill('idle');
      await ok(`document.getElementById('filterNote')&&!document.getElementById('filterNote').hidden`, `${theme} ${w}x${h}: the notice shows`);
      await H.settle();
      const measure = async (what, sels) => {
        for (const sel of sels) {
          const c = await contrast(sel);
          console.log(`[statusfilter] ${theme} ${w}x${h} ${what} contrast ${sel}: ${c.fg} on ${c.bg} = ${c.ratio}:1`);
          fs.appendFileSync(path.join(OUT, 'statusfilter-contrast.txt'), `${theme} ${w}x${h} ${sel}: ${c.fg} on ${c.bg} = ${c.ratio}:1\n`);
          assert.ok(c.ratio >= 4.5, `${theme} ${w}x${h}: ${sel} contrast ${c.ratio}:1 is below 4.5:1`);
          assert.ok(c.alpha === 1 && c.op === 1, `${theme} ${w}x${h}: ${sel} is translucent (alpha ${c.alpha}, opacity ${c.op}): the measured ratio would not be the painted one`);
        }
      };
      await measure('office', ['#filterNote', '#filterNote b', '#filterNote .fn-all']);
      if (query) {
        assert.ok(await js(`getComputedStyle(document.querySelector('#filterNote .fn-all')).textDecorationLine.includes('underline')`), `${theme}: Show all is underlined (reads as a control)`);
        const shot = await js(`(()=>{const r=document.getElementById('filterNote').getBoundingClientRect();return {x:Math.max(0,Math.floor(r.x)),y:Math.max(0,Math.floor(r.y)),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`);
        const img = await ctx.win.webContents.capturePage(shot);
        fs.writeFileSync(path.join(OUT, `statusfilter-${theme}-${w}x${h}.png`), img.toPNG());
        // the List's copy of the notice (a different element, on --surface) and its empty line
        await js(`document.getElementById('vList').click()`);
        await ok(`document.body.classList.contains('list-mode')&&!!document.querySelector('#list .filter-note')`, `${theme} ${w}x${h}: the List notice shows`);
        await H.settle();
        await measure('list', ['#list .filter-note', '#list .filter-note b', '#list .filter-note .fn-all']);
        assert.ok(await js(`(()=>{const d=getComputedStyle(document.querySelector('#list .fn-all'));return d.textDecorationLine.includes('underline')&&!/rgba?\\([^)]*,\\s*0\\)$/.test(d.textDecorationColor)&&d.textDecorationColor!=='transparent'})()`), `${theme}: the List Show all underline is drawn`);
        const lr = await js(`(()=>{const r=document.querySelector('#list .list-wrap').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.min(120,Math.ceil(r.height))}})()`);
        fs.writeFileSync(path.join(OUT, `statusfilter-${theme}-list-${w}x${h}.png`), (await ctx.win.webContents.capturePage(lr)).toPNG());
        await js(`document.querySelector('#list .fn-all').click()`);
        // a pill together with a folder that has no agent of that status leaves the List's empty line
        let found = null;
        for (const k of ['done', 'error', 'waiting', 'idle', 'working']) {
          if (!(await js(`document.querySelector(${jsLiteral(pill(k))}).getAttribute('aria-pressed')`) === 'true')) await clickPill(k);
          for (const v of await js(`[...document.getElementById('wsFilter').options].map(o=>o.value).filter(v=>v!=='all')`)) {
            await js(`(()=>{const s=document.getElementById('wsFilter');s.value=${jsLiteral(v)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
            if (await until(`!!document.querySelector('#list .list-wrap>.empty')`, 800)) { found = `${k} in folder ${v}`; break; }
          }
          if (found) break;
          await clickPill(k);
        }
        console.log(`[statusfilter] ${theme} ${w}x${h} empty List: ${found}`);
        assert.ok(found, `${theme}: a status and folder with no agent exist in the simulator, for the List's empty line`);
        await ok(`!!document.querySelector('#list .list-wrap>.empty')`, `${theme} ${w}x${h}: the List empty line shows`);
        await H.settle();
        await measure('list-empty', ['#list .list-wrap>.empty']);
        const er = await js(`(()=>{const r=document.querySelector('#list .list-wrap>.empty').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y)-40,width:Math.ceil(r.width),height:Math.ceil(r.height)+80}})()`);
        fs.writeFileSync(path.join(OUT, `statusfilter-${theme}-empty-${w}x${h}.png`), (await ctx.win.webContents.capturePage(er)).toPNG());
      }
    }
  }
  console.log('[statusfilter] all checks passed');
};
