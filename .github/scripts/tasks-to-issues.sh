#!/usr/bin/env bash
# Turn the unchecked tasks of one spec's tasks.md into GitHub issues (one issue = one Spec Kit task).
#
#   bash .github/scripts/tasks-to-issues.sh specs/003-permissions-and-approvals                 # dry run: prints what it would create
#   bash .github/scripts/tasks-to-issues.sh specs/003-permissions-and-approvals --create        # creates the issues
#   bash .github/scripts/tasks-to-issues.sh specs/003-permissions-and-approvals --task T020 --task T025 --area permissions --create
#
# Options: --create (default is dry run), --task Tnnn (repeatable; default all unchecked tasks), --area <name> (label area:<name>),
#          --label <extra> (repeatable), --repo owner/name.
# Dedupes: an open or closed issue whose title starts with "[NNN Tnnn]" is skipped. Needs `gh` logged in with write access.
# Alternative inside an agent: /speckit-taskstoissues (Claude) or /speckit.taskstoissues (Copilot); this script needs no MCP server.
# Never assigns anyone: claiming is a person's decision (assign yourself + label status:claimed).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

spec_dir="${1:?usage: tasks-to-issues.sh specs/NNN-name [--create] [--task Tnnn]... [--area x] [--label y]... [--repo o/r]}"; shift
create=0; area=""; repo_args=(); tasks=(); labels=()
while [ $# -gt 0 ]; do
  case "$1" in
    --create) create=1;;
    --task) tasks+=("${2:?}"); shift;;
    --area) area="${2:?}"; shift;;
    --label) labels+=("${2:?}"); shift;;
    --repo) repo_args=(--repo "${2:?}"); shift;;
    *) echo "unknown option $1" >&2; exit 2;;
  esac
  shift
done

spec_dir="${spec_dir%/}"
tasks_file="$spec_dir/tasks.md"
[ -f "$tasks_file" ] || { echo "no $tasks_file" >&2; exit 1; }
base="$(basename "$spec_dir")"; nnn="${base%%-*}"
case "$nnn" in [0-9][0-9][0-9]) ;; *) echo "$spec_dir is not specs/NNN-name" >&2; exit 1;; esac

repo_url="$(gh repo view "${repo_args[@]}" --json url --jq .url)"
existing="$(gh issue list "${repo_args[@]}" --state all --limit 500 --json title --jq '.[].title' 2>/dev/null || true)"

n=0
while IFS= read -r line; do
  # "- [ ] T020 Description [FR-010]"
  id="$(printf '%s' "$line" | sed -nE 's/^- \[ \] (T[0-9]{3,4})[[:space:]].*/\1/p')"
  [ -n "$id" ] || continue
  if [ "${#tasks[@]}" -gt 0 ]; then
    keep=0; for t in "${tasks[@]}"; do [ "$t" = "$id" ] && keep=1; done
    [ "$keep" = 1 ] || continue
  fi
  desc="$(printf '%s' "$line" | sed -E 's/^- \[ \] T[0-9]+[[:space:]]+//')"
  title_desc="$(printf '%s' "$desc" | sed -E 's/[[:space:]]*\[[^]]*\]$//' | cut -c1-100)"
  title="[${nnn} ${id}] ${title_desc}"
  if printf '%s\n' "$existing" | grep -Fq "[${nnn} ${id}]"; then echo "skip (exists): ${nnn} ${id}"; continue; fi
  body="$(cat <<BODY
**Spec**: \`${spec_dir}\` — task **${id}** in [tasks.md](${repo_url}/blob/main/${tasks_file})

${desc}

**Rules** (see AGENTS.md "Working as a team"): claim this by assigning yourself and adding \`status:claimed\`; branch \`${nnn}-<slug>\`; PR with \`Closes #<this issue>\`; spec, plan and tasks first; tick ${id} in tasks.md in your PR. No real agent sessions or paid runs without asking your human owner.
BODY
)"
  lbl="task,spec:${nnn}"; [ -n "$area" ] && lbl="$lbl,area:${area}"
  for l in "${labels[@]+"${labels[@]}"}"; do lbl="$lbl,$l"; done
  if [ "$create" = 1 ]; then
    url="$(gh issue create "${repo_args[@]}" --title "$title" --body "$body" --label "$lbl")"
    echo "created: $url  $title"
  else
    echo "would create: $title  [labels: $lbl]"
  fi
  n=$((n+1))
done < "$tasks_file"
[ "$create" = 1 ] || echo "(dry run: add --create to create $n issue(s))"
