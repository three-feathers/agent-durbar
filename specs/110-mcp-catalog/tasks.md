# Tasks: 110 MCP server catalog and Paste a config

**Input**: [spec.md](spec.md), [plan.md](plan.md). **Tests first**, 0 AI credits, simulator only. One PR per group (G1..G8); a task is one issue (Refs #539 until the last group closes it). Numbers checked against `main`, remote branches and open PRs on 2026-11-09. Every UI group adds simulator screenshots at 1440x900 and 1280x800 in Open office, Real office and Retro arcade, a changelog fragment, and the docs it changes (`docs/features.md`, `docs/safety.md`, `docs/limits.md`, `docs/feature-inventory.md`).

## Spec

- [ ] T001 Spec, plan, tasks and specs-index block (`specs/110-mcp-catalog/`), and the `.github/CODEOWNERS` line for the catalog file (FR-065, approved 2026-11-09), this PR. Test: `npm run specs:check`, `npm run rules:check`.

## G1: catalog data (P1)

- [ ] T002 [G1] `src/shared/policymcp.ts`: the `durbar-mcp-list-v1` reader (spec 076's schema, by hand), with the no-secret rule. Test first: `test:mcpcatalog` with planted bad entries; agreement with the schema through `ajv` [FR-004, FR-006, FR-007, SC-002]
- [ ] T003 [G1] `src/shared/mcpcatalog.json`: the first entries, each checked against the vendor's page (named with its date in the PR body), pinned packages, no values; the host and package allow-list in the test; the CODEOWNERS line for the file is already in place (approved 2026-11-09, added with T001) [FR-001..FR-005, FR-065, Q4, Q5]
- [ ] T004 [G1] `src/main/mcpcatalog.ts` and `mcp:catalog` (`ipcHandle`, preload, `api.ts`): entries, `found` per stdio command from `commandFound`, per-app sign-in ability from adapter capabilities. Test first: `test:mcpcatalog` (broken file gives an empty catalog and no throw; network paths not judged) [FR-006, FR-013, FR-015, FR-064]

## G2: catalog dialog (P1)

- [ ] T005 [G2] Catalog dialog (`src/renderer/mcpcatalog.js`): search, list with name, vendor, kind, needs, *Already added*, *Vendor page*, then *Custom…* and *Paste a config…*; Esc steps back; focus returns. Test: `shots-110-catalog` [FR-011, FR-017, FR-071, FR-072]
- [ ] T006 [G2] Entry points: **Add an MCP server…** on the folder extras screen, in Settings > MCP servers and in the agent's MCP dialog footer; default target per Q3. Test: `shots-110-catalog` from each entry point [FR-010, FR-014]
- [ ] T007 [G2] `editServer` prefill: env and header keys, the catalog's notes, "From the catalog · checked <date>", "Changed from the catalog", needs lines (sign-in, token, Node found / not found), per-app support line. Test: `shots-110-catalog`; unit test of the prefill builder [FR-012, FR-013, FR-015]
- [ ] T008 [G2] Needs sign-in after adding: an OAuth catalog server in the simulator reads spec 058's *Needs sign-in*; **Sign in** only for a fake adapter with `canSignIn`, steps otherwise; no new sign-in code. Test: `shots-110-signin` [FR-016, SC-008]

## G3: paste parser (P1)

- [ ] T009 [G3] `parseMcpConfig` front end in `src/shared/mcpimport.ts`: `mcpServers`, `servers` (VS Code rules), bare map, single object; JSONC and BOM through `stripJsonc`; caps (20 servers, depth 16, 8 KiB strings). Test first: `test:mcppaste` shapes and caps; existing `test:mcp` still green [FR-032, SC-005]
- [ ] T010 [G3] Placeholders, warnings and refusals: placeholder shapes, shell and download-to-shell, unpinned launchers, plain `http:`, secrets in a URL query, relative command; hidden and bidi characters refused with the JSON path, never the value. Test first: `test:mcppaste`, mutation-checked [FR-034, FR-036, FR-037, SC-005]

## G4: paste in main and the paste dialog (P1)

- [ ] T011 [G4] `src/main/mcppaste.ts`: `mcp:pastePreview` (64 KiB, NUL, parse, `validateInput` per candidate, rename and clash rules, masked preview type with no value field, token for 5 minutes) and `mcp:pasteApply` (argument checks, folder apply off and untrusted through the store, global apply through spec 069's preview); `simguard`. Test first: `test:mcppaste` (no planted secret in any answer or log line; token expiry, reuse and foreign ids refused; write counters 0 before confirm) [FR-031, FR-033, FR-038, FR-039, FR-061, FR-064, SC-003, SC-004]
- [ ] T012 [G4] Paste dialog and preview: labelled text area cleared after **Check**, Ctrl/⌘+Enter, the full per-server preview (exact command and arguments or URL, ASCII host, keys with masked values, notes, warnings), boxes, target choice, then the folder save or spec 069's review. Test: `shots-110-paste` (valid, placeholder, warning, refused, hostile) [FR-030, FR-035, FR-062, FR-071, FR-072, SC-004]

## G5: Import from VS Code, retargeted (P2; Q1 A and Q2 B answered 2026-11-09)

- [ ] T013 [G5] Import from VS Code on the paste pipeline: read the file(s) of Q2 in main, FR-035's preview, apply to the apps' own lists through spec 069's review (Q1's scope); `inputs` never resolved; spec 020 dated delta (FR-020, FR-024 amended). Test first: `test:mcp` import cases moved to the new target; `shots-110-paste` import step [FR-050..FR-052]

## G6: Windows npx (P2; Q6 answered C: plain `npx` with the note until T019)

- [ ] T014 [G6] Per-app, per-OS view of what will be written for a catalog `npx` entry, with Q6's answer (plain `npx` and the "not checked" note until T019, then per app); pure function with an injected platform. Test first: unit test from every OS for win32, darwin, linux [FR-080, FR-081]

## G7: worlds, accessibility, docs (P2)

- [ ] T015 [G7] Worlds and fit audit: both dialogs in Open office, Real office and Retro arcade at both sizes, tokens only, opaque surface, text floors, list scrolls inside, no page scroll. Test: `shots-110-catalog` and `shots-110-paste` across worlds; screenshots with `DOC_SHOTS` entries [FR-070, FR-073, SC-007]
- [ ] T016 [G7] Keyboard and screen-reader audit: listbox or buttons (one, tested), accessible names as sentences, announcements, error linking, focus return. Test: driver steps reading `#srAnnounce` and `aria-*` [FR-071, FR-072, SC-006]
- [ ] T017 [G7] Docs: `docs/features.md` (catalog, paste, import), `docs/safety.md` (untrusted paste, secrets, no run), `docs/limits.md` (FR-090..FR-095), README status line, `docs/feature-inventory.md` row, changelog fragment; tick tasks and update tags here. Test: `npm test` (feature inventory check) [FR-070, FR-090..FR-095]

## G8: real checks (owner's OK first, AGENTS.md *No AI credits*)

- [ ] T018 [G8] Each agent app reads every catalog entry as written (Copilot CLI, Claude Code, Codex `mcp list` on a scratch home, 0 credits, as spec 069's T060); record `real:` per entry and app in *Changes* [FR-092, SC-001]
- [ ] T019 [G8] `npx` catalog entry on Windows and macOS for each app (the Mac session for macOS); input for the per-app choice of Q6 (C) [FR-081, FR-093]
- [ ] T020 [G8] One OAuth catalog server through spec 058's Sign in on a real account, after #364's open real checks (T105..T107) [FR-016, FR-091]

## Coverage (hand analysis)

Every FR maps to a task: FR-001..FR-005 T003; FR-004, FR-006, FR-007 T002; FR-006, FR-013, FR-015 T004; FR-010, FR-014 T006; FR-011, FR-017 T005; FR-012, FR-013, FR-015 T007; FR-016 T008; FR-030, FR-035 T012; FR-031, FR-033, FR-038, FR-039 T011; FR-032 T009; FR-034, FR-036, FR-037 T010; FR-050..FR-052 T013; FR-060 T009..T011; FR-061 T011; FR-062 T012; FR-063 T004, T011 (no spawn; `commandFound` only); FR-064 T004, T011; FR-065 T003; FR-066 spec 076's build (no task here: 076 owns its enforcement points); FR-070, FR-073 T015; FR-071, FR-072 T005, T012, T016; FR-080, FR-081 T014; FR-090..FR-095 T017, T018..T020.
