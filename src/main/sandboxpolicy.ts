import { redact } from '../shared/redact';
import { readMachinePolicy } from './policyfile';
import type { MachinePolicy } from './policyfile';
/**
 * Spec 087 FR-019 (T050): `permissions.requireOsSandbox` of the organization policy (spec 076). The machine layer is read by spec 076
 * FR-209 (`policyfile.ts`, macOS and Linux; Windows `[KNOWN GAP]`); the user layer is not read yet.
 */

/**
 * The key over the organization's policy layers (each a parsed `policy.json`, or `undefined` when a layer has none). Narrow-only
 * (spec 076): any layer that sets it makes it `true` for good; `false` never undoes another layer; a value that is not a boolean
 * counts as `true` (fail closed); a layer that is present but unreadable (`'unreadable'`) counts as `true` too. The user's own
 * settings are not a layer here: a person can never set it back to `false`.
 */
export function requireOsSandboxFrom(layers: ReadonlyArray<unknown>): boolean {
  let req = false;
  for (const l of layers) {
    if (l === undefined) continue;
    if (l === 'unreadable') return true;
    if (!l || typeof l !== 'object' || Array.isArray(l)) continue;
    if (!Object.prototype.hasOwnProperty.call(l, 'permissions')) continue;
    const p = (l as { permissions?: unknown }).permissions;
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      req = true; // a `permissions` that is not an object: fail closed
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(p, 'requireOsSandbox')) continue;
    const v = (p as { requireOsSandbox?: unknown }).requireOsSandbox;
    if (v !== false) req = true; // `true`, or anything that is not a boolean
  }
  return req;
}

/**
 * What the app uses (spec 076 FR-209): the machine `policy.json` on macOS and Linux, read at each session start, so a policy added or
 * fixed applies to the next session. A present but broken policy requires the sandbox, and the reason is logged once per distinct problem
 * (the session itself shows spec 087's refusal sentence, so nobody is locked out without a reason).
 */
let lastProblem = '';
export function requireOsSandbox(read: () => MachinePolicy = () => readMachinePolicy(), warn: (line: string) => void = (l) => console.warn(redact(l))): boolean {
  const m = read();
  if (m.layer === 'unreadable' && m.problem !== lastProblem) {
    lastProblem = m.problem;
    warn(`[policy] your organization's policy could not be read (${m.problem}): the OS sandbox is required until it is fixed`);
  }
  if (m.layer !== 'unreadable') lastProblem = '';
  return requireOsSandboxFrom([m.layer]);
}
