# Plan 085

1. `src/main/sessionsummary.ts`: pure parsers (`parseShortstat`, `parseCount`, `validRef`), `SessionStarts` (start time, start ref, clean flag per session id; injected `GitExec` and clock), `summarize()` using the git runner of spec 063 (`nodeGitExec`) and `folderGitStatus` for the clean flag and untracked files. Unit-tested with fake runners.
2. `src/main/ipc/agents.ts`: `agents:send` notes the start (first send only, before the turn), `agents:sessionSummary` (window only), `agents:end`/`agents:remove` forget it; `src/main/main.ts` wires the store; `preload`, `api.ts` (`sessionSummary?`).
3. `src/renderer/sessionsummary.js` (pure words, `window.DurbarSessionSummary`): the card text from the summary and the usage text; `app.js`: `endLive`, the card menu End and End all sessions ask for the summary before the end and add the note after it; the button reuses `showFolderStatus`'s dialog.
4. `src/renderer/sim.ts`: `simsummary=1` fixtures.
5. Tests: `scripts/test-sessionsummary.ts` (hostile git output, bounds, argv has no shell and no user string, mutations), driver `scripts/check-session-summary.js` in `scripts/ui-suite.js`. Docs: README, changelog fragment, `docs/agent-notes.md` if something is learned.
