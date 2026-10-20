/**
 * Which name a session shows, and how a rename reaches the agent app (spec 059 FR-001, FR-007, FR-008, FR-011).
 * Pure: no Electron, no fs, no agent specifics (the renderer and main both use it).
 */

export interface SessionNameEntry {
  /** Adapter id (the `adapterId` rule). */
  src: string;
  /** The runtime's session id. */
  id: string;
  name: string;
  /** The agent app accepted the same name (FR-007). */
  inApp?: true;
  /** `'next-turn'` adapters (Claude): the name waits for the next launch that carries it (FR-011). */
  pending?: true;
}

/** The capability value of `renameSession` (src/adapters/capabilities.ts); missing = none. */
export type RenameCap = 'any' | 'next-turn' | undefined;

/** FR-001: the user's name, else the runtime's title, else the folder label. */
export function displayNameOf(entry: Pick<SessionNameEntry, 'name'> | undefined, runtimeTitle: string | undefined, folderLabel: string): string {
  return entry?.name || runtimeTitle?.trim() || folderLabel;
}

/**
 * FR-011: what a runtime title that arrives later does to the user's entry. Durbar-only entries win; a `pending` entry becomes
 * `inApp` when the title equals its name; an `inApp` entry whose app name now differs was renamed elsewhere and is dropped
 * (`undefined`); equal names change nothing. No title: nothing changes. Never changes its input.
 */
export function syncEntry(entry: SessionNameEntry | undefined, runtimeTitle: string | undefined): SessionNameEntry | undefined {
  if (!entry) return undefined;
  const title = runtimeTitle?.trim();
  if (!title) return entry;
  if (entry.pending) {
    if (title !== entry.name) return entry;
    const { pending: _p, ...rest } = entry;
    void _p;
    return { ...rest, inApp: true };
  }
  if (entry.inApp) return title === entry.name ? entry : undefined;
  return entry;
}

/** FR-007: where a rename goes for a capability: the app now, the app at its next launch, or Durbar only. */
export function renameTarget(cap: RenameCap): 'now' | 'next-turn' | 'durbar' {
  return cap === 'any' ? 'now' : cap === 'next-turn' ? 'next-turn' : 'durbar';
}
