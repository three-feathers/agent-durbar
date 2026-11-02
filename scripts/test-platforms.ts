/** Unit test (spec 062 FR-004): one list of supported CI platforms, used by every OS-matrix workflow that real-checks the app. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { APPS, cheapCodex, mayContinueWithoutSandbox, turn } from './e2e-real';
import type { AgentAdapter, AgentEvent } from '../src/adapters/types';
import type { ModelOption } from '../src/shared/modelswitch';

const ROOT = path.join(__dirname, '..', '..');
const list = JSON.parse(fs.readFileSync(path.join(ROOT, '.github', 'platforms.json'), 'utf8')) as unknown;
assert.ok(Array.isArray(list) && list.length >= 3 && list.every((x) => typeof x === 'string' && /^[a-z0-9.-]+$/.test(x)), 'platforms.json: a list of runner labels');
for (const os of ['ubuntu', 'macos', 'windows']) assert.ok((list as string[]).some((x) => x.startsWith(os)), `platforms.json covers ${os}`);
for (const wf of ['e2e-real.yml', 'install-check.yml']) {
  const y = fs.readFileSync(path.join(ROOT, '.github', 'workflows', wf), 'utf8');
  assert.ok(y.includes('.github/platforms.json') && y.includes('fromJSON(needs.platforms.outputs.list)'), `${wf} takes its matrix from platforms.json`);
  assert.ok(!/os:\s*\[\s*ubuntu/.test(y), `${wf} has no hard-coded OS list`);
}
// the real-account workflow never runs PR code with the secrets
const e2e = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'e2e-real.yml'), 'utf8');
assert.ok(!/^\s*pull_request(_target)?\s*:/m.test(e2e), 'e2e-real.yml does not run on pull_request');
// spec 062 FR-006/FR-007 (2026-10-22, cost): no push trigger, a daily schedule, the turn on macOS and Windows only when chosen
assert.ok(!/^\s*push\s*:/m.test(e2e), 'e2e-real.yml has no push trigger (it spent credits on every merge)');
assert.ok(/^\s*-\s*cron:\s*'17 5 \* \* \*'/m.test(e2e), 'e2e-real.yml runs once a day');
assert.ok(/^\s*workflow_dispatch\s*:/m.test(e2e), 'e2e-real.yml can still be run by hand');
assert.ok(/full_turn:[\s\S]*type:\s*boolean[\s\S]*default:\s*false/.test(e2e), 'e2e-real.yml has a full_turn input, off by default');
assert.ok(e2e.includes('flag=--no-turn') && e2e.includes('"$RUNNER_OS" = "Linux"') && e2e.includes('date -u +%u)" = "1"') && e2e.includes('${E2E_FLAG:+"$E2E_FLAG"}'), 'e2e-real.yml passes --no-turn on macOS and Windows except Mondays or full_turn');
assert.strictEqual((e2e.match(/\$\{\{\s*secrets\./g) ?? []).length, 3, 'secrets are used in one step only (three names)');
// FR-008: Codex runs a small model with a low effort
const m = (id: string, efforts: string[] = ['low', 'medium', 'high'], extra: Partial<ModelOption> = {}): ModelOption => ({ id, name: id, efforts, disabled: false, ...extra });
const codexList = [m('gpt-6.1-sol', ['low', 'medium', 'high']), m('gpt-6-nano', ['minimal', 'low']), m('gpt-6-mini', ['minimal', 'low', 'medium'])];
assert.deepStrictEqual(cheapCodex(codexList, {}), { model: 'gpt-6-mini', effort: 'low' }, 'a listed mini model first, effort low');
assert.deepStrictEqual(cheapCodex([codexList[0], codexList[1]], {}), { model: 'gpt-6-nano', effort: 'low' }, 'then a nano model');
assert.deepStrictEqual(cheapCodex([m('gpt-6-mini-x', [], { disabled: true }), codexList[0]], {}), { model: 'gpt-6.1-sol', effort: 'low' }, 'else the default model; a disabled one is skipped');
assert.deepStrictEqual(cheapCodex([m('gpt-6.1-sol', ['medium', 'high'])], {}), { model: 'gpt-6.1-sol', effort: 'medium' }, 'no low effort: the first one listed');
assert.deepStrictEqual(cheapCodex([m('gpt-6-gemini')], {}), { model: 'gpt-6-gemini', effort: 'low' }, '"mini" inside a word is not a mini model');
assert.deepStrictEqual(cheapCodex(codexList, { E2E_CODEX_MODEL: 'gpt-7-mini', E2E_CODEX_EFFORT: 'minimal' }), { model: 'gpt-7-mini', effort: 'minimal' }, 'the env wins');
assert.deepStrictEqual(cheapCodex(codexList, { E2E_CODEX_MODEL: 'claude-haiku', E2E_CODEX_EFFORT: 'Bad Value' }), { model: 'gpt-6-mini', effort: 'low' }, 'a non-Codex model or a malformed effort in the env is ignored');
assert.deepStrictEqual(cheapCodex([], {}), {}, 'nothing listed: Codex decides');
// spec 062 delta 2026-11-02: the sandbox fallback only where the runner cannot have one (Windows: Claude, Copilot)
assert.strictEqual(mayContinueWithoutSandbox('win32', 'claude'), true);
assert.strictEqual(mayContinueWithoutSandbox('win32', 'copilot'), true);
for (const [pl, k] of [['linux', 'claude'], ['linux', 'copilot'], ['darwin', 'claude'], ['darwin', 'copilot'], ['win32', 'codex'], ['linux', 'codex']] as const) assert.strictEqual(mayContinueWithoutSandbox(pl, k), false, `${pl} ${k}: a sandbox that cannot start fails the row`);
console.log(`platforms: ${(list as string[]).join(', ')}; e2e-real and install-check use the list; no pull_request with secrets, no push trigger, daily; Codex picks a small model`);

// spec 062 delta 2026-11-02: the wiring in turn(), with a fake adapter whose sandbox cannot start: the fallback is taken on Windows for Claude/Copilot only
(async () => {
  const run = async (platform: string, kind: 'claude' | 'copilot'): Promise<{ ok: boolean; continued: boolean }> => {
    const events: AgentEvent[] = [];
    let continued = false;
    const emit = (e: object): void => { events.push({ sessionId: 's1', timestamp: 0, ...e } as AgentEvent); };
    const ad = {
      start: async () => 's1',
      send: async () => {
        if (!continued) { emit({ type: 'sandbox', sandbox: null, notice: { text: 'The OS sandbox could not start.', actions: ['continue'] } }); emit({ type: 'status', status: 'idle', intent: 'Not sent: the OS sandbox could not start' }); }
        else { emit({ type: 'output', delta: 'ok', final: true, text: 'ok' }); emit({ type: 'status', status: 'idle' }); }
      },
      continueWithoutSandbox: async () => { continued = true; },
      stop: async () => undefined,
    } as unknown as AgentAdapter;
    const r = await turn(ad, APPS.find((a) => a.kind === kind)!, events, 'read-only', {}, platform);
    return { ok: r.ok, continued };
  };
  assert.deepStrictEqual(await run('win32', 'claude'), { ok: true, continued: true }, 'Windows Claude continues without the sandbox');
  assert.deepStrictEqual(await run('win32', 'copilot'), { ok: true, continued: true }, 'Windows Copilot continues without the sandbox');
  for (const pl of ['linux', 'darwin']) for (const k of ['claude', 'copilot'] as const) assert.deepStrictEqual(await run(pl, k), { ok: false, continued: false }, `${pl} ${k}: a sandbox that cannot start fails the row and is not skipped`);
  console.log('turn(): sandbox fallback only on Windows for Claude and Copilot');
})();
