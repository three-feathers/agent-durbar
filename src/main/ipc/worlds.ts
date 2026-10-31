/**
 * IPC for installed worlds (spec 102 FR-064, FR-065, FR-062, T022). Main decides: the window sends a key main listed and a part name from the closed list, and gets bytes back.
 * It never sends a path, URL or host, and it never receives pack text beyond the world's name in the list. No download, no network and no agent app are reached from here; every channel is
 * owner-only (`fromApp`) and none is open to the simulator, MCP tools or remote control (`test:worldipc`, `test:simguard`).
 * Reads go one at a time, each after a turn of the event loop, so a world's pictures do not block main (FR-062). A world's name is never logged (FR-065).
 */
import { app } from 'electron';
import * as path from 'path';
import { fromAppFrame as fromApp, ipcHandle } from '../ipcguard';
import { WorldStore } from '../worlds/store';

const REFUSED = { ok: false, error: 'Agent Durbar refused a call that did not come from its own window.' };

export interface WorldsIpcDeps {
  /** Main's own simulator decision: under it nothing on disk is touched (every channel is refused anyway). */
  simulator?: boolean;
  /** Tests: a store over a temp folder. */
  store?: WorldStore;
  /** FR-083: the hashes the catalogue revoked, read each time. Main passes none until the catalogue exists (T035, T042); with none, nothing is revoked. */
  revoked?: () => Iterable<string>;
}
export interface WorldsIpc {
  store: WorldStore;
  shutdown(): void;
}

const EMPTY = (): { worlds: never[]; removed: number; revocationChecked: boolean } => ({ worlds: [], removed: 0, revocationChecked: true });
const turn = (): Promise<void> => new Promise((r) => setImmediate(r));

export function register(deps: WorldsIpcDeps = {}): WorldsIpc {
  const store = deps.store ?? new WorldStore(path.join(app.getPath('userData'), 'worlds'));
  if (!deps.simulator) {
    try { store.repair(); } catch { console.warn('[worlds] the start repair failed'); }
  }
  /** Worlds the sweep removed that the window has not been told about yet (a count: no name or key leaves here). */
  let removed = 0;
  /**
   * The revoked hashes in force, then (for the list) the sweep that removes those worlds. Returns false when the provider failed: the last set it gave stays in force (so a world already known to be
   * revoked stays revoked), and on the first call there is none, so nothing is revoked. The list says so (`revocationChecked: false`) rather than looking like a clean check (FR-083).
   */
  const revoke = (sweep: boolean): boolean => {
    let ok = true;
    try { store.setRevoked(deps.revoked?.() ?? []); } catch { ok = false; }
    if (sweep) { try { removed += store.sweepRevoked().length; } catch { /* the next list sweeps again */ } }
    return ok;
  };
  if (!deps.simulator) revoke(true);
  let chain: Promise<unknown> = Promise.resolve();
  let closed = false;
  /** One read at a time. */
  const queued = <T>(fn: () => T): Promise<T> => {
    const run = chain.then(async () => { await turn(); return fn(); });
    chain = run.catch(() => undefined);
    return run;
  };

  ipcHandle('world:list', async (e) => {
    if (!fromApp(e)) return EMPTY();
    if (closed) return EMPTY();
    // FR-083: `removed` counts worlds taken away for a revocation since the last list (the window says so once); `revocationChecked` is false when the catalogue could not be read this time
    return queued(() => { const revocationChecked = revoke(true); const n = removed; removed = 0; return { worlds: store.list(), removed: n, revocationChecked }; });
  });
  ipcHandle('world:part', async (e, key: unknown, name: unknown) => {
    if (!fromApp(e)) return REFUSED;
    if (closed) return { ok: false };
    return queued(() => {
      if (typeof key !== 'string' || !store.keys().includes(key)) return { ok: false }; // a key main does not list gets nothing
      revoke(false);
      const r = store.part(key, name);
      return r.ok ? { ok: true, bytes: new Uint8Array(r.bytes), mime: r.mime } : { ok: false, reason: r.reason };
    });
  });
  ipcHandle('world:remove', async (e, key: unknown) => {
    if (!fromApp(e)) return REFUSED;
    if (closed) return { ok: false };
    return queued(() => {
      if (typeof key !== 'string' || !store.keys().includes(key)) return { ok: false };
      const r = store.remove(key);
      return r.ok ? { ok: true } : { ok: false, error: r.error }; // the store's own sentence, no path
    });
  });
  return { store, shutdown: () => { closed = true; } };
}
