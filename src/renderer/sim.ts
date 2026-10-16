/**
 * Simulated live agents (dev mode). Feeds fake *normalized* AgentEvents through the same renderer
 * path as the Copilot adapter, so the office layout can be tested with 10-15 agents without
 * starting any session or spending AI credits.
 *
 * Enable with `DURBAR_SIM=15 npm start` (Electron main passes ?sim=15) or open
 * dist/renderer/index.html?sim=15 in a browser. Extra query params: simfreeze=1 (no ticking),
 * simrooms=solo (one folder per agent), seed=N, density=full|card|mini, open=<agent id>.
 *
 * Plain script (no imports/exports) so it runs unchanged in the sandboxed renderer.
 */
type AgentEvent = import('../adapters/types').AgentEvent;
type AgentInfo = import('../shared/api').AgentInfo;
type DurbarApi = import('../shared/api').DurbarApi;
type PickedFile = import('../shared/api').PickedFile;

interface SimOptions {
  n: number;
  freeze?: boolean;
  solo?: boolean;
  seed?: number;
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
}

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
  const THINK = [
    'The request touches a few files, so I will read them before changing anything. ',
    'Splitting by domain keeps the public API stable and the diff easy to review. ',
    'I should check callers first, because a rename here is a breaking change for any client that pins tool names. ',
    'Eleven of the fourteen inputs have a text layer; the rest need OCR, so I will parse the easy ones first. ',
    'The failure looks like a rate limit rather than a logic error, so a retry with lower concurrency is probably enough. ',
  ];
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
      const info: AgentInfo = { id: 'sim-' + (i + 1), name, cwd, folders: [cwd], permMode: i % 3 === 1 ? 'ask' : i % 3 === 2 ? 'allow' : 'read-only', model: 'auto' } as AgentInfo;
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
      };
    });

    const now = () => Date.now();
    const emit = (e: AgentEvent): void => listeners.forEach((l) => l(e));
    const sid = (s: SimAgent) => s.info.id;
    const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
    const usage = (s: SimAgent): void =>
      emit({ type: 'usage', sessionId: sid(s), timestamp: now(), model: 'auto', inputTokens: 1200 + Math.floor(rnd() * 6000), outputTokens: 150 + Math.floor(rnd() * 900), nanoAiu: Math.floor((0.004 + rnd() * 0.012) * 1e9), creditsStatus: 'complete' });

    function toolStep(s: SimAgent, keepOpen: boolean): void {
      const k = s.tool++;
      const file = s.files[k % s.files.length];
      const id = sid(s) + '-t' + k;
      const kind = k % 4;
      const defs: { tool: string; args: Record<string, string>; out: string }[] = [
        { tool: 'read_file', args: { path: file }, out: String(80 + Math.floor(rnd() * 800)) + ' lines' },
        { tool: 'grep', args: { pattern: 'registerTool\\(|export (async )?function (find|search|lookup)[A-Z][A-Za-z]+' }, out: '14 matches in 6 files' },
        { tool: 'bash', args: { command: LONG_CMD }, out: LONG_OUT },
        { tool: 'edit_file', args: { path: file }, out: '+' + (20 + Math.floor(rnd() * 160)) + ' -' + Math.floor(rnd() * 40) },
      ];
      const d = defs[kind];
      emit({ type: 'toolCall', sessionId: sid(s), timestamp: now(), callId: id, tool: d.tool, phase: 'start', args: d.args });
      if (keepOpen) { s.open = id; return; }
      emit({ type: 'toolCall', sessionId: sid(s), timestamp: now(), callId: id, tool: d.tool, phase: 'complete', output: d.out });
    }
    function closeOpen(s: SimAgent): void {
      if (!s.open) return;
      emit({ type: 'toolCall', sessionId: sid(s), timestamp: now(), callId: s.open, tool: 'bash', phase: 'complete', output: 'ok' });
      s.open = undefined;
    }
    const think = (s: SimAgent, sentences: number): void => {
      for (let i = 0; i < sentences; i++) emit({ type: 'thinking', sessionId: sid(s), timestamp: now(), delta: THINK[s.think++ % THINK.length] });
    };

    function play(s: SimAgent): void {
      emit({ type: 'user', sessionId: sid(s), timestamp: now(), text: s.prompt, attachments: (s.attachments ?? []).map((p) => ({ path: p, kind: /\.(png|jpe?g|gif)$/i.test(p) ? 'image' as const : 'file' as const })) });
      if (s.state === 'idle') return;
      emit({ type: 'status', sessionId: sid(s), timestamp: now(), status: 'working', intent: s.intent });
      think(s, 4);
      const done = sims.indexOf(s) === 0 ? 8 : s.state === 'working' ? 4 : 3;
      for (let i = 0; i < done; i++) { toolStep(s, false); usage(s); }
      // Sub-agents
      for (let h = 0; h < s.helpers; h++) {
        const [hn, task, st] = HELPER_NAMES[(h + sims.indexOf(s)) % HELPER_NAMES.length];
        const hid = 'h' + h;
        emit({ type: 'subagent', sessionId: sid(s), timestamp: now(), subagentId: hid, name: hn, phase: 'started', task });
        if (st === 'done') emit({ type: 'subagent', sessionId: sid(s), timestamp: now(), subagentId: hid, name: hn, phase: 'completed', task });
        if (st === 'failed') emit({ type: 'subagent', sessionId: sid(s), timestamp: now(), subagentId: hid, name: hn, phase: 'failed', task: 'Failed: 4 strict-null errors remain' });
        if (st === 'working' || st === 'thinking') emit({ type: 'subagent', sessionId: sid(s), timestamp: now(), subagentId: hid, name: hn, phase: 'started', task });
      }
      switch (s.state) {
        case 'working':
          emit({ type: 'status', sessionId: sid(s), timestamp: now(), status: 'working', intent: s.intent });
          toolStep(s, true);
          emit({ type: 'output', sessionId: sid(s), timestamp: now(), delta: 'Moved the company handlers first and kept a thin re-export in registry.ts so the public API is unchanged. Next I am running the tests for the three new modules.' });
          break;
        case 'thinking':
          think(s, 2);
          break;
        case 'waiting':
          emit({
            type: 'status', sessionId: sid(s), timestamp: now(), status: 'needs-permission', intent: s.intent,
            permission: { requestId: 'perm-' + sid(s), kind: 'write', summary: 'Edit ' + s.files[0] + ' (rename find_company to search_companies)', state: 'pending' },
          });
          break;
        case 'error':
          emit({ type: 'toolCall', sessionId: sid(s), timestamp: now(), callId: sid(s) + '-fail', tool: 'bash', phase: 'start', args: { command: 'python evals/run.py --prompt v7 --concurrency 8' } });
          emit({ type: 'toolCall', sessionId: sid(s), timestamp: now(), callId: sid(s) + '-fail', tool: 'bash', phase: 'failed', output: 'RateLimitError: 429 Too Many Requests (retry after 38s)\nStopped at case 38 of 120. Partial results saved to evals/out/v7-partial.json' });
          emit({ type: 'status', sessionId: sid(s), timestamp: now(), status: 'error', intent: s.intent });
          break;
        case 'done': {
          const text = 'Done. ' + s.intent + ' Every link in the docs index resolves and the tests pass.';
          emit({ type: 'output', sessionId: sid(s), timestamp: now(), delta: text, final: true, text });
          emit({ type: 'status', sessionId: sid(s), timestamp: now(), status: 'idle' });
          break;
        }
      }
    }

    // Slow, calm background activity: one agent advances every few seconds.
    let timer: number | undefined;
    function tick(): void {
      const live = sims.filter((s) => s.state === 'working' || s.state === 'thinking');
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
    function reply(s: SimAgent, text: string): void {
      closeOpen(s);
      emit({ type: 'status', sessionId: sid(s), timestamp: now(), status: 'working', intent: 'Answering: ' + text.slice(0, 60) });
      think(s, 2);
      toolStep(s, false);
      usage(s);
      const out = 'Simulated reply. I read ' + s.files[0] + ' and nothing else depends on it, so this is safe to change.';
      emit({ type: 'output', sessionId: sid(s), timestamp: now(), delta: out, final: true, text: out });
      emit({ type: 'status', sessionId: sid(s), timestamp: now(), status: 'idle' });
      s.state = 'done';
    }

    let started = false;
    let extra = 0;
    const api: DurbarApi = {
      version: async () => 'sim',
      addFolder: async () => {
        extra++;
        const cwd = '~/work/new-folder-' + extra;
        const info = { id: 'sim-x' + extra, name: 'new-folder-' + extra, cwd, folders: [cwd], permMode: 'read-only' } as AgentInfo;
        addedListeners.forEach((l) => l(info));
        return { ok: true, agents: [] };
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
        return sims.map((s) => s.info);
      },
      pickAttachments: async (): Promise<PickedFile[]> => [
        { path: '/home/vikram/notes/api-design-notes.md', name: 'api-design-notes.md', kind: 'file' },
        { path: '/home/vikram/Pictures/screenshot-2026-10-16.png', name: 'screenshot-2026-10-16.png', kind: 'image' },
      ],
      send: async (id, text) => {
        const s = sims.find((x) => x.info.id === id);
        if (!s) return { ok: false, error: 'unknown agent' };
        window.setTimeout(() => reply(s, text), 400);
        return { ok: true };
      },
      stop: async (id) => {
        const s = sims.find((x) => x.info.id === id);
        if (s) { s.state = 'idle'; closeOpen(s); emit({ type: 'status', sessionId: id, timestamp: now(), status: 'stopped' }); }
      },
      resolvePermission: async (id, _req, approve) => {
        const s = sims.find((x) => x.info.id === id);
        if (!s) return;
        s.state = 'working';
        emit({ type: 'status', sessionId: id, timestamp: now(), status: 'working', intent: (approve ? 'Approved: ' : 'Denied: ') + s.files[0] });
        toolStep(s, true);
      },
      openInVSCode: async () => ({ ok: true }),
      onEvent: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
      onAgentAdded: (cb) => { addedListeners.add(cb); return () => addedListeners.delete(cb); },
    };
    void timer;
    return api;
  }

  (window as unknown as { __durbarSim: { create(o: SimOptions): DurbarApi } }).__durbarSim = { create };
})();
