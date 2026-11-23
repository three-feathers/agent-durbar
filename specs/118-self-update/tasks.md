# Tasks: 118 Agent Durbar self-update, fork-friendly

**Input**: [spec.md](spec.md), [plan.md](plan.md). Tests first, 0 AI credits, no network in any test. One PR per group (P1..P6), in order; a group starts when the one it depends on is merged. Numbers: a new spec numbers from 001 (`scripts/spec-numbers.js`); checked with `npm run specs:numbers` on 2026-11-22 against `origin/main` (`692dded06`) and the open PR heads. **Owner decisions** D1..D7 (spec *Clarifications*) are all answered (2026-11-22); the daily check is on by default (D2 = A) from the code PR that builds it (T010); phase 2 (P6) is not scheduled (D3).

## P0: spec

- [x] T001 Spec, plan, tasks, the Duniya evidence block and the `specs-index` block. Check: `npm run specs:check`, `npm run specs:numbers`, `npm run rules:check`, `npm run changelog:check`.

## P1: pure core (no behaviour change; depends on P0)

- [x] T002 [P] `scripts/test-selfupdate-repo.ts` first, with the plan's mutants, then `parseRepoSlug`, `sameRepo` in `src/shared/selfupdate.ts` [FR-001, FR-003]
- [x] T003 [P] `scripts/test-selfupdate-feed.ts` first, fixtures in `scripts/fixtures/selfupdate/` (a real-shaped release list written by hand from GitHub's documented fields, a renamed-repo 301, another repo's `html_url`, 500 entries, 10 MB body), then `validateFeed`, `pickTarget`, `isBreaking` [FR-007, FR-008, FR-009]
- [x] T004 [P] `scripts/test-selfupdate-notes.ts` first, then `notesText` [FR-010]
- [x] T005 [P] `scripts/test-selfupdate-installtype.ts` first, then `installType`, `assetFor` against spec 008's `artifactName` patterns [FR-012]
- [x] T006 `scripts/test-selfupdate-schedule.ts` first, then `cadenceDue`, `snoozeState` (simulated clock; switch, policy, `local` origin, dev run; default on per D2 = A; no timer armed when off; switching off mid-check aborts it) [FR-004, FR-005, FR-016, SC-001] *(D5 = B, decided)*

## P2: build source and breaking marker (depends on P1)

