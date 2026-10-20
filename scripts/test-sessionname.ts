/** Unit tests for the session display name rules (spec 059): `npm run test:sessionname`. */
import * as assert from 'assert';
import { displayNameOf, renameTarget, shortName, syncEntry } from '../src/shared/sessionname';
import type { SessionNameEntry } from '../src/shared/sessionname';

const e = (o: Partial<SessionNameEntry> = {}): SessionNameEntry => ({ src: 'codex', id: 'abc', name: 'Billing', ...o });

// displayNameOf: user name, runtime title, folder label
assert.strictEqual(displayNameOf(e(), 'Long first prompt', 'repo'), 'Billing');
assert.strictEqual(displayNameOf(undefined, ' Long first prompt ', 'repo'), 'Long first prompt');
assert.strictEqual(displayNameOf(undefined, undefined, 'repo #2'), 'repo #2');
assert.strictEqual(displayNameOf(undefined, '   ', 'repo'), 'repo');

// syncEntry: Durbar-only wins, inApp follows the app, pending becomes inApp
assert.strictEqual(syncEntry(undefined, 'x'), undefined);
assert.deepStrictEqual(syncEntry(e(), 'Other'), e());
assert.deepStrictEqual(syncEntry(e(), undefined), e());
assert.deepStrictEqual(syncEntry(e({ inApp: true }), 'Billing'), e({ inApp: true }));
assert.strictEqual(syncEntry(e({ inApp: true }), 'Renamed in the CLI'), undefined);
assert.deepStrictEqual(syncEntry(e({ inApp: true }), '  '), e({ inApp: true }));
assert.deepStrictEqual(syncEntry(e({ pending: true }), 'Older title'), e({ pending: true }));
assert.deepStrictEqual(syncEntry(e({ pending: true }), 'Billing'), e({ inApp: true }));
const input = e({ pending: true });
syncEntry(input, 'Billing');
assert.deepStrictEqual(input, e({ pending: true }), 'input is not changed');

// renameTarget
assert.strictEqual(renameTarget('any'), 'now');
assert.strictEqual(renameTarget('next-turn'), 'next-turn');
assert.strictEqual(renameTarget(undefined), 'durbar');

// shortName
assert.strictEqual(shortName('Short'), 'Short');
assert.strictEqual(shortName('a'.repeat(40)), 'a'.repeat(40));
assert.strictEqual(shortName('a'.repeat(60)), 'a'.repeat(39) + '…');
assert.strictEqual(shortName('Refactor the billing module and then fix the invoices list'), 'Refactor the billing module and then…');
assert.strictEqual([...shortName('x '.repeat(60))].length <= 40, true);
assert.strictEqual([...shortName('\u{1F600}'.repeat(60))].length, 40);
console.log('sessionname: ok');
