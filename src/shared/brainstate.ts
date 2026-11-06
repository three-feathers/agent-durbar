/**
 * Brain view state (spec 106 FR-001..FR-008, FR-012, FR-020..FR-022, FR-040..FR-042): the pure reducer that turns ONE agent's
 * normalized events into its brain state. Everything that draws or words an agent's activity (brain, card, sentence, office tag,
 * chip, rail row, Your door item) reads this one state (FR-002).
 *
 * No DOM, no timers (time is passed in), no vendor names, no imports: the compiled file loads as a page script (as redact.js does).
 * The masking functions of `redact.ts` are passed in as `mask` (FR-021): the state holds MASKED text only, so no view ever holds an
 * unmasked one. Tool output is never kept (FR-074); only the call's masked target (command, file, URL or query) and a masked reason.
 * Reads normalized `tool` strings only: unknown names get the Shell glyph worded "Other tool" (FR-012, FR-123).
 */

/** The redaction functions of `src/shared/redact.ts` (the page's `DurbarRedact`, Node tests pass the module itself). */
export interface BrainMask {
  redact(text: unknown): string;
  maskSecretCommand(command: unknown): string;
  maskSecretArgs(args: readonly string[]): string[];
  maskSecretUrl(url: unknown): string;
  maskHomePaths(text: unknown): string;
  maskTokenShapes(text: string, mask: string): string;
  /** Token characters glued to a mask go into it (a secret that arrives in pieces). */
  maskGluedTail(text: string): string;
  /** Where an unclosed private key block starts in `text`, else -1. */
  openKeyBlockStart(text: string): number;
}

export type GlyphId = 'think' | 'read' | 'edit' | 'shell' | 'web' | 'mcp' | 'you';
export type StepGlyph = 'read' | 'edit' | 'shell' | 'web' | 'mcp';
export type StepState = 'running' | 'done' | 'failed';
export type LobeId = 'frontal' | 'occipital' | 'parietal' | 'cerebellum' | 'temporal' | 'stem' | 'port';

/** FR-011: the seven glyphs. `symbol` is a label for tests and text; the renderer draws shapes (constitution V). */
export const GLYPHS: Readonly<Record<GlyphId, { word: string; lobe: LobeId; lobeWord: string; place: string; symbol: string }>> = {
  think: { word: 'Think', lobe: 'frontal', lobeWord: 'front', place: 'front', symbol: '◇' },
  read: { word: 'Read', lobe: 'occipital', lobeWord: 'back', place: 'back', symbol: '▤' },
  edit: { word: 'Edit', lobe: 'parietal', lobeWord: 'top', place: 'top', symbol: '✎' },
  shell: { word: 'Shell', lobe: 'cerebellum', lobeWord: 'cerebellum', place: 'back, low', symbol: '›_' },
  web: { word: 'Web', lobe: 'temporal', lobeWord: 'low side', place: 'low side', symbol: '◎' },
  mcp: { word: 'MCP', lobe: 'stem', lobeWord: 'stem', place: 'bottom', symbol: '⏚' },
  you: { word: 'You', lobe: 'port', lobeWord: 'front port', place: 'front, low', symbol: '●' },
};
export const STEP_GLYPHS: readonly StepGlyph[] = ['read', 'edit', 'shell', 'web', 'mcp'];

/** Bounds (FR-004, FR-006, FR-040). */
export const PAINT_MS = 250;
export const FRAME_MS = 17;
export const STEP_CAP = 400;
export const TRAIL_MAX = 24;
export const HISTORY_MAX = 20;
export const RUNS_MAX = 40;
export const PREVIEW_MAX = 200;
export const WHY_MAX = 140;
const BUF_MAX = 600;
const NAME_MAX = 40;
const FILES_MAX = 20;

/**
 * FR-012: the one tool-to-glyph table. Exact normalized names (lower case, `-` and spaces as `_`), no guessing from parts of a name:
 * `read_agent` is not a file read. Anything not listed is "Other tool" with the Shell glyph, so the ring stays seven glyphs.
 */
