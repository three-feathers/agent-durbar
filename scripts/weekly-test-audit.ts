/**
 * Weekly test audit (spec 021 FR-058): everything `scripts/weekly-test-audit.sh` needs from node, kept pure where it can be so
 * `scripts/test-weekly-audit.ts` drives it without Claude or the network.
 *
 *   node weekly-test-audit.js claude-argv --model sonnet --mutate <abs path of weekly-test-audit-mutate.js>   (NUL-separated argv)
 *   node weekly-test-audit.js prompt --template <file> --mutate <abs path> --sha <sha>                         (the rendered prompt)
 *   node weekly-test-audit.js run --input <claude output> [--file] [--repo owner/name] [--log <file>]
 *
 * `run` validates Claude's answer in full first, then (with `--file`) files at most MAX_NEW issues with `gh`, using a token read from the
 * file named by DURBAR_AUDIT_GH_TOKEN_FILE. Without `--file` it is a dry run: it prints what it would file and creates nothing.
 * Claude never sees the token; this file runs from a copy Claude cannot change (the shell script copies it out before Claude starts).
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { redact } from '../src/shared/redact';

export const SCHEMA_ID = 'durbar-weekly-audit/1';
export const MAX_FINDINGS_IN = 20;
export const MAX_NEW = 5;
export const MAX_OUTPUT_CHARS = 200_000;
export const FOOTER = 'Filed by the weekly test audit (spec 021 FR-058)';
export const KINDS = ['cannot-fail', 'duplicate', 'fixed-sleep', 'wall-clock', 'other'] as const;
export const VERIFICATIONS = ['mutation', 'read'] as const;
/** The label taxonomy of AGENTS.md (team decision 2026-10-23, spec 021 FR-045): one type, at least one area, the spec labels. */
export const TYPES = ['bug', 'enhancement', 'task', 'documentation', 'question'];
export const AREAS = ['adapters', 'ci', 'docs', 'harness', 'mcp', 'packaging', 'permissions', 'platform', 'schedules', 'security', 'ui', 'usage'].map((a) => 'area:' + a);
const SPEC_LABEL = /^spec:\d{3}$/;
const FINDING_KEYS = ['id', 'kind', 'title', 'file', 'line', 'labels', 'verification', 'evidence', 'body'];
/** [min, max] characters per string field. */
const CAPS: Record<string, [number, number]> = { id: [8, 80], title: [10, 120], file: [5, 200], evidence: [20, 2000], body: [40, 4000] };

export type Finding = {
  id: string; kind: (typeof KINDS)[number]; title: string; file: string; line: number; labels: string[];
  verification: (typeof VERIFICATIONS)[number]; evidence: string; body: string;
};
export type Validated = { ok: false; error: string } | { ok: true; findings: Finding[]; rejected: { index: number; errors: string[] }[] };

const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
// control characters other than newline and tab (titles also refuse those)
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

