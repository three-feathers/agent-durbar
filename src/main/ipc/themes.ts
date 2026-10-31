/** IPC for themes: the themes you saved, export by folder pick and remove (spec 040 FR-032; the AI theme maker and Import were retired, FR-031; moved out of main.ts, spec 045 FR-060). */
import { app, dialog } from 'electron';
import * as path from 'path';
import { ipcHandle } from '../ipcguard';
import type { DevEnv } from '../devhooks';
import { UserThemeStore } from '../themes';
import { RESERVED_THEME_IDS } from '../../shared/themes';

export interface ThemesIpcDeps {
  dev: DevEnv;
}

export function register(deps: ThemesIpcDeps): void {
  const { dev } = deps;
  /* User themes (spec 040): `userData/themes/<id>/manifest.json`, export by folder pick, remove. Dev hook DURBAR_PICK answers the dialog in checks. */
  const userThemes = new UserThemeStore(path.join(app.getPath('userData'), 'themes'));
  // spec 077 FR-066: 'cheeky-crew' is no longer a theme but stays reserved, so no imported or AI pack can take the old id (FR-067 migrates it)
  // spec 035 FR-017: 'corporate' and the three 'durbar-*' ids were removed built-ins and stay reserved too (FR-018 migrates a stored one)
  const BUILT_IN_THEME_IDS = RESERVED_THEME_IDS;
  const pickFolder = async (title: string, create = false): Promise<string | null> => {
    if (dev.DURBAR_PICK) { const first = dev.DURBAR_PICK.split(path.delimiter)[0]; return first || null; } // path.delimiter keeps C:\ paths whole (spec 040 FR-008)
    // spec 040 FR-019: an export target may be a new folder (macOS shows "New Folder" only with createDirectory)
    const r = await dialog.showOpenDialog({ title, properties: create ? ['openDirectory', 'createDirectory'] : ['openDirectory'] });
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
  };
  ipcHandle('theme:listUser', () => userThemes.list().map((t) => ({ id: t.id, name: t.name, ok: t.ok, error: t.error })));
  ipcHandle('theme:getUser', (_e, id: unknown) => (typeof id === 'string' ? userThemes.get(id) : null));
  ipcHandle('theme:export', async (_e, id: unknown) => {
    if (typeof id !== 'string' || BUILT_IN_THEME_IDS.includes(id)) return { ok: false, error: 'Only your own imported themes can be exported.' };
    const dir = await pickFolder('Export the theme folder to…', true);
    if (!dir) return { ok: false, cancelled: true };
    return userThemes.exportFolder(id, dir);
  });
  // spec 040 FR-032, T039: remove one of your saved themes (the window asked first); the theme in use goes to Clean Office there
  ipcHandle('theme:remove', (_e, id: unknown) => {
    if (typeof id !== 'string' || BUILT_IN_THEME_IDS.includes(id)) return { ok: false, error: 'Only the themes you saved can be removed.' };
    return userThemes.remove(id);
  });
}
