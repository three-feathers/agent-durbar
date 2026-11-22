# Feature Specification: Agent Durbar self-update, fork-friendly

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Durbar's own update (owner request 2026-11-22, "like Duniya, including forks"): a daily check of the GitHub releases of the repository the build came from, an Update card with the release notes as plain text and a breaking-changes card, snooze and skip, a verified download (SHA256SUMS.txt) the person opens; in-place apply per OS later (Windows NSIS and Linux AppImage unsigned, macOS only after signing)
status: draft
note: spec, plan, tasks only; nothing built; owner decisions D1..D7 open (signing = money, default on/off, signature scheme, fork source rules)
-->

**Feature Branch**: `118-self-update` (spec, plan and tasks only). The build is one small PR per task group (P1..P6 in [tasks.md](tasks.md)).

**Created**: 2026-11-22

**Status**: Draft. Nothing built, nothing in `src/` changes in this PR, no dependency is added. The owner decisions D1..D7 below are open; the proposed answers are marked *Proposed*.

**Input**: Owner request (Vikram, team chat, 2026-11-22 14:18 UTC, relayed by his coordinating agent): "Can we implement auto update like what duniya does including making it work for forks? https://github.com/vikramgorla/duniya".

## Summary

Agent Durbar has no own update today: a person learns of a new version from GitHub or the team. This spec adds, in phases:

1. **Phase 1, all three OSes, unsigned builds (recommended first):** Durbar checks the GitHub releases of the repository **its build came from** (a fork checks the fork), once a day, and only that. A newer stable release shows an **Update available** card with every release in between (notes as plain text), a **breaking changes** card when one of them is breaking, *Remind me in 7 days* and *Skip this version*. **Download** fetches the installer for this OS and install type, verifies it against the release's `SHA256SUMS.txt`, and offers *Open installer* and *Show in folder*. Nothing installs by itself; the person runs the installer.
2. **Phase 2, in-place apply where it works unsigned, every time with consent:** Windows NSIS install (run the verified installer, quit, restart) and Linux AppImage (replace the AppImage file, keep the old one for a rollback).
3. **Phase 3, macOS in place: only after Developer ID signing and notarization** (spec 014, a purchase, owner approval). Until then macOS stays at phase 1.

Every phase: a pre-update backup of Durbar's own settings and session index (never secrets), the organization policy keys reserved by spec 076 FR-174 (`updates.mode`, `updates.feedUrl`), a Settings switch that makes zero network calls when off, the simulator with a canned feed, and tests that run offline.

## What exists today (spec 021 FR-031: reuse first)

`git grep -n "releases/latest\|selfupdate\|autoUpdater\|electron-updater" src` finds only spec 081's agent-app lookups. Durbar has **no** own update check. What this spec reuses:

