#!/usr/bin/env bash
# Spec Kit gate: a pull request that changes anything under src/ must also change something under specs/,
# unless it declares an exemption. Presence check only: reviewers judge the content (see the PR template).
#
# Exemption (either one):
#   - a label whose name starts with "spec-exempt" (case-insensitive), applied by a maintainer; or
#   - a line "Spec-Exempt: <reason>" in the PR description (outside HTML comments, reason of 4+ characters).
#
# Inputs (environment): BASE_SHA, HEAD_SHA, PR_BODY (may be empty), PR_LABELS_JSON (JSON array of label names, default []).
# Output: exit 0 = pass, exit 1 = fail (with an explanation).
set -euo pipefail

: "${BASE_SHA:?BASE_SHA is required}"
: "${HEAD_SHA:?HEAD_SHA is required}"
PR_BODY="${PR_BODY:-}"
PR_LABELS_JSON="${PR_LABELS_JSON:-[]}"

summary() { if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n' "$*" >> "$GITHUB_STEP_SUMMARY"; fi; printf '%s\n' "$*"; }

changed="$(git diff --name-only "${BASE_SHA}...${HEAD_SHA}")"
src_files="$(printf '%s\n' "$changed" | grep -E '^src/' || true)"
spec_files="$(printf '%s\n' "$changed" | grep -E '^specs/' || true)"

if [ -z "$src_files" ]; then
  summary "Spec Kit gate: no changes under src/, nothing to check."
  exit 0
fi

if [ -n "$spec_files" ]; then
  summary "Spec Kit gate: passed. src/ changed together with specs/ ($(printf '%s\n' "$spec_files" | wc -l | tr -d ' ') spec file(s))."
  exit 0
fi

# Exemption by label (needs triage rights to apply, so it is the stronger of the two).
if printf '%s' "$PR_LABELS_JSON" | jq -e 'any(.[]; ascii_downcase | startswith("spec-exempt"))' >/dev/null 2>&1; then
  summary "Spec Kit gate: passed by label 'spec-exempt' (src/ changed without specs/). The reviewer must agree with the reason."
  exit 0
fi

# Exemption by a line in the PR description. HTML comments (the PR template's hint) are ignored.
body_no_comments="$(printf '%s' "$PR_BODY" | tr -d '\r' | perl -0pe 's/<!--.*?-->//gs')"
reason="$(printf '%s\n' "$body_no_comments" | sed -nE 's/^[[:space:]]*[Ss]pec-[Ee]xempt:[[:space:]]*(.*[^[:space:]])[[:space:]]*$/\1/p' | head -n 1)"
if [ -n "$reason" ] && [ "${#reason}" -ge 4 ] && [ "${reason#<}" = "$reason" ]; then
  summary "Spec Kit gate: passed by 'Spec-Exempt: ${reason}' (src/ changed without specs/). The reviewer must agree with the reason."
  exit 0
fi

echo "::error title=Spec Kit gate::This pull request changes src/ but not specs/."
summary "Spec Kit gate: FAILED."
summary ""
summary "Files changed under src/:"
printf '%s\n' "$src_files" | sed 's/^/  - /' | while IFS= read -r l; do summary "$l"; done
summary ""
summary "Every behavior change goes through the Spec Kit workflow (see CONTRIBUTING.md, 'Spec Kit workflow is mandatory'):"
summary "  1. /speckit.specify (or a spec delta in the owning specs/NNN-*/spec.md for a bug fix), /speckit.plan, /speckit.tasks"
summary "  2. commit the spec, plan and tasks changes in this pull request"
summary "Only for changes with no behavior change (typo, comment, formatting, dependency bump, CI-only) add a line"
summary "'Spec-Exempt: <reason>' to the pull request description, or ask a maintainer for the 'spec-exempt' label."
exit 1
