# Tasks: Packaging, CI and draft releases

## Done (as built)

- [x] T001 electron-builder config for dmg/zip, nsis/portable, AppImage [FR-001, FR-002]
- [x] T002 `prepare-runtime.js` single-runtime per target [FR-003]
- [x] T003 `after-pack.js` verification [FR-004]
- [x] T004 Packaged runtime path resolution + test [FR-005]
- [x] T005 CI workflow: 3-OS build/test + Linux packaging smoke, SHA-pinned actions [FR-006]
- [x] T006 Tag-driven draft release with checksums [FR-007, SC-001]
- [x] T007 README/CONTRIBUTING install, unsigned steps and release notes [FR-008]
- [x] T008 Electron 44 / electron-builder 26 upgrade (Electron 33 out of support)
- [x] T009 Re-ran `pack:dir` on 2026-10-16 (pass)

## Open

- [ ] T020 Signing and notarization: see feature 014 (**needs approval, purchase**). [FR-009]
- [ ] T021 Install and run the built packages on macOS and Windows; record results in the README. [FR-010]
- [ ] T022 Add `engines` (Node >= 20.19) to `package.json` and align CONTRIBUTING/CI. [FR-013]
- [ ] T023 Decide on arm64 Windows/Linux and other package formats (clarify demand first). [FR-011]
- [ ] T024 Build attestations (`actions/attest-build-provenance`), pinned by SHA. [FR-012]
- [ ] T025 Pack-smoke on macOS and Windows runners. [FR-015]
- [ ] T026 Dependabot for npm and Actions (SHA-pinned). [FR-016]
