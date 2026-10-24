/* Cheeky crew (spec 077): which character a session wears, the pure part. A character is picked at random among the ones the
   sessions in the office use least (so twins appear only once every character is taken), kept per session id, and saved as a map
   in the window's localStorage (`durbar.crew`, app.js). No DOM, no storage here: the random source is passed in. In the page:
   window.DurbarCrew; in Node: module.exports (scripts/test-crew.ts). */
(function (root, api) {
  if (typeof module === 'object' && module.exports) module.exports = api; else root.DurbarCrew = api;
})(typeof self !== 'undefined' ? self : this, (function () {
  'use strict';

  /* the characters, in a fixed order (a new one is appended, so the old ones never move); the 13 of spec 077 (the old order's three are kept, a stored id that no longer exists is dropped by loadCrew) */
  const IDS = ['punk', 'gamer', 'hacker', 'rocker', 'buzzcut', 'bookworm', 'scientist', 'metalhead', 'bob-glasses', 'skater', 'surfer', 'disco', 'sporty'];
  const MAX_ENTRIES = 500, MAX_ID = 200;
  /* the portraits (spec 077 FR-050..FR-055, FR-059, FR-060): three poses per character, `crew/art/<id>-<pose>.webp`, 352x352 and square, drawn
     in a fixed square box of the 200x124 stage: 88x88 units at x 24, y 22 (twice the first build's, owner 2026-10-23). Its right edge is the
     monitor's left edge (x 112), so the screen's status colour is never covered (the monitor is drawn after it anyway); the thought bubble
     and badge corner are drawn over its top-left; the chin of every picture stays above the desk top (y 86), which hides the lower
     bust. 4 pixels per stage unit. The art carries the hands (waving, holding a mug), so the code draws no arms over it. */
  const has = (o, key) => Object.prototype.hasOwnProperty.call(o, key);
  const POSES = ['working', 'waiting', 'resting'];
  const BOX = { x: 24, y: 22, w: 88, h: 88 }, PX_PER_UNIT = 4, PIC = 352;
  /* FR-060: where the face is in each picture, in picture pixels [centre x, centre y], found once from the alpha channel and the head
     position (a one-off script, numbers only). A round avatar crops a FACE_CROP square around it; the face box (what must stay visible, in
     the driver) is FACE_W x FACE_H around it. The 13 characters differ (the afro, the mohawk and the hood are tall), so one crop would not fit. */
  const FACE_CROP = 235, FACE_W = 110, FACE_H = 140;
  const FACE = {
    punk: { working: [180, 160], waiting: [165, 160], resting: [194, 160] },
    gamer: { working: [176, 160], waiting: [164, 160], resting: [170, 160] },
    hacker: { working: [180, 170], waiting: [165, 170], resting: [171, 170] },
    rocker: { working: [188, 155], waiting: [191, 155], resting: [192, 155] },
    buzzcut: { working: [178, 150], waiting: [174, 150], resting: [164, 150] },
    bookworm: { working: [177, 155], waiting: [168, 155], resting: [166, 155] },
    scientist: { working: [166, 150], waiting: [180, 150], resting: [160, 150] },
    metalhead: { working: [178, 150], waiting: [165, 150], resting: [177, 150] },
    'bob-glasses': { working: [179, 150], waiting: [168, 150], resting: [179, 150] },
    skater: { working: [195, 140], waiting: [225, 140], resting: [198, 140] },
    surfer: { working: [174, 135], waiting: [193, 135], resting: [190, 135] },
    disco: { working: [172, 150], waiting: [184, 150], resting: [173, 150] },
    sporty: { working: [172, 155], waiting: [170, 155], resting: [166, 155] },
  };
  const k = BOX.w / PIC;
  /* a face box or the avatar's crop, in stage units: [x, y, w, h]; null for an unknown picture */
  const facePoint = (id, pose) => (has(FACE, id) && has(FACE[id], pose)) ? FACE[id][pose] : null;
  function faceBox(id, pose) { const f = facePoint(id, pose); return f ? [BOX.x + (f[0] - FACE_W / 2) * k, BOX.y + (f[1] - FACE_H / 2) * k, FACE_W * k, FACE_H * k] : null; }
  /* the view box of a round avatar (chip, walker, chat header, inbox): the face fills the circle; of a seat on a couch: the bust from its top edge (FR-060) */
  function viewBox(id, pose, use) {
    const f = facePoint(id, pose); if (!f) return null;
    if (use === 'seat') { // from the top of the picture (no hair or hood cut), 3/4 of its width, the face right of centre (the chat badge sits on the seat's top-left corner); the crop may start left of the picture (empty)
      const n = BOX.w * 0.75, x = Math.min(BOX.x + f[0] * k - n * 0.62, BOX.x + BOX.w - n);
      return [x, BOX.y, n, n].map((v) => Math.round(v * 100) / 100).join(' ');
    }
    const n = FACE_CROP * k;
    return [BOX.x + f[0] * k - n / 2, BOX.y + f[1] * k - n / 2, n, n].map((v) => Math.round(v * 100) / 100).join(' ');
  }
  /* the pose for a status: working and thinking type, waiting and error need the person, the rest rests */
  const poseFor = (st) => (st === 'working' || st === 'thinking' || st === 'avatar') ? 'working' : (st === 'waiting' || st === 'error') ? 'waiting' : 'resting';
  const file = (id, pose) => 'crew/art/' + id + '-' + pose + '.webp';
  const files = (ids) => (ids || IDS).reduce((a, id) => a.concat(POSES.map((p) => file(id, p))), []);
  /* FR-055: a character can be drawn when it is known and none of its pictures failed to load (`bad`: a Set of character ids) */
  const usable = (id, bad) => typeof id === 'string' && IDS.includes(id) && !(bad && bad.has && bad.has(id));

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

  return { POSES, BOX, PX_PER_UNIT, FACE, FACE_W, FACE_H, FACE_CROP, faceBox, viewBox, poseFor, file, files, usable, IDS, MAX_ENTRIES, MAX_ID, seeded, seededRand, pickCharacter, assignCrew, pruneCrew, loadCrew };
})());
