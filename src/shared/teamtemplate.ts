/**
 * The one reader of a team template (spec 111 FR-002..FR-005, FR-010..FR-012, T004): `checkTeamTemplate(value, level)` and `checkMember`
 * validate, size-check and COPY a template into new objects with known keys only; `frameCheck` is FR-012's best-effort, closed guard
 * against text that forges the frame the brief travels in (plan, *Frame guard algorithm*). Pure: no Electron, no DOM, no fs.
 * `level` is `own` (store, editor) or `imported` (a file, never trusted): it changes the text rules and refuses the store-only keys
 * (`memberId`, `briefFrom`), never the shape. Every lookup of a key from outside goes through a `Map` or `Set` (own keys only, so
 * `toString` or `__proto__` are plain unknown keys). Errors name the field and the member number, never the value or the key.
 * Honest limits: `HIDDEN_CHARS` is the engine's property set of the day; the frame guard is a second guard behind the nonce of FR-036.
 * Not run on Windows or macOS (pure code).
 */
import { HIDDEN_CHARS, maskOutgoing } from './redact';
import { checkDisplayName } from './names';
import { parseEffort } from './effort';
import { parseCapIn } from './credits';
import { nameKey, skeleton } from './skeleton';

export type Level = 'own' | 'imported';
export interface TeamCap { unit: 'aiu' | 'usd'; amount: number }
export interface TeamMember {
  name: string; role: string; brief?: string; profile?: string; app: string; model?: string; effort?: string;
  permMode: 'read-only' | 'ask' | 'allow'; cap?: TeamCap; character?: string; sendBrief: boolean;
  /** store-only (FR-002): never in a file */
  memberId?: string; briefFrom?: 'file';
}
export interface TeamTemplate {
  name: string; description?: string; members: TeamMember[];
  /** store-only metadata, accepted at level `own` only; a file cannot set them */
  id?: string; origin?: 'own' | 'imported'; createdAt?: number; updatedAt?: number;
}
export type MemberResult = { ok: true; member: TeamMember } | { ok: false; errors: string[] };
export type TemplateResult =
  | { ok: true; template: TeamTemplate; ignored: number }
  | { ok: false; errors: string[]; members: MemberResult[]; ignored: number };

export const LIMITS = {
  name: 60, role: 40, templateName: 40, description: 200, members: 8, templates: 50,
  ownBrief: { chars: 4000, lines: 80 }, importedBrief: { chars: 2000, lines: 40 },
} as const;

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
const CHARACTER_RE = /^[a-z][a-z0-9-]{0,23}$/;
/** `PROFILE_ID` of `src/main/folders.ts` (a test checks it is the same source) */
const PROFILE_ID_RE = /^[A-Za-z0-9._:@/-]{1,100}$/;
/** the shape of an adapter id (`ADAPTER_ID`, `folders.ts`, not exported, so no equality test; G2 may move it here); main checks the id against the ready apps at create (FR-031) */
const APP_RE = /^[a-z][a-z0-9-]{0,31}$/;
const MEMBER_ID_RE = /^[0-9a-f]{32}$/;
const TEMPLATE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PERM_MODES: ReadonlySet<string> = new Set(['read-only', 'ask', 'allow']);
const CAP_UNITS: ReadonlySet<string> = new Set(['aiu', 'usd']);
const MEMBER_KEYS: ReadonlySet<string> = new Set(['name', 'role', 'brief', 'profile', 'app', 'model', 'effort', 'permMode', 'cap', 'character', 'sendBrief']);
const MEMBER_KEYS_OWN: ReadonlySet<string> = new Set([...MEMBER_KEYS, 'memberId', 'briefFrom']);
const TEMPLATE_KEYS: ReadonlySet<string> = new Set(['name', 'description', 'members']);
const TEMPLATE_KEYS_OWN: ReadonlySet<string> = new Set([...TEMPLATE_KEYS, 'id', 'origin', 'createdAt', 'updatedAt']);
const UNREADABLE = 'uses something this version cannot read.';

