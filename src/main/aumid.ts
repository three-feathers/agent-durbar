/** Windows AppUserModelId at run time (spec 008 FR-043, D1). Pure: no Electron import, so it is unit-tested on any OS. */

/** Equals `build.appId` in package.json (the NSIS shortcuts get the same AUMID); `npm run test:checknames` compares them. */
export const APP_USER_MODEL_ID = 'io.github.three-feathers.agentdurbar';

/** The AUMID to pass to `app.setAppUserModelId`, or null: only a packaged Windows build sets it, so a dev run never groups or posts toasts as the installed app. */
export function aumidToSet(platform: NodeJS.Platform, packaged: boolean): string | null {
  return platform === 'win32' && packaged ? APP_USER_MODEL_ID : null;
}
