# Implementation Plan: Files view and image preview (spec 105)

**Branch**: `005-design-sweep-specs` (spec, #1014) | **Date**: 2026-11-02 | **Spec**: [spec.md](spec.md)

## Technical context

Main: `src/main/files.ts` (new) and one image channel. Renderer: plain JS; a lazy bundled `vendor/codemirror.js`. Dependencies, only from F2: `@codemirror/*` (MIT, pinned), devDependency `esbuild`, not shipped. Nothing new in F0, F1. Order among all sweep work: [spec 005's plan table](../005-chat-fullscreen-and-agent-strip/plan.md).

## Phases (one small PR each; line counts are estimates)

| Phase | PR | Tasks | Size | Gate | Net |
|---|---|---|---|---|---|
| F0 | Image preview | T001 | About 250 lines | None past D1 and K2; **first, on its own** | No |
| F1 | List and plain view: safety first, `<pre>` with line numbers | T002 | About 380 lines | The rail's PRs (owner's order) | No |
| F2 | CodeMirror for the viewer, lazy; full-screen and collapse | T003 | About 120 lines and a 25-line build step | F1; dependency review | No |
| F3 | Quick edit: hash check, conflict, atomic write | T004 | About 220 lines | F2; sensitive review | Lifts shared code; no |
| F4 | An agent changes the open file; docs | T005 | Small | F3 | No |

## Existing capability check (spec 021 FR-031)

`ipcHandle`, `ownedAgent` (#976), `resolveWorkspaceCwd`, `isInsideRoots`, `readCapped`, `notesfile.ts` and `checkpoints.ts` writes, `simpleDiff`, `EditInfo`, `openInVSCode`, `marked` and DOMPurify, `DurbarDialog`, `#notesDrawer`, `sniffImage`, `maskTokenShapes`, `morphHTML`. No read-only file channel exists today, so three are new.

## Constitution check

I: spec first. II: no adapter types; `EditInfo` is normalized. III: safe by default: read-only view, confinement in main, no MCP, no secrets opened or logged; **a new write path is the largest risk, so it takes the three-agent treatment.** IV: simulator only. V: 10.5 px floor and both sizes; push, no cover. VI: FR-021, with a real Windows and macOS run a `[KNOWN GAP]`. VII: drivers and mutations. VIII: every estimate says so.

## Risks

A write path from the window (FR-019, FR-020, FR-023, FR-027, FR-028; a compromised renderer is assumed); opening a file with the system (FR-007); a dependency family and a build step (pinned, reviewed, `test:supplychain`); image bombs (FR-002); a 547 KB parse at first open, unmeasured in Electron; Windows path cases; forced colours in a contenteditable editor.
