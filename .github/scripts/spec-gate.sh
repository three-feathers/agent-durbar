#!/usr/bin/env bash
# Spec Kit gate. Presence checks only: reviewers judge the content (see the PR template).
#   1. Branch name must be NNN-slug (NNN = the spec number, e.g. 003-grant-scope-windows). Failing this is an error, except
#      that it is only a WARNING for non-agent bot branches (Dependabot, Renovate, github-actions) and for exempt PRs.
#   2. A pull request that changes anything under src/ must also change files in specs/NNN-*/ (the NNN of the branch), and
#      that folder must contain spec.md, plan.md and tasks.md. (Branch not NNN-slug, bot only: any specs/ change is enough.)
#   The exemption (below) skips check 2 and softens check 1 to a warning.
#
# Is your Spec Kit setup intact? Run `specify integration status` (it exits 1 with the single accepted finding
# `unsafe-multi-install` when Claude and Copilot are both installed; anything else is drift).
#
# Exemption (either one):
#   - a label whose name starts with "spec-exempt" (case-insensitive), applied by a maintainer; or
#   - a line "Spec-Exempt: <reason>" in the PR description (outside HTML comments, reason of 4+ characters).
#
# Inputs (environment): BASE_SHA, HEAD_SHA, PR_BODY (may be empty), PR_LABELS_JSON (JSON array of label names, default []),
#   HEAD_REF (branch name; empty = skip the branch check), PR_AUTHOR_LOGIN, PR_AUTHOR_TYPE (User|Bot).
# Output: exit 0 = pass, exit 1 = fail (with an explanation).
set -euo pipefail

: "${BASE_SHA:?BASE_SHA is required}"
: "${HEAD_SHA:?HEAD_SHA is required}"
PR_BODY="${PR_BODY:-}"
PR_LABELS_JSON="${PR_LABELS_JSON:-[]}"
HEAD_REF="${HEAD_REF:-}"
PR_AUTHOR_LOGIN="${PR_AUTHOR_LOGIN:-}"
PR_AUTHOR_TYPE="${PR_AUTHOR_TYPE:-User}"

