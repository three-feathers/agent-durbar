/**
 * Headless smoke test for the Copilot adapter. Run once:  npm run smoke
 * Starts one read-only session per test folder, sends ONE tiny prompt each, prints
 * normalized events and usage. SMOKE_DRY=1 only starts the runtime and lists models (no inference).
 */
import * as os from 'os';
import * as path from 'path';
import { CopilotAdapter } from '../src/adapters/copilot';
import type { AgentEvent } from '../src/adapters/types';

const FOLDERS = (process.env.SMOKE_FOLDERS ?? ['hello-app', 'notes-app'].map((n) => path.join(os.tmpdir(), 'durbar-test', n)).join(',')).split(',');
const PROMPT = 'In one sentence, what does index.js do? Do not edit files.';
const TIMEOUT_MS = 120_000;

async function main(): Promise<void> {
  const adapter = new CopilotAdapter();
  const models = await adapter.listModels();
  console.log('models (id | multiplier | inputPrice | outputPrice | policy):');
  for (const m of models) {
    const p = m.billing?.tokenPrices;
    console.log(`  ${m.id} | x${m.billing?.multiplier ?? '?'} | in ${p?.inputPrice ?? '?'} | out ${p?.outputPrice ?? '?'} | ${m.policy?.state ?? '?'}`);
  }
  const cheapest = await adapter.cheapestModel();
  console.log(`cheapest model: ${cheapest?.id ?? '(none reported, using default)'}`);
  if (process.env.SMOKE_DRY) return void (await adapter.dispose());

  const totals = { calls: 0, inputTokens: 0, outputTokens: 0, nanoAiu: 0, unavailable: 0 };
  const done = new Map<string, () => void>();
  const worked = new Set<string>();
  const buf = new Map<string, { thinking: string; output: string }>();

  adapter.onEvent((e: AgentEvent) => {
    const tag = `[${e.sessionId.slice(0, 8)}${e.agentId ? ' sub:' + e.agentId : ''}]`;
    const b = buf.get(e.sessionId) ?? { thinking: '', output: '' };
    buf.set(e.sessionId, b);
    switch (e.type) {
      case 'thinking': b.thinking += e.delta; return;
      case 'output':
        if (!e.final) { b.output += e.delta; return; }
        break;
      default: break;
    }
    if (b.thinking) { console.log(`${tag} thinking: ${JSON.stringify(b.thinking.slice(0, 200))} (${b.thinking.length} chars)`); b.thinking = ''; }
    if (b.output && e.type === 'output') b.output = '';
    if (e.type === 'usage') {
      totals.calls++;
      totals.inputTokens += e.inputTokens ?? 0;
      totals.outputTokens += e.outputTokens ?? 0;
      if (e.nanoAiu != null) totals.nanoAiu += e.nanoAiu; else totals.unavailable++;
    }
    console.log(`${tag} ${JSON.stringify(e, (k, v) => (k === 'sessionId' || k === 'timestamp' ? undefined : typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : v))}`);
    if (e.type === 'status' && e.status === 'working') worked.add(e.sessionId);
    if (e.type === 'status' && ((e.status === 'idle' && worked.has(e.sessionId)) || e.status === 'error')) done.get(e.sessionId)?.();
  });

  for (const folder of FOLDERS) {
    console.log(`\n=== ${folder} ===`);
    const sid = await adapter.start({ workspace: folder, model: cheapest?.id, autoTier: cheapest?.id === 'auto' ? 'efficiency' : undefined });
    const finished = new Promise<void>((resolve, reject) => {
      done.set(sid, resolve);
      setTimeout(() => reject(new Error(`timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS).unref();
    });
    await adapter.send(sid, { text: PROMPT });
    await finished;
    await adapter.stop(sid);
  }
  console.log('\nTOTALS', JSON.stringify(totals), '(nanoAiu = 1e-9 AI units as reported by the Copilot API)');
  await adapter.dispose();
}

main().then(() => process.exit(0), (err) => {
  console.error('SMOKE FAILED:', err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});
