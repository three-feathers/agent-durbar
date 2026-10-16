# Feature Specification: Packaging, CI and draft releases

**Feature Branch**: `008-packaging-and-release` (reverse-engineered; packaging milestone)
**Created**: 2026-10-16
**Status**: Implemented, **unsigned** alpha (reverse-engineered from `package.json` build config, `scripts/prepare-runtime.js`, `after-pack.js`, `.github/workflows/*.yml`, README, CONTRIBUTING)
**Input**: "Ship installable builds for macOS, Windows and Linux without paying for certificates yet, built by CI, published by hand."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Install a build for my OS (Priority: P1)

From the GitHub Releases page I download a file for my system and run it; the README explains the OS warnings for unsigned apps.

**Acceptance Scenarios**:

1. **Given** macOS Apple Silicon / Intel, **When** I download the `.dmg` or `.zip`, **Then** I get `Agent-Durbar-<version>-arm64|x64.<ext>`. *(read:; the draft release exists, CI run succeeded 2026-10-16 per `gh run list`; **never installed on a Mac**)*
2. **Given** Windows 10/11 x64, **When** I download, **Then** I get an NSIS installer (`Agent-Durbar-Setup-<v>.exe`, per-user, choose folder) or `Agent-Durbar-<v>-portable.exe`. *(read:; never installed on Windows)*
3. **Given** Linux x64, **When** I download the AppImage and `chmod +x`, **Then** it runs (maybe with `--no-sandbox`). *(sim: built here; launching the packaged app was not recorded)*

---

### User Story 2 - The packaged app can actually start Copilot (Priority: P1)

The bundled Copilot runtime must be reachable at run time: it is unpacked from the asar and located by path. A build without it fails.

**Acceptance Scenarios**:

1. **Given** `npm run pack:dir` on Linux, **When** it finishes, **Then** `afterPack` has verified `app.asar.unpacked/node_modules/@github/copilot-sdk-linux-x64/prebuilds/linux-x64/copilot-runtime` and `runtime.node` exist and no other platform's runtime is bundled. *(re-verified 2026-10-16: exit 0)*
2. **Given** a packaged app, **When** the adapter starts, **Then** it passes that unpacked path to the SDK. *(test: path logic; real start of a packaged app not recorded)*

---

### User Story 3 - A tag makes a draft release; I publish by hand (Priority: P2)

Pushing a tag `v*` that matches `package.json` builds all platforms on GitHub Actions, uploads artifacts and creates or updates a **draft** (pre-)release with `SHA256SUMS.txt`. Nothing is published automatically.

**Acceptance Scenarios**:

1. **Given** tag `v0.1.0-alpha.1`, **When** pushed, **Then** the workflow builds macOS (arm64, then x64), Windows and Linux and creates a draft pre-release. *(real: run 38908947850 succeeded; draft "Agent Durbar v0.1.0-alpha.1" exists)*
2. **Given** a tag that differs from `package.json` version, **When** pushed, **Then** the workflow fails before building. *(read:)*

---

### User Story 4 - CI on every push and PR (Priority: P2)

Typecheck, build and `npm test` run on Ubuntu, macOS and Windows; a Linux job also packs the app and checks the runtime is unpacked.

**Acceptance Scenarios**:

1. **Given** a push to `main` or any pull request, **When** CI runs, **Then** the 3-OS matrix and the packaging smoke run. *(real: last run on main, success)*

---

### Edge Cases

