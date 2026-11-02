/* Simulator only (spec 077 FR-073, issue #879): the crew character each demo agent wears, by its name, so "Ada" does not turn up as a bearded
   caveman. app.js asks only when the page runs under the simulator (`?sim=`); real sessions, saved choices and crew.js's random pick are untouched,
   and there are no gender tags in the app: this is a fixed table for the demo and its screenshots. Each row was chosen by looking at the art
   (the reading of each character is in specs/077-cheeky-crew/spec.md, FR-073). A crew with fewer fitting characters than names reuses some
   (Prehistoric and Pirate have 6 characters for 15 names). A later crew adds its own column. In the page: window.DurbarSimCrew; in Node: module.exports. */
(function (root, api) {
  if (typeof module === 'object' && module.exports) module.exports = api; else root.DurbarSimCrew = api;
})(typeof self !== 'undefined' ? self : this, (function () {
  'use strict';
  /* name: [cheeky, prehistoric, pirate] (the order of CREW_KEYS) */
  const CREW_KEYS = ['cheeky', 'prehistoric', 'pirate'];
  const NAMES = {
    Ada: ['gamer', 'braids', 'captain'],
    Mira: ['bob-glasses', 'ponytail', 'privateer'],
    Jonas: ['rocker', 'bigbeard', 'hook'],
    Noor: ['scientist', 'inventor', 'cabinboy'],
    Kenji: ['skater', 'inventor', 'eyepatch'],
    Elif: ['hacker', 'shaman', 'privateer'],
    Tomas: ['metalhead', 'youngbeard', 'cook'],
    Priya: ['disco', 'braids', 'captain'],
    Lena: ['sporty', 'ponytail', 'privateer'],
    Omar: ['buzzcut', 'youngbeard', 'eyepatch'],
    Sven: ['surfer', 'bigbeard', 'hook'],
    Clara: ['punk', 'shaman', 'captain'],
    Hugo: ['bookworm', 'inventor', 'cook'],
    Rosa: ['bob-glasses', 'braids', 'privateer'],
    Maya: ['gamer', 'ponytail', 'captain'],
  };
  /* the key of a Characters value: the Cheeky crew is also what the theme's own crew and an unknown value draw (crew.js idsFor) */
  const keyFor = (choice) => (choice === 'prehistoric' || choice === 'pirate') ? choice : 'cheeky';
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  /* the character of a demo name in a crew, or '' when the name has no row or the id is not one of `ids` */
  function characterFor(choice, name, ids) {
    const row = typeof name === 'string' && has(NAMES, name) ? NAMES[name] : null;
    const c = row ? row[CREW_KEYS.indexOf(keyFor(choice))] : '';
    return c && (!ids || ids.includes(c)) ? c : '';
  }
  /* { session id: character } for the main agents of the office that have a row (agents: [{id, baseName, name, parent}]) */
  function seed(choice, agents, ids) {
    const out = {};
    for (const a of agents || []) {
      if (!a || a.parent) continue;
      const c = characterFor(choice, a.baseName || a.name, ids);
      if (c) out[a.id] = c;
    }
    return out;
  }
  return { NAMES, CREW_KEYS, keyFor, characterFor, seed };
})());
