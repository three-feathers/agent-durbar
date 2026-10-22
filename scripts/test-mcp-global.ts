/**
 * Spec 069 (FR-041): the agent apps' user-level MCP lists. Parsers and editors per format with fixtures, backups, atomic write,
 * changed-since refusal, token expiry, masked previews and no secret value in any reply. `npm run test:mcpglobal`. No Electron,
 * no network, no credits; every file lives in a temp folder.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stripTomlComment, tomlStringArray, tomlUnquote } from '../src/main/codextoml';
import { readCodexMcpToml } from '../src/main/foldersetup';
import { mcpSecretValues } from '../src/main/mcpmask';
import { addToText, claudeOffKey, codexBlock, differences, mergeSessionServers, neededVars, neutralFrom, globalFiles, headerVar, jsonEntry, MASK, offOf, previewText, readGlobal, removeFromText, sourcesFor, textHash, tomlStr } from '../src/main/mcpglobal';
import { backupAndWrite, GlobalLists, KEEP_BACKUPS, pruneBackups, readFileSafe, sessionGlobalFor, TOKEN_MS, writeTarget } from '../src/main/mcpglobalio';
import type { AgentInfo } from '../src/shared/api';
import { McpStore } from '../src/main/mcpstore';
import type { McpServerInput } from '../src/shared/mcp';

const SECRET = 'sk-planted-SECRET-0123456789abcdef';
const SECRET2 = 'hdr-planted-SECRET-zyxwvu987654';
const stdio: McpServerInput = { name: 'notes', transport: 'stdio', command: 'npx', args: ['-y', '@acme/notes-mcp', 'C:\\Users\\me\\notes'], env: [{ key: 'NOTES_TOKEN', value: SECRET }], headers: [] };
const remote: McpServerInput = { name: 'docs', transport: 'http', url: 'https://mcp.example.com/mcp', headers: [{ key: 'X-Api-Key', value: SECRET2 }], env: [] };
let n = 0;
const ok = (name: string, f: () => void): void => {
  f();
  n++;
  console.log('ok', name);
};
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-069-'));

// ---------------------------------------------------------------- paths (FR-001)
ok('paths per app, env overrides, ~ labels', () => {
  const home = path.join(path.sep, 'home', 'u');
  const f = globalFiles({}, home);
  assert.strictEqual(f.copilot.file, path.join(home, '.copilot', 'mcp-config.json'));
  assert.strictEqual(f.claude.file, path.join(home, '.claude.json'));
  assert.strictEqual(f.codex.file, path.join(home, '.codex', 'config.toml'));
  assert.strictEqual(f.claude.label, path.join('~', '.claude.json'));
  assert.ok(!f.codex.label.includes('home'), 'no user folder in a label');
  const g = globalFiles({ CLAUDE_CONFIG_DIR: '/cfg/claude', CODEX_HOME: '/cfg/codex', DURBAR_COPILOT_DIR: '/t/cop' }, home);
  assert.strictEqual(g.claude.file, path.join('/cfg/claude', '.claude.json'));
  assert.strictEqual(g.codex.file, path.join('/cfg/codex', 'config.toml'));
  assert.strictEqual(g.copilot.file, path.join('/t/cop', 'mcp-config.json'));
  const h = globalFiles({ CLAUDE_CONFIG_DIR: '/a', DURBAR_CLAUDE_CONFIG_DIR: '/dev', DURBAR_CODEX_HOME: '/devx', CODEX_HOME: '/b' }, home);
  assert.strictEqual(h.claude.file, path.join('/dev', '.claude.json'));
  assert.strictEqual(h.codex.file, path.join('/devx', 'config.toml'));
});

// ---------------------------------------------------------------- entries (FR-003, FR-004)
ok('JSON entries: reference mode writes ${NAME}, plain writes the value, masked hides it', () => {
  const ref = jsonEntry('copilot', stdio, 'ref');
  assert.deepStrictEqual(ref, { type: 'local', command: 'npx', args: stdio.args, env: { NOTES_TOKEN: '${NOTES_TOKEN}' }, tools: ['*'] });
  assert.deepStrictEqual(jsonEntry('claude', stdio, 'plain'), { type: 'stdio', command: 'npx', args: stdio.args, env: { NOTES_TOKEN: SECRET } });
  assert.ok(!JSON.stringify(jsonEntry('claude', stdio, 'plain', true)).includes(SECRET));
  assert.deepStrictEqual(jsonEntry('claude', remote, 'ref'), { type: 'http', url: remote.url, headers: { 'X-Api-Key': '${X_API_KEY}' } });
  assert.strictEqual(headerVar('X-Api-Key'), 'X_API_KEY');
  assert.strictEqual(headerVar('9x'), '_9X');
});
ok('Codex block: env_vars / env subtable / env_http_headers / http_headers, escaping', () => {
  assert.deepStrictEqual(codexBlock(stdio, 'ref'), ['[mcp_servers.notes]', 'command = "npx"', 'args = ["-y", "@acme/notes-mcp", "C:\\\\Users\\\\me\\\\notes"]', 'env_vars = ["NOTES_TOKEN"]']);
  const plain = codexBlock(stdio, 'plain').join('\n');
  assert.ok(plain.includes('[mcp_servers.notes.env]') && plain.includes(`NOTES_TOKEN = "${SECRET}"`));
  assert.ok(!codexBlock(stdio, 'plain', true).join('\n').includes(SECRET));
  assert.ok(codexBlock(remote, 'ref').includes('env_http_headers = { "X-Api-Key" = "X_API_KEY" }'));
  assert.ok(codexBlock(remote, 'plain').join('\n').includes(`http_headers = { "X-Api-Key" = "${SECRET2}" }`));
  assert.strictEqual(tomlStr('a"b\\c\n'), '"a\\"b\\\\c\\u000a"');
  for (const app of ['copilot', 'claude', 'codex'] as const) assert.ok(!previewText(app, stdio, 'plain').includes(SECRET) && previewText(app, stdio, 'plain').includes(MASK), `${app} preview masked`);
  const odd: McpServerInput = { ...stdio, args: ['a":b', 'c","d', '{x}'], env: [{ key: 'K', value: 'v' }] };
  for (const app of ['copilot', 'claude'] as const) assert.deepStrictEqual(JSON.parse('{' + previewText(app, odd, 'ref') + '}'), { notes: jsonEntry(app, odd, 'ref', true) }, `${app} preview is the exact entry`);
});
ok('refusals: working directory, Codex dotted names and sse', () => {
  assert.ok(!addToText('claude', undefined, { ...stdio, workingDirectory: '/x' }, 'ref').ok);
  const dotted = addToText('codex', undefined, { ...stdio, name: 'a.b' }, 'ref');
  assert.ok(!dotted.ok && /no dots/.test(dotted.error));
  assert.ok(!addToText('codex', undefined, { ...remote, transport: 'sse' }, 'ref').ok);
  assert.ok(addToText('copilot', undefined, { ...remote, transport: 'sse' }, 'ref').ok);
});

// ---------------------------------------------------------------- JSON files
const claudeFixture = JSON.stringify({ numStartups: 12, projects: { '/home/u/p': { allowedTools: [], mcpServers: { local: { command: 'x' } } } }, mcpServers: { existing: { type: 'stdio', command: 'node', args: ['s.js'], env: { K: 'v-secret' } } }, oauthAccount: { emailAddress: 'kept@example.com' } }, null, 2);
ok('Claude JSON: add keeps every other key; conflict; replace; remove', () => {
  const r = addToText('claude', claudeFixture, stdio, 'ref');
  assert.ok(r.ok);
  const doc = JSON.parse(r.text);
  assert.strictEqual(doc.numStartups, 12);
  assert.deepStrictEqual(doc.projects, JSON.parse(claudeFixture).projects, 'project-scope servers untouched');
  assert.strictEqual(doc.oauthAccount.emailAddress, 'kept@example.com');
  assert.deepStrictEqual(Object.keys(doc.mcpServers), ['existing', 'notes']);
  const again = addToText('claude', r.text, stdio, 'ref');
  assert.ok(!again.ok && again.conflict);
  const rep = addToText('claude', r.text, { ...stdio, command: 'node2' }, 'ref', true);
  assert.ok(rep.ok && JSON.parse(rep.text).mcpServers.notes.command === 'node2');
  const rm = removeFromText('claude', r.text, 'notes');
  assert.ok(rm.ok && !('notes' in JSON.parse(rm.text).mcpServers) && JSON.parse(rm.text).numStartups === 12);
  assert.ok(!removeFromText('claude', r.text, 'nope').ok);
});
ok('JSON refusals: invalid JSON, not an object, mcpServers not an object, Copilot bare map', () => {
  for (const bad of ['{ "a": ', '[1,2]', '{"mcpServers": []}']) {
    const r = addToText('copilot', bad, stdio, 'ref');
    assert.ok(!r.ok, bad);
    assert.ok(!readGlobal('claude', bad).ok, bad);
  }
  assert.ok(!readGlobal('claude', '{ nope').ok);
  const bare = JSON.stringify({ gh: { command: 'gh-mcp' } });
  assert.deepStrictEqual((readGlobal('copilot', bare) as { servers: { name: string }[] }).servers.map((s) => s.name), ['gh'], 'bare map listed');
  assert.ok(!addToText('copilot', bare, stdio, 'ref').ok, 'bare map not written');
});
ok('JSON: new file, CRLF kept, BOM read, views carry key names only', () => {
  const r = addToText('copilot', undefined, stdio, 'plain');
  assert.ok(r.ok && JSON.parse(r.text).mcpServers.notes.env.NOTES_TOKEN === SECRET);
  const crlf = '{\r\n  "mcpServers": {}\r\n}\r\n';
  const c = addToText('copilot', crlf, remote, 'ref');
  assert.ok(c.ok && c.text.includes('\r\n') && !/[^\r]\n/.test(c.text));
  const v = readGlobal('claude', '\uFEFF' + claudeFixture);
  assert.ok(v.ok);
  assert.deepStrictEqual(v.servers, [{ name: 'existing', transport: 'stdio', command: 'node', args: ['s.js'], envKeys: ['K'], headerKeys: [] }]);
  assert.ok(!JSON.stringify(v.servers).includes('v-secret'));
});

// ---------------------------------------------------------------- Codex TOML
const codexFixture = [
  '# my codex config',
  'model = "gpt-5"',
  'developer_instructions = """',
  'Use [brackets] freely.',
  '[mcp_servers.fake]',
  '"""',
  '',
  '[mcp_servers.alpha]',
  'command = "alpha-mcp" # trailing comment',
  'args = ["--port", "4000"]',
  '',
  '[mcp_servers.alpha.env]',
  'ALPHA_KEY = "alpha-secret"',
  '',
  '# about the profile',
  '[profiles.fast]',
  'model = "o4-mini"',
  '',
  '[mcp_servers.beta]',
  'url = "https://beta.example.com/mcp"',
  'bearer_token_env_var = "BETA_TOKEN"',
  'env_http_headers = { "X-Org" = "BETA_ORG" }',
  '',
].join('\n');
ok('Codex read: tables, sub-tables, multi-line strings ignored, names only', () => {
  const r = readGlobal('codex', codexFixture);
  assert.ok(r.ok);
  assert.deepStrictEqual(r.servers.map((s) => s.name), ['alpha', 'beta'], 'the [mcp_servers.fake] inside a """ string is not a table');
  assert.deepStrictEqual(r.servers[0], { name: 'alpha', transport: 'stdio', command: 'alpha-mcp', args: ['--port', '4000'], envKeys: ['ALPHA_KEY'], headerKeys: [] });
  assert.deepStrictEqual(r.servers[1], { name: 'beta', transport: 'http', url: 'https://beta.example.com/mcp', envKeys: [], headerKeys: ['X-Org', 'Authorization'], refs: true });
  assert.ok(!JSON.stringify(r.servers).includes('alpha-secret'));
});
ok('Codex add appends a block and keeps every other byte', () => {
  const r = addToText('codex', codexFixture, stdio, 'ref');
  assert.ok(r.ok);
  assert.ok(r.text.startsWith(codexFixture), 'the old text is a prefix, byte for byte');
  assert.ok(r.text.endsWith('# added by Agent Durbar\n[mcp_servers.notes]\ncommand = "npx"\nargs = ["-y", "@acme/notes-mcp", "C:\\\\Users\\\\me\\\\notes"]\nenv_vars = ["NOTES_TOKEN"]\n'));
  const back = readGlobal('codex', r.text);
  assert.ok(back.ok && back.servers.map((s) => s.name).join() === 'alpha,beta,notes');
  const conflict = addToText('codex', r.text, stdio, 'ref');
  assert.ok(!conflict.ok && conflict.conflict);
  assert.ok(!addToText('codex', codexFixture, { ...stdio, name: 'alpha' }, 'ref').ok);
});
ok('Codex remove: own block and sub-tables only; comments of the next table kept; round trip', () => {
  const rmA = removeFromText('codex', codexFixture, 'alpha');
  assert.ok(rmA.ok);
  assert.ok(!rmA.text.includes('alpha'), 'alpha and alpha.env gone');
  assert.ok(rmA.text.includes('# about the profile\n[profiles.fast]'), 'the next table keeps its comment');
  assert.ok(rmA.text.includes('[mcp_servers.fake]') && rmA.text.includes('[mcp_servers.beta]'));
  const added = addToText('codex', codexFixture, stdio, 'plain');
  assert.ok(added.ok);
  const back = removeFromText('codex', added.text, 'notes');
  assert.ok(back.ok);
  assert.strictEqual(back.text, codexFixture, 'add then remove gives the same bytes');
  const rmLast = removeFromText('codex', codexFixture, 'beta');
  assert.ok(rmLast.ok && rmLast.text.endsWith('model = "o4-mini"\n'));
});
ok('Codex: CRLF file, new file, refusals for inline tables and dotted keys', () => {
  const crlf = codexFixture.replace(/\n/g, '\r\n');
  const r = addToText('codex', crlf, remote, 'ref');
  assert.ok(r.ok && r.text.startsWith(crlf) && !/[^\r]\n/.test(r.text));
  const rm = removeFromText('codex', r.text, 'docs');
  assert.ok(rm.ok && rm.text === crlf);
  const fresh = addToText('codex', undefined, remote, 'ref');
  assert.ok(fresh.ok && fresh.text.startsWith('# added by Agent Durbar\n[mcp_servers.docs]\n'));
  for (const odd of ['mcp_servers = { a = { command = "x" } }\n', 'mcp_servers.a.command = "x"\n', '[mcp_servers]\na.command = "x"\n']) {
    assert.ok(!readGlobal('codex', odd).ok, odd);
    assert.ok(!addToText('codex', odd, stdio, 'ref').ok, odd);
    assert.ok(!removeFromText('codex', odd, 'a').ok, odd);
  }
  const quoted = '[mcp_servers."x y"]\ncommand = "q"\n';
  assert.deepStrictEqual((readGlobal('codex', quoted) as { servers: { name: string }[] }).servers.map((s) => s.name), ['x y']);
});
ok('Codex: a file that does not parse is refused, valid shapes still read (change 2026-10-22, T060)', () => {
  // the T060 case: an unclosed table header, which `codex mcp list` refuses to load ("unclosed table, expected `]`")
  for (const bad of ['[mcp_servers.x\ncommand = "a"\n', 'model = "o3"\njust words\n', '[tui]\n= 1\n', '[mcp_servers.a] command = "x"\n', '[a."b]\n']) {
    const r = readGlobal('codex', bad);
    assert.ok(!r.ok && /does not parse \(line \d+\)/.test(r.error), bad);
    assert.ok(!addToText('codex', bad, stdio, 'ref').ok, bad);
    assert.ok(!removeFromText('codex', bad, 'x').ok, bad);
  }
  assert.ok(/line 2/.test((readGlobal('codex', 'model = "o3"\njust words\n') as { error: string }).error));
  const valid = [
    '# c\nmodel = "o3" # x\n\n[profiles.dev]\napproval_policy = "never"\n',
    'notify = [\n  "a", # one\n  "b]",\n]\n[x]\ny = 1\n',
    'a.b = { c = [1, 2], d = "}" }\n[[t]]\nk = 2\n',
    'instructions = """\nfree text [not a table\n"""\n[mcp_servers.a]\ncommand = "x"\n',
    "lit = '''\n= odd\n'''\n\"quoted key\" = 1\n'single' = 2\n",
  ];
  for (const v of valid) {
    assert.ok(readGlobal('codex', v).ok, v);
    assert.ok(addToText('codex', v, stdio, 'ref').ok, v);
  }
});
ok('Codex: a hostile long line is linear', () => {
  const big = '[mcp_servers.a]\nargs = [' + '"x",'.repeat(60000) + ']\n' + ';'.repeat(200000) + ' x y\n';
  const t = Date.now();
  readGlobal('codex', big);
  addToText('codex', big, stdio, 'ref');
  assert.ok(Date.now() - t < 2000, `took ${Date.now() - t} ms`);
});

ok('views mask secret-shaped arguments and URL keys from the files', () => {
  const tok = 'ghp_' + 'A'.repeat(36);
  const j = JSON.stringify({ mcpServers: { a: { command: 'srv', args: ['--api-key', 'abc-planted-123', tok] }, b: { type: 'http', url: 'https://x.example/mcp?api_key=planted-url-key' } } });
  const v = readGlobal('claude', j);
  assert.ok(v.ok);
  const out = JSON.stringify(v.servers);
  for (const x of ['abc-planted-123', tok, 'planted-url-key']) assert.ok(!out.includes(x), `${x} masked: ${out}`);
  const c = readGlobal('codex', `[mcp_servers.a]\ncommand = "srv"\nargs = ["--token", "abc-planted-123"]\n`);
  assert.ok(c.ok && !JSON.stringify(c.servers).includes('abc-planted-123'));
});

// ---------------------------------------------------------------- sources (FR-011)
ok('sources: each list once, folder, built-in, runtime only when nothing else', () => {
  assert.deepStrictEqual(sourcesFor('x', { copilot: ['x'], claude: ['x'], codex: [] }, new Set(['x']), new Set()), ['copilot', 'claude', 'folder']);
  assert.deepStrictEqual(sourcesFor('github-mcp-server', {}, new Set(), new Set(['github-mcp-server'])), ['builtin']);
  assert.deepStrictEqual(sourcesFor('z', {}, new Set(), new Set()), ['runtime']);
  assert.deepStrictEqual(offOf('claude', ['a', claudeOffKey('b')]), ['b']);
  assert.deepStrictEqual(offOf('copilot', ['a', claudeOffKey('b')]), ['a']);
  assert.deepStrictEqual(offOf('codex', ['a']), []);
});
ok('Claude off-keys never reach a session as disabled names', () => {
  const d = tmp();
  const s = new McpStore(path.join(d, 'm.json'));
  s.setAmbientDisabled(claudeOffKey('notes'), true);
  s.setAmbientDisabled('gh', true);
  assert.deepStrictEqual(s.forSession('/f').disabledMcpServers, ['gh']);
  const s2 = new McpStore(path.join(d, 'm.json'));
  s2.load();
  assert.ok(s2.ambientDisabled().includes(claudeOffKey('notes')), 'kept across restarts');
});

// ---------------------------------------------------------------- io (FR-005, FR-006)
ok('readFileSafe: missing, folder, too big, not UTF-8', () => {
  const d = tmp();
  assert.deepStrictEqual(readFileSafe(path.join(d, 'none.json')), { ok: true, text: undefined });
  assert.ok(!readFileSafe(d).ok);
  fs.writeFileSync(path.join(d, 'bin'), Buffer.from([0xff, 0xfe, 0x00, 0xc3]));
  assert.ok(!readFileSafe(path.join(d, 'bin')).ok);
  fs.writeFileSync(path.join(d, 'big'), Buffer.alloc(8 * 1024 * 1024 + 1, 0x20));
  assert.ok(!readFileSafe(path.join(d, 'big')).ok);
});
ok('backupAndWrite: backup, mode kept, changed-since refusal, prune to 3, no temp left', () => {
  const d = tmp();
  const f = path.join(d, '.claude.json');
  fs.writeFileSync(f, claudeFixture, { mode: 0o640 });
  if (process.platform !== 'win32') fs.chmodSync(f, 0o640);
  const stale = backupAndWrite(f, '{}', textHash('other'), Date.UTC(2026, 9, 21, 21, 0, 0));
  assert.ok(!stale.ok && /changed since/.test(stale.error));
  assert.strictEqual(fs.readFileSync(f, 'utf8'), claudeFixture);
  let t = Date.UTC(2026, 9, 21, 21, 0, 0);
  let text = claudeFixture;
  for (let i = 0; i < 5; i++) {
    const next = text + ' ';
    const w = backupAndWrite(f, next, textHash(text), t);
    assert.ok(w.ok && w.backup, `write ${i}`);
    text = next;
    t += i === 1 ? 0 : 1000; // two writes in the same second get distinct names
  }
  assert.strictEqual(fs.readFileSync(f, 'utf8'), text);
  const baks = fs.readdirSync(d).filter((x) => x.endsWith('.bak'));
  assert.strictEqual(baks.length, KEEP_BACKUPS, baks.join());
  assert.ok(!fs.readdirSync(d).some((x) => x.endsWith('.durbar-tmp')));
  if (process.platform !== 'win32') {
    assert.strictEqual(fs.statSync(f).mode & 0o777, 0o640, 'mode kept');
    for (const b of baks) assert.strictEqual(fs.statSync(path.join(d, b)).mode & 0o777, 0o600);
  }
  fs.writeFileSync(path.join(d, '.claude.json.backup'), 'claude own backup');
  fs.writeFileSync(path.join(d, 'other.durbar-20200101T000000Z.bak'), 'x');
  pruneBackups(f);
  assert.ok(fs.existsSync(path.join(d, '.claude.json.backup')) && fs.existsSync(path.join(d, 'other.durbar-20200101T000000Z.bak')), 'never another backup');
});
ok('backupAndWrite: a new file and its folder are created, mode 0600, no backup', () => {
  const d = tmp();
  const f = path.join(d, 'nested', '.codex', 'config.toml');
  const w = backupAndWrite(f, 'x = 1\n', textHash(undefined), Date.now());
  assert.ok(w.ok && !w.backup);
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(f).mode & 0o777, 0o600);
});

function fixtureHome(): { home: string; lists: GlobalLists; clock: { t: number } } {
  const home = tmp();
  fs.mkdirSync(path.join(home, '.copilot'));
  fs.writeFileSync(path.join(home, '.copilot', 'mcp-config.json'), JSON.stringify({ mcpServers: { gh: { type: 'local', command: 'gh-mcp', tools: ['*'] } } }, null, 2));
  fs.writeFileSync(path.join(home, '.claude.json'), claudeFixture);
  fs.mkdirSync(path.join(home, '.codex'));
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'), codexFixture);
  const clock = { t: Date.UTC(2026, 9, 21, 22, 0, 0) };
  return { home, clock, lists: new GlobalLists(() => globalFiles({}, home), () => clock.t) };
}
const noSecret = (o: unknown, what: string): void => {
  const s = JSON.stringify(o);
  for (const x of [SECRET, SECRET2, 'v-secret', 'alpha-secret']) assert.ok(!s.includes(x), `${what} holds a secret value`);
};

ok('GlobalLists: state lists every app, names only', () => {
  const { lists } = fixtureHome();
  const st = lists.state((app) => (app === 'copilot' ? ['gh'] : []));
  assert.deepStrictEqual(st.apps.map((a) => [a.app, a.found, a.servers.map((s) => s.name).join()]), [['copilot', true, 'gh'], ['claude', true, 'existing'], ['codex', true, 'alpha,beta']]);
  assert.deepStrictEqual(st.apps[0].off, ['gh']);
  noSecret(st, 'state');
});
ok('GlobalLists: preview -> apply writes three files with backups; reply and preview hold no secret', () => {
  const { home, lists } = fixtureHome();
  const pv = lists.preview(stdio, ['copilot', 'claude', 'codex'], 'plain');
  assert.ok(pv.ok && pv.token && pv.items.length === 3 && pv.items.every((i) => !i.error && i.exists));
  noSecret(pv, 'preview');
  assert.ok(pv.items.every((i) => i.entry.includes(MASK)));
  assert.ok(!fs.readFileSync(path.join(home, '.claude.json'), 'utf8').includes('notes'), 'nothing written by a preview');
  const res = lists.apply(pv.token, []);
  assert.ok(res.ok && res.items.every((i) => i.ok && i.backup), JSON.stringify(res));
  noSecret(res, 'apply result');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).mcpServers.notes.env.NOTES_TOKEN, SECRET, 'plain mode: the value is in the file');
  assert.ok(fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8').startsWith(codexFixture));
  assert.strictEqual(fs.readdirSync(path.join(home, '.codex')).filter((x) => x.endsWith('.bak')).length, 1);
  assert.ok(!lists.apply(pv.token).ok, 'a token is single use');
  const after = lists.state(() => []);
  assert.ok(after.apps.every((a) => a.servers.some((v) => v.name === 'notes')), 'the lists are read again after a write (no stale cache)');
  noSecret(after, 'state after write');
  assert.strictEqual(lists.pendingCount(), 0);
});
ok('GlobalLists: the cached list follows an outside edit', () => {
  const { home, lists } = fixtureHome();
  assert.strictEqual(lists.state(() => []).apps[1].servers.length, 1);
  const f = path.join(home, '.claude.json');
  const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
  doc.mcpServers.second = { command: 'x' };
  fs.writeFileSync(f, JSON.stringify(doc));
  assert.deepStrictEqual(lists.state(() => []).apps[1].servers.map((v) => v.name), ['existing', 'second']);
  assert.deepStrictEqual(Object.keys(lists.sessionServers('claude', new Set())), ['existing', 'second']);
});
ok('GlobalLists: reference mode lists the variables; conflicts need a tick; errors per file', () => {
  const { home, lists } = fixtureHome();
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'), 'mcp_servers = { a = { command = "x" } }\n');
  const pv = lists.preview({ ...stdio, name: 'existing' }, ['claude', 'codex'], 'ref');
  assert.deepStrictEqual(pv.vars, ['NOTES_TOKEN']);
  const claude = pv.items.find((i) => i.app === 'claude');
  assert.ok(claude?.conflict && claude.current?.command === 'node');
  assert.ok(pv.items.find((i) => i.app === 'codex')?.error);
  const no = lists.apply(pv.token, []);
  assert.ok(!no.ok && no.items.every((i) => !i.ok));
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).mcpServers.existing.command, 'node');
  const pv2 = lists.preview({ ...stdio, name: 'existing' }, ['claude'], 'ref');
  const yes = lists.apply(pv2.token, ['claude']);
  assert.ok(yes.ok);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).mcpServers.existing.env.NOTES_TOKEN, '${NOTES_TOKEN}');
});
ok('GlobalLists: a file changed after the preview is not written; tokens expire', () => {
  const { home, lists, clock } = fixtureHome();
  const pv = lists.preview(remote, ['copilot', 'claude'], 'ref');
  fs.appendFileSync(path.join(home, '.claude.json'), ' ');
  const r = lists.apply(pv.token);
  assert.ok(r.items.find((i) => i.app === 'copilot')?.ok);
  assert.ok(/changed since/.test(r.items.find((i) => i.app === 'claude')?.error ?? ''));
  const pv2 = lists.preview({ ...remote, name: 'docs2' }, ['copilot'], 'ref');
  clock.t += TOKEN_MS + 1;
  assert.ok(!lists.apply(pv2.token).ok);
  assert.strictEqual(lists.pendingCount(), 0, 'expired reviews are dropped');
});
ok('GlobalLists: remove preview and apply; invalid input refused', () => {
  const { home, lists } = fixtureHome();
  const pv = lists.removePreview('alpha', ['codex', 'claude']);
  assert.ok(pv.items.find((i) => i.app === 'codex')?.entry.includes('alpha-mcp --port 4000'));
  assert.ok(pv.items.find((i) => i.app === 'claude')?.error, 'not in Claude Code');
  noSecret(pv, 'remove preview');
  const r = lists.apply(pv.token);
  assert.ok(r?.items.find((i) => i.app === 'codex')?.ok);
  assert.ok(!fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8').includes('[mcp_servers.alpha]'));
  assert.ok(!lists.preview({ name: 'bad name!', transport: 'stdio', command: 'x' }, ['claude'], 'ref').ok);
  assert.ok(!lists.preview(stdio, [], 'ref').ok);
  assert.ok(!lists.preview(stdio, ['evil'], 'ref').ok);
  assert.ok(!lists.removePreview(42, ['claude']).ok);
});
ok('GlobalLists: Claude list for sessions (values in main), minus off names', () => {
  const { lists } = fixtureHome();
  const s = lists.sessionServers('claude', new Set());
  assert.deepStrictEqual(s, { existing: { type: 'stdio', command: 'node', args: ['s.js'], env: { K: 'v-secret' }, tools: ['*'] } });
  assert.deepStrictEqual(lists.sessionServers('claude', new Set(['existing'])), {});
});

// ---------------------------------------------------------------- harmonize (part 2, FR-020..FR-022)
ok('neutral form: JSON refs and values, Codex env_vars / env table / inline env / bearer / env_http_headers', () => {
  const j = neutralFrom('claude', 'x', { type: 'http', url: 'https://u', headers: { Authorization: 'Bearer ${TOK}', 'X-K': '${XK}', 'X-P': 'plain-v' } });
  assert.ok(j.ok);
  assert.deepStrictEqual(j.input.headers, [{ key: 'Authorization', value: 'Bearer ${TOK}' }, { key: 'X-K', ref: 'XK' }, { key: 'X-P', value: 'plain-v' }]);
  const c = readGlobal('codex', codexFixture) as { ok: true; values: Map<string, Record<string, unknown>> };
  const alpha = neutralFrom('codex', 'alpha', c.values.get('alpha') ?? {});
  assert.ok(alpha.ok);
  assert.deepStrictEqual(alpha.input.env, [{ key: 'ALPHA_KEY', value: 'alpha-secret' }]);
  const beta = neutralFrom('codex', 'beta', c.values.get('beta') ?? {});
  assert.ok(beta.ok);
  assert.deepStrictEqual(beta.input.headers, [{ key: 'X-Org', ref: 'BETA_ORG' }, { key: 'Authorization', value: 'Bearer ${BETA_TOKEN}' }]);
  const inline = readGlobal('codex', '[mcp_servers.i]\ncommand = "c"\nenv = { "A" = "va", B = \'vb\' }\nenv_vars = ["C"]\n') as { ok: true; values: Map<string, Record<string, unknown>> };
  const ii = neutralFrom('codex', 'i', inline.values.get('i') ?? {});
  assert.ok(ii.ok);
  assert.deepStrictEqual(ii.input.env, [{ key: 'A', value: 'va' }, { key: 'B', value: 'vb' }, { key: 'C', ref: 'C' }]);
  assert.ok(!neutralFrom('codex', 'w', { command: 'c', cwd: '/x' }).ok, 'a working directory is not copied');
  assert.ok(!neutralFrom('claude', 'w', { type: 'ws', url: 'ws://x' }).ok);
});
ok('copies keep references as references in every format', () => {
  const c = readGlobal('codex', codexFixture) as { ok: true; values: Map<string, Record<string, unknown>> };
  const beta = neutralFrom('codex', 'beta', c.values.get('beta') ?? {});
  assert.ok(beta.ok);
  const cl = jsonEntry('claude', beta.input, 'plain');
  assert.deepStrictEqual(cl.headers, { 'X-Org': '${BETA_ORG}', Authorization: 'Bearer ${BETA_TOKEN}' });
  assert.deepStrictEqual(neededVars(beta.input, 'plain'), ['BETA_ORG', 'BETA_TOKEN']);
  // and back to Codex: the same keys
  const back = codexBlock({ ...beta.input, name: 'beta2' }, 'plain');
  assert.ok(back.includes('bearer_token_env_var = "BETA_TOKEN"') && back.includes('env_http_headers = { "X-Org" = "BETA_ORG" }'), back.join('\n'));
  assert.ok(previewText('claude', beta.input, 'plain').includes('Bearer ${BETA_TOKEN}'), 'a reference is shown, not masked');
  const alpha = neutralFrom('codex', 'alpha', c.values.get('alpha') ?? {});
  assert.ok(alpha.ok && !previewText('copilot', alpha.input, 'plain').includes('alpha-secret'), 'a plain value is masked in the review');
  const odd = addToText('codex', undefined, { name: 'o', transport: 'stdio', command: 'c', env: [{ key: 'A', ref: 'B' }] }, 'plain');
  assert.ok(!odd.ok && /own name/.test(odd.error));
  const exp = addToText('codex', undefined, { name: 'o', transport: 'stdio', command: 'c', env: [{ key: 'A', value: 'pre-${B}' }] }, 'plain');
  assert.ok(!exp.ok && /expand/.test(exp.error));
});
ok('differences name fields, never values', () => {
  const a = { name: 'n', transport: 'stdio' as const, command: 'c', args: ['1'], env: [{ key: 'K', value: 'one-secret' }] };
  assert.deepStrictEqual(differences(a, a), []);
  assert.deepStrictEqual(differences(a, { ...a, args: ['2'] }), ['arguments']);
  assert.deepStrictEqual(differences(a, { ...a, env: [{ key: 'K', value: 'two-secret' }] }), ['values']);
  assert.deepStrictEqual(differences(a, { ...a, env: [{ key: 'K', ref: 'K' }] }), ['values']);
  assert.deepStrictEqual(differences(a, { ...a, command: 'd', env: [] }), ['command', 'environment variables']);
});
ok('GlobalLists.diff: missing and different servers, no values; copy preview and apply', () => {
  const { home, lists } = fixtureHome();
  const d = lists.diff();
  assert.deepStrictEqual(d.apps, ['copilot', 'claude', 'codex']);
  assert.deepStrictEqual(d.items.map((i) => [i.name, i.in.join(), i.missing.join(), i.differs.join()]), [
    ['gh', 'copilot', 'claude,codex', ''],
    ['existing', 'claude', 'copilot,codex', ''],
    ['alpha', 'codex', 'copilot,claude', ''],
    ['beta', 'codex', 'copilot,claude', ''],
  ]);
  noSecret(d, 'diff');
  const pv = lists.copyPreview('alpha', 'codex', ['copilot', 'claude', 'codex']);
  assert.ok(pv.ok && pv.items.length === 2, 'the source app is not a target');
  noSecret(pv, 'copy preview');
  const res = lists.apply(pv.token);
  assert.ok(res.ok && res.items.every((i) => i.ok));
  const cl = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8'));
  assert.deepStrictEqual(cl.mcpServers.alpha, { type: 'stdio', command: 'alpha-mcp', args: ['--port', '4000'], env: { ALPHA_KEY: 'alpha-secret' } }, 'the value is copied as it was (plain in Codex)');
  const after = lists.diff();
  assert.ok(!after.items.some((i) => i.name === 'alpha'), 'alpha is now in step');
  // a differing definition: a review with a conflict, replaced only with the tick
  const f = path.join(home, '.claude.json');
  cl.mcpServers.alpha.args = ['--port', '5000'];
  fs.writeFileSync(f, JSON.stringify(cl));
  const d2 = lists.diff();
  assert.deepStrictEqual(d2.items.find((i) => i.name === 'alpha')?.differs, ['arguments']);
  const pv2 = lists.copyPreview('alpha', 'codex', ['claude']);
  assert.ok(pv2.items[0].conflict);
  assert.ok(!lists.apply(pv2.token).ok, 'not replaced without the tick');
  assert.ok(!lists.copyPreview('nope', 'codex', ['claude']).ok);
  assert.ok(!lists.copyPreview('alpha', 'evil', ['claude']).ok);
});
ok('GlobalLists.diff: fewer than two readable lists gives nothing', () => {
  const home = tmp();
  fs.writeFileSync(path.join(home, '.claude.json'), claudeFixture);
  const lists = new GlobalLists(() => globalFiles({}, home));
  // a missing file reads as an empty list: Copilot and Codex count as readable
  assert.ok(lists.diff().items.length > 0);
  fs.mkdirSync(path.join(home, '.codex'));
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'), 'mcp_servers = { a = { command = "x" } }\n');
  fs.mkdirSync(path.join(home, '.copilot'));
  fs.writeFileSync(path.join(home, '.copilot', 'mcp-config.json'), '{ broken');
  assert.deepStrictEqual(lists.diff(), { ok: true, apps: ['claude'], items: [] });
});

// ---------------------------------------------------------------- review on #489 (spec 069 change 2026-10-22)
ok('TOML strings: one-pass unescape, literal strings unchanged, shared by both Codex readers', () => {
  assert.strictEqual(tomlUnquote('"C:\\\\notes\\\\tmp"'), 'C:\\notes\\tmp', 'a Windows path is not a newline and a tab');
  assert.strictEqual(tomlUnquote('"a\\tb"'), 'a\tb');
  assert.strictEqual(tomlUnquote('"a\\nb\\rc\\bd\\fe"'), 'a\nb\rc\bd\fe');
  assert.strictEqual(tomlUnquote('"caf\\u00e9"'), 'café');
  assert.strictEqual(tomlUnquote('"\\U0001F600"'), '\u{1F600}');
  assert.strictEqual(tomlUnquote('"say \\"hi\\" \\\\o/"'), 'say "hi" \\o/');
  assert.strictEqual(tomlUnquote('"\\\\u00e9"'), '\\u00e9', 'an escaped backslash before u stays a backslash');
  assert.strictEqual(tomlUnquote("'C:\\notes\\tmp'"), 'C:\\notes\\tmp', 'literal strings are taken as written');
  assert.strictEqual(tomlUnquote("'\\u00e9'"), '\\u00e9');
  assert.strictEqual(tomlUnquote('"\\uD800"'), '\\uD800', 'a surrogate is not decoded');
  assert.strictEqual(tomlUnquote('bare'), undefined);
  assert.deepStrictEqual(tomlStringArray('["C:\\\\a\\\\new", \'x\\n\']'), ['C:\\a\\new', 'x\\n']);
  assert.strictEqual(stripTomlComment('k = "a#b" # c'), 'k = "a#b" ');
  const toml = '[mcp_servers.win]\ncommand = "C:\\\\tools\\\\node.exe"\nargs = ["C:\\\\notes\\\\tmp", \'D:\\new\']\n';
  const g = readGlobal('codex', toml);
  assert.ok(g.ok);
  assert.strictEqual(g.values.get('win')?.command, 'C:\\tools\\node.exe');
  assert.deepStrictEqual(g.values.get('win')?.args, ['C:\\notes\\tmp', 'D:\\new']);
  assert.deepStrictEqual(readCodexMcpToml(toml), [{ name: 'win', spec: { type: 'stdio', command: 'C:\\tools\\node.exe', args: ['C:\\notes\\tmp', 'D:\\new'] } }], 'spec 061 reads it the same way');
  const q = readGlobal('codex', '[mcp_servers."a\\u0062c"]\ncommand = "x"\n');
  assert.ok(q.ok && q.servers[0].name === 'abc', 'quoted table keys use the same unescape');
});

ok('symlinked file: written through the link, the link stays, backup next to the real file', () => {
  const d = tmp();
  const real = path.join(d, 'dotfiles', 'claude.json');
  fs.mkdirSync(path.dirname(real));
  fs.writeFileSync(real, '{"a":1}\n');
  const link = path.join(d, '.claude.json');
  try {
    fs.symlinkSync(real, link);
  } catch (e) {
    if (process.platform === 'win32') {
      console.log('skip symlink check (symlinks not permitted here):', (e as NodeJS.ErrnoException).code);
      return;
    }
    throw e;
  }
  assert.strictEqual(writeTarget(link), real);
  const w = backupAndWrite(link, '{"a":2}\n', textHash('{"a":1}\n'), Date.UTC(2026, 9, 22, 1, 0, 0));
  assert.ok(w.ok && w.backup, JSON.stringify(w));
  assert.ok(fs.lstatSync(link).isSymbolicLink(), 'the link is still a link');
  assert.strictEqual(fs.readFileSync(real, 'utf8'), '{"a":2}\n', 'the link target changed');
  assert.ok(fs.existsSync(path.join(path.dirname(real), w.backup as string)), 'backup next to the real file');
  assert.ok(!fs.readdirSync(d).some((x) => x.includes('durbar')), 'nothing written next to the link');
  // a dangling link (the app has not created the file yet): the file is created at the target
  const real2 = path.join(d, 'dotfiles', 'config.toml');
  const link2 = path.join(d, 'config.toml');
  fs.symlinkSync(real2, link2);
  assert.ok(backupAndWrite(link2, 'x = 1\n', textHash(undefined), Date.now()).ok);
  assert.ok(fs.lstatSync(link2).isSymbolicLink());
  assert.strictEqual(fs.readFileSync(real2, 'utf8'), 'x = 1\n');
  // a loop is refused, nothing written
  const l1 = path.join(d, 'l1');
  const l2 = path.join(d, 'l2');
  fs.symlinkSync(l2, l1);
  fs.symlinkSync(l1, l2);
  assert.strictEqual(writeTarget(l1), undefined);
  assert.ok(!backupAndWrite(l1, '{}', textHash(undefined), Date.now()).ok);
});

ok('FR-009 wiring: Claude agents only, Settings off-list, folder extra wins, values masked (through registerMcpIpc)', () => {
  // A stand-in for the electron module, so registerMcpIpc runs in plain Node (the handlers are recorded, never called here).
  const electronPath = require.resolve('electron');
  const handlers = new Map<string, unknown>();
  const fake = { ipcMain: { handle: (ch: string, fn: unknown) => handlers.set(ch, fn), on: () => undefined }, safeStorage: { isEncryptionAvailable: () => false } };
  const saved = require.cache[electronPath];
  require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fake } as unknown as NodeJS.Module;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { registerMcpIpc } = require('../src/main/mcpipc') as typeof import('../src/main/mcpipc');
    // spec 010 FR-031: main hands its simulator decision to the guard before registering anything; here: not the simulator
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('../src/main/ipcguard') as typeof import('../src/main/ipcguard')).initSimGuard(false);
    const d = tmp();
    const claudeFile = path.join(d, '.claude.json');
    const GSECRET = 'glob-planted-SECRET-55aa66bb';
    fs.writeFileSync(
      claudeFile,
      JSON.stringify({
        projects: {},
        mcpServers: {
          notes: { type: 'stdio', command: 'node', args: ['n.js'], env: { NOTES_TOKEN: GSECRET } },
          shared: { type: 'stdio', command: 'node', args: ['user.js'] },
          gone: { type: 'stdio', command: 'node', args: ['g.js'] },
        },
      }),
    );
    const lists = new GlobalLists(() => ({ copilot: { app: 'copilot', file: path.join(d, 'none.json'), label: 'c' }, claude: { app: 'claude', file: claudeFile, label: 'l' }, codex: { app: 'codex', file: path.join(d, 'none.toml'), label: 'x' } }));
    const store = new McpStore(path.join(d, 'm.json'));
    store.load();
    store.setAmbientDisabled(claudeOffKey('gone'), true);
    const folder = path.join(d, 'proj');
    const up = store.upsert(folder, { name: 'Shared', transport: 'stdio', command: 'node', args: ['folder.js'], env: [], headers: [] });
    assert.ok(up.ok, JSON.stringify(up));
    store.setEnabled(folder, 'Shared', true, true);
    const agent = (id: string, adapterId: string): AgentInfo => ({ id, name: 'proj', cwd: folder, folders: [folder], permMode: 'read-only', adapterId }) as unknown as AgentInfo;
    const agents = new Map<string, AgentInfo>([['c1', agent('c1', 'claude')], ['p1', agent('p1', 'copilot')], ['x1', agent('x1', 'codex')]]);
    const appOf = (id: string): string | undefined => agents.get(id)?.adapterId;
    const mcp = registerMcpIpc({
      store: () => store,
      agents,
      router: { onEvent: () => undefined, forAgent: () => undefined } as never,
      dev: {} as never,
      appOf,
      globalFor: (id) => sessionGlobalFor(appOf(id), lists, store.ambientDisabled()),
    });
    assert.ok(handlers.has('agents:mcp'));
    const c = mcp.optionsFor('c1').mcpServers;
    assert.deepStrictEqual(Object.keys(c).sort(), ['Shared', 'notes'], 'user list (minus the off-list) and the folder extra');
    assert.deepStrictEqual(c.Shared.args, ['folder.js'], 'a folder extra wins over a user-list server of the same name');
    assert.strictEqual(c.notes.env?.NOTES_TOKEN, GSECRET, 'the session gets the value (main only)');
    assert.ok(!('gone' in c), 'the Settings off-list is honoured');
    for (const id of ['p1', 'x1']) assert.deepStrictEqual(Object.keys(mcp.optionsFor(id).mcpServers), ['Shared'], `no Claude user list for ${id}`);
    assert.ok(mcp.secretValuesFor('c1').includes(GSECRET), 'user-list values are masked in MCP events');
    assert.ok(!mcp.secretValuesFor('p1').includes(GSECRET));
    assert.deepStrictEqual(mcpSecretValues({ a: { type: 'stdio', command: 'x', env: { K: 'value-1' } } }, undefined, { b: { type: 'http', url: 'u', headers: { H: 'value-2' } } }).sort(), ['value-1', 'value-2']);
    assert.deepStrictEqual(Object.keys(mergeSessionServers({ x: { type: 'http', url: 'u' }, y: { type: 'http', url: 'v' } }, {}, new Set(['y']))), ['x'], 'the agent\'s own off-switch drops a user-list server');
  } finally {
    if (saved) require.cache[electronPath] = saved;
    else delete require.cache[electronPath];
  }
});

// ---------------------------------------------------------------- review on #492 (spec 069 change 2026-10-22)
ok('copy preview masks a secret in the source command, arguments and URL (FR-012, SC-002)', () => {
  const home = tmp();
  fs.mkdirSync(path.join(home, '.codex'));
  const ARG = 'ghp_plantedARGsecret0123456789abcdefABCD';
  const URLK = 'planted-url-key-SECRET-778899';
  const CMDK = 'planted-cmd-SECRET-445566';
  fs.writeFileSync(
    path.join(home, '.codex', 'config.toml'),
    `[mcp_servers.leaky]\ncommand = "env API_TOKEN=${CMDK} leaky-mcp"\nargs = ["--api-key", "${ARG}", "--token=${ARG}"]\n\n[mcp_servers.leakyhttp]\nurl = "https://mcp.example.com/mcp?api_key=${URLK}"\n`,
  );
  const lists = new GlobalLists(() => globalFiles({}, home));
  for (const name of ['leaky', 'leakyhttp']) {
    const pv = lists.copyPreview(name, 'codex', ['copilot', 'claude']);
    assert.ok(pv.ok && pv.items.length === 2, JSON.stringify(pv));
    const out = JSON.stringify(pv);
    for (const x of [ARG, URLK, CMDK]) assert.ok(!out.includes(x), `${name}: the copy preview holds a planted value`);
    const res = lists.apply(pv.token);
    assert.ok(res.ok, 'the real values are still written');
  }
  const cl = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8'));
  assert.deepStrictEqual(cl.mcpServers.leaky.args, ['--api-key', ARG, `--token=${ARG}`], 'the file gets the value, the window does not');
  assert.ok(cl.mcpServers.leakyhttp.url.includes(URLK));
  assert.ok(!previewText('codex', { name: 'a', transport: 'http', url: `https://x/mcp?token=${URLK}` }, 'ref').includes(URLK), 'the add review masks too');
});

ok('copy keeps switched off, hidden tools and tool lists, or refuses the file that cannot hold them', () => {
  const toml = [
    '[mcp_servers.offsrv]',
    'command = "off-mcp"',
    'enabled = false',
    '',
    '[mcp_servers.hide]',
    'command = "hide-mcp"',
    'disabled_tools = ["delete_repo", "push"]',
    '',
    '[mcp_servers.only]',
    'url = "https://only.example.com/mcp"',
    'enabled_tools = ["search"]',
    '',
  ].join('\n');
  const g = readGlobal('codex', toml);
  assert.ok(g.ok);
  const off = neutralFrom('codex', 'offsrv', g.values.get('offsrv') ?? {});
  assert.ok(off.ok && off.input.off === true, 'enabled = false is read');
  for (const app of ['copilot', 'claude'] as const) {
    const r = addToText(app, undefined, off.input, 'plain');
    assert.ok(!r.ok && /enabled = false/.test(r.error), `${app}: a switched-off server is not copied as on`);
  }
  const back = addToText('codex', undefined, { ...off.input, name: 'offsrv2' }, 'plain');
  assert.ok(back.ok && back.text.includes('enabled = false'), 'Codex keeps it off');
  const hide = neutralFrom('codex', 'hide', g.values.get('hide') ?? {});
  assert.ok(hide.ok && JSON.stringify(hide.input.disabledTools) === '["delete_repo","push"]');
  for (const app of ['copilot', 'claude'] as const) {
    const r = addToText(app, undefined, hide.input, 'plain');
    assert.ok(!r.ok && /disabled_tools/.test(r.error), `${app}: hidden tools are not dropped silently`);
  }
  const hb = addToText('codex', undefined, { ...hide.input, name: 'hide2' }, 'plain');
  assert.ok(hb.ok && hb.text.includes('disabled_tools = ["delete_repo", "push"]'), 'Codex takes the list (a list, not a string)');
  const re = readGlobal('codex', hb.ok ? hb.text : '');
  assert.ok(re.ok && JSON.stringify(re.values.get('hide2')?.disabled_tools) === '["delete_repo","push"]', 'and reads it back');
  const only = neutralFrom('codex', 'only', g.values.get('only') ?? {});
  assert.ok(only.ok);
  const cop = addToText('copilot', undefined, only.input, 'plain');
  assert.ok(cop.ok && JSON.parse(cop.text).mcpServers.only.tools[0] === 'search', 'Copilot keeps the tool list');
  const cla = addToText('claude', undefined, only.input, 'plain');
  assert.ok(!cla.ok && /tools/.test(cla.error), 'Claude Code cannot hold a tool list: refused');
  const copTools = neutralFrom('copilot', 't', { type: 'local', command: 'x', tools: ['a', 'b'] });
  assert.ok(copTools.ok && !addToText('claude', undefined, copTools.input, 'plain').ok, 'a Copilot tools list is not dropped for Claude');
  const star = neutralFrom('copilot', 't', { type: 'local', command: 'x', tools: ['*'] });
  assert.ok(star.ok && addToText('claude', undefined, star.input, 'plain').ok, 'tools ["*"] is no restriction');
  assert.ok(addToText('claude', undefined, { name: 'f', transport: 'stdio', command: 'x', tools: ['a'] }, 'plain').ok, 'the add form keeps its old behaviour');
  const cwd = neutralFrom('claude', 'w', { type: 'stdio', command: 'x', cwd: '/proj' });
  assert.ok(!cwd.ok && /working directory/.test(cwd.error), 'a JSON cwd is refused like a Codex cwd');
  const offJson = neutralFrom('copilot', 'd', { type: 'local', command: 'x', disabled: true });
  assert.ok(offJson.ok && offJson.input.off, 'JSON disabled: true is read as off');
  assert.ok(!neutralFrom('codex', 'e', { command: 'x', enabled: 'no' }).ok, 'an enabled that is not a boolean is not guessed');
});

ok('differences name tools, hidden tools and on/off; the diff lists them', () => {
  const a = { name: 'n', transport: 'stdio' as const, command: 'c' };
  assert.deepStrictEqual(differences(a, { ...a, tools: ['*'] }), [], '"*" is the same as no list');
  assert.deepStrictEqual(differences(a, { ...a, tools: ['x'] }), ['tools']);
  assert.deepStrictEqual(differences(a, { ...a, disabledTools: ['x'] }), ['hidden tools']);
  assert.deepStrictEqual(differences(a, { ...a, off: true }), ['on/off']);
  const home = tmp();
  fs.mkdirSync(path.join(home, '.codex'));
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'), '[mcp_servers.s]\ncommand = "s"\nenabled = false\n');
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { s: { type: 'stdio', command: 's', args: [] } } }));
  const lists = new GlobalLists(() => globalFiles({}, home));
  assert.deepStrictEqual(lists.diff().items.find((i) => i.name === 's')?.differs, ['on/off']);
});

console.log(`test-mcp-global: ${n} checks passed`);
