/*
 * `npm run test:perfrecord` (spec 097 T145, FR-187/FR-188): the record's shape and the pure helpers of scripts/perf-record.js, from a fixture. No Electron,
 * no timing. The driver run itself is `sim:` evidence (npm run check:perf -- --record f.json), and check-perf stays in ui-suite's NOT_IN_SUITE.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { median, medianOf, loadFlag, validateRecord, parseArgs, SCHEMA } = require('./perf-record.js');

assert.strictEqual(median([3, 1, 2]), 2);
assert.strictEqual(median([1, 2, 3, 10]), 2.5);
assert.strictEqual(median([]), null);
assert.deepStrictEqual(medianOf([{ a: 1, b: { c: 10 }, s: 'x' }, { a: 3, b: { c: 30 }, s: 'y' }, { a: 2, b: { c: 20 }, s: 'z' }]), { a: 2, b: { c: 20 }, s: 'x' });
assert.deepStrictEqual(loadFlag([9, 1, 1], 4, 'linux'), { loaded: true, known: true });
assert.deepStrictEqual(loadFlag([1, 1, 1], 4, 'darwin'), { loaded: false, known: true });
assert.deepStrictEqual(loadFlag([0, 0, 0], 4, 'win32'), { loaded: false, known: false }, 'Windows reports no load average: unknown, never flagged');
assert.deepStrictEqual(parseArgs(['--record', 'f.json', '--quick']).runs, 1);
assert.strictEqual(parseArgs(['--record', 'f.json', '--runs', '5']).runs, 5);
assert.deepStrictEqual(parseArgs(['--only', 'real-15,flat-40']).only, ['real-15', 'flat-40']);

const good = () => ({
  schema: SCHEMA, recordedAt: '2026-10-31T12:00:00.000Z', appSha: 'abc123',
  machine: { platform: 'darwin', release: '24.0.0', arch: 'arm64', cores: 8, loadavg: [1, 1, 1], loaded: false },
  devicePixelRatio: 2, gpu: { gpu_compositing: 'enabled' },
  cases: Object.fromEntries(['flat-15', 'flat-40', 'real-15', 'real-40'].map((k) => [k, k.startsWith('real') ? { available: false, reason: 'no Real office in this build' } : { available: true, runs: 3, rows: { update: { costP50: 12 } } }])),
});
assert.deepStrictEqual(validateRecord(good()), [], 'a sound record, with Real office absent, passes');
const no = (f) => { const r = good(); f(r); return validateRecord(r); };
assert.ok(no((r) => { delete r.gpu; }).some((p) => /gpu_compositing/.test(p)), 'the compositing status is required');
assert.ok(no((r) => { r.machine.loaded = undefined; }).some((p) => /loaded/.test(p)), 'the load flag is required');
assert.ok(no((r) => { r.appSha = ''; }).some((p) => /appSha/.test(p)));
assert.ok(no((r) => { r.devicePixelRatio = 0; }).some((p) => /devicePixelRatio/.test(p)));
assert.ok(no((r) => { delete r.cases['flat-40']; }).some((p) => /flat-40/.test(p)), 'a missing case fails');
assert.ok(no((r) => { r.cases['real-40'] = { available: false }; }).some((p) => /real-40/.test(p)), 'an absent case must say why');

// the driver files stay out of the pull-request suite and assert no time (AGENTS.md Timing)
const root = path.join(__dirname, '..');
assert.ok(/'check-perf':/.test(fs.readFileSync(path.join(root, 'scripts', 'ui-suite.js'), 'utf8')), 'check-perf stays in NOT_IN_SUITE');
for (const f of ['perf-record.js', 'perf-record-driver.js']) {
  const src = fs.readFileSync(path.join(root, 'scripts', f), 'utf8');
  assert.ok(!/require\('assert'\)|shell:\s*true|execSync\(/.test(src), `${f} asserts nothing and spawns no shell`);
  assert.ok(!/\/home\/|\/proc\/self|python/.test(src.replace(/\/proc\/\$\{m\.pid\}[^`]*/g, '')), `${f} has no private path and no Python`);
}
console.log('perf-record: ok');
