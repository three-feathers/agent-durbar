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

// ---- README block, history, badge and chart (FR-181 addition) ----
{
  const R2 = require('./usage-readme');
  const base = lib.validateBaseline({ version: 1, since: '2026-10-25', through: '2026-11-07', note: 'older work and other machines.', models: { 'claude-opus-5-5': 2856, 'claude-sonnet-5-5': 902 }, machines: { linux: 3758 } });
  const mkst = (machine, iso, model, usdv) => { const s = lib.emptyState(machine); lib.ingest(s, body([], [cost(model, usdv, iso)]), NOW); return s; };
  const cum0 = lib.cumulative([], '2026-11-07', base);
  assert.strictEqual(cum0.total, 3758, 'cumulative: the baseline alone');
  const later = mkst('mac', '2026-11-09T10:00:00Z', 'claude-opus-5-5', 100);
  const early = mkst('linux', '2026-11-07T10:00:00Z', 'claude-opus-5-5', 50); // the baseline's own day: already counted
  assert.strictEqual(lib.cumulative([later, early], '2026-11-10', base).total, 3858, 'cumulative: usage after the baseline day is added, the baseline day is not counted twice');
  assert.strictEqual(lib.cumulative([later], '2026-11-08', base).total, 3758, 'cumulative: days after --date are left out');
  const cum1 = lib.cumulative([later], '2026-11-10', base);
  assert.deepStrictEqual([...cum1.models.keys()].sort(), ['claude-opus-5-5', 'claude-sonnet-5-5'], 'merge: a baseline and a usage file for one model are one row');
  assert.strictEqual(cum1.models.get('claude-opus-5-5'), 2956, 'merge: their dollars are added in that row');
  assert.strictEqual(lib.modelName('claude-sonnet-5-5'), 'Sonnet 5.5', 'names: ids map to display names in one place');
  assert.strictEqual(lib.modelName('__proto__'), '__proto__', 'names: an unlisted id (or a prototype name) shows as itself');
  const block = lib.readmeBlock(cum1, '2026-11-10', 'v0.1.13', base.note);
  assert.ok(block.includes('**API list-price estimate, not billing**'), 'label: the estimate text is in the block');
  assert.ok(/About US\$3,858\*\*/.test(block) && block.includes('as of 2026-11-10') && block.includes('`v0.1.13`'), 'block: total, date and release');
  assert.ok(block.includes('Opus 5.5 77% (US$2,956)') && !block.includes('claude-opus-5-5') && block.includes('mac 3% (US$100)') && block.includes('linux 97%'), 'block: split by model and by machine');
  assert.ok(block.includes('docs/build-cost.md') && block.includes('Not counted yet: older work'), 'block: method link and what is not counted');
  assert.throws(() => lib.readmeBlock(cum1, '2026-11-10', 'v1', 'x'), /--release/, 'block: a release must look like a tag');
  const readme = `# T\n\nintro\n\n${lib.BEGIN}\nold stuff\n${lib.END}\n\nrest\n`;
  const once = lib.rewriteReadme(readme, block);
  assert.strictEqual(lib.rewriteReadme(once, block), once, 'rewrite: idempotent');
  assert.ok(once.startsWith('# T\n\nintro\n\n') && once.endsWith('\n\nrest\n') && !once.includes('old stuff'), 'rewrite: only the block changes');
  for (const [why, text] of [['no markers', '# T\n'], ['no end', `${lib.BEGIN}\nx`], ['no begin', `x\n${lib.END}`], ['reversed', `${lib.END}\n${lib.BEGIN}`], ['two blocks', readme + readme], ['two begins', `${lib.BEGIN}\n${lib.BEGIN}\nx\n${lib.END}`]]) {
    assert.throws(() => lib.rewriteReadme(text, block), /exactly one "<!-- build-cost:begin/, `rewrite: ${why} fails clearly`);
  }
  // history, golden files, escaping, small histories
  const row = (date, version, o, s2) => ({ date, version, models: { 'claude-opus-5-5': o, 'claude-sonnet-5-5': s2 }, machines: { linux: o + s2 } });
  const hist = lib.validateHistory({ version: 1, rows: [row('2026-11-07', 'v0.1.12', 2856, 902), row('2026-11-10', 'v0.1.13', 3500, 1100), row('2026-11-14', 'v0.1.14', 6000, 1500)] });
  const golden = (name, text) => {
    const f = path.join(__dirname, 'fixtures', 'build-cost', name);
    if (process.env.GOLDEN_WRITE === '1') { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
    assert.strictEqual(text, fs.readFileSync(f, 'utf8'), `golden: ${name} is unchanged (GOLDEN_WRITE=1 rewrites it)`);
  };
  assert.strictEqual(lib.chartSvg(hist), lib.chartSvg(hist), 'chart: deterministic');
  const chart = lib.chartSvg(hist);
  assert.ok(chart.includes('US$0') && chart.includes('US$8,000') && chart.includes('11-14 v0.1.14') && chart.includes('release date, UTC'), 'chart: labelled axes');
  assert.ok(chart.includes('API list-price estimate, not billing') && chart.includes('tabular-nums') && chart.includes('prefers-color-scheme:dark'), 'chart: label, tabular numbers, dark text');
  assert.ok(chart.includes('prefers-color-scheme:dark){.s0{fill:#388bfd}') && chart.includes('class="s0"'), 'chart: series colours have a lighter dark-mode value');
  golden('chart-three-rows.svg', lib.chartSvg(hist));
  golden('badge.svg', lib.badgeSvg(3758));
  assert.ok((chart.match(/<polygon/g) || []).length === 2, 'chart: one stacked area per model');
  assert.ok(chart.length < 6000 && lib.badgeSvg(3758).length < 1000, 'size: the SVGs stay a few KB');
  const evil = lib.validateHistory({ version: 1, rows: [{ date: '2026-11-07', version: 'v0.1.12', models: { 'A (x)': 5 }, machines: {} }] });
  assert.ok(lib.esc('<a href="x">&\'') === '&lt;a href=&quot;x&quot;&gt;&amp;&#39;', 'escape: markup characters in a label');
  assert.ok(!lib.chartSvg(evil).includes('<a '), 'escape: no markup from a label');
  assert.throws(() => lib.validateHistory({ version: 1, rows: [{ date: '2026-11-07', version: 'v0.1.12', models: { '<script>': 1 }, machines: {} }] }), /bad entry/, 'escape: a markup model name is refused outright');
  let none; assert.doesNotThrow(() => { none = lib.chartSvg(lib.validateHistory({ version: 1, rows: [] })); }, 'chart: an empty history renders');
  assert.ok(none.includes('no releases recorded yet') && none.includes('<svg') && none.endsWith('</svg>\n'), 'chart: an empty history renders');
  const one = lib.chartSvg(lib.validateHistory({ version: 1, rows: [row('2026-11-07', 'v0.1.12', 2856, 902)] }));
  assert.ok(one.includes('<rect x=') && !one.includes('NaN') && !one.includes('Infinity'), 'chart: one row renders bars, no NaN');
  const zero = lib.chartSvg(lib.validateHistory({ version: 1, rows: [row('2026-11-07', 'v0.1.12', 0, 0)] }));
  assert.ok(!zero.includes('NaN') && !zero.includes('Infinity'), 'chart: an all-zero row renders');
  assert.ok(lib.badgeSvg(3758).includes('≈ US$3,758 (list-price est.)') && lib.badgeSvg(3758).includes('build cost'), 'badge: its text');
  assert.throws(() => lib.validateHistory({ version: 1, rows: [row('2026-11-10', 'v0.1.13', 1, 1), row('2026-11-07', 'v0.1.12', 1, 1)] }), /oldest first/, 'history: order checked');
  const up = lib.upsertRow(hist, cum1, '2026-11-14', 'v0.1.14');
  assert.strictEqual(up.rows.length, 3, 'history: the same version replaces its row');
  assert.strictEqual(lib.upsertRow(hist, cum1, '2026-11-20', 'v0.1.15').rows.length, 4, 'history: a new version adds a row');
  // the command, end to end on temporary files
  const t2 = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-usage-readme-'));
  const P = (n) => path.join(t2, n);
  fs.writeFileSync(P('README.md'), readme); fs.writeFileSync(P('base.json'), JSON.stringify({ version: 1, since: '2026-10-25', through: '2026-11-07', note: 'older work.', models: { 'claude-opus-5-5': 10 }, machines: { linux: 10 } }));
  const args = ['--release', 'v0.1.12', '--date', '2026-11-07', '--baseline', P('base.json'), '--readme', P('README.md'), '--history', P('h.json'), '--badge', P('b.svg'), '--chart', P('c.svg'), '--files', P('none.json')];
  const mk2 = () => R2.build(R2.parseArgs(args.filter((a, i) => args[i - 1] !== '--files' && a !== '--files'), { DURBAR_USAGE_DIR: P('nodir') }, NOW));
  const r1 = mk2();
  assert.ok(r1.text.includes('About US$10**') && r1.history.rows.length === 1 && r1.badge.includes('US$10 ') && r1.chart.includes('<svg'), 'command: block, history, badge and chart from the baseline alone');
  assert.throws(() => R2.parseArgs(['--date', '2026-11-07'], {}, NOW), /--release/, 'command: --release required');
  fs.writeFileSync(P('README.md'), '# no markers\n');
  assert.throws(() => mk2(), /exactly one/, 'command: a README without markers fails');
  fs.rmSync(t2, { recursive: true, force: true });
}

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
  assert.deepStrictEqual(Object.keys(onDisk).sort(), ['days', 'machine', 'skipped', 'version'], 'file: only version, machine, skipped and days');
  assert.strictEqual(onDisk.days['2026-11-07'].models[OPUS].input, 100, 'file: the sums are in the file');
  assert.deepStrictEqual(fs.readdirSync(dir).filter((n) => !n.endsWith('.lock')),['usage-linux.json'], 'atomic: no temporary file is left');
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
  for (const h of ['127.0.0.1.evil.example', 'localhost.', 'localhost.evil.example', 'a@127.0.0.1', '127.0.0.1@evil.example', '127.1', '0.0.0.0', '[::ffff:127.0.0.1]', 'evil.example:127.0.0.1', 'xlocalhost', '127.0.0.1:80a', 'localhost:']) {
    r = await post(port, json, { host: h }); assert.strictEqual(r.status, 403, `host: ${h} is refused`);
  }
  for (const p2 of ['/v1/traces', '/v1/logs', '/v1/metrics/', '//v1/metrics', '/']) { r = await post(port, json, {}, p2); assert.strictEqual(r.status, 404, `path: ${p2} is refused, only /v1/metrics`); }
  r = await post(port, json, {}, '/v1/metrics', 'GET'); assert.strictEqual(r.status, 405, 'method: POST only');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before, 'refusals change nothing in the file');
  for (const h of ['127.0.0.1', '127.0.0.1:4318', 'localhost', 'LOCALHOST:1', '[::1]', '[::1]:65535']) {
    r = await post(port, json, { host: h }); assert.strictEqual(r.status, 200, `host: ${h} is accepted`);
  }
  assert.ok(await withTimeout(post(port, json), 5000, 'post hung').then((x) => x.status === 200), 'the server still works after the refusals');
  const finalInput = JSON.parse(fs.readFileSync(file, 'utf8')).days['2026-11-07'].models[OPUS].input;
  assert.ok(finalInput >= 300, 'accepted posts were added');
  await new Promise((r2) => server.close(r2));

  // a restart carries on from the file; a foreign file is never overwritten
  let again; assert.doesNotThrow(() => { again = R.createService({ dir, machine: 'linux', now: () => NOW }); }, 'lock: closing the server releases the lock');
  assert.strictEqual(again.state.days['2026-11-07'].models[OPUS].input, finalInput, 'restart: sums are loaded from the file');
  fs.copyFileSync(path.join(dir, 'usage-linux.json'), path.join(dir, 'usage-mac.json'));
  assert.throws(() => R.createService({ dir, machine: 'mac' }), /belongs to machine/, 'restart: a file of another machine label is refused');
  fs.unlinkSync(path.join(dir, 'usage-mac.json'));
  const bad = path.join(tmp, 'b'); fs.mkdirSync(bad); fs.writeFileSync(path.join(bad, 'usage-linux.json'), '{"oops":1}');
  assert.throws(() => R.createService({ dir: bad, machine: 'linux' }), /not a usage file/, 'restart: a wrong file stops the receiver');
  assert.strictEqual(fs.readFileSync(path.join(bad, 'usage-linux.json'), 'utf8'), '{"oops":1}', 'restart: a wrong file is left as it was');

  // ---- review of #1251: bounds, host, claims that had no test, lock ----
  {
    const asBuf = (o) => Buffer.from(JSON.stringify(o));
    const day = '2026-11-07T10:00:00Z';
    // 1. models per day are capped; the rest go to other-model, nothing is lost
    const st = lib.emptyState('linux');
    const many = []; for (let i = 0; i < 80; i++) many.push(tok('input', `m-${i}`, 1, day));
    lib.ingest(st, body(many, []), NOW);
    const models = st.days['2026-11-07'].models;
    assert.strictEqual(Object.keys(models).length, lib.MAX_MODELS_PER_DAY + 1, 'models cap: at most the cap plus other-model per day');
    assert.strictEqual(models['other-model'].input, 80 - lib.MAX_MODELS_PER_DAY, 'models cap: the extra models are added to other-model');
    lib.ingest(st, body([tok('input', 'm-0', 5, day)], []), NOW);
    assert.strictEqual(models['m-0'].input, 6, 'models cap: a model already listed keeps adding to its own row');
    lib.ingest(st, body([tok('input', 'm-0', 1, '2026-11-08T10:00:00Z')], []), NOW);
    assert.ok(st.days['2026-11-08'].models['m-0'], 'models cap: the cap is per day');
    let touched = false;
    const spy = { key: 'user.email', get value() { touched = true; return { stringValue: 'x' }; } };
    lib.ingest(lib.emptyState('linux'), body([{ attributes: [spy, attr('type', 'input'), attr('model', OPUS)], asInt: '1', timeUnixNano: nano(day) }], []), NOW);
    assert.strictEqual(touched, false, 'attributes: the value of a key that is not allowed is never read');
    const rawMany = { version: 1, machine: 'linux', days: { '2026-11-07': { models: {} } } };
    for (let i = 0; i < 60; i++) rawMany.days['2026-11-07'].models[`h-${i}`] = { input: i + 1 };
    const loaded = lib.validateState(rawMany);
    assert.strictEqual(Object.keys(loaded.days['2026-11-07'].models).length, 60, 'models cap: reading a file back never folds or loses a row');
    assert.strictEqual(loaded.days['2026-11-07'].models['h-59'].input, 60, 'models cap: reading a file back keeps each row');

    // 1b. a write over the file cap is refused and nothing is lost (the injected cap is small)
    const d1 = path.join(tmp, 'cap'); const w1 = [];
    const small = R.createService({ dir: d1, machine: 'linux', now: () => NOW, maxFileBytes: 700, write: (f, t) => { w1.push(t); fs.writeFileSync(f, t); } });
    assert.strictEqual(small.handle(asBuf(body([tok('input', OPUS, 1, day)], [])), 'identity').status, 200, 'file cap: a small body fits');
    const fileBefore = fs.readFileSync(small.file, 'utf8');
    const big = []; for (let i = 0; i < 40; i++) big.push(tok('input', `big-model-${i}`, 1, day));
    assert.strictEqual(small.handle(asBuf(body(big, [])), 'identity').status, 507, 'file cap: a write that would pass the cap is refused');
    assert.strictEqual(fs.readFileSync(small.file, 'utf8'), fileBefore, 'file cap: the file keeps its data');
    assert.strictEqual(small.state.days['2026-11-07'].models[OPUS].input, 1, 'file cap: the sums in memory keep their data');
    assert.strictEqual(w1.length, 1, 'file cap: nothing was written for the refused body');
    small.release();

    // 3a. the write is atomic: a temporary file, then a rename over the file
    const d2 = path.join(tmp, 'atomic'); fs.mkdirSync(d2);
    const target = path.join(d2, 'usage-linux.json'); fs.writeFileSync(target, 'old');
    const realRename = fs.renameSync; const seen = [];
    fs.renameSync = (a2, b2) => { seen.push([a2, b2, fs.readFileSync(target, 'utf8'), fs.readFileSync(a2, 'utf8')]); return realRename(a2, b2); };
    try { R.atomicWrite(target, 'new', 'x1'); } finally { fs.renameSync = realRename; }
    assert.deepStrictEqual(seen.map((x) => [path.basename(x[0]), x[1], x[2], x[3]]), [['usage-linux.json.x1.tmp', target, 'old', 'new']], 'atomic: the new text is complete in a temporary file while the old file is whole, then renamed over it');
    assert.strictEqual(fs.readFileSync(target, 'utf8'), 'new', 'atomic: the file has the new text');
    // 3b. wx: a file (or link) already at the temporary name is never written through
    fs.writeFileSync(path.join(d2, 'planted'), 'secret');
    if (process.platform !== 'win32') fs.symlinkSync(path.join(d2, 'planted'), path.join(d2, 'usage-linux.json.x2.tmp'));
    else fs.writeFileSync(path.join(d2, 'usage-linux.json.x2.tmp'), 'planted');
    assert.throws(() => R.atomicWrite(target, 'new2', 'x2'), /EEXIST/, 'wx: an existing temporary name is refused');
    assert.strictEqual(fs.readFileSync(path.join(d2, 'planted'), 'utf8'), 'secret', 'wx: the planted target is untouched');
    assert.strictEqual(fs.readFileSync(target, 'utf8'), 'new', 'wx: the usage file is untouched');
    // 3c. folder modes: a new folder is 0700, the default-named existing one is tightened, another existing one is left alone
    if (process.platform !== 'win32') {
      const d3 = path.join(tmp, 'newdir', 'deep'); R.createService({ dir: d3, machine: 'linux' }).release();
      assert.strictEqual(fs.statSync(d3).mode & 0o077, 0, 'mode: a new folder is owner-only');
      const d4 = path.join(tmp, 'x', '.durbar-usage'); fs.mkdirSync(d4, { recursive: true, mode: 0o755 }); fs.chmodSync(d4, 0o755);
      R.createService({ dir: d4, machine: 'linux' }).release();
      assert.strictEqual(fs.statSync(d4).mode & 0o077, 0, 'mode: an existing .durbar-usage folder is tightened to owner-only');
      const d5 = path.join(tmp, 'shared'); fs.mkdirSync(d5, { mode: 0o755 }); fs.chmodSync(d5, 0o755);
      R.createService({ dir: d5, machine: 'linux' }).release();
      assert.strictEqual(fs.statSync(d5).mode & 0o777, 0o755, 'mode: another existing folder is not changed');
    }
    // 3d. per-point caps
    const st2 = lib.emptyState('linux');
    lib.ingest(st2, body([tok('input', OPUS, '1000000000001', day), tok('output', OPUS, '1000000000000', day)], [cost(OPUS, 1000001, day), cost(OPUS, 1000000, day)]), NOW);
    const m2 = st2.days['2026-11-07'].models[OPUS];
    assert.deepStrictEqual([m2.input, m2.output, m2.costUsd], [0, 1e12, 1e6], 'point cap: one past the token and the dollar cap is refused, the cap itself counts');
    // 3e. the file-size check, on both readers
    const big5 = path.join(tmp, 'big5.json'); fs.writeFileSync(big5, Buffer.alloc(lib.MAX_FILE_BYTES + 1, 0x20));
    assert.throws(() => R.loadState(big5, 'linux'), /not a usage file/, 'size check: the receiver refuses a file over the cap before reading it');
    assert.throws(() => D.readState(big5), /not a usage file/, 'size check: the report refuses a file over the cap before reading it');
    // 3f. the trial copy: a failed write changes nothing in memory, so a retry is counted once
    const d6 = path.join(tmp, 'trial'); let fail = true;
    const tsvc = R.createService({ dir: d6, machine: 'linux', now: () => NOW, write: (f, t) => { if (fail) throw new Error('disk'); fs.writeFileSync(f, t); } });
    assert.strictEqual(tsvc.handle(asBuf(sample), 'identity').status, 500, 'trial copy: a failed write answers 500');
    assert.deepStrictEqual(tsvc.state.days, {}, 'trial copy: a failed write changes nothing in memory');
    fail = false;
    assert.strictEqual(tsvc.handle(asBuf(sample), 'identity').status, 200, 'trial copy: the retry is accepted');
    assert.strictEqual(tsvc.state.days['2026-11-07'].models[OPUS].output, 50, 'trial copy: the retry is counted once');
    tsvc.release();
    // 4. lock: a second receiver on one folder and label is refused; the lock goes with the first; a dead process's lock is replaced
    const d7 = path.join(tmp, 'lock');
    const first = R.createService({ dir: d7, machine: 'linux' });
    assert.throws(() => R.createService({ dir: d7, machine: 'linux' }), /another receiver holds/, 'lock: a second receiver on the same folder and label is refused');
    R.createService({ dir: d7, machine: 'mac' }).release();
    first.release();
    R.createService({ dir: d7, machine: 'linux' }).release();
    fs.writeFileSync(path.join(d7, 'usage-linux.lock'), '2147483646\n');
    assert.doesNotThrow(() => R.createService({ dir: d7, machine: 'linux' }).release(), 'lock: the lock of a process that is gone is replaced');
    fs.writeFileSync(path.join(d7, 'usage-linux.lock'), 'junk\n');
    assert.throws(() => R.createService({ dir: d7, machine: 'linux' }), /another receiver holds/, 'lock: a lock file that is not a process id is not replaced');
    fs.unlinkSync(path.join(d7, 'usage-linux.lock'));
    assert.ok(!fs.existsSync(path.join(d7, 'usage-linux.lock')), 'lock: released');
    // skipped points are counted and printed
    const st3 = lib.emptyState('linux');
    lib.ingest(st3, body([tok('input', OPUS, 1, day)], [cost(OPUS, 1, day)], 2), NOW);
    assert.strictEqual(st3.skipped, 2, 'dropped: cumulative points are counted in the file state');
    assert.ok(/Dropped data points: 2\*\*/.test(lib.report([st3], '2026-11-07')) && /TEMPORALITY_PREFERENCE=delta/.test(lib.report([st3], '2026-11-07')), 'dropped: the report prints the count and the fix');
    assert.ok(/Dropped data points: 0\./.test(lib.report([lib.emptyState('linux')], '2026-11-07')), 'dropped: the report says zero when none');
    assert.strictEqual(lib.validateState(JSON.parse(JSON.stringify(st3))).skipped, 2, 'dropped: the count survives a restart');
  }

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
