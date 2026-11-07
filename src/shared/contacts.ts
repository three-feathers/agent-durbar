/**
 * Contacts (spec 084, issue 701): the pure model. Types, the one `CONTACTS_LIMITS` object (FR-005), the document parser, the checks of
 * a contact and its channels (FR-002..FR-004), ids, the change rules (stale `rev`, the caps) and favourites (FR-006). No Electron, no
 * Node-only imports and no clock or random source of its own (callers pass them), so it is unit tested. Notes (*How to talk to them*)
 * are masked by the caller before they get here (`maskOutgoing`, T012): this module only enforces their character cap.
 *
 * Reused from spec 083's `notes.ts` (FR-031: no second copy): `utf8Len`, `fitsCap`, `stripControls`, `isoOk`, and the uniform id
 * draw of `newNoteId` (the same `rand(n)` shape as `randomPlaceId` in main, which uses `crypto.randomInt`).
 */
import { fitsCap, isoOk, stripControls, utf8Len } from './notes';

/**
 * FR-005: every cap lives here, none anywhere else in the contacts modules. The character caps are the numbers written down; every
 * byte cap is DERIVED from them (083 FR-006's rule: a stored character costs at most 3 bytes of UTF-8, and once control characters are
 * removed a JSON escape costs at most 2 bytes per character, so 3 bytes per character bound both). Patterns (FR-003) take their
 * lengths from here too.
 */
export const CONTACTS_LIMITS = (() => {
  const contactsMax = 300;
  const channelsMax = 8;
  const aliasesMax = 5;
  const recipesMax = 20;
  const logEntries = 500;
  const notesChars = 1_000;
  const textChars = 4_000;
  const urlChars = 2_000;
  const nameChars = 80;
  const aliasChars = 32;
  const initialsMax = 2;
  /** UTF-16 units of the initials: two grapheme clusters, but a cluster can carry any number of marks. */
  const initialsChars = 16;
  const labelChars = 40;
  const toChars = 200;
  /** FR-004: the whole address; the local part and one domain label have the usual smaller caps. */
  const addressChars = 254;
  const localChars = 64;
  const domainLabelChars = 63;
  /** FR-003: the characters after the leading letter of a Slack id (`T`, `U`/`W`) and of a Telegram username. */
  const slackIdMin = 2;
  const slackIdMax = 20;
  const telegramMin = 4;
  const telegramMax = 31;
  const personIdChars = 12;
  const channelIdChars = 8;
  const recipeIdChars = 8;
  const revMax = 1e9;
  /** Draws tried before an id that is already taken is given up on. */
  const idTries = 8;
  const serverChars = 128;
  const toolChars = 128;
  const argsChars = 2_000;
  /** Bytes besides the characters: ids, times, flags, punctuation. */
  const channelExtraBytes = 256;
  const contactExtraBytes = 1_024;
  const recipeExtraBytes = 256;
  const logEntryExtraBytes = 256;
  const docExtraBytes = 1_024;
  const channelJsonBytes = 3 * (labelChars + addressChars + labelChars + toChars + 2 * (slackIdMax + 1) + telegramMax + 1) + channelExtraBytes;
  const contactJsonBytes = 3 * (nameChars + aliasesMax * aliasChars + initialsChars + notesChars) + channelsMax * channelJsonBytes + contactExtraBytes;
  const recipeJsonBytes = 3 * (labelChars + serverChars + toolChars + argsChars) + recipeExtraBytes;
  const storeBytes = contactsMax * contactJsonBytes + recipesMax * recipeJsonBytes + docExtraBytes;
  const logEntryBytes = 3 * nameChars + logEntryExtraBytes;
  const logBytes = logEntries * logEntryBytes + docExtraBytes;
  return {
    contactsMax, channelsMax, aliasesMax, recipesMax, logEntries, notesChars, textChars, urlChars, nameChars, aliasChars, initialsMax, initialsChars, labelChars, toChars,
    addressChars, localChars, domainLabelChars, slackIdMin, slackIdMax, telegramMin, telegramMax, personIdChars, channelIdChars, recipeIdChars, revMax, idTries,
    serverChars, toolChars, argsChars, channelExtraBytes, contactExtraBytes, recipeExtraBytes, logEntryExtraBytes, docExtraBytes,
    channelJsonBytes, contactJsonBytes, recipeJsonBytes, storeBytes, logEntryBytes, logBytes,
  } as const;
})();

