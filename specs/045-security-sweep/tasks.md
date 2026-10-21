# Tasks: Security and quality sweep (045)

- [x] T001 FR-001 uniform place ids, test
- [x] T002 FR-002 one-pass unescape in the remove-folder confirm, test
- [x] T003 FR-003 `windowsCmd` for `.cmd` shims (vscode.ts, detect.ts), tests
- [x] T003a FR-004 navigation only to the app page, FR-005 web permissions refused except clipboard writes; tests and an Electron check
- [x] T004 Docs: CHANGELOG, specs index, SECURITY.md if affected
- [x] T005 After merge: dismiss the test-only and false-positive alerts with reasons; check the fixed ones closed (2026-10-19: #2-#30 dismissed as used in tests, #33 as a false positive, #31 as won't fix with the reason, Dependabot #1 as tolerable risk; #1 and #32 closed as fixed; 0 open alerts)
- [x] T020 FR-008 every IPC handler through ipcHandle/ipcOn with the sender check; static test (#332)
- [x] T021 (2026-10-21, #411) Split `src/main/main.ts` into `src/main/ipc/<area>.ts` modules with `register(deps)` (FR-060). No behaviour change: same channels, arguments, results and `fromApp` checks. Done: the channel test (every preload channel registered exactly once, all via `ipcHandle`/`ipcOn`, the `fromApp` set unchanged), `test-wincmd` passes over `src/main/ipc/`, `npm run typecheck && npm run build && npm test`, `node scripts/ui-suite.js` all green, `npm run check:office`.
