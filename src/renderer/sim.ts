/**
 * Simulated live agents (dev mode). Feeds fake *normalized* AgentEvents through the same renderer
 * path as the Copilot adapter, so the office layout can be tested with 10-15 agents without
 * starting any session or spending AI credits.
 *
 * Enable with `DURBAR_SIM=15 npm start` (Electron main passes ?sim=15) or open
 * dist/renderer/index.html?sim=15 in a browser. Extra query params: simwaitold=1 (waiting requests look 2 minutes old), simtotals=1 (totals saved by a previous run), simunreported=<room>
 * (that room reports usage without credits), simfreeze=1 (no ticking),
 * simrooms=solo (one folder per agent), simplaces=1..3 (that many custom places, spec 024), seed=N, density=full|card|mini, open=<agent id>.
 *
 * Plain script (no imports/exports) so it runs unchanged in the sandboxed renderer.
 */
type AgentEvent = import('../adapters/types').AgentEvent;
type AgentInfo = import('../shared/api').AgentInfo;
type DurbarApi = import('../shared/api').DurbarApi;
type PickedFile = import('../shared/api').PickedFile;
type ModelChoice = import('../shared/api').ModelChoice;
type AdapterInfo = import('../shared/api').AdapterInfo;
type FloorsState = import('../shared/api').FloorsState;
type FloorsResult = import('../shared/api').FloorsResult;
type ScheduleInfo = import('../shared/api').ScheduleInfo;
type SchedulesInfo = import('../shared/api').SchedulesInfo;
type ModelSwitchRequest = import('../shared/modelswitch').ModelSwitchRequest;
type ModelSwitchResult = import('../shared/modelswitch').ModelSwitchResult;
type ContextTier = import('../shared/modelswitch').ContextTier;

interface SimOptions {
  n: number;
  freeze?: boolean;
  solo?: boolean;
  seed?: number;
  /** Spec 033: three floors (Ground floor, Client A, Personal) with the rooms spread over them. */
  floors?: boolean;
  /** Issue #126: some main agents receive a session title, as the runtime sends after the first prompt (page address `simtitles=1`). */
  titles?: boolean;
  /** Spec 012 FR-130: the first Claude agent (or the first agent) asks a question (page address `simquestion=1`). */
  question?: boolean;
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
}

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
  perm?: { requestId: string; kind: string; summary: string; scopeKey: string; scopeLabel: string; file: string; cont: 'tool' | 'edit' };
  /** "Approve for this session" grants: key -> chip label. */
  grants: Map<string, string>;
  /** Context window of the fake session (tokens now / size). */
  ctx?: { tokens: number; limit: number };
  /** Models the fake runtime "routes" this agent's calls to (auto). */
  models?: string[];
  /** Agent ids that switched an MCP server off (spec 019). */
  mcpOff?: Set<string>;
  /** Simulated credit use in nano-AIU, and the open "limit reached" question (spec 011). */
  used?: number;
  /** Dollar estimate used (kinds with `capUnit: 'usd'`). */
  usd?: number;
  limitReq?: string;
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
}

/** Fake models with prices in credits per million tokens (sim: made-up numbers, not Copilot's). Sim Preview reports no price on purpose. */
/* spec 012 FR-120: what a Claude kind's list looks like (the shape of `claudeModelOptions`); a simulation, not Claude's real list */
const SIM_CLAUDE_MODELS: ModelChoice[] = [
  { id: 'default', name: 'Default (recommended)', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'sonnet', name: 'Sim Sonnet', efforts: ['low', 'medium', 'high'] },
  { id: 'haiku', name: 'Sim Haiku', efforts: [] },
];
/* spec 043: what a session's custom agents look like (made up; no real agent files) */
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
const SIM_USD_CAPS: Record<string, number> = { Ada: 0.01 };
const SIM_EXPENSIVE: Record<string, number> = { Omar: 11 };
/* Spec 012 T018 (FR-065, FR-066): the simulated kinds of `simkinds=mixed`. They are a simulation, not a statement about the real CLIs.
   Index in the 15-agent roster -> kind; every other agent is Copilot. Mcp-swiss holds two kinds (Ada, Mira); the basic agent is Priya (idle, never the first). */
