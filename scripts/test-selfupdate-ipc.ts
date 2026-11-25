/**
 * Spec 118 T010 (FR-016, FR-024): the IPC channels of Durbar's own update check (`selfUpdateHandlers` in `src/main/selfupdate.ts`, wired by
 * `src/main/ipc/selfupdate.ts`), forged arguments on every channel, and since T014 (FR-462) the active wiring: the preload names exactly the
 * window's eight calls, main.ts starts the checker once after the first load and refreshes it on a wake, on five known lines (until T014 this
 * block pinned the opposite: no start, no refresh, no event, three lines, no preload name). `npm run test:selfupdate-ipc`. No Electron, no network.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { selfUpdateHandlers, SELFUPDATE_REFUSED } from '../src/main/selfupdate';
import type { SelfUpdateView } from '../src/main/selfupdate';
import { SNOOZE_MS } from '../src/shared/selfupdate';
import { preloadChannels, stripComments } from './ipc-channel-list';
import { guardExit, rig, standard, LIST, SLUG, T0 } from './selfupdate-rig';

const exit = guardExit('selfupdate-ipc');

async function main(): Promise<void> {
  // ---- FR-024: forged arguments on every channel -------------------------------------------------------------------
  {
    const r = rig({ script: standard });
    const h = selfUpdateHandlers(() => r.u);
    const refused = async (f: () => unknown, what: string): Promise<void> => {
      const before = [r.calls.length, fs.existsSync(r.file) ? fs.readFileSync(r.file, 'utf8') : '', JSON.stringify(r.u.view())];
      await assert.rejects(async () => f(), (e: Error) => e.message === SELFUPDATE_REFUSED, `FR-024: ${what} is refused with the fixed text`);
      assert.deepStrictEqual([r.calls.length, fs.existsSync(r.file) ? fs.readFileSync(r.file, 'utf8') : '', JSON.stringify(r.u.view())], before, `FR-024: ${what}: no request, no settings write, no change`);
    };
    await refused(() => h.snooze('0.1.29'), 'snooze before any check (no feed in memory)');
    await h.check();
    const calls = r.calls.length;
    let gets = 0;
    const forged: [unknown, string][] = [
      ['0.1.99', 'a version not in the feed'], ['v0.1.29', 'the tag form'], [LIST, 'a URL'], ['../../etc/passwd', 'a path'], ['..\\..\\x', 'a Windows path'], [SLUG, 'a slug'],
      ['0.1.29\u0000', 'a version with a NUL'], ['0.1.29 ', 'a version with a space'], ['9'.repeat(1_000_000), 'a huge string'], [{ version: '0.1.29' }, 'an object'], [['0.1.29'], 'an array'],
      [Object.defineProperty({}, 'toString', { get: () => { gets++; return () => '0.1.29'; } }), 'an object with a getter'], [JSON.parse('{"__proto__":{"version":"0.1.29"}}'), 'a __proto__ object'],
      [new String('0.1.29'), 'a String object'], [129, 'a number'], [null, 'null'], [undefined, 'undefined'],
    ];
    for (const name of ['snooze', 'skip'] as const) {
      for (const [arg, what] of forged) await refused(() => h[name](arg), `${name}(${what})`);
      await refused(() => h[name](), `${name}() with no argument`);
      await refused(() => h[name]('0.1.29', 'x'), `${name} with an extra argument`);
    }
    // version only (T010): setSource is the ONE free-text channel (T011); every other channel refuses a slug, a URL and a path
    for (const name of ['snooze', 'skip'] as const) for (const text of [SLUG, `https://github.com/${SLUG}`, '../x']) await refused(() => h[name](text), `version only: ${name} refuses free text (${text})`);
    for (const name of ['get', 'check', 'useBuiltInSource'] as const) {
      for (const [arg, what] of forged) await refused(() => h[name](arg), `${name}(${what})`);
    }
    assert.strictEqual(gets, 0, 'FR-024: a getter on a forged argument is never run');
    assert.strictEqual(r.calls.length, calls, 'FR-024: no forged call made a request');
    await refused(() => selfUpdateHandlers(() => undefined).get(), 'a call before the checker exists');

    const patches: unknown[] = [];
    const real = r.store;
    (r.u as unknown as { d: { store(): unknown } }).d.store = () => ({ get updates() { return real.updates; }, setUpdates: (p: never) => { patches.push(p); return real.setUpdates(p); } });
    const s = h.snooze('0.1.29') as { ok: boolean; update: SelfUpdateView };
    assert.deepStrictEqual(r.store.updates.snooze, { version: '0.1.29', until: T0 + SNOOZE_MS }, 'FR-016: snooze saves version + 7 days');
    assert.ok(s.ok && s.update.notice === 'snoozed', 'FR-016: the view says snoozed');
    const k = h.skip('0.1.29') as { ok: boolean; update: SelfUpdateView };
    assert.ok(k.ok && r.store.updates.skip === '0.1.29' && k.update.notice === 'skipped', 'FR-016: skip saves the version and the view says skipped');
    assert.strictEqual((h.get() as SelfUpdateView).target, '0.1.29', 'FR-024: get answers the view');
    assert.deepStrictEqual(patches, [{ snooze: { version: '0.1.29', until: T0 + SNOOZE_MS } }, { skip: '0.1.29' }], 'FR-016: snooze and skip each write exactly their one key');

    // a version of the old source is refused once the source changed (the twin of review item 2 of PR 2073)
    r.policy.p = { state: 'ok', feedUrl: 'https://github.com/org-b/durbar' };
    await assert.rejects(async () => h.skip('0.1.28'), (e: Error) => e.message === SELFUPDATE_REFUSED, 'FR-024: after a source change, a version of the old feed is refused');
    assert.strictEqual(patches.length, 2, 'FR-024: the refused call writes nothing');
    r.policy.p = { state: 'none' };

    // the IPC module wires exactly these four channels to these handlers, through ipcHandle
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'ipc', 'selfupdate.ts'), 'utf8').replace(/\r\n/g, '\n');
    const regs = [...src.matchAll(/ipcHandle\('([^']+)', \(_e, \.\.\.a: unknown\[\]\) => h\.(\w+)\(\.\.\.a\)\);/g)].map((m) => `${m[1]}=${m[2]}`);
    assert.deepStrictEqual(regs, ['selfupdate:get=get', 'selfupdate:check=check', 'selfupdate:snooze=snooze', 'selfupdate:skip=skip', 'selfupdate:setSource=setSource', 'selfupdate:useBuiltInSource=useBuiltInSource', 'selfupdate:setDailyCheck=setDailyCheck', 'selfupdate:notes=notes', 'selfupdate:openReleasePage=openReleasePage'], 'FR-024: nine channels, each to its own handler, every argument passed to the validator');
    assert.strictEqual((src.match(/ipcHandle\(/g) ?? []).length, 9, 'FR-024: no other channel in the module');
  }

  // ---- T014 (FR-462): active. Until T014 this block pinned the inert wiring (the preload named no channel; main.ts named the checker on three
  // lines and never with start, refresh or an event). It now pins the switched behaviour: the window's eight calls, one start after the first
  // load, the resume hook, never Check now, and nothing else naming the checker.
  {
    const root = path.join(__dirname, '..', '..');
    assert.deepStrictEqual([...preloadChannels().all].filter((c) => c.startsWith('selfupdate:')).sort(), ['selfupdate:check', 'selfupdate:get', 'selfupdate:notes', 'selfupdate:openReleasePage', 'selfupdate:setDailyCheck', 'selfupdate:skip', 'selfupdate:snooze'],
      'FR-462: the preload calls exactly the seven channels the window uses (setSource and useBuiltInSource wait for the source form, T577)');
    const preSrc = stripComments(fs.readFileSync(path.join(root, 'src', 'preload', 'preload.ts'), 'utf8').replace(/\r\n/g, '\n'));
    assert.deepStrictEqual([...preSrc.matchAll(/'(selfupdate:[A-Za-z]+)'/g)].map((m) => m[1]).sort(), ['selfupdate:changed', 'selfupdate:check', 'selfupdate:get', 'selfupdate:notes', 'selfupdate:openReleasePage', 'selfupdate:setDailyCheck', 'selfupdate:skip', 'selfupdate:snooze'],
      'FR-462: the preload names exactly the eight selfupdate channels of the window (seven calls and the changed event)');
    assert.ok(/selfUpdateSetDaily: \(on\) => ipcRenderer\.invoke\('selfupdate:setDailyCheck', on === true\)/.test(preSrc), 'FR-462: the preload sends the switch as a boolean only');
    const mainSrc = stripComments(fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8').replace(/\r\n/g, '\n'));
    const uses = mainSrc.split('\n').filter((l) => /\bselfUpdater\b/.test(l)).map((l) => l.trim());
    assert.strictEqual(uses.filter((l) => /\bselfUpdater\?\.start\(\)/.test(l)).length, 1, 'FR-462: main.ts starts the checker exactly once');
    assert.ok(/win\.webContents\.once\('did-finish-load', \(\) => \{ void adaptersList\(false\)\.then\(\(\) => harnessIpc\.checker\.scheduleStart\(\)\)\.catch\(\(\) => undefined\)\.then\(\(\) => selfUpdater\?\.start\(\)\); \}\);/.test(mainSrc),
      'FR-462: the start is in the first-load chain, after the office is shown and spec 081\'s start detection (a failed detection does not stop it)');
    assert.ok(!uses.some((l) => /\bcheckNow\b/.test(l)), 'FR-462: main.ts never presses Check now');
    assert.ok(/^\s*wireSelfUpdateResume\(powerMonitor, \(\) => selfUpdater\);/m.test(mainSrc), 'FR-462: a wake from sleep refreshes the checker (powerMonitor resume)');
    assert.deepStrictEqual(uses.map((l) => l.replace(/\(\{ packaged: .*\}\);$/, '({ ... });').replace(/;\s*$/, ';')), [
      'let selfUpdater: SelfUpdater | undefined;',
      'registerSelfUpdateIpc({ getSelfUpdater: () => selfUpdater });',
      "win.webContents.once('did-finish-load', () => { void adaptersList(false).then(() => harnessIpc.checker.scheduleStart()).catch(() => undefined).then(() => selfUpdater?.start()); });",
      'selfUpdater = new SelfUpdater({ ... });',
      'wireSelfUpdateResume(powerMonitor, () => selfUpdater);',
    ], 'FR-462: main.ts names the checker only on its five known lines (declaration, channels, start, creation, resume hook)');
    assert.ok(/^\s*selfUpdater = new SelfUpdater\(\{ packaged: app\.isPackaged, simulator: SIMULATOR, source: loadUpdateSource\(\), running: app\.getVersion\(\), policy: updatePolicy, store: \(\) => settingsStore, get: updateFeedGet\(\), now: Date\.now, timer: realSelfUpdateTimer, confirm: \(o\) => nativeConfirm\(win, o\), changed: \(v\) => toRenderer\('selfupdate:changed', v\), openExternal: \(url\) => shell\.openExternal\(url\) \}\);$/m.test(mainSrc),
      'the creation line is exactly the known one (T011 the confirm part, T507 the update session in get, T014 changed and openExternal)');

    // review of PR 2082, item 2: every ipcRenderer call in the preloads names a literal channel; no passthrough of a channel from the page
    for (const f of fs.readdirSync(path.join(root, 'src', 'preload')).filter((x) => x.endsWith('.ts'))) {
      const pre = stripComments(fs.readFileSync(path.join(root, 'src', 'preload', f), 'utf8').replace(/\r\n/g, '\n'));
      const all = [...pre.matchAll(/\bipcRenderer\b/g)].length;
      const imports = [...pre.matchAll(/import \{[^}]*\bipcRenderer\b[^}]*\} from 'electron';/g)].length;
      const literal = [...pre.matchAll(/\bipcRenderer\.(invoke|send|sendSync|on|once|removeListener|removeAllListeners|postMessage)\(\s*'[^']+'/g)].length;
      const helper = [...pre.matchAll(/\bipcRenderer\.(on|removeListener)\(channel, h\)/g)].length; // the one `sub(channel, cb)` helper
      assert.strictEqual(all, imports + literal + helper, `inert: ${f} calls ipcRenderer only with a literal channel (no computed channel, no passthrough)`);
      assert.ok(![...pre.matchAll(/\bsub(?:<[^>]*>)?\(\s*([^'\s<])/g)].length, `inert: ${f} subscribes only to literal channels`);
    }
  }

  exit.done();
  console.log('selfupdate-ipc: ok');
}

main().catch((e) => { console.error(e); process.exit(1); });
