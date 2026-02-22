#!/usr/bin/env bash
set -euo pipefail

echo "Building all packages..."
pnpm build

echo "Publishing @journal/mcp to npm..."
pnpm --filter @journal/mcp publish --access public --no-git-checks

echo "Done."
