/**
 * Spec 045 FR-066 (issue #1682, T025): every `ipcHandle` channel answers an unexpected throw with one fixed text, and the real error is logged in
 * main only, masked. Driven through the real `ipcguard` on a stand-in `electron`. `npm run test:ipcthrow`. No Electron, no network, no credits.
 *
 *  1. a thrown Error whose message, fields and cause carry an invented token and path: the window gets `IPC_FAILED`, nothing else;
 *  2. a thrown non-Error value (a string, an object, null) and an async rejection: the same;
 *  3. a `ShownError` (an adapter's or main's own words) keeps its text, masked again; a real adapter refusal and the start guard's refusal pass;
 *  4. the main log line names the channel and the error, through `redact` (no token);
 *  5. a value or a resolved promise comes back unchanged; the sender check and the simulator refusal keep their own texts;
 *  6. `ipcHandle` runs every handler through `answer` (read from its source), and `ipcguard.ts` is still the only file that touches `ipcMain`
 *     (that scan and its own mutants are `test:ipcchannels`);
 *  7. a handler that catches and returns `{ ok: false, error }` goes through `failText` (`ipcerror.ts`): the same rules, its own fixed fallback,
 *     a home path in a `ShownError` masked; real handlers (`openWithOp`-style ops) return neither the token nor the path;
 *  8. no file in src/main uses a caught error's own text outside `ipcerror.ts` (a scan of the source, with its own mutants), unless the line
 *     says `FR-066: read, not shown` (a classification or a log line that is masked).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';

type Handler = (e: unknown, ...a: unknown[]) => unknown;

async function main(): Promise<void> {
  const electronPath = require.resolve('electron');
  const handlers = new Map<string, Handler>();
  const fake = { ipcMain: { handle: (ch: string, fn: Handler) => handlers.set(ch, fn), on: () => undefined } };
  const saved = require.cache[electronPath];
  require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fake } as unknown as NodeJS.Module;
  const logged: string[] = [];
  const realWarn = console.warn;
  console.warn = (...a: unknown[]) => { logged.push(a.map(String).join(' ')); };
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const guard = require('../src/main/ipcguard') as typeof import('../src/main/ipcguard');
    const { ShownError } = require('../src/shared/shownerror') as typeof import('../src/shared/shownerror');
    const { FakeAdapter } = require('../src/adapters/fake') as typeof import('../src/adapters/fake');
    const { startGuardOp } = require('../src/main/agentops') as typeof import('../src/main/agentops');
    guard.initSimGuard(false);
    const { ipcHandle, IPC_FAILED } = guard;

    // invented values, built from pieces so no real-looking secret is a literal in this file
    const token = ['g', 'hp', '_'].join('') + 'aB3dE6gH9k'.repeat(4).slice(0, 36);
    const where = path.join(os.homedir(), ['inv', 'ented'].join(''), ['sess', 'ion'].join('') + '.json');
    const marker = ['boom', 'marker'].join('-');
    const frame = { url: pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href };
    const win = { senderFrame: frame, sender: { mainFrame: frame } };

    /** What the window would see: the handler's value, or the message of the error it throws or rejects with (all Electron sends). */
    const ask = async (ch: string): Promise<{ value?: unknown; message?: string; error?: unknown }> => {
      try { return { value: await handlers.get(ch)!(win) }; } catch (err) { return { error: err, message: (err as Error).message }; }
    };
    const onlyFixed = (r: { message?: string; error?: unknown }, what: string): void => {
      assert.strictEqual(r.message, IPC_FAILED, `${what}: the window sees only the fixed text (got ${JSON.stringify(r.message)})`);
      const e = r.error as Record<string, unknown>;
      assert.ok(e instanceof Error && !(e instanceof ShownError), `${what}: a plain new Error`);
      assert.deepStrictEqual(Object.keys(e), [], `${what}: no own fields cross`);
      assert.strictEqual(e.cause, undefined, `${what}: no cause crosses`);
      const all = `${String(e.message)} ${String(e.stack)}`;
      for (const bad of [token, where, marker, 'invented']) assert.ok(!all.includes(bad), `${what}: nothing of the thrown value (${bad === token ? 'the token' : bad}) reaches the window`);
    };

    // 1. a thrown Error carrying an invented token and path in its message, its fields and its cause
    ipcHandle('t:throwError', () => {
      const err = new Error(`${marker}: could not read ${where} with ${token}`) as Error & Record<string, unknown>;
      err.path = where;
      err.token = token;
      (err as { cause?: unknown }).cause = new Error(token);
      throw err;
    });
    onlyFixed(await ask('t:throwError'), 'a thrown Error');
    const line = logged.find((l) => l.includes('"t:throwError"'));
    assert.ok(line, 'main logs the failed channel by name');
    assert.ok(line!.includes(marker), 'the main log line carries the real error');
    assert.ok(!line!.includes(token), 'the main log line is masked (no token)');

    // 2. non-Error values and an async rejection
    ipcHandle('t:throwString', () => { throw `${marker} ${token} ${where}`; });
    onlyFixed(await ask('t:throwString'), 'a thrown string');
    ipcHandle('t:throwObject', () => { throw { message: `${marker} ${token}`, path: where }; });
    onlyFixed(await ask('t:throwObject'), 'a thrown object');
    ipcHandle('t:throwNull', () => { throw null; });
    onlyFixed(await ask('t:throwNull'), 'a thrown null');
    ipcHandle('t:throwBadToString', () => { throw { toString: () => { throw new Error(token); } }; });
    onlyFixed(await ask('t:throwBadToString'), 'a thrown value whose toString throws');
    ipcHandle('t:reject', async () => { await Promise.resolve(); throw new Error(`${marker} ${where} ${token}`); });
    onlyFixed(await ask('t:reject'), 'an async rejection');
    ipcHandle('t:rejectValue', () => Promise.reject(`${marker} ${token}`));
    onlyFixed(await ask('t:rejectValue'), 'a rejected promise with a string');
    assert.ok(logged.some((l) => l.includes('"t:reject"') && l.includes(marker) && !l.includes(token)), 'an async rejection is logged in main, masked');
    assert.ok(logged.some((l) => l.includes('"t:throwBadToString"') && !l.includes(token)), 'an unreadable thrown value is still logged');

    // 3. a ShownError keeps its words (masked again); the real adapter's and the start guard's refusals pass
    ipcHandle('t:shown', () => { throw new ShownError('That session is open. End it first.'); });
    const shown = await ask('t:shown');
    assert.strictEqual(shown.message, 'That session is open. End it first.', 'a ShownError keeps its text');
    assert.ok(!(shown.error instanceof ShownError) && Object.keys(shown.error as object).length === 0, 'a ShownError still crosses as a new plain Error');
    ipcHandle('t:shownToken', async () => { throw new ShownError(`Copilot refused: ${token}`); });
    const shownTok = await ask('t:shownToken');
    assert.ok(shownTok.message!.startsWith('Copilot refused: ') && !shownTok.message!.includes(token), `a ShownError's text is masked on the way (got ${JSON.stringify(shownTok.message)})`);
    const ad = new FakeAdapter();
    ipcHandle('t:adapter', () => ad.send('no-such-session', { text: 'hi' }));
    assert.strictEqual((await ask('t:adapter')).message, 'Unknown or stopped session: no-such-session', "an adapter's own refusal still reaches the window");
    const refusal = 'Your organization does not allow this mode.';
    ipcHandle('t:startGuard', () => startGuardOp({ refusal: async () => refusal }, { id: 'fake', start: async () => 'x' }, { sessionId: 'x', cwd: os.tmpdir(), mode: 'ask', model: '' } as never));
    assert.strictEqual((await ask('t:startGuard')).message, refusal, "the start guard's refusal still reaches the window");

    // 5. values pass unchanged; the sender check and the simulator refusal are not replaced
    const obj = { ok: false, error: 'Kept as it is.' };
    ipcHandle('t:value', () => obj);
    assert.strictEqual((await ask('t:value')).value, obj, 'a returned value is the same object');
    ipcHandle('t:promise', async () => obj);
    assert.strictEqual((await ask('t:promise')).value, obj, 'a resolved value is the same object');
    ipcHandle('t:undef', () => undefined);
    assert.strictEqual((await ask('t:undef')).value, undefined, 'undefined stays undefined');
    const other = { url: 'https://example.invalid/' };
    assert.throws(() => handlers.get('t:value')!({ senderFrame: other, sender: { mainFrame: other } }), /refused a call that did not come from its own window/, 'the sender refusal keeps its text');

    // 6. the wiring: the handler inside ipcHandle runs through answer (a mutant calling fn directly fails 1. above too)
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'ipcguard.ts'), 'utf8');
    const body = /export function ipcHandle[\s\S]*?\n\}/.exec(src)?.[0] ?? '';
    assert.ok(/return answer\(channel, \(\) => fn\(e, \.\.\.\(args as A\)\)\);/.test(body), 'ipcHandle returns answer(channel, () => fn(...))');
    assert.strictEqual((body.match(/\bfn\(/g) ?? []).length, 1, 'ipcHandle calls the handler only inside answer');

    // 7. the helper for handlers that catch and return their own { ok: false, error }
    const { failText } = require('../src/main/ipcerror') as typeof import('../src/main/ipcerror');
    const before = logged.length;
    const raw = Object.assign(new Error(`${marker}: could not read ${where} with ${token}`), { path: where });
    assert.strictEqual(failText(raw, 'test'), IPC_FAILED, 'failText: a plain Error gives IPC_FAILED');
    assert.strictEqual(failText(`${token} ${where}`, 'test'), IPC_FAILED, 'failText: a thrown string gives IPC_FAILED');
    assert.strictEqual(failText(raw, 'test', 'Could not start it.'), 'Could not start it.', "failText: a plain Error gives the caller's fixed fallback");
    assert.ok(logged.length === before + 3 && logged.slice(before).every((l) => l.includes('[ipc] test failed') && !l.includes(token)), 'failText logs one masked main line per error');
    assert.ok(logged[before].includes(marker), "failText's log line carries the real error");
    assert.strictEqual(failText(new ShownError('That session is open. End it first.'), 'test', 'x'), 'That session is open. End it first.', 'failText: a ShownError keeps its words');
    const shownMixed = failText(new ShownError(`Codex refused the settings: ${where} ${token}`), 'test');
    assert.ok(shownMixed.startsWith('Codex refused the settings: ') && !shownMixed.includes(token), `failText: a ShownError is masked for tokens (got ${JSON.stringify(shownMixed)})`);
    assert.ok(!shownMixed.includes(os.homedir()) && shownMixed.includes(path.join('~', ['inv', 'ented'].join(''))), `failText: a ShownError's home path is masked (got ${JSON.stringify(shownMixed)})`);
    // a real op that catches and returns: the open-with op on a launcher that throws an error carrying a token and a path
    const { openWith } = require('../src/main/openwith') as typeof import('../src/main/openwith');
    const dir = { isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false };
    const ow = await openWith({ cwd: '/srv/project' }, 'folder', {
      platform: 'linux', launchEnv: {} as never, lstat: () => dir, realpath: (x) => x, reveal: () => undefined, start: async () => ({ ok: true }),
      openPath: async () => { throw Object.assign(new Error(`${marker} EACCES ${where} ${token}`), { path: where }); },
    });
    assert.deepStrictEqual(ow, { ok: false, error: IPC_FAILED }, `a real handler that catches and returns gives IPC_FAILED (got ${JSON.stringify(ow)})`);

    // 8. the scan: a caught error's own text is used only in ipcerror.ts
    const RAW: [RegExp, string][] = [
      [/\berrText\b/, 'an errText helper'],
      [/\b(\w+) instanceof Error \? \1\.message\b/, 'err instanceof Error ? err.message'],
      [/\b(?:e|err|error|ex)\.message\b/, 'a caught error .message'],
      [/\bString\((?:e|err|error|ex)\)/, 'String(err)'],
    ];
    const scan = (text: string): string[] => text.split('\n').flatMap((l, i) => (l.includes('FR-066: read, not shown') ? [] : RAW.filter(([re]) => re.test(l)).map(([, what]) => `${i + 1}: ${what}`)));
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.ts') ? [path.join(dir, d.name)] : []));
    const mainDir = path.join(__dirname, '..', '..', 'src', 'main');
    const files = walk(mainDir).filter((f) => path.basename(f) !== 'ipcerror.ts');
    assert.ok(files.length > 100, `src/main has many files (${files.length})`);
    for (const f of files) {
      const found = scan(fs.readFileSync(f, 'utf8'));
      assert.deepStrictEqual(found, [], `${path.relative(mainDir, f)} uses a caught error's own text outside ipcerror.ts (failText): ${found.join('; ')}`);
    }
    // the scan is not vacuous (its mutants): each shape is caught, the marker exempts, failText is left alone
    for (const [sample, n] of [["return { ok: false, error: errText(err) };", 0], ["error: e instanceof Error ? e.message : String(e) }", 1], ["const why = 'x: ' + err.message;", 2], ["return { ok: false, error: String(err) };", 3]] as const) {
      assert.ok(RAW[n][0].test(sample) && scan(sample).length > 0, `the scan catches: ${sample}`);
    }
    assert.deepStrictEqual(scan("const t = err.message; // FR-066: read, not shown"), [], 'the marker exempts a line');
    assert.deepStrictEqual(scan("return { ok: false, error: failText(err, 'x') };"), [], 'the scan leaves failText alone');
    console.log('test:ipcthrow OK');
  } finally {
    console.warn = realWarn;
    if (saved) require.cache[electronPath] = saved;
    else delete require.cache[electronPath];
  }
}

process.exitCode = 1;
main().then(() => { process.exitCode = 0; }, (err) => { console.error(err); process.exitCode = 1; });
