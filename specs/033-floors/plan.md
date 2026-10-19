# Implementation Plan: Floors (groups of rooms you can switch on and off)

**Branch**: `033-floors` | **Date**: 2026-10-17 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/033-floors/spec.md` (clarified 2026-10-17, two sessions)

## Summary

Add floors above rooms: a named, ordered group of folders that can be switched on or off. Floors live in the existing folder file (`durbar-folders.json`) with a `floor` id per folder. The renderer hides an off floor with the same predicate that already hides a hidden folder, so the office, list, filter, strip, status pills and the spec 024 lobby all follow with one change. A top-bar **Floors n/m** button opens a panel to switch, create, rename, reorder, delete and move folders, with an **Only** action. Rooms are ordered by floor and labelled when two or more floors are on. The office credit total keeps counting every floor. Simulator first, 0 AI credits. Details and alternatives: [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript (main, preload, shared, simulator), plain JS/HTML/CSS renderer; Electron (as pinned in `package.json`)

**Primary Dependencies**: none new

**Storage**: `durbar-folders.json` in userData (FolderStore, spec 006), additive fields, `version` stays 1 ([data-model.md](data-model.md))

**Testing**: `npm test` (new `scripts/test-floors.ts`, extended folder-store test), `npm run check:office` (layout with 2 and 3 floors on), simulator driver for screenshots

**Target Platform**: Windows, macOS, Linux (no platform code)

**Project Type**: Electron desktop app

**Performance Goals**: switch/Only re-renders the office in under 0.5 s with 15 simulated agents (SC-003); the existing layout cache key gains the set of floors on

**Constraints**: 10.5px minimum text; 15 agents readable at 1440x900 and 1280x800 with the lobby and floor labels (SC-005); no extra vertical space for labels (FR-012)

**Scale/Scope**: up to 40 floors, 200 folders (existing cap)

## Constitution Check

*GATE: checked before research and again after design. Both pass; no violations.*

| Principle | How this plan complies |
| --- | --- |
| I Spec Kit | Spec and two clarification sessions committed before this plan; tasks next; no `src/` change before tasks are committed. |
| II Adapters are plug-ins | Floors are office data only. No adapter, SDK or vendor event is touched; pure logic in `src/shared/floors.ts`. |
| III Safe by default, no secrets | File holds floor ids, names, on/off and folder paths already stored. IPC input validated in main; folders addressed by agent id. Switching a floor never approves or denies a pending request (FR-010). |
| IV No AI-credit spend | Simulator (`DURBAR_SIM_FLOORS`) and unit tests only; no real session planned. |
| V Calm, legible UI | Labels in existing header line, ≥10.5px, text not colour; `check:office` cases with floors; popover with keyboard focus/Esc like Folders; switches are buttons with `aria-pressed` and On/Off words. |
| VI Parity | No OS paths beyond the existing folder keys; tests run on all three CI runners. |
| VII Quality gates | New tests for the pure module and the store; screenshots at both sizes; README/CHANGELOG/spec index in the same PR. |
| VIII Honest limits | Limits stated: agents on off floors keep spending and waiting silently (user's choice; credit total is the only sign); downgrade drops floors; Tools view not filtered. |

## Project Structure

### Documentation (this feature)

```text
specs/033-floors/
├── spec.md
├── plan.md              # this file
├── research.md          # decisions R1-R10
├── data-model.md        # Floor, folder entry, file shape, operations
├── quickstart.md        # simulator and test validation
├── contracts/
│   └── ipc-floors.md    # preload bridge methods and renderer rules
├── checklists/requirements.md
└── tasks.md             # next: /speckit-tasks
```

### Source Code (files touched)

```text
src/shared/floors.ts          NEW  pure: types, parse, validate, create/rename/reorder/delete/setOn/only/move
src/shared/api.ts                  FloorView, FloorsState, FloorsResult; AgentInfo.floor; DurbarApi floor methods; add opts.floor
src/main/folders.ts                FolderStore: floors, lastFloor, folder.floor (via shared/floors.ts); save keeps them
src/main/main.ts                   floors:* IPC; AgentInfo.floor on add/restore; opts.floor on add; DURBAR_SIM_FLOORS(_OFF) -> query
src/preload/preload.ts             bridge methods
src/renderer/app.js                roomShown(); floor state; order + labels; Floors button/panel; add-into select; close chat; empty state
src/renderer/usagetotals.js        tooltip opts.offFloors line
src/renderer/index.html            Floors button, #floorsPop, "into" select
src/renderer/styles.css            floor tag, panel rows, switch
src/renderer/sim.ts                in-memory floors; simfloors / floorsoff seeding
scripts/test-floors.ts        NEW  pure module tests
scripts/test-folders.ts            store round trip with floors; old file without floors
scripts/test-usagetotals.ts        tooltip line
scripts/check-office-overlap.js    cases with 2 and 3 floors on, top bar at 1280x800
scripts/shots-033.js          NEW  simulator driver: checks + screenshots
package.json                       test:floors in npm test
```

**Structure Decision**: existing single Electron project layout (`src/main`, `src/preload`, `src/shared`, `src/renderer`, tests in `scripts/`), same split as spec 017 (doors) and 024 (lobby).

## Design notes

- **Renderer predicate** (R3): replace the `r.hidden` checks in `app.js` (office model, list, folder filter, attention-sorted strip, `visibleAgents` for pills, lobby `placeVisitors`, Close all/Open all, empty-state text) with `roomShown(r)`. `ledgerRemoved` stays on `r.hidden` only (R4).
- **Ordering** (R5): stable sort of rooms by floor index in `officeModel` and the list view; layout cache key includes the ids of floors on.
- **Folder filter**: if the selected room's floor goes off, reset `ui.ws` to `all`.
- **Floors panel** (R6): built like `#foldersPop`; every action calls the bridge and replaces local state with the returned `FloorsState`.
- **Add into floor** (R7): select shown only when more than one floor exists; value sent as `opts.floor`.
- **Demo mode**: no floor state → every room shown, no labels, button hidden.

- **Empty state with floors off (change 2026-10-19, issue #133, FR-013)**: the text depends on `FLOORS.floors.length` (the same test as `renderFloorsBtn`, `src/renderer/app.js` ~L1109), so it never names the top-bar button when the button is hidden. The mixed "hidden or off" branch is only reachable with two or more floors (with one floor, a room is shown unless hidden), but it uses the same rule so a later change cannot break it. No new module: checked on the simulator by `check:office` and `shots-033.js` (the text is built inline in `app.js`, a plain script with no unit-test hook).

## Risks

- Layout regressions from the label in narrow room headers at `mini`/`micro`: the label truncates first (min width 0, ellipsis, tooltip); covered by `check:office`.
- Many `r.hidden` call sites: a missed one leaks off-floor agents somewhere; `shots-033.js` asserts pills = visible agents (SC-002) and no lobby figure for off floors.
- Downgrade to an older build drops floors on its next save (documented limit).

## Complexity Tracking

No constitution violations; nothing to justify.
