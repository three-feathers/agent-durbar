/**
 * Dev tool, USES AI CREDITS (spec 030 T041, T044, T045; spec 013 T006). Owner: "activated copilot pro plan, you can test things you
 * were stuck with earlier" (2026-10-20). Not part of `npm test`, never run in CI. The real `CopilotAdapter` (its setModel and start
 * code is what is tested), read-only sessions in an empty throw-away folder, a 30-credit cap on each session, and a hard CEILING on
 * the credits the calls report (`assistant.usage` nano-AIU), checked before every prompt.
 *
 *   npx tsx scripts/paid-models-real.ts switch <out.json> [ceiling]   T041 + 013 C8 + T044: tiny prompts, about 4 in all
 *   npx tsx scripts/paid-models-real.ts confirm <out.json> [ceiling]  T045: one ~200k-token filler prompt, then a switch to a smaller window
 *   npx tsx scripts/paid-models-real.ts accept <out.json> [ceiling]   T045: the same fill, then "Compact and switch" through the adapter
 *   npx tsx scripts/paid-models-real.ts cap <out.json> [ceiling]      013 C9: a 30-credit session cap reached for real (claude-haiku-4.5,
 *                                                                     ~60k-token fresh fillers, at most 10 prompts; about 30-40 AIU)
 *   npx tsx scripts/paid-models-real.ts capresume <out.json> <ceiling> <sessionId> [cap] [model]   resume a capped session, tiny prompts until
 *                                                                     the runtime refuses (at most 2)
 *
 * Raw runtime events are kept with strings cut at 160 characters; logins, hosts and tokens are dropped.
 */
import { CopilotAdapter } from '../src/adapters/copilot';
import type { AgentEvent } from '../src/adapters/types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mode = process.argv[2];
const out = process.argv[3];
const CEILING = Number(process.argv[4] ?? 10);
if (!['switch', 'confirm', 'accept', 'cap', 'capresume'].includes(mode) || !out) throw new Error('usage: paid-models-real.ts switch|confirm|accept|cap <out.json> [ceiling]');
const CHEAP = 'gpt-6-luna'; // in 10 / out 50, long-context tier listed
const OTHER = 'mai-code-1.1-flash'; // in 20 / out 120, prompt window 128k (smaller than gpt-6-luna's 272k)

type Raw = { type: string; data?: Record<string, unknown> };
const cut = (v: unknown): unknown =>
  typeof v === 'string' ? (v.length > 160 ? v.slice(0, 160) + '…' : v) : Array.isArray(v) ? v.slice(0, 8).map(cut) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !/^login$|hmac|^host$|authorization|apiCallId|usageId|token$/i.test(k) || /tokens?$/i.test(k)).map(([k, x]) => [k, cut(x)])) : v;