const SIM_KIND_BY_AGENT: Record<number, string> = { 0: 'claude', 3: 'claude', 4: 'codex', 5: 'claude', 6: 'basic', 7: 'codex', 8: 'claude', 9: 'codex', 11: 'claude' };
const SIM_COPILOT_CAPS = { interrupt: true, resume: true, images: true, models: true, effort: true, permissionModes: ['read-only', 'ask', 'allow'], permModeSwitch: 'live', usage: { tokens: true, costUsd: false, nanoAiu: true }, context: true, caps: true, helpers: true, history: true, mcpStatus: true, mcpToggle: true, handoff: true } as AdapterInfo['capabilities'];
const SIM_MIXED_KINDS: AdapterInfo[] = [
  { id: 'claude', displayName: 'Claude Code (simulated)', state: 'ready', version: 'sim', capabilities: { ...SIM_COPILOT_CAPS, usage: { tokens: true, costUsd: true, nanoAiu: false }, caps: true, capUnit: 'usd', oneShot: true, mcpToggle: false, permModeSwitch: 'live', helpers: true, history: true } },
  { id: 'codex', displayName: 'Codex (simulated)', state: 'ready', version: 'sim', capabilities: { ...SIM_COPILOT_CAPS, usage: { tokens: true, costUsd: false, nanoAiu: false }, caps: false, permModeSwitch: 'next-message', history: false, helpers: false, mcpToggle: false } },
  { id: 'basic', displayName: 'Basic agent (simulated)', state: 'ready', version: 'sim', capabilities: { interrupt: false, resume: false, images: false, models: false, effort: false, permissionModes: ['read-only'], permModeSwitch: 'none', usage: { tokens: true, costUsd: false, nanoAiu: false }, context: false, caps: false, helpers: false, history: false, mcpStatus: false, mcpToggle: false } as AdapterInfo['capabilities'] },
];

