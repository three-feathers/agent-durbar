/**
 * The random texts of the `#1593 differential` (spec 012 FR-183, issue #1593): a fixed seed, so every run and every suite that imports it reads the same 2,000
 * texts. Shared by `scripts/test-safetext.ts` and `scripts/test-safetext-links.ts` (spec 012 FR-189), never a copy. Invented values, built from pieces.
 */
export function cases1593(ghp: string, pat: string, sk: string): { cases: Set<string>; z: string } {
  let seed = 1593;
  const rnd = (): number => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = <X,>(xs: readonly X[]): X => xs[Math.floor(rnd() * xs.length)];
  const z = 'gh' + 'p_' + 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2';
  const toks = [ghp, pat, sk, z, 'password=Hx9Kq2Lm7Np4Rs', 'API_KEY=Hx9Kq2Lm7Np4Rs', 'Authorization: Bearer ' + z.slice(4), 'https://u:Hx9Kq2Lm7Np4Rs@h.example/x', 'mysql -pHx9Kq2Lm7Np4Rs'];
  const marks = ['*', '**', '`', '~~', '[', ']', '(', ')', '![', '](u)', '\\', '\\_', '_', '[redacted:', '[redacted]', '<!-- -->', '\u200b', '\n', '\r\n', '```', '# ', '> ', '- ', '[x](', ']a\\b'];
  const words = ['', ' ', 'x', 'word', 'Done.', 'my_branch', 'see ', 'a.b/c', '12345678901234', 'snake_case_name_here'];
  const piece = (): string => {
    const r = rnd();
    if (r < 0.25) { const t = pick(toks); const i = 4 + Math.floor(rnd() * (t.length - 4)); return t.slice(0, i) + pick(marks) + t.slice(i); } // a token split by a mark
    if (r < 0.4) return pick(toks);
    if (r < 0.75) return pick(marks);
    return pick(words);
  };
  const cases = new Set<string>();
  while (cases.size < 2000) { let t = ''; const k = 1 + Math.floor(rnd() * 24); for (let i = 0; i < k; i++) t += piece(); cases.add(t); }
  return { cases, z };
}
