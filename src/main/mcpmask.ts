/** Masking of MCP server status text before it leaves main (spec 019 FR-021). Pure: no Electron, so it is unit tested. */
import type { AgentEvent, McpServerStatus } from '../adapters/types';
import type { McpServerSpec } from '../shared/mcp';
import { classifyMcpCall } from '../shared/mcpcall';
import type { EditInfo } from '../shared/edits';
import { MASK_INPUT_MAX, ShownRef, cut, hiddenSpans, keepShownWithinRef, shownRef, maskHomePaths, maskNoteText, maskSecretArgs, maskSecretCommand, maskSecretUrl, redact, secretFlag } from '../shared/redact';

export const MCP_ERROR_MAX_CHARS = 300;

/**
 * The secret values a session was given (env and header values of its servers: folder extras, Claude Code's user list, and since spec 069
 * FR-070 a Copilot agent's Copilot CLI list, after `plainSettingValue`), longest first; under 4 characters are skipped since they would
 * mangle every string.
 */
export function mcpSecretValues(...lists: (Readonly<Record<string, McpServerSpec | Pick<McpServerSpec, 'env' | 'headers'>>> | undefined)[]): string[] {
  const out = new Set<string>();
  for (const s of lists.flatMap((l) => Object.values(l ?? {}))) for (const v of [...Object.values(s.env ?? {}), ...Object.values(s.headers ?? {})]) if (typeof v === 'string' && v.length >= 4) out.add(v);
  return [...out].sort((a, b) => b.length - a.length);
}

/** Spec 069 FR-070: words that cannot be a secret, left out under any name (`AUTH_ENABLED: true` stays readable). */
const NEVER_SECRET = /^(?:true|false|none|null)$/i;
/** FR-070 (second review of #1650): a media type with a registered top-level type only (`admin/s3cr3t-passw0rd` is not one). */
const MEDIA_TYPE = /^(?:application|audio|font|haptics|image|message|model|multipart|text|video)\/[a-z0-9][a-z0-9.+-]{0,60}$/;
/** FR-070 (third review of #1650): a cloud region on its real prefixes and directions (`us-east-1`, `ap-southeast-2`, `us-gov-west-1`), not a passphrase shape. */
const REGION = /^(?:us|eu|ap|sa|ca|me|af|il|mx|cn)(?:-gov|-iso[a-z]?)?-(?:north|south|east|west|central|northeast|northwest|southeast|southwest)-\d{1,2}$/;
/** FR-070 (third review of #1650): a URL path segment or left-most host label that is a plain word: lower-case words, `v3`, up to 6 digits. */
const PLAIN_WORD = /^(?:\.?[a-z]{1,16}(?:[-_.][a-z]{1,16}){0,3}|v\d{1,3}|\d{1,6})$/;
/** FR-070 (fourth review of #1650): `PLAIN_WORD` within the 40-character cap of a segment or label (a long letters-only chain is masked). */
const plainWord = (x: string): boolean => x.length <= 40 && PLAIN_WORD.test(x);
const URL_SEGMENT = /^[A-Za-z0-9._~-]{0,40}$/;
const PATH_SEGMENT = /^[A-Za-z0-9._~ -]{0,40}$/;
/** A host label or path segment that looks like a key: upper case, lower case and digits together, or letters and digits in 16+ characters. */
function tokenLike(seg: string): boolean {
  const digit = /\d/.test(seg);
  return (digit && /[A-Z]/.test(seg) && /[a-z]/.test(seg)) || (digit && seg.length >= 16 && /[A-Za-z]/.test(seg));
}
const plainSegments = (segs: readonly string[], shape: RegExp): boolean => segs.every((x) => shape.test(x) && !tokenLike(x));
/** `localhost`, or a dotted host name or IPv4 address, each label plain. */
const plainHost = (h: string): boolean => (h.toLowerCase() === 'localhost' || /^[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})+$/.test(h)) && plainSegments(h.split('.'), URL_SEGMENT)
  && plainWord(h.split('.')[0]); // the left-most label, where tunnel and function ids sit (`abc123.ngrok.io`)
