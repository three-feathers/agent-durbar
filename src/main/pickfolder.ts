/** The folder picker of import and export (spec 040 FR-008, FR-019; spec 096 FR-031), with the dev hook DURBAR_PICK that answers it in checks. */
import { dialog } from 'electron';
import * as path from 'path';
import type { DevEnv } from './devhooks';

export async function pickFolder(dev: DevEnv, title: string, create = false): Promise<string | null> {
  if (dev.DURBAR_PICK) { const first = dev.DURBAR_PICK.split(path.delimiter)[0]; return first || null; } // path.delimiter keeps C:\ paths whole (spec 040 FR-008)
  // spec 040 FR-019: an export target may be a new folder (macOS shows "New Folder" only with createDirectory)
  const r = await dialog.showOpenDialog({ title, properties: create ? ['openDirectory', 'createDirectory'] : ['openDirectory'] });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
}
