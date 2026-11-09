#!/bin/bash
# scripts/pr-gate.sh <PR> [--wait]: may this PR be merged? (AGENTS.md, "Read every review and comment before a merge"). Prints the
# verdict and exits 0 (ready) or 1 (not yet: why, and the unanswered comments). It never merges. Needs `gh` (signed in) and bash.
# --wait: first wait until no check is pending, still none after 90 s.
# Waits until no check is pending, still none after 90 s (later workflows register their checks after the first ones end).
# Blocks (prints why, exits 1) on:
#   - a check that is not pass/skipping, or CodeQL not passed; a CodeQL check GitHub skipped on a PR that changes no analysed file counts as
#     passed only when every changed file is on the no-code list in nocode() and the alerts are 0 (spec 021 FR-089, #1420);
#   - a PR GitHub cannot merge (conflicts): GitHub then runs only CodeQL, so the other checks look absent rather than red;
#   - a PR that changes src/ without the Spec Kit gate and the Linux build-and-test check present and passing;
#   - an open code-scanning alert on the PR's merge ref or head ref (a bot line comment can be carried forward after its alert is fixed);
#   - a reviewer whose latest review is CHANGES_REQUESTED;
#   - an unresolved, non-outdated review thread;
#   - a comment by someone else (PR comment, review body or line comment) newer than my own latest comment on the PR: read and answer it first.
#     Exact status notes (a whole comment that is only `reviewing at <sha>` or `checks run at <sha>: ...` on one line, pattern in
#     scripts/pr-status-note.re) are not counted as asks; they are printed apart under "status notes, not counted as asks:".
#   - an outside PR (from a fork, or opened by an account outside scripts/trusted-authors.txt other than dependabot[bot]): a human decides;
#     An APPROVED review by a trusted account is not an ask: it prints as "approved by: <login> at <sha>" (a later comment or
#     CHANGES_REQUESTED still blocks; an outside approval stays an ask, shown as author and link only).
#   - a comment whose latest edit was made by an outside account.
#   - an owner hold (spec 021 FR-079): the label status:blocked or needs-owner-approval, or a comment, review or line comment by one of the three
#     human owners (the logins of scripts/trusted-authors.txt without "[bot]") saying "on hold", "owner hold", "do not merge" or "don't merge" (any
#     case, whole words only, FR-083; not inside code or a quote, FR-080) with no later owner comment saying "hold lifted" or "off hold" (not "ok to merge": agents approve through the owners' accounts). Prints only the date and link.
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
# owner hold (FR-079): labels, then the owners' latest hold-or-lift comment; only its date and link are printed, never its text
for l in $(gh pr view $p --json labels -q '.labels[].name'); do case $l in status:blocked|needs-owner-approval) bad="$bad owner-hold(label $l: not mergeable until an owner removes it)";; esac; done
OWNERS_RE=$(grep -v '^[[:space:]]*#' "$(dirname "$0")/trusted-authors.txt" | tr -d '\r' | grep -E '^[A-Za-z0-9-]+$' | tr 'A-Z' 'a-z' | paste -sd'|' -)
# FR-083: the phrases match as whole words (\b), so "the condition holds" is no "on hold"
# FR-080: words in a closed fenced block, in a quoted line (starts with ">") or in an inline code span are quotes, not the owner's own words
PROSE='gsub("```(.|\n)*?```";"") | gsub("(^|\n)[ \t]*>[^\n]*";"\n") | gsub("`[^`\n]*`";"")'
HOLD_KIND="select((.user.login // \"\")|ascii_downcase|test(\"^($OWNERS_RE)\$\")) | ((.body // \"\") | $PROSE | if test(\"\\\\b(hold lifted|off hold)\\\\b\";\"i\") then \"lift\" elif test(\"\\\\b(on hold|owner hold|do not merge|don['\u2019]t merge)\\\\b\";\"i\") then \"hold\" else empty end) as \$k"
hold=$( { gh api --paginate repos/$R/issues/$p/comments --jq ".[]|$HOLD_KIND|\"\(.created_at)\t\(.html_url)\t\(\$k)\""; gh api --paginate repos/$R/pulls/$p/reviews --jq ".[]|$HOLD_KIND|\"\(.submitted_at)\t\(.html_url)\t\(\$k)\""; gh api --paginate repos/$R/pulls/$p/comments --jq ".[]|$HOLD_KIND|\"\(.created_at)\t\(.html_url)\t\(\$k)\""; } | sort | tail -1)
case $hold in *"	hold") bad="$bad owner-hold(owner comment of $(echo "$hold" | cut -f1): $(echo "$hold" | cut -f2); read it, wait for a written lift)";; esac
checks_out=$(gh pr checks $p 2>/dev/null)
codeql=$(printf '%s\n' "$checks_out" | awk -F'\t' '$1=="CodeQL"{print $2}')
codeql_ok=; [ "$codeql" = pass ] && codeql_ok=passed; [ -n "$codeql" ] || codeql=missing
# FR-089 (#1420): GitHub reports CodeQL as "skipping" on a PR that changes no file it analyses. Only that literal state counts as passed (a
# missing check may just not have registered yet), and only when every changed file is on this fixed no-code list (the default setup's
# path filter is not readable here); an API error, an empty file list or any other file blocks (fail closed). The alerts must still be 0.
# Dependency files: the root package-lock.json and scripts/<dir>/package-lock.json or package.json only, and only in a Dependabot PR.
nocode() { case $1 in *.md|*.png|*.jpg|*.jpeg|*.gif|*.webp) return 0;; scripts/*/*/*) return 1;; package-lock.json|scripts/*/package-lock.json|scripts/*/package.json) return 0;; esac; return 1; }
# every path the PR touches: added, changed and removed files, and a renamed file's old path too (a rename out of src/ is not a docs change);
# a name with a control character (a newline would split it into two lines) is a "C" line and blocks.
# The files API stops at 3000 files without an error, so the listed count must equal the PR's changed_files and be under 3000.
# Dependency files are not code to CodeQL but run on install: each changed one is read at the head commit and blocks on a `resolved` URL
# outside https://registry.npmjs.org/, a preinstall/install/postinstall/prepare script, a dependency spec with ":" or "/" (git, file, URL),
# or, in a lockfile, a package with an install script (hasInstallScript) that the base commit's copy does not have (a missing or unreadable
# base copy counts as empty); a reviewer still reads the diff (return 2 = a dependency file refused).
INSTALLS='.packages? // {}|to_entries[]|select(.value.hasInstallScript == true)|.key'
DEPCHECK='[..|objects|.resolved? // empty|strings|select(startswith("https://registry.npmjs.org/")|not)] + [(.scripts? // {})|objects|keys[]|select(. == "preinstall" or . == "install" or . == "postinstall" or . == "prepare")] + [(.dependencies?, .devDependencies?, .optionalDependencies?, .peerDependencies?)|objects|.[]|strings|select(test("[:/]"))]|length'
only_nocode() { local f files n pr total sha base author head_i base_i; local -a deps; deps=()
  files=$(gh api --paginate "repos/$R/pulls/$p/files" --jq '.[]|if ([.filename, (.previous_filename // empty)]|any(test("[\\x00-\\x1f\\x7f]"))) then "C" else "F \(.filename)", (.previous_filename // empty|"P \(.)") end') && [ -n "$files" ] || return 1
  n=$(grep -c '^F ' <<< "$files"); pr=$(gh api "repos/$R/pulls/$p" --jq '"\(.changed_files) \(.head.sha) \(.base.sha) \(.user.login)"') || return 1
  read -r total sha base author <<< "$pr"; isnum "$total" && [ "$n" = "$total" ] && [ "$n" -lt 3000 ] || return 1
  while IFS= read -r f; do
    case $f in 'F '*) f=${f#F }; case $f in *package-lock.json|*package.json) deps+=("$f");; esac;; 'P '*) f=${f#P };; *) return 1;; esac
    nocode "$f" || return 1
  done <<< "$files"
  [ ${#deps[@]} = 0 ] && return 0
  [ "$author" = "dependabot[bot]" ] || return 2
  for f in "$sha" "$base"; do case $f in *[!0-9a-f]*|'') return 2;; esac; [ ${#f} = 40 ] || return 2; done
  for f in "${deps[@]}"; do
    case $f in *[!A-Za-z0-9._/-]*|*..*) return 2;; esac
    [ "$(gh api -H 'Accept: application/vnd.github.raw+json' "repos/$R/contents/$f?ref=$sha" --jq "$DEPCHECK")" = 0 ] || return 2
    case $f in *package-lock.json)
      head_i=$(gh api -H 'Accept: application/vnd.github.raw+json' "repos/$R/contents/$f?ref=$sha" --jq "$INSTALLS") || return 2
      base_i=$(gh api -H 'Accept: application/vnd.github.raw+json' "repos/$R/contents/$f?ref=$base" --jq "$INSTALLS" 2>/dev/null) || base_i=
      printf '%s\n' "$head_i" | grep -vxF -f <(printf '%s\n' "$base_i") | grep -q . && return 2;;
    esac
  done
  depnote="; dependency files changed: CodeQL does not read them, a reviewer reads the diff"; }
isnum() { case $1 in ''|*[!0-9]*) return 1;; esac; }
depnote=
if [ -z "$codeql_ok" ] && [ "$codeql" = skipping ] && printf '%s\n' "$checks_out" | grep -q $'\t'; then
  if only_nocode; then codeql_ok="skipped (no analysed files$depnote)"; codeql="skipping(no analysed files$depnote)"
  elif [ $? = 2 ]; then codeql="skipping(dependency files refused: not a Dependabot PR, a non-registry source, an install script or an unreadable file)"
  else codeql="skipping(analysed or unknown files changed)"; fi
