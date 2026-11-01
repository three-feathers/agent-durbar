/** Logo family (spec 101 FR-071): the four drawings at four sizes, their forbidden-content list, slots, the renderer's copy, the palettes'
 *  contrast, the ICO and ICNS entries, the recorded hashes, the provenance rows and the approval rule (cave and loft need Paco).
 *  `npm run test:logo-assets`. Plain Node, no DOM, no Electron, no credits. */
import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { contrast } from '../src/shared/themegen';

const ROOT = path.join(__dirname, '..', '..');
const LOGO = path.join(ROOT, 'build', 'logo');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const M = require(path.join(ROOT, 'scripts', 'logo-marks.js')) as { IDS: string[]; SIZES: number[]; SLOTS: string[]; fileName: (id: string, size: number) => string; marksSource: (read?: (f: string) => string) => string; innerShapes: (s: string) => string };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const B = require(path.join(ROOT, 'scripts', 'build-icons.js')) as { ICO: number[][]; ICNS: (string | number)[][]; MAC_PLATE: number; writeIco: (e: { size: number; png: Buffer }[]) => Buffer; writeIcns: (e: { type: string; png: Buffer }[]) => Buffer };

const COLUMNS = ['file', 'icon', 'form', 'world', 'tool', 'date', 'prompt', 'made by', 'licence', 'approved by'];
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
/** Text hashed with LF line ends: a Windows checkout may have CRLF (the same rule as scripts/build-icons.js). */
const shaText = (b: Buffer | string) => sha(Buffer.from(String(b).replace(/\r\n/g, '\n')));
const lines = (s: string) => s.split(/\r?\n/);

