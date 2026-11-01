/**
 * Pre-review bot, the command line (spec 103). SDK-free: the Agent SDK's `query` and every outside tool are passed in by
 * scripts/prereview/cli.mts, so the tests drive all of it with fakes. Four commands:
 *   prereview <N> [options]        gate (operator's account, has gh), then the runner stage (own unix user when --run-as is set)
 *   prereview run --base <dir>     the runner stage; reads one JSON object on stdin; holds no gh login
 *   prereview post <N> <sha>       posts the stored report as the App, only past the gate of FR-027 (off by default)
 *   prereview install --dest <dir> copies the reviewed code of `main` out of the checkout
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  Ceilings, GATE_QUERY, OWNERS_REQUIRED, ceilingsFrom, clean, factsFromGraphql, maskAll, parseTrusted, refusal, revalidateReport, shaToRead,
} from './prereview-core';
import { Exec, QueryFn, RunDeps, placesFor, runReview } from './prereview-run';
import { Fetch, postComment, readPostConfig } from './prereview-post';

export const MODELS = ['claude-opus-5-5', 'claude-fable-5-1'] as const;
export const DEFAULT_MODEL = 'claude-opus-5-5';
export const DEFAULT_BASE = '/var/lib/durbar-prereview';

export const HELP = `prereview: a read-only first read of one of our PRs (spec 103). Never an approval; posts nothing to GitHub.

  prereview <N> [--replay <sha>] [--diff-only] [--model claude-opus-5-5|claude-fable-5-1] [--runner claude|codex|both]
                [--out <dir>] [--base <dir>] [--run-as <unix user>] [--run-ceiling <usd>] [--pass-ceiling <usd>] [--max-turns <n>]
                [--timeout <seconds>] [--allow-gh-login]
  prereview post <N> <sha> [--base <dir>]     one plain comment as the GitHub App; OFF unless all three owners confirmed (FR-027)
  prereview install --dest <dir>              copy reviewed main out of this checkout

What it cannot do (FR-025, [KNOWN GAP], by design in v1):
  - It runs nothing: no tests, no mutants, no app, no screenshots. A "mutant gap" is its reading of a test, not a surviving mutant.
    Evidence from it is read:, never sim:, test: or real:.
  - It cannot prove absence. An empty report means it found nothing within its limits, not that the PR is safe.
  - It does not see comments, reviews, CI or any other PR, and cannot follow a link.
  - Text a trusted author pasted into the diff from elsewhere is not filtered; a hostile file in the repo is still read. The box is the answer.
  - It can be wrong in a confident voice. It can be declined on security-heavy diffs.
  - The cost it prints is an estimate; the Console holds the real number.
  - A key on one server is one secret to guard: an account with sudo there can read the file whatever its mode.
  - The Codex runner's read-only sandbox can still read any file of its unix user; run it as the separate user.
  - Linux only, one server.
`;

export interface Args {
  cmd: 'review' | 'run' | 'post' | 'install' | 'help'; pr: number; sha: string; replay: string | null; diffOnly: boolean; model: string; runner: 'claude' | 'codex' | 'both';
  out: string | null; base: string; runAs: string | null; allowGhLogin: boolean; over: Partial<Ceilings>; dest: string | null;
}
export function parseArgs(argv: string[], env: Record<string, string | undefined> = {}): Args | string {
  const a: Args = { cmd: 'review', pr: 0, sha: '', replay: null, diffOnly: false, model: DEFAULT_MODEL, runner: 'claude', out: null, base: DEFAULT_BASE, runAs: env.PREREVIEW_RUN_AS ?? null, allowGhLogin: false, over: {}, dest: null };
  const rest = [...argv];
  if (rest[0] === 'run' || rest[0] === 'post' || rest[0] === 'install') a.cmd = rest.shift() as Args['cmd'];
  const pos: string[] = [];
  const numArg = (flag: string, v: string | undefined): number | string => { const n = Number(v); return v !== undefined && /^\d+(\.\d+)?$/.test(v) && Number.isFinite(n) && n > 0 ? n : `${flag} needs a positive number`; };
  for (let i = 0; i < rest.length; i++) {
    const f = rest[i]; const v = rest[i + 1];
    const val = (): string | null => { i++; return v !== undefined && !v.startsWith('--') ? v : null; };
    switch (f) {
      case '--help': case '-h': a.cmd = 'help'; break;
      case '--diff-only': a.diffOnly = true; break;
      case '--allow-gh-login': a.allowGhLogin = true; break;
      case '--replay': { const x = val(); if (!x || !/^[0-9a-f]{12,40}$/.test(x)) return '--replay needs a commit sha of 12 to 40 hex digits'; a.replay = x; break; }
      case '--model': { const x = val(); if (!x || !(MODELS as readonly string[]).includes(x)) return `--model must be one of ${MODELS.join(', ')}`; a.model = x; break; }
      case '--runner': { const x = val(); if (x !== 'claude' && x !== 'codex' && x !== 'both') return '--runner must be claude, codex or both'; a.runner = x; break; }
      case '--out': { const x = val(); if (!x || !path.isAbsolute(x)) return '--out needs an absolute folder'; a.out = x; break; }
      case '--base': { const x = val(); if (!x || !path.isAbsolute(x)) return '--base needs an absolute folder'; a.base = x; break; }
      case '--dest': { const x = val(); if (!x || !path.isAbsolute(x)) return '--dest needs an absolute folder'; a.dest = x; break; }
      case '--run-as': { const x = val(); if (!x || !/^[a-z_][a-z0-9_-]{0,31}$/.test(x)) return '--run-as needs a plain unix user name'; a.runAs = x; break; }
      case '--run-ceiling': case '--pass-ceiling': case '--max-turns': case '--timeout': {
        const n = numArg(f, val() ?? undefined); if (typeof n === 'string') return n;
        if (f === '--run-ceiling') a.over.runUsd = n; else if (f === '--pass-ceiling') a.over.passUsd = n; else if (f === '--max-turns') a.over.maxTurns = Math.floor(n); else a.over.passTimeoutMs = n * 1000;
        break;
      }
      default: if (f.startsWith('-')) return `unknown option ${clean(f, 30)}`; pos.push(f);
    }
  }
  if (a.cmd === 'help' || a.cmd === 'install') { if (a.cmd === 'install' && !a.dest) return 'install needs --dest <absolute folder>'; return a; }
  if (a.cmd === 'run') return a;
  if (!pos[0] || !/^\d{1,7}$/.test(pos[0])) return 'a PR number is needed';
  a.pr = Number(pos[0]);
  if (a.cmd === 'post') { if (!pos[1] || !/^[0-9a-f]{40}$/.test(pos[1])) return 'post needs the full 40-digit head sha of the stored report'; a.sha = pos[1]; }
  return a;
}

export interface CliDeps {
  exec: Exec; env: Record<string, string | undefined>; query?: QueryFn; fetch?: Fetch; now: () => Date; randomHex: (n: number) => string;
  /** the folder that holds scripts/ (the installed copy, or the checkout for install) */
  root: string; nodeBin: string; entry: string; me: number; stdin: () => Promise<string>; out: (s: string) => void; err: (s: string) => void; remote?: string;
}

