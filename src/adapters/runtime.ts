import * as fs from 'fs';
import * as path from 'path';

/**
 * Where the SDK's bundled Copilot runtime executable lives in a packaged (asar) app.
 *
 * The SDK finds `@github/copilot-sdk-<platform>/prebuilds/<platform>/copilot-runtime[.exe]` by walking
 * node_modules, which inside `app.asar` is a virtual path that cannot be executed. electron-builder
 * unpacks those packages (asarUnpack) to `app.asar.unpacked`, and we hand that real path to the SDK.
 * In development (not inside an asar) this returns undefined and the SDK does its own lookup.
 */
export function unpackedRuntimePath(
  dir: string = __dirname,
  resourcesPath: string | undefined = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | undefined {
  if (!dir.includes('app.asar') || !resourcesPath) return undefined;
  const plat = `${platform}-${arch}`;
  const exe = platform === 'win32' ? 'copilot-runtime.exe' : 'copilot-runtime';
  const p = path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', '@github', `copilot-sdk-${plat}`, 'prebuilds', plat, exe);
  return fs.existsSync(p) ? p : undefined;
}
