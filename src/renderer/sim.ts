/**
 * Simulated live agents (dev mode). Feeds fake *normalized* AgentEvents through the same renderer
 * path as the Copilot adapter, so the office layout can be tested with 10-15 agents without
 * starting any session or spending AI credits.
 *
 * Enable with `DURBAR_SIM=15 npm start` (Electron main passes ?sim=15) or open
 * dist/renderer/index.html?sim=15 in a browser. Extra query params: simwaitold=1 (waiting requests look 2 minutes old), simtotals=1 (totals saved by a previous run), simunreported=<room>
 * (that room reports usage without credits), simfreeze=1 (no ticking),
 * simrooms=solo (one folder per agent), simrooms=1..5 (the agents spread over that many folders, in blocks; spec 001 FR-046), simhelpers=0 (no helpers), simplaces=1..3 (that many custom places, spec 024), seed=N, density=full|card|mini, open=<agent id>.
 *
 * Plain script (no imports/exports) so it runs unchanged in the sandboxed renderer.
 */
type AgentEvent = import('../adapters/types').AgentEvent;
type McpServerStatus = import('../adapters/types').McpServerStatus;
type AgentInfo = import('../shared/api').AgentInfo;
type DurbarApi = import('../shared/api').DurbarApi;
type FolderSetupItem = import('../shared/foldersetup').FolderSetupItem;
type PickedFile = import('../shared/api').PickedFile;
type ModelChoice = import('../shared/api').ModelChoice;
type AdapterInfo = import('../shared/api').AdapterInfo;
type McpServerInput = import('../shared/mcp').McpServerInput;
type McpSourceTag = import('../shared/api').McpSourceTag;
type FloorsState = import('../shared/api').FloorsState;
type FloorsResult = import('../shared/api').FloorsResult;
type ScheduleInfo = import('../shared/api').ScheduleInfo;
type SchedulesInfo = import('../shared/api').SchedulesInfo;
type ModelSwitchRequest = import('../shared/modelswitch').ModelSwitchRequest;
type ModelSwitchResult = import('../shared/modelswitch').ModelSwitchResult;
type ContextTier = import('../shared/modelswitch').ContextTier;
type ActivityRow = import('../shared/activity').ActivityRow;
type EditInfo = import('../shared/edits').EditInfo;

/** Spec 005 FR-026: a simulated diff (removed lines, then added lines) with its counts. */
function simDiffOf(oldL: string[], newL: string[], at: number): { diff: string; added: number; removed: number } {
  const head = `@@ -${oldL.length ? at : 0},${oldL.length} +${newL.length ? at : 0},${newL.length} @@`;
  return { diff: [head, ...oldL.map((l) => '-' + l), ...newL.map((l) => '+' + l)].join('\n'), added: newL.length, removed: oldL.length };
}
function simEdit(path: string, kind: 'edit' | 'create', oldL: string[], newL: string[]): EditInfo {
  return { files: [{ path, kind, ...simDiffOf(oldL, newL, kind === 'create' ? 1 : 8) }] };
}

interface SimOptions {
  n: number;
  freeze?: boolean;
  solo?: boolean;
  /** Spec 001 FR-046: spread the agents over this many folders (1 to 5, in blocks of neighbours), page address `simrooms=<n>`. */
  rooms?: number;
  /** Spec 001 FR-046: no helpers at all (page address `simhelpers=0`). */
  noHelpers?: boolean;
  seed?: number;
  /** Spec 033: three floors (Ground floor, Client A, Personal) with the rooms spread over them. */
  floors?: boolean;
  /** Issue #126: some main agents receive a session title, as the runtime sends after the first prompt (page address `simtitles=1`; `simtitles=long`: the first one is 120 characters, the longest a session title can be, spec 052 FR-174). */
  titles?: boolean | 'long';
  /** Spec 059 FR-016: every main agent carries a 60-character user name, and (spec 052 FR-170) every folder a long name (page address `simnames=long`), to check that the office still fits; agent 3 has no alias and a long first-prompt title with one unbroken URL-like token (FR-019). */
  names?: 'long';
  /** Spec 052 FR-170 (T155): long replies and long sub-agent prompts that run to the right edge of the chat, to check that the Copy button covers no text (page address `simreply=long`). */
  reply?: 'long' | 'secrets';
  /** Spec 012 FR-130: the first Claude agent (or the first agent) asks a question (page address `simquestion=1`). */
  /** Spec 052 FR-141 (issue #367): the first agent has eight session grants with long names (page address `simgrants=many`). */
  grants?: 'many' | 'stuck'; /* 'stuck': revokes are accepted but never remove anything (a failed revoke) */
  question?: boolean | 'long' | 'compact'; /* 'long' (spec 052 FR-140): a long question text and long option labels and descriptions (FR-160); 'compact' (FR-162, FR-163): a short question, then six compactions in a row while it waits */
  /** Spec 012 FR-151: an MCP server asks one agent for input: a small form (`simelicit=1`) or an https page to open (`simelicit=url`). */
  elicit?: string;
  /** Spec 033: names of floors that start switched off. */
  floorsOff?: string[];
  /** Room name whose agents report usage without a credit figure (spec 011 FR-029): shows "credits not reported". */
  unreported?: string;
  /** Start with totals saved by a previous run for two folders (spec 011 FR-029), as after a restart. */
  seedTotals?: boolean;
  /** Spec 024 FR-026: start with this many custom places (0 to 3) and two fake servers mapped to them. Without it the page address (`simplaces=N`) decides. */
  places?: number;
  /** Pending permission requests carry a time 2 minutes in the past, so "impatient" (spec 034) can be seen at once. */
  waitOld?: boolean;
  /** Spec 001 FR-038: start with three schedules (two folders; the last one's previous run was missed), so the Postbox has something to show. */
  sched?: boolean;
  /** Spec 001 FR-038 (`simschedfire=N`): a one-off schedule for the first idle agent, due N seconds after start (the flying letter). */
  schedFire?: number;
  /** Spec 005 FR-026 (`simedits=1`): the first agent edits files: a two-file patch, a new file, a refused delete, then an edit whose arguments stream in and stay open. */
  edits?: boolean;
}

/** A grant scope as the broker builds it: key and chip label. */
type SimScope = { key: string; label: string };
interface SimAgent {
  info: AgentInfo;
  room: string;
  state: 'working' | 'thinking' | 'waiting' | 'error' | 'done' | 'idle';
  intent: string;
  prompt: string;
  attachments?: string[];
  helpers: number;
  tool: number;
  think: number;
  open?: string;
  files: string[];
  /** Pending permission request (the agent is waiting for the user). */
  perm?: { requestId: string; kind: string; summary: string; scopeKey: string; scopeLabel: string; file: string; cont: 'tool' | 'edit'; folders?: SimScope[] };
  /** "Allow for this session" grants: key -> chip label. */
  grants: Map<string, string>;
  /** Context window of the fake session (tokens now / size). */
  ctx?: { tokens: number; limit: number };
  /** Models the fake runtime "routes" this agent's calls to (auto). */
  models?: string[];
  /** Agent ids that switched an MCP server off (spec 019). */
  mcpOff?: Set<string>;
  /** Spec 058 (simulator): servers under a canned Restart, and failed servers a Restart brought back. */
  mcpRestarting?: Set<string>;
  mcpFixed?: Set<string>;
  /** Spec 058 FR-071 (simmcpauth): servers with a sign-in open (Sign in pressed); `opened` after Open sign-in page. Dropped by End session and Restart session. */
  mcpSign?: Map<string, { opened: boolean; at: number; again?: boolean }>;
  /** The last `mcp` event emitted for this session, like main's `live` list: the dialog's reply reads it (a driver can emit its own). */
  mcpReported?: SimAgent['mcpLive']; /* the last list a driver reported through `__durbarSimEmit` (not the simulator's own): its names stay in the dialog */
  mcpAppOff?: Set<string>; /* servers a reported `mcp` list had as `disabled` that this agent's switch did not turn off (the agent app's own config) */
  mcpLive?: { name: string; status: string; error?: string; errorClass?: McpServerStatus['errorClass']; transport?: string }[];
  /** Spec 058 FR-092: when each server's state started, as main keeps it (the same `mcpHealthUpdate` from src/shared/mcphealth.ts). */
  mcpHealth?: Map<string, SimHealthMark>;
  /** Simulated credit use in nano-AIU, and the open "limit reached" question (spec 011). */
  used?: number;
  /** Dollar estimate used (kinds with `capUnit: 'usd'`). */
  usd?: number;
  limitReq?: string;
  /** Spec 066: an open plan (request id and the message it plans). */
  planReq?: { id: string; text: string };
  /** Model and context handling (spec 030). */
  tier?: ContextTier;
  /** A switch asked for during a turn: applies when the turn ends and is dropped by Stop (both seen on a real runtime, spec 030 T042). */
  pendingModel?: { req: ModelSwitchRequest; queueId: string };
  /** Window the next context report will carry (the runtime tells it with the next message, not at once). */
  pendingLimit?: number;
  compactions?: number;
  compacting?: boolean;
  /** Stay near the limit (no automatic compaction) so the start-fresh note can be shown. */
  noAuto?: boolean;
  /** Spec 068: the simulated usage limit holds until this time (ms); a message before it hits the limit again. */
  breakUntil?: number;
}

/** Fake models with prices in credits per million tokens (sim: made-up numbers, not Copilot's). Sim Preview reports no price on purpose. */
/* spec 012 FR-120: what a Claude kind's list looks like (the shape of `claudeModelOptions`); a simulation, not Claude's real list */
const SIM_CLAUDE_MODELS: ModelChoice[] = [
  { id: 'default', name: 'Default (recommended)', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'sonnet', name: 'Sim Sonnet', efforts: ['low', 'medium', 'high'] },
  { id: 'haiku', name: 'Sim Haiku', efforts: [] },
];
/* spec 043: what a session's custom agents look like (made up; no real agent files) */
/** Spec 073 FR-011: canned "/" entries per agent app (folder, user, and Claude Code's built-ins); nothing is read from disk. */
type SimSlash = { name: string; description?: string; argumentHint?: string; source: 'folder' | 'user' | 'app'; kind: 'skill' | 'command' | 'prompt' | 'builtin'; where?: string; note?: string };
function simSlash(kind: string): SimSlash[] {
  const common: SimSlash[] = [
    { name: 'review-pr', description: 'Review a pull request: risks, tests, and what to change', argumentHint: '<number>', source: 'folder', kind: 'command', where: '.claude/commands/review-pr.md' },
    { name: 'release-notes', description: 'Draft release notes from the merged pull requests', source: 'folder', kind: 'skill', where: '.claude/skills/release-notes/SKILL.md' },
    { name: 'refactor-plan', description: 'Plan a refactor in small, safe steps', argumentHint: '<module>', source: 'folder', kind: 'skill', where: '.claude/skills/refactor-plan/SKILL.md' },
    { name: 'triage', description: 'Sort new issues by area and urgency', source: 'folder', kind: 'command', where: '.claude/commands/triage.md' },
    { name: 'explain', description: 'Explain a file or a function in plain words', argumentHint: '<path>', source: 'user', kind: 'command', where: '~/.claude/commands/explain.md' },
    { name: 'standup', description: 'Summarise yesterday’s commits for the stand-up', source: 'user', kind: 'skill', where: '~/.claude/skills/standup/SKILL.md' },
    // spec 073 delta 2026-10-23: a VS Code prompt file, listed for every app; its settings are shown, not applied
    { name: 'write-tests', description: 'Write unit tests for a file (VS Code settings not applied: mode, tools)', argumentHint: '<file>', source: 'folder', kind: 'prompt', where: '.github/prompts/write-tests.prompt.md', note: 'VS Code settings not applied: mode, tools.' },
  ];
  if (kind === 'claude')
    return common.concat([
      { name: 'compact', description: 'Free up context by summarizing the conversation so far', argumentHint: '<optional custom summarization instructions>', source: 'app', kind: 'builtin' },
      { name: 'context', description: 'Show current context usage', source: 'app', kind: 'builtin' },
      { name: 'init', description: 'Initialize a new CLAUDE.md file with codebase documentation', source: 'app', kind: 'builtin' },
      { name: 'security-review', description: 'Complete a security review of the pending changes on the current branch', source: 'app', kind: 'builtin' },
    ]);
  const swap = (w?: string): string | undefined => (w ? (kind === 'codex' ? w.replace('.claude/commands/', '.agents/skills/').replace('.claude/skills/', '.agents/skills/').replace('~/.claude/', '~/.agents/') : w.replace('.claude/commands/', '.github/skills/').replace('.claude/skills/', '.github/skills/').replace('~/.claude/', '~/.copilot/')) : w);
  const skills: SimSlash[] = common.map((e) => (e.kind === 'prompt' ? e : { ...e, kind: 'skill' as const, where: swap(e.where) }));
  return kind === 'codex' ? skills.concat([{ name: 'prompts:draft-pr', description: 'Draft a pull request description', argumentHint: 'TITLE', source: 'user', kind: 'prompt', where: '~/.codex/prompts/draft-pr.md' }]) : skills;
}

const SIM_SLASH_DESC = 'Draft the release notes from every merged pull request since the last tag, grouped by area, with breaking changes first and a link to each pull request and the issues it closes';
const SIM_SLASH_LONG: SimSlash[] = [
  { name: 'x'.repeat(64), description: SIM_SLASH_DESC.slice(0, 200), argumentHint: '<from-tag> <to-tag> <area> <audience>', source: 'folder', kind: 'command', where: '.claude/commands/' + 'x'.repeat(64) + '.md' },
  { name: 'release-notes-for-the-customer-reconciliation-batch-jobs-2026', description: SIM_SLASH_DESC.slice(0, 120), source: 'user', kind: 'skill', where: '~/.claude/skills/release-notes-long/SKILL.md' },
];

/* Spec 073 FR-013/FR-014 (issue #608), page address simslash=secret: a folder skill and a command whose name, argument hint, description
   and place hold fake token shapes, also split by Markdown, escaped, and one that straddles the tooltip's 300-character cut. Built at
   run time: the file holds no secret-looking literal. check:slash-suggest asserts none of them reaches the list, its tooltips, ARIA or
   the "Sent the text of" note. */
const SIM_TOK = { ghp: 'gh' + 'p_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8', pat: 'github' + '_pat_' + '11ABCDEFG0aBcDeFgHiJkL_mNoPqRsTuVwXyZ0123456789abcdefghij', sk: 's' + 'k-' + 'proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789' };
const simSlashSecret = (): SimSlash[] => {
  const g = SIM_TOK.ghp;
  const desc = ('Deploy check: ' + g.slice(0, 2) + '`' + g.slice(2) + '` then **' + g.slice(0, 24) + '**' + g.slice(24) + ' and ' + g.replace('_', '\\_') + ' ').padEnd(200, '.').slice(0, 200);
  const line = '/deploy-check'.length + 1 + desc.length + 1 + 'Sends the text of '.length; // where the place starts in the tooltip
  const where = '.claude/commands/' + 'n'.repeat(285 - line - '.claude/commands/'.length - 1) + '-' + SIM_TOK.sk + '.md'; // the sk token starts at 285 of 300
  return [
    { name: g, description: 'Skill named by a token: ' + SIM_TOK.sk, argumentHint: '<' + SIM_TOK.pat + '>', source: 'folder', kind: 'skill', where: '.claude/skills/' + g + '/SKILL.md' },
    { name: 'deploy-check', description: desc, argumentHint: '<env> ' + SIM_TOK.pat, source: 'folder', kind: 'command', where },
    // a VS Code prompt file whose `${input:NAME}` is token-shaped: the send's note echoes it (review of PR #614, FR-013)
    { name: 'token-input', description: 'A prompt file with a token-shaped input name', source: 'folder', kind: 'prompt', where: '.github/prompts/token-input.prompt.md', note: 'VS Code settings not applied: mode; left as written: ${input:' + g + '}.' },
  ];
};
/** The simulated list: the long or secret entries the page address asks for, then the kind's own (FR-011). */
const simSlashFor = (kind: string, q: URLSearchParams): SimSlash[] => [...(q.get('simslash') === 'long' ? SIM_SLASH_LONG : q.get('simslash') === 'secret' ? simSlashSecret() : []), ...simSlash(kind)];

const SIM_PROFILES = [
  { id: 'reviewer', name: 'Reviewer', description: 'Reviews changes and points at risks; never edits files', source: 'repo' as const, path: '~/work/mcp-swiss/.github/agents/reviewer.agent.md', tools: ['view', 'grep', 'glob'], model: 'sim-deep' },
  { id: 'docs-writer', name: 'Docs writer', description: 'Writes and tidies documentation in plain English', source: 'user' as const, path: '~/.copilot/agents/docs-writer.agent.md' },
  { id: 'release-helper', name: 'Release helper', description: 'Prepares release notes from merged pull requests', source: 'repo' as const, path: '~/work/mcp-swiss/.github/agents/release-helper.agent.md', mcpServers: ['github'] },
];
const SIM_MODELS: ModelChoice[] = [
  { id: 'auto', name: 'Auto', efforts: [] },
  { id: 'sim-fast', name: 'Sim Fast', multiplier: 0.33, efforts: [], contextWindow: 128000, priceClass: 'low', pricing: { inputPerMTok: 20, outputPerMTok: 100, cachedPerMTok: 2 } },
  { id: 'sim-mid', name: 'Sim Mid', multiplier: 1, efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', contextWindow: 272000, priceClass: 'medium', pricing: { inputPerMTok: 80, outputPerMTok: 400, cachedPerMTok: 8 } },
  { id: 'sim-deep', name: 'Sim Deep', multiplier: 3, efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', contextWindow: 200000, priceClass: 'high', contextTiers: ['default', 'long'], longWindow: 400000,
    pricing: { inputPerMTok: 250, outputPerMTok: 1250, cachedPerMTok: 25, long: { inputPerMTok: 500, outputPerMTok: 1875 } } },
  { id: 'sim-preview', name: 'Sim Preview', efforts: [], contextWindow: 128000 },
];
const SIM_MODEL_BY_AGENT: Record<number, string> = { 3: 'sim-fast', 4: 'sim-fast', 5: 'sim-deep' };

/** Simulated caps (AI credits, min 30 like the runtime) by agent name; Omar's calls are expensive (11 AIU each), so he reaches 30 in his first turn (spec 011 FR-016). */
const SIM_CAPS: Record<string, number> = { Ada: 50, Mira: 30, Omar: 30 };
/** spec 012 FR-150: dollar caps for kinds that cap their dollar estimate (simulated Claude Code). */
/* spec 059 FR-002 (the same messages as src/shared/names.ts; the simulator keeps its own copy, it never imports main code) */
function simNameError(v: unknown): string {
  if (typeof v !== 'string') return 'Use 1 to 60 characters.';
  if (/[\u00ad\u034f\u115f\u180e\u200b\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\u3164\ufeff\ufff9-\ufffb]/.test(v)) return 'Remove control or hidden characters.';
  const n = v.replace(/\s+/g, ' ').trim();
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(n)) return 'Remove control or hidden characters.';
  if ([...n].length > 60) return 'Use 1 to 60 characters.';
  if (/gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}/.test(n)) return 'That looks like a secret. Use another name.';
  return '';
}
/** Spec 041 FR-065 (issue #541): a done reply that holds three token shapes, so a driver can check none reaches the office floor (page address `simreply=secrets`). Built at run time: the file holds no secret-looking literal. */
const SECRETS_TEXT = 'Token check: gh' + 'p_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8 and github' + '_pat_' + '11ABCDEFG0aBcDeFgHiJkL_mNoPqRsTuVwXyZ0123456789abcdefghij and s' + 'k-' + 'proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789.';
/** The same check for commands and URLs: a value that only the command and URL masks know (`--api-key X`, `?key=X`). */
const SECRET_KEY = 'Kd93' + 'LmP27xQvB' + 'w5Zt';
/** Filler so that the first planted token (after SECRETS_TEXT's 13-character label) starts at character n: a cut at n + a few characters then leaves a short piece of it that no pattern knows, which only masking BEFORE the cut prevents. */
const FILL = (n: number): string => 'Checking the registry module and its tests. '.repeat(6).slice(0, n - 14) + ' ';
const LONG_TEXT = 'Every paragraph here is long on purpose so that its lines run to the right edge of the chat, where a Copy button must never cover a word. '.repeat(6).trim() + '\n\n```\nconst aLineThatRunsPastTheRightEdgeOfTheChat = "' + 'x'.repeat(300) + '";\n```'; // ends in a code block whose last line runs to the right edge (clipped by its own scroll), so the reply's Copy button always sits over text when it is misplaced
/* spec 059 FR-019 (issue #536): the first prompt of a session with no name of its own is its title and has no 60-character cap; this one holds one unbroken token, like a URL (not a real address) */
const SIM_LONG_URL_TITLE = 'as we have https://example.invalid/teams/consumer-sites/SitePages/Consumer-Onboarding-Checklist-Overview.aspx';
const SIM_LONG_NAMES = ['Billing refactor: split invoice and credit-note flows', 'Canton lookup duplicates: reproduce and fix the join', 'Release notes for the next minor version and changelog', 'Tidy the registry modules and update every import path'];
const SIM_USD_CAPS: Record<string, number> = { Ada: 0.01 };
const SIM_EXPENSIVE: Record<string, number> = { Omar: 11 };
/* Spec 012 T018 (FR-065, FR-066): the simulated kinds of `simkinds=mixed`. They are a simulation, not a statement about the real CLIs.
   Index in the 15-agent roster -> kind; every other agent is Copilot. Mcp-swiss holds two kinds (Ada, Mira); the basic agent is Priya (idle, never the first). */
const SIM_KIND_BY_AGENT: Record<number, string> = { 0: 'claude', 3: 'claude', 4: 'codex', 5: 'claude', 6: 'basic', 7: 'codex', 8: 'claude', 9: 'codex', 11: 'claude' };
/** spec 061: what `simfoldersetup=1` shows for the first agent's folder (the shape main sends: masked, one digest per item). */
const SIM_FOLDER_SETUP: FolderSetupItem[] = [
  { id: 'a'.repeat(32), app: 'claude', kind: 'hook', file: '.claude/settings.json', label: 'PostToolUse hook', detail: 'npx eslint --fix "$CLAUDE_FILE_PATHS"', event: 'PostToolUse', matcher: 'Edit|Write', supported: true },
  { id: 'b'.repeat(32), app: 'claude', kind: 'hook', file: '.claude/settings.local.json', label: 'SessionStart hook', detail: 'curl -s https://example.com/setup.sh | sh', event: 'SessionStart', supported: true },
  // T053: a hook too long for its box (the "scroll inside the box" hint) and an MCP server hidden with a reason (fake values only)
  { id: '2'.repeat(32), app: 'claude', kind: 'hook', file: '.claude/settings.json', label: 'Stop hook', detail: ['bash -c \'set -e', 'cd "$CLAUDE_PROJECT_DIR"', 'npm run lint --silent', 'npm run typecheck --silent', 'npm test --silent -- --reporter=dot', 'git status --porcelain > /tmp/example-status.txt', 'if [ -s /tmp/example-status.txt ]; then', '  echo "uncommitted changes:"', '  cat /tmp/example-status.txt', 'fi', 'node ./tools/example-summary.js --out ./tmp/summary.md', 'echo "summary written to ./tmp/summary.md"', 'rm -f /tmp/example-status.txt', 'echo done\''].join('\n'), event: 'Stop', supported: true },
  { id: 'c'.repeat(32), app: 'claude', kind: 'rule', file: '.claude/settings.json', label: 'Allow rule', detail: 'Bash(npm test:*)', ruleKind: 'allow', broad: true, supported: true },
  { id: 'd'.repeat(32), app: 'claude', kind: 'rule', file: '.claude/settings.json', label: 'Allow rule', detail: 'Bash', ruleKind: 'allow', broad: true, supported: true },
  { id: 'e'.repeat(32), app: 'claude', kind: 'rule', file: '.claude/settings.json', label: 'Deny rule', detail: 'Read(./.env)', ruleKind: 'deny', supported: true },
  { id: 'f'.repeat(32), app: 'any', kind: 'mcp', file: '.mcp.json', label: 'MCP server github', detail: 'GITHUB_TOKEN=[hidden] LOG_LEVEL=info npx -y @modelcontextprotocol/server-github', secretNames: ['GITHUB_TOKEN'], supported: true },
  { id: '1'.repeat(32), app: 'any', kind: 'mcp', file: '.mcp.json', label: 'MCP server notes', detail: "NOTES_FLAGS=--quiet sh -c 'node ./tools/example-notes-server.js $NOTES_FLAGS'", hidden: true, hiddenWhy: 'It starts sh, which can run what it is given, and hands it env values (NOTES_FLAGS): they can be commands, so read them above. Ticking it runs them too.', supported: true },
  { id: '0'.repeat(32), app: 'codex', kind: 'hook', file: '.codex/hooks.json', label: 'SessionStart hook', detail: 'echo ready', event: 'SessionStart', supported: false, unsupportedWhy: 'Codex does not run a folder\u2019s hooks from Agent Durbar (they need its own review in a terminal).' },
];
const simSetupDecisions = new Map<string, { accepted: string[]; declined: string[] }>();
 const SIM_PLAN_CAPS = { planMode: true }; // spec 066: every simulated kind can plan first
/** Spec 058 FR-020: the agent app's name the simulator gives the MCP dialog (the real one is the adapter's `displayName`). */
interface SimHealthMark { status: string; since: number; ran: boolean; afterRunning: boolean }
/* spec 058 FR-092: the shared rule (src/shared/mcphealth.ts, loaded in the page after exports-shim.js), read at call time; missing = no marks */
const simHealth = (prev: Map<string, SimHealthMark> | undefined, servers: { name: string; status?: string }[]): Map<string, SimHealthMark> | undefined => {
  const f = (window as unknown as { exports?: { mcpHealthUpdate?: (p: unknown, l: unknown, now: number) => Map<string, SimHealthMark> } }).exports?.mcpHealthUpdate;
  return typeof f === 'function' ? f(prev, servers, Date.now()) : undefined;
};
const SIM_APP_NAME: Record<string, string> = { copilot: 'GitHub Copilot', claude: 'Claude Code', codex: 'OpenAI Codex' };
const SIM_COPILOT_CAPS = { ...SIM_PLAN_CAPS, remoteService: { name: 'GitHub', host: 'github.com', mobile: 'GitHub Mobile' }, interrupt: true, resume: true, images: true, models: true, effort: true, permissionModes: ['read-only', 'ask', 'allow'], permModeSwitch: 'live', usage: { tokens: true, costUsd: false, nanoAiu: true }, context: true, caps: true, helpers: true, history: true, mcpStatus: true, mcpToggle: true, mcpStart: 'next-message', mcpToggleApplies: 'live', mcpRestart: true, handoff: true, remote: true, oneShot: true, deleteSession: true, renameSession: 'any' } as AdapterInfo['capabilities'];
const SIM_MIXED_KINDS: AdapterInfo[] = [
  { id: 'claude', displayName: 'Claude Code (simulated)', state: 'ready', version: 'sim', capabilities: { ...SIM_COPILOT_CAPS, modelSwitch: { verified: true, contextTier: false }, usage: { tokens: true, costUsd: true, nanoAiu: false }, caps: true, capUnit: 'usd', oneShot: true, remote: true, remoteService: { name: 'Claude', host: 'claude.ai', mobile: 'the Claude app' }, mcpToggle: true, mcpStart: 'next-message', permModeSwitch: 'live', helpers: true, history: true, deleteSession: false, renameSession: 'next-turn' } }, // spec 006 FR-028: Claude Code has no per-session delete
  { id: 'codex', displayName: 'Codex (simulated)', state: 'ready', version: 'sim', capabilities: { ...SIM_COPILOT_CAPS, modelSwitch: { verified: true, contextTier: false }, usage: { tokens: true, costUsd: false, nanoAiu: false }, caps: false, permModeSwitch: 'next-message', history: false, helpers: false, mcpToggle: true, mcpStart: 'session', mcpToggleApplies: 'next-message', mcpRestart: false, remote: false } }, // spec 058 T028: the real switch values (FR-133, FR-147)
  { id: 'basic', displayName: 'Basic agent (simulated)', state: 'ready', version: 'sim', capabilities: { interrupt: false, resume: false, images: false, models: false, effort: false, permissionModes: ['read-only'], permModeSwitch: 'none', usage: { tokens: true, costUsd: false, nanoAiu: false }, context: false, caps: false, helpers: false, history: false, mcpStatus: false, mcpToggle: false } as AdapterInfo['capabilities'] },
];

