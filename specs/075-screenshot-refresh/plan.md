# Implementation Plan: Daily screenshot refresh

**Branch**: `075-screenshot-refresh` | **Date**: 2026-10-23 | **Spec**: [spec.md](spec.md)

## Summary

One new workflow, `.github/workflows/screenshot-refresh.yml`, a small gate script and a platform-gallery section in the site generator. Capture itself is the sweep's one-command script (dependency: `001-screenshot-sweep`); nothing in `src/` changes.

## Technical Context

**Language**: GitHub Actions YAML, Node/TypeScript scripts as elsewhere in `scripts/`
**Dependencies**: PR/branch `001-screenshot-sweep` (the capture command); existing `scripts/build-site.js`, `docs/site/gallery.json`, `.github/platforms.json`, `scripts/pr-gate.sh`; no new package
**Testing**: `scripts/test-screenshot-gate.ts` (the allowlist and size checks as a pure function, with a failing case for a `src/` file); the workflow is checked by `workflow_dispatch` on a branch, then one scheduled run
**Constraints**: no AI credits; permissions `contents: write` + `pull-requests: write`; Windows, macOS, Linux; no shell with user-controlled strings (branch and file names are fixed or validated)

## Design

1. **Plan job (ubuntu).** Reads `refreshed-from` from `origin/screenshots/refresh` (if it exists), compares with `origin/main`. Output `changed=true|false`. `workflow_dispatch` has a `force` input.
2. **Capture matrix** (`needs: plan`, `if: changed`; OS from `platforms.json`; `fail-fast: false`). `npm ci`, build once, run the sweep's command with the fixed seed and clock at both sizes, twice; keep files identical in both takes (FR-032). Upload the images as an artifact per OS. Linux files target `docs/screenshots/`, others `docs/screenshots/platforms/<os>/`.
3. **Publish job (ubuntu).** Downloads the artifacts, branches `screenshots/refresh` from a fresh `origin/main`, copies the files, stops when `git status` is clean, runs the text gate (PNG-only allowlist, PNG signature and IHDR size and size cap, provenance, `npm run test:site`), uploads `{sha, branch}` as a run artifact after the push (the trusted record; the PR body is for humans only), commits with `refreshed-from`, force-pushes the fixed branch, creates or updates the one PR with `gh`, and closes other open screenshot-refresh PRs. Uses `GITHUB_TOKEN` only.
4. **Gate script** `scripts/screenshot-gate.ts`: pure `checkChangedPaths(paths)`, `checkPng(bytes, expected)` (signature, IHDR, cap) and `checkProvenance(pr)` (fetches the refresh run's artifact through the Actions API; checks the run's workflow path on `main`, event `schedule`/`workflow_dispatch`, success, recorded branch, and PR head sha equal to the recorded sha; author and commit count are advisory); run by the workflow and by an agent before the admin merge (`npm run screenshots:gate -- <pr>`), which prints the checked sha for `gh pr merge --admin --match-head-commit <sha>`. `docs/site/gallery.json` is not allowlisted.
   The workflow has `concurrency: {group: screenshot-refresh, cancel-in-progress: true}`; `screenshots/refresh` is bot-owned (humans never push).
5. **Platform gallery.** `scripts/build-site.js` lists `docs/screenshots/platforms/*/` as a gallery section; `test:site` fails on a broken link.

## Alternatives

- Push to `main`: refused by the owner and the ruleset.
- A new PR per day: piles up; the fixed branch and one PR replace it.
- Review the images by agent: refused (cost); the text gate replaces it.
- Hand-take screenshots: what happens today; it goes stale.

## Constitution Check

I Spec Kit: this spec first. II no adapter code. III no secrets, minimal token scope, no real config on runners. IV simulator only. V no UI change. VI the point of the feature is three-OS evidence. VII the text gate plus `test:site`. VIII font and flake gaps are written down as `[KNOWN GAP]`. No violations.

## Open questions for the owners

None blocking. Decide after the first runs: macOS daily or weekly (FR-030).
