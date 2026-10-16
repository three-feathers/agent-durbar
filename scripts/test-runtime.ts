/** Unit test for locating the unpacked Copilot runtime in a packaged app: `npm run test:runtime`. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { unpackedRuntimePath } from '../src/adapters/runtime';

const res = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-rt-'));
const dir = path.join(res, 'app.asar', 'dist', 'adapters');
// dev (not in an asar): SDK default
assert.strictEqual(unpackedRuntimePath('/repo/dist/adapters', res, 'linux', 'x64'), undefined);
// packaged but runtime missing
assert.strictEqual(unpackedRuntimePath(dir, res, 'darwin', 'arm64'), undefined);
for (const [plat, arch, exe] of [['darwin', 'arm64', 'copilot-runtime'], ['darwin', 'x64', 'copilot-runtime'], ['win32', 'x64', 'copilot-runtime.exe'], ['linux', 'x64', 'copilot-runtime']] as const) {
  const d = path.join(res, 'app.asar.unpacked', 'node_modules', '@github', `copilot-sdk-${plat}-${arch}`, 'prebuilds', `${plat}-${arch}`);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, exe), 'x');
  assert.strictEqual(unpackedRuntimePath(dir, res, plat, arch), path.join(d, exe));
}
fs.rmSync(res, { recursive: true, force: true });
console.log('runtime path: all checks passed');