/** The rows of the provenance table: file name (from backticks) -> its cells. */
export function assetRows(md: string): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  for (const line of lines(md)) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    const m = /^`([^`]+)`$/.exec(cells[0] || '');
    if (!m) continue;
    assert.ok(!rows.has(m[1]), 'one row per file: ' + m[1]);
    rows.set(m[1], cells);
  }
  return rows;
}

/** Everything wrong with the files of build/logo (name -> text), the palette names the stylesheet defines and the ASSETS.md text, as sentences. */
export function problems(svgs: Map<string, string>, palettes: string[], md: string): string[] {
  const out: string[] = [];
  const rows = assetRows(md);
  if (!COLUMNS.every((c) => md.toLowerCase().includes('| ' + c + ' |') || md.toLowerCase().includes('| ' + c + ' ')) ) out.push('ASSETS.md: the table header must name ' + COLUMNS.join(', '));
  const need = [...svgs.keys(), ...palettes.map((p) => 'palette:' + p)];
  for (const name of need) {
    const row = rows.get(name);
    if (!row) { out.push(`${name}: no row in ASSETS.md`); continue; }
    if (row.length < COLUMNS.length) out.push(`${name}: its ASSETS.md row has ${row.length} cells, needs ${COLUMNS.length}`);
    row.forEach((cell, i) => { if (!cell) out.push(`${name}: ASSETS.md cell "${COLUMNS[i] || i}" is empty`); });
  }
  for (const [name, row] of rows) {
    if (!svgs.has(name) && !name.startsWith('palette:') && !name.startsWith('../')) out.push(`ASSETS.md: row for ${name}, which is not in the folder`);
    const world = (row[3] || '').toLowerCase(), by = row[9] || '';
    if (/^(cave|loft)$/.test(world) && !/\bPaco\b/.test(by)) out.push(`${name}: a ${world} row needs Paco in "approved by" (FR-062), has "${by}"`);
    if (/^(photo|base)$/.test(world) && !/\bVikram\b/.test(by)) out.push(`${name}: a ${world} row needs Vikram in "approved by" (FR-062), has "${by}"`);
    if (!/\d{4}-\d{2}-\d{2}/.test(by)) out.push(`${name}: "approved by" needs a date`);
    if (/^(palette|vector|painted)$/.test(row[2] || '') && !/^(photo|base|cave|loft)$/.test(world)) out.push(`${name}: world "${world}" is not a known world`);
  }
  for (const p of palettes) if (/^(cave|loft)$/.test(p) && !(rows.get('palette:' + p) || [])[9]) out.push(`palette ${p} in the stylesheet has no approved row`);
  return out;
}

/** Everything wrong with one drawing's text (FR-010..FR-012). */
export function svgProblems(name: string, svg: string): string[] {
  const out: string[] = [];
  const m = /^icon-(\d)(?:-(\d+))?\.svg$/.exec(name);
  const size = m ? (m[2] ? Number(m[2]) : 1024) : 0;
  const vb = /<svg\b[^>]*viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  if (!vb || Number(vb[1]) !== size || Number(vb[2]) !== size) out.push(`${name}: viewBox must be 0 0 ${size} ${size}`);
  for (const [re, what] of [[/<image\b/i, '<image>'], [/\bhref\s*=/i, 'href'], [/data:/i, 'data:'], [/Gradient/i, 'a gradient'], [/<filter\b/i, '<filter>'], [/\bstroke/i, 'stroke'], [/<style\b/i, '<style>'], [/<script\b/i, '<script>'], [/<text\b/i, '<text>'], [/var\(/i, 'var()'], [/\son[a-z]+\s*=/i, 'an event handler'], [/<foreignObject\b/i, '<foreignObject>']] as [RegExp, string][]) {
    if (re.test(svg)) out.push(`${name}: contains ${what} (FR-010)`);
  }
  const shapes = svg.match(/<(?:rect|path|circle|ellipse|polygon)\b[^>]*\/>/g) || [];
  if (shapes.length < 5) out.push(`${name}: only ${shapes.length} shapes`);
  for (const s of shapes) {
    const slot = /data-slot="([a-z]+)"/.exec(s);
    if (!slot || !M.SLOTS.includes(slot[1])) out.push(`${name}: a shape without a known data-slot: ${s.slice(0, 50)}`);
    if (!/\sfill="#[0-9A-Fa-f]{6}"/.test(s)) out.push(`${name}: a shape without a literal fill (FR-012): ${s.slice(0, 50)}`);
  }
  const tags = (svg.match(/<[a-zA-Z][^\s>/]*/g) || []).map((t) => t.slice(1));
  for (const t of tags) if (!['svg', 'title', 'rect', 'path', 'circle', 'ellipse', 'polygon'].includes(t)) out.push(`${name}: element <${t}> is not allowed`);
  return out;
}

// ---- the PNG, ICO and ICNS containers ----
const PNG_SIG = '89504e470d0a1a0a';
export function pngSize(b: Buffer): [number, number] {
  assert.ok(b.length > 33 && b.subarray(0, 8).toString('hex') === PNG_SIG && b.toString('latin1', 12, 16) === 'IHDR', 'a PNG');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}
export function icoEntries(b: Buffer): { size: number; png: Buffer }[] {
  assert.ok(b.readUInt16LE(0) === 0 && b.readUInt16LE(2) === 1, 'an ICO header');
  const n = b.readUInt16LE(4), out: { size: number; png: Buffer }[] = [];
  for (let i = 0; i < n; i++) {
    const d = 6 + 16 * i, len = b.readUInt32LE(d + 8), off = b.readUInt32LE(d + 12);
    assert.ok(off + len <= b.length, 'an ICO entry inside the file');
    const png = b.subarray(off, off + len), dim = b[d] || 256;
    assert.deepStrictEqual(pngSize(png), [dim, dim], `ICO entry ${i} is ${dim}x${dim}`);
    out.push({ size: dim, png });
  }
  return out;
}
export function icnsEntries(b: Buffer): { type: string; png: Buffer }[] {
  assert.strictEqual(b.toString('latin1', 0, 4), 'icns', 'an ICNS header');
  assert.strictEqual(b.readUInt32BE(4), b.length, 'the ICNS length field');
  const out: { type: string; png: Buffer }[] = [];
  for (let p = 8; p < b.length;) {
    const len = b.readUInt32BE(p + 4);
    assert.ok(len > 8 && p + len <= b.length, 'an ICNS entry inside the file');
    out.push({ type: b.toString('latin1', p, p + 4), png: b.subarray(p + 8, p + len) });
    p += len;
  }
  return out;
}

/** The palettes of logo.css: name -> slot -> colour, and the plate of each icon in the base palette. */
export function palettes(css: string): { base: Record<string, string>; plates: Record<string, string>; worlds: Record<string, Record<string, string>> } {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const decl = (body: string) => Object.fromEntries([...body.matchAll(/--logo-([a-z]+(?:-\d)?):(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]));
  const b = decl((/(?:^|\n)html\{([^}]*)\}/.exec(src) || [])[1] || '');
  const base: Record<string, string> = { ...b, plate: b['plate-1'] };
  const plates: Record<string, string> = {};
  for (const id of ['2', '3', '5']) plates[id] = b['plate-' + id];
  const worlds: Record<string, Record<string, string>> = {};
  for (const m of src.matchAll(/html\[data-world="([a-z]+)"\]\[data-world\]\{([^}]*)\}/g)) {
    const d = decl(m[2]);
    assert.ok(['plate-1', 'plate-2', 'plate-3', 'plate-5'].every((k) => d[k] === d['plate-1']), `world ${m[1]}: one plate for every icon`);
    worlds[m[1]] = { ...d, plate: d['plate-1'] };
  }
  return { base, plates, worlds };
}

/** FR-035: gold, bot and cream on the plate; eye on bot; cream on screen; at least 3:1 (WCAG non-text). */
export function contrastProblems(name: string, p: Record<string, string>): string[] {
  const out: string[] = [];
  for (const k of ['plate', 'gold', 'bot', 'eye', 'cream', 'screen']) if (!/^#[0-9A-Fa-f]{6}$/.test(p[k] || '')) out.push(`${name}: no ${k} colour`);
  if (out.length) return out;
  for (const [a, b] of [['gold', 'plate'], ['bot', 'plate'], ['cream', 'plate'], ['eye', 'bot'], ['cream', 'screen']]) {
    const c = contrast(p[a], p[b]);
    if (c < 3) out.push(`${name}: ${a} on ${b} is ${c.toFixed(2)}:1, needs 3:1 (FR-035)`);
  }
  return out;
}

// ---- the real files ----
const svgs = new Map<string, string>();
for (const id of M.IDS) for (const s of M.SIZES) { const f = M.fileName(id, s); svgs.set(f, fs.readFileSync(path.join(LOGO, f), 'utf8')); }
assert.strictEqual(svgs.size, 16, 'four icons at four sizes');
assert.deepStrictEqual(fs.readdirSync(LOGO).filter((f) => f.endsWith('.svg')).sort(), [...svgs.keys()].sort(), 'build/logo holds exactly those drawings');
for (const [n, t] of svgs) assert.deepStrictEqual(svgProblems(n, t), [], `${n} passes FR-010..FR-012`);

const css = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'logo.css'), 'utf8');
const pal = palettes(css);
assert.deepStrictEqual(Object.keys(pal.worlds).sort(), ['cave', 'loft', 'photo'], 'the worlds with a palette');
assert.deepStrictEqual(Object.keys(pal.plates).sort(), ['2', '3', '5'], 'a plate per icon (icon 1 is the default)');
const real = problems(svgs, ['base', ...Object.keys(pal.worlds)], fs.readFileSync(path.join(LOGO, 'ASSETS.md'), 'utf8'));
assert.deepStrictEqual(real, [], 'provenance and approval: ' + real.join('; '));

// FR-014: the slot colours in the drawings are the base palette
for (const [n, t] of svgs) {
  const id = /^icon-(\d)/.exec(n)![1];
  const want: Record<string, string> = { gold: pal.base.gold, bot: pal.base.bot, eye: pal.base.eye, cream: pal.base.cream, screen: pal.base.screen, plate: id === '1' ? pal.base.plate : pal.plates[id], badge: id === '1' ? pal.base.plate : pal.plates[id] };
  for (const m of t.matchAll(/data-slot="([a-z]+)" fill="(#[0-9A-Fa-f]{6})"/g)) assert.strictEqual(m[2].toUpperCase(), want[m[1]].toUpperCase(), `${n}: slot ${m[1]} is the base palette's ${want[m[1]]}`);
}
// FR-035: every palette passes contrast, the base one on every icon's plate
for (const id of M.IDS) assert.deepStrictEqual(contrastProblems('base icon ' + id, { ...pal.base, plate: id === '1' ? pal.base.plate : pal.plates[id] }), [], `base palette, icon ${id}`);
for (const [w, p] of Object.entries(pal.worlds)) assert.deepStrictEqual(contrastProblems(w, p), [], `${w} palette`);

