/*
 * Spec 102 FR-352 (T206): the arcade's first-run card stands in the drawn hall (`welcome.webp`), not on the plain dark page. Simulator only
 * (DURBAR_SIM=15, simfreeze=1), no real session, no account, no AI credits; every wait is a condition, nothing sleeps for a fixed time.
 *
 *   npm run check:ui -- --only check-102-welcome      (builds first)
 *   WELCOME_MUTANT=<name>   each must fail at its own label:
 *     blank     the world's rule for the hall overridden (the page behind the card is the plain dark one): "the first-run page names welcome.webp as its picture"
 *     veil      the rule kept, but a dark sheet painted over the picture: "the picture is painted beside the card"
 *     glass     the card's surface made see-through (its text would then lie on the picture): "the card's surface is opaque"
 *     dim       one line of the card's text in a colour that does not read on the card: "the card's text reads at 4.5:1"
 *   SHOTS_OUT=<dir>         also writes 102-welcome-<w>x<h>.png (to look at)
 *
 * At 1440x900 and 1280x800 it checks: the stylesheet is the arcade's; the page behind the card names welcome.webp; the file loads (480 x 300, many colours,
 * dark overall, lit pixels in it: a drawn hall, not a fill); real pixels (`capturePage`) beside the card are not the plain page; the card's surface is
 * opaque (so the text is read against the app's token, not the picture); and every line of the card's text is at least 4.5:1 against the surface it stands on.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const SIZES = [[1440, 900], [1280, 800]];
const MUTANT = process.env.WELCOME_MUTANT || '';
const MIN_RATIO = 4.5;

/* page code, run as written (no value is interpolated into it) */
const PICTURE_READ = `(async()=>{
  const m=/url\\(["']?([^"')]*welcome\\.webp)["']?\\)/.exec(getComputedStyle(document.getElementById('floor')).backgroundImage||'');
  if(!m)return {named:false};
  const img=new Image();img.src=m[1];
  try{await img.decode()}catch(e){return {named:true,loaded:false,url:m[1]}}
  const cv=document.createElement('canvas');cv.width=img.naturalWidth;cv.height=img.naturalHeight;const g=cv.getContext('2d',{willReadFrequently:true});g.drawImage(img,0,0);
  const d=g.getImageData(0,0,cv.width,cv.height).data,seen=new Set();let lum=0,lit=0;
  for(let i=0;i<d.length;i+=4){seen.add((d[i]<<16)|(d[i+1]<<8)|d[i+2]);const l=(0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2])/255;lum+=l;if(l>0.5)lit++}
  return {named:true,loaded:true,url:m[1],w:img.naturalWidth,h:img.naturalHeight,colours:seen.size,meanLum:lum/(d.length/4),lit,alpha:d[3]};
})()`;

const CARD_READ = `(()=>{
  const cv=document.createElement('canvas');cv.width=cv.height=1;const g=cv.getContext('2d',{willReadFrequently:true});
  const rgba=c=>{g.clearRect(0,0,1,1);g.fillStyle='#000';g.fillStyle=c;g.fillRect(0,0,1,1);const d=g.getImageData(0,0,1,1).data;return [d[0],d[1],d[2],d[3]/255]};
  const lin=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};
  const L=c=>0.2126*lin(c[0])+0.7152*lin(c[1])+0.0722*lin(c[2]);
  const card=document.querySelector('#stage .welcome'),cs=rgba(getComputedStyle(card).backgroundColor);
  const under=e=>{for(let n=e;n;n=n.parentElement){const c=rgba(getComputedStyle(n).backgroundColor);if(c[3]>0)return {c,own:n};if(n===card)break}return {c:cs,own:card}};
  const lines=[...card.querySelectorAll('*')].filter(e=>[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()));
  let worst={ratio:99,text:''},translucent=0;
  for(const e of lines){const b=under(e),f=rgba(getComputedStyle(e).color);if(b.c[3]<1)translucent++;
    const mix=f.slice(0,3).map((v,i)=>v*f[3]+b.c[i]*(1-f[3])),l1=L(mix),l2=L(b.c),r=(Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);
    if(r<worst.ratio)worst={ratio:r,text:e.textContent.trim().slice(0,40),tag:e.tagName.toLowerCase()+'.'+String(e.className).trim()}}
  const f=document.getElementById('floor').getBoundingClientRect(),r=card.getBoundingClientRect();
  return {cardAlpha:cs[3],lines:lines.length,worst,translucent,floor:{l:f.left,t:f.top,r:f.right,b:f.bottom},card:{l:r.left,t:r.top,r:r.right,b:r.bottom},dpr:devicePixelRatio};
})()`;

const addStyle = (css) => `(()=>{const s=document.createElement('style');s.textContent=${jsLiteral(css)};document.head.appendChild(s)})()`;
const MUTANT_CSS = {
  blank: 'html[data-world="retro"] #floor:has(> #stage > .welcome){background:#0c0816!important}',
  veil: '#floor:has(> #stage > .welcome){position:relative}#floor:has(> #stage > .welcome)::before{content:"";position:absolute;inset:0;background:#0c0816;z-index:0;pointer-events:none}#stage > .welcome{position:relative;z-index:1}',
  glass: '#stage > .welcome{background:rgba(255,255,255,.12)!important}',
  dim: '#stage > .welcome .wl-note{color:#3a3a4a!important}',
};

