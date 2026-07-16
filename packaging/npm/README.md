# Publishing

Internal guide for releasing the Journal Gateway packages and container image.

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
- Docker: authenticate to `ghcr.io/endurancelabs` with permission to push
  `journal-gateway`

## How to release

### 1. Bump every package to the same version

```bash
VERSION=0.8.1 # replace with the release version
./packaging/bump-version.sh "$VERSION"
```

This rewrites the version in all three `package.json` files and
`clients/python/pyproject.toml`, then updates the lockfile.

### 2. Commit the bump

```bash
git add -A && git commit -m "Bump version to $VERSION"
```

Open and merge the version-bump PR before publishing. Then sync `main` and tag
the release commit:

```bash
git checkout main
git pull --ff-only
git tag -a "v$VERSION" -m "v$VERSION"
git push origin "v$VERSION"
```

### 3. Publish npm packages

```bash
./packaging/npm/publish.sh
```

Builds all packages, then publishes `journal-gateway-protocol` first (the others
depend on it), followed by `journal-gateway` and the npm
`journal-gateway-client`.

If npm requires browser-based authentication, run the script from an interactive
terminal and open the URL that npm prints. A non-interactive agent session can
fail with `EOTP` even when the account is valid. If the script stops after one
or more packages publish, do not rerun blindly; npm versions are immutable. Check
which packages are already live and publish only the missing package if needed:

```bash
npm view journal-gateway-protocol@"$VERSION" version
npm view journal-gateway@"$VERSION" version
npm view journal-gateway-client@"$VERSION" version
```

The npm packages were previously published as `@journal.one/gateway`,
`@journal.one/gateway-client`, and `@journal.one/gateway-protocol`. If the old
scoped packages are not already deprecated, deprecate them after the unscoped
packages are published and verified:

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

If Homebrew Python refuses package installs because the environment is externally
managed, create a temporary release venv and point the script at it:

```bash
python3.12 -m venv /tmp/journal-gateway-publish
/tmp/journal-gateway-publish/bin/python -m pip install --upgrade pip build twine
PYTHON=/tmp/journal-gateway-publish/bin/python ./packaging/pypi/publish.sh
```

### 5. Publish the Docker image

```bash
TAG="$VERSION" ./packaging/docker/publish.sh
docker tag "ghcr.io/endurancelabs/journal-gateway:$VERSION" ghcr.io/endurancelabs/journal-gateway:latest
docker push ghcr.io/endurancelabs/journal-gateway:latest
```

### 6. Update the Homebrew formula

```bash
VERSION="$VERSION" ./packaging/homebrew/publish.sh
```

Rewrites `packaging/homebrew/journal-gateway.rb` with the new tarball URL and its
sha256. Commit the updated formula if this repository is meant to track the
current formula.

Important: this script does **not** publish to Homebrew. It only updates the
local formula file. The default tap name in the script is
`EnduranceLabs/homebrew-tap`, but that repository was not visible to `gh` from
this environment on 2026-07-16. Do not keep retrying a tap push when that
happens; get the correct tap repository/path or create/grant access to the tap
first.

### 7. Verify published artifacts

```bash
npm view journal-gateway-protocol@"$VERSION" version
npm view journal-gateway@"$VERSION" version
npm view journal-gateway-client@"$VERSION" version
curl -fsSL "https://pypi.org/pypi/journal-gateway-client/$VERSION/json" | jq -r '.info.version'
docker buildx imagetools inspect "ghcr.io/endurancelabs/journal-gateway:$VERSION"
docker buildx imagetools inspect ghcr.io/endurancelabs/journal-gateway:latest
```
