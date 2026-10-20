/**
 * Remote control of a session (spec 054 FR-001, FR-005). Plain data and pure checks: no SDK, no I/O.
 * Any adapter with `capabilities.remote` answers `setRemote` with a `RemoteState`; the renderer sees only this shape.
 */

/** Who can see a session exported to GitHub: `repo` = anyone who can read the repository; `unshared` = the creator and collaborators. */
export type RemoteVisibility = 'repo' | 'unshared';

export interface RemoteState {
  ok: boolean;
  /** The user said no in the main process's confirmation (spec 054 FR-011): not an error to show. */
  cancelled?: boolean;
  /** Remote control is on after the call (absent when the call failed). */
  on?: boolean;
  /** Link to the session on GitHub; only ever an allowed URL (`allowedRemoteUrl`). */
  url?: string;
  /** The session can be steered from GitHub, not only followed. */
  steerable?: boolean;
  visibility?: RemoteVisibility;
  /** Plain, one-line reason when `ok` is false. */
  error?: string;
}

/** FR-005, FR-060: the only links remote control may show or open: https on the service's own host (default github.com), no user info, no port, at most 2048 characters. */
export function allowedRemoteUrl(url: unknown, host = 'github.com'): url is string {
  if (typeof url !== 'string' || !url || url.length > 2048) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && !u.username && !u.password && !u.port && u.hostname.toLowerCase() === host.toLowerCase();
}

/** FR-002: an error as one plain line of at most 300 characters (control characters removed). */
export function cleanRemoteError(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  // eslint-disable-next-line no-control-regex
  const t = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return 'Remote control failed.';
  return t.length > 300 ? t.slice(0, 299) + '…' : t;
}

export const isRemoteVisibility = (v: unknown): v is RemoteVisibility => v === 'repo' || v === 'unshared';
