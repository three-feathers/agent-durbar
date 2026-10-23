/**
 * Spec 051 FR-014 (issue #617): the account each agent app reports, asked once per run and kept in memory only. Settings asks again
 * when it opens and on Check again (`refresh`), and a finished sign-in clears that app (`forget`). Only apps that are installed
 * (`ready` or `not-signed-in`) are asked, each with a time limit. Pure apart from the given functions, so it is unit-tested.
 * Personal data (FR-015): the answers are returned to the caller (the `harness:accounts` IPC, the window) and nowhere else; nothing
 * here logs.
 */
import { accountView } from '../shared/account';
import type { AccountIdentity, AccountView } from '../shared/account';
import type { AdapterInfo } from '../shared/adapters';

export const ACCOUNT_TIMEOUT_MS = 6000;
const ASKED_STATES = new Set(['ready', 'not-signed-in']);

export interface AccountCacheDeps {
  /** The cached list of agent apps (no new probe). */
  list(): Promise<AdapterInfo[]>;
  /** The adapter's `accountInfo`, or undefined when it has none (or under the simulator). */
  check(id: string): (() => Promise<AccountIdentity>) | undefined;
  timeoutMs?: number;
}

export function createAccountCache(deps: AccountCacheDeps) {
  /* `view`: the answer the window gets (the app's, or "unknown" after the time limit); `running`: true until the app's own call has
     settled, also after the time limit. A refresh while one is running joins it, so concurrent opens of Settings or Check again
     start no second `codex app-server` or `claude auth status` (review on #620). */
  const cache = new Map<string, { view: Promise<AccountView>; running: boolean }>();
  const ask = (fn: () => Promise<AccountIdentity>): { view: Promise<AccountView>; running: boolean } => {
    const entry = { view: Promise.resolve(accountView(undefined)), running: true };
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
    async get(refresh = false): Promise<Record<string, AccountView>> {
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
          if (!have || (refresh && !have.running)) cache.set(i.id, ask(fn));
          out[i.id] = await (cache.get(i.id) as { view: Promise<AccountView> }).view;
        }),
      );
      return out;
    },
    /** A sign-in for this app ended: its next answer is asked again (a call still running is left to finish). */
    forget(id: string): void {
      cache.delete(id);
    },
  };
}