// FR-070, FR-020: the renderer's copy is the drawings; the inline top-bar icon of index.html is icon 1; at most 24 KB of JS
const marksPath = path.join(ROOT, 'src', 'renderer', 'logo-marks.js');
const marks = fs.readFileSync(marksPath, 'utf8');
assert.strictEqual(marks.replace(/\r\n/g, '\n'), M.marksSource((f) => fs.readFileSync(path.join(LOGO, f), 'utf8')), 'src/renderer/logo-marks.js is made from build/logo (run npm run icons:build)');
assert.ok(Buffer.byteLength(marks) <= 24 * 1024, 'all drawings together are at most 24 KB of renderer JS');
{
  const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
  const inline = /<div class="brand-mark" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 20 20" data-logo-id="1"[^>]*>(.*?)<\/svg><\/div>/s.exec(html);
  assert.ok(inline, 'index.html keeps icon 1 inline in the top bar (FR-022)');
  assert.strictEqual(inline![1], M.innerShapes(svgs.get('icon-1-20.svg')!), 'the inline top-bar icon is icon-1-20.svg');
  assert.ok(!/<img\b/.test(inline![0]), 'no <img> in the tile (FR-030)');
  assert.ok(html.indexOf('logo-marks.js') > 0 && html.indexOf('logo-marks.js') < html.indexOf('theme.js"'), 'logo-marks.js loads before theme.js');
  assert.ok(html.includes('logo.css'), 'index.html links logo.css');
}

