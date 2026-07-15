# Publishing

Internal guide for releasing the Journal Gateway packages.

All packages release in **lockstep** — the same version number every time, so a
customer can trust that the gateway, TypeScript client, protocol package, and
Python client speak the same protocol when installed at the same version. Bump
them together with the script below; never edit versions by hand. The npm and
PyPI publish scripts run `packaging/check-lockstep.sh` and refuse to publish if
the four versions disagree.

## Packages

| Package | Registry | Location |
|---------|----------|----------|
| `journal-gateway` | npm | `gateway/` |
| `journal-gateway-client` | npm | `clients/typescript/` |
| `journal-gateway-protocol` | npm | `protocol/` |
| `journal-gateway-client` | PyPI | `clients/python/` |

## First-time setup

- npm: `npm login --registry=https://registry.npmjs.org`
- PyPI: use Python 3.11+ (`PYTHON=/path/to/python3.11` if `python3` is
  older), configure a token in `~/.pypirc` (or `TWINE_*` env vars), and install
  build tools with `${PYTHON:-python3} -m pip install build twine`

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

Builds all packages, then publishes `journal-gateway-protocol` first (the others
depend on it), followed by `journal-gateway` and the npm
`journal-gateway-client`.

The npm packages were previously published as `@journal.one/gateway`,
`@journal.one/gateway-client`, and `@journal.one/gateway-protocol`. After the
unscoped packages are published and verified, deprecate the old scoped packages:

```bash
npm deprecate @journal.one/gateway@"<=0.7.0" "Renamed to journal-gateway. Install journal-gateway@0.8.0 or newer."
npm deprecate @journal.one/gateway-client@"<=0.7.0" "Renamed to journal-gateway-client. Install journal-gateway-client@0.8.0 or newer."
npm deprecate @journal.one/gateway-protocol@"<=0.7.0" "Renamed to journal-gateway-protocol. Install journal-gateway-protocol@0.8.0 or newer."
```

### 4. Publish the Python client to PyPI

```bash
./packaging/pypi/publish.sh
```

If your default `python3` is older than 3.11, run it with
`PYTHON=/path/to/python3.11 ./packaging/pypi/publish.sh`.

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
