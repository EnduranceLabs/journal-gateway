#!/usr/bin/env bash
# Build and publish the Python client (journal-gateway-client) to PyPI.
# Requires: python -m pip install build twine, and a configured PyPI token.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "Checking version lockstep across all four packages..."
"$ROOT/packaging/check-lockstep.sh"

cd "$ROOT/clients/python"

echo "Cleaning previous build artifacts..."
rm -rf dist build ./*.egg-info

echo "Building sdist and wheel..."
python -m build

echo "Uploading to PyPI..."
python -m twine upload dist/*

echo "Done. Published journal-gateway-client to PyPI."
