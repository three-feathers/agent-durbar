/* Spec 102 T093 (card half), FR-014, FR-016: every picture world has worlds/<id>/card.json with the ten items of FR-014, and no two
   worlds share an arrangement, monitor, mood, wall, floor, desk, fixture style, plants or motif (normalised text), or have light
   temperatures under 200 K apart. A card cannot prove its picture matches (FR-017); the hash checks, the packer, the availability gates
   (T036) and the contact sheet (T094) are not here yet.
   DURBAR_WORLDS_DIR points the check at another folder (the mutant runs use it). */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const WORLDS = process.env.DURBAR_WORLDS_DIR || path.join(ROOT, 'worlds');
const IN_REPO = path.join(ROOT, 'src', 'renderer', 'realoffice', 'worlds');

const { TEXT_FIELDS, cardProblems, judge, loadKnown, readCards, staleKnown } = require('./world-cards');

const mk = (id, over) => ({ formatVersion: 1, id, arrangement: `arr ${id}`, monitor: `mon ${id}`, light: [3000 + (id.charCodeAt(0) % 10) * 1000], mood: `mood ${id}`, wall: `wall ${id}`, floor: `floor ${id}`, desk: `desk ${id}`, fixtureStyle: `fix ${id}`, plants: `plant ${id}`, motif: `motif ${id}`, 'distinct-check': { state: 'pending' }, ...over });

/* Fixtures: each failure is found, by name (FR-016). */
{
  const a = mk('a'); const b = mk('b');
  assert.deepStrictEqual(judge({ a, b }, []).fails, [], 'two different cards pass');
  for (const f of TEXT_FIELDS) {
    const r = judge({ a, b: mk('b', { [f]: `  ${a[f].toUpperCase()}! ` }) }, []);
    assert.deepStrictEqual(r.fails, [`a and b share the same ${f}`], `a shared ${f} fails, named, in normalised text`);
  }
  assert.deepStrictEqual(judge({ a, b: mk('b', { light: [a.light[0] + 150] }) }, []).fails, ['a and b share a light temperature within 200 K'], '150 K apart fails');
  assert.deepStrictEqual(judge({ a, b: mk('b', { light: [a.light[0] + 200] }) }, []).fails, [], '200 K apart passes');
  assert.strictEqual(judge({ a, b: mk('b', { light: [9000, a.light[0] - 199] }) }, []).fails.length, 1, 'any of a world\'s lights counts');
  const known = [{ pair: ['a', 'b'], field: 'arrangement' }];
  const sa = mk('b', { arrangement: a.arrangement });
  assert.deepStrictEqual(judge({ a, b: sa }, known).fails, [], 'a named pair and field is only reported');
  assert.strictEqual(judge({ a, b: sa }, known).reported.length, 1);
  assert.strictEqual(judge({ a, b: mk('b', { arrangement: a.arrangement, monitor: a.monitor }) }, known).fails.length, 1, 'the list does not swallow another field');
  assert.strictEqual(judge({ a, c: mk('c', { arrangement: a.arrangement }) }, known).fails.length, 1, 'the list does not swallow another pair');
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'durbar-known-'));
  const put = (txt) => fs.writeFileSync(path.join(tmp, 'known-clashes.json'), txt);
  try {
    assert.deepStrictEqual(loadKnown(tmp), { known: [], problems: [] }, 'a missing known-clashes.json means none');
    put('{ nope');
    assert.ok(loadKnown(tmp).problems.some((p) => /not valid JSON.*known-clashes\.json/.test(p)), 'malformed JSON fails, naming the file');
    put('{"clashes":{"pair":["a","b"]}}');
    assert.ok(loadKnown(tmp).problems.some((p) => /must be a list.*known-clashes\.json/.test(p)), 'clashes must be a list, naming the file');
    fs.rmSync(path.join(tmp, 'known-clashes.json'));
    fs.mkdirSync(path.join(tmp, 'known-clashes.json'));
    assert.ok(loadKnown(tmp).problems.some((p) => /unreadable \(EISDIR\).*known-clashes\.json/.test(p)), 'known-clashes.json as a folder (EISDIR) fails naming the file; only ENOENT means none');
    fs.rmdirSync(path.join(tmp, 'known-clashes.json'));
    for (const bad of [{ field: 'arrangement' }, { pair: 'ab', field: 'arrangement' }, { pair: ['a'], field: 'arrangement' }, { pair: ['a', 'a'], field: 'arrangement' }, { pair: ['a', 2], field: 'arrangement' }, { pair: ['a', 'b'] }, { pair: ['a', 'b'], field: 'nonsense' }, null]) {
      put(JSON.stringify({ clashes: [bad] }));
      assert.ok(loadKnown(tmp).problems.some((p) => /entry 0 needs "pair"/.test(p)), `an entry ${JSON.stringify(bad)} fails, naming the file`);
    }
    put(JSON.stringify({ clashes: [{ pair: ['a', 'b'], field: 'arrangement' }] }));
    assert.deepStrictEqual(loadKnown(tmp), { known: [{ pair: ['a', 'b'], field: 'arrangement' }], problems: [] }, 'a good entry loads');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  assert.deepStrictEqual(staleKnown({ a, b: sa }, known), [], 'a listed pair that still clashes is not stale');
  assert.deepStrictEqual(staleKnown({ a, b }, known), ['a and b no longer share the same arrangement: remove it from known-clashes.json'], 'a listed pair that no longer clashes fails, naming known-clashes.json');
  assert.deepStrictEqual(staleKnown({ a }, known), [], 'a listed pair with a world missing is not judged here');
  /* T094: the reviewer's look is a required field with two states, and a pending one names no reviewer (it is set by a person, never by a script). */
  const dcp = (dc) => cardProblems({ ...mk('a'), 'distinct-check': dc }, 'a');
  const noDc = mk('a'); delete noDc['distinct-check'];
  assert.ok(cardProblems(noDc, 'a').some((p) => /missing "distinct-check"/.test(p)), 'a card without distinct-check fails');
  assert.deepStrictEqual(dcp({ state: 'pending' }), [], 'pending passes');
  assert.deepStrictEqual(dcp({ state: 'passed', by: 'Vikram', date: '2026-11-14', worlds: 3 }), [], 'passed with a reviewer, a real date and a count passes');
  assert.ok(dcp({ state: 'looked' }).some((p) => /must be "pending" or "passed"/.test(p)), 'an unknown state fails');
  assert.ok(dcp('passed').some((p) => /missing "distinct-check"/.test(p)), 'a string is not the field');
  assert.ok(dcp({ state: 'pending', by: 'Vikram' }).length > 0, 'a pending look names no reviewer');
  assert.ok(dcp({ state: 'passed', date: '2026-11-14', worlds: 3 }).some((p) => /by must name/.test(p)), 'passed without a reviewer fails');
  assert.ok(dcp({ state: 'passed', by: ' ', date: '2026-11-14', worlds: 3 }).some((p) => /by must name/.test(p)), 'a blank reviewer fails');
  assert.ok(dcp({ state: 'passed', by: 'V', date: '2026-02-30', worlds: 3 }).some((p) => /real YYYY-MM-DD/.test(p)), 'an impossible date fails');
  assert.ok(dcp({ state: 'passed', by: 'V', date: '14/11/2026', worlds: 3 }).some((p) => /real YYYY-MM-DD/.test(p)), 'a date in another shape fails');
  assert.ok(dcp({ state: 'passed', by: 'V', date: '2026-11-14', worlds: 1 }).some((p) => /at least 2/.test(p)), 'comparing fewer than two worlds fails');
  assert.ok(dcp({ state: 'passed', by: 'V', date: '2026-11-14', worlds: '3' }).some((p) => /at least 2/.test(p)), 'the count is a number');
  assert.ok(dcp({ state: 'passed', by: 'V', date: '2026-11-14', worlds: 3, extra: 1 }).some((p) => /exactly state, by, date and worlds/.test(p)), 'an extra field fails');
  assert.ok(cardProblems(mk('a'), 'a').length === 0);
  assert.ok(cardProblems({ ...mk('a'), wall: '' }, 'a').some((p) => /"wall"/.test(p)), 'an empty field is named');
  assert.ok(cardProblems(mk('a'), 'z').some((p) => /differs/.test(p)), 'a card id must match its folder');
  assert.ok(cardProblems({ ...mk('a'), light: [] }, 'a').some((p) => /light/.test(p)));
  assert.ok(cardProblems({ ...mk('a'), light: ['4100'] }, 'a').some((p) => /light/.test(p)), 'a light is a number');
}