const L = CONTACTS_LIMITS;

export type ChannelKind = 'teams' | 'slack' | 'email' | 'telegram';
export const CHANNEL_KINDS: readonly ChannelKind[] = ['teams', 'slack', 'email', 'telegram'];
export type ContactSource = 'typed' | 'teams-import';

export interface Channel {
  id: string;
  kind: ChannelKind;
  label?: string;
  /** teams */
  upn?: string;
  /** slack */
  team?: string;
  user?: string;
  handle?: string;
  /** email */
  address?: string;
  /** telegram */
  username?: string;
  /** A send recipe id (FR-050) and the value its `{{to}}` takes (default: the channel's address). */
  recipe?: string;
  to?: string;
}

/** The part of a contact the user edits (FR-002, FR-011). */
export interface ContactFields {
  name: string;
  aliases: string[];
  initials: string;
  notes: string;
  channels: Channel[];
  /** A channel id, or '' when there is no channel. */
  preferred: string;
}

export interface Contact extends ContactFields {
  id: string;
  favourite: boolean;
  /** Favourites are sorted by it; dense (0..n-1) among favourites after every favourite operation; 0 for the rest. */
  favOrder: number;
  source: ContactSource;
  createdAt: string;
  updatedAt: string;
  rev: number;
}

export interface Recipe {
  id: string;
  kind: 'send' | 'import';
  label: string;
  channelKind: ChannelKind | 'other';
  server: string;
  tool: string;
  /** The JSON object template as text. The placeholder rules, `fillTemplate` and `canonicalJson` are T032 (AC3), not this module's. */
  args: string;
}

export interface ContactsDoc {
  version: 1;
  contacts: Contact[];
  recipes: Recipe[];
  settings: { teamsApp: boolean };
}

export const emptyContactsDoc = (): ContactsDoc => ({ version: 1, contacts: [], recipes: [], settings: { teamsApp: false } });

/** What a refused field says, keyed by the field (FR-004: "the field's reason"). */
export const REASONS = {
  name: `The name needs 1 to ${L.nameChars} characters and no control characters.`,
  aliases: `Aliases: letters, digits, . _ - only, 1 to ${L.aliasChars} characters each.`,
  aliasesCap: `A contact can have at most ${L.aliasesMax} aliases.`,
  initials: `Initials: 1 to ${L.initialsMax} characters.`,
  notes: `The notes are longer than ${L.notesChars} characters.`,
  channelsCap: `A contact can have at most ${L.channelsMax} ways to reach them.`,
  channel: 'That way to reach them is not valid.',
  label: `The label is longer than ${L.labelChars} characters or has control characters.`,
  upn: `The Teams address must be plain ASCII like name@example.com (letters, digits and . _ + - only, at most ${L.addressChars} characters).`,
  address: `The email address must be plain ASCII like name@example.com (letters, digits and . _ + - only, at most ${L.addressChars} characters).`,
  team: `The Slack workspace id looks like T0123ABC (a T and ${L.slackIdMin} to ${L.slackIdMax} capital letters or digits).`,
  user: `The Slack user id looks like U0123ABC (a U or W and ${L.slackIdMin} to ${L.slackIdMax} capital letters or digits).`,
  handle: `The Slack name is longer than ${L.labelChars} characters or has control characters.`,
  username: `A Telegram username starts with a letter, then ${L.telegramMin} to ${L.telegramMax} letters, digits or _.`,
  recipe: 'That send recipe id is not valid.',
  to: `The recipient value is longer than ${L.toChars} characters or has control characters.`,
  preferred: 'The preferred way is not one of the contact\'s ways.',
  recipesCap: `There are already ${L.recipesMax} send recipes. Delete one first.`,
  contactsCap: `You have ${L.contactsMax} contacts. Delete some first.`,
  stale: 'That contact changed since you opened it.',
  missing: 'That contact is not there any more.',
  notFavourite: 'Only a favourite can be moved.',
} as const;

