#!/usr/bin/env bash
# Weekly test audit (spec 021 FR-058). Linux-only ops tool for the owner's VPS. Two phases, run as two different unix users by two
# system units (templates and install steps: docs/agent-setup/README.md, "Weekly test audit"):
#
#   scripts/weekly-test-audit.sh [audit] [--state-dir <dir>] [--model sonnet] [--timeout 2700] [--max-budget-usd 5]
#       The audit phase, as the audit user (no token, no gh login, no view of the owner's home). Runs Claude read-only on a fresh
#       worktree of origin/main from its own clone, and writes Claude's answer to <state-dir>/outbox/out.txt. Files nothing.
#   scripts/weekly-test-audit.sh install-filer [--dest ~/.local/lib/durbar-weekly-audit]
#       Run once by the owner, as the filing user, from a reviewed checkout of main: copies the filer (the validator and gh caller)
#       out of the repository, to a folder the audit user cannot write. The filing unit runs that copy:
#       node <dest>/scripts/weekly-test-audit.js run --input <state-dir>/outbox/out.txt [--file]   (a dry run without --file)
#
# env (audit): DURBAR_AUDIT_STATE_DIR (default ~/.local/state/durbar-weekly-audit), DURBAR_AUDIT_REMOTE (default the GitHub repo),
#              CLAUDE_CONFIG_DIR (default <state-dir>/claude: the audit user's own Claude login, never ~/.claude)
set -euo pipefail

cmd=audit
case "${1:-}" in audit|install-filer) cmd="$1"; shift ;; esac

if [ "$cmd" = install-filer ]; then
  dest="$HOME/.local/lib/durbar-weekly-audit"
  while [ $# -gt 0 ]; do
    case "$1" in
      --dest) dest="${2:?--dest needs a value}"; shift ;;
      *) echo "weekly-test-audit: unknown option $1" >&2; exit 2 ;;
    esac
    shift
  done
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  cd "$root"
  if [ -n "$(git status --porcelain -- scripts src)" ]; then echo "weekly-test-audit: scripts/ or src/ has local changes; install from a clean, reviewed checkout of main" >&2; exit 1; fi
  git fetch --quiet origin main
  if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then echo "weekly-test-audit: HEAD is not origin/main; install the filer from reviewed main only" >&2; exit 1; fi
  node node_modules/typescript/bin/tsc -p tsconfig.scripts.json
  install -d -m 755 "$dest/scripts" "$dest/src/shared"
  install -m 644 dist-scripts/scripts/weekly-test-audit.js "$dest/scripts/weekly-test-audit.js"
  install -m 644 dist-scripts/src/shared/redact.js "$dest/src/shared/redact.js"
  install -m 644 scripts/trusted-authors.txt "$dest/scripts/trusted-authors.txt"   # spec 021 FR-060: only the audit's own issues count as filed
  echo "installed the filer from main at $(git rev-parse --short HEAD) to $dest"
  exit 0
fi

state_dir="${DURBAR_AUDIT_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/durbar-weekly-audit}"
model=sonnet
limit=2700
budget=5
while [ $# -gt 0 ]; do
  case "$1" in
    --state-dir) state_dir="${2:?--state-dir needs a value}"; shift ;;
    --model) model="${2:?--model needs a value}"; shift ;;
    --timeout) limit="${2:?--timeout needs a value}"; shift ;;
    --max-budget-usd) budget="${2:?--max-budget-usd needs a value}"; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "weekly-test-audit: unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
case "$limit" in ''|*[!0-9]*) echo "weekly-test-audit: --timeout must be a number of seconds" >&2; exit 2 ;; esac

# The audit phase runs test code that a model changed: it must not hold a token or a gh login (README, "Weekly test audit").
if [ -n "${GH_TOKEN:-}${GITHUB_TOKEN:-}${GH_ENTERPRISE_TOKEN:-}${DURBAR_AUDIT_GH_TOKEN_FILE:-}" ]; then
  echo "weekly-test-audit: a token variable is set; the audit phase runs without one (the filing unit holds it)" >&2; exit 2
fi
if [ -e "$HOME/.config/gh/hosts.yml" ]; then
  echo "weekly-test-audit: this user has a gh login ($HOME/.config/gh); run the audit phase as its own unix user (README)" >&2; exit 2
fi

umask 077
mkdir -p "$state_dir" "$state_dir/outbox" "$state_dir/logs"
chmod 755 "$state_dir" "$state_dir/outbox"
claude_config="${CLAUDE_CONFIG_DIR:-$state_dir/claude}"
# the Claude login folder holds a plan credential: created 0700, refused when wider
if [ -e "$claude_config" ] || [ -L "$claude_config" ]; then
  if [ -L "$claude_config" ] || [ ! -d "$claude_config" ]; then echo "weekly-test-audit: $claude_config is not a folder" >&2; exit 2; fi
  # GNU stat (Linux) first, BSD stat (macOS) as the fallback
  case "$(stat -c %a "$claude_config" 2>/dev/null || stat -f %Lp "$claude_config")" in
    700|500) ;;
    *) echo "weekly-test-audit: $claude_config is wider than 0700; run: chmod 700 $claude_config" >&2; exit 2 ;;
  esac
