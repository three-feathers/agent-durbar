/**
 * Spec 008 FR-195 (T151): the Electron download cache shared by `.github/actions/npm-ci` and the warmer `electron-cache.yml`.
 * `npm run test:electroncache`. Any OS; no Electron run, no network (the downloads are fake), no credits.
 */
import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.join(__dirname, '..', '..');
type V = { electron: string; builder: string };
type Plan = V & { key: string; restorePrefix: string; electronDir: string; builderDir: string };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ec = require(path.join(root, 'scripts', 'electron-cache.js')) as {
  lockVersions: (lock: unknown) => V;
  cacheKey: (o: string, a: string, v: V) => { key: string; restorePrefix: string };
  electronCacheRoot: (platform: string, env: Record<string, string | undefined>, home: string) => string;
  warmTargets: (o: string) => { platform: string; arch: string }[];
  shasumsText: (c: Record<string, string>) => string;
  withRetries: <T>(what: string, fn: () => Promise<T>, waits?: number[], sleep?: (s: number) => Promise<void>, log?: (s: string) => void) => Promise<T>;
  plan: (env: Record<string, string | undefined>, home: string, platform: string, lock?: unknown) => Plan;
  seed: (dir: string, version: string, checksums: Record<string, string>) => string;
  RETRY_WAITS: number[];
};
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-cache-test-'));

