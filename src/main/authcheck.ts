/**
 * Spec 012 FR-156: after detection, every `ready` agent app whose adapter can tell is asked whether its sign-in really works
 * (`verifySignIn`: a free server call where the app offers one; `authStatus` for an adapter without it), so a missing or expired
 * sign-in shows in Settings, the toolbar and the new-session check instead of failing at the first message. FR-157: a session that
 * fails because of the sign-in flips the cached state (`markSignedOut`). Pure apart from the given check, so it is unit-tested.
 */
import type { AdapterInfo } from '../shared/adapters';

export const COPILOT_SIGN_IN_HINT = 'Sign in first: open Settings > Agent apps and choose Sign in… (or run `copilot login`).';
/** The hints of Claude Code and Codex live with their detection (src/adapters/detect.ts); the same text here, checked by test:authcheck. */
export const CLAUDE_SIGN_IN_HINT = 'Sign in first: open Settings > Agent apps and choose Sign in… (or run `claude auth login`).';
export const CODEX_SIGN_IN_HINT = 'Sign in first: open Settings > Agent apps and choose Sign in… (or run `codex login`).';
export const GENERIC_SIGN_IN_HINT = 'Sign in first: open Settings > Agent apps and choose Sign in….';
export const VERIFIED_HINT = 'Signed in (checked with the service).';
export const UNCONFIRMED_HINT = 'Signed in on this computer; could not confirm with the service just now.';
/** FR-157: the hint after a session was refused because of the sign-in. */
export const SESSION_SIGNED_OUT_HINT = 'The last message failed because the sign-in is missing or has expired.';
const AUTH_TIMEOUT_MS = 6000;

export function signInHint(id: string): string {
  return id === 'copilot' ? COPILOT_SIGN_IN_HINT : id === 'claude' ? CLAUDE_SIGN_IN_HINT : id === 'codex' ? CODEX_SIGN_IN_HINT : GENERIC_SIGN_IN_HINT;
}

export type SignInStatus = 'signed-in' | 'signed-out' | 'unknown';
/** What an adapter answers: `verifySignIn`'s shape, or the older `authStatus` yes/no. */
export type SignInAnswer = { status: SignInStatus; detail?: string } | { signedIn: boolean };

const statusOf = (r: SignInAnswer | undefined): { status: SignInStatus; detail?: string } => {
  if (!r || typeof r !== 'object') return { status: 'unknown' };
  if ('status' in r) return r.status === 'signed-in' || r.status === 'signed-out' ? r : { status: 'unknown', detail: r.detail };
  return r.signedIn === false ? { status: 'signed-out' } : r.signedIn === true ? { status: 'signed-in' } : { status: 'unknown' };
};

/** A safe `detail` to show: one short line, at most 120 characters. Adapters already keep account data out of it. */
const cleanDetail = (d: unknown): string | undefined => (typeof d === 'string' && d.trim() ? d.replace(/\s+/g, ' ').trim().slice(0, 120) : undefined);

/**
 * For each `ready` agent app that `check` knows (returns a function), ask whether it is signed in:
 * - `signed-out` -> `not-signed-in` with that app's sign-in hint;
 * - `signed-in` -> stays `ready`, hint "Signed in (checked with the service)." (or the adapter's own detail);
 * - `unknown`, an error or slower than the timeout -> stays `ready`; the hint says the service could not confirm it, unless the
 *   adapter gave a better one (its `detail`). An adapter that answers the old `{signedIn: true}` keeps its detected hint.
 */
export async function withSignIn(infos: AdapterInfo[], check: (id: string) => (() => Promise<SignInAnswer>) | undefined, timeoutMs = AUTH_TIMEOUT_MS): Promise<AdapterInfo[]> {
  return Promise.all(
    infos.map(async (i) => {
      if (i.state !== 'ready') return i;
      const fn = check(i.id);
      if (!fn) return i;
      let raw: SignInAnswer | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        raw = await Promise.race([
          fn(),
          new Promise<undefined>((res) => {
            timer = setTimeout(() => res(undefined), timeoutMs);
          }),
        ]);
      } catch {
        raw = undefined; // unclear: keep the detected state
      } finally {
        if (timer) clearTimeout(timer);
      }
      const legacy = !!raw && typeof raw === 'object' && 'signedIn' in raw;
      const r = statusOf(raw);
      const detail = cleanDetail(r.detail);
      if (r.status === 'signed-out') return { ...i, state: 'not-signed-in' as const, hint: signInHint(i.id) };
      if (legacy) return i;
      if (r.status === 'signed-in') return { ...i, hint: detail ?? VERIFIED_HINT };
      return { ...i, hint: detail ?? UNCONFIRMED_HINT };
    }),
  );
}

/** FR-157: the cached list after a session of `id` failed because of the sign-in. The same array when nothing changes. */
export function markSignedOut(infos: AdapterInfo[], id: string): AdapterInfo[] {
  const i = infos.findIndex((x) => x.id === id);
  if (i < 0 || infos[i].state !== 'ready') return infos;
  const out = infos.slice();
  out[i] = { ...infos[i], state: 'not-signed-in', hint: `${SESSION_SIGNED_OUT_HINT} ${signInHint(id)}` };
  return out;
}