(function () {
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
    const n = Math.max(1, opts.n);
    // Fewer than 12: drop the quieter agents first so the status mix stays varied.
    let rows = ROSTER.slice(0, Math.min(n, ROSTER.length));
    if (n < 12) rows = ROSTER.filter((r) => r[0] !== 'Hugo' && r[0] !== 'Priya' && r[0] !== 'Noor' && r[0] !== 'Omar').slice(0, n);
    while (rows.length < n) rows.push(['Agent' + (rows.length + 1), 'Worker', 'blog', 'working', 'Working through a queued task', 0, ['src/index.ts']]);

    const sims: SimAgent[] = rows.map((r, i) => {
      const [name, role, room, state, intent, helpers, files] = r;
      const roomName = opts.solo ? name.toLowerCase() + '-app' : room;
      const cwd = opts.solo ? '~/work/' + roomName : ROOM_DEFS[room] ?? '~/work/' + room;
      const info: AgentInfo = { id: 'sim-' + (i + 1), name, cwd, folders: [cwd], adapterId: mixed ? SIM_KIND_BY_AGENT[i] ?? 'copilot' : 'copilot', permMode: i % 3 === 1 ? 'ask' : i % 3 === 2 ? 'allow' : 'read-only', model: SIM_MODEL_BY_AGENT[i] ?? 'auto', maxAiCredits: SIM_CAPS[name], permRestored: i % 3 === 2 && i < 6 ? true : undefined, modelControl: { switch: 'next-message', effort: true, contextTier: true, compact: true, windowKnown: true }, profiles: true } as AgentInfo;
      if (mixed && info.adapterId !== 'copilot') {
        const k = caps(info.adapterId ?? 'copilot');
        if (!k.caps) info.maxAiCredits = undefined; // no credit cap on a kind that has none
        else if (k.capUnit === 'usd') info.maxAiCredits = SIM_USD_CAPS[name]; // a dollar cap, never an AIU one (FR-150)
        if (!k.permissionModes.includes(info.permMode)) info.permMode = 'read-only';
        if (!k.models) info.modelControl = { switch: 'none', effort: false, contextTier: false, compact: false, windowKnown: true };
      }
      // Priya models an adapter that cannot switch or compact in place (spec 030): the UI shows the disabled state and offers a new session.
      // Jonas models the real adapter's state until Phase 3: the controls work but are flagged as not verified on a real account.
      if (name === 'Jonas') info.modelControl = { switch: 'next-message', effort: true, contextTier: true, compact: true, windowKnown: true, unverified: true };
      if (i === 6) info.modelControl = { switch: 'none', effort: false, contextTier: false, compact: false, windowKnown: true };
      (info as AgentInfo & { roomName?: string; role?: string }).roomName = roomName;
      (info as AgentInfo & { roomName?: string; role?: string }).role = role;
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
    const emit = (e: AgentEvent): void => {
      listeners.forEach((l) => l(e));
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
      window.setTimeout(() => {
        sims.filter((s, i) => i % 3 === 0).slice(0, SIM_TITLES.length).forEach((s, i) => emit({ type: 'title', sessionId: sid(s), timestamp: now(), title: SIM_TITLES[i] }));
      }, 200);
    }
    /* simquestion=1 (spec 012 FR-130): one agent asks a question, as Claude's AskUserQuestion does */
    let simQ: { s: SimAgent; requestId: string } | undefined;
    if (opts.question) {
      window.setTimeout(() => {
        const s = sims.find((x) => x.info.adapterId === 'claude') ?? sims[0];
        if (!s) return;
        simQ = { s, requestId: 'q-' + s.info.id };
        s.state = 'waiting';
        emit({ type: 'question', sessionId: s.info.id, timestamp: now(), phase: 'asked', requestId: simQ.requestId, questions: [
          { question: 'Which colour should the focus ring use?', header: 'Focus ring', multiSelect: false, options: [{ label: 'Sage', description: 'The calm green of the office walls' }, { label: 'Blue', description: 'Matches the links' }] },
          { question: 'Which screens should get it first?', header: 'Screens', multiSelect: true, options: [{ label: 'Office' }, { label: 'Chat' }, { label: 'Settings' }] },
        ] });
        emit({ type: 'status', sessionId: s.info.id, timestamp: now(), status: 'needs-permission', intent: 'Waiting for your answer' });
      }, 300);
    }
    const simTrusted = new Set<string>(); // spec 043: repository agents confirmed in this run
    const simSched = { list: [] as ScheduleInfo[], pausedAll: false, n: 0, subs: [] as ((d: SchedulesInfo) => void)[], ran: [] as ((r: { agentId: string; scheduleId: string; every?: number; at?: number }) => void)[],
      changed() { const doc = { pausedAll: this.pausedAll, schedules: this.list.map((x) => ({ ...x })) }; this.subs.forEach((f) => f(doc)); } };
    window.setInterval(() => {
      const now = Date.now();
      let any = false;
      for (const sc of simSched.list) {
        const due = sc.done || sc.paused ? undefined : sc.every !== undefined ? sc.next : sc.at;
        if (due === undefined || due > now) continue;
        any = true;
        const s = sims.find((x) => (x.info.workspaceFile ?? x.info.cwd) === sc.folder);
        const busy = !!s && (s.state === 'working' || s.state === 'thinking' || s.state === 'waiting' || !!s.perm);
        const outcome = simSched.pausedAll ? 'skipped-paused' : !s ? 'failed' : busy ? 'skipped-busy' : 'sent';
        if (outcome === 'sent' && s) {
          emit({ type: 'user', sessionId: s.info.id, timestamp: now, text: sc.prompt } as AgentEvent);
          simSched.ran.forEach((f) => f({ agentId: s.info.id, scheduleId: sc.id, every: sc.every, at: sc.at }));
          void api.send(s.info.id, sc.prompt, []);
        }
        sc.last = { at: now, outcome };
        if (sc.every !== undefined) sc.next = sc.at !== undefined ? sc.at + (Math.floor((now - sc.at) / (sc.every * 60000)) + 1) * sc.every * 60000 : now + sc.every * 60000; // spec 044 FR-007: anchored runs keep their time of day
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
        emit({ type: 'context', sessionId: sid(s), timestamp: now(), tokens: c.tokens, limit: c.limit, system: 5840, conversation: Math.max(0, c.tokens - 13500), toolDefinitions: 7668, messages: 3 + s.tool, model: s.info.model, tier: s.tier });
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
    const serversOf = (s: SimAgent): { name: string; transport: string; source: string }[] => [
      ...CLI_SERVERS,
      ...(fakeExtras[s.info.cwd] ?? []).filter((v) => v.enabled && v.trusted).map((v) => ({ name: v.name, transport: v.transport, source: 'workspace' })),
    ];
    const mcpStatus = (s: SimAgent, i: number): void => {
      const off = s.mcpOff ?? new Set<string>();
      emit({ type: 'mcp', sessionId: sid(s), timestamp: now(), servers: serversOf(s).map((m) => ({
        ...m,
        status: off.has(m.name) ? 'disabled' : m.name === 'my-notes' && i % 5 === 4 ? 'needs-auth' : m.name === 'playwright' && i === 5 ? 'failed' : 'connected',
        error: m.name === 'playwright' && i === 5 && !off.has(m.name) ? 'spawn npx ENOENT' : undefined,
      })) });
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
      const defs: { tool: string; args: Record<string, string>; out: string; mcp?: [string, string] }[] = [
        { tool: 'read_file', args: { path: file }, out: String(80 + Math.floor(rnd() * 800)) + ' lines' },
        { tool: 'grep', args: { pattern: 'registerTool\\(|export (async )?function (find|search|lookup)[A-Z][A-Za-z]+' }, out: '14 matches in 6 files' },
        { tool: 'bash', args: { command: LONG_CMD }, out: LONG_OUT },
        { tool: 'edit_file', args: { path: file }, out: '+' + (20 + Math.floor(rnd() * 160)) + ' -' + Math.floor(rnd() * 40) },
        { tool: 'github-search_issues', args: { query: 'is:open label:bug registry' }, out: '7 issues', mcp: ['github', 'search_issues'] },
        { tool: 'playwright-browser_snapshot', args: {}, out: 'page snapshot (212 lines)', mcp: ['playwright', 'browser_snapshot'] },
        { tool: 'my-notes-search_notes', args: { query: 'registerTool options' }, out: '3 results', mcp: ['my-notes', 'search_notes'] },
      ];
      const d = defs[kind];
      const mcpFields = d.mcp ? { mcpServer: d.mcp[0], mcpTool: d.mcp[1] } : {};
      if (d.mcp && (s.mcpOff?.has(d.mcp[0]) || (d.mcp[0] === 'playwright' && !serversOf(s).some((m) => m.name === 'playwright')))) return toolStep(s, keepOpen);
      emit({ type: 'toolCall', sessionId: sid(s), timestamp: now(), callId: id, tool: d.tool, phase: 'start', args: d.args, ...mcpFields });
      if (keepOpen) { s.open = id; return; }
      const complete = (): void => emit({ type: 'toolCall', sessionId: sid(s), timestamp: now(), callId: id, tool: d.tool, phase: 'complete', output: d.out, ...mcpFields });
      /* spec 024 T010: calls that go to a place (bash, github, playwright, my-notes) take 1.5-4 s (seeded) unless the simulator is frozen,
         so agents walk there and back; frozen runs keep every call instant except the one each working agent leaves open */
      if (!opts.freeze && [2, 4, 5, 6].includes(kind)) window.setTimeout(complete, 1500 + Math.floor(rnd() * 2500));
      else complete();
    }
    function subRun(s: SimAgent, h: number, name: string, task: string, st: 'working' | 'thinking' | 'done' | 'failed'): void {
      const call = sid(s) + '-task' + h, base = { sessionId: sid(s), timestamp: now() };
      const prompt = 'You are a helper for the **' + name + '** step.\n\n' + task + '.\n\nOnly read files; report back in two sentences.';
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
        return;
      }
      if (st === 'failed') {
        emit({ ...base, type: 'subagent', subagentId: call, name, phase: 'failed', task: 'Failed: 4 strict-null errors remain', error: 'Failed: 4 strict-null errors remain', agentName: 'explore', model: 'gpt-5.6-luna', durationMs: 7400, totalTokens: 9100, totalToolCalls: 3 });
        emit({ ...base, type: 'toolCall', callId: call, tool: 'task', phase: 'failed', output: 'Failed: 4 strict-null errors remain' });
        return;
      }
      const res = '**' + name + '**: ' + task.toLowerCase() + ' finished. `' + f + '` is fine; nothing else needs changing.';
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
    const scopeOf = (f: string): { key: string; label: string } => ({ key: 'write:' + dirOf(f), label: 'write in ' + dirOf(f).split('/').slice(-2).join('/') + '/' });
    const grantsEvent = (s: SimAgent): void =>
      emit({ type: 'grants', sessionId: sid(s), timestamp: now(), grants: [...s.grants].map(([key, label]) => ({ key, kind: 'write', label })) });
    /** Like the real broker: auto-approve under a session grant, otherwise leave the request pending. */
    function askWrite(s: SimAgent, file: string, summary: string, cont: 'tool' | 'edit', intent: string, force = false): boolean | 'denied' {
      const sc = scopeOf(file);
      if (!force && s.info.permMode === 'allow') return true; // Allow all: no question asked
      if (!force && s.info.permMode === 'read-only') {
        emit({ type: 'permission', sessionId: sid(s), timestamp: now(), permission: { requestId: 'perm-' + sid(s) + '-' + now(), kind: 'write', summary, state: 'denied' } });
        return 'denied';
      }
      const requestId = 'perm-' + sid(s) + '-' + now();
      const base = { requestId, kind: 'write', summary, scopeKey: sc.key, scopeLabel: sc.label };
      if (s.grants.has(sc.key)) {
        emit({ type: 'permission', sessionId: sid(s), timestamp: now(), permission: { ...base, state: 'approved', via: 'session' } });
        return true;
      }
      s.perm = { ...base, file, cont };
      s.state = 'waiting';
      emit({ type: 'status', sessionId: sid(s), timestamp: now() - (opts.waitOld ? 120_000 : 0), status: 'needs-permission', intent, permission: { ...base, state: 'pending' } });
      return false;
    }
    function editTool(s: SimAgent, file: string, ok: boolean): void {
      const id = sid(s) + '-edit' + s.tool++;
      emit({ type: 'toolCall', sessionId: sid(s), timestamp: now(), callId: id, tool: 'edit_file', phase: 'start', args: { path: file } });
      emit({ type: 'toolCall', sessionId: sid(s), timestamp: now(), callId: id, tool: 'edit_file', phase: ok ? 'complete' : 'failed', output: ok ? '+4 -1' : 'Denied by user in Agent Durbar.' });
    }
    function finishReply(s: SimAgent, ok: boolean, file: string): void {
      const out = ok ? 'Simulated reply: edited ' + file + '.' : 'Simulated reply: the edit to ' + file + ' was denied, so I left it unchanged.';
      emit({ type: 'output', sessionId: sid(s), timestamp: now(), delta: out, final: true, text: out });
      emit({ type: 'status', sessionId: sid(s), timestamp: now(), status: 'idle' });
      s.state = 'done';
    }

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
          emit({ type: 'output', sessionId: sid(s), timestamp: now(), delta: 'Moved the company handlers first and kept a thin re-export in `registry.ts` so the public API is unchanged. Next I am running the **tests** for the three new modules.' });
          break;
        case 'thinking':
          think(s, 2);
          break;
        case 'waiting':
          askWrite(s, s.files[0], 'Edit ' + s.files[0] + ' (rename find_company to search_companies)', 'tool', s.intent, true);
          break;
        case 'error':
          emit({ type: 'toolCall', sessionId: sid(s), timestamp: now(), callId: sid(s) + '-fail', tool: 'bash', phase: 'start', args: { command: 'python evals/run.py --prompt v7 --concurrency 8' } });
          emit({ type: 'toolCall', sessionId: sid(s), timestamp: now(), callId: sid(s) + '-fail', tool: 'bash', phase: 'failed', output: 'RateLimitError: 429 Too Many Requests (retry after 38s)\nStopped at case 38 of 120. Partial results saved to evals/out/v7-partial.json' });
          emit({ type: 'status', sessionId: sid(s), timestamp: now(), status: 'error', intent: s.intent });
          break;
        case 'done': {
          const text = '**Done.** ' + s.intent + ' Every link in the docs index resolves and the tests pass.';
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
    ];
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
        const stat = (n: string) => (s.mcpOff?.has(n) ? 'disabled' : live ? 'connected' : undefined);
        const servers = [
          ...fakeCli.map((a) => ({ name: a.name, origin: 'cli' as const, status: stat(a.name), defaultOn: a.enabled, off: !!s.mcpOff?.has(a.name) })),
          ...extrasOf(s.info.cwd).map((v) => ({ name: v.name, origin: 'folder' as const, status: stat(v.name), defaultOn: v.enabled && v.trusted, off: !!s.mcpOff?.has(v.name) })),
        ];
        return { ok: true, servers, live };
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
    const PLACE_CHOICES = ['library', 'software', 'terminal', 'web', 'other', 'desk'];
    /* spec 024 FR-018..FR-020: custom places in memory, with the rules of src/shared/places.ts repeated here (the renderer bundle cannot import
       it; scripts/test-places.ts runs both on the same cases and compares them). */
    type SimPlace = { id: string; name: string; icon: string };
    const MAX_CUSTOM = 3;
    const CUSTOM_ICONS = ['star', 'flask', 'database', 'cloud', 'chart', 'chat', 'mail', 'calendar', 'shield', 'box', 'bolt', 'pin'];
    const RESERVED_NAMES = ['library', 'software library', 'terminal', 'web', 'other tools', 'stay at desk', 'default'];
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
      getSettings: async () => ({ defaultMaxAiCredits: defaultCap, placeMap: { ...placeMap }, customPlaces: customPlaces.map((p) => ({ ...p })), seriousMode, ...(simTheme ? { theme: simTheme } : {}), about: { name: 'Agent Durbar', version: '0.1.0-alpha.7 (simulator)', owner: 'Three Feathers', copyright: 'Copyright (c) 2026 Three Feathers contributors', website: 'https://github.com/three-feathers/agent-durbar', contributors: [{ label: 'vikramgorla', url: 'https://github.com/vikramgorla' }, { label: 'fjcabello', url: 'https://github.com/fjcabello' }, { label: 'rubenlupi', url: 'https://github.com/rubenlupi' }] } /* sample data, real values come from src/shared/about.ts */ }),
      setDefaultCap: async (c) => { defaultCap = c !== null && c >= 30 ? Math.round(c * 100) / 100 : undefined; return { ok: true, defaultMaxAiCredits: defaultCap }; },
      setSeriousMode: async (on) => { if (typeof on === 'boolean') seriousMode = on; return { ok: true, seriousMode }; },
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
        if (c !== null && !(c >= (usd ? 0.01 : 30))) return { ok: false, error: usd ? 'The cost cap must be at least $0.01.' : 'The cap must be a number of at least 30 AI credits (the runtime minimum).' };
        s.info.maxAiCredits = c ?? undefined;
        emit({ type: 'limit', sessionId: id, timestamp: now(), phase: 'changed', maxAiCredits: c });
        return { ok: true, maxAiCredits: c ?? undefined };
      },
      answerQuestion: async (id, requestId, answers) => {
        if (!simQ || simQ.s.info.id !== id || simQ.requestId !== requestId) return { ok: false, error: 'That question is no longer open.' };
        simQ = undefined;
        emit({ type: 'question', sessionId: id, timestamp: now(), phase: answers ? 'answered' : 'cancelled', requestId, ...(answers ? { answers } : {}) });
        emit({ type: 'output', sessionId: id, timestamp: now(), text: answers ? 'Thanks: ' + Object.values(answers).join('; ') + '.' : 'No answer; I will pick Sage for now.', final: true } as AgentEvent);
        return { ok: true };
      },
      listProfiles: async (id) => {
        const s = sims.find((x) => x.info.id === id);
        if (!s || (s.info.adapterId && s.info.adapterId !== 'copilot')) return { ok: false, error: 'This agent cannot use custom agents.', profiles: [] };
        return { ok: true, profiles: SIM_PROFILES.map((p) => ({ ...p, trusted: p.source !== 'repo' || simTrusted.has(p.id) })) };
      },
      selectProfile: async (id, profileId, confirm) => {
        const s = sims.find((x) => x.info.id === id);
        if (!s) return { ok: false, error: 'unknown agent' };
        if (profileId === null) {
          emit({ type: 'agentProfile', sessionId: id, timestamp: now(), profile: null } as AgentEvent);
          return { ok: true, profile: null };
        }
        const p = SIM_PROFILES.find((x) => x.id === profileId);
        if (!p) return { ok: false, error: 'That agent is not available in this session.' };
        if (p.source === 'repo' && !simTrusted.has(p.id)) {
          if (confirm !== true) return { ok: false, needsConfirm: true, profile: p };
          simTrusted.add(p.id);
        }
        emit({ type: 'agentProfile', sessionId: id, timestamp: now(), profile: p } as AgentEvent);
        return { ok: true, profile: p };
      },
      // spec 044: scheduled prompts in memory; a 1 s check sends through the simulated agents (no credits)
      listSchedules: async () => ({ pausedAll: simSched.pausedAll, schedules: simSched.list.map((x) => ({ ...x })) }),
      saveSchedule: async (input) => {
        const now = Date.now();
        const every = input.every !== undefined ? Math.round(Number(input.every)) : undefined;
        if (!input.folder || !String(input.prompt ?? '').trim() || (every === undefined && !(Number(input.at) > now)) || (every !== undefined && !(every >= 5 && every <= 1440))) return { ok: false as const, error: 'A schedule needs a prompt and either a future time or 5 to 1440 minutes.' };
        const old = simSched.list.find((x) => x.id === input.id);
        const sc: ScheduleInfo = { id: old?.id ?? 'sched-' + ++simSched.n, folder: input.folder, prompt: String(input.prompt).trim().slice(0, 2000), ...(every !== undefined ? { every, ...(Number(input.at) > 0 ? { at: Number(input.at) } : {}), next: old?.next ?? (Number(input.at) > now ? Number(input.at) : now + every * 60000) } : { at: Number(input.at) }), ...(input.paused ? { paused: true } : {}), ...(old?.last ? { last: old.last } : {}) };
        simSched.list = old ? simSched.list.map((x) => (x.id === sc.id ? sc : x)) : [...simSched.list, sc];
        simSched.changed();
        return { ok: true as const, schedule: sc };
      },
      removeSchedule: async (id) => { const n = simSched.list.length; simSched.list = simSched.list.filter((x) => x.id !== id); simSched.changed(); return { ok: simSched.list.length !== n }; },
      setSchedulesPaused: async (on) => { simSched.pausedAll = on === true; simSched.changed(); return { ok: true, pausedAll: simSched.pausedAll }; },
      onSchedules: (cb) => { simSched.subs.push(cb); return () => undefined; },
      onScheduleRan: (cb) => { simSched.ran.push(cb); return () => undefined; },
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
        emit({ type: 'status', sessionId: id, timestamp: now(), status: 'working', intent: 'Continuing after the credit limit' });
        window.setTimeout(() => {
          if (s.limitReq) return;
          const text = '**Done.** Continued after the credit limit was raised: ' + s.intent;
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
      emit({ type: 'context', sessionId: sid(s), timestamp: now(), tokens: after, limit: c.limit, system: 5840, conversation: Math.max(0, after - 13500), toolDefinitions: 7668, messages: 3, model: s.info.model, tier: s.tier });
      return { success: true, tokensAfter: after, tokensRemoved: before - after };
    }

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
        if (adapterId === 'copilot') return { ok: false, error: 'That harness cannot make a theme. Pick Claude Code or Codex.' };
        await new Promise((r) => window.setTimeout(r, 700));
        const n = ++simThemeN;
        return { ok: true, costUsd: 0.004, warnings: [], manifest: { id: 'ai-night-shift-newsroom' + (n > 1 ? '-' + n : ''), name: 'Night-shift newsroom', author: 'AI theme maker', version: '1.0', description: String(description).slice(0, 300), extends: 'clean-office', ui: 'corporate', scene: 'corporate',
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
        if (!caps(s.info.adapterId ?? 'copilot').handoff) return { ok: false, error: 'This agent kind cannot make a summary.' };
        await new Promise((r) => window.setTimeout(r, 900));
        const files = (s.files ?? []).slice(0, 3).map((f) => '- `' + f + '`').join('\n') || '- none yet';
        return { ok: true, summary: `## Goal\n${s.intent || 'Continue the current task.'}\n\n## What was done\n- Read the relevant code and ran the tests once (simulated).\n\n## Open items\n- Finish the change and run the tests again.\n\n## Important files and decisions\n${files}\n\n## Next step\nPick up from the open items above.` };
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
    const copilotCaps = SIM_COPILOT_CAPS;
    const simAdapters = (): AdapterInfo[] => [
      { id: 'copilot', displayName: 'Copilot', state: 'ready', version: 'sim', capabilities: { ...copilotCaps } },
      ...(simKinds ? [
        simKindsParam === 'solo'
          ? { id: 'claude', displayName: 'Claude Code', state: 'not-installed', hint: 'Install Claude Code, then choose Check again.', capabilities: { ...copilotCaps, caps: false, mcpToggle: false } }
          : { id: 'claude', displayName: 'Claude Code', state: 'ready', version: 'sim', capabilities: { ...copilotCaps, caps: false, mcpToggle: false } },
        { id: 'codex', displayName: 'Codex', state: 'too-old', version: '0.9.0', hint: 'Update Codex to 1.0 or newer, then choose Check again.', capabilities: { ...copilotCaps, interrupt: false, history: false, permissionModes: ['read-only'] } },
      ] as AdapterInfo[] : []),
      ...(mixed ? SIM_MIXED_KINDS : []),
    ];
    const notReady = (adapterId: string): string | undefined => {
      const k = simAdapters().find((x) => x.id === adapterId);
      return k && k.state === 'ready' ? undefined : 'This agent kind is not ready on this computer. Open "About agent kinds" for what is missing.';
    };
    let started = false;
    let extra = 0;
    const api: DurbarApi = {
      ...floorApi,
      ...mcpApi,
      ...capApi,
      ...modelApi,
      version: async () => 'sim',
      // Spec 012 T017 (FR-063): only Copilot by default; simkinds=1 adds a Claude Code that is not installed and a Codex that is too old.
      listAdapters: async () => simAdapters(),
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
            if (!opts.freeze) timer = window.setInterval(tick, 2600);
          }, 0);
        }
        /* simresume=1 (spec 006 FR-021): Priya's folder came back after a restart as its last session, not started yet */
        if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('simresume') === '1') {
          const r = sims.find((x) => x.info.name === 'Priya');
          if (r && r.info.resumeLast === undefined) { r.info.lazy = true; r.info.resumeLast = true; }
        }
        return sims.map((s) => s.info);
      },
      wake: async (id) => { // FR-021: the canned last session comes back, as the main process resumes it (no prompt)
        const s = sims.find((x) => x.info.id === id);
        if (!s) return { ok: false, error: 'unknown agent' };
        if (!s.info.resumeLast) return { ok: true };
        s.info.resumeLast = false;
        s.info.lazy = false;
        return { ok: true, resumed: true, title: 'Add the clause-type column migration', history: { total: 3, truncated: false, items: [
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
      send: async (id, text) => {
        const s = sims.find((x) => x.info.id === id);
        if (!s) return { ok: false, error: 'unknown agent' };
        if (s.perm) return { ok: false, error: 'Waiting for your permission decision first.' };
        if (s.limitReq) return { ok: false, error: 'The credit limit was reached. Choose Add credits, Remove cap or Stop here first.' };
        window.setTimeout(() => void reply(s, text), 400);
        return { ok: true };
      },
      stop: async (id) => {
        // Stop = interrupt the turn only (like the real adapter): pending approval denied, grants kept, back to Ready.
        const s = sims.find((x) => x.info.id === id);
        if (!s) return;
        if (s.limitReq) {
          emit({ type: 'limit', sessionId: id, timestamp: now(), phase: 'resolved', requestId: s.limitReq, action: 'cancel' });
          s.limitReq = undefined;
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
        s.state = 'idle'; closeOpen(s);
        emit({ type: 'status', sessionId: id, timestamp: now(), status: 'stopped' });
      },
      resolvePermission: async (id, req, approve, remember) => {
        const s = sims.find((x) => x.info.id === id);
        if (!s || !s.perm || s.perm.requestId !== req) return;
        const { cont, file, ...p } = s.perm;
        s.perm = undefined;
        const keep = approve && remember === true;
        if (keep) { s.grants.set(p.scopeKey, p.scopeLabel); grantsEvent(s); }
        emit({ type: 'permission', sessionId: id, timestamp: now(), permission: { ...p, state: approve ? 'approved' : 'denied', via: 'user', remembered: keep || undefined } });
        s.state = 'working';
        emit({ type: 'status', sessionId: id, timestamp: now(), status: 'working', intent: (approve ? 'Approved: ' : 'Denied: ') + file });
        if (cont === 'edit') { editTool(s, file, approve); finishReply(s, approve, file); } else toolStep(s, true);
      },
      revokeGrant: async (id, key) => {
        const s = sims.find((x) => x.info.id === id);
        if (s && s.grants.delete(key)) grantsEvent(s);
      },
      // No disk, no account: canned answers so the new folder / session / history UI can be exercised without credits.
      listModels: async (kind) => ({ ok: true, models: (kind === 'claude' ? SIM_CLAUDE_MODELS : !kind || kind === 'copilot' ? SIM_MODELS : []).map((m) => ({ ...m })) }),
      newSession: async (id, o) => {
        const src = sims.find((x) => x.info.id === id);
        if (!src) return { ok: false, error: 'unknown agent' };
        const bad = o.adapterId !== undefined ? notReady(o.adapterId) : undefined;
        if (bad) return { ok: false, error: bad };
        extra++;
        const info = { ...src.info, adapterId: o.adapterId ?? src.info.adapterId, id: 'sim-n' + extra, permMode: o.permMode ?? src.info.permMode, model: o.model ?? 'auto', tier: undefined, effort: o.effort, maxAiCredits: o.maxAiCredits === null ? undefined : o.maxAiCredits ?? defaultCap } as AgentInfo;
        if (mixed) { // the new session follows its kind's capabilities like the roster does
          const k = caps(info.adapterId ?? 'copilot');
          if (!k.caps || (k.capUnit === 'usd' && o.maxAiCredits === undefined)) info.maxAiCredits = undefined; // the AIU default is not a dollar cap
          if (!k.permissionModes.includes(info.permMode)) info.permMode = 'read-only';
          if (!k.models) info.modelControl = { switch: 'none', effort: false, contextTier: false, compact: false, windowKnown: true };
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
        s.info.permMode = mode;
        s.info.permRestored = undefined;
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
      listPrevious: async (id) => {
        const src = sims.find((x) => x.info.id === id);
        if (!src || src.info.cwd !== '~/work/mcp-swiss') return { ok: true, sessions: [] };
        const t = Date.now();
        return { ok: true, sessions: [
          { id: 'prev-1', title: 'Rename the filings handler and update its tests', startTime: t - 3 * 3600e3, modifiedTime: t - 2 * 3600e3, branch: 'refactor/filings' },
          { id: 'prev-2', title: 'Why does the canton lookup return duplicates?', startTime: t - 30 * 3600e3, modifiedTime: t - 29 * 3600e3, branch: 'main' },
        ] };
      },
      resumeSession: async (id, sessionId, replace) => {
        const src = sims.find((x) => x.info.id === id);
        if (!src) return { ok: false, error: 'unknown agent' };
        extra++;
        const info = { ...src.info, id: 'sim-n' + extra } as AgentInfo;
        sims.push({ info, room: src.room, state: 'idle', intent: 'Ready', prompt: '', helpers: 0, tool: 0, think: 0, files: src.files, grants: new Map() });
        const t = Date.now() - 2 * 3600e3;
        return { ok: true, agent: info, title: sessionId === 'prev-1' ? 'Rename the filings handler and update its tests' : 'Why does the canton lookup return duplicates?',
          history: { total: 4, truncated: false, items: [
            { type: 'user', text: 'Rename the filings handler to filingsSearch and update its tests.', ts: t },
            { type: 'tool', callId: 'c1', tool: 'grep', label: 'grep filingsHandler', output: '6 matches in 3 files' },
            { type: 'output', text: 'Renamed the handler and updated the three tests that import it. The test run passes.' },
          ] } };
      },
      listVsChats: async (id) => {
        const src = sims.find((x) => x.info.id === id);
        if (!src || src.info.cwd !== '~/work/mcp-swiss') return { ok: true, sessions: [], storesFound: 0, unreadable: 0, tooLarge: 0, formatNote: '' };
        return { ok: true, storesFound: 1, unreadable: 0, tooLarge: 0, formatNote: 'VS Code does not document this format; unknown parts are skipped.',
          sessions: [
            { key: 'h1/c1', title: 'Explain the registry design', updated: Date.now() - 5 * 86400e3, requests: 2, format: 'jsonl' },
            { key: 'h1/c2', title: 'Explicación del diseño de la caché', updated: Date.now() - 9 * 86400e3, requests: 3, format: 'jsonl' },
          ] };
      },
      readVsChat: async () => ({ ok: true, transcript: { title: 'Explain the registry design', totalRequests: 2, shownRequests: 2, notes: [],
        blocks: [
          { type: 'user', text: 'Explain how the tool registry is organised.' },
          { type: 'assistant', text: 'Tools are registered in registry.ts and looked up by name. Each domain exports a list that the registry concatenates.' },
          { type: 'tool', label: 'Read src/tools/registry.ts' },
        ] } }),
      openInVSCode: async () => ({ ok: true }),
      onEvent: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
      onAgentAdded: (cb) => { addedListeners.add(cb); return () => addedListeners.delete(cb); },
    };
    void timer;
    return api;
  }

  (window as unknown as { __durbarSim: { create(o: SimOptions): DurbarApi } }).__durbarSim = { create };
})();
