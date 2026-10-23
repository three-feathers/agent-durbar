# Implementation Plan: Keyboard navigator

**Branch**: `074-keyboard-navigator` | **Date**: 2026-10-22 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/074-keyboard-navigator/spec.md` (issue #548)

## Summary

A configurable shortcut (default Ctrl+J / ⌘J) opens the existing command palette in a "Go to" mode with levels (start, folders, agents, chats). The level logic, the input parsing (`f `, `c3`), the matching, the chat numbering and the shortcut handling (record, match, clash check) live in one new pure renderer module, `navigator.js`, unit-tested in Node. `app.js` only wires it: the palette paints the current level, picks open chats through `openPanel` and focus the message box; chat-number badges are added to desk cards, list rows and the chat header; Settings gets a Keyboard section.

## Decision: extend the palette, not a second box (issue #548 asks for this decision)

| Option | For | Against |
| --- | --- | --- |
| **A. Palette in a "Go to" mode (chosen)** | One dialog: the same focus trap, combobox/listbox ARIA, live count, focus return, look and theme tokens (spec 052 FR-042 already reviewed for accessibility). One place for keys. Ctrl+K gets a "Go to…" action and the navigator shortcut inside Ctrl+K switches modes, so they feel like one tool. | The palette's paint and key handler need a mode switch (small). |
| B. A second, separate box | Free to design | Two overlapping dialogs with the same job, two focus traps and two key sets to keep in step: exactly what AGENTS.md *Look for an existing capability first* forbids. |
| C. Prefixes only inside Ctrl+K (`f `, `c 3` typed into the mixed search) | No new shortcut | Ctrl+K's empty state is "Recent + Agents + Folders + Actions", not a step-by-step path; the floor step would be lost, and the issue asks for its own configurable shortcut. The prefixes are still accepted in Go-to mode (FR-004). |

Existing code reused: `openPalette`/`palPaint`/`palSetActive`/`closePalette` (palette), `palFilter`'s matching (moved into `navigator.js` as `rank`, used by both), `openPanel` (opening a chat), `roomsInOrder`/`roomShown`/`floorsOnList` (spec 033 floors), `KEYS.keyLabels`/`modDown` (FR-084 labels), `openKbdHelp` (the `?` sheet), the Settings screen sections and `localStorage` preferences (like the detail level), `announce` (live region).

## Technical Context

**Language/Version**: TypeScript 5 (main, tests), plain JavaScript in the renderer (no bundler)
**Primary Dependencies**: Electron (existing); no new dependency
**Storage**: the window's `localStorage`: `durbar.navKey` (the shortcut) and `durbar.chatNo` (session id → number; ids only). Not used in the simulator or demo.
**Testing**: `scripts/test-navigator.ts` (Node, pure module); simulator driver `scripts/shots-074-navigator.js` (asserting, in `scripts/ui-suite.js`); `check-office-overlap` for the badges
**Target Platform**: Windows, macOS, Linux (Electron)
**Project Type**: desktop app
**Performance Goals**: the box paints a level in one frame for 15-200 sessions (a filter over at most a few hundred items)
**Constraints**: 10.5px text floor; 15 agents fit at 1440x900 and 1280x800; no AI credits
**Scale/Scope**: renderer only; no IPC, no main-process change

## Constitution Check

| Principle | Check |
| --- | --- |
| I Spec Kit | spec, plan, tasks before code; this PR carries them |
| II Adapters | renderer-only; no vendor types; works for every agent app because it only opens chats |
| III Safe by default | nothing is sent by the navigator; Enter in the composer uses the existing send path with the session's mode and limit (FR-010); no new approval path; saved data is ids and a key combination only |
| IV No credits | simulator and unit tests only |
| V Calm UI | badges are text "C3" ≥ 10.5px; layout re-checked with 15 agents at both sizes; motion none |
| VI Parity | ⌘ on a Mac through `keys.js`; keys matched by `code`; clash list per OS in a pure function with the platform passed in |
| VII Quality | unit tests, asserting driver, screenshots at both sizes |
| VIII Honest limits | macOS and Windows key behaviour unit-tested and in CI drivers only; OS-shortcut list is a known list, not exhaustive (said in Settings and README) |

No violations; Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/074-keyboard-navigator/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/keys.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
src/renderer/navigator.js   new, pure (UMD like keys.js): levels, parse, rank, chat numbers, shortcut combo + clash check
src/renderer/index.html     loads navigator.js before app.js
scripts/copy-assets.js      copies navigator.js
src/renderer/app.js         palette Go-to mode, shortcut handler, badges (card, list, header), palette action, ? sheet rows, Settings hooks
src/renderer/screens.js     Settings > Keyboard section (record, reset, clash message)
src/renderer/styles.css     .chatno badge, breadcrumb line, Keyboard section
scripts/test-navigator.ts   unit tests
scripts/shots-074-navigator.js  asserting simulator driver + screenshots
scripts/ui-suite.js         lists the new driver
package.json                test:navigator in test:serial
```

### Follow-up 2026-10-23 (issue #587)

Same files, no new module: `navigator.js` gets the new default (`KeyF`), `textSafeKey` (the pure rule for Ctrl+A and Ctrl+Backspace: which action, or none when focus is in text, text is selected, a dialog is open, or attachments wait) and two `TAKEN` entries; `app.js` gets one `focusComposer` helper used by every user open, the per-chat unsent text (`DRAFTS`, memory only) and the handler lines that call `textSafeKey`; `index.html` (Needs you tooltip), `screens.js` (Settings note) and the `?` sheet show the keys. Tests first: unit cases in `test-navigator.ts`, real key presses in `shots-074-navigator.js`.

## Complexity Tracking

None.
