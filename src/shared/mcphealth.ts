/**
 * Spec 058 FR-092 (issue #603): when an MCP server's state started and whether it was Running before it failed. Pure and with NO
 * imports, so main (`mcpipc.ts`) and the page's simulator (loaded as a plain script after `exports-shim.js`, read through
 * `window.exports` at call time) use the same rule. Adapter-neutral: it reads only Durbar's normalized state words.
 *
 * One mark per server of one session. A new `mcp` event carries the full list, so a server missing from it is dropped.
 *  - `since`: when this state was first seen (the time of the event that changed it); an unchanged state keeps its time.
 *  - `ran`: the server was Running (`connected`) since it last started; `pending` (a start or a restart) clears it.
 *  - `afterRunning`: for a `failed` or `needs-auth` state, whether it was Running just before (a failure after running is
 *    "Disconnected later", not "Crashed on start"); false for every other state.
 */
export interface McpHealthMark {
  status: string;
  since: number;
  ran: boolean;
  afterRunning: boolean;
}

/** At most this many servers per session are tracked (the adapters cap their lists at 100). */
export const MCP_HEALTH_MAX = 200;

const isFailure = (s: string): boolean => s === 'failed' || s === 'needs-auth';

export function mcpHealthUpdate(
  prev: ReadonlyMap<string, McpHealthMark> | undefined,
  servers: ReadonlyArray<{ name?: unknown; status?: unknown }> | undefined,
  now: number,
): Map<string, McpHealthMark> {
  const out = new Map<string, McpHealthMark>();
  for (const x of Array.isArray(servers) ? servers : []) {
    if (out.size >= MCP_HEALTH_MAX) break;
    const name = x && typeof x.name === 'string' ? x.name : '';
    if (!name || name.length > 200 || out.has(name)) continue;
    const status = typeof x.status === 'string' ? x.status : '';
    const p = prev?.get(name);
    if (p && p.status === status) {
      out.set(name, { ...p });
      continue;
    }
    const ranBefore = p ? p.ran : false;
    const ran = status === 'connected' ? true : status === 'pending' ? false : ranBefore;
    out.set(name, { status, since: now, ran, afterRunning: isFailure(status) && ranBefore });
  }
  return out;
}
