/** Spec 008 FR-179 (issue #1162): the simulator's About version is package.json's version + " (simulator)", not a literal in sim.ts. No Electron. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

const ROOT = path.join(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string };
// read-only: the same pure function copy-assets.js writes the file with (no dist/ writes, safe beside parallel suites)
const generated: string = require(path.join(ROOT, 'scripts', 'appversion.js')).appVersionScript(pkg.version);
const sandbox: { self?: unknown; DurbarAppVersion?: string } = {};
sandbox.self = sandbox; // as in a page, self is the global object
vm.runInNewContext(generated, sandbox);
assert.strictEqual(sandbox.DurbarAppVersion, pkg.version, 'the appversion.js text carries package.json\'s version');

// the expression sim.ts uses for About.version, evaluated with the generated global
const src = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'sim.ts'), 'utf8');
const m = /about: \{ name: 'Agent Durbar', version: (`[^`]*`)/.exec(src);
assert.ok(m, 'sim.ts has an About block whose version is a template string (no hard-coded literal)');
const shown = vm.runInNewContext(m[1].replace(/ as unknown as \{[^}]*\}/, ''), sandbox) as string;
assert.strictEqual(shown, `${pkg.version} (simulator)`, `the simulator's About version must equal package.json's version + " (simulator)" (got ${shown})`);
assert.ok(!/\d+\.\d+\.\d+[^'"`]*\(simulator\)/.test(src), 'sim.ts holds no literal "x.y.z (simulator)" version');
assert.ok(/<script src="appversion\.js"><\/script>[\s\S]*<script src="sim\.js">/.test(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8')), 'index.html loads appversion.js before sim.js');
console.log('sim version ok:', shown);