else
  install -d -m 700 "$claude_config"
fi
remote="${DURBAR_AUDIT_REMOTE:-https://github.com/three-feathers/agent-durbar.git}"
repo_dir="$state_dir/repo"

# one run at a time
# flock where it exists (Linux); macOS has none, so there a mkdir lock (atomic) that the EXIT trap removes, only when this run made it.
own_lock=0
release_lock() { if [ "$own_lock" = 1 ]; then rmdir "$state_dir/lock.d" 2>/dev/null || true; own_lock=0; fi; }
if command -v flock >/dev/null 2>&1; then
  exec 9>"$state_dir/lock"
  if ! flock -n 9; then echo "weekly-test-audit: another run holds the lock; nothing to do"; exit 0; fi
else
  if ! mkdir "$state_dir/lock.d" 2>/dev/null; then echo "weekly-test-audit: another run holds the lock; nothing to do"; exit 0; fi
  own_lock=1
  trap release_lock EXIT
  trap 'exit 130' INT TERM
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
log="$state_dir/logs/audit-$stamp.log"
find "$state_dir/logs" -maxdepth 1 -name 'audit-*.log' -mtime +90 -delete 2>/dev/null || true
say() { printf '%s\n' "$*" | tee -a "$log"; }

work="$(mktemp -d "${TMPDIR:-/tmp}/durbar-weekly-audit.XXXXXX")"
wt="$work/wt"
priv="$work/priv"
cleanup() {
  cd /
  git -C "$repo_dir" worktree remove --force "$wt" >/dev/null 2>&1 || true
  rm -rf "$work"
  git -C "$repo_dir" worktree prune >/dev/null 2>&1 || true
  release_lock
}
trap cleanup EXIT
trap 'exit 130' INT TERM

say "weekly test audit $stamp: model $model, limit ${limit}s, budget \$$budget"
# the audit's own clone, never the owner's checkout
if [ ! -d "$repo_dir/.git" ]; then git clone --quiet "$remote" "$repo_dir"; fi
git -C "$repo_dir" fetch --quiet origin main
git -C "$repo_dir" worktree add --quiet --detach "$wt" origin/main
sha="$(git -C "$wt" rev-parse HEAD)"
say "main at $sha"

cd "$wt"
npm_config_cache="$state_dir/npm" ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --no-audit --no-fund --loglevel=error >"$work/npm.log" 2>&1 || { say "npm ci failed (see below)"; tail -n 20 "$work/npm.log" | tee -a "$log"; exit 1; }
node node_modules/typescript/bin/tsc -p tsconfig.scripts.json

# The helper and the prompt run from a copy outside the worktree, so a mutation cannot change them by accident. It is not a security
# boundary: test code run by the helper can write anything this user can (the boundary is the unix user).
mkdir -p "$priv"
cp -a dist-scripts "$priv/dist"
cp scripts/weekly-test-audit.prompt.md "$priv/prompt.md"
audit="$priv/dist/scripts/weekly-test-audit.js"
mutate="$priv/dist/scripts/weekly-test-audit-mutate.js"
node "$audit" prompt --template "$priv/prompt.md" --mutate "$mutate" --sha "$sha" >"$priv/prompt.txt"

say "running claude (one session on the owner's plan)"
status=0
node "$audit" launch --worktree "$wt" --claude-config "$claude_config" --mutate "$mutate" --model "$model" --timeout "$limit" \
  --max-budget-usd "$budget" --prompt "$priv/prompt.txt" --out "$priv/out.txt" --err "$priv/err.txt" | tee -a "$log" || status=$?
if [ "$status" -ne 0 ]; then
  say "claude did not finish (exit $status, 124 = time limit); no answer written. Last lines of its stderr, masked:"
  tail -n 20 "$priv/err.txt" | node -e 'const { redact } = require(process.argv[1]); let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => process.stdout.write(redact(s)));' "$priv/dist/src/shared/redact.js" | tee -a "$log"
  exit 1
fi

# the answer for the filing unit: readable by it, written whole (rename); then a dry-run check here, so a bad answer stops the chain
install -m 644 "$priv/out.txt" "$state_dir/outbox/out.txt.tmp"
mv -f "$state_dir/outbox/out.txt.tmp" "$state_dir/outbox/out.txt"
printf '%s\n' "$sha" >"$state_dir/outbox/sha.tmp"
chmod 644 "$state_dir/outbox/sha.tmp"
mv -f "$state_dir/outbox/sha.tmp" "$state_dir/outbox/sha"
env -i PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 node "$audit" run --input "$state_dir/outbox/out.txt" --log "$log"

# next week's run uses the script of today's main (one line, so bash has read it all before the checkout rewrites this file)
cd / && git -C "$repo_dir" checkout --quiet --force --detach origin/main; exit $?
