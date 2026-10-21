/** Packaged builds drop the remote-debugging switches, dev runs keep them: `npm run test:debuggerguard` (spec 008 FR-038). */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { debugSwitchesToRemove } from '../src/main/debugguard';

// not packaged: nothing is touched
assert.deepStrictEqual(debugSwitchesToRemove(false), []);
// packaged: both DevTools switches, always (argv is never consulted, so `-switch`, `--SWITCH` and `/switch` cannot slip through)
assert.deepStrictEqual(debugSwitchesToRemove(true), ['remote-debugging-port', 'remote-debugging-pipe']);

// wiring: main.ts removes each of those switches, from debugSwitchesToRemove(app.isPackaged), before the app is ready
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const main = strip(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'), 'utf8'));
const call = /for\s*\(\s*const\s+(\w+)\s+of\s+debugSwitchesToRemove\(\s*app\.isPackaged\s*\)\s*\)\s*(?:\{\s*)?app\.commandLine\.removeSwitch\(\s*\1\s*\)/.exec(main);
assert.ok(call, 'main.ts must call app.commandLine.removeSwitch for every name from debugSwitchesToRemove(app.isPackaged)');
const ready = main.indexOf('app.whenReady(');
assert.ok(ready > 0 && call.index < ready, 'the removeSwitch loop must run before app.whenReady()');

console.log('debuggerguard: ok');