| Capability | Where | Used for |
|---|---|---|
| Durbar's own HTTP requests: `net.request` on the app session (proxy, OS certificates), `redirect: 'manual'`, `credentials: 'omit'`, no cookies, `User-Agent: AgentDurbar`, injected request layer | `src/main/netget.ts` (spec 081 FR-026, spec 076 FR-155/156) | the release list request and the downloads, with a new exact allow-list (FR-007) |
| Per-hop redirect allow-list, size cap, time limit, private folder (0700/0600) | `src/main/officialinstall.ts` (spec 060 FR-001) | the download hops to GitHub's asset host (FR-013) |
| Start check after the office is shown, one result kept in memory, failures silent apart from the card, the start-check switch, fail-closed policy | spec 081 FR-003, FR-022; `src/main/updatecheck.ts`, `src/shared/updatecheck.ts` (`startCheckAllowed`, `policyView`, `decide`, `announceRule`) | the same rules for Durbar's own check (FR-004, FR-006) |
| Organization policy keys reserved for this updater: `updates.mode` (`off`/`notify`/`auto`), `updates.feedUrl` (https) | spec 076 FR-174 (reserved, listed as *No updater in this version*); `src/main/updatepolicy.ts` (answers `none` until 076's reader lands, issue #1125) | FR-005 |
| Native confirmation dialog | `src/main/nativeconfirm.ts` | changing the update source (FR-003), every apply (FR-019) |
| `shell.openPath` / `shell.showItemInFolder` behind an injected interface | `src/main/openwith.ts` | *Open installer*, *Show in folder* (FR-015) |
| Secret masking | `src/shared/redact.ts` (`redact`, `maskHomePaths`) | release notes and error details (FR-010) |
| Settings in one JSON file in userData | `src/main/settings.ts` (spec 011 FR-012) | switch, snooze, skip, source override (FR-021) |
| What's new after an update, notes shipped in the app | spec 107 (specified, not built) | after an update the What's new strip shows; this spec does not build a second one (FR-018) |
| Setup export without secrets | spec 109 (specified, not built) | the pre-update backup reuses its writer once it exists (FR-017) |
| Release assets and `SHA256SUMS.txt`, build provenance attestations on every asset | spec 008 FR-007, FR-132; `.github/workflows/release.yml` | the checksum check (FR-013) and the signature options (D3) |
| Highlights block built from changelog fragments | spec 008 FR-173; `scripts/changelog.js`, `scripts/release-notes.js` | the new `Breaking:` fragment field (FR-009) |

What does not exist and this spec adds: a release-feed reader for Durbar itself, a build-time update source, the Update card and dialog, the verified download, the pre-update backup, and (phase 2) the apply step.

## Evidence, read: Duniya's update system (2026-11-22)

`read:` a shallow clone of `vikramgorla/duniya` (default branch, 2026-11-22), read only; no script of it was run. Duniya is a Node server installed from a git checkout, so its *mechanism* (git fetch + checkout + `npm ci`) does not carry over to a packaged desktop app; its *behaviour* does.

| File | What it does |
|---|---|
| `deploy/update.sh` | Updates the checkout in place to a tag or branch: `git fetch --tags`, checkout, `npm ci` when the lock file changed, rolls the code back when the install fails. Called by the panel; the app restarts itself. |
| `src/core/updates.js` | `checkForUpdate`: fetches tags from the git remote, newest `v*` tag vs running version, reads `releases.json` **from the target tag** (`git show <tag>:releases.json`, no GitHub API). Settings `mode` = `off`/`notify`/`auto` (default `notify`), `channel` = `stable`/`main`, `at` = time of day, `keepPreUpdate` (1-20, default 3). `updateSource()` = the checkout's `remote.origin.url` without credentials; `setUpdateSource(input)` accepts only `owner/name` or `https://github.com/owner/name`, sets the remote, fetches the new source's tags first and puts the old remote back if that fails; logs an Activity line. |
| `src/core/repo.js` | One source of truth: `repository` in `package.json`. `parseRepo` accepts exactly `owner/name`, `github:owner/name`, `https://github.com/owner/name[.git][/]` (strict owner/name patterns, no other host, no ssh, no credentials, no query, no path); `sameRepo` compares case-insensitively. |
| `src/core/update-decision.js` | The scheduler ticks every 10 min and re-checks when the saved check is older than 6 h (systemd installs only). Breaking release: announced once per version (banner, Updates card, Activity, WhatsApp code to owners); *Remind me in 7 days* (`SNOOZE_DAYS = 7`) or *Dismiss* (until a newer breaking release); codes owner-only, single use, 3 days. |
| `src/core/releases.js` | `normalizeReleases` clips every field (title 160, summary 1200, 10 actions of 400, 40 changes of 300) and drops a `docs` path that does not match `^[\w./#-]{1,200}$`; `analyzeJump` = breaking when the major grows or any release between running and target is marked breaking; `safeTarget` = newest release before the first breaking one. |
| `releases.json` | Per version: `breaking`, `title`, `changes[] {type: new/improved/fixed/removed, text}`, and for breaking ones `summary`, `actions[]`, `data` (migrated/not-migrated/unchanged), `docs`. CI fails a version without an entry and a major bump without a breaking entry. |
| `scripts/release-notes.mjs`, `.github/workflows/release.yml` | The GitHub release title and notes come from `releases.json` ("⚠️ Breaking — vX.Y.Z" for breaking releases), GitHub's generated notes appended; `--sync` brings older release pages in line. No checksum or signature of release assets was seen in this workflow (Duniya ships source, not binaries). |
| `docs/backups-and-updates.md`, `docs/upgrading.md` | User view: one update row (*Up to date · vX · checked 2m ago*), *Update to vX* opens every release in between, newest first, grouped new/improved/fixed/removed, breaking ones marked with what to do, *Make a backup first* (on by default); *Notify me* / *Install automatically* / *Off*. Every update makes a local encrypted backup first; no backup, no update. **Update source** in Settings: "the project" or "not the project", change to a fork or back (*Use the project*), the new source is read before anything changes. The root helper never takes its source from the app. |
| `specs/045-breaking-updates/{spec,plan,tasks}.md` | The breaking-update rules above (auto never crosses a breaking release; told once; snooze 7 days / dismiss; backup before every update; release data in `releases.json`). |
| `specs/084-configurable-repo/spec.md` | The fork rules: no owner/name in code, all URLs derived from `package.json` `repository`; a fork-setup workflow rewrites URLs; update source shown and switchable, validated strictly, old source restored on failure, credentials never shown; admin MCP `set_update_source` (confirmed). |
| `specs/008-install-and-exposure/contracts/install-and-updates.md` | Installer `--repo URL --branch B` and `--update-mode off|notify|auto` (default `notify`); Updates API `GET /api/updates`, `PUT /api/updates/settings`, `POST /api/updates/check`, `POST /api/updates/apply`. |
| `specs/051-os-updates/{spec,plan,tasks}.md` | Ubuntu OS package updates through a root helper (`apt-get full-upgrade`, phased updates, restart needed). Server-only; nothing for Durbar. |
| `docs/diagrams/update-decision.mmd` | New release → crosses a breaking release or a new major? no: update mode (auto = backup then install at the set time; notify = shown) / yes: auto stops at the last safe release, owner told once, decides *Update* / *Remind me in 7 days* / *Dismiss*. |
| `docs/site/img/card-update-notes.webp` | Looked at: dialog *Update to v2.39.0?*, "You are running v2.22.0. 24 releases · 126 changes come with it", per release a folding section (version, title, New / Improved / Removed bullets), buttons *Not now* and *Update to v2.39.0*. |

**Not verified** (`[KNOWN GAP]`): `docs/diagrams/oci-stack-update.mmd`, `update-recreate-remove.mmd`, `docs/site/img/card-updates.webp` and the panel code (`src/panel/routes/updates.js`, `src/panel/admin-tools.js`) were listed, not read; Duniya's behaviour on a running server was not observed; the MCP tools `set_update_source` and `snooze_update_decision` were not called.

**What carries over**: notify-first; every release in between shown before the update; a breaking release needs an explicit decision; snooze 7 days and dismiss-until-newer; backup first; the update source is the repository the copy came from, shown in Settings, switchable to `owner/name` only after reading the new source, strict parsing, case-insensitive comparison. **What does not**: the git mechanism, *Install automatically* at a time of day (an unsigned desktop app cannot install silently on macOS, and the owner's rule is consent every time, FR-019), WhatsApp codes.

## Per OS: what is possible now (unsigned) and after signing

Facts from spec 008: macOS builds are ad-hoc signed (`identity: "-"`), not Developer ID signed, not notarized (FR-009 `[KNOWN GAP]`, spec 014 needs a purchase); Windows builds are not Authenticode signed; `publish: null`, so electron-builder writes no `latest*.yml` update files; formats: macOS `.dmg` and `.zip` (arm64, x64), Windows NSIS `Setup.exe` and `portable.exe` (x64), Linux `AppImage` (x64); no `.deb`.

| OS / install | Phase 1 (unsigned, now) | Phase 2: in place (unsigned) | After signing (spec 014, money) |
|---|---|---|---|
| Windows, NSIS (`Agent-Durbar-Setup-*.exe`) | check, notes, verified download, *Open installer* (the person clicks through the NSIS wizard) | **possible**: run the verified installer after a native confirmation, Durbar quits, the installer replaces the per-user install and starts Durbar. electron-updater's NSIS path works unsigned (its publisher check applies only when `publisherName` is set). `[KNOWN GAP]` SmartScreen behaviour for an app-launched installer not checked on a real PC | SmartScreen reputation builds faster; the publisher check can then be turned on |
| Windows, portable (`*-portable.exe`) | check, notes, verified download, *Show in folder* | **not planned**: the running `.exe` cannot replace itself; the person swaps the file | same |
| Linux, AppImage | check, notes, verified download (new file, `0755`), *Show in folder* | **possible**: replace the file at `$APPIMAGE` (write beside it, verify, rename over, keep `.old` for a rollback); needs write access to that folder, else phase 1 | AppImage has no signing need; a signature check (D3) still helps |
| Linux, other (dev run, extracted AppImage, unknown) | check and notes only, *Open the release page* | no | no |
| macOS, `.dmg` / `.zip` | check, notes, verified download, *Open installer* (mounts the dmg; the person drags the app). `[KNOWN GAP]` whether a file Durbar downloads carries the quarantine flag (Gatekeeper prompt) is not checked on a real Mac; Durbar never adds or strips it (FR-015) | **not possible** with Squirrel.Mac (electron-updater on macOS needs the app and the update signed with the same Developer ID). Replacing the `.app` bundle by hand is technically possible but not proposed (D1 option C) | **possible**: electron-updater (Squirrel.Mac) or the same flow as Windows, after Developer ID + notarization |

## Clarifications

### Owner decisions (open, numbered)

- **D1 Signing (money).** In-place update on macOS needs Developer ID signing and notarization (Apple Developer Program, yearly fee); Windows Authenticode is optional but helps SmartScreen. Options: A buy neither now, macOS stays at phase 1; B Apple only; C replace the macOS `.app` unsigned (not recommended: fragile, bypasses the Gatekeeper model); D both. *Proposed*: A, revisit with spec 014. Needs owner approval (money).
- **D2 Default of the daily check.** A on, once a day, with a Settings switch; B off until the person turns it on; C ask once on the first start. *Proposed*: A (spec 081 chose on for agent apps, Q6 = A; the request carries no identifier, FR-006).
- **D3 Signature scheme beyond the checksum.** A none: `SHA256SUMS.txt` only, honest limit: it comes from the same release as the files, so it proves the download is the file the release lists, not who made the release; B **GitHub build provenance attestations** (already made by `release.yml`, spec 008 FR-132): verify the sigstore bundle in the app; needs a sigstore verifier dependency and a bundled trust root, and a fork's attestations name the fork's workflow, which the app must pin; C **minisign / Ed25519 key per repository**: the release job signs `SHA256SUMS.txt` with a private key kept as an Actions secret, the public key is built into the app; verification is Node's `crypto.verify` (no dependency); a fork makes its own key, a fork without one gets "signature: not set up for this build". *Proposed*: A in phase 1, C before phase 2 (in-place apply must not run an installer that only a checksum vouches for). C needs a repository secret = repo settings = owner approval.
- **D4 Fork source rules.** A the built-in source only (no override); B override in Settings with a warning and native confirmation (FR-003), GitHub `owner/name` only; C B plus any HTTPS feed URL. *Proposed*: B; an organization may still set `updates.feedUrl` (FR-005).
- **D5 Cadence.** A at every start; B at start when the last check is older than 24 h, and every 24 h while Durbar stays open; C once a week. *Proposed*: B (spec 081 chose start-only for agent apps; Durbar itself often runs for days).
- **D6 Breaking marker.** A a new `Breaking:` line in changelog fragments (spec 008 FR-173 style) that puts a `### Breaking` section into the release notes, plus a minor bump on `0.x` or a major bump counts as breaking; B a `releases.json`-style file in the repository read from the tag (as Duniya); C an extra release asset. *Proposed*: A (one notes source, as today).
- **D7 Where the download goes.** A the Downloads folder (never overwriting a file: a numbered name); B a private folder in userData, removed after the install. *Proposed*: A, so the person keeps the installer.

### Open questions (not owner decisions; for review)

- **Q1** Version scheme of forks: a fork that keeps upstream version numbers and pulls upstream tags will compare equal or lower; the check compares only versions of the configured source, so it works, but a fork must bump its own versions. Documented in `docs/install.md` (FR-022).
- **Q2** GitHub's unauthenticated API limit is 60 requests per hour per IP address; a company behind one NAT address with many Durbar copies checking at start could hit it. The check then says *GitHub is busy, will try tomorrow*; no retry loop (FR-004).

## User Scenarios & Testing *(mandatory)*

### User Story 1: I hear about a new version, calmly (Priority: P1)

Ana runs v0.1.27. The day v0.1.29 is published, the top bar's More menu (⋯) and Settings > About show a small *Update available: v0.1.29* line, and one toast says so once. Opening it shows *You are running v0.1.27. 2 releases come with it*, each release's notes as plain text (newest first, long ones folded), *Download*, *Remind me in 7 days*, *Skip this version*.

**Acceptance**: 1. A fake feed with v0.1.28 and v0.1.29 (stable) and v0.1.30-alpha.1 (pre-release) gives *Update available: v0.1.29* and lists two releases. 2. The toast shows once per version (spec 081 `announceRule`). 3. The office, a session start and Settings are never delayed (the check runs after the office is shown, in the background).

### User Story 2: a breaking release is never a surprise (Priority: P1)

v0.2.0 renames floors. The Update dialog starts with a **Breaking changes** card: what changes, what to do, and *Download* is only enabled after *I have read the breaking changes* is ticked. *Skip this version* hides it until a newer release.

**Acceptance**: 1. A fake release with a `### Breaking` section, or a `0.1.x → 0.2.0` jump, shows the card. 2. *Download* stays disabled until the box is ticked. 3. Skip, then a fake v0.2.1: shown again.

### User Story 3: the download is checked before I can open it (Priority: P1)

Ana clicks *Download*. Durbar fetches the Windows NSIS installer (her install type) and `SHA256SUMS.txt` from the same release, checks the hash, and offers *Open installer* / *Show in folder*.

**Acceptance**: 1. Matching hash: offered. 2. Wrong hash, missing line, two lines for one file, a missing `SHA256SUMS.txt`: the file is deleted, the dialog says *The download does not match the release's checksum; nothing was kept*, no *Open*. 3. A redirect to a host off the allow-list, a body over the cap, a timeout: refused, nothing kept.

### User Story 4: a fork checks the fork (Priority: P1)

Ravi forks the repository to `ravi/durbar` and builds releases with the same workflow. His users' copies check `ravi/durbar`, never `three-feathers/agent-durbar`, and the reverse.

**Acceptance**: 1. A build with `GITHUB_REPOSITORY=ravi/durbar` bakes `ravi/durbar`; Settings > About shows *Updates from ravi/durbar (built in)*. 2. A release answer whose `html_url` or asset URL names another repository is refused. 3. A redirect from a renamed repository is not followed: *The update source moved; change it in Settings*.

### User Story 5: I can change the source, with a warning (Priority: P2)

Ravi's user wants upstream releases. Settings > Updates > *Update source*: type `owner/name`; Durbar reads that repository's releases first (nothing changes on failure), then a native confirmation: *Updates from three-feathers/agent-durbar replace this build (built from ravi/durbar)*. The card then always shows *Updates from three-feathers/agent-durbar (changed by you)* and *Use the built-in source*.

### User Story 6: off means off (Priority: P1)

*Check for Durbar updates once a day* off: no request is made, not at start, not on a timer; *Check now* still works when pressed (spec 081 FR-022 pattern). `updates.mode: "off"` from the organization: the whole section is hidden with *Turned off by your organization* and *Check now* is gone too.

### User Story 7: in place, with consent (Priority: P3, phase 2)

On Windows NSIS and Linux AppImage, after a verified download (and, D3 C, a valid signature): *Install and restart* → native confirmation listing the open sessions (they are ended, as spec 081 FR-013 does for agent apps) → pre-update backup → apply → restart. A failure leaves the old version running and says what happened.

### Edge cases

- No network, DNS failure, proxy refusal, TLS error: card *Could not check: <masked reason>*; no toast; next try at the next cadence (FR-004).
- A release list with HTML, `javascript:` links, bidi or control characters, 10 MB of text, 500 releases: notes shown as text, clipped (FR-010); list capped (FR-007).
- Running version newer than the latest release (a dev or fork build): *Up to date (this build is newer than the latest release)*.
- No asset for this OS/arch/type in the release: *No download for this system in v0.1.29*, *Open the release page*.
- Portable Windows build, extracted AppImage, dev run: install type detected (FR-012); dev runs (`npm start`, unpackaged) never check (FR-004).
- The simulator: canned feed, canned download, never the network (FR-020).

## Requirements *(mandatory)*

### Source

- **FR-001** **Built-in update source.** At package time the source is fixed into the build as a GitHub `owner/name`: `DURBAR_UPDATE_REPO` when set, else `GITHUB_REPOSITORY` (the repository whose workflow builds it, so a fork's release builds name the fork), else `package.json` `repository.url`. Parsed with one strict pure parser (Duniya `repo.js` rules: `owner/name`, `github:owner/name`, `https://github.com/owner/name[.git][/]`; owner `[A-Za-z0-9][A-Za-z0-9-]{0,38}`, name `[A-Za-z0-9._-]{1,100}`, not `.`/`..`; nothing else). An unparseable value fails the build. A build whose source came only from the `package.json` fallback (a local build, no release workflow) is marked `local`: its daily check is off by default and Settings says *This build was made outside a release workflow; updates from <owner/name>* so a fork built by hand never follows upstream unnoticed. No owner/name is written in `src/`; the parsed slug is written by `scripts/copy-assets.js` (which already writes `appversion.js` at build time, spec 008 FR-179) into a new `dist/main/updatesource.json` that main reads; a missing file means no source and no check. `release.yml`'s summary prints the baked source, and warns (does not fail) when it differs from `package.json` `repository`.
- **FR-002** **The source is always visible.** Settings > About and the Update dialog say *Updates from <owner/name> (built in)* or *(changed by you)* or *(set by your organization)*.
- **FR-003** **Override (D4 B).** Settings > Updates > *Update source*: `owner/name` or `https://github.com/owner/name` only (FR-001 parser). Durbar first reads that source's release list (FR-007); on any failure nothing changes and the reason is shown. Then a native confirmation names both repositories (*replaces this build, built from X*). Saved in settings as the slug only. *Use the built-in source* removes it. Comparison is case-insensitive.
- **FR-004** **When Durbar contacts the source** (D5 B). Only in a packaged build, never in a dev run or the simulator: at start, after the office is shown and startup detection has finished, when the last check is older than 24 h; every 24 h while open; and when the person presses *Check now*. One request at a time, 10 s limit. Failures are silent apart from the card (*Could not check: ...*), no retry loop. The last check time and result (versions only) are kept in settings.
- **FR-005** **Organization policy** (spec 076 FR-174). `updates.mode: "off"` hides the feature and makes no request; `notify` allows phase 1 only; `auto` allows phase 2 apply but never without the person's confirmation (this spec has no silent install; 076's `auto` wording gets a delta). `updates.feedUrl`: accepted only when it is `https://github.com/<owner>/<name>` (FR-001 parser), then it is the source and the override is locked (*set by your organization*); any other value fails closed (no check, *Your organization's update address is not supported by this version*). An unreadable policy fails closed (spec 081 FR-022). Read through `updatePolicy()` (today `none`, issue #1125).
- **FR-006** **What the check sends and reveals.** One HTTPS GET to the allow-listed URL (FR-007) with `User-Agent: AgentDurbar`, `Accept: application/vnd.github+json`, no cookies, no credentials, no query beyond `per_page`, no version, machine or user identifier. GitHub sees the IP address and time; the README *Safety model*, `docs/safety.md` and the Settings note say so.

### Feed

- **FR-007** **Exact allow-list.** The list request is `https://api.github.com/repos/<owner>/<name>/releases?per_page=30` for the configured slug and nothing else. `redirect: 'manual'`: any 3xx is refused (a renamed repository says so, User Story 4). 200 only, `application/json`, body at most 2 MiB, parsed with `JSON.parse` inside a try; anything else is *Could not check*.
- **FR-008** **Feed validation** (pure). From each entry only: `tag_name` (strict `vMAJOR.MINOR.PATCH[-pre]`, at most 64 characters, spec 081 FR-005 rules), `draft`, `prerelease`, `published_at`, `html_url`, `body`, `assets[].name`, `assets[].size`, `assets[].browser_download_url`. Drafts and pre-releases are ignored. `html_url` must equal `https://github.com/<slug>/releases/tag/<tag>` and each asset URL `https://github.com/<slug>/releases/download/<tag>/<name>` (case-insensitive slug, exact rest); an entry that fails is dropped. Asset names must match `^[A-Za-z0-9._-]{1,200}$`. At most 30 entries, 40 assets each.
- **FR-009** **Breaking** (D6 A). A release is breaking when its notes contain a `### Breaking` heading (written by `scripts/release-notes.js` from a new `Breaking: <text>` fragment field, spec 008 delta), or the jump grows the major version, or, on `0.x`, the minor version. The update is breaking when any release between running and target is.
- **FR-010** **Notes are untrusted text.** Rendered with `textContent` only, never `innerHTML` or a Markdown renderer; control and bidi characters removed; `redact()` and `maskHomePaths()` applied; each release body clipped to 8 KiB, the whole dialog to 64 KiB, with *Open the release page* for the rest. Links are shown as text and never followed; *Open the release page* opens only the validated `html_url` through the existing external-open path.

### Update card, decision, download

- **FR-011** **Update card and dialog.** A line in the More menu (⋯) and Settings > About: *Up to date · v0.1.27 · checked 2 h ago*, or *Update available: vX* (one toast per version, spec 081 `announceRule`). The dialog: *You are running vA. N releases come with it*, the breaking card first (FR-009, with the tick box of User Story 2), then each release (version, date, notes), newest first, older ones folded; buttons *Download*, *Remind me in 7 days*, *Skip this version*, *Close*. Text at least 10.5 px; fits 1280x800; keyboard and screen-reader operable.
- **FR-012** **Install type** (pure, injected environment). `win32` + `process.env.PORTABLE_EXECUTABLE_FILE` = portable; `win32` packaged otherwise = NSIS; `linux` + `process.env.APPIMAGE` = AppImage; `darwin` packaged = dmg; anything else = *unknown* (notes only). Arch from `process.arch`. The asset name is built from spec 008's `artifactName` patterns (`Agent-Durbar-Setup-<v>.exe`, `Agent-Durbar-<v>-portable.exe`, `Agent-Durbar-<v>-x86_64.AppImage`, `Agent-Durbar-<v>-<arch>.dmg`) and must be in the release's asset list.
- **FR-013** **Verified download.** On *Download* only: fetch `SHA256SUMS.txt` (at most 64 KiB) and the asset from their FR-008 URLs; redirect hops allowed only to `objects.githubusercontent.com` and `release-assets.githubusercontent.com` over HTTPS (at most 3 hops, each checked, spec 060 pattern); size at most the API's `size` and at most 600 MiB; 10 min limit; progress and *Cancel*. SHA-256 is computed while streaming into a temporary file in a private folder (0700, file 0600); exactly one `SHA256SUMS.txt` line (`<64 hex>  <name>`) must name the asset; mismatch, no line or two lines = delete and refuse (User Story 3). Only a verified file is moved to its destination (D7 A: Downloads, numbered name, never overwriting).
- **FR-014** **Signature** (D3). Phase 1: none beyond FR-013, and the dialog says *Checked against the release's checksum list* (not *signed*). If D3 C is chosen: `SHA256SUMS.txt.minisig` is checked with the built-in public key before FR-013's compare; a build without a key says *Signature: not set up for this build* and phase 2 apply is not offered.
- **FR-015** **Open.** *Open installer* (`shell.openPath`) for NSIS and dmg; *Show in folder* for every type; the AppImage file gets mode `0755`. Durbar never adds or removes macOS quarantine attributes and never passes arguments to the installer in phase 1. No shell, no user-controlled string in a command.
- **FR-016** **Snooze and skip.** *Remind me in 7 days*: no toast and no menu badge until then (the Settings line still shows it). *Skip this version*: hidden until a newer release (a newer breaking release always shows). Both saved as version + time in settings.
- **FR-017** **Pre-update backup.** Before *Open installer* (phase 1, offered and ticked by default) and before every apply (phase 2, required: no backup, no apply): copy Durbar's settings file and session index (names, folders, times: the files spec 109 exports) to `userData/backups/pre-update-<from>-<to>/`, 0700/0600, keep the last 3. Never tokens, `.env`, agent-app config folders (`~/.copilot`, `~/.claude`, `~/.codex`) or session transcripts. Once spec 109's writer exists, it is used instead of a copy (same exclusions).
- **FR-018** **After the update.** The first start of the new version shows spec 107's What's new strip; this spec adds nothing beside it.

### Phase 2 and 3

- **FR-019** **Apply only with consent, every time.** Phase 2, Windows NSIS: after FR-013/FR-014 and FR-017, a native confirmation (version, open sessions to be ended), then the installer is started with fixed argv (the NSIS silent switch `/S` and electron-builder's `--updated` and `--force-run`, plan D4; `[KNOWN GAP]` until checked on a real Windows PC) via `spawn` without a shell, and Durbar quits. Linux AppImage: the verified file is written beside `$APPIMAGE`, renamed over it (the old one kept as `<name>.old`), Durbar restarts it. Failure: the old copy stays and runs. No automatic apply in any mode.
- **FR-020** **Simulator.** `DURBAR_SIM`: a canned feed (one up to date, one update, one breaking, one checksum mismatch) and a canned download; never the network; the apply step is a canned success.
- **FR-021** **Settings.** `updates.selfCheck` (boolean, D2), `updates.source` (slug or absent), `updates.snooze` (`{version, until}`), `updates.skip` (version), `updates.lastCheck` (`{at, latest}`), validated on read; a bad value is ignored (treated as absent).
- **FR-022** **Docs.** `docs/install.md` *Updates* (per OS table above, the honest limits), *For forks* (FR-001, version numbers Q1, D3 key setup); README *Safety model* (the one request); `docs/safety.md`; `docs/features.md` and `docs/feature-inventory.md` rows.
- **FR-023** **macOS in place** (phase 3) only after spec 014 signing (D1). Not built here.

## Success Criteria *(mandatory)*

- **SC-001** With the switch off (and with `updates.mode: "off"`), a 24 h simulated clock run makes zero requests (fake request layer counts 0).
- **SC-002** Every refusal case of FR-007, FR-008, FR-013 has an offline test, and each has a planted mutant that the test catches (tasks.md).
- **SC-003** A fork build (`GITHUB_REPOSITORY=ravi/durbar`) checks only `ravi/durbar`; an upstream build only `three-feathers/agent-durbar` (test with both baked values against a fake feed of each).
- **SC-004** A release body with `<img src=x onerror=...>`, `<script>`, `[x](javascript:...)`, bidi and control characters shows as plain text in the dialog (UI driver reads `innerHTML` contains no element from it).
- **SC-005** No test or CI step contacts GitHub; the simulator never does.

## Assumptions

- Releases stay on GitHub with `SHA256SUMS.txt` and spec 008's asset names; a renamed asset pattern needs an FR-012 update in the same PR.
- The existing per-user NSIS install (`perMachine: false`) lets the installer replace the app without admin rights.
- GitHub's REST release list stays available unauthenticated.

## Out of scope

- Pre-release channel (alpha, test builds), rollback to an older version, delta updates, `.deb`/`.rpm`, a feed host other than GitHub (FR-005 fails closed), Windows portable in place, any silent or scheduled install.

## Changes

(none yet)
