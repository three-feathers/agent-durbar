/**
 * Spec 051 FR-011 (issue #617): each agent app's own sign-in answer mapped to Durbar's `AccountIdentity`. Pure; the vendor shapes stay
 * here (constitution II). Fields are read only when they have the right type; anything missing gives fewer facts, never a guess.
 * Personal data: nothing here logs, and callers never pass the result to `debug` (FR-015).
 */
import { cleanName, planWord } from '../shared/account';
import type { AccountIdentity } from '../shared/account';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const drop = (a: AccountIdentity): AccountIdentity => {
  const out: AccountIdentity = { status: a.status };
  if (a.name) out.name = a.name;
  if (a.service) out.service = a.service;
  if (a.plan) out.plan = a.plan;
  if (a.method) out.method = a.method;
  return out;
};

/** The host of a GitHub URL as a short service name: "GitHub" for github.com, else the host (GitHub Enterprise). */
function githubService(host: unknown): string {
  if (typeof host !== 'string' || !host.trim()) return 'GitHub';
  let h = host.trim();
  try {
    h = new URL(/^[a-z]+:\/\//i.test(h) ? h : `https://${h}`).hostname;
  } catch {
    return 'GitHub';
  }
  h = h.toLowerCase();
  return h === 'github.com' || h === 'api.github.com' || h === 'www.github.com' ? 'GitHub' : cleanName(h, 60) ?? 'GitHub';
}

/**
 * Copilot: the SDK's `getAuthStatus()` (`isAuthenticated`, `authType`, `host`, `login`). `statusMessage` is not read (it can repeat
 * the login in free text).
 */
export function copilotAccount(s: unknown): AccountIdentity {
  if (!isObj(s) || typeof s.isAuthenticated !== 'boolean') return { status: 'unknown' };
  if (!s.isAuthenticated) return { status: 'signed-out' };
  const t = s.authType;
  const method: AccountIdentity['method'] = t === 'gh-cli' ? 'gh-cli' : t === 'env' || t === 'token' ? 'token' : t === 'api-key' || t === 'hmac' ? 'api-key' : t === 'user' ? 'account' : undefined;
  return drop({ status: 'signed-in', name: cleanName(s.login), service: githubService(s.host), method });
}

const CLAUDE_PROVIDERS: Record<string, string> = { bedrock: 'Amazon Bedrock', vertex: 'Google Vertex AI', foundry: 'Microsoft Foundry' };

/**
 * Claude Code: `claude auth status --json`. `claude.ai` carries `email` and `subscriptionType`; `api_key` an `apiKeySource` (and the
 * email only for a key the CLI made at `/login`); `oauth_token` is a long-lived token; `third_party` / a non-first-party
 * `apiProvider` is a cloud provider. `orgId` and `orgName` are not read.
 */
export function claudeAccount(j: unknown): AccountIdentity {
  if (!isObj(j) || typeof j.loggedIn !== 'boolean') return { status: 'unknown' };
  if (!j.loggedIn || j.authMethod === 'none') return { status: 'signed-out' };
  const provider = typeof j.apiProvider === 'string' && j.apiProvider !== 'firstParty' ? CLAUDE_PROVIDERS[j.apiProvider.toLowerCase()] ?? cleanName(j.apiProvider, 40) : undefined;
  const email = cleanName(j.email);
  if (provider) return drop({ status: 'signed-in', name: email, service: provider, method: 'provider' });
  if (j.authMethod === 'claude.ai') {
    const plan = planWord(j.subscriptionType);
    return drop({ status: 'signed-in', name: email, service: 'Claude', plan: plan ? `Claude ${plan}` : undefined, method: 'account' });
  }
  if (j.authMethod === 'api_key') return drop({ status: 'signed-in', name: email, service: 'Anthropic', method: 'api-key' });
  if (j.authMethod === 'oauth_token') return drop({ status: 'signed-in', name: email, service: 'Claude', method: 'token' });
  if (j.authMethod === 'third_party') return drop({ status: 'signed-in', name: email, method: 'provider' });
  return drop({ status: 'signed-in', name: email });
}

/**
 * Codex: the app-server's `account/read` answer (`{ account, requiresOpenaiAuth }`). `chatgpt` has `email` and `planType`; `apiKey`
 * and `amazonBedrock` have no name. `account: null` with `requiresOpenaiAuth` = not signed in.
 */
export function codexAccount(r: unknown): AccountIdentity {
  if (!isObj(r)) return { status: 'unknown' };
  const a = r.account;
  if (a === null || a === undefined) return r.requiresOpenaiAuth === true ? { status: 'signed-out' } : { status: 'unknown' };
  if (!isObj(a)) return { status: 'unknown' };
  if (a.type === 'chatgpt') {
    const plan = planWord(a.planType);
    return drop({ status: 'signed-in', name: cleanName(a.email), service: 'ChatGPT', plan: plan ? `ChatGPT ${plan}` : undefined, method: 'account' });
  }
  if (a.type === 'apiKey') return { status: 'signed-in', service: 'OpenAI', method: 'api-key' };
  if (a.type === 'amazonBedrock') return { status: 'signed-in', service: 'Amazon Bedrock', method: 'provider' };
  return { status: 'signed-in' };
}