fi
# the open alerts on the merge and head refs, read as two numbers; an API error or a non-number blocks
a_merge=$(gh api "repos/$R/code-scanning/alerts?ref=refs/pull/$p/merge&state=open" --jq length) && a_head=$(gh api "repos/$R/code-scanning/alerts?ref=refs/pull/$p/head&state=open" --jq length) && isnum "$a_merge" && isnum "$a_head" && alerts=$((a_merge + a_head)) || alerts="unread(code-scanning API)"
# --paginate everywhere below: the REST lists return 30 items a page, and a long PR has more (spec 021 FR-055). --jq runs per page,
# so the latest review per person is picked in the shell, across pages, not with jq's group_by
changes=$(gh api --paginate repos/$R/pulls/$p/reviews --jq '.[]|select(.state!="COMMENTED" and .state!="PENDING")|"\(.user.login)\t\(.submitted_at)\t\(.state)"' | sort -k1,1 -k2,2 | awk -F'\t' -v me="$ME" '{last[$1]=$3} END{for(u in last) if(last[u]=="CHANGES_REQUESTED" && u!=me) printf "%s%s", (n++?",":""), u}')
threads=$(gh api graphql -f query="query{repository(owner:\"$OWNER\",name:\"$NAME\"){pullRequest(number:$p){reviewThreads(first:100){nodes{isResolved isOutdated comments(first:1){nodes{author{login}}}}}}}}" --jq '[.data.repository.pullRequest.reviewThreads.nodes[]|select(.isResolved==false and .isOutdated==false and (.comments.nodes[0].author.login|test("\\[bot\\]$")|not))]|length')
# comments whose latest edit was by an outside account: their text is hidden below and they block (a human checks the edit)
outside_edits=$(gh api graphql -f query="query{repository(owner:\"$OWNER\",name:\"$NAME\"){pullRequest(number:$p){comments(last:100){nodes{url editor{__typename login}}} reviews(last:100){nodes{url editor{__typename login}}} reviewThreads(last:100){nodes{comments(last:100){nodes{url editor{__typename login}}}}}}}}" --jq "$JQ_TRUST .data.repository.pullRequest|(.comments.nodes[], .reviews.nodes[], .reviewThreads.nodes[].comments.nodes[])|select(.editor != null and (.editor|who|trusted|not))|\"\(.url) edited by \(.editor|who)\"")
EDITED_URLS=$(printf '%s\n' "$outside_edits" | awk '{print $1}'); trust_defs
# status notes (docs/rules/review-rounds.md, Test once): exact "reviewing at <sha>" / "checks run at <sha>: ..." comments are not asks and not answers
NOTE_RE=$(sed 's/\\/\\\\/g' "$(dirname "$0")/pr-status-note.re")
NOTE="(.body|test(\"$NOTE_RE\"))"
mine=$( { gh api --paginate repos/$R/issues/$p/comments --jq ".[]|select(.user.login==\"$ME\" and ($NOTE|not))|.created_at"; gh api --paginate repos/$R/pulls/$p/reviews --jq ".[]|select(.user.login==\"$ME\")|.submitted_at"; gh api --paginate repos/$R/pulls/$p/comments --jq ".[]|select(.user.login==\"$ME\")|.created_at"; } | sort | tail -1)
newer=$( { gh api --paginate repos/$R/issues/$p/comments --jq "$JQ_TRUST .[]|select(.user.login!=\"$ME\" and (.user.login|test(\"\\\\[bot\\\\]\$\")|not) and (((.user.login|trusted) and $NOTE)|not))|\"\(.created_at) comment \(.user.login): \(shown_body)\""; gh api --paginate repos/$R/pulls/$p/reviews --jq "$JQ_TRUST .[]|select(.user.login!=\"$ME\" and .body!=\"\" and (.state!=\"APPROVED\" or (.user.login|trusted|not)))|\"\(.submitted_at) review(\(.state)) \(.user.login): \(shown_body)\""; gh api --paginate repos/$R/pulls/$p/comments --jq "$JQ_TRUST .[]|select(.user.login!=\"$ME\" and (.user.login|test(\"\\\\[bot\\\\]\$\")|not))|\"\(.created_at) line \(.user.login) \(.path): \(shown_body)\""; } | sort | awk -v m="$mine" '$1>m')
notes=$( { gh api --paginate repos/$R/issues/$p/comments --jq "$JQ_TRUST .[]|select($NOTE and (.user.login|trusted))|\"\(.created_at) \(.user.login): \(.body|gsub(\"^\\\\s+\";\"\")|split(\"\\n\")[0])\""; } | sort)
# approvals (spec 021, 2026-10-29 delta, issue #883): a trusted reviewer's latest review being APPROVED is printed on its own line and its
# body is not an ask. A later comment or change request still counts (it is newer than my last answer, or it is the latest review state).
approvals=$(gh api --paginate repos/$R/pulls/$p/reviews --jq "$JQ_TRUST .[]|select(.state!=\"COMMENTED\" and .state!=\"PENDING\" and (.user.login|trusted))|\"\(.user.login)\t\(.submitted_at)\t\(.state)\t\(.commit_id[0:8])\"" | sort -k1,1 -k2,2 | awk -F'\t' '{last[$1]=$0} END{for(u in last){split(last[u],f,"\t"); if(f[3]=="APPROVED") print "approved by: " f[1] " at " f[4] " (" f[2] ")"}}' | sort)
[ -n "$approvals" ] && echo "$approvals"
[ -n "$notes" ] && { echo "status notes, not counted as asks:"; echo "$notes"; }
if [ -n "$bad" ] || [ -z "$codeql_ok" ] || [ "$alerts" != "0" ] || [ -n "$changes" ] || [ "$threads" != "0" ] || [ -n "$newer" ] || [ -n "$outside_edits" ]; then
  echo "#$p not ready: checks=[$bad] codeql=$codeql alerts=$alerts changes_requested=[$changes] open_threads=$threads"
  [ -n "$newer" ] && { echo "unanswered human comments (read, answer or fix, then rerun; an outside one goes to your human as its link):"; echo "$newer"; }
  [ -n "$outside_edits" ] && { echo "comments last edited by an outside account (not shown, for a human):"; echo "$outside_edits"; }
  exit 1
fi
echo "#$p ready to merge: checks green, CodeQL $codeql_ok, no open alerts, no requested changes, no open threads, no unanswered comments"
