#!/usr/bin/env bash
set -euo pipefail

echo "Building gateway..."
cd gateway && pnpm build && cd ..

echo "Publishing @journal/gateway to npm..."
cd gateway && pnpm publish --access public --no-git-checks

echo "Done."
