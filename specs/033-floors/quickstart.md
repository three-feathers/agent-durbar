# Quickstart: validate floors (simulator only, 0 AI credits)

## Prerequisites

`npm ci` done. No Copilot login needed. Never run `npm run smoke` or a real session for this feature.

## Automated

```bash
npm run typecheck && npm run build && npm test     # includes test:floors and the folder-store round trip
npm run check:office                                # layout incl. 2 and 3 floors on (xvfb on Linux)
```

## Manual, on the simulator

```bash
DURBAR_SIM=15 DURBAR_SIM_FLOORS=1 npm start
```

Starts with three floors (Ground floor, Client A, Personal), all on, rooms spread over them.

1. Top bar shows **Floors 3/3**; each room header shows its floor label; rooms of one floor are next to each other (FR-007, FR-012).
2. Open Floors, switch **Personal** off: its rooms leave the office, list, folder filter and strip; the status pills drop its agents; no figure of it in the lobby; button shows **Floors 2/3** (FR-008, FR-020, SC-002).
3. Hover the office credit total: it still includes Personal's spend and says how much comes from floors that are off (FR-016).
4. **Only** on Client A: one floor on, labels disappear, **Floors 1/3** (FR-022, FR-012).
5. Open an agent of Client A in full-screen chat, switch Client A off from the panel: the chat closes (spec US2 #7).
6. All floors off: the office shows the "all floors are off" message (FR-013).
7. Create "Test", move a folder into it, rename it, move it up, delete it: the folder is back on Ground floor, its agents unchanged (FR-003 to FR-005).
8. Hide a folder (Folders → Hide): the Floors panel shows it as hidden (FR-021).
9. Restart with the same command: in the simulator floors are in memory, so persistence is checked by `npm test` (store round trip), not here.

Start with a floor already off: `DURBAR_SIM=15 DURBAR_SIM_FLOORS=1 DURBAR_SIM_FLOORS_OFF=Personal npm start` (main passes it as `?floorsoff=Personal`; the same parameter works when opening `dist/renderer/index.html?sim=15&simfloors=1&floorsoff=Personal` in a browser).

## Screenshots

1440x900 and 1280x800, 15 agents, with two floors on (labels visible) and with one floor off, under `docs/screenshots/033-*`.
