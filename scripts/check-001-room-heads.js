/*
 * Spec 001 FR-270, FR-271 (issue #1905, owner report 2026-11-19): with many folders the narrower room heads cut the name to a few letters, several
 * start alike, hovering the head gave nothing, and the keyboard gave nothing. Simulator only (no AI credits, no agent app). Needs the window's focus
 * (the keyboard step).
 *
 *   npm run check:ui -- --only check-001-room-heads
 *   HEADS_MUTANT=title|onepiece|nofocus|raw|sign   the old behaviour put back in the page (each must fail, at its own label):
 *     title     no `data-tip`, the old native title on the name only          -> "no native title on the name (one tooltip, not two)"
 *     onepiece  the name is one piece again (cut at the end)                  -> "a cut name keeps its tail whole"
 *     nofocus   the keyboard focus never reaches the tooltip                  -> "keyboard focus on a head's control shows its tooltip"
 *     raw       the tooltip's path is the raw one, not `~`                    -> "the path is masked, home as ~"
 *     sign      the Real office sign loses its `data-tip` (native title again) -> "the sign of <folder> says its folder, masked"
 *
 * 16 folders with one agent each (`simrooms=solo&simnames=alike`: names that start alike, two named iot-portal, one under /Users/paco, which must
 * read ~), at 1440x900 and 1280x800, Open office and Real office. It fails when:
 *   - a head cut at the end of its name: the tail (DurbarCutText.nameTail) is not wholly visible and at least 6 characters; two cut heads whose
 *     names differ read the same (their visible start plus tail); a head overflows its box; text under 10.5 px; the office scrolls or does not fit;
 *   - hovering a head's name, its path, its empty part or its floor chip does not show #appTip with the folder's name and its path (masked, home as
 *     ~, no /Users/ or /home/); hovering a button of the head shows the head's tip (it has its own); a native title is left on the name or the path;
 *   - keyboard focus on the head's control does not show it, or Escape does not hide it;
 *   - the Real office sign (every folder) lacks the same, or its cut name hides its tail.
 */
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const MUTANT = process.env.HEADS_MUTANT || '';
const SIZES = [[1440, 900], [1280, 800]];
const Q = { sim: '16', simrooms: 'solo', simnames: 'alike', simfreeze: '1' };

