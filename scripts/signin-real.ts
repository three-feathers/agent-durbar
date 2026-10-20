/**
 * Dev tool, NO PROMPT IS ANSWERED (spec 012 T124; owner-approved 2026-10-20): the real error texts of a refused sign-in, and whether
 * `verifySignIn` and the classifier (`src/adapters/autherrors.ts`) catch them. Nothing real is touched:
 * - Copilot: the client gets an obviously invalid token (`ghp_` and zeros) with `useLoggedInUser: false`, so the real login is not used.
 * - Codex: `CODEX_HOME` points to a temp copy of `auth.json` with the access and refresh tokens replaced (so no real refresh can
 *   happen) and nothing else; the copy is deleted at the end.
 * Every printed text goes through `redact` (token shapes, emails). Not part of `npm test`.
 *   npx tsx scripts/signin-real.ts <empty-tmp-folder> [copilot|codex]
 */
import { CopilotClient } from '@github/copilot-sdk';
import { CopilotAdapter } from '../src/adapters/copilot';
import { CodexAdapter } from '../src/adapters/codex';
import { isAuthError, markAuthError } from '../src/adapters/autherrors';
import type { AgentEvent } from '../src/adapters/types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const redact = (s: unknown): string =>
  String(s instanceof Error ? s.message : s)
    .replace(/\b(gh[pousr]_|github_pat_|sk-|rt_|eyJ)[A-Za-z0-9._-]{6,}/g, '<redacted>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>')
    .replace(/\s+/g, ' ')
    .slice(0, 300);
const show = (label: string, e: unknown): void => console.log(`${label}: ${JSON.stringify({ text: redact(e), classifiedAsAuth: isAuthError(e instanceof Error ? e.message : String(e)) })}`);

async function copilot(dir: string): Promise<void> {
  // the env var alone does not win over a `gh` login on this box (checked 2026-10-20), so the client gets the token explicitly
  // and is told not to use the logged-in user: the same as a revoked token
  class C extends CopilotAdapter {
    private own?: Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    protected getClient(): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
      this.own ??= (async () => { const c = new CopilotClient({ gitHubToken: 'ghp_' + '0'.repeat(36), useLoggedInUser: false }); await c.start(); return c; })();
      return this.own;
    }
    raw(): Promise<any> { return this.getClient(); } // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  const ad = new C();
  const evs: AgentEvent[] = [];
  ad.onEvent((e) => evs.push(e));
  try {
    const c = await ad.raw();
    const a = await c.getAuthStatus().catch((e: Error) => e);
    console.log('copilot getAuthStatus:', a instanceof Error ? redact(a) : JSON.stringify({ isAuthenticated: a.isAuthenticated, authType: a.authType }));
    await c.rpc.account.getQuota({}).then(() => console.log('copilot getQuota: ok (!)'), (e: Error) => show('copilot getQuota error', e));
    await c.rpc.models.list({}).then((r: { models?: unknown[] }) => console.log('copilot models.list: ok,', r.models?.length, 'models'), (e: Error) => show('copilot models.list error', e));
    console.log('copilot verifySignIn:', JSON.stringify(await ad.verifySignIn()));
    // a message on a session: what error the user would see at Send (FR-157)
    try {
      const sid = await ad.start({ workspace: dir, model: 'auto', autoTier: 'efficiency', maxAiCredits: 30, quiet: true } as never);
      await ad.send(sid, { text: 'Reply with the single word OK.' }).catch((e: Error) => show('copilot send error', e));
      const t0 = Date.now();
      while (Date.now() - t0 < 30000 && !evs.some((e) => e.type === 'status' && ['error', 'idle'].includes(String((e as { status?: string }).status)))) await new Promise((r) => setTimeout(r, 300));
      for (const e of evs.filter((x) => x.type === 'status' && (x as { status?: string }).status === 'error')) console.log('copilot error status:', JSON.stringify({ intent: redact((e as { intent?: string }).intent), errorKind: (e as { errorKind?: string }).errorKind, markAuthError: (markAuthError({ ...e }) as { errorKind?: string }).errorKind }));
      await ad.stop(sid).catch(() => undefined);
      await c.deleteSession(sid).catch(() => undefined);
    } catch (e) {
      show('copilot start error', e);
    }
  } finally {
    await (await ad.raw()).stop().catch(() => undefined);
  }
}

async function codex(dir: string): Promise<void> {
  const home = path.join(dir, 'codex-home');
  fs.mkdirSync(home, { recursive: true });
  const src = path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'auth.json');
  const auth = JSON.parse(fs.readFileSync(src, 'utf8')) as { tokens?: Record<string, unknown> };
  if (auth.tokens) {
    const at = String(auth.tokens.access_token ?? '');
    // keep the JWT's header and claims so Codex can read it locally; break the signature so OpenAI refuses it
    auth.tokens.access_token = at.split('.').length === 3 ? at.split('.').slice(0, 2).join('.') + '.invalidsignature' : 'invalid';
    auth.tokens.refresh_token = 'invalid-refresh-token';
  }
  fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify(auth), { mode: 0o600 });
  const ad = new CodexAdapter({ env: { ...process.env, CODEX_HOME: home } as NodeJS.ProcessEnv });
  try {
    const p = (ad as unknown as { probe: <T>(fn: (rpc: { request: (m: string, p: unknown) => Promise<unknown> }) => Promise<T>) => Promise<T> }).probe.bind(ad);
    await p((rpc) => rpc.request('account/rateLimits/read', {})).then(() => console.log('codex rateLimits/read: ok (!)'), (e: Error) => show('codex rateLimits/read error', e));
    await p((rpc) => rpc.request('getAuthStatus', { includeToken: false, refreshToken: false })).then((r) => console.log('codex getAuthStatus:', JSON.stringify({ authMethod: (r as { authMethod?: unknown })?.authMethod ?? null })), (e: Error) => show('codex getAuthStatus error', e));
    console.log('codex verifySignIn:', JSON.stringify(await ad.verifySignIn()));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const [dir, only] = process.argv.slice(2);
  if (!dir) throw new Error('usage: signin-real.ts <empty-tmp-folder> [copilot|codex]');
  fs.mkdirSync(dir, { recursive: true });
  if (only !== 'codex') await copilot(dir);
  if (only !== 'copilot') await codex(dir);
}
main().catch((e) => { console.error('FAILED', redact(e)); process.exit(1); });
