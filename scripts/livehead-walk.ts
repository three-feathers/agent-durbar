/**
 * Spec 095 T065 (FR-063): the walker of `scripts/test-livehead.ts`. Finds, in a regex source, every count that a hidden character could
 * inflate: a quantifier with a count that matters (`{n}` with n of 2 or more, `{a,b}`, `{a,}` with a of 2 or more) on an atom that admits a
 * non-ASCII character. An atom admits one when it is: `.`; a non-ASCII literal; a class that is negated, holds `\S`, `\D`, `\W`, `\p`, `\P`,
 * a non-ASCII literal or a `\u`/`\x` escape above U+007F (a range ends in one of those); `\S`, `\D`, `\W`, `\p`, `\P`, such an escape on its
 * own; a backreference (`\1`, `\k<n>`: what it repeats is unknown); or a group with any of these inside it (alternations included). A plain
 * class, `\w`, `\s`, `\d` and an escaped literal do not (no rule has the `u` flag, so `\w` is ASCII; `\s` is checked by `hiddenCanHide`
 * itself). `?`, `*` and `+` do not count characters: a hidden character in a run they repeat does not change what they match.
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
      if (src[j] === ']') j++;
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

const QUANT = /^\{(\d+)(?:(,)(\d*))?\}/;
/** Whether a quantifier's count matters to a hidden character: a fixed count of 2 or more, a bounded range, an open range from 2 or more. */
function counts(q: RegExpExecArray): boolean {
  const a = Number(q[1]);
  if (q[2] === undefined) return a >= 2;
  if (q[3] === '') return a >= 2;
  return Number(q[3]) >= 2;
}

/** Every counted quantifier of `src` on an atom that admits non-ASCII, as the atom and its count. */
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
    const q = QUANT.exec(src.slice(t[k].end));
    if (q && counts(q)) out.push(src.slice(from, t[k].end + q[0].length));
  }
  return out;
}
