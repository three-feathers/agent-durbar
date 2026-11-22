# Implementation Plan: Agent Durbar self-update, fork-friendly (spec 118)

**Branch**: `118-self-update` | **Date**: 2026-11-22 | **Spec**: [spec.md](spec.md)

## Summary

Phase 1 (all OSes, unsigned): a pure feed module and a main-process checker reusing spec 081's request stack, a build-time update source, an Update card and dialog in the renderer, a verified download, and a pre-update backup. Phase 2: in-place apply for Windows NSIS and Linux AppImage behind a signature check (D3 C). Phase 3 (macOS in place) waits for spec 014 signing (D1). No new runtime dependency in phase 1; electron-updater is not used (D4 below).

## Technical context

- Electron main: `src/main/netget.ts` (`net.request`, manual redirects, injected request layer), `src/main/officialinstall.ts` (per-hop allow-list, caps, private folder), `src/main/updatecheck.ts` (start-check orchestration for agent apps), `src/main/updatepolicy.ts` (policy, `none` today), `src/main/nativeconfirm.ts`, `src/main/openwith.ts`, `src/main/settings.ts`.
- Shared pure code: `src/shared/updatecheck.ts` (`decide`, `announceRule`, `startCheckAllowed`, `policyView`, strict version parsing FR-005 of 081), `src/shared/redact.ts`.
- Build: `scripts/copy-assets.js` (writes `dist/renderer/appversion.js`, spec 008 FR-179), `.github/workflows/release.yml` (assets, `SHA256SUMS.txt`, attestations), `scripts/release-notes.js` + `scripts/changelog.js` (Highlights, FR-173).
- Tests: `scripts/run-tests.js`, `scripts/test-suites.txt`, UI drivers in `scripts/ui-suite.js`, simulator `DURBAR_SIM=15`.

## Constitution check

| Principle | How the plan holds it |
|---|---|
| I Spec Kit | This PR is spec, plan, tasks only; each build PR ticks its tasks. |
| II Adapters | Nothing touches `AgentAdapter`; the feature lives in `src/main/selfupdate*.ts`, `src/shared/selfupdate.ts` and a renderer card. No Copilot types. |
| III Safe by default, no secrets | One allow-listed GET, no credentials or identifiers; notes are text only; download verified before it can be opened; no shell, fixed argv; backup excludes every secret location; override needs a native confirmation; policy fails closed. |
| IV No AI credits | No agent involvement; tests use a fake request layer; the simulator has a canned feed. |
| V Calm UI | One menu line, one toast per version, one dialog; 10.5 px minimum; checked at 1440x900 and 1280x800. |
| VI Parity | Install type and paths through injected `platform`/env; `path.win32`/`path.posix` in pure code; per-OS table in the spec with `[KNOWN GAP]` where not checked on a real machine. |
| VII Quality gates | Mutant-checked refusal tests (tasks.md). |
| VIII Honest limits | "Checked against the release's checksum list", never "signed", until D3 C; macOS in place stated as impossible unsigned. |

## Design decisions

