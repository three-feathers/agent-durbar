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

const TEXT_FIELDS = ['arrangement', 'monitor', 'mood', 'wall', 'floor', 'desk', 'fixtureStyle', 'plants', 'motif'];
const MIN_GAP_K = 200;
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Problems with one card's shape, as strings (empty = fine). */
function cardProblems(card, id) {
  const out = [];
  if (!card || typeof card !== 'object' || Array.isArray(card)) return [`${id}: card.json is not an object`];
  if (card.formatVersion !== 1) out.push(`${id}: formatVersion must be 1`);
  if (card.id !== id) out.push(`${id}: card id "${card.id}" differs from its folder`);
  for (const f of TEXT_FIELDS) if (typeof card[f] !== 'string' || !norm(card[f])) out.push(`${id}: missing or empty "${f}"`);
  if (!Array.isArray(card.light) || !card.light.length || !card.light.every((k) => Number.isFinite(k) && k >= 1000 && k <= 20000)) out.push(`${id}: "light" must be a list of temperatures in kelvin, 1000..20000`);
  return out;
}

/** Differences that fail between two cards: { field, a, b } for each shared field, and a light pair under 200 K apart. */
function pairClashes(a, b) {
  const out = [];
  for (const f of TEXT_FIELDS) if (norm(a[f]) === norm(b[f])) out.push({ field: f, a: a.id, b: b.id });
  for (const ka of a.light) for (const kb of b.light) if (Math.abs(ka - kb) < MIN_GAP_K) { out.push({ field: 'light', a: a.id, b: b.id }); break; }
  return out.filter((c, i) => out.findIndex((d) => d.field === c.field) === i);
}

/** Splits clashes into failures and the named, already-built ones that are only reported. */
function judge(cards, known) {
  const fails = []; const reported = [];
  const ids = Object.keys(cards).sort();
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    for (const c of pairClashes(cards[ids[i]], cards[ids[j]])) {
      const listed = known.some((k) => k.field === c.field && k.pair.length === 2 && [c.a, c.b].every((x) => k.pair.includes(x)));
      (listed ? reported : fails).push(`${c.a} and ${c.b} share ${c.field === 'light' ? 'a light temperature within 200 K' : `the same ${c.field}`}`);
    }
  }
  return { fails, reported };
}

/** known-clashes.json: a missing file is "none"; one that is unreadable, not JSON, or has an entry without a pair of two ids and a field is a problem naming the file. */
function loadKnown(dir) {
  const file = path.join(dir, 'known-clashes.json');
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return e && e.code === 'ENOENT' ? { known: [], problems: [] } : { known: [], problems: [`known-clashes.json unreadable (${e.code || e.name}): ${file}`] }; }
  let list;
  try { list = JSON.parse(raw).clashes; } catch (e) { return { known: [], problems: [`known-clashes.json is not valid JSON: ${file}`] }; }
  if (list === undefined) list = [];
  if (!Array.isArray(list)) return { known: [], problems: [`known-clashes.json: "clashes" must be a list: ${file}`] };
  const problems = [];
  list.forEach((k, i) => {
    const ok = k && typeof k === 'object' && Array.isArray(k.pair) && k.pair.length === 2 && k.pair.every((x) => typeof x === 'string' && x) && k.pair[0] !== k.pair[1] && (TEXT_FIELDS.includes(k.field) || k.field === 'light');
    if (!ok) problems.push(`known-clashes.json: entry ${i} needs "pair" (two different world ids) and "field" (a card field): ${file}`);
  });
  return problems.length ? { known: [], problems } : { known: list, problems: [] };
}

const mk = (id, over) => ({ formatVersion: 1, id, arrangement: `arr ${id}`, monitor: `mon ${id}`, light: [3000 + (id.charCodeAt(0) % 10) * 1000], mood: `mood ${id}`, wall: `wall ${id}`, floor: `floor ${id}`, desk: `desk ${id}`, fixtureStyle: `fix ${id}`, plants: `plant ${id}`, motif: `motif ${id}`, ...over });

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
    assert.ok(loadKnown(tmp).problems.some((p) => /must be a list/.test(p)), 'clashes must be a list');
    for (const bad of [{ field: 'arrangement' }, { pair: 'ab', field: 'arrangement' }, { pair: ['a'], field: 'arrangement' }, { pair: ['a', 'a'], field: 'arrangement' }, { pair: ['a', 2], field: 'arrangement' }, { pair: ['a', 'b'] }, { pair: ['a', 'b'], field: 'nonsense' }, null]) {
      put(JSON.stringify({ clashes: [bad] }));
      assert.ok(loadKnown(tmp).problems.some((p) => /entry 0 needs "pair"/.test(p)), `an entry ${JSON.stringify(bad)} fails, naming the file`);
    }
    put(JSON.stringify({ clashes: [{ pair: ['a', 'b'], field: 'arrangement' }] }));
    assert.deepStrictEqual(loadKnown(tmp), { known: [{ pair: ['a', 'b'], field: 'arrangement' }], problems: [] }, 'a good entry loads');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  assert.ok(cardProblems(mk('a'), 'a').length === 0);
  assert.ok(cardProblems({ ...mk('a'), wall: '' }, 'a').some((p) => /"wall"/.test(p)), 'an empty field is named');
  assert.ok(cardProblems(mk('a'), 'z').some((p) => /differs/.test(p)), 'a card id must match its folder');
  assert.ok(cardProblems({ ...mk('a'), light: [] }, 'a').some((p) => /light/.test(p)));
  assert.ok(cardProblems({ ...mk('a'), light: ['4100'] }, 'a').some((p) => /light/.test(p)), 'a light is a number');
}

/* The real cards. */
const ids = fs.readdirSync(WORLDS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const cards = {}; const problems = [];
for (const id of ids) {
  let card;
  try { card = JSON.parse(fs.readFileSync(path.join(WORLDS, id, 'card.json'), 'utf8')); } catch (e) { problems.push(`${id}: card.json unreadable (${e.code || e.name})`); continue; }
  const p = cardProblems(card, id);
  problems.push(...p);
  if (!p.length) cards[id] = card;
}
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
for (const r of reported) console.log(`[KNOWN GAP] ${r}`);
for (const f of [...problems, ...fails]) console.error(`FAIL ${f}`);
assert.strictEqual(problems.length + fails.length, 0, 'the world catalogue has problems (above)');
console.log(`test-world-catalogue OK (${Object.keys(cards).length} cards: ${Object.keys(cards).join(', ')})`);
