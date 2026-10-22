#!/usr/bin/env bash
# Spec 008 FR-104: which parts of CI a pull request needs, computed inside each job (there is no separate "What changed" job any
# more: it made every other job wait for a second runner). Writes code=true|false and themes=true|false to $GITHUB_OUTPUT.
#
# On a pull request the checkout is GitHub's test merge commit with fetch-depth 2, so HEAD^1 is the base branch and
# `git diff HEAD^1 HEAD` is exactly what the PR changes. Every other event (push to main, merge queue, schedule, by hand) runs
# everything.
#
#   code=false   only docs/, specs/ or Markdown changed: the job's steps are skipped and the job passes (required checks report)
#   themes=true  the look or the layout checks can change: the office job also runs theme geometry (spec 008 FR-031)
set -euo pipefail
out="${GITHUB_OUTPUT:-/dev/stdout}"
if [ "${EVENT_NAME:-}" != "pull_request" ]; then
  { echo "code=true"; echo "themes=true"; } >> "$out"
  exit 0
fi
files=$(git diff --name-only HEAD^1 HEAD)
echo "$files"
if printf '%s\n' "$files" | grep -qE '^(src/renderer/|scripts/check-office-overlap\.js|scripts/check-theme-geometry\.js|scripts/check-parallel\.js|scripts/fixtures/themes/|\.github/workflows/ci\.yml|\.github/scripts/ci-changes\.sh)'; then
  echo "themes=true" >> "$out"
else
  echo "themes=false" >> "$out"
fi
if printf '%s\n' "$files" | grep -qvE '^(docs/|specs/)|\.md$'; then
  echo "code=true" >> "$out"
else
  echo "code=false" >> "$out"
  echo "Docs, specs and Markdown only: build, test and office checks are skipped (the job passes)."
fi
