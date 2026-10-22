#!/usr/bin/env bash
# Tests for docs-check.sh using throwaway git repositories (no network, no secrets). Needs git, jq, perl.
# Run: bash .github/scripts/test-docs-check.sh
set -uo pipefail
unset GITHUB_STEP_SUMMARY
CHECK="$(cd "$(dirname "$0")" && pwd)/docs-check.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
pass=0; failn=0

mkrepo() {
  rm -rf "$TMP/r"; mkdir -p "$TMP/r"; cd "$TMP/r"
  git init -q -b main; git config user.email t@t; git config user.name t
  mkdir -p src docs specs/003-x changelog.d
  echo a > src/a.ts; echo r > README.md; echo d > docs/d.md; printf '# Changelog\n\n## Unreleased\n\n## v1 (x)\n\n- old\n' > CHANGELOG.md; echo t > specs/003-x/tasks.md
  echo '# about' > changelog.d/README.md; echo '| row |' > specs/README.md; echo '# s' > specs/003-x/spec.md
  printf '{\n  "name": "x",\n  "version": "1.0.0",\n  "scripts": {\n    "build": "tsc",\n    "test": "node t.js"\n  }\n}\n' > package.json
  git add -A; git commit -qm base; BASE="$(git rev-parse HEAD)"
}
# run_case NAME EXPECT_WARNING(1|0) -- change is made by $MUTATE; PR_BODY / PR_LABELS_JSON by the caller. Exit code must always be 0.
run_case() {
  local name="$1" want="$2"
  mkrepo; git checkout -q -b work; "$MUTATE"; git add -A; git commit -qm change; local head; head="$(git rev-parse HEAD)"
  out="$(BASE_SHA="$BASE" HEAD_SHA="$head" bash "$CHECK" 2>&1)"; got=$?
  local warned=0; printf '%s' "$out" | grep -Fq '::warning title=Docs check::' && warned=1
  if [ "$got" = 0 ] && [ "$warned" = "$want" ]; then pass=$((pass+1)); echo "ok   $name"
  else failn=$((failn+1)); echo "FAIL $name (exit $got, warned $warned, wanted warning=$want)"; printf '%s\n' "$out" | sed 's/^/     | /'; fi
}
src_only()      { echo b >> src/a.ts; }
src_readme()    { echo b >> src/a.ts; echo n >> README.md; }
src_docs()      { echo b >> src/a.ts; echo n >> docs/d.md; }
src_changelog() { echo b >> src/a.ts; echo '- n' >> CHANGELOG.md; }
src_fragment()  { echo b >> src/a.ts; echo '- n' > changelog.d/003-x.md; }
release_cl()    { printf '# Changelog\n\n## Unreleased\n\n## v2 (y)\n\n- new\n\n## v1 (x)\n\n- old\n' > CHANGELOG.md; }
cl_prose()      { echo 'More intro words.' >> CHANGELOG.md; }
index_row()     { echo '| [003](003-x/spec.md) | X | built |' >> specs/README.md; echo 'status: built' >> specs/003-x/spec.md; }
index_text()    { echo 'More hand-written intro.' >> specs/README.md; }
src_tasks_only(){ echo b >> src/a.ts; echo n >> specs/003-x/tasks.md; }
docs_only()     { echo n >> docs/d.md; }
add_script()    { sed -i 's|"test": "node t.js"|"test": "node t.js",\n    "lint": "eslint ."|' package.json; }
add_script_readme() { add_script; echo n >> README.md; }
bump_version()  { sed -i 's|"version": "1.0.0"|"version": "1.0.1"|' package.json; }
dep_only()      { sed -i 's|"scripts": {|"dependencies": {"y": "1.0.0"},\n  "scripts": {|' package.json; }

export PR_BODY PR_LABELS_JSON
reset_env() { PR_BODY=""; PR_LABELS_JSON="[]"; }

reset_env; MUTATE=src_only;      run_case "src only warns" 1
reset_env; MUTATE=src_readme;    run_case "src + README passes" 0
reset_env; MUTATE=src_docs;      run_case "src + docs/ passes" 0
reset_env; MUTATE=src_changelog; run_case "src + a new CHANGELOG bullet warns (use a fragment)" 1
reset_env; MUTATE=src_fragment;  run_case "src + changelog.d fragment passes" 0
reset_env; MUTATE=release_cl;    run_case "a release (new ## v heading) may add CHANGELOG bullets" 0
reset_env; MUTATE=cl_prose;      run_case "CHANGELOG prose without a bullet does not warn" 0
reset_env; MUTATE=index_row;     run_case "a spec row added to specs/README.md warns (rows are generated)" 1
reset_env; MUTATE=index_text;    run_case "hand-written text in specs/README.md does not warn" 0
reset_env; MUTATE=src_tasks_only; run_case "src + only spec tasks still warns" 1
reset_env; MUTATE=docs_only;     run_case "docs only passes" 0
reset_env; MUTATE=src_only; PR_BODY=$'Fix.\n\nDocs: n/a internal refactor, no visible change'; run_case "Docs: n/a with reason passes" 0
reset_env; MUTATE=src_only; PR_BODY=$'docs: N/A - typo in a comment'; run_case "Docs: n/a is case-insensitive and accepts a dash" 0
reset_env; MUTATE=src_only; PR_BODY=$'Docs: n/a'; run_case "Docs: n/a without a reason still warns" 1
reset_env; MUTATE=src_only; PR_BODY=$'<!--\nDocs: n/a <reason>\n-->'; run_case "commented template hint does not opt out" 1
reset_env; MUTATE=src_only; PR_BODY=$'Docs: n/a <reason>'; run_case "placeholder reason does not opt out" 1
reset_env; MUTATE=src_only; PR_LABELS_JSON='["docs-n/a"]'; run_case "docs-n/a label opts out" 0
reset_env; MUTATE=src_only; PR_LABELS_JSON='["spec-exempt"]'; run_case "spec-exempt label opts out" 0
reset_env; MUTATE=add_script;    run_case "package.json script added without README warns" 1
reset_env; MUTATE=add_script_readme; run_case "package.json script added with README passes" 0
reset_env; MUTATE=bump_version;  run_case "version bump alone does not warn" 0
reset_env; MUTATE=dep_only;      run_case "dependency change alone does not warn" 0
reset_env; MUTATE=add_script; PR_BODY=$'Docs: n/a the script is internal'; run_case "script change with Docs: n/a passes" 0

# never fails, even with no or bad inputs
out="$(BASE_SHA="" HEAD_SHA="" bash "$CHECK" 2>&1)"; got=$?
if [ "$got" = 0 ]; then pass=$((pass+1)); echo "ok   missing SHAs: exit 0"; else failn=$((failn+1)); echo "FAIL missing SHAs exit $got"; fi
out="$(BASE_SHA="deadbeef" HEAD_SHA="cafebabe" bash "$CHECK" 2>&1)"; got=$?
if [ "$got" = 0 ]; then pass=$((pass+1)); echo "ok   unknown SHAs: exit 0"; else failn=$((failn+1)); echo "FAIL unknown SHAs exit $got"; fi

echo; echo "passed $pass, failed $failn"; [ "$failn" -eq 0 ]
