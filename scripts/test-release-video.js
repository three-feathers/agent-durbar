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
const forbidden = RV.forbiddenValues({ home: '/home/alice', user: 'alice', host: 'alice-laptop', root: '/home/alice/src/agent-durbar' });
assert.ok(forbidden.includes('/home/alice') && forbidden.includes('\\home\\alice'), 'the home folder, both slashes');
assert.ok(forbidden.includes('alice-laptop') && forbidden.includes('alice'));
assert.deepStrictEqual(RV.forbiddenValues({ home: '/h', user: 'bob', host: 'x', root: '/r' }), [], 'values under 4 characters are not matched');
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

// ---- the command's failure paths (FR-175): no ffmpeg, a failed recording; nothing is left behind ----
(async () => {
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
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
  console.log('release-video: tests passed');
})().catch((e) => { console.error(e); process.exitCode = 1; });
