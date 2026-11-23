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
export const CAPS = { person: 80 * 1024, fixture: 120 * 1024, desk: 60 * 1024, floor: 40 * 1024, wall: 120 * 1024, monitor: 30 * 1024, glow: 20 * 1024, welcome: 150 * 1024, focus: 120 * 1024, total: 10 * 1024 * 1024 };
/** spec 102 FR-213: all shipped art (every world and every set) at most this many bytes */
export const SHIPPED_MAX = 30 * 1024 * 1024;
/** spec 102 FR-393, FR-394, FR-397, FR-403 (issue #2055; owner 2026-11-23 14:59 UTC, FINE): the HD person set's limits */
export const HD_PALETTE = 96, HD_HUE_DE = 15, HD_ORPHAN_MAX = 0.06, HD_ORPHAN_MAX_72 = 0.12, HD_PERSON_MAX = 450 * 1024, HD_FILE_MAX = 300 * 1024, HD_HEAD = [0.27, 0.36], HD_HEAD_W = 36, HD_TILE_EDGE = 3, HD_TILE_FEAT = 15, HD_BUST_EDGE = 3.25; /* T472: the busts on the Photo office and cave desk walls, measured 3.28:1 at the lowest (2026-11-24) */ /* FR-402: the crown is the top of the hair: a bun, an afro, a quiff or a hood measures taller than 0.31; the face is never enlarged for it */
export const PERSON_MAX_H = 640;
const KEYS = ['files', 'source', 'tool', 'date', 'made by', 'approved by', 'reference', 'prompt', 'cut', 'licence'];
const CLAUSE = /fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named/;
const kindOf = (f: string): keyof typeof CAPS | null => /^fx-[a-z]+\.webp$/.test(f) ? 'fixture' : /^p\d\d-[\w-]+(\.h)?\.webp$/.test(f) || /^[a-z][a-z0-9-]*-\w+\.webp$/.test(f) ? 'person' : f === 'desk.webp' || f === 'desk.h.webp' ? 'desk' : /^floor(-night)?\.webp$/.test(f) ? 'floor' : /^wall(-night)?\.webp$/.test(f) ? 'wall' : /^monitor(-[a-z]+)?\.webp$/.test(f) ? 'monitor' : f === 'glow.webp' ? 'glow' : f === 'welcome.webp' ? 'welcome' : f === 'focus.webp' ? 'focus' : null;

/** Spec 102 FR-302 (T265a): the world previews in `realoffice/previews/`: one WebP per built-in world and Plain, 640 px wide, each at most 48 KB with no metadata chunk,
 *  and `previews.json` naming exactly those, each with its own size and a zoom origin of 0..100 percent (FR-301). Sentences, empty = fine. */
export const PREVIEW_MAX = 48 * 1024, PREVIEW_W = 640;
export function previewProblems(files: Map<string, Buffer>, json: string, ids: string[]): string[] {
  const out: string[] = [];
  let doc: { formatVersion?: unknown; previews?: Record<string, { file?: unknown; width?: unknown; height?: unknown; bytes?: unknown; origin?: { x?: unknown; y?: unknown } }> };
  try { doc = JSON.parse(json); } catch { return ['previews.json is not JSON']; }
  if (doc.formatVersion !== 1) out.push('previews.json: formatVersion 1');
  const prev = doc.previews || {};
  if (JSON.stringify(Object.keys(prev).sort()) !== JSON.stringify([...ids].sort())) out.push(`previews.json names ${Object.keys(prev).sort().join(', ')}; the built-in worlds are ${[...ids].sort().join(', ')}`);
  for (const id of ids) {
    const e = prev[id], name = id + '.webp';
    const buf = files.get(name);
    if (!buf) { out.push(`${name}: no picture for ${id}`); continue; }
    if (!e || e.file !== name) out.push(`previews.json ${id}: file is ${name}`);
    if (buf.length > PREVIEW_MAX) out.push(`${name}: ${buf.length} bytes, over the 48 KB preview cap (FR-302)`);
    let info: { chunks: string[]; width: number; height: number } | null = null;
    try { info = webpInfo(buf); } catch { out.push(`${name}: not a WebP file`); }
    if (info) {
      for (const c of info.chunks) if (!['VP8 ', 'VP8L', 'VP8X', 'ALPH'].includes(c)) out.push(`${name}: metadata or unexpected chunk "${c}"`);
      if (info.width !== PREVIEW_W) out.push(`${name}: ${info.width} px wide, not ${PREVIEW_W}`);
      if (e && (e.width !== info.width || e.height !== info.height || e.bytes !== buf.length)) out.push(`previews.json ${id}: says ${e.width}x${e.height}, ${e.bytes} bytes; the picture is ${info.width}x${info.height}, ${buf.length} bytes (retake with npm run shots:docs)`);
    }
    const o = e && e.origin;
    if (!o || typeof o.x !== 'number' || typeof o.y !== 'number' || o.x < 0 || o.x > 100 || o.y < 0 || o.y > 100) out.push(`previews.json ${id}: a zoom origin x and y of 0..100 percent`);
  }
  for (const f of files.keys()) if (!ids.includes(f.replace(/\.webp$/, ''))) out.push(`${f}: a picture for no built-in world`);
  return out;
}

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

/** spec 097 FR-068, spec 102 T396 (review of #1957): a kid sheet's owner look on likeness, `owner-likeness-look: pending (<owner>)`, blocks shipping: a world that is
 *  OFFERED (its row in crew.js `WORLDS` has no flag, or its flag is on) must carry no pending look in its ASSETS.md (or its default set's). A world behind an off flag (the cave) may
 *  hold one until it is opened. The answer is recorded by the owner's words as `likeness-check: ...` (written only from his answer). Returns the sections still pending. */
export function pendingLooks(md: string, offered: boolean): string[] {
  if (process.env.ASSETS_MUTANT === 'lookoff') return []; /* the mutant: the guard removed; the red cases below must fail at their own assert */
  if (!offered) return [];
  return [...sections(md)].filter(([, x]) => /^pending\b/.test(x['owner-likeness-look'] || '')).map(([n]) => n);
}
/** spec 102 FR-200..FR-202: is a world offered? crew.js `WORLDS` and `WORLD_FLAGS` (the one list the app reads) */
export function worldOffered(id: string): boolean {
  const C = require(path.join(ROOT, 'src', 'renderer', 'crew.js')) as { WORLD_FLAGS: Record<string, boolean>; WORLDS: { id: string; flag?: string }[] }; // eslint-disable-line @typescript-eslint/no-var-requires
  const row = C.WORLDS.find((w) => w.id === id);
  return !!row && (!row.flag || C.WORLD_FLAGS[row.flag] === true);
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
      if (!/^(?:[A-Z][\w .'-]*[\w.](?: \(owner\))?, \d{4}-\d{2}-\d{2}(?: \d{2}:\d{2} UTC)?(?: \([^()]+\))?(?:, Telegram DM: "[^"\n]+")?|pending \([A-Z][\w .'-]*\))$/.test(lc)) out.push(`ASSETS.md ${name}: likeness-check must be "<approver>, <YYYY-MM-DD>[ HH:MM UTC][ (note)]" or "pending (<approver>)", got "${lc}" (FR-068)`);
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
    if (kind === 'welcome' && (info.width > 1920 || info.height > 1200)) out.push(`${name}: ${info.width}x${info.height}, over 1920x1200 (spec 102 FR-042)`);
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
  /* spec 097 FR-369, FR-371 (T328): the kids of a world, six clay-toy kids with one picture per state; every number is in shipped pixels */
  for (const [kid, km] of Object.entries((meta as { kids?: Record<string, { bodyH: number; w: number; h: number; headTop: number; face: number[]; ref: string; widest: string; poses: Record<string, number[]> }> }).kids || {})) {
    const states = ['working', 'thinking', 'waiting', 'error', 'limit', 'done', 'asleep'];
    if (!/^kid\d$/.test(kid)) out.push(`world.json kids: "${kid}" is not kidN`);
    for (const st of states) {
      want.add(`${kid}-${st}.webp`);
      const wh = km.poses && km.poses[st], buf = files.get(`${kid}-${st}.webp`);
      if (!Array.isArray(wh) || !(wh[0] > 0 && wh[1] > 0)) { out.push(`world.json kids ${kid}: no size for ${st}`); continue; }
      if (buf) { try { const i = webpInfo(buf); if (i.width !== wh[0] || i.height !== wh[1]) out.push(`world.json kids ${kid} ${st}: says ${wh[0]}x${wh[1]}, the picture is ${i.width}x${i.height}`); } catch (e) { /* reported above */ } }
    }
    for (const k of Object.keys(km.poses || {})) if (!states.includes(k)) out.push(`world.json kids ${kid}: "${k}" is not a state`);
    const ref = km.poses && km.poses[km.ref];
    if (!ref || km.w !== ref[0] || km.h !== ref[1] || km.bodyH !== km.h) out.push(`world.json kids ${kid}: w, h and bodyH are the reference pose's (${km.ref})`);
    const f = km.face;
    if (!Array.isArray(f) || f.length !== 4 || !(f[2] > 0 && f[3] > 0) || f[0] < 0 || f[1] < 0 || f[0] + f[2] > km.w || f[1] + f[3] > km.h || km.headTop !== f[1]) out.push(`world.json kids ${kid}: the face box is inside the reference picture and starts at headTop`);
    const wid = Math.max(...Object.values(km.poses || {}).map((v) => v[0]));
    if (!km.poses || !km.poses[km.widest] || km.poses[km.widest][0] !== wid) out.push(`world.json kids ${kid}: widest is not the widest pose (FR-369's place)`);
  }
  for (const [pid, parts] of Object.entries((meta as { rig?: Record<string, Record<string, unknown>> }).rig || {})) for (const key of Object.keys(parts)) want.add(`${pid}-rig${key}.webp`); /* spec Changes 2026-11-01 */
  for (const k of ['wall', 'monitor', 'welcome'] as const) { const v = (meta as Record<string, unknown>)[k]; if (typeof v === 'string') want.add(v); } // optional parts a world names (spec 102 FR-220)
  /* the arcade names its parts in objects (spec 102 FR-252, FR-257, FR-260): three cabinets, the night room, the glow strip */
  const objs = meta as unknown as { monitor?: Record<string, { file: string; cells: number; bodies?: number; screenRect: number[]; marqueeRect: number[] }>; night?: { wall: string; floor: string }; glow?: { file: string; cells: string[] } };
  if (objs.monitor && typeof objs.monitor === 'object') for (const [k, mv] of Object.entries(objs.monitor)) {
    want.add(mv.file);
    const inUnit = (a: number[]): boolean => Array.isArray(a) && a.length === 4 && a.every((v) => v >= 0 && v <= 1) && a[0] + a[2] <= 1.0001 && a[1] + a[3] <= 1.0001 && a[2] > 0 && a[3] > 0;
    if (!inUnit(mv.screenRect) || !inUnit(mv.marqueeRect) || mv.cells !== 4 * (mv.bodies || 1)) out.push(`monitor ${k}: screenRect, marqueeRect (fractions of a cell) and 4 cells per body needed (spec 102 FR-221, FR-257, FR-306)`);
  }
  if (objs.night) { want.add(objs.night.wall); want.add(objs.night.floor); }
  if (objs.glow) want.add(objs.glow.file);
  if ((meta as { arrangement?: unknown }).arrangement === 'circle') { want.add('focus.webp'); if (!files.has('focus.webp')) out.push('arrangement circle needs focus.webp (spec 102 FR-227)'); } /* the one picture the circle stands round, named by the arrangement, not by a key */
  for (const f of want) if (!files.has(f)) out.push(`people.json names ${f}, which is not in the folder`);
  for (const f of files.keys()) if (!want.has(f.replace(/\.h\.webp$/, '.webp'))) out.push(`${f}: people.json does not name it`);
  return out;
}

