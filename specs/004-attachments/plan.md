# Implementation Plan (as built): Attachments

**Spec**: [spec.md](spec.md) | **Date**: 2026-10-16 | **Kind**: reverse-engineered

## Summary

Pure staging/validation code in `src/shared/attachments.ts` (no Electron import, unit tested) is used by the main process; the renderer duplicates the two caps for instant feedback; `CopilotAdapter.send` converts attachments into SDK `blob`/`file` entries.

## Technical Context

- **Language**: TypeScript (shared + main), JS (renderer `gate`, `addPicked`, `addFiles`, `renderAttached`).
- **Testing**: `npm run test:attachments` (`scripts/test-attachments.ts`): sniffing, sanitizing, staging, traversal, caps, empty file. E2E driver phase `m5` (no credits) covers drop/paste/IPC on Linux.
- **Constraints**: no new dependency; files never leave the machine except to the runtime.

## Constitution Check

| Principle | Result |
| --- | --- |
| III Safe by default | Path whitelist, magic-byte check, sanitized names, private temp folder. Gaps FR-009..015 are minor. OK |
| IV No credits | Staging logic is tested without Copilot. OK |
| V Calm UI | Messages are short, stay until the next action, overlay is a quiet tint. OK (`sim:`) |
| VI Parity | Pure Node `path`/`fs`; file modes (0700/0600) have no effect on Windows. **Partial** |

## As-built architecture

```text
Renderer: picker button -> bridge.pickAttachments() -> main dialog (or DURBAR_PICK) -> pickedFiles.add(path) -> PickedFile[]
          drop / paste  -> File.arrayBuffer() -> bridge.stageAttachment(name, mime, bytes) -> main: stageAttachment(tmpdir, ...) -> pickedFiles.add(staged path)
          send          -> bridge.send(id, text, PickedFile[]) -> main: filter to pickedFiles, re-check count/size, ensureLive, adapter.send
CopilotAdapter.send: image (ext in IMAGE_MIME) -> {type:'blob', data: base64, mimeType, displayName}; else {type:'file', path, displayName}
```

Files: `src/shared/attachments.ts`, `src/main/main.ts` (`agents:pickAttachments`, `agents:stageAttachment`, `agents:send`, stage dir lifecycle), `src/adapters/copilot.ts` (`send`), `src/renderer/app.js` (UI), `src/renderer/sim.ts` (sim `stageAttachment`).

## Project Structure (documentation)

```text
specs/004-attachments/
├── spec.md
├── plan.md
└── tasks.md
```

## Verification status

| Claim | How | Result |
| --- | --- | --- |
| Sniffing, sanitizing, traversal, caps, empty file | `npm run test:attachments` | pass 2026-10-16 |
| File + PNG reach the model and are described | README m3 real session | `real:` recorded |
| Drop/paste through real main IPC, cap messages, overlay | e2e driver `PHASES=m5`, screenshots | `sim:` recorded, not re-run |
| macOS/Windows | none | untested |
