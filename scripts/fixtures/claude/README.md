# Claude fixtures (synthetic)

These files are **synthetic**: written by hand from the Claude Agent SDK docs and `specs/012-claude-codex-adapters/research.md`
(section 2.2), never captured from a real account or session. Each has `"provenance": "synthetic"`. The message shapes are
therefore unverified until a recorded run replaces them (spec 012 Phase 4, needs the owner's approval).

Each file: `messages` (SDK stream messages in order) and `expected` (the normalized events `ClaudeMapper` must emit, without
`sessionId` and `timestamp`). Used by `scripts/test-claude-map.ts`. No secrets, no real paths or ids.
