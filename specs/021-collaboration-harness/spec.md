# Feature Specification: Collaboration harness (humans plus their own coding agents)

**Feature Branch**: `021-collab-harness`
**Created**: 2026-10-16
**Status**: Specified, planned and built in this feature (tooling and process only: no change to `src/`).
**Input**: Agent Durbar moved to the `three-feathers` organization and gained two contributors who each work with their own Claude agent, while the maintainer's agent uses Copilot. They must not collide, must all follow the Spec Kit rule (constitution I), and must be able to start without a call. Maintainer-approved harness; background research: `command-center/collab-research.md` (kept outside the repo).

## What exists today

- `[IMPLEMENTED]` Spec Kit with the **Copilot** integration (`.github/agents`, `.github/prompts`, `.specify/`), `AGENTS.md`, `.github/copilot-instructions.md`, a PR template, and the *Spec Kit gate* (`spec-gate.sh`: `src/` change needs a `specs/` change, with `Spec-Exempt` escape).
- `[KNOWN GAP]` No Claude skills, no `CLAUDE.md`, no issue templates or labels, no CODEOWNERS, no task claiming rule, no project board, no branch protection, no contributor onboarding doc.

## Decisions (maintainer, 2026-10-16)

- **One harness, no gh-aw work queue.** Issues are the queue; a GitHub Project is the board; Spec Kit tasks are the unit of work; a CI gate and a ruleset are the guard rails. (The gh-aw queue coordinates Actions-hosted workers, not local agents; it is a technical preview.)
- **One issue = one Spec Kit task.** Claiming = assign yourself *and* label `status:claimed`. Assignment is not atomic: if you are the second assignee, back off.
- **Agent files:** `AGENTS.md` canonical; `CLAUDE.md` starts with `@AGENTS.md`; `.github/copilot-instructions.md` stays a pointer.
- **Claude and Copilot Spec Kit integrations coexist** (`specify integration install claude --force`); Copilot stays the default.
- **Review:** each human reviews only their own agent's PRs, plus one other human approves. The maintainer (admin) can bypass.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A new contributor and their Claude agent can start in one sitting (Priority: P1)

**Independent Test**: following `docs/collaboration.md` from a clean clone: Claude Code reads `CLAUDE.md` (and through it `AGENTS.md`), offers the `/speckit-*` skills, and the contributor can pick an issue, claim it, branch, and open a PR that passes the gate.

**Acceptance Scenarios**:

1. **Given** a fresh clone, **When** Claude Code starts in it, **Then** it loads `CLAUDE.md` with `@AGENTS.md` imported and the `speckit-*` skills are listed.
2. **Given** a Copilot user, **When** they open the repo, **Then** nothing about their setup changed (`.github/agents`, `.github/prompts`, default integration `copilot`).

### User Story 2 - Two agents do not work on the same thing (Priority: P1)

**Acceptance Scenarios**:

1. **Given** an open task issue with no assignee, **When** a contributor assigns themself and adds `status:claimed`, **Then** the board shows it as Claimed and others pick another issue.
2. **Given** a PR whose branch is not `NNN-slug`, **When** CI runs, **Then** the Spec Kit gate fails (warning only for non-agent bot branches such as Dependabot).

### User Story 3 - Changes cannot skip the spec (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a PR on branch `NNN-slug` that changes `src/`, **When** `specs/NNN-*/` lacks `spec.md`, `plan.md` or `tasks.md`, or the PR changes nothing in `specs/NNN-*/`, **Then** the gate fails and names the missing file.
2. **Given** a change with no behavior change and a `Spec-Exempt: <reason>` line or `spec-exempt` label, **Then** the gate passes (reviewer must agree), as before.
3. **Given** the ruleset is on, **Then** nobody but the admin can push to `main`, and a PR needs `Spec Kit gate`, the CI jobs, one approval, and CODEOWNERS review for owned paths.

### User Story 4 - The backlog is visible and workable (Priority: P2)

**Acceptance Scenarios**:

1. **Given** a spec's `tasks.md`, **When** the maintainer runs `.github/scripts/tasks-to-issues.sh specs/NNN-*` (or `/speckit-taskstoissues`), **Then** each unchecked task becomes one labelled issue, never twice.
2. **Given** the real open backlog (specs 012, 013, 014, 003 T020/T025, per-folder VS Code `mcp.json` import, office-wide usage totals, macOS/Windows hardware testing), **Then** each has an issue with `spec:NNN`, `area:*` and, for 014, `needs-owner-approval`.