/** One finding's errors (empty when it is valid). */
export function findingErrors(f: unknown): string[] {
  if (!isPlainObject(f)) return ['not an object'];
  const errs: string[] = [];
  for (const k of Object.keys(f)) if (!FINDING_KEYS.includes(k)) errs.push(`unknown key ${JSON.stringify(k.slice(0, 40))}`);
  for (const k of FINDING_KEYS) if (!own(f, k)) errs.push(`missing ${k}`);
  if (errs.length) return errs;
  for (const [k, [min, max]] of Object.entries(CAPS)) {
    const v = f[k];
    if (typeof v !== 'string') { errs.push(`${k} is not a string`); continue; }
    if (v.length < min || v.length > max) errs.push(`${k} has ${v.length} characters (allowed ${min}..${max})`);
    if (CONTROL.test(v)) errs.push(`${k} has a control character`);
  }
  if (typeof f.id === 'string' && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(f.id)) errs.push('id is not kebab-case');
  if (typeof f.title === 'string' && /[\r\n\t]/.test(f.title)) errs.push('title has a line break or tab');
  if (typeof f.file === 'string') {
    const p = f.file;
    if (!/^(src|scripts|specs|docs)\/[A-Za-z0-9._\-/]+$/.test(p) || p.split('/').some((s) => s === '' || s === '.' || s === '..')) errs.push('file is not a plain relative path under src/, scripts/, specs/ or docs/');
  }
  if (!Number.isInteger(f.line) || (f.line as number) < 1 || (f.line as number) > 100000) errs.push('line is not an integer in 1..100000');
  if (!KINDS.includes(f.kind as Finding['kind'])) errs.push('kind is not allowed');
  if (!VERIFICATIONS.includes(f.verification as Finding['verification'])) errs.push('verification is not allowed');
  const labels = f.labels;
  if (!Array.isArray(labels) || labels.length < 3 || labels.length > 6 || !labels.every((l) => typeof l === 'string')) errs.push('labels is not a list of 3..6 strings');
  else {
    if (new Set(labels).size !== labels.length) errs.push('labels repeat');
    const unknown = labels.filter((l) => !TYPES.includes(l) && !AREAS.includes(l) && !SPEC_LABEL.test(l));
    if (unknown.length) errs.push(`labels not in the taxonomy: ${unknown.map((l) => JSON.stringify(String(l).slice(0, 40))).join(', ')}`);
    if (labels.filter((l) => TYPES.includes(l)).length !== 1) errs.push('labels need exactly one type');
    if (!labels.some((l) => AREAS.includes(l))) errs.push('labels need an area:*');
    if (!labels.some((l) => SPEC_LABEL.test(l))) errs.push('labels need a spec:NNN');
  }
  return errs;
}

/** Claude's whole answer: strict JSON, nothing around it. A problem with the shape rejects the run; a bad finding is dropped. */
export function validateOutput(text: string): Validated {
  if (typeof text !== 'string') return { ok: false, error: 'no output' };
  if (text.length > MAX_OUTPUT_CHARS) return { ok: false, error: `output longer than ${MAX_OUTPUT_CHARS} characters` };
  let data: unknown;
  try { data = JSON.parse(text.trim()); } catch { return { ok: false, error: 'output is not JSON' }; }
  if (!isPlainObject(data)) return { ok: false, error: 'output is not a JSON object' };
  const extra = Object.keys(data).filter((k) => k !== 'schema' && k !== 'findings');
  if (extra.length) return { ok: false, error: `unknown top-level key ${JSON.stringify(extra[0].slice(0, 40))}` };
  if (data.schema !== SCHEMA_ID) return { ok: false, error: `schema is not ${SCHEMA_ID}` };
  if (!Array.isArray(data.findings)) return { ok: false, error: 'findings is not a list' };
  if (data.findings.length > MAX_FINDINGS_IN) return { ok: false, error: `more than ${MAX_FINDINGS_IN} findings` };
  const findings: Finding[] = [];
  const rejected: { index: number; errors: string[] }[] = [];
  data.findings.forEach((f, index) => {
    const errors = findingErrors(f);
    if (errors.length) rejected.push({ index, errors });
    else findings.push(f as Finding);
  });
  return { ok: true, findings, rejected };
}

/** Stable across runs: the kind, the file and Claude's id, not the line (lines move). */
export function fingerprint(f: Pick<Finding, 'kind' | 'file' | 'id'>): string {
  return crypto.createHash('sha256').update(`${f.kind}\n${f.file}\n${f.id}`).digest('hex').slice(0, 16);
}
export const marker = (fp: string): string => `<!-- weekly-audit:${fp} -->`;
export function markersIn(body: string): string[] {
  return [...String(body || '').matchAll(/<!-- weekly-audit:([0-9a-f]{16}) -->/g)].map((m) => m[1]);
}

