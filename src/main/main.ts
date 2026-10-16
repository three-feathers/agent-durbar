import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CopilotAdapter } from '../adapters/copilot';
import { resolveWorkspaceCwd } from '../adapters/workspace';
import { MAX_ATTACH_BYTES, MAX_ATTACH_FILES, fmtSize, stageAttachment } from '../shared/attachments';
import type { AddResult, AgentInfo, PermMode, PickedFile } from '../shared/api';
import { openInVSCode } from './vscode';

// Cheapest routing on the logged-in account's only model ("auto"); see docs/milestone-1.md.
const DEFAULT_MODEL = 'auto';
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

const adapter = new CopilotAdapter();
const agents = new Map<string, AgentInfo>();
/** Files the user picked through the native dialog; only these can be attached. */
const pickedFiles = new Set<string>();
/** Private folder for pasted / dropped files (removed on quit). */
let stageDir: string | undefined;
const getStageDir = (): string => (stageDir ??= fs.mkdtempSync(path.join(os.tmpdir(), 'agent-durbar-att-')));
const sizeOf = (p: string): number | undefined => {
  try {
    return fs.statSync(p).size;
  } catch {
    return undefined;
  }
};
let win: BrowserWindow | undefined;

const toRenderer = (channel: string, payload: unknown): void => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

adapter.onEvent((e) => toRenderer('agent:event', e));

// Dev/test: DURBAR_LOG=/path/events.jsonl records every normalized event and what is sent to the SDK.
if (process.env.DURBAR_LOG) {
  const logFile = process.env.DURBAR_LOG;
  const write = (o: unknown): void => fs.appendFileSync(logFile, JSON.stringify(o) + '\n');
  adapter.onEvent((e) => write({ t: Date.now(), event: e }));
  adapter.debug = (m) => write({ t: Date.now(), debug: m });
}

async function addWorkspace(workspace: string, permMode: PermMode): Promise<AgentInfo> {
  const ws = resolveWorkspaceCwd(workspace);
  const id = await adapter.start({
    workspace,
    model: DEFAULT_MODEL,
    autoTier: 'efficiency',
    allow: permMode === 'allow',
    ask: permMode === 'ask',
  });
  const info: AgentInfo = {
    id,
    name: path.basename(ws.workspaceFile ?? ws.cwd).replace(/\.code-workspace$/, ''),
    cwd: ws.cwd,
    workspaceFile: ws.workspaceFile,
    folders: ws.folders,
    permMode,
    model: DEFAULT_MODEL,
  };
  agents.set(id, info);
  toRenderer('agent:added', info);
  return info;
}

