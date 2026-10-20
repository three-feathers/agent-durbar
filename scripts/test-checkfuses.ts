/** check-fuses.js must fail on a binary with the wrong fuses: `npm run test:checkfuses` (spec 008 FR-039). Uses the stock, unflipped Electron. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

const root = path.join(__dirname, '..', '..');
const stock = path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
// electron is a devDependency: a missing binary means a broken install, so fail instead of skipping.
assert.ok(fs.existsSync(stock), `stock Electron binary not found at ${stock}; run npm ci`);
{
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-fuses.js'), stock], { encoding: 'utf8' });
  assert.notStrictEqual(r.status, 0, 'check-fuses.js must exit non-zero on an unflipped Electron');
  assert.ok(/5 fuse\(s\) differ/.test(r.stderr), `expected 5 fuses to differ, got: ${r.stderr}`);
  assert.strictEqual((r.stdout.match(/FAIL /g) ?? []).length, 5);
  console.log('checkfuses: ok');
}
