/** Label backfill inference (spec 021 FR-045): `npm run test:labelsbackfill`. Pure functions on fixtures; no gh, no network. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { inferAreas, inferSpecs, inferType, propose, totals, wantedLabels, Item, SPEC_AREAS } from './labels-backfill';

const root = path.resolve(__dirname, '..', '..');
const known = new Set(['003', '021', '044', '045', '058', '025']);
const pr = (o: Partial<Item>): Item => ({ kind: 'pr', number: 1, title: '', body: '', labels: [], files: [], ...o });
const issue = (o: Partial<Item>): Item => ({ kind: 'issue', number: 2, title: '', body: '', labels: [], ...o });

// spec numbers: title prefix, branch, changed spec folders, "spec NNN" in the body; unknown numbers dropped
assert.deepStrictEqual(inferSpecs(pr({ title: '044: run history', branch: '058-mcp-x', files: ['specs/003-permissions/spec.md'] }), known), ['003', '044', '058']);
assert.deepStrictEqual(inferSpecs(issue({ title: 'x', body: 'see spec 045 and spec 999' }), known), ['045'], 'unknown numbers dropped');
assert.deepStrictEqual(inferSpecs(issue({ title: '[021 T019] (sim) docs' }), known), ['021']);
assert.deepStrictEqual(inferSpecs(pr({ title: 'Spec 003 T020: Allow all' }), known), ['003']);
assert.deepStrictEqual(inferSpecs(issue({ title: 'Specs page 404', body: 'specs/021-collaboration-harness/tasks.md' }), known), ['021']);
assert.deepStrictEqual(inferSpecs(issue({ title: '2026 roadmap' }), known), [], 'a year is not a spec prefix');
assert.deepStrictEqual(inferSpecs(pr({ title: 'x', body: 'like spec 044' }), known), [], 'a PR body does not count');
assert.deepStrictEqual(inferSpecs(issue({ title: 'idea', body: 'spec 003, spec 021, spec 044, spec 045' }), known), [], 'an issue body naming many specs does not count');

// areas from paths
assert.deepStrictEqual(inferAreas(pr({ files: ['src/adapters/claude.ts', 'src/renderer/styles.css'] }), []), ['adapters', 'ui']);
assert.deepStrictEqual(inferAreas(pr({ files: ['.github/workflows/ci.yml'] }), []), ['ci']);
assert.deepStrictEqual(inferAreas(pr({ files: ['docs/research.md'] }), []), ['docs']);
assert.deepStrictEqual(inferAreas(pr({ files: ['src/main/mcp/protocol.ts'] }), []), ['mcp']);
assert.deepStrictEqual(inferAreas(pr({ files: ['src/main/schedules.ts'] }), []), ['schedules']);
assert.deepStrictEqual(inferAreas(pr({ files: ['src/shared/redact.ts'] }), []), ['security']);
assert.deepStrictEqual(inferAreas(pr({ files: ['electron-builder.yml'] }), []), ['packaging']);
assert.deepStrictEqual(inferAreas(pr({ files: ['src/main/usagestore.ts'] }), []), ['usage']);
assert.deepStrictEqual(inferAreas(pr({ files: ['src/adapters/permissions.ts'] }), []), ['adapters', 'permissions']);
assert.deepStrictEqual(inferAreas(pr({ files: ['specs/058-mcp-session-controls/spec.md'] }), []), ['mcp'], 'a spec folder gives its area');
// shared files give no area by themselves (Paco, #633): README, package.json, the changelog, app.js alone
assert.deepStrictEqual(inferAreas(pr({ files: ['README.md', 'package.json', 'package-lock.json', 'CHANGELOG.md', 'changelog.d/x.md', 'src/renderer/app.js', 'src/main/main.ts'] }), []), []);
assert.deepStrictEqual(inferAreas(pr({ files: ['scripts/shots-mcp.js', 'docs/screenshots/mcp-dialog.png'] }), []), ['docs'], 'no area from a word inside a path');
assert.deepStrictEqual(inferAreas(pr({ files: ['AGENTS.md', 'docs/collaboration.md'] }), []), ['harness']);
assert.deepStrictEqual(inferAreas(pr({ files: ['docs/agent-apps.md'] }), []), ['harness'], 'the agent-apps notes are agent harness, not user docs');
assert.deepStrictEqual(inferAreas(pr({ files: ['scripts/rules-check.js', 'scripts/test-rules-check.js'] }), []), ['harness']);
assert.notStrictEqual(inferType(pr({ title: '021: vendor notes', files: ['docs/agent-apps.md'] })), 'documentation', 'agent-apps.md is not user documentation');
assert.deepStrictEqual(inferAreas(pr({ files: ['src/renderer/styles.css', 'README.md', 'docs/agent-notes.md', 'package.json', 'package-lock.json'] }), []), ['ui'], 'docs, harness and package.json are not areas next to code');
// areas from words, then from the spec map
assert.deepStrictEqual(inferAreas(issue({ title: 'MCP server list flickers' }), []), ['mcp']);
assert.deepStrictEqual(inferAreas(issue({ title: 'Something odd' }), ['044']), ['schedules']);
assert.deepStrictEqual(inferAreas(issue({ title: 'Something odd' }), []), []);
for (const areas of Object.values(SPEC_AREAS)) for (const a of areas) assert.ok(['adapters', 'ci', 'docs', 'harness', 'mcp', 'packaging', 'permissions', 'platform', 'ui', 'usage', 'security', 'schedules'].includes(a), a);

// type
// spec-only is Spec Kit work: task; documentation is README, docs/ and guides (Paco, #633)
assert.strictEqual(inferType(pr({ title: '058: spec for MCP Sign in', files: ['specs/058-mcp-session-controls/spec.md', 'specs/058-mcp-session-controls/tasks.md', 'changelog.d/058-x.md'] })), 'task', 'spec-only PR');
assert.strictEqual(inferType(pr({ title: 'README: shorter', files: ['README.md'] })), 'documentation', 'README-only PR');
assert.strictEqual(inferType(pr({ title: 'docs: research page', files: ['docs/research.md', 'changelog.d/x.md'] })), 'documentation');
assert.notStrictEqual(inferType(pr({ title: '021: team rules', files: ['AGENTS.md', 'CLAUDE.md'] })), 'documentation', 'agent rules are not documentation');
assert.strictEqual(inferType(pr({ title: '001: fix lounge flake', files: ['src/renderer/app.js'] })), 'bug');
assert.notStrictEqual(inferType(pr({ title: '044: review fixes on the delta', files: ['src/main/x.ts'] })), 'bug', 'review fixes are not a bug');
assert.strictEqual(inferType(pr({ title: '001: arrow keys move between desks', files: ['src/renderer/app.js'] })), 'enhancement', 'a src change without other words');
assert.strictEqual(inferType(pr({ title: '012 T016: adapter contract', files: ['src/adapters/x.ts'] })), 'task', 'a Tnnn in the title');
assert.strictEqual(inferType(issue({ title: 'Idea: multiple profiles' })), 'enhancement');
assert.strictEqual(inferType(issue({ title: 'Can we run on ARM?' })), 'question');
assert.strictEqual(inferType(issue({ title: 'T020 grant scope on Windows' })), 'task');
assert.strictEqual(inferType(pr({ title: 'Add a coffee break', files: ['src/renderer/app.js'] })), 'enhancement');
assert.strictEqual(inferType(pr({ title: 'Release alpha 13', files: ['package.json'] })), 'task');
assert.strictEqual(inferType(issue({ title: 'Something odd' })), 'task', 'default');
assert.strictEqual(inferType(pr({ title: 'Docs: fix README hero', files: ['README.md', 'scripts/shots.js'] })), 'documentation', 'a Docs: title');

// propose: add-only, keeps an existing type and area, flags two type labels and a missing area
let p = propose(pr({ title: '044: fix history', branch: '044-history', files: ['src/main/schedules.ts'], labels: ['bug', 'area:ui'] }), known);
assert.deepStrictEqual(p.add, ['spec:044'], 'type and area already present: only the spec');
p = propose(issue({ title: 'odd', labels: ['bug', 'enhancement'] }), known);
assert.ok(p.notes.some((n) => n.includes('2 type labels')));
assert.ok(p.notes.some((n) => n.includes('no area')));
assert.ok(!p.add.includes('bug') && !p.add.includes('enhancement'));
p = propose(pr({ title: '058: spec for MCP Sign in', branch: '058-mcp-signin-spec', files: ['specs/058-mcp-session-controls/spec.md'] }), known);
assert.deepStrictEqual(p.add, ['task', 'spec:058', 'area:mcp'], 'spec-only PR: task, the spec, the feature area');
p = propose(pr({ title: 'Bump version', files: ['package.json', 'README.md'] }), known);
assert.deepStrictEqual(p.add, [], 'only shared files: flagged, no type or area guessed');
assert.ok(p.notes.some((n) => n.includes('no area')));
p = propose(issue({ title: '044: odd', labels: ['bug', 'enhancement'] }), known);
assert.deepStrictEqual(p.add, ['spec:044'], 'a flagged item only gets its spec labels');
p = propose(issue({ title: 'odd', labels: ['spec:044'] }), known);
assert.deepStrictEqual(p.add, ['task', 'area:schedules'], 'area from an existing spec label');
p = propose(pr({ title: '045: redact tokens', branch: '045-redact', files: ['src/shared/redact.ts', 'specs/045-security-sweep/spec.md'] }), known);
assert.deepStrictEqual(p.add, ['enhancement', 'spec:045', 'area:security']);
// idempotent: applying the proposal leaves nothing to add
p = propose(pr({ title: '045: redact tokens', branch: '045-redact', files: ['src/shared/redact.ts'], labels: ['task', 'spec:045', 'area:security'] }), known);
assert.deepStrictEqual(p.add, []);

assert.deepStrictEqual(totals([{ item: issue({}), add: ['a', 'b'], notes: [] }, { item: issue({}), add: ['b'], notes: [] }]), [['b', 2], ['a', 1]]);

// the label set: labels.tsv holds the new areas, and every spec folder gets spec:NNN
const wanted = wantedLabels(root).map((l) => l.name);
for (const n of ['area:security', 'area:schedules', 'task', 'status:claimed', 'docs-n/a', 'incident', 'spec:021', 'spec:044']) assert.ok(wanted.includes(n), n);

// every labels.tsv line is name<TAB>colour<TAB>description: a space instead of a tab must fail
for (const line of fs.readFileSync(path.join(root, '.github', 'labels.tsv'), 'utf8').split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue;
  assert.ok(/^[^\t]+\t[0-9a-f]{6}\t[^\t]+$/i.test(line), `labels.tsv line is not name<TAB>colour<TAB>description: ${line.slice(0, 40)}`);
}

console.log('labels-backfill: ok');
