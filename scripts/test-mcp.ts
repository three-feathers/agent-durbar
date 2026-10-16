/** MCP tests (specs 019, 020): validation, secret handling, trust, per-folder extras, legacy migration, file parsers, CLI list, session resolution. No credits: `npm run test:mcp`. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { trustHash, validateInput } from '../src/shared/mcp';
import { parseMcpConfig } from '../src/shared/mcpimport';
import { McpStore } from '../src/main/mcpstore';
import { CLI_FILE_LABEL, cliServers, copilotDir, readCandidates } from '../src/main/mcpfiles';
import type { SecretCodec } from '../src/main/mcpstore';

const fx = (n: string): string => fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'fixtures', 'mcp', n), 'utf8');
const tmp = (): string => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-mcp-')), 'durbar-mcp.json');
const K1 = '/work/folder-a';
const K2 = '/work/folder-b';
const SECRET = 'sk-test-DUMMY-secret-value';
/** Not real crypto: only proves the plain value is not what is written. */
const codec = (available = true): SecretCodec => ({
  available: () => available,
  encrypt: (s) => 'ENC1:' + Buffer.from(s.split('').reverse().join('')).toString('base64'),
  decrypt: (b) => Buffer.from(b.slice(5), 'base64').toString().split('').reverse().join(''),
});

// 1. Validation
{
  const ok = validateInput({ name: 'echo', transport: 'stdio', command: 'node', args: ['a.js'], env: [{ key: 'API_KEY', value: SECRET }] });
  assert.ok(ok.ok);
  for (const bad of [
    { name: '', transport: 'stdio', command: 'x' },
    { name: 'a b', transport: 'stdio', command: 'x' },
    { name: 'a', transport: 'ftp', command: 'x' },
    { name: 'a', transport: 'stdio', command: '' },
    { name: 'a', transport: 'stdio', command: 'x\ny' },
    { name: 'a', transport: 'stdio', command: 'x', workingDirectory: 'relative/dir' },
    { name: 'a', transport: 'stdio', command: 'x', env: [{ key: '1BAD', value: 'v' }] },
    { name: 'a', transport: 'stdio', command: 'x', env: [{ key: 'A', value: 'v' }, { key: 'a', value: 'w' }] },
    { name: 'a', transport: 'stdio', command: 'x', headers: [{ key: 'H', value: 'v' }] },
    { name: 'a', transport: 'http', url: 'file:///etc/passwd' },
    { name: 'a', transport: 'http', url: 'not a url' },
    { name: 'a', transport: 'http', url: 'https://user:pw@example.test/' },
    { name: 'a', transport: 'sse', url: 'https://example.test/', env: [{ key: 'A', value: 'v' }] },
    null,
  ]) assert.strictEqual(validateInput(bad).ok, false, JSON.stringify(bad));
  assert.ok(validateInput({ name: 'remote', transport: 'http', url: 'https://example.test/mcp', headers: [{ key: 'X-Api-Key', value: 'v' }] }).ok);
  assert.notStrictEqual(trustHash({ transport: 'stdio', command: 'node', args: ['a'] }), trustHash({ transport: 'stdio', command: 'node', args: ['b'] }));
  assert.strictEqual(trustHash({ transport: 'stdio', command: 'node', args: ['a'] }), trustHash({ transport: 'stdio', command: 'node', args: ['a'] }));
}

