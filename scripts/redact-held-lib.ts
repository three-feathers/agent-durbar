/**
 * What the mask hid before T137, as samples (spec 012 FR-080 delta 2026-11-01, review of #1015): each old rule's own character class, under profiles a fixed sample never has, in the contexts
 * that mask hid it in. `scripts/test-redact-shapes.ts` asserts nothing of them shows. No clock, no download: the same on any machine. Every sample is made up, from a seeded generator, at run time.
 * It was checked once against the old code itself (the mask at the merge base, 997ec2a8): every sample was hidden there too, so a failure here is a loss, not a new wish.
 */
export interface HeldSample { shape: string; profile: string; context: string; text: string; secret: string; bare: boolean; bareOnly: boolean }

const L = 'abcdefghijklmnopqrstuvwxyz';
const U = L.toUpperCase();
const D = '0123456789';
const HEX = 'abcdef' + D;
const CLASSES: Record<string, (extra: string) => string> = { mixed: (x) => L + U + D + x, noDigit: (x) => L + U + x, letters: () => L + U, lower: () => L, upper: () => U, digits: () => D, lowerSep: (x) => L + x, hex: () => HEX };
const PROFILES = [...Object.keys(CLASSES), 'words'];

export function seeded(start: number): (n: number) => number {
  let seed = start;
  return (n) => { seed = (seed * 1664525 + 1013904223) >>> 0; return (seed >>> 8) % n; };
}

type Gen = (p: string, b: (n: number, extra: string, p: string) => string, r: (n: number) => number) => { t: string; s: string };
const flat = (p: string): string => (p === 'words' ? 'mixed' : p);
const up = (a: readonly string[], r: (n: number) => number): string => a[r(a.length)];
/** Old rule -> a sample. `bare`: a token shape, so `maskBareTokenShapes` hides it too; the others are header and URL rules. */
const SHAPES: Record<string, { bare: boolean; gen: Gen }> = {
  github: { bare: true, gen: (p, b, r) => { const s = b(20 + up2(r), '', flat(p) === 'lowerSep' ? 'lower' : flat(p)); return { t: 'gh' + up(['p', 'o', 'u', 's', 'r'], r) + '_' + s, s }; } },
  githubPat: { bare: true, gen: (p, b, r) => { const s = b(20 + up2(r), '_', p); return { t: 'github' + '_pat_' + s, s }; } },
  gitlab: { bare: true, gen: (p, b, r) => { const s = b(20 + up2(r), '_-', p); return { t: 'gl' + 'pat-' + s, s }; } },
  openai: { bare: true, gen: (p, b, r) => { const s = b(20 + up2(r), '_-', p); return { t: 'sk' + up(['-', '-ant-'], r) + s, s }; } },
  bearer: { bare: true, gen: (p, b, r) => { const s = b(8 + up2(r), '._~+/=-', flat(p)); return { t: up(['Bearer', 'bearer', 'BEARER'], r) + ' ' + s, s }; } },
  jwt: { bare: true, gen: (p, b, r) => { const q = flat(p); const a = b(5 + up2(r), '_-', q); const c = b(5 + up2(r), '_-', q); const d = b(5 + up2(r), '_-', q); return { t: 'ey' + 'J' + a + '.' + c + '.' + d, s: a + '.' + c + '.' + d }; } },
  aws: { bare: true, gen: (_p, b, r) => { const s = b(16, '', up(['upper', 'digits'], r)); return { t: up(['AK' + 'IA', 'AS' + 'IA'], r) + s, s }; } },
  slack: { bare: true, gen: (p, b, r) => { const s = b(10 + up2(r), '-', p); return { t: up(['xo' + 'xa', 'xo' + 'xb', 'xo' + 'xp', 'xo' + 'xs', 'xa' + 'pp'], r) + '-' + s, s }; } },
  telegram: { bare: true, gen: (p, b, r) => { const s = b(35, '_-', flat(p)); return { t: b(6 + r(7), '', 'digits') + ':' + s, s }; } },
  discordBot: { bare: true, gen: (p, b, r) => { const q = flat(p); const m = b(6, '_-', q); const c = b(27 + up2(r), '_-', q); return { t: up(['M', 'N', 'O'], r) + up(['D', 'T', 'j', 'z'], r) + b(21 + r(6), '_-', q) + '.' + m + '.' + c, s: m + '.' + c }; } },
  slackHook: { bare: true, gen: (p, b) => { const q = flat(p) === 'lowerSep' ? 'lower' : flat(p); const s = b(9, '', q) + '/' + b(9, '', q) + '/' + b(24, '_-', q); return { t: 'https://hooks.sl' + 'ack.com/services/' + s, s }; } },
  discordHook: { bare: true, gen: (p, b) => { const s = b(18, '', 'digits') + '/' + b(30, '_-', flat(p)); return { t: 'https://disc' + 'ord.com/api/webhooks/' + s, s }; } },
  authorization: { bare: false, gen: (p, b, r) => { const s = b(8 + up2(r), '._~+/=-', flat(p)); return { t: 'Authori' + 'zation: ' + up(['', 'Bearer ', 'Basic '], r) + s, s }; } },
  urlCredential: { bare: false, gen: (p, b, r) => { const s = b(8 + up2(r), '._~-', flat(p)); return { t: up(['https', 'redis', 'postgres'], r) + '://u:' + s + '@host.example/x', s }; } },
  tid: { bare: false, gen: (p, b, r) => { const s = b(12 + up2(r), '=:_.-', flat(p)); return { t: 'ti' + 'd=' + b(8 + r(30), '', 'hex') + ';exp=1;' + s, s }; } },
  query: { bare: false, gen: (p, b, r) => { const s = b(8 + up2(r), '._~+/=-', flat(p)); return { t: 'https://h.example/cb?' + up(['code', 'state', 'id_token', 'access_token', 'refresh_token', 'client_secret'], r) + '=' + s, s }; } },
};
function up2(r: (n: number) => number): number { return [0, 0, 1, 3, 16, 60][r(6)]; }

