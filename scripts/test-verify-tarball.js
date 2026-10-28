// `npm run test:verifytarball` (spec 008 FR-133): the runtime tarball check accepts the right file and refuses the rest.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { verifyTarball, fetchVerified } = require('./verify-tarball');

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
writeLock({ [`node_modules/${NAME}`]: { version: '1.0.22', integrity: integ(good) } });
r = verifyTarball(path.join(dir, 'none.tgz'), lock, NAME, '1.0.22');
assert.ok(!r.ok && /cannot read the downloaded tarball/.test(r.reason), 'missing tarball refused (valid lock)');

// (3) near misses: real sha1, last char flipped, truncated, and a prefix of the right value
const sri = integ(good);
const flip = sri.slice(0, -3) + (sri.slice(-3, -2) === 'A' ? 'B' : 'A') + sri.slice(-2);
for (const [label, value] of [
  ['sha1', 'sha1-' + crypto.createHash('sha1').update(good).digest('base64')],
  ['flipped sha512', flip],
  ['truncated sha512', sri.slice(0, 40)],
  ['sha512 with trailing text', sri + 'AA'],
]) {
  writeLock({ [`node_modules/${NAME}`]: { version: '1.0.22', integrity: value } });
  assert.ok(!verifyTarball(tgz, lock, NAME, '1.0.22').ok, `${label} refused`);
}
writeLock({ [`node_modules/${NAME}`]: { version: '1.0.22', integrity: sri } });

// (1) (4) fetchVerified: order, honouring a refusal, cleanup on every path
const root = fs.mkdtempSync(path.join(dir, 'tmproot-'));
const run = (verify, tgzBytes = good) => {
  const calls = [];
  let packed;
  const res = fetchVerified({
    tmpRoot: root, lockPath: lock, packageName: NAME, version: '1.0.22', verify,
    pack: (tmp) => { packed = path.join(tmp, 'p.tgz'); fs.writeFileSync(packed, tgzBytes); calls.push('pack'); return packed; },
    extract: () => { calls.push('extract'); },
  });
  return { res, calls, packed };
};
let o = run(verifyTarball);
assert.deepStrictEqual(o.calls, ['pack', 'extract']); assert.ok(o.res.ok);
o = run(() => ({ ok: false, reason: 'no' }));
assert.deepStrictEqual(o.calls, ['pack'], 'a refusal means nothing is extracted'); assert.ok(!o.res.ok);
o = run(verifyTarball, Buffer.from('tampered'));
assert.deepStrictEqual(o.calls, ['pack'], 'a tampered tarball is not extracted'); assert.ok(!o.res.ok);
o = run(() => undefined);
assert.ok(!o.res.ok && !o.calls.includes('extract'), 'a verifier that returns nothing is a refusal');
assert.deepStrictEqual(fs.readdirSync(root), [], 'no temp folder or tarball is left after ok, refusal or tamper');
assert.throws(() => fetchVerified({ tmpRoot: root, lockPath: lock, packageName: NAME, version: '1', verify: () => ({ ok: true }), pack: (t) => path.join(t, 'x'), extract: () => { throw new Error('boom'); } }), /boom/);
assert.deepStrictEqual(fs.readdirSync(root), [], 'cleanup also when extract throws');

// prepare-runtime really goes through fetchVerified and does not unpack or exit inside the try by itself
const prep = fs.readFileSync(path.join(__dirname, 'prepare-runtime.js'), 'utf8');
assert.match(prep, /fetchVerified\(\{/, 'prepare-runtime uses fetchVerified');
assert.match(prep, /if \(!res\.ok\) \{[\s\S]{0,200}process\.exit\(1\)/, 'prepare-runtime exits non-zero on a refusal');
assert.ok(!/execFileSync\('tar'/.test(prep.replace(/extract: \(tgz\) => \{[\s\S]*?\n    \},/, '')), 'tar runs only inside the extract callback');
assert.ok(!/\bverify\s*[:,(]|verifyTarball/.test(prep.replace(/\/\/.*$/gm, '')), 'prepare-runtime passes no verify function: only the real verifier inside fetchVerified is used');
assert.ok(!/try \{[\s\S]*process\.exit/.test(prep), 'no process.exit inside a try (it would skip cleanup)');

// the real lockfile records sha512 for every runtime package prepare-runtime can fetch
const real = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8'));
for (const t of ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64']) {
  const e = real.packages[`node_modules/@github/copilot-sdk-${t}`];
  assert.ok(e && /^sha512-/.test(e.integrity), `package-lock.json has a sha512 for copilot-sdk-${t}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log('verify-tarball: all checks passed');