// 2. Store with a codec: secrets masked in views, encrypted on disk, round trip, trust flow
{
  const f = tmp();
  const s = new McpStore(f, codec());
  s.load();
  const r = s.upsert(K1, { name: 'echo', transport: 'stdio', command: 'node', args: ['echo.js'], env: [{ key: 'API_KEY', value: SECRET }] });
  assert.ok(r.ok && r.view);
  assert.ok(!JSON.stringify(s.list(K1)).includes(SECRET), 'views never carry the secret value');
  assert.deepStrictEqual(r.view?.env, [{ key: 'API_KEY', set: true }]);
  const disk = fs.readFileSync(f, 'utf8');
  assert.ok(!disk.includes(SECRET), 'plain secret is not written');
  assert.ok(disk.includes('ENC1:'), 'encrypted blob is written');
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(f).mode & 0o077, 0, 'file is private');
  // not trusted yet: enabling asks first
  const e1 = s.setEnabled(K1, 'echo', true);
  assert.strictEqual(e1.ok, false);
  assert.strictEqual(e1.needsTrust?.command, 'node');
  assert.deepStrictEqual(s.forSession(K1).mcpServers, {}, 'a server that was never enabled is not passed');
  const e2 = s.setEnabled(K1, 'echo', true, true);
  assert.ok(e2.ok && e2.view?.enabled && e2.view.trusted);
  const sess = s.forSession(K1);
  assert.deepStrictEqual(sess.mcpServers.echo, { type: 'stdio', command: 'node', args: ['echo.js'], env: { API_KEY: SECRET }, workingDirectory: undefined, tools: ['*'] });
  // reload: decrypts
  const s2 = new McpStore(f, codec());
  s2.load();
  assert.strictEqual(s2.forSession(K1).mcpServers.echo.env?.API_KEY, SECRET);
  assert.ok(s2.list(K1)[0].trusted && s2.list(K1)[0].enabled);
  // edit keeping the secret (value undefined), same command: stays enabled and trusted
  const ed = s2.upsert(K1, { name: 'echo', transport: 'stdio', command: 'node', args: ['echo.js'], env: [{ key: 'API_KEY' }, { key: 'EXTRA', value: 'x' }] }, 'echo');
  assert.ok(ed.ok && ed.view?.enabled && ed.view.trusted);
  assert.strictEqual(s2.forSession(K1).mcpServers.echo.env?.API_KEY, SECRET, 'blank secret input keeps the stored value');
  // changing the command resets trust and switches it off
  const ch = s2.upsert(K1, { name: 'echo', transport: 'stdio', command: 'node', args: ['other.js'], env: [{ key: 'API_KEY' }] }, 'echo');
  assert.ok(ch.ok && !ch.view?.enabled && !ch.view?.trusted);
  assert.deepStrictEqual(s2.forSession(K1).mcpServers, {});
  // clash and rename
  assert.strictEqual(s2.upsert(K1, { name: 'ECHO', transport: 'stdio', command: 'x' }).ok, false, 'names are unique, case-insensitive');
  assert.ok(s2.upsert(K1, { name: 'echo2', transport: 'stdio', command: 'x' }, 'echo').ok);
  assert.strictEqual(s2.list(K1).length, 1);
  assert.ok(s2.remove(K1, 'echo2') && s2.list(K1).length === 0);
}

// 3. Without a codec (no OS-protected store): secrets are not written, kept in memory for the run, reported after restart
{
  const f = tmp();
  const s = new McpStore(f, codec(false));
  s.load();
  assert.strictEqual(s.secretsPersist, false);
  s.upsert(K1, { name: 'remote', transport: 'http', url: 'https://example.test/mcp', headers: [{ key: 'Authorization', value: 'Bearer ' + SECRET }] });
  s.setEnabled(K1, 'remote', true, true);
  assert.ok(!fs.readFileSync(f, 'utf8').includes(SECRET), 'never on disk without safeStorage');
  assert.strictEqual(s.forSession(K1).mcpServers.remote.headers?.Authorization, 'Bearer ' + SECRET, 'usable in this run');
  const s2 = new McpStore(f, codec(false));
  s2.load();
  assert.strictEqual(s2.list(K1)[0].needsSecrets, true);
  assert.deepStrictEqual(s2.forSession(K1).mcpServers, {});
  assert.match(s2.forSession(K1).skipped[0].reason, /secret values/);
  s2.upsert(K1, { name: 'remote', transport: 'http', url: 'https://example.test/mcp', headers: [{ key: 'Authorization', value: 'new' }] }, 'remote');
  assert.strictEqual(s2.list(K1)[0].needsSecrets, false);
  // no codec object at all behaves the same
  const s3 = new McpStore(tmp());
  s3.load();
  s3.upsert(K1, { name: 'x', transport: 'stdio', command: 'node', env: [{ key: 'K', value: 'v' }] });
  assert.strictEqual(s3.secretsPersist, false);
}

