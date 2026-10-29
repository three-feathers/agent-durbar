#!/bin/bash
# scripts/claim.sh <issue or PR number>: claim an issue, or the review of a PR (AGENTS.md, "Claim, label, branch"; spec 021 FR-063, T043).
#   scripts/claim.sh <N>                    claim; the first assignee owns it
#   scripts/claim.sh --release <N> [why]    give up your own claim, with a comment saying why
# The assignee is the claim: no `taking #N` and no `FINAL` comment. For a PR the first assignee is the reviewer ("first assignee reviews").
# Claim: read the assignees; anyone else assigned: refuse (exit 1). Else assign yourself (and `status:claimed` on an issue), read the
# assignees again, and if someone else appeared meanwhile, the assignment event that is later (timeline `assigned`, then event id) backs
# off: it unassigns only itself. Another person's assignment or label is never removed. Exit 0 claimed (or already yours), 1 refused or
# lost, 2 usage or a `gh` failure (rate limit, no access): then check `gh issue view N` and run --release if you hold a claim you do not want.
# Uses `gh api` with `--jq` (no jq needed), no shell on user text, bash (Git Bash on Windows). Reads and writes only issue N.
usage() { echo "usage: scripts/claim.sh <issue or PR number> | scripts/claim.sh --release <N> [reason]" >&2; exit 2; }
release=0
if [ "$1" = "--release" ]; then release=1; shift; fi
n=$1
case $n in ''|*[!0-9]*) usage;; esac
[ "$release" = 0 ] && [ $# -ne 1 ] && usage
shift
reason=$*
LABEL=status:claimed
API="repos/{owner}/{repo}/issues/$n"
die() { echo "claim.sh: $*" >&2; exit 2; }
me=$(gh api user --jq .login) && [ -n "$me" ] || die "cannot read your GitHub login (gh signed in?)"
case $me in *[!A-Za-z0-9-]*) die "unexpected login";; esac
# kind on line 1 (pr or issue), then the assignees on line 2
read_item() {
  local out
  out=$(gh api "$API" --jq '(if .pull_request then "pr" else "issue" end), (.assignees | map(.login) | join(" "))') || return 1
  kind=$(printf '%s\n' "$out" | sed -n 1p); assignees=$(printf '%s\n' "$out" | sed -n 2p)
  [ -n "$kind" ]
}
others() { local a o=""; for a in $assignees; do [ "$a" != "$me" ] && o="$o $a"; done; echo "${o# }"; }
unassign_me() { gh api -X DELETE "$API/assignees" -f "assignees[]=$me" >/dev/null; }

read_item || die "cannot read #$n (no access, rate limit, or no such issue)"

if [ "$release" = 1 ]; then
  case " $assignees " in *" $me "*) ;; *) echo "claim.sh: #$n is not assigned to $me; nothing released (someone else's claim is never removed)." >&2; exit 1;; esac
  unassign_me || die "could not unassign you from #$n"
  read_item || die "released, but cannot re-read #$n"
  if [ "$kind" = issue ] && [ -z "$assignees" ]; then
    gh api -X DELETE "$API/labels/status%3Aclaimed" >/dev/null 2>&1 || true
  fi
  gh api -X POST "$API/comments" -f "body=Released my claim ($me)${reason:+: $reason}." >/dev/null || die "released, but the comment failed"
  echo "released #$n"; exit 0
fi

o=$(others)
if [ -n "$o" ]; then echo "claim.sh: #$n is already claimed by $o." >&2; exit 1; fi
case " $assignees " in *" $me "*) echo "#$n is already yours."; exit 0;; esac

gh api -X POST "$API/assignees" -f "assignees[]=$me" >/dev/null || die "could not assign #$n to you"
read_item || die "assigned, but cannot re-read #$n; check it and run --release if needed"
case " $assignees " in *" $me "*) ;; *) die "assigned, but you are not an assignee now (someone changed it); check #$n";; esac
if [ -n "$(others)" ]; then
  # a concurrent claim: the earliest assignment event among the current assignees wins; if it cannot be read, back off (safe)
  events=$(gh api --paginate "$API/timeline" --jq '.[] | select(.event == "assigned") | "\(.created_at) \(.id) \(.assignee.login)"') || events=""
  winner="" best=""
  for a in $assignees; do
    last=$(printf '%s\n' "$events" | awk -v a="$a" '$3 == a' | sort -k1,1 -k2,2n | tail -n 1)
    [ -z "$last" ] && continue
    key=$(printf '%s\n' "$last" | awk '{printf "%s %020d", $1, $2}')
    if [ -z "$best" ] || [[ "$key" < "$best" ]]; then best=$key; winner=$a; fi
  done
  if [ "$winner" != "$me" ]; then
    unassign_me || die "lost the race on #$n but could not unassign you: run scripts/claim.sh --release $n"
    echo "claim.sh: #$n went to ${winner:-$(others)} first; you are unassigned. Pick another." >&2; exit 1
  fi
fi
if [ "$kind" = issue ]; then
  gh api -X POST "$API/labels" -f "labels[]=$LABEL" >/dev/null || die "assigned, but adding $LABEL failed"
fi
echo "claimed #$n ($kind) as $me"
