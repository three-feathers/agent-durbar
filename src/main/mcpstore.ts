/**
 * Agent Durbar's own optional MCP servers ("extras"), kept **per folder/workspace** (spec 020; spec 019 had one global list): one
 * small JSON file in userData. The only global list is the user's `~/.copilot/mcp-config.json`, which this store never touches. No Electron import: the secret codec is injected
 * (Electron `safeStorage` in main.ts, a fake in tests).
 *
 * Secrets (env values, header values) are encrypted with the codec before they are written. Without a codec they are NOT written
 * (key names only); they stay in memory for this run and the user is told. Views for the renderer never contain a secret value.
 */
import * as fs from 'fs';
import * as path from 'path';
import { MAX_SERVERS, trustHash, validateInput } from '../shared/mcp';
import type { McpSecretKey, McpServerInput, McpServerSpec, McpServerView, McpTransport, McpTrustInfo } from '../shared/mcp';

export interface SecretCodec {
  available(): boolean;
  encrypt(plain: string): string;
  decrypt(blob: string): string;
}

interface SecretEntry {
  key: string;
  /** Plain value in memory (main process only); undefined = not available (not persisted, or could not be decrypted). */
  value?: string;
}

interface Rec {
  name: string;
  transport: McpTransport;
  enabled: boolean;
  command?: string;
  args?: string[];
  workingDirectory?: string;
  url?: string;
  tools?: string[];
  trust?: string;
  env: SecretEntry[];
  headers: SecretEntry[];
}

export interface StoreResult {
  ok: boolean;
  error?: string;
  view?: McpServerView;
  /** Enabling needs the user's confirmation of this command/URL first. */
  needsTrust?: McpTrustInfo;
}

export interface SessionMcp {
  mcpServers: Record<string, McpServerSpec>;
  disabledMcpServers: string[];
  /** Servers that are on but were not passed, with the reason (shown in Settings). */
  skipped: { name: string; reason: string }[];
}

const MAX_FILE = 2 * 1024 * 1024;
const MAX_FOLDERS = 200;
const MAX_KEY = 4096;
const lc = (s: string): string => String(s).toLowerCase();

export class McpStore {
  /** Extras by folder/workspace key (the saved-folder key: .code-workspace file or folder path). */
  private folders = new Map<string, Rec[]>();
  /** Servers of the old app-level list (milestone 8): kept, never passed to a session, movable into a folder. */
  private legacyRecs: Rec[] = [];
  private disabledAmbient = new Set<string>();

  constructor(
    private readonly file: string,
    private readonly codec?: SecretCodec,
  ) {}

  /** True when secrets can be persisted (an OS-protected store is available). */
  get secretsPersist(): boolean {
    return !!this.codec && this.codec.available();
  }

  /** One stored server -> record (undefined when it does not validate). Secrets are decrypted when an OS store is available. */
  private parseRec(e: unknown): Rec | undefined {
    const r = e && typeof e === 'object' ? (e as Record<string, unknown>) : {};
    const v = validateInput({ ...r, env: [], headers: [] });
    if (!v.ok) return undefined;
    const secrets = (list: unknown): SecretEntry[] =>
      Array.isArray(list)
        ? list
            .filter((s): s is { key: string; enc?: string } => !!s && typeof (s as { key?: unknown }).key === 'string')
            .map((s) => {
              let value: string | undefined;
              if (typeof s.enc === 'string' && this.secretsPersist) {
                try {
                  value = (this.codec as SecretCodec).decrypt(s.enc);
                } catch {
                  value = undefined;
                }
              }
              return { key: s.key, value };
            })
        : [];
    const x = v.value;
    return {
      name: x.name,
      transport: x.transport,
      enabled: r.enabled === true,
      command: x.command,
      args: x.args,
      workingDirectory: x.workingDirectory,
      url: x.url,
      tools: x.tools,
      trust: typeof r.trust === 'string' ? r.trust : undefined,
      env: secrets(r.env),
      headers: secrets(r.headers),
    };
  }

