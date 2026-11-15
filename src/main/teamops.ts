/**
 * Spec 111 T010 (FR-030..FR-033, FR-037, FR-039; the delta of 2026-11-14, *the create preview*): what main shows before a team is created, as pure
 * logic over injected dependencies (no Electron, no disk, no adapter here): `scripts/test-teamops.ts` drives it with fakes.
 * `src/main/ipc/teams.ts` is only the `ipcHandle` wiring (`teams:createPreview`, `teams:previewRow`).
 *
 * What it does: a row per stored member, built from the app's state (`adapters:list`), the model's presence and `orgBlocked` (`models:list`, one
 * shared `modelsOf`), the effort (an effort the model does not offer falls to its `defaultEffort`; an IMPORTED effort above `defaultEffort` is not
 * taken unless the person picks it), cost words from `priceClass`/`multiplier`, limit words from the app's unit. A token (128 bits, 10 minutes,
 * one alive at a time) keeps the snapshot of the template, the room key and the rows; `takeToken` hands it to `teams:create` (T011) once.
 *
 * Safety (Constitution III): templates from a file are data of others. The preview never raises a mode (an imported Allow all shows as Ask), never
 * sets a limit nobody chose, never touches Autopilot, never starts or lists anything of an agent app (no profile listing: it would start a session).
 * Nothing the window gets back holds free template text (name, role, brief) or a path: only ids of the shapes the validator and the adapter list
 * give, numbers and fixed sentences. A refusal is a fixed sentence naming the field, never its value. The window's arguments are judged for size
 * BEFORE they are copied (no spread, own data properties only).
 *
 * Reused, not rebuilt (FR-031 of spec 021): `StoredTemplate`, `startCap`, `parseCapIn`, `parseEffort`, `validMode`, the shape tests of
 * `teamtemplate.ts` and the argument helpers of `teamsipc.ts`.
 */
import { randomBytes } from 'crypto';
import { isDeepStrictEqual } from 'util';
import type { AdapterInfo } from '../shared/adapters';
import type { AgentInfo, ModelChoice } from '../shared/api';
import { cleanDisplayName } from '../shared/names';
import { parseEffort } from '../shared/effort';
import { parseCapIn, startCap } from '../shared/credits';
import { APP_RE, LIMITS, MEMBER_ID_RE, MODEL_RE } from '../shared/teamtemplate';
import type { TeamMember } from '../shared/teamtemplate';
import { validMode } from './agentops';
import type { StoredTemplate } from './teamstore';
import { isPlain, moreKeysThan, own } from './teamsipc';
import { findAdded } from './addkey';
import type { SavedPermMode, TeamRecord, TeamRecordMember } from './folders';

/** how long a preview's token lives (the delta of 2026-11-14) */
export const TOKEN_MS = 600_000;
const TOKEN_RE = /^[0-9a-f]{32}$/;
const ID_MAX = 64;
const ROOM_MAX = 200;

export type Unit = 'aiu' | 'usd' | 'none';
export type Tier = 'low' | 'medium' | 'high' | 'very-high' | 'not-reported';
export type Perm = 'read-only' | 'ask' | 'allow';

export interface PreviewRow {
  memberId: string;
  app: { id: string; state: 'ready' | 'not-ready' | 'unknown'; words: string };
  model: { id: string; present: boolean; orgBlocked: boolean; words: string };
  effort: { asked?: string; used?: string; note: '' | 'falls to the default' | 'imported above the default' | 'picked' };
  cost: { tier: Tier; multiplier?: number; words: string };
  limit: { unit: Unit; amount?: number; source: 'member' | 'folder' | 'default' | 'none'; words: string };
  needsChoice: boolean;
  reasons: string[];
  perm: Perm;
  profile: boolean;
  fromFile: boolean;
}
export interface PreviewSummary { total: number; needsChoice: number; high: number; veryHigh: number }
export interface PreviewApp { id: string; ready: boolean; stateWords: string; capUnit: Unit }
export type PreviewFail = { ok: false; code: 'invalid' | 'notfound' | 'empty' | 'cancelled' | 'failed'; errors: string[]; blocked: boolean };
export type PreviewOk = {
  ok: true; token: string; expiresAt: number; template: { id: string; imported: boolean }; existing: number;
  apps: PreviewApp[]; rows: PreviewRow[]; summary: PreviewSummary; canCreate: boolean;
};
export type RowOk = { ok: true; row: PreviewRow; summary: PreviewSummary; canCreate: boolean };