const HUMAN = (reason: string): string => `prereview: ${reason}`;
const ghEnv = (env: Record<string, string | undefined>): Record<string, string> => { const o: Record<string, string> = {}; for (const [k, v] of Object.entries(env)) if (typeof v === 'string') o[k] = v; return o; };

/** Operator side: refuse first (FR-004), then fetch the filtered PR text (FR-005). Returns what the runner stage needs, or the refusal line. */
export async function gate(d: CliDeps, a: Args): Promise<{ ok: true; sha: string; url: string; prText: string | null } | { ok: false; why: string }> {
  const slug = await d.exec('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { env: ghEnv(d.env), timeoutMs: 60_000 });
  const m = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/.exec(slug.stdout.trim());
  if (slug.code !== 0 || !m) return { ok: false, why: HUMAN('could not tell which repository this is') };
  const q = await d.exec('gh', ['api', 'graphql', '-f', `query=${GATE_QUERY(m[1], m[2], a.pr)}`], { env: ghEnv(d.env), timeoutMs: 60_000 });
  if (q.code !== 0) return { ok: false, why: HUMAN('could not read the PR') };
  let trusted: string[];
  try { trusted = parseTrusted(fs.readFileSync(path.join(d.root, 'scripts', 'trusted-authors.txt'), 'utf8')); } catch { return { ok: false, why: HUMAN('the trusted list is missing') }; }
  if (trusted.length === 0) return { ok: false, why: HUMAN('the trusted list is empty') };
  let facts;
  try { facts = factsFromGraphql(JSON.parse(q.stdout)); } catch { return { ok: false, why: HUMAN('could not read the PR\'s facts') }; }
  if (facts.number !== a.pr) return { ok: false, why: HUMAN('GitHub answered for another PR') };
  const why = refusal(facts, trusted, { replay: a.replay });
  if (why) return { ok: false, why: HUMAN(why) };
  const sha = shaToRead(facts, a.replay);
  let prText: string | null = null;
  if (!a.diffOnly) {
    const t = await d.exec('bash', [path.join(d.root, 'scripts', 'gh-trusted.sh'), String(a.pr), '--pr-text'], { env: ghEnv(d.env), timeoutMs: 60_000, maxBytes: 200_000 });
    if (t.code !== 0) return { ok: false, why: HUMAN('could not read the PR text') };
    if (/^outside PR text|^no PR/.test(t.stdout)) return { ok: false, why: HUMAN(`the PR text is not ours to read; for a human: ${facts.url}`) };
    prText = clean(t.stdout, 20_000);
  }
  return { ok: true, sha, url: facts.url, prText };
}

export interface RunPayload { pr: number; sha: string; url: string; replay: boolean; prText: string | null; model: string; runner: 'claude' | 'codex' | 'both'; ceilings: Ceilings; raised: string[]; outDir: string | null; allowGhLogin: boolean }
const isPayload = (p: any): p is RunPayload => !!p && Number.isInteger(p.pr) && p.pr > 0 && /^[0-9a-f]{40}$/.test(p.sha) && typeof p.url === 'string' && (p.prText === null || typeof p.prText === 'string') &&
  (MODELS as readonly string[]).includes(p.model) && ['claude', 'codex', 'both'].includes(p.runner) && !!p.ceilings && Array.isArray(p.raised) && (p.outDir === null || (typeof p.outDir === 'string' && path.isAbsolute(p.outDir)));

/** Runner side. The payload came from the gate; it is re-checked for shape, and the ceilings again (a payload cannot raise them past the checks). */
export async function runStage(d: CliDeps, a: Args, payloadText: string): Promise<number> {
  let p: any; try { p = JSON.parse(payloadText); } catch { d.err(HUMAN('the runner got no JSON\n')); return 2; }
  if (!isPayload(p)) { d.err(HUMAN('the runner got an unexpected payload\n')); return 2; }
  const c = ceilingsFrom(p.ceilings); if (c.problems.length) { d.err(HUMAN(`ceilings refused: ${c.problems.join('; ')}\n`)); return 2; }
  if (!d.query && p.runner !== 'codex') { d.err(HUMAN('no SDK in this build\n')); return 2; }
  const places = placesFor(a.base);
  const kf = d.env.PREREVIEW_KEY_FILE; if (kf && path.isAbsolute(kf)) places.keyFile = kf; // a key file somewhere else, still checked by keyFileProblems; read only by runReview
  const env = { ...d.env }; if (!env.CODEX_HOME) env.CODEX_HOME = path.join(a.base, 'codex-home');
  const deps: RunDeps = {
    query: d.query ?? (() => { throw new Error('no SDK'); }), exec: d.exec, env, now: d.now, randomHex: d.randomHex, places, remote: d.remote ?? 'https://github.com/three-feathers/agent-durbar.git',
    ghLoggedIn: async () => { const r = await d.exec('gh', ['auth', 'status'], { env: { PATH: env.PATH ?? '/usr/bin:/bin', HOME: env.HOME ?? '/nonexistent' }, timeoutMs: 20_000 }); return r.code === 0; },
    log: (l) => d.err(maskAll(l) + '\n'),
  };
  const res = await runReview(deps, { ...p, ceilings: c.ceilings, raised: c.raised, outDir: p.outDir ?? undefined });
  if (!res.ok) { d.err(HUMAN(`${res.why}\n`)); return 1; }
  d.out(res.text); d.err(`report files: ${res.files.length} written under the results folder\n`);
  return 0;
}

export async function main(argv: string[], d: CliDeps): Promise<number> {
  const a = parseArgs(argv, d.env);
  if (typeof a === 'string') { d.err(HUMAN(`${a}\n`)); return 2; }
  if (a.cmd === 'help') { d.out(HELP); return 0; }
  if (a.cmd === 'install') return installApp(d, a.dest as string);
  if (a.cmd === 'run') return runStage(d, a, await d.stdin());
  if (a.cmd === 'post') return postStage(d, a);
  const c = ceilingsFrom(a.over); if (c.problems.length) { d.err(HUMAN(`${c.problems.join('; ')}\n`)); return 2; }
  const g = await gate(d, a);
  if (!g.ok) { d.err(`${g.why}\n`); return 1; }
  const payload: RunPayload = { pr: a.pr, sha: g.sha, url: g.url, replay: a.replay !== null, prText: g.prText, model: a.model, runner: a.runner, ceilings: c.ceilings, raised: c.raised, outDir: a.out, allowGhLogin: a.allowGhLogin };
  if (!a.runAs) return runStage(d, a, JSON.stringify(payload));
  const r = await d.exec('sudo', ['-n', '-u', a.runAs, '--', d.nodeBin, d.entry, 'run', '--base', a.base], { input: JSON.stringify(payload), env: { PATH: d.env.PATH ?? '/usr/bin:/bin' }, timeoutMs: c.ceilings.passTimeoutMs * 3 + 300_000, maxBytes: 4_000_000 });
  d.out(r.stdout); if (r.stderr) d.err(maskAll(r.stderr) + '\n');
  return r.code === 0 ? 0 : 1;
}

/** `post`: only past the gate of FR-027. Re-checks FR-004 on the PR first (a PR that became untrusted gets nothing). */
async function postStage(d: CliDeps, a: Args): Promise<number> {
  const places = placesFor(a.base);
  const { cfg, problem } = readPostConfig(path.join(places.state, 'post.json'), d.me);
  if (problem) { d.err(HUMAN(`${problem}\n`)); return 1; }
  const keyFile = cfg && typeof (cfg as any).keyFile === 'string' ? (cfg as any).keyFile : ''; const appIdFile = cfg && typeof (cfg as any).appIdFile === 'string' ? (cfg as any).appIdFile : '';
  if (!cfg || (cfg as any).postComment !== true) { d.err(HUMAN(`posting is off; it needs postComment true and a dated confirmation of ${OWNERS_REQUIRED.join(', ')} in the local post config\n`)); return 1; }
  if (!d.fetch) { d.err(HUMAN('no fetch in this build\n')); return 2; }
  let report; try { report = revalidateReport(JSON.parse(fs.readFileSync(path.join(places.state, 'reports', `${a.pr}-${a.sha}.json`), 'utf8'))); } catch { d.err(HUMAN('no stored report for that PR and sha\n')); return 1; }
  if (report.pr !== a.pr || report.sha !== a.sha) { d.err(HUMAN('the stored report is for another PR or sha\n')); return 1; }
  const g = await gate(d, { ...a, diffOnly: true });
  if (!g.ok) { d.err(`${g.why}\n`); return 1; }
  const slug = await d.exec('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { env: ghEnv(d.env), timeoutMs: 60_000 });
  const m = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/.exec(slug.stdout.trim()); if (!m) { d.err(HUMAN('could not tell which repository this is\n')); return 1; }
  const r = await postComment({ fetch: d.fetch, now: d.now, me: d.me, stateDir: places.state }, { owner: m[1], repo: m[2], pr: a.pr, report, cfg, keyFile, appIdFile });
  if (!r.ok) { d.err(HUMAN(`${r.why}\n`)); return 1; }
  d.out(`posted one comment: ${r.url}\n`); return 0;
}

/** Copies the reviewed code of `main` (clean checkout, HEAD == origin/main) to dest, then installs the pinned dependencies there. */
export const INSTALL_FILES: Array<[string, string]> = [
  ['scripts/prereview-core.ts', 'scripts/prereview-core.ts'], ['scripts/prereview-run.ts', 'scripts/prereview-run.ts'], ['scripts/prereview-cli.ts', 'scripts/prereview-cli.ts'], ['scripts/prereview-post.ts', 'scripts/prereview-post.ts'],
  ['src/shared/redact.ts', 'src/shared/redact.ts'], ['scripts/trusted-authors.txt', 'scripts/trusted-authors.txt'], ['scripts/trusted-lib.sh', 'scripts/trusted-lib.sh'], ['scripts/gh-trusted.sh', 'scripts/gh-trusted.sh'],
  ['docs/review-checklist.md', 'docs/review-checklist.md'],
  ['scripts/prereview/package.json', 'scripts/prereview/package.json'], ['scripts/prereview/package-lock.json', 'scripts/prereview/package-lock.json'], ['scripts/prereview/cli.mts', 'scripts/prereview/cli.mts'],
  ['scripts/prereview/prompts/system.md', 'prompts/system.md'], ['scripts/prereview/prompts/reach.md', 'prompts/reach.md'], ['scripts/prereview/prompts/evidence.md', 'prompts/evidence.md'],
];
export async function installApp(d: CliDeps, dest: string): Promise<number> {
  const git = (args: string[]) => d.exec('git', ['-C', d.root, ...args], { env: { PATH: d.env.PATH ?? '/usr/bin:/bin', HOME: d.env.HOME ?? '/nonexistent', GIT_CONFIG_NOSYSTEM: '1' }, timeoutMs: 120_000 });
  const st = await git(['status', '--porcelain', '--', 'scripts', 'src', 'docs']);
  if (st.code !== 0 || st.stdout.trim() !== '') { d.err(HUMAN('scripts/, src/ or docs/ has local changes; install from a clean checkout of reviewed main\n')); return 1; }
  const f = await git(['fetch', '--quiet', 'origin', 'main']); if (f.code !== 0) { d.err(HUMAN('could not fetch origin/main\n')); return 1; }
  const [h, o] = [await git(['rev-parse', 'HEAD']), await git(['rev-parse', 'origin/main'])];
  if (h.code !== 0 || h.stdout.trim() === '' || h.stdout.trim() !== o.stdout.trim()) { d.err(HUMAN('HEAD is not origin/main; install from reviewed main only\n')); return 1; }
  for (const [src] of INSTALL_FILES) if (!fs.existsSync(path.join(d.root, src))) { d.err(HUMAN(`missing ${src}\n`)); return 1; }
  fs.rmSync(dest, { recursive: true, force: true });
  for (const [src, to] of INSTALL_FILES) { const t = path.join(dest, to); fs.mkdirSync(path.dirname(t), { recursive: true, mode: 0o755 }); fs.copyFileSync(path.join(d.root, src), t); fs.chmodSync(t, 0o644); }
  fs.chmodSync(path.join(dest, 'scripts', 'gh-trusted.sh'), 0o755);
  const npm = await d.exec('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: path.join(dest, 'scripts', 'prereview'), env: { PATH: d.env.PATH ?? '/usr/bin:/bin', HOME: d.env.HOME ?? '/nonexistent' }, timeoutMs: 300_000 });
  if (npm.code !== 0) { d.err(HUMAN('npm ci failed in the installed copy\n')); return 1; }
  d.out(`installed from main at ${h.stdout.trim().slice(0, 12)} to ${dest}\n`);
  return 0;
}
