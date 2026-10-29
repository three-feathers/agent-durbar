# Specs

Every behavior of Agent Durbar is specified here, one folder per feature, in the [GitHub Spec Kit](https://github.com/github/spec-kit)
layout (`spec.md` what and why, `plan.md` how, `tasks.md` work). The rules are in
[`.specify/memory/constitution.md`](../.specify/memory/constitution.md); the workflow is in
[CONTRIBUTING.md](../CONTRIBUTING.md#spec-kit-workflow-is-mandatory).

## Features 001-010: reverse-engineered from the shipped code

These were written **after** the code (milestones 1-6 and packaging), from the code, README, docs and screenshots. They describe
what exists today, not what was originally intended. Each requirement carries a status and, where it matters, how it was checked:

| Tag | Meaning |
| --- | --- |
| `[IMPLEMENTED]` | The behavior exists in the code (file references are in the plan). |
| `[KNOWN GAP]` | Missing, partial, wrong or contradicting the README/constitution. Has an open task. |
| `test:` | An automated test in `scripts/` (run by `npm test`, no credits) covers it. |
| `sim:` | Seen on the simulator (`DURBAR_SIM`) or in screenshots; manual, no automated assertion. |
| `real:` | Seen once on a real Copilot session, as recorded in the README (not re-run when these specs were written). |
| `read:` | Read in the code only; never exercised. Treat as unverified. |
| `re-verified 2026-10-16` | Re-checked by running the app headless (xvfb) while writing these specs. |

## Index

The index tables are **generated and not committed** (spec 025, delta 2026-10-22), so two pull requests never edit the same lines here. Each spec keeps its own row in a `specs-index` comment block under the title of its `spec.md` (`group`, `title`, `status`). Read the full index on the [website](https://three-feathers.github.io/agent-durbar/docs.html#specs-index), or run `npm run specs:index` for `specs/INDEX.md` (git-ignored). A new spec gets its block with `npm run specs:index -- --add specs/NNN-name`; `npm run specs:check` (in `npm test`) checks every block. The `status:` is one word: `draft` (outline), `specified` (spec, plan and tasks agreed), `building` (work in progress or planned build tasks open), `built` (done; open tasks are only deferred follow-ups, `[KNOWN GAP]`s or checks needing a real account or an owner), `released` or `superseded`, with an optional `note:` of at most 160 characters; `specs:check` refuses anything else and the detail goes into the spec's `## Changes`. Release tags have no spec folder: they are rows of the [release table](008-packaging-and-release/spec.md#release-table). Each `<!-- specs-index group=ID -->` line below marks where a table goes; a new section adds its own.

<!-- specs-index group=index -->

## Features 011-014: 011 and 012 built, 013 run, 014 backlog draft

014 is a spec draft only (no plan or tasks yet) and needs the owner's approval (a purchase). 013 was run on a real Copilot session on 2026-10-19. 012 is built: Claude Code and OpenAI Codex are offered next to Copilot when installed; what is still open is listed in its row.

<!-- specs-index group=011-014 -->

## Features 015-018: milestone 7 (spec first, then code)

<!-- specs-index group=015-018 -->

## Feature 019: milestone 8

<!-- specs-index group=019 -->

## Feature 020: milestone 10

<!-- specs-index group=020 -->

## Feature 021: collaboration harness

<!-- specs-index group=021 -->

New features take the next number (`/speckit.specify` picks it automatically from this folder).

## Feature 024: places in the office

<!-- specs-index group=024 -->

## Feature 025: docs in sync

<!-- specs-index group=025 -->

## Features 043-044: custom agents and scheduled prompts

<!-- specs-index group=042 -->

## Feature 030: change model and context window inside a session

<!-- specs-index group=030 -->

## Feature 035-040: themes (data-only packs)

<!-- specs-index group=035-040 -->

## Feature 034: agents show how they are doing

<!-- specs-index group=034 -->

## Feature 033: floors

<!-- specs-index group=033 -->

## Feature 045: security and quality sweep

<!-- specs-index group=045 -->

## Feature 046: release v0.1.0-alpha.6

<!-- specs-index group=046 -->
