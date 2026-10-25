#!/usr/bin/env bash
# Weekly test audit (spec 021 FR-058). Linux-only ops tool for the owner's VPS; a systemd user timer runs it on Fridays
# (templates and install steps: docs/agent-setup/README.md, "Weekly test audit").
#
#   scripts/weekly-test-audit.sh            dry run (the default by hand): prints what it would file, files nothing
#   scripts/weekly-test-audit.sh --file     files at most 5 new issues (the timer passes this)
#   options: --model <alias> (default sonnet), --timeout <seconds> (default 2700), --repo-dir <checkout> (default: this script's repo)
#   env:     DURBAR_AUDIT_GH_TOKEN_FILE   a 0600 file with a fine-grained token (Issues read and write on this repo only);
#                                         needed for --file, optional for a dry run (it then also checks duplicates)
#            DURBAR_AUDIT_REPO            owner/name (default three-feathers/agent-durbar)
#
# It makes a fresh detached worktree of origin/main in a temp folder (removed on exit), runs `npm ci` and one tsc there, copies the
# compiled validator, mutation helper and prompt to a private folder Claude cannot write, runs `claude -p` boxed in (argv from
# scripts/weekly-test-audit.ts: no MCP, no settings, no network or edit tools, Bash only for the helper, no token variables), then
# validates Claude's JSON and, with --file, files the issues itself. It never prints the token or the environment.
set -euo pipefail

mode=dry-run
model=sonnet
limit=2700
repo_dir=""
while [ $# -gt 0 ]; do
  case "$1" in
    --file) mode=file ;;
    --dry-run) mode=dry-run ;;
    --model) model="${2:?--model needs a value}"; shift ;;
    --timeout) limit="${2:?--timeout needs a value}"; shift ;;
    --repo-dir) repo_dir="${2:?--repo-dir needs a value}"; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "weekly-test-audit: unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
case "$limit" in ''|*[!0-9]*) echo "weekly-test-audit: --timeout must be a number of seconds" >&2; exit 2 ;; esac

if [ -z "$repo_dir" ]; then repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; fi
repo="${DURBAR_AUDIT_REPO:-three-feathers/agent-durbar}"
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/durbar-weekly-audit"
mkdir -p "$state_dir"
chmod 700 "$state_dir"

# one run at a time
exec 9>"$state_dir/lock"
if ! flock -n 9; then echo "weekly-test-audit: another run holds the lock; nothing to do"; exit 0; fi

umask 077
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
log="$state_dir/audit-$stamp.log"
find "$state_dir" -maxdepth 1 -name 'audit-*.log' -mtime +90 -delete 2>/dev/null || true
say() { printf '%s\n' "$*" | tee -a "$log"; }

work="$(mktemp -d "${TMPDIR:-/tmp}/durbar-weekly-audit.XXXXXX")"
wt="$work/wt"
priv="$work/priv"
cleanup() {
  cd /
  git -C "$repo_dir" worktree remove --force "$wt" >/dev/null 2>&1 || true
  rm -rf "$work"
  git -C "$repo_dir" worktree prune >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM

say "weekly test audit $stamp: mode $mode, model $model, limit ${limit}s, repo $repo"
git -C "$repo_dir" fetch --quiet origin main
git -C "$repo_dir" worktree add --quiet --detach "$wt" origin/main
sha="$(git -C "$wt" rev-parse HEAD)"
say "main at $sha"

cd "$wt"
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --no-audit --no-fund --loglevel=error >"$work/npm.log" 2>&1 || { say "npm ci failed (see below)"; tail -n 20 "$work/npm.log" | tee -a "$log"; exit 1; }
node node_modules/typescript/bin/tsc -p tsconfig.scripts.json

# the judge and the helper run from a copy Claude cannot change
mkdir -p "$priv"
cp -a dist-scripts "$priv/dist"
cp scripts/weekly-test-audit.prompt.md "$priv/prompt.md"
chmod -R go-rwx "$priv"
audit="$priv/dist/scripts/weekly-test-audit.js"
mutate="$priv/dist/scripts/weekly-test-audit-mutate.js"

node "$audit" prompt --template "$priv/prompt.md" --mutate "$mutate" --sha "$sha" >"$priv/prompt.txt"
args=()
while IFS= read -r -d '' a; do args+=("$a"); done < <(node "$audit" claude-argv --model "$model" --mutate "$mutate")

say "running claude (one session on the owner's plan)"
status=0
DURBAR_AUDIT_WORKTREE="$wt" timeout --kill-after=60 "$limit" \
  env -u GH_TOKEN -u GITHUB_TOKEN -u GH_ENTERPRISE_TOKEN -u DURBAR_AUDIT_GH_TOKEN_FILE \
  claude "${args[@]}" <"$priv/prompt.txt" >"$priv/out.txt" 2>"$priv/err.txt" || status=$?
if [ "$status" -ne 0 ]; then
  say "claude exited with $status (124 = time limit); nothing filed. Last lines of its stderr, masked:"
  tail -n 20 "$priv/err.txt" | node -e 'const { redact } = require(process.argv[1]); let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => process.stdout.write(redact(s)));' "$priv/dist/src/shared/redact.js" | tee -a "$log"
  exit 1
fi

run_args=(run --input "$priv/out.txt" --repo "$repo" --log "$log")
if [ "$mode" = file ]; then run_args+=(--file); fi
node "$audit" "${run_args[@]}"
