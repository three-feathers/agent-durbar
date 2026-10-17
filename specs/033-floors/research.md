# Research: 033 floors (2026-10-17)

No open technical unknowns; every decision below was read in the code on `main` (after spec 024 and 030 were merged). Nothing was run against a real Copilot session; none is needed.

## R1. Where floors are stored

- **Decision**: in the existing `durbar-folders.json` (FolderStore, spec 006): a top-level `floors` list and an optional `floor` id on each folder entry, plus `lastFloor`. File `version` stays `1`.
- **Rationale**: a folder's floor is folder data (like `hidden`, `closed`); one file means one atomic write for "move folder" and "delete floor" (folders move to Ground floor in the same write). The parser is already tolerant: unknown keys are ignored, bad entries dropped.
- **Alternatives**: `durbar-settings.json` (rejected: two files would have to be written together on delete; settings holds global preferences, spec 024 already had a bug from rewriting it); a new `durbar-floors.json` (rejected: same two-file problem).
- **Downgrade note**: an older app version reads the file fine and ignores `floors`, but its next save drops them (folders then all show on one floor, nothing is lost). Recorded as a limit, not fixed.

## R2. Identity of floors

- **Decision**: floors have a stable generated id (`f-` + short random); names are labels. The built-in floor has the fixed id `ground`. A folder whose `floor` is missing or unknown belongs to `ground`.
- **Rationale**: rename must not touch folder entries; a damaged file degrades to "everything on Ground floor, on" (FR-014).
- **Alternatives**: name as key (rejected: rename would rewrite every folder; case rules get messy).

## R3. How the renderer hides a floor that is off

- **Decision**: one helper `roomShown(r)` = `!r.hidden && floorOn(r.floor)` replaces the direct `r.hidden` checks in `app.js` (office model, list, folder filter, strip/attention order, status pills via `visibleAgents`, lobby `placeVisitors`, Close all/Open all, empty states). Each room carries `floor` from `AgentInfo.floor`.
- **Rationale**: every place that must drop an off floor already drops hidden rooms (spec 006), so the same predicate gives FR-008, FR-020 and the edge cases with one change; the lobby already filters by it, so figures vanish at once (no walk back).
- **Alternatives**: removing agents of off floors from `LIVE.agents` (rejected: events must keep flowing, FR-009, and usage must keep counting, FR-016).

## R4. Usage total (FR-016)

- **Decision**: the office total keeps summing every room (the ledger is untouched). `tooltip()` in `usagetotals.js` gets `opts.offFloors` (a total) and adds the line "X AIU of it from floors that are off". `ledgerRemoved` keeps its meaning (folders removed or hidden), computed with `r.hidden` only, so an off floor does not trigger "Includes folders no longer shown".
- **Rationale**: matches the clarification (money always visible); pure function, testable.

## R5. Room order and floor label (FR-012)

- **Decision**: `officeModel` (and the list view) sorts rooms by floor order index first, keeping the existing room order inside a floor (stable sort). When two or more floors are on, `roomHTML` and the door plate add a `<span class="floor-tag">` with the floor name (escaped, truncated with a tooltip, ≥10.5px). One floor on: no tag, so today's layout and screenshots do not change.
- **Rationale**: no extra height (the lobby already cost a density step at 1280x800, spec 024 plan).
- **Layout check**: the tag sits in the room header line that already exists; `chooseLayout` measures rendered HTML in `#probe`, so the tag is accounted for automatically. `check:office` gets cases with two and three floors on.

## R6. The Floors button and panel (FR-007, FR-022, FR-021)

- **Decision**: a top-bar button `Floors n/m` next to `Folders`, opening `#floorsPop` (same popover pattern, focus and Esc handling as `#foldersPop`). Rows: switch (a `button` with `aria-pressed` and the word On/Off), name, Only, Rename, Up/Down, Delete (not for Ground floor); under each floor its folders with a "Move to" select and a `hidden` tag (FR-021). A "New floor" field at the bottom.
- **Rationale**: reuses existing popover code and styles; keyboard and screen reader basics (constitution V).
- **Top bar width**: the button label is short (`Floors 2/3`); checked at 1280x800 by `check:office` (no overlap in the top bar).

## R7. Choosing the floor when adding a folder (FR-006)

- **Decision**: the native picker cannot host a select, so the floor is chosen **before** it. First tried as an "into: <floor>" select in the top bar next to `+ Folder` / `+ Workspace`; at 1280x800 with three floors it pushed **Office / List** off the bar (measured in the simulator, 2026-10-17). Moved to the top of the Floors panel ("New folders go to: <floor>"), shown only when more than one floor exists; the tooltips of `+ Folder` / `+ Workspace` name the target floor. Default = `lastFloor` from the store, else `ground`. Main validates the id (unknown → `ground`) and saves `lastFloor`.
- **Alternatives**: the top-bar select (rejected: no room at 1280x800, constitution V); ask after the picker in a dialog (rejected: one more step on every add); always Ground floor then move (rejected: FR-006).

## R8. Full-screen chat on an off floor

- **Decision**: when the floor of the open agent is switched off (switch or Only), the renderer closes the chat (same path as Esc) before re-rendering. Pending approvals are not touched (FR-010).

## R9. Simulator (FR-017)

- **Decision**: default simulator unchanged (one floor, so existing drivers and screenshots stay valid). `DURBAR_SIM_FLOORS=1` (passed by main as `?simfloors=1`, like `DURBAR_SIM_ROOMS`) seeds three floors (`Ground floor`, `Client A`, `Personal`) and spreads the simulated rooms over them; `DURBAR_SIM_FLOORS_OFF=Personal` (→ `?floorsoff=Personal`) starts with that floor off. The simulator bridge keeps floors in memory with the same rules. **As built:** `sim.ts` is a plain renderer script (no imports), so it keeps its own short copy of the rules (names, 40-floor cap, ground floor cannot be deleted, Only) instead of importing `src/shared/floors.ts`; the shared module stays the one main uses and the one the unit tests cover (T027).

## R10. Pure logic placement (constitution II)

- **Decision**: `src/shared/floors.ts` (no Electron, no fs): types, `parseFloors`, `validName`, `createFloor`, `renameFloor`, `reorderFloors`, `deleteFloor`, `setFloorOn`, `onlyFloor`, `floorOfFolder`, `moveFolder`. FolderStore calls it; tests call it directly. Agent-neutral: floors never touch adapters.
