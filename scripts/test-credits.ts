/** Credit cap helpers and settings store (spec 011), no credits: `npm run test:credits`. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MAX_CAP, fmtAiu, parseCap, parseSettings } from '../src/shared/credits';
import { SettingsStore } from '../src/main/settings';

assert.strictEqual(parseCap(0.5), 0.5);
assert.strictEqual(parseCap('2'), 2);
assert.strictEqual(parseCap(' 0.0004 '), undefined, 'rounds to 0 at 3 decimals: no cap');
assert.strictEqual(parseCap(0.1234567), 0.123);
assert.strictEqual(parseCap(MAX_CAP), MAX_CAP);
for (const bad of [0, -1, NaN, Infinity, MAX_CAP + 1, '', '  ', 'abc', null, undefined, {}, [], true, '1e400']) assert.strictEqual(parseCap(bad), undefined, String(bad));

assert.deepStrictEqual(parseSettings('{"defaultMaxAiCredits":1.5}'), { defaultMaxAiCredits: 1.5 });
for (const bad of ['', 'not json', 'null', '[]', '{"defaultMaxAiCredits":-3}', '{"defaultMaxAiCredits":"x"}']) assert.deepStrictEqual(parseSettings(bad), {}, bad);

assert.strictEqual(fmtAiu(120_000_000), '0.12');
assert.strictEqual(fmtAiu(120_000_000, 3), '0.120');
for (const bad of [undefined, null, NaN, -5, 'x', Infinity]) assert.strictEqual(fmtAiu(bad), '-', 'never NaN: ' + String(bad));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-settings-'));
try {
  const file = path.join(dir, 'sub', 'durbar-settings.json');
  const st = new SettingsStore(file);
  assert.deepStrictEqual(st.load(), {}, 'missing file');
  assert.strictEqual(st.setDefaultMaxAiCredits('0.75'), 0.75);
  assert.strictEqual(new SettingsStore(file).load().defaultMaxAiCredits, 0.75, 'survives a restart');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { version: 1, defaultMaxAiCredits: 0.75 }, 'numbers only on disk');
  assert.strictEqual(st.setDefaultMaxAiCredits(''), undefined);
  assert.strictEqual(new SettingsStore(file).load().defaultMaxAiCredits, undefined, 'cleared');
  assert.strictEqual(fs.readdirSync(path.dirname(file)).filter((n) => n.endsWith('.tmp')).length, 0);
  fs.writeFileSync(file, '{{{');
  assert.deepStrictEqual(new SettingsStore(file).load(), {}, 'corrupt file');
  new SettingsStore(path.join(file, 'x', 'y.json')).setDefaultMaxAiCredits(1); // unwritable: no throw
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('credits: all checks passed');
