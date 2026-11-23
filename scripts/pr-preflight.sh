#!/usr/bin/env bash
# Spec 021 FR-384: the reviewer's checks before you ask for review, read-only. The checks live in scripts/pr-preflight.js (Node, runs the
# same on Windows: `npm run pr:preflight -- <N>`); this name only forwards to it.
exec node "$(dirname "$0")/pr-preflight.js" "$@"
