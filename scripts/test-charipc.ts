/**
 * The IPC of the character maker (spec 096 FR-020, FR-031..FR-033, SC-004, T035) through the real handlers and the real `ipcguard` on a stand-in electron, with a real store and
 * real settings in a temp folder. `npm run test:charipc`. No Electron, no network, no credits. The encoder window is Electron's, so a fake `encode` stands in (`check-charencoder` runs it).
 * The image adapter is a small stand-in that speaks to the fake Codex app-server (T032) over its wire and follows FR-001's contract: T031's real one does not exist yet.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { FakeCodexServer } from './fakes/codex-app-server';
import type { FakeChild, FakeImageMode } from './fakes/codex-app-server';
import * as ts from 'typescript';
import { CHARACTERS_WARN_AT, cleanCharacterName, parseEncoderReply, pinDecision } from '../src/shared/charrules';
import type { EncoderResult } from '../src/shared/charrules';
import { MARK_CLOSE, MARK_OPEN, SHEET_NAME } from '../src/shared/chargen';

type Handler = (e: unknown, ...a: unknown[]) => unknown;
type Rec = Record<string, unknown>;

const ROOT = path.join(__dirname, '..', '..');
const artDir = path.join(ROOT, 'src', 'renderer', 'crew', 'art');
const art = fs.readdirSync(artDir).filter((f) => f.endsWith('.webp')).slice(0, 4).map((f) => new Uint8Array(fs.readFileSync(path.join(artDir, f))));
const FACE = [[176, 150], [176, 150], [176, 150], [176, 150]];
const encodeOk = (): Promise<EncoderResult> => Promise.resolve(parseEncoderReply({ ok: true, frames: art, face: FACE }));

/** Names both copies of the rule must answer alike on (spec 096 FR-031; the review's invisible names first). */
const NAME_CORPUS = ['\u0DC1\u0DCA\u200D\u0DBB\u0DD3', '\u0D28\u0D4D\u200D', '\u0D28\u0D4D\u200D \u0D15', '\u0915\u094D\u200D\u0937', '\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645', '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}', '\u200C', '\u200D\u200C', '\u200D\u0D28', '\u200C\u0645', '\u0645\u200C', '\u0645\u200C \u0645', '\u0D4D\u200D', '\u0301\u200D\u0301', '\u034F\u200D\u034F', '\u3164\u200D\u3164', 'x\u0301\u200D', 'a\u200Cb', 'a\u200D\u0915', '\u0915\u200Da', '\u{E0067}\u{E007F}', 'a\u{E0067}\u{E007F}', '\u{1F3F4}\u{E0067}\u{E0062}', '\u{1D159}', 'Greta\u{1D159}', '\u200D', '\uFE0F', '\u034F', '\u3164', '\u2800', '\u115F', '\u1160', '\uFFA0', '\uFE00', '\u{E0100}', '\u0301', 'a\u200Db', '\u200Da', 'a\u200D', '\u{1F469}\u200D', '\u200D\u{1F4BB}', 'a\u200D\u{1F469}', '\u{1F469}\u200D\u{1F4BB}', '\u{1F469}\u{1F3FD}\u200D\u{1F4BB}', '\u2764\uFE0F', '1\uFE0F\u20E3', '\u{1F1E8}\u{1F1ED}', 'a\uFE0F', 'x\u0301', '\uE000', '\uD83D'];
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));
async function until(f: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const end = Date.now() + 30_000;
  while (Date.now() < end) { if (await f()) return; await new Promise((r) => setTimeout(r, 2)); }
  assert.fail('timed out waiting for ' + what);
}
const tempFolders = (): string[] => fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('durbar-img-'));