// ---------------------------------------------------------------------------------------------------------------- text rules (FR-012)

const HIDDEN_G = new RegExp(HIDDEN_CHARS.source, HIDDEN_CHARS.flags.includes('g') ? HIDDEN_CHARS.flags : HIDDEN_CHARS.flags + 'g');
/** a letter or mark (a virama is a mark) of a script that needs ZWNJ or ZWJ: Arabic script and the Indic scripts of the plan (*Text rules*) */
const JOINER_LETTER = /^(?=[\p{L}\p{M}])[\p{scx=Arabic}\p{scx=Devanagari}\p{scx=Bengali}\p{scx=Gurmukhi}\p{scx=Gujarati}\p{scx=Oriya}\p{scx=Tamil}\p{scx=Telugu}\p{scx=Kannada}\p{scx=Malayalam}\p{scx=Sinhala}]$/u;

const hex4 = (cp: number): string => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
/** what a hidden character is called and how to fix it, never the character itself */
function describeHidden(cp: number): { what: string; fix: string } {
  if (cp === 0x202f || cp === 0x2006 || cp === 0x2008 || cp === 0x2009 || cp === 0x200a) return { what: cp === 0x202f ? 'a narrow no-break space' : 'a thin or hair space', fix: 'Replace it with a normal space.' };
  if (cp === 0x200d) return { what: 'an emoji joiner', fix: 'Remove it or use a simpler emoji.' };
  if (cp === 0xfe0f) return { what: 'an emoji variation selector', fix: 'Remove it or use a simpler emoji.' };
  if (cp === 0x200c) return { what: 'a zero-width non-joiner', fix: 'Remove it.' };
  return { what: 'a hidden character', fix: 'Remove it.' };
}
const codePointBefore = (s: string, i: number): string => {
  if (i <= 0) return '';
  const lo = s.charCodeAt(i - 1);
  return lo >= 0xdc00 && lo <= 0xdfff && i >= 2 && s.charCodeAt(i - 2) >= 0xd800 && s.charCodeAt(i - 2) <= 0xdbff ? s.slice(i - 2, i) : s[i - 1];
};

/**
 * The first `HIDDEN_CHARS` character of `s` that is refused, as an error text (`where` is "Member 2, role"), or undefined. With `joiners`
 * ZWNJ and ZWJ pass when both neighbours are letters of a script that needs them (role and brief only). `lines`: name the line (a
 * brief), else the character's place. One pass, linear.
 */
