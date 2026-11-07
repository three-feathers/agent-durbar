/**
 * Spec 095 FR-030 (T013): the masking of the conversation search, in main, BEFORE anything is matched or cut. It is the replayed-history
 * masking, composed from the existing helpers (no copy of a rule): `maskNoteText` (spec 083 FR-005: the MCP secret values, also when a
 * Markdown mark splits one or sits inside one, every token Markdown splits or glues, `x**ghp_...**`, then `redact`; the Markdown is kept as
 * written; review of PR 1098, finding 1: a value holding `*`, `~`, a backtick or brackets leaked with the mark stripped), then
 * `maskHomePaths`. Like DurbarSafeText
 * (spec 097 FR-030) the masks also read a copy without hidden characters (`unhide`, the window's own function), so a zero-width space
 * cannot hide a token. Pure: no fs, no network, no process, no log. Any failure throws, and the caller drops the hit (fail closed).
 */
import { NOTE_MARK, NOTE_RUN, hiddenCanHide, maskHomePaths, maskNoteText, openKeyBlockStart } from '../shared/redact';

/** Characters of context on each side of a raw hit; the window is then widened to whitespace (never cut inside a token). */
export const WINDOW_CHARS = 600;
const FAILED = '[redaction failed]';

export interface MaskLibs {
  /** DurbarSafeText.unhide (`src/renderer/safetext.js`): the text without default-ignorable and control characters (tab and line ends kept). */
  unhide(s: string): string;
}

/** The MCP secret values (4 characters or more, longest first, as `mcpSecretValues` keeps them). */
export function cleanValues(values: readonly unknown[] | undefined): string[] {
  const out = new Set<string>();
  for (const v of values ?? []) if (typeof v === 'string' && v.length >= 4) out.add(v);
  return [...out].sort((a, b) => b.length - a.length);
}

/** One pass: `maskNoteText` (values, Markdown-split and glued tokens, `redact`), then home paths. Throws when a mask failed. */
function maskOnce(raw: string, vals: readonly string[]): string {
  const m = maskHomePaths(maskNoteText(raw, vals).text);
  if (typeof m !== 'string' || m.includes(FAILED)) throw new Error('mask failed');
  return m;
}

export interface MaskedWindow {
  /** The masked text of the window. */
  text: string;
  /** The window starts at the message's start / ends at its end (no raw context was left out on that side). */
  atStart: boolean;
  atEnd: boolean;
  /** The work this mask cost (`maskWork` units), for the per-message budget. */
  work: number;
}

/**
 * Review of phase 1, finding 4 (FR-022, SC-003): the cost of one mask, estimated before it runs, in microseconds of the VPS (measured
 * 2026-11-04 for `maskNoteText`): 0.55 per character for the linear passes; 2.5 per character when a split mark (`NOTE_MARK`) is present,
 * plus 250 for each token-like run (`NOTE_RUN`) next to a mark, which `maskNoteText` checks with `redact` on its own; plus 0.003 per
 * character for each MCP secret value (re-check of the review: 1 000-2 000 values over 20 000 characters took 50-108 ms). Hidden characters
 * (`HIDDEN_CHARS`) that can hide a token triple it (`hiddenCanHide`, the same rule as `maskNoteText`: it masks the text, the copy without
 * them and, when the copy finds something, their union, review of PR 1236); an emoji joiner or variation selector between two non-ASCII
 * characters is inert and costs nothing (issue 1234). `hidden` is whether the text has any: it is then judged here. Measured under load, so it overestimates on an idle machine.
 */
