#!/usr/bin/env bash
# Spec 008 FR-104, FR-190: which parts of CI a pull request needs, computed inside each job (no separate "What changed" job in
# ci.yml: it made every other job wait for a second runner). The decision is in ONE place, .github/scripts/ci-changes.js (read its
# header): on a pull request it diffs the test merge commit (`git diff --name-only HEAD^1 HEAD`, fetch-depth 2) and writes
# code, themes, ui and macos to $GITHUB_OUTPUT; on every other event (push to main, merge queue, nightly, by hand) all are true.
# Node is on every GitHub runner image before setup-node.
set -euo pipefail
exec node "$(dirname "$0")/ci-changes.js"
