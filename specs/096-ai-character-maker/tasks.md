# Tasks: 096 AI character maker with animated characters

**Input**: [spec.md](spec.md), [plan.md](plan.md)

**Tests**: required (constitution VII; SC-001..SC-005). Node tests and the simulator only; 0 AI credits; no network. Driver waits use `until()`. Real probes (`real:`) only on the owner's go, on his ChatGPT plan.

**Format**: `- [ ] Tnnn [P?] [USn?] description (file) [requirements]`, then a `Test:` line. `[P]` = can run in parallel. A phase = one PR. Numbers taken: spec 096, FR-001..FR-072 (sparse by group), T001..T064.

## Phase 0: Spec (this PR)

- [x] T001 Spec, plan, tasks and specs-index block (`specs/096-ai-character-maker/`). Test: `npm run specs:check`, `npm run rules:check`.
- [x] T002 Checked Codex image-generation fact recorded in `docs/agent-apps.md` (Codex, 2026-10-31). Test: read-through; no secret or private path.
- [x] T003 Owner answers Q1-Q5 recorded under *Clarifications* (Vikram, 2026-10-31, "ok and go with your pick"), and posted on the PR (AGENTS.md: chat feedback goes on GitHub too). Q1b (built-in crew motion) stays open for Paco. Test: the spec's only open question is Q1b.

## Phase 1: Probes (real; owner's go; about 5 images)

- [ ] T010 P1: read `codex app-server generate-json-schema` (free) for image-generation items, then 1 real turn on an app-server thread with `workspace-write` in an empty temp folder. Test: `real:` the file appears in the folder and the notification shape is recorded [FR-002]
- [ ] T011 P2: do user MCP servers load in that child, and how to turn them off. Test: `read:` docs and `real:` observation in T010 [FR-002]
- [ ] T012 P3 + P4: transparency and the 2x2 sheet, 3 descriptions, owner looks at them. Test: `real:` 3 sheets, alpha present or not, gutters measured, the owner's verdict quoted [D2, FR-024, FR-026]
- [ ] T013 P5: reference-image turn (fallback of D2). Test: `real:` 1 image, owner's verdict [D2]
- [ ] T014 P6: ChatGPT login vs API key in `account/read`, and the effect of a set `OPENAI_API_KEY` in the child env. Test: `read:` schema field named, or `[KNOWN GAP]` kept; result sets the `unknown`/`chatgpt`/`apikey` rule of FR-034 [FR-034; Edge cases]
- [ ] T014a P7: does `--ephemeral` or the app-server `ephemeral: true` leave a copy under `~/.codex/generated_images/`? Test: `real:` file names before and after, no contents read; result in agent-apps and FR-033 [FR-033]
- [ ] T014b P8: network off under `workspace-write` (no `network_access`) while the image call works; P2: all MCP servers off for this child. Test: `real:` exit status of a network command, no servers started [FR-002]
- [ ] T015 Record P1-P8 in `docs/agent-apps.md` and the spec's `## Changes`; adjust D2 and FR-002 to the results. Test: `npm run specs:check`

## Phase 2: Pure core (PR 2)

- [ ] T020 [P] `src/shared/charstyle.ts`: `STYLE_PRESETS` with `realistic-office-v1`. Test: `test:chargen` checks the id format and that the prefix mentions transparent background and no text [FR-050, FR-051]
- [ ] T021 [P] `src/shared/chargen.ts`: `cleanDescription` (trim, 300 code points, control characters, markers and backticks out, at least 3), `buildCharacterPrompt` (preset + layout block + wrapper), `CHARACTER_IDEAS` (24) and `pickIdeas` reuse. Test: `scripts/test-chargen.ts`: hostile descriptions (marker injection, "ignore the above", newline floods, 10,000 characters, emoji at the cut) stay inside the markers; prompt under 4,000 characters; ideas [FR-010..FR-013]
- [ ] T022 [P] `src/shared/imagecheck.ts`: magic bytes and header dimensions for PNG and WebP (VP8, VP8L, VP8X), no decoder. Test: `scripts/test-imagecheck.ts`: good PNG/WebP, wrong magic, text named `.png`, polyglot PNG+ZIP (header still checked, size cap), huge IHDR, too small, truncated [FR-020, FR-021]
- [ ] T023 [P] `src/shared/webpcheck.ts`: chunk walker moved from `scripts/test-crew-assets.ts`; `checkFrame` (352x352, alpha, 40 KB, allow-list) and `stripChunks`. Test: `test:crew-assets` unchanged and green on the shipped art; `test:imagecheck` covers EXIF/XMP/ICCP stripped, unknown chunk refused [FR-023]
- [ ] T024 `package.json`: `test:chargen`, `test:imagecheck` in the `npm test` list. Test: `npm test` runs them

## Phase 3: Adapter, main and IPC (PR 3)