  private parseList(list: unknown): Rec[] {
    if (!Array.isArray(list)) return [];
    const out: Rec[] = [];
    for (const e of list.slice(0, MAX_SERVERS)) {
      const r = this.parseRec(e);
      if (r && !out.some((o) => lc(o.name) === lc(r.name))) out.push(r);
    }
    return out;
  }

  load(): void {
    this.folders = new Map();
    this.legacyRecs = [];
    this.disabledAmbient = new Set();
    let doc: unknown;
    try {
      if (fs.statSync(this.file).size > MAX_FILE) return;
      doc = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return;
    }
    const o = (doc && typeof doc === 'object' ? doc : {}) as Record<string, unknown>;
    if (Array.isArray(o.disabledAmbient)) for (const n of o.disabledAmbient) if (typeof n === 'string' && n.length <= 64) this.disabledAmbient.add(n);
    // Version 1 (milestone 8) had one global `servers` list: it becomes `legacy`. Version 2 has `legacy` too.
    this.legacyRecs = this.parseList([...(Array.isArray(o.servers) ? o.servers : []), ...(Array.isArray(o.legacy) ? o.legacy : [])]);
    const f = o.folders && typeof o.folders === 'object' && !Array.isArray(o.folders) ? (o.folders as Record<string, unknown>) : {};
    for (const key of Object.keys(f).slice(0, MAX_FOLDERS)) {
      if (!key || key.length > MAX_KEY) continue;
      const list = this.parseList(f[key]);
      if (list.length) this.folders.set(key, list);
    }
  }

