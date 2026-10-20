# Implementation Plan: Rename sessions

**Branch**: `059-rename-sessions` | **Date**: 2026-10-20 | **Spec**: [spec.md](spec.md) | **Research**: [research.md](research.md)
**Input**: Feature specification from `specs/059-rename-sessions/spec.md` (issue #372). The owner answered Q1-Q9 on 2026-10-20 (all A,
spec.md *Clarifications*); changed 2026-10-20 (spec.md *Changes*): Q2 is B (Copilot resumes a stored session without a prompt), Claude uses `--name`
at the next launch (capability `'next-turn'`, entry flag `pending`), the dialog says the name may sync, and an escaping test covers every surface.

## Summary

A user name per session, kept in Durbar's folder store and, where the agent app has an API, also written there (Copilot live sessions,
Codex threads). One pure module decides the name rule and which name to show; main owns validation, the store and the app call; the
window shows `alias || title || folder label` everywhere it shows `a.name` today, and offers **Rename…** from three menus through one
dialog.

## Technical Context

**Language/Version**: TypeScript (main, adapters, shared), plain JS renderer. **Dependencies**: none new.
**Storage**: `durbar-folders.json` (`FolderStore`, same version), new optional `sessionNames` per folder.
**Testing**: `scripts/test-*.ts` unit tests, adapter fakes, `scripts/test-adapter-contract.ts`, a simulator driver
`scripts/check-rename.js`, `npm run check:office`. **Platforms**: Windows, macOS, Linux (no paths, no shell).
**Constraints**: 0 AI credits; no real store touched in tests; 10.5px floor; 1280x800.

## Constitution Check

| Principle | How this plan holds it |
| --- | --- |
| I Spec Kit | This spec, plan and tasks first; spec-only PR before any `src/` change. |
| II Adapters as plug-ins | `renameSession` capability and member behind `AgentAdapter`; Copilot `rpc.name.set` and Codex `thread/name/set` stay in their adapters; the renderer gets a capability value and words. |
| III Safe, no secrets | Names pass a rule that refuses controls, hidden characters and anything `redact()` changes; ids only plus the user's own short name in the store; no file of another tool is written; main validates every IPC argument and re-checks the session belongs to the folder. |
| IV No credits | Simulator and fakes; `/rename` is never sent (without a name it spends credits); real checks only with the owner's go-ahead (Q9 A). |
| V Calm UI | One dialog, existing menus, no new top-bar control; 60-character cap; ellipsis plus tooltip; `check:office` with long names. |
| VI Parity | Nothing per OS; pure functions tested anywhere. |
| VII Gates | Unit tests for the rule, the store, the decision and both adapters; screenshots at both sizes. |
| VIII Honest limits | VS Code visibility, real app calls and macOS/Windows are `[KNOWN GAP]` until the Q9 check (T050). |

## Project Structure

```text
specs/059-rename-sessions/
├── spec.md  research.md  plan.md  tasks.md
└── checklists/requirements.md
```

### Source code touched (when built)

