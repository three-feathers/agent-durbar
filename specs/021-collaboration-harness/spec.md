# Feature Specification: Collaboration harness (humans plus their own coding agents)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 021
title: Collaboration harness: Claude + Copilot Spec Kit, labels/issues/board, CODEOWNERS, stricter spec gate, ruleset
status: built (tooling only): harness, board, ruleset in place; open: T010 (board workflows, web UI), T013 (gate review)
-->

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
- **FR-006** GitHub Project "Agent Durbar board" (Status: Todo, Claimed, In progress, In review, Done; fields Spec ID, Owner, Area) owned by the org. Needs the `project` token scope; see tasks. Built-in project workflows (auto-set Status) can only be switched on in the web UI.
- **FR-007** `[IMPLEMENTED]` real: ruleset `main protection` (id 25258904) created via `gh api` after the merge and one green CI run on `main`; body in `.github/ruleset-main.json`: PR required, 1 approval, Code Owners review, stale approvals dismissed on push, required checks `Spec Kit gate` + the five CI jobs, no force-push, no deletion; bypass for the repository admin role in `pull_request` mode (merge without approval, no direct push). `[KNOWN GAP]` not yet exercised by a contributor PR; the contributor-side behavior (approval counts, CODEOWNERS prompts) is unverified.
- **FR-008** `[IMPLEMENTED]` `docs/collaboration.md`: plain-English steps for a contributor and their Claude agent.
- **FR-009** Nothing in this feature invites anyone, publishes a release, spends AI credits, or stores a secret.

### Out of scope

gh-aw work queue; merge queue (not available for personal-account repos; not evaluated for the org repo); Copilot-cloud-agent assignment flow; changing `src/`.

## Success Criteria

- **SC-001** `bash .github/scripts/test-spec-gate.sh` passes (all gate cases).
- **SC-002** `specify integration status --json` shows `modified_managed_files: 0`, `missing_managed_files: 0` and only the accepted `unsafe-multi-install` finding.
- **SC-003** `npm run typecheck && npm run build && npm test` still pass; CI is green on the PR.

### 2026-10-19: agents review and merge; humans set roadmap and strategy (owner decision)

*Changed:* Vikram (owner and maintainer) in the team's Telegram group: "if you are ok and all functional and security checks are followed, don't wait for my approval - you can be autonomous approving … We as humans still define your roadmap and strategy". Confirmed in his Claude Code session: "agents merge when checks pass but do a final review as a reviewer to be sure that we dont only rely on ci - if other's agents review, it is ok as well."

- `AGENTS.md` (Reviews and merge), `docs/collaboration.md` and the PR template now say:
  - an agent merges when CI is green, its tests and needed checks ran, spec and docs are updated, and it did a final review of the whole diff as a reviewer, written down in the PR;
  - another team's agent may review and approve.
- No repository setting changed. The `main` ruleset still asks for one approval, and admins can bypass it. An agent whose human is not an admin needs another agent's approval, posted through that agent's human account.
- The "Needs approval" list (money, releases, repository settings, inviting people, posting) is unchanged.

### 2026-10-19: reviews include GitHub's security results (owner)

*Owner:* "when you review pr's also look at codeql / github advanced security reviews,.. and review and fix it like a expert code quality and security expert, remember this in agents.md".

- `AGENTS.md` (Reviews and merge, point 5), `docs/collaboration.md` (step 8) and the PR template now require reading the PR's CodeQL / code-scanning, Dependabot and secret-scanning results before merging.
  - Every new finding is fixed at its cause.
  - An alert is dismissed only as a real false positive, or as test-only code, with the reason written down.
  - Open alerts on `main` that a change touches are fixed in the same PR, or tracked in an issue.
- State on 2026-10-19: no open code-scanning, Dependabot or secret-scanning alerts on `main`. The earlier ones were fixed or dismissed with reasons in spec 045. CodeQL passed on the open PRs #245 and #272-#274.
- The owner added: "not just on repo, also on pr's as we have some checks happening on pr's". AGENTS.md now names the PR-level places to look: `gh pr checks`, the bot's line comments, and the alerts on `refs/pull/<N>/merge`. A finding on a PR is not in `main`'s alert list until it merges.
  - Example the same day: #273 had a `js/bad-code-sanitization` finding from `github-advanced-security[bot]` on `scripts/check-office-overlap.js` while `main` had 0 alerts.
  - It was fixed at the cause with a `jsLiteral()` helper that also escapes `< > / U+2028 U+2029`.