export type Target = { room: string } | { pick: true };
/** `savedCap`: the limit (AI credits) the target folder already has saved, if any (the add path's `folderStore.get(key).maxAiCredits`) */
export type ResolvedTarget = { ok: true; key: string; existing: number; savedCap?: number } | { ok: false; cancelled?: boolean };

/** What main gives `resolveTargetFrom`: the open agents, the folder store's saved limit, the dialog (or `DURBAR_PICK`), and the add flows' own path resolution. */
export interface TargetEnv<A> {
  agents(): Iterable<A>;
  /** main's `wsKey`: the workspace file, else the folder */
  wsKey(a: A): string;
  /** main's `resolveWorkspaceCwd` */
  resolveCwd(p: string): { cwd: string; workspaceFile?: string };
  savedCap(key: string): number | undefined;
  /** the members the room's team record already has (T011: the real count, not a guess); absent = 0 */
  teamCount?(key: string): number;
  /** the folder dialog: the chosen path, or null when cancelled */
  pick(): Promise<string | null>;
  /** tests inject these two (`addkey.ts`) */
  platform?: string;
  realpath?: (p: string) => string;
}
const teamCountOf = <A>(env: TargetEnv<A>, key: string): number => { const n = env.teamCount?.(key); return typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= LIMITS.members ? n : 0; };
const cleanCap = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

/**
 * The target of a preview, with the key the add flows use (spec 111, second read of T010): a room is its agent's `wsKey`; a picked folder is
 * `resolveWorkspaceCwd` then `findAdded` over the open agents, so a symlink, a trailing slash or (Windows, macOS) another case is the SAME room;
 * else the resolved path. `existing` is the real count of the room's team record (T011). The key never goes to the window.
 */
export async function resolveTargetFrom<A>(t: Target, env: TargetEnv<A>): Promise<ResolvedTarget> {
  if ('room' in t) {
    for (const a of env.agents()) if ((a as { id?: unknown }).id === t.room) { const key = env.wsKey(a); return { ok: true, key, existing: teamCountOf(env, key), savedCap: cleanCap(env.savedCap(key)) }; }
    return { ok: false };
  }
  const p = await env.pick();
  if (!p) return { ok: false, cancelled: true };
  const ws = env.resolveCwd(p);
  const want = ws.workspaceFile ?? ws.cwd;
  const have = findAdded(want, env.agents(), env.wsKey, env.platform, env.realpath);
  const key = have ? env.wsKey(have) : want;
  return { ok: true, key, existing: teamCountOf(env, key), savedCap: cleanCap(env.savedCap(key)) };
}

export interface TeamOpsDeps {
  /** only `get` is used */
  store(): { get(id: string): StoredTemplate | undefined };
  adapters(): Promise<AdapterInfo[]>;
  /** the models of one app as `models:list` answers (`modelsOf` of `ipc/model.ts`); may throw */
  models(appId: string): Promise<ModelChoice[]>;
  /** the person's default limit in AI credits (settings), or undefined */
  defaultCapAiu(): number | undefined;
  /** an opaque key for the room (or the folder main's own dialog picked) and the members it already has; never a path for the window */
  resolveTarget(t: Target): Promise<ResolvedTarget>;
  now?: () => number;
  newToken?: () => string;
  /** T011 (`teams:create`): the room, the build of one not-started agent, the one write, the placing in the office. Absent: `create` answers `failed`. */
  create?: CreateDeps;
  /** a random 128-bit hex id for a member whose id the room's record already has (tests inject it) */
  newMemberId?: () => string;
}

/** what main builds one not-started member from: all of it already validated here */
export interface LazyMemberSpec { app: string; model: string | undefined; effort: string | undefined; mode: SavedPermMode; cap: number | undefined; name: string; key: string }
export interface CreateDeps {
  /** the real count and record of the room's key and its saved limit, read fresh */
  room(key: string): { count: number; savedCap?: number; team?: TeamRecord; known?: boolean };
  /** `addLazyMember`: one not-started agent like a restored session (`infoFor(..., { lazy: true })`); no adapter start; no effect in the office */
  build(spec: LazyMemberSpec): AgentInfo;
  /** ONE write: the team record and the members' session names (`setTeamRecord`); false = nothing was written */
  commit(key: string, team: TeamRecord, infos: AgentInfo[]): boolean;
  /** after the write: bind the agent to its app and add it to the office; tells the window nothing (see `announce`) */
  place(info: AgentInfo): void;
  /** undo of `place`: idempotent (an agent that is not there is not an error) */
  unplace(id: string): void;
  /** `agent:added` for a member, only after EVERY member of the batch was placed (no removal event exists, so the window is never told of a member that may be removed) */
  announce(info: AgentInfo): void;
  /** puts the room's record back as it was before the batch (`previous` undefined = none), drops the batch's names and a room the write created; false when it failed */
  rollback(key: string, previous: TeamRecord | undefined, infos: AgentInfo[], removeRoom: boolean): boolean;
}