// 4. Session resolution: ambient switch-off list and per-agent overrides
{
  const s = new McpStore(tmp(), codec());
  s.load();
  s.upsert(K1, { name: 'a', transport: 'stdio', command: 'node', args: ['a.js'] });
  s.upsert(K1, { name: 'b', transport: 'stdio', command: 'node', args: ['b.js'] });
  s.setEnabled(K1, 'a', true, true);
  s.setEnabled(K1, 'b', true, true);
  s.setAmbientDisabled('github-mcp-server', true);
  s.setAmbientDisabled('echo-user', true);
  let r = s.forSession(K1);
  assert.deepStrictEqual(Object.keys(r.mcpServers).sort(), ['a', 'b']);
  assert.deepStrictEqual(r.disabledMcpServers.sort(), ['echo-user', 'github-mcp-server']);
  r = s.forSession(K1, ['b', 'playwright']);
  assert.deepStrictEqual(Object.keys(r.mcpServers), ['a']);
  assert.deepStrictEqual(r.disabledMcpServers.sort(), ['b', 'echo-user', 'github-mcp-server', 'playwright']);
  s.setAmbientDisabled('echo-user', false);
  assert.ok(!s.forSession(K1).disabledMcpServers.includes('echo-user'));
  // an enabled inline server is not also listed as disabled
  s.setAmbientDisabled('a', true);
  assert.ok(!s.forSession(K1).disabledMcpServers.includes('a') && 'a' in s.forSession(K1).mcpServers);
  // a corrupt file means an empty list
  const f = tmp();
  fs.writeFileSync(f, '{not json');
  const bad = new McpStore(f, codec());
  bad.load();
  assert.deepStrictEqual(bad.list(K1), []);
}

// 5. Import parsers (read-only: they only get text; kept for the CLI list and a later per-folder VS Code import)
{
  const c = parseMcpConfig(fx('copilot-mcp-config.json'), 'copilot');
  assert.ok(c.ok);
  assert.strictEqual(c.candidates.length, 4);
  assert.strictEqual(c.skipped, 2, 'the entry without command/url and the non-object are skipped');
  const by = Object.fromEntries(c.candidates.map((x) => [x.name, x]));
  assert.strictEqual(by.playwright.transport, 'stdio');
  assert.strictEqual(by.context7.transport, 'http');
  assert.deepStrictEqual(by.context7.headers, { EXAMPLE_API_KEY: 'dummy-not-a-real-key' });
  assert.ok(by['weird-name'], 'name sanitised');
  assert.ok(by['weird-name'].notes.some((n) => /Renamed/.test(n)));
  assert.strictEqual(by['weird-name'].transport, 'stdio', 'no type + command means stdio');
  assert.strictEqual(by['legacy-sse'].transport, 'sse');
  const v = parseMcpConfig(fx('vscode-mcp.json'), 'vscode');
  assert.ok(v.ok && v.candidates.length === 3);
  const gh = v.candidates.find((x) => x.name === 'github');
  assert.ok(gh?.notes.some((n) => /variables/.test(n)), 'input variables are flagged');
  assert.ok(v.candidates.find((x) => x.name === 'fs')?.notes.some((n) => /envFile/.test(n)));
  assert.strictEqual(parseMcpConfig(fx('vscode-mcp.json'), 'copilot').candidates.length, 0);
  assert.strictEqual(parseMcpConfig('{oops', 'vscode').ok, false);
  assert.strictEqual(parseMcpConfig('{"a":{"command":"node"}}', 'copilot').candidates.length, 1, 'bare top-level format');
}

