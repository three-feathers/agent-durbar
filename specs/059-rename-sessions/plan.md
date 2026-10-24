# Implementation Plan: Rename sessions

**Branch**: `059-rename-sessions` | **Date**: 2026-10-20 | **Spec**: [spec.md](spec.md) | **Research**: [research.md](research.md)
**Input**: Feature specification from `specs/059-rename-sessions/spec.md` (issue #372). The owner answered Q1-Q9 on 2026-10-20 (all A,
spec.md *Clarifications*); changed 2026-10-20 (spec.md *Changes*): Q2 is B (Copilot resumes a stored session without a prompt), Claude uses `--name`
at the next launch (capability `'next-turn'`, entry flag `pending`), the dialog says the name may sync, and an escaping test covers every surface.

## Summary

A user name per session, kept in Durbar's folder store and, where the agent app has an API, also written there (Copilot and Codex now, Claude at its next launch,
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
                                    (FR-011); renameTarget(cap) -> 'now' | 'next-turn' | 'durbar' (FR-007); (no cut rule of its own: the renderer's `SN().shortName` calls `cuttext.js`, spec 044 FR-021).
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
src/adapters/fake.ts                option renameSession: 'any' | 'next-turn' | undefined, call log, failure switch.
src/shared/api.ts, src/preload/preload.ts   renameSession bridge, ResumeResult/AgentInfo.alias, listPrevious `names`.
src/renderer/dialog.js              input.submitOnEnter (Enter in the field activates the primary button).
src/renderer/app.js                 renameSessionUi(a | prevRow, opener); items in More menu, card menu and Previous ⋯ menu; applyTitle
                                    honours alias; tooltips without the runtime title when aliased; Schedules option/list use the
                                    display name (FR-008); search over names (FR-009).
src/renderer/modelswitch.js         cardMenuActions(a, caps).rename
src/renderer/sim.ts                 renameSession in memory, kinds with 'any', 'next-turn' and none, failure hook (FR-015).
scripts/test-names.ts          NEW  rule table; floors tests still pass.
scripts/test-sessionname.ts    NEW  displayNameOf / syncEntry / renameTarget / shortName.
scripts/test-folders.ts             sessionNames parse, set, reset, cap, drop with folder.
scripts/test-sessionnames.ts   NEW  renameOp with FakeAdapter: own session, previous row, not in folder, bad name, reset, app ok, app
                                    error -> Durbar-only + note, Copilot-style non-live resume failure, 'next-turn' pending, in flight.
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
- **Phase 2 (US2):** the app-side rename for Copilot and Codex (any) and Claude (next-turn), the dialog's "where it goes" line, partial results.
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

## Rename in place (delta 2026-10-23, issue #636, FR-020..FR-027)

Decisions D1..D9 are in spec.md *Changes* (coordinator, under Ruben's delegation). No main, preload, shared, adapter or store change: the
work is renderer-only, plus tests, drivers, docs and screenshots.

### Existing code reused (AGENTS.md "Look for an existing capability first")

- Save logic: `renameSessionUi` (`src/renderer/app.js:4370`) and `renameFolder` (`app.js:5469`). Each is split into a *submit* part
  (`submitSessionName(a, prev, text, o)` → the `bridge.renameSession` call, the rule-reason regex, `a.alias` + `repaintName` / `o.onDone`,
  announcements and toasts; `submitFolderName(r, text)` → `bridge.renameFolder`, `r.name`, `renderFilter/renderFolders/scheduleRender`, the
  panel refresh) and the dialog loop that calls it. The inline field calls the same submit parts. No copy of the rule: the session pre-check
  is `SN().nameError` (`src/renderer/sessionname.js`), as the dialog's `input.check`.
- Who may rename: `canRenameSession` (`app.js:4368`); folders: the guards of `renameFolder` / `openFolderMenu` (`bridge.renameFolder`,
  `!demoOn`, a main agent in the room).
- Names and tooltips: `repaintName` (`app.js:4092`), `nameTipAttr` (`app.js:703`), `SN().nameTip`.
- Previous rows: `renamePrevRow` (`app.js:5534`) keeps its `onDone`; the row pencil calls the inline helper with the same `prev` object.
- Focus return after a re-render: `refocusAnchor` (`app.js:4396`) and the keys `renderAll` already uses (`data-id`, `data-door`, `data-pk`).
- IME guard: the same `e.isComposing` test as `dialog.js:48`.

### New module `src/renderer/inlinename.js` (window.DurbarInlineName; module.exports in Node)

- **Pure part** (unit-tested, no DOM): `keyAction(e)` → `'save' | 'cancel' | 'tab' | null` (`null` while `isComposing` or `keyCode===229`);
  `pasteText(s)` → CR/LF/CRLF/TAB to one space each; `outcome(prefill, text)` → `'same' | 'reset' | 'save'` (whitespace collapse and trim,
  as `cleanDisplayName`); `blurAction(windowHasFocus, ruleError)` → `'keep' | 'save' | 'revert'`.
- **DOM part** `open({doc, anchor, value, max, label, hint, check, submit, onClose, reanchor})`: one `<input type="text">` in a fixed
  layer appended to `document.body` (like `#modeMenu`), placed over `anchor.getBoundingClientRect()` with the anchor's computed font size,
  weight and line height; width = max(anchor box, 120px) clipped to the item's inner box. It is **not** inside the card, row or heading,
  so `morphHTML`, the list's `innerHTML` and `repaintName` cannot remove it or overwrite its value (FR-023 item 5). `reanchor()` returns the
  current name element (found by key) or `null`; the app calls `DurbarInlineName.follow()` at the end of `renderAll`, `renderPrev`,
  `renderFolders`, on `resize` and on the floor's `scroll`: a new box moves the field, `null` closes it (FR-023 items 4 and 5).
  Keydown on the field calls `stopPropagation()` for Esc/Enter/Tab/F2 so the global handler (`app.js:2322`, Esc closes the chat) never
  sees them. One instance at a time (FR-021 item 10). Error line: a `<p role="alert">` under the field (12px, theme tokens).
- Why a layer over the name and not an input inside it: the desk card and list row are `<button>`s (an input inside a button is invalid
  and gets the button's click), and the office morphs and the list is rebuilt on every status tick.

### Markup changes in `app.js` and `styles.css`

- Header (`openPanel`, `app.js:1877`): `<h2 id="panelTitle" tabindex="-1" aria-label="<name>">` holds `<button type="button"
  class="ttl-btn" id="panelTitleBtn" aria-label="Rename session <name>">name</button>` when `canRenameSession`, plain text otherwise
  (helpers). `repaintName` updates the button's text and both labels, never an open field. Keydown F2/Enter on `#panelTitle` or the button
  opens the field; the click guard of FR-020 item 1 (`e.detail>1`, 400 ms after `openPanel`).
- Desk card (`cardHTML` `app.js:864`, `unitHTML` `app.js:879`): a `<button class="ren" data-ren="<id>">` after the desk button inside `.unit`,
  absolutely positioned at the name's line end per density (CSS per `[data-d]`), shown on `.unit:hover`, `.unit:focus-within`,
  `@media (hover:none)`. The delegated click handler (`app.js:2260-2273`) checks `[data-ren]` before `[data-id]`. `morphChildren` keeps it
  (keyed by `data-key="ren:<id>"`).
- List row (`renderList`, `app.js:1412`): each row in `<div class="lrow-w" data-key>` with the row button and two positioned pencils
  (session name cell, Folder cell). Check that `#list button.lrow` J/K (`app.js:2333`), `shots-034-list` and `check-office` selectors still
  match; any `.list-wrap>.lrow` CSS selector is updated.
- Previous row (`prevRow`, `app.js:5572`): an in-flow pencil after `.prev-t` for `g==='cli'` rows.
- Room header (`roomHTML`, `app.js:1080`, head at 1085): an in-flow pencil after `.room-name`; Folders panel rows (`renderFolders`, `app.js:5438`): after
  the `<b>` name.
- F2 (global keydown, `app.js:2281`): on `[data-id]` (desk, list row), `[data-door]`, `[data-foldermenu]`, `#panelTitle` and inside a
  `.prev-row`; not under `modalOpen()`, not in a field. Shortcut sheet row (`openKbdHelp`, `app.js:2722`).
- Icon: a new `ICON('rename')` SVG (pencil with a baseline) so it does not read as the draft mark (`draftHTML` uses `ICON('edit')`);
  final glyph is open question Q-A below.

### Simulator hooks (`src/renderer/sim.ts`, `app.js` `__durbarSimUi`; simulator only)

- `__durbarSimRetitle(title, alias)` exists (late title on the open chat, `app.js:4101`); add `retitle(id, title)` for any agent so a
  card or row edit can get one.
- `renamedElsewhere(id, alias)` → `onAgentRenamed` (the `agents:renamed` path).
- `renameRoomElsewhere(roomId, label)` → sets `r.name` and re-renders, as another path would (FR-023 item 2).
- `endAgent(id)` and `removeAgent(id)` → the existing `emit` status path and `removeLiveAgent` (FR-023 items 3 and 4).
- `inline()` → `{open, value, anchorKey, error, busy}` of the open field, for drivers.
- The fake bridge's `renameSession` / `renameFolder` (`sim.ts:2376-2387`) get a call counter so a driver can assert "no call".

### Checks

- `scripts/test-inlinename.ts` (`test:inlinename`, in `npm test`): `keyAction` (Enter, Esc, Tab, F2, composing Enter, keyCode 229),
  `pasteText` (LF, CRLF, CR, TAB, U+2028 left alone), `outcome` (same with extra spaces, empty, spaces only, new), `blurAction`. Mutation
  ideas: drop the `isComposing` test; make `pasteText` delete instead of replace; make `outcome` compare without trim → each must fail.
- `scripts/test-sessionname.ts` (extend): the template guard covers the new `aria-label`s ("Rename session <name>") with `esc()`.
- `scripts/check-rename-inline.js` (`npm run check:rename-inline`, added to `DRIVERS` in `scripts/ui-suite.js`), 1440x900 and 1280x800,
  Expert and Simple: every FR-020 surface (header click, F2, Enter on focused title; card pencil and F2 at full and mini density; list row
  pencil and F2; Previous row pencil, hidden row; room header, Folders panel, list Folder cell; closed-room plate F2); every FR-021 item
  (Enter, blur, window blur, Tab, Esc not closing the chat, unchanged = 0 calls, empty reset, rule error on Enter and on blur, composing
  Enter via `KeyboardEvent({isComposing:true})`, paste via a synthetic `paste` event with `DataTransfer`, busy, two edits); every FR-023
  item through the hooks; no pencil on helpers, VS Code rows, demo; the card / header / row / room header box is the same before and while
  editing (D8, `getBoundingClientRect` equal); the field's computed font size ≥ 10.5px; the escaped `EVIL` name of `check-rename.js` in the
  field and the labels; the header's `-webkit-app-region` is not `drag` with `data-platform="darwin"`. A miss prints `DRIVER FAILED`.
  Mutation ideas for the review: remove the `stopPropagation` on Esc (the chat closes); render the input inside `.name` (a status tick
  removes it); drop the `detail>1` guard (a double-click on a desk edits the header); call submit on unchanged text (the call counter
  fails); `visibility:hidden` on the pencil (Tab skips it).
- `check:ui-text` (`scripts/check-ui-text.js`): a surface `rename-inline` with the field open on the header and on a card with
  `simnames=long`, so the existing rules run on it (10.5px, clipped text, tooltip lengths: the pencil's 120, the header's data tooltip 300);
  one new rule `inline-edit-fit`: the field is inside the window and inside the item's box, and opening it moved no box.
- `npm run check:office` (15 agents, `simnames=long`) with every pencil forced visible (a sim query `simrenshow=1` or a class on `body`):
  no overlap with status, pill, badge, chat number, draft mark; office fits. Also `npm run check:rename` must still pass (dialog paths).
- `npm run typecheck && npm run build && npm test`.

### Screenshots

- New, made by `check-rename-inline.js` with `OUT=docs/screenshots`: `059-rename-inline-header-{1440x900,1280x800}.png`,
  `059-rename-inline-card-…`, `059-rename-inline-prev-…`, `059-rename-inline-folder-…` (the field open, 15 agents). Linked from the spec;
  if one goes into the README or the gallery, its driver is added to `DOC_SHOTS` in `scripts/shots-docs.js`.
- Linked pictures that may change (from `node scripts/shots-docs.js --list`, 2026-10-23): the header button and the pencils are invisible
  until hover or focus, so most pictures do not change; those that show a focused or hovered card, a chat header or a Previous row are
  retaken and looked at: `shots-hero` (`m6-fullchat-sim15-1280x800.png`), `shots-003-011` (`m6-fullchat-sim15-1440x900.png`),
  `shots-005-cardmenu`, `shots-006-prevmarks`, `shots-052-ux`, `shots-074-navigator`:
  `npm run shots:docs -- --only shots-hero,shots-003-011,shots-005-cardmenu,shots-006-prevmarks,shots-052-ux,shots-074-navigator`.
  Commit only the ones that differ; say in the PR which did not change.

### Constitution check (delta)

I spec first (this delta, spec-only commit before `src/`). II no adapter or IPC change. III no new IPC, main still validates, names escaped.
IV simulator and unit tests only, 0 credits. V no layout change, 10.5px floor, no emoji glyph, keyboard and screen-reader paths. VI no
OS-specific code; the macOS drag region is checked in the simulator only (`[KNOWN GAP]` on a real Mac and on Windows). VII tests,
driver, screenshots. VIII the spec says `[KNOWN GAP]` until built.

### Questions decided by the coordinator (2026-10-23, under Ruben's delegation)

- **Q-A** A distinct "rename" glyph (pencil over a baseline) for the button; the draft mark (`ICON('edit')`) stays unchanged.
- **Q-B** Folders panel rows and the folder name on the floor only. The list view's Folder cell gets no pencil (it repeats on every row of
  the folder and would put two pencils on one focused row); its folder is renamed from the Folders panel, the floor or the menu.

### Built 2026-10-24 (what differs from the plan above; accepted by the coordinator)

- **Pencil placement is JS, not CSS per density** (`placeRen`, `app.js`): the name's end differs by density, role visibility and status words, so no CSS offset can promise no overlap. The pencil goes after the name and the mode icon; when that would cover the status word, pill, badge, chat number, draft mark or a header chip, and the name is long enough (48px), it sits over the tail of the name. The role text is not protected (a short name keeps the pencil beside it, so a click on a short name never lands on the pencil). It is re-placed at the end of `renderAll`, `renderList` and `relayout`, because the morph strips inline styles. In-flow pencils (Folders panel row, Previous sessions row) need no placement.
- **`reanchor()` contract:** an Element, `null` (not on screen: save as blur does) or `'gone'` (the item left the window: close without saving, then `focusAfterGone` keeps focus on a real control). `submit(text)` resolves `{ok, reason?}`; a blur or Tab save does not wait (the field closes at once and a refusal comes as the "Not renamed: ..." toast).
- **The text sent is trimmed** (`norm`): "Billing\nrefactor\r\n" saves as "Billing refactor" (scenario 10).
- **A sibling CSS rule** `.stage[data-d="full"] .liveside+.helpers{margin-left:0}` stopped matching once the pencil sat between them (a real 2px overlap in `check:office` "long names sim3"); the rule now also lists `.liveside+.ren+.helpers`.
- **Room header and Folders panel pencils:** `data-renfolder`, the room header one placed like a card's, against `b.offsetParent` (the room: `.room-head` is deliberately NOT positioned, because the room plant is placed against the room and a positioned header moved it 6px), the Folders panel and Previous sessions row ones in the flow (`.ren-in`, `data-renprev` for rows). `startFolderEdit` / `startSessionEdit(a, 'prev', ...)` share `submitFolderName` / `submitSessionName` with the dialogs; `prevRenameArgs` is shared by `renamePrevRow` and the inline edit.
- **Simulator hooks** in `__durbarSimUi`: `retitle`, `renamedElsewhere`, `renameRoomElsewhere`, `endAgent`, `removeAgent`, `hidePrev`, `inline`; `window.__simRenameCalls` (every `renameSession` / `renameFolder` call) in `sim.ts`.
- **Checks:** `check-rename-inline.js` runs the click that opens a chat and the header click in ONE page call (a round trip under load takes longer than the 400 ms guard). The `check:ui-text` rule `inline-edit-fit` is `__uitext.inlineFit()` (inside the window, inside its item, at least 10.5px, no box moved); `check:office` forces `body.ren-show` and checks every pencil.
- **Not done / not driven:** see the evidence list in spec.md (dialog over the field, folder removed or hidden, demo, real Mac).
- **Review of #636 (2026-10-24):** a field still saving (Enter in flight) when another edit opens loses its field at once (`open()` closes it after `commit('switch')`), so only one field is on screen and its late answer cannot take focus back; the field fills the item's free inner width (`o.fill`, `o.maxWidth` 480, 360 for list rows and rooms; `o.grow:false` and the `.prev-tx` clip for Previous rows so it never covers the date line); the pencil's box is 24x24 with a 16px glyph (padding and `background-clip:content-box`), `placeRen` offsets by the padding, and `check:office` judges overlap on the glyph and requires the 24px box; hooks `removeRoom` and `hideRoom` drive FR-023 item 4 for folders.
