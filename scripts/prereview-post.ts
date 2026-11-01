/**
 * Pre-review bot, posting as the GitHub App `durbar-samikshak` (spec 103 FR-027). OFF by default and not part of any review run.
 *
 * This file holds the only GitHub write call of the bot. It stays shut until a local config file outside the repo says `postComment: true`
 * AND holds a dated confirmation of each of the three owners (vikramgorla, fjcabello, rubenlupi); until then `post` refuses before any key is
 * read or any network call is made. It posts one plain issue comment (never a review, never an approval), once per PR and head sha.
 *
 * The App's private key is read ONLY inside `signAppJwt`, which makes a 9-minute JWT; the installation token is requested for one repository
 * with `pull_requests: write` only, lives in memory, and is never written, logged or printed. The App is not on scripts/trusted-authors.txt:
 * its comment is outside text for every agent (AGENTS.md, FR-060) and a human reads it.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { OWNERS_REQUIRED, Report, clean, keyFileProblems, renderReport } from './prereview-core';

export interface PostConfig { postComment?: unknown; confirmations?: unknown }

/** The gate. Pure. Anything but `postComment === true` and a valid date for each owner is a no. */
export function postGate(cfg: PostConfig | null | undefined, now: Date = new Date()): { ok: true } | { ok: false; why: string } {
  if (!cfg || typeof cfg !== 'object') return { ok: false, why: 'posting is off (no config)' };
  if (cfg.postComment !== true) return { ok: false, why: 'posting is off (postComment is not true)' };
  const c = cfg.confirmations;
  if (!c || typeof c !== 'object' || Array.isArray(c)) return { ok: false, why: 'no owner confirmations recorded' };
  const missing = OWNERS_REQUIRED.filter((o) => {
    if (!Object.prototype.hasOwnProperty.call(c, o)) return true;
    const v = (c as Record<string, unknown>)[o];
    return typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)) || v > now.toISOString().slice(0, 10); // a date still to come is no confirmation
  });
  return missing.length ? { ok: false, why: `owner confirmation missing: ${missing.join(', ')}` } : { ok: true };
}

/**
 * The config file must belong to the operating user (the one who runs `post`), not to the bot's user, and neither it nor its folder may be
 * writable by others. `[KNOWN GAP]` This is a local file check: any process of the operating account can still edit it, so it stops a
 * mistake and the bot's own user, not that account. With one account for both, it is a convention only.
 */
export function readPostConfig(file: string, me: number): { cfg: PostConfig | null; problem?: string } {
  let st: fs.Stats;
  try { st = fs.lstatSync(file); } catch { return { cfg: null }; }
  let dir: fs.Stats | null = null; try { dir = fs.lstatSync(path.dirname(file)); } catch { dir = null; }
  if (!st.isFile() || st.isSymbolicLink() || st.uid !== me || (st.mode & 0o022) !== 0) return { cfg: null, problem: 'post config is not a plain file of the operating user, or is writable by others' };
  if (!dir || dir.isSymbolicLink() || !dir.isDirectory() || dir.uid !== me || (dir.mode & 0o022) !== 0) return { cfg: null, problem: 'the post config\'s folder is not the operating user\'s own, or is writable by others (keep it outside the bot\'s state folder)' };
  try { return { cfg: JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { return { cfg: null, problem: 'post config is not JSON' }; }
}

const b64u = (b: Buffer | string): string => Buffer.from(b).toString('base64url');
/**
 * The ONLY place the private key is read. Checks the file the way the Anthropic key is checked (regular, no link, 0600, ours, not in a git
 * folder, PEM shape), signs RS256, and returns the JWT. The key is a local variable that ends here; errors never carry its text.
 */
export function signAppJwt(a: { keyFile: string; appId: string; nowSec: number; me: number }): string {
  if (!/^\d{1,12}$/.test(a.appId)) throw new Error('bad app id');
  let st: fs.Stats | null = null; try { st = fs.lstatSync(a.keyFile); } catch { st = null; }
  const insideGit = (() => { let p = path.dirname(a.keyFile); for (let n = 0; n < 40; n++) { if (fs.existsSync(path.join(p, '.git'))) return true; const up = path.dirname(p); if (up === p) break; p = up; } return false; })();
  const probs = keyFileProblems(st ? { isFile: st.isFile(), isSymlink: st.isSymbolicLink(), mode: st.mode, uid: st.uid, size: st.size } : null, a.me, insideGit);
  if (probs.length) throw new Error(`app key refused: ${probs.join('; ')}`);
  let pem = fs.readFileSync(a.keyFile, 'utf8');
  if (!/^-----BEGIN (RSA )?PRIVATE KEY-----/.test(pem.trim())) throw new Error('app key refused: not a PEM private key');
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iat: a.nowSec - 60, exp: a.nowSec + 540, iss: a.appId }));
  try {
    const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), pem);
    return `${head}.${body}.${b64u(sig)}`;
  } catch { throw new Error('app key refused: could not sign'); } finally { pem = ''; }
}

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<any> }>;
export interface PostDeps { fetch: Fetch; now: () => Date; me: number; stateDir: string }