async function main(): Promise<void> {
  // 1. key: the lockfile's exact versions, the FR-188 shape, and a restore prefix of the same Electron version only
  const v = ec.lockVersions(lock);
  assert.strictEqual(v.electron, lock.packages['node_modules/electron'].version);
  assert.strictEqual(v.builder, lock.packages['node_modules/electron-builder'].version);
  const k = ec.cacheKey('Linux', 'X64', v);
  assert.strictEqual(k.key, `electron-Linux-X64-${v.electron}-builder-${v.builder}`, 'the FR-188 key shape is kept');
  assert.strictEqual(k.restorePrefix, `electron-Linux-X64-${v.electron}-builder-`, 'the fallback keeps the Electron version (another version is useless: the zip name embeds it)');
  assert.ok(k.key.startsWith(k.restorePrefix));
  assert.notStrictEqual(ec.cacheKey('macOS', 'ARM64', v).key, ec.cacheKey('macOS', 'X64', v).key, 'the arch is in the key');
  assert.throws(() => ec.lockVersions({ packages: { 'node_modules/electron': { version: '^44.0.0' }, 'node_modules/electron-builder': { version: '26.0.0' } } }), /exact/);
  assert.throws(() => ec.cacheKey('Linux; rm -rf', 'X64', v), /bad runner/);

  // 2. the cached Electron directory is the one electron-builder always uses (@electron/get's default), on this OS and the others
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const envPaths = require(path.join(root, 'node_modules', 'env-paths')) as (n: string, o: { suffix: string }) => { cache: string };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const builderGet = require(path.join(root, 'node_modules', 'app-builder-lib', 'out', 'util', 'electronGet.js')) as {
    defaultElectronGetCacheRoot: () => string; resolveSeededChecksums: (root: string, version: string, file: string) => Promise<Record<string, string> | null>;
  };
  const here = ec.electronCacheRoot(process.platform, process.env, os.homedir());
  assert.strictEqual(here, envPaths('electron', { suffix: '' }).cache, 'same directory as @electron/get\'s default');
  assert.strictEqual(here, builderGet.defaultElectronGetCacheRoot(), 'same directory as electron-builder\'s');
  assert.strictEqual(ec.electronCacheRoot('darwin', {}, '/Users/runner'), '/Users/runner/Library/Caches/electron');
  assert.strictEqual(ec.electronCacheRoot('win32', { LOCALAPPDATA: 'C:\\Users\\r\\AppData\\Local' }, 'C:\\Users\\r'), 'C:\\Users\\r\\AppData\\Local\\electron\\Cache');
  assert.strictEqual(ec.electronCacheRoot('win32', {}, 'C:\\Users\\r'), 'C:\\Users\\r\\AppData\\Local\\electron\\Cache');
  assert.strictEqual(ec.electronCacheRoot('linux', {}, '/home/runner'), '/home/runner/.cache/electron');
  assert.strictEqual(ec.electronCacheRoot('linux', { XDG_CACHE_HOME: '/x' }, '/home/runner'), '/x/electron');

  // 3. plan writes what the composite action and the warmer read
  const p = ec.plan({ RUNNER_OS: 'Windows', RUNNER_ARCH: 'X64', RUNNER_TEMP: tmp, LOCALAPPDATA: 'C:\\L' }, 'C:\\H', 'win32', lock);
  assert.deepStrictEqual([p.key, p.electronDir, p.builderDir], [`electron-Windows-X64-${v.electron}-builder-${v.builder}`, 'C:\\L\\electron\\Cache', path.join(tmp, 'electron-downloads', 'builder')]);
  assert.throws(() => ec.plan({ RUNNER_OS: 'Linux', RUNNER_ARCH: 'X64' }, '/h', 'linux', lock), /RUNNER_TEMP/);

  // 4. targets: every runner OS the workflows use, macOS both architectures (release.yml packs arm64 and x64 on one macOS runner)
  assert.deepStrictEqual(ec.warmTargets('Linux'), [{ platform: 'linux', arch: 'x64' }]);
  assert.deepStrictEqual(ec.warmTargets('Windows'), [{ platform: 'win32', arch: 'x64' }]);
  assert.deepStrictEqual(ec.warmTargets('macOS'), [{ platform: 'darwin', arch: 'arm64' }, { platform: 'darwin', arch: 'x64' }]);
  assert.throws(() => ec.warmTargets('FreeBSD'), /no Electron targets/);
  const sums = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'electron', 'checksums.json'), 'utf8')) as Record<string, string>;
  for (const o of ['Linux', 'Windows', 'macOS']) for (const t of ec.warmTargets(o)) assert.ok(/^[0-9a-f]{64}$/.test(sums[`electron-v${v.electron}-${t.platform}-${t.arch}.zip`] || ''), `electron's checksums.json has ${t.platform}-${t.arch}`);

  // 5. the seed is read by electron-builder itself: its checksum check then needs no SHASUMS256.txt from github.com
  const seedDir = path.join(tmp, 'seed');
  const seeded = ec.seed(seedDir, v.electron, sums);
  assert.strictEqual(path.basename(seeded), `SHASUMS256.txt-${v.electron}`);
  for (const t of [...ec.warmTargets('Linux'), ...ec.warmTargets('Windows'), ...ec.warmTargets('macOS')]) {
    const f = `electron-v${v.electron}-${t.platform}-${t.arch}.zip`;
    const got = await builderGet.resolveSeededChecksums(seedDir, v.electron, f);
    assert.ok(got && got[f] === sums[f], `electron-builder reads the seeded checksum of ${f}`);
  }
  assert.throws(() => ec.shasumsText({ 'a.zip': 'not-a-hash' }), /no sha256/);
  assert.strictEqual(ec.shasumsText({ 'b.zip': 'b'.repeat(64), 'bad name.zip': 'c'.repeat(64) }), `${'b'.repeat(64)} *b.zip\n`, 'only well-formed lines');

  // 6. integrity of a restored cache (FR-195 (d)): both @electron/get copies (npm's electron/install.js and electron-builder's)
  // re-check a cache hit against the checksums and download again when it does not match; a bad download is never accepted
  const file = `electron-v${v.electron}-linux-x64.zip`;
  const good = Buffer.from('good zip'); const bad = Buffer.from('tampered zip');
  const checksums = { [file]: crypto.createHash('sha256').update(good).digest('hex') };
  for (const [name, mod] of [['@electron/get (npm install)', 'electron'], ['@electron/get (electron-builder)', 'app-builder-lib']]) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const get = require(require.resolve('@electron/get', { paths: [path.join(root, 'node_modules', mod)] })) as { downloadArtifact: (o: Record<string, unknown>) => Promise<string> };
    const cacheRoot = fs.mkdtempSync(path.join(tmp, 'c-'));
    let downloads = 0; let serve = good;
    const downloader = { download: async (_url: string, to: string) => { downloads++; fs.writeFileSync(to, serve); } };
    const opts = { version: v.electron, artifactName: 'electron', platform: 'linux', arch: 'x64', cacheRoot, checksums, downloader };
    const cached = await get.downloadArtifact(opts);
    assert.strictEqual(downloads, 1, `${name}: first call downloads`);
    assert.ok(fs.readFileSync(cached).equals(good));
    await get.downloadArtifact(opts);
    assert.strictEqual(downloads, 1, `${name}: a good cache hit is used without the network`);
    fs.writeFileSync(cached, bad);
    const again = await get.downloadArtifact(opts);
    assert.strictEqual(downloads, 2, `${name}: a cache hit that fails the checksum is downloaded again`);
    assert.ok(fs.readFileSync(again).equals(good));
    fs.writeFileSync(again, bad); serve = bad;
    await assert.rejects(get.downloadArtifact(opts), /checksum|match/i, `${name}: a download that fails the checksum is refused`);
  }

  // 7. retries: 4 tries, 30 s, 120 s and 300 s apart (about 8 minutes), and the last error names the Electron host
  assert.deepStrictEqual(ec.RETRY_WAITS, [30, 120, 300]);
  const slept: number[] = []; let calls = 0;
  const ok = await ec.withRetries('x', async () => { if (++calls < 3) throw new Error('504'); return 'done'; }, ec.RETRY_WAITS, async (s) => { slept.push(s); }, () => undefined);
  assert.deepStrictEqual([ok, calls, slept], ['done', 3, [30, 120]]);
  slept.length = 0; calls = 0;
  await assert.rejects(ec.withRetries('x', async () => { calls++; throw new Error('504'); }, ec.RETRY_WAITS, async (s) => { slept.push(s); }, () => undefined), /failed 4 times; the Electron download host \(github\.com\/electron\/electron\/releases\)/);
  assert.deepStrictEqual([calls, slept], [4, [30, 120, 300]]);

  // 8. the composite action: shared plan, same waits, fallback prefix, seed after install, no secrets
  const action = fs.readFileSync(path.join(root, '.github', 'actions', 'npm-ci', 'action.yml'), 'utf8');
  assert.ok(/id: plan\r?\n\s+shell: bash\r?\n\s+run: node scripts\/electron-cache\.js plan/.test(action), 'npm-ci computes the key with the shared script');
  assert.ok(/path: \$\{\{ steps\.plan\.outputs\.paths \}\}\r?\n\s+key: \$\{\{ steps\.plan\.outputs\.key \}\}/.test(action), 'npm-ci caches the planned paths under the planned key');
  assert.ok(/restore-keys: \$\{\{ steps\.plan\.outputs\.restore-prefix \}\}/.test(action), 'a miss falls back to the same Electron version');
  assert.ok(action.includes(`waits=(${ec.RETRY_WAITS.join(' ')})`), 'npm ci waits as long as the warmer');
  assert.ok(/Electron download host/.test(action) && /exit 1/.test(action), 'the last failure names the Electron host and fails');
  assert.ok(action.indexOf('node scripts/electron-cache.js seed') > action.indexOf('npm ci $NPM_CI_ARGS'), 'the checksum file is seeded after the install');
  assert.ok(!/secrets\./.test(action) && !/github\.event|head_ref/.test(action), 'no secrets, no PR text');

  // 9. the warmer: main and schedule only (never PR code), read-only, every OS the workflows use, lookup before any download
  const wfDir = path.join(root, '.github', 'workflows');
  const text = fs.readFileSync(path.join(wfDir, 'electron-cache.yml'), 'utf8');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  let yaml: { load: (s: string) => unknown } | undefined; try { yaml = require('js-yaml'); } catch { yaml = undefined; }
  type Step = { id?: string; if?: string; uses?: string; run?: string; with?: Record<string, unknown> };
  type Wf = { on: Record<string, unknown>; permissions: Record<string, string>; jobs: Record<string, { permissions?: unknown; strategy: { matrix: { os: string[] } }; steps: Step[] }> };
  if (yaml) {
    const wf = yaml.load(text) as Wf & { true?: Record<string, unknown> };
    const on = wf.on || wf.true || {};
    assert.deepStrictEqual(Object.keys(on).sort(), ['push', 'schedule', 'workflow_dispatch'], 'warmer triggers: push to main, schedule, by hand (no pull_request, pull_request_target, merge_group or workflow_run)');
    assert.deepStrictEqual((on.push as { branches: string[] }).branches, ['main']);
    assert.deepStrictEqual(wf.permissions, { contents: 'read' }, 'warmer: contents: read only');
    const jobs = Object.values(wf.jobs);
    assert.strictEqual(jobs.length, 1);
    const job = jobs[0];
    assert.strictEqual(job.permissions, undefined, 'no job widens the permissions');
    assert.deepStrictEqual([...job.strategy.matrix.os].sort(), ['macos-latest', 'ubuntu-latest', 'windows-latest']);
    const lookup = job.steps.find((s) => s.id === 'lookup');
    const save = job.steps.find((s) => (s.uses || '').startsWith('actions/cache/save@'));
    assert.ok(lookup && lookup.with && lookup.with['lookup-only'] === true && (lookup.uses || '').startsWith('actions/cache/restore@'), 'a lookup-only restore first');
    assert.ok(save && save.with && lookup.with && save.with.key === lookup.with.key && save.with.path === lookup.with.path && save.with.key === '${{ steps.plan.outputs.key }}', 'saves exactly what it looked up');
    const later = job.steps.slice(job.steps.indexOf(lookup) + 1).filter((s) => s.run && !/^echo /.test(s.run) || s === save);
    assert.ok(later.length >= 3 && later.every((s) => s.if === "steps.lookup.outputs.cache-hit != 'true'"), 'install, warm and save run only on a miss');
    assert.ok(job.steps.some((s) => s.run === 'node scripts/electron-cache.js warm'), 'the warm step');
    assert.ok(job.steps.filter((s) => /npm ci/.test(s.run || '')).every((s) => /--ignore-scripts/.test(s.run || '')), 'the warmer installs without install scripts');
  }
  assert.ok(!/pull_request|merge_group|workflow_run/.test(text.replace(/#.*$/gm, '')), 'no pull request trigger, even outside the on: block');
  assert.ok(!/secrets\./.test(text) && !/write/.test(text.replace(/#.*$/gm, '')), 'no secrets, no write permission');
  // every OS that any npm-ci workflow runs on is warmed
  for (const f of fs.readdirSync(wfDir).filter((n) => /\.ya?ml$/.test(n))) {
    const t = fs.readFileSync(path.join(wfDir, f), 'utf8');
    if (!t.includes('./.github/actions/npm-ci')) continue;
    for (const o of t.match(/\b(?:ubuntu|windows|macos)-(?:latest|\d[\w.]*)\b/g) || []) assert.ok(text.includes(o), `${f} runs on ${o}, which the warmer does not warm`);
  }
  console.log('electron-cache: ok');
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => fs.rmSync(tmp, { recursive: true, force: true }));
