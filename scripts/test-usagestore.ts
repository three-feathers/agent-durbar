/** All-time usage store on disk (spec 020 FR-004, FR-007): `npm run test:usagestore`. No Electron, no credits. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { UsageStore } from '../src/main/usagestore';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-usage-'));
const file = path.join(dir, 'sub', 'durbar-tool-usage.json');
const start = (tool: string, extra: Record<string, unknown> = {}) => ({ type: 'toolCall', phase: 'start', tool, callId: 'c', args: { secret: 'ARG-SECRET' }, output: 'OUT-SECRET', ...extra });

// fake timers: nothing is written until the debounce fires
const t: { fn?: () => void } = {};
let cleared = 0;
const opts = { setTimer: (fn: () => void) => { t.fn = fn; return 1; }, clearTimer: () => { cleared++; t.fn = undefined; }, now: () => new Date('2026-10-16T08:00:00Z') };

const a = new UsageStore(file, opts);
a.load(); // missing file: empty
assert.strictEqual(a.view().since, '2026-10-16T08:00:00.000Z');
a.record('Ada · app', { type: 'status' });
assert.ok(!(t as { fn?: unknown }).fn, 'a non-counting event schedules nothing');
a.record('Ada · app', start('bash'));
a.record('Ada · app', start('bash'));
a.record('Mira · app', start('gh-issues', { mcpServer: 'github', mcpTool: 'issues' }));
assert.ok((t as { fn?: unknown }).fn, 'a write is scheduled');
assert.ok(!fs.existsSync(file), 'debounced: nothing on disk yet');
(t as { fn?: () => void }).fn?.();
assert.ok(fs.existsSync(file), 'timer fired: written');
assert.ok(!fs.existsSync(file + '.tmp'), 'atomic write leaves no tmp file');
const text = fs.readFileSync(file, 'utf8');
for (const bad of ['ARG-SECRET', 'OUT-SECRET', 'callId']) assert.ok(!text.includes(bad), 'no arguments/output on disk: ' + bad);
if (process.platform !== 'win32') assert.strictEqual(fs.statSync(file).mode & 0o077, 0, 'file is private (0600)');

// survives a restart
a.record('Ada · app', start('bash'));
a.flush();
assert.ok(cleared >= 1, 'flush cancels the pending timer');
const b = new UsageStore(file, opts);
b.load();
assert.strictEqual(b.view().tools['builtin:bash'].calls, 3);
assert.strictEqual(b.view().servers.github.calls, 1);
assert.strictEqual(b.view().agents['Mira · app'].tools['mcp:github/issues'].calls, 1);
assert.strictEqual(b.view().since, '2026-10-16T08:00:00.000Z', 'since is kept');
b.record('Ada · app', start('bash'));
b.flush();
const c = new UsageStore(file); c.load();
assert.strictEqual(c.view().tools['builtin:bash'].calls, 4, 'counts keep adding up across restarts');

// view is a copy
const v = c.view(); v.tools['builtin:bash'].calls = 999;
assert.strictEqual(c.view().tools['builtin:bash'].calls, 4);

// reset
c.reset();
assert.deepStrictEqual(Object.keys(c.view().tools), []);
const d = new UsageStore(file); d.load();
assert.deepStrictEqual(Object.keys(d.view().tools), [], 'reset is on disk too');

// corrupt, oversized and wrong-shaped files = empty, never a crash
for (const content of ['not json', '[]', 'null', '{"tools":"x","agents":5}', '\u0000\u0000']) {
  fs.writeFileSync(file, content);
  const e = new UsageStore(file); e.load();
  assert.deepStrictEqual(Object.keys(e.view().tools), [], content);
  e.record('x', start('bash')); // still usable
  assert.strictEqual(e.view().tools['builtin:bash'].calls, 1);
}
fs.writeFileSync(file, ' '.repeat(2 * 1024 * 1024 + 1));
const big = new UsageStore(file); big.load();
assert.deepStrictEqual(Object.keys(big.view().agents), []);

// an unwritable location does not throw and keeps counting
const blocked = new UsageStore(path.join(dir, 'a-file', 'x.json'), opts);
fs.writeFileSync(path.join(dir, 'a-file'), 'x');
blocked.record('x', start('bash'));
blocked.flush();
assert.ok(blocked.lastError, 'write error is reported, not thrown');
assert.strictEqual(blocked.view().tools['builtin:bash'].calls, 1);

fs.rmSync(dir, { recursive: true, force: true });
console.log('usagestore: all checks passed');
