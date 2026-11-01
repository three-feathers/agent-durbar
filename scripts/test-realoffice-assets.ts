/** Real office art pack (spec 097 T010, T011, T012, T023, T024; FR-060..FR-069, SC-006): every shipped picture is a WebP with alpha
 *  and no metadata chunk, within its cap; the pack is at most 10 MB; people.json lists exactly the pictures there are, with numbers in
 *  range; ASSETS.md has one complete section per source sheet, and every person sheet carries the fictional-people clause and a
 *  likeness-check; the build ships the pictures and people.js, never ASSETS.md; the CSP is unchanged. `npm run test:realoffice-assets`.
 *  Plain Node, no DOM, no credits. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { webpInfo } from './webpinfo';
import { ARRANGEMENTS, CABINETS, FACE_FLOOR, FACE_GRID, cabGrid } from '../src/shared/realoffice-arrangements';

process.exitCode = 1;
const ROOT = (() => { let d = __dirname; while (!fs.existsSync(path.join(d, 'package.json'))) d = path.dirname(d); return d; })();
const RO = path.join(ROOT, 'src', 'renderer', 'realoffice');

/** FR-062 caps, in bytes, by kind of picture */
export const CAPS = { person: 80 * 1024, fixture: 120 * 1024, desk: 60 * 1024, floor: 40 * 1024, wall: 120 * 1024, monitor: 30 * 1024, glow: 20 * 1024, total: 10 * 1024 * 1024 };
/** spec 102 FR-213: all shipped art (every world and every set) at most this many bytes */
export const SHIPPED_MAX = 30 * 1024 * 1024;
export const PERSON_MAX_H = 640;
const KEYS = ['files', 'source', 'tool', 'date', 'made by', 'approved by', 'reference', 'prompt', 'cut', 'licence'];
const CLAUSE = /fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named/;
const kindOf = (f: string): keyof typeof CAPS | null => /^fx-[a-z]+\.webp$/.test(f) ? 'fixture' : /^p\d\d-[\w-]+\.webp$/.test(f) || /^[a-z][a-z0-9]*-\w+\.webp$/.test(f) ? 'person' : f === 'desk.webp' ? 'desk' : /^floor(-night)?\.webp$/.test(f) ? 'floor' : /^wall(-night)?\.webp$/.test(f) ? 'wall' : /^monitor(-[a-z]+)?\.webp$/.test(f) ? 'monitor' : f === 'glow.webp' ? 'glow' : null;

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
  let total = 0, pixelArt = false;
  try { pixelArt = (JSON.parse(peopleJson) as { pixelArt?: unknown }).pixelArt === true; } catch (e) { /* reported below */ }
  const listed = new Map<string, string>();
  const secs = sections(md);
  for (const [name, s] of secs) {
    for (const k of KEYS) if (!s[k]) out.push(`ASSETS.md ${name}: no "${k}"`);
    if (s.licence && !/^MIT\b/.test(s.licence)) out.push(`ASSETS.md ${name}: licence is not MIT`);
    if (s.date && !/^\d{4}-\d{2}-\d{2}$/.test(s.date)) out.push(`ASSETS.md ${name}: date is not YYYY-MM-DD`);
    const person = /^(seat|stand|stand2|run|set|facing)-[a-z0-9]+$/.test(name);
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
    /* spec 102 FR-254, SC-025: a pixel-art picture is lossless (VP8L), one file pixel per grid pixel, and never animated */
    if (pixelArt && !(info.chunks.includes('VP8L') && !info.chunks.includes('VP8 ') && !info.chunks.includes('ALPH'))) out.push(`${name}: a pixel-art picture must be lossless (VP8L only)`);
    if (kind !== 'floor' && kind !== 'wall' && !info.chunks.includes('ALPH') && !info.chunks.includes('VP8L')) out.push(`${name}: no alpha channel`);
    if (kind === 'monitor' && info.height > 300) out.push(`${name}: ${info.height} px tall, over 300 (spec 102 FR-220)`);
    if (kind === 'person' && info.height > PERSON_MAX_H) out.push(`${name}: ${info.height} px tall, over ${PERSON_MAX_H}`);
  }
  for (const f of listed.keys()) if (!files.has(f)) out.push(`ASSETS.md lists ${f}, which is not in the folder`);
  if (total > CAPS.total) out.push(`the pack is ${total} bytes, over ${CAPS.total}`);
  // FR-066: people.json
  let meta: { seat?: Record<string, Record<string, number>>; stand?: Record<string, { figH: number; poses: Record<string, number[]> }>; facing?: string; fixtures?: Record<string, number[]>; fixtureTop?: Record<string, number>; floorLine?: number; desk?: number[] } = {};
  try { meta = JSON.parse(peopleJson); } catch (e) { out.push('people.json is not JSON'); return out; }
  const want = new Set<string>();
  for (const [pid, m] of Object.entries(meta.seat || {})) {
    for (const p of ['typeA', 'typeB', 'waveA', 'waveB', 'think', 'rest']) want.add(`${pid}-${p}.webp`);
    const q = pixelArt ? 8 : 1; /* a pixel-art picture has one file pixel per grid pixel: its numbers are the shipped ones over 8 */
    const ok = m.w > 100 / q && m.w < 2000 / q && m.h > 100 / q && m.h < 2000 / q && m.headTop >= 0 && m.headTop < m.h && m.bodyH > 100 / q && m.headTop + m.bodyH <= m.h + 1 && m.hand > 0.3 && m.hand < 1.2;
    if (!ok) out.push(`people.json seat ${pid}: numbers out of range ${JSON.stringify(m)}`);
    const info = files.has(`${pid}-typeA.webp`) ? webpInfo(files.get(`${pid}-typeA.webp`) as Buffer) : null;
    if (info && Math.abs(info.width / info.height - m.w / m.h) > 0.02) out.push(`people.json seat ${pid}: ${m.w}x${m.h} does not match the picture's shape ${info.width}x${info.height}`);
  }
  for (const [pid, m] of Object.entries(meta.stand || {})) {
    const q = pixelArt ? 8 : 1;
    if (!(m.figH > 100 / q && m.figH < 3000 / q)) out.push(`people.json stand ${pid}: figH out of range`);
    for (const [p, wh] of Object.entries(m.poses || {})) {
      want.add(`${pid}-${p}.webp`);
      if (!Array.isArray(wh) || wh.length !== 2 || !(wh[0] > 50 / q && wh[1] > 100 / q && wh[1] < 2 * m.figH)) out.push(`people.json stand ${pid} ${p}: size out of range`);
      const ft = (m as { feet?: Record<string, number> }).feet, tp = (m as { top?: Record<string, number> }).top, fc = (m as { foot?: Record<string, number> }).foot;
      if (fc && !(fc[p] > 0.2 && fc[p] < 0.9)) out.push(`people.json stand ${pid} ${p}: foot centre out of range (spec 097 FR-191)`);
      if (!ft || !(ft[p] > 0.8 && ft[p] <= 1) || !tp || !(tp[p] >= 0 && tp[p] < 0.2)) out.push(`people.json stand ${pid} ${p}: no measured feet/top line in range (owner 2026-10-31 10:19)`);
    }
  }
  for (const [id, wh] of Object.entries(meta.fixtures || {})) {
    want.add(`fx-${id}.webp`);
    if (!Array.isArray(wh) || wh[1] !== meta.floorLine) out.push(`people.json fixture ${id}: not at the common height ${meta.floorLine} (FR-023)`);
    if (!meta.fixtureTop || !(meta.fixtureTop[id] >= 0 && meta.fixtureTop[id] < (meta.floorLine || 0))) out.push(`people.json fixture ${id}: no fixtureTop in range`);
  }
  want.add('desk.webp'); want.add('floor.webp');
  for (const [pid, parts] of Object.entries((meta as { rig?: Record<string, Record<string, unknown>> }).rig || {})) for (const key of Object.keys(parts)) want.add(`${pid}-rig${key}.webp`); /* spec Changes 2026-11-01 */
  for (const k of ['wall', 'monitor'] as const) { const v = (meta as Record<string, unknown>)[k]; if (typeof v === 'string') want.add(v); } // optional parts a world names (spec 102 FR-220)
  /* the arcade names its parts in objects (spec 102 FR-252, FR-257, FR-260): three cabinets, the night room, the glow strip */
  const objs = meta as unknown as { monitor?: Record<string, { file: string; cells: number; screenRect: number[]; marqueeRect: number[] }>; night?: { wall: string; floor: string }; glow?: { file: string; cells: string[] } };
  if (objs.monitor && typeof objs.monitor === 'object') for (const [k, mv] of Object.entries(objs.monitor)) {
    want.add(mv.file);
    const inUnit = (a: number[]): boolean => Array.isArray(a) && a.length === 4 && a.every((v) => v >= 0 && v <= 1) && a[0] + a[2] <= 1.0001 && a[1] + a[3] <= 1.0001 && a[2] > 0 && a[3] > 0;
    if (!inUnit(mv.screenRect) || !inUnit(mv.marqueeRect) || mv.cells !== 4) out.push(`monitor ${k}: screenRect, marqueeRect (fractions of a cell) and 4 cells needed (spec 102 FR-221, FR-257)`);
  }
  if (objs.night) { want.add(objs.night.wall); want.add(objs.night.floor); }
  if (objs.glow) want.add(objs.glow.file);
  for (const f of want) if (!files.has(f)) out.push(`people.json names ${f}, which is not in the folder`);
  for (const f of files.keys()) if (!want.has(f)) out.push(`${f}: people.json does not name it`);
  return out;
}

