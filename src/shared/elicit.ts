import { isObj } from './guards';
/**
 * MCP elicitation (spec 012 FR-151, closes the FR-147/FR-148 known gap): an MCP server asks the user to fill a small form, or to
 * finish a step on a web page (URL mode). Adapter-neutral and pure: no Electron, no vendor types. Used by the adapters (schema
 * to fields), by main (checks the answer before it goes back to the adapter) and by the tests.
 *
 * Field values can be secrets (a token, a password): they are never logged and never put in an event.
 */

export type ElicitFieldType = 'string' | 'number' | 'integer' | 'boolean' | 'enum';
export type ElicitFormat = 'email' | 'uri' | 'date' | 'date-time';
export type ElicitValue = string | number | boolean;

/** One form field, already cleaned and capped. */
export interface ElicitField {
  name: string;
  title: string;
  description?: string;
  type: ElicitFieldType;
  /** `enum` only: the allowed values, and what to show for each (same order) when the server gave names. */
  enumValues?: string[];
  enumNames?: string[];
  required?: boolean;
  /** number / integer only. */
  min?: number;
  max?: number;
  /** string only. */
  minLength?: number;
  maxLength?: number;
  format?: ElicitFormat;
  /** Looks like a password, token or secret: the card uses a password input. */
  secret?: boolean;
  default?: ElicitValue;
}

/** What the card shows: a form (`fields`, possibly empty) or a URL flow (`url`, `host`). */
export interface ElicitRequest {
  message: string;
  /** The MCP server that asks, when known. */
  source?: string;
  fields?: ElicitField[];
  /** URL mode: an https address the user may open in the browser (only after a click). */
  url?: string;
  host?: string;
}

export type ElicitAction = 'accept' | 'decline' | 'cancel';

/** The answer an adapter returns to the vendor: `{action, content?}`, the MCP `ElicitResult`. */
export interface ElicitAnswer {
  action: ElicitAction;
  content?: Record<string, ElicitValue>;
}

export const MAX_ELICIT_FIELDS = 12;
export const MAX_ELICIT_TEXT = 2000;
const MAX_ENUM = 50;
const NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const DROP_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​⁠﻿‪-‮⁦-⁩]/g;
const SECRET_RE = /pass(word|phrase|wd|code)?|token|secret|api[\s_.-]?key|private[\s_.-]?key|credential|\bpin\b|otp/i;

const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const fin = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const len = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? Math.min(v, MAX_ELICIT_TEXT) : undefined);

