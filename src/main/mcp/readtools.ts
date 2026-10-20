/**
 * Durbar MCP read tools, spec 041 T016 and T053 [FR-010..FR-013, FR-043, FR-053, FR-054, SC-001, SC-004]. A factory over injected
 * getters: no Electron and no I/O of its own. Imports: `import * as path from 'path'` (pure path functions only), `adapterOf` (a pure function) and the `SavedFolder` type from `../folders`
 * (which pulls in `fs` and `path` only), `../../shared/*` (`redact` for the masking) and `./tools`, `./agentstate` (types). Every
 * answer is built field by field from main's in-memory state, so a value that is not named here cannot reach a client. No prompts,
 * chat text, env or header values; secrets in `command`, `args` and `url` are masked, and an absolute path outside the saved folders
 * is reduced to `…/<base name>` (T053, D2). No AI credits, no runtime call.
 */
import * as path from 'path';
import type { AgentInfo, McpAmbientView, McpState, PermMode } from '../../shared/api';
import type { AppSettings } from '../../shared/credits';
import { GROUND } from '../../shared/floors';
import type { FloorsDoc } from '../../shared/floors';
import type { McpServerView } from '../../shared/mcp';
import { maskSecretArgs, maskSecretUrl, parseFlag, redact, splitCommand } from '../../shared/redact';
import { officeTotals } from '../../shared/usagedoc';
import type { UsageNumbers, UsageTotalsDoc } from '../../shared/usagedoc';
import type { SavedFolder } from '../folders';
import { adapterOf } from '../folders';
import type { AgentStateView } from './agentstate';
import { READ_TOOLS } from './tools';
import type { ToolHandlers, ToolResult } from './tools';

/** What the tools read. Every member is a plain getter so tests (and the simulator) can inject their own state. */
export interface ReadToolsDeps {
  /** Saved folders (`FolderStore.load()` result, kept in memory). */
  folders(): readonly SavedFolder[];
  /** Live agents in main (the `agents` map), one per folder. */
  agents(): readonly AgentInfo[];
  /** The office state tracker (T014). `ensure` runs before `get`, so an agent that never produced an event still has a state. */
  tracker: { ensure(id: string, lazy?: boolean): void; get(id: string): AgentStateView | undefined };
  /** `FolderStore.floors()`. */
  floors(): FloorsDoc;
  /** `UsageTotalsStore`: `view()` already holds the baseline plus every usage event of this run. */
  usage: { view(): UsageTotalsDoc; keyFor(folderKey: string): string };
  /** `SettingsStore.load()`-like snapshot. */
  settings(): AppSettings;
  /** The Copilot CLI list (`cliServers` plus the secrets flag). */
  mcpCli(): Pick<McpState, 'cli' | 'file' | 'secretsPersist'>;
  /** The extras of one saved folder (`McpStore.list`). */
  mcpExtras(folderKey: string): readonly McpServerView[];
  /** The window runs `DURBAR_SIM`: its agents exist only in the window, so the server cannot see them. */
  windowSim(): boolean;
  /** The OS the paths belong to (`process.platform`); injected so the path rule is tested for all three from any OS (constitution VI). */
  platform: NodeJS.Platform;
  /** Secret values stored for one folder's extras (`McpStore`, main only). Replaced in that folder's `command`, `args` and `url`; never put in any view. */
  extraSecretValues(folderKey: string): readonly string[];
}

/** Shown when `windowSim()` is true. */
export const SIM_NOTE = 'The Durbar window is running DURBAR_SIM: its simulated agents live only in the window and are not visible to this server. The answers below cover the real state in the main process only.';

const MODE_NAMES: Record<PermMode, string> = { 'read-only': 'Read-only', ask: 'Ask first', allow: 'Allow all' };
const modeName = (m: unknown): string => MODE_NAMES[m as PermMode] ?? 'Read-only';

const json = (v: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(v, null, 2) }] });
const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const nanoToAiu = (n: number): number => Math.round(n / 1e4) / 1e5; // 5 decimals of AIU
const numbers = (n: UsageNumbers) => ({ calls: n.calls, inTokens: n.inTokens, outTokens: n.outTokens, aiu: nanoToAiu(n.nano), nano: n.nano, unreportedCalls: n.unreported });
const folderKeyOf = (a: AgentInfo): string => a.workspaceFile ?? a.cwd;

/** Key names only, never values: the one place an env or header entry is turned into output. */
const keyNames = (l: readonly { key: string; set: boolean }[] | undefined): { key: string; set: boolean }[] => (l ?? []).map((e) => ({ key: redact(e.key), set: e.set === true }));

const OUTSIDE = '\u2026/';
const ABS_POSIX = /^\/+[^/\\]+[/\\]+[^/\\]/; // two segments or more: a one-segment `/name` is a Windows-style flag
const ABS_WIN = /^(?:[A-Za-z]:[\\/]|\\\\)/; // drive path, UNC or `\\?\`
const ABS_HOME = /^~[^/\\]*[/\\]/; // `~/x` and `~other/x`

