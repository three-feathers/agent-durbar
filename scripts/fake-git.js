#!/usr/bin/env node
/*
 * A fake `git` for the tests of the stale-gate check (spec 021 FR-425): tests put a one-line shim that runs this file first on PATH, so
 * scripts/pr-gate.sh, scripts/gh-trusted.sh and scripts/claim.sh never touch the real repository or the network. It answers only the calls those
 * scripts make (fixed argument lists) and fails with exit 99 on any other, so a new git call in them must be added here on purpose.
 *   FAKE_GIT_DIFF        space-separated repo-relative files whose copy on disk differs from origin/main's (default: none)
 *   FAKE_GIT_MISSING     space-separated files origin/main does not have (`rev-parse --verify` of them fails)
 *   FAKE_GIT_FETCH_RC    exit code of `fetch` (default 0)
 *   FAKE_GIT_NOREPO      1: `rev-parse --is-inside-work-tree` fails (an installed copy, no checkout)
 *   FAKE_GIT_CHANGED     newline-separated rule files that changed on origin/main since the merge base (rules-fresh.js; default: none)
 *   FAKE_GIT_LOG         a file: every call's argument line is appended to it
 */
'use strict';
const fs = require('fs');
const argv = process.argv.slice(2);
if (process.env.FAKE_GIT_LOG) fs.appendFileSync(process.env.FAKE_GIT_LOG, `${argv.join(' ')}\n`);
if (argv[0] === '-C') argv.splice(0, 2);
const [cmd, ...rest] = argv;
const differs = (process.env.FAKE_GIT_DIFF || '').split(/\s+/).filter(Boolean);
const ONE = '1'.repeat(40);
const TWO = '2'.repeat(40);
const fail = (rc, msg) => { console.error(`fake git: ${msg}`); process.exit(rc); };
if (cmd === 'rev-parse' && rest[0] === '--is-inside-work-tree') {
  if (process.env.FAKE_GIT_NOREPO === '1') fail(128, 'not a git repository');
  console.log('true');
} else if (cmd === 'fetch') {
  const rc = Number(process.env.FAKE_GIT_FETCH_RC || 0);
  if (rc) fail(rc, 'could not read from remote repository');
} else if (cmd === 'rev-parse' && rest[0] === '--verify' && rest[1] === '-q' && /^(origin\/main|HEAD):/.test(rest[2] || '')) {
  if ((process.env.FAKE_GIT_MISSING || '').split(/\s+/).includes(rest[2].slice(rest[2].indexOf(':') + 1))) process.exit(1);
  console.log(ONE); // origin/main's copy, and HEAD's copy (a stale checkout's HEAD equals its disk in no test: the disk is what differs)
} else if (cmd === 'hash-object' && rest[0] === '--' && rest.length === 2) {
  console.log(differs.includes(rest[1]) ? TWO : ONE);
} else if (cmd === 'merge-base' && rest.join(' ') === 'HEAD origin/main') {
  console.log('3'.repeat(40));
} else if (cmd === 'diff' && rest[0] === '--name-only' && rest[1] === '-z') {
  process.stdout.write((process.env.FAKE_GIT_CHANGED || '').split('\n').filter(Boolean).map((f) => `${f}\0`).join(''));
} else if (cmd === 'log' && rest[0] === '-1' && rest[1] === '--format=%s') {
  console.log(`change of ${rest[rest.length - 1]}`);
} else {
  fail(99, `unexpected call: ${argv.join(' ')}`);
}
