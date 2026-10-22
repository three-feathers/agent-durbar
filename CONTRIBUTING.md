# Contributing

Thanks for looking. This is an early alpha; small, focused pull requests are easiest to review. For anything bigger than a fix, open an issue first. Every change follows the [Spec Kit workflow](#spec-kit-workflow-is-mandatory). Working with a team or your own coding agent (claiming issues, branch names, reviews)? Read [docs/collaboration.md](docs/collaboration.md) first.

## Setup

```bash
npm ci
npm run build
npm test            # every unit suite, compiled once and run in parallel (~20 s); no Copilot, no credits
# merged branches are deleted by the daily Branch cleanup workflow one day after the merge (spec 008 FR-024)
DURBAR_SIM=15 npm start   # 15 simulated agents, no sessions, no AI credits
```

`npm start` and the simulator keep their data in `agent-durbar-dev` under the OS app-data folder, not in the installed app's `agent-durbar` (spec 008 FR-034); `DURBAR_USER_DATA=<folder>` overrides both. To reuse older dev data, run once with `DURBAR_USER_DATA=<old folder>` or copy it by hand.

Node 20.19+ or 22.12+ is required. `npm start` with real sessions needs a GitHub Copilot login (`copilot login`) and spends your AI credits; prefer the simulator (`DURBAR_SIM`) and the tests while developing.

## Guidelines

- Keep it TypeScript (`src/main`, `src/adapters`, `src/shared`) and dependency-light; the renderer is plain HTML/CSS/JS.
- Anything that spawns a process must not use a shell with user-controlled strings.
- Never commit tokens, `.env` files, Copilot config or session data, or personal paths. Do not add code that stores credentials; sign-in belongs to the Copilot runtime.
- Add or update a test in `scripts/` when you change the permission broker, attachments or launcher logic.
- Run `npm run typecheck && npm run build && npm test` before opening a PR; CI runs the same. For UI changes attach screenshots at 1440x900 and 1280x800 with 15 simulated agents (`DURBAR_SIM=15`).
- **Design and UI:** follow the ten house rules in [docs/design-rules.md](docs/design-rules.md) (control heights, radius and colour tokens, one primary button, the "…" rule, one word per status, dialog layout, states, chevrons) and keep text at 10.5px or more.
- Use the pull request template and tick the checklist honestly; state what you did *not* verify.
- **Keep the docs in sync, in the same PR.** If you change something a user can see, a script, a permission, a setting, MCP or tool behavior, the release status or the contributors, update `README.md`, the relevant `docs/` page, the spec's `tasks.md` and the screenshots it shows, and add your changelog line as a new file `changelog.d/<your-branch>.md` (do not edit `CHANGELOG.md`; see [changelog.d/README.md](changelog.d/README.md)). The specs index `specs/README.md` is generated: change your spec's `specs-index` block and run `npm run specs:index`. The exact list is in [AGENTS.md](AGENTS.md#keep-docs-in-sync). No docs impact? Write `Docs: n/a <reason>` in the PR description. A CI check only *warns* about it; it never blocks.

## Spec Kit workflow is mandatory

Agent Durbar is spec-driven with [GitHub Spec Kit](https://github.com/github/spec-kit). **No code without a spec, a plan and tasks.** This applies to everyone, including coding agents and the maintainer. The rules live in [`.specify/memory/constitution.md`](.specify/memory/constitution.md) (principle I); the specs live in [`specs/`](specs/README.md) (001-010 describe what is already built, 011 and 012 are built, 013 was run on a real session, 014 is a backlog draft, 015-021 and 023 are built; the index lists the rest).

| Step | Command (Copilot Chat in VS Code) | Produces |
| --- | --- | --- |
| 1. Constitution | `/speckit.constitution` (only to amend the rules) | `.specify/memory/constitution.md` |
| 2. Specify | `/speckit.specify <what and why>` | `specs/NNN-name/spec.md` |
| 3. Clarify | `/speckit.clarify` | answers recorded in the spec |
| 4. Plan | `/speckit.plan` | `plan.md` (architecture, constitution check) |
| 5. Tasks | `/speckit.tasks` | `tasks.md` |
| 6. Analyze | `/speckit.analyze` | consistency report (read-only) |
| 7. Implement | `/speckit.implement` | the code, tasks ticked |
| After | `/speckit.converge` | spec/plan/tasks brought back in line with what was built |

- **New feature or behavior change:** steps 2 to 6 first, commit the spec, plan and tasks, then implement. Prefer one commit for the spec and one or more for the code, all in the same pull request.
- **Change to something already built (001-010):** edit the owning `specs/NNN-name/` instead of creating a new one; keep its `[IMPLEMENTED]` / `[KNOWN GAP]` marks honest.
- **Bug fix:** a *spec delta*. Add a dated entry under `## Changes` in the owning `spec.md` (what was wrong, what is now required, the acceptance scenario that would have caught it), tick or add the task, then fix. A fix that reveals a missing requirement adds the requirement.
- **No behavior change** (typo, comment, formatting, dependency bump, CI-only fix, revert): the exemption below. "It is small" is not a reason.
- **Needs approval** (anything that costs money or acts outside the repo, for example code-signing certificates in spec 014): mark the spec `needs-approval`; nobody buys, signs up or publishes before the maintainer says yes.
- Install the CLI once with `uv tool install specify-cli` (see the Spec Kit docs). The commands are already in the repo (`.github/prompts/speckit.*.prompt.md`, `.specify/`), so Copilot Chat in VS Code offers them without running `specify init`. The helper scripts are `sh`; on Windows use WSL or git-bash, or run `specify init --here --script ps`.
- The slash commands are not magic: if you cannot run them, follow the templates in `.specify/templates/` by hand. The artifacts are what matter.

### The CI gate

The **Spec Kit** workflow (`.github/workflows/spec-kit.yml`, job *Spec Kit gate*, logic in `.github/scripts/spec-gate.sh`, self-test `.github/scripts/test-spec-gate.sh`) fails a pull request whose branch is not `NNN-slug` (warning only for non-agent bot branches such as Dependabot) or that changes anything under `src/` without changing `specs/NNN-*/` (which must contain `spec.md`, `plan.md` and `tasks.md`). Check your local Spec Kit setup with `specify integration status`.

Exemption, only when there is no behavior change, either:

- a line `Spec-Exempt: <reason>` in the pull request description (4+ characters, not inside an HTML comment; the PR template ships it commented out), or
- the label `spec-exempt` (any label starting with that, such as `Spec-Exempt: dependency bump`), which a maintainer applies.

The gate checks **presence, not quality**: it cannot tell a good spec from a one-line stub, and it does not look at changes outside `src/` (`scripts/`, build config, workflows). Reviewers use the checklist in the pull request template. The gate runs on pull requests only; a direct push to `main` is not checked, so push through pull requests, and the maintainer can make *Spec Kit gate* a required status check in the branch protection settings.

## Upgrading the Copilot SDK

`@github/copilot-sdk` is pinned **exactly** in `package.json` (no `^`): several calls the app relies on are marked `@experimental` in the SDK's type definitions (`sessionLimits`, `session.rpc.ui.handlePendingSessionLimitsExhausted`, `rpc.options.update`, `rpc.eventLog.registerInterest`, MCP RPCs), and the bundled Copilot runtime comes with the SDK version. Never widen the range; upgrade deliberately:

1. Spec first: a short delta in the owning spec (002 adapter, 011 credit cap, 019 MCP) saying why you upgrade.
2. `npm install --save-exact @github/copilot-sdk@<version>`, commit `package.json` and `package-lock.json` together.
3. Read the new `node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts` and `rpc.d.ts` for the calls above; `npm run typecheck` shows renamed or removed ones. Check `scripts/fixtures/events/` still describe what the runtime sends (the fixtures are sanitised real events: do not edit them to make tests pass).
4. `npm run build && npm test && npm run check:office` (and `npm run check:ui` for UI changes; CI runs both on macOS, Windows and Linux); then `npm run pack:dir` (it fails when the unpacked runtime is missing, `scripts/after-pack.js`).
5. A real session costs credits: only with the maintainer's agreement, and say how many prompts and how many AIU it used in the spec and the pull request.

## Developer hooks

`DURBAR_*` environment variables (`DURBAR_SIM`, `DURBAR_DRIVER`, `DURBAR_LOG`, `DURBAR_OPEN`, `DURBAR_PERM`, `DURBAR_PICK`, `DURBAR_USER_DATA`, `DURBAR_SHOT*`, ...) are developer/test hooks (spec 010). They work with `npm start` / `electron .`. A **packaged** build ignores all of them unless `DURBAR_DEV=1` is set (it then prints a warning on stderr), so a release does not carry a back door. Read hooks in the main process only through `devEnv()` in `src/main/devhooks.ts`; `npm run test:devhooks` fails otherwise.

## Releases (maintainer)

Pushing a tag `v*` (for example `v0.1.0-alpha.5`; the tag must match `version` in `package.json`) runs `.github/workflows/release.yml`, which builds unsigned macOS, Windows and Linux packages and attaches them to a **draft** pre-release. Review the draft, then publish it by hand. Builds are not signed or notarized and there is no auto-update.

## License

By contributing you agree that your contribution is licensed under the MIT license of this project.
