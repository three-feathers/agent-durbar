# Plan 061

1. Constitution Amendment 1 (#395) and owner answers Q1-Q5: done.
2. Research R1-R3: done (spec, *Research results*).
3. **Shared types** `src/shared/foldersetup.ts`: the item model (app, kind hook/rule/mcp, label, masked detail, event, matcher, rule kind, broad, supported, digest, file) and the per-folder decision record.
4. **Scanner** `src/main/foldersetup.ts` (pure apart from reading, size caps 256 KiB per file):
   - Claude: `.claude/settings.json` and `.claude/settings.local.json` (`hooks`, `permissions.allow/deny/ask`), `.mcp.json`;
   - Codex: `.codex/config.toml` (`[mcp_servers.<name>]`: command, args, url, env names), `.codex/hooks.json` (listed, marked unsupported);
   - Copilot: `.github/hooks/*.json` and `hooks` in `.github/copilot/settings.json`; `.mcp.json` is shared.

   One digest per item: sha256 of app, kind and its canonical content. Every shown string goes through `maskSecretCommand`/`maskSecretArgs`/`maskSecretUrl`; env and header values are never shown or kept (names only).
5. **Decisions store** `src/main/foldersetupstore.ts` (`folder-setup.json` in userData): per folder key, accepted and declined digests. Paths and digests only, no file content (constitution III).
6. **Apply** (main builds `StartOptions.folderSetup` for the adapter's app; adapters map it):
   - `hooks: {event, matcher?, command}[]` and `rules: {allow, deny, ask}` (Claude) become Claude's composed `--settings`;
   - Copilot gets `hookDirectories` with one Durbar-written file;
   - every app gets the accepted MCP servers merged into the session's `mcpServers`, read from the file at start and applied only while their digest still matches.
7. **IPC**, window-only (`fromApp`, FR-013): `folderSetup:scan(key)` and `folderSetup:decide(key, accepted[], declined[], hooksConfirmed)`, plus `folderSetup:explain(key, id)` (FR-015) through the cheapest ready adapter's `generateText`, with the hook text quoted as untrusted data. No MCP, remote or schedule path can reach them: a test pins it.
8. **Dialog** `src/renderer/foldersetup.js`:
   - opens after a folder is added, and when a folder's setup changed before its next session;
   - grouped by app, then kind, every item in full, *broad* rules marked, unsupported items greyed with the reason;
   - hooks need the confirmation checkbox; buttons *Use these* and *Turn all off*;
   - an AI explanation per hook on demand.
9. **Chip** (FR-012): `AgentInfo.folderRules` makes the mode chip read "Read-only + folder rules".
10. Tests, simulator driver and screenshots at both sizes; README and CHANGELOG.
