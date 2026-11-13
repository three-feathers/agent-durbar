/**
 * Spec 058 FR-232 (issue #1621): a 403 from a server whose entry sends its own token (a header, or a `${NAME}` reference) and has no OAuth
 * reads "Refused: token not accepted", names a variable Durbar's environment does not have (name only, never a value) and offers no
 * Sign in again. A 401, an OAuth server, an unknown entry and a server Durbar has a sign-in record for keep "needs sign-in".
 * Checks, by behaviour: the pure rules (`mcptoken.ts`); `agentMcpReply` with fake entries; the window's words (`mcpwords.js`); the
 * simulator's copy of the rule; and the real `registerMcpIpc` reading a Copilot CLI list in a scratch folder (stand-in electron, fakes only).
 * Secret safety: fake `ghp_`-shaped values in a header, in a variable's value and inside `${...}` never reach any reply, word or text.
 * `npm run test:mcpsession`.
 */
process.exitCode = 1;
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type { AgentEvent, McpServerStatus } from '../src/adapters/types';
import { FakeAdapter } from '../src/adapters/fake';
import type { AgentInfo, AgentMcpEntry } from '../src/shared/api';
import { agentMcpReply } from '../src/main/mcpsession';
import type { McpReplyInput } from '../src/main/mcpsession';
import { envIsSet, isCredentialHeader, isTokenRefusal, isTokenServer, refNames, tokenEntryOfExtra, tokenEntryOfSpec, unsetVars } from '../src/main/mcptoken';
import type { TokenEntry } from '../src/main/mcptoken';
import * as shared from '../src/shared/redact';
import { envVarName, redact } from '../src/shared/redact';

interface Finding { key: string; rkey: string; reason: string; fix: string }
interface Words {
  reasonOf: (x: unknown) => { key: string; word: string } | null;
  hintFor: (o: unknown) => string;
  fixFor: (k: string, ctx?: unknown) => string;
  chatFinding: (x: unknown, chat: unknown, policy?: boolean) => Finding | null;
  launchToken: (items: Map<string, Finding>, reply: unknown, chat: unknown) => boolean;
  restartTargets: (chats: unknown[], usable?: (c: unknown) => boolean) => { targets: unknown[]; skipped: { why: string }[] };
  diagnostics: (o: unknown, redact: (t: string) => string) => string;
  useShared: (m: unknown) => boolean;
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const W = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'mcpwords.js')) as Words;
// the source tree has no compiled redact.js beside the renderer folder: hand the window its rule (the page reads it from `exports`)
assert.strictEqual(W.useShared(shared), true, 'the window takes the shared envVarName rule');

/* FR-232 (c), review of PR #1637: fake values pasted inside `${...}` that are NOT a known token shape (they reached the hint before), and
   upper-case key-looking names; none may be said as a variable anywhere. All fake. */
