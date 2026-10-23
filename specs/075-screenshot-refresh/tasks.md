# Tasks: Daily screenshot refresh

**Input**: [spec.md](spec.md), [plan.md](plan.md)
**Blocked by**: PR/branch `001-screenshot-sweep` (the one-command capture script) merging to `main`.

## Phase 1: Spec

- [x] T001 Spec, plan and tasks written and committed (this PR, spec only)

## Phase 2: Gate and capture

- [ ] T002 `scripts/screenshot-gate.ts` with `checkChangedPaths` (PNG-only, no `gallery.json`), `checkPng` (signature, IHDR size, cap) and `checkProvenance` (Actions API: run of the refresh workflow on main, schedule/dispatch, success, artifact `{sha, branch}`, PR head sha = recorded sha; author/marker advisory), with test cases for a forged author and an edited body, `scripts/test-screenshot-gate.ts` (including a `src/` file that must fail), `test:screenshot-gate` in `package.json`
- [ ] T003 Make the sweep's capture command accept an output folder and the size list, fixed seed and clock (in the sweep's script); two takes identical on Linux
- [ ] T004 Measure: byte-identical PNGs across two runs on each hosted OS; record font and flake findings in the spec (FR-031, FR-032)

## Phase 3: Workflow

- [ ] T005 `.github/workflows/screenshot-refresh.yml`: daily + dispatch, plan job, capture matrix from `platforms.json`, publish job, permissions `contents: write` + `pull-requests: write` only, actions pinned by SHA, `concurrency` group with cancel-in-progress
- [ ] T006 One fixed branch `screenshots/refresh`, update-or-open the single PR, close older screenshot PRs, `refreshed-from` marker; branch documented as bot-owned (no human pushes); the pushed `{sha, branch}` uploaded as a run artifact (not the PR body)
- [ ] T007 Run by `workflow_dispatch`; confirm a no-change day does nothing and a second run leaves the PR unchanged (SC-001, SC-003)

## Phase 4: Site and docs

- [ ] T008 Platform gallery section in `scripts/build-site.js` from `docs/screenshots/platforms/`; `test:site` covers its links
- [ ] T009 Docs: `docs/collaboration.md` (how the refresh PR is merged: text gate, `--admin --match-head-commit <checked sha>`, bot-owned branch), README note on the canonical Linux look, `docs/agent-notes.md` entry with what the first runs showed
- [ ] T010 Decide macOS daily or weekly from real minutes (FR-030)
- [ ] T011 `/speckit.converge`; update spec status and the index block
