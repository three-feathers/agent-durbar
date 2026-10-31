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
import { themeIssues, isBlocking, toHex, CONTRAST_PAIRS, UI_PAIRS } from './themegen';
import { TYPED_TOKENS, typedValue } from './themetokens';
import { THEME_ID_RE } from './credits';
import { ALLOWED_CHUNKS, webpInfo } from './webpcheck';
import { crc32, openZip, segmentProblem, sha256, MAX_KEPT_ENTRIES, MAX_RAW_ENTRIES, type ZipHeader, type ZipLimits } from './worldzip';
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
  /** Clean Office's full token set, for contrast and for the names a pack may set. Without it a pack that has tokens is refused: contrast cannot be checked (fail closed). */
  clean?: Record<string, string>;
  /**
   * REQUIRED (a caller that forgets gets a compile error, not a permissive path): the sets this pack's defaultSet may name (built-in ids and the
   * same source's). Any other id is refused. Pass the real list; an empty list refuses every pack.
   */
  knownSets: readonly string[];
  /** REQUIRED: true for a downloaded pack: every part carries `sha256` and `bytes` in world.json (FR-040). */
  requireHashes: boolean;
  zip?: ZipLimits;
  /** Whole-pack byte cap; default 10 MB. Only tests lower it: the per-part caps add up to far less, so the default is a second line of defence. */
  maxBytes?: number;
}

const own = (o: object, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? (o as Record<string, unknown>)[k] : undefined);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const BAD_TEXT = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}<>`]|(?! )\s/u;
/** Characters that draw nothing (default-ignorable code points, Braille blank): a name made only of them is blank to the eye. */
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\u2800 ]/gu;
function plainText(v: unknown, min: number, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const n = Array.from(v).length;
  if (n < min || n > max || BAD_TEXT.test(v) || v !== v.trim()) return undefined;
  if (n > 0 && v.replace(INVISIBLE, '') === '') return undefined;
  return v;
}
const unit = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : undefined);

export function readAnchors(raw: unknown, allowed: Readonly<Record<string, AnchorKind>>): Anchors | string {
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
export function readManifest(data: Uint8Array, present: readonly string[], opts: PackOptions): Manifest {
  try { return readManifestInner(data, present, opts); } catch { return bad('world.json could not be read, so the pack is refused.'); }
}

/**
 * True when any JSON object in `text` repeats a key (after unescaping, so `"a"` and `"\u0061"` are the same key). The text is already known to be
 * valid JSON. Iterative, so a deeply nested file cannot overflow the stack; linear in the text. FR-040: a field has one value, and no other reader
 * (a person, a non-JS tool) may see a different one than the app does.
 */
export function hasDuplicateKeys(text: string): boolean {
  const stack: Array<Set<string> | null> = []; // null = an array
  let expectKey = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{') { stack.push(new Set()); expectKey = true; }
    else if (c === '[') { stack.push(null); expectKey = false; }
    else if (c === '}' || c === ']') { stack.pop(); expectKey = false; }
    else if (c === ',') { expectKey = stack.length > 0 && stack[stack.length - 1] !== null; }
    else if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      if (expectKey) {
        const keys = stack[stack.length - 1];
        const key = JSON.parse(text.slice(i, j + 1)) as string;
        if (keys) { if (keys.has(key)) return true; keys.add(key); }
        expectKey = false;
      }
      i = j;
    }
  }
  return false;
}

/** The sentinel statuses whose colour meaning is fixed (FR-055, spec 070 FR-050): working blue, waiting amber, error red, done green. */
const STATUS_KEY = /^--(?:(?:c|halo|pb|pc)-(working|waiting|error|done)|card-(waiting|error)(?:-line)?)$/;
/** Hue bands in degrees (inclusive, wrapping) and the lowest saturation, measured on Clean Office's own status tokens (test:worldpack runs them all). */
const STATUS_HUE: Record<string, [number, number]> = { working: [185, 260], waiting: [20, 65], error: [340, 22], done: [95, 170] };
const STATUS_MIN_SAT = 0.2;
function hueSat(hex: string): { h: number; s: number } {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
  let h = 0;
  if (d) { h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360; }
  return { h, s: d ? d / (1 - Math.abs(2 * l - 1)) : 0 };
}
const inBand = (h: number, [lo, hi]: [number, number]): boolean => (lo <= hi ? h >= lo && h <= hi : h >= lo || h <= hi);

/** `#rrggbb` and the alpha byte of a colour in hex or rgb() form (via themegen's `toHex`); anything else (hsl, `#rgba`, a word) is undefined. */
function colourBytes(v: string): { hex: string; alpha: number } | undefined {
  const h = toHex(v.trim());
  if (!h) return undefined;
  let d = h.slice(1);
  if (d.length === 3) d = d.split('').map((c) => c + c).join('');
  if (d.length === 6) d += 'ff';
  return { hex: '#' + d.slice(0, 6), alpha: parseInt(d.slice(6), 16) }; // toHex only returns 3, 6 or 8 digits, so d is 8 digits here
}
/** The form `checkTokens` returns for one value (typed token: its typed value; colour: `#rrggbb`, or `#rrggbbaa` with alpha), or undefined when it is neither. The store ties a stored world.json to the validator's result with it. */
export function canonToken(name: string, value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (Object.prototype.hasOwnProperty.call(TYPED_TOKENS, name)) return typedValue(name, value) ?? undefined;
  const c = colourBytes(value);
  return c ? (c.alpha === 255 ? c.hex : c.hex + c.alpha.toString(16).padStart(2, '0')) : undefined;
}
const PAIR_KEYS: ReadonlySet<string> = new Set([...CONTRAST_PAIRS.flatMap((p) => [p[0], p[1]]), ...UI_PAIRS.flatMap((p) => [p[0], p[1]])]);

