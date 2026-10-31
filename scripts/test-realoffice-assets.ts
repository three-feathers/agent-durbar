/** Real office art pack (spec 097 T010, T011, T012, T023, T024; FR-060..FR-069, SC-006): every shipped picture is a WebP with alpha
 *  and no metadata chunk, within its cap; the pack is at most 10 MB; people.json lists exactly the pictures there are, with numbers in
 *  range; ASSETS.md has one complete section per source sheet, and every person sheet carries the fictional-people clause and a
 *  likeness-check; the build ships the pictures and people.js, never ASSETS.md; the CSP is unchanged. `npm run test:realoffice-assets`.
 *  Plain Node, no DOM, no credits. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { webpInfo } from './webpinfo';

process.exitCode = 1;
const ROOT = (() => { let d = __dirname; while (!fs.existsSync(path.join(d, 'package.json'))) d = path.dirname(d); return d; })();
const DIR = path.join(ROOT, 'src', 'renderer', 'realoffice', 'art');

/** FR-062 caps, in bytes, by kind of picture */
export const CAPS = { person: 80 * 1024, fixture: 120 * 1024, desk: 60 * 1024, floor: 40 * 1024, total: 10 * 1024 * 1024 };
export const PERSON_MAX_H = 640;
const KEYS = ['files', 'source', 'tool', 'date', 'made by', 'approved by', 'reference', 'prompt', 'cut', 'licence'];
const CLAUSE = /fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named/;
const kindOf = (f: string): keyof typeof CAPS | null => /^p\d\d-\w+\.webp$/.test(f) ? 'person' : /^fx-[a-z]+\.webp$/.test(f) ? 'fixture' : f === 'desk.webp' ? 'desk' : f === 'floor.webp' ? 'floor' : null;

/** ASSETS.md: one section per source sheet (`### name`), each a list of `- key: value` lines */
export function sections(md: string): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  let cur: Record<string, string> | null = null;
  for (const line of md.split(/\r?\n/)) {
    const h = /^### (\S+)\s*$/.exec(line);
    if (h) { assert.ok(!out.has(h[1]), 'one section per sheet: ' + h[1]); cur = {}; out.set(h[1], cur); continue; }
    if (/^## /.test(line)) { cur = null; continue; }
    const kv = /^- ([a-z][a-z -]*): (.*)$/.exec(line);
    if (cur && kv) cur[kv[1]] = kv[2].trim();
  }
  return out;
}

