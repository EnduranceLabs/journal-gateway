#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "Checking version lockstep across all four packages..."
"$ROOT/packaging/check-lockstep.sh"

echo "Checking npm login..."
if ! npm whoami --registry=https://registry.npmjs.org >/dev/null 2>&1; then
  echo "You are not logged in to npm. Run:" >&2
  echo "  npm login --registry=https://registry.npmjs.org" >&2
  exit 1
fi

echo "Building all packages..."
pnpm -r build

echo "Publishing journal-gateway-protocol..."
(cd "$ROOT/protocol" && pnpm publish --access public --no-git-checks)

echo "Publishing journal-gateway..."
(cd "$ROOT/gateway" && pnpm publish --access public --no-git-checks)

echo "Publishing journal-gateway-client..."
(cd "$ROOT/clients/typescript" && pnpm publish --access public --no-git-checks)

echo "Done. All packages published."