type Env = Record<string, string | undefined>;
/** Mask secrets; when Markdown marks still hide a token after that (`gh**p_…`), mask the text without the marks (formatting lost, secret gone). */
export function mask(text: string, env?: Env): string {
  const masked = redact(text, env);
  for (const marks of [/[*~`]/g, /[*_~`]/g]) {
    const plain = masked.replace(marks, '');
    const maskedPlain = redact(plain, env);
    if (maskedPlain !== plain) return maskedPlain;
  }
  return masked;
}
/** Markdown text that renders as text: no HTML, entities, mentions or images. */
export function escapeMd(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/@/g, '&#64;').replace(/!\[/g, '!\\[');
}
function fence(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const f = '`'.repeat(longest + 1);
  return `${f}text\n${text}\n${f}`;
}
export function issueTitle(f: Finding, env?: Env): string {
  return mask(f.title, env).replace(/\s+/g, ' ').trim();
}
export function issueBody(f: Finding, env?: Env): string {
  const fp = fingerprint(f);
  return [
    marker(fp),
    `**Where:** \`${f.file}:${f.line}\` · **Kind:** ${f.kind} · **Checked by:** ${f.verification === 'mutation' ? 'a mutation run' : 'reading only'}`,
    '',
    escapeMd(mask(f.body, env)),
    '',
    '**Evidence**',
    '',
    fence(mask(f.evidence, env)),
    '',
    '---',
    FOOTER,
  ].join('\n');
}

export type GhResult = { code: number; stdout: string; stderr: string };
export type Gh = (args: string[]) => Promise<GhResult>;
export type Outcome = { fp: string; title: string; file: string; status: 'filed' | 'would-file' | 'duplicate' | 'capped' | 'failed'; note?: string; url?: string };
export type Summary = { mode: 'file' | 'dry-run'; dedupe: 'checked' | 'not checked'; outcomes: Outcome[]; error?: string };

/** Search open and closed issues for weekly-audit markers. Throws when the search fails, so nothing is filed blind. */
export async function existingMarkers(gh: Gh, repo: string): Promise<Map<string, string>> {
  const r = await gh(['issue', 'list', '--repo', repo, '--state', 'all', '--limit', '1000', '--search', `"${FOOTER}" in:body`, '--json', 'number,state,body']);
  if (r.code !== 0) throw new Error('could not search existing issues');
  const list = JSON.parse(r.stdout) as { number: number; state: string; body: string }[];
  if (!Array.isArray(list)) throw new Error('could not read existing issues');
  const seen = new Map<string, string>();
  for (const i of list) for (const fp of markersIn(i.body)) if (!seen.has(fp)) seen.set(fp, `#${i.number} (${String(i.state).toLowerCase()})`);
  return seen;
}
async function repoLabels(gh: Gh, repo: string): Promise<Set<string>> {
  const r = await gh(['label', 'list', '--repo', repo, '--limit', '1000', '--json', 'name']);
  if (r.code !== 0) throw new Error('could not list labels');
  return new Set((JSON.parse(r.stdout) as { name: string }[]).map((l) => l.name));
}

/**
 * Decide and (with mode 'file') file. `gh` is null when there is no token: dedupe is then not checked and only a dry run is allowed.
 * Order: skip a marker already on an open or closed issue (or seen earlier in this run), then stop at `max` new issues.
 */
export async function planAndFile(opts: { findings: Finding[]; mode: 'file' | 'dry-run'; gh: Gh | null; repo: string; max?: number; env?: Env }): Promise<Summary> {
  const { findings, mode, gh, repo, env } = opts;
  const max = opts.max ?? MAX_NEW;
  const summary: Summary = { mode, dedupe: gh ? 'checked' : 'not checked', outcomes: [] };
  if (mode === 'file' && !gh) return { ...summary, error: 'filing needs the token file (DURBAR_AUDIT_GH_TOKEN_FILE)' };
  let existing = new Map<string, string>();
  let labels: Set<string> | null = null;
  if (gh) {
    try {
      existing = await existingMarkers(gh, repo);
      labels = await repoLabels(gh, repo);
    } catch (e) {
      return { ...summary, error: `${(e as Error).message}; nothing filed` };
    }
  }
  const inRun = new Set<string>();
  let fresh = 0;
  for (const f of findings) {
    const fp = fingerprint(f);
    const base = { fp, title: issueTitle(f, env), file: `${f.file}:${f.line}` };
    if (existing.has(fp)) { summary.outcomes.push({ ...base, status: 'duplicate', note: existing.get(fp) }); continue; }
    if (inRun.has(fp)) { summary.outcomes.push({ ...base, status: 'duplicate', note: 'repeated in this run' }); continue; }
    inRun.add(fp);
    if (fresh >= max) { summary.outcomes.push({ ...base, status: 'capped', note: `over the cap of ${max}` }); continue; }
    fresh++;
    const keep = labels ? f.labels.filter((l) => labels!.has(l)) : f.labels;
    const dropped = f.labels.filter((l) => !keep.includes(l));
    const note = dropped.length ? `labels not in the repo, dropped: ${dropped.join(', ')}` : undefined;
    if (mode === 'dry-run' || !gh) { summary.outcomes.push({ ...base, status: 'would-file', note }); continue; }
    const args = ['issue', 'create', '--repo', repo, '--title', base.title, '--body', issueBody(f, env)];
    for (const l of keep) args.push('--label', l);
    const r = await gh(args);
    if (r.code === 0) summary.outcomes.push({ ...base, status: 'filed', url: (r.stdout.trim().split(/\s+/).pop() || '').slice(0, 200), note });
    else summary.outcomes.push({ ...base, status: 'failed', note: mask(r.stderr.trim().slice(-300), env) });
  }
  return summary;
}

