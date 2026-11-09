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
  checksumsPath: () => string;
  electronChecksums: () => Record<string, string>;
  warmOptions: (version: string, t: { platform: string; arch: string }, cacheRoot: string, c: Record<string, string>) => Record<string, unknown>;
  warm: (p: Plan, runnerOs: string, deps?: Record<string, unknown>) => Promise<{ zips: string[]; seeded: string }>;
  RETRY_WAITS: number[];
};
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
// the @electron/get switch that turns its checksum check off, spelled in pieces so the source scan below can include this file
const SWITCH = ['unsafely', 'DisableChecksums'].join('');
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
    buildElectronArtifactConfig: (o: Record<string, unknown>) => Promise<Record<string, unknown>>;
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

  // 6b. warm() itself (review of #1363): the checksums it passes come from Electron's npm package, nothing turns the check off,
  // a zip that fails the check is refused (after its retries), a good one is cached and the seed is written
  assert.strictEqual(ec.checksumsPath(), require.resolve('electron/checksums.json', { paths: [root] }), 'the checksums come from node_modules/electron (the lockfile-pinned package)');
  assert.strictEqual(path.relative(root, ec.checksumsPath()).split(path.sep).join('/'), 'node_modules/electron/checksums.json');
  const realSums = ec.electronChecksums();
  assert.deepStrictEqual(realSums, sums);
  const wo = ec.warmOptions(v.electron, { platform: 'darwin', arch: 'x64' }, '/c', realSums);
  assert.deepStrictEqual(wo, { version: v.electron, artifactName: 'electron', platform: 'darwin', arch: 'x64', cacheRoot: '/c', checksums: realSums }, 'exactly these options: the checksums, and no switch that turns the check off');
  assert.throws(() => ec.warmOptions(v.electron, { platform: 'linux', arch: 'x64' }, '/c', {}), /checksums/);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const installGet = require(require.resolve('@electron/get', { paths: [path.join(root, 'node_modules', 'electron')] })) as { downloadArtifact: (o: Record<string, unknown>) => Promise<string> };
  const wp: Plan = { ...v, key: '', restorePrefix: '', electronDir: path.join(tmp, 'warm', 'electron'), builderDir: path.join(tmp, 'warm', 'builder') };
  const seen: Record<string, unknown>[] = []; let serveWarm = bad; let warmDownloads = 0; const warmSlept: number[] = [];
  const warmDeps = (c: Record<string, string> | undefined) => ({
    checksums: c, log: () => undefined, sleep: async (sec: number) => { warmSlept.push(sec); },
    // the real @electron/get, with a fake network: warm()'s own options decide what is checked
    downloadArtifact: (o: Record<string, unknown>) => { seen.push(o); return installGet.downloadArtifact({ ...o, downloader: { download: async (_u: string, to: string) => { warmDownloads++; fs.writeFileSync(to, serveWarm); } } }); },
  });
  await assert.rejects(ec.warm(wp, 'Linux', warmDeps(checksums)), /failed 4 times/, 'warm() refuses a zip with a wrong checksum');
  assert.deepStrictEqual([warmDownloads, warmSlept], [4, ec.RETRY_WAITS], 'every try downloaded and was refused');
  assert.ok(!fs.existsSync(path.join(wp.electronDir, `SHASUMS256.txt-${v.electron}`)), 'no seed after a refused zip');
  serveWarm = good; seen.length = 0;
  const warmed = await ec.warm(wp, 'Linux', warmDeps(checksums));
  assert.ok(warmed.zips.length === 1 && fs.readFileSync(warmed.zips[0]).equals(good) && warmed.zips[0].startsWith(wp.electronDir), 'warm() caches the good zip in the Electron cache directory');
  assert.ok(seen.every((o) => o.checksums === checksums && !(SWITCH in o) && o.cacheRoot === wp.electronDir), 'warm() passes its checksums and never disables the check');
  assert.ok(warmed.seeded === path.join(wp.electronDir, `SHASUMS256.txt-${v.electron}`) && fs.existsSync(warmed.seeded), 'warm() writes the seed');
  assert.strictEqual(fs.readFileSync(warmed.seeded, 'utf8'), ec.shasumsText(checksums));
  // without injected checksums warm() uses Electron's own (seen through the options it passes)
  seen.length = 0;
  await assert.rejects(ec.warm({ ...wp, electronDir: path.join(tmp, 'warm2') }, 'Linux', { ...warmDeps(undefined), checksums: undefined, waits: [] }));
  assert.ok(seen.length === 1 && seen[0].checksums && JSON.stringify(seen[0].checksums) === JSON.stringify(sums), 'by default warm() checks against node_modules/electron/checksums.json');

  // 6c. the seed is the exact file electron-builder reads: its own config builder turns it into the checksums it checks a cached
  // zip against, and that zip then needs no SHASUMS256.txt from the network (a fake network that fails proves it)
  const bRoot = path.join(tmp, 'builder-seed');
  ec.seed(bRoot, v.electron, checksums);
  const cfg = await builderGet.buildElectronArtifactConfig({ arch: 'x64', version: v.electron, platformName: 'linux', artifactName: 'electron', cacheDir: bRoot });
  assert.deepStrictEqual(cfg.checksums, checksums, 'electron-builder reads the seed as its checksums');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const bGet = require(require.resolve('@electron/get', { paths: [path.join(root, 'node_modules', 'app-builder-lib')] })) as { downloadArtifact: (o: Record<string, unknown>) => Promise<string> };
  let bServe = good; let bUrls: string[] = [];
  const bDownloader = { download: async (u: string, to: string) => { bUrls.push(u); if (/SHASUMS/.test(u)) throw new Error('offline'); fs.writeFileSync(to, bServe); } };
  const bZip = await bGet.downloadArtifact({ ...cfg, downloader: bDownloader });
  assert.ok(fs.readFileSync(bZip).equals(good) && bUrls.length === 1 && !/SHASUMS/.test(bUrls[0]), 'one zip download, no SHASUMS256.txt');
  bUrls = []; await bGet.downloadArtifact({ ...cfg, downloader: bDownloader });
  assert.deepStrictEqual(bUrls, [], 'a seeded cache hit needs no network at all');
  fs.writeFileSync(bZip, bad); bServe = bad;
  await assert.rejects(bGet.downloadArtifact({ ...cfg, downloader: bDownloader }), /checksum|match/i, 'a tampered cached zip is refused against the seed');
  fs.rmSync(path.join(bRoot, `SHASUMS256.txt-${v.electron}`));
  const unseeded = await builderGet.buildElectronArtifactConfig({ arch: 'x64', version: v.electron, platformName: 'linux', artifactName: 'electron', cacheDir: bRoot });
  assert.strictEqual(unseeded.checksums, undefined, 'without the seed electron-builder has no checksums (it would fetch SHASUMS256.txt)');

  // 6d. nothing in scripts/ turns the checksum check off (a source scan; this file names the switch only to look for it)
  const scan = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (['node_modules', 'prereview'].includes(e.name) ? [] : scan(path.join(d, e.name))) : /\.(js|ts|cjs|mjs)$/.test(e.name) ? [path.join(d, e.name)] : []);
  const scanned = scan(path.join(root, 'scripts'));
  assert.ok(scanned.some((f) => f.endsWith('electron-cache.js')) && scanned.length > 50, 'the scan read scripts/');
  for (const f of scanned) assert.ok(!fs.readFileSync(f, 'utf8').includes(SWITCH), `${path.relative(root, f)} must not set ${SWITCH}`);

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
  assert.ok(action.includes(`retry-waits:`) && action.includes(`default: '${ec.RETRY_WAITS.join(' ')}'`), 'by default npm ci waits as long as the warmer');
  assert.ok(/RETRY_WAITS: \$\{\{ inputs\.retry-waits \}\}/.test(action) && /read -ra waits <<< "\$RETRY_WAITS"/.test(action) && /\r?\n\s+for w in "\$\{waits\[@\]\}"; do case "\$w" in ''\|\*\[!0-9\]\*\) echo "::error::retry-waits must be whole seconds, got: \$w"; exit 1;; esac; done\r?\n/.test(action), 'the waits pass through env: and must be whole seconds');
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
  assert.ok(yaml, 'js-yaml is missing: the warmer\'s triggers, permissions and steps cannot be checked (it is a transitive dependency; no devDependency is added for it, review of #1354). Fix the install instead of skipping.');
  {
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
  // 10. every job that uses npm-ci has room for its retries (review of #1363): typical minutes + retry budget <= timeout-minutes.
  // Typical: the longest successful run among the last 15 of each workflow (gh run list/view, 2026-11-09), across its matrix.
  // Budget: the job's waits plus one failed npm ci try before each wait (an outage fails a try in about a minute; 1.5 allowed).
  const TYPICAL_MIN: Record<string, number> = {
    'ci.yml:build-test': 9.8, 'ci.yml:office-check': 5.2, 'ci.yml:theme-shard': 3.0, 'e2e-real.yml:e2e': 2.5, 'install-check.yml:install': 4.4,
    'installed-app.yml:installed': 10.2, 'macos-pr.yml:macos-test': 8.8, 'mcp-oauth-real.yml:check': 1.1, 'packaged-check.yml:check': 1.6,
    'release.yml:build': 14.4, 'ui-platforms.yml:ui': 22.7, 'world-matrix.yml:subset': 2.1,
    'world-matrix.yml:weekly': 25, // estimate: no weekly run among the last 40 runs of the workflow
  };
  const FAILED_TRY_MIN = 1.5;
  type Job = { 'timeout-minutes'?: number; steps?: { uses?: string; with?: Record<string, string> }[] };
  const defaultWaits = ((yaml.load(action) as { inputs: Record<string, { default: string }> }).inputs['retry-waits'].default).split(/\s+/).map(Number);
  const budgets: string[] = [];
  for (const f of fs.readdirSync(wfDir).filter((n) => /\.ya?ml$/.test(n))) {
    const jobsOf = (yaml.load(fs.readFileSync(path.join(wfDir, f), 'utf8')) as { jobs?: Record<string, Job> }).jobs || {};
    for (const [id, job] of Object.entries(jobsOf)) {
      const uses = (job.steps || []).filter((st) => st.uses === './.github/actions/npm-ci');
      if (!uses.length) continue;
      const name = `${f}:${id}`;
      assert.ok(name in TYPICAL_MIN, `${name} uses npm-ci: add its typical minutes to TYPICAL_MIN (measured, or an estimate said so)`);
      for (const st of uses) {
        const raw = st.with && st.with['retry-waits'];
        const waits = raw === undefined ? defaultWaits : String(raw).split(/\s+/).map(Number);
        assert.ok(waits.length > 0 && waits.every((w) => Number.isInteger(w) && w >= 0), `${name}: retry-waits are whole seconds`);
        const budget = waits.reduce((a, b) => a + b, 0) / 60 + waits.length * FAILED_TRY_MIN;
        const limit = Number(job['timeout-minutes']);
        assert.ok(TYPICAL_MIN[name] + budget <= limit, `${name}: ${TYPICAL_MIN[name]} min of work + ${budget.toFixed(1)} min of npm ci retries is more than timeout-minutes ${limit}`);
        budgets.push(name);
      }
    }
  }
  assert.ok(budgets.length >= 13 && Object.keys(TYPICAL_MIN).every((k) => budgets.includes(k)), 'every listed job was checked, and no stale entry is listed');
  console.log('electron-cache: ok');
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => fs.rmSync(tmp, { recursive: true, force: true }));
