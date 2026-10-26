/**
 * The weekly test audit's mutation helper (spec 021 FR-058): the only command the audit's Claude session may run. It changes one exact,
 * unique snippet in one file of the audit worktree, runs one `test:*` suite, puts the file back and prints the result as JSON.
 *
 *   node weekly-test-audit-mutate.js baseline --test test:theme
 *   node weekly-test-audit-mutate.js mutate --test test:theme --file scripts/test-theme.ts --find '<exact text>' --replace '<new text>'
 *
 * The worktree is DURBAR_AUDIT_WORKTREE (absolute; set by scripts/weekly-test-audit.sh, never by Claude). Only files under src/ or
 * scripts/ (not the audit's own files, not links) can change, by a small edit that adds no way to load code or reach the system
 * (FORBIDDEN); a suite is run as its `node <file>` steps from package.json, without a shell, with a time limit and without token
 * variables. One run at a time (a lock file); the file is restored in a `finally`. These checks are defence in depth: the test code it
 * runs can still do anything the audit's unix user can, which is why that user has no token, no `gh` login and no view of the owner's home.
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { redact } from '../src/shared/redact';

export const MAX_SNIPPET = 200;
/**
 * Defence in depth only (the real guard is the separate unix user, docs/agent-setup/README.md): a mutant is a small, single-site edit.
 * It may not add a way to load code, reach the system or build code from text. Counted in the whole file, before and after, so removing
 * text around a word cannot form one either.
 */
