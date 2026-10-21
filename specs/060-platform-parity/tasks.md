# Tasks 060: platform parity

- [x] T001 Audit and plan (this spec), vendor installers checked against their docs (`read:` 2026-10-20)
- [x] T002 Owner answers Q1-Q6 (2026-10-20: least privilege first; Q2, Q3, Q5 yes; Q4 native Windows, explain WSL; Q6 as listed)
- [x] T010 Simulator setup data from `installPlans()` per OS; README libfuse2, keyring and PowerShell 6 wording [FR-002, FR-006]
- [ ] T020 Official installer routes with the safe downloader and runner; tests [FR-001]
- [x] T030 Detection folders (version managers, Linuxbrew), optional login-shell PATH; Settings shows where found; tests [FR-003]
- [ ] T040 Windows prerequisites (PowerShell 6+, Git for Windows) and WSL text [FR-004, FR-005]
- [ ] T050 Folder identity on case-insensitive systems, with migration [FR-007]
- [ ] T060 Per-OS tests and a manual real-install workflow [FR-008]
- [ ] T061 Linux `.deb` and arm64 builds, if Q3 says yes [FR-006]
- [x] T062 (2026-10-21, #412) One PATH-directory helper `pathDirs` in `src/shared/` used by `src/adapters/detect.ts` `candidates()` and `src/main/vscode.ts` `pathCandidates()` (FR-094). Done: the unit test for `pathDirs`; `test-detect` and `test-vscode` keep every row and gain the quoted VS Code row and the duplicate row; `npm run typecheck && npm run build && npm test`; CHANGELOG line.
