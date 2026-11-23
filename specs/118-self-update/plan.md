# Implementation Plan: Agent Durbar self-update, fork-friendly (spec 118)

**Branch**: `118-self-update` | **Date**: 2026-11-22 | **Spec**: [spec.md](spec.md)

## Summary

Phase 1 (all OSes, unsigned): a pure feed module and a main-process checker on spec 081's request factory (new feed and streaming-download functions beside the agent-app ones), a build-time update source, an Update card and dialog in the renderer, a checked download, and a pre-update backup. Phase 2: in-place apply for Windows NSIS and Linux AppImage, never without a signature checked against a key built into the build (FR-014). Phase 3 (macOS in place) waits for spec 014 signing (D1). No new runtime dependency in phase 1; electron-updater is not used (D4 below).

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
| III Safe by default, no secrets | One allow-listed GET, no credentials, tokens or identifiers (FR-025); main decides every URL, path and source, the window sends version strings only (FR-024); notes are text only; download checked against the checksum list, marked as an internet download (FR-015) and re-hashed before it can be opened; in-place apply only with a built-in-key signature; no shell, fixed argv; backup excludes every secret location; override needs a native confirmation; policy fails closed. |
| IV No AI credits | No agent involvement; tests use a fake request layer; the simulator has a canned feed. |
| V Calm UI | One menu line, one toast per version, one dialog; 10.5 px minimum; checked at 1440x900 and 1280x800. |
| VI Parity | Install type and paths through injected `platform`/env; `path.win32`/`path.posix` in pure code; per-OS table in the spec with `[KNOWN GAP]` where not checked on a real machine. |
| VII Quality gates | Mutant-checked refusal tests (tasks.md). |
| VIII Honest limits | "Checked against the release's checksum list", never "verified" or "signed"; the checksum's limit in the user docs (FR-022); macOS in place stated as impossible unsigned. |

## Design decisions

