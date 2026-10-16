/**
 * Developer/test hooks (spec 010 FR-017..FR-020). Every `DURBAR_*` environment variable is a hook
 * (simulator, driver, log, picker answers, user-data override, ...). A packaged build ignores all of them
 * unless the explicit opt-in `DURBAR_DEV=1` is set. Pure: no Electron import, so it is unit-tested.
 * Main-process code must read hooks only from the object returned here, never from `process.env.DURBAR_*`.
 */
export type DevEnv = Readonly<Record<string, string | undefined>>;

/** The only accepted opt-in value is the exact string "1". */
export const DEV_OPT_IN = 'DURBAR_DEV';

/** True when hooks are honored: always when not packaged; when packaged only with DURBAR_DEV=1. */
export function hooksEnabled(env: NodeJS.ProcessEnv, isPackaged: boolean): boolean {
  return !isPackaged || env[DEV_OPT_IN] === '1';
}

/** The `DURBAR_*` variables the app may read (empty in a packaged build without the opt-in). */
export function devEnv(env: NodeJS.ProcessEnv, isPackaged: boolean): DevEnv {
  if (!hooksEnabled(env, isPackaged)) return {};
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) if (k.startsWith('DURBAR_')) out[k] = v;
  return out;
}

/** Packaged build with the opt-in: say so once (stderr), so nobody runs a release with a back door by accident. */
export function devWarning(env: NodeJS.ProcessEnv, isPackaged: boolean): string | undefined {
  return isPackaged && env[DEV_OPT_IN] === '1' ? 'Agent Durbar: developer hooks are ACTIVE in this packaged build (DURBAR_DEV=1).' : undefined;
}
