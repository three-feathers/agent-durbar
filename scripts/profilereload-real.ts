/**
 * Spec 043 FR-041, real check (owner's go-ahead on #572, 2026-10-23): does Copilot's `rpc.agent.reload` make a running session
 * list a profile file created, edited or deleted through Durbar's own file functions, and does the selected agent survive it?
 * One real Copilot session in a scratch folder (read-only mode), **no prompt sent**; the session is stopped and deleted at the end.
 * Prints only the test profiles' own names and descriptions (never tokens, never ~/.copilot contents, never other agents' names).
 *
 *   npx tsc -p tsconfig.scripts.json && node dist-scripts/scripts/profilereload-real.js <scratch-folder>
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { CopilotAdapter } from '../src/adapters/copilot';
import type { AgentEvent, AgentProfile } from '../src/adapters/types';
import { createProfileFile, createProfileFreshness, deleteProfileFile, folderIdOf, listAgentProfilesFresh, listProfileFiles, profileDirs, readProfileFile, saveProfileFile } from '../src/main/profilefiles';

const PREFIX = 'durbar-rc-';

async function main(): Promise<void> {
  const folder = path.resolve(process.argv[2] ?? '');
  assert.ok(process.argv[2] && fs.existsSync(folder) && fs.readdirSync(folder).length === 0, 'give an empty scratch folder');
  const dirs = () => profileDirs([folder]);
  const W = folderIdOf(folder);
  // the selected test profile exists before the session starts
  const alpha = createProfileFile(dirs(), 'copilot', W, PREFIX + 'alpha', 'standard');
  assert.ok(alpha.ok, 'alpha written');

  const ad = new CopilotAdapter();
  const profileEvents: string[] = [];
  ad.onEvent((e: AgentEvent) => {
    if (e.type === 'agentProfile') profileEvents.push(e.profile ? e.profile.id : 'null');
    if (e.type === 'usage') console.log('!! a usage event arrived (a request was made)');
  });
  const fr = createProfileFreshness();
  const mine = (ps: AgentProfile[]): string[] => ps.filter((p) => p.id.startsWith(PREFIX)).map((p) => `${p.id}${p.description ? ' (' + p.description + ')' : ''}`).sort();
  let sid = '';
  const rpc = () => (ad as unknown as { sessions: Map<string, { session: { rpc: { agent: { getCurrent(): Promise<{ agent?: { name?: string } | null } | null> } } } }> }).sessions.get(sid)!.session.rpc.agent;
  const current = async (): Promise<string> => {
    const r = await rpc().getCurrent();
    const a = (r && (r as { agent?: { name?: string; id?: string } | null }).agent) || null;
    return a ? String(a.name ?? (a as { id?: string }).id) : 'null';
  };
  const step = async (label: string, change: () => void): Promise<void> => {
    change();
    fr.changed();
    const before = mine(await ad.listAgentProfiles(sid));
    const after = mine(await listAgentProfilesFresh(ad, sid, fr));
    console.log(`${label}\n  list before reload: ${JSON.stringify(before)}\n  list after reload:  ${JSON.stringify(after)}\n  selected after:     ${await current()}`);
  };
  try {
    sid = await ad.start({ workspace: folder });
    console.log('session started (read-only, no prompt)');
    console.log('start: ' + JSON.stringify(mine(await ad.listAgentProfiles(sid))));
    await ad.selectAgentProfile(sid, PREFIX + 'alpha');
    console.log('selected: ' + (await current()));

    await step('1. create durbar-rc-beta', () => assert.ok(createProfileFile(dirs(), 'copilot', W, PREFIX + 'beta', 'standard').ok));
    await step('2. edit durbar-rc-alpha description', () => {
      const f = listProfileFiles(dirs()).find((x) => x.fileName === PREFIX + 'alpha.agent.md')!;
      const r = readProfileFile(dirs(), f.id);
      assert.ok(r.ok);
      if (r.ok) assert.ok(saveProfileFile(dirs(), f.id, r.text.replace(/^description: .*$/m, 'description: Edited through Durbar'), r.sha256, false).ok);
    });
    await step('3. delete durbar-rc-beta', () => {
      const f = listProfileFiles(dirs()).find((x) => x.fileName === PREFIX + 'beta.agent.md')!;
      assert.ok(deleteProfileFile(dirs(), f.id).ok);
    });
    await step('4. delete the selected durbar-rc-alpha', () => {
      const f = listProfileFiles(dirs()).find((x) => x.fileName === PREFIX + 'alpha.agent.md')!;
      assert.ok(deleteProfileFile(dirs(), f.id).ok);
    });
    console.log('agentProfile events: ' + JSON.stringify(profileEvents));
  } finally {
    if (sid) {
      await ad.stop(sid).catch(() => undefined);
      await ad.deleteSession?.(sid).catch(() => undefined);
      console.log('session stopped and deleted');
    }
    await ad.dispose();
  }
}

main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
