/** check-fuses.js must fail on a binary with the wrong fuses: `npm run test:checkfuses` (spec 008 FR-039). Uses the stock, unflipped Electron. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';

const root = path.join(__dirname, '..', '..');

// path resolution without an argument, per platform, on a fake release/ tree
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { findPackedBinaries } = require(path.join(root, 'scripts', 'check-fuses.js')) as { findPackedBinaries: (platform: string, dir: string, names: { productName: string; exeName: string }) => string[] };
const names = { productName: 'Agent Durbar', exeName: 'agent-durbar' };
const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-release-'));
const touch = (...p: string[]) => { const f = path.join(fake, ...p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ''); return f; };
try {
  assert.deepStrictEqual(findPackedBinaries('linux', fake, names), [], 'nothing packed yet');
  const lin = touch('linux-unpacked', 'agent-durbar');
  const win = touch('win-unpacked', 'Agent Durbar.exe');
  const m1 = touch('mac', 'Agent Durbar.app', 'Contents', 'MacOS', 'Agent Durbar');
  const m2 = touch('mac-arm64', 'Agent Durbar.app', 'Contents', 'MacOS', 'Agent Durbar');
  touch('mac-empty', 'readme.txt');
  touch('other', 'Agent Durbar.exe');
  assert.deepStrictEqual(findPackedBinaries('linux', fake, names), [lin]);
  assert.deepStrictEqual(findPackedBinaries('win32', fake, names), [win]);
  assert.deepStrictEqual(findPackedBinaries('darwin', fake, names), [m1, m2], 'every mac* build is checked');
  assert.deepStrictEqual(findPackedBinaries('freebsd', fake, names), []);
  assert.deepStrictEqual(findPackedBinaries('linux', path.join(fake, 'missing'), names), []);
} finally {
  fs.rmSync(fake, { recursive: true, force: true });
}

// In Node, require('electron') is the path of the stock binary; it downloads the binary first if it is missing (Electron 44 has no postinstall).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const stock: string = require('electron');
// electron is a devDependency: a binary that is still missing means a broken install, so fail instead of skipping.
assert.ok(typeof stock === 'string' && fs.existsSync(stock), `stock Electron binary not found at ${stock}; run npm ci`);
{
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-fuses.js'), stock], { encoding: 'utf8' });
  assert.notStrictEqual(r.status, 0, 'check-fuses.js must exit non-zero on an unflipped Electron');
  assert.ok(/5 fuse\(s\) differ/.test(r.stderr), `expected 5 fuses to differ, got: ${r.stderr}`);
  assert.strictEqual((r.stdout.match(/FAIL /g) ?? []).length, 5);
  console.log('checkfuses: ok');
}
