# Publishing

Internal guide for releasing the Journal Gateway packages.

All packages release in **lockstep** — the same version number every time, so a
customer can trust that `@journal.one/gateway` 0.7.0, `@journal.one/gateway-client`
0.7.0, and `journal-gateway-client` 0.7.0 speak the same protocol. Bump them
together with the script below; never edit versions by hand (that is how the Python
client silently drifted to 0.2.0 while the npm packages were at 0.6.0). Both the npm and
PyPI publish scripts run `packaging/check-lockstep.sh` and refuse to publish if the four
versions disagree.

## Packages

| Package | Registry | Location |
|---------|----------|----------|
| `@journal.one/gateway-protocol` | npm | `protocol/` |
| `@journal.one/gateway` | npm | `gateway/` |
| `@journal.one/gateway-client` | npm | `clients/typescript/` |
| `journal-gateway-client` | PyPI | `clients/python/` |

## First-time setup

- npm: `npm login --scope=@journal.one`
- PyPI: configure a token in `~/.pypirc` (or `TWINE_*` env vars), and
  `python -m pip install build twine`

## How to release

### 1. Bump every package to the same version

```bash
./packaging/bump-version.sh 0.8.0
```

This rewrites the version in all three `package.json` files and
`clients/python/pyproject.toml`, then updates the lockfile.

### 2. Commit the bump

```bash
git add -A && git commit -m "Bump version to 0.8.0"
```

### 3. Publish npm packages

```bash
./packaging/npm/publish.sh
```

Builds all packages, then publishes `gateway-protocol` first (the others depend on
it), followed by `gateway` and `gateway-client`.

### 4. Publish the Python client to PyPI

```bash
./packaging/pypi/publish.sh
```

### 5. Update the Homebrew formula

```bash
./packaging/homebrew/publish.sh
```

Rewrites `packaging/homebrew/journal-gateway.rb` with the new tarball URL and its
sha256. Commit the updated formula and push it to the tap.

### 6. Publish the Docker image

```bash
TAG=0.8.0 ./packaging/docker/publish.sh
```
