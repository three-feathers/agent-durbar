/**
 * Dev tool, USES AI CREDITS (spec 030 Phase 3, T041..T046). Not part of `npm test`, never run in CI. Owner-approved 2026-10-17:
 * a handful of one-line prompts on the `auto` model of the logged-in account, one manual compaction, hard ceiling of CEILING credits
 * (default 20, far below the owner's 100) measured on the account quota before every step; every session is created with a 30-credit cap.
 * It uses the real CopilotAdapter (so the adapter's setModel/compact/start code is what is tested) and records the raw runtime events
 * (strings cut at 160 characters, no token or login) into the JSON file given as argument.
 *   node dist-scripts/scripts/phase3-real.js <out.json> [ceiling]
 */
import { CopilotAdapter } from '../src/adapters/copilot';
import type { AgentEvent } from '../src/adapters/types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const out = process.argv[2] ?? '/workspace/p3/phase3.json';
const CEILING = Number(process.argv[3] ?? 20);
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-p3-'));

type Raw = { type: string; data?: Record<string, unknown> };
const cut = (v: unknown): unknown =>
  typeof v === 'string' ? (v.length > 160 ? v.slice(0, 160) + '…' : v) : Array.isArray(v) ? v.slice(0, 8).map(cut) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !/token$|^login$|hmac|^host$|authorization/i.test(k) || /tokens?$/i.test(k)).map(([k, x]) => [k, cut(x)])) : v;

class P3 extends CopilotAdapter {
  async quota(): Promise<{ usedCredits: number; entitlement: number; remainingPct: number }> {
    const c = (await this.getClient()) as unknown as { rpc: { account: { getQuota: (p: object) => Promise<{ quotaSnapshots: Record<string, { entitlementRequests: number; remainingPercentage: number }> }> } } };
    const q = (await c.rpc.account.getQuota({})).quotaSnapshots.chat;
    return { usedCredits: Math.round(((100 - q.remainingPercentage) / 100) * q.entitlementRequests * 100) / 100, entitlement: q.entitlementRequests, remainingPct: q.remainingPercentage };
  }
  raw(sid: string): any { return (this as any).sessions.get(sid)?.session; } // eslint-disable-line @typescript-eslint/no-explicit-any
  clientRaw(): Promise<any> { return this.getClient(); } // eslint-disable-line @typescript-eslint/no-explicit-any
}

const log: Array<Record<string, unknown>> = [];
const ad = new P3();
const norm: AgentEvent[] = [];
ad.onEvent((e) => norm.push(e));
let rawEvents: Raw[] = [];
let baseline = 0;
let step = '';
const note = (k: string, v: unknown): void => { log.push({ step, k, v: cut(v) }); console.log(`[${step}] ${k}: ${JSON.stringify(cut(v)).slice(0, 300)}`); };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function guard(label: string): Promise<number> {
  step = label;
  const q = await ad.quota();
  const spent = Math.round((q.usedCredits - baseline) * 100) / 100;
  note('quota', { usedCredits: q.usedCredits, spentSinceStart: spent });
  if (spent > CEILING) { fs.writeFileSync(out, JSON.stringify({ aborted: 'ceiling', log }, null, 2)); throw new Error(`ceiling ${CEILING} credits reached (${spent}); stopped`); }
  return spent;
}
function watch(sid: string): void {
  ad.raw(sid).on((e: Raw) => { rawEvents.push({ type: e.type, data: cut(e.data) as Record<string, unknown> }); });
}
async function prompt(sid: string, text: string): Promise<Raw[]> {
  const from = rawEvents.length;
  const done = new Promise<void>((resolve) => { const t = setInterval(() => { if (rawEvents.slice(from).some((e) => e.type === 'session.idle')) { clearInterval(t); resolve(); } }, 200); setTimeout(() => { clearInterval(t); resolve(); }, 90000); });
  await ad.send(sid, { text });
  await done;
  return rawEvents.slice(from);
}
const answer = (evs: Raw[]): string => String(evs.filter((e) => e.type === 'assistant.message').map((e) => (e.data as { content?: string }).content ?? '').join(' ')).slice(0, 120);
const usageOf = (evs: Raw[]): unknown[] => evs.filter((e) => e.type === 'assistant.usage' || e.type === 'session.usage_info').map((e) => ({ type: e.type, ...e.data }));
const keep = (evs: Raw[]): Raw[] => evs.filter((e) => /model_change|compaction|usage|idle|abort|queue|error|warning|limit/.test(e.type));

