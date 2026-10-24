/*
 * Spec 008 FR-125 (`npm run test:checkparallel`, part of `npm test`): scripts/check-parallel.js measures memory on macOS from
 * vm_stat (free + inactive + speculative pages) and no worker waits for memory forever while it holds a job (issue #670).
 * macOS itself is not run here (the checks use text samples and fakes): read: vm_stat output format.
 */
const assert = require('assert');
const { parseVmStat, darwinAvailable, waitForMemory, main } = require('./check-parallel');

const SAMPLE_4K = `Mach Virtual Memory Statistics: (page size of 4096 bytes)
Pages free:                               10000.
Pages active:                            900000.
Pages inactive:                           50000.
Pages speculative:                         2000.
Pages throttled:                              0.
Pages wired down:                        300000.
`;
const SAMPLE_16K = SAMPLE_4K.replace('4096', '16384');

assert.strictEqual(parseVmStat(SAMPLE_4K), (10000 + 50000 + 2000) * 4096, 'inactive and speculative count, active and wired do not');
assert.strictEqual(parseVmStat(SAMPLE_16K), (10000 + 50000 + 2000) * 16384, 'Apple silicon: the page size comes from the header');
assert.strictEqual(parseVmStat('Mach Virtual Memory Statistics: (page size of 4096 bytes)\nPages free: lots.\n'), null, 'malformed counts');
assert.strictEqual(parseVmStat('Pages free: 1.\nPages inactive: 1.\nPages speculative: 1.\n'), null, 'no page size header');
assert.strictEqual(parseVmStat(SAMPLE_4K.replace(/Pages inactive:.*\n/, '')), null, 'a missing field is not read as zero');
assert.strictEqual(parseVmStat(''), null, 'empty');
assert.strictEqual(parseVmStat(undefined), null, 'undefined');

assert.strictEqual(darwinAvailable(() => SAMPLE_4K), 62000 * 4096, 'the reading is the parse');
assert.strictEqual(darwinAvailable(() => { throw new Error('ENOENT'); }), null, 'vm_stat missing: null, the caller falls back to freemem');
let call;
darwinAvailable((cmd, args, opts) => { call = { cmd, args, opts }; return SAMPLE_4K; });
assert.ok(call.cmd === 'vm_stat' && Array.isArray(call.args) && call.args.length === 0 && !call.opts.shell && call.opts.timeout > 0, 'no shell, fixed arguments, a timeout');

(async () => {
  // the bound: a fake clock that moves only when the worker sleeps, memory that never comes
  let t = 0, sleeps = 0;
  const fake = { now: () => t, wait: async (ms) => { sleeps++; t += ms; if (sleeps > 1000) throw new Error('waits forever'); } };
  assert.strictEqual(await waitForMemory(() => 100, 1000, 120000, fake), false, 'gives up after the bound');
  assert.ok(t >= 120000 && t < 130000, `gave up at about 120 s of fake time (${t} ms)`);
  // memory that comes in time
  t = 0; let reads = 0;
  assert.strictEqual(await waitForMemory(() => (++reads > 3 ? 2000 : 100), 1000, 120000, fake), true, 'memory came: true');
  assert.strictEqual(await waitForMemory(() => 2000, 1000, 0, fake), true, 'enough memory: no wait even with a zero bound');

  // main: worker 1 holds a job under low memory, gives up, runs it anyway and says so; every job runs once
  const ran = [], logs = [];
  const jobs = [1, 2, 3].map((n) => ({ label: `job ${n}` }));
  const failed = await main({ ensure: () => true, runJob: async (j) => { ran.push(j.label); await new Promise((r) => setTimeout(r, 20)); return 'ok'; },
    available: () => 100 * 1024 * 1024, jobs, workers: 2, log: (l) => logs.push(l), waitMaxMs: 0 });
  assert.strictEqual(failed, 0);
  assert.deepStrictEqual(ran.slice().sort(), ['job 1', 'job 2', 'job 3'], 'every job ran');
  assert.ok(logs.some((l) => /warn .*running it anyway/.test(l) && /100 MB/.test(l)), `a warning with the measured memory (${logs.join(' | ')})`);
  console.log('check-parallel: vm_stat parse (4 KB and 16 KB pages, malformed, empty) and the bounded memory wait (spec 008 FR-125)');
})().catch((e) => { console.error(e); process.exit(1); });
