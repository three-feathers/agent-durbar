/*
 * Spec 104 FR-060..FR-068, FR-079, SC-004 (T005): `npm run test:blogcheck`. Every rule of scripts/check-posts.js has a fixture that
 * fails it and the clean post passes; the real repository passes. No network: `gh` is a fake that records its calls, git runs in a
 * throw-away repository. Stand-ins only: an invented token shape, path, address, host and phrase, never a real one.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const cp = require('./check-posts.js');

process.exitCode = 1; // set to 0 only after the last line (a promise that never settles must not pass)
const ROOT = path.join(__dirname, '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-blogcheck-'));
process.on('exit', () => { try { fs.rmSync(T, { recursive: true, force: true }); } catch { /* best effort */ } }); // a failed assert leaves nothing behind
const g = (...a) => execFileSync('git', a, { cwd: T, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(T, rel)), { recursive: true }); fs.writeFileSync(path.join(T, rel), text); };

// a small repository: the files the check reads, one commit on main
w('scripts/trusted-authors.txt', fs.readFileSync(path.join(ROOT, 'scripts/trusted-authors.txt'), 'utf8'));
w('scripts/check-posts.js', '// placeholder\n');
w('specs/104-x/spec.md', '# x\n');
w('docs/site/unreleased.json', JSON.stringify({ phrases: ['Zebra Moonbase'] }));
w('docs/site/blocked-hashes.json', JSON.stringify({ sha256: [cp.hashName('blocked-standin.example.invalid'), cp.hashName('quokkacorp')] }));
w('docs/site/captions/clip-a.vtt', 'WEBVTT\n\n00:00.000 --> 00:02.000\nHello\n');
const H64 = 'cd'.repeat(32);
const media = { files: [
  { name: 'clip-a.mp4', kind: 'clip', bytes: 1000000, sha256: H64, duration: 20, width: 1280, height: 720, fps: 30, poster: 'clip-a.webp', captions: 'docs/site/captions/clip-a.vtt', title: 'Clip', licence: 'MIT', madeBy: 'Claude Code (vikramgorla)', approvedBy: 'fjcabello' },
  { name: 'clip-a.webp', kind: 'poster', bytes: 30000, sha256: H64, width: 1280, height: 720, licence: 'MIT', madeBy: 'Claude Code (vikramgorla)', approvedBy: 'fjcabello' },
  { name: 'film-a.mp4', kind: 'film', bytes: 1000000, sha256: H64, duration: 20, width: 1280, height: 720, fps: 30, poster: 'clip-a.webp', captions: 'docs/site/captions/clip-a.vtt', title: 'Film', licence: 'MIT', madeBy: 'Claude Code (vikramgorla)', approvedBy: 'fjcabello' },
] };
w('docs/site/media.json', JSON.stringify(media));
g('init', '-q', '-b', 'main');
g('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'add', '-A');
g('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'base');
const SHA = g('rev-parse', 'HEAD');
g('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', 'tag', 'v0.1.0');
g('checkout', '-q', '-b', 'side');
g('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'not on main');
const SIDE = g('rev-parse', 'HEAD');

// the fake gh: answers author and editor by number; records every call; a release is published unless named in `drafts`
const people = { 1: ['vikramgorla', null], 2: ['outsider-x', null], 3: ['fjcabello', 'outsider-x'], 4: ['github-actions', null, 'Bot'] };
const comments = { 77: ['rubenlupi', null], 78: ['outsider-x', null] };
const ghFake = (calls, drafts = []) => (args) => {
  calls.push(args.join(' '));
  if (args[1] === 'graphql') {
    const i = (args.find((a) => /^i=/.test(a)) || '').slice(2);
    const id = (args.find((a) => /^id=/.test(a)) || '').slice(3);
    const who = (x, t) => (x ? { __typename: t || 'User', login: x } : null);
    if (id) { const [a, e] = comments[Number(id.replace('C_', ''))] || []; return JSON.stringify({ data: { node: a ? { author: who(a), editor: who(e) } : null } }); }
    const p = people[Number(i)];
    return JSON.stringify({ data: { repository: { issueOrPullRequest: p ? { __typename: 'Issue', author: who(p[0], p[2]), editor: who(p[1]) } : null } } });
  }
  const cm = /issues\/comments\/(\d+)$/.exec(args[1]);
  if (cm) return JSON.stringify({ node_id: `C_${cm[1]}`, user: { login: 'x' } });
  const rel = /releases\/tags\/(.+)$/.exec(args[1]);
  if (rel) return JSON.stringify({ tag_name: decodeURIComponent(rel[1]), draft: drafts.includes(decodeURIComponent(rel[1])) });
  throw new Error('unexpected gh call');
};

const front = (o = {}) => ({ date: '2026-11-05', title: 'Specs first', writtenBy: 'Claude Code', whose: 'vikramgorla', writtenOn: '2026-11-05',
  evidence: [{ commit: SHA }, { spec: 'specs/104-x/spec.md' }, { pr: 1 }], notVerified: ['Nothing here was run on a real session.'],
  humanRead: 'fjcabello', agentReview: { by: 'Claude Code', whose: 'rubenlupi' }, clip: 'clip-a.mp4', ...o });
const BODY = 'We write the spec before the code. The [plan](https://github.com/three-feathers/agent-durbar/blob/main/specs/104-site-story-blog/plan.md) lists 3 steps.\n\nThe check in `scripts/check-posts.js` runs on every pull request.\n';
const post = (f = front(), body = BODY) => `---\n${JSON.stringify(f, null, 1)}\n---\n${body}`;

/* Check a set of posts (name -> text) and other public texts; returns the rule ids found, and the gh calls. */
function check(files, o = {}) {
  fs.rmSync(path.join(T, 'docs/site/blog'), { recursive: true, force: true });
  fs.rmSync(path.join(T, 'docs/site/story'), { recursive: true, force: true });
  for (const f of fs.readdirSync(path.join(T, 'docs/site/captions'))) if (f !== 'clip-a.vtt') fs.rmSync(path.join(T, 'docs/site/captions', f), { recursive: true, force: true });
  for (const [rel, text] of Object.entries(files)) w(rel.includes('/') ? rel : `docs/site/blog/${rel}`, text);
  const calls = [];
  const r = cp.checkAll({ root: T, gh: o.offline ? undefined : ghFake(calls, o.drafts), offline: !!o.offline, env: o.env || {}, redactLoader: o.redactLoader });
  return { rules: [...new Set(r.problems.map((p) => p.rule))].sort(), problems: r.problems, notes: r.notes, calls };
}
const fails = (files, rule, what, o) => { const r = check(files, o); assert.ok(r.rules.includes(rule), `${what}: expected ${rule}, got ${JSON.stringify(r.rules)}`); return r; };
const passes = (files, what, o) => { const r = check(files, o); assert.deepStrictEqual(r.problems, [], `${what}: ${JSON.stringify(r.problems)}`); return r; };
const P = '2026-11-05-specs-first.md';

// the clean post passes, and its links were checked online (author and editor), never read
{
  const r = passes({ [P]: post() }, 'the clean post');
  assert.ok(r.calls.some((c) => /graphql/.test(c) && / i=1$/.test(c)), 'the evidence PR was checked online');
  assert.ok(r.calls.every((c) => !/body|title/.test(c)), 'the online check never asks for a title or body');
}

// SC-004 stand-ins, one rule each: secret, private path, chat marker, unreleased phrase, unknown host, blocked host
const TOKEN = `ghp_${'Ab1'.repeat(12)}`;
const body = (extra) => `${BODY}\n${extra}\n`;
fails({ [P]: post(front(), body(`Our key was ${TOKEN} once.`)) }, 'secret', 'a token');
fails({ [P]: post(front(), body(`Our key was gh**p_${'Ab1'.repeat(12)}** once.`)) }, 'secret', 'a token split by Markdown');
fails({ [P]: post(front(), body('The file sat in /home/standin/work today.')) }, 'path', 'a home folder');
fails({ [P]: post(front(), body('The file sat in C:\\Users\\standin\\work today.')) }, 'path', 'a Windows home folder');
fails({ [P]: post(front(), body('Config in ~/.claude/ stays private.')) }, 'path', 'a tilde path');
fails({ [P]: post(front(), body('Write to standin@example.invalid for more.')) }, 'email', 'an email address');
fails({ [P]: post(front(), body('Call +41 79 555 01 23 for more.')) }, 'phone', 'a phone number');
fails({ [P]: post(front(), body('Thanks to @StandinAgent_bot for the ping.')) }, 'bot-handle', 'a full bot handle');
passes({ [P]: post(front(), body('Thanks to the agent shown as @Standin\u2026_bot for the ping.')) }, 'a shortened bot handle');
fails({ [P]: post(front(), body('As said in the group chat_id -1001234567890.')) }, 'chat', 'a chat id');
fails({ [P]: post(front(), body('[21:04] Standin: ship it')) }, 'chat', 'a quoted chat line');
fails({ [P]: post(front(), body('See https://t.me/standin for it.')) }, 'chat', 'a chat link');
fails({ [P]: post(front(), body('The zebra moonbase is near.')) }, 'unreleased', 'an unreleased phrase');
fails({ [P]: post(front(), body('Hosted at standin-client.example.com for a while.')) }, 'host', 'an unknown bare host');
fails({ [P]: post(front(), body('Hosted at standin-client\\.example\\.com for a while.')) }, 'host', 'a host hidden by Markdown escapes');
fails({ [P]: post(front(), body('See [it](https://standin-client.example.com/x).')) }, 'host', 'an unknown URL host');
fails({ [P]: post(front(), body('Served from 10.0.0.12 for a while.')) }, 'host', 'an IP address');
fails({ [P]: post(front(), body('See [it](http://github.com/three-feathers).')) }, 'scheme', 'plain http');
{
  const r = fails({ [P]: post(front(), body('Hosted at blocked-standin.example.invalid once.')) }, 'blocked', 'a blocked host on the allowlist');
  assert.ok(!r.rules.includes('host'), 'the blocked rule, not the allowlist, refused it');
  fails({ [P]: post(front(), body('See https://www.blocked-standin.example.invalid/x once.')) }, 'blocked', 'a sub-host of a blocked host');
  fails({ [P]: post(front(), body('We once worked with QuokkaCorp on it.')) }, 'blocked', 'a blocked bare name');
}
passes({ [P]: post(front(), body('Links stay on https://github.com/three-feathers and https://three-feathers.github.io/agent-durbar/ and example.invalid.')) }, 'allowlisted hosts');
passes({ [P]: post(front(), body('Read `check-posts.js` and the e.g. Node.js note at v0.1.8.')) }, 'repository file names, versions and Node.js are not hosts');
fails({ [P]: post(front(), body('Vikram said so.')) }, 'first-name', 'a first name');
fails({ [P]: post(front(), body('Thanks, Rub\u00e9n.')) }, 'first-name', 'a first name with an accent');
passes({ [P]: post(front(), body('As `rubenlupi` and `fjcabello` agreed.')) }, 'handles, with a human read');

// a check that cannot mask fails closed, and so does a bad hash list
fails({ [P]: post() }, 'redact-unavailable', 'redact.ts cannot load', { redactLoader: () => { throw new Error('no type stripping'); } });
fails({ [P]: post(front(), body(`k ${TOKEN}`)) }, 'secret', 'a redact that returns a failure text still fails the line', { redactLoader: () => () => '[redaction failed]' });
{
  const keep = fs.readFileSync(path.join(T, 'docs/site/blocked-hashes.json'), 'utf8');
  w('docs/site/blocked-hashes.json', JSON.stringify({ sha256: ['not-a-hash'] }));
  fails({ [P]: post() }, 'file-read', 'a malformed hash list');
  w('docs/site/blocked-hashes.json', keep);
}

// the post's own rules
fails({ '2026-11-05_specs.md': post() }, 'file-name', 'a bad file name');
fails({ [P]: 'no front block\n' }, 'front', 'no front block');
fails({ [P]: '---\n{bad json\n---\nx\n' }, 'front', 'a malformed front block');
fails({ [P]: post(front({ tracking: 'x' })) }, 'front-key', 'an unknown front key');
fails({ [P]: post(front({ date: '2026-11-06' })) }, 'date', 'a date unlike the file name');
fails({ [P]: post(front({ date: '2026-02-30' })) }, 'date', 'an impossible date');
for (const k of ['title', 'writtenBy', 'whose', 'writtenOn']) fails({ [P]: post(front({ [k]: undefined })) }, 'label', `no ${k}`);
fails({ [P]: post(front({ whose: 'someone-else' })) }, 'label', 'whose is not an owner');
fails({ [P]: post(front({ writtenOn: '2026-11-04' })) }, 'label', 'written before the day it is about');
passes({ [P]: post(front({ writtenOn: '2026-11-20' })) }, 'a back-filled post, written later');
fails({ [P]: post(front({ evidence: [] })) }, 'evidence', 'no evidence');
fails({ [P]: post(front({ evidence: [{ commit: SIDE }] })) }, 'evidence', 'a commit not on main');
fails({ [P]: post(front({ evidence: [{ commit: 'deadbeef' }] })) }, 'evidence', 'a commit that does not exist');
fails({ [P]: post(front({ evidence: [{ commit: '--all' }] })) }, 'evidence', 'an option as a commit');
fails({ [P]: post(front({ evidence: [{ spec: 'specs/999-none/spec.md' }] })) }, 'evidence', 'a spec that does not exist');
fails({ [P]: post(front({ evidence: [{ spec: 'specs/104-x/../../README.md' }] })) }, 'evidence', 'a spec path out of specs/');
fails({ [P]: post(front(), body(`See [it](https://github.com/three-feathers/agent-durbar/commit/${SIDE}).`)) }, 'evidence', 'a linked commit not on main');
fails({ [P]: post(front({ notVerified: [] })) }, 'not-verified', 'notVerified empty');
fails({ [P]: post(front({ notVerified: [' '] })) }, 'not-verified', 'notVerified blank');
fails({ [P]: post(front(), body('word '.repeat(401))) }, 'words', 'over 400 words');
fails({ [P]: post(front(), body('We merged 219 pull requests that week.')) }, 'figure', 'a figure without a link');
passes({ [P]: post(front(), body('We merged [219 pull requests](https://github.com/three-feathers/agent-durbar/pulls) that week.')) }, 'a figure with a link');
passes({ [P]: post(front(), body('On 2026-10-16 at 12:53, v0.1.0 and FR-061, spec 104 and T005 changed.')) }, 'dates, times, versions and ids are not figures');
fails({ [P]: post(front()), '2026-11-05-second.md': post() }, 'one-per-day', 'two posts on one day');

// FR-067, FR-079 and the owner's delta: who reads
const later = (i, f, b) => [`2026-11-${String(10 + i).padStart(2, '0')}-p${i}.md`, post(front({ date: `2026-11-${String(10 + i).padStart(2, '0')}`, writtenOn: `2026-11-${String(10 + i).padStart(2, '0')}`, ...f }), b)];
const six = (f6, b6) => Object.fromEntries([0, 1, 2, 3, 4].map((i) => later(i, {})).concat([later(5, f6, b6)]));
fails({ [P]: post(front({ humanRead: undefined })) }, 'human-read', 'one of the first 5 posts without a human read');
passes(six({ humanRead: undefined }), 'the 6th post naming nobody needs no human read');
fails(six({ humanRead: undefined }, body('As rubenlupi said.')), 'human-read', 'a later post naming an owner needs a human read');
fails(six({ humanRead: undefined }, body('As @standin-user said.')), 'human-read', 'a later post naming any @login needs a human read');
fails({ [P]: post(front({ humanRead: 'standin' })) }, 'human-read', 'humanRead is not an owner');
fails({ [P]: post(front({ agentReview: undefined })) }, 'agent-review', 'no agent review');
fails({ [P]: post(front({ agentReview: { by: 'Claude Code', whose: 'vikramgorla' } })) }, 'agent-review', 'an agent review from the writer\'s own side');
fails({ [P]: post(front({ agentReview: { by: '', whose: 'rubenlupi' } })) }, 'agent-review', 'an agent review naming no agent');

// FR-064: the security hold
fails({ [P]: post(front(), body('A bypass in the mask was fixed.')) }, 'security', 'security words without the field');
passes({ [P]: post(front({ security: 'none', securityNote: 'bypass is about a road here' }), body('A bypass in the mask was fixed.')) }, 'security none with a reason');
fails({ [P]: post(front({ security: 'none' }), body('A leak.')) }, 'security', 'security none without a reason');
passes({ [P]: post(front({ security: { sha: SHA, release: 'v0.1.0' } }), body('A bypass was fixed.')) }, 'a fix in a published release');
fails({ [P]: post(front({ security: { sha: SHA, release: 'v0.1.0' } }), body('A bypass was fixed.')) }, 'security', 'a fix whose release is still a draft', { drafts: ['v0.1.0'] });
fails({ [P]: post(front({ security: { sha: SIDE, release: 'v0.1.0' } }), body('A bypass was fixed.')) }, 'security', 'a fix not in the release');
fails({ [P]: post(front({ security: { sha: SHA, release: 'v0.9.0' } }), body('A bypass was fixed.')) }, 'security', 'a release that does not exist');
fails({ [P]: post(front({ security: { sha: SHA, release: 'v0.1.0' } }), body('A bypass was fixed.')) }, 'security', 'offline: the release state cannot be confirmed, so it holds', { offline: true });

// FR-054, FR-065: the clip
fails({ [P]: post(front({ clip: undefined })) }, 'clip', 'no clip');
fails({ [P]: post(front({ clip: 'gone.mp4' })) }, 'clip', 'a clip not in the manifest');
fails({ [P]: post(front({ clip: 'film-a.mp4' })) }, 'clip', 'a film is not a clip');

// FR-063: linked issues, PRs and comments by an outside author or editor; links to other repositories; offline and CI
fails({ [P]: post(front({ evidence: [{ pr: 2 }] })) }, 'outside-link', 'an outside author');
fails({ [P]: post(front(), body('As in #3.')) }, 'outside-link', 'a trusted author last edited by an outsider');
passes({ [P]: post(front(), body('As in #4.')) }, 'the Actions bot (GraphQL Bot without [bot]) is trusted');
fails({ [P]: post(front(), body('See [it](https://github.com/three-feathers/agent-durbar/pull/1#issuecomment-78).')) }, 'outside-link', 'an outside comment on a trusted PR');
passes({ [P]: post(front(), body('See [it](https://github.com/three-feathers/agent-durbar/pull/1#issuecomment-77).')) }, 'a trusted comment on a trusted PR');
fails({ [P]: post(front(), body('See [it](https://github.com/someone/else/issues/1).')) }, 'outside-link', 'an issue in another repository');
fails({ [P]: post(front(), body('See [it](https://github.com/three-feathers/agent-durbar/pull/1#discussion_r9).')) }, 'outside-link', 'a line comment (not checked) fails closed');
fails({ [P]: post(front({ evidence: [{ pr: 99 }] })) }, 'outside-link', 'an item that does not exist');
{
  const r = check({ [P]: post() }, { offline: true });
  assert.deepStrictEqual(r.problems, [], 'offline, outside CI: no failure for the unchecked links');
  assert.ok(r.notes.some((n) => /online author check did NOT run/.test(n)), 'offline is said plainly');
  fails({ [P]: post() }, 'online-check', 'under CI the online check must run', { offline: true, env: { CI: 'true' } });
  const e = check({ [P]: post() }, { env: {} });
  assert.ok(e.calls.length, 'the fake gh was used');
}

// other public texts (captions, story, explainers): the text rules, not the post rules
fails({ 'docs/site/story/ch1.md': `Story text with ${TOKEN}.\n` }, 'secret', 'a token in the story text');
fails({ 'docs/site/story/ch1.md': 'The zebra moonbase chapter.\n' }, 'unreleased', 'an unreleased phrase in the story');
passes({ 'docs/site/story/ch1.md': 'A plain chapter with no post fields.\n' }, 'story text needs no front block');
fails({ 'docs/site/story/pic.png': 'x' }, 'file-read', 'an unexpected file type');
if (process.platform !== 'win32') {
  const r = (() => { check({}); fs.mkdirSync(path.join(T, 'docs/site/blog'), { recursive: true }); fs.symlinkSync(path.join(T, 'README-none'), path.join(T, 'docs/site/blog', P)); return cp.checkAll({ root: T, gh: ghFake([]), env: {} }); })();
  assert.ok(r.problems.some((p) => p.rule === 'file-read'), 'a symbolic link is refused');
}

// the output names file, line and rule, never the matched text
{
  check({ [P]: post(front(), body(`Our key was ${TOKEN}; hosted at blocked-standin.example.invalid; mail standin@example.invalid.`)) });
  const res = spawnSync(process.execPath, ['-e', `const cp=require(${JSON.stringify(path.join(__dirname, 'check-posts.js'))});const r=cp.checkAll({root:${JSON.stringify(T)},gh:()=>{throw new Error('x')},env:{}});for(const p of r.problems)console.log(p.file+':'+p.line+': '+p.rule+': '+cp.RULES[p.rule]);`], { encoding: 'utf8' });
  assert.ok(res.stdout.includes(': secret:') && res.stdout.includes(': blocked:') && res.stdout.includes(': email:'), `the problems are named: ${res.stdout}`);
  for (const s of [TOKEN, 'blocked-standin', 'standin@example.invalid']) assert.ok(!res.stdout.includes(s) && !res.stderr.includes(s), 'the matched text is never printed');
}

// review of T005 (adversarial pass, 2026-11-04): each probe that passed before now fails, and the false positives pass
{
  const ZW = '​';
  for (const [t, rule, what] of [
    [`V${ZW}ikram said`, 'first-name', 'a zero-width space in a name'], [`Vik­ram said`, 'hidden-char', 'a soft hyphen'], ['Vi&shy;kram said', 'hidden-char', 'an unknown entity'],
    ['Vik&#8203;ram said', 'hidden-char', 'a numeric zero-width entity'], ['V&iacute;kram said', 'hidden-char', 'a named accent entity'], ['Vіkram said', 'first-name', 'a Cyrillic look-alike'],
    ['Vіkram said', 'hidden-char', 'a word mixing scripts'], ['‮markiV said', 'hidden-char', 'a direction override'], ['Vikram2 said', 'first-name', 'a name glued to a digit'],
    [`Key ghp_${'Ab1'.repeat(6)}${ZW}${'Ab1'.repeat(6)}`, 'secret', 'a token split by a zero-width space'], [`/home${ZW}/standin/x`, 'path', 'a path split by a zero-width space'],
    ['Files in ~standin/x', 'path', 'a ~user path'], [`standin${ZW}@example.invalid`, 'email', 'an address split by a zero-width space'],
    [`see standin-client${ZW}.com`, 'host', 'a host split by a zero-width space'], ['see standin-client[.]com', 'host', 'a defanged host'], ['see standin-client .com', 'host', 'a host with a space before the dot'],
    [`see t${ZW}.me/standin`, 'chat', 'a chat link split by a zero-width space'], [`The moo${ZW}n base`, 'hidden-char', 'an invisible character in a phrase'],
    ['Served on localhost:3000', 'host', 'localhost'], ['It ran on localhost only', 'host', 'a bare localhost'], ['See the quokkacorp-team repo', 'blocked', 'a blocked name as part of a hyphenated word'],
    ['We call it done: [run](https://github.com/three-feathers/agent-durbar/actions/runs/19012345678)', 'none', 'digits in a URL are no phone'], ['Served on intranet:8080/x', 'host', 'host:port'],
    ['See https://github.com/three-feathers/agent-durbar/./pull/2 now', 'outside-link', 'dot segments reach an outside PR'],
    ['See https://github.com/three-feathers/agent-durbar/pull/%32 now', 'outside-link', 'a percent-encoded number'],
    ['See https://github.com/three-feathers/agent-durbar/pull/1/files#r123 now', 'outside-link', 'a review line comment'],
    [`See https://github.com/three-feathers/agent-durbar/commit/${SHA}#commitcomment-5 now`, 'outside-link', 'a commit comment'],
    ['See www.github.com/three-feathers/agent-durbar/pull/2 now', 'scheme', 'a bare www link (rendered as http)'],
    ['See www.github.com/three-feathers/agent-durbar/pull/2 now', 'outside-link', 'a bare www link to an outside PR'],
    ['See https://github.com/outsider-x/repo/blob/main/README.md', 'outside-link', 'another account on GitHub'], ['See https://gist.github.com/standin/abc', 'host', 'a gist'],
    ['See https://raw.githubusercontent.com/standin/x/main/y', 'outside-link', 'raw files of another account'], ['See https://api.github.com/repos/x/y/issues/9', 'host', 'the API'],
    ['See https://example.invalid/blocked-standin.example.invalid/x', 'blocked', 'a blocked host in a URL path'],
    ['See https://github.com/search?q=quokkacorp', 'blocked', 'a blocked name in a query'],
    ['We met Quokka Corp there.', 'blocked', 'a blocked name as two words'], ['We met quokka-corp there.', 'blocked', 'a blocked name with a hyphen'],
    ['x'.repeat(4097), 'long-line', 'a line over the cap'],
  ]) { if (rule === 'none') passes({ [P]: post(front(), body(t)) }, what); else fails({ [P]: post(front(), body(t)) }, rule, what); }
  fails({ [P]: post(front(), body('The Zebra\nMoonbase is next.')) }, 'unreleased', 'a phrase split across two lines of a paragraph');
  // the front block's values as JSON reads them
  const esc = (s) => s.replace(/[a-z]/g, (c) => `\\u00${c.charCodeAt(0).toString(16)}`);
  const raw = (o) => post(front()).replace('"title": "Specs first"', `"title": "${o}"`);
  fails({ [P]: raw(esc('vikram reads specs')) }, 'first-name', 'a first name escaped in the front block');
  fails({ [P]: raw(`${esc('ghp')}_${'Ab1'.repeat(12)}`) }, 'secret', 'a token escaped in the front block');
  fails({ [P]: raw(`\\/home\\/standin\\/x`) }, 'path', 'a path escaped in the front block');
  fails({ [P]: raw(`standin\\u0040example.invalid`) }, 'email', 'an address escaped in the front block');
  fails({ [P]: raw(`see evil\\u002ecom`) }, 'host', 'a host escaped in the front block');
  // false positives the review found: these are ordinary posts
  for (const t of ['Claude reads settings.json and Codex reads config.toml; see vite.config.ts and index.ts in docs.html.', 'Read `process.env.DURBAR_SIM`, `fs.readFileSync` and `JSON.parse`, then window.close.',
    'See [the decision](https://github.com/three-feathers/agent-durbar/pull/1#issuecomment-77) and [the run](https://github.com/three-feathers/agent-durbar/actions/runs/19012345678).',
    'The [budget](https://github.com/three-feathers/agent-durbar/blob/main/specs/104-site-story-blog/spec.md) is 629145600 bytes.', 'Line `check-posts.js:120` explains it.',
    'Built with [Spec Kit](https://github.com/github/spec-kit) and listed on [the board](https://github.com/orgs/three-feathers/projects/1).']) passes({ [P]: post(front(), body(t)) }, `ordinary prose: ${t.slice(0, 40)}`);
  // hostile input in linear time: the biggest file, one line each, measured in CPU time (not wall time) against a generous bound
  const t0 = process.cpuUsage();
  for (const s of ['a.', '<', ' ', '1', 'a@', '>', 'x-']) cp.textProblems(s.repeat(256 * 1024 / s.length), { redact: null, blocked: new Set(), phrases: ['zebra moonbase'], files: new Set() });
  const big = Array.from({ length: 64 }, () => 'a.'.repeat(2000)).join('\n'); // many lines just under the cap
  cp.textProblems(big, { redact: null, blocked: new Set(), phrases: ['zebra moonbase'], files: new Set() });
  const cpu = process.cpuUsage(t0);
  assert.ok((cpu.user + cpu.system) / 1e6 < 20, `hostile 256 KB inputs stay fast (${((cpu.user + cpu.system) / 1e6).toFixed(1)} s CPU)`);
  // the human step also blocks the bare name of a host
  assert.ok(cp.normaliseBlocked('https://Standin-Client.co.uk/x') === 'standin-client.co.uk' && cp.normaliseBlocked('not a host!') === null, 'normalised names');
}

// review of PR #1106 (rubenlupi's side, 2026-11-04): each probe below passed at 4e84600 and fails now
{
  const B64 = Buffer.from(`token ${TOKEN} here`).toString('base64');
  const HEX = Buffer.from(`token ${TOKEN} here`).toString('hex');
  for (const [t, rule, what] of [
    // 2. percent-encoding, query and fragment included
    ['See https://example.invalid/x?q=blocked%2Dstandin%2Eexample%2Einvalid', 'blocked', 'a blocked host percent-encoded in a query'],
    ['See https://example.invalid/x#blocked-standin%2eexample%2einvalid', 'blocked', 'a blocked host percent-encoded in a fragment'],
    ['See https://example.invalid/x?to=standin%40example.invalid', 'email', 'an address percent-encoded in a query'],
    ['See https://github.com/three-feathers/agent-durbar/blob/main/%2Fhome%2Fstandin', 'path', 'a home path percent-encoded in a URL'],
    ['The folder %2Fhome%2Fstandin%2Fx', 'path', 'a bare percent-encoded home path'],
    ['We met quokka%2Dcorp there', 'blocked', 'a blocked name with a percent-encoded hyphen'],
    ['See %252Fhome%252Fstandin', 'path', 'double percent-encoding'],
    // 3. schemes without ://
    ['[x](javascript:alert(1))', 'scheme', 'a javascript: link'], ['[x](data:text/html;base64,PHA+)', 'scheme', 'a data: link'],
    ['[x](vbscript:msgbox)', 'scheme', 'a vbscript: link'], ['[x]( javascript:void(0))', 'scheme', 'a javascript: link after a space'],
    ['<javascript:alert(1)>', 'scheme', 'an autolink with a bad scheme'], ['Open file:standin', 'scheme', 'a bare file: link'],
    // 4. any drive or UNC path
    ['Work in D:\\work\\standin\\x', 'path', 'a D: drive path'], ['Work in E:/clients/standin/x', 'path', 'a drive path with slashes'],
    ['Work in \\\\?\\C:\\x', 'path', 'a long Windows path'], ['Work in /opt/standin/x', 'path', 'an /opt path'],
    // 6. mutants that survived: the hidden-char rule by name, entity decoding, /Users/
    [`Vik${'\u2060'}ram`, 'hidden-char', 'a word joiner'], ['A \u2066isolate\u2069 here', 'hidden-char', 'a bidi isolate'], ['Fine&ZeroWidthSpace;text', 'hidden-char', 'an unknown named entity alone'],
    ['Write to standin&#64;example.invalid', 'email', 'an address with an entity @'], ['The folder &#x2F;home&#x2F;standin&#x2F;x', 'path', 'a path written with entities'],
    ['The folder /Users/standin/x', 'path', 'a macOS home folder'],
    // 8. encoded secrets
    [`The blob ${B64} was pasted`, 'secret', 'a base64-encoded token'], [`The blob ${HEX} was pasted`, 'secret', 'a hex-encoded token'],
  ]) fails({ [P]: post(front(), body(t)) }, rule, what);
  fails({ [P]: post(front(), body(`The key was ${TOKEN.slice(0, 20)}\n${TOKEN.slice(20)} once.`)) }, 'secret', 'a token split across two lines of a paragraph');
  // relative links and plain prose with a colon still pass; a commit hash is not an encoded secret
  passes({ [P]: post(front(), body(`See [the plan](../plan.md), [a section](#how), the data: it shows. Commit ${SHA} is fine.`)) }, 'relative links, a colon in prose and a commit hash');
  // 6. non-UTF-8 bytes and NUL refuse the file
  for (const [bytes, what] of [[Buffer.concat([Buffer.from(post()), Buffer.from([0xff, 0xfe])]), 'non-UTF-8 bytes'], [Buffer.concat([Buffer.from(post()), Buffer.from([0])]), 'a NUL byte']]) {
    check({});
    fs.mkdirSync(path.join(T, 'docs/site/blog'), { recursive: true });
    fs.writeFileSync(path.join(T, 'docs/site/blog', P), bytes);
    const r = cp.checkAll({ root: T, gh: ghFake([]), env: {} });
    assert.ok(r.problems.some((p) => p.rule === 'file-read'), `${what} refuse the file`);
  }
  // 5. file and folder names are checked, and a failing name is never printed
  fails({ '2026-11-05-quokkacorp-visit.md': post() }, 'blocked', 'a blocked name in a post\'s file name');
  fails({ '2026-11-05-zebra-moonbase.md': post() }, 'unreleased', 'an unreleased phrase in a file name');
  fails({ '2026-11-05-ruben-says.md': post() }, 'first-name', 'a first name in a file name');
  fails({ 'docs/site/captions/quokkacorp.vtt': 'WEBVTT\n\n00:00.000 --> 00:01.000\nHi\n' }, 'blocked', 'a blocked name in a caption\'s file name');
  fails({ 'docs/site/story/quokkacorp/ch1.md': 'Plain.\n' }, 'blocked', 'a blocked name in a folder name');
  {
    const r = check({ '2026-11-05-quokkacorp-visit.md': post(front(), body(`Key ${TOKEN}.`)) });
    assert.ok(r.problems.every((p) => !/quokkacorp/i.test(p.file)) && r.problems.some((p) => /<file name withheld 1>/.test(p.file)), `the failing name is withheld: ${JSON.stringify(r.problems.map((p) => p.file))}`);
    const out = spawnSync(process.execPath, ['-e', `const cp=require(${JSON.stringify(path.join(__dirname, 'check-posts.js'))});const r=cp.checkAll({root:${JSON.stringify(T)},gh:()=>{throw new Error('x')},env:{}});for(const p of r.problems)console.log(p.file+':'+p.line+': '+p.rule);`], { encoding: 'utf8' });
    assert.ok(/withheld/.test(out.stdout) && !/quokkacorp/i.test(out.stdout + out.stderr), 'the printed output never names the blocked file');
  }
  passes({ '2026-11-05-specs-first.md': post() }, 'a plain file name passes');
}

// every rule has a fixture above (a rule with none would be a rule no test can kill)
{
  const src = fs.readFileSync(__filename, 'utf8');
  for (const id of Object.keys(cp.RULES)) assert.ok(new RegExp(`'${id}'`).test(src), `rule ${id} has a fixture`);
}

// the human step: the name comes from stdin, nothing is printed, only a hash is written; a bad name is refused
{
  const keep = fs.readFileSync(path.join(T, 'docs/site/blocked-hashes.json'), 'utf8');
  fs.mkdirSync(path.join(T, 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'check-posts.js'), path.join(T, 'scripts', 'check-posts.js'));
  for (const f of ['build-site.js', 'specs-index.js', 'release-notes.js']) fs.copyFileSync(path.join(__dirname, f), path.join(T, 'scripts', f));
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(T, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const r = spawnSync(process.execPath, [path.join(T, 'scripts', 'check-posts.js'), '--add-blocked-host'], { input: 'https://Other-Standin.invalid/path\n', encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `the add step succeeds: ${r.stderr}`);
  assert.strictEqual(r.stdout + r.stderr, '', 'the add step prints nothing');
  const after = fs.readFileSync(path.join(T, 'docs/site/blocked-hashes.json'), 'utf8');
  assert.ok(!/other-standin/i.test(after) && JSON.parse(after).sha256.includes(cp.hashName('other-standin.invalid')), 'only the hash of the normalised host is written');
  assert.ok(JSON.parse(after).sha256.includes(cp.hashName('other-standin')) && JSON.parse(after).sha256.includes(cp.hashName('otherstandin')), 'the bare name is blocked too, with and without its hyphen');
  const bad = spawnSync(process.execPath, [path.join(T, 'scripts', 'check-posts.js'), '--add-blocked-host'], { input: 'not a host!\n', encoding: 'utf8' });
  assert.ok(bad.status !== 0 && !/not a host/.test(bad.stdout + bad.stderr), 'a bad name is refused without echoing it');
  const arg = spawnSync(process.execPath, [path.join(T, 'scripts', 'check-posts.js'), '--add-blocked-host', 'x.example.invalid'], { encoding: 'utf8' });
  assert.ok(arg.status === 2 && !/x\.example\.invalid/.test(arg.stdout + arg.stderr), 'a name as an argument is refused, not echoed');
  fs.unlinkSync(path.join(T, 'node_modules'));
  w('docs/site/blocked-hashes.json', keep);
}

// trusted-authors.txt is read as scripts/trusted-lib.sh reads it (same logins)
{
  const set = cp.trustedAuthors(ROOT);
  for (const l of ['vikramgorla', 'fjcabello', 'rubenlupi', 'github-actions[bot]']) assert.ok(set.has(l), `${l} is trusted`);
  const bash = spawnSync('bash', ['-c', '. scripts/trusted-lib.sh && printf %s "$TRUST_RE"'], { cwd: ROOT, encoding: 'utf8' });
  if (bash.status === 0) assert.deepStrictEqual([...set].sort(), bash.stdout.replace(/\\\\/g, '').split('|').sort(), 'the same list as trusted-lib.sh');
}

// the real repository passes (no posts yet: the files are empty lists)
{
  const r = cp.checkAll({ root: ROOT, offline: true, env: {} });
  assert.deepStrictEqual(r.problems, [], `the repository passes blog:check: ${JSON.stringify(r.problems)}`);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/site/blocked-hashes.json'), 'utf8')).sha256.every((h) => /^[0-9a-f]{64}$/.test(h)), true, 'the real hash list holds hashes only');
}

fs.rmSync(T, { recursive: true, force: true });
console.log('test-check-posts: ok (every rule fails its fixture; the clean post and the repository pass)');
process.exitCode = 0;
