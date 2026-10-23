/** Spec 001 FR-084: the pinned simulator clock for screenshots (`npm run test:simclock`). No Electron is started. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { simClockQuery, simClockSetup } from '../src/main/simclock';
import { devEnv } from '../src/main/devhooks';
import { simulatorOn } from '../src/main/simguard';

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
assert.ok(/const simClock = simClockSetup\(dev, SIMULATOR\);/.test(main), 'main takes the setup from dev and its one simulator decision');
assert.strictEqual((main.match(/\bsimClockSetup\s*\(/g) || []).length, 1, 'main calls simClockSetup( exactly once (one decision; review on #574)');
assert.ok(/Object\.assign\(process\.env, simClock\.env\);/.test(main) && /for \(const \[name, value\] of simClock\.switches\) app\.commandLine\.appendSwitch\(name, value\);/.test(main), 'main applies exactly the env and switches of the setup');
assert.ok(/if \(simClock\.query\) query\.simclock = simClock\.query;/.test(main), 'main passes the query value of the setup');
assert.ok(!/process\.env\.TZ\s*=|appendSwitch\('lang'/.test(main), 'no other TZ or --lang change in main');
const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
const first = /<script src="([^"]+)"/.exec(html);
assert.strictEqual(first && first[1], 'simclock.js', 'the shim is the first script of the page');
assert.ok(fs.readFileSync(path.join(ROOT, 'scripts', 'copy-assets.js'), 'utf8').includes("'simclock.js'"), 'the build copies it');
// drivers reload the page with their own query: the shared H.load keeps a pinned clock (else only the first page would be pinned)
const helpersSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'driver-helpers.js'), 'utf8');
assert.ok(/searchParams\.get\('simclock'\)/.test(helpersSrc) && /simclock: clock/.test(helpersSrc), 'H.load carries simclock across reloads');
// review on #574: the decision by behaviour (devEnv + simulatorOn as main computes them), packaged builds and dev runs without the simulator change nothing
{
  const CLOCK_OK = '2026-10-20T09:30:00Z';
  const setup = (env: NodeJS.ProcessEnv, packaged: boolean) => { const dev = devEnv(env, packaged); return simClockSetup(dev, simulatorOn(dev)); };
  const none = { env: {}, switches: [] };
  assert.deepStrictEqual(setup({ DURBAR_SIM: '15', DURBAR_SIM_CLOCK: CLOCK_OK }, false), { query: String(Date.UTC(2026, 9, 20, 9, 30)), env: { TZ: 'UTC' }, switches: [['lang', 'en-US']] }, 'simulator + clock: UTC, en-US, the page clock');
  assert.deepStrictEqual(setup({ DURBAR_SIM_CLOCK: CLOCK_OK }, false), none, 'a clock without the simulator changes nothing (main keeps local time for schedules)');
  assert.deepStrictEqual(setup({ DURBAR_SIM: '15', DURBAR_SIM_CLOCK: CLOCK_OK }, true), none, 'packaged: no-op');
  assert.deepStrictEqual(setup({ DURBAR_SIM: '15', DURBAR_SIM_CLOCK: CLOCK_OK, DURBAR_DEV: '0' }, true), none, 'packaged, opt-in not exactly 1: no-op');
  assert.deepStrictEqual(setup({ DURBAR_SIM: '15', DURBAR_SIM_CLOCK: '2026-10-20T09:30:00+00:00' }, false), none, 'simulator + a value main does not accept: nothing changes');
  assert.deepStrictEqual(setup({ DURBAR_SIM: '15' }, false), none, 'simulator without a clock: nothing changes');
  assert.deepStrictEqual(simClockSetup({ DURBAR_SIM_CLOCK: CLOCK_OK }, false), none, 'simulator false: nothing, whatever dev holds');
}
// review on #574: shots-docs checks SHOTS_DOCS_CLOCK with main's validator and stops before any driver on a value main would ignore
{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const docs = require(path.join(ROOT, 'scripts', 'shots-docs.js')) as { CLOCK: string; pinnedClock: (v: string | undefined, q?: (s: string) => string | undefined) => string;
    main: (o: Record<string, unknown>) => Promise<unknown> };
  assert.strictEqual(docs.pinnedClock(undefined, simClockQuery), docs.CLOCK, 'no value: the default clock');
  assert.strictEqual(docs.pinnedClock('2027-01-02T03:04Z', simClockQuery), '2027-01-02T03:04Z');
  for (const bad of ['2026-10-20T09:30:00+00:00', 'tomorrow', '2026-10-20', '2026-10-20T09:30:00.000Z'])
    assert.throws(() => docs.pinnedClock(bad, simClockQuery), /not a UTC time main accepts/, `refused: ${bad}`);
  const old = process.env.SHOTS_DOCS_CLOCK;
  process.env.SHOTS_DOCS_CLOCK = '2026-10-20T09:30:00+00:00';
  let ran = 0, ensured = 0;
  (async () => {
    await assert.rejects(docs.main({ argv: ['--out', require('os').tmpdir()], clockQuery: simClockQuery, run: async () => { ran++; return { ok: true }; }, ensure: () => { ensured++; return true; } }), /not a UTC time main accepts/);
    assert.strictEqual(ran + ensured, 0, 'a bad clock fails before Electron is installed or any driver starts');
    if (old === undefined) delete process.env.SHOTS_DOCS_CLOCK; else process.env.SHOTS_DOCS_CLOCK = old;
    console.log('simclock: ok');
  })().catch((e) => { console.error(e); process.exitCode = 1; });
}
