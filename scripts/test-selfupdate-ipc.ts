/**
 * Spec 118 T010 (FR-016, FR-024): the four version-only IPC channels of Durbar's own update check (`selfUpdateHandlers` in
 * `src/main/selfupdate.ts`, wired by `src/main/ipc/selfupdate.ts`), forged arguments on every channel, and the inert wiring until T014
 * (the preload names no channel, main.ts never starts the checker). `npm run test:selfupdate-ipc`. No Electron, no network (`selfupdate-rig.ts`).
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
    assert.deepStrictEqual(regs, ['selfupdate:get=get', 'selfupdate:check=check', 'selfupdate:snooze=snooze', 'selfupdate:skip=skip', 'selfupdate:setSource=setSource', 'selfupdate:useBuiltInSource=useBuiltInSource'], 'FR-024: six channels, each to its own handler, every argument passed to the validator');
    assert.strictEqual((src.match(/ipcHandle\(/g) ?? []).length, 6, 'FR-024: no other channel in the module');
  }

  // ---- not active until T014: nothing in the window can call the channels, and main.ts never starts the checker ----------
  {
    const root = path.join(__dirname, '..', '..');
    assert.deepStrictEqual([...preloadChannels().all].filter((c) => c.startsWith('selfupdate:')), [], 'inert: the preload calls no selfupdate channel (the window API comes with T014)');
    assert.ok(!/selfupdate/i.test(stripComments(fs.readFileSync(path.join(root, 'src', 'preload', 'preload.ts'), 'utf8'))), 'inert: the preload names no selfupdate channel in any form');
    const mainSrc = stripComments(fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8').replace(/\r\n/g, '\n'));
    assert.ok(/selfUpdater = new SelfUpdater\(/.test(mainSrc) && /registerSelfUpdateIpc\(/.test(mainSrc), 'inert: main.ts creates the checker and registers its channels');
    // T014 flips this assert when it adds the start call together with the visible switch and card
    assert.ok(!mainSrc.split('\n').some((l) => /selfUpdater/.test(l) && /\bstart\b/.test(l)), 'inert: main.ts does not start the checker before T014 (no request in a packaged build)');
  }

  exit.done();
  console.log('selfupdate-ipc: ok');
}

main().catch((e) => { console.error(e); process.exit(1); });
