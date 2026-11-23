/**
 * Spec 118 T005 (FR-012): the install type from an injected environment, and the expected asset name checked against spec 008's
 * `artifactName` patterns in package.json (a renamed pattern fails here). `npm run test:selfupdate-installtype`. Pure.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { assetFor, expectedAssetName, installType } from '../src/shared/selfupdate';
import type { FeedRelease, InstallType } from '../src/shared/selfupdate';

const it = (platform: string, env: Record<string, string | undefined>, packaged = true): InstallType => installType({ platform, env, packaged });
assert.strictEqual(it('win32', {}), 'nsis', 'Windows packaged is NSIS');
assert.strictEqual(it('win32', { PORTABLE_EXECUTABLE_FILE: 'C:\\x\\Agent-Durbar-0.1.27-portable.exe' }), 'portable', 'portable is not NSIS');
assert.strictEqual(it('win32', { PORTABLE_EXECUTABLE_FILE: '' }), 'nsis', 'an empty portable variable is NSIS');
assert.strictEqual(it('linux', { APPIMAGE: '/home/a/Agent-Durbar.AppImage' }), 'appimage', 'Linux with APPIMAGE is an AppImage');
assert.strictEqual(it('linux', {}), 'unknown', 'an extracted AppImage (no APPIMAGE) is unknown, notes only');
assert.strictEqual(it('darwin', {}), 'dmg', 'macOS packaged is dmg');
assert.strictEqual(it('freebsd', { APPIMAGE: '/x' }), 'unknown', 'another OS is unknown');
for (const p of ['win32', 'linux', 'darwin']) assert.strictEqual(it(p, { APPIMAGE: '/x', PORTABLE_EXECUTABLE_FILE: 'x' }, false), 'unknown', 'a dev run is unknown: ' + p);

// Expected names from package.json `build` (electron-builder writes x86_64 for an x64 AppImage)
const build = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')).build;
const name = (pattern: string, arch: string, ext: string): string => pattern.replace('${version}', '0.1.29').replace('${arch}', arch).replace('${ext}', ext);
const want: [InstallType, string, string][] = [
  ['nsis', 'x64', name(build.nsis.artifactName, 'x64', 'exe')],
  ['portable', 'x64', name(build.portable.artifactName, 'x64', 'exe')],
  ['appimage', 'x64', name(build.linux.artifactName, 'x86_64', 'AppImage')],
  ['dmg', 'arm64', name(build.mac.artifactName, 'arm64', 'dmg')],
  ['dmg', 'x64', name(build.mac.artifactName, 'x64', 'dmg')],
];
for (const [type, arch, file] of want) assert.strictEqual(expectedAssetName(type, arch, '0.1.29'), file, `name for ${type} ${arch}`);
for (const [type, arch] of [['nsis', 'arm64'], ['portable', 'ia32'], ['appimage', 'arm64'], ['dmg', 'ia32'], ['unknown', 'x64']] as [InstallType, string][]) {
  assert.strictEqual(expectedAssetName(type, arch, '0.1.29'), undefined, `no build for ${type} ${arch}`);
}
for (const v of ['v0.1.29', '0.1.29/../x', '0.1', '']) assert.strictEqual(expectedAssetName('nsis', 'x64', v), undefined, 'refuses version ' + JSON.stringify(v));

const assets = ['Agent-Durbar-Setup-0.1.29.exe', 'Agent-Durbar-0.1.29-portable.exe', 'Agent-Durbar-0.1.29-x86_64.AppImage', 'Agent-Durbar-0.1.29-x64.dmg', 'Agent-Durbar-0.1.28-arm64.dmg']
  .map((n, i) => ({ name: n, size: 1 + i, url: 'u' + i }));
const rel: FeedRelease = { tag: 'v0.1.29', version: '0.1.29', publishedAt: '', htmlUrl: '', body: '', assets };
assert.strictEqual(assetFor('nsis', 'x64', rel)?.size, 1, 'NSIS gets the Setup file');
assert.strictEqual(assetFor('portable', 'x64', rel)?.size, 2, 'portable gets the portable file');
assert.strictEqual(assetFor('appimage', 'x64', rel)?.size, 3, 'AppImage gets the AppImage');
assert.strictEqual(assetFor('dmg', 'x64', rel)?.size, 4, 'an Intel Mac gets the x64 dmg');
assert.strictEqual(assetFor('dmg', 'arm64', rel), undefined, 'an Apple-silicon Mac never gets another arch or version');
assert.strictEqual(assetFor('unknown', 'x64', rel), undefined, 'unknown gets nothing');
console.log('selfupdate-installtype: ok');
