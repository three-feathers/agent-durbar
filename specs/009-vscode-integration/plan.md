# Implementation Plan (as built): VS Code integration

**Spec**: [spec.md](spec.md) | **Date**: 2026-10-16 | **Kind**: reverse-engineered

## Summary

Two independent pieces: `src/main/vscode.ts` (find and spawn VS Code, pure planning with an injected environment) and `src/adapters/vscodeChat.ts` (locate, list, parse and render VS Code chat history as a read-only transcript). Both are wired in `main.ts` by agent id and shown in the chat header and the Previous sessions panel (feature 006).

## Technical Context

- **Language**: TypeScript, Node `fs/path/child_process` only.
- **Testing**: `npm run test:vscode` (launcher), `npm run test:vscodechat` (parser/lister) with synthetic fixtures; CI runs both on three OSes.
- **Constraints**: no shell with user text; no content logging; size caps.

## Constitution Check

| Principle | Result |
| --- | --- |
| III Safe by default | Argv-only spawn, guarded `cmd.exe` exception, opaque keys over IPC, tolerant parsing, read-only copy. OK |
| IV No credits | Entirely credit-free. OK |
| VI Parity | Core of the feature: per-OS discovery, `win32` path logic injected for tests. Real runs only on Linux (and VS Code is not installed there). **Partial** |
| VIII Honest limits | Format note in the UI, README says "documented, not verified end to end". FR-008 contradicts the README. **Partial** |

## As-built architecture

```text
agents:openInVSCode(id) -> agent -> workspaceFile ?? cwd -> openInVSCode(target) -> planVSCodeLaunch(target, env) -> spawn(shell:false, detached)
vschat:list(id)  -> listChats(vsUserDirs(), {folders, workspaceFile}) -> findChatStores (workspace.json match) -> parse -> summaries (+ refs kept per agent)
vschat:read(id,key) -> readChat(ref) -> parseChatText (.jsonl replayLog | .json) -> toTranscript (blocks + notes)
```

`replayLog` applies the append log (kind 0 snapshot, 1 set, 2 push/splice, 3 delete); `toTranscript` joins markdown chunks and inline references, hides reasoning and input state; `plainLinks` neutralises links.

## Project Structure (documentation)

```text
specs/009-vscode-integration/
├── spec.md
├── plan.md
└── tasks.md
```

## Verification status

| Claim | How | Result |
| --- | --- | --- |
| Launch plans for macOS/Windows/Linux, cmd.exe guard | `npm run test:vscode` | pass 2026-10-16 |
| Chat parser/lister on synthetic fixtures | `npm run test:vscodechat` | pass 2026-10-16 |
| Real VS Code launch | none | **not verified** |
| Real VS Code chat stores | none | **not verified** |
| Sessions created here visible in VS Code | VS Code docs only | **not verified** |
