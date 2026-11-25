#!/usr/bin/env node
/*
 * Spec 021 FR-424 (harness series S4; retro 2026-W48: a coordinator worked 231 commits behind main and read old rules): which rule files changed
 * on origin/main since this checkout's merge base? `npm run rules:fresh` fetches origin main, then prints each changed file of
 * FRESH_PATHS (scripts/rules-check.js: AGENTS.md, CLAUDE.md, the Copilot instructions, the constitution, docs/rules/, .claude/agents, the durbar-* skills)
 * as `<file>: <short sha of the commit that last changed it on main>`, one per line: never a commit subject or body (a subject can be an outsider's text,
 * AGENTS.md *Untrusted content and prompt injection*); read the change with `git show <sha> -- <file>`. Exit 0 and `rules: fresh` when none changed; exit 1 and
 * `rules: stale, read: <files>` when some did; exit 2 when git cannot answer (no origin main, no merge base, fetch failed).
 * Reads only; never merges. Plain Node, git with a fixed argument list and no shell, no network except the one fetch.
 *
 *   node scripts/rules-fresh.js            this checkout
 *   node scripts/rules-fresh.js --root D   another checkout (tests)
 */
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const { FRESH_PATHS } = require('./rules-check.js');
const { printable } = require('./safe-print.js'); // FR-031: the one printable-text helper

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 24 });
}

// git's own messages and file names are printed through safe-print.js (controls, bidi and zero-width marks escaped, `::` broken), 200 code points at most
const clean = (s) => printable(Array.from(String(s).trim()).slice(0, 200).join(''));

// -> { files: [{ file, subject }] } or throws an Error whose message says what git could not do
function fresh(root) {
  try {
    // the explicit refspec: a plain `fetch origin main` leaves refs/remotes/origin/main old when remote.origin.fetch does not cover main
    git(root, ['fetch', '-q', 'origin', '+refs/heads/main:refs/remotes/origin/main']);
  } catch (e) {
    throw new Error(`cannot fetch origin main (${clean(e.stderr || e.message)}): the rule files cannot be compared`);
  }
  let base;
  try {
    base = git(root, ['merge-base', 'HEAD', 'origin/main']).trim();
  } catch (e) {
    throw new Error(`no merge base of HEAD and origin/main (${clean(e.stderr || e.message)})`);
  }
  const names = git(root, ['diff', '--name-only', '-z', base, 'origin/main', '--', ...FRESH_PATHS]).split('\0').filter(Boolean);
  const files = names.map((file) => {
    const sha = git(root, ['log', '-1', '--format=%H', `${base}..origin/main`, '--', file]).split(/\r?\n/)[0].trim();
    return { file: clean(file), sha: /^[0-9a-f]{40,64}$/.test(sha) ? sha.slice(0, 12) : '?' };
  });
  return { files };
}

function main(argv) {
  const i = argv.indexOf('--root');
  const root = i >= 0 && argv[i + 1] ? path.resolve(argv[i + 1]) : path.join(__dirname, '..');
  let r;
  try {
    r = fresh(root);
  } catch (e) {
    console.error(`rules:fresh: ${e.message}`);
    return 2;
  }
  if (!r.files.length) {
    console.log('rules: fresh');
    return 0;
  }
  for (const f of r.files) console.log(`${f.file}: ${f.sha}`);
  console.log(`rules: stale, read: ${r.files.map((f) => f.file).join(', ')}`);
  return 1;
}

module.exports = { fresh };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
