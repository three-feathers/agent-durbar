/**
 * The application menu and Mac window conventions (spec 052 FR-083, FR-085). Pure: no Electron import (types only), so it is
 * unit-tested on any OS; main.ts passes the platform and the two actions.
 *
 * - macOS: a menu built from Electron's roles (app menu with About, Settings… ⌘, Hide and Quit; File with Add Folder… ⌘O, Add VS
 *   Code Workspace… ⇧⌘O and Close Window ⌘W (spec 052 FR-162); Edit; View with full screen and zoom only, no Reload and no
 *   DevTools; Window; Help with a link to the project). Quit stays in the app menu, where a Mac app has it.
 * - Windows and Linux: no menu at all (null), so the default menu with Reload and Toggle Developer Tools is gone. Copy, cut and
 *   paste in text fields are Chromium's own keys and keep working. Ctrl+O and Ctrl+Shift+O are handled in the page instead
 *   (FR-162), and the window's own close button and Alt+F4 close it.
 */
import type { MenuItemConstructorOptions } from 'electron';

export interface MenuActions {
  openSettings(): void;
  openRepo(): void;
  /** FR-162: File > Add Folder… / Add VS Code Workspace…; main.ts forwards it to the page, which presses the same top-bar button. */
  add(kind: 'folder' | 'workspace'): void;
}

export const SETTINGS_ACCELERATOR = 'CommandOrControl+,';
/** Spec 052 FR-162: the File menu keys; the page uses the same ones on Windows and Linux. Unused elsewhere in the app (checked against FR-035, FR-042, FR-083, FR-091). */
export const ADD_FOLDER_ACCELERATOR = 'CommandOrControl+O';
export const ADD_WORKSPACE_ACCELERATOR = 'CommandOrControl+Shift+O';
export const ADD_FOLDER_LABEL = 'Add Folder…';
export const ADD_WORKSPACE_LABEL = 'Add VS Code Workspace…';
/** Display name in the Mac app menu (spec 008 FR-033). Display only; never pass to app.setName (Keychain, libsecret). Equals `build.productName` (test:profiledir); the run-time identity `app.getName()` stays `agent-durbar` on purpose. */
export const MENU_APP_NAME = 'Agent Durbar';
export const HELP_LINK_LABEL = 'Agent Durbar on GitHub';

export function appMenuTemplate(platform: NodeJS.Platform, actions: MenuActions): MenuItemConstructorOptions[] | null {
  if (platform !== 'darwin') return null;
  return [
    {
      role: 'appMenu',
      label: MENU_APP_NAME, // spec 008 FR-044: harmless hint; Electron documents that macOS shows the bundle name here whatever the label (the packaged CFBundleName is checked by check-names.js)
      submenu: [
        { role: 'about', label: `About ${MENU_APP_NAME}` },
        { type: 'separator' },
        { label: 'Settings…', accelerator: SETTINGS_ACCELERATOR, click: () => actions.openSettings() },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: `Hide ${MENU_APP_NAME}` },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: `Quit ${MENU_APP_NAME}` },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: ADD_FOLDER_LABEL, accelerator: ADD_FOLDER_ACCELERATOR, click: () => actions.add('folder') },
        { label: ADD_WORKSPACE_LABEL, accelerator: ADD_WORKSPACE_ACCELERATOR, click: () => actions.add('workspace') },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
    },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: HELP_LINK_LABEL, click: () => actions.openRepo() }] },
  ];
}

/** macOS: closing the window hides it and the agents keep running, unless the app is quitting (⌘Q, Dock > Quit). */
export function hideOnClose(platform: NodeJS.Platform, quitting: boolean): boolean {
  return platform === 'darwin' && !quitting;
}

/** macOS: window-all-closed does not fire on ⌘Q, so the agents are ended in before-quit instead. */
export function disposeOnQuit(platform: NodeJS.Platform): boolean {
  return platform === 'darwin';
}

/** The window options that differ per platform: the Mac title bar is hidden and the traffic lights sit inset in the top bar. */
export function windowChrome(platform: NodeJS.Platform): { titleBarStyle?: 'hiddenInset' } {
  return platform === 'darwin' ? { titleBarStyle: 'hiddenInset' } : {};
}
