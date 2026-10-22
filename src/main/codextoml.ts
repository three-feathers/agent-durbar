/**
 * Small, linear TOML helpers shared by the two Codex `config.toml` readers: the folder scan of spec 061 (`foldersetup.ts`
 * `readCodexMcpToml`, lenient, folder files) and the user-level list of spec 069 (`mcpglobal.ts`, strict, edits the file). The two
 * readers keep their own line loops because they want different things (061 skips what it does not understand; 069 refuses to
 * edit a file it cannot read exactly), but strings, comments and string arrays are read the same way, here (spec 069 change
 * 2026-10-22, review on #489). No regex backtracking: every function is one pass over the line.
 */

/** Cut a `#` comment that is outside quotes. */
export function stripTomlComment(line: string): string {
  let q = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '\\' && q === '"') i++;
      else if (c === q) q = '';
    } else if (c === '"' || c === "'") q = c;
    else if (c === '#') return line.slice(0, i);
  }
  return line;
}

const ESC: Record<string, string> = { '"': '"', '\\': '\\', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', e: '\x1b' };

/** A code point from hex, or undefined when it is not a Unicode scalar value (TOML refuses surrogates and values above U+10FFFF). */
function codePoint(hex: string): string | undefined {
  const n = parseInt(hex, 16);
  if (!Number.isFinite(n) || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return undefined;
  return String.fromCodePoint(n);
}

/**
 * The value of a TOML basic (`"..."`) or literal (`'...'`) string, or undefined when `v` is not exactly one such string. Basic-string
 * escapes are decoded in a single pass, so `"C:\\notes\\tmp"` is `C:\notes\tmp` (not a newline and a tab). TOML 1.1's `\e` and
 * `\xHH` are read too; an escape TOML does not define is kept as written (lenient: the file is the agent app's to judge).
 */
export function tomlUnquote(v: string): string | undefined {
  const m = /^"((?:[^"\\]|\\.)*)"$|^'([^']*)'$/.exec(v.trim());
  if (!m) return undefined;
  if (m[2] !== undefined) return m[2];
  return m[1].replace(/\\(?:u([0-9A-Fa-f]{4})|U([0-9A-Fa-f]{8})|x([0-9A-Fa-f]{2})|(.))/g, (x: string, u4?: string, u8?: string, x2?: string, c?: string) =>
    (u4 ?? u8 ?? x2) !== undefined ? (codePoint((u4 ?? u8 ?? x2) as string) ?? x) : (ESC[c as string] ?? x),
  );
}

/** The strings of a one-line TOML array (`["a", 'b']`); anything that is not a string is skipped. At most `max` items. */
export function tomlStringArray(v: string, max = 64): string[] | undefined {
  const m = /^\[(.*)\]$/.exec(v.trim());
  return m ? (m[1].match(/"(?:[^"\\]|\\.)*"|'[^']*'/g) ?? []).map((x) => tomlUnquote(x) ?? '').slice(0, max) : undefined;
}
