/**
 * Supply-chain guards (spec 021 FR-061, spec 008 delta 2026-10-27). `npm run test:supplychain`. Runs on any OS; no network, no credits.
 *  (a) every entry of package-lock.json that is downloaded has a `resolved` URL on https://registry.npmjs.org and an `integrity`;
 *  (b) no executable or archive is tracked in git, by extension or by the first bytes, outside an explicit allow-list;
 *  (c) every `uses:` in .github/workflows is pinned to a 40-character commit sha.
 * The checks are pure functions; the second half feeds each one a bad input and demands it is caught (a mutation check).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const root = path.join(__dirname, '..', '..');

// (a) lockfile ------------------------------------------------------------------------------------------------------------------
export function lockProblems(lock: any): string[] {
  const out: string[] = [];
  const pk = lock && lock.packages;
  if (!pk || typeof pk !== 'object') return ['package-lock.json has no "packages" map (lockfileVersion 2 or 3 expected)'];
  for (const [name, e] of Object.entries<any>(pk)) {
    if (name === '' || e.link) continue; // the root project, and symlinks to workspace folders
    if (e.inBundle) continue; // shipped inside its parent's tarball: covered by the parent's integrity
    if (typeof e.resolved !== 'string' || !e.resolved.startsWith('https://registry.npmjs.org/')) out.push(`${name}: resolved is not on https://registry.npmjs.org (${typeof e.resolved === 'string' ? e.resolved.slice(0, 60) : 'missing'})`);
    else if (/[@\s]/.test(e.resolved.slice('https://registry.npmjs.org/'.length).split('/-/')[0].replace(/^@[^/]+\//, ''))) out.push(`${name}: resolved has an odd path`);
    if (typeof e.integrity !== 'string' || !/^sha(256|384|512)-[A-Za-z0-9+/]+={0,2}$/.test(e.integrity)) out.push(`${name}: integrity missing or malformed`);
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
];
/** Tracked paths that may be media in a non-executable format. Executables and archives have no allow-list entry: add a path here ONLY with an owner decision written in the spec. */
export const BINARY_ALLOW: string[] = [];
export function magicOf(head: Buffer): string | null {
  for (const [n, sig] of MAGIC) if (head.length >= sig.length && sig.every((b, i) => head[i] === b)) return n;
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
export function pinProblems(file: string, text: string): string[] {
  const out: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const m = /^\s*(?:-\s*)?uses:\s*['"]?([^\s'"#]+)/.exec(line);
    if (!m) return;
    const ref = m[1];
    if (ref.startsWith('./')) return; // a local action or reusable workflow in this repo
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@[0-9a-f]{40}$/.test(ref)) out.push(`${file}:${i + 1}: ${ref} is not pinned to a 40-character commit sha`);
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
  uses += (text.match(/^\s*(?:-\s*)?uses:/gm) || []).length;
  assert.deepStrictEqual(pinProblems(f, text), [], `${f}: every action is pinned to a commit sha`);
}
assert.ok(uses > 5, 'the workflows were actually read');

let tracked: string[] | null = null;
try { tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 }).split('\0').filter(Boolean); } catch { /* not a git checkout (a source tarball): the binary check is skipped */ }
if (tracked) {
  assert.ok(tracked.length > 100, 'git ls-files listed the repository');
  const read = (f: string) => { const fd = fs.openSync(path.join(root, f), 'r'); try { const b = Buffer.alloc(8); const n = fs.readSync(fd, b, 0, 8, 0); return b.subarray(0, n); } finally { fs.closeSync(fd); } };
  assert.deepStrictEqual(binaryProblems(tracked, read), [], 'no executable or archive is tracked (allow-list: BINARY_ALLOW in scripts/test-supplychain.ts)');
} else console.log('supplychain: not a git checkout, binary check skipped');

// mutation checks: each guard must catch a planted bad input -------------------------------------------------------------------------
const good = { packages: { '': { name: 'x' }, 'node_modules/a': { resolved: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz', integrity: 'sha512-AAAA' } } };
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

const files: Record<string, number[]> = { 'a.png': [0x89, 0x50, 0x4e, 0x47], 'b.png': [0x7f, 0x45, 0x4c, 0x46], 'c.txt': [0x4d, 0x5a, 0x90], 'd.ts': [0x63, 0x6f], 'e.dat': [0x50, 0x4b, 0x03, 0x04], 'f.md': [0x00, 0x61, 0x73, 0x6d], 'g.webp': [0x52, 0x49, 0x46, 0x46] };
const rd = (f: string) => Buffer.from(files[f] || []);
const found = binaryProblems([...Object.keys(files), 'run.exe', 'x/y.node', 'lib.DLL', 'z.wasm', 'p.jar'], rd);
assert.deepStrictEqual(found.map((s) => s.split(':')[0]).sort(), ['b.png', 'c.txt', 'e.dat', 'f.md', 'lib.DLL', 'p.jar', 'run.exe', 'x/y.node', 'z.wasm'], 'executables and archives are caught by extension and by magic, media is not');
assert.deepStrictEqual(binaryProblems(['run.exe'], rd, ['run.exe']), [], 'the allow-list is exact');
assert.strictEqual(binaryProblems(['run.exe'], rd, ['other.exe']).length, 1, 'the allow-list does not match by prefix or name');

const wf = (u: string) => `jobs:\n  a:\n    steps:\n      - uses: ${u}\n      - run: x\n`;
const sha = '3d3c42e5aac5ba805825da76410c181273ba90b1';
assert.deepStrictEqual(pinProblems('w.yml', wf(`actions/checkout@${sha} # v7`)), []);
assert.deepStrictEqual(pinProblems('w.yml', wf('./.github/actions/x')), [], 'a local action needs no pin');
for (const bad of ['actions/checkout@v4', 'actions/checkout@main', `actions/checkout@${sha.slice(0, 39)}`, `actions/checkout@${sha}0`, `actions/checkout@${sha.toUpperCase()}`, 'actions/checkout', 'docker://alpine:3', 'owner/repo/.github/workflows/x.yml@v1']) {
  assert.strictEqual(pinProblems('w.yml', wf(bad)).length, 1, `${bad} is caught`);
}
assert.strictEqual(pinProblems('w.yml', `steps:\n  - name: x\n    uses: "actions/checkout@v4"\n`).length, 1, 'a quoted, non-list uses: is caught');
console.log('supplychain: ok');
