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
import { addCustomPlace, removeCustomPlace, setPlaceEntry, updateCustomPlace } from '../shared/places';
import type { CustomPlace, PlaceError, PlaceMap } from '../shared/places';
import { migrateLegacyTheme, parseCharacters } from '../shared/characters';
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

export class SettingsStore {
  private s: AppSettings = {};
  /** `newPlaceId` makes candidate ids for new custom places; tests inject their own. */
  constructor(private readonly file: string, private readonly newPlaceId: () => string = randomPlaceId) {}

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
    if (m.changed || r.changed) {
      this.s = r.settings;
      this.save();
    }
    return { ...this.s };
  }

  get defaultMaxAiCredits(): number | undefined {
    return this.s.defaultMaxAiCredits;
  }

  /** `undefined`/invalid clears the default. Returns the stored value. */
  setDefaultMaxAiCredits(v: unknown): number | undefined {
    const cap = parseCap(v);
    const next: AppSettings = { ...this.s };
    if (cap === undefined) delete next.defaultMaxAiCredits;
    else next.defaultMaxAiCredits = cap;
    this.s = next;
    this.save();
    return cap;
  }

  /** Spec 093 FR-006: the parent of the last folder created from + Folder, when it is a valid absolute path. */
  get newFolderParent(): string | undefined {
    return this.s.newFolderParent;
  }

  /** Spec 093 FR-006: remembered after a successful create only (the caller's rule); an invalid path is not stored. */
  setNewFolderParent(v: unknown): void {
    const p = parseNewFolderParent(v);
    if (!p || p === this.s.newFolderParent) return;
    this.s = { ...this.s, newFolderParent: p };
    this.save();
  }

  /** Spec 080 FR-025d (Q2): the session browser's one-time note was accepted. */
  get browserNoteAccepted(): boolean {
    return this.s.browserNoteAccepted === true;
  }

  /** Remembers the acceptance for this app profile; never asked again. */
  acceptBrowserNote(): void {
    this.s = { ...this.s, browserNoteAccepted: true };
    this.save();
  }

  /** Spec 080 FR-031: where a chat link opens on a plain click; the session browser unless the user chose the system browser. */
  get chatLinksIn(): 'session' | 'system' {
    return this.s.chatLinksIn === 'system' ? 'system' : 'session';
  }

  /** Only `'session'` or `'system'` change it; the default is not written. Returns the value now in force. */
  setChatLinksIn(v: unknown): 'session' | 'system' {
    if (v !== 'session' && v !== 'system') return this.chatLinksIn;
    const next: AppSettings = { ...this.s };
    if (v === 'system') next.chatLinksIn = 'system';
    else delete next.chatLinksIn;
    this.s = next;
    this.save();
    return v;
  }

  /** Spec 080 FR-123: *Open chat links in a new tab*, app-wide, off by default. */
  get chatLinksNewTab(): boolean {
    return this.s.chatLinksNewTab === true;
  }

  /** Only a real boolean changes it; the default (off) is not written. Returns the value now in force. */
  setChatLinksNewTab(v: unknown): boolean {
    if (typeof v !== 'boolean') return this.chatLinksNewTab;
    const next: AppSettings = { ...this.s };
    if (v) next.chatLinksNewTab = true;
    else delete next.chatLinksNewTab;
    this.s = next;
    this.save();
    return v;
  }

  /** Serious mode (spec 034): off by default. */
  get seriousMode(): boolean {
    return this.s.seriousMode === true;
  }

  /** Only a real boolean changes it; anything else keeps the current value. Returns the value now in force. */
  setSeriousMode(v: unknown): boolean {
    if (typeof v !== 'boolean') return this.seriousMode;
    const next: AppSettings = { ...this.s };
    if (v) next.seriousMode = true;
    else delete next.seriousMode;
    this.s = next;
    this.save();
    return v;
  }

  /** Spec 087 FR-007c: the apps with *Always continue on this computer* stored. */
  sandboxAlwaysContinue(app: string): boolean {
    return (this.s.sandboxAlwaysContinue ?? []).includes(app);
  }

  /** Spec 087 FR-007c: store or undo the choice for a known app id; anything else changes nothing. Returns the value now in force. */
  setSandboxAlwaysContinue(app: unknown, on: unknown): boolean {
    if (typeof app !== 'string' || !parseSandboxAlways([app]).length || typeof on !== 'boolean') return typeof app === 'string' && this.sandboxAlwaysContinue(app);
    const set = new Set(this.s.sandboxAlwaysContinue ?? []);
    if (on) set.add(app);
    else set.delete(app);
    const next: AppSettings = { ...this.s };
    const list = parseSandboxAlways([...set]);
    if (list.length) next.sandboxAlwaysContinue = list;
    else delete next.sandboxAlwaysContinue;
    this.s = next;
    this.save();
    return on;
  }

  /** OS notifications when an agent needs you (spec 052 FR-059): on by default; only `false` is written. */
  get notifyNeedsMe(): boolean {
    return this.s.notifyNeedsMe !== false;
  }

  /** Only a real boolean changes it; anything else keeps the current value. Returns the value now in force. */
  setNotifyNeedsMe(v: unknown): boolean {
    if (typeof v !== 'boolean') return this.notifyNeedsMe;
    const next: AppSettings = { ...this.s };
    if (v) delete next.notifyNeedsMe;
    else next.notifyNeedsMe = false;
    this.s = next;
    this.save();
    return v;
  }

  /** Spec 068 FR-006: what happens when a coffee break ends: `auto` (default: resume by itself when it costs nothing extra) or `ask`. */
  get breakResume(): 'auto' | 'ask' {
    return this.s.breakResume === 'ask' ? 'ask' : 'auto';
  }

  /** Only 'auto' or 'ask' changes it; anything else keeps the current value. Only 'ask' is written. Returns the value now in force. */
  setBreakResume(v: unknown): 'auto' | 'ask' {
    if (v !== 'auto' && v !== 'ask') return this.breakResume;
    const next: AppSettings = { ...this.s };
    if (v === 'ask') next.breakResume = 'ask';
    else delete next.breakResume;
    this.s = next;
    this.save();
    return v;
  }

  /** Spec 081 FR-022 (Q6 = A): the agent-app update check at start is on by default; only `false` is written. */
  get checkUpdatesAtStart(): boolean {
    return this.s.checkUpdatesAtStart !== false;
  }

  /** Only a real boolean changes it; anything else keeps the current value. Returns the value now in force. */
  setCheckUpdatesAtStart(v: unknown): boolean {
    if (typeof v !== 'boolean') return this.checkUpdatesAtStart;
    const next: AppSettings = { ...this.s };
    if (v) delete next.checkUpdatesAtStart;
    else next.checkUpdatesAtStart = false;
    this.s = next;
    this.save();
    return v;
  }

  /** Spec 081 FR-016: the last announced version per agent app, a copy. */
  get announcedVersions(): Record<string, string> {
    return { ...(this.s.announcedVersions ?? {}) };
  }

  /** Saves one announced version (an allowed app id and a valid version; anything else changes nothing). Returns true when it was saved. */
  setAnnouncedVersion(app: unknown, version: unknown): boolean {
    if (typeof app !== 'string' || !(ANNOUNCE_APPS as readonly string[]).includes(app)) return false;
    const ver = parseAnnounced({ [app]: version })[app];
    if (typeof ver !== 'string') return false;
    this.s = { ...this.s, announcedVersions: { ...(this.s.announcedVersions ?? {}), [app]: ver } };
    this.save();
    return true;
  }

  /** Active theme id (spec 037). Undefined = Clean Office; the renderer resolves unknown ids itself. */
  get theme(): string | undefined {
    return this.s.theme;
  }

  /** Only a valid id string changes it (or clears with null/undefined/'clean-office' handled by the caller). Returns {ok, theme}. */
  setTheme(v: unknown): { ok: boolean; theme?: string; characters?: CharacterChoice } {
    const id = parseThemeId(v);
    if (id !== undefined) {
      // spec 077 FR-067: the old Cheeky Crew id is never stored: the same rule as at load (Clean Office plus Cheeky)
      const m = migrateLegacyTheme({ ...this.s, theme: id });
      if (m.changed) {
        this.s = m.settings;
        this.save();
        return { ok: true, theme: 'clean-office', characters: this.characters };
      }
    }
    if (v === null || v === undefined) {
      const next: AppSettings = { ...this.s };
      delete next.theme;
      this.s = next;
      this.save();
      return { ok: true };
    }
    if (id !== undefined && migrateRemovedTheme({ theme: id }).changed) { // spec 035 FR-018: a removed built-in is never stored: Clean Office
      const next: AppSettings = { ...this.s };
      delete next.theme;
      this.s = next;
      this.save();
      return { ok: true, theme: 'clean-office' };
    }
    if (id === undefined) return { ok: false, theme: this.s.theme };
    const next: AppSettings = { ...this.s };
    if (id === 'clean-office') delete next.theme;
    else next.theme = id;
    this.s = next;
    this.save();
    return { ok: true, theme: this.s.theme ?? 'clean-office' };
  }

  /** Spec 077 FR-064: who sits at the desks; `theme` (the theme's own) when nothing is stored. */
  get characters(): CharacterChoice {
    return this.s.characters ?? 'theme';
  }

  /** Spec 077 FR-064: only a value from the list changes it (`theme` clears it); anything else is refused and the stored value kept. */
  setCharacters(v: unknown): { ok: boolean; characters: CharacterChoice } {
    const c = parseCharacters(v);
    if (c === undefined) return { ok: false, characters: this.characters };
    const before = this.s;
    const next: AppSettings = { ...this.s };
    if (c === 'theme') delete next.characters;
    else next.characters = c;
    this.s = next;
    if (!this.save()) {
      this.s = before;
      return { ok: false, characters: this.characters };
    }
    return { ok: true, characters: c };
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
    const before = this.s;
    const next: AppSettings = { ...this.s };
    if (list.length) next.customPlaces = list;
    else delete next.customPlaces;
    if (Object.keys(map).length) next.placeMap = map;
    else delete next.placeMap;
    this.s = next;
    if (this.save()) return true;
    this.s = before;
    return false;
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
      this.s = next;
      this.save();
    }
    return { ok: r.ok, placeMap: { ...(this.s.placeMap ?? {}) } };
  }

  private save(): boolean {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, ...this.s }, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
      return true;
    } catch {
      /* read-only profile, disk full, ...: keep working without persistence */
      return false;
    }
  }
}
