/**
 * Supply-chain guards (spec 021 FR-062, spec 008 delta 2026-10-27). `npm run test:supplychain`. Runs on any OS; no network, no credits.
 *  (a) every entry of package-lock.json that is downloaded has a `resolved` URL on https://registry.npmjs.org and an `integrity`;
 *  (b) no executable or archive is tracked in git, by extension or by the first bytes, outside an explicit allow-list;
 *  (c) every `uses:` in .github/workflows is pinned to a 40-character commit sha.
 * The checks are pure functions; the second half feeds each one a bad input and demands it is caught (a mutation check).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

const root = path.join(__dirname, '..', '..');

// (a) lockfile ------------------------------------------------------------------------------------------------------------------
const REG = 'https://registry.npmjs.org/';
/** The package name a lockfile key stands for: its last `node_modules/<name>` segment. An entry's own `name` field must agree with it (no aliases). */
function nameOf(key: string): string {
  const i = key.lastIndexOf('node_modules/');
  return i < 0 ? key : key.slice(i + 'node_modules/'.length);
}
function parentOf(key: string): string | null {
  const i = key.lastIndexOf('/node_modules/');
  return i < 0 ? null : key.slice(0, i);
}
export function lockProblems(lock: any): string[] {
  const out: string[] = [];
  const pk = lock && lock.packages;
  if (!pk || typeof pk !== 'object') return ['package-lock.json has no "packages" map (lockfileVersion 2 or 3 expected)'];
  const bad = new Set<string>(); // entries that failed, so a bundled child of one fails too
  const fail = (k: string, m: string) => { out.push(`${k}: ${m}`); bad.add(k); };
  for (const [key, e] of Object.entries<any>(pk)) {
    if (key === '') continue; // the root project
    if (e.link) { // refused: a link's target is read after `npm ci`, from files the lockfile does not vouch for (spec 021 FR-062); allowed again only when the repository has workspaces and this check learns them
      fail(key, 'link entries are refused until the repository has workspaces (spec 021 FR-062); a link is not covered by any integrity hash');
      continue;
    }
    const name = nameOf(key);
    if (typeof e.name === 'string' && e.name !== name) fail(key, `name field ${String(e.name).slice(0, 40)} disagrees with the key`);
    const r = e.resolved;
    if (typeof r !== 'string') { if (!e.inBundle) fail(key, 'resolved is missing'); }
    else if (!r.startsWith(REG)) fail(key, `resolved is not on ${REG} (${r.slice(0, 60)})`);
    else {
      if (typeof e.version !== 'string' || e.version === '') fail(key, 'version is missing');
      const rest = r.slice(REG.length);
      const cut = rest.indexOf('/-/');
      const tail = cut < 0 ? '' : rest.slice(cut + 3);
      const unscoped = name.replace(/^@[^/]+\//, '');
      if (cut < 0 || rest.slice(0, cut) !== name) fail(key, `resolved path does not name the package ${name}`);
      else if (!tail.startsWith(unscoped + '-') || !/\.tgz$/.test(tail) || tail.includes('/')) fail(key, `resolved file does not belong to ${name}`);
      else if (typeof e.version === 'string' && e.version !== '' && tail !== `${unscoped}-${e.version}.tgz`) fail(key, `resolved file does not match version ${e.version}`);
    }
    if (typeof e.integrity !== 'string' ? !e.inBundle : !/^sha(256|384|512)-[A-Za-z0-9+/]+={0,2}$/.test(e.integrity)) fail(key, 'integrity missing or malformed');
  }
  // a bundled entry (shipped inside its parent's tarball) is covered by the parent's integrity only if a parent exists and passed
  for (const [key, e] of Object.entries<any>(pk)) {
    if (!e.inBundle) continue;
    const par = parentOf(key);
    if (par === null || !pk[par] || pk[par].link || bad.has(par)) fail(key, 'bundled, but its parent is missing or failed');
    else if (bad.has(key) === false) {
      // the parent itself must be a downloaded (or itself bundled and checked) package
      let cur: string | null = par; let guard = 0;
      while (cur !== null && guard++ < 50) { if (bad.has(cur) || !pk[cur]) { fail(key, 'bundled, but an ancestor failed'); break; } if (!pk[cur].inBundle) break; cur = parentOf(cur); }
    }
  }
  return out;
}

// (b) binaries ------------------------------------------------------------------------------------------------------------------
const BAD_EXT = /\.(exe|dll|so|dylib|node|wasm|jar|class|zip|tar|tgz|gz|bz2|xz|7z|rar|msi|dmg|pkg|deb|rpm|appimage|bin|a|o|lib|scr|com|bat|cmd|vsix|asar)$/i;
// extensions of tracked media/fonts/icons that are expected (images are checked by magic below only for executable signatures)
const MEDIA_EXT = /\.(png|webp|svg|ico|icns|mp4|vtt|woff2)$/i;
// first bytes of executables and archives: ELF, MZ, Mach-O (both byte orders, fat/Java class), wasm, zip/jar, gzip, 7z, rar
const MAGIC: Array<[string, number[]]> = [
  ['ELF', [0x7f, 0x45, 0x4c, 0x46]], ['PE/MZ', [0x4d, 0x5a]], ['Mach-O', [0xfe, 0xed, 0xfa, 0xce]], ['Mach-O', [0xfe, 0xed, 0xfa, 0xcf]],
  ['Mach-O', [0xce, 0xfa, 0xed, 0xfe]], ['Mach-O', [0xcf, 0xfa, 0xed, 0xfe]], ['fat Mach-O/Java class', [0xca, 0xfe, 0xba, 0xbe]],
  ['wasm', [0x00, 0x61, 0x73, 0x6d]], ['zip/jar', [0x50, 0x4b, 0x03, 0x04]], ['gzip', [0x1f, 0x8b]], ['7z', [0x37, 0x7a, 0xbc, 0xaf]], ['rar', [0x52, 0x61, 0x72, 0x21]],
  ['bzip2', [0x42, 0x5a, 0x68]], ['cab', [0x4d, 0x53, 0x43, 0x46]], ['xz', [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]], ['zstd', [0x28, 0xb5, 0x2f, 0xfd]], ['MSI/OLE', [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
];
const HEAD = 262; // bytes read per file: enough for the tar signature at offset 257
/** Tracked paths that may be media in a non-executable format. Executables and archives have no allow-list entry: add a path here ONLY with an owner decision written in the spec. */
export const BINARY_ALLOW: string[] = [];
export function magicOf(head: Buffer): string | null {
  for (const [n, sig] of MAGIC) if (head.length >= sig.length && sig.every((b, i) => head[i] === b)) return n;
  if (head.length >= 262 && head.subarray(257, 262).toString('latin1') === 'ustar') return 'tar';
  return null;
}
export function binaryProblems(files: string[], read: (f: string) => Buffer, allow: string[] = BINARY_ALLOW): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (allow.includes(f)) continue;
    if (BAD_EXT.test(f)) { out.push(`${f}: executable or archive extension`); continue; }
    let head: Buffer;
    try { head = read(f); } catch { continue; } // a deleted or unreadable path is not this check's business
    const m = magicOf(head);
    if (m) out.push(`${f}: starts like ${m} (a ${MEDIA_EXT.test(f) ? 'media file' : 'file'} must not be an executable or archive)`);
  }
  return out;
}

// (c) workflow pins -------------------------------------------------------------------------------------------------------------
/** Fails closed: EVERY `uses` key in any YAML spelling (plain, quoted, spaced before the colon, in a flow map) must name owner/repo[/path]@<40 hex>. */
export function pinProblems(file: string, text: string): string[] {
  const out: string[] = [];
  const KEY = /(^|[\s{,[])(?:"uses"|'uses'|uses)\s*:/g;
  text.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*#/.test(line)) return; // a comment line
    // spellings this scan cannot read safely are refused: a `?` key indicator anywhere outside a quoted scalar (block or flow, any indent),
    // and a quoted key with an escape (\x75, \u0075 ...)
    const bare = line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'/g, '""').replace(/(^|\s)#.*$/, '');
    if (/(^|[\s{,[])\?(\s|$)/.test(bare)) out.push(`${file}:${i + 1}: a "?" key indicator cannot be checked safely`);
    if (/(^|[\s{,[])(?:"(?:[^"\\]|\\.)*\\(?:[^"\\]|\\.)*"|'(?:[^']|'')*\\(?:[^']|'')*')\s*:/.test(line)) out.push(`${file}:${i + 1}: a quoted key with a backslash cannot be checked safely`);
    KEY.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = KEY.exec(line))) {
      const after = line.slice(m.index + m[0].length).trimStart();
      const v = /^(?:"([^"]*)"|'([^']*)'|([^\s,}\]#]*))/.exec(after);
      const ref = v ? (v[1] ?? v[2] ?? v[3] ?? '') : '';
      if (ref.startsWith('./')) continue; // a local action or reusable workflow in this repository
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@[0-9a-f]{40}$/.test(ref) && !/^docker:\/\/[A-Za-z0-9_./:-]+@sha256:[0-9a-f]{64}$/.test(ref)) out.push(`${file}:${i + 1}: "${ref.slice(0, 60)}" is not pinned to a 40-character commit sha (or a docker sha256 digest)`);
    }
  });
  return out;
}

// the real repository ------------------------------------------------------------------------------------------------------------
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
assert.deepStrictEqual(lockProblems(lock), [], 'package-lock.json: every entry resolves on registry.npmjs.org with an integrity');
assert.ok(Object.keys(lock.packages).length > 50, 'the lockfile was actually read');

const wfDir = path.join(root, '.github', 'workflows');
let uses = 0;
for (const f of fs.readdirSync(wfDir).filter((n) => /\.ya?ml$/.test(n))) {
  const text = fs.readFileSync(path.join(wfDir, f), 'utf8');
  uses += (text.match(/(^|[\s{,[])(?:"uses"|'uses'|uses)\s*:/gm) || []).length;
  assert.deepStrictEqual(pinProblems(f, text), [], `${f}: every action is pinned to a commit sha`);
}
assert.ok(uses > 5, 'the workflows were actually read');

export type GitRun = (args: string[]) => { status: number | null; stdout: string; stderr: string; error?: Error };
const realGit: GitRun = (args) => { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 }); return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error }; };
const readHead = (dir: string) => (f: string) => { const fd = fs.openSync(path.join(dir, f), 'r'); try { const b = Buffer.alloc(HEAD); const n = fs.readSync(fd, b, 0, HEAD, 0); return b.subarray(0, n); } finally { fs.closeSync(fd); } };
/** The binary check of a checkout. Skipped (null) only when there is no .git at all (a source tarball); any git failure (no git, dubious ownership, non-zero exit, an empty listing) is a problem, never a skip. */
export function trackedBinaryProblems(hasGit: boolean, run: GitRun, read: (f: string) => Buffer, minFiles = 100): string[] | null {
  if (!hasGit) return null;
  let r: ReturnType<GitRun>;
  try { r = run(['ls-files', '-z']); } catch (e) { return [`git ls-files could not run: ${String((e as Error).message).slice(0, 80)}`]; }
  if (r.error) return [`git ls-files could not run: ${String(r.error.message).slice(0, 80)}`];
  if (r.status !== 0) return [`git ls-files failed with status ${r.status}${r.stderr ? ': ' + r.stderr.slice(0, 80) : ''}`];
  if (r.stderr.trim()) return [`git ls-files printed errors: ${r.stderr.trim().slice(0, 80)}`];
  const files = r.stdout.split('\0').filter(Boolean);
  if (files.length < minFiles) return [`git ls-files listed only ${files.length} files`];
  return binaryProblems(files, read);
}
const real = trackedBinaryProblems(fs.existsSync(path.join(root, '.git')), realGit, readHead(root));
if (real === null) console.log('supplychain: no .git folder, binary check skipped');
else assert.deepStrictEqual(real, [], 'no executable or archive is tracked (allow-list: BINARY_ALLOW in scripts/test-supplychain.ts)');
// a failing git fails the check; only a missing .git skips it
const big = Array.from({ length: 120 }, (_, i) => `f${i}.txt`).join('\0') + '\0';
const nofile = () => Buffer.from('text');
assert.deepStrictEqual(trackedBinaryProblems(true, () => ({ status: 0, stdout: big, stderr: '' }), nofile), [], 'a good listing passes');
for (const [what, run] of Object.entries<GitRun>({
  throws: () => { throw new Error('spawn git ENOENT'); }, 'spawn error': () => ({ status: null, stdout: '', stderr: '', error: new Error('ENOENT') }),
  'non-zero': () => ({ status: 128, stdout: '', stderr: 'fatal: detected dubious ownership' }), 'non-zero with output': () => ({ status: 1, stdout: big, stderr: '' }),
  'error output': () => ({ status: 0, stdout: big, stderr: 'fatal: something' }), 'empty listing': () => ({ status: 0, stdout: '', stderr: '' }),
})) assert.strictEqual((trackedBinaryProblems(true, run, nofile) || []).length, 1, `git ${what} fails the check`);
assert.strictEqual(trackedBinaryProblems(false, () => { throw new Error('must not run'); }, nofile), null, 'no .git: skipped, git not run');
assert.strictEqual(trackedBinaryProblems(true, () => ({ status: 0, stdout: big + 'run.exe\0', stderr: '' }), nofile)!.length, 1, 'a planted executable in a good listing is caught');

