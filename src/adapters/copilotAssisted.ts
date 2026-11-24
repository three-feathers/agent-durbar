/**
 * Spec 003 FR-120..FR-133 (issue 2105): Copilot's assisted approvals inside Ask first, the pure part. Only Copilot's adapter imports this; it
 * reads the runtime's request shapes (`assistedApproval`, `managedApprovalRequired`) and gives the broker vendor-free fields
 * (`PermissionLike.appReview`, `appReviewNote`). No SDK import, no I/O beyond loading the lookalike module once.
 * `read:` `@github/copilot-sdk` 1.0.24 / runtime 1.0.101 (`session-events.d.ts` `PermissionAssistedApproval`, `types.d.ts`); nothing run.
 */
import * as path from 'path';

/** The runtime's permission modes (`session.rpc.permissions.setMode`); Durbar only ever asks for `manual` or `assisted`, never `allow-all`. */
export type CopilotPermMode = 'manual' | 'assisted';

/** Prompt kinds whose `promptRequest.managedApprovalRequired` can clear the raw marker after an assisted approval (`read:` SDK `types.d.ts`). */
const CLEARABLE_KINDS: ReadonlySet<string> = new Set(['commands', 'read', 'write', 'url', 'workflow']);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (o: unknown, k: string): unknown => (isObj(o) && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

/**
 * FR-124: whether managed policy says a human must answer. The prompt request's marker for the five kinds that can clear it, else the raw
 * marker; fail closed: any present value other than `false` (on either one) means a human must answer.
 */
export function managedHumanRequired(raw: unknown, prompt: unknown): boolean {
  const rawMark = own(raw, 'managedApprovalRequired');
  const promptMark = own(prompt, 'managedApprovalRequired');
  const set = (v: unknown): boolean => v !== undefined && v !== false;
  if (set(rawMark) && !(isObj(prompt) && CLEARABLE_KINDS.has(String(own(prompt, 'kind'))) && promptMark === false)) return true;
  return set(promptMark);
}

/**
 * FR-124, FR-130: the judge's verdict on one request, normalized. `approve: true` only when the switch is on, the verdict is exactly `approve`
 * and no managed-human marker is set; a `note` for the pending card when the verdict is one of the three others. A missing or malformed
 * verdict gives neither. The verdict's `reason` and `model` (model output) are never read.
 */
export function copilotReview(on: boolean, raw: unknown, prompt: unknown): { approve: boolean; note?: 'declined' | 'never' | 'undecided' } {
  if (!on) return { approve: false };
  const v = isObj(own(raw, 'assistedApproval')) ? own(raw, 'assistedApproval') : own(prompt, 'assistedApproval');
  const rec = own(v, 'recommendation');
  if (rec === 'approve') return { approve: !managedHumanRequired(raw, prompt) };
  if (rec === 'requireApproval') return { approve: false, note: 'declined' };
  if (rec === 'excluded') return { approve: false, note: 'never' };
  if (rec === 'error') return { approve: false, note: 'undecided' };
  return { approve: false };
}

/** Spec 097's lookalike module (`src/renderer/lookalike.js`, UMD): the part this file uses. */
export interface LookalikeModule {
  check(text: string, kind: string): { findings: unknown[]; hosts: unknown[] };
  hostOdd?(h: unknown): boolean;
}

/**
 * FR-124 (C5): the lookalike module, loaded once from the build's renderer folder (`dist/renderer/lookalike.js`, copied by copy-assets.js).
 * Not there, or it throws: `undefined`, and every request counts as not checked (it keeps its card). `dir` is for tests.
 */
export function loadLookalike(dir: string = path.join(__dirname, '..', 'renderer')): LookalikeModule | undefined {
  try {
    const m = require(path.join(dir, 'lookalike.js')) as Partial<LookalikeModule>; // eslint-disable-line @typescript-eslint/no-require-imports
    return m && typeof m.check === 'function' ? (m as LookalikeModule) : undefined;
  } catch {
    return undefined;
  }
}

/** FR-124 (C5): true only when the card's text was checked and has no lookalike letters and no host that reads differently; a failed check is false. */
export function lookalikeClean(lk: LookalikeModule | undefined, text: string, permKind: string): boolean {
  if (!lk) return false;
  const kind = permKind === 'shell' ? 'shell' : permKind === 'mcp' || permKind === 'custom-tool' ? 'tool' : 'other';
  try {
    const r = lk.check(text, kind);
    if (!r || !Array.isArray(r.findings) || !Array.isArray(r.hosts)) return false;
    if (r.findings.length) return false;
    return !(typeof lk.hostOdd === 'function' && r.hosts.some((h) => lk.hostOdd!(h)));
  } catch {
    return false;
  }
}