/** FR-183 (T144, T153): every person and the desk has both sizes, the half-size picture is half of each side (rounded up) and `px` is the full picture's width. */
export function halfProblems(files: Map<string, Buffer>, px: Record<string, number> | undefined): string[] {
  const out: string[] = [];
  const twoSizes = (f: string): boolean => /^p\d\d-(?!rig)\w+\.webp$/.test(f) || f === 'desk.webp'; // a rig layer (head, hands) has no half-size picture
  for (const name of files.keys()) {
    if (/\.h\.webp$/.test(name)) { if (!files.has(name.replace(/\.h\.webp$/, '.webp'))) out.push(`${name}: no full-size picture`); continue; }
    if (!twoSizes(name)) continue;
    const half = name.replace(/\.webp$/, '.h.webp'), a = webpInfo(files.get(name) as Buffer);
    if (!px || px[name] !== a.width) out.push(`world.json or set.json px: ${name} is ${a.width} wide, px says ${px ? px[name] : 'nothing'}`);
    if (!files.has(half)) { out.push(`${name}: no half-size picture ${half}`); continue; }
    const b = webpInfo(files.get(half) as Buffer);
    if (b.width !== Math.ceil(a.width / 2) || b.height !== Math.ceil(a.height / 2)) out.push(`${half}: ${b.width}x${b.height}, not half of ${a.width}x${a.height}`);
  }
  return out;
}