// FR-040..FR-044: the build files
const rec = JSON.parse(fs.readFileSync(path.join(LOGO, 'icons.json'), 'utf8')) as { sources: Record<string, string>; outputs: Record<string, string>; renderer: Record<string, string> };
for (const f of svgs.keys()) assert.strictEqual(rec.sources['build/logo/' + f], shaText(fs.readFileSync(path.join(LOGO, f), 'utf8')), `${f} changed since the last icons:build (run npm run icons:build)`);
assert.strictEqual(Object.keys(rec.sources).length, 16, 'icons.json lists every source');
for (const [rel, h] of Object.entries(rec.outputs)) assert.strictEqual(rel.endsWith('.svg') ? shaText(fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8')) : sha(fs.readFileSync(path.join(ROOT, ...rel.split('/')))), h, `${rel} is the recorded output`);
assert.strictEqual(rec.renderer['src/renderer/logo-marks.js'], shaText(marks), 'logo-marks.js is the recorded output');
assert.strictEqual(fs.readFileSync(path.join(ROOT, 'build', 'icon.svg'), 'utf8').replace(/\r\n/g, '\n'), svgs.get('icon-1.svg')!.replace(/\r\n/g, '\n'), 'build/icon.svg is icon 1');
assert.deepStrictEqual(pngSize(fs.readFileSync(path.join(ROOT, 'build', 'icon.png'))), [1024, 1024], 'icon.png is 1024');
assert.ok(!fs.existsSync(path.join(ROOT, 'build', 'icon-16.svg')), 'build/icon-16.svg is gone (FR-044)');
{
  const ico = icoEntries(fs.readFileSync(path.join(ROOT, 'build', 'icon.ico')));
  assert.deepStrictEqual(ico.map((e) => e.size), B.ICO.map((e) => e[0]), 'icon.ico has the sizes of FR-041');
  const icns = icnsEntries(fs.readFileSync(path.join(ROOT, 'build', 'icon.icns')));
  assert.deepStrictEqual(icns.map((e) => e.type), B.ICNS.map((e) => e[0] as string), 'icon.icns has the types of FR-041');
  for (const [i, e] of icns.entries()) assert.deepStrictEqual(pngSize(e.png), [B.ICNS[i][1], B.ICNS[i][1]] as [number, number], `icns ${e.type} is ${B.ICNS[i][1]} px`);
  // the entries are different pictures, so a script that wrote one size everywhere is caught
  assert.ok(new Set(ico.map((e) => sha(e.png))).size === ico.length, 'every ICO entry is its own picture');
}
// no reader of the old file is left
for (const rel of ['scripts', 'src', 'package.json', 'README.md']) {
  const walk = (p: string): string[] => fs.statSync(p).isDirectory() ? fs.readdirSync(p).flatMap((f) => (f === 'node_modules' || f === 'dist' ? [] : walk(path.join(p, f)))) : [p];
  for (const f of walk(path.join(ROOT, rel))) {
    if (/test-logo-assets\.ts$/.test(f) || !/\.(js|ts|json|md|html|css|yml)$/.test(f)) continue;
    assert.ok(!/build[\\/]icon-16\.svg/.test(fs.readFileSync(f, 'utf8')), `${path.relative(ROOT, f)} still names build/icon-16.svg`);
  }
}

// FR-037: the running icon never follows the choice: nothing in src sets a Dock, window or overlay icon after start-up
{
  const walk = (p: string): string[] => fs.statSync(p).isDirectory() ? fs.readdirSync(p).flatMap((f) => walk(path.join(p, f))) : [p];
  const srcFiles = walk(path.join(ROOT, 'src')).filter((f) => /\.(ts|js)$/.test(f));
  assert.ok(srcFiles.length > 50, 'the scan sees the source files');
  for (const f of srcFiles) assert.ok(!/\b(setIcon|setOverlayIcon)\s*\(/.test(fs.readFileSync(f, 'utf8')), `${path.relative(ROOT, f)} sets a window, Dock or overlay icon (FR-037)`);
  assert.ok(!/DurbarLogo/.test(fs.readFileSync(path.join(ROOT, 'src', 'main', 'main.ts'), 'utf8')), 'main does not read the logo choice');
}

// ---- the check itself: each rule goes red on its broken case ----
{
  const good = svgs.get('icon-1-20.svg')!;
  assert.deepStrictEqual(svgProblems('icon-1-20.svg', good), [], 'a good drawing');
  const bad = (t: string, re: RegExp, why: string) => assert.ok(svgProblems('icon-1-20.svg', t).some((p) => re.test(p)), why);
  bad(good.replace('<title>', '<image href="x.png"/><title>'), /<image>/, 'an <image> fails');
  bad(good.replace('</svg>', '<style>a{}</style></svg>'), /<style>/, 'a <style> fails');
  bad(good.replace('fill="#FFC21A"', 'fill="#FFC21A" stroke="red"'), /stroke/, 'a stroke fails');
  bad(good.replace('data-slot="bot"', 'data-slot="pink"'), /known data-slot/, 'an unknown slot fails');
  bad(good.replace(' fill="#C2DEFF"', ''), /literal fill/, 'a shape with no fill fails');
  bad(good.replace('viewBox="0 0 20 20"', 'viewBox="0 0 32 32"'), /viewBox/, 'a wrong viewBox fails');
  bad(good.replace('<title>', '<linearGradient id="g"/><title>'), /gradient/, 'a gradient fails');
  const md = fs.readFileSync(path.join(LOGO, 'ASSETS.md'), 'utf8');
  const one = new Map([['icon-1-20.svg', good]]);
  const head = '| file | icon | form | world | tool | date | prompt | made by | licence | approved by |\n|---|---|---|---|---|---|---|---|---|---|\n';
  const row = (f: string, world: string, by: string) => `| \`${f}\` | 1 | vector | ${world} | t | 2026-11-01 | p | me | MIT | ${by} |\n`;
  assert.deepStrictEqual(problems(one, [], head + row('icon-1-20.svg', 'base', 'Vikram, 2026-10-31')), [], 'a good row');
  assert.ok(problems(one, [], head).some((p) => /no row/.test(p)), 'a file with no row fails');
  assert.ok(problems(new Map(), [], head + row('icon-1-20.svg', 'base', 'Vikram, 2026-10-31')).some((p) => /not in the folder/.test(p)), 'a row with no file fails');
  assert.ok(problems(one, ['cave'], head + row('icon-1-20.svg', 'base', 'Vikram, 2026-10-31') + row('palette:cave', 'cave', 'Vikram, 2026-10-31')).some((p) => /needs Paco/.test(p)), 'a cave row without Paco fails');
  assert.ok(problems(one, ['loft'], head + row('icon-1-20.svg', 'base', 'Vikram, 2026-10-31') + row('palette:loft', 'loft', 'pending')).some((p) => /needs Paco|needs a date/.test(p)), 'a loft row with "pending" fails');
  assert.ok(problems(one, ['cave'], head + row('icon-1-20.svg', 'base', 'Vikram, 2026-10-31')).some((p) => /palette:cave: no row/.test(p)), 'a cave palette in the stylesheet with no row fails');
  assert.ok(problems(one, [], head + row('icon-1-20.svg', 'photo', 'Paco, 2026-11-01')).some((p) => /needs Vikram/.test(p)), 'a photo row without Vikram fails');
  assert.ok(problems(one, [], head + row('icon-1-20.svg', 'base', 'Vikram')).some((p) => /needs a date/.test(p)), 'an approval with no date fails');
  assert.ok(md.includes('Paco, 2026-11-01'), 'sanity: the real file records Paco');
  // contrast: a pair under 3:1 fails
  assert.ok(contrastProblems('x', { ...pal.base, gold: '#10141F' }).some((p) => /gold on plate/.test(p)), 'low contrast fails');
  assert.ok(contrastProblems('x', { ...pal.base, bot: '#10141F' }).some((p) => /bot on plate/.test(p)), 'bot on plate is checked');
  assert.ok(contrastProblems('x', { ...pal.base, eye: '#C3DFFF' }).some((p) => /eye on bot/.test(p)), 'eye on bot is checked');
  assert.ok(contrastProblems('x', { ...pal.base, screen: '#FBF6EF' }).some((p) => /cream on screen/.test(p)), 'cream on screen is checked');
  assert.ok(contrastProblems('x', { gold: '#FFFFFF' }).some((p) => /no plate/.test(p)), 'a missing colour fails');
  // containers: a truncated or wrong-size entry is refused
  const ico = fs.readFileSync(path.join(ROOT, 'build', 'icon.ico'));
  assert.throws(() => icoEntries(ico.subarray(0, 100)), 'a truncated ICO fails');
  const wrong = Buffer.from(ico); wrong[6] = wrong[6] === 16 ? 17 : 16;
  assert.throws(() => icoEntries(wrong), 'an ICO entry whose size field lies fails');
  const icns = fs.readFileSync(path.join(ROOT, 'build', 'icon.icns'));
  assert.throws(() => icnsEntries(icns.subarray(0, icns.length - 1)), 'a truncated ICNS fails');
  // the writers round-trip
  const rt = icoEntries(B.writeIco(icoEntries(ico)));
  assert.strictEqual(rt.length, 7, 'writeIco round-trips');
  assert.strictEqual(icnsEntries(B.writeIcns(icnsEntries(icns))).length, 10, 'writeIcns round-trips');
  // the renderer copy follows the drawing: a changed drawing changes it
  const changed = M.marksSource((f) => (f === 'icon-1-20.svg' ? good.replace('x="2" y="16"', 'x="3" y="16"') : fs.readFileSync(path.join(LOGO, f), 'utf8')));
  assert.notStrictEqual(changed, marks.replace(/\r\n/g, '\n'), 'a changed drawing changes logo-marks.js');
}
console.log('logo assets test passed (' + svgs.size + ' drawings, ' + Object.keys(pal.worlds).length + ' world palettes)');
