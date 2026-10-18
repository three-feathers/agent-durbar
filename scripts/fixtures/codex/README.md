# Codex fixtures (SYNTHETIC)

These files were written by hand from the Codex app-server documentation and type names (spec 012 research, section 3.2). No Codex binary was run, no account was used, nothing here was recorded from a real session. Each file says `"provenance": "synthetic"`.

Shape: `{ provenance, notifications: [...], expected: [...] }`. `notifications` are JSON-RPC notifications as read off the wire (`method`, `params`); `expected` is the list of normalized events (without `sessionId` and `timestamp`) that `src/adapters/codexMap.ts` must produce. Replace a file with a recording (`"provenance": "recorded"`) once one is approved; field names and values may then differ from these guesses.
