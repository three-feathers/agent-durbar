# Implementation Plan (as built): Packaging, CI and draft releases

**Spec**: [spec.md](spec.md) | **Date**: 2026-10-16 | **Kind**: reverse-engineered

## Summary

`electron-builder` packages `dist/` (compiled TypeScript + copied renderer assets) with one Copilot runtime package per target. GitHub Actions runs CI for every PR/push and a tag-driven release that only ever creates a draft.

## Technical Context

- **Tools**: Electron 44.8.0, electron-builder 26.15.3, Node 22 in CI, `npm ci`.
- **Files**: `package.json` (`build`, scripts `pack:dir`, `dist`, `dist:mac:arm64|x64`, `dist:win`, `dist:linux`), `scripts/prepare-runtime.js`, `scripts/after-pack.js`, `scripts/copy-assets.js`, `build/icon.*`, `.github/workflows/ci.yml`, `release.yml`, `src/adapters/runtime.ts`, `scripts/test-runtime.ts`.
- **Testing**: `npm run test:runtime`; CI matrix; `pack:dir` smoke (`afterPack` assertions).

## Constitution Check

| Principle | Result |
| --- | --- |
| III Safe by default / no secrets | Release workflow has no secrets beyond `github.token`; `contents: write` only in the draft job; actions pinned by SHA. OK |
| VI Parity | CI on 3 OSes; release builds 3 OSes; real use only on Linux. **Partial** |
| VII Gates | typecheck + build + test on 3 OSes; screenshots not applicable. OK |
| VIII Honest limits | README says unsigned/not notarized/no auto-update; FR-010 (never run on macOS/Windows) is stated in README as "macOS/Windows untested". OK |

## As-built architecture

```text
npm run dist:<target> = build (tsc + copy-assets) -> prepare-runtime <target> -> electron-builder --<os> --publish never
electron-builder -> asar (dist, package.json) + asarUnpack(@github/copilot-sdk-*, koffi) -> afterPack check -> dmg/zip | nsis/portable | AppImage
runtime: app (packaged) -> unpackedRuntimePath() -> CopilotClient(RuntimeConnection.forStdio({path}))

ci.yml        pull_request, push main: build-test (3 OS) -> package-smoke (ubuntu, pack:dir)
release.yml   tag v*: build (mac, win, linux; tag==version check; typecheck; test; package) -> draft-release (checksums, gh release create --draft)
```

## Project Structure (documentation)

```text
specs/008-packaging-and-release/
├── spec.md
├── plan.md
└── tasks.md
```

## Verification status

| Claim | How | Result |
| --- | --- | --- |
| `npm run pack:dir` on Linux, afterPack runtime check | run locally 2026-10-16 | pass (exit 0) |
| `npm run test:runtime` | `npm test` | pass 2026-10-16 |
| CI green on main (3 OS + smoke), tag run produced a draft release | `gh run list`, `gh release list` 2026-10-16 | pass; release is **Draft** |
| Packaged app launch on macOS/Windows, Gatekeeper/SmartScreen steps in README | none | **not verified** |
| Signing/notarization | none | not done (feature 014) |
