#!/usr/bin/env bash
# Create or update the repository labels from .github/labels.tsv, plus one `spec:NNN` label per folder in specs/.
# Needs `gh` logged in with write access. Never deletes labels. Usage: bash .github/scripts/sync-labels.sh [owner/repo]
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
repo_args=()
if [ -n "${1:-}" ]; then repo_args=(--repo "$1"); fi

upsert() { # name color description
  gh label create "$1" --color "$2" --description "$3" --force "${repo_args[@]}" >/dev/null
  printf 'label %s\n' "$1"
}

while IFS=$'\t' read -r name color desc; do
  case "$name" in ''|'#'*) continue;; esac
  upsert "$name" "$color" "$desc"
done < .github/labels.tsv

for d in specs/[0-9][0-9][0-9]-*/; do
  d="${d%/}"; base="${d#specs/}"; n="${base%%-*}"
  upsert "spec:$n" "0e8a16" "Spec ${n}: ${base#*-}" 
done
