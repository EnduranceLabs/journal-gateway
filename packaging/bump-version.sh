#!/usr/bin/env bash
# Bump every publishable package to the same version. All packages release in
# lockstep — run this so none drift. Usage: packaging/bump-version.sh 0.8.0
set -euo pipefail

VERSION="${1:-}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.].+)?$ ]]; then
  echo "Usage: $0 <version>   (e.g. $0 0.8.0)" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Replace only the version line so package.json formatting is preserved.
for pkg in protocol gateway clients/typescript; do
  sed -i.bak -E "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$pkg/package.json"
  rm -f "$pkg/package.json.bak"
  echo "  $pkg/package.json -> $VERSION"
done

sed -i.bak -E "s/^version = \".*\"/version = \"$VERSION\"/" clients/python/pyproject.toml
rm -f clients/python/pyproject.toml.bak
echo "  clients/python/pyproject.toml -> $VERSION"

echo "Updating lockfile..."
pnpm install >/dev/null

echo "Done. Review the diff, commit, then run the publish scripts."
