/**
 * Brain view surfaces (spec 106 FR-021, FR-080, FR-085, FR-086): ONE formatter per surface of FR-085's table, from a step of
 * `brainstate.ts`. The masking table lives here only: no view formats a step's text itself.
 *
 * Masking is `redact.ts`'s own, passed in as `ctx.mask` (never a second set of rules). The state already holds masked text; every
 * formatter masks its result AGAIN (idempotent), so a surface stays safe when handed a step that was not masked (FR-086 feeds them
 * such steps). Screen share (FR-080): `ctx.sharing` makes every formatter return the tool word and state only, never text, a path or a cost.
 * Pure: no DOM, no Node, no clock (time is passed in).
 */
import { GLYPHS, baseName, currentStep, loopText, maskText } from './brainstate';
import type { BrainMask, BrainState, BrainStep } from './brainstate';

export type Surface = 'office' | 'card' | 'front' | 'transcript' | 'turnmap' | 'export' | 'share';
export interface SurfaceCtx {
  mask: BrainMask;
  /** The agent's folder (masked or not): turn map and export show paths relative to it. */
  folder?: string;
  /** Screen share is on (FR-080). */
  sharing?: boolean;
  /** The injected clock, for a running step's age. */
  now?: number;
}

/** FR-080: text is replaced by placeholders, never blurred. */
export const SHARE_PLACEHOLDER = '[hidden while sharing]';
export const SHARE_SHORT = '[hidden]';
export const SHARE_COST = 'cost hidden while sharing';
/** FR-081: what a disabled answer control says. */
export const STOP_SHARING_TO_ANSWER = 'Stop sharing to answer';

const PREVIEW_CARD = 120;
const NAME_LEN = 40;

/** The masked text of any string, once more (FR-021). Not exported as a second mask: it only composes redact's functions. */
const clean = (ctx: SurfaceCtx, s: unknown): string => maskText(ctx.mask, s);
/** A step's target masked by its own kind (FR-021): a command through maskSecretCommand, a URL through maskSecretUrl, then the common mask. */
function cleanTarget(st: BrainStep, ctx: SurfaceCtx): string {
  const m = ctx.mask;
  let t = st.target;
  try {
    if (st.targetKind === 'command') t = m.maskSecretCommand(t);
    else if (st.targetKind === 'url') t = m.maskSecretUrl(t);
    else if (st.targetKind === 'query') t = m.maskSecretCommand(t);
  } catch { t = ''; }
  return clean(ctx, t);
}
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();
const noSlash = (s: string): string => s.replace(/[\\/]/g, '');

/** A masked path relative to the folder; a path outside it shows only its file name, never an absolute path. */
export function relPath(path: string, folder: string | undefined, ctx: SurfaceCtx): string {
  const p = clean(ctx, path).replace(/\\/g, '/');
  const f = folder ? clean(ctx, folder).replace(/\\/g, '/').replace(/\/+$/, '') : '';
  if (f && p.length > f.length + 1 && p.startsWith(f + '/')) return p.slice(f.length + 1);
  return baseName(p);
}

/** Long file names cut in the middle and keep the extension (FR-024). */
export function midCut(name: string, max: number): string {
  const c = Array.from(name);
  if (c.length <= max) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : '';
  const keep = Math.max(1, max - Array.from(ext).length - 1);
  return Array.from(name).slice(0, keep).join('') + '…' + ext;
}

