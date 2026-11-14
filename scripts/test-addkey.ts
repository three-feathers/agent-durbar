/**
 * Spec 033 FR-090 (issue #1709, review of #1713): which folder counts as "already in the office" (src/main/addkey.ts). On a real temp
 * folder: a trailing slash, `..`, a symlink to the folder; case on win32 and darwin (a fake realpath, no second disk); a workspace
 * file; a hidden agent; a folder that does not exist yet. No Electron. `npm run test:addkey`.
 */
process.exitCode = 1;
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { canonicalKey, findAdded } from '../src/main/addkey';

interface A { id: string; cwd: string; workspaceFile?: string; hidden?: boolean }
const keyOf = (a: A): string => a.workspaceFile ?? a.cwd;
const id = (p: string): string => p;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-addkey-'));
try {
  const proj = path.join(root, 'zproj');
  fs.mkdirSync(path.join(proj, 'sub'), { recursive: true });
  const agents: A[] = [{ id: 'a1', cwd: proj }];
  assert.strictEqual(findAdded(proj, agents, keyOf)?.id, 'a1', 'the same path');
  assert.strictEqual(findAdded(proj + path.sep, agents, keyOf)?.id, 'a1', 'a trailing slash');
  assert.strictEqual(findAdded(path.join(proj, 'sub', '..'), agents, keyOf)?.id, 'a1', 'a .. segment');
  assert.strictEqual(findAdded(path.join(root, 'other'), agents, keyOf), undefined, 'another folder is new');
  assert.strictEqual(findAdded(path.join(root, 'missing'), agents, keyOf), undefined, 'a folder that does not exist is new, no throw');
  const miss = path.join(root, 'missing', 'x');
  const folds = process.platform === 'win32' || process.platform === 'darwin'; // canonicalKey lower-cases there (the case rule below)
  assert.strictEqual(canonicalKey(miss), folds ? miss.toLowerCase() : miss, 'a missing path stays as written (lower-cased on win32 and darwin)');
  assert.strictEqual(canonicalKey(miss, 'linux'), miss, 'and as written, case kept, on Linux');
  // a link to an added folder (Windows without the right may refuse a symlink: then this step is skipped, said below)
  const link = path.join(root, 'link');
  let linked = true;
  try { fs.symlinkSync(proj, link, 'junction'); } catch (e) {
    if (!['EPERM', 'EACCES', 'ENOSYS'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e; // only "this OS may not make one" skips
    linked = false;
  }
  if (linked) {
    assert.strictEqual(findAdded(link, agents, keyOf)?.id, 'a1', 'a symlink to an added folder is that folder');
    assert.strictEqual(findAdded(proj, [{ id: 'a2', cwd: link }], keyOf)?.id, 'a2', 'and the other way round');
  } else console.log('[addkey] SKIPPED the symlink steps: this OS refused to create one without privilege (EPERM/EACCES)');
  // case: a name that differs only by case is the same folder on Windows and macOS, not on Linux
  const up = (p: string): string => p.replace(path.sep + 'zproj', path.sep + 'ZPROJ');
  assert.strictEqual(canonicalKey(up(proj), 'darwin', id), canonicalKey(proj, 'darwin', id), 'darwin ignores case');
  assert.strictEqual(canonicalKey(up(proj), 'win32', id), canonicalKey(proj, 'win32', id), 'win32 ignores case');
  assert.notStrictEqual(canonicalKey(up(proj), 'linux', id), canonicalKey(proj, 'linux', id), 'linux keeps case');
  assert.strictEqual(findAdded(up(proj), agents, keyOf, 'darwin', id)?.id, 'a1', 'a case-only difference is already added on darwin');
  assert.strictEqual(findAdded(up(proj), agents, keyOf, 'linux', id), undefined, 'but not on Linux');
  // a workspace file is its own key; the folder beside it is not the same entry
  const ws = path.join(proj, 'x.code-workspace');
  const wsAgents: A[] = [{ id: 'w1', cwd: proj, workspaceFile: ws }];
  assert.strictEqual(findAdded(ws, wsAgents, keyOf)?.id, 'w1', 'the workspace file is found');
  assert.strictEqual(findAdded(proj, wsAgents, keyOf), undefined, 'the folder is not the workspace file');
  // a hidden folder (Hide folder) is still in the office
  assert.strictEqual(findAdded(proj, [{ id: 'h1', cwd: proj, hidden: true }], keyOf)?.id, 'h1', 'a hidden agent counts');
  assert.strictEqual(findAdded(proj, [], keyOf), undefined, 'an empty office has nothing');
  console.log('OK test-addkey');
  process.exitCode = 0;
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
