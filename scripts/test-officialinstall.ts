/** Unit test (spec 060 FR-001): the official-installer download and run, with fakes. Nothing is downloaded or run for real. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { MAX_REDIRECTS, MAX_SCRIPT_BYTES, allowedScriptUrl, downloadScript, looksLikeScript, makeGet } from '../src/main/officialinstall';
import * as http from 'http';
import type { HttpGet } from '../src/main/officialinstall';
import { HarnessSetup, confirmText, setupEnv } from '../src/main/harnesssetup';
import { installPlans, routeOwning } from '../src/shared/harnesssetup';
import type { OfficialScript, PackageManager } from '../src/shared/harnesssetup';

const full = new Set<PackageManager>(['bash', 'powershell', 'npm', 'brew', 'winget']);
const scriptOf = (k: 'claude' | 'copilot' | 'codex', os2: string): OfficialScript => installPlans(k, os2, full)[0].script as OfficialScript;
const claude = scriptOf('claude', 'linux');
const copilot = scriptOf('copilot', 'darwin');

async function main(): Promise<void> {
  // the allow-list: https, the vendor's hosts, a path prefix on a shared host, no tricks
  assert.ok(allowedScriptUrl(claude, 'https://claude.ai/install.sh'));
  assert.ok(allowedScriptUrl(claude, 'https://downloads.claude.ai/claude-code-releases/bootstrap.sh'));
  for (const bad of ['http://claude.ai/install.sh', 'https://claude.ai.evil.example/install.sh', 'https://evilclaude.ai/x', 'https://user:pw@claude.ai/install.sh', 'https://claude.ai:8443/install.sh', 'file:///etc/passwd', 'not a url']) assert.ok(!allowedScriptUrl(claude, bad), bad);
  assert.ok(allowedScriptUrl(copilot, 'https://raw.githubusercontent.com/github/copilot-cli/refs/heads/main/install.sh'));
  assert.ok(!allowedScriptUrl(copilot, 'https://raw.githubusercontent.com/evil/copilot-cli/main/install.sh'), 'raw.githubusercontent.com only under github/copilot-cli');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-oi-test-'));
  const body = Buffer.from('#!/bin/sh\necho installing\n');
  const fake = (routes: Record<string, { status: number; location?: string; body?: Buffer }>): { get: HttpGet; seen: string[] } => {
    const seen: string[] = [];
    return { seen, get: async (url) => { seen.push(url); const r = routes[url]; if (!r) throw new Error('unexpected url ' + url); return { status: r.status, location: r.location, body: r.body ?? Buffer.alloc(0) }; } };
  };
  // one redirect to the vendor's download host: downloaded into a private folder
  {
    const f = fake({ 'https://claude.ai/install.sh': { status: 302, location: 'https://downloads.claude.ai/claude-code-releases/bootstrap.sh' }, 'https://downloads.claude.ai/claude-code-releases/bootstrap.sh': { status: 200, body } });
    const r = await downloadScript(claude, '.sh', { get: f.get, tmpdir: tmp });
    assert.deepStrictEqual(fs.readFileSync(r.file), body);
    if (process.platform !== 'win32') {
      assert.strictEqual(fs.statSync(r.dir).mode & 0o777, 0o700, 'private folder');
      assert.strictEqual(fs.statSync(r.file).mode & 0o777, 0o600, 'private file');
    }
    assert.deepStrictEqual(f.seen.length, 2);
  }
  // a redirect to another host is refused, and nothing is fetched from it
  {
    const f = fake({ 'https://claude.ai/install.sh': { status: 302, location: 'https://evil.example/install.sh' } });
    await assert.rejects(downloadScript(claude, '.sh', { get: f.get, tmpdir: tmp }), /not the vendor's/);
    assert.deepStrictEqual(f.seen, ['https://claude.ai/install.sh']);
  }
  // too many redirects, an HTTP error, empty or oversized bodies
  {
    const loop: Record<string, { status: number; location?: string }> = {};
    for (let i = 0; i <= MAX_REDIRECTS + 1; i++) loop[i === 0 ? 'https://claude.ai/install.sh' : `https://claude.ai/r${i}`] = { status: 302, location: `https://claude.ai/r${i + 1}` };
    await assert.rejects(downloadScript(claude, '.sh', { get: fake(loop).get, tmpdir: tmp }), /redirected too often/);
    await assert.rejects(downloadScript(claude, '.sh', { get: fake({ 'https://claude.ai/install.sh': { status: 404 } }).get, tmpdir: tmp }), /HTTP 404/);
    await assert.rejects(downloadScript(claude, '.sh', { get: fake({ 'https://claude.ai/install.sh': { status: 200 } }).get, tmpdir: tmp }), /empty or too large/);
    await assert.rejects(downloadScript(claude, '.sh', { get: fake({ 'https://claude.ai/install.sh': { status: 200, body: Buffer.alloc(MAX_SCRIPT_BYTES + 1) } }).get, tmpdir: tmp }), /empty or too large/);
  }

  // review on #393: a web page is never run. HTML content type, a .sh without #!, a .ps1 that starts with <
  assert.ok(looksLikeScript(Buffer.from('#!/bin/bash\necho hi'), '.sh'));
  assert.ok(!looksLikeScript(Buffer.from('<!DOCTYPE html><title>Just a moment...</title>'), '.sh'), 'a challenge page is not a script');
  assert.ok(!looksLikeScript(Buffer.from('#!/bin/bash'), '.sh', 'text/html; charset=utf-8'), 'text/html is refused even with #!');
  assert.ok(looksLikeScript(Buffer.from('\uFEFF  param()\nWrite-Host hi'), '.ps1'), 'a BOM and spaces before PowerShell are fine');
  assert.ok(!looksLikeScript(Buffer.from('  <html>'), '.ps1'));
  assert.ok(!looksLikeScript(Buffer.alloc(0), '.ps1'));
  {
    const f = fake({ 'https://claude.ai/install.sh': { status: 200, body: Buffer.from('<html><body>Verify you are human</body></html>') } });
    await assert.rejects(downloadScript(claude, '.sh', { get: f.get, tmpdir: tmp }), /not the vendor's install script/);
  }
  // the real stream code against a local server (review on #393: the size cap and the total timeout must be proven)
  {
    const server = http.createServer((req, res) => {
      if (req.url === '/ok') { res.writeHead(200, { 'Content-Type': 'text/x-sh' }); res.end('#!/bin/sh\necho ok\n'); return; }
      if (req.url === '/big') { res.writeHead(200); res.write(Buffer.alloc(600)); res.write(Buffer.alloc(600)); res.end(); return; }
      if (req.url === '/drip') { res.writeHead(200); const t = setInterval(() => res.write('x'), 40); req.on('close', () => clearInterval(t)); return; }
      if (req.url === '/redir') { res.writeHead(302, { Location: '/ok' }); res.end(); return; }
      res.writeHead(404); res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const get = makeGet(http.get as never);
    const okr = await get(base + '/ok', { timeoutMs: 2000, maxBytes: 1000 });
    assert.deepStrictEqual([okr.status, okr.contentType, okr.body.toString()], [200, 'text/x-sh', '#!/bin/sh\necho ok\n']);
    const rd = await get(base + '/redir', { timeoutMs: 2000, maxBytes: 1000 });
    assert.deepStrictEqual([rd.status, rd.location], [302, '/ok'], 'redirects are reported, not followed');
    await assert.rejects(get(base + '/big', { timeoutMs: 2000, maxBytes: 1000 }), /larger than expected/, 'the size cap works while streaming');
    const t0 = Date.now();
    await assert.rejects(get(base + '/drip', { timeoutMs: 300, maxBytes: 100000 }), /took too long/, 'a dripping server hits the TOTAL time limit');
    assert.ok(Date.now() - t0 < 2000, 'and promptly (the idle timeout alone would never fire)');
    server.close();
  }

  // the runner: an official plan runs bash with the downloaded file as the last argument, and the folder goes when it ends
  {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    let child!: EventEmitter & { out: EventEmitter; err: EventEmitter };
    const dones: unknown[] = [];
    const f = fake({ 'https://claude.ai/install.sh': { status: 200, body } });
    const mk = (isRoot: boolean) => new HarnessSetup({
      detectEnv: { platform: 'linux', env: { PATH: '/usr/bin:/bin' }, homedir: '/home/u', isFile: (p: string) => p === '/usr/bin/bash' || p === '/bin/bash' },
      spawn: (file, args) => { calls.push({ file, args }); const out = new EventEmitter(), err = new EventEmitter(); child = Object.assign(new EventEmitter(), { pid: 7, out, err, stdout: out, stderr: err, stdin: null }) as never; return child as never; },
      killTree: () => undefined, send: ((ch: string, p: unknown) => { if (ch === 'harness:done') dones.push(p); }) as never, redetect: async () => undefined,
      progressMs: 0, isRoot: () => isRoot, httpGet: f.get, tmpdir: tmp,
    });
    const hs = mk(false);
    const p = hs.prepare('claude', 'install', 0);
    assert.ok(p.ok, JSON.stringify(p));
    if (!p.ok) return;
    assert.strictEqual(p.job.file, '/usr/bin/bash');
    const t = confirmText(p.job);
    assert.match(t.detail, /https:\/\/claude\.ai\/install\.sh/);
    assert.match(t.detail, /no administrator rights/);
    const ready = await hs.withScript(p.job);
    assert.ok(ready.ok);
    if (!ready.ok) return;
    const scriptFile = ready.job.spawnArgs[ready.job.spawnArgs.length - 1];
    assert.ok(fs.existsSync(scriptFile) && ready.job.cleanupDir && scriptFile.startsWith(ready.job.cleanupDir));
    const p2 = hs.prepare('claude', 'install', 0);
    const r2 = p2.ok ? await hs.withScript(p2.job) : undefined;
    assert.ok(r2 && r2.ok && r2.job.cleanupDir && fs.existsSync(r2.job.cleanupDir), 'two runs downloaded before either started');
    assert.ok(hs.start(ready.job).ok);
    assert.deepStrictEqual(calls[0], { file: '/usr/bin/bash', args: [scriptFile] }, 'bash <file>, argv only');
    // review on #393: a second download, prepared before the first started, is refused at start AND its folder is removed
    if (r2 && r2.ok) {
      assert.match(String((hs.start(r2.job) as { error?: string }).error), /still running/);
      assert.ok(!fs.existsSync(r2.job.cleanupDir!), 'the refused download is deleted');
    }
    child.emit('close', 0);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.ok(!fs.existsSync(ready.job.cleanupDir!), 'the private folder is deleted when the run ends');
    assert.strictEqual(dones.length, 1);
    // never as root
    const root = mk(true).prepare('claude', 'install', 0);
    assert.ok(!root.ok && /not as root/.test(root.error));
  }
  // Windows: Windows PowerShell from the system folder only, never one earlier on PATH
  {
    const files = new Set(['C:\\Evil\\powershell.exe', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe']);
    const hs = new HarnessSetup({ detectEnv: { platform: 'win32', env: { PATH: 'C:\\Evil', SystemRoot: 'C:\\Windows' }, homedir: 'C:\\Users\\u', isFile: (p: string) => files.has(p) }, spawn: () => { throw new Error('no'); }, killTree: () => undefined, send: () => undefined, redetect: async () => undefined } as never);
    assert.strictEqual(hs.find('powershell'), 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    const p = hs.prepare('claude', 'install', 0);
    assert.ok(p.ok && p.job.args.join(' ') === '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File', JSON.stringify(p));
  }
  // Windows: an official installer runs with the system folders first on PATH (Git's GNU tar breaks OpenAI's script), same PATH key
  {
    const base = { Path: 'C:\\Program Files\\Git\\usr\\bin;C:\\Windows\\system32;C:\\npm\\prefix', SystemRoot: 'C:\\Windows', PSModulePath: 'C:\\Program Files\\PowerShell\\7\\Modules' };
    const e = setupEnv(base, 'win32', true);
    assert.strictEqual(e.Path, 'C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\WindowsPowerShell\\v1.0;C:\\Program Files\\Git\\usr\\bin;C:\\npm\\prefix');
    assert.ok(!('PATH' in e), 'no second PATH spelling');
    assert.ok(!('PSModulePath' in e), 'Windows PowerShell 5.1 builds its own module path');
    assert.strictEqual(setupEnv(base, 'win32', false).PSModulePath, base.PSModulePath, 'kept for package managers');
    assert.strictEqual(e.NO_COLOR, '1');
    assert.strictEqual(setupEnv(base, 'win32', false).Path, base.Path, 'package managers keep PATH as it is');
    assert.strictEqual(setupEnv({ PATH: '/usr/bin' }, 'linux', true).PATH, '/usr/bin', 'not on macOS/Linux');
    assert.strictEqual(setupEnv({ Path: 'x', SystemRoot: 'Windows' }, 'win32', true).Path, 'x', 'a relative SystemRoot is ignored');
  }
  // Homebrew that belongs to another account: the plan says so instead of "may ask for administrator rights"
  {
    const mk = (other: boolean) => new HarnessSetup({ detectEnv: { platform: 'darwin', env: { PATH: '/opt/homebrew/bin:/usr/bin:/bin' }, homedir: '/Users/u', isFile: (p: string) => ['/opt/homebrew/bin/brew', '/bin/bash'].includes(p) }, spawn: () => { throw new Error('no'); }, killTree: () => undefined, send: () => undefined, redetect: async () => undefined, ownedByOther: () => other } as never);
    const brewOf = (hs: HarnessSetup) => hs.plans('claude', 'install').plans.find((p) => p.manager === 'brew');
    assert.match(String(brewOf(mk(true))?.note), /belongs to another account/);
    assert.doesNotMatch(String(brewOf(mk(false))?.note), /another account/);
  }
  // review on #393: Update uses the route that owns the installed copy
  assert.strictEqual(routeOwning('/opt/homebrew/Caskroom/claude-code/2.1.305/claude'), 'brew');
  assert.strictEqual(routeOwning('/home/linuxbrew/.linuxbrew/Cellar/codex/0.163.0/bin/codex'), 'brew');
  assert.strictEqual(routeOwning('/usr/local/lib/node_modules/@openai/codex/bin/codex.js'), 'npm');
  assert.strictEqual(routeOwning('C:\\Users\\u\\AppData\\Roaming\\npm\\copilot.cmd'), 'npm');
  assert.strictEqual(routeOwning('/home/u/.local/share/claude/versions/2.1.305'), 'official');
  assert.strictEqual(routeOwning('C:\\Users\\u\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe'), 'official');
  assert.strictEqual(routeOwning('C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Anthropic.ClaudeCode\\claude.exe'), 'winget');
  assert.strictEqual(routeOwning('/usr/bin/claude'), undefined);
  {
    const files = new Set(['/opt/homebrew/bin/brew', '/bin/bash', '/opt/homebrew/bin/claude']);
    const hs = new HarnessSetup({ detectEnv: { platform: 'darwin', env: { PATH: '/opt/homebrew/bin:/usr/bin:/bin' }, homedir: '/Users/u', isFile: (p: string) => files.has(p) }, spawn: () => { throw new Error('no'); }, killTree: () => undefined, send: () => undefined, redetect: async () => undefined, ownedByOther: () => false, realpath: (p: string) => (p === '/opt/homebrew/bin/claude' ? '/opt/homebrew/Caskroom/claude-code/2.1.305/claude' : p) } as never);
    assert.strictEqual(hs.plans('claude', 'install').plans[0].manager, 'official', 'install: least privilege first');
    assert.strictEqual(hs.plans('claude', 'update').plans[0].manager, 'brew', 'update: the route that owns the copy comes first');
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('officialinstall: allow-list, redirects, size, private files, runner (bash/powershell argv, cleanup, never root) OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
