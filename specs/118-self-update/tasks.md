# Tasks: 118 Agent Durbar self-update, fork-friendly

**Input**: [spec.md](spec.md), [plan.md](plan.md). Tests first, 0 AI credits, no network in any test. One PR per group (P1..P6), in order; a group starts when the one it depends on is merged. Numbers: a new spec numbers from 001 (`scripts/spec-numbers.js`); checked with `npm run specs:numbers` on 2026-11-22 against `origin/main` (`692dded06`) and the open PR heads. **Owner decisions** D1..D7 (spec *Clarifications*) gate the tasks marked *(needs Dn)*. **The daily check ships off until D2's answer is merged into the spec** (FR-004); no PR may ship the proposed default first.

## P0: spec

- [x] T001 Spec, plan, tasks, the Duniya evidence block and the `specs-index` block. Check: `npm run specs:check`, `npm run specs:numbers`, `npm run rules:check`, `npm run changelog:check`.

## P1: pure core (no behaviour change; depends on P0)

- [ ] T002 [P] `scripts/test-selfupdate-repo.ts` first, with the plan's mutants, then `parseRepoSlug`, `sameRepo` in `src/shared/selfupdate.ts` [FR-001, FR-003]
- [ ] T003 [P] `scripts/test-selfupdate-feed.ts` first, fixtures in `scripts/fixtures/selfupdate/` (a real-shaped release list written by hand from GitHub's documented fields, a renamed-repo 301, another repo's `html_url`, 500 entries, 10 MB body), then `validateFeed`, `pickTarget`, `isBreaking` [FR-007, FR-008, FR-009]
- [ ] T004 [P] `scripts/test-selfupdate-notes.ts` first, then `notesText` [FR-010]
- [ ] T005 [P] `scripts/test-selfupdate-installtype.ts` first, then `installType`, `assetFor` against spec 008's `artifactName` patterns [FR-012]
- [ ] T006 `scripts/test-selfupdate-schedule.ts` first, then `cadenceDue`, `snoozeState` (simulated clock; switch, policy, `local` origin, dev run; default off; no timer armed when off) [FR-004, FR-005, FR-016, SC-001] *(default off until D2; D5 default until answered)*

## P2: build source and breaking marker (depends on P1)

- [ ] T007 `scripts/updatesource.js` resolver + `copy-assets.js` writes `dist/main/updatesource.json` (run time reads only this file; test that run-time env is ignored); `release.yml` `verify` summary prints the slug and warns on a `package.json` mismatch; static workflow test in `scripts/test-release-workflow*` [FR-001]
- [ ] T008 `Breaking:` fragment field in `scripts/changelog.js` and `### Breaking` in `scripts/release-notes.js`; `test-changelog.js` cases; `changelog.d/README.md`; spec 008 dated delta [FR-009] *(needs D6)*

## P3: main checker (depends on P2)

- [ ] T009 `makeFeedGet` and `feedAllowed` in `src/main/netget.ts` beside (not inside) `makeLookupGet`/`lookupAllowed`; tests for a look-alike host, another slug, a query added, a 3xx, a body over 2 MiB, no `Authorization` header [FR-007, FR-025]
- [ ] T010 `scripts/test-selfupdate-ipc.ts` first (forged arguments on every channel), then `src/main/selfupdate.ts`: scheduler, request, in-memory result, `updates.*` settings keys validated on read, version-only IPC channels through the IPC guard (`test:ipcchannels`), `updatePolicy()` hook; packaged builds only [FR-004, FR-005, FR-006, FR-021, FR-024]
- [ ] T011 Source override in main: read-first, native confirmation with the trust warning text of FR-003, *Use the built-in source*; the hand-edited-settings `[KNOWN GAP]` in `docs/safety.md` [FR-002, FR-003] *(needs D4)*
- [ ] T012 Simulator canned feed (up to date, update, breaking, mismatch) answering the same IPC [FR-020, SC-005]
- [ ] T013 Spec 076 dated delta: FR-174 `auto` means "apply allowed with consent", `feedUrl` GitHub-only in this version [FR-005]