// 6. The Copilot CLI list: read live from ~/.copilot/mcp-config.json, no setup, read-only (spec 020 FR-009)
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-copilot-'));
  let r = cliServers(dir, new Set());
  assert.deepStrictEqual(r.servers.map((a) => a.name), ['github-mcp-server'], 'built-in server is listed even without a config file');
  assert.deepStrictEqual(r.file, { label: CLI_FILE_LABEL, found: false, error: undefined, skipped: 0 });
  assert.ok(!JSON.stringify(r).includes(dir), 'the real path is never part of the view');
  fs.writeFileSync(path.join(dir, 'mcp-config.json'), fx('copilot-mcp-config.json'));
  const before = fs.readFileSync(path.join(dir, 'mcp-config.json'), 'utf8');
  r = cliServers(dir, new Set(['context7', 'github-mcp-server']));
  assert.strictEqual(r.file.found, true);
  assert.strictEqual(r.file.skipped, 2);
  assert.deepStrictEqual(r.servers.map((a) => [a.name, a.enabled]), [['playwright', true], ['context7', false], ['weird name!', true], ['legacy-sse', true], ['github-mcp-server', false]]);
  assert.strictEqual(r.servers[2].name, 'weird name!', 'names are the exact config keys (the runtime matches them)');
  assert.ok(!JSON.stringify(r).includes('dummy-secret-1') && !JSON.stringify(r).includes('dummy-not-a-real-key'), 'no secret values in views');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'mcp-config.json'), 'utf8'), before, 'files are never modified');
  // edits of the file show up on the next read (the list is read live, not cached)
  fs.writeFileSync(path.join(dir, 'mcp-config.json'), JSON.stringify({ mcpServers: { fresh: { type: 'local', command: 'node', args: ['x.js'] } } }));
  assert.deepStrictEqual(cliServers(dir, new Set()).servers.map((a) => a.name), ['fresh', 'github-mcp-server']);
  // malformed file: reported, built-in still listed
  fs.writeFileSync(path.join(dir, 'mcp-config.json'), '{oops');
  r = cliServers(dir, new Set());
  assert.strictEqual(r.file.found, true);
  assert.ok(r.file.error, 'a parse error is reported');
  assert.deepStrictEqual(r.servers.map((a) => a.name), ['github-mcp-server']);
  assert.strictEqual(readCandidates(path.join(dir, 'nope.json'), 'copilot'), undefined);
  assert.strictEqual(copilotDir({ DURBAR_COPILOT_DIR: '/x' } as NodeJS.ProcessEnv, '/home/u'), '/x');
  assert.strictEqual(copilotDir({} as NodeJS.ProcessEnv, '/home/u'), path.join('/home/u', '.copilot'));
}

// 7. Extras are per folder/workspace only (spec 020 FR-012, FR-014, FR-015)
{
  const f = tmp();
  const s = new McpStore(f, codec());
  s.load();
  const mk = (name: string, extra: Record<string, unknown> = {}) => ({ name, transport: 'stdio', command: 'node', args: [name + '.js'], ...extra });
  assert.ok(s.upsert(K1, mk('only-a', { env: [{ key: 'TOKEN', value: SECRET }] })).ok);
  assert.ok(s.upsert(K2, mk('only-b')).ok);
  assert.ok(s.upsert(K2, mk('only-a')).ok, 'the same name may exist in another folder');
  s.setEnabled(K1, 'only-a', true, true);
  s.setEnabled(K2, 'only-b', true, true);
  assert.deepStrictEqual(s.list(K1).map((x) => x.name), ['only-a']);
  assert.deepStrictEqual(s.list(K2).map((x) => x.name), ['only-b', 'only-a']);
  assert.deepStrictEqual(s.list('/work/none'), []);
  assert.deepStrictEqual(Object.keys(s.forSession(K1).mcpServers), ['only-a'], 'folder A agents get only A extras');
  assert.deepStrictEqual(Object.keys(s.forSession(K2).mcpServers), ['only-b'], 'B: only-a is B\'s own, off and untrusted, so not passed');
  assert.deepStrictEqual(s.forSession('/work/none').mcpServers, {}, 'a folder without extras gets none');
  assert.strictEqual(s.forSession(K2).mcpServers['only-a'], undefined, 'a secret of folder A never reaches folder B');
  assert.ok(!JSON.stringify(s.forSession(K2)).includes(SECRET));
  assert.strictEqual(s.forSession(K1).mcpServers['only-a'].env?.TOKEN, SECRET);
  // trust is per folder (the same definition must be confirmed in each)
  assert.strictEqual(s.setEnabled(K2, 'only-a', true).needsTrust?.name, 'only-a');
  // removing from one folder leaves the other
  assert.ok(s.remove(K2, 'only-a'));
  assert.strictEqual(s.list(K1).length, 1);
  assert.strictEqual(s.remove(K2, 'only-a'), false);
  // a name of the Copilot CLI list is refused
  assert.match(s.upsert(K1, mk('Playwright'), undefined, ['playwright']).error ?? '', /Copilot CLI list/);
  assert.ok(s.upsert(K1, mk('mine'), undefined, ['playwright']).ok);
  // a clashing extra is skipped for sessions (the CLI file gained the name later)
  s.setEnabled(K1, 'mine', true, true);
  const sk = s.forSession(K1, [], ['MINE']);
  assert.strictEqual(sk.mcpServers.mine, undefined);
  assert.match(sk.skipped[0].reason, /same name as a Copilot CLI server/);
  // keys: junk is refused
  for (const bad of ['', 'x'.repeat(5000), undefined as unknown as string]) assert.strictEqual(s.upsert(bad, mk('z')).ok, false);
  // persistence round trip keeps the scoping and the secrets
  const s2 = new McpStore(f, codec());
  s2.load();
  assert.deepStrictEqual(s2.list(K1).map((x) => x.name), ['only-a', 'mine']);
  assert.deepStrictEqual(s2.list(K2).map((x) => x.name), ['only-b']);
  assert.strictEqual(s2.forSession(K1, [], []).mcpServers['only-a'].env?.TOKEN, SECRET);
  assert.ok(!fs.readFileSync(f, 'utf8').includes(SECRET));
  assert.strictEqual(JSON.parse(fs.readFileSync(f, 'utf8')).version, 2);
}

