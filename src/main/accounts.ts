/**
 * Spec 051 FR-014 (issue #617): the account each agent app reports, asked once per run and kept in memory only. Settings asks again
 * when it opens and on Check again (`refresh`), and a finished sign-in clears that app (`forget`). Only apps that are installed
 * (`ready` or `not-signed-in`) are asked, each with a time limit. Pure apart from the given functions, so it is unit-tested.
 * Personal data (FR-015): the answers are returned to the caller (the `harness:accounts` IPC, the window) and nowhere else; nothing
 * here logs.
 */
import { accountView } from '../shared/account';
import type { AccountIdentity, AccountInfoOptions, AccountView } from '../shared/account';
import type { AdapterInfo } from '../shared/adapters';

export const ACCOUNT_TIMEOUT_MS = 6000;
const ASKED_STATES = new Set(['ready', 'not-signed-in']);

export interface AccountCacheDeps {
  /** The cached list of agent apps (no new probe). */
  list(): Promise<AdapterInfo[]>;
  /** The adapter's `accountInfo`, or undefined when it has none (or under the simulator). `recheck`: the user asked again (FR-022). */
  check(id: string): ((o: { recheck: boolean }) => Promise<AccountIdentity>) | undefined;
  timeoutMs?: number;
  /** A call still running after this long no longer blocks a refresh (a hung app call never blocks Check again); default 30 s. */
  maxRunMs?: number;
}

export function createAccountCache(deps: AccountCacheDeps) {
  /* `view`: the answer the window gets (the app's, or "unknown" after the time limit); `running`: true until the app's own call has
     settled, also after the time limit. A refresh while one is running joins it, so concurrent opens of Settings or Check again
     start no second `codex app-server` or `claude auth status` (review on #620). */
  const cache = new Map<string, { view: Promise<AccountView>; running: boolean; at: number }>();
  /** Apps whose next ask is a recheck: a sign-in ended (`forget`). */
  const recheckNext = new Set<string>();
  const ask = (fn: () => Promise<AccountIdentity>): { view: Promise<AccountView>; running: boolean; at: number } => {
    const entry = { view: Promise.resolve(accountView(undefined)), running: true, at: Date.now() };
    const call = Promise.resolve().then(fn);
    void call.then(
      () => { entry.running = false; },
      () => { entry.running = false; },
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<undefined>((res) => {
      timer = setTimeout(() => res(undefined), deps.timeoutMs ?? ACCOUNT_TIMEOUT_MS);
    });
    entry.view = Promise.race([call, limit])
      .catch(() => undefined)
      .then((a) => accountView(a))
      .finally(() => {
        if (timer) clearTimeout(timer);
      });
    return entry;
  };
  return {
    /** `{ [appId]: AccountView }` for every installed app whose adapter can tell. `refresh` asks again unless an ask is still running. */
    async get(refresh = false, recheck = false): Promise<Record<string, AccountView>> {
      let infos: AdapterInfo[] = [];
      try {
        infos = await deps.list();
      } catch {
        infos = [];
      }
      const out: Record<string, AccountView> = {};
      await Promise.all(
        infos.map(async (i) => {
          if (!ASKED_STATES.has(i.state)) {
            cache.delete(i.id);
            return;
          }
          // a signed-out app needs no question: its line says so (FR-012)
          if (i.state === 'not-signed-in') {
            out[i.id] = accountView({ status: 'signed-out' });
            return;
          }
          const fn = deps.check(i.id);
          if (!fn) return;
          const have = cache.get(i.id);
          const busy = !!have && have.running && Date.now() - have.at < (deps.maxRunMs ?? 30_000);
          if (!have || (refresh && !busy)) {
            const again = recheck || recheckNext.has(i.id);
            recheckNext.delete(i.id);
            cache.set(i.id, ask(() => fn({ recheck: again })));
          }
          out[i.id] = await (cache.get(i.id) as { view: Promise<AccountView> }).view;
        }),
      );
      return out;
    },
    /** A sign-in for this app ended: its next answer is asked again (a call still running is left to finish). */
    forget(id: string): void {
      cache.delete(id);
      recheckNext.add(id);
    },
  };
}

/**
 * Spec 051 FR-022: the cache's `check` for the real adapters: the adapter's `accountInfo` with the Copilot runtime's own MCP servers
 * switched off by name (the names the one-shots use, `copilotServerNames`) and the recheck flag. None under the simulator or for an
 * adapter without `accountInfo`. Pure apart from the given functions, so it is unit-tested.
 */
export function accountCheck(d: {
  simulator: boolean;
  has(id: string): boolean;
  instance(id: string): { accountInfo?: (o?: AccountInfoOptions) => Promise<AccountIdentity> };
  copilotServers(): readonly string[];
}): AccountCacheDeps['check'] {
  return (id) => {
    if (d.simulator || !d.has(id)) return undefined;
    try {
      const ad = d.instance(id);
      if (typeof ad.accountInfo !== 'function') return undefined;
      return (o) => {
        let off: readonly string[] = [];
        if (id === 'copilot') {
          try {
            off = d.copilotServers();
          } catch {
            off = [];
          }
        }
        return (ad.accountInfo as (x: AccountInfoOptions) => Promise<AccountIdentity>)({ disabledMcpServers: off, recheck: o.recheck });
      };
    } catch {
      return undefined;
    }
  };
}
