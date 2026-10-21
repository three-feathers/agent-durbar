/**
 * spec 012 T044: run inside the PACKAGED main process (no SDK, no claude, no credits):
 *   npm run pack:dir && DURBAR_DEV=1 DURBAR_CLAUDE_TRANSPORT=sdk DURBAR_DRIVER=$PWD/scripts/pack-esm-check.js \
 *     release/linux-unpacked/agent-durbar --no-sandbox   (xvfb-run -a on a Linux box without a display)
 * Prints one line; every field must be true / 'undefined' / 'cli', and `registered` lists 'claude' and 'codex'.
 * With PACK_ESM_OUT=<file> it also writes the result there as JSON (CI: `scripts/pack-esm-ci.js` reads it on every OS).
 */
// (from app.asar): the ESM import path, the SDK fallback, the experimental registration.
const path = require('path');
module.exports = async (ctx) => {
  const base = path.join(process.resourcesPath, 'app.asar', 'dist', 'adapters');
  const out = { packaged: require('electron').app.isPackaged, resources: path.basename(process.resourcesPath) };
  const esmImport = new Function('s', 'return import(s)');
  try { const m = await esmImport('node:path'); out.esmBuiltin = typeof m.join === 'function'; } catch (e) { out.esmBuiltin = 'ERR ' + e.message; }
  try { const m = await esmImport('file://' + path.join(base, 'claudeSdk.js')); out.esmFromAsar = typeof (m.default || m).loadSdk === 'function'; } catch (e) { out.esmFromAsar = 'ERR ' + e.message.slice(0, 120); }
  const sdk = require(path.join(base, 'claudeSdk.js'));
  out.loadSdk = String(await sdk.loadSdk());
  const exp = require(path.join(base, 'experimental.js'));
  out.registered = exp.offeredDescriptors(process.env).map((d) => d.id);
  const f = exp.claudeTransportFor(process.env);
  const t = await f({ file: '/nonexistent/claude', cwd: process.cwd(), env: {}, launch: { mode: 'read-only', sessionId: 's', resume: false }, handlers: { message() {}, control: async () => ({ response: {} }), exit() {} } });
  out.transport = t.kind;
  await t.close();
  console.log('[pack-esm]', JSON.stringify(out));
  if (process.env.PACK_ESM_OUT) require('fs').writeFileSync(process.env.PACK_ESM_OUT, JSON.stringify(out));
};
