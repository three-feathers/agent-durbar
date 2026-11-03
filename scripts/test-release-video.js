/*
 * Spec 008 FR-178: the pure parts of scripts/release-video.js (no Electron, no ffmpeg, no network). The recording itself is checked by
 * looking at its frames (FR-176); here: arguments, the privacy check, the concat list, the ffmpeg arguments, the size tries and the
 * command's failure path (no clip left behind, the recording never started without ffmpeg).
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const RV = require('./release-video');

// ---- arguments ----
const ok = RV.parseArgs(['--version', 'v0.1.7', '--out', 'x']);
assert.deepStrictEqual(ok.scenes, RV.DEFAULT_SCENES, 'the default scenes');
assert.strictEqual(ok.scenes[0], 'intro');
assert.strictEqual(ok.scenes[ok.scenes.length - 1], 'outro');
assert.deepStrictEqual(RV.parseArgs(['--version', 'v1.2.3-rc.4', '--out', 'x', '--scenes', 'crews, mcp']).scenes, ['crews', 'mcp']);
for (const bad of ['0.1.7', 'v0.1', 'v0.1.7-test.1', 'v0.1.7;rm', 'v0.1.7 ', '../v0.1.7', 'v0.1.7-mcptest.1']) {
  assert.throws(() => RV.parseArgs(['--version', bad, '--out', 'x']), /--version must be/, `refused version ${JSON.stringify(bad)}`);
}
assert.throws(() => RV.parseArgs(['--version', 'v0.1.7']), /--out/);
assert.throws(() => RV.parseArgs(['--version', 'v0.1.7', '--out', 'x', '--scenes', 'crews,toString']), /unknown scene/, 'a prototype name is no scene');
assert.throws(() => RV.parseArgs(['--version', 'v0.1.7', '--out', 'x', '--scenes', '__proto__']), /unknown scene/);
assert.throws(() => RV.parseArgs(['--version', 'v0.1.7', '--out', 'x', '--count', '2.5']), /--count/);
assert.throws(() => RV.parseArgs(['--version', 'v0.1.7', '--out']), /needs a value/);
assert.throws(() => RV.parseArgs(['--bogus']), /unknown argument/);
assert.ok(RV.parseArgs(['--list']).list);

// ---- the catalogue: every scene names its change and says where it is (FR-171) ----
for (const [id, s] of Object.entries(RV.SCENES)) {
  assert.ok(s.title && s.title.length <= 40, `${id}: a short title`);
  assert.ok(s.sub && s.sub.length <= 80, `${id}: a one-line subtitle (${s.sub.length})`);
  assert.strictEqual(typeof s.play, 'function', `${id}: plays`);
}
assert.strictEqual(RV.fill('{count} changes in {version}', { version: 'v0.1.7', count: '28' }), '28 changes in v0.1.7');
assert.strictEqual(RV.fill('{count} in {version}', { version: 'v1.0.0', count: null }), ' in v1.0.0');

// ---- the privacy check (FR-176) ----
const forbidden = RV.forbiddenValues({ home: '/home/alice', user: 'alice', host: 'alice-laptop', root: '/home/alice/src/agent-durbar', email: '' });
assert.ok(forbidden.includes('/home/alice') && forbidden.includes('\\home\\alice'), 'the home folder, both slashes');
assert.ok(forbidden.includes('alice-laptop') && forbidden.includes('alice'));
assert.deepStrictEqual(RV.forbiddenValues({ home: '/h', user: 'bob', host: 'x', root: '/r', email: '' }), [], 'values under 4 characters are not matched');
const P = (t, red) => RV.privacyProblems(t, forbidden, red);
const id = (s) => s;
assert.deepStrictEqual(P('~/work/mcp-swiss  Agent Durbar  /etc/codex/requirements.toml', id), [], 'simulator text is clean');
assert.ok(P('Folder /home/alice/src/x', id).includes('a local path'));
assert.ok(P('C:\\home\\alice\\x', id).includes('a local path'), 'a Windows-style path');
assert.deepStrictEqual(P('signed in as Alice', id), ['the user or host name'], 'the user name, any case');
assert.deepStrictEqual(P('on alice-laptop.local', id), ['the user or host name']);
assert.deepStrictEqual(P('malice and palace', id), [], 'only whole words count for a name');
assert.deepStrictEqual(P('token ghp_x', (s) => s.replace(/ghp_\w+/, '[redacted]')), ['text that redact masks (token-shaped)'], 'anything redact masks');
assert.deepStrictEqual(P('', id), []);
// the real redact masks a GitHub token shape (built first: npm test runs after the build)
let realRedact = null;
try { realRedact = require(path.join(__dirname, '..', 'dist', 'shared', 'redact.js')).redact; } catch { /* no build */ }
if (realRedact) assert.deepStrictEqual(P('ghp_' + 'a'.repeat(36), realRedact), ['text that redact masks (token-shaped)'], 'the app redact catches a token');
else console.log('release-video: dist/shared/redact.js not built, real-redact case skipped');