type TokenCheck = { ok: true; tokens: Record<string, string> } | { ok: false; reason: string };
/**
 * Tokens: string values only; spec 040 value rules through `checkUserManifest`; then only names the app knows (Clean Office's colours, or a typed token of
 * spec 070), a colour for a colour name (opaque `#rrggbb`, so contrast can be measured: transparent, hsl, 4- or 7-digit hex and `rgb(javascript)` are
 * refused; a name whose Clean value has alpha, such as `--drop-bg`, may carry alpha, at least 0.9 when contrast is measured on it), and status colours that
 * keep their meaning. The returned colours are normalised to `#rrggbb`, which is what the contrast check measured.
 */
function checkTokens(raw: Record<string, unknown>, clean: Record<string, string> | undefined): TokenCheck {
  const NOT_ALLOWED = 'A colour or font in world.json is not allowed (no url(), no markup, no font outside the app\'s list).';
  const keys = Object.keys(raw);
  if (keys.length > USER_THEME_LIMITS.maxTokens) return { ok: false, reason: 'The pack has too many colours and fonts.' };
  const strings: Record<string, string> = {};
  for (const k of keys) { const v = raw[k]; if (typeof v !== 'string') return { ok: false, reason: NOT_ALLOWED }; strings[k] = v; }
  const chk = checkUserManifest(JSON.stringify({ id: 'world-tokens', name: 'x', tokens: strings }));
  if (!chk.ok) return { ok: false, reason: NOT_ALLOWED }; // unusable values are judged below, name by name: typedValue for typed tokens, colourBytes for colours
  const out: Record<string, string> = {};
  if (!keys.length) return { ok: true, tokens: out };
  if (!clean) return { ok: false, reason: 'Colours cannot be checked here, so the pack is refused.' };
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(TYPED_TOKENS, k)) { const tv = typedValue(k, strings[k]); if (tv === null) return { ok: false, reason: NOT_ALLOWED }; out[k] = tv; continue; }
    if (!Object.prototype.hasOwnProperty.call(clean, k)) return { ok: false, reason: 'world.json sets a name the app does not know.' };
    const base = colourBytes(clean[k]), mine = colourBytes(strings[k]);
    if (!base || !mine) return { ok: false, reason: 'A colour in world.json is not a plain colour (write #rrggbb).' };
    const minAlpha = base.alpha === 255 ? 255 : PAIR_KEYS.has(k) ? 230 : 0;
    if (mine.alpha < minAlpha) return { ok: false, reason: 'A colour in world.json is see-through where text has to be read on it.' };
    const sm = STATUS_KEY.exec(k);
    if (sm) {
      const status = sm[1] || sm[2], hs = hueSat(mine.hex);
      if (hs.s < STATUS_MIN_SAT || !inBand(hs.h, STATUS_HUE[status])) return { ok: false, reason: 'A status colour in world.json does not keep its meaning (working blue, waiting amber, error red, done green).' };
    }
    out[k] = mine.alpha === 255 ? mine.hex : mine.hex + mine.alpha.toString(16).padStart(2, '0');
  }
  return { ok: true, tokens: out };
}

