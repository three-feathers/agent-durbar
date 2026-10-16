// Make node_modules contain exactly one platform runtime for the build target.
//
// @github/copilot-sdk ships its native Copilot runtime in per-platform optional packages
// (@github/copilot-sdk-<os>-<arch>). `npm ci` only installs the one for the machine it runs on, and
// electron-builder would otherwise bundle every one that is present. This script (1) downloads the
// target's package when it is missing (e.g. an x64 mac build on an arm64 runner) and (2) removes the
// others, so each installer carries only its own runtime.
//
// Usage: node scripts/prepare-runtime.js [darwin-arm64|darwin-x64|win32-x64|linux-x64]   (default: this machine)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const VALID = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64'];
const target = process.argv[2] || `${process.platform}-${process.arch}`;
if (!VALID.includes(target)) {
  console.error(`prepare-runtime: unsupported target "${target}". Use one of: ${VALID.join(', ')}`);
  process.exit(1);
}
const scope = path.join(__dirname, '..', 'node_modules', '@github');
const sdk = JSON.parse(fs.readFileSync(path.join(scope, 'copilot-sdk', 'package.json'), 'utf8'));
const version = sdk.version;
const pkgName = `copilot-sdk-${target}`;
const pkgDir = path.join(scope, pkgName);

if (!fs.existsSync(path.join(pkgDir, 'package.json'))) {
  console.log(`prepare-runtime: fetching @github/${pkgName}@${version}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-rt-'));
  try {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    // npm.cmd needs a shell on Windows; all arguments here are fixed strings, none from user input.
    const out = execFileSync(npm, ['pack', `@github/${pkgName}@${version}`, '--pack-destination', tmp, '--silent'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    }).trim().split(/\r?\n/).pop();
    const tgz = path.join(tmp, out);
    fs.mkdirSync(pkgDir, { recursive: true });
    execFileSync('tar', ['-xzf', tgz, '-C', pkgDir, '--strip-components=1'], { stdio: 'inherit' });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
for (const name of fs.readdirSync(scope)) {
  if (/^copilot-sdk-/.test(name) && name !== pkgName) {
    console.log(`prepare-runtime: removing @github/${name} (not the build target)`);
    fs.rmSync(path.join(scope, name), { recursive: true, force: true });
  }
}
const exe = target.startsWith('win32') ? 'copilot-runtime.exe' : 'copilot-runtime';
for (const f of [exe, 'runtime.node']) {
  const p = path.join(pkgDir, 'prebuilds', target, f);
  if (!fs.existsSync(p)) {
    console.error(`prepare-runtime: ${p} is missing`);
    process.exit(1);
  }
}
console.log(`prepare-runtime: ready for ${target} (@github/${pkgName}@${version})`);
