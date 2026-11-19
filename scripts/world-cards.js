/* Spec 102 FR-014, FR-016: the card logic shared by `test-world-catalogue.js` and `check-world-distinct.js`: a card's shape, the pairs that
   clash by text or light. Every clash fails: the list of known clashes was removed with T174, when the Cave took its own arrangement. */
'use strict';
const fs = require('fs');
const path = require('path');

const TEXT_FIELDS = ['arrangement', 'monitor', 'mood', 'wall', 'floor', 'desk', 'fixtureStyle', 'plants', 'motif'];
const MIN_GAP_K = 200;
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** T368: the card's arrangement text against the id world.json names (rows when none): the text starts with the id, and a `circle` or
 *  `facing-view` world, which the engine draws as `rows` where it does not fit (FR-230), says so with the word rows. Returns a problem string or ''. */
function arrangementTextProblem(text, id, arr) {
  const t = norm(text); const a = norm(arr); /* norm turns "-" into a blank on both sides, so "facing-view" matches "facing view" */
  /* the arrangements that fall back to rows (worldpack.ts FOCUS_ARRANGEMENTS): kept here because this script is plain Node and does not import the TypeScript source */
  const falls = arr === 'circle' || arr === 'facing-view';
  if (t === a) return falls ? `${id}: card arrangement "${text}" must say it falls back to rows where it does not fit (T368)` : '';
  if (!t.startsWith(a + ' ')) return `${id}: card arrangement "${text}" differs from world.json "${arr}"`;
  return falls && /\brows\b/.test(t.slice(a.length)) ? '' : `${id}: card arrangement "${text}" must name rows as the fall-back (T368)`;
}

/** Problems with one card's shape, as strings (empty = fine). */
function cardProblems(card, id) {
  const out = [];
  if (!card || typeof card !== 'object' || Array.isArray(card)) return [`${id}: card.json is not an object`];
  if (card.formatVersion !== 1) out.push(`${id}: formatVersion must be 1`);
  if (card.id !== id) out.push(`${id}: card id "${card.id}" differs from its folder`);
  for (const f of TEXT_FIELDS) if (typeof card[f] !== 'string' || !norm(card[f])) out.push(`${id}: missing or empty "${f}"`);
  if (!Array.isArray(card.light) || !card.light.length || !card.light.every((k) => Number.isFinite(k) && k >= 1000 && k <= 20000)) out.push(`${id}: "light" must be a list of temperatures in kelvin, 1000..20000`);
  out.push(...distinctProblems(card['distinct-check'], id));
  return out;
}

/** The reviewer's look (spec 102 FR-017, T094), set by a person after the contact sheet: { state: 'pending' } or { state: 'passed', by, date, worlds }. Nothing here sets it. */
function distinctProblems(dc, id) {
  if (!dc || typeof dc !== 'object' || Array.isArray(dc)) return [`${id}: missing "distinct-check" (use {"state":"pending"} until a person has looked at the contact sheet)`];
  const keys = Object.keys(dc).sort().join(',');
  if (dc.state === 'pending') return keys === 'state' ? [] : [`${id}: a pending "distinct-check" has no other field (it names a reviewer only once passed)`];
  if (dc.state !== 'passed') return [`${id}: "distinct-check" state must be "pending" or "passed"`];
  const out = [];
  if (keys !== 'by,date,state,worlds') out.push(`${id}: a passed "distinct-check" has exactly state, by, date and worlds`);
  if (typeof dc.by !== 'string' || !dc.by.trim()) out.push(`${id}: "distinct-check" by must name the reviewer`);
  const ok = typeof dc.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dc.date) && new Date(dc.date + 'T00:00:00Z').toISOString().slice(0, 10) === dc.date;
  if (!ok) out.push(`${id}: "distinct-check" date must be a real YYYY-MM-DD date`);
  if (!Number.isInteger(dc.worlds) || dc.worlds < 2) out.push(`${id}: "distinct-check" worlds is how many worlds were compared, at least 2`);
  return out;
}

/** Differences that fail between two cards: { field, a, b } for each shared field, and a light pair under 200 K apart. */
function pairClashes(a, b) {
  const out = [];
  for (const f of TEXT_FIELDS) if (norm(a[f]) === norm(b[f])) out.push({ field: f, a: a.id, b: b.id });
  for (const ka of a.light) for (const kb of b.light) if (Math.abs(ka - kb) < MIN_GAP_K) { out.push({ field: 'light', a: a.id, b: b.id }); break; }
  return out.filter((c, i) => out.findIndex((d) => d.field === c.field) === i);
}

/** The clashes between every pair of cards, as a list of failures: a shared field is never allowed. */
function judge(cards) {
  const fails = [];
  const ids = Object.keys(cards).sort();
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    for (const c of pairClashes(cards[ids[i]], cards[ids[j]])) fails.push(`${c.a} and ${c.b} share ${c.field === 'light' ? 'a light temperature within 200 K' : `the same ${c.field}`}`);
  }
  return fails;
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

module.exports = { TEXT_FIELDS, MIN_GAP_K, norm, cardProblems, arrangementTextProblem, distinctProblems, pairClashes, judge, readCards };
