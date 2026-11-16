/*
 * Spec 102 T265a (FR-302): the world previews, taken by the app itself in the simulator (no AI credits, no account). In ui-suite.js;
 * `node scripts/ui-suite.js --only shots-102-previews`; `npm run shots:docs` retakes them into src/renderer/realoffice/previews/.
 *
 * One picture per built-in world (Plain, Photo office, Prehistoric cave, Retro arcade) in `simscene=preview`: three people of one folder at their own
 * desks, idle, in Ask first, with no slip, notice, banner or bubble over them. 1440x900, the office area (`#stage`) only, 640 px wide WebP, each at
 * most 48 KB (the encoder lowers its quality until it fits; a picture that cannot fit fails). Next to each, `previews.json` holds the zoom origin
 * (FR-301: where the card zooms to, the middle of the three people, in percent of the picture).
 *
 * It fails (exit 1) when, in any world: there are not three people shown, one is not at a desk (a desk, a seat or a cabinet; a person in a lounge fails),
 * a slip, notice, banner, toast, bubble, tooltip or status filter note shows over the office, the office scrolls, a picture is over 48 KB or not a WebP of
 * 640 px, or a world's own draw is not the one asked for (Plain draws no Real office; the others draw `.ro[data-world]` of their id).
 * Mutant (test only): `PREVIEWS_MUTANT=no-scene` loads the ordinary three-agent roster (working, thinking, waiting): the driver must fail.
 * Output: <SHOTS_OUT>/<id>.webp for plain, photo, cave, retro, and previews.json; `PREVIEWS_SHOT=1` also writes <id>-1440x900.png and <id>-1280x800.png (the whole window, to look at; 1280x800 is checked but makes no preview).
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers } = require('./driver-helpers');

const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-102-previews-'));
const WORLDS = [
  { id: 'plain', query: {} },
  { id: 'photo', query: { officeview: 'real', world: 'photo' } },
  { id: 'cave', query: { officeview: 'real', worldflags: 'cave', world: 'cave' } },
  { id: 'retro', query: { officeview: 'real', worldflags: 'retro', world: 'retro' } },
];
const WIDTH = 640, MAX = 48 * 1024, W = 1440, H_ = 900;
const SIZES = [[W, H_], [1280, 800]]; // the scene is checked at both; only 1440x900 makes the preview (FR-302)

/** The page's own check of the scene: a list of problems and the people's boxes (the crop's origin is the stage's). */
const SCENE = (id) => `(()=>{
  const st=document.getElementById('stage'),sr=st.getBoundingClientRect(),real=${id === 'plain' ? 'false' : 'true'},out=[];
  const vis=(e)=>{const r=e.getBoundingClientRect(),cs=getComputedStyle(e);return r.width>0&&r.height>0&&cs.visibility!=='hidden'&&cs.display!=='none'&&+cs.opacity>0.05;};
  const ro=st.querySelector('.ro');
  if(real){ if(!ro||ro.dataset.world!==${JSON.stringify(id)})out.push('the world drawn is '+(ro&&ro.dataset.world)+', not ${id}'); }
  else if(ro)out.push('Plain drew a Real office');
  const who=real?[...st.querySelectorAll('.ro-plate[data-id]')].map((p)=>p.dataset.id):[...st.querySelectorAll('.desk[data-id]')].map((d)=>d.dataset.id);
  const ids=[...new Set(who)];
  if(ids.length!==3)out.push('people shown: '+ids.length+' ('+ids.join(',')+'), not 3');
  const seats=real?[...st.querySelectorAll('.ro-person')].filter(vis):[...st.querySelectorAll('.desk[data-id]')].filter(vis);
  const boxes=seats.map((e)=>{const r=e.getBoundingClientRect();return [r.left-sr.left,r.top-sr.top,r.right-sr.left,r.bottom-sr.top];});
  const over=[...document.querySelectorAll('#toasts .toast,.banner,.notice,.restore,.tooltip,[role=tooltip],.ro-bubble,.bubble,.slip,.ro-slip,.ro-tag,.ro-notice,#statusnote,.status-note')].filter(vis).map((e)=>(e.className||e.id||e.tagName)+': '+(e.textContent||'').trim().slice(0,40));
  if(over.length)out.push('over the office: '+over.join(' | '));
  if(st.scrollHeight>st.clientHeight+1||st.scrollWidth>st.clientWidth+1)out.push('the office scrolls');
  const busy=(st.innerText.match(/\\b(Working|Thinking|Waiting|Needs you|Needs your OK|Error|Away|Asleep)\\b/gi)||[]);
  if(busy.length)out.push('a person is not idle: '+[...new Set(busy)].join(', '));
  const awayMarks=[...st.querySelectorAll('[data-away="1"],.away,.ro-away')].filter(vis).length;
  if(awayMarks)out.push('someone is away from the desk ('+awayMarks+')');
  return {out,boxes,rect:[sr.left,sr.top,sr.width,sr.height],people:ids.length,unread:[...st.querySelectorAll('.unread,.ro-unread')].filter(vis).length};
})()`;

