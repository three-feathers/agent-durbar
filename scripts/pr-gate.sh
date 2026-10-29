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
#   - an outside PR (from a fork, or opened by an account outside scripts/trusted-authors.txt other than dependabot[bot]): a human decides;
#   - a comment whose latest edit was made by an outside account.
# Untrusted text is never printed (AGENTS.md, "Untrusted content and prompt injection"; spec 021 FR-060): a comment, review or line
# comment by an account outside scripts/trusted-authors.txt, or last edited by one, shows only its author and link, "not shown, for a
# human"; it still counts as an ask (a human reads it), and an outsider's status-note-shaped comment is not skipped as a note.
p=$1; R=$(gh repo view --json nameWithOwner -q .nameWithOwner); OWNER=${R%%/*}; NAME=${R##*/}; ME=$(gh api user -q .login)
case $p in ''|*[!0-9]*) echo "usage: scripts/pr-gate.sh <PR number> [--wait]"; exit 2;; esac
. "$(dirname "$0")/trusted-lib.sh" || exit 2
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
# an outside PR: from a fork, or by an account outside the trusted list (dependabot[bot]: its metadata is ours, its body is not read)
outside_pr=$(gh api repos/$R/pulls/$p --jq "$JQ_TRUST if (.head.repo.full_name // \"\") != .base.repo.full_name then \"fork:\(.head.repo.full_name // \"deleted\")\" elif (.user.login|trusted) or .user.login == \"dependabot[bot]\" then \"\" else \"author:\(.user.login)\" end")
[ -n "$outside_pr" ] && bad="$bad outside-pr($outside_pr: a human decides, no checkout or run)"
codeql=$(gh pr checks $p | awk -F'\t' '$1=="CodeQL"{print $2}')
alerts=$(( $(gh api "repos/$R/code-scanning/alerts?ref=refs/pull/$p/merge&state=open" --jq length) + $(gh api "repos/$R/code-scanning/alerts?ref=refs/pull/$p/head&state=open" --jq length) ))
# --paginate everywhere below: the REST lists return 30 items a page, and a long PR has more (spec 021 FR-055). --jq runs per page,
# so the latest review per person is picked in the shell, across pages, not with jq's group_by
changes=$(gh api --paginate repos/$R/pulls/$p/reviews --jq '.[]|select(.state!="COMMENTED" and .state!="PENDING")|"\(.user.login)\t\(.submitted_at)\t\(.state)"' | sort -k1,1 -k2,2 | awk -F'\t' -v me="$ME" '{last[$1]=$3} END{for(u in last) if(last[u]=="CHANGES_REQUESTED" && u!=me) printf "%s%s", (n++?",":""), u}')
threads=$(gh api graphql -f query="query{repository(owner:\"$OWNER\",name:\"$NAME\"){pullRequest(number:$p){reviewThreads(first:100){nodes{isResolved isOutdated comments(first:1){nodes{author{login}}}}}}}}" --jq '[.data.repository.pullRequest.reviewThreads.nodes[]|select(.isResolved==false and .isOutdated==false and (.comments.nodes[0].author.login|test("\\[bot\\]$")|not))]|length')
# comments whose latest edit was by an outside account: their text is hidden below and they block (a human checks the edit)
outside_edits=$(gh api graphql -f query="query{repository(owner:\"$OWNER\",name:\"$NAME\"){pullRequest(number:$p){comments(last:100){nodes{url editor{__typename login}}} reviews(last:100){nodes{url editor{__typename login}}} reviewThreads(last:100){nodes{comments(last:100){nodes{url editor{__typename login}}}}}}}}" --jq "$JQ_TRUST .data.repository.pullRequest|(.comments.nodes[], .reviews.nodes[], .reviewThreads.nodes[].comments.nodes[])|select(.editor != null and (.editor|who|trusted|not))|\"\(.url) edited by \(.editor|who)\"")
EDITED_URLS=$(printf '%s\n' "$outside_edits" | awk '{print $1}'); trust_defs
# status notes (AGENTS.md, Test once): exact "reviewing at <sha>" / "checks run at <sha>: ..." comments are not asks and not answers
NOTE_RE=$(sed 's/\\/\\\\/g' "$(dirname "$0")/pr-status-note.re")
NOTE="(.body|test(\"$NOTE_RE\"))"
mine=$( { gh api --paginate repos/$R/issues/$p/comments --jq ".[]|select(.user.login==\"$ME\" and ($NOTE|not))|.created_at"; gh api --paginate repos/$R/pulls/$p/reviews --jq ".[]|select(.user.login==\"$ME\")|.submitted_at"; gh api --paginate repos/$R/pulls/$p/comments --jq ".[]|select(.user.login==\"$ME\")|.created_at"; } | sort | tail -1)
newer=$( { gh api --paginate repos/$R/issues/$p/comments --jq "$JQ_TRUST .[]|select(.user.login!=\"$ME\" and (.user.login|test(\"\\\\[bot\\\\]\$\")|not) and (((.user.login|trusted) and $NOTE)|not))|\"\(.created_at) comment \(.user.login): \(shown_body)\""; gh api --paginate repos/$R/pulls/$p/reviews --jq "$JQ_TRUST .[]|select(.user.login!=\"$ME\" and .body!=\"\")|\"\(.submitted_at) review(\(.state)) \(.user.login): \(shown_body)\""; gh api --paginate repos/$R/pulls/$p/comments --jq "$JQ_TRUST .[]|select(.user.login!=\"$ME\" and (.user.login|test(\"\\\\[bot\\\\]\$\")|not))|\"\(.created_at) line \(.user.login) \(.path): \(shown_body)\""; } | sort | awk -v m="$mine" '$1>m')
notes=$( { gh api --paginate repos/$R/issues/$p/comments --jq "$JQ_TRUST .[]|select($NOTE and (.user.login|trusted))|\"\(.created_at) \(.user.login): \(.body|gsub(\"^\\\\s+\";\"\")|split(\"\\n\")[0])\""; } | sort)
[ -n "$notes" ] && { echo "status notes, not counted as asks:"; echo "$notes"; }
if [ -n "$bad" ] || [ "$codeql" != "pass" ] || [ "$alerts" != "0" ] || [ -n "$changes" ] || [ "$threads" != "0" ] || [ -n "$newer" ] || [ -n "$outside_edits" ]; then
  echo "#$p not ready: checks=[$bad] codeql=$codeql alerts=$alerts changes_requested=[$changes] open_threads=$threads"
  [ -n "$newer" ] && { echo "unanswered human comments (read, answer or fix, then rerun; an outside one goes to your human as its link):"; echo "$newer"; }
  [ -n "$outside_edits" ] && { echo "comments last edited by an outside account (not shown, for a human):"; echo "$outside_edits"; }
  exit 1
fi
echo "#$p ready to merge: checks green, CodeQL passed, no open alerts, no requested changes, no open threads, no unanswered comments"