export function formatSummary(s: Summary, v: Validated): string {
  const lines = [`weekly test audit: ${s.mode}, dedupe ${s.dedupe}`];
  if (!v.ok) lines.push(`output rejected: ${v.error}; nothing filed`);
  else {
    lines.push(`findings: ${v.findings.length} valid, ${v.rejected.length} rejected`);
    for (const r of v.rejected) lines.push(`  rejected #${r.index}: ${r.errors.join('; ')}`);
  }
  if (s.error) lines.push(`error: ${s.error}`);
  const count = (st: Outcome['status']) => s.outcomes.filter((o) => o.status === st).length;
  lines.push(`filed: ${count('filed')}, would file: ${count('would-file')}, skipped as duplicate: ${count('duplicate')}, capped: ${count('capped')}, failed: ${count('failed')}`);
  for (const o of s.outcomes) lines.push(`  ${o.status} ${o.fp} ${o.file} ${JSON.stringify(o.title)}${o.url ? ' ' + o.url : ''}${o.note ? ' (' + o.note + ')' : ''}`);
  return lines.join('\n');
}

const MUTATE_RE = /^\/[A-Za-z0-9._\-/]+\/weekly-test-audit-mutate\.js$/;
const MODEL_RE = /^[A-Za-z0-9.\-[\]]{1,60}$/;
/**
 * The exact `claude` argv. No MCP servers or settings files (CLAUDE.md), restricted mode, only Read/Grep/Glob/Bash available, Bash
 * allowed only for the mutation helper, anything else denied without a prompt, no session saved.
 */
export function buildClaudeArgv(opts: { model: string; mutate: string }): string[] {
  if (!MODEL_RE.test(opts.model)) throw new Error('bad model name');
  if (!MUTATE_RE.test(opts.mutate)) throw new Error('the helper path must be absolute and plain');
  return [
    '-p',
    '--strict-mcp-config', '--setting-sources', '',
    '--restricted',
    '--tools', 'Read,Grep,Glob,Bash',
    '--allowedTools', 'Read', 'Grep', 'Glob', `Bash(node ${opts.mutate} *)`,
    '--disallowedTools', 'WebFetch', 'WebSearch', 'Edit', 'Write', 'NotebookEdit', 'Bash(gh *)', 'Bash(git *)', 'Bash(curl *)', 'Bash(wget *)',
    '--permission-mode', 'dontAsk',
    '--permission-prompts', 'none',
    '--no-session-persistence',
    '--disable-slash-commands',
    '--model', opts.model,
    '--output-format', 'text',
  ];
}

export function renderPrompt(template: string, vars: { mutate: string; sha: string }): string {
  if (!MUTATE_RE.test(vars.mutate)) throw new Error('the helper path must be absolute and plain');
  if (!/^[0-9a-f]{7,40}$/.test(vars.sha)) throw new Error('bad sha');
  return template.split('{{MUTATE}}').join(`node ${vars.mutate}`).split('{{SHA}}').join(vars.sha).split('{{SCHEMA}}').join(SCHEMA_ID).split('{{MAX_FINDINGS}}').join(String(MAX_FINDINGS_IN));
}

