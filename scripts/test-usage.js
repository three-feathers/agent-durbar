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
const NOW2 = Date.UTC(2026, 10, 8, 0, 5, 0); // 2026-11-08 00:05 UTC
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
  lib.ingest(st, body([tok('input', OPUS, 1, '2026-11-06T23:59:59Z'), tok('input', OPUS, 2, '2026-11-07T00:00:00Z'), tok('input', OPUS, 4, '2026-11-07T23:59:59Z')], []), NOW2);
  assert.strictEqual(st.days['2026-11-06'].models[OPUS].input, 1, 'day: 23:59:59Z belongs to the earlier UTC day');
  assert.strictEqual(st.days['2026-11-07'].models[OPUS].input, 6, 'day: 00:00:00Z and 23:59:59Z share one UTC day');
  assert.strictEqual(lib.dayOf(undefined, NOW), '2026-11-07', 'day: a missing time uses the receipt time');
  assert.strictEqual(lib.dayOf(nano('2026-11-05T11:59:59Z'), NOW), null, 'day: a time just over two days back is dropped');
  assert.strictEqual(lib.dayOf(nano('2019-01-01T00:00:00Z'), NOW), null, 'day: a time years back is dropped');
  assert.strictEqual(lib.dayOf(nano('2026-11-05T12:00:00Z'), NOW), '2026-11-05', 'day: a time exactly two days back counts');
  assert.strictEqual(lib.dayOf(nano('2026-11-07T12:05:01Z'), NOW), null, 'day: a time over five minutes ahead is dropped');
  assert.strictEqual(lib.dayOf(nano('2026-11-07T12:05:00Z'), NOW), '2026-11-07', 'day: a time five minutes ahead counts');
  assert.strictEqual(lib.dayOf(nano('2030-01-01T00:00:00Z'), NOW), null, 'day: a time years ahead is dropped');
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
  const mkst = (machine, iso, model, usdv, now = NOW) => { const s = lib.emptyState(machine); lib.ingest(s, body([], [cost(model, usdv, iso)]), now); return s; };
  const cum0 = lib.cumulative([], '2026-11-07', base);
  assert.strictEqual(cum0.total, 3758, 'cumulative: the baseline alone');
  const later = mkst('mac', '2026-11-09T10:00:00Z', 'claude-opus-5-5', 100, Date.UTC(2026, 10, 9, 12));
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
    const lf = (t) => t.replace(/\r\n/g, '\n'); // a Windows checkout may turn the fixture into CRLF
    assert.strictEqual(lf(text), lf(fs.readFileSync(f, 'utf8')), `golden: ${name} is unchanged (GOLDEN_WRITE=1 rewrites it)`);
  };
  assert.strictEqual(lib.chartSvg(hist), lib.chartSvg(hist), 'chart: deterministic');
  const chart = lib.chartSvg(hist);
  assert.ok(chart.includes('US$0') && chart.includes('US$8,000') && chart.includes('11-14 v0.1.14') && chart.includes('release date, UTC'), 'chart: labelled axes');
  assert.ok(chart.includes('API list-price estimate, not billing') && chart.includes('tabular-nums') && chart.includes('prefers-color-scheme:dark'), 'chart: label, tabular numbers, dark text');
  assert.ok(chart.includes('prefers-color-scheme:dark){.s0{fill:#388bfd}') && chart.includes('class="s0"'), 'chart: series colours have a lighter dark-mode value');
  golden('chart-three-rows.svg', lib.chartSvg(hist));
  golden('badge.svg', lib.badgeSvg(3758));
  {
    // CRLF: a CRLF copy of a fixture still compares equal; generated files hold LF only; a CRLF README is found and rewritten with CRLF throughout
    const fx = fs.readFileSync(path.join(__dirname, 'fixtures', 'build-cost', 'chart-three-rows.svg'), 'utf8').replace(/\r?\n/g, '\r\n');
    assert.ok(fx.includes('\r\n'), 'crlf: the copy has CRLF');
    assert.strictEqual(fx.replace(/\r\n/g, '\n'), lib.chartSvg(hist).replace(/\r\n/g, '\n'), 'crlf: a CRLF copy of the golden chart compares equal after normalising');
    assert.ok(!lib.chartSvg(hist).includes('\r') && !lib.badgeSvg(3758).includes('\r') && !block.includes('\r'), 'crlf: generated SVGs and the README block hold LF only');
    const crReadme = readme.replace(/\n/g, '\r\n');
    const crOnce = lib.rewriteReadme(crReadme, block);
    assert.ok(!/[^\r]\n/.test(crOnce) && crOnce.includes(lib.BEGIN) && crOnce.includes(lib.END), 'crlf: a CRLF README keeps CRLF on every line after the rewrite');
    assert.strictEqual(lib.rewriteReadme(crOnce, block), crOnce, 'crlf: a CRLF README rewrite is idempotent');
    assert.strictEqual(lib.rewriteReadme(readme, block).includes('\r'), false, 'crlf: an LF README stays LF');
  }
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
  const args = ['--release', 'v0.1.12', '--date', '2026-11-07', '--baseline', P('base.json'), '--readme', P('README.md'), '--history', P('h.json'), '--badge', P('b.svg'), '--chart', P('c.svg'), '--days', P('d.svg'), '--data', P('nodata'), '--spread', P('nospread.json'), '--files', P('none.json')];
  const mk2 = () => R2.build(R2.parseArgs(args.filter((a, i) => args[i - 1] !== '--files' && a !== '--files'), { DURBAR_USAGE_DIR: P('nodir') }, NOW));
  const r1 = mk2();
  assert.ok(r1.text.includes('About US$10**') && r1.history.rows.length === 1 && r1.badge.includes('US$10 ') && r1.chart.includes('<svg'), 'command: block, history, badge and chart from the baseline alone');
  assert.throws(() => R2.parseArgs(['--date', '2026-11-07'], {}, NOW), /--release/, 'command: --release required');
  fs.writeFileSync(P('README.md'), '# no markers\n');
  assert.throws(() => mk2(), /exactly one/, 'command: a README without markers fails');
  fs.rmSync(t2, { recursive: true, force: true });
}