const TOOL_TABLE: Readonly<Record<string, GlyphId>> = (() => {
  const t: Record<string, GlyphId> = {};
  const add = (g: GlyphId, names: string): void => { for (const n of names.split(' ')) t[n] = g; };
  add('read', 'read read_file readfile view grep glob list ls list_dir list_directory cat rg find search search_code notebookread');
  add('edit', 'edit multiedit write write_file create create_file apply_patch patch edit_file str_replace str_replace_editor notebookedit filechange replace');
  add('shell', 'bash shell powershell sh run exec exec_command command commandexecution terminal read_bash write_bash stop_bash list_bash');
  add('web', 'fetch web_fetch webfetch web_search websearch fetch_url');
  add('think', 'think thinking');
  add('you', 'ask_user askuserquestion request_permission');
  return t;
})();

/** FR-012. A call with `mcpServer` is MCP; else by name; else Shell worded "Other tool". */
export function glyphOf(tool: unknown, mcpServer?: unknown): { glyph: GlyphId; other: boolean } {
  if (typeof mcpServer === 'string' && mcpServer) return { glyph: 'mcp', other: false };
  const key = typeof tool === 'string' ? tool.trim().toLowerCase().replace(/[-\s]+/g, '_') : '';
  const g = Object.prototype.hasOwnProperty.call(TOOL_TABLE, key) ? TOOL_TABLE[key] : undefined;
  return g ? { glyph: g, other: false } : { glyph: 'shell', other: true };
}

export interface BrainFile { path: string; kind: string; added: number; removed: number }
export interface BrainStep {
  /** 1-based number in its turn, counting folded steps too. */
  n: number;
  callId: string;
  glyph: GlyphId;
  word: string;
  /** Masked tool name when the glyph is the Shell glyph for an unknown tool ("Other tool: <name>"), else ''. */
  other: string;
  tool: string;
  state: StepState;
  startedAt: number;
  endedAt: number | null;
  /** A sub-agent's call (FR-007). */
  helper: boolean;
  /** Program name of a command (basename, no path) or '' (FR-085's office row shows this only). */
  program: string;
  /** MCP server name or ''. */
  server: string;
  targetKind: 'file' | 'command' | 'url' | 'query' | 'none';
  /** Masked: the command, the file path (home as `~`), the URL or the query. Cut. */
  target: string;
  /** FR-020 line 3: the agent's own latest stated reason, masked, one line; '' when it gave none (never invented). */
  why: string;
  files: BrainFile[];
  /** The turn's cost so far when this step began (for FR-042's run cost). */
  costAtStart: number;
}
export type TurnResult = 'done' | 'error' | 'stopped';
export interface BrainTurn {
  n: number;
  startedAt: number;
  endedAt: number | null;
  result: TurnResult | null;
  steps: BrainStep[];
  /** Steps folded out of `steps` past STEP_CAP ("12 earlier", FR-006). */
  folded: number;
  /** Every step of the turn, drawn or not. */
  total: number;
  /** Events that arrived after the turn ended and joined it. */
  late: number;
}
export interface TurnSummary { n: number; startedAt: number; endedAt: number; result: TurnResult; steps: number; glyphs: StepGlyph[]; costUsd: number | null }
export type WaitKind = 'permission' | 'question' | 'limit';
export interface Act { kind: 'rest' | 'tool' | 'think' | 'reply'; glyph: GlyphId | null; stepN: number | null }
/** `half` counts the loop's steps since it was set (pairs = half / 2, no cap); `costAt` is the turn cost when its first step began. */
export interface LoopInfo { a: StepGlyph; b: StepGlyph; pairs: number; firstN: number; costUsd: number | null; half: number; costAt: number }
interface Run { glyph: StepGlyph; failed: boolean; n: number; costAtStart: number }