export function maskWork(s: string, hidden = false, values: number | readonly string[] = 0): number {
  const nVals = typeof values === 'number' ? values : values.length;
  const marks = NOTE_MARK.test(s);
  let runs = 0;
  if (marks) {
    for (const m of s.matchAll(new RegExp(NOTE_RUN.source, 'g'))) {
      const i = m.index ?? 0;
      if ((i > 0 && NOTE_MARK.test(s[i - 1])) || (i + m[0].length < s.length && NOTE_MARK.test(s[i + m[0].length]))) runs++;
    }
  }
  const live = hidden && hiddenCanHide(s, typeof values === 'number' ? [] : values);
  return Math.ceil((s.length * (marks ? 2.5 : 0.55) + runs * 250 + nVals * s.length * 0.003) * (live ? 3 : 1));
}
/** The most one mask may cost (estimated, about 25 ms): the same as a message's whole budget (`BUDGET.messageWork`), which is what bounds a slice; a lower cap refused whole masks of mid-size texts the message budget allows (review of PR 1098). */
export const MASK_CALL_WORK = 25_000;

/** Thrown when a mask would cost more than its budget: the caller shows nothing of that message and counts it (fail closed). */
export class MaskBudgetError extends Error {
  constructor() {
    super('mask budget');
  }
}

export interface WindowOptions {
  /** Mask the whole message. */
  whole?: boolean;
  /** Characters of context on each side (default `WINDOW_CHARS`). */
  radius?: number;
  /** The most this mask may cost (default `MASK_CALL_WORK`). */
  budget?: number;
}

export interface Masker {
  /** The whole text masked (a title, or a whole message). Throws when masking is not possible or would cost more than `budget`. */
  maskText(raw: string, values: readonly string[], budget?: number): string;
  /** The window around raw[from, to) masked. Throws when masking is not possible; `MaskBudgetError` when it would cost too much. */
  maskedWindow(raw: string, from: number, to: number, values: readonly string[], o?: WindowOptions): MaskedWindow;
}

const isWs = (c: number): boolean => c === 32 || (c >= 9 && c <= 13) || c === 0xa0 || c === 0x2028 || c === 0x2029 || c === 0x3000 || c === 0xfeff || (c >= 0x2000 && c <= 0x200a);
/** The start of the line holding position i. */
const lineStart = (s: string, i: number): number => (i <= 0 ? 0 : s.lastIndexOf('\n', i - 1) + 1);