// ---- review on #1083: the git email, the environment allow-list ----
{
  const fv = RV.forbiddenValues({ home: '/home/alice', user: 'alice', host: 'box1', root: '/r/x', email: 'Alice.W@Example.org' });
  assert.ok(fv.includes('Alice.W@Example.org'), 'the git email is forbidden');
  assert.deepStrictEqual(RV.privacyProblems('by alice.w@example.org', fv, (x) => x).filter((h) => h === 'the git email'), ['the git email'], 'any case');
  assert.ok(!RV.forbiddenValues({ home: '/h', user: 'bob', host: 'x', root: '/r', email: 'not an email' }).some((v) => v.includes('@')), 'a malformed value is not used');
  assert.strictEqual(RV.gitEmail(() => { throw new Error('no git'); }), '', 'no git, no email');
  assert.strictEqual(RV.gitEmail(() => ' a@b.example\n'), 'a@b.example');
  const env = RV.childEnv({ PATH: '/bin', Path: 'C:\\x', SystemRoot: 'C:\\Windows', HOME: '/h', DISPLAY: ':1', LANG: 'C', GITHUB_TOKEN: 'ghp_x', GH_TOKEN: 'x', ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'k', COPILOT_TOKEN: 'k', AWS_SECRET_ACCESS_KEY: 'k', NODE_OPTIONS: '--require x', ELECTRON_RUN_AS_NODE: '1', DURBAR_OPEN: '/x' });
  assert.deepStrictEqual(Object.keys(env).sort(), ['DISPLAY', 'HOME', 'LANG', 'PATH', 'Path', 'SystemRoot'], 'only the allow-list, names in any case');
}

// ---- the concat list: each frame lasts until the next was taken; the last is repeated ----
const list = RV.concatList([{ file: 'f00000.png', t: 0 }, { file: 'f00001.png', t: 125 }, { file: 'f00002.png', t: 400 }]);
assert.strictEqual(list, 'ffconcat version 1.0\nfile f00000.png\nduration 0.125\nfile f00001.png\nduration 0.275\nfile f00002.png\nduration 0.125\nfile f00002.png\n');
assert.throws(() => RV.concatList([]), /no frames/);
for (const bad of ['../x.png', 'a b.png', "x'.png", 'f.png\nfile /etc/passwd', 'F.PNG']) assert.throws(() => RV.concatList([{ file: bad, t: 0 }]), /unexpected frame name/, `refused ${JSON.stringify(bad)}`);
assert.ok(RV.concatList([{ file: 'f1.png', t: 5 }, { file: 'f2.png', t: 5 }]).includes('duration 0.001'), 'a zero gap still has a duration');

// ---- ffmpeg arguments: arrays, no shell; the sizes ----
const m = RV.mp4Args('list.ffconcat', 'o.mp4');
assert.ok(Array.isArray(m) && m.includes('libx264') && m.includes('+faststart') && m[m.length - 1] === 'o.mp4');
assert.ok(m.join(' ').includes('scale=1440:1028') && m.join(' ').includes('format=yuv420p'), 'the MP4 is the 1440x900 app plus the 128 px band, plays everywhere');
assert.strictEqual(RV.FRAME_H, RV.H_ + RV.BAND);

