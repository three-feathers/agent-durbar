// electron-builder afterPack: fail the build if the Copilot runtime is not unpacked next to app.asar.
const fs = require('fs');
const path = require('path');

const ARCH = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName; // darwin | win32 | linux
  const arch = ARCH[context.arch] || String(context.arch);
  const plat = `${platform}-${arch}`;
  const resources =
    platform === 'darwin'
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : path.join(context.appOutDir, 'resources');
  const dir = path.join(resources, 'app.asar.unpacked', 'node_modules', '@github', `copilot-sdk-${plat}`, 'prebuilds', plat);
  const exe = path.join(dir, platform === 'win32' ? 'copilot-runtime.exe' : 'copilot-runtime');
  for (const f of [exe, path.join(dir, 'runtime.node')]) {
    if (!fs.existsSync(f) || fs.statSync(f).size === 0) {
      throw new Error(`afterPack: Copilot runtime file missing from the package: ${f}\nRun "node scripts/prepare-runtime.js ${plat}" first and check asarUnpack.`);
    }
  }
  if (platform !== 'win32') fs.chmodSync(exe, 0o755);
  const stray = fs.readdirSync(path.join(resources, 'app.asar.unpacked', 'node_modules', '@github')).filter((n) => /^copilot-sdk-/.test(n) && n !== `copilot-sdk-${plat}`);
  if (stray.length) throw new Error(`afterPack: unexpected runtime packages bundled: ${stray.join(', ')}`);
  console.log(`  • afterPack: Copilot runtime for ${plat} is unpacked (${path.relative(context.appOutDir, exe)})`);
};