/**
 * Pure path reducer (T053, D2). Returns a function that turns an arg (or a command token) into its display form: an absolute path
 * (POSIX with two segments or more, drive, UNC, `~/`) that is not the saved folder itself or below it becomes `…/<base name>`, also
 * as a flag value (`--config=/x/y`, `--config /x/y`) or a `NAME=value` value. "Inside" uses `path.win32` or `path.posix` by `platform`,
 * case-insensitive on Windows and macOS, exact on Linux; a `.code-workspace` counts as its directory. Paths inside a longer arg
 * (`type=bind,src=/x/y`), `$HOME` and `%USERPROFILE%` forms and relative paths are not reduced (`[KNOWN GAP]`).
 */
export function makePathReducer(savedFolders: readonly string[], platform: NodeJS.Platform): (arg: string) => string {
  const mod = platform === 'win32' ? path.win32 : path.posix;
  const fold = platform === 'win32' || platform === 'darwin';
  const norm = (p: string): string => { const n = mod.normalize(p); return fold ? n.toLowerCase() : n; };
  const roots: string[] = [];
  for (const f of savedFolders) {
    if (typeof f !== 'string' || !mod.isAbsolute(f)) continue;
    roots.push(norm(/\.code-workspace$/i.test(f) ? mod.dirname(f) : f));
  }
  const inside = (p: string): boolean => {
    if (!mod.isAbsolute(p)) return false; // `relative` would resolve it against the working directory
    const n = norm(p);
    return roots.some((r) => {
      const rel = mod.relative(r, n);
      return rel === '' || (rel !== '..' && !rel.startsWith('..' + mod.sep) && !mod.isAbsolute(rel));
    });
  };
  const isAbs = (v: string): boolean => ABS_POSIX.test(v) || ABS_WIN.test(v) || ABS_HOME.test(v);
  // The base name stops at the first whitespace, so `C:\\a\\b.exe serve token=x` in one string never carries its arguments along.
  const base = (v: string): string => (v.split(/[\\/]/).filter(Boolean).pop() ?? v).split(/\s/)[0];
  const reduceAbs = (v: string): string => (!ABS_HOME.test(v) && inside(v) ? v : OUTSIDE + base(v));
  const reduceValue = (v: string): string => {
    const fu = /^file:\/\/(?:localhost)?(\/[\s\S]*)$/i.exec(v); // a file URL: its path goes through the same rule
    if (fu) {
      let p = fu[1];
      try { p = decodeURIComponent(p); } catch { /* keep it raw */ }
      if (/^\/[A-Za-z]:[\\/]/.test(p)) p = p.slice(1);
      return isAbs(p) || /^[A-Za-z]:/.test(p) ? (!ABS_HOME.test(p) && inside(p) ? v : 'file://' + OUTSIDE + base(p)) : v;
    }
    if (isAbs(v)) return reduceAbs(v);
    const kv = /^([A-Za-z_][A-Za-z0-9_.-]{0,127})=([\s\S]*)$/.exec(v);
    return kv && isAbs(kv[2]) ? `${kv[1]}=${reduceAbs(kv[2])}` : v;
  };
  return (arg) => {
    const f = arg.startsWith('-') || arg.startsWith('/') ? parseFlag(arg) : undefined;
    return f && f.rest !== undefined ? `${f.name}${f.sep}${reduceValue(f.rest)}` : f ? arg : reduceValue(arg);
  };
}

/** Replace a folder's stored secret values (longest first); values under 4 characters are skipped, since they would mangle every string. */
function replaceValues(text: string, values: readonly string[]): string {
  let t = text;
  for (const v of [...values].filter((x) => typeof x === 'string' && x.length >= 4).sort((x, y) => y.length - x.length)) if (t.includes(v)) t = t.split(v).join('[redacted]');
  return t;
}

/** The masking of `command`, `args` and `url` for one folder's server (T053): stored secret values, secret shapes, then outside paths. */
function maskers(deps: ReadToolsDeps, folderKey?: string) {
  const values = folderKey === undefined ? [] : deps.extraSecretValues(folderKey);
  const reduce = makePathReducer(deps.folders().map((f) => f.workspace), deps.platform);
  return {
    command: (c: string | undefined): string | undefined => (c === undefined ? undefined : maskSecretArgs(splitCommand(replaceValues(c, values))).map(reduce).join(' ')),
    args: (a: readonly string[] | undefined): string[] | undefined => (a === undefined ? undefined : maskSecretArgs(a.map((x) => replaceValues(String(x ?? ''), values))).map(reduce)),
    url: (u: string | undefined): string | undefined => (u === undefined ? undefined : reduce(maskSecretUrl(replaceValues(u, values)))),
  };
}