summary() { if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n' "$*" >> "$GITHUB_STEP_SUMMARY"; fi; printf '%s\n' "$*"; }

changed="$(git diff --name-only "${BASE_SHA}...${HEAD_SHA}")"
src_files="$(printf '%s\n' "$changed" | grep -E '^src/' || true)"
spec_files="$(printf '%s\n' "$changed" | grep -E '^specs/' || true)"

errors=0
fail() { echo "::error title=Spec Kit gate::$1"; summary "ERROR: $1"; errors=$((errors + 1)); }
warn() { echo "::warning title=Spec Kit gate::$1"; summary "WARNING: $1"; }

# --- exemption (label or line in the description); computed first because it also softens the branch check ---
exempt=""
if printf '%s' "$PR_LABELS_JSON" | jq -e 'any(.[]; ascii_downcase | startswith("spec-exempt"))' >/dev/null 2>&1; then
  exempt="label 'spec-exempt'"
else
  # HTML comments (the PR template's hint) are ignored.
  body_no_comments="$(printf '%s' "$PR_BODY" | tr -d '\r' | perl -0pe 's/<!--.*?-->//gs')"
  reason="$(printf '%s\n' "$body_no_comments" | sed -nE 's/^[[:space:]]*[Ss]pec-[Ee]xempt:[[:space:]]*(.*[^[:space:]])[[:space:]]*$/\1/p' | head -n 1)"
  if [ -n "$reason" ] && [ "${#reason}" -ge 4 ] && [ "${reason#<}" = "$reason" ]; then
    exempt="'Spec-Exempt: ${reason}'"
  fi
fi

# --- 1. branch name ---
nnn=""
if [ -n "$HEAD_REF" ]; then
  if printf '%s' "$HEAD_REF" | grep -Eq '^[0-9]{3}-[a-z0-9][a-z0-9-]*$'; then
    nnn="${HEAD_REF%%-*}"
    summary "Branch '${HEAD_REF}': ok (spec ${nnn})."
  else
    # Non-agent bots (Dependabot and friends) only get a warning. Agent bots (Copilot, Claude, Codex) must conform.
    is_bot=0
    if [ "$PR_AUTHOR_TYPE" = "Bot" ] && ! printf '%s' "$PR_AUTHOR_LOGIN" | grep -Eiq 'copilot|claude|codex|agent'; then is_bot=1; fi
    case "$HEAD_REF" in dependabot/*|renovate/*) is_bot=1;; esac
    msg="Branch '${HEAD_REF}' is not NNN-slug (3-digit spec number, lowercase words, e.g. 003-grant-scope-windows). Rename it: git branch -m <NNN-slug>, push, and reopen the PR."
    if [ "$is_bot" = 1 ]; then warn "$msg (bot branch: warning only)"
    elif [ -n "$exempt" ]; then warn "$msg (not enforced here because the PR is exempt via ${exempt})"
    else fail "$msg"; fi
  fi
fi

# --- 2. src/ needs the spec folder ---
if [ -z "$src_files" ]; then
  summary "No changes under src/: spec folder check not needed."
elif [ -n "$exempt" ]; then
  summary "Spec Kit gate: spec check skipped by ${exempt} (src/ changed). The reviewer must agree with the reason."
else
  if [ -z "$spec_files" ]; then
    fail "This pull request changes src/ but not specs/."
  elif [ -n "$nnn" ]; then
    folder="$(git ls-tree --name-only "${HEAD_SHA}:specs" 2>/dev/null | grep -E "^${nnn}-" | head -n 1 || true)"
    if [ -z "$folder" ]; then
      fail "No folder specs/${nnn}-*/ exists. Create it with /speckit-specify (Claude) or /speckit.specify (Copilot), then plan and tasks."
    else
      for f in spec.md plan.md tasks.md; do
        if ! git cat-file -e "${HEAD_SHA}:specs/${folder}/${f}" 2>/dev/null; then fail "specs/${folder}/${f} is missing (spec, plan and tasks must all exist before code)."; fi
      done
      if ! printf '%s\n' "$spec_files" | grep -q "^specs/${folder}/"; then
        fail "This pull request changes src/ but nothing in specs/${folder}/ (the spec of branch ${HEAD_REF}). Tick the task in tasks.md, add the spec delta, or fix the branch number."
      fi
    fi
  else
    summary "src/ changed together with specs/ ($(printf '%s\n' "$spec_files" | wc -l | tr -d ' ') spec file(s)); branch has no spec number, so the folder check was skipped."
  fi
fi

if [ "$errors" -eq 0 ]; then
  summary "Spec Kit gate: passed."
  exit 0
fi

summary ""
summary "Spec Kit gate: FAILED (${errors} problem(s))."
if [ -n "$src_files" ]; then
  summary "Files changed under src/:"
  printf '%s\n' "$src_files" | sed 's/^/  - /' | while IFS= read -r l; do summary "$l"; done
fi
summary ""
summary "Every behavior change goes through the Spec Kit workflow (AGENTS.md, CONTRIBUTING.md 'Spec Kit workflow is mandatory'):"
summary "  1. spec, plan and tasks in specs/NNN-*/ (a bug fix is a dated spec delta in the owning spec), committed in this pull request"
summary "  2. branch name NNN-slug, same NNN as the spec folder"
summary "Only for changes with no behavior change (typo, comment, formatting, dependency bump, CI-only) add a line"
summary "'Spec-Exempt: <reason>' to the pull request description, or ask a maintainer for the 'spec-exempt' label and then save the description once (a label alone does not re-run this check)."
summary "Spec Kit tooling broken or missing skills? Run 'specify integration status' (see docs/collaboration.md)."
exit 1
