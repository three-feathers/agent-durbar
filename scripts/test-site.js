/*
 * Spec 050: the project website builds and is self-contained (`npm run test:site`, also part of `npm test`). No network:
 * builds with SITE_RELEASE=off into a temp folder, then checks that every local link and image exists, that nothing is
 * loaded from another site (images, scripts, styles, fonts), that the page has its CSP and disclaimer, that the README
 * sections the site uses exist, and that the whole site stays under a size budget.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-site-'));
execFileSync(process.execPath, [path.join(__dirname, 'build-site.js')], { env: { ...process.env, SITE_OUT: out, SITE_RELEASE: 'off' }, stdio: 'pipe' });
const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');

const attrs = [...html.matchAll(/\s(?:href|src)="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
for (const u of attrs) {
  if (/^(https?:|mailto:|#)/.test(u)) continue;
  assert.ok(fs.existsSync(path.join(out, u.split('#')[0])), `missing local file: ${u}`);
}
// nothing is loaded from elsewhere: every src is local; no <script>, no stylesheet link, no @import or url() to http
for (const m of html.matchAll(/\ssrc="([^"]+)"/g)) assert.ok(!/^https?:/.test(m[1]), `external resource: ${m[1]}`);
assert.ok(!/<script\b/i.test(html), 'no scripts');
assert.ok(!/<link[^>]+rel="stylesheet"/i.test(html), 'no external stylesheets');
assert.ok(!/@import|url\(\s*['"]?https?:/i.test(html), 'no external CSS resources');
for (const m of html.matchAll(/\shref="(https?:[^"]+)"/g)) assert.ok(/^https:\/\/(github\.com|[a-z0-9.-]+\.githubusercontent\.com)\//.test(m[1]), `link outside GitHub: ${m[1]}`);
assert.match(html, /Content-Security-Policy" content="default-src 'none'/, 'CSP');
assert.match(html, /not affiliated with, endorsed by or sponsored by GitHub, Microsoft, Anthropic or OpenAI/, 'disclaimer');
assert.match(html, /<html lang="en">/);
for (const id of ['features', 'built', 'gallery', 'harnesses', 'install', 'safety', 'themes', 'limits', 'how']) assert.ok(html.includes(`id="${id}"`), `section ${id}`);
assert.ok((html.match(/class="grid"><li>/g) || []).length === 1 && (html.match(/<li><a href="https:\/\/github\.com\/[^"]+\/specs\//g) || []).length >= 10, 'the feature grid comes from the specs index');
for (const m of html.matchAll(/<img [^>]*>/g)) assert.match(m[0], /\salt="[^"]*"/, 'every image has alt text');
const size = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
const total = size(out);
assert.ok(total < 15 * 1024 * 1024, `site under 15 MB (is ${(total / 1048576).toFixed(1)} MB)`);
fs.rmSync(out, { recursive: true, force: true });
console.log(`site: ok (${attrs.length} links and images, ${(total / 1048576).toFixed(1)} MB)`);
