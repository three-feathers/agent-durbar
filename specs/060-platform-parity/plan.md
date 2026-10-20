# Plan 060: platform parity

Order (Q6, recommended); each step is its own PR with tests, docs and screenshots:

1. **Simulator truth and Linux docs** (FR-002, FR-006 docs, A9 note, the PowerShell 6 wording). `sim.ts` takes its setup data from `installPlans(kind, platform, found)` with a per-OS "found" set. README: `libfuse2`, `--appimage-extract-and-run`, keyring note. Small, no new behaviour.
2. **Official installers** (FR-001, after Q1). A pure route table, extended with `{ manager: 'official', url, interpreter }` per OS. A main-process downloader: HTTPS only, a fixed host list per vendor, redirects checked against it, size cap, temp file mode 600, deleted after. The run uses the existing `harnesssetup` spawn path (no shell, process-group or `taskkill /T` stop). Tests on fakes: host refusal, redirect refusal, no shell, argv shape per OS.
3. **Detection folders** (FR-003, after Q2). Pure `searchDirs(platform, home, env, fsList)` extended with the version-manager and Linuxbrew folders; the optional login-shell `PATH` read with a fixed command and a time limit; Settings shows where each app was found. Tests per OS on a fake file system.
4. **Windows prerequisites and WSL text** (FR-004, FR-005). `pwsh.exe` and Git for Windows detection; the routes offered through winget; plain explanations.
5. **Folder identity** (FR-007). Case fold and `realpath.native` on macOS and Windows; merge duplicates on load; migration test.
6. **Tests per OS** (FR-008). The unit tests above run on all three runners in `ci.yml` already; a manual workflow runs the real install and detection on clean runners (Q5).

Constitution: III (no shell strings, a fixed host list, the user confirms), VI (one code path per OS, tested on all three), VIII (each check recorded as `real:` or `read:`).