  private save(): void {
    const enc = (s: SecretEntry): { key: string; enc?: string } => {
      if (this.secretsPersist && s.value !== undefined && s.value !== '') return { key: s.key, enc: (this.codec as SecretCodec).encrypt(s.value) };
      return { key: s.key };
    };
    const ser = (r: Rec) => ({
      name: r.name,
      transport: r.transport,
      enabled: r.enabled,
      command: r.command,
      args: r.args,
      workingDirectory: r.workingDirectory,
      url: r.url,
      tools: r.tools,
      trust: r.trust,
      env: r.env.map(enc),
      headers: r.headers.map(enc),
    });
    const folders: Record<string, unknown[]> = {};
    for (const [k, list] of this.folders) if (list.length) folders[k] = list.map(ser);
    const doc = { version: 2, folders, legacy: this.legacyRecs.map(ser), disabledAmbient: [...this.disabledAmbient] };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  private isTrusted(r: Rec): boolean {
    return !!r.trust && r.trust === trustHash(r);
  }

  private view(r: Rec): McpServerView {
    const keys = (l: SecretEntry[]): McpSecretKey[] => l.map((s) => ({ key: s.key, set: s.value !== undefined && s.value !== '' }));
    return {
      name: r.name,
      transport: r.transport,
      enabled: r.enabled,
      trusted: this.isTrusted(r),
      command: r.command,
      args: r.args,
      workingDirectory: r.workingDirectory,
      url: r.url,
      tools: r.tools,
      env: keys(r.env),
      headers: keys(r.headers),
      needsSecrets: [...r.env, ...r.headers].some((s) => s.value === undefined),
    };
  }

  private validKey(key: unknown): key is string {
    return typeof key === 'string' && key.length > 0 && key.length <= MAX_KEY;
  }

  private recsOf(key: string): Rec[] {
    return this.folders.get(key) ?? [];
  }

  private find(key: string, name: string): Rec | undefined {
    return this.recsOf(key).find((r) => lc(r.name) === lc(name));
  }

  /** The extras of one folder/workspace (secrets masked). */
  list(key: string): McpServerView[] {
    return this.validKey(key) ? this.recsOf(key).map((r) => this.view(r)) : [];
  }

  /** Servers of the old app-level list: shown (off, not applied) so the user can move or remove them. */
  legacyList(): McpServerView[] {
    return this.legacyRecs.map((r) => ({ ...this.view(r), enabled: false }));
  }

  trustInfo(key: string, name: string): McpTrustInfo | undefined {
    const r = this.validKey(key) ? this.find(key, name) : undefined;
    return r && { name: r.name, transport: r.transport, command: r.command, args: r.args, workingDirectory: r.workingDirectory, url: r.url };
  }

  /**
   * Add (`originalName` undefined) or edit an extra of this folder. A change of command/args/URL/type switches the server off and drops
   * its trust. `reserved` = names that already mean something else (the Copilot CLI list, the built-in server): refused.
   */
  upsert(key: string, input: unknown, originalName?: string, reserved: Iterable<string> = []): StoreResult {
    if (!this.validKey(key)) return { ok: false, error: 'Unknown folder.' };
    const v = validateInput(input);
    if (!v.ok) return { ok: false, error: v.error };
    const x = v.value;
    if ([...reserved].some((n) => lc(n) === lc(x.name))) return { ok: false, error: `"${x.name}" is already a server of the Copilot CLI list. Pick another name.` };
    const cur = originalName ? this.find(key, originalName) : undefined;
    if (originalName && !cur) return { ok: false, error: 'That server no longer exists.' };
    const clash = this.find(key, x.name);
    if (clash && clash !== cur) return { ok: false, error: `A server named "${x.name}" already exists in this folder.` };
    const list = this.recsOf(key);
    if (!cur && list.length >= MAX_SERVERS) return { ok: false, error: `At most ${MAX_SERVERS} servers per folder.` };
    if (!cur && !this.folders.has(key) && this.folders.size >= MAX_FOLDERS) return { ok: false, error: `Extras are kept for at most ${MAX_FOLDERS} folders.` };
    const merge = (incoming: { key: string; value?: string }[], old: SecretEntry[]): SecretEntry[] =>
      incoming.map((s) => ({ key: s.key, value: s.value !== undefined ? s.value : old.find((o) => lc(o.key) === lc(s.key))?.value }));
    const next: Rec = {
      name: x.name,
      transport: x.transport,
      enabled: cur?.enabled ?? false,
      command: x.command,
      args: x.args,
      workingDirectory: x.workingDirectory,
      url: x.url,
      tools: x.tools,
      trust: cur?.trust,
      env: merge(x.env ?? [], cur?.env ?? []),
      headers: merge(x.headers ?? [], cur?.headers ?? []),
    };
    if (cur && trustHash(cur) !== trustHash(next)) {
      next.trust = undefined;
      next.enabled = false;
    }
    const out = list.slice();
    if (cur) out[out.indexOf(cur)] = next;
    else out.push(next);
    this.folders.set(key, out);
    this.save();
    return { ok: true, view: this.view(next) };
  }

  remove(key: string, name: string): boolean {
    const r = this.validKey(key) ? this.find(key, name) : undefined;
    if (!r) return false;
    const out = this.recsOf(key).filter((x) => x !== r);
    if (out.length) this.folders.set(key, out);
    else this.folders.delete(key);
    this.save();
    return true;
  }

  /** Enabling an untrusted server returns `needsTrust` until called again with `trustAck` (the user confirmed the shown command). */
  setEnabled(key: string, name: string, enabled: boolean, trustAck = false): StoreResult {
    const r = this.validKey(key) ? this.find(key, name) : undefined;
    if (!r) return { ok: false, error: 'Unknown server.' };
    if (enabled && !this.isTrusted(r)) {
      if (!trustAck) return { ok: false, needsTrust: this.trustInfo(key, r.name) };
      r.trust = trustHash(r);
    }
    r.enabled = enabled;
    this.save();
    return { ok: true, view: this.view(r) };
  }

  /** Move an old app-level server into a folder: it arrives off and untrusted (the user reviews and trusts it there). */
  moveLegacy(name: string, key: string, reserved: Iterable<string> = []): StoreResult {
    if (!this.validKey(key)) return { ok: false, error: 'Unknown folder.' };
    const r = this.legacyRecs.find((x) => lc(x.name) === lc(name));
    if (!r) return { ok: false, error: 'That old server no longer exists.' };
    if ([...reserved].some((n) => lc(n) === lc(r.name))) return { ok: false, error: `"${r.name}" is already a server of the Copilot CLI list.` };
    if (this.find(key, r.name)) return { ok: false, error: `A server named "${r.name}" already exists in this folder.` };
    if (this.recsOf(key).length >= MAX_SERVERS) return { ok: false, error: `At most ${MAX_SERVERS} servers per folder.` };
    if (!this.folders.has(key) && this.folders.size >= MAX_FOLDERS) return { ok: false, error: `Extras are kept for at most ${MAX_FOLDERS} folders.` };
    const moved: Rec = { ...r, enabled: false, trust: undefined };
    this.legacyRecs = this.legacyRecs.filter((x) => x !== r);
    this.folders.set(key, [...this.recsOf(key), moved]);
    this.save();
    return { ok: true, view: this.view(moved) };
  }

  removeLegacy(name: string): boolean {
    const r = this.legacyRecs.find((x) => lc(x.name) === lc(name));
    if (!r) return false;
    this.legacyRecs = this.legacyRecs.filter((x) => x !== r);
    this.save();
    return true;
  }

  ambientDisabled(): string[] {
    return [...this.disabledAmbient];
  }

  setAmbientDisabled(name: string, disabled: boolean): void {
    if (typeof name !== 'string' || !name || name.length > 64) return;
    if (disabled) this.disabledAmbient.add(name);
    else this.disabledAmbient.delete(name);
    this.save();
  }

  /**
   * What a new session of an agent in folder `key` gets: that folder's enabled + trusted extras as `mcpServers` (never another
   * folder's), and the names to switch off (CLI-list servers turned off globally, plus the names this agent turned off).
   * `reserved` = CLI-list/built-in names: an extra with such a name is skipped (a name must mean one server).
   */
  forSession(key: string, agentDisabled: Iterable<string> = [], reserved: Iterable<string> = []): SessionMcp {
    const off = new Set<string>(agentDisabled);
    const taken = new Set<string>([...reserved].map(lc));
    const mcpServers: Record<string, McpServerSpec> = {};
    const skipped: { name: string; reason: string }[] = [];
    for (const r of this.validKey(key) ? this.recsOf(key) : []) {
      if (!r.enabled || off.has(r.name)) continue;
      if (taken.has(lc(r.name))) {
        skipped.push({ name: r.name, reason: 'same name as a Copilot CLI server: rename it' });
        continue;
      }
      if (!this.isTrusted(r)) {
        skipped.push({ name: r.name, reason: 'not trusted: review and confirm it in this folder\'s MCP extras' });
        continue;
      }
      if ([...r.env, ...r.headers].some((s) => s.value === undefined)) {
        skipped.push({ name: r.name, reason: 'secret values are not available: enter them again in this folder\'s MCP extras' });
        continue;
      }
      const kv = (l: SecretEntry[]): Record<string, string> => Object.fromEntries(l.map((s) => [s.key, s.value as string]));
      mcpServers[r.name] =
        r.transport === 'stdio'
          ? { type: 'stdio', command: r.command, args: r.args ?? [], env: kv(r.env), workingDirectory: r.workingDirectory, tools: r.tools ?? ['*'] }
          : { type: r.transport, url: r.url, headers: kv(r.headers), tools: r.tools ?? ['*'] };
    }
    // A name that is passed inline is not also listed as disabled (disabling a name would switch the inline server off too).
    const disabledMcpServers = [...new Set([...this.disabledAmbient, ...off])].filter((n) => !(n in mcpServers));
    return { mcpServers, disabledMcpServers, skipped };
  }
}
