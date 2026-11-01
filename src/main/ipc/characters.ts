/**
 * IPC for the AI character maker and My characters (spec 096 FR-020, FR-031..FR-033, FR-035). Main decides: the window sends only a description, an adapter id, a
 * `tryId`, an id main listed, a name, or a folder key; no text from the window becomes a path. Every channel is owner-only (`fromApp`) and none is open to the simulator.
 * The description goes to the adapter once, inside the prompt, and is never stored, logged or kept in an error (D3, FR-032, SC-004). A try is held only in memory.
 * `[KNOWN GAP]` a partial echo of the description in an error is not recognised: only the whole text (raw or cleaned, plain or JSON-escaped) is removed.
 * `[KNOWN GAP]` FR-034's login gate is not enforced here yet: no adapter reports `imageGen`, so nothing can run. T030a must add it here before Codex's `imageGen` turns on.
 */
import { app } from 'electron';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fromAppFrame as fromApp, ipcHandle } from '../ipcguard';
import type { AdapterRegistry } from '../../adapters/registry';
import type { AdapterRouter } from '../../adapters/router';
import { CHARACTER_IDEAS, SHEET_NAME, buildCharacterPrompt, cleanDescription } from '../../shared/chargen';
import { DEFAULT_STYLE_ID } from '../../shared/charstyle';
import { MAX_CHARACTERS, cleanCharacterName, pinDecision } from '../../shared/charrules';
import type { EncoderResult, FaceSet, FrameSet } from '../../shared/charrules';
import { MAX_IMAGE_BYTES, checkImage } from '../../shared/imagecheck';
import { maskHomePaths, redactMarkdown } from '../../shared/redact';
import { encodeSheet } from '../charencoder';
import type { EncodeOptions } from '../charencoder';
import { CharacterStore } from '../charstore';
import type { DevEnv } from '../devhooks';
import { pickFolder } from '../pickfolder';
import type { SettingsStore } from '../settings';

export const GENERATE_TIMEOUT_MS = 300_000;
const TRY_TTL_MS = 10 * 60_000;
/** Past the adapter's own time limit, main stops waiting for it too. */
const GUARD_GRACE_MS = 10_000;
const MAX_ERROR = 200;
/** Only the cleaned text (300 code points) goes to the adapter; a longer raw input is not searched for. */
const MAX_ECHO_INPUT = 4000;
const NEEDS_CODEX = 'This needs OpenAI Codex, installed and signed in with ChatGPT on this computer.';
const NO_PICTURE = 'No picture came back. Try again.';
const COULD_NOT = 'Codex could not make the picture. Try again.';
const REFUSED = { ok: false, error: 'Agent Durbar refused a call that did not come from its own window.' };

export interface CharactersIpcDeps {
  dev: DevEnv;
  registry: AdapterRegistry;
  router: AdapterRouter;
  /** Created when the app is ready: read when a handler runs. */
  getSettingsStore(): SettingsStore | undefined;
  /** FR-031: the keys of the folders open now; a pin can only be set on one of them. */
  openFolderKeys(): string[];
  /** Tests: the encoder window is Electron's, so `test:charipc` replaces it (`check-charencoder` runs the real one). */
  encode?: (bytes: Uint8Array, header: { width: number; height: number }, opts: EncodeOptions) => Promise<EncoderResult>;
  /** Tests: the platform whose folder keys are normalised (default this one's). */
  platform?: string;
  /** Tests: shorter limits. */
  limits?: { generateMs?: number; graceMs?: number; tryTtlMs?: number };
}

export interface CharactersIpc {
  /** The ids main lists now (FR-033: a pin to anything else is dropped on read). */
  ids(): string[];
  /** Edge cases, the app quits during a generation: it is cancelled and nothing is saved. */
  shutdown(): void;
}

interface HeldTry { tryId: string; frames: FrameSet; face: FaceSet; style: string; timer: ReturnType<typeof setTimeout> }

/**
 * FR-020, plan step 3 (coordinator's choice of 2026-10-31): the folder a returned file sits in, only when it is directly in the OS temp folder, a real folder and named
 * `durbar-img-*`, and the file is `sheet.png`. Only such a folder is read from and removed; anything else is refused and left alone.
 */
export function sheetFolderOf(file: unknown, tmpRoot: string = os.tmpdir()): string | null {
  if (typeof file !== 'string' || !path.isAbsolute(file) || path.normalize(file) !== file || path.basename(file) !== SHEET_NAME) return null;
  const parent = path.dirname(file);
  if (!/^durbar-img-[A-Za-z0-9_-]+$/.test(path.basename(parent))) return null;
  try {
    if (fs.realpathSync(path.dirname(parent)) !== fs.realpathSync(tmpRoot)) return null;
    return fs.lstatSync(parent).isDirectory() ? parent : null;
  } catch {
    return null;
  }
}

