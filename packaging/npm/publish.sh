#!/usr/bin/env bash
set -euo pipefail

echo "Building all packages..."
pnpm -r build

echo "Publishing @journal.one/gateway-protocol..."
cd protocol && pnpm publish --access public --no-git-checks && cd ..

echo "Publishing @journal.one/gateway..."
cd gateway && pnpm publish --access public --no-git-checks && cd ..

echo "Publishing @journal.one/gateway-client..."
cd clients/typescript && pnpm publish --access public --no-git-checks && cd ../..

echo "Done. All packages published."
