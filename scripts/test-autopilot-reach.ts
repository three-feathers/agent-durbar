/**
 * Spec 099 (*Changes*, Phase 3 gate): what stays out of reach. `AUTOPILOT_WIRED` is false, so the default build is unchanged for every person: the mode menu has no item, `agents:setAutopilot`
 * refuses, the window hears of no capability, the simulator offers none. All the code is behind it. Main's only way in is `autopilotOn`, whose other half is `autopilotTestGate`, which a packaged
 * build cannot open. The flip is one commit: `AUTOPILOT_WIRED`, `AUTOPILOT_SHIPPED` below, and T038's README; it waits for the review of #923 and the owners.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { AUTOPILOT_WIRED } from '../src/adapters/autopilotHost';
import { autopilotTestGate } from '../src/main/devhooks';
import { CLAUDE_SDK_CAPABILITIES, CLAUDE_CAPABILITIES } from '../src/adapters/claude';
import { CODEX_CAPABILITIES } from '../src/adapters/codex';
import { COPILOT_CAPABILITIES } from '../src/adapters/copilot';
import { FakeAdapter } from '../src/adapters/fake';

const root = path.join(__dirname, '..', '..');
function walk(d: string): string[] {
  return fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
}
const files = walk('src').filter((f) => /\.(ts|js|html)$/.test(f));
const src = (f: string): string => fs.readFileSync(path.join(root, f), 'utf8');
const hits = (re: RegExp, under = ''): string[] => files.filter((f) => f.split(path.sep).join('/').startsWith(under) && re.test(src(f))).map((f) => f.split(path.sep).join('/')).sort();

for (const c of [COPILOT_CAPABILITIES, CLAUDE_CAPABILITIES, CODEX_CAPABILITIES]) assert.strictEqual(c.autopilot?.verified, false, 'FR-001: not verified until a real run (SC-004)');
assert.strictEqual(CLAUDE_SDK_CAPABILITIES.autopilot, undefined, 'the dev SDK transport was never probed with /goal: no Autopilot on it');
assert.strictEqual(CODEX_CAPABILITIES.autopilot?.planApproval, false, 'FR-060: not on the Codex plan card');

/** Text without comments: a commented-out line pins nothing. */
const codeOf = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// one path in: the channel, on the window's frame only, through the ops, which ask `enabled` first
assert.deepStrictEqual(hits(/agents:setAutopilot/), ['src/main/ipc/agents.ts', 'src/preload/preload.ts'], 'one channel');
// any receiver: `ad.setAutopilot(`, `router.forAgent(x)?.setAutopilot?.(` ...: outside the ops, main has only the handler's call of the ops themselves
const callers = files.filter((f) => f.split(path.sep).join('/').startsWith('src/main/') && !f.endsWith('autopilotops.ts')).flatMap((f) => codeOf(src(f)).split('\n').filter((l) => /\.setAutopilot\?*\.?\(/.test(l) && !/deps\.autopilot\.setAutopilot\(id, settings\)/.test(l)).map((l) => `${f}: ${l.trim().slice(0, 80)}`));
assert.deepStrictEqual(callers, [], 'only the ops call the adapter');
assert.ok(/fromApp\(e\) \? deps\.autopilot\.setAutopilot\(id, settings\)/.test(codeOf(src('src/main/ipc/agents.ts'))), 'FR-004: the window only');
assert.ok(!/autopilot/i.test(src('src/adapters/router.ts').replace(/.*FR-082.*\n/g, '')), 'the router has no path to it');
assert.ok(!/setAutopilot/.test(src('src/main/mcp/tools.ts')), 'FR-004: no MCP tool');
const main = codeOf(src('src/main/main.ts'));
assert.ok(main.includes('const autopilotOn = (): boolean => AUTOPILOT_WIRED || autopilotTestGate(process.env, app.isPackaged);'), "main's gate");
assert.ok(main.includes('enabled: autopilotOn,'), 'the ops read it');
assert.ok(main.includes('windowAdapters(infos, autopilotOn())'), 'the window hears of no capability');
assert.ok(main.includes("if (autopilotOn()) query.simautopilot = '1';"), 'the simulator offers it only then');
// the flag lives in one line, and every test above and in the adapters' files follows it or a parameter, so a flip is that line (spec *Changes*)
assert.strictEqual((src('src/adapters/autopilotHost.ts').match(/^export const AUTOPILOT_WIRED = (false|true) as boolean;$/gm) ?? []).length, 1, 'one line');
assert.strictEqual(typeof AUTOPILOT_WIRED, 'boolean');
// the simulator's capability is behind main's query, nothing else
assert.ok(/get\('simautopilot'\)/.test(src('src/renderer/sim.ts')), 'the simulator asks main');

// the gate itself: a packaged build cannot open it by any variable
const G = { DURBAR_AUTOPILOT_TEST: '1', DURBAR_SIM: '15' } as NodeJS.ProcessEnv;
assert.strictEqual(autopilotTestGate(G, false), true);
assert.strictEqual(autopilotTestGate({ DURBAR_AUTOPILOT_TEST: '1', DURBAR_DRIVER: '/d.js' } as NodeJS.ProcessEnv, false), true);
assert.strictEqual(autopilotTestGate(G, true), false, 'packaged');
assert.strictEqual(autopilotTestGate({ ...G, DURBAR_DEV: '1' } as NodeJS.ProcessEnv, true), false, 'packaged with the developer opt-in: still closed');
assert.strictEqual(autopilotTestGate({ DURBAR_AUTOPILOT_TEST: '1' } as NodeJS.ProcessEnv, false), false, 'a plain npm start');
for (const v of [undefined, '', '0', 'true', ' 1', '11']) assert.strictEqual(autopilotTestGate({ DURBAR_SIM: '15', DURBAR_AUTOPILOT_TEST: v } as NodeJS.ProcessEnv, false), false, String(v));
assert.strictEqual(autopilotTestGate({ DURBAR_SIM: '15' } as NodeJS.ProcessEnv, false), false, 'the simulator alone: absent');

// the fake adapter (FR-027): the member exists exactly with the capability, and it refuses outside Allow all
void (async () => {
  process.exitCode = 1;
  assert.strictEqual(new FakeAdapter().setAutopilot, undefined, 'off by default');
  const f = new FakeAdapter({ capabilities: { autopilot: { capUnit: 'aiu', attachments: true, planApproval: true, verified: false } } });
  const allow = await f.start({ workspace: root, permissionMode: 'allow', quiet: true });
  await f.setAutopilot!(allow, { limit: 5 });
  await f.setAutopilot!(allow, null, 'stopped');
  assert.deepStrictEqual(f.autopilotCalls, [{ sessionId: allow, settings: { limit: 5 } }, { sessionId: allow, settings: null, reason: 'stopped' }]);
  const ask = await f.start({ workspace: root, permissionMode: 'ask', quiet: true });
  await assert.rejects(f.setAutopilot!(ask, { limit: 5 }), /only in Allow all/);
  process.exitCode = 0;
  console.log('test-autopilot-reach: OK');
})();