// ---- the real packs (spec 102 FR-205, FR-213; 097 FR-115): a world and a set are separate folders; the 10 MB cap counts a world with its default set ----
const dirs = (kind: string): string[] => fs.readdirSync(path.join(RO, kind)).filter((d) => fs.statSync(path.join(RO, kind, d)).isDirectory()).sort();
const readPack = (kind: string, id: string): { files: Map<string, Buffer>; md: string; json: Record<string, unknown> } => {
  const dir = path.join(RO, kind, id), files = new Map<string, Buffer>();
  const meta = kind === 'worlds' ? 'world.json' : 'set.json';
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.webp')) files.set(f, fs.readFileSync(path.join(dir, f)));
    else assert.ok(f === meta || f === 'ASSETS.md' || (kind === 'worlds' && f === 'world.css') || (kind === 'sets' && id === 'retro' && f === 'hd'), `only pictures, ${meta}${kind === 'worlds' ? ', world.css' : ''} and ASSETS.md in ${kind}/${id} (and the Retro set's hd/, spec 102 FR-391): ${f}`);
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
    const css = fs.readFileSync(path.join(RO, 'worlds', wid, 'world.css'), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/mix-blend-mode\s*:\s*(?!normal)/.test(css) && !/backdrop-filter|[^-]filter\s*:/.test(css), `${wid}: world.css has no blend mode, blur or filter (FR-180)`);
    assert.ok(!/url\(\s*['"]?(?:https?:|\/|\.\.|data:)/i.test(css), `${wid}: world.css loads only files of its own folder`);
    /* spec 102 T214, FR-260: a world's own motion: keyframes move transform and opacity only, and a loop is stepped */
    const frames = [...css.matchAll(/@keyframes\s+[\w-]+\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)];
    for (const f of frames) for (const d of f[1].matchAll(/\{([^{}]*)\}/g)) for (const prop of d[1].split(';').map((x) => x.split(':')[0].trim()).filter(Boolean)) assert.ok(prop === 'transform' || prop === 'opacity', `${wid}: @keyframes move only transform and opacity: ${prop}`);
    for (const m of css.matchAll(/animation:\s*([^;}]+)/g)) if (!/^none/.test(m[1])) assert.ok(/steps\(/.test(m[1]), `${wid}: a world's loop is stepped: ${m[1]}`);
    for (const sel of css.replace(/@keyframes\s+[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, '').split('}').map((r) => r.split('{')[0].trim()).filter((x) => x && !x.startsWith('@') && !x.startsWith(')'))) assert.ok(sel.includes(`[data-world="${wid}"]`), `${wid}: every rule is scoped to the world: ${sel.slice(0, 60)}`);
    for (const m of css.matchAll(/url\(\s*([\w.-]+)\s*\)/g)) assert.ok(w.files.has(m[1]), `${wid}: world.css names ${m[1]}, which is in the folder`);
  }
  const st = readPack('sets', wj.defaultSet), sj = st.json as { id: string; level: string };
  assert.strictEqual(sj.id, wj.defaultSet, `${wj.defaultSet}: set.json id is the folder`);
  assert.strictEqual(sj.level, 'full', `${wj.defaultSet}: a world's default set has full poses (FR-204)`);
  const all = new Map([...w.files, ...st.files]);
  const mdAll = w.md + '\n## The default set\n\n' + st.md;
  assert.deepStrictEqual(removals(st.md), [], `${wj.defaultSet}: its removal records are complete`);
  const merged = JSON.stringify({ ...w.json, ...st.json, px: { ...(w.json.px as object), ...(st.json.px as object) } }); // `px` (spec 097 FR-183): the world's desk and the set's people, one list here
  const real = problems(all, merged, mdAll);
  assert.deepStrictEqual(real, [], `${wid} + ${wj.defaultSet} pass: ` + real.slice(0, 10).join('; '));
  const pending = [...sections(mdAll)].filter(([, x]) => /^pending/.test(x['likeness-check'] || '')).map(([n]) => n);
  assert.deepStrictEqual(pending, [], `${wid}: every person has its likeness check on record (FR-068)`);
  if (wid === 'cave') assert.strictEqual([...w.files.keys()].filter((n) => /^kid\d-/.test(n)).length, 42, 'the cave ships 6 kids x 7 states (spec 102 T326)');
  /* spec 102 T396 (review of #1957): an offered world ships no kid (or person) whose owner likeness look is pending; the cave, behind its off flag, may */
  assert.deepStrictEqual(pendingLooks(mdAll, worldOffered(wid)), [], `${wid} is offered${worldOffered(wid) ? '' : ' (no: behind its flag)'}: no sheet may ship with \`owner-likeness-look: pending\` (FR-068); record the owner's answer as \`likeness-check\``);
  if (wid === 'retro') assert.strictEqual([...w.files.keys()].filter((n) => /^kid\d-/.test(n)).length, 42, 'the arcade ships 6 pixel kids x 7 states (spec 102 T327)');
  packs++; biggest = Math.max(biggest, [...all.values()].reduce((n, b) => n + b.length, 0));
  if (wid === 'photo') { for (const [k, v] of all) files.set(k, v); md = mdAll; pj = merged; META = JSON.parse(merged); }
}
/* spec 097 Changes 2026-11-08 (T240..T244): a set that is no world's default is a crew set; it is drawn only because crew.js has a `REAL_SETS` row for it
   (wired). It still passes every picture and text check and has its approval on record. A set with no row is refused, except a set named in SETS_PACK_ONLY
   (an art-only set whose wiring PR is to come; empty since T245); that allowance fails as soon as crew.js gives the set a row, so it cannot go stale. */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const REAL_SETS = (require(path.join(__dirname, '..', '..', 'src', 'renderer', 'crew.js')) as { REAL_SETS: { id: string }[] }).REAL_SETS;
const wiredIds = REAL_SETS.map((r) => r.id);
for (const id of wiredIds) assert.ok(setIds.includes(id), `${id}: a REAL_SETS row has its set folder`);
const SETS_PACK_ONLY: string[] = []; // empty since T245 (Minimalist wired, #1154); a name here is an art-only set whose wiring PR is to come
for (const id of SETS_PACK_ONLY) assert.ok(!wiredIds.includes(id), `${id} is wired: remove it from SETS_PACK_ONLY`);
/* each crew set's owner approval (date, time and quote of every frame line) and likeness check, one explicit entry per set: a set missing here fails */
const QUOTE_1143 = 'Vikram Gorla (owner), 2026-11-08 11:43 UTC, Telegram DM: "Yes, I looked at every art carefully and it does not resemble any person I know"';
const ALL_GOOD = '2026-11-08 11:29 UTC, "They all look good"';
const RECORD: Record<string, { approval: string; likeness: string }> = {
  pirate: { approval: '2026-11-08 08:48 UTC, "Ok, looks good"', likeness: QUOTE_1143 },
  royal: { approval: ALL_GOOD, likeness: QUOTE_1143 },
  rebels: { approval: ALL_GOOD, likeness: QUOTE_1143 },
  monster: { approval: ALL_GOOD, likeness: QUOTE_1143 },
  cheeky: { approval: ALL_GOOD, likeness: QUOTE_1143 },
  minimalist: { approval: '2026-11-08 12:00 UTC, "Look approved and none look like a real person"', likeness: 'Vikram Gorla (owner), 2026-11-08 12:00 UTC, Telegram DM: "Look approved and none look like a real person"' },
};
const packOnly = setIds.filter((sid) => !worldIds.some((w) => (readPack('worlds', w).json as { defaultSet: string }).defaultSet === sid));
for (const sid of packOnly) {
  assert.ok(wiredIds.includes(sid) || SETS_PACK_ONLY.includes(sid), `${sid}: a set the repo ships is the default of a world or has a REAL_SETS row (not wired: refused)`);
  assert.ok(Object.prototype.hasOwnProperty.call(RECORD, sid), `${sid}: the set has its own approval and likeness entry in RECORD (no fallback)`);
  const rec = RECORD[sid];
  const st = readPack('sets', sid), sj = st.json as { id: string; level: string; formatVersion: number; name: string; seat: Record<string, unknown>; stand: Record<string, { poses: Record<string, number[]> }> };
  assert.strictEqual(sj.id, sid, `${sid}: set.json id is the folder`);
  assert.strictEqual(sj.formatVersion, 1, `${sid}: formatVersion 1`);
  assert.strictEqual(sj.level, 'full', `${sid}: crew sets have full poses`);
  assert.ok(typeof sj.name === 'string' && sj.name.length >= 1 && Array.from(sj.name).length <= 40, `${sid}: name 1-40 characters`);
  assert.deepStrictEqual(Object.keys(sj.seat).sort(), Object.keys(sj.stand).sort(), `${sid}: the same people seated and standing`);
  for (const [pid, s] of Object.entries(sj.stand)) assert.deepStrictEqual(Object.keys(s.poses).sort(), ['book', 'coffee', 'knock', 'letter', 'runA', 'runB'], `${sid} ${pid}: the six standing poses`);
  const bad = problems(st.files, JSON.stringify(sj), st.md).filter((x) => !/^people\.json names (?:desk|floor)\.webp, /.test(x)); // the desk and floor belong to a world
  assert.deepStrictEqual(bad, [], `${sid} passes: ` + bad.slice(0, 10).join('; '));
  assert.strictEqual(st.files.size, Object.keys(sj.seat).length * 12, `${sid}: 12 pictures per person`);
  assert.ok(!/pending|\[ \]/i.test(st.md), `${sid}: no pending approval and no empty approval box in ASSETS.md`);
  const approval = /^approved by Vikram Gorla \(owner\) in Paco's place, Telegram DM, \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC, "[^"]+"$/;
  const frames = [...st.md.matchAll(/^- \[x\] (\S+\.webp): (.*)$/gm)];
  const prefixed = `note: ${(frames[0] || [])[2]}`; // mutant: text before "approved by" must fail (the unanchored regex accepted it)
  assert.ok(!approval.test(prefixed), `${sid}: approval line with text before "approved by" is rejected (anchored)`);
  assert.ok(new RegExp(approval.source.slice(1, -1)).test(prefixed), `${sid}: the unanchored regex would accept the prefixed line (mutant is real)`);

  assert.deepStrictEqual(frames.map((m) => m[1]).sort(), [...st.files.keys()].sort(), `${sid}: one approval line for every picture`);
  for (const m of frames) assert.ok(approval.test(m[2]) && m[2].endsWith(`Telegram DM, ${rec.approval}`), `${sid} ${m[1]}: approval line names who, in whose place, channel, time and the set's recorded quote (FR-067)`);
  for (const [n, x] of sections(st.md)) assert.ok(/^(?:Paco|Vikram Gorla)\b/.test(x['approved by'] || '') && (x['likeness-check'] || '') === rec.likeness, `${sid} ${n}: approved by and likeness-check recorded`);
  packs++;
}
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
  { /* kids (spec 097 T328): the metadata names exactly the pictures, in their sizes */
    const kidFiles = new Map([...files].filter(([n]) => /^kid\d-/.test(n)));
    assert.ok(kidFiles.size === 42, 'the Photo office ships 6 kids x 7 states');
    const km = JSON.parse(pj) as { kids: Record<string, { poses: Record<string, number[]>; face: number[]; widest: string }> };
    const bad = (mut: (k: typeof km) => void, drop?: string): string[] => { const c = JSON.parse(pj); mut(c); const f = new Map(files); if (drop) f.delete(drop); return problems(f, JSON.stringify(c), md).filter((x) => /kid/.test(x)); };
    assert.deepStrictEqual(bad(() => undefined), [], 'the shipped kids pass');
    assert.ok(bad(() => undefined, 'kid2-error.webp').length > 0, 'red: a missing kid picture');
    assert.ok(bad((c) => { c.kids.kid1.poses.error = [1, 1]; }).some((x) => /the picture is/.test(x)), 'red: a size that is not the picture\'s');
    assert.ok(bad((c) => { c.kids.kid1.face = [0, 0, 9999, 9]; }).some((x) => /face box/.test(x)), 'red: a face box outside the picture');
    assert.ok(bad((c) => { c.kids.kid1.widest = 'thinking'; }).some((x) => /widest/.test(x)), 'red: the wrong widest pose');
    assert.ok(bad((c) => { delete c.kids.kid1.poses.done; }).some((x) => /no size for done/.test(x)), 'red: a state without a size');
    assert.ok(problems(new Map([...files, ['kid9-working.webp', files.get('kid1-working.webp') as Buffer]]), pj, md).some((x) => /kid9-working.webp/.test(x)), 'red: a kid picture the metadata does not name');
    assert.ok(problems(new Map([...files, ['kid1-working.webp', Buffer.concat([files.get('kid1-working.webp') as Buffer, Buffer.alloc(90 * 1024)])]]), pj, md).some((x) => /over the person cap/.test(x)), 'red: a kid picture over the cap');
  }
  const big = new Map(files); big.set('p01-typeA.webp', Buffer.concat([good, Buffer.alloc(CAPS.total)]));
  assert.ok(problems(big, pj, md).some((p) => /over 10485760/.test(p)), 'red: a pack over 10 MB');
  /* spec 102 FR-227, T174, T242: focus.webp is named by the arrangement circle, listed in ASSETS.md and capped */
  const pjc = JSON.stringify({ ...JSON.parse(pj1), arrangement: 'circle' }), mdf = okMd.replace('\n## Removed', '### focus\n- files: focus.webp\n- source: s\n- tool: t\n- date: 2026-11-14\n- made by: m\n- approved by: a\n- reference: r\n- prompt: p\n- cut: c\n- licence: MIT\n\n## Removed');
  const withFocus = new Map(one('p01-book.webp', book)); withFocus.set('focus.webp', good);
  assert.deepStrictEqual(only(problems(withFocus, pjc, mdf)), [], 'a circle world with focus.webp, listed, passes');
  assert.ok(only(problems(one('p01-book.webp', book), pjc, okMd)).some((p) => /arrangement circle needs focus.webp/.test(p)), 'red: circle without focus.webp');
  assert.ok(only(problems(withFocus, pj1, mdf)).some((p) => /focus.webp: people.json does not name it/.test(p)), 'red: focus.webp in a world that does not name circle');
  const fat = new Map(withFocus); fat.set('focus.webp', Buffer.concat([good, Buffer.alloc(130 * 1024)]));
  assert.ok(only(problems(fat, pjc, mdf)).some((p) => /over the focus cap/.test(p)), 'red: a 130 KB focus picture');
}

assert.deepStrictEqual(halfProblems(files, (META as unknown as { px: Record<string, number> }).px), [], 'every person and the desk has both sizes (FR-183)');
{
  const px = (META as unknown as { px: Record<string, number> }).px;
  const without = new Map(files); without.delete('p01-typeA.h.webp');
  assert.ok(halfProblems(without, px).some((p) => /p01-typeA.webp: no half-size/.test(p)), 'red: a person without the half-size picture');
  const noDesk = new Map(files); noDesk.delete('desk.h.webp');
  assert.ok(halfProblems(noDesk, px).some((p) => /desk.webp: no half-size/.test(p)), 'red: the desk without the half-size picture');
  const wrong = new Map(files); wrong.set('p01-typeA.h.webp', files.get('p01-typeA.webp') as Buffer);
  assert.ok(halfProblems(wrong, px).some((p) => /not half of/.test(p)), 'red: a half-size picture of the wrong size');
  assert.ok(halfProblems(files, { ...px, 'p01-typeA.webp': 1 }).some((p) => /px:/.test(p)), 'red: px not the picture\'s width');
  const orphan = new Map(files); orphan.set('p99-x.h.webp', files.get('p01-typeA.h.webp') as Buffer);
  assert.ok(halfProblems(orphan, px).some((p) => /no full-size/.test(p)), 'red: a half-size picture with no full one');
}

// ---- Retro arcade and Retro pixel people (spec 102 T206, T207, T208; FR-252..FR-254, FR-259, SC-025): lossless, on the grid, the numbers measured ----
if (worldIds.includes('retro')) {
  const w = readPack('worlds', 'retro'), st = readPack('sets', 'retro');
  const wj = w.json as { pixelArt?: boolean; arrangement?: string; defaultSet: string; monitor: Record<string, { cell: number[]; glass: number[] }>; night?: object; lightSets?: string[] };
  const sj = st.json as { pixelArt?: boolean; seat: Record<string, unknown>; stand: Record<string, { poses: Record<string, number[]> }>; faceBox: Record<string, { pose: string; box: number[] }> };
  assert.strictEqual(wj.pixelArt, true, 'the arcade is pixel art'); assert.strictEqual(sj.pixelArt, true, 'Retro pixel people are pixel art');
  assert.strictEqual(wj.defaultSet, 'retro'); assert.ok((ARRANGEMENTS as readonly string[]).includes(String(wj.arrangement)), 'its arrangement is one the engine has');
  assert.ok(!wj.lightSets, 'no lightSets: one light, night only (owner 2026-11-03)');
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
    assert.deepStrictEqual([info.width, info.height], [cab.w * 16, cab.h], `${k}: four bodies in four colours in a strip`);
  }
  // the set: 15 people x 18 frames (17 and the seated `sit` of 2026-11-03), no more, no fewer; a person missing a required frame fails (T207)
  const SEATED = ['typeA', 'typeB', 'waveA', 'waveB', 'think', 'rest'], VIEWA = ['type', 'book', 'knock', 'letter', 'counter'], FACE = ['face-book', 'face-coffee', 'face-knock', 'face-letter', 'face-runA', 'face-runB', 'sit'];
  assert.strictEqual(st.files.size, 15 * 20, '300 frames (18, plus runA and runB, T296)');
  for (const pid of Object.keys(sj.seat)) for (const p of [...SEATED, ...VIEWA, ...FACE]) assert.ok(st.files.has(`${pid}-${p}.webp`), `${pid} has ${p}`);
  assert.strictEqual(Object.keys(sj.seat).length, 15);
  const heights = Object.entries(sj.faceBox).map(([pid, f]) => { assert.strictEqual(f.pose, 'face-book'); const [x, y, fw, fh] = f.box, [pw, ph] = sj.stand[pid].poses['face-book']; assert.ok(x >= 0 && y >= 0 && x + fw <= pw && y + fh <= ph && fw > 8 && fh > 8, `${pid}: faceBox inside its frame`); return fh; });
  assert.strictEqual(heights.length, 15, 'a faceBox per person (T201)');
  assert.ok(Math.min(...heights) >= FACE_GRID, `the smallest measured face (${Math.min(...heights)} grid px) is at least the layout's FACE_GRID (${FACE_GRID}): the layout never promises more than the art has`);
  assert.ok(Math.min(...heights) * 2 >= FACE_FLOOR, 'at g = 2 the smallest face is at least the 24 px floor (FR-229)');
  /* spec 102 FR-352 (T206): the first-run picture is in the pack, named by world.json, lossless, in the part's size and cap, and is the hall (not a blank) */
  const wel = w.files.get('welcome.webp') as Buffer, welInfo = webpInfo(wel);
  assert.strictEqual((w.json as { welcome?: string }).welcome, 'welcome.webp', 'world.json names welcome.webp (FR-352)');
  assert.ok(wel.length <= CAPS.welcome && welInfo.width <= 1920 && welInfo.height <= 1200 && welInfo.width * 10 === welInfo.height * 16, `welcome.webp is 16:10, at most 1920x1200 and ${CAPS.welcome} bytes: ${welInfo.width}x${welInfo.height}, ${wel.length}`);
  assert.ok(wel.length > 8 * 1024, 'welcome.webp is a drawn hall, not a flat fill (over 8 KB lossless)');
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
  for (const [name, kind] of [['fx-bank.webp', 'fixture'], ['desk.webp', 'desk'], ['floor.webp', 'floor'], ['wall.webp', 'wall'], ['monitor.webp', 'monitor'], ['glow.webp', 'glow'], ['welcome.webp', 'welcome'], ['p01-book.webp', 'person']] as const) {
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

{
  /* spec 102 FR-326 (review of #1677): no frame of a people set is faked by reusing or mirroring another. Pixel hashes of the decoded frames (alpha included,
   * scripts/frame-hashes.py; plain Node cannot decode WebP): no two frames of one person or of the set share a hash, and no run frame is the horizontal mirror of
   * another frame of the same person. Needs python3 with Pillow: skipped with a plain message on a machine without it, a failure where DURBAR_REQUIRE_PILLOW is set. */
  const have = spawnSync('python3', ['-I', '-c', 'import PIL'], { encoding: 'utf8' });
  if (have.error || have.status !== 0) {
    if (process.env.DURBAR_REQUIRE_PILLOW) assert.fail('python3 with Pillow is required here (DURBAR_REQUIRE_PILLOW) and is missing: the frame hash check (FR-326) cannot run');
    console.log('frame hash check skipped: needs python3 with Pillow (not on this machine)');
  } else {
    const tool = path.join(ROOT, 'scripts', 'frame-hashes.py');
    const hashOf = (dir: string): Map<string, [string, string]> => {
      const names = fs.readdirSync(dir).filter((f) => /^p\d\d-[A-Za-z-]+\.webp$/.test(f)).sort(), rows = new Map<string, [string, string]>();
      const r = spawnSync('python3', ['-I', tool, ...names.map((n) => path.join(dir, n))], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      assert.strictEqual(r.status, 0, 'frame-hashes.py: ' + r.stderr);
      for (const l of r.stdout.trim().split('\n')) { const [n, h, m] = l.split(' '); rows.set(n, [h, m]); }
      assert.strictEqual(rows.size, names.length, 'a hash for every frame');
      return rows;
    };
    const frameProblems = (rows: Map<string, [string, string]>): string[] => {
      const out: string[] = [], seen = new Map<string, string>();
      for (const [n, [h]] of rows) { const first = seen.get(h); if (first) out.push(`${first} and ${n} share a pixel hash (a frame reused)`); else seen.set(h, n); }
      for (const [n, [h]] of rows) if (/^p\d\d-run[AB]\.webp$/.test(n)) for (const [o, [, m]] of rows) if (o !== n && o.slice(0, 3) === n.slice(0, 3) && m === h) out.push(`${n} is the horizontal mirror of ${o} (a frame mirrored)`);
      return out;
    };
    const sets = fs.readdirSync(path.join(RO, 'sets')).filter((s) => fs.readdirSync(path.join(RO, 'sets', s)).some((f) => /^p\d\d-[A-Za-z-]+\.webp$/.test(f)));
    assert.ok(sets.includes('retro') && sets.includes('office'), 'the frame check covers the Retro pixel and the Office people sets: ' + sets.join());
    for (const s of sets) assert.deepStrictEqual(frameProblems(hashOf(path.join(RO, 'sets', s))), [], `${s}: no frame is a reused or mirrored copy of another (FR-326)`);
    const retro = path.join(RO, 'sets', 'retro'), tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'durbar-frames-'));
    try {
      const plant = (label: string, edit: (dir: string) => void, expect: RegExp): void => {
        const dir = path.join(tmp, label); fs.mkdirSync(dir);
        for (const f of fs.readdirSync(retro)) if (/^p\d\d-[A-Za-z-]+\.webp$/.test(f)) fs.copyFileSync(path.join(retro, f), path.join(dir, f));
        edit(dir);
        const found = frameProblems(hashOf(dir));
        assert.ok(found.some((p) => expect.test(p)), `FR-326 mutant "${label}" is caught by the frame check (${JSON.stringify(found)})`);
      };
      plant('runB is a copy of runA', (d) => fs.copyFileSync(path.join(d, 'p01-runA.webp'), path.join(d, 'p01-runB.webp')), /p01-runA\.webp and p01-runB\.webp share a pixel hash|p01-runB\.webp is the horizontal mirror/);
      plant('runB is a copy of another person\'s frame', (d) => fs.copyFileSync(path.join(d, 'p03-type.webp'), path.join(d, 'p04-runB.webp')), /share a pixel hash/);
      plant('runB is the mirror of runA', (d) => { const r = spawnSync('python3', ['-I', tool, '--mirror', path.join(d, 'p02-runA.webp'), path.join(d, 'p02-runB.webp')], { encoding: 'utf8' }); assert.strictEqual(r.status, 0, 'frame-hashes.py --mirror: ' + r.stderr); }, /p02-runB\.webp is the horizontal mirror of p02-runA\.webp/);
      plant('runA is the mirror of a standing frame', (d) => { const r = spawnSync('python3', ['-I', tool, '--mirror', path.join(d, 'p05-type.webp'), path.join(d, 'p05-runA.webp')], { encoding: 'utf8' }); assert.strictEqual(r.status, 0, 'frame-hashes.py --mirror: ' + r.stderr); }, /p05-runA\.webp is the horizontal mirror of p05-type\.webp/);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
}

{
  /* spec 102 T396: the likeness guard's red cases (ASSETS_MUTANT=lookoff removes the guard and must fail here) */
  {
    const caveMd = fs.readFileSync(path.join(RO, 'worlds', 'cave', 'ASSETS.md'), 'utf8');
    assert.strictEqual(worldOffered('cave'), false, 'the cave is behind its off flag, so its pending look does not fail it');
    assert.ok(worldOffered('retro') && worldOffered('photo'), 'the arcade and the Photo office are offered');
    assert.ok(pendingLooks(caveMd, true).length === 6, 'red: the cave opened with its six pending kid looks fails the likeness guard');
    assert.deepStrictEqual(pendingLooks(caveMd.replace(/- owner-likeness-look: pending \([^)]*\)[^\n]*/g, '- likeness-check: Vikram, 2026-11-20'), true), [], 'a recorded likeness-check passes the guard');
  }
  const kw = require(path.join(ROOT, 'scripts', 'kids-worlds.js')) as { kidsWorlds: () => string[]; pickKidsWorld: (v: string | undefined, m?: string) => string }; // eslint-disable-line @typescript-eslint/no-var-requires
  const kidWorlds = kw.kidsWorlds();
  assert.ok(kidWorlds.includes('photo') && kidWorlds.includes('cave') && kidWorlds.includes('retro'), 'the worlds with kids (world.json has `kids`) include photo, cave and retro: ' + kidWorlds.join(', '));
  /* check-097-kids.js KIDS_WORLD (outside the Pillow branch, #1867 review: the fail-loud validation needs no Pillow and runs on every machine): an unknown name fails loudly with the valid names; KIDS_MUTANT=worldfallback (the old silent fallback to photo) must be caught here */
  const kidsWorldProbe = (value: string | undefined, mutant?: string): void => {
    assert.strictEqual(kw.pickKidsWorld(undefined, mutant), 'photo', 'KIDS_WORLD unset checks photo');
    for (const wid of kidWorlds) assert.strictEqual(kw.pickKidsWorld(wid, mutant), wid, `KIDS_WORLD=${wid} checks ${wid}`);
    let msg = '';
    try { kw.pickKidsWorld(value, mutant); } catch (e) { msg = (e as Error).message; }
    assert.ok(msg.includes('is not a world with kids') && kidWorlds.every((w) => msg.includes(w)), `KIDS_WORLD=${value} must fail loudly naming the valid worlds, got: ${msg || 'no error (silent fallback)'}`);
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-097-kids.js')], { encoding: 'utf8', env: { ...process.env, KIDS_WORLD: value, KIDS_MUTANT: mutant || '' } });
    assert.strictEqual(r.status, 1, `check-097-kids.js with KIDS_WORLD=${value} must exit 1 (exit ${r.status})`);
    assert.ok(/is not a world with kids/.test(r.stderr), 'check-097-kids.js prints the valid names on a wrong KIDS_WORLD');
  };
  for (const bad of ['Cave', 'arcade', 'caves', ' photo']) kidsWorldProbe(bad);
  assert.throws(() => kidsWorldProbe('Cave', 'worldfallback'), /KIDS_WORLD=Cave must fail loudly naming the valid worlds, got: no error \(silent fallback\)/, 'red: the silent fallback to photo is caught at its own assert');
  /* spec 097 FR-371 (issue #1641 review): no kid picture is clipped by a side border. A tight crop of a whole cube or stool may rest on the
   * edge (the most in the shipped 42 is 47 rows of 220, a stool's flat side), a clipped figure runs far more: the count is of rows with
   * alpha > 128 in the first and the last column (scripts/kid-edge-rows.py decodes the WebP; plain Node cannot): needs python3 with Pillow. */
  const MAX_EDGE_ROWS = 48;
  const have = spawnSync('python3', ['-I', '-c', 'import PIL'], { encoding: 'utf8' });
  if (have.error || have.status !== 0) console.log('kid edge check skipped: needs python3 with Pillow (not on this machine)');
  else {
    const run = (args: string[]) => { const r = spawnSync('python3', ['-I', path.join(ROOT, 'scripts', 'kid-edge-rows.py'), ...args], { encoding: 'utf8' }); assert.strictEqual(r.status, 0, 'kid-edge-rows.py: ' + r.stderr); return r.stdout.trim().split('\n').map((l) => l.split(' ')); };
    for (const wid of kidWorlds) {
      const dir = path.join(RO, 'worlds', wid), names = fs.readdirSync(dir).filter((f) => /^kid\d-\w+\.webp$/.test(f)).sort();
      assert.strictEqual(names.length, 42, `the edge check sees all 42 kid pictures of ${wid}`);
      const bad = run(names.map((n) => path.join(dir, n))).filter(([, l, r]) => Number(l) > MAX_EDGE_ROWS || Number(r) > MAX_EDGE_ROWS).map(([n, l, r]) => `${n}: ${l} rows on the left edge, ${r} on the right`);
      assert.deepStrictEqual(bad, [], `${wid}: kid pictures clipped by a side border (more than ${MAX_EDGE_ROWS} opaque rows on an edge): re-cut with a margin`);
    }
    const red = run(['--red'])[0];
    assert.ok(Number(red[1]) > MAX_EDGE_ROWS && Number(red[2]) === 0, 'red: a picture cut flat on its left edge (90 opaque rows) is over the limit');
  }
}

// ---- spec 102 FR-391..FR-398 (issue #2055): the HD person set (sets/retro/hd/, `set.json` `hd`): every frame named, its size, lossless, inside its place; one palette, no speckle, the budget ----
{
  const dir = path.join(RO, 'sets', 'retro', 'hd'), sj = JSON.parse(fs.readFileSync(path.join(RO, 'sets', 'retro', 'set.json'), 'utf8')) as { hd: { scales: number[]; people: Record<string, Record<string, Record<string, number[]>>>; tiles?: { sizes: number[]; poses: string[]; people: string[]; light?: string[] }; busts?: Record<string, { w: number; h: number; headTop: number; bodyH: number; hand: number }>; ref?: Record<string, number[][]>; k?: Record<string, Record<string, number>> } };
  /* FR-405: the six seated busts ship only as avatar tiles; the 14 standing and stool frames at four sizes (FR-406: s 1 for the lobby) */
  const POSES = ['type', 'book', 'knock', 'letter', 'counter', 'runA', 'runB', 'face-book', 'face-coffee', 'face-knock', 'face-letter', 'face-runA', 'face-runB', 'sit'];
  const SEAT = new Set<string>(), tallest = (p: string): number => (SEAT.has(p) ? 80 : p === 'sit' ? 72 : 72); /* grid px: a seated bust's canvas, a standing figure (FR-256) */
  assert.deepStrictEqual(sj.hd.scales, [4, 3, 2, 1], 'FR-391, FR-406: the authored scales, the master first; s 1 (72) for the lobby');
  const named = new Set<string>(); let bytes = 0;
  for (const [pid, poses] of Object.entries(sj.hd.people)) {
    assert.deepStrictEqual(Object.keys(poses).sort(), [...POSES].sort(), `${pid}: all 14 standing and stool frames in HD`);
    let own = 0;
    for (const [pose, at] of Object.entries(poses)) for (const s of sj.hd.scales) {
      const f = `${pid}-${pose}@${s}.webp`, v = at[String(s)], b = fs.readFileSync(path.join(dir, f)), info = webpInfo(b);
      named.add(f); own += b.length;
      assert.deepStrictEqual(info.chunks.filter((c) => c !== 'VP8X'), ['VP8L'], `${f}: lossless (FR-391)`);
      assert.deepStrictEqual([info.width, info.height], v.slice(0, 2), `${f}: the size set.json gives`);
      assert.ok(v[1] <= tallest(pose) * s && v[0] <= (pose === 'sit' ? 36 : SEAT.has(pose) ? 80 : 48) * s, `${f}: ${v[0]}x${v[1]} fits its place at scale ${s} (FR-392)`);
      if (s < 4) assert.ok(Math.abs(v[1] - (at['4'][1] * s) / 4) <= 1, `${f}: the same share of its shown height as the 288 frame (${at['4'][1]} px) (FR-391)`);
      const [x, y, w, h] = v.slice(2);
      assert.ok(x >= 0 && y >= 0 && x + w <= v[0] && y + h <= v[1] && w >= 4 * s && h >= 4 * s, `${f}: faceBox inside the frame (FR-395)`);
    }
    bytes += own;
  }
  /* FR-405: every person of the set has an avatar tile per pose SEAT_POSE can ask for, at every drawn avatar size (CSS px and twice it), square, lossless */
  const T = sj.hd.tiles!, tileNames = new Set<string>();
  assert.ok(T && T.sizes.join() === '22,24,26,32,44,48,52,64' && [...T.poses].sort().join() === 'rest,think,typeA,waveA', 'FR-405: the tile sizes and poses');
  assert.deepStrictEqual([...T.people].sort(), Object.keys(sj.hd.people).sort(), 'FR-405: every HD person has tiles');
  for (const pid of T.people) for (const pose of T.poses) for (const S of T.sizes) {
    const f = `${pid}-${pose}-t${S}.webp`, b = fs.readFileSync(path.join(dir, f)), info = webpInfo(b);
    tileNames.add(f); bytes += b.length;
    assert.deepStrictEqual([info.width, info.height, info.chunks.filter((c) => c !== 'VP8X').join()], [S, S, 'VP8L'], `${f}: ${S} x ${S}, lossless`);
    if ((T.light || []).includes(pid)) { /* spec 102 T472 (FR-410): the light-surface variant of a lit-edge person, the same size */
      const fl = `${pid}-${pose}-t${S}l.webp`, bl = fs.readFileSync(path.join(dir, fl)), il = webpInfo(bl);
      tileNames.add(fl); bytes += bl.length;
      assert.deepStrictEqual([il.width, il.height, il.chunks.filter((c) => c !== 'VP8X').join()], [S, S, 'VP8L'], `${fl}: ${S} x ${S}, lossless`);
    }
  }
  /* spec 102 T472 (FR-409): the six seated busts of every person, one size (s 4), on one canvas per person, whose seat numbers set.json gives */
  const BUSTS = ['typeA', 'typeB', 'think', 'waveA', 'waveB', 'rest'], bustNames = new Set<string>();
  assert.deepStrictEqual(Object.keys(sj.hd.busts || {}).sort(), Object.keys(sj.hd.people).sort(), 'FR-409: every HD person has busts');
  for (const [pid, b] of Object.entries(sj.hd.busts || {})) {
    assert.ok(b.h === 320 && b.w > 0 && b.w <= 320 && b.headTop >= 0 && b.bodyH === b.h - b.headTop && b.hand > 0 && b.hand < 1, `FR-409: ${pid}: the bust canvas and its seat numbers`);
    for (const pose of BUSTS) {
      const f = `${pid}-${pose}@4.webp`, bf = fs.readFileSync(path.join(dir, f)), i = webpInfo(bf);
      tileNames.add(f); bustNames.add(f); bytes += bf.length;
      assert.deepStrictEqual([i.width, i.height, i.chunks.filter((c) => c !== 'VP8X').join()], [b.w, b.h, 'VP8L'], `${f}: the person's bust canvas, lossless`);
    }
  }
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), [...named, ...tileNames].sort(), 'hd/ holds exactly the frames and tiles set.json names');
  const amd = fs.readFileSync(path.join(RO, 'sets', 'retro', 'ASSETS.md'), 'utf8').replace(/\r\n/g, '\n');
  for (const pid of Object.keys(sj.hd.people)) { /* FR-398: provenance per person: tool, date, reference, prompt, fictional, the owner's look */
    const m = new RegExp(`\\n#### hd-${pid}\\n([\\s\\S]*?)(?=\\n#{2,4} |$)`).exec(amd), body = m ? m[1] : '';
    for (const k of ['files', 'source', 'tool', 'date', 'made by', 'approved by', 'reference', 'prompt', 'licence', 'fictional', 'likeness-check']) assert.ok(new RegExp(`\\n- ${k}: \\S`).test(body), `ASSETS.md hd-${pid}: "${k}" (FR-398)`);
  }
  const people = Object.keys(sj.hd.people).length;
  console.log(`HD people: ${people} people, ${named.size} frames, ${(bytes / 1024).toFixed(1)} KB, ${(bytes / people / 1024).toFixed(1)} KB a person`);
  assert.ok(bytes / people <= HD_PERSON_MAX, `FR-397: ${(bytes / people / 1024).toFixed(1)} KB a person, over ${HD_PERSON_MAX / 1024} KB`);
  /* FR-397 (review of #2074, item 2): each picture at most HD_FILE_MAX (the repo's picture budget), not only the average; a planted file over it fails at this rule */
  const overFile = (sizes: ReadonlyArray<[string, number]>): string[] => sizes.filter(([, n]) => n > HD_FILE_MAX).map(([f, n]) => `${f}: ${n} bytes, over ${HD_FILE_MAX / 1024} KB`);
  const hdSizes = fs.readdirSync(dir).map((f): [string, number] => [f, fs.statSync(path.join(dir, f)).size]);
  assert.deepStrictEqual(overFile(hdSizes), [], 'FR-397: every HD picture at most 300 KB');
  assert.deepStrictEqual(overFile([...hdSizes, ['p01-type@4.webp (planted)', HD_FILE_MAX + 1]]), [`p01-type@4.webp (planted): ${HD_FILE_MAX + 1} bytes, over 300 KB`], 'red: a planted picture one byte over 300 KB fails the per-file rule');
  console.log(`HD largest picture: ${Math.max(...hdSizes.map(([, n]) => n))} bytes (limit ${HD_FILE_MAX})`);
  const have = spawnSync('python3', ['-I', '-c', 'import PIL'], { encoding: 'utf8' });
  if (have.error || have.status !== 0) {
    if (process.env.DURBAR_REQUIRE_PILLOW) assert.fail('python3 with Pillow is required here (DURBAR_REQUIRE_PILLOW) and is missing: the HD palette and speckle check (FR-393, FR-394) cannot run');
    console.log('HD palette and speckle check skipped: needs python3 with Pillow (not on this machine)');
  } else {
    const tool = path.join(ROOT, 'scripts', 'check-arcade-hd.py');
    type Row = { name: string; opaque: number; alphas: number[]; orphans: number; lone: number; edge: number; head: [number, number]; tile: [number, number | null] | null; bust: [number, number] | null; top: number[][] | null };
    const measure = (files: string[]): { rows: Row[]; palette: number; rgba: number } => {
      const r = spawnSync('python3', ['-I', tool, ...files], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      assert.strictEqual(r.status, 0, 'check-arcade-hd.py: ' + r.stderr);
      const ls = r.stdout.trim().split('\n').map((l) => JSON.parse(l));
      return { rows: ls.slice(0, -1), ...ls[ls.length - 1] };
    };
    /* FR-403's crisp rules, one list each, so a planted frame fails at its own rule and passes the others */
    type M = ReturnType<typeof measure>;
    const crisp = {
      palette: (m: M): string[] => (m.palette > HD_PALETTE ? [`${m.palette} opaque colours, at most ${HD_PALETTE}`] : []),
      alpha: (m: M): string[] => m.rows.filter((r) => r.alphas.some((a) => a !== 0 && a !== 255)).map((r) => `${r.name}: alpha ${r.alphas.join(',')}`),
      outline: (m: M): string[] => m.rows.filter((r) => r.edge !== 1).map((r) => `${r.name}: ${r.edge} outline colours`),
      speckle: (m: M): string[] => m.rows.filter((r) => r.orphans / r.opaque > (/@1\.webp$/.test(r.name) ? HD_ORPHAN_MAX_72 : HD_ORPHAN_MAX) || r.lone > 0) /* FR-406: at 72 px an eye or a button is one pixel, so the lobby's s 1 frames allow 12 % (the old 72 px frames: 29 % median, 52 % worst) */.map((r) => `${r.name}: ${r.orphans} orphans of ${r.opaque} (${((100 * r.orphans) / r.opaque).toFixed(2)} %), ${r.lone} lone`),
    };
    const files = [...named, ...bustNames].sort().map((f) => path.join(dir, f)), all = measure(files); /* T472: the busts follow the frames' rules too */
    for (const [rule, f] of Object.entries(crisp)) assert.deepStrictEqual(f(all), [], `FR-403: the ${rule} rule holds on every HD frame`);
    /* FR-405: the tiles share the palette and the alpha rule (their edge is a cut through the body, so the one-outline rule is for whole figures) */
    const tl = measure([...files, ...[...tileNames].sort().map((f) => path.join(dir, f))]);
    assert.deepStrictEqual([crisp.palette(tl), crisp.alpha(tl)], [[], []], 'FR-405: the tiles share the one palette, alpha 0 or 255');
    /* FR-407: every person equally readable as an avatar on the darkest avatar circle (#1e1a36): the silhouette's edge at least 3:1, the features at least 15 L* below the skin */
    const legible = (rows: Row[]): string[] => rows.filter((r) => r.tile && (r.tile[0] < HD_TILE_EDGE || (r.tile[1] !== null && r.tile[1] < HD_TILE_FEAT))).map((r) => `${r.name}: edge ${r.tile![0]}:1, features ${r.tile![1]} L*`);
    const tiles = tl.rows.filter((r) => r.tile);
    assert.deepStrictEqual(legible(tiles), [], 'FR-407: every avatar tile is legible on the darkest avatar circle');
    for (const pid of T.people) assert.ok(tiles.some((r) => r.name.startsWith(pid + '-waveA-') && r.tile![1] !== null), `FR-407: ${pid}'s waving face has measured features`);
    const darkest = tiles.slice().sort((a, b) => a.tile![0] - b.tile![0])[0];
    console.log(`HD tiles: ${tiles.length}, edge at least ${darkest.tile![0]}:1, features at least ${Math.min(...tiles.filter((r) => r.tile![1] !== null).map((r) => r.tile![1] as number))} L*`);
    /* FR-402: a standing person's head, on the front frames at 144 px (the 15-agent size) */
    const heads = all.rows.filter((r) => /-face-[a-z]+(?:A|B)?@2\.webp$/.test(r.name));
    assert.ok(heads.length >= 6 * Object.keys(sj.hd.people).length, `FR-402: the front frames at 144 are measured (${heads.length})`);
    for (const r of heads) assert.ok(r.head[0] >= HD_HEAD[0] && r.head[0] <= HD_HEAD[1] && r.head[1] >= HD_HEAD_W, `FR-402: ${r.name}: head ${r.head[0]} of the height, ${r.head[1]} px wide (${HD_HEAD.join('..')}, at least ${HD_HEAD_W} px)`);
    console.log(`HD heads at 144: ${Math.min(...heads.map((r) => r.head[0]))}..${Math.max(...heads.map((r) => r.head[0]))} of the height, ${Math.min(...heads.map((r) => r.head[1]))}..${Math.max(...heads.map((r) => r.head[1]))} px wide`);
    /* FR-408: each person keeps their own colours: every reference colour of the source (set.json hd.ref) is within HD_HUE_DE (CIE76) of a colour covering at least 1 % of the front reading frame */
    const lab = (c: number[]): number[] => { const f = (v: number): number => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; const [r, g, b] = c.map(f), x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, y = r * 0.2126 + g * 0.7152 + b * 0.0722, z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883, t = (v: number): number => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116); return [116 * t(y) - 16, 500 * (t(x) - t(y)), 200 * (t(y) - t(z))]; };
    const de = (a: number[], b: number[]): number => { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
    const hue = (rows: Row[]): string[] => Object.entries(sj.hd.ref || {}).flatMap(([pid, refs]) => { const r = rows.find((x) => x.name === `${pid}-face-book@4.webp`); if (!r || !r.top) return [`${pid}: its front reading frame was not measured`]; return refs.filter((c) => Math.min(...r.top!.map((t) => de(c, t.slice(0, 3)))) > HD_HUE_DE).map((c) => `${pid}: rgb(${c.join(',')}) is gone`); });
    assert.ok(sj.hd.ref && Object.keys(sj.hd.ref).sort().join() === Object.keys(sj.hd.people).sort().join(), 'FR-408: a colour reference for every HD person');
    /* FR-402: the head step never shrinks a face: every sheet's recorded k is at least 1 (and at most 2) */
    assert.ok(sj.hd.k && Object.keys(sj.hd.k).sort().join() === Object.keys(sj.hd.people).sort().join(), 'FR-402: the head step is recorded for every HD person');
    for (const [pid, ks] of Object.entries(sj.hd.k!)) for (const [sheet, k] of Object.entries(ks)) assert.ok(k >= 1 && k <= 2, `FR-402: ${pid} ${sheet}: k ${k} (a face is never shrunk; at most doubled)`);
    assert.deepStrictEqual(hue(all.rows), [], 'FR-408: every person keeps their own colours');
    const worstOf = (one: boolean): number => Math.max(...all.rows.filter((r) => /@1\.webp$/.test(r.name) === one).map((r) => r.orphans / r.opaque));
    console.log(`HD palette ${all.palette} colours, worst orphan share ${(100 * worstOf(false)).toFixed(2)} % (limit ${(100 * HD_ORPHAN_MAX).toFixed(1)} %), at 72 px ${(100 * worstOf(true)).toFixed(2)} % (limit ${(100 * HD_ORPHAN_MAX_72).toFixed(1)} %)`);
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'durbar-hd-'));
    try {
      { /* FR-408 red case: a front frame with its colours turned round */
        const pid = Object.keys(sj.hd.people)[0], f = path.join(tmp, `${pid}-face-book@4.webp`);
        assert.strictEqual(spawnSync('python3', ['-I', tool, '--hue', path.join(dir, `${pid}-face-book@4.webp`), f], { encoding: 'utf8' }).status, 0, 'the planted frame (--hue) is written');
        assert.ok(hue(measure([f]).rows).length > 0, 'red (--hue): a person whose colours moved fails');
      }
      { /* FR-407 red case: the lit edge taken off every tile at 22 px: the darkest of them is no longer legible */
        const planted = T.people.flatMap((p) => T.poses.map((q) => { const f = path.join(tmp, `norim-${p}-${q}-t22.webp`); assert.strictEqual(spawnSync('python3', ['-I', tool, '--norim', path.join(dir, `${p}-${q}-t22.webp`), f], { encoding: 'utf8' }).status, 0, 'the planted tile (--norim) is written'); return f; }));
        assert.ok(legible(measure(planted).rows).length >= 1, 'red (--norim): without the lit edge the darkest person\'s avatar is not legible');
      }
      { /* T472 (coordinator's decision): a bust carries no rim; on both desk walls its edge reads at least HD_BUST_EDGE; red: the rim put back */
        const busts = all.rows.filter((r) => r.bust);
        assert.ok(busts.length === 90, `T472: 90 busts measured (${busts.length})`);
        assert.deepStrictEqual(busts.filter((r) => r.bust![0] > 0).map((r) => `${r.name}: ${r.bust![0]} rim pixels`), [], 'T472: no bust carries the rim');
        const lowest = Math.min(...busts.map((r) => r.bust![1]));
        assert.ok(lowest >= HD_BUST_EDGE, `T472: every bust's edge at least ${HD_BUST_EDGE}:1 on the Photo office's and the cave's desk walls (lowest ${lowest}:1)`);
        console.log(`HD busts: no rim, edge on the desk walls at least ${lowest}:1 (floor ${HD_BUST_EDGE})`);
        const planted = path.join(tmp, 'p09-think@4.webp');
        assert.strictEqual(spawnSync('python3', ['-I', tool, '--rim', path.join(dir, 'p09-think@4.webp'), planted], { encoding: 'utf8' }).status, 0, 'the planted bust (--rim) is written');
        assert.ok(measure([planted]).rows[0].bust![0] > 0, 'red (--rim): a bust with the rim put back fails');
      }
      { /* T472 (coordinator's look at F1): every frame's face box holds its whole head (hair, hood, a cap, a raised hand at head height), so FR-401's badge, which keeps clear of the face box, keeps clear of the head; red: the boxes cut 10 px lower */
        const heads = (setPath: string): string[] => { const r = spawnSync('python3', ['-I', tool, '--heads', setPath, dir], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }); assert.strictEqual(r.status, 0, 'check-arcade-hd.py --heads: ' + r.stderr); return JSON.parse(r.stdout).heads; };
        assert.deepStrictEqual(heads(path.join(RO, 'sets', 'retro', 'set.json')), [], 'T472: every HD frame\'s face box, and every bust\'s head box, holds its head');
        const low = JSON.parse(fs.readFileSync(path.join(RO, 'sets', 'retro', 'set.json'), 'utf8'));
        for (const poses of Object.values(low.hd.people) as Array<Record<string, Record<string, number[]>>>) for (const sc of Object.values(poses)) for (const v of Object.values(sc)) { v[3] += 10; v[5] = Math.max(1, v[5] - 10); }
        for (const b of Object.values(low.hd.busts) as Array<{ head: Record<string, number[]> }>) for (const v of Object.values(b.head)) { v[1] += 10; v[3] = Math.max(1, v[3] - 10); }
        fs.writeFileSync(path.join(tmp, 'low-set.json'), JSON.stringify(low));
        assert.ok(heads(path.join(tmp, 'low-set.json')).length > 0, 'red: face boxes cut below the hair fail the head rule');
      }
      { /* T472 (FR-410) red case: a lit-edge tile drawn on a light surface: copied as its own light variant, the light backgrounds cannot read it */
        const planted = (T.light || []).map((p) => { const f = path.join(tmp, `lit-${p}-typeA-t22l.webp`); fs.copyFileSync(path.join(dir, `${p}-typeA-t22.webp`), f); return f; });
        assert.ok(planted.length > 0 && legible(measure(planted).rows).length >= 1, 'red (lit edge on a light surface): a lit-edge tile is not legible on Flat\'s light avatar background');
      }
      for (const [plant, rule] of [['--speckle', 'speckle'], ['--alpha', 'alpha'], ['--colour', 'palette'], ['--edge', 'outline']] as const) {
        const planted = path.join(tmp, `p08-type@4${plant}.webp`);
        assert.strictEqual(spawnSync('python3', ['-I', tool, plant, path.join(dir, 'p08-type@4.webp'), planted], { encoding: 'utf8' }).status, 0, `the planted frame (${plant}) is written`);
        const red = measure(rule === 'palette' ? [...files, planted] : [planted]);
        assert.ok(crisp[rule](red).length > 0, `red (${plant}): the ${rule} rule fails`);
        if (plant !== '--speckle') for (const other of Object.keys(crisp) as Array<keyof typeof crisp>) if (other !== rule) assert.deepStrictEqual(crisp[other](red), [], `red (${plant}): only the ${rule} rule fails, not ${other}`);
      }
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
}

// ---- packaging (FR-060, FR-061, T012): the build ships each pack's pictures and its script, never ASSETS.md or the JSON; the CSP is unchanged ----
const copy = fs.readFileSync(path.join(ROOT, 'scripts', 'copy-assets.js'), 'utf8').replace(/\r\n/g, '\n');
assert.ok(/'worlds', 'world', 'DurbarRealOfficeWorlds'/.test(copy) && /'sets', 'set', 'DurbarRealOfficeSets'/.test(copy), 'copy-assets.js copies realoffice/worlds and realoffice/sets');
if (fs.existsSync(path.join(ROOT, 'dist', 'renderer', 'index.html'))) {
  for (const [kind, json, global] of [['worlds', 'world', 'DurbarRealOfficeWorlds'], ['sets', 'set', 'DurbarRealOfficeSets']]) for (const id of dirs(kind)) {
    const src = readPack(kind, id), out = path.join(ROOT, 'dist', 'renderer', 'realoffice', kind, id);
    const extra = kind === 'worlds' && fs.existsSync(path.join(RO, kind, id, 'world.css')) ? ['world.css'] : [];
    if (kind === 'sets' && fs.existsSync(path.join(RO, kind, id, 'hd'))) { extra.push('hd'); assert.deepStrictEqual(fs.readdirSync(path.join(out, 'hd')).sort(), fs.readdirSync(path.join(RO, kind, id, 'hd')).filter((f) => f.endsWith('.webp')).sort(), `dist ${kind}/${id}/hd holds exactly the HD frames (spec 102 FR-391)`); }
    assert.deepStrictEqual(fs.readdirSync(out).sort(), [...src.files.keys(), json + '.js', ...extra].sort(), `dist ${kind}/${id} holds exactly the pictures and ${json}.js: no ASSETS.md, no ${json}.json`);
    const m = new RegExp(`self\\.${global}\\[\"${id}\"\\]=(\\{.*\\});\\s*$`).exec(fs.readFileSync(path.join(out, json + '.js'), 'utf8').replace(/\r\n/g, '\n'));
    assert.ok(m, `${json}.js sets self.${global}[${id}]`);
    assert.deepStrictEqual(JSON.parse((m as RegExpExecArray)[1]), src.json, `${json}.js carries ${json}.json unchanged`);
  }
  for (const f of ['realoffice.js', 'realoffice.css', 'realoffice-world.css']) assert.ok(fs.existsSync(path.join(ROOT, 'dist', 'renderer', f)), f + ' is built');
}

// ---- the world previews (spec 102 FR-302, T265a): shipped with the app, one per built-in world and Plain ----
{
  const dir = path.join(RO, 'previews'), pf = new Map<string, Buffer>();
  assert.ok(fs.existsSync(dir), 'realoffice/previews exists (FR-302)');
  for (const f of fs.readdirSync(dir)) { if (f.endsWith('.webp')) pf.set(f, fs.readFileSync(path.join(dir, f))); else assert.ok(f === 'previews.json', 'only pictures and previews.json in previews/: ' + f); }
  const ids = ['plain', ...(require(path.join(__dirname, '..', '..', 'src', 'renderer', 'crew.js')) as { WORLDS: { id: string }[] }).WORLDS.map((x) => x.id)]; // eslint-disable-line @typescript-eslint/no-var-requires
  const pj = fs.readFileSync(path.join(dir, 'previews.json'), 'utf8');
  assert.deepStrictEqual(previewProblems(pf, pj, ids), [], 'the previews pass (FR-302)');
  const good = pf.get('photo.webp') as Buffer, doc = JSON.parse(pj);
  const red = (m: (f: Map<string, Buffer>, d: typeof doc) => void, re: RegExp, why: string): void => { const f = new Map(pf), d = JSON.parse(pj); m(f, d); assert.ok(previewProblems(f, JSON.stringify(d), ids).some((x) => re.test(x)), 'red: ' + why); };
  red((f) => f.set('photo.webp', Buffer.concat([good, Buffer.alloc(PREVIEW_MAX)])), /over the 48 KB/, 'a preview of 49 KB or more');
  red((f) => f.delete('cave.webp'), /no picture for cave/, 'a world without its preview');
  red((f) => f.set('extra.webp', good), /no built-in world/, 'a picture for no world');
  red((_f, d) => { delete d.previews.retro; }, /previews.json names/, 'previews.json missing a world');
  red((_f, d) => { d.previews.plain.origin.x = 140; }, /zoom origin/, 'a zoom origin outside the picture');
  red((_f, d) => { delete d.previews.plain.origin; }, /zoom origin/, 'a preview with no zoom origin');
  red((_f, d) => { d.previews.photo.bytes = 1; }, /retake with npm run shots:docs/, 'a stale size in previews.json');
  red((f) => f.set('photo.webp', Buffer.from('not an image at all, just some text')), /not a WebP/, 'a file that is no WebP');
  const withChunk = (tag: string): Buffer => { const c = Buffer.concat([Buffer.from(tag), Buffer.from([4, 0, 0, 0]), Buffer.from('abcd')]); const b = Buffer.concat([good, c]); b.writeUInt32LE(b.length - 8, 4); return b; }; // a chunk appended, RIFF size fixed up
  red((f) => f.set('photo.webp', withChunk('EXIF')), /photo\.webp: metadata or unexpected chunk "EXIF"/, 'a preview with an EXIF chunk');
  red((f) => f.set('photo.webp', withChunk('ICCP')), /photo\.webp: metadata or unexpected chunk "ICCP"/, 'a preview with an ICC profile chunk');
  assert.ok(Object.keys(doc.previews).length === ids.length, 'one preview per world');
  const dist = path.join(ROOT, 'dist', 'renderer', 'realoffice', 'previews');
  if (fs.existsSync(path.join(ROOT, 'dist', 'renderer', 'index.html'))) assert.deepStrictEqual(fs.readdirSync(dist).sort(), [...pf.keys(), 'previews.js'].sort(), 'dist previews/ holds the pictures and previews.js, not previews.json');
  assert.ok(/previews/.test(copy) && /DurbarWorldPreviews/.test(copy), 'copy-assets.js copies realoffice/previews');
}
const index = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const csp = /Content-Security-Policy" content="([^"]*)"/.exec(index);
assert.strictEqual(csp && csp[1], "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;", 'the CSP is unchanged by spec 097 (FR-060); spec 096 FR-043 added blob: to img-src only (test:crew-assets pins it)');
assert.ok(!/realoffice/.test(index), 'index.html does not load Real office (FR-061: only on first use)');
// spec 097 Changes 2026-11-14 (#1751): the cave draws its monitor frame round the engine's glass (3 px in); the CSS numbers come from the slate opening measured on the picture (Pillow, by hand: no WebP decoder here),
// and the picture is pinned by hash so a new picture must be measured again
{
  const OPEN = { x0: 0.0964, x1: 0.9107, y0: 0.1227, y1: 0.8712 }, fw = OPEN.x1 - OPEN.x0, fh = OPEN.y1 - OPEN.y0;
  const css = fs.readFileSync(path.join(RO, 'worlds', 'cave', 'world.css'), 'utf8').replace(/\r\n/g, '\n');
  const pic = require('crypto').createHash('sha256').update(fs.readFileSync(path.join(RO, 'worlds', 'cave', 'monitor.webp'))).digest('hex');
  assert.strictEqual(pic, 'b31356faa0a595ba6cd0a364e42653aced1df19ab626dd13e1cddc9f59460e14', 'the cave monitor picture changed: measure its slate opening again and update OPEN here and the calc() numbers in world.css (spec 097, #1751)');
  const want: Record<string, [number, number]> = { left: [3 + (OPEN.x0 / fw) * 6, -(OPEN.x0 / fw) * 100], top: [3 + (OPEN.y0 / fh) * 6, -(OPEN.y0 / fh) * 100], width: [-6 / fw, 100 / fw], height: [-6 / fh, 100 / fh] };
  const rule = /\.ro\[data-world="cave"\] \.ro-bezel::before\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'the cave bezel frame rule exists');
  for (const k of Object.keys(want)) {
    const m = new RegExp('(?:^|;)' + k + ':calc\\((-?[\\d.]+)px ([-+]) ([\\d.]+)%\\)').exec(rule![1]) || new RegExp('(?:^|;)' + k + ':calc\\(([\\d.]+)% ([-+]) ([\\d.]+)px\\)').exec(rule![1]);
    assert.ok(m, `the cave frame's ${k} is a calc() of a pixel part and a percentage`);
    const px = k === 'left' || k === 'top' ? Number(m![1]) : (m![2] === '-' ? -1 : 1) * Number(m![3]), pct = k === 'left' || k === 'top' ? (m![2] === '-' ? -1 : 1) * Number(m![3]) : Number(m![1]);
    assert.ok(Math.abs(px - want[k][0]) < 0.01 && Math.abs(pct - want[k][1]) < 0.01, `the cave frame's ${k} follows the measured slate opening (css ${px}px ${pct}%, want ${want[k][0].toFixed(3)}px ${want[k][1].toFixed(3)}%)`);
  }
  assert.ok(!/\.ro\[data-world="cave"\] \.ro-bezel\{[^}]*padding/.test(css), 'the cave bezel keeps the engine\'s 3 px padding: the glass is the engine\'s');
}
console.log(`realoffice assets tests passed (${packs} world packs with their default sets, largest ${(biggest / 1024 / 1024).toFixed(2)} MB; the Photo office ${files.size} pictures, ${(total / 1024 / 1024).toFixed(2)} MB)`);
process.exitCode = 0;
