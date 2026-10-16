# Instructions for coding agents

This repository is **spec-driven** with [GitHub Spec Kit](https://github.com/github/spec-kit). Read this before touching anything.
Humans: see [CONTRIBUTING.md](CONTRIBUTING.md#spec-kit-workflow-is-mandatory). This file is the same rule for agents (Copilot, Claude Code, Codex, Cursor and others).

## The rule

**Do not write or change code in `src/` until the spec, plan and tasks for that change exist and are committed.** Use the Spec Kit commands first, in this order:

1. `/speckit.specify` (new behavior) or a dated *spec delta* under `## Changes` in the owning `specs/NNN-name/spec.md` (bug fix or tweak to something already built).
2. `/speckit.clarify` when anything is ambiguous. Ask the user; do not guess.
3. `/speckit.plan`, then `/speckit.tasks`, then `/speckit.analyze`.
4. Only then `/speckit.implement`, ticking tasks as you go.
5. After: `/speckit.converge` so spec, plan and tasks match what you built.

If your tool has no slash commands, follow the templates in `.specify/templates/` by hand and the prompts in `.github/prompts/speckit.*.prompt.md`. Skills-style tools can read those files directly. The artifacts are what count.

CI (`.github/workflows/spec-kit.yml`) fails a pull request that changes `src/` without changing `specs/`. Exemption only for changes with no behavior change: a `Spec-Exempt: <reason>` line in the PR description. Do not use it to skip the workflow.

## Where things are

- `.specify/memory/constitution.md`: the rules (I-VIII). Read it first. Principles I and III are non-negotiable.
- `specs/README.md`: index; `specs/001..010` describe what is built, `011..014` are backlog drafts. Evidence tags: `[IMPLEMENTED]`, `[KNOWN GAP]`, `test:`, `sim:`, `real:`, `read:`.
- `src/main`, `src/preload`, `src/renderer` (plain HTML/CSS/JS), `src/adapters`, `src/shared`; tests in `scripts/test-*.ts`.

## Non-negotiables (details in the constitution)

- **Adapters are plug-ins.** Agent specifics stay behind `AgentAdapter` and its normalized events; no Copilot types in the renderer or `src/shared`.
- **Safe by default, no secrets.** Default permission mode is read-only. Never store, log or commit tokens, `.env`, Copilot config or session data. Do not spawn processes through a shell with user-controlled strings.
- **Do not spend AI credits.** Develop and test on the simulator (`DURBAR_SIM=15 npm start`) and `npm test`. Do not run `npm run smoke`, `scripts/capture-raw.ts` or any real Copilot session unless the user explicitly asks, and say how many prompts it will cost first.
- **Calm, legible UI.** Minimum 10.5px text; 15 agents must fit on 1440x900 and 1280x800 without overlap or scrolling the office.
- **Windows, macOS and Linux parity.** No POSIX-only paths or shell assumptions.
- **Honest limits.** If you did not verify it, say so in the spec (`[KNOWN GAP]`, `read:`) and the README. Never claim a platform, feature or test you did not run.
- **Needs approval:** spending money (signing certificates), publishing a release, changing repo settings, posting anywhere. Draft it and stop.

## Before you finish

```bash
npm run typecheck && npm run build && npm test
```

For UI changes also take screenshots at 1440x900 and 1280x800 with `DURBAR_SIM=15` (see `specs/001-office-view-and-densities/quickstart.md`). Commit small and focused, with the spec, plan and tasks changes in the same pull request. Fill in the pull request template honestly, including what you did not verify.
