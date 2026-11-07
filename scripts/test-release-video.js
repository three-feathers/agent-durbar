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
assert.strictEqual(ok.scenes, null, 'no --scenes: main() picks the scenes from the release, there is no fixed default list');
assert.strictEqual(RV.DEFAULT_SCENES, undefined, 'no fixed DEFAULT_SCENES list is left to go stale');
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

// ---- issue #1214: step captions are numbered 1..n by position in the clip, never by a number typed into a scene ----
{
  const shown = (ids) => {
    const step = RV.stepCounter();
    const out = [];
    for (const sid of ids) for (const m of RV.SCENES[sid].play.toString().matchAll(/S\.caption\('((?:[^'\\]|\\.)*)'/g)) out.push(RV.fill(m[1], { version: '', count: null }, step));
    return out;
  };
  const numbers = (caps) => caps.map((c) => /^(\d+)\. /.exec(c)).filter(Boolean).map((m) => Number(m[1]));
  const caps = shown(['intro', 'lounge', 'railwidth', 'signin', 'notesource', 'outro']);
  const got = numbers(caps);
  assert.ok(got.length >= 2, 'the default clip has numbered steps');
  assert.deepStrictEqual(got, got.map((_, i) => i + 1), `step numbers are 1..n in the order shown (got ${got.join(',')})`);
  assert.ok(!caps.some((c) => /\{step\}/.test(c)), 'no {step} is left unfilled');
  const reversed = shown(['needsyou', 'refresh']);
  assert.deepStrictEqual(numbers(reversed), numbers(reversed).map((_, i) => i + 1), 'another scene order is numbered 1..n too');
  for (const [sid, sc] of Object.entries(RV.SCENES)) assert.ok(!/caption\('\d+\. /.test(sc.play.toString()), `${sid}: a step caption uses {step}, not a typed number`);
}

// ---- spec 008 delta 2026-11-07: the default scenes follow the release; the v0.1.12 scenes ----
/* v0.1.12's fragments, shortened to their spec and FR parts (the text a release names its changes with) */
const V12 = [
  "- **Drag the agent list's width** (spec 005 FR-236, issue #1223): the right edge of the rail beside a chat is a splitter.",
  "- MCP: the chat's *Sign in...* button now starts the sign-in (spec 058 FR-229, issue #1229).",
  "- **Notes: Open source** (spec 083 FR-046, [issue 699](https://example.org/699)): a note's menu opens the chat it came from.",
  "- **Real office: finished agents sit in a lounge row** (spec 097 FR-246..FR-249, issue #1220): a compact row.",
  "- **Agent rules shortened** (spec 021 FR-063): two sentences say the same thing in fewer words.",
];
const checkChoice = (M) => {
  const pick = (bullets, sceneFields) => M.chooseScenes({ bullets, sceneFields: sceneFields || [] });
  // the v0.1.12 release: its four scenes between the cards, the lounge (the headline) first
  assert.deepStrictEqual(pick(V12), ['intro', 'lounge', 'railwidth', 'signin', 'notesource', 'outro'], 'the default clip of v0.1.12 shows its four scenes');
  assert.strictEqual(pick(V12)[0], 'intro', 'the title card is first');
  assert.strictEqual(pick(V12).slice(-1)[0], 'outro', 'the end card is last');
  // a release that changes none of them gets none of them (v0.1.11's old list is not a default)
  assert.deepStrictEqual(M.sceneIdsFor(['- **Cookie header hidden** (spec 012 FR-168, issue #1159): a token.', V12[4], '- **A thing** (spec 058 FR-300): not a scene.']), [], 'FR-300 of spec 058 and the other specs are no scene')
  assert.throws(() => pick([V12[4]]), /no scene shows this release.*--scenes/, 'nothing to show is an error that asks for --scenes');
  assert.throws(() => pick([]), /no scene shows this release/, 'an empty release is an error too');
  // FR matching: ranges, either end, a single FR, the spec number
  const lounge = (b) => M.sceneIdsFor([b]).includes('lounge');
  assert.ok(lounge('- x (spec 097 FR-246..FR-249): a'), 'a range that covers the scene');
  assert.ok(lounge('- x (spec 097 FR-249): a'), 'the last FR of the scene');
  assert.ok(lounge('- x (spec 097 FR-246): a'), 'the first FR of the scene');
  assert.ok(lounge('- x (spec 097 FR-240..250): a'), 'a range around the scene (second number without FR-)');
  assert.ok(!lounge('- x (spec 097 FR-250): a'), 'the FR after the scene');
  assert.ok(!lounge('- x (spec 097 FR-245): a'), 'the FR before the scene');
  assert.ok(!lounge('- x (spec 005 FR-246): a'), 'the FR of another spec');
  assert.ok(!lounge('- x (spec 097): a'), 'a spec named without FR numbers does not show an FR scene');
  // one parenthesis naming two specs: each spec gets its own FR list (the first list used to swallow the second spec)
  assert.ok(lounge('- x (spec 021 FR-063, spec 097 FR-246): a'), 'two specs in one parenthesis: the second owns the FR');
  assert.ok(!lounge('- x (spec 097 FR-100, spec 021 FR-246): a'), 'two specs in one parenthesis: the FR belongs to the other spec, not the lounge');
  assert.ok(lounge('- x (spec 021 FR-063; spec 097 FR-246..FR-249 and spec 008 FR-1): a'), 'a semicolon and an "and" between specs');
  assert.deepStrictEqual(M.frsNamed('(spec 021 FR-063, spec 097 FR-246)', '097'), [[246, 246]], 'frsNamed: the second spec of a pair');
  assert.deepStrictEqual(M.frsNamed('(spec 021 FR-063, spec 097 FR-246)', '021'), [[63, 63]], 'frsNamed: the first spec of a pair keeps only its own FR');
  assert.ok(M.sceneIdsFor(['- x (spec 100): a']).includes('mcp'), 'a scene without `fr` takes any change to its spec');
  // Scene: fields come first, then refs; unknown ids and the cards are ignored; at most AUTO_MAX feature scenes
  assert.deepStrictEqual(pick(V12, ['notesource']).slice(1, 3), ['notesource', 'lounge'], 'a Scene: field comes first, once');
  assert.deepStrictEqual(pick([], ['crews', 'crews']), ['intro', 'crews', 'outro'], 'a Scene: field alone picks its scene, once');
  assert.throws(() => pick([], ['intro', 'nope', 'toString']), /no scene shows/, 'the cards and unknown ids are no scene');
  const six = ['crews', 'mcp', 'org', 'floors', 'refresh', 'needsyou'];
  assert.strictEqual(M.AUTO_MAX, 5, 'AUTO_MAX is pinned at 5 feature scenes (a clip of 6 would pass LEN_MAX)');
  assert.deepStrictEqual(pick([], six), ['intro', 'crews', 'mcp', 'org', 'floors', 'refresh', 'outro'], 'six candidates are cut to AUTO_MAX (5) scenes between the cards');
  assert.ok(!lounge('- x (respec 097 FR-246): a') && !lounge('- x (prespec 097 FR-246): a'), '"respec 097" is not "spec 097" (word boundary)');
};
checkChoice(RV);
for (const [sid, sc] of Object.entries(RV.SCENES)) {
  for (const r of sc.refs || []) {
    assert.ok(/^\d{3}$/.test(r.spec) && fs.readdirSync(path.join(__dirname, '..', 'specs')).some((d) => d.startsWith(r.spec + '-')), `${sid}: its ref names a spec that exists (${r.spec})`);
    assert.ok(!r.fr || (r.fr.length === 2 && r.fr[0] <= r.fr[1]), `${sid}: fr is [first, last]`);
  }
  if (sid !== 'intro' && sid !== 'outro') assert.ok((sc.refs || []).length > 0 || ['office'].includes(sid), `${sid}: a scene says what it shows (refs), or the default can never pick it`);
}
{
  // the four v0.1.12 scenes: ids, order of their captions, the step numbers in a clip made of all of them, and zoom + privacy check on each
  for (const id of ['lounge', 'railwidth', 'signin', 'notesource']) assert.ok(RV.SCENES[id], `the catalogue has ${id}`);
  const caps = (id) => [...RV.SCENES[id].play.toString().matchAll(/S\.caption\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
  assert.deepStrictEqual(caps('lounge').slice(0, 2), ['{step}. Finished, reply not read yet', '{step}. Read: they move to the lounge row'], 'lounge: unread first, then the lounge row');
  assert.deepStrictEqual(caps('railwidth').filter((c) => /^\{step\}/.test(c)).map((c) => c.replace(/^\{step\}\. /, '')), ['The rail is 220 px wide', 'Drag it wider', 'Or narrower', 'Double-click: back to 220 px'], 'railwidth: the captions in the order of the actions');
  assert.ok(caps('signin').length === 2 && /needs you/.test(caps('signin')[0]) && /starts the sign-in/.test(caps('signin')[1]), 'signin: the line first, then the click');
  assert.ok(/Open source/.test(caps('notesource')[1]) && /at that message/.test(caps('notesource')[2]), 'notesource: the note, its menu, the opened chat');
  const src4 = fs.readFileSync(path.join(__dirname, 'release-video.js'), 'utf8');
  assert.ok(!/RV_SCENES \|\| DEFAULT/.test(src4) && /RV_SCENES is not set/.test(src4), 'the driver has no fixed fallback list either');
}
const checkSources = (M) => {
  // releaseSources: the pending fragments (bullets and Scene: fields) and the version's own section of a folded CHANGELOG.md, not another version's
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-src-'));
  try {
    fs.mkdirSync(path.join(root, 'changelog.d'));
    fs.writeFileSync(path.join(root, 'changelog.d', 'a.md'), '- **Crews** (spec 077 FR-075): more.\n  Scene: crews\n');
    fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\n\n## Unreleased\n\n## v0.9.0 (2026-01-01)\n\n- **Rail** (spec 005 FR-236): drag.\n\n## v0.8.0 (2025-12-01)\n\n- **Lounge** (spec 097 FR-246): old.\n\n## v0.1.11 (2025-11-01)\n\n- **Sign in** (spec 058 FR-229): old.\n');
    const src = M.releaseSources('v0.9.0', root);
    assert.deepStrictEqual(src.sceneFields, ['crews'], 'the fragment\'s Scene: field');
    assert.deepStrictEqual(M.chooseScenes(src), ['intro', 'crews', 'railwidth', 'outro'], 'a fragment and the folded section of that version');
    assert.ok(!M.chooseScenes(src).includes('lounge'), 'another version\'s section is not read');
    assert.deepStrictEqual(M.releaseSources('v0.7.0', root).bullets.length, 1, 'a version with no section: the fragments alone');
    assert.strictEqual(M.releaseSources('v0.1.1', root).bullets.length, 1, 'v0.1.1 does not read the v0.1.11 section (exact heading match, not a prefix)');
    // a CRLF CHANGELOG (a Windows checkout), the heading bare so a stray \r would break an exact match
    fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\r\n\r\n## v0.9.0\r\n\r\n- **Rail** (spec 005 FR-236): drag.\r\n\r\n## v0.8.0\r\n\r\n- **Lounge** (spec 097 FR-246): old.\r\n');
    const crlf = M.releaseSources('v0.9.0', root);
    assert.strictEqual(crlf.bullets.filter((b) => /spec 005/.test(b)).length, 1, 'a CRLF CHANGELOG: the version\'s section is found');
    assert.ok(!crlf.bullets.some((b) => /spec 097/.test(b)), 'a CRLF CHANGELOG: the next section is not read');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
};
checkSources(RV);
const pending = []; // promises the async block at the end awaits
{
  // main() with no --scenes and no match: a clear error, no release-* file, no recording, and the command exits non-zero
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-nomatch-'));
  try {
    fs.rmSync(out, { recursive: true, force: true }); // the --out folder must not exist before, so its creation would show
    let started = false;
    const outFolderAbsent = () => assert.ok(!fs.existsSync(out), 'the --out folder is not created when no scene shows the release');
    pending.push(assert.rejects(RV.main(['--version', 'v9.9.9', '--out', out], { releaseSources: () => ({ bullets: ['- **Nothing** (spec 021 FR-063): x.'], sceneFields: [] }), hasFfmpeg: () => true, ensure: () => true, runOne: async () => { started = true; } }), /no scene shows this release.*--scenes/).then(() => {
      assert.ok(!started, 'no recording starts without scenes');
      outFolderAbsent();
    }));
    // the real command, in a copy of the scripts over an empty changelog: exit code 1 and the message on stderr
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-cmd-'));
    fs.mkdirSync(path.join(fake, 'scripts')); fs.mkdirSync(path.join(fake, 'changelog.d'));
    for (const f of ['release-video.js', 'changelog.js']) fs.copyFileSync(path.join(__dirname, f), path.join(fake, 'scripts', f));
    fs.writeFileSync(path.join(fake, 'CHANGELOG.md'), '# Changelog\n\n## Unreleased\n');
    const r = require('child_process').spawnSync(process.execPath, [path.join(fake, 'scripts', 'release-video.js'), '--version', 'v9.9.9', '--out', path.join(fake, 'out')], { encoding: 'utf8', timeout: 20000 });
    assert.strictEqual(r.status, 1, 'the command exits non-zero when no scene shows the release');
    assert.ok(/no scene shows this release.*--scenes/.test(r.stderr), 'and says so: ' + r.stderr);
    assert.ok(!fs.existsSync(path.join(fake, 'out')), 'the command creates no --out folder when no scene shows the release');
    fs.rmSync(fake, { recursive: true, force: true });
  } finally { setTimeout(() => fs.rmSync(out, { recursive: true, force: true }), 1000).unref(); }
}
// the GIF cap is 5 MiB (FR-172); the v0.1.12 GIF (5,240,561 bytes) is under it
assert.strictEqual(RV.GIF_MAX, 5 * 1024 * 1024, 'the GIF cap is 5 MiB');
assert.strictEqual(RV.GIF_MAX, 5242880);
assert.ok(5240561 <= RV.GIF_MAX, 'the v0.1.12 GIF is under the cap');

{
  // mutants of release-video.js: each must fail checkChoice with the assert it is aimed at (a mutant that fails for another reason does not count)
  const src5 = fs.readFileSync(path.join(__dirname, 'release-video.js'), 'utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-mut-'));
  const mutants = [
    ['refs ignored: the default is empty of release scenes', "const byRef = sceneIdsFor(bullets, scenes).filter((id) => !named.includes(id));", "const byRef = [];", /no scene shows this release|v0\.1\.12/],
    ['last FR of a scene not counted', 'lo <= ref.fr[1] && hi >= ref.fr[0]', 'lo < ref.fr[1] && hi > ref.fr[0]', /the default clip of v0\.1\.12|the last FR of the scene/],
    ['range end beyond the scene ignored', 'lo <= ref.fr[1] && hi >= ref.fr[0]', 'lo >= ref.fr[0] && hi <= ref.fr[1]', /a range that covers the scene|a range around the scene/],
    ['the spec number ignored', "if (m[1] !== spec) continue;", "", /the FR of another spec|the default clip of v0\.1\.12/],
    ['no end card', "return ['intro', ...feature, 'outro'];", "return ['intro', ...feature];", /the default clip of v0\.1\.12/],
    ['no title card', "return ['intro', ...feature, 'outro'];", "return [...feature, 'outro'];", /the default clip of v0\.1\.12/],
    ['nothing to show falls back instead of an error', "if (!feature.length) throw new Error(", "if (false) throw new Error(", /nothing to show is an error/],
    ['no cap on the number of scenes', ".slice(0, AUTO_MAX);", ";", /cut to AUTO_MAX/],
    ['Scene: fields after refs', "const feature = [...named, ...byRef]", "const feature = [...byRef, ...named]", /a Scene: field comes first/],
    ['prefix version match', "l.startsWith(`## ${version} `) || l === `## ${version}`", "l.startsWith(`## ${version}`)", /v0\.1\.1 does not read/],
    ['CRLF not normalised', ".replace(/\\r\\n?/g, '\\n').split('\\n');\n    const at", ".split('\\n');\n    const at", /CRLF CHANGELOG/],
    ['an FR list runs to the closing parenthesis (two specs in one)', "((?:(?!\\bspec \\d{3}\\b)[^)])*)", "([^)]*)", /second owns the FR|frsNamed: the second spec/],
    ['spec without a word boundary', "/\\bspec (\\d{3})", "/spec (\\d{3})", /word boundary/],
    ['AUTO_MAX raised', "const AUTO_MAX = 5;", "const AUTO_MAX = 6;", /AUTO_MAX is pinned|cut to AUTO_MAX/],
    ['spec without FR numbers shows an FR scene', "if (!ref.fr) return true;\n  return got.some", "if (!ref.fr || !got.length) return true;\n  return got.some", /named without FR numbers/],
  ];
  try {
    mutants.forEach(([name, from, to, expect], i) => {
      assert.ok(src5.includes(from), `mutant "${name}": its target text is still in release-video.js`);
      fs.mkdirSync(path.join(dir, String(i))); // its own folder: changelog.js finds the scene ids in ./release-video.js beside it
      fs.copyFileSync(path.join(__dirname, 'changelog.js'), path.join(dir, String(i), 'changelog.js'));
      const file = path.join(dir, String(i), 'release-video.js');
      fs.writeFileSync(file, src5.replace(from, to));
      const M = require(file);
      assert.throws(() => { checkChoice(M); checkSources(M); }, (e) => e && e.message && expect.test(e.message), `mutant "${name}" is killed by its intended assert`);
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

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

// ---- owner review of the v0.1.9 clip: any home folder written out is refused, not only this machine's ----
{
  const none = RV.privacyProblems;
  for (const t of ['node /home/vikram/tools/notes-mcp.js', 'at /Users/someone/x', 'C:\\Users\\pat\\notes', 'c:/Users/pat', '(/home/a.b)'])
    assert.ok(none(t, [], (x) => x).includes('a home folder path'), `a home folder in ${JSON.stringify(t)}`);
  for (const t of ['node ~/projects/demo/tools/notes-mcp.js', '/srv/home/x', '~/work/mcp-swiss', '/homework/x', 'see /home/ alone'])
    assert.deepStrictEqual(none(t, [], (x) => x), [], `no home folder in ${JSON.stringify(t)}`);
}

// ---- the camera: eased zooms onto the part that changes, sharp at 2x, never out of the app frame ----
{
  const { W, H_ } = RV;
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const shape = (c) => near(c.w / c.h, W / H_);
  // a small target: the zoom stops at ZOOM_MAX, centred on it
  const c1 = RV.fitCamera({ x: 600, y: 400, w: 100, h: 40 });
  assert.ok(shape(c1) && near(c1.w, W / RV.ZOOM_MAX), `at most ${RV.ZOOM_MAX}x`);
  assert.ok(near(c1.x + c1.w / 2, 650) && near(c1.y + c1.h / 2, 420), 'centred on the target');
  // a target near an edge: the camera stays inside the app (no black border)
  for (const r of [{ x: 0, y: 0, w: 50, h: 20 }, { x: W - 30, y: H_ - 10, w: 30, h: 10 }, { x: -40, y: 850, w: 200, h: 100 }]) {
    const c = RV.fitCamera(r);
    assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= W + 1e-9 && c.y + c.h <= H_ + 1e-9 && shape(c), `inside the frame for ${JSON.stringify(r)}`);
  }
  // a wide or tall target is shown whole; a target larger than the app is the whole app
  const wide = RV.fitCamera({ x: 100, y: 300, w: 1000, h: 50 });
  assert.ok(wide.w >= 1000 && wide.x <= 100 && wide.x + wide.w >= 1100 && shape(wide), 'a wide target fits across');
  const tall = RV.fitCamera({ x: 100, y: 100, w: 100, h: 600 });
  assert.ok(tall.h >= 600 && tall.y <= 100 && tall.y + tall.h >= 700 && shape(tall), 'a tall target fits down');
  assert.deepStrictEqual(RV.fitCamera({ x: -10, y: -10, w: 3000, h: 2000 }), { x: 0, y: 0, w: W, h: H_ }, 'larger than the app: the whole app');
  assert.throws(() => RV.fitCamera({ x: 0, y: 0, w: 0, h: 10 }), /no size/);
  assert.throws(() => RV.fitCamera(null), /no size/);
  // easing: at rest at both ends, monotonic between
  assert.ok(RV.ease(0) === 0 && RV.ease(1) === 1 && near(RV.ease(0.5), 0.5) && RV.ease(-1) === 0 && RV.ease(2) === 1);
  for (let u = 0; u < 1; u += 0.05) assert.ok(RV.ease(u + 0.05) >= RV.ease(u), 'monotonic');
  assert.ok(RV.ease(0.05) < 0.05 && RV.ease(0.95) > 0.95, 'slow at the start and the end');
  // the path: ZOOM_FPS frames a second, ends exactly on the target, moves one way
  const p = RV.zoomPath(RV.FULL, c1, 0.7);
  assert.strictEqual(p.length, Math.round(0.7 * RV.ZOOM_FPS));
  assert.deepStrictEqual(p[p.length - 1], { x: c1.x, y: c1.y, w: c1.w, h: c1.h }, 'ends on the target');
  for (let i = 1; i < p.length; i++) assert.ok(p[i].w <= p[i - 1].w, 'zooms in steadily');
  assert.ok(RV.ZOOM_SECS >= 0.6 && RV.ZOOM_SECS <= 0.8, 'the owner asked for about 0.6-0.8 s');
  assert.ok(RV.zoomPath(c1, c1, 0.01).length >= 2, 'even a tiny move has frames');
  // the crop in device pixels: a 2x capture of a 2x zoom is one captured pixel per clip pixel
  const cr = RV.cropRect(c1, 2);
  assert.ok(cr.width === Math.round(W / RV.ZOOM_MAX * 2) && cr.width === W, 'a 2x zoom on a 2x capture: no upscaling');
  assert.deepStrictEqual(RV.cropRect(RV.FULL, 1), { x: 0, y: 0, width: W, height: H_ });
  const edge = RV.cropRect({ x: W - 720.4, y: H_ - 450.4, w: 720.6, h: 450.6 }, 2);
  assert.ok(edge.x + edge.width <= W * 2 && edge.y + edge.height <= H_ * 2, 'rounding never leaves the capture');
  // stills: one per scene plus one per zoom
  assert.deepStrictEqual(RV.stillNames('release-v0.1.9', { n: '02', id: 'refresh', still: 'f00010.png', zoomStills: ['f00004.png', 'f00007.png'] }).map((x) => x[0]),
    ['release-v0.1.9-scene-02-refresh.png', 'release-v0.1.9-scene-02-refresh-zoom.png', 'release-v0.1.9-scene-02-refresh-zoom-2.png']);
  assert.deepStrictEqual(RV.stillNames('b', { n: '01', id: 'intro', still: 'f1.png' }).map((x) => x[0]), ['b-scene-01-intro.png'], 'a scene without a zoom');
  // every feature scene of the default clip zooms (the owner: "not followable" without)
  const src3 = fs.readFileSync(path.join(__dirname, 'release-video.js'), 'utf8');
  for (const id of ['refresh', 'needsyou', 'mcpsettings', 'lounge', 'railwidth', 'signin', 'notesource']) {
    const body = src3.slice(src3.indexOf(`  ${id}: {`), src3.indexOf('\n  },', src3.indexOf(`  ${id}: {`)));
    assert.ok(/S\.zoomTo\(/.test(body), `${id} zooms onto what changed`);
  }
  assert.ok(/dpr: 2/.test(src3), 'recorded at 2 device pixels a CSS pixel, so zoomed text stays sharp');
  // the outro without --count names no empty number
  assert.strictEqual(RV.fill(RV.sceneTitle(RV.SCENES.outro, { version: 'v0.1.9', count: null }), { version: 'v0.1.9', count: null }), 'All changes in v0.1.9');
  assert.strictEqual(RV.fill(RV.sceneTitle(RV.SCENES.outro, { version: 'v0.1.9', count: '20' }), { version: 'v0.1.9', count: '20' }), '20 changes in v0.1.9');
}

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
  await Promise.all(pending); // the no-match main() case
  setTimeout(() => { console.error('release-video: the test hung (90 s)'); process.exit(1); }, 90000).unref(); // a stuck child fails instead of hanging
  { // FR-175: a run that finds no scene removes the old clip first (the choice comes after the removal), and keeps no folder it did not have
    const run = async (M) => {
      const o = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-nomatch2-'));
      try {
        for (const x of ['.mp4', '.gif', '.json']) fs.writeFileSync(path.join(o, 'release-v9.9.9' + x), 'old');
        await assert.rejects(M.main(['--version', 'v9.9.9', '--out', o], { releaseSources: () => ({ bullets: [], sceneFields: [] }), hasFfmpeg: () => true, ensure: () => true, runOne: async () => { throw new Error('no recording'); } }), /no scene shows this release/);
        assert.deepStrictEqual(fs.readdirSync(o).filter((f) => f.startsWith('release-')), [], 'a failed no-match run leaves no old clip behind (FR-175)');
      } finally { fs.rmSync(o, { recursive: true, force: true }); }
    };
    await run(RV);
    // mutant: the choice before the removal (the old order) must fail that assert
    const srcM = fs.readFileSync(path.join(__dirname, 'release-video.js'), 'utf8');
    const line = srcM.split('\n').find((l) => l.startsWith('  if (a.scenes === null) a.scenes = (deps.chooseScenes'));
    const rmLine = '  for (const f of finals) fs.rmSync(f, { force: true });';
    assert.ok(line && srcM.includes(rmLine), 'the choice line and the removal are found');
    const md = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-mut2-'));
    try {
      fs.copyFileSync(path.join(__dirname, 'changelog.js'), path.join(md, 'changelog.js'));
      const mf = path.join(md, 'release-video.js');
      fs.writeFileSync(mf, srcM.replace(line + '\n', '').replace('  const out = path.resolve(a.out);\n', line + '\n  const out = path.resolve(a.out);\n'));
      await assert.rejects(run(require(mf)), /leaves no old clip behind/, 'mutant: the choice before the removal is killed by its assert');
    } finally { fs.rmSync(md, { recursive: true, force: true }); }
  }
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-test-'));
  try {
    fs.writeFileSync(path.join(out, 'release-v0.1.7.gif'), 'old');
    let started = false;
    await assert.rejects(RV.main(['--version', 'v0.1.7', '--out', out], { chooseScenes: () => ['intro', 'outro'], hasFfmpeg: () => false, runOne: async () => { started = true; } }), /ffmpeg was not found/);
    assert.ok(!started, 'no Electron without ffmpeg');
    assert.ok(!fs.existsSync(path.join(out, 'release-v0.1.7.gif')), 'an old clip is removed first, so it never stands in for this run');
    fs.writeFileSync(path.join(out, 'release-v0.1.7.gif'), 'old');
    const distOk = fs.existsSync(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'));
    if (distOk) {
      await assert.rejects(RV.main(['--version', 'v0.1.7', '--out', out], { chooseScenes: () => ['intro', 'outro'], hasFfmpeg: () => true, ensure: () => true, runOne: async () => ({ ok: false, code: 1, why: 'DRIVER FAILED privacy check failed', log: 'x' }) }), /recording failed/);
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
      const m2 = await RV.main(['--version', 'v0.1.7', '--out', out], { chooseScenes: () => ['intro', 'outro'], hasFfmpeg: () => true, ensure: () => true, runOne: rec, run: fakeRun });
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
