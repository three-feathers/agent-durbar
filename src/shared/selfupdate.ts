/**
 * Durbar's own update (spec 118): the pure core. The repository slug, the release-list schema, the target and breaking decision,
 * release notes as plain text, the install type and its asset name, the check cadence and snooze. No I/O, no Electron: main
 * (T009, T010) does the requests and keeps the state. Everything from the network or the settings file is `unknown` here and
 * fails closed: a value that is not exactly what is expected is dropped, never repaired.
 */
import { cut, maskHomePaths, redact, unhide } from './redact';
import { parseVersionField } from './versionfield';

// ---------------------------------------------------------------------------------------------------------------------
// Source (FR-001, FR-003, FR-005)

const OWNER_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;
const GH = 'https://github.com/';

/** `owner/name`, `github:owner/name` or `https://github.com/owner/name[.git][/]` to `owner/name`; anything else undefined. */
export function parseRepoSlug(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.length > 200) return undefined;
  let s = input;
  if (s.startsWith('github:')) s = s.slice(7);
  else if (s.startsWith(GH)) {
    s = s.slice(GH.length);
    if (s.endsWith('/')) s = s.slice(0, -1);
    if (s.endsWith('.git')) s = s.slice(0, -4);
  }
  const parts = s.split('/');
  if (parts.length !== 2) return undefined;
  const [owner, name] = parts;
  if (!OWNER_RE.test(owner) || !NAME_RE.test(name) || name === '.' || name === '..') return undefined;
  return owner + '/' + name;
}

/** GitHub slugs compare case-insensitively; an unparseable side is never the same. */
export function sameRepo(a: unknown, b: unknown): boolean {
  const x = parseRepoSlug(a);
  const y = parseRepoSlug(b);
  return x !== undefined && y !== undefined && x.toLowerCase() === y.toLowerCase();
}

/** The one list request of FR-007 for a slug, or undefined. */
export const feedUrl = (slug: unknown): string | undefined => {
  const s = parseRepoSlug(slug);
  return s && `https://api.github.com/repos/${s}/releases?per_page=${FEED_PER_PAGE}`;
};

// ---------------------------------------------------------------------------------------------------------------------
// Feed (FR-007, FR-008)

export const FEED_PER_PAGE = 30;
export const MAX_FEED_BYTES = 2 * 1024 * 1024;
export const MAX_BODY_BYTES = 1024 * 1024;
export const MAX_ASSETS = 40;
export const MAX_ASSET_BYTES = 600 * 1024 * 1024;
const ASSET_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

export interface FeedAsset { name: string; size: number; url: string }
export interface FeedRelease { tag: string; version: string; publishedAt: string; htmlUrl: string; body: string; assets: FeedAsset[] }
/** `dropped`: stable versions of entries that failed the schema; `unplaced`: an entry whose version could not be read (FR-009: never safe). */
export interface Feed { releases: FeedRelease[]; full: boolean; dropped: string[]; unplaced: boolean }

/** The response itself (FR-007): 200 only (a 3xx, also a renamed repository, is refused), JSON, within the cap. */
export function feedResponseOk(r: { status: unknown; contentType: unknown; bytes: unknown }): boolean {
  const type = typeof r.contentType === 'string' ? r.contentType.split(';')[0].trim().toLowerCase() : '';
  return r.status === 200 && type === 'application/json' && typeof r.bytes === 'number' && r.bytes >= 0 && r.bytes <= MAX_FEED_BYTES;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** UTF-8 size as TextEncoder writes it (a lone surrogate is 3 bytes), counted without encoding. */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { n += 4; i++; }
    else n += 3;
  }
  return n;
}
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/** An https://github.com URL exactly as written (no normalising), no userinfo, port, query or fragment, path `/<slug><rest>`. */
function githubUrlOk(raw: unknown, slug: string, rest: string): raw is string {
  if (typeof raw !== 'string' || raw.length > 2048 || raw.includes('?') || raw.includes('#')) return false;
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.href !== raw || u.protocol !== 'https:' || u.host !== 'github.com' || u.username || u.password || u.port || u.search || u.hash) return false;
  const head = '/' + slug;
  return u.pathname.slice(0, head.length).toLowerCase() === head.toLowerCase() && u.pathname.slice(head.length) === rest;
}

