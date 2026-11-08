/**
 * Spec 095 T065 (FR-063): the walker of `scripts/test-livehead.ts`. Finds, in a regex source, what a hidden character could change. An atom
 * is a class, an escape, `.`, a literal or a group. It admits non-ASCII when it is: `.`; a non-ASCII literal; a class that is negated
 * (`[^]` too), holds `\S`, `\D`, `\W`, `\p`, `\P`, a non-ASCII literal or a `\u`/`\x` escape above U+007F (a range ends in one of those);
 * `\S`, `\D`, `\W`, `\p`, `\P` or such an escape on its own; a backreference; or a group with any of these inside (alternations included).
 * Flagged (review of PR 1244, rounds 1 and 2):
 * (1) a count that matters on an atom that admits non-ASCII: `{n}` of 2 or more, `{a,b}`, `{a,}` of 2 or more, `?` and `{0,1}` (an inert
 * hidden character takes one of the places);
 * (2) any quantifier, `+` and `*` too, on an atom that admits non-ASCII but does not match every inert hidden character (ZWJ, ZWNJ, ZWSP,
 * VS16, soft hyphen, word joiner, a lone surrogate): `[a-\u00ff]+` stops at a ZWJ where the copy without it goes on. An atom that matches
 * them all (`[^x]+`, `.+`, `\S+`) absorbs them, so `+` and `*` over it do not change;
 * (3) a non-ASCII literal outside a class: a hidden character beside it breaks the adjacency the copy has.
 * Not flagged: plain classes, `\w`, `\s`, `\d`. No rule has the `u` flag (`\w` is ASCII).
 */
export interface Token {
  type: 'esc' | 'class' | 'dot' | 'lit' | 'open' | 'close' | 'other';
  start: number;
  end: number;
  admits: boolean;
}

function escAdmits(s: string): boolean {
  const c = s[1] ?? '';
  if (/[SDWpPk1-9]/.test(c)) return true;
  if (c === 'u') {
    const m = /^\\u(?:\{([0-9a-fA-F]+)\}|([0-9a-fA-F]{4}))/.exec(s);
    return !m || parseInt(m[1] ?? m[2], 16) > 0x7f;
  }
  if (c === 'x') {
    const m = /^\\x([0-9a-fA-F]{2})/.exec(s);
    return !m || parseInt(m[1], 16) > 0x7f;
  }
  return false;
}
const ESC = /^\\(?:u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[pP]\{[^}]*\}|k<[^>]*>|c[A-Za-z]|[^])/;

export function tokens(src: string): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    if (c === '\\') {
      const m = ESC.exec(src.slice(i))!;
      out.push({ type: 'esc', start: i, end: i + m[0].length, admits: escAdmits(m[0]) });
      i += m[0].length;
    } else if (c === '[') {
      let j = i + 1;
      const neg = src[j] === '^';
      if (neg) j++;
      let admits = neg;
      while (j < src.length && src[j] !== ']') {
        if (src[j] === '\\') {
          const m = ESC.exec(src.slice(j))!;
          if (escAdmits(m[0])) admits = true;
          j += m[0].length;
        } else {
          if (src.codePointAt(j)! > 0x7f) admits = true;
          j += src.codePointAt(j)! > 0xffff ? 2 : 1;
        }
      }
      out.push({ type: 'class', start: i, end: j + 1, admits });
      i = j + 1;
    } else if (c === '(') {
      out.push({ type: 'open', start: i, end: i + 1, admits: false });
      i++;
    } else if (c === ')') {
      out.push({ type: 'close', start: i, end: i + 1, admits: false });
      i++;
    } else if (c === '.') {
      out.push({ type: 'dot', start: i, end: i + 1, admits: true });
      i++;
    } else if (c.codePointAt(0)! > 0x7f) {
      const n = src.codePointAt(i)! > 0xffff ? 2 : 1;
      out.push({ type: 'lit', start: i, end: i + n, admits: true });
      i += n;
    } else if (/[|^$?*+{}]/.test(c)) {
      out.push({ type: 'other', start: i, end: i + 1, admits: false });
      i++;
    } else {
      out.push({ type: 'lit', start: i, end: i + 1, admits: false });
      i++;
    }
  }
  return out;
}

const QUANT = /^(?:\{(\d+)(?:(,)(\d*))?\}|([?*+]))\??/;
/** Whether a quantifier's count matters to a hidden character: `?`, a range with an upper bound of 1 or more, a fixed count or an open range from 2 or more. */
function counts(q: RegExpExecArray): boolean {
  if (q[4] === '?') return true;
  if (q[4] !== undefined) return false;
  const a = Number(q[1]);
  if (q[2] === undefined) return a >= 2;
  if (q[3] === '') return a >= 2;
  return Number(q[3]) >= 1 && !(a === 1 && Number(q[3]) === 1);
}
const INERT_HIDDEN = ['\u200d', '\u200c', '\u200b', '\ufe0f', '\u00ad', '\u2060', '\ud83d'];
/** Whether an atom matches every inert hidden character, so a `+` or `*` over it absorbs them. A source that does not compile as an atom alone (a backreference) does not. */
function absorbsHidden(atom: string): boolean {
  try {
    const re = new RegExp(`^(?:${atom})$`);
    return INERT_HIDDEN.every((c) => re.test(c));
  } catch {
    return false;
  }
}

/** Everything of `src` a hidden character could change, as the atom and its quantifier, or `literal x` (see the header). */
export function windowsOf(src: string): string[] {
  const t = tokens(src);
  const out: string[] = [];
  const open: number[] = []; // token indexes of the open brackets
  for (let k = 0; k < t.length; k++) {
    let admits = t[k].admits;
    let from = t[k].start;
    if (t[k].type === 'open') open.push(k);
    if (t[k].type === 'close') {
      const o = open.pop();
      if (o === undefined) continue;
      from = t[o].start;
      admits = t.slice(o + 1, k).some((x) => x.admits);
    } else if (t[k].type === 'open' || t[k].type === 'other') continue;
    if (!admits) continue;
    if (t[k].type === 'lit') out.push(`literal ${src.slice(t[k].start, t[k].end)}`);
    const q = QUANT.exec(src.slice(t[k].end));
    if (!q) continue;
    const atom = src.slice(from, t[k].end);
    if (counts(q) || !absorbsHidden(atom)) out.push(atom + q[0]);
  }
  return out;
}
