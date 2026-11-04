/**
 * Spec 099: what Phase 2 leaves reachable. The real adapters report the capability (T020-T022, `verified: false`), and nothing outside the
 * adapters reads it or calls `setAutopilot`: no channel, no main caller, no window. T030 and T033 change the lists below on purpose, and T030 must flip
 * `AUTOPILOT_WIRED` in the same commit (the last assertion).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { AUTOPILOT_WIRED } from '../src/adapters/autopilotHost';
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

assert.deepStrictEqual(hits(/agents:setAutopilot/), [], 'no agents:setAutopilot channel');
assert.deepStrictEqual(hits(/setAutopilot/, 'src/main/'), ['src/main/simguard.ts'], 'main never calls setAutopilot (the simulator guard only lists the name)');
assert.deepStrictEqual(hits(/autopilot/i, 'src/renderer/'), [], 'nothing in the window offers it');
assert.deepStrictEqual(hits(/autopilot/i, 'src/main/'), ['src/main/simguard.ts'], 'nothing in main reads the capability');
assert.deepStrictEqual(hits(/autopilot/i, 'src/shared/'), ['src/shared/api.ts'], 'only the AgentInfo type');
assert.ok(!/autopilot/i.test(src('src/adapters/router.ts')), 'the router has no path to it');

// FR-053 cannot be forgotten: once main can turn Autopilot on, a real resume must clear first
const mainCalls = hits(/\.setAutopilot\?*\.?\(/, 'src/main/').length > 0;
assert.ok(AUTOPILOT_WIRED === mainCalls, 'AUTOPILOT_WIRED must be true exactly when main calls setAutopilot (T030)');

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