function readAsset(a: unknown, slug: string, tag: string): FeedAsset | undefined {
  if (!isObj(a)) return undefined;
  const { name, size, browser_download_url: url } = a;
  if (typeof name !== 'string' || !ASSET_NAME_RE.test(name) || name.includes('..')) return undefined;
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0 || size > MAX_ASSET_BYTES) return undefined;
  return githubUrlOk(url, slug, `/releases/download/${tag}/${name}`) ? { name, size, url } : undefined;
}

function readRelease(e: Record<string, unknown>, slug: string): (FeedRelease & { skip: boolean }) | undefined {
  const { tag_name: tag, draft, prerelease, published_at: at, html_url: html, body, assets } = e;
  if (typeof tag !== 'string' || !tag.startsWith('v')) return undefined;
  const version = parseVersionField(tag);
  if (!version || typeof draft !== 'boolean' || typeof prerelease !== 'boolean') return undefined;
  if (typeof at !== 'string' || !ISO_RE.test(at) || Number.isNaN(Date.parse(at))) return undefined;
  if (!githubUrlOk(html, slug, `/releases/tag/${tag}`)) return undefined;
  if (!(body === null || (typeof body === 'string' && body.length <= MAX_BODY_BYTES && utf8Bytes(body) <= MAX_BODY_BYTES))) return undefined;
  if (!Array.isArray(assets) || assets.length > MAX_ASSETS) return undefined;
  const list = assets.map((a) => readAsset(a, slug, tag));
  if (list.some((a) => !a)) return undefined;
  return { tag, version, publishedAt: at, htmlUrl: html, body: body ?? '', assets: list as FeedAsset[], skip: draft || prerelease || version.includes('-') };
}

/** The parsed list body for `slug` (FR-008): stable releases newest first, or undefined when the whole feed is refused. */
export function validateFeed(json: unknown, slug: unknown): Feed | undefined {
  const s = parseRepoSlug(slug);
  if (!s || !Array.isArray(json) || json.length > FEED_PER_PAGE) return undefined;
  const seen = new Set<string>();
  const out: FeedRelease[] = [];
  const dropped: string[] = [];
  let unplaced = false;
  for (const e of json) {
    if (!isObj(e)) { unplaced = true; continue; }
    if (typeof e.tag_name === 'string') {
      const key = parseVersionField(e.tag_name)?.replace(/(^|\.)0+(?=\d)/g, '$1') ?? e.tag_name;
      if (seen.has(key)) return undefined;
      seen.add(key);
    }
    const r = readRelease(e, s);
    if (r) {
      const { skip, ...rel } = r;
      if (!skip) out.push(rel);
    } else if (e.draft !== true && e.prerelease !== true) {
      const v = typeof e.tag_name === 'string' && e.tag_name.startsWith('v') ? parseVersionField(e.tag_name) : undefined;
      if (v === undefined) unplaced = true;
      else if (!v.includes('-')) dropped.push(v);
    }
  }
  out.sort((a, b) => cmpVersion(b.version, a.version));
  return { releases: out, full: json.length === FEED_PER_PAGE, dropped, unplaced };
}

// ---------------------------------------------------------------------------------------------------------------------
// Target and breaking (FR-009, FR-016)

