/*
 * Spec 102 FR-302 (T265, first step): the World cards' preview pictures, real pictures of the app. Simulator only: no AI credits, no account.
 *
 *   node scripts/ui-suite.js --only shots-102-world-previews                 takes them into a temp folder and checks the scene and the committed files
 *   WORLD_PREVIEWS_OUT=src/renderer/world-previews node scripts/ui-suite.js --only shots-102-world-previews   retakes the committed ones
 *
 * For Plain (the flat office) and the Photo office, at 1440x900 with `simscene=preview` (three people, each at their own desk, idle, in Ask first):
 *   - exactly three people sit at three desks and nothing sits on top: no toast, notice strip, banner, request slip or bubble (FR-302);
 *   - the office area is saved as a 640 px wide WebP (the page's own canvas encodes it) of at most 48 KB, with the zoom origin (the middle of the
 *     three people, in percent of the picture), written to origins.json;
 *   - the committed files are WebP, 640 wide, at most 48 KB, and origins.json names exactly the pictures that exist, each origin inside 0..100.
 * A miss prints DRIVER FAILED. Pictures are taken only for worlds whose flag is open today: the cave and the arcade get theirs when theirs opens.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const ROOT = path.join(__dirname, '..');
const COMMITTED = path.join(ROOT, 'src', 'renderer', 'world-previews');
const OUT = process.env.WORLD_PREVIEWS_OUT ? path.resolve(process.env.WORLD_PREVIEWS_OUT) : fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-world-previews-'));
const MAX = 48 * 1024;
const WIDTH = 640;
const WORLDS = [['plain', { officeview: 'flat' }, '#stage .desk[data-id]'], ['photo', { officeview: 'real' }, '#stage .ro .ro-person']];
/* what must not sit over the scene (FR-302): nothing here may be shown */
const OVER = `#toasts .toast,.notice-strip,.banner,.ro-slip,.slip,.bubble,.ro-bubble,.bubble-card`;

