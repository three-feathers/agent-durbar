/**
 * Spec 045 FR-060 (issue #411): the IPC handlers live in `src/main/ipc/<area>.ts`, registered from `main.ts`. A pure move must not lose a
 * channel, register one twice, or drop an owner-only `fromApp(e)` check. `npm run test:ipcchannels`. No Electron, no network, no credits.
 *
 *  1. every channel the preload calls (`ipcRenderer.invoke` / `send`) is registered exactly once with `ipcHandle` / `ipcOn` somewhere in src/main;
 *  2. no channel is registered twice, and nothing in src/main/ipc/ uses `ipcMain` (the sender check in ipcguard.ts would be skipped);
 *  3. the channels whose handler calls `fromApp(e)` are exactly the static list below (taken from main.ts before the move).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []));
/** Block and line comments out (a line comment starts at the beginning of a line or after a space, so `https://` in a string stays). */
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (f: string): string => stripComments(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'));

// 1. what the renderer can call
const preload = read(path.join(ROOT, 'src', 'preload', 'preload.ts'));
const called = new Set([...preload.matchAll(/ipcRenderer\.(?:invoke|send)\(\s*'([^']+)'/g)].map((m) => m[1]));
assert.ok(called.size > 100, `the preload calls many channels (found ${called.size})`);

// what main registers: channel -> [{ file, block }]; a block runs from the registration to the next one (or the end of the file)
interface Reg { file: string; block: string }
const regs = new Map<string, Reg[]>();
const mainDir = path.join(ROOT, 'src', 'main');
for (const f of walk(mainDir)) {
  const src = read(f);
  const starts = [...src.matchAll(/\bipc(?:Handle|On)\(\s*'([^']+)'/g)];
  starts.forEach((m, i) => {
    const block = src.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : src.length);
    const list = regs.get(m[1]) ?? [];
    list.push({ file: path.relative(ROOT, f).replace(/\\/g, '/'), block });
    regs.set(m[1], list);
  });
}
const where = (c: string): string => (regs.get(c) ?? []).map((r) => r.file).join(', ') || 'nowhere';
for (const c of [...called].sort()) assert.strictEqual(regs.get(c)?.length ?? 0, 1, `the preload calls "${c}": it must be registered exactly once (found ${regs.get(c)?.length ?? 0}: ${where(c)})`);

// 2. no channel twice (the preload or not), and the new folder goes through ipcHandle / ipcOn only
for (const [c, list] of regs) assert.strictEqual(list.length, 1, `"${c}" is registered ${list.length} times: ${where(c)}`);
const ipcDir = path.join(mainDir, 'ipc');
const ipcFiles = walk(ipcDir);
assert.ok(ipcFiles.length >= 10, `the handlers are in src/main/ipc (${ipcFiles.length} files)`);
for (const f of ipcFiles) assert.ok(!/\bipcMain\b/.test(read(f)), `${path.relative(ROOT, f)} must not use ipcMain: register through ipcHandle / ipcOn (ipcguard.ts)`);
assert.ok(!/\bipc(?:Handle|On)\(/.test(read(path.join(mainDir, 'main.ts'))), 'main.ts only calls the register functions of src/main/ipc, it registers no channel itself');
// a module that main.ts never calls registers nothing at run time: every module is imported with its `register` and called
const mainSrc = read(path.join(mainDir, 'main.ts'));
for (const f of ipcFiles) {
  const name = path.basename(f, '.ts');
  if (name === 'types') continue; // types only
  const alias = new RegExp(`import \\{ register as (\\w+) \\} from '\\./ipc/${name}'`).exec(mainSrc)?.[1];
  assert.ok(alias, `main.ts imports register from ./ipc/${name}`);
  assert.ok(new RegExp(`\\b${alias}\\(`).test(mainSrc), `main.ts calls ${alias}(...) for ./ipc/${name}`);
  assert.ok(/export function register\(/.test(read(f)), `ipc/${name}.ts exports register(deps)`);
}
assert.ok(/\bregisterMcpIpc\(/.test(mainSrc), 'main.ts calls registerMcpIpc');
for (const [c, list] of regs) for (const r of list) assert.ok(r.file.startsWith('src/main/ipc/') || r.file === 'src/main/mcpipc.ts', `"${c}" is registered in ${r.file}, outside src/main/ipc and mcpipc.ts`);

// 3. the owner-only checks. Taken from main.ts before the move (spec 045 FR-005 of 065, FR-004b of 051, FR-011 of 054, 052 FR-071 and FR-089, 063).
const FROM_APP = [
  'activity:clear', 'activity:export', 'activity:list',
  'agents:checkpointPreview', 'agents:checkpointUndo', 'agents:gitStatus', 'agents:openRemote', 'agents:setMode', 'agents:setRemote',
  'app:dismissSinceAway', 'app:sinceAway',
  'harness:cancel', 'harness:copilotAuth', 'harness:openPage', 'harness:openSignIn', 'harness:paste', 'harness:plans', 'harness:run',
  'schedules:remove', 'schedules:runNow', 'schedules:save',
];
assert.strictEqual(new Set(FROM_APP).size, FROM_APP.length, 'no channel twice in the list');
for (const c of FROM_APP) {
  const r = regs.get(c);
  assert.ok(r && r.length === 1, `"${c}" is registered`);
  assert.ok(/\bfromApp\(e\)/.test(r[0].block), `"${c}" (${r[0].file}) must still call fromApp(e)`);
}
const withCheck = [...regs].filter(([, list]) => /\bfromApp\(e\)/.test(list[0].block)).map(([c]) => c).sort();
assert.deepStrictEqual(withCheck, [...FROM_APP].sort(), 'the channels that call fromApp(e) are exactly the list (a new owner-only check goes in the list too)');

console.log(`ipc channels: ${called.size} preload channels each registered once, ${regs.size} registrations in ${ipcFiles.length} modules + mcpipc, ${FROM_APP.length} fromApp checks kept`);