/** `choices` of `teams:create` (the delta of 2026-11-15): only what the person changed, all re-validated */
export interface RowChoice { include?: boolean; app?: string; model?: string; effort?: string; cap?: { unit: 'aiu' | 'usd'; amount: number | string } }
export interface CreateChoices { rows: Record<string, RowChoice>; allowConfirmed?: boolean }
export type CreateFail = { ok: false; code: 'invalid' | 'notfound' | 'full' | 'expired' | 'changed' | 'needschoice' | 'empty' | 'failed'; errors: string[]; blocked: boolean };
export type CreateOk = { ok: true; agents: AgentInfo[]; added: number; existing: number };

/** what a row is now: the template's values, then the person's changes (`teams:previewRow`) */
interface Choice { app: string; model: string | undefined; effort: string | undefined; picked: boolean; appChanged: boolean }
export interface PreviewEntry {
  token: string; expiresAt: number; key: string; existing: number; savedCap: number | undefined;
  /** the template as it was when the preview was built; T011 compares it with the store to see a change */
  template: StoredTemplate;
  choices: Map<string, Choice>;
  rows: Map<string, PreviewRow>;
}

const CHANGED_AFTER = 'The template changed after the preview. Open it again.';
const CHANGED_NOW = CHANGED_AFTER;
const cfail = (code: CreateFail['code'], error: string): CreateFail => ({ ok: false, code, errors: [error], blocked: false });
const fail = (code: PreviewFail['code'], error: string): PreviewFail => ({ ok: false, code, errors: [error], blocked: false });

const STATE_WORDS: Record<string, string> = {
  ready: 'Ready', 'not-installed': 'Not installed', 'too-old': 'Needs an update', 'not-signed-in': 'Not signed in', unknown: 'Not checked',
};
const TIER_WORDS: Record<string, string> = { low: 'Low cost tier', medium: 'Medium cost tier', high: 'High cost tier', 'very-high': 'Very high cost tier' };

const unitOf = (i: AdapterInfo): Unit => (i.capabilities?.caps === false ? 'none' : i.capabilities?.capUnit === 'usd' ? 'usd' : 'aiu');
const num2 = (n: number): string => String(Math.round(n * 100) / 100);

/** the argument checks: shape and size, before any copy; a fixed sentence, never the value */
function readTarget(v: unknown): Target | string {
  if (!isPlain(v)) return 'Target: send an object.';
  if (moreKeysThan(v, 2)) return 'Target: not valid.';
  const room = own(v, 'room'), pick = own(v, 'pick');
  const keys = Object.keys(v);
  if (keys.length !== 1) return 'Target: not valid.';
  if (keys[0] === 'pick' && pick === true) return { pick: true };
  if (keys[0] === 'room' && typeof room === 'string' && room.length > 0 && room.length <= ROOM_MAX) return { room };
  return 'Target: not valid.';
}
type Change = { app?: string; model?: string; effort?: string };
function readChange(v: unknown): Change | string {
  if (!isPlain(v)) return 'Change: send an object.';
  if (moreKeysThan(v, 3)) return 'Change: not valid.';
  const out: Change = {};
  let any = false;
  for (const k of Object.keys(v)) {
    const x = own(v, k);
    if (k === 'app') { if (typeof x !== 'string' || x.length > 32 || !APP_RE.test(x)) return 'Change, app: not valid.'; out.app = x; }
    else if (k === 'model') { if (typeof x !== 'string' || x.length > 100 || (x !== '' && !MODEL_RE.test(x))) return 'Change, model: not valid.'; out.model = x; }
    else if (k === 'effort') { if (typeof x !== 'string' || x.length > 20 || (x !== '' && parseEffort(x) === undefined)) return 'Change, effort: not valid.'; out.effort = x; }
    else return 'Change: not valid.';
    any = true;
  }
  return any ? out : 'Change: nothing to change.';
}

