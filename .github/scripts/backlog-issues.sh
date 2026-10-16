#!/usr/bin/env bash
# Creates the issues for the open backlog as of 2026-10-16 (the ones that are not a single tasks.md line, plus calls to
# tasks-to-issues.sh for the ones that are). Idempotent: an issue with the same title is skipped. Dry run unless --create.
#   bash .github/scripts/backlog-issues.sh            # dry run
#   bash .github/scripts/backlog-issues.sh --create
# Needs `gh` logged in with write access and the labels from sync-labels.sh. Assigns nobody.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
create=0; [ "${1:-}" = "--create" ] && create=1
repo_url="$(gh repo view --json url --jq .url)"
existing="$(gh issue list --state all --limit 500 --json title --jq '.[].title')"

mk() { # title labels body
  local title="$1" labels="$2" body="$3"
  if printf '%s\n' "$existing" | grep -Fxq -- "$title"; then echo "skip (exists): $title"; return; fi
  if [ "$create" = 1 ]; then
    echo "created: $(gh issue create --title "$title" --label "$labels" --body "$body")  $title"
  else
    echo "would create: $title  [labels: $labels]"
  fi
}
footer='**Rules** (AGENTS.md "Working as a team"): claim it by assigning yourself and adding `status:claimed`; branch `NNN-slug`; spec, plan and tasks first; PR with `Closes #<this issue>`. No real agent sessions, purchases or cloud runs without asking your human owner.'
spec() { printf '%s/blob/main/specs/%s' "$repo_url" "$1"; }

mk "[012] Claude Code and Codex adapters: clarify, plan and tasks first" "task,spec:012,area:adapters" "$(cat <<B
Spec: [012-claude-codex-adapters]($(spec 012-claude-codex-adapters/spec.md)) is a draft: **no plan.md or tasks.md yet** and it was never clarified.

First step of this issue: run \`/speckit-clarify\`, \`/speckit-plan\` (research the transport: SDK, ACP or headless JSON; record sub-agent identity trade-offs), \`/speckit-tasks\`, \`/speckit-analyze\`, commit them (PR 1). Then split the resulting tasks into issues with \`.github/scripts/tasks-to-issues.sh\`. Related: 002 T025 (second adapter proves the interface).

$footer
B
)"

mk "[013] Live verification of Stop, resume and thinking on a real session (needs owner approval: spends AI credits)" "task,spec:013,area:adapters,needs-owner-approval" "$(cat <<B
Spec: [013-live-verification-stop-resume-thinking]($(spec 013-live-verification-stop-resume-thinking/spec.md)). Closes the \`[KNOWN GAP]\`s of 002, 005, 006, 007, 009 that were only ever checked on the simulator.

**Blocked until the maintainer states a prompt budget in writing** (spec suggests at most 15 prompts on a cheap model); it spends the maintainer's Copilot AI credits. Do not run \`npm run smoke\` or \`scripts/capture-raw.ts\` for this without that. Output: evidence (redacted fixtures, spec updates from \`[KNOWN GAP]\` to \`real:\` with date and versions).

$footer
B
)"

mk "[014] Code signing and notarization for macOS and Windows (needs owner approval: purchase)" "task,spec:014,area:packaging,needs-owner-approval" "$(cat <<B
Spec: [014-signing-and-notarization]($(spec 014-signing-and-notarization/spec.md)) (draft, no plan or tasks yet).

**Nothing may be bought, enrolled or configured, and no Actions secrets created, until the maintainer approves in writing.** Allowed now: research and a draft plan (cost options, Apple Developer ID, Windows signing options such as Azure Trusted Signing or SignPath for open source), recommendations only. Related: 008 T020.

$footer
B
)"

bash .github/scripts/tasks-to-issues.sh specs/003-permissions-and-approvals --task T020 --task T025 --area permissions $([ "$create" = 1 ] && echo --create)

mk "[020] Per-folder import of MCP servers from VS Code mcp.json" "task,spec:020,area:mcp" "$(cat <<B
Spec: [020]($(spec 020-tools-all-time-and-mcp-cli-primary/spec.md)) lists this as a \`[KNOWN GAP]\`: the global import screens were removed in milestone 10; a **per-folder** import from VS Code's \`mcp.json\` (read-only, names, command or URL, env/header keys only, never written) is still missing. Start with a spec delta in 020 (and /speckit-clarify), then plan and tasks. See also 019 FR-006 for how the old import read the file.

$footer
B
)"

mk "[011] Office-wide usage totals (header total, per-folder totals)" "task,spec:011,area:usage" "$(cat <<B
Spec: [011]($(spec 011-credit-caps-and-usage-display/spec.md)) "Still backlog": office-wide total in the header, per-folder totals, persisted usage, multiplier estimate. The per-session cap slice is built. Needs a spec delta and clarification first (what is shown, where, and how it persists), then plan and tasks. Test on the simulator only (no AI credits).

$footer
B
)"

mk "[008 T021] Install and run the built packages on real macOS and Windows machines" "task,spec:008,area:platform" "$(cat <<B
Spec: [008]($(spec 008-packaging-and-release/tasks.md)) T021 / FR-010: installed builds were never run on macOS or Windows by a person; CI only proves they build and unit tests pass. Needs a person with that hardware. Record what you ran (OS version, arch, build, Gatekeeper/SmartScreen steps) in the spec and README. Related: 004 T025 (drag/drop/paste), 009 T022 (Open in VS Code), all hand checks. Real agent sessions need the owner's approval; the simulator needs none (\`DURBAR_SIM=15\`).

$footer
B
)"

mk "[001 T024] Hand-check the office UI on macOS and Windows" "task,spec:001,area:platform,area:ui" "$(cat <<B
Spec: [001]($(spec 001-office-view-and-densities/tasks.md)) T024. Run the app on the simulator (\`DURBAR_SIM=15 npm start\`) on a real macOS and a real Windows machine; check 15 agents at 1440x900 and 1280x800 (no overlap, text >= 10.5px, no scrolling the office), fonts and window chrome. Add screenshots under \`docs/screenshots/\` and record the result in tasks.md.

$footer
B
)"
