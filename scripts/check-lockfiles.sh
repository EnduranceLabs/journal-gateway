#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

lockfiles="$(
  find . \
    -name pnpm-lock.yaml \
    -not -path './node_modules/*' \
    -print |
    sed 's#^\./##' |
    sort
)"

if [[ "$lockfiles" != "pnpm-lock.yaml" ]]; then
  printf 'Expected pnpm-lock.yaml to be the only pnpm lockfile outside node_modules. Found:\n' >&2
  if [[ -n "$lockfiles" ]]; then
    while IFS= read -r lockfile; do
      printf '  %s\n' "$lockfile" >&2
    done <<< "$lockfiles"
  else
    printf '  <none>\n' >&2
  fi
  exit 1
fi
