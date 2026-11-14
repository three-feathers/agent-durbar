/* Spec 102 FR-014, FR-016: the card logic shared by `test-world-catalogue.js` and `check-world-distinct.js`: a card's shape, the pairs that
   clash by text or light, and worlds/known-clashes.json (already-built pairs that are reported, never failed; one that no longer clashes fails). */
'use strict';
const fs = require('fs');
const path = require('path');

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


/** The cards of a worlds folder: { cards: { id: card }, ids, problems } (a card that does not parse or fails its shape is a problem and is left out). */
function readCards(dir) {
  const ids = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const cards = {}; const problems = [];
  for (const id of ids) {
    let card;
    try { card = JSON.parse(fs.readFileSync(path.join(dir, id, 'card.json'), 'utf8')); } catch (e) { problems.push(`${id}: card.json unreadable (${e.code || e.name})`); continue; }
    const p = cardProblems(card, id);
    problems.push(...p);
    if (!p.length) cards[id] = card;
  }
  return { cards, ids, problems };
}

/** Listed pairs that no longer clash on their field: each is a failure, because a waiver outliving its clash hides the next one. */
function staleKnown(cards, known) {
  return known.filter((k) => {
    const [x, y] = k.pair;
    if (!cards[x] || !cards[y]) return false;
    return !pairClashes(cards[x], cards[y]).some((c) => c.field === k.field);
  }).map((k) => `${k.pair[0]} and ${k.pair[1]} no longer share ${k.field === 'light' ? 'a light temperature within 200 K' : `the same ${k.field}`}: remove it from known-clashes.json`);
}

module.exports = { TEXT_FIELDS, MIN_GAP_K, norm, cardProblems, pairClashes, judge, loadKnown, readCards, staleKnown };
