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
}
export interface WorldsIpc {
  store: WorldStore;
  shutdown(): void;
}

const turn = (): Promise<void> => new Promise((r) => setImmediate(r));

export function register(deps: WorldsIpcDeps = {}): WorldsIpc {
  const store = deps.store ?? new WorldStore(path.join(app.getPath('userData'), 'worlds'));
  if (!deps.simulator) {
    try { store.repair(); } catch { console.warn('[worlds] the start repair failed'); }
  }
  let chain: Promise<unknown> = Promise.resolve();
  let closed = false;
  /** One read at a time. */
  const queued = <T>(fn: () => T): Promise<T> => {
    const run = chain.then(async () => { await turn(); return fn(); });
    chain = run.catch(() => undefined);
    return run;
  };

  ipcHandle('world:list', async (e) => {
    if (!fromApp(e)) return [];
    if (closed) return [];
    return queued(() => store.list());
  });
  ipcHandle('world:part', async (e, key: unknown, name: unknown) => {
    if (!fromApp(e)) return REFUSED;
    if (closed) return { ok: false };
    return queued(() => {
      if (typeof key !== 'string' || !store.keys().includes(key)) return { ok: false }; // a key main does not list gets nothing
      const r = store.part(key, name);
      return r.ok ? { ok: true, bytes: new Uint8Array(r.bytes), mime: r.mime } : { ok: false, reason: r.reason };
    });
  });
  ipcHandle('world:remove', async (e, key: unknown) => {
    if (!fromApp(e)) return REFUSED;
    if (closed) return { ok: false };
    return queued(() => {
      if (typeof key !== 'string' || !store.keys().includes(key)) return { ok: false };
      return store.remove(key).ok ? { ok: true } : { ok: false };
    });
  });
  return { store, shutdown: () => { closed = true; } };
}
