/**
 * The one validator behind download, upload, generate and import (spec 102 FR-050). A world pack is hostile data: this file holds the closed list
 * of file names, their size and picture caps, the manifest reader and the plain-words report. Pure (Buffers in, a result out), no file or network
 * access, nothing is written anywhere. It never throws: any surprise is a refusal (fail closed). No stored path ever comes from a pack: callers
 * may write `<store>/<key>/<name>` only for a `name` that this module returned from its own list (`PART_NAMES`).
 *
 * What it does NOT do: decode a picture. It reads magic bytes, chunk structure and header dimensions only; decoding happens in the sandboxed
 * encoder window (spec 096 FR-022, built later). Unknown by this file: whether a picture is good, or shows something it should not (FR-135).
 */
import { checkUserManifest, USER_THEME_LIMITS } from './themes';
import { themeIssues } from './themegen';
import { THEME_ID_RE } from './credits';
import { ALLOWED_CHUNKS, webpInfo } from './webpcheck';
import { crc32, openZip, segmentProblem, sha256, MAX_KEPT_ENTRIES, type ZipHeader, type ZipLimits } from './worldzip';
import { momentCoverage, momentsNeeding, uncoveredMoments, BLOCK_PARTS, MOMENT_EXTRAS, MOMENT_BLOCKS, type MomentStatus } from './worldmoments';

export const FORMAT_VERSION = 1;
export const MANIFEST_BYTES = 64 * 1024;
export const PACK_MAX_BYTES = 10 * 1024 * 1024; // FR-042, 097 FR-115: a hard cap
export const MAX_SIDE = 4096; // FR-052
export const MAX_PARTS = MAX_KEPT_ENTRIES;
export const MIN_SCREEN_W = 40; // px at desk-half.webp's own size: smaller leaves no room for the bars of 097 FR-032 (chosen here, see the spec delta)
export const MIN_SCREEN_H = 20;

export type AnchorKind = 'n' | 'p' | 'r';
export interface PartSpec { name: string; block: string; maxBytes: number; minW: number; minH: number; maxW: number; maxH: number; anchors: Readonly<Record<string, AnchorKind>> }

const KB = 1024;
const P = (name: string, block: string, kb: number, maxW: number, maxH: number, minW = 1, minH = 1, anchors: Record<string, AnchorKind> = {}): PartSpec =>
  ({ name, block, maxBytes: kb * KB, minW, minH, maxW, maxH, anchors });
const FIXTURE_ANCHORS: Record<string, AnchorKind> = { standX: 'n', plateAnchor: 'p', lightAnchor: 'p', floorLine: 'n' };
const FIXTURES = ['library', 'software', 'terminal', 'web', 'boss', 'coffee', 'bank', 'post', 'tools', 'kiosk'];
const DESK_ANCHORS: Record<string, AnchorKind> = { surfaceY: 'n', screenRect: 'r', plateRect: 'r', lampAnchor: 'p', callAnchor: 'p' };

/**
 * The closed list of files (FR-041). Caps from the spec: wall 120 KB, floor 40 KB, welcome 150 KB, windows 60 KB, fixtures 120 KB, desk 60 KB; a
 * fixture, a window and `wall.webp` at most 300 px tall, `welcome.webp` at most 1920x1200 (FR-042). Where spec 098 FR-030 gave sizes but no file names
 * (the lift, the two frames and the panel) or the spec gave no picture size, the names and limits here are this PR's choice, written in the spec's
 * 2026-10-31 delta for the owner to change: one table, so a change is one line.
 */
