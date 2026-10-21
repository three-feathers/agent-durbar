/**
 * Dev tool, USES AI CREDITS (spec 005 T036; owner-approved 2026-10-21, about one prompt per app). Not part of `npm test`, never run
 * in CI. One real session through Durbar's own adapter asks for one small edit of `notes.txt` in a throw-away folder under the OS
 * temp folder, and records what the chat would get: the normalized `toolCall` events (phase, time, `edit` payload: only the
 * throw-away file's text) and, from the vendor stream, only event TYPES and FIELD NAMES (never values, tokens or session data).
 *
 *   node dist-scripts/scripts/edit-stream-real.js <claude|copilot|codex> <out.json>
 *
 * Every app runs in Ask first: the script approves only a `write` request that names notes.txt and denies anything else.
 * Run `claude` with every `CLAUDE*` variable unset (docs/agent-notes.md); the adapter passes `--setting-sources` and `--strict-mcp-config`.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CLAUDE_DESCRIPTOR } from '../src/adapters/claude';
import { COPILOT_DESCRIPTOR } from '../src/adapters/copilot';
import { CODEX_DESCRIPTOR } from '../src/adapters/codex';
import { ClaudeMapper } from '../src/adapters/claudeMap';
import { EventMapper } from '../src/adapters/map';
import { CodexMapper } from '../src/adapters/codexMap';
import type { AgentAdapter, AgentEvent, PermissionMode } from '../src/adapters/types';

const app = process.argv[2] as 'claude' | 'copilot' | 'codex';
const outFile = process.argv[3];
if (!['claude', 'copilot', 'codex'].includes(app) || !outFile) throw new Error('usage: edit-stream-real.js <claude|copilot|codex> <out.json>');
const mode: PermissionMode = 'ask';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
let t0 = Date.now();
const now = (): number => Date.now() - t0;

/** Vendor stream, shape only: type, sub-type and field names; string lengths for argument deltas. Never a value. */
const raw: Array<Record<string, unknown>> = [];
const keys = (o: unknown): string[] => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o as object).sort() : []);
const tap = <T extends { prototype: { map(x: unknown): void } }>(cls: T, shape: (x: any) => Record<string, unknown>): void => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const orig = cls.prototype.map;
  cls.prototype.map = function (this: unknown, x: unknown): void {
    try { raw.push({ t: now(), ...shape(x) }); } catch { /* shape only */ }
    return orig.call(this, x);
  };
};
tap(ClaudeMapper as never, (m) => {
  const ev = m?.event;
  const blk = ev?.content_block;
  return {
    type: m?.type, subtype: m?.subtype, keys: keys(m),
    ...(ev ? { event: ev.type, eventKeys: keys(ev), delta: ev.delta?.type, deltaKeys: keys(ev.delta), deltaLen: typeof ev.delta?.partial_json === 'string' ? ev.delta.partial_json.length : undefined, block: blk?.type, blockName: blk?.name, blockKeys: keys(blk) } : {}),
    ...(m?.type === 'assistant' ? { content: (m.message?.content ?? []).map((b: { type?: string; name?: string }) => `${b.type}${b.name ? ':' + b.name : ''}`) } : {}),
  };
});
tap(EventMapper as never, (e) => ({ type: e?.type, dataKeys: keys(e?.data), ...(e?.type === 'assistant.tool_call_delta' ? { toolName: e.data?.toolName, inputDeltaType: typeof e.data?.inputDelta, inputDeltaLen: typeof e.data?.inputDelta === 'string' ? e.data.inputDelta.length : undefined } : {}), ...(/^tool\./.test(String(e?.type)) ? { toolName: e.data?.toolName, argKeys: keys(e.data?.arguments) } : {}) }));
tap(CodexMapper as never, (n) => {
  const p = n?.params;
  const item = p?.item;
  const ch = Array.isArray(p?.changes) ? p.changes : Array.isArray(item?.changes) ? item.changes : undefined;
  return { method: n?.method, paramKeys: keys(p), ...(item ? { itemType: item.type, itemKeys: keys(item), itemStatus: item.status } : {}), ...(ch ? { changes: ch.length, changeKeys: keys(ch[0]), changeKind: keys(ch[0]?.kind).length ? ch[0].kind : typeof ch[0]?.kind } : {}) };
});

