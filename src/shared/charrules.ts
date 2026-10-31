/**
 * Rules for a generated character that main, the store and the tests share (spec 096 FR-023, FR-025, FR-030, FR-031). Pure: no Electron, no I/O.
 * What the sandboxed encoder window sends back is untrusted: `parseEncoderReply` takes only the known fields and checks them again.
 */
import { MAX_FRAME_BYTES, checkFrames, stripChunks } from './webpcheck';

export const CHARACTER_ID_RE = /^my-[0-9a-f]{12}$/;
export const MAX_CHARACTERS = 24;
export const MAX_CHARACTER_NAME = 40;
/** The poses in the order of the sheet's panels (FR-010); `blink` is the working pose with the eyes closed (D2). */
export const SHEET_POSES = ['working', 'waiting', 'resting', 'blink'] as const;
export type SheetPose = (typeof SHEET_POSES)[number];
export type FrameSet = { working: Uint8Array; waiting: Uint8Array; resting: Uint8Array; blink?: Uint8Array };
export type FacePoint = [number, number];
export type FaceSet = { working: FacePoint; waiting: FacePoint; resting: FacePoint };

/** FR-025: the picture's side, the round crop of spec 077 (`FACE_CROP` in crew.js) and the default point. */
export const PICTURE_SIDE = 352;
export const FACE_CROP = 235;
export const DEFAULT_FACE: FacePoint = [176, 150];
const FACE_MIN = Math.ceil(FACE_CROP / 2);
const FACE_MAX = PICTURE_SIDE - FACE_MIN;

/** FR-025: a point whose crop stays inside the picture; anything that is not a pair of finite numbers is the default. */
export function clampFace(p: unknown): FacePoint {
  if (!Array.isArray(p) || p.length !== 2 || !p.every((n) => typeof n === 'number' && Number.isFinite(n))) return [DEFAULT_FACE[0], DEFAULT_FACE[1]];
  const c = (n: number): number => Math.min(FACE_MAX, Math.max(FACE_MIN, Math.round(n)));
  return [c(p[0] as number), c(p[1] as number)];
}

/** A point as the store keeps it: already inside the bounds. */
export function isStoredFace(p: unknown): p is FacePoint {
  return Array.isArray(p) && p.length === 2 && p.every((n) => Number.isInteger(n) && (n as number) >= FACE_MIN && (n as number) <= FACE_MAX);
}

/** FR-033: at most this many pins. */
export const MAX_CHARACTER_PINS = 500;
const MAX_FOLDER_KEY = 4096;
/** A folder key as `folderKeyOf` gives it: an absolute POSIX or Windows path of a sane length, no control characters. */
export function isFolderKey(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_FOLDER_KEY && /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(v) && !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(v);
}
/** FR-033, the settings file's `characterPins`: folder key to id; anything else is dropped, and at most 500 are kept. Which ids still exist is checked where they are listed. */
export function parseCharacterPins(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const good = Object.entries(v as Record<string, unknown>).filter(([k, id]) => isFolderKey(k) && typeof id === 'string' && CHARACTER_ID_RE.test(id));
  return Object.fromEntries(good.slice(0, MAX_CHARACTER_PINS)) as Record<string, string>;
}

export type NameResult = { ok: true; name: string } | { ok: false; error: string };
// control characters, line separators and invisible format characters, except the joiner emoji sequences need (as `cleanDescription`)
const NAME_REFUSED_RE = /[\p{Cc}\p{Zl}\p{Zp}]|[^\P{Cf}\u200D]/u;

/**
 * FR-031, plain text of 1-40 characters (code points): `<`, `>`, `{` and `}` are removed. A name holding a control or hidden character is refused,
 * not cleaned (US4 scenario 4; coordinator's choice of 2026-10-31, spec `## Changes`), and so is a name too long: nothing is cut silently.
 */
export function cleanCharacterName(raw: unknown): NameResult {
  if (typeof raw !== 'string' || raw.length > 4 * MAX_CHARACTER_NAME) return { ok: false, error: `Use 1 to ${MAX_CHARACTER_NAME} characters.` };
  if (NAME_REFUSED_RE.test(raw)) return { ok: false, error: 'Remove control or hidden characters from the name.' };
  const name = raw.replace(/[<>{}]/g, '').trim();
  const n = Array.from(name).length;
  if (n < 1 || n > MAX_CHARACTER_NAME) return { ok: false, error: `Use 1 to ${MAX_CHARACTER_NAME} characters.` };
  return { ok: true, name };
}

/** What the encoder window may refuse a picture with, as main says it (the window sends a code, never its own text). */
export const ENCODER_REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  decode: 'The picture could not be read. Try again.',
  size: 'The picture is not what its header says. Try again.',
  separate: 'The poses did not come out separately. Try again.',
  background: 'The background could not be removed. Try again.',
  big: 'The picture came out too large to keep. Try again.',
});
export const ENCODER_FAILED = 'The picture could not be read. Try again.';
/** A frame as it arrives may hold metadata `stripChunks` removes first; anything past this is refused unread. */
const MAX_RAW_FRAME = 4 * MAX_FRAME_BYTES;

export type EncoderResult = { ok: true; frames: Required<FrameSet>; face: FaceSet; notes: string[] } | { ok: false; error: string };

/** FR-022, FR-023: the encoder's one reply, checked as untrusted input. Extra fields are ignored; every frame is stripped and passes `checkFrames`. */
export function parseEncoderReply(msg: unknown): EncoderResult {
  if (!msg || typeof msg !== 'object') return { ok: false, error: ENCODER_FAILED };
  const m = msg as { ok?: unknown; code?: unknown; frames?: unknown; face?: unknown };
  if (m.ok !== true) {
    const refusal = typeof m.code === 'string' && Object.prototype.hasOwnProperty.call(ENCODER_REFUSALS, m.code) ? ENCODER_REFUSALS[m.code] : ENCODER_FAILED;
    return { ok: false, error: refusal };
  }
  if (!Array.isArray(m.frames) || m.frames.length !== SHEET_POSES.length || !Array.isArray(m.face) || m.face.length !== SHEET_POSES.length) return { ok: false, error: ENCODER_FAILED };
  const clean: Uint8Array[] = [];
  for (const f of m.frames as unknown[]) {
    if (!(f instanceof Uint8Array) || f.length > MAX_RAW_FRAME) return { ok: false, error: ENCODER_FAILED };
    const s = stripChunks(f);
    if (!s) return { ok: false, error: ENCODER_FAILED };
    clean.push(s);
  }
  if (checkFrames(clean).length) return { ok: false, error: ENCODER_FAILED };
  const f = m.face as unknown[];
  return { ok: true, frames: { working: clean[0], waiting: clean[1], resting: clean[2], blink: clean[3] }, face: { working: clampFace(f[0]), waiting: clampFace(f[1]), resting: clampFace(f[2]) }, notes: [] };
}