/**
 * What a name, alias, label, Slack name, `to` value or initials may NOT hold (review of T010, 2026-11-07): control characters, format
 * characters (`\p{Cf}`: bidi overrides and isolates, zero-width marks, soft hyphen), default-ignorable code points (invisible fillers,
 * variation selectors, tags), the line and paragraph separators, and lone surrogates. Any of them can make a name read as another
 * person's in the preview ("To: ...") or hide text in it. In `u` mode `[\ud800-\udfff]` matches only an unpaired surrogate.
 */
const CTRL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ud800-\udfff]|\p{Cf}|\p{Default_Ignorable_Code_Point}/u;
const ALIAS_RE = new RegExp(`^[A-Za-z0-9._-]{1,${L.aliasChars}}$`);
const SLACK_TEAM_RE = new RegExp(`^T[A-Z0-9]{${L.slackIdMin},${L.slackIdMax}}$`);
const SLACK_USER_RE = new RegExp(`^[UW][A-Z0-9]{${L.slackIdMin},${L.slackIdMax}}$`);
const TELEGRAM_RE = new RegExp(`^[A-Za-z][A-Za-z0-9_]{${L.telegramMin},${L.telegramMax}}$`);
const LOCAL_RE = new RegExp(`^[A-Za-z0-9._+-]{1,${L.localChars}}$`);
const LABEL_RE = new RegExp(`^[A-Za-z0-9](?:[A-Za-z0-9-]{0,${L.domainLabelChars - 2}}[A-Za-z0-9])?$`);
export const CONTACT_ID_RE = new RegExp(`^p-[a-z0-9]{${L.personIdChars}}$`);
export const CHANNEL_ID_RE = new RegExp(`^ch-[a-z0-9]{${L.channelIdChars}}$`);
export const RECIPE_ID_RE = new RegExp(`^r-[a-z0-9]{${L.recipeIdChars}}$`);

/**
 * FR-004: an email or UPN is ASCII `local@domain` and nothing else. Only the characters listed in LOCAL_RE and LABEL_RE pass, so a
 * CR, LF, `?`, `&`, `#`, `%`, `,`, `;`, `<`, `>`, a quote, a colon (`javascript:`), a space and every non-ASCII character (a Cyrillic
 * `а`, a Greek `ο`, a full-width `@` or dot, a zero-width space) fail without being named one by one.
 */
export function addressOk(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > L.addressChars) return false;
  const at = v.indexOf('@');
  if (at < 1 || at !== v.lastIndexOf('@')) return false;
  const local = v.slice(0, at);
  if (!LOCAL_RE.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  const labels = v.slice(at + 1).split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL_RE.test(l))) return false;
  return /[A-Za-z]/.test(labels[labels.length - 1]);
}

/** FR-002, FR-003: `p-` / `ch-` / `r-` and the characters, each from `rand(36)` (a uniform integer 0..35, e.g. `crypto.randomInt`): no modulo bias here. */
export function newId(prefix: 'p-' | 'ch-' | 'r-', rand: (n: number) => number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const len = prefix === 'p-' ? L.personIdChars : prefix === 'ch-' ? L.channelIdChars : L.recipeIdChars;
  let s = prefix;
  for (let i = 0; i < len; i++) s += chars[rand(chars.length)];
  return s;
}

const intIn = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
/**
 * U+200C (ZWNJ) and U+200D (ZWJ) are format characters, yet real names need them (Persian `می‌خواهد`, Devanagari `क्‍ष`).
 * One is allowed only BETWEEN two letters or marks (`\p{L}`, `\p{M}`); at the start or end, doubled, next to a space or an emoji
 * (so a ZWJ emoji sequence) it stays refused. Limit: the legacy Malayalam chillu (consonant + virama + ZWJ at the end of a word or before a
 * space, `ന്‍`) is refused; a joiner inside a word and the atomic chillu letters U+0D7A..U+0D7F are accepted. Used for name, label, Slack name and initials; not for `to` or recipes.
 */
