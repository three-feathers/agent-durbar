/** Spec 030 FR-034/FR-035: the hand-off prompt and the summary cleanup (pure). `npm run test:handoff`. */
import * as assert from 'assert';
import { HANDOFF_MAX_CHARS, HANDOFF_PROMPT, cleanSummary } from '../src/adapters/handoff';

assert.match(HANDOFF_PROMPT, /Goal; What was done; Open items; Important files and decisions; Next step/);
assert.match(HANDOFF_PROMPT, /Do not use any tools/);
assert.match(HANDOFF_PROMPT, /secrets/);
assert.match(HANDOFF_PROMPT, /relative to the project folder.*different agent app/, 'spec 030 FR-043: written for another app too');
assert.strictEqual(cleanSummary(undefined), '');
assert.strictEqual(cleanSummary(42), '');
assert.strictEqual(cleanSummary('  \r\n## Goal\r\nX  \n'), '## Goal\nX');
assert.strictEqual(cleanSummary('```markdown\n## Goal\nX\n```'), '## Goal\nX', 'a wrapping fence is dropped');
assert.strictEqual(cleanSummary('```\n## Goal\n```'), '## Goal');
assert.strictEqual(cleanSummary('text ```code``` text'), 'text ```code``` text', 'an inner fence stays');
const long = Array.from({ length: 400 }, (_, i) => `line ${i} ` + 'x'.repeat(20)).join('\n');
const cut = cleanSummary(long);
assert.ok(cut.length <= HANDOFF_MAX_CHARS + 2, 'cut at the limit');
assert.ok(cut.endsWith('\n…'), 'marked as cut');
assert.ok(!/line \d+ x{0,19}\n…$/.test(cut), 'cut on a line break');
console.log('handoff: ok');
