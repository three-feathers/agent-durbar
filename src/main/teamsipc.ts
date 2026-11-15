/**
 * Spec 111 T007 (FR-010, FR-023, FR-100, FR-133): what the window may ask of the team-template store, as pure functions of an injected store
 * (no Electron, no disk here): `scripts/test-teamsipc.ts` drives them. `src/main/ipc/teams.ts` is only the `ipcHandle` wiring.
 *
 * The window is partly untrusted (FR-023 trust model), so every argument is checked here and any doubt refuses:
 *  - a value that is not a plain object, too many members, a wrong type: refused with a fixed sentence naming the field, NEVER its value
 *    (Constitution III: a brief may hold a secret; no error, log or result echoes window text);
 *  - `memberId` and `briefFrom` are store-only. The window cannot set them: a `memberId` on a NEW template is refused; on an update it must be
 *    one the stored template has, once (a lookup by `Map`, never by position, never by a property of the argument); a member without one is new
 *    and main gives it one. `briefFrom: 'file'` is kept by `memberId` from the STORED member on every save; the window may echo it back
 *    (it reads it from `teams:list`) but never set it or clear it. `teams:markMine` is the only way to clear it for a member that keeps its
 *    `memberId`; a member sent as new loses it (FR-023 [KNOWN GAP]);
 *  - `origin`, `createdAt`, `updatedAt` are main's (the store ignores the window's): a window `put` always creates `own`.
 *    `putImported` of the store is not exposed here (spec 111 T010 builds the import in main).
 *
 * Reused, not rebuilt (FR-031): `TeamTemplateStore` (T006: validation at level `own`, the 50 cap, the save), `checkTeamTemplate` inside it, `LIMITS`.
 */
import { CHANGED_TEXT, LIMITS, MEMBER_ID_RE } from '../shared/teamtemplate';
import type { TeamMember } from '../shared/teamtemplate';
import type { TeamsList, TeamsOne, TeamsRemoved, TeamTemplateInfo } from '../shared/api';
import { CHANGED, SAVE_FAILED, newMemberId, type StoredTemplate, type TeamTemplateStore } from './teamstore';

export interface TeamsIpcOpsDeps {
  store(): TeamTemplateStore;
  /** a test injects a counter */
  newMemberId?: () => string;
}

/** the longest template id the validator accepts (`TEMPLATE_ID_RE`: 1..64); a longer string is refused before any lookup */
const ID_MAX = 64;

type Bad = { ok: false; code: 'invalid'; errors: string[]; blocked: boolean };

