/**
 * Permission broker: decides what happens to each permission request of one session.
 * Pure TypeScript (no SDK import), so it can be unit-tested without a Copilot session or credits.
 *
 * Policy: reads are approved; `allow` approves everything; `ask` leaves non-read requests pending
 * until `resolve` is called, optionally remembering the approval for the rest of the session
 * ("Approve for this session") as a revocable grant; otherwise (read-only) writes etc. are denied.
 */
import * as path from 'path';
import type { PermissionInfo, SessionGrant } from './types';

/** The subset of the SDK's PermissionRequest the broker reads (all optional strings besides kind). */
export interface PermissionLike {
  kind: string;
  toolCallId?: string;
  fileName?: string;
  fullCommandText?: string;
  url?: string;
  toolName?: string;
  path?: string;
}

export type Decision = { kind: 'approve-once' } | { kind: 'reject'; feedback: string };

/** Short human summary of a permission request (for the needs-permission card). */
export function summarize(req: PermissionLike): string {
  switch (req.kind) {
    case 'write':
      return `write ${req.fileName ?? ''}`.trim();
    case 'shell':
      return `run ${req.fullCommandText ?? ''}`.trim();
    case 'read':
      return `read ${req.path ?? ''}`.trim();
    case 'url':
      return `fetch ${req.url ?? ''}`.trim();
    case 'mcp':
    case 'custom-tool':
      return `${req.kind} ${req.toolName ?? ''}`.trim();
    default:
      return String(req.kind);
  }
}

const SHELL_META = /[;&|`$<>\n\r(){}\\]/;

function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join('/') || p;
}

/**
 * What "Approve for this session" remembers for a request: a key (what the grant matches) and a
 * short label for the chip. Deliberately narrow:
 *  - write: the folder of the file (all writes in that folder)
 *  - shell: the command name, only for simple commands; anything with pipes, `&&`, redirects,
 *    substitutions etc. is scoped to that exact command text
 *  - url: the host; mcp / custom tools: the tool name; anything else: the kind.
 */
export function grantScope(req: PermissionLike): { key: string; label: string } {
  switch (req.kind) {
    case 'write': {
      const f = req.fileName ?? '';
      const dir = f ? path.dirname(f) : '';
      return { key: `write:${dir}`, label: dir ? `write in ${baseName(dir)}/` : 'write' };
    }
    case 'shell': {
      const cmd = (req.fullCommandText ?? '').trim();
      if (!cmd) return { key: 'shell:', label: 'run commands' };
      if (SHELL_META.test(cmd)) return { key: `shell-exact:${cmd}`, label: `run ${cmd.length > 28 ? cmd.slice(0, 27) + '…' : cmd}` };
      const first = cmd.split(/\s+/)[0];
      return { key: `shell:${first}`, label: `run ${path.basename(first)} …` };
    }
    case 'url': {
      let host = req.url ?? '';
      try {
        host = new URL(host).host || host;
      } catch {
        /* keep raw */
      }
      return { key: `url:${host}`, label: `fetch ${host}` };
    }
    case 'mcp':
    case 'custom-tool':
      return { key: `${req.kind}:${req.toolName ?? ''}`, label: `${req.toolName || req.kind}` };
    default:
      return { key: String(req.kind), label: String(req.kind) };
  }
}

export type BrokerEvent =
  /** A request is waiting for the user (card goes to "Waiting for you"). */
  | { type: 'pending'; permission: PermissionInfo }
  /** Denied by the read-only policy. */
  | { type: 'denied-policy'; permission: PermissionInfo }
  /** A request got its final answer (user, session grant, or the session was stopped). */
  | { type: 'resolved'; permission: PermissionInfo }
  | { type: 'grants'; grants: SessionGrant[] };

export interface BrokerOptions {
  allow?: boolean;
  ask?: boolean;
  emit: (e: BrokerEvent) => void;
}

interface Pending {
  info: PermissionInfo;
  resolve: (d: { approve: boolean; remember: boolean; via: 'user' | 'stopped' }) => void;
}

export class PermissionBroker {
  private grants = new Map<string, SessionGrant>();
  private pending = new Map<string, Pending>();
  private stopped = false;
  constructor(private readonly opts: BrokerOptions) {}

  listGrants(): SessionGrant[] {
    return [...this.grants.values()];
  }

  async request(req: PermissionLike, now: () => number = Date.now): Promise<Decision> {
    const kind = String(req.kind);
    const summary = summarize(req);
    const requestId = String(req.toolCallId ?? `${kind}-${now()}`);
    if (kind === 'read' || this.opts.allow) return { kind: 'approve-once' };
    const scope = grantScope(req);
    const base = { requestId, kind, summary, scopeKey: scope.key, scopeLabel: scope.label };
    if (this.stopped) return { kind: 'reject', feedback: 'Session was stopped in Agent Durbar.' };
    if (!this.opts.ask) {
      const permission: PermissionInfo = { ...base, state: 'denied' };
      this.opts.emit({ type: 'denied-policy', permission });
      return { kind: 'reject', feedback: 'Agent Durbar is in read-only mode: this action was denied. Do not retry it.' };
    }
    if (this.grants.has(scope.key)) {
      this.opts.emit({ type: 'resolved', permission: { ...base, state: 'approved', via: 'session' } });
      return { kind: 'approve-once' };
    }
    const info: PermissionInfo = { ...base, state: 'pending' };
    this.opts.emit({ type: 'pending', permission: info });
    const r = await new Promise<{ approve: boolean; remember: boolean; via: 'user' | 'stopped' }>((resolve) => this.pending.set(requestId, { info, resolve }));
    this.pending.delete(requestId);
    if (r.approve && r.remember && !this.stopped) {
      this.grants.set(scope.key, { key: scope.key, kind, label: scope.label });
      this.opts.emit({ type: 'grants', grants: this.listGrants() });
    }
    this.opts.emit({ type: 'resolved', permission: { ...base, state: r.approve ? 'approved' : 'denied', via: r.via, remembered: r.approve && r.remember ? true : undefined } });
    return r.approve ? { kind: 'approve-once' } : { kind: 'reject', feedback: r.via === 'stopped' ? 'Session was stopped in Agent Durbar.' : 'Denied by user in Agent Durbar.' };
  }

  /** Answer a pending request. `remember` = "Approve for this session" (ignored when denying). */
  resolve(requestId: string, approve: boolean, remember = false): boolean {
    const p = this.pending.get(requestId);
    if (!p) return false;
    p.resolve({ approve, remember: approve && remember, via: 'user' });
    return true;
  }

  revoke(key: string): boolean {
    const had = this.grants.delete(key);
    if (had) this.opts.emit({ type: 'grants', grants: this.listGrants() });
    return had;
  }

  /** Session stopped: deny everything pending cleanly and forget all grants. */
  stop(): void {
    this.stopped = true;
    for (const p of [...this.pending.values()]) p.resolve({ approve: false, remember: false, via: 'stopped' });
    if (this.grants.size) {
      this.grants.clear();
      this.opts.emit({ type: 'grants', grants: [] });
    }
  }
}
