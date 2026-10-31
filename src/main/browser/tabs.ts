/**
 * Spec 080 T020 (FR-120, FR-124, FR-126, FR-129, FR-130): the pure part of the session browser's page tabs. No Electron.
 * - tab ids are minted here only (`t` + 8 hex), by main; the window never makes one, and `validTabId` accepts nothing else;
 * - the reuse rule of FR-124 (a link a `user` tab already has focuses that tab);
 * - where a new tab goes, which tab is active after a close, the 10-tab limit and the 5-tabs-per-page-load limit;
 * - the tab shortcuts (FR-130), matched the same way in main (the view's `before-input-event`) and in the window (browserpane.js; a test
 *   checks both agree).
 * Tested by `scripts/test-browsertabs.ts` (`npm run test:browsertabs`).
 */
import { randomBytes } from 'crypto';
import { MAX_TABS_PER_SESSION } from './viewcap';

export { MAX_TABS_PER_SESSION };
/** FR-120: the only tab id shape. */
export const TAB_ID_RE = /^t[0-9a-f]{8}$/;
/** FR-125: at most this many tabs per page load of one opener tab. */
export const MAX_TABS_PER_LOAD = 5;
/** FR-126 (US6 scenario 5): the bar's words at the limit. Static text, never page text. */
export const TAB_LIMIT_TEXT = `This browser has ${MAX_TABS_PER_SESSION} tabs, the most it can hold. Close one to open another.`;

export type TabKind = 'user' | 'agent';

export function validTabId(x: unknown): x is string {
  return typeof x === 'string' && TAB_ID_RE.test(x);
}

/** A fresh tab id, unique among `used` (the session's tabs). */
export function newTabId(used: { has(id: string): boolean }, randomHex: () => string = () => randomBytes(4).toString('hex')): string {
  for (let i = 0; i < 16; i++) {
    const id = 't' + randomHex();
    if (validTabId(id) && !used.has(id)) return id;
  }
  throw new Error('could not make a fresh tab id');
}

/** FR-124: the address as the reuse rule compares it: WHATWG `href` without the fragment. Unparsable or empty: undefined (never matches). */
export function reuseKey(url: unknown): string | undefined {
  if (typeof url !== 'string' || !url || url === 'about:blank') return undefined;
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href;
  } catch {
    return undefined;
  }
}

export interface TabFacts {
  tabId: string;
  kind: TabKind;
  /** The committed address, the address main asked it to load (`pendingUrl`), and the address kept when the cap dropped the page. */
  urls: readonly (string | undefined)[];
  lastShownAt: number;
}
/** FR-124: the `user` tab that already has this link (the most recently shown one if several), or undefined. The agent's tab never matches. */
export function findReuse(tabs: readonly TabFacts[], url: unknown): string | undefined {
  const key = reuseKey(url);
  if (!key) return undefined;
  let best: TabFacts | undefined;
  for (const t of tabs) {
    if (t.kind !== 'user') continue;
    if (!t.urls.some((u) => reuseKey(u) === key)) continue;
    if (!best || t.lastShownAt > best.lastShownAt) best = t;
  }
  return best?.tabId;
}

/** FR-126: one more tab fits. */
export const canAddTab = (count: number): boolean => count < MAX_TABS_PER_SESSION;

/** FR-124, FR-125: a new tab goes to the right of `after` (the active tab or the opener); at the end when `after` is not in the list. */
export function insertAfter(order: readonly string[], after: string | undefined, id: string): string[] {
  const i = after === undefined ? -1 : order.indexOf(after);
  const out = order.slice();
  out.splice(i < 0 ? out.length : i + 1, 0, id);
  return out;
}

/** FR-129: the tab that becomes active when `closed` goes: the one to its right, else to its left; undefined when it was the last. */
export function nextActive(order: readonly string[], closed: string): string | undefined {
  const i = order.indexOf(closed);
  if (i < 0) return order[0];
  return order[i + 1] ?? order[i - 1];
}

/** The tab `step` places from `from`, wrapping (Ctrl+Tab, Ctrl+Shift+Tab). */
export function cycle(order: readonly string[], from: string, step: 1 | -1): string | undefined {
  if (!order.length) return undefined;
  const i = order.indexOf(from);
  return order[((i < 0 ? 0 : i) + step + order.length) % order.length];
}

export type TabShortcut = 'new' | 'close' | 'next' | 'prev';
/** A key press, as Electron's `before-input-event` input (`control`, `meta`) or a DOM KeyboardEvent (`ctrlKey`, `metaKey`) gives it. */
export interface KeyLike {
  type?: string;
  key?: string;
  code?: string;
  control?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}
/**
 * FR-130: Ctrl+T / Cmd+T new tab, Ctrl+W / Cmd+W close, Ctrl+Tab and Ctrl+PageDown next, Ctrl+Shift+Tab and Ctrl+PageUp previous (Ctrl on
 * every OS for these). The letter is the one the key types (Chrome's rule), its position only when the layout types no Latin letter.
 * Anything else, including a key-up, is null. Kept identical to `tabShortcut` in src/renderer/browserpane.js (test:browsertabs).
 */
export function tabShortcut(e: KeyLike | null | undefined, mac: boolean): TabShortcut | null {
  if (!e) return null;
  if (e.type !== undefined && e.type !== 'keyDown' && e.type !== 'keydown') return null;
  const ctrl = !!(e.control ?? e.ctrlKey), meta = !!(e.meta ?? e.metaKey), shift = !!(e.shift ?? e.shiftKey), alt = !!(e.alt ?? e.altKey);
  if (alt) return null;
  const key = typeof e.key === 'string' ? e.key : '';
  const code = typeof e.code === 'string' ? e.code : '';
  if (ctrl && !meta && (key === 'Tab' || code === 'Tab')) return shift ? 'prev' : 'next';
  if (ctrl && !meta && !shift && (key === 'PageDown' || code === 'PageDown')) return 'next';
  if (ctrl && !meta && !shift && (key === 'PageUp' || code === 'PageUp')) return 'prev';
  const mod = mac ? meta && !ctrl : ctrl && !meta;
  if (!mod || shift) return null;
  const letter = /^[a-z]$/i.test(key) ? key.toLowerCase() : code === 'KeyT' ? 't' : code === 'KeyW' ? 'w' : '';
  return letter === 't' ? 'new' : letter === 'w' ? 'close' : null;
}

/** What the toggle needs of the settings store (`SettingsStore`). */
export interface LinksToggleStore {
  readonly chatLinksNewTab: boolean;
  setChatLinksNewTab(on: unknown): unknown;
}
/**
 * FR-123: the app-wide *Open chat links in a new tab* toggle, read in main only. Off by default. The simulator keeps it in memory and writes
 * no user settings; the app reads and writes the settings store.
 */
export function makeLinksToggle(simulator: boolean, store: () => LinksToggleStore | undefined): { get(): boolean; set(on: boolean): void } {
  let simOn = false;
  return {
    get: () => (simulator ? simOn : store()?.chatLinksNewTab === true),
    set: (on) => {
      if (simulator) simOn = on;
      else store()?.setChatLinksNewTab(on);
    },
  };
}
