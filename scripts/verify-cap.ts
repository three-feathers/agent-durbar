/**
 * REAL-RUNTIME check of the credit cap configuration path, with NO model call (no inference, 0 AIU): `npm run verify:cap`.
 * Starts a real session in a temp folder with the minimum cap (30), then raises it and removes it with `setCap`, and prints the
 * normalized `limit` events the runtime sends. It cannot show the exhausted-limit flow: reaching a 30-credit cap costs real money
 * (30 credits = USD 0.30, about 150 prompts at today's 0.2 AIU per tiny prompt), so that flow stays `[UNVERIFIED]` (spec 011 FR-015).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CopilotAdapter } from '../src/adapters/copilot';
import type { AgentEvent } from '../src/adapters/types';

async function main(): Promise<void> {
  const adapter = new CopilotAdapter();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-cap-'));
  const seen: string[] = [];
  adapter.onEvent((e: AgentEvent) => {
    if (e.type === 'limit') seen.push(`limit ${JSON.stringify({ phase: e.phase, max: e.maxAiCredits, used: e.usedAiCredits })}`);
    if (e.type === 'usage') seen.push('USAGE (unexpected: no prompt was sent)');
  });
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  try {
    const sid = await adapter.start({ workspace: dir, model: 'auto', maxAiCredits: 30, quiet: true });
    await wait(1500);
    seen.push('-- setCap(60)');
    await adapter.setCap(sid, 60);
    await wait(1500);
    seen.push('-- setCap(null)');
    await adapter.setCap(sid, null);
    await wait(1500);
    try {
      await adapter.setCap(sid, 5);
      seen.push('-- setCap(5) was accepted (the runtime minimum is not enforced on update)');
    } catch (err) {
      seen.push(`-- setCap(5) refused: ${err instanceof Error ? err.message : String(err)}`);
    }
    await wait(800);
    await adapter.stop(sid);
  } finally {
    console.log(seen.join('\n'));
    await adapter.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0), (err) => {
  console.error('VERIFY FAILED:', err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});
