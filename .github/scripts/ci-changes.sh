#!/usr/bin/env bash
# Spec 008 FR-104, FR-191: which parts of CI a pull request needs, computed inside each job (no separate "What changed" job in
# ci.yml: it made every other job wait for a second runner). The decision is in ONE place, .github/scripts/ci-changes.js (read its
# header): on a pull request it diffs the test merge commit (`git diff --name-only HEAD^1 HEAD`, fetch-depth 2) and writes
# code, themes, ui and macos to $GITHUB_OUTPUT; on every other event all are true. Node is on every runner image before setup-node.
#
# Review of PR #1349 (as spec-kit.yml's spec-numbers job, PR #1316): on a pull request the BASE branch's copy of the decision runs
# (HEAD^1 of the test merge commit, reviewed on main), on the PR's checkout as data, so a PR that breaks ci-changes.js cannot skip its
# own checks; when the base has no copy yet (the PR that adds it), everything runs. This wrapper itself is the PR's copy, like the
# workflow files: CODEOWNERS review of .github/ guards those.
set -euo pipefail
out="${GITHUB_OUTPUT:-/dev/stdout}"
all() { printf 'code=true\nthemes=true\nui=true\nmacos=true\nos_sensitive=true\n' >> "$out"; }
if [ "${EVENT_NAME:-}" != "pull_request" ]; then
  echo "${EVENT_NAME:-no event}: not a pull request, everything runs."
  all
  exit 0
fi
# a relative folder in the checkout (no temp path to convert on the Windows runner's Git Bash); the diff compares commits, so an
# untracked folder changes nothing, and it is removed on exit
tmp=".ci-changes-base"
rm -rf "$tmp"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/.github/scripts" "$tmp/scripts"
if ! git show 'HEAD^1:.github/scripts/ci-changes.js' > "$tmp/.github/scripts/ci-changes.js" 2>/dev/null \
  || ! git show 'HEAD^1:scripts/safe-print.js' > "$tmp/scripts/safe-print.js" 2>/dev/null; then
  echo "The base branch has no .github/scripts/ci-changes.js yet (the PR that adds it): everything runs."
  all
  exit 0
fi
# spec 117 FR-012 (T048) and FR-387, reviews of #2032 and #2039: fail closed and write each decision output EXACTLY ONCE (GitHub does
# not document which line wins when a name repeats). The base copy writes into a file in the temp folder; each of code, themes, ui,
# macos, os_sensitive must be written once with exactly `true` or `false`; when any is left out (a base copy that exits 0 silently,
# or one older than os_sensitive), repeated or written with another value (`FALSE`, `false `, empty), everything runs (all true).
# Arguments pass through: `--suites` asks for the fast lane's outputs only (spec 117 FR-386, fast-lane.yml, advisory), passed on as written.
raw="$tmp/decision-output"
GITHUB_OUTPUT="$raw" node "$tmp/.github/scripts/ci-changes.js" --root . "$@"
if [ "${1:-}" = "--suites" ]; then
  if [ -f "$raw" ]; then cat "$raw" >> "$out"; fi
  exit 0
fi
lines=""
for k in code themes ui macos os_sensitive; do
  n=0; v=""
  if [ -f "$raw" ]; then n="$(grep -c "^$k=" "$raw" || true)"; v="$(grep "^$k=" "$raw" | head -n 1 | cut -d= -f2- || true)"; fi
  if [ "$n" != 1 ] || { [ "$v" != true ] && [ "$v" != false ]; }; then
    echo "The decision wrote no single exact $k=true|false: everything runs."
    all
    exit 0
  fi
  lines="$lines$k=$v
"
done
printf '%s' "$lines" >> "$out"