const JOINER_BETWEEN_RE = /(?<=[\p{L}\p{M}])[\u200c\u200d](?=[\p{L}\p{M}])/gu;
const STRAY_JOINER_RE = /(?<![\p{L}\p{M}])[\u200c\u200d]|[\u200c\u200d](?![\p{L}\p{M}])/gu;
const withoutJoiners = (v: string): string => v.replace(JOINER_BETWEEN_RE, '');
/** True when `v` holds nothing refused by CTRL_RE; with `joiners`, a joiner between two letters or marks is let through. */
const textClean = (v: string, joiners: boolean): boolean => !CTRL_RE.test(joiners ? withoutJoiners(v) : v);
const plainText = (v: unknown, max: number, joiners = false): v is string => typeof v === 'string' && v.length <= max && textClean(v, joiners);

/** Grapheme clusters (a flag, a keycap, a skin-tone emoji, a letter with its accents are one each); `Intl` is a built-in, so the module stays pure. */
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export const graphemes = (s: string): string[] => Array.from(SEGMENTER.segment(s), (x) => x.segment);

/** FR-002: up to two initials from the first letters of the first two words of the name counted and cut in grapheme clusters, so a flag, a keycap or an accented letter is never split. */
export function guessInitials(name: string): string {
  const words = String(name ?? '').split(/\s+/).filter(Boolean);
  const first = words.slice(0, L.initialsMax).map((w) => graphemes(w)[0] ?? '');
  // upper-casing can lengthen a letter (`ß` is `SS`, a ligature is two or three letters): cap AFTER it, by graphemes
  // the same count as the validator (graphemes); a joiner the cut left at an edge, or doubled, is dropped so the value always reads back
  let out = '';
  for (const g of graphemes(first.join('').toUpperCase()).slice(0, L.initialsMax)) {
    if ((out + g).length > L.initialsChars) break; // stop at the first cluster that does not fit: never take a later letter instead
    out += g;
  }
  if (!out) out = Array.from(first.join('').toUpperCase())[0] ?? ''; // one cluster longer than the cap: its first code point
  return out.replace(STRAY_JOINER_RE, '');
}

export type FieldFail = { ok: false; field: string; error: string; cap?: boolean };

/** One channel as stored: only the fields of its kind, every one checked. A missing `id` is made by `newChannelId` when given. */
export function cleanChannel(v: unknown, newChannelId?: () => string): { ok: true; channel: Channel } | FieldFail {
  const bad = (field: string, error: string): FieldFail => ({ ok: false, field, error });
  if (!v || typeof v !== 'object' || Array.isArray(v)) return bad('channel', REASONS.channel);
  const c = v as Record<string, unknown>;
  const kind = c.kind as ChannelKind;
  if (typeof kind !== 'string' || !CHANNEL_KINDS.includes(kind)) return bad('kind', REASONS.channel);
  let id = c.id;
  if (id === undefined || id === '') id = newChannelId?.();
  if (typeof id !== 'string' || !CHANNEL_ID_RE.test(id)) return bad('id', REASONS.channel);
  const out: Channel = { id, kind };
  if (c.label !== undefined && c.label !== '') { if (!plainText(c.label, L.labelChars, true)) return bad('label', REASONS.label); out.label = c.label.trim(); }
  if (kind === 'teams') {
    if (!addressOk(c.upn)) return bad('upn', REASONS.upn);
    out.upn = c.upn;
  } else if (kind === 'email') {
    if (!addressOk(c.address)) return bad('address', REASONS.address);
    out.address = c.address;
  } else if (kind === 'slack') {
    if (typeof c.team !== 'string' || !SLACK_TEAM_RE.test(c.team)) return bad('team', REASONS.team);
    if (typeof c.user !== 'string' || !SLACK_USER_RE.test(c.user)) return bad('user', REASONS.user);
    out.team = c.team;
    out.user = c.user;
    if (c.handle !== undefined && c.handle !== '') { if (!plainText(c.handle, L.labelChars, true)) return bad('handle', REASONS.handle); out.handle = c.handle.trim(); }
  } else {
    if (typeof c.username !== 'string' || !TELEGRAM_RE.test(c.username)) return bad('username', REASONS.username);
    out.username = c.username;
  }
  if (c.recipe !== undefined && c.recipe !== '') { if (typeof c.recipe !== 'string' || !RECIPE_ID_RE.test(c.recipe)) return bad('recipe', REASONS.recipe); out.recipe = c.recipe; }
  if (c.to !== undefined && c.to !== '') { if (!plainText(c.to, L.toChars)) return bad('to', REASONS.to); out.to = c.to; }
  return { ok: true, channel: out };
}