export class TeamOps {
  private live: PreviewEntry | undefined;
  /** counts every `createPreview` start: a slower, older call must not replace a newer preview */
  private gen = 0;
  constructor(private readonly deps: TeamOpsDeps) {}
  private now(): number { return (this.deps.now ?? Date.now)(); }

  /** `teams:create` (T011) takes the preview once: a second take, another token or an expired one answers undefined (and an expired one is dropped) */
  takeToken(token: unknown): PreviewEntry | undefined {
    const e = this.live;
    if (!e || typeof token !== 'string' || !TOKEN_RE.test(token) || token !== e.token) return undefined;
    this.live = undefined;
    return this.now() < e.expiresAt ? e : undefined;
  }
  /** the live entry for a token, without taking it; an expired one is dropped */
  private peek(token: unknown): PreviewEntry | undefined {
    const e = this.live;
    if (!e || typeof token !== 'string' || !TOKEN_RE.test(token) || token !== e.token) return undefined;
    if (this.now() >= e.expiresAt) { this.live = undefined; return undefined; }
    return e;
  }

  async createPreview(targetIn: unknown, templateId: unknown): Promise<PreviewOk | PreviewFail> {
    // a new preview drops the old one FIRST: before the arguments are judged, so also an invalid call drops it
    const me = ++this.gen;
    this.live = undefined;
    const target = readTarget(targetIn);
    if (typeof target === 'string') return fail('invalid', target);
    if (typeof templateId !== 'string' || templateId.length === 0 || templateId.length > ID_MAX) return fail('invalid', 'Template id: not valid.');
    const t = this.deps.store().get(templateId);
    if (!t) return fail('notfound', 'Template: not found.');
    if (!Array.isArray(t.members) || t.members.length === 0) return fail('empty', 'This template has no members.');
    if (t.members.length > LIMITS.members) return fail('invalid', `Members: at most ${LIMITS.members}.`);
    const r = await this.deps.resolveTarget(target);
    if (!r.ok) return r.cancelled === true ? fail('cancelled', 'No folder was chosen.') : fail('invalid', 'The room could not be found.');
    const adapters = await this.deps.adapters();
    const ctx = this.context(adapters, r.savedCap);
    const choices = new Map<string, Choice>();
    const rows = new Map<string, PreviewRow>();
    const imported = t.origin === 'imported';
    for (const m of t.members) {
      if (typeof m.memberId !== 'string' || !MEMBER_ID_RE.test(m.memberId) || choices.has(m.memberId)) return fail('invalid', 'Template: reload it and try again.');
      const ch: Choice = { app: m.app, model: m.model, effort: m.effort, picked: false, appChanged: false };
      choices.set(m.memberId, ch);
      rows.set(m.memberId, await this.row(m, imported, ch, ctx));
    }
    if (me !== this.gen) return fail('cancelled', 'This preview was replaced by a newer one.');
    const token = (this.deps.newToken ?? (() => randomBytes(16).toString('hex')))();
    const entry: PreviewEntry = { token, expiresAt: this.now() + TOKEN_MS, key: r.key, existing: r.existing, savedCap: r.savedCap, template: t, choices, rows };
    this.live = entry;
    const list = [...rows.values()];
    const summary = summarize(list);
    return {
      ok: true, token, expiresAt: entry.expiresAt, template: { id: String(t.id), imported }, existing: r.existing,
      apps: adapters.map((i) => ({ id: i.id, ready: i.state === 'ready', stateWords: STATE_WORDS[i.state] ?? STATE_WORDS.unknown, capUnit: unitOf(i) })),
      rows: list, summary, canCreate: summary.needsChoice === 0,
    };
  }