export interface BrainState {
  name: string;
  turn: BrainTurn | null;
  turnNo: number;
  /** Last HISTORY_MAX ended turns (FR-006). */
  history: TurnSummary[];
  /** Session counts per step glyph and in total: counts only, no content (FR-074). */
  counts: Record<StepGlyph, number>;
  stepsTotal: number;
  act: Act;
  wait: WaitKind | null;
  loop: LoopInfo | null;
  runs: Run[];
  /** An unclosed private key block is being streamed: deltas are dropped until its END marker (F1). */
  inKeyBlock: boolean;
  /** Masked tail of the latest thinking or reply text: the source of "Why:" (never raw). */
  buf: string;
  /** Cost of the current turn from usage events (USD estimate); `costKnown` false = "cost unknown", never 0 (FR-015). */
  turnCost: number;
  costKnown: boolean;
  /** When the displayed step last changed: FR-003's order is measured from here. */
  changedAt: number;
  /** FR-004: `rev` counts visible changes; `paintedRev` and `paintedAt` say what the views last showed; `burstStep` is the step the burst last showed. */
  rev: number;
  paintedRev: number;
  paintedAt: number;
  burstStep: number;
  /** Lobes the ended turn used, for the honest bloom (FR-051); [] while a turn runs. */
  bloom: LobeId[];
  sentence: string;
}

/** Fixed sentence phrases per glyph: [running, done, failed] (FR-022). Never model text. */
const PHRASE: Readonly<Record<StepGlyph, readonly [string, string, string]>> = {
  read: ['is reading', 'read', 'could not read'],
  edit: ['is editing', 'edited', 'could not edit'],
  shell: ['is running', 'ran', 'could not run'],
  web: ['is searching the web', 'searched the web', 'could not reach the web'],
  mcp: ['is using', 'used', 'could not use'],
};
const WAIT_PHRASE: Readonly<Record<WaitKind, string>> = {
  permission: 'needs your OK',
  question: 'has a question for you',
  limit: 'is waiting at the credit limit',
};

type Ev = { type?: unknown; [k: string]: unknown };
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

/** Fail closed: a missing or throwing mask yields no text at all, never raw text. */
function safe(fn: (() => string) | undefined): string {
  try { const r = fn ? fn() : ''; return typeof r === 'string' ? r : ''; } catch { return ''; }
}
/** Bidi override and isolate characters can reorder what a line shows (F7): none of them is kept in any text. */
export const stripBidi = (s: string): string => s.replace(/[\u202A-\u202E\u2066-\u2069]/g, '');
/** FR-021: every text goes through redact (env values and shapes), home paths and token shapes. Exported for the surface formatters' tests. */
export function maskText(mask: BrainMask, text: unknown): string {
  return stripBidi(safe(() => mask.maskTokenShapes(mask.maskHomePaths(mask.redact(stripBidi(typeof text === 'string' ? text : text == null ? '' : String(text)))), '[redacted]')));
}
const cutTo = (s: string, max: number): string => {
  const one = s.replace(/\s+/g, ' ').trim();
  const c = Array.from(one);
  return c.length <= max ? one : c.slice(0, max - 1).join('').trimEnd() + '…';
};

export function initBrain(name: string, mask: BrainMask): BrainState {
  const s: BrainState = {
    name: cutTo(maskText(mask, name), NAME_MAX) || 'Agent', turn: null, turnNo: 0, history: [], counts: { read: 0, edit: 0, shell: 0, web: 0, mcp: 0 }, stepsTotal: 0,
    act: { kind: 'rest', glyph: null, stepN: null }, wait: null, loop: null, runs: [], inKeyBlock: false, buf: '', turnCost: 0, costKnown: false, changedAt: 0, rev: 0, paintedRev: -1, paintedAt: -Infinity, burstStep: 0, bloom: [], sentence: '',
  };
  s.sentence = sentenceOf(s);
  return s;
}

/* ---------- targets (what a call works on), masked ---------- */

const CMD_KEYS = ['command', 'cmd', 'script', 'input'];
const PATH_KEYS = ['path', 'file_path', 'filePath', 'file', 'filename', 'filepath', 'target_file', 'notebook_path'];
const URL_KEYS = ['url', 'uri'];
const QUERY_KEYS = ['query', 'pattern', 'q', 'search'];