/**
 * FR-002..FR-004: the editable part of a contact, checked. Nothing is cut: a name, alias, label or notes text over its cap is refused
 * with the field's reason (the window shows it under the field). Notes keep their line ends (tabs and `\n`); other controls are removed.
 */
export function cleanContact(v: unknown, newChannelId?: () => string): { ok: true; fields: ContactFields } | FieldFail {
  const bad = (field: string, error: string, cap = false): FieldFail => ({ ok: false, field, error, ...(cap ? { cap } : {}) });
  if (!v || typeof v !== 'object' || Array.isArray(v)) return bad('contact', REASONS.name);
  const c = v as Record<string, unknown>;
  if (typeof c.name !== 'string') return bad('name', REASONS.name);
  if (!textClean(c.name, true)) return bad('name', REASONS.name);
  const name = c.name.replace(/\s+/g, ' ').trim();
  if (!name || name.length > L.nameChars) return bad('name', REASONS.name);
  const rawAliases = c.aliases === undefined ? [] : c.aliases;
  if (!Array.isArray(rawAliases)) return bad('aliases', REASONS.aliases);
  // the length is checked BEFORE the loop: the duplicate check below grows with the list (a file can hold a million short aliases)
  if (rawAliases.length > L.aliasesMax) return bad('aliases', REASONS.aliasesCap, true);
  const aliases: string[] = [];
  for (const a of rawAliases) {
    if (typeof a !== 'string' || !ALIAS_RE.test(a.trim())) return bad('aliases', REASONS.aliases);
    if (!aliases.some((x) => x.toLowerCase() === a.trim().toLowerCase())) aliases.push(a.trim());
  }
  let initials: string;
  if (c.initials === undefined || c.initials === '') initials = guessInitials(name);
  else {
    if (typeof c.initials !== 'string') return bad('initials', REASONS.initials);
    initials = c.initials.trim();
    const n = graphemes(initials).length;
    if (n < 1 || n > L.initialsMax || initials.length > L.initialsChars || !textClean(c.initials, true)) return bad('initials', REASONS.initials);
  }
  const notes = c.notes === undefined ? '' : typeof c.notes === 'string' ? stripControls(c.notes) : undefined;
  if (notes === undefined || notes.length > L.notesChars) return bad('notes', REASONS.notes);
  const rawChannels = c.channels === undefined ? [] : c.channels;
  if (!Array.isArray(rawChannels)) return bad('channels', REASONS.channel);
  if (rawChannels.length > L.channelsMax) return bad('channels', REASONS.channelsCap, true);
  const channels: Channel[] = [];
  for (const x of rawChannels) {
    const r = cleanChannel(x, newChannelId);
    if (!r.ok) return r;
    if (channels.some((y) => y.id === r.channel.id)) return bad('id', REASONS.channel);
    channels.push(r.channel);
  }
  let preferred = '';
  if (channels.length) {
    if (c.preferred === undefined || c.preferred === '') preferred = channels[0].id;
    else if (typeof c.preferred === 'string' && channels.some((y) => y.id === c.preferred)) preferred = c.preferred;
    else return bad('preferred', REASONS.preferred);
  }
  return { ok: true, fields: { name, aliases, initials, notes, channels, preferred } };
}

