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
import type { AdapterInfo } from '../shared/adapters';
import type { ModelChoice } from '../shared/api';
import { parseEffort } from '../shared/effort';
import { parseCapIn, startCap } from '../shared/credits';
import { APP_RE, LIMITS, MEMBER_ID_RE, MODEL_RE } from '../shared/teamtemplate';
import type { TeamMember } from '../shared/teamtemplate';
import { validMode } from './agentops';
import type { StoredTemplate } from './teamstore';
import { isPlain, moreKeysThan, own } from './teamsipc';
import { findAdded } from './addkey';

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
  /** the folder dialog: the chosen path, or null when cancelled */
  pick(): Promise<string | null>;
  /** tests inject these two (`addkey.ts`) */
  platform?: string;
  realpath?: (p: string) => string;
}
const cleanCap = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

/**
 * The target of a preview, with the key the add flows use (spec 111, second read of T010): a room is its agent's `wsKey`; a picked folder is
 * `resolveWorkspaceCwd` then `findAdded` over the open agents, so a symlink, a trailing slash or (Windows, macOS) another case is the SAME room;
 * else the resolved path. `existing` is 0 until T011 writes the team record. The key never goes to the window.
 */
export async function resolveTargetFrom<A>(t: Target, env: TargetEnv<A>): Promise<ResolvedTarget> {
  if ('room' in t) {
    for (const a of env.agents()) if ((a as { id?: unknown }).id === t.room) { const key = env.wsKey(a); return { ok: true, key, existing: 0, savedCap: cleanCap(env.savedCap(key)) }; }
    return { ok: false };
  }
  const p = await env.pick();
  if (!p) return { ok: false, cancelled: true };
  const ws = env.resolveCwd(p);
  const want = ws.workspaceFile ?? ws.cwd;
  const have = findAdded(want, env.agents(), env.wsKey, env.platform, env.realpath);
  const key = have ? env.wsKey(have) : want;
  return { ok: true, key, existing: 0, savedCap: cleanCap(env.savedCap(key)) };
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
}

/** what a row is now: the template's values, then the person's changes (`teams:previewRow`) */
interface Choice { app: string; model: string | undefined; effort: string | undefined; picked: boolean; appChanged: boolean }
export interface PreviewEntry {
  token: string; expiresAt: number; key: string; existing: number; savedCap: number | undefined;
  /** the template as it was when the preview was built; T011 compares it with the store to see a change */
  template: StoredTemplate;
  choices: Map<string, Choice>;
  rows: Map<string, PreviewRow>;
}

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

interface Ctx { apps: Map<string, AdapterInfo>; models(id: string): Promise<ModelChoice[] | undefined>; defaultCap: number | undefined; savedCap: number | undefined }

function summarize(rows: PreviewRow[]): PreviewSummary {
  return {
    total: rows.length, needsChoice: rows.filter((r) => r.needsChoice).length,
    high: rows.filter((r) => r.cost.tier === 'high').length, veryHigh: rows.filter((r) => r.cost.tier === 'very-high').length,
  };
}
