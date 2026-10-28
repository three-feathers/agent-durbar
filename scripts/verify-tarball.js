// Spec 008 FR-133: check a downloaded runtime tarball against the integrity (sha512) that package-lock.json records for that
// exact package and version, so a tampered or swapped download is refused instead of unpacked and bundled.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Returns { ok: true } or { ok: false, reason }. Never throws for a bad input; the caller prints the reason and exits non-zero.
function verifyTarball(tgzPath, lockPath, packageName, version) {
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (e) {
    return { ok: false, reason: `cannot read ${lockPath}` };
  }
  const entry = lock && lock.packages && lock.packages[`node_modules/${packageName}`];
  if (!entry || typeof entry.integrity !== 'string') return { ok: false, reason: `no integrity recorded in package-lock.json for ${packageName}` };
  if (entry.version !== version) return { ok: false, reason: `package-lock.json records ${packageName}@${entry.version}, not ${version}` };
  const m = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(entry.integrity);
  if (!m) return { ok: false, reason: `package-lock.json integrity for ${packageName} is not sha512` };
  let data;
  try {
    data = fs.readFileSync(tgzPath);
  } catch (e) {
    return { ok: false, reason: `cannot read the downloaded tarball` };
  }
  const actual = crypto.createHash('sha512').update(data).digest('base64');
  if (actual !== m[1]) return { ok: false, reason: `the downloaded ${packageName}@${version} does not match the integrity in package-lock.json` };
  return { ok: true };
}

// Download, verify, then unpack, in that order; the temp folder (with the tarball) is removed on every path, refusals included.
// pack(tmp) returns the tarball path; extract(tgz) unpacks it. Both are injected so a test can use fakes. Returns { ok, reason }.
function fetchVerified({ tmpRoot, pack, extract, lockPath, packageName, version, verify = verifyTarball }) {
  const tmp = fs.mkdtempSync(path.join(tmpRoot, 'durbar-rt-'));
  try {
    const tgz = pack(tmp);
    const check = verify(tgz, lockPath, packageName, version);
    if (!check || check.ok !== true) return { ok: false, reason: (check && check.reason) || 'verification failed' };
    extract(tgz);
    return { ok: true };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { verifyTarball, fetchVerified };
