// `npm run test:verifytarball` (spec 008 FR-133): the runtime tarball check accepts the right file and refuses the rest.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { verifyTarball } = require('./verify-tarball');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-vt-'));
const tgz = path.join(dir, 'a.tgz');
const lock = path.join(dir, 'package-lock.json');
const good = Buffer.from('pretend tarball bytes');
const integ = (b) => 'sha512-' + crypto.createHash('sha512').update(b).digest('base64');
const writeLock = (pkgs) => fs.writeFileSync(lock, JSON.stringify({ packages: pkgs }));
const NAME = '@github/copilot-sdk-linux-x64';
fs.writeFileSync(tgz, good);

writeLock({ [`node_modules/${NAME}`]: { version: '1.0.22', integrity: integ(good) } });
assert.deepStrictEqual(verifyTarball(tgz, lock, NAME, '1.0.22'), { ok: true }, 'good tarball accepted');

fs.writeFileSync(tgz, Buffer.concat([good, Buffer.from('x')]));
let r = verifyTarball(tgz, lock, NAME, '1.0.22');
assert.ok(!r.ok && /does not match/.test(r.reason), 'tampered tarball refused');
fs.writeFileSync(tgz, good);

writeLock({});
r = verifyTarball(tgz, lock, NAME, '1.0.22');
assert.ok(!r.ok && /no integrity/.test(r.reason), 'missing lock entry refused');

writeLock({ [`node_modules/${NAME}`]: { version: '1.0.22' } });
assert.ok(!verifyTarball(tgz, lock, NAME, '1.0.22').ok, 'entry without integrity refused');

writeLock({ [`node_modules/${NAME}`]: { version: '1.0.21', integrity: integ(good) } });
r = verifyTarball(tgz, lock, NAME, '1.0.22');
assert.ok(!r.ok && /not 1\.0\.22/.test(r.reason), 'other version refused');

writeLock({ [`node_modules/${NAME}`]: { version: '1.0.22', integrity: 'sha1-AAAA' } });
assert.ok(!verifyTarball(tgz, lock, NAME, '1.0.22').ok, 'non-sha512 refused');

fs.writeFileSync(lock, '{not json');
assert.ok(!verifyTarball(tgz, lock, NAME, '1.0.22').ok, 'unreadable lock refused');
assert.ok(!verifyTarball(path.join(dir, 'none.tgz'), lock, NAME, '1.0.22').ok, 'missing tarball refused');

// the real lockfile records sha512 for every runtime package prepare-runtime can fetch
const real = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8'));
for (const t of ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64']) {
  const e = real.packages[`node_modules/@github/copilot-sdk-${t}`];
  assert.ok(e && /^sha512-/.test(e.integrity), `package-lock.json has a sha512 for copilot-sdk-${t}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log('verify-tarball: all checks passed');