const PASTED: [string, string][] = [
  ['40-hex', '3f2a9c7e1b4d8f6a0e5c2b7d9a1f4e8c6b3d0a2f'],
  ['32 mixed alnum', 'k8Jq2LmZ9xPw4RtY7vBn3HcS6dFg1AeU'],
  ['lowercase password', 'mysecretpassword123'],
  ['eyJ JWT-like', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'],
  ['GHP_ lower x', 'GHP_' + 'x'.repeat(36)],
  ['GHP_ upper mixed', 'GHP_' + 'A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R8'],
  ['32 upper alnum', 'K8JQ2LMZ9XPW4RTY7VBN3HCS6DFG1AEU'],
  ['upper hex pieces', 'ABCDEF12_34567890_ABCDEF12'],
  // second read of PR #1637: each refused by one guard only (the per-piece rule; the 5-digit cap)
  ['40-letter upper key', 'QWERTYUIOPASDFGHJKLZXCVBNMQWERTYUIOPASDF'],
  ['short pieces with 8 digits', 'AB12_CD34_EF56_GH78'],
];
/* legit names that must stay named */
const LEGIT = ['GITHUB_TOKEN', 'MY_API_KEY', 'AWS_SECRET_ACCESS_KEY'];

/* fake tokens (ghp_ shape, 36 characters after the prefix): none may appear anywhere the window or a log can see */
const TOKEN_HDR = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
const TOKEN_ENV = 'ghp_' + 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2';
const TOKEN_REF = 'ghp_' + 'Q1w2E3r4T5y6U7i8O9p0A1s2D3f4G5h6J7k8';
const ERR403 = 'failed to initialize MCP client: transport failure during send initialize request: unexpected server response: HTTP 403 Forbidden';
const ERR401 = 'failed to initialize MCP client: transport failure during send initialize request: unexpected server response: HTTP 401 Unauthorized';
const TOKEN_WORDS = 'The server refused the token. Check the header or its variable; Sign in does not change it.';

let done = false;
process.on('exit', (code) => {
  if (code === 0 && !done) { console.error('[058] mcp token: FAIL (exited before the last check)'); process.exitCode = 1; }
});

function pure(): void {
  // FR-232 (b): 403 / forbidden, never with 401 / unauthorized
  const refusal: [unknown, boolean][] = [
    [ERR403, true], ['Forbidden', true], ['status 403', true], [ERR401, false], ['403 then 401', false], ['Unauthorized (403)', false],
    ['error 4031', false], ['HTTP 404 Not Found', false], ['', false], [undefined, false], [403, false], ['x'.repeat(3000) + ' 403', false],
  ];
  for (const [t, want] of refusal) assert.strictEqual(isTokenRefusal(t), want, `token refusal of ${String(JSON.stringify(t)).slice(0, 40)}: ${want}`);
  // FR-232 (c): references without a fallback, names only, once each
  assert.deepStrictEqual(refNames(['Bearer ${A_TOKEN}', '${env:B}', '${C:-fallback}', '${1BAD}', '${A_TOKEN}', 'https://x.example/?k=${D}']), ['A_TOKEN', 'B', 'D'], 'refNames: names without a fallback, valid, once each');
  assert.deepStrictEqual(refNames(['${' + 'N'.repeat(65) + '}']), [], 'a name over 64 characters is never said');
  // FR-232 (a)
  assert.strictEqual(isTokenServer({ headers: [['Authorization', 'Bearer x']], texts: ['Bearer x'] }), true, 'a credential header makes a token server');
  assert.strictEqual(isTokenServer({ headers: [], texts: ['https://x.example/mcp?key=${KEY}'] }), true, 'a ${NAME} in the address makes a token server');
  assert.strictEqual(isTokenServer({ headers: [['Authorization', undefined]], texts: [], oauth: true }), false, 'OAuth settings: not a token server');
  assert.strictEqual(isTokenServer({ headers: [], texts: ['https://x.example/mcp'] }), false, 'no header, no reference: not a token server');
  assert.strictEqual(isTokenServer(undefined), false, 'no entry: not a token server');
  // FR-232 (a), review of PR #1637: only a credential header (secretFlag on its name or value, a token shape, or a `${NAME}`) counts
  const hdr: [string, string, boolean][] = [
    ['X-MCP-Readonly', 'true', false], ['Accept', 'application/json', false], ['User-Agent', 'durbar-test', false], ['X-MCP-Toolsets', 'repos,issues', false],
    ['Authorization', 'Bearer ${X}', true], ['X-Api-Key', 'fake-not-a-real-key-0000', true], ['X-Custom', 'Bearer abcdefgh', true], ['X-Custom', TOKEN_HDR, true], ['X-Custom', '${SOME_VAR}', true],
  ];
  for (const [k, v, want] of hdr) {
    assert.strictEqual(isCredentialHeader(k, v), want, `HEADER: ${k}: ${v.slice(0, 12)} is ${want ? '' : 'not '}a credential header`);
    assert.strictEqual(isTokenServer({ headers: [[k, v]], texts: [v] }), want, `HEADER: only a credential header makes a token server (${k})`);
  }
  assert.strictEqual(isTokenServer({ headers: [['X-MCP-Readonly', 'true'], ['Accept', 'application/json']], texts: ['true', 'application/json', 'https://x.example/mcp'] }), false, 'HEADER: setting headers alone: not a token server');
  assert.strictEqual(isTokenServer(tokenEntryOfExtra({ headers: [{ key: 'X-MCP-Readonly' }], url: 'https://x' })), false, 'HEADER: a folder extra with a setting header only: not a token server');
  assert.strictEqual(isTokenServer(tokenEntryOfExtra({ headers: [{ key: 'X-Api-Key' }], url: 'https://x' })), true, 'HEADER: a folder extra with a key header: a token server');
  assert.deepStrictEqual(tokenEntryOfSpec({ url: 'https://x', headers: { Authorization: 'Bearer ${T}' }, oauth: { clientId: 'c' } as never }), { headers: [['Authorization', 'Bearer ${T}']], texts: ['Bearer ${T}', 'https://x'], oauth: true });
  assert.deepStrictEqual(tokenEntryOfExtra({ headers: [{ key: 'X-Key' }], url: 'https://x' }), { headers: [['X-Key', undefined]], texts: ['https://x'] });
  // FR-232 (c), review of PR #1637: the shared name rule
  // second read of PR #1637: one assert per guard of envVarName
  assert.strictEqual(envVarName('QWERTYUIOPASDFGHJKLZXCVBNMQWERTYUIOPASDF'), false, 'NAME: PIECE a 40-letter upper-case key (one piece of 16 or more) is not a name');
  assert.strictEqual(envVarName('AB12_CD34_EF56_GH78'), false, 'NAME: DIGITS a name with more than 5 digits is not a name');
  assert.strictEqual(envVarName('AZURE_OPENAI_API_KEY_2'), true, 'NAME: AZURE_OPENAI_API_KEY_2 (one digit) is still a name');
  for (const [what, v] of PASTED) {
    assert.strictEqual(envVarName(v), false, `NAME: a pasted ${what} is not a variable name`);
    assert.deepStrictEqual(unsetVars({ headers: [['Authorization', 'Bearer ${' + v + '}']], texts: ['Bearer ${' + v + '}'] }, () => false), [], `NAME: a pasted ${what} inside \${...} is never listed`);
  }
  for (const n of LEGIT) {
    assert.strictEqual(envVarName(n), true, `NAME: ${n} is a variable name`);
    assert.deepStrictEqual(unsetVars({ headers: [['Authorization', 'Bearer ${' + n + '}']], texts: ['Bearer ${' + n + '}'] }, () => false), [n], `NAME: an unset ${n} is listed`);
  }
  assert.strictEqual(envVarName('A'.repeat(41)), false, 'NAME: over 40 characters is not a name');
  assert.strictEqual(envVarName('lower_case'), false, 'NAME: lower case is not a name');
  // FR-232 (c): presence only; empty counts as unset; at most three; never a token-shaped or secret name; a throwing lookup says nothing
  const e: TokenEntry = { headers: [['Authorization', undefined]], texts: ['Bearer ${SET}', '${EMPTY}', '${GONE1}', '${GONE2}', '${GONE3}', '${' + TOKEN_REF + '}', '${KNOWN_SECRET_NAME}'] };
  const env: Record<string, string> = { SET: TOKEN_ENV, EMPTY: '' };
  const isSet = (n: string): boolean => typeof env[n] === 'string' && env[n] !== '';
  assert.deepStrictEqual(unsetVars(e, isSet), ['EMPTY', 'GONE1', 'GONE2'], 'unset names in order, at most three');
  assert.deepStrictEqual(unsetVars({ headers: [['Authorization', undefined]], texts: ['${' + TOKEN_REF + '}'] }, () => false), [], 'a token inside ${...} is never said as a name');
  assert.deepStrictEqual(unsetVars({ headers: [['Authorization', undefined]], texts: ['${KNOWN_SECRET_NAME}'] }, () => false, ['KNOWN_SECRET_NAME']), [], 'a name equal to a known secret value is never said');
  assert.deepStrictEqual(unsetVars({ headers: [['Authorization', undefined]], texts: ['${X}'] }, () => { throw new Error('no'); }), [], 'a lookup that throws: nothing is said');
  const es = envIsSet({ SET: TOKEN_ENV, EMPTY: '' } as NodeJS.ProcessEnv);
  assert.deepStrictEqual([es('SET'), es('EMPTY'), es('NONE')], [true, false, false], 'ENV: set, empty (unset) and missing');
}

const live = (name: string, error: string, extra: Partial<McpServerStatus> = {}): McpServerStatus => ({ name, status: 'failed', source: 'user', transport: 'http', error, ...extra });

function reply(): void {
  const ad = new FakeAdapter({ displayName: 'GitHub Copilot', capabilities: { mcpSignIn: true, mcpSignInAgain: true } as never });
  const a = { id: 's1', name: 'Ana', cwd: '/w', permMode: 'ask', model: 'auto' } as AgentInfo;
  (ad as unknown as { isLive: () => boolean }).isLive = () => true;
  const entries: Record<string, TokenEntry> = {
    tok: { headers: [['Authorization', undefined]], texts: ['Bearer ${MISSING_VAR}', 'https://tok.example/mcp'] },
    tokset: { headers: [['Authorization', undefined]], texts: ['Bearer ${SET_VAR}', 'https://tokset.example/mcp'] },
    written: { headers: [['X-Api-Key', undefined]], texts: [TOKEN_HDR, 'https://written.example/mcp'] },
    reftok: { headers: [['Authorization', undefined]], texts: ['Bearer ${' + TOKEN_REF + '}'] },
    tok401: { headers: [['Authorization', undefined]], texts: ['Bearer ${MISSING_VAR}'] },
    oauth: { headers: [['Authorization', undefined]], texts: ['Bearer ${MISSING_VAR}'], oauth: true },
    plain: { headers: [], texts: ['https://plain.example/mcp'] },
    readonly: { headers: [['X-MCP-Readonly', 'true']], texts: ['true', 'https://readonly.example/mcp'] },
    ...Object.fromEntries(PASTED.map(([, v], i) => ['pasted' + i, { headers: [['Authorization', 'Bearer ${' + v + '}']], texts: ['Bearer ${' + v + '}'] } as TokenEntry])),
    ...Object.fromEntries(LEGIT.map((n, i) => ['legit' + i, { headers: [['Authorization', 'Bearer ${' + n + '}']], texts: ['Bearer ${' + n + '}'] } as TokenEntry])),
    blocked: { headers: [['Authorization', undefined]], texts: ['Bearer ${MISSING_VAR}'] },
    opened: { headers: [['Authorization', undefined]], texts: ['Bearer ${MISSING_VAR}'] },
    classed: { headers: [['Authorization', undefined]], texts: ['Bearer ${MISSING_VAR}'] },
  };
  const extraNames = ['readonly', ...PASTED.map((_, i) => 'pasted' + i), ...LEGIT.map((_, i) => 'legit' + i)];
  const names = ['tok', 'tokset', 'written', 'reftok', 'tok401', 'oauth', 'plain', 'nolist', 'blocked', 'opened', 'classed', ...extraNames];
  const base: McpReplyInput = {
    a, ad, off: new Set(), secrets: [], ambientDisabled: new Set(), extras: [],
    live: [
      ...['tok', 'tokset', 'written', 'reftok', 'oauth', 'plain', 'nolist', 'blocked', 'opened', ...extraNames].map((n) => live(n, `${ERR403} (Authorization: Bearer ${TOKEN_HDR})`)),
      live('tok401', ERR401),
      live('classed', ERR403, { errorClass: 'exited' }),
    ],
    cli: names.map((name) => ({ name, enabled: true })),
    serverUrl: (n) => `https://${n}.example/mcp`,
    signInBlocked: (n) => n === 'blocked',
    signIn: (n) => (n === 'opened' ? { host: 'auth.example', opened: true, expiresInMs: 1000 } : undefined),
    tokenEntry: (n) => (Object.prototype.hasOwnProperty.call(entries, n) ? entries[n] : undefined),
    envSet: (n) => n === 'SET_VAR', // SET_VAR's value would be TOKEN_ENV: the reply only ever learns that it is set
  };
  const r = agentMcpReply(base);
  const by = (n: string): AgentMcpEntry => r.servers.find((x) => x.name === n)!;
  // the issue's case: a 403 on a token server with an unset variable
  assert.strictEqual(by('tok').tokenRefused, true, 'FR-232: a 403 on a token server is a refused token');
  assert.deepStrictEqual(by('tok').tokenVars, ['MISSING_VAR'], 'FR-232: the unset variable by name');
  assert.strictEqual(by('tok').canSignInAgain, undefined, 'FR-232: no Sign in again on a refused token');
  assert.strictEqual(by('tokset').tokenRefused, true, 'a set variable: still a refused token');
  assert.strictEqual(by('tokset').tokenVars, undefined, 'a set variable is not named');
  assert.strictEqual(by('written').tokenRefused, true, 'a written header: a refused token');
  assert.strictEqual(by('written').tokenVars, undefined, 'no variable, no name');
  assert.strictEqual(by('reftok').tokenRefused, true, 'a token pasted inside ${...}: a refused token');
  assert.strictEqual(by('reftok').tokenVars, undefined, 'a token pasted inside ${...} is never named');
  // review of PR #1637: a pasted value inside `${...}` is never named (the row still reads a refused token); legit names are
  PASTED.forEach(([what], i) => {
    assert.strictEqual(by('pasted' + i).tokenRefused, true, `a pasted ${what}: still a refused token`);
    assert.strictEqual(by('pasted' + i).tokenVars, undefined, `SECRET: a pasted ${what} is never named in the reply`);
  });
  LEGIT.forEach((n, i) => assert.deepStrictEqual(by('legit' + i).tokenVars, [n], `NAME: ${n} is named in the reply`));
  // review of PR #1637: an OAuth remote with only a setting header keeps needs sign-in and Sign in again
  assert.strictEqual(by('readonly').tokenRefused, undefined, 'HEADER: X-MCP-Readonly only keeps needs sign-in');
  assert.strictEqual(by('readonly').canSignInAgain, true, 'HEADER: X-MCP-Readonly only keeps Sign in again');
  assert.deepStrictEqual(W.reasonOf(by('readonly')), { key: 'auth', word: 'Refused: needs sign-in' }, 'HEADER: X-MCP-Readonly only reads needs sign-in');
  // what keeps today's behaviour
  assert.strictEqual(by('tok401').tokenRefused, undefined, 'FR-232: a 401 keeps needs sign-in');
  assert.strictEqual(by('tok401').canSignInAgain, true, 'FR-232: a 401 keeps Sign in again');
  assert.strictEqual(by('oauth').tokenRefused, undefined, 'FR-232: an OAuth server keeps needs sign-in');
  assert.strictEqual(by('oauth').canSignInAgain, true, 'an OAuth server keeps Sign in again');
  assert.strictEqual(by('plain').tokenRefused, undefined, 'no header and no reference: not a token server');
  assert.strictEqual(by('nolist').tokenRefused, undefined, 'an entry Durbar does not know: today\'s words');
  assert.strictEqual(by('nolist').canSignInAgain, true, 'an unknown entry keeps Sign in again');
  assert.strictEqual(by('blocked').tokenRefused, undefined, 'a server with a Durbar sign-in record keeps Sign in (FR-229)');
  assert.strictEqual(by('blocked').canSignIn, true, 'the blocked row still offers Sign in');
  assert.strictEqual(by('opened').tokenRefused, undefined, 'a server with an open sign-in keeps it');
  assert.strictEqual(by('classed').tokenRefused, undefined, 'an adapter class decides its own reason');
  // control: without the entry lookup the same row would offer Sign in again (the rule is what removes it)
  const r0 = agentMcpReply({ ...base, tokenEntry: undefined });
  assert.strictEqual(r0.servers.find((x) => x.name === 'tok')!.canSignInAgain, true, 'control: without FR-232 the 403 row offers Sign in again');
  assert.strictEqual(r0.servers.find((x) => x.name === 'tok')!.tokenRefused, undefined, 'control: no entry, no token words');
  // no environment lookup: the row is still a refused token, with no names guessed
  const r1 = agentMcpReply({ ...base, envSet: undefined });
  assert.deepStrictEqual([r1.servers.find((x) => x.name === 'tok')!.tokenRefused, r1.servers.find((x) => x.name === 'tok')!.tokenVars], [true, undefined], 'no env lookup: no names');

  // secret safety: no token value in the reply, nor in any word the window builds from it
  const json = JSON.stringify(r);
  for (const t of [TOKEN_HDR, TOKEN_ENV, TOKEN_REF, ...PASTED.map((p) => p[1])]) assert.ok(!json.includes(t), `SECRET: a fake token never reaches the reply (${t.slice(0, 4)})`);
  const chat = { id: 'c1', name: 'Ana', app: 'GitHub Copilot' };
  for (const x of r.servers) {
    const words = [W.hintFor({ status: x.status, errorClass: x.errorClass, error: x.error, tokenRefused: x.tokenRefused, tokenVars: x.tokenVars, app: 'GitHub Copilot' }), JSON.stringify(W.reasonOf(x)), JSON.stringify(W.chatFinding(x, chat)), W.diagnostics({ server: x.name, entry: x, app: 'GitHub Copilot' }, redact)].join('\n');
    for (const t of [TOKEN_HDR, TOKEN_ENV, TOKEN_REF, ...PASTED.map((p) => p[1])]) assert.ok(!words.includes(t), `SECRET: no fake token in the window's words for ${x.name}`);
  }
  // the window's words for the rows above
  assert.deepStrictEqual(W.reasonOf(by('tok')), { key: 'token', word: 'Refused: token not accepted' }, 'WORDS: the token reason');
  assert.deepStrictEqual(W.reasonOf(by('tok401')), { key: 'auth', word: 'Refused: needs sign-in' }, 'WORDS: a 401 keeps needs sign-in');
  const hTok = W.hintFor({ status: 'failed', error: by('tok').error, tokenRefused: by('tok').tokenRefused, tokenVars: by('tok').tokenVars, app: 'GitHub Copilot' });
  assert.ok(hTok.startsWith(TOKEN_WORDS), 'WORDS: the token hint');
  assert.ok(hTok === TOKEN_WORDS + ' Agent Durbar does not see MISSING_VAR: set it where Agent Durbar starts, then open the app again.' && !/Dock|Finder/.test(hTok), 'WORDS: the unset variable by name');
  assert.ok(!/needs you to sign in|keeps the sign-in/.test(hTok), 'WORDS: no sign-in hint on a refused token');
  assert.ok(W.hintFor({ status: 'failed', error: ERR401, app: 'GitHub Copilot' }).startsWith('This server needs you to sign in.'), 'WORDS: a 401 keeps the sign-in hint');
}

function words(): void {
  const h2 = W.hintFor({ status: 'failed', tokenRefused: true, tokenVars: ['A_TOKEN', 'B_TOKEN'] });
  assert.ok(h2.includes('does not see A_TOKEN and B_TOKEN: set them'), 'WORDS: two names');
  const h3 = W.hintFor({ status: 'failed', tokenRefused: true, tokenVars: ['A', 'B', 'C', 'D'] });
  assert.ok(h3.includes('does not see A, B and C:') && !h3.includes('and D') && !h3.includes('C, D') && !h3.includes('D:'), 'WORDS: at most three names');
  const bad = W.hintFor({ status: 'failed', tokenRefused: true, tokenVars: ['<img src=x>', 'a b', 5, TOKEN_REF.slice(0, 70) + '-'] });
  assert.strictEqual(bad, W.fixFor('token'), 'WORDS: a name that is not a plain variable name is never shown');
  assert.strictEqual(W.hintFor({ status: 'needs-auth', tokenRefused: true }).startsWith('This server needs you to sign in.'), true, 'WORDS: only a failed row reads the token flag');
  // review of PR #1637: the window's own re-check (as if main had sent them): no pasted value is said through any of the window's paths
  const chatW = { id: 'c1', name: 'Ana', app: 'GitHub Copilot' };
  for (const [what, v] of PASTED) {
    const x = { name: 'team', status: 'failed', error: ERR403, tokenRefused: true, tokenVars: [v] };
    const hint = W.hintFor({ ...x, app: 'GitHub Copilot' });
    assert.strictEqual(hint, W.fixFor('token'), `RECHECK: the hint never names a pasted ${what}`);
    assert.strictEqual(W.fixFor('token', { vars: [v] }), W.fixFor('token'), `RECHECK: the strip fix never names a pasted ${what}`);
    const f = W.chatFinding(x, chatW)!;
    assert.ok(!JSON.stringify(f).includes(v), `RECHECK: the strip finding never holds a pasted ${what}`);
    const items = new Map<string, Finding>();
    const first = W.chatFinding({ name: 'team', status: 'failed', error: ERR403 }, chatW)!;
    items.set(first.key, first);
    W.launchToken(items, { ok: true, servers: [x] }, chatW);
    assert.ok(!JSON.stringify([...items.values()]).includes(v), `RECHECK: the launch strip never holds a pasted ${what}`);
    assert.ok(!W.diagnostics({ server: 'team', entry: x, app: 'GitHub Copilot' }, redact).includes(v), `RECHECK: Copy diagnostics never holds a pasted ${what}`);
    assert.ok(!JSON.stringify(W.reasonOf(x)).includes(v), `RECHECK: the reason never holds a pasted ${what}`);
  }
  for (const n of LEGIT) assert.ok(W.hintFor({ status: 'failed', tokenRefused: true, tokenVars: [n] }).includes('does not see ' + n + ':'), `RECHECK: the window names ${n}`);
  // fail closed: a window copy that has no shared rule names nothing
  const file = require.resolve(path.join(__dirname, '..', '..', 'src', 'renderer', 'mcpwords.js'));
  const keep = require.cache[file];
  delete require.cache[file];
  try {
    const bare = require(file) as Words;
    assert.strictEqual(bare.hintFor({ status: 'failed', tokenRefused: true, tokenVars: ['GITHUB_TOKEN'] }), bare.fixFor('token'), 'RECHECK: no shared rule, no name (fail closed)');
  } finally {
    require.cache[file] = keep;
  }
  assert.ok(W.fixFor('token', { vars: ['X_KEY'] }).includes('does not see X_KEY:'), 'WORDS: the strip fix names the variable');
  const chat = { id: 'c1', name: 'Ana', app: 'GitHub Copilot' };
  const f = W.chatFinding({ name: 'team', status: 'failed', error: ERR403, tokenRefused: true, tokenVars: ['X_KEY'] }, chat)!;
  assert.deepStrictEqual([f.rkey, f.reason], ['token', 'Refused: token not accepted'], 'STRIP: a token finding');
  assert.ok(f.fix.includes('X_KEY'), 'STRIP: the fix names the variable');
  // the strip first sees the `mcp` event (no entry), then main's reply turns the finding into a token one
  const items = new Map<string, Finding>();
  const auth = W.chatFinding({ name: 'team', status: 'failed', error: ERR403 }, chat)!;
  assert.strictEqual(auth.rkey, 'auth', 'STRIP: from the event alone it reads needs sign-in');
  items.set(auth.key, auth);
  assert.strictEqual(W.launchToken(items, { ok: true, servers: [{ name: 'team', status: 'failed', error: ERR403, tokenRefused: true }] }, chat), true, 'STRIP: the reply changes it');
  assert.strictEqual(items.get(auth.key)!.rkey, 'token', 'STRIP: now a token finding');
  assert.strictEqual(W.launchToken(items, { ok: true, servers: [{ name: 'team', status: 'failed', tokenRefused: true }] }, chat), false, 'STRIP: once only');
  const other = new Map<string, Finding>([[auth.key, auth]]);
  assert.strictEqual(W.launchToken(other, { ok: true, servers: [{ name: 'team', status: 'failed', error: ERR403 }] }, chat), false, 'STRIP: no flag, no change');
  assert.strictEqual(other.get(auth.key)!.rkey, 'auth');
  // Restart where it failed: a refused token is not skipped as a sign-in
  const rt = W.restartTargets([{ id: 'c1', entry: { status: 'failed', error: ERR403, tokenRefused: true, canRestart: true } }]);
  assert.strictEqual(rt.targets.length, 1, 'a refused-token row can be restarted where it failed');
}

function simCopy(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ts = require('typescript') as typeof import('typescript');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'sim.ts'), 'utf8');
  const block = src.slice(src.indexOf('/* mcptoken:begin */'), src.indexOf('/* mcptoken:end */'));
  assert.ok(block.includes('const simTokenRefusal'), 'the simulator marks its copy');
  const js = ts.transpileModule(block, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const [sim, entries] = new Function(js + '\nreturn [simTokenRefusal, SIM_TOKEN_ENTRIES];')() as [(t: unknown) => boolean, Record<string, { vars: string[] }>];
  // the simulator's rows reach the same window words: a name the shared rule refuses (paste-api) is never shown, TEAM_API_TOKEN is
  assert.ok(W.hintFor({ status: 'failed', tokenRefused: true, tokenVars: entries['team-api'].vars }).includes('does not see TEAM_API_TOKEN:'), 'SIM: team-api names TEAM_API_TOKEN');
  for (const [n, e] of Object.entries(entries)) {
    const said = [W.hintFor({ status: 'failed', tokenRefused: true, tokenVars: e.vars }), W.fixFor('token', { vars: e.vars }), JSON.stringify(W.chatFinding({ name: n, status: 'failed', error: ERR403, tokenRefused: true, tokenVars: e.vars }, { id: 'c', name: 'Ana' }))].join('\n');
    for (const v of e.vars) if (!envVarName(v)) assert.ok(!said.includes(v), `SIM: ${n}'s pasted key never reaches the window's words`);
  }
  assert.ok(entries['paste-api'] && !envVarName(entries['paste-api'].vars[0]), 'SIM: paste-api carries a value the shared rule refuses');
  for (const t of [ERR403, ERR401, 'Forbidden', '403 then 401', 'error 4031', 'unauthorised 403', '', undefined, 7, 'x'.repeat(3000) + ' 403']) assert.strictEqual(sim(t), isTokenRefusal(t), `SIM: the copy answers as main for ${String(JSON.stringify(t)).slice(0, 30)}`);
}