- [ ] T007 `scripts/updatesource.js` resolver + `copy-assets.js` writes `dist/main/updatesource.json` (run time reads only this file; test that run-time env is ignored); `release.yml` `verify` summary prints the slug and warns on a `package.json` mismatch; static workflow test in `scripts/test-release-workflow*` [FR-001]
- [ ] T008 `scripts/test-releases-json.ts` first (fixtures and the plan's mutants), then `parseReleasesJson` (FR-026), `releases.json` at the repository root with an entry for the current version, `scripts/releases-check.js` and `npm run releases:check`, run by `release.yml` `verify` on the tagged commit and by `npm test` on the tree; release-time writing added to the release steps in `changelog.d/README.md` and `.claude/skills/durbar-release/SKILL.md` (the version PR adds the entry: `breaking`, `notes`, `action`), and to `docs/development.md`; spec 008 dated delta [FR-009, FR-026] *(D6 = B, decided)*

## P3: main checker (depends on P2)

- [ ] T009 `makeFeedGet` and `feedAllowed` in `src/main/netget.ts` beside (not inside) `makeLookupGet`/`lookupAllowed`; tests for a look-alike host, another slug, a query added, a 3xx, a body over 2 MiB, no `Authorization` header [FR-007, FR-025]
- [ ] T010 `scripts/test-selfupdate-ipc.ts` first (forged arguments on every channel), then `src/main/selfupdate.ts`: scheduler, request, in-memory result, `updates.*` settings keys validated on read, version-only IPC channels through the IPC guard (`test:ipcchannels`), `updatePolicy()` hook; packaged builds only [FR-004, FR-005, FR-006, FR-021, FR-024]
- [ ] T011 (D4 = override allowed, decided) Source override in main: read-first, native confirmation with the trust warning text of FR-003, *Use the built-in source*; the hand-edited-settings `[KNOWN GAP]` in `docs/safety.md` [FR-002, FR-003] 
- [ ] T012 Simulator canned feed (up to date, update, breaking, mismatch) answering the same IPC [FR-020, SC-005]
- [ ] T013 Spec 076 dated delta: FR-174 `auto` means "apply allowed with consent", `feedUrl` GitHub-only in this version [FR-005]

## P4: Update card and dialog (depends on P3)

- [ ] T014 Settings > About card and More menu (⋯) line, one toast per version (`announceRule`), dialog with breaking card and tick box, snooze, skip; `textContent` only [FR-011, FR-016, FR-002]
- [ ] T015 UI driver `selfupdate-dialog` (SC-004 hostile body, breaking tick gate, snooze/skip), screenshots at 1440x900 and 1280x800 with `DURBAR_SIM=15` [FR-011, SC-004]
- [ ] T016 Docs: `docs/install.md` *Updates* and *For forks*, the checksum-limit text of FR-022 in `docs/install.md` and `docs/safety.md`, the macOS *Open Anyway* step (after the Mac session checks it), the privacy list of FR-006, README *Safety model*, `docs/safety.md`, `docs/features.md`, `docs/feature-inventory.md`, changelog fragment [FR-006, FR-022]

## P5: checked download and backup (depends on P4; phase 1 complete)

- [ ] T017 `scripts/test-selfupdate-download.ts` first (fake request layer and a temp folder: hops, caps, cancel, hash mismatch, SUMS shapes, planted symlink, existing file, full disk, missing Downloads, cross-volume copy, leftover partials, re-hash before open, redirect tokens never in errors), then `src/main/selfupdatedownload.ts` and `parseSums` [FR-013, FR-014, FR-025]
- [ ] T018 Internet marks (plan D10: Windows `Zone.Identifier`, macOS `com.apple.quarantine` via fixed-argv `execFile`), *Open installer* only when the mark is confirmed, *Show in folder*, AppImage `0755`, Downloads naming; tests with injected fs/execFile [FR-015] *(D7 = Downloads, decided)*
- [ ] T019 `scripts/test-preupdatebackup.ts` first, then `src/main/preupdatebackup.ts` (file allow-list, keep 3) [FR-017]
- [ ] T020 Real checks, no AI credits, owner machines: Windows NSIS *Open installer* with the zone mark (SmartScreen prompt seen); macOS dmg with the quarantine flag (Gatekeeper prompt seen); Linux AppImage. `real:` lines in the spec; until then `[KNOWN GAP]` [FR-015, FR-022]

## P6: phase 2 in place (NOT scheduled: owner D3 = no signature scheme now; needs a new owner decision, and never without T021)

- [ ] T021 Signature: a tag-triggered `sign` job in `release.yml` with `environment: update-signing` (required reviewers), `SHA256SUMS.txt.sig` in the FR-014 format, current and next public keys baked by T007's resolver, `crypto.verify` before the hash compare; rotation and leak steps in `SECURITY.md`; tests with a throwaway test key, including the replay mutant; no agent handles a real private key [FR-014] *(needs a new owner decision on D3, and owner approval for the environment, its reviewers and the secret)*
- [ ] T022 Windows NSIS apply: whole-app session gate (plan D11, not spec 081's per-app `UpdateGate`), native confirmation with version and key-id, signature and re-hash required, backup required, fixed-argv `spawn` from the private folder, quit; test with an injected spawn [FR-019]
- [ ] T023 `scripts/test-selfupdate-appimage.ts` first, then Linux AppImage apply: validate `$APPIMAGE` (regular, user-owned, not a link, `.AppImage`, writable folder, the running file), write beside, verify, rename, keep `.old`, restart; refuse without write access; tests on a temp folder [FR-019]
- [ ] T024 Real checks of T022 and T023 on owner machines [FR-019]

## Related gap

- [ ] T026 Record the `app:openExternal` gap (`src/main/ipc/app.ts` opens any http(s) URL the window sends) as an issue and a dated delta in its owning spec; this spec does not use that channel (FR-024) and does not change it [FR-024]

- [ ] T027 Spec 107 dated delta and `src/shared/about.ts` `repoUrl(slug)`: What's-new and bug-form links use the built-in slug; build test that the baked slug and spec 107's URL agree [FR-018]

## Later (not scheduled)

- [ ] T025 macOS in place after spec 014 signing (Squirrel.Mac via electron-updater or the T022 flow) [FR-023] *(D1 = no certificates now; needs a new owner decision and money)*

## Dependencies

P0 → P1 → P2 → P3 → P4 → P5; P6 is not scheduled (D3: no signature scheme now); T025 after a new D1 decision. Within P1, T002..T005 are parallel. All owner decisions D1..D7 are answered (2026-11-22): no certificates (D1), check on by default from T010 (D2), no signature now (D3), override allowed (D4), cadence B (D5), `releases.json` from the tag (D6), Downloads (D7).