export const FORBIDDEN = [/\brequire\b/g, /\bimport\b/g, /\bprocess\b/g, /child_process/g, /\bfs\b/g, /\bfetch\b/g, /\beval\b/g, /\bFunction\b/g,
  /\bglobalThis\b/g, /\bglobal\b/g, /\bmodule\b/g, /\bexports\b/g, /\bconstructor\b/g, /\bprototype\b/g, /__proto__/g, /\bBuffer\b/g, /\bspawn/g,
  /\bexec/g, /\bWebSocket\b/g, /\bXMLHttpRequest\b/g, /\bnew\b/g, /\$\{/g, /`/g, /\\x/g, /\\u/g, /\bString\.fromCharCode\b/g, /\batob\b/g, /\bsetTimeout\b/g,
  /\bsetInterval\b/g, /\bsetImmediate\b/g, /\bReflect\b/g, /\bProxy\b/g, /\bwith\b/g, /\bdebugger\b/g];
/** The forbidden words the mutant adds to the file (empty when it adds none). */
export function addsForbidden(before: string, after: string): string[] {
  const count = (t: string, re: RegExp): number => (t.match(re) || []).length;
  return FORBIDDEN.filter((re) => count(after, re) > count(before, re)).map((re) => re.source);
}
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
const TSC_PREFIX = /^tsc -p tsconfig\.scripts\.json\s*&&\s*/;
const SECRET_ENV = /^(GH_|GITHUB_|DURBAR_AUDIT_GH_TOKEN|ANTHROPIC_|OPENAI_|COPILOT_)|TOKEN|SECRET|PASSWORD|CREDENTIAL/i;

export type Result = { command: string; test: string; file?: string; result: 'pass' | 'fail' | 'killed' | 'survived' | 'compile-error' | 'timeout' | 'refused'; reason?: string; exit?: number | null; output?: string };

/** The `node <file>` steps of a `test:*` suite that `test:serial` runs, or an error. */
export function suiteSteps(pkg: { scripts?: Record<string, string> }, test: string): string[][] | string {
  if (!/^test:[a-z0-9-]{1,40}$/.test(test)) return 'the test must be a test:* script name';
  const scripts = pkg.scripts || {};
  const serial = String(scripts['test:serial'] || '').split('&&').map((s) => s.trim().replace(/^npm run /, ''));
  if (!serial.includes(test) || typeof scripts[test] !== 'string') return `${test} is not in test:serial`;
  const steps = scripts[test].replace(TSC_PREFIX, '').split('&&').map((s) => s.trim().split(/\s+/));
  for (const s of steps) {
    if (s[0] !== 'node' || s.length !== 2 || !/^(dist-scripts\/scripts|scripts)\/[A-Za-z0-9._-]+\.js$/.test(s[1])) return `${test} has a step that is not "node <file>"`;
  }
  return steps.map((s) => s.slice(1));
}

/** A file the helper may change, as an absolute path inside `root`, or an error. */
export function targetPath(root: string, rel: string): { abs: string } | { error: string } {
  if (typeof rel !== 'string' || !/^(src|scripts)\/[A-Za-z0-9._\-/]+$/.test(rel) || rel.split('/').some((s) => s === '' || s === '.' || s === '..')) return { error: 'the file must be a plain relative path under src/ or scripts/' };
  if (/^scripts\/(weekly-test-audit|test-weekly-audit)/.test(rel)) return { error: 'the audit\'s own files cannot change' };
  const abs = path.join(root, rel);
  let st: fs.Stats;
  try { st = fs.lstatSync(abs); } catch { return { error: 'no such file' }; }
  if (!st.isFile()) return { error: 'not a regular file (links are refused)' };
  if (st.size > MAX_FILE_BYTES) return { error: 'the file is too big' };
  // no link anywhere on the way (a linked folder would lead out of the worktree)
  const real = fs.realpathSync(abs);
  if (real !== path.join(fs.realpathSync(root), rel)) return { error: 'the path goes through a link' };
  return { abs };
}

function cleanEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) if (!SECRET_ENV.test(k)) out[k] = v;
  return out;
}

type Run = { exit: number | null; timedOut: boolean; output: string };
function runNode(root: string, args: string[], timeoutMs: number, env: NodeJS.ProcessEnv): Run {
  const r = spawnSync(process.execPath, args, { cwd: root, env: cleanEnv(env), encoding: 'utf8', timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024, windowsHide: true, killSignal: 'SIGKILL' });
  const timedOut = !!r.error && /ETIMEDOUT/.test(String((r.error as NodeJS.ErrnoException).code || r.error.message));
  return { exit: r.status, timedOut, output: String(r.stdout || '') + String(r.stderr || '') };
}
const tail = (s: string): string => redact(s).slice(-1500);

function compile(root: string, timeoutMs: number, env: NodeJS.ProcessEnv): Run {
  return runNode(root, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.scripts.json'], timeoutMs, env);
}
function runSuite(root: string, steps: string[][], timeoutMs: number, env: NodeJS.ProcessEnv): Run {
  let output = '';
  for (const s of steps) {
    const r = runNode(root, s, timeoutMs, env);
    output += r.output;
    if (r.timedOut || r.exit !== 0) return { ...r, output };
  }
  return { exit: 0, timedOut: false, output };
}

export function run(argv: string[], env: NodeJS.ProcessEnv, timeoutMs = 300_000): Result {
  const command = argv[0];
  const get = (n: string): string | undefined => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const test = get('--test') || '';
  const refuse = (reason: string): Result => ({ command, test, result: 'refused', reason });
  if (command !== 'baseline' && command !== 'mutate') return refuse('usage: baseline|mutate --test test:name [--file f --find a --replace b]');
  const root = env.DURBAR_AUDIT_WORKTREE || '';
  if (!path.isAbsolute(root) || !fs.existsSync(path.join(root, 'package.json'))) return refuse('DURBAR_AUDIT_WORKTREE is not the audit worktree');
  let pkg: { scripts?: Record<string, string> };
  try { pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { return refuse('cannot read package.json'); }
  const steps = suiteSteps(pkg, test);
  if (typeof steps === 'string') return refuse(steps);
  let target: { abs: string } | undefined;
  let find = '', replace = '', rel = '';
  if (command === 'mutate') {
    rel = get('--file') || '';
    find = get('--find') ?? '';
    replace = get('--replace') ?? '';
    const t = targetPath(root, rel);
    if ('error' in t) return refuse(t.error);
    target = t;
    if (!find || find.length > MAX_SNIPPET || replace.length > MAX_SNIPPET) return refuse(`--find must be 1..${MAX_SNIPPET} characters and --replace at most ${MAX_SNIPPET}`);
    if (!/^[\x20-\x7e]*$/.test(replace)) return refuse('--replace must be one line of printable ASCII');
    if (find === replace) return refuse('--find and --replace are the same');
  }
  const lock = path.join(root, '.weekly-audit-mutate.lock');
  let fd: number;
  try { fd = fs.openSync(lock, 'wx'); } catch { return refuse('another mutation is running; run them one at a time'); }
  try {
    if (command === 'baseline') {
      const r = runSuite(root, steps, timeoutMs, env);
      return { command, test, result: r.timedOut ? 'timeout' : r.exit === 0 ? 'pass' : 'fail', exit: r.exit, output: tail(r.output) };
    }
    const original = fs.readFileSync(target!.abs);
    const text = original.toString('utf8');
    const count = text.split(find).length - 1;
    if (count !== 1) return { command, test, file: rel, result: 'refused', reason: `--find occurs ${count} times; it must occur exactly once` };
    const mutated = text.replace(find, () => replace);
    const added = addsForbidden(text, mutated);
    if (added.length) return { command, test, file: rel, result: 'refused', reason: `the mutant adds ${added.join(', ')}; a mutant may only change logic (defence in depth)` };
    const isTs = rel.endsWith('.ts');
    try {
      fs.writeFileSync(target!.abs, mutated);
      if (isTs) {
        const c = compile(root, timeoutMs, env);
        if (c.timedOut || c.exit !== 0) return { command, test, file: rel, result: 'compile-error', exit: c.exit, output: tail(c.output) };
      }
      const r = runSuite(root, steps, timeoutMs, env);
      return { command, test, file: rel, result: r.timedOut ? 'timeout' : r.exit === 0 ? 'survived' : 'killed', exit: r.exit, output: tail(r.output) };
    } finally {
      fs.writeFileSync(target!.abs, original);
      if (isTs) compile(root, timeoutMs, env);
    }
  } finally {
    fs.closeSync(fd);
    fs.rmSync(lock, { force: true });
  }
}

if (require.main === module) {
  const res = run(process.argv.slice(2), process.env, Number(process.env.DURBAR_AUDIT_STEP_TIMEOUT_MS) > 0 ? Number(process.env.DURBAR_AUDIT_STEP_TIMEOUT_MS) : 300_000);
  process.stdout.write(JSON.stringify(res, null, 1) + '\n');
  process.exitCode = res.result === 'refused' ? 2 : 0;
}