function pickString(args: unknown, keys: readonly string[]): string | string[] {
  if (typeof args === 'string') return args;
  if (Array.isArray(args) && args.every((x) => typeof x === 'string')) return args as string[];
  const o = obj(args);
  if (!o) return '';
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v) return v;
    if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string')) return v as string[];
  }
  return '';
}
const asText = (v: string | string[], mask: BrainMask): string => (Array.isArray(v) ? safe(() => mask.maskSecretArgs(v).join(' ')) : v);

/** The program of a masked command: its first word without leading `VAR=value`, a path or quotes. Letters, digits and `._+-[]` only. */
export function programOf(maskedCommand: string): string {
  const words = maskedCommand.trim().split(/\s+/);
  let i = 0;
  while (i < words.length - 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++;
  let w = (words[i] || '').replace(/^['"(]+|['"]+$/g, '');
  w = w.slice(Math.max(w.lastIndexOf('/'), w.lastIndexOf('\\')) + 1);
  return w.replace(/[^A-Za-z0-9._+\-[\]]/g, '').slice(0, 24);
}

interface Target { targetKind: BrainStep['targetKind']; target: string; program: string; files: BrainFile[] }
function targetOf(ev: Ev, glyph: GlyphId, mask: BrainMask): Target {
  const none: Target = { targetKind: 'none', target: '', program: '', files: [] };
  const edit = obj(ev.edit);
  const efiles = Array.isArray(edit?.files) ? (edit!.files as unknown[]).slice(0, FILES_MAX) : [];
  const files: BrainFile[] = [];
  for (const f of efiles) {
    const o = obj(f);
    if (!o || typeof o.path !== 'string') continue;
    files.push({ path: cutTo(maskText(mask, o.path), PREVIEW_MAX), kind: str(o.kind) || 'edit', added: num(o.added), removed: num(o.removed) });
  }
  if (files.length) return { targetKind: 'file', target: files[0].path, program: '', files };
  const args = ev.args;
  if (glyph === 'shell') {
    const c = asText(pickString(args, CMD_KEYS), mask);
    if (!c) return none;
    const m = maskText(mask, safe(() => mask.maskSecretCommand(c)));
    return { targetKind: 'command', target: cutTo(m, PREVIEW_MAX), program: programOf(m), files };
  }
  if (glyph === 'web') {
    const u = asText(pickString(args, URL_KEYS), mask);
    if (u) return { targetKind: 'url', target: cutTo(maskText(mask, safe(() => mask.maskSecretUrl(u))), PREVIEW_MAX), program: '', files };
  }
  const p = asText(pickString(args, PATH_KEYS), mask);
  if (p && glyph !== 'web') return { targetKind: 'file', target: cutTo(maskText(mask, p), PREVIEW_MAX), program: '', files };
  const q = asText(pickString(args, QUERY_KEYS), mask);
  // F5: a query or an Other tool's target can hold `password=…` or a flag: the command mask runs on it too
  if (q) return { targetKind: 'query', target: cutTo(maskText(mask, safe(() => mask.maskSecretCommand(q))), PREVIEW_MAX), program: '', files };
  return none;
}

/* ---------- the reducer ---------- */

/** The newest whole sentence of a masked text; a fragment only when there is no whole one. */
function lastSentence(masked: string): string {
  const parts = masked.replace(/```[\s\S]*?(```|$)/g, ' ').split(/(?<=[.!?…])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return '';
  const done = parts.filter((p) => /[.!?…]$/.test(p));
  return cutTo((done.length ? done[done.length - 1] : parts[parts.length - 1]).replace(/^[#>*\-\s]+/, ''), WHY_MAX);
}

const copy = (s: BrainState): BrainState => ({ ...s, counts: { ...s.counts }, history: s.history, runs: s.runs });

function startTurn(s: BrainState, now: number): void {
  if (s.turn && s.turn.endedAt === null) endTurn(s, now, 'stopped');
  s.turnNo += 1;
  s.turn = { n: s.turnNo, startedAt: now, endedAt: null, result: null, steps: [], folded: 0, total: 0, late: 0 };
  s.act = { kind: 'rest', glyph: null, stepN: null };
  s.wait = null; s.loop = null; s.runs = []; s.inKeyBlock = false; s.buf = ''; s.turnCost = 0; s.costKnown = false; s.bloom = []; s.burstStep = 0; s.changedAt = now;
}

export function usedLobes(turn: BrainTurn | null): LobeId[] {
  const out: LobeId[] = [];
  for (const st of turn ? turn.steps : []) { const l = GLYPHS[st.glyph].lobe; if (!out.includes(l)) out.push(l); }
  return out;
}

function glyphsOf(turn: BrainTurn): StepGlyph[] {
  return turn.steps.filter((x) => (STEP_GLYPHS as readonly string[]).includes(x.glyph)).slice(-TRAIL_MAX).map((x) => x.glyph as StepGlyph);
}
/** F7: a late event joined the ended turn, so its history entry follows (step count, glyphs, cost). */
function syncHistory(s: BrainState): void {
  const t = s.turn;
  if (!t || t.endedAt === null) return;
  const i = s.history.findIndex((h) => h.n === t.n);
  if (i < 0) return;
  const h = s.history.slice();
  h[i] = { ...h[i], steps: t.total, glyphs: glyphsOf(t), costUsd: s.costKnown ? s.turnCost : null };
  s.history = h;
}

function endTurn(s: BrainState, now: number, result: TurnResult): void {
  const t = s.turn;
  if (!t || t.endedAt !== null) return;
  const next: BrainTurn = { ...t, endedAt: now, result };
  s.turn = next;
  s.history = [...s.history, { n: next.n, startedAt: next.startedAt, endedAt: now, result, steps: next.total, glyphs: glyphsOf(next), costUsd: s.costKnown ? s.turnCost : null }].slice(-HISTORY_MAX);
  s.loop = null; s.wait = null; s.act = { kind: 'rest', glyph: null, stepN: null }; s.bloom = usedLobes(next); s.changedAt = now;
}

function ensureTurn(s: BrainState, now: number): BrainTurn {
  if (!s.turn) startTurn(s, now);
  return s.turn!;
}

function evalLoop(s: BrainState): void {
  const r = s.runs;
  const L = r.length;
  let k = 0;
  if (L >= 2 && r[L - 1].glyph !== r[L - 2].glyph) {
    const A = r[L - 1].glyph, B = r[L - 2].glyph;
    k = 2;
    while (k < L && r[L - 1 - k].glyph === (k % 2 === 0 ? A : B)) k++;
  }
  const cost = (costAt: number): number | null => (s.costKnown ? Math.max(0, s.turnCost - costAt) : null);
  const l = s.loop;
  if (l) {
    // F6: once set, the pair keeps its order and a running count; a repeated glyph pauses the count, it does not restart it (no RUNS_MAX cap)
    const last = r[L - 1];
    if (!last || (last.glyph !== l.a && last.glyph !== l.b)) { s.loop = null; return; } // a third tool clears it (FR-041)
    const half = L >= 2 && r[L - 2].glyph !== last.glyph ? l.half + 1 : l.half;
    s.loop = { ...l, half, pairs: Math.floor(half / 2), costUsd: cost(l.costAt) };
    return;
  }
  if (k >= 12 || (k >= 4 && r[L - 1].failed)) { // (b) 6 times whatever the results; (a) 4 steps and the last failed
    const first = r[L - k];
    s.loop = { a: first.glyph, b: r[L - k + 1].glyph, pairs: Math.floor(k / 2), firstN: first.n, costUsd: cost(first.costAtStart), half: k, costAt: first.costAtStart };
  }
}

function onTool(s: BrainState, ev: Ev, now: number, mask: BrainMask): void {
  const phase = str(ev.phase);
  if (phase !== 'start' && phase !== 'update' && phase !== 'complete' && phase !== 'failed') return;
  const given = str(ev.callId);
  const t0 = ensureTurn(s, now);
  const late = t0.endedAt !== null; // FR-005: a late event joins the ended turn, never starts one
  const turn: BrainTurn = { ...t0, steps: t0.steps.slice() };
  s.turn = turn;
  const toolName = cutTo(maskText(mask, str(ev.tool) || 'tool'), 60);
  // F7: calls without a callId never share a step by tool name: each start is its own step (key `~n`); a later event of the
  // same tool closes the newest running one of them.
  const callId = given || `~${turn.total + 1}`;
  let st: BrainStep | undefined;
  let idx = -1;
  for (let i = turn.steps.length - 1; i >= 0; i--) {
    const x = turn.steps[i];
    if (x.state !== 'running') continue;
    if (given ? x.callId === given : phase !== 'start' && x.callId.startsWith('~') && x.tool === toolName) { idx = i; st = x; break; }
  }
  if (late) turn.late += 1;
  const g = glyphOf(ev.tool, ev.mcpServer);
  if (!st) {
    if (phase === 'update') return;
    const tg = targetOf(ev, g.glyph, mask);
    const server = ev.mcpServer ? cutTo(maskText(mask, ev.mcpServer), 40) : '';
    turn.total += 1;
    st = {
      n: turn.total, callId, glyph: g.glyph, word: GLYPHS[g.glyph].word, other: g.other ? toolName : '', tool: toolName,
      state: phase === 'start' ? 'running' : phase === 'failed' ? 'failed' : 'done', startedAt: now, endedAt: phase === 'start' ? null : now,
      helper: typeof ev.agentId === 'string' && ev.agentId !== '', program: g.glyph === 'mcp' ? programOf(server) : tg.program, server, targetKind: tg.targetKind, target: tg.target,
      why: phase === 'start' && !ev.agentId ? lastSentence(s.buf) : '', files: tg.files, costAtStart: s.turnCost,
    };
    if (phase === 'start' && !ev.agentId) s.buf = '';
    turn.steps.push(st);
    if (turn.steps.length > STEP_CAP) { turn.steps.shift(); turn.folded += 1; }
    if (phase !== 'start') countAndRun(s, st, phase === 'failed', late);
    if (!late) s.act = { kind: 'tool', glyph: st.glyph, stepN: st.n };
    return;
  }
  if (phase === 'update' || phase === 'start') {
    const tg = targetOf(ev, g.glyph, mask);
    if (tg.targetKind !== 'none') turn.steps[idx] = { ...st, targetKind: tg.targetKind, target: tg.target, program: g.glyph === 'mcp' ? st.program : tg.program, files: tg.files };
    return;
  }
  const done: BrainStep = { ...st, state: phase === 'failed' ? 'failed' : 'done', endedAt: now };
  const tg = targetOf(ev, g.glyph, mask);
  if (tg.targetKind !== 'none' && st.targetKind === 'none') Object.assign(done, { targetKind: tg.targetKind, target: tg.target, program: g.glyph === 'mcp' ? st.program : tg.program, files: tg.files });
  turn.steps[idx] = done;
  countAndRun(s, done, phase === 'failed', late);
  if (!late) s.act = { kind: 'tool', glyph: done.glyph, stepN: done.n };
}

function countAndRun(s: BrainState, st: BrainStep, failed: boolean, late: boolean): void {
  if (!(STEP_GLYPHS as readonly string[]).includes(st.glyph)) return;
  const g = st.glyph as StepGlyph;
  s.counts[g] += 1; s.stepsTotal += 1;
  if (st.helper) return; // a helper's calls show and count, but cannot make its parent "loop" (FR-007, FR-041)
  s.runs = [...s.runs, { glyph: g, failed, n: st.n, costAtStart: st.costAtStart }].slice(-RUNS_MAX);
  if (!late) evalLoop(s);
}

/**
 * FR-001. `prev` is this agent's state (from `initBrain`), `ev` one normalized event, `now` the injected clock (ms), `mask` redact's
 * functions. Returns the next state; never throws, never mutates `prev`, ignores events it does not know.
 * Turns (FR-005): a `user` event starts one; the agent's `idle`, `error` or `stopped` status ends it; a `working` status after an
 * ended turn starts the next (a scheduled prompt has no `user` event).
 */
export function brainState(prev: BrainState, ev: unknown, now: number, mask: BrainMask): BrainState {
  try {
    const e = obj(ev) as Ev | undefined;
    if (!e || typeof e.type !== 'string' || !Number.isFinite(now)) return prev;
    const s = copy(prev);
    const before = viewKey(prev);
    const helper = typeof e.agentId === 'string' && e.agentId !== '';
    switch (e.type) {
      case 'user': startTurn(s, now); break;
      case 'status': {
        const st = str(e.status);
        if (st === 'idle') endTurn(s, now, 'done');
        else if (st === 'error') endTurn(s, now, 'error');
        else if (st === 'stopped') endTurn(s, now, 'stopped');
        else if (st === 'working') { if (!s.turn || s.turn.endedAt !== null) startTurn(s, now); s.wait = null; }
        else if (st === 'needs-permission') { ensureTurn(s, now); if (s.turn!.endedAt === null) s.wait = 'permission'; }
        break;
      }
      case 'thinking': case 'output': {
        if (helper) break;
        const t = ensureTurn(s, now);
        const whole = e.type === 'output' && e.final === true && typeof e.text === 'string';
        let raw = whole ? (e.text as string) : str(e.delta);
        if (whole) { s.inKeyBlock = false; s.buf = ''; }
        if (s.inKeyBlock) { // inside a private key block: nothing is kept until its END marker (F1)
          const end = /-----END[\sA-Z0-9_-]{0,100}?PRIVATE\s{1,8}KEY(?:\s{1,8}BLOCK)?-----/i.exec(raw);
          if (!end) raw = '';
          else { raw = raw.slice(end.index + end[0].length); s.inKeyBlock = false; }
        }
        if (raw) {
          // The masked tail plus the new text: a token split across deltas is whole again here. The head of a token that was already
          // masked leaves its tail glued to the mask in the next delta, which matches no shape: that tail goes into the mask (F1).
          const joined = s.buf + raw;
          let open = -1;
          try { open = mask.openKeyBlockStart(joined); } catch { open = 0; } // a failing check fails closed: treat as open
          if (open >= 0) s.inKeyBlock = true;
          s.buf = safe(() => mask.maskGluedTail(maskText(mask, joined))).slice(-BUF_MAX);
        }
        const cur = currentStep(s);
        if (t.endedAt === null && !(s.act.kind === 'tool' && cur && cur.state === 'running')) s.act = { kind: e.type === 'thinking' ? 'think' : 'reply', glyph: e.type === 'thinking' ? 'think' : null, stepN: null };
        break;
      }
      case 'toolCall': onTool(s, e, now, mask); syncHistory(s); break;
      case 'permission': {
        const p = obj(e.permission);
        if (p && p.state === 'pending') { ensureTurn(s, now); if (s.turn!.endedAt === null) s.wait = 'permission'; }
        else if (p && s.wait === 'permission') s.wait = null;
        break;
      }
      case 'question': {
        const ph = str(e.phase);
        if (ph === 'asked') { ensureTurn(s, now); if (s.turn!.endedAt === null) s.wait = 'question'; }
        else if ((ph === 'answered' || ph === 'cancelled') && s.wait === 'question') s.wait = null;
        break;
      }
      case 'limit': {
        const ph = str(e.phase);
        if (ph === 'exhausted') s.wait = 'limit'; else if (ph === 'resolved' && s.wait === 'limit') s.wait = null;
        break;
      }
      case 'usage': {
        const c = e.costUsd;
        if (typeof c === 'number' && Number.isFinite(c) && c >= 0) { s.turnCost += c; s.costKnown = true; syncHistory(s); }
        break;
      }
      default: return prev;
    }
    s.sentence = sentenceOf(s);
    if (viewKey(s) !== before) { s.rev += 1; s.changedAt = now; }
    return s;
  } catch {
    return prev;
  }
}

/* ---------- views of the state (FR-002) ---------- */

export function currentStep(s: BrainState): BrainStep | undefined {
  const n = s.act.stepN;
  return n === null || !s.turn ? undefined : s.turn.steps.find((x) => x.n === n);
}

/** FR-022: one plain line in the agent's name, from fixed phrases and the masked target's base name; never model text. */
export function sentenceOf(s: BrainState): string {
  const who = s.name;
  if (s.wait) return `${who} ${WAIT_PHRASE[s.wait]}`;
  if (s.loop) return `${who} may be looping between ${GLYPHS[s.loop.a].word} and ${GLYPHS[s.loop.b].word}`;
  const st = currentStep(s);
  if (s.act.kind === 'tool' && st && (STEP_GLYPHS as readonly string[]).includes(st.glyph)) {
    const ph = PHRASE[st.glyph as StepGlyph][st.state === 'running' ? 0 : st.state === 'done' ? 1 : 2];
    let what = '';
    if (st.glyph === 'shell') what = st.other ? 'a tool' : /\b(?:tests?|vitest|jest|pytest|mocha)\b/i.test(st.target) ? 'tests' : 'a command';
    else if (st.glyph === 'mcp') what = st.server;
    else if (st.glyph !== 'web' && st.targetKind === 'file') what = baseName(st.target);
    return `${who} ${ph}${what ? ' ' + what : ''}`;
  }
  if (s.act.kind === 'think') return `${who} is thinking`;
  if (s.act.kind === 'reply') return `${who} is writing to you`;
  if (s.turn && s.turn.endedAt !== null) return s.turn.result === 'error' ? `${who} hit an error` : s.turn.result === 'stopped' ? `${who} was stopped` : `${who} finished`;
  return s.turn ? `${who} is working` : `${who} is waiting for the first step`;
}

/** The last path segment (either separator). Used for the card's file name and the sentence. */
export function baseName(p: string): string {
  const t = p.replace(/[\\/]+$/, '');
  return t.slice(Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\')) + 1) || t;
}

/** FR-040: the last TRAIL_MAX steps' lobes in order (all steps are counted in `turn.total`). */
export function trailOf(s: BrainState): { n: number; glyph: GlyphId; lobe: LobeId; state: StepState }[] {
  return (s.turn ? s.turn.steps : []).slice(-TRAIL_MAX).map((x) => ({ n: x.n, glyph: x.glyph, lobe: GLYPHS[x.glyph].lobe, state: x.state }));
}

/** FR-042: "looping? Edit ↔ Shell · 3 times · ≈ $0.08"; '' when not looping. */
export function loopText(s: BrainState, costWords?: string): string {
  const l = s.loop;
  if (!l) return '';
  const cost = costWords ?? (l.costUsd === null ? 'cost unknown' : `≈ $${l.costUsd.toFixed(2)}`);
  return `looping? ${GLYPHS[l.a].word} ↔ ${GLYPHS[l.b].word} · ${l.pairs} ${l.pairs === 1 ? 'time' : 'times'} · ${cost}`;
}

/* ---------- order and coalescing (FR-003, FR-004) ---------- */

/** What the views show, as one string: a change in it is a visible change (FR-004's `rev`, FR-003's `changedAt`). */
function viewKey(s: BrainState): string {
  const cur = currentStep(s);
  return [s.act.kind, s.act.stepN, cur ? cur.state : '', s.wait, s.loop ? `${s.loop.a}${s.loop.b}${s.loop.pairs}` : '', s.turn ? `${s.turn.n}.${s.turn.total}.${s.turn.endedAt === null ? 'o' : s.turn.result}` : '', s.sentence].join('|');
}
/** FR-004: at most one visible change per PAINT_MS; steps between two paints still joined the trail and the counts, only the newest is drawn. */
export function shouldPaint(s: BrainState, now: number): boolean {
  return s.rev !== s.paintedRev && now - s.paintedAt >= PAINT_MS;
}
/** Records a paint: only the newest step is the burst. */
export function markPainted(s: BrainState, now: number): BrainState {
  return { ...s, paintedRev: s.rev, paintedAt: now, burstStep: s.act.stepN ?? s.burstStep };
}
/** FR-003: burst first, the card one frame later at the earliest, the sentence after the card; Still shows all in one frame, in this DOM order. */
export const REVEAL_ORDER = ['burst', 'card', 'sentence'] as const;
export function revealStages(changedAt: number, now: number, still: boolean): { burst: boolean; card: boolean; sentence: boolean } {
  if (still) return { burst: true, card: true, sentence: true };
  const d = now - changedAt;
  return { burst: d >= 0, card: d >= FRAME_MS, sentence: d >= 2 * FRAME_MS };
}