/** An http(s) URL with no user-info, query or fragment, a plain host (optional port) and every path segment a plain word (or empty). */
function plainUrl(v: string): boolean {
  const m = /^https?:\/\/([^/?#@\s:]+)(?::\d{1,5})?(\/[^?#@\s]*)?$/i.exec(v);
  return !!m && plainHost(m[1]) && (m[2] ?? '').split('/').every((x) => x === '' || plainWord(x));
}
/** `localhost:3000`, `db.internal:5432` (a one-word host like `admin:12345` is not one: it reads as a user and a PIN). */
function plainHostPort(v: string): boolean {
  const m = /^([^:\s]+):\d{1,5}$/.exec(v);
  return !!m && plainHost(m[1]);
}
/** An absolute path (`/usr/local/bin`, `C:\Program Files\nodejs`, `~/bin`) with plain segments. */
function plainPath(v: string): boolean {
  const m = /^(?:\/|~[\\/]|[A-Za-z]:[\\/])(.*)$/.exec(v);
  return !!m && plainSegments(m[1].split(/[\\/]/), PATH_SEGMENT);
}

/**
 * Spec 069 FR-070 (reviews of #1650): a value of the Copilot CLI list that is a plain setting, not a secret, so under a name with no
 * secret word it does not join the mask list (a plain substring replace would turn it into `[redacted]` everywhere): a number or dotted
 * version of up to 15 digits, one word of up to 16 letters in one case (`true`, `info`, `DEBUG`, `Production`), a media type of a
 * registered top-level type (`application/json`), a plain http(s) URL, a `host:port`, an absolute path, a region (`us-east-1`). Value
 * only: `copilotListValues` applies it only when the name is not secret-looking.
 */
export function plainSettingValue(v: string): boolean {
  if (v.length > 256) return false;
  return (/^[+-]?\d+(?:\.\d+)*$/.test(v) && v.replace(/\D/g, '').length <= 15)
    || /^(?:[a-z]{1,16}|[A-Z]{1,16}|[A-Z][a-z]{1,15})$/.test(v)
    || MEDIA_TYPE.test(v)
    || plainUrl(v)
    || plainHostPort(v)
    || plainPath(v)
    || REGION.test(v);
}

/** FR-070: name words `secretFlag` does not know whose value is a secret (a capability URL is the secret itself); this list only. */
const SETTING_SECRET_WORDS = new Set(['pin', 'otp', 'totp', 'mfa', 'hook', 'webhook', 'dsn', 'seed', 'salt']); // `hooks`: by the ending rule below

/**
 * FR-070: an env or header name whose value is always masked: `secretFlag` (`SMTP_PASSWORD`, `X-Api-Key`, `Authorization`, `Cookie`),
 * or one of `SETTING_SECRET_WORDS` (`PIN_CODE`, `SLACK_WEBHOOK`, `SENTRY_DSN`; `webhook` also inside a word); `secretFlag` is unchanged.
 */
export function secretSettingName(name: string): boolean {
  if (secretFlag(name)) return true;
  const words = String(name ?? '').slice(0, 256).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[\s\-_.]+/);
  // a word ending in hook, hooks or dsn (`SLACKHOOK`, `SENTRYDSN`; fourth review of #1650), never a word starting so (`HOOKUP`)
  return words.some((w) => SETTING_SECRET_WORDS.has(w) || /(?:hooks?|dsn)$/.test(w)) || words.join('').includes('webhook');
}

/**
 * Spec 069 FR-070: the mask values of the Copilot CLI list's env and header maps, longest first: 4+ characters (`mcpSecretValues`' rule),
 * never `true`/`false`/`none`/`null`, and a plain setting value only under a secret-looking name.
 */
export function copilotListValues(maps: readonly Pick<McpServerSpec, 'env' | 'headers'>[]): string[] {
  const out = new Set<string>();
  for (const m of maps) {
    for (const [k, v] of [...Object.entries(m.env ?? {}), ...Object.entries(m.headers ?? {})]) {
      if (typeof v !== 'string' || v.length < 4 || NEVER_SECRET.test(v)) continue;
      if (secretSettingName(k) || !plainSettingValue(v)) out.add(v);
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/** `--token value`, `--api-key=value` and `API_KEY=value` in free text (a failed spawn message can quote the command line). */
function maskFlagValues(s: string): string {
  return s
    .replace(/(^|\s)(--?[A-Za-z][\w.-]{0,60})(\s+)(?!-)(\S+)/g, (m, lead: string, name: string, sp: string) => (secretFlag(name) ? `${lead}${name}${sp}[redacted]` : m))
    .replace(/(^|\s)(-{0,2}[A-Za-z][\w.-]{0,60})=(?!\[redacted\])(\S+)/g, (m, lead: string, name: string) => (secretFlag(name) ? `${lead}${name}=[redacted]` : m));
}

/** Spec 058 FR-067: a failed MCP tool card's output is cut here, after the secret masks and before the slow URL mask (1 MB of `?a=&` took ~0.4 s there); the card shows 20 000 characters. */
export const MCP_CARD_MAX_CHARS = 50_000;

/**
 * Session secret values, then env secrets and secret shapes, both on the whole text; then URL parts and flag values. No cut unless `max`
 * is given (spec 058 FR-067): then the cut comes after the secret masks (so a secret straddling it leaves no head) and the URL and flag
 * masks run on the shorter text.
 */
export function maskMcpText(text: unknown, values: readonly string[] = [], max?: number): string | undefined {
  if (text === undefined || text === null) return undefined;
  let s = typeof text === 'string' ? text : String(text);
  for (const v of values) if (v.length >= 4 && s.includes(v)) s = s.split(v).join('[redacted]');
  s = redact(s); // env values and token shapes on the whole text: linear, about 7 ms per MB
  s = maskHomePaths(s); // spec 058 FR-093 (review on PR #630): `/home/<user>`, `C:\\Users\\<user>` -> `~`, so no user name leaves main
  if (max !== undefined) s = cut(s, max);
  return maskFlagValues(maskSecretUrl(s)); // the slow URL pass runs on the shorter text
}

/** `maskMcpText`, then the cut to 300 characters last, so a secret straddling it leaves no prefix. */
export function maskMcpError(text: unknown, values: readonly string[] = []): string | undefined {
  const s = maskMcpText(text, values);
  return s === undefined ? undefined : cut(s, MCP_ERROR_MAX_CHARS);
}

/** The same list with every `error` masked. */
export function maskMcpStatuses(servers: readonly McpServerStatus[], values: readonly string[] = []): McpServerStatus[] {
  return servers.map((x) => (x.error === undefined ? x : { ...x, error: maskMcpError(x.error, values) }));
}

/**
 * Spec 005 FR-024 (review on #463): a file edit's paths and diffs with the session's secret values removed, then `redact()` again. Only the
 * linear steps: no URL pass (a partial update can carry 20 files of 20,000 characters, many times a second) and no cut (the adapter already
 * cut each diff at a line). Without session values the edit is returned as it is (the adapter's `redact()` already ran).
 */
export function maskEditInfo(edit: EditInfo, values: readonly string[] = []): EditInfo {
  const vs = values.filter((v) => typeof v === 'string' && v.length >= 4);
  if (!vs.length || !edit || !Array.isArray(edit.files)) return edit;
  const m = (s: string): string => {
    for (const v of vs) if (s.includes(v)) s = s.split(v).join('[redacted]');
    return redact(s);
  };
  return {
    ...edit,
    files: edit.files.map((f) => ({ ...f, path: m(String(f.path)), ...(typeof f.diff === 'string' ? { diff: m(f.diff) } : {}), ...(typeof f.movedTo === 'string' ? { movedTo: m(f.movedTo) } : {}) })),
  };
}

/** Spec 005 FR-342 (main half): how deep `maskToolArgs` walks; a value deeper is replaced by the mask (fail closed). */
const ARGS_DEPTH = 8;
const ARGS_MASK = '[redacted]';
/**
 * Spec 005 FR-342 (main half): the work one `maskToolArgs` call may do (review of #2002): array elements and object keys, strings to mask, and characters
 * given to the masks (a word list's characters count again for its whole reading). A first pass counts them without masking anything; past any limit the
 * arguments are replaced by the mask whole (fail closed) with no masking work done, so the time is bounded whatever the arguments hold.
 */
export const ARGS_NODES_MAX = 4096;
export const ARGS_STRINGS_MAX = 256;
export const ARGS_CHARS_MAX = 2 * MASK_INPUT_MAX;
/** `readings`: strings actually read by the masks (a string the masker already read for this call is not read again); `pieces`: pieces merged;
 * `searches`: searches for a piece inside a reading's shown text (at most `WITHIN_MAX` per reading, shared by the words of a list). */
interface ArgsWork { nodes: number; strings: number; chars: number; readings: number; pieces: number; searches: number }
class OverBudget extends Error {}
const noWork = (): ArgsWork => ({ nodes: 0, strings: 0, chars: 0, readings: 0, pieces: 0, searches: 0 });
let lastWork: ArgsWork = noWork();
/** Test only: the work counters of the last `maskToolArgs` call. */
export const _toolArgsWorkForTest = (): ArgsWork => ({ ...lastWork });
/* each counter is checked before it grows, so it never passes its limit */
const spendNodes = (w: ArgsWork, k: number): void => { if (w.nodes + k > ARGS_NODES_MAX) throw new OverBudget(); w.nodes += k; };
const spendChars = (w: ArgsWork, k: number): void => { if (w.chars + k > ARGS_CHARS_MAX) throw new OverBudget(); w.chars += k; };
const spendString = (w: ArgsWork): void => { if (w.strings + 1 > ARGS_STRINGS_MAX) throw new OverBudget(); w.strings++; };
/**
 * The masks' input limit (review of #2002, round 3): the command and word-list readings do not take a string longer than `MASK_INPUT_MAX`, so such a
 * string cannot be masked whole; it is sent empty (what the chip on main showed for an over-limit argument without a blank), never cut: a piece cut
 * before masking could show the head of a value the cut splits.
 */
const overLimit = (s: string): boolean => s.length > MASK_INPUT_MAX;
/**
 * File content next to the file's path (a write's or an edit's text): no window surface shows it (the chip, the task line and the desk read the path, the
 * edit card reads `edit`, masked on its own, FR-024), so it is sent empty without being read (review of #2002, round 4: the cost of a write or an edit).
 */
const CONTENT_KEYS = new Set(['content', 'file_text', 'old_string', 'new_string', 'old_str', 'new_str', 'new_source']);
const hasPath = (o: Record<string, unknown>): boolean => (typeof o.path === 'string' && o.path !== '') || (typeof o.file_path === 'string' && o.file_path !== '');
const skippedContent = (o: Record<string, unknown>, k: string): boolean => CONTENT_KEYS.has(k) && typeof o[k] === 'string' && hasPath(o);
/** A plain JSON-like object (what an adapter parses); anything else (a Map, a Date, a class instance) is replaced by the mask. */
const plainObject = (v: object): boolean => { const p = Object.getPrototypeOf(v); return p === Object.prototype || p === null; };
const ownKeys = (o: object): string[] => { const ks: string[] = []; for (const k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ks.push(k); return ks; };

/** The first pass: the work the masking will do, counted against the limits; nothing is masked. Throws `OverBudget` past a limit. */
function scanArgs(v: unknown, depth: number, w: ArgsWork): void {
  if (typeof v === 'string') { spendString(w); if (!overLimit(v)) spendChars(w, v.length); return; }
  if (v === null || typeof v !== 'object' || depth >= ARGS_DEPTH) return;
  if (Array.isArray(v)) {
    spendNodes(w, v.length); // before the walk: a huge list stops here
    for (const x of v) scanArgs(x, depth + 1, w);
    return;
  }
  if (!plainObject(v)) return;
  for (const k of ownKeys(v)) {
    spendNodes(w, 1);
    const o = v as Record<string, unknown>;
    if (skippedContent(o, k)) spendString(w);
    else scanArgs(o[k], depth + 1, w);
  }
}

type ReadCache = Map<string, string>;
const READ_CACHE_MAX = 64;
/**
 * One string of a call's arguments, read by every mask on the text AS WRITTEN (review of #2002, round 4): `maskNoteText` with the session values (line
 * breaks kept), the command reading (`maskSecretCommand`) and, for a URL, the URL reading, both on the text as written (they do not know
 * the session values; the note mask's own masks of them are kept). The result is the note mask's text, line structure kept, with every piece another reading hides masked too (`keepShownWithin`): what is hidden
 * is the union of what each reading hides, decided by content, never by counting masks, and the masked text is never flattened, so a mask in the window
 * reads the same lines as on the raw text. Nothing hidden by any reading: the string as written.
 */
/** A text as the window reads it flat: every blank run one space, trimmed (how the chip, the task line and the desk read a list's joined text). */
const flatText = (t: string): string => t.replace(/\s+/g, ' ').trim();
/** `keepShownWithin(head, ref)` against a prepared ref (one per reading, shared by the words of a list), counted. Continuation marks: `maskAfterContinuations`. */
function mergeRef(head: string, r: ShownRef, w: ArgsWork): string {
  w.pieces += head.length;
  const before = r.looked;
  const merged = keepShownWithinRef(head, r);
  w.searches += r.looked - before;
  return merged;
}
/**
 * After the merges (review of #2002, round 6): a line of the original that ends with a continuation mark and whose last piece came out masked keeps its
 * mark (also one the note mask took with the value), and the first piece of the next line is masked too: the window joins the lines, so the value may
 * run on there. Lines are kept as they are; when the line count does not match, the whole text is the mask (fail closed).
 */
function maskAfterContinuations(orig: string, out: string): string {
  if (out === orig || !/[\\^`][ \t]*(?:\r\n|\n|\r)/.test(orig)) return out;
  const ol = orig.split(/(\r\n|\n|\r)/), ml = out.split(/(\r\n|\n|\r)/);
  if (ol.length !== ml.length) return ARGS_MASK;
  let carry = false; // the previous line ended in a masked value before its mark
  for (let i = 0; i < ol.length; i += 2) {
    if (carry) ml[i] = ml[i].replace(/^(\s*)\S+/, (_m, b: string) => b + ARGS_MASK); // the value may run on into this piece
    const mk = /([\\^`])([ \t]*)$/.exec(ol[i]);
    carry = false;
    if (mk && i + 1 < ol.length) {
      const last = /(\S+)\s*$/.exec(ml[i]);
      if (last && last[1].includes('[redact')) {
        carry = true;
        if (!/[\\^`]$/.test(last[1])) ml[i] = ml[i].replace(/\s*$/, '') + mk[1] + mk[2];
      }
    }
  }
  return ml.join('');
}
function readArgText(s: string, values: readonly string[], w: ArgsWork, cache?: ReadCache): string {
  if (!s) return s;
  const key = cache && s.length >= 256 ? `${values.join('\u0001')}\u0000${s}` : '';
  if (key && cache!.has(key)) return cache!.get(key)!;
  w.readings++;
  let out = maskNoteText(s, values).text;
  if (out.trim() !== ARGS_MASK) { // the note mask hid the whole value: no other reading can hide more
    // the session values: the note mask hides each of them and keeps those masks, so the other readings need not know them
    const readings: Array<(t: string) => string> = [(t) => maskSecretCommand(t), ...(/:\/\//.test(s) ? [(t: string) => maskSecretUrl(t)] : [])];
    for (const read of readings) out = mergeRef(out, shownRef(read(s)), w);
    out = maskAfterContinuations(s, out);
  }
  if (key) { cache!.set(key, out); if (cache!.size > READ_CACHE_MAX) cache!.delete(cache!.keys().next().value as string); }
  return out;
}
/** `s` with the given sorted, disjoint ranges replaced by one mask each. */
function maskRanges(s: string, ranges: ReadonlyArray<[number, number]>): string {
  let out = '', at = 0;
  for (const [a, b] of ranges) { out += s.slice(at, a) + ARGS_MASK; at = b; }
  return out + s.slice(at);
}
/**
 * Review of #2002, rounds 5 and 6: the window reads a list joined with commas and flat (`String(list)`: the chip, the task line, the desk), where a value
 * can run into the next word and both are hidden. The note mask, the command reading and the URL reading run once on that joined text; what each hides
 * (`hiddenSpans`) is mapped back to every word it covers, so the work is linear in the list's length. A reading that hides something but cannot be placed
 * on the text hides every word (fail closed); a reading that hides nothing changes nothing.
 */
function joinedHidden(words: readonly string[], values: readonly string[], w: ArgsWork): Array<Array<[number, number]>> {
  // the flat joined text, with each character's word and place in it (a collapsed blank run keeps its first character's place; a comma has none)
  let flat = '';
  const word: number[] = [], pos: number[] = [];
  let blank = false;
  words.forEach((x, j) => {
    if (j) { if (blank) { flat += ' '; word.push(-1); pos.push(-1); blank = false; } flat += ','; word.push(-1); pos.push(-1); }
    for (let k = 0; k < x.length; k++) {
      if (/\s/.test(x[k])) { blank = flat.length > 0; continue; }
      if (blank) { flat += ' '; word.push(j); pos.push(k - 1); blank = false; }
      flat += x[k]; word.push(j); pos.push(k);
    }
  });
  w.pieces += flat.length;
  const out: Array<Array<[number, number]>> = words.map(() => []);
  const reads = [maskNoteText(flat, values).text, maskSecretCommand(flat), ...(/:\/\//.test(flat) ? [maskSecretUrl(flat)] : [])];
  for (const r of reads) {
    if (r === flat || !/\[redact/.test(r)) continue; // hides nothing
    for (const [a, b] of hiddenSpans(flat, r)) {
      let k = a;
      while (k < b) {
        const j = word[k];
        if (j < 0) { k++; continue; }
        const from = pos[k];
        let to = from;
        while (k < b && word[k] === j) { to = pos[k] + 1; k++; }
        out[j].push([from, to]);
      }
    }
  }
  // per word: sorted, overlapping ranges joined
  return out.map((rs) => {
    rs.sort((x, y) => x[0] - y[0]);
    const m: Array<[number, number]> = [];
    for (const [a, b] of rs) { if (m.length && a <= m[m.length - 1][1]) m[m.length - 1][1] = Math.max(m[m.length - 1][1], b); else m.push([a, b]); }
    return m;
  });
}
function maskArgValue(v: unknown, values: readonly string[], depth: number, w: ArgsWork, cache?: ReadCache): unknown {
  if (typeof v === 'string') return overLimit(v) ? '' : readArgText(v, values, w, cache);
  if (v === null || typeof v !== 'object') return v;
  if (depth >= ARGS_DEPTH) return ARGS_MASK;
  if (Array.isArray(v)) {
    const out: unknown[] = v.map((x) => maskArgValue(x, values, depth + 1, w, cache));
    // the strings of a list (a command as words) also read whole, on the ORIGINAL words (session values replaced): a word secret only because of the
    // word before it is masked; merged per word by content (`keepShownWithin`), never by counting masks (the session values stay masked: each word's own
    // reading masked them)
    const at = v.flatMap((x, i) => (typeof x === 'string' && !overLimit(x) ? [i] : []));
    if (at.length) {
      const words = at.map((i) => v[i] as string);
      const whole = maskSecretArgs(words);
      // review of #2002, round 6: the whole-list reading is merged only into a word that names a secret or follows one (a flag, `NAME=`, a header
      // word): elsewhere it can hide a harmless shell word (a wrapper's script split into words) that neither the chip nor the word read alone hides
      const named = (x: string | undefined): boolean => typeof x === 'string' && secretFlag(x.replace(/[=:].*$/s, ''));
      at.forEach((i, j) => {
        if (typeof whole[j] !== 'string') { out[i] = ARGS_MASK; return; }
        if (named(words[j]) || named(words[j - 1])) out[i] = mergeRef(out[i] as string, shownRef(whole[j]), w);
      });
      // review of #2002, round 5: the window reads a list joined with commas (`String(list)`: the chip, the task line, the desk), where a value can run
      // into the next word and both are hidden; the same readings on that joined text, merged into every word, so main never hides fewer words
      const hid = joinedHidden(words, values, w); // per word: its characters a joined reading hides (round 6: spans mapped back, linear)
      at.forEach((i, j) => {
        if (hid[j].length) out[i] = mergeRef(out[i] as string, shownRef(maskRanges(words[j], hid[j])), w);
        out[i] = maskAfterContinuations(words[j], out[i] as string);
      });
    }
    return out;
  }
  if (!plainObject(v)) return ARGS_MASK;
  const out: Record<string, unknown> = {};
  const o = v as Record<string, unknown>;
  for (const k of ownKeys(v)) {
    // defineProperty: an own `__proto__` key (JSON.parse makes one) stays a key, not the copy's prototype
    Object.defineProperty(out, k, { value: skippedContent(o, k) ? '' : maskArgValue(o[k], values, depth + 1, w, cache), enumerable: true, writable: true, configurable: true });
  }
  return out;
}
/**
 * Spec 005 FR-342 (main half, issue #1975): a tool call's arguments as the window may hold them, masked in main as well as in the window (defence in
 * depth). Same shape; keys kept; a string up to `MASK_INPUT_MAX` characters that no mask hides anything in is the same string, a longer one is '', file
 * content next to its path is ''. Composes the shared masks only (FR-031). Bounded work (`ARGS_*_MAX`, counted before any masking). Never throws: over
 * the budget, or on any failure, the arguments are replaced by the mask. `cache`: main's masker, so a string already read for the call is not read again.
 */
export function maskToolArgs(args: unknown, values: readonly string[] = [], cache?: ReadCache): unknown {
  const w = noWork();
  try {
    scanArgs(args, 0, w);
    return maskArgValue(args, values, 0, w, cache);
  } catch {
    return ARGS_MASK;
  } finally {
    lastWork = w;
  }
}

/** A call whose arguments went over the budget once: its later events get the mask at once (no work). At most this many calls are remembered. */
const OVER_CALLS_MAX = 1024;
/**
 * Spec 005 FR-342 (main half, review of #2002): `maskToolArgs` for main's `outward`, so repeated events do not repeat the cost. The same arguments object
 * (the window and the debug log both take one event) is masked once; a string already read (an update repeats the start's strings) is not read again;
 * a call (session and call id) whose arguments went over the budget gets the mask for every later event without any work, until it completes or fails.
 */
export function createToolArgsMasker(): (e: AgentEvent, values: readonly string[]) => unknown {
  const seen = new WeakMap<object, unknown>();
  const over = new Set<string>();
  const cache: ReadCache = new Map();
  return (e, values) => {
    if (e.type !== 'toolCall') return undefined;
    const key = `${e.sessionId}\u0000${e.callId}`;
    const ended = e.phase === 'complete' || e.phase === 'failed';
    try {
      if (over.has(key)) return ARGS_MASK;
      const a = e.args;
      if (a !== null && typeof a === 'object' && seen.has(a)) return seen.get(a);
      const m = maskToolArgs(a, values, cache);
      if (m === ARGS_MASK && a !== ARGS_MASK && !ended) {
        over.add(key);
        if (over.size > OVER_CALLS_MAX) over.delete(over.values().next().value as string);
      }
      if (a !== null && typeof a === 'object') seen.set(a, m);
      return m;
    } finally {
      if (ended) over.delete(key);
    }
  };
}

/**
 * Spec 019 FR-022: the copy of an event that may leave main (window, debug sink): an `mcp` event with its errors masked; any other event
 * unchanged (same object). Spec 058 FR-067: every `toolCall` (update, complete or failed) that names an `mcpServer` has its `output` masked too, cut to `MCP_CARD_MAX_CHARS`.
 * Spec 005 FR-024: a `toolCall` with an `edit` (any phase) has its paths and diffs masked with the session values (`maskEditInfo`).
 * Spec 005 FR-342 (main half): a `toolCall` with `args` (any phase) has them masked (`maskArgs`: `maskToolArgs`, or main's `createToolArgsMasker`).
 */
export function maskMcpEvent<E extends AgentEvent>(e: E, values: readonly string[] = [], maskArgs: (e: AgentEvent, values: readonly string[]) => unknown = (x, v) => maskToolArgs(x.type === 'toolCall' ? x.args : undefined, v)): E {
  if (e.type === 'mcp') return { ...e, servers: maskMcpStatuses(e.servers, values) };
  if (e.type !== 'toolCall') return e;
  let out = e;
  if (e.phase !== 'start' && e.mcpServer && e.output !== undefined) out = { ...out, output: maskMcpText(e.output, values, MCP_CARD_MAX_CHARS) };
  if (e.phase === 'failed' && e.mcpServer && out.type === 'toolCall' && classifyMcpCall(out.output) === 'policy') out = { ...out, mcpCall: 'policy' }; // FR-193: from the masked text; the word only
  if (e.edit && values.length) out = { ...out, edit: maskEditInfo(e.edit, values) };
  if (e.args !== undefined) out = { ...out, args: maskArgs(e, values) }; // spec 005 FR-342, main half (issue #1975); main passes its cached masker
  return out;
}

/** Spec 058 FR-067: replayed history (resumed session) with every failed tool's output masked like a live MCP card; other items are the same objects. */
export function maskMcpHistory<H extends { items: { type: string; failed?: boolean; output?: string }[] }>(h: H, values: readonly string[] = []): H {
  return { ...h, items: h.items.map((it) => (it.type === 'tool' && it.failed && it.output !== undefined ? { ...it, output: maskMcpText(it.output, values, MCP_CARD_MAX_CHARS) } : it)) };
}