// mutation checks: each guard must catch a planted bad input -------------------------------------------------------------------------
const good = { packages: { '': { name: 'x' }, 'node_modules/a': { version: '1.0.0', resolved: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz', integrity: 'sha512-AAAA' } } };
assert.deepStrictEqual(lockProblems(good), []);
const mut = (f: (e: any) => void) => { const c = JSON.parse(JSON.stringify(good)); f(c.packages['node_modules/a']); return lockProblems(c); };
assert.strictEqual(mut((e) => { e.resolved = 'https://evil.example/a-1.0.0.tgz'; }).length, 1, 'a foreign host is caught');
assert.strictEqual(mut((e) => { e.resolved = 'http://registry.npmjs.org/a/-/a-1.0.0.tgz'; }).length, 1, 'plain http is caught');
assert.strictEqual(mut((e) => { e.resolved = 'https://registry.npmjs.org.evil.example/a.tgz'; }).length, 1, 'a look-alike host is caught');
assert.strictEqual(mut((e) => { e.resolved = 'git+ssh://git@github.com/x/a.git#abc'; }).length, 1, 'a git dependency is caught');
assert.strictEqual(mut((e) => { delete e.resolved; }).length, 1, 'a missing resolved is caught');
assert.strictEqual(mut((e) => { delete e.integrity; }).length, 1, 'a missing integrity is caught');
assert.strictEqual(mut((e) => { e.integrity = 'md5-abc'; }).length, 1, 'a weak integrity is caught');
assert.strictEqual(lockProblems({}).length, 1, 'a lockfile without packages is caught');
// name tied to the URL (the lodash -> evil-lodash swap), scoped names, aliases, versions
const withKey = (key: string, e: any) => lockProblems({ packages: { '': {}, [key]: e } });
const ok = (n: string, v = '1.0.0') => ({ version: v, resolved: `https://registry.npmjs.org/${n}/-/${n.replace(/^@[^/]+\//, '')}-${v}.tgz`, integrity: 'sha512-AAAA' });
assert.deepStrictEqual(withKey('node_modules/lodash', ok('lodash')), []);
assert.deepStrictEqual(withKey('node_modules/@scope/pkg', ok('@scope/pkg')), [], 'scoped names are handled');
assert.deepStrictEqual(withKey('node_modules/a/node_modules/lodash', ok('lodash')), [], 'a nested key uses its last segment');
assert.strictEqual(withKey('node_modules/lodash', ok('evil-lodash')).length, 1, 'a package swapped for another name is caught');
assert.strictEqual(withKey('node_modules/@scope/pkg', ok('pkg')).length, 1, 'a scope dropped from the URL is caught');
assert.strictEqual(withKey('node_modules/lodash', { ...ok('lodash'), resolved: 'https://registry.npmjs.org/lodash/-/evil-1.0.0.tgz' }).length, 1, 'another file name under the right package is caught');
assert.strictEqual(withKey('node_modules/lodash', { ...ok('lodash'), version: '2.0.0' }).length, 1, 'a file of another version is caught');
assert.ok(withKey('node_modules/alias', { ...ok('real'), name: 'real' }).length > 0, 'an alias (name field differs from the key) is refused');
assert.strictEqual(withKey('node_modules/alias', ok('real')).length, 1, 'a URL of another package is caught');
assert.ok(withKey('node_modules/lodash', { ...ok('@evil/x'), name: '@evil/x' }).length > 0, 'a name field that turns an entry into another package is caught');
assert.strictEqual(withKey('node_modules/lodash', { ...ok('lodash'), name: '@evil/x' }).length, 1, 'a name field that disagrees with the key and an honest URL is caught');
assert.deepStrictEqual(withKey('node_modules/lodash', { ...ok('lodash'), name: 'lodash' }), [], 'a name field that agrees passes');
assert.strictEqual(withKey('node_modules/lodash', { ...ok('lodash'), version: undefined }).length, 1, 'a registry entry without a version is caught');
assert.strictEqual(withKey('node_modules/lodash', { ...ok('lodash'), version: '' }).length, 1, 'an empty version is caught');
// optional and dev entries are checked like the rest (the copilot-sdk platform runtimes are optional)
for (const flag of ['optional', 'dev', 'peer', 'devOptional']) {
  assert.strictEqual(withKey('node_modules/p', { ...ok('p'), [flag]: true, resolved: 'https://evil.example/p-1.0.0.tgz' }).length, 1, `${flag} entries are not exempt`);
  assert.strictEqual(withKey('node_modules/p', { ...ok('p'), [flag]: true, integrity: undefined }).length, 1, `${flag} entries need an integrity`);
}
// links: every link entry is refused (the project has no workspaces), whatever it points at
for (const r of ['file:../../evil', '../../evil', '/etc', 'C:\\evil', '~/x', 'a/../../x', '', undefined, 'packages/l', '.', 'node_modules/l', 'node_modules/lodash']) {
  const o = withKey('node_modules/l', { link: true, resolved: r });
  assert.strictEqual(o.length, 1, `link ${String(r)} is refused`);
  assert.ok(/spec 021 FR-062/.test(o[0]), 'the message points at the spec');
}
assert.strictEqual(withKey('node_modules/lodash', { link: true, resolved: 'node_modules/lodash' }).length, 1, 'a link to itself is refused');
// bundled entries: must have a parent that passed
const bundle = (parent: any, child: any) => lockProblems({ packages: { '': {}, 'node_modules/p': parent, 'node_modules/p/node_modules/c': child } });
assert.deepStrictEqual(bundle(ok('p'), { version: '1.0.0', inBundle: true }), [], 'a bundled child of a good parent passes');
assert.strictEqual(bundle({ ...ok('p'), resolved: 'git+ssh://x' }, { version: '1.0.0', inBundle: true }).length, 2, 'a bundled child of a failing parent fails with it');
assert.strictEqual(lockProblems({ packages: { '': {}, 'node_modules/orphan': { inBundle: true, resolved: 'git+ssh://x' } } }).length > 0, true, 'a bundled entry with no parent is caught');
assert.strictEqual(lockProblems({ packages: { '': {}, 'node_modules/p/node_modules/c': { inBundle: true, version: '1.0.0' } } }).length, 1, 'a bundled entry whose parent is missing is caught');
const cleanChild = ok('c');
assert.strictEqual(lockProblems({ packages: { '': {}, 'node_modules/p/node_modules/c': { ...cleanChild, inBundle: true } } }).length, 1, 'a clean bundled entry whose parent is missing is caught');
assert.strictEqual(lockProblems({ packages: { '': {}, 'node_modules/c': { ...cleanChild, inBundle: true } } }).length, 1, 'a clean bundled top-level entry (no parent at all) is caught');
assert.strictEqual(bundle(ok('p'), { version: '1.0.0', inBundle: true, resolved: 'git+ssh://x' }).length, 1, 'a bundled entry still may not resolve off the registry');

const tar = Buffer.alloc(262); tar.write('ustar', 257, 'latin1');
const files: Record<string, Buffer> = {
  'a.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'b.png': Buffer.from([0x7f, 0x45, 0x4c, 0x46]), 'c.txt': Buffer.from([0x4d, 0x5a, 0x90]), 'd.ts': Buffer.from('co'),
  'e.dat': Buffer.from([0x50, 0x4b, 0x03, 0x04]), 'f.md': Buffer.from([0x00, 0x61, 0x73, 0x6d]), 'g.webp': Buffer.from('RIFF'),
  'bz.png': Buffer.from('BZh9'), 'xz.png': Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]), 'zst.png': Buffer.from([0x28, 0xb5, 0x2f, 0xfd]),
  'msi.png': Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), 'cab.png': Buffer.from('MSCF\0\0\0\0'), 'tar.png': tar, 'short.png': Buffer.from('ustar'),
};
const rd = (f: string) => files[f] || Buffer.alloc(0);
const found = binaryProblems([...Object.keys(files), 'run.exe', 'x/y.node', 'lib.DLL', 'z.wasm', 'p.jar'], rd);
assert.deepStrictEqual(found.map((s) => s.split(':')[0]).sort(), ['b.png', 'bz.png', 'c.txt', 'cab.png', 'e.dat', 'f.md', 'lib.DLL', 'msi.png', 'p.jar', 'run.exe', 'tar.png', 'x/y.node', 'xz.png', 'z.wasm', 'zst.png'], 'executables and archives are caught by extension and by magic, media is not');
assert.deepStrictEqual(binaryProblems(['run.exe'], rd, ['run.exe']), [], 'the allow-list is exact');
assert.strictEqual(binaryProblems(['run.exe'], rd, ['other.exe']).length, 1, 'the allow-list does not match by prefix or name');

