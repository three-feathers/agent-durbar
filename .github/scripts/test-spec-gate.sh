#!/usr/bin/env bash
# Tests for spec-gate.sh using throwaway git repositories (no network, no secrets). Linux/macOS/git-bash; needs git, jq, perl.
# Run: bash .github/scripts/test-spec-gate.sh
set -uo pipefail
unset GITHUB_STEP_SUMMARY
GATE="$(cd "$(dirname "$0")" && pwd)/spec-gate.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
pass=0; failn=0

mkrepo() { # builds repo with main containing specs/003-x complete and specs/012-y incomplete
  rm -rf "$TMP/r"; mkdir -p "$TMP/r"; cd "$TMP/r"
  git init -q -b main; git config user.email t@t; git config user.name t
  mkdir -p src specs/003-x specs/012-y docs
  echo a > src/a.ts; for f in spec plan tasks; do echo x > specs/003-x/$f.md; done; echo x > specs/012-y/spec.md; echo d > docs/d.md
  git add -A; git commit -qm base; BASE="$(git rev-parse HEAD)"
}
# case NAME EXPECT(0|1) EXPECT_TEXT  -- environment is set by the caller; the change is made by function $MUTATE
run_case() {
  local name="$1" want="$2" text="$3"
  mkrepo; git checkout -q -b work; "$MUTATE"; git add -A; git commit -qm change; HEAD_SHA_V="$(git rev-parse HEAD)"
  out="$(BASE_SHA="$BASE" HEAD_SHA="$HEAD_SHA_V" bash "$GATE" 2>&1)"; got=$?
  if [ "$got" = "$want" ] && printf '%s' "$out" | grep -Fq -- "$text"; then pass=$((pass+1)); echo "ok   $name"
  else failn=$((failn+1)); echo "FAIL $name (exit $got, wanted $want, text '$text')"; printf '%s\n' "$out" | sed 's/^/     | /'; fi
}
src_only()    { echo b >> src/a.ts; }
src_spec3()   { echo b >> src/a.ts; echo t >> specs/003-x/tasks.md; }
src_spec_other(){ echo b >> src/a.ts; echo t >> specs/012-y/spec.md; }
src_spec12()  { echo b >> src/a.ts; echo t >> specs/012-y/spec.md; }
docs_only()   { echo b >> docs/d.md; }
src_nofolder(){ echo b >> src/a.ts; mkdir -p specs/099-z; echo s > specs/099-z/spec.md; }

export HEAD_REF PR_AUTHOR_LOGIN PR_AUTHOR_TYPE PR_BODY PR_LABELS_JSON
reset_env() { HEAD_REF="003-fix"; PR_AUTHOR_LOGIN="alice"; PR_AUTHOR_TYPE="User"; PR_BODY=""; PR_LABELS_JSON="[]"; }

reset_env; MUTATE=src_spec3;  run_case "src + own spec folder passes" 0 "Spec Kit gate: passed"
reset_env; MUTATE=src_only;   run_case "src without specs fails" 1 "changes src/ but not specs/"
reset_env; MUTATE=src_spec_other; HEAD_REF=003-fix; run_case "src + other spec folder fails" 1 "nothing in specs/003-x/"
reset_env; MUTATE=src_spec12; HEAD_REF=012-adapters; run_case "folder missing plan/tasks fails" 1 "specs/012-y/plan.md is missing"
reset_env; MUTATE=src_nofolder; HEAD_REF=005-nothing; run_case "no spec folder for the number fails" 1 "No folder specs/005-"
reset_env; MUTATE=docs_only;  HEAD_REF=003-docs; run_case "docs only, good branch passes" 0 "not needed"
reset_env; MUTATE=docs_only;  HEAD_REF=fix-stuff; run_case "bad branch name fails" 1 "is not NNN-slug"
reset_env; MUTATE=docs_only;  HEAD_REF=Feature_X; run_case "bad branch (case/underscore) fails" 1 "is not NNN-slug"
reset_env; MUTATE=docs_only;  HEAD_REF=dependabot/npm_and_yarn/x; PR_AUTHOR_LOGIN="dependabot[bot]"; PR_AUTHOR_TYPE=Bot; run_case "dependabot branch only warns" 0 "WARNING"
reset_env; MUTATE=docs_only;  HEAD_REF=copilot/fix-1; PR_AUTHOR_LOGIN="Copilot"; PR_AUTHOR_TYPE=Bot; run_case "agent bot branch must conform" 1 "is not NNN-slug"
reset_env; MUTATE=src_only;   PR_BODY=$'Spec-Exempt: dependency bump only'; run_case "Spec-Exempt line passes" 0 "spec check skipped"
reset_env; MUTATE=src_only;   PR_BODY=$'<!--\nSpec-Exempt: <reason>\n-->'; run_case "commented template hint does not exempt" 1 "changes src/ but not specs/"
reset_env; MUTATE=src_only;   PR_LABELS_JSON='["spec-exempt"]'; run_case "spec-exempt label passes" 0 "spec check skipped"
reset_env; MUTATE=src_only;   PR_LABELS_JSON='["spec-exempt"]'; HEAD_REF=chore-x; run_case "exempt PR with odd branch only warns" 0 "not enforced here"
reset_env; MUTATE=src_only;   HEAD_REF=""; run_case "no branch info: spec presence rule still applies" 1 "changes src/ but not specs/"
reset_env; MUTATE=src_spec12; HEAD_REF=""; run_case "no branch info + specs change passes" 0 "branch has no spec number"

echo; echo "passed $pass, failed $failn"; [ "$failn" -eq 0 ]
