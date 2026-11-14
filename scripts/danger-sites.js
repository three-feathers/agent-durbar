/*
 * Spec 052 (issue #1647): the call sites of the red confirm button (`primary danger`) in the renderer, read from the source for
 * `check-052-danger-dialogs.js` and `test-danger-sites.js`. Every `src/renderer/*.js` is scanned (a new danger dialog in any file counts), and a
 * class string is read whatever its spelling: either order of the two words, any run of spaces, single, double or back quotes, a space after `cls:`.
 * A site is `{label:'..',value:..,cls:'<those words>'}`; the number of places that name both words side by side must equal the number of sites parsed,
 * so a string in a shape this reader does not parse (an object built another way, `className`) fails with a message instead of hiding.
 * ALLOW lists files by name with the reason (none today: `harnesses.js` has `cls:'danger'` alone, a plain red button, issue #1570, which names one word only).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ALLOW = {};
const WORDS = /(?<![\w-])(?:primary\s+danger|danger\s+primary)(?![\w-])/g; /* the two class words side by side, wherever they stand (quotes and apostrophes in the text around do not matter) */
const both = (s) => /^\s*(?:primary\s+danger|danger\s+primary)\s*$/.test(s);
function findSites(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js')).sort()) {
    if (ALLOW[f]) continue;
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const literals = [...src.matchAll(WORDS)];
    const found = [...src.matchAll(/label\s*:\s*(['"`])([^'"`\n]+)\1\s*,\s*value\s*:\s*[^,}]*,\s*cls\s*:\s*(['"`])([^'"`\n]*)\3/g)].filter((m) => both(m[4])).map((m) => ({ file: f, label: m[2], screens: f === 'screens.js' }));
    assert.strictEqual(found.length, literals.length, `${f}: ${literals.length} class string(s) with primary and danger but ${found.length} call site(s) parsed: a destructive dialog has a shape the driver does not read`);
    out.push(...found);
  }
  return out;
}
module.exports = { findSites, ALLOW };
