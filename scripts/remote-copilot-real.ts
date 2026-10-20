/**
 * Dev tool, USES AI CREDITS AND PUBLISHES A SESSION TO GITHUB (spec 054 T020, #298; owner-approved 2026-10-20). The real `CopilotAdapter`:
 * one read-only `auto` session in an EMPTY throw-away folder, one tiny prompt, then `setRemote(id, true)`, then `setRemote(id, false)`.
 * Q2: first a plain folder; if that is refused, the same in a throw-away `git init` folder with no remote. The runtime is started WITHOUT
 * `enableRemoteSessions` (Q1). Only the URL's shape is printed (owner, repo and ids replaced), never the URL itself. Not part of `npm test`.
 * Both steps always run: on 2026-10-20 the plain folder answered `started: false` with no error, so `ok` alone does not settle Q2.
 *   npx tsx scripts/remote-copilot-real.ts <empty-tmp-parent> [git]
 */
import { CopilotAdapter } from '../src/adapters/copilot';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

type Raw = { type: string; data?: Record<string, unknown> };
class R extends CopilotAdapter {
  raw(sid: string): any { return (this as any).sessions.get(sid)?.session; } // eslint-disable-line @typescript-eslint/no-explicit-any
  rawClient(): Promise<any> { return this.getClient(); } // eslint-disable-line @typescript-eslint/no-explicit-any
}
const shape = (u: unknown): unknown => (typeof u === 'string' ? u.replace(/^(https:\/\/[^/]+)\/(.*)$/, (_m, host: string, rest: string) => `${host}/${rest.split('/').map((p, i) => (i < 2 ? `<${i === 0 ? 'owner' : 'repo'}>` : /^[A-Za-z_-]+$/.test(p) ? p : '<id>')).join('/')}`).replace(/\?.*$/, '?<query>') : u);
const clean = (e: unknown): string => String(e instanceof Error ? e.message : e).replace(/https?:\/\/\S+/g, (u) => String(shape(u))).slice(0, 300);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function attempt(ad: R, folder: string, label: string): Promise<boolean> {
  const evs: Raw[] = [];
  const sid = await ad.start({ workspace: folder, model: 'auto', autoTier: 'efficiency', maxAiCredits: 30, quiet: true } as never);
  ad.raw(sid).on((e: Raw) => evs.push({ type: e.type, data: e.data }));
  let nano = 0;
  try {
    const idle = new Promise<void>((resolve) => { const t = setInterval(() => { if (evs.some((e) => e.type === 'session.idle')) { clearInterval(t); resolve(); } }, 200); setTimeout(() => { clearInterval(t); resolve(); }, 90000); });
    await ad.send(sid, { text: 'Reply with the single word OK.' });
    await idle;
    const rr = ad.raw(sid).rpc?.remote;
    if (rr && typeof rr.enable === 'function') {
      const orig = rr.enable.bind(rr);
      rr.enable = async (p: unknown) => { const r = await orig(p); console.log(`[${label}] raw enable result:`, JSON.stringify(r && typeof r === 'object' ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, /url/i.test(k) ? shape(v) : v])) : r)); return r; };
    }
    const on = await ad.setRemote(sid, true);
    console.log(`[${label}] setRemote(true):`, JSON.stringify({ ...on, url: shape((on as { url?: unknown }).url), error: (on as { error?: string }).error ? clean((on as { error?: string }).error) : undefined }));
    // the raw enable result's keys and visibility (values of urls reduced to their shape)
    await sleep(2500);
    const vis = await ad.raw(sid).rpc.visibility?.get?.().catch((e: Error) => ({ error: clean(e) }));
    console.log(`[${label}] visibility.get after enable:`, JSON.stringify(vis && typeof vis === 'object' ? Object.fromEntries(Object.entries(vis).map(([k, v]) => [k, /url/i.test(k) ? shape(v) : v])) : vis));
    console.log(`[${label}] remote events:`, JSON.stringify(evs.filter((e) => /remote|visib|steer/i.test(e.type)).map((e) => ({ type: e.type, keys: Object.keys(e.data ?? {}), steerable: (e.data as { remoteSteerable?: unknown } | undefined)?.remoteSteerable }))));
    if (!(on as { ok?: boolean }).ok) return false;
    const off = await ad.setRemote(sid, false);
    console.log(`[${label}] setRemote(false):`, JSON.stringify(off));
    const vis2 = await ad.raw(sid).rpc.visibility?.get?.().catch((e: Error) => ({ error: clean(e) }));
    console.log(`[${label}] visibility.get after disable:`, JSON.stringify(vis2 && typeof vis2 === 'object' ? Object.fromEntries(Object.entries(vis2).map(([k, v]) => [k, /url/i.test(k) ? shape(v) : v])) : vis2));
    return true;
  } finally {
    nano = evs.filter((e) => e.type === 'assistant.usage').reduce((s, e) => s + Number((e.data as { copilotUsage?: { totalNanoAiu?: number } })?.copilotUsage?.totalNanoAiu ?? 0), 0);
    console.log(`[${label}] AI credits (assistant.usage):`, nano / 1e9);
    await ad.stop(sid).catch(() => undefined);
    await (await ad.rawClient()).deleteSession(sid).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const parent = process.argv[2];
  if (!parent) throw new Error('usage: remote-copilot-real.ts <empty-tmp-parent>');
  const plain = path.join(parent, 'remote-plain');
  const git = path.join(parent, 'remote-git');
  fs.mkdirSync(plain, { recursive: true });
  const ad = new R();
  try {
    const only = process.argv[3]; // 'git' runs only the second step
    if (only !== 'git') await attempt(ad, plain, 'plain folder');
    fs.mkdirSync(git, { recursive: true });
    execFileSync('git', ['init', '-q', git]);
    await attempt(ad, git, 'git init, no remote');
  } finally {
    await (await ad.rawClient()).stop();
  }
}
main().catch((e) => { console.error('FAILED', clean(e)); process.exit(1); });
