/**
 * Spec 045 FR-060 (issue #411): the IPC handlers live in `src/main/ipc/<area>.ts`, registered from `main.ts`. A pure move must not lose a
 * channel, register one twice, or drop an owner-only `fromApp(e)` check. `npm run test:ipcchannels`. No Electron, no network, no credits.
 *
 *  1. every channel the preload calls (`ipcRenderer.invoke` / `send`) is registered exactly once with `ipcHandle` / `ipcOn` somewhere in src/main;
 *  2. no channel is registered twice, and no file in src/ but ipcguard.ts uses `ipcMain` or `webContents.ipc` (the sender check and the
 *     simulator's default deny in ipcguard.ts would be skipped; spec 010 FR-029);
 *  3. the channels whose handler calls `fromApp(e)` are exactly the static list below (taken from main.ts before the move).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { preloadChannels, stripComments } from './ipc-channel-list';

const ROOT = path.join(__dirname, '..', '..');
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []));
const read = (f: string): string => stripComments(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'));

// 1. what the renderer can call
const called = preloadChannels().all;
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
const modules = ipcFiles.filter((f) => path.basename(f) !== 'types.ts');
assert.ok(modules.length >= 10, `the handlers are in src/main/ipc (${modules.length} modules)`);
// spec 010 FR-029 (review on #514): anywhere in src/, not only src/main/ipc. A raw ipcMain.on / handleOnce, or webContents.ipc.handle (which
// Electron checks before ipcMain), would reach the real handler under DURBAR_SIM and skip the sender check. Strings count too (require('electron').ipcMain).
const BYPASS: [RegExp, string][] = [
  [/\bipcMain\b/, 'ipcMain'],
  [/\.\s*ipc\b(?!\w)/, 'a webContents .ipc property'],
  [/\[\s*['"`]ipc['"`]\s*\]/, "a ['ipc'] property"],
  [/\{[^{}]*\bipc\b\s*(?:[,}:])[^{}]*\}?\s*=/, 'a destructured ipc'],
];
const srcFiles = walk(path.join(ROOT, 'src'));
assert.ok(srcFiles.length > 100, `src/ has many .ts files (${srcFiles.length})`);
for (const f of srcFiles) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  if (rel === 'src/main/ipcguard.ts') continue;
  const src = read(f);
  for (const [re, what] of BYPASS) assert.ok(!re.test(src), `${rel} uses ${what}: register through ipcHandle / ipcOn (ipcguard.ts), the only file that may touch ipcMain or webContents.ipc`);
}
// the scan is not vacuous: each pattern catches the bypass it is for (mutations M8, M9 of the review on #514)
for (const [sample, n] of [["win.webContents.ipc.handle('theme:generate', h)", 1], ["ipcMain.on('agents:setPaused', h)", 0], ["ipcMain.handleOnce('x', h)", 0], ["wc['ipc'].on('x', h)", 2], ["const { ipc } = win.webContents;", 3], ["const { ipc: x, id } = w;", 3]] as const) {
  assert.ok(BYPASS[n][0].test(sample), `the bypass scan catches: ${sample}`);
}
assert.ok(BYPASS.every(([re]) => !re.test("ipcHandle('a', (e) => ipcRenderer.invoke('b'))") && !re.test('const { ipcHandle, ipcOn } = g;')), 'the scan leaves ipcHandle, ipcOn and ipcRenderer alone');
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

// the guard itself comes from ipcguard.ts: a module with its own always-true fromApp or no-op ipcHandle would pass every check below.
// An AST walk, not a regex: the only binding of these names in a module (any kind: variable incl. destructuring and extra declarators,
// function, class, parameter incl. defaults, import alias, catch clause) must be the named import from '../ipcguard'.
const GUARD = new Set(['fromApp', 'fromAppFrame', 'ipcHandle', 'ipcOn']);
for (const f of ipcFiles) {
  const src = read(f);
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const imp = /import \{([^}]*)\} from '\.\.\/ipcguard';/.exec(src)?.[1] ?? '';
  if (/\bfromApp\(/.test(src)) assert.ok(/\bfromAppFrame as fromApp\b/.test(imp), `${rel}: fromApp comes from ipcguard.ts (fromAppFrame as fromApp)`);
  for (const n of ['ipcHandle', 'ipcOn']) if (new RegExp(`\\b${n}\\(`).test(src)) assert.ok(new RegExp(`(^|[\\s,])${n}([\\s,]|$)`).test(imp), `${rel}: ${n} comes from ipcguard.ts`);
  const sf = ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true);
  const names = (n: ts.BindingName): ts.Identifier[] => (ts.isIdentifier(n) ? [n] : n.elements.flatMap((el) => (ts.isOmittedExpression(el) ? [] : names(el.name))));
  const visit = (n: ts.Node): void => {
    let bound: ts.Identifier[] = [];
    if (ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n)) bound = names(n.name);
    else if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isClassDeclaration(n) || ts.isClassExpression(n) || ts.isEnumDeclaration(n) || ts.isModuleDeclaration(n)) && n.name && ts.isIdentifier(n.name)) bound = [n.name];
    else if (ts.isImportClause(n) && n.name) bound = [n.name];
    else if (ts.isNamespaceImport(n) || ts.isImportEqualsDeclaration(n)) bound = [n.name];
    else if (ts.isImportSpecifier(n)) {
      const from = (n.parent.parent.parent.moduleSpecifier as ts.StringLiteral).text;
      const orig = (n.propertyName ?? n.name).text;
      if (GUARD.has(n.name.text)) assert.ok(from === '../ipcguard' && orig === (n.name.text === 'fromApp' ? 'fromAppFrame' : n.name.text), `${rel}: ${n.name.text} must be ipcguard.ts's own (imported as ${orig} from '${from}')`);
    }
    for (const id of bound) assert.ok(!GUARD.has(id.text), `${rel}:${sf.getLineAndCharacterOfPosition(id.getStart()).line + 1}: binds its own ${id.text} (the guard must be ipcguard.ts's)`);
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

// 3. the owner-only checks. Taken from main.ts before the move (spec 066 FR-007 resolvePlan and plan-first send, 045 FR-005 of 065, FR-004b of 051, FR-011 of 054, 052 FR-071 and FR-089, 063).
const FROM_APP = [
  'activity:clear', 'activity:export', 'activity:list',
  'adapters:sandboxAlwaysOff', 'adapters:sandboxHosts', 'agents:sandboxContinue', // spec 087: the OS sandbox choices and the Settings line
  'agents:checkpointPreview', 'agents:checkpointUndo', 'agents:gitStatus', 'agents:mcpCancelSignIn', 'agents:mcpOpenSignIn', 'agents:mcpRefresh', 'agents:mcpSignIn', 'agents:openRemote', 'agents:resolvePlan', 'agents:send', 'agents:sessionSummary', 'agents:setMode', 'agents:setRemote',
  'app:dismissInterrupted', 'app:dismissSinceAway', 'app:interrupted', 'app:sinceAway', 'doors:held', 'doors:list', 'doors:release', 'doors:set', // 'app:interrupted': spec 006 FR-041, ids and folder names of the sessions a crash left mid-turn
  'folders:create', 'folders:createCheck', 'folders:createPickParent', // spec 093 FR-080: create a folder (writes to the disk, runs git)
  'browser:back', 'browser:bounds', 'browser:consentAccept', 'browser:leaveAnswer', 'browser:snapshot', 'browser:forward', 'browser:mute', 'browser:navigate', 'browser:open', 'browser:openSystem', 'browser:overlay', 'browser:reload', 'browser:state', 'browser:stop', 'browser:visible', // spec 080 T014 FR-003: the session browser answers the app's own page only
  'harness:accounts', 'harness:cancel', 'harness:copilotAuth', 'harness:openPage', 'harness:openSignIn', 'harness:paste', 'harness:plans', 'harness:run', 'harness:updates', 'harness:visible',
  'notes:add', 'notes:delete', 'notes:deleteAll', 'notes:list', 'notes:save', 'notes:startOver', 'notes:update', // spec 083 FR-062: the folder's notes, by agent id
  'profiles:create', 'profiles:delete', 'profiles:generate', 'profiles:save', // spec 043 FR-011, FR-040: writes to (or deletes) profile files
  'schedules:remove', 'schedules:runNow', 'schedules:runs', 'schedules:save',
];
assert.strictEqual(new Set(FROM_APP).size, FROM_APP.length, 'no channel twice in the list');
// spec 043 FR-041 (review on #572): an ended or removed session is forgotten by the profile list freshness; a change prunes the rest
for (const c of ['agents:end', 'agents:remove']) assert.ok(/profileFreshness\?\.forget\(/.test(regs.get(c)?.[0]?.block ?? ''), `"${c}" must forget the session's profile freshness`);
// spec 085 (review on #718): the session-summary wiring. The start is noted before the turn is sent; the summary takes only the id and
// main's own folder for that session; End and Remove forget the start, so the next session in the folder starts its own count.
{
  const send = regs.get('agents:send')?.[0]?.block ?? '';
  const ns = send.search(/sessionStarts\.noteStart\(/), so = send.search(/\bsendOp\(/);
  assert.ok(ns >= 0 && so > ns, '"agents:send" notes the session start before sendOp');
  assert.ok(/await sessionStarts\.noteStart\(id, ag\.cwd\)/.test(send) && /const ag = agents\.get\(id\)/.test(send), '"agents:send" notes the start for main\'s own folder of that agent');
  const sum = regs.get('agents:sessionSummary')?.[0]?.block ?? '';
  assert.ok(/ipcHandle\('agents:sessionSummary', async \(e, id: unknown\)/.test(sum), '"agents:sessionSummary" takes only the id from the window');
  assert.ok(/agents\.get\(id\)/.test(sum) && /sessionStarts\.summarize\(a\.id, a\.cwd\)/.test(sum), '"agents:sessionSummary" summarizes main\'s own folder for the session, never one the window sends');
  for (const c of ['agents:end', 'agents:remove']) assert.ok(/sessionStarts\.forget\(/.test(regs.get(c)?.[0]?.block ?? ''), `"${c}" must forget the session start`);
}
assert.ok(/fresh\.prune\(/.test(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'ipc', 'profiles.ts'), 'utf8')), 'profiles.ts prunes sessions no longer in the office on a change');
for (const c of FROM_APP) {
  const r = regs.get(c);
  assert.ok(r && r.length === 1, `"${c}" is registered`);
  assert.ok(/\bfromApp\(e\)/.test(r[0].block), `"${c}" (${r[0].file}) must still call fromApp(e)`);
}
const withCheck = [...regs].filter(([, list]) => /\bfromApp\(e\)/.test(list[0].block)).map(([c]) => c).sort();
assert.deepStrictEqual(withCheck, [...FROM_APP].sort(), 'the channels that call fromApp(e) are exactly the list (a new owner-only check goes in the list too)');

console.log(`ipc channels: ${called.size} preload channels each registered once, ${regs.size} registrations in ${modules.length} modules + mcpipc, ${FROM_APP.length} fromApp checks kept`);