- [ ] T030 `capabilities.ts`: `imageGen?: boolean`; `types.ts`: `generateImage?(prompt, opts)`, `GenerateImageOptions`, `GenerateImageResult`; Codex `imageGen: true` only after P2 and P8 pass, others false. Test: `test:runtime` contract C2-style: `generateImage` present iff `imageGen` [FR-001, FR-003]
- [ ] T031 `CodexAdapter.generateImage` (route from T010): temp folder via `fs.mkdtemp`, `probe` child, `thread/start` with `workspace-write`, `turn/start`, timeout and `AbortSignal` cancel close the child; returns the path of `outName` only. Test: `test:runtime` on the fake app-server: success, no file, two files, a symlink, text named `sheet.png`, oversize, hang then timeout, cancel; the folder is gone afterwards in every case [FR-002, FR-004] Env and argv test: the child env equals `codexChildEnv(process.env)` (no `GH_*`/`ANTHROPIC_*`/`DURBAR_*`, no `CODEX_HOME` set by Durbar), the argv or thread params carry no network permission, no `--dangerously-*` and no `danger-full-access`, MCP servers off, and only `sheet.png` is read back (a second file, a symlink and a read outside are ignored) [FR-002, FR-020]
- [ ] T032 [P] `scripts/fakes/codex-app-server.ts`: image modes (writes a fixture sheet into `cwd`, or the bad cases above). Test: used by T031
- [ ] T033 `src/main/charencoder.ts` + `src/renderer/charencoder.html`/`.js`: hidden `BrowserWindow` (`show:false`, `sandbox:true`, `contextIsolation:true`, no Node, a session that cancels all requests, CSP `default-src 'none'`), `MessagePort` in and out, decode, size equals header, slice 2x2, key-out, resize 352, WebP 0.82 down to 0.70, face points, panel sanity; destroyed per job; 20 s timeout. Test: `sim:` `check-charencoder` (Electron, simulator build) on fixture sheets: transparent, flat background, bleeding panels, undecodable; outputs pass `webpcheck` [FR-022, FR-024..FR-026]
- [ ] T034 `src/main/charstore.ts` (no Electron import): ids `my-` + 12 hex, temp then rename, list skips bad folders and links, rename, delete, export without overwrite (` (2)`), cap 24. Test: `scripts/test-charstore.ts` in a temp userData; source test: no write outside the root [FR-030, US4]
- [ ] T035 `src/main/ipc/characters.ts`: the channels of FR-031, one try held (10 min), cancel, masking of errors (FR-032), pins in settings (FR-033), `characterMotion` setting. Test: `scripts/test-charipc.ts` on a stand-in `electron`: not `fromApp` refused, unknown id, path, `..`, control characters, a second generate drops the first try, cancel; a marker description never appears in the store, logs or later replies (SC-004); `test-ipcchannels.ts` lists them owner-only [FR-031..FR-033]
- [ ] T036 Preload and `DurbarApi` (`src/shared/api.ts`) types; nothing added to `SIM_OPEN_CHANNELS`. Test: `test:simguard`, `typecheck` [FR-031]
- [ ] T037 `src/shared/characters.ts` + `theme.js`: append `mine` (kit `crew`); `settings:setCharacters` accepts it. Test: `test:characters` (lists equal, round trip, unknown dropped) [FR-040]
- [ ] T038 Simulator fake `generateCharacter` in `src/renderer/sim.ts`: canvas frames from a description hash, 1.5 s (fast flag 0.2 s), cancel; fake store in the page. Test: used by Phase 4 drivers; `test:simguard` [FR-070]
- [ ] T039 `package.json`: `test:charstore`, `test:charipc` in `npm test`. Test: `npm test`

## Phase 4: The window (PR 4)

