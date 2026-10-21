/**
 * Agent Durbar's own optional MCP servers ("extras"), kept **per folder/workspace** (spec 020; spec 019 had one global list): one
 * small JSON file in userData. The only global list is the user's `~/.copilot/mcp-config.json`, which this store never touches. No Electron import: the secret codec is injected
 * (Electron `safeStorage` in main.ts, a fake in tests).
 *
 * Secrets (env values, header values) are encrypted with the codec before they are written. Without a codec they are NOT written
 * (key names only); they stay in memory for this run and the user is told. Views for the renderer never contain a secret value.
 *
 * Keychain at most once (spec 019 FR-023, 2026-10-21): on macOS every codec call can read the Keychain, and an app the Keychain
 * item does not trust gets a prompt. So all secret values live in ONE encrypted blob (`vault`), which is NOT decrypted on load:
 * views only need to know a value is stored. It is decrypted once, the first time a value is really needed (a session starts with
 * an enabled, trusted server that has secrets, or the user changes a secret), and kept in memory only. Switching a server on or
 * off, trusting it, moving it or editing its non-secret fields writes the same blob again without decrypting it.
 * Files of older versions (one `enc` blob per value) are read the same way and rewritten as one vault on that first unlock.
 */
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { MAX_SERVERS, NAME_RE, trustHash, validateInput } from '../shared/mcp';
import type { McpSecretKey, McpServerInput, McpServerSpec, McpServerView, McpTransport, McpTrustInfo } from '../shared/mcp';

export interface SecretCodec {
  available(): boolean;
  encrypt(plain: string): string;
  decrypt(blob: string): string;
}

interface SecretEntry {
  key: string;
  /** Plain value in memory (main process only); undefined = not known (still locked in the vault, not persisted, or could not be decrypted). */
  value?: string;
  /** Id of this value inside the encrypted vault (written to disk; not a secret). */
  ref?: string;
  /** Older file format: this value's own encrypted blob, decrypted on the first unlock and then moved into the vault. */
  legacyEnc?: string;
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
const MAX_EXTRA_NAMES = 500;
const MAX_TOOL_SERVERS = 200;
const MAX_TOOLS_OFF = 500;
const lc = (s: string): string => String(s).toLowerCase();
/** Run `f`; on any error give `fallback` (a codec error never reaches a log or the window). */
function safe<T>(f: () => T, fallback: T): T {
  try {
    return f();
  } catch {
    return fallback;
  }
}

export class McpStore {
  /** Extras by folder/workspace key (the saved-folder key: .code-workspace file or folder path). */
  private folders = new Map<string, Rec[]>();
  /** Servers of the old app-level list (milestone 8): kept, never passed to a session, movable into a folder. */
  private legacyRecs: Rec[] = [];
  private disabledAmbient = new Set<string>();
  /** Spec 069 FR-061: single MCP tools turned off, per folder key, by server name (names only). */
  private toolsOff = new Map<string, Record<string, string[]>>();
  /** The encrypted vault as read from or last written to disk (never decrypted on load). */
  private vaultBlob?: string;
  /** True once the vault (and any old per-value blobs) was decrypted, or found to need nothing: never decrypted twice. */
  private unlocked = false;
  /** A secret value was added, changed or dropped since the vault was written: the next save encrypts a new vault. */
  private vaultDirty = false;
  private persistKnown?: boolean;

  constructor(
    private readonly file: string,
    private readonly codec?: SecretCodec,
  ) {}

  /** True when secrets can be persisted (an OS-protected store is available). */
  get secretsPersist(): boolean {
    return (this.persistKnown ??= !!this.codec && safe(() => this.codec?.available() === true, false));
  }

  private allRecs(): Rec[] {
    const out = [...this.legacyRecs];
    for (const list of this.folders.values()) out.push(...list);
    return out;
  }

  private static pending(s: SecretEntry): boolean {
    return s.value === undefined && (s.ref !== undefined || s.legacyEnc !== undefined);
  }

  /**
   * Decrypt the stored secret values, at most once per run and only when one is needed. One codec call for the vault; a file of an
   * older version has one blob per value, decrypted here once and then rewritten as one vault. A failure leaves the values unknown
   * (the server shows "secrets missing"; nothing is logged).
   */
  private unlock(persistMigration = true): void {
    if (this.unlocked) return;
    this.unlocked = true;
    const entries = this.allRecs().flatMap((r) => [...r.env, ...r.headers]);
    const waiting = entries.filter((s) => McpStore.pending(s));
    if (!waiting.length) return;
    if (!this.secretsPersist) {
      for (const s of waiting) s.legacyEnc = undefined;
      return;
    }
    const codec = this.codec as SecretCodec;
    let map: Record<string, unknown> = {};
    if (this.vaultBlob !== undefined && waiting.some((s) => s.ref !== undefined)) {
      map = safe(() => {
        const o: unknown = JSON.parse(codec.decrypt(this.vaultBlob as string));
        return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
      }, {});
    }
    let migrated = false;
    for (const s of waiting) {
      if (s.legacyEnc !== undefined) {
        s.value = safe(() => codec.decrypt(s.legacyEnc as string), undefined);
        s.legacyEnc = undefined;
        migrated = true;
      } else if (s.ref !== undefined && Object.prototype.hasOwnProperty.call(map, s.ref) && typeof map[s.ref] === 'string') {
        s.value = map[s.ref] as string;
      }
    }
    if (migrated && persistMigration) {
      this.vaultDirty = true;
      safe(() => this.save(), undefined);
    }
  }

