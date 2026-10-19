# Claude fixtures (synthetic, and one redacted real recording)

These files are **synthetic**: written by hand from the Claude Agent SDK docs and `specs/012-claude-codex-adapters/research.md`
(section 2.2), never captured from a real account or session. Each has `"provenance": "synthetic"`. The message shapes are
therefore unverified until a recorded run replaces them (spec 012 Phase 4, needs the owner's approval).

Each file: `messages` (SDK stream messages in order) and `expected` (the normalized events `ClaudeMapper` must emit, without
`sessionId` and `timestamp`). Used by `scripts/test-claude-map.ts`. No secrets, no real paths or ids.

**Exception (spec 012 T067, 2026-10-19):** `real-readonly-read.json` has `"provenance": "real-redacted"`. It was recorded from Claude Code 2.1.303 (`haiku`) with Durbar's Read-only flags: one prompt that reads a file. The recording was redacted before it was committed:
- ids and uuids are placeholders, and paths are `/work/demo`;
- the `init` message keeps only a few fields (no agents, skills, plugins or memory paths);
- rate-limit details and timing fields are dropped;
- the tool input deltas are merged into one.

The test also scans it for real paths, keys and e-mail addresses. Its `expected` list is what the mapper emitted for it when it was recorded, so a change in the mapper's output shows up as a diff against a real stream.