/* The real cards. */
const { cards, ids, problems } = readCards(WORLDS);
for (const need of ['photo', 'cave', 'retro']) if (!ids.includes(need)) problems.push(`${need}: no worlds/${need}/card.json (T093, T228)`);
/* A world that is built in the repo has a card, and its arrangement is the one world.json carries (rows when it names none). */
if (!process.env.DURBAR_WORLDS_DIR) for (const id of fs.readdirSync(IN_REPO)) {
  const wj = path.join(IN_REPO, id, 'world.json');
  if (!fs.existsSync(wj)) continue;
  if (!ids.includes(id)) { problems.push(`${id}: a built world with no card`); continue; }
  const arr = JSON.parse(fs.readFileSync(wj, 'utf8')).arrangement || 'rows';
  if (cards[id] && cards[id].arrangement !== arr) problems.push(`${id}: card arrangement "${cards[id].arrangement}" differs from world.json "${arr}"`);
}
const { known, problems: knownProblems } = loadKnown(WORLDS);
problems.push(...knownProblems);
const { fails, reported } = judge(cards, known);
fails.push(...staleKnown(cards, known));
for (const r of reported) console.log(`[KNOWN GAP] ${r}`);
for (const f of [...problems, ...fails]) console.error(`FAIL ${f}`);
assert.strictEqual(problems.length + fails.length, 0, 'the world catalogue has problems (above)');
console.log(`test-world-catalogue OK (${Object.keys(cards).length} cards: ${Object.keys(cards).join(', ')})`);
