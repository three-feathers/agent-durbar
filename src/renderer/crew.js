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
  /* spec 077 FR-072 (issue #815): more crews as more Characters values. `IDS` stays the Cheeky crew (its ids, order and saved choices never change);
     the Prehistoric crew has 6 characters, shown as `crew/art/prehistoric-<id>-<pose>.webp` so a name can never clash with Cheeky's. Every id is unique across crews. */
  const PREHISTORIC_IDS = ['youngbeard', 'braids', 'bigbeard', 'ponytail', 'inventor', 'shaman'];
  const CREWS = { cheeky: IDS, prehistoric: PREHISTORIC_IDS };
  const ALL_IDS = IDS.concat(PREHISTORIC_IDS);
  /* the characters of a Characters value (an unknown value or the theme's own: the Cheeky crew, as before) and the key the choice is stored under */
  const idsFor = (choice) => has(CREWS, choice) ? CREWS[choice] : IDS;
  const storeKey = (choice) => choice === 'prehistoric' ? 'durbar.crew.prehistoric' : 'durbar.crew';
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
    gamer: { working: [210, 165], waiting: [210, 165], resting: [212, 165] },
    hacker: { working: [190, 165], waiting: [200, 165], resting: [190, 165] },
    rocker: { working: [188, 155], waiting: [191, 155], resting: [192, 155] },
    buzzcut: { working: [182, 150], waiting: [198, 150], resting: [182, 150] },
    bookworm: { working: [190, 160], waiting: [198, 160], resting: [187, 160] },
    scientist: { working: [190, 150], waiting: [196, 150], resting: [188, 150] },
    metalhead: { working: [190, 160], waiting: [186, 160], resting: [187, 160] },
    'bob-glasses': { working: [179, 150], waiting: [168, 150], resting: [179, 150] },
    skater: { working: [190, 160], waiting: [172, 160], resting: [180, 160] },
    surfer: { working: [190, 155], waiting: [193, 155], resting: [190, 155] },
    disco: { working: [205, 170], waiting: [186, 170], resting: [192, 170] },
    sporty: { working: [185, 160], waiting: [190, 160], resting: [182, 160] },
    /* Prehistoric (FR-072): read from each picture's contact sheet with a 50 px grid, like the others */
    youngbeard: { working: [206, 155], waiting: [205, 150], resting: [215, 150] },
    braids: { working: [200, 160], waiting: [213, 160], resting: [218, 155] },
    bigbeard: { working: [205, 170], waiting: [218, 170], resting: [206, 160] },
    ponytail: { working: [200, 160], waiting: [210, 160], resting: [216, 160] },
    inventor: { working: [195, 170], waiting: [185, 170], resting: [205, 170] },
    shaman: { working: [198, 160], waiting: [190, 160], resting: [211, 160] },
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
  const file = (id, pose) => 'crew/art/' + (PREHISTORIC_IDS.includes(id) ? 'prehistoric-' : '') + id + '-' + pose + '.webp';
  const files = (ids) => (ids || IDS).reduce((a, id) => a.concat(POSES.map((p) => file(id, p))), []);
  /* FR-055: a character can be drawn when it is known and none of its pictures failed to load (`bad`: a Set of character ids) */
  const usable = (id, bad) => typeof id === 'string' && ALL_IDS.includes(id) && !(bad && bad.has && bad.has(id));

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

  /* Spec 102 FR-200..FR-202 (owner's latest, replaces 097 FR-100/FR-114's "crews pick their world"): worlds and character sets are two
     flat lists of DATA, any set in any world, each world names a default set. Add a row to add a world or a set (a Pirate crew and world
     later change nothing else). `flag` names a switch in WORLD_FLAGS: a row whose flag is off is not offered and never chosen (owner's
     gate, 2026-11-01: a world such as the cave stays closed until spec 097 T156..T159 and spec 001's search land). `choice` is the Characters value that
     picks a set. A set listed here has the full Real office pose set (FR-204); Minimalist and Cheeky are not listed yet. */
  const WORLD_FLAGS = {};
  const WORLDS = [
    { id: 'photo', name: 'Photo office', defaultSet: 'office' },
  ];
  const REAL_SETS = [
    { id: 'office', name: 'Office people', choice: '' },
  ];
  const CHOICE_NAMES = { minimalist: 'Minimalist', cheeky: 'Cheeky', prehistoric: 'Prehistoric' };
  const on = (row, flags) => !row.flag || !!(flags || WORLD_FLAGS)[row.flag];
  const rowOf = (list, id) => list.find((r) => r.id === id) || null;
  /* the worlds offered now (Photo office first, always) */
  function offeredWorlds(flags) { return WORLDS.filter((w) => on(w, flags)); }
  /* FR-114: a stored value that is not an offered world id is the first world */
  function parseWorld(v, flags) { const w = offeredWorlds(flags).find((x) => x.id === String(v)); return w ? w.id : WORLDS[0].id; }
  /* FR-202: an explicit choice that has full poses and is on, else the world's default set, else Office people. `note` says why a
     choice could not be drawn (the choice is kept). */
  function peopleFor(world, choice, flags) {
    const w = rowOf(WORLDS, parseWorld(world, flags)), c = String(choice || '');
    const byChoice = c && c !== 'theme' ? REAL_SETS.find((s) => s.choice === c && on(s, flags)) : null;
    if (byChoice) return { world: w.id, set: byChoice.id, setName: byChoice.name, note: '' };
    const d = rowOf(REAL_SETS, w.defaultSet);
    const def = d && on(d, flags) ? d : REAL_SETS[0];
    const explicit = has(CHOICE_NAMES, c);
    return { world: w.id, set: def.id, setName: def.name, note: explicit ? `Real office shows ${def.name} until ${CHOICE_NAMES[c]} has Real office poses.` : '' };
  }
  /* FR-083, FR-114: the one Settings line under Office layout when Real office is on */
  function realOfficeNote(choice, view, world, flags) {
    return view === 'real' ? peopleFor(world, choice, flags).note : '';
  }

  return { WORLD_FLAGS, WORLDS, REAL_SETS, offeredWorlds, parseWorld, peopleFor, realOfficeNote, CREWS, PREHISTORIC_IDS, ALL_IDS, idsFor, storeKey, POSES, BOX, PX_PER_UNIT, FACE, FACE_W, FACE_H, FACE_CROP, faceBox, viewBox, poseFor, file, files, usable, IDS, MAX_ENTRIES, MAX_ID, seeded, seededRand, pickCharacter, assignCrew, pruneCrew, loadCrew };
})());
