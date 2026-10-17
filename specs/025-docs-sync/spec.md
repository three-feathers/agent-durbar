# Feature Specification: Keep docs in sync (rule, template, warning check, catch-up)

**Feature Branch**: `025-docs-sync`
**Created**: 2026-10-17
**Status**: Specified, planned and built in this feature (docs, `.github/` and `AGENTS.md` only: no change to `src/`).
**Input**: Vikram: "Don't forget to update agent instructions, CI or wherever it is to update common things like README when applicable. Also do it now for pending ones." He explicitly asked for the changes to `AGENTS.md` and `.github/` made here.

## What was wrong

- `[KNOWN GAP]` (fixed here) No rule said that a PR must update README, docs, spec tasks, CHANGELOG and screenshots. Several merged PRs (#15 Allow all, #16, #17 usage totals) left the README status block, the CHANGELOG, the roadmap, spec statuses and the Development section behind `main`.
- `[KNOWN GAP]` (fixed here) The PR template had no docs box and CI had no docs reminder.

## Requirements

- **FR-001** `[IMPLEMENTED]` `AGENTS.md` has a **Keep docs in sync** section: when a PR changes user-visible behaviour, scripts, permissions, settings, MCP/tool behaviour, release status or contributors, it updates in the same PR the README, `CHANGELOG.md`, the relevant `docs/` pages, the spec's `tasks.md` (and spec status and index), and the screenshots, with the exact list of files to check. An agent that cannot do it opens an issue (label `area:docs`), assigns it, and links it from the PR. `CLAUDE.md` imports `AGENTS.md`; `.github/copilot-instructions.md`, `docs/collaboration.md` and `CONTRIBUTING.md` point to it.
- **FR-002** `[IMPLEMENTED]` The PR template has a **Docs** section: a *Docs updated* box, a *no docs impact* box with a `Docs: n/a <reason>` line (in an HTML comment, like `Spec-Exempt`), and a screenshots line in Verification.
- **FR-003** `[IMPLEMENTED]` `test:` A non-blocking **Docs check (warning only)** job in `.github/workflows/spec-kit.yml` runs `.github/scripts/docs-check.sh`. It warns (annotation and step summary) when (a) `src/` changed and none of `README.md`, `CHANGELOG.md`, `docs/` changed, or (b) `package.json` scripts changed and `README.md` did not. Switched off by a `Docs: n/a <reason>` line (reason of 4+ characters, not the template placeholder, not inside a comment) or a `docs-n/a` or `spec-exempt` label. The script always exits 0; the job has `continue-on-error: true`; it is **not** in `.github/ruleset-main.json` required checks. `.github/scripts/test-docs-check.sh` (20 cases, throwaway repos) runs in the same job.
- **FR-004** `[IMPLEMENTED]` Catch-up audit against `main` after PRs #1, #11-#17: README status block, release status (v0.1.0-alpha.2 draft pre-release, unsigned), permission names (Read-only / Ask first / Allow all), usage totals, roadmap, known limits, Development scripts, links (repo, board), contributors and credits; CHANGELOG *Unreleased* (and the *Allow edits* wording in the alpha.2 entry); CONTRIBUTING, SECURITY, `specs/README.md` and stale task ticks in specs 021 and 023.
- **FR-005** `[IMPLEMENTED]` (sim: `scripts/shots-mode.js`) The three screenshots that still showed the old *Allow edits* wording (`m7-mode-switch.png`, `m7-mode-confirm.png`, `m7-mode-context.png`; none linked from the README) were regenerated on the simulator at 1440x900 (the size of the originals) and now show *Allow all*. A pass over every picture in `docs/screenshots/` found no other one that shows the old name. The real-session `m3-*` and `m5-*` pictures are history and show only the top-bar *Read-only* and *Ask first* states, so they stay. The README links the `003-allow-all-menu-*` and `011-usage-totals-*` pictures instead of `m7-mode-switch.png`.
- **FR-006** `[IMPLEMENTED]` (sim) The README hero pictures (`m5-sim15-1440x900-closed.png`, `m6-fullchat-sim15-1280x800.png`) and the current-state pictures taken before the office total chip, the Tools/Settings buttons and the folder import (`m10-*` except `m10-agent-mcp-*`, `m9-office-caps-*`, `m9-settings-cap-*`, `about-settings-1280x800.png`) are regenerated from the simulator, and the About picture is linked from the README. Checked and left as they were: `i7-*`, `003-allow-all-*`, `011-usage-totals-*` (identical or already current), `m9-limit-*` and `m9-cap-dialog-*` and `m10-agent-mcp-*` (only clock times and a card colour differ). Older milestone pictures (`m2`..`m8`) are history of that milestone.
- **FR-006** The check is advisory. It does not read file contents beyond `git diff` names and the `package.json` diff, uses no network, no tokens, no secrets.

## Out of scope

Making the docs check required (decide after two weeks of use, like spec 021 T013). Auto-generating docs. Any change to `src/`.