function readManifestInner(data: Uint8Array, present: readonly string[], opts: PackOptions): Manifest {
  if (data.length > MANIFEST_BYTES) return bad('world.json is over 64 KB.');
  let doc: unknown;
  let text = '';
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data); doc = JSON.parse(text); } catch { return bad('world.json is not valid JSON.'); }
  if (hasDuplicateKeys(text)) return bad('world.json repeats a field name.');
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
  if (!opts.knownSets.includes(defaultSet)) return bad('The default character set is not one that can be used here.');
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
    const tc = checkTokens(rt, opts.clean);
    if (!tc.ok) return bad(tc.reason);
    Object.assign(tokens, tc.tokens);
    if (Object.keys(tokens).length && opts.clean) {
      const issues = themeIssues(tokens, opts.clean, 'clean');
      // the AI maker's own rule (themegen `isBlocking`): body text, secondary text and muted text that cannot be read on their backgrounds refuse the pack (FR-055, "still unreadable");
      // every other pair is only reported, and the renderer's contrast repair fixes it when the world is applied
      if (issues.some(isBlocking)) return bad('Text colours in world.json cannot be read on the colours behind them.');
      contrast = issues.length;
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
const DAMAGED = 'The picture header is damaged.';
const PNG_DEPTHS: Readonly<Record<number, readonly number[]>> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };

/**
 * A PNG of exactly the shapes a picture needs, so nothing can ride along in a chunk (project packs are not re-encoded, FR-054): one `IHDR` first with a valid
 * depth, colour type and interlace; `gAMA` 4 bytes, `cHRM` 32, `sRGB` 1, `pHYs` 9, `PLTE` a multiple of 3 up to the depth's size, `tRNS` the length its colour
 * type needs, each once and before the first `IDAT`, in the order the PNG standard fixes; `IDAT` chunks together; `IEND` empty and last. Bytes inside the
 * compressed `IDAT` stream cannot be judged without decoding (the encoder window's job).
 */