// ---- spread of the unmeasured lump over the days it covers (FR-181 delta 2026-11-08) ----
{
  const S = require('./usage-spread');
  const R2 = require('./usage-readme');
  const { execFileSync } = require('child_process');
  const base = lib.validateBaseline({ version: 1, since: '2026-10-25', through: '2026-10-30', note: 'older work.', models: { 'claude-opus-5-5': 700.01, 'claude-sonnet-5-5': 300.02 }, machines: { linux: 1000.03 } });
  const stats = new Map([['2026-10-25', { lines: 100, prs: 1 }], ['2026-10-26', { lines: 300, prs: 3 }], ['2026-10-27', { lines: 0, prs: 0 }], ['2026-10-28', { lines: 600, prs: 6 }], ['2026-10-29', { lines: 7, prs: 0 }], ['2026-10-30', { lines: 1, prs: 1 }], ['2026-11-30', { lines: 5000, prs: 50 }]]);
  const meas = lib.emptyState('linux'); lib.ingest(meas, body([], [cost('claude-opus-5-5', 12.34, '2026-10-30T10:00:00Z'), cost('claude-sonnet-5-5', 5.67, '2026-10-30T10:00:00Z')]), Date.UTC(2026, 9, 30, 12));
  const sp = S.computeSpread(base, [meas], stats);
  const again = S.computeSpread(base, [meas], stats);
  assert.deepStrictEqual(sp, again, 'spread: deterministic (same input, same output)');
  assert.deepStrictEqual(sp.days.map((d) => d.date), ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29'], 'spread: only days without measured data; a day outside the range is not used');
  assert.ok(Math.abs(sp.days.reduce((a, d) => a + d.weight, 0) - 1) < 1e-8, 'spread: the weights sum to 1');
  const w = (d) => sp.days.find((x) => x.date === d).weight;
  assert.ok(w('2026-10-27') === 0 && w('2026-10-26') > w('2026-10-25'), 'spread: a day with no lines and no PRs gets weight 0, more work more weight');
  assert.ok(Math.abs(w('2026-10-26') - (0.5 * 300 / 1007 + 0.5 * 3 / 10)) < 1e-8, 'spread: weight = 50% share of lines + 50% share of PRs');
  for (const m of ['claude-opus-5-5', 'claude-sonnet-5-5']) {
    const got = sp.days.reduce((a, d) => a + d.cents[m], 0);
    assert.strictEqual(got, Math.round(base.models[m] * 100) - Math.round((m.includes('opus') ? 12.34 : 5.67) * 100), `spread: ${m} is preserved to the cent (lump minus what was measured)`);
  }
  const rows = S.dailyRows(sp, [meas], base, '2026-10-30');
  assert.strictEqual(rows.reduce((a, r) => a + r.estCents + r.measCents, 0), Math.round(lib.cumulative([meas], '2026-10-30', base).total * 100), 'spread: estimated plus measured is exactly the README total');
  const mrow = rows.find((r) => r.date === '2026-10-30');
  assert.deepStrictEqual([mrow.estCents, mrow.meas['claude-opus-5-5']], [0, 12.34], 'spread: a measured day keeps its real numbers and gets no estimate');
  assert.strictEqual(S.dailyRows(sp, [], base, '2026-10-30').length, 5, 'spread: without the measured data the days are the spread days');
  // another machine's measured days are its own: they add to the total, do not remove a spread day, and are not estimates
  const pv = lib.emptyState('paco-vps'); lib.ingest(pv, body([], [cost('claude-opus-5-5', 9, '2026-10-26T10:00:00Z')]), Date.UTC(2026, 9, 26, 12));
  assert.strictEqual(S.computeSpread(base, [meas, pv], stats).days.length, 5, 'machines: a teammate machine does not remove a spread day');
  assert.strictEqual(lib.cumulative([meas, pv], '2026-10-30', base).total, 1009.03, 'machines: its dollars are added from its first day');
  const rp = S.dailyRows(sp, [meas, pv], base, '2026-10-30');
  assert.strictEqual(rp.reduce((a, r) => a + r.estCents + r.measCents, 0), 100903, 'machines: the chart still equals the total');
  // an unlisted model measured inside the lump is deducted, so the total is kept
  const odd = lib.emptyState('linux'); lib.ingest(odd, body([], [cost('claude-haiku-9', 1.5, '2026-10-30T10:00:00Z')]), Date.UTC(2026, 9, 30, 12));
  assert.strictEqual(S.dailyRows(S.computeSpread(base, [odd], stats), [odd], base, '2026-10-30').reduce((a, r) => a + r.estCents + r.measCents, 0), 100003, 'spread: a model the lump does not list keeps the total');
  // all days measured: nothing to spread
  const full = lib.emptyState('linux'); for (const d of S.daysBetween('2026-10-25', '2026-10-30')) full.days[d] = { models: {} };
  assert.throws(() => S.computeSpread(base, [full], stats), /nothing to spread/, 'spread: no day left is an error');
  const none = S.computeSpread(base, [], new Map());
  assert.ok(none.days.every((d) => Math.abs(d.weight - 1 / 6) < 1e-8), 'spread: no history at all gives equal weights');
  // git history parsing
  const ns = '@2026-10-25\n10\t5\tsrc/a.ts\n-\t-\tdocs/p.png\n3\t4\tpackage-lock.json\n8\t0\tdocs/x.PNG\n2\t2\tdocs/build-cost-spread.json\n1\t1\tdist/x.js\n@2026-10-26\n7\t0\tREADME.md\n';
  assert.deepStrictEqual([...S.parseNumstat(ns)], [['2026-10-25', 15], ['2026-10-26', 7]], 'git: lines = added + deleted; lockfiles, binaries, pictures, generated and build-cost files are left out');
  const pr = '2026-10-25\tMerge pull request #5 from a/b\n2026-10-25\tFix a thing (#6)\n2026-10-25\tplain commit\n2026-10-26\tMerge branch main into x\n';
  assert.deepStrictEqual([...S.parsePrs(pr)], [['2026-10-25', 2]], 'git: merged PRs are merge commits and squash commits with (#N)');
  // the chart
  const svg = lib.chartDaysSvg(rows);
  assert.strictEqual(svg, lib.chartDaysSvg(rows), 'chart: deterministic');
  assert.ok(svg.includes('class="s0 est"') && svg.includes('class="s0"') && svg.includes('estimated (spread)') && svg.includes('solid = measured') && svg.includes('weighted 50% by lines changed') && svg.includes('prefers-color-scheme:dark'), 'chart: estimated bars are styled apart, with a legend and the weighting line');
  assert.ok(svg.includes('estimated') && !svg.includes('NaN'), 'chart: the text alternative names estimated days');
  assert.ok(!lib.chartDaysSvg(rows.filter((r) => r.estCents === 0)).includes('Estimate:'), 'chart: no estimate line when no day is estimated');
  assert.ok(lib.chartDaysSvg([]).includes('no days recorded yet'), 'chart: empty renders');
  // the command: a spread file makes the README note, the daily chart and an unchanged total; a spread that does not add up is refused
  const t3 = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-usage-spread-'));
  const Q = (...n) => path.join(t3, ...n);
  fs.writeFileSync(Q('README.md'), `${lib.BEGIN}\nold\n${lib.END}\n`); fs.writeFileSync(Q('base.json'), JSON.stringify({ version: 1, since: '2026-10-25', through: '2026-10-30', note: 'older work.', models: { 'claude-opus-5-5': 700.01, 'claude-sonnet-5-5': 300.02 }, machines: { linux: 1000.03 } }));
  fs.writeFileSync(Q('spread.json'), JSON.stringify(sp)); fs.mkdirSync(Q('data'));
  fs.writeFileSync(Q('data', 'usage-linux.json'), JSON.stringify(meas));
  const args3 = ['--release', 'v0.1.12', '--date', '2026-10-30', '--baseline', Q('base.json'), '--readme', Q('README.md'), '--history', Q('h.json'), '--badge', Q('b.svg'), '--chart', Q('c.svg'), '--days', Q('d.svg'), '--data', Q('data'), '--spread', Q('spread.json')];
  const r3 = R2.build(R2.parseArgs(args3, { DURBAR_USAGE_DIR: Q('nodir') }, NOW));
  assert.ok(r3.text.includes('About US$1,000**') && r3.text.includes('Estimated, not measured: US$') && r3.text.includes('docs/build-cost-days.svg') && r3.text.includes('an assumption') && r3.days.includes('<svg'), 'command: the README names the estimate, links the daily chart and states the model-mix assumption; the total is the baseline');
  fs.writeFileSync(Q('bad.json'), JSON.stringify({ ...sp, days: sp.days.map((d, i) => (i ? d : { ...d, cents: { 'claude-opus-5-5': d.cents['claude-opus-5-5'] + 500, 'claude-sonnet-5-5': d.cents['claude-sonnet-5-5'] } })) }));
  assert.throws(() => R2.build(R2.parseArgs(args3.map((a) => (a === Q('spread.json') ? Q('bad.json') : a)), { DURBAR_USAGE_DIR: Q('nodir') }, NOW)), /usage:spread/, 'command: a spread that does not add up to the total is refused');
  // publish: the receiver folder's file is copied (validated fields only) next to a teammate's committed file
  fs.mkdirSync(Q('home')); fs.writeFileSync(Q('home', 'usage-mac.json'), JSON.stringify({ ...pv, machine: 'mac', secretExtra: FAKE[0] }));
  const o4 = R2.parseArgs([...args3.filter((a, i) => args3[i - 1] !== '--data' && a !== '--data'), '--data', Q('data'), '--publish'], { DURBAR_USAGE_DIR: Q('home') }, NOW);
  R2.publish(o4);
  assert.deepStrictEqual(fs.readdirSync(Q('data')).sort(), ['usage-linux.json', 'usage-mac.json'], 'publish: one file per machine, committed files kept');
  assert.ok(!fs.readFileSync(Q('data', 'usage-mac.json'), 'utf8').includes(FAKE[0]), 'publish: unknown keys are not copied');
  fs.writeFileSync(Q('data', 'usage-bad.json'), JSON.stringify({ version: 1, machine: 'bad', days: { '2026-10-26': { models: { x: { input: -1 } } } } }));
  assert.throws(() => R2.build(R2.parseArgs(args3, { DURBAR_USAGE_DIR: Q('nodir') }, NOW)), /number is wrong/, 'data: a malformed committed usage file fails the build');
  fs.rmSync(t3, { recursive: true, force: true });

  // the committed files of THIS repo: every usage file is valid (another side's PR cannot break the release) and the spread adds up
  const repo = path.join(__dirname, '..');
  const dataDir = path.join(repo, 'docs', 'build-cost', 'data');
  const committed = fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : [];
  for (const n of committed) {
    assert.ok(/^usage-[A-Za-z0-9_-]+\.json$/.test(n), `repo data: ${n} must be named usage-<machine>.json`);
    const st = D.readState(path.join(dataDir, n)); // validateState: refuses a bad number, model or machine label
    assert.strictEqual(`usage-${st.machine}.json`, n, `repo data: ${n} holds its own machine label`);
  }
  const realBase = R2.readBaseline(path.join(repo, 'docs', 'build-cost-baseline.json'));
  const realSpread = R2.readSpread(path.join(repo, 'docs', 'build-cost-spread.json'));
  const realStates = S.readCommitted(dataDir, D.readState);
  const spreadSum = realSpread.days.reduce((a, d) => a + Object.values(d.cents).reduce((x, y) => x + y, 0), 0);
  const measSum = [...S.measuredOfBaseline(realStates, realBase).values()].reduce((a, slot) => a + Object.values(slot).reduce((x, y) => x + y, 0), 0);
  assert.strictEqual(spreadSum + measSum, Math.round(Object.values(realBase.models).reduce((a, b) => a + b, 0) * 100), 'repo data: the committed spread plus the measured days is the baseline to the cent (run "npm run usage:spread -- --write")');
  assert.ok(Math.abs(realSpread.days.reduce((a, d) => a + d.weight, 0) - 1) < 1e-8, 'repo data: the committed weights sum to 1');
  const committedSpread = JSON.parse(fs.readFileSync(path.join(repo, 'docs', 'build-cost-spread.json'), 'utf8'));
  let haveCommit = false; try { execFileSync('git', ['cat-file', '-e', `${committedSpread.commit}^{commit}`], { cwd: repo, stdio: 'ignore' }); haveCommit = /^[0-9a-f]{40}$/.test(committedSpread.commit); } catch { /* shallow clone: the pinned commit is not here, skipped */ }
  if (haveCommit) {
    const again2 = S.computeSpread(realBase, realStates, S.gitStats(committedSpread.commit, realBase.through), committedSpread.ref, committedSpread.commit);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(again2)), committedSpread, 'repo data: the committed spread is exactly what the pinned git history gives');
  }
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
    lib.ingest(st, body([tok('input', 'm-0', 1, '2026-11-06T10:00:00Z')], []), NOW);
    assert.ok(st.days['2026-11-06'].models['m-0'], 'models cap: the cap is per day');
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

  // ---- second review of #1251: days, lock races, signals, six more claims ----
  {
    const asBuf = (o) => Buffer.from(JSON.stringify(o));
    const day = '2026-11-07T10:00:00Z';
    // 4a. a body of only dropped points is still written (the silent-zero case)
    const dB = path.join(tmp, 'dropped');
    const sb = R.createService({ dir: dB, machine: 'linux', now: () => NOW });
    assert.strictEqual(sb.handle(asBuf(body([tok('input', OPUS, 1, day)], [cost(OPUS, 1, day)], 2)), 'identity').status, 200, 'dropped only: accepted');
    assert.ok(fs.existsSync(sb.file) && JSON.parse(fs.readFileSync(sb.file, 'utf8')).skipped === 2, 'dropped only: the count is written');
    // 4b. before each write the lock must still be ours; a stolen lock refuses and writes nothing
    const before = fs.readFileSync(sb.file, 'utf8');
    fs.writeFileSync(path.join(dB, 'usage-linux.lock'), '2147483646\n');
    assert.strictEqual(sb.handle(asBuf(sample), 'identity').status, 503, 'lock check: a write is refused when the lock is no longer ours');
    assert.strictEqual(fs.readFileSync(sb.file, 'utf8'), before, 'lock check: nothing is written');
    // 4d. a lock that is not ours is never released
    sb.release();
    assert.ok(fs.existsSync(path.join(dB, 'usage-linux.lock')), 'release: a lock that is not ours is left alone');
    fs.unlinkSync(path.join(dB, 'usage-linux.lock'));

    // 1. days: the attack of the review (60 days x 51 models per request, 7 requests) cannot fill the file, and real exports keep working
    const dA = path.join(tmp, 'attack');
    const svc = R.createService({ dir: dA, machine: 'linux', now: () => NOW });
    for (let n = 0; n < 7; n++) {
      const pts = []; for (let d = 0; d < 60; d++) for (let m = 0; m < 15; m++) pts.push(tok("input", `a-${m}`, 1, new Date(Date.UTC(2026, 0, 1 + n * 3 + (d % 3))).toISOString()));
      svc.handle(asBuf(body(pts, [])), 'identity');
    }
    assert.strictEqual(Object.keys(svc.state.days).length, 0, 'days: points older than two days are all dropped');
    assert.ok(svc.state.skipped >= 7 * 60 * 15, 'days: the dropped points are counted');
    assert.ok(!fs.existsSync(svc.file) || fs.statSync(svc.file).size < 100000, 'days: the file stays small after the attack');
    assert.strictEqual(svc.handle(asBuf(sample), 'identity').status, 200, 'days: a real export is still accepted after the attack');
    assert.strictEqual(svc.state.days['2026-11-07'].models[OPUS].output, 50, 'days: a real export is counted after the attack');
    // a request spanning more than four days, and a file at its day cap
    const st = lib.emptyState('linux');
    const spread = []; for (let h = 0; h < 6; h++) spread.push(tok('input', OPUS, 1, new Date(NOW - h * 86400000 / 3).toISOString()));
    const wide = lib.ingest(st, body(spread, []), NOW);
    assert.ok(Object.keys(st.days).length <= lib.MAX_DAYS_PER_REQUEST, 'days: at most four days per request');
    assert.ok(wide.tokens === 6, 'days: points on the days inside the window all count');
    const NOW3 = Date.UTC(2026, 10, 7, 23, 58, 0); const st4 = lib.emptyState('linux');
    lib.ingest(st4, body(['2026-11-05T23:58:30Z', '2026-11-06T12:00:00Z', '2026-11-07T12:00:00Z', '2026-11-08T00:02:00Z'].map((t) => tok('input', OPUS, 1, t)), []), NOW3);
    assert.strictEqual(Object.keys(st4.days).length, 4, 'days: the four dates of one window all count in one request');
    const full = lib.emptyState('linux');
    for (let i = 0; i < lib.MAX_DAYS_PER_FILE; i++) full.days[`d${i}`] = { models: {} };
    const r3 = lib.ingest(full, body([tok('input', OPUS, 1, day)], []), NOW);
    assert.deepStrictEqual([r3.tokens, r3.skipped], [0, 1], 'days: a new day past the file cap is dropped');
    full.days['2026-11-07'] = { models: {} }; delete full.days.d0;
    assert.strictEqual(lib.ingest(full, body([tok('input', OPUS, 1, day)], []), NOW).tokens, 1, 'days: a day already in the file still takes points at the cap');
    svc.release();

    // 2. the stale-lock race, deterministic: B takes over inside A's liveness check, then A takes over too; only the last one still holds it
    const dC = path.join(tmp, 'race'); fs.mkdirSync(dC); const lf = path.join(dC, 'usage-linux.lock');
    fs.writeFileSync(lf, '2147483646\n');
    let relB = null;
    const deadKill = () => { const e = new Error('gone'); e.code = 'ESRCH'; throw e; };
    let relA;
    try { relA = R.acquireLock(lf, { pid: 222222, kill: (p2) => { if (!relB) relB = R.acquireLock(lf, { pid: 111111, kill: deadKill }); return deadKill(p2); } }); } catch (e) { relA = null; }
    assert.ok(relB && relB.stillOurs() === false && relA && relA.stillOurs() === true, 'lock race: of two takers only the last one still holds the lock (the first sees it is not its own before writing)');
    assert.strictEqual(fs.readFileSync(lf, 'utf8').trim(), '222222', 'lock race: the lock holds the last taker');
    relA(); assert.ok(!fs.existsSync(lf), 'lock race: released');
    // a taker that is overwritten right after its rename fails when it reads the lock back
    fs.writeFileSync(lf, '2147483646\n');
    assert.throws(() => R.acquireLock(lf, { pid: 333333, kill: deadKill, afterRename: () => fs.writeFileSync(lf, '444444\n') }), /another receiver holds/, 'lock race: a taker overwritten after its rename reads the lock back and fails');
    fs.unlinkSync(lf);
    assert.deepStrictEqual(fs.readdirSync(dC), [], 'lock race: no temporary lock file is left');

    // 4b'. EPERM is a live process of another user: its lock is not taken
    fs.writeFileSync(lf, '555555\n');
    const epermKill = () => { const e = new Error('no'); e.code = 'EPERM'; throw e; };
    assert.throws(() => R.acquireLock(lf, { pid: 666666, kill: epermKill, uptime: 1e9 }), /another receiver holds/, 'lock: a live process of another user (EPERM) keeps its lock');
    // 3. a lock written before the last boot is stale even when its process id is alive now
    const liveKill = () => true;
    assert.throws(() => R.acquireLock(lf, { pid: 666666, kill: liveKill, uptime: 1e9 }), /another receiver holds/, 'lock: a live process with a lock from this boot keeps it');
    let rel; assert.doesNotThrow(() => { rel = R.acquireLock(lf, { pid: 666666, kill: liveKill, uptime: 1, now: () => Date.now() + 3600000 }); }, 'lock: a lock that predates the boot is replaced');
    assert.strictEqual(fs.readFileSync(lf, 'utf8').trim(), '666666', 'lock: a lock that predates the boot is replaced');
    assert.ok(R.predatesBoot(1000, 10 * 60000, 5 * 60) && !R.predatesBoot(9 * 60000, 10 * 60000, 5 * 60) && !R.predatesBoot(4.5 * 60000, 10 * 60000, 5 * 60), 'lock: predatesBoot compares with the boot time and a minute of slack');
    rel();
    // 4c. the lock file is owner-only
    if (process.platform !== 'win32') {
      const r4 = R.acquireLock(lf, { pid: 777777 });
      assert.strictEqual(fs.statSync(lf).mode & 0o077, 0, 'lock mode: the lock file is owner-only');
      r4();
    }
    // 3. signals release the lock and exit
    const { EventEmitter } = require('events');
    for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
      const fake = new EventEmitter(); const calls = []; fake.exit = (c) => calls.push(['exit', c]);
      R.installSignalHandlers(() => calls.push(['release']), fake);
      fake.emit(sig);
      assert.deepStrictEqual(calls, [['release'], ['exit', 0]], `signals: ${sig} releases the lock and then exits`);
    }
    // 4e. skipped is validated on load
    for (const bad of ['x', -1, null, NaN]) {
      assert.throws(() => lib.validateState({ version: 1, machine: 'linux', skipped: bad, days: {} }), /number is wrong/, `skipped: ${JSON.stringify(bad)} is refused on load`);
    }
    // 4f. the lock is released when the file cannot be loaded
    const dD = path.join(tmp, 'loadfail'); fs.mkdirSync(dD); fs.writeFileSync(path.join(dD, 'usage-linux.json'), '{"oops":1}');
    assert.throws(() => R.createService({ dir: dD, machine: 'linux' }), /not a usage file/, 'load failure: the receiver stops');
    assert.ok(!fs.existsSync(path.join(dD, 'usage-linux.lock')), 'load failure: the lock is released');
  }

  // ---- third review of #1251: the loser exits, L3, L8, L9, S4 ----
  {
    const asBuf = (o) => Buffer.from(JSON.stringify(o));
    const { spawn } = require('child_process');
    const deadKill = () => { const e = new Error('gone'); e.code = 'ESRCH'; throw e; };
    // L3. a 503 (lock lost) leaves memory unchanged, and reports the holder so the receiver can exit
    const dL = path.join(tmp, 'l3');
    const sv = R.createService({ dir: dL, machine: 'linux', now: () => NOW });
    const snap = JSON.stringify([sv.state.days, sv.state.skipped]);
    fs.writeFileSync(path.join(dL, 'usage-linux.lock'), '2147483646\n');
    const r503 = sv.handle(asBuf(sample), 'identity');
    assert.strictEqual(r503.status, 503, 'L3: the lock is lost');
    assert.strictEqual(JSON.stringify([sv.state.days, sv.state.skipped]), snap, 'L3: a 503 leaves the sums in memory unchanged');
    assert.strictEqual(r503.lockLost, '2147483646', 'L3: the answer names the holder of the lock');
    // the loser of the deterministic distinct-pid race is told to leave (hook stands in for the exit)
    const dR = path.join(tmp, 'l-race'); fs.mkdirSync(dR); const lfR = path.join(dR, 'usage-linux.lock');
    fs.writeFileSync(lfR, '2147483646\n');
    let rB = null;
    const rA = R.acquireLock(lfR, { pid: 222222, kill: (p2) => { if (!rB) rB = R.acquireLock(lfR, { pid: 111111, kill: deadKill }); return deadKill(p2); } });
    assert.ok(rB && rA && !rB.stillOurs() && rA.stillOurs() && rB.holder() === '222222', 'lock race: the loser can name the winner');
    rA();

    // L8, L9. takeover is temp file plus rename, owner-only, and a symlink at the lock path is replaced, not followed
    if (process.platform !== 'win32') {
      const dS = path.join(tmp, 'l8'); fs.mkdirSync(dS);
      const target = path.join(dS, 'target.txt'); const lfS = path.join(dS, 'usage-linux.lock');
      fs.writeFileSync(target, '2147483646\n');
      let linked = true; try { fs.symlinkSync(target, lfS); } catch { linked = false; }
      assert.ok(linked, 'L8: a symlink could be made for the test');
      const renames = []; const realRename = fs.renameSync;
      fs.renameSync = (a, b) => { renames.push([a, b]); return realRename(a, b); };
      let relS; const oldUmask = process.umask(0o022);
      try { relS = R.acquireLock(lfS, { pid: 888888, kill: deadKill }); } finally { fs.renameSync = realRename; process.umask(oldUmask); }
      assert.strictEqual(renames.length, 1, 'L8: takeover renames one temporary file over the lock');
      assert.ok(renames[0][1] === lfS && /\.tmp$/.test(renames[0][0]) && renames[0][0] !== lfS, 'L8: takeover renames a temporary file over the lock path');
      assert.strictEqual(fs.readFileSync(target, 'utf8'), '2147483646\n', 'L8: takeover never writes through a symlink at the lock path');
      assert.ok(!fs.lstatSync(lfS).isSymbolicLink() && fs.readFileSync(lfS, 'utf8').trim() === '888888', 'L8: the symlink is replaced by a real lock file');
      assert.strictEqual(fs.lstatSync(lfS).mode & 0o077, 0, 'L9: the takeover file is owner-only even with a 022 umask');
      relS();
    }

    // the real receiver as a child process (no shell): a lost lock exits 1 with one stderr line; SIGTERM removes the lock and exits 0
    const startChild = (dir) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(__dirname, 'usage-receiver.js'), '--port', '0', '--dir', dir], { env: { ...process.env, DURBAR_USAGE_MACHINE: 'linux' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let out = ''; let err = '';
      child.stderr.on('data', (c) => { err += c; });
      child.once('error', reject);
      const done = new Promise((res) => child.once('exit', (code, signal) => res({ code, signal, err })));
      child.stdout.on('data', (c) => { out += c; const m = /127\.0\.0\.1:(\d+)/.exec(out); if (m) resolve({ child, port: Number(m[1]), done }); });
      done.then(() => reject(new Error(`child exited early: ${err}`)));
    });
    const dX = path.join(tmp, 'child-lost'); const c1 = await startChild(dX);
    fs.writeFileSync(path.join(dX, 'usage-linux.lock'), '2147483646\n');
    const rr = await post(c1.port, JSON.stringify(sample));
    assert.strictEqual(rr.status, 503, 'loser: the receiver whose lock was taken answers 503');
    const fin = await withTimeout(c1.done, 5000, 'loser: the receiver did not exit after losing the lock').catch((e) => { c1.child.kill('SIGKILL'); throw e; });
    assert.strictEqual(fin.code, 1, 'loser: exits non-zero when the lock is lost');
    assert.strictEqual(fin.err.trim(), 'usage-receiver: lock lost to pid 2147483646, exiting', 'loser: one stderr line names the new holder');
    assert.strictEqual(fs.readFileSync(path.join(dX, 'usage-linux.lock'), 'utf8').trim(), '2147483646', 'loser: the lock that is not ours is left alone');

    // a lock holding text with a line break never reaches stderr: the holder shows as "unknown"
    const dY = path.join(tmp, 'child-fake'); const c3 = await startChild(dY);
    fs.writeFileSync(path.join(dY, 'usage-linux.lock'), '1\nusage-receiver: FAKE LINE\n');
    assert.strictEqual((await post(c3.port, JSON.stringify(sample))).status, 503, 'sanitiser: the lock is lost');
    const f3 = await withTimeout(c3.done, 5000, 'sanitiser: the receiver did not exit').catch((e) => { c3.child.kill('SIGKILL'); throw e; });
    assert.strictEqual(f3.err.trim(), 'usage-receiver: lock lost to pid unknown, exiting', 'sanitiser: a holder that is not a plain number prints as unknown, one line only');

    if (process.platform === 'win32') {
      console.log('test-usage: SIGTERM check skipped on Windows (POSIX signals do not apply the same way; spec 008 FR-181 KNOWN GAP)');
    } else {
      const dT = path.join(tmp, 'child-term'); const c2 = await startChild(dT);
      assert.ok(fs.existsSync(path.join(dT, 'usage-linux.lock')), 'S4: the real receiver holds its lock while running');
      c2.child.kill('SIGTERM');
      const f2 = await withTimeout(c2.done, 5000, 'S4: the real receiver did not exit on SIGTERM').catch((e) => { c2.child.kill('SIGKILL'); throw e; });
      assert.strictEqual(f2.code, 0, 'S4: SIGTERM ends the real receiver cleanly (exit 0)');
      assert.ok(!fs.existsSync(path.join(dT, 'usage-linux.lock')), 'S4: SIGTERM removes the lock in the real receiver');
    }
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