/** Text around a token: where the old start rule let it begin, and where later rules could interfere. */
const CONTEXTS: Record<string, (x: string) => string> = {
  bare: (x) => x, words: (x) => `see ${x} now`, doubleQuote: (x) => `"${x}"`, singleQuote: (x) => `'${x}'`, equals: (x) => `x=${x}`,
  encoded: (x) => `q=%3D${x}`, encodedQuote: (x) => `%22${x}%22`, encodedTwice: (x) => `%253D${x}`, encodedDeep: (x) => `%${'25'.repeat(12)}3D${x}`, bare25: (x) => `2541${x}`, bare2525: (x) => `252541${x}`, noPercent: (x) => `253D${x}`,
  printable: (x) => `=3D${x}`, unicode: (x) => `%u003D${x}`, newline: (x) => `\\n${x}`, tab: (x) => `\\t${x}`, escaped: (x) => `\\u0041${x}`, hexEscape: (x) => `\\x41${x}`,
  pipe: (x) => `${x}|sh`, semicolon: (x) => `${x};id`, subst: (x) => `${x}$(id)`, comma: (x) => `a,${x},b`,
};
/** Token shapes only: glued where a later prefix could take the head of the token, or with no break at all. The header and URL rules do not start here on the old mask either. */
const BARE_CONTEXTS: Record<string, (x: string) => string> = {
  underscore: (x) => `_${x}_`, snake: (x) => `my_${x}`, snake2: (x) => `__${x}__`, markdown: (x) => `**${x}**`,
  afterFo: (x) => `fo${'1_'}${x}`, afterRe: (x) => `re${'_abcdefgh_'}${x}`, afterSb: (x) => `sb_${'secret_'}${x}`, afterSha: (x) => `sha${'256~'}${x}`, afterRk: (x) => `rk${'_live_'}${x}`, afterHvs: (x) => `hv${'s.'}${x}`, afterDp: (x) => `dp${'.pt.'}${x}`, cookieValue: (x) => `Cookie: a=${x}; b=1`, curl: (x) => `curl -u me:${x} https://h.example`, netrc: (x) => `machine h password ${x}`, password: (x) => `password=${x}`,
};

