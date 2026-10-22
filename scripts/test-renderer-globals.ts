/**
 * Renderer globals (spec 052 FR-071 delta 2026-10-21, issue #474): `npm run test:globals`. No credits spent.
 *
 * The renderer scripts are plain files loaded one after another by index.html; each hands its API to the page as one window global
 * (`root.DurbarX=api` in the UMD wrapper, or `window.DurbarX=...`). Two files that assign the same name replace each other silently:
 * activitytable.js and activity.js both set `DurbarActivity`, so Tools > Activity threw. This static check fails when a global is
 * assigned in more than one file, and when the page reads a `window.Durbar*` name that no renderer file assigns.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const DIR = path.join(__dirname, '..', '..', 'src', 'renderer');

/** The window globals a script assigns: `root.X=`, `window.X=`, `self.X=`, `globalThis.X=` (not `==`). */
export function assigned(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/\b(?:root|window|self|globalThis)\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) out.add(m[1]);
  return out;
}

/** Name -> the files that assign it, for every name assigned by two or more files. */
export function clashes(files: Record<string, string>): Record<string, string[]> {
  const by: Record<string, string[]> = {};
  for (const [f, src] of Object.entries(files)) for (const g of assigned(src)) (by[g] ||= []).push(f);
  return Object.fromEntries(Object.entries(by).filter(([, list]) => list.length > 1));
}

// the checker itself catches the bug of issue #474 and ignores comparisons
assert.deepStrictEqual(clashes({ 'activitytable.js': 'root.DurbarActivity=api;', 'activity.js': 'else root.DurbarActivity=api;' }), { DurbarActivity: ['activitytable.js', 'activity.js'] });
assert.deepStrictEqual(clashes({ 'a.js': 'root.DurbarA=api;', 'b.js': 'if(window.DurbarA===x)window.DurbarB = 1;' }), {});

const files: Record<string, string> = {};
for (const f of fs.readdirSync(DIR).filter((f) => f.endsWith('.js')).sort()) files[f] = fs.readFileSync(path.join(DIR, f), 'utf8');
assert.ok(Object.keys(files).length > 10, 'the renderer scripts were found');

const dup = clashes(files);
assert.deepStrictEqual(dup, {}, 'each window global is assigned by one renderer file only: ' + JSON.stringify(dup));

const all = new Set<string>();
for (const src of Object.values(files)) for (const g of assigned(src)) all.add(g);
assert.ok(all.has('DurbarActivity') && all.has('DurbarActivityTable'), 'activity.js and activitytable.js each have their own global');
const missing: string[] = [];
for (const [f, src] of Object.entries(files)) {
  for (const m of src.matchAll(/\bwindow\.(Durbar[A-Za-z0-9_$]*)/g)) if (!all.has(m[1])) missing.push(`${f}: window.${m[1]}`);
}
assert.deepStrictEqual(missing, [], 'every window.Durbar* the page reads is assigned by a renderer file');

console.log(`renderer globals tests passed (${all.size} globals, ${Object.keys(files).length} files)`);
