/**
 * Spec 087 FR-019 (T050): `permissions.requireOsSandbox` of the organization policy (spec 076). Spec 076 has no policy reader yet
 * (`updatepolicy.ts` says the same), so `requireOsSandbox()` answers `false` and only the rule below is built and tested
 * (`[KNOWN GAP]`, stated in the spec and the README). When 076's reader lands, it hands its layers to `requireOsSandboxFrom`.
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

/** What the app uses today: no organization policy reader exists yet (spec 076), so nothing requires the sandbox. */
export function requireOsSandbox(): boolean {
  return requireOsSandboxFrom([]);
}
