'use strict';
// Test helper for scripts/test-picture-budget.js and scripts/test-spec-numbers.js (spec 021 FR-085). Builds a commit WITHOUT touching the working
// tree: blobs by `git hash-object -w`, a temporary index (GIT_INDEX_FILE), `write-tree`, `commit-tree`. A path with a newline, a colon or `::` is
// then a git path only, so the case runs on Windows too (a file system there refuses such names). Not run on its own.
const path = require('path');
const { execFileSync } = require('child_process');

let n = 0;
/** files: { path: content (string or Buffer) | { content, mode } }. Returns the new commit sha; `ref` (a full ref name) is moved to it. */
function plumbCommit(dir, parent, files, message, ref) {
  const env = { ...process.env, GIT_INDEX_FILE: path.join(dir, '.git', `plumb-index-${n++}`), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
  const g = (args, input) => execFileSync('git', ['-c', 'core.protectNTFS=false', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, env, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  g(['read-tree', parent]);
  for (const [p, v] of Object.entries(files)) {
    const { content, mode = '100644' } = typeof v === 'string' || Buffer.isBuffer(v) ? { content: v } : v;
    const sha = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: dir, env, input: content, encoding: 'utf8' }).trim();
    g(['update-index', '--add', '--cacheinfo', `${mode},${sha},${p}`]);
  }
  const commit = g(['commit-tree', g(['write-tree']), '-p', parent, '-m', message]);
  if (ref) g(['update-ref', ref, commit]);
  return commit;
}
module.exports = { plumbCommit };