// 8. Migration of the milestone-8 global list: kept as legacy, never applied, movable into a folder (FR-015)
{
  const f = tmp();
  const v1 = { version: 1, servers: [
    { name: 'old-one', transport: 'stdio', enabled: true, command: 'node', args: ['old.js'], trust: 'x', env: [{ key: 'K', enc: 'ENC1:' + Buffer.from(SECRET.split('').reverse().join('')).toString('base64') }], headers: [] },
    { name: 'old-two', transport: 'http', enabled: true, url: 'https://example.test/mcp', env: [], headers: [] },
    { name: 'bad name', transport: 'stdio', command: 'x' },
  ], disabledAmbient: ['github-mcp-server'] };
  fs.writeFileSync(f, JSON.stringify(v1));
  const s = new McpStore(f, codec());
  s.load();
  assert.deepStrictEqual(s.legacyList().map((x) => x.name), ['old-one', 'old-two'], 'valid old servers are kept, invalid dropped');
  assert.ok(s.legacyList().every((x) => !x.enabled), 'legacy servers are shown off');
  assert.deepStrictEqual(s.forSession(K1).mcpServers, {}, 'legacy servers are not passed to any session');
  assert.deepStrictEqual(s.forSession(K2).mcpServers, {});
  assert.deepStrictEqual(s.ambientDisabled(), ['github-mcp-server'], 'the global CLI-list switches survive');
  assert.ok(!JSON.stringify(s.legacyList()).includes(SECRET));
  // moving puts it into the folder, off and untrusted, secrets kept
  assert.strictEqual(s.moveLegacy('old-one', K1, ['playwright']).ok, true);
  assert.deepStrictEqual(s.legacyList().map((x) => x.name), ['old-two']);
  const moved = s.list(K1)[0];
  assert.ok(moved.name === 'old-one' && !moved.enabled && !moved.trusted);
  assert.deepStrictEqual(moved.env, [{ key: 'K', set: true }]);
  assert.deepStrictEqual(s.forSession(K1).mcpServers, {}, 'moved servers must be trusted again');
  s.setEnabled(K1, 'old-one', true, true);
  assert.strictEqual(s.forSession(K1).mcpServers['old-one'].env?.K, SECRET);
  assert.deepStrictEqual(s.forSession(K2).mcpServers, {}, 'and they belong to that folder only');
  // clash with a CLI name, unknown names, remove
  assert.strictEqual(s.moveLegacy('old-two', K1, ['OLD-TWO']).ok, false);
  assert.strictEqual(s.moveLegacy('nope', K1).ok, false);
  assert.strictEqual(s.moveLegacy('old-two', '').ok, false);
  assert.ok(s.removeLegacy('old-two'));
  assert.strictEqual(s.removeLegacy('old-two'), false);
  // saved as version 2 and reloaded
  const s2 = new McpStore(f, codec());
  s2.load();
  assert.deepStrictEqual(s2.legacyList(), []);
  assert.deepStrictEqual(s2.list(K1).map((x) => x.name), ['old-one']);
}

console.log('mcp tests passed');
