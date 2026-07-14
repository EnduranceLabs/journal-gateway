#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "Checking version lockstep across all four packages..."
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

echo "Checking npm login..."
if ! npm whoami >/dev/null 2>&1; then
  echo "You are not logged in to npm. Run:" >&2
  echo "  npm login --scope=@journal.one --registry=https://registry.npmjs.org" >&2
  exit 1
fi

echo "Building all packages..."
pnpm -r build

echo "Publishing @journal.one/gateway-protocol..."
(cd "$ROOT/protocol" && pnpm publish --access public --no-git-checks)

echo "Publishing @journal.one/gateway..."
(cd "$ROOT/gateway" && pnpm publish --access public --no-git-checks)

echo "Publishing @journal.one/gateway-client..."
(cd "$ROOT/clients/typescript" && pnpm publish --access public --no-git-checks)

echo "Done. All packages published."
