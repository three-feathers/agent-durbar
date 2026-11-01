/**
 * Spec 011 FR-083, FR-084, FR-090, FR-091 (issue #690): the account limits per agent app, per app and in memory only: no session id,
 * nothing saved, nothing logged. No timer but each read's time limit, which is cleared: reads happen only when the window asks, within
 * the floors of `quotaShouldAsk`. One read per app at a time. Pure apart from the given functions, so it is unit-tested.
 */
import { applyQuotaRead, quotaShouldAsk, quotaView, sanitiseQuotaRead, QUOTA_TIMEOUT_MS } from '../shared/quota';
import type { QuotaEntry, QuotaMode, QuotaRead, QuotaView } from '../shared/quota';
import type { AdapterInfo } from '../shared/adapters';

export interface QuotaCacheDeps {
  /** The cached list of agent apps (no new probe). */
  list(): Promise<AdapterInfo[]>;
  /** The adapter's read, or undefined when it has none. */
  check(id: string): (() => Promise<unknown>) | undefined;
  now?(): number;
  timeoutMs?: number;
  /** A read still running after this long no longer blocks a new one (a hung call never blocks Check again). */
  maxRunMs?: number;
}

export function createQuotaCache(deps: QuotaCacheDeps) {
  const now = deps.now ?? Date.now;
  const entries = new Map<string, QuotaEntry>();
  const running = new Map<string, { done: Promise<void>; at: number; settled: boolean }>();
  /** Bumped by each new read and each `forget`: an answer of an older generation is dropped. */
  const gen = new Map<string, number>();

  const read = (id: string, fn: () => Promise<unknown>): Promise<void> => {
    const mine = (gen.get(id) ?? 0) + 1;
    gen.set(id, mine);
    entries.set(id, { ...entries.get(id), askedAt: now() });
    const land = (r: QuotaRead): void => {
      if (gen.get(id) !== mine) return; // answered too late, or a sign-in came between
      gen.set(id, mine + 1); // the first answer wins: a late call after the time limit changes nothing
      entries.set(id, applyQuotaRead(entries.get(id), r, now()));
    };
    const call = Promise.resolve().then(fn);
    const run = { done: Promise.resolve(), at: now(), settled: false };
    const clearRun = (): void => {
      run.settled = true;
      if (running.get(id) === run) running.delete(id);
    };
    void call.then(clearRun, clearRun);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<'late'>((res) => {
      timer = setTimeout(() => res('late'), deps.timeoutMs ?? QUOTA_TIMEOUT_MS);
    });
    run.done = Promise.race([call, limit])
      .then((a) => land(a === 'late' ? { kind: 'failed', failure: 'timeout' } : sanitiseQuotaRead(a, now())))
      // the text of a thrown error is never kept or shown (it might hold anything)
      .catch(() => land({ kind: 'failed', failure: 'unavailable' }))
      .finally(() => {
        if (timer) clearTimeout(timer);
      });
    running.set(id, run);
    return run.done;
  };

  return {
    /** `{ [appId]: QuotaView }` for every installed app; `only` limits it to one. The modes are in `quotaShouldAsk`. */
    async get(mode: QuotaMode = 'cached', only?: string): Promise<Record<string, QuotaView>> {
      const infos = await deps.list().catch(() => [] as AdapterInfo[]);
      const out: Record<string, QuotaView> = {};
      await Promise.all(
        infos.map(async (i) => {
          if (only !== undefined && i.id !== only) return;
          if (i.state === 'not-signed-in') {
            entries.delete(i.id); // no figures of an account that left
            out[i.id] = quotaView(i.id, applyQuotaRead(undefined, { kind: 'failed', failure: 'signed-out' }, now()));
            return;
          }
          if (i.state !== 'ready') {
            entries.delete(i.id);
            return;
          }
          const fn = deps.check(i.id);
          if (!fn) {
            out[i.id] = quotaView(i.id, applyQuotaRead(undefined, { kind: 'not-reported', reason: 'no-read' }, now()));
            return;
          }
          const run = running.get(i.id);
          const busy = !!run && !run.settled && now() - run.at < (deps.maxRunMs ?? 30_000);
          if (busy) {
            if (mode !== 'cached') await (run as { done: Promise<void> }).done; // joins it; a time limit ends the wait, the call may run on
          } else if (quotaShouldAsk(entries.get(i.id), mode, now())) await read(i.id, fn);
          out[i.id] = quotaView(i.id, entries.get(i.id));
        }),
      );
      return out;
    },
    /** A sign-in for this app ended: its figures belonged to the account before; a read still running is ignored. */
    forget(id: string): void {
      entries.delete(id);
      gen.set(id, (gen.get(id) ?? 0) + 1);
    },
  };
}

/** The cache's `check` for the real adapters: only `capabilities.accountQuota`'s member, never under the simulator (FR-090). */
export function quotaCheck(d: { simulator: boolean; has(id: string): boolean; instance(id: string): { accountQuota?: () => Promise<QuotaRead> } }): QuotaCacheDeps['check'] {
  return (id) => {
    if (d.simulator || !d.has(id)) return undefined;
    try {
      const ad = d.instance(id);
      return typeof ad.accountQuota === 'function' ? () => (ad.accountQuota as () => Promise<QuotaRead>)() : undefined;
    } catch {
      return undefined;
    }
  };
}

const MODES: readonly unknown[] = ['cached', 'open', 'check'];

/** FR-090: the `harness:quota` answer. Anything refused says `ok: false`, never an empty success. */
export async function quotaIpcAnswer(
  fromApp: boolean,
  mode: unknown,
  app: unknown,
  cache: { get(mode: QuotaMode, only?: string): Promise<Record<string, QuotaView>> },
  isKind: (k: unknown) => boolean,
): Promise<{ ok: true; apps: Record<string, QuotaView> } | { ok: false; error: string }> {
  if (!fromApp) return { ok: false, error: 'refused' };
  if (!MODES.includes(mode)) return { ok: false, error: 'invalid request' };
  if (app !== undefined && !isKind(app)) return { ok: false, error: 'invalid request' };
  try {
    return { ok: true, apps: await cache.get(mode as QuotaMode, app as string | undefined) };
  } catch {
    return { ok: false, error: 'could not read' };
  }
}
