/** About / credits tests (spec 008 FR-018): `npm run test:about`. No Electron, no credits. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { COPYRIGHT, CONTRIBUTORS, OWNER, aboutPanelOptions, aboutView } from '../src/shared/about';

const root = path.resolve(__dirname, '..', '..');
const read = (f: string): string => fs.readFileSync(path.join(root, f), 'utf8');
const HANDLES = ['vikramgorla', 'fjcabello', 'rubenlupi'];

assert.strictEqual(OWNER, 'Three Feathers');
assert.deepStrictEqual(CONTRIBUTORS.map((c) => c.github), HANDLES);
assert.deepStrictEqual(CONTRIBUTORS.map((c) => c.name), HANDLES, 'names are the GitHub handles');
assert.strictEqual(COPYRIGHT, 'Copyright (c) 2026 Three Feathers contributors');

// The About panel options carry the owner and all three contributors.
const opts = aboutPanelOptions('1.2.3');
const panel = JSON.stringify(opts);
assert.ok(panel.includes('Three Feathers'), 'owner in About options');
for (const h of HANDLES) assert.ok(panel.includes(h), `${h} in About options`);
assert.strictEqual(opts.applicationVersion, '1.2.3');
assert.strictEqual(opts.copyright, COPYRIGHT);
assert.ok(opts.credits.includes('Three Feathers'));
for (const h of HANDLES) assert.ok(opts.credits.includes(h) && opts.authors.some((a) => a.includes(h)), `${h} in credits and authors`);

// Settings > About view.
const v = aboutView('9.9.9');
assert.strictEqual(v.owner, 'Three Feathers');
assert.deepStrictEqual(v.contributors.map((c) => c.url), HANDLES.map((h) => `https://github.com/${h}`));

// package.json, electron-builder, LICENSE and README agree with the constants.
const pkg = JSON.parse(read('package.json'));
assert.strictEqual(pkg.author.name, OWNER);
assert.deepStrictEqual(pkg.contributors.map((c: { url: string }) => c.url.replace('https://github.com/', '')), HANDLES);
assert.deepStrictEqual(pkg.contributors.map((c: { name: string }) => c.name), CONTRIBUTORS.map((c) => c.name));
assert.strictEqual(pkg.build.copyright, COPYRIGHT, 'installer metadata (mac NSHumanReadableCopyright, Windows legal copyright)');
assert.strictEqual(pkg.build.appId, 'io.github.three-feathers.agentdurbar', 'appId (reverse DNS, hyphen is valid for mac bundle ids and Windows AppUserModelIDs; changed from io.github.vikramgorla.agentdurbar)');
assert.ok(read('LICENSE').split('\n').includes(COPYRIGHT), 'LICENSE copyright line');
assert.ok(read('LICENSE').startsWith('MIT License'), 'LICENSE stays MIT');
const readme = read('README.md');
assert.ok(readme.includes('Three Feathers'));
for (const h of HANDLES) assert.ok(readme.includes(h), `${h} credited in README`);

console.log('about: all checks passed');
