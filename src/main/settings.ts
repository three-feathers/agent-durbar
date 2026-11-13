/**
 * App settings kept as one small JSON file in userData (spec 011 FR-012): the global default AI-credit cap and the app's own choices.
 * No tokens, no content. One path: spec 093 FR-006's `newFolderParent` (where the last new folder was created; a path, never a
 * token). Tolerant read, atomic write, failures swallowed (like FolderStore).
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomInt } from 'crypto';
import { parseNewFolderParent } from '../shared/newfolder';
import { ANNOUNCE_APPS, parseAnnounced, parseCap, parseSandboxAlways, parseSettings, parseThemeId } from '../shared/credits';
import type { AppSettings } from '../shared/credits';
import { mcpWarnDefaults, parseWarnLevels } from '../shared/mcpcost';
import type { McpWarnLevels } from '../shared/mcpcost';
import { MCP_SIGNIN_REFRESH_DEFAULT } from './mcpsigninrefresh';
import { addCustomPlace, removeCustomPlace, setPlaceEntry, updateCustomPlace } from '../shared/places';
import type { CustomPlace, PlaceError, PlaceMap } from '../shared/places';
import { RETRO_MIGRATION_OPEN, migrateLegacyTheme, migrateRetroTheme, parseCharacters } from '../shared/characters';
import { migrateRemovedTheme } from '../shared/themes';
import type { CharacterChoice } from '../shared/characters';

/** Result of a custom-place call (spec 024 FR-020): the list and the map as they are now, whether the call worked or not. */
export interface PlaceCallResult {
  ok: boolean;
  error?: PlaceError;
  /** The place that was added. */
  place?: CustomPlace;
  customPlaces: CustomPlace[];
  placeMap: PlaceMap;
}

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
/** `c-` and six random lowercase letters or digits, each drawn uniformly (spec 045 FR-001: no modulo bias). */
export function randomPlaceId(): string {
  let s = 'c-';
  for (let i = 0; i < 6; i++) s += ID_CHARS[randomInt(ID_CHARS.length)];
  return s;
}

/** A setter's answer (issue #1094): `ok` is true only when the write reached disk; a rollback to the same value is not ok. */
export interface Saved<T> { ok: boolean; value: T }

export class SettingsStore {
  private s: AppSettings = {};
  /** `newPlaceId` makes candidate ids for new custom places; tests inject their own. */
  constructor(private readonly file: string, private readonly newPlaceId: () => string = randomPlaceId, private readonly retroOpen: boolean = RETRO_MIGRATION_OPEN) {}