const nums = (v: string): number[] => v.split('-')[0].split('.').map(Number);
/** Numeric order; a pre-release sorts before its release (only the running version can be one: the feed keeps stable ones). */
export function cmpVersion(a: string, b: string): number {
  const x = nums(a);
  const y = nums(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  const pa = a.includes('-');
  const pb = b.includes('-');
  return pa === pb ? 0 : pa ? -1 : 1;
}

/** `missing`: dropped versions inside the range; `unplaced` copies the feed's; either makes a gap (FR-009). */
export interface TargetPick { target?: FeedRelease; between: FeedRelease[]; installedNewer: boolean; gap: boolean; missing: string[]; unplaced: boolean }

/** The newest stable release above `running`, the releases in between (newest first), and whether the page shows the whole way. */
export function pickTarget(running: unknown, feed: Feed): TargetPick {
  const run = parseVersionField(running);
  const none = { between: [], installedNewer: false, gap: false, missing: [], unplaced: false };
  if (!run || feed.releases.length === 0) return none;
  const newest = feed.releases[0];
  if (cmpVersion(run, newest.version) >= 0) return { ...none, installedNewer: cmpVersion(run, newest.version) > 0 };
  const between = feed.releases.filter((r) => cmpVersion(run, r.version) < 0);
  const oldest = feed.releases[feed.releases.length - 1];
  const listed = feed.releases.some((r) => cmpVersion(r.version, run) === 0);
  const missing = feed.dropped.filter((v) => cmpVersion(run, v) < 0 && cmpVersion(v, newest.version) <= 0);
  const gap = (!listed && (feed.full || cmpVersion(run, oldest.version) < 0)) || missing.length > 0 || feed.unplaced;
  return { target: newest, between, installedNewer: false, gap, missing, unplaced: feed.unplaced };
}

/** Per version, from the target tag's `releases.json` (`parseReleasesJson`, FR-026); undefined = missing or invalid. */
export type ReleaseMarks = ReadonlyMap<string, { breaking: boolean }>;
export type Breaking = 'breaking' | 'unknown' | 'no';

/** FR-009: a marked or major (on 0.x: minor) jump is breaking; unknown is never safe; a gap counts as breaking unless fully covered. */
export function isBreaking(running: unknown, pick: TargetPick, marks: ReleaseMarks | undefined): Breaking {
  const run = parseVersionField(running);
  if (!pick.target || !run) return pick.target ? 'unknown' : 'no';
  const [a, b] = [nums(run), nums(pick.target.version)];
  if (b[0] > a[0] || (a[0] === 0 && b[0] === 0 && b[1] > a[1])) return 'breaking';
  if (marks) {
    for (const [v, m] of marks) if (m.breaking && cmpVersion(run, v) < 0 && cmpVersion(v, pick.target.version) <= 0) return 'breaking';
  }
  const covered = !!marks && !pick.unplaced && pick.between.every((r) => marks.has(r.version)) && pick.missing.every((v) => marks.has(v));
  if (covered) return 'no';
  return pick.gap ? 'breaking' : 'unknown';
}

// ---------------------------------------------------------------------------------------------------------------------
// Notes (FR-010)

export const NOTE_MAX = 8 * 1024;
export const DIALOG_NOTES_MAX = 64 * 1024;
const TRUNCATED_BYTES = ' [truncated]'.length;

/** `s` cut to at most `max` UTF-8 bytes with redact.ts's `cut` (no half token, no half surrogate pair, a marker at the end). */
function clipBytes(s: string, max: number): string {
  let bytes = 0;
  let n = 0;
  const room = max - TRUNCATED_BYTES;
  if (room <= 0) return '';
  while (n < s.length) {
    const step = utf8Bytes(s.slice(n, n + 2)) === 4 ? 2 : 1;
    const b = utf8Bytes(s.slice(n, n + step));
    if (bytes + b > room) break;
    bytes += b;
    n += step;
  }
  return cut(s, n);
}

/**
 * A release body as plain text (FR-010): the WHOLE body is unhidden (redact.ts `HIDDEN_CHARS`), redacted and home-masked first, and
 * only then clipped to `max` UTF-8 bytes, so no cut can leave part of a value unmasked (spec 012: never cut before masking). A body
 * over the feed's 1 MiB cap is not shown at all.
 */
export function notesText(body: unknown, max = NOTE_MAX): { text: string; clipped: boolean } {
  if (typeof body !== 'string') return { text: '', clipped: false };
  if (body.length > MAX_BODY_BYTES || utf8Bytes(body) > MAX_BODY_BYTES) return { text: '', clipped: true };
  const s = maskHomePaths(redact(unhide(body.replace(/\r\n?/g, '\n'))));
  if (utf8Bytes(s) <= max) return { text: s, clipped: false };
  return { text: clipBytes(s, max), clipped: true };
}

/** Every release's notes for the dialog, newest first, the whole at most 64 KiB of UTF-8 (FR-010). */
export function dialogNotes(releases: readonly FeedRelease[]): { version: string; text: string; clipped: boolean }[] {
  let left = DIALOG_NOTES_MAX;
  return releases.map((r) => {
    const n = notesText(r.body, Math.min(NOTE_MAX, left));
    left -= utf8Bytes(n.text);
    return { version: r.version, ...n };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Install type and asset (FR-012; names from spec 008's `artifactName` patterns in package.json)

export type InstallType = 'nsis' | 'portable' | 'appimage' | 'dmg' | 'unknown';

export function installType(i: { platform: string; env: Readonly<Record<string, string | undefined>>; packaged: boolean }): InstallType {
  if (!i.packaged) return 'unknown';
  if (i.platform === 'win32') return i.env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'nsis';
  if (i.platform === 'linux') return i.env.APPIMAGE ? 'appimage' : 'unknown';
  return i.platform === 'darwin' ? 'dmg' : 'unknown';
}

/** The expected file name for this install type, arch and version (never the feed's), or undefined when none is built. */
export function expectedAssetName(type: InstallType, arch: string, version: string): string | undefined {
  if (!parseVersionField(version) || version.startsWith('v')) return undefined;
  if (type === 'dmg') return arch === 'arm64' || arch === 'x64' ? `Agent-Durbar-${version}-${arch}.dmg` : undefined;
  if (arch !== 'x64') return undefined;
  if (type === 'nsis') return `Agent-Durbar-Setup-${version}.exe`;
  if (type === 'portable') return `Agent-Durbar-${version}-portable.exe`;
  return type === 'appimage' ? `Agent-Durbar-${version}-x86_64.AppImage` : undefined;
}

/** The release's asset with exactly the expected name (FR-012, FR-013), or undefined. */
export function assetFor(type: InstallType, arch: string, release: FeedRelease): FeedAsset | undefined {
  const name = expectedAssetName(type, arch, release.version);
  return name === undefined ? undefined : release.assets.find((a) => a.name === name);
}

// ---------------------------------------------------------------------------------------------------------------------
// Cadence, policy, snooze and skip (FR-004, FR-005, FR-016, FR-021)

export const DAY_MS = 24 * 60 * 60 * 1000;
export const SNOOZE_MS = 7 * DAY_MS;
export type SourceOrigin = 'env' | 'ci' | 'local';
export type SelfPolicy = { state: 'none' } | { state: 'unreadable' } | { state: 'ok'; updatesMode?: unknown; feedUrl?: unknown };

/** FR-005: `off`, an unknown mode or an unreadable policy hide the feature; a `feedUrl` other than a github.com repository blocks the check. */
export function selfPolicyView(p: SelfPolicy | undefined): { hidden: boolean; blocked: boolean; feedSlug?: string } {
  if (!p) return { hidden: true, blocked: true };
  if (p.state === 'none') return { hidden: false, blocked: false };
  if (p.state !== 'ok') return { hidden: true, blocked: true };
  const mode = p.updatesMode;
  if (!(mode === undefined || mode === 'notify' || mode === 'auto')) return { hidden: true, blocked: true };
  if (p.feedUrl === undefined) return { hidden: false, blocked: false };
  const ok = typeof p.feedUrl === 'string' && p.feedUrl.startsWith(GH) ? parseRepoSlug(p.feedUrl) : undefined;
  return ok ? { hidden: false, blocked: false, feedSlug: ok } : { hidden: false, blocked: true };
}

export interface CadenceInput {
  now: number;
  packaged: boolean;
  simulator: boolean;
  /** The baked source's origin; undefined = no valid `updatesource.json`, so no check at all (FR-001). */
  origin: SourceOrigin | undefined;
  /** `updates.selfCheck` as read; anything but a boolean is absent (FR-021) and takes the default. */
  selfCheck: unknown;
  policy: SelfPolicy | undefined;
  lastCheckAt: unknown;
}

/** May *Check now* contact the source? Packaged, not the simulator, a baked source, the policy allowing it; the switch does not matter. */
export const manualCheckAllowed = (i: CadenceInput): boolean => i.packaged && !i.simulator && i.origin !== undefined && !selfPolicyView(i.policy).blocked;

/** Is the daily check on (D2 = on by default, a `local` build off by default)? Asked before arming and again when an answer arrives. */
export const selfCheckOn = (i: CadenceInput): boolean => manualCheckAllowed(i) && (typeof i.selfCheck === 'boolean' ? i.selfCheck : i.origin !== 'local');

/** FR-004 (D5 = B): due when on and the last check is absent, older than 24 h or in the future; `waitMs` is when to look again (none when off). */
export function cadenceDue(i: CadenceInput): { due: boolean; waitMs?: number } {
  if (!selfCheckOn(i)) return { due: false };
  const last = typeof i.lastCheckAt === 'number' && Number.isFinite(i.lastCheckAt) ? i.lastCheckAt : undefined;
  if (last === undefined || last > i.now || i.now - last >= DAY_MS) return { due: true, waitMs: DAY_MS };
  return { due: false, waitMs: DAY_MS - (i.now - last) };
}

/** FR-016: skip hides that version (and older); a snooze hides the toast and badge for its version, at most 7 days (a longer one is ignored). */
export function snoozeState(now: number, version: string, snooze: unknown, skip?: unknown): 'show' | 'snoozed' | 'skipped' {
  const sk = parseVersionField(skip);
  if (sk && cmpVersion(version, sk) <= 0) return 'skipped';
  if (isObj(snooze) && parseVersionField(snooze.version) === version && typeof snooze.until === 'number') {
    if (snooze.until > now && snooze.until <= now + SNOOZE_MS) return 'snoozed';
  }
  return 'show';
}

// ---------------------------------------------------------------------------------------------------------------------
// Strict JSON files: `releases.json` (FR-026) and the baked `updatesource.json` (FR-001)

/** Valid JSON whose objects, at any depth, repeat no key (decoded: `"a"` and `"\u0061"` are one key); JSON.parse alone keeps the last. Else undefined. */
export function parseStrictJson(text: string): unknown {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return undefined; }
  const stack: { keys: Set<string> | null; expectKey: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      const top = stack[stack.length - 1];
      if (top?.keys && top.expectKey) {
        const key = JSON.parse(text.slice(i, j + 1)) as string;
        if (top.keys.has(key)) return undefined;
        top.keys.add(key);
        top.expectKey = false;
      }
      i = j;
    } else if (c === '{') stack.push({ keys: new Set(), expectKey: true });
    else if (c === '[') stack.push({ keys: null, expectKey: false });
    else if (c === '}' || c === ']') stack.pop();
    else if (c === ',') { const top = stack[stack.length - 1]; if (top?.keys) top.expectKey = true; }
  }
  return value;
}
const exactKeys = (o: Record<string, unknown>, keys: readonly string[]): boolean => {
  const k = Object.keys(o);
  return k.length === keys.length && keys.every((x) => Object.prototype.hasOwnProperty.call(o, x));
};

/** UTF-8 bytes to text, or undefined when they are not UTF-8. A byte-order mark is KEPT (`ignoreBOM`), so the strict parsers refuse it. */
export function decodeUtf8Strict(bytes: Uint8Array): string | undefined {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return undefined; }
}

export const MAX_RELEASES_JSON_BYTES = 256 * 1024;
export const MAX_RELEASES_JSON_VERSIONS = 500;
export const RELEASE_TEXT_MAX = 500;
const PART = '(?:0|[1-9]\\d{0,8})';
const VERSION_KEY_RE = new RegExp(`^${PART}\\.${PART}\\.${PART}$`);
const RELEASE_TAG_RE = new RegExp(`^v${PART}\\.${PART}\\.${PART}$`);
/** Plain text (FR-026): no `<`, no control, format (bidi, zero-width), surrogate, line or paragraph separator characters. */
const PLAIN_RE = /^[^<\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]*$/u;
const plain = (v: unknown, min: number): v is string => {
  if (typeof v !== 'string' || v.length > RELEASE_TEXT_MAX * 2 || !PLAIN_RE.test(v)) return false;
  const n = [...v].length;
  return n >= min && n <= RELEASE_TEXT_MAX;
};

export interface ReleaseNote { breaking: boolean; notes: string; action: string }

/** FR-026: the text of a `releases.json`, per version; undefined when anything is not exactly as specified (FR-009: *Breaking: unknown*). */
export function parseReleasesJson(text: unknown): ReadonlyMap<string, ReleaseNote> | undefined {
  if (typeof text !== 'string' || text.length > MAX_RELEASES_JSON_BYTES || utf8Bytes(text) > MAX_RELEASES_JSON_BYTES) return undefined;
  const doc = parseStrictJson(text);
  if (!isObj(doc) || !exactKeys(doc, ['schema', 'versions']) || doc.schema !== 1 || !isObj(doc.versions)) return undefined;
  const keys = Object.keys(doc.versions);
  if (keys.length > MAX_RELEASES_JSON_VERSIONS) return undefined;
  const out = new Map<string, ReleaseNote>();
  for (const v of keys) {
    const e = doc.versions[v];
    if (!VERSION_KEY_RE.test(v) || !isObj(e) || !exactKeys(e, ['breaking', 'notes', 'action'])) return undefined;
    const { breaking, notes, action } = e;
    if (typeof breaking !== 'boolean' || !plain(notes, 1) || !plain(action, breaking ? 1 : 0)) return undefined;
    out.set(v, { breaking, notes, action });
  }
  return out;
}

/** FR-007, FR-009: the one raw-file URL, for a parsed slug and a stable `vMAJOR.MINOR.PATCH` tag (main's own validated feed); else undefined. */
export function releasesJsonUrl(slug: unknown, tag: unknown): string | undefined {
  const s = parseRepoSlug(slug);
  return s && typeof tag === 'string' && RELEASE_TAG_RE.test(tag) ? `https://raw.githubusercontent.com/${s}/${tag}/releases.json` : undefined;
}

export const MAX_UPDATE_SOURCE_BYTES = 1024;
export interface UpdateSource { slug: string; origin: SourceOrigin }
const ORIGINS: readonly string[] = ['env', 'ci', 'local'];

/** FR-001: the baked `dist/main/updatesource.json`, exactly `{slug, origin}` with the slug in its parsed form; anything else = no source. */
export function parseUpdateSourceFile(text: unknown): UpdateSource | undefined {
  if (typeof text !== 'string' || utf8Bytes(text) > MAX_UPDATE_SOURCE_BYTES) return undefined;
  const doc = parseStrictJson(text);
  if (!isObj(doc) || !exactKeys(doc, ['slug', 'origin'])) return undefined;
  const { slug, origin } = doc;
  if (typeof slug !== 'string' || parseRepoSlug(slug) !== slug || typeof origin !== 'string' || !ORIGINS.includes(origin)) return undefined;
  return { slug, origin: origin as SourceOrigin };
}
