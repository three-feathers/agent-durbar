/*
 * Spec 097 FR-306..FR-311 (issue #1139, owner decision "1265 1", 2026-11-08): a desk's helpers in the Real office as small head figures with a status dot,
 * under the parent's name plate. Simulator only (DURBAR_SIM=15, a frozen simulator), no AI credits; every wait is an until(), every page value goes through jsLiteral.
 *
 *   npm run check:ui -- --only check-097-helpers      (builds first)
 *   SHOTS_OUT=<dir>   where its pictures go (097-helpers-<world>-<w>x<h>.png; a temporary folder by default)
 *   HELPERS_WORLDS=photo,cave,retro   the worlds (default: all three; the arcade measured to fit one row of heads under each cabinet's plate, spec 097 FR-306 as built)
 *   HELPERS_MUTANT=nostrip|status|nametile|overlap   no strip is drawn / a status change rebuilds the head's node / a name tile is drawn / a strip lies over its plate (each must fail)
 *
 * In the Photo office, the cave and the Retro arcade (15 agents, simhelpers=6, plus 5 more helpers on the first desk through the event path, one of them hostile, so it overflows)
 * at 1440x900 and 1280x800 (the arcade draws heads at 1440x900 only and keeps "+N" at 1280x800) it fails (exit 1) when:
 *   - the layout scrolls or its desk face is under the SC-002 ratchet (31 px);
 *   - a desk with helpers has no strip, or a shown helper is not a button (data-id) with its picture loaded (naturalWidth), the person helperPerson gives (never the parent's) cropped as headCrop says,
 *     a status dot, and its name and "helper of <parent>" in its accessible name and tooltip;
 *   - a head's face is under 24 px, the dot's colour is not the status token's, a visible name tile or a letter is drawn, or a token, a home path or a link planted in a helper's name and task
 *     reaches an accessible name, a tooltip or the "+K" tooltip;
 *   - the strip is not right after its plate and pencil in the Tab order, the "+K" text is under 10.5 px, a strip or a head overlaps a plate, screen, sign, another strip or leaves its slot;
 *   - a helper's status change adds or removes any node under the office (statusNodes), replaces the head's node, repaints no dot, does not change the accessible name and tooltip, or moves any box;
 *   - a click on a head does not open that helper's Sub-agent activity view, or "+K" does not open all the helpers (and "Fewer" fold them);
 *   - a head whose picture fails to load shows no silhouette, or shows a letter;
 *   - the default simulator scene (5 folders, a lounge row) draws heads at 1440x900, or at 1280x800 does not fall back to "+N" and dots (no room: spec 097 FR-308).
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const MUTANT = process.env.HELPERS_MUTANT || '';
const SIZES = [[1440, 900], [1280, 800]];
const WORLDS = (process.env.HELPERS_WORLDS || 'photo,cave,retro').split(',');
const FACE_FLOOR = 31; /* SC-002's ratchet, desk face */
const HEAD_FACE_MIN = 24; /* a helper's face, FR-307 */
const EXTRA = 4; /* helpers added to the first desk through the event path, and one hostile one: 6 + 4 + 1 = 11, more than any strip holds */
const TOKEN = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
const HOSTILE = `Hx ${TOKEN} /Users/alice/.ssh/id_rsa [click](https://evil.example/x)`;
const RAW = [TOKEN, '/Users/alice', 'evil.example'];

