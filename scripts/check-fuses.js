// Spec 008 FR-037/FR-039: fail unless the packed Electron binary has the expected fuses.
// Reads the fuse wire of the binary (not package.json), so it also catches a config that never reached the build.
// Usage: node scripts/check-fuses.js [path-to-packed-binary]   (default: release/linux-unpacked/agent-durbar)
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

(async () => {
  const bin = path.resolve(process.argv[2] || path.join('release', 'linux-unpacked', 'agent-durbar'));
  if (!fs.existsSync(bin)) {
    console.error(`check-fuses: packed binary not found: ${bin}\nRun "npm run pack:dir" first.`);
    process.exit(1);
  }
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
    process.exit(1);
  }
  console.log(`check-fuses: all ${Object.keys(EXPECTED).length} fuses as expected (${path.relative(process.cwd(), bin)})`);
})().catch((e) => {
  console.error('check-fuses:', e.message);
  process.exit(1);
});
