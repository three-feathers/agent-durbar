#!/usr/bin/env node
/**
 * Spec 012 FR-080 delta 2026-11-01 (T137, issue #1009): outside `src/renderer` (whose console is only its own developer tools), nothing printed may carry a value that is not masked.
 * Read from the TypeScript syntax tree, so spacing, comments and `console["warn"]` make no difference. Every argument of a `console.*` call, or of `process.stdout.write` or
 * `process.stderr.write`, must be fixed text or one direct `redact(...)` call (`redact(a) + b` is refused). `console` and those streams may not be used any other way: no alias
 * (`const c = console`, `const { warn } = console`), no callback (`f(console.warn)`), no `console['warn']`.
 * Limits, not caught (this is a guard against slips, not against a determined author; a reviewer still reads the code): `globalThis.console.warn`, `const { stderr } = process`,
 * `const p = process; p.stderr.write`, `import c from "console"`, `require("console").warn`, `require("fs").writeSync(2, x)`, and a local function that happens to be named `redact`.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const fixed = (n) => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n);
const masked = (n) => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'redact';
const unwrap = (n) => { let x = n; while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x)) x = x.expression; return x; };
const isProcess = (n) => ts.isIdentifier(n) && n.text === 'process';
const isStream = (n) => (ts.isPropertyAccessExpression(n) && isProcess(unwrap(n.expression)) && /^std(?:out|err)$/.test(n.name.text)) || (ts.isElementAccessExpression(n) && isProcess(unwrap(n.expression)));

/** Every problem in one file's text, as `line: why`. */
function problems(text, name = 'x.ts') {
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const out = [];
  const say = (n, why) => out.push(`${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}: ${why}`);
  const checkCall = (call, what) => {
    if (!call.arguments.map(unwrap).every((a) => fixed(a) || masked(a))) say(call, `${what} carries a value outside one redact() call`);
  };
  const visit = (n) => {
    if (ts.isIdentifier(n) && n.text === 'console') {
      const p = n.parent;
      const member = ts.isPropertyAccessExpression(p) && p.expression === n;
      const isName = (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n);
      if (!isName) {
        if (member && ts.isCallExpression(p.parent) && p.parent.expression === p) checkCall(p.parent, `console.${p.name.text}`);
        else say(n, 'console used other than as console.method(...)');
      }
    }
    if (isStream(n)) {
      const w = n.parent;
      const call = ts.isPropertyAccessExpression(w) && w.expression === n && w.name.text === 'write' && ts.isCallExpression(w.parent) && w.parent.expression === w ? w.parent : undefined;
      if (call) checkCall(call, 'a process stream');
      else say(n, 'process.stdout or stderr used other than as .write(...)');
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
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
  const BAD = ['console.warn(x);', 'console.error("a", err);', 'console.log(`a ${b}`);', 'f(console.warn);', 'console.info(redact(a), b);', 'console.warn(err.message);', 'console.warn(redact(a)+b);', 'console.dir(x);', 'console.table(x);', 'console.assert(x);', 'console.group(x);', 'console.timeLog(x);', 'console["warn"](x);', 'console . warn ( x );', 'console\n  .warn(x);', 'console/* a */.warn(x);', 'const c = console;', 'const { warn } = console;', 'const w = console.warn; w(x);', '(console).warn(x);', 'console.warn(/* redact( */ x);', 'process.stderr.write(x);', 'process.stdout.write(`a${b}`);', 'const e = process.stderr;', 'process["stderr"].write(x);', 'const s = "x"; /* */ console.warn(s); // console.warn("a")'];
  const GOOD = ['console.warn("fixed");', "console.log('a, (b)');", 'console.warn(redact(`a ${b}`));', 'console.error("a", redact(e instanceof Error ? e.message : e));', '// console.warn(x)', '/* console.warn(x) */', 'const s = "console.warn(x)";', 'console.log(`plain $5`);', 'process.stderr.write(redact(x));', 'const o = { console: 1 }; o.console;', 'console.warn(redact(x) as string);'];
  for (const b of BAD) if (!problems(b).length) { console.error(`check-console-mask: should refuse ${b}`); process.exit(1); }
  for (const g of GOOD) if (problems(g).length) { console.error(`check-console-mask: should allow ${g}: ${problems(g)}`); process.exit(1); }
  const root = path.join(__dirname, '..', 'src');
  const found = [];
  for (const f of tsFiles(root, 'renderer')) for (const p of problems(fs.readFileSync(f, 'utf8'), f)) found.push(`${path.relative(root, f)}:${p}`);
  if (found.length) { console.error(`check-console-mask: unmasked output (wrap the value in redact()):\n${found.join('\n')}`); process.exit(1); }
  console.log('check-console-mask ok');
}
module.exports = { problems };