/** The token file: a regular file (not a link), private to its owner on POSIX, one token-shaped line. Never printed. */
export function readTokenFile(file: string, platform = process.platform): string {
  const st = fs.lstatSync(file);
  if (!st.isFile()) throw new Error('the token file is not a regular file');
  if (platform !== 'win32' && (st.mode & 0o077) !== 0) throw new Error('the token file must be mode 0600 or stricter');
  if (st.size > 512) throw new Error('the token file is too big');
  const t = fs.readFileSync(file, 'utf8').trim();
  if (!/^[A-Za-z0-9_]{20,255}$/.test(t)) throw new Error('the token file does not hold one token');
  return t;
}

export function ghRunner(token: string, bin = 'gh'): Gh {
  return (args) => new Promise((resolve) => {
    execFile(bin, args, { env: { ...process.env, GH_TOKEN: token, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' }, timeout: 60_000, maxBuffer: 20 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => resolve({ code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0, stdout: String(stdout), stderr: String(stderr) }));
  });
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function main(argv: string[], io: { out: (s: string) => void; env: Env; gh?: (token: string) => Gh }): Promise<number> {
  const cmd = argv[0];
  if (cmd === 'claude-argv') {
    io.out(buildClaudeArgv({ model: flag(argv, '--model') || 'sonnet', mutate: flag(argv, '--mutate') || '' }).join('\0') + '\0');
    return 0;
  }
  if (cmd === 'prompt') {
    io.out(renderPrompt(fs.readFileSync(flag(argv, '--template') || '', 'utf8'), { mutate: flag(argv, '--mutate') || '', sha: flag(argv, '--sha') || '' }));
    return 0;
  }
  if (cmd === 'run') {
    const mode = argv.includes('--file') ? 'file' : 'dry-run';
    const repo = flag(argv, '--repo') || 'three-feathers/agent-durbar';
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('bad repo');
    const input = flag(argv, '--input');
    let text = '';
    try { text = fs.readFileSync(input || '', 'utf8'); } catch { text = ''; }
    const v = validateOutput(text);
    const tokenFile = io.env.DURBAR_AUDIT_GH_TOKEN_FILE;
    let gh: Gh | null = null;
    let tokenError = '';
    let env = io.env;
    if (tokenFile) {
      try {
        const token = readTokenFile(tokenFile);
        gh = (io.gh || ghRunner)(token);
        env = { ...io.env, GH_TOKEN: token }; // so redact masks the token by value in everything written
      } catch (e) { tokenError = (e as Error).message; }
    }
    let summary: Summary;
    if (!v.ok) summary = { mode, dedupe: 'not checked', outcomes: [] };
    else if (mode === 'file' && tokenError) summary = { mode, dedupe: 'not checked', outcomes: [], error: `${tokenError}; nothing filed` };
    else summary = await planAndFile({ findings: v.findings, mode, gh: mode === 'dry-run' && tokenError ? null : gh, repo, env });
    let text2 = formatSummary(summary, v);
    if (tokenError && mode === 'dry-run') text2 += `\nnote: ${tokenError}; dry run without the duplicate check`;
    if (mode === 'dry-run' && v.ok) {
      const filed = new Set(summary.outcomes.filter((o) => o.status === 'would-file').map((o) => o.fp));
      for (const f of v.findings) if (filed.has(fingerprint(f))) text2 += `\n\n--- would file: ${issueTitle(f, env)}\nlabels: ${f.labels.join(', ')}\n${issueBody(f, env)}`;
    }
    text2 = redact(text2, env);
    io.out(text2 + '\n');
    const log = flag(argv, '--log');
    if (log) fs.appendFileSync(log, text2 + '\n', { mode: 0o600 });
    return !v.ok || summary.error || summary.outcomes.some((o) => o.status === 'failed') ? 1 : 0;
  }
  throw new Error('usage: weekly-test-audit.js claude-argv|prompt|run ...');
}

if (require.main === module) {
  main(process.argv.slice(2), { out: (s) => process.stdout.write(s), env: process.env }).then(
    (code) => { process.exitCode = code; },
    (e) => { process.stderr.write(redact(`weekly-test-audit: ${(e as Error).message}`) + '\n'); process.exitCode = 2; },
  );
}
