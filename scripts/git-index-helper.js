'use strict';
// Test helper for scripts/test-picture-budget.js and scripts/test-spec-numbers.js (spec 021 FR-085). Builds a commit WITHOUT touching the working
// tree: blobs by `git hash-object -w`, a temporary index (GIT_INDEX_FILE), `write-tree`, `commit-tree`. A path with a newline, a colon or `::` is
// then a git path only, so the case runs on Windows too (a file system there refuses such names). Not run on its own.
const path = require('path');
const { execFileSync } = require('child_process');

/** Spec 021 FR-095: no test-helper git child may hang for ever (issue #1631: a `git hash-object` held the heavy test lock for 37 minutes). */
const GIT_TIMEOUT_MS = 60000;

/** `git <args>` in `dir`, killed after `timeoutMs` (SIGKILL). On a timeout it throws an Error naming the git subcommand and the timeout (never the
 * arguments or the input). `gitCmd` is the binary and its leading arguments (default `['git']`): a test passes a sleeping stand-in
 * (`[process.execPath, script]`), which runs the same on Windows. Returns stdout (a string, or a Buffer when `encoding` is null). */
function gitRun(dir, args, { input, env, encoding = 'utf8', gitCmd = ['git'], timeoutMs = GIT_TIMEOUT_MS } = {}) {
  try {
    return execFileSync(gitCmd[0], [...gitCmd.slice(1), ...args], { cwd: dir, env, input, encoding, stdio: ['pipe', 'pipe', 'pipe'], timeout: timeoutMs, killSignal: 'SIGKILL', windowsHide: true });
  } catch (e) {
    if (e && e.code === 'ETIMEDOUT') {
      let i = 0;
      while (i < args.length && (args[i] === '-c' || args[i - 1] === '-c')) i++;
      const t = new Error(`git ${args[i] || ''} timed out after ${timeoutMs} ms (killed)`.replace('git  ', 'git '));
      t.code = 'ETIMEDOUT'; // a caller that treats an ordinary git failure as "no answer" can still let a hang fail
      throw t;
    }
    throw e;
  }
}

/** `gitRun`, but an ordinary git failure (non-zero exit) gives null ("no answer"); a timeout still throws (FR-095: a hang must fail, not look like "no answer"). */
function gitTry(dir, args, opts) {
  try { return gitRun(dir, args, opts); } catch (e) { if (e && e.code === 'ETIMEDOUT') throw e; return null; }
}

let n = 0;
/** files: { path: content (string or Buffer) | { content, mode } }. Returns the new commit sha; `ref` (a full ref name) is moved to it. */
function plumbCommit(dir, parent, files, message, ref, opts = {}) {
  const env = { ...process.env, GIT_INDEX_FILE: path.join(dir, '.git', `plumb-index-${n++}`), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
  const g = (args, input) => gitRun(dir, ['-c', 'core.protectNTFS=false', '-c', 'commit.gpgsign=false', ...args], { env, input, ...opts }).trim();
  g(['read-tree', parent]);
  for (const [p, v] of Object.entries(files)) {
    const { content, mode = '100644' } = typeof v === 'string' || Buffer.isBuffer(v) ? { content: v } : v;
    const sha = g(['hash-object', '-w', '--stdin'], content);
    g(['update-index', '--add', '--cacheinfo', `${mode},${sha},${p}`]);
  }
  const commit = g(['commit-tree', g(['write-tree']), '-p', parent, '-m', message]);
  if (ref) g(['update-ref', ref, commit]);
  return commit;
}
module.exports = { plumbCommit, gitRun, gitTry, GIT_TIMEOUT_MS };
