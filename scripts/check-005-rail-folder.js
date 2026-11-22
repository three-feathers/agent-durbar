/*
 * Spec 005 FR-340 (issue #1905, owner report 2026-11-19): with a chat open, the agent rail's two groups both read `iot-portal` (two paths, one last folder
 * name), a group head's hover was only the name and a session row's gave no folder. Simulator only (no AI credits). Needs the window's focus (the
 * keyboard step).
 *
 *   npm run check:ui -- --only check-005-rail-folder
 *   RAILF_MUTANT=title|nosuffix|nofocus|raw   the old behaviour put back in the page (each must fail, at its own label):
 *     title     native titles, no tooltip                          -> "no native title on a head or a row (one tooltip, not two)"
 *     nosuffix  no parent after an equal name                      -> "the two iot-portal groups read differently on screen"
 *     nofocus   the keyboard focus never reaches the tooltip       -> "keyboard focus on a group head shows its folder"
 *     raw       the tooltip's path is the raw one, not `~`         -> "the <parent> head's tooltip is its name and masked path"
 *
 * 16 folders with one session each (`simrooms=solo&simnames=alike`: two named iot-portal under ~/clients/acme and ~/clients/globex, one under
 * /Users/paco), a chat open, at 1440x900 and 1280x800 and the rail at its narrowest (180 px). It fails when: the two iot-portal heads read the same, or
 * a head with a unique name shows a parent; the parent is not visible (cut to nothing) at 180 px; a head or row keeps a native title; hover or keyboard
 * focus on a head does not show #appTip with the name and the masked path (`~`, no /Users/ or /home/); a row's tooltip does not name its folder; text
 * under 10.5 px; the rail's list scrolls sideways.
 */
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const MUTANT = process.env.RAILF_MUTANT || '';
const SIZES = [[1440, 900], [1280, 800]];
const Q = { sim: '16', simrooms: 'solo', simnames: 'alike', simfreeze: '1' };

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const ok = async (expr, what, ms) => assert.ok(await until(expr, ms || 6000), what);
  const wc = () => H.wc();
  const shown = `(()=>{const t=document.getElementById('appTip');return !!t&&!t.hidden&&t.getClientRects().length>0})()`;
  const hidden = `(()=>{const t=document.getElementById('appTip');return !t||t.hidden||!t.getClientRects().length})()`;
  const tipText = () => js(`document.getElementById('appTip').textContent`);
  const away = async () => { wc().sendInputEvent({ type: 'mouseMove', x: 1, y: 1 }); await ok(hidden, 'the pointer left the rail', 3000); };
  const hoverEl = async (sel, what) => {
    for (let i = 0; i < 4; i++) {
      await away();
      /* cause of the red seen on the 6th of 8 runs (the pointerover log held ONE event for four hovers and the tip's text was set but it was hidden): the tooltip hides on any scroll (tooltip.js, WCAG 1.4.13), and the rail was still scrolling (the page's own reveal of the selected row) after the pointer arrived; the tip then stays hidden while the pointer stays put, and a move to the same point raises no new pointerover. So: wait until the rail list has stopped scrolling, and make the pointer really leave (:hover false) before it comes back */
      await ok(`(()=>{const l=document.getElementById('stripList');if(!l)return true;const t=l.scrollTop,now=performance.now();if(window.__sp!==t){window.__sp=t;window.__spAt=now;}return now-(window.__spAt||0)>250})()`, 'the rail list stopped scrolling', 4000);
      await ok(`!document.querySelector(${jsLiteral(sel)}).matches(':hover')`, 'the pointer left the head', 3000);
      const p = await js(`(()=>{const r=document.querySelector(${jsLiteral(sel)}).getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
      wc().sendInputEvent({ type: 'mouseMove', x: p.x - 1, y: p.y }); wc().sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
      if (!(await until(`document.querySelector(${jsLiteral(sel)}).matches(':hover')`, 1500))) continue;
      /* seen twice (the sub-agent's mutant run, my first run), cause not proven: the pointer reached the head (:hover) and the tooltip was not shown; a real person would move the mouse again, so the helper does too (a new real mouse move, never a loosened assert: the caller still asserts the tooltip) */
      if (await until(shown, 1200)) return;
    }
    if (await until(`document.querySelector(${jsLiteral(sel)}).matches(':hover')`, 300)) {
      const d = await js(`(()=>{const e=document.querySelector(${jsLiteral(sel)}),r=e.getBoundingClientRect(),t=document.getElementById('appTip');const at=document.elementFromPoint(Math.round(r.left+r.width/2),Math.round(r.top+r.height/2));return {log:(window.__pov||[]).slice(-12),at:at?at.tagName+'.'+String(at.className).slice(0,40):null,inHead:!!(at&&e.contains(at)),tip:t?{hidden:t.hidden,text:t.textContent.slice(0,40)}:null,focus:document.hasFocus(),hasTip:e.hasAttribute('data-tip'),active:document.activeElement&&document.activeElement.tagName}})()`);
      console.log('[rail-folder] hovered but no tooltip after 4 real hovers: ' + JSON.stringify(d));
      return; /* the caller's assert says so */
    }
    assert.fail(`the pointer never reached ${what}`);
  };
  const noHome = (t) => !/(^|\s)(\/Users\/|\/home\/|[A-Za-z]:\\Users)/.test(t);
  const headSel = (id) => `#stripList .rg-h[data-rgfold=${JSON.stringify(id)}]`;

  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    await H.load({ w, h, query: Q, ready: `document.querySelectorAll('#stage .desk[data-id]').length>=16`, readyMs: 30000, focus: true });
    await js(`(()=>{window.__pov=[];window.addEventListener('scroll',e=>{window.__pov.push('SCROLL:'+((e.target&&e.target.id)||(e.target&&e.target.nodeName))+'@'+Math.round(performance.now()))},true);document.addEventListener('pointerover',e=>{window.__pov.push((e.target.className&&String(e.target.className).slice(0,30)||e.target.tagName)+'@'+Math.round(performance.now()))},true);})();0`);
    await H.needFocus(tag);
    await js(`document.querySelector('#stage .desk[data-id]').click()`);
    await ok(`document.body.classList.contains('panel-open')&&document.querySelectorAll('#stripList .rg-h').length>=16`, `${tag}: a chat is open and the rail lists 16 folders`, 15000);
    if (MUTANT === 'title') await js(`(()=>{for(const e of document.querySelectorAll('#stripList [data-tip]')){e.title=e.dataset.tip.split('\\n')[0];e.removeAttribute('data-tip');}})()`);
    if (MUTANT === 'nosuffix') await js(`(()=>{for(const e of document.querySelectorAll('#stripList .rg-p'))e.remove();})()`);
    if (MUTANT === 'nofocus') await js(`window.addEventListener('focusin',e=>e.stopImmediatePropagation(),true)`);
    if (MUTANT === 'raw') await js(`(()=>{for(const e of document.querySelectorAll('#stripList .rg-h[data-tip]'))e.dataset.tip=e.dataset.tip.replace(/\\n~/,'\\n/Users/paco');})()`);

    for (const rail of ['220px', '180px']) {
      await js(`document.documentElement.style.setProperty('--rail-w',${jsLiteral(rail)})`);
      await ok(`Math.round(document.querySelector('.rail').getBoundingClientRect().width)===${jsLiteral(parseInt(rail, 10))}`, `${tag}: the rail is ${rail} wide`);
      const R = await js(`(()=>{const hs=[...document.querySelectorAll('#stripList .rg-h')].map(h=>{const n=h.querySelector('.rg-n'),p=h.querySelector('.rg-p');return {name:n.textContent,par:p?p.textContent:'',parW:p?Math.round(p.getBoundingClientRect().width):0,nameW:Math.round(n.getBoundingClientRect().width),text:h.innerText.replace(/\\s+/g,' ').trim(),label:h.getAttribute('aria-label'),title:h.getAttribute('title')||'',font:parseFloat(getComputedStyle(n).fontSize),over:h.scrollWidth>h.clientWidth+1}});
        const rows=[...document.querySelectorAll('#stripList .sitem')].map(r=>({title:r.getAttribute('title')||'',tip:r.dataset.tip||''}));const l=document.getElementById('stripList');return {hs,rows,sideways:l.scrollWidth>l.clientWidth+1};})()`);
      const eq = R.hs.filter((x) => x.name === 'iot-portal');
      assert.strictEqual(eq.length, 2, `${tag} ${rail}: two groups are named iot-portal`);
      assert.notStrictEqual(eq[0].text, eq[1].text, `${tag} ${rail}: the two iot-portal groups read differently on screen: "${eq[0].text}" / "${eq[1].text}"`);
      assert.ok(eq.every((x) => x.par && x.parW > 0), `${tag} ${rail}: each shows its parent, not cut to nothing: ${JSON.stringify(eq)}`);
      assert.deepStrictEqual(eq.map((x) => x.par.replace(/^[·\s]+/, '')).sort(), ['acme', 'globex'], `${tag} ${rail}: the parents are acme and globex`);
      assert.ok(eq.every((x) => /\(acme\)|\(globex\)/.test(x.label)), `${tag} ${rail}: the accessible name has the parent: ${eq.map((x) => x.label).join(' / ')}`);
      assert.ok(R.hs.filter((x) => x.name !== 'iot-portal').every((x) => !x.par), `${tag} ${rail}: a unique name shows no parent`);
      assert.ok(R.hs.every((x) => x.font >= 10.5 && !x.over), `${tag} ${rail}: rail text at least 10.5px and no head overflows`);
      assert.ok(R.hs.every((x) => x.title === '') && R.rows.every((x) => x.title === ''), `${tag} ${rail}: no native title on a head or a row (one tooltip, not two)`);
      assert.ok(!R.sideways, `${tag} ${rail}: the rail's list does not scroll sideways`);
    }
    await js(`document.documentElement.style.removeProperty('--rail-w')`);

    /* ---- hover ---- */
    const ids = await js(`[...document.querySelectorAll('#stripList .rg-h')].filter(h=>h.querySelector('.rg-n').textContent==='iot-portal').map(h=>h.dataset.rgfold)`);
    const want = { acme: '~/clients/acme/iot-portal', globex: '~/clients/globex/iot-portal' };
    for (const id of ids) {
      const par = (await js(`document.querySelector(${jsLiteral(headSel(id))}).querySelector('.rg-p').textContent`)).replace(/^[·\s]+/, '');
      await hoverEl(headSel(id), `the ${par} iot-portal head`);
      await ok(shown, `${tag}: hovering a group head shows its folder (${par})`, 2000);
      const t = await tipText();
      assert.strictEqual(t, 'iot-portal\n' + want[par], `${tag}: the ${par} head's tooltip is its name and masked path (${JSON.stringify(t)})`);
    }
    const home = await js(`(()=>{const h=[...document.querySelectorAll('#stripList .rg-h')].find(x=>x.querySelector('.rg-n').textContent==='2026-07-offsite');return h?h.dataset.rgfold:null})()`);
    assert.ok(home, `${tag}: the folder under /Users/paco is listed`);
    await hoverEl(headSel(home), 'the 2026-07-offsite head');
    await ok(shown, `${tag}: hovering a group head shows its folder (home folder)`, 2000);
    const ht = await tipText();
    assert.ok(noHome(ht) && /\n~\/work\/2026-07-offsite$/.test(ht), `${tag}: the path is masked, home as ~ (${JSON.stringify(ht)})`);
    await hoverEl('#stripList .sitem', 'a session row');
    await ok(shown, `${tag}: hovering a session row shows a tooltip`, 2000);
    const rt = await tipText();
    assert.ok(/\nFolder: ~\//.test(rt) && noHome(rt), `${tag}: a session row's tooltip names its folder, masked (${JSON.stringify(rt)})`);
    await away();

    /* ---- keyboard ---- */
    await H.key('Shift', [], { pause: 40 });
    await js(`document.activeElement&&document.activeElement.blur&&document.activeElement.blur();document.querySelector(${jsLiteral(headSel(ids[0]))}).focus()`);
    await ok(shown, `${tag}: keyboard focus on a group head shows its folder`, 2000);
    assert.ok(/^iot-portal\n~\/clients\//.test(await tipText()), `${tag}: the focused head's tooltip is its name and path`);
    await H.key('Escape', [], { pause: 60 });
    await ok(hidden, `${tag}: Escape hides it`);
    await js(`document.querySelector('#stripList .sitem').focus()`);
    await ok(shown, `${tag}: keyboard focus on a session row shows its folder`, 2000);
    assert.ok(/\nFolder: ~\//.test(await tipText()), `${tag}: the focused row's tooltip names its folder`);
    await js(`document.activeElement.blur()`);
    await H.shot(`${process.env.OUT || require('os').tmpdir()}/1905-rail-${tag}.png`, { prep: 'mouse', delay: 300 });
  }
  console.log('check-005-rail-folder: all checks passed');
};
