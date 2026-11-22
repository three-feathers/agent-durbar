# scripts/pr-gate-answered.awk (spec 021 FR-097, issue #1910): drops from pr-gate.sh's "unanswered" list what the same trusted reviewer answered
# by approving later. Usage: awk -f scripts/pr-gate-answered.awk <reviews.tsv> <asks>   (the asks on stdin as "-")
#   reviews.tsv: "login<TAB>time<TAB>STATE", one line per non-COMMENTED, non-PENDING review of a trusted human account, sorted by login then time.
#   asks: pr-gate.sh's "newer" lines: "<time> comment <login>: ...", "<time> review(STATE) <login>: ...", "<time> line <login> <path>: ...".
# An ask by R is dropped only when R's LATEST review is APPROVED and that approval is later than the ask (ISO times compare as text). A later
# CHANGES_REQUESTED or DISMISSED review makes R's latest state not APPROVED, so nothing of R is dropped; a later comment by R is newer than the
# approval, so it stays. Another login's approval never matches. Authors with no row (outsiders, bots) are never dropped.
FNR == NR { split($0, f, "\t"); last[f[1]] = f[3]; at[f[1]] = f[2]; next }
{ who = $3; sub(/:$/, "", who); if (who in last && last[who] == "APPROVED" && $1 < at[who]) next; print }
