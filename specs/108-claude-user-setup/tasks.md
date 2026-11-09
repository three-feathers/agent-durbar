# Tasks: 108 Your own Claude Code instructions and agents

**Input**: [spec.md](spec.md), [plan.md](plan.md). **Tests first**, 0 AI credits, simulator and fake CLI only. One PR per group (G1..G5); a task is one issue (#840 is the umbrella and stays open until T012). Numbers checked against `main`, remote branches and open PRs on 2026-11-09. Every UI group adds simulator screenshots at 1440x900 and 1280x800, a changelog fragment, its `docs/feature-inventory.md` row and the touched `docs/` pages; the README *Claude Code* row and *Safety model* change in G4.

## Spec

- [ ] T001 Spec, plan, tasks and specs-index block (`specs/108-claude-user-setup/`). Test: `npm run specs:check`, `npm run rules:check`, `npm test`.

## G0: owner answers

- [x] T002 [G0] Owner answers Q1..Q6 (all (a), Vikram, 2026-11-09 07:24 UTC) (spec Clarifications); record each with its date in spec.md and adjust FR-005, FR-009, FR-016 and the Read-only note. Test: `npm run specs:check`. Blocks: G1 for Q1, Q2, Q4; G2 for Q3, Q5; G3 for Q6.

## G1: readers (no launch change yet)

- [ ] T003 [G1] `claudeMdPrompt`: root kind (folder or user Claude folder), the user heading, FR-005's import filter (`.md` only, data folders and dot segments refused, `realpath` containment), Q1's `@~/` rule (answered (a)), one budget across both calls with the folder first and the cut marker. Test first: `test:claudemd` cases and mutants of plan.md, both path flavours [FR-003, FR-004, FR-005, FR-009, FR-018, FR-028]
- [ ] T004 [G1] `claudeAgents.ts`: read with SHA-256 of the bytes parsed, reserved names, `subAgentsArg(defs, profile?)` with only four keys and a null-prototype object, clash order (profile, folder, user), skip and cut counts; `parseFrontMatter` null-prototype maps. Test first: `test:claudeagents` hostile fixtures and mutants; `test:slash` unchanged [FR-010, FR-012, FR-013, FR-014, FR-018]

## G2: launch

- [ ] T005 [G2] R1/R2 research (free `--help` probes and the vendor CHANGELOG, no session): the first Claude Code version with `--agents <file>` and `--append-system-prompt-file`; record as `read:` in spec.md and set the gate constant. Test: none (research), the facts written with their source [FR-016, FR-027]
- [ ] T006 [G2] `StartOptions.userSetup`, filled by main from `SettingsStore` and `AgentTrustStore` for Claude sessions at start and relaunch; other adapters ignore it. Test first: start-option tests (off: absent; on: confirmed pairs of the session's folders only; Copilot/Codex unchanged) [FR-014, FR-019]
- [ ] T007 [G2] `ClaudeAdapter.launch` / `claudeArgs` / `cliLaunchArgs`: read only when on; private `instructions.md` and `agents.json` beside `mcp-config.json` (`0600`, `wx`, removed at exit, swept at quit); `--append-system-prompt-file` and `--agents <file>`, `--agent` only with a profile; version gate sends nothing on an old or unknown version; `--setting-sources ""` and every permission flag unchanged. Test first: fake CLI launch tests for SC-001, SC-002, SC-004, file lifetime, the gate, Read-only note per Q3 [FR-006, FR-007, FR-008, FR-011, FR-015, FR-016, FR-017, FR-022, FR-023]
- [ ] T008 [G2] Named helpers: a fake stream with `subagent_type: "analyst"` (and a hostile, token-shaped name) shows *Helper · analyst* and a masked name in Flat, Real office and Retro. Test: `test:helpercard` case and `check-015-bg-helper` step with a named agent [FR-024, spec 015 FR-021]

## G3: Settings

- [ ] T009 [G3] Setting: `AppSettings.claudeUserSetup`, `SettingsStore` getter and setter, `settings:setClaudeUserSetup` through `setting()`, `settings:get`, preload and `api.ts`. Test first: `test:settings` (off by default, junk refused, off not written, failed write not "Saved") [FR-001]
- [ ] T010 [G3] Preview channel `settings:claudeUserSetupPreview` (`fromAppFrame`, no arguments, `simguard` fixture under `DURBAR_SIM`, masked names, counts and reasons only, nothing cached) and the Settings row under Agent apps > Claude Code: label, sentence, masked Claude folder, *Check what loads*, status region, "Needs Claude Code …" and Read-only notes; sim bridge. Test first: `test:ipcchannels`, preview shape test with the leak fixture; `scripts/check-108-settings.js` at both sizes in Open office, Real office and Retro arcade (keyboard order, `role="switch"`, `aria-describedby`, polite status, no overlap, 10.5 px floor) [FR-002, FR-020, FR-021, FR-024, FR-025, FR-026]

## G4: docs

- [ ] T011 [G4] README *Claude Code* row and *Safety model* (what the switch reads and never reads), `docs/safety.md`, `docs/features.md`, `docs/limits.md` (FR-027..FR-029), `docs/feature-inventory.md` row (all three worlds), Settings screenshots through `npm run shots:docs`, changelog fragment; spec 012 and spec 043 get dated `## Changes` lines pointing here (Q8 not reversed; FR-008 extended). Test: `npm test` (docs checks), `npm run shots:docs` pictures looked at [FR-024, FR-027, FR-028, FR-029]

## G5: real check (needs the owner's OK; not run by an agent without it)

- [ ] T012 [G5] `real:` on the owner's Mac, 1-2 prompts on a cheap model, with the owner's written OK and after saying what it costs: switch on, a session in Ask first asks the main agent to hand a small read task to `analyst`; check the helper shows *Helper · analyst*, its tool call asks through Durbar's card, a `tools`-narrowed agent cannot call a tool outside its list, the private files are gone after exit, and the switch off gives today's flags. Record results (version, cost) in spec.md and resolve FR-027's items. Test: the run itself [FR-011, FR-015, FR-016, FR-027, FR-029, SC-006]

## Coverage (analyze, by hand)

| FR | Task |
|---|---|
| FR-001 | T009 |
| FR-002 | T010 |
| FR-003, FR-004, FR-005 | T003 |
| FR-006, FR-007, FR-008 | T007 |
| FR-009 | T003 |
| FR-010, FR-012, FR-013 | T004 |
| FR-011 | T007, T012 |
| FR-014 | T004, T006 |
| FR-015 | T007, T012 |
| FR-016, FR-017 | T005, T007 |
| FR-018 | T003, T004 |
| FR-019 | T006 |
| FR-020, FR-021 | T010 |
| FR-022, FR-023 | T007 (and T010's leak fixture) |
| FR-024 | T008, T010, T011 |
| FR-025, FR-026 | T010 |
| FR-027 | T005, T011, T012 |
| FR-028 | T003, T011 |
| FR-029 | T011, T012 |