```text
src/shared/names.ts            NEW  cleanDisplayName(v, max) and nameError(v, max): trim, collapse, length in code points, controls,
                                    hidden characters (moved from floors.ts), redact() check. floors.ts imports it (same behaviour, same tests).
src/shared/sessionname.ts      NEW  displayNameOf(entry, runtimeTitle, folderLabel); syncEntry(entry, runtimeTitle) -> entry | undefined
                                    (FR-011); renameTarget(cap) -> 'now' | 'next-turn' | 'durbar' (FR-007); shortName(name, 40) (spec 044 FR-021).
src/main/folders.ts                 SavedFolder.sessionNames?: Array<{src,id,name,inApp?}>; parseSessionNames (cap 200, tolerant);
                                    FolderStore.setSessionName(key, src, id, name|undefined, inApp), sessionNameOf(key, id), dropSessionName.
src/main/sessionnames.ts       NEW  renameOp(deps)(agentId, sessionId|null, name): validate, decide, call adapter, save, return
                                    (deps injected: agents, router, store, resumeIdFor, previousSessionsOf, inFlight). No Electron.
src/main/main.ts                    ipcHandle('sessions:rename'); AgentInfo.alias on restore/resume/add (FR-014); title handler applies
                                    syncEntry (FR-011); sessions:listPrevious adds `names`; logActivity uses alias when set (FR-012);
                                    broadcast 'agents:renamed'.
src/adapters/capabilities.ts        renameSession?: 'any' | 'next-turn'
src/adapters/types.ts               renameSession?(sessionId, name): Promise<void>
src/adapters/copilot.ts             'any'; live.session.rpc.name.set({ name }); a non-live id: resumeSession (no prompt) + name.set + disconnect; refuses '"'.
src/adapters/claude.ts              'next-turn'; pending name per session, `--name` in claudeArgs, relaunch before the next message, title event after the turn.
src/adapters/codex.ts               'any'; thread/name/set on the live child or on probe(); maps thread/name/updated to a `title` event.
src/adapters/fake.ts                option renameSession: 'live' | 'any' | undefined, call log, failure switch.
src/shared/api.ts, src/preload/preload.ts   renameSession bridge, ResumeResult/AgentInfo.alias, listPrevious `names`.
src/renderer/dialog.js              input.submitOnEnter (Enter in the field activates the primary button).
src/renderer/app.js                 renameSessionUi(a | prevRow, opener); items in More menu, card menu and Previous ⋯ menu; applyTitle
                                    honours alias; tooltips without the runtime title when aliased; Schedules option/list use the
                                    display name (FR-008); search over names (FR-009).
src/renderer/modelswitch.js         cardMenuActions(a, caps).rename
src/renderer/sim.ts                 renameSession in memory, kinds with 'any', 'live' and none, failure hook (FR-015).
scripts/test-names.ts          NEW  rule table; floors tests still pass.
scripts/test-sessionname.ts    NEW  displayNameOf / syncEntry / renameTarget / shortName.
scripts/test-folders.ts             sessionNames parse, set, reset, cap, drop with folder.
scripts/test-sessionnames.ts   NEW  renameOp with FakeAdapter: own session, previous row, not in folder, bad name, reset, app ok, app
                                    error -> Durbar-only + note, 'live' with a non-live session, in flight.
scripts/test-copilot-*.ts, test-codex-adapter.ts   fake session / fake RPC calls.
scripts/test-adapter-contract.ts    C2: member <=> flag.
scripts/check-rename.js        NEW  simulator driver, both sizes, Simple and Expert, every FR-001 surface, screenshots.
```

## Data flow

1. Window: Rename… → `renameSessionUi` computes the "where it goes" line from the agent's capability (`renameTarget(cap)`)
   and the current names, opens `askDialog`, then calls `bridge.renameSession(agentId, sessionId|null, text)`.
2. Main `renameOp`: agent exists; target id = `resumeIdFor(agentId)` or the given id, re-checked against `previousSessionsOf` (same
   adapter, same folder) or another office agent of the folder; `text` empty → reset; else `cleanDisplayName(text, 60)` or error.
   In flight set by id. If `renameTarget` says app: `await adapter.renameSession(id, name)`; error → Durbar-only + note (FR-010).
   Save the entry (`inApp` when the app accepted it). Set `alias` on office agents with that resume id; broadcast `agents:renamed`.
3. Window: on the answer and on `agents:renamed`, set `a.alias`, recompute `a.name = displayNameOf(...)`, re-render; Previous rows
   reload; Schedules list re-renders.
4. Later titles: main's title handler and `applyTitle` call `syncEntry`; an `inApp` entry that no longer matches the app's name is
   dropped in the store and `alias` cleared.

## Phasing

- **Phase 1 (US1, MVP):** Durbar-only names for every app (rule, store, op, dialog, three menus, every surface, schedules, activity).
  Works for all three apps on its own.
- **Phase 2 (US2):** the app-side rename for Copilot (live) and Codex (any), the dialog's "where it goes" line, partial results.
- **Phase 3 (US3):** the Previous sessions row item, after spec 006 T036 (issue #368, PR #373) is merged.
- **Phase 4:** real checks (Q9 A: one per app, 0 prompts), owner-gated, not in CI.
- **Phase 5:** docs and converge.

## Verification plan

`npm run typecheck && npm run build && npm test` (new `test:names`, `test:sessionname`, `test:sessionnames`; extended `test:folders`,
adapter and contract tests, `test:activity`); `npm run check:office` with 60-character names; `node scripts/check-rename.js` at
1440x900 and 1280x800, Simple and Expert; screenshots `docs/screenshots/059-rename-*.png`.

## Complexity Tracking

| Item | Why | Simpler alternative rejected because |
| --- | --- | --- |
| `inApp` flag and sync rule | lets a later rename in the CLI win over a stale Durbar copy, while a Durbar-only name stays put | dropping the local copy after an app rename loses the activity-log name (FR-012) and the instant display |
| Two capability values (`any`, `next-turn`) | Claude applies the name at its next launch, Copilot and Codex now | one boolean would make the dialog promise a rename in Claude that has not happened yet |
