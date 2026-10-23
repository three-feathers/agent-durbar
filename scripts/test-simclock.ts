/** Spec 001 FR-084: the pinned simulator clock for screenshots (`npm run test:simclock`). No Electron is started. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { simClockQuery } from '../src/main/simclock';

const ROOT = path.join(__dirname, '..', '..');
// main: only a plain UTC ISO time is accepted, as milliseconds in decimal
assert.strictEqual(simClockQuery('2026-10-20T09:30:00Z'), String(Date.UTC(2026, 9, 20, 9, 30, 0)));
assert.strictEqual(simClockQuery('2026-10-20T09:30Z'), String(Date.UTC(2026, 9, 20, 9, 30, 0)));
for (const bad of [undefined, '', 'now', '2026-10-20', '2026-10-20T09:30:00+02:00', '2026-10-20T09:30:00.5Z', '2026-13-40T99:99:00Z', '1&sim=0', '2026-10-20T09:30:00Z\n'])
  assert.strictEqual(simClockQuery(bad), undefined, `rejected: ${JSON.stringify(bad)}`);

// renderer: the shim starts at the given time, runs on, and leaves dates with arguments alone
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pinClock, fromQuery } = require(path.join(ROOT, 'src', 'renderer', 'simclock.js')) as {
  pinClock: (g: { Date: DateConstructor }, ms: number) => DateConstructor; fromQuery: (s: string) => number | undefined;
};
const g = { Date } as { Date: DateConstructor };
const at = Date.UTC(2026, 9, 20, 9, 30, 0);
const D = pinClock(g, at);
assert.ok(Math.abs(D.now() - at) < 1000, 'Date.now() starts at the pinned time');
assert.ok(Math.abs(new D().getTime() - at) < 1000, 'new Date() too');
assert.strictEqual(new D(0).getTime(), 0, 'a date with an argument is unchanged');
assert.strictEqual(D.UTC(2020, 0, 1), Date.UTC(2020, 0, 1), 'Date.UTC kept');
assert.strictEqual(D.parse('2020-01-01T00:00:00Z'), Date.parse('2020-01-01T00:00:00Z'), 'Date.parse kept');
assert.ok(new D() instanceof Date && new D(5) instanceof D, 'instances are real dates');
assert.strictEqual(typeof (D as unknown as () => string)(), 'string', 'Date() without new still returns text');
assert.ok(((D as unknown as () => string)()).includes('2026'), 'and that text is the pinned time');
assert.strictEqual(g.Date, D, 'the global Date is replaced');
// the page pins only with the simulator and a numeric value
assert.strictEqual(fromQuery('?sim=15&simclock=1792488600000'), 1792488600000);
assert.strictEqual(fromQuery('?simclock=1792488600000'), undefined, 'not without the simulator');
assert.strictEqual(fromQuery('?sim=15&simclock=abc'), undefined);
assert.strictEqual(fromQuery('?sim=15'), undefined);

// wiring: main passes it only under the simulator; the page loads the shim before any other script; the build copies it
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const main = strip(fs.readFileSync(path.join(ROOT, 'src', 'main', 'main.ts'), 'utf8'));
assert.ok(/const SIM_CLOCK = SIMULATOR \? simClockQuery\(dev\.DURBAR_SIM_CLOCK\) : undefined;/.test(main), 'main reads the hook only under the simulator, through dev');
assert.ok(/if \(SIM_CLOCK\) query\.simclock = SIM_CLOCK;/.test(main), 'main passes it in the page query');
const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
const first = /<script src="([^"]+)"/.exec(html);
assert.strictEqual(first && first[1], 'simclock.js', 'the shim is the first script of the page');
assert.ok(fs.readFileSync(path.join(ROOT, 'scripts', 'copy-assets.js'), 'utf8').includes("'simclock.js'"), 'the build copies it');
console.log('simclock: ok');