/** FR-068: the removal records (`## Removed`): each needs a date, who reported and the replacement */
export function removals(md: string): string[] {
  const m = /\n## Removed\s*\n([\s\S]*?)(?:\n## |$)/.exec(md);
  if (!m) return ['ASSETS.md has no "## Removed" section'];
  const out: string[] = [];
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.startsWith('- ')) continue;
    if (!/removed \d{4}-\d{2}-\d{2}/.test(line) || !/reported by \S/.test(line) || !/replaced by `?[\w.-]+\.webp/.test(line)) out.push('a removal record needs "removed <date>", "reported by <who>" and "replaced by <picture>": ' + line.slice(0, 80));
  }
  return out;
}

/** Everything wrong with a pack (pictures, people.json text, ASSETS.md text), as sentences (empty = fine). */
export function problems(files: Map<string, Buffer>, peopleJson: string, md: string): string[] {
  const out: string[] = [];
  let total = 0;
  const listed = new Map<string, string>();
  const secs = sections(md);
  for (const [name, s] of secs) {
    for (const k of KEYS) if (!s[k]) out.push(`ASSETS.md ${name}: no "${k}"`);
    if (s.licence && !/^MIT\b/.test(s.licence)) out.push(`ASSETS.md ${name}: licence is not MIT`);
    if (s.date && !/^\d{4}-\d{2}-\d{2}$/.test(s.date)) out.push(`ASSETS.md ${name}: date is not YYYY-MM-DD`);
    const person = /^(seat|stand|stand2)-p\d\d$/.test(name);
    if (person) {
      if (!CLAUSE.test(s.fictional || '')) out.push(`ASSETS.md ${name}: no fictional-people clause (FR-067)`);
      const lc = s['likeness-check'] || '';
      if (!/^(?:[A-Z][\w .'-]*[\w.], \d{4}-\d{2}-\d{2}(?: \d{2}:\d{2} UTC)?(?: \([^()]+\))?|pending \([A-Z][\w .'-]*\))$/.test(lc)) out.push(`ASSETS.md ${name}: likeness-check must be "<approver>, <YYYY-MM-DD>[ HH:MM UTC][ (note)]" or "pending (<approver>)", got "${lc}" (FR-068)`);
      if (/\b(?:celebrity|famous|actor|actress|singer|politician) (?:named|called)\b/i.test(s.prompt || '')) out.push(`ASSETS.md ${name}: the prompt names a real person`);
    }
    for (const f of (s.files || '').split(/\s+/).filter(Boolean)) { if (listed.has(f)) out.push(`ASSETS.md: ${f} in ${listed.get(f)} and ${name}`); listed.set(f, name); }
  }
  out.push(...removals(md));
  for (const [name, buf] of files) {
    total += buf.length;
    const kind = kindOf(name);
    if (!kind) { out.push(`${name}: not a known kind of picture`); continue; }
    if (!listed.has(name)) out.push(`${name}: no section of ASSETS.md lists it`);
    if (buf.length > CAPS[kind]) out.push(`${name}: ${buf.length} bytes, over the ${kind} cap ${CAPS[kind]}`);
    let info;
    try { info = webpInfo(buf); } catch (e) { out.push(`${name}: not a WebP file`); continue; }
    for (const c of info.chunks) if (!['VP8 ', 'VP8L', 'VP8X', 'ALPH'].includes(c)) out.push(`${name}: metadata or unexpected chunk "${c}" (strip EXIF, XMP, ICC and C2PA)`);
    if (kind !== 'floor' && !info.chunks.includes('ALPH') && !info.chunks.includes('VP8L')) out.push(`${name}: no alpha channel`);
    if (kind === 'person' && info.height > PERSON_MAX_H) out.push(`${name}: ${info.height} px tall, over ${PERSON_MAX_H}`);
  }
  for (const f of listed.keys()) if (!files.has(f)) out.push(`ASSETS.md lists ${f}, which is not in the folder`);
  if (total > CAPS.total) out.push(`the pack is ${total} bytes, over ${CAPS.total}`);
  // FR-066: people.json
  let meta: { seat?: Record<string, Record<string, number>>; stand?: Record<string, { figH: number; poses: Record<string, number[]> }>; fixtures?: Record<string, number[]>; fixtureTop?: Record<string, number>; floorLine?: number; desk?: number[] } = {};
  try { meta = JSON.parse(peopleJson); } catch (e) { out.push('people.json is not JSON'); return out; }
  const want = new Set<string>();
  for (const [pid, m] of Object.entries(meta.seat || {})) {
    for (const p of ['typeA', 'typeB', 'waveA', 'waveB', 'think', 'rest']) want.add(`${pid}-${p}.webp`);
    const ok = m.w > 100 && m.w < 2000 && m.h > 100 && m.h < 2000 && m.headTop >= 0 && m.headTop < m.h && m.bodyH > 100 && m.headTop + m.bodyH <= m.h + 1 && m.hand > 0.3 && m.hand < 1.2;
    if (!ok) out.push(`people.json seat ${pid}: numbers out of range ${JSON.stringify(m)}`);
    const info = files.has(`${pid}-typeA.webp`) ? webpInfo(files.get(`${pid}-typeA.webp`) as Buffer) : null;
    if (info && Math.abs(info.width / info.height - m.w / m.h) > 0.02) out.push(`people.json seat ${pid}: ${m.w}x${m.h} does not match the picture's shape ${info.width}x${info.height}`);
  }
  for (const [pid, m] of Object.entries(meta.stand || {})) {
    if (!(m.figH > 100 && m.figH < 3000)) out.push(`people.json stand ${pid}: figH out of range`);
    for (const [p, wh] of Object.entries(m.poses || {})) {
      want.add(`${pid}-${p}.webp`);
      if (!Array.isArray(wh) || wh.length !== 2 || !(wh[0] > 50 && wh[1] > 100 && wh[1] < 2 * m.figH)) out.push(`people.json stand ${pid} ${p}: size out of range`);
      const ft = (m as { feet?: Record<string, number> }).feet, tp = (m as { top?: Record<string, number> }).top;
      if (!ft || !(ft[p] > 0.8 && ft[p] <= 1) || !tp || !(tp[p] >= 0 && tp[p] < 0.2)) out.push(`people.json stand ${pid} ${p}: no measured feet/top line in range (owner 2026-10-31 10:19)`);
    }
  }
  for (const [id, wh] of Object.entries(meta.fixtures || {})) {
    want.add(`fx-${id}.webp`);
    if (!Array.isArray(wh) || wh[1] !== meta.floorLine) out.push(`people.json fixture ${id}: not at the common height ${meta.floorLine} (FR-023)`);
    if (!meta.fixtureTop || !(meta.fixtureTop[id] >= 0 && meta.fixtureTop[id] < (meta.floorLine || 0))) out.push(`people.json fixture ${id}: no fixtureTop in range`);
  }
  want.add('desk.webp'); want.add('floor.webp');
  for (const f of want) if (!files.has(f)) out.push(`people.json names ${f}, which is not in the folder`);
  for (const f of files.keys()) if (!want.has(f)) out.push(`${f}: people.json does not name it`);
  return out;
}