// ---- the real packs (spec 102 FR-205, FR-213; 097 FR-115): a world and a set are separate folders; the 10 MB cap counts a world with its default set ----
const dirs = (kind: string): string[] => fs.readdirSync(path.join(RO, kind)).filter((d) => fs.statSync(path.join(RO, kind, d)).isDirectory()).sort();
const readPack = (kind: string, id: string): { files: Map<string, Buffer>; md: string; json: Record<string, unknown> } => {
  const dir = path.join(RO, kind, id), files = new Map<string, Buffer>();
  const meta = kind === 'worlds' ? 'world.json' : 'set.json';
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.webp')) files.set(f, fs.readFileSync(path.join(dir, f)));
    else assert.ok(f === meta || f === 'ASSETS.md' || (kind === 'worlds' && f === 'world.css'), `only pictures, ${meta}${kind === 'worlds' ? ', world.css' : ''} and ASSETS.md in ${kind}/${id}: ${f}`);
  }
  return { files, md: fs.readFileSync(path.join(dir, 'ASSETS.md'), 'utf8'), json: JSON.parse(fs.readFileSync(path.join(dir, meta), 'utf8')) };
};
const files = new Map<string, Buffer>(); // the shipped Photo office with its default set, for the checks below
let md = '', pj = '', META: { seat: Record<string, unknown>; stand: Record<string, { poses: object }>; facing?: string } = { seat: {}, stand: {} };
let packs = 0, biggest = 0;
const setIds = dirs('sets'), worldIds = dirs('worlds');
assert.ok(worldIds.includes('photo') && setIds.includes('office'), 'the Photo office and the Office people ship');
for (const wid of worldIds) {
  const w = readPack('worlds', wid), wj = w.json as { id: string; name: string; defaultSet: string; formatVersion: number };
  assert.strictEqual(wj.id, wid, `${wid}: world.json id is the folder`);
  assert.strictEqual(wj.formatVersion, 1, `${wid}: formatVersion 1`);
  assert.ok(typeof wj.name === 'string' && wj.name.length >= 1 && Array.from(wj.name).length <= 40, `${wid}: name 1-40 characters`);
  assert.ok(setIds.includes(wj.defaultSet), `${wid}: its default set (${wj.defaultSet}) is a set in the repo`);
  // a world's own rules (spec 097 FR-180, FR-182): scoped to the world, no blend, no blur, no filter, no outside url, no colour in a text rule
  const cssName = (w.json as { css?: string }).css;
  assert.strictEqual(fs.existsSync(path.join(RO, 'worlds', wid, 'world.css')), cssName === 'world.css', `${wid}: world.css exists exactly when world.json names it`);
  if (cssName) {
    const css = fs.readFileSync(path.join(RO, 'worlds', wid, 'world.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/mix-blend-mode\s*:\s*(?!normal)/.test(css) && !/backdrop-filter|[^-]filter\s*:/.test(css), `${wid}: world.css has no blend mode, blur or filter (FR-180)`);
    assert.ok(!/url\(\s*['"]?(?:https?:|\/|\.\.|data:)/i.test(css), `${wid}: world.css loads only files of its own folder`);
    for (const sel of css.split('}').map((r) => r.split('{')[0].trim()).filter((x) => x && !x.startsWith('@') && !x.startsWith(')'))) assert.ok(sel.includes(`[data-world="${wid}"]`), `${wid}: every rule is scoped to the world: ${sel.slice(0, 60)}`);
    for (const m of css.matchAll(/url\(\s*([\w.-]+)\s*\)/g)) assert.ok(w.files.has(m[1]), `${wid}: world.css names ${m[1]}, which is in the folder`);
  }
  const st = readPack('sets', wj.defaultSet), sj = st.json as { id: string; level: string };
  assert.strictEqual(sj.id, wj.defaultSet, `${wj.defaultSet}: set.json id is the folder`);
  assert.strictEqual(sj.level, 'full', `${wj.defaultSet}: a world's default set has full poses (FR-204)`);
  const all = new Map([...w.files, ...st.files]);
  const mdAll = w.md + '\n## The default set\n\n' + st.md;
  assert.deepStrictEqual(removals(st.md), [], `${wj.defaultSet}: its removal records are complete`);
  const merged = JSON.stringify({ ...w.json, ...st.json });
  const real = problems(all, merged, mdAll);
  assert.deepStrictEqual(real, [], `${wid} + ${wj.defaultSet} pass: ` + real.slice(0, 10).join('; '));
  const pending = [...sections(mdAll)].filter(([, x]) => /^pending/.test(x['likeness-check'] || '')).map(([n]) => n);
  assert.deepStrictEqual(pending, [], `${wid}: every person has its likeness check on record (FR-068)`);
  packs++; biggest = Math.max(biggest, [...all.values()].reduce((n, b) => n + b.length, 0));
  if (wid === 'photo') { for (const [k, v] of all) files.set(k, v); md = mdAll; pj = merged; META = JSON.parse(merged); }
}
for (const sid of setIds) assert.ok(worldIds.some((w) => (readPack('worlds', w).json as { defaultSet: string }).defaultSet === sid), `${sid}: a set the repo ships is the default of a world (so the cap counts it)`);
assert.strictEqual(Object.keys(META.seat).length, 15, '15 seated people (the Office people)');
assert.ok(Object.values(META.stand as Record<string, { poses: object }>).every((s) => ['book', 'type', 'knock', 'counter', 'letter', 'runA', 'runB'].every((p) => p in s.poses) && !('tread' in s.poses) && Object.keys(s.poses).length === 7), 'every person has exactly the five lobby poses and the two running strides, no treadmill (owner 2026-10-31 11:22), and no old front-facing pose (FR-191)');
assert.strictEqual(META.facing, 'left', 'the pictures face left (FR-191)');
assert.ok(Object.values(META.stand as Record<string, { foot?: Record<string, number>; poses: object }>).every((s) => s.foot && Object.keys(s.poses).every((p) => (s.foot as Record<string, number>)[p] > 0.2)), 'every standing picture has its measured foot centre (FR-191)');
const pending = [...sections(md)].filter(([, s]) => /^pending/.test(s['likeness-check'] || '')).map(([n]) => n);
assert.deepStrictEqual(pending, [], 'every Office person has its likeness check on record (Vikram, 2026-10-31 10:46 UTC; FR-068)');
const total = [...files.values()].reduce((s, b) => s + b.length, 0);

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
  assert.ok(only(problems(one('p01-book.webp', book), pj1.replace('"top":{"book":0}', '"top":{"book":0},"foot":{"book":0.95}'), okMd)).some((p) => /foot centre/.test(p)), 'red: a foot centre at the edge of the picture (FR-191)');
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

// ---- Retro arcade and Retro pixel people (spec 102 T206, T207, T208; FR-252..FR-254, FR-259, SC-025): lossless, on the grid, the numbers measured ----
if (worldIds.includes('retro')) {
  const w = readPack('worlds', 'retro'), st = readPack('sets', 'retro');
  const wj = w.json as { pixelArt?: boolean; arrangement?: string; defaultSet: string; monitor: Record<string, { cell: number[]; glass: number[] }>; night?: object; lightSets?: string[] };
  const sj = st.json as { pixelArt?: boolean; seat: Record<string, unknown>; stand: Record<string, { poses: Record<string, number[]> }>; faceBox: Record<string, { pose: string; box: number[] }> };
  assert.strictEqual(wj.pixelArt, true, 'the arcade is pixel art'); assert.strictEqual(sj.pixelArt, true, 'Retro pixel people are pixel art');
  assert.strictEqual(wj.defaultSet, 'retro'); assert.ok((ARRANGEMENTS as readonly string[]).includes(String(wj.arrangement)), 'its arrangement is one the engine has');
  assert.ok(!wj.lightSets, 'lightSets waits for the night welcome part (FR-252: all three or none)');
  for (const [id, b] of [...w.files, ...st.files]) {
    const info = webpInfo(b);
    assert.deepStrictEqual(info.chunks.filter((c) => c !== 'VP8X'), ['VP8L'], `${id}: lossless, one chunk, no animation (FR-254)`);
  }
  /* the cabinets are exactly the drawings the plan chooses among, with their glass where the plan puts it */
  for (const k of ['big', 'small', 'narrow'] as const) {
    const cab = cabGrid(CABINETS[k].gw, CABINETS[k].gh), m = wj.monitor[k];
    assert.deepStrictEqual(m.cell, [cab.w, cab.h], `the ${k} cabinet's drawing is ${cab.w} x ${cab.h}, as the plan assumes`);
    assert.deepStrictEqual(m.glass.slice(2), [CABINETS[k].gw, CABINETS[k].gh], `the ${k} glass is the plan's`);
    const info = webpInfo(w.files.get(k === 'big' ? 'monitor.webp' : k === 'small' ? 'monitor-half.webp' : 'monitor-narrow.webp') as Buffer);
    assert.deepStrictEqual([info.width, info.height], [cab.w * 4, cab.h], `${k}: four cells in a strip`);
  }
  // the set: 15 people x 17 frames, no more, no fewer; a person missing a required frame fails (T207)
  const SEATED = ['typeA', 'typeB', 'waveA', 'waveB', 'think', 'rest'], VIEWA = ['type', 'book', 'knock', 'letter', 'counter'], FACE = ['face-book', 'face-coffee', 'face-knock', 'face-letter', 'face-runA', 'face-runB'];
  assert.strictEqual(st.files.size, 15 * 17, '255 frames');
  for (const pid of Object.keys(sj.seat)) for (const p of [...SEATED, ...VIEWA, ...FACE]) assert.ok(st.files.has(`${pid}-${p}.webp`), `${pid} has ${p}`);
  assert.strictEqual(Object.keys(sj.seat).length, 15);
  const heights = Object.entries(sj.faceBox).map(([pid, f]) => { assert.strictEqual(f.pose, 'face-book'); const [x, y, fw, fh] = f.box, [pw, ph] = sj.stand[pid].poses['face-book']; assert.ok(x >= 0 && y >= 0 && x + fw <= pw && y + fh <= ph && fw > 8 && fh > 8, `${pid}: faceBox inside its frame`); return fh; });
  assert.strictEqual(heights.length, 15, 'a faceBox per person (T201)');
  assert.ok(Math.min(...heights) >= FACE_GRID, `the smallest measured face (${Math.min(...heights)} grid px) is at least the layout's FACE_GRID (${FACE_GRID}): the layout never promises more than the art has`);
  assert.ok(Math.min(...heights) * 2 >= FACE_FLOOR, 'at g = 2 the smallest face is at least the 24 px floor (FR-229)');
  // T208: the sizes of the committed files, against the caps
  const wBytes = [...w.files.values()].reduce((n, b) => n + b.length, 0), sBytes = [...st.files.values()].reduce((n, b) => n + b.length, 0);
  console.log(`retro arcade: world ${(wBytes / 1024).toFixed(1)} KB (${w.files.size} files), people ${(sBytes / 1024).toFixed(1)} KB (${st.files.size} files), together ${((wBytes + sBytes) / 1024).toFixed(1)} KB`);
  assert.ok(wBytes + sBytes < 1024 * 1024, 'the arcade with its people is under 1 MB (FR-253 expected about 0.4 MB)');
  // a person missing a required frame fails; a lossy picture in a pixel-art pack fails; a planted file over each cap fails
  const mini = JSON.stringify({ pixelArt: true, seat: {}, stand: { p01: { figH: 72, poses: { book: [32, 71] }, feet: { book: 1 }, top: { book: 0 } } }, fixtures: {}, floorLine: 48, fixtureTop: {} });
  const sec = `### stand-p01\n- files: p01-book.webp\n- source: s\n- tool: t\n- date: 2026-11-01\n- made by: m\n- approved by: Vikram, 2026-11-01\n- reference: none\n- prompt: a person\n- cut: c\n- licence: MIT\n- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named.\n- likeness-check: Vikram, 2026-11-01\n\n## Removed\n\nNone.\n`;
  const rel = (p: string[]): string[] => p.filter((x) => !/desk.webp|floor.webp/.test(x));
  const lossless = st.files.get('p01-face-book.webp') as Buffer, lossy = fs.readFileSync(path.join(RO, 'sets', 'office', 'p01-book.webp'));
  assert.deepStrictEqual(rel(problems(new Map([['p01-book.webp', lossless]]), mini, sec)), [], 'a lossless pixel picture passes');
  assert.ok(rel(problems(new Map([['p01-book.webp', lossy]]), mini, sec)).some((x) => /must be lossless/.test(x)), 'red: a lossy picture in a pixel-art pack');
  assert.ok(rel(problems(new Map([['p01-book.webp', lossless]]), mini.replace('"p01":', '"p01":{"figH":72,"poses":{"book":[32,71],"coffee":[30,71]},"feet":{"book":1,"coffee":1},"top":{"book":0,"coffee":0}},"p02":'), sec)).some((x) => /not in the folder/.test(x)), 'red: a person missing a frame it names');
  for (const [name, kind] of [['fx-bank.webp', 'fixture'], ['desk.webp', 'desk'], ['floor.webp', 'floor'], ['wall.webp', 'wall'], ['monitor.webp', 'monitor'], ['glow.webp', 'glow'], ['p01-book.webp', 'person']] as const) {
    const over = Buffer.concat([lossless, Buffer.alloc(CAPS[kind])]);
    assert.ok(problems(new Map([[name, over]]), mini, sec).some((x) => new RegExp(`${name.replace('.', '\\.')}: \\d+ bytes, over the ${kind} cap`).test(x)), `red: a planted ${kind} over its cap`);
  }
}
{
  // FR-213, SC-025: all shipped art, every world and every set, under 30 MB
  let all = 0; for (const kind of ['worlds', 'sets']) for (const id of dirs(kind)) for (const f of fs.readdirSync(path.join(RO, kind, id))) if (f.endsWith('.webp')) all += fs.statSync(path.join(RO, kind, id, f)).size;
  console.log(`all shipped art: ${(all / 1024 / 1024).toFixed(2)} MB of ${SHIPPED_MAX / 1024 / 1024}`);
  assert.ok(all <= SHIPPED_MAX, 'all shipped art is at most 30 MB');
}
{
  // the build script's own checks (a frame off the 8x grid is refused, two runs give the same bytes), where python3 is installed
  const script = path.join(ROOT, 'scripts', 'build-arcade-pack.py');
  const have = spawnSync('python3', ['-I', '-c', 'import PIL'], { encoding: 'utf8' });
  if (have.error || have.status !== 0) console.log('build-arcade-pack selftest skipped: needs python3 with Pillow (not on this machine; the committed pictures are still checked above)');
  else { const r = spawnSync('python3', ['-I', script, '--selftest'], { encoding: 'utf8' }); assert.strictEqual(r.status, 0, 'build-arcade-pack.py --selftest: ' + r.stdout + r.stderr); }
}

// ---- packaging (FR-060, FR-061, T012): the build ships each pack's pictures and its script, never ASSETS.md or the JSON; the CSP is unchanged ----
const copy = fs.readFileSync(path.join(ROOT, 'scripts', 'copy-assets.js'), 'utf8');
assert.ok(/'worlds', 'world', 'DurbarRealOfficeWorlds'/.test(copy) && /'sets', 'set', 'DurbarRealOfficeSets'/.test(copy), 'copy-assets.js copies realoffice/worlds and realoffice/sets');
if (fs.existsSync(path.join(ROOT, 'dist', 'renderer', 'index.html'))) {
  for (const [kind, json, global] of [['worlds', 'world', 'DurbarRealOfficeWorlds'], ['sets', 'set', 'DurbarRealOfficeSets']]) for (const id of dirs(kind)) {
    const src = readPack(kind, id), out = path.join(ROOT, 'dist', 'renderer', 'realoffice', kind, id);
    const extra = kind === 'worlds' && fs.existsSync(path.join(RO, kind, id, 'world.css')) ? ['world.css'] : [];
    assert.deepStrictEqual(fs.readdirSync(out).sort(), [...src.files.keys(), json + '.js', ...extra].sort(), `dist ${kind}/${id} holds exactly the pictures and ${json}.js: no ASSETS.md, no ${json}.json`);
    const m = new RegExp(`self\\.${global}\\[\"${id}\"\\]=(\\{.*\\});\\s*$`).exec(fs.readFileSync(path.join(out, json + '.js'), 'utf8'));
    assert.ok(m, `${json}.js sets self.${global}[${id}]`);
    assert.deepStrictEqual(JSON.parse((m as RegExpExecArray)[1]), src.json, `${json}.js carries ${json}.json unchanged`);
  }
  for (const f of ['realoffice.js', 'realoffice.css', 'realoffice-world.css']) assert.ok(fs.existsSync(path.join(ROOT, 'dist', 'renderer', f)), f + ' is built');
}
const index = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
const csp = /Content-Security-Policy" content="([^"]*)"/.exec(index);
assert.strictEqual(csp && csp[1], "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;", 'the CSP is unchanged (FR-060)');
assert.ok(!/realoffice/.test(index), 'index.html does not load Real office (FR-061: only on first use)');
console.log(`realoffice assets tests passed (${packs} world packs with their default sets, largest ${(biggest / 1024 / 1024).toFixed(2)} MB; the Photo office ${files.size} pictures, ${(total / 1024 / 1024).toFixed(2)} MB)`);
process.exitCode = 0;
