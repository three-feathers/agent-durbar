/*
 * Spec 008 FR-272 delta 2026-11-18 (issue #1864, `npm run test:releasenodeps`, part of `npm test`): release.yml's verify job runs
 * plain Node with no dependency installed. Tag v0.1.24 failed there with "Cannot find module 'marked'" because changelog.js's
 * check() loaded build-site.js for the site rules. This suite:
 *  1. reads every `run:` of the verify job and refuses one that is not `node scripts/<file>.js ...` with a covered file, so a new
 *     step there needs a case here;
 *  2. runs each such command line, exactly as release.yml writes it (only the env values filled in), in a throwaway tagged git
 *     repository that has `docs/site/unreleased.json` (so the site rules would apply) and a copy of `scripts/*.js`, under
 *     `node --require <hook>`: the hook refuses every module that is neither a Node builtin nor a file path, naming it;
 *  3. checks `check()` itself: with `siteRules: false` it never loads build-site.js (the same hook, in this process), and with the
 *     default it still does (the site rules stay on for `npm run changelog:check`).
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');

const SCRIPTS = __dirname;
const made = [];
const mkTmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); made.push(d); return d; };
process.on('exit', () => { for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* the OS cleans its temp folder */ } } });

// the hook: only builtins and file paths (relative or absolute) may be required; anything else is a dependency the job lacks
const HOOK_TEXT = `'use strict';
const Module = require('module');
const path = require('path');
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (!Module.isBuiltin(request) && !request.startsWith('.') && !path.isAbsolute(request)) {
    throw new Error('release-nodeps: dependency "' + request + '" is required, but release.yml\\'s verify job installs none');
  }
  return orig.call(this, request, ...rest);
};
`;
const hookDir = mkTmp('durbar-nodeps-hook-');
const hookFile = path.join(hookDir, 'no-deps-hook.js');
fs.writeFileSync(hookFile, HOOK_TEXT);

// --- 1. the verify job's commands ---
const wf = fs.readFileSync(path.join(SCRIPTS, '..', '.github', 'workflows', 'release.yml'), 'utf8').replace(/\r\n?/g, '\n');
const body = wf.slice(wf.search(/^jobs:/m));
const verify = (/^ {2}verify:\n([\s\S]*?)(?=^ {2}[\w-]+:\n)/m.exec(body) || [])[1];
assert.ok(verify, 'release.yml has a verify job');
assert.ok(!/npm (ci|install)|\.\/\.github\/actions\/npm-ci/.test(verify), 'the verify job installs no dependency (the reason for this suite)');
const runs = [...verify.matchAll(/^ {8}run: (.*)$/gm)].map((m) => m[1].trim());
assert.ok(!/^ {8}run: [|>]/m.test(verify), 'the verify job has only one-line run steps (a block would hide commands from this suite)');
const COVERED = ['release-notes.js'];
assert.ok(runs.length >= 1, 'the verify job runs at least one command');
for (const r of runs) {
  const m = /^node scripts\/([\w.-]+\.js)( |$)/.exec(r);
  assert.ok(m, `verify step "${r}" is not a "node scripts/<file>.js" command: cover it in scripts/test-release-nodeps.js`);
  assert.ok(COVERED.includes(m[1]), `verify step runs scripts/${m[1]}, which scripts/test-release-nodeps.js does not cover yet`);
}

