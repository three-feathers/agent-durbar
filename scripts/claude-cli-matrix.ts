/**
 * `npm run test:claudecli` (spec 012 FR-163, T136). OPT-IN, not part of `npm test`, never run in CI (no `claude` there): checks the real
 * `claudeArgs` against the installed Claude Code CLIs. It runs ONLY `<bin> --version` and
 * `<bin> --help --strict-mcp-config --setting-sources ""` (no session, no prompt, no credits), through `execFile` (no shell).
 *
 * Binaries: `DURBAR_CLAUDE_BINS` (a path list: `:` on POSIX, `;` on Windows), else every file in `~/.local/share/claude/versions/`, plus
 * `claude` on PATH. For each one it lists the flags `claudeArgs` emits for a set of representative launches (derived from the real
 * function, never a hand-copied list), and checks each is in that version's `--help`. A flag gated above the version (`GATES`) must NOT be
 * emitted for it. Exit 0 when nothing is missing (or no CLI is found: SKIP), 1 on a missing or wrongly emitted flag.
 * `[KNOWN GAP]` Runtime behaviour (what a flag does) needs a real session and is not covered.
 */
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { PermissionMode } from '../src/adapters/capabilities';
import * as claude from '../src/adapters/claude';
import type { ClaudeLaunch } from '../src/adapters/claude';

/** Minimum number of distinct flags the representative launches must emit; fewer means the derivation went vacuous. */
export const MIN_FLAGS_CHECKED = 20;

/** Every flag (`--long` and `-s`) declared on an option line of `claude --help`: the lines indented by two spaces that start with `-`. */
export function parseHelpFlags(help: string): Set<string> {
  const out = new Set<string>();
  for (const line of help.split(/\r?\n/)) {
    if (!/^ {2}-/.test(line)) continue;
    const decl = line.slice(2).split(/\s{2,}/)[0]; // the declaration, before the description column
    for (const m of decl.matchAll(/(?:^|[\s,])(--?[A-Za-z][\w-]*)/g)) out.add(m[1]);
  }
  return out;
}

