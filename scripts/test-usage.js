/*
 * Spec 008 FR-181: the Build cost report (scripts/usage-lib.js, usage-receiver.js, usage-day.js). No Claude, no network beyond a
 * loopback server on an ephemeral port. Fixtures follow the documented OTLP/HTTP JSON shape with FAKE identity attributes.
 * Every assert has its own message: a mutant must fail with the intended one.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const lib = require('./usage-lib');
const R = require('./usage-receiver');
const D = require('./usage-day');

process.exitCode = 1; // until the last line
const FAKE = ['fake.user@example.invalid', 'fake-user-id-0001', 'fake-account-uuid-0002', 'fake-org-id-0003', 'fake-session-id-0004', 'fake-agent-name-0005'];
const NOW = Date.UTC(2026, 10, 7, 12, 0, 0); // 2026-11-07 12:00 UTC
const nano = (iso) => String(BigInt(Date.parse(iso)) * 1000000n);
const attr = (key, v) => ({ key, value: { stringValue: v } });
const ident = () => [attr('user.email', FAKE[0]), attr('user.id', FAKE[1]), attr('user.account_uuid', FAKE[2]), attr('organization.id', FAKE[3]), attr('session.id', FAKE[4]), attr('agent.name', FAKE[5])];
const tok = (type, model, value, iso, source = 'main', extra = ident()) => ({ attributes: [attr('type', type), attr('model', model), attr('query_source', source), ...extra], asInt: String(value), timeUnixNano: nano(iso) });
const cost = (model, value, iso, source = 'main') => ({ attributes: [attr('model', model), attr('query_source', source), ...ident()], asDouble: value, timeUnixNano: nano(iso) });
const body = (tokenPts, costPts, temporality = 1) => ({ resourceMetrics: [{ resource: { attributes: ident() }, scopeMetrics: [{ scope: { name: 'com.anthropic.claude_code' }, metrics: [
  { name: 'claude_code.token.usage', unit: 'tokens', sum: { aggregationTemporality: temporality, isMonotonic: true, dataPoints: tokenPts } },
  { name: 'claude_code.cost.usage', unit: 'USD', sum: { aggregationTemporality: temporality, isMonotonic: true, dataPoints: costPts } },
  { name: 'claude_code.session.count', sum: { aggregationTemporality: 1, dataPoints: [{ asInt: '1', attributes: ident() }] } },
] }] }] });

const OPUS = 'claude-opus-4-7'; const SON = 'claude-sonnet-5-5';
const sample = body([
  tok('input', OPUS, 100, '2026-11-07T10:00:00Z'), tok('output', OPUS, 50, '2026-11-07T10:00:00Z'),
  tok('cacheRead', OPUS, 1000, '2026-11-07T10:00:00Z'), tok('cacheCreation', OPUS, 200, '2026-11-07T10:00:00Z'),
  tok('output', SON, 30, '2026-11-07T10:00:00Z', 'subagent'),
], [cost(OPUS, 1.25, '2026-11-07T10:00:00Z'), cost(SON, 0.5, '2026-11-07T10:00:00Z', 'subagent')]);

// ---- parsing and aggregation ----
{
  const st = lib.emptyState('linux');
  const r = lib.ingest(st, sample, NOW);
  assert.deepStrictEqual([r.tokens, r.costs, r.skipped], [5, 2, 0], 'parse: five token points and two cost points counted');
  const o = st.days['2026-11-07'].models[OPUS];
  assert.deepStrictEqual([o.input, o.output, o.cacheRead, o.cacheCreation], [100, 50, 1000, 200], 'parse: the four token types land in their own fields');
  assert.strictEqual(o.costUsd, 1.25, 'parse: cost per model');
  const s = st.days['2026-11-07'].models[SON];
  assert.strictEqual(s.bySource.subagent.tokens, 30, 'split: subagent tokens counted apart');
  assert.strictEqual(s.bySource.subagent.costUsd, 0.5, 'split: subagent cost counted apart');
  assert.strictEqual(o.bySource.main.tokens, 1350, 'split: main tokens are the sum of the four types');
  assert.strictEqual(o.bySource.subagent.tokens, 0, 'split: nothing leaks from main to subagent');
  // the session.count metric is not read
  assert.ok(!JSON.stringify(st).includes('session.count'), 'parse: other metrics are not kept');
}
// delta aggregation: two exports add up
{
  const st = lib.emptyState('linux');
  lib.ingest(st, sample, NOW); lib.ingest(st, sample, NOW);
  const o = st.days['2026-11-07'].models[OPUS];
  assert.strictEqual(o.output, 100, 'delta: two exports are added');
  assert.strictEqual(o.costUsd, 2.5, 'delta: cost of two exports is added');
}
// a cumulative sum is skipped, never added (it would count twice)
{
  const st = lib.emptyState('linux');
  const r = lib.ingest(st, body([tok('input', OPUS, 100, '2026-11-07T10:00:00Z')], [cost(OPUS, 1, '2026-11-07T10:00:00Z')], 2), NOW);
  assert.deepStrictEqual(Object.keys(st.days), [], 'cumulative: nothing added');
  assert.strictEqual(r.skipped, 2, 'cumulative: the points are counted as skipped');
}
// day bucketing by the data point's UTC time
{
  const st = lib.emptyState('linux');
  lib.ingest(st, body([tok('input', OPUS, 1, '2026-11-06T23:59:59Z'), tok('input', OPUS, 2, '2026-11-07T00:00:00Z'), tok('input', OPUS, 4, '2026-11-07T23:59:59Z')], []), NOW);
  assert.strictEqual(st.days['2026-11-06'].models[OPUS].input, 1, 'day: 23:59:59Z belongs to the earlier UTC day');
  assert.strictEqual(st.days['2026-11-07'].models[OPUS].input, 6, 'day: 00:00:00Z and 23:59:59Z share one UTC day');
  assert.strictEqual(lib.dayOf(undefined, NOW), '2026-11-07', 'day: a missing time uses the receipt time');
  assert.strictEqual(lib.dayOf(nano('2019-01-01T00:00:00Z'), NOW), '2026-11-07', 'day: a time before 2020 uses the receipt time');
  assert.strictEqual(lib.dayOf(nano('2030-01-01T00:00:00Z'), NOW), '2026-11-07', 'day: a time years ahead uses the receipt time');
  assert.strictEqual(lib.dayOf('12abc', NOW), '2026-11-07', 'day: a non-numeric time uses the receipt time');
}
// hostile values and names
{
  const st = lib.emptyState('linux');
  const pts = [tok('input', OPUS, -5, '2026-11-07T10:00:00Z'), tok('bogus', OPUS, 5, '2026-11-07T10:00:00Z'), { attributes: [attr('type', 'input')], asDouble: 'NaN' },
    tok('input', 'x'.repeat(200), 7, '2026-11-07T10:00:00Z'), tok('input', '__proto__', 8, '2026-11-07T10:00:00Z'), tok('input', OPUS, 3, '2026-11-07T10:00:00Z', 'evil-source'),
    { attributes: [attr('type', 'input'), attr('model', OPUS)], asInt: '99999999999999999999999' }];
  lib.ingest(st, body(pts, [cost(OPUS, -1, '2026-11-07T10:00:00Z')]), NOW);
  const m = st.days['2026-11-07'].models;
  assert.ok(m['other-model'] && m['other-model'].input === 15, 'names: a long or odd model name is counted as other-model');
  assert.strictEqual(m[OPUS].input, 3, 'values: negative, unknown type, NaN and huge values are refused');
  assert.strictEqual(m[OPUS].bySource.other.tokens, 3, 'names: an unknown query_source is counted as other');
  assert.strictEqual(m[OPUS].costUsd, 0, 'values: a negative cost is refused');
  assert.strictEqual(({}).input, undefined, 'names: no prototype pollution');
}
assert.throws(() => lib.ingest(lib.emptyState('linux'), { nope: 1 }, NOW), /not an OTLP/, 'a body without resourceMetrics is refused');

// ---- machine labels ----
assert.strictEqual(lib.checkMachine('Mac'), 'mac', 'machine: lower-cased');
for (const bad of [undefined, '', '../x', 'a b', 'x'.repeat(25), 'a/b', 'a\\b', 'é', '-x']) assert.throws(() => lib.checkMachine(bad), /machine label/, `machine: ${JSON.stringify(bad)} refused`);
assert.throws(() => R.parseArgs([], {}), /machine label/, 'machine: no host-name fallback, the variable is required');
{
  const o = R.parseArgs([], { DURBAR_USAGE_MACHINE: 'linux' });
  assert.strictEqual(o.port, 4318, 'args: default port 4318');
  assert.strictEqual(o.dir, path.join(os.homedir(), '.durbar-usage'), 'args: default folder is <home>/.durbar-usage');
  assert.strictEqual(R.parseArgs(['--port', '0', '--dir', 'x'], { DURBAR_USAGE_MACHINE: 'mac' }).dir, 'x', 'args: --dir');
  assert.throws(() => R.parseArgs(['--port', '70000'], { DURBAR_USAGE_MACHINE: 'mac' }), /--port/, 'args: port out of range');
  assert.throws(() => R.parseArgs(['--port', 'abc'], { DURBAR_USAGE_MACHINE: 'mac' }), /--port/, 'args: port not a number');
  assert.throws(() => R.parseArgs(['--bogus'], { DURBAR_USAGE_MACHINE: 'mac' }), /unknown argument/, 'args: unknown flag');
}

// ---- the service: refusals, privacy, atomic file ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-usage-test-'));
const post = (port, buf, headers = {}, p = '/v1/metrics', method = 'POST') => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: p, method, agent: false, headers: { 'content-type': 'application/json', ...headers } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, text: t }));
  });
  req.on('error', (e) => resolve({ status: 0, text: String(e.code || e.message) }));
  req.end(buf);
});
const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms).unref())]);

(async () => {
  const dir = path.join(tmp, 'a');
  const { server, svc } = R.createServer({ dir, machine: 'linux', port: 0, now: () => NOW });
  await new Promise((r) => R.listen(server, 0, r));
  assert.strictEqual(server.address().address, '127.0.0.1', 'listen: loopback only');
  const port = server.address().port;
  const json = Buffer.from(JSON.stringify(sample));
  let r = await withTimeout(post(port, json), 5000, 'post hung');
  assert.strictEqual(r.status, 200, 'accept: a valid body gets 200');
  const file = path.join(dir, 'usage-linux.json');
  const written = fs.readFileSync(file, 'utf8');
  for (const f of FAKE) assert.ok(!written.includes(f), `privacy: ${f.slice(0, 9)}... never reaches the file`);
  for (const k of ['email', 'user.id', 'account', 'organization', 'session', 'agent.name', 'timeUnixNano', 'attributes']) assert.ok(!written.includes(k), `privacy: no "${k}" key in the file`);
  const onDisk = JSON.parse(written);
  assert.deepStrictEqual(Object.keys(onDisk).sort(), ['days', 'machine', 'version'], 'file: only version, machine and days');
  assert.strictEqual(onDisk.days['2026-11-07'].models[OPUS].input, 100, 'file: the sums are in the file');
  assert.deepStrictEqual(fs.readdirSync(dir), ['usage-linux.json'], 'atomic: no temporary file is left');
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(file).mode & 0o077, 0, 'file: owner-only');

  // gzip is accepted, a second export adds (delta)
  r = await post(port, zlib.gzipSync(json), { 'content-encoding': 'gzip' });
  assert.strictEqual(r.status, 200, 'accept: gzip body');
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).days['2026-11-07'].models[OPUS].input, 200, 'delta: a second export adds to the file');
  // refusals; none changes the file
  const before = fs.readFileSync(file, 'utf8');
  r = await post(port, Buffer.alloc(1024 * 1024 + 1, 0x20));
  assert.ok(r.status === 413 || r.status === 0, `oversize: refused (got ${r.status})`);
  r = await post(port, Buffer.from('{"resourceMetrics": [')); assert.strictEqual(r.status, 400, 'bad body: truncated JSON is 400');
  r = await post(port, Buffer.from('{"resourceMetrics":[],}')); assert.strictEqual(r.status, 400, 'bad body: trailing comma is 400 (strict parse)');
  r = await post(port, Buffer.from('[]')); assert.strictEqual(r.status, 400, 'bad body: not an OTLP object is 400');
  r = await post(port, Buffer.from('null')); assert.strictEqual(r.status, 400, 'bad body: null is 400');
  r = await post(port, Buffer.from('not json')); assert.strictEqual(r.status, 400, 'bad body: text is 400');
  r = await post(port, zlib.gzipSync(Buffer.alloc(1024 * 1024 + 10, 0x20)), { 'content-encoding': 'gzip' }); assert.strictEqual(r.status, 413, 'oversize: a gzip bomb is refused after inflating');
  r = await post(port, Buffer.from('xx'), { 'content-encoding': 'gzip' }); assert.strictEqual(r.status, 413, 'bad body: broken gzip is refused');
  r = await post(port, json, { 'content-encoding': 'br' }); assert.strictEqual(r.status, 415, 'encoding: br is refused');
  r = await post(port, json, { 'content-type': 'text/plain' }); assert.strictEqual(r.status, 415, 'type: text/plain (a cross-site simple request) is refused');
  r = await post(port, json, { host: 'evil.example' }); assert.strictEqual(r.status, 403, 'host: a non-loopback Host (DNS rebinding) is refused');
  r = await post(port, json, {}, '/v1/traces'); assert.strictEqual(r.status, 404, 'path: only /v1/metrics');
  r = await post(port, json, {}, '/v1/metrics', 'GET'); assert.strictEqual(r.status, 405, 'method: POST only');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before, 'refusals change nothing in the file');
  assert.ok(await withTimeout(post(port, json), 5000, 'post hung').then((x) => x.status === 200), 'the server still works after the refusals');
  await new Promise((r2) => server.close(r2));

  // a restart carries on from the file; a foreign file is never overwritten
  const again = R.createService({ dir, machine: 'linux', now: () => NOW });
  assert.strictEqual(again.state.days['2026-11-07'].models[OPUS].input, 300, 'restart: sums are loaded from the file');
  fs.copyFileSync(path.join(dir, 'usage-linux.json'), path.join(dir, 'usage-mac.json'));
  assert.throws(() => R.createService({ dir, machine: 'mac' }), /belongs to machine/, 'restart: a file of another machine label is refused');
  fs.unlinkSync(path.join(dir, 'usage-mac.json'));
  const bad = path.join(tmp, 'b'); fs.mkdirSync(bad); fs.writeFileSync(path.join(bad, 'usage-linux.json'), '{"oops":1}');
  assert.throws(() => R.createService({ dir: bad, machine: 'linux' }), /not a usage file/, 'restart: a wrong file stops the receiver');
  assert.strictEqual(fs.readFileSync(path.join(bad, 'usage-linux.json'), 'utf8'), '{"oops":1}', 'restart: a wrong file is left as it was');

  // ---- the report ----
  const mk = (machine, iso, model, input, usdv) => { const s = lib.emptyState(machine); lib.ingest(s, body([tok('input', model, input, iso), tok('output', model, 10, iso)], [cost(model, usdv, iso)]), NOW); return s; };
  const a = mk('linux', '2026-11-07T10:00:00Z', OPUS, 1500000, 2.5);
  const b = mk('mac', '2026-11-07T11:00:00Z', SON, 20, 0.25);
  lib.ingest(a, body([tok('input', OPUS, 1000, '2026-11-06T10:00:00Z')], [cost(OPUS, 1, '2026-11-06T10:00:00Z')]), NOW);
  lib.ingest(a, body([tok('input', OPUS, 77, '2026-11-08T10:00:00Z')], [cost(OPUS, 9, '2026-11-08T10:00:00Z')]), Date.UTC(2026, 10, 8, 12));
  const out = lib.report([b, a], '2026-11-07');
  assert.ok(/list-price estimate, not billing/.test(out), 'report: labelled as an estimate, not billing');
  assert.ok(out.includes('| linux | claude-opus-4-7 | 1,500,000 | 10 | 0 | 0 | $2.50 |'), 'report: a machine and model row with grouped numbers');
  assert.ok(out.indexOf('| linux |') < out.indexOf('| mac |'), 'report: machines sorted');
  assert.ok(out.includes('| **Day total** |  | 1,500,020 | 20 | 0 | 0 | $2.75 |'), 'report: day total adds machines and models');
  assert.ok(/Total since tracking began \(2026-11-06\), to 2026-11-07\*\* \|  \| 1,501,020 \| 20 \| 0 \| 0 \| \$3\.75 \|/.test(out), 'report: cumulative covers earlier days and not later ones');
  assert.ok(out.includes('Machines: linux, mac.'), 'report: machines listed');
  assert.ok(/main \$2\.75, subagent \$0\.00/.test(out), 'report: main and subagent split of the day cost');
  assert.ok(/no usage recorded/.test(lib.report([a], '2026-10-01')), 'report: a day with no data says so');
  assert.throws(() => lib.report([a], '2026-1-1'), /--date/, 'report: bad date refused');
  for (const f of FAKE) assert.ok(!out.includes(f), 'privacy: nothing identifying in the report');

  // files: --files, folder scan, duplicate machine, hand-written file, bad files
  const ff = path.join(tmp, 'c'); fs.mkdirSync(ff);
  fs.writeFileSync(path.join(ff, 'usage-linux.json'), JSON.stringify(a)); fs.writeFileSync(path.join(ff, 'usage-mac.json'), JSON.stringify(b));
  fs.writeFileSync(path.join(ff, 'notes.json'), 'not read');
  const o = D.parseArgs(['--date', '2026-11-07'], { DURBAR_USAGE_DIR: ff }, NOW);
  assert.deepStrictEqual(D.loadStates(o).map((s) => s.machine), ['linux', 'mac'], 'files: the folder scan reads usage-*.json only');
  assert.deepStrictEqual(D.loadStates(D.parseArgs(['--files', `${path.join(ff, 'usage-mac.json')}`], {}, NOW)).map((s) => s.machine), ['mac'], 'files: --files');
  assert.throws(() => D.loadStates(D.parseArgs(['--files', `${path.join(ff, 'usage-mac.json')},${path.join(ff, 'usage-mac.json')}`], {}, NOW)), /two files for machine/, 'files: the same machine twice would count twice');
  const hand = { version: 1, machine: 'paco-codex', days: { '2026-11-07': { models: { 'gpt-5': { input: 5, output: 6, costUsd: 0.5 } } } } };
  fs.writeFileSync(path.join(ff, 'hand.json'), JSON.stringify({ ...hand, extra: FAKE[0] }));
  const hs = D.readState(path.join(ff, 'hand.json'));
  assert.strictEqual(hs.days['2026-11-07'].models['gpt-5'].output, 6, 'hand: a hand-written file is read');
  assert.ok(!JSON.stringify(hs).includes(FAKE[0]), 'hand: unknown keys are dropped');
  assert.ok(lib.report([a, hs], '2026-11-07').includes('| paco-codex | gpt-5 | 5 | 6 | 0 | 0 | $0.50 |'), 'hand: its row is in the report');
  fs.writeFileSync(path.join(ff, 'neg.json'), JSON.stringify({ ...hand, days: { '2026-11-07': { models: { 'gpt-5': { input: -1 } } } } }));
  assert.throws(() => D.readState(path.join(ff, 'neg.json')), /number is wrong/, 'hand: a negative number is refused');
  fs.writeFileSync(path.join(ff, 'badm.json'), JSON.stringify({ ...hand, machine: '../etc' }));
  assert.throws(() => D.readState(path.join(ff, 'badm.json')), /machine label/, 'hand: a bad machine label is refused');
  assert.throws(() => D.loadStates(D.parseArgs([], { DURBAR_USAGE_DIR: path.join(tmp, 'none') }, NOW)), /no usage files/, 'files: none found says how to start');
  assert.strictEqual(D.parseArgs([], {}, NOW).date, '2026-11-07', 'args: the date defaults to today, UTC');
  for (const bad of ['2026-02-30', '2026-13-01', '26-11-07', 'today']) assert.throws(() => D.parseArgs(['--date', bad], {}, NOW), /--date/, `args: ${bad} refused`);

  fs.rmSync(tmp, { recursive: true, force: true });
  process.exitCode = 0;
  console.log('test-usage: OK');
})().catch((e) => { console.error(e); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); });
