#!/usr/bin/env bash
# Docs check: a WARNING-ONLY reminder that user-visible changes need docs. It never fails (always exits 0), so it cannot block
# anyone, and it is NOT a required status check. Rules (see AGENTS.md "Keep docs in sync"):
#   1. src/ changed, but none of README.md, docs/, CHANGELOG.md changed          -> warning
#   2. package.json "scripts" changed, but README.md did not change             -> warning
# Either warning is switched off by a line "Docs: n/a <reason>" in the PR description (outside HTML comments; a reason of
# 4+ characters, not the template's "<reason>" placeholder) or by a label starting with "docs-n/a" or "spec-exempt".
#
# Inputs (environment): BASE_SHA, HEAD_SHA, PR_BODY (may be empty), PR_LABELS_JSON (JSON array of label names, default []).
# Output: GitHub warning annotations and the step summary. Exit code is 0 even on bad input.
set -uo pipefail

BASE_SHA="${BASE_SHA:-}"; HEAD_SHA="${HEAD_SHA:-}"
PR_BODY="${PR_BODY:-}"; PR_LABELS_JSON="${PR_LABELS_JSON:-[]}"

summary() { if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n' "$*" >> "$GITHUB_STEP_SUMMARY"; fi; printf '%s\n' "$*"; }
warn() { echo "::warning title=Docs check::$1"; summary "WARNING: $1"; }

if [ -z "$BASE_SHA" ] || [ -z "$HEAD_SHA" ]; then summary "Docs check: BASE_SHA/HEAD_SHA missing, nothing checked."; exit 0; fi
if ! changed="$(git diff --name-only "${BASE_SHA}...${HEAD_SHA}" 2>/dev/null)"; then summary "Docs check: could not diff, nothing checked."; exit 0; fi

# --- opt-out: label or "Docs: n/a <reason>" line ---
optout=""
if printf '%s' "$PR_LABELS_JSON" | jq -e 'any(.[]; ascii_downcase | (startswith("docs-n/a") or startswith("spec-exempt")))' >/dev/null 2>&1; then
  optout="a docs-n/a or spec-exempt label"
else
  body_no_comments="$(printf '%s' "$PR_BODY" | tr -d '\r' | perl -0pe 's/<!--.*?-->//gs' 2>/dev/null || true)"
  reason="$(printf '%s\n' "$body_no_comments" | sed -nE 's/^[[:space:]]*[Dd]ocs:[[:space:]]*[Nn]\/[Aa][[:space:]:,;-]*(.*[^[:space:]])[[:space:]]*$/\1/p' | head -n 1)"
  if [ -n "$reason" ] && [ "${#reason}" -ge 4 ] && [ "${reason#<}" = "$reason" ]; then optout="'Docs: n/a ${reason}'"; fi
fi

src_files="$(printf '%s\n' "$changed" | grep -E '^src/' || true)"
docs_touched="$(printf '%s\n' "$changed" | grep -E '^(README\.md|CHANGELOG\.md|docs/)' || true)"
readme_touched="$(printf '%s\n' "$changed" | grep -Fx 'README.md' || true)"

# package.json "scripts" lines added, removed or edited (a line like:   "name": "command",  inside the diff)
scripts_changed=""
if printf '%s\n' "$changed" | grep -Fxq 'package.json'; then
  scripts_changed="$(git diff -U0 "${BASE_SHA}...${HEAD_SHA}" -- package.json 2>/dev/null | grep -E '^[+-][[:space:]]+"[A-Za-z0-9:_.-]+": "[^"]*",?$' | grep -Ev '"(name|version|description|main|license|url|homepage|type|author)":' || true)"
fi

warned=0
if [ -n "$optout" ]; then
  summary "Docs check: opted out by ${optout}. The reviewer must agree with the reason."
else
  if [ -n "$src_files" ] && [ -z "$docs_touched" ]; then
    warn "src/ changed but README.md, CHANGELOG.md and docs/ did not. If users, scripts, permissions, settings, MCP/tool behavior, release status or contributors are affected, update them in this PR (AGENTS.md, 'Keep docs in sync'); otherwise add a line 'Docs: n/a <reason>' to the PR description."
    warned=1
  fi
  if [ -n "$scripts_changed" ] && [ -z "$readme_touched" ]; then
    warn "package.json scripts changed but README.md did not (its Development section lists the npm run commands). Update it, or add 'Docs: n/a <reason>' to the PR description."
    warned=1
  fi
  [ "$warned" = 0 ] && summary "Docs check: nothing to warn about."
fi
summary "Docs check is a reminder only: it never blocks the pull request."
exit 0