async function addMany(paths: string[], permMode: PermMode): Promise<AddResult> {
  const added: AgentInfo[] = [];
  const errors: string[] = [];
  for (const p of paths) {
    try {
      added.push(await addWorkspace(p, permMode));
    } catch (err) {
      errors.push(`${path.basename(p)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { ok: errors.length === 0, agents: added, error: errors.join('; ') || undefined };
}

const validMode = (m: unknown): PermMode => (m === 'ask' || m === 'allow' ? m : 'read-only');

ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('agents:list', () => [...agents.values()]);

ipcMain.handle('agents:addFolder', async (_e, mode: unknown) => {
  const r = await dialog.showOpenDialog({ title: 'Add folder', properties: ['openDirectory', 'multiSelections'] });
  return r.canceled ? { ok: true, agents: [] } : addMany(r.filePaths, validMode(mode));
});

ipcMain.handle('agents:addWorkspaceFile', async (_e, mode: unknown) => {
  const r = await dialog.showOpenDialog({
    title: 'Add .code-workspace file',
    properties: ['openFile'],
    filters: [{ name: 'VS Code workspace', extensions: ['code-workspace'] }],
  });
  return r.canceled ? { ok: true, agents: [] } : addMany(r.filePaths, validMode(mode));
});

ipcMain.handle('agents:pickAttachments', async (): Promise<PickedFile[]> => {
  // Dev/test hook: DURBAR_PICK="/a.txt:/b.png" answers the picker without a native dialog.
  const preset = (process.env.DURBAR_PICK ?? '').split(path.delimiter).filter((p) => p && fs.existsSync(p));
  if (preset.length) {
    return preset.map((p) => {
      pickedFiles.add(p);
      return { path: p, name: path.basename(p), kind: IMAGE_EXT.has(path.extname(p).toLowerCase()) ? 'image' : 'file', size: sizeOf(p) };
    });
  }
  const r = await dialog.showOpenDialog({ title: 'Attach files or images', properties: ['openFile', 'multiSelections'] });
  if (r.canceled) return [];
  return r.filePaths.map((p) => {
    pickedFiles.add(p);
    return { path: p, name: path.basename(p), kind: IMAGE_EXT.has(path.extname(p).toLowerCase()) ? 'image' : 'file', size: sizeOf(p) };
  });
});

ipcMain.handle('agents:stageAttachment', (_e, name: unknown, mime: unknown, data: unknown) => {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : undefined;
  if (!bytes) return { ok: false, error: 'No file data.' };
  try {
    const r = stageAttachment(getStageDir(), String(name ?? ''), String(mime ?? ''), bytes);
    if (!r.ok) return r;
    pickedFiles.add(r.path);
    return { ok: true, file: { path: r.path, name: r.name, kind: r.kind, size: r.size } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('agents:send', async (_e, id: string, text: string, attachments: PickedFile[]) => {
  if (!agents.has(id)) return { ok: false, error: 'unknown agent' };
  const safe = (Array.isArray(attachments) ? attachments : []).filter((a) => pickedFiles.has(a.path));
  // Caps are enforced here too, not only in the UI.
  if (safe.length > MAX_ATTACH_FILES) return { ok: false, error: `Up to ${MAX_ATTACH_FILES} attachments per message (got ${safe.length}).` };
  for (const a of safe) {
    const size = sizeOf(a.path);
    if (size === undefined) return { ok: false, error: `"${a.name}" is no longer available.` };
    if (size > MAX_ATTACH_BYTES) return { ok: false, error: `"${a.name}" is ${fmtSize(size)}, over the ${fmtSize(MAX_ATTACH_BYTES)} per-file limit.` };
  }
  try {
    await adapter.send(id, {
      text: String(text),
      attachments: safe.map((a) => ({ path: a.path, kind: a.kind === 'image' ? 'image' : 'file' })),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('agents:stop', async (_e, id: string) => {
  if (agents.has(id)) await adapter.stop(id);
});

ipcMain.handle('agents:resolvePermission', (_e, id: string, requestId: string, approve: boolean, remember?: boolean) => {
  if (agents.has(id)) adapter.resolvePermission(id, String(requestId), approve === true, approve === true && remember === true);
});

ipcMain.handle('agents:revokeGrant', (_e, id: string, key: string) => {
  if (agents.has(id)) adapter.revokeGrant(id, String(key));
});

ipcMain.handle('agents:openInVSCode', (_e, id: string) => {
  const a = agents.get(id);
  // Only paths of agents we started: the workspace file if there is one, else the folder.
  return a ? openInVSCode(a.workspaceFile ?? a.cwd) : { ok: false, error: 'unknown agent' };
});

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    useContentSize: true,
    title: 'Agent Durbar',
    backgroundColor: '#f6f1e7',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // DURBAR_SIM=N: simulated live agents (fake events, no sessions, no AI credits). See src/renderer/sim.ts.
  const sim = parseInt(process.env.DURBAR_SIM ?? '', 10);
  const query: Record<string, string> = {};
  if (sim > 0) {
    query.sim = String(sim);
    if (process.env.DURBAR_SIM_FREEZE === '1') query.simfreeze = '1';
    if (process.env.DURBAR_SIM_ROOMS) query.simrooms = process.env.DURBAR_SIM_ROOMS;
  }
  void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { query });
  // Dev: DURBAR_SHOT=/tmp/out.png [DURBAR_SHOT_SIZE=1280x800] [DURBAR_SHOT_CLICK=sim-1] saves a screenshot and quits.
  const shot = process.env.DURBAR_SHOT;
  if (shot) {
    const m = /^(\d+)x(\d+)$/.exec(process.env.DURBAR_SHOT_SIZE ?? '');
    if (m) win.setContentSize(Number(m[1]), Number(m[2]));
    const w = win;
    w.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const click = process.env.DURBAR_SHOT_CLICK;
        if (click) {
          await w.webContents.executeJavaScript(`document.querySelector('[data-id=${JSON.stringify(click)}]')?.click()`);
          await new Promise((r) => setTimeout(r, 600));
        }
        const img = await w.webContents.capturePage();
        fs.writeFileSync(shot, img.toPNG());
        app.quit();
      }, 1800);
    });
  }
}

app.whenReady().then(() => {
  createWindow();
  // Dev/headless convenience: DURBAR_OPEN="/path/a:/path/b" starts agents (read-only) on launch.
  const open = (process.env.DURBAR_OPEN ?? '').split(path.delimiter).filter((p) => p && fs.existsSync(p));
  if (open.length) void addMany(open, validMode(process.env.DURBAR_PERM));
  // Dev/test: DURBAR_DRIVER=/path/driver.js runs a UI-driving script against the real window + adapter.
  // The module exports async (ctx) => void with ctx = { win, addMany, shot(file), js(code), sleep(ms), waitFor(expr, ms) }.
  if (process.env.DURBAR_DRIVER) {
    const ctx = {
      get win() {
        return win as BrowserWindow;
      },
      addMany,
      js: <T>(code: string): Promise<T> => (win as BrowserWindow).webContents.executeJavaScript(code, true) as Promise<T>,
      sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
      shot: async (file: string) => fs.writeFileSync(file, (await (win as BrowserWindow).webContents.capturePage()).toPNG()),
      waitFor: async (expr: string, ms = 120000) => {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          if (await (win as BrowserWindow).webContents.executeJavaScript(`!!(${expr})`)) return true;
          await new Promise((r) => setTimeout(r, 300));
        }
        return false;
      },
    };
    win?.webContents.once('did-finish-load', () => {
      const driver = require(process.env.DURBAR_DRIVER as string) as (c: typeof ctx) => Promise<void>;
      void driver(ctx).catch((err) => console.error('DRIVER FAILED', err)).finally(() => void adapter.dispose().finally(() => app.exit(0)));
    });
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  if (stageDir) fs.rmSync(stageDir, { recursive: true, force: true });
});

app.on('window-all-closed', () => {
  void adapter.dispose().finally(() => {
    if (process.platform !== 'darwin') app.quit();
  });
});
