// Spec 058 FR-160 (issue #623): the packed mac app must keep GitHub's own code signature on the bundled Copilot runtime.
//
// The macOS keychain trusts a program by its code signature. GitHub signs the runtime in @github/copilot-sdk-darwin-* with its
// Developer ID (team VEKTX9H2N7, identifier `copilot`, the same designated requirement as the `copilot` CLI). electron-builder's
// ad-hoc signing (`identity: "-"`) re-signs every Mach-O in the app unless `mac.signIgnore` skips it; a re-signed runtime is a new,
// unsigned program to the keychain on every build, and its Copilot and MCP sign-in items ask again. This check reads the signature
// from the files themselves (no `codesign`, so it also runs and is tested on Linux and Windows).
//
// Usage: node scripts/check-runtime-signature.js [file ...]
// Without an argument on macOS it checks every runtime file of every packed mac*/<productName>.app under release/; on other
// platforms it has nothing to check and says so.
const fs = require('fs');
const path = require('path');

const GITHUB_TEAM_ID = 'VEKTX9H2N7';
const RUNTIME_IDENTIFIER = 'copilot';

const MH_MAGIC_64 = 0xfeedfacf; // little-endian thin 64-bit Mach-O as read with readUInt32LE
const FAT_MAGIC = 0xcafebabe; // big-endian
const FAT_MAGIC_64 = 0xcafebabf;
const LC_CODE_SIGNATURE = 0x1d;
const CSMAGIC_EMBEDDED_SIGNATURE = 0xfade0cc0;
const CSMAGIC_CODEDIRECTORY = 0xfade0c02;
const CSSLOT_CODEDIRECTORY = 0;
const CSSLOT_ALTERNATE_CODEDIRECTORIES = 0x1000;
const CS_ADHOC = 0x2;
const CS_LINKER_SIGNED = 0x20000;

function cString(buf, at) {
  if (at <= 0 || at >= buf.length) return '';
  const end = buf.indexOf(0, at);
  return buf.toString('utf8', at, end < 0 ? buf.length : end);
}

/** One thin 64-bit Mach-O slice -> its signature, or { signed: false } / { error }. */
function parseThin(buf) {
  if (buf.length < 32 || buf.readUInt32LE(0) !== MH_MAGIC_64) return { error: 'not a 64-bit Mach-O' };
  const ncmds = buf.readUInt32LE(16);
  let off = 32;
  let sig;
  for (let i = 0; i < ncmds; i++) {
    if (off + 8 > buf.length) return { error: 'truncated load commands' };
    const cmd = buf.readUInt32LE(off);
    const size = buf.readUInt32LE(off + 4);
    if (size < 8) return { error: 'bad load command size' };
    if (cmd === LC_CODE_SIGNATURE) sig = { at: buf.readUInt32LE(off + 8), size: buf.readUInt32LE(off + 12) };
    off += size;
  }
  if (!sig) return { signed: false };
  if (sig.at + sig.size > buf.length || sig.size < 12) return { error: 'signature outside the file' };
  const sb = buf.subarray(sig.at, sig.at + sig.size);
  if (sb.readUInt32BE(0) !== CSMAGIC_EMBEDDED_SIGNATURE) return { error: 'no embedded signature blob' };
  const count = sb.readUInt32BE(8);
  const dirs = [];
  for (let i = 0; i < count; i++) {
    const e = 12 + 8 * i;
    if (e + 8 > sb.length) return { error: 'truncated signature index' };
    const type = sb.readUInt32BE(e);
    const blob = sb.readUInt32BE(e + 4);
    if (type !== CSSLOT_CODEDIRECTORY && (type < CSSLOT_ALTERNATE_CODEDIRECTORIES || type >= CSSLOT_ALTERNATE_CODEDIRECTORIES + 5)) continue;
    if (blob + 52 > sb.length || sb.readUInt32BE(blob) !== CSMAGIC_CODEDIRECTORY) return { error: 'bad code directory' };
    const len = sb.readUInt32BE(blob + 4);
    const cd = sb.subarray(blob, Math.min(sb.length, blob + len));
    const version = cd.readUInt32BE(8);
    const flags = cd.readUInt32BE(12);
    const identifier = cString(cd, cd.readUInt32BE(20));
    const teamId = version >= 0x20200 && cd.length >= 52 ? cString(cd, cd.readUInt32BE(48)) : '';
    dirs.push({ flags, identifier, teamId });
  }
  if (!dirs.length) return { error: 'no code directory' };
  const d = dirs[0];
  return { signed: true, adhoc: dirs.some((x) => (x.flags & (CS_ADHOC | CS_LINKER_SIGNED)) !== 0), identifier: d.identifier, teamId: d.teamId };
}

/** A Mach-O file (thin or universal) -> one result per slice. */
function parseSignatures(buf) {
  if (buf.length >= 8 && (buf.readUInt32BE(0) === FAT_MAGIC || buf.readUInt32BE(0) === FAT_MAGIC_64)) {
    const wide = buf.readUInt32BE(0) === FAT_MAGIC_64;
    const n = buf.readUInt32BE(4);
    const out = [];
    for (let i = 0; i < n; i++) {
      const e = 8 + i * (wide ? 32 : 20);
      if (e + (wide ? 32 : 20) > buf.length) return [{ error: 'truncated universal header' }];
      const at = wide ? Number(buf.readBigUInt64BE(e + 8)) : buf.readUInt32BE(e + 8);
      const size = wide ? Number(buf.readBigUInt64BE(e + 16)) : buf.readUInt32BE(e + 12);
      if (at + size > buf.length) return [{ error: 'slice outside the file' }];
      out.push(parseThin(buf.subarray(at, at + size)));
    }
    return out.length ? out : [{ error: 'empty universal file' }];
  }
  return [parseThin(buf)];
}

