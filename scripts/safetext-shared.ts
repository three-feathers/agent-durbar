/**
 * Spec 084 FR-033 (review of PR 1236): `src/renderer/safetext.js` takes the hidden-character definition from the compiled
 * `src/shared/redact.ts` and never loads a .ts file, so in the source tree (tests) nothing is found at load. Import this first: it hands
 * the compiled module in (`useShared`), once, for every later require of the same file in this process (liveact.js, `rendererScript`).
 */
import * as path from 'path';
import * as shared from '../src/shared/redact';

const ST = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'safetext.js')) as { useShared(m: unknown): boolean };
ST.useShared(shared);