/** Duration of a step: "420 ms", "1.4 s", "3 min" (a running step ages with `ctx.now`). */
export function durationText(st: BrainStep, now: number | undefined): string {
  const end = st.endedAt ?? now;
  if (typeof end !== 'number' || !Number.isFinite(end)) return '';
  const ms = Math.max(0, end - st.startedAt);
  return ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} min`;
}

const stateWord = (st: BrainStep): string => st.state;

/** Screen share row: `Tool · state`, nothing else (FR-085). */
export function shareLine(st: BrainStep): string {
  return `${GLYPHS[st.glyph].word} · ${stateWord(st)}`;
}

/** Office row: glyph word, program name, state; never an argument, a path or a URL (FR-035, FR-085). */
export function officeLine(st: BrainStep, ctx: SurfaceCtx): string {
  if (ctx.sharing) return shareLine(st);
  const prog = baseName(clean(ctx, st.program || st.server)).replace(/[^A-Za-z0-9._+\-[\]]/g, '').slice(0, 24);
  return [GLYPHS[st.glyph].word, prog, stateWord(st)].filter(Boolean).join(' · ');
}

/** Office tag "Ada thought it through · Think · done" and the orb's name: the agent's name plus the office row. */
export function officeTag(name: string, st: BrainStep | undefined, ctx: SurfaceCtx): string {
  const who = noSlash(oneLine(clean(ctx, name))).slice(0, NAME_LEN);
  if (!st) return who;
  return `${who} · ${officeLine(st, ctx)}`;
}
export function orbName(name: string, ctx: SurfaceCtx): string {
  return noSlash(oneLine(clean(ctx, name))).slice(0, NAME_LEN);
}

export interface CardLines { head: string; preview: string; why: string }

/** The preview of a card: the masked command, the file's base name (no folder), the URL, the query or the MCP tool (FR-020, FR-085). */
function previewOf(st: BrainStep, ctx: SurfaceCtx): string {
  if (st.other) return `Other tool: ${st.other}`;
  if (st.glyph === 'mcp') return oneLine([st.server, st.tool].filter(Boolean).join(' · '));
  if (st.targetKind === 'file') return midCut(baseName(clean(ctx, st.target)), PREVIEW_CARD);
  if (st.targetKind === 'none') return '';
  const t = oneLine(cleanTarget(st, ctx));
  return Array.from(t).length > PREVIEW_CARD ? Array.from(t).slice(0, PREVIEW_CARD - 1).join('') + '…' : t;
}

/**
 * Docked card and In front card (FR-020): line 1 glyph, word, state, duration; line 2 the preview; line 3 "Why:" (absent when the
 * agent gave no reason, never invented). Under Screen share: the tool word and state only.
 */
export function cardLines(st: BrainStep, ctx: SurfaceCtx): CardLines {
  if (ctx.sharing) return { head: shareLine(st), preview: '', why: '' };
  const dur = durationText(st, ctx.now);
  const head = `${st.state === 'failed' ? '✗ ' : ''}${GLYPHS[st.glyph].word}${st.helper ? ' (helper)' : ''} · ${stateWord(st)}${dur ? ' · ' + dur : ''}`;
  const why = oneLine(clean(ctx, st.why));
  return { head: clean(ctx, head), preview: clean(ctx, previewOf(st, ctx)), why: why ? `Why: ${why}` : '' };
}

/** Chat transcript row: the full masked command or path, home as `~` or the folder-relative path (FR-085). */
export function transcriptText(st: BrainStep, ctx: SurfaceCtx): string {
  if (ctx.sharing) return shareLine(st);
  let t: string;
  if (st.targetKind === 'file') t = relPathOrHome(st.target, ctx);
  else t = cleanTarget(st, ctx);
  return oneLine(t);
}
function relPathOrHome(path: string, ctx: SurfaceCtx): string {
  const p = clean(ctx, path);
  const f = ctx.folder ? clean(ctx, ctx.folder).replace(/[\\/]+$/, '') : '';
  const q = p.replace(/\\/g, '/');
  const g = f.replace(/\\/g, '/');
  return g && q.length > g.length + 1 && q.startsWith(g + '/') ? q.slice(g.length + 1) : p;
}

/** The folder taken out of a command's text, so the map shows folder-relative paths. */
function relCommand(text: string, ctx: SurfaceCtx): string {
  const f = ctx.folder ? clean(ctx, ctx.folder).replace(/[\\/]+$/, '') : '';
  if (!f) return text;
  let out = text;
  for (const sep of ['/', '\\']) out = out.split(f.split(/[\\/]/).join(sep) + sep).join('');
  return out;
}

/** Turn map and export row: "1 Read · registry.ts · done" (FR-050); paths relative to the folder, never absolute (FR-085). */
export function turnMapLine(st: BrainStep, ctx: SurfaceCtx): string {
  if (ctx.sharing) return shareLine(st);
  let what = '';
  if (st.other) what = `Other tool: ${st.other}`;
  else if (st.glyph === 'mcp') what = oneLine([st.server, st.tool].filter(Boolean).join(' · '));
  else if (st.targetKind === 'file') what = midCut(relPath(st.target, ctx.folder, ctx), 80);
  else if (st.targetKind !== 'none') what = relCommand(oneLine(cleanTarget(st, ctx)), ctx);
  return clean(ctx, `${st.n} ${GLYPHS[st.glyph].word}${what ? ' · ' + what : ''} · ${stateWord(st)}`);
}
export function exportText(steps: readonly BrainStep[], ctx: SurfaceCtx): string {
  return steps.map((s) => turnMapLine(s, ctx)).join('\n');
}

/** One cell text of one surface (FR-086 checks every surface through this). */
export function formatStep(surface: Surface, st: BrainStep, ctx: SurfaceCtx): string {
  switch (surface) {
    case 'office': return officeLine(st, ctx);
    case 'card': case 'front': { const c = cardLines(st, ctx); return [c.head, c.preview, c.why].filter(Boolean).join('\n'); }
    case 'transcript': return transcriptText(st, ctx);
    case 'turnmap': case 'export': return turnMapLine(st, ctx);
    case 'share': return shareLine(st);
  }
}

/** FR-015, FR-080: "≈ $0.04", "cost unknown" (never $0), or the share wording. */
export function costText(usd: number | null, ctx: SurfaceCtx): string {
  if (ctx.sharing) return SHARE_COST;
  return typeof usd === 'number' && Number.isFinite(usd) && usd >= 0 ? `≈ $${usd.toFixed(2)}` : 'cost unknown';
}

/** The sentence under the card (FR-022). Sharing: the current tool word and state only. */
export function sentenceFor(s: BrainState, ctx: SurfaceCtx): string {
  if (!ctx.sharing) return oneLine(clean(ctx, s.sentence));
  const st = currentStep(s);
  if (s.wait) return 'You · waiting';
  if (st) return shareLine(st);
  if (s.act.kind === 'think') return 'Think · running';
  if (s.act.kind === 'reply') return 'Reply · running';
  return 'Rest · idle';
}

/** FR-043: the loop wording on every surface; sharing hides the cost. */
export function loopLine(s: BrainState, ctx: SurfaceCtx): string {
  return clean(ctx, ctx.sharing ? loopText(s, SHARE_COST) : loopText(s));
}

/** The "Waiting for the first step" card (edge case: no events yet). */
export const WAITING_CARD = 'Waiting for the first step';