function pngInfo(buf: Uint8Array): PictureInfo | string {
  if (buf.length < 45 || be32(buf, 8) !== 13 || tag4(buf, 12) !== 'IHDR') return DAMAGED;
  const width = be32(buf, 16), height = be32(buf, 20), depth = buf[24], ctype = buf[25];
  const depths = Object.prototype.hasOwnProperty.call(PNG_DEPTHS, ctype) ? PNG_DEPTHS[ctype] : undefined;
  if (!depths || !depths.includes(depth) || buf[26] !== 0 || buf[27] !== 0 || buf[28] > 1 || width < 1 || height < 1 || width > 0x7fffffff || height > 0x7fffffff) return DAMAGED;
  const seen = new Set<string>();
  let p = 8, idat = false, end = false, palette = 0;
  for (; p + 12 <= buf.length;) {
    const len = be32(buf, p), t = tag4(buf, p + 4), d = p + 8;
    if (len > buf.length || p + 12 + len > buf.length) return 'The picture is cut short.';
    if (!PNG_CHUNKS.includes(t)) return t === 'acTL' || t === 'fcTL' || t === 'fdAT' ? 'An animated picture is not allowed.' : 'The picture holds data besides the picture (text or metadata chunks).';
    if (crc32(buf, p + 4, d + len) !== be32(buf, d + len)) return 'The picture is damaged.';
    if (t !== 'IDAT') { if (seen.has(t)) return DAMAGED; seen.add(t); }
    if (t === 'IDAT') idat = true; // IDAT chunks are consecutive because any other chunk after the first one must be IEND (next line)
    else if (idat && t !== 'IEND') return DAMAGED;
    if (t === 'gAMA' && len !== 4) return DAMAGED;
    if (t === 'cHRM' && len !== 32) return DAMAGED;
    if (t === 'sRGB' && (len !== 1 || buf[d] > 3)) return DAMAGED;
    if (t === 'pHYs' && (len !== 9 || buf[d + 8] > 1)) return DAMAGED;
    if ((t === 'gAMA' || t === 'cHRM' || t === 'sRGB') && (seen.has('PLTE') || seen.has('tRNS'))) return DAMAGED;
    if (t === 'PLTE') {
      if (ctype === 0 || ctype === 4 || len % 3 !== 0 || len < 3 || len > 768 || len / 3 > 2 ** depth || seen.has('tRNS')) return DAMAGED;
      palette = len / 3;
    }
    if (t === 'tRNS') {
      if (ctype === 4 || ctype === 6) return DAMAGED;
      if (ctype === 0 && len !== 2) return DAMAGED;
      if (ctype === 2 && len !== 6) return DAMAGED;
      if (ctype === 3 && (len < 1 || len > palette)) return DAMAGED; // no PLTE yet means palette is 0, so len > palette refuses it
    }
    if (t === 'IEND') { if (len !== 0) return DAMAGED; end = true; p += 12; break; }
    p += 12 + len;
  }
  if (!end || !idat) return 'The picture is cut short.';
  if (ctype === 3 && !seen.has('PLTE')) return DAMAGED;
  if (p !== buf.length) return 'The picture has extra bytes after its end.';
  return { kind: 'png', width, height };
}

/**
 * A WebP of exactly the shapes a picture needs: either one bitstream chunk, or `VP8X` (exactly 10 bytes, only the alpha flag, reserved bytes zero), an
 * optional single `ALPH` (only with the alpha flag and before a lossy `VP8 ` chunk), and one bitstream: a lossy key frame with no scaling, or a lossless
 * version 0. Pad bytes are zero. The bitstream's size equals the canvas. Bytes inside the bitstream itself need a decoder to judge.
 */