const wf = (u: string) => `jobs:\n  a:\n    steps:\n      - uses: ${u}\n      - run: x\n`;
const sha = '3d3c42e5aac5ba805825da76410c181273ba90b1';
assert.deepStrictEqual(pinProblems('w.yml', wf(`actions/checkout@${sha} # v7`)), []);
assert.deepStrictEqual(pinProblems('w.yml', wf('./.github/actions/x')), [], 'a local action needs no pin');
for (const bad of ['actions/checkout@v4', 'actions/checkout@main', `actions/checkout@${sha.slice(0, 39)}`, `actions/checkout@${sha}0`, `actions/checkout@${sha.toUpperCase()}`, 'actions/checkout', 'docker://alpine:3', 'owner/repo/.github/workflows/x.yml@v1', '', '|']) {
  assert.strictEqual(pinProblems('w.yml', wf(bad)).length, 1, `${bad} is caught`);
}
// other valid YAML spellings of the same key
const forms = ['- {uses: actions/checkout@v4}', '- {name: x, uses: actions/checkout@v4, with: {a: b}}', '- "uses": actions/checkout@v4', "- 'uses': actions/checkout@v4", '- uses : actions/checkout@v4',
  '- uses:   actions/checkout@v4', '- uses: "actions/checkout@v4"', "- uses: 'actions/checkout@v4'", 'uses: actions/checkout@v4', '    uses: actions/checkout@v4', '- {"uses": "actions/checkout@v4"}', '- [x, {uses: actions/checkout@v4}]',
  '- ? uses\n  : actions/checkout@v4', '- { ? uses\n  : actions/checkout@v4 }', '- [ ? uses\n  : actions/checkout@v4 ]', '    ? uses', '- {a: b, ? uses: x}', '- ? {uses: actions/checkout@v4}', '- "u\\x73es": actions/checkout@v4', '- "\\u0075ses": actions/checkout@v4', "- 'u\\x73es': actions/checkout@v4", '- uses: |', '- uses: >', '- uses:', '- uses: docker://alpine@sha256:abc'];
