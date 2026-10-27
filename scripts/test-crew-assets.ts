/** Cheeky crew pictures (spec 077 FR-050, FR-051, FR-054): every shipped picture has a provenance row in ASSETS.md, a row names a file,
 *  the size caps hold, no metadata chunk is in a file, and the pictures are at the size the stage box needs. `npm run test:crew-assets`.
 *  Plain Node, no DOM, no credits. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, 'src', 'renderer', 'crew', 'art');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const C = require(path.join(ROOT, 'src', 'renderer', 'crew.js')) as { IDS: string[]; POSES: string[]; BOX: { w: number; h: number }; PX_PER_UNIT: number; files: (ids?: string[]) => string[] };

const MAX_FILE = 40 * 1024, MAX_TOTAL = 1.5 * 1024 * 1024; // FR-050 (3 poses per character; 13 characters are 1.2 MB)
const COLUMNS = ['file', 'character', 'tool', 'date', 'prompt', 'made by', 'edited by', 'licence', 'generator terms read'];

/** The RIFF chunks of a WebP: [fourcc, size] in order, and the picture's size from its VP8, VP8L or VP8X header. */
export function webpInfo(buf: Buffer): { chunks: string[]; width: number; height: number } {
  assert.ok(buf.length > 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP', 'a WebP file');
  const chunks: string[] = []; let width = 0, height = 0;
  for (let p = 12; p + 8 <= buf.length;) {
    const id = buf.toString('latin1', p, p + 4), size = buf.readUInt32LE(p + 4), d = p + 8;
    chunks.push(id);
    if (id === 'VP8X') { width = 1 + buf.readUIntLE(d + 4, 3); height = 1 + buf.readUIntLE(d + 7, 3); }
    else if (id === 'VP8 ' && !width) { width = buf.readUInt16LE(d + 6) & 0x3fff; height = buf.readUInt16LE(d + 8) & 0x3fff; }
    else if (id === 'VP8L' && !width) { const b = buf.readUInt32LE(d + 1); width = (b & 0x3fff) + 1; height = ((b >> 14) & 0x3fff) + 1; }
    p = d + size + (size & 1);
  }
  return { chunks, width, height };
}

/** The rows of the provenance table: file name (from backticks) -> its cells. */
export function assetRows(md: string): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  for (const line of md.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    const m = /^`([^`]+)`$/.exec(cells[0] || '');
    if (!m) continue;
    assert.ok(!rows.has(m[1]), 'one row per file: ' + m[1]);
    rows.set(m[1], cells);
  }
  return rows;
}

/** Everything wrong with a folder of pictures and its ASSETS.md text, as sentences (empty = fine). */
export function problems(files: Map<string, Buffer>, md: string, header = md): string[] {
  const out: string[] = [];
  const rows = assetRows(md);
  if (!COLUMNS.every((c) => header.toLowerCase().includes(c))) out.push('ASSETS.md: the table header must name ' + COLUMNS.join(', '));
  let total = 0;
  for (const [name, buf] of files) {
    total += buf.length;
    const row = rows.get(name);
    if (!row) out.push(`${name}: no row in ASSETS.md`);
    else {
      if (row.length < COLUMNS.length) out.push(`${name}: its ASSETS.md row has ${row.length} cells, needs ${COLUMNS.length}`);
      row.forEach((cell, i) => { if (!cell) out.push(`${name}: ASSETS.md cell "${COLUMNS[i] || i}" is empty`); });
    }
    if (buf.length > MAX_FILE) out.push(`${name}: ${buf.length} bytes, over the ${MAX_FILE} cap`);
    let info;
    try { info = webpInfo(buf); } catch (e) { out.push(`${name}: not a WebP file`); continue; }
    for (const c of info.chunks) if (!['VP8 ', 'VP8L', 'VP8X', 'ALPH'].includes(c)) out.push(`${name}: metadata or unexpected chunk "${c}" (strip EXIF, XMP, ICC and text)`);
    if (info.width !== 352 || info.height !== 352) out.push(`${name}: ${info.width}x${info.height}, the art is 352x352 (FR-059)`);
    if (info.width < C.BOX.w * C.PX_PER_UNIT || info.height < C.BOX.h * C.PX_PER_UNIT) out.push(`${name}: ${info.width}x${info.height}, the stage box needs at least ${C.BOX.w * C.PX_PER_UNIT}x${C.BOX.h * C.PX_PER_UNIT} (2x of its largest shown size)`);
    if (Math.abs(info.width / info.height - C.BOX.w / C.BOX.h) > 0.01) out.push(`${name}: ${info.width}x${info.height} does not have the box's shape ${C.BOX.w}:${C.BOX.h}`);
  }
  for (const name of rows.keys()) if (!files.has(name)) out.push(`ASSETS.md: row for ${name}, which is not in the folder`);
  if (total > MAX_TOTAL) out.push(`total ${total} bytes, over the ${MAX_TOTAL} cap`);
  return out;
}

