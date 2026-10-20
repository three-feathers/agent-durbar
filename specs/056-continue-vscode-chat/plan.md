# Implementation Plan: Continue a VS Code chat in Durbar

**Branch**: `056-continue-vscode-chat` | **Date**: 2026-10-20 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/056-continue-vscode-chat/spec.md` (issue #344)

## Summary

Add **Continue in Durbar…** to the read-only VS Code chat view (and, P3, to its Previous sessions row). It opens a dialog like New session (ready agent apps only, Read-only preselected), then a review box with a first message built **in the main process** from the existing reader's transcript: a header, the newest turns that fit under a 30,000 estimated-token cap (characters ÷ 4), placeholders for attachments and tools, all passed through `redact()`. The user edits it, picks turns, sees a size and a cost line in the chosen app's unit, and presses Start; main redacts the final text again, then the existing `agents:newSession` + first-message path (spec 030 FR-036) starts the session. Nothing is written outside Durbar. Option B (summarise first) is parked by the owner (Q8). All owner questions (Q1-Q9) are answered; see the spec's *Clarifications*. Details and code references: [research.md](research.md); shapes: [data-model.md](data-model.md); checks: [quickstart.md](quickstart.md).

## Technical Context

**Language/Version**: TypeScript (main, shared, adapters), plain JS renderer (`src/renderer/*.js`), Electron as pinned in `package.json`.
**Primary Dependencies**: none new. Node `fs/promises` (read only) through the existing reader.
**Storage**: none new. Nothing persisted; the VS Code chat file is only read.
**Testing**: `scripts/test-chatcontext.ts` (new suite `test:chatcontext`, added to `test:serial` in `package.json`), extended `scripts/test-vscodechat.ts` and `scripts/test-modelswitch.ts`; simulator driver `scripts/shots-056-continue.js`; `npm run check:office`.
**Target Platform**: Windows, macOS, Linux desktop (Electron).
**Project Type**: desktop app.
**Performance Goals**: draft built in under 200 ms for a capped transcript (≤ 1.5 M characters); the picker rebuild feels immediate.
**Constraints**: no AI credits in tests; no writes outside Durbar's own state; renderer never sees a path or unredacted chat text; 10.5px minimum; office unaffected.
**Scale/Scope**: one chat at a time; at most 300 turns (the reader's cap).

## Constitution Check

| Principle | How this plan complies | Result |
| --- | --- | --- |
| I Spec Kit | Spec, plan, tasks in this folder before any `src/` change; spec 009 gets a cross-reference under `## Changes` (FR-018 answered). | OK |
| II Adapters are plug-ins | No adapter change in Phases 1-2. The draft is plain text; the new session uses the existing `agents:newSession` and `send`. Cost units come from capabilities (`capUnit`, `usage`), not vendor names. Phase 3 uses the existing optional `generateText`. | OK |
| III Safe by default, no secrets | Read-only preselected; opaque keys over IPC; untrusted chat parsed in main with the reader's caps; `redact()` before display and before sending; no content logged; nothing written to VS Code, `~/.copilot`, `~/.claude`, `~/.codex`; quoted with "record, not instructions" delimiters. The chat file is never uploaded; only the text the user reviewed and confirmed is sent as their own message (spec FR-013a; the owner accepted this reading of "never uploaded", Q9; recorded in spec 009, no constitution change). | OK |
| IV No credits in tests | Unit tests on synthetic fixtures and simulator only. Phase 3 is parked (Q8); the real check is a separate task that needs the owner's go-ahead. | OK |
| V Calm, legible UI | Overlay dialogs reuse existing dialog styles; 10.5px floor; screenshots at 1440x900 and 1280x800; `check:office` unchanged; no colour-only state; Escape closes; live region for warnings. | OK |
| VI Parity | Reader locations unchanged (spec 009 FR-004); the header uses the agent's path string; tests cover `win32` and `posix` folder strings with injected platform. On-device only Linux. | Partial (as every feature: macOS/Windows by CI) |
| VII Quality gates | New logic in the VS Code reader and the new pure module has tests in `scripts/`; screenshots; docs updated. | OK |
| VIII Honest limits | Estimates labelled; no cost figure from unverified prices (owner, Q7) and no Claude dollar figure before sending (owner, Q2); `[KNOWN GAP]` for real stores and sessions, Codex extra folders; README states it. | OK |

## Design

### Main process

1. **Reader** (`src/adapters/vscodeChat.ts`): keep the matched folder (`folder` / `workspace`) on `ChatStore` and copy it to `ChatFileRef.folder`; add `file` to `tool` blocks made from `textEditGroup`. No change to what the view shows.
2. **Pure module** `src/shared/chatcontext.ts` (no Node imports; uses `redact` from `./redact`):
   - `estimateTokens(text) = Math.ceil(text.length / 4)`; `CONTEXT_CAP_TOKENS = 30_000`; `TEXT_CUT = 8_000`; `TOOLS_PER_TURN = 20`; `FILES_IN_HEADER = 30`; `MAX_FINAL_CHARS = 400_000`.
   - `turnsOf(transcript): ContextTurn[]` (grouping, placeholders, cuts).
   - `selectTurns(turns, select, cap): { included: number[], left: number }` (newest that fit; a lone oversized newest turn is cut further to fit).
   - `buildDraft(transcript, meta: { folder, title }, select, opts: { cap, contextWindow? }): ContextDraft` (header, delimiters, closing line, redaction and its count = occurrences of `[redacted` after minus before).
   - `finalizeText(text): FinalizeResult` (type and size checks, `redact`, `changed`).
3. **IPC** in `src/main/main.ts` next to `vschat:read`:
   - `vschat:draft(id, key, select, contextWindow)`: resolves the ref from `vsChatRefs`, `readChat(ref)`, `buildDraft`; never logs content; returns `{ ok:false, error }` for a missing ref, a vanished agent ("This folder is no longer in Durbar. Add it again, then continue the chat.") or an unreadable file.
   - `vschat:finalize(text)`: `finalizeText`.
   - Both through `ipcHandle` (sender checks of spec 045); inputs validated as in [data-model.md](data-model.md).
4. **Preload / API**: `vschatDraft`, `vschatFinalize` in `src/preload/preload.ts` and the `DurbarApi` type in `src/shared/api.ts` (`ContextDraft`, `FinalizeResult` types exported from `src/shared/chatcontext.ts`).

### Renderer (`src/renderer/app.js`, `modelswitch.js`, `styles.css`, `sim.ts`)

5. **Entry points**: *Continue in Durbar…* in the `.vsbar` of `viewVs` (and P3, *Continue…* in `prevListsHtml` rows, `data-pv="continue"`); banner and group-header wording (FR-001).
6. **Options step**: reuse `newSession(a, o)` with `o.vsChat = { key, title }`: title "Continue a VS Code chat in *folder*", Read-only preselected, no summary checkbox, primary button *Next: review the message*; `kindChoices` for ready apps; none ready → message + *Open Settings > Agent apps* (`DurbarScreens.openSettings('harnesses')`).
7. **Review step**: generalise `reviewHandoff` into a review box that optionally carries the turn list, the warning, the estimate line and *Newest that fit* / *All*; picker changes call `vschatDraft` again (confirm first if the text was edited); a live `ceil(len/4)` counter while typing; Start calls `vschatFinalize`; `changed` → show the masked text with a note and stay; else `bridge.newSession(a.id, opts)` then `sendLive(text, newId)`, then the "Started from a copy…" note. The model's `contextWindow` comes from the existing model list (`windowOf`).
7a. **Sign-in** (review note on PR #347, spec FR-004a): the options step reads each app's sign-in state from the adapter list (spec 012 FR-156, `withSignIn`; kept fresh by `adapters:changed`). A *Not signed in* app offers **Sign in** (`DurbarHarnesses.signIn(kind, name)`, the same in-app flow as the FR-157 chat card) and **Open Settings > Agent apps**, and cannot go to Next until signed in. If the first message comes back as an `error` with `errorKind: 'auth'`, the new chat shows the FR-157 card; the continue flow keeps the full reviewed text in a renderer variable (memory only) until the first message is accepted, because `src/renderer/signin.js` keeps at most `MAX_TEXT` = 100,000 characters per prompt and a draft near the 30,000-token cap can be about 120,000. After the sign-in, *Send again* sends that full text (the flow hands it to the resend instead of the truncated memory). Test: the sim `simauth=expired` path in the T017 driver.
7b. **Design rules** (review note on PR #347): the options step and the review box follow `docs/design-rules.md`: `--h-ctl` / `.btn.sm` heights only, radius tokens, theme colour tokens, one primary last with Cancel first in `.dbtn`, `.primary.warn` only for the Allow all confirmation, no `.btn.danger` (nothing is deleted or ended), the shared SVG chevron for the *Details* expander that holds the reader's notes, the turn list's checkboxes with the global `:focus-visible`, sentence case, "…" only on *Continue in Durbar…* and *Continue…*. Monospace for the editable message, as for the summary editor.
8. **Estimate line**: `contextCostLine` in `modelswitch.js` (pure, exported with the others, tested in `test:modelswitch`).
9. **Simple mode**: size as a share of the cap, cost line in words; no token numbers (spec 052 FR-081).
10. **Simulator** (`src/renderer/sim.ts`): canned `vschatDraft` (builds a small draft from the canned transcript with the same turn shapes; the over-cap warning on the 346-message chat) and `vschatFinalize` (masks a planted `ghp_` token to exercise `changed`).

### Phase 3 (parked by the owner, Q8; not planned)

11. *Summarise first* in the review box: `generateText` of the chosen app via a new IPC that sends only the selected, redacted turns with a fixed prompt (like `HANDOFF_PROMPT`), `cleanSummary`, cost shown after; spec delta first.

## Project Structure

### Documentation (this feature)

```text
specs/056-continue-vscode-chat/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (files this feature will touch)

```text
src/adapters/vscodeChat.ts       # matched folder on refs, file on edit blocks
src/shared/chatcontext.ts        # new: turns, selection, draft, finalize (pure)
src/shared/api.ts                # DurbarApi: vschatDraft, vschatFinalize
src/main/main.ts                 # IPC vschat:draft, vschat:finalize
src/preload/preload.ts           # bridge entries
src/renderer/app.js              # entry points, options step, review box
src/renderer/modelswitch.js      # contextCostLine (pure)
src/renderer/styles.css          # review box turn list
src/renderer/sim.ts              # canned draft and finalize
scripts/test-chatcontext.ts      # new suite
scripts/test-vscodechat.ts       # reader additions
scripts/test-modelswitch.ts      # estimate line
scripts/shots-056-continue.js    # simulator driver and screenshots
package.json                     # test:chatcontext in test:serial
```

**Structure Decision**: the existing single-project layout; pure logic in `src/shared` so main and tests share it (constitution II, "pure logic stays in dependency-free modules").

## Docs impact (same PR as the code)

README (VS Code section: Continue in Durbar, estimates, not verified on a real store or session; known limits), CHANGELOG *Unreleased*, spec 009 and 006 cross-references, `specs/README.md` row, screenshots `docs/screenshots/056-continue-*.png`, and `docs/site/gallery.json` only if a key screenshot is chosen.

## Complexity Tracking

No violations to justify.