function webpShape(buf: Uint8Array): PictureInfo | string {
  const info = webpInfo(buf);
  if (!info || !info.chunks.length) return DAMAGED;
  if (info.truncated) return 'The picture is cut short.';
  if (info.trailing) return 'The picture has extra bytes after its end.';
  for (const c of info.chunks) if (!ALLOWED_CHUNKS.includes(c)) return c === 'ANIM' || c === 'ANMF' ? 'An animated picture is not allowed.' : 'The picture holds data besides the picture (metadata chunks).';
  const list = info.list;
  for (const c of list) if ((c.size & 1) && buf[c.start + 8 + c.size] !== 0) return DAMAGED;
  let i = 0, canvasW = 0, canvasH = 0, alphaFlag = false;
  if (list[0].id === 'VP8X') {
    const d = list[0].start + 8;
    if (list[0].size !== 10) return DAMAGED;
    if (buf[d] & 0x02) return 'An animated picture is not allowed.';
    if ((buf[d] & ~0x10) !== 0 || buf[d + 1] !== 0 || buf[d + 2] !== 0 || buf[d + 3] !== 0) return DAMAGED;
    alphaFlag = (buf[d] & 0x10) !== 0;
    canvasW = 1 + le24(buf, d + 4); canvasH = 1 + le24(buf, d + 7);
    i = 1;
  }
  let hasAlph = false;
  if (list[i] && list[i].id === 'ALPH') {
    if (!alphaFlag || list[i].size < 1) return DAMAGED; // the flag is only ever set by a VP8X chunk
    hasAlph = true; i++;
  }
  const c = list[i];
  if (!c || (c.id !== 'VP8 ' && c.id !== 'VP8L') || i + 1 !== list.length) return DAMAGED;
  if (hasAlph && c.id !== 'VP8 ') return DAMAGED;
  const d = c.start + 8;
  let bw = 0, bh = 0;
  if (c.id === 'VP8L') {
    if (c.size < 5 || buf[d] !== 0x2f) return DAMAGED;
    const b = (buf[d + 1] | (buf[d + 2] << 8) | (buf[d + 3] << 16) | (buf[d + 4] << 24)) >>> 0;
    if ((b >>> 29) !== 0) return DAMAGED;
    bw = (b & 0x3fff) + 1; bh = ((b >>> 14) & 0x3fff) + 1;
  } else {
    // frame tag: bit 0 = 0 key frame, bits 1-3 version (0..3), bit 4 = shown; then the start code and 14-bit sizes with a 2-bit scale that must be 0
    if (c.size < 10 || (buf[d] & 1) !== 0 || ((buf[d] >> 1) & 7) > 3 || (buf[d] & 0x10) === 0 || buf[d + 3] !== 0x9d || buf[d + 4] !== 0x01 || buf[d + 5] !== 0x2a) return DAMAGED;
    const w = le16(buf, d + 6), h = le16(buf, d + 8);
    if ((w >> 14) !== 0 || (h >> 14) !== 0) return DAMAGED;
    bw = w; bh = h;
  }
  const width = list[0].id === 'VP8X' ? canvasW : bw, height = list[0].id === 'VP8X' ? canvasH : bh;
  if (width !== bw || height !== bh) return 'The picture header disagrees with itself.';
  return { kind: 'webp', width, height };
}

/** The picture's kind and size, or a plain reason. Bounded work: every chunk is at least 8 bytes, so the walks are linear in the (capped) file. */
export function pictureHeader(buf: Uint8Array): PictureInfo | string {
  if (buf.length >= 8 && PNG_SIG.every((v, i) => buf[i] === v)) return pngInfo(buf);
  if (buf.length >= 12 && tag4(buf, 0) === 'RIFF' && tag4(buf, 8) === 'WEBP') return webpShape(buf);
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
export function validateWorldZip(zip: Buffer, opts: PackOptions): PackResult {
  try {
    const z = openZip(zip, opts.zip);
    if (!z.ok) return REFUSED(z.reason);
    return validateSource(z, z.ignored, opts);
  } catch { return CRASH; }
}

/** The same rules for a folder the person picked: a flat list of files (main did the `lstat`, and refuses links and non-regular files before this). Never throws. */
export function validateWorldFiles(files: ReadonlyArray<{ name: string; data: Uint8Array }>, opts: PackOptions): PackResult {
  try {
    if (!Array.isArray(files)) return REFUSED('The folder cannot be read.');
    if (files.length > MAX_RAW_ENTRIES) return REFUSED('The folder has too many files.');
    let kept = 0;
    const seen = new Set<string>();
    const map = new Map<string, Buffer>();
    for (const f of files) {
      if (!f || typeof f.name !== 'string' || !(f.data instanceof Uint8Array)) return REFUSED('A file in the folder cannot be read.');
      // what a person's OS leaves in a folder is ignored by exact name, as in a zip (FR-051); it is never read, kept or listed
      if (f.name === '.DS_Store' || f.name === 'Thumbs.db') continue;
      if (++kept > MAX_PARTS) return REFUSED('The folder has too many files.');
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
