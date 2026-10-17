/** Credit cap helpers and settings store (spec 011), no credits: `npm run test:credits`. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MAX_CAP, MIN_CAP, fmtAiu, parseAmount, parseCap, parseSettings } from '../src/shared/credits';
import { SettingsStore } from '../src/main/settings';

assert.strictEqual(MIN_CAP, 30, 'the runtime refuses caps below 30 AI credits');
assert.strictEqual(parseCap(30), 30);
assert.strictEqual(parseCap('45.5'), 45.5);
assert.strictEqual(parseCap(30.126), 30.13);
assert.strictEqual(parseCap(MAX_CAP), MAX_CAP);
for (const bad of [29.99, 0.5, 0, -1, NaN, Infinity, MAX_CAP + 1, '', '  ', 'abc', null, undefined, {}, [], true, '1e400']) assert.strictEqual(parseCap(bad), undefined, String(bad));
assert.strictEqual(parseAmount('0.5'), 0.5);
assert.strictEqual(parseAmount(100), 100);
for (const bad of [0, -2, 0.001, NaN, '', 'x', MAX_CAP + 1, null]) assert.strictEqual(parseAmount(bad), undefined, String(bad));

assert.deepStrictEqual(parseSettings('{"defaultMaxAiCredits":75}'), { defaultMaxAiCredits: 75 });
for (const bad of ['', 'not json', 'null', '[]', '{"defaultMaxAiCredits":-3}', '{"defaultMaxAiCredits":5}', '{"defaultMaxAiCredits":"x"}']) assert.deepStrictEqual(parseSettings(bad), {}, bad);

assert.strictEqual(fmtAiu(120_000_000), '0.12');
assert.strictEqual(fmtAiu(120_000_000, 3), '0.120');
for (const bad of [undefined, null, NaN, -5, 'x', Infinity]) assert.strictEqual(fmtAiu(bad), '-', 'never NaN: ' + String(bad));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-settings-'));
try {
  const file = path.join(dir, 'sub', 'durbar-settings.json');
  const st = new SettingsStore(file);
  assert.deepStrictEqual(st.load(), {}, 'missing file');
  assert.strictEqual(st.setDefaultMaxAiCredits('75'), 75);
  assert.strictEqual(new SettingsStore(file).load().defaultMaxAiCredits, 75, 'survives a restart');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { version: 1, defaultMaxAiCredits: 75 }, 'numbers only on disk');
  assert.strictEqual(st.setDefaultMaxAiCredits(''), undefined);
  assert.strictEqual(new SettingsStore(file).load().defaultMaxAiCredits, undefined, 'cleared');
  assert.strictEqual(fs.readdirSync(path.dirname(file)).filter((n) => n.endsWith('.tmp')).length, 0);
  fs.writeFileSync(file, '{{{');
  assert.deepStrictEqual(new SettingsStore(file).load(), {}, 'corrupt file');
  new SettingsStore(path.join(file, 'x', 'y.json')).setDefaultMaxAiCredits(50); // unwritable: no throw

  // spec 024 FR-007: the place mapping lives in the same file and survives cap changes (and the other way round)
  const f2 = path.join(dir, 'places', 'durbar-settings.json');
  const ps = new SettingsStore(f2);
  assert.deepStrictEqual({ ...ps.placeMap }, {}, 'no mapping yet');
  assert.deepStrictEqual(ps.setPlace('acme-tools', 'library'), { ok: true, placeMap: { 'acme-tools': 'library' } });
  assert.strictEqual(ps.setDefaultMaxAiCredits(90), 90);
  assert.deepStrictEqual({ ...ps.placeMap }, { 'acme-tools': 'library' }, 'changing the cap keeps the mapping');
  assert.strictEqual(ps.setDefaultMaxAiCredits(''), undefined);
  assert.deepStrictEqual({ ...ps.placeMap }, { 'acme-tools': 'library' }, 'clearing the cap keeps the mapping');
  assert.ok(ps.setPlace('github', 'desk').ok);
  assert.strictEqual(ps.setDefaultMaxAiCredits(40), 40);
  const back = new SettingsStore(f2); back.load();
  assert.deepStrictEqual({ ...back.placeMap }, { 'acme-tools': 'library', github: 'desk' }, 'the mapping survives a restart');
  assert.strictEqual(back.defaultMaxAiCredits, 40, 'and the cap too');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(f2, 'utf8')), { version: 1, defaultMaxAiCredits: 40, placeMap: { 'acme-tools': 'library', github: 'desk' } }, 'server names and place ids only on disk');
  assert.deepStrictEqual(back.setPlace('github', 'moon'), { ok: false, placeMap: { 'acme-tools': 'library', github: 'desk' } }, 'unknown place: refused, unchanged');
  assert.strictEqual(back.setPlace('', 'web').ok, false);
  assert.strictEqual(back.setPlace('__proto__', 'web').ok, false);
  assert.strictEqual(back.setPlace('x'.repeat(201), 'web').ok, false);
  assert.deepStrictEqual(back.setPlace('github', null), { ok: true, placeMap: { 'acme-tools': 'library' } }, 'null clears one entry');
  assert.deepStrictEqual(back.setPlace('acme-tools', null).placeMap, {}, 'last entry cleared');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(f2, 'utf8')), { version: 1, defaultMaxAiCredits: 40 }, 'an empty mapping is not written');
  const copy = back.placeMap; (copy as Record<string, string>).sneaky = 'web';
  assert.deepStrictEqual({ ...back.placeMap }, {}, 'the getter returns a copy');
  fs.writeFileSync(f2, JSON.stringify({ version: 1, placeMap: { ok: 'web', bad: 'moon', n: 5 }, defaultMaxAiCredits: 'x' }));
  const odd = new SettingsStore(f2); odd.load();
  assert.deepStrictEqual({ ...odd.placeMap }, { ok: 'web' }, 'a hand-edited file keeps only valid entries');
  assert.deepStrictEqual({ ...parseSettings('{"placeMap":{"a":"web"}}').placeMap }, { a: 'web' });
  assert.deepStrictEqual(parseSettings('{"placeMap":"x"}'), {}, 'a mapping that is not an object is ignored');
  assert.deepStrictEqual(parseSettings('{"defaultMaxAiCredits":75,"placeMap":{}}'), { defaultMaxAiCredits: 75 }, 'an empty mapping is omitted');

  // spec 034 FR-004: Serious mode lives in the same file, off by default, and survives cap and mapping changes
  const f3 = path.join(dir, 'serious', 'durbar-settings.json');
  const ss = new SettingsStore(f3); ss.load();
  assert.strictEqual(ss.seriousMode, false, 'off by default (the fun is on)');
  assert.strictEqual(ss.setSeriousMode(true), true); assert.strictEqual(ss.seriousMode, true);
  assert.ok(ss.setPlace('acme-tools', 'library').ok); assert.strictEqual(ss.setDefaultMaxAiCredits(60), 60);
  const sb = new SettingsStore(f3); sb.load();
  assert.strictEqual(sb.seriousMode, true, 'kept after a restart, a cap change and a mapping change');
  assert.deepStrictEqual({ ...sb.placeMap }, { 'acme-tools': 'library' }); assert.strictEqual(sb.defaultMaxAiCredits, 60);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(f3, 'utf8')), { version: 1, defaultMaxAiCredits: 60, placeMap: { 'acme-tools': 'library' }, seriousMode: true });
  for (const junk of ['yes', 1, 0, null, undefined, {}, []]) assert.strictEqual(sb.setSeriousMode(junk), true, 'only a boolean changes it: ' + String(junk));
  assert.strictEqual(sb.setSeriousMode(false), false); assert.strictEqual(sb.seriousMode, false);
  assert.ok(!('seriousMode' in JSON.parse(fs.readFileSync(f3, 'utf8'))), 'off is not written');
  assert.strictEqual(sb.setDefaultMaxAiCredits(''), undefined); assert.deepStrictEqual({ ...sb.placeMap }, { 'acme-tools': 'library' }, 'clearing the cap keeps the mapping');
  assert.strictEqual(sb.setSeriousMode(true), true); assert.strictEqual(sb.setDefaultMaxAiCredits(70), 70); assert.strictEqual(sb.seriousMode, true, 'a cap change keeps Serious mode');
  assert.deepStrictEqual(parseSettings('{"seriousMode":true}'), { seriousMode: true });
  for (const bad of ['"yes"', '1', '0', 'null', '[]', '{}', '"true"', '{"seriousMode":"true"}', '{"seriousMode":1}', '{"seriousMode":false}']) assert.deepStrictEqual(parseSettings(bad.startsWith('{') ? bad : '{"seriousMode":' + bad + '}'), {}, 'only true is kept: ' + bad);

} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('credits: all checks passed');