/** Crop the window picture (PNG bytes, base64) to `rect` and make a WebP of 640 px at the best quality that fits `max` bytes; run in the page (Chromium's canvas encoder). */
const ENCODE = (b64, rect, width, max) => `(async()=>{
  const bin=Uint8Array.from(atob(${JSON.stringify(b64)}),(c)=>c.charCodeAt(0));
  const bmp=await createImageBitmap(new Blob([bin],{type:'image/png'}));
  const [x,y,w,h]=${JSON.stringify(rect)},k=bmp.width/${W},sw=Math.round(w*k),sh=Math.round(h*k),cw=${width},ch=Math.round(sh*cw/sw);
  const c=document.createElement('canvas');c.width=cw;c.height=ch;const g=c.getContext('2d');g.imageSmoothingEnabled=true;g.imageSmoothingQuality='high';
  g.drawImage(bmp,Math.round(x*k),Math.round(y*k),sw,sh,0,0,cw,ch);
  let lo=0.3,hi=0.95,best=null;
  for(let i=0;i<8;i++){const q=(lo+hi)/2,b=await new Promise((r)=>c.toBlob(r,'image/webp',q));if(b.size<=${max}){best={q,b};lo=q;}else hi=q;}
  if(!best){return {ok:0,why:'no quality under ${max} bytes'};}
  const buf=new Uint8Array(await best.b.arrayBuffer());let s='';for(let i=0;i<buf.length;i+=8192)s+=String.fromCharCode.apply(null,buf.subarray(i,i+8192));
  return {ok:1,q:best.q,w:cw,h:ch,b64:btoa(s)};
})()`;

/** Chromium's encoder adds an ICC profile chunk (ICCP); a shipped picture has no metadata chunk (spec 097 FR-062), so it is cut out: the chunk, its flag in VP8X, the RIFF size. */
function stripIcc(buf) {
  assert.ok(buf.length > 20 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP', 'not a WebP');
  const parts = [];
  for (let at = 12; at + 8 <= buf.length;) {
    const tag = buf.toString('latin1', at, at + 4), size = buf.readUInt32LE(at + 4), end = at + 8 + size + (size & 1);
    if (tag !== 'ICCP') {
      const c = Buffer.from(buf.subarray(at, Math.min(end, buf.length)));
      if (tag === 'VP8X') c[8] &= ~0x20; // the ICC profile flag
      parts.push(c);
    }
    at = end;
  }
  const body = Buffer.concat(parts), head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(4 + body.length, 4); head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const origins = {};
  fs.mkdirSync(OUT, { recursive: true });
  for (const [w, h] of SIZES) for (const wd of WORLDS) {
    const main = w === W;
    const ready = wd.id === 'plain' ? `document.querySelectorAll('#stage .desk[data-id]').length>=3` : `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
    await H.load({ w, h, query: { sim: '3', simscene: process.env.PREVIEWS_MUTANT === 'no-scene' ? undefined : 'preview', ...wd.query }, ready, settle: false });
    if (wd.id !== 'plain') await must(`[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`, 'the pictures of ' + wd.id);
    await H.settle();
    const png = path.join(OUT, wd.id + '-' + w + 'x' + h + '.png');
    await H.shot(png, { prep: 'calm', settle: true });
    const sc = await js(SCENE(wd.id));
    console.log(`[102-previews] ${w}x${h} ${wd.id}: ${sc.people} people, ${sc.boxes.length} figures, unread marks ${sc.unread}`);
    assert.deepStrictEqual(sc.out, [], wd.id + ': the scene is wrong: ' + sc.out.join('; '));
    assert.ok(sc.boxes.length >= 3, wd.id + ': fewer than three figures at desks (' + sc.boxes.length + ')');
    if (!main) { if (process.env.PREVIEWS_SHOT !== '1') fs.rmSync(png, { force: true }); continue; }
    const r = await js(ENCODE(fs.readFileSync(png).toString('base64'), sc.rect, WIDTH, MAX));
    assert.ok(r && r.ok, wd.id + ': ' + (r && r.why));
    const bytes = stripIcc(Buffer.from(r.b64, 'base64'));
    assert.strictEqual(bytes.slice(0, 4).toString('latin1'), 'RIFF', wd.id + ': not a WebP');
    assert.strictEqual(bytes.slice(8, 12).toString('latin1'), 'WEBP', wd.id + ': not a WebP');
    assert.ok(bytes.length <= MAX, `${wd.id}: ${bytes.length} bytes, over 48 KB`);
    assert.strictEqual(r.w, WIDTH, wd.id + ': width');
    fs.writeFileSync(path.join(OUT, wd.id + '.webp'), bytes);
    const [sx, sy, sw, sh] = sc.rect;
    const cx = sc.boxes.reduce((a, b) => a + (b[0] + b[2]) / 2, 0) / sc.boxes.length, cy = sc.boxes.reduce((a, b) => a + (b[1] + b[3]) / 2, 0) / sc.boxes.length;
    const pct = (v, t) => Math.max(0, Math.min(100, Math.round((v / t) * 1000) / 10));
    origins[wd.id] = { file: wd.id + '.webp', width: r.w, height: r.h, bytes: bytes.length, origin: { x: pct(cx, sw), y: pct(cy, sh) } };
    console.log(`[102-previews] ${wd.id}.webp ${r.w}x${r.h}, ${(bytes.length / 1024).toFixed(1)} KB (quality ${r.q.toFixed(2)}), zoom origin ${origins[wd.id].origin.x}% ${origins[wd.id].origin.y}%`);
    if (process.env.PREVIEWS_SHOT !== '1') fs.rmSync(png, { force: true });
  }
  fs.writeFileSync(path.join(OUT, 'previews.json'), JSON.stringify({ formatVersion: 1, width: WIDTH, maxBytes: MAX, previews: origins }, null, 1) + '\n');
};