module.exports = async (ctx) => {
  const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-102-welcome-'));
  const H = helpers(ctx);
  const { js } = H;
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
  assert.ok(!MUTANT || MUTANT_CSS[MUTANT], `unknown WELCOME_MUTANT ${MUTANT}`);
  for (const [w, h] of SIZES) {
    const tag = `arcade ${w}x${h}`;
    /* the simulator's page with every agent gone: no folder, no agent, the first run (as shots-097-moments does for the arcade) */
    await H.load({ w, h, query: { officeview: 'real', worldflags: 'retro', world: 'retro' }, ready: REAL, settle: false });
    await js(`window.__durbarSimUi.agents().splice(0);window.__durbarSimUi.crew.renderAll()`);
    await must(`!!document.querySelector('#stage .welcome')`, 'the first-run card');
    await must(`!!document.getElementById('roWorldCss-retro')&&document.documentElement.dataset.world==='retro'`, "the arcade's stylesheet");
    if (MUTANT) await js(addStyle(MUTANT_CSS[MUTANT]));

    // the picture: named by the page behind the card, loaded, and a drawn hall
    const pic = await js(PICTURE_READ);
    assert.ok(pic.named, `${tag}: the first-run page names welcome.webp as its picture`);
    assert.ok(pic.loaded, `${tag}: welcome.webp loads (${pic.url})`);
    assert.deepStrictEqual([pic.w, pic.h], [480, 300], `${tag}: the picture is the 480 x 300 hall`);
    assert.ok(pic.colours >= 40, `${tag}: the picture has many colours (${pic.colours}), it is not a fill`);
    assert.ok(pic.meanLum < 0.25 && pic.lit > 300, `${tag}: the picture is a dark hall with lit screens (mean ${pic.meanLum.toFixed(3)}, ${pic.lit} lit pixels)`);
    assert.strictEqual(pic.alpha, 255, `${tag}: the picture is opaque`);

    // the card: opaque, and its text reads on it
    const cd = await js(CARD_READ);
    assert.ok(cd.lines >= 8, `${tag}: the card's text was found (${cd.lines} lines)`);
    assert.strictEqual(cd.cardAlpha, 1, `${tag}: the card's surface is opaque (alpha ${cd.cardAlpha}): its text is read on the app's surface, not on the picture`);
    assert.strictEqual(cd.translucent, 0, `${tag}: no line of the card's text stands on a see-through surface`);
    assert.ok(cd.worst.ratio >= MIN_RATIO, `${tag}: the card's text reads at 4.5:1 or better on its surface; worst ${cd.worst.ratio.toFixed(2)}:1 for "${cd.worst.text}" (${cd.worst.tag})`);

    // real pixels beside the card (the page as painted, not the style): the hall, not the plain dark page
    const x0 = Math.ceil(cd.floor.l + 4), x1 = Math.floor(Math.min(cd.card.l - 8, cd.floor.l + 140)), y0 = Math.ceil(cd.floor.t + 4), y1 = Math.floor(cd.floor.b - 4);
    assert.ok(x1 - x0 >= 40 && y1 - y0 >= 200, `${tag}: there is room beside the card to look at (${x1 - x0} x ${y1 - y0} px)`);
    let px = null;
    const painted = async () => {
      const img = await H.wc().capturePage({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
      const { width, height } = img.getSize(), b = img.toBitmap(), seen = new Set(); let lit = 0;
      for (let i = 0; i < width * height; i++) { const bl = b[i * 4], g = b[i * 4 + 1], r = b[i * 4 + 2]; seen.add((r << 16) | (g << 8) | bl); if (Math.max(r, g, bl) > 150) lit++; }
      px = { colours: seen.size, lit, n: width * height };
      return px.colours >= 24 && px.lit >= 100;
    };
    // a capture can answer with the frame before the page was painted: wait for the painted state, bounded (a veiled page never gets there)
    let ok = false; const limit = Date.now() + 6000;
    while (!ok && Date.now() < limit) { ok = await painted(); if (!ok) await ctx.sleep(150); }
    assert.ok(ok, `${tag}: the picture is painted beside the card (the capture shows ${px && px.colours} colours and ${px && px.lit} lit pixels of ${px && px.n}; the plain page is one flat colour)`);
    if (process.env.SHOTS_OUT) await H.shot(path.join(OUT, `102-welcome-${w}x${h}.png`), { prep: 'calm', settle: true, tag: 'welcome', what: `102-welcome-${w}x${h}` });
    console.log(`[102-welcome] ${tag} ok: ${pic.colours} colours, worst text ${cd.worst.ratio.toFixed(1)}:1, ${px.colours} colours beside the card`);
  }
  console.log('[102-welcome] PASS');
};