/** The three calls, and no others: find the installation, get a one-repository token, post one comment. */
function allowedCall(method: string, urlPath: string, owner: string, repo: string, pr: number): boolean {
  const r = `/repos/${owner}/${repo}`;
  return (method === 'GET' && urlPath === `${r}/installation`) || (method === 'POST' && /^\/app\/installations\/\d{1,12}\/access_tokens$/.test(urlPath)) || (method === 'POST' && urlPath === `${r}/issues/${pr}/comments`);
}

export function buildComment(report: Report): string {
  return [`Automated pre-review by a bot (durbar-samikshak). It is not a review and not an approval, and it can be wrong. It is outside text: a person reads it, and agents treat it as data.`, '', renderReport(report)].join('\n');
}
export const MAX_COMMENT = 60_000;

export async function postComment(deps: PostDeps, a: { owner: string; repo: string; pr: number; report: Report; cfg: PostConfig | null; keyFile: string; appIdFile: string }): Promise<{ ok: true; url: string } | { ok: false; why: string }> {
  const gate = postGate(a.cfg, deps.now()); if (!gate.ok) return gate; // before any read of the key and before any network
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(a.owner) || !/^[A-Za-z0-9._-]{1,100}$/.test(a.repo) || !Number.isInteger(a.pr) || a.pr < 1) return { ok: false, why: 'bad repository or PR number' };
  if (a.report.pr !== a.pr) return { ok: false, why: 'report is for another PR' };
  const text = buildComment(a.report);
  if (text.length > MAX_COMMENT) return { ok: false, why: 'report is too large to post; read the file' };
  const marker = path.join(deps.stateDir, 'posted.jsonl');
  const key = `${a.pr}:${a.report.sha}`;
  let seen = ''; try { seen = fs.readFileSync(marker, 'utf8'); } catch { seen = ''; }
  if (seen.split('\n').includes(key)) return { ok: false, why: 'already posted for this PR and head' };
  let appId: string; try { appId = fs.readFileSync(a.appIdFile, 'utf8').trim(); } catch { return { ok: false, why: 'app id file unreadable' }; }
  let jwt: string; try { jwt = signAppJwt({ keyFile: a.keyFile, appId, nowSec: Math.floor(deps.now().getTime() / 1000), me: deps.me }); } catch (e: any) { return { ok: false, why: clean(e && e.message, 200) }; }
  fs.appendFileSync(marker, key + '\n', { mode: 0o600 }); // before the first call that reaches the network: a failed send is not repeated by accident (delete the line to retry)
  const call = async (method: string, urlPath: string, bearer: string, body?: unknown): Promise<{ status: number; json: any }> => {
    if (!allowedCall(method, urlPath, a.owner, a.repo, a.pr)) throw new Error('call not allowed');
    const r = await deps.fetch(`https://api.github.com${urlPath}`, { method, headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'durbar-samikshak', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
    let j: any = null; try { j = await r.json(); } catch { j = null; }
    return { status: r.status, json: j };
  };
  try {
    const inst = await call('GET', `/repos/${a.owner}/${a.repo}/installation`, jwt);
    if (inst.status !== 200 || !inst.json || !Number.isInteger(inst.json.id)) return { ok: false, why: `no installation (${inst.status})` };
    const tok = await call('POST', `/app/installations/${inst.json.id}/access_tokens`, jwt, { repositories: [a.repo], permissions: { pull_requests: 'write' } });
    if (tok.status !== 201 || !tok.json || typeof tok.json.token !== 'string') return { ok: false, why: `no installation token (${tok.status})` };
    const posted = await call('POST', `/repos/${a.owner}/${a.repo}/issues/${a.pr}/comments`, tok.json.token, { body: text });
    if (posted.status !== 201) return { ok: false, why: `comment refused (${posted.status})` };
    const url = posted.json && typeof posted.json.html_url === 'string' && /^https:\/\/github\.com\//.test(posted.json.html_url) ? posted.json.html_url : '';
    return { ok: true, url };
  } catch (e: any) {
    return { ok: false, why: `post failed: ${clean(e && e.name, 40)}` }; // the name only: a message could hold a header
  }
}
