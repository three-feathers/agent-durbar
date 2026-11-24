/**
 * Spec 045 FR-066 (issue #1682, T025; changed 2026-11-23 by the owner's decision, #2060 item 1, T490): every `ipcHandle` channel answers a throw
 * with the error's own message made safe for the screen (`failText`: masked, one line, cut), and the real error is logged in main only, masked.
 * Driven through the real `ipcguard` on a stand-in `electron`. `npm run test:ipcthrow`. No Electron, no network, no credits.
 *
 *  1. a thrown Error whose message, fields and cause carry an invented token and path: the window gets the message with the path and the token
 *     masked; nothing of the fields, the cause or the stack;
 *  2. a thrown non-Error value (a string, an object, null): the fixed `IPC_FAILED`; an async rejection with an Error: as 1.;
 *  3. a `ShownError` (an adapter's or main's own words) keeps its text, masked again; a real adapter refusal and the start guard's refusal pass;
 *  4. the main log line names the channel and the error, through `redact` (no token);
 *  5. a value or a resolved promise comes back unchanged; the sender check and the simulator refusal keep their own texts;
 *  6. `ipcHandle` runs every handler through `answer` (read from its source), and `ipcguard.ts` is still the only file that touches `ipcMain`
 *     (that scan and its own mutants are `test:ipcchannels`);
 *  7. a handler that catches and returns `{ ok: false, error }` goes through `failText` (`ipcerror.ts`): the same rules, its own fixed fallback
 *     only when there is no message, paths as written; the cut, one line, stack frames and the app folder out, Windows paths; real handlers
 *     (`openWithOp`-style ops) return the path and never the token;
 *  7b. the differential: error messages with every token family of `redact` (`redact-families.ts`) in several contexts: 0 visible, per family;
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
    const causeMark = ['cause', 'marker'].join('-');
    const fieldMark = ['field', 'marker'].join('-');
    const frame = { url: pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href };
    const win = { senderFrame: frame, sender: { mainFrame: frame } };

    /** What the window would see: the handler's value, or the message of the error it throws or rejects with (all Electron sends). */
    const ask = async (ch: string): Promise<{ value?: unknown; message?: string; error?: unknown }> => {
      try { return { value: await handlers.get(ch)!(win) }; } catch (err) { return { error: err, message: (err as Error).message }; }
    };
    const OWNER = 'owner decision 2026-11-23 (#2060 item 1)';
    /** The window sees the error's own words, masked: the path shown, the token gone, nothing of the fields, the cause or the stack. */
    const shownOnly = (r: { message?: string; error?: unknown }, what: string): void => {
      const e = r.error as Record<string, unknown>;
      assert.ok(e instanceof Error && !(e instanceof ShownError), `${what}: a plain new Error`);
      assert.deepStrictEqual(Object.keys(e), [], `${what}: no own fields cross`);
      assert.strictEqual(e.cause, undefined, `${what}: no cause crosses`);
      assert.ok(r.message!.includes(marker) && r.message!.includes(where), `${what}: ${OWNER}: the window shows the real error and its path (got ${JSON.stringify(r.message)})`);
      const all = `${String(e.message)} ${String(e.stack)}`;
      for (const bad of [token, causeMark, fieldMark]) assert.ok(!all.includes(bad), `${what}: ${bad === token ? 'the token' : bad} never reaches the window`);
      assert.ok(r.message!.includes('[redacted'), `${what}: the mask stands in the token's place`);
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
      err.note = fieldMark;
      (err as { cause?: unknown }).cause = new Error(`${causeMark} ${token}`);
      throw err;
    });
    shownOnly(await ask('t:throwError'), 'a thrown Error');
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
    shownOnly(await ask('t:reject'), 'an async rejection');
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
    const beforeRefusal = logged.length;
    assert.throws(() => handlers.get('t:value')!({ senderFrame: other, sender: { mainFrame: other } }, `${token} ${where}`), (err: Error) => err.message === 'Agent Durbar refused a call that did not come from its own window.', `${OWNER}: a forged-sender refusal still shows exactly its constant text`);
    assert.strictEqual(logged.length, beforeRefusal, `${OWNER}: a refusal never passes through failText (no main log line, nothing of the call echoed)`);

    // 6. the wiring: the handler inside ipcHandle runs through answer (a mutant calling fn directly fails 1. above too)
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'ipcguard.ts'), 'utf8');
    const body = /export function ipcHandle[\s\S]*?\n\}/.exec(src)?.[0] ?? '';
    assert.ok(/return answer\(channel, \(\) => fn\(e, \.\.\.\(args as A\)\)\);/.test(body), 'ipcHandle returns answer(channel, () => fn(...))');
    assert.strictEqual((body.match(/\bfn\(/g) ?? []).length, 1, 'ipcHandle calls the handler only inside answer');

    // 7. the helper for handlers that catch and return their own { ok: false, error }
    const { failText } = require('../src/main/ipcerror') as typeof import('../src/main/ipcerror');
    const before = logged.length;
    const raw = Object.assign(new Error(`${marker}: could not read ${where} with ${token}`), { path: where });
    const rawShown = failText(raw, 'test');
    assert.ok(rawShown.startsWith(`${marker}: could not read ${where} with [redacted`) && !rawShown.includes(token), `failText: ${OWNER}: a plain Error gives its own words, path shown, token masked (got ${JSON.stringify(rawShown)})`);
    assert.strictEqual(failText(`${token} ${where}`, 'test'), IPC_FAILED, 'failText: a thrown string gives IPC_FAILED');
    assert.strictEqual(failText(raw, 'test', 'Could not start it.'), rawShown, `failText: ${OWNER}: an Error's words come before the caller's fixed fallback`);
    assert.ok(logged.length === before + 3 && logged.slice(before).every((l) => l.includes('[ipc] test failed') && !l.includes(token)), 'failText logs one masked main line per error');
    assert.strictEqual(failText(new Error(''), 'test', 'Could not start it.'), 'Could not start it.', "failText: an Error with no message gives the caller's fixed fallback");
    assert.strictEqual(failText(new Error(' \n\t '), 'test'), IPC_FAILED, 'failText: a blank message gives IPC_FAILED');
    assert.strictEqual(failText(Object.defineProperty(new Error('x'), 'message', { get: () => { throw new Error(token); } }), 'test'), IPC_FAILED, 'failText: a message that cannot be read gives IPC_FAILED');
    assert.strictEqual(failText(new Error(`[redaction failed] ${where}`), 'test'), IPC_FAILED, 'failText: fail closed: when the mask reports a failure, the fixed text');
    assert.ok(logged[before].includes(marker), "failText's log line carries the real error");
    assert.strictEqual(failText(new ShownError('That session is open. End it first.'), 'test', 'x'), 'That session is open. End it first.', 'failText: a ShownError keeps its words');
    const shownMixed = failText(new ShownError(`Codex refused the settings: ${where} ${token}`), 'test');
    assert.ok(shownMixed.startsWith('Codex refused the settings: ') && !shownMixed.includes(token), `failText: a ShownError is masked for tokens (got ${JSON.stringify(shownMixed)})`);
    assert.ok(shownMixed.includes(where), `failText: ${OWNER}: a ShownError's path is shown as written (got ${JSON.stringify(shownMixed)})`);
    // FR-066 as changed: the words a person needs, and nothing more
    const enoent = Object.assign(new Error("ENOENT: no such file or directory, open '/srv/projects/q3/plan.txt'"), { code: 'ENOENT', errno: -2 });
    assert.strictEqual(failText(enoent, 'test'), "ENOENT: no such file or directory, open '/srv/projects/q3/plan.txt'", `${OWNER}: a thrown ENOENT with a path shows the path`);
    for (const p of ['C:\\Users\\alice\\proj\\a b.txt', '\\\\nas01\\projects\\q3\\plan.docx', 'D:/work/x.json']) {
      assert.strictEqual(failText(new Error(`EPERM: operation not permitted, open '${p}'`), 'test'), `EPERM: operation not permitted, open '${p}'`, `${OWNER}: a Windows path (${p}) is shown as written`);
    }
    const markup = failText(new Error('<img src=x onerror=alert(1)>\r\n<b>bold</b>\u0000\u001b[31m\u2028end\u202e'), 'test');
    assert.strictEqual(markup, '<img src=x onerror=alert(1)> <b>bold</b> [31m end', `${OWNER}: a message with markup is one plain line of text (no control, line break or direction character)`);
    const long = failText(new Error('could not parse the answer: ' + 'word '.repeat(1000)), 'test');
    const more = /… (\d+) more characters$/.exec(long);
    assert.ok(more && long.length <= 400 + 30, `${OWNER}: a 5,000-character message is cut at 400 characters with the count (got ${long.length} characters)`);
    assert.strictEqual(long.length - more![0].length + Number(more![1]), ('could not parse the answer: ' + 'word '.repeat(1000)).trim().length, 'the count is exactly the characters left out');
    const huge = failText(new Error('x '.repeat(30_000)), 'test');
    assert.ok(/… \d+ more characters$/.test(huge) && huge.length <= 430, 'a message over the read limit is cut with the count too');
    const framed = failText(new Error('the tool failed: exit 2\n    at run (/build/agent/src/main/x.ts:10:5)\n    at async Promise.all (index 0)\n    at node:internal/process/task_queues:95:5\n    at new Thing (<anonymous>)'), 'test');
    assert.ok(framed.startsWith('the tool failed: exit 2') && !framed.includes('/build/') && !framed.includes('task_queues') && !framed.includes('Promise.all') && !framed.includes('anonymous'), `stack frames inside a message never reach the window (got ${JSON.stringify(framed)})`);
    const appDir = path.resolve(__dirname, '..');
    const own = failText(new Error(`Cannot find module '${path.join(appDir, 'src', 'main', 'gone.js')}'`), 'test');
    assert.ok(!own.includes(appDir) && own.includes('[app folder]'), `the app's own folder never reaches the window (got ${JSON.stringify(own)})`);
    // a real op that catches and returns: the open-with op on a launcher that throws an error carrying a token and a path
    const { openWith } = require('../src/main/openwith') as typeof import('../src/main/openwith');
    const dir = { isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false };
    const ow = await openWith({ cwd: '/srv/project' }, 'folder', {
      platform: 'linux', launchEnv: {} as never, lstat: () => dir, realpath: (x) => x, reveal: () => undefined, start: async () => ({ ok: true }),
      openPath: async () => { throw Object.assign(new Error(`${marker} EACCES ${where} ${token}`), { path: where }); },
    });
    assert.ok(ow.ok === false && typeof ow.error === 'string' && ow.error.includes(`EACCES ${where}`) && !ow.error.includes(token) && !('path' in ow), `${OWNER}: a real handler that catches and returns gives the error and its path, never the token (got ${JSON.stringify(ow)})`);

    // 7b. the differential: every token family of the shared mask, planted in error messages written the ways errors are written; 0 visible
    const { FAMILIES } = require('./redact-families') as typeof import('./redact-families');
    const envName = ['DURBAR', 'TEST', 'API', 'KEY'].join('_');
    const envValue = ['ev', 'Q7w', 'Z2x', 'P9k', 'M4n', 'B8v', 'C1'].join('');
    process.env[envName] = envValue;
    const families: Record<string, string[]> = { ...FAMILIES, envValue: [envValue] };
    const CONTEXTS: Array<(s: string) => string> = [
      (s) => `request failed: ${s}`,
      (s) => `EACCES: permission denied, open '${s}'`,
      (s) => `EPERM: operation not permitted, open 'C:\\srv\\${s}'`,
      (s) => `Command failed: tool --flag\nstderr: ${s}\n    at run (/build/x.js:1:2)`,
      (s) => `failed\r\n${s}\r\nretry`,
      (s) => `failed\t${s}\u0000 more`,
      (s) => `<b>${s}</b>`,
      (s) => `${'pad '.repeat(80)}${s}`,
      // the two path contexts that were the shared mask's limits when this differential was written, fixed by spec 012 FR-198 (T492): now zero-visible here
      (s) => `open '/srv/x/${s}'`,
      (s) => `open 'C:\\srv\\${s}\\a.txt'`,
    ];
    /** The last characters of the secret itself, as `test-redact-shapes.ts` reads them (a URL credential's host is not secret). */
    const bodyOf = (x: string): string => x.replace(/@host\.example.*$|\/getMe$| https:\/\/h$|" h$|[\\"}]+$/, '').slice(-8);
    const visible: Record<string, number> = {};
    let total = 0;
    for (const [family, samples] of Object.entries(families)) {
      visible[family] = 0;
      for (const sample of samples) {
        const body = bodyOf(sample);
        for (const ctxOf of CONTEXTS) {
          total++;
          const out = failText(new Error(ctxOf(sample)), 'differential');
          if (out.includes(body) || out.includes(body.replace(/\s+/g, ' '))) visible[family]++;
        }
      }
    }
    delete process.env[envName];
    const leaked = Object.entries(visible).filter(([, n]) => n > 0);
    assert.deepStrictEqual(leaked, [], `the differential: no secret of any family is visible (per family: ${JSON.stringify(Object.fromEntries(leaked))})`);
    const expected = Object.values(families).reduce((n, v) => n + v.length, 0) * CONTEXTS.length;
    assert.ok(total === expected && Object.keys(families).length >= 40 && total >= 2200, `the differential ran every family in every context (${Object.keys(families).length} families, ${total} messages)`);
    console.log(`test:ipcthrow differential: ${Object.keys(families).length} families, ${total} error messages, 0 secrets visible`);

    // 8. the scans (review of #1980, items 1, 2, 7). A line may be exempt only with an honest marker: `FR-066: read, not shown` (a classification,
    // a re-throw, a masked log line) or `FR-066: shown masked` / `FR-066: shown only as` (shown after its own masks, said how).
    const MARK = /FR-066: (?:read, not shown|shown masked|shown only as)/;
    const RAW: [RegExp, string][] = [
      [/\berrText\b/, 'an errText helper'],
      [/\b(\w+) instanceof Error \? \1\.message\b/, 'err instanceof Error ? err.message'],
      [/\b(?:e|err|error|ex)\.message\b/, 'a caught error .message'],
      [/\bString\((?:e|err|error|ex)\)/, 'String(err)'],
      [/\$\{\s*(?:e|err|error|ex)\s*\}/, 'a caught error in a template'],
      [/(?:\+\s*(?:e|err|error|ex)\b(?![.\w(\[])|(?<![.\w])(?:e|err|error|ex)\s*\+)/, 'a caught error joined with +'],
    ];
    const scan = (text: string): string[] => text.split('\n').flatMap((l, i) => (MARK.test(l) ? [] : RAW.filter(([re]) => re.test(l)).map(([, what]) => `${i + 1}: ${what}`)));
    // everywhere in src/ (adapters, shared, preload, main): an `error:` value built from a caught error, raw or through a function that is not a known mask
    const SAFE = new Set(['failText', 'windowText', 'errCode', 'listReason', 'cleanRemoteError', 'shortReason', 'safeGenerateError', 'signInErrorText', 'fromApp', 'fromAppFrame']); // masks, fixed classifications, and the IPC event's sender check
    const errorValue = (l: string): boolean => {
      if (!/\berror\s*:/.test(l)) return false;
      if (RAW.slice(1).some(([re]) => re.test(l))) return true;
      return [...l.matchAll(/\b(\w+)\(\s*(?:e|err|ex)\s*[,)]/g)].some((m) => !SAFE.has(m[1]));
    };
    const scanAll = (text: string): string[] => text.split('\n').flatMap((l, i) => (!MARK.test(l) && errorValue(l) ? [`${i + 1}: an error value from a caught error`] : []));
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.ts') ? [path.join(dir, d.name)] : []));
    const srcDir = path.join(__dirname, '..', '..', 'src');
    const mainDir = path.join(srcDir, 'main');
    const files = walk(mainDir).filter((f) => path.basename(f) !== 'ipcerror.ts');
    assert.ok(files.length > 100, `src/main has many files (${files.length})`);
    for (const f of files) {
      const found = scan(fs.readFileSync(f, 'utf8'));
      assert.deepStrictEqual(found, [], `${path.relative(mainDir, f)} uses a caught error's own text outside ipcerror.ts (failText): ${found.join('; ')}`);
    }
    const everywhere = ['adapters', 'shared', 'preload', 'main'].flatMap((d) => walk(path.join(srcDir, d))).filter((f) => path.basename(f) !== 'ipcerror.ts');
    assert.ok(everywhere.some((f) => f.includes(`${path.sep}adapters${path.sep}`)) && everywhere.length > files.length + 50, 'the error-value scan reads src/adapters, src/shared, src/preload and src/main');
    for (const f of everywhere) {
      const found = scanAll(fs.readFileSync(f, 'utf8'));
      assert.deepStrictEqual(found, [], `${path.relative(srcDir, f)} returns a caught error's own text as an error (use failText in main, ShownError or a mask in an adapter): ${found.join('; ')}`);
    }
    // the scans are not vacuous (their mutants): each shape is caught, the markers exempt, the masks are left alone
    for (const [sample, n] of [["return { ok: false, error: errText(err) };", 0], ["error: e instanceof Error ? e.message : String(e) }", 1], ["const why = 'x: ' + err.message;", 2], ["return { ok: false, error: String(err) };", 3], ["return { ok: false, error: `Could not do it: ${err}` };", 4], ["return { ok: false, error: 'x: ' + err };", 5], ["return { ok: false, error: 'Remote: ' + e };", 5], ["return { ok: false, error: err + ' (remote)' };", 5]] as const) {
      assert.ok(RAW[n]?.[0].test(sample) === true && scan(sample).length > 0, `the scan catches: ${sample}`);
    }
    for (const sample of ["return { ok: false, error: 'x: ' + err };", "return { ok: false, error: 'Remote: ' + e };", "return { ok: false, error: err + ' (remote)' };", "return { ok: false, error: cleanUp(e) };", "      return { ok: false, error: `x ${e.message}` };", "error: `failed: ${err}`,", "r = { ok: false, error: reasonOf(err, 300) };"]) assert.ok(scanAll(sample).length > 0, `the error-value scan catches: ${sample}`);
    assert.deepStrictEqual(scan("const t = err.message; // FR-066: read, not shown"), [], 'the marker exempts a line');
    assert.deepStrictEqual(scan("const t = err.message; // FR-066: shown masked (redact)"), [], 'the shown-masked marker exempts a line');
    assert.ok(scan("const t = err.message; // FR-066 read").length > 0, 'a wrong marker does not exempt');
    assert.deepStrictEqual(scan("return { ok: false, error: failText(err, 'x') };"), [], 'the scan leaves failText alone');
    assert.deepStrictEqual(scan('const n = e + 1; out[k] + e[k]; r.error + left; i < n + 1;').length, 1, 'the + pattern leaves a property, an index and a field alone (only `e + 1` counts)');
    assert.deepStrictEqual(scanAll("return { ok: false, error: cleanRemoteError(err) };"), [], 'the error-value scan leaves the masks alone');

    // 9. the remote control error (item 1): masked like a ShownError
    const { cleanRemoteError } = require('../src/shared/remote') as typeof import('../src/shared/remote');
    const rc = cleanRemoteError(new Error(`could not reach ${where} with ${token}`));
    assert.ok(rc.startsWith('could not reach ') && !rc.includes(token) && !rc.includes(os.homedir()), `cleanRemoteError masks a token and the home folder (got ${JSON.stringify(rc)})`);

    // 10. Durbar's own words stay useful (items 3-6): the workspace refusals; the installer, the undo and Claude's restart reason are in
    // test:officialinstall, test:checkpoints and test:claude-adapter
    const { resolveWorkspaceCwd } = require('../src/adapters/workspace') as typeof import('../src/adapters/workspace');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-ipcthrow-'));
    try {
      const plain = path.join(tmp, 'notes.txt');
      fs.writeFileSync(plain, 'x');
      const empty = path.join(tmp, 'empty.code-workspace');
      fs.writeFileSync(empty, JSON.stringify({ folders: [] }));
      const said = (f: string): string => { try { resolveWorkspaceCwd(f); return 'no error'; } catch (err) { return failText(err, 'test'); } };
      assert.ok(said(plain).startsWith('Not a folder or .code-workspace file: '), `a plain file: the window keeps the app's words (got ${JSON.stringify(said(plain))})`);
      assert.ok(said(empty).startsWith('No folders in workspace file: '), `an empty workspace file: the window keeps the app's words (got ${JSON.stringify(said(empty))})`);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

    // 11. the two exemptions that ARE shown (item 7): masked, honestly labelled
    const { shortReason } = require('../src/main/updatecheck') as typeof import('../src/main/updatecheck');
    assert.strictEqual(shortReason(new Error('timed out')), 'timed out', 'a short plain phrase is kept');
    assert.strictEqual(shortReason(new Error('getaddrinfo ENOTFOUND registry.npmjs.org')), 'network problem');
    const legacyKey = ['0123456789', 'abcdef0123', '456789abcd', 'ef01234567'].join('');
    assert.strictEqual(shortReason(new Error(legacyKey)), 'unexpected answer', 'a key-shaped word is never shown');
    assert.strictEqual(shortReason(new Error(`bad ${token}`)), 'unexpected answer', 'a token is never shown');
    const { safeGenerateError } = require('../src/main/ipc/characters') as typeof import('../src/main/ipc/characters');
    const gen = safeGenerateError(new Error(`failed reading ${where} with ${token}`), ['a cat']);
    assert.ok(!gen.includes(token) && !gen.includes(os.homedir()), `the character maker's error is masked (got ${JSON.stringify(gen)})`);
    console.log('test:ipcthrow OK');
  } finally {
    console.warn = realWarn;
    if (saved) require.cache[electronPath] = saved;
    else delete require.cache[electronPath];
  }
}

process.exitCode = 1;
main().then(() => { process.exitCode = 0; }, (err) => { console.error(err); process.exitCode = 1; });
