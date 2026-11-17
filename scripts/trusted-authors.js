// The one JavaScript reader of scripts/trusted-authors.txt (spec 021 FR-060, FR-088), read exactly as scripts/trusted-lib.sh
// reads it: comment lines (optionally indented) out, CR dropped, plain logins only (letters, digits, dashes, an optional [bot]),
// case-sensitive. Plain Node, no dependencies, so a workflow can require it without `npm ci`.
'use strict';
const fs = require('fs');
const path = require('path');

const LOGIN_LINE = /^[A-Za-z0-9-]+(\[bot\])?$/;

/** The logins in the text of trusted-authors.txt. */
function parseTrusted(text) {
  return String(text).split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => !/^[ \t]*#/.test(l) && LOGIN_LINE.test(l));
}

/** The trusted logins of `<root>/scripts/trusted-authors.txt` as a Set; throws when the file cannot be read. */
function trustedAuthors(root) {
  return new Set(parseTrusted(fs.readFileSync(path.join(root, 'scripts', 'trusted-authors.txt'), 'utf8')));
}

module.exports = { parseTrusted, trustedAuthors };