  /** One stored server -> record (undefined when it does not validate). Secrets stay encrypted until `unlock()` (FR-023). */
  private parseRec(e: unknown): Rec | undefined {
    const r = e && typeof e === 'object' ? (e as Record<string, unknown>) : {};
    const v = validateInput({ ...r, env: [], headers: [] });
    if (!v.ok) return undefined;
    const secrets = (list: unknown): SecretEntry[] =>
      Array.isArray(list)
        ? list
            .filter((s): s is { key: string; enc?: unknown; ref?: unknown } => !!s && typeof (s as { key?: unknown }).key === 'string')
            // Nothing is decrypted here (FR-023): only where the value is kept.
            .map((s) => ({
              key: s.key,
              ref: typeof s.ref === 'string' && s.ref.length <= 64 ? s.ref : undefined,
              legacyEnc: typeof s.enc === 'string' && typeof s.ref !== 'string' ? s.enc : undefined,
            }))
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
    this.toolsOff = new Map();
    this.vaultBlob = undefined;
    this.unlocked = false;
    this.vaultDirty = false;
    let doc: unknown;
    try {
      if (fs.statSync(this.file).size > MAX_FILE) return;
      doc = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return;
    }
    const o = (doc && typeof doc === 'object' ? doc : {}) as Record<string, unknown>;
    if (typeof o.vault === 'string') this.vaultBlob = o.vault;
    const to = o.toolsOff && typeof o.toolsOff === 'object' && !Array.isArray(o.toolsOff) ? (o.toolsOff as Record<string, unknown>) : {};
    for (const key of Object.keys(to).slice(0, MAX_FOLDERS)) {
      const m = to[key];
      if (!key || key.length > MAX_KEY || !m || typeof m !== 'object' || Array.isArray(m)) continue;
      const rec: Record<string, string[]> = {};
      for (const [srv, list] of Object.entries(m as Record<string, unknown>).slice(0, MAX_TOOL_SERVERS)) {
        const tools = McpStore.toolList(list);
        if (srv && srv.length <= 64 && srv !== '__proto__' && tools.length) rec[srv] = tools;
      }
      if (Object.keys(rec).length) this.toolsOff.set(key, rec);
    }
    if (Array.isArray(o.disabledAmbient)) for (const n of o.disabledAmbient) if (typeof n === 'string' && n.length <= 80) this.disabledAmbient.add(n);
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
    let vault = this.vaultBlob;
    if (this.vaultDirty) {
      // A value changed: the new vault needs every value, so the old one is decrypted first (once per run), then encrypted once.
      this.unlock(false);
      const map: Record<string, string> = {};
      for (const r of this.allRecs())
        for (const s of [...r.env, ...r.headers]) {
          if (s.value === undefined || s.value === '') {
            s.ref = undefined;
            continue;
          }
          s.ref ??= randomUUID();
          map[s.ref] = s.value;
        }
      vault = undefined;
      if (Object.keys(map).length && this.secretsPersist) vault = safe(() => (this.codec as SecretCodec).encrypt(JSON.stringify(map)), undefined);
      this.vaultBlob = vault;
      this.vaultDirty = false;
    }
    const enc = (s: SecretEntry): { key: string; ref?: string; enc?: string } => {
      if (vault !== undefined && s.ref !== undefined) return { key: s.key, ref: s.ref };
      if (s.legacyEnc !== undefined && s.value === undefined) return { key: s.key, enc: s.legacyEnc }; // not unlocked yet: kept as it was
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
    const toolsOff: Record<string, Record<string, string[]>> = {};
    for (const [k, m] of this.toolsOff) if (Object.keys(m).length) toolsOff[k] = m;
    const doc = { version: 3, folders, legacy: this.legacyRecs.map(ser), disabledAmbient: [...this.disabledAmbient], ...(Object.keys(toolsOff).length ? { toolsOff } : {}), ...(vault !== undefined ? { vault } : {}) };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  private isTrusted(r: Rec): boolean {
    return !!r.trust && r.trust === trustHash(r);
  }

  private view(r: Rec): McpServerView {
    const keys = (l: SecretEntry[]): McpSecretKey[] => l.map((s) => ({ key: s.key, set: this.isSet(s) }));
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
      needsSecrets: [...r.env, ...r.headers].some((s) => !this.isSet(s)),
    };
  }

  /** A value is known, or stored encrypted and not yet unlocked (shown as set without decrypting it). */
  private isSet(s: SecretEntry): boolean {
    if (s.value !== undefined) return s.value !== '';
    if (this.unlocked || !this.secretsPersist) return false;
    return s.legacyEnc !== undefined || (s.ref !== undefined && this.vaultBlob !== undefined);
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

  /**
   * Names only (spec 024 FR-015): the extras of every saved folder, in any state (on, off, untrusted, secrets missing), each exact name once,
   * for the Settings > Places list. Memory only; no command, URL, env, folder key or path. Old app-level servers are not included. A name that
   * matches `reserved` (the Copilot CLI list, built-in servers) ignoring case is left out: its CLI row already covers it.
   */
  extraNames(reserved: Iterable<string> = []): string[] {
    const taken = new Set<string>([...reserved].map(lc));
    const out = new Set<string>();
    for (const list of this.folders.values())
      for (const r of list) {
        if (typeof r.name !== 'string' || !NAME_RE.test(r.name) || r.name === '__proto__' || taken.has(lc(r.name))) continue;
        out.add(r.name);
      }
    return [...out].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).slice(0, MAX_EXTRA_NAMES);
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
    // A kept value (input without a value) keeps its place in the vault, still locked; a new value marks the vault for rewriting.
    const merge = (incoming: { key: string; value?: string }[], old: SecretEntry[]): SecretEntry[] =>
      incoming.map((s) => {
        if (s.value !== undefined) return { key: s.key, value: s.value };
        const o = old.find((x) => lc(x.key) === lc(s.key));
        return { key: s.key, value: o?.value, ref: o?.ref, legacyEnc: o?.legacyEnc };
      });
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
    if ([...(x.env ?? []), ...(x.headers ?? [])].some((s) => s.value !== undefined)) this.vaultDirty = true;
    else if (cur) {
      // A stored value whose key was removed or renamed must leave the vault too.
      const kept = new Set([...next.env, ...next.headers].map((s) => s.ref ?? s.legacyEnc));
      if ([...cur.env, ...cur.headers].some((s) => (s.ref ?? s.legacyEnc) !== undefined && !kept.has(s.ref ?? s.legacyEnc))) this.vaultDirty = true;
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
    if ([...r.env, ...r.headers].some((s) => s.ref !== undefined || s.value !== undefined)) this.vaultDirty = true; // its values leave the vault
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
    if ([...r.env, ...r.headers].some((s) => s.ref !== undefined || s.value !== undefined)) this.vaultDirty = true;
    this.save();
    return true;
  }

  private static toolList(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return [...new Set(v.filter((t): t is string => typeof t === 'string' && t.length > 0 && t.length <= 128 && !t.includes('\0')))].slice(0, MAX_TOOLS_OFF);
  }

  /** Spec 069 FR-061: the tools turned off in this folder, by server (a copy). */
  toolsOffFor(key: string): Record<string, string[]> {
    const m = this.validKey(key) ? this.toolsOff.get(key) : undefined;
    return m ? Object.fromEntries(Object.entries(m).map(([s, l]) => [s, [...l]])) : {};
  }

  /** Spec 069 FR-061: replace the list of turned-off tools of one server in one folder (empty = all on). */
  setToolsOff(key: string, server: string, tools: unknown): { ok: boolean; error?: string } {
    if (!this.validKey(key) || typeof server !== 'string' || !server || server.length > 64 || server === '__proto__') return { ok: false, error: 'Unknown server.' };
    const list = McpStore.toolList(tools);
    const m = { ...(this.toolsOff.get(key) ?? {}) };
    if (list.length) m[server] = list;
    else delete m[server];
    if (!(server in m) && !Object.keys(m).length) this.toolsOff.delete(key);
    else {
      if (Object.keys(m).length > MAX_TOOL_SERVERS) return { ok: false, error: 'Too many servers with tools turned off in this folder.' };
      if (!this.toolsOff.has(key) && this.toolsOff.size >= MAX_FOLDERS) return { ok: false, error: `Kept for at most ${MAX_FOLDERS} folders.` };
      this.toolsOff.set(key, m);
    }
    this.save();
    return { ok: true };
  }

  ambientDisabled(): string[] {
    return [...this.disabledAmbient];
  }

  /** A Copilot CLI name, or `claude:<name>` for a Claude Code list entry (spec 069 FR-009). */
  setAmbientDisabled(name: string, disabled: boolean): void {
    if (typeof name !== 'string' || !name || name.length > 80) return;
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
      if ([...r.env, ...r.headers].some((s) => McpStore.pending(s))) this.unlock(); // the only read at session start, once per run
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
    const disabledMcpServers = [...new Set([...this.disabledAmbient, ...off])].filter((n) => !(n in mcpServers) && !n.startsWith('claude:'));
    return { mcpServers, disabledMcpServers, skipped };
  }
}
