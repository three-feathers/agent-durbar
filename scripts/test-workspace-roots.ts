/**
 * A workspace's other folders are given to the session (spec 006 FR-019): Copilot `additionalDirectories` on create and
 * resume, Claude `--add-dir` and the SDK's `additionalDirectories`. `npm run test:wsroots`. No Copilot, no Claude, no credits.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { claudeArgs } from '../src/adapters/claude';
import { sdkOptionsOf } from '../src/adapters/claudeSdk';
import { FakeClient, FakeCopilot } from './fakes/copilot-sdk';

async function main(): Promise<void> {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-wsroots-')));
  try {
    const a = path.join(dir, 'app'), b = path.join(dir, 'lib');
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    const wsFile = path.join(dir, 'two.code-workspace');
    fs.writeFileSync(wsFile, JSON.stringify({ folders: [{ path: 'app' }, { path: 'lib' }] }));

    // Copilot: a workspace gets its other folders, on create and on resume; a plain folder gets none
    const fake = new FakeClient();
    const ad = new FakeCopilot(fake);
    await ad.start({ workspace: wsFile, model: 'auto', quiet: true });
    assert.strictEqual(fake.created[0].workingDirectory, a, 'the session still runs in the first folder');
    assert.deepStrictEqual(fake.created[0].additionalDirectories, [b]);
    await ad.start({ workspace: wsFile, model: 'auto', resumeSessionId: 'old-1', quiet: true });
    assert.deepStrictEqual(fake.resumed[0].config.additionalDirectories, [b], 'given again on resume, as the SDK asks');
    await ad.start({ workspace: a, model: 'auto', quiet: true });
    assert.ok(!('additionalDirectories' in fake.created[1]), 'a plain folder adds nothing');

    // Claude: one --add-dir per folder (argv, no shell); none without; the SDK transport gets the same list
    const args = claudeArgs({ mode: 'read-only', sessionId: 's', resume: false, addDirs: [b, path.join(dir, 'with space')] });
    assert.deepStrictEqual(args.filter((x, i) => args[i - 1] === '--add-dir'), [b, path.join(dir, 'with space')]);
    assert.deepStrictEqual(args.slice(-2), ['--session-id', 's'], 'the session flag stays last');
    assert.ok(!claudeArgs({ mode: 'read-only', sessionId: 's', resume: false }).includes('--add-dir'));
    const base = { file: 'claude', cwd: a, env: {}, handlers: {} as never, launch: { mode: 'read-only' as const, sessionId: 's', resume: false, addDirs: [b] } };
    assert.deepStrictEqual(sdkOptionsOf(base as never, 0, 0).additionalDirectories, [b]);
    assert.ok(!('additionalDirectories' in sdkOptionsOf({ ...base, launch: { ...base.launch, addDirs: undefined } } as never, 0, 0)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('workspace roots tests passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
