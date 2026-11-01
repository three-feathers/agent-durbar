/*
 * Spec 101 FR-040..FR-044: builds the app icon files from the drawings in build/logo (icon 1), by hand, never in `npm start`,
 * `npm test` or a release:
 *
 *   npm run icons:build         (starts one Electron, offscreen, then exits)
 *
 * Each size is drawn by an offscreen Electron window at device scale 1 (the same renderer as the app, no rsvg-convert, Pillow or
 * icnsutil), and the ICO and ICNS containers are written here in plain Node (PNG entries). It writes build/icon.svg, icon.png,
 * icon.ico, icon.icns, build/logo/icons.json (SHA-256 of every source and output) and src/renderer/logo-marks.js. No shell, no
 * network, no user input; paths use path.join so it runs on Windows, macOS and Linux. Bytes may differ a little across OSes: the
 * check (test:logo-assets) compares sizes and source hashes.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { marksSource, fileName, IDS, SIZES } = require('./logo-marks');

const ROOT = path.join(__dirname, '..');
const LOGO = path.join(ROOT, 'build', 'logo');
const MAC_PLATE = 824 / 1024; // D3: the plate fills 824/1024 of the canvas on macOS sizes from 128 up, as Apple's icon grid does

/** FR-041: the drawing each entry is made from, and whether it gets the macOS inset. */
const ICO = [[16, 16], [24, 32], [32, 32], [48, 32], [64, 32], [128, 1024], [256, 1024]]; // [size, drawing]
const ICNS = [['icp4', 16, 16], ['icp5', 32, 32], ['ic11', 32, 32], ['ic12', 64, 32], ['ic07', 128, 1024], ['ic13', 256, 1024], ['ic08', 256, 1024], ['ic14', 512, 1024], ['ic09', 512, 1024], ['ic10', 1024, 1024]]; // [type, pixels, drawing]

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
/** Hash of a text file with its line ends as LF, so a Windows checkout (CRLF) gives the same value. */
const shaText = (b) => sha(Buffer.from(String(b).replace(/\r\n/g, '\n')));

/** An ICO whose entries are PNGs: [{ size, png }] -> Buffer. 256 is written as 0 in the directory. */
function writeIco(entries) {
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  let offset = 6 + 16 * entries.length;
  const dir = entries.map((e) => {
    const d = Buffer.alloc(16);
    d[0] = e.size >= 256 ? 0 : e.size; d[1] = e.size >= 256 ? 0 : e.size; d.writeUInt16LE(1, 4); d.writeUInt16LE(32, 6);
    d.writeUInt32LE(e.png.length, 8); d.writeUInt32LE(offset, 12); offset += e.png.length;
    return d;
  });
  return Buffer.concat([head, ...dir, ...entries.map((e) => e.png)]);
}

/** An ICNS of PNG entries: [{ type, png }] -> Buffer (big-endian lengths). */
function writeIcns(entries) {
  const parts = entries.map((e) => { const h = Buffer.alloc(8); h.write(e.type, 0, 'latin1'); h.writeUInt32BE(8 + e.png.length, 4); return Buffer.concat([h, e.png]); });
  const total = 8 + parts.reduce((n, p) => n + p.length, 0);
  const head = Buffer.alloc(8); head.write('icns', 0, 'latin1'); head.writeUInt32BE(total, 4);
  return Buffer.concat([head, ...parts]);
}

