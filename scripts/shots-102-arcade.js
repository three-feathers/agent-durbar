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
 *   - a marquee, glow or cue is not FR-260's table for its state; an error's glow leaves its slot; a status update adds a node (FR-261);
 *   - flashes are not on one beat or not 1 change each 1.1 s, a person's bob is off its 4 phases or on someone not working, anything moves but transform and opacity (FR-261);
 *   - a move is not a dissolve of static masks, shows two bodies, or the coin plays more than once (FR-260, FR-262);
 *   - under reduced motion, Motion off, forced colours or a hidden window anything runs, or a flash is not steady and different from lit (FR-260, FR-074).
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
    const groups=[['.ro-plate','.ro-plate'],['.ro-sign','.ro-sign'],['.ro-plate','.ro-sign'],['.ro-marquee','.ro-marquee'],['.ro-marquee','.ro-sign'],['.ro-marquee','.ro-plate'],['.ro-cue:not(.cue-none)','.ro-plate'],['.ro-cue:not(.cue-none)','.ro-marquee'],['.ro-cue:not(.cue-none)','.ro-cue:not(.cue-none)'],['.ro-cue:not(.cue-none)','.ro-sign'],['.ro-bub','.ro-sign'],['.ro-bub','.ro-plate'],['.ro-bub','.ro-marquee'],['.ro-bang','.ro-sign'],['.ro-bang','.ro-plate'],['.ro-dots','.ro-sign'],['.ro-chip','.ro-lplate'],['.ro-chip','.ro-chip'],['.ro-lplate','.ro-lplate'],['.ro-away','.ro-marquee'],['.ro-away','.ro-plate'],['.ro-away','.ro-stext'],['.ro-away','.ro-sign'],['.ro-visitor','.ro-sign'],['.ro-cab','.ro-cab'],['.ro-cab','.ro-fx'],['.ro-person','.ro-sign'],['.ro-stext','.ro-sign'],['.ro-stext','.ro-plate']];
    const out=[];for(const [p,q] of groups){const P=seen(p),Q=seen(q);for(const a of P)for(const b of Q)if(a!==b&&!(p===q&&P.indexOf(a)>P.indexOf(b))&&hit(R(a),R(b)))out.push(name(a)+' on '+name(b));}return out;})()`;
  const LUM = `const lum=(c)=>{const m=c.match(/[\\d.]+/g).map(Number),f=(v)=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};return 0.2126*f(m[0])+0.7152*f(m[1])+0.0722*f(m[2]);};const bgOf=(e)=>{for(let x=e;x;x=x.parentElement){const c=getComputedStyle(x).backgroundColor,m=c.match(/[\\d.]+/g).map(Number);if(m.length<4||m[3]>0.5)return c;}return 'rgb(255,255,255)';};const ratio=(a,b)=>{const l=[lum(a),lum(b)].sort((x,y)=>y-x);return (l[0]+0.05)/(l[1]+0.05);};`;
  const TEXT = '(()=>{' + LUM + `const small=[],low=[];for(const e of document.querySelectorAll('#stage .ro-plate .ro-l2,#stage .ro-marquee,#stage .ro-sign b,#stage .ro-stext .ro-sl,#stage .ro-away')){if(!e.getClientRects().length||!e.textContent.trim())continue;const c=getComputedStyle(e),px=parseFloat(c.fontSize);if(px<(e.classList.contains('ro-marquee')?12:10.5))small.push(e.className+' '+px);const r=ratio(c.color,bgOf(e));if(r<4.5)low.push(e.className+' '+r.toFixed(2)+' '+c.color);}return {small,low};})()`;

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
    /* spec 102 FR-255 (owner 2026-11-04, #1104): the lobby too: every fixture and visitor at a whole scale, on a whole device pixel */
    const lobby = await js(`(()=>{const d=devicePixelRatio,off=[];let n=0;
      for(const i of document.querySelectorAll('#stage img.ro-fx,#stage img.ro-visitor')){if(i.hidden||!i.getClientRects().length||!i.naturalWidth)continue;n++;const b=i.getBoundingClientRect(),s=b.width*d/i.naturalWidth,s2=b.height*d/i.naturalHeight,x=b.left*d;
        if(Math.abs(s-Math.round(s))>0.01||Math.abs(s2-Math.round(s2))>0.01||Math.round(s)<1)off.push((i.dataset.place||i.className)+' x'+s.toFixed(3));if(Math.abs(x-Math.round(x))>0.01)off.push((i.dataset.place||i.className)+' left '+x.toFixed(2));}
      return {n,d,off};})()`);
    console.log('[102-arcade]', tag, 'lobby', JSON.stringify({ n: lobby.n, dpr: lobby.d }));
    assert.ok(lobby.n > 0, tag + ': the lobby has pictures');
    assert.deepStrictEqual(lobby.off, [], tag + ': the lobby on whole pixel scales (FR-255, #1104)');
    assert.strictEqual(art.px, 'pixelated', tag + ': nearest pixel, people'); assert.strictEqual(art.cab, 'pixelated', tag + ': nearest pixel, cabinets');
    assert.strictEqual(art.scan, 0, tag + ': nothing skewed'); assert.strictEqual(art.mirrorText, 0, tag + ': no text in a mirrored element');
    if (n <= 15) { assert.strictEqual(art.scroll, false, tag + ': no office scroll'); assert.ok(art.fh <= 1, tag + ': the floor does not scroll: ' + art.fh); }
    await H.until(`${OVER}.length===0`, 5000); /* a font face can arrive after the first drawing */
    assert.deepStrictEqual(await js(OVER), [], tag + ': no overlap');
    /* owner, 2026-11-03: no person is cut by a cabinet or a screen: none of a person's painted pixels lies on one; a sign stays on the floor */
    assert.deepStrictEqual(await js(`(async()=>{const out=[],ro=document.querySelector('#stage .ro').getBoundingClientRect(),B=[...document.querySelectorAll('#stage .ro-cab,#stage .ro-screen')].map(e=>e.getBoundingClientRect());
      for(const p of document.querySelectorAll('#stage .ro-person')){if(p.hidden||!p.getClientRects().length)continue;await p.decode().catch(()=>{});const b=p.getBoundingClientRect(),c=document.createElement('canvas');c.width=Math.round(b.width);c.height=Math.round(b.height);const x=c.getContext('2d');x.imageSmoothingEnabled=false;x.drawImage(p,0,0,c.width,c.height);const d=x.getImageData(0,0,c.width,c.height).data,mir=getComputedStyle(p).scale.startsWith('-');let n=0;
        for(const r of B){const L=Math.max(r.left,b.left),R=Math.min(r.right,b.right),T=Math.max(r.top,b.top),Bt=Math.min(r.bottom,b.bottom);for(let yy=Math.floor(T);yy<Bt;yy++)for(let xx=Math.floor(L);xx<R;xx++){const u=Math.floor(xx-b.left),ux=mir?c.width-1-u:u,v=Math.floor(yy-b.top);if(ux>=0&&ux<c.width&&v>=0&&v<c.height&&d[4*(v*c.width+ux)+3]>32)n++;}}
        if(n)out.push(p.dataset.for+': '+n+' px on a cabinet or screen');}
      for(const s of document.querySelectorAll('#stage .ro-sign')){const b=s.getBoundingClientRect();if(b.left<ro.left-0.5||b.right>ro.right+0.5)out.push('a sign leaves the floor: '+s.textContent.slice(0,14));}
      return out;})()`), [], tag + ': every person whole beside the cabinet, signs on the floor');
    /* owner, 2026-11-03: in the lobby nobody stands half behind another (painted pixels), every name chip reads in full, no two chips touch;
       */
    assert.deepStrictEqual(await js(`(async()=>{const out=[],boxes=[];
      for(const v of document.querySelectorAll('#stage .ro-visitor')){if(v.hidden||!v.getClientRects().length||v.tagName!=='IMG')continue;await v.decode().catch(()=>{});const b=v.getBoundingClientRect(),c=document.createElement('canvas');c.width=Math.max(1,Math.round(b.width));c.height=Math.max(1,Math.round(b.height));const x=c.getContext('2d');x.imageSmoothingEnabled=false;x.drawImage(v,0,0,c.width,c.height);const d=x.getImageData(0,0,c.width,c.height).data;let L=1e9,R=-1;for(let yy=0;yy<c.height;yy++)for(let xx=0;xx<c.width;xx++)if(d[4*(yy*c.width+xx)+3]>32){if(xx<L)L=xx;if(xx>R)R=xx;}if(R<0)continue;const mir=getComputedStyle(v).scale.startsWith('-');const l=mir?b.left+(c.width-1-R):b.left+L,r=mir?b.left+(c.width-1-L):b.left+R;boxes.push({l,r,t:b.top,bt:b.bottom,who:v.dataset.for||''});}
      for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];if(a.l<b.r-1&&b.l<a.r-1&&a.t<b.bt&&b.t<a.bt)out.push('visitors overlap: '+a.who+' and '+b.who);}
      const ch=[...document.querySelectorAll('#stage .ro-chip')].filter(c=>c.getClientRects().length);
      for(const c of ch)if(c.dataset.full)out.push('a cut name chip: '+c.dataset.full);
      for(let i=0;i<ch.length;i++)for(let j=i+1;j<ch.length;j++){const a=ch[i].getBoundingClientRect(),b=ch[j].getBoundingClientRect();if(a.left<b.right-0.5&&b.left<a.right-0.5&&a.top<b.bottom-0.5&&b.top<a.bottom-0.5)out.push('chips overlap: '+ch[i].textContent+' / '+ch[j].textContent);}
      return out;})()`), [], tag + ': the lobby: everyone whole, every name in full');
    /* owner, 2026-11-03: no light block: a waiting or limit plate and an away ticket are dark; up to four people stand in the middle */
    assert.deepStrictEqual(await js('(()=>{' + LUM + `const out=[];for(const e of document.querySelectorAll('#stage .ro-plate.st-waiting,#stage .ro-plate.st-limit,#stage .ro-away')){if(!e.getClientRects().length)continue;const bg=getComputedStyle(e).backgroundColor;if(lum(bg)>=0.05)out.push(e.className+' '+bg);}
      const ds=window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks),W=window.__durbarSimUi.realLayout().width;if(ds.length<=4){const sl=ds.map(d=>d.slot).sort((a,b)=>a.x-b.x),l=sl[0].x,r=sl[sl.length-1].x+sl[sl.length-1].w;if(Math.abs((l+r)/2-W/2)>W*0.05)out.push('a small group is not in the middle: '+Math.round(l)+'..'+Math.round(r)+' of '+W);}return out;})()`), [], tag + ': dark plates and tickets; a small group in the middle');
    /* owner, 2026-11-03 ("make arcade look different"): the painted cabinets show different bodies, all different up to 4, at least 3 from 8 on */
    /* the painted cabinets show different bodies: their silhouettes, read from the pixels of the cell each one paints (pre-review of #1079: the
       body number alone would pass with sixteen uprights drawn); all different up to 4, at least 3 from 8 on */
    { const SIL = `(async()=>{const cs=[...document.querySelectorAll('#stage .ro-cab')].filter(e=>e.getClientRects().length&&getComputedStyle(e).backgroundImage.includes('monitor'));if(!cs.length)return null;
        const st=getComputedStyle(cs[0]),url=st.backgroundImage.slice(5,-2),n=Math.round(parseFloat(st.backgroundSize)/100),im=new Image();im.src=url;await im.decode();
        const cw=im.naturalWidth/n,c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;const x=c.getContext('2d');x.drawImage(im,0,0);
        return cs.map(e=>{const p=parseFloat(getComputedStyle(e).backgroundPositionX),cell=Math.round(p/100*(n-1)),d=x.getImageData(Math.round(cell*cw),0,Math.round(cw),im.naturalHeight).data;let h=0;for(let i=3;i<d.length;i+=4)h=(h*33+(d[i]>0?1:2))>>>0;return h;});})()`;
      await H.until(`[...document.querySelectorAll('#stage .ro-cab')].some(e=>e.getClientRects().length&&getComputedStyle(e).backgroundImage.includes('monitor'))`, 5000);
      const bs = await js(SIL); assert.ok(bs && bs.length > 0 && new Set(bs).size >= Math.min(bs.length, bs.length >= 8 ? 3 : 4), tag + ': cabinet silhouettes ' + JSON.stringify(bs)); }
    /* owner, 2026-11-03 ("zigzag positioning for max usage"): from 2 people on, no band of bare floor over a quarter of its height */
    assert.ok(await js(`(()=>{const L=window.__durbarSimUi.realLayout();if(L.zones.flatMap(z=>z.desks).length<2)return true;const ys=L.zones.map(z=>[z.sign.y,z.box.y+z.box.h]).sort((a,b)=>a[0]-b[0]);let at=L.lobbyH+(L.lane?L.lane.h:0),w=0;for(const [a,b] of ys){w=Math.max(w,a-at);at=Math.max(at,b);}w=Math.max(w,L.height-at);return w<=(L.height-L.lobbyH)/4;})()`), tag + ': no band of bare floor over a quarter of it');
    /* review of 2026-11-03: no slip, pill or bubble on a screen, and none hidden; a folder name keeps 8 characters (or all of it) */
    const SLIPS = `(()=>{const out=[],R=e=>e.getBoundingClientRect(),hit=(a,b)=>a.left<b.right-0.5&&b.left<a.right-0.5&&a.top<b.bottom-0.5&&b.top<a.bottom-0.5,S=[...document.querySelectorAll('#stage .ro-screen,#stage .ro-person')].filter(e=>!e.hidden&&e.getClientRects().length).map(R);
      for(const e of document.querySelectorAll('#stage .ro-slip')){if(e.hidden){out.push('hidden: '+e.className);continue;}if(S.some(q=>hit(R(e),q)))out.push('on a screen or a person: '+e.textContent.slice(0,24));}
      const c=document.createElement('canvas').getContext('2d');
      for(const b of document.querySelectorAll('#stage .ro-sign>b')){if(b.scrollWidth<=b.clientWidth+0.5)continue;c.font=getComputedStyle(b).font;const t=b.textContent,need=c.measureText(t.slice(0,Math.min(8,t.length))+'\u2026').width;if(b.clientWidth+0.5<need)out.push('a folder name cut to '+Math.round(b.clientWidth)+' px: '+t);}
      return out;})()`;
    await H.until(`${SLIPS}.length===0`, 4000); /* a slip is placed again once its font has loaded */
    assert.deepStrictEqual(await js(SLIPS), [], tag + ': nothing on a screen or a person, every slip shown, folder names readable');
    /* the pills sit in the lane the layout keeps under the lobby */
    const LANE = `(()=>{const L=window.__durbarSimUi.realLayout().lane,ro=document.querySelector('#stage .ro').getBoundingClientRect();return [...document.querySelectorAll('#stage .ro-slip[data-variant="pill"]')].filter(e=>!e.hidden).filter(e=>{const b=e.getBoundingClientRect(),t=b.top-ro.top;return !L||t<L.y-0.5||t+b.height>L.y+L.h+0.5;}).map(e=>e.textContent.slice(0,24));})()`;
    await H.until(`${LANE}.length===0`, 4000);
    assert.deepStrictEqual(await js(LANE), [], tag + ': the pills in their lane');
    /* FR-263: the top bar's text keeps 4.5:1 on its own button fill in the arcade's style (the pressed one is yellow) */
    assert.deepStrictEqual(await js('(()=>{' + LUM + `const out=[];for(const b of document.querySelectorAll('.topbar .seg button')){const c=getComputedStyle(b).color,f=getComputedStyle(b).backgroundColor;if(/rgba\\([^)]*, 0\\)|transparent/.test(f))continue;const r=(Math.max(lum(c),lum(f))+0.05)/(Math.min(lum(c),lum(f))+0.05);if(r<4.5)out.push(b.textContent.trim()+' '+r.toFixed(2));}return out;})()`), [], tag + ': top bar buttons readable');
    assert.deepStrictEqual(await js(TEXT), { small: [], low: [] }, tag + ': text size and contrast');
    const seats = await js(`(()=>{const L=window.__durbarSimUi.realLayout(),T=window.exports.aisleTabOrder(L),P=[...document.querySelectorAll('#stage .ro-plate')].map(p=>p.dataset.id);return {tab:T,dom:P};})()`);
    assert.deepStrictEqual(seats.dom, seats.tab, tag + ': Tab follows the seats');
    await H.shot(path.join(OUT, `102-arcade-${n}-${w}x${h}.png`), { prep: 'calm' });
  }

  // ---- FR-259: the frame by state; FR-257: hostile text stays text ----
  await loadArcade(1440, 900, 15);
  const pose = await js(`(()=>{const T={working:'type',thinking:'book',error:'knock',waiting:'face-knock',limit:'face-knock',done:'face-coffee',idle:'face-book',asleep:'sit'}/* FR-259's table, written out: not read from the code it checks */,L=window.__durbarSimUi.realLayout(),bad=[];let n=0;for(const d of L.zones.flatMap(z=>z.desks)){if(!d.person)continue;n++;const want=T[d.state],got=d.person.pose;if(got!==want&&got!=={'face-knock':'knock','face-coffee':'counter','face-book':'book'}[want])bad.push(d.id+' '+d.state+' '+got);const e=document.querySelector('#stage .ro-person[data-for="'+CSS.escape(d.id)+'"]');if(!e||e.dataset.pose!==got)bad.push(d.id+' not drawn');}return {n,bad};})()`);
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

  // ---- T213..T215: the status and its motion (FR-260..FR-262); this machine's own setting must not decide them ----
  const media = (features) => { const d = ctx.win.webContents.debugger; if (!d.isAttached()) d.attach('1.3'); return d.sendCommand('Emulation.setEmulatedMedia', { features }); };
  const MOTION = (v) => [{ name: 'prefers-reduced-motion', value: v }];
  const STATES = ['working', 'thinking', 'waiting', 'limit', 'error', 'done', 'idle', 'asleep'];
  const setStates = (list) => js(`(()=>{const U=window.__durbarSimUi,S=JSON.parse(${jsLiteral(JSON.stringify(list))});U.agents().filter(a=>!a.parent).forEach((a,i)=>{a.state=S[i%S.length];delete a.label;});U.render();})();0`); /* the state's own word, no label left over from the simulator */
  const ROOM = `document.getAnimations().filter(a=>a.playState==='running'&&a.effect&&a.effect.target&&a.effect.target.closest&&a.effect.target.closest('#stage .ro'))`;
  const running = () => js(`${ROOM}.map(a=>(a.animationName||'waapi')+':'+a.effect.target.className)`);
  const DRAWN = `(()=>{const by=(s,id)=>document.querySelector('#stage '+s+'[data-for="'+CSS.escape(id)+'"]');return window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks).filter(d=>d.marquee).map(d=>{const m=by('.ro-marquee',d.id),f=by('.ro-fglow',d.id),c=by('.ro-cue',d.id),r=f.getBoundingClientRect(),ro=document.querySelector('#stage .ro').getBoundingClientRect();return {id:d.id,state:d.state,mq:[...m.classList].find(x=>x.startsWith('mq-')),glow:[...f.classList].find(x=>x.startsWith('g-')),cue:c?c.textContent:'',word:(document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(d.id)+'"] .ro-l2')||{}).textContent||'',out:m.classList.contains('mq-alert')||m.classList.contains('mq-alert-red')?getComputedStyle(m).outlineStyle:'none',inSlot:r.left-ro.left>=d.slot.x-0.5&&r.right-ro.left<=d.slot.x+d.slot.w+0.5&&r.top-ro.top>=d.slot.y-0.5&&r.bottom-ro.top<=d.slot.y+d.slot.h+0.5};});})()`;
  /* FR-260's table, written out: not read from the code it checks */
  const TABLE = { working: ['mq-lit', 'g-faint', ''], thinking: ['mq-lit', 'g-faint', '•••'], waiting: ['mq-flash', 'g-strong', '?'], limit: ['mq-orange', 'g-strong', '?'], error: ['mq-flash-red', 'g-small', '!'], done: ['mq-green', 'g-faint', '✓'], idle: ['mq-dim', 'g-very-faint', ''], asleep: ['mq-off', 'g-none', 'z z'] };
  const STILL = { 'mq-flash': 'mq-alert', 'mq-flash-red': 'mq-alert-red' };
  const moveOf = async (who, n) => { /* a real move: to a place and back, frames sampled */
    await js(`window.__durbarSimUi.emit({type:'toolCall',sessionId:${jsLiteral(who)},callId:'drv-mv${n}',tool:'bash',phase:'start',args:{command:'npm run a-long-one'}});0`);
    return js(`new Promise((done)=>{const t0=performance.now();let dis=0,two=0,poof=0;const props=new Set();const look=()=>{const D=[...document.querySelectorAll('#stage .ro-dis')];dis=Math.max(dis,D.length);for(const e of D)for(const a of e.getAnimations())for(const k of a.effect.getKeyframes())for(const p of Object.keys(k))if(!['offset','computedOffset','easing','composite'].includes(p))props.add(p);const seen=(e)=>parseFloat(getComputedStyle(e).opacity)>0;const ghosts=[...document.querySelectorAll('#stage .ro-ghost')].filter(seen),now=[...document.querySelectorAll('#stage .ro-visitor[data-for="'+CSS.escape(${jsLiteral(who)})+'"]')].filter(seen);if(ghosts.length&&now.length)two++;poof+=document.querySelectorAll('#stage .ro-poof').length;if(performance.now()-t0<900)requestAnimationFrame(look);else done({dis,two,poof,props:[...props],left:document.querySelectorAll('#stage .ro-dis').length});};look();})`);
  };
  const stillChecks = async (tag) => {
    await must(`${ROOM}.filter(a=>!a.animationName).length===0`, tag + ': nothing left of the load');
    await setStates(STATES);
    /* relayed, 2026-11-03: an agent asleep with no label of its own showed "undefined · At Terminal" on its plate */
    await must(`!!document.querySelector('#stage .ro-plate[data-state="asleep"]')`, tag + ': an asleep plate drawn');
    assert.deepStrictEqual(await js(`[...document.querySelectorAll('#stage .ro-plate')].map(p=>p.textContent).filter(t=>/undefined/.test(t))`), [], tag + ': no plate says undefined');
    await must(`${ROOM}.length===0`, tag + ': nothing runs, had ' + JSON.stringify(await running()), 4000);
    for (const d of await js(DRAWN)) {
      const want = TABLE[d.state]; assert.ok(want, tag + ': a state in the table: ' + d.state);
      assert.strictEqual(d.mq, STILL[want[0]] || want[0], tag + ': steady, ' + d.state);
      if (STILL[want[0]]) assert.strictEqual(d.out, 'solid', tag + ': a flash held is different from lit, ' + d.state);
      assert.ok(d.word, tag + ': the words remain, ' + d.state);
    }
    const who = await js(`window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks).find(d=>d.person).id`);
    const m = await moveOf(who, tag);
    assert.strictEqual(m.dis, 0, tag + ': no dissolve');
    assert.deepStrictEqual(await running(), [], tag + ': still nothing runs');
  };

  await media(MOTION('no-preference'));
  /* every state at a cabinet: the lounge (spec 097 FR-246, its own driver check-097-lounge) is switched off for this page, as Settings does, so a done agent keeps its cabinet */
  await js(`localStorage.setItem('durbar.shutters','off');1`);
  await loadArcade(1440, 900, 15, { romotion: '1', simfreeze: '1' });
  await js(`localStorage.removeItem('durbar.shutters');1`);
  await setStates(STATES);
  await must(`[...document.querySelectorAll('#stage .ro-marquee.mq-flash,#stage .ro-marquee.mq-flash-red')].length>=2`, 'flashes');
  await must(`${ROOM}.filter(a=>!a.animationName).length===0`, 'a sort over');
  const drawn = await js(DRAWN);
  const seenStates = new Set(drawn.map((d) => d.state));
  for (const s of ['working', 'thinking', 'waiting', 'error', 'done', 'idle']) assert.ok(seenStates.has(s), 'drawn: ' + s + ' of ' + [...seenStates]);
  for (const d of drawn) {
    const w = TABLE[d.state]; assert.ok(w, 'a state in the table: ' + d.state);
    assert.deepStrictEqual([d.mq, d.glow, d.cue], w, 'FR-260: ' + d.state);
    assert.ok(d.inSlot, 'FR-260, 097 FR-042: the glow inside its slot, ' + d.state);
    assert.ok(d.word, 'the words remain, ' + d.state);
  }
  await must(`(()=>{const ro=document.querySelector('#stage .ro').getBoundingClientRect();return window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks).every(k=>{const m=document.querySelector('#stage .ro-desk[data-for="'+CSS.escape(k.id)+'"]').getBoundingClientRect();return Math.abs(m.left-ro.left-k.desk.x)<1&&Math.abs(m.top-ro.top-k.desk.y)<1;});})()`, 'every cabinet at its place');
  await H.shot(path.join(OUT, '102-arcade-status-1440x900.png'), { prep: 'calm' });
  await must(`document.querySelector('#stage .ro')._ready===true`, 'the room ready to move (097 FR-228)', 6000);
  await setStates(['working', 'thinking', 'waiting', 'thinking', 'error', 'working']);
  await must(`${ROOM}.some(a=>a.animationName==='ro-arc-bob')`, 'the first people bob'); /* then more start later, and must keep the same 4 phases */
  await setStates(['working', 'working', 'waiting', 'working', 'error', 'working']);
  await must(`${ROOM}.filter(a=>!a.animationName).length===0`, 'a sort over: its slide is on translate and scale, as FR-180 allows, and it ends');
  await must(`${ROOM}.filter(a=>a.animationName==='ro-arc-flash').length>=2`, 'flashes running');
  const beat = await js(`(()=>{const A=${ROOM},N=a=>a.animationName||'waapi',F=A.filter(a=>N(a)==='ro-arc-flash'),B=A.filter(a=>N(a)==='ro-arc-bob'),t=a=>a.effect.getTiming();
    const props=new Set();for(const a of A)for(const k of a.effect.getKeyframes())for(const p of Object.keys(k))if(!['offset','computedOffset','easing','composite'].includes(p))props.add(N(a)+'.'+p);
    return {phase:[...new Set(F.map(a=>a.startTime+'/'+t(a).delay))],ms:[...new Set(F.map(a=>t(a).duration))],frames:[...new Set(F.map(a=>a.effect.getKeyframes().length))],bobs:B.length,bobOff:B.filter(a=>{const f=(a.effect.getComputedTiming().progress*4)%1,g=(B[0].effect.getComputedTiming().progress*4)%1;return Math.min(Math.abs(f-g),1-Math.abs(f-g))>0.02;}).length,bobMs:[...new Set(B.map(a=>t(a).duration))],bobWho:B.filter(a=>{const d=window.__durbarSimUi.agents().find(x=>x.id===a.effect.target.dataset.for);return !d||d.state!=='working';}).length,props:[...props]};})()`);
  console.log('[102-arcade] motion', JSON.stringify({ phase: beat.phase, bobs: beat.bobs, props: beat.props.length }));
  assert.strictEqual(beat.phase.length, 1, 'FR-261: every flash on one beat: ' + beat.phase);
  assert.deepStrictEqual(beat.ms, [2200], 'FR-260: 1 change each 1.1 s');
  assert.ok(beat.bobs >= 3, 'people bob: ' + beat.bobs); assert.strictEqual(beat.bobOff, 0, 'FR-261: 4 phases by seat'); assert.deepStrictEqual(beat.bobMs, [1000], 'FR-261: 2 changes a second');
  assert.strictEqual(beat.bobWho, 0, 'FR-260: only someone working bobs');
  assert.deepStrictEqual(beat.props.filter((p) => !/\.(transform|opacity)$/.test(p)), [], 'FR-261: only transform and opacity move');

  /* a status update adds no node at the cabinet (a sign's count chip for a status its folder did not have is the sign's, in every world), and the coin plays once */
  const who = await js(`window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks).find(d=>d.person).id`);
  const one = async (st) => { /* a draw can come a frame later: count when this state is on the marquee */
    await js(`(()=>{const U=window.__durbarSimUi;U.agents().find(a=>a.id===${jsLiteral(who)}).state=${jsLiteral(st)};U.render();})();0`);
    await must(`document.querySelector('#stage .ro-marquee[data-for="'+CSS.escape(${jsLiteral(who)})+'"]').classList.contains(${jsLiteral(TABLE[st][0])})`, 'drawn: ' + st);
    return js(`[...document.querySelectorAll('#stage .ro-art *:not(.ro-dis,.ro-stext,.ro-stext *),#stage .ro-chrome *:not(.ro-stext,.ro-stext *,.ro-sign *)')].map(e=>String(e.className).split(' ')[0]||e.tagName).sort()`);
  };
  const coins = `${ROOM}.filter(a=>a.effect.target.classList.contains('ro-coin')).map(a=>a.effect.getTiming().duration)`;
  const n0 = await one('working');
  for (const st of ['waiting', 'error', 'thinking', 'idle', 'limit', 'done']) { const n = await one(st), extra = n.slice(); for (const x of n0) { const i = extra.indexOf(x); if (i >= 0) extra.splice(i, 1); } assert.deepStrictEqual(extra, [], 'FR-261: a status update adds no node: ' + st); }
  await must(`${coins}.length===1`, 'the done flourish');
  assert.deepStrictEqual(await js(coins), [2000], 'FR-260: one coin, 2 s');
  await one('done');
  assert.strictEqual((await js(coins)).length, 1, 'FR-260: once, a redraw does not play it again');
  await must(`${coins}.length===0`, 'the coin over', 3000);

  /* T215, FR-262: a move is a dissolve */
  const mv = await moveOf(who, 'd');
  console.log('[102-arcade] dissolve', JSON.stringify(mv));
  assert.ok(mv.dis >= 3 && mv.dis % 3 === 0, 'FR-262: three masks each: ' + mv.dis);
  assert.deepStrictEqual(mv.props, ['opacity'], 'FR-262: only opacity');
  assert.strictEqual(mv.two, 0, 'FR-262: one body at a time'); assert.strictEqual(mv.poof, 0, 'FR-262: no poof here'); const t9 = Date.now(); await must(`!document.querySelector('#stage .ro-dis')`, 'FR-262: nothing left', 3000); console.log('[102-arcade] dissolve cleared after', Date.now() - t9, 'ms more');

  /* FR-074: a hidden window runs nothing */
  ctx.win.hide();
  if (!(await H.until(`document.hidden`, 3000))) await js(`(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));})();0`);
  await must(`document.querySelector('#stage .ro').classList.contains('paused')`, 'the scene paused when hidden');
  assert.deepStrictEqual(await running(), [], 'FR-074: nothing runs while hidden');
  ctx.win.show(); ctx.win.focus();

  /* FR-260: reduced motion turned on while the arcade moves stops its loops at once, before any redraw (styles.css's rule for every element and pseudo-element) */
  await loadArcade(1440, 900, 15, { romotion: '1', simfreeze: '1' });
  await must(`document.querySelector('#stage .ro')._ready===true`, 'the room ready to move (097 FR-228)', 6000);
  await setStates(['working', 'thinking', 'waiting', 'working', 'error', 'working']);
  await must(`${ROOM}.filter(a=>/^ro-arc-/.test(a.animationName)).length>=3`, 'the loops run');
  await media(MOTION('reduce'));
  await must(`${ROOM}.filter(a=>/^ro-arc-/.test(a.animationName)).length===0`, 'reduced motion mid-session: no loop of this world, had ' + JSON.stringify(await running()), 4000);
  await media(MOTION('no-preference'));

  /* FR-260: reduced motion, Motion off, forced colours */
  await media(MOTION('reduce'));
  await loadArcade(1440, 900, 15, { romotion: '1', simfreeze: '1' });
  await stillChecks('reduced motion');
  await media([...MOTION('no-preference'), { name: 'forced-colors', value: 'active' }]);
  await loadArcade(1440, 900, 15, { romotion: '1', simfreeze: '1' });
  assert.deepStrictEqual(await js(`[...new Set(${ROOM}.map(a=>a.animationName||'waapi'))].filter(n=>/^ro-arc/.test(n))`), [], 'forced colours: no loop of this world');
  await media(MOTION('no-preference'));
  await loadArcade(1440, 900, 15, { romotion: '1', simfreeze: '1' });
  await js(`window.DurbarScreens.openSettings();0`);
  await must(`!!document.getElementById('motionSw')`, 'the Motion switch');
  await js(`document.getElementById('motionSw').click();document.getElementById('scrClose').click();0`);
  await must(`document.querySelector('#stage .ro').classList.contains('still')`, 'Motion off');
  await stillChecks('Motion off');
  await js(`window.DurbarScreens.openSettings();0`);
  await must(`!!document.getElementById('motionSw')`, 'the Motion switch');
  await js(`document.getElementById('motionSw').click();document.getElementById('scrClose').click();0`);

  console.log('[102-arcade] PASS');
};
