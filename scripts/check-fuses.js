// Spec 008 FR-037/FR-039: fail unless the packed Electron binary has the expected fuses.
// Reads the fuse wire of the binary (not package.json), so it also catches a config that never reached the build.
// Usage: node scripts/check-fuses.js [path-to-packed-binary]
// Without an argument it checks every packed binary of this platform under release/:
//   linux  release/linux-unpacked/<package name>
//   win32  release/win-unpacked/<productName>.exe
//   darwin release/mac*/<productName>.app/Contents/MacOS/<productName>   (mac, mac-arm64, mac-universal, ...)
const fs = require('fs');
const path = require('path');
const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');

// Byte values in the fuse wire (@electron/fuses FuseState).
const FuseState = { 48: 'DISABLE', 49: 'ENABLE', 114: 'REMOVED', 144: 'INHERIT', DISABLE: 48, ENABLE: 49 };

const EXPECTED = {
  RunAsNode: false,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  OnlyLoadAppFromAsar: true,
  EnableEmbeddedAsarIntegrityValidation: true,
};

/** Packed binaries of `platform` under `releaseDir` (those that exist). `names` = { productName, exeName } from package.json. */
function findPackedBinaries(platform, releaseDir, names) {
  const { productName, exeName } = names;
  const dirs = (re) => (fs.existsSync(releaseDir) ? fs.readdirSync(releaseDir).filter((d) => re.test(d)).sort() : []);
  let candidates = [];
  if (platform === 'linux') candidates = [path.join(releaseDir, 'linux-unpacked', exeName)];
  else if (platform === 'win32') candidates = [path.join(releaseDir, 'win-unpacked', `${productName}.exe`)];
  else if (platform === 'darwin') candidates = dirs(/^mac/).map((d) => path.join(releaseDir, d, `${productName}.app`, 'Contents', 'MacOS', productName));
  return candidates.filter((f) => fs.existsSync(f));
}

function packageNames() {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  return { productName: (pkg.build && pkg.build.productName) || pkg.name, exeName: pkg.name };
}

async function checkOne(bin) {
  const wire = await getCurrentFuseWire(bin);
  let bad = 0;
  for (const [name, want] of Object.entries(EXPECTED)) {
    const got = wire[FuseV1Options[name]];
    const ok = got === (want ? FuseState.ENABLE : FuseState.DISABLE);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}: ${FuseState[got] ?? got} (expected ${want ? 'ENABLE' : 'DISABLE'})`);
    if (!ok) bad++;
  }
  if (bad) {
    console.error(`check-fuses: ${bad} fuse(s) differ from spec 008 FR-037 in ${bin}`);
    return false;
  }
  console.log(`check-fuses: all ${Object.keys(EXPECTED).length} fuses as expected (${path.relative(process.cwd(), bin)})`);
  return true;
}

module.exports = { findPackedBinaries };

if (require.main === module) {
  (async () => {
    let bins;
    if (process.argv[2]) {
      bins = [path.resolve(process.argv[2])];
      if (!fs.existsSync(bins[0])) {
        console.error(`check-fuses: packed binary not found: ${bins[0]}`);
        process.exit(1);
      }
    } else {
      bins = findPackedBinaries(process.platform, path.resolve('release'), packageNames());
      if (!bins.length) {
        console.error(`check-fuses: no packed ${process.platform} binary found under release/\nRun "npm run pack:dir" first.`);
        process.exit(1);
      }
    }
    let allOk = true;
    for (const bin of bins) if (!(await checkOne(bin))) allOk = false;
    if (!allOk) process.exit(1);
  })().catch((e) => {
    console.error('check-fuses:', e.message);
    process.exit(1);
  });
}