function parseContact(v: unknown): Contact | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const c = { ...(v as Record<string, unknown>) };
  if (typeof c.id !== 'string' || !CONTACT_ID_RE.test(c.id)) return undefined;
  if (Array.isArray(c.channels) && !c.channels.some((x) => (x as Record<string, unknown> | null)?.id === c.preferred)) delete c.preferred; // a dangling preferred falls back to the first way
  const r = cleanContact(c);
  if (!r.ok) return undefined;
  if (!isoOk(c.createdAt) || !isoOk(c.updatedAt) || !intIn(c.rev, 1, L.revMax)) return undefined;
  if (c.source !== 'typed' && c.source !== 'teams-import') return undefined;
  const favourite = c.favourite === true;
  return { id: c.id, ...r.fields, favourite, favOrder: favourite && intIn(c.favOrder, 0, L.contactsMax) ? c.favOrder : 0, source: c.source, createdAt: c.createdAt, updatedAt: c.updatedAt, rev: c.rev };
}

function parseRecipe(v: unknown): Recipe | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== 'string' || !RECIPE_ID_RE.test(r.id)) return undefined;
  if (r.kind !== 'send' && r.kind !== 'import') return undefined;
  if (!plainText(r.label, L.labelChars) || !plainText(r.server, L.serverChars) || !plainText(r.tool, L.toolChars) || !r.server || !r.tool) return undefined;
  if (r.channelKind !== 'other' && !CHANNEL_KINDS.includes(r.channelKind as ChannelKind)) return undefined;
  if (typeof r.args !== 'string' || r.args.length > L.argsChars) return undefined;
  return { id: r.id, kind: r.kind, label: r.label, channelKind: r.channelKind as Recipe['channelKind'], server: r.server, tool: r.tool, args: r.args };
}

export type ParseResult = { ok: true; doc: ContactsDoc; dropped: number } | { ok: false; error: string };

/**
 * FR-008: a good contact is kept, a bad one dropped (and counted). A document that cannot be read at all (not JSON, unknown version,
 * over `storeBytes`) is an error: the caller leaves the file as it is.
 */
export function parseContactsDoc(raw: string): ParseResult {
  if (typeof raw !== 'string') return { ok: false, error: 'not text' };
  if (!fitsCap(utf8Len(raw), L.storeBytes)) return { ok: false, error: 'the file is larger than Durbar writes' };
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return { ok: false, error: 'not valid JSON' }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false, error: 'not a contacts file' };
  const d = j as Record<string, unknown>;
  if (d.version !== 1) return { ok: false, error: 'a version of the contacts file this Durbar does not know' };
  const contacts: Contact[] = [];
  const ids = new Set<string>();
  let dropped = 0;
  for (const x of Array.isArray(d.contacts) ? d.contacts : []) {
    const c = parseContact(x);
    if (!c || ids.has(c.id)) { dropped++; continue; }
    ids.add(c.id);
    contacts.push(c);
    // FR-008: more valid contacts than Durbar writes is a file it cannot read (never silently cut, never overwritten)
    if (contacts.length > L.contactsMax) return { ok: false, error: `the file holds more than ${L.contactsMax} contacts` };
  }
  const recipes: Recipe[] = [];
  const rids = new Set<string>();
  for (const x of Array.isArray(d.recipes) ? d.recipes : []) {
    const r = parseRecipe(x);
    if (!r || rids.has(r.id)) { dropped++; continue; }
    rids.add(r.id);
    recipes.push(r);
    if (recipes.length > L.recipesMax) return { ok: false, error: `the file holds more than ${L.recipesMax} send recipes` };
  }
  const s = d.settings as Record<string, unknown> | undefined;
  return { ok: true, dropped, doc: { version: 1, contacts, recipes, settings: { teamsApp: !!s && typeof s === 'object' && s.teamsApp === true } } };
}

/** Compact JSON, the way it is written and measured. */
export const serializeContactsDoc = (doc: ContactsDoc): string => JSON.stringify(doc);

