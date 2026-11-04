/*
 * Spec 050: the project website builds and is self-contained (`npm run test:site`, also part of `npm test`). No network:
 * checks that docs/site/landing.json is validated against the README (a bad anchor, screenshot or harness fails), then
 * builds with SITE_RELEASE=off into a temp folder and checks both pages: every local link and image exists, nothing is
 * loaded from another site, CSP and disclaimer, the landing page's hero, status line, two themes and no internal spec
 * numbers, the docs page's README sections and feature grid, and that the whole site stays under a size budget.
 */
'use strict';
const assert = require('assert');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const site = require('./build-site.js');
const ROOT = path.join(__dirname, '..');
const readme = site.siteSource(); // the README's top plus the docs pages it moved its detail to (spec 021 FR-065); line endings are normalised there
const landing = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/site/landing.json'), 'utf8'));

// landing.json stays in step with the README: the real file passes; a bad anchor, a missing screenshot or an unknown harness fail
assert.deepStrictEqual(site.validateLanding(landing, { readme }), [], 'landing.json is valid');
const bad = JSON.parse(JSON.stringify(landing));
bad.cards[0].readmeAnchor = 'no-such-heading';
assert.ok(site.validateLanding(bad, { readme }).some((e) => /readmeAnchor "no-such-heading" is not a README heading/.test(e)), 'a bad anchor fails');
const bad2 = JSON.parse(JSON.stringify(landing));
bad2.themes[0].screenshot = 'does-not-exist.png';
assert.ok(site.validateLanding(bad2, { readme }).some((e) => /does-not-exist\.png is missing/.test(e)), 'a missing screenshot fails');
const bad3 = JSON.parse(JSON.stringify(landing));
bad3.harnesses[0].name = 'Imaginary Agent';
assert.ok(site.validateLanding(bad3, { readme }).some((e) => /not in the README's Harnesses table/.test(e)), 'an unknown harness fails');
assert.ok(site.headingAnchors(readme).has('costs-and-caps') && site.headingAnchors(readme).has('safety-model'), 'README anchors');
assert.strictEqual(site.stripRefs('**Cost per folder (spec 052 FR-044, #315).** Tools'), '**Cost per folder.** Tools', 'spec references are stripped');
for (const os of ['macOS', 'Windows', 'Linux']) assert.ok(site.installSteps(readme)[os], `README has the ${os} install step`);

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-site-'));
execFileSync(process.execPath, [path.join(__dirname, 'build-site.js')], { env: { ...process.env, SITE_OUT: out, SITE_RELEASE: 'off' }, stdio: 'pipe' });
// spec 050 FR-013: the wording follows the latest release: a stable release drops "alpha", a pre-release or no release keeps it
const outStable = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-site-stable-'));
execFileSync(process.execPath, [path.join(__dirname, 'build-site.js')], { env: { ...process.env, SITE_OUT: outStable, SITE_FAKE_RELEASE: JSON.stringify({ tag: 'v0.1.0', pre: false }) }, stdio: 'pipe' });
const stableIdx = fs.readFileSync(path.join(outStable, 'index.html'), 'utf8');
assert.match(stableIdx, />Download</, 'stable: the download button says Download');
assert.ok(!/>Download alpha</.test(stableIdx) && !/Install the alpha/.test(stableIdx) && !/early alpha\.\"/.test(stableIdx), 'stable: no alpha button, install heading or og description');
assert.match(stableIdx, /Install Agent Durbar/, 'stable: install heading');
assert.ok(!/\(pre-release\)/.test(stableIdx), 'stable: the latest release is not labelled pre-release');
fs.rmSync(outStable, { recursive: true, force: true });
const outPre = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-site-pre-'));
execFileSync(process.execPath, [path.join(__dirname, 'build-site.js')], { env: { ...process.env, SITE_OUT: outPre, SITE_FAKE_RELEASE: JSON.stringify({ tag: 'v0.1.0-alpha.19', pre: true }) }, stdio: 'pipe' });
const preIdx = fs.readFileSync(path.join(outPre, 'index.html'), 'utf8');
assert.ok(/>Download alpha</.test(preIdx) && /Install the alpha/.test(preIdx) && /\(pre-release\)/.test(preIdx), 'pre-release: alpha wording stays');
fs.rmSync(outPre, { recursive: true, force: true });
let attrCount = 0;
for (const name of ['index.html', 'docs.html']) {
  const html = fs.readFileSync(path.join(out, name), 'utf8');
  const attrs = [...html.matchAll(/\s(?:href|src)="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  attrCount += attrs.length;
  for (const u of attrs) {
    if (/^(https?:|mailto:|#)/.test(u)) continue;
    assert.ok(fs.existsSync(path.join(out, u.split('#')[0])), `${name}: missing local file: ${u}`);
  }
  // nothing is loaded from elsewhere: every src is local; no <script>, no stylesheet link, no @import or url() to http
  for (const m of html.matchAll(/\ssrc="([^"]+)"/g)) assert.ok(!/^https?:/.test(m[1]), `${name}: external resource: ${m[1]}`);
  assert.ok(!/<script\b/i.test(html), `${name}: no scripts`);
  assert.ok(!/<link[^>]+rel="stylesheet"/i.test(html), `${name}: no external stylesheets`);
  assert.ok(!/@import|url\(\s*['"]?https?:/i.test(html), `${name}: no external CSS resources`);
  // the site may link to itself (a released CHANGELOG entry names its address)
  for (const m of html.matchAll(/\shref="(https?:[^"]+)"/g)) assert.ok(/^https:\/\/(github\.com|[a-z0-9.-]+\.githubusercontent\.com|three-feathers\.github\.io\/agent-durbar)\//.test(m[1]), `${name}: link outside GitHub: ${m[1]}`);
  assert.match(html, /Content-Security-Policy" content="default-src 'none'/, `${name}: CSP`);
  assert.match(html, /not affiliated with, endorsed by or sponsored by GitHub, Microsoft, Anthropic or OpenAI/, `${name}: disclaimer`);
  assert.match(html, /<html lang="en">/);
  for (const m of html.matchAll(/<img [^>]*>/g)) assert.match(m[0], /\salt="[^"]*"/, `${name}: every image has alt text`);
  for (const m of html.matchAll(/<img [^>]*src="screenshots\/[^"]*"[^>]*>/g)) assert.match(m[0], /\swidth="\d+" height="\d+"/, `${name}: screenshots have width and height`);
  // in-page anchors resolve
  for (const m of html.matchAll(/\shref="#([^"]+)"/g)) assert.ok(html.includes(`id="${m[1]}"`), `${name}: anchor #${m[1]}`);
}

// the landing page: curated, short, honest, no internal numbers
const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
assert.match(index, /<h1>Run all your AI coding agents\. Answer only the ones that need you\.<\/h1>/, 'hero title');
// the hero eyebrow and the status line are hand-written in landing.json: the page shows what the file says (not a fixed word, so the stable fold PR only edits landing.json and the README status block)
assert.ok(index.includes(landing.hero.eyebrow), 'hero eyebrow is landing.json\'s');
assert.ok(!/alpha/i.test(landing.hero.eyebrow + landing.status), 'v0.1.0 is stable: the hand-written eyebrow and status do not say alpha');
assert.match(index, />Download alpha</, 'download button (no release found: alpha wording)');
assert.match(index, /class="btn secondary" href="https:\/\/github\.com\/three-feathers\/agent-durbar">View on GitHub</, 'GitHub button'); assert.match(index, /href="docs\.html"/, 'docs link');
assert.match(index, /property="og:image" content="https:\/\/three-feathers\.github\.io\/agent-durbar\/screenshots\//, 'og:image is absolute'); assert.match(index, /Simulator demo data/, 'the hero says the data is invented');
assert.ok(index.includes(landing.status.slice(0, 40)), 'the status line in the hero is landing.json\'s');
assert.ok(index.indexOf('id="status"') < index.indexOf('id="features"'), 'the status line comes before the features');
assert.match(index, /src="screenshots\/052-office-1440x900\.png"/, 'current hero screenshot');
for (const t of landing.themes) assert.ok(index.includes(`screenshots/${t.screenshot}`) && index.includes(`>${t.name.replace(/&/g, '&amp;')}</figcaption>`), `theme ${t.name}`);
assert.strictEqual(landing.themes.length, 2, 'two themes (spec 035 FR-017)');
for (const h of landing.harnesses) assert.ok(index.includes(`<h3>${h.name}</h3>`), `agent app ${h.name}`);
for (const id of ['features', 'how', 'themes', 'apps', 'safety', 'download']) assert.ok(index.includes(`id="${id}"`), `landing section ${id}`);
assert.ok(!/FR-\d|spec 0\d\d|spec \d{3}/i.test(index), 'no FR or spec numbers on the landing page');
assert.ok((index.match(/<section class="sec" id="new">[\s\S]*?<\/section>/) || [''])[0].split('<li>').length - 1 <= 5, "at most 5 bullets in What's new");

// the docs page: the README sections, the feature grid, the gallery, the full release notes
const docs = fs.readFileSync(path.join(out, 'docs.html'), 'utf8');
const titles = readme.split('\n').filter((l) => l.startsWith('## ') && l.trim() !== '## Contents').map((l) => l.slice(3).trim());
assert.ok(titles.length >= 10, 'README sections');
for (const t of titles) assert.ok(docs.includes(`<h2>${t.replace(/&/g, '&amp;')}</h2>`), `docs section ${t}`);
for (const id of ['what-you-can-do', 'harnesses', 'install', 'safety-model', 'costs-and-caps', 'themes', 'known-limits', 'how-we-work', 'features', 'gallery', 'whats-new']) assert.ok(docs.includes(`id="${id}"`), `docs section id ${id}`);
assert.match(docs, /<nav class="toc"/, 'table of contents');
assert.ok((docs.match(/class="grid"><li>/g) || []).length === 1 && (docs.match(/<li><a href="https:\/\/github\.com\/[^"]+\/specs\//g) || []).length >= 10, 'the feature grid comes from the specs index');
// spec 025 delta 2026-10-22: the specs index rows are not committed; the site builds them from each spec's specs-index block
const specsSec = (docs.match(/<section id="specs-index">[\s\S]*?<\/section>/) || [''])[0];
assert.ok(specsSec.includes('href="https://github.com/three-feathers/agent-durbar/blob/main/specs/001-office-view-and-densities/spec.md"'), 'the docs page shows the generated specs index, linked to the specs');
assert.ok(!/specs-index group=index|specs-index group=046/.test(specsSec), 'no marker comments on the page');
assert.ok(index.includes('href="docs.html#specs-index"'), 'the landing page links the index');
for (const n of landing.featuresExclude) assert.ok(!docs.includes(`<small>Spec ${n}</small>`), `process spec ${n} is not a feature`);
// spec 021 FR-068: a deprecated or superseded spec is no built feature, even when its note says "built"
{
  const rows = ['| [901](901-a/spec.md) | Alpha | built |', '| [902](902-b/spec.md) | Beta | deprecated: built, then removed on 2026-10-31 |', '| [903](903-c/spec.md) | Gamma | superseded: built, replaced by 901 |', '| [904](904-d/spec.md) | Delta | built: a follow-up |'].join('\n');
  assert.deepStrictEqual(require('./build-site.js').features(rows).map((f) => f.num), ['901', '904'], 'deprecated and superseded rows are not listed');
}
for (const c of landing.cards) assert.ok(docs.includes(`id="${c.readmeAnchor}"`), `card anchor ${c.readmeAnchor} exists on the docs page`);

// visitor rounds 2026-10-20 (spec 050): screenshots open full size, a FAQ for leads and skeptics, honest safety lines, phones
for (const f of [landing.hero.image, ...landing.themes.map((t) => t.screenshot)]) assert.ok(index.includes(`<a class="zoom" href="screenshots/${f}"`), `${f} opens full size`);
assert.match(index, /<figure class="shot"><a class="zoom" href="screenshots\/051-harnesses-1440x900\.png"[^>]*><span class="crop"/, 'the how-it-works shot is cropped to what matters and opens full size');
assert.ok(index.includes('id="faq"') && landing.faq.length >= 5 && landing.faq.every((f) => index.includes(esc(f.q))), 'FAQ section with every question');
for (const f of landing.faq) if (f.readmeAnchor) assert.ok(docs.includes(`id="${f.readmeAnchor}"`), `FAQ anchor ${f.readmeAnchor} exists`);
assert.ok(!/reads inside its folders only/.test(index), 'no overclaim: Durbar cannot force Claude Code and Copilot to stay in their folders');
assert.match(index, /soft by one call/, 'the spending-limit line says the call already running can go over');
assert.match(index, /href="https:\/\/github\.com\/three-feathers\/agent-durbar\/blob\/main\/SECURITY\.md">Report a security problem</, 'security report link in the safety section');
assert.match(index, /<a class="keep" href="#download">Download<\/a>/, 'Download stays in the header on phones');
assert.match(index, /class="phone-only"> Tap the picture to see it full size\./, 'phones are told the hero opens full size');
assert.match(docs, /\.docs\{grid-template-columns:minmax\(0,1fr\)/, 'the docs column cannot grow past a phone screen');
assert.match(docs, /<a class="keep" href="index\.html#download">Download<\/a>/, 'Download stays in the docs header on phones');

// spec 050 FR-012 (issue #759): every picture the site links is a palette PNG (colour type 3), made by `npm run shots:docs` or `npm run shots:compress`;
// a linked picture the quality guard refused to compress is named in KEPT_ORIGINAL with the reason
const KEPT_ORIGINAL = {};
for (const f of require('./shots-docs.js').linkedImages(ROOT)) {
  const b = fs.readFileSync(path.join(ROOT, 'docs', 'screenshots', f)).subarray(0, 26);
  assert.ok(KEPT_ORIGINAL[f] || b[25] === 3, `${f} is not a palette PNG: run \`npm run shots:compress\` (or name it in KEPT_ORIGINAL with the reason the quality guard refused it)`);
}

// spec 050 FR-014 (delta 2026-10-26): unlisted talk pages under talk/. Hand-written and self-contained: same-origin scripts only,
// a strict CSP, noindex,nofollow, linked from nowhere else on the site, and no sitemap. The talk's video, captions and poster
// are dropped in later, so only those three may be missing.
const TALK_OPTIONAL = new Set(['talk.mp4', 'talk.vtt', 'poster.png', 'future.mp4', 'future.vtt', 'future-poster.png']);
const talkPages = [];
const walkTalk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walkTalk(p); else if (e.name.endsWith('.html')) talkPages.push(p); } };
if (fs.existsSync(path.join(out, 'talk'))) walkTalk(path.join(out, 'talk'));
assert.ok(talkPages.some((p) => /talk[\\/]level-up-architect[\\/]index\.html$/.test(p)) && talkPages.some((p) => /talk[\\/]level-up-architect[\\/]host-[a-z]{8}[\\/]index\.html$/.test(p)), 'the LEVEL UP, ARCHITECT talk and its host page are built');
// owner 2026-10-26 (21:21 UTC): the architects' suggested answers are on a third unlisted page, never on or linked from the talk
assert.ok(talkPages.some((p) => /talk[\\/]level-up-architect[\\/]notes-[a-z]{8}[\\/]index\.html$/.test(p)), 'the architects\' notes page is built');
for (const p of talkPages) if (!/notes-[a-z]{8}/.test(p)) assert.ok(!/notes-[a-z]{8}/.test(fs.readFileSync(p, 'utf8')), `${path.relative(out, p)} does not link the architects' notes`);
for (const p of talkPages) {
  const name = path.relative(out, p);
  const html = fs.readFileSync(p, 'utf8');
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/, `${name}: noindex,nofollow`);
  assert.match(html, /Content-Security-Policy" content="default-src 'none';[^"]*script-src 'self'/, `${name}: strict CSP`);
  assert.ok(!/unsafe-inline|unsafe-eval/.test(html), `${name}: no unsafe-inline or unsafe-eval`);
  assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(html) && !/\sstyle="/.test(html) && !/\son[a-z]+="/i.test(html), `${name}: no inline script, style or event handler (the CSP would block them)`);
  for (const m of html.matchAll(/\s(?:src|href|poster)="([^"]+)"/g)) {
    const u = m[1].replace(/&amp;/g, '&');
    if (/^(https:|#)/.test(u)) { assert.ok(!/\ssrc=|poster=/.test(m[0]), `${name}: external resource ${u}`); continue; }
    assert.ok(!/^(http:|\/\/)/.test(u), `${name}: ${u}`);
    const f = path.join(path.dirname(p), u.split('#')[0]);
    assert.ok(fs.existsSync(f) || TALK_OPTIONAL.has(u), `${name}: missing local file: ${u}`);
  }
  for (const m of html.matchAll(/<img [^>]*>/g)) assert.match(m[0], /\salt="[^"]*"/, `${name}: every image has alt text`);
  for (const m of html.matchAll(/\shref="#([^"]+)"/g)) assert.ok(html.includes(`id="${m[1]}"`), `${name}: anchor #${m[1]}`);
  // owner 2026-10-26: the team's Telegram bot handles are shown shortened (@Vishwakarma…_bot), so they cannot be copied to spam the bots
  assert.ok(!/@[A-Za-z0-9]+_bot\b/.test(html), `${name}: a full Telegram bot handle is shown: ${(html.match(/@[A-Za-z0-9]+_bot\b/) || [''])[0]}`);
}
for (const f of fs.readdirSync(path.join(out, 'talk'), { recursive: true }).map(String).filter((f) => /\.(js|css)$/.test(f))) {
  const t = fs.readFileSync(path.join(out, 'talk', f), 'utf8');
  assert.ok(!/https?:\/\//.test(t.replace(/\/\*[\s\S]*?\*\//g, '')), `talk/${f}: loads nothing from another site`);
  assert.ok(!/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket)\b/.test(t), `talk/${f}: no network calls`);
}
// owner 2026-10-26 (21:53 UTC): the talk's sounds are made live by the Web Audio API in talk.js: no audio files, no <audio> element
for (const f of fs.readdirSync(path.join(out, 'talk'), { recursive: true }).map(String)) assert.ok(!/\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|mid|midi)$/i.test(f), `talk/${f}: no audio files`);
for (const p of talkPages) assert.ok(!/<audio\b/i.test(fs.readFileSync(p, 'utf8')), `${path.relative(out, p)}: no <audio> element`);
for (const n of ['index.html', 'docs.html']) assert.ok(!/(?:href|src)="[^"]*talk\//.test(fs.readFileSync(path.join(out, n), 'utf8')), `${n} does not link the unlisted talk pages`);
assert.ok(!fs.existsSync(path.join(out, 'sitemap.xml')), 'no sitemap');
const talkDir = path.join(out, 'talk', 'level-up-architect');
assert.match(fs.readFileSync(path.join(talkDir, 'index.html'), 'utf8'), /<video id="talkVideo"[^>]*>\s*<source src="talk\.mp4"[\s\S]*?<track kind="captions" src="talk\.vtt"/, 'the talk has a video with a captions track');
const mp4s = fs.readdirSync(talkDir).filter((f) => f.endsWith('.mp4'));
for (const f of mp4s) assert.ok(fs.statSync(path.join(talkDir, f)).size < 40 * 1024 * 1024, `${f} is under 40 MB`);

// ---- spec 104 FR-027 (T004): the site's download is a `v*` app release; an asset-only release listed first is skipped ----
{
  const list = [
    { tag_name: 'media-library', draft: false, prerelease: false, html_url: 'https://github.com/x/releases/tag/media-library', assets: [{ name: 'clip.mp4', browser_download_url: 'https://github.com/x/clip.mp4' }] },
    { tag_name: 'worlds-2026-11-01', draft: false, prerelease: false, html_url: 'https://github.com/x/releases/tag/worlds-2026-11-01', assets: [] },
    { tag_name: 'v0.2.0', draft: true, prerelease: false, html_url: 'https://github.com/x/releases/tag/v0.2.0', assets: [] },
    { tag_name: 'v0.1.9', draft: false, prerelease: false, html_url: 'https://github.com/x/releases/tag/v0.1.9', published_at: '2026-11-04T00:00:00Z', assets: [] },
  ];
  assert.strictEqual(site.pickRelease(list).tag_name, 'v0.1.9', 'pickRelease skips media-library, worlds-* and drafts');
  assert.strictEqual(site.pickRelease(list.slice(0, 3)), null, 'no app release: none (the page links the Releases page)');
  for (const t of ['vfoo', 'v1', 'v0.1', 'worlds-v0.1.0', 'media-library', ' v0.1.0', 'v0.1.0\n', 'v0.1.9-test.1', 'v0.1.0-alpha.19-test.2', 'v0.2.0-alpha.1', 'v0.2.0-rc.1']) assert.ok(!site.APP_TAG_RE.test(t), `${JSON.stringify(t)} is not a stable app tag`);
  for (const t of ['v0.1.0', 'v12.3.45']) assert.ok(site.APP_TAG_RE.test(t), `${t} is an app tag`);
  // review of PR #1106: a test build published as a pre-release from any branch, listed first, never becomes the download
  assert.strictEqual(site.pickRelease([{ tag_name: 'v0.1.10-test.1', draft: false, prerelease: true }, ...list]).tag_name, 'v0.1.9', 'a -test.M build is skipped');
  // the wiring: the build reads the list through the same filter
  const o = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-site-rel-'));
  execFileSync(process.execPath, [path.join(__dirname, 'build-site.js')], { env: { ...process.env, SITE_OUT: o, SITE_FAKE_RELEASES: JSON.stringify(list) }, stdio: 'pipe' });
  const idx = fs.readFileSync(path.join(o, 'index.html'), 'utf8');
  assert.ok(idx.includes('<b>v0.1.9</b>') && !idx.includes('media-library') && !idx.includes('worlds-2026'), 'the built download names v0.1.9, never an asset-only release');
  fs.rmSync(o, { recursive: true, force: true });
}

// ---- spec 104 FR-008 (T003): nothing unreleased in what the site publishes or in README.md ----
{
  const STAND = 'Zebra Moonbase'; // an invented stand-in, never a real name
  const phrases = [STAND];
  assert.deepStrictEqual(site.unreleasedPhrases({ phrases: ['Lonely'] }).errs.length, 1, 'a single word is refused: exact phrases only');
  assert.ok(site.unreleasedPhrases({}).errs.length && site.unreleasedPhrases({ phrases: [7] }).errs.length, 'a bad list is refused');
  assert.deepStrictEqual(site.unreleasedPhrases(JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/site/unreleased.json'), 'utf8'))).errs, [], 'the real list is valid');
  // each place: page HTML (tags, entities, case), feed, captions, transcript, README, Markdown marks, hyphens
  for (const [where, text] of [['html', `<p>Soon: the <b>zebra</b> &#77;oonbase world</p>`], ['feed', `<item><title>${STAND}</title></item>`], ['captions', `WEBVTT\n\n00:00.000 --> 00:02.000\nzebra-moonbase is coming`],
    ['transcript', `<details><summary>Transcript</summary><p>A ZEBRA MOONBASE tour</p></details>`], ['readme', `The **Zebra** Moonbase pack`], ['escaped', 'Zebra\\_Moonbase'], ['accents', 'Zébra Moonbase'], ['invisible', 'Zeb\u200bra Moon\u00adbase']]) {
    assert.deepStrictEqual(site.unreleasedHits(text, phrases), [STAND], `a stand-in phrase in ${where} is found`);
  }
  // a shipped theme's text passes, and the edge case of spec 104: a shipped word near an unreleased phrase
  assert.deepStrictEqual(site.unreleasedHits('The Retro Pixel theme: 8-bit palette, arcade motion. The Prehistoric Crew draws cave people.', JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/site/unreleased.json'), 'utf8')).phrases), [], 'shipped text passes');
  assert.deepStrictEqual(site.unreleasedHits('zebras moonbases', phrases), [], 'whole words only');
  // the sources: built pages and feed, README.md, captions in git
  const o = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-site-unrel-'));
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-site-root-'));
  fs.mkdirSync(path.join(o, 'blog'), { recursive: true });
  fs.writeFileSync(path.join(o, 'index.html'), '<p>ok</p>');
  fs.writeFileSync(path.join(o, 'blog', 'feed.xml'), `<rss><title>${STAND}</title></rss>`);
  fs.writeFileSync(path.join(r, 'README.md'), `# x\n${STAND}\n`);
  fs.mkdirSync(path.join(r, 'docs/site/captions'), { recursive: true });
  fs.writeFileSync(path.join(r, 'docs/site/captions/a.vtt'), `WEBVTT\n\n00:00.000 --> 00:01.000\n${STAND}\n`);
  const probs = site.unreleasedProblems(site.publicTexts(o, r), phrases).join('\n');
  for (const w of ['_site/blog/feed.xml', 'README.md', 'docs/site/captions/a.vtt']) assert.ok(probs.includes(w), `the gate reads ${w}: ${probs}`);
  assert.ok(!probs.includes('_site/index.html'), 'a clean page passes');
  fs.rmSync(o, { recursive: true, force: true }); fs.rmSync(r, { recursive: true, force: true });
  // the wiring: a phrase on the landing page fails the build, and nothing is left to publish
  const listFile = path.join(os.tmpdir(), `durbar-unrel-${process.pid}.json`);
  fs.writeFileSync(listFile, JSON.stringify({ phrases: ['Answer only the ones'] }));
  const o2 = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-site-unrel2-'));
  let failed = '';
  try { execFileSync(process.execPath, [path.join(__dirname, 'build-site.js')], { env: { ...process.env, SITE_OUT: o2, SITE_RELEASE: 'off', SITE_UNRELEASED: listFile }, stdio: 'pipe' }); } catch (e) { failed = String(e.stderr); }
  assert.match(failed, /_site\/index\.html: names "Answer only the ones", which is not in a release/, 'the build fails on an unreleased phrase in a page');
  assert.ok(!fs.existsSync(path.join(o2, 'index.html')), 'a refused build leaves nothing to deploy');
  fs.rmSync(o2, { recursive: true, force: true }); fs.rmSync(listFile, { force: true });
  // the specs index on the site leaves out a draft spec's note; other notes stay
  const rows = ['| [901](901-a/spec.md) | Alpha | draft: planned Zebra Moonbase work |', '| [902](902-b/spec.md) | Beta | building: phase 1 built |', '| [903](903-c/spec.md) | Gamma | draft |'].join('\n');
  assert.deepStrictEqual(site.stripDraftNotes(rows).split('\n'), ['| [901](901-a/spec.md) | Alpha | draft |', '| [902](902-b/spec.md) | Beta | building: phase 1 built |', '| [903](903-c/spec.md) | Gamma | draft |'], 'a draft note is left out');
  assert.ok(!/draft: /.test((docs.match(/<section id="specs-index">[\s\S]*?<\/section>/) || [''])[0]), 'the built docs page shows no draft note');
  // worlds.json: each world names a released v* tag; the real file is valid; landing.json may show only listed worlds
  const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const worlds = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/site/worlds.json'), 'utf8'));
  assert.deepStrictEqual(site.validateWorlds(worlds, { changelog, phrases: JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/site/unreleased.json'), 'utf8')).phrases }), [], 'worlds.json is valid');
  const w1 = { worlds: [{ name: 'Zebra Moonbase', release: 'v9.9.9', spec: 'specs/001-office-view-and-densities/spec.md' }] };
  assert.ok(site.validateWorlds(w1, { changelog, phrases }).some((e) => /v9\.9\.9 is not a release/.test(e)) && site.validateWorlds(w1, { changelog, phrases }).some((e) => /also on the unreleased list/.test(e)), 'an unreleased world fails');
  assert.ok(site.validateWorlds({ worlds: [{ name: 'X', release: 'media-library', spec: 'specs/001-office-view-and-densities/spec.md' }] }, { changelog }).some((e) => /stable v\* tag/.test(e)), 'only a v* release holds a world');
  const lw = JSON.parse(JSON.stringify(landing)); lw.worlds = [{ name: 'Zebra Moonbase' }];
  assert.ok(site.validateLanding(lw, { readme }).some((e) => /worlds\[0\] is not in docs\/site\/worlds\.json/.test(e)), 'a landing world not in worlds.json fails');
  lw.worlds = [{ name: 'Photo office' }];
  assert.deepStrictEqual(site.validateLanding(lw, { readme }), [], 'a listed world passes');
}

// ---- spec 104 FR-021..FR-025, FR-024a (T006): the media manifest, the player and media-src 'self' ----
{
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-media-'));
  fs.mkdirSync(path.join(r, 'docs/site/captions'), { recursive: true });
  fs.writeFileSync(path.join(r, 'docs/site/captions/clip-a.vtt'), 'WEBVTT\n\n1\n00:00.000 --> 00:02.000\nHello <b>office</b>\n\n00:02.000 --> 00:04.000\nSecond line\n');
  const H = 'ab'.repeat(32);
  const good = () => ({ files: [
    { name: 'clip-a.mp4', kind: 'clip', bytes: 1500000, sha256: H, duration: 30, width: 1280, height: 720, fps: 30, poster: 'clip-a.webp', captions: 'docs/site/captions/clip-a.vtt', title: 'A clip', licence: 'MIT', madeBy: 'Claude Code (vikramgorla)', approvedBy: 'fjcabello' },
    { name: 'clip-a.webp', kind: 'poster', bytes: 40000, sha256: H, width: 1280, height: 720, licence: 'MIT', madeBy: 'Claude Code (vikramgorla)', approvedBy: 'fjcabello' },
  ] });
  const v = (m) => site.validateMedia(m, { root: r });
  assert.deepStrictEqual(v(good()), [], 'a good manifest passes');
  assert.deepStrictEqual(site.validateMedia(JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/site/media.json'), 'utf8'))), [], 'the real media.json passes');
  const bad = (edit, re, what) => { const m = good(); edit(m); const e = v(m); assert.ok(e.some((x) => re.test(x)), `${what}: ${JSON.stringify(e)}`); };
  bad((m) => { delete m.files[0].captions; }, /captions is missing/, 'removing captions fails');
  bad((m) => { m.files[0].captions = 'docs/site/captions/gone.vtt'; }, /does not exist/, 'a missing captions file fails');
  bad((m) => { m.files[0].captions = 'docs/site/captions/../../../README.vtt'; }, /must be a docs\/site\/captions/, 'a captions path out of the folder fails');
  bad((m) => { delete m.files[0].poster; }, /poster is missing/, 'removing the poster fails');
  bad((m) => { m.files.pop(); }, /is not a poster in the manifest/, 'a poster not in the manifest fails');
  bad((m) => { delete m.files[0].sha256; }, /sha256 must be/, 'removing a hash fails');
  bad((m) => { m.files[1].sha256 = H.toUpperCase(); }, /sha256 must be/, 'a malformed hash fails');
  for (const k of ['licence', 'madeBy', 'approvedBy']) bad((m) => { delete m.files[0][k]; }, new RegExp(`${k} is missing`), `no ${k} fails (FR-024a)`);
  bad((m) => { m.files[0].bytes = 2 * 1024 * 1024 + 1; }, /over the clip budget/, 'a clip over 2 MB fails');
  bad((m) => { m.files[0].duration = 41; }, /over the clip limit of 40 s/, 'a clip over 40 s fails');
  bad((m) => { m.files[1].bytes = 60 * 1024 + 1; }, /over the poster budget/, 'a poster over 60 KB fails');
  bad((m) => { m.files[0].width = 1920; m.files[0].height = 1080; }, /over 1280x720/, 'over 720p fails');
  bad((m) => { m.files[0].fps = 60; }, /fps must be/, 'over 30 fps fails');
  bad((m) => { m.files[0].kind = 'film'; m.files[0].duration = 241; }, /film limit of 240 s/, 'a film over 4 minutes fails');
  bad((m) => { m.files[0].kind = 'explainer'; m.files[0].bytes = 6 * 1024 * 1024 + 1; }, /explainer budget/, 'an explainer over 6 MB fails');
  bad((m) => { m.files[0].autoplay = true; }, /unknown key "autoplay"/, 'an unknown key fails');
  bad((m) => { m.files.push({ ...m.files[1] }); }, /listed twice/, 'a name twice fails');
  bad((m) => { m.files[0].name = '../x.mp4'; }, /plain lower-case file name/, 'a path as a name fails');
  bad((m) => { for (let i = 0; i < 301; i++) m.files.push({ ...m.files[0], name: `c${i}.mp4`, bytes: 2 * 1024 * 1024 }); }, /over 629145600/, 'over 600 MB on the site fails');
  { const m = good(); m.files[0] = { ...m.files[0], kind: 'short', width: 720, height: 1280, duration: 59 }; delete m.files[0].poster; delete m.files[0].captions; m.files[0].bytes = 15000000; assert.deepStrictEqual(v(m), [], 'a short (release asset only) needs no poster or captions track'); }
  // the player: plain, captions, transcript in the page; a build without the files keeps the place and says so
  const e = good().files[0];
  const on = site.videoTag(e, { root: r, fetched: true });
  assert.deepStrictEqual(site.playerProblems(on), [], 'the player passes its own check');
  assert.match(on, /<video controls preload="none" playsinline width="1280" height="720" poster="media\/clip-a\.webp"/, 'player attributes');
  assert.match(on, /<track kind="captions" default src="captions\/clip-a\.vtt"/, 'captions track');
  assert.match(on, /<summary>Transcript<\/summary><p>Hello office Second line<\/p>/, 'the transcript is the captions text');
  const off = site.videoTag(e, { root: r });
  assert.ok(!/<video/.test(off) && /aspect-ratio:1280\/720/.test(off) && /Video not fetched in this build/.test(off) && /Transcript/.test(off), 'without the files: place reserved, marked not fetched, transcript kept');
  for (const [mut, re] of [[on.replace('<video ', '<video autoplay '), /autoplay or loop/], [on.replace('<video ', '<video loop '), /autoplay or loop/], [on.replace(/<track[^>]*>/, ''), /captions track/], [on.replace(' preload="none"', ''), /preload/], [on.replace(/ poster="[^"]*"/, ''), /poster/], [on.replace(' controls', ''), /controls/], ['<audio src="x.mp3"></audio>', /audio/]]) {
    assert.ok(site.playerProblems(mut).some((x) => re.test(x)), `the player check refuses ${re}`);
  }
  // review of PR #1106 (CodeQL): tags come out by a linear scan, never a regex sanitiser; the transcript is escaped on output
  assert.strictEqual(site.withoutTags('a<b>c</b>d<scr<script>ipt>e'), 'acdipt>e', 'every <...> run is taken out');
  assert.strictEqual(site.withoutTags('x <unclosed y'), 'x <unclosed y', 'a < with no > on its line is text: nothing after it is hidden (round 3)');
  assert.strictEqual(site.withoutTags('1 < 2 and <b>3</b> > 0'), '1 < 2 and 3 > 0', 'a stray < is kept, real tags go');
  assert.strictEqual(site.withoutTags('a <b\nc> d'), 'a <b\nc> d', 'a tag does not run across a line end');
  assert.strictEqual(site.withoutTags('a<b>c', ' '), 'a c', 'tags as spaces');
  assert.strictEqual(site.vttText('WEBVTT\n\n00:00.000 --> 00:01.000\n<v Standin>Hi <b>there</b>\n'), 'Hi there', 'cue text without tags or timing');
  assert.ok(!site.videoTag({ ...e, captions: 'docs/site/captions/clip-a.vtt' }, { root: r }).includes('<b>'), 'cue markup never reaches the page');
  { const t0 = process.cpuUsage(); site.withoutTags('<'.repeat(300000) + 'x'.repeat(300000)); site.vttText('WEBVTT\n\n' + '00:00.000 --> 00:01.000\n<<<<\n\n'.repeat(20000)); const c = process.cpuUsage(t0); assert.ok((c.user + c.system) / 1e6 < 5, 'linear on hostile input'); }
  // escaping: a hostile title stays text
  assert.ok(!site.videoTag({ ...e, title: '<img src=x onerror=alert(1)>' }, { root: r, fetched: true }).includes('<img src=x'), 'the title is escaped');
  fs.rmSync(r, { recursive: true, force: true });
  for (const n of ['index.html', 'docs.html']) assert.match(fs.readFileSync(path.join(out, n), 'utf8'), /Content-Security-Policy" content="default-src 'none'; img-src 'self'; media-src 'self'; style-src/, `${n}: CSP gains media-src 'self' only`);
}

// spec 104 FR-060: blog:check runs in npm test through test:site, over the repository's public texts (its own fixtures: test:blogcheck)
{
  // online and with this process's env: under CI a link it cannot check fails (FR-063), it is never only a note
  const r = require('./check-posts.js').checkAll({ root: ROOT, env: process.env });
  assert.deepStrictEqual(r.problems.map((p) => `${p.file}:${p.line}: ${p.rule}`), [], 'blog:check passes on the repository');
}

const size = (dir, skip) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? (skip && path.join(dir, e.name) === skip ? 0 : size(path.join(dir, e.name), skip)) : fs.statSync(path.join(dir, e.name)).size), 0);
// the talk folder (with its video) has its own budget; the 8 MB of FR-012 is for the site without it
const talkSize = fs.existsSync(path.join(out, 'talk')) ? size(path.join(out, 'talk')) : 0;
assert.ok(talkSize < 85 * 1024 * 1024, `talk pages under 85 MB with the videos (are ${(talkSize / 1048576).toFixed(1)} MB)`);
assert.ok(talkSize - mp4s.reduce((n, f) => n + fs.statSync(path.join(talkDir, f)).size, 0) < 2.5 * 1024 * 1024, 'talk pages under 2.5 MB without the videos');
const total = size(out, path.join(out, 'talk'));
// 8 MB since spec 050 FR-012 (2026-10-26): the linked screenshots are palette-compressed (the site was 15.5 MB with plain PNGs; FR-005 had 15 MB, FR-011 16 MB)
assert.ok(total < 8 * 1024 * 1024, `site under 8 MB (is ${(total / 1048576).toFixed(1)} MB)`);
fs.rmSync(out, { recursive: true, force: true });
console.log(`site: ok (${attrCount} links and images on two pages, ${(total / 1048576).toFixed(1)} MB; ${talkPages.length} unlisted talk pages, ${(talkSize / 1048576).toFixed(1)} MB)`);
