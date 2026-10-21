import type { AdapterDescriptor, AdapterState, DetectResult } from './capabilities';
import type { AgentAdapter } from './types';
import type { AdapterInfo } from '../shared/adapters';

/** Pure: no SDK, no file system, no processes. Adapters are only instantiated by `create` (spec 012 FR-030..FR-033). */
const ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const STATES: readonly string[] = ['ready', 'not-installed', 'too-old', 'not-signed-in', 'unknown'];
const MAX_TEXT = 200;

export interface AdapterRegistry {
  list(): readonly AdapterDescriptor[];
  get(id: string): AdapterDescriptor | undefined;
  has(id: string): boolean;
  readonly defaultId: string;
  create(id: string): AgentAdapter;
}

export function createRegistry(descs: readonly AdapterDescriptor[]): AdapterRegistry {
  if (descs.length === 0) throw new Error('adapter registry: empty list');
  const byId = new Map<string, AdapterDescriptor>();
  for (const d of descs) {
    if (typeof d.id !== 'string' || !ID_RE.test(d.id)) throw new Error(`adapter registry: bad id ${JSON.stringify(d.id)}`);
    if (byId.has(d.id)) throw new Error(`adapter registry: duplicate id ${d.id}`);
    byId.set(d.id, d);
  }
  const all = [...descs];
  return {
    list: () => all,
    get: (id) => byId.get(id),
    has: (id) => byId.has(id),
    defaultId: all[0].id,
    create(id) {
      const d = byId.get(id);
      if (!d) throw new Error(`adapter registry: unknown adapter ${JSON.stringify(id)}`);
      return d.create();
    },
  };
}

function cleanText(v: unknown): string | undefined {
  return typeof v === 'string' ? v.trim().slice(0, MAX_TEXT) : undefined;
}

export async function detectAll(reg: AdapterRegistry, detect: (d: AdapterDescriptor) => Promise<DetectResult>): Promise<AdapterInfo[]> {
  return Promise.all(
    reg.list().map(async (d): Promise<AdapterInfo> => {
      let state: AdapterState = 'unknown';
      let version: string | undefined;
      let hint: string | undefined;
      let where: string | undefined;
      try {
        const got = await detect(d);
        // Read every field inside the try: a hostile getter must only cost this adapter.
        if (got && STATES.includes(got.state as string)) {
          const st = got.state;
          const v = cleanText(got.version);
          const h = cleanText(got.hint);
          state = st;
          version = v;
          hint = h;
          where = cleanText(got.where); // spec 060 FR-003
        }
      } catch {
        state = 'unknown';
        version = undefined;
        hint = undefined;
        where = undefined;
      }
      const info: AdapterInfo = {
        id: d.id,
        displayName: d.displayName,
        state,
        capabilities: JSON.parse(JSON.stringify(d.capabilities)),
      };
      if (version) info.version = version;
      if (hint) info.hint = hint;
      if (where) info.where = where;
      return info;
    }),
  );
}