  load(): AppSettings {
    try {
      this.s = parseSettings(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.s = {};
    }
    // spec 077 FR-067: the old Cheeky Crew theme becomes Clean Office with Characters = Cheeky, written at once, so it runs once
    const m = migrateLegacyTheme(this.s);
    // spec 035 FR-018: a removed built-in theme (Corporate, the courts) becomes Clean Office the same way; Characters is untouched
    const r = migrateRemovedTheme(m.settings);
    // spec 102 FR-266 (T227): a stored Retro Pixel theme moves to Characters `pixel`, once; inert while the flag is closed
    const p = migrateRetroTheme(r.settings, this.retroOpen);
    if (m.changed || r.changed || p.changed) {
      this.s = p.settings;
      this.save();
    }
    return { ...this.s };
  }

  get defaultMaxAiCredits(): number | undefined {
    return this.s.defaultMaxAiCredits;
  }

  /** `undefined`/invalid clears the default. Returns the value in force. A tighter cap (none -> a cap, or a lower one) stays in force for this run even when it cannot be saved (`unsaved`); a looser one or none is rolled back. */
  setDefaultMaxAiCredits(v: unknown): Saved<number | undefined> {
    const cap = parseCap(v);
    const next: AppSettings = { ...this.s };
    if (cap === undefined) delete next.defaultMaxAiCredits;
    else next.defaultMaxAiCredits = cap;
    const tighter = cap !== undefined && (this.s.defaultMaxAiCredits === undefined || cap < this.s.defaultMaxAiCredits);
    const ok = this.commit(next, tighter ? 'defaultMaxAiCredits' : undefined);
    return { ok, value: this.s.defaultMaxAiCredits };
  }

  /** Spec 093 FR-006: the parent of the last folder created from + Folder, when it is a valid absolute path. */
  get newFolderParent(): string | undefined {
    return this.s.newFolderParent;
  }

  /** Spec 093 FR-006: remembered after a successful create only (the caller's rule); an invalid path is not stored. A convenience: kept for this run when it cannot be saved. */
  setNewFolderParent(v: unknown): void {
    const p = parseNewFolderParent(v);
    if (!p || p === this.s.newFolderParent) return;
    this.commit({ ...this.s, newFolderParent: p }, 'newFolderParent');
  }

  /** Spec 080 FR-025d (Q2): the session browser's one-time note was accepted. */
  get browserNoteAccepted(): boolean {
    return this.s.browserNoteAccepted === true;
  }

  /** Remembers the acceptance for this app profile; never asked again. Kept for this run when it cannot be saved (else the session browser could never open on an unwritable profile); `isUnsaved('browserNoteAccepted')` says so. Returns true: it is in force. */
  acceptBrowserNote(): boolean {
    this.commit({ ...this.s, browserNoteAccepted: true }, 'browserNoteAccepted');
    return true;
  }

  /** Spec 080 FR-031: where a chat link opens on a plain click; the session browser unless the user chose the system browser. */
  get chatLinksIn(): 'session' | 'system' {
    return this.s.chatLinksIn === 'system' ? 'system' : 'session';
  }

  /** Only `'session'` or `'system'` change it; the default is not written. Returns `{ ok, value }`: `ok` only when the write reached disk, `value` the one in force (issue #1094). */
  setChatLinksIn(v: unknown): Saved<'session' | 'system'> {
    if (v !== 'session' && v !== 'system') return { ok: false, value: this.chatLinksIn };
    const next: AppSettings = { ...this.s };
    if (v === 'system') next.chatLinksIn = 'system';
    else delete next.chatLinksIn;
    return this.commit(next) ? { ok: true, value: v } : { ok: false, value: this.chatLinksIn };
  }

  /** Spec 100 FR-020: the MCP warning levels. */
  get mcpWarnLevels(): McpWarnLevels {
    return this.s.mcpWarnLevels ?? mcpWarnDefaults();
  }

  /** Whole percents from 5 to 90, warn below strong. Refused or not written: `ok` false and the value stays as it was. Returns what is in force. */
  setMcpWarnLevels(v: unknown): { ok: boolean; levels: McpWarnLevels } {
    const levels = parseWarnLevels(v);
    if (!levels) return { ok: false, levels: this.mcpWarnLevels };
    if (this.commit({ ...this.s, mcpWarnLevels: levels })) return { ok: true, levels };
    return { ok: false, levels: this.mcpWarnLevels };
  }

  /** Spec 080 FR-123: *Open chat links in a new tab*, app-wide, off by default. */
  get chatLinksNewTab(): boolean {
    return this.s.chatLinksNewTab === true;
  }

  /** Only a real boolean changes it; the default (off) is not written. Returns `{ ok, value }`: `ok` only when the write reached disk, `value` the one in force (issue #1094). */
  setChatLinksNewTab(v: unknown): Saved<boolean> {
    if (typeof v !== 'boolean') return { ok: false, value: this.chatLinksNewTab };
    const next: AppSettings = { ...this.s };
    if (v) next.chatLinksNewTab = true;
    else delete next.chatLinksNewTab;
    return this.commit(next) ? { ok: true, value: v } : { ok: false, value: this.chatLinksNewTab };
  }

  /** Spec 001 FR-192: *Still highlights (no motion)*, off by default. */
  get stillHighlights(): boolean {
    return this.s.stillHighlights === true;
  }

  /** Only a real boolean changes it; the default (off) is not written. `ok` only when the write reached disk (a failed write is not ok even when the value did not change); `value` the one in force (#1094). */
  setStillHighlights(v: unknown): Saved<boolean> {
    if (typeof v !== 'boolean') return { ok: false, value: this.stillHighlights };
    const next: AppSettings = { ...this.s };
    if (v) next.stillHighlights = true;
    else delete next.stillHighlights;
    return this.commit(next) ? { ok: true, value: v } : { ok: false, value: this.stillHighlights };
  }

  /** Spec 058 FR-227 (issue #1205): *Diagnostics*, off by default. */
  get diagnostics(): boolean {
    return this.s.diagnostics === true;
  }

  /** Only a real boolean changes it; the default (off) is not written. `ok` only when the write reached disk; `value` the one in force. */
  setDiagnostics(v: unknown): Saved<boolean> {
    if (typeof v !== 'boolean') return { ok: false, value: this.diagnostics };
    const next: AppSettings = { ...this.s };
    if (v) next.diagnostics = true;
    else delete next.diagnostics;
    return this.commit(next) ? { ok: true, value: v } : { ok: false, value: this.diagnostics };
  }

  /** Spec 052 FR-069 (issue #1182): *Motion*, on by default; only `false` is written, so a file of an older version means on. */
  get motion(): boolean {
    return this.s.motion !== false;
  }

  /** Only a real boolean changes it. `ok` only when the write reached disk; `value` the one in force. */
  setMotion(v: unknown): Saved<boolean> {
    if (typeof v !== 'boolean') return { ok: false, value: this.motion };
    const next: AppSettings = { ...this.s };
    if (v) delete next.motion;
    else next.motion = false;
    return this.commit(next) ? { ok: true, value: v } : { ok: false, value: this.motion };
  }

  /** Serious mode (spec 034): off by default. */
  get seriousMode(): boolean {
    return this.s.seriousMode === true;
  }

  /** Only a real boolean changes it; anything else keeps the current value. Returns `{ ok, value }`: `ok` only when the write reached disk, `value` the one in force (issue #1094). */
  setSeriousMode(v: unknown): Saved<boolean> {
    if (typeof v !== 'boolean') return { ok: false, value: this.seriousMode };
    const next: AppSettings = { ...this.s };
    if (v) next.seriousMode = true;
    else delete next.seriousMode;
    return this.commit(next) ? { ok: true, value: v } : { ok: false, value: this.seriousMode };
  }

  /** Auto-follow work (spec 052 FR-182, issue 686): off by default; only `true` is written. */
  get autoFollowWork(): boolean {
    return this.s.autoFollowWork === true;
  }

  /** Only a real boolean changes it; anything else keeps the current value. Returns `{ ok, value }`: `ok` only when the write reached disk, `value` the one in force (issue #1094). */
  setAutoFollowWork(v: unknown): Saved<boolean> {
    if (typeof v !== 'boolean') return { ok: false, value: this.autoFollowWork };
    const next: AppSettings = { ...this.s };
    if (v) next.autoFollowWork = true;
    else delete next.autoFollowWork;
    return this.commit(next) ? { ok: true, value: v } : { ok: false, value: this.autoFollowWork };
  }

  /** Spec 087 FR-007c: the apps with *Always continue on this computer* stored. */
  sandboxAlwaysContinue(app: string): boolean {
    return (this.s.sandboxAlwaysContinue ?? []).includes(app);
  }

  /** Spec 087 FR-007c: store or undo the choice for a known app id; anything else changes nothing. Returns `{ ok, value }`: `ok` only when the write reached disk, `value` the one in force (issue #1094). */
  setSandboxAlwaysContinue(app: unknown, on: unknown): Saved<boolean> {
    if (typeof app !== 'string' || !parseSandboxAlways([app]).length || typeof on !== 'boolean') return { ok: false, value: typeof app === 'string' && this.sandboxAlwaysContinue(app) };
    const set = new Set(this.s.sandboxAlwaysContinue ?? []);
    if (on) set.add(app);
    else set.delete(app);
    const next: AppSettings = { ...this.s };
    const list = parseSandboxAlways([...set]);
    if (list.length) next.sandboxAlwaysContinue = list;
    else delete next.sandboxAlwaysContinue;
    const ok = this.commit(next, !on ? 'sandboxAlwaysContinue' : undefined); // turning the choice off is the safe direction: in force for this run even if it cannot be saved (`isUnsaved`); turning it on is rolled back
    return { ok, value: this.sandboxAlwaysContinue(app) };
  }

  /** Spec 099 S1: the turn limit last used for Autopilot, remembered only after the person confirmed it. */
  get autopilotLimit(): number | undefined {
    return this.s.autopilotLimit;
  }

  setAutopilotLimit(v: number): void {
    if (!Number.isInteger(v) || v < 1 || v > 1000) return;
    this.s = { ...this.s, autopilotLimit: v };
    this.save();
  }

  /** OS notifications when an agent needs you (spec 052 FR-059): on by default; only `false` is written. */
  get notifyNeedsMe(): boolean {
    return this.s.notifyNeedsMe !== false;
  }

  /** Only a real boolean changes it; anything else keeps the current value. Returns `{ ok, value }`: `ok` only when the write reached disk, `value` the one in force (issue #1094). */
  setNotifyNeedsMe(v: unknown): Saved<boolean> {
    if (typeof v !== 'boolean') return { ok: false, value: this.notifyNeedsMe };
    const next: AppSettings = { ...this.s };
    if (v) delete next.notifyNeedsMe;
    else next.notifyNeedsMe = false;
    return this.commit(next) ? { ok: true, value: v } : { ok: false, value: this.notifyNeedsMe };
  }

  /** Spec 068 FR-006: what happens when a coffee break ends: `auto` (default: resume by itself when it costs nothing extra) or `ask`. */
  get breakResume(): 'auto' | 'ask' {
    return this.s.breakResume === 'ask' ? 'ask' : 'auto';
  }

  /** Only 'auto' or 'ask' changes it; anything else keeps the current value. Only 'ask' is written. Returns `{ ok, value }`: `ok` only when the write reached disk, `value` the one in force (issue #1094). */
  setBreakResume(v: unknown): Saved<'auto' | 'ask'> {
    if (v !== 'auto' && v !== 'ask') return { ok: false, value: this.breakResume };
    const next: AppSettings = { ...this.s };
    if (v === 'ask') next.breakResume = 'ask';
    else delete next.breakResume;
    return this.commit(next) ? { ok: true, value: v } : { ok: false, value: this.breakResume };
  }

  /** Spec 081 FR-022 (Q6 = A): the agent-app update check at start is on by default; only `false` is written. */
  get checkUpdatesAtStart(): boolean {
    return this.s.checkUpdatesAtStart !== false;
  }

  /** Only a real boolean changes it; anything else keeps the current value. Returns `{ ok, value }`: `ok` only when the write reached disk, `value` the one in force (issue #1094). */
  setCheckUpdatesAtStart(v: unknown): Saved<boolean> {
    if (typeof v !== 'boolean') return { ok: false, value: this.checkUpdatesAtStart };
    const next: AppSettings = { ...this.s };
    if (v) delete next.checkUpdatesAtStart;
    else next.checkUpdatesAtStart = false;
    return this.commit(next) ? { ok: true, value: v } : { ok: false, value: this.checkUpdatesAtStart };
  }

  /** Spec 058 FR-213: *Refresh MCP sign-ins automatically*: the stored choice, or the default (one constant) when none is stored. */
  get mcpSignInRefresh(): boolean {
    const v = this.s.mcpSignInRefresh;
    return v === undefined ? MCP_SIGNIN_REFRESH_DEFAULT : v === true;
  }

  /** Only a real boolean changes it and is written as chosen (so a later change of the default keeps the person's choice). Returns the value now in force (a failed save keeps the old one). */
  setMcpSignInRefresh(v: unknown): Saved<boolean> {
    if (typeof v !== 'boolean') return { ok: false, value: this.mcpSignInRefresh };
    return this.commit({ ...this.s, mcpSignInRefresh: v }) ? { ok: true, value: v } : { ok: false, value: this.mcpSignInRefresh }; // issue #1023: a failed save keeps the old value
  }

  /** Spec 081 FR-016: the last announced version per agent app, a copy. */
  get announcedVersions(): Record<string, string> {
    return { ...(this.s.announcedVersions ?? {}) };
  }

  /** Remembers one announced version (an allowed app id and a valid version; anything else changes nothing). Bookkeeping: kept for this run when it cannot be saved, so an update is announced once (spec 081 FR-016). Returns true when it is in force. */
  setAnnouncedVersion(app: unknown, version: unknown): boolean {
    if (typeof app !== 'string' || !(ANNOUNCE_APPS as readonly string[]).includes(app)) return false;
    const ver = parseAnnounced({ [app]: version })[app];
    if (typeof ver !== 'string') return false;
    this.commit({ ...this.s, announcedVersions: { ...(this.s.announcedVersions ?? {}), [app]: ver } }, 'announcedVersions');
    return true;
  }

  /** Active theme id (spec 037). Undefined = Clean Office; the renderer resolves unknown ids itself. */
  get theme(): string | undefined {
    return this.s.theme;
  }

  /** Only a valid id string changes it (or clears with null/undefined/'clean-office' handled by the caller). Returns {ok, theme}. The window has already shown the theme, so it is kept for this run when it cannot be saved (`ok` false says so; the window warns). */
  setTheme(v: unknown): { ok: boolean; theme?: string; characters?: CharacterChoice } {
    const id = parseThemeId(v);
    if (id !== undefined) {
      // spec 077 FR-067: the old Cheeky Crew id is never stored: the same rule as at load (Clean Office plus Cheeky)
      const m = migrateLegacyTheme({ ...this.s, theme: id });
      if (m.changed) {
        return { ok: this.commit(m.settings, 'theme'), theme: 'clean-office', characters: this.characters };
      }
    }
    if (v === null || v === undefined) {
      const next: AppSettings = { ...this.s };
      delete next.theme;
      return { ok: this.commit(next, 'theme') };
    }
    if (id !== undefined && migrateRemovedTheme({ theme: id }).changed) { // spec 035 FR-018: a removed built-in is never stored: Clean Office
      const next: AppSettings = { ...this.s };
      delete next.theme;
      return { ok: this.commit(next, 'theme'), theme: 'clean-office' };
    }
    if (id === undefined) return { ok: false, theme: this.s.theme };
    const next: AppSettings = { ...this.s };
    if (id === 'clean-office') delete next.theme;
    else next.theme = id;
    return { ok: this.commit(next, 'theme'), theme: this.s.theme ?? 'clean-office' };
  }

  /** Spec 077 FR-064: who sits at the desks; `theme` (the theme's own) when nothing is stored. */
  get characters(): CharacterChoice {
    return this.s.characters ?? 'theme';
  }

  /** Spec 077 FR-064: only a value from the list changes it (`theme` clears it); anything else is refused and the stored value kept. */
  setCharacters(v: unknown): { ok: boolean; characters: CharacterChoice } {
    const c = parseCharacters(v);
    if (c === undefined) return { ok: false, characters: this.characters };
    const next: AppSettings = { ...this.s };
    if (c === 'theme') delete next.characters;
    else next.characters = c;
    return this.commit(next) ? { ok: true, characters: c } : { ok: false, characters: this.characters };
  }

  /** Place mapping (spec 024): MCP server name -> place id or `desk`. A copy, never the stored object. */
  get placeMap(): PlaceMap {
    return { ...(this.s.placeMap ?? {}) };
  }

  /** The user's own places (spec 024 FR-018), a copy. */
  get customPlaces(): CustomPlace[] {
    return (this.s.customPlaces ?? []).map((p) => ({ ...p }));
  }

  private customIds(): string[] {
    return (this.s.customPlaces ?? []).map((p) => p.id);
  }

  private placeResult(r: { ok: boolean; error?: PlaceError; place?: CustomPlace }): PlaceCallResult {
    return { ok: r.ok, ...(r.error ? { error: r.error } : {}), ...(r.place ? { place: { ...r.place } } : {}), customPlaces: this.customPlaces, placeMap: this.placeMap };
  }

  /** Store a new list and map in one write. If the write fails, memory goes back to what it was and the call is refused. */
  private commitPlaces(list: CustomPlace[], map: PlaceMap): boolean {
    const next: AppSettings = { ...this.s };
    if (list.length) next.customPlaces = list;
    else delete next.customPlaces;
    if (Object.keys(map).length) next.placeMap = map;
    else delete next.placeMap;
    return this.commit(next);
  }

  /** Add a custom place (spec 024 FR-020). The renderer is not trusted: everything is validated by the shared rules. */
  addPlace(name: unknown, icon: unknown): PlaceCallResult {
    const r = addCustomPlace(this.s.customPlaces ?? [], name, icon, this.newPlaceId);
    if (!r.ok) return this.placeResult(r);
    if (!this.commitPlaces(r.list, this.placeMap)) return this.placeResult({ ok: false, error: 'unknown' });
    return this.placeResult({ ok: true, place: r.place });
  }

  /** Rename and/or change the icon of a place; its id and mappings stay. */
  updatePlace(id: unknown, patch: unknown): PlaceCallResult {
    const r = updateCustomPlace(this.s.customPlaces ?? [], id, patch);
    if (!r.ok) return this.placeResult(r);
    if (!this.commitPlaces(r.list, this.placeMap)) return this.placeResult({ ok: false, error: 'unknown' });
    return this.placeResult({ ok: true });
  }

  /** Remove a place and every mapping that pointed to it, in one write. */
  removePlace(id: unknown): PlaceCallResult {
    const r = removeCustomPlace(this.s.customPlaces ?? [], this.s.placeMap ?? {}, id);
    if (!r.ok) return this.placeResult(r);
    if (!this.commitPlaces(r.list, r.placeMap)) return this.placeResult({ ok: false, error: 'unknown' });
    return this.placeResult({ ok: true });
  }

  /** Set one entry, or clear it with `null`. Invalid input changes nothing. Returns `ok` and the resulting map. */
  setPlace(server: unknown, choice: unknown): { ok: boolean; placeMap: PlaceMap } {
    const r = setPlaceEntry(this.s.placeMap ?? {}, server, choice, this.customIds());
    if (r.ok) {
      const next: AppSettings = { ...this.s };
      if (Object.keys(r.map).length) next.placeMap = r.map;
      else delete next.placeMap;
      return { ok: this.commit(next), placeMap: { ...(this.s.placeMap ?? {}) } };
    }
    return { ok: r.ok, placeMap: { ...(this.s.placeMap ?? {}) } };
  }

  /**
   * The one way a setter stores a change (issue #1023). A file that was written makes `next` the settings. When it cannot be written
   * there are two rules (spec 011 FR-012): the default is that memory goes back to what it was, because the window shows what is
   * in force (switches, lists, places); a change given a `keep` key stays in memory for this run and that key is listed by
   * `isUnsaved`: a convenience or bookkeeping value that must not stop working (the browser note, an announced version, the new-folder
   * parent, the theme the window already shows) and a change that makes things safer (the OS-sandbox choice off, a tighter cap).
   */
  private commit(next: AppSettings, keep?: string): boolean {
    const before = this.s;
    this.s = next;
    if (this.save()) {
      this.kept.clear(); // the file now holds everything in memory
      return true;
    }
    if (keep) this.kept.add(keep);
    else this.s = before;
    return false;
  }

  private readonly kept = new Set<string>();
  /** True when this setting is in force for this run only: its change could not be written and no later save has (a later successful save writes all of memory). Tied to the setting, never store-wide. */
  isUnsaved(key: string): boolean {
    return this.kept.has(key);
  }
  /** The settings in force for this run only, for Settings to say so again when it is reopened. */
  get unsavedKeys(): string[] {
    return [...this.kept];
  }

  private save(): boolean {
    let tmp: string | undefined;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, ...this.s }, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
      tmp = undefined; // renamed: nothing left to remove
      return true;
    } catch {
      /* read-only profile, disk full, ...: keep working without persistence */
      return false;
    } finally {
      if (tmp) { try { fs.rmSync(tmp, { force: true }); } catch { /* best effort (issue #1047) */ } } // a partial write or a failed rename leaves no .tmp
    }
  }
}
