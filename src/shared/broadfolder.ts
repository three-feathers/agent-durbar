/**
 * Is a folder the user adds broader than a project (spec 006 FR-016, issue #170)? The home folder, a parent of it, or a
 * filesystem or drive root puts SSH keys and saved credentials "inside the session's folders" for every adapter.
 * Pure: the home folder, the path flavour and the platform are injected, so Windows paths are tested from any OS.
 */
import * as path from 'path';

export type BroadKind = 'home' | 'home-parent' | 'root';

type Flavor = Pick<typeof path, 'resolve' | 'parse' | 'sep'>;

/** Windows and macOS compare paths without case (constitution VI); Linux with case. */
const caseless = (platform: NodeJS.Platform): boolean => platform === 'win32' || platform === 'darwin';

function norm(p: string, flavor: Flavor, platform: NodeJS.Platform): string {
  let r = flavor.resolve(p);
  const root = flavor.parse(r).root;
  if (r.length > root.length) r = r.replace(/[\\/]+$/, ''); // no trailing separator, except on a root itself
  return caseless(platform) ? r.toLowerCase() : r;
}

export function broadFolderKind(folder: string, home: string, flavor: Flavor = path, platform: NodeJS.Platform = process.platform): BroadKind | undefined {
  if (!folder) return undefined;
  const f = norm(folder, flavor, platform);
  const root = norm(flavor.parse(flavor.resolve(folder)).root, flavor, platform);
  if (f === root) return 'root';
  if (!home) return undefined;
  const h = norm(home, flavor, platform);
  if (f === h) return 'home';
  return h.startsWith(f.endsWith(flavor.sep) ? f : f + flavor.sep) ? 'home-parent' : undefined;
}
