# Quickstart: 058 MCP servers in a session

How to see and check the feature **without AI credits** once it is built. Nothing here starts a real agent.

## Unit tests

```bash
npm run typecheck && npm run build && npm test
```

The 058 suites (names may change in the plan): `test:mcpwords` (words, start lines, hints), `test:mcplogdirs` (log folders per OS with
injected env), `test:mcpsession` (masking in `agents:mcp`, Restart and Restart session validation and order), plus the extended adapter,
mapper and contract suites (Copilot `restartServer` on the fake SDK, Claude `mcp_reconnect` on the fake CLI, C2 lines).

## Simulator

```bash
DURBAR_SIM=15 npm start
```

1. Open a Copilot agent's chat, then *More* > *MCP servers*. Check: every row has a word and an icon; the line under the list says how
   Copilot starts servers and that the switch applies at once; a failed row shows a hint and *Details* with *Copy*; *Restart* on a row
   goes "Restarting…" -> Starting -> Running with a toast.
2. Do the same on the Claude sim agent: the line says servers start with the next message; *Restart* is present.
3. Do the same on the Codex sim agent: no per-server *Restart*; the footer line points to *Restart session with these servers*; switching
   a server off reads "Off from your next message".
4. Press *Restart session with these servers* on an idle agent (no question) and on a working one (confirmation, Cancel focused).
5. Press *Open log folder*: the simulator shows a toast and opens nothing.

## Screenshots

`node scripts/shots-058-mcp.js` (written in the tasks) at 1440x900 and 1280x800, saved under `docs/screenshots/058-mcp-*.png`. The
office overlap check (`npm run check:office`) is unaffected but run it anyway.

## Real checks (only with the owner's go-ahead, 0 AI credits, no prompt)

See tasks Phase 6. Each uses a throw-away local stdio echo server in a throw-away folder, sends **no prompt**, and records the result in
`research.md`. Do not open or paste the agent app's log files; only note whether the folder exists and whether *Open log folder*
showed it.