- [ ] T040 [US1] Factor the theme maker's idea chips, harness picker and cost line into helpers in `screens.js`; `aiTheme()` uses them unchanged. Test: `shots-040-aitheme.js` still passes; no visual change [FR-041]
- [ ] T041a [US1] Login-kind gate (FR-034): `unknown` or `apikey` before P6 asks "If Codex is signed in with an API key, OpenAI charges this picture. Make it?" on every try, Try again included, Cancel focused and making no call; after P6 `apikey` is refused with no process; the "No API money" wording only for `chatgpt`. Test: `check-charmaker` (simulator login kinds `chatgpt`, `unknown`, `apikey`: confirm shown or not, Cancel starts nothing, refusal text) and `test:charipc` (no generate call on refusal or Cancel) [FR-034]
- [ ] T041b [US1] Dialog help and README line: Codex keeps its own copy of each generated picture under `~/.codex/generated_images/`, Durbar neither reads nor deletes it; point text "Durbar keeps nothing from your description". Test: `check-charmaker` reads the text; the Docs check [FR-033, D3]
- [ ] T041 [US1] Maker dialog: describe, ideas, Made by (`imageGen` only), cost and plan line (with `account/rateLimits/read` when it answers), busy line with elapsed time and Cancel, error and Try again, preview of 4 frames at desk size + round crop, name field, Discard / Try again / Save to My characters. Test: `check-charmaker` steps 1-5 of US1 at 1440x900 and 1280x800, text at least 10.5px [FR-040, FR-041; US1]
- [ ] T042 [US2] `crew.js` `registerOwn(list)`, `idsFor('mine')`, `storeKey('mine')`, `facePoint` for registered ids; `app.js` loads `character:list`, fetches frames, makes URLs (R3 decision: `blob:` with CSP `img-src 'self' data: blob:`, or `data:`), preloads with `decode()`, revokes on delete or switch. Test: `test:crew` (registerOwn, unknown id dropped by `loadCrew`, least-used with registered ids); `check:crew` with `OFFICE_CHARACTERS=mine` [FR-043; US2]
- [ ] T043 [US2] Pins in the pick (`syncCrew`: pinned first, then `assignCrew`); pins under Cheeky and Prehistoric too (Q3). Test: `test:crew` pin cases; `check-charmaker` pin step (2 sessions in folder A wear it) [FR-044]
- [ ] T044 [US2] Characters list: My characters value with preview, "Make one first" when empty; deleting the last character falls back with a toast. Test: `check-characters` gains the `mine` value; US2 scenario 4 [FR-040]
- [ ] T045 [US4] Manage rows: Rename, Pin to a folder…, Delete (confirm, pins removed and counted), Export… (`DURBAR_PICK`). Test: `check-charmaker` manage steps; `test:charstore` export [FR-042; US4]
- [ ] T046 Layout: `check:office` and `check:crew` with `OFFICE_CHARACTERS=mine`, 15 agents, 1440x900 and 1280x800. Test: both pass (SC-002)
- [ ] T047 Screenshots: `docs/screenshots/096-charmaker-*.png`, `096-mycharacters-office-*.png` at both sizes via `shots:docs` (`DOC_SHOTS`). Test: look at each picture

## Phase 5: Motion (PR 5)

- [ ] T050 [US3] `motionAllowed()` (reduced motion, Serious, `characterMotion`) and pause on `visibilitychange`, blur + 60 s idle (`pauseAnimations()` on office SVGs, `body.motion-paused`). Test: `check-charmotion` US3 scenarios 3 and 4 [FR-060]
- [ ] T051 [US3] Discrete breathing bob on working and waiting portraits, phase from `seeded(sessionId)`. (My characters only, FR-062) Test: `check-charmotion` scenario 1 (`y` takes at least two values) and the sharpness check of `check:crew` on a still frame [FR-056]
- [ ] T052 [US3] Blink frame swap, one shared timer, working pose only, only with a blink frame. Test: `check-charmotion` (blink seen within 10 s; no motion at all on Cheeky and Prehistoric until Q1b) [FR-057]
- [ ] T053 [US3] Pose cross-fade 250 ms, one `<image>` after. (My characters only, FR-062) Test: `check-charmotion` scenario 2; `check:crew` sharpness after the fade [FR-055]
- [ ] T054 [US3] Typing cue keys (`fill-opacity`) on My characters desks' keyboard zone only. Test: `check-charmotion` boxes inside the keyboard zone at 8 sampled times; Cheeky, Prehistoric and the office kit have no cue and `check:crew`/`check:office` are unchanged [FR-058, FR-062]
- [ ] T055 [US3] Settings > Characters > Motion checkbox, stored `characterMotion`. Test: `test:characters` round trip; `check-charmotion` toggles it [FR-060]
- [ ] T056 [US3] CPU record: 15 working agents, motion on vs off, 30 s. Test: `check-charmotion` logs both numbers; `[KNOWN GAP]` not gated [US3 scenario 6]
- [ ] T057 Motion screenshots or a short note of what was seen (still screenshots cannot show motion). Test: PR text

## Phase 6: Close-out

- [ ] T060 README: features (AI character maker, My characters, motion), *Safety model* (Codex image generation writes only a temp folder; Durbar stores nothing of the description, Codex keeps its own copy of each picture; network off, MCP off), limits (Codex only, API-key login asks first and is refused once detectable, Windows not tried). Test: the *Docs check* passes
- [ ] T061 Spec 077 `## Changes`: FR-061 line (user pictures via main-validated pipeline; CSP note if `blob:`) and the line that spec 096 does not animate the built-in crews (FR-062, Q1b, Paco's call). Test: `npm run specs:check`
- [ ] T062 `changelog.d/<branch>.md` fragment in each code PR. Test: `npm run changelog:check`
- [ ] T063 Real run (SC-006) on the owner's go: one character on Codex 0.163.x, owner's verdict on the preview; result in `## Changes` with `real:`. Test: `real:`
- [ ] T064 `/speckit.converge`: tags `[IMPLEMENTED]`, `[KNOWN GAP]`, specs-index status. Test: `npm run specs:check`

## Dependencies

- Phase 1 decides Phase 3's route (T031) and D2's fallback. Phase 2 can start in parallel with Phase 1.
- Phase 3 needs Phase 2. Phase 4 needs Phase 3 (simulator fake T038 at least). Phase 5 needs Phase 4's `registerOwn` for the blink, but the bob, cross-fade and typing cue can start on the built-in crews after Phase 2.
- T040 (shared helpers) before T041.