for (const f of forms) assert.ok(pinProblems('w.yml', `steps:\n  ${f}\n`).length >= 1, `${f} is caught`);
const pinned = ['- run: echo "why ? not"', '- run: curl https://x.example/a?b=c', '- {uses: actions/checkout@' + sha + '}', '- "uses": actions/checkout@' + sha, '- uses : actions/checkout@' + sha + ' # v7', '- uses: "actions/checkout@' + sha + '"', '- uses: ./local', '- uses: docker://alpine@sha256:' + 'a'.repeat(64), '# uses: actions/checkout@v4', '- {uses: owner/repo/path/x.yml@' + sha + '}'];
for (const f of pinned) assert.deepStrictEqual(pinProblems('w.yml', `steps:\n  ${f}\n`), [], `${f} passes`);

// (d) Dependabot config (spec 021 FR-062, delta 2026-10-28): minor/patch groups only, majors ignored, electron ignored.
function dependabotProblems(text: string): string[] {
  const out: string[] = [];
  const blocks = text.split(/^  - package-ecosystem:/m).slice(1);
  if (blocks.length < 2) out.push('expected the github-actions and npm ecosystems');
  for (const b of blocks) {
    const eco = b.split('\n')[0].trim();
    const groups = b.split(/^    groups:/m)[1]?.split(/^    ignore:/m)[0] || '';
    if (!/update-types:\s*\[\s*minor\s*,\s*patch\s*\]/.test(groups) || /major/.test(groups)) out.push(`${eco}: the group must take update-types [minor, patch] only`);
    const ignore = b.split(/^    ignore:/m)[1] || '';
    if (!/dependency-name:\s*'\*'\s*\n\s*update-types:\s*\['version-update:semver-major'\]/.test(ignore)) out.push(`${eco}: semver-major updates must be ignored`);
    const cd = /^    cooldown:\n      default-days:\s*(\d+)\s*$/m.exec(b);
    if (!cd || Number(cd[1]) < 7) out.push(`${eco}: cooldown default-days must be at least 7`);
    if (eco === 'npm' && !/^\s+- dependency-name: electron\s*$/m.test(ignore)) out.push('npm: electron must be ignored (pinned, hash-verified runtime)');
  }
  return out;
}
const depText = fs.readFileSync(path.join(root, '.github', 'dependabot.yml'), 'utf8').replace(/\r\n/g, '\n'); // a Windows checkout has CRLF; the planted cases below edit LF text
assert.deepStrictEqual(dependabotProblems(depText), [], 'dependabot.yml: minor/patch groups, major ignore, electron ignored');
assert.ok(dependabotProblems(depText.replace(/\n      - dependency-name: '\*'\n        update-types: \['version-update:semver-major'\]/g, '')).length >= 2, 'a missing major ignore is caught');
assert.ok(dependabotProblems(depText.replace(/\n      - dependency-name: electron/, '')).length === 1, 'a missing electron ignore is caught');
assert.ok(dependabotProblems(depText.replace(/update-types: \[minor, patch\]/g, "patterns2: ['*']")).length >= 2, 'a group without update-types is caught');
assert.strictEqual(dependabotProblems(depText.replace(/\n    cooldown:\n      default-days: 7/g, '')).length, 2, 'a missing cooldown is caught in both ecosystems');
assert.strictEqual(dependabotProblems(depText.replace(/default-days: 7/g, 'default-days: 3')).length, 2, 'a 3-day cooldown is caught in both ecosystems');
console.log('supplychain: ok');
