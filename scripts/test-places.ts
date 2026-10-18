/** Places in the office (spec 024 FR-001..FR-003, FR-010): classification, visits, spots. `npm run test:places`. No credits spent. */
import * as assert from 'assert';
import * as path from 'path';
import { MAX_PLACE_ENTRIES, MAX_SERVER_NAME, PLACE_IDS, cleanServerName, parsePlaceMap, setPlaceEntry } from '../src/shared/places';
type Ev = { tool?: string; mcpServer?: string; mcpTool?: string; phase?: string; callId?: string };
type Visits = {
  onTool: (id: string, e: Ev, map?: Record<string, string>) => boolean;
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
  placeName: (id: string) => string;
  classify: (e: unknown, map?: unknown) => string;
  canonicalServer: (s: unknown) => unknown;
  placeRows: (names: unknown, map?: unknown) => { name: string; aliases: string[]; value: string }[];
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

console.log('places tests passed');