function hiddenError(s: string, where: string, joiners: boolean, lines: boolean): string | undefined {
  for (const m of s.matchAll(HIDDEN_G)) {
    const at = m.index!;
    const cp = m[0].codePointAt(0)!;
    if (joiners && (cp === 0x200c || cp === 0x200d)) {
      const next = String.fromCodePoint(s.codePointAt(at + 1) ?? 0x20);
      if (JOINER_LETTER.test(codePointBefore(s, at)) && JOINER_LETTER.test(next)) continue;
    }
    const d = describeHidden(cp);
    if (lines) {
      let line = 1;
      for (let i = s.indexOf('\n'); i >= 0 && i < at; i = s.indexOf('\n', i + 1)) line++;
      return `${where}, line ${line}: ${d.what} (${hex4(cp)}). ${d.fix}`;
    }
    return `${where}: ${d.what} (${hex4(cp)}) at character ${[...s.slice(0, at)].length + 1}. ${d.fix}`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------- frame guard (plan)

export type FrameReason = 'code' | 'phrase' | 'comment' | 'fence' | 'key' | 'leading' | 'span' | 'colon';
/** `line` is 1-based for pass 2 and 0 for pass 1 (the whole text) */
export type FrameResult = { ok: true } | { ok: false; line: number; reason: FrameReason };

const FRAME_WORDS: ReadonlySet<string> = new Set(['role', 'brief', 'template', 'author', 'written', 'person', 'user', 'system', 'instruction', 'instructions', 'end', 'begin', 'start', 'assistant', 'human', 'developer', 'tool']);
const FIRST_WORDS: ReadonlySet<string> = new Set(['system', 'developer', 'assistant']);
const HEX_WORD = /^[0-9a-f]{8,}$/;
const CLOSERS: ReadonlyMap<string, string> = new Map([['(', ')'], ['[', ']'], ['<', '>'], ['{', '}']]);
const SPAN_RES: readonly RegExp[] = [/\[[^[\]]*\]/gu, /<[^<>]*>/gu, /\([^()]*\)/gu, /\{[^{}]*\}/gu];
const LEAD_MARK = /(?:\s+|[>\-*+#]|\d+[.)]|\[[ x]\])/uy;
const PHRASES: readonly string[] = ['end of role brief', 'from a team template'];

const wordsOf = (s: string): string[] => s.match(/[\p{L}\p{N}]+/gu) ?? [];
/** NFKC, the letter part of `skeleton()` (FR-158), then case (2026-11-12: the table maps capitals, so it runs before case is folded); no digit folds */
const norm = (t: string): string => skeleton(t.normalize('NFKC')).toLowerCase();
const refuse = (line: number, reason: FrameReason): FrameResult => ({ ok: false, line, reason });

/** FR-012's frame guard, exactly the plan's algorithm: closed, best effort, behind the nonce of FR-036. Linear in the text. */
export function frameCheck(text: string): FrameResult {
  // pass 1, the whole text: white space and punctuation to one space
  const flat = norm(text).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const w = flat === '' ? [] : flat.split(' ');
  for (let i = 0; i + 2 < w.length; i++) if (w[i] === 'role' && w[i + 1] === 'brief' && HEX_WORD.test(w[i + 2])) return refuse(0, 'code'); // before any digit fold
  const folded = ' ' + skeleton(flat, { digits: true }) + ' ';
  for (const p of PHRASES) if (folded.includes(' ' + skeleton(p, { digits: true }) + ' ')) return refuse(0, 'phrase');

  // pass 2, each line, line breaks kept
  const lines = text.split(/\r\n|\r|\n/);
  for (let n = 0; n < lines.length; n++) {
    const l = norm(lines[n]);
    let p = 0; // 1. leading marks, repeatedly
    for (;;) {
      LEAD_MARK.lastIndex = p;
      const m = LEAD_MARK.exec(l);
      if (!m || m[0] === '') break;
      p += m[0].length;
    }
    const s = p === 0 ? l : l.slice(p);
    // 2. comment, code fence, quoted frame key
    if (s.startsWith('<!--')) return refuse(n + 1, 'comment');
    if (s.startsWith('```') || s.startsWith('~~~')) for (const x of wordsOf(s.slice(3))) if (FRAME_WORDS.has(x) || HEX_WORD.test(x)) return refuse(n + 1, 'fence');
    const key = /^"([^"]*)":/u.exec(s);
    if (key && FRAME_WORDS.has(key[1])) return refuse(n + 1, 'key');
    // 3. leading spans, each to the first closer of its kind, judged one by one
    let q = 0;
    while (s[q] === '`') q++;
    for (;;) {
      const close = CLOSERS.get(s[q]);
      if (close === undefined) break;
      const e = s.indexOf(close, q + 1);
      for (const x of wordsOf(e < 0 ? s.slice(q + 1) : s.slice(q + 1, e))) if (FRAME_WORDS.has(x) || HEX_WORD.test(x)) return refuse(n + 1, 'leading');
      if (e < 0) break;
      q = e + 1;
      while (q < s.length && /\s/u.test(s[q])) q++;
    }
    // 4. spans anywhere: (a) only frame words, (b) first word system, developer or assistant
    for (const re of SPAN_RES) {
      for (const m of s.matchAll(re)) {
        const ws = wordsOf(m[0]);
        if (ws.length > 0 && (ws.every((x) => FRAME_WORDS.has(x)) || FIRST_WORDS.has(ws[0]))) return refuse(n + 1, 'span');
      }
    }
    // 5. a line ending in ':' with two frame words
    const tail = s.trimEnd();
    if (tail.endsWith(':') && wordsOf(tail).filter((x) => FRAME_WORDS.has(x)).length >= 2) return refuse(n + 1, 'colon');
  }
  return { ok: true };
}

const FRAME_MESSAGE: Readonly<Record<FrameReason, string>> = {
  code: 'it holds the words that open or close an instruction frame', phrase: 'it holds the words that open or close an instruction frame',
  comment: 'it starts a comment marker', fence: 'a code fence names a frame word', key: 'it starts like a chat message',
  leading: 'a bracket or tag at the start of the line holds a frame word', span: "a bracket or tag with the word 'system'", colon: 'it ends like a frame heading',
};
function frameError(where: string, r: FrameResult): string | undefined {
  if (r.ok) return undefined;
  const at = r.line === 0 ? where : `${where}, line ${r.line}`;
  return `${at}: this ${r.line === 0 ? 'text' : 'line'} looks like the start or end of an instruction frame (${FRAME_MESSAGE[r.reason]}). Reword it.`;
}

// ---------------------------------------------------------------------------------------------------------------- member

type Fields = Map<string, unknown>;
/** The own enumerable string keys of a plain object as a `Map`, so no inherited key is ever read. */
function fieldsOf(v: unknown): Fields | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? new Map(Object.entries(v)) : undefined;
}
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A required or optional display string (name, role): hidden characters first (`joiners`: role only), then `checkDisplayName`, never empty. */
function displayText(raw: unknown, max: number, where: string, level: Level, joiners: boolean, required: boolean): { text?: string; error?: string } {
  if (raw === undefined && !required) return {};
  if (typeof raw !== 'string') return { error: `${where}: use 1 to ${max} characters of text.` };
  if (raw.length > max * 4) return { error: `${where}: use 1 to ${max} characters.` };
  if (level === 'imported' || joiners) {
    const h = hiddenError(raw, where, joiners, false);
    if (h) return { error: h };
  }
  const c = checkDisplayName(raw, max);
  if (!c.ok) return { error: `${where}: ${c.error}` };
  if (c.name === '' && required) return { error: `${where}: it cannot be empty.` };
  return c.name === '' ? {} : { text: c.name };
}

function briefLimits(imported: boolean): { chars: number; lines: number } {
  return imported ? LIMITS.importedBrief : LIMITS.ownBrief;
}
const lineCount = (s: string): number => {
  let n = 1;
  for (let i = s.indexOf('\n'); i >= 0; i = s.indexOf('\n', i + 1)) n++;
  return n;
};
const tooLong = (s: string, lim: { chars: number; lines: number }): boolean => s.length > lim.chars * 2 ? true : [...s].length > lim.chars || lineCount(s) > lim.lines;

/** Validates one member and returns a copy with known keys only. `n` is its number (1-based) in messages. */
export function checkMember(value: unknown, level: Level, n: number = 1): MemberResult {
  const at = `Member ${n}`;
  try {
    const f = fieldsOf(value);
    if (!f) return { ok: false, errors: [`${at}: not a member.`] };
    const known = level === 'imported' ? MEMBER_KEYS : MEMBER_KEYS_OWN;
    for (const k of f.keys()) if (!known.has(k)) return { ok: false, errors: [`${at}: ${UNREADABLE}`] };
    const errors: string[] = [];
    const imported = level === 'imported';
    // at the imported level every string is looked at for hidden characters, whatever the field
    if (imported) {
      for (const [k, v] of f) if (typeof v === 'string' && k !== 'role' && k !== 'brief' && k !== 'name') { const h = hiddenError(v, `${at}, ${k}`, false, false); if (h) errors.push(h); }
    }
    const name = displayText(f.get('name'), LIMITS.name, `${at}, name`, level, false, true);
    if (name.error) errors.push(name.error);
    const role = displayText(f.get('role'), LIMITS.role, `${at}, role`, level, true, true);
    if (role.error) errors.push(role.error);
    else { const fe = frameError(`${at}, role`, frameCheck(role.text!)); if (fe) errors.push(fe); }

    const app = f.get('app');
    if (typeof app !== 'string' || !APP_RE.test(app)) errors.push(`${at}, app: use the id of an app.`);
    const optional = (key: string, ok: (s: string) => boolean, what: string): string | undefined => {
      const v = f.get(key);
      if (v === undefined) return undefined;
      if (typeof v !== 'string' || !ok(v)) { errors.push(`${at}, ${key}: ${what}`); return undefined; }
      return v;
    };
    const model = optional('model', (s) => MODEL_RE.test(s), 'use a model id.');
    const effort = optional('effort', (s) => parseEffort(s) !== undefined, 'use a plain effort word.');
    const profile = optional('profile', (s) => PROFILE_ID_RE.test(s), 'use a custom agent id.');
    const character = optional('character', (s) => CHARACTER_RE.test(s), 'use a character id.');
    const mode = f.get('permMode');
    if (mode !== undefined && (typeof mode !== 'string' || !PERM_MODES.has(mode))) errors.push(`${at}, permMode: use read-only, ask or allow.`);
    const send = f.get('sendBrief');
    if (send !== undefined && typeof send !== 'boolean') errors.push(`${at}, sendBrief: use true or false.`);

    let cap: TeamCap | undefined;
    const capRaw = f.get('cap');
    if (capRaw !== undefined) {
      const c = fieldsOf(capRaw);
      const unit = c?.get('unit');
      const amount = c?.get('amount');
      if (!c || c.size !== 2 || typeof unit !== 'string' || !CAP_UNITS.has(unit) || !isInt(amount)) errors.push(`${at}, cap: use { unit, amount }.`);
      else {
        const a = parseCapIn(unit as 'aiu' | 'usd', amount);
        if (a === undefined) errors.push(`${at}, cap: the amount is outside the allowed range.`);
        else cap = { unit: unit as 'aiu' | 'usd', amount: a };
      }
    }

    // store-only keys (level own only: a file that holds them was refused above)
    const memberId = f.get('memberId');
    if (memberId !== undefined && (typeof memberId !== 'string' || !MEMBER_ID_RE.test(memberId))) errors.push(`${at}, memberId: ${UNREADABLE}`);
    const from = f.get('briefFrom');
    if (from !== undefined && from !== 'file') errors.push(`${at}, briefFrom: ${UNREADABLE}`);

    // the brief: size, hidden characters, LF, the mask, then the frame guard on what the agent gets
    let brief: string | undefined;
    const rawBrief = f.get('brief');
    if (rawBrief !== undefined) {
      const lim = briefLimits(imported || from === 'file');
      if (typeof rawBrief !== 'string') errors.push(`${at}, brief: use text.`);
      else if (rawBrief.length > lim.chars * 2) errors.push(`${at}, brief: at most ${lim.chars.toLocaleString('en-US')} characters and ${lim.lines} lines.`);
      else {
        const lf = rawBrief.replace(/\r\n?/g, '\n');
        const h = hiddenError(lf, `${at}, brief`, true, true);
        if (h) errors.push(h);
        else if (tooLong(lf, lim)) errors.push(`${at}, brief: at most ${lim.chars.toLocaleString('en-US')} characters and ${lim.lines} lines.`);
        else {
          const masked = maskOutgoing(lf).text;
          const fe = frameError(`${at}, brief`, frameCheck(lf)) ?? (masked === lf ? undefined : frameError(`${at}, brief`, frameCheck(masked)));
          if (fe) errors.push(fe);
          else if (tooLong(masked, lim)) errors.push(`${at}, brief: at most ${lim.chars.toLocaleString('en-US')} characters and ${lim.lines} lines.`);
          else if (masked.trim() !== '') brief = masked;
        }
      }
    }
    if (errors.length > 0) return { ok: false, errors };

    const member: TeamMember = { name: name.text!, role: role.text!, app: app as string, permMode: (mode ?? 'read-only') as TeamMember['permMode'], sendBrief: send === undefined ? true : (send as boolean) };
    if (brief !== undefined) member.brief = brief;
    if (profile !== undefined) member.profile = profile;
    if (model !== undefined) member.model = model;
    if (effort !== undefined) member.effort = effort;
    if (cap !== undefined) member.cap = cap;
    if (character !== undefined) member.character = character;
    if (memberId !== undefined) member.memberId = memberId as string;
    if (from !== undefined) member.briefFrom = 'file';
    return { ok: true, member };
  } catch {
    return { ok: false, errors: [`${at}: not a member.`] };
  }
}

// ---------------------------------------------------------------------------------------------------------------- template

/** Validates a template and returns a copy; unknown template keys are ignored and counted, a member with an unknown key is refused (FR-011). */
export function checkTeamTemplate(value: unknown, level: Level): TemplateResult {
  const none = (errors: string[], members: MemberResult[] = [], ignored = 0): TemplateResult => ({ ok: false, errors, members, ignored });
  try {
    const f = fieldsOf(value);
    if (!f) return none(['Not a team template.']);
    const imported = level === 'imported';
    const known = imported ? TEMPLATE_KEYS : TEMPLATE_KEYS_OWN;
    let ignored = 0;
    for (const k of f.keys()) if (!known.has(k)) ignored++;
    const errors: string[] = [];
    const name = displayText(f.get('name'), LIMITS.templateName, 'Template name', level, false, true);
    if (name.error) errors.push(name.error);
    const desc = displayText(f.get('description'), LIMITS.description, 'Description', level, false, false);
    if (desc.error) errors.push(desc.error);
    let id: string | undefined; let origin: 'own' | 'imported' | undefined; let createdAt: number | undefined; let updatedAt: number | undefined;
    if (!imported) {
      const i = f.get('id'); const o = f.get('origin'); const c = f.get('createdAt'); const u = f.get('updatedAt');
      if (i !== undefined) { if (typeof i === 'string' && TEMPLATE_ID_RE.test(i)) id = i; else errors.push('Template id: not valid.'); }
      if (o !== undefined) { if (o === 'own' || o === 'imported') origin = o; else errors.push('Template origin: use own or imported.'); }
      if (c !== undefined) { if (isInt(c) && c >= 0) createdAt = c; else errors.push('Template createdAt: not valid.'); }
      if (u !== undefined) { if (isInt(u) && u >= 0) updatedAt = u; else errors.push('Template updatedAt: not valid.'); }
    }
    const list = f.get('members');
    if (!Array.isArray(list) || list.length < 1) { errors.push('Members: add at least one member.'); return none(errors, [], ignored); }
    if (list.length > LIMITS.members) { errors.push(`Members: at most ${LIMITS.members}.`); return none(errors, [], ignored); }
    const results: MemberResult[] = [];
    const keys = new Map<string, number>();
    for (let i = 0; i < list.length; i++) {
      let r = checkMember(list[i], level, i + 1);
      if (r.ok) {
        const key = nameKey(r.member.name);
        const first = keys.get(key);
        if (first !== undefined) r = { ok: false, errors: [`Member ${i + 1}'s name looks the same as member ${first}'s.`] };
        else keys.set(key, i + 1);
      }
      if (!r.ok) errors.push(...r.errors);
      results.push(r);
    }
    if (errors.length > 0) return none(errors, results, ignored);
    const template: TeamTemplate = { name: name.text!, members: results.map((r) => (r as { ok: true; member: TeamMember }).member) };
    if (desc.text !== undefined) template.description = desc.text;
    if (id !== undefined) template.id = id;
    if (origin !== undefined) template.origin = origin;
    if (createdAt !== undefined) template.createdAt = createdAt;
    if (updatedAt !== undefined) template.updatedAt = updatedAt;
    return { ok: true, template, ignored };
  } catch {
    return none(['Not a team template.']);
  }
}