- Each installer carries **only its own** platform's runtime (`prepare-runtime.js` downloads the target's package if missing, removes others). `[IMPLEMENTED]` real: (CI)
- Release job never signs or publishes; `CSC_IDENTITY_AUTO_DISCOVERY=false`. `[IMPLEMENTED]` read:
- macOS arm64 needs at least an ad-hoc signature to run: the config uses `identity: "-"` (ad-hoc), `hardenedRuntime: false`, `dmg.sign: false`. So macOS builds are **ad-hoc signed, not Developer ID signed, not notarized**. `[IMPLEMENTED]` read:
- All third-party actions are pinned by commit SHA with a version comment. `[IMPLEMENTED]` read: (SHA of checkout v7.0.1 re-checked against the GitHub API 2026-10-16)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** `[IMPLEMENTED]` real: `electron-builder` 26 config in `package.json`: appId `io.github.vikramgorla.agentdurbar`, product "Agent Durbar", output `release/`, files `dist/**` + `package.json`, `asar: true`, `asarUnpack` for `@github/copilot-sdk-*` and `koffi`, `npmRebuild: false`.
- **FR-002** `[IMPLEMENTED]` real: Targets: mac `dmg` + `zip` (arm64 and x64 built in separate runs), Windows `nsis` + `portable` (x64), Linux `AppImage` (x64); artifact names fixed by config.
- **FR-003** `[IMPLEMENTED]` real: `scripts/prepare-runtime.js <platform-arch>` makes `node_modules/@github` hold exactly one runtime package for the build target (fetches it with `npm pack` when missing).
- **FR-004** `[IMPLEMENTED]` real: `scripts/after-pack.js` fails the build when the runtime executable or `runtime.node` is missing/empty or a stray platform runtime is present; it `chmod 755` the runtime on non-Windows.
- **FR-005** `[IMPLEMENTED]` read: `unpackedRuntimePath()` resolves `process.resourcesPath/app.asar.unpacked/node_modules/@github/copilot-sdk-<plat>/prebuilds/<plat>/copilot-runtime[.exe]` only when running from an asar, and the file exists; otherwise the SDK finds it. Unit-tested for all three OSes.
- **FR-006** `[IMPLEMENTED]` real: CI (`ci.yml`): on `pull_request` and `push` to `main`, least-privilege `contents: read`, `concurrency` cancel; job `build-test` (matrix ubuntu/macos/windows, Node 22, `npm ci`, `typecheck`, `build`, `test`); job `package-smoke` (Linux, `npm run pack:dir`).
- **FR-007** `[IMPLEMENTED]` real: Release (`release.yml`): on tag `v*`; checks tag == `package.json` version; typecheck + tests per OS; unsigned package; upload artifacts (14 days); `draft-release` job with `contents: write` creates/updates a **draft**, `--prerelease` when the tag has a `-`, attaches artifacts + `SHA256SUMS.txt`.
- **FR-008** `[IMPLEMENTED]` read: No auto-update; README says so and documents the macOS Gatekeeper, Windows SmartScreen and Linux AppImage first-run steps.
- **FR-009** `[KNOWN GAP]` **Not code-signed or notarized** (macOS Developer ID + notarization, Windows Authenticode). Needs paid certificates: feature 014, **needs approval**.
- **FR-010** `[KNOWN GAP]` Installed builds were never run on macOS or Windows by a person; CI only proves they build and that unit tests pass there. The Linux packaged app was built here; no recorded launch of the packaged binary talking to Copilot. (Feature 013/014.)
- **FR-011** `[KNOWN GAP]` Only x64 for Windows and Linux; no arm64 builds, no `.deb`/`.rpm`, no Flatpak/Snap/winget/Homebrew. `read:`
- **FR-012** `[KNOWN GAP]` No provenance: no build attestation, and checksums are uploaded by the same workflow that builds the files. `read:`
- **FR-013** `[KNOWN GAP]` The CI Node version is fixed at 22; there is no `engines` field in `package.json` while CONTRIBUTING says Node 20.19+ or 22.12+. `read:` (Task T022.)
- **FR-014** `[KNOWN GAP]` There is no CI check that each spec has plan/tasks or that PRs touching `src/` update `specs/` (added by feature-discipline work; see `.github/workflows/spec-kit.yml` once merged).
- **FR-015** `[KNOWN GAP]` `package-smoke` runs `pack:dir` for Linux only; macOS/Windows packaging is first exercised by the tag workflow. `read:`
- **FR-016** `[KNOWN GAP]` Dependency updates are manual (no Dependabot). `read:`

### Key Entities

- **Build target**: `<platform>-<arch>`; **Runtime package**: `@github/copilot-sdk-<target>`; **Artifact**: file attached to the draft release.

## Success Criteria *(mandatory)*

- **SC-001**: A tag that matches `package.json` produces a draft release with artifacts for all three OSes and a checksum file (real: v0.1.0-alpha.1).
- **SC-002**: A build lacking the runtime fails in CI instead of shipping (read: `afterPack`; re-verified positive path 2026-10-16).

## Assumptions

- GitHub-hosted runners and `npm pack` can fetch `@github/copilot-sdk-<target>` for a non-native architecture.
- Users accept first-run OS warnings for an unsigned alpha.
