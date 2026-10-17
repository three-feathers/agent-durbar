# Plan: 025 docs sync

1. Branch `025-docs-sync` from fresh `origin/main` (new worktree). Numbers 022 and 023 were taken by branches, 024 by `024-office-places` on origin; 025 is free in `specs/`, branches and PRs.
2. Audit README, CHANGELOG, CONTRIBUTING, SECURITY, `docs/`, `specs/README.md`, AGENTS/CLAUDE/copilot-instructions and screenshot links against `main`; fix what is stale (FR-004).
3. `AGENTS.md` "Keep docs in sync" (FR-001), pointers in the other agent files and docs.
4. PR template Docs section (FR-002).
5. `.github/scripts/docs-check.sh` + `test-docs-check.sh` + a separate job in `spec-kit.yml` (FR-003). `spec-gate.sh` is not touched, so the required *Spec Kit gate* cannot be affected.
6. Pull request with a statement that `AGENTS.md` and `.github/` are changed on purpose (Vikram's request); CI green; merge with `gh pr merge --squash --admin` like earlier PRs.

Constitution check: no code paths, no secrets, no AI credits (no real session run), honest limits recorded (principle VIII); non-blocking by design so contributors are not stopped.
