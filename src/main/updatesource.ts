/**
 * Spec 118 FR-001 (T007): the update source of this build, from `updatesource.json` beside this file (dist/main, inside the asar), written
 * by scripts/copy-assets.js at build time. The ONLY run-time input: DURBAR_UPDATE_REPO, GITHUB_REPOSITORY and package.json are never
 * read here. A missing, unreadable or invalid file means no source, so no check (T010 is the caller).
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseUpdateSourceFile, MAX_UPDATE_SOURCE_BYTES } from '../shared/selfupdate';
import type { UpdateSource } from '../shared/selfupdate';

export const UPDATE_SOURCE_FILE = 'updatesource.json';

export function loadUpdateSource(dir: string = __dirname, read: (file: string) => Buffer = (f) => fs.readFileSync(f)): UpdateSource | undefined {
  let bytes: Buffer;
  try { bytes = read(path.join(dir, UPDATE_SOURCE_FILE)); } catch { return undefined; }
  if (bytes.length > MAX_UPDATE_SOURCE_BYTES) return undefined;
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return undefined; }
  return parseUpdateSourceFile(text);
}
