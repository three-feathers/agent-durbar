/** Unit test (spec 060 FR-001): the official-installer download and run, with fakes. Nothing is downloaded or run for real. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { MAX_REDIRECTS, MAX_SCRIPT_BYTES, allowedScriptUrl, downloadScript, looksLikeScript } from '../src/main/officialinstall';
import * as http from 'http';
import type { HttpGet } from '../src/main/officialinstall';
import { makeDownloadGet, makeNodeDownloadGet } from '../src/main/netget';
import type { NetRequestFactory, NetRequestLike } from '../src/main/netget';
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
  // the download's stream code (netget.makeDownloadGet over a fake net.request; review on #393: the size cap and the TOTAL time limit must be proven)
  {
    const mkRes = (status: number, headers: Record<string, string>, feed: (res: EventEmitter, req: EventEmitter) => void): NetRequestFactory => () => {
      const r = Object.assign(new EventEmitter(), { headers: {} as Record<string, string>, setHeader(k: string, v: string) { this.headers[k] = v; }, abort() { (this as unknown as EventEmitter).emit('aborted'); }, followRedirect: () => { throw new Error('never followed'); }, end() { setImmediate(() => { const res = Object.assign(new EventEmitter(), { statusCode: status, headers }); (r as EventEmitter).emit('response', res); feed(res, r as EventEmitter); }); } });
      return r as unknown as NetRequestLike;
    };
    const okr = await makeDownloadGet(mkRes(200, { 'content-type': 'text/x-sh' }, (res) => { res.emit('data', Buffer.from('#!/bin/sh\necho ok\n')); res.emit('end'); }))('https://x/ok', { timeoutMs: 2000, maxBytes: 1000 });
    assert.deepStrictEqual([okr.status, okr.contentType, okr.body.toString()], [200, 'text/x-sh', '#!/bin/sh\necho ok\n']);
    const rd = await makeDownloadGet(mkRes(302, { location: '/ok' }, () => undefined))('https://x/redir', { timeoutMs: 2000, maxBytes: 1000 });
    assert.deepStrictEqual([rd.status, rd.location], [302, '/ok'], 'redirects are reported, not followed');
    await assert.rejects(makeDownloadGet(mkRes(200, {}, (res) => { res.emit('data', Buffer.alloc(600)); res.emit('data', Buffer.alloc(600)); res.emit('end'); }))('https://x/big', { timeoutMs: 2000, maxBytes: 1000 }), /larger than expected/, 'the size cap works while streaming');
    let aborted = false;
    const t0 = Date.now();
    await assert.rejects(makeDownloadGet(mkRes(200, {}, (res, req) => { const t = setInterval(() => res.emit('data', Buffer.from('x')), 40); req.on('aborted', () => { aborted = true; clearInterval(t); }); }))('https://x/drip', { timeoutMs: 300, maxBytes: 100000 }), /took too long/, 'a dripping server hits the TOTAL time limit');
    assert.ok(Date.now() - t0 < 2000 && aborted, 'promptly, and the request is aborted');
    // FR-017: the fixed headers, no locale
    let seen: Record<string, string> = {};
    await makeDownloadGet((o) => { const r = mkRes(200, {}, (res) => res.emit('end'))(o) as unknown as { headers: Record<string, string> }; seen = r.headers; return r as unknown as NetRequestLike; })('https://x/h', { timeoutMs: 2000, maxBytes: 10 });
    assert.deepStrictEqual(seen, { 'User-Agent': 'AgentDurbar', 'Accept': '*/*', 'Accept-Language': 'en' });
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
  // spec 081 T024: the download through net.request: a redirect is read from the event and not followed; an off-list hop is refused BEFORE it is asked for
  {
    const requested: string[] = [];
    let followed = 0;
    const mkReq = (script: (u: string, r: EventEmitter) => void): NetRequestFactory => (o) => {
      requested.push(o.url);
      const r = Object.assign(new EventEmitter(), { setHeader: () => undefined, abort: () => undefined, followRedirect: () => { followed++; }, end() { setImmediate(() => script(o.url, r)); } });
      return r as unknown as NetRequestLike;
    };
    const net = mkReq((u, r) => {
      if (u === 'https://claude.ai/install.sh') r.emit('redirect', 302, 'GET', 'https://evil.example/install.sh');
      else throw new Error('the off-list hop must never be requested: ' + u);
    });
    await assert.rejects(downloadScript(claude, '.sh', { get: makeDownloadGet(net), tmpdir: tmp }), /not the vendor's/);
    assert.deepStrictEqual(requested, ['https://claude.ai/install.sh'], 'the off-list hop was refused before it was requested');
    assert.strictEqual(followed, 0, 'followRedirect is never called');
    requested.length = 0;
    const ok = mkReq((u, r) => {
      if (u === 'https://claude.ai/install.sh') r.emit('redirect', 302, 'GET', 'https://downloads.claude.ai/claude-code-releases/bootstrap.sh');
      else { const res = Object.assign(new EventEmitter(), { statusCode: 200, headers: { 'content-type': 'text/x-shellscript' } }); r.emit('response', res); setImmediate(() => { res.emit('data', body); res.emit('end'); }); }
    });
    const got = await downloadScript(claude, '.sh', { get: makeDownloadGet(ok), tmpdir: tmp });
    assert.deepStrictEqual(fs.readFileSync(got.file), body);
    assert.deepStrictEqual(requested, ['https://claude.ai/install.sh', 'https://downloads.claude.ai/claude-code-releases/bootstrap.sh']);
  }
  // spec 081 delta 2026-10-27: every non-test source in src/ and scripts/ that builds HarnessSetup hands in the installer download
  // (it has no default). Tests that pass fakes on purpose are named test-*.ts and skipped. A new construction site is found by the scan.
  {
    const root = path.join(__dirname, '..', '..');
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : /\.ts$/.test(e.name) && !/^test-/.test(e.name) ? [path.join(d, e.name)] : []);
    const sites = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'scripts'))].filter((f) => fs.readFileSync(f, 'utf8').includes('new HarnessSetup('));
    const names = sites.map((f) => path.relative(root, f).split(path.sep).join('/')).sort();
    assert.deepStrictEqual(names, ['scripts/e2e-real.ts', 'scripts/install-check.ts', 'src/main/ipc/harness.ts'], 'the construction sites (update this list on purpose)');
    for (const f of sites) {
      const src = fs.readFileSync(f, 'utf8');
      const block = src.slice(src.indexOf('new HarnessSetup('));
      assert.ok(/httpGet:\s*(makeDownloadGet|nodeDownloadGet)\b/.test(block.slice(0, 2500)), `${f} passes httpGet to HarnessSetup`);
    }
  }
  {
    // the Node getter against a local server: the real stream code
    let seenUa = '';
    const sockets = new Set<import('net').Socket>();
    let redirBytesSent = 0;
    let redirClosed = false;
    const until = async (f: () => boolean, ms: number, what: string): Promise<void> => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) assert.fail(what); await new Promise((r) => setTimeout(r, 20)); } };
    const server = http.createServer((req, res) => {
      seenUa = String(req.headers['user-agent']);
      if (req.url === '/redir') { res.writeHead(302, { location: 'https://evil.example/x' }); res.write(''); const t = setInterval(() => { redirBytesSent += 65536; res.write(Buffer.alloc(65536)); }, 5); res.on('close', () => clearInterval(t)); req.socket.on('close', () => { redirClosed = true; clearInterval(t); }); }
      else if (req.url === '/big') { res.writeHead(200); res.end(Buffer.alloc(5000)); }
      else if (req.url === '/exact') { res.writeHead(200); res.end(Buffer.alloc(1000, 1)); }
      else if (req.url === '/over') { res.writeHead(200); res.end(Buffer.alloc(1001, 1)); }
      else if (req.url === '/overstall') { res.writeHead(200); res.write(Buffer.alloc(1001, 1)); } // never ends: only the cap can end this early
      else if (req.url === '/stall') { res.writeHead(200); res.write(Buffer.from('#!/bin/sh\n')); } // never ends: only the timeout can
      else { res.writeHead(200, { 'content-type': 'text/x-shellscript' }); res.end(body); }
    });
    server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const raw = makeNodeDownloadGet(http.get as never);
    // a getter that never settles must fail the test, not hang it
    const get: HttpGet = (u, o) => Promise.race([raw(u, o), new Promise<never>((_r, rej) => setTimeout(() => rej(new Error('getter did not settle')), 6000).unref())]);
    const okr = await get(`${base}/ok`, { timeoutMs: 2000, maxBytes: 1000 });
    assert.strictEqual(okr.status, 200);
    assert.deepStrictEqual(okr.body, body);
    assert.strictEqual(seenUa, 'AgentDurbar');
    // a redirect is reported, not followed, and its (endless) body is not read on: the request is destroyed
    const rd = await get(`${base}/redir`, { timeoutMs: 2000, maxBytes: 1000 });
    assert.deepStrictEqual([rd.status, rd.location, rd.body.length], [302, 'https://evil.example/x', 0], 'a redirect is reported, not followed');
    await until(() => redirClosed, 2000, 'the redirect socket is closed');
    const sent = redirBytesSent;
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(redirBytesSent - sent <= 65536 * 2, 'nothing more is sent to a destroyed request');
    assert.ok(redirBytesSent < 4 * 1024 * 1024, 'the redirect body read is bounded');
    // the cap: while streaming (a stall after maxBytes+1 fails on the cap, not on the timeout), and the boundary
    await assert.rejects(get(`${base}/big`, { timeoutMs: 2000, maxBytes: 1000 }), /larger than expected/);
    assert.strictEqual((await get(`${base}/exact`, { timeoutMs: 2000, maxBytes: 1000 })).body.length, 1000, 'exactly maxBytes is accepted');
    await assert.rejects(get(`${base}/over`, { timeoutMs: 2000, maxBytes: 1000 }), /larger than expected/, 'maxBytes + 1 is refused');
    const t0 = Date.now();
    await assert.rejects(get(`${base}/overstall`, { timeoutMs: 5000, maxBytes: 1000 }), /larger than expected/, 'the cap fires before any timeout');
    assert.ok(Date.now() - t0 < 2500, 'refused on the cap, not after the timeout');
    // the timeout: a server that sends headers and a first chunk, then stalls
    const t1 = Date.now();
    await assert.rejects(get(`${base}/stall`, { timeoutMs: 300, maxBytes: 100000 }), /took too long/, 'a stalled body hits the timeout');
    assert.ok(Date.now() - t1 < 3000);
    for (const s of sockets) s.destroy();
    await new Promise<void>((r2) => server.close(() => r2()));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('officialinstall: allow-list, redirects, size, private files, runner (bash/powershell argv, cleanup, never root) OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