class P extends CopilotAdapter {
  raw(sid: string): any { return (this as any).sessions.get(sid)?.session; } // eslint-disable-line @typescript-eslint/no-explicit-any
}
const ad = new P();
const norm: AgentEvent[] = [];
ad.onEvent((e) => norm.push(e));
const rawEvents: Raw[] = [];
const log: Array<Record<string, unknown>> = [];
let step = '';
const note = (k: string, v: unknown): void => { log.push({ step, k, v: cut(v) }); console.log(`[${step}] ${k}: ${JSON.stringify(cut(v)).slice(0, 400)}`); };
const spent = (): number => Math.round(norm.reduce((s, e) => s + (e.type === 'usage' ? (e as { nanoAiu?: number }).nanoAiu ?? 0 : 0), 0) / 1e7) / 100;
const save = (extra: Record<string, unknown> = {}): void => fs.writeFileSync(out, JSON.stringify({ mode, spentAiu: spent(), ...extra, log }, null, 2));
function guard(label: string): void {
  step = label;
  note('spent so far (AIU, from usage events)', spent());
  if (spent() > CEILING) { save({ aborted: 'ceiling' }); throw new Error(`ceiling ${CEILING} reached`); }
}
function watch(sid: string): void { ad.raw(sid).on((e: Raw) => { rawEvents.push({ type: e.type, data: cut(e.data) as Record<string, unknown> }); }); }
async function prompt(sid: string, text: string): Promise<Raw[]> {
  const from = rawEvents.length;
  const nFrom = norm.length;
  const stopped = (): boolean => rawEvents.slice(from).some((e) => e.type === 'session.idle') || norm.slice(nFrom).some((e) => e.type === 'limit' && (e as { phase?: string }).phase === 'exhausted');
  const done = new Promise<void>((resolve) => { const t = setInterval(() => { if (stopped()) { clearInterval(t); resolve(); } }, 200); setTimeout(() => { clearInterval(t); resolve(); }, 180000); });
  await ad.send(sid, { text });
  await done;
  return rawEvents.slice(from);
}
const answer = (evs: Raw[]): string => evs.filter((e) => e.type === 'assistant.message').map((e) => String((e.data as { content?: string }).content ?? '')).join(' ').slice(0, 120);
const keep = (evs: Raw[]): Raw[] => evs.filter((e) => /model_change|compaction|usage|abort|error|warning|limit/.test(e.type));
const ctx = async (sid: string): Promise<unknown> => ad.raw(sid).rpc.metadata.contextInfo({}).catch((e: Error) => ({ error: e.message }));
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const current = async (sid: string): Promise<unknown> => ad.raw(sid).rpc.model.getCurrent().catch((e: Error) => ({ error: e.message }));

async function switchChecks(folder: string): Promise<void> {
  step = 'create';
  const sid = await ad.start({ workspace: folder, model: CHEAP, reasoningEffort: 'low', maxAiCredits: 30, quiet: true });
  watch(sid);
  note('current', await current(sid));
  guard('T041 p1 (cheap model, effort low)');
  let evs = await prompt(sid, 'Remember the code word BANANA. Reply with only the word ok.');
  note('answer', answer(evs)); note('events', keep(evs));
  note('contextInfo before switch', await ctx(sid));

  step = 'T041 switch';
  const from = rawEvents.length;
  note('setModel -> ' + OTHER + ' (effort medium)', await ad.setModel(sid, { model: OTHER, effort: 'medium' }));
  note('current after switch', await current(sid));
  note('contextInfo right after switch (before any call)', await ctx(sid));
  note('switch events', keep(rawEvents.slice(from)));
  guard('T041 p2 (other model)');
  evs = await prompt(sid, 'What was the code word? Reply with only that word.');
  note('answer (history kept across the switch?)', answer(evs)); note('events', keep(evs));
  note('contextInfo after first call on the new model', await ctx(sid));

  step = '013 C8 effort';
  note('setModel -> ' + CHEAP + ' effort high', await ad.setModel(sid, { model: CHEAP, effort: 'high' }));
  note('current', await current(sid));
  guard('013 C8 p3 (effort high)');
  evs = await prompt(sid, 'Reply with only the word ok.');
  note('answer', answer(evs)); note('events', keep(evs));

  step = 'T044 long tier';
  const f2 = rawEvents.length;
  note('setModel -> ' + CHEAP + ' long tier', await ad.setModel(sid, { model: CHEAP, effort: 'low', contextTier: 'long' }));
  note('current', await current(sid));
  note('contextInfo after tier switch', await ctx(sid));
  note('tier events', keep(rawEvents.slice(f2)));
  guard('T044 p4 (long tier)');
  evs = await prompt(sid, 'Reply with only the word ok.');
  note('answer', answer(evs)); note('events', keep(evs));
  note('contextInfo after a call on the long tier', await ctx(sid));
  note('back to default tier', await ad.setModel(sid, { model: CHEAP, effort: 'low', contextTier: 'default' }));
  note('current', await current(sid));
  note('normalized model/context/usage events', norm.filter((e) => e.type === 'model' || e.type === 'context' || e.type === 'usage'));
  await ad.stop(sid);
}