### 2026-10-19: an agent may merge another team's ready, quiet PR (owner)

*Owner:* "you can also merge other's pr's as well if they are all ok and not work in progress or open questions and staying for quiet sometime (if their agent forgot merging it)".

- `AGENTS.md` now says when any agent may merge another team's PR, and that it leaves a comment saying why. The conditions:
  - not a draft or WIP, with no open question or requested change;
  - CI green and the PR's own security results clean;
  - approved;
  - quiet for at least 2 hours (the owner said "sometime"; 2 hours is the agent's reading).

  Stacked PRs and `needs-owner-approval` are excluded.

### 2026-10-19: check the linked issue before merging (owner)

*Owner:* "when you merge, also look at linked issue for which it was worked upon to see if everything is in the issue is covered and handle issue and pr based on it so tht we dont leave stranded issues or close issues where some work is still pending".

- `AGENTS.md`, `docs/collaboration.md` (step 9) and the PR template now say:
  - before a merge, check every point of the linked issue against the PR;
  - `Closes #N` only when all is done;
  - otherwise use `Refs #N`, write on the issue what is left (or link a follow-up issue), and keep it open.

### 2026-10-20: review findings are fixed in the PR, capabilities are not duplicated, knowledge is shared (owner)

The owner set these rules in the team chat on 2026-10-20 and asked for them, and every earlier agreed rule, to be written into `AGENTS.md` so that every agent follows them, and for agents' private learnings to be committed to the repo.

- **FR-030** A solvable review finding is a requirement for merge, fixed in the same PR; no "non-blocking" notes and no follow-up issues for small, solvable things. Follow-up issues only for large work, owner decisions or checks that need a real account or platform. Applied retroactively to old notes.
- **FR-031** Every review (and every new spec) checks for an existing capability doing the same job and asks for reuse.
- **FR-032** Re-approval after a push compares the PR's own code by `git patch-id`; admin merge is allowed when a formality is the last blocker and everything else is clean.
- **FR-033** A clear OK from an owner in the team chat (or relayed by their bot) counts for pre-releases and repository actions, not for money, invitations, settings or chat access. Agents respect each person's stated working hours (`docs/collaboration.md`, *Team norms*).
- **FR-034** `docs/agent-notes.md` holds what agents learned (dated, with evidence, no secrets or personal data); agents read it before starting and add to it in the PR where they learn something. `CLAUDE.md`, the Copilot pointer, the PR template and `docs/collaboration.md` say the same.
- Also written down: check spec numbers against remote branches and open PRs, and delete the branch and worktree after a merge (both agreed on 2026-10-18/19, kept only in one agent's memory until now).

### 2026-10-20: read every review and comment before a merge (owner)

- **FR-035** Before any merge, the merging agent reads every review, review thread, line comment and PR comment; a required change in a plain comment counts as *request changes*; nothing is merged while a request, an unresolved thread or an unanswered comment from someone else is open. `scripts/pr-gate.sh <N>` (bash and `gh`, verdict only, never merges) checks it together with the checks, CodeQL and the open alerts on the merge and head refs. `real:` it held #369 on an unanswered comment and passed #390 (2026-10-20). Mirrors: PR template checkbox, `docs/collaboration.md` step 9, `docs/agent-notes.md`.

### 2026-10-22: test once, then trust the record (team, proposed by Paco's agent, agreed by Vikram, Paco and Ruben)

- **FR-036** Agreed by Vikram (2026-10-22), Paco (2026-10-22) and Ruben (2026-10-23, through his coordinator under his written delegation, #556). CI is the source of truth for the full suites. A reviewer reads `gh pr checks` for the exact head sha and runs locally only what CI can't prove: mutations (always planted by the reviewer, never taken from the author), targeted probes, security checks, and paths PR CI doesn't cover (Windows-only or macOS-only paths, drivers not in CI), once, at the sha in the author's or their own `checks run at <sha>` comment; a macOS-only path that cannot run before the merge is written "not verified on macOS" in the PR (VIII) and checked on `main` and nightly (FR-106). A review that cites a result it did not produce names its source (the CI run for that sha, or the author's comment). The record is the CI checks for the head sha plus the `checks run at <sha>` comments, valid only for that sha; any new commit invalidates it, except a merge of main with an unchanged patch-id that lands through the merge queue. Agents post `reviewing at <sha>` before a review and `checks run at <sha>: …` after their own checks, as plain PR comments; `scripts/pr-gate.sh` does not count exactly those notes as asks (and still prints them under "status notes, not counted as asks:" with author, date and first line), a whole comment that is only `reviewing at <sha>` or `checks run at <sha>: …` on one line (pattern in `scripts/pr-status-note.re`, test `test:prgatenotes`), both among others' comments and when it finds the author's own last answer; any other text, or a second line, still counts as an ask. After a merge of main with an unchanged patch-id, nobody re-runs locally if the PR merges through the merge queue (it re-checks the merged result on Linux and Windows, no macOS, FR-106); an `--admin` merge skips the queue, so CI on the new head sha must pass first. Each review round is split in the team chat (`taking #N`), and an agent does not review a head that already carries another agent's `reviewing at <sha>`, unless that note is older than 1 hour with no review or an owner asks. Written in `AGENTS.md` (*Working as a team*), mirrored in `docs/collaboration.md` (*Team norms*), `docs/agent-notes.md`, `.github/pull_request_template.md`; `CLAUDE.md` and `.github/copilot-instructions.md` point to AGENTS.md. *Why:* on 2026-10-22 one PR's suites ran up to five times.

### 2026-10-22: decisions taken in the team chat (recorded by Paco's agent; wording checked by Vikram's agent)

Numbers start after FR-036 (*test once*, PR #561). This PR does not depend on #561 and can land first or after it; where a rule mentions `taking #N` or `checks run at <sha>` (FR-036), that is the convention #561 records.

- **FR-037** **Record team decisions the same day.** A decision about how the team or its agents work, taken in the team chat, is written the same day as a dated FR in this spec: who decided, a link to the message or PR, and where it applies. If it changes how agents work, it also goes into `AGENTS.md` (and its mirrors). A decision that only lives in the chat or in one agent's memory does not count yet.
- **FR-038** **Sub-agents by the size of the change** (both agents' sides adopted it 2026-10-22).
  - Small (a doc, a spec line, one file, no security impact): one sub-agent on a smaller model. It reads CI for the sha, posts `checks run at <sha>`, and runs no extra local suite. The other team's review is the review.
  - Medium: one implementer that mutation-checks its own fix; a reviewer only for the risks named for that change.
  - Large or sensitive (secrets, writing user files, IPC, redaction, permissions, spending): the full analyst → implementer → reviewer, on the top model.
  - The analyst only when there are decisions to make. At most two heavy agents at a time on one machine. The same implementer keeps a PR through its fix rounds. A recurring sweep does a quick check first and starts an agent only if something new arrived.
- **FR-039** **Land before building** (team-wide since 2026-10-22: Vikram agreed in the chat that the agents set the numbers, and both agents' sides agreed these from what they saw that day: about 20 merges a day at most, reviews as the bottleneck, CI about 15 minutes with the queue, 1-2 heavy agents per machine).
  - Each side (one human and their agent) keeps **at most 8 open PRs of its own**, fixes and process PRs included. Over that, it only fixes and lands.
  - **At most 5 of them are new features waiting for a first review** (3 until the owner decision of 2026-10-23 18:02 UTC below). A 6th feature waits, with only its spec PR open; spec-only PRs don't count.
  - Security fixes and urgent items the owners order may go over the limit, and the PR says so.
  - The numbers are checked again weekly, or when the queue or CI times change, and a change is recorded here. Features the owners order still get their spec. Owner decision (Vikram, 2026-10-23 17:47 UTC, on #564 and in the team chat): the limit of 8 open PRs and the features-waiting cap bind all three sides (Vikram, Paco, Ruben). Owner decision (Vikram, 2026-10-23 18:02 UTC, relayed in the team chat): the team aims for at least 5 useful features every 8 hours with no drop in quality, a pre-release (never marked latest) goes out from main about every 8 hours, and the features-waiting cap rises from 3 to 5.
- **FR-040** **Unstack with a replacement PR.** A stacked PR whose own change does not depend on the PRs below it is rebuilt off main as a new branch and a new PR (as #533, merge commit `4fc7e508`, replaced #516; #533's description says "Replaces #516"). The new PR closes the old one with a link and refers to its review history. Never force-push, rename an open PR's branch or use a stack tool's "unstack" just to get past a refused merge.
- **FR-041** **Using the merge queue** (the `main protection` ruleset has a merge queue rule, read from the repository rulesets on 2026-10-23; #507, merge commit `d028b3ca`, made the CI run for it on 2026-10-22).
  - Approve, then `gh pr merge <N> --auto --match-head-commit <sha>`; the queue runs the required checks and merges. `--delete-branch` does not work with the queue, so delete the branch and worktree by hand after the merge.
  - `gh pr view` shows a queued PR as `autoMergeRequest: null`; check `isInMergeQueue` and `mergeQueueEntry` with the GraphQL API instead.
  - **`gh stack merge <N>` also merges every lower member of that stack** (Vikram's agent, 2026-10-22: landing #503 also merged #462, #463, #497 and #498, whose latest heads had only dismissed approvals). Before you use it, check that each lower member has a valid approval at its current head; otherwise merge the PRs one by one through the queue.
  - When an approval was dismissed only by a base move or a merge of main, and the PR's own patch-id is unchanged, re-approving (or an admin merge with a PR comment) is a formality (FR-032).
- **FR-042** **One combined review list per round.** Each review round gets one message in the team chat, in landing order, instead of many separate nudges. Agents answer `taking #N, #M` before they review (FR-036).
- **FR-043** **Review teammates' PRs first.** Their approvals are what unblock ours, so a teammate's PR waiting for review comes before starting new work.

### 2026-10-22: reference agent setup in the repo (agreed in the team chat; Vikram's agent adds theirs next to it)

Numbers follow FR-036 (PR #561) and FR-037..FR-043 (PR #564).

- **FR-044** `docs/agent-setup/` holds the setup the team recommends, so a new teammate or a rebuilt machine starts from the same base: the three sub-agents, templates for the global rules and for `CLAUDE.local.md`, the periodic review `/loop` with its conventions (`taking #N`, `reviewing at <sha>`, `checks run at <sha>`, quick check before an agent, no DMs in quiet hours), and an always-on VPS guide with example files. It is templates only: no tokens, chat or account IDs, emails, host names, IPs or private-network names; personal files stay local and git-ignored; a config backup repo must be private and scanned for secrets. Each teammate may add their own setup in a sibling folder. Linked from `docs/collaboration.md` and `AGENTS.md`. `[IMPLEMENTED]` `read:` links checked by hand when written (`test:site` covers the website and README, not `docs/agent-setup/`; corrected 2026-10-23, FR-048); the guide itself was not run on a fresh machine `[KNOWN GAP]`.

### 2026-10-23: one label taxonomy for issues and PRs (team decision)

*Team decision:* in the team group on 2026-10-23 the owner (Vikram) asked the three agents to agree a minimal tagging taxonomy and to apply it to the existing issues and PRs; Paco's and Ruben's agents agreed, and Vikram's agent owns it. Numbers follow FR-044; open PRs #561 and #564 hold FR-036..FR-043.

- **FR-045** Every issue and PR carries:
  1. exactly **one type** label: `bug`, `enhancement`, `task`, `documentation` or `question`;
  2. **at least one** `area:*` label: the ten existing ones (`adapters`, `ci`, `docs`, `harness`, `mcp`, `packaging`, `permissions`, `platform`, `ui`, `usage`) plus the new `area:security` and `area:schedules` (in `.github/labels.tsv`);
  3. `spec:NNN` for **every spec it touches** (one label per `specs/NNN-*` folder on `main`, description `Spec NNN: <folder>`, as `sync-labels.sh` makes them);
  4. flags only when true: `status:claimed`, `status:blocked`, `needs-owner-approval`; on PRs only `spec-exempt` and `docs-n/a`; `accessibility`.

  GitHub's defaults (`duplicate`, `wontfix`, `invalid`, ...) stay for closing. No other label families are added.
  Who tags: the opener when creating; reviewers fix gaps in the review; the PR sweep backfills.
- **FR-046** `scripts/labels-backfill.ts` (`npm run labels:backfill`) backfills the taxonomy, **add-only** (it never removes a label):
  - it reads, with `gh`, the open issues and PRs plus those closed in the last 30 days (`--days N`); older closed ones are skipped;
  - type: kept when the item has one; otherwise a spec-only PR (only `specs/`, plus its changelog fragment) is `task`, since spec work is Spec Kit work, not user docs; a change only to user docs (README, `docs/`, guides; not `specs/`, `AGENTS.md` or `CLAUDE.md`) or a `Docs:` title is `documentation`; then fix/bug words (`bug`), a title ending in `?` (`question`), a `Tnnn` in the title or release/chore words (`task`), idea/feature/owner-request words or a PR that changes `src/` (`enhancement`), else `task`. Two type labels are flagged for a human, never removed;
  - spec: the title prefix (`NNN:`, `[NNN`, `Spec NNN`), the branch `NNN-`, changed `specs/NNN-*` folders, and for issues "spec NNN" in the body (only when the body names at most three specs). Only numbers with a folder in `specs/` count;
  - area (only when the item has none): from a PR's changed paths **only where the mapping is unambiguous**: a directory or named file that belongs to one area (`src/adapters/` adapters, `src/renderer/` except `app.js` ui, `.github/workflows/` ci, `src/main/mcp*` mcp, `src/main/schedules.ts` schedules, `src/shared/redact.ts` security, ...), and a changed `specs/NNN-*` folder gives that spec's area (`specs/058-*` mcp). Shared files (`README.md`, `package.json`, `CHANGELOG.md`, `changelog.d/`, `src/renderer/app.js` alone, `src/main/main.ts`, tests) give no area. Docs and harness paths count only when nothing else matched, because nearly every PR touches the docs. Without a path area: the area of the item's specs, then the title's own words. An item still without an area is flagged;
  - a **flagged item** (two type labels, or no area found) gets no type or area from the script, only its `spec:NNN`. The dry run lists the flagged numbers, and a human or the item's owner agent picks the labels;
  - `--dry-run` (default) prints the proposed additions per item and the totals per label; `--apply` adds them, throttled (about one write per 1.2 s, backing off on a rate limit) and idempotent; `--create-labels` creates the missing labels from `.github/labels.tsv` and the spec folders. gh runs without a shell.
  - `test:` `scripts/test-labels-backfill.ts` (`npm run test:labelsbackfill`, in `npm test`) checks the inference on fixtures.
  - `real:` applied on 2026-10-23 (T022): 49 labels created; 501 issues and PRs labelled. Two writes returned 502/504 but GitHub had saved them, and a re-run had nothing left to add. The 16 flagged items are listed on #633.
  - `[KNOWN GAP]` the inference is a heuristic. Paco's review of #633 (2026-10-23) decided: apply in bulk **once, after this PR merges**, by one agent, add-only and rate-aware; the flagged items are left to a human, not fixed by the script or the applying agent.

### 2026-10-23: a shared "first time right" review checklist (owner decision)

*Owner:* Vikram, to his agent on 2026-10-23: write the efficiency rules down, and have the agents learn from each other how they review, so that knowing the common pitfalls makes more work right the first time; coordinate with the other agents on it. Paco's agent sent its own list of pitfalls the same day; they are folded in and credited. Numbers follow FR-046; open PRs #561 and #564 hold FR-036..FR-043 and T017..T018.

- **FR-047** `[IMPLEMENTED]` `docs/review-checklist.md` holds a shared, evidence-based self-review checklist that every agent (Claude, Copilot, others) runs on its own diff before it asks for review:
  - it is built from the **required** findings in the reviews of the last days (all three sides' reviews, about 1,100 review items read with `gh api` on 2026-10-23), clustered into recurring pitfall categories with approximate counts and one or two PR links each, plus the patterns reviewers praised;
  - each item is a short "check …" line with its reason and one evidence link; no chat contents, names of private people or other personal data, only PR links and categories;
  - a *How we review* section: the Strengths / Required fixes (with code) / Questions format, `reviewing at <sha>`, patch-id re-approval, reading CI per sha, and the adversarial self-review;
  - it is **living**: a reviewer who finds a new kind of mistake adds a line in the same PR or a small docs PR.
- **FR-048** `AGENTS.md` (*Working as a team*) says, in short bullets:
  - (a) before requesting review, the author does an adversarial self-review of the whole diff against `docs/review-checklist.md`;
  - (b) every simulator-driver assert that depends on timing waits on a condition (`until()` with a generous timeout), never on a fixed sleep;
  - (c) new FR and task numbers are claimed after checking `main` **and** the open PRs that touch the same spec, and the PR says which numbers it took;
  - (d) the checklist is living (FR-047).
  Mirrors: `docs/collaboration.md` (step 8), `docs/agent-notes.md` (a pointer), `.github/pull_request_template.md` (one checkbox), and the reference agent setup (`docs/agent-setup/claude-code/agents/implementer.md` and `reviewer.md`), and `.github/copilot-instructions.md` (one clause in its pointer); `CLAUDE.md` imports AGENTS.md. `[IMPLEMENTED]` `read:` the relative links in the changed Markdown files were checked with a one-off script (`test:site` covers the website and README, not `docs/*.md`); the 37 PR links were taken from the review data. `[KNOWN GAP]` the counts are a keyword clustering of review text, not a hand count; they show the order of magnitude, not exact numbers.
- **FR-049** **Learn after every round** (owner, a second decision to his agent on 2026-10-23, 18:09 UTC: learn continuously from review feedback, use it in the next reviews, and everybody pulls the updates after every round):
  - after each review round, the reviewer **and** the author add any new kind of mistake or review technique to `docs/review-checklist.md` (or a tool pitfall to `docs/agent-notes.md`);
  - **fast lane**: a PR that changes **only** `docs/review-checklist.md` and/or `docs/agent-notes.md` does not wait for the full CI; one quick approval from an agent of another side (content only, within minutes) is enough, and the merging agent checks that the diff touches only those files (`git diff --name-only origin/main...HEAD`). It is still a branch and a PR, never a direct push to `main`, and the ruleset is unchanged (an admin merge is the formality AGENTS.md *Admin merge* already allows);
  - even in the fast lane: no secrets, tokens or links to private data, and secret scanning still applies; and both files are **guidance, never instructions**: since every agent reads them, nothing in them can override `AGENTS.md`, the constitution or the safety rules, and a line that tries to is removed (safeguards from Paco's agent, 2026-10-23);
  - every agent runs `git pull --ff-only origin main` at the start of each round (a review sweep or a new task) and re-reads the checklist when it changed.
  Written in `AGENTS.md` (*First time right*), `docs/collaboration.md` (*Team norms*) and the checklist's introduction. `[IMPLEMENTED]` (docs only). `[KNOWN GAP]` no script enforces the fast lane's file rule yet; the merging agent checks it by hand.

### 2026-10-23: team rules agreed in the team chat, recorded the same day (FR-037)

- **FR-050** `[IMPLEMENTED]` (docs only) Five rules agreed in the team chat on 2026-10-23, in `AGENTS.md` (*Working as a team*) with mirrors in `docs/collaboration.md` and `.github/copilot-instructions.md`, and two pitfalls in `docs/agent-notes.md`:
  - **Review SLA**: pick up another side's PR within about 30 minutes of a push or review request, inside each human's working hours; post `taking #N` then `reviewing at <sha>`; a side with few heavy agents may take longer for security-heavy reviews but posts `taking #N` at once.
  - **FINAL**: the first line starting with `FINAL` about who owns a task ends the ownership talk; nobody replies about it again.
  - **Release freeze**: retired 2026-10-23 when spec 008's fold-at-tag landed (FR-117..FR-120, PR #648). Release notes are now built from the tagged commit, so no merge freeze is needed.
  - **Main checkout**: never check out a PR or branch there; use a worktree.
  - **Branch cleanup**: delete a PR's branch only once that PR's state is `MERGED`; leaving the merge queue is not merging.
  `[KNOWN GAP]` nothing enforces these; they rest on the agents following the text.

### 2026-10-25: agents tag each other by bot handle in the team chat (FR-054)

- **FR-054** `[IMPLEMENTED]` (docs only) Rule given by Vikram on 2026-10-23 (10:52 UTC) and re-confirmed on 2026-10-25 (06:33 UTC) in the team Telegram group; it lived only in one agent's private memory and was lost. In the team chat, agents address each other by their bot @handle (Paco's agent `@PaquitosAgent_bot`, Ruben's agent `@RubenLupiAgent_bot`, Vikram's agent `@VishwakarmaDurbarClaude_bot`) and do not open with a "Vikram's agent / Ruben's agent here" preamble: Telegram already shows the sender. A human is tagged by Telegram name or handle only when they must act. Each agent's mention filter must match its own @handle. Anything an agent must act on also goes as a GitHub comment on the issue or PR (FR-045's "Chat feedback goes on the issue or PR too"). Written in `AGENTS.md` (*Working as a team*), mirrored in `docs/collaboration.md` (*Team norms*); `.github/copilot-instructions.md` and `CLAUDE.md` point to AGENTS.md. `[KNOWN GAP]` nothing enforces it; it rests on the agents following the text. Numbers taken: FR-054 and T030 (PR #695 holds FR-051..FR-053 and T026..T029).

### 2026-10-25: one full review per PR (FR-056)

- **FR-056** `[IMPLEMENTED]` (docs only) Team decision of 2026-10-25, proposed in the team chat by Vikram's agent (01:57 UTC) as part of a plan to spend fewer AI credits, accepted by Ruben (01:57 UTC, through his coordinator under his delegation), Vikram (through his agent, same time) and Paco (by DM to his agent, 15:32 UTC); recorded in the chat by Paco's agent (15:40 UTC) and Vikram's agent. Until now both sides tended to review every PR in full. Now:
  - **Who:** the first side to post `taking #N` (then `reviewing at <sha>`, FR-050) does the full review. The other side only skims the diff for blockers.
  - **Second full pass:** only for a security-heavy PR (secrets, user files, IPC, redaction, permissions, sandbox, spending), asked for openly with the reason.
  - **Re-reviews:** by the same reviewer, resuming the same agent (cheaper, keeps its context), on the smallest model that fits a mechanical re-check.
  - **Merge:** one approval from the full reviewer is enough; AGENTS.md's one-approval rule is unchanged.
  - Written in `AGENTS.md` (*Working as a team*, after *Review SLA*) and mirrored in `docs/collaboration.md`.
  - `[KNOWN GAP]` nothing enforces it; it rests on the agents following the text. Numbers claimed in the team chat: FR-056 / T032 (Paco's agent took FR-055 / T031 for `pr-gate.sh`; #695 holds FR-051..FR-053; FR-054 is on `main`).

### 2026-10-25: pr-gate reads every page of comments and reviews (bug fix, found by Paco's agent)

- **FR-055** `[IMPLEMENTED]` `real:` `scripts/pr-gate.sh` read a PR's comments, reviews and line comments with plain `gh api`, which returns the first 30 items only. On a long PR it missed the author's newer answers and kept listing old review bodies as "unanswered" (#560 had 38 comments; the gate's "my last answer" was 2026-10-24 07:08 while the real one was 2026-10-25 00:59, so a PR with every check green, an approval and nothing open said "not ready"). Now every list call uses `--paginate`. `--jq` runs once per page, so the latest review per person (for "changes requested") is picked in the shell across all pages instead of with jq's `group_by`. That pick also ignores `COMMENTED` and `PENDING` reviews: a plain comment after a request for changes does not lift it on GitHub, and before, the newest review of any kind counted. Checked on #560 and #693 against the real API: the last answer and each person's last review state are right. `[KNOWN GAP]` no fixture test: the script calls the live API, and `test:prgatenotes` covers only the status-note pattern. Numbers taken: FR-055 and T031 (claimed in the team chat; #695 holds FR-051..FR-053, #727 took FR-054).