const isPlain = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v) as unknown;
  return p === Object.prototype || p === null;
};
/** an own data property only: `__proto__`, `constructor`, inherited and accessor properties never count */
const own = (o: Record<string, unknown>, k: string): unknown => {
  const d = Object.getOwnPropertyDescriptor(o, k);
  return d && 'value' in d ? d.value : undefined;
};
const hasOwn = (o: Record<string, unknown>, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/**
 * A copy of the argument made of its own DATA properties only (spec 111, 2026-11-12: copies only of own data properties): no spread, so no getter
 * runs and nothing inherited counts. A getter or setter, a non-plain object (a Proxy that lies, a class instance, a function) or a nesting
 * deeper than 8 throws; the caller answers one fixed sentence (an error here must never carry a value). `Object.fromEntries` defines own
 * properties, so an own `__proto__` key stays data and sets no prototype.
 */
const SNAP_DEPTH = 8;
/** bounds judged BEFORE any copy (spec 111, second read of #1640): own keys of the template, of a member, of any nested object; the total values of the copy */
export const MAX_TEMPLATE_KEYS = 32;
export const MAX_MEMBER_KEYS = 64;
export const MAX_VALUES = 5000;
class TooLarge extends Error {}
/**
 * True when `o` has more than `max` own keys. The engine still lists all the keys of the object before `for...in` starts (measured here: about 1 s
 * for 800,000 keys, the same as `Object.keys`; `[KNOWN GAP]` of spec 111, below the cost of the IPC clone of the same object), so this does NOT cut that
 * listing short. What it saves: no array of keys is built and no copy of the object is kept, and the loop stops at the limit. Only own keys count
 * (`for...in` also visits inherited enumerable ones).
 */
function moreKeysThan(o: object, max: number): boolean {
  let n = 0;
  for (const k in o) if (Object.prototype.hasOwnProperty.call(o, k) && ++n > max) return true;
  return false;
}
/** `b.left` is ONE budget for the whole copy: every value visited (a string, number, boolean, null, undefined, array or object) takes one. */
function snap(v: unknown, b: { left: number }, depth = 0): unknown {
  if (--b.left < 0) throw new TooLarge();
  if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (v === undefined) return undefined;
  if (typeof v !== 'object' || depth > SNAP_DEPTH) throw new Error('not data');
  if (Array.isArray(v)) {
    const len = v.length;
    if (len > 10000) throw new Error('not data');
    if (len > b.left) throw new TooLarge(); // refused before the first element is read
    const a: unknown[] = [];
    for (let i = 0; i < len; i++) a.push(snap(dataAt(v, String(i)), b, depth + 1));
    return a;
  }
  if (!isPlain(v)) throw new Error('not data');
  if (moreKeysThan(v, MAX_MEMBER_KEYS)) throw new TooLarge();
  const entries: [string, unknown][] = [];
  for (const k of Object.keys(v)) entries.push([k, snap(dataAt(v, k), b, depth + 1)]);
  return Object.fromEntries(entries);
}
function dataAt(o: object, k: string): unknown {
  const d = Object.getOwnPropertyDescriptor(o, k);
  if (!d || !('value' in d)) throw new Error('not data'); // an accessor, or a hole
  return d.value;
}
/** A stored template's members by `memberId`, or undefined when one has none or two share one (the store keeps this from happening; refuse if it does). One rule for `put` and `markMine`. */
function storedById(members: TeamMember[]): Map<string, TeamMember> | undefined {
  const by = new Map<string, TeamMember>();
  for (const m of members) {
    if (m.memberId === undefined || by.has(m.memberId)) return undefined;
    by.set(m.memberId, m);
  }
  return by;
}
const RELOAD = 'Template: reload it and try again.';

export class TeamsIpcOps {
  constructor(private readonly deps: TeamsIpcOpsDeps) {}
  private get store(): TeamTemplateStore { return this.deps.store(); }
  private mint(): string { return (this.deps.newMemberId ?? newMemberId)(); }

  private bad(errors: string[]): Bad { return { ok: false, code: 'invalid', errors, blocked: this.store.isBlocked() }; }
  /** A store refusal as the window gets it: it keeps its words (they name fields, never values) and says whether the file moved or the write failed. */
  private refusal(errors: string[]): { ok: false; code: 'invalid' | 'changed' | 'failed'; errors: string[]; blocked: boolean; templates?: TeamTemplateInfo[] } {
    const blocked = this.store.isBlocked();
    if (errors.length === 1 && errors[0] === CHANGED) return { ok: false, code: 'changed', errors: [CHANGED_TEXT], blocked, templates: this.store.list() }; // the store reloaded: the window shows the new list
    if (errors.length === 1 && errors[0] === SAVE_FAILED) return { ok: false, code: 'failed', errors: [SAVE_FAILED], blocked };
    return { ok: false, code: 'invalid', errors, blocked };
  }

  list(): TeamsList {
    return { ok: true, templates: this.store.list(), blocked: this.store.isBlocked(), setAside: this.store.takeToast() };
  }

  put(valueIn: unknown): TeamsOne {
    // judged BEFORE any copy, from the argument's own data properties (no getter runs): the members count, the keys of the template and of each member
    // (fixed sentences naming no key), then `snap` keeps one total budget of values. Each step is bounded work, whatever the window sent.
    try {
      if (isPlain(valueIn)) {
        const raw = Object.getOwnPropertyDescriptor(valueIn, 'members');
        if (raw && 'value' in raw && Array.isArray(raw.value) && raw.value.length > LIMITS.members) return this.bad([`Members: at most ${LIMITS.members}.`]);
        if (moreKeysThan(valueIn, MAX_TEMPLATE_KEYS)) return this.bad(['Template: too many fields.']);
        if (raw && 'value' in raw && Array.isArray(raw.value)) {
          for (let i = 0; i < raw.value.length; i++) {
            const d = Object.getOwnPropertyDescriptor(raw.value, String(i));
            if (d && 'value' in d && isPlain(d.value) && moreKeysThan(d.value, MAX_MEMBER_KEYS)) return this.bad(['Member: too many fields.']);
          }
        }
      }
    } catch { return this.bad(['Template: send plain data.']); }
    let value: unknown;
    try { value = snap(valueIn, { left: MAX_VALUES }); } catch (e) { return this.bad([e instanceof TooLarge ? 'Template: too large.' : 'Template: send plain data.']); }
    if (!isPlain(value)) return this.bad(['Template: send an object.']);
    const idv = own(value, 'id');
    if (idv !== undefined && (typeof idv !== 'string' || idv.length === 0 || idv.length > ID_MAX)) return this.bad(['Template id: not valid.']);
    const cur: StoredTemplate | undefined = typeof idv === 'string' ? this.store.get(idv) : undefined;
    if (idv !== undefined && !cur) return this.bad(['Template: not found.']);
    const mem = own(value, 'members');
    if (!Array.isArray(mem)) return this.bad(['Members: send a list.']);
    if (mem.length > LIMITS.members) return this.bad([`Members: at most ${LIMITS.members}.`]);
    let stored = new Map<string, TeamMember>();
    if (cur) {
      const by = storedById(cur.members);
      if (!by) return this.bad([RELOAD]);
      stored = by;
    }
    const used = new Set<string>();
    const out: Record<string, unknown>[] = [];
    for (let i = 0; i < mem.length; i++) {
      const m = mem[i] as unknown;
      const at = `Member ${i + 1}`;
      if (!isPlain(m)) return this.bad([`${at}: send an object.`]);
      const mid = own(m, 'memberId');
      const from = own(m, 'briefFrom');
      const next: Record<string, unknown> = Object.fromEntries(Object.keys(m).filter((k) => k !== 'memberId' && k !== 'briefFrom').map((k) => [k, own(m, k)]));
      if (mid === undefined && !hasOwn(m, 'memberId')) {
        // a new member: it gets an id, and cannot arrive with the file mark
        if (from !== undefined || hasOwn(m, 'briefFrom')) return this.bad([`${at}, briefFrom: the window cannot set it.`]);
        next.memberId = this.mint();
      } else {
        if (!cur) return this.bad([`${at}, memberId: the window cannot set it.`]);
        if (typeof mid !== 'string' || !MEMBER_ID_RE.test(mid)) return this.bad([`${at}, memberId: not valid.`]);
        const was = stored.get(mid);
        if (!was) return this.bad([`${at}, memberId: not a member of this template.`]);
        if (used.has(mid)) return this.bad([`${at}, memberId: used twice.`]);
        used.add(mid);
        next.memberId = mid;
        // the window may echo the mark it read, never add one; the stored mark stays whatever the window sends
        if (from !== undefined && !(from === 'file' && was.briefFrom === 'file')) return this.bad([`${at}, briefFrom: the window cannot change it.`]);
        if (was.briefFrom === 'file') next.briefFrom = 'file';
      }
      out.push(next);
    }
    const t = Object.fromEntries(Object.keys(value).filter((k) => k !== 'members').map((k) => [k, own(value, k)]));
    t.members = out;
    const r = this.store.put(t);
    return r.ok ? { ok: true, template: r.template } : this.refusal(r.errors);
  }

  delete(id: unknown): TeamsRemoved {
    if (typeof id !== 'string' || id.length === 0 || id.length > ID_MAX) return this.bad(['Template id: not valid.']);
    const r = this.store.delete(id);
    return r.ok ? { ok: true, removed: r.removed } : this.refusal(r.errors);
  }

  duplicate(id: unknown): TeamsOne {
    if (typeof id !== 'string' || id.length === 0 || id.length > ID_MAX) return this.bad(['Template id: not valid.']);
    const r = this.store.duplicate(id);
    return r.ok ? { ok: true, template: r.template } : this.refusal(r.errors);
  }

  /**
   * The one way to remove a brief's file mark (FR-023). Exactly two string arguments; any extra argument or field is refused, so the call
   * can change nothing but that mark. Main re-checks that the template and the member exist and that the member carries the mark.
   */
  markMine(templateId: unknown, memberId: unknown, ...extra: unknown[]): TeamsOne {
    if (extra.length > 0) return this.bad(['Mark as mine: send a template id and a member id only.']);
    if (typeof templateId !== 'string' || templateId.length === 0 || templateId.length > ID_MAX) return this.bad(['Template id: not valid.']);
    if (typeof memberId !== 'string' || !MEMBER_ID_RE.test(memberId)) return this.bad(['Member id: not valid.']);
    const cur = this.store.get(templateId);
    if (!cur) return this.bad(['Template: not found.']);
    const byId = storedById(cur.members);
    if (!byId) return this.bad([RELOAD]);
    const m = byId.get(memberId);
    if (!m) return this.bad(['Member: not found.']);
    if (m.briefFrom !== 'file') return this.bad(['Member: its brief is not marked as from a file.']);
    const members = cur.members.map((x) => { if (x !== m) return x; const y = { ...x }; delete y.briefFrom; return y; });
    const r = this.store.put({ ...cur, members });
    return r.ok ? { ok: true, template: r.template } : this.refusal(r.errors);
  }
}
