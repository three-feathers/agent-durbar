/*
 * Spec 102 RA3 (T209..T211): the Retro arcade hall, drawn, behind its closed flag. Simulator only: no AI credits, no account. In ui-suite.js;
 * `node scripts/ui-suite.js --only shots-102-arcade`.
 *
 * It fails (exit 1) when:
 *   - the flag is closed and a stored choice draws the arcade, asks for one of its files or offers it (FR-254);
 *   - the flag is open and the night room's files (wall-night, floor-night) are not fetched, or the day room's (wall, floor, welcome) are, seen in a session request log (T218, SC-023);
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

const run = async (ctx, reqs) => {
  const H = helpers(ctx);
  /* spec 102 T282: a page script that throws a DOMException reached the driver as "[object Object]" (Electron passes no name or message);
     each script is run inside a catch on the page, so a failure names the page's own error, and the driver throws that */
  const js = async (e) => {
    try { new Function(`return (async()=>await (${e}))`); } catch { /* a statement list (`...;0`), not one expression: run as it is */
      try { return await H.js(e); } catch (x) { console.log('[102-arcade] this page script failed:', String(e).slice(0, 300)); throw x; }
    }
    const r = await H.js(`(async()=>{try{return {ok:1,v:await (${e})};}catch(x){return {ok:0,err:String(x&&x.name||'Error')+': '+String(x&&x.message||x)+(x&&x.stack?' | '+String(x.stack).split('\\n').slice(1,3).join(' '):'')};}})()`);
    if (r && r.ok) return r.v;
    console.log('[102-arcade] this page script failed:', String(e).slice(0, 300));
    throw new Error('a page script failed: ' + (r && r.err));
  };
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
  const PICS = `[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`;
  const packs = () => js(`[...new Set([...document.querySelectorAll('script[src],link[href],#stage img[src]')].map(e=>e.getAttribute('src')||e.getAttribute('href')).filter(n=>/realoffice\\/(worlds|sets)\\//.test(n)).map(n=>n.replace(/^.*realoffice\\/(worlds|sets)\\/([^/]+)\\/.*$/,'$1/$2')))].sort().join(' ')`);
  const ARCADE = { worldflags: 'retro', world: 'retro' };
  /* spec 102 T218 (SC-023): a session request log, as in check-097-crews.js: what the page really requests (a file:// page cannot report its own requests).
     The arcade's room is the night pair; the day pair (wall.webp, floor.webp) and welcome.webp must never be fetched. */
  const roomFetched = (name) => [...reqs.values()].filter((e) => new RegExp('/realoffice/worlds/retro/' + name + '\\.webp(\\?|#|$)').test(e.url));
  const loadArcade = async (w, h, n, query = {}) => {
    reqs.clear();
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
    for (let i = 0; i < 50 && !(roomFetched('wall-night').some((e) => e.status === 200) && roomFetched('floor-night').some((e) => e.status === 200)); i++) await ctx.sleep(100);
    await ctx.sleep(400); /* a stray day file would be asked for with the first drawing: give it time to show */
    for (const f of ['wall-night', 'floor-night']) assert.ok(roomFetched(f).some((e) => e.status === 200 && !e.error), tag + ': the night room\'s files are fetched: ' + f + '.webp');
    for (const f of ['wall', 'floor', 'welcome']) assert.deepStrictEqual(roomFetched(f).map((e) => e.url), [], tag + ': the day room\'s files are never fetched: ' + f + '.webp');
    await must(PICS, 'the pictures, after the room is ready'); /* spec 102 T282: a picture still loading is not a failed one; a failed one is complete with no size */
    assert.deepStrictEqual(await js(`[...document.querySelectorAll('#stage .ro img')].filter(i=>i.complete&&!i.naturalWidth).map(i=>i.getAttribute('src'))`), [], tag + ': every picture loads');
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
    /* owner, 2026-11-03: no person is cut by a cabinet or a screen: none of a person's painted pixels lies on one; a sign stays on the floor.
       spec 102 T282: the simulator is still replaying (`settle: false`), so a person's frame can change while this reads it: a picture in flight is not read
       (drawing it threw); the check says BUSY and is read again once every picture has loaded, up to 5 s */
    let whole = ['BUSY'];
    /* spec 102 T304 (issue #1517): a person whose box rounds to 0 px is read again like a picture in flight, and named if it stays so.
       ARCADE_MUTANT (test only): `zero` makes every person 0 px wide for 1.5 s (must pass), `zero-stuck` for good (must fail naming the person) */
    const MUT = process.env.ARCADE_MUTANT;
    if (MUT === 'zero' || MUT === 'zero-stuck') await js('(()=>{const st=document.createElement("style");st.textContent="#stage .ro-person{width:0!important}";document.head.appendChild(st);setTimeout(()=>st.remove(),' + (MUT === 'zero' ? 1500 : 1e9) + ');return 0;})()');
    for (let i = 0; i < 25 && whole[0] === 'BUSY'; i++) { if (i) await ctx.sleep(200); await must(PICS, 'the pictures, before their pixels are read'); whole = await js(`(async()=>{let busy=0;const zero=[],out=[],ro=document.querySelector('#stage .ro').getBoundingClientRect(),B=[...document.querySelectorAll('#stage .ro-cab,#stage .ro-screen')].map(e=>e.getBoundingClientRect());
      for(const p of document.querySelectorAll('#stage .ro-person')){if(p.hidden||!p.getClientRects().length)continue;await p.decode().catch(()=>{});if(!p.complete||!p.naturalWidth){busy=1;continue;}const b=p.getBoundingClientRect();if(Math.round(b.width)<1||Math.round(b.height)<1){busy=1;zero.push('zero box: '+p.dataset.for+' '+b.width.toFixed(2)+'x'+b.height.toFixed(2)+' style '+p.style.cssText);continue;}const c=document.createElement('canvas');c.width=Math.round(b.width);c.height=Math.round(b.height);const x=c.getContext('2d');x.imageSmoothingEnabled=false;x.drawImage(p,0,0,c.width,c.height);const d=x.getImageData(0,0,c.width,c.height).data,mir=getComputedStyle(p).scale.startsWith('-');let n=0;
        for(const r of B){const L=Math.max(r.left,b.left),R=Math.min(r.right,b.right),T=Math.max(r.top,b.top),Bt=Math.min(r.bottom,b.bottom);for(let yy=Math.floor(T);yy<Bt;yy++)for(let xx=Math.floor(L);xx<R;xx++){const u=Math.floor(xx-b.left),ux=mir?c.width-1-u:u,v=Math.floor(yy-b.top);if(ux>=0&&ux<c.width&&v>=0&&v<c.height&&d[4*(v*c.width+ux)+3]>32)n++;}}
        if(n)out.push(p.dataset.for+': '+n+' px on a cabinet or screen');}
      for(const s of document.querySelectorAll('#stage .ro-sign')){const b=s.getBoundingClientRect();if(b.left<ro.left-0.5||b.right>ro.right+0.5)out.push('a sign leaves the floor: '+s.textContent.slice(0,14));}
      return busy?['BUSY',...zero]:out;})()`); }
    assert.deepStrictEqual(whole, [], tag + ': every person whole beside the cabinet, signs on the floor');
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

  /* spec 102 FR-311 (issue 1558, 2026-11-11): on a plate with helpers and no strip (097 FR-308: "+N and dots" before the status, one line) the +N is whole, the status
     word is whole (the text up to " · "; the task after it may be cut) and inside the plate's content box (not under the rename pencil), and the dots drop out whole,
     the last first, with a waiting or error helper's dot never gone while an other one shows (the dots are in the heads' order). Read from the page's own boxes:
     Ranges of the +N and of the word; a dot is shown when it lies whole inside the mark's box and the line's, and partly in is a fail. */
  const PLATES = () => `(()=>{const out=[],seen=[];const R=(n,a,b)=>{const r=document.createRange();r.setStart(n,a);r.setEnd(n,b);return r.getBoundingClientRect();};
    for(const p of document.querySelectorAll('#stage .ro-plate')){const l2=p.querySelector('.ro-l2');if(!l2||!l2.getClientRects().length)continue;const helped=p.classList.contains('has-help'),id=p.dataset.id||'?',cs=getComputedStyle(p),pr=p.getBoundingClientRect();
      const word=l2.textContent.trim().split(' · ')[0],w=document.createTreeWalker(l2,NodeFilter.SHOW_TEXT);let n,at=null;while((n=w.nextNode())){const i=n.data.indexOf(word);if(i>=0){at=[n,i];break;}}
      if(!at){out.push(id+': no text for "'+word+'"');continue;}const a=R(at[0],at[1],at[1]+word.length),b=l2.getBoundingClientRect(),right=Math.min(b.right,pr.right-parseFloat(cs.borderRightWidth)-parseFloat(cs.paddingRight));
      const rec={pc:p.className.replace(/ro-plate |has-help|has-ren/g,'').trim(),t:l2.textContent.slice(0,40),id,word,helped,narrow:p.classList.contains('cab-narrow'),ren:p.classList.contains('has-ren'),plateW:Math.round(pr.width),shown:0,helpers:0,urgentShown:-1};seen.push(rec);
      const wdE=p.querySelector('.ro-wd'),boxR=helped&&wdE?Math.min(wdE.getBoundingClientRect().right,right):right;rec.l2c=[l2.scrollWidth,l2.clientWidth];rec.label=p.getAttribute('aria-label')||'';rec.title=p.getAttribute('title')||'';
      const lc=getComputedStyle(l2),cx=document.createElement('canvas').getContext('2d');cx.font=lc.fontStyle+' '+lc.fontWeight+' '+lc.fontSize+' '+lc.fontFamily;const ellW=!helped&&l2.scrollWidth>l2.clientWidth+0.5?cx.measureText('\u2026').width:0;rec.ell=+ellW.toFixed(2);rec.spare=+(boxR-a.right-ellW).toFixed(3);rec.room=+(right-a.right-ellW).toFixed(3); /* no helpers: the word's right end to the content box, less the ellipsis; with helpers (below): the room between the +N and the content box, less the word */ /* a line that runs on past the word ends in an ellipsis, which takes the room of the word's last letters: the word is whole only when it and the ellipsis fit */
      if(a.right+ellW>boxR+0.02)out.push(id+' "'+word+'" ends at '+Math.round(a.right)+' of a content box to '+Math.round(right)+' (helped '+helped+'; line '+Math.round(b.left)+'..'+Math.round(b.right)+', mark '+(p.querySelector('.ro-l1').getBoundingClientRect().width|0)+' px, plate '+Math.round(pr.left)+'..'+Math.round(pr.right)+', word box '+(((p.querySelector('.ro-wd')||l2).getBoundingClientRect().width)|0)+' px)');
      const h=p.querySelector('.ro-help');if(!helped||!h)continue;const l1=p.querySelector('.ro-l1').getBoundingClientRect(),hr=h.getBoundingClientRect(),hc=h.querySelector('.ro-hc'),hn=hc.firstChild,c=R(hn,0,hn.data.trim().length);
      if(c.left<l1.left-0.5||c.right>l1.right+0.5||c.right>hr.right+0.5)out.push(id+' the +N is cut: ends at '+Math.round(c.right)+' of a box to '+Math.round(Math.min(l1.right,hr.right)));
      rec.room=+(right-hc.getBoundingClientRect().right-a.width).toFixed(3);const dots=[...h.querySelectorAll('.dot')],sh=dots.map((d)=>{const r=d.getBoundingClientRect(),inn=r.left>=Math.max(l1.left,hr.left)-0.5&&r.right<=Math.min(l1.right,hr.right)+0.5&&r.top>=hr.top-0.5&&r.bottom<=hr.bottom+0.5,hit=r.left<Math.min(l1.right,hr.right)-0.5&&r.right>Math.max(l1.left,hr.left)+0.5&&r.top<hr.bottom-0.5&&r.bottom>hr.top+0.5;return inn?1:hit?2:0;});
      if(sh.includes(2))out.push(id+' a dot of the helpers is cut in part: '+sh.join(''));const urg=dots.map((d)=>/\\b(error|waiting)\\b/.test(d.className));
      if(urg.some((u,i)=>u&&!sh[i])&&dots.some((d,i)=>!urg[i]&&sh[i]===1))out.push(id+' a waiting or error helper is gone while an other one shows: '+dots.map((d,i)=>(urg[i]?'U':'o')+sh[i]).join(' '));
      const hm=h.querySelector('.ro-hm'),hmr=hm&&hm.getClientRects().length?hm.getBoundingClientRect():null,own=p.querySelector('.ro-l2>.dot'),ownr=own&&own.getClientRects().length?own.getBoundingClientRect():null,d0=dots[0]?dots[0].getBoundingClientRect():null;
      rec.hm=hm?{shown:!!hmr,inside:!!hmr&&hmr.left>=l1.left-0.5&&hmr.right<=Math.min(l1.right,hr.right)+0.5,txt:hc.textContent.trim()}:null;rec.urgN=urg.filter(Boolean).length;rec.order=urg.map((u)=>u?'U':'o').join('');rec.ownDot=!!ownr;
      rec.m={word:+a.width.toFixed(1),plus:+c.width.toFixed(1),mark:hmr?+hmr.width.toFixed(1):0,dot:d0?+d0.width.toFixed(1):0,ownDot:ownr?+ownr.width.toFixed(1):0,content:+(right-(pr.left+parseFloat(cs.borderLeftWidth)+parseFloat(cs.paddingLeft))).toFixed(1),lineW:+b.width.toFixed(1),markBox:+l1.width.toFixed(1)};
      rec.shown=sh.filter((v)=>v===1).length;rec.helpers=dots.length;rec.cls=dots.map((d)=>d.className.replace('dot ','')).join();rec.urgentShown=urg.some((u,i)=>u&&sh[i]===1)?1:urg.some(Boolean)?0:-1;}
    return {out,seen};})()`;
  const MUT = process.env.ARCADE_MUTANT || '';
  const NARROW_ROOM = 3; /* spec 102 FR-312: the written margin, in px, between the status word's right end and the narrow plate's content box (measured on macOS/Electron in the spec delta); a font 3 px wider than this one still shows the word whole */
  /* ARCADE_MUTANT (test only), each must fail at its own label: cutword = the line as it was (the helpers' mark a fixed width, the line free to shrink below its word); cutplate = a plate narrower than its line
     (the word runs under the pencil); nodots = the mark's line has no room but the +N (no dot shown); sliver = the dots do not wrap, so one is cut in part; clipstate = the dots in creation order (an error dot last) */
  const MUTS = {
    cutword: `.ro[data-world="retro"] .ro-plate.has-help:not(.lounge) .ro-l1{flex:none!important;min-width:0!important}.ro[data-world="retro"] .ro-plate.has-help:not(.lounge) .ro-l2{display:block!important;flex:1 1 auto!important;min-width:0!important}.ro[data-world="retro"] .ro-plate.has-help:not(.lounge) .ro-help{flex:none!important;flex-wrap:nowrap!important;height:auto!important}`,
    cutplate: `.ro[data-world="retro"] .ro-plate.has-help:not(.lounge){width:90px!important}`,
    nodots: `.ro[data-world="retro"] .ro-plate.has-help:not(.lounge) .ro-l1{flex-basis:0!important}`,
    narrowdot: `.ro[data-world="retro"] .ro-plate.cab-narrow.has-ren.has-help:not(.lounge) .ro-l2>.dot{display:inline-block!important}`,
    nomark: `.ro[data-world="retro"] .ro-plate.cab-narrow.has-ren.has-help:not(.lounge) .ro-hm{display:none!important}`,
    nohelpdot: `.ro[data-world="retro"] .ro-plate.cab-narrow.has-ren:not(.has-help,.lounge) .ro-l2>.dot{display:inline-block!important}`,
    nopenmark: `.ro[data-world="retro"] .ro-plate.cab-narrow:not(.has-ren) .ro-hm{display:none!important}`,
    nopendot: `.ro[data-world="retro"] .ro-plate.cab-narrow.has-help:not(.has-ren) .ro-l2>.dot{display:inline-block!important;width:1px!important;height:1px!important;margin:0!important}`,
    sliver: `.ro[data-world="retro"] .ro-plate.has-help:not(.lounge) .ro-help{flex-wrap:nowrap!important}.ro[data-world="retro"] .ro-plate.has-help:not(.lounge) .ro-l1{min-width:0!important}`,
  };
  const markCheck = async (tag, scene, { want, states, urgent, nohelp, nopencil } = {}) => { /* urgent (the narrow plates): true = a helper failed (a mark "+N!" is due), false = none did (no mark) */
    if (states) await js(`(()=>{const U=window.__durbarSimUi;U.agents().filter(a=>!a.parent).forEach((a)=>{a.state=${jsLiteral(states)};delete a.label;});U.render();})();0`);
    if (states) await must(`(()=>{const P=[...document.querySelectorAll('#stage .ro-plate[data-id]:not(.lounge)')];return P.length>0&&P.every(p=>p.classList.contains('st-' + ${jsLiteral(states)}));})()`, 'every plate drawn ' + states, 8000);
    if (MUTS[MUT] && !(MUT === 'nohelpdot' && !nohelp)) await js(`(()=>{const s=document.createElement('style');s.textContent=${jsLiteral(MUTS[MUT])};document.head.appendChild(s);})();0`);
    if (MUT === 'clipstate' || (MUT === 'narrowclip' && urgent !== undefined)) await js(`(()=>{for(const h of document.querySelectorAll('#stage .ro-help')){const e=[...h.querySelectorAll('.dot.error,.dot.waiting')];for(const d of e)h.appendChild(d);}})();0`);
    if (MUT === 'markalways' && urgent !== undefined) await js(`(()=>{for(const c of document.querySelectorAll('#stage .ro-help .ro-hc')){if(!c.querySelector('.ro-hm')){const m=document.createElement('span');m.className='ro-hm';m.textContent='!';c.appendChild(m);}}})();0`);
    /* ARCADE_MUTANT wordpx: the word wider than its box by 0.05 px, found by a bisection of the letter spacing on the page (a sub-pixel cut an integer scrollWidth would round away); thin: the word leaves only 2 px of room (whole, but under the written 3 px); namescope: the narrow plate's extra name words on every plate (the scope removed) */
    if (MUT === 'wordpx' && urgent !== undefined) await js(`(()=>{for(const p of document.querySelectorAll('#stage .ro-plate.cab-narrow.has-help')){const w=p.querySelector('.ro-wd'),t=w.firstChild,r=document.createRange();r.selectNodeContents(t);const cs=getComputedStyle(p),right=p.getBoundingClientRect().right-parseFloat(cs.borderRightWidth)-parseFloat(cs.paddingRight),over=()=>r.getBoundingClientRect().right-Math.min(w.getBoundingClientRect().right,right);let lo=0,hi=3;for(let k=0;k<30;k++){const m=(lo+hi)/2;w.style.letterSpacing=m+'px';if(over()>0.05)hi=m;else lo=m;}w.style.letterSpacing=hi+'px';}})();0`);
    if (MUT === 'thin' && urgent !== undefined) await js(`(()=>{for(const p of document.querySelectorAll('#stage .ro-plate.cab-narrow.has-help')){const w=p.querySelector('.ro-wd'),t=w.firstChild,r=document.createRange();r.selectNodeContents(t);const cs=getComputedStyle(p),right=p.getBoundingClientRect().right-parseFloat(cs.borderRightWidth)-parseFloat(cs.paddingRight),room=right-p.querySelector('.ro-hc').getBoundingClientRect().right-r.getBoundingClientRect().width;w.style.letterSpacing=((room-2)/t.data.length)+'px';}})();0`);
    if (MUT === 'namescope' && urgent === undefined) await js(`(()=>{for(const p of document.querySelectorAll('#stage .ro-plate.has-help:not(.cab-narrow)')){if(p.querySelector('.ro-help .dot.error,.ro-help .dot.waiting'))p.setAttribute('aria-label',p.getAttribute('aria-label').replace(/(\\. \\d+ helpers?)\\./,'$1, 1 failed or waiting.'));}})();0`);
    /* a plate with no pencil (a session the app cannot rename: no `has-ren`, no pencil button; the simulator's sessions all can be renamed): the same plates as the app draws them for it */
    if (nopencil) await js(`(()=>{for(const p of document.querySelectorAll('#stage .ro-plate.cab-narrow')){p.classList.remove('has-ren');const b=p.nextElementSibling;if(b&&b.classList.contains('ro-ren'))b.remove();}})();0`);
    const r = await js(PLATES());
    console.log('[102-arcade] plate marks', tag, JSON.stringify(scene), JSON.stringify(r.seen.filter((x) => x.helped)));
    const helped = r.seen.filter((x) => x.helped);
    if (urgent !== undefined) { /* spec 102 FR-312: the narrow cabinet's plate with a pencil (122 px, content 92 px) */
      const nm = helped.filter((x) => x.narrow && !!x.ren === !nopencil && x.word === 'Limit reached');
      assert.ok(nm.length >= 1, 'issue 1574: ' + tag + ': a narrow plate with a pencil, helpers and the word "Limit reached" is drawn (the case under test), saw ' + JSON.stringify(helped.map((x) => x.word + ' ' + x.pc + ' ' + x.plateW + ' ' + x.ren)));
      assert.deepStrictEqual(r.out.filter((o) => o.includes('"Limit reached"') && nm.some((x) => o.startsWith(x.id + ' '))), [], 'issue 1574: ' + tag + ': on the narrow plate the status word "Limit reached" is whole, inside the content box and not cut by an ellipsis');
      assert.deepStrictEqual(r.out.filter((o) => o.includes('the +N is cut') && nm.some((x) => o.startsWith(x.id + ' '))), [], 'issue 1574: ' + tag + ': on the narrow plate the "+N" is whole');
      assert.ok(nm.every((x) => x.room >= NARROW_ROOM), 'issue 1574: ' + tag + ': on the narrow plate the word keeps at least ' + NARROW_ROOM + ' px of room to the content box (a wider font must not eat the margin; the spec records the measured room): ' + JSON.stringify(nm.map((x) => x.room)));
      assert.ok(nm.every((x) => !x.ownDot), 'issue 1574: ' + tag + ': on the narrow plate with helpers the plate\'s own status dot is not drawn (the word, border and marquee say the state): ' + JSON.stringify(nm.map((x) => x.ownDot)));
      if (urgent) assert.ok(nm.every((x) => x.hm && x.hm.shown && x.hm.inside && x.hm.txt === '+' + x.helpers + '!'), 'issue 1574: ' + tag + ': on the narrow plate a failed helper is marked: the count reads "+N!" and the mark is whole in view: ' + JSON.stringify(nm.map((x) => x.hm)));
      else assert.ok(nm.every((x) => !x.hm || !x.hm.shown), 'issue 1574: ' + tag + ': on the narrow plate with no failed or waiting helper the count has no mark: ' + JSON.stringify(nm.map((x) => x.hm)));
      assert.ok(nm.every((x) => x.label.includes(urgent ? '. ' + x.helpers + ' helpers, ' + x.urgN + ' failed or waiting.' : '. ' + x.helpers + ' helpers.') && (urgent || !x.label.includes('failed or waiting'))), 'issue 1574: ' + tag + ': the narrow plate\'s name says how many helpers failed or wait (and only when some did): ' + JSON.stringify(nm.map((x) => x.label)));
      assert.ok(nm.every((x) => /^U*o*$/.test(x.order)), 'issue 1574: ' + tag + ': on the narrow plate a failed or waiting helper\'s dot comes before every OK helper\'s (the dots drop out from the last): ' + JSON.stringify(nm.map((x) => x.order)));
    }
    if (urgent === undefined && !nohelp) { /* spec 102 FR-312: a plate that is not the narrow one keeps FR-311's name: the count of helpers, no words for the failed ones */
      const wide = helped.filter((x) => !x.narrow && /error|waiting/.test(x.cls || ''));
      if (want) assert.ok(wide.length >= 1, 'issue 1574: ' + tag + ': a wide plate with a failed helper is drawn (the case for its name)');
      assert.ok(wide.every((x) => !x.label.includes('failed or waiting') && x.label.includes('. ' + x.helpers + ' helper' + (x.helpers > 1 ? 's' : '') + '.') && !x.title.includes('failed or waiting')), 'issue 1574: ' + tag + ': a plate that is not the narrow one keeps its name "N helpers" with no words for the failed ones: ' + JSON.stringify(wide.map((x) => x.label + ' | ' + x.title)));
    }
    if (nohelp) { /* issue 1600 (with FR-312): the narrow plate with a pencil and NO helpers keeps its word whole too: its own dot is not drawn */
      const np = r.seen.filter((x) => x.narrow && x.ren && !x.helped && x.word === 'Limit reached');
      assert.ok(np.every((x) => x.room >= NARROW_ROOM), 'issue 1600: ' + tag + ': on the narrow plate with no helpers the word keeps at least ' + NARROW_ROOM + ' px of room (the ellipsis of the line taken in): ' + JSON.stringify(np.map((x) => x.room)));
      assert.ok(np.length >= 1, 'issue 1600: ' + tag + ': a narrow plate with a pencil, no helpers and the word "Limit reached" is drawn (the case under test), saw ' + JSON.stringify(r.seen.map((x) => x.word + ' ' + x.pc + ' ' + x.plateW + ' ' + x.ren + ' ' + x.helped)));
      assert.deepStrictEqual(r.out.filter((o) => o.includes('"Limit reached"')), [], 'issue 1600: ' + tag + ': on the narrow plate with a pencil and no helpers the status word "Limit reached" is whole (its right end inside the content box, exact to 0.02 px)');
    }
    assert.deepStrictEqual(r.out, [], 'issue 1558: ' + tag + ': a plate\'s +N, status word and dots are whole (the strip of helpers gives way): ' + JSON.stringify(r.out));
    if (want) for (const [word, ...rest] of want) {
      const m = helped.filter((x) => x.word === word);
      assert.ok(m.length >= 1, 'issue 1558: ' + tag + ': a plate with helpers and the word "' + word + '" is drawn (the case under test), saw ' + JSON.stringify(helped.map((x) => x.word + ' ' + x.pc + ' ' + x.plateW + ' ' + x.t)));
      assert.ok(m.some((x) => x.shown >= 1), 'issue 1558: ' + tag + ': the helpers\' mark keeps a dot on the plate with "' + word + '" (the dots give way last): ' + JSON.stringify(m));
    }
    return r;
  };
  for (const [w, h] of SIZES) {
    await loadArcade(w, h, 15, { simfreeze: '1', simhelpers: '3', simcompact: '1' });
    const a = await markCheck(w + 'x' + h + ' compacting', {}, w < 1440 ? { want: [['Compacting']] } : {});
    if (w < 1440) assert.ok(a.seen.some((x) => x.helped && x.word === 'Compacting' && x.urgentShown === 1), 'issue 1558: 1280x800: the failed (last) helper\'s red mark stays shown on the compacting plate: ' + JSON.stringify(a.seen.filter((x) => x.helped)));
    await loadArcade(w, h, 15, { simfreeze: '1', simhelpers: '3', simretry: '1' });
    await markCheck(w + 'x' + h + ' retrying', {}, w < 1440 ? { want: [['Retrying']] } : {});
    /* the narrow cabinet's plate (122 px, a pencil: 20+ agents have no strip): the longest word, with a failed helper (simhelpers 3) and with none (simhelpers 2) */
    if (w < 1440) for (const [hn, urgent] of [['3', true], ['2', false]]) {
      await loadArcade(w, h, 24, { simfreeze: '1', simhelpers: hn });
      await markCheck(w + 'x' + h + ' narrow limit ' + (urgent ? 'failed helper' : 'no failed helper'), {}, { states: 'limit', urgent });
      if (urgent && !MUT) await H.shot(path.join(OUT, `102-arcade-narrow-plate-${w}x${h}.png`), { prep: 'calm', settle: true, tag: '102-arcade', what: 'narrow-plate' });
    }
    /* the narrow plate with helpers and NO pencil (a session that cannot be renamed; the content box is 106 px, not 96): the same word, mark and name */
    if (w < 1440) {
      await loadArcade(w, h, 24, { simfreeze: '1', simhelpers: '3' });
      await markCheck(w + 'x' + h + ' narrow limit failed helper no pencil', {}, { states: 'limit', urgent: true, nopencil: true });
    }
    /* issue 1600: the same plate with a pencil and no helpers at all */
    if (w < 1440) {
      await loadArcade(w, h, 24, { simfreeze: '1', simhelpers: '0' });
      await markCheck(w + 'x' + h + ' narrow limit no helpers', {}, { states: 'limit', nohelp: true });
    }
  }

  /* spec 102 FR-312, the gate (second read of #1599): the narrow-plate rules (the "+N!" mark, the name's failed-or-waiting words) are the arcade's alone. The default and the cave Real office draw plates as narrow as 122 px too (a strip-less fallback, 097 FR-308, at 800x600 with 20 agents the narrowest plate is 86 px): such a plate with a failed helper keeps FR-308's name ". N helpers. Open chat panel." and has no mark. Mutant ARCADE_MUTANT=worldgate: the arcade's rules on every plate of that width (the gate removed). */
  for (const world of ['photo', 'cave']) {
    await H.load({ w: 800, h: 600, query: { officeview: 'real', simfreeze: '1', simhelpers: '3', sim: '20', ...(world === 'cave' ? { worldflags: 'cave', world: 'cave' } : {}) }, ready: `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`, settle: false });
    await must(`document.querySelectorAll('#stage .ro .ro-plate.has-help').length>=10`, world + ' 800x600: the strip-less plates with helpers are drawn', 15000);
    if (MUT === 'worldgate') await js(`(()=>{for(const p of document.querySelectorAll('#stage .ro-plate.has-help')){if(p.getBoundingClientRect().width>122.5||!p.querySelector('.ro-help .dot.error,.ro-help .dot.waiting'))continue;p.setAttribute('aria-label',p.getAttribute('aria-label').replace(/(\\. \\d+ helpers?)\\./,'$1, 1 failed or waiting.'));const m=document.createElement('span');m.className='ro-hm';m.textContent='!';p.querySelector('.ro-help').appendChild(m);}})();0`);
    const g = await js(`[...document.querySelectorAll('#stage .ro-plate.has-help')].filter(p=>p.getBoundingClientRect().width<=122.5&&p.querySelector('.ro-help .dot.error,.ro-help .dot.waiting')).map(p=>({id:p.dataset.id,w:Math.round(p.getBoundingClientRect().width),n:p.querySelectorAll('.ro-help .dot').length,label:p.getAttribute('aria-label')||'',title:p.getAttribute('title')||'',mark:!!p.querySelector('.ro-hm')}))`);
    assert.ok(g.length >= 1, 'issue 1574: ' + world + ' 800x600: a plate of 122.5 px or less with helpers and a failed helper is drawn (the case for the gate), saw none');
    assert.ok(g.every((x) => !x.mark && !x.label.includes('failed or waiting') && !x.title.includes('failed or waiting') && /\. \d+ helpers?\. Open chat panel\.$/.test(x.label)), 'issue 1574: ' + world + ' 800x600: a default or cave plate that is as narrow as the arcade\'s keeps FR-308\'s name "N helpers" and has no mark (the narrow-plate rules are the arcade\'s alone): ' + JSON.stringify(g.slice(0, 3)));
    console.log('[102-arcade] ' + world + ' 800x600 narrow plates with a failed helper', g.length, 'narrowest', Math.min(...g.map((x) => x.w)));
  }

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

  /* ---- spec 102 T220 / FR-263: Settings, the List view and the palette while the world shows: `data-ui="retro"` and the dark page, every text 4.5:1 on what is behind it; leaving gives the theme's own back ---- */
  await loadArcade(1440, 900, 15, { simfreeze: '1' });
  const CHROME = `(()=>{const d=document.documentElement;return {ui:d.dataset.ui||'',world:d.dataset.world||'',dark:d.dataset.dark!==undefined,bg:getComputedStyle(document.body).backgroundColor}})()`;
  assert.deepStrictEqual(await js(`(()=>{const c=${CHROME};return [c.ui,c.world,c.dark]})()`), ['retro', 'retro', true], 'the arcade shown: data-ui retro, data-world retro, dark');
  const SWEEP = (sel) => '(()=>{' + LUM + `const low=[];let n=0;const root=document.querySelector(${jsLiteral(sel)});if(!root)return {n:0,low:['no '+${jsLiteral(sel)}]};for(const e of root.querySelectorAll('*')){if(!e.getClientRects().length||e.closest('svg,[disabled],[aria-disabled="true"]')||![...e.childNodes].some(x=>x.nodeType===3&&x.textContent.trim()))continue;const c=getComputedStyle(e);if(c.visibility==='hidden'||+c.opacity===0)continue;n++;const px=parseFloat(c.fontSize),need=px>=24?3:4.5,r=ratio(c.color,bgOf(e));if(r<need)low.push((e.id||e.className||e.tagName)+' '+r.toFixed(2)+' '+c.color+' on '+bgOf(e)+' '+JSON.stringify(e.textContent.trim().slice(0,24)));if(px<10.5)low.push('small '+px+' '+e.textContent.trim().slice(0,20));}return {n,low};})()`;
  const SURF = { settings: '[data-sweep="scr"]', list: '#list', palette: '#palDlg' };
  const SURFACES = [
    ['settings', async () => { await js(`window.DurbarScreens.openSettings();0`); await must(`!!document.getElementById('motionSw')`, 'Settings'); await js(`document.getElementById('scrClose').closest('.scr-head').parentElement.dataset.sweep='scr';0`); }, async () => { await js(`document.getElementById('scrClose').click();0`); await must(`!document.getElementById('motionSw')`, 'Settings closed'); }],
    ['list', async () => { await js(`document.getElementById('vList').click();0`); await must(`document.getElementById('vList').getAttribute('aria-pressed')==='true'`, 'the List view'); }, async () => { await js(`document.getElementById('vOffice').click();0`); await must(REAL, 'the office back'); }],
    ['palette', async () => { await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',code:'KeyK',metaKey:/Mac/.test(navigator.platform),ctrlKey:!/Mac/.test(navigator.platform),bubbles:true}));0`); await must(`!!document.querySelector('#palDlg')&&document.querySelector('#palDlg').getClientRects().length>0`, 'the palette'); }, async () => { await js(`(document.getElementById('palIn')||document).dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));0`); await must(`!document.querySelector('#palDlg')||!document.querySelector('#palDlg').getClientRects().length`, 'the palette closed'); }],
  ];
  for (const [name, open, close] of SURFACES) {
    await open();
    const c = await js(CHROME);
    assert.deepStrictEqual([c.ui, c.world, c.dark], ['retro', 'retro', true], `${name}: data-ui retro, the world's dark page`);
    const sw = await js(SWEEP(SURF[name]));
    assert.ok(sw.n > 5, `${name}: the sweep reads its text (${sw.n})`);
    assert.deepStrictEqual(sw.low, [], `${name}: every text 4.5:1 and at least 10.5 px (${sw.n} read)`);
    await H.shot(path.join(OUT, `102-arcade-${name}-1440x900.png`), { prep: 'calm', settle: true, tag: '102-arcade', what: name });
    await close();
  }
  /* leaving gives the theme's look back: the flat office, no world, the theme's own UI style (Clean Office has none) */
  await js(`window.__durbarSimUi.setOfficeView('flat');0`);
  await must(`document.documentElement.dataset.world===undefined&&document.documentElement.dataset.ui===undefined`, 'the flat office: no world, the theme\'s UI style');
  assert.strictEqual(await js(`document.documentElement.dataset.dark===undefined`), true, 'leaving: the theme\'s light page');

  console.log('[102-arcade] PASS');
};

/* The three listeners are on the session, which Electron keeps one per event: a later driver in the same process would inherit or replace them, and onBeforeRequest
   must answer every request. So they are installed here and always removed (as check-done-desk-mask.js does), then a probe request proves they are gone (review of #1435). */
module.exports = async (ctx) => {
  const reqs = new Map();
  const wr = ctx.win.webContents.session.webRequest;
  const remove = () => { wr.onBeforeRequest(null); wr.onCompleted(null); wr.onErrorOccurred(null); };
  wr.onBeforeRequest({ urls: ['file://*/*'] }, (d, cb) => { reqs.set(d.id, { url: decodeURIComponent(d.url), status: 0, error: '' }); cb({}); });
  wr.onCompleted({ urls: ['file://*/*'] }, (d) => { const e = reqs.get(d.id); if (e) e.status = d.statusCode; });
  wr.onErrorOccurred({ urls: ['file://*/*'] }, (d) => { const e = reqs.get(d.id); if (e) e.error = d.error; });
  try { await run(ctx, reqs); } finally { remove(); }
  reqs.clear();
  await helpers(ctx).js(`new Promise((r)=>{const i=new Image();i.onload=i.onerror=()=>r(0);i.src=new URL('realoffice/worlds/retro/floor-night.webp?probe='+Date.now(),location.href).href;})`);
  await ctx.sleep(200);
  assert.strictEqual(reqs.size, 0, 'the request log listeners are removed when the driver ends: ' + [...reqs.values()].map((e) => e.url).join(' '));
};
