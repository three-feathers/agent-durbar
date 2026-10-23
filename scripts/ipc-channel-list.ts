/**
 * The channels the preload calls, read once from `src/preload/preload.ts` (spec 010 FR-029). Shared by `test:ipcchannels` and
 * `test:simguard`, so both check the same list. No Electron.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
/** Block and line comments out (a line comment starts at the beginning of a line or after a space, so `https://` in a string stays). */
export const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

export interface PreloadChannels { invoked: string[]; sent: string[]; all: Set<string> }
export function preloadChannels(): PreloadChannels {
  const src = stripComments(fs.readFileSync(path.join(ROOT, 'src', 'preload', 'preload.ts'), 'utf8').replace(/\r\n/g, '\n'));
  const list = (re: RegExp): string[] => [...new Set([...src.matchAll(re)].map((m) => m[1]))].sort();
  const invoked = list(/ipcRenderer\.invoke\(\s*'([^']+)'/g);
  const sent = list(/ipcRenderer\.send\(\s*'([^']+)'/g);
  return { invoked, sent, all: new Set([...invoked, ...sent]) };
}