### Edge Cases

- `specify integration status` exits 1 with finding `unsafe-multi-install` once Claude is installed next to Copilot, because Copilot is not declared multi-install safe and was installed with `--force`. That is expected and accepted; any other finding (modified or missing managed files) is drift to fix.
- After adding Spec Kit extensions or presets: run `specify integration use <key>` for each agent and commit the result (they register for the default integration only).
- A Copilot cloud-agent branch (`copilot/...`) does not match `NNN-slug` and fails the gate: rename the branch or have the owner re-open the PR from a conforming branch. `[KNOWN GAP]` not tried against the real Copilot cloud agent.
- Assignment can only target people with Write access or who commented; the pending invite (fjcabello) cannot be assigned until accepted.
- Secrets and spend: the harness adds no secrets, no paid services, no cloud agent runs (constitution III, IV).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** `[IMPLEMENTED]` Spec Kit Claude integration installed beside Copilot (`.claude/skills/speckit-*`, manifests), default stays `copilot`. Tested first on a throwaway branch.
- **FR-002** `[IMPLEMENTED]` `AGENTS.md` canonical with a short "Working as a team" section; `CLAUDE.md` first line `@AGENTS.md`; `.github/copilot-instructions.md` a pointer.
- **FR-003** `[IMPLEMENTED]` Issue forms (task from spec, bug), `.github/labels.tsv` plus `.github/scripts/sync-labels.sh` that applies it (`status:*`, `spec:NNN`, `area:*`, `needs-owner-approval`, `spec-exempt`), `CODEOWNERS` (`/.specify/`, `/.claude/`, `AGENTS.md`, `CLAUDE.md`, `/.github/` -> `@vikramgorla`), PR template with spec reference, `Closes #N` and an *Agent used* field.
- **FR-004** `[IMPLEMENTED]` `spec-gate.sh`: branch must match `^[0-9]{3}-[a-z0-9][a-z0-9-]*$` (warning only for non-agent bot branches and for exempt PRs); when `src/` changes, `specs/NNN-*/{spec,plan,tasks}.md` must exist and the PR must change something in that folder; `Spec-Exempt` and `spec-exempt` label kept; messages mention `specify integration status`. `test:` `.github/scripts/test-spec-gate.sh`.
- **FR-005** `[IMPLEMENTED]` `.github/scripts/tasks-to-issues.sh` (dry-run by default, dedupes by task id in the title) and `.github/scripts/backlog-issues.sh` (the real backlog, dedupes by title); `/speckit-taskstoissues` documented as the alternative.
- **FR-006** `[KNOWN GAP]` GitHub Project "Agent Durbar board" (Status: Todo, Claimed, In progress, In review, Done; fields Spec ID, Owner, Area) owned by the org. Needs the `project` token scope; see tasks. Built-in project workflows (auto-set Status) can only be switched on in the web UI.
- **FR-007** `[IMPLEMENTED]` real: ruleset `main protection` (id 25258904) created via `gh api` after the merge and one green CI run on `main`; body in `.github/ruleset-main.json`: PR required, 1 approval, Code Owners review, stale approvals dismissed on push, required checks `Spec Kit gate` + the five CI jobs, no force-push, no deletion; bypass for the repository admin role in `pull_request` mode (merge without approval, no direct push). `[KNOWN GAP]` not yet exercised by a contributor PR; the contributor-side behavior (approval counts, CODEOWNERS prompts) is unverified.
- **FR-008** `[IMPLEMENTED]` `docs/collaboration.md`: plain-English steps for a contributor and their Claude agent.
- **FR-009** Nothing in this feature invites anyone, publishes a release, spends AI credits, or stores a secret.

### Out of scope

gh-aw work queue; merge queue (not available for personal-account repos; not evaluated for the org repo); Copilot-cloud-agent assignment flow; changing `src/`.

## Success Criteria

- **SC-001** `bash .github/scripts/test-spec-gate.sh` passes (all gate cases).
- **SC-002** `specify integration status --json` shows `modified_managed_files: 0`, `missing_managed_files: 0` and only the accepted `unsafe-multi-install` finding.
- **SC-003** `npm run typecheck && npm run build && npm test` still pass; CI is green on the PR.
