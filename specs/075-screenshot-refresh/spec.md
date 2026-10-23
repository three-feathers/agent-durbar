# Feature Specification: Daily screenshot refresh

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Daily screenshot refresh: a workflow captures the simulator on Linux, Windows and macOS when main changed and keeps one "screenshots: refresh" PR up to date; a text gate replaces image review
status: **spec only** 2026-10-23: nothing built; blocked by the 001-screenshot-sweep capture script; font and flake handling are [KNOWN GAP]
-->

**Feature Branch**: `075-screenshot-refresh`
**Created**: 2026-10-23
**Status**: Draft (spec only; nothing is built)
**Input**: Owner decisions by Vikram, 2026-10-23: keep the README, the website and the docs screenshots current without anyone doing it by hand; show on all three operating systems that the app looks right.

## Summary

A scheduled GitHub Actions workflow re-captures the app's key screenshots on the **simulator** (no AI credits) on Linux, Windows and macOS at 1440x900 and 1280x800, and keeps **one** pull request, "screenshots: refresh", up to date with the result. It runs daily and only when `main` has new commits since the last successful refresh. It never pushes to `main`.

## Requirements

- **FR-001 Trigger.** A `schedule` (daily) plus `workflow_dispatch`. The first job compares `main`'s head with the commit recorded by the last successful refresh (the refresh branch's `refreshed-from` marker, FR-021). Same commit: the run ends green and does nothing else (no capture jobs, no macOS minutes).
- **FR-002 Simulator only.** Capture uses the simulator (`DURBAR_SIM=15`) and never a real agent session, `npm run smoke` or `scripts/capture-raw.ts` (constitution IV, AGENTS.md *Do not spend AI credits*).
- **FR-003 Matrix.** Linux (`ubuntu-latest`), Windows (`windows-latest`), macOS (`macos-latest`), each at 1440x900 and 1280x800. The OS list comes from `.github/platforms.json`, like the other platform workflows, not a second copy.
- **FR-004 One capture command.** The workflow calls the one-command capture script of the screenshot sweep (**dependency: PR/branch `001-screenshot-sweep`**, which adds the script that regenerates every key screenshot). This spec adds no capture logic of its own; if the sweep's script lacks an option this workflow needs (output folder per OS, size list), that is added to that script in the sweep PR or a small follow-up of it, not forked here. Building this workflow is blocked until the sweep has merged.
- **FR-005 Deterministic.** Fixed simulator seed and a fixed clock (the simulator's frozen-time option, or an injected date), fixed window size and device scale factor, animations settled by waiting for a state (not a sleep). Two runs on the same commit and OS give byte-identical PNGs. Anything that cannot be made deterministic is masked or excluded and listed under FR-031.
- **FR-006 Commit only on change.** After capture, the workflow compares the new files with those on `main` (byte compare, or a perceptual threshold of zero changed pixels as a fallback if PNG encoding differs between runs). No difference: no commit, no PR change.
- **FR-007 Paths.** Linux images replace the canonical files under `docs/screenshots/` that the README and `docs/site/gallery.json` already show. Windows and macOS images go to `docs/screenshots/platforms/<os>/` and are shown in a **platform gallery** (FR-012).
- **FR-010 Never push to `main`.** The workflow only pushes the fixed branch of FR-011.
- **FR-011 One branch, one PR.** The branch is always `screenshots/refresh` (force-pushed from a fresh `origin/main` each time, so it never carries stale commits). There is at most one open PR titled "screenshots: refresh" from it. If one is open, the workflow updates its branch and body; if none, it opens one. Any other open PR whose head is a screenshot-refresh branch (older naming, manual attempts) is closed with a comment pointing to the current one. The PR body lists the commit of `main` captured, per-OS changed-file counts and the run link.
- **FR-012 Canonical look and platform gallery.** The README and the website use the **Linux** images as the canonical look. A platform gallery (a section of the website, generated from `docs/screenshots/platforms/`) shows the same screens on Windows and macOS: visual proof of the three-OS parity of constitution VI. `docs/site/gallery.json` is edited only to add or retire a key screenshot (AGENTS.md); the refresh itself changes pixels, not entries.
- **FR-013 Permissions.** The workflow's `permissions` are exactly `contents: write` and `pull-requests: write`, nothing else, set at the top and not widened per job beyond that. The repository setting "Allow GitHub Actions to create and approve pull requests" has been enabled by the owner (2026-10-23). No secrets other than the built-in `GITHUB_TOKEN`; no PAT. Third-party actions pinned by commit SHA as in the other workflows.
- **FR-014 No tokens in the images.** The simulator shows no credentials, but the text gate (FR-020) also refuses any file outside the allowed set, and the capture runs with no real Copilot/Claude/Codex config on the runner (constitution III).

### The merge gate (no image review)

- **FR-020 Text gate, no review of the images.** The owner decided that neither an agent nor a human reviews the images (expensive; they come from `main`). Instead a cheap, scripted gate runs in the workflow before it pushes and again as a check on the PR:
  1. every changed path matches the allowlist: `docs/screenshots/**` (images only: `.png`), `docs/site/gallery.json`, and the platform gallery's generated data; nothing in `src/`, `scripts/`, `.github/`, `specs/` or any other file;
  2. each image is a PNG of an expected size (1440x900 or 1280x800, or the existing size of that file) and under a size limit;
  3. `npm run test:site` (link and gallery checks) passes on the PR's tree.
  A failing gate stops the push (or marks the PR "needs a human") and the workflow says why.
- **FR-021 Marker.** The refresh commit's message and the PR body carry `refreshed-from: <sha of main>`; the next run reads it from the branch's last commit.
- **FR-022 Merge.** PRs created with `GITHUB_TOKEN` do not trigger other workflows, so the required CI does not run on them. The merge is therefore an **admin formality** under AGENTS.md *Admin merge*: an agent or an owner merges with `gh pr merge --admin` after FR-020 passes (the scripted gate, run by `scripts/pr-gate.sh` or its own command, is the evidence). The usual review steps for code do not apply because the PR cannot contain code (FR-020.1). Auto-merge is **not** enabled; a human or agent still presses merge. A PR that touches anything outside the allowlist is never merged this way.
- **FR-023 Not a mass of noise.** Because only changed images commit and the PR is reused, `main` gets at most one screenshot commit per merge of the PR.

### Cost

- **FR-030 Minutes.** macOS minutes count 10x and Windows 2x. The daily run captures only when `main` changed (FR-001), and the three OS jobs run in parallel for a few minutes each. If the cost proves too high, the fallback option is: Linux and Windows daily-on-change, **macOS weekly** (same marker logic, its own schedule). Which to start with is decided with real numbers after the first runs (FR-032). Public repositories get standard runners free of charge; if the repository is or becomes private, this is re-checked before the first run.

### Known gaps (open items)

- **FR-031 [KNOWN GAP] Font differences per OS.** Windows, macOS and Linux render different system fonts, so the platform images legitimately differ from each other; only the same OS on two runs must match. Whether the runners have the fonts the themes ask for, and whether a bundled font is needed for stable text, is not known yet.
- **FR-032 [KNOWN GAP] Flake handling.** Unknown until measured: whether PNGs are byte-identical across runs on hosted runners (GPU/software rendering, antialiasing). Plan: run each capture twice in the job and keep only files identical in both; a file that differs between the two takes is kept from `main` and reported in the PR body. A screen that flakes in three runs is listed and excluded rather than retried forever.
- **FR-033 [KNOWN GAP] Not verified.** Nothing here has been run. The sweep's capture script is not on `main` yet, so its exact name, options and runtime on each OS are unverified.

## Out of scope

Real-session screenshots (they cost credits and are taken by hand per AGENTS.md), review or approval of the image content, auto-merging, signing, and any change to `src/`.

## Success criteria

- **SC-001** On a day with no new commit on `main`, the run finishes in under a minute and no capture job starts.
- **SC-002** After a refresh, at most one "screenshots: refresh" PR is open; older ones are closed.
- **SC-003** Two consecutive runs on one commit leave the PR unchanged.
- **SC-004** A PR with one extra file (for example under `src/`) fails the text gate.
- **SC-005** The website shows the Linux images in the main gallery and Windows and macOS in the platform gallery.
