# Plan 062

1. `.github/platforms.json` lists `ubuntu-latest`, `macos-latest` and `windows-latest`. A `platforms` setup job outputs it; the e2e and install-check matrices use `fromJSON`.
2. `scripts/e2e-real.ts` reuses `HarnessSetup` (spec 060 install routes), `detectorFor`, the adapter descriptors (`CLAUDE_DESCRIPTOR`, `CODEX_DESCRIPTOR`, `COPILOT_DESCRIPTOR`) and `redact`. It writes JSON plus a Markdown table, and exits 1 on any failure.
3. `.github/workflows/e2e-real.yml`: dispatch, weekly, and push to `main` on paths; secrets only in the check step.
4. `scripts/test-platforms.ts` in `npm test`.
5. Run it (verification push from the branch, then dispatch after merge), and record the results.
