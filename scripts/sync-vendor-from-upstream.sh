#!/usr/bin/env bash
# Copy files from Smarter-Poker/commander-shared main into vendor/commander-shared.
#
#   bash scripts/sync-vendor-from-upstream.sh src/lib/commander/staffSession.js [more paths...]
#   bash scripts/sync-vendor-from-upstream.sh --list      # show what differs
#
# Direction is ALWAYS upstream -> vendor. If your fix is in vendor only, open
# the upstream PR first, merge it, then run this. (CLAUDE.md law 3.5)
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
UP="${UPSTREAM_DIR:-$HOME/Documents/commander-shared}"
if [ ! -d "$UP/src" ]; then
  UP="$(mktemp -d)"
  git clone -q --depth 1 "git@github.com:Smarter-Poker/commander-shared.git" "$UP"
else
  git -C "$UP" fetch -q origin main
fi
TMP="$(mktemp -d)"
git -C "$UP" --work-tree="$TMP" checkout origin/main -- src package.json
if [ "${1:-}" = "--list" ]; then
  diff -rq "$ROOT/vendor/commander-shared/src" "$TMP/src" || true
  exit 0
fi
[ $# -gt 0 ] || { echo "usage: $0 <src/... path> [...] | --list" >&2; exit 2; }
for p in "$@"; do
  p="${p#vendor/commander-shared/}"
  [ -f "$TMP/$p" ] || { echo "not in upstream main: $p" >&2; exit 1; }
  mkdir -p "$(dirname "$ROOT/vendor/commander-shared/$p")"
  cp "$TMP/$p" "$ROOT/vendor/commander-shared/$p"
  echo "synced $p"
done