async function wiring(): Promise<void> {
  const electronPath = require.resolve('electron');
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const fake = {
    ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => unknown) => handlers.set(ch, fn), on: () => undefined },
    app: { getVersion: () => '0.0.0', getPath: () => os.tmpdir() },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    shell: { openExternal: async () => assert.fail('never the browser') },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  };
  require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fake } as unknown as NodeJS.Module;
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-058-token-')));
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    (require('../src/main/ipcguard') as typeof import('../src/main/ipcguard')).initSimGuard(false);
    const { registerMcpIpc } = require('../src/main/mcpipc') as typeof import('../src/main/mcpipc');
    const { McpStore } = require('../src/main/mcpstore') as typeof import('../src/main/mcpstore');
    /* eslint-enable @typescript-eslint/no-require-imports */
    const frame = { url: pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href };
    const win = { senderFrame: frame, sender: { mainFrame: frame } };
    const ad = new FakeAdapter({ displayName: 'GitHub Copilot', capabilities: { mcpSignIn: true, mcpSignInAgain: true } as never });
    fs.mkdirSync(path.join(root, 'copilot'));
    fs.writeFileSync(path.join(root, 'copilot', 'mcp-config.json'), JSON.stringify({ mcpServers: {
      team: { type: 'http', url: 'https://team.example/mcp', headers: { Authorization: 'Bearer ${DURBAR_T1621_MISSING}' } },
      keyed: { type: 'http', url: 'https://keyed.example/mcp', headers: { 'X-Api-Key': TOKEN_HDR } },
      wiki: { type: 'http', url: 'https://wiki.example/mcp' },
      readonly: { type: 'http', url: 'https://readonly.example/mcp', headers: { 'X-MCP-Readonly': 'true', Accept: 'application/json' } },
      pasted: { type: 'http', url: 'https://pasted.example/mcp', headers: { Authorization: 'Bearer ${' + PASTED[1][1] + '}' } },
    } }));
    const ws = path.join(root, 'ws');
    fs.mkdirSync(ws);
    const sid = await ad.start({ workspace: ws, quiet: true });
    const agents = new Map([[sid, { id: sid, cwd: ws, name: 'Mia', permMode: 'ask' } as never]]);
    const listeners: ((e: AgentEvent) => void)[] = [];
    const router = { onEvent: (fn: (e: AgentEvent) => void) => { listeners.push(fn); return () => undefined; }, forAgent: (id: string) => (agents.has(id) ? ad : undefined), adapterIdOf: () => 'fake' };
    const store = new McpStore(path.join(root, 'durbar-mcp.json'));
    store.load();
    const seen: string[] = [];
    registerMcpIpc({ store: () => store, agents, router: router as never, dev: { DURBAR_COPILOT_DIR: path.join(root, 'copilot') } as never, appOf: () => 'copilot', envSet: (n) => { seen.push(n); return false; } });
    listeners.forEach((l) => l({ type: 'mcp', sessionId: sid, timestamp: 1, servers: ['team', 'keyed', 'wiki', 'readonly', 'pasted'].map((n) => live(n, ERR403)) } as unknown as AgentEvent));
    const rp = (await handlers.get('agents:mcp')!(win, sid)) as { servers: AgentMcpEntry[] };
    const by = (n: string): AgentMcpEntry => rp.servers.find((x) => x.name === n)!;
    assert.deepStrictEqual([by('team').tokenRefused, by('team').tokenVars, by('team').canSignInAgain], [true, ['DURBAR_T1621_MISSING'], undefined], 'WIRING: the Copilot CLI entry is read: token words, the variable, no Sign in again');
    assert.deepStrictEqual([by('keyed').tokenRefused, by('keyed').tokenVars], [true, undefined], 'WIRING: a written header');
    assert.deepStrictEqual([by('wiki').tokenRefused, by('wiki').canSignInAgain], [undefined, true], 'WIRING: no header keeps Sign in again');
    assert.deepStrictEqual([by('readonly').tokenRefused, by('readonly').canSignInAgain], [undefined, true], 'WIRING: setting headers only (X-MCP-Readonly, Accept) keep Sign in again');
    assert.deepStrictEqual([by('pasted').tokenRefused, by('pasted').tokenVars], [true, undefined], 'WIRING: a pasted key inside ${...} is a refused token, never named');
    assert.deepStrictEqual(seen, ['DURBAR_T1621_MISSING'], 'WIRING: the injected environment lookup is the one used, for the referenced name only');
    assert.ok(!JSON.stringify(rp).includes(PASTED[1][1]), 'SECRET: a pasted key never leaves main');
    assert.ok(!JSON.stringify(rp).includes(TOKEN_HDR), 'SECRET: the header value never leaves main');
    await ad.stop(sid);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  pure();
  reply();
  words();
  simCopy();
  await wiring();
  done = true;
  process.exitCode = 0;
  console.log('[058] mcp token: PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