/** Every flag-looking word anywhere in the help text (a hidden flag named only in a description, such as `--permission-prompt-tool`). */
export function mentionedFlags(help: string): Set<string> {
  const out = new Set<string>();
  for (const m of help.split(/\r?\n/).join('\n').matchAll(/(?:^|[\s("'`])(--[A-Za-z][\w-]*)/g)) out.add(m[1]);
  return out;
}

/** The flags in an argv: items that look like `-x` or `--word`. (No Durbar value starts with `-`; a name that does is refused by `claudeNameOk`.) */
export function flagsOf(args: readonly string[]): string[] {
  return args.filter((a) => /^--?[A-Za-z][\w-]*$/.test(a));
}

/** `2.1.309 (Claude Code)` -> `2.1.309`; undefined when there is no version. */
export function versionOf(out: string): string | undefined {
  return /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(out)?.[1];
}

/** Flags gated by version: `claudeArgs` must not emit `flag` for a CLI older than `min`. Read from the adapter's own exports, so a new gate shows up here. */
export function gatesOf(mod: Record<string, unknown> = claude as unknown as Record<string, unknown>): { flag: string; min: string }[] {
  const out: { flag: string; min: string }[] = [];
  const min = mod.CLAUDE_FORWARD_SUBAGENT_MIN_VERSION; // spec 015 FR-016 (only once that change is on main)
  if (typeof min === 'string') out.push({ flag: '--forward-subagent-text', min });
  return out;
}

const cmp = (a: string, b: string): number => {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
};

/** Representative launches: every mode, bare and with every option `ClaudeLaunch` takes, as the adapter would set them for `version`. */
export function representativeLaunches(version: string | undefined, mod: Record<string, unknown> = claude as unknown as Record<string, unknown>): ClaudeLaunch[] {
  const modes: PermissionMode[] = ['read-only', 'ask', 'allow'];
  const gate = mod.claudeForwardsSubagentText; // spec 015 FR-016: the adapter's own version check, when it exists
  const forward = typeof gate === 'function' ? { forwardSubagentText: Boolean((gate as (v?: string) => boolean)(version)) } : {};
  const out: ClaudeLaunch[] = [];
  for (const mode of modes) {
    out.push({ mode, sessionId: 'sid', resume: false, ...forward });
    out.push({
      mode, sessionId: 'sid', resume: true, model: 'sonnet', effort: 'high', agent: { name: 'reviewer', json: '{}' }, mcpConfig: '{"mcpServers":{}}',
      appendSystemPrompt: 'x', addDirs: ['/a', '/b'], maxBudgetUsd: 1.5, settingsJson: '{}', folderAllow: ['Bash(git status)'], name: 'n',
      disallowedMcpTools: ['mcp__s__t'], ...forward,
    } as ClaudeLaunch);
  }
  return out;
}

/** The distinct flags `claudeArgs` emits over the representative launches for `version`. */
export function emittedFlags(version: string | undefined): string[] {
  const set = new Set<string>();
  for (const l of representativeLaunches(version)) for (const f of flagsOf(claude.claudeArgs(l))) set.add(f);
  return [...set].sort();
}

export interface Row { version: string; checked: number; listed: number; hidden: string[]; missing: string[]; gated: string[] }

/** Compare one CLI's help with the emitted flags. `hidden`: named in the help text but not declared (works, undocumented). `gated`: emitted below its minimum version. */
export function compare(version: string, help: string, emitted: readonly string[], gates: readonly { flag: string; min: string }[]): Row {
  const declared = parseHelpFlags(help);
  const mentioned = mentionedFlags(help);
  const hidden = emitted.filter((f) => !declared.has(f) && mentioned.has(f));
  const missing = emitted.filter((f) => !declared.has(f) && !mentioned.has(f));
  const gated = gates.filter((g) => emitted.includes(g.flag) && cmp(version, g.min) < 0).map((g) => `${g.flag} (needs ${g.min})`);
  return { version, checked: emitted.length, listed: emitted.filter((f) => declared.has(f)).length, hidden, missing, gated };
}

/** The CLI paths to check: `DURBAR_CLAUDE_BINS`, else the installer's versions folder plus `claude` on PATH. Existing files only, no duplicates. */
export function findBinaries(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string[] {
  const out: string[] = [];
  const add = (p: string): void => {
    try {
      if (path.isAbsolute(p) && fs.statSync(p).isFile() && !out.includes(fs.realpathSync(p)) && !out.includes(p)) out.push(p);
    } catch { /* not there */ }
  };
  if (env.DURBAR_CLAUDE_BINS) {
    for (const p of env.DURBAR_CLAUDE_BINS.split(path.delimiter)) if (p.trim()) add(p.trim());
    return out;
  }
  const dir = path.join(home, '.local', 'share', 'claude', 'versions');
  try {
    for (const n of fs.readdirSync(dir).sort()) add(path.join(dir, n));
  } catch { /* none */ }
  for (const d of (env.PATH ?? '').split(path.delimiter)) for (const n of process.platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude']) if (d && path.isAbsolute(d)) add(path.join(d, n));
  return out;
}

function run(bin: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 60000, maxBuffer: 4 << 20, windowsHide: true, env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'agent-durbar-cli-matrix' } }, (err, stdout, stderr) => {
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: `${stdout}\n${stderr}` });
    });
  });
}

async function main(): Promise<void> {
  const bins = findBinaries();
  if (!bins.length) {
    console.log('test:claudecli SKIP: no Claude Code CLI found (set DURBAR_CLAUDE_BINS to a path list, or install one).');
    return;
  }
  const gates = gatesOf();
  const rows: Row[] = [];
  let bad = false;
  for (const bin of bins) {
    const v = await run(bin, ['--version']);
    const version = versionOf(v.out);
    if (v.code !== 0 || !version) { console.log(`FAIL ${bin}: --version gave no version`); bad = true; continue; }
    const h = await run(bin, ['--help', '--strict-mcp-config', '--setting-sources', '']);
    const emitted = emittedFlags(version);
    if (emitted.length < MIN_FLAGS_CHECKED) { console.log(`FAIL only ${emitted.length} flags derived from claudeArgs (minimum ${MIN_FLAGS_CHECKED})`); bad = true; }
    if (h.code !== 0 || parseHelpFlags(h.out).size < MIN_FLAGS_CHECKED) { console.log(`FAIL ${version}: --help gave ${parseHelpFlags(h.out).size} flags (minimum ${MIN_FLAGS_CHECKED})`); bad = true; continue; }
    rows.push(compare(version, h.out, emitted, gates));
  }
  console.log('version     flags  listed  hidden  result');
  for (const r of rows) {
    const res = r.missing.length || r.gated.length ? `FAIL missing: ${[...r.missing, ...r.gated].join(', ')}` : 'OK';
    console.log(`${r.version.padEnd(11)} ${String(r.checked).padStart(5)}  ${String(r.listed).padStart(6)}  ${String(r.hidden.length).padStart(6)}  ${res}${r.hidden.length ? `  (hidden, named in help text only: ${r.hidden.join(', ')})` : ''}`);
    if (r.missing.length || r.gated.length) bad = true;
  }
  if (bad) process.exitCode = 1;
}

if (require.main === module) main().catch((e) => { console.error(String(e)); process.exitCode = 1; });
