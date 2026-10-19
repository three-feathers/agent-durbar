/** Cost per folder (spec 052 FR-044, #315): rows, sort, total and CSV: `npm run test:costtable`. No credits spent. */
import * as assert from 'assert';
import * as path from 'path';
type Row = { name: string; money: number; aiu: number; usd: number; calls: number; tokens: number; empty: boolean; other: boolean; tokensOnly: boolean; unreported: number };
type Built = { rows: Row[]; total: Row };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const C = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'costtable.js')) as {
  AIU_USD: number;
  build: (list: unknown, office?: unknown) => Built;
  notReported: (r: Row) => boolean;
  money: (v: number) => string;
  csvField: (v: unknown) => string;
  toCsv: (b: Built, period: string) => string;
  CSV_COLUMNS: string[];
};
const AIU = 1e9;

// money = credits x 0.01 + Claude estimate; sorted by money, high to low; empty folders last
const b = C.build([
  { id: 'a', name: 'alpha', nano: 2 * AIU, calls: 4, unreported: 0, usd: 0, tokens: 100 },
  { id: 'e', name: 'empty', nano: 0, calls: 0, unreported: 0, usd: 0, tokens: 0 },
  { id: 'c', name: 'claude', nano: 0, calls: 2, unreported: 2, usd: 0.5, tokens: 900 },
  { id: 'x', name: 'codex', nano: 0, calls: 3, unreported: 3, usd: 0, tokens: 50, tokensOnly: true },
], { nano: 2 * AIU, calls: 9, unreported: 5 });
assert.deepStrictEqual(b.rows.map((r) => r.name), ['claude', 'alpha', 'codex', 'empty']);
assert.strictEqual(b.rows[1].money, 0.02);
assert.strictEqual(b.rows[0].money, 0.5);
assert.ok(b.rows[3].empty && !b.rows[0].empty);
assert.ok(b.rows[2].tokensOnly && b.total.tokensOnly);
assert.strictEqual(b.total.calls, 9);
assert.strictEqual(b.total.tokens, 1050);
assert.ok(Math.abs(b.total.money - 0.52) < 1e-12);
// cost not reported (never $0.00) only when no call reported credits and there is no Claude estimate
assert.ok(C.notReported(b.rows[2]));
assert.ok(!C.notReported(b.rows[0]) && !C.notReported(b.rows[1]) && !C.notReported(b.rows[3]));

// calls of folders no longer listed: one "other" row so the total stays the office total
const o = C.build([{ id: 'a', name: 'a', nano: AIU, calls: 1 }], { nano: 3 * AIU, calls: 4, unreported: 0 });
assert.strictEqual(o.rows.length, 2);
assert.ok(o.rows[0].other && o.rows[0].calls === 3 && o.rows[0].aiu === 2);
assert.strictEqual(o.total.calls, 4);
assert.strictEqual(C.build([{ id: 'a', name: 'a', nano: AIU, calls: 1 }], { nano: AIU, calls: 1 }).rows.length, 1);

// odd input counts as 0 and never throws
const bad = C.build([null, { id: 1, name: 'n', nano: -5, calls: NaN, usd: Infinity, tokens: '9' }], null);
assert.strictEqual(bad.rows.length, 1);
assert.strictEqual(bad.rows[0].money, 0);
assert.ok(bad.rows[0].empty);
assert.strictEqual(C.build(undefined).rows.length, 0);

// money text
assert.strictEqual(C.money(0), '$0.00');
assert.strictEqual(C.money(0.004), '<$0.01');
assert.strictEqual(C.money(1.234), '$1.23');

// CSV fields: RFC 4180 quoting
assert.strictEqual(C.csvField('plain'), '"plain"');
assert.strictEqual(C.csvField('say "hi"'), '"say ""hi"""');
assert.strictEqual(C.csvField('a,b\r\nc'), '"a,b\r\nc"');
assert.strictEqual(C.csvField(null), '""');
assert.strictEqual(C.csvField(12), '"12"');
// formula neutralising: a leading apostrophe for =, +, -, @, tab, CR
assert.strictEqual(C.csvField('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
assert.strictEqual(C.csvField('+1'), '"\'+1"');
assert.strictEqual(C.csvField('-2+3'), '"\'-2+3"');
assert.strictEqual(C.csvField('@SUM(A1)'), '"\'@SUM(A1)"');
assert.strictEqual(C.csvField('\tx'), '"\'\tx"');
assert.strictEqual(C.csvField('a=b'), '"a=b"');

// the whole CSV: header, rows in table order, total, CRLF
const csv = C.toCsv(C.build([
  { id: 'a', name: '=evil', nano: 2 * AIU, calls: 4, usd: 0.25, tokens: 1234 },
  { id: 'b', name: 'my "app"', nano: 0, calls: 0 },
]), 'Since 2026-10-01');
const lines = csv.split('\r\n');
assert.strictEqual(lines[0], C.CSV_COLUMNS.map((c) => '"' + c + '"').join(','));
assert.strictEqual(lines[0], '"folder","money_usd_estimate","copilot_aiu","claude_usd_estimate","tokens","calls","period"');
assert.strictEqual(lines[1], '"\'=evil","0.2700","2.000","0.2500","1234","4","Since 2026-10-01"');
assert.strictEqual(lines[2], '"my ""app""","0.0000","0.000","0.0000","0","0","Since 2026-10-01"');
assert.strictEqual(lines[3], '"Total","0.2700","2.000","0.2500","1234","4","Since 2026-10-01"');
assert.strictEqual(lines[4], '');
assert.strictEqual(lines.length, 5);
assert.strictEqual(C.toCsv(C.build([]), 'This run').split('\r\n').length, 3);

console.log('test-costtable: ok');
