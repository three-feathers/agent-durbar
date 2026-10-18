/** Places in the office (spec 024 FR-001..FR-003, FR-010): classification, visits, spots. `npm run test:places`. No credits spent. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import {
  CUSTOM_ICON_IDS, CUSTOM_ID_PATTERN, MAX_CUSTOM_PLACES, MAX_PLACE_ENTRIES, MAX_PLACE_NAME, MAX_SERVER_NAME, PLACE_IDS, RESERVED_PLACE_NAMES,
  addCustomPlace, cleanPlaceName, cleanServerName, parseCustomPlaces, parsePlaceMap, removeCustomPlace, setPlaceEntry, updateCustomPlace,
} from '../src/shared/places';
import type { CustomPlace, PlaceMap } from '../src/shared/places';
import type { DurbarApi } from '../src/shared/api';
type Ev = { tool?: string; mcpServer?: string; mcpTool?: string; phase?: string; callId?: string };
type Visits = {
  onTool: (id: string, e: Ev, map?: Record<string, string>, customIds?: string[]) => boolean;
  onStatus: (id: string, s: string) => boolean;
  leave: (id: string) => boolean;
  tick: () => boolean;
  at: (id: string) => { place: string; label: string; since: number } | null;
  occupants: (p: string) => string[];
  size: () => number;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const P = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'places.js')) as {
  PLACES: { id: string; name: string }[];
  IDS: string[];
  placeName: (id: string, custom?: unknown) => string;
  allPlaces: (custom?: unknown) => { id: string; name: string; icon?: string }[];
  isChoice: (v: unknown, customIds?: unknown) => boolean;
  tileSlots: (aw: unknown, tiles: unknown, addButton: unknown) => number;
  classify: (e: unknown, map?: unknown, customIds?: unknown) => string;
  canonicalServer: (s: unknown) => unknown;
  placeRows: (names: unknown, map?: unknown, customIds?: unknown) => { name: string; aliases: string[]; value: string }[];
  mergePlaceNames: (cli: unknown, extra: unknown, seen: unknown, mapped: unknown) => string[];
  placeSaves: (name: string, place: string | null, aliases?: string[]) => [string, string | null][];
  defaultServerPlace: (s: unknown) => string;
  toolLabel: (e: unknown) => string;
  createVisits: (o?: { now?: () => number; debounceMs?: number; dwellMs?: number }) => Visits;
  layoutSpots: (n: unknown, cap: unknown) => { shown: number; more: number };
};

// FR-001: fixed set and order, kept in sync with the shared list used by main
assert.deepStrictEqual(P.IDS, ['library', 'software', 'terminal', 'web', 'other']);
assert.deepStrictEqual([...PLACE_IDS], P.IDS, 'renderer and shared place ids agree');
assert.strictEqual(P.placeName('software'), 'Software library');
assert.strictEqual(P.placeName('nope'), '');

// FR-002: default classification
const c = (tool: string, mcpServer?: string, map?: unknown) => P.classify({ tool, mcpServer }, map);
for (const t of ['bash', 'powershell', 'shell', 'read_bash', 'write_powershell', 'run', 'exec_command', 'terminal']) assert.strictEqual(c(t), 'terminal', `${t} -> terminal`);
for (const t of ['web_fetch', 'web_search', 'fetch_url', 'http_get']) assert.strictEqual(c(t), 'web', `${t} -> web`);
for (const t of ['read_file', 'view', 'edit_file', 'create', 'write_file', 'grep', 'glob', 'list_dir', 'apply_patch', 'task', 'report_intent', 'ask_user', 'skill', '', undefined as unknown as string]) assert.strictEqual(c(t), 'desk', `${t} -> desk`);
assert.strictEqual(c('github-search_issues', 'github'), 'software');
assert.strictEqual(c('x', 'GitLab'), 'software');
assert.strictEqual(c('x', 'atlassian'), 'library');
assert.strictEqual(c('x', 'my-notes'), 'library');
assert.strictEqual(c('x', 'confluence-prod'), 'library');
assert.strictEqual(c('playwright-browser_snapshot', 'playwright'), 'web');
assert.strictEqual(c('x', 'acme-tools'), 'other');
assert.strictEqual(c('bash', 'github'), 'software', 'an MCP server decides, not the tool name');
assert.strictEqual(P.defaultServerPlace('   '), 'other');
assert.strictEqual(P.classify(undefined), 'desk');
assert.strictEqual(P.classify(null), 'desk');

// user mapping overrides the default; 'desk' keeps the agent at the desk; bad values and prototype keys are ignored
assert.strictEqual(c('x', 'acme-tools', { 'acme-tools': 'library' }), 'library');
assert.strictEqual(c('x', 'github', { github: 'terminal' }), 'terminal');
assert.strictEqual(c('x', 'github', { github: 'desk' }), 'desk');
assert.strictEqual(c('x', 'github', { github: 'moon' }), 'software', 'unknown place id: fall back to the default');
assert.strictEqual(c('x', 'acme-tools', { other: 'library' }), 'other', 'the map is keyed by server name');
assert.strictEqual(c('x', 'constructor', {}), 'other', 'prototype keys are not mapping entries');
assert.strictEqual(c('x', '__proto__', JSON.parse('{"__proto__":"web"}')), 'web', 'a real own key named __proto__ is just a server name');
assert.strictEqual(c('x', 'github', 'not an object'), 'software');
assert.strictEqual(c('x', 'github', null), 'software');

// labels
assert.strictEqual(P.toolLabel({ tool: 'bash' }), 'bash');
assert.strictEqual(P.toolLabel({ tool: 'github-search_issues', mcpServer: 'github', mcpTool: 'search_issues' }), 'github search_issues');
assert.ok(P.toolLabel({ tool: 'x'.repeat(200) }).length <= 60);
assert.strictEqual(P.toolLabel(undefined), '');

// layoutSpots: the last slot becomes "+N" when they do not all fit
assert.deepStrictEqual(P.layoutSpots(0, 4), { shown: 0, more: 0 });
assert.deepStrictEqual(P.layoutSpots(3, 4), { shown: 3, more: 0 });
assert.deepStrictEqual(P.layoutSpots(4, 4), { shown: 4, more: 0 });
assert.deepStrictEqual(P.layoutSpots(5, 4), { shown: 3, more: 2 });
assert.deepStrictEqual(P.layoutSpots(9, 1), { shown: 0, more: 9 });
assert.deepStrictEqual(P.layoutSpots(2, 0), { shown: 0, more: 2 });
assert.deepStrictEqual(P.layoutSpots('x', -3), { shown: 0, more: 0 });

// FR-003: visits (fake clock)
let t = 1000;
const mk = () => P.createVisits({ now: () => t, debounceMs: 600, dwellMs: 2000 });
const start = (callId: string, tool: string, mcpServer?: string): Ev => ({ phase: 'start', callId, tool, mcpServer });
const done = (callId: string, tool: string, mcpServer?: string): Ev => ({ phase: 'complete', callId, tool, mcpServer });

// a call that is still running after 600 ms goes to its place; it stays at least 2 s after the call ends; then it leaves
let v = mk();
assert.strictEqual(v.onTool('a', start('c1', 'bash')), false, 'nothing visible yet');
assert.strictEqual(v.at('a'), null);
t += 599; assert.strictEqual(v.tick(), false); assert.strictEqual(v.at('a'), null, 'not before the debounce');
t += 1; assert.strictEqual(v.tick(), true); assert.strictEqual(v.at('a')?.place, 'terminal'); assert.strictEqual(v.at('a')?.label, 'bash');
assert.deepStrictEqual(v.occupants('terminal'), ['a']);
t += 100; v.onTool('a', done('c1', 'bash'));
assert.ok(v.at('a'), 'still there right after the call ends');
t += 1000; assert.strictEqual(v.tick(), false); assert.ok(v.at('a'), 'dwell not over');
t += 1000; assert.strictEqual(v.tick(), true); assert.strictEqual(v.at('a'), null, 'back at the desk after the dwell');
assert.strictEqual(v.size(), 0);

// a call that ends within the debounce never shows (no flicker), even when no tick ran in between
v = mk();
v.onTool('a', start('c1', 'bash')); t += 200; v.onTool('a', done('c1', 'bash'));
assert.strictEqual(v.at('a'), null); assert.strictEqual(v.size(), 0);
t += 5000; assert.strictEqual(v.tick(), false);

// a call that ends after the debounce but before any tick still counts as a visit
v = mk();
v.onTool('a', start('c1', 'bash')); t += 700; v.onTool('a', done('c1', 'bash'));
assert.ok(v.at('a'), 'it was running longer than 600 ms, so it shows');
t += 2000; assert.strictEqual(v.tick(), true); assert.strictEqual(v.at('a'), null);

// desk tools never move anyone; they also do not end a visit
v = mk();
assert.strictEqual(v.onTool('a', start('c1', 'read_file')), false); assert.strictEqual(v.size(), 0);
v.onTool('a', start('c2', 'bash')); t += 700; v.tick(); assert.ok(v.at('a'));
v.onTool('a', start('c3', 'read_file')); v.onTool('a', done('c3', 'read_file'));
assert.strictEqual(v.at('a')?.place, 'terminal', 'a file call in between does not move the agent');

// newest call wins; an older call finishing does not end the newer visit
v = mk();
v.onTool('a', start('c1', 'bash')); t += 700; v.tick();
assert.strictEqual(v.onTool('a', start('c2', 'github-search', 'github')), true, 'already at a place: switches at once');
assert.strictEqual(v.at('a')?.place, 'software');
v.onTool('a', done('c1', 'bash'));
t += 5000; v.tick();
assert.strictEqual(v.at('a')?.place, 'software', 'the finished older call does not end the visit of the newer one');
v.onTool('a', done('c2', 'github-search', 'github'));
t += 2000; v.tick(); assert.strictEqual(v.at('a'), null);

// one visit per agent, several agents at one place keep their arrival order
v = mk();
v.onTool('b', start('b1', 'github-x', 'github')); t += 10; v.onTool('a', start('a1', 'github-y', 'github')); t += 700; v.tick();
assert.deepStrictEqual(v.occupants('software'), ['b', 'a']);
assert.deepStrictEqual(v.occupants('terminal'), []);

// stop / error / idle send the agent back at once; working-type statuses do not
v = mk();
v.onTool('a', start('c1', 'bash')); t += 700; v.tick();
assert.strictEqual(v.onStatus('a', 'working'), false); assert.ok(v.at('a'));
assert.strictEqual(v.onStatus('a', 'thinking'), false); assert.ok(v.at('a'));
assert.strictEqual(v.onStatus('a', 'needs-permission'), false); assert.ok(v.at('a'), 'waiting for approval keeps the agent at its place');
assert.strictEqual(v.onStatus('a', 'something-new'), false); assert.ok(v.at('a'), 'an unknown status does not end the visit');
assert.strictEqual(v.onStatus('a', 'idle'), true); assert.strictEqual(v.at('a'), null);
for (const s of ['error', 'stopped']) {
  v.onTool('a', start('c9', 'bash')); t += 700; v.tick(); assert.ok(v.at('a'));
  assert.strictEqual(v.onStatus('a', s), true, s); assert.strictEqual(v.at('a'), null);
}
v.onTool('a', start('c10', 'bash')); assert.strictEqual(v.onStatus('a', 'idle'), false, 'a pending visit that never showed changes nothing on screen'); assert.strictEqual(v.size(), 0);
assert.strictEqual(v.onStatus('nobody', 'idle'), false);
v.onTool('z', start('z1', 'bash')); t += 700; v.tick();
assert.strictEqual(v.leave('z'), true); assert.strictEqual(v.leave('z'), false, 'leaving twice is harmless');

// tool events without ids, phases 'update' and garbage are ignored without throwing
v = mk();
assert.strictEqual(v.onTool('', start('c1', 'bash')), false);
assert.strictEqual(v.onTool('a', undefined as unknown as Ev), false);
assert.strictEqual(v.onTool('a', { phase: 'update', callId: 'c1', tool: 'bash' }), false);
assert.strictEqual(v.onTool('a', done('never-started', 'bash')), false);
assert.strictEqual(v.size(), 0);

// a user mapping is applied when the visit starts
v = mk();
v.onTool('a', start('c1', 'x', 'acme-tools'), { 'acme-tools': 'library' }); t += 700; v.tick();
assert.strictEqual(v.at('a')?.place, 'library');
v = mk();
assert.strictEqual(v.onTool('a', start('c1', 'x', 'github'), { github: 'desk' }), false, 'mapped to desk: nobody walks');
assert.strictEqual(v.size(), 0);

// FR-012: github and github-mcp-server are one server for places
assert.strictEqual(P.canonicalServer('github-mcp-server'), 'github');
assert.strictEqual(P.canonicalServer('github'), 'github');
for (const n of ['GitHub-MCP-Server', 'github-mcp-server2', 'my-github-mcp-server', 'github-mcp', 'gitlab', ' github-mcp-server', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) assert.strictEqual(P.canonicalServer(n), n, `${n} stays itself`);
assert.strictEqual(P.canonicalServer(''), '');
assert.strictEqual(P.canonicalServer(undefined), undefined);
assert.strictEqual(P.canonicalServer(null), null);
assert.strictEqual(c('search_code', 'github-mcp-server', { github: 'terminal' }), 'terminal', 'entry on github applies to github-mcp-server calls');
assert.strictEqual(c('search_code', 'github-mcp-server', { 'github-mcp-server': 'web' }), 'web', 'old key on the event name still works');
assert.strictEqual(c('search_code', 'github-mcp-server', { github: 'desk' }), 'desk', 'desk via the canonical key');
assert.strictEqual(c('search_code', 'github-mcp-server', { github: 'terminal', 'github-mcp-server': 'web' }), 'web', 'own name wins over canonical (call github-mcp-server)');
assert.strictEqual(c('search_code', 'github', { github: 'terminal', 'github-mcp-server': 'web' }), 'terminal', 'own name wins (call github)');
assert.strictEqual(c('search_code', 'github', { 'github-mcp-server': 'web' }), 'software', 'a github call does not read the alias key: default rules');
assert.strictEqual(c('search_code', 'github-mcp-server', { github: 'moon' }), 'software', 'invalid value under canonical: default rules');
assert.strictEqual(c('search_code', 'github-mcp-server', { github: 'moon', 'github-mcp-server': 'web' }), 'web');
assert.strictEqual(c('search_code', 'github-mcp-server', {}), 'software');
assert.strictEqual(c('x', 'GitHub-MCP-Server', { github: 'terminal' }), 'software', 'look-alike name does not alias');
assert.strictEqual(c('x', 'my-github-mcp-server', { github: 'terminal' }), 'software');
for (const n of ['__proto__', 'constructor', 'toString']) {
  assert.strictEqual(c('x', n, {}), 'other', `${n} with an empty map: default`);
  assert.strictEqual(c('x', n, { [n]: 'web' }), 'web', `${n} own key (a computed key is an own property)`);
}
assert.strictEqual(c('x', 'toString', { github: 'web' }), 'other', 'no prototype leak');
assert.strictEqual(c('x', 'github-mcp-server', Object.create({ github: 'web' })), 'software', 'inherited key ignored (canonical)');
assert.strictEqual(c('x', 'github', Object.create({ github: 'web' })), 'software', 'inherited key ignored (own name)');

// FR-013: Settings > Places rows fold alias names into the canonical one; saving writes the canonical key and clears the alias key
const rows = (names: string[], map: Record<string, string> = {}) => P.placeRows(names, map).map((r) => `${r.name}|${r.aliases.join(',')}|${r.value}`);
assert.deepStrictEqual(rows(['github', 'github-mcp-server', 'acme']), ['acme||', 'github|github-mcp-server|'], 'both names: one github row with the note');
assert.deepStrictEqual(rows(['github-mcp-server']), ['github|github-mcp-server|'], 'only the alias seen: one github row, with the note');
assert.deepStrictEqual(rows(['github']), ['github||'], 'only github: no note');
assert.deepStrictEqual(rows(['github-mcp-server', 'github-mcp-server', 'github']), ['github|github-mcp-server|'], 'duplicates fold');
assert.deepStrictEqual(rows(['b', 'a', 'github-mcp-server']), ['a||', 'b||', 'github|github-mcp-server|'], 'sorted by canonical name');
assert.deepStrictEqual(rows(['GitHub-MCP-Server', 'github-mcp-server2', 'my-github-mcp-server', 'GitHub']), ['GitHub||', 'GitHub-MCP-Server||', 'github-mcp-server2||', 'my-github-mcp-server||'], 'look-alikes are not folded');
assert.deepStrictEqual(rows(['__proto__', 'constructor', 'toString']), ['__proto__||', 'constructor||', 'toString||'], 'special names stay themselves');
assert.deepStrictEqual(rows(['github', 'github-mcp-server'], { 'github-mcp-server': 'web' }), ['github|github-mcp-server|web'], 'old map with only the alias key: shown on the github row');
assert.deepStrictEqual(rows(['github', 'github-mcp-server'], { github: 'library', 'github-mcp-server': 'web' }), ['github|github-mcp-server|web'], 'both keys: the alias value is shown (the call\'s own name wins in classify)');
assert.deepStrictEqual(rows(['github', 'github-mcp-server'], { github: 'moon', 'github-mcp-server': 'desk' }), ['github|github-mcp-server|desk'], 'invalid canonical value falls to the alias');
assert.deepStrictEqual(rows(['github', 'github-mcp-server'], { github: 'library', 'github-mcp-server': 'moon' }), ['github|github-mcp-server|library'], 'invalid alias value falls back to the canonical one');
{
  const both = { github: 'library', 'github-mcp-server': 'web' };
  assert.strictEqual(P.placeRows(['github', 'github-mcp-server'], both)[0].value, c('x', 'github-mcp-server', both), 'both keys: the row shows what classify() does for a github-mcp-server call');
}
// FR-016: extra names from the main process are merged with the CLI list before placeRows: one row per name, aliases folded
assert.deepStrictEqual(rows(['github', 'my-notes', ...['docs-search', 'github-mcp-server', 'my-notes', 'playwright'], 'playwright']), ['docs-search||', 'github|github-mcp-server|', 'my-notes||', 'playwright||'], 'an extra that is a CLI name or an alias gives one row; an unused extra gets a default row');
assert.deepStrictEqual(rows([...new Set(['github', 'my-notes', 'github-mcp-server', 'docs-search'])], { 'docs-search': 'web' }), ['docs-search||web', 'github|github-mcp-server|', 'my-notes||'], 'an unused extra can carry a saved place');
{
  const m = P.mergePlaceNames;
  const cli = ['github', 'my-notes', 'github-mcp-server'];
  assert.deepStrictEqual(m(cli, { ok: true, names: ['docs-search', 'playwright'] }, ['playwright'], []), ['github', 'my-notes', 'github-mcp-server', 'docs-search', 'playwright'], 'extras are added, each name once');
  for (const bad of [undefined, null, 'x', 5, {}, { ok: true }, { names: 'x' }, { names: null }, { names: { 0: 'a' } }]) assert.deepStrictEqual(m(cli, bad, [], []), cli, 'no usable result adds nothing: ' + JSON.stringify(bad));
  assert.deepStrictEqual(m([], { names: [1, '', 'a', null, {}, 'a', 'b'] }, [], []), ['a', 'b'], 'only non-empty strings are kept');
  assert.deepStrictEqual(m(null, { names: ['x'] }, undefined, 'y'), ['x'], 'bad lists are ignored');
  assert.deepStrictEqual(m([], null, [], ['only-mapped']), ['only-mapped'], 'a name that is only mapped is kept');
  const merged = m(cli, { names: ['docs-search', 'playwright', 'github-mcp-server', 'acme'] }, ['playwright', 'acme'], ['acme', 'docs-search']);
  assert.deepStrictEqual(rows(merged, { acme: 'web' }), ['acme||web', 'docs-search||', 'github|github-mcp-server|', 'my-notes||', 'playwright||'], 'an extra that is also seen, mapped, a CLI name or an alias gives one row');
}
assert.deepStrictEqual(rows(['acme'], { acme: 'terminal' }), ['acme||terminal'], 'other rows unchanged');
assert.deepStrictEqual(rows(['github'], Object.create({ github: 'web' })), ['github||'], 'inherited keys ignored');
assert.deepStrictEqual(P.placeRows(null, null), [], 'bad input');
assert.deepStrictEqual(P.placeSaves('github', 'web', ['github-mcp-server']), [['github', 'web'], ['github-mcp-server', null]], 'canonical key written first, alias cleared');
assert.deepStrictEqual(P.placeSaves('github', null, ['github-mcp-server']), [['github', null], ['github-mcp-server', null]], 'default clears both');
assert.deepStrictEqual(P.placeSaves('acme', 'web', []), [['acme', 'web']], 'other rows: one save');
assert.deepStrictEqual(P.placeSaves('acme', 'web'), [['acme', 'web']]);
{
  // the transform applied to a saved map, as main does it with setPlaceEntry
  let sm = parsePlaceMap({ 'github-mcp-server': 'web', acme: 'library' });
  for (const [k, v] of P.placeSaves('github', 'terminal', ['github-mcp-server'])) { const x = setPlaceEntry(sm, k, v); assert.ok(x.ok); sm = x.map; }
  assert.deepStrictEqual({ ...sm }, { github: 'terminal', acme: 'library' }, 'github written, alias key gone, acme untouched');
}

// FR-007 / FR-011: shared validation of the stored mapping (server names and place ids only)
assert.strictEqual(cleanServerName('  github  '), 'github');
for (const bad of ['', '   ', 'a\nb', 'a\u0000b', '__proto__', 'x'.repeat(MAX_SERVER_NAME + 1), 5, null, undefined, {}]) assert.strictEqual(cleanServerName(bad), undefined, String(bad));
assert.strictEqual(cleanServerName('x'.repeat(MAX_SERVER_NAME)), 'x'.repeat(MAX_SERVER_NAME));
assert.deepStrictEqual({ ...parsePlaceMap({ github: 'terminal', 'my-notes': 'desk', a: 'moon', b: 3, '': 'web', ' c ': 'library' }) }, { github: 'terminal', 'my-notes': 'desk', c: 'library' }, 'keeps only valid entries, trims names');
for (const bad of [null, undefined, 'x', 5, [], [['github', 'web']], true]) assert.deepStrictEqual({ ...parsePlaceMap(bad) }, {}, String(bad));
assert.strictEqual(Object.getPrototypeOf(parsePlaceMap({})), null, 'no prototype: a server called "constructor" or "toString" is just a key');
assert.strictEqual(({} as Record<string, unknown>).polluted, undefined);
parsePlaceMap(JSON.parse('{"__proto__":"web","constructor":"web"}'));
assert.strictEqual(({} as Record<string, unknown>).web, undefined, 'a __proto__ key does not pollute Object.prototype');
const many: Record<string, string> = {};
for (let i = 0; i < MAX_PLACE_ENTRIES + 50; i++) many['s' + i] = 'web';
assert.strictEqual(Object.keys(parsePlaceMap(many)).length, MAX_PLACE_ENTRIES, 'at most 500 entries');
let m = parsePlaceMap({});
let r = setPlaceEntry(m, 'acme-tools', 'library'); assert.ok(r.ok); assert.deepStrictEqual({ ...r.map }, { 'acme-tools': 'library' }); m = r.map;
r = setPlaceEntry(m, ' acme-tools ', 'desk'); assert.ok(r.ok); assert.deepStrictEqual({ ...r.map }, { 'acme-tools': 'desk' }, 'same server, trimmed: replaced');
assert.deepStrictEqual({ ...m }, { 'acme-tools': 'library' }, 'the input map is not modified');
r = setPlaceEntry(m, 'acme-tools', null); assert.ok(r.ok); assert.deepStrictEqual({ ...r.map }, {}, 'null clears the entry');
r = setPlaceEntry(m, 'acme-tools', 'default'); assert.deepStrictEqual({ ...r.map }, {}, "'default' clears the entry");
r = setPlaceEntry(m, 'acme-tools', 'moon'); assert.ok(!r.ok); assert.deepStrictEqual({ ...r.map }, { 'acme-tools': 'library' }, 'unknown place: refused, unchanged');
r = setPlaceEntry(m, '', 'web'); assert.ok(!r.ok);
r = setPlaceEntry(m, 'x', 7); assert.ok(!r.ok);
r = setPlaceEntry(parsePlaceMap(many), 'one-too-many', 'web'); assert.ok(!r.ok, 'a new entry beyond the cap is refused');
r = setPlaceEntry(parsePlaceMap(many), 's1', 'library'); assert.ok(r.ok, 'changing an existing entry is fine at the cap');


// ---- Custom places (spec 024 FR-018..FR-021, issue #115) ----
const cid = (n: number): CustomPlace['id'] => `c-${String(n).padStart(6, '0')}`; // c-000001 ...
let idN = 0;
const nextId = (): string => cid(++idN);
const add = (list: CustomPlace[], name: unknown, icon: unknown = 'star') => addCustomPlace(list, name, icon, nextId);
const names = (list: readonly { name: string }[]): string[] => list.map((p) => p.name);

// constants
assert.strictEqual(MAX_CUSTOM_PLACES, 3);
assert.strictEqual(MAX_PLACE_NAME, 24);
assert.deepStrictEqual([...CUSTOM_ICON_IDS], ['star', 'flask', 'database', 'cloud', 'chart', 'chat', 'mail', 'calendar', 'shield', 'box', 'bolt', 'pin']);
assert.deepStrictEqual([...RESERVED_PLACE_NAMES], [...P.PLACES.map((p) => p.name), 'Stay at desk', 'Default'], 'reserved = the five built-in names, Stay at desk, Default');
assert.ok(CUSTOM_ID_PATTERN.test('c-ab12z9') && !CUSTOM_ID_PATTERN.test('c-AB12z9') && !CUSTOM_ID_PATTERN.test('c-ab12z') && !CUSTOM_ID_PATTERN.test('c-ab12z9x') && !CUSTOM_ID_PATTERN.test('desk') && !CUSTOM_ID_PATTERN.test('library'), 'id pattern');

// cleanPlaceName: trimmed, 1..24 code points, no control characters
assert.deepStrictEqual(cleanPlaceName('  Database '), { ok: true, name: 'Database' });
assert.deepStrictEqual(cleanPlaceName('x'.repeat(24)), { ok: true, name: 'x'.repeat(24) }, '24 characters fit');
assert.deepStrictEqual(cleanPlaceName('x'.repeat(25)), { ok: false, error: 'name-long' }, '25 do not');
assert.deepStrictEqual(cleanPlaceName('\u{1F600}'.repeat(24)), { ok: true, name: '\u{1F600}'.repeat(24) }, '24 emoji (48 UTF-16 units) fit: code points are counted');
assert.deepStrictEqual(cleanPlaceName('\u{1F600}'.repeat(25)), { ok: false, error: 'name-long' }, '25 emoji do not');
assert.deepStrictEqual(cleanPlaceName('  '), { ok: false, error: 'name-empty' });
assert.deepStrictEqual(cleanPlaceName(''), { ok: false, error: 'name-empty' });
assert.deepStrictEqual(cleanPlaceName('\n\t '), { ok: false, error: 'name-empty' }, 'whitespace including newlines is trimmed away');
for (const bad of ['a\nb', 'a\u0000b', 'a\u001fb', 'a\u007fb', 'a\u0085b']) assert.deepStrictEqual(cleanPlaceName(bad), { ok: false, error: 'name-invalid' }, JSON.stringify(bad));
for (const bad of [5, null, undefined, {}, [], true]) assert.deepStrictEqual(cleanPlaceName(bad), { ok: false, error: 'name-invalid' }, 'not a string: ' + String(bad));
assert.deepStrictEqual(cleanPlaceName('<b>x</b> "q"'), { ok: true, name: '<b>x</b> "q"' }, 'markup and quotes are stored as text (escaping is the drawing code\'s job)');
assert.deepStrictEqual(cleanPlaceName('שלום'), { ok: true, name: 'שלום' }, 'right-to-left text is allowed');
assert.deepStrictEqual(cleanPlaceName('__proto__'), { ok: true, name: '__proto__' }, 'a name is text, never a key');

// addCustomPlace: every error code, ids, immutability
{
  idN = 0;
  const a = add([], '  Database ', 'database');
  assert.ok(a.ok && a.place);
  assert.deepStrictEqual(a.place, { id: cid(1), name: 'Database', icon: 'database' }, 'trimmed, id from the generator');
  assert.deepStrictEqual(a.list, [a.place]);
  const empty: CustomPlace[] = [];
  add(empty, 'X'); assert.deepStrictEqual(empty, [], 'the input list is not modified');
  const L1 = a.list;
  assert.strictEqual(add(L1, 'database').error, 'name-taken', 'duplicate name');
  assert.strictEqual(add(L1, 'DATABASE').error, 'name-taken', 'duplicate ignoring case');
  assert.strictEqual(add(L1, '  dAtAbAsE  ').error, 'name-taken', 'duplicate after trimming');
  assert.strictEqual(add([{ id: cid(9), name: 'Äpfel', icon: 'box' }], 'äPFEL').error, 'name-taken', 'case folding with toLowerCase for non-ASCII too');
  for (const r of ['Library', 'Software library', 'Terminal', 'Web', 'Other tools', 'Stay at desk', 'Default']) {
    assert.strictEqual(add([], r).error, 'name-taken', 'reserved: ' + r);
    assert.strictEqual(add([], r.toUpperCase()).error, 'name-taken', 'reserved, upper case: ' + r);
    assert.strictEqual(add([], '  ' + r.toLowerCase() + ' ').error, 'name-taken', 'reserved, lower case, spaces: ' + r);
  }
  assert.strictEqual(add([], 'terminals').ok, true, 'only the exact word (ignoring case) is reserved');
  assert.strictEqual(add([], '  ').error, 'name-empty');
  assert.strictEqual(add([], 'x'.repeat(25)).error, 'name-long');
  assert.strictEqual(add([], 'a\nb').error, 'name-invalid');
  assert.strictEqual(add([], 7).error, 'name-invalid');
  for (const bad of ['nope', '', 'STAR', undefined, null, 5, {}, '__proto__', 'constructor', 'toString']) assert.strictEqual(addCustomPlace([], 'Ok', bad, nextId).error, 'icon', 'bad icon: ' + String(bad));
  for (const ic of CUSTOM_ICON_IDS) assert.ok(add([], 'Ok', ic).ok, 'icon ' + ic);
  // order of the checks: limit first, then name, then icon
  const three = add(add(add([], 'A').list, 'B').list, 'C').list;
  assert.strictEqual(three.length, 3);
  assert.strictEqual(add(three, 'D').error, 'limit', 'a fourth place is refused');
  assert.strictEqual(add(three, '').error, 'limit', 'limit wins over a bad name');
  assert.deepStrictEqual(add(three, 'D').list, three, 'a refusal returns the list unchanged');
  assert.strictEqual(add(add(add([], 'A').list, 'B').list, '  ').error, 'name-empty', 'under the cap the name is checked');
  // id generation: collisions and bad candidates are asked again
  const calls: string[] = [];
  const seq = ['c-bad', 'C-ABCDEF', cid(1), cid(1), 'c-abcdef'];
  const g = addCustomPlace([{ id: cid(1) as CustomPlace['id'], name: 'A', icon: 'pin' }], 'B', 'pin', () => { const v = seq.shift() as string; calls.push(v); return v; });
  assert.strictEqual(g.place?.id, 'c-abcdef', 'bad shape and existing ids are skipped');
  assert.strictEqual(calls.length, 5);
  assert.strictEqual(addCustomPlace([], 'A', 'pin', () => 'nope').error, 'unknown', 'a generator that never gives a usable id: refused, not an endless loop');
  assert.strictEqual(addCustomPlace([], 'A', 'pin', () => 5 as unknown as string).error, 'unknown');
}

// updateCustomPlace: rename keeps the id; checks
{
  idN = 0;
  const L = add(add([], 'Database', 'database').list, 'Ticket desk', 'chat').list;
  const [d, t] = L;
  let r = updateCustomPlace(L, d.id, { name: 'Data warehouse' });
  assert.ok(r.ok); assert.deepStrictEqual(r.list[0], { id: d.id, name: 'Data warehouse', icon: 'database' }, 'rename keeps the id and the icon');
  assert.deepStrictEqual(L[0], d, 'the input list is not modified');
  r = updateCustomPlace(L, d.id, { icon: 'cloud' });
  assert.deepStrictEqual(r.list[0], { id: d.id, name: 'Database', icon: 'cloud' }, 'icon only');
  r = updateCustomPlace(L, d.id, { name: 'DATABASE', icon: 'box' });
  assert.ok(r.ok, 'the same name in another case is allowed for the place itself'); assert.strictEqual(r.list[0].name, 'DATABASE');
  r = updateCustomPlace(L, d.id, { name: undefined, icon: undefined }); assert.ok(r.ok); assert.deepStrictEqual(r.list, L, 'absent fields change nothing');
  r = updateCustomPlace(L, d.id, {}); assert.ok(r.ok); assert.deepStrictEqual(r.list, L);
  assert.strictEqual(updateCustomPlace(L, d.id, { name: 'ticket DESK' }).error, 'name-taken', 'another place\'s name');
  assert.strictEqual(updateCustomPlace(L, d.id, { name: 'web' }).error, 'name-taken', 'reserved');
  assert.strictEqual(updateCustomPlace(L, d.id, { name: ' ' }).error, 'name-empty');
  assert.strictEqual(updateCustomPlace(L, d.id, { name: 'x'.repeat(25) }).error, 'name-long');
  assert.strictEqual(updateCustomPlace(L, d.id, { name: 'a\u0001' }).error, 'name-invalid');
  assert.strictEqual(updateCustomPlace(L, d.id, { name: null }).error, 'name-invalid');
  assert.strictEqual(updateCustomPlace(L, d.id, { icon: 'nope' }).error, 'icon');
  assert.strictEqual(updateCustomPlace(L, d.id, { icon: null }).error, 'icon');
  const half = updateCustomPlace(L, d.id, { name: 'Fine', icon: 'nope' });
  assert.ok(!half.ok && half.error === 'icon' && half.list[0].name === 'Database', 'a refused update changes nothing, not even the valid half');
  for (const id of [cid(77), 'library', 'desk', '', undefined, null, 5, '__proto__']) assert.strictEqual(updateCustomPlace(L, id, { name: 'Z' }).error, 'unknown', 'unknown id: ' + String(id));
  for (const bad of [null, undefined, 'x', 5, []]) assert.strictEqual(updateCustomPlace(L, d.id, bad).error, 'unknown', 'patch is not an object: ' + String(bad));
  assert.strictEqual(t.name, 'Ticket desk');
}

// removeCustomPlace: the map loses every entry that pointed to the place
{
  idN = 0;
  const L = add(add([], 'Database', 'database').list, 'Ticket desk', 'chat').list;
  const ids = L.map((p) => p.id);
  const map = parsePlaceMap({ 'pg-tools': ids[0], 'pg-admin': ids[0], jira: ids[1], github: 'terminal', quiet: 'desk' }, ids);
  const r = removeCustomPlace(L, map, ids[0]);
  assert.ok(r.ok);
  assert.deepStrictEqual(r.list, [L[1]]);
  assert.deepStrictEqual({ ...r.placeMap }, { jira: ids[1], github: 'terminal', quiet: 'desk' }, 'entries for the removed place are gone, the others stay');
  assert.deepStrictEqual({ ...map }, { 'pg-tools': ids[0], 'pg-admin': ids[0], jira: ids[1], github: 'terminal', quiet: 'desk' }, 'the input map is not modified');
  assert.strictEqual(Object.getPrototypeOf(r.placeMap), null);
  const last = removeCustomPlace(r.list, r.placeMap, ids[1]);
  assert.ok(last.ok && last.list.length === 0 && !('jira' in last.placeMap));
  const bad = removeCustomPlace(L, map, cid(55));
  assert.ok(!bad.ok && bad.error === 'unknown' && bad.list.length === 2 && Object.keys(bad.placeMap).length === 5, 'unknown id: nothing changes');
  for (const id of ['library', 'desk', undefined, 5]) assert.strictEqual(removeCustomPlace(L, map, id).error, 'unknown', 'built-in ids cannot be removed: ' + String(id));
  // remove frees the name and a slot
  assert.ok(add(r.list, 'Database').ok, 'the name is free again');
  assert.ok(add(removeCustomPlace(add(L, 'C').list, {}, ids[0]).list, 'D').ok, 'a slot is free again');
}

// parseCustomPlaces: tolerant read
{
  const ok = (id: string, name: unknown, icon: unknown = 'star') => ({ id, name, icon });
  assert.deepStrictEqual(parseCustomPlaces([ok(cid(1), ' A '), ok(cid(2), 'B', 'database')]), [{ id: cid(1), name: 'A', icon: 'star' }, { id: cid(2), name: 'B', icon: 'database' }]);
  assert.strictEqual(parseCustomPlaces([ok(cid(1), 'A'), ok(cid(2), 'B'), ok(cid(3), 'C'), ok(cid(4), 'D'), ok(cid(5), 'E')]).length, 3, 'the first 3 are kept');
  assert.deepStrictEqual(names(parseCustomPlaces([ok(cid(1), 'A'), ok('bad', 'X'), ok(cid(2), 'B'), ok(cid(3), 'C'), ok(cid(4), 'D')])), ['A', 'B', 'C'], 'invalid entries do not use up the 3');
  assert.deepStrictEqual(names(parseCustomPlaces([ok(cid(1), 'A'), ok(cid(1), 'B')])), ['A'], 'repeated id: first kept');
  assert.deepStrictEqual(names(parseCustomPlaces([ok(cid(1), 'A'), ok(cid(2), 'a'), ok(cid(3), 'B')])), ['A', 'B'], 'repeated name (ignoring case): first kept');
  assert.deepStrictEqual(names(parseCustomPlaces([ok(cid(1), 'Terminal'), ok(cid(2), 'default'), ok(cid(3), 'B')])), ['B'], 'reserved names dropped');
  assert.strictEqual(parseCustomPlaces([ok(cid(1), 'A', 'nope')])[0].icon, 'pin', 'unknown icon becomes pin, the place stays');
  assert.strictEqual(parseCustomPlaces([ok(cid(1), 'A', 5)])[0].icon, 'pin');
  assert.strictEqual(parseCustomPlaces([{ id: cid(1), name: 'A' }])[0].icon, 'pin', 'missing icon');
  for (const id of ['', 'library', 'desk', 'default', 'c-ABCDEF', 'c-abcde', 'c-abcdefg', 'c_abcdef', ' c-abcdef', 'c-abc def', 5, null, undefined, '__proto__']) assert.deepStrictEqual(parseCustomPlaces([ok(id as string, 'A')]), [], 'invalid id dropped: ' + String(id));
  for (const nm of ['', '  ', 'x'.repeat(25), 'a\nb', 5, null, undefined]) assert.deepStrictEqual(parseCustomPlaces([ok(cid(1), nm)]), [], 'invalid name dropped: ' + String(nm));
  for (const bad of [null, undefined, 'x', 5, {}, true, { 0: ok(cid(1), 'A') }]) assert.deepStrictEqual(parseCustomPlaces(bad), [], 'not an array: ' + String(bad));
  assert.deepStrictEqual(parseCustomPlaces([null, 5, 'x', [], undefined, ok(cid(1), 'A')]).map((p) => p.name), ['A'], 'odd entries are skipped');
  const extra = parseCustomPlaces([{ id: cid(1), name: 'A', icon: 'star', path: '/etc/passwd', token: 'x' }]);
  assert.deepStrictEqual(Object.keys(extra[0]).sort(), ['icon', 'id', 'name'], 'only id, name and icon come out');
  // JSON with a real "__proto__" key and a "__proto__" name
  const proto = parseCustomPlaces(JSON.parse('[{"__proto__":{"x":1},"id":"c-000001","name":"__proto__","icon":"star"}]'));
  assert.deepStrictEqual(proto, [{ id: 'c-000001', name: '__proto__', icon: 'star' }]);
  assert.strictEqual(({} as Record<string, unknown>).x, undefined, 'no pollution');
  assert.deepStrictEqual(parseCustomPlaces(JSON.parse('{"__proto__":[{"id":"c-000001","name":"A"}]}')), [], 'an object with a __proto__ key is not a list');
}

// FR-019: the mapping can point to custom places that exist
{
  const ids = [cid(1), cid(2)];
  assert.deepStrictEqual({ ...parsePlaceMap({ a: cid(1), b: cid(3), c: 'web', d: 'desk' }, ids) }, { a: cid(1), c: 'web', d: 'desk' }, 'a value for a missing custom id is dropped');
  assert.deepStrictEqual({ ...parsePlaceMap({ a: cid(1) }) }, {}, 'without custom ids a custom id is not valid (old callers)');
  assert.deepStrictEqual({ ...parsePlaceMap({ a: cid(1) }, []) }, {});
  assert.deepStrictEqual({ ...parsePlaceMap(JSON.parse('{"__proto__":"c-000001","ok":"c-000001"}'), ids) }, { ok: cid(1) }, '__proto__ is never a server name');
  assert.deepStrictEqual({ ...parsePlaceMap({ 'default': 'default', a: 'c-000001 ' }, ids) }, {}, 'near misses are not ids');
  let r = setPlaceEntry(parsePlaceMap({}), 'pg-tools', cid(1), ids); assert.ok(r.ok); assert.deepStrictEqual({ ...r.map }, { 'pg-tools': cid(1) });
  r = setPlaceEntry(r.map, 'other-srv', 'web', ids); assert.ok(r.ok);
  assert.deepStrictEqual({ ...r.map }, { 'pg-tools': cid(1), 'other-srv': 'web' }, 'setting one entry keeps the custom entries (the map is re-read with the same custom ids)');
  const bad = setPlaceEntry(r.map, 'x', cid(9), ids); assert.ok(!bad.ok, 'a custom id that does not exist is refused');
  assert.deepStrictEqual({ ...bad.map }, { 'pg-tools': cid(1), 'other-srv': 'web' }, 'and the map is unchanged');
  assert.ok(!setPlaceEntry(r.map, 'x', cid(1)).ok, 'without the ids it is refused too');
  r = setPlaceEntry(r.map, 'pg-tools', null, ids); assert.ok(r.ok); assert.deepStrictEqual({ ...r.map }, { 'other-srv': 'web' });
}

// FR-021: renderer model
{
  const custom = [{ id: cid(1), name: 'Database', icon: 'database' }, { id: cid(2), name: '<b>Tickets</b>', icon: 'chat' }];
  assert.deepStrictEqual(P.allPlaces().map((p) => p.id), P.IDS, 'no custom places: the five');
  assert.deepStrictEqual(P.allPlaces(custom).map((p) => p.id), [...P.IDS, cid(1), cid(2)], 'the five built-ins, then the custom places in creation order');
  for (const bad of [null, 'x', 5, {}, [null, 5, 'x', {}, { id: 5, name: 'x' }, { id: 'c-1' }, { id: '', name: 'x' }]]) assert.deepStrictEqual(P.allPlaces(bad).map((p) => p.id), P.IDS, 'bad custom list adds nothing: ' + JSON.stringify(bad));
  assert.strictEqual(P.placeName(cid(1), custom), 'Database');
  assert.strictEqual(P.placeName(cid(2), custom), '<b>Tickets</b>', 'the name is returned as it is (escaping is the caller\'s job)');
  assert.strictEqual(P.placeName(cid(1)), '', 'a custom id without the list: no name');
  assert.strictEqual(P.placeName(cid(9), custom), '');
  assert.strictEqual(P.placeName('software', custom), 'Software library', 'built-in names stay');
  assert.strictEqual(P.placeName('__proto__', custom), '');
  const ids = custom.map((p) => p.id);
  assert.ok(P.isChoice(cid(1), ids) && P.isChoice('desk', ids) && P.isChoice('web') && !P.isChoice(cid(1)) && !P.isChoice(cid(3), ids) && !P.isChoice('default', ids) && !P.isChoice(5, ids));
  // classify
  const cc = (server: string, map: unknown, customIds?: unknown) => P.classify({ tool: 'x', mcpServer: server }, map, customIds);
  assert.strictEqual(cc('pg-tools', { 'pg-tools': cid(1) }, ids), cid(1), 'a mapping to a custom place');
  assert.strictEqual(cc('pg-tools', { 'pg-tools': cid(1) }), 'other', 'no custom ids given: the entry does not count');
  assert.strictEqual(cc('pg-tools', { 'pg-tools': cid(9) }, ids), 'other', 'a missing id falls to the default rules (other tools), never desk');
  assert.strictEqual(cc('github', { github: cid(9) }, ids), 'software', 'a missing id: the server\'s default place');
  assert.strictEqual(cc('my-notes', { 'my-notes': cid(9) }, ids), 'library');
  assert.strictEqual(cc('playwright', { playwright: cid(9) }, ids), 'web');
  assert.notStrictEqual(cc('pg-tools', { 'pg-tools': cid(9) }, ids), 'desk');
  assert.strictEqual(cc('github', { github: 'desk' }, ids), 'desk', 'desk still works');
  assert.strictEqual(cc('github-mcp-server', { github: cid(2) }, ids), cid(2), 'the github alias works with a custom place');
  assert.strictEqual(cc('github-mcp-server', { github: cid(9), 'github-mcp-server': 'web' }, ids), 'web');
  assert.strictEqual(cc('github-mcp-server', { github: 'web', 'github-mcp-server': cid(9) }, ids), 'web', 'a missing id under the call\'s own name falls to the canonical entry');
  assert.strictEqual(cc('x', { x: cid(1) }, 'not an array'), 'other');
  assert.strictEqual(cc('x', { x: cid(1) }, null), 'other');
  assert.strictEqual(P.classify({ tool: 'bash' }, { bash: cid(1) }, ids), 'terminal', 'built-in tools ignore the map (MCP servers only)');
  // placeRows
  const rowsC = P.placeRows(['pg-tools', 'jira', 'gone'], { 'pg-tools': cid(1), jira: cid(2), gone: cid(9) }, ids).map((r) => r.name + '=' + r.value);
  assert.deepStrictEqual(rowsC, ['gone=', 'jira=' + cid(2), 'pg-tools=' + cid(1)], 'rows show custom places that exist; a missing id shows as default (empty)');
  assert.strictEqual(P.placeRows(['pg-tools'], { 'pg-tools': cid(1) })[0].value, '', 'no custom ids: not shown');
  // visits
  const now = 0;
  const v = P.createVisits({ now: () => now, debounceMs: 0, dwellMs: 0 });
  v.onTool('a1', { phase: 'start', callId: '1', tool: 'x', mcpServer: 'pg-tools', mcpTool: 'q' }, { 'pg-tools': cid(1) }, ids);
  v.tick();
  assert.strictEqual(v.at('a1')?.place, cid(1), 'the visit goes to the custom place');
  assert.deepStrictEqual(v.occupants(cid(1)), ['a1']);
  const v2 = P.createVisits({ now: () => now, debounceMs: 0, dwellMs: 0 });
  v2.onTool('a1', { phase: 'start', callId: '1', tool: 'x', mcpServer: 'pg-tools', mcpTool: 'q' }, { 'pg-tools': cid(9) }, ids);
  v2.tick();
  assert.strictEqual(v2.at('a1')?.place, 'other', 'after the place was removed its next call goes to the default place');
}

// tileSlots: slots per lobby tile from the real tile width (8px gaps, 26px + gap for the Add button)
{
  const t = (aw: number, tiles: number, btn: boolean) => P.tileSlots(aw, tiles, btn);
  assert.deepStrictEqual([5, 6, 7, 8].map((n) => t(1248, n, n < 8)), [3, 1, 1, 1], '1248 px (1280x800), with the Add button below 8 tiles');
  assert.deepStrictEqual([5, 6, 7, 8].map((n) => t(1408, n, n < 8)), [4, 2, 1, 1], '1408 px (1440x900), with the Add button below 8 tiles');
  assert.deepStrictEqual([t(1248, 5, false), t(1408, 5, false)], [3, 5], 'five tiles, no button: what the lobby had before (3 and 5 slots)');
  assert.ok(t(9999, 5, false) <= 8 && t(9999, 5, false) === 8, 'at most 8');
  for (const [aw, n, b] of [[0, 5, false], [-5, 6, true], [NaN, 5, false], [undefined, 5, false], [1248, 0, false], [1248, -2, true], [1248, NaN, false], [1248, 'x', false], [100, 8, true]] as [unknown, unknown, unknown][]) {
    const r = P.tileSlots(aw, n, b);
    assert.ok(Number.isInteger(r) && r >= 1 && r <= 8, 'always an integer from 1 to 8: ' + String([aw, n, b]));
  }
  for (const aw of [1000, 1248, 1408, 1900]) for (let n = 5; n < 8; n++) assert.ok(t(aw, n + 1, false) <= t(aw, n, false), `more tiles never give more slots (${aw}, ${n})`);
  for (const aw of [1248, 1408]) for (let n = 5; n < 8; n++) assert.ok(t(aw, n, true) <= t(aw, n, false), 'the Add button never gives more slots');
}

// icons: the 12 drawings match the shared icon ids
{
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const I = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'place-icons.js')) as { LIST: { id: string; label: string; svg: string }[]; IDS: string[]; iconSvg: (id: unknown) => string };
  assert.deepStrictEqual(I.IDS, [...CUSTOM_ICON_IDS], 'same ids, same order as CUSTOM_ICON_IDS');
  assert.strictEqual(I.LIST.length, 12);
  assert.strictEqual(new Set(I.LIST.map((x) => x.svg)).size, 12, 'twelve different drawings');
  for (const x of I.LIST) {
    assert.ok(/^<svg class="pic" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" /.test(x.svg) && x.svg.endsWith('</svg>'), x.id + ': same style as the built-in place icons');
    assert.ok(!/<script|on\w+=|href|<image|<text|url\(/i.test(x.svg), x.id + ': plain shapes only');
    assert.ok(x.label && x.label[0] === x.label[0].toUpperCase(), x.id + ': has a label for the picker');
    assert.strictEqual(I.iconSvg(x.id), x.svg);
  }
  for (const bad of ['nope', undefined, null, 5, '__proto__', 'constructor']) assert.strictEqual(I.iconSvg(bad), I.iconSvg('pin'), 'unknown icon: the pin: ' + String(bad));
  // shipped with the app
  const copy = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'copy-assets.js'), 'utf8');
  assert.ok(/'place-icons\.js'/.test(copy), 'copy-assets.js copies place-icons.js');
}

// FR-020 / T022: the simulator repeats the shared rules; run the same operations through both and compare
async function simChecks(): Promise<void> {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'sim.ts'), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
  const makeSim = (opts: Record<string, unknown>, search = ''): DurbarApi => {
    const win: Record<string, unknown> = { setTimeout: () => 0, setInterval: () => 0, location: { search } };
    new Function('window', js)(win);
    return (win.__durbarSim as { create(o: Record<string, unknown>): DurbarApi }).create({ n: 1, freeze: true, ...opts });
  };
  type Op = ['add', unknown, unknown] | ['update', number | string, unknown] | ['remove', number | string] | ['map', string, number | string | null];
  const scenarios: Op[][] = [
    [['add', 'Database', 'database'], ['add', 'database', 'star'], ['add', 'DATABASE ', 'star'], ['add', 'Terminal', 'star'], ['add', '  ', 'star'], ['add', '', 'star'], ['add', 'x'.repeat(25), 'star'],
      ['add', 'x'.repeat(24), 'star'], ['add', 'Fourth', 'star']],
    [['add', 'web', 'star'], ['add', 'Web', 'star'], ['add', 'Other TOOLS', 'star'], ['add', 'stay at desk', 'star'], ['add', 'DEFAULT', 'star'], ['add', 'Library', 'star'], ['add', 'software LIBRARY', 'star'], ['add', 'Terminals', 'star']],
    [['add', '\u{1F600}'.repeat(24), 'bolt'], ['add', '\u{1F600}'.repeat(25), 'bolt'], ['add', 'a\nb', 'bolt'], ['add', 'a\u0085b', 'bolt'], ['add', 'a\u007fb', 'bolt'], ['add', 5, 'bolt'], ['add', null, 'bolt'], ['add', '<b>x</b>', 'bolt'], ['add', '__proto__', 'bolt']],
    [['add', 'Äpfel', 'star'], ['add', 'äPFEL', 'star'], ['add', 'Ok', 'nope'], ['add', 'Ok', undefined], ['add', 'Ok', null], ['add', 'Ok', 'STAR'], ['add', 'Ok', '__proto__'], ['add', 'Ok', 'constructor'], ['add', 'Ok', 'pin']],
    [['add', 'A', 'star'], ['add', 'B', 'flask'], ['map', 'srv1', 0], ['map', 'srv2', 1], ['map', 'srv3', 0], ['map', 'srv4', 'web'], ['map', 'srv5', 'desk'], ['map', 'srv6', 'ghost'],
      ['update', 0, { name: 'A2' }], ['update', 0, { name: 'b' }], ['update', 0, { name: 'B', icon: 'cloud' }], ['update', 0, { icon: 'nope' }], ['update', 0, { icon: 'cloud' }], ['update', 1, { name: 'B' }],
      ['update', 1, { name: ' ' }], ['update', 1, { name: 'x'.repeat(25) }], ['update', 1, { name: 'a\n' }], ['update', 1, { name: null }], ['update', 1, {}], ['update', 1, null], ['update', 1, []], ['update', 'ghost', { name: 'Z' }],
      ['remove', 'ghost'], ['remove', 0], ['map', 'srv3', 0], ['map', 'srv7', 0], ['remove', 0], ['add', 'A', 'star'], ['add', 'A2', 'star'], ['add', 'C', 'star'], ['add', 'D', 'star']],
    [['add', 'A', 'star'], ['add', 'B', 'star'], ['add', 'C', 'star'], ['add', 'D', 'star'], ['add', '', 'nope'], ['remove', 1], ['add', 'D', 'star'], ['add', 'E', 'star']],
  ];
  for (const [si, ops] of scenarios.entries()) {
    // shared side
    idN = 0;
    let list: CustomPlace[] = [];
    let map: PlaceMap = parsePlaceMap({});
    const sim = makeSim({});
    const simIds: string[] = [];
    const sharedIds: string[] = [];
    const norm = (l: { id: string; name: string; icon: string }[], m: Record<string, string>, ids: string[]) => ({
      list: l.map((p) => `${p.name}|${p.icon}`),
      map: Object.fromEntries(Object.entries(m).sort().map(([k, v]) => [k, ids.includes(v) ? '#' + ids.indexOf(v) : v])),
    });
    for (const [oi, op] of ops.entries()) {
      const where = `scenario ${si} op ${oi} ${JSON.stringify(op)}`;
      let a: { ok: boolean; error?: string; list: CustomPlace[]; map: PlaceMap };
      let b: Awaited<ReturnType<NonNullable<DurbarApi['addPlace']>>>;
      const idOf = (ref: number | string, ids: string[]): string => (typeof ref === 'number' ? ids[ref] : ref);
      if (op[0] === 'add') {
        const r = addCustomPlace(list, op[1], op[2], nextId); a = { ok: r.ok, error: r.error, list: r.list, map };
        b = await sim.addPlace!(op[1] as string, op[2] as string);
        if (r.ok && r.place) { sharedIds.push(r.place.id); simIds.push(b.place?.id ?? ''); }
      } else if (op[0] === 'update') {
        const r = updateCustomPlace(list, idOf(op[1], sharedIds), op[2]); a = { ok: r.ok, error: r.error, list: r.list, map };
        b = await sim.updatePlace!(idOf(op[1], simIds), op[2] as { name?: string });
      } else if (op[0] === 'remove') {
        const r = removeCustomPlace(list, map, idOf(op[1], sharedIds)); a = { ok: r.ok, error: r.error, list: r.list, map: r.placeMap };
        b = await sim.removePlace!(idOf(op[1], simIds));
      } else {
        const choice = op[2] === null ? null : idOf(op[2], sharedIds);
        const r = setPlaceEntry(map, op[1], choice, list.map((p) => p.id)); a = { ok: r.ok, list, map: r.map };
        const sr = await sim.setPlace!(op[1], op[2] === null ? null : idOf(op[2], simIds));
        b = { ok: sr.ok, customPlaces: (await sim.getSettings!()).customPlaces ?? [], placeMap: sr.placeMap ?? {} };
      }
      assert.strictEqual(b.ok, a.ok, `${where}: ok`);
      assert.strictEqual(b.error, a.error, `${where}: error code`);
      list = a.list; map = a.map;
      // removed ids stay in the id lists (so indexes stay stable) but no longer match a list entry
      assert.deepStrictEqual(norm(b.customPlaces, b.placeMap, simIds), norm(list, { ...map }, sharedIds), `${where}: list and map`);
      assert.deepStrictEqual(norm((await sim.getSettings!()).customPlaces ?? [], (await sim.getSettings!()).placeMap ?? {}, simIds), norm(list, { ...map }, sharedIds), `${where}: getSettings`);
      assert.ok(b.customPlaces.every((p) => CUSTOM_ID_PATTERN.test(p.id)), `${where}: the simulator's ids fit the id pattern`);
    }
  }
  // the simulator's own refusals for the spec's scenario 7 and the cap (scenario 5)
  const s2 = makeSim({});
  assert.strictEqual((await s2.addPlace!('terminal', 'star')).error, 'name-taken');
  assert.strictEqual((await s2.addPlace!('  ', 'star')).error, 'name-empty');
  assert.ok((await s2.addPlace!('Database', 'database')).ok);
  assert.strictEqual((await s2.addPlace!('database', 'star')).error, 'name-taken');
  for (const nm of ['B', 'C']) assert.ok((await s2.addPlace!(nm, 'star')).ok);
  const full = await s2.addPlace!('D', 'star');
  assert.ok(!full.ok && full.error === 'limit' && full.customPlaces.length === 3);

  // DURBAR_SIM_PLACES=N seeding (main passes ?simplaces=N)
  const none = await makeSim({}).getSettings!();
  assert.deepStrictEqual([none.customPlaces, none.placeMap], [[], {}], 'no seeding by default');
  for (const n of [1, 2, 3]) {
    const st = await makeSim({}, `?sim=15&simfreeze=1&simplaces=${n}`).getSettings!();
    assert.strictEqual(st.customPlaces?.length, n, `simplaces=${n}: ${n} places`);
    assert.ok(st.customPlaces?.every((p) => CUSTOM_ID_PATTERN.test(p.id) && (CUSTOM_ICON_IDS as readonly string[]).includes(p.icon)));
    const back = parseCustomPlaces(st.customPlaces);
    assert.deepStrictEqual(back, st.customPlaces, 'the seeded places pass the shared parser unchanged');
    const mapped = Object.entries(st.placeMap ?? {});
    assert.strictEqual(mapped.length, 2, 'two fake servers are mapped');
    assert.deepStrictEqual(mapped.map(([k]) => k).sort(), ['my-notes', 'playwright']);
    assert.ok(mapped.every(([, v]) => st.customPlaces?.some((p) => p.id === v)), 'to places that exist');
    assert.deepStrictEqual({ ...parsePlaceMap(st.placeMap, (st.customPlaces ?? []).map((p) => p.id)) }, st.placeMap, 'the seeded map passes the shared parser unchanged');
  }
  const three = (await makeSim({}, '?simplaces=3').getSettings!()).customPlaces ?? [];
  assert.deepStrictEqual(three.map((p) => [...p.name].length), [8, 11, 24], 'the last seeded name has 24 characters');
  assert.strictEqual((await makeSim({}, '?simplaces=3').getSettings!()).customPlaces?.[2].name, 'Data analytics reporting');
  for (const q of ['?simplaces=4', '?simplaces=x', '?simplaces=', '?simplaces=-1', '?simplaces=12', '?xsimplaces=2']) assert.strictEqual((await makeSim({}, q).getSettings!()).customPlaces?.length, 0, 'ignored: ' + q);
  assert.strictEqual((await makeSim({ places: 2 }).getSettings!()).customPlaces?.length, 2, 'the option works without a page address');
  assert.strictEqual((await makeSim({ places: 9 }).getSettings!()).customPlaces?.length, 3, 'capped at 3');
  // the seeded places are in the same one-row model: they can be edited and removed like any other
  const seeded = makeSim({ places: 3 });
  const sp = (await seeded.getSettings!()).customPlaces ?? [];
  const rm = await seeded.removePlace!(sp[0].id);
  assert.ok(rm.ok && !Object.values(rm.placeMap).includes(sp[0].id) && !('my-notes' in rm.placeMap), 'removing the first seeded place clears its mapping');
}

simChecks().then(
  () => console.log('places tests passed'),
  (e) => { console.error(e); process.exit(1); },
);