// ---- the real pack ----
const files = new Map<string, Buffer>();
for (const f of fs.readdirSync(DIR)) if (f.endsWith('.webp')) files.set(f, fs.readFileSync(path.join(DIR, f)));
const md = fs.readFileSync(path.join(DIR, 'ASSETS.md'), 'utf8');
const pj = fs.readFileSync(path.join(DIR, 'people.json'), 'utf8');
for (const f of fs.readdirSync(DIR)) assert.ok(f.endsWith('.webp') || f === 'people.json' || f === 'ASSETS.md', 'only pictures, people.json and ASSETS.md in the folder: ' + f);
const real = problems(files, pj, md);
assert.deepStrictEqual(real, [], 'the shipped pack passes: ' + real.slice(0, 10).join('; '));
const total = [...files.values()].reduce((s, b) => s + b.length, 0);
const META = JSON.parse(pj);
assert.strictEqual(Object.keys(META.seat).length, 15, '15 seated people (the Office people)');
assert.ok(Object.values(META.stand as Record<string, { poses: object }>).every((s) => ['book', 'coffee', 'letter', 'knock'].every((p) => p in s.poses) && !('tread' in s.poses)), 'every person has the four standing poses, and no treadmill (owner 2026-10-31 11:22)');
const pending = [...sections(md)].filter(([, s]) => /^pending/.test(s['likeness-check'] || '')).map(([n]) => n);
assert.deepStrictEqual(pending, [], 'every Office person has its likeness check on record (Vikram, 2026-10-31 10:46 UTC; FR-068)');

// ---- the check itself: each rule fails on its broken case ----
{
  const good = files.get('p01-typeA.webp') as Buffer;
  const one = (name: string, buf: Buffer): Map<string, Buffer> => new Map([[name, buf]]);
  const sec = (name: string, f: string, extra = ''): string => `### ${name}\n- files: ${f}\n- source: s\n- tool: t\n- date: 2026-10-31\n- made by: m\n- approved by: Vikram, 2026-10-31\n- reference: none\n- prompt: a person\n- cut: c\n- licence: MIT\n${extra}\n## Removed\n\nNone.\n`;
  const person = '- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named.\n- likeness-check: Vikram, 2026-10-31\n';
  const pj1 = JSON.stringify({ seat: {}, stand: { p01: { figH: 700, poses: { book: [300, 700] }, feet: { book: 0.97 }, top: { book: 0 } } }, fixtures: {}, floorLine: 276, fixtureTop: {} });
  const only = (p: string[]): string[] => p.filter((x) => !/desk.webp|floor.webp/.test(x)); /* the minimal case has no desk and floor */
  const okMd = sec('stand-p01', 'p01-book.webp', person);
  const book = files.get('p01-book.webp') as Buffer;
  assert.deepStrictEqual(only(problems(one('p01-book.webp', book), pj1, okMd)), [], 'a good person sheet passes');
  assert.ok(only(problems(one('p01-book.webp', book), pj1.replace('"feet":{"book":0.97},', ''), okMd)).some((p) => /feet\/top/.test(p)), 'red: a standing picture without its measured foot line');
  assert.ok(only(problems(one('p01-book.webp', book), pj1, okMd.replace(/- fictional:.*\n/, ''))).some((p) => /fictional/.test(p)), 'red: a person sheet without the clause');
  assert.ok(only(problems(one('p01-book.webp', book), pj1, okMd.replace(/- likeness-check:.*\n/, ''))).some((p) => /likeness-check/.test(p)), 'red: without the likeness-check field');
  assert.ok(only(problems(one('p01-book.webp', book), pj1, okMd.replace('likeness-check: Vikram, 2026-10-31', 'likeness-check: , 2026-10-31'))).some((p) => /likeness-check/.test(p)), 'red: an empty approver');
  assert.ok(only(problems(one('p01-book.webp', book), pj1, okMd.replace('likeness-check: Vikram, 2026-10-31', 'likeness-check: Vikram, yesterday'))).some((p) => /likeness-check/.test(p)), 'red: not a date');
  assert.deepStrictEqual(only(problems(one('p01-book.webp', book), pj1, okMd.replace('likeness-check: Vikram, 2026-10-31', 'likeness-check: pending (Vikram)'))), [], 'a pending check is allowed in the repo for a new sheet (a release waits for it)');
  assert.deepStrictEqual(only(problems(one('p01-book.webp', book), pj1, okMd.replace('likeness-check: Vikram, 2026-10-31', 'likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet reviewed)'))), [], 'a time and a note after the date pass');
  assert.ok(only(problems(one('p01-book.webp', book), pj1, okMd.replace('likeness-check: Vikram, 2026-10-31', 'likeness-check: Vikram, 2026-10-31 maybe'))).some((p) => /likeness-check/.test(p)), 'red: free text after the date');
  assert.ok(only(problems(one('p01-book.webp', book), pj1, okMd.replace('None.', '- p01-book.webp: removed 2026-11-02, reported by Paco'))).some((p) => /removal record/.test(p)), 'red: a removal record without its replacement');
  assert.deepStrictEqual(only(problems(one('p01-book.webp', book), pj1, okMd.replace('None.', '- p01-old.webp: removed 2026-11-02, reported by Paco, replaced by `p01-book.webp`'))), [], 'a complete removal record passes');
  // EXIF chunk appended (RIFF size fixed up)
  const exif = Buffer.concat([Buffer.from('EXIF'), Buffer.from([4, 0, 0, 0]), Buffer.from('abcd')]);
  const withMeta = Buffer.concat([book, exif]); withMeta.writeUInt32LE(withMeta.length - 8, 4);
  assert.ok(only(problems(one('p01-book.webp', withMeta), pj1, okMd)).some((p) => /chunk "EXIF"/.test(p)), 'red: a picture with EXIF');
  assert.ok(only(problems(one('p01-book.webp', Buffer.concat([book, Buffer.alloc(90 * 1024)])), pj1, okMd)).some((p) => /over the person cap/.test(p)), 'red: a 90 KB person frame');
  assert.ok(only(problems(new Map([['p01-book.webp', book], ['p01-extra.webp', good]]), pj1, okMd)).some((p) => /p01-extra.webp: no section/.test(p)), 'red: an unlisted file');
  assert.ok(only(problems(new Map([['p01-book.webp', book], ['p01-extra.webp', good]]), pj1, okMd)).some((p) => /people.json does not name it/.test(p)), 'red: a file people.json does not know');
  assert.ok(only(problems(new Map(), pj1, okMd)).some((p) => /not in the folder/.test(p)), 'red: a listed file that is missing');
  assert.ok(only(problems(one('p01-book.webp', book), pj1, okMd.replace('- licence: MIT\n', ''))).some((p) => /no "licence"/.test(p)), 'red: a section without its licence');
  assert.ok(only(problems(one('p01-book.webp', book), JSON.stringify({ seat: {}, stand: { p01: { figH: 700, poses: { book: [300, 9999] } } }, fixtures: {}, floorLine: 276 }), okMd)).some((p) => /size out of range/.test(p)), 'red: people.json numbers out of range');
  assert.ok(problems(one('p01-book.webp', Buffer.from('not an image at all, just some text')), pj1, okMd).some((p) => /not a WebP/.test(p)), 'red: not a picture');
  const big = new Map(files); big.set('p01-typeA.webp', Buffer.concat([good, Buffer.alloc(CAPS.total)]));
  assert.ok(problems(big, pj, md).some((p) => /over 10485760/.test(p)), 'red: a pack over 10 MB');
}

