/** IPC for themes: your own imported themes, import / export by folder pick, the AI theme maker (spec 040; moved out of main.ts as it was, spec 045 FR-060). */
import { app, dialog } from 'electron';
import * as path from 'path';
import { ipcHandle } from '../ipcguard';
import type { AdapterRegistry } from '../../adapters/registry';
import type { AdapterRouter } from '../../adapters/router';
import { MAX_DESCRIPTION, MAX_PASSES, THEME_IDEAS, TOP_BAR_ISSUE, buildFixPrompt, buildRetryPrompt, buildThemePrompt, isBlocking, keepArt, parseGeneratedTheme } from '../../shared/themegen';
import { errText } from '../agentops';
import type { DevEnv } from '../devhooks';
import { copilotDir, copilotServerNames } from '../mcpfiles';
import { UserThemeStore } from '../themes';

export interface ThemesIpcDeps {
  dev: DevEnv;
  registry: AdapterRegistry;
  router: AdapterRouter;
}

export function register(deps: ThemesIpcDeps): void {
  const { dev, registry, router } = deps;
  /* User themes (spec 040): `userData/themes/<id>/manifest.json`, import/export by folder pick. Dev hook DURBAR_PICK answers the dialog in checks. */
  const userThemes = new UserThemeStore(path.join(app.getPath('userData'), 'themes'));
  // spec 077 FR-066: 'cheeky-crew' is no longer a theme but stays reserved, so no imported or AI pack can take the old id (FR-067 migrates it)
  const BUILT_IN_THEME_IDS = ['clean-office', 'corporate', 'retro', 'durbar-indian', 'durbar-european', 'durbar-japanese', 'cheeky-crew'];
  const pickFolder = async (title: string, create = false): Promise<string | null> => {
    if (dev.DURBAR_PICK) { const first = dev.DURBAR_PICK.split(path.delimiter)[0]; return first || null; } // path.delimiter keeps C:\ paths whole (spec 040 FR-008)
    // spec 040 FR-019: an export target may be a new folder (macOS shows "New Folder" only with createDirectory)
    const r = await dialog.showOpenDialog({ title, properties: create ? ['openDirectory', 'createDirectory'] : ['openDirectory'] });
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
  };
  /* Spec 040 FR-014..FR-021: the AI theme maker. One prompt to a harness that has `generateText` (no tools, no session kept); the
     reply keeps only the safe subset and must pass the contrast rules and `checkUserManifest`. The description is never logged. */
  ipcHandle('theme:generate', async (_e, description: unknown, adapterId: unknown) => {
    const d = typeof description === 'string' ? description.trim().slice(0, MAX_DESCRIPTION) : '';
    if (d.length < 3) return { ok: false, error: 'Describe the look in a few words.' };
    const kind = typeof adapterId === 'string' && registry.has(adapterId) ? adapterId : undefined;
    const ad = kind ? router.instance(kind) : undefined;
    if (!ad || typeof ad.generateText !== 'function') return { ok: false, error: 'That agent app cannot make a theme. Pick Claude Code, Codex or Copilot.' };
    // the renderer's own theme module: Clean Office's tokens and the art sanitizer, so the result is exactly what the app draws
    const T = require(path.join(__dirname, '..', '..', 'renderer', 'theme.js')) as { _tokens(): Record<string, string>; _sanitizeSlot(s: string): string | null };
    // main never sets a theme on this module, so `_tokens()` is Clean Office's full set
    const ctx = { clean: T._tokens(), sanitizeArt: (s: string) => T._sanitizeSlot(s), taken: (id: string) => BUILT_IN_THEME_IDS.includes(id) || userThemes.list().some((t) => t.id === id) };
    let cost = 0;
    let nano = 0;
    // Copilot loads the servers of ~/.copilot/mcp-config.json and its built-in one by itself: all of them are switched off by name (FR-015)
    const genOpts = kind === 'copilot' ? { disabledMcpServers: copilotServerNames(copilotDir(dev)) } : {};
    const ask = async (prompt: string): Promise<string> => {
      const r = await ad.generateText!(prompt, genOpts);
      if (r.costUsd) cost += r.costUsd;
      if (r.nanoAiu) nano += r.nanoAiu;
      return r.text;
    };
    try {
      // spec 040 FR-020: up to three passes; Durbar checks, the model fixes what failed
      let g = parseGeneratedTheme(await ask(buildThemePrompt(d, ctx.clean)), d, ctx);
      let passes = 1;
      // a reply that could not be used at all gets the request again (it counts as a pass)
      while (!g.ok && passes < MAX_PASSES) {
        g = parseGeneratedTheme(await ask(buildRetryPrompt(d, ctx.clean, g.error)), d, ctx);
        passes++;
      }
      while (g.ok && g.issues.length && passes < MAX_PASSES) {
        const next = parseGeneratedTheme(await ask(buildFixPrompt(g.raw, g.issues)), d, ctx);
        passes++;
        if (next.ok && next.issues.length <= g.issues.length) g = keepArt(next, g); // keep the better one, with the earlier art; a broken fix keeps the last good theme
      }
      const costPart = { ...(cost ? { costUsd: cost } : {}), ...(nano ? { nanoAiu: nano } : {}) };
      if (!g.ok) return { ok: false, error: g.error, ...costPart };
      // a top bar that is still unreadable after the passes: the Clean style, whose top bar follows --surface and --ink (FR-020)
      if (g.issues.some((i) => i.startsWith(TOP_BAR_ISSUE))) {
        g = { ...g, manifest: { ...g.manifest, ui: 'clean' }, issues: g.issues.filter((i) => !i.startsWith(TOP_BAR_ISSUE)), warnings: [...g.warnings, 'the UI style was changed to clean so the top bar stays readable'] };
      }
      const blocking = g.issues.filter(isBlocking);
      if (blocking.length) return { ok: false, error: `Text would still be hard to read after ${passes} passes: ${blocking[0]}. Try again or change the description.`, ...costPart };
      return { ok: true, manifest: g.manifest, warnings: [...g.warnings, ...g.issues], passes, ...costPart };
    } catch (err) {
      return { ok: false, error: errText(err), ...(cost ? { costUsd: cost } : {}), ...(nano ? { nanoAiu: nano } : {}) };
    }
  });
  ipcHandle('theme:ideas', () => THEME_IDEAS.slice());
  ipcHandle('theme:saveGenerated', (_e, manifest: unknown) => {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return { ok: false, error: 'invalid theme' };
    return userThemes.saveManifest(manifest as Record<string, unknown>, (id) => BUILT_IN_THEME_IDS.includes(id));
  });
  ipcHandle('theme:listUser', () => userThemes.list().map((t) => ({ id: t.id, name: t.name, ok: t.ok, error: t.error })));
  ipcHandle('theme:getUser', (_e, id: unknown) => (typeof id === 'string' ? userThemes.get(id) : null));
  ipcHandle('theme:import', async () => {
    const dir = await pickFolder('Import a theme folder (with manifest.json)');
    if (!dir) return { ok: false, cancelled: true };
    return userThemes.importFolder(dir, (id) => BUILT_IN_THEME_IDS.includes(id));
  });
  ipcHandle('theme:export', async (_e, id: unknown) => {
    if (typeof id !== 'string' || BUILT_IN_THEME_IDS.includes(id)) return { ok: false, error: 'Only your own imported themes can be exported.' };
    const dir = await pickFolder('Export the theme folder to…', true);
    if (!dir) return { ok: false, cancelled: true };
    return userThemes.exportFolder(id, dir);
  });
}
