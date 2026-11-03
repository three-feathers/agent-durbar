# Tasks: 105 Files view and image preview

**Input**: [spec.md](spec.md), [plan.md](plan.md). **Tests** first, 0 credits. One PR per task. Numbers checked against `main`, remote branches and open PRs on 2026-11-02.

- [ ] T001 [F0, first, own PR] Image preview: channel, checks, thumbnail, large view; measure first the chat's memory with 30 thumbnails. Test: `test-image-preview` (cap, sniff, pixel bomb, SVG, token not a path, a file changed after attach refused, `x.png.exe` and PNG bytes named `.html` opened only as a private `.png` copy; mutants), a driver at both sizes; no CSP change [FR-001..FR-007, SC-006]
- [ ] T002 [F1] `files.ts`: `files:list`, `files:read`, confinement, platforms, lock; own tree, plain view, entry and drawer, push. Test first: adversarial unit tests; `scripts/check-files.js`; sim from a fake tree; sensitive review [FR-010, FR-011, FR-013, FR-016, FR-020..FR-022, FR-025, FR-026, FR-030, FR-031]
- [ ] T003 [F2] CodeMirror 6, lazy, tokens, Markdown path; full-screen and collapse icons with kept state; measure in Electron against 097 FR-178. Test: a driver proves no editor code before first open; `test:supplychain`; forced colours emulated [FR-012, FR-014, FR-015]
- [ ] T004 [F3] Quick edit: mode, Read-only refused in main, write path, conflict. Test first: hash, conflict, link, hard link, mode refusal in main, every form of FR-028 against `writeClass`, a dialog refused and a renderer flag ignored; mutants; three-agent review [FR-018, FR-019, FR-023, FR-027, FR-028, SC-005]
- [ ] T005 [F4] An agent or the disk changes the open file; README, `docs/features.md`, `docs/safety.md`, changelog fragment, pictures. Test: `check-files` steps; `[KNOWN GAP]` real Windows and macOS run asked of their owners [FR-024, FR-031]
