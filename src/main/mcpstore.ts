/**
 * Agent Durbar's global MCP server list (spec 019): one small JSON file in userData. No Electron import: the secret codec is injected
 * (Electron `safeStorage` in main.ts, a fake in tests).
 *
 * Secrets (env values, header values) are encrypted with the codec before they are written. Without a codec they are NOT written
 * (key names only); they stay in memory for this run and the user is told. Views for the renderer never contain a secret value.
 */
import * as fs from 'fs';
import * as path from 'path';
import { MAX_SERVERS, trustHash, validateInput } from '../shared/mcp';
import type { McpSecretKey, McpServerInput, McpServerSpec, McpServerView, McpTransport, McpTrustInfo } from '../shared/mcp';
import type { ImportCandidate } from '../shared/mcpimport';

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

export class McpStore {
  private recs: Rec[] = [];
  private disabledAmbient = new Set<string>();

  constructor(
    private readonly file: string,
    private readonly codec?: SecretCodec,
  ) {}

  /** True when secrets can be persisted (an OS-protected store is available). */
  get secretsPersist(): boolean {
    return !!this.codec && this.codec.available();
  }

  load(): void {
    this.recs = [];
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
    if (!Array.isArray(o.servers)) return;
    for (const e of o.servers.slice(0, MAX_SERVERS)) {
      const r = e && typeof e === 'object' ? (e as Record<string, unknown>) : {};
      const v = validateInput({ ...r, env: [], headers: [] });
      if (!v.ok) continue;
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
      this.recs.push({
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
      });
    }
  }

  private save(): void {
    const enc = (s: SecretEntry): { key: string; enc?: string } => {
      if (this.secretsPersist && s.value !== undefined && s.value !== '') return { key: s.key, enc: (this.codec as SecretCodec).encrypt(s.value) };
      return { key: s.key };
    };
    const doc = {
      version: 1,
      servers: this.recs.map((r) => ({
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
      })),
      disabledAmbient: [...this.disabledAmbient],
    };
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

  list(): McpServerView[] {
    return this.recs.map((r) => this.view(r));
  }

  private find(name: string): Rec | undefined {
    return this.recs.find((r) => r.name.toLowerCase() === String(name).toLowerCase());
  }

  trustInfo(name: string): McpTrustInfo | undefined {
    const r = this.find(name);
    return r && { name: r.name, transport: r.transport, command: r.command, args: r.args, workingDirectory: r.workingDirectory, url: r.url };
  }

  /** Add (`originalName` undefined) or edit. A change of command/args/URL/type switches the server off and drops its trust. */
  upsert(input: unknown, originalName?: string): StoreResult {
    const v = validateInput(input);
    if (!v.ok) return { ok: false, error: v.error };
    const x = v.value;
    const cur = originalName ? this.find(originalName) : undefined;
    if (originalName && !cur) return { ok: false, error: 'That server no longer exists.' };
    const clash = this.find(x.name);
    if (clash && clash !== cur) return { ok: false, error: `A server named "${x.name}" already exists.` };
    if (!cur && this.recs.length >= MAX_SERVERS) return { ok: false, error: `At most ${MAX_SERVERS} servers.` };
    const merge = (incoming: { key: string; value?: string }[], old: SecretEntry[]): SecretEntry[] =>
      incoming.map((s) => ({ key: s.key, value: s.value !== undefined ? s.value : old.find((o) => o.key.toLowerCase() === s.key.toLowerCase())?.value }));
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
    if (cur) this.recs[this.recs.indexOf(cur)] = next;
    else this.recs.push(next);
    this.save();
    return { ok: true, view: this.view(next) };
  }

  remove(name: string): boolean {
    const r = this.find(name);
    if (!r) return false;
    this.recs.splice(this.recs.indexOf(r), 1);
    this.save();
    return true;
  }

  /** Enabling an untrusted server returns `needsTrust` until called again with `trustAck` (the user confirmed the shown command). */
  setEnabled(name: string, enabled: boolean, trustAck = false): StoreResult {
    const r = this.find(name);
    if (!r) return { ok: false, error: 'Unknown server.' };
    if (enabled && !this.isTrusted(r)) {
      if (!trustAck) return { ok: false, needsTrust: this.trustInfo(r.name) };
      r.trust = trustHash(r);
    }
    r.enabled = enabled;
    this.save();
    return { ok: true, view: this.view(r) };
  }

  /** Imported servers arrive off and untrusted. Returns the names added (clashes get a numeric suffix). */
  addImported(cands: ImportCandidate[]): string[] {
    const added: string[] = [];
    for (const c of cands) {
      if (this.recs.length >= MAX_SERVERS) break;
      let name = c.name;
      for (let i = 2; this.find(name); i++) name = `${c.name.slice(0, 44)}-${i}`;
      const v = validateInput({
        name,
        transport: c.transport,
        command: c.command,
        args: c.args,
        workingDirectory: c.workingDirectory,
        url: c.url,
        tools: c.tools,
        env: Object.entries(c.env).map(([key, value]) => ({ key, value })),
        headers: Object.entries(c.headers).map(([key, value]) => ({ key, value })),
      });
      if (!v.ok) continue;
      const r = this.upsert(v.value);
      if (r.ok) added.push(name);
    }
    return added;
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
   * What a new session gets: enabled + trusted Durbar servers as `mcpServers`, and the names to switch off
   * (ambient servers turned off globally, plus the names this agent turned off).
   */
  forSession(agentDisabled: Iterable<string> = []): SessionMcp {
    const off = new Set<string>(agentDisabled);
    const mcpServers: Record<string, McpServerSpec> = {};
    const skipped: { name: string; reason: string }[] = [];
    for (const r of this.recs) {
      if (!r.enabled || off.has(r.name)) continue;
      if (!this.isTrusted(r)) {
        skipped.push({ name: r.name, reason: 'not trusted: review and confirm it in Settings' });
        continue;
      }
      if ([...r.env, ...r.headers].some((s) => s.value === undefined)) {
        skipped.push({ name: r.name, reason: 'secret values are not available: enter them again in Settings' });
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
