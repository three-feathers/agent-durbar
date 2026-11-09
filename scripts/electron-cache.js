#!/usr/bin/env node
/*
 * Spec 008 FR-195: the Electron download cache shared by `.github/actions/npm-ci` and the cache warmer (`electron-cache.yml`).
 * No dependencies before `npm ci` (plan reads only package-lock.json); `warm` needs node_modules (installed with --ignore-scripts).
 *
 *   node scripts/electron-cache.js plan   key, restore prefix and paths to $GITHUB_OUTPUT; the cache directories to $GITHUB_ENV
 *   node scripts/electron-cache.js seed   writes SHASUMS256.txt-<version> (from electron's own checksums.json) into the Electron cache
 *   node scripts/electron-cache.js warm   downloads this runner's Electron zips into the cache (checksum-verified), then seeds
 *
 * Why one Electron cache directory for both: `npm ci` (electron/install.js) reads `electron_config_cache`, but electron-builder
 * downloads the zip again into @electron/get's default cache directory and ignores that variable, and without a seeded
 * SHASUMS256.txt-<version> it fetches SHASUMS256.txt from github.com on every build, even on a cache hit. So the cached
 * directory IS that default directory, and the seed makes the builder's checksum check work offline.
 * Every value here comes from package-lock.json, the runner's own RUNNER_* variables and the home directory: no PR text.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** The exact Electron and electron-builder versions of the lockfile. */
function lockVersions(lock) {
  const p = (lock && lock.packages) || {};
  const e = p['node_modules/electron'] && p['node_modules/electron'].version;
  const b = p['node_modules/electron-builder'] && p['node_modules/electron-builder'].version;
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(String(e)) || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(String(b))) {
    throw new Error(`package-lock.json has no exact electron / electron-builder version (got ${e} / ${b})`);
  }
  return { electron: e, builder: b };
}

/** The cache key (unchanged since FR-188) and the restore prefix: the same Electron version with any electron-builder version. */
function cacheKey(runnerOs, runnerArch, v) {
  if (!/^[A-Za-z]+$/.test(String(runnerOs)) || !/^[A-Za-z0-9]+$/.test(String(runnerArch))) throw new Error(`bad runner ${runnerOs}/${runnerArch}`);
  const prefix = `electron-${runnerOs}-${runnerArch}-${v.electron}-builder-`;
  return { key: `${prefix}${v.builder}`, restorePrefix: prefix };
}

/** @electron/get's default cache root (env-paths('electron', { suffix: '' }).cache), which electron-builder always uses. */
function electronCacheRoot(platform, env, home) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'darwin') return p.join(home, 'Library', 'Caches', 'electron');
  if (platform === 'win32') return p.join(env.LOCALAPPDATA || p.join(home, 'AppData', 'Local'), 'electron', 'Cache');
  return p.join(env.XDG_CACHE_HOME || p.join(home, '.cache'), 'electron');
}

/** The Electron zips each runner OS needs: the host's, and on macOS both architectures (release.yml builds arm64 and x64 there). */
function warmTargets(runnerOs) {
  if (runnerOs === 'Linux') return [{ platform: 'linux', arch: 'x64' }];
  if (runnerOs === 'Windows') return [{ platform: 'win32', arch: 'x64' }];
  if (runnerOs === 'macOS') return [{ platform: 'darwin', arch: 'arm64' }, { platform: 'darwin', arch: 'x64' }];
  throw new Error(`no Electron targets for runner OS ${runnerOs}`);
}

/** SHASUMS256.txt lines (`<sha256> *<file>`) from electron's checksums.json; only well-formed entries. */
function shasumsText(checksums) {
  const lines = Object.keys(checksums || {}).sort()
    .filter((f) => /^[\w.@+-]+$/.test(f) && /^[0-9a-f]{64}$/.test(String(checksums[f])))
    .map((f) => `${checksums[f]} *${f}`);
  if (!lines.length) throw new Error('electron/checksums.json holds no sha256 entries');
  return lines.join('\n') + '\n';
}

/** The waits (seconds) before each retry of a download; the composite action's npm ci uses the same list (FR-195). */
const RETRY_WAITS = [30, 120, 300];

async function withRetries(what, fn, waits = RETRY_WAITS, sleep = (s) => new Promise((r) => setTimeout(r, s * 1000)), log = console.log) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= waits.length) throw new Error(`${what} failed ${waits.length + 1} times; the Electron download host (github.com/electron/electron/releases) is probably down: ${e && e.message}`);
      log(`::warning::${what} failed (try ${i + 1} of ${waits.length + 1}), retrying in ${waits[i]}s: ${e && e.message}`);
      await sleep(waits[i]);
    }
  }
}

function plan(env = process.env, home = os.homedir(), platform = process.platform, lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'))) {
  const v = lockVersions(lock);
  const { key, restorePrefix } = cacheKey(env.RUNNER_OS, env.RUNNER_ARCH, v);
  if (!env.RUNNER_TEMP) throw new Error('RUNNER_TEMP is not set');
  const electronDir = electronCacheRoot(platform, env, home);
  const builderDir = path.join(env.RUNNER_TEMP, 'electron-downloads', 'builder');
  return { ...v, key, restorePrefix, electronDir, builderDir };
}

function seed(electronRoot, version, checksums) {
  fs.mkdirSync(electronRoot, { recursive: true });
  const f = path.join(electronRoot, `SHASUMS256.txt-${version}`);
  fs.writeFileSync(f, shasumsText(checksums));
  return f;
}

const electronChecksums = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'electron', 'checksums.json'), 'utf8'));

async function main(cmd) {
  const p = plan();
  if (cmd === 'plan') {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, [`key=${p.key}`, `restore-prefix=${p.restorePrefix}`, 'paths<<EOF_PATHS', p.electronDir, p.builderDir, 'EOF_PATHS', ''].join('\n'));
    fs.appendFileSync(process.env.GITHUB_ENV, [`ELECTRON_CACHE=${p.electronDir}`, `electron_config_cache=${p.electronDir}`, `ELECTRON_BUILDER_CACHE=${p.builderDir}`, ''].join('\n'));
    console.log(`Electron cache key ${p.key} (${p.electronDir}, ${p.builderDir})`);
  } else if (cmd === 'seed') {
    console.log(`seeded ${seed(p.electronDir, p.electron, electronChecksums())}`);
  } else if (cmd === 'warm') {
    const sums = electronChecksums();
    const { downloadArtifact } = require(require.resolve('@electron/get', { paths: [path.join(ROOT, 'node_modules', 'electron')] })); // the copy electron/install.js uses
    fs.mkdirSync(p.builderDir, { recursive: true }); // actions/cache/save wants every listed path to exist
    for (const t of warmTargets(process.env.RUNNER_OS)) {
      // checksums from the npm package (integrity-checked by the lockfile): a corrupt or tampered zip is refused, never cached
      const zip = await withRetries(`Electron ${p.electron} ${t.platform}-${t.arch} download`, () => downloadArtifact({ version: p.electron, artifactName: 'electron', platform: t.platform, arch: t.arch, cacheRoot: p.electronDir, checksums: sums }));
      console.log(`cached ${zip}`);
    }
    console.log(`seeded ${seed(p.electronDir, p.electron, sums)}`);
  } else {
    throw new Error('usage: node scripts/electron-cache.js plan|seed|warm');
  }
}

module.exports = { lockVersions, cacheKey, electronCacheRoot, warmTargets, shasumsText, withRetries, plan, seed, RETRY_WAITS };

if (require.main === module) main(process.argv[2]).catch((e) => { console.error(`::error::${e.message}`); process.exit(1); });