// ---- the frame: the app's rows unchanged, the caption band only under them (owner review: no caption covers the app) ----
{
  const w = 4, h = 3, bandH = 2, row = w * 4;
  const app = Buffer.alloc(row * h, 7);
  const band = Buffer.alloc(row * (h + bandH));
  for (let i = 0; i < band.length; i++) band[i] = i < row * h ? 200 : 100; // the band window's top part must never reach the frame
  const f = RV.composeFrame(app, band, { w, h, bandH });
  assert.strictEqual(f.length, row * (h + bandH));
  assert.ok(f.subarray(0, row * h).equals(app), 'every app pixel is kept as captured');
  assert.ok(f.subarray(row * h).every((b) => b === 100), 'the band rows come from the bottom of the band window');
  assert.ok(RV.composeFrame(null, band, { w, h, bandH, card: true }).equals(band), 'a title card is the band window whole');
  assert.throws(() => RV.composeFrame(Buffer.alloc(row * (h - 1)), band, { w, h, bandH }), /app bitmap/);
  assert.throws(() => RV.composeFrame(app, Buffer.alloc(row), { w, h, bandH }), /band bitmap/);
}
const g = RV.gifArgs('list.ffconcat', 'o.gif', 720, 128);
assert.ok(g.join(' ').includes('scale=720:-2') && g.join(' ').includes('max_colors=128') && g.join(' ').includes(`fps=${RV.FPS}`));
assert.deepStrictEqual(RV.gifTries().map((t) => t.width), [800, 720, 640, 640], 'tries 800, 720, 640 px, then fewer colours');
assert.ok(RV.GIF_MAX === 5 * 1024 * 1024 && RV.MP4_MAX === 20 * 1024 * 1024);
assert.ok(RV.lengthOk(38) && RV.lengthOk(25) && !RV.lengthOk(24.9) && !RV.lengthOk(76), 'the length bounds');
const src = fs.readFileSync(path.join(__dirname, 'release-video.js'), 'utf8');
assert.ok(!/shell:\s*true/.test(src) && /shell: false/.test(src), 'ffmpeg runs without a shell');
assert.ok(!/gh release|releases\/|--notes/.test(src.replace(/^\s*\*.*$/gm, '')), 'the script never touches a release');

