/**
 * Dev tool (uses credits, NOT part of `npm test`): sends ONE prompt to a real Copilot session and records every RAW SDK event
 * (before the adapter normalises it) as JSON lines. Usage:
 *   node dist-scripts/scripts/capture-raw.js <out.jsonl> [model] [effort] [folder] [prompt]
 * LISTONLY=1 only lists the models and their reasoning options (no inference, no credits). Reads are approved, all else is denied.
 */
import { CopilotClient } from '@github/copilot-sdk';
import * as fs from 'fs';

async function main(): Promise<void> {
  const [out = '/workspace/capture/raw.jsonl', model = 'auto', effort, folder = '/workspace/durbar-test/hello-app', prompt] = process.argv.slice(2);
  const client = new CopilotClient({});
  await client.start();
  if (process.env.LISTONLY) {
    for (const m of await client.listModels()) {
      console.log(JSON.stringify({ id: m.id, x: m.billing?.multiplier, efforts: m.supportedReasoningEfforts, defEffort: m.defaultReasoningEffort, policy: m.policy?.state, caps: m.capabilities?.supports }));
    }
    await client.stop();
    return;
  }
  const session = await client.createSession({
    workingDirectory: folder,
    streaming: true,
    model,
    ...(effort ? { reasoningEffort: effort as 'low' } : {}),
    ...(model === 'auto' ? { capi: { autoTier: 'efficiency' as const } } : {}),
    onPermissionRequest: async (req) => ({ kind: req.kind === 'read' ? 'approve-once' : 'reject' }) as never,
  });
  const fd = fs.openSync(out, 'w');
  let n = 0;
  const done = new Promise<void>((resolve) => {
    session.on((ev) => {
      n++;
      fs.writeSync(fd, JSON.stringify(ev) + '\n');
      if (ev.type === 'session.idle' || ev.type === 'session.error') resolve();
    });
  });
  const text = prompt ?? 'Use a sub-agent to look at both README.md and index.js and summarise in two sentences. Do not edit files.';
  await session.send({ prompt: text });
  await Promise.race([done, new Promise((r) => setTimeout(r, 180_000))]);
  fs.closeSync(fd);
  console.log(`wrote ${n} events to ${out}`);
  await session.disconnect();
  await client.stop();
}
main().catch((e) => { console.error(e); process.exit(1); });
