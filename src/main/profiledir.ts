/**
 * App name and profile folder (spec 008 FR-033, FR-034). Pure: no Electron import, so it is unit-tested.
 * The folder is chosen here, never derived from the app name: installed users keep `<appData>/agent-durbar`,
 * a dev run (`npm start`, the simulator) uses `<appData>/agent-durbar-dev` so it never touches the installed app's data.
 */
import * as path from 'path';
import { devEnv } from './devhooks';

/** The run-time name on every platform; equals `build.productName` and the About panel's application name. */
export const APP_NAME = 'Agent Durbar';

export interface ProfileDirInput {
  packaged: boolean;
  platform: NodeJS.Platform | string;
  /** `app.getPath('appData')` */
  appData: string;
  env: NodeJS.ProcessEnv;
}

/** `DURBAR_USER_DATA` (dev hooks on) > packaged `<appData>/agent-durbar` > dev `<appData>/agent-durbar-dev`. */
export function profileDir({ packaged, platform, appData, env }: ProfileDirInput): string {
  const override = devEnv(env, packaged).DURBAR_USER_DATA;
  if (override) return override;
  const p = platform === 'win32' ? path.win32 : path.posix;
  return p.join(appData, packaged ? 'agent-durbar' : 'agent-durbar-dev');
}