type SheetRead = { ok: true; bytes: Uint8Array } | { ok: false; error: string };
/** FR-020: the expected file only: `lstat` of a regular file (no link), at most 20 MB, read once into memory. */
function readSheet(file: string): SheetRead {
  let fd: number | undefined;
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile()) return { ok: false, error: NO_PICTURE };
    if (st.size > MAX_IMAGE_BYTES) return { ok: false, error: 'The picture is too big.' };
    const { O_RDONLY, O_NOFOLLOW, O_NONBLOCK } = fs.constants;
    fd = fs.openSync(file, O_RDONLY | (O_NOFOLLOW ?? 0) | (O_NONBLOCK ?? 0));
    const now = fs.fstatSync(fd);
    if (!now.isFile() || now.ino !== st.ino || now.size > MAX_IMAGE_BYTES) return { ok: false, error: NO_PICTURE };
    const bytes = Buffer.alloc(now.size);
    let got = 0;
    while (got < bytes.length) {
      const n = fs.readSync(fd, bytes, got, bytes.length - got, got);
      if (n <= 0) return { ok: false, error: NO_PICTURE };
      got += n;
    }
    return { ok: true, bytes };
  } catch {
    return { ok: false, error: NO_PICTURE };
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* closed */ }
  }
}

/** The forms an echo of the text can take: as it is, and JSON-escaped once or twice (as a log or an error wrapping another error carries it; the same idea as `maskHomePaths`). */
const echoForms = (d: string): string[] => { const once = JSON.stringify(d).slice(1, -1); return [d, once, JSON.stringify(once).slice(1, -1)]; };
/** FR-032: what a failed try says. The description is removed first (any case, escaped forms too), then secrets and home folders are masked, and the cut comes last, so nothing is left half-masked. */
export function safeGenerateError(err: unknown, description: readonly string[]): string {
  let s = err instanceof Error && typeof err.message === 'string' ? err.message : '';
  const forms = [...new Set(description.filter(Boolean).flatMap(echoForms))].sort((a, b) => b.length - a.length);
  for (const d of forms) s = s.replace(new RegExp(d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[your description]');
  s = maskHomePaths(redactMarkdown(s, s)).replace(/\s+/g, ' ').trim();
  if (!s.replace(/\[your description\]/g, '').trim()) return COULD_NOT;
  return Array.from(s).slice(0, MAX_ERROR).join('');
}

class Cancelled extends Error {}

export function register(deps: CharactersIpcDeps): CharactersIpc {
  const { dev, registry, router, getSettingsStore, openFolderKeys } = deps;
  const store = new CharacterStore(path.join(app.getPath('userData'), 'characters'), (m) => console.warn(`[characters] ${m}`));
  const encode = deps.encode ?? encodeSheet;
  const generateMs = deps.limits?.generateMs ?? GENERATE_TIMEOUT_MS;
  const graceMs = deps.limits?.graceMs ?? GUARD_GRACE_MS;
  const tryTtlMs = deps.limits?.tryTtlMs ?? TRY_TTL_MS;
  let running: AbortController | null = null;
  let held: HeldTry | null = null;
  const drop = (): void => {
    if (held) clearTimeout(held.timer);
    held = null;
  };
  const removeTemp = (folder: string | null): void => {
    if (folder) try { fs.rmSync(folder, { recursive: true, force: true }); } catch { /* the OS temp folder gets it */ }
  };
  const ids = (): string[] => store.list().map((c) => c.id);

  /* FR-031, FR-020..FR-023: one try. The temp folder is gone before the encoder starts, on every path. */
  ipcHandle('character:generate', async (e, description: unknown, adapterId: unknown) => {
    if (!fromApp(e)) return REFUSED;
    if (running) return { ok: false, error: 'One character at a time: wait for this one or cancel it.' };
    const clean = cleanDescription(description);
    if (!clean.ok) return { ok: false, error: clean.reason };
    const kind = typeof adapterId === 'string' && registry.has(adapterId) ? adapterId : undefined;
    const ad = kind ? router.instance(kind) : undefined;
    if (!ad || ad.capabilities?.imageGen !== true || typeof ad.generateImage !== 'function') return { ok: false, error: NEEDS_CODEX };
    if (store.list().length >= MAX_CHARACTERS) return { ok: false, error: `You have ${MAX_CHARACTERS} characters, the most Durbar keeps. Delete one first.`, full: true };
    drop();
    const ctl = new AbortController();
    running = ctl;
    const started = Date.now();
    let timedOut = false;
    const guard = setTimeout(() => { timedOut = true; ctl.abort(); }, generateMs + graceMs);
    try {
      const result = await new Promise<{ file: string }>((resolve, reject) => {
        let over = false;
        ctl.signal.addEventListener('abort', () => { if (!over) { over = true; reject(new Cancelled()); } }, { once: true });
        ad.generateImage!(buildCharacterPrompt(clean.text), { outName: SHEET_NAME, timeoutMs: generateMs, signal: ctl.signal }).then(
          (r) => { if (over) removeTemp(sheetFolderOf(r?.file)); else { over = true; resolve(r); } }, // a late result after a cancel: its folder still goes
          (err) => { if (!over) { over = true; reject(err); } },
        );
      });
      const folder = sheetFolderOf(result?.file);
      if (!folder) return { ok: false, error: NO_PICTURE };
      let sheet: SheetRead;
      try {
        sheet = readSheet(path.join(folder, SHEET_NAME));
      } finally {
        removeTemp(folder);
      }
      if (!sheet.ok) return { ok: false, error: sheet.error };
      const head = checkImage(sheet.bytes);
      if (!head.ok) return { ok: false, error: head.reason };
      const enc = await encode(sheet.bytes, { width: head.width, height: head.height }, { signal: ctl.signal });
      if (ctl.signal.aborted) throw new Cancelled();
      if (!enc.ok) return { ok: false, error: enc.error };
      const tryId = randomBytes(12).toString('hex');
      const timer = setTimeout(() => { if (held?.tryId === tryId) drop(); }, tryTtlMs);
      timer.unref?.();
      held = { tryId, frames: enc.frames, face: enc.face, style: DEFAULT_STYLE_ID, timer };
      return { ok: true, tryId, frames: enc.frames, face: enc.face, notes: enc.notes, tookMs: Date.now() - started };
    } catch (err) {
      if (err instanceof Cancelled) return timedOut ? { ok: false, error: 'Codex took too long. Try again.' } : { ok: false, cancelled: true };
      return { ok: false, error: safeGenerateError(err, typeof description === 'string' && description.length <= MAX_ECHO_INPUT ? [description, clean.text] : [clean.text]) };
    } finally {
      clearTimeout(guard);
      running = null;
    }
  });
  /* coordinator's choice of 2026-10-31: no id cancels the running generation (its tryId does not exist yet); a tryId drops that held try */
  ipcHandle('character:cancel', (e, tryId: unknown) => {
    if (!fromApp(e)) return REFUSED;
    if (tryId === undefined || tryId === null) {
      if (!running) return { ok: false };
      running.abort();
      return { ok: true };
    }
    if (!held || tryId !== held.tryId) return { ok: false };
    drop();
    return { ok: true };
  });
  ipcHandle('character:save', (e, tryId: unknown, name: unknown) => {
    if (!fromApp(e)) return REFUSED;
    if (!held || typeof tryId !== 'string' || tryId !== held.tryId) return { ok: false, error: 'That character is no longer held. Make it again.' };
    let finalName = '';
    if (name !== undefined && name !== null && (typeof name !== 'string' || name.trim() !== '')) {
      const checked = cleanCharacterName(name);
      if (!checked.ok) {
        // only `<`, `>`, `{`, `}`: as good as empty, so it gets "My character N" (US1 scenario 3); a real refusal stays one
        if (typeof name === 'string' && name.replace(/[<>{}\s]/g, '') === '') finalName = '';
        else return checked;
      } else finalName = checked.name;
    }
    const r = store.save({ frames: held.frames, face: held.face, style: held.style }, finalName);
    if (r.ok) drop(); // a failed save keeps the try, so it can be saved again
    return r;
  });
  ipcHandle('character:list', (e) => {
    if (!fromApp(e)) return [];
    return store.list().map(({ id, name, face, blink, style, created }) => ({ id, name, face, blink, style, created }));
  });
  ipcHandle('character:frames', (e, id: unknown) => {
    if (!fromApp(e)) return REFUSED;
    return store.frames(id);
  });
  ipcHandle('character:rename', (e, id: unknown, name: unknown) => {
    if (!fromApp(e)) return REFUSED;
    return store.rename(id, name);
  });
  /* FR-033: deleting a character removes its pins; the reply counts them (US4 scenario 2) */
  ipcHandle('character:delete', (e, id: unknown) => {
    if (!fromApp(e)) return REFUSED;
    const r = store.delete(id);
    if (!r.ok) return r;
    return { ok: true, pinsRemoved: getSettingsStore()?.removeCharacterPins(id as string) ?? 0 };
  });
  ipcHandle('character:export', async (e, id: unknown) => {
    if (!fromApp(e)) return REFUSED;
    if (!store.has(id)) return { ok: false, error: 'That character is not in the list.' };
    const dir = await pickFolder(dev, 'Export the character to…', true);
    if (!dir) return { ok: false, cancelled: true };
    return store.export(id, dir);
  });
  /* FR-033, FR-031: the rule is `pinDecision`, shared with the simulator's copy */
  ipcHandle('character:pin', (e, folderKey: unknown, id: unknown) => {
    if (!fromApp(e)) return REFUSED;
    const settings = getSettingsStore();
    if (!settings) return { ok: false, error: 'The pin could not be saved.' };
    const d = pinDecision(folderKey, id, { known: (x) => store.has(x), open: openFolderKeys(), platform: deps.platform ?? process.platform });
    if (!d.ok) return d;
    const ok = settings.setCharacterPin(d.key, id as string | null);
    return ok ? { ok: true, pins: settings.characterPinsOf(ids()) } : { ok: false, error: 'The pin could not be saved.' };
  });
  ipcHandle('character:ideas', (e) => {
    if (!fromApp(e)) return [];
    return CHARACTER_IDEAS.slice();
  });
  return {
    ids,
    shutdown: () => { running?.abort(); drop(); },
  };
}
