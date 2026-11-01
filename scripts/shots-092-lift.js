/*
 * Checks + screenshots for spec 092 phase 2 (the lift panel, its badges and the All floors view). Simulator only (no AI credits, no Copilot login):
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 DURBAR_SIM_FLOORS=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-092-lift.js npx electron .        (xvfb-run -a ... --no-sandbox on Linux)
 *
 * Real clicks and key presses (sendInputEvent), at 1440x900 and 1280x800; every wait is a condition (until), and the driver exits non-zero on a miss:
 *   FR-006/FR-007  three floors on: a vertical toolbar "Floors" with All and one button per floor in floor order, labelled 1..3, each at least 28x28 px with
 *                  text at least 10.5 px; names "<floor>, floor n of m[: words]"; aria-current on the floor shown; the lift is not inside the office area.
 *   FR-014..FR-016 SC-004: the badges equal the agents that need the user on the other floors (an oracle from the desks of the All floors view and the
 *                  simulator's agents); none on the floor shown; a New reply on another floor adds a badge at once and clears exactly when its chat is shown.
 *   FR-017         the pills count the whole building whatever is shown.
 *   FR-013         one tab stop; Up/Down/Home/End move the focus; Enter and Space choose; focus stays on the button after the change.
 *   FR-031..FR-036 All: every floor in one screen (15 desks, every floor tag, no empty-floor line, no badge, no visitor label naming a floor), announced
 *                  once as "All floors, 3 floors"; a floor button goes back to that floor; the choice survives a reload (FR-037); PageUp/PageDown do
 *                  nothing in All (FR-034); Show only and switching a floor back on keep the view, and a floor switched off in All moves nothing and
 *                  says nothing (FR-035); a status pill in All filters the whole office.
 *   FR-004         one floor on: no lift.
 *   FR-028         a lift that scrolls (the shaft made short by a style: the simulator has three floors) sums the badges out of view on its edge rows,
 *                  and an edge row scrolls to the nearest badged button and focuses it.
 * Screenshots: 092-lift-{one,all}-<w>x<h>.png
 */
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';
const SIZES = [[1440, 900], [1280, 800]];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until, settle, key } = H;
  const shot = (name, w, h) => H.shot(path.join(OUT, `092-lift-${name}-${w}x${h}.png`), { tag: '092-lift', what: `${name} ${w}x${h}` });
  const watch = () => js(`(()=>{window.__ann=[];const el=document.getElementById('srAnnounce');new MutationObserver(()=>{const t=el.textContent;if(t)window.__ann.push(t);}).observe(el,{childList:true,characterData:true,subtree:true});})()`);
  const anns = () => js(`window.__ann.filter(t=>/^(Floor |All floors)/.test(t))`);
  const annEq = async (want, msg) => { if (want.length) await until(`JSON.stringify(window.__ann.filter(t=>/^(Floor |All floors)/.test(t)))===${jsLiteral(JSON.stringify(want))}`, 3000); else await settle(); assert.deepStrictEqual(await anns(), want, msg); };
  const lift = () => js(`(()=>{const l=document.getElementById('lift');const bs=[...l.querySelectorAll('.lift-b')];return {shown:!l.hidden&&l.getClientRects().length>0,role:l.getAttribute('role'),label:l.getAttribute('aria-label'),orient:l.getAttribute('aria-orientation'),
    inFloor:!!l.closest('#floor'),width:l.offsetWidth,
    b:bs.map(b=>{const r=b.getBoundingClientRect(),bd=b.querySelector('.lift-badge');return {id:b.dataset.lift,text:(b.querySelector('.lift-n')||b).textContent.trim(),name:b.getAttribute('aria-label'),title:b.title,cur:b.getAttribute('aria-current'),tab:b.getAttribute('tabindex'),
      w:r.width,h:r.height,font:parseFloat(getComputedStyle(b).fontSize),badge:bd&&!bd.hidden?bd.textContent:'',bfont:bd?parseFloat(getComputedStyle(bd).fontSize):99};}),
    focus:document.activeElement&&document.activeElement.dataset?document.activeElement.dataset.lift||'':''};})()`);
  const view = () => js(`(()=>{const tags=[...new Set([...document.querySelectorAll('#stage .room-head .floor-tag')].map(t=>t.textContent.trim()))];
    return {tags,desks:[...document.querySelectorAll('#stage .desk[data-id]')].filter(d=>!d.closest('.helpers')).length,empty:!!document.querySelector('#stage .floor-empty'),
      pills:[...document.querySelectorAll('#stats .stat[data-k] b')].reduce((n,b)=>n+(+b.textContent||0),0),floor:localStorage.getItem('durbar.floor'),view:localStorage.getItem('durbar.floorView')};})()`);
  const btn = (id) => `#lift [data-lift="${id}"]`;
  /* announce() keeps only the last text given within 60 ms, and laying out the whole building can take a few hundred ms under xvfb: after a change, wait
     for its announcement before the next one, so each change is heard on its own (a no-op change, quiet=true, only settles) */
  const heard = async (n0, quiet) => { if (quiet) { await settle(); return; } await until(`window.__ann.filter(t=>/^(Floor |All floors)/.test(t)).length>${jsLiteral(n0)}`, 5000); };
  const nAnn = async () => (await anns()).length;
  const press = async (k, mods, o, quiet) => { const n0 = await nAnn(); await key(k, mods, o); await heard(n0, quiet); };
  const clickBtn = async (id, quiet) => { // a real mouse click in the middle of the button
    const n0 = await nAnn();
    const r = await js(`(()=>{const b=document.querySelector(${jsLiteral(btn(id))});b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
    for (const type of ['mouseDown', 'mouseUp']) H.wc().sendInputEvent({ type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
    await heard(n0, quiet);
  };
  const isAll = () => until(`document.querySelector('#lift [data-lift="*all"]').getAttribute('aria-current')==='true'&&new Set([...document.querySelectorAll('#stage .room-head .floor-tag')].map(t=>t.textContent.trim())).size===3`);
  const onFloor = (name) => until(`(()=>{const t=[...new Set([...document.querySelectorAll('#stage .room-head .floor-tag')].map(t=>t.textContent.trim()))];return t.length===1&&t[0]===${jsLiteral(name)}})()`);
  /* SC-004 oracle: in the All floors view every desk is on screen with its room's floor tag; an agent needs the user when it waits or has an error (its desk's
     state), has reached a limit (the simulator's agent), or has a New reply (the desk's marker). Each agent once. */
  const oracle = () => js(`(()=>{const ag=new Map(window.__durbarSimUi.agents().map(a=>[a.id,a]));const out={};
    document.querySelectorAll('#stage .room').forEach(room=>{const f=(room.querySelector('.room-head .floor-tag')||{}).textContent;
      room.querySelectorAll('.desk[data-id]').forEach(d=>{if(d.closest('.helpers'))return;const a=ag.get(d.dataset.id);if(!a||a.parent)return;
        const need=d.dataset.state==='waiting'||d.dataset.state==='error'||!!a.limit||!!a.coffee||d.classList.contains('is-unread');if(need&&f)out[f.trim()]=(out[f.trim()]||0)+1;});});return out;})()`);
  const reset = async (w, h, query, all) => {
    await js(`localStorage.removeItem('durbar.floor');if(${jsLiteral(!!all)})localStorage.setItem('durbar.floorView','all');else localStorage.removeItem('durbar.floorView');`);
    await H.load({ w, h, query, focus: true });
    await watch(); await H.calm();
  };
  const panel = async (open) => { await js(`(()=>{const p=document.getElementById('floorsPop');if(p.hidden===${open})document.getElementById('floorsBtn').click();})()`); await until(`document.getElementById('floorsPop').hidden===${!open}`); };
  const floorSw = async (id, want) => { await panel(true); const sel = `[data-fl="on"][data-floor="${id}"]`; const on = await js(`document.querySelector(${jsLiteral(sel)}).getAttribute('aria-checked')==='true'`); if (on !== want) await js(`document.querySelector(${jsLiteral(sel)}).click()`); await until(`document.querySelector(${jsLiteral(sel)}).getAttribute('aria-checked')===${jsLiteral(String(want))}`); await panel(false); await settle(); };
  const only = async (id) => { await panel(true); await js(`document.querySelector(${jsLiteral(`[data-fl="only"][data-floor="${id}"]`)}).click()`); await until(`document.getElementById('floorsBtn').textContent.trim().startsWith('1/')`); await panel(false); await settle(); };
  const NAMES = ['Ground floor', 'Client A', 'Personal'];

  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    // ---- FR-006, FR-007: the panel ----
    await reset(w, h, { simfloors: '1' });
    assert.ok(await onFloor('Ground floor'), `${tag}: starts on the first floor`);
    let L = await lift();
    assert.ok(L.shown && L.role === 'toolbar' && L.label === 'Floors' && L.orient === 'vertical', `${tag}: a vertical toolbar named Floors: ${JSON.stringify(L).slice(0, 200)}`);
    assert.ok(!L.inFloor, `${tag}: the lift is outside the office area, so its width comes out of it (FR-008)`);
    assert.deepStrictEqual(L.b.map((b) => b.text), ['All', '1', '2', '3'], `${tag}: All, then the floors by position (Q-B)`);
    for (const b of L.b) assert.ok(b.w >= 28 && b.h >= 28 && b.font >= 10.5 && b.bfont >= 10.5, `${tag}: button ${b.text} ${b.w}x${b.h}, text ${b.font}px, badge ${b.bfont}px`);
    assert.deepStrictEqual(L.b.slice(1).map((b) => b.name.split(':')[0]), NAMES.map((n, i) => `${n}, floor ${i + 1} of 3`), `${tag}: accessible names`);
    assert.deepStrictEqual(L.b.slice(1).map((b) => b.title.split('\n')[0]), NAMES, `${tag}: the tooltip names the floor`);
    assert.strictEqual(L.b[0].name, 'All floors, 3 floors', `${tag}: All's name`);
    assert.deepStrictEqual(L.b.map((b) => b.cur), [null, 'true', null, null], `${tag}: aria-current on the floor shown`);
    assert.deepStrictEqual(L.b.map((b) => b.tab), ['-1', '0', '-1', '-1'], `${tag}: one tab stop, on the floor shown (FR-013)`);
    await shot('one', w, h);

    // ---- FR-014..FR-016, SC-004: badges match the agents that need the user on the other floors ----
    const checkBadges = async (shown, why) => {
      L = await lift();
      const cur = L.b.find((b) => b.cur === 'true');
      for (const b of L.b.slice(1)) {
        const name = b.title.split('\n')[0], want = name === shown ? 0 : (await expected)[name] || 0;
        assert.strictEqual(b.badge, want ? (want > 9 ? '9+' : String(want)) : '', `${tag} ${why}: badge of ${name} (shown ${cur && cur.title.split('\n')[0]})`);
        if (want) assert.ok(/: \d+ /.test(b.name) && b.title.includes('\n'), `${tag} ${why}: ${name}'s name and tooltip carry the words: ${b.name} / ${b.title}`);
      }
    };
    await clickBtn('*all'); assert.ok(await isAll(), `${tag}: All by a click`);
    let expected = oracle();
    const ex0 = await expected;
    assert.ok(Object.keys(ex0).length >= 2, `${tag}: precondition: agents need the user on two floors or more ${JSON.stringify(ex0)}`);
    L = await lift();
    assert.ok(L.b.every((b) => !b.badge), `${tag}: no badge in the All floors view (FR-035)`);
    await clickBtn('ground'); assert.ok(await onFloor('Ground floor'), `${tag}: a floor button leaves All for that floor`);
    await checkBadges('Ground floor', 'on Ground');
    await clickBtn('f-clienta0'); assert.ok(await onFloor('Client A'), `${tag}: button 2 shows Client A`);
    await checkBadges('Client A', 'on Client A');
    L = await lift();
    assert.strictEqual(L.focus, 'f-clienta0', `${tag}: focus stays on the button used (US1 2)`);
    assert.deepStrictEqual(L.b.map((b) => b.tab), ['-1', '-1', '0', '-1'], `${tag}: the tab stop follows`);
    let v = await view();
    assert.strictEqual(v.pills, 15, `${tag}: the pills count the whole building (FR-017)`);
    await annEq(['All floors, 3 floors', 'Floor Ground floor, 1 of 3', 'Floor Client A, 2 of 3'], `${tag}: one announcement per change`);
    // a New reply on Personal (an agent that does not need the user yet) adds a badge at once; showing its chat clears it with the desk's own New
    await clickBtn('*all'); assert.ok(await isAll());
    const quiet = await js(`(()=>{const ag=new Map(window.__durbarSimUi.agents().map(a=>[a.id,a]));const r=[...document.querySelectorAll('#stage .room')].find(r=>(r.querySelector('.floor-tag')||{}).textContent==='Personal');
      const d=r&&[...r.querySelectorAll('.desk[data-id]')].find(d=>!d.closest('.helpers')&&!['waiting','error'].includes(d.dataset.state)&&!d.classList.contains('is-unread')&&!ag.get(d.dataset.id).limit&&!ag.get(d.dataset.id).coffee);return d?d.dataset.id:null;})()`);
    assert.ok(quiet, `${tag}: precondition: a Personal agent that does not need the user`);
    await clickBtn('ground'); assert.ok(await onFloor('Ground floor'));
    const before = (await lift()).b[3].badge;
    await js(`(()=>{const E=e=>window.__durbarSimEmit(Object.assign({timestamp:Date.now(),sessionId:${jsLiteral(quiet)}},e));E({type:'status',status:'working',intent:'Working'});E({type:'output',final:true,text:'Done.'});E({type:'status',status:'idle'});})()`);
    assert.ok(await until(`(document.querySelector(${jsLiteral(btn('f-personal') + ' .lift-badge')})||{}).textContent===${jsLiteral(String((+before || 0) + 1))}`), `${tag}: a New reply on Personal adds to its badge (${before} before)`);
    assert.ok(/new reply/.test((await lift()).b[3].name), `${tag}: the name says new reply`);
    await js(`window.__durbarSimUi.crew.openPanel(${jsLiteral(quiet)})`);
    assert.ok(await until(`document.body.classList.contains('panel-open')`), `${tag}: the chat opens`);
    await js(`document.getElementById('backBtn').click()`);
    assert.ok(await until(`!document.body.classList.contains('panel-open')`));
    assert.ok(await until(`(document.querySelector(${jsLiteral(btn('f-personal') + ' .lift-badge:not([hidden])')})||{textContent:''}).textContent===${jsLiteral(before)}`), `${tag}: shown, the New reply leaves the badge`);

    // ---- FR-013: keyboard ----
    await reset(w, h, { simfloors: '1' });
    await js(`document.querySelector('#lift .lift-b[tabindex="0"]').focus()`);
    assert.strictEqual((await lift()).focus, 'ground', `${tag}: the tab stop is the floor shown`);
    await key('Down'); assert.ok(await until(`document.activeElement.dataset.lift==='f-clienta0'`), `${tag}: Down moves the focus`);
    await key('End'); assert.ok(await until(`document.activeElement.dataset.lift==='f-personal'`), `${tag}: End`);
    await key('Down'); assert.ok(await until(`document.activeElement.dataset.lift==='f-personal'`), `${tag}: Down at the end stays`);
    await key('Home'); assert.ok(await until(`document.activeElement.dataset.lift==='*all'`), `${tag}: Home goes to All (FR-032)`);
    await key('Up'); assert.ok(await until(`document.activeElement.dataset.lift==='*all'`), `${tag}: Up at the top stays`);
    assert.ok(await onFloor('Ground floor'), `${tag}: moving the focus changes nothing`);
    await press('Return', [], {}); assert.ok(await isAll(), `${tag}: Enter on All shows All floors`);
    assert.strictEqual((await lift()).focus, '*all', `${tag}: focus stays on All`);
    await key('Down'); await key('Down'); assert.ok(await until(`document.activeElement.dataset.lift==='f-clienta0'`));
    await press('Space', [], { char: 'always' }); assert.ok(await onFloor('Client A'), `${tag}: Space on 2 shows Client A`);
    assert.strictEqual((await lift()).focus, 'f-clienta0', `${tag}: focus stays on the button`);
    await annEq(['All floors, 3 floors', 'Floor Client A, 2 of 3'], `${tag}: keyboard changes are announced once each`);

    // ---- FR-031..FR-037: the All floors view ----
    await reset(w, h, { simfloors: '1' });
    await clickBtn('*all'); assert.ok(await isAll());
    v = await view();
    assert.ok(v.desks === 15 && v.tags.length === 3 && !v.empty && v.view === 'all', `${tag}: the whole building on one screen, remembered: ${JSON.stringify(v)}`);
    const labels = await js(`[...document.querySelectorAll('.lobby .place')].map(p=>p.getAttribute('aria-label')||'').join(' | ')`);
    assert.ok(!/\((?:[^()]*, )(?:Ground floor|Client A|Personal)\)/.test(labels), `${tag}: no lobby label names a floor in All (FR-035): ${labels.slice(0, 200)}`);
    await clickBtn('*all', true); await annEq(['All floors, 3 floors'], `${tag}: choosing the view shown again says nothing`);
    await shot('all', w, h);
    await js(`document.body.focus()`);
    await key('PageDown'); await key('PageUp'); await key('PageDown');
    assert.ok(await isAll(), `${tag}: PageUp/PageDown do not leave All (FR-034)`);
    await annEq(['All floors, 3 floors'], `${tag}: and say nothing`);
    await H.load({ w, h, query: { simfloors: '1' }, focus: true }); await watch();
    assert.ok(await isAll(), `${tag}: All survives a reload (FR-037)`);
    // FR-035: the current floor switched off in All moves nothing and says nothing; Show only and switching back on keep the view
    await floorSw('ground', false);
    assert.ok(await until(`new Set([...document.querySelectorAll('#stage .room-head .floor-tag')].map(t=>t.textContent.trim())).size===2&&document.querySelector('#lift [data-lift="*all"]').getAttribute('aria-current')==='true'`), `${tag}: a floor off in All: still All, two floors`);
    await annEq([], `${tag}: and nothing is announced`);
    await floorSw('ground', true);
    await only('f-personal');
    assert.ok(await until(`document.getElementById('lift').hidden&&document.querySelectorAll('#stage .floor-tag').length===0`), `${tag}: one floor on: no lift (FR-004)`);
    await floorSw('ground', true);
    assert.ok(await until(`!document.getElementById('lift').hidden&&document.querySelector('#lift [data-lift="*all"]').getAttribute('aria-current')==='true'`), `${tag}: a second floor on again: the remembered All view (FR-035)`);
    await floorSw('f-clienta0', true);
    assert.ok(await isAll(), `${tag}: three floors, still All`);
    // a status pill in All filters the whole office (agents of more than one floor stay on screen), never the empty-floor line
    await js(`document.querySelector('#stats .stat[data-k="waiting"]').click()`);
    assert.ok(await until(`document.querySelector('#stats .stat[data-k="waiting"]').getAttribute('aria-pressed')==='true'`));
    await settle();
    const wf = await js(`(()=>{const ds=[...document.querySelectorAll('#stage .desk[data-id]')].filter(d=>!d.closest('.helpers')&&d.getClientRects().length&&getComputedStyle(d).opacity!=='0');
      return {floors:[...new Set(ds.filter(d=>d.dataset.state==='waiting').map(d=>(d.closest('.room').querySelector('.floor-tag')||{}).textContent))].length,empty:!!document.querySelector('#stage .floor-empty')};})()`);
    assert.ok(wf.floors >= 2 && !wf.empty, `${tag}: the Waiting filter in All shows waiting agents of every floor: ${JSON.stringify(wf)}`);
    await js(`document.querySelector('#stats .stat[data-k="waiting"]').click()`);
    await js(`localStorage.removeItem('durbar.floorView')`);
  }

  // ---- FR-028: badges out of view in a lift that scrolls are summed on its edges ----
  {
    const [w, h] = [1440, 900];
    await reset(w, h, { simfloors: '1' });
    await js(`(()=>{const s=document.createElement('style');s.id='shortShaft';s.textContent='#lift .lift-shaft{max-height:44px!important}';document.head.append(s);
      const sh=document.querySelector('#lift .lift-shaft');sh.scrollTop=0;sh.dispatchEvent(new Event('scroll'));})()`);
    assert.ok(await until(`(()=>{const d=document.querySelector('#lift [data-lift-edge="down"]');return d&&!d.hidden&&/^▼ \\d/.test(d.textContent);})()`), 'FR-028: a badged floor below the visible part shows on the bottom edge');
    const e = await js(`(()=>{const d=document.querySelector('#lift [data-lift-edge="down"]');return {t:d.textContent,name:d.getAttribute('aria-label'),font:parseFloat(getComputedStyle(d).fontSize)};})()`);
    assert.ok(/waiting|error|limit|new reply/.test(e.name) && e.font >= 10.5, `FR-028: the edge row's name has the words: ${JSON.stringify(e)}`);
    await js(`document.querySelector('#lift [data-lift-edge="down"]').click()`);
    assert.ok(await until(`document.activeElement&&document.activeElement.classList.contains('badged')`), 'FR-028: the edge row focuses the nearest badged button');
    assert.ok(await until(`(()=>{const sh=document.querySelector('#lift .lift-shaft').getBoundingClientRect(),b=document.activeElement.getBoundingClientRect();return b.top>=sh.top-1&&b.bottom<=sh.bottom+1;})()`), 'FR-028: and scrolls it into view');
    await js(`document.getElementById('shortShaft').remove()`);
  }

  // ---- FR-004: one floor on: no lift ----
  await reset(1440, 900, { simfloors: '1', floorsoff: 'Client A,Personal' });
  assert.ok(await until(`document.getElementById('lift').hidden&&document.querySelectorAll('#stage .desk[data-id]').length>0`), 'one floor on: no lift');
  console.log('shots-092-lift: ok');
};
