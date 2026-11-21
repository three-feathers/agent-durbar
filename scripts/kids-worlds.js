/* The worlds that have helper kids (spec 097 FR-371, spec 102 T360): every folder of src/renderer/realoffice/worlds whose world.json has a `kids` block. One list for the kid
 * edge-crop check (test-realoffice-assets.ts) and for check-097-kids.js (KIDS_WORLD): a new world with kids is picked up by both from its data, no second list to keep. */
const fs = require('fs');
const path = require('path');

const WORLDS_DIR = path.join(__dirname, '..', 'src', 'renderer', 'realoffice', 'worlds');

function kidsWorlds() {
  return fs.readdirSync(WORLDS_DIR).filter((d) => {
    const f = path.join(WORLDS_DIR, d, 'world.json');
    return fs.existsSync(f) && !!JSON.parse(fs.readFileSync(f, 'utf8')).kids;
  }).sort();
}

/* KIDS_WORLD: unset or empty = photo; anything else must name a world with kids exactly, or the driver exits with the valid names (a typo such as `Cave` must not check the Photo office
 * and print ok). KIDS_MUTANT=worldfallback restores the old silent fallback (the test must catch it). */
function pickKidsWorld(value, mutant) {
  const valid = kidsWorlds();
  if (!value) return 'photo';
  if (valid.includes(value)) return value;
  if (mutant === 'worldfallback') return 'photo';
  throw new Error(`KIDS_WORLD=${JSON.stringify(value)} is not a world with kids; valid: unset or ${valid.join(', ')}`);
}

module.exports = { kidsWorlds, pickKidsWorld, WORLDS_DIR };
