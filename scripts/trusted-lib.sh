# shellcheck shell=bash
# scripts/trusted-lib.sh: sourced by scripts/pr-gate.sh and scripts/gh-trusted.sh (AGENTS.md, "Untrusted content and prompt
# injection"; spec 021 FR-060). Defines jq (gojq, as `gh --jq` runs it) helpers that show a comment's text only when its author
# AND its latest editor are in scripts/trusted-authors.txt; any other text becomes "outside comment ...: not shown, for a human: <url>".
#   TRUST_RE   the logins as one anchored alternation, escaped for a jq string literal
#   JQ_TRUST   jq defs: `who` (GraphQL actor -> login, "[bot]" added for a Bot), `trusted` (login -> bool),
#              `edited_outside` (url -> bool, from EDITED_URLS), `shown_body` (REST comment -> text or the hidden line)
# EDITED_URLS: newline-separated URLs of comments whose latest edit was by an untrusted account; set it, then call trust_defs again.
_trusted_here=$(dirname "${BASH_SOURCE[0]}")
# only plain logins pass (letters, digits, dashes, an optional [bot]); [ and ] are escaped twice: once for the jq string, once for the regex
TRUST_RE=$(grep -v '^[[:space:]]*#' "$_trusted_here/trusted-authors.txt" | tr -d '\r' | grep -E '^[A-Za-z0-9-]+(\[bot\])?$' | sed 's/\[/\\\\[/; s/\]/\\\\]/' | paste -sd'|' -)
[ -n "$TRUST_RE" ] || { echo "trusted-lib: no trusted authors read from $_trusted_here/trusted-authors.txt" >&2; return 2 2>/dev/null || exit 2; }
trust_defs() {
# the edited list becomes a jq array literal; a URL with any character outside this set is dropped (GitHub's own links never have one)
_edited_json=$(printf '%s\n' "${EDITED_URLS:-}" | grep -E '^https://github\.com/[A-Za-z0-9._/#-]+$' | sed 's/.*/"&"/' | paste -sd, -)
JQ_TRUST="def who: if . == null then \"ghost\" elif .__typename == \"Bot\" then .login + \"[bot]\" else .login end;
def trusted: (. // \"\") | test(\"^($TRUST_RE)\$\");
def edited_outside: . as \$u | any([$_edited_json][]; . == \$u);
def shown_body: if (.user.login | trusted) and ((.html_url // \"\") | edited_outside | not) then ((.body // \"\")[0:160] | gsub(\"\\n\"; \" \")) else \"outside comment by \(.user.login): not shown, for a human: \(.html_url)\" end;
"
}
trust_defs
