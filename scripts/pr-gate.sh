#!/bin/bash
# scripts/pr-gate.sh <PR> [--wait]: may this PR be merged? (AGENTS.md, "Read every review and comment before a merge"). Prints the
# verdict and exits 0 (ready) or 1 (not yet: why, and the unanswered comments). It never merges. Needs `gh` (signed in) and bash.
# --wait: first wait until no check is pending, still none after 90 s.
# Waits until no check is pending, still none after 90 s (later workflows register their checks after the first ones end).
# Blocks (prints why, exits 1) on:
#   - a check that is not pass/skipping, or CodeQL not passed;
#   - an open code-scanning alert on the PR's merge ref or head ref (a bot line comment can be carried forward after its alert is fixed);
#   - a reviewer whose latest review is CHANGES_REQUESTED;
#   - an unresolved, non-outdated review thread;
#   - a comment by someone else (PR comment, review body or line comment) newer than my own latest comment on the PR: read and answer it first.
p=$1; R=$(gh repo view --json nameWithOwner -q .nameWithOwner); OWNER=${R%%/*}; NAME=${R##*/}; ME=$(gh api user -q .login)
[ -n "$p" ] || { echo "usage: scripts/pr-gate.sh <PR number> [--wait]"; exit 2; }
pend() { gh pr checks $p 2>/dev/null | awk -F'\t' '$2=="pending"' | grep -q .; }
while [ "$2" = "--wait" ]; do
  until gh pr checks $p >/dev/null 2>&1 && ! pend; do sleep 30; done
  sleep 90
  pend || break
done
bad=$(gh pr checks $p | awk -F'\t' '$2!="pass" && $2!="skipping"{print $1"="$2}' | tr '\n' ' ')
codeql=$(gh pr checks $p | awk -F'\t' '$1=="CodeQL"{print $2}')
alerts=$(( $(gh api "repos/$R/code-scanning/alerts?ref=refs/pull/$p/merge&state=open" --jq length) + $(gh api "repos/$R/code-scanning/alerts?ref=refs/pull/$p/head&state=open" --jq length) ))
changes=$(gh api repos/$R/pulls/$p/reviews --jq "[group_by(.user.login)[]|max_by(.submitted_at)|select(.state==\"CHANGES_REQUESTED\" and .user.login!=\"$ME\")|.user.login]|join(\",\")")
threads=$(gh api graphql -f query="query{repository(owner:\"$OWNER\",name:\"$NAME\"){pullRequest(number:$p){reviewThreads(first:100){nodes{isResolved isOutdated comments(first:1){nodes{author{login}}}}}}}}" --jq '[.data.repository.pullRequest.reviewThreads.nodes[]|select(.isResolved==false and .isOutdated==false and (.comments.nodes[0].author.login|test("\\[bot\\]$")|not))]|length')
mine=$( { gh api repos/$R/issues/$p/comments --jq ".[]|select(.user.login==\"$ME\")|.created_at"; gh api repos/$R/pulls/$p/reviews --jq ".[]|select(.user.login==\"$ME\")|.submitted_at"; gh api repos/$R/pulls/$p/comments --jq ".[]|select(.user.login==\"$ME\")|.created_at"; } | sort | tail -1)
newer=$( { gh api repos/$R/issues/$p/comments --jq ".[]|select(.user.login!=\"$ME\" and (.user.login|test(\"\\\\[bot\\\\]\$\")|not))|\"\(.created_at) comment \(.user.login): \(.body[0:160]|gsub(\"\\n\";\" \"))\""; gh api repos/$R/pulls/$p/reviews --jq ".[]|select(.user.login!=\"$ME\" and .body!=\"\")|\"\(.submitted_at) review(\(.state)) \(.user.login): \(.body[0:160]|gsub(\"\\n\";\" \"))\""; gh api repos/$R/pulls/$p/comments --jq ".[]|select(.user.login!=\"$ME\" and (.user.login|test(\"\\\\[bot\\\\]\$\")|not))|\"\(.created_at) line \(.user.login) \(.path): \(.body[0:160]|gsub(\"\\n\";\" \"))\""; } | sort | awk -v m="$mine" '$1>m')
if [ -n "$bad" ] || [ "$codeql" != "pass" ] || [ "$alerts" != "0" ] || [ -n "$changes" ] || [ "$threads" != "0" ] || [ -n "$newer" ]; then
  echo "#$p not ready: checks=[$bad] codeql=$codeql alerts=$alerts changes_requested=[$changes] open_threads=$threads"
  [ -n "$newer" ] && { echo "unanswered human comments (read, answer or fix, then rerun):"; echo "$newer"; }
  exit 1
fi
echo "#$p ready to merge: checks green, CodeQL passed, no open alerts, no requested changes, no open threads, no unanswered comments"
