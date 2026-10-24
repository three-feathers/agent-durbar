/** Unit tests for the session display name rules (spec 059): `npm run test:sessionname`. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { displayNameOf, renameTarget, syncEntry } from '../src/shared/sessionname';
import { nameError } from '../src/shared/names';
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


// ---- the window's copy (src/renderer/sessionname.js) behaves like the shared rule (spec 059 FR-002, FR-008) ----
// eslint-disable-next-line @typescript-eslint/no-var-requires
const SN = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'sessionname.js')) as {
  MAX: number;
  displayName(a: unknown, t: unknown, f: string): string;
  nameTip(a: unknown, t: unknown, f: string): string;
  shortName(n: string, max?: number): string;
  nameError(v: unknown): string;
  whereLine(cap: unknown, app: string, inApp?: boolean): string;
};
const root = path.join(__dirname, '..', '..');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CUT = require(path.join(root, 'src', 'renderer', 'cuttext.js')) as { cutText(t: string, max: number, o?: { wordBoundary?: boolean }): string }; // the one shared cutter (spec 044 FR-021)
const src = (p: string): string => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n'); // CRLF-safe (Windows CI)
{
  assert.strictEqual(SN.MAX, 60);
  for (const n of ['Short', 'a'.repeat(40), 'a'.repeat(60), 'Refactor the billing module and then fix the invoices list', 'x '.repeat(60), '\u{1F600}'.repeat(60)]) {
    assert.strictEqual(SN.shortName(n), CUT.cutText(n, 40, { wordBoundary: true }), JSON.stringify(n));
    assert.strictEqual(SN.shortName(n, 25), CUT.cutText(n, 25, { wordBoundary: true }));
    assert.ok([...SN.shortName(n)].length <= 40, 'code points, at most 40 including the ellipsis');
  }
  for (const [a, t, f] of [['Mine', 'Title', 'repo'], [undefined, ' Title ', 'repo'], [undefined, undefined, 'repo #2'], ['  ', '', 'repo']] as const) assert.strictEqual(SN.displayName(a, t, f), displayNameOf(a?.trim() ? { name: a } : undefined, t, f));
  // the pre-check agrees with the shared rule (the secret check is main's)
  for (const v of ['ok', '', '  spaced  out ', 'a'.repeat(61), '\u{1F600}'.repeat(60), 'bad\u0000x', 'rtl\u202etrick', 'zero\u200bwidth', 'a\u0085b', 5, undefined]) assert.strictEqual(SN.nameError(v), nameError(v), JSON.stringify(v));
  assert.ok(!/function shortName|shortName\(/.test(src('src/shared/sessionname.ts')), 'no second cut rule: the shared cutter is cuttext.js');
  assert.strictEqual(SN.shortName('Refactor the billing module and then fix the invoices list'), 'Refactor the billing module and then…');
  // tooltips: the user's name and the folder, never the runtime title once named (FR-003)
  assert.strictEqual(SN.nameTip('Mine', 'Long first prompt', 'repo'), 'Mine \u00b7 repo');
  assert.strictEqual(SN.nameTip(undefined, 'Title', 'repo'), 'Title \u00b7 repo');
  assert.strictEqual(SN.nameTip(undefined, undefined, 'repo'), '');
  // FR-004, FR-017: where the name goes; may sync is said for every app that stores it; Claude does not promise the picker
  assert.ok(/^Also saved in GitHub Copilot:.*may sync/.test(SN.whereLine('any', 'GitHub Copilot')));
  assert.ok(/at your next message.*\/resume list.*by its id.*not in the VS Code extension's list.*may sync/.test(SN.whereLine('next-turn', 'Claude Code')));
  assert.strictEqual(SN.whereLine(undefined, 'Basic'), 'Only in Agent Durbar. Basic keeps its own name.');
  assert.ok(/not in Codex yet/.test(SN.whereLine('any', 'Codex', false)));

  // ---- FR-018: an HTML-looking name stays text on every path (static guards; the rendered surfaces are in `npm run check:rename`) ----
  const app = src('src/renderer/app.js');
  // the alias and the display name are never interpolated into HTML without esc()
  const bare: string[] = [];
  app.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/\$\{([^}]*)\}/g)) {
      const expr = m[1];
      if (/\balias\b/.test(expr) && !/esc\(|SN\(\)\.nameTip|nameTipAttr/.test(expr)) bare.push(`${i + 1}: ${line.trim().slice(0, 100)}`);
    }
  });
  assert.deepStrictEqual(bare, [], 'alias interpolated without esc()');
  // the same for every agent name or title in a template: a `${...}` that holds one must go through esc() (or the escaping tooltip helper)
  const bareNames: string[] = [];
  app.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/\$\{([^}]*)\}/g)) {
      const expr = m[1];
      if (/\b(a|ag|x|s|src|na|tag|parent|root|ra|r|v|room|it|row)\.(name|title|alias|folderLabel|baseName)\b|SN\(\)\.(shortName|displayName|nameTip)\(/.test(expr) && !/esc\(|nameTipAttr/.test(expr)) bareNames.push(`${i + 1}: ${expr.slice(0, 80)}`);
    }
  });
  assert.deepStrictEqual(bareNames, [], 'an agent name or title interpolated into a template without esc()');
  assert.ok(!/innerHTML\s*=\s*[^;\n]*\balias\b/.test(app), 'alias is never assigned through innerHTML');
  // every toast in renameSessionUi escapes what it shows
  assert.ok(/toast\(esc\(\(out&&out\.error\)/.test(app) && /toast\(esc\(out\.note\)/.test(app), 'rename toasts are escaped');
  // spec 059 FR-020, FR-022 (issue 636): the rename pencil and the chat title button label themselves through esc(); the inline field writes text only;
  // the dialog and the field share ONE submit part per kind (one bridge call site each, so the two ways in cannot drift)
  assert.ok(/aria-label="Rename \$\{esc\(a\.name\)\}"/.test(app) && /aria-label="Rename session \$\{esc\(a\.name\)\}"/.test(app), 'the pencil and the title button labels are escaped');
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(src('src/renderer/inlinename.js')), 'the inline field never builds HTML');
  assert.strictEqual((app.match(/bridge\.renameSession\(/g) || []).length, 1, 'one bridge.renameSession call site');
  assert.strictEqual((app.match(/bridge\.renameFolder\(/g) || []).length, 1, 'one bridge.renameFolder call site');
  // the Durbar MCP read tools show the folder label, never the session name
  const read = src('src/main/mcp/readtools.ts');
  assert.ok(!/\balias\b/.test(read) && !/\.title\b/.test(read.replace(/\/\*[\s\S]*?\*\//g, '')), 'read tools do not show session names');
  // the activity log gets the user's name for new rows (FR-012) and the runtime title never
  const main = src('src/main/main.ts');
  assert.ok(/agent: a\.alias \|\| a\.label \|\| a\.name/.test(main), 'logActivity uses the alias first');
  assert.ok(!/agent: [^,]*\.title/.test(main), 'the activity log never gets the runtime title');
  // a rename is not logged (FR-012)
  const ops = src('src/main/sessionnames.ts');
  assert.ok(!/logActivity|activity/i.test(ops), 'renameOp writes no activity row');
}
console.log('sessionname: ok');