async function main() {
  const { app, BrowserWindow } = require('electron');
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  app.commandLine.appendSwitch('high-dpi-support', '1');
  await app.whenReady();
  const win = new BrowserWindow({ show: false, frame: false, transparent: true, width: 64, height: 64, useContentSize: true, backgroundColor: '#00000000', webPreferences: { backgroundThrottling: false, offscreen: false } });
  const cache = new Map();
  /** The picture of `file` at `px` pixels, centred in the canvas at `inset` of its width (1 = full). */
  async function render(file, px, inset) {
    const key = `${file}@${px}@${inset}`;
    if (cache.has(key)) return cache.get(key);
    const svg = fs.readFileSync(path.join(LOGO, file));
    const inner = Math.round(px * inset), off = Math.floor((px - inner) / 2);
    const uri = 'data:image/svg+xml;base64,' + svg.toString('base64');
    const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}img{position:absolute;left:${off}px;top:${off}px;width:${inner}px;height:${inner}px}</style><img src="${uri}">`;
    win.setContentSize(px, px);
    await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
    await win.webContents.executeJavaScript('new Promise(r=>{const i=document.querySelector("img");(i.complete?Promise.resolve():new Promise(x=>{i.onload=x;})).then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))));})');
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: px, height: px });
    const sz = img.getSize();
    const out = (sz.width === px ? img : img.resize({ width: px, height: px, quality: 'best' })).toPNG();
    cache.set(key, out);
    return out;
  }
  const src = (n) => fileName(1, n);
  const ico = [];
  for (const [size, drawing] of ICO) ico.push({ size, png: await render(src(drawing), size, 1) });
  const icns = [];
  for (const [type, px, drawing] of ICNS) icns.push({ type, png: await render(src(drawing), px, px >= 128 ? MAC_PLATE : 1) });
  const png1024 = await render(src(1024), 1024, 1);
  win.destroy();

  const outputs = { 'build/icon.png': png1024, 'build/icon.ico': writeIco(ico), 'build/icon.icns': writeIcns(icns), 'build/icon.svg': fs.readFileSync(path.join(LOGO, src(1024))) };
  for (const [rel, buf] of Object.entries(outputs)) fs.writeFileSync(path.join(ROOT, ...rel.split('/')), buf);
  const marks = marksSource();
  fs.writeFileSync(path.join(ROOT, 'src', 'renderer', 'logo-marks.js'), marks);
  const sources = {};
  for (const id of IDS) for (const s of SIZES) { const f = fileName(id, s); sources['build/logo/' + f] = shaText(fs.readFileSync(path.join(LOGO, f), 'utf8')); }
  const record = {
    note: 'Written by scripts/build-icons.js (npm run icons:build). test:logo-assets fails when a source changed without a rebuild. Output bytes may differ across OSes.',
    sources,
    outputs: Object.fromEntries(Object.entries(outputs).map(([k, v]) => [k, k.endsWith('.svg') ? shaText(v) : sha(v)])),
    renderer: { 'src/renderer/logo-marks.js': shaText(marks) },
    ico: ICO.map(([size, drawing]) => ({ size, from: src(drawing) })),
    icns: ICNS.map(([type, px, drawing]) => ({ type, size: px, from: src(drawing), plateInset: px >= 128 ? MAC_PLATE : 1 })),
  };
  fs.writeFileSync(path.join(LOGO, 'icons.json'), JSON.stringify(record, null, 2) + '\n');
  console.log('icons built: icon.png, icon.ico (' + ico.length + '), icon.icns (' + icns.length + '), logo-marks.js, icons.json');
  app.quit();
}

/** `node scripts/build-icons.js --marks-only`: only src/renderer/logo-marks.js and its hash in icons.json (no picture changes, no Electron). */
function marksOnly() {
  const marks = marksSource();
  fs.writeFileSync(path.join(ROOT, 'src', 'renderer', 'logo-marks.js'), marks);
  const f = path.join(LOGO, 'icons.json'), rec = JSON.parse(fs.readFileSync(f, 'utf8'));
  rec.renderer = { 'src/renderer/logo-marks.js': shaText(marks) };
  fs.writeFileSync(f, JSON.stringify(rec, null, 2) + '\n');
  console.log('logo-marks.js rebuilt');
}
if (process.argv.includes('--marks-only') && !process.versions.electron) marksOnly();
else if (process.type === 'browser' && process.versions.electron) main().catch((e) => { console.error('icons:build failed:', e && e.message); process.exitCode = 1; try { require('electron').app.exit(1); } catch (_) { /* not in Electron */ } });
module.exports = { writeIco, writeIcns, ICO, ICNS, MAC_PLATE };