function cliView(s: McpAmbientView, m: ReturnType<typeof maskers>) {
  return { name: s.name, origin: s.origin, transport: s.transport, command: m.command(s.command), args: m.args(s.args), url: m.url(s.url), enabled: s.enabled };
}

function extraView(s: McpServerView, m: ReturnType<typeof maskers>) {
  return {
    name: s.name, transport: s.transport, enabled: s.enabled, trusted: s.trusted, needsSecrets: s.needsSecrets,
    command: m.command(s.command), args: m.args(s.args), url: m.url(s.url),
    envKeys: keyNames(s.env), headerKeys: keyNames(s.headers),
  };
}

export function createReadToolHandlers(deps: ReadToolsDeps): ToolHandlers {
  const withNote = <T extends object>(o: T): T & { note?: string } => (deps.windowSim() ? { ...o, note: SIM_NOTE } : o);
  const floorOnMap = (): Map<string, boolean> => new Map(deps.floors().floors.map((f) => [f.id, f.on]));
  const floorOn = (m: Map<string, boolean>, id: string | undefined): boolean => m.get(id ?? GROUND) ?? true;

  const handlers: ToolHandlers = {
    durbar_list_folders: () => {
      const on = floorOnMap();
      const counts = new Map<string, number>();
      for (const a of deps.agents()) counts.set(folderKeyOf(a), (counts.get(folderKeyOf(a)) ?? 0) + 1);
      const folders = deps.folders().map((f) => ({
        key: f.workspace,
        name: f.label ?? baseName(f.workspace),
        floor: f.floor ?? GROUND,
        floorOn: floorOn(on, f.floor),
        hidden: f.hidden === true,
        door: f.closed ? 'closed' : 'open',
        adapter: adapterOf(f),
        mode: modeName(f.permMode),
        cap: f.maxAiCredits ?? null,
        agents: counts.get(f.workspace) ?? 0,
      }));
      return json(withNote({ folders }));
    },

    durbar_list_agents: () => {
      const on = floorOnMap();
      const agents = deps.agents().map((a) => {
        deps.tracker.ensure(a.id, a.lazy === true);
        const st = deps.tracker.get(a.id);
        return {
          id: a.id,
          name: a.label ?? a.name,
          folder: folderKeyOf(a),
          floor: a.floor ?? GROUND,
          floorOn: floorOn(on, a.floor),
          hidden: a.hidden === true,
          adapter: a.adapterId,
          mode: modeName(a.permMode),
          model: a.model ?? null,
          cap: a.maxAiCredits ?? null,
          state: st?.word ?? 'Idle',
          subLabel: st?.subLabel ?? null,
          lazy: a.lazy === true,
        };
      });
      return json(withNote({ agents }));
    },

    durbar_list_floors: () => {
      const d = deps.floors();
      return json({ floors: d.floors.map((f) => ({ id: f.id, name: f.name, on: f.on, ground: f.id === GROUND })), lastFloor: d.lastFloor });
    },

    durbar_usage_totals: () => {
      const doc = deps.usage.view();
      const known = new Map<string, string>();
      for (const f of deps.folders()) known.set(deps.usage.keyFor(f.workspace), f.workspace);
      const folders = Object.entries(doc.folders).map(([fp, f]) => {
        const path = known.get(fp); // only a saved folder's path is ever returned
        return { name: f.name, ...(path === undefined ? {} : { path }), ...numbers(f) };
      });
      return json({ since: doc.since, office: numbers(officeTotals(doc)), folders });
    },

    durbar_settings: () => {
      const s = deps.settings();
      return json({
        defaultCap: s.defaultMaxAiCredits ?? null,
        seriousMode: s.seriousMode === true,
        placeMap: { ...(s.placeMap ?? {}) },
        customPlaces: (s.customPlaces ?? []).map((p) => ({ id: p.id, name: p.name, icon: p.icon })),
      });
    },

    durbar_mcp_state: () => {
      const c = deps.mcpCli();
      const extras = deps.folders().map((f) => { const m = maskers(deps, f.workspace); return { folder: f.workspace, servers: deps.mcpExtras(f.workspace).map((x) => extraView(x, m)) }; }).filter((e) => e.servers.length > 0);
      const cliMask = maskers(deps);
      return json({ copilotCli: { servers: c.cli.map((x) => cliView(x, cliMask)), file: { label: c.file.label, found: c.file.found, skipped: c.file.skipped }, secretsPersist: c.secretsPersist }, extras });
    },

    // Stub until T031 (the change queue): nothing can have been requested yet, so there is no status to give.
    durbar_request_status: () => json({ available: false, message: 'Change requests are not available yet in this build, so there is no request status to report.' }),
  };

  // The handler set must cover exactly the read tools the registry lists.
  for (const t of READ_TOOLS) if (!handlers[t.name]) throw new Error(`read tool without a handler: ${t.name}`);
  return handlers;
}
