#!/bin/bash
# scripts/pr-gate.sh <PR> [--wait]: may this PR be merged? (AGENTS.md, "Read every review and comment before a merge"). Prints the
# verdict and exits 0 (ready) or 1 (not yet: why, and the unanswered comments). It never merges. Needs `gh` (signed in) and bash.
# --wait: first wait until no check is pending, still none after 90 s.
# Waits until no check is pending, still none after 90 s (later workflows register their checks after the first ones end).
# Blocks (prints why, exits 1) on:
#   - a check that is not pass/skipping, or CodeQL not passed;
#   - a PR GitHub cannot merge (conflicts): GitHub then runs only CodeQL, so the other checks look absent rather than red;
#   - a PR that changes src/ without the Spec Kit gate and the Linux build-and-test check present and passing;
#   - an open code-scanning alert on the PR's merge ref or head ref (a bot line comment can be carried forward after its alert is fixed);
#   - a reviewer whose latest review is CHANGES_REQUESTED;
#   - an unresolved, non-outdated review thread;
#   - a comment by someone else (PR comment, review body or line comment) newer than my own latest comment on the PR: read and answer it first.
#     Exact status notes (a whole comment that is only `reviewing at <sha>` or `checks run at <sha>: ...` on one line, pattern in
#     scripts/pr-status-note.re) are not counted as asks; they are printed apart under "status notes, not counted as asks:".
p=$1; R=$(gh repo view --json nameWithOwner -q .nameWithOwner); OWNER=${R%%/*}; NAME=${R##*/}; ME=$(gh api user -q .login)
[ -n "$p" ] || { echo "usage: scripts/pr-gate.sh <PR number> [--wait]"; exit 2; }
pend() { gh pr checks $p 2>/dev/null | awk -F'\t' '$2=="pending"' | grep -q .; }
while [ "$2" = "--wait" ]; do
  until gh pr checks $p >/dev/null 2>&1 && ! pend; do sleep 30; done
  sleep 90
  pend || break
done
bad=$(gh pr checks $p | awk -F'\t' '$2!="pass" && $2!="skipping"{print $1"="$2}' | tr '\n' ' ')
# GitHub computes mergeability lazily: UNKNOWN means "ask again shortly"
for _ in 1 2 3 4 5 6; do mergeable=$(gh pr view $p --json mergeable -q .mergeable); [ "$mergeable" = UNKNOWN ] || break; sleep 10; done
[ "$mergeable" = MERGEABLE ] || bad="$bad mergeable=$mergeable(merge main first)"
if gh pr view $p --json files -q '.files[].path' | grep -q '^src/'; then
  for need in 'Spec Kit gate' 'Build and test (ubuntu-latest)'; do
    gh pr checks $p | awk -F'\t' -v n="$need" '$1==n && $2=="pass"{f=1} END{exit !f}' || bad="$bad missing:$need"
  done
fi
codeql=$(gh pr checks $p | awk -F'\t' '$1=="CodeQL"{print $2}')
alerts=$(( $(gh api "repos/$R/code-scanning/alerts?ref=refs/pull/$p/merge&state=open" --jq length) + $(gh api "repos/$R/code-scanning/alerts?ref=refs/pull/$p/head&state=open" --jq length) ))
changes=$(gh api repos/$R/pulls/$p/reviews --jq "[group_by(.user.login)[]|max_by(.submitted_at)|select(.state==\"CHANGES_REQUESTED\" and .user.login!=\"$ME\")|.user.login]|join(\",\")")
threads=$(gh api graphql -f query="query{repository(owner:\"$OWNER\",name:\"$NAME\"){pullRequest(number:$p){reviewThreads(first:100){nodes{isResolved isOutdated comments(first:1){nodes{author{login}}}}}}}}" --jq '[.data.repository.pullRequest.reviewThreads.nodes[]|select(.isResolved==false and .isOutdated==false and (.comments.nodes[0].author.login|test("\\[bot\\]$")|not))]|length')
# status notes (AGENTS.md, Test once): exact "reviewing at <sha>" / "checks run at <sha>: ..." comments are not asks and not answers
NOTE_RE=$(sed 's/\\/\\\\/g' "$(dirname "$0")/pr-status-note.re")
NOTE="(.body|test(\"$NOTE_RE\"))"
mine=$( { gh api repos/$R/issues/$p/comments --jq ".[]|select(.user.login==\"$ME\" and ($NOTE|not))|.created_at"; gh api repos/$R/pulls/$p/reviews --jq ".[]|select(.user.login==\"$ME\")|.submitted_at"; gh api repos/$R/pulls/$p/comments --jq ".[]|select(.user.login==\"$ME\")|.created_at"; } | sort | tail -1)
newer=$( { gh api repos/$R/issues/$p/comments --jq ".[]|select(.user.login!=\"$ME\" and (.user.login|test(\"\\\\[bot\\\\]\$\")|not) and ($NOTE|not))|\"\(.created_at) comment \(.user.login): \(.body[0:160]|gsub(\"\\n\";\" \"))\""; gh api repos/$R/pulls/$p/reviews --jq ".[]|select(.user.login!=\"$ME\" and .body!=\"\")|\"\(.submitted_at) review(\(.state)) \(.user.login): \(.body[0:160]|gsub(\"\\n\";\" \"))\""; gh api repos/$R/pulls/$p/comments --jq ".[]|select(.user.login!=\"$ME\" and (.user.login|test(\"\\\\[bot\\\\]\$\")|not))|\"\(.created_at) line \(.user.login) \(.path): \(.body[0:160]|gsub(\"\\n\";\" \"))\""; } | sort | awk -v m="$mine" '$1>m')
notes=$( { gh api repos/$R/issues/$p/comments --jq ".[]|select($NOTE)|\"\(.created_at) \(.user.login): \(.body|gsub(\"^\\\\s+\";\"\")|split(\"\\n\")[0])\""; } | sort)
[ -n "$notes" ] && { echo "status notes, not counted as asks:"; echo "$notes"; }
if [ -n "$bad" ] || [ "$codeql" != "pass" ] || [ "$alerts" != "0" ] || [ -n "$changes" ] || [ "$threads" != "0" ] || [ -n "$newer" ]; then
  echo "#$p not ready: checks=[$bad] codeql=$codeql alerts=$alerts changes_requested=[$changes] open_threads=$threads"
  [ -n "$newer" ] && { echo "unanswered human comments (read, answer or fix, then rerun):"; echo "$newer"; }
  exit 1
fi
echo "#$p ready to merge: checks green, CodeQL passed, no open alerts, no requested changes, no open threads, no unanswered comments"