module.exports = async (ctx) => {
  const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-097-helpers-'));
  const H = helpers(ctx);
  const { js } = H;
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const SIM = 'window.__durbarSimUi';
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'&&document.querySelectorAll('#stage .ro .ro-plate').length>=10`;
  const PICS = `[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`;
  const q = (world, extra) => ({ officeview: 'real', simfreeze: '1', ...(world === 'cave' ? { worldflags: 'cave', world: 'cave' } : world === 'retro' ? { worldflags: 'retro', world: 'retro' } : {}), ...extra });
  const emit = (e) => js(`void window.__durbarSimEmit(Object.assign({timestamp:Date.now()},${jsLiteral(e)}));0`);
  const mutate = async () => {
    if (MUTANT === 'nostrip') await js(`(()=>{const f=()=>document.querySelectorAll('#stage .ro-hstrip').forEach(e=>e.remove());f();new MutationObserver(f).observe(document.getElementById('stage'),{childList:true,subtree:true});return 1})()`);
    if (MUTANT === 'nametile') await js(`(()=>{const f=()=>document.querySelectorAll('#stage .ro-hd').forEach(b=>{if(!b.querySelector('.ro-hn')){const n=document.createElement('span');n.className='ro-hn';n.style.cssText='position:absolute;left:34px;top:0;font-size:11px;white-space:nowrap';n.textContent=(b.getAttribute('title')||'').split(' · ')[0];b.appendChild(n);}});f();new MutationObserver(f).observe(document.getElementById('stage'),{childList:true,subtree:true});return 1})()`);
    if (MUTANT === 'overlap') await js(`(()=>{const f=()=>document.querySelectorAll('#stage .ro-hstrip').forEach(b=>{b.style.transform='translateY(-28px)'});f();new MutationObserver(f).observe(document.getElementById('stage'),{childList:true,subtree:true});return 1})()`);
  };
  /* what the layout says and what the page drew, for each desk */
  const read = () => js(`(()=>{const L=window.__durbarSimUi.realLayout(),A=window.__durbarSimUi.agents(),o=document.querySelector('#stage .ro').getBoundingClientRect();
    const R=e=>{const r=e.getBoundingClientRect();return {x:Math.round((r.left-o.left)*10)/10,y:Math.round((r.top-o.top)*10)/10,w:Math.round(r.width*10)/10,h:Math.round(r.height*10)/10}};
    const desks=L.zones.flatMap(z=>z.desks);
    return {scroll:L.scroll,face:L.faceH,rows:L.helpRows,
      desks:desks.map(d=>{const a=A.find(x=>x.id===d.id),subs=A.filter(x=>x.parent===d.id);
        const plate=document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(d.id)+'"]');let e=plate&&plate.nextElementSibling;if(e&&e.matches('.ren'))e=e.nextElementSibling;const strip=e&&e.matches('.ro-hstrip')?e:null;
        const heads=strip?[...strip.querySelectorAll('.ro-hd')].map(t=>{const dot=t.querySelector('.dot'),im=t.querySelector('img'),cs=getComputedStyle(dot);return {id:t.dataset.id,label:t.getAttribute('aria-label'),title:t.getAttribute('title'),cls:t.className,dotCls:dot.className,dotBg:cs.backgroundColor,dotBorder:cs.borderTopColor,pic:!!im&&im.complete&&im.naturalWidth>0,img:im?{src:im.getAttribute('src'),nat:im.naturalWidth,w:im.style.width,left:im.style.left,top:im.style.top}:null,glyph:!!t.querySelector('.ro-hg'),text:t.textContent.trim(),box:R(t),pbox:R(t.querySelector('.ro-hp'))}}):[];
        const more=strip&&strip.querySelector('.ro-hmore');
        return {id:d.id,name:a&&a.name,helpers:subs.length,subNames:subs.map(s=>s.name).filter(n=>!n.startsWith('Hx ')),layoutStrip:d.strip||null,slot:d.slot,plate:R(plate),box:strip?R(strip):null,heads,
          more:more?{text:more.textContent.trim(),fs:parseFloat(getComputedStyle(more).fontSize),label:more.getAttribute('aria-label'),exp:more.getAttribute('aria-expanded'),box:R(more)}:null,
          plateHelp:!!(plate&&plate.querySelector('.ro-help')),tiles:strip?strip.querySelectorAll('.ro-ht,.ro-hn,.ro-hs').length:0};}),
      signs:[...document.querySelectorAll('#stage .ro-sign')].map(R),plates:[...document.querySelectorAll('#stage .ro-plate')].map(R),screens:[...document.querySelectorAll('#stage .ro-screen')].map(R)};})()`);
  /* the status tokens a dot must show: a probe element in the page takes the colour from the token itself */
  const tokens = () => js(`(()=>{const probe=(v)=>{const s=document.createElement('span');s.style.cssText='position:absolute;visibility:hidden;background:var('+v+');border-color:var('+v+');border-style:solid;border-width:1px';document.body.appendChild(s);const c=getComputedStyle(s).backgroundColor;s.remove();return c};return {working:probe('--c-working'),thinking:probe('--c-thinking'),waiting:probe('--c-waiting'),error:probe('--c-error'),done:probe('--c-done'),idle:probe('--c-idle')}})()`);
  /* what a head's picture must be: the person helperPerson gives (never the parent's), cropped by headCrop: asked of the page's own pure module, compared with what the page drew */
  const picture = (headId, parentId) => js(`(()=>{try{const E=window.exports,ro=document.querySelector('#stage .ro'),seat=window.DurbarRealOfficeSets[ro.dataset.set].seat,ids=Object.keys(seat).sort(),parent=window.DurbarRealOffice.personOf(${jsLiteral(parentId)}),want=E.helperPerson(${jsLiteral(headId)},parent,ids);
    const b=document.querySelector('#stage .ro-hd[data-id="'+CSS.escape(${jsLiteral(headId)})+'"]'),im=b&&b.querySelector('img');if(!im)return {want,parent,none:true};
    const m=/\\/([a-z0-9-]+)-rest\\.webp$/.exec(im.getAttribute('src')||''),c=E.headCrop(seat[want]),f=E.HEAD/c.s;
    return {want,parent,got:m&&m[1],nat:im.naturalWidth,w:parseFloat(im.style.width),left:parseFloat(im.style.left),top:parseFloat(im.style.top),ew:seat[want].w*f,el:-c.x*f,et:-c.y*f}}catch(e){return {err:String(e&&e.message)}}})()`);
  const hit = (a, b, t = 0.5) => a.x + t < b.x + b.w && b.x + t < a.x + a.w && a.y + t < b.y + b.h && b.y + t < a.y + a.h;
  const shots = [];

  for (const world of WORLDS) for (const [w, h] of SIZES) {
    const tag = `${world} ${w}x${h}`;
    await H.load({ w, h, query: q(world, { sim: '15', simhelpers: '6' }), ready: REAL, readyMs: 30000, settle: false });
    await must(PICS, `${tag}: the pictures`);
    if (world === 'retro' && w < 1440) { /* measured: one row of heads under every cabinet's plate fits the hall at 1440x900 but not at 1280x800 (spec 097 FR-308 as built): the plates keep "+N" and dots */
      assert.strictEqual(await js(`document.querySelectorAll('#stage .ro-hstrip').length`), 0, `${tag}: no strips in the arcade at this size`);
      assert.ok(await js(`document.querySelectorAll('#stage .ro-plate .ro-help').length>=10`), `${tag}: the plates keep their +N and dots`);
      assert.strictEqual((await read()).rows, 0, `${tag}: helpRows 0`);
      continue;
    }
    /* one desk gets more helpers than any strip holds (the event path, as an agent app reports a helper) */
    const first = await js(`window.__durbarSimUi.realLayout().zones[0].desks[0].id`);
    for (let i = 0; i < EXTRA; i++) await emit({ sessionId: first, type: 'subagent', subagentId: 'drv-h-' + i, name: 'Extra helper ' + (i + 1), phase: 'started', task: 'Check ' + (i + 1), agentName: 'explore' });
    await emit({ sessionId: first, type: 'subagent', subagentId: 'drv-h-hostile', name: HOSTILE, phase: 'started', task: HOSTILE, agentName: 'explore' });
    const second = await js(`window.__durbarSimUi.realLayout().zones[0].desks[1].id`);
    await emit({ sessionId: second, type: 'subagent', subagentId: 'drv-h-hostile2', name: HOSTILE, phase: 'started', task: HOSTILE, agentName: 'explore' });
    await must(`${SIM}.agents().filter(x=>x.parent===${jsLiteral(first)}).length>=${jsLiteral(6 + EXTRA + 1)}&&${SIM}.agents().some(x=>x.parent===${jsLiteral(second)}&&x.id.includes('hostile2'))`, tag + ': the extra helpers on the first desk');
    await must(`document.querySelectorAll('#stage .ro-hstrip').length>=10`, `${tag}: the helper strips`);
    await must(`(()=>{const m=document.querySelector('#stage .ro-hstrip .ro-hmore[data-more="'+CSS.escape(${jsLiteral(first)})+'"]');return !!m&&m.parentElement.querySelectorAll('.ro-hd').length+Number(m.textContent.slice(1))===${jsLiteral(6 + EXTRA + 1)}})()`, tag + ': the first desks +K after the extra helpers');
    await must(`(()=>{const p=document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(${jsLiteral(second)})+'"]');let e=p&&p.nextElementSibling;if(e&&e.matches('.ren'))e=e.nextElementSibling;if(!e||!e.matches('.ro-hstrip'))return false;const m=e.querySelector('.ro-hmore');return e.querySelectorAll('.ro-hd').length+(m?Number(m.textContent.slice(1)):0)===7})()`, tag + ': the second desk shows its 7 helpers (heads and +K)');
    await must(PICS, `${tag}: the head pictures`);
    await mutate();
    if (MUTANT) console.log('[helpers] mutant:', MUTANT);
    const TOK = await tokens();
    let s = await read();
    assert.ok(!s.scroll, `${tag}: the office does not scroll`);
    assert.ok(s.face >= FACE_FLOOR - 1e-9, `${tag}: desk face ${s.face} px, over the SC-002 ratchet ${FACE_FLOOR}`);
    assert.ok(s.rows === 1 || s.rows === 2, `${tag}: strips drawn at 15 agents (rows ${s.rows})`);
    const withHelpers = s.desks.filter((d) => d.helpers > 0);
    assert.ok(withHelpers.length >= 10, `${tag}: 15 agents with helpers (${withHelpers.length})`);
    let overflowSeen = 0, dotsChecked = 0, hostileSeen = 0, pictures = 0;
    for (const d of withHelpers) {
      assert.ok(d.layoutStrip && d.box, `${tag}: ${d.id} has a strip (layout and page)`);
      assert.ok(!d.plateHelp, `${tag}: ${d.id}'s plate keeps no +N while its helpers are drawn`);
      assert.strictEqual(d.heads.length, Math.min(d.helpers, d.layoutStrip.shown), `${tag}: ${d.id}: ${d.helpers} helpers, ${d.layoutStrip.shown} shown`);
      assert.strictEqual(d.tiles, 0, `${tag}: ${d.id}: no name tile drawn in the strip`);
      for (const t of d.heads) {
        assert.ok(t.pic && t.img && t.img.nat > 0, `${tag}: ${t.id}: the head's picture loaded (naturalWidth ${t.img && t.img.nat})`);
        const raw = RAW.filter((x) => t.label.includes(x) || t.title.includes(x));
        assert.deepStrictEqual(raw, [], `${tag}: ${t.id}: a token, a home path or a link reached the accessible name or the tooltip: ${t.label} | ${t.title}`);
        if (t.id.includes('hostile')) { hostileSeen++; assert.ok(/Hx/.test(t.label) && /helper of /.test(t.label), `${tag}: the hostile helper's masked name is in its accessible name: ${t.label}`); }
        else {
          assert.ok(d.subNames.some((n) => t.label.includes(n)) && t.label.includes('helper of ' + d.name), `${tag}: ${t.id}'s accessible name has its name and its parent: ${t.label}`);
          assert.ok(d.subNames.some((n) => t.title.includes(n)), `${tag}: ${t.id}'s tooltip has its name: ${t.title}`);
        }
        /* the picture is the right person's, cropped as headCrop says (not the parent's) */
        const pic = await picture(t.id, d.id);
        assert.ok(!pic.err, `${tag}: picture facts: ${pic.err}`);
        assert.ok(pic.got && pic.got === pic.want && pic.got !== pic.parent, `${tag}: ${t.id}'s picture is ${pic.got}, helperPerson says ${pic.want}, the parent is ${pic.parent}`);
        assert.ok(Math.abs(pic.w - pic.ew) < 0.2 && Math.abs(pic.left - pic.el) < 0.2 && Math.abs(pic.top - pic.et) < 0.2 && pic.nat > 0, `${tag}: ${t.id}'s crop ${JSON.stringify([pic.w, pic.left, pic.top])} is headCrop's ${JSON.stringify([pic.ew, pic.el, pic.et])}`);
        pictures++;
        assert.strictEqual(t.glyph, false, `${tag}: ${t.id} has its picture, no placeholder`);
        /* no visible name and no letter: the button draws no text at all */
        assert.ok(t.text.length === 0, `${tag}: ${t.id} draws text "${t.text}" (the name is never drawn)`);
        assert.ok(t.pbox.w * 0.8 >= HEAD_FACE_MIN - 1e-9, `${tag}: ${t.id}'s face is ${t.pbox.w * 0.8} px, at least ${HEAD_FACE_MIN}`);
        const state = (/st-(\w+)/.exec(t.cls) || [])[1], cls = (t.dotCls.match(/dot (\w+)/) || [])[1];
        assert.ok(cls, `${tag}: ${t.id} has a status dot (${t.dotCls})`);
        const want = cls === 'idle' ? null : TOK[cls === 'failing' || cls === 'retrying' ? 'waiting' : cls === 'compacting' ? 'thinking' : cls];
        if (want) assert.strictEqual(t.dotBg, want, `${tag}: ${t.id}'s dot colour ${t.dotBg} is the --c-${cls} token ${want} (state ${state})`);
        else assert.strictEqual(t.dotBorder, TOK.idle, `${tag}: ${t.id}'s idle dot edge is the --c-idle token`);
        dotsChecked++;
      }
      if (d.helpers > d.layoutStrip.shown) { overflowSeen++; assert.ok(d.more && /^\+\d+$/.test(d.more.text) && Number(d.more.text) === d.helpers - d.layoutStrip.shown && d.more.fs >= 10.5 && /more helpers of/.test(d.more.label), `${tag}: ${d.id}: the rest is "+K" (${JSON.stringify([d.more, d.helpers, d.layoutStrip, d.heads.length])})`); }
      else assert.ok(!d.more, `${tag}: ${d.id}: no "+K" when all fit`);
    }
    assert.ok((hostileSeen >= 1 || world === 'retro') && pictures >= 20, `${tag}: the hostile helper was seen (${hostileSeen}) and ${pictures} pictures were checked`);
    assert.ok(overflowSeen >= 1 && dotsChecked >= 20, `${tag}: an overflow "+K" was seen (${overflowSeen}) and ${dotsChecked} dots were checked`);
    const moreTitles = await js(`[...document.querySelectorAll('#stage .ro-hmore')].map(m=>(m.getAttribute('title')||'')+'|'+(m.getAttribute('aria-label')||''))`);
    assert.ok(moreTitles.length >= 1 && moreTitles.every((t) => !RAW.some((x) => t.includes(x))), `${tag}: the +K tooltips carry no token, path or link: ${JSON.stringify(moreTitles).slice(0, 200)}`);
    /* the name is drawn nowhere in the strips: no element of the office shows a helper's name as visible text */
    const names = await js(`(()=>[...new Set(${SIM}.agents().filter(x=>x.parent).map(x=>x.name))])()`);
    const drawn = await js(`(()=>{const ns=${jsLiteral(names)},out=[];for(const e of document.querySelectorAll('#stage .ro-hstrip *')){const t=[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim();if(t&&ns.some(n=>t.includes(n)))out.push(t)}return out})()`);
    assert.deepStrictEqual(drawn, [], `${tag}: a helper's name is drawn as text`);
    /* nothing covers anything: each strip, head and "+K" is inside its slot and touches no plate, screen, sign or other strip */
    const strips = withHelpers.map((d) => d.box);
    withHelpers.forEach((d, i) => {
      const slot = d.slot;
      assert.ok(d.box.x >= slot.x - 1 && d.box.x + d.box.w <= slot.x + slot.w + 1 && d.box.y >= slot.y - 1 && d.box.y + d.box.h <= slot.y + slot.h + 1, `${tag}: ${d.id}'s strip is inside its slot ${JSON.stringify([d.box, slot])}`);
      for (const [nm, list] of [['plate', s.plates], ['screen', s.screens], ['sign', s.signs]]) for (const r of list) assert.ok(!hit(d.box, r), `${tag}: ${d.id}'s strip overlaps a ${nm} ${JSON.stringify([d.box, r])}`);
      strips.forEach((o, j) => { if (j > i) assert.ok(!hit(d.box, o), `${tag}: two strips overlap`); });
      const parts = d.heads.map((t) => t.box).concat(d.more ? [d.more.box] : []);
      parts.forEach((p, a) => { assert.ok(p.x >= d.box.x - 3.5 && p.x + p.w <= d.box.x + d.box.w + 3.5 && p.y >= d.box.y - 3.5 && p.y + p.h <= d.box.y + d.box.h + 3.5, `${tag}: a head of ${d.id} inside its strip ${JSON.stringify([p, d.box])}`); parts.forEach((o, b) => { if (b > a) assert.ok(!hit(p, o, 0.5), `${tag}: two heads of ${d.id} overlap`); }); });
    });
    /* Tab order: the plate, its pencil, then its first head, on to "+K" */
    const order = await js(`(()=>{const out=[];for(const b of document.querySelectorAll('#stage .ro-hstrip')){const p=b.previousElementSibling;out.push(!!p&&(p.matches('.ro-plate')||p.matches('.ren.ro-ren')));}return out})()`);
    assert.ok(order.length >= 10 && order.every(Boolean), `${tag}: each strip follows its plate (and pencil) in the DOM`);
    const firstD = s.desks.find((d) => d.id === first);
    await js(`(()=>{const p=document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(${jsLiteral(first)})+'"]');p.focus();return document.activeElement===p})()`);
    await must(`document.activeElement&&document.activeElement.matches('.ro-plate')`, `${tag}: the plate has focus`);
    await H.key('Tab');
    if (await js(`document.activeElement.matches('.ren.ro-ren')`)) await H.key('Tab');
    assert.ok(await js(`document.activeElement.matches('.ro-hd')&&document.activeElement.dataset.id.length>0`), `${tag}: Tab from the plate (and its pencil) lands on the first head`);
    for (let i = 0; i < firstD.heads.length; i++) await H.key('Tab');
    assert.ok(await js(`document.activeElement.matches('.ro-hmore[data-more]')`), `${tag}: the Tab after the last head is "+K"`);
    await H.key('Tab');
    assert.ok(await js(`!document.activeElement.closest('.ro-hstrip')`), `${tag}: then Tab leaves the strip for the next desk`);
    await js(`document.activeElement.blur()`);

    /* a status update: no node under the office is added or removed (statusNodes), the head keeps its node, its dot's class changes, no box moves (FR-015, FR-184) */
    const target = withHelpers.filter((d) => d.id !== first).flatMap((d) => d.heads).find((t) => /\bworking\b/.test(t.dotCls)); /* a running helper (a finished or failed one takes no status) */
    assert.ok(target, `${tag}: a running helper`);
    const was = target.dotCls;
    await must(`${SIM}.visitsSettled()&&${SIM}.settleNow()`, `${tag}: the office settled before the status updates`);
    await js(`(()=>{window.__hNode=document.querySelector('#stage .ro-hd[data-id="'+CSS.escape(${jsLiteral(target.id)})+'"]');window.__aN=0;window.__aL=[];window.__aO=new MutationObserver(ms=>{for(const m of ms){if(m.target.closest&&m.target.closest('.ro-slip'))continue;for(const x of [...m.addedNodes,...m.removedNodes])if(x.nodeType===1){window.__aN++;if(window.__aL.length<6)window.__aL.push((x.className&&x.className.baseVal===undefined?x.className:x.tagName)+'')}}});window.__aO.observe(document.querySelector('#stage .ro'),{childList:true,subtree:true});return !!window.__hNode})()`);
    const before = await read();
    const seq = ['thinking', 'working', 'thinking', 'working'];
    for (const st of seq) {
      assert.ok(await js(`(()=>{try{const a=${SIM}.agents().find(x=>x.id===${jsLiteral(target.id)});a.state=${jsLiteral(st)};${SIM}.render();return true}catch(e){return false}})()`), `${tag}: the state change ${st}`);
      if (MUTANT === 'status') await js(`(()=>{const n=document.querySelector('#stage .ro-hd[data-id="'+CSS.escape(${jsLiteral(target.id)})+'"]');if(n)n.replaceWith(n.cloneNode(true));return 1})()`);
      await must(`(()=>{const d=document.querySelector('#stage .ro-hd[data-id="'+CSS.escape(${jsLiteral(target.id)})+'"] .dot');return !!d&&d.className.split(' ').includes(${jsLiteral(st)})})()`, tag + ': the head dot shows ' + st);
      await must(`(()=>{const b=document.querySelector('#stage .ro-hd[data-id="'+CSS.escape(${jsLiteral(target.id)})+'"]');const w=${jsLiteral(st)};return !!b&&b.getAttribute('aria-label').toLowerCase().includes(w)&&b.getAttribute('title').toLowerCase().includes(w)})()`, tag + ': the head\'s accessible name and tooltip say ' + st);
    }
    const after = await read();
    const nodes = await js(`(window.__aO.disconnect(),window.__aN)`);
    assert.strictEqual(nodes, 0, tag + ': statusNodes: ' + nodes + ' elements added or removed under the office over ' + seq.length + ' helper status updates');
    assert.ok(await js(`window.__hNode&&window.__hNode.isConnected&&window.__hNode===document.querySelector('#stage .ro-hd[data-id="'+CSS.escape(${jsLiteral(target.id)})+'"]')`), `${tag}: the head keeps its node on a status update`);
    const boxes = (r) => JSON.stringify(r.desks.map((d) => [d.id, d.box, d.heads.map((t) => t.box), d.plate]));
    assert.strictEqual(boxes(after), boxes(before), `${tag}: a status update moves no strip, head or plate`);

    /* a click on a head opens that helper's Sub-agent activity view (the flat office's own [data-id] handler) */
    const tname = await js(`${SIM}.agents().find(x=>x.id===${jsLiteral(target.id)}).name`);
    await js(`document.querySelector('#stage .ro-hd[data-id="'+CSS.escape(${jsLiteral(target.id)})+'"]').click()`);
    await must(`document.body.classList.contains('panel-open')&&(document.getElementById('panelTitle')||{}).textContent===${jsLiteral(tname)}`, `${tag}: a click on a head opens its view`);
    assert.ok(await js(`/ub-agent|elper|Task|Now/i.test(document.getElementById('panel').innerText)`), `${tag}: the helper's activity view (read-only) shows`);
    await H.key('Escape');
    await must(`!document.body.classList.contains('panel-open')`, `${tag}: Esc closes the view`);

    /* "+K": a click shows all the helpers in one scrolling row, at the same height, no desk moves; "Fewer" folds them again */
    const mid = firstD.id, mb = (await read());
    await js(`document.querySelector('#stage .ro-hmore[data-more="'+CSS.escape(${jsLiteral(mid)})+'"]').click()`);
    await must(`(()=>{const m=document.querySelector('#stage .ro-hmore[data-more="'+CSS.escape(${jsLiteral(mid)})+'"]');return m&&m.getAttribute('aria-expanded')==='true'&&m.parentElement.classList.contains('open')&&m.parentElement.querySelectorAll('.ro-hd').length===${jsLiteral(6 + EXTRA + 1)}})()`, `${tag}: "+K" opens all ${jsLiteral(6 + EXTRA + 1)} helpers`);
    const open = await read();
    const b0 = (r) => JSON.stringify(r.desks.map((d) => [d.id, d.box, d.plate]));
    assert.strictEqual(b0(open), b0(mb), `${tag}: opening a strip moves no desk box`);
    await js(`document.querySelector('#stage .ro-hmore[data-more="'+CSS.escape(${jsLiteral(mid)})+'"]').click()`);
    await must(`(()=>{const m=document.querySelector('#stage .ro-hmore[data-more="'+CSS.escape(${jsLiteral(mid)})+'"]');return m&&m.getAttribute('aria-expanded')==='false'&&!m.parentElement.classList.contains('open')&&m.parentElement.querySelectorAll('.ro-hd').length===${jsLiteral(firstD.heads.length)}})()`, `${tag}: "Fewer" folds them`);
    await js(`document.activeElement&&document.activeElement.blur();0`);
    await H.shot(path.join(OUT, `097-helpers-${world}-${w}x${h}.png`), { prep: 'calm', tag: 'helpers', what: tag });
    shots.push(`097-helpers-${world}-${w}x${h}.png`);
    /* a picture that fails to load: the head keeps its button and its accessible name and shows a neutral silhouette, never a letter of the name */
    const gone = firstD.heads[0].id, nameBefore = await js(`document.querySelector('#stage .ro-hd[data-id="'+CSS.escape(${jsLiteral(gone)})+'"]').getAttribute('aria-label')`);
    await js(`(()=>{const im=document.querySelector('#stage .ro-hd[data-id="'+CSS.escape(${jsLiteral(gone)})+'"] img');im.dispatchEvent(new Event('error'));return 1})()`);
    await must(`(()=>{const b=document.querySelector('#stage .ro-hd[data-id="'+CSS.escape(${jsLiteral(gone)})+'"]');return !!b&&!!b.querySelector('.ro-hg')&&!b.querySelector('img')&&b.textContent.trim()===''})()`, tag + ': a failed picture shows the silhouette and no letter');
    assert.strictEqual(await js(`document.querySelector('#stage .ro-hd[data-id="'+CSS.escape(${jsLiteral(gone)})+'"]').getAttribute('aria-label')`), nameBefore, `${tag}: the accessible name is unchanged without the picture`);
  }

  /* the default simulator scene (the linked 097-real-15 pictures: 15 agents in 5 folders, a lounge row, the simulator's own helpers): heads at 1440x900; at 1280x800 the strips' extra height would push the desks
     under the face floor, so the plates keep "+N" and dots (FR-308's last step, recorded in test:realoffice-layout) */
  for (const [w, h] of SIZES) {
    const tag = `default scene ${w}x${h}`;
    await H.load({ w, h, query: q('photo', { sim: '15' }), ready: REAL, readyMs: 30000, settle: false });
    await must(PICS, tag + ': the pictures');
    const s = await read();
    assert.ok(!s.scroll && s.face >= FACE_FLOOR - 1e-9, `${tag}: no scroll, face ${s.face}`);
    const hd = s.desks.filter((d) => d.helpers > 0);
    assert.ok(hd.length >= 3, `${tag}: desks with helpers (${hd.length})`);
    if (w >= 1440) {
      assert.ok(s.rows >= 1 && hd.every((d) => d.heads.length > 0 && !d.plateHelp), `${tag}: every desk with helpers shows heads`);
    } else {
      assert.strictEqual(s.rows, 0, `${tag}: no strips (rows ${s.rows})`);
      assert.ok(hd.every((d) => d.heads.length === 0 && d.plateHelp), `${tag}: the plates keep +N and dots`);
    }
  }
  console.log('[097-helpers] ok', shots.join(' '));
  process.exitCode = 0;
};