/* in the page: what each head of the flat office shows (name, whether it is cut, the text a reader sees, its tail) */
const READ_HEADS = () => {
  const cv = document.createElement('canvas').getContext('2d');
  const out = [];
  for (const hd of document.querySelectorAll('#stage .room-head')) {
    const n = hd.querySelector('.room-name'); if (!n || !n.getClientRects().length) continue;
    const h = n.querySelector(':scope>.rn-h'), t = n.querySelector(':scope>.rn-t');
    const full = n.textContent, box = h || n, cs = getComputedStyle(box);
    const cut = box.scrollWidth > box.clientWidth + 0.5;
    let visible = full;
    if (cut) {
      cv.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
      const room = box.clientWidth - cv.measureText('…').width, src = h ? h.textContent : full; let w = 0, k = 0;
      for (const ch of Array.from(src)) { w += cv.measureText(ch).width; if (w > room) break; k += ch.length; }
      visible = src.slice(0, k) + '…' + (t ? t.textContent : '');
    }
    const nb = n.getBoundingClientRect(), tb = t ? t.getBoundingClientRect() : null, hb = hd.getBoundingClientRect();
    out.push({
      id: hd.closest('.room').dataset.room, full, cut, visible, tail: t ? t.textContent : '', want: window.DurbarCutText.nameTail(full),
      tailWhole: !t || (tb.right <= nb.right + 0.5 && tb.left >= nb.left - 0.5), tailCut: !!t && t.scrollWidth > t.clientWidth + 0.5, overflow: [...hd.children].some((e) => e.getClientRects().length && e.getBoundingClientRect().right > hb.right + 1),
      font: parseFloat(cs.fontSize), title: n.getAttribute('title') || '', pathTitle: (hd.querySelector('.room-path') || { getAttribute: () => '' }).getAttribute('title') || '', tip: hd.dataset.tip || '',
    });
  }
  return { heads: out, fit: document.getElementById('stage').dataset.fit, floorScroll: document.getElementById('floor').scrollHeight - document.getElementById('floor').clientHeight };
};

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const ok = async (expr, what, ms) => assert.ok(await until(expr, ms || 6000), what);
  const wc = () => H.wc();
  const shown = `(()=>{const t=document.getElementById('appTip');return !!t&&!t.hidden&&t.getClientRects().length>0})()`;
  const hidden = `(()=>{const t=document.getElementById('appTip');return !t||t.hidden||!t.getClientRects().length})()`;
  const tipText = () => js(`document.getElementById('appTip').textContent`);
  const away = async () => { wc().sendInputEvent({ type: 'mouseMove', x: 1, y: 1 }); await ok(hidden, 'the pointer left every head', 3000); };
  /* the pointer onto (x, y), until the page has seen it over `sel` (the first moves can be lost while the OS activates the window) */
  const hoverAt = async (sel, pt, what) => {
    for (let i = 0; i < 4; i++) {
      await away();
      wc().sendInputEvent({ type: 'mouseMove', x: pt.x - 1, y: pt.y }); wc().sendInputEvent({ type: 'mouseMove', x: pt.x, y: pt.y });
      if (await until(`(()=>{const e=document.elementFromPoint(${jsLiteral(pt.x)},${jsLiteral(pt.y)});return !!e&&!!e.closest(${jsLiteral(sel)})&&document.querySelector(${jsLiteral(sel)}).matches(':hover')})()`, 1500)) return;
    }
    assert.fail(`the pointer never reached ${what}`);
  };
  /* the tip is for this folder: first line its name, second its path with ~ and no home prefix */
  const checkTip = (txt, name, what) => {
    const lines = txt.split('\n');
    assert.strictEqual(lines[0], name, `${what}: the tooltip's first line is the whole name (${JSON.stringify(txt)})`);
    assert.ok(/^(~|\/)/.test(lines[1] || ''), `${what}: the tooltip has the path on its second line (${JSON.stringify(txt)})`);
    assert.ok(!/(^|\s)(\/Users\/|\/home\/|[A-Za-z]:\\Users)/.test(txt), `${what}: the path is masked, home as ~ (${JSON.stringify(txt)})`);
  };

  let sawCutWhole = false;
  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    await H.load({ w, h, query: Q, ready: `document.querySelectorAll('#stage .room-head .room-name').length>=16`, readyMs: 30000, focus: true });
    await H.needFocus(tag);
    if (MUTANT === 'title') await js(`(()=>{for(const hd of document.querySelectorAll('#stage .room-head')){const n=hd.querySelector('.room-name');n.title=n.textContent+'\\n'+hd.dataset.tip.split('\\n')[1];hd.removeAttribute('data-tip');}})()`);
    if (MUTANT === 'onepiece') await js(`(()=>{for(const n of document.querySelectorAll('#stage .room-name'))n.textContent=n.textContent;})()`);
    if (MUTANT === 'nofocus') await js(`window.addEventListener('focusin',e=>e.stopImmediatePropagation(),true)`);
    if (MUTANT === 'raw') await js(`(()=>{for(const hd of document.querySelectorAll('#stage .room-head'))hd.dataset.tip=hd.dataset.tip.replace(/\\n~/,'\\n/Users/paco');})()`);

    /* ---- the cut names ---- */
    const R = await js(`(${READ_HEADS.toString()})()`);
    assert.strictEqual(R.heads.length, 16, `${tag}: 16 heads are drawn`);
    assert.ok(R.fit === 'ok' && R.floorScroll <= 1, `${tag}: the 16 folders fit the floor with no office scroll (fit ${R.fit}, scroll ${R.floorScroll})`);
    const cut = R.heads.filter((x) => x.cut);
    assert.ok(cut.length >= 5, `${tag}: the simulator's names are cut in at least 5 heads (${cut.length}); the check needs cut names`);
    for (const x of R.heads) {
      assert.ok(x.font >= 10.5, `${tag}: ${x.full}: text at least 10.5px (${x.font})`);
      assert.ok(!x.overflow, `${tag}: ${x.full}: no part of the head overflows it`);
      assert.strictEqual(x.title, '', `${tag}: ${x.full}: no native title on the name (one tooltip, not two)`);
      assert.strictEqual(x.pathTitle, '', `${tag}: ${x.full}: no native title on the path`);
    }
    for (const x of cut) {
      assert.ok(x.want.length >= 6 || x.full.length <= 12, `${tag}: the tail rule gives at least 6 characters for ${x.full} (${x.want})`);
      assert.ok(!x.tailCut, `${tag}: the tail of ${x.full} is not itself cut with an ellipsis (it shows "${x.visible}")`);
      assert.ok(x.tail === x.want && x.tailWhole, `${tag}: a cut name keeps its tail whole: ${x.full} shows "${x.visible}" (tail "${x.tail}", wanted "${x.want}", whole ${x.tailWhole})`);
    }
    const seen = new Map();
    for (const x of cut) { // names that differ must read differently, cut or not
      const same = [...seen.entries()].filter(([v, f]) => v === x.visible && f !== x.full);
      assert.strictEqual(same.length, 0, `${tag}: no two cut heads read the same: "${x.visible}" is ${x.full} and ${same.map((s) => s[1]).join(', ')}`);
      seen.set(x.visible, x.full);
    }
    console.log(`  ${tag}: cut heads read ${cut.map((x) => x.visible).join(' | ')}`);

    /* ---- hover: the name, the path or the empty part, a button ---- */
    const points = await js(`(()=>{const out=[];for(const hd of document.querySelectorAll('#stage .room-head')){const n=hd.querySelector('.room-name'),b=hd.getBoundingClientRect(),nb=n.getBoundingClientRect(),id=hd.closest('.room').dataset.room;
      const last=[...hd.children].filter(e=>e.getClientRects().length).map(e=>e.getBoundingClientRect().right);const rest=Math.max(...last);
      out.push({id,name:n.textContent,room:'.room[data-room='+JSON.stringify(id)+'] .room-head',nameAt:{x:Math.round(nb.left+nb.width/2),y:Math.round(nb.top+nb.height/2)},gap:{x:Math.round((rest+b.right)/2),y:Math.round(b.top+b.height/2)},gapWide:b.right-rest,
        more:(()=>{const m=hd.querySelector('.room-more');if(!m)return null;const r=m.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()});}return out})()`);
    for (const p of points) {
      await hoverAt(p.room, p.nameAt, `the name of ${p.name}`);
      await ok(shown, `${tag}: hovering the name of ${p.name} shows its tooltip`, 2000);
      checkTip(await tipText(), p.name, `${tag}: ${p.name} (name)`);
    }
    const pic = points.find((p) => p.name === 'iot-platform-form-2');
    await hoverAt(pic.room, pic.nameAt, `the name of ${pic.name} (the picture)`);
    await ok(shown, `${tag}: the tooltip of the cut head ${pic.name} shows (the picture)`, 2000);
    await H.shot(`${process.env.OUT || require('os').tmpdir()}/1905-heads-tip-${tag}.png`, { prep: 'none', delay: 300 });
    const wide = points.find((p) => p.gapWide >= 4);
    assert.ok(wide, `${tag}: a head has an empty part to hover`);
    await hoverAt(wide.room, wide.gap, `the empty part of ${wide.name}`);
    await ok(shown, `${tag}: hovering the empty part of a head shows its tooltip`, 2000);
    checkTip(await tipText(), wide.name, `${tag}: ${wide.name} (empty part)`);
    const hov = points.find((p) => p.more);
    await hoverAt(hov.room, hov.more, `the ⋯ button of ${hov.name}`);
    await ok(hidden, `${tag}: on a button of the head (which has its own tooltip) the head's tooltip steps back`, 2000);
    const ped = await js(`(()=>{const hd=document.querySelector(${jsLiteral(hov.room)});const b=hd.querySelector('.room-more');return {title:b.getAttribute('title'),label:b.getAttribute('aria-label')}})()`);
    assert.ok(ped.title && ped.label, `${tag}: the ⋯ button keeps its own title and name`);
    await away();

    /* ---- the keyboard: focus on a control of the head ---- */
    await H.key('Shift', [], { pause: 40 }); // keyboard modality, so :focus-visible applies
    const first = points.find((p) => p.name === 'iot-platform-form-2') || points[0];
    await js(`document.activeElement&&document.activeElement.blur&&document.activeElement.blur();document.querySelector(${jsLiteral(first.room + ' .room-more')}).focus()`);
    await ok(shown, `${tag}: keyboard focus on a head's control shows its tooltip`, 2000);
    checkTip(await tipText(), first.name, `${tag}: ${first.name} (focus)`);
    await H.key('Escape', [], { pause: 60 });
    await ok(hidden, `${tag}: Escape hides the head's tooltip`);
    await js(`document.activeElement.blur()`);
    await ok(hidden, `${tag}: focus away: no tooltip`);
    await H.shot(`${process.env.OUT || require('os').tmpdir()}/1905-heads-${tag}.png`, { prep: 'mouse', delay: 300 });

    /* ---- Real office: the sign says its folder and keeps its name's end ---- */
    await H.load({ w, h, query: { ...Q, officeview: 'real' }, ready: `document.querySelectorAll('#stage .ro-sign .ro-sc').length>=16`, readyMs: 30000, focus: true });
    await H.needFocus(tag + ' real');
    if (MUTANT === 'sign') await js(`(()=>{for(const s of document.querySelectorAll('#stage .ro-sign')){const b=s.querySelector('b');if(b)b.title=s.dataset.tip;s.removeAttribute('data-tip');}})()`);
    const S = await js(`(()=>[...document.querySelectorAll('#stage .ro-sign')].filter(s=>s.querySelector('.ro-sc')).map(s=>{const b=s.querySelector(':scope>b'),h=b.querySelector(':scope>.rn-h'),t=b.querySelector(':scope>.rn-t'),bb=b.getBoundingClientRect(),tb=t&&t.getBoundingClientRect(),r=s.getBoundingClientRect();
      return {name:b.textContent,bw:Math.round(bb.width),tip:s.dataset.tip||'',title:b.getAttribute('title')||'',tail:t?t.textContent:'',want:window.DurbarCutText.nameTail(b.textContent),whole:!t||(tb.right<=bb.right+0.5),tcut:!!t&&t.scrollWidth>t.clientWidth+0.5,cut:(h||b).scrollWidth>(h||b).clientWidth+0.5,
        at:{x:Math.round(bb.left+Math.min(bb.width,20)/2),y:Math.round(bb.top+bb.height/2)},id:s.dataset.folder,font:parseFloat(getComputedStyle(b).fontSize)};}))()`);
    assert.strictEqual(S.length, 16, `${tag} Real office: 16 folder signs are drawn`);
    for (const s of S) {
      assert.ok(s.tip.split('\n')[0] === s.name && !/\/Users\/|\/home\//.test(s.tip) && /\n(~|\/)/.test(s.tip), `${tag} Real office: the sign of ${s.name} says its folder, masked (${JSON.stringify(s.tip)})`);
      assert.strictEqual(s.title, '', `${tag} Real office: no native title on the sign's name`);
      assert.ok(s.tail === s.want, `${tag} Real office: ${s.name} is split at its tail rule (tail "${s.tail}", wanted "${s.want}")`);
      assert.ok(s.whole || s.tcut, `${tag} Real office: ${s.name}'s tail is whole, or cut with its own ellipsis when the sign is at its narrowest (FR-356), never clipped bare (sign name box ${s.bw}px)`);
      assert.ok(s.font >= 10.5, `${tag} Real office: sign text at least 10.5px (${s.font})`);
    }
    console.log(`  ${tag} Real office: ${S.filter((s) => s.cut).map((s) => s.name + (s.whole ? ' (tail whole)' : ' (tail cut, ' + s.bw + 'px)')).join(' | ')}`);
    sawCutWhole = sawCutWhole || S.some((s) => s.cut && s.whole); /* the arcade's signs have more room: none is cut at 1440x900 and one at 1280x800 (measured), so this is asked of the two sizes together, after the loop */
    const sg = S.find((s) => s.cut) || S[0];
    await hoverAt(`#stage .ro-sign[data-folder=${JSON.stringify(sg.id)}]`, sg.at, `the sign of ${sg.name}`);
    await ok(shown, `${tag} Real office: the Real office sign says its folder on hover (${sg.name})`, 2000);
    checkTip(await tipText(), sg.name, `${tag} Real office: ${sg.name}`);
    await H.shot(`${process.env.OUT || require('os').tmpdir()}/1905-sign-tip-${process.env.DRIVER_WORLD || 'photo'}-${tag}.jpg`, { prep: 'none', delay: 300, quality: 60 });
    await away();
  }
  assert.ok(sawCutWhole, 'Real office: at least one cut sign keeps its tail whole (at one of the two sizes)');
  console.log('check-001-room-heads: all checks passed');
};