  /**
   * A change to one row (app, model, effort): only that row is worked out again, with the same rules; nothing is converted. The token is checked
   * FIRST (a wrong or expired one never reaches an adapter). Calls may overlap: when its awaits are done, each call MERGES its change into the
   * CURRENT stored choices (never into a copy read before waiting) and works the row out from that state, again if a newer merge came meanwhile,
   * so a slower call cannot overwrite what a newer one chose.
   */
  async previewRow(token: unknown, rowId: unknown, changeIn: unknown): Promise<RowOk | PreviewFail> {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) return fail('invalid', 'Preview: not valid.');
    if (typeof rowId !== 'string' || !MEMBER_ID_RE.test(rowId)) return fail('invalid', 'Row: not valid.');
    const change = readChange(changeIn);
    if (typeof change === 'string') return fail('invalid', change);
    const e = this.peek(token);
    if (!e) return fail('notfound', 'Preview: expired or not found. Open it again.');
    const m = e.template.members.find((x) => x.memberId === rowId);
    if (!m || !e.choices.has(rowId)) return fail('notfound', 'Row: not found.');
    const ctx = this.context(await this.deps.adapters(), e.savedCap);
    if (this.peek(token) !== e) return fail('notfound', 'Preview: expired or not found. Open it again.'); // replaced while it waited
    const ch = e.choices.get(rowId)!; // the CURRENT choices, read after the wait
    const next: Choice = { app: ch.app, model: ch.model, effort: ch.effort, picked: ch.picked, appChanged: ch.appChanged };
    if (change.app !== undefined && change.app !== ch.app) {
      // another app: its model, effort and limit are not this one's; the limit is dropped, never converted
      next.app = change.app; next.model = undefined; next.effort = undefined; next.picked = false; next.appChanged = true;
    }
    if (change.model !== undefined) { next.model = change.model === '' ? undefined : change.model; next.picked = false; }
    if (change.effort !== undefined) { next.effort = change.effort === '' ? undefined : change.effort; next.picked = change.effort !== ''; }
    e.choices.set(rowId, next); // merged at once; the row is worked out from what is stored
    const imported = e.template.origin === 'imported';
    for (;;) {
      const cur = e.choices.get(rowId)!;
      const row = await this.row(m, imported, cur, ctx);
      if (this.peek(token) !== e) return fail('notfound', 'Preview: expired or not found. Open it again.');
      if (e.choices.get(rowId) !== cur) continue; // a newer call merged meanwhile: work it out again from the newest state
      e.rows.set(rowId, row);
      const summary = summarize([...e.rows.values()]);
      return { ok: true, row, summary, canCreate: summary.needsChoice === 0 };
    }
  }

  /**
   * `teams:create` (T011, FR-034, FR-035, FR-039, FR-040, FR-043; the delta of 2026-11-15). Takes the token ONCE; uses only the `choices` of THIS call
   * (the entry's own choices and rows are for display); compares the template snapshot with the store; re-checks every included row with the same
   * rules as the preview (`row`); then, with no `await` in between, counts the room's members, builds the not-started agents, writes the record
   * (one `commit`) and only then places them. No adapter is started and no message sent here. Autopilot is never set; the mode never rises above
   * the template's (an imported Allow all and an unconfirmed own one enter as Ask). A refusal is a fixed sentence, never a value.
   */
  /** the template as the store has it now, equal to the snapshot of the preview */
  private unchanged(t: StoredTemplate): boolean {
    const now = t.id === undefined ? undefined : this.deps.store().get(String(t.id));
    return now !== undefined && isDeepStrictEqual(now, t);
  }

  async create(tokenIn: unknown, choicesIn: unknown): Promise<CreateOk | CreateFail> {
    const e = this.takeToken(tokenIn); // consumed here, once, also when the rest is refused
    if (!e) return cfail('expired', 'Preview: expired or not found. Open it again.');
    const dep = this.deps.create;
    if (!dep) return cfail('failed', 'The team could not be created.');
    const choices = readChoices(choicesIn);
    if (typeof choices === 'string') return cfail('invalid', choices);
    const t = e.template;
    if (!this.unchanged(t)) return cfail('changed', CHANGED_AFTER);
    const ids = new Set(t.members.map((m) => m.memberId));
    for (const id of Object.keys(choices.rows)) if (!ids.has(id)) return cfail('invalid', 'Choices: a row is not in this preview.');
    const imported = t.origin === 'imported';
    const ctx = this.context(await this.deps.adapters(), cleanCap(dep.room(e.key).savedCap));
    const picked: Array<{ m: TeamMember; spec: Omit<LazyMemberSpec, 'key'>; name: string; role: string }> = [];
    for (const m of t.members) {
      const rc = choices.rows[String(m.memberId)] ?? {};
      if (rc.include === false) continue;
      const app = rc.app ?? m.app;
      const appChanged = app !== m.app;
      const ch: Choice = {
        app,
        model: rc.model !== undefined ? (rc.model === '' ? undefined : rc.model) : appChanged ? undefined : m.model,
        effort: rc.effort !== undefined ? (rc.effort === '' ? undefined : rc.effort) : appChanged ? undefined : m.effort,
        picked: rc.effort !== undefined && rc.effort !== '', appChanged,
      };
      const row = await this.row(m, imported, ch, ctx);
      if (row.needsChoice) return cfail('needschoice', 'A row still needs a choice.');
      const unit = row.limit.unit;
      let cap = row.limit.amount;
      if (rc.cap !== undefined) {
        if (unit === 'none') return cfail('invalid', 'Choices, limit: not valid.'); // an app with no limit takes none
        if (!appChanged) { // the limit of the app the template named; with another app it is ignored (never converted)
          if (rc.cap.unit !== unit) return cfail('invalid', 'Choices, limit: not valid.');
          cap = parseCapIn(unit, rc.cap.amount);
          if (cap === undefined) return cfail('invalid', 'Choices, limit: not valid.');
        }
      }
      // the mode: the template's, never raised; an imported Allow all and an own one nobody confirmed enter as Ask (FR-035, FR-096)
      let mode: SavedPermMode = validMode(m.permMode);
      if (mode === 'allow' && (imported || choices.allowConfirmed !== true)) mode = 'ask';
      const name = cleanDisplayName(m.name, LIMITS.name);
      const role = cleanDisplayName(m.role, LIMITS.role);
      if (!name || !role) return cfail('failed', 'The team could not be created.');
      picked.push({ m, name, role, spec: { app, model: row.model.id === '' ? undefined : row.model.id, effort: parseEffort(row.effort.used), mode, cap: unit === 'none' ? undefined : cap, name } });
    }
    if (picked.length === 0) return cfail('empty', 'No member is included.');
    // ---- from here to the write there is no `await`: two creates in one room cannot both pass the count
    if (!this.unchanged(t)) return cfail('changed', CHANGED_NOW); // again: it may have been edited during the awaits above
    const room = dep.room(e.key);
    const have = Number.isInteger(room.count) && room.count > 0 ? room.count : 0;
    if (have + picked.length > LIMITS.members) return cfail('full', `This room has ${have} team members; this template adds ${picked.length}; at most ${LIMITS.members}`);
    const infos = picked.map((x) => dep.build({ ...x.spec, key: e.key }));
    const taken = new Set((room.team?.members ?? []).map((x) => x.memberId));
    const made: TeamRecordMember[] = picked.map((x, i) => {
      let memberId = String(x.m.memberId);
      while (taken.has(memberId)) memberId = (this.deps.newMemberId ?? (() => randomBytes(16).toString('hex')))();
      taken.add(memberId);
      const u = x.spec.cap === undefined ? undefined : unitOf(ctx.apps.get(x.spec.app)!);
      return {
        memberId, name: x.name, role: x.role, ...(x.m.brief !== undefined && x.m.brief !== '' ? { brief: x.m.brief } : {}), ...(x.m.briefFrom === 'file' ? { briefFrom: 'file' as const } : {}),
        sendBrief: x.m.sendBrief !== false, app: x.spec.app, ...(x.spec.model !== undefined ? { model: x.spec.model } : {}), ...(x.spec.effort !== undefined ? { effort: x.spec.effort } : {}),
        mode: x.spec.mode, ...(x.spec.cap !== undefined && u && u !== 'none' ? { cap: { unit: u, amount: x.spec.cap } } : {}),
        ...(x.m.profile !== undefined ? { profile: x.m.profile } : {}), sessions: [{ id: infos[i].id }],
      };
    });
    const name = cleanDisplayName(t.name, 60);
    const names = [...(room.team?.templates ?? [])];
    if (name && !names.includes(name)) names.push(name);
    const team: TeamRecord = { templates: names.slice(-LIMITS.members), members: [...(room.team?.members ?? []), ...made] };
    if (!dep.commit(e.key, team, infos)) return cfail('failed', 'The team could not be created.');
    // step (c): a `place` that throws midway undoes the WHOLE batch (the one that threw too: `unplace` is idempotent) and puts the record back
    try {
      for (const info of infos) dep.place(info);
    } catch (err) {
      for (const info of infos) { try { dep.unplace(info.id); } catch { /* best effort */ } }
      try { dep.rollback(e.key, room.team, infos, room.known === false); } catch { /* the answer is `failed` all the same */ }
      throw err;
    }
    for (const info of infos) { try { dep.announce(info); } catch { /* the team exists and is written; a window that missed one shows it at its next refresh */ } }
    return { ok: true, agents: infos, added: infos.length, existing: have };
  }

  private context(adapters: AdapterInfo[], savedCap: number | undefined): Ctx {
    const apps = new Map<string, AdapterInfo>();
    for (const i of adapters) apps.set(i.id, i);
    const cache = new Map<string, Promise<ModelChoice[] | undefined>>();
    return {
      apps,
      models: (id) => {
        let p = cache.get(id);
        if (!p) { p = this.deps.models(id).then((l) => (Array.isArray(l) ? l : undefined), () => undefined); cache.set(id, p); }
        return p;
      },
      defaultCap: this.deps.defaultCapAiu(),
      savedCap,
    };
  }

  private async row(m: TeamMember, imported: boolean, ch: Choice, ctx: Ctx): Promise<PreviewRow> {
    const reasons: string[] = [];
    const info = ctx.apps.get(ch.app);
    const ready = info !== undefined && info.state === 'ready';
    const state: PreviewRow['app']['state'] = info === undefined ? 'unknown' : ready ? 'ready' : 'not-ready';
    if (!info) reasons.push('This app is not known in this version.');
    else if (!ready) reasons.push('This app is not ready.');
    // model: never preselected; no model asked = the app's default
    let model: PreviewRow['model'] = { id: ch.model ?? '', present: ch.model === undefined, orgBlocked: false, words: ch.model === undefined ? 'App default' : 'Not checked' };
    let found: ModelChoice | undefined;
    if (ch.model !== undefined && ready) {
      const list = await ctx.models(ch.app);
      if (list === undefined) { model = { id: ch.model, present: false, orgBlocked: false, words: 'Models could not be listed' }; reasons.push('The models of this app could not be listed.'); }
      else {
        found = new Map(list.map((x) => [x.id, x] as const)).get(ch.model);
        if (!found) { model = { id: ch.model, present: false, orgBlocked: false, words: 'Not offered here' }; reasons.push('This model is not offered here.'); }
        else if (typeof found.orgBlocked === 'string' && found.orgBlocked !== '') { model = { id: ch.model, present: true, orgBlocked: true, words: 'Blocked by your organization' }; reasons.push('This model is blocked by your organization.'); }
        else model = { id: ch.model, present: true, orgBlocked: false, words: 'Offered' };
      }
    }
    // effort
    const effort: PreviewRow['effort'] = { note: '' };
    if (ch.effort !== undefined) effort.asked = ch.effort;
    if (ch.effort !== undefined) {
      if (found) {
        const offered = Array.isArray(found.efforts) ? found.efforts : [];
        const def = typeof found.defaultEffort === 'string' ? found.defaultEffort : undefined;
        if (!offered.includes(ch.effort)) { if (def !== undefined) effort.used = def; effort.note = 'falls to the default'; }
        else if (ch.picked) { effort.used = ch.effort; effort.note = 'picked'; }
        else if (imported && !(def !== undefined && offered.includes(def) && offered.indexOf(ch.effort) <= offered.indexOf(def))) { if (def !== undefined) effort.used = def; effort.note = 'imported above the default'; }
        else effort.used = ch.effort;
      } else if (model.present && ch.model === undefined) {
        // the app's default model: its list is not looked at, so an imported effort cannot be compared with a default and is not taken
        if (ch.picked || !imported) { effort.used = ch.effort; if (ch.picked) effort.note = 'picked'; } else effort.note = 'imported above the default';
      } else if (ch.picked) effort.note = 'picked';
    }
    // cost
    const cost: PreviewRow['cost'] = { tier: 'not-reported', words: 'Cost not reported' };
    if (found) {
      const pc = found.priceClass;
      if (pc === 'low' || pc === 'medium' || pc === 'high' || pc === 'very-high') { cost.tier = pc; cost.words = TIER_WORDS[pc]; }
      if (typeof found.multiplier === 'number' && Number.isFinite(found.multiplier) && found.multiplier > 0) {
        cost.multiplier = found.multiplier;
        cost.words = cost.tier === 'not-reported' ? `${num2(found.multiplier)}x` : `${cost.words}, ${num2(found.multiplier)}x`;
      }
    }
    // limit: in the app's unit; the template's own only when it is in that unit and the app did not change; the default only where the unit allows one
    const unit: Unit = info ? unitOf(info) : 'none';
    const limit: PreviewRow['limit'] = { unit, source: 'none', words: '' };
    if (!info) limit.words = 'Choose an app first';
    else if (unit === 'none') limit.words = 'This app has no spending limit in Agent Durbar';
    else {
      let amount: number | undefined;
      if (!ch.appChanged && m.cap && m.cap.unit === unit) amount = parseCapIn(unit, m.cap.amount);
      if (amount !== undefined) { limit.amount = amount; limit.source = 'member'; }
      else {
        // the add path's order (spec 011): the folder's saved limit, then the settings default; a dollar limit only when chosen
        const f = startCap(unit, undefined, ctx.savedCap, undefined);
        const d = f ?? startCap(unit, undefined, undefined, ctx.defaultCap);
        if (d !== undefined) { limit.amount = d; limit.source = f !== undefined ? 'folder' : 'default'; }
      }
      const dropped = ch.appChanged || (m.cap !== undefined && m.cap.unit !== unit && limit.source !== 'member');
      limit.words = limit.amount === undefined ? 'No limit' : unit === 'usd' ? `Limit: ${limit.amount.toFixed(2)} USD (estimate)` : `Limit: ${num2(limit.amount)} AI credits${limit.source === 'default' ? ' (your default)' : limit.source === 'folder' ? ' (saved for this folder)' : ''}`;
      if (dropped && limit.source !== 'member') limit.words += '. The earlier limit was dropped: it is not converted between units.';
    }
    // permissions: what is stored, never raised; an imported Allow all shows as Ask (FR-096)
    let perm: Perm = validMode(m.permMode);
    if (imported && perm === 'allow') perm = 'ask';
    return {
      memberId: String(m.memberId), app: { id: ch.app, state, words: info ? STATE_WORDS[info.state] ?? STATE_WORDS.unknown : 'Not available' }, model, effort, cost, limit,
      needsChoice: reasons.length > 0, reasons, perm, profile: m.profile !== undefined, fromFile: m.briefFrom === 'file',
    };
  }
}

