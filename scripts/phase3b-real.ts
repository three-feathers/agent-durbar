/**
 * Dev tool, USES A FEW AI CREDITS (spec 030 T042, owner-approved 2026-10-17): a switch requested while a turn runs, then (a) cancelled with
 * `queue.removeAt`, (b) left queued and the turn stopped, then one tiny prompt to see whether the dropped/queued switch applies.
 * `auto` model only; the auto routing tier ('balance') is the queued change and is restored to 'efficiency' at the end. Not part of `npm test`.
 *   node dist-scripts/scripts/phase3b-real.js <out.json>
 */
import { CopilotAdapter } from '../src/adapters/copilot';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const out = process.argv[2] ?? '/workspace/p3/phase3b.json';
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-p3b-'));
type Raw = { type: string; data?: Record<string, unknown> };
const cut = (v: unknown): unknown => (typeof v === 'string' ? (v.length > 160 ? v.slice(0, 160) + '…' : v) : Array.isArray(v) ? v.slice(0, 8).map(cut) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !/^login$|hmac|^host$|authorization|apiCallId|usageId/i.test(k)).map(([k, x]) => [k, cut(x)])) : v);
class P extends CopilotAdapter {
  raw(sid: string): any { return (this as any).sessions.get(sid)?.session; } // eslint-disable-line @typescript-eslint/no-explicit-any
  c(): Promise<any> { return this.getClient(); } // eslint-disable-line @typescript-eslint/no-explicit-any
}
const ad = new P();
const log: Array<Record<string, unknown>> = [];
const evs: Raw[] = [];
const note = (k: string, v: unknown): void => { log.push({ k, v: cut(v) }); console.log(`${k}: ${JSON.stringify(cut(v)).slice(0, 320)}`); };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const keep = (from: number): Raw[] => evs.slice(from).filter((e) => /model_change|compaction|idle|abort|queue|error/.test(e.type));
async function turn(sid: string, text: string, during: () => Promise<void>): Promise<void> {
  const from = evs.length;
  const done = new Promise<void>((resolve) => { const t = setInterval(() => { if (evs.slice(from).some((e) => e.type === 'session.idle')) { clearInterval(t); resolve(); } }, 200); setTimeout(() => { clearInterval(t); resolve(); }, 90000); });
  await ad.send(sid, { text });
  for (let i = 0; i < 40; i++) { await sleep(150); if ((await ad.raw(sid).rpc.metadata.isProcessing()).processing) break; }
  await during();
  await done;
}
async function main(): Promise<void> {
  const sid = await ad.start({ workspace: folder, model: 'auto', autoTier: 'efficiency', maxAiCredits: 30, quiet: true });
  ad.raw(sid).on((e: Raw) => evs.push({ type: e.type, data: cut(e.data) as Record<string, unknown> }));
  const pend = async (): Promise<unknown> => (await ad.raw(sid).rpc.queue.pendingItems()).items;
  // (a) queue then cancel
  let f = evs.length;
  await turn(sid, 'Count from 1 to 60, one number per line, nothing else.', async () => {
    const r = await ad.setModel(sid, { model: 'auto', contextTier: 'long' });
    note('(a) setModel during turn', r);
    note('(a) pending', await pend());
    if (r.queueId) { await ad.cancelQueuedModel(sid, r.queueId).then(() => note('(a) cancelQueuedModel', 'ok'), (e: Error) => note('(a) cancelQueuedModel error', e.message)); }
    note('(a) pending after cancel', await pend());
  });
  note('(a) events', keep(f)); note('(a) current after turn', await ad.raw(sid).rpc.model.getCurrent());
  // (b) queue then Stop
  f = evs.length;
  await turn(sid, 'Count from 1 to 60, one number per line, nothing else.', async () => {
    const r = await ad.setModel(sid, { model: 'auto', contextTier: 'long' });
    note('(b) setModel during turn', r);
    await sleep(700);
    note('(b) pending before Stop', await pend());
    await ad.interrupt(sid);
    note('(b) pending right after Stop', await pend());
    note('(b) current right after Stop', await ad.raw(sid).rpc.model.getCurrent());
  });
  note('(b) events', keep(f));
  note('(b) pending when idle', await pend());
  note('(b) current when idle', await ad.raw(sid).rpc.model.getCurrent());
  f = evs.length;
  await turn(sid, 'Reply with only the word ok.', async () => undefined);
  note('(b) events of the next prompt', keep(f));
  note('(b) current after next prompt', await ad.raw(sid).rpc.model.getCurrent());
  const usage = evs.filter((e) => e.type === 'assistant.usage').reduce((s, e) => s + Number(((e.data as { copilotUsage?: { totalNanoAiu?: number } }).copilotUsage?.totalNanoAiu) ?? 0), 0) / 1e9;
  note('credits from assistant.usage', usage);
  note('restore', await ad.raw(sid).rpc.model.switchTo({ modelId: 'auto', autoTier: 'efficiency', contextTier: 'default', requireAvailable: true, source: 'model_picker' }));
  await ad.stop(sid);
  await (await ad.c()).deleteSession(sid).catch(() => undefined);
  fs.writeFileSync(out, JSON.stringify({ provenance: 'real', capturedAt: new Date().toISOString().slice(0, 10), spentCredits: usage, log }, null, 2));
  await (await ad.c()).stop();
}
main().catch(async (e) => { console.error('FAILED', String(e instanceof Error ? e.message : e).slice(0, 300)); fs.writeFileSync(out + '.partial', JSON.stringify({ log }, null, 2)); try { await (await ad.c()).stop(); } catch { /* ignore */ } process.exit(1); });