export const PART_TABLE: readonly PartSpec[] = [
  P('wall.webp', 'room', 120, MAX_SIDE, 300),
  P('floor.webp', 'room', 40, 1920, 1200),
  P('welcome.webp', 'room', 150, 1920, 1200),
  P('window-1.webp', 'room', 60, MAX_SIDE, 300, 48, 8),
  P('window-2.webp', 'room', 60, MAX_SIDE, 300, 48, 8),
  P('window-3.webp', 'room', 60, MAX_SIDE, 300, 48, 8),
  ...FIXTURES.map((f) => P('fx-' + f + '.webp', 'fixture', 120, MAX_SIDE, 300, 1, 1, f === 'boss' ? { ...FIXTURE_ANCHORS, doorRect: 'r' } : FIXTURE_ANCHORS)),
  P('desk.webp', 'desk-screen', 60, 1920, 1200, 1, 1, DESK_ANCHORS),
  P('desk-half.webp', 'desk-screen', 60, 1920, 1200, 1, 1, DESK_ANCHORS),
  P('lift-shaft.webp', 'lift', 60, 180, 1200),
  P('lift-cover.webp', 'lift', 150, 1920, 1200),
  P('lift-cutaway.webp', 'lift', 200, 1920, 1200),
  P('speech-bubble.webp', 'speech-bubble', 24, 720, 720),
  P('slip.webp', 'slip', 24, 840, 840),
  P('panel-frame.webp', 'panel-frame', 60, 1920, 1200),
  P('panel-backdrop.webp', 'panel-frame', 150, 1920, 1200),
];
const PART_INDEX: ReadonlyMap<string, PartSpec> = new Map(PART_TABLE.map((p) => [p.name, p]));
export const PART_NAMES: readonly string[] = PART_TABLE.map((p) => p.name);
export const MANIFEST_NAME = 'world.json';
export const isPartName = (n: unknown): boolean => typeof n === 'string' && PART_INDEX.has(n);

export const LAMP_SHAPES = ['lamp', 'flame', 'neon-strip'];
export const CALL_SHAPES = ['dot', 'flame', 'neon'];
export const RIDE_STYLES = ['doors', 'gate', 'drop'];
const MANIFEST_FIELDS = new Set(['formatVersion', 'id', 'name', 'version', 'defaultSet', 'tokens', 'lights', 'rideStyle', 'parts', 'description', 'licence']);

export interface Anchors { [k: string]: number | { x: number; y: number } | { x: number; y: number; w: number; h: number } }
export interface SafeManifest {
  formatVersion: 1; id: string; name: string; version: number; defaultSet: string;
  tokens: Record<string, string>; lights: { lamp: string; call: string }; rideStyle: string | null;
  parts: Record<string, { anchors: Anchors; sha256?: string; bytes?: number }>;
  description?: string; licence?: string;
}
export interface ReportRow { part: string; ok: boolean; reason: string; moments: string[] }
export interface PackResult {
  ok: boolean;
  /** the first reason a pack was refused, in plain words; '' when ok */
  reason: string;
  report: ReportRow[];
  manifest?: SafeManifest;
  /** the files the pack holds (names from the closed list) */
  parts: string[];
  /** moments with a missing part (FR-034): non-empty means `unfinished` */
  unfinished: string[];
  coverage: MomentStatus[];
  /** FR-055: tokens whose colours need the renderer's contrast repair (the repair itself stays in theme.js); empty = none needed */
  contrastIssues: number;
}
export interface PackOptions {
  /** Clean Office's full token set, for contrast. Without it a pack that has tokens is refused: contrast cannot be checked (fail closed). */
  clean?: Record<string, string>;
  /** Sets this pack's defaultSet may name (built-in ids and the same source's). When given, any other id is refused. */
  knownSets?: readonly string[];
  /** Downloaded packs: every part carries `sha256` and `bytes` in world.json (FR-040). */
  requireHashes?: boolean;
  zip?: ZipLimits;
  /** Whole-pack byte cap; default 10 MB. Only tests lower it: the per-part caps add up to far less, so the default is a second line of defence. */
  maxBytes?: number;
}