/** n samples, always the same n: every old rule under every profile, in every context in turn. */
export function heldSamples(n: number): HeldSample[] {
  const r = seeded(20261102);
  const body = (len: number, extra: string, p: string): string => {
    if (p === 'words') {
      const sep = extra.includes('-') ? '-' : extra.includes('_') ? '_' : '';
      let w = '';
      while (w.length < len) { let part = ''; for (let i = 0, k = 1 + r(9); i < k; i++) part += L[r(26)]; w += (w && sep ? sep : '') + part; }
      return w;
    }
    const cs = CLASSES[p](extra);
    let s = '';
    for (let i = 0; i < len; i++) s += cs[r(cs.length)];
    return s;
  };
  const out: HeldSample[] = [];
  const shapes = Object.keys(SHAPES);
  const all = { ...CONTEXTS, ...BARE_CONTEXTS };
  const contexts = Object.keys(all);
  for (let i = 0; i < n; i++) {
    const shape = shapes[i % shapes.length];
    const profile = PROFILES[Math.floor(i / shapes.length) % PROFILES.length];
    const def = SHAPES[shape];
    const context = contexts[r(contexts.length)];
    const barely = context in BARE_CONTEXTS;
    if (barely && !def.bare) continue;
    if (shape === 'tid' && !['bare', 'words', 'doubleQuote', 'singleQuote', 'equals', 'pipe', 'semicolon', 'subst', 'comma'].includes(context)) continue; // its start never followed an escape
    if (shape === 'telegram' && (context === 'underscore' || context === 'snake2')) continue; // it must not be followed by `_`
    const g = def.gen(profile, body, r);
    out.push({ shape, profile, context, text: all[context](g.t), secret: g.s, bare: def.bare, bareOnly: barely });
  }
  return out;
}

/** Where the old mask hid this sample: a header or URL rule only in `redact`, an argument split at spaces has no `Bearer` left, a webhook's path is kept by the URL mask. */
export function heldSurfaces(h: HeldSample): string[] {
  if (h.bareOnly) return ['redact', 'shapes'];
  const on = ['redact', 'command', 'note'];
  if (h.bare) on.push('shapes');
  if (!/Hook$/.test(h.shape)) on.push('url');
  if (!/authorization|bearer|Hook|tid/.test(h.shape)) on.push('args');
  return on;
}

/** The longest piece of `secret` left in `out`, counted from 8 characters (a shorter piece is a coincidence, or a prefix); 0 when none. */
export function longestSurvivor(secret: string, out: string): number {
  const floor = Math.min(8, secret.length);
  let best = 0;
  let len = floor;
  for (let i = 0; i + len <= secret.length; ) {
    if (out.includes(secret.substr(i, len))) { best = len; len++; } else i++;
  }
  return best;
}

/** The JWT rule as it was a regex (one quantified lookbehind start, a bare `25XX` counting): what the scan must equal. */
export const JWT_HELD = new RegExp(String.raw`(?<=(?:(?<![A-Za-z0-9_-])|(?<=(?:%(?:u[0-9A-Fa-f]{2})?|25)[0-9A-Fa-f]{2}|=[0-9A-F]{2}|\\(?:[nrtbfv]|u[0-9A-Fa-f]{4}|x[0-9A-Fa-f]{2})))_{0,8}(?:[A-Za-z0-9]{1,40}_{1,3}){0,4})eyJ[A-Za-z0-9_-]{5,4096}\.[A-Za-z0-9_-]{5,4096}\.[A-Za-z0-9_-]{5,4096}`, 'g');

/** Text made of what the JWT rule looks at, with runs at its length limits, and nothing another shape takes. */
export function jwtFuzzTexts(n: number): string[] {
  const r = seeded(4096);
  const piece = (): string => {
    const k = r(14);
    if (k < 3) return 'ey' + 'J';
    if (k === 3) return 'bcdf'.repeat(1 + r(3));
    if (k === 4) return '.';
    if (k === 5) return '_';
    if (k === 6) return '25A' + 'B';
    if (k === 7) return '%2' + '5';
    if (k === 8) return ' ';
    if (k === 9) return 'bcdfg';
    if (k === 10) return 'bcdfgh'.repeat(10);
    if (k === 11) return '-';
    if (k === 12) return r(20) === 0 ? 'x'.repeat(4085 + r(20)) : 'bc';
    return '\\n';
  };
  const out: string[] = [];
  for (let i = 0; i < n; i++) { let s = ''; for (let j = 0, m = 2 + r(28); j < m; j++) s += piece(); out.push(s); }
  return out;
}