- **D1 Request**: `GET https://api.github.com/repos/<slug>/releases?per_page=30` instead of `releases/latest` (one request gives the releases in between for the dialog; pre-releases and drafts filtered client-side; FR-009 covers a page that does not reach the running version). `netget.ts` gets `makeFeedGet(factory)` (JSON body, 2 MiB cap counted while reading, `Accept: application/vnd.github+json`) with its own `feedAllowed(url, slug)`; `makeLookupGet` and spec 081's `lookupAllowed` stay unchanged. No `Authorization` header anywhere (FR-025).
- **D2 Pure core** `src/shared/selfupdate.ts`: `parseRepoSlug`, `sameRepo`, `validateFeed(json, slug)`, `pickTarget(running, releases, skip)`, `isBreaking(running, target, releases)`, `assetFor(installType, arch, version, assets)`, `parseSums(text, name)`, `notesText(body)` (strip control/bidi, `redact`, `maskHomePaths`, clip), `installType(platform, env, packaged)`, `cadenceDue(now, lastCheck, switch, policy, local)`, `snoozeState`. Everything testable without Electron.
- **D3 Main** `src/main/selfupdate.ts`: scheduler (start after the office, 24 h timer, `Check now`), the request through `netget`, results in memory + `updates.lastCheck`, IPC `selfupdate:get`, `selfupdate:check`, `selfupdate:snooze`, `selfupdate:skip`, `selfupdate:setSource`, `selfupdate:download`, `selfupdate:cancel`, `selfupdate:open` (registered through the existing IPC guard and channel list, `test:ipcchannels`). `src/main/selfupdatedownload.ts`: a new streaming download (not `makeDownloadGet`, which buffers in memory): exclusive create (`fs.open(path, 'wx')`) in `userData/updates/`, `lstat` refuses links, SHA-256 while writing, per-hop allow-list with `new URL()`, caps, cancel, partial-file cleanup at start; then the internet mark (D10), an exclusive copy to Downloads (`fs.copyFile(..., COPYFILE_EXCL)`, numbered name) and a second hash of the copy; `rehash(version)` before open or apply. Redirect URLs never leave the function (FR-025). IPC handlers take version strings only and look everything up in main's last validated feed (FR-024).
- **D4 Apply without electron-updater** (only after FR-014's signature check passes): electron-updater needs `publish` config and `latest*.yml` files, verifies only its own sha512 from the same release, and on macOS requires signing anyway. Our own NSIS launch (`spawn(installer, ['/S', '--updated', '--force-run'], { shell: false, detached: true })`) and AppImage rename are small and keep one allow-list. Revisit if D1 buys signing (Squirrel.Mac then makes electron-updater the simpler macOS path).
- **D5 Build source**: `scripts/updatesource.js` (pure resolver: env `DURBAR_UPDATE_REPO` > `GITHUB_REPOSITORY` > `package.json` `repository`, with `origin: 'env'|'ci'|'local'`), called by `copy-assets.js`, writes `dist/main/updatesource.json` `{slug, origin}`. `release.yml` build job passes nothing new (Actions sets `GITHUB_REPOSITORY`); the job summary prints `node scripts/updatesource.js --summary` (T028, after #2038). At run time `src/main/updatesource.ts` reads only that file through the pure `parseUpdateSourceFile` of `src/shared/selfupdate.ts`.
- **D6 Breaking marker (owner D6 = B)**: `releases.json` at the repository root (FR-026). Pure `parseReleasesJson(text)` in `src/shared/selfupdate.ts` (key-counting tokenizer for duplicates, then exact-key typing), shared by the app and `scripts/releases-check.ts` (compiled with the other scripts, as it imports the shared parser; `npm run releases:check [--version X.Y.Z] [--ref <commit>]`, reads the file with `git show <ref>:releases.json` via `execFileSync` with an argument array). `release.yml`'s `verify` job runs it on the tagged commit with the tag's version (T028, after #2038); `npm test` runs it on the working tree (valid file only). The app reads the tag's raw file through `makeFeedGet` with its own allow-list entry (FR-007, FR-009). Spec 008 gets a dated delta for the `verify` step.
- **D7 Renderer**: a card in Settings > About (the existing About section) and a line in the More menu (⋯); the dialog builds DOM with `textContent` only. The simulator answers the same IPC from canned data (`src/renderer/sim*`).
- **D8 Backup**: `src/main/preupdatebackup.ts` copies `settings.json` and the session-names/index files into `userData/backups/pre-update-<from>-<to>/` with an explicit allow-list of file names (not a folder copy), keeps 3; switches to spec 109's writer when it lands.
- **D9 Signature (only if phase 2 is ever started; owner D3 = no scheme now)**: a separate `sign` job in `release.yml`, tag-triggered, `environment: update-signing` (required reviewers, owner setting), reads the Ed25519 private key from that environment's secret only (Environment settings by an owner: required reviewers, *Prevent self-review*, `v*`-only deployments; a `v*` tag ruleset; the next key offline with an owner, FR-014), writes `SHA256SUMS.txt.sig` as `durbar-sig-v1 <key-id> <base64 sig>` over the exact bytes of `SHA256SUMS.txt` (FR-014), before the draft is created. The current and next public keys are baked by D5 into `updatesource.json` `{keys: [{id, publicKey}]}`; verify with `crypto.verify(null, sums, publicKey, sig)`. Rotation and leak steps in FR-014, written into `SECURITY.md`. A fork sets up its own environment and key; no key = no phase 2.
- **D10 Internet marks**: Windows: `fs.writeFile(path + ':Zone.Identifier', '[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=<release page>\r\n')` then read it back; macOS: `execFile('/usr/bin/xattr', ['-w', 'com.apple.quarantine', '0081;<hex seconds>;Agent Durbar;', path], { shell: false })` then `xattr -p` to confirm; Linux: none. Failure removes *Open installer* (FR-015). Considered and not chosen: Chromium's own download manager (`session.downloadURL`), which sets both marks itself but follows redirects without our per-hop allow-list and gives no streaming hash; revisit if D10 fails on real machines (T020).
- **D11 Whole-app gate (phase 2)**: a new gate that blocks every session start and resume and ends every open session after the confirmation; spec 081's `UpdateGate` is per agent app and is not reused.

## Testing plan (all offline)

| Test file (new, in `test-suites.txt`) | Covers | Planted mutants it must catch |
|---|---|---|
| `scripts/test-selfupdate-repo.ts` | FR-001, FR-003 parser and resolver | accept `github.com.evil/x`, `https://github.com/a/b/c`, `git@github.com:a/b`, `https://u:p@github.com/a/b`; case-sensitive compare; env order swapped; run-time `GITHUB_REPOSITORY` / `DURBAR_UPDATE_REPO` changes the source |
| `scripts/test-selfupdate-feed.ts` | FR-007, FR-008, FR-009 | keep a draft/pre-release; accept `html_url` of another repo; accept asset URL of another tag, with a query, a port or `user@`; accept a 3xx; drop the size cap; accept a non-array body, a string `size`, a number `body`, a bad `published_at`, duplicate tags, an asset name with `..`; `0.1→0.2` not breaking; a `breaking: true` entry in the tag's `releases.json` ignored; running version older than the page not treated as breaking |
| `scripts/test-selfupdate-notes.ts` | FR-010 | skip bidi strip; skip `redact`; skip clip |
| `scripts/test-selfupdate-download.ts` | FR-013, FR-014, FR-015, FR-025 | off-list hop host allowed; 4th hop allowed; hash compare skipped; two matching SUMS lines accepted; file kept after mismatch; overwrite an existing Downloads file; follow a planted symlink; use the feed's asset name as the path; skip the re-hash before open; open after the mark failed; redirect query string in an error text; signature with an unknown key-id or a flipped byte accepted; **replay**: a validly signed `SHA256SUMS.txt` of v0.1.28 served with the v0.1.29 release accepted (mutant: drop the target-version check of the signed names); phase 2 offered without a built-in key |
| `scripts/test-selfupdate-ipc.ts` | FR-024 | a channel accepts a URL, a path, `../`, an object or a version not in the feed; `setSource` saves before the read-first check or without the confirmation |
| `scripts/test-selfupdate-schedule.ts` | FR-004, FR-005, FR-016, SC-001 | default not on (D2 = A); a check that keeps running or keeps its timer after the switch or policy turns off mid-request; switch ignored; `updates.mode: off` ignored; unreadable policy fails open; dev run checks; `local` build checks by default; snooze ignored; 24 h simulated run with switch off makes > 0 calls or arms a timer |
| `scripts/test-selfupdate-installtype.ts` | FR-012 | portable detected as NSIS; extracted AppImage as AppImage; wrong arch asset |
| `scripts/test-selfupdate-appimage.ts` | FR-019 `$APPIMAGE` checks | accept a link, a file owned by someone else, another file in the home folder without `.AppImage`, a relative path, a file that is not the running one |
| `scripts/test-preupdatebackup.ts` | FR-017 | copy a `.env`, a token file, `~/.claude` path; keep 4 |
| `scripts/test-releases-json.ts` | FR-026, FR-009, T008 check script | accept an unknown key (top level or entry), `breaking: "false"`, a `v0.1.28` key, a pre-release key, a duplicate version key, `breaking: true` with empty `action`, `notes` with `<`, a file over 256 KiB; `releases:check` passes when the released version has no entry (fixture: a temp git repository with a tag); a missing or invalid file shown as safe instead of *Breaking: unknown*; the raw URL built from the window's argument or another slug |
| UI driver `selfupdate-dialog` | FR-011, SC-004 | `innerHTML` render of the body; *Download* enabled before the breaking tick |

Real checks (owner's machines, after each phase; no AI credits): Windows NSIS open and phase 2 silent install; macOS dmg open and quarantine flag; Linux AppImage replace. Recorded as `real:` in the spec.

## Rollout

P1 pure core + tests → P2 build source + release.yml summary + `releases.json` and `releases:check` → P3 main checker + IPC + settings + simulator → P4 renderer card and dialog + docs + screenshots → P5 download + backup (phase 1 complete) → P6 phase 2 apply (after D3). Phase 3 after D1.

## Complexity tracking

None: no new dependency, no new process, one new network request (allow-listed, switchable, policy-controlled).
