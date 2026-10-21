import { isMcpAuthChallenge } from './mcpauth';

/**
 * Spec 012 FR-156/FR-157: is an error message about the sign-in (an expired, missing or refused login)? Pure, unit-tested
 * (`npm run test:autherrors`). Shared by the adapters' `verifySignIn` and their session-error mapping; it only reads the text and
 * never returns it, so no token or account name can leak through it.
 *
 * Deliberately narrow: a usage limit, a low credit balance, a rate limit or a network failure is NOT a sign-in problem.
 */

/** Messages that mean "out of credits or rate-limited": never treated as a sign-in failure, even when they mention a key or a 403. */
const NOT_AUTH = /credit balance|usage limit|rate[ -]?limit(?:ed| exceeded| reached| hit)|quota exceeded|too many requests|\b429\b|insufficient[_ ]quota|billing/i;

const AUTH = [
  /\b401\b/,
  /\b403\b/,
  /unauthori[sz]ed/i,
  /not authenticated/i,
  /unauthenticated/i,
  /authentication[_ ](?:error|failed|required)/i,
  /failed to authenticate/i,
  /bad credentials/i,
  /invalid api key/i,
  /invalid[_ ]x?-?api[_ ]key/i,
  /(?:access |oauth |auth )?token[^.\n]{0,40}\b(?:expired|invalid|revoked)\b/i,
  /\b(?:expired|invalid|revoked)\b[^.\n]{0,20}\btoken\b/i,
  /not (?:logged|signed) in/i,
  /please (?:run \/login|log ?in|sign ?in)/i,
  /\brun `?(?:copilot|codex|claude)(?: auth)? login`?/i,
  /\blogin required\b/i,
  /\bre-?authenticate\b/i,
  // Copilot runtime 1.0.98 at Send with a refused token (real, 2026-10-20): "... get_model_list: GenericFailure, Session was not created with authentication info or custom provider"
  /not created with authentication info/i,
];

/** True when `message` reads like a failed or missing sign-in. */
export function isAuthError(message: unknown): boolean {
  const text = typeof message === 'string' ? message : message instanceof Error ? message.message : '';
  if (!text) return false;
  const t = text.slice(0, 2000);
  if (NOT_AUTH.test(t)) return false;
  if (isMcpAuthChallenge(t)) return false; // spec 058 FR-062: an MCP server's sign-in, not the agent app's
  return AUTH.some((r) => r.test(t));
}

/** The answer of an adapter's `verifySignIn`, from an error thrown by its server call: `signed-out` for a sign-in error, else `unknown`. */
export function signInFromError(e: unknown): 'signed-out' | 'unknown' {
  return isAuthError(e) ? 'signed-out' : 'unknown';
}

/**
 * FR-157: an `error` status whose text reads like a sign-in failure gets `errorKind: 'auth'`; every other event is returned as it
 * is. Applied where each adapter emits, so every error path (the runtime's error event, a refused turn, a failed start) is covered.
 */
export function markAuthError<T extends { type: string }>(body: T): T {
  const b = body as T & { status?: string; intent?: string; errorKind?: string; agentId?: string };
  // a producer that already decided (the key is present, even as undefined) is left alone
  if (b.type !== 'status' || b.status !== 'error' || 'errorKind' in b || b.agentId || !isAuthError(b.intent)) return body;
  return { ...body, errorKind: 'auth' };
}