// ---- packaging (FR-060, FR-061, T012): the build ships the pictures and people.js, never ASSETS.md; the CSP is unchanged ----
const copy = fs.readFileSync(path.join(ROOT, 'scripts', 'copy-assets.js'), 'utf8');
assert.ok(/'realoffice', 'art'/.test(copy), 'copy-assets.js copies realoffice/art');
const OUT = path.join(ROOT, 'dist', 'renderer', 'realoffice', 'art');
if (fs.existsSync(path.join(ROOT, 'dist', 'renderer', 'index.html'))) {
  assert.deepStrictEqual(fs.readdirSync(OUT).sort(), [...files.keys(), 'people.js'].sort(), 'dist holds exactly the pictures and people.js: no ASSETS.md, no people.json');
  const js = fs.readFileSync(path.join(OUT, 'people.js'), 'utf8');
  const m = /self\.DurbarRealOfficeArt=(\{.*\});\s*$/.exec(js);
  assert.ok(m, 'people.js sets self.DurbarRealOfficeArt');
  assert.deepStrictEqual(JSON.parse((m as RegExpExecArray)[1]), META, 'people.js carries people.json unchanged');
  for (const f of ['realoffice.js', 'realoffice.css', 'realoffice-world.css']) assert.ok(fs.existsSync(path.join(ROOT, 'dist', 'renderer', f)), f + ' is built');
}
const index = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
const csp = /Content-Security-Policy" content="([^"]*)"/.exec(index);
assert.strictEqual(csp && csp[1], "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;", 'the CSP is unchanged (FR-060)');
assert.ok(!/realoffice/.test(index), 'index.html does not load Real office (FR-061: only on first use)');
console.log(`realoffice assets tests passed (${files.size} pictures, ${(total / 1024 / 1024).toFixed(2)} MB)`);
process.exitCode = 0;
