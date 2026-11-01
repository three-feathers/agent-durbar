/*
 * Spec 102 RA3 (T209..T211): the Retro arcade hall, drawn, behind its closed flag. Simulator only: no AI credits, no account. In ui-suite.js;
 * `node scripts/ui-suite.js --only shots-102-arcade`.
 *
 * It fails (exit 1) when:
 *   - the flag is closed and a stored choice draws the arcade, asks for one of its files or offers it (FR-254);
 *   - the flag is open and a file of another world or set is asked for, a picture fails, or the art is not at one integer scale with the nearest pixel (FR-255);
 *   - at 3, 4, 8 and 15 agents, 1440x900 and 1280x800: plates, signs, marquees, cues, chips or fixtures overlap, text is under 10.5 px or a marquee under 12 px,
 *     the office scrolls at 15, or Tab does not follow the seats (FR-229, FR-256, SC-022);
 *   - a screen or marquee shows markup from a hostile name or output, a text sits in a mirrored element, anything is skewed, or a text's contrast is under 4.5:1 (FR-257, FR-258);
 *   - someone at a cabinet shows another frame than FR-259's table says.
 * Screenshots: <SHOTS_OUT>/102-arcade-<n>-<w>x<h>.png
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-102-arcade-'));
const SIZES = [[1440, 900], [1280, 800]];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const js = async (e) => { try { return await H.js(e); } catch (x) { console.log('[102-arcade] this page script failed:', String(e).slice(0, 300)); throw x; } };
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
  const PICS = `[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`;
  const packs = () => js(`[...new Set([...document.querySelectorAll('script[src],link[href],#stage img[src]')].map(e=>e.getAttribute('src')||e.getAttribute('href')).filter(n=>/realoffice\\/(worlds|sets)\\//.test(n)).map(n=>n.replace(/^.*realoffice\\/(worlds|sets)\\/([^/]+)\\/.*$/,'$1/$2')))].sort().join(' ')`);
  const ARCADE = { worldflags: 'retro', world: 'retro' };
  const loadArcade = async (w, h, n, query = {}) => {
    await H.load({ w, h, query: { officeview: 'real', ...ARCADE, sim: String(n), ...query }, ready: REAL, settle: false });
    await must(PICS, 'the pictures');
  };

  // ---- the flag closed: a stored choice draws the Photo office, asks for nothing of the arcade, and it is not offered ----
  await H.load({ w: 1440, h: 900, query: { officeview: 'real' }, ready: REAL, settle: false });
  await js(`localStorage.setItem('durbar.world','retro');0`);
  await H.load({ w: 1440, h: 900, query: { officeview: 'real' }, ready: REAL, settle: false });
  await must(PICS, 'the pictures');
  assert.strictEqual(await js(`(()=>{const r=document.querySelector('#stage .ro');return r.dataset.world+' '+r.dataset.set})()`), 'photo office', 'flag closed: the Photo office');
  assert.strictEqual(await packs(), 'sets/office worlds/photo', 'flag closed: no file of the arcade asked for: ' + await packs());
  await js(`window.DurbarScreens.openSettings();0`);
  await must(`!!document.querySelector('[data-officelayout="real"]')`, 'Settings');
  assert.strictEqual(await js(`!![...document.querySelectorAll('#wrGroup [data-world]')].find(b=>b.dataset.world==='retro')`), false, 'flag closed: not offered');
  await js(`document.getElementById('scrClose').click();localStorage.removeItem('durbar.world');0`);

  /* what overlaps what, on the page's own boxes */
  const OVER = `(()=>{const R=e=>e.getBoundingClientRect(),hit=(a,b)=>a.left<b.right-0.5&&b.left<a.right-0.5&&a.top<b.bottom-0.5&&b.top<a.bottom-0.5;
    const seen=(s)=>[...document.querySelectorAll('#stage '+s)].filter(e=>e.getClientRects().length);
    const name=(e)=>e.className.split(' ')[0]+':'+(e.dataset.id||e.dataset.folder||e.dataset.for||e.textContent).slice(0,14);
    const groups=[['.ro-plate','.ro-plate'],['.ro-sign','.ro-sign'],['.ro-plate','.ro-sign'],['.ro-marquee','.ro-marquee'],['.ro-marquee','.ro-sign'],['.ro-marquee','.ro-plate'],['.ro-bub','.ro-sign'],['.ro-bub','.ro-plate'],['.ro-bub','.ro-marquee'],['.ro-bang','.ro-sign'],['.ro-bang','.ro-plate'],['.ro-dots','.ro-sign'],['.ro-chip','.ro-lplate'],['.ro-chip','.ro-chip'],['.ro-lplate','.ro-lplate'],['.ro-away','.ro-marquee'],['.ro-away','.ro-plate'],['.ro-away','.ro-stext'],['.ro-away','.ro-sign'],['.ro-visitor','.ro-sign'],['.ro-cab','.ro-cab'],['.ro-cab','.ro-fx'],['.ro-person','.ro-sign'],['.ro-stext','.ro-sign'],['.ro-stext','.ro-plate']];
    const out=[];for(const [p,q] of groups){const P=seen(p),Q=seen(q);for(const a of P)for(const b of Q)if(a!==b&&!(p===q&&P.indexOf(a)>P.indexOf(b))&&hit(R(a),R(b)))out.push(name(a)+' on '+name(b));}return out;})()`;
  const LUM = `const lum=(c)=>{const m=c.match(/[\\d.]+/g).map(Number),f=(v)=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};return 0.2126*f(m[0])+0.7152*f(m[1])+0.0722*f(m[2]);};const bgOf=(e)=>{for(let x=e;x;x=x.parentElement){const c=getComputedStyle(x).backgroundColor,m=c.match(/[\\d.]+/g).map(Number);if(m.length<4||m[3]>0.5)return c;}return 'rgb(255,255,255)';};const ratio=(a,b)=>{const l=[lum(a),lum(b)].sort((x,y)=>y-x);return (l[0]+0.05)/(l[1]+0.05);};`;
  const TEXT = '(()=>{' + LUM + `const small=[],low=[];for(const e of document.querySelectorAll('#stage .ro-plate .ro-l2,#stage .ro-marquee,#stage .ro-sign b,#stage .ro-stext .ro-sl')){if(!e.getClientRects().length||!e.textContent.trim())continue;const c=getComputedStyle(e),px=parseFloat(c.fontSize);if(px<(e.classList.contains('ro-marquee')?12:10.5))small.push(e.className+' '+px);const r=ratio(c.color,bgOf(e));if(r<4.5)low.push(e.className+' '+r.toFixed(2)+' '+c.color);}return {small,low};})()`;

  for (const [w, h] of SIZES) for (const n of [3, 4, 8, 15]) {
    const tag = `${n} agents at ${w}x${h}`;
    await loadArcade(w, h, n);
    assert.strictEqual(await js(`(()=>{const r=document.querySelector('#stage .ro');return r.dataset.world+' '+r.dataset.set})()`), 'retro retro', tag + ': the arcade with its set');
    assert.strictEqual(await packs(), 'sets/retro worlds/retro', tag + ': only its own files: ' + await packs());
    assert.deepStrictEqual(await js(`[...document.querySelectorAll('#stage .ro img')].filter(i=>!i.naturalWidth).map(i=>i.getAttribute('src'))`), [], tag + ': every picture loads');
    const art = await js(`(()=>{const L=window.__durbarSimUi.realLayout(),g=L.g,ro=document.querySelector('#stage .ro').getBoundingClientRect(),off=[];
      for(const e of document.querySelectorAll('#stage .ro-person,#stage .ro-cab')){const b=e.getBoundingClientRect(),x=b.left-ro.left,y=b.top-ro.top;if(Math.abs(b.width/g-Math.round(b.width/g))>0.01)off.push(e.className+' w '+b.width);if(e.classList.contains('ro-cab')&&Math.abs(x/g-Math.round(x/g))>0.01)off.push('cab x '+x);}
      const px=getComputedStyle(document.querySelector('#stage .ro-person,#stage .ro-visitor')).imageRendering,cab=getComputedStyle(document.querySelector('#stage .ro-cab')).imageRendering;
      return {g,off,px,cab,scroll:!!L.scroll,fh:document.getElementById('floor').scrollHeight-document.getElementById('floor').clientHeight,scan:[...document.querySelectorAll('#stage *')].filter(e=>/skew/.test(e.style.transform||'')||/matrix\\([^)]*\\)/.test(getComputedStyle(e).transform)&&(()=>{const m=getComputedStyle(e).transform.match(/[-\\d.]+/g).map(Number);return Math.abs(m[0]*m[2]+m[1]*m[3])>1e-3;})()).length,mirrorText:[...document.querySelectorAll('#stage .mir')].filter(e=>e.textContent.trim()).length};})()`);
    console.log('[102-arcade]', tag, JSON.stringify({ g: art.g, scroll: art.scroll }));
    assert.ok(Number.isInteger(art.g) && art.g >= 2, tag + ': an integer scale: ' + art.g);
    assert.deepStrictEqual(art.off, [], tag + ': the art on the grid');
    assert.strictEqual(art.px, 'pixelated', tag + ': nearest pixel, people'); assert.strictEqual(art.cab, 'pixelated', tag + ': nearest pixel, cabinets');
    assert.strictEqual(art.scan, 0, tag + ': nothing skewed'); assert.strictEqual(art.mirrorText, 0, tag + ': no text in a mirrored element');
    if (n <= 15) { assert.strictEqual(art.scroll, false, tag + ': no office scroll'); assert.ok(art.fh <= 1, tag + ': the floor does not scroll: ' + art.fh); }
    await H.until(`${OVER}.length===0`, 5000); /* a font face can arrive after the first drawing */
    assert.deepStrictEqual(await js(OVER), [], tag + ': no overlap');
    assert.deepStrictEqual(await js(TEXT), { small: [], low: [] }, tag + ': text size and contrast');
    const seats = await js(`(()=>{const L=window.__durbarSimUi.realLayout(),T=window.exports.aisleTabOrder(L),P=[...document.querySelectorAll('#stage .ro-plate')].map(p=>p.dataset.id);return {tab:T,dom:P};})()`);
    assert.deepStrictEqual(seats.dom, seats.tab, tag + ': Tab follows the seats');
    await H.shot(path.join(OUT, `102-arcade-${n}-${w}x${h}.png`), { prep: 'calm' });
  }

  // ---- FR-259: the frame by state; FR-257: hostile text stays text ----
  await loadArcade(1440, 900, 15);
  const pose = await js(`(()=>{const T={working:'type',thinking:'book',error:'knock',waiting:'face-knock',limit:'face-knock',done:'face-coffee',idle:'face-book',asleep:'rest'}/* FR-259's table, written out: not read from the code it checks */,L=window.__durbarSimUi.realLayout(),bad=[];let n=0;for(const d of L.zones.flatMap(z=>z.desks)){if(!d.person)continue;n++;const want=T[d.state],got=d.person.pose;if(got!==want&&got!=={'face-knock':'knock','face-coffee':'counter','face-book':'book'}[want])bad.push(d.id+' '+d.state+' '+got);const e=document.querySelector('#stage .ro-person[data-for="'+CSS.escape(d.id)+'"]');if(!e||e.dataset.pose!==got)bad.push(d.id+' not drawn');}return {n,bad};})()`);
  assert.ok(pose.n >= 5, 'people at cabinets: ' + pose.n);
  assert.deepStrictEqual(pose.bad, [], 'the frame by state');

  const victim = await js(`window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks).find(d=>d.person).id`);
  const HOSTILE = '<img src=x onerror=window.__pwned=1>' + 'very long name '.repeat(6);
  await js(`(()=>{const a=window.__durbarSimUi.agents().find(x=>x.id===${jsLiteral(victim)});a.name=${jsLiteral(HOSTILE)};window.__durbarSimUi.setLive(true);})();0`);
  const MQ = `(()=>{const ro=document.querySelector('#stage .ro').getBoundingClientRect(),d=window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks).find(x=>x.id===${jsLiteral(victim)}),e=[...document.querySelectorAll('#stage .ro-marquee')].find(m=>{const b=m.getBoundingClientRect();return Math.abs(b.left-ro.left-d.marquee.x)<1&&Math.abs(b.top-ro.top-d.marquee.y)<1;});return e&&{text:e.textContent,kids:e.children.length,cut:e.scrollWidth>e.clientWidth,over:getComputedStyle(e).textOverflow};})()`;
  await must(`(${MQ})&&(${MQ}).text.includes('onerror')`, 'the hostile name on the marquee');
  const mq = await js(MQ);
  assert.strictEqual(mq.kids, 0, 'a name is text, no element from it');
  assert.ok(mq.cut && mq.over === 'ellipsis', 'a long name ends in an ellipsis: ' + JSON.stringify(mq));
  assert.strictEqual(await js(`!!window.__pwned`), false, 'nothing ran');
  assert.deepStrictEqual(await js(OVER), [], 'a long name overlaps nothing');

  // ---- with motion on, a mirrored picture stays mirrored, also while something moves it (a static transform would be overridden) ----
  await loadArcade(1280, 800, 15, { romotion: '1', simfreeze: undefined });
  await must(`!!document.querySelector('#stage .ro-person.mir')`, 'a mirrored person');
  const flip = await js(`(()=>{const P=[...document.querySelectorAll('#stage .ro-person.mir')],C=[...document.querySelectorAll('#stage .ro-cab.mir')];return {people:P.map(e=>getComputedStyle(e).scale),cabs:C.map(e=>getComputedStyle(e).scale)};})()`);
  assert.ok(flip.people.length && flip.people.every((v) => v === '-1 1'), 'people mirrored on scale: ' + JSON.stringify(flip.people));
  assert.ok(flip.cabs.length && flip.cabs.every((v) => v === '-1 1'), 'cabinets mirrored on scale: ' + JSON.stringify(flip.cabs));
  const gone = await js(`(()=>{const L=window.__durbarSimUi.agents();const ids=L.filter(a=>!a.parent).slice(-12).map(a=>a.id);/* 15 to 3: another scale, so sizes ease too */for(const g of ids)window.__durbarSimUi.removeAgent(g);return new Promise((done)=>{let n=0,wrong=[];const t0=performance.now();const look=()=>{for(const e of document.querySelectorAll('#stage .ro-person.mir,#stage .ro-cab.mir')){n++;const v=getComputedStyle(e).scale.split(' ')[0];if(!(parseFloat(v)<0))wrong.push(v);}if(performance.now()-t0<800)requestAnimationFrame(look);else done({n,wrong:wrong.slice(0,4)});};requestAnimationFrame(look);});})()`);
  assert.ok(gone.n > 0, 'looked while it eased');
  assert.deepStrictEqual(gone.wrong, [], 'still mirrored while it eases');

  console.log('[102-arcade] PASS');
};