/** FR-005: the text to write, or the reason there is none: more than a cap allows, or over `storeBytes`. Checked before any write. */
export function checkedSerialize(doc: ContactsDoc): { ok: true; text: string } | { ok: false; error: string } {
  if (doc.contacts.length > L.contactsMax) return { ok: false, error: REASONS.contactsCap };
  if (doc.recipes.length > L.recipesMax) return { ok: false, error: REASONS.recipesCap };
  const text = serializeContactsDoc(doc);
  if (!fitsCap(utf8Len(text), L.storeBytes)) return { ok: false, error: 'The contacts are larger than Durbar writes.' };
  return { ok: true, text };
}

const cmpName = (a: Contact, b: Contact): number => a.name.localeCompare(b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** FR-006, FR-010: favourites first, by `favOrder`; then by name (locale compare). Ties are broken by name, then id, so the order is stable. */
export function sortContacts(contacts: readonly Contact[]): Contact[] {
  return [...contacts].sort((a, b) => (a.favourite !== b.favourite ? (a.favourite ? -1 : 1) : a.favourite && a.favOrder !== b.favOrder ? a.favOrder - b.favOrder : cmpName(a, b)));
}

export type ContactChange =
  | { op: 'add'; fields: Record<string, unknown>; source?: ContactSource }
  | { op: 'update'; id: string; rev: number; fields: Record<string, unknown> }
  | { op: 'delete'; id: string; rev: number }
  | { op: 'star' | 'unstar' | 'moveUp' | 'moveDown'; id: string; rev: number };

export type ChangeResult =
  | { ok: true; doc: ContactsDoc; contact?: Contact }
  | { ok: false; code: 'stale' | 'cap' | 'missing' | 'invalid'; error: string; field?: string; current?: Contact };

const copyDoc = (d: ContactsDoc): ContactsDoc => ({ ...d, contacts: d.contacts.map((c) => ({ ...c, aliases: [...c.aliases], channels: c.channels.map((x) => ({ ...x })) })), recipes: d.recipes.map((r) => ({ ...r })), settings: { ...d.settings } });

type FavSnap = Map<string, string>;
const favSnap = (d: ContactsDoc): FavSnap => new Map(d.contacts.map((c) => [c.id, `${c.favourite}:${c.favOrder}`]));
/** Renumber the favourites 0..n-1 in their current order (ties by name, id). */
function renumber(d: ContactsDoc): void {
  sortContacts(d.contacts.filter((c) => c.favourite)).forEach((c, i) => { c.favOrder = i; });
}
/** Every contact whose favourite flag or number differs from the snapshot gets `rev + 1` once, however many steps changed it (FR-002). */
function bumpChanged(d: ContactsDoc, before: FavSnap, stamp: string): void {
  for (const c of d.contacts) if (before.get(c.id) !== `${c.favourite}:${c.favOrder}`) { c.rev += 1; c.updatedAt = stamp; }
}

/**
 * FR-006, FR-007: one change applied to a copy of the document. `rev` must match (else `stale`, with the contact as saved); a change
 * bumps `rev` and `updatedAt`; the 301st contact, the 9th channel and the 6th alias are refused with their reasons; favourite
 * operations keep `favOrder` dense. `rand(n)` is a uniform integer below n (ids).
 */
export function applyChange(doc: ContactsDoc, change: ContactChange, now: Date, rand: (n: number) => number): ChangeResult {
  const d = copyDoc(doc);
  const stamp = now.toISOString();
  const madeChannelIds = new Set<string>();
  const channelIdTaken = (id: string): boolean => madeChannelIds.has(id) || d.contacts.some((c) => c.channels.some((x) => x.id === id));
  const newChannelId = (): string => {
    let id = newId('ch-', rand);
    for (let i = 0; i < L.idTries && channelIdTaken(id); i++) id = newId('ch-', rand);
    madeChannelIds.add(id); // a taken id after the last try is refused by cleanContact (a repeated channel id)
    return id;
  };
  const fail = (r: FieldFail): ChangeResult => ({ ok: false, code: r.cap ? 'cap' : 'invalid', error: r.error, field: r.field });
  if (change.op === 'add') {
    if (d.contacts.length >= L.contactsMax) return { ok: false, code: 'cap', error: REASONS.contactsCap, field: 'contacts' };
    const r = cleanContact(change.fields, newChannelId);
    if (!r.ok) return fail(r);
    if (r.fields.channels.some((x) => d.contacts.some((c) => c.channels.some((y) => y.id === x.id)))) return { ok: false, code: 'invalid', error: 'Could not make a channel id.' };
    let id = newId('p-', rand);
    for (let i = 0; i < L.idTries && d.contacts.some((c) => c.id === id); i++) id = newId('p-', rand);
    if (d.contacts.some((c) => c.id === id)) return { ok: false, code: 'invalid', error: 'Could not make a contact id.' };
    const contact: Contact = { id, ...r.fields, favourite: false, favOrder: 0, source: change.source ?? 'typed', createdAt: stamp, updatedAt: stamp, rev: 1 };
    d.contacts.push(contact);
    return { ok: true, doc: d, contact };
  }
  const i = d.contacts.findIndex((c) => c.id === change.id);
  if (i < 0) return { ok: false, code: 'missing', error: REASONS.missing };
  const cur = d.contacts[i];
  if (cur.rev !== change.rev) return { ok: false, code: 'stale', error: REASONS.stale, current: cur };
  if (change.op === 'delete') {
    const before = favSnap(d);
    d.contacts.splice(i, 1);
    renumber(d);
    bumpChanged(d, before, stamp);
    return { ok: true, doc: d, contact: cur };
  }
  const bump = (c: Contact): Contact => { c.rev += 1; c.updatedAt = stamp; return c; };
  if (change.op === 'update') {
    const merged: Record<string, unknown> = { ...cur, ...change.fields };
    if (change.fields.channels !== undefined && change.fields.preferred === undefined) delete merged.preferred; // the first way, unless the old one is still there
    if (change.fields.channels !== undefined && change.fields.preferred === undefined && Array.isArray(merged.channels) && merged.channels.some((x) => (x as Record<string, unknown> | null)?.id === cur.preferred)) merged.preferred = cur.preferred;
    const r = cleanContact(merged, newChannelId);
    if (!r.ok) return fail(r);
    if (r.fields.channels.some((x) => d.contacts.some((c) => c !== cur && c.channels.some((y) => y.id === x.id)))) return { ok: false, code: 'invalid', error: 'Could not make a channel id.' };
    if (JSON.stringify(r.fields) === JSON.stringify({ name: cur.name, aliases: cur.aliases, initials: cur.initials, notes: cur.notes, channels: cur.channels, preferred: cur.preferred })) return { ok: true, doc: d, contact: cur };
    Object.assign(cur, r.fields);
    return { ok: true, doc: d, contact: bump(cur) };
  }
  if (change.op === 'star') {
    if (cur.favourite) return { ok: true, doc: d, contact: cur };
    const before = favSnap(d);
    renumber(d); // close any gap first, so the new favourite goes last
    cur.favourite = true;
    cur.favOrder = d.contacts.filter((c) => c.favourite && c !== cur).length;
    bumpChanged(d, before, stamp);
    return { ok: true, doc: d, contact: cur };
  }
  if (change.op === 'unstar') {
    if (!cur.favourite) return { ok: true, doc: d, contact: cur };
    const before = favSnap(d);
    cur.favourite = false;
    cur.favOrder = 0;
    renumber(d);
    bumpChanged(d, before, stamp);
    return { ok: true, doc: d, contact: cur };
  }
  // moveUp / moveDown: swap with the neighbour in the dense order
  if (!cur.favourite) return { ok: false, code: 'invalid', error: REASONS.notFavourite, field: 'favourite' };
  const before = favSnap(d);
  renumber(d);
  const favs = sortContacts(d.contacts.filter((c) => c.favourite));
  const at = favs.findIndex((c) => c.id === cur.id);
  const to = change.op === 'moveUp' ? at - 1 : at + 1;
  if (to >= 0 && to < favs.length) [favs[at].favOrder, favs[to].favOrder] = [favs[to].favOrder, favs[at].favOrder];
  bumpChanged(d, before, stamp);
  return { ok: true, doc: d, contact: cur };
}
