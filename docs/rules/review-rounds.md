# Review rounds and pace

This file is rule text, part of [AGENTS.md](../../AGENTS.md) (FR-082): read it before you ask for review, review a PR, post checks, plan a round, sub-agents or load, or publish the daily release. It binds like AGENTS.md, unlike the guidance files (review checklist, agent-notes, agent-apps); "here" and "this file" in it mean AGENTS.md with `docs/rules/`.

## First time right

(FR-047..FR-049)
- **Adversarial self-review** of the real diff with [the checklist](../../docs/review-checklist.md).
- **Review-ready** (FR-048e): merged with `origin/main` and mergeable (`pr-gate.sh`), acceptance criteria and edge cases in the spec or issue, `npm run changelog:check` and `specs:check` run, CI read for the head sha only, adversarial cases for risky parsing or security. Never reduce CI, platform or security coverage.
- **Batch** fixes per push; state each round's delta.
- **Timing** (FR-048b, FR-063): drivers wait with `until()`, never a fixed sleep or single read; no wall-clock ratio asserts; split a CI suite over ~30 s.
- **Learn every round** (FR-049): reviewer and author add new mistakes to the checklist (pitfalls to agent-notes). Start each round with `git pull --ff-only origin main` and re-read changed rule files.
- **Fast lane**: a PR touching only the checklist and/or agent-notes needs one content approval from another side, no CI wait; the merger checks `git diff --name-only origin/main...HEAD`. Still a PR; no secrets or private links; secret scanning applies.

## Test once, then trust the record

(FR-036)
- **CI is the source of truth**: reviewers read `gh pr checks` for the head sha, not re-run suites.
- Locally run only what CI cannot prove, once: your own mutations, probes, security checks, Windows/macOS-only paths, drivers not in CI. PR CI runs real macOS only for platform-sensitive paths (FR-135), else a stub (FR-106): write "not verified on macOS".
- Post one-line `checks run at <sha>: …` after checks (what you ran); a reviewer only for checks CI cannot run. `reviewing at <sha>` is optional. Cite the source of results you did not produce. `pr-gate.sh` treats exactly these as status, anything more as an ask.
- The record holds only for its sha, except a main merge with unchanged patch id through the merge queue; `--admin` waits for CI on the new head.
- **Rounds** (FR-042): one list per round in chat, in landing order; claim what you review. Skip a PR assigned to another unless an owner asks or its claim is over 1 hour old with no review (ask to release).
- **One full review** (FR-056): the first assignee reviews fully; others skim for blockers, or ask openly, with reason, for a second pass on a security-heavy PR (*Sub-agents by size* list, or sandbox). Re-reviews: the same reviewer, smallest fitting model. One full-review approval suffices.
- **SLA** (FR-050): take another side's PR within ~30 minutes, in its human's hours; claim at once even if a security-heavy review takes longer. **Teammates' PRs first** (FR-043).

## Pace and load

- **Land before building** (FR-039): open PRs follow machine capacity (CPU, RAM, disk, one Electron), in FR-081 order, to cut the backlog; at most 5 features awaiting first review (spec-only PRs excluded; security and owner-urgent items may exceed, saying so). Masking bugs: one batched PR a day. Before asking a teammate's agent, run the Codex review and the spec 103 pre-review (posting off) and fix findings first.
- **Sub-agents by size** (FR-038): small = one smaller-model agent; medium = implementer that mutation-checks; sensitive (secrets, user files, IPC, redaction, permissions, spending) = analyst, implementer, reviewer. Two heavy agents per machine at most.
- **Weekly retro** (FR-063): each side posts its retro, blind first, on the week's "Weekly retro" issue the same day; whoever finishes first merges them; owner decisions: one batched message.
- **Daily release** (FR-064): when `main` has new fragments, agents publish a daily stable release unasked.
- **Red means owned** (FR-063): a red scheduled workflow gets an owner within 24 h or is paused (owner OK if it spends credits).
