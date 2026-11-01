#!/usr/bin/env node
/**
 * Spec 012 FR-080 delta 2026-11-01 (T137, issue #1009): the main process and the adapters print nothing unmasked. Every `console.*` under `src/` outside
 * `src/renderer` (the renderer's console is only its own developer tools) may carry fixed text, or a value inside `redact(...)`; passing `console.warn` itself as a
 * callback, or any other variable, is refused. A plain text scan: it reads each call's arguments up to the closing bracket, skipping strings.
 */
const fs = require('fs');
const path = require('path');

const METHOD = /\bconsole\.(?:log|info|warn|error|debug|trace)\b/g;

/** The argument text from the `(` at `open` to its match, split at top-level commas; undefined when it never closes. */
function argsAt(s, open) {
  const out = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < s.length && s[i] !== c; i++) {
        if (s[i] === '\\') i++;
        else if (c === '`' && s[i] === '$' && s[i + 1] === '{') { // skip `${ … }`, nesting counted
          let d = 1;
          for (i += 2; i < s.length && d > 0; i++) { if (s[i] === '{') d++; else if (s[i] === '}') d--; }
          i--;
        }
      }
    } else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) { depth--; if (depth === 0) { out.push(s.slice(start, i)); return out; } } else if (c === ',' && depth === 1) { out.push(s.slice(start, i)); start = i + 1; }
  }
  return undefined;
}

const FIXED = /^(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\$]|\\.|\$(?!\{))*`)$/;
const argOk = (a) => { const t = a.trim(); return t === '' || FIXED.test(t) || /^redact\(/.test(t); };

/** Every problem in one file's text, as `line: why`. Comments are blanked first, so a mention in a comment is not a call. */
function problems(text) {
  const s = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[\s;{}(),])\/\/[^\n]*/g, (m, a) => a + ' '.repeat(m.length - a.length));
  const out = [];
  for (const m of s.matchAll(METHOD)) {
    const line = s.slice(0, m.index).split('\n').length;
    const end = m.index + m[0].length;
    if (s[end] !== '(') { out.push(`${line}: ${m[0]} passed as a value`); continue; }
    const args = argsAt(s, end);
    if (!args) { out.push(`${line}: ${m[0]}: arguments not closed`); continue; }
    if (!args.every(argOk)) out.push(`${line}: ${m[0]} carries a value outside redact()`);
  }
  return out;
}

function tsFiles(dir, skip) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== skip) out.push(...tsFiles(p, skip)); } else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

if (require.main === module) {
  // the check itself
  const BAD = ['console.warn(x);', 'console.error("a", err);', 'console.log(`a ${b}`);', 'f(console.warn);', 'console.info(redact(a), b);', 'console.warn(err.message);', 'console.error(`a`, `${b}`);'];
  const GOOD = ['console.warn("fixed");', "console.log('a, (b)');", 'console.warn(redact(`a ${b}`));', 'console.error("a", redact(e instanceof Error ? e.message : e));', '// console.warn(x)', '/* console.warn(x) */', 'console.log(`plain $5`);'];
  for (const b of BAD) if (!problems(b).length) { console.error(`check-console-mask: should refuse ${b}`); process.exit(1); }
  for (const g of GOOD) if (problems(g).length) { console.error(`check-console-mask: should allow ${g}: ${problems(g)}`); process.exit(1); }
  const root = path.join(__dirname, '..', 'src');
  const found = [];
  for (const f of tsFiles(root, 'renderer')) for (const p of problems(fs.readFileSync(f, 'utf8'))) found.push(`${path.relative(root, f)}:${p}`);
  if (found.length) { console.error(`check-console-mask: unmasked console output (wrap the value in redact()):\n${found.join('\n')}`); process.exit(1); }
  console.log('check-console-mask ok');
}
module.exports = { problems };