async function main(): Promise<void> {
  baseline = (await ad.quota()).usedCredits;
  note('baselineUsedCredits', baseline);
  step = 'T041 create';
  const sid = await ad.start({ workspace: folder, model: 'auto', autoTier: 'efficiency', maxAiCredits: 30, quiet: true });
  watch(sid);
  note('current', await ad.raw(sid).rpc.model.getCurrent());

  // T041: history across a switch
  await guard('T041 p1');
  let evs = await prompt(sid, 'Remember the code word BANANA. Reply with only the word ok.');
  note('p1 answer', answer(evs)); note('p1 events', keep(evs));
  note('setModel auto->auto', await ad.setModel(sid, { model: 'auto' }));
  note('setModel -> gpt-5-mini (not listed on this plan)', await ad.setModel(sid, { model: 'gpt-5-mini', effort: null }));
  note('setModel auto + long tier', await ad.setModel(sid, { model: 'auto', contextTier: 'long' }));
  note('current after tier request', await ad.raw(sid).rpc.model.getCurrent());
  note('setModel auto + default tier', await ad.setModel(sid, { model: 'auto', contextTier: 'default' }));
  await guard('T041 p2');
  evs = await prompt(sid, 'What was the code word? Reply with only that word.');
  note('p2 answer (history kept across the switch calls?)', answer(evs)); note('p2 usage', usageOf(evs));
  note('normalized events so far', norm.filter((e) => e.type === 'model' || e.type === 'context' || e.type === 'usage').slice(-8));

  // T042: switch during a turn, then Stop
  await guard('T042');
  const from = rawEvents.length;
  const turn = prompt(sid, 'Count from 1 to 60, one number per line, nothing else.');
  for (let i = 0; i < 40; i++) { await sleep(150); if ((await ad.raw(sid).rpc.metadata.isProcessing()).processing) break; }
  note('processing', (await ad.raw(sid).rpc.metadata.isProcessing()).processing);
  note('setModel during turn (adapter)', await ad.setModel(sid, { model: 'auto' }));
  note('raw switchTo balance during turn', await ad.raw(sid).rpc.model.switchTo({ modelId: 'auto', autoTier: 'balance', requireAvailable: true, deferIfModelChangeQueued: true, source: 'model_picker' }).catch((e: Error) => ({ error: e.message })));
  note('queue.pendingItems during turn', await ad.raw(sid).rpc.queue.pendingItems().catch((e: Error) => ({ error: e.message })));
  note('current during turn', await ad.raw(sid).rpc.model.getCurrent());
  note('adapter.compact during turn', await ad.compact(sid));
  note('raw history.compact during turn', await ad.raw(sid).rpc.history.compact({ trigger: 'manual' }).catch((e: Error) => ({ error: e.message })));
  await sleep(800);
  await ad.interrupt(sid);
  note('after Stop: queue.pendingItems', await ad.raw(sid).rpc.queue.pendingItems().catch((e: Error) => ({ error: e.message })));
  note('after Stop: current', await ad.raw(sid).rpc.model.getCurrent());
  await turn;
  note('after Stop: current (idle)', await ad.raw(sid).rpc.model.getCurrent());
  note('removeAt unknown id', await ad.raw(sid).rpc.queue.removeAt({ id: 'nope' }).catch((e: Error) => ({ error: e.message })));
  note('turn events', keep(rawEvents.slice(from)));
  note('restore efficiency', await ad.raw(sid).rpc.model.switchTo({ modelId: 'auto', autoTier: 'efficiency', requireAvailable: true, source: 'model_picker' }).catch((e: Error) => ({ error: e.message })));
  note('current restored', await ad.raw(sid).rpc.model.getCurrent());

  // T043: manual compaction
  await guard('T043 before compaction');
  note('contextInfo before', await ad.raw(sid).rpc.metadata.contextInfo({}).catch((e: Error) => ({ error: e.message })));
  const cFrom = rawEvents.length;
  const q0 = (await ad.quota()).usedCredits;
  note('adapter.compact (idle)', await ad.compact(sid, 'keep the code word'));
  await sleep(1500);
  note('compaction events', keep(rawEvents.slice(cFrom)));
  note('contextInfo after', await ad.raw(sid).rpc.metadata.contextInfo({}).catch((e: Error) => ({ error: e.message })));
  note('compaction credits (quota diff, may lag)', Math.round(((await ad.quota()).usedCredits - q0) * 100) / 100);
  await guard('T043 p3');
  evs = await prompt(sid, 'What was the code word? Reply with only that word.');
  note('p3 answer (history kept after compaction?)', answer(evs)); note('p3 usage', usageOf(evs));

  // T046: resume
  await ad.stop(sid);
  await guard('T046 resume');
  const sid2 = await ad.start({ workspace: folder, sessionId: sid, model: 'auto', autoTier: 'efficiency', contextTier: 'default', maxAiCredits: 30, quiet: true });
  note('same session id on resume', sid2 === sid);
  watch(sid2);
  note('current after resume (model passed)', await ad.raw(sid2).rpc.model.getCurrent());
  evs = await prompt(sid2, 'What was the code word? Reply with only that word.');
  note('p4 answer (history kept after resume?)', answer(evs));
  await ad.stop(sid2);
  const c = await ad.clientRaw();
  const r3 = await c.resumeSession(sid, { onPermissionRequest: async () => ({ kind: 'reject' }) });
  note('current after resume (model omitted)', await r3.rpc.model.getCurrent());
  await r3.disconnect();
  await c.deleteSession(sid).catch(() => undefined);

  const total = await guard('end');
  note('TOTAL credits spent (quota diff)', total);
  fs.writeFileSync(out, JSON.stringify({ provenance: 'real', capturedAt: new Date().toISOString().slice(0, 10), ceilingCredits: CEILING, spentCredits: total, log, rawEvents: keep(rawEvents) }, null, 2));
  await (await ad.clientRaw()).stop();
}

main().catch(async (e) => {
  console.error('FAILED', String(e instanceof Error ? e.message : e).slice(0, 400));
  fs.writeFileSync(out + '.partial', JSON.stringify({ log, rawEvents: keep(rawEvents) }, null, 2));
  try { await (await ad.clientRaw()).stop(); } catch { /* ignore */ }
  process.exit(1);
});
