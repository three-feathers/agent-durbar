# Tasks: 118 Agent Durbar self-update, fork-friendly

**Input**: [spec.md](spec.md), [plan.md](plan.md). Tests first, 0 AI credits, no network in any test. One PR per group (P1..P6), in order; a group starts when the one it depends on is merged. Numbers: a new spec numbers from 001 (`scripts/spec-numbers.js`); checked with `npm run specs:numbers` on 2026-11-22 against `origin/main` (`692dded06`) and the open PR heads. **Owner decisions** D1..D7 (spec *Clarifications*) gate the tasks marked *(needs Dn)*.

## P0: spec

- [x] T001 Spec, plan, tasks, the Duniya evidence block and the `specs-index` block. Check: `npm run specs:check`, `npm run specs:numbers`, `npm run rules:check`, `npm run changelog:check`.

## P1: pure core (no behaviour change; depends on P0)

- [ ] T002 [P] `scripts/test-selfupdate-repo.ts` first, with the plan's mutants, then `parseRepoSlug`, `sameRepo` in `src/shared/selfupdate.ts` [FR-001, FR-003]
- [ ] T003 [P] `scripts/test-selfupdate-feed.ts` first, fixtures in `scripts/fixtures/selfupdate/` (a real-shaped release list written by hand from GitHub's documented fields, a renamed-repo 301, another repo's `html_url`, 500 entries, 10 MB body), then `validateFeed`, `pickTarget`, `isBreaking` [FR-007, FR-008, FR-009]
- [ ] T004 [P] `scripts/test-selfupdate-notes.ts` first, then `notesText` [FR-010]
- [ ] T005 [P] `scripts/test-selfupdate-installtype.ts` first, then `installType`, `assetFor` against spec 008's `artifactName` patterns [FR-012]
- [ ] T006 `scripts/test-selfupdate-schedule.ts` first, then `cadenceDue`, `snoozeState` (simulated clock; switch, policy, `local` origin, dev run) [FR-004, FR-005, FR-016, SC-001] *(D2, D5 defaults until answered)*

## P2: build source and breaking marker (depends on P1)

- [ ] T007 `scripts/updatesource.js` resolver + `copy-assets.js` writes `dist/main/updatesource.json`; `release.yml` `verify` summary prints the slug and warns on a `package.json` mismatch; static workflow test in `scripts/test-release-workflow*` [FR-001]
- [ ] T008 `Breaking:` fragment field in `scripts/changelog.js` and `### Breaking` in `scripts/release-notes.js`; `test-changelog.js` cases; `changelog.d/README.md`; spec 008 dated delta [FR-009] *(needs D6)*

## P3: main checker (depends on P2)

- [ ] T009 `selfUpdateAllowed` in `src/main/netget.ts` beside `lookupAllowed`; tests for a look-alike host, another slug, a query added, a 3xx [FR-007]
- [ ] T010 `src/main/selfupdate.ts`: scheduler, request, in-memory result, `updates.*` settings keys validated on read, IPC channels through the IPC guard (`test:ipcchannels`), `updatePolicy()` hook; packaged builds only [FR-004, FR-005, FR-006, FR-021]
- [ ] T011 Source override: read-first, native confirmation, *Use the built-in source* [FR-002, FR-003] *(needs D4)*
- [ ] T012 Simulator canned feed (up to date, update, breaking, mismatch) answering the same IPC [FR-020, SC-005]
- [ ] T013 Spec 076 dated delta: FR-174 `auto` means "apply allowed with consent", `feedUrl` GitHub-only in this version [FR-005]

## P4: Update card and dialog (depends on P3)

- [ ] T014 Settings > About card and More menu (⋯) line, one toast per version (`announceRule`), dialog with breaking card and tick box, snooze, skip; `textContent` only [FR-011, FR-016, FR-002]
- [ ] T015 UI driver `selfupdate-dialog` (SC-004 hostile body, breaking tick gate, snooze/skip), screenshots at 1440x900 and 1280x800 with `DURBAR_SIM=15` [FR-011, SC-004]
- [ ] T016 Docs: `docs/install.md` *Updates* and *For forks*, README *Safety model*, `docs/safety.md`, `docs/features.md`, `docs/feature-inventory.md`, changelog fragment [FR-006, FR-022]

## P5: verified download and backup (depends on P4; phase 1 complete)

- [ ] T017 `scripts/test-selfupdate-download.ts` first (fake request layer: hops, caps, cancel, hash mismatch, SUMS shapes), then `src/main/selfupdatedownload.ts` and `parseSums` [FR-013, FR-014]
- [ ] T018 *Open installer* / *Show in folder*, AppImage `0755`, no quarantine change, Downloads naming [FR-015] *(D7 default until answered)*
- [ ] T019 `scripts/test-preupdatebackup.ts` first, then `src/main/preupdatebackup.ts` (file allow-list, keep 3) [FR-017]
- [ ] T020 Real checks, no AI credits, owner machines: Windows NSIS *Open installer*; macOS dmg and the quarantine flag; Linux AppImage. `real:` lines in the spec; until then `[KNOWN GAP]` [FR-015, FR-022]

## P6: phase 2 in place (depends on P5 and D3)

- [ ] T021 Signature: `release.yml` signs `SHA256SUMS.txt` (Ed25519, repository secret set by an owner), public key baked by T007's resolver, `crypto.verify` before the hash compare; tests with a throwaway test key [FR-014] *(needs D3 = C and owner approval for the secret)*
- [ ] T022 Windows NSIS apply: native confirmation with open sessions (spec 081 FR-013 gate reused), backup required, fixed-argv `spawn`, quit; test with an injected spawn [FR-019]
- [ ] T023 Linux AppImage apply: write beside, verify, rename, keep `.old`, restart; refuse without write access; tests on a temp folder [FR-019]
- [ ] T024 Real checks of T022 and T023 on owner machines [FR-019]

## Later (not scheduled)

- [ ] T025 macOS in place after spec 014 signing (Squirrel.Mac via electron-updater or the T022 flow) [FR-023] *(needs D1, money)*

## Dependencies

P0 → P1 → P2 → P3 → P4 → P5 → P6; T025 after D1. Within P1, T002..T005 are parallel. D2, D5, D7 have proposed defaults the build may use until answered (stated in each PR); D3, D4, D6 and D1 block their tasks.
