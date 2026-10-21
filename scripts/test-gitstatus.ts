/** Unit test (spec 063): git status parsing, the runner's limits and read-only argv, and the window's words. No real git needed. */
import * as assert from 'assert';
import * as path from 'path';
import { GIT_MAX_FILES, folderGitStatus, parseNumstatZ, parsePorcelainZ } from '../src/main/gitstatus';
import type { GitExec } from '../src/main/gitstatus';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const GS = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'gitstatus.js'));
const Z = (...r: string[]): string => r.join('\0') + '\0';

async function main(): Promise<void> {
  // porcelain v1 -z: branch header with upstream and ahead/behind; modified, added, deleted, renamed (old path follows), untracked, conflict
  const p = parsePorcelainZ(Z('## main...origin/main [ahead 2, behind 1]', ' M src/a.ts', 'A  src/new.ts', ' D gone.ts', 'R  src/b2.ts', 'src/b.ts', '?? notes.md', 'UU merge.ts'));
  assert.deepStrictEqual([p.branch, p.ahead, p.behind], ['main', 2, 1]);
  assert.deepStrictEqual(p.files.map((f) => `${f.state}:${f.path}`), ['modified:src/a.ts', 'added:src/new.ts', 'deleted:gone.ts', 'renamed:src/b2.ts', 'untracked:notes.md', 'conflict:merge.ts']);
  assert.deepStrictEqual(parsePorcelainZ(Z('## feature/x')).branch, 'feature/x', 'no upstream');
  assert.deepStrictEqual(parsePorcelainZ(Z('## No commits yet on main')).branch, 'main');
  const det = parsePorcelainZ(Z('## HEAD (no branch)'));
  assert.ok(det.detached && det.branch === 'HEAD');
  assert.strictEqual(parsePorcelainZ(Z('## main', ' M a\u0007b.ts')).files[0].path, 'ab.ts', 'control characters removed');

  // numstat -z: counts, binary, rename records
  const n = parseNumstatZ(Z('12\t3\tsrc/a.ts', '-\t-\timg.png', '5\t1\t') + Z('src/b.ts', 'src/b2.ts'));
  assert.deepStrictEqual(n.get('src/a.ts'), { added: 12, removed: 3 });
  assert.deepStrictEqual(n.get('img.png'), { binary: true });
  assert.deepStrictEqual(n.get('src/b2.ts'), { added: 5, removed: 1 }, 'a rename is keyed by its new path');

  // the runner: read-only argv, counts merged, the file list capped, any failure is { repo: false }
  const seen: string[][] = [];
  const exec = (status: string, diff: string | Error): GitExec => async (args) => {
    seen.push(args);
    if (args.includes('status')) return status;
    if (diff instanceof Error) throw diff;
    return diff;
  };
  const r = await folderGitStatus('/w/api', exec(Z('## main', ' M src/a.ts', '?? new.md'), Z('12\t3\tsrc/a.ts')));
  assert.deepStrictEqual(r, { repo: true, branch: 'main', files: [{ path: 'src/a.ts', state: 'modified', added: 12, removed: 3 }, { path: 'new.md', state: 'untracked' }], more: 0 });
  assert.deepStrictEqual(seen[0], ['-C', '/w/api', 'status', '--porcelain=v1', '--branch', '-z', '--untracked-files=all']);
  assert.deepStrictEqual(seen[1], ['-C', '/w/api', 'diff', 'HEAD', '--numstat', '-z']);
  assert.ok(!seen.flat().some((a) => /^(fetch|pull|push|commit|add|reset|checkout|stash|gc)$/.test(a)), 'no git command that writes');
  const noHead = await folderGitStatus('/w/new', exec(Z('## No commits yet on main', '?? a.ts'), new Error('bad revision HEAD')));
  assert.ok(noHead.repo && noHead.files.length === 1, 'no HEAD yet: status without line counts');
  assert.deepStrictEqual(await folderGitStatus('/w/x', async () => { throw new Error('not a git repository'); }), { repo: false });
  assert.deepStrictEqual(await folderGitStatus('/w/x', async () => ''), { repo: false }, 'empty output: not a repository');
  const many = Z('## main', ...Array.from({ length: GIT_MAX_FILES + 7 }, (_, i) => `?? f${i}.txt`));
  const big = await folderGitStatus('/w/big', exec(many, ''));
  assert.ok(big.repo && big.files.length === GIT_MAX_FILES && big.more === 7, 'at most 200 files, the rest counted');

  // the nodeGitExec argv starts with --no-optional-locks (no lock files written): read from the source, no git run here
  const src = require('fs').readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'gitstatus.ts'), 'utf8') as string;
  assert.ok(/execFile\('git', \['--no-optional-locks', \.\.\.args\]/.test(src), 'git runs with --no-optional-locks, argv only');

  // the window's words (text only)
  assert.strictEqual(GS.chipText({ repo: false }), '');
  assert.strictEqual(GS.chipText({ repo: true, branch: 'main', files: [], more: 0 }), ' · main');
  const st = { repo: true, branch: 'feature/login', ahead: 2, files: [{ path: 'src/a.ts', state: 'modified', added: 12, removed: 3 }, { path: 'img.png', state: 'modified', binary: true }, { path: 'n.md', state: 'untracked' }], more: 4 };
  assert.strictEqual(GS.chipText(st), ' · feature/login · 7 changed');
  assert.strictEqual(GS.chipLabel(st), 'Branch feature/login, 7 changed files. Show them.');
  assert.strictEqual(GS.body(st), 'On branch feature/login (2 ahead of its upstream). 7 files have changes that are not committed yet:');
  assert.deepStrictEqual(GS.lines(st), ['src/a.ts · +12 −3 · changed', 'img.png · binary · changed', 'n.md · new, not tracked yet', 'and 4 more']);
  assert.strictEqual(GS.chipText({ repo: true, branch: 'HEAD', detached: true, files: [], more: 0 }), ' · detached HEAD');
  console.log('gitstatus: porcelain/numstat parsing, read-only argv, limits, failures, window words OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
