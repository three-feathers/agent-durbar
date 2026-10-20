# Plan 061 (draft)

1. **Constitution amendment** (maintainer): principle III gains the folder-setup paragraph (see spec, *Constitution*). Nothing below starts before it.
2. **Research R1-R3:** one tiny real session per agent app, in a scratch folder with a fake MCP server (`echo`), a hook that writes a marker file, and allow and deny rules. Record each as `real:`.
3. **Scanner** (pure, main): `scanFolderSetup(dir) → { claude, codex, copilot }`, size caps, masking, a hash per file. Unit tests on fixture folders.
4. **Dialog and storage** (renderer and main): on folder add, and once for saved folders; per-item switches; a hash change shows the dialog again.
5. **Adapters** (FR-004): apply per app, following R1-R3; contract tests on the fakes.
6. **Chip, activity log, docs, screenshots** (FR-005, FR-006).