/** One line of text, control and direction characters removed, cut to `max`. */
export function elicitText(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(DROP_RE, '').replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

/** Does a field look like it holds a secret (by its name, title or description)? */
export function isSecretField(name: string, title?: string, description?: string): boolean {
  return SECRET_RE.test(name) || SECRET_RE.test(title ?? '') || SECRET_RE.test(description ?? '');
}

/** One schema property to a field, or undefined when Durbar cannot show it (arrays, objects, unknown types). */
function fieldOf(name: string, p: unknown, required: boolean): ElicitField | undefined {
  if (!NAME_RE.test(name) || !isObj(p)) return undefined;
  const type = own(p, 'type');
  const title = elicitText(own(p, 'title'), 120) ?? name;
  const description = elicitText(own(p, 'description'), 300);
  const base = { name, title, ...(description ? { description } : {}), ...(required ? { required: true } : {}) };
  if (type === 'boolean') {
    const d = own(p, 'default');
    return { ...base, type: 'boolean', ...(typeof d === 'boolean' ? { default: d } : {}) };
  }
  if (type === 'number' || type === 'integer') {
    const min = fin(own(p, 'minimum'));
    const max = fin(own(p, 'maximum'));
    const d = fin(own(p, 'default'));
    return { ...base, type, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(d !== undefined ? { default: d } : {}) };
  }
  if (type !== 'string') return undefined;
  const d = own(p, 'default');
  // an enum: `enum` (+ optional `enumNames`) or `oneOf: [{const, title}]`
  let values: string[] | undefined;
  let names: string[] | undefined;
  const en = own(p, 'enum');
  const oneOf = own(p, 'oneOf');
  if (Array.isArray(en)) {
    if (!en.length || en.length > MAX_ENUM || !en.every((x) => typeof x === 'string' && x.length <= 200)) return undefined;
    values = en as string[];
    const nm = own(p, 'enumNames');
    if (Array.isArray(nm) && nm.length === values.length && nm.every((x) => typeof x === 'string')) names = nm.map((x, i) => elicitText(x, 120) ?? values![i]);
  } else if (Array.isArray(oneOf)) {
    if (!oneOf.length || oneOf.length > MAX_ENUM || !oneOf.every((o) => isObj(o) && typeof own(o, 'const') === 'string' && String(own(o, 'const')).length <= 200)) return undefined;
    values = oneOf.map((o) => String((o as Record<string, unknown>).const));
    names = oneOf.map((o, i) => elicitText((o as Record<string, unknown>).title, 120) ?? values![i]);
  }
  if (values) {
    return { ...base, type: 'enum', enumValues: values, ...(names ? { enumNames: names } : {}), ...(typeof d === 'string' && values.includes(d) ? { default: d } : {}) };
  }
  const f = own(p, 'format');
  if (f !== undefined && f !== 'email' && f !== 'uri' && f !== 'date' && f !== 'date-time') return undefined; // a format we cannot check
  const minLength = len(own(p, 'minLength'));
  const maxLength = len(own(p, 'maxLength'));
  const secret = isSecretField(name, title, description);
  return {
    ...base,
    type: 'string',
    ...(minLength !== undefined ? { minLength } : {}),
    ...(maxLength !== undefined ? { maxLength } : {}),
    ...(f ? { format: f as ElicitFormat } : {}),
    ...(secret ? { secret: true } : {}),
    ...(typeof d === 'string' && !secret ? { default: d.slice(0, MAX_ELICIT_TEXT) } : {}),
  };
}

/**
 * The schema's simple properties to fields. Unsupported optional ones are dropped (`dropped`); an unsupported required one is
 * listed in `unsupportedRequired`, and the request must then be declined.
 */
export function parseElicitSchema(schema: unknown): { fields: ElicitField[]; dropped: string[]; unsupportedRequired: string[] } {
  const props = isObj(schema) && isObj(own(schema, 'properties')) ? (own(schema, 'properties') as Record<string, unknown>) : {};
  const reqList = isObj(schema) && Array.isArray(own(schema, 'required')) ? (own(schema, 'required') as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  const fields: ElicitField[] = [];
  const dropped: string[] = [];
  const unsupportedRequired: string[] = [];
  const names = Object.keys(props);
  for (const name of names) {
    const required = reqList.includes(name);
    const f = fields.length < MAX_ELICIT_FIELDS ? fieldOf(name, props[name], required) : undefined;
    if (f) fields.push(f);
    else (required ? unsupportedRequired : dropped).push(name.slice(0, 64));
  }
  // a required name with no property at all cannot be filled either
  for (const r of reqList) if (!names.includes(r)) unsupportedRequired.push(r.slice(0, 64));
  return { fields, dropped, unsupportedRequired };
}

/** URL mode: only an https address without user:password, at most 2048 characters. */
export function elicitHttpsUrl(u: unknown): { url: string; host: string } | undefined {
  if (typeof u !== 'string' || u.length > 2048) return undefined;
  try {
    const p = new URL(u);
    if (p.protocol !== 'https:' || !p.hostname || p.username || p.password) return undefined;
    return { url: p.href, host: p.hostname };
  } catch {
    return undefined;
  }
}

/** A vendor's request (message, schema or URL) to what the card shows, or why it must be declined. */
export function parseElicitRequest(input: { message?: unknown; schema?: unknown; mode?: unknown; url?: unknown; source?: unknown }): { ok: true; request: ElicitRequest; dropped: string[] } | { ok: false; reason: string } {
  const message = elicitText(input.message, 500) ?? 'An MCP server asks for input.';
  const source = elicitText(input.source, 80);
  const base = { message, ...(source ? { source } : {}) };
  if (input.mode === 'url' || (input.url !== undefined && input.schema === undefined)) {
    const u = elicitHttpsUrl(input.url);
    if (!u) return { ok: false, reason: 'Agent Durbar opens only https addresses for MCP sign-in or input pages.' };
    return { ok: true, request: { ...base, url: u.url, host: u.host }, dropped: [] };
  }
  const { fields, dropped, unsupportedRequired } = parseElicitSchema(input.schema);
  if (unsupportedRequired.length) return { ok: false, reason: `Agent Durbar cannot show the required field${unsupportedRequired.length > 1 ? 's' : ''} ${unsupportedRequired.join(', ')} (only text, number, yes/no and one-choice fields).` };
  return { ok: true, request: { ...base, fields }, dropped };
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{1,63}$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DATETIME_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?$/;

function formatOk(format: ElicitFormat, v: string): boolean {
  if (format === 'email') return EMAIL_RE.test(v);
  if (format === 'date') return DATE_RE.test(v);
  if (format === 'date-time') return DATETIME_RE.test(v) && !Number.isNaN(Date.parse(v));
  try {
    return !!new URL(v).protocol;
  } catch {
    return false;
  }
}

/**
 * Check the user's values against the fields (main does this before answering the adapter; the adapter does it again).
 * Unknown keys are dropped; an empty optional field is left out. Error messages name the field, never its value.
 */
export function validateElicitContent(fields: readonly ElicitField[], values: unknown): { ok: true; content: Record<string, ElicitValue> } | { ok: false; error: string; field?: string } {
  const vals = isObj(values) ? values : {};
  const content: Record<string, ElicitValue> = {};
  for (const f of fields) {
    let v = own(vals, f.name);
    if (typeof v === 'string' && f.type !== 'boolean') v = v.trim() === '' ? undefined : v;
    if (v === undefined || v === null) {
      if (f.required) return { ok: false, error: `Fill in "${f.title}".`, field: f.name };
      continue;
    }
    const bad = (why: string) => ({ ok: false as const, error: `"${f.title}" ${why}`, field: f.name });
    switch (f.type) {
      case 'boolean':
        if (typeof v !== 'boolean') return bad('must be yes or no.');
        break;
      case 'number':
      case 'integer': {
        const n = typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : v;
        if (typeof n !== 'number' || !Number.isFinite(n)) return bad('must be a number.');
        if (f.type === 'integer' && !Number.isInteger(n)) return bad('must be a whole number.');
        if (f.min !== undefined && n < f.min) return bad(`must be at least ${f.min}.`);
        if (f.max !== undefined && n > f.max) return bad(`must be at most ${f.max}.`);
        v = n;
        break;
      }
      case 'enum':
        if (typeof v !== 'string' || !(f.enumValues ?? []).includes(v)) return bad('must be one of the choices.');
        break;
      case 'string': {
        if (typeof v !== 'string') return bad('must be text.');
        if (v.length > Math.min(f.maxLength ?? MAX_ELICIT_TEXT, MAX_ELICIT_TEXT)) return bad(`must be at most ${Math.min(f.maxLength ?? MAX_ELICIT_TEXT, MAX_ELICIT_TEXT)} characters.`);
        if (f.minLength !== undefined && v.length < f.minLength) return bad(`must be at least ${f.minLength} characters.`);
        if (f.format && !formatOk(f.format, v.trim())) return bad(f.format === 'email' ? 'must be an email address.' : f.format === 'uri' ? 'must be a web address.' : f.format === 'date' ? 'must be a date (YYYY-MM-DD).' : 'must be a date and time.');
        break;
      }
    }
    content[f.name] = v as ElicitValue;
  }
  return { ok: true, content };
}

/**
 * Main's check of an answer for a pending request: the action, and for a submitted form the values. A URL flow answers
 * accept (Done) or cancel with no content.
 */
export function checkElicitAnswer(req: ElicitRequest, action: unknown, values: unknown): { ok: true; answer: ElicitAnswer } | { ok: false; error: string; field?: string } {
  if (action !== 'accept' && action !== 'decline' && action !== 'cancel') return { ok: false, error: 'unknown answer' };
  if (action !== 'accept' || req.url) return { ok: true, answer: { action } };
  const r = validateElicitContent(req.fields ?? [], values);
  return r.ok ? { ok: true, answer: { action, content: r.content } } : r;
}

/** Main's list of open elicitations, fed by the normalized events (asked adds, answered or cancelled removes). */
export function createElicitTracker(): { onEvent(e: { type: string; sessionId: string; phase?: string; requestId?: string; elicitation?: ElicitRequest }): void; get(sessionId: string, requestId: string): ElicitRequest | undefined } {
  const open = new Map<string, ElicitRequest>();
  const key = (s: string, r: string) => `${s}\n${r}`;
  return {
    onEvent(e) {
      if (e.type !== 'question' || typeof e.requestId !== 'string') return;
      if (e.phase === 'asked' && e.elicitation) {
        if (open.size > 200) open.delete(open.keys().next().value as string);
        open.set(key(e.sessionId, e.requestId), e.elicitation);
      } else if (e.phase === 'answered' || e.phase === 'cancelled') open.delete(key(e.sessionId, e.requestId));
    },
    get: (s, r) => open.get(key(s, r)),
  };
}
