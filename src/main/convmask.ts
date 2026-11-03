/**
 * Spec 095 FR-030 (T013): the masking of the conversation search, in main, BEFORE anything is matched or cut. It is the replayed-history
 * masking, composed from the existing helpers (no copy of a rule): the MCP secret values replaced as `maskMcpText` does (spec 058 FR-067),
 * then `redactMarkdown` (spec 073 FR-014: a token split or glued by Markdown, `x**ghp_...**`), then `maskHomePaths`. Like DurbarSafeText
 * (spec 097 FR-030) the masks also read a copy without hidden characters (`unhide`, the window's own function), so a zero-width space
 * cannot hide a token. Pure: no fs, no network, no process, no log. Any failure throws, and the caller drops the hit (fail closed).
 */
import { maskHomePaths, redact, redactMarkdown } from '../shared/redact';

/** Characters of context on each side of a raw hit; the window is then widened to whitespace (never cut inside a token). */
export const WINDOW_CHARS = 600;
const MASK = '[redacted]';
const FAILED = '[redaction failed]';
const MD_ESC = /\\([\\`*_{}[\]()#+\-.!~|<>])/g;
const MD_MARKS = /[*`~[\]]/g;
const HAS_MARK = /[*`~[\]]/;

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

const replaceValues = (s: string, vals: readonly string[]): string => {
  for (const v of vals) if (s.includes(v)) s = s.split(v).join(MASK);
  return s;
};

/** One pass: values, then the Markdown-aware redact (the values also on the text without marks, where a mark may have split one), then home paths. */
function maskOnce(raw: string, vals: readonly string[]): string {
  const u0 = replaceValues(raw, vals).replace(MD_ESC, '$1');
  const u = replaceValues(u0, vals);
  let m: string;
  if (!HAS_MARK.test(raw.replace(MD_ESC, '$1'))) m = redact(u);
  else {
    // the marks come off the text as written (so a value's own `[redacted]` keeps its brackets), then the values go on that text too
    const k0 = raw.replace(MD_ESC, '$1').replace(MD_MARKS, '');
    const r = redactMarkdown(u, replaceValues(k0, vals));
    m = r !== k0 ? r : redact(u); // nothing found once the marks are gone: the text keeps its Markdown
  }
  m = maskHomePaths(m);
  if (typeof m !== 'string' || m.includes(FAILED)) throw new Error('mask failed');
  return m;
}

export interface MaskedWindow {
  /** The masked text of the window. */
  text: string;
  /** The window starts at the message's start / ends at its end (no raw context was left out on that side). */
  atStart: boolean;
  atEnd: boolean;
}

export interface Masker {
  /** The whole text masked (a title, or a whole message). Throws when masking is not possible. */
  maskText(raw: string, values: readonly string[]): string;
  /** The window around raw[from, to) masked; `whole` masks the whole message. Throws when masking is not possible. */
  maskedWindow(raw: string, from: number, to: number, values: readonly string[], whole?: boolean): MaskedWindow;
}

const isWs = (c: number): boolean => c === 32 || (c >= 9 && c <= 13) || c === 0xa0 || c === 0x2028 || c === 0x2029 || c === 0x3000 || c === 0xfeff || (c >= 0x2000 && c <= 0x200a);

export function createMasker(libs: MaskLibs): Masker {
  if (!libs || typeof libs.unhide !== 'function') throw new Error('no unhide');
  const maskText = (raw: string, values: readonly string[]): string => {
    const s = String(raw);
    const vals = cleanValues(values);
    const c = libs.unhide(s);
    if (typeof c !== 'string') throw new Error('mask failed');
    if (c === s) return maskOnce(s, vals);
    const m = maskOnce(c, vals);
    return m === c ? maskOnce(s, vals) : m; // the copy without hidden characters is shown only when it hid something (as DurbarSafeText's unhid)
  };
  const maskedWindow = (raw: string, from: number, to: number, values: readonly string[], whole = false): MaskedWindow => {
    const s = String(raw);
    const n = s.length;
    let ws = whole ? 0 : Math.max(0, Math.min(n, from) - WINDOW_CHARS);
    let we = whole ? n : Math.min(n, Math.max(from, to) + WINDOW_CHARS);
    if (!whole) {
      // a known secret value across an edge comes in whole (it may hold spaces)
      for (const v of cleanValues(values)) {
        const a = s.indexOf(v, Math.max(0, ws - v.length + 1));
        if (a >= 0 && a < ws && a + v.length > ws) ws = a;
        const b = s.indexOf(v, Math.max(0, we - v.length + 1));
        if (b >= 0 && b < we && b + v.length > we) we = b + v.length;
      }
      // a private key block opened before the window is masked from its BEGIN line (its body has no shape of its own)
      const before = s.slice(0, ws).toLowerCase();
      const bi = before.lastIndexOf('-----begin');
      if (bi >= 0 && bi > before.lastIndexOf('-----end')) ws = bi;
      while (ws > 0 && !isWs(s.charCodeAt(ws - 1))) ws--;
      while (we < n && !isWs(s.charCodeAt(we))) we++;
    }
    return { text: maskText(s.slice(ws, we), values), atStart: ws === 0, atEnd: we === n };
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