export function createMasker(libs: MaskLibs): Masker {
  if (!libs || typeof libs.unhide !== 'function') throw new Error('no unhide');
  const unhide = (t: string): string => {
    const c = libs.unhide(t);
    if (typeof c !== 'string') throw new Error('mask failed');
    return c;
  };
  const maskText = (raw: string, values: readonly string[], budget = MASK_CALL_WORK): string => {
    const s = String(raw);
    const vals = cleanValues(values);
    const c = unhide(s);
    if (maskWork(s, c !== s, vals) > budget) throw new MaskBudgetError();
    // `maskNoteText` reads the copy without hidden characters itself and masks the union with the text as written (spec 084 FR-033,
    // review of PR 1236): a copy alone missed a token that removing a hidden character glued to a word. `c` prices it (one pass, three when `hiddenCanHide`).
    return maskOnce(s, vals);
  };
  const maskedWindow = (raw: string, from: number, to: number, values: readonly string[], o: WindowOptions = {}): MaskedWindow => {
    const s = String(raw);
    const n = s.length;
    const radius = o.radius ?? WINDOW_CHARS;
    const budget = o.budget ?? MASK_CALL_WORK;
    let ws = 0;
    let we = n;
    let whole = o.whole === true;
    if (!whole) {
      ws = Math.max(0, Math.min(n, from) - radius);
      we = Math.min(n, Math.max(from, to) + radius);
      const vals = cleanValues(values);
      /** A known secret value across `at` (it may hold spaces and line ends): where it starts, else `at`. Looked for only around `at`. */
      const valueStart = (at: number): number => {
        let out = at;
        for (const v of vals) {
          const a0 = Math.max(0, at - v.length + 1);
          const a = s.slice(a0, at + v.length - 1).indexOf(v);
          if (a >= 0 && a0 + a < out) out = a0 + a;
        }
        return out;
      };
      for (const v of vals) {
        const b0 = Math.max(0, we - v.length + 1);
        const b = s.slice(b0, we + v.length - 1).indexOf(v);
        if (b >= 0 && b0 + b < we && b0 + b + v.length > we) we = b0 + b + v.length;
      }
      // The left edge moves back until no rule moves it any more (each rule can bring in text another rule needs; at most 4 rounds, else
      // the whole message is masked):
      // - Review finding 1: some `redact` rules read their context to the left on the same line (a `Cookie:` header masks its pairs to the
      //   line's end, the JSON `"Cookie": "` form to its quote, `curl ... -u user:pass`, a `.netrc` `machine ... password`), and some let up
      //   to 8 whitespace characters, line ends too, sit between a name and its value (`password:`, `Authorization:`, `Cookie:`). So the edge
      //   goes back to the start of its line, and over the line before it (and blank lines). A line start more than twice the window back:
      //   the whole message is masked.
      // - A known secret value across the edge comes in whole (re-check of the review: the line rule could bring in only a value's tail).
      // - Review finding 2: a private key block opened before the edge is masked from its BEGIN line (its body has no shape of its own).
      //   The check reads the text without hidden characters, as the masks do (a zero-width space inside BEGIN is still a BEGIN to them);
      //   when hidden characters are there the offset cannot be mapped back, so the whole message is masked.
      /** The start of the line holding `at`, then of the line before it (over blank lines); -1 when that is too far back for context. */
      const lineRule = (at: number): number => {
        if (at <= 0) return 0;
        let p = lineStart(s, at);
        for (let k = 0; k < 9 && p > 0; k++) {
          const q = lineStart(s, p - 1);
          const blank = s.slice(q, p).trim() === '';
          p = q;
          if (!blank) break;
        }
        return at - p > 2 * WINDOW_CHARS ? -1 : p;
      };
      let settled = false;
      ws = lineRule(ws);
      for (let round = 0; round < 4 && ws > 0; round++) {
        let c = valueStart(ws);
        const before = s.slice(0, c);
        const plain = unhide(before);
        // review of PR 1098, finding 2: open by KEY_BLOCK's own grammar (only an END ... PRIVATE KEY closes it, not END CERTIFICATE)
        const bi = openKeyBlockStart(plain);
        if (bi >= 0) {
          if (plain !== before) { ws = -1; break; }
          c = Math.min(c, bi);
        }
        if (c === ws) { settled = true; break; }
        ws = lineRule(c); // a value or a BEGIN moved the edge: its own line's context comes in too
      }
      if (ws < 0 || (ws > 0 && !settled)) whole = true; // a line too long, hidden characters before a BEGIN, or no settling in 4 rounds
      if (!whole) {
        while (ws > 0 && !isWs(s.charCodeAt(ws - 1))) ws--;
        while (we < n && !isWs(s.charCodeAt(we))) we++;
      }
      if (whole) { ws = 0; we = n; }
    }
    const piece = s.slice(ws, we);
    const work = maskWork(piece, unhide(piece) !== piece, cleanValues(values));
    if (work > budget) throw new MaskBudgetError();
    return { text: maskText(piece, values, Infinity), atStart: ws === 0, atEnd: we === n, work };
  };
  return { maskText, maskedWindow };
}

/** Where the MCP secret values come from (main: the folder store and the MCP manager). */
export interface McpValueSources {
  /** The folder's known values; never decrypts, so never prompts the keychain. */
  knownSecretValues(folderKey: string): readonly string[];
  /** True when the vault can be read without a prompt. */
  noPrompt(): boolean;
  /** An open agent's session values; can unlock the vault, so it is called only when `noPrompt()`. */
  secretValuesFor(agentId: string): readonly string[];
}

/**
 * FR-030: the values one session is masked with, taken without any keychain prompt (as spec 083 Notes does): the folder's known values,
 * plus the open agent's session values only when `noPrompt()`. An earlier session gets its folder's values only. Fails closed: a throwing
 * source throws (the caller then searches nothing of that session).
 */
export function scanSecretValues(src: McpValueSources, s: { folderKey: string; agentId?: string; open: boolean }): string[] {
  const out = [...(src.knownSecretValues(s.folderKey) ?? [])];
  if (s.open && s.agentId && src.noPrompt()) out.push(...(src.secretValuesFor(s.agentId) ?? []));
  return cleanValues(out);
}