(function () {
  const SIM_ROOM_ORDER = ['mcp-swiss', 'swisscontract-ai', 'command-center', 'blog', 'infra-notes'];
  const ROOM_DEFS: Record<string, string> = {
    'mcp-swiss': '~/work/mcp-swiss',
    'swisscontract-ai': '~/work/swisscontract-ai',
    'command-center': '~/work/command-center',
    blog: '~/work/blog',
    'infra-notes': '~/work/infra-notes',
  };

  type Row = [string, string, string, SimAgent['state'], string, number, string[]];
  // name, role, room, state, intent, helpers, files
  const ROSTER: Row[] = [
    ['Ada', 'Refactorer', 'mcp-swiss', 'working', 'Splitting the tool registry into per-domain modules', 2, ['src/registry.ts', 'src/tools/index.ts', 'packages/server/src/adapters/federal-register/handlers/company-search/normalizeCantonName.ts']],
    ['Mira', 'Test writer', 'mcp-swiss', 'thinking', 'Planning edge cases for the canton lookup tool', 0, ['src/tools/cantons.ts', 'test/cantons.test.ts']],
    ['Jonas', 'Reviewer', 'mcp-swiss', 'waiting', 'Needs your OK to rename public tool find_company', 0, ['src/tools/companies.ts', 'CHANGELOG.md']],
    ['Noor', 'Docs writer', 'mcp-swiss', 'done', 'README tool table updated and linked from the docs index', 0, ['README.md', 'docs/index.md']],
    ['Elif', 'Contract parser', 'swisscontract-ai', 'working', 'Extracting clauses from 14 sample contract PDFs', 6, ['pipeline/extract.py', 'samples/']],
    ['Tomas', 'Prompt tuner', 'swisscontract-ai', 'error', 'Eval run failed: provider rate limit reached (429)', 0, ['evals/run.py', 'evals/config.yaml']],
    ['Priya', 'Migration', 'swisscontract-ai', 'idle', 'Ready. Send a message to start.', 0, ['db/migrations/0007_clauses.sql']],
    ['Kenji', 'Evaluator', 'swisscontract-ai', 'waiting', 'Which model should run the baseline comparison?', 1, ['evals/baseline.py']],
    ['Sven', 'UI builder', 'command-center', 'working', 'Wiring the agent panel to the status store', 0, ['src/panel/AgentPanel.tsx', 'src/store/status.ts']],
    ['Lena', 'Accessibility', 'command-center', 'waiting', 'Choose the focus ring colour: sage or blue?', 0, ['src/styles/focus.css']],
    ['Omar', 'Bug fixer', 'command-center', 'thinking', 'Tracing why status stays stale after Pause', 0, ['src/store/status.ts']],
    ['Clara', 'Editor', 'blog', 'working', 'Tightening the intro of the MCP post', 3, ['posts/mcp-in-practice.md']],
    ['Hugo', 'Researcher', 'blog', 'idle', 'Ready. Send a message to start.', 0, ['research/a2a-notes.md']],
    ['Rosa', 'Social snippets', 'infra-notes', 'working', 'Drafting three post snippets from the MCP article', 0, ['posts/snippets.md']],
    ['Maya', 'Release notes', 'infra-notes', 'done', 'v0.3 release notes drafted and grouped by user-visible change', 0, ['CHANGELOG.md']],
  ];
  // Spec 052 FR-046: each waiting agent asks for its own thing, tied to its role and task (was one rename request for all of them)
  // Spec 052 FR-063: Jonas's edit carries a diff, like a Claude Code Edit request (the card's "Show the change")
  const WAIT_REQ: Record<string, { kind: 'write' | 'shell'; summary: string; target: string; diff?: string; scope?: SimScope & { folders?: SimScope[] } }> = {
    Jonas: {
      kind: 'write', summary: 'Edit src/tools/companies.ts (rename find_company to search_companies)', target: 'src/tools/companies.ts',
      diff: ['--- a/src/tools/companies.ts', '+++ b/src/tools/companies.ts', '@@ -12,7 +12,7 @@', ' import { z } from \'zod\';', ' ', ' export const companyTools = {', "-  find_company: {", "+  search_companies: {", "     description: 'Look up Swiss companies by name or UID',", '     input: z.object({ query: z.string().min(2) }),', '     handler: findCompany,'].join('\n'),
    },
    Kenji: { kind: 'shell', summary: 'Run python evals/baseline.py --compare', target: 'python evals/baseline.py' },
    Lena: { kind: 'write', summary: 'Edit src/styles/focus.css (focus ring colour)', target: 'src/styles/focus.css' },
  };
  /**
   * Spec 052 FR-172: `simcodexfile=1` makes a waiting Codex agent's write request look like the Codex adapter's card (the files,
   * kind and diff from the `fileChange` item); `simcodexfile=none` like one for which Codex named no file; `simcodexfile=many` like a
   * change in five folders (review on #470: the session button keeps "and N more folders"). Only with `simkinds=mixed`.
   */
  /** Spec 052 FR-172: the broker's grant scope for a write in these folders (`grantScope` in src/adapters/permissions.ts, POSIX). */
  const multiScope = (dirs: string[]): SimScope & { folders?: SimScope[] } => {
    const folders = dirs.map((d) => ({ key: 'write:' + d, label: 'write in ' + d.split('/').slice(-2).join('/') + '/' }));
    if (folders.length === 1) return folders[0];
    const names = folders.map((x) => x.label.replace(/^write in /, ''));
    return { key: 'write-folders:' + folders.map((x) => x.key).sort().join('\n'), label: `write in ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more folders` : ''}`, folders };
  };
  // spec 005 FR-056 (issue 627): like the real adapters, only Copilot reports the parts of its context window; Claude Code and Codex a total
  const ctxParts = (s: { info: { adapterId?: string } }, tokens: number, messages: number) =>
    (s.info.adapterId ?? 'copilot') === 'copilot' ? { system: 5840, conversation: Math.max(0, tokens - 13500), toolDefinitions: 7668, messages } : {};
  const codexFileReq = (s: { info: { adapterId?: string }; files: string[] }): (typeof WAIT_REQ)[string] | undefined => {
    const v = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('simcodexfile') : null;
    if (!v || s.info.adapterId !== 'codex') return undefined;
    if (v === 'none') return { kind: 'write', summary: 'write (Codex did not say which file)', target: '' };
    const f = s.files[0];
    const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '.';
    if (v === 'many') {
      const dirs = ['components', 'documentation', 'scripts', 'src/lib', 'tests'];
      return { kind: 'write', summary: `write ${dirs[0]}/Button.tsx (+${dirs.length - 1} more)`, target: dirs[0] + '/Button.tsx', scope: multiScope(dirs) };
    }
    return {
      kind: 'write', summary: `write ${f} (+1 more)`, target: f,
      // the adapter's grant scope names the folder of every file (review on #470): here the file's own folder and docs/
      scope: multiScope([dir, 'docs']),
      diff: [`--- a/${f}`, `+++ b/${f}`, '@@ -3,3 +3,3 @@', ' :focus-visible {', '-  outline: 2px solid var(--sage);', '+  outline: 2px solid var(--blue);', '   outline-offset: 2px;', '--- a/docs/a11y.md', '+++ b/docs/a11y.md', '@@ -0,0 +1,2 @@', '+# Focus ring', '+Blue, 2px, offset 2px.'].join('\n'),
    };
  };
  const HELPER_NAMES: [string, string, string][] = [
    ['Tests', 'Running vitest on the changed modules', 'working'],
    ['Lint', 'Checking eslint and prettier on touched files', 'thinking'],
    ['Docs', 'Updating the JSDoc for exported tools', 'done'],
    ['OCR', 'Reading 3 scanned PDFs', 'working'],
    ['Tag', 'Choosing labels for ambiguous clauses', 'thinking'],
    ['Types', 'Fixing 4 strict-null errors', 'failed'],
    ['Diff', 'Summarising the diff for review', 'working'],
  ];
  // Reasoning summaries as the real runtime sends them: a bold heading line, then plain sentences (markdown).
  const THINK = [
    '\n\n**Planning the change**\n\nThe request touches a few files, so I will read them before changing anything. ',
    'Splitting by domain keeps the public API stable and the diff easy to review. ',
    '\n\n**Checking callers**\n\nI should check callers first, because a rename here is a *breaking change* for any client that pins tool names. ',
    '\n\n**Choosing an order**\n\nEleven of the fourteen inputs have a text layer; the rest need OCR, so I will parse the easy ones first. ',
    '\n\n**Reading the failure**\n\nThe failure looks like a rate limit rather than a logic error, so a retry with lower concurrency is probably enough. ',
  ];
  const MD_REPLY = [
    '**Done.** I moved the company handlers first and kept a thin re-export in `registry.ts`, so the public API is unchanged.',
    '',
    '## What changed',
    '',
    '- `src/tools/companies.ts`: new module with 6 handlers',
    '- `src/registry.ts`: re-exports only (*no behaviour change*)',
    '- Tests: **45 passing**, none skipped',
    '',
    '| Module | Handlers | Tests |',
    '| --- | ---: | ---: |',
    '| companies | 6 | 22 |',
    '| cantons | 4 | 9 |',
    '',
    '```ts',
    'export { findCompany, searchCompanies } from "./tools/companies";',
    '```',
    '',
    '> Next I will run the filings module, then update the docs. See the [contributing guide](https://example.com/contributing) for the naming rules.',
  ].join('\n');
  const LONG_CMD = 'npm run test -- --run --reporter=verbose src/tools/registry.test.ts src/tools/companies.test.ts src/tools/cantons.test.ts --coverage --coverage.reporter=text-summary';
  const LONG_OUT = ' ✓ src/tools/registry.test.ts (14 tests) 212ms\n ✓ src/tools/companies.test.ts (22 tests) 340ms\n ✓ src/tools/cantons.test.ts (9 tests) 98ms\n\nTest Files  3 passed (3)\n     Tests  45 passed (45)\n  Duration  2.41s';

  function mulberry32(a: number): () => number {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function create(opts: SimOptions): DurbarApi {
    const simKindsParam = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('simkinds') : null;
    const mixed = simKindsParam === 'mixed'; // read before any random draw: the default and simkinds=1 rosters are unchanged
    const caps = (adapterId: string): AdapterInfo['capabilities'] => (SIM_MIXED_KINDS.find((k) => k.id === adapterId)?.capabilities ?? SIM_COPILOT_CAPS);
    const rnd = mulberry32(opts.seed ?? 7);
    const listeners = new Set<(e: AgentEvent) => void>();
    const addedListeners = new Set<(a: AgentInfo) => void>();
    const renamedListeners = new Set<(e: { id: string; alias?: string }) => void>();
    const simPrevNames = new Map<string, string>(); // spec 059: names of the simulated Previous sessions rows
    const n = Math.max(1, opts.n);
    // spec 001 FR-046: read here from the page address (like simkinds), so app.js's option list stays as it is
    const simQs = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
    const simRooms = opts.rooms ?? (simQs && /^[1-5]$/.test(simQs.get('simrooms') || '') ? parseInt(simQs.get('simrooms') || '0', 10) : 0);
    const noHelpers = opts.noHelpers ?? (simQs ? simQs.get('simhelpers') === '0' : false);
    // Fewer than 12: drop the quieter agents first so the status mix stays varied.
    let rows = ROSTER.slice(0, Math.min(n, ROSTER.length));
    if (n < 12) rows = ROSTER.filter((r) => r[0] !== 'Hugo' && r[0] !== 'Priya' && r[0] !== 'Noor' && r[0] !== 'Omar').slice(0, n);
    while (rows.length < n) rows.push(['Agent' + (rows.length + 1), 'Worker', 'blog', 'working', 'Working through a queued task', 0, ['src/index.ts']]);

    const sims: SimAgent[] = rows.map((r, i) => {
      const [name, role, room0, state, intent, helpers0, files] = r;
      const k = simRooms ? Math.max(1, Math.min(SIM_ROOM_ORDER.length, Math.floor(simRooms))) : 0;
      const room = k ? SIM_ROOM_ORDER[Math.min(k - 1, Math.floor((i * k) / rows.length))] : room0; // simrooms=<n>: in blocks, the first folders first
      const helpers = noHelpers ? 0 : helpers0;
      const roomName = opts.solo ? name.toLowerCase() + '-app' : room + (opts.names === 'long' ? '-customer-reconciliation-batch-jobs-2026'.slice(0, 55 - room.length) : ''); // simnames=long: a folder name is long too (60 characters at most, spec 059)
      const cwd = opts.solo ? '~/work/' + roomName : ROOM_DEFS[room] ?? '~/work/' + room;
      const info: AgentInfo = { id: 'sim-' + (i + 1), name, cwd, folders: [cwd], adapterId: mixed ? SIM_KIND_BY_AGENT[i] ?? 'copilot' : 'copilot', permMode: i % 3 === 1 ? 'ask' : i % 3 === 2 ? 'allow' : 'read-only', model: SIM_MODEL_BY_AGENT[i] ?? 'auto', maxAiCredits: SIM_CAPS[name], permRestored: i % 3 === 2 && i < 6 ? true : undefined, modelControl: { switch: 'next-message', effort: true, contextTier: true, compact: true, windowKnown: true }, profiles: true, slash: true, ...(opts.reply === 'secrets' && i === 7 ? { title: SECRETS_TEXT } : {}) } as AgentInfo; // FR-065: one agent starts with a runtime title that holds the planted secrets (it becomes its name)
      // Spec 052 FR-046: a pending permission card only happens in Ask first, so a waiting agent starts in Ask first (Jonas was Allow all
      // and restored, Lena Read-only); the restored Allow-all folder the restore strip names is then Tomas's (swisscontract-ai).
      if (state === 'waiting' && info.permMode !== 'ask') { info.permMode = 'ask'; info.permRestored = undefined; }
      if (mixed && info.adapterId !== 'copilot') {
        const k = caps(info.adapterId ?? 'copilot');
        if (!k.caps) info.maxAiCredits = undefined; // no credit cap on a kind that has none
        else if (k.capUnit === 'usd') info.maxAiCredits = SIM_USD_CAPS[name]; // a dollar cap, never an AIU one (FR-150)
        if (!k.permissionModes.includes(info.permMode)) info.permMode = 'read-only';
        info.profiles = undefined; // custom agents (spec 049) are Copilot's: no profile chip that opens nothing
        if (!k.models) info.modelControl = { switch: 'none', effort: false, contextTier: false, compact: false, windowKnown: true };
        else if (k.modelSwitch) info.modelControl = { switch: 'next-message', effort: true, contextTier: k.modelSwitch.contextTier, compact: false, windowKnown: true }; // spec 030 FR-040: no tier, no compaction, verified
      }
      // Priya models an adapter that cannot switch or compact in place (spec 030): the UI shows the disabled state and offers a new session.
      // Jonas models the real adapter's state until Phase 3: the controls work but are flagged as not verified on a real account.
      if (name === 'Jonas') info.modelControl = { switch: 'next-message', effort: true, contextTier: true, compact: true, windowKnown: true, unverified: true };
      if (i === 6) info.modelControl = { switch: 'none', effort: false, contextTier: false, compact: false, windowKnown: true };
      (info as AgentInfo & { roomName?: string; role?: string }).roomName = roomName;
      (info as AgentInfo & { roomName?: string; role?: string }).role = role;
      info.renameCap = caps(info.adapterId ?? 'copilot').renameSession; // spec 059: what a rename does in the agent app
      if (opts.names === 'long' && i !== 2) info.alias = (SIM_LONG_NAMES[i % SIM_LONG_NAMES.length] + ' ' + (i + 1)).padEnd(60, '.').slice(0, 60);
      return {
        info, room, state, intent, helpers, files,
        prompt: i === 0
          ? 'Please split the tool registry by domain (companies, cantons, filings) without changing the public API. The attached notes describe the naming I want, and the screenshot shows the current module graph.'
          : 'Please take care of this: ' + intent.charAt(0).toLowerCase() + intent.slice(1) + '.',
        attachments: i === 0 ? ['/home/vikram/notes/registry-split-notes.md', '/home/vikram/Pictures/module-graph-2026-10-16-final-v3-annotated.png'] : i === 3 ? ['/home/vikram/docs/tool-table.csv'] : undefined,
        tool: 0,
        think: i,
        grants: new Map(),
        // Context window profiles: most agents are far from full; one is amber, one nearly full (a smaller window). Maya (i = 14, a done agent: idle ones report no context) is amber alone in her room, below the auto-compact line, so a room that is only "uneasy" (spec 034 delta) can be seen.
        ctx: i === 0 ? { tokens: 188000, limit: 272000 } : i === 3 ? { tokens: 117000, limit: 128000 } : i === 4 ? { tokens: 110000, limit: 128000 } : i === 5 ? { tokens: 35500, limit: 200000 } : i === 6 ? undefined : i === 14 ? { tokens: 94000, limit: 128000 } : { tokens: 14000 + i * 4300, limit: 272000 },
        // Two agents sit near their window so the Compact action and the start-fresh note can be shown; one already compacted once.
        compactions: i === 3 ? 1 : 0,
        noAuto: i === 3 || i === 4 ? true : undefined,
        models: i === 4 ? ['gpt-5.6-luna'] : i % 4 === 1 ? ['claude-sonnet-4.6', 'gpt-6-luna'] : undefined,
        mcpOff: new Set<string>(),
      };
    });

    const now = () => Date.now();
    // ---- Fake all-time tool usage (spec 020): seeded history + what this run does, in memory (the real one is a file in userData) ----
    type UsageDoc = import('../shared/toolusage').UsageDoc;
    const bt = (name: string, calls: number, failed = 0) => ({ source: 'builtin' as const, server: '', name, calls, failed });
    const mt = (server: string, name: string, calls: number, failed = 0) => ({ source: 'mcp' as const, server, name, calls, failed });
    const simDoc: UsageDoc = {
      version: 1, since: '2026-09-02T09:30:00.000Z',
      tools: {
        'builtin:read_file': bt('read_file', 412), 'builtin:grep': bt('grep', 188), 'builtin:bash': bt('bash', 143, 9), 'builtin:edit_file': bt('edit_file', 96, 2),
        'mcp:github/search_issues': mt('github', 'search_issues', 57, 3), 'mcp:github/get_pull_request': mt('github', 'get_pull_request', 21),
        'mcp:playwright/browser_snapshot': mt('playwright', 'browser_snapshot', 34, 4), 'mcp:my-notes/search_notes': mt('my-notes', 'search_notes', 12),
      },
      servers: { github: { calls: 78, failed: 3 }, playwright: { calls: 34, failed: 4 }, 'my-notes': { calls: 12, failed: 0 } },
      agents: {
        'Ada · mcp-swiss': { calls: 301, failed: 7, tools: { 'builtin:read_file': { calls: 150, failed: 0 }, 'builtin:grep': { calls: 70, failed: 0 }, 'builtin:bash': { calls: 41, failed: 5 }, 'mcp:github/search_issues': { calls: 40, failed: 2 } } },
        'Mira · mcp-swiss': { calls: 188, failed: 5, tools: { 'builtin:read_file': { calls: 90, failed: 0 }, 'builtin:edit_file': { calls: 52, failed: 2 }, 'mcp:playwright/browser_snapshot': { calls: 34, failed: 4 }, 'mcp:github/get_pull_request': { calls: 12, failed: 0 } } },
        'Clara · blog': { calls: 120, failed: 1, tools: { 'builtin:read_file': { calls: 80, failed: 0 }, 'builtin:grep': { calls: 28, failed: 0 }, 'mcp:my-notes/search_notes': { calls: 12, failed: 1 } } },
        'Zoe · old-prototype': { calls: 193, failed: 4, tools: { 'builtin:bash': { calls: 102, failed: 4 }, 'builtin:grep': { calls: 90, failed: 0 }, 'mcp:github/get_pull_request': { calls: 1, failed: 0 } } },
      },
    };
    const simCount = (e: AgentEvent, label: string): void => {
      if (e.type !== 'toolCall' || (e.phase !== 'start' && e.phase !== 'failed')) return;
      const server = e.mcpServer ?? '';
      const nm = server ? e.mcpTool || e.tool : e.tool;
      const key = server ? `mcp:${server}/${nm}` : `builtin:${nm}`;
      const f = e.phase === 'start' ? 'calls' : 'failed';
      const t = (simDoc.tools[key] ??= { source: server ? 'mcp' : 'builtin', server, name: nm, calls: 0, failed: 0 });
      t[f]++;
      const a = (simDoc.agents[label] ??= { calls: 0, failed: 0, tools: {} });
      a[f]++;
      (a.tools[key] ??= { calls: 0, failed: 0 })[f]++;
      if (server) (simDoc.servers[server] ??= { calls: 0, failed: 0 })[f]++;
    };
    let simSchedHook: ((e: AgentEvent) => void) | undefined; // spec 044 FR-018: usage of a scheduled run counts toward its limit
    const simDoorSubs: ((d: Record<string, { closed: boolean; held: number }>) => void)[] = []; // listeners can subscribe before the schedules start
    const simDoorStopSubs: ((p: { id: string; why: string }) => void)[] = [];
    const simRemoteOffSubs: ((p: { id: string; reason?: string }) => void)[] = []; // spec 054 FR-040: the door's remote-off event, as main sends it
    let simDoorsRef: { map: Map<string, { closed: boolean; held: { prompt: string; at: number; scheduleId?: string }[]; releasing?: boolean }>; subs: ((d: Record<string, { closed: boolean; held: number }>) => void)[]; list(): Record<string, { closed: boolean; held: number }>; changed(): void } | undefined; // spec 017 FR-015 (set below, with the schedules)
    let selfMcp = false; /* the simulator's own `mcp` event, as opposed to one a driver reports */
    const emit = (e: AgentEvent): void => {
      /* like main, which keeps the runtime's list before the window hears of it: the reply a listener asks for at once sees this event (spec 058 FR-094) */
      if (e.type === 'status' && e.status === 'stopped') { const q = sims.find((x) => x.info.id === e.sessionId); if (q) q.mcpHealth = undefined; }
      if (e.type === 'mcp') { const q = sims.find((x) => x.info.id === e.sessionId); if (q) { q.mcpLive = e.servers; q.mcpHealth = simHealth(q.mcpHealth, e.servers); if (!selfMcp) { q.mcpReported = e.servers; q.mcpAppOff = new Set(e.servers.filter((m) => m.status === 'disabled' && !q.mcpOff?.has(m.name)).map((m) => m.name)); } } }
      listeners.forEach((l) => l(e));
      simSchedHook?.(e);
      if (e.type === 'status' && e.status === 'idle') {
        const q = sims.find((x) => x.info.id === e.sessionId);
        if (q?.pendingModel) window.setTimeout(() => void applyPending(q), 0); // the turn ended: the queued switch applies
      }
      const src = e.type === 'toolCall' ? sims.find((x) => x.info.id === e.sessionId) : undefined;
      if (src) simCount(e, src.info.name + ' · ' + src.info.cwd.replace(/\/+$/, '').split('/').pop());
    };
    /* spec 024 test hook, simulator only: a driver can send one normalized event (for example a tool call of a given MCP server) */
    (window as unknown as { __durbarSimEmit?: (e: AgentEvent) => void }).__durbarSimEmit = emit;
    /* simtitles=1 (spec 001/002 deltas 2026-10-18): titles for a few main agents, two of them in one folder and one long enough to be ellipsized */
    if (opts.titles) {
      const SIM_TITLES = ['Fix login bug', 'Release notes for v0.3', 'Review PR 121: contract clause parser', 'Rename public tool find_company and update every call site and the docs index', 'Canton lookup edge cases'];
      if (opts.titles === 'long') SIM_TITLES[0] = 'Morning stand-up: summarise every open pull request, flag the ones that touch the billing flows and draft the release notes for the whole week'.slice(0, 120);
      window.setTimeout(() => {
        sims.filter((s, i) => i % 3 === 0).slice(0, SIM_TITLES.length).forEach((s, i) => emit({ type: 'title', sessionId: sid(s), timestamp: now(), title: SIM_TITLES[i] }));
      }, 200);
    }
    /* simnames=long, FR-019 (issue #536): the third agent (it waits for you, so it is also in the inbox) has no alias; its title holds a URL-like token */
    if (opts.names === 'long') window.setTimeout(() => { const s = sims[2]; if (s) emit({ type: 'title', sessionId: sid(s), timestamp: now(), title: SIM_LONG_URL_TITLE }); }, 200);
    /* simgrants=many (spec 052 FR-141): the first agent has eight grants, some with a tool name that repeats the server name */
    if (opts.grants) {
      window.setTimeout(() => {
        const s = sims[0];
        if (!s) return;
        const L = ['server-x › server-x-GetItem', 'server-x › server-x-ListItemsInTheWholeCatalogueIncludingArchivedOnes', 'billing-service › billing-service_create_invoice_draft', 'billing-service › refund', 'calendar › calendar.CreateEvent', 'run: git status --short --branch', 'write src/renderer/a-very-long-file-name-that-keeps-going.ts', 'docs-search › docs-search-Query'];
        L.forEach((label, i) => s.grants.set('sim-grant-' + i, label));
        grantsEvent(s);
      }, 300);
    }
    /* simquestion=1 (spec 012 FR-130): one agent asks a question, as Claude's AskUserQuestion does */
    let simQ: { s: SimAgent; requestId: string } | undefined;
    if (opts.question) {
      window.setTimeout(() => {
        const s = sims.find((x) => x.info.adapterId === 'claude') ?? sims[0];
        if (!s) return;
        simQ = { s, requestId: 'q-' + s.info.id };
        s.state = 'waiting';
        emit({ type: 'question', sessionId: s.info.id, timestamp: now(), phase: 'asked', requestId: simQ.requestId, questions: opts.question === 'long' ? [
          { question: 'Before I change the settings screen and the office view together, which of these long-running approaches should I take for the whole refactor, knowing that the second one touches every theme and the third one needs a migration of the saved preferences on every machine? Some context first, so you can choose well: the settings screen has grown over eleven rounds of reviews and now mixes the defaults for new sessions, the agent apps, the themes, the places in the office and the spending limits on one long page; the office view draws fifteen desks at two window sizes and every theme lays them out the same way, so a change there is checked once but shows everywhere; the saved preferences are read at start-up on Windows, macOS and Linux, and an old file must still open after the change, or people lose their places and limits; the chat, the inbox and the activity log read the same settings, so they move with whatever we pick; and the screens that nobody opens still need their words checked, because a newcomer finds them through the command palette. Tell me which way you prefer, or write your own plan below.', header: 'Refactor plan', multiSelect: false, options: [
            { label: 'Change the settings screen first, keep the old office layout until every theme has been checked on all three platforms, then do the chat, then the inbox, then the activity log, and only after that the screens that nobody opens', description: 'Safest, slowest. Each step is small enough to review in one sitting and to undo on its own if a theme breaks; the office keeps its old layout until the very end, so people who only watch their agents see no change for a while. It takes about five pull requests instead of one, and the saved preferences are migrated last, after every screen that reads them has been moved, with a backup of the old file kept next to the new one for one release in case anything goes wrong on a machine we did not test.' },
            { label: 'Change everything at once, including the saved preferences and the themes, and fix what breaks afterwards; this is the fastest way to a consistent screen, but every theme, every window size and every platform has to be checked again in the same pull request before anyone can merge it' },
            { label: 'Short' } ] },
          { question: 'Which of the supercalifragilisticexpialidocious_configuration_option_names_that_are_unbroken_strings should stay?', header: 'Options', multiSelect: true, options: [{ label: 'an_option_label_without_any_space_that_is_much_longer_than_the_card_is_wide_in_any_window_size_and_keeps_going_with_more_words_joined_by_underscores_so_it_cannot_break_at_a_space_at_all' }, { label: 'Keep all of them' }] },
        ] : [
          { question: 'Which colour should the focus ring use?', header: 'Focus ring', multiSelect: false, options: [{ label: 'Sage', description: 'The calm green of the office walls' }, { label: 'Blue', description: 'Matches the links' }] },
          { question: 'Which screens should get it first?', header: 'Screens', multiSelect: true, options: [{ label: 'Office' }, { label: 'Chat' }, { label: 'Settings' }] },
        ].slice(0, opts.question === 'compact' ? 1 : 2) });
        emit({ type: 'status', sessionId: s.info.id, timestamp: now(), status: 'needs-permission', intent: 'Waiting for your answer' });
        /* spec 052 FR-163 (owner, 2026-10-21): the runtime compacts again and again while the question waits (sim: the count and numbers are made up) */
        if (opts.question === 'compact') {
          const lim = s.ctx?.limit ?? 128000;
          for (let i = 0; i < 6; i++) {
            emit({ type: 'compaction', sessionId: s.info.id, timestamp: now(), phase: 'start', trigger: 'auto', tokensBefore: Math.round(lim * 0.93), limit: lim });
            emit({ type: 'compaction', sessionId: s.info.id, timestamp: now(), phase: 'complete', trigger: 'auto', tokensBefore: Math.round(lim * 0.93), tokensAfter: Math.round(lim * (0.2 + i * 0.01)), tokensRemoved: Math.round(lim * (0.73 - i * 0.01)), limit: lim });
          }
        }
      }, 300);
    }
    /* simelicit=1|url (spec 012 FR-151): an MCP server asks one agent for input, as an MCP elicitation does (a form, or a page to open) */
    type SimElicitField = { name: string; title: string; type: string; required?: boolean; enumValues?: string[]; min?: number; max?: number };
    let simE: { s: SimAgent; requestId: string; url?: string; fields: SimElicitField[] } | undefined;
    if (opts.elicit) {
      window.setTimeout(() => {
        const s = sims.find((x) => x.info.adapterId === 'copilot' && x !== simQ?.s) ?? sims.find((x) => x !== simQ?.s);
        if (!s) return;
        const url = opts.elicit === 'url';
        const fields: SimElicitField[] = [
          { name: 'environment', title: 'Which environment?', type: 'enum', required: true, enumValues: ['staging', 'production'] },
          { name: 'ticket', title: 'Ticket number', type: 'integer', required: true, min: 1, max: 999999 },
          { name: 'notify', title: 'Notify me', type: 'boolean' },
        ];
        simE = { s, requestId: 'e-' + s.info.id, fields: url ? [] : fields, ...(url ? { url: 'https://auth.example.com/device?code=DURBAR-1234' } : {}) };
        s.state = 'waiting';
        const message = url ? 'Sign in to the deploy service to continue.' : 'Where should this deploy go?';
        emit({ type: 'question', sessionId: s.info.id, timestamp: now(), phase: 'asked', requestId: simE.requestId, questions: [{ question: message, header: 'deploy-mcp', multiSelect: false, options: [] }],
          elicitation: url
            ? { message, source: 'deploy-mcp', url: simE.url, host: 'auth.example.com' }
            : { message, source: 'deploy-mcp', fields: [
                { name: 'environment', title: 'Which environment?', type: 'enum', required: true, enumValues: ['staging', 'production'], enumNames: ['Staging', 'Production'], description: 'Production needs a ticket.' },
                { name: 'ticket', title: 'Ticket number', type: 'integer', required: true, min: 1, max: 999999 },
                { name: 'notify', title: 'Notify me', type: 'boolean', default: true },
              ] } } as AgentEvent);
        emit({ type: 'status', sessionId: s.info.id, timestamp: now(), status: 'needs-permission', intent: 'Waiting for your answer' });
      }, 400);
    }
    const simTrusted = new Set<string>(); // spec 043: repository agents confirmed in this run
    // spec 043 FR-017: profile files in memory (no disk): the FR-005 profiles, a Claude one, a read-only one and one with a front matter error
    type SimPF = { id: string; app: 'copilot' | 'claude'; scope: 'folder' | 'user'; folder?: string; fileName: string; path: string; writable: boolean; note?: string; text: string; made?: boolean };
    const pfHash = (s: string): string => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0').repeat(8); };
    const pfHead = (t: string): { name?: string; description?: string } => {
      const m = /^---\n([\s\S]*?)\n---/.exec(t); const o: { name?: string; description?: string } = {};
      for (const l of (m ? m[1] : '').split('\n')) { const kv = /^(name|description)\s*:\s*(.*)$/.exec(l); if (kv && !(kv[1] in o)) o[kv[1] as 'name' | 'description'] = kv[2].trim().replace(/^(["'])(.*)\1$/, '$2'); }
      return o;
    };
    const SWISS = ROOM_DEFS['mcp-swiss'], BLOG = ROOM_DEFS.blog;
    let pfN = 0;
    const pf = (app: SimPF['app'], scope: SimPF['scope'], folder: string | undefined, path: string, text: string, writable = true, note?: string): SimPF =>
      ({ id: (++pfN).toString(16).padStart(32, 'a'), app, scope, folder, fileName: path.slice(path.lastIndexOf('/') + 1), path, writable, note, text });
    // spec 043 FR-039: the simulator's Create with AI holds one request at a time, like main's `generateProfile`; `__simGenCalls`
    // counts the (canned, free) requests that would have been paid, so a driver can check at most one per user action;
    // `__simGenDelay` (ms) lengthens the 700 ms wait so a driver's cancel-then-reopen steps cannot race it
    let simGenRunning = false;
    const simPF: SimPF[] = [
      pf('copilot', 'folder', SWISS, SIM_PROFILES[0].path, '---\nname: Reviewer\ndescription: Reviews changes and points at risks; never edits files\ntools: [view, grep, glob]\nmodel: sim-deep\n---\n\n# Reviewer\n\nYou review the changes in this repository. **Never edit files.**\n\n## What to check\n\n- Tests cover the new behaviour\n- No secrets in code or logs\n- Paths work on Windows, macOS and Linux\n\nAnswer with a short list of risks, most important first, and link the docs when useful: [Contributing](https://github.com/three-feathers/agent-durbar/blob/main/CONTRIBUTING.md).\n\n```sh\nnpm run typecheck && npm test\n```\n'),
      pf('copilot', 'folder', SWISS, SIM_PROFILES[2].path, '---\nname: Release helper\ndescription: Prepares release notes from merged pull requests\nmcp-servers:\n  github:\n    type: http\n---\n\nCollect the merged pull requests since the last tag and write release notes grouped by area.\n'),
      pf('copilot', 'user', undefined, SIM_PROFILES[1].path, '---\nname: Docs writer\ndescription: Writes and tidies documentation in plain English\n---\n\nWrite short sentences. Explain why before how. Keep headings in sentence case.\n'),
      pf('claude', 'folder', SWISS, SWISS + '/.claude/agents/test-writer.md', '---\nname: test-writer\ndescription: Writes focused unit tests for the change at hand\ntools: Read, Grep, Glob, Edit\nmodel: sonnet\n---\n\nYou write unit tests. One behaviour per test; name it after the behaviour.\n'),
      pf('claude', 'user', undefined, '~/.claude/agents/house-style.md', '---\nname: house-style\ndescription: Checks wording against the house style\n---\n\nRead the text and list wording that breaks the house style.\n', false, 'You cannot write this file.'),
      pf('copilot', 'folder', BLOG, BLOG + '/.github/agents/blogger.agent.md', '---\nname: Blogger\ndescription: Use when: drafting a post\n---\n\nDraft blog posts in a friendly tone.\n'),
    ];
    const pfInfo = (f: SimPF) => { const h = pfHead(f.text); return { id: f.id, app: f.app, scope: f.scope, ...(f.folder ? { folder: f.folder } : {}), fileName: f.fileName, path: f.path, name: h.name || f.fileName.replace(/(\.agent)?\.md$/, ''), ...(h.description ? { description: h.description } : {}), size: f.text.length, writable: f.writable, ...(f.note ? { note: f.note } : {}) }; };
    /** As main (FR-020): each folder with an id (a hash of its path); New profile sends the id back. */
    /** spec 043 FR-041: a session's Copilot profiles follow the in-memory files: the FR-005 ones while their file is there, plus Copilot files made in this run. */
    const simProfiles = () => [
      ...SIM_PROFILES.filter((p) => simPF.some((f) => f.path === p.path)),
      ...simPF.filter((f) => f.made && f.app === 'copilot').map((f) => { const h = pfHead(f.text); return { id: f.fileName.replace(/\.agent\.md$/, ''), name: h.name || f.fileName, description: h.description ?? '', source: (f.scope === 'user' ? 'user' : 'repo') as 'user' | 'repo', path: f.path }; }),
    ];
    const pfFolders = (): { id: string; path: string }[] => [...new Set(sims.map((s) => s.info.cwd))].map((p) => ({ id: pfHash('folder\0' + p).slice(0, 32), path: p }));
    const simSched = { list: [] as ScheduleInfo[], pausedAll: false, n: 0, subs: [] as ((d: SchedulesInfo) => void)[], ran: [] as ((r: { agentId: string; scheduleId: string; every?: number; at?: number; rule?: ScheduleInfo['rule'] }) => void)[],
      changed() { const doc = { pausedAll: this.pausedAll, schedules: this.list.map((x) => ({ ...x })) }; this.subs.forEach((f) => f(doc)); },
      attrib: new Map<string, string>() };
    if (opts.sched) {
      /* spec 001 FR-038: three future schedules for the Postbox (nothing is due during a driver run); the third one missed its last run */
      const t0 = Date.now(), key = (x: SimAgent | undefined): string => (x ? x.info.workspaceFile ?? x.info.cwd ?? '' : '');
      const a = sims[0], b = sims.find((x) => x.room !== a?.room) ?? sims[1];
      const seed: ScheduleInfo[] = [
        { id: 'sched-s1', folder: key(a), prompt: (opts.reply === 'secrets' ? FILL(53) + SECRETS_TEXT + ' ' : '') + 'PR and issue sweep: list what changed since the last run', every: 30, next: t0 + 12 * 60000 },
        { id: 'sched-s2', folder: key(b), prompt: (opts.reply === 'secrets' ? FILL(53) + SECRETS_TEXT + ' ' : '') + 'Cut the pre-release notes from the merged pull requests', at: t0 + 3 * 3600000 },
        { id: 'sched-s3', folder: key(a), prompt: (opts.reply === 'secrets' ? FILL(53) + SECRETS_TEXT + ' ' : '') + 'Morning summary of failing checks', rule: { kind: 'weekdays', time: '08:30' }, next: t0 + 20 * 3600000, last: { at: t0 - 4 * 3600000, outcome: 'missed' } },
      ];
      simSched.list.push(...seed.filter((x) => x.folder)); simSched.n = 3;
    }
    if (opts.schedFire && opts.schedFire > 0) {
      /* spec 001 FR-038: a one-off run for the first idle agent (its own session, so a busy folder-mate does not skip it) */
      const s = sims.find((x) => x.state === 'idle') ?? sims[sims.length - 1];
      if (s) { simSched.list.push({ id: 'sched-fire', folder: s.info.workspaceFile ?? s.info.cwd ?? '', prompt: 'Scheduled check-in: summarise what changed', at: Date.now() + opts.schedFire * 1000, target: { session: s.info.id, agent: s.info.id, name: s.info.title ?? '' } }); simSched.n += 1; }
    }
    /* spec 044 FR-012: the rule copy in schedtemplates.js (main uses src/shared/schedrules.ts; test:schedules keeps them equal) */
    type SimRules = { parseRule(v: unknown): ScheduleInfo['rule']; nextRuleRun(r: NonNullable<ScheduleInfo['rule']>, after: number): number | undefined };
    const simRules = (): SimRules | undefined => (window as unknown as { DurbarSchedTemplates?: SimRules }).DurbarSchedTemplates;
    const simNext = (sc: ScheduleInfo, now: number): number =>
      sc.rule ? simRules()?.nextRuleRun(sc.rule, now) ?? now + 1440 * 60000
        : sc.at !== undefined ? sc.at + (Math.floor((now - sc.at) / ((sc.every as number) * 60000)) + 1) * (sc.every as number) * 60000 : now + (sc.every as number) * 60000; // FR-007: anchored runs keep their time of day
    const simUnit = (s: SimAgent | undefined): 'aiu' | 'usd' | undefined => {
      if (!s) return undefined;
      const kc = caps(s.info.adapterId ?? 'copilot');
      const u = kc.capUnit === 'usd' ? 'usd' : 'aiu';
      return (u === 'usd' ? kc.usage.costUsd : kc.usage.nanoAiu) ? u : undefined;
    };
    const simAgentOf = (sc: { folder: string; target?: { session: string } }): SimAgent | undefined =>
      sc.target ? sims.find((x) => x.info.id === sc.target?.session) : sims.find((x) => (x.info.workspaceFile ?? x.info.cwd) === sc.folder);
    simSchedHook = (e) => {
      // FR-015: from a scheduled send until that session's turn ends, its usage counts toward the schedule
      if (e.type === 'status' && !e.agentId && (e.status === 'idle' || e.status === 'error' || e.status === 'stopped')) { simSched.attrib.delete(e.sessionId); return; }
      if (e.type !== 'usage') return;
      const sc = simSched.list.find((x) => x.id === simSched.attrib.get(e.sessionId));
      if (!sc?.cap) return;
      const amt = sc.cap.unit === 'usd' ? e.costUsd : e.nanoAiu !== undefined ? e.nanoAiu / 1e9 : undefined;
      if (amt === undefined) sc.spentUnknown = true;
      else sc.spent = (sc.spent ?? 0) + amt;
      simSched.changed();
    };
    /* spec 017 FR-015..FR-017, spec 044 FR-110: doors the user closed and the runs held there (memory only: the simulator keeps no profile) */
    type SimHeld = { prompt: string; at: number; scheduleId?: string };
    const simDoors = { map: new Map<string, { closed: boolean; held: SimHeld[]; releasing?: boolean }>(), subs: simDoorSubs,
      list(): Record<string, { closed: boolean; held: number }> { const o: Record<string, { closed: boolean; held: number }> = {}; this.map.forEach((v, k) => { if (v.closed || v.held.length) o[k] = { closed: v.closed, held: v.held.length }; }); return o; },
      changed() { const d = this.list(); this.subs.forEach((f) => f(d)); } };
    simDoorsRef = simDoors;
    const simIdle = (s: SimAgent): boolean => !(s.state === 'working' || s.state === 'thinking' || s.state === 'waiting' || !!s.perm);
    window.setInterval(() => {
      const now = Date.now();
      let any = false;
      // Send all: the next held run goes when the agent is free again, through the schedule's rules (spec 044 FR-111, as main's Scheduler.releaseHeld)
      simDoors.map.forEach((d, id) => {
        if (d.closed || !d.releasing) return;
        const s = sims.find((x) => x.info.id === id);
        const r = d.held[0];
        if (!s || !r) { d.releasing = false; simDoors.changed(); return; }
        const sc = simSched.list.find((x) => x.id === r.scheduleId);
        const stop = (why: string) => { d.releasing = false; simDoors.changed(); simDoorStopSubs.forEach((f) => f({ id, why })); };
        if (!sc) { d.held.shift(); if (!d.held.length) d.releasing = false; simDoors.changed(); return; } // its schedule was deleted
        if (simSched.pausedAll) return stop('paused-all');
        if (sc.paused) return stop('paused');
        if (sc.cap && (sc.spent ?? 0) >= sc.cap.amount) return stop('cap');
        if (!simIdle(s) || (!!s.breakUntil && Date.now() < s.breakUntil)) return; // busy: next tick
        d.held.shift();
        if (!d.held.length) d.releasing = false;
        emit({ type: 'user', sessionId: id, timestamp: now, text: r.prompt } as AgentEvent);
        simSched.ran.forEach((f) => f({ agentId: id, scheduleId: sc.id, every: sc.every, at: sc.at, rule: sc.rule }));
        simSched.attrib.set(id, sc.id);
        sc.last = { at: now, outcome: 'sent' };
        void api.send(id, r.prompt, []);
        simSched.changed();
        simDoors.changed();
      });
      for (const sc of simSched.list) {
        if (sc.target && !sc.done && !sc.paused && !sims.some((x) => x.info.id === sc.target?.session)) { sc.paused = true; sc.pausedReason = 'session-ended'; any = true; continue; } // FR-014
        const recurring = sc.every !== undefined || !!sc.rule;
        const due = sc.done || sc.paused ? undefined : recurring ? sc.next : sc.at;
        if (due === undefined || due > now) continue;
        any = true;
        const s = simAgentOf(sc);
        const busy = !!s && (s.state === 'working' || s.state === 'thinking' || s.state === 'waiting' || !!s.perm || (!!s.breakUntil && Date.now() < s.breakUntil)); // spec 068 FR-008: a coffee break counts as busy
        const door = s ? simDoors.map.get(s.info.id) : undefined;
        const outcome = simSched.pausedAll ? 'skipped-paused' : sc.cap && (sc.spent ?? 0) >= sc.cap.amount ? 'skipped-cap' : !s ? 'failed' : door?.closed ? 'held' : busy ? 'skipped-busy' : 'sent';
        if (outcome === 'held' && door) { door.held.push({ prompt: sc.prompt, at: now, scheduleId: sc.id }); simDoors.changed(); } // spec 044 FR-110
        if (outcome === 'sent' && s) {
          emit({ type: 'user', sessionId: s.info.id, timestamp: now, text: sc.prompt } as AgentEvent);
          simSched.ran.forEach((f) => f({ agentId: s.info.id, scheduleId: sc.id, every: sc.every, at: sc.at, rule: sc.rule }));
          simSched.attrib.set(s.info.id, sc.id);
          void api.send(s.info.id, sc.prompt, []);
        }
        sc.last = { at: now, outcome };
        if (outcome === 'skipped-cap') { sc.paused = true; sc.pausedReason = 'cap'; } // FR-015
        else if (recurring) sc.next = simNext(sc, now);
        else sc.done = true;
      }
      if (any) simSched.changed();
    }, 1000);
    const sid = (s: SimAgent) => s.info.id;
    const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
    const MODELS = ['gpt-6-luna', 'gpt-6-luna', 'gpt-5.6-luna', 'claude-sonnet-4.6'];
    /* spec 011 FR-029: a room can be made to report usage without credits, like a runtime that does not send them (helpers included) */
    const unreported = (s: SimAgent): boolean => !!opts.unreported && (s.room === opts.unreported || (s.info as AgentInfo & { roomName?: string }).roomName === opts.unreported);
    const usage = (s: SimAgent): void => {
      const model = (s.models ?? MODELS)[Math.floor(rnd() * (s.models ?? MODELS).length)];
      const nano = Math.floor((SIM_EXPENSIVE[s.info.name] ?? 0.004 + rnd() * 0.012) * 1e9);
      const unrep = unreported(s);
      const kc = caps(s.info.adapterId ?? 'copilot');
      // FR-066: a kind without AIU reports no nanoAiu (credits unavailable); one with a USD estimate sends it as an estimate, never as credits
      emit({ type: 'usage', sessionId: sid(s), timestamp: now(), model, inputTokens: 1200 + Math.floor(rnd() * 6000), outputTokens: 150 + Math.floor(rnd() * 900), ...(unrep || !kc.usage.nanoAiu ? { creditsStatus: 'unavailable' as const } : { nanoAiu: nano, creditsStatus: 'complete' as const }), ...(kc.usage.costUsd ? { costUsd: Math.round(nano / 1e6) / 1e4, costBasis: 'estimate' as const } : {}) });
      s.used = (s.used ?? 0) + nano;
      if (kc.usage.costUsd) s.usd = (s.usd ?? 0) + Math.round(nano / 1e6) / 1e4;
      const cap = kc.caps ? s.info.maxAiCredits : undefined;
      const spent = kc.capUnit === 'usd' ? s.usd ?? 0 : s.used / 1e9;
      if (cap && !s.limitReq && spent >= cap) {
        // Like the SDK: the runtime asks the user what to do and waits (the blocked model request).
        s.limitReq = 'lim-' + sid(s) + '-' + Math.floor(s.used / 1e6);
        s.state = 'waiting';
        emit({ type: 'limit', sessionId: sid(s), timestamp: now(), phase: 'exhausted', requestId: s.limitReq, maxAiCredits: cap, usedAiCredits: spent });
      }
      // Like the real runtime: the context window is reported before each model call (spec 019).
      const c = s.ctx;
      if (c && s.pendingLimit) { c.limit = s.pendingLimit; s.pendingLimit = undefined; } // the new window is reported with the first call after a switch
      if (c && c.limit > 0) {
        c.tokens = Math.min(Math.floor(c.limit * 0.97), c.tokens + 700 + Math.floor(rnd() * 1800));
        emit({ type: 'context', sessionId: sid(s), timestamp: now(), tokens: c.tokens, limit: c.limit, ...ctxParts(s, c.tokens, 3 + s.tool), model: s.info.model, tier: s.tier });
        // Like the runtime's infinite sessions: compact in the background when the window is about 80% full.
        if (c.tokens / c.limit >= 0.8 && !s.compacting && !s.noAuto) void compactNow(s, 'auto');
      }
    };
    // The Copilot CLI list (global) + the extras of the agent's own folder (spec 020). Extras live in `fakeExtras`, keyed by folder.
    const CLI_SERVERS: { name: string; transport: string; source: string }[] = [
      { name: 'github', transport: 'stdio', source: 'user' },
      { name: 'my-notes', transport: 'stdio', source: 'user' },
      { name: 'github-mcp-server', transport: 'http', source: 'builtin' },
    ];
    /* spec 058 FR-164: `simmcpauth=again` adds two remote (OAuth) servers to the Copilot CLI list, the only kind Sign in again is for */
    const SIM_REMOTE = simQs?.get('simmcpauth') === 'again' ? [{ name: 'team-wiki', url: 'https://wiki.example.test/mcp' }, { name: 'crm', url: 'https://crm.example.test/mcp' }] : [];
    for (const r of SIM_REMOTE) CLI_SERVERS.push({ name: r.name, transport: 'http', source: 'user' });
    const serversOf = (s: SimAgent): { name: string; transport: string; source: string }[] => [
      ...CLI_SERVERS,
      ...(fakeExtras[s.info.cwd] ?? []).filter((v) => v.enabled && v.trusted).map((v) => ({ name: v.name, transport: v.transport, source: 'workspace' })),
    ];
    /* spec 058: the state of one simulated server, for the dialog's reply and the `mcp` events alike (FR-001, FR-006, FR-040).
       The sixth agent's "my-notes" failed to start (until a Restart); every fifth agent from the fifth one (5, 10, 15) has it asking for a sign-in. */
    /* spec 058 FR-071/FR-183: `simmcpauth=1` = the Copilot and Claude Code agents' "my-notes" asks for a sign-in until one finishes (Sign in,
       Open sign-in page, Running after 2 s; a Claude row also keeps Restart, which picks up a sign-in finished elsewhere); `simmcpauth=manual` =
       the same row, but the app cannot start a sign-in, so its terminal steps show instead. Codex rows keep today's behaviour (PR B). */
    const simMcpAuth = simQs?.get('simmcpauth') ?? '';
    /* the apps whose rows sign in in the simulator, with the texts their adapters send (src/adapters/copilot.ts, claude.ts) */
    const SIM_SIGN_IN: Record<string, { steps: (n: string) => string; note: string; restart: boolean; noCall: string }> = {
      copilot: { steps: (n) => 'If Sign in is not available, sign in from the Copilot CLI: run `copilot`, type `/mcp auth ' + n + '` and finish in your browser. Then use Restart session with these servers. This may not carry over to this session (seen on 2026-10-23).', note: 'Checked once on a real account; other servers and systems not yet.', restart: false, noCall: 'This Copilot version cannot start a sign-in from Agent Durbar.' },
      claude: { steps: (n) => 'If Sign in is not available, run `claude mcp login ' + n + "` in a terminal and finish in your browser. This works only for a server in Claude Code's own settings. Then press Restart on this row.", note: 'Not checked on a real account yet.', restart: true, noCall: 'This Claude Code version cannot start a sign-in from Agent Durbar.' },
    };
    const simSignApp = (s: SimAgent) => SIM_SIGN_IN[s.info.adapterId ?? 'copilot'];
    /* `simmcpttl=N` (seconds, 1-600): the time limit of an open sign-in, so a driver can see "Sign-in was not finished" (real: 10 minutes) */
    const simMcpTtl = Math.max(1, Math.min(600, Math.floor(Number(simQs?.get('simmcpttl'))) || 600)) * 1000;
    /* FR-164 like main: only a server of the lists with an http(s) address; never built-in, never stdio */
    const simRemoteMcp = (n: string): boolean => SIM_REMOTE.some((r) => r.name === n);
    const simSignOpen = (s: SimAgent, n: string): { opened: boolean; at: number; again?: boolean } | undefined => {
      const e = s.mcpSign?.get(n);
      if (e && Date.now() - e.at >= simMcpTtl) { s.mcpSign?.delete(n); return undefined; }
      return e;
    };
    const simServer = (s: SimAgent, i: number, name: string, live: boolean): { status?: string; error?: string; errorClass?: McpServerStatus['errorClass'] } => {
      if (s.mcpOff?.has(name)) return { status: 'disabled' };
      if (!live) return {};
      if (s.mcpRestarting?.has(name)) return { status: 'pending' };
      if (simMcpAuth && name === 'my-notes' && simSignApp(s) && !s.mcpFixed?.has(name)) return { status: 'needs-auth', error: 'The server answered 401 Unauthorized: sign in to use its tools.', errorClass: 'auth' };
      if (name === 'my-notes' && !s.mcpFixed?.has(name)) {
        if (i === 5) return { status: 'failed', error: 'spawn notes-mcp ENOENT', errorClass: 'not-found' };
        if (i % 5 === 4) return { status: 'needs-auth', error: 'The server answered 401 Unauthorized: sign in to use its tools.', errorClass: 'auth' };
      }
      return { status: 'connected' };
    };
    const mcpStatus = (s: SimAgent, i: number): void => {
      const own = serversOf(s), names = new Set(own.map((m) => m.name));
      const base = [...own, ...(s.mcpReported ?? []).filter((m) => !names.has(m.name))]; /* rebuilt each time: a removed extra goes, a driver-reported server stays */
      /* spec 058 FR-082: a driver-reported server keeps its reported state, except while it restarts (Starting) and after (Running) */
      const kept = (m: { name: string; status?: string; error?: string; errorClass?: McpServerStatus['errorClass'] }) => (names.has(m.name) || s.mcpRestarting?.has(m.name) || s.mcpFixed?.has(m.name) ? {} : { status: m.status, ...(m.error ? { error: m.error } : {}), ...(m.errorClass ? { errorClass: m.errorClass } : {}) });
      selfMcp = true;
      try { emit({ type: 'mcp', sessionId: sid(s), timestamp: now(), servers: base.map((m) => ({ ...m, status: 'connected', ...simServer(s, i, m.name, true), ...kept(m), ...(s.mcpAppOff?.has(m.name) && !s.mcpOff?.has(m.name) ? { status: 'disabled' } : {}) })) }); } finally { selfMcp = false; }
    };

    let openSeq = 0;
    function toolStep(s: SimAgent, keepOpen: boolean): void {
      const k = s.tool++;
      const file = s.files[k % s.files.length];
      const id = sid(s) + '-t' + k;
      /* spec 024: the calls agents leave open take turns (bash, github, playwright, my-notes) so the lobby shows several places;
         the first agent to leave one open keeps the long bash command the chat layout checks rely on */
      const OPEN_KINDS = [2, 4, 5, 6, 2, 4, 6, 5];
      const kind = keepOpen ? OPEN_KINDS[openSeq++ % OPEN_KINDS.length] : k % 7;
      const defs: { tool: string; args: Record<string, string>; out: string; mcp?: [string, string]; edit?: EditInfo }[] = [
        { tool: 'read_file', args: { path: file }, out: String(80 + Math.floor(rnd() * 800)) + ' lines' },
        { tool: 'grep', args: { pattern: 'registerTool\\(|export (async )?function (find|search|lookup)[A-Z][A-Za-z]+' }, out: '14 matches in 6 files' },
        { tool: 'bash', args: { command: LONG_CMD }, out: LONG_OUT },
        { tool: 'edit_file', args: { path: file }, out: '+' + (20 + Math.floor(rnd() * 160)) + ' -' + Math.floor(rnd() * 40), edit: simEdit(file, 'edit', ['  return handlers[name];'], ['  const h = handlers[name];', '  if (!h) throw new Error(`unknown tool ${name}`);', '  return h;']) },
        { tool: 'github-search_issues', args: { query: 'is:open label:bug registry' }, out: '7 issues', mcp: ['github', 'search_issues'] },
        { tool: 'playwright-browser_snapshot', args: {}, out: 'page snapshot (212 lines)', mcp: ['playwright', 'browser_snapshot'] },
        { tool: 'my-notes-search_notes', args: { query: 'registerTool options' }, out: '3 results', mcp: ['my-notes', 'search_notes'] },
      ];
      const d = defs[kind];
      const mcpFields = d.mcp ? { mcpServer: d.mcp[0], mcpTool: d.mcp[1] } : {};
      if (d.mcp && (s.mcpOff?.has(d.mcp[0]) || (d.mcp[0] === 'playwright' && !serversOf(s).some((m) => m.name === 'playwright')))) return toolStep(s, keepOpen);
      emit({ type: 'toolCall', sessionId: sid(s), timestamp: now(), callId: id, tool: d.tool, phase: 'start', args: d.args, ...mcpFields, ...(d.edit ? { edit: d.edit } : {}) });
      if (keepOpen) { s.open = id; return; }
      const complete = (): void => emit({ type: 'toolCall', sessionId: sid(s), timestamp: now(), callId: id, tool: d.tool, phase: 'complete', output: d.out, ...mcpFields });
      /* spec 024 T010: calls that go to a place (bash, github, playwright, my-notes) take 1.5-4 s (seeded) unless the simulator is frozen,
         so agents walk there and back; frozen runs keep every call instant except the one each working agent leaves open */
      if (!opts.freeze && [2, 4, 5, 6].includes(kind)) window.setTimeout(complete, 1500 + Math.floor(rnd() * 2500));
      else complete();
    }
    function subRun(s: SimAgent, h: number, name: string, task: string, st: 'working' | 'thinking' | 'done' | 'failed'): void {
      if (opts.reply === 'secrets') task = FILL(83) + SECRETS_TEXT + ' ' + task; // FR-065: a sub-agent's task, its card line, its result and its error hold the planted secrets
      const call = sid(s) + '-task' + h, base = { sessionId: sid(s), timestamp: now() };
      const prompt = 'You are a helper for the **' + name + '** step.\n\n' + task + '.\n\nOnly read files; report back in two sentences.' + (opts.reply === 'long' ? '\n\n' + LONG_TEXT : '');
      emit({ ...base, type: 'toolCall', callId: call, tool: 'task', phase: 'start', args: { description: task, prompt, agent_type: 'explore' } });
      emit({ ...base, type: 'subagent', subagentId: call, name, phase: 'started', task, agentName: 'explore', model: 'gpt-5.6-luna' });
      emit({ ...base, type: 'user', agentId: call, text: prompt });
      emit({ ...base, type: 'status', status: 'working', agentId: call, intent: task });
      if (h % 2 === 0) emit({ ...base, type: 'thinking', agentId: call, reasoningId: call + '-r', delta: '**Scoping the check**\n\nOnly the touched files matter, so I will start with ' + s.files[0] + '. ' });
      const f = s.files[h % s.files.length];
      emit({ ...base, type: 'toolCall', agentId: call, callId: call + '-v', tool: 'view', phase: 'start', args: { path: f } });
      emit({ ...base, type: 'toolCall', agentId: call, callId: call + '-v', tool: 'view', phase: 'complete', output: '120 lines' });
      emit({ ...base, type: 'usage', agentId: call, model: 'auto', inputTokens: 3900, outputTokens: 60, ...(unreported(s) || !caps(s.info.adapterId ?? 'copilot').usage.nanoAiu ? { creditsStatus: 'unavailable' as const } : { nanoAiu: 8_000_000, creditsStatus: 'complete' as const }), ...(caps(s.info.adapterId ?? 'copilot').usage.costUsd ? { costUsd: 0.0008, costBasis: 'estimate' as const } : {}) });
      if (st === 'working' || st === 'thinking') {
        emit({ ...base, type: 'toolCall', agentId: call, callId: call + '-g', tool: 'grep', phase: 'start', args: { pattern: 'registerTool' } });
        // the helper card's last line is its newest tool start: a command with a secret flag, or a URL with a secret query (FR-065)
        if (opts.reply === 'secrets') emit({ ...base, type: 'toolCall', agentId: call, callId: call + '-sc', ...(h % 2 === 0 ? { tool: 'bash', args: { command: 'curl --api-key ' + SECRET_KEY + ' https://example.test/a' } } : { tool: 'web_fetch', args: { url: 'https://example.test/a?key=' + SECRET_KEY } }), phase: 'start' });
        return;
      }
      if (st === 'failed') {
        emit({ ...base, type: 'subagent', subagentId: call, name, phase: 'failed', task: 'Failed: 4 strict-null errors remain', error: 'Failed: ' + (opts.reply === 'secrets' ? FILL(85) + SECRETS_TEXT + ' ' : '') + '4 strict-null errors remain', agentName: 'explore', model: 'gpt-5.6-luna', durationMs: 7400, totalTokens: 9100, totalToolCalls: 3 });
        emit({ ...base, type: 'toolCall', callId: call, tool: 'task', phase: 'failed', output: 'Failed: 4 strict-null errors remain' });
        return;
      }
      const res = opts.reply === 'secrets' ? FILL(93) + SECRETS_TEXT : '**' + name + '**: ' + task.toLowerCase() + ' finished. `' + f + '` is fine; nothing else needs changing.';
      emit({ ...base, type: 'output', agentId: call, delta: '', final: true, text: res });
      emit({ ...base, type: 'subagent', subagentId: call, name, phase: 'completed', agentName: 'explore', model: 'gpt-5.6-luna', durationMs: 6200, totalTokens: 8100, totalToolCalls: 2 });
      emit({ ...base, type: 'toolCall', callId: call, tool: 'task', phase: 'complete', output: res });
    }
    function closeOpen(s: SimAgent): void {
      if (!s.open) return;
      emit({ type: 'toolCall', sessionId: sid(s), timestamp: now(), callId: s.open, tool: 'bash', phase: 'complete', output: 'ok' });
      s.open = undefined;
    }
    const think = (s: SimAgent, sentences: number): void => {
      const rid = sid(s) + '-r' + (s.think >> 3);
      for (let i = 0; i < sentences; i++) emit({ type: 'thinking', sessionId: sid(s), timestamp: now(), reasoningId: rid, delta: THINK[s.think++ % THINK.length] });
    };

    const dirOf = (f: string): string => (f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '.');
    const scopeOf = (f: string): { key: string; label: string } => !f ? { key: 'write:', label: 'write' } : ({ key: 'write:' + dirOf(f), label: 'write in ' + dirOf(f).split('/').slice(-2).join('/') + '/' });
    const grantsEvent = (s: SimAgent): void =>
      emit({ type: 'grants', sessionId: sid(s), timestamp: now(), grants: [...s.grants].map(([key, label]) => ({ key, kind: 'write', label })) });
    /** Activity log (spec 052 FR-071): a few canned rows, plus a row for each answer, automatic approval, mode or limit change in the simulator. */
    const SIM_APP: Record<string, string> = { copilot: 'GitHub Copilot', claude: 'Claude Code', codex: 'OpenAI Codex' };
    const simActivity: ActivityRow[] = (() => {
      const t = (minAgo: number): string => new Date(Date.now() - minAgo * 60_000).toISOString();
      return [
        { t: t(42), agent: 'Ana', folder: 'web-shop', app: 'GitHub Copilot', mode: 'ask', action: 'Edit src/cart.ts', decision: 'allowed-once' },
        { t: t(37), agent: 'Ana', folder: 'web-shop', app: 'GitHub Copilot', mode: 'ask', action: 'Run npm test', decision: 'allowed-session' },
        { t: t(31), agent: 'Ana', folder: 'web-shop', app: 'GitHub Copilot', mode: 'ask', action: 'Run npm test', decision: 'auto-session-grant' },
        { t: t(25), agent: 'Ben', folder: 'api', app: 'GitHub Copilot', mode: 'ask', action: 'Fetch https://example.com/docs', decision: 'denied' },
        { t: t(18), agent: 'Ben', folder: 'api', app: 'GitHub Copilot', mode: 'allow', action: 'Ask first to Allow all', decision: 'mode-change' },
        { t: t(12), agent: 'Ben', folder: 'api', app: 'GitHub Copilot', mode: 'allow', action: 'Edit server/routes.ts', decision: 'auto-allow-all' },
        { t: t(6), agent: 'Ben', folder: 'api', app: 'GitHub Copilot', mode: 'allow', action: 'Spending limit set to 300 AI credits', decision: 'limit-change' },
      ] as ActivityRow[];
    })();
    const simLog = (s: SimAgent, decision: ActivityRow['decision'], action: string, mode: string = s.info.permMode): void => {
      simActivity.push({ t: new Date().toISOString(), agent: s.info.label || s.info.name, folder: s.info.cwd.split(/[\\/]/).pop() || s.info.name, app: SIM_APP[s.info.adapterId ?? 'copilot'] ?? String(s.info.adapterId), mode, action: action.slice(0, 160), decision });
      if (simActivity.length > 5000) simActivity.splice(0, simActivity.length - 5000);
    };
    /** Like the real broker: auto-approve under a session grant, otherwise leave the request pending. */
    function askWrite(s: SimAgent, file: string, summary: string, cont: 'tool' | 'edit', intent: string, force = false, kind: 'write' | 'shell' = 'write', diff?: string, scope?: SimScope & { folders?: SimScope[] }): boolean | 'denied' {
      const sc: SimScope & { folders?: SimScope[] } = scope ?? (kind === 'shell' ? { key: 'shell:' + file, label: 'run ' + file } : scopeOf(file));
      if (!force && s.info.permMode === 'allow') { simLog(s, 'auto-allow-all', summary); return true; } // Allow all: no question asked
      if (!force && s.info.permMode === 'read-only') {
        emit({ type: 'permission', sessionId: sid(s), timestamp: now(), permission: { requestId: 'perm-' + sid(s) + '-' + now(), kind, summary, state: 'denied' } });
        return 'denied';
      }
      const requestId = 'perm-' + sid(s) + '-' + now();
      const base = { requestId, kind, summary, scopeKey: sc.key, scopeLabel: sc.label };
      if (sc.folders ? sc.folders.every((x) => s.grants.has(x.key)) : s.grants.has(sc.key)) { // like the broker: every folder granted
        emit({ type: 'permission', sessionId: sid(s), timestamp: now(), permission: { ...base, state: 'approved', via: 'session' } });
        simLog(s, 'auto-session-grant', summary);
        return true;
      }
      s.perm = { ...base, file, cont, ...(sc.folders ? { folders: sc.folders } : {}) };
      s.state = 'waiting';
      emit({ type: 'status', sessionId: sid(s), timestamp: now() - (opts.waitOld ? 120_000 : 0), status: 'needs-permission', intent, permission: { ...base, state: 'pending', ...(diff ? { diff } : {}) } });
      return false;
    }
    function editTool(s: SimAgent, file: string, ok: boolean): void {
      const id = sid(s) + '-edit' + s.tool++;
      emit({ type: 'toolCall', sessionId: sid(s), timestamp: now(), callId: id, tool: 'edit_file', phase: 'start', args: { path: file } });
      emit({ type: 'toolCall', sessionId: sid(s), timestamp: now(), callId: id, tool: 'edit_file', phase: ok ? 'complete' : 'failed', output: ok ? '+4 -1' : 'Denied by user in Agent Durbar.' });
    }
    /* spec 005 FR-026 (simedits=1): what the adapters send for file edits, with the arguments of the last one streaming in. A
       simulation, not a recording. The new file holds a token-shaped value on purpose: the page must mask it (FR-024). */
    function simEdits(s: SimAgent): void {
      const base = (s.info.cwd || '~/work').replace(/[\\/]+$/, '');
      const p1 = sid(s) + '-patch';
      const patch: EditInfo = { files: [
        { path: base + '/src/routes/users.ts', kind: 'edit', ...simDiffOf(['router.get("/users", list);'], ['router.get("/users", auth, list);', 'router.post("/users", auth, create);'], 12) },
        { path: base + '/src/routes/index.ts', kind: 'create', ...simDiffOf([], ['export { default as users } from "./users";', 'export { default as health } from "./health";'], 1) },
      ] };
      emit({ type: 'toolCall', sessionId: sid(s), timestamp: now(), callId: p1, tool: 'apply_patch', phase: 'start', args: { path: patch.files[0].path }, edit: patch });
      emit({ type: 'toolCall', sessionId: sid(s), timestamp: now(), callId: p1, tool: 'apply_patch', phase: 'complete', output: 'Applied the patch to 2 files', edit: patch });
      const p2 = sid(s) + '-write';
      const env = simEdit(base + '/config/.env.example', 'create', [], ['PORT=3000', 'API_TOKEN=ghp_simulatedTokenValue0123456789abcdef', 'LOG_LEVEL=info']);
      emit({ type: 'toolCall', sessionId: sid(s), timestamp: now(), callId: p2, tool: 'Write', phase: 'start', args: { path: env.files[0].path }, edit: env });
      emit({ type: 'toolCall', sessionId: sid(s), timestamp: now(), callId: p2, tool: 'Write', phase: 'complete', output: 'File created successfully', edit: env });
      // a refused edit (this agent is in Read-only): the row must say it was not done (review on #463)
      const p4 = sid(s) + '-refused';
      const gone: EditInfo = { files: [{ path: base + '/src/legacy/old-routes.js', kind: 'delete', ...simDiffOf(['module.exports = require("./v0");'], [], 1) }] };
      emit({ type: 'toolCall', sessionId: sid(s), timestamp: now(), callId: p4, tool: 'apply_patch', phase: 'start', args: { path: gone.files[0].path }, edit: gone });
      emit({ type: 'toolCall', sessionId: sid(s), timestamp: now(), callId: p4, tool: 'apply_patch', phase: 'failed', output: 'declined', edit: gone });
      // the streamed Edit: start as soon as the path is known, then partial diffs; it stays open (the model is still writing)
      const p3 = sid(s) + '-stream';
      const path = base + '/src/server/app.js';
      const oldL = ['const port = 3000;', 'app.listen(port);'];
      const newL = ['const port = Number(process.env.PORT) || 3000;', 'const host = process.env.HOST || "127.0.0.1";', '', 'app.use(express.json({ limit: "1mb" }));', 'app.use(requestLog());', ''];
      for (let i = 0; i < 24; i++) newL.push(`app.get("/api/v1/item${i}", (req, res) => res.json(store.get(${i})));`);
      newL.push('', 'app.listen(port, host, () => log.info(`listening on ${host}:${port}`));');
      emit({ type: 'toolCall', sessionId: sid(s), timestamp: now(), callId: p3, tool: 'Edit', phase: 'start', args: { path } });
      const steps = [3, 10, 20, newL.length - 1];
      const step = (k: number): void => {
        const ed = simEdit(path, 'edit', oldL, newL.slice(0, steps[k]));
        ed.partial = true;
        emit({ type: 'toolCall', sessionId: sid(s), timestamp: now(), callId: p3, tool: 'Edit', phase: 'update', edit: ed });
        if (k + 1 < steps.length) window.setTimeout(() => step(k + 1), opts.freeze ? 0 : 350);
      };
      step(0);
    }
    function finishReply(s: SimAgent, ok: boolean, file: string): void {
      const out = ok ? 'Simulated reply: edited ' + file + '.' : 'Simulated reply: the edit to ' + file + ' was denied, so I left it unchanged.';
      emit({ type: 'output', sessionId: sid(s), timestamp: now(), delta: out, final: true, text: out });
      emit({ type: 'status', sessionId: sid(s), timestamp: now(), status: 'idle' });
      s.state = 'done';
    }

    /* spec 068 FR-017 (simbreak=N, seconds 5-3600): Tomas hits a 5-hour window that resets in N s (instead of the 429), Rosa the monthly
       premium-request quota with no reset time (it really lifts after 2N s, which the app is not told); Omar keeps his 30 AIU cap. */
    const simBreakSecs = ((): number => {
      const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('simbreak') : null;
      if (q === null) return 0;
      const n = Number(q);
      return Number.isFinite(n) && n >= 5 && n <= 3600 ? Math.round(n) : 120;
    })();
    const simLimit = (s: SimAgent, kind: 'plan' | 'quota'): void => {
      const id = sid(s);
      s.state = 'idle';
      closeOpen(s);
      if (kind === 'plan') emit({ type: 'usageLimit', sessionId: id, timestamp: now(), scope: 'plan', resetsAt: s.breakUntil, source: 'Simulated 5-hour window' });
      else emit({ type: 'usageLimit', sessionId: id, timestamp: now(), scope: 'quota', paid: true, source: 'Simulated premium requests' });
      emit({ type: 'status', sessionId: id, timestamp: now(), status: 'idle', intent: 'Usage limit reached', reason: 'usage-limit' }); // spec 068: the marker, as the adapters' usageLimitClosing()
    };
    function play(s: SimAgent): void {
      if (s.info.resumeLast) return; // spec 006 FR-021 (simresume=1): restored, nothing runs until its chat is opened
      emit({ type: 'user', sessionId: sid(s), timestamp: now(), text: s.prompt, attachments: (s.attachments ?? []).map((p) => ({ path: p, kind: /\.(png|jpe?g|gif)$/i.test(p) ? 'image' as const : 'file' as const })) });
      if (s.state === 'idle') return;
      mcpStatus(s, sims.indexOf(s));
      // An agent that already compacted once earlier in its session (spec 030): the chat shows that line.
      if (s.compactions && s.ctx) emit({ type: 'compaction', sessionId: sid(s), timestamp: now(), phase: 'complete', trigger: 'auto', tokensBefore: Math.round(s.ctx.limit * 0.95), tokensAfter: Math.round(s.ctx.limit * 0.24), tokensRemoved: Math.round(s.ctx.limit * 0.71), limit: s.ctx.limit });
      emit({ type: 'status', sessionId: sid(s), timestamp: now(), status: 'working', intent: s.intent });
      if (s.state !== 'done') think(s, 4); // done agents show a turn without reasoning (the model sent none)
      const done = sims.indexOf(s) === 0 ? 8 : s.state === 'working' ? 4 : 3;
      for (let i = 0; i < done; i++) { toolStep(s, false); usage(s); if (s.limitReq) break; }
      /* spec 034: one agent (Sven) has just had three failed tool calls in a row, so "dizzy" can be seen */
      if (s.info.name === 'Sven') for (let n = 0; n < 3; n++) {
        const id = sid(s) + '-dz' + n;
        emit({ type: 'toolCall', sessionId: sid(s), timestamp: now(), callId: id, tool: 'bash', phase: 'start', args: { command: 'npm run build' } });
        emit({ type: 'toolCall', sessionId: sid(s), timestamp: now(), callId: id, tool: 'bash', phase: 'failed', output: 'error TS2339: Property \'status\' does not exist on type \'Store\'' });
      }
      if (s.limitReq) return; // blocked at the credit cap: nothing more happens until the user decides
      // Sub-agents: each one is a `task` tool call of the parent; its own events carry agentId = that call id
      for (let h = 0; h < (caps(s.info.adapterId ?? 'copilot').helpers ? s.helpers : 0); h++) {
        const [hn, task, st] = HELPER_NAMES[(h + sims.indexOf(s)) % HELPER_NAMES.length];
        subRun(s, h, hn, task, st as 'working' | 'thinking' | 'done' | 'failed');
      }
      switch (s.state) {
        case 'working':
          emit({ type: 'status', sessionId: sid(s), timestamp: now(), status: 'working', intent: s.intent });
          toolStep(s, true);
          emit({ type: 'output', sessionId: sid(s), timestamp: now(), delta: 'Moved the company handlers first and kept a thin re-export in `registry.ts` so the public API is unchanged. Next I am running the **tests** for the three new modules.' + (opts.reply === 'long' ? ' ' + LONG_TEXT : '') });
          if (simBreakSecs && s.info.name === 'Rosa') window.setTimeout(() => { s.breakUntil = Date.now() + 2 * simBreakSecs * 1000; simLimit(s, 'quota'); }, 1500); // spec 068
          break;
        case 'thinking':
          think(s, 2);
          break;
        case 'waiting': {
          const w = codexFileReq(s) ?? WAIT_REQ[s.info.name] ?? { kind: 'write' as const, summary: 'Edit ' + s.files[0], target: s.files[0] };
          askWrite(s, w.target, w.summary, 'tool', s.intent, true, w.kind, w.diff, w.scope);
          break;
        }
        case 'error':
          if (simBreakSecs && s.info.name === 'Tomas') { s.breakUntil = Date.now() + simBreakSecs * 1000; simLimit(s, 'plan'); break; }
          emit({ type: 'toolCall', sessionId: sid(s), timestamp: now(), callId: sid(s) + '-fail', tool: 'bash', phase: 'start', args: { command: 'python evals/run.py --prompt v7 --concurrency 8' } });
          emit({ type: 'toolCall', sessionId: sid(s), timestamp: now(), callId: sid(s) + '-fail', tool: 'bash', phase: 'failed', output: 'RateLimitError: 429 Too Many Requests (retry after 38s)\nStopped at case 38 of 120. Partial results saved to evals/out/v7-partial.json' });
          emit({ type: 'status', sessionId: sid(s), timestamp: now(), status: 'error', intent: (opts.reply === 'secrets' ? SECRETS_TEXT + ' ' : '') + s.intent });
          break;
        case 'done': {
          const text = '**Done.** ' + (opts.reply === 'secrets' ? SECRETS_TEXT + ' ' : '') + s.intent + ' Every link in the docs index resolves and the tests pass.' + (opts.reply === 'long' ? ' ' + LONG_TEXT : '');
          emit({ type: 'output', sessionId: sid(s), timestamp: now(), delta: text, final: true, text });
          emit({ type: 'status', sessionId: sid(s), timestamp: now(), status: 'idle' });
          break;
        }
      }
    }

    // Slow, calm background activity: one agent advances every few seconds.
    let timer: number | undefined;
    function tick(): void {
      const live = sims.filter((s) => (s.state === 'working' || s.state === 'thinking') && !s.limitReq);
      if (!live.length) return;
      const s = pick(live);
      if (s.state === 'working') {
        closeOpen(s); usage(s);
        if (rnd() < 0.25) { s.state = 'thinking'; think(s, 1); }
        else { toolStep(s, true); emit({ type: 'output', sessionId: sid(s), timestamp: now(), delta: ' ' }); }
      } else {
        think(s, 1);
        if (rnd() < 0.5) { s.state = 'working'; emit({ type: 'status', sessionId: sid(s), timestamp: now(), status: 'working', intent: s.intent }); toolStep(s, true); }
      }
    }

    // Replies to chat messages the user types in sim mode.
    const wait = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));
    /** Spec 066 FR-008: a simulated plan-first turn: the agent reads, then proposes a plan and waits. */
    function simPlan(s: SimAgent, text: string, feedback?: string): void {
      const id = s.info.id;
      const requestId = `sim-plan-${id}-${Date.now()}`;
      emit({ type: 'status', sessionId: id, timestamp: now(), status: 'working', intent: 'Planning' });
      window.setTimeout(() => {
        s.planReq = { id: requestId, text };
        const goal = String(text).replace(/\s+/g, ' ').trim().slice(0, 80) || 'the task';
        const plan = `**Plan for:** ${goal}\n\n1. Read \`src/auth/login.ts\` and its tests to see how sessions are created.\n2. Move token checks into a new \`src/auth/tokens.ts\` and keep the old exports.\n3. Update the three callers and run \`npm test\`.${feedback ? `\n4. As you asked: ${String(feedback).slice(0, 200)}` : ''}\n\nNothing is changed until you approve.`;
        emit({ type: 'status', sessionId: id, timestamp: now(), status: 'idle', intent: 'Plan ready' });
        emit({ type: 'plan', sessionId: id, timestamp: now(), phase: 'proposed', requestId, text: plan });
      }, 700);
    }

    async function reply(s: SimAgent, text: string): Promise<void> {
      closeOpen(s);
      emit({ type: 'status', sessionId: sid(s), timestamp: now(), status: 'working', intent: 'Answering: ' + text.slice(0, 60) });
      if (/\bfallback\b/i.test(text)) runtimeSwitch(s, 'fallback'); // demo: the runtime switches models by itself (spec 030 FR-015)
      if (!/\bquick\b/i.test(text)) for (let i = 0; i < 4; i++) { think(s, 1); await wait(650); } // "quick": a turn where the model sends no reasoning
      if (/\b(markdown|md|format)\b/i.test(text)) {
        emit({ type: 'output', sessionId: sid(s), timestamp: now(), delta: MD_REPLY, final: true, text: MD_REPLY + '\n\n[unsafe link](javascript:alert(1)) and <script>alert(1)</script> stay inert.' });
        emit({ type: 'status', sessionId: sid(s), timestamp: now(), status: 'idle' });
        s.state = 'done';
        return;
      }
      if (/\bsub-?agents?|helper|delegate\b/i.test(text)) {
        subRun(s, 90 + s.tool++, 'Docs check', 'Compare README.md and index.js', 'done');
        const o = 'Both files agree: the README describes a **tiny dummy app** and `index.js` only prints a greeting.';
        emit({ type: 'output', sessionId: sid(s), timestamp: now(), delta: o, final: true, text: o });
        emit({ type: 'status', sessionId: sid(s), timestamp: now(), status: 'idle' });
        s.state = 'done';
        return;
      }
      if (/\b(edit|write|change|fix|rename)\b/i.test(text)) {
        // Edit request: ask for write permission (or use a session grant), then edit inline in the timeline.
        const file = s.files[0];
        toolStep(s, false);
        usage(s);
        const r = askWrite(s, file, 'write ' + file, 'edit', 'Waiting for permission: write ' + file);
        if (r === true) { editTool(s, file, true); finishReply(s, true, file); }
        else if (r === 'denied') { editTool(s, file, false); finishReply(s, false, file); }
        return;
      }
      toolStep(s, false);
      usage(s);
      const out = 'Simulated reply. I read ' + s.files[0] + ' and nothing else depends on it, so this is safe to change.';
      emit({ type: 'output', sessionId: sid(s), timestamp: now(), delta: out, final: true, text: out });
      emit({ type: 'status', sessionId: sid(s), timestamp: now(), status: 'idle' });
      s.state = 'done';
    }


    // ---- Fake MCP settings (specs 019, 020): the Copilot CLI list is global and fixed; extras are per folder; in memory only, same masking rules as the real store ----
    interface FakeSrv { name: string; transport: 'stdio' | 'http' | 'sse'; command?: string; args?: string[]; workingDirectory?: string; url?: string; tools?: string[]; enabled: boolean; trusted: boolean; env: { key: string; set: boolean }[]; headers: { key: string; set: boolean }[]; needsSecrets: boolean }
    const fakeExtras: Record<string, FakeSrv[]> = {
      '~/work/mcp-swiss': [
        { name: 'playwright', transport: 'stdio', command: 'npx', args: ['@playwright/mcp@latest'], enabled: true, trusted: true, env: [], headers: [], needsSecrets: false },
        { name: 'docs-search', transport: 'http', url: 'https://docs.example.test/mcp', enabled: false, trusted: false, env: [], headers: [{ key: 'X-Api-Key', set: true }], needsSecrets: false },
      ],
    };
    const fakeLegacy: FakeSrv[] = [
      { name: 'old-fetch', transport: 'stdio', command: 'uvx', args: ['mcp-server-fetch'], enabled: false, trusted: false, env: [], headers: [], needsSecrets: false },
    ];
    const fakeCli = [
      { name: 'github', origin: 'copilot-config' as const, transport: 'stdio' as const, command: 'npx', args: ['-y', '@example/github-mcp'], enabled: true },
      { name: 'my-notes', origin: 'copilot-config' as const, transport: 'stdio' as const, command: 'node', args: ['/home/vikram/tools/notes-mcp.js'], enabled: true },
      { name: 'github-mcp-server', origin: 'builtin' as const, enabled: true },
      ...SIM_REMOTE.map((r) => ({ name: r.name, origin: 'copilot-config' as const, transport: 'http' as const, url: r.url, enabled: true })),
    ];
    // ---- Fake agent-app lists (spec 069 FR-040): in memory; previews masked like main's; nothing is written anywhere ----
    type GApp = 'copilot' | 'claude' | 'codex';
    type GView = { name: string; transport: 'stdio' | 'http' | 'sse' | 'other'; command?: string; args?: string[]; url?: string; envKeys: string[]; headerKeys: string[]; refs?: boolean };
    const G_LABEL: Record<GApp, string> = { copilot: 'Copilot CLI', claude: 'Claude Code', codex: 'Codex' };
    const G_FILE: Record<GApp, string> = { copilot: '~/.copilot/mcp-config.json', claude: '~/.claude.json', codex: '~/.codex/config.toml' };
    const gLists: Record<GApp, GView[]> = {
      copilot: [
        { name: 'github', transport: 'stdio', command: 'npx', args: ['-y', '@example/github-mcp'], envKeys: [], headerKeys: [] },
        { name: 'my-notes', transport: 'stdio', command: 'node', args: ['/home/vikram/tools/notes-mcp.js'], envKeys: [], headerKeys: [] },
      ],
      claude: [
        { name: 'github', transport: 'stdio', command: 'npx', args: ['-y', '@example/github-mcp'], envKeys: [], headerKeys: [] },
        { name: 'sentry', transport: 'http', url: 'https://mcp.sentry.example/mcp', envKeys: [], headerKeys: ['Authorization'], refs: true },
        { name: 'my-notes', transport: 'stdio', command: 'node', args: ['/home/vikram/tools/notes-mcp-v1.js'], envKeys: [], headerKeys: [] },
      ],
      codex: [{ name: 'context7', transport: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'], envKeys: [], headerKeys: [] }],
    };
    const gOff = new Set<string>();
    const simToolsOff: Record<string, Record<string, string[]>> = {};
    let gSeq = 0;
    const gPending = new Map<string, { kind: 'add' | 'remove'; apps: GApp[]; view?: GView; name: string }>();
    const G_APPS: GApp[] = ['copilot', 'claude', 'codex'];
    const gApps = (l: unknown): GApp[] => (Array.isArray(l) ? G_APPS.filter((a) => l.includes(a)) : []);
    const gEntry = (app: GApp, i: McpServerInput, mode: string): string => {
      const v = (k: string, hk?: boolean) => (mode === 'ref' ? '${' + (hk ? k.toUpperCase().replace(/[^A-Z0-9_]/g, '_') : k) + '}' : '••••••');
      if (app === 'codex') {
        const lines = [`[mcp_servers.${i.name}]`];
        if (i.transport === 'stdio') { lines.push(`command = "${i.command ?? ''}"`); if (i.args?.length) lines.push(`args = [${i.args.map((a) => JSON.stringify(a)).join(', ')}]`); if (i.env?.length) lines.push(mode === 'ref' ? `env_vars = [${i.env.map((e) => JSON.stringify(e.key)).join(', ')}]` : `env = { ${i.env.map((e) => `"${e.key}" = "••••••"`).join(', ')} }`); }
        else { lines.push(`url = "${i.url ?? ''}"`); if (i.headers?.length) lines.push(mode === 'ref' ? `env_http_headers = { ${i.headers.map((h) => `"${h.key}" = "${h.key.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}"`).join(', ')} }` : `http_headers = { ${i.headers.map((h) => `"${h.key}" = "••••••"`).join(', ')} }`); }
        return lines.join('\n');
      }
      const e = i.transport === 'stdio'
        ? { type: app === 'copilot' ? 'local' : 'stdio', command: i.command, args: i.args ?? [], ...(i.env?.length ? { env: Object.fromEntries(i.env.map((x) => [x.key, v(x.key)])) } : {}), ...(app === 'copilot' ? { tools: ['*'] } : {}) }
        : { type: i.transport, url: i.url, ...(i.headers?.length ? { headers: Object.fromEntries(i.headers.map((x) => [x.key, v(x.key, true)])) } : {}), ...(app === 'copilot' ? { tools: ['*'] } : {}) };
      const one = (v: unknown): string => (Array.isArray(v) ? '[' + v.map((x) => JSON.stringify(x)).join(', ') + ']' : '{ ' + Object.entries(v as Record<string, unknown>).map(([k, x]) => `${JSON.stringify(k)}: ${JSON.stringify(x)}`).join(', ') + ' }');
      return `${JSON.stringify(i.name)}: {\n${Object.entries(e).map(([k, v]) => `  ${JSON.stringify(k)}: ${v && typeof v === 'object' ? one(v) : JSON.stringify(v)}`).join(',\n')}\n}`;
    };
    const globalApi: Partial<DurbarApi> = {
      mcpGlobalState: async () => ({ ok: true, apps: G_APPS.map((app) => ({ app, label: G_LABEL[app], file: G_FILE[app], found: true, servers: gLists[app].map((x) => ({ ...x })), off: app === 'claude' ? [...gOff] : [] })) }),
      mcpGlobalPreview: async (input, apps, mode) => {
        const i = input as McpServerInput;
        const list = gApps(apps);
        if (!list.length) return { ok: false, error: 'Pick at least one agent app.', items: [] };
        if (!i || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,47}$/.test(i.name ?? '')) return { ok: false, error: 'Name: 1-48 characters, letters, digits, "_", "." or "-", starting with a letter or digit.', items: [] };
        const token = 'sim-' + ++gSeq;
        const view: GView = { name: i.name, transport: i.transport, command: i.command, args: i.args, url: i.url, envKeys: (i.env ?? []).map((e) => e.key), headerKeys: (i.headers ?? []).map((h) => h.key), ...(mode === 'ref' && (i.env?.length || i.headers?.length) ? { refs: true } : {}) };
        gPending.set(token, { kind: 'add', apps: list, view, name: i.name });
        const vars = mode === 'ref' ? [...(i.env ?? []).map((e) => e.key), ...(i.headers ?? []).map((h) => h.key.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))] : [];
        return { ok: true, token, ...(vars.length ? { vars } : {}), items: list.map((app) => {
          const cur = gLists[app].find((x) => x.name === i.name);
          const err = app === 'codex' && i.name.includes('.') ? 'Codex needs a name of letters, digits, "_" or "-" (no dots).' : app === 'codex' && i.transport === 'sse' ? 'Codex takes http servers only, not sse.' : undefined;
          return { app, label: G_LABEL[app], file: G_FILE[app], exists: true, entry: gEntry(app, i, mode === 'plain' ? 'plain' : 'ref'), ...(cur ? { conflict: true, current: { ...cur } } : {}), ...(err ? { error: err } : {}), ...(app === 'copilot' && vars.length ? { note: 'Not verified for Copilot: whether the Copilot CLI replaces ${NAME} with the variable\'s value. Check the server starts in a Copilot session.' } : {}) };
        }) };
      },
      mcpGlobalApply: async (token, replace) => {
        const p = gPending.get(token);
        gPending.delete(token);
        if (!p || !p.view) return { ok: false, error: 'This review has expired. Review again.', items: [] };
        const items = p.apps.map((app) => {
          const has = gLists[app].findIndex((x) => x.name === p.name);
          if (app === 'codex' && (p.name.includes('.') || p.view?.transport === 'sse')) return { app, file: G_FILE[app], ok: false, error: 'Not written.' };
          if (has >= 0 && !(replace ?? []).includes(app)) return { app, file: G_FILE[app], ok: false, error: 'Already there; not replaced.' };
          if (has >= 0) gLists[app][has] = { ...(p.view as GView) }; else gLists[app].push({ ...(p.view as GView) });
          return { app, file: G_FILE[app], ok: true, backup: G_FILE[app].split('/').pop() + '.durbar-20261021T210600Z.bak' };
        });
        return { ok: items.some((x) => x.ok), items };
      },
      mcpGlobalRemovePreview: async (name, apps) => {
        const list = gApps(apps);
        const token = 'sim-' + ++gSeq;
        gPending.set(token, { kind: 'remove', apps: list, name });
        return { ok: true, token, items: list.map((app) => {
          const cur = gLists[app].find((x) => x.name === name);
          return { app, label: G_LABEL[app], file: G_FILE[app], exists: true, entry: cur ? (cur.command ? [cur.command, ...(cur.args ?? [])].join(' ') : cur.url ?? '') : '', ...(cur ? {} : { error: `"${name}" is not in this file.` }) };
        }) };
      },
      mcpGlobalRemoveApply: async (token) => {
        const p = gPending.get(token);
        gPending.delete(token);
        if (!p) return { ok: false, error: 'This review has expired. Review again.', items: [] };
        const items = p.apps.map((app) => {
          const i = gLists[app].findIndex((x) => x.name === p.name);
          if (i < 0) return { app, file: G_FILE[app], ok: false, error: 'Not in this file.' };
          gLists[app].splice(i, 1);
          return { app, file: G_FILE[app], ok: true, backup: G_FILE[app].split('/').pop() + '.durbar-20261021T210600Z.bak' };
        });
        return { ok: items.some((x) => x.ok), items };
      },
      mcpGlobalDiff: async () => {
        const names: string[] = [];
        for (const a of G_APPS) for (const v of gLists[a]) if (!names.includes(v.name)) names.push(v.name);
        const key = (v: GView) => JSON.stringify([v.transport, v.command ?? '', v.args ?? [], v.url ?? '', [...v.envKeys].sort(), [...v.headerKeys].sort()]);
        const items = names.map((name) => {
          const inApps = G_APPS.filter((a) => gLists[a].some((x) => x.name === name));
          const vs = inApps.map((a) => gLists[a].find((x) => x.name === name) as GView);
          const differs: string[] = [];
          if (vs.some((v) => key(v) !== key(vs[0]))) {
            if (vs.some((v) => (v.command ?? '') !== (vs[0].command ?? ''))) differs.push('command');
            if (vs.some((v) => JSON.stringify(v.args ?? []) !== JSON.stringify(vs[0].args ?? []))) differs.push('arguments');
            if (vs.some((v) => (v.url ?? '') !== (vs[0].url ?? ''))) differs.push('URL');
            if (!differs.length) differs.push('environment variables');
          }
          return { name, in: inApps, missing: G_APPS.filter((a) => !inApps.includes(a)), differs, from: inApps };
        }).filter((i) => i.missing.length || i.differs.length);
        return { ok: true, apps: [...G_APPS], items };
      },
      mcpGlobalCopyPreview: async (name, from, to) => {
        const v = gLists[from]?.find((x) => x.name === name);
        if (!v) return { ok: false, error: `"${name}" is not in ${G_LABEL[from]}'s list any more.`, items: [] };
        const list = gApps(to).filter((a) => a !== from);
        if (!list.length) return { ok: false, error: 'Pick at least one agent app to copy to.', items: [] };
        const i: McpServerInput = { name, transport: v.transport === 'other' ? 'stdio' : v.transport, command: v.command, args: v.args, url: v.url, env: v.envKeys.map((key) => ({ key })), headers: v.headerKeys.map((key) => ({ key })) };
        const token = 'sim-' + ++gSeq;
        gPending.set(token, { kind: 'add', apps: list, view: { ...v }, name });
        const mode = v.refs ? 'ref' : 'plain';
        const vars = v.refs ? [...v.envKeys, ...v.headerKeys.map((h) => h.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))] : [];
        return { ok: true, token, ...(vars.length ? { vars } : {}), items: list.map((app) => {
          const cur = gLists[app].find((x) => x.name === name);
          return { app, label: G_LABEL[app], file: G_FILE[app], exists: true, entry: gEntry(app, i, mode), ...(cur ? { conflict: true, current: { ...cur } } : {}) };
        }) };
      },
      mcpGlobalSetOff: async (app, name, off) => {
        if (app !== 'claude') return { ok: false };
        if (off) gOff.add(name); else gOff.delete(name);
        return { ok: true };
      },
    };
    const gSources = (name: string, folder: boolean): McpSourceTag[] => {
      const out: McpSourceTag[] = G_APPS.filter((a) => gLists[a].some((x) => x.name === name));
      if (folder) out.push('folder');
      if (name === 'github-mcp-server') out.push('builtin');
      if (!out.length) out.push('runtime');
      return out;
    };
    const fakeView = (v: FakeSrv) => ({ ...v, env: v.env.map((e) => ({ ...e })), headers: v.headers.map((e) => ({ ...e })) });
    const extrasOf = (key: string): FakeSrv[] => (fakeExtras[key] ??= []);
    const knownFolder = (key: string): boolean => sims.some((x) => x.info.cwd === key);
    const folderName = (key: string): string => key.replace(/\/+$/, '').split('/').pop() || key;
    const mcpApi: Partial<DurbarApi> = {
      mcpState: async () => ({ cli: fakeCli.map((a) => ({ ...a })), file: { label: '~/.copilot/mcp-config.json', found: true, skipped: 0 }, secretsPersist: true }),
      mcpExtraNames: async () => {
        const taken = new Set(fakeCli.map((a) => a.name.toLowerCase()));
        const names = new Set<string>();
        for (const list of Object.values(fakeExtras)) for (const v of list) if (!taken.has(v.name.toLowerCase())) names.add(v.name);
        return { ok: true, names: [...names].sort().slice(0, 500) };
      },
      mcpSetCli: async (name, enabled) => { const a = fakeCli.find((x) => x.name === name); if (a) a.enabled = enabled; return { ok: !!a }; },
      mcpFolderState: async (key) => !knownFolder(key)
        ? { ok: false, error: 'Unknown folder.', key, name: '', servers: [], legacy: [], secretsPersist: true, skipped: [], cliNames: [] }
        : { ok: true, key, name: folderName(key), servers: extrasOf(key).map(fakeView), legacy: fakeLegacy.map(fakeView), secretsPersist: true,
            skipped: extrasOf(key).filter((v) => v.enabled && !v.trusted).map((v) => ({ name: v.name, reason: 'not trusted' })), cliNames: fakeCli.map((a) => a.name) },
      mcpUpsert: async (key, input, orig) => {
        if (!knownFolder(key)) return { ok: false, error: 'Unknown folder.' };
        if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,47}$/.test(input.name || '')) return { ok: false, error: 'Name: letters, digits, "_", "." or "-".' };
        if (fakeCli.some((a) => a.name.toLowerCase() === input.name.toLowerCase())) return { ok: false, error: '"' + input.name + '" is already a server of the Copilot CLI list. Pick another name.' };
        const list = extrasOf(key);
        const cur = orig ? list.find((x) => x.name === orig) : undefined;
        if (list.some((x) => x.name.toLowerCase() === input.name.toLowerCase() && x !== cur)) return { ok: false, error: 'A server named "' + input.name + '" already exists in this folder.' };
        const keys = (inp: { key: string; value?: string }[] | undefined, old: { key: string; set: boolean }[]) => (inp ?? []).map((r) => ({ key: r.key, set: r.value === undefined ? old.some((o) => o.key === r.key && o.set) : r.value !== '' }));
        const next: FakeSrv = { name: input.name, transport: input.transport, command: input.command, args: input.args, workingDirectory: input.workingDirectory || undefined, url: input.url, tools: input.tools, enabled: cur?.enabled ?? false, trusted: cur?.trusted ?? false,
          env: keys(input.env, cur?.env ?? []), headers: keys(input.headers, cur?.headers ?? []), needsSecrets: false };
        if (cur && (cur.command !== next.command || JSON.stringify(cur.args) !== JSON.stringify(next.args) || cur.url !== next.url || cur.transport !== next.transport)) { next.enabled = false; next.trusted = false; }
        if (cur) list[list.indexOf(cur)] = next; else list.push(next);
        return { ok: true, server: fakeView(next) };
      },
      mcpRemove: async (key, name) => { const l = extrasOf(key); const i = l.findIndex((x) => x.name === name); if (i >= 0) l.splice(i, 1); return { ok: i >= 0 }; },
      mcpSetEnabled: async (key, name, enabled, trustAck) => {
        const v = extrasOf(key).find((x) => x.name === name);
        if (!v) return { ok: false, error: 'Unknown server.' };
        if (enabled && !v.trusted) {
          if (!trustAck) return { ok: false, needsTrust: { name: v.name, transport: v.transport, command: v.command, args: v.args, url: v.url } };
          v.trusted = true;
        }
        v.enabled = enabled;
        return { ok: true, server: fakeView(v) };
      },
      mcpMoveLegacy: async (name, key) => {
        const i = fakeLegacy.findIndex((x) => x.name === name);
        if (i < 0 || !knownFolder(key)) return { ok: false, error: 'That old server no longer exists.' };
        const [v] = fakeLegacy.splice(i, 1);
        extrasOf(key).push({ ...v, enabled: false, trusted: false });
        return { ok: true, server: fakeView(v) };
      },
      mcpRemoveLegacy: async (name) => { const i = fakeLegacy.findIndex((x) => x.name === name); if (i >= 0) fakeLegacy.splice(i, 1); return { ok: i >= 0 }; },
      // spec 061: a folder's own agent setup. `simfoldersetup=1`: the first agent's folder brings hooks, rules and servers (masked
      // like main does); decisions are kept in memory; the explanation is canned (no model). Without the flag no folder has any.
      folderSetupScan: async (key) => {
        const on = typeof location !== 'undefined' && new URLSearchParams(location.search).get('simfoldersetup') === '1';
        const first = sims[0]?.info;
        if (!on || !first || key !== (first.workspaceFile ?? first.cwd)) return { ok: true, key, items: [], problems: [], accepted: [], declined: [], pending: [] };
        const items = SIM_FOLDER_SETUP;
        const d = simSetupDecisions.get(key) ?? { accepted: [], declined: [] };
        return { ok: true, key, items, problems: [], accepted: d.accepted, declined: d.declined, pending: items.map((i) => i.id).filter((id) => !d.accepted.includes(id) && !d.declined.includes(id)) };
      },
      folderSetupDecide: async (key, dec) => {
        // like the store: hooks and (S1, owner 2026-10-21) broad allow rules need the explicit tick
        const hooks = new Set(SIM_FOLDER_SETUP.filter((i) => i.kind === 'hook' || (i.kind === 'rule' && i.ruleKind === 'allow' && i.broad)).map((i) => i.id));
        const accepted = dec.accepted.filter((id) => dec.hooksConfirmed || !hooks.has(id));
        simSetupDecisions.set(key, { accepted, declined: SIM_FOLDER_SETUP.map((i) => i.id).filter((id) => !accepted.includes(id)) });
        const rules = accepted.some((id) => hooks.has(id) || SIM_FOLDER_SETUP.some((i) => i.id === id && i.kind === 'rule' && i.ruleKind !== 'deny'));
        const folderRules: Record<string, boolean> = {};
        for (const sm of sims) if ((sm.info.workspaceFile ?? sm.info.cwd) === key) { sm.info.folderRules = rules || undefined; folderRules[sm.info.id] = rules; }
        return { ok: true, folderRules };
      },
      folderSetupExplain: async (_key, id) => {
        await new Promise((r) => setTimeout(r, 300));
        const it = SIM_FOLDER_SETUP.find((i) => i.id === id);
        if (!it) return { ok: false, error: 'That hook is no longer in the folder.' };
        return /curl/.test(it.detail)
          ? { ok: true, verdict: 'risky' as const, text: 'WHAT: downloads a script from the internet and runs it at every session start.\nTOUCHES: network, processes; anything the script does.', by: 'Copilot (simulated)' }
          : { ok: true, verdict: 'harmless' as const, text: 'WHAT: runs the project\u2019s linter on the changed files after each edit.\nTOUCHES: files in the project (reads), no network.', by: 'Copilot (simulated)' };
      },
      // Per-folder import from .vscode/mcp.json (spec 020 FR-020): a fixed, realistic fake file for mcp-swiss only; values are never part of the preview
      mcpImportPreview: async (key) => {
        const label = '.vscode/mcp.json';
        if (!knownFolder(key)) return { ok: false, error: 'Unknown folder.', label, files: [], items: [], digest: '', skipped: 0 };
        if (!key.endsWith('mcp-swiss')) return { ok: false, error: 'No .vscode/mcp.json in this folder.', label, files: [{ from: folderName(key), state: 'missing' as const, skipped: 0, inputs: [] }], items: [], digest: '', skipped: 0 };
        const have = new Set(extrasOf(key).map((x) => x.name));
        const mk = (id: string, name: string, o: Partial<import('../shared/api').McpImportItem>): import('../shared/api').McpImportItem =>
          ({ id, name, originalName: id, transport: 'stdio', env: [], headers: [], notes: [], alreadyAdded: have.has(name) ? true : undefined, ...o });
        const items = [
          mk('playwright', 'playwright', { command: 'npx', args: ['@playwright/mcp@latest'] }),
          mk('postgres', 'postgres', { command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres', '/home/vikram/work/mcp-swiss'], env: [{ key: 'DATABASE_URL', hasValue: true }], notes: ['Ignored fields: envFile.', '"envFile" is not read: add its variables by hand if the server needs them.'] }),
          mk('sentry', 'sentry', { transport: 'http', url: 'https://mcp.sentry.example.test/mcp', headers: [{ key: 'Authorization', hasValue: false }], notes: ['Authorization: contains a ${...} reference. The value is not copied or resolved; enter it after importing.'] }),
          mk('github', 'github-vscode', { command: 'npx', args: ['-y', '@example/github-mcp'], env: [{ key: 'GITHUB_TOKEN', hasValue: false }], notes: ['The name "github" is already taken here (Copilot CLI list or another extra); it will be imported as "github-vscode".', 'GITHUB_TOKEN: contains a ${...} reference. The value is not copied or resolved; enter it after importing.'] }),
          mk('notion', 'notion', { command: 'node', args: ['notion-mcp.js', '--workspace', '${input:notion-workspace}'], blocked: 'Needs a value that VS Code asks you for (${input:notion-workspace}). Agent Durbar never asks for or guesses it: add this server by hand.' }),
          mk('fetch', 'fetch', { command: 'uvx', args: ['mcp-server-fetch'], notes: ['Ignored fields: sandbox.'] }),
        ];
        return { ok: true, label, files: [{ from: folderName(key), state: 'ok' as const, skipped: 1, inputs: ['api-key', 'notion-workspace'] }], items, digest: 'sim', skipped: 1 };
      },
      mcpImportApply: async (key, ids, digest) => {
        if (!knownFolder(key) || digest !== 'sim') return { ok: false, error: 'The file changed since the preview. Open the import again.', imported: [], failed: [] };
        const pv = await mcpApi.mcpImportPreview!(key);
        const imported: string[] = [];
        for (const it of pv.items) {
          if (!ids.includes(it.id) || it.blocked || it.alreadyAdded) continue;
          extrasOf(key).push({ name: it.name, transport: it.transport, command: it.command, args: it.args, url: it.url, enabled: false, trusted: false,
            env: it.env.map((r) => ({ key: r.key, set: r.hasValue })), headers: it.headers.map((r) => ({ key: r.key, set: r.hasValue })), needsSecrets: [...it.env, ...it.headers].some((r) => !r.hasValue) });
          imported.push(it.name);
        }
        return { ok: true, imported, failed: [] };
      },
      usageAllTime: async () => ({ doc: JSON.parse(JSON.stringify(simDoc)) as UsageDoc, labels: Object.fromEntries(sims.map((x) => [x.info.id, x.info.name + ' · ' + folderName(x.info.cwd)])) }),
      usageReset: async () => {
        simDoc.tools = {}; simDoc.servers = {}; simDoc.agents = {}; simDoc.since = new Date().toISOString();
        return { ok: true, doc: JSON.parse(JSON.stringify(simDoc)) as UsageDoc };
      },
      agentMcp: async (id) => {
        const s = sims.find((x) => x.info.id === id);
        if (!s) return { ok: false, servers: [], live: false };
        const live = s.state !== 'idle' || !!s.ctx;
        const kc = caps(s.info.adapterId ?? 'copilot');
        const idx = sims.indexOf(s);
        const restartable = (n: string, on: boolean) => live && kc.mcpRestart === true && on && !s.mcpOff?.has(n);
        /* what the last `mcp` event said wins over the canned rule, as main's live list does for a real session */
        /* spec 058 FR-092: like main's reply, the time of the reported state, whether a failure came after Running, and the transport */
        const healthOf = (n: string, status?: string, transport?: string) => { const h = live ? s.mcpHealth?.get(n) : undefined; const ok = h && h.status === (status ?? ''); return { ...(ok ? { since: h.since } : {}), ...(ok && h.afterRunning ? { afterRunning: true } : {}), ...(live && transport ? { transport } : {}) }; };
        const reported = (n: string): ReturnType<typeof simServer> & { since?: number; afterRunning?: boolean; transport?: string } => { const m = live ? s.mcpLive?.find((x) => x.name === n) : undefined; const st = m ? { status: s.mcpOff?.has(n) ? 'disabled' : m.status, error: m.error, errorClass: m.errorClass } : simServer(s, idx, n, live); return { ...st, ...healthOf(n, st.status, m?.transport) }; };
        const known = new Set([...fakeCli.map((c) => c.name), ...extrasOf(s.info.cwd).map((v) => v.name)]);
        /* spec 058 FR-065/FR-068/FR-180: Sign in (Copilot and Claude Code; Codex in PR B), the host of an open sign-in, the app's terminal steps,
           its note and, for Claude Code, Restart kept on the row; main's rules, canned */
        const signOf = (n: string, origin: 'cli' | 'folder' | 'runtime') => {
          const app = simSignApp(s);
          if (!simMcpAuth || !app) return {};
          const st = reported(n);
          const needs = st.status === 'needs-auth' || (st.status === 'failed' && st.errorClass === 'auth');
          // like main: an open Sign in again stays visible while the row reads Starting
          const held = live && !s.mcpOff?.has(n) && !needs ? simSignOpen(s, n) : undefined;
          if (held?.again && st.status === 'pending') return { signIn: { host: 'auth.example.com', opened: held.opened, expiresInMs: Math.max(0, simMcpTtl - (Date.now() - held.at)) } };
          // spec 058 FR-164: Sign in again on a connected or failed server (main's canSignInAgainStatus), with the host once it is open
          if (live && !s.mcpOff?.has(n) && !needs && (st.status === 'connected' || st.status === 'failed') && simMcpAuth !== 'manual' && simRemoteMcp(n)) { // main: canSignInAgainStatus (a remote server Durbar knows by its https address)
            const o = simSignOpen(s, n);
            return { canSignInAgain: true, ...(o ? { signIn: { host: 'auth.example.com', opened: o.opened, expiresInMs: Math.max(0, simMcpTtl - (Date.now() - o.at)) } } : {}) };
          }
          if (!live || s.mcpOff?.has(n) || !needs) return {};
          const open = simSignOpen(s, n);
          const can = simMcpAuth !== 'manual';
          if (origin === 'folder' && !can) return {};
          const steps = origin === 'folder' ? 'This server is only known to Agent Durbar; use Sign in here.' : app.steps(n);
          return { signInSteps: steps, ...(app.restart && restartable(n, true) ? { signInRestart: true } : {}), ...(can ? { canSignIn: true, signInNote: app.note, ...(open ? { signIn: { host: 'auth.example.com', opened: open.opened, expiresInMs: Math.max(0, simMcpTtl - (Date.now() - open.at)) } } : {}) } : {}) };
        };
        const toolsOffOf = (n: string) => (simToolsOff[s.info.cwd]?.[n] ? { toolsOff: [...(simToolsOff[s.info.cwd]?.[n] ?? [])] } : {});
        const servers = [
          /* spec 069 FR-061: this folder's turned-off tools */
          ...fakeCli.map((a) => ({ name: a.name, origin: 'cli' as const, ...reported(a.name), defaultOn: a.enabled, off: !!s.mcpOff?.has(a.name), sources: gSources(a.name, false), ...toolsOffOf(a.name), ...signOf(a.name, 'cli'), ...(restartable(a.name, a.enabled) ? { canRestart: true } : {}) })),
          ...extrasOf(s.info.cwd).map((v) => ({ name: v.name, origin: 'folder' as const, ...reported(v.name), defaultOn: v.enabled && v.trusted, off: !!s.mcpOff?.has(v.name), sources: gSources(v.name, true), ...toolsOffOf(v.name), ...signOf(v.name, 'folder'), ...(restartable(v.name, v.enabled && v.trusted) ? { canRestart: true } : {}) })),
          /* like main's agentMcpReply: a running server the runtime reported can be restarted (spec 058 FR-030) */
          ...(live ? (s.mcpLive ?? []).filter((m) => !known.has(m.name)).map((m) => ({ name: m.name, origin: 'runtime' as const, ...reported(m.name), defaultOn: true, off: !!s.mcpOff?.has(m.name), ...toolsOffOf(m.name), ...signOf(m.name, 'runtime'), ...(restartable(m.name, true) && m.status !== 'disabled' ? { canRestart: true } : {}) })) : []),
        ];
        return { ok: true, servers, live, app: SIM_APP_NAME[s.info.adapterId ?? 'copilot'] ?? 'GitHub Copilot', ...(kc.mcpStart ? { start: kc.mcpStart } : {}), ...(kc.mcpToggleApplies ? { toggleApplies: kc.mcpToggleApplies } : {}), canRestartSession: live && kc.resume, canListTools: true, toolFilter: true };
      },
      /* spec 058 FR-040: a canned Restart: Starting for a moment, then Running */
      /* spec 069 FR-031/FR-032: canned tools per server; a session that is not running, a failed server and an empty one show their states */
      /* spec 069 FR-061: tools turned off per folder, in memory */
      setAgentMcpToolsOff: async (id, name, off) => {
        const s = sims.find((x) => x.info.id === id);
        if (!s) return { ok: false, error: 'Unknown agent.' };
        const m = (simToolsOff[s.info.cwd] ??= {});
        if (off.length) m[name] = [...new Set(off)];
        else delete m[name];
        return { ok: true };
      },
      agentMcpTools: async (id, name) => {
        const s = sims.find((x) => x.info.id === id);
        if (!s) return { ok: false, error: 'Unknown agent or server.' };
        if (s.state === 'idle' && !s.ctx) return { ok: false, notRunning: true, error: 'Start the session to see its tools.' };
        await new Promise((r) => setTimeout(r, 250));
        const canned: Record<string, [string, string?][]> = {
          github: [['search_issues', 'Search issues and pull requests in a repository'], ['get_pull_request', 'Get one pull request with its files and checks'], ['create_issue', 'Open a new issue'], ['list_commits', 'List the commits of a branch'], ['get_file_contents', 'Read a file at a ref']],
          // `search` is also a tool of my-notes (two servers, one tool name: spec 069 review on PR 503); `run query` cannot be turned off (FR-063)
          'github-mcp-server': [['get_me', 'Your GitHub account'], ['search_code', 'Search code on GitHub'], ['search', 'Search GitHub'], ['run query', 'A tool name with a space']],
          playwright: [['browser_navigate', 'Open a URL in the browser'], ['browser_click', 'Click an element'], ['browser_snapshot', 'Accessibility snapshot of the page'], ['browser_take_screenshot']],
          'docs-search': [],
        };
        /* the same state the row shows (spec 058's canned failures; a Restart fixes them): only a running server lists tools */
        const st = simServer(s, sims.indexOf(s), name, true);
        if (st.status && st.status !== 'connected') return { ok: false, error: name + ' is not connected' + (st.error ? ': ' + st.error : ' (' + st.status + ')') };
        const list = canned[name] ?? [['search', 'Search the notes'], ['read_note', 'Read one note by its title']];
        return { ok: true, total: list.length, tools: list.map(([n, d]) => ({ name: n, ...(d ? { description: d } : {}) })) };
      },
      agentMcpRestart: async (id, name) => {
        const s = sims.find((x) => x.info.id === id);
        if (!s || !caps(s.info.adapterId ?? 'copilot').mcpRestart) return { ok: false, error: 'This agent app cannot restart one MCP server. Use Restart session with these servers.' };
        if (s.mcpOff?.has(name)) return { ok: false, error: 'Switch it on first.' };
        (s.mcpRestarting ??= new Set()).add(name);
        mcpStatus(s, sims.indexOf(s)); // the runtime's own report, like a real one: the open dialog follows it (FR-004)
        await new Promise((r) => setTimeout(r, 700));
        s.mcpRestarting.delete(name);
        (s.mcpFixed ??= new Set()).add(name);
        mcpStatus(s, sims.indexOf(s));
        return { ok: true };
      },
      /* spec 058 FR-071: Sign in -> the host -> Open sign-in page (opens nothing; "Running" after 2 s). The address is never in the page. */
      agentMcpSignIn: async (id, name, again) => {
        const s = sims.find((x) => x.info.id === id);
        const app = s ? simSignApp(s) : undefined;
        if (!s || !app || !simMcpAuth) return { ok: false, error: 'Unknown agent or server.' };
        if (simMcpAuth === 'manual') return { ok: false, manual: true, error: app.noCall };
        const st = simServer(s, sims.indexOf(s), name, true);
        if (again === true ? !((st.status === 'connected' || st.status === 'failed') && simRemoteMcp(name)) : st.status !== 'needs-auth') return { ok: false, error: name + (again === true ? ' cannot be signed in again now.' : ' does not need a sign-in.') };
        if (simSignOpen(s, name)) return { ok: false, error: 'A sign-in for ' + name + ' is already open.' };
        (s.mcpSign ??= new Map()).set(name, { opened: false, at: Date.now(), ...(again === true ? { again: true } : {}) });
        return { ok: true, kind: 'browser', host: 'auth.example.com' };
      },
      agentMcpOpenSignIn: async (id, name, shownHost) => {
        const s = sims.find((x) => x.info.id === id);
        const e = s ? simSignOpen(s, name) : undefined;
        if (!s || !e || shownHost !== 'auth.example.com') return { ok: false, gone: true, error: 'That sign-in is no longer open. Press Sign in again.' };
        e.opened = true;
        console.info('[sim] would open the sign-in page on auth.example.com');
        // FR-164: like the runtime after forceReauth, a server signed in again first leaves "connected" (Starting), then connects again
        if (e.again) { (s.mcpRestarting ??= new Set()).add(name); mcpStatus(s, sims.indexOf(s)); }
        window.setTimeout(() => {
          s.mcpRestarting?.delete(name);
          if (!s.mcpSign?.delete(name)) { mcpStatus(s, sims.indexOf(s)); return; } // cancelled or ended meanwhile
          (s.mcpFixed ??= new Set()).add(name);
          mcpStatus(s, sims.indexOf(s)); // the runtime reports the server connected: the open dialog follows it
        }, 2000);
        return { ok: true };
      },
      agentMcpCancelSignIn: async (id, name) => {
        sims.find((x) => x.info.id === id)?.mcpSign?.delete(name);
        return { ok: true };
      },
      setAgentMcp: async (id, name, enabled) => {
        const s = sims.find((x) => x.info.id === id);
        if (!s) return { ok: false, error: 'unknown agent' };
        s.mcpOff ??= new Set();
        if (enabled) s.mcpOff.delete(name); else s.mcpOff.add(name);
        if (s.state !== 'idle') mcpStatus(s, sims.indexOf(s));
        return { ok: true };
      },
    };

    // ---- Fake credit caps (spec 011): in memory only ----
    let defaultCap: number | undefined;
    /* spec 024: place mapping kept in memory (plain script: no imports, so the ids are listed here) */
    const placeMap: Record<string, string> = {};
    let seriousMode = false; /* spec 034 */
    let notifyNeedsMe = false; /* spec 052 FR-059: off in the demo until you turn it on */
    let breakResume: 'auto' | 'ask' = 'auto'; /* spec 068 FR-006 */
    const PLACE_CHOICES = ['library', 'software', 'terminal', 'web', 'other', 'desk'];
    /* spec 024 FR-018..FR-020: custom places in memory, with the rules of src/shared/places.ts repeated here (the renderer bundle cannot import
       it; scripts/test-places.ts runs both on the same cases and compares them). */
    type SimPlace = { id: string; name: string; icon: string };
    const MAX_CUSTOM = 3;
    const CUSTOM_ICONS = ['star', 'flask', 'database', 'cloud', 'chart', 'chat', 'mail', 'calendar', 'shield', 'box', 'bolt', 'pin'];
    const RESERVED_NAMES = ['library', 'software library', 'terminal', 'web', 'other tools', 'stay at desk', 'default', 'coffee corner', 'boss', 'bank', 'postbox'];
    const customPlaces: SimPlace[] = [];
    let placeSeq = 0;
    const simPlaceResult = (ok: boolean, error?: string, place?: SimPlace) => ({
      ok, ...(error ? { error } : {}), ...(place ? { place: { ...place } } : {}),
      customPlaces: customPlaces.map((p) => ({ ...p })), placeMap: { ...placeMap },
    });
    /** Trimmed name, or the error code: empty, a control character, more than 24 code points, or already used (ignoring case). */
    const simPlaceName = (v: unknown, exceptId?: string): { name: string } | { error: string } => {
      if (typeof v !== 'string') return { error: 'name-invalid' };
      const n = v.trim();
      if (n.length < 1) return { error: 'name-empty' };
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u001f\u007f-\u009f\u200b-\u200c\u200e-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/.test(n)) return { error: 'name-invalid' };
      if ([...n].length > 24) return { error: 'name-long' };
      const f = n.toLowerCase();
      if (RESERVED_NAMES.includes(f) || customPlaces.some((p) => p.id !== exceptId && p.name.toLowerCase() === f)) return { error: 'name-taken' };
      return { name: n };
    };
    const simAddPlace = (name: unknown, icon: unknown) => {
      if (customPlaces.length >= MAX_CUSTOM) return simPlaceResult(false, 'limit');
      const nm = simPlaceName(name);
      if ('error' in nm) return simPlaceResult(false, nm.error);
      if (typeof icon !== 'string' || !CUSTOM_ICONS.includes(icon)) return simPlaceResult(false, 'icon');
      let id = '';
      do { id = 'c-sim' + String(++placeSeq).padStart(3, '0'); } while (customPlaces.some((p) => p.id === id));
      const place = { id, name: nm.name, icon };
      customPlaces.push(place);
      return simPlaceResult(true, undefined, place);
    };
    const simUpdatePlace = (id: unknown, patch: unknown) => {
      const p = customPlaces.find((x) => x.id === id);
      if (!p || !patch || typeof patch !== 'object' || Array.isArray(patch)) return simPlaceResult(false, 'unknown');
      const { name, icon } = patch as { name?: unknown; icon?: unknown };
      let nextName = p.name, nextIcon = p.icon;
      if (name !== undefined) {
        const nm = simPlaceName(name, p.id);
        if ('error' in nm) return simPlaceResult(false, nm.error);
        nextName = nm.name;
      }
      if (icon !== undefined) {
        if (typeof icon !== 'string' || !CUSTOM_ICONS.includes(icon)) return simPlaceResult(false, 'icon');
        nextIcon = icon;
      }
      p.name = nextName; p.icon = nextIcon;
      return simPlaceResult(true);
    };
    const simRemovePlace = (id: unknown) => {
      const at = customPlaces.findIndex((x) => x.id === id);
      if (at < 0) return simPlaceResult(false, 'unknown');
      customPlaces.splice(at, 1);
      for (const k of Object.keys(placeMap)) if (placeMap[k] === id) delete placeMap[k];
      return simPlaceResult(true);
    };
    /* simplaces=N (spec 024 FR-026): Database, Ticket desk and a 24-character name; two fake servers mapped to the first two */
    {
      const q = typeof window !== 'undefined' && window.location ? /[?&]simplaces=([0-3])(?:&|$)/.exec(window.location.search) : null;
      const want = Math.max(0, Math.min(MAX_CUSTOM, Math.floor(opts.places ?? (q ? Number(q[1]) : 0)) || 0));
      const seed: [string, string][] = [['Database', 'database'], ['Ticket desk', 'chat'], ['Data analytics reporting', 'chart']];
      for (let i = 0; i < want; i++) simAddPlace(seed[i][0], seed[i][1]);
      if (customPlaces.length) {
        placeMap['my-notes'] = customPlaces[0].id;
        placeMap['playwright'] = customPlaces[Math.min(1, customPlaces.length - 1)].id;
      }
    }
    /* spec 011 FR-029: saved totals, in memory. Default: nothing saved. With simtotals=1: a previous run left totals for two folders
       and one folder that is not in the list any more, so the header shows more than this run's own spend. */
    const zero = { calls: 0, inTokens: 0, outTokens: 0, nano: 0, unreported: 0 };
    let savedSince = '2026-10-01T09:00:00.000Z';
    let saved = opts.seedTotals
      ? { office: { calls: 120, inTokens: 540_000, outTokens: 60_000, nano: 41.7e9, unreported: 0 },
          folders: [
            { path: ROOM_DEFS['mcp-swiss'], name: 'mcp-swiss', calls: 50, inTokens: 230_000, outTokens: 25_000, nano: 12.4e9, unreported: 0 },
            { path: ROOM_DEFS.blog, name: 'blog', calls: 30, inTokens: 120_000, outTokens: 14_000, nano: 8.1e9, unreported: 0 },
          ] }
      : { office: zero, folders: [] as { path: string; name: string; calls: number; inTokens: number; outTokens: number; nano: number; unreported: number }[] };
    if (!opts.seedTotals) savedSince = new Date().toISOString();
    /* theme=<id> and usertheme=<manifest JSON> (spec 036 FR-005, spec 040 T005): the theme of this run, in memory, so the
       normal start-up path applies it and check:themes measures the theme it asks for. The user pack is validated by the
       renderer like an imported one. */
    const simQuery = typeof window !== 'undefined' && window.location ? new URLSearchParams(window.location.search) : new URLSearchParams();
    let simTheme = /^[a-z0-9_-]{1,64}$/.test(simQuery.get('theme') ?? '') ? (simQuery.get('theme') as string) : undefined;
    let simUserTheme: Record<string, unknown> | null = null;
    const simUserThemes: Record<string, unknown>[] = []; // spec 040 FR-014: AI themes saved in this simulated run
    let simThemeN = 0;
    try {
      const raw = simQuery.get('usertheme');
      const parsed = raw && raw.length <= 64 * 1024 ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof parsed.id === 'string') simUserTheme = parsed;
    } catch {
      simUserTheme = null;
    }
    const capApi: Partial<DurbarApi> = {
      usageTotals: async () => ({ ok: true, since: savedSince, office: saved.office, folders: saved.folders }),
      usageResetTotals: async () => { savedSince = new Date().toISOString(); saved = { office: zero, folders: [] }; return { ok: true, since: savedSince, office: zero, folders: [] }; },
      getSettings: async () => ({ defaultMaxAiCredits: defaultCap, placeMap: { ...placeMap }, customPlaces: customPlaces.map((p) => ({ ...p })), seriousMode, notifyNeedsMe, breakResume, ...(simTheme ? { theme: simTheme } : {}), about: { name: 'Agent Durbar', version: '0.1.0-alpha.13 (simulator)', owner: 'Three Feathers', copyright: 'Copyright (c) 2026 Three Feathers contributors', website: 'https://github.com/three-feathers/agent-durbar', contributors: [{ label: 'vikramgorla', url: 'https://github.com/vikramgorla' }, { label: 'fjcabello', url: 'https://github.com/fjcabello' }, { label: 'rubenlupi', url: 'https://github.com/rubenlupi' }] } /* sample data, real values come from src/shared/about.ts */ }),
      setDefaultCap: async (c) => { defaultCap = c !== null && c >= 30 ? Math.round(c * 100) / 100 : undefined; return { ok: true, defaultMaxAiCredits: defaultCap }; },
      setSeriousMode: async (on) => { if (typeof on === 'boolean') seriousMode = on; return { ok: true, seriousMode }; },
      setNotifyNeedsMe: async (on) => { if (typeof on === 'boolean') notifyNeedsMe = on; return { ok: true, notifyNeedsMe }; },
      setBreakResume: async (v) => { if (v === 'auto' || v === 'ask') breakResume = v; return { ok: true, breakResume }; },
      setBadge: async () => ({ ok: true }), /* spec 052 FR-059: no app icon in the demo */
      focusWindow: async () => { window.focus(); return { ok: true }; },
      setTheme: async (id) => { if (typeof id === 'string' && /^[a-z0-9_-]{1,64}$/.test(id)) simTheme = id; return { ok: true, theme: simTheme }; },
      listUserThemes: async () => [...(simUserTheme ? [simUserTheme] : []), ...simUserThemes].map((t) => ({ id: t.id as string, name: String(t.name ?? t.id), ok: true })),
      getUserTheme: async (id) => (simUserTheme && id === simUserTheme.id ? simUserTheme : simUserThemes.find((t) => t.id === id) ?? null),
      setPlace: async (server, place) => {
        const name = typeof server === 'string' ? server.trim() : '';
        if (!name || name.length > 200 || name === '__proto__') return { ok: false, placeMap: { ...placeMap } };
        if (place === null) delete placeMap[name];
        else if (PLACE_CHOICES.includes(place) || customPlaces.some((p) => p.id === place)) placeMap[name] = place;
        else return { ok: false, placeMap: { ...placeMap } };
        return { ok: true, placeMap: { ...placeMap } };
      },
      addPlace: async (name, icon) => simAddPlace(name, icon),
      updatePlace: async (id, patch) => simUpdatePlace(id, patch),
      removePlace: async (id) => simRemovePlace(id),
      setCap: async (id, c) => {
        const s = sims.find((x) => x.info.id === id);
        if (!s) return { ok: false, error: 'unknown agent' };
        const usd = caps(s.info.adapterId ?? 'copilot').capUnit === 'usd';
        if (c !== null && !(c >= (usd ? 0.01 : 30))) return { ok: false, error: usd ? 'The spending limit must be at least $0.01.' : 'The spending limit must be a number of at least 30 AI credits (the runtime minimum).' };
        s.info.maxAiCredits = c ?? undefined;
        simLog(s, 'limit-change', c === null ? 'Spending limit removed' : `Spending limit set to ${usd ? '$' + c.toFixed(2) : c + ' AI credits'}`);
        emit({ type: 'limit', sessionId: id, timestamp: now(), phase: 'changed', maxAiCredits: c });
        return { ok: true, maxAiCredits: c ?? undefined };
      },
      activityList: async (o) => ({ ok: true, rows: simActivity.slice(-(o && typeof o.limit === 'number' && o.limit > 0 ? Math.min(o.limit, 5000) : 5000)).reverse().map((r) => ({ ...r })) }),
      activityExport: async (format) => { console.info('[sim] would save the activity log as', format); return { ok: true, count: simActivity.length, to: 'durbar-activity.' + (format === 'json' ? 'json' : 'csv') }; },
      activityClear: async () => { simActivity.length = 0; return { ok: true }; },
      answerQuestion: async (id, requestId, answers) => {
        if (!simQ || simQ.s.info.id !== id || simQ.requestId !== requestId) return { ok: false, error: 'That question is no longer open.' };
        simQ = undefined;
        emit({ type: 'question', sessionId: id, timestamp: now(), phase: answers ? 'answered' : 'cancelled', requestId, ...(answers ? { answers } : {}) });
        emit({ type: 'output', sessionId: id, timestamp: now(), text: answers ? 'Thanks: ' + Object.values(answers).join('; ') + '.' : 'No answer; I will pick Sage for now.', final: true } as AgentEvent);
        return { ok: true };
      },
      answerElicitation: async (id, requestId, action, values) => {
        if (!simE || simE.s.info.id !== id || simE.requestId !== requestId) return { ok: false, error: 'That request is no longer open.' };
        if (action === 'accept' && !simE.url) {
          // the same rules main applies (spec 012 FR-151), for the three sim fields only
          for (const f of simE.fields) {
            const v = values?.[f.name];
            if (v === undefined || v === '') { if (f.required) return { ok: false, error: `Fill in "${f.title}".`, field: f.name }; continue; }
            if (f.type === 'enum' && !(f.enumValues ?? []).includes(String(v))) return { ok: false, error: `"${f.title}" must be one of the choices.`, field: f.name };
            if (f.type === 'integer' && (typeof v !== 'number' || !Number.isInteger(v) || (f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max))) return { ok: false, error: `"${f.title}" must be a whole number from ${f.min} to ${f.max}.`, field: f.name };
            if (f.type === 'boolean' && typeof v !== 'boolean') return { ok: false, error: `"${f.title}" must be yes or no.`, field: f.name };
          }
        }
        simE = undefined;
        emit({ type: 'question', sessionId: id, timestamp: now(), phase: action === 'cancel' ? 'cancelled' : 'answered', requestId, ...(action === 'cancel' ? {} : { elicitAction: action }) } as AgentEvent);
        emit({ type: 'output', sessionId: id, timestamp: now(), text: action === 'accept' ? 'Thanks, the MCP server has what it needs.' : 'The MCP request was ' + (action === 'decline' ? 'declined' : 'cancelled') + '; I will continue without it.', final: true } as AgentEvent);
        return { ok: true };
      },
      openElicitationUrl: async (id, requestId) => {
        if (!simE?.url || simE.s.info.id !== id || simE.requestId !== requestId) return { ok: false, error: 'That request has no https page to open.' };
        console.info('[sim] would open in the system browser:', simE.url);
        return { ok: true };
      },
      slashCommands: async (id) => {
        const s = sims.find((x) => x.info.id === id);
        if (!s) return { ok: false, error: 'unknown agent', entries: [] };
        // page address simslash=long (spec 073 FR-008, review on #535): a 64-character name, a long hint and a 200-character description
        // come first, for check:ui-text's long-text pass; simslash=secret: fake token shapes (FR-014, issue #608)
        return { ok: true, entries: simSlashFor(s.info.adapterId ?? 'copilot', simQuery).map((e) => { const c = { ...e }; delete c.note; return c; }) }; // the note is the send's, not the list's
      },
      listProfiles: async (id) => {
        const s = sims.find((x) => x.info.id === id);
        if (!s || (s.info.adapterId && s.info.adapterId !== 'copilot')) return { ok: false, error: 'This agent app has no profiles.', profiles: [] };
        return { ok: true, profiles: simProfiles().map((p) => ({ ...p, trusted: p.source !== 'repo' || simTrusted.has(p.id) })) };
      },
      selectProfile: async (id, profileId, confirm) => {
        const s = sims.find((x) => x.info.id === id);
        if (!s) return { ok: false, error: 'unknown agent' };
        if (profileId === null) {
          emit({ type: 'agentProfile', sessionId: id, timestamp: now(), profile: null } as AgentEvent);
          return { ok: true, profile: null };
        }
        const p = simProfiles().find((x) => x.id === profileId);
        if (!p) return { ok: false, error: 'That agent is not available in this session.' };
        if (p.source === 'repo' && !simTrusted.has(p.id)) {
          if (confirm !== true) return { ok: false, needsConfirm: true, profile: p };
          simTrusted.add(p.id);
        }
        emit({ type: 'agentProfile', sessionId: id, timestamp: now(), profile: p } as AgentEvent);
        return { ok: true, profile: p };
      },
      // spec 043 FR-017: profile files in memory
      listProfileFiles: async () => ({ ok: true, folders: pfFolders(), files: simPF.map(pfInfo), userDirs: { copilot: '~/.copilot/agents', claude: '~/.claude/agents' } }),
      readProfileFile: async (fileId) => {
        const f = simPF.find((x) => x.id === fileId);
        return f ? { ok: true as const, info: pfInfo(f), text: f.text, sha256: pfHash(f.text), eol: 'lf' as const } : { ok: false as const, error: 'That profile file is not in the list any more.' };
      },
      saveProfileFile: async (fileId, text, baseSha, overwrite) => {
        const f = simPF.find((x) => x.id === fileId);
        if (!f) return { ok: false as const, error: 'The file was removed or moved since you opened it.', conflict: true };
        if (!f.writable) return { ok: false as const, error: f.note || 'You cannot write this file.' };
        if (overwrite !== true && pfHash(f.text) !== baseSha) return { ok: false as const, conflict: true, error: 'The file changed on disk since you opened it.' };
        f.text = String(text);
        return { ok: true as const, sha256: pfHash(f.text), info: pfInfo(f) };
      },
      createProfileFile: async (app, place, name, template, text) => {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name) || name.includes('..') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)) return { ok: false as const, error: 'Use letters, digits, dots, dashes or underscores (up to 64), starting with a letter or digit.' };
        const folder = place === 'user' ? undefined : pfFolders().find((x) => x.id === place)?.path;
        if (place !== 'user' && !folder) return { ok: false as const, error: 'That folder is not in the office any more: choose where to save it again.' };
        const dir = place === 'user' ? (app === 'copilot' ? '~/.copilot/agents' : '~/.claude/agents') : folder + (app === 'copilot' ? '/.github/agents' : '/.claude/agents');
        const file = dir + '/' + (app === 'copilot' ? name + '.agent.md' : name + '.md');
        if (simPF.some((x) => x.path === file)) return { ok: false as const, error: file.slice(file.lastIndexOf('/') + 1) + ' exists already.' };
        // the shared templates (src/shared/profiletemplates.ts), loaded after exports-shim.js; read at call time
        const tpl = (self as unknown as { exports?: { profileTemplate?: (a: string, n: string, k?: string) => string } }).exports?.profileTemplate;
        if (!tpl) return { ok: false as const, error: 'The templates are not loaded.' };
        const f = pf(app, place === 'user' ? 'user' : 'folder', folder, file, typeof text === 'string' ? text : tpl(app, name, template === 'standard' ? 'standard' : 'success')); // text: a reviewed AI draft (FR-029)
        f.made = true;
        simPF.push(f);
        return { ok: true as const, id: f.id, info: pfInfo(f) };
      },
      // spec 043 FR-040: delete in memory, with main's rules (a listed id, a writable file)
      deleteProfileFile: async (fileId) => {
        const i = simPF.findIndex((x) => x.id === fileId);
        if (i < 0) return { ok: false as const, error: 'That profile file is not in the list any more.' };
        if (!simPF[i].writable) return { ok: false as const, error: simPF[i].note || 'You cannot delete this file.' };
        simPF.splice(i, 1);
        return { ok: true as const, id: String(fileId) };
      },
      // spec 043 FR-030: a canned Agent Success Profile from the answers (no credits), checked like a real reply
      generateProfile: async (req) => {
        type PT = { profileTemplate(a: string, n: string, k?: string): string; PROFILE_QUESTIONS: { id: string; section: string }[]; validateGeneratedProfile(t: string, i: unknown, p: (t: string) => unknown): { ok: true; text: string; warnings: string[]; extraTools: string[] } | { ok: false; error: string }; parseToolList(l: unknown): { ok: true; tools: string[] } | { ok: false; error: string }; DEFAULT_READ_TOOLS: Record<string, string[]> };
        const T = (self as unknown as { exports?: PT }).exports;
        const PE = (window as unknown as { DurbarProfileEditor?: { parseFrontmatter(t: string): unknown } }).DurbarProfileEditor;
        if (!T || !T.validateGeneratedProfile || !PE) return { ok: false as const, error: 'The templates are not loaded.' };
        const tl = T.parseToolList(req.tools);
        if (!tl.ok) return { ok: false as const, error: tl.error };
        if (simGenRunning) return { ok: false as const, busy: true as const, error: 'The first request is still running on the agent app and may be charged. Create is available again when it ends.' };
        if (!caps(String(req.by)).oneShot) return { ok: false as const, error: 'That agent app cannot write a profile here. Pick an installed, signed-in one.' };
        simGenRunning = true;
        const w = window as unknown as { __simGenCalls?: number; __simGenDelay?: number };
        w.__simGenCalls = (w.__simGenCalls ?? 0) + 1;
        try {
          await new Promise((r) => window.setTimeout(r, Math.min(Math.max(Number(w.__simGenDelay) || 700, 0), 10_000))); // a driver may lengthen the wait
        } finally {
          simGenRunning = false;
        }
        const said = req.mode === 'describe' ? String(req.description ?? '') : Object.values(req.answers ?? {}).join(' ');
        const summary = req.mode === 'describe' ? said : String((req.answers ?? {}).role || said);
        const spend = req.by === 'claude' ? { costUsd: 0.003 } : req.by === 'copilot' ? { nanoAiu: 15_000_000 } : {};
        if (/\bfail\b/i.test(said)) return { ok: false as const, error: 'The agent app gave no answer.', ...spend };
        let text = T.profileTemplate(req.app, req.name, 'success').replace(/^description: .*$/m, 'description: ' + (summary.slice(0, 120).replace(/[:#\n]/g, ' ').trim() || 'A focused agent'));
        // a canned reply that uses every tool it may (FR-032), so the granted-tools note shows in the simulator too
        if (tl.tools.length) { const all = [...(T.DEFAULT_READ_TOOLS[req.app] ?? []), ...tl.tools].join(', '); text = text.replace(/^tools: .*$/m, 'tools: ' + (req.app === 'copilot' ? '[' + all + ']' : all)); }
        const a = req.answers ?? {};
        for (const q of T.PROFILE_QUESTIONS) {
          const v = req.mode === 'describe' ? (q.id === 'role' ? said.slice(0, 200) : '') : a[q.id];
          if (v) text = text.replace(new RegExp('(## ' + q.section + '\\n\\n)[^\\n]*'), (_m, h: string) => h + v);
        }
        const v = T.validateGeneratedProfile(text, { app: req.app, name: req.name, mode: req.mode, description: req.description, answers: req.answers, tools: tl.tools }, (t) => PE.parseFrontmatter(t));
        return v.ok ? { ok: true as const, text: v.text, warnings: v.warnings, extraTools: v.extraTools, by: req.by === 'claude' ? 'Claude Code' : req.by === 'codex' ? 'Codex' : 'GitHub Copilot', ...spend } : { ok: false as const, error: v.error, ...spend };
      },
      openProfileInVSCode: async (fileId) => {
        const f = simPF.find((x) => x.id === fileId);
        if (f) console.info('[sim] would open the profile file in VS Code:', f.fileName);
        return f ? { ok: true } : { ok: false, error: 'That profile file is not in the list any more.' };
      },
      // spec 044: scheduled prompts in memory; a 1 s check sends through the simulated agents (no credits)
      // spec 041 FR-065: the welcome-back card with a missed schedule whose prompt holds the planted secrets across character 80
      ...(opts.reply === 'secrets' ? { sinceAway: async () => ({ awayMs: 3 * 3600e3, missed: [{ id: 'aw1', folderName: 'mcp-swiss', prompt: FILL(76) + SECRETS_TEXT, repeats: true }] }), dismissSinceAway: async () => ({ ok: true }) } : {}),
      listSchedules: async () => ({ pausedAll: simSched.pausedAll, schedules: simSched.list.map((x) => ({ ...x })) }),
      saveSchedule: async (inputIn) => {
        const now = Date.now();
        // FR-026 / FR-023: an id the store does not have is refused; an edit keeps what the form does not edit
        const edit = inputIn.edit === true;
        const prev = inputIn.id === undefined ? undefined : simSched.list.find((x) => x.id === inputIn.id);
        if ((inputIn.id !== undefined && !prev) || (edit && !prev)) return { ok: false as const, error: 'That schedule is gone.' };
        const input = edit && prev ? { ...inputIn, folder: prev.folder, paused: prev.paused, pausedReason: prev.pausedReason, done: undefined, cap: inputIn.cap === undefined ? prev.cap : inputIn.cap, at: inputIn.at === undefined && inputIn.rule === undefined && prev.every !== undefined && Number(inputIn.every) === prev.every ? prev.at : inputIn.at } : inputIn;
        const every = input.every !== undefined ? Math.round(Number(input.every)) : undefined;
        const rule = input.rule !== undefined ? simRules()?.parseRule(input.rule) : undefined;
        if (input.rule !== undefined && !rule) return { ok: false as const, error: 'That calendar rule is not valid.' };
        const old = simSched.list.find((x) => x.id === input.id);
        // a save that is not an edit never moves a schedule to another folder or revives a done one (as main)
        if (!edit && old) input.folder = old.folder;
        if (!rule && every === undefined && edit && prev && Number(input.at) <= now && (prev.done || Number(input.at) !== prev.at)) return { ok: false as const, error: prev.done ? 'Pick a time in the future to run it again.' : 'That time has already passed.' };
        if (!rule && every === undefined && edit && prev && (prev.every !== undefined || prev.rule) && Number(input.at) <= now) return { ok: false as const, error: 'That time has already passed.' };
        if (!input.folder || !String(input.prompt ?? '').trim() || (!rule && every === undefined && !(Number(input.at) > now) && !(edit && prev && !prev.done && Number(input.at) === prev.at) && !(!edit && old && input.paused)) || (!rule && every !== undefined && !(every >= 5 && every <= 1440))) return { ok: false as const, error: 'A schedule needs a prompt and either a future time, 5 to 1440 minutes or a calendar rule.' };
        const target = input.target && typeof input.target === 'object' ? input.target : undefined;
        if (target && !input.paused && !sims.some((x) => x.info.id === target.session)) return { ok: false as const, error: "That session has ended. Send it to the folder's agent instead." };
        let cap = input.cap && typeof input.cap === 'object' ? input.cap : undefined;
        const targetChanged = edit && !!prev && (prev.target?.session ?? '') + '|' + (prev.target?.agent ?? '') !== (target?.session ?? '') + '|' + (target ? String(target.agent) : '');
        const capSame = edit && !!prev?.cap && !!cap && Number(cap.amount) === prev.cap.amount && cap.unit === prev.cap.unit;
        if (cap && !(capSame && !targetChanged)) { // a limit moved to another target is checked like a new one (as main)
          const u = simUnit(simAgentOf({ folder: input.folder, target }));
          if (!u) return { ok: false as const, error: 'This agent app does not report what a run costs, so a limit cannot be kept.' };
          if (capSame && u !== cap.unit) return { ok: false as const, error: `This agent app counts in ${u === 'usd' ? 'dollars' : 'AI credits'}, not ${cap.unit === 'usd' ? 'dollars' : 'AI credits'}: set the limit again.` };
          const amount = Math.round(Number(cap.amount) * 100) / 100;
          if (!(amount >= 0.01 && amount <= (u === 'usd' ? 10_000 : 1_000_000))) return { ok: false as const, error: 'That limit is out of range.' };
          cap = { amount, unit: u };
        }
        const when: Partial<ScheduleInfo> = rule ? { rule, next: !edit && old?.rule && old.paused && input.paused ? old.next : simRules()?.nextRuleRun(rule, now) } : every !== undefined ? { every, ...(Number(input.at) > 0 ? { at: Number(input.at) } : {}), next: (edit ? undefined : old?.next) ?? (Number(input.at) > now ? Number(input.at) : now + every * 60000) } : { at: Number(input.at) };
        const resumedCap = !!old && old.pausedReason === 'cap' && !input.paused; // FR-015: Resume after the limit counts from zero
        const sc: ScheduleInfo = { id: old?.id ?? 'sched-' + ++simSched.n, folder: input.folder, prompt: String(input.prompt).trim().slice(0, 2000), ...when, ...(input.paused ? { paused: true } : {}), ...(input.paused && old?.paused && old.pausedReason && !(edit && old.pausedReason === 'session-ended' && targetChanged) && !(edit && old.pausedReason === 'cap' && (!cap || cap.amount > (old.cap?.unit === cap.unit ? old.spent ?? 0 : 0))) ? { pausedReason: old.pausedReason } : {}), ...(old?.last ? { last: old.last } : {}), ...(!edit && old?.done ? { done: true } : {}),
          ...(target ? { target: { session: String(target.session), agent: String(target.agent), ...(target.name ? { name: String(target.name).slice(0, 80) } : {}) } } : {}),
          ...(cap ? { cap, ...(!resumedCap && old?.cap?.unit === cap.unit && old?.spent ? { spent: old.spent } : {}), ...(!resumedCap && old?.cap?.unit === cap.unit && old?.spentUnknown ? { spentUnknown: true } : {}) } : {}) };
        if (sc.next === undefined && (sc.rule || sc.every !== undefined)) return { ok: false as const, error: 'That calendar rule never runs.' };
        simSched.list = old ? simSched.list.map((x) => (x.id === sc.id ? sc : x)) : [...simSched.list, sc];
        simSched.changed();
        return { ok: true as const, schedule: sc };
      },
      removeSchedule: async (id) => { const n = simSched.list.length; simSched.list = simSched.list.filter((x) => x.id !== id); simSched.changed(); return { ok: simSched.list.length !== n }; },
      setSchedulesPaused: async (on) => { simSched.pausedAll = on === true; simSched.changed(); return { ok: true, pausedAll: simSched.pausedAll }; },
      onSchedules: (cb) => { simSched.subs.push(cb); return () => undefined; },
      onScheduleRan: (cb) => { simSched.ran.push(cb); return () => undefined; },
      // spec 017 FR-015..FR-017: doors the user closes (memory only in the simulator)
      doorsList: async () => simDoorsRef?.list() ?? {},
      setDoor: async (id, closed) => {
        const D = simDoorsRef;
        if (!D || !sims.some((x) => x.info.id === id) || typeof closed !== 'boolean') return { ok: false as const, error: 'invalid request' };
        const d = D.map.get(id) ?? { closed: false, held: [] };
        const remoteOff = closed && simRemote.has(id);
        if (remoteOff) { simRemote.delete(id); simRemoteOffSubs.forEach((f) => f({ id, reason: 'the door is closed (Do not disturb)' })); } // spec 054 FR-040
        d.closed = closed;
        if (closed) d.releasing = false;
        D.map.set(id, d);
        D.changed();
        return { ok: true as const, closed, held: d.held.length, ...(remoteOff ? { remoteOff: true } : {}) };
      },
      releaseHeld: async (id, action) => {
        const d = simDoorsRef?.map.get(id);
        if (!simDoorsRef || !d || (action !== 'send' && action !== 'discard')) return { ok: false as const, error: 'invalid request' };
        if (d.closed) return { ok: false as const, error: 'Open the door first.' };
        if (action === 'discard') { const n = d.held.length; d.held = []; simDoorsRef.changed(); return { ok: true as const, discarded: n }; }
        const n = d.held.length;
        d.releasing = n > 0;
        simDoorsRef.changed();
        return { ok: true as const, queued: n };
      },
      onDoorsChanged: (cb) => { simDoorSubs.push(cb); return () => undefined; },
      onDoorsStopped: (cb) => { simDoorStopSubs.push(cb); return () => undefined; },
      onDoorsFull: () => () => undefined,
      onRemoteOff: (cb) => { simRemoteOffSubs.push(cb); return () => undefined; },
      doorsHeld: async (id) => (simDoorsRef?.map.get(id)?.held ?? []).map((h) => ({ prompt: h.prompt, at: h.at })),
      resolvePlan: async (id: string, requestId: string, answer: { kind: string; feedback?: string }) => {
        const s = sims.find((x) => x.info.id === id);
        if (!s || !s.planReq || s.planReq.id !== requestId) return { ok: false, error: 'unknown plan' };
        const asked = s.planReq.text;
        s.planReq = undefined;
        emit({ type: 'plan', sessionId: id, timestamp: now(), phase: 'resolved', requestId, action: answer.kind as 'approve' | 'reject' | 'revise' });
        if (answer.kind === 'approve') window.setTimeout(() => void reply(s, asked), 300);
        else if (answer.kind === 'revise') simPlan(s, asked, answer.feedback);
        else emit({ type: 'status', sessionId: id, timestamp: now(), status: 'idle', intent: 'Plan rejected' });
        return { ok: true };
      },
      resolveLimit: async (id, requestId, choice) => {
        const s = sims.find((x) => x.info.id === id);
        if (!s || s.limitReq !== requestId) return { ok: false, error: 'That request is no longer open.' };
        s.limitReq = undefined;
        if (choice.kind === 'cancel') {
          emit({ type: 'limit', sessionId: id, timestamp: now(), phase: 'resolved', requestId, action: 'cancel' });
          s.state = 'idle'; closeOpen(s);
          emit({ type: 'status', sessionId: id, timestamp: now(), status: 'idle', intent: 'Aborted' });
          return { ok: true };
        }
        const cap = s.info.maxAiCredits ?? 0;
        const base = caps(s.info.adapterId ?? 'copilot').capUnit === 'usd' ? Math.max(cap, s.usd ?? 0) : cap; // a dollar cap adds from the spend when a turn went past it (FR-150)
        s.info.maxAiCredits = choice.kind === 'add' ? Math.ceil((base + choice.credits) * 100 - 1e-6) / 100 : choice.kind === 'set' ? choice.credits : undefined;
        emit({ type: 'limit', sessionId: id, timestamp: now(), phase: 'changed', maxAiCredits: s.info.maxAiCredits ?? null });
        emit({ type: 'limit', sessionId: id, timestamp: now(), phase: 'resolved', requestId, action: choice.kind });
        s.state = 'working';
        emit({ type: 'status', sessionId: id, timestamp: now(), status: 'working', intent: 'Continuing after the spending limit' });
        window.setTimeout(() => {
          if (s.limitReq) return;
          const text = '**Done.** Continued after the spending limit was raised: ' + s.intent;
          emit({ type: 'output', sessionId: id, timestamp: now(), delta: text, final: true, text });
          emit({ type: 'status', sessionId: id, timestamp: now(), status: 'idle' });
          s.state = 'done';
        }, 900);
        return { ok: true };
      },
    };

    // ---- Model, context tier and compaction (spec 030). Fake: no session, no credits. The queue-on-busy rule and the compaction numbers are made up (sim:), the shapes are the normalized ones. ----
    let queueN = 0;
    const simModel = (id: string | undefined): ModelChoice | undefined => SIM_MODELS.find((m) => m.id === id);
    const windowFor = (m: ModelChoice | undefined, tier: ContextTier | undefined): number => (tier === 'long' && m?.longWindow ? m.longWindow : m?.contextWindow ?? 0);
    const isBusy = (s: SimAgent): boolean => s.state === 'working' || s.state === 'thinking' || s.state === 'waiting' || !!s.compacting;
    const needsCompaction = (s: SimAgent, req: ModelSwitchRequest): boolean => {
      const w = windowFor(simModel(req.model), req.contextTier === 'long' ? 'long' : undefined);
      return w > 0 && !!s.ctx && s.ctx.tokens > w;
    };

    function applyModel(s: SimAgent, req: ModelSwitchRequest, cause: 'user' | 'runtime' | 'rate-limit' | 'fallback'): void {
      const m = simModel(req.model);
      if (!m) return;
      const previousModel = s.info.model, previousEffort = s.info.effort;
      s.info.model = m.id;
      if (req.effort === null) s.info.effort = undefined;
      else if (req.effort !== undefined) s.info.effort = req.effort;
      else if (!m.efforts.includes(s.info.effort ?? '')) s.info.effort = undefined; // kept when the new model offers it
      s.tier = req.contextTier === 'long' ? 'long' : undefined;
      s.info.tier = s.tier;
      s.models = m.id === 'auto' ? undefined : [m.id];
      const w = windowFor(m, s.tier);
      if (w > 0 && s.ctx) s.pendingLimit = w; // reported with the next call, not at once
      emit({ type: 'model', sessionId: sid(s), timestamp: now(), model: m.id, previousModel, effort: s.info.effort, previousEffort, tier: s.tier ?? 'default', cause });
    }

    async function applyPending(s: SimAgent): Promise<void> {
      const p = s.pendingModel;
      if (!p) return;
      s.pendingModel = undefined;
      if (p.req.confirm?.compaction === 'accept' && needsCompaction(s, p.req)) await compactNow(s, 'model-switch');
      applyModel(s, p.req, 'user');
    }

    /** The runtime moves the agent to another model on its own (rate limit, refused request): shown, never silent (FR-015). */
    function runtimeSwitch(s: SimAgent, cause: 'rate-limit' | 'fallback'): void {
      const to = s.info.model === 'sim-fast' ? 'sim-mid' : 'sim-fast';
      applyModel(s, { model: to }, cause);
    }

    async function compactNow(s: SimAgent, trigger: 'auto' | 'manual' | 'model-switch', fail = false): Promise<import('../shared/modelswitch').CompactResult> {
      const c = s.ctx;
      if (!c || !(c.limit > 0)) return { success: false, message: 'This agent reports no context to compact.' };
      if (s.compacting) return { success: false, message: 'A compaction is already running.' };
      s.compacting = true;
      const before = c.tokens;
      emit({ type: 'compaction', sessionId: sid(s), timestamp: now(), phase: 'start', trigger, tokensBefore: before, limit: c.limit });
      await wait(trigger === 'auto' ? 1400 : 900);
      s.compacting = false;
      if (fail) {
        emit({ type: 'compaction', sessionId: sid(s), timestamp: now(), phase: 'failed', trigger, tokensBefore: before, limit: c.limit, error: 'The summary request was refused (simulated).' });
        return { success: false, message: 'The summary request was refused (simulated).' };
      }
      const after = Math.round(c.limit * 0.18 + rnd() * c.limit * 0.04);
      c.tokens = after;
      s.compactions = (s.compactions ?? 0) + 1;
      emit({ type: 'usage', sessionId: sid(s), timestamp: now(), model: s.info.model ?? 'auto', inputTokens: before, outputTokens: 900, ...(caps(s.info.adapterId ?? 'copilot').usage.nanoAiu ? { nanoAiu: Math.floor(0.02 * 1e9), creditsStatus: 'complete' as const } : { creditsStatus: 'unavailable' as const }) });
      s.used = (s.used ?? 0) + Math.floor(0.02 * 1e9);
      emit({ type: 'compaction', sessionId: sid(s), timestamp: now(), phase: 'complete', trigger, tokensBefore: before, tokensAfter: after, tokensRemoved: before - after, limit: c.limit });
      emit({ type: 'context', sessionId: sid(s), timestamp: now(), tokens: after, limit: c.limit, ...ctxParts(s, after, 3), model: s.info.model, tier: s.tier });
      return { success: true, tokensAfter: after, tokensRemoved: before - after };
    }

    const simRemote = new Map<string, string>(); // spec 054: agent id -> canned link while remote control is on
    const modelApi: Partial<DurbarApi> = {
      setModel: async (id, req) => {
        const s = sims.find((x) => x.info.id === id);
        if (!s) return { ok: false, error: 'unknown agent' };
        if (s.info.modelControl?.switch === 'none') return { ok: false, error: 'This agent cannot change its model in place. Start a new session with the model you want.' };
        const m = simModel(req?.model);
        if (!m) return { ok: false, error: 'That model is not in the list your account offers.' };
        if (req.effort && !m.efforts.includes(req.effort)) return { ok: false, error: 'That model does not offer this reasoning effort.' };
        if (req.contextTier === 'long' && !m.contextTiers?.includes('long')) return { ok: false, error: 'That model has no long-context tier.' };
        const tier: ContextTier | undefined = req.contextTier === 'long' ? 'long' : undefined;
        if (needsCompaction(s, req)) {
          // The target window is smaller than the context in use: the runtime asks first (status confirmation_required).
          if (!req.confirm?.compaction) return { ok: true, result: { status: 'needs-confirmation', model: m.id, confirmation: { targetName: m.name, currentTokens: s.ctx?.tokens ?? 0, targetLimit: windowFor(m, tier) } } };
          if (req.confirm.compaction === 'decline') return { ok: true, result: { status: 'rejected', message: 'The model was not changed.' } };
        }
        if (isBusy(s)) {
          const queueId = 'q-' + sid(s) + '-' + ++queueN;
          s.pendingModel = { req, queueId };
          return { ok: true, result: { status: 'queued', model: m.id, queueId } };
        }
        if (req.confirm?.compaction === 'accept' && needsCompaction(s, req)) await compactNow(s, 'model-switch');
        applyModel(s, req, 'user');
        return { ok: true, result: { status: 'applied', model: m.id } as ModelSwitchResult };
      },
      cancelQueuedModel: async (id, queueId) => {
        const s = sims.find((x) => x.info.id === id);
        if (!s || s.pendingModel?.queueId !== queueId) return { ok: false, error: 'Nothing queued to cancel.' };
        s.pendingModel = undefined;
        return { ok: true };
      },
      // spec 040 FR-014: the AI theme maker in the simulator: a canned, valid theme after a short wait (no harness, no credits)
      generateTheme: async (description, adapterId) => {
        if (!String(description ?? '').trim()) return { ok: false, error: 'Describe the look in a few words.' };
        if (!caps(String(adapterId ?? 'copilot')).oneShot) return { ok: false, error: 'That agent app cannot make a theme. Pick Claude Code, Codex or Copilot.' };
        await new Promise((r) => window.setTimeout(r, 700));
        const n = ++simThemeN;
        // spec 040 FR-015: Claude reports a dollar estimate, Copilot AI credits, Codex nothing
        const spend = adapterId === 'claude' ? { costUsd: 0.004 } : adapterId === 'copilot' ? { nanoAiu: 20_000_000 } : {};
        return { ok: true, ...spend, warnings: [], manifest: { id: 'ai-night-shift-newsroom' + (n > 1 ? '-' + n : ''), name: 'Night-shift newsroom', author: 'AI theme maker', version: '1.0', description: String(description).slice(0, 300), extends: 'clean-office', ui: 'corporate', scene: 'corporate',
          tokens: { '--bg': '#eceff3', '--surface': '#fbfcfd', '--surface-2': '#f2f4f7', '--line': '#d5dae2', '--line-2': '#b9c1cd', '--ink': '#1b2230', '--ink-2': '#3a4456', '--muted': '#5f6a7c', '--room-path': '#56617a', '--sage': '#3f7d6c', '--blue': '#3d5e9e', '--amber': '#c4862b', '--brand-bg': '#1b2230', '--brand-mark': '#f2c063', '--focus': '#c4862b', '--sel-border': '#c4862b', '--desk': '#c9d1de', '--desk-front': '#b7c1d0', '--chair': '#2b3344', '--monitor-frame': '#1b2230', '--tint-sage': '#f1f5f4', '--tint-blue': '#f0f3f9', '--tint-sand': '#f8f5ee', '--tint-clay': '#f8f2f1' },
          words: { 'place-library': 'Archive', 'place-software': 'Wire desk', 'place-terminal': 'Print room', 'place-web': 'Newswire', 'place-other': 'Copy desk', 'lobby-label': 'The newsroom floor' } } };
      },
      themeIdeas: async () => ['a pirate ship at midnight', "a ship's bridge at dawn", 'a calm library at night', 'a night-shift newsroom', 'a 1980s arcade', 'a Japanese tea house in spring', 'a space station control room', 'a botanical greenhouse'],
      saveGeneratedTheme: async (m) => { simUserThemes.push(m); return { ok: true, id: String(m.id), name: String(m.name) }; },
      // spec 040 FR-019: export in the simulator: a user theme answers like the real one (no file is written); a built-in one is refused
      exportTheme: async (id) => (simUserThemes.some((t) => t.id === id) || (simUserTheme && simUserTheme.id === id) ? { ok: true, to: '~/Desktop/' + id } : { ok: false, error: 'Only your own imported themes can be exported.' }),
      // spec 030 FR-034: a canned hand-off summary (no runtime): goal, files and next step from the simulated agent
      handoff: async (id) => {
        const s = sims.find((x) => x.info.id === id);
        if (!s) return { ok: false, error: 'unknown agent' };
        if (!caps(s.info.adapterId ?? 'copilot').handoff) return { ok: false, error: 'This agent app cannot make a summary.' };
        await new Promise((r) => window.setTimeout(r, 900));
        const files = (s.files ?? []).slice(0, 3).map((f) => '- `' + f + '`').join('\n') || '- none yet';
        return { ok: true, summary: `## Goal\n${s.intent || 'Continue the current task.'}\n\n## What was done\n- Read the relevant code and ran the tests once (simulated).\n\n## Open items\n- Finish the change and run the tests again.\n\n## Important files and decisions\n${files}\n\n## Next step\nPick up from the open items above.` };
      },
      // spec 054 FR-008: remote control for Copilot sim agents only; a canned github.com link, nothing leaves the computer
      setRemote: async (id, on) => {
        const s = sims.find((x) => x.info.id === id);
        if (!s || typeof on !== 'boolean') return { ok: false, error: 'unknown agent' };
        if (on && simDoorsRef?.map.get(id)?.closed) return { ok: false, error: 'The door is closed (Do not disturb). Open it first.' }; // spec 054 FR-040
        const k = caps(s.info.adapterId ?? 'copilot');
        if (!k.remote) return { ok: false, error: 'This agent app cannot be controlled remotely.' };
        await new Promise((r) => window.setTimeout(r, 600));
        if (!on) {
          simRemote.delete(id);
          return { ok: true, on: false };
        }
        // spec 054 FR-060: a link on the kind's own service (made up; the real shapes are in the spec)
        const claudeKind = k.remoteService?.host === 'claude.ai';
        const url = claudeKind ? 'https://claude.ai/code/session_sim' + (sims.indexOf(s) + 1) : 'https://github.com/three-feathers/agent-durbar/sessions/sim-' + (sims.indexOf(s) + 1);
        simRemote.set(id, url);
        return claudeKind ? { ok: true, on: true, url, steerable: true } : { ok: true, on: true, url, steerable: true, visibility: 'unshared' };
      },
      openRemote: async (id) => {
        const url = simRemote.get(id);
        if (!url) return { ok: false };
        console.info('[sim] would open in the system browser:', url);
        return { ok: true };
      },
      compact: async (id, focus) => {
        const s = sims.find((x) => x.info.id === id);
        if (!s) return { ok: false, error: 'unknown agent' };
        if (!s.info.modelControl?.compact) return { ok: false, error: 'This agent cannot compact its context in place. Start a new session instead.' };
        if (isBusy(s)) return { ok: true, result: { success: false, message: 'The agent is working. Compact when it is idle.' } };
        return { ok: true, result: await compactNow(s, 'manual', /\bfail\b/i.test(focus ?? '')) };
      },
    };

    // ---- Floors (spec 033): in memory, same rules as src/shared/floors.ts (this plain script cannot import it) ----
    const floorsList: { id: string; name: string; on: boolean }[] = [{ id: 'ground', name: 'Ground floor', on: true }];
    let lastFloor = 'ground';
    const folderFloor = new Map<string, string>(); // folder (cwd) -> floor id
    if (opts.floors) {
      floorsList.push({ id: 'f-clienta0', name: 'Client A', on: true }, { id: 'f-personal', name: 'Personal', on: true });
      [...new Set(sims.map((x) => x.info.cwd))].forEach((c, i) => folderFloor.set(c, floorsList[i % floorsList.length].id));
    }
    for (const f of floorsList) if (opts.floorsOff?.some((n) => n.toLowerCase() === f.name.toLowerCase())) f.on = false;
    const floorOfCwd = (cwd: string): string => (floorsList.some((f) => f.id === folderFloor.get(cwd)) ? (folderFloor.get(cwd) as string) : 'ground');
    sims.forEach((x) => (x.info.floor = floorOfCwd(x.info.cwd)));
    const floorState = (): FloorsState => ({
      floors: floorsList.map((f) => ({ ...f, ground: f.id === 'ground' })),
      lastFloor,
      byAgent: Object.fromEntries(sims.map((x) => [x.info.id, floorOfCwd(x.info.cwd)])),
    });
    const fres = (error?: string): FloorsResult => (error ? { ok: false, error, state: floorState() } : { ok: true, state: floorState() });
    const floorNameError = (name: unknown, except?: string): string => {
      if (typeof name !== 'string' || !name.trim()) return 'Name is empty.';
      const nm = name.trim();
      // same rule as src/shared/floors.ts (this bundle cannot import it): controls and hidden or layout characters (CONTROL_RE + HIDDEN_RE); test-floors compares both
      // eslint-disable-next-line no-control-regex
      if (nm.length > 40 || /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u115f\u180e\u200b\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\u3164\ufeff\ufff9-\ufffb]/.test(nm)) return 'Use 1 to 40 characters, without control or hidden characters.';
      return floorsList.some((f) => f.id !== except && f.name.toLowerCase() === nm.toLowerCase()) ? 'A floor with that name exists.' : '';
    };
    let floorSeq = 0;
    const floorApi: Partial<DurbarApi> = {
      floorsState: async () => floorState(),
      createFloor: async (name) => {
        if (floorsList.length >= 40) return fres('At most 40 floors.');
        const e = floorNameError(name);
        if (e) return fres(e);
        floorSeq++;
        floorsList.push({ id: 'f-sim' + String(floorSeq).padStart(5, '0'), name: name.trim(), on: true });
        return fres();
      },
      renameFloor: async (id, name) => {
        const f = floorsList.find((x) => x.id === id);
        if (!f) return fres('Unknown floor.');
        const e = floorNameError(name, id);
        if (e) return fres(e);
        f.name = name.trim();
        return fres();
      },
      reorderFloors: async (ids) => {
        if (!Array.isArray(ids) || ids.length !== floorsList.length || new Set(ids).size !== ids.length || !ids.every((id) => floorsList.some((f) => f.id === id))) return fres('The new order must list every floor once.');
        const next = ids.map((id) => floorsList.find((f) => f.id === id) as { id: string; name: string; on: boolean });
        floorsList.splice(0, floorsList.length, ...next);
        return fres();
      },
      deleteFloor: async (id) => {
        if (id === 'ground') return fres('The ground floor cannot be deleted.');
        const i = floorsList.findIndex((f) => f.id === id);
        if (i < 0) return fres('Unknown floor.');
        floorsList.splice(i, 1);
        for (const [c, f] of [...folderFloor]) if (f === id) folderFloor.delete(c);
        if (lastFloor === id) lastFloor = 'ground';
        return fres();
      },
      setFloorOn: async (id, on) => {
        const f = floorsList.find((x) => x.id === id);
        if (!f) return fres('Unknown floor.');
        f.on = on === true;
        return fres();
      },
      onlyFloor: async (id) => {
        if (!floorsList.some((f) => f.id === id)) return fres('Unknown floor.');
        for (const f of floorsList) f.on = f.id === id;
        return fres();
      },
      moveFolderToFloor: async (agentId, floorId) => {
        const x = sims.find((y) => y.info.id === agentId);
        if (!x || !floorsList.some((f) => f.id === floorId)) return fres('Unknown folder or floor.');
        folderFloor.set(x.info.cwd, floorId);
        return fres();
      },
    };

    const simKinds = simKindsParam === '1' || simKindsParam === 'solo'; // spec 012 FR-136: '1' = two ready harnesses (picker shown), 'solo' = only Copilot ready (picker hidden)
    // Spec 006 FR-028: `simprev=inoffice|inoffice-solo|error` make the next delete answer a refusal or an error. Delete… disabled (no per-session delete) is seen with `simkinds=mixed`, where Ada is Claude Code.
    const simPrev = simQuery.get('simprev') ?? '';
    // Spec 006 FR-034/FR-036: `simprevdelay=<ms>` (at most 10 s) makes both lists answer late, so a driver can press Ctrl+Shift+H while they load.
    const simPrevDelay = Math.min(10_000, Math.max(0, Number(simQuery.get('simprevdelay')) || 0));
    const prevWait = (): Promise<void> => (simPrevDelay ? new Promise((r) => setTimeout(r, simPrevDelay)) : Promise.resolve());
    const prevMarks = new Map<string, { pinned: string[]; hidden: string[] }>(); // key = 'vscode' or the agent app's id; ids only
    const prevDeleted = new Set<string>();
    const simSessionModes = new Map<string, AgentInfo['permMode']>([['prev-1', 'allow']]); // spec 003 (2026-10-21): the mode last chosen per earlier session
    const hasPrev = (x: SimAgent): boolean => x.info.cwd === '~/work/mcp-swiss' || (!!opts.solo && x.info.name === 'Ada'); // earlier sessions live in mcp-swiss (or in Ada's own folder with `simrooms=solo`)
    const prevMarksOf = (src: string, present: string[]): { pinned: string[]; hidden: string[] } => {
      const m = prevMarks.get(src);
      return { pinned: (m?.pinned ?? []).filter((k) => present.includes(k)), hidden: (m?.hidden ?? []).filter((k) => present.includes(k)) };
    };
    const copilotCaps = SIM_COPILOT_CAPS;
    const simInstalled = new Set<string>(); // a simulated install that ended well: the next check finds it (like a real PATH that already had it)
    /*
     * Spec 012 FR-157: `simauth=out` = Copilot and Claude Code are not signed in from the start (the chat shows the sign-in card
     * instead of sending); `simauth=expired` = they look signed in, but the next message fails with Claude's real 401 text and flips
     * them to not signed in. The simulated sign-in (Settings or the chat's card) signs them in again.
     */
    const simAuthMode = simQuery.get('simauth');
    const simSignedOut = new Set<string>(simAuthMode === 'out' ? ['copilot', 'claude'] : []);
    const simExpired = new Set<string>(simAuthMode === 'expired' ? ['copilot', 'claude'] : []);
    const SIM_AUTH_ERROR = 'Failed to authenticate. API Error: 401 OAuth access token is invalid.';
    const signInState = (a: AdapterInfo): AdapterInfo => (a.state === 'ready' && simSignedOut.has(a.id) ? { ...a, state: 'not-signed-in', hint: 'Sign in first: open Settings > Agent apps and choose Sign in….' } : a);
    const simAdapters = (): AdapterInfo[] => simAdapterList().map(signInState);
    const simAdapterList = (): AdapterInfo[] => [
      { id: 'copilot', displayName: 'Copilot', state: 'ready', version: 'sim', capabilities: { ...copilotCaps } },
      ...(simKinds ? [
        simKindsParam === 'solo' && !simInstalled.has('claude')
          ? { id: 'claude', displayName: 'Claude Code', state: 'not-installed', hint: 'Install Claude Code, then choose Check again.', capabilities: { ...copilotCaps, caps: false, mcpToggle: false, remote: false } }
          : { id: 'claude', displayName: 'Claude Code', state: 'ready', version: 'sim', where: '~/.local/bin/claude', capabilities: { ...copilotCaps, caps: false, mcpToggle: false, remote: false } },
        // spec 060 FR-003: found through a version manager's folder (nvm), shown as where it was found
        { id: 'codex', displayName: 'Codex', state: 'too-old', version: '0.9.0', hint: 'Update Codex to 1.0 or newer, then choose Check again.', where: '~/.nvm/versions/node/v22.3.0/bin/codex', capabilities: { ...copilotCaps, interrupt: false, history: false, permissionModes: ['read-only'], remote: false } },      ] as AdapterInfo[] : []),
      ...(mixed ? SIM_MIXED_KINDS : []),
    ];
    const notReady = (adapterId: string): string | undefined => {
      const k = simAdapters().find((x) => x.id === adapterId);
      return k && k.state === 'ready' ? undefined : 'This agent app is not ready on this computer. Set it up in Settings > Agent apps.';
    };
    let started = false;
    let extra = 0;
    type HsCb = (p: never) => void;
    const simHarness: { progress: HsCb[]; done: HsCb[]; running: null | { kind: string; finish: () => void } } = { progress: [], done: [], running: null };
    const api: DurbarApi = {
      ...floorApi,
      ...mcpApi,
      ...globalApi,
      ...capApi,
      ...modelApi,
      version: async () => 'sim',
      // Spec 012 T017 (FR-063): only Copilot by default; simkinds=1 adds a Claude Code that is not installed and a Codex that is too old.
      listAdapters: async () => simAdapters(),
      onAdaptersChanged: () => () => undefined, // FR-157: the window marks the app itself from the auth error; nothing else pushes here
      // Spec 051 FR-009: harness setup in the simulator: canned plans and output (a fake link and code), nothing runs
      // spec 051 FR-014: a fake identity per ready app (never a real account, so screenshots show no personal data); `simacct=unknown`
      // and `simacct=apikey` change Claude Code's line. The lines are what main's accountLine makes of these answers (checked by test:account).
      harnessAccounts: async () => {
        const simAcct = simQuery.get('simacct');
        // spec 051 FR-016, FR-018, FR-021: the line is masked; `name` is the clear (fake) name for the Settings reveal only; `plan`,
        // `provider` and `via` are the card's facts. These are accountView's answers for fake identities, mapped like the real ones
        // (test:account). `simacct=noplan`: Copilot reports no plan.
        type V = { status: 'signed-in' | 'signed-out' | 'unknown'; text: string; masked?: string; name?: string; plan?: string; provider?: string; via?: string };
        const out: Record<string, V> = {};
        const SIM_COPILOT: V = { status: 'signed-in', text: 'Signed in as o••• · Copilot Individual', masked: 'o•••', name: 'octo-sim', plan: 'Copilot Individual', provider: 'GitHub', via: 'GitHub CLI' };
        const SIM_COPILOT_NOPLAN: V = { status: 'signed-in', text: 'Signed in as o••• (GitHub, through the GitHub CLI)', masked: 'o•••', name: 'octo-sim', provider: 'GitHub', via: 'GitHub CLI' };
        const SIM_CLAUDE: V = { status: 'signed-in', text: 'Signed in as s•••@example.com · Claude Pro', masked: 's•••@example.com', name: 'sim@example.com', plan: 'Claude Pro', provider: 'Claude', via: 'Claude login' };
        const SIM_CLAUDE_KEY: V = { status: 'signed-in', text: 'Signed in with an Anthropic API key', provider: 'Anthropic', via: 'API key' };
        const SIM_CODEX: V = { status: 'signed-in', text: 'Signed in as s•••@example.com · ChatGPT Plus', masked: 's•••@example.com', name: 'sim@example.com', plan: 'ChatGPT Plus', provider: 'OpenAI (ChatGPT)', via: 'ChatGPT login' };
        for (const a of simAdapters()) {
          if (a.state === 'not-signed-in') out[a.id] = { status: 'signed-out', text: 'Not signed in' };
          else if (a.state !== 'ready') continue;
          else if (a.id === 'copilot') out[a.id] = simAcct === 'noplan' ? SIM_COPILOT_NOPLAN : SIM_COPILOT;
          else if (a.id === 'claude') out[a.id] = simAcct === 'unknown' ? { status: 'unknown', text: 'Account unknown' } : simAcct === 'apikey' ? SIM_CLAUDE_KEY : SIM_CLAUDE;
          else if (a.id === 'codex') out[a.id] = SIM_CODEX;
        }
        return out;
      },
      copilotAuth: async () => ({ known: true, signedIn: true, ...(simQuery.get('simnopwsh') === '1' ? { pwshMissing: true } : {}) }), // spec 052 FR-073: page address simnopwsh=1 shows the Windows PowerShell 7 hint
      // spec 060 FR-002: in the app, ask main for the real routes of this OS (main assumes a typical new machine under the simulator);
      // the made-up list below is only for the page opened in a plain browser, where there is no main process
      harnessPlans: async (kind, op) => {
        const real = typeof window !== 'undefined' ? (window as unknown as { agentDurbar?: DurbarApi }).agentDurbar : undefined;
        if (real?.harnessPlans) return real.harnessPlans(kind, op);
        return { name: kind === 'copilot' ? 'the GitHub Copilot CLI' : kind === 'codex' ? 'the Codex CLI' : 'Claude Code', page: 'https://example.invalid/', plans: kind === 'codex' ? [{ manager: 'npm', display: (op === 'update' ? 'npm install -g @openai/codex@latest' : 'npm install -g @openai/codex') }] : [{ manager: 'brew', display: 'brew install --cask claude-code' }, { manager: 'npm', display: 'npm install -g @anthropic-ai/claude-code', note: 'Needs Node.js 22 or later. Anthropic recommends its native installer.' }] };
      },
      harnessRun: async (kind, op, planIndex) => {
        const t0 = Date.now();
        // spec 060 FR-012: the driver checks which route a Run button asked for (only an index is sent; nothing runs here)
        if (typeof window !== 'undefined') (window as unknown as { __simHarnessLast?: unknown }).__simHarnessLast = { kind, op, planIndex };
        const prog = (p: Record<string, unknown>) => simHarness.progress.forEach((cb) => cb({ kind, op, elapsedMs: Date.now() - t0, lines: [], ...p } as never));
        const done = (ok: boolean) => { simHarness.running = null; if (ok && op === 'signin') { simSignedOut.delete(kind); simExpired.delete(kind); } simHarness.done.forEach((cb) => cb({ kind, op, ok, exitCode: ok ? 0 : 1, lines: ['(simulated)'] } as never)); };
        if (op === 'signin') {
          setTimeout(() => prog({ url: kind === 'claude' ? 'https://claude.com/cai/oauth/authorize?simulated=1' : 'https://auth.openai.com/codex/device', ...(kind === 'claude' ? { needsPaste: true } : { code: 'SIM1-ABCDE' }) }), 300);
          simHarness.running = { kind, finish: () => done(true) };
          if (kind !== 'claude') setTimeout(() => { if (simHarness.running) done(true); }, 60000);
        } else {
          setTimeout(() => prog({ lines: ['added 1 package in 3s (simulated)'] }), 300);
          setTimeout(() => { if (op === 'install') simInstalled.add(kind); done(true); }, 2500);
        }
        return { ok: true };
      },
      harnessPaste: async (text) => { if (!simHarness.running || !String(text || '').trim()) return { ok: false, error: 'Paste the code from the sign-in page (one line).' }; const r = simHarness.running; setTimeout(() => r.finish(), 400); return { ok: true }; },
      harnessCancel: async () => { const r = simHarness.running; simHarness.running = null; if (r) simHarness.done.forEach((cb) => cb({ kind: r.kind, op: 'signin', ok: false, reason: 'cancelled', lines: [] } as never)); return !!r; },
      harnessOpenPage: async () => ({ ok: true }),
      harnessOpenSignIn: async () => ({ ok: true }),
      onHarnessProgress: (cb) => { simHarness.progress.push(cb); return () => { simHarness.progress = simHarness.progress.filter((x) => x !== cb); }; },
      onHarnessDone: (cb) => { simHarness.done.push(cb); return () => { simHarness.done = simHarness.done.filter((x) => x !== cb); }; },
      addFolder: async (_mode, o) => {
        const bad = o && o.adapterId !== undefined ? notReady(o.adapterId) : undefined;
        if (bad) return { ok: false, agents: [], error: bad }; // like main: nothing starts, nothing is written
        extra++;
        /* simaddhome=1 (spec 006 FR-016): the next added folder is the home folder, so the calm warning can be seen */
        const home = typeof window !== 'undefined' && /[?&]simaddhome=1(?:&|$)/.test(window.location.search) && extra === 1;
        const cwd = home ? '~' : '~/work/new-folder-' + extra;
        const floor = o && typeof o.floor === 'string' && floorsList.some((f) => f.id === o.floor) ? o.floor : 'ground';
        if (o && o.floor !== undefined) lastFloor = floor;
        folderFloor.set(cwd, floor);
        const info = { id: 'sim-x' + extra, name: home ? 'home' : 'new-folder-' + extra, cwd, folders: [cwd], permMode: 'read-only', floor, adapterId: mixed && o && o.adapterId ? o.adapterId : 'copilot' } as AgentInfo;
        info.renameCap = caps(info.adapterId ?? 'copilot').renameSession;
        sims.push({ info, room: info.name, state: 'idle', intent: 'Ready', prompt: '', helpers: 0, tool: 0, think: 0, files: [], grants: new Map() });
        addedListeners.forEach((l) => l(info));
        return { ok: true, agents: [], ...(home ? { warnings: [{ name: 'home', kind: 'home' as const }] } : {}) };
      },
      addWorkspaceFile: async () => ({ ok: true, agents: [] }),
      listAgents: async () => {
        if (!started) {
          started = true;
          // After the renderer has registered the infos, replay each agent's script.
          setTimeout(() => {
            sims.forEach(play);
            if (opts.edits && sims[0]) simEdits(sims[0]); // spec 005 FR-026
            /* spec 008 FR-113: every script has run (a frozen simulator emits nothing more); the page's settleNow() test hook reads it */
            (window as unknown as { __durbarSimReplayed?: boolean }).__durbarSimReplayed = true;
            // simspeed=N (perf checks, spec 052): background activity N times faster
            const speed = Math.max(1, Math.min(50, Number(typeof location !== 'undefined' ? new URLSearchParams(location.search).get('simspeed') : null) || 1));
            if (!opts.freeze) timer = window.setInterval(tick, Math.round(2600 / speed));
          }, 0);
        }
        /* simresume=1 (spec 006 FR-021): Priya's folder came back after a restart as its last session, not started yet */
        if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('simresume') === '1') {
          const r = sims.find((x) => x.info.name === 'Priya');
          if (r && r.info.resumeLast === undefined) { r.info.lazy = true; r.info.resumeLast = true; r.info.permFrom = 'session'; }
        }
        return sims.map((s) => s.info);
      },
      wake: async (id) => { // FR-021: the canned last session comes back, as the main process resumes it (no prompt)
        const s = sims.find((x) => x.info.id === id);
        if (!s) return { ok: false, error: 'unknown agent' };
        if (!s.info.resumeLast) return { ok: true };
        s.info.resumeLast = false;
        s.info.lazy = false;
        return { ok: true, resumed: true, title: (opts.reply === 'secrets' ? FILL(83) + SECRETS_TEXT + ' ' : '') + 'Add the clause-type column migration', history: { total: 3, truncated: false, items: [
          { type: 'user', text: 'Add a migration for the new clause_type column, nullable for now.' },
          { type: 'tool', callId: 'r1', tool: 'view', label: 'db/migrations/0006_parties.sql', output: '-- 0006: parties table' },
          { type: 'output', text: 'Added `db/migrations/0007_clause_type.sql`. It adds `clause_type TEXT NULL`; nothing is backfilled yet.' },
        ] } };
      },
      pickAttachments: async (): Promise<PickedFile[]> => [
        { path: '/home/vikram/notes/api-design-notes.md', name: 'api-design-notes.md', kind: 'file' },
        { path: '/home/vikram/Pictures/screenshot-2026-10-16.png', name: 'screenshot-2026-10-16.png', kind: 'image' },
      ],
      stageAttachment: async (name, mime, data) => {
        // The simulator has no disk: pretend to stage, with the same caps as the real main process.
        if (data.byteLength > 10 * 1024 * 1024) return { ok: false, error: 'over the 10 MB per-file limit' };
        const clean = String(name).split(/[\\/]/).pop() || 'attachment';
        return { ok: true, file: { path: '/tmp/agent-durbar-att-sim/' + clean, name: clean, kind: /^image\//.test(mime) ? 'image' : 'file', size: data.byteLength } };
      },
      send: async (id, text, _atts?: unknown, opts?: { plan?: boolean }) => {
        const s = sims.find((x) => x.info.id === id);
        if (!s) return { ok: false, error: 'unknown agent' };
        if (opts?.plan) {
          // spec 066 FR-008: a short plan after a moment; nothing runs until it is answered
          simPlan(s, text);
          return { ok: true };
        }
        if (s.perm) return { ok: false, error: 'Waiting for your permission decision first.' };
        if (s.limitReq) return { ok: false, error: 'The spending limit was reached. Choose Raise limit, Remove limit or Stop here first.' };
        // spec 041 FR-065 delta (issue #608 review): `simsendfail=secret` fakes an app error that holds token shapes, also split by Markdown
        if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('simsendfail') === 'secret')
          return { ok: false, error: 'The agent app refused the message: ' + SECRETS_TEXT + ' Also gh`p_' + SIM_TOK.ghp.slice(4) + '` and ' + SIM_TOK.ghp.slice(0, 24) + '**' + SIM_TOK.ghp.slice(24) + '** (split late).' };
        // spec 012 FR-087: `simsendfail=sandbox` fakes Codex refusing Read-only / Ask first (the real Linux message), for the driver
        if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('simsendfail') === 'sandbox' && s.info.permMode !== 'allow')
          return { ok: false, error: "Codex refused the session settings: fs sandbox helper failed: bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted Codex could not start its Linux sandbox: this system blocks unprivileged user namespaces (Ubuntu AppArmor). Read-only and Ask first need that sandbox, so nothing ran. To allow it for bubblewrap, see the README (Codex)." };
        const kind = s.info.adapterId ?? 'copilot';
        if (simExpired.has(kind) || simSignedOut.has(kind)) {
          // FR-157: the app refuses the turn because of the sign-in, as Claude Code did on a real account
          simExpired.delete(kind);
          simSignedOut.add(kind);
          window.setTimeout(() => {
            emit({ type: 'status', sessionId: id, timestamp: now(), status: 'working', intent: 'Thinking' });
            emit({ type: 'status', sessionId: id, timestamp: now(), status: 'error', intent: SIM_AUTH_ERROR, errorKind: 'auth' });
          }, 300);
          return { ok: true };
        }
        if (s.breakUntil && Date.now() < s.breakUntil) { // spec 068: the limit has not reset yet: the turn hits it again
          const kind = s.info.name === 'Rosa' ? 'quota' : 'plan';
          window.setTimeout(() => { emit({ type: 'status', sessionId: id, timestamp: now(), status: 'working', intent: 'Thinking' }); simLimit(s, kind); }, 400);
          return { ok: true };
        }
        s.breakUntil = undefined;
        window.setTimeout(() => void reply(s, text), 400);
        // spec 073 FR-011: a folder or user entry is "sent as its text", as the real adapters do (FR-005)
        const sl = /^\/([A-Za-z0-9][A-Za-z0-9._:-]{0,63})(?:\s|$)/.exec(String(text).trim());
        const hit = sl ? simSlashFor(kind, simQuery).find((e) => e.source !== 'app' && e.name.toLowerCase() === sl[1].toLowerCase()) : undefined;
        return hit ? { ok: true, slash: hit.where ?? hit.name, ...(hit.note ? { slashNote: hit.note } : {}) } : { ok: true };
      },
      stop: async (id) => {
        // Stop = interrupt the turn only (like the real adapter): pending approval denied, grants kept, back to Ready.
        const s = sims.find((x) => x.info.id === id);
        if (!s) return;
        if (s.limitReq) {
          emit({ type: 'limit', sessionId: id, timestamp: now(), phase: 'resolved', requestId: s.limitReq, action: 'cancel' });
          s.limitReq = undefined;
        }
        if (s.planReq) {
          emit({ type: 'plan', sessionId: id, timestamp: now(), phase: 'resolved', requestId: s.planReq.id, action: 'reject' }); // spec 066: Stop rejects an open plan
          s.planReq = undefined;
        }
        if (s.perm) {
          const { cont: _c, file: _f, ...p } = s.perm;
          emit({ type: 'permission', sessionId: id, timestamp: now(), permission: { ...p, state: 'denied', via: 'stopped' } });
          s.perm = undefined;
        }
        s.pendingModel = undefined; // real: (spec 030 T042) the runtime drops a switch that was still queued when the turn is stopped
        s.state = 'idle'; closeOpen(s);
        emit({ type: 'status', sessionId: id, timestamp: now(), status: 'idle', intent: 'Aborted' });
      },
      end: async (id) => {
        const s = sims.find((x) => x.info.id === id);
        if (!s) return;
        if (s.grants.size) { s.grants.clear(); grantsEvent(s); }
        s.state = 'idle'; closeOpen(s); simRemote.delete(id); // spec 054 FR-003
        s.mcpSign = undefined; // spec 058 FR-065: End session forgets an open sign-in
        emit({ type: 'status', sessionId: id, timestamp: now(), status: 'stopped' });
      },
      /* spec 058 FR-040: a canned Restart session: asks while busy (as main does), ends, then resumes "Ready"; with simauth=expired
         the resume fails with the sign-in text (FR-027) and the session stays ended */
      agentMcpRestartSession: async (id, confirmed) => {
        const s = sims.find((x) => x.info.id === id);
        if (!s) return { ok: false, error: 'Unknown agent.' };
        if (s.state !== 'idle' && confirmed !== true) return { ok: false, needsConfirm: true };
        const kind = s.info.adapterId ?? 'copilot';
        if (s.grants.size) { s.grants.clear(); grantsEvent(s); }
        s.state = 'idle'; closeOpen(s); simRemote.delete(id);
        s.mcpFixed = undefined; s.mcpRestarting = undefined; s.mcpSign = undefined;
        emit({ type: 'status', sessionId: id, timestamp: now(), status: 'stopped' });
        await new Promise((r) => setTimeout(r, 500));
        if (simExpired.has(kind)) return { ok: false, ended: true, errorKind: 'auth', error: SIM_AUTH_ERROR };
        s.ctx ??= { tokens: 0, limit: 128000 }; // agentMcp reads "live" from it
        emit({ type: 'status', sessionId: id, timestamp: now(), status: 'idle', intent: 'Ready in ' + s.info.cwd });
        return { ok: true };
      },
      resolvePermission: async (id, req, approve, remember) => {
        const s = sims.find((x) => x.info.id === id);
        if (!s || !s.perm || s.perm.requestId !== req) return;
        const { cont, file, folders, ...p } = s.perm;
        s.perm = undefined;
        const keep = approve && remember === true;
        // like the broker (review on #470): a write in several folders grants each folder, one chip each
        if (keep) { for (const g of folders ?? [{ key: p.scopeKey, label: p.scopeLabel }]) s.grants.set(g.key, g.label); grantsEvent(s); }
        emit({ type: 'permission', sessionId: id, timestamp: now(), permission: { ...p, state: approve ? 'approved' : 'denied', via: 'user', remembered: keep || undefined } });
        simLog(s, !approve ? 'denied' : keep ? 'allowed-session' : 'allowed-once', p.summary);
        s.state = 'working';
        emit({ type: 'status', sessionId: id, timestamp: now(), status: 'working', intent: (approve ? 'Allowed: ' : 'Denied: ') + file });
        if (cont === 'edit') { editTool(s, file, approve); finishReply(s, approve, file); } else toolStep(s, true);
      },
      revokeGrant: async (id, key) => {
        const s = sims.find((x) => x.info.id === id);
        if (opts.grants !== 'stuck' && s && s.grants.delete(key)) grantsEvent(s);
      },
      // No disk, no account: canned answers so the new folder / session / history UI can be exercised without credits.
      listModels: async (kind) => ({ ok: true, models: (kind === 'claude' ? SIM_CLAUDE_MODELS : !kind || kind === 'copilot' ? SIM_MODELS : []).map((m) => ({ ...m })) }),
      newSession: async (id, o) => {
        const src = sims.find((x) => x.info.id === id);
        if (!src) return { ok: false, error: 'unknown agent' };
        const bad = o.adapterId !== undefined ? notReady(o.adapterId) : undefined;
        if (bad) return { ok: false, error: bad };
        extra++;
        const info = { ...src.info, alias: undefined, adapterId: o.adapterId ?? src.info.adapterId, id: 'sim-n' + extra, permMode: o.permMode ?? src.info.permMode, model: o.model ?? 'auto', tier: undefined, effort: o.effort, maxAiCredits: o.maxAiCredits === null ? undefined : o.maxAiCredits ?? defaultCap } as AgentInfo;
        if (mixed) { // the new session follows its kind's capabilities like the roster does
          const k = caps(info.adapterId ?? 'copilot');
          if (!k.caps || (k.capUnit === 'usd' && o.maxAiCredits === undefined)) info.maxAiCredits = undefined; // the AIU default is not a dollar cap
          if (!k.permissionModes.includes(info.permMode)) info.permMode = 'read-only';
          if (!k.models) info.modelControl = { switch: 'none', effort: false, contextTier: false, compact: false, windowKnown: true };
          else if (k.modelSwitch) info.modelControl = { switch: 'next-message', effort: true, contextTier: k.modelSwitch.contextTier, compact: false, windowKnown: true };
        }
        sims.push({ info, room: src.room, state: 'idle', intent: 'Ready', prompt: '', helpers: 0, tool: 0, think: 0, files: src.files, grants: new Map() });
        return { ok: true, agent: info };
      },
      setFolderHidden: async () => ({ ok: true }),
      openExternal: async (url) => {
        console.info('[sim] would open in the system browser:', url);
        return { ok: /^https?:\/\//i.test(url) };
      },
      setRoomClosed: async () => ({ ok: true }),
      setPermMode: async (id, mode, o) => {
        const s = sims.find((x) => x.info.id === id);
        if (!s) return { ok: false, error: 'unknown agent' };
        const MW: Record<string, string> = { 'read-only': 'Read-only', ask: 'Ask first', allow: 'Allow all' };
        simLog(s, 'mode-change', `${MW[s.info.permMode] ?? s.info.permMode} to ${MW[mode] ?? mode}`, mode);
        s.info.permMode = mode;
        s.info.permRestored = undefined;
        s.info.permFrom = undefined;
        if (o?.clearGrants && s.grants.size) { s.grants.clear(); grantsEvent(s); }
        let pending = s.perm ? 1 : 0;
        if (s.perm && ((mode === 'allow' && o?.approvePending) || mode === 'read-only')) {
          await api.resolvePermission(id, s.perm.requestId, mode === 'allow', false);
          pending = 0;
        }
        return { ok: true, mode, pending };
      },
      removeFolder: async (id) => {
        const src = sims.find((x) => x.info.id === id);
        const gone = src ? sims.filter((x) => x.info.cwd === src.info.cwd).map((x) => x.info.id) : [];
        for (const g of gone) sims.splice(sims.findIndex((x) => x.info.id === g), 1);
        return { ok: true, removedIds: gone };
      },
      removeSession: async (id) => { // spec 006 FR-017: same rule as main (never the last session of a folder)
        const src = sims.find((x) => x.info.id === id);
        if (!src) return { ok: false, error: 'unknown session' };
        if (sims.filter((x) => x.info.cwd === src.info.cwd).length < 2) return { ok: false, error: 'This is the only session in the folder. Remove the folder from Folders instead.' };
        sims.splice(sims.indexOf(src), 1);
        return { ok: true };
      },
      renameFolder: async (id, label) => { // spec 006 FR-018: the same trimming as main's parseLabel, nothing saved
        if (!sims.some((x) => x.info.id === id)) return { ok: false };
        const t = String(label ?? '').replace(/\s+/g, ' ').trim();
        return { ok: true, label: t && [...t].length <= 40 ? t : undefined };
      },
      setFolderDefaultAgent: async (id, profileId) => { // spec 043 FR-009: kept for this run only, the same id rule as main
        const src = sims.find((x) => x.info.id === id);
        if (!src || (profileId !== null && !/^[A-Za-z0-9._:@/-]{1,100}$/.test(String(profileId)))) return { ok: false };
        for (const x of sims) if (x.info.cwd === src.info.cwd) x.info.defaultAgent = profileId ?? undefined;
        return { ok: true, defaultAgent: profileId ?? undefined };
      },
      renameSession: async (id, sessionId, name) => { // spec 059 FR-013, FR-015: in memory; the same rule and answers as main; __simRenameFail makes the next app-side rename fail
        const src = sims.find((x) => x.info.id === id);
        if (!src) return { ok: false, error: 'Unknown session.' };
        const bad = simNameError(name);
        if (bad) return { ok: false, error: bad };
        const clean = String(name).replace(/\s+/g, ' ').trim();
        if (sessionId !== null && !/^prev-[1-4]$/.test(sessionId)) return { ok: false, error: 'That session is no longer available for this folder.' };
        if (!clean) {
          if (sessionId === null) { src.info.alias = undefined; renamedListeners.forEach((l) => l({ id, alias: undefined })); } else simPrevNames.delete(sessionId);
          return { ok: true, inApp: false };
        }
        const cap = src.info.renameCap;
        const fail = (window as unknown as { __simRenameFail?: string }).__simRenameFail;
        let note: string | undefined;
        let inApp = false, pending = false;
        if (cap && !(sessionId === null && src.info.lazy && !src.info.resumeLast)) {
          if (fail) { note = `Renamed in Agent Durbar only. ${SIM_APP[src.info.adapterId ?? 'copilot'] ?? 'The agent app'} did not accept the name: ${fail.slice(0, 120)}.`; (window as unknown as { __simRenameFail?: string }).__simRenameFail = undefined; }
          else { inApp = cap === 'any'; pending = cap === 'next-turn'; }
        }
        if (sessionId === null) { src.info.alias = clean; renamedListeners.forEach((l) => l({ id, alias: clean })); } else simPrevNames.set(sessionId, clean);
        return { ok: true, name: clean, inApp, ...(pending ? { pending } : {}), ...(note ? { note } : {}) };
      },
      onAgentRenamed: (cb) => { renamedListeners.add(cb); return () => renamedListeners.delete(cb); },
      listPrevious: async (id) => {
        await prevWait();
        const src = sims.find((x) => x.info.id === id);
        if (!src || !hasPrev(src)) return { ok: true, sessions: [], pinned: [], hidden: [] };
        const t = Date.now();
        const all = [
          { id: 'prev-1', title: (opts.reply === 'secrets' ? SECRETS_TEXT + ' ' : '') + 'Rename the filings handler and update its tests', startTime: t - 3 * 3600e3, modifiedTime: t - 2 * 3600e3, branch: 'refactor/filings' },
          { id: 'prev-2', title: 'Why does the canton lookup return duplicates?', startTime: t - 30 * 3600e3, modifiedTime: t - 29 * 3600e3, branch: 'main' },
          { id: 'prev-3', title: 'Add a retry with backoff to the registry client', startTime: t - 50 * 3600e3, modifiedTime: t - 49 * 3600e3, branch: 'feature/retry' },
          { id: 'prev-4', title: 'Explain why the release workflow failed on the Windows runner and how to fix the path handling', startTime: t - 80 * 3600e3, modifiedTime: t - 79 * 3600e3, branch: 'fix/windows-paths' },
        ].filter((x) => !prevDeleted.has(x.id));
        return { ok: true, sessions: all, names: Object.fromEntries(simPrevNames), ...prevMarksOf(src.info.adapterId ?? 'copilot', all.map((x) => x.id)) };
      },
      // Spec 006 FR-026: pins and hides kept in memory for this run (the real ones are ids in durbar-folders.json), same exclusive rule and id shape as main.
      markPrevious: async (id, src, sessionId, mark) => {
        const a = sims.find((x) => x.info.id === id);
        const okId = src === 'vscode' ? /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(sessionId) : /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(sessionId);
        if (!a || !okId || !['pin', 'unpin', 'hide', 'unhide'].includes(mark)) return { ok: false, error: 'That is not a session id.' };
        const m = prevMarks.get(src) ?? { pinned: [] as string[], hidden: [] as string[] };
        m.pinned = m.pinned.filter((k) => k !== sessionId);
        m.hidden = m.hidden.filter((k) => k !== sessionId);
        if (mark === 'pin') m.pinned.push(sessionId);
        if (mark === 'hide') m.hidden.push(sessionId);
        prevMarks.set(src, m);
        return { ok: true };
      },
      // Spec 006 FR-029: nothing is deleted; the rows only leave the simulated list. `simprev=inoffice` answers the refusal for the next delete.
      deletePrevious: async (id, sessionId) => {
        const a = sims.find((x) => x.info.id === id);
        if (!a) return { ok: false, error: 'unknown agent' };
        if (!simAdapterList().find((k) => k.id === (a.info.adapterId ?? 'copilot'))?.capabilities.deleteSession) return { ok: false, error: 'This agent app cannot delete sessions. Hide it instead.' };
        if (simPrev === 'inoffice' || simPrev === 'inoffice-solo') {
          const alone = sims.find((x) => sims.filter((y) => y.room === x.room).length === 1); // simrooms=solo: every folder has one session
          return { ok: false, code: 'in-office', agentId: (simPrev === 'inoffice-solo' && alone ? alone : a).info.id, error: 'This session is still in the office. End it and remove it from the office first.' };
        }
        if (simPrev === 'error') return { ok: false, error: 'session not found' };
        await new Promise((r) => setTimeout(r, 350));
        prevDeleted.add(sessionId);
        return { ok: true };
      },
      resumeSession: async (id, sessionId, replace) => {
        const src = sims.find((x) => x.info.id === id);
        if (!src) return { ok: false, error: 'unknown agent' };
        extra++;
        // spec 003 (2026-10-21): like main, the session comes back in the mode last chosen for it (prev-1 was last in Allow all), else the opener's
        const own = simSessionModes.get(sessionId);
        const mode = own ?? src.info.permMode;
        const info = { ...src.info, id: 'sim-n' + extra, alias: simPrevNames.get(sessionId), permMode: mode, permFrom: own ? 'session' : 'opener', permRestored: own === 'allow' ? true : undefined } as AgentInfo;
        const modeWas = mode !== src.info.permMode ? src.info.permMode : undefined;
        sims.push({ info, room: src.room, state: 'idle', intent: 'Ready', prompt: '', helpers: 0, tool: 0, think: 0, files: src.files, grants: new Map() });
        const t = Date.now() - 2 * 3600e3;
        if (modeWas) { const MW: Record<string, string> = { 'read-only': 'Read-only', ask: 'Ask first', allow: 'Allow all' }; simLog(sims[sims.length - 1], 'mode-change', `Resumed in ${MW[mode]}, the mode last chosen for this session (opened from a session in ${MW[modeWas]})`, mode); }
        return { ok: true, ...(modeWas ? { modeWas } : {}), agent: info, title: (opts.reply === 'secrets' ? FILL(83) + SECRETS_TEXT + ' ' : '') + (sessionId === 'prev-1' ? 'Rename the filings handler and update its tests' : 'Why does the canton lookup return duplicates?'),
          history: { total: 4, truncated: false, items: [
            { type: 'user', text: 'Rename the filings handler to filingsSearch and update its tests.', ts: t },
            { type: 'tool', callId: 'c1', tool: 'grep', label: 'grep filingsHandler', output: '6 matches in 3 files' },
            { type: 'output', text: 'Renamed the handler and updated the three tests that import it. The test run passes.' },
          ] } };
      },
      listVsChats: async (id) => {
        await prevWait();
        const src = sims.find((x) => x.info.id === id);
        if (!src || !hasPrev(src)) return { ok: true, sessions: [], storesFound: 0, unreadable: 0, tooLarge: 0, formatNote: '' };
        return { ok: true, storesFound: 1, unreadable: 0, tooLarge: 0, formatNote: 'VS Code does not document this format; unknown parts are skipped.',
          sessions: [
            { key: 'h1/c1', title: 'Explain the registry design', updated: Date.now() - 5 * 86400e3, requests: 2, format: 'jsonl' },
            { key: 'h1/c2', title: 'Explicación del diseño de la caché', updated: Date.now() - 9 * 86400e3, requests: 3, format: 'jsonl' },
          ], ...prevMarksOf('vscode', ['h1/c1', 'h1/c2']) };
      },
      readVsChat: async () => ({ ok: true, transcript: { title: 'Explain the registry design', totalRequests: 346, shownRequests: 26,
        notes: ['Only the last 26 of 346 messages are shown.', '1 kind(s) of content were not recognised and skipped (futureThing2027). VS Code\'s format may have changed.'],
        blocks: [
          { type: 'user' as const, text: 'Explain how the tool registry is organised.' },
          { type: 'assistant' as const, text: 'Tools are registered in registry.ts and looked up by name. Each domain exports a list that the registry concatenates.' },
          { type: 'tool' as const, label: 'Read src/tools/registry.ts' },
          ...Array.from({ length: 23 }, (_, i) => [
            { type: 'user' as const, text: `Follow-up ${i + 1}: how does the registry handle name clashes between two domains?` },
            { type: 'assistant' as const, text: `Answer ${i + 1}: the last domain wins and a warning is logged at startup.\n\nThe registry keeps one map from name to handler, so a clash replaces the earlier entry.` },
          ]).flat(),
          { type: 'user' as const, text: 'Thanks. This is the latest message in the chat.' },
          { type: 'assistant' as const, text: 'You are welcome. This is the last reply.' },
        ] } }),
      openInVSCode: async () => ({ ok: true }),
      // spec 063 FR-006: a fixed git status per agent (no git repository needed): branch, 0-4 changed files, one non-repository folder
      gitStatus: async (id: string) => {
        const n = Number(String(id).replace(/\D/g, '')) || 0;
        if (n % 7 === 6) return { repo: false as const };
        const pool = [
          { path: 'src/tools/registry.ts', state: 'modified' as const, added: 42, removed: 17 },
          { path: 'src/tools/companies.ts', state: 'added' as const, added: 118, removed: 0 },
          { path: 'src/tools/old-lookup.ts', state: 'deleted' as const, added: 0, removed: 64 },
          { path: 'docs/notes.md', state: 'untracked' as const },
        ];
        return { repo: true as const, branch: n % 3 === 1 ? 'feature/login' : 'main', ...(n % 4 === 1 ? { ahead: 2 } : {}), files: pool.slice(0, n % 5), more: 0 };
      },
      onEvent: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
      // spec 065 FR-007: `simcheckpoint=1` gives Ada (sim-1) a turn that changed three files; `=conflict` makes one of them changed since
      onCheckpoint: (cb) => {
        const mode = simQuery.get('simcheckpoint');
        if (mode) setTimeout(() => cb({ id: 'sim-1', turn: 1, kind: 'turn', files: [{ path: 'src/tools/registry.ts', change: 'changed' }, { path: 'src/tools/companies.ts', change: 'created' }, { path: 'src/tools/old-lookup.ts', change: 'deleted' }], notCovered: [{ path: 'dist/bundle.js', why: 'too large to undo' }] }), 900);
        return () => undefined;
      },
      checkpointPreview: async (id, turn) => {
        if (id !== 'sim-1' || (turn !== 1 && turn !== 2)) return { ok: false as const, error: 'These changes can no longer be undone (only the last turns are kept, while Agent Durbar runs).' };
        const conflict = simQuery.get('simcheckpoint') === 'conflict';
        const files = turn === 1
          ? [
              { path: 'src/tools/registry.ts', action: 'restore' as const, diff: '--- a/src/tools/registry.ts\n+++ b/src/tools/registry.ts\n@@\n-export const tools = [companies];\n+export const tools = [lookup];\n+// legacy\n' },
              { path: 'src/tools/companies.ts', action: 'remove' as const },
              { path: 'src/tools/old-lookup.ts', action: 'create' as const },
            ]
          : [{ path: 'src/tools/registry.ts', action: 'restore' as const, diff: '-a\n+b\n' }, { path: 'src/tools/companies.ts', action: 'create' as const }, { path: 'src/tools/old-lookup.ts', action: 'remove' as const }];
        return { ok: true as const, turn, files, conflicts: conflict && turn === 1 ? ['src/tools/registry.ts'] : [], notCovered: turn === 1 ? [{ path: 'dist/bundle.js', why: 'too large to undo' }] : [] };
      },
      checkpointUndo: async (id, turn) => {
        if (id !== 'sim-1' || (turn !== 1 && turn !== 2)) return { ok: false as const, error: 'invalid request' };
        if (simQuery.get('simcheckpoint') === 'conflict' && turn === 1) return { ok: false as const, error: 'Some of these files changed after that turn, so nothing was restored.', conflicts: ['src/tools/registry.ts'] };
        const files = turn === 1
          ? [{ path: 'src/tools/registry.ts', change: 'changed' as const }, { path: 'src/tools/companies.ts', change: 'deleted' as const }, { path: 'src/tools/old-lookup.ts', change: 'created' as const }]
          : [{ path: 'src/tools/registry.ts', change: 'changed' as const }, { path: 'src/tools/companies.ts', change: 'created' as const }, { path: 'src/tools/old-lookup.ts', change: 'deleted' as const }];
        return { ok: true as const, restored: 1, removed: 1, created: 1, undo: { turn: turn + 1, kind: 'undo' as const, files, notCovered: [] } };
      },
      onAgentAdded: (cb) => { addedListeners.add(cb); return () => addedListeners.delete(cb); },
      onMenuSettings: () => () => undefined, /* spec 052 FR-083: no app menu in the simulator */
      onMenuAdd: () => () => undefined, /* spec 052 FR-164 */
      onFullScreen: () => () => undefined,
    };
    void timer;
    return api;
  }

  (window as unknown as { __durbarSim: { create(o: SimOptions): DurbarApi } }).__durbarSim = { create };
})();