async function main(): Promise<void> {
  const descriptor = app === 'claude' ? CLAUDE_DESCRIPTOR : app === 'copilot' ? COPILOT_DESCRIPTOR : CODEX_DESCRIPTOR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `durbar-edit-${app}-`));
  const file = path.join(dir, 'notes.txt');
  fs.writeFileSync(file, 'hello\nsecond line\n');
  const ad: AgentAdapter = descriptor.create();
  const evs: Array<AgentEvent & { t: number }> = [];
  const perms: unknown[] = [];
  let sid = '';
  ad.onEvent((e) => {
    evs.push({ ...e, t: now() });
    // a pending request arrives on the `needs-permission` status (the `permission` event is its final answer)
    const p = e.type === 'status' && e.status === 'needs-permission' ? e.permission : undefined;
    if (p && p.state === 'pending' && sid && e.sessionId === sid) {
      // Codex names no file in its fileChange request: the open call's own edit must then name only notes.txt in the folder
      const last = [...evs].reverse().find((x) => x.type === 'toolCall' && x.phase === 'start' && x.edit) as { edit?: { files: Array<{ path: string }> } } | undefined;
      const onlyNotes = !!last?.edit?.files.length && last.edit.files.every((f) => f.path === file);
      const ok = p.kind === 'write' && (/notes\.txt/.test(p.summary) || (app === 'codex' && p.summary.trim() === 'write' && onlyNotes));
      perms.push({ t: now(), kind: p.kind, approved: ok, hasDiff: !!p.diff });
      // answered on a later tick, like the UI: the broker emits the request before it starts waiting for the answer
      setTimeout(() => ad.resolvePermission?.(sid, p.requestId, ok), 200);
    }
  });
  sid = await ad.start({ workspace: dir, permissionMode: mode, ...(app === 'claude' ? { model: 'haiku', maxAiCredits: 0.25 } : app === 'copilot' ? { model: 'auto', maxAiCredits: 30 } : {}), quiet: true });
  t0 = Date.now();
  await ad.send(sid, { text: "In notes.txt change 'hello' to 'hello world' and add a last line 'done'. Use your file edit tool, not a shell command. Then reply with only the word ok." });
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline && !evs.some((e) => e.type === 'status' && (e.status === 'idle' || e.status === 'error') && e.sessionId === sid)) await sleep(250);
  await sleep(1500);
  const tools = evs.filter((e) => e.type === 'toolCall').map((e) => {
    const c = e as AgentEvent & { t: number; callId: string; tool: string; phase: string; args?: unknown; edit?: unknown; output?: string };
    return { t: c.t, callId: c.callId.slice(-8), tool: c.tool, phase: c.phase, argKeys: keys(c.args), edit: c.edit };
  });
  const usage = evs.filter((e) => e.type === 'usage') as Array<{ costUsd?: number; nanoAiu?: number; inputTokens?: number; outputTokens?: number }>;
  const status = evs.filter((e) => e.type === 'status').map((e) => ({ t: e.t, status: (e as { status?: string }).status, intent: String((e as { intent?: string }).intent ?? '').slice(0, 160) }));
  const result = {
    app, mode, date: new Date().toISOString(),
    fileAfter: fs.readFileSync(file, 'utf8'),
    answer: evs.filter((e) => e.type === 'output' && (e as { final?: boolean }).final).map((e) => String((e as { text?: string }).text ?? '')).join(' ').slice(0, 120),
    usage: { costUsd: usage.reduce((s, u) => s + (u.costUsd ?? 0), 0), aiu: usage.reduce((s, u) => s + (u.nanoAiu ?? 0), 0) / 1e9, in: usage.reduce((s, u) => s + (u.inputTokens ?? 0), 0), out: usage.reduce((s, u) => s + (u.outputTokens ?? 0), 0) },
    status, perms, tools,
    eventTypes: [...new Set(evs.map((e) => e.type))],
    raw,
  };
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
  await ad.stop(sid).catch(() => undefined);
  // the throw-away session is removed where the adapter can (Copilot), or its transcript file (Claude Code, only this id)
  const del = (ad as unknown as { deleteSession?: (s: string) => Promise<void> }).deleteSession;
  if (app === 'copilot' && del) await del.call(ad, sid).catch(() => undefined);
  if (app === 'claude') {
    const projects = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'projects');
    for (const d of fs.existsSync(projects) ? fs.readdirSync(projects) : []) fs.rmSync(path.join(projects, d, `${sid}.jsonl`), { force: true });
  }
  await ad.dispose().catch(() => undefined);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`done ${app}: ${tools.length} toolCall events, ${raw.length} raw events -> ${outFile}`);
}
main().then(() => process.exit(0), (e) => { console.error('FAILED', String(e instanceof Error ? e.message : e).slice(0, 300)); process.exit(1); });
