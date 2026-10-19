/**
 * Window hardening (spec 045 FR-004, FR-005): pure checks, wired in main.ts.
 * - The window may only ever show the app's own page (any query or hash): no other `file://` page, no web page.
 * - Web permissions the page asks for are refused, except writing text to the clipboard (the Copy buttons, spec 005 FR-015) and
 *   notifications (spec 052 FR-059: "<name> needs you" with a short summary while the window is in the background; never file contents).
 */
import * as path from 'path';
import { fileURLToPath } from 'url';

export function navigationAllowed(url: string, indexFile: string, platform: NodeJS.Platform = process.platform): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'file:') return false;
    const flavor = platform === 'win32' ? path.win32 : path.posix;
    const norm = (p: string): string => (platform === 'win32' ? flavor.resolve(p).toLowerCase() : flavor.resolve(p));
    return norm(fileURLToPath(u, { windows: platform === 'win32' })) === norm(indexFile);
  } catch {
    return false;
  }
}

export const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write', 'notifications']);

export function permissionAllowed(permission: string): boolean {
  return ALLOWED_PERMISSIONS.has(permission);
}

/**
 * Spec 051 FR-004b: a privileged IPC call (installs, sign-in) is answered only for the app's own page in the window's main frame,
 * never for another frame or a page the window was somehow moved to.
 */
export function senderAllowed(frame: { url: string; isMain: boolean } | null | undefined, indexFile: string, platform: NodeJS.Platform = process.platform): boolean {
  return !!frame && frame.isMain && navigationAllowed(frame.url, indexFile, platform);
}
