#!/usr/bin/env bash
# Verify all four publishable packages share one version (lockstep). Exit 1 on mismatch.
# Sourced/run by the npm and pypi publish scripts so neither can release a drifted version.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PV=$(node -p "require('$ROOT/protocol/package.json').version")
GV=$(node -p "require('$ROOT/gateway/package.json').version")
CV=$(node -p "require('$ROOT/clients/typescript/package.json').version")
PYV=$(grep -E '^version = ' "$ROOT/clients/python/pyproject.toml" | sed -E 's/version = "(.*)"/\1/')

if [[ "$PV" != "$GV" || "$PV" != "$CV" || "$PV" != "$PYV" ]]; then
  echo "Version mismatch (protocol=$PV gateway=$GV client=$CV python=$PYV)." >&2
  echo "Run packaging/bump-version.sh to align them before publishing." >&2
  exit 1
fi
echo "All packages at $PV."
