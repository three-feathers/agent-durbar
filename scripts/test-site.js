/*
 * Spec 050: the project website builds and is self-contained (`npm run test:site`, also part of `npm test`). No network:
 * checks that docs/site/landing.json is validated against the README (a bad anchor, screenshot or harness fails), then
 * builds with SITE_RELEASE=off into a temp folder and checks both pages: every local link and image exists, nothing is
 * loaded from another site, CSP and disclaimer, the landing page's hero, status line, six themes and no internal spec
 * numbers, the docs page's README sections and feature grid, and that the whole site stays under a size budget.
 */
'use strict';
const assert = require('assert');
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
assert.match(index, /<h1>See all your AI agents at once<\/h1>/, 'hero title');
assert.match(index, /Free · open source · early alpha/, 'hero eyebrow');
assert.match(index, />Download alpha</, 'download button');
assert.match(index, /href="docs\.html">Read the docs</, 'docs button');
assert.match(index, /Alpha · unsigned · run by hand on Linux only/, 'status line in the hero');
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
for (const n of landing.featuresExclude) assert.ok(!docs.includes(`<small>Spec ${n}</small>`), `process spec ${n} is not a feature`);
for (const c of landing.cards) assert.ok(docs.includes(`id="${c.readmeAnchor}"`), `card anchor ${c.readmeAnchor} exists on the docs page`);

const size = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
const total = size(out);
assert.ok(total < 15 * 1024 * 1024, `site under 15 MB (is ${(total / 1048576).toFixed(1)} MB)`);
fs.rmSync(out, { recursive: true, force: true });
console.log(`site: ok (${attrCount} links and images on two pages, ${(total / 1048576).toFixed(1)} MB)`);