/** Is `buf` a Mach-O file at all (thin 64-bit or universal)? */
function isMachO(buf) {
  if (buf.length < 4) return false;
  const be = buf.readUInt32BE(0);
  return buf.readUInt32LE(0) === MH_MAGIC_64 || be === FAT_MAGIC || be === FAT_MAGIC_64;
}

/** A problem with one file's signature, or undefined when it is GitHub's own (team VEKTX9H2N7, not ad-hoc). */
function problemOf(file, buf) {
  const name = path.basename(file);
  const slices = parseSignatures(buf);
  for (const s of slices) {
    if (s.error) return `${name}: ${s.error}`;
    if (!s.signed) return `${name}: not signed (GitHub's signature was removed)`;
    if (s.adhoc) return `${name}: ad-hoc signed (electron-builder re-signed it; check mac.signIgnore)`;
    if (s.teamId !== GITHUB_TEAM_ID) return `${name}: signed by team "${s.teamId || 'none'}", expected GitHub (${GITHUB_TEAM_ID})`;
    if (/^copilot-runtime$/.test(name) && s.identifier !== RUNTIME_IDENTIFIER) return `${name}: identifier "${s.identifier}", expected "${RUNTIME_IDENTIFIER}"`;
  }
  return undefined;
}

/** electron-builder's output folder for an arch (`mac` = x64, `mac-arm64`, `mac-universal`). */
function macFolderOf(arch) {
  return arch === 'x64' ? 'mac' : `mac-${arch}`;
}

/**
 * Every packed `<productName>.app` under `releaseDir` (only the folder of `arch` when given), each with its own runtime files:
 * `[{ app, files }]`. An app without the runtime package still appears, with no files, so the check fails for that app (review on #625).
 */
function findRuntimeApps(releaseDir, productName, arch) {
  if (!fs.existsSync(releaseDir)) return [];
  const folders = fs.readdirSync(releaseDir).filter((n) => (arch ? n === macFolderOf(arch) : /^mac/.test(n))).sort();
  const out = [];
  for (const d of folders) {
    const app = path.join(releaseDir, d, `${productName}.app`);
    if (!fs.existsSync(app)) continue;
    const files = [];
    const gh = path.join(app, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', '@github');
    const pkgs = fs.existsSync(gh) ? fs.readdirSync(gh).filter((n) => /^copilot-sdk-darwin-/.test(n)).sort() : [];
    for (const pkg of pkgs) {
      const pre = path.join(gh, pkg, 'prebuilds');
      if (!fs.existsSync(pre)) continue;
      for (const plat of fs.readdirSync(pre).sort()) {
        const dir = path.join(pre, plat);
        if (!fs.statSync(dir).isDirectory()) continue;
        for (const f of fs.readdirSync(dir).sort()) {
          const p = path.join(dir, f);
          if (fs.statSync(p).isFile()) files.push(p);
        }
      }
    }
    out.push({ app, files });
  }
  return out;
}

/** The runtime files of every packed app, flattened (kept for callers that only need the list). */
function findRuntimeFiles(releaseDir, productName, arch) {
  return findRuntimeApps(releaseDir, productName, arch).flatMap((a) => a.files);
}

/** Check files of ONE app; returns the problems (empty = all GitHub-signed). Non-Mach-O files are skipped; the runtime is required. */
function checkFiles(files) {
  const problems = [];
  let checked = 0;
  let sawRuntime = false;
  for (const f of files) {
    const buf = fs.readFileSync(f);
    if (!isMachO(buf)) continue;
    checked++;
    if (path.basename(f) === 'copilot-runtime') sawRuntime = true;
    const p = problemOf(f, buf);
    if (p) problems.push(p);
  }
  if (!checked) problems.push('no Mach-O runtime file found');
  else if (!sawRuntime) problems.push('copilot-runtime not found among the checked files');
  return problems;
}

/** Check each app on its own (the runtime must be in every app); each problem names its app. No app at all is a problem too. */
function checkApps(apps, releaseDir) {
  if (!apps.length) return ['no packed mac app found'];
  const problems = [];
  for (const a of apps) for (const p of checkFiles(a.files)) problems.push(`${path.relative(releaseDir, a.app)}: ${p}`);
  return problems;
}

module.exports = { GITHUB_TEAM_ID, parseSignatures, isMachO, problemOf, macFolderOf, findRuntimeApps, findRuntimeFiles, checkFiles, checkApps };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const ai = argv.indexOf('--arch');
  const arch = ai >= 0 ? argv[ai + 1] : undefined;
  if (ai >= 0 && !['arm64', 'x64', 'universal'].includes(arch)) {
    console.error('check-runtime-signature: --arch must be arm64, x64 or universal');
    process.exit(1);
  }
  const files = argv.filter((_, i) => ai < 0 || (i !== ai && i !== ai + 1)).map((f) => path.resolve(f));
  let problems;
  let what;
  if (files.length) {
    problems = checkFiles(files);
    what = `${files.length} file(s)`;
  } else {
    if (process.platform !== 'darwin') {
      console.log('check-runtime-signature: no mac package on this platform, nothing to check');
      process.exit(0);
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const releaseDir = path.resolve('release');
    const apps = findRuntimeApps(releaseDir, (pkg.build && pkg.build.productName) || pkg.name, arch);
    problems = checkApps(apps, releaseDir);
    what = apps.map((a) => `${path.relative(releaseDir, a.app)} (${a.files.length} file(s))`).join(', ');
  }
  if (problems.length) {
    for (const p of problems) console.error(`check-runtime-signature: ${p}`);
    process.exit(1);
  }
  console.log(`check-runtime-signature: the Copilot runtime keeps GitHub's signature (team ${GITHUB_TEAM_ID}), ${what}`);
}
