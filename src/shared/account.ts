/**
 * Spec 051 FR-011..FR-015 (issue #617): the account an agent app reports as signed in, as one line for the window. Pure, no imports.
 * The name or email is personal data: it is shown in the window only, never logged, exported or sent anywhere (FR-015).
 */

/** How the app is signed in, when it says so. */
export type AccountMethod = 'account' | 'gh-cli' | 'token' | 'api-key' | 'provider';

/** An adapter's `accountInfo()` answer. `name` is a login or an email, exactly as the app reports it (cleaned by `cleanName`). */
export interface AccountIdentity {
  status: 'signed-in' | 'signed-out' | 'unknown';
  /** The login or email the app reports. */
  name?: string;
  /** Where the account lives: "GitHub", "Claude", "ChatGPT", or a provider such as "Amazon Bedrock". */
  service?: string;
  /** The plan, when the app reports one: "Claude Max", "ChatGPT Plus". */
  plan?: string;
  method?: AccountMethod;
  /** FR-021: who provides the account, as the card's "Provider" line: "GitHub", "Claude", "Anthropic", "OpenAI (ChatGPT)", "Amazon Bedrock". */
  provider?: string;
  /** FR-021: how the app signed in, as the card's "Signed in via" line: "GitHub CLI", "Claude login", "ChatGPT login", "API key". */
  via?: string;
}

/**
 * What the window gets per app (`harness:accounts`). `text` is the line with the name masked (FR-016: "Signed in as v•••@example.com ·
 * Claude Pro"); `masked` is that masked name as it appears in `text`, and `name` the clear name, kept only in the window's memory for
 * the Settings reveal. Tooltips and "About agent apps" use `text` only.
 */
export interface AccountView {
  status: AccountIdentity['status'];
  text: string;
  masked?: string;
  name?: string;
  /** FR-018: the plan the app reports ("Claude Max", "ChatGPT Plus", "Copilot Individual"); not personal data, never logged either. */
  plan?: string;
  /** FR-021: the card's "Provider" and "Signed in via" lines, only when the app reports them. */
  provider?: string;
  via?: string;
}

export const NAME_MAX = 80;
const WORD_MAX = 40;

/** One line of at most `max` characters with control and bidi characters removed; undefined when nothing is left or it is not a string. */
export function cleanName(v: unknown, max = NAME_MAX): string | undefined {
  if (typeof v !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** A plan word from the app ("max", "plus", "self_serve_business_prolite") as a label: "Max", "Plus", "Self serve business prolite". */
export function planWord(v: unknown): string | undefined {
  const s = cleanName(typeof v === 'string' ? v.replace(/[_-]+/g, ' ') : v, WORD_MAX);
  if (!s || /^(unknown|none|null)$/i.test(s)) return undefined;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * FR-016 (owner, 2026-10-23): a name as shown before the user reveals it. An email keeps its first character and its domain
 * ("v•••@example.com"); a login keeps its first character ("o•••"); one character or less is "•••". Characters, not UTF-16 units.
 */
export function maskName(name: string): string {
  const at = name.lastIndexOf('@');
  const local = at > 0 ? name.slice(0, at) : name;
  const chars = Array.from(local);
  const head = chars.length > 1 ? chars[0] : '';
  return head + '•••' + (at > 0 ? name.slice(at) : '');
}

const METHOD_TEXT: Record<AccountMethod, string> = {
  account: '',
  'gh-cli': 'through the GitHub CLI',
  token: 'with a token',
  'api-key': 'with an API key',
  provider: '',
};

/**
 * FR-012: the line to show.
 * - a name: "Signed in as <name> · <plan>" or "Signed in as <name> (<service>[, <how>])";
 * - an API key or token without a name: "Signed in with an OpenAI API key" (the service in front of "API key" when known);
 * - a provider without a name: "Signed in through Amazon Bedrock";
 * - signed in, nothing else: "Signed in; the app does not say which account";
 * - "Not signed in" / "Account unknown".
 */
export function accountLine(a: AccountIdentity | undefined | null, o: { mask?: boolean } = {}): string {
  if (!a || typeof a !== 'object') return 'Account unknown';
  if (a.status === 'signed-out') return 'Not signed in';
  if (a.status !== 'signed-in') return 'Account unknown';
  const clear = cleanName(a.name);
  const name = clear && o.mask ? maskName(clear) : clear;
  const service = cleanName(a.service, WORD_MAX);
  const plan = cleanName(a.plan, WORD_MAX);
  const how = a.method && Object.prototype.hasOwnProperty.call(METHOD_TEXT, a.method) ? METHOD_TEXT[a.method] : '';
  if (name) {
    if (plan) return `Signed in as ${name} · ${plan}`;
    const extra = [service, how].filter(Boolean).join(', ');
    return `Signed in as ${name}${extra ? ` (${extra})` : ''}`;
  }
  if (a.method === 'api-key') return `Signed in with ${service ? `an ${service} API key` : 'an API key'}`.replace(/^Signed in with an ([^AEIOU])/, 'Signed in with a $1');
  if (a.method === 'token') return `Signed in with a token${service ? ` (${service})` : ''}`;
  if (service && a.method === 'provider') return `Signed in through ${service}`;
  if (plan) return `Signed in · ${plan}`;
  return 'Signed in; the app does not say which account';
}

/** FR-014, FR-016: what main sends the window for one app: the masked line, plus the masked and clear name when there is one. */
export function accountView(a: AccountIdentity | undefined | null): AccountView {
  const status = a && (a.status === 'signed-in' || a.status === 'signed-out') ? a.status : 'unknown';
  const view: AccountView = { status, text: accountLine(a, { mask: true }) };
  const name = status === 'signed-in' && a ? cleanName(a.name) : undefined;
  if (name) {
    view.masked = maskName(name);
    view.name = name;
  }
  const plan = status === 'signed-in' && a ? cleanName(a.plan, WORD_MAX) : undefined;
  if (plan) view.plan = plan;
  if (status === 'signed-in' && a) {
    const provider = cleanName(a.provider, WORD_MAX);
    const via = cleanName(a.via, WORD_MAX);
    if (provider) view.provider = provider;
    if (via) view.via = via;
  }
  return view;
}