/* the width in pixels of a WebP file (lossy VP8, extended VP8X or lossless VP8L), or 0 */
function webpWidth(b) {
  const kind = b.subarray(12, 16).toString();
  if (kind === 'VP8 ') return b.readUInt16LE(26) & 0x3fff;
  if (kind === 'VP8X') return (b[24] | (b[25] << 8) | (b[26] << 16)) + 1;
  if (kind === 'VP8L') return ((b[21] | ((b[22] & 0x3f) << 8)) + 1);
  return 0;
}

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const wc = ctx.win.webContents;
  fs.mkdirSync(OUT, { recursive: true });
  const origins = {};

  for (const [id, view, people] of WORLDS) {
    await H.load({ w: 1440, h: 900, query: { ...view, sim: '3', simscene: 'preview' }, ready: `document.querySelectorAll('#stage .desk[data-id], #stage .ro .ro-person').length>=3`, settle: true });
    assert.ok(await until(`[...document.querySelectorAll('#stage img')].every(i=>i.complete)`, 10000), id + ': every picture is loaded');
    const found = await js(`(()=>{const q=${jsLiteral(people)};const n=[...document.querySelectorAll(q)].filter(e=>e.getBoundingClientRect().width>0);
      const over=[...document.querySelectorAll(${jsLiteral(OVER)})].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'}).map(e=>e.className||e.id||e.tagName);
      const st=document.getElementById('stage').getBoundingClientRect();
      const box=n.reduce((a,e)=>{const r=e.getBoundingClientRect();return {l:Math.min(a.l,r.left),t:Math.min(a.t,r.top),r:Math.max(a.r,r.right),b:Math.max(a.b,r.bottom)}},{l:1e9,t:1e9,r:-1e9,b:-1e9});
      return {n:n.length,over,st:{x:st.left,y:st.top,w:st.width,h:st.height},box,world:(document.querySelector('#stage .ro')||{dataset:{}}).dataset.world||'plain',states:[...document.querySelectorAll('#stage .desk[data-id], #stage .ro-plate[data-id]')].map(d=>(d.className.match(/\\b(?:is|st)-(idle|working|thinking|waiting|error|done|limit)\\b/)||[0,'?'])[1])}})()`);
    assert.strictEqual(found.n, 3, `${id}: three people sit at their desks (found ${found.n})`);
    assert.deepStrictEqual([...new Set(found.states)], ['idle'], `${id}: every person is idle (not waiting, working or done): ${found.states}`);
    assert.deepStrictEqual(found.over, [], `${id}: nothing sits on top of the scene (slip, notice, banner, bubble, toast)`);
    const x = Math.round(found.st.x), y = Math.round(found.st.y), w = Math.round(found.st.w), h = Math.round(found.st.h);
    const png = (await wc.capturePage({ x, y, width: w, height: h })).toPNG();
    /* the page's own canvas encodes the WebP (no encoder on every machine); the quality steps down once from a fixed list, never retried */
    const enc = await js(`(async()=>{const img=new Image();img.src='data:image/png;base64,'+${jsLiteral(png.toString('base64'))};await img.decode();
      const c=document.createElement('canvas');c.width=${WIDTH};c.height=Math.round(${h}*${WIDTH}/${w});const g=c.getContext('2d');g.imageSmoothingQuality='high';g.drawImage(img,0,0,c.width,c.height);
      for(const q of [0.8,0.7,0.6,0.5,0.4,0.3]){const b=await new Promise(r=>c.toBlob(r,'image/webp',q));const u=new Uint8Array(await b.arrayBuffer());if(u.length<=${MAX}||q===0.3){let s='';for(let i=0;i<u.length;i+=8192)s+=String.fromCharCode.apply(null,u.subarray(i,i+8192));return {q,len:u.length,b64:btoa(s),h:c.height};}}})()`);
    const buf = Buffer.from(enc.b64, 'base64');
    assert.ok(buf.length <= MAX, `${id}: the preview is at most 48 KB (${buf.length} bytes)`);
    fs.writeFileSync(path.join(OUT, id + '.webp'), buf);
    const cx = ((found.box.l + found.box.r) / 2 - found.st.x) / found.st.w, cy = ((found.box.t + found.box.b) / 2 - found.st.y) / found.st.h;
    origins[id] = { x: Math.round(Math.min(100, Math.max(0, cx * 100))), y: Math.round(Math.min(100, Math.max(0, cy * 100))) };
    console.log(`[102-world-previews] ${id}: ${buf.length} bytes, q ${enc.q}, ${WIDTH}x${enc.h}, origin ${origins[id].x}% ${origins[id].y}%, saved ${path.join(OUT, id + '.webp')}`);
  }
  fs.writeFileSync(path.join(OUT, 'origins.json'), JSON.stringify(origins, null, 2) + '\n');

  /* the committed files (the ones the Settings cards draw), whatever this run took */
  const have = fs.readdirSync(COMMITTED).filter((f) => f.endsWith('.webp')).map((f) => f.replace(/\.webp$/, '')).sort();
  const og = JSON.parse(fs.readFileSync(path.join(COMMITTED, 'origins.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(og).sort(), have, 'origins.json names exactly the preview pictures that exist');
  assert.deepStrictEqual(have, WORLDS.map((x) => x[0]).sort(), 'one preview for each world that is open today');
  for (const f of have) {
    const b = fs.readFileSync(path.join(COMMITTED, f + '.webp'));
    assert.ok(b.length <= MAX, `committed ${f}.webp is at most 48 KB (${b.length})`);
    assert.strictEqual(b.subarray(0, 4).toString(), 'RIFF', `committed ${f}.webp is a RIFF file`);
    assert.strictEqual(b.subarray(8, 12).toString(), 'WEBP', `committed ${f}.webp is WebP`);
    assert.strictEqual(webpWidth(b), WIDTH, `committed ${f}.webp is ${WIDTH} px wide`);
    const o = og[f];
    assert.ok(Number.isFinite(o.x) && Number.isFinite(o.y) && o.x >= 0 && o.x <= 100 && o.y >= 0 && o.y <= 100, `committed ${f} origin is inside the picture`);
  }
  console.log('[102-world-previews] all checks passed');
};
