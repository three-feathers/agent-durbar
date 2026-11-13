/*
 * Spec 097 FR-368..FR-376 (issue #1642, owner 2026-11-12: "can you show sub agents as kids playing on desk?"): in the Photo office at the big level (1 to 4 agents) a desk's helpers
 * are clay-toy kids on its desk top; at 5 to 15 agents the head row under the plate shows the kids' faces. Simulator only (a frozen simulator), no AI credits; every wait is an
 * until(), every page value goes through jsLiteral.
 *
 *   npm run check:ui -- --only check-097-kids      (builds first)
 *   SHOTS_OUT=<dir>   where its pictures go (097-kids-<n>-<w>x<h>.jpg, JPEG quality 60; a temporary folder by default)
 *   KIDS_MUTANT=nokids|status|name|overlap|adulthead   no kid is drawn / a status change rebuilds a kid's node / a kid's name is drawn / a kid lies over its plate /
 *     the head row shows an adult at 15 agents (each must fail)
 *
 * At 1, 2, 3 and 4 agents (simhelpers=6, plus 2 more helpers and a hostile one on the first desk through the event path, so it overflows) at 1440x900 and 1280x800 it fails (exit 1) when:
 *   - the office scrolls; a desk the layout gives kids has no kid group right after its plate and pencil, draws a head strip too, or its plate keeps "+N";
 *   - a kid is not a button (data-id) of a helper of that desk, its picture is not the kid `kidOf` gives in the pose `kidPose` gives (loaded), its box is not `kidBox`'s (one scale per kid,
 *     the sole on the feet line), or it has no status dot;
 *   - waiting and error kids do not stand before the others (orderedHelpers); the "+K" block is missing, its K is wrong, its text is under 10.5 px or its name is not "K more helpers of <parent>";
 *   - a kid or "+K" lies over a plate, a screen, a sign, the person's head and shoulders, another kid, or leaves the window;
 *   - a helper's name is drawn as text, or a token, a home path or a link planted in a helper's name and task reaches an accessible name or a tooltip;
 *   - a status change (working, error, waiting, limit through `__durbarSimUi.helperState`, T335) adds or removes a node, replaces the kid's node, keeps the old picture, or moves its place;
 *   - Tab from the plate (and pencil) does not go through the kids, then "+K", then out of the group;
 *   - a real click on a kid does not open that helper's Sub-agent activity view, or a click on "+K" does not open the parent's chat panel;
 *   - pointing at a kid opens the desk's zoom (FR-372: a kid is not a hover target);
 *   - a kid whose picture fails shows no silhouette, shows a letter, or loses its accessible name.
 * At 15 agents (both sizes): no kid group is drawn, and every head of the head row is a kid's face (`helperHead`, FR-370).
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const MUTANT = process.env.KIDS_MUTANT || '';
const SIZES = [[1440, 900], [1280, 800]];
const COUNTS = (process.env.KIDS_COUNTS || '1,2,3,4').split(',').map(Number);
const TOKEN = 'ghp_' + 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2';
const HOSTILE = `Hx ${TOKEN} /Users/alice/.ssh/id_rsa [click](https://evil.example/x)`;
const RAW = [TOKEN, '/Users/alice', 'evil.example'];

module.exports = async (ctx) => {
  const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-097-kids-'));
  const H = helpers(ctx);
  const { js } = H;
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const SIM = 'window.__durbarSimUi';
  const REAL = (n) => `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'&&document.querySelectorAll('#stage .ro .ro-plate').length>=${n}`;
  const PICS = `[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`;
  const emit = (e) => js(`void window.__durbarSimEmit(Object.assign({timestamp:Date.now()},${jsLiteral(e)}));0`);
  const hit = (a, b, t = 0.5) => a.x + t < b.x + b.w && b.x + t < a.x + a.w && a.y + t < b.y + b.h && b.y + t < a.y + a.h;
  const mutate = async () => {
    const watch = (body) => js(`(()=>{const f=new Function(${jsLiteral(body)});f();new MutationObserver(f).observe(document.getElementById('stage'),{childList:true,subtree:true,attributes:true,attributeFilter:['class','src']});return 1})()`);
    if (MUTANT === 'nokids') await watch(`document.querySelectorAll('#stage .ro-kids').forEach(e=>e.remove())`);
    if (MUTANT === 'name') await watch(`document.querySelectorAll('#stage .ro-kid').forEach(b=>{if(!b.querySelector('.ro-kn')){const n=document.createElement('span');n.className='ro-kn';n.style.cssText='position:absolute;left:0;top:100%;font-size:11px;white-space:nowrap';n.textContent=(b.getAttribute('title')||'').split(' · ')[0];b.appendChild(n);}})`);
    if (MUTANT === 'overlap') await watch(`document.querySelectorAll('#stage .ro-kids').forEach(b=>{if(b.style.transform!=='translateY(30px)')b.style.transform='translateY(30px)'})`);
    if (MUTANT === 'adulthead') await watch(`const s=document.querySelector('#stage .ro').dataset.set;document.querySelectorAll('#stage .ro-hd img').forEach(i=>{const w='realoffice/sets/'+s+'/p01-rest.webp';if(i.getAttribute('src')!==w)i.setAttribute('src',w)})`);
  };
  /* what the layout says and what the page drew, per desk; kid boxes in floor pixels (relative to the office) */
  const read = () => js(`(()=>{const L=window.__durbarSimUi.realLayout(),A=window.__durbarSimUi.agents(),E=window.exports,ro=document.querySelector('#stage .ro'),o=ro.getBoundingClientRect();
    const meta=Object.assign({},window.DurbarRealOfficeWorlds[ro.dataset.world],window.DurbarRealOfficeSets[ro.dataset.set]);
    const R=e=>{const r=e.getBoundingClientRect();return {x:r.left-o.left,y:r.top-o.top,w:r.width,h:r.height}};
    const desks=L.zones.flatMap(z=>z.desks);
    return {scroll:L.scroll,big:L.big,u:L.u,W:innerWidth,H:innerHeight,stage:R(document.getElementById('stage')),
      plates:[...document.querySelectorAll('#stage .ro-plate')].map(R),screens:[...document.querySelectorAll('#stage .ro-screen')].map(R),signs:[...document.querySelectorAll('#stage .ro-sign')].map(R),
      desks:desks.map(d=>{const a=A.find(x=>x.id===d.id),subs=A.filter(x=>x.parent===d.id);
        const plate=document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(d.id)+'"]');let e=plate&&plate.nextElementSibling;if(e&&e.matches('.ren'))e=e.nextElementSibling;
        const g=e&&e.matches('.ro-kids')?e:null,strip=e&&e.matches('.ro-hstrip')?e:null,more=g&&g.querySelector('.ro-kmore');
        const kids=g?[...g.querySelectorAll('.ro-kid')].map(b=>{const im=b.querySelector('img'),h=A.find(x=>x.id===b.dataset.id),st=(/st-(\\w+)/.exec(b.className)||[])[1],kid=E.kidOf(b.dataset.id,meta.kids),pose=E.kidPose(st,false);
          return {id:b.dataset.id,parent:h&&h.parent,state:st,kid,pose,src:im&&im.getAttribute('src'),nat:im?im.naturalWidth:0,done:!!im&&im.complete,box:R(b),label:b.getAttribute('aria-label')||'',title:b.getAttribute('title')||'',
            text:[...b.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim()+[...b.querySelectorAll('*')].map(n=>[...n.childNodes].filter(x=>x.nodeType===3).map(x=>x.textContent).join('')).join('').trim(),
            dot:(b.querySelector('.dot')||{}).className||'',hg:!!b.querySelector('.ro-hg'),want:d.kids?E.kidBox(meta.kids[kid],pose,d.kids.places[[...g.querySelectorAll('.ro-kid')].indexOf(b)],d.kids.feet,L.u):null,bodyH:meta.kids[kid].bodyH,poseH:meta.kids[kid].poses[pose][1]}}):[];
        return {id:d.id,name:a&&a.name,helpers:subs.length,kz:d.kids||null,strip:!!strip,lstrip:!!d.strip,person:d.person?d.person.vis:null,plate:R(plate),plateHelp:!!(plate&&plate.querySelector('.ro-help')),
          group:g?R(g):null,kids,more:more?{text:more.textContent.trim(),fs:parseFloat(getComputedStyle(more).fontSize),label:more.getAttribute('aria-label')||'',title:more.getAttribute('title')||'',id:more.dataset.kmore,box:R(more)}:null};})};})()`);
  const shots = [];

  for (const [w, h] of SIZES) for (const n of COUNTS) {
    const tag = `${n} agent${n > 1 ? 's' : ''} ${w}x${h}`;
    await H.load({ w, h, query: { officeview: 'real', simfreeze: '1', sim: String(n), simhelpers: '6' }, ready: REAL(n), readyMs: 30000, settle: false });
    await must(PICS, `${tag}: the pictures`);
    const first = await js(`${SIM}.realLayout().zones[0].desks[0].id`);
    for (let i = 0; i < 2; i++) await emit({ sessionId: first, type: 'subagent', subagentId: 'kid-x-' + i, name: 'Extra helper ' + (i + 1), phase: 'started', task: 'Check ' + (i + 1), agentName: 'explore' });
    await emit({ sessionId: first, type: 'subagent', subagentId: 'kid-hostile', name: HOSTILE, phase: 'started', task: HOSTILE, agentName: 'explore' });
    await must(`${SIM}.agents().filter(x=>x.parent===${jsLiteral(first)}).length>=9`, tag + ': the extra helpers on the first desk');
    /* T335: the states the simulator's helpers never send: one waiting, one limit (the driver's hook), the rest as the simulator has them */
    const hs = await js(`${SIM}.agents().filter(x=>x.parent===${jsLiteral(first)}&&x.state==='working').map(x=>x.id)`);
    assert.ok(hs.length >= 2, `${tag}: two running helpers to set (${hs.length})`);
    assert.ok(await js(`${SIM}.helperState(${jsLiteral(hs[0])},'waiting')&&${SIM}.helperState(${jsLiteral(hs[1])},'limit')`), `${tag}: the driver hook sets waiting and limit`);
    await must(`document.querySelectorAll('#stage .ro-kids .ro-kid').length>=1`, `${tag}: kids on the desks`);
    await must(PICS, `${tag}: the kid pictures`);
    await mutate();
    if (MUTANT) console.log('[097-kids] mutant:', MUTANT);
    let s = await read();
    assert.ok(s.big && !s.scroll, `${tag}: the big level, no scroll`);
    const withKids = s.desks.filter((d) => d.kz);
    assert.ok(withKids.length >= 1 && withKids.some((d) => d.id === first), `${tag}: the first desk has kids (${withKids.length} desks)`);
    let kidsSeen = 0, moreSeen = 0;
    for (const d of s.desks.filter((x) => x.helpers > 0)) {
      if (!d.kz) { assert.ok(d.strip || d.plateHelp, `${tag}: ${d.id} without kid room keeps a head row or "+N"`); continue; }
      assert.ok(d.group, `${tag}: ${d.id} has its kids group right after its plate and pencil`);
      assert.ok(!d.strip && !d.lstrip && !d.plateHelp, `${tag}: ${d.id} with kids has no head strip and no "+N" on its plate`);
      assert.strictEqual(d.kids.length, d.kz.shown, `${tag}: ${d.id} draws ${d.kz.shown} kids (${d.kids.length})`);
      const rank = (st) => (st === 'waiting' || st === 'limit' ? 0 : st === 'error' ? 1 : 2);
      d.kids.forEach((k, i) => {
        assert.strictEqual(k.parent, d.id, `${tag}: kid ${k.id} is a helper of ${d.id}`);
        assert.ok(k.done && k.nat > 0 && k.src === `realoffice/worlds/photo/${k.kid}-${k.pose}.webp`, `${tag}: ${k.id} shows ${k.kid}'s ${k.pose} picture, loaded (${k.src}, ${k.nat})`);
        const r = k.box, e = k.want;
        assert.ok(e && Math.abs(r.x - e.x) < 0.75 && Math.abs(r.y - e.y) < 0.75 && Math.abs(r.w - e.w) < 0.75 && Math.abs(r.h - e.h) < 0.75, `${tag}: ${k.id}'s box ${JSON.stringify(r)} is kidBox's ${JSON.stringify(e)}`);
        assert.ok(Math.abs(r.h - k.poseH * 0.4 * s.u / k.bodyH) < 0.75, `${tag}: ${k.id}: one scale per kid (0.40 u)`);
        assert.ok(/\bdot\b/.test(k.dot), `${tag}: ${k.id} has a status dot`);
        assert.ok(k.text === '', `${tag}: ${k.id} draws text "${k.text}" (the name is drawn nowhere)`);
        assert.ok(/helper of /.test(k.label) && k.label.includes(d.name) && k.title.length > 0, `${tag}: ${k.id}'s accessible name and tooltip: ${k.label} | ${k.title}`);
        assert.deepStrictEqual(RAW.filter((x) => k.label.includes(x) || k.title.includes(x)), [], `${tag}: a token, a path or a link reached ${k.id}'s name or tooltip`);
        if (i) assert.ok(rank(d.kids[i - 1].state) <= rank(k.state), `${tag}: waiting and error kids stand first (${d.kids.map((x) => x.state)})`);
        for (const [what, list] of [['a plate', s.plates], ['a screen', s.screens], ['a sign', s.signs]]) for (const b of list) assert.ok(!hit(r, b), `${tag}: ${k.id} lies over ${what} ${JSON.stringify([r, b])}`);
        if (d.person) assert.ok(!hit(r, d.person), `${tag}: ${k.id} lies over the person`);
        assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= s.stage.w + 0.5 && r.y + r.h <= s.stage.h + 0.5, `${tag}: ${k.id} leaves the window`);
        d.kids.forEach((o, j) => { if (j > i) assert.ok(!hit(r, o.box), `${tag}: two kids of ${d.id} overlap`); });
        if (d.more) assert.ok(!hit(r, d.more.box), `${tag}: ${k.id} lies under "+K"`);
        kidsSeen++;
      });
      if (d.helpers > d.kz.shown) {
        moreSeen++;
        const K = d.helpers - d.kz.shown;
        assert.ok(d.more && d.more.text === '+' + K && d.more.fs >= 10.5 && d.more.label === `${K} more helper${K > 1 ? 's' : ''} of ${d.name}` && d.more.id === d.id, `${tag}: ${d.id}'s "+K" is "+${K}", 10.5 px or more, named (${JSON.stringify(d.more)})`);
        assert.deepStrictEqual(RAW.filter((x) => d.more.title.includes(x) || d.more.label.includes(x)), [], `${tag}: a token, a path or a link reached the "+K" tooltip`);
        for (const b of s.plates) assert.ok(!hit(d.more.box, b), `${tag}: "+K" of ${d.id} lies over a plate`);
      } else assert.ok(!d.more, `${tag}: ${d.id} shows all its helpers: no "+K"`);
    }
    assert.ok(kidsSeen >= 1 && moreSeen >= 1, `${tag}: kids (${kidsSeen}) and a "+K" (${moreSeen}) were checked`);
    const states = new Set(s.desks.flatMap((d) => d.kids.map((k) => k.state)));
    assert.ok(states.has('waiting') || states.has('limit'), `${tag}: a needs-you kid is drawn (${[...states]})`);

    const fd = s.desks.find((d) => d.id === first);
    /* Tab order (FR-309, FR-372): the plate, its pencil, the kids in order, "+K", then out of the group */
    if (process.env.KIDS_TRACE) await js(`(()=>{if(!window.__fT){window.__fT=[];const o=HTMLElement.prototype.focus;HTMLElement.prototype.focus=function(...a){window.__fT.push((this.className||this.tagName)+' '+String(new Error().stack).split('\\n').slice(2,6).join(' | '));return o.apply(this,a)};}return 1})()`);
    await js(`(()=>{document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(${jsLiteral(first)})+'"]').focus();return 1})()`);
    await H.key('Tab');
    if (await js(`document.activeElement.matches('.ren.ro-ren')`)) await H.key('Tab');
    for (const k of fd.kids) { await must(`document.activeElement.matches('.ro-kid')&&document.activeElement.dataset.id===${jsLiteral(k.id)}`, `${tag}: Tab reaches the kid ${k.id} in order`, 3000); await H.key('Tab'); }
    const onMore = await H.until(`document.activeElement.matches('.ro-kmore')`, 3000);
    const focusNow = onMore ? '' : await js(`(document.activeElement.className||document.activeElement.tagName)+' '+(document.activeElement.dataset.id||'')`);
    if (!onMore && process.env.KIDS_TRACE) console.log('[097-kids] focus calls', JSON.stringify(await js('window.__fT')));
    assert.ok(onMore, `${tag}: after the last kid, Tab reaches "+K" (focus on ` + focusNow + ')');
    assert.ok(await js(`(()=>{const c=getComputedStyle(document.activeElement);return c.outlineStyle!=='none'&&parseFloat(c.outlineWidth)>=2})()`), `${tag}: "+K" shows a 2 px focus ring`);
    await H.key('Tab');
    assert.ok(await js(`!document.activeElement.closest('.ro-kids')`), `${tag}: then Tab leaves the kids`);
    await js(`document.activeElement.blur();0`);

    /* a status change: no node added or removed, the kid keeps its node, its picture and class change, its place stays (FR-015, FR-184) */
    const target = fd.kids.find((k) => k.state === 'working') || fd.kids[fd.kids.length - 1];
    assert.ok(target, `${tag}: a kid to change`);
    await must(`${SIM}.visitsSettled()&&${SIM}.settleNow()`, `${tag}: the office settled`);
    /* a node moved for the new order (waiting and error first, orderedHelpers) is the same node; only a node made or dropped counts */
    await js(`(()=>{window.__kNode=document.querySelector('#stage .ro-kid[data-id="'+CSS.escape(${jsLiteral(target.id)})+'"]');window.__kBefore=new Set(document.querySelectorAll('#stage .ro *'));return 1})()`);
    const label0 = await js(`document.querySelector('#stage .ro-kid[data-id="'+CSS.escape(${jsLiteral(target.id)})+'"]').getAttribute('aria-label')`), s1 = await read(); /* after the settle: the boxes a status change must keep */
    /* states of the same rank, so the kid keeps its place (a waiting or error helper moves nearer the person, plan A11, and may then fall behind "+K" on a small desk) */
    const seq = /working|thinking|done|idle/.test(target.state) ? ['thinking', 'done', target.state] : target.state === 'limit' ? ['waiting', 'limit'] : ['limit', target.state];
    for (const st of seq) {
      assert.ok(await js(`${SIM}.helperState(${jsLiteral(target.id)},${jsLiteral(st)})`), `${tag}: set ${st}`);
      if (MUTANT === 'status') await js(`(()=>{const n=document.querySelector('#stage .ro-kid[data-id="'+CSS.escape(${jsLiteral(target.id)})+'"]');if(n)n.replaceWith(n.cloneNode(true));return 1})()`);
      await must(`(()=>{const b=document.querySelector('#stage .ro-kid[data-id="'+CSS.escape(${jsLiteral(target.id)})+'"]');return !!b&&b.classList.contains('st-'+${jsLiteral(st)})&&b.querySelector('img').getAttribute('src').endsWith('-'+window.exports.kidPose(${jsLiteral(st)},false)+'.webp')&&(${jsLiteral(st)}===${jsLiteral(target.state)}||${jsLiteral(st)}==='limit'||b.getAttribute('aria-label')!==${jsLiteral(label0)}) /* a helper's words have no limit of their own (helperWords): limit reads as waiting */})()`, `${tag}: the kid shows ${st}`);
      await must(PICS, `${tag}: the ${st} picture`);
    }
    const nodes = await js(`(()=>{const b=window.__kBefore,now=new Set(document.querySelectorAll('#stage .ro *')),out=[];for(const e of now)if(!b.has(e)&&!e.closest('.ro-slip'))out.push('+'+(typeof e.className==='string'?e.className:e.tagName));for(const e of b)if(!e.isConnected&&!(e.closest&&e.closest('.ro-slip')))out.push('-'+(typeof e.className==='string'?e.className:e.tagName));return out})()`);
    assert.deepStrictEqual(nodes, [], `${tag}: nodes made or dropped under the office over the kid's status changes`);
    assert.ok(await js(`window.__kNode&&window.__kNode.isConnected&&window.__kNode===document.querySelector('#stage .ro-kid[data-id="'+CSS.escape(${jsLiteral(target.id)})+'"]')`), `${tag}: the kid keeps its node`);
    const s2 = await read();
    for (const d of s1.desks) {
      const d2 = s2.desks.find((x) => x.id === d.id);
      for (const key of ['plate', 'group', 'kz']) assert.strictEqual(JSON.stringify(d2[key] && (key === 'kz' ? d2.kz.places : d2[key])), JSON.stringify(d[key] && (key === 'kz' ? d.kz.places : d[key])), `${tag}: a status change moves no place, plate or group (${d.id} ${key}: ${JSON.stringify(d[key])} -> ${JSON.stringify(d2[key])})`);
    }

    /* pointing at a kid opens no zoom (FR-372) */
    const kb = fd.kids[0].box, ob = await js(`(()=>{const r=document.querySelector('#stage .ro').getBoundingClientRect();return {x:r.left,y:r.top}})()`);
    const cx = Math.round(ob.x + kb.x + kb.w / 2), cy = Math.round(ob.y + kb.y + kb.h / 2);
    ctx.win.webContents.sendInputEvent({ type: 'mouseMove', x: cx, y: cy });
    await H.until(`false`, 900);
    assert.ok(await js(`(()=>{const z=document.getElementById('roZoom');return !z||z.hidden||getComputedStyle(z).display==='none'||getComputedStyle(z).visibility==='hidden'||parseFloat(getComputedStyle(z).opacity)===0})()`), `${tag}: pointing at a kid opens no zoom`);
    assert.ok(await js(`(()=>{const e=document.elementFromPoint(${jsLiteral(cx)},${jsLiteral(cy)});return !!e&&!!e.closest('.ro-kid')})()`), `${tag}: the kid is what the pointer hits at its centre`);
    /* a real click on a kid opens that helper's Sub-agent activity view */
    const kname = await js(`${SIM}.agents().find(x=>x.id===${jsLiteral(fd.kids[0].id)}).name`);
    for (const type of ['mouseDown', 'mouseUp']) ctx.win.webContents.sendInputEvent({ type, x: cx, y: cy, button: 'left', clickCount: 1 });
    await must(`document.body.classList.contains('panel-open')&&(document.getElementById('panelTitle')||{}).textContent===${jsLiteral(kname)}`, `${tag}: a click on a kid opens its activity view`);
    await H.key('Escape');
    await must(`!document.body.classList.contains('panel-open')`, `${tag}: Esc closes the view`);
    ctx.win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
    /* "+K" opens the parent's chat panel */
    const mb = fd.more.box, mx = Math.round(ob.x + mb.x + mb.w / 2), my = Math.round(ob.y + mb.y + mb.h / 2);
    for (const type of ['mouseDown', 'mouseUp']) ctx.win.webContents.sendInputEvent({ type, x: mx, y: my, button: 'left', clickCount: 1 });
    await must(`document.body.classList.contains('panel-open')&&(document.getElementById('panelTitle')||{}).textContent===${jsLiteral(fd.name)}`, `${tag}: a click on "+K" opens the parent's chat`);
    await H.key('Escape');
    await must(`!document.body.classList.contains('panel-open')`, `${tag}: Esc closes the chat`);
    ctx.win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
    await js(`document.activeElement&&document.activeElement.blur();0`);
    await must(PICS, `${tag}: the pictures before the shot`);
    await H.shot(path.join(OUT, `097-kids-${n}-${w}x${h}.jpg`), { prep: 'calm', tag: 'kids', what: tag });
    shots.push(`097-kids-${n}-${w}x${h}.jpg`);
    /* a picture that fails: the kid keeps its button and name and shows the silhouette, never a letter */
    const gone = fd.kids[0].id, nm = await js(`document.querySelector('#stage .ro-kid[data-id="'+CSS.escape(${jsLiteral(gone)})+'"]').getAttribute('aria-label')`);
    await js(`(()=>{document.querySelector('#stage .ro-kid[data-id="'+CSS.escape(${jsLiteral(gone)})+'"]').querySelector('img').dispatchEvent(new Event('error'));return 1})()`);
    await must(`(()=>{const b=document.querySelector('#stage .ro-kid[data-id="'+CSS.escape(${jsLiteral(gone)})+'"]');return !!b&&!!b.querySelector('.ro-hg')&&b.classList.contains('nopic')&&b.textContent.trim()===''})()`, `${tag}: a failed kid picture shows the silhouette, no letter`);
    assert.strictEqual(await js(`document.querySelector('#stage .ro-kid[data-id="'+CSS.escape(${jsLiteral(gone)})+'"]').getAttribute('aria-label')`), nm, `${tag}: the name stays without the picture`);
  }

  /* 15 agents: no desk top has room; the head row's heads are the kids' faces (FR-370) */
  for (const [w, h] of SIZES) {
    const tag = `15 agents ${w}x${h}`;
    await H.load({ w, h, query: { officeview: 'real', simfreeze: '1', sim: '15', simhelpers: '6' }, ready: REAL(10), readyMs: 30000, settle: false });
    await must(PICS, `${tag}: the pictures`);
    await must(`document.querySelectorAll('#stage .ro-hd img').length>=10`, `${tag}: the head rows`);
    await mutate();
    await must(PICS, `${tag}: the head pictures`);
    assert.strictEqual(await js(`document.querySelectorAll('#stage .ro-kids').length`), 0, `${tag}: no kids on a busy desk`);
    const heads = await js(`(()=>{const E=window.exports,ro=document.querySelector('#stage .ro'),meta=Object.assign({},window.DurbarRealOfficeWorlds[ro.dataset.world],window.DurbarRealOfficeSets[ro.dataset.set]);
      return [...document.querySelectorAll('#stage .ro-hd')].map(b=>{const im=b.querySelector('img'),hd=E.helperHead(b.dataset.id,null,meta);return {id:b.dataset.id,src:im&&im.getAttribute('src'),nat:im?im.naturalWidth:0,want:'realoffice/worlds/photo/'+hd.file}})})()`);
    assert.ok(heads.length >= 10, `${tag}: heads drawn (${heads.length})`);
    for (const t of heads) assert.ok(t.src === t.want && /\/kid\d-/.test(t.src) && t.nat > 0, `${tag}: ${t.id}'s head is a kid's face (${t.src}, want ${t.want})`);
    await H.shot(path.join(OUT, `097-kids-15-${w}x${h}.jpg`), { prep: 'calm', tag: 'kids', what: tag });
    shots.push(`097-kids-15-${w}x${h}.jpg`);
  }
  console.log('[097-kids] ok', OUT, shots.join(' '));
  process.exitCode = 0;
};