// ---- the real folder ----
const files = new Map<string, Buffer>();
for (const f of fs.readdirSync(DIR)) if (f.endsWith('.webp')) files.set(f, fs.readFileSync(path.join(DIR, f)));
const md = fs.readFileSync(path.join(DIR, 'ASSETS.md'), 'utf8');
const real = problems(files, md);
assert.deepStrictEqual(real, [], 'the shipped pictures pass: ' + real.join('; '));
for (const id of C.IDS) for (const pose of C.POSES) assert.ok(files.has(`${id}-${pose}.webp`), `${id}-${pose}.webp exists (every character, every pose)`);
assert.deepStrictEqual([...files.keys()].sort(), C.files().map((f) => f.replace(/^crew\/art\//, '')).sort(), 'the folder holds exactly the pictures crew.js names');

// ---- the check itself: each rule fails when its case is broken (so a rule removed from the check shows here) ----
{
  const good = files.get('punk-working.webp') as Buffer;
  const one = new Map([['punk-working.webp', good]]);
  const row = '| `punk-working.webp` | punk | tool | 2026-10-23 | none | me | none | MIT | n/a |';
  const head = '| file | character | tool and version | date | prompt | made by | edited by | licence | generator terms read |\n|---|---|---|---|---|---|---|---|---|\n';
  assert.deepStrictEqual(problems(one, head + row), [], 'a good file with a full row');
  assert.ok(problems(one, head).some((p) => /no row/.test(p)), 'a picture without a row fails');
  assert.ok(problems(new Map(), head + row).some((p) => /not in the folder/.test(p)), 'a row without a picture fails');
  assert.ok(problems(one, head + row.replace('| none |', '|  |')).some((p) => /empty/.test(p)), 'an empty cell (the prompt) fails');
  assert.ok(problems(one, head + '| `punk-working.webp` | punk | tool |').some((p) => /cells/.test(p)), 'a short row fails');
  assert.ok(problems(new Map([['punk-working.webp', Buffer.concat([good, Buffer.alloc(41 * 1024)])]]), head + row).some((p) => /cap/.test(p)), 'a file over the cap fails');
  // a metadata chunk appended to the RIFF (EXIF), with the RIFF size fixed up
  const exif = Buffer.concat([Buffer.from('EXIF'), Buffer.from([4, 0, 0, 0]), Buffer.from('abcd')]);
  const withMeta = Buffer.concat([good, exif]); withMeta.writeUInt32LE(withMeta.length - 8, 4);
  assert.ok(problems(new Map([['punk-working.webp', withMeta]]), head + row).some((p) => /chunk "EXIF"/.test(p)), 'an EXIF chunk fails');
  assert.ok(problems(new Map([['punk-working.webp', Buffer.from('not an image at all, just text')]]), head + row).some((p) => /not a WebP/.test(p)), 'a non-image fails');
}

// ---- packaging: the build copies the folder and electron-builder packs dist (FR-050, T040) ----
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { build: { files: string[] } };
assert.ok(pkg.build.files.includes('dist/**/*'), 'electron-builder packs everything under dist/, so dist/renderer/crew/ ships');
const copy = fs.readFileSync(path.join(ROOT, 'scripts', 'copy-assets.js'), 'utf8');
assert.ok(/'crew', 'art'/.test(copy) && /\.webp/.test(copy), 'copy-assets.js copies the .webp files of crew/art');
assert.ok(!/ASSETS|PROMPTS/.test(copy.replace(/\/\/.*$/gm, '')), 'copy-assets.js does not ship ASSETS.md or the prompt files');
// the build output holds the pictures when dist/ exists (npm run build first; the full run builds before the tests)
const OUT = path.join(ROOT, 'dist', 'renderer', 'crew', 'art');
if (fs.existsSync(path.join(ROOT, 'dist', 'renderer', 'index.html'))) {
  assert.deepStrictEqual(fs.readdirSync(OUT).sort(), [...files.keys()].sort(), 'dist/renderer/crew/art holds exactly the pictures: no ASSETS.md, no prompts');
}
const csp = /Content-Security-Policy" content="([^"]*)"/.exec(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8'));
assert.strictEqual(csp && csp[1], "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;", 'the CSP is unchanged (FR-057)');
console.log('crew assets tests passed (' + files.size + ' pictures)');