async function confirmChecks(folder: string): Promise<void> {
  step = 'create';
  const sid = await ad.start({ workspace: folder, model: CHEAP, reasoningEffort: 'low', maxAiCredits: 30, quiet: true });
  watch(sid);
  // about 140k tokens: more than OTHER's 128k prompt window, less than CHEAP's 272k default tier
  const lines: string[] = [];
  for (let i = 0; i < 11000; i++) lines.push(`row ${i}: amber cobalt delta ${i * 7} ember fjord ${i % 97}`);
  const filler = 'Filler for a test; do not analyse it. Reply with only the word ok.\n' + lines.join('\n');
  note('filler characters', filler.length);
  guard('T045 fill');
  const evs = await prompt(sid, filler);
  note('answer', answer(evs)); note('events', keep(evs));
  note('contextInfo after fill', await ctx(sid));

  step = 'T045 switch to smaller window';
  const r = await ad.setModel(sid, { model: OTHER });
  note('setModel -> ' + OTHER + ' (adapter)', r);
  note('current', await current(sid));
  const params = { modelId: OTHER, requireAvailable: true, runCompactionPreflight: true, source: 'model_picker' };
  note('raw switchTo (preflight, no decision)', await ad.raw(sid).rpc.model.switchTo(params).catch((e: Error) => ({ error: e.message })));
  // the allowed values are not documented: an invalid one should make the runtime name them
  note('raw switchTo compactionDecision=__invalid__', await ad.raw(sid).rpc.model.switchTo({ ...params, compactionDecision: '__invalid__' }).catch((e: Error) => ({ error: e.message })));
  note('current (unchanged?)', await current(sid));
  note('decline through the adapter', await ad.setModel(sid, { model: OTHER, confirm: { compaction: 'decline' } }));
  note('contextInfo at end', await ctx(sid));
  await ad.stop(sid);
}

async function fill(sid: string): Promise<void> {
  const lines: string[] = [];
  for (let i = 0; i < 11000; i++) lines.push(`row ${i}: amber cobalt delta ${i * 7} ember fjord ${i % 97}`);
  guard('fill');
  const evs = await prompt(sid, 'Filler for a test; do not analyse it. The code word is KIWI. Reply with only the word ok.\n' + lines.join('\n'));
  note('answer', answer(evs));
  note('contextInfo after fill', await ctx(sid));
}

async function acceptChecks(folder: string): Promise<void> {
  step = 'create';
  const sid = await ad.start({ workspace: folder, model: CHEAP, reasoningEffort: 'low', maxAiCredits: 30, quiet: true });
  watch(sid);
  await fill(sid);
  step = 'T045 compact and switch';
  const from = rawEvents.length;
  note('setModel -> ' + OTHER + ' confirm accept (adapter)', await ad.setModel(sid, { model: OTHER, confirm: { compaction: 'accept' } }));
  note('current', await current(sid));
  note('events (compaction, model_change)', keep(rawEvents.slice(from)));
  note('contextInfo after', await ctx(sid));
  guard('T045 after switch');
  const evs = await prompt(sid, 'What was the code word in the filler? Reply with only that word.');
  note('answer (kept through compaction?)', answer(evs)); note('events', keep(evs));
  await ad.stop(sid);
}

