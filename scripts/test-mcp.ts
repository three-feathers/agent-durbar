/** MCP settings tests (spec 019): validation, secret handling, trust, import parsers, session resolution. No credits: `npm run test:mcp`. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { trustHash, validateInput } from '../src/shared/mcp';
import { parseMcpConfig } from '../src/shared/mcpimport';
import { McpStore } from '../src/main/mcpstore';
import { ambientServers, copilotDir, readCandidates, vscodeMcpFiles } from '../src/main/mcpfiles';
import type { SecretCodec } from '../src/main/mcpstore';

const fx = (n: string): string => fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'fixtures', 'mcp', n), 'utf8');
const tmp = (): string => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-mcp-')), 'durbar-mcp.json');
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
  const r = s.upsert({ name: 'echo', transport: 'stdio', command: 'node', args: ['echo.js'], env: [{ key: 'API_KEY', value: SECRET }] });
  assert.ok(r.ok && r.view);
  assert.ok(!JSON.stringify(s.list()).includes(SECRET), 'views never carry the secret value');
  assert.deepStrictEqual(r.view?.env, [{ key: 'API_KEY', set: true }]);
  const disk = fs.readFileSync(f, 'utf8');
  assert.ok(!disk.includes(SECRET), 'plain secret is not written');
  assert.ok(disk.includes('ENC1:'), 'encrypted blob is written');
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(f).mode & 0o077, 0, 'file is private');
  // not trusted yet: enabling asks first
  const e1 = s.setEnabled('echo', true);
  assert.strictEqual(e1.ok, false);
  assert.strictEqual(e1.needsTrust?.command, 'node');
  assert.deepStrictEqual(s.forSession().mcpServers, {}, 'a server that was never enabled is not passed');
  const e2 = s.setEnabled('echo', true, true);
  assert.ok(e2.ok && e2.view?.enabled && e2.view.trusted);
  const sess = s.forSession();
  assert.deepStrictEqual(sess.mcpServers.echo, { type: 'stdio', command: 'node', args: ['echo.js'], env: { API_KEY: SECRET }, workingDirectory: undefined, tools: ['*'] });
  // reload: decrypts
  const s2 = new McpStore(f, codec());
  s2.load();
  assert.strictEqual(s2.forSession().mcpServers.echo.env?.API_KEY, SECRET);
  assert.ok(s2.list()[0].trusted && s2.list()[0].enabled);
  // edit keeping the secret (value undefined), same command: stays enabled and trusted
  const ed = s2.upsert({ name: 'echo', transport: 'stdio', command: 'node', args: ['echo.js'], env: [{ key: 'API_KEY' }, { key: 'EXTRA', value: 'x' }] }, 'echo');
  assert.ok(ed.ok && ed.view?.enabled && ed.view.trusted);
  assert.strictEqual(s2.forSession().mcpServers.echo.env?.API_KEY, SECRET, 'blank secret input keeps the stored value');
  // changing the command resets trust and switches it off
  const ch = s2.upsert({ name: 'echo', transport: 'stdio', command: 'node', args: ['other.js'], env: [{ key: 'API_KEY' }] }, 'echo');
  assert.ok(ch.ok && !ch.view?.enabled && !ch.view?.trusted);
  assert.deepStrictEqual(s2.forSession().mcpServers, {});
  // clash and rename
  assert.strictEqual(s2.upsert({ name: 'ECHO', transport: 'stdio', command: 'x' }).ok, false, 'names are unique, case-insensitive');
  assert.ok(s2.upsert({ name: 'echo2', transport: 'stdio', command: 'x' }, 'echo').ok);
  assert.strictEqual(s2.list().length, 1);
  assert.ok(s2.remove('echo2') && s2.list().length === 0);
}

// 3. Without a codec (no OS-protected store): secrets are not written, kept in memory for the run, reported after restart
{
  const f = tmp();
  const s = new McpStore(f, codec(false));
  s.load();
  assert.strictEqual(s.secretsPersist, false);
  s.upsert({ name: 'remote', transport: 'http', url: 'https://example.test/mcp', headers: [{ key: 'Authorization', value: 'Bearer ' + SECRET }] });
  s.setEnabled('remote', true, true);
  assert.ok(!fs.readFileSync(f, 'utf8').includes(SECRET), 'never on disk without safeStorage');
  assert.strictEqual(s.forSession().mcpServers.remote.headers?.Authorization, 'Bearer ' + SECRET, 'usable in this run');
  const s2 = new McpStore(f, codec(false));
  s2.load();
  assert.strictEqual(s2.list()[0].needsSecrets, true);
  assert.deepStrictEqual(s2.forSession().mcpServers, {});
  assert.match(s2.forSession().skipped[0].reason, /secret values/);
  s2.upsert({ name: 'remote', transport: 'http', url: 'https://example.test/mcp', headers: [{ key: 'Authorization', value: 'new' }] }, 'remote');
  assert.strictEqual(s2.list()[0].needsSecrets, false);
  // no codec object at all behaves the same
  const s3 = new McpStore(tmp());
  s3.load();
  s3.upsert({ name: 'x', transport: 'stdio', command: 'node', env: [{ key: 'K', value: 'v' }] });
  assert.strictEqual(s3.secretsPersist, false);
}

// 4. Session resolution: ambient switch-off list and per-agent overrides
{
  const s = new McpStore(tmp(), codec());
  s.load();
  s.upsert({ name: 'a', transport: 'stdio', command: 'node', args: ['a.js'] });
  s.upsert({ name: 'b', transport: 'stdio', command: 'node', args: ['b.js'] });
  s.setEnabled('a', true, true);
  s.setEnabled('b', true, true);
  s.setAmbientDisabled('github-mcp-server', true);
  s.setAmbientDisabled('echo-user', true);
  let r = s.forSession();
  assert.deepStrictEqual(Object.keys(r.mcpServers).sort(), ['a', 'b']);
  assert.deepStrictEqual(r.disabledMcpServers.sort(), ['echo-user', 'github-mcp-server']);
  r = s.forSession(['b', 'playwright']);
  assert.deepStrictEqual(Object.keys(r.mcpServers), ['a']);
  assert.deepStrictEqual(r.disabledMcpServers.sort(), ['b', 'echo-user', 'github-mcp-server', 'playwright']);
  s.setAmbientDisabled('echo-user', false);
  assert.ok(!s.forSession().disabledMcpServers.includes('echo-user'));
  // an enabled inline server is not also listed as disabled
  s.setAmbientDisabled('a', true);
  assert.ok(!s.forSession().disabledMcpServers.includes('a') && 'a' in s.forSession().mcpServers);
  // a corrupt file means an empty list
  const f = tmp();
  fs.writeFileSync(f, '{not json');
  const bad = new McpStore(f, codec());
  bad.load();
  assert.deepStrictEqual(bad.list(), []);
}

// 5. Import parsers (read-only: they only get text)
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
  // wrong kind finds nothing; bad JSON and bare format
  assert.strictEqual(parseMcpConfig(fx('vscode-mcp.json'), 'copilot').candidates.length, 0);
  assert.strictEqual(parseMcpConfig('{oops', 'vscode').ok, false);
  assert.strictEqual(parseMcpConfig('{"a":{"command":"node"}}', 'copilot').candidates.length, 1, 'bare top-level format');
  // import into the store: off and untrusted, secrets kept as secrets, names deduped
  const s = new McpStore(tmp(), codec());
  s.load();
  s.upsert({ name: 'playwright', transport: 'stdio', command: 'mine' });
  const added = s.addImported([...c.candidates, ...v.candidates]);
  assert.ok(added.includes('playwright-2'), 'clash gets a suffix');
  assert.ok(s.list().every((x) => !x.enabled && (x.name === 'playwright' || !x.trusted)), 'imported servers are off and untrusted');
  assert.ok(!JSON.stringify(s.list()).includes('dummy-secret-1'));
  assert.deepStrictEqual(s.list().find((x) => x.name === 'context7')?.headers, [{ key: 'EXAMPLE_API_KEY', set: true }]);
  assert.deepStrictEqual(s.forSession().mcpServers, {});
}

// 6. Ambient servers (read from ~/.copilot/mcp-config.json, read-only) and file discovery
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-copilot-'));
  assert.deepStrictEqual(ambientServers(dir, new Set()).map((a) => a.name), ['github-mcp-server'], 'built-in server is listed even without a config file');
  fs.writeFileSync(path.join(dir, 'mcp-config.json'), fx('copilot-mcp-config.json'));
  const before = fs.readFileSync(path.join(dir, 'mcp-config.json'), 'utf8');
  const am = ambientServers(dir, new Set(['context7', 'github-mcp-server']));
  assert.deepStrictEqual(am.map((a) => [a.name, a.enabled]), [['playwright', true], ['context7', false], ['weird name!', true], ['legacy-sse', true], ['github-mcp-server', false]]);
  assert.strictEqual(am[2].name, 'weird name!', 'ambient names are the exact config keys (the runtime matches them)');
  assert.ok(!JSON.stringify(am).includes('dummy-secret-1') && !JSON.stringify(am).includes('dummy-not-a-real-key'), 'no secret values in ambient views');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'mcp-config.json'), 'utf8'), before, 'files are never modified');
  assert.strictEqual(readCandidates(path.join(dir, 'nope.json'), 'copilot'), undefined);
  assert.strictEqual(copilotDir({ DURBAR_COPILOT_DIR: '/x' } as NodeJS.ProcessEnv, '/home/u'), '/x');
  assert.strictEqual(copilotDir({} as NodeJS.ProcessEnv, '/home/u'), path.join('/home/u', '.copilot'));
  const vs = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-vs-'));
  fs.writeFileSync(path.join(vs, 'mcp.json'), fx('vscode-mcp.json'));
  assert.deepStrictEqual(vscodeMcpFiles([{ dir: vs }, { dir: path.join(vs, 'missing') }]), [path.join(vs, 'mcp.json')]);
}

console.log('mcp tests passed');