## P4: Update card and dialog (depends on P3)

- [ ] T014 Settings > About card and More menu (⋯) line, one toast per version (`announceRule`), dialog with breaking card and tick box, snooze, skip; `textContent` only [FR-011, FR-016, FR-002]
- [ ] T015 UI driver `selfupdate-dialog` (SC-004 hostile body, breaking tick gate, snooze/skip), screenshots at 1440x900 and 1280x800 with `DURBAR_SIM=15` [FR-011, SC-004]
- [ ] T016 Docs: `docs/install.md` *Updates* and *For forks*, the checksum-limit text of FR-022 in `docs/install.md` and `docs/safety.md`, the privacy list of FR-006, README *Safety model*, `docs/safety.md`, `docs/features.md`, `docs/feature-inventory.md`, changelog fragment [FR-006, FR-022]

## P5: checked download and backup (depends on P4; phase 1 complete)

- [ ] T017 `scripts/test-selfupdate-download.ts` first (fake request layer and a temp folder: hops, caps, cancel, hash mismatch, SUMS shapes, planted symlink, existing file, full disk, missing Downloads, cross-volume copy, leftover partials, re-hash before open, redirect tokens never in errors), then `src/main/selfupdatedownload.ts` and `parseSums` [FR-013, FR-014, FR-025]
- [ ] T018 Internet marks (plan D10: Windows `Zone.Identifier`, macOS `com.apple.quarantine` via fixed-argv `execFile`), *Open installer* only when the mark is confirmed, *Show in folder*, AppImage `0755`, Downloads naming; tests with injected fs/execFile [FR-015] *(D7 default until answered)*
- [ ] T019 `scripts/test-preupdatebackup.ts` first, then `src/main/preupdatebackup.ts` (file allow-list, keep 3) [FR-017]
- [ ] T020 Real checks, no AI credits, owner machines: Windows NSIS *Open installer* with the zone mark (SmartScreen prompt seen); macOS dmg with the quarantine flag (Gatekeeper prompt seen); Linux AppImage. `real:` lines in the spec; until then `[KNOWN GAP]` [FR-015, FR-022]

## P6: phase 2 in place (depends on P5 and D3; never without T021)

- [ ] T021 Signature: a tag-triggered `sign` job in `release.yml` with `environment: update-signing` (required reviewers), `SHA256SUMS.txt.sig` in the FR-014 format, current and next public keys baked by T007's resolver, `crypto.verify` before the hash compare; rotation and leak steps in `SECURITY.md`; tests with a throwaway test key [FR-014] *(needs D3 = C and owner approval for the environment, its reviewers and the secret)*
- [ ] T022 Windows NSIS apply: whole-app session gate (plan D11, not spec 081's per-app `UpdateGate`), native confirmation with version and key-id, signature and re-hash required, backup required, fixed-argv `spawn` from the private folder, quit; test with an injected spawn [FR-019]
- [ ] T023 Linux AppImage apply: write beside, verify, rename, keep `.old`, restart; refuse without write access; tests on a temp folder [FR-019]
- [ ] T024 Real checks of T022 and T023 on owner machines [FR-019]

## Related gap

- [ ] T026 Record the `app:openExternal` gap (`src/main/ipc/app.ts` opens any http(s) URL the window sends) as an issue and a dated delta in its owning spec; this spec does not use that channel (FR-024) and does not change it [FR-024]

## Later (not scheduled)

- [ ] T025 macOS in place after spec 014 signing (Squirrel.Mac via electron-updater or the T022 flow) [FR-023] *(needs D1, money)*

## Dependencies

P0 → P1 → P2 → P3 → P4 → P5 → P6; T025 after D1. Within P1, T002..T005 are parallel. D2, D5, D7 have proposed defaults the build may use until answered (stated in each PR); D3, D4, D6 and D1 block their tasks.