const own = (o: object, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? (o as Record<string, unknown>)[k] : undefined);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const BAD_TEXT = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}<>`]|(?! )\s/u;
function plainText(v: unknown, min: number, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const n = Array.from(v).length;
  if (n < min || n > max || BAD_TEXT.test(v) || v !== v.trim()) return undefined;
  return v;
}
const unit = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : undefined);

function readAnchors(raw: unknown, allowed: Readonly<Record<string, AnchorKind>>): Anchors | string {
  if (raw === undefined) return {};
  if (!isObj(raw)) return 'its anchors are not an object';
  const out: Anchors = {};
  for (const k of Object.keys(raw)) {
    const kind = Object.prototype.hasOwnProperty.call(allowed, k) ? allowed[k] : undefined;
    if (!kind) return 'it names an anchor this part does not have';
    const v = raw[k];
    if (kind === 'n') { const n = unit(v); if (n === undefined) return 'an anchor is not a number from 0 to 1'; out[k] = n; continue; }
    if (!isObj(v)) return 'an anchor is not in the right shape';
    const keys = Object.keys(v).sort().join();
    if (kind === 'p') {
      const x = unit(own(v, 'x')), y = unit(own(v, 'y'));
      if (keys !== 'x,y' || x === undefined || y === undefined) return 'an anchor point is not {x, y} from 0 to 1';
      out[k] = { x, y };
    } else {
      const x = unit(own(v, 'x')), y = unit(own(v, 'y')), w = unit(own(v, 'w')), h = unit(own(v, 'h'));
      if (keys !== 'h,w,x,y' || x === undefined || y === undefined || w === undefined || h === undefined || w <= 0 || h <= 0 || x + w > 1 + 1e-9 || y + h > 1 + 1e-9) return 'an anchor box is not {x, y, w, h} inside the picture';
      out[k] = { x, y, w, h };
    }
  }
  return out;
}

type Manifest = { ok: true; m: SafeManifest; contrast: number } | { ok: false; reason: string };
const bad = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/** world.json: size, strict UTF-8 and JSON, own-property reads, a closed field list, limits per field. Never trusts a value it did not copy. */
export function readManifest(data: Uint8Array, present: readonly string[], opts: PackOptions = {}): Manifest {
  if (data.length > MANIFEST_BYTES) return bad('world.json is over 64 KB.');
  let doc: unknown;
  try { doc = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data)); } catch { return bad('world.json is not valid JSON.'); }
  if (!isObj(doc)) return bad('world.json is not an object.');
  for (const k of Object.keys(doc)) {
    if (k === 'realHeight') return bad('world.json sets a real height; a pack cannot (it is one value per place in the app).');
    if (!MANIFEST_FIELDS.has(k)) return bad('world.json has a field that is not on the list.');
  }
  const fv = own(doc, 'formatVersion');
  if (typeof fv !== 'number' || !Number.isInteger(fv) || fv < 1) return bad('world.json has no valid format version.');
  if (fv > FORMAT_VERSION) return bad('This world was made for a newer Agent Durbar.');
  const id = own(doc, 'id');
  if (typeof id !== 'string' || !THEME_ID_RE.test(id)) return bad('world.json needs an id of lowercase letters, digits, - and _.');
  const name = plainText(own(doc, 'name'), 1, 40);
  if (name === undefined) return bad('The world name must be 1 to 40 plain characters.');
  const version = own(doc, 'version');
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0 || version > 999999999) return bad('The world version must be a whole number of up to 9 digits.');
  const defaultSet = own(doc, 'defaultSet');
  if (typeof defaultSet !== 'string' || !THEME_ID_RE.test(defaultSet)) return bad('The default character set must be a set id.');
  if (opts.knownSets && !opts.knownSets.includes(defaultSet)) return bad('The default character set is not one that can be used here.');
  let description: string | undefined, licence: string | undefined;
  if (own(doc, 'description') !== undefined) { description = plainText(own(doc, 'description'), 0, 200); if (description === undefined) return bad('The description must be plain text of at most 200 characters.'); }
  if (own(doc, 'licence') !== undefined) { licence = plainText(own(doc, 'licence'), 0, 40); if (licence === undefined) return bad('The licence must be plain text of at most 40 characters.'); }
  // lights and ride style: a fixed list each, never a colour or a duration
  const lights = { lamp: LAMP_SHAPES[0], call: CALL_SHAPES[0] };
  const rl = own(doc, 'lights');
  if (rl !== undefined) {
    if (!isObj(rl)) return bad('The lights are not an object.');
    for (const k of Object.keys(rl)) {
      const v = rl[k];
      if (k === 'lamp' && typeof v === 'string' && LAMP_SHAPES.includes(v)) lights.lamp = v;
      else if (k === 'call' && typeof v === 'string' && CALL_SHAPES.includes(v)) lights.call = v;
      else return bad('A light shape is not on the list.');
    }
  }
  let rideStyle: string | null = null;
  if (own(doc, 'rideStyle') !== undefined) { const r = own(doc, 'rideStyle'); if (typeof r !== 'string' || !RIDE_STYLES.includes(r)) return bad('The ride style is not on the list.'); rideStyle = r; }
  // tokens: spec 040/070 value rules through checkUserManifest, then contrast through themeIssues
  const tokens: Record<string, string> = {};
  let contrast = 0;
  const rt = own(doc, 'tokens');
  if (rt !== undefined) {
    if (!isObj(rt)) return bad('The colours and fonts are not an object.');
    if (Object.keys(rt).length > USER_THEME_LIMITS.maxTokens) return bad('The pack has too many colours and fonts.');
    const chk = checkUserManifest(JSON.stringify({ id: 'world-tokens', name: 'x', tokens: rt }));
    if (!chk.ok) return bad('A colour or font in world.json is not allowed (no url(), no markup, no font outside the app\'s list).');
    if (chk.dropped && chk.dropped.length) return bad('A colour or font in world.json is not allowed (no url(), no markup, no font outside the app\'s list).');
    for (const k of Object.keys(rt)) tokens[k] = String(rt[k]).trim();
    if (Object.keys(tokens).length) {
      if (!opts.clean) return bad('Colours cannot be checked here, so the pack is refused.');
      contrast = themeIssues(tokens, opts.clean, 'clean').length;
    }
  }
  // parts: every listed name on the closed list, anchors from that part's own list
  const rp = own(doc, 'parts');
  if (!isObj(rp)) return bad('world.json lists no parts object.');
  const listed = Object.keys(rp);
  const parts: SafeManifest['parts'] = {};
  for (const n of listed) {
    const spec = PART_INDEX.get(n);
    if (!spec) return bad('world.json lists a file that is not on the list.');
    if (!present.includes(n)) return bad('world.json lists a file that is not in the pack.');
    const e = rp[n];
    if (!isObj(e)) return bad('A part entry in world.json is not an object.');
    for (const k of Object.keys(e)) if (k !== 'anchors' && k !== 'sha256' && k !== 'bytes') return bad('A part entry in world.json has a field that is not on the list.');
    const a = readAnchors(own(e, 'anchors'), spec.anchors);
    if (typeof a === 'string') return bad('A part entry: ' + a + '.');
    const out: { anchors: Anchors; sha256?: string; bytes?: number } = { anchors: a };
    const h = own(e, 'sha256'), by = own(e, 'bytes');
    if (h !== undefined) { if (typeof h !== 'string' || !/^[0-9a-f]{64}$/.test(h)) return bad('A part hash is not a SHA-256.'); out.sha256 = h; }
    if (by !== undefined) { if (typeof by !== 'number' || !Number.isInteger(by) || by < 1 || by > spec.maxBytes) return bad('A part size in world.json is not valid.'); out.bytes = by; }
    if (opts.requireHashes && (out.sha256 === undefined || out.bytes === undefined)) return bad('A downloaded part has no hash or size in world.json.');
    parts[n] = out;
  }
  for (const n of present) if (n !== MANIFEST_NAME && !Object.prototype.hasOwnProperty.call(parts, n)) return bad('The pack has a file that world.json does not list.');
  const m: SafeManifest = { formatVersion: 1, id, name, version, defaultSet, tokens, lights, rideStyle, parts };
  if (description) m.description = description;
  if (licence) m.licence = licence;
  return { ok: true, m, contrast };
}

// ---- pictures: magic, structure, header dimensions (FR-052) ----
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** PNG chunks a stored picture may hold: no text, EXIF or animation chunks (a project pack is not re-encoded, so nothing may ride along). */
const PNG_CHUNKS = ['IHDR', 'PLTE', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'pHYs', 'IDAT', 'IEND'];
const be32 = (b: Uint8Array, p: number): number => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
const tag4 = (b: Uint8Array, p: number): string => String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
const le16 = (b: Uint8Array, p: number): number => b[p] | (b[p + 1] << 8);
const le24 = (b: Uint8Array, p: number): number => b[p] | (b[p + 1] << 8) | (b[p + 2] << 16);

export interface PictureInfo { kind: 'png' | 'webp'; width: number; height: number }
/** The picture's kind and size, or a plain reason. Bounded work: every chunk is at least 8 bytes, so the walk is linear in the (capped) file. */
export function pictureHeader(buf: Uint8Array): PictureInfo | string {
  if (buf.length >= 8 && PNG_SIG.every((v, i) => buf[i] === v)) {
    if (buf.length < 33 || be32(buf, 8) !== 13 || tag4(buf, 12) !== 'IHDR') return 'The picture header is damaged.';
    const width = be32(buf, 16), height = be32(buf, 20);
    let p = 8, idat = false, end = false;
    while (p + 12 <= buf.length) {
      const len = be32(buf, p), t = tag4(buf, p + 4);
      if (len > buf.length || p + 12 + len > buf.length) return 'The picture is cut short.';
      if (!PNG_CHUNKS.includes(t)) return t === 'acTL' || t === 'fcTL' || t === 'fdAT' ? 'An animated picture is not allowed.' : 'The picture holds data besides the picture (text or metadata chunks).';
      if (crc32(buf, p + 4, p + 8 + len) !== be32(buf, p + 8 + len)) return 'The picture is damaged.';
      if (t === 'IDAT') idat = true;
      p += 12 + len;
      if (t === 'IEND') { end = true; break; }
    }
    if (!end || !idat) return 'The picture is cut short.';
    if (p !== buf.length) return 'The picture has extra bytes after its end.';
    return { kind: 'png', width, height };
  }
  if (buf.length >= 12 && tag4(buf, 0) === 'RIFF' && tag4(buf, 8) === 'WEBP') {
    const info = webpInfo(buf);
    if (!info || !info.chunks.length) return 'The picture header is damaged.';
    if (info.truncated) return 'The picture is cut short.';
    if (info.trailing) return 'The picture has extra bytes after its end.';
    for (const c of info.chunks) if (!ALLOWED_CHUNKS.includes(c)) return c === 'ANIM' || c === 'ANMF' ? 'An animated picture is not allowed.' : 'The picture holds data besides the picture (metadata chunks).';
    const data = info.list.filter((c) => c.id === 'VP8 ' || c.id === 'VP8L');
    if (data.length !== 1) return 'The picture header is damaged.';
    const first = info.list[0];
    if (first.id === 'VP8X') { if (first.size < 10 || (buf[first.start + 8] & 0x02)) return 'An animated picture is not allowed.'; }
    else if (info.list.length !== 1) return 'The picture header is damaged.';
    // the bitstream's own size must agree with the canvas the header claims, or two readers could disagree
    const c = data[0], d = c.start + 8;
    let bw = 0, bh = 0;
    if (c.id === 'VP8L') {
      if (c.size < 5 || buf[d] !== 0x2f) return 'The picture header is damaged.';
      const b = (buf[d + 1] | (buf[d + 2] << 8) | (buf[d + 3] << 16) | (buf[d + 4] << 24)) >>> 0;
      bw = (b & 0x3fff) + 1; bh = ((b >>> 14) & 0x3fff) + 1;
    } else {
      if (c.size < 10 || buf[d + 3] !== 0x9d || buf[d + 4] !== 0x01 || buf[d + 5] !== 0x2a) return 'The picture header is damaged.';
      bw = le16(buf, d + 6) & 0x3fff; bh = le16(buf, d + 8) & 0x3fff;
    }
    const width = first.id === 'VP8X' ? 1 + le24(buf, first.start + 12) : bw, height = first.id === 'VP8X' ? 1 + le24(buf, first.start + 15) : bh;
    if (width !== bw || height !== bh) return 'The picture header disagrees with itself.';
    return { kind: 'webp', width, height };
  }
  return 'Not a PNG or WebP picture.';
}

/** A part's picture against its own caps; '' when fine. */
export function partProblem(spec: PartSpec, buf: Uint8Array): string {
  if (buf.length > spec.maxBytes) return 'The picture is bigger than its limit of ' + Math.round(spec.maxBytes / KB) + ' KB.';
  const h = pictureHeader(buf);
  if (typeof h === 'string') return h;
  if (h.width > MAX_SIDE || h.height > MAX_SIDE) return 'The picture is too large.';
  if (h.width > spec.maxW || h.height > spec.maxH) return 'The picture is larger than this part allows (' + spec.maxW + 'x' + spec.maxH + ').';
  if (h.width < spec.minW || h.height < spec.minH) return 'The picture is smaller than this part needs.';
  return '';
}

/** FR-032: the screen on the half-size desk must be big enough to read; needs the desk picture's own size. */
function screenProblem(m: SafeManifest, buf: Uint8Array | null): string {
  const e = Object.prototype.hasOwnProperty.call(m.parts, 'desk-half.webp') ? m.parts['desk-half.webp'] : undefined;
  const r = e && (e.anchors.screenRect as { w: number; h: number } | undefined);
  if (!e || !r || !buf) return '';
  const h = pictureHeader(buf);
  if (typeof h === 'string') return '';
  return r.w * h.width < MIN_SCREEN_W || r.h * h.height < MIN_SCREEN_H ? 'The screen on the small desk is too small to read.' : '';
}

type Source = { headers: ZipHeader[]; read(name: string): Buffer | null };

function validateSource(src: Source, ignored: number, opts: PackOptions): PackResult {
  const report: ReportRow[] = [];
  const fail = (part: string, reason: string, moments: string[] = []): void => { report.push({ part, ok: false, reason, moments }); };
  const names = src.headers.map((h) => h.name);
  const finish = (manifest?: SafeManifest, parts: string[] = [], contrastIssues = 0): PackResult => {
    const bad1 = report.find((r) => !r.ok);
    const cov = manifest && !bad1 ? momentCoverage({ parts, rideStyle: manifest.rideStyle }) : [];
    return { ok: !bad1, reason: bad1 ? bad1.reason : '', report, manifest, parts, unfinished: cov.filter((c) => !c.covered).map((c) => c.id), coverage: cov, contrastIssues };
  };
  void ignored;
  // 1. names, declared sizes and totals: everything knowable before one byte is read
  let total = 0;
  for (const h of src.headers) {
    if (h.name === MANIFEST_NAME) { if (h.size > MANIFEST_BYTES) fail(MANIFEST_NAME, 'world.json is over 64 KB.'); total += h.size; continue; }
    const spec = PART_INDEX.get(h.name);
    if (!spec) { fail('(file)', 'A file in the pack is not on the list of allowed names.'); continue; }
    if (h.size > spec.maxBytes) fail(h.name, 'The picture is bigger than its limit of ' + Math.round(spec.maxBytes / KB) + ' KB.', momentsNeeding(h.name));
    total += h.size;
  }
  if (!names.includes(MANIFEST_NAME)) fail(MANIFEST_NAME, 'The pack has no world.json.');
  if (total > (opts.maxBytes ?? PACK_MAX_BYTES)) fail('(pack)', 'The pack is over 10 MB.');
  if (report.some((r) => !r.ok)) return finish();
  // 2. the manifest, before any picture is touched (a newer format is refused here)
  const mb = src.read(MANIFEST_NAME);
  if (!mb) { fail(MANIFEST_NAME, 'world.json is damaged.'); return finish(); }
  const mf = readManifest(mb, names, opts);
  if (!mf.ok) { fail(MANIFEST_NAME, mf.reason); return finish(); }
  report.push({ part: MANIFEST_NAME, ok: true, reason: mf.contrast ? 'Colours adjusted for contrast.' : 'Fine.', moments: [] });
  // 3. each picture
  const present: string[] = [];
  let deskHalf: Buffer | null = null;
  for (const spec of PART_TABLE) {
    if (!names.includes(spec.name)) continue;
    const buf = src.read(spec.name);
    if (!buf) { fail(spec.name, 'The file is damaged, or larger than it says.'); continue; }
    const why = partProblem(spec, buf);
    const entry = mf.m.parts[spec.name];
    if (!why && entry && entry.bytes !== undefined && entry.bytes !== buf.length) { fail(spec.name, 'The file is not the size world.json says.'); continue; }
    if (!why && entry && entry.sha256 !== undefined && entry.sha256 !== sha256(buf)) { fail(spec.name, 'The file does not match the hash in world.json.'); continue; }
    if (why) { fail(spec.name, why, momentsNeeding(spec.name)); continue; }
    if (spec.name === 'desk-half.webp') deskHalf = buf;
    present.push(spec.name);
    report.push({ part: spec.name, ok: true, reason: 'Fine.', moments: [] });
  }
  const sp = screenProblem(mf.m, deskHalf);
  if (sp) fail('desk-half.webp', sp, momentsNeeding('desk-half.webp'));
  if (report.some((r) => !r.ok)) return finish();
  // 4. what is missing (not an error: FR-034 marks the world unfinished)
  const missing = new Set<string>();
  for (const id of Object.keys(MOMENT_BLOCKS)) {
    for (const b of MOMENT_BLOCKS[id]) for (const f of BLOCK_PARTS[b] || []) if (!present.includes(f)) missing.add(f);
    for (const f of MOMENT_EXTRAS[id] || []) if (f !== 'rideStyle' && !present.includes(f)) missing.add(f);
  }
  for (const f of Array.from(missing).sort()) report.push({ part: f, ok: true, reason: 'Not in this pack; the Photo office picture is drawn instead.', moments: momentsNeeding(f) });
  if (!mf.m.rideStyle) report.push({ part: MANIFEST_NAME, ok: true, reason: 'No ride style; the lift ride between floors is not covered.', moments: ['floor-change'] });
  return finish(mf.m, present, mf.contrast);
}

const REFUSED = (reason: string): PackResult => ({ ok: false, reason, report: [{ part: '(zip)', ok: false, reason, moments: [] }], parts: [], unfinished: [], coverage: [], contrastIssues: 0 });
const CRASH: PackResult = { ok: false, reason: 'This pack could not be checked, so it is refused.', report: [{ part: '(pack)', ok: false, reason: 'This pack could not be checked, so it is refused.', moments: [] }], parts: [], unfinished: [], coverage: [], contrastIssues: 0 };

/** The gate for a zip (download, upload, import, generate's output): the reader, then the pack rules. Never throws. */
export function validateWorldZip(zip: Buffer, opts: PackOptions = {}): PackResult {
  try {
    const z = openZip(zip, opts.zip);
    if (!z.ok) return REFUSED(z.reason);
    return validateSource(z, z.ignored, opts);
  } catch { return CRASH; }
}

/** The same rules for a folder the person picked: a flat list of files (main did the `lstat`, and refuses links and non-regular files before this). Never throws. */
export function validateWorldFiles(files: ReadonlyArray<{ name: string; data: Uint8Array }>, opts: PackOptions = {}): PackResult {
  try {
    if (!Array.isArray(files) || files.length > MAX_PARTS) return REFUSED('The folder has too many files.');
    const seen = new Set<string>();
    const map = new Map<string, Buffer>();
    for (const f of files) {
      if (!f || typeof f.name !== 'string' || !(f.data instanceof Uint8Array)) return REFUSED('A file in the folder cannot be read.');
      const why = segmentProblem(f.name);
      if (why || f.name.includes('/')) return REFUSED('A file name in the folder is not allowed.');
      if (seen.has(f.name.toLowerCase())) return REFUSED('Two files have the same name, or names that differ only in case.');
      seen.add(f.name.toLowerCase());
      map.set(f.name, Buffer.from(f.data.buffer, f.data.byteOffset, f.data.byteLength));
    }
    return validateSource({ headers: Array.from(map, ([name, b]) => ({ name, size: b.length })), read: (n) => map.get(n) ?? null }, 0, opts);
  } catch { return CRASH; }
}

export { uncoveredMoments };