async function capChecks(folder: string): Promise<void> {
  step = 'create';
  const sid = await ad.start({ workspace: folder, model: 'claude-haiku-4.5', maxAiCredits: 30, quiet: true });
  watch(sid);
  for (let n = 0; n < 10; n++) {
    guard(`C9 prompt ${n + 1}`);
    const lines: string[] = [];
    for (let i = 0; i < 4700; i++) lines.push(`batch ${n} row ${i}: ${((i + 1) * (n + 13) * 2654435761 % 1e9).toString(36)} ${(i * 31 + n).toString(16)} ${(i * 7919) % 10007}`);
    const from = rawEvents.length;
    const evs = await prompt(sid, 'Filler for a test; do not analyse it. Reply with only the word ok.\n' + lines.join('\n'));
    note('answer', answer(evs));
    note('events', keep(evs).map((e) => (e.type === 'assistant.usage' ? { type: e.type, inputTokens: e.data?.inputTokens, cacheReadTokens: e.data?.cacheReadTokens } : e)));
    const limit = norm.filter((e) => e.type === 'limit' || (e.type === 'status' && /limit|cap/i.test(JSON.stringify(e))));
    note('normalized limit/status so far', limit.slice(-3));
    if (limit.length || keep(rawEvents.slice(from)).some((e) => /limit|error/.test(e.type))) {
      note('cap reached after prompts', n + 1);
      const ex = norm.filter((e) => e.type === 'limit' && (e as { phase?: string }).phase === 'exhausted').pop() as { requestId?: string } | undefined;
      if (ex?.requestId) {
        // what the window's "Stop here" answer does: cancel, nothing more is spent
        await ad.resolveLimit(sid, ex.requestId, { kind: 'cancel' }).catch((e: Error) => note('resolveLimit error', e.message));
        await sleep(3000);
        note('after cancel: runtime events', keep(rawEvents.slice(from)).slice(-4));
        note('after cancel: normalized', norm.filter((e) => e.type === 'limit' || e.type === 'status').slice(-4));
      }
      break;
    }
  }
  await ad.stop(sid);
}

async function capResume(folder: string, sessionId: string): Promise<void> {
  step = 'C9 resume past the cap';
  const cap = Number(process.argv[6] ?? 30);
  const sid = await ad.start({ workspace: folder, sessionId, model: process.argv[7] ?? 'claude-haiku-4.5', maxAiCredits: cap, quiet: true });
  watch(sid);
  note('same session, cap', [sid === sessionId, cap]);
  for (let n = 0; n < 2 && !norm.some((e) => e.type === 'limit'); n++) {
    guard(`C9 tiny prompt ${n + 1}`);
    const evs = await prompt(sid, 'Reply with only the word ok.');
    note('answer', answer(evs)); note('events', keep(evs).map((e) => (e.type === 'session.usage_checkpoint' ? { type: e.type, totalNanoAiu: e.data?.totalNanoAiu } : e.type === 'assistant.usage' ? { type: e.type, cacheReadTokens: e.data?.cacheReadTokens, inputTokens: e.data?.inputTokens } : e)));
  }
  const ex = norm.filter((e) => e.type === 'limit').pop() as { requestId?: string; phase?: string } | undefined;
  note('normalized limit events', norm.filter((e) => e.type === 'limit'));
  if (ex?.phase === 'exhausted' && ex.requestId) {
    await ad.resolveLimit(sid, ex.requestId, { kind: 'cancel' }).catch((e: Error) => note('resolveLimit error', e.message));
    await sleep(3000);
    note('after cancel: normalized', norm.filter((e) => e.type === 'limit' || e.type === 'status').slice(-4));
  }
  await ad.stop(sid);
}

async function main(): Promise<void> {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-paid-'));
  try {
    if (mode === 'switch') await switchChecks(folder); else if (mode === 'confirm') await confirmChecks(folder); else if (mode === 'accept') await acceptChecks(folder); else if (mode === 'cap') await capChecks(folder); else await capResume(folder, String(process.argv[5]));
    step = 'end';
    note('total AIU from usage events', spent());
    save();
  } finally {
    await ad.dispose().catch(() => undefined);
    fs.rmSync(folder, { recursive: true, force: true });
  }
}
main().then(() => process.exit(0), (e) => { console.error('paid-models-real:', e instanceof Error ? e.message : e); save({ error: String(e) }); process.exit(1); });