/** FR-001's contract, over the fake's wire: an empty `durbar-img-*` folder, thread and turn in it; a throw or a cancel removes the folder, a success leaves it for main. */
function imageAdapter(server: FakeCodexServer, log: string[]): Rec {
  return {
    id: 'codex',
    capabilities: { imageGen: true },
    generateImage: async (prompt: string, opts: { outName: string; signal?: AbortSignal; timeoutMs?: number }) => {
      log.push(prompt);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-img-'));
      const child = server.spawn('codex', ['app-server'], { env: {} } as never) as unknown as FakeChild;
      const lines: Array<Record<string, unknown>> = [];
      let buf = '';
      child.stdout.on('data', (d: unknown) => { buf += String(d); for (;;) { const i = buf.indexOf('\n'); if (i < 0) break; lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
      const send = (o: unknown): void => { child.stdin.write(JSON.stringify(o) + '\n'); };
      try {
        send({ id: 1, method: 'initialize', params: {} });
        send({ method: 'initialized' });
        send({ id: 2, method: 'thread/start', params: { cwd: dir, ephemeral: true, sandbox: 'workspace-write' } });
        await until(() => lines.some((l) => l.id === 2), 'thread/start');
        const tid = ((lines.find((l) => l.id === 2) as Rec).result as { thread: { id: string } }).thread.id;
        send({ id: 3, method: 'turn/start', params: { threadId: tid, input: [{ type: 'text', text: prompt }] } });
        await new Promise<void>((resolve, reject) => {
          const look = (): void => {
            if (opts.signal?.aborted) return reject(new Error('stopped'));
            if (lines.some((l) => l.method === 'turn/completed')) return resolve();
            setTimeout(look, 2);
          };
          look();
        });
        return { file: path.join(dir, opts.outName) };
      } catch (err) {
        fs.rmSync(dir, { recursive: true, force: true });
        throw err;
      } finally {
        child.stdin.end();
      }
    },
  };
}

async function main(): Promise<void> {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-charipc-'));
  // its own OS temp folder: this suite lists and removes `durbar-img-*` there, and other worktrees' runs share the real one
  const ownTemp = path.join(base, 'tmp');
  fs.mkdirSync(ownTemp);
  for (const k of ['TMPDIR', 'TEMP', 'TMP']) process.env[k] = ownTemp;
  assert.strictEqual(os.tmpdir(), ownTemp, 'os.tmpdir follows the environment');
  const electronPath = require.resolve('electron');
  const handlers = new Map<string, Handler>();
  const userData = path.join(base, 'userData');
  fs.mkdirSync(userData);
  let dialogAnswer: { canceled: boolean; filePaths: string[] } = { canceled: true, filePaths: [] };
  const fake = {
    ipcMain: { handle: (ch: string, fn: Handler) => handlers.set(ch, fn), on: () => undefined },
    app: { getVersion: () => '0.0.0-test', getPath: () => userData },
    dialog: { showOpenDialog: async () => dialogAnswer },
  };
  const saved = require.cache[electronPath];
  require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fake } as unknown as NodeJS.Module;
  // every console line, for SC-004
  const logged: string[] = [];
  const realConsole = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };
  for (const k of ['warn', 'error', 'info', 'debug'] as const) console[k] = (...a: unknown[]) => { logged.push(a.map(String).join(' ')); };
  const startTemps = new Set(tempFolders());
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    (require('../src/main/ipcguard') as typeof import('../src/main/ipcguard')).initSimGuard(false);
    const { SettingsStore } = require('../src/main/settings') as typeof import('../src/main/settings');
    const { register, sheetFolderOf, safeGenerateError } = require('../src/main/ipc/characters') as typeof import('../src/main/ipc/characters');
    const { register: registerSettings } = require('../src/main/ipc/settings') as typeof import('../src/main/ipc/settings');
    const { SIM_OPEN_CHANNELS } = require('../src/main/simguard') as typeof import('../src/main/simguard');
    /* eslint-enable @typescript-eslint/no-require-imports */

    const file = path.join(userData, 'durbar-settings.json');
    const settings = new SettingsStore(file);
    settings.load();
    const server: { current: FakeCodexServer } = { current: new FakeCodexServer({ imageMode: 'sheet' }) };
    const prompts: string[] = [];
    let adapter: Rec = imageAdapter(server.current, prompts);
    let openFolders = ['/work/app', '/work/site'];
    let encode: (b: Uint8Array, h: { width: number; height: number }, o: { signal?: AbortSignal }) => Promise<EncoderResult> = encodeOk;
    const devEnv: Rec = { DURBAR_PICK: path.join(base, 'export') };
    fs.mkdirSync(path.join(base, 'export'));
    const ipc = register({
      dev: devEnv as never,
      registry: { has: (id: string) => id === 'codex' || id === 'claude' } as never,
      router: { instance: (k: string) => (k === 'codex' ? adapter : { id: 'claude', capabilities: {}, generateText: () => undefined }) } as never,
      getSettingsStore: () => settings,
      openFolderKeys: () => openFolders,
      encode: (b, h, o) => encode(b, h, o),
      limits: { graceMs: 50, tryTtlMs: 200_000 },
    });
    registerSettings({ getSettingsStore: () => settings, getRunTheme: () => undefined, clearRunTheme: () => undefined, characterIds: () => ipc.ids() });

    const frame = { url: pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href };
    const win = { senderFrame: frame, sender: { mainFrame: frame } };
    const replies: string[] = []; // every reply in text, frames as sizes: SC-004 scans them
    const call = async (ch: string, ...a: unknown[]): Promise<Rec> => {
      const r = (await handlers.get(ch)!(win, ...a)) as Rec;
      replies.push(JSON.stringify(r, (_k, v) => (v instanceof Uint8Array ? v.length : v)));
      return r;
    };
    const mode = (m: FakeImageMode, extra: Rec = {}): void => { server.current = new FakeCodexServer({ imageMode: m, ...extra }); adapter = imageAdapter(server.current, prompts); };
    const CHANNELS = ['character:generate', 'character:cancel', 'character:save', 'character:list', 'character:frames', 'character:rename', 'character:delete', 'character:export', 'character:pin', 'character:ideas'];
    const noTemps = (what: string): void => assert.deepStrictEqual(tempFolders().filter((f) => !startTemps.has(f)), [], `${what}: no temp folder is left`);
    const DESC = 'a tall woman with round glasses';

    // --- the channels (FR-031) ---
    for (const c of CHANNELS) {
      assert.ok(handlers.has(c), c + ' is registered');
      assert.ok(!Object.prototype.hasOwnProperty.call(SIM_OPEN_CHANNELS, c), c + ' is not open to the simulator');
    }
    // not the app's own page, or a sub-frame of it: refused before the handler
    const otherPage = { url: 'https://example.invalid/' };
    const subFrame = { url: frame.url };
    for (const c of CHANNELS) {
      assert.throws(() => handlers.get(c)!({ senderFrame: otherPage, sender: { mainFrame: otherPage } }, DESC, 'codex'), /refused a call/, c + ' from another page');
      assert.throws(() => handlers.get(c)!({ senderFrame: subFrame, sender: { mainFrame: frame } }, DESC, 'codex'), /refused a call/, c + ' from a sub-frame');
      assert.throws(() => handlers.get(c)!({ senderFrame: null, sender: { mainFrame: frame } }, DESC, 'codex'), /refused a call/, c + ' with no frame');
    }
    assert.strictEqual(prompts.length, 0, 'none of those reached the adapter');

    // --- ideas and an empty list ---
    assert.strictEqual(((await call('character:ideas')) as unknown as string[]).length, 24);
    assert.deepStrictEqual(await call('character:list'), []);

    // --- refusals before any call (FR-011, FR-001, D1) ---
    for (const d of ['', 'a', '  ab ', '\n\n', 7, null, undefined, {}, ['a tall person']]) {
      const r = await call('character:generate', d, 'codex');
      assert.ok(r.ok === false && typeof r.error === 'string', 'a short description: ' + JSON.stringify(d));
    }
    for (const a of ['claude', 'copilot', 'nope', '__proto__', '', 7, null, undefined, {}]) {
      const r = await call('character:generate', DESC, a);
      assert.deepStrictEqual(r, { ok: false, error: 'This needs OpenAI Codex, installed and signed in with ChatGPT on this computer.' }, 'no image tool: ' + JSON.stringify(a));
    }
    {
      const NEEDS = { ok: false, error: 'This needs OpenAI Codex, installed and signed in with ChatGPT on this computer.' };
      const keep = adapter;
      let calls = 0;
      adapter = { id: 'codex', capabilities: { imageGen: false }, generateImage: () => { calls++; return Promise.reject(new Error('called')); } };
      assert.deepStrictEqual(await call('character:generate', DESC, 'codex'), NEEDS, 'imageGen false refuses even with the method');
      adapter = { id: 'codex', capabilities: {}, generateImage: () => { calls++; return Promise.reject(new Error('called')); } };
      assert.deepStrictEqual(await call('character:generate', DESC, 'codex'), NEEDS, 'a missing imageGen is false');
      assert.strictEqual(calls, 0, 'the method was not called');
      adapter = { id: 'codex', capabilities: { imageGen: true } };
      assert.deepStrictEqual(await call('character:generate', DESC, 'codex'), NEEDS, 'imageGen true with no method');
      adapter = keep;
    }
    assert.strictEqual(prompts.length, 0, 'none of those reached the adapter');

    // --- a whole try, on the fake app-server (US1) ---
    const first = await call('character:generate', DESC, 'codex');
    assert.ok(first.ok === true, 'made: ' + JSON.stringify(first.error));
    assert.ok(typeof first.tryId === 'string' && (first.tryId as string).length >= 16);
    assert.deepStrictEqual(Object.keys(first.frames as Rec), ['working', 'waiting', 'resting', 'blink']);
    assert.ok(typeof first.tookMs === 'number' && Array.isArray(first.notes));
    assert.ok(prompts[0].includes(`${MARK_OPEN}\n${DESC}\n${MARK_CLOSE}`), 'the description goes inside the markers');
    assert.strictEqual(server.current.requests('turn/start').length, 1, 'one call: no automatic retry (plan R7)');
    noTemps('after a good try');
    assert.deepStrictEqual(await call('character:list'), [], 'nothing is stored before Save');
    assert.deepStrictEqual(await call('character:save', 'nope', 'Greta'), { ok: false, error: 'That character is no longer held. Make it again.' }, 'an unknown tryId');
    for (const t of [undefined, null, 7, {}, '..', '../x']) assert.strictEqual((await call('character:save', t, 'Greta')).ok, false, 'tryId ' + JSON.stringify(t));
    for (const n of ['a\u0007b', 'a\nb', 'x'.repeat(41), 7, {}, ['x']]) assert.strictEqual((await call('character:save', first.tryId, n)).ok, false, 'name refused: ' + JSON.stringify(n));
    assert.deepStrictEqual(await call('character:list'), [], 'a refused name stores nothing');
    const sv = await call('character:save', first.tryId, 'Gre<ta>');
    assert.ok(sv.ok === true && /^my-[0-9a-f]{12}$/.test(sv.id as string) && sv.name === 'Greta', 'saved after the refusals (the try is kept): ' + JSON.stringify(sv));
    assert.strictEqual((await call('character:save', first.tryId, 'Again')).ok, false, 'a try saves once');
    const list = (await call('character:list')) as unknown as Rec[];
    assert.deepStrictEqual(Object.keys(list[0]).sort(), ['blink', 'created', 'face', 'id', 'name', 'style'], 'the fields of FR-031');
    assert.strictEqual(list[0].style, 'realistic-office-v1');
    const fr = await call('character:frames', sv.id);
    assert.ok(fr.ok === true && Buffer.compare(Buffer.from((fr.frames as Rec).working as Uint8Array), Buffer.from(art[0])) === 0);

    // --- an empty name gets My character N (US1 scenario 3) ---
    for (const n of ['', '   ', undefined, null, '<>']) {
      const t = await call('character:generate', DESC, 'codex');
      const s = await call('character:save', t.tryId, n);
      assert.ok(s.ok === true && /^My character \d+$/.test(s.name as string), 'name for ' + JSON.stringify(n) + ': ' + JSON.stringify(s));
      await call('character:delete', s.id);
    }

    // --- the try's life (FR-031) ---
    const t1 = await call('character:generate', DESC, 'codex');
    const t2 = await call('character:generate', DESC, 'codex');
    assert.notStrictEqual(t1.tryId, t2.tryId);
    assert.strictEqual((await call('character:save', t1.tryId, 'old')).ok, false, 'a new generate drops the first try');
    // a refused generate does not drop what is held...
    assert.strictEqual((await call('character:generate', 'a', 'codex')).ok, false);
    assert.deepStrictEqual(await call('character:cancel', 'nope'), { ok: false }, 'an unknown tryId');
    for (const t of [7, {}, '', '../x']) assert.deepStrictEqual(await call('character:cancel', t), { ok: false }, 'cancel ' + JSON.stringify(t));
    assert.deepStrictEqual(await call('character:cancel'), { ok: false }, 'no id with nothing running');
    assert.deepStrictEqual(await call('character:cancel', t2.tryId), { ok: true }, 'Discard');
    assert.strictEqual((await call('character:save', t2.tryId, 'x')).ok, false, 'a discarded try is gone');
    const before = ((await call('character:list')) as unknown as Rec[]).length;
    assert.strictEqual(before, 1, 'Discard stored nothing');
    // ...but a generate that started drops it even when it then fails: Try again does not leave the old picture saveable
    { const t3 = await call('character:generate', DESC, 'codex');
      mode('none');
      assert.strictEqual((await call('character:generate', DESC, 'codex')).ok, false);
      assert.strictEqual((await call('character:save', t3.tryId, 'old')).ok, false, 'the first try went when the new generate started');
      mode('sheet'); }

    // --- the bad cases of the image tool (FR-020, *Edge cases*, T032's modes) ---
    const failing: Array<[FakeImageMode, RegExp]> = [['none', /No picture came back/], ['other-name', /No picture came back/], ['text', /Not a PNG or WebP/], ['oversize', /too big/]];
    for (const [m, re] of failing) {
      mode(m);
      const r = await call('character:generate', DESC, 'codex');
      assert.ok(r.ok === false && re.test(r.error as string), `${m}: ${JSON.stringify(r)}`);
      assert.strictEqual(server.current.imageError, undefined, `${m}: the fake wrote what it should`);
      noTemps(m);
    }
    mode('two-files');
    assert.strictEqual((await call('character:generate', DESC, 'codex')).ok, true, 'two files: the expected one is read, the other ignored');
    noTemps('two-files');
    mode('symlink');
    { const r = await call('character:generate', DESC, 'codex');
      if (server.current.imageError) realConsole.log('test-charipc: no link rights here, the link case is skipped');
      else {
        assert.strictEqual(r.ok, false, 'a link is not followed'); // no deepStrictEqual on a reply that may hold frames: its diff is huge
        assert.strictEqual(r.error, 'No picture came back. Try again.');
        assert.ok(fs.existsSync(server.current.imageOutside[0]), 'what it points at is untouched');
      }
      for (const f of server.current.imageOutside) fs.rmSync(f, { force: true });
      noTemps('symlink'); }

    // --- the encoder's refusals and failures ---
    mode('sheet');
    encode = () => Promise.resolve({ ok: false, error: 'The poses did not come out separately. Try again.' });
    assert.deepStrictEqual(await call('character:generate', DESC, 'codex'), { ok: false, error: 'The poses did not come out separately. Try again.' });
    noTemps('an encoder refusal');
    let seenHeader: unknown; let tempDuringEncode: string[] = [];
    encode = (_b, h) => { seenHeader = h; tempDuringEncode = tempFolders().filter((f) => !startTemps.has(f)); return encodeOk(); };
    assert.strictEqual((await call('character:generate', DESC, 'codex')).ok, true);
    assert.deepStrictEqual(seenHeader, { width: 512, height: 512 }, "the encoder gets the header's size");
    assert.deepStrictEqual(tempDuringEncode, [], 'the temp folder is gone before the encoder starts');
    encode = encodeOk;

    // --- one at a time, cancel with no id, and a time limit (Q5, *Edge cases*) ---
    mode('hang');
    const running = call('character:generate', DESC, 'codex');
    await tick();
    assert.deepStrictEqual(await call('character:generate', DESC, 'codex'), { ok: false, error: 'One character at a time: wait for this one or cancel it.' }, 'a second press');
    await until(() => tempFolders().some((f) => !startTemps.has(f)), 'the running try');
    assert.deepStrictEqual(await call('character:cancel'), { ok: true }, 'cancel with no id ends the running generation');
    assert.deepStrictEqual(await running, { ok: false, cancelled: true });
    await until(() => tempFolders().every((f) => startTemps.has(f)), 'the folder to go');
    assert.ok(server.current.live.length === 0 || await (async () => { await until(() => server.current.live.length === 0, 'the child to go'); return true; })(), 'the child is closed');
    assert.deepStrictEqual(await call('character:cancel'), { ok: false }, 'nothing to cancel now');
    // an abort during the encoder
    mode('sheet');
    let inEncoder = false;
    encode = (_b, _h, o) => new Promise((resolve) => { inEncoder = true; o.signal?.addEventListener('abort', () => resolve({ ok: false, error: 'The picture could not be read. Try again.' })); });
    { const r = call('character:generate', DESC, 'codex');
      await until(() => inEncoder, 'the encoder to start');
      assert.deepStrictEqual(await call('character:cancel'), { ok: true });
      assert.deepStrictEqual(await r, { ok: false, cancelled: true }, 'a cancel during the encoder holds nothing'); }
    encode = encodeOk;
    noTemps('cancel during the encoder');
    // an adapter that ignores the cancel: main stops waiting, and its late folder still goes
    { let finish: (v: { file: string }) => void = () => undefined;
      const late = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-img-'));
      fs.writeFileSync(path.join(late, SHEET_NAME), 'x');
      adapter = { id: 'codex', capabilities: { imageGen: true }, generateImage: () => new Promise((res) => { finish = res; }) };
      const r = call('character:generate', DESC, 'codex');
      await tick();
      await call('character:cancel');
      assert.deepStrictEqual(await r, { ok: false, cancelled: true });
      finish({ file: path.join(late, SHEET_NAME) });
      await until(() => !fs.existsSync(late), 'the late folder to go'); }
    noTemps('a late result');

    // --- the returned path: only a sheet.png directly in a durbar-img-* folder of the OS temp folder is read or removed (coordinator's choice of 2026-10-31) ---
    {
      const sentinel = path.join(base, 'not-temp');
      fs.mkdirSync(sentinel);
      fs.writeFileSync(path.join(sentinel, SHEET_NAME), Buffer.from('x'));
      const nested = path.join(base, 'durbar-img-nested');
      fs.mkdirSync(nested);
      fs.writeFileSync(path.join(nested, SHEET_NAME), Buffer.from('x'));
      const wrongName = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-other-'));
      fs.writeFileSync(path.join(wrongName, SHEET_NAME), Buffer.from('x'));
      const right = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-img-'));
      fs.writeFileSync(path.join(right, 'other.png'), Buffer.from('x'));
      const hostile: unknown[] = [path.join(sentinel, SHEET_NAME), path.join(nested, SHEET_NAME), path.join(wrongName, SHEET_NAME), path.join(right, 'other.png'), [right, '..', path.basename(right), SHEET_NAME].join(path.sep), `${path.basename(right)}/${SHEET_NAME}`, path.join(os.tmpdir(), SHEET_NAME), '', null, undefined, 7, {}];
      for (const h of hostile) {
        assert.strictEqual(sheetFolderOf(h), null, 'refused: ' + String(h));
        adapter = { id: 'codex', capabilities: { imageGen: true }, generateImage: () => Promise.resolve({ file: h }) };
        assert.deepStrictEqual(await call('character:generate', DESC, 'codex'), { ok: false, error: 'No picture came back. Try again.' }, 'refused through the handler: ' + String(h));
      }
      adapter = { id: 'codex', capabilities: { imageGen: true }, generateImage: () => Promise.resolve(null) };
      assert.strictEqual((await call('character:generate', DESC, 'codex')).ok, false, 'a null result');
      assert.ok(fs.existsSync(path.join(sentinel, SHEET_NAME)) && fs.existsSync(path.join(nested, SHEET_NAME)) && fs.existsSync(path.join(wrongName, SHEET_NAME)) && fs.existsSync(path.join(right, 'other.png')), 'nothing outside the contract was removed');
      assert.strictEqual(sheetFolderOf(path.join(right, SHEET_NAME)), right, 'the contract itself passes');
      const linked = path.join(os.tmpdir(), `durbar-img-link${process.pid}`);
      let canLink = true;
      try { fs.symlinkSync(sentinel, linked); } catch { canLink = false; realConsole.log('test-charipc: no link rights here, the linked folder case is skipped'); }
      if (canLink) {
        assert.strictEqual(sheetFolderOf(path.join(linked, SHEET_NAME)), null, 'a linked folder is not a folder');
        fs.rmSync(linked);
      }
      fs.rmSync(wrongName, { recursive: true, force: true });
      fs.rmSync(right, { recursive: true, force: true });
    }
    // a thrown error, masked (FR-032)
    {
      const home = os.homedir();
      const raw = 'A Tall Woman With Round Glasses';
      // an echo inside JSON, once or twice: quotes, a backslash and a line break in the raw text (FR-032)
      const tricky = 'a "tall" woman\nwith a back\\slash';
      const cleanedTricky = 'a "tall" woman with a back\\slash';
      for (const form of [tricky, cleanedTricky, JSON.stringify(tricky), JSON.stringify(cleanedTricky), JSON.stringify(JSON.stringify(tricky)), JSON.stringify(JSON.stringify(cleanedTricky)), JSON.stringify(tricky.toUpperCase())]) {
        const out = safeGenerateError(new Error(`codex said: {"prompt":${form}}`), [tricky, cleanedTricky]);
        assert.ok(!/tall|woman|back/i.test(out), 'no echo left: ' + out);
      }
      const token = 'ghp_' + 'a1B2c3D4e5'.repeat(4);
      adapter = { id: 'codex', capabilities: { imageGen: true }, generateImage: () => Promise.reject(new Error(`refused "${DESC}" and ${raw} in ${home}/secret.txt with ${token} ${'x'.repeat(400)}`)) };
      const r = await call('character:generate', DESC, 'codex');
      const msg = r.error as string;
      assert.ok(r.ok === false && !msg.toLowerCase().includes(DESC), 'the description is removed, in any case: ' + msg);
      assert.ok(!msg.includes(home) && !msg.includes(token) && Array.from(msg).length <= 200, 'home and token masked, cut to 200: ' + msg);
      assert.strictEqual(safeGenerateError(new Error(DESC), [DESC]), 'Codex could not make the picture. Try again.', 'nothing but the echo');
      assert.strictEqual(safeGenerateError('not an error', [DESC]), 'Codex could not make the picture. Try again.');
      assert.strictEqual(safeGenerateError(new Error('no room (.*)'), ['(.*)']), 'no room [your description]', 'the description is literal text, not a pattern');
      assert.ok(!/woman/.test(safeGenerateError(new Error(`in ${JSON.stringify('a tall\nwoman')}`), ['a tall\nwoman'])), 'a JSON-escaped line break');
      const secretCut = safeGenerateError(new Error('x'.repeat(190) + ' ' + token), []);
      assert.ok(!secretCut.includes('ghp_a1B2'), 'masked before the cut: ' + secretCut);
    }

    // --- every id and name refusal changes nothing (US4 scenario 4) ---
    mode('sheet');
    const ours = list[0].id as string;
    const treeOf = (d: string): string[] => fs.readdirSync(d, { recursive: true, encoding: 'utf8' }).sort();
    const charsDir = path.join(userData, 'characters');
    const snapshot = treeOf(charsDir);
    const ids: unknown[] = ['my-000000000000', '..', '../..', '../characters', path.join('..', ours), ours + path.sep, ours + '\n', charsDir, '/etc/passwd', 'C:\\Windows', '', null, undefined, 7, {}, [ours], '__proto__'];
    for (const id of ids) {
      for (const c of ['character:frames', 'character:rename', 'character:delete', 'character:export']) {
        const r = await call(c, id, 'New name');
        assert.strictEqual(r.ok, false, `${c} with ${JSON.stringify(id)}`);
      }
      assert.strictEqual((await call('character:pin', '/work/app', id === null ? 7 : id)).ok, false, 'pin with ' + JSON.stringify(id));
    }
    for (const n of ['a\u0007b', 'a\nb', '', '  ', 'x'.repeat(41), 7, null, {}]) assert.strictEqual((await call('character:rename', ours, n)).ok, false, 'rename to ' + JSON.stringify(n));
    assert.deepStrictEqual(treeOf(charsDir), snapshot, 'nothing changed in the store');
    assert.deepStrictEqual(treeOf(path.join(base, 'export')), [], 'nothing was exported');
    assert.deepStrictEqual(await call('character:rename', ours, 'Greta B'), { ok: true, id: ours, name: 'Greta B' });

    // --- export through the pick (DURBAR_PICK), and the real dialog's answers ---
    {
      const r = await call('character:export', ours);
      assert.ok(r.ok === true && r.to === path.join(base, 'export', 'greta-b'), JSON.stringify(r));
      delete devEnv.DURBAR_PICK;
      assert.deepStrictEqual(await call('character:export', ours), { ok: false, cancelled: true }, 'a cancelled dialog');
      dialogAnswer = { canceled: false, filePaths: [path.join(base, 'export')] };
      assert.strictEqual((await call('character:export', ours)).to, path.join(base, 'export', 'greta-b (2)'));
      assert.ok(!/description|prompt/i.test(fs.readFileSync(path.join(base, 'export', 'greta-b', 'character.json'), 'utf8')));
    }

    // --- pins (FR-033, FR-031) ---
    {
      const pinned = await call('character:pin', '/work/app/', ours);
      assert.deepStrictEqual(pinned, { ok: true, pins: { '/work/app': ours } }, 'the key is normalised');
      assert.strictEqual((await call('settings:get') as Rec).characterMotion, true);
      assert.deepStrictEqual((await call('settings:get') as Rec).characterPins, { '/work/app': ours });
      assert.strictEqual((await call('character:pin', '/closed/folder', ours)).ok, false, 'a folder that is not open');
      for (const k of ['', 'relative/path', '..', '../x', '__proto__', 'constructor', '/a\nb', '/' + 'x'.repeat(5000), null, undefined, 7, {}, ['/work/app']]) assert.strictEqual((await call('character:pin', k, ours)).ok, false, 'key ' + JSON.stringify(k));
      assert.strictEqual((await call('character:pin', '/work/site')).ok, false, 'no second argument is not a clear');
      assert.deepStrictEqual(new SettingsStore(file).load().characterPins, { '/work/app': ours }, 'on disk, unchanged by the refusals');
      assert.strictEqual(Object.getPrototypeOf({}).polluted, undefined);
      // the folder closed: the pin stays and can be cleared (*Edge cases*)
      openFolders = [];
      assert.deepStrictEqual((await call('settings:get') as Rec).characterPins, { '/work/app': ours }, 'the pin stays');
      assert.deepStrictEqual(await call('character:pin', '/work/app', null), { ok: true, pins: {} }, 'and can be cleared');
      assert.strictEqual(new SettingsStore(file).load().characterPins, undefined, 'an empty map is not written');
      openFolders = ['/work/app', '/work/site', '/work/third'];
      await call('character:pin', '/work/app', ours);
      await call('character:pin', '/work/site', ours);
      // validated on read: unknown ids are dropped, junk in the file too
      const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
      onDisk.characterPins['/work/gone'] = 'my-ffffffffffff';
      onDisk.characterPins['relative'] = ours;
      onDisk.characterPins['/work/bad'] = '../../x';
      fs.writeFileSync(file, JSON.stringify(onDisk));
      settings.load();
      assert.deepStrictEqual((await call('settings:get') as Rec).characterPins, { '/work/app': ours, '/work/site': ours }, 'only pins to listed ids');
      // a pin that replied ok is one that a restart reads back: Windows keys, whatever this machine is (the drive root normalises to `c:`)
      {
        const quick = new Map<string, Handler>();
        const keepHandle = fake.ipcMain.handle;
        fake.ipcMain.handle = (ch: string, fn: Handler) => quick.set(ch, fn);
        const winFile = path.join(base, 'win-settings.json');
        const winSettings = new SettingsStore(winFile);
        winSettings.load();
        const winIpc = register({
          dev: {} as never, registry: { has: () => true } as never, router: { instance: () => adapter } as never, getSettingsStore: () => winSettings, encode: encodeOk, platform: 'win32',
          openFolderKeys: () => ['C:\\', 'C:\\Work\\App', '\\\\srv\\share\\repo', 'D:/x/'],
        });
        fake.ipcMain.handle = keepHandle;
        const q = async (...a: unknown[]): Promise<Rec> => (await quick.get('character:pin')!(win, ...a)) as Rec;
        const want: Record<string, string> = {};
        for (const [asked, stored] of [['C:\\', 'c:'], ['c:/', 'c:'], ['C:\\work\\app\\', 'c:/work/app'], ['\\\\SRV\\share\\repo', '//srv/share/repo'], ['d:\\X', 'd:/x']] as const) {
          want[stored] = ours;
          const r = await q(asked, ours);
          assert.deepStrictEqual(r, { ok: true, pins: want }, 'pinned ' + asked);
          assert.deepStrictEqual(new SettingsStore(winFile).load().characterPins, want, 'a restart reads it back: ' + asked);
        }
        assert.strictEqual((await q('C:\\Other', ours)).ok, false, 'a folder that is not open');
        assert.strictEqual((await q('C:relative', ours)).ok, false, 'a drive-relative path');
        assert.deepStrictEqual((await q('C:\\', null)).ok, true, 'a drive root can be cleared');
        assert.ok(!('c:' in (new SettingsStore(winFile).load().characterPins ?? {})), 'and stays cleared');
        assert.strictEqual(winIpc.ids().includes(ours), true);
      }
      // the cap of 500
      const many = Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`/f/${i}`, ours]));
      fs.writeFileSync(file, JSON.stringify({ version: 1, characterPins: many }));
      settings.load();
      assert.strictEqual(Object.keys(settings.characterPinsOf([ours])).length, 500, 'at most 500 are read');
      assert.deepStrictEqual((await call('character:pin', '/work/third', ours)).ok, false, 'a new one past the cap is refused');
      openFolders = [...openFolders, '/f/1'];
      assert.strictEqual((await call('character:pin', '/f/1', ours)).ok, true, 'changing one is not a new one');
      fs.writeFileSync(file, JSON.stringify({ version: 1, characterPins: { '/work/app': ours, '/work/site': ours } }));
      settings.load();
      // deleting a character removes its pins and says how many
      const t = await call('character:generate', DESC, 'codex');
      const other = await call('character:save', t.tryId, 'Other');
      await call('character:pin', '/work/third', other.id);
      assert.deepStrictEqual(await call('character:delete', ours), { ok: true, pinsRemoved: 2 });
      assert.deepStrictEqual((await call('settings:get') as Rec).characterPins, { '/work/third': other.id }, "the other's pin stays");
      assert.ok(!fs.existsSync(path.join(charsDir, ours)));
      assert.deepStrictEqual(await call('character:delete', other.id), { ok: true, pinsRemoved: 1 });
    }

    // --- Motion (FR-060) ---
    assert.deepStrictEqual(await call('settings:setCharacterMotion', false), { ok: true, characterMotion: false });
    assert.strictEqual(new SettingsStore(file).load().characterMotion, false, 'survives a restart');
    for (const j of ['false', 0, null, undefined, {}]) assert.deepStrictEqual(await call('settings:setCharacterMotion', j), { ok: true, characterMotion: false }, 'junk keeps it: ' + JSON.stringify(j));
    assert.deepStrictEqual(await call('settings:setCharacterMotion', true), { ok: true, characterMotion: true });
    assert.ok(!('characterMotion' in JSON.parse(fs.readFileSync(file, 'utf8'))), 'the default is not written');

    // --- many characters: no limit in main (owner's principle of 2026-10-31; the window warns) ---
    {
      for (let i = 0; i < 24; i++) { const t = await call('character:generate', DESC, 'codex'); assert.strictEqual((await call('character:save', t.tryId, `C${i}`)).ok, true); }
      const r = await call('character:generate', DESC, 'codex');
      assert.ok(r.ok === true && r.full === undefined, `the 25th is made: ${r.ok}`);
      assert.strictEqual((await call('character:save', r.tryId, 'one more')).ok, true, 'and kept');
      assert.strictEqual(((await call('character:list')) as unknown as Rec[]).length, 25);
      for (const c of (await call('character:list')) as unknown as Rec[]) await call('character:delete', c.id);
    }

    // --- a try is dropped after its time, and a shutdown cancels (FR-031, *Edge cases*) ---
    {
      const quick = new Map<string, Handler>();
      const keepHandle = fake.ipcMain.handle;
      fake.ipcMain.handle = (ch: string, fn: Handler) => quick.set(ch, fn);
      const small = register({
        dev: {} as never, registry: { has: () => true } as never, router: { instance: () => adapter } as never, getSettingsStore: () => settings, openFolderKeys: () => [], encode: encodeOk, limits: { generateMs: 1000, graceMs: 50, tryTtlMs: 20 },
      });
      fake.ipcMain.handle = keepHandle;
      const q = async (ch: string, ...a: unknown[]): Promise<Rec> => (await quick.get(ch)!(win, ...a)) as Rec;
      mode('sheet');
      const t = await q('character:generate', DESC, 'codex');
      assert.strictEqual(t.ok, true);
      // a refused name says which: "no longer held" only once the try is gone
      await until(async () => /no longer held/.test(String((await q('character:save', t.tryId, 'a\u0007b')).error)), 'the try to go after its time');
      // main's own time limit, for an adapter that never answers
      adapter = { id: 'codex', capabilities: { imageGen: true }, generateImage: () => new Promise(() => undefined) };
      assert.deepStrictEqual(await q('character:generate', DESC, 'codex'), { ok: false, error: 'Codex took too long. Try again.' });
      // a shutdown
      let aborted = false;
      adapter = { id: 'codex', capabilities: { imageGen: true }, generateImage: (_p: string, o: { signal: AbortSignal }) => new Promise(() => o.signal.addEventListener('abort', () => { aborted = true; })) };
      const r = q('character:generate', DESC, 'codex');
      await tick();
      small.shutdown();
      assert.ok(aborted, 'the generation is cancelled on quit, at once');
      await r;
      // and a held try does not outlive it
      mode('sheet');
      const heldTry = await q('character:generate', DESC, 'codex');
      small.shutdown();
      assert.strictEqual((await q('character:save', heldTry.tryId, 'x')).ok, false, 'nothing is saved after a quit');
    }

    // --- SC-004: a marker description appears in no file, log line or later reply ---
    {
      const marker = 'zebra-striped-marker-person-4711';
      mode('sheet');
      const startReplies = replies.length;
      logged.length = 0;
      const made = await call('character:generate', marker, 'codex');
      assert.ok(made.ok === true && prompts[prompts.length - 1].includes(marker), 'the marker reached the prompt, and only there');
      const s = await call('character:save', made.tryId, 'Marker test');
      await call('character:list');
      await call('character:frames', s.id);
      await call('character:rename', s.id, 'Marker test 2');
      await call('settings:get');
      await call('character:export', s.id);
      mode('none');
      await call('character:generate', marker, 'codex');
      adapter = { id: 'codex', capabilities: { imageGen: true }, generateImage: () => Promise.reject(new Error(`refused ${marker}`)) };
      const failed = await call('character:generate', marker, 'codex');
      assert.ok(failed.ok === false, 'a failing try');
      assert.ok(!replies.slice(startReplies).join('\n').includes(marker), 'in no reply');
      assert.ok(!logged.join('\n').includes(marker), 'in no log line');
      const scan = (d: string): void => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) scan(p);
          else assert.ok(!fs.readFileSync(p).includes(marker), 'in no file: ' + e.name);
        }
      };
      scan(userData);
      scan(path.join(base, 'export'));
    }

    // --- the source (FR-032, SC-003) ---
    {
      const src = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipc', 'characters.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      const logs = [...src.matchAll(/console\.\w+\(([^\n]*?)\)\)?;?\s*$/gm)].map((m) => m[1]);
      assert.deepStrictEqual(logs, ['`[characters] ${m}`'], 'the one log line is the store\'s own');
      assert.ok(!/\bshell\b|child_process|nativeImage/.test(src), 'no shell, no process, no decoder here');
      assert.ok(/fromApp\(e\)/.test(src));
      const preload = fs.readFileSync(path.join(ROOT, 'src', 'preload', 'preload.ts'), 'utf8');
      for (const c of CHANNELS) assert.ok(preload.includes(`'${c}'`), `the preload calls ${c}`);
    }
    // the simulator's copy of the name rule answers like main's (agent notes: rules the simulator copies; T038)
    {
      const sim = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'sim.ts'), 'utf8');
      const block = /\/\* simcharname:begin[\s\S]*?\*\/([\s\S]*?)\/\* simcharname:end \*\//.exec(sim)?.[1];
      assert.ok(block, 'the marked block is there');
      const js = ts.transpileModule(block as string, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
      const simRule = new Function(`${js}; return simCharacterName;`)() as (r: unknown) => unknown;
      for (const v of [...NAME_CORPUS, 'Greta', '  Greta B ', '<b>x</b>', '{y}', '<>', '', ' ', 'x'.repeat(40), 'x'.repeat(41), 'x'.repeat(161), '\u{1F600}'.repeat(40), '\u{1F469}\u200D\u{1F4BB}', 'a\nb', 'a\u0007b', 'a\u202Eb', 'a\u200Bb', 'a\u2028b', 7, null, undefined, {}]) {
        assert.deepStrictEqual(simRule(v), cleanCharacterName(v), 'the same answer for ' + JSON.stringify(v));
      }
    }
    // and its copy of the pin rule (finding of the review: closed folders, UNC paths)
    {
      const sim = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'sim.ts'), 'utf8');
      const block = /\/\* simcharpin:begin[\s\S]*?\*\/([\s\S]*?)\/\* simcharpin:end \*\//.exec(sim)?.[1];
      assert.ok(block, 'the marked pin block is there');
      const js = ts.transpileModule(block as string, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
      const simPin = new Function(`${js}; return simPinDecision;`)() as typeof pinDecision;
      const known = (x: unknown): boolean => x === 'my-0123456789ab';
      const keys: unknown[] = ['~/', '/work/app', '/work/app/', '/closed', '~/work/blog', '~/work/none', 'C:\\', 'c:', 'c:/', 'C:\\Work\\', 'C:relative', '\\\\srv\\share', '//srv/share', '/', '', ' ', 'relative', '..', '../x', '__proto__', '/a\nb', '/' + 'x'.repeat(5000), null, undefined, 7, {}];
      for (const platform of ['win32', 'linux', 'darwin']) {
        const ctx = { known, platform, open: ['/work/app', '~/work/blog', 'C:\\', 'c:/work', '\\\\srv\\share'] };
        for (const k of keys) for (const id of ['my-0123456789ab', 'my-ffffffffffff', null, undefined, 7]) assert.deepStrictEqual(simPin(k, id, ctx), pinDecision(k, id, ctx), `the same answer for ${JSON.stringify(k)}, ${String(id)} on ${platform}`);
      }
      assert.deepStrictEqual(pinDecision('/closed', null, { known, platform: 'linux', open: [] }), { ok: true, key: '/closed' }, 'a closed folder can be cleared');
      assert.strictEqual(pinDecision('/closed', 'my-0123456789ab', { known, platform: 'linux', open: [] }).ok, false, 'not set');
      assert.strictEqual(pinDecision('~/', null, { known, platform: 'linux', open: [] }).ok, false, 'what normalises to a key the file would drop is refused, not answered ok');
    }
    noTemps('at the end');
    realConsole.log('test-charipc: ok');
  } finally {
    Object.assign(console, realConsole);
    if (saved) require.cache[electronPath] = saved;
    else delete require.cache[electronPath];
    fs.rmSync(base, { recursive: true, force: true });
  }
}
process.exitCode = 1;
/* ---- T041a, FR-034: the window's login gate. It fails closed; `check-charmaker` runs it in the page. ---- */
async function loginGateTests(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const CM = require(path.join(ROOT, 'src', 'renderer', 'charmaker.js')) as {
    loginGate(k: unknown): string; readLoginKind(b: unknown, id: string): Promise<string>; availability(k: unknown): { state: string; kinds: unknown[] };
    gatedGenerate(o: { bridge: unknown; description: string; adapterId: string; confirm: () => unknown }): Promise<{ state: string; error?: string; reply?: Promise<unknown> }>;
    API_KEY_REFUSED: string; NEEDS_CODEX: string; NOT_YET: string; MANY_AT: number;
  };
  assert.strictEqual(CM.MANY_AT, CHARACTERS_WARN_AT, 'the window warns at the shared number');
  assert.strictEqual(CM.loginGate('chatgpt'), 'go');
  assert.strictEqual(CM.loginGate('apikey'), 'refuse');
  for (const k of ['unknown', 'ChatGPT', 'chatgpt ', 'api', '', null, undefined, 0, true, {}, ['chatgpt'], '__proto__']) assert.strictEqual(CM.loginGate(k), 'ask', `anything else asks: ${JSON.stringify(k)}`);
  const bridgeOf = (kind: unknown, opts: { throws?: boolean; none?: boolean } = {}) => {
    const calls: unknown[][] = [];
    const b: Rec = { characterGenerate: async (...a: unknown[]) => { calls.push(a); return { ok: true }; } };
    if (!opts.none) b.characterLoginKind = async () => { if (opts.throws) throw new Error('no'); return kind; };
    return { b, calls };
  };
  assert.strictEqual(await CM.readLoginKind(bridgeOf('x', { none: true }).b, 'codex'), 'unknown', 'no answer: unknown, as the real app today');
  assert.strictEqual(await CM.readLoginKind(bridgeOf('x', { throws: true }).b, 'codex'), 'unknown', 'an error: unknown');
  assert.strictEqual(await CM.readLoginKind(bridgeOf({ kind: 'chatgpt' }).b, 'codex'), 'unknown', 'a strange answer: unknown');
  assert.strictEqual(await CM.readLoginKind(null, 'codex'), 'unknown');
  const go = (b: unknown, confirm: () => unknown) => CM.gatedGenerate({ bridge: b, description: 'a person', adapterId: 'codex', confirm });
  // a refusal and a Cancel make no generate call, whatever the question would say
  for (const [kind, opts] of [['apikey', {}]] as [unknown, Rec][]) {
    const { b, calls } = bridgeOf(kind, opts);
    let asked = 0;
    const r = await go(b, () => { asked++; return true; });
    assert.deepStrictEqual([r.state, r.error, asked, calls.length], ['refused', CM.API_KEY_REFUSED, 0, 0], 'apikey: refused, not even asked, no call');
  }
  for (const [kind, opts] of [['unknown', {}], ['nonsense', {}], [null, { none: true }], [null, { throws: true }]] as [unknown, Rec][]) {
    for (const answer of [false, null, undefined, 'go', 1, {}, () => { throw new Error('dialog failed'); }]) {
      const { b, calls } = bridgeOf(kind, opts);
      const r = await go(b, typeof answer === 'function' ? answer as () => unknown : () => answer);
      assert.deepStrictEqual([r.state, calls.length], ['declined', 0], `${String(kind)}: only an exact true goes on (${String(answer)})`);
    }
    const { b, calls } = bridgeOf(kind, opts);
    let asked = 0;
    const r = await go(b, () => { asked++; return true; });
    await r.reply;
    assert.deepStrictEqual([r.state, asked], ['started', 1], `${String(kind)}: Make it goes on`);
    assert.deepStrictEqual(calls, [['a person', 'codex', { confirmed: true }]], 'with this try\'s own answer');
  }
  {
    const { b, calls } = bridgeOf('chatgpt');
    let asked = 0;
    const r = await go(b, () => { asked++; return false; });
    await r.reply;
    assert.deepStrictEqual([r.state, asked, calls], ['started', 0, [['a person', 'codex', { confirmed: false }]]], 'chatgpt: no question');
  }
  // the kind is read on every try: a login that changes between tries is not remembered
  {
    let kind = 'chatgpt';
    const seen: number[] = [];
    const b = { characterLoginKind: async () => kind, characterGenerate: async () => { seen.push(1); return {}; } };
    await (await go(b, () => false)).reply;
    kind = 'apikey';
    assert.strictEqual((await go(b, () => true)).state, 'refused');
    assert.strictEqual(seen.length, 1, 'no second call');
  }
  // what the dialog can say
  assert.strictEqual(CM.availability([]).state, 'off');
  assert.strictEqual(CM.availability(null).state, 'off');
  assert.strictEqual(CM.availability([{ id: 'codex', state: 'ready', capabilities: {} }, { id: 'claude', state: 'ready', capabilities: { imageGen: false } }, { id: 'x', state: 'ready', capabilities: { imageGen: 'yes' } }, null]).state, 'off', 'ready apps without imageGen: it cannot make one, and says so');
  assert.strictEqual(CM.availability([{ id: 'codex', state: 'too-old', capabilities: { imageGen: true } }]).state, 'needs');
  assert.deepStrictEqual(CM.availability([{ id: 'codex', state: 'ready', capabilities: { imageGen: true } }, { id: 'c', state: 'ready', capabilities: {} }]).kinds, [{ id: 'codex', state: 'ready', capabilities: { imageGen: true } }], 'Made by: only imageGen');
  assert.ok(!/sign|install/i.test(CM.NOT_YET), 'the words for "cannot yet" suggest no step that would not help');
  // the renderer has one way to the generate call: inside the gate
  const rendererDir = path.join(ROOT, 'src', 'renderer');
  const callers = fs.readdirSync(rendererDir).filter((f) => f.endsWith('.js')).filter((f) => /characterGenerate/.test(fs.readFileSync(path.join(rendererDir, f), 'utf8')));
  assert.deepStrictEqual(callers, ['charmaker.js'], 'only charmaker.js names the call');
  const cmSrc = fs.readFileSync(path.join(rendererDir, 'charmaker.js'), 'utf8');
  assert.strictEqual((cmSrc.match(/\.characterGenerate\(/g) ?? []).length, 1, 'once');
  assert.ok(/async function gatedGenerate[\s\S]*?\.characterGenerate\(description, adapterId, \{ confirmed \}\)[\s\S]*?\n  \}\n/.test(cmSrc), 'in gatedGenerate');
  // outside the simulator main refuses whatever the window sends, until T030a gates it: no real adapter may switch imageGen on before that
  const adapters = path.join(ROOT, 'src', 'adapters');
  const charIpc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipc', 'characters.ts'), 'utf8');
  if (!/characterLoginKind|loginKindOf|FR-034 gate in main/.test(charIpc)) {
    for (const f of fs.readdirSync(adapters).filter((n) => n.endsWith('.ts'))) {
      const src = fs.readFileSync(path.join(adapters, f), 'utf8');
      assert.ok(!/imageGen:\s*true/.test(src), `${f}: T030a before T030: no adapter sets imageGen until main enforces FR-034`);
      assert.ok(!/^\s*(async\s+)?generateImage\s*\(/m.test(src) || f === 'types.ts', `${f}: no real generateImage until T030a`);
    }
  }
}

// a generation that never ends would keep the polls above alive for ever: the suite fails instead of hanging `npm test`
setTimeout(() => { console.error('test-charipc: timed out'); process.exit(1); }, 120_000).unref();
main().then(loginGateTests).then(() => { process.exitCode = 0; process.exit(0); }, (e) => { console.error(e); process.exit(1); });