- **D1 Request**: `GET https://api.github.com/repos/<slug>/releases?per_page=30` instead of `releases/latest` (one request gives the releases in between for the dialog; pre-releases and drafts filtered client-side). `netget.ts` grows a second allow-list function `selfUpdateAllowed(url, slug)` beside `lookupAllowed`; the agent-app list is not widened.
- **D2 Pure core** `src/shared/selfupdate.ts`: `parseRepoSlug`, `sameRepo`, `validateFeed(json, slug)`, `pickTarget(running, releases, skip)`, `isBreaking(running, target, releases)`, `assetFor(installType, arch, version, assets)`, `parseSums(text, name)`, `notesText(body)` (strip control/bidi, `redact`, `maskHomePaths`, clip), `installType(platform, env, packaged)`, `cadenceDue(now, lastCheck, switch, policy, local)`, `snoozeState`. Everything testable without Electron.
- **D3 Main** `src/main/selfupdate.ts`: scheduler (start after the office, 24 h timer, `Check now`), the request through `netget`, results in memory + `updates.lastCheck`, IPC `selfupdate:get`, `selfupdate:check`, `selfupdate:snooze`, `selfupdate:skip`, `selfupdate:setSource`, `selfupdate:download`, `selfupdate:cancel`, `selfupdate:open` (registered through the existing IPC guard and channel list, `test:ipcchannels`). `src/main/selfupdatedownload.ts`: streaming SHA-256, per-hop allow-list, caps, private temp folder, move to Downloads.
- **D4 Apply without electron-updater**: electron-updater needs `publish` config and `latest*.yml` files, verifies only its own sha512 from the same release, and on macOS requires signing anyway. Our own NSIS launch (`spawn(installer, ['/S', '--updated', '--force-run'], { shell: false, detached: true })`) and AppImage rename are small and keep one allow-list. Revisit if D1 buys signing (Squirrel.Mac then makes electron-updater the simpler macOS path).
- **D5 Build source**: `scripts/updatesource.js` (pure resolver: env `DURBAR_UPDATE_REPO` > `GITHUB_REPOSITORY` > `package.json` `repository`, with `origin: 'env'|'ci'|'local'`), called by `copy-assets.js`, writes `dist/main/updatesource.json` `{slug, origin}`. `release.yml` build job passes nothing new (Actions sets `GITHUB_REPOSITORY`); the `verify` job summary prints the slug.
- **D6 Breaking marker**: `scripts/changelog.js` accepts `  Breaking: <one line>` (same character rules as `Highlight:`); `scripts/release-notes.js` writes `### Breaking` with those lines above Highlights. Spec 008 gets a dated delta.
- **D7 Renderer**: a card in Settings > About (the existing About section) and a line in the More menu (⋯); the dialog builds DOM with `textContent` only. The simulator answers the same IPC from canned data (`src/renderer/sim*`).
- **D8 Backup**: `src/main/preupdatebackup.ts` copies `settings.json` and the session-names/index files into `userData/backups/pre-update-<from>-<to>/` with an explicit allow-list of file names (not a folder copy), keeps 3; switches to spec 109's writer when it lands.
- **D9 Signature (if D3 C)**: `release.yml` signs `SHA256SUMS.txt` with an Ed25519 key from a repository secret (`DURBAR_UPDATE_SIGNING_KEY`, set by an owner), publishes `SHA256SUMS.txt.sig`; the public key is baked like the slug (`updatesource.json` `{publicKey}`); verify with `crypto.verify(null, data, publicKey, sig)`. A fork sets its own secret and key; no key = no phase 2.

## Testing plan (all offline)

| Test file (new, in `test-suites.txt`) | Covers | Planted mutants it must catch |
|---|---|---|
| `scripts/test-selfupdate-repo.ts` | FR-001, FR-003 parser and resolver | accept `github.com.evil/x`, `https://github.com/a/b/c`, `git@github.com:a/b`, `https://u:p@github.com/a/b`; case-sensitive compare; env order swapped |
| `scripts/test-selfupdate-feed.ts` | FR-007, FR-008, FR-009 | keep a draft/pre-release; accept `html_url` of another repo; accept asset URL of another tag; accept a 3xx; drop the size cap; `0.1→0.2` not breaking; `### Breaking` ignored |
| `scripts/test-selfupdate-notes.ts` | FR-010 | skip bidi strip; skip `redact`; skip clip |
| `scripts/test-selfupdate-download.ts` | FR-013, FR-014 | off-list hop host allowed; 4th hop allowed; hash compare skipped; two matching SUMS lines accepted; file kept after mismatch; overwrite an existing Downloads file |
| `scripts/test-selfupdate-schedule.ts` | FR-004, FR-005, FR-016, SC-001 | switch ignored; `updates.mode: off` ignored; unreadable policy fails open; dev run checks; `local` build checks by default; snooze ignored; 24 h simulated run with switch off makes > 0 calls |
| `scripts/test-selfupdate-installtype.ts` | FR-012 | portable detected as NSIS; extracted AppImage as AppImage; wrong arch asset |
| `scripts/test-preupdatebackup.ts` | FR-017 | copy a `.env`, a token file, `~/.claude` path; keep 4 |
| `scripts/test-changelog.js` (extend) | D6 | `Breaking:` with a link accepted; `### Breaking` missing from notes |
| UI driver `selfupdate-dialog` | FR-011, SC-004 | `innerHTML` render of the body; *Download* enabled before the breaking tick |

Real checks (owner's machines, after each phase; no AI credits): Windows NSIS open and phase 2 silent install; macOS dmg open and quarantine flag; Linux AppImage replace. Recorded as `real:` in the spec.

## Rollout

P1 pure core + tests → P2 build source + release.yml summary + changelog `Breaking:` → P3 main checker + IPC + settings + simulator → P4 renderer card and dialog + docs + screenshots → P5 download + backup (phase 1 complete) → P6 phase 2 apply (after D3). Phase 3 after D1.

## Complexity tracking

None: no new dependency, no new process, one new network request (allow-listed, switchable, policy-controlled).
