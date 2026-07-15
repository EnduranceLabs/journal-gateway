#!/usr/bin/env bash
# Build and publish the Python client (journal-gateway-client) to PyPI.
# Requires: Python 3.11+, build, twine, and a configured PyPI token.
# Set PYTHON=/path/to/python3.11 if python3 is older on your machine.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PYTHON_BIN="${PYTHON:-python3}"

"$PYTHON_BIN" - <<'PY'
import sys

if sys.version_info < (3, 11):
    raise SystemExit("Python 3.11+ required; set PYTHON=/path/to/python3.11")
PY

for module in build twine; do
  if ! "$PYTHON_BIN" -m "$module" --version >/dev/null 2>&1; then
    echo "Missing Python module: $module" >&2
    echo "Install release tools with: $PYTHON_BIN -m pip install build twine" >&2
    exit 1
  fi
done

echo "Checking version lockstep across all four packages..."
"$ROOT/packaging/check-lockstep.sh"

cd "$ROOT/clients/python"

echo "Cleaning previous build artifacts..."
rm -rf dist build ./*.egg-info

echo "Building sdist and wheel..."
"$PYTHON_BIN" -m build

echo "Uploading to PyPI..."
"$PYTHON_BIN" -m twine upload dist/*

echo "Done. Published journal-gateway-client to PyPI."
