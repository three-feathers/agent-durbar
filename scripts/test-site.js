/*
 * Spec 050: the project website builds and is self-contained (`npm run test:site`, also part of `npm test`). No network:
 * checks that docs/site/landing.json is validated against the README (a bad anchor, screenshot or harness fails), then
 * builds with SITE_RELEASE=off into a temp folder and checks both pages: every local link and image exists, nothing is
 * loaded from another site, CSP and disclaimer, the landing page's hero, status line, six themes and no internal spec
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
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').replace(/\r\n?/g, '\n'); // a Windows checkout has CRLF
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
assert.strictEqual(landing.themes.length, 6, 'six themes');
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
for (const c of landing.cards) assert.ok(docs.includes(`id="${c.readmeAnchor}"`), `card anchor ${c.readmeAnchor} exists on the docs page`);

// visitor rounds 2026-10-20 (spec 050): screenshots open full size, a FAQ for leads and skeptics, honest safety lines, phones
for (const f of [landing.hero.image, ...landing.themes.map((t) => t.screenshot), landing.aiTheme.screenshot]) assert.ok(index.includes(`<a class="zoom" href="screenshots/${f}"`), `${f} opens full size`);
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
// a linked picture the quality guard refused to compress is named in KEPT_ORIGINAL with the reason (none today)
const KEPT_ORIGINAL = {};
for (const f of require('./shots-docs.js').linkedImages(ROOT)) {
  const b = fs.readFileSync(path.join(ROOT, 'docs', 'screenshots', f)).subarray(0, 26);
  assert.ok(KEPT_ORIGINAL[f] || b[25] === 3, `${f} is not a palette PNG: run \`npm run shots:compress\` (or name it in KEPT_ORIGINAL with the reason the quality guard refused it)`);
}

// spec 050 FR-014 (delta 2026-10-26): unlisted talk pages under talk/. Hand-written and self-contained: same-origin scripts only,
// a strict CSP, noindex,nofollow, linked from nowhere else on the site, and no sitemap. The talk's video, captions and poster
// are dropped in later, so only those three may be missing.
const TALK_OPTIONAL = new Set(['talk.mp4', 'talk.vtt', 'poster.png']);
const talkPages = [];
const walkTalk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walkTalk(p); else if (e.name.endsWith('.html')) talkPages.push(p); } };
if (fs.existsSync(path.join(out, 'talk'))) walkTalk(path.join(out, 'talk'));
assert.ok(talkPages.some((p) => /talk[\\/]ea-summit-2026[\\/]index\.html$/.test(p)) && talkPages.some((p) => /talk[\\/]ea-summit-2026[\\/]host-[a-z]{8}[\\/]index\.html$/.test(p)), 'the EA Summit talk and its host page are built');
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
}
for (const f of fs.readdirSync(path.join(out, 'talk'), { recursive: true }).map(String).filter((f) => /\.(js|css)$/.test(f))) {
  const t = fs.readFileSync(path.join(out, 'talk', f), 'utf8');
  assert.ok(!/https?:\/\//.test(t.replace(/\/\*[\s\S]*?\*\//g, '')), `talk/${f}: loads nothing from another site`);
  assert.ok(!/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket)\b/.test(t), `talk/${f}: no network calls`);
}
for (const n of ['index.html', 'docs.html']) assert.ok(!/(?:href|src)="[^"]*talk\//.test(fs.readFileSync(path.join(out, n), 'utf8')), `${n} does not link the unlisted talk pages`);
assert.ok(!fs.existsSync(path.join(out, 'sitemap.xml')), 'no sitemap');
const talkDir = path.join(out, 'talk', 'ea-summit-2026');
assert.match(fs.readFileSync(path.join(talkDir, 'index.html'), 'utf8'), /<video id="talkVideo"[^>]*>\s*<source src="talk\.mp4"[\s\S]*?<track kind="captions" src="talk\.vtt"/, 'the talk has a video with a captions track');
if (fs.existsSync(path.join(talkDir, 'talk.mp4'))) assert.ok(fs.statSync(path.join(talkDir, 'talk.mp4')).size < 40 * 1024 * 1024, 'talk.mp4 is under 40 MB');

const size = (dir, skip) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? (skip && path.join(dir, e.name) === skip ? 0 : size(path.join(dir, e.name), skip)) : fs.statSync(path.join(dir, e.name)).size), 0);
// the talk folder (with its video) has its own budget; the 8 MB of FR-012 is for the site without it
const talkSize = fs.existsSync(path.join(out, 'talk')) ? size(path.join(out, 'talk')) : 0;
assert.ok(talkSize < 45 * 1024 * 1024, `talk pages under 45 MB with the video (are ${(talkSize / 1048576).toFixed(1)} MB)`);
assert.ok(talkSize - (fs.existsSync(path.join(talkDir, 'talk.mp4')) ? fs.statSync(path.join(talkDir, 'talk.mp4')).size : 0) < 2 * 1024 * 1024, 'talk pages under 2 MB without the video');
const total = size(out, path.join(out, 'talk'));
// 8 MB since spec 050 FR-012 (2026-10-26): the linked screenshots are palette-compressed (the site was 15.5 MB with plain PNGs; FR-005 had 15 MB, FR-011 16 MB)
assert.ok(total < 8 * 1024 * 1024, `site under 8 MB (is ${(total / 1048576).toFixed(1)} MB)`);
fs.rmSync(out, { recursive: true, force: true });
console.log(`site: ok (${attrCount} links and images on two pages, ${(total / 1048576).toFixed(1)} MB; ${talkPages.length} unlisted talk pages, ${(talkSize / 1048576).toFixed(1)} MB)`);