// ---- review on #1083: a hung child is killed at its limit (FR-175) ----
{
  const t0 = Date.now();
  assert.throws(() => RV.run(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeout: 400 }), (e) => e.code === 'ETIMEDOUT' || /ETIMEDOUT|timed out/i.test(String(e.message)), 'a child over its limit throws');
  assert.ok(Date.now() - t0 < 10000, 'and is killed at the limit');
  process.env.RV_TEST_SECRET_TOKEN = 'ghp_' + 'z'.repeat(36);
  const keys = JSON.parse(String(RV.run(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(Object.keys(process.env)))'], { timeout: 10000 })));
  delete process.env.RV_TEST_SECRET_TOKEN;
  assert.ok(!keys.some((k) => k.toUpperCase() === 'RV_TEST_SECRET_TOKEN'), `the planted token does not reach ffmpeg: ${keys.join(',')}`);
  assert.deepStrictEqual(RV.unexpectedEnvKeys(keys), [], `ffmpeg gets the allow-list plus what ${process.platform} itself adds: ${keys.join(',')}`);
  // the check on each OS, with the key sets CI saw on #1083 (Windows: libuv adds its required variables; macOS: __CF_USER_TEXT_ENCODING)
  const seenOn = {
    win32: ['APPDATA', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'LOGONSERVER', 'Path', 'SystemDrive', 'SystemRoot', 'TEMP', 'TMP', 'USERDOMAIN', 'USERNAME', 'USERPROFILE', 'windir'],
    darwin: ['TMPDIR', 'LC_ALL', 'PATH', 'LANG', 'HOME', '__CF_USER_TEXT_ENCODING'],
    linux: ['PATH', 'HOME', 'DISPLAY', 'LANG', 'TMPDIR'],
  };
  for (const [platform, ks] of Object.entries(seenOn)) {
    assert.deepStrictEqual(RV.unexpectedEnvKeys(ks, platform), [], `${platform}: what CI saw is expected`);
    for (const leak of ['GITHUB_TOKEN', 'gh_token', 'RV_TEST_SECRET_TOKEN', 'NODE_OPTIONS', 'AWS_SECRET_ACCESS_KEY'])
      assert.deepStrictEqual(RV.unexpectedEnvKeys([...ks, leak], platform), [leak], `${platform}: ${leak} would be reported`);
  }
  assert.deepStrictEqual(RV.unexpectedEnvKeys(['LOGONSERVER', '__CF_USER_TEXT_ENCODING'], 'linux'), ['LOGONSERVER', '__CF_USER_TEXT_ENCODING'], 'another OS\'s added keys are not expected on Linux');
  assert.deepStrictEqual(RV.unexpectedEnvKeys(['__CF_USER_TEXT_ENCODING'], 'win32'), ['__CF_USER_TEXT_ENCODING'], 'nor macOS\'s on Windows');
  assert.deepStrictEqual(RV.unexpectedEnvKeys(['path', 'Path', 'PATH', 'SystemRoot'], 'win32'), [], 'names in any case');
  assert.ok(!Object.keys(RV.childEnv({ LOGONSERVER: 'x', USERDOMAIN: 'y', USERNAME: 'z' })).length, 'what we pass leaves them out (only libuv adds them on Windows)');
  const src2 = fs.readFileSync(path.join(__dirname, 'release-video.js'), 'utf8');
  assert.ok(/timeout: FFMPEG_MS, killSignal: 'SIGKILL'/.test(src2), 'every ffmpeg call has a limit and a hard kill');
}
// killTree: the whole tree goes, not only the wrapper (xvfb-run on Linux)
const { killTree } = require('./ui-suite');
{
  const calls = [];
  killTree({ pid: 42 }, { platform: 'win32', run: (f, a) => calls.push([f, ...a]) });
  assert.deepStrictEqual(calls, [['taskkill', '/pid', '42', '/T', '/F']], 'Windows: taskkill /T /F, no shell');
}

// ---- the command's failure paths (FR-175): no ffmpeg, a failed recording; nothing is left behind ----
(async () => {
  setTimeout(() => { console.error('release-video: the test hung (90 s)'); process.exit(1); }, 90000).unref(); // a stuck child fails instead of hanging
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-test-'));
  try {
    fs.writeFileSync(path.join(out, 'release-v0.1.7.gif'), 'old');
    let started = false;
    await assert.rejects(RV.main(['--version', 'v0.1.7', '--out', out], { hasFfmpeg: () => false, runOne: async () => { started = true; } }), /ffmpeg was not found/);
    assert.ok(!started, 'no Electron without ffmpeg');
    assert.ok(!fs.existsSync(path.join(out, 'release-v0.1.7.gif')), 'an old clip is removed first, so it never stands in for this run');
    fs.writeFileSync(path.join(out, 'release-v0.1.7.gif'), 'old');
    const distOk = fs.existsSync(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'));
    if (distOk) {
      await assert.rejects(RV.main(['--version', 'v0.1.7', '--out', out], { hasFfmpeg: () => true, ensure: () => true, runOne: async () => ({ ok: false, code: 1, why: 'DRIVER FAILED privacy check failed', log: 'x' }) }), /recording failed/);
      assert.ok(!fs.existsSync(path.join(out, 'release-v0.1.7.gif')), 'an old clip is removed when a new run fails');
      assert.deepStrictEqual(fs.readdirSync(out).filter((f) => f.startsWith('release-')), [], 'no release-* file after a failure');
    } else console.log('release-video: no build, failed-recording case skipped');
    // the options main gives the recording and ffmpeg: allow-listed env, limits, the tree kill
    if (distOk) {
      let seen = null;
      const opts = [];
      const fakeRun = (file, args, o) => { opts.push(o); fs.writeFileSync(args[args.length - 1], 'x'); return ''; };
      const rec = async (d, dir) => {
        seen = d;
        fs.writeFileSync(path.join(dir, 'f00000.png'), 'x');
        fs.writeFileSync(path.join(dir, 'frames.json'), JSON.stringify({ seconds: 30, frames: [{ file: 'f00000.png', t: 0 }], scenes: [{ n: '01', id: 'intro', title: 't', sub: 's', from: 0, to: 30, still: 'f00000.png' }], privacy: {} }));
        return { ok: true, code: 0, log: '' };
      };
      process.env.RV_TEST_SECRET_TOKEN = 'x';
      const m2 = await RV.main(['--version', 'v0.1.7', '--out', out], { hasFfmpeg: () => true, ensure: () => true, runOne: rec, run: fakeRun });
      delete process.env.RV_TEST_SECRET_TOKEN;
      assert.ok(m2 && m2.gif.bytes === 1);
      assert.ok(seen.killTree === true && seen.timeoutMs === RV.RECORD_MS && seen.timeoutMs <= 10 * 60 * 1000, 'the recording has a limit and kills its tree');
      assert.ok(seen.baseEnv && !('RV_TEST_SECRET_TOKEN' in seen.baseEnv) && Object.keys(seen.baseEnv).every((k) => RV.ENV_ALLOW.includes(k.toUpperCase())), 'Electron gets the allow-listed environment');
      assert.ok(opts.length >= 2 && opts.every((o) => o.timeout === RV.FFMPEG_MS), 'every encode has a limit');
    }
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
  // POSIX: a real tree (a child that starts a grandchild) is gone after killTree
  if (process.platform !== 'win32') {
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, ['-e', "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(c.pid);setInterval(()=>{},1000)"], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const grand = await new Promise((r) => child.stdout.once('data', (b) => r(Number(String(b).trim()))));
    killTree(child);
    const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    let gone = false;
    for (let i = 0; i < 100 && !gone; i++) { if (!alive(grand) && !alive(child.pid)) gone = true; else await new Promise((r) => setTimeout(r, 50)); }
    assert.ok(gone, 'killTree ends the child and its grandchild');
    // review on #1083: SIGTERM to the parent during a long run ends the detached tree too, and the parent still dies of SIGTERM
    const ui = path.join(__dirname, 'ui-suite.js');
    const parentCode = `const {spawn}=require('child_process');const {guardTree}=require(${JSON.stringify(ui)});
      const c=spawn(process.execPath,['-e',"const g=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(g.pid);setInterval(()=>{},1000)"],{detached:true,stdio:['ignore','pipe','ignore']});
      guardTree(c);c.stdout.once('data',(b)=>console.log(c.pid+' '+String(b).trim()));setInterval(()=>{},1000);`;
    const parent = spawn(process.execPath, ['-e', parentCode], { stdio: ['ignore', 'pipe', 'inherit'] });
    const [cpid, gpid] = await new Promise((r) => parent.stdout.once('data', (b) => r(String(b).trim().split(' ').map(Number))));
    const ended = new Promise((r) => parent.on('exit', (code, signal) => r({ code, signal })));
    parent.kill('SIGTERM');
    // bounded (agent-notes: a promise that never settles passes silently): a parent that does not die fails here, and is cleaned up
    const how = await Promise.race([ended, new Promise((r) => setTimeout(() => r({ timedOut: true }), 10000))]);
    if (how.timedOut) { for (const p of [parent.pid, cpid, gpid]) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } } try { process.kill(-cpid, 'SIGKILL'); } catch { /* gone */ } }
    assert.strictEqual(how.signal, 'SIGTERM', `the parent is re-raised with SIGTERM (${JSON.stringify(how)})`);
    let gone2 = false;
    for (let i = 0; i < 100 && !gone2; i++) { if (!alive(cpid) && !alive(gpid)) gone2 = true; else await new Promise((r) => setTimeout(r, 50)); }
    if (!gone2) { try { process.kill(-cpid, 'SIGKILL'); } catch { /* gone */ } try { process.kill(gpid, 'SIGKILL'); } catch { /* gone */ } }
    assert.ok(gone2, 'SIGTERM on the parent ends the detached child and grandchild');
  } else console.log('release-video: POSIX tree-kill cases skipped on Windows');
  // guardTree on any OS (a fake process): each signal and exit kill the tree, release() removes every handler
  {
    const { EventEmitter } = require('events');
    const { guardTree } = require('./ui-suite');
    for (const ev of ['SIGINT', 'SIGTERM', 'exit']) {
      const proc = new EventEmitter(); proc.pid = 7; const raised = []; proc.kill = (pid, sig) => raised.push([pid, sig]);
      const killed = [];
      guardTree({ pid: 9 }, { proc, kill: (c, o) => killed.push([c.pid, o.sync]) });
      proc.emit(ev, ev);
      assert.deepStrictEqual(killed, [[9, true]], `${ev}: the tree is killed (synchronously)`);
      assert.deepStrictEqual(raised, ev === 'exit' ? [] : [[7, ev]], `${ev}: a signal is raised again with its default action`);
      if (ev !== 'exit') assert.strictEqual(proc.listenerCount('SIGINT') + proc.listenerCount('SIGTERM') + proc.listenerCount('exit'), 0, `${ev}: handlers removed before re-raising`);
    }
    const proc = new EventEmitter(); proc.pid = 7; proc.kill = () => {};
    const release = guardTree({ pid: 9 }, { proc, kill: () => { throw new Error('must not kill after release'); } });
    release();
    assert.strictEqual(proc.listenerCount('SIGINT') + proc.listenerCount('SIGTERM') + proc.listenerCount('exit'), 0, 'release() removes the handlers');
    proc.emit('exit');
    const calls = [];
    const { killTree: kt } = require('./ui-suite');
    kt({ pid: 5 }, { platform: 'win32', run: (f, a) => calls.push([f, ...a]) });
    assert.deepStrictEqual(calls, [['taskkill', '/pid', '5', '/T', '/F']], 'Windows: the arguments');
    const uisrc = fs.readFileSync(path.join(__dirname, 'ui-suite.js'), 'utf8');
    assert.ok(/const releaseGuard = d\.killTree \? guardTree\(child\)/.test(uisrc) && /clearTimeout\(timer\);\s*releaseGuard\(\);/.test(uisrc), 'runOne guards a killTree run and releases when it closes');
  }
  console.log('release-video: tests passed');
})().catch((e) => { console.error(e); process.exitCode = 1; });