/** the `choices` of `teams:create`: shape and size are judged before any copy (own data properties only); a fixed sentence, never the value */
function readChoices(v: unknown): CreateChoices | string {
  if (!isPlain(v)) return 'Choices: send an object.';
  if (moreKeysThan(v, 2)) return 'Choices: not valid.';
  for (const k of Object.keys(v)) if (k !== 'rows' && k !== 'allowConfirmed') return 'Choices: not valid.';
  const rowsIn = own(v, 'rows'), allow = own(v, 'allowConfirmed');
  if (allow !== undefined && typeof allow !== 'boolean') return 'Choices: not valid.';
  if (!isPlain(rowsIn) || moreKeysThan(rowsIn, LIMITS.members)) return 'Choices: rows not valid.';
  const rows: Record<string, RowChoice> = Object.create(null) as Record<string, RowChoice>;
  for (const id of Object.keys(rowsIn)) {
    if (!MEMBER_ID_RE.test(id)) return 'Choices: a row is not valid.';
    const x = own(rowsIn, id);
    if (!isPlain(x) || moreKeysThan(x, 5)) return 'Choices: a row is not valid.';
    const r: RowChoice = {};
    for (const k of Object.keys(x)) {
      const y = own(x, k);
      if (k === 'include') { if (typeof y !== 'boolean') return 'Choices, include: not valid.'; r.include = y; }
      else if (k === 'app') { if (typeof y !== 'string' || y.length > 32 || !APP_RE.test(y)) return 'Choices, app: not valid.'; r.app = y; }
      else if (k === 'model') { if (typeof y !== 'string' || y.length > 100 || (y !== '' && !MODEL_RE.test(y))) return 'Choices, model: not valid.'; r.model = y; }
      else if (k === 'effort') { if (typeof y !== 'string' || y.length > 20 || (y !== '' && parseEffort(y) === undefined)) return 'Choices, effort: not valid.'; r.effort = y; }
      else if (k === 'cap') {
        if (!isPlain(y) || moreKeysThan(y, 2)) return 'Choices, limit: not valid.';
        const unit = own(y, 'unit'), amount = own(y, 'amount');
        if ((unit !== 'aiu' && unit !== 'usd') || Object.keys(y).length !== 2 || !((typeof amount === 'number') || (typeof amount === 'string' && amount.length <= 32))) return 'Choices, limit: not valid.';
        r.cap = { unit, amount };
      } else return 'Choices: a row is not valid.';
    }
    rows[id] = r;
  }
  return { rows, ...(allow === true ? { allowConfirmed: true } : {}) };
}

interface Ctx { apps: Map<string, AdapterInfo>; models(id: string): Promise<ModelChoice[] | undefined>; defaultCap: number | undefined; savedCap: number | undefined }

function summarize(rows: PreviewRow[]): PreviewSummary {
  return {
    total: rows.length, needsChoice: rows.filter((r) => r.needsChoice).length,
    high: rows.filter((r) => r.cost.tier === 'high').length, veryHigh: rows.filter((r) => r.cost.tier === 'very-high').length,
  };
}
