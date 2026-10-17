/** MCP tests (specs 019, 020): validation, secret handling, trust, per-folder extras, legacy migration, file parsers, CLI list, session resolution. No credits: `npm run test:mcp`. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { trustHash, validateInput } from '../src/shared/mcp';
import { candidateInput, parseMcpConfig, parseVSCodeMcp, stripJsonc } from '../src/shared/mcpimport';
import { applyFolderImport, previewFolderImport, readVSCodeFile } from '../src/main/mcpimport';
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

// 5. Parser of the Copilot CLI file (read-only: it only gets text). The VS Code parser is section 9.
{
  const c = parseMcpConfig(fx('copilot-mcp-config.json'));
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
  assert.strictEqual(parseMcpConfig(fx('vscode-mcp.json')).candidates.length, 0, 'a VS Code file is not a CLI file');
  assert.strictEqual(parseMcpConfig('{oops').ok, false);
  assert.strictEqual(parseMcpConfig('{"a":{"command":"node"}}').candidates.length, 1, 'bare top-level format');
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
  // decision 2026-10-16: the CLI list is not trust-gated (same as Copilot CLI); only folder extras are
  assert.ok(r.servers.every((a) => !('trusted' in a) && !('needsTrust' in a) && !('trust' in a)), 'CLI-list servers carry no trust state');
  // edits of the file show up on the next read (the list is read live, not cached)
  fs.writeFileSync(path.join(dir, 'mcp-config.json'), JSON.stringify({ mcpServers: { fresh: { type: 'local', command: 'node', args: ['x.js'] } } }));
  assert.deepStrictEqual(cliServers(dir, new Set()).servers.map((a) => a.name), ['fresh', 'github-mcp-server']);
  // malformed file: reported, built-in still listed
  fs.writeFileSync(path.join(dir, 'mcp-config.json'), '{oops');
  r = cliServers(dir, new Set());
  assert.strictEqual(r.file.found, true);
  assert.ok(r.file.error, 'a parse error is reported');
  assert.deepStrictEqual(r.servers.map((a) => a.name), ['github-mcp-server']);
  assert.strictEqual(readCandidates(path.join(dir, 'nope.json')), undefined);
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


// 9. Per-folder import from VS Code's .vscode/mcp.json (spec 020 FR-020..FR-031, issue #7)
{
  // 9a. JSONC tolerance
  const j = stripJsonc('\ufeff// c\n{"a": "http://x//y", /* b */ "l": [1, 2,], "o": {"k": 1,},\n}');
  assert.ok(j.ok);
  assert.deepStrictEqual(JSON.parse((j as { text: string }).text), { a: 'http://x//y', l: [1, 2], o: { k: 1 } }, 'comments, BOM, trailing commas; // inside a string stays');
  assert.deepStrictEqual(JSON.parse((stripJsonc('{"s": "a\\"//b", "t": "/* not a comment */"}') as { text: string }).text), { s: 'a"//b', t: '/* not a comment */' });
  assert.strictEqual(stripJsonc('{ /* open').ok, false, 'an unclosed block comment is an error');

  const WS = path.join(os.tmpdir(), 'ws-root');
  const p = parseVSCodeMcp(fx('vscode-mcp.jsonc'), { workspaceFolder: WS });
  assert.ok(p.ok, p.error);
  assert.deepStrictEqual(p.inputs, ['api-key', 'region'], 'input ids are only named');
  assert.strictEqual(p.skipped, 3, 'unknown type, no command/url, not an object');
  assert.ok(p.candidates.some((c) => c.originalName === 'ws://odd name' && c.name === 'ws-odd-name'));
  const by = Object.fromEntries(p.candidates.map((c) => [c.originalName, c]));
  // types
  assert.strictEqual(by.playwright.transport, 'stdio', 'no type + command = stdio');
  assert.deepStrictEqual(by.playwright.args, ['@playwright/mcp@latest']);
  assert.strictEqual(by.docs.transport, 'http');
  assert.strictEqual(by['old-sse'].transport, 'sse');
  assert.strictEqual(by['unknown-type'], undefined, 'unknown type is skipped');
  assert.strictEqual(by['no-target'], undefined);
  assert.strictEqual(by['not-an-object'], undefined);
  // ${workspaceFolder} is resolved, nothing else
  assert.deepStrictEqual(by.fs.args, ['-y', '@example/server-filesystem', WS]);
  assert.strictEqual(by['abs-cwd'].workingDirectory, WS + '/sub');
  // env: literal copied; ${input}/${env} references and empty values carry no value; invalid keys ignored with a note; numbers as text
  assert.deepStrictEqual(by.fs.env, [{ key: 'DEBUG', value: 'dummy-literal-value' }, { key: 'TOKEN' }, { key: 'FROM_ENV' }, { key: 'PORT', value: '3000' }, { key: 'EMPTY' }]);
  assert.ok(by.fs.notes.some((n) => /Ignored variable "bad-key"/.test(n)));
  assert.ok(by.fs.notes.some((n) => /TOKEN: contains a \$\{\.\.\.\} reference/.test(n)));
  assert.ok(by.fs.notes.some((n) => /Ignored fields: envFile, sandbox/.test(n)) && by.fs.notes.some((n) => /envFile" is not read/.test(n)), 'ignored fields are listed');
  assert.strictEqual(by.fs.blocked, undefined, 'a server with dropped secret references is still importable (key kept, no value)');
  assert.deepStrictEqual(by.docs.headers, [{ key: 'X-Api-Key', value: 'dummy-header-secret' }, { key: 'Authorization' }]);
  // inputs / unresolved variables in command, args, url, cwd block the entry (arguments are shown and stored in clear)
  assert.match(by['needs-input'].blocked ?? '', /VS Code asks you for \(\$\{input:region\}\)/);
  assert.match(by['needs-env'].blocked ?? '', /not resolved here/);
  assert.match(by['creds-in-url'].blocked ?? '', /credentials/i, 'the app\'s own validation blocks the rest');
  assert.match(by['rel-cwd'].blocked ?? '', /absolute/i);
  assert.strictEqual(by['abs-cwd'].blocked, undefined);
  // remote entry: command/env are ignored with a note
  assert.ok(by['remote-with-command'].notes.some((n) => /Ignored fields: command, env/.test(n)));
  assert.deepStrictEqual(by['remote-with-command'].env, [], 'env of a remote server is not imported');
  // names
  assert.ok(by['weird/name'].name === 'weird-name' && by['weird/name'].notes.some((n) => /Renamed/.test(n)));
  // secret values never appear in notes or blocked text
  assert.ok(!JSON.stringify(p.candidates.map((c) => [c.notes, c.blocked])).match(/dummy-(literal-value|header-secret)/));
  // the form input a candidate makes passes the app's validation (so the store accepts it)
  assert.ok(['playwright', 'fs', 'docs', 'old-sse', 'abs-cwd', 'weird/name'].every((n) => by[n].blocked === undefined));
  // bad files
  assert.strictEqual(parseVSCodeMcp('{oops', { workspaceFolder: WS }).ok, false);
  assert.ok(!/oops/.test(parseVSCodeMcp('{oops', { workspaceFolder: WS }).error ?? ''), 'the parse error does not echo file content');
  assert.strictEqual(parseVSCodeMcp('[1]', { workspaceFolder: WS }).ok, false);
  assert.strictEqual(parseVSCodeMcp('{"servers": []}', { workspaceFolder: WS }).ok, false);
  assert.deepStrictEqual(parseVSCodeMcp('{"inputs": []}', { workspaceFolder: WS }).candidates, [], 'no servers map is not an error');
  assert.deepStrictEqual(parseVSCodeMcp('{"servers": {"a": {"command": "node"}, "A": {"command": "deno"}}}', { workspaceFolder: WS }).candidates.map((c) => c.name), ['a', 'A-2'], 'names that differ only by case stay unique');
  assert.strictEqual(candidateInput(by.docs).env?.length, 0);

  // 9b. Preview (main): masked, no values, digest; files on disk; read-only
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-vsimp-'));
  const projA = path.join(root, 'proj-a');
  fs.mkdirSync(path.join(projA, '.vscode'), { recursive: true });
  const fileA = path.join(projA, '.vscode', 'mcp.json');
  fs.writeFileSync(fileA, fx('vscode-mcp.jsonc'));
  const beforeA = fs.readFileSync(fileA, 'utf8');
  const cliDir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-copilot-'));
  fs.writeFileSync(path.join(cliDir, 'mcp-config.json'), fx('copilot-mcp-config.json'));
  const cliBefore = fs.readFileSync(path.join(cliDir, 'mcp-config.json'), 'utf8');
  const cliNamesNow = cliServers(cliDir, new Set()).servers.map((x) => x.name);
  const pv = previewFolderImport([projA], [], ['github-mcp-server', 'playwright-cli']);
  assert.ok(pv.ok && pv.label === '.vscode/mcp.json');
  assert.ok(!JSON.stringify(pv).includes('dummy-literal-value') && !JSON.stringify(pv).includes('dummy-header-secret'), 'previews never carry a secret value');
  assert.ok(!JSON.stringify(pv).includes(fileA.replace(/\\/g, '\\\\')) , 'the path of the file is not part of the preview (only a label); a resolved ${workspaceFolder} in a command is shown because the trust dialog shows it too');
  const it = Object.fromEntries(pv.items.map((x) => [x.originalName, x]));
  assert.deepStrictEqual(it.fs.env.map((r) => [r.key, r.hasValue]), [['DEBUG', true], ['TOKEN', false], ['FROM_ENV', false], ['PORT', true], ['EMPTY', false]]);
  assert.strictEqual(it['needs-input'].blocked !== undefined, true);
  assert.strictEqual(pv.files[0].state, 'ok');
  assert.deepStrictEqual(pv.files[0].inputs, ['api-key', 'region']);
  assert.strictEqual(fs.readFileSync(fileA, 'utf8'), beforeA, 'the VS Code file is never modified');

  // missing / bad / huge files
  const empty = path.join(root, 'empty');
  fs.mkdirSync(empty);
  let bad = previewFolderImport([empty], [], []);
  assert.ok(!bad.ok && /No \.vscode\/mcp\.json/.test(bad.error ?? ''));
  fs.mkdirSync(path.join(empty, '.vscode'));
  fs.writeFileSync(path.join(empty, '.vscode', 'mcp.json'), '{ "servers": { oops } }');
  bad = previewFolderImport([empty], [], []);
  assert.ok(!bad.ok && /Not valid JSON/.test(bad.error ?? '') && bad.items.length === 0);
  fs.writeFileSync(path.join(empty, '.vscode', 'mcp.json'), 'x'.repeat(1024 * 1024 + 1));
  bad = previewFolderImport([empty], [], []);
  assert.ok(!bad.ok && /larger than 1 MiB/.test(bad.error ?? ''));
  assert.strictEqual(readVSCodeFile(path.join(empty, 'nope')).state, 'missing');
  fs.writeFileSync(path.join(empty, '.vscode', 'mcp.json'), '{"servers":{}}');
  const none = previewFolderImport([empty], [], []);
  assert.ok(none.ok && none.items.length === 0, 'a file without servers is an empty preview');

  // 9c. Apply through the store: this folder only, off, untrusted, trust prompt on first enable
  const f = tmp();
  const st = new McpStore(f, codec());
  st.load();
  const KA = projA; // the folder key
  const KB = path.join(root, 'proj-b');
  const reserved = ['github-mcp-server', 'playwright-cli'];
  const ids = ['playwright', 'fs', 'docs', 'weird/name'].map((n) => pv.items.find((x) => x.originalName === n)?.id as string);
  const noDigest = applyFolderImport(st, KA, [projA], ids, 'stale', reserved);
  assert.ok(!noDigest.ok && /changed since the preview/.test(noDigest.error ?? ''), 'a changed file is refused');
  assert.deepStrictEqual(st.list(KA), []);
  const r = applyFolderImport(st, KA, [projA], ids, pv.digest, reserved);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepStrictEqual(r.imported.sort(), ['docs', 'fs', 'playwright', 'weird-name']);
  assert.deepStrictEqual(r.failed, []);
  assert.strictEqual(st.list(KB).length, 0, 'other folders get nothing');
  assert.deepStrictEqual(st.forSession(KA).mcpServers, {}, 'imported servers are not passed to sessions (off)');
  const views = st.list(KA);
  assert.ok(views.every((v) => !v.enabled && !v.trusted), 'off and untrusted');
  const fsv = views.find((v) => v.name === 'fs');
  assert.deepStrictEqual(fsv?.env, [{ key: 'DEBUG', set: true }, { key: 'TOKEN', set: false }, { key: 'FROM_ENV', set: false }, { key: 'PORT', set: true }, { key: 'EMPTY', set: false }]);
  assert.ok(fsv?.needsSecrets, 'dropped references leave a key with no value: the server cannot start until it is entered');
  assert.ok(!JSON.stringify(views).includes('dummy-literal-value') && !JSON.stringify(views).includes('dummy-header-secret'), 'views are masked');
  const disk = fs.readFileSync(f, 'utf8');
  assert.ok(!disk.includes('dummy-literal-value') && !disk.includes('dummy-header-secret'), 'secret values are encrypted on disk');
  assert.ok(disk.includes('ENC1:'));
  // trust prompt on first start: enabling returns needsTrust with the exact command (workspace folder resolved)
  const need = st.setEnabled(KA, 'fs', true);
  assert.ok(!need.ok && need.needsTrust?.command === 'npx' && need.needsTrust.args?.[2] === projA);
  // fs still needs secrets: even trusted it is not passed until they are entered
  assert.ok(st.setEnabled(KA, 'fs', true, true).ok);
  assert.ok(st.forSession(KA).skipped.some((x) => x.name === 'fs' && /secret/.test(x.reason)));
  assert.ok(st.setEnabled(KA, 'playwright', true, true).ok);
  assert.deepStrictEqual(Object.keys(st.forSession(KA).mcpServers), ['playwright']);
  // blocked / unknown ids fail without creating anything
  const again = previewFolderImport([projA], st.list(KA), reserved);
  const blockedId = again.items.find((x) => x.originalName === 'needs-input')?.id as string;
  const rb = applyFolderImport(st, KA, [projA], [blockedId, '0:nope'], again.digest, reserved);
  assert.ok(!rb.ok && rb.imported.length === 0 && rb.failed.length === 2);
  // importing again: the same definitions are "already added" and cannot be imported twice
  const done = Object.fromEntries(again.items.map((x) => [x.originalName, x]));
  assert.ok(done.playwright.alreadyAdded && done.fs.alreadyAdded && done.docs.alreadyAdded && done['weird/name'].alreadyAdded);
  assert.ok(!done['old-sse'].alreadyAdded);
  const dup = applyFolderImport(st, KA, [projA], [done.playwright.id], again.digest, reserved);
  assert.ok(!dup.ok && dup.failed[0].error === 'Already added.' && st.list(KA).filter((v) => v.name === 'playwright').length === 1);
  // a name clash with the CLI list or with a different extra gets -vscode
  const f2 = tmp();
  const st2 = new McpStore(f2, codec());
  st2.load();
  assert.ok(st2.upsert(KA, { name: 'docs', transport: 'http', url: 'https://other.example.test/mcp' }).ok);
  const pv2 = previewFolderImport([projA], st2.list(KA), ['playwright']);
  const m = Object.fromEntries(pv2.items.map((x) => [x.originalName, x]));
  assert.strictEqual(m.docs.name, 'docs-vscode');
  assert.strictEqual(m.playwright.name, 'playwright-vscode');
  assert.ok(m.docs.notes.some((n) => /already taken/.test(n)));
  const r2 = applyFolderImport(st2, KA, [projA], [m.docs.id, m.playwright.id], pv2.digest, ['playwright']);
  assert.deepStrictEqual(r2.imported.sort(), ['docs-vscode', 'playwright-vscode']);
  assert.ok(st2.list(KA).every((v) => !v.enabled), 'nothing is switched on by importing');
  // a workspace: the files of several folders, each entry says where it comes from, ids are per folder
  const projB = path.join(root, 'proj-c');
  fs.mkdirSync(path.join(projB, '.vscode'), { recursive: true });
  fs.writeFileSync(path.join(projB, '.vscode', 'mcp.json'), '{ "servers": { "playwright": { "command": "npx", "args": ["@playwright/mcp@latest", "--b"] } } }');
  const ws = previewFolderImport([projA, projB, path.join(root, 'none')], [], []);
  assert.deepStrictEqual(ws.files.map((x) => x.state), ['ok', 'ok', 'missing']);
  const pw = ws.items.filter((x) => x.originalName === 'playwright');
  assert.deepStrictEqual(pw.map((x) => [x.from, x.name]), [['proj-a', 'playwright'], ['proj-c', 'playwright-vscode']]);
  assert.notStrictEqual(pw[0].id, pw[1].id);
  // nothing outside the folder store changed: the CLI file (if the machine has one) was not touched
  assert.strictEqual(fs.readFileSync(path.join(cliDir, 'mcp-config.json'), 'utf8'), cliBefore, 'the Copilot CLI file is not touched');
  assert.deepStrictEqual(cliServers(cliDir, new Set()).servers.map((x) => x.name), cliNamesNow, 'the global list is unchanged by a per-folder import');
  assert.strictEqual(fs.readFileSync(fileA, 'utf8'), beforeA);
}
console.log('mcp tests passed');