// --- 2. each command on a throwaway tagged repository, with every dependency refused ---
const emptyConfig = path.join(mkTmp('durbar-nodeps-gitconfig-'), 'config');
fs.writeFileSync(emptyConfig, '');
const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid', GIT_AUTHOR_DATE: '2026-11-18T01:00:00Z', GIT_COMMITTER_DATE: '2026-11-18T01:00:00Z' };
const g = (d, ...args) => execFileSync('git', args, { cwd: d, env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const fixture = () => {
  const d = mkTmp('durbar-nodeps-repo-');
  const w = (f, t) => { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), t); };
  w('CHANGELOG.md', '# Changelog\n\nIntro.\n\n## Unreleased (on `main`, after the v0.9.0 tag)\n\n## v0.9.0 ([release](https://example.invalid/v090), 2026-11-17)\n\n- Old entry.\n');
  w('changelog.d/README.md', '# not a fragment\n');
  w('docs/site/unreleased.json', '[]\n');
  w('package.json', `${JSON.stringify({ name: 'x', version: '0.9.0' })}\n`);
  g(d, 'init', '-q', '-b', 'main');
  g(d, 'add', '-A');
  g(d, 'commit', '-q', '-m', 'v0.9.0');
  g(d, 'tag', '-a', '-m', 'v0.9.0', 'v0.9.0');
  w('changelog.d/a.md', '- **Fixed: a thing** and more.\n');
  w('changelog.d/b.md', '- Internal: another thing.\n');
  w('package.json', `${JSON.stringify({ name: 'x', version: '0.9.1' })}\n`);
  g(d, 'add', '-A');
  g(d, 'commit', '-q', '-m', 'v0.9.1');
  g(d, 'tag', '-a', '-m', 'v0.9.1', 'v0.9.1');
  g(d, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  // the scripts as the job's checkout has them (untracked here: release-notes.js checks the commit, not the working tree)
  fs.mkdirSync(path.join(d, 'scripts'));
  for (const f of fs.readdirSync(SCRIPTS).filter((x) => x.endsWith('.js'))) fs.copyFileSync(path.join(SCRIPTS, f), path.join(d, 'scripts', f));
  return d;
};
const d = fixture();
const out = mkTmp('durbar-nodeps-out-');
const env = { TAG: 'v0.9.1', REPO: 'three-feathers/agent-durbar', GITHUB_OUTPUT: path.join(out, 'github-output'), GITHUB_STEP_SUMMARY: path.join(out, 'summary.md') };
for (const r of runs) {
  // the command line as release.yml writes it; only "$NAME" words are replaced by their values (no shell)
  const argv = r.split(/\s+/).map((a) => {
    const m = /^"\$([A-Z_]+)"$/.exec(a);
    if (!m) { assert.ok(!/[$"'`\\|;&<>]/.test(a), `verify step word ${a} needs a shell: cover it in scripts/test-release-nodeps.js`); return a; }
    assert.ok(m[1] in env, `verify step uses $${m[1]}, which scripts/test-release-nodeps.js does not fill in`);
    return env[m[1]];
  });
  assert.strictEqual(argv[0], 'node');
  let res;
  try {
    res = execFileSync(process.execPath, ['--require', hookFile, ...argv.slice(1)], { cwd: d, env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    assert.fail(`the release verify command runs with no dependency installed: ${r}\n${String(e.stderr || e.message).split('\n').filter((l) => l.trim()).slice(0, 3).join('\n')}`);
  }
  assert.ok(typeof res === 'string');
}
const notes = fs.readFileSync(path.join(d, 'release-notes.md'), 'utf8');
assert.match(notes, /^## v0\.9\.1 \(\[release\]\(https:\/\/github\.com\/three-feathers\/agent-durbar\/releases\/tag\/v0\.9\.1\), 2026-11-18\)\n\n- \*\*Fixed: a thing\*\* and more\.\n- Internal: another thing\.\n/m, 'the release verify command writes the notes from the tag\'s fragments');
assert.strictEqual(fs.readFileSync(path.join(d, 'release-title.txt'), 'utf8').trim(), 'Agent Durbar v0.9.1', 'the release verify command writes the title');
assert.match(fs.readFileSync(env.GITHUB_OUTPUT, 'utf8'), /prerelease=false\nlatest=true/, 'the release verify command writes the release kind');

// --- 3. check() itself, with the same hook in this process ---
{
  const orig = Module._resolveFilename;
  const siteFile = path.join(SCRIPTS, 'build-site.js');
  Module._resolveFilename = function (request, ...rest) {
    if (!Module.isBuiltin(request) && !request.startsWith('.') && !path.isAbsolute(request)) throw new Error(`release-nodeps: dependency "${request}" refused`);
    return orig.call(this, request, ...rest);
  };
  try {
    delete require.cache[siteFile];
    delete require.cache[path.join(SCRIPTS, 'changelog.js')];
    const cl = require('./changelog.js');
    const r = cl.check(d, { siteRules: false });
    assert.deepStrictEqual(r.errors, [], 'check with siteRules false: no errors on the fixture');
    assert.ok(!(siteFile in require.cache), 'check with siteRules false does not load build-site.js');
    assert.throws(() => cl.check(d), /dependency "marked" refused/, 'check by default still runs the site rules (build-site.js, which needs marked)');
  } finally {
    Module._resolveFilename = orig;
    delete require.cache[siteFile];
  }
}

console.log(`test-release-nodeps: ok (${runs.length} verify command(s) with no dependency installed; check() siteRules off and on)`);
