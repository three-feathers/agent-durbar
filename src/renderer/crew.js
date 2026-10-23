/* Cheeky crew (spec 077): which character a session wears, the pure part. A character is picked at random among the ones the
   sessions in the office use least (so twins appear only once every character is taken), kept per session id, and saved as a map
   in the window's localStorage (`durbar.crew`, app.js). No DOM, no storage here: the random source is passed in. In the page:
   window.DurbarCrew; in Node: module.exports (scripts/test-crew.ts). */
(function (root, api) {
  if (typeof module === 'object' && module.exports) module.exports = api; else root.DurbarCrew = api;
})(typeof self !== 'undefined' ? self : this, (function () {
  'use strict';

  /* the characters, in a fixed order (a new one is appended, so the old ones never move); Phase 1 of spec 077 */
  const IDS = ['punk', 'scientist', 'gamer', 'hacker'];
  const MAX_ENTRIES = 500, MAX_ID = 200;
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  /* a small repeatable random source from a string (the session id): FNV-1a into mulberry32 */
  function seeded(str) {
    let h = 2166136261;
    for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    let a = h >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /* the random source for the simulator and the demo: the same session id always gives the same number */
  const seededRand = (id) => seeded(id)();

  /* one character for `id`: random among those with the fewest users in `inUse` (a list of character ids); rand(id) is in [0,1) */
  function pickCharacter(id, ids, inUse, rand) {
    const list = ids && ids.length ? ids : IDS;
    const count = new Map(list.map((c) => [c, 0]));
    for (const c of inUse || []) if (count.has(c)) count.set(c, count.get(c) + 1);
    const least = Math.min(...count.values());
    const pool = list.filter((c) => count.get(c) === least);
    const r = Number(rand ? rand(id) : Math.random());
    const i = Math.floor((Number.isFinite(r) ? Math.min(Math.max(r, 0), 0.999999999) : 0) * pool.length);
    return pool[i];
  }

  /* every session id without a character gets one; characters already given never change. Only the sessions in `sessionIds` count as "in use" */
  function assignCrew(map, sessionIds, ids, rand) {
    const out = Object.assign({}, map || {}), live = new Set(sessionIds || []);
    for (const id of sessionIds || []) {
      if (has(out, id)) continue;
      const inUse = [];
      for (const [sid, c] of Object.entries(out)) if (live.has(sid)) inUse.push(c);
      out[id] = pickCharacter(id, ids, inUse, rand);
    }
    return out;
  }

  /* drop the sessions that are no longer in the office, which frees their characters */
  function pruneCrew(map, liveIds) {
    const keep = new Set(liveIds || []), out = {};
    for (const [id, c] of Object.entries(map || {})) if (keep.has(id)) out[id] = c;
    return out;
  }

  /* saved JSON -> a clean map: string ids up to 200 characters, known character ids only, at most 500 entries */
  function loadCrew(json, ids) {
    let o = null; try { o = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { o = null; }
    const out = {}; if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
    const known = new Set(ids && ids.length ? ids : IDS); let count = 0;
    for (const [id, c] of Object.entries(o)) {
      if (count >= MAX_ENTRIES) break;
      if (!id || id.length > MAX_ID || typeof c !== 'string' || !known.has(c)) continue;
      out[id] = c; count++;
    }
    return out;
  }

  return { IDS, MAX_ENTRIES, MAX_ID, seeded, seededRand, pickCharacter, assignCrew, pruneCrew, loadCrew };
})());
