# npm Publishing

Internal guide for publishing Journal Gateway packages to npm.

## First-time setup

1. Create the `journal.one` org on npmjs.com (if it doesn't exist): https://www.npmjs.com/org/create
2. Log in to npm:
   ```bash
   npm login --scope=@journal.one
   ```

## Packages

Three packages are published under `@journal.one/`, in dependency order:

1. `@journal.one/gateway-protocol` — shared Zod schemas and TypeScript types
2. `@journal.one/gateway` — the gateway CLI
3. `@journal.one/gateway-client` — TypeScript client library

## How to publish

### 1. Bump versions

All three packages share the same version number. To release a new version,
update the `"version"` field in all three files to the same value:

- `protocol/package.json`
- `gateway/package.json`
- `clients/typescript/package.json`

For example, to go from `0.1.0` to `0.2.0`:

```bash
# Edit all three package.json files, changing "version": "0.1.0" to "version": "0.2.0"
```

### 2. Update the lockfile

```bash
pnpm install
```

### 3. Commit the version bump

```bash
git add protocol/package.json gateway/package.json clients/typescript/package.json pnpm-lock.yaml
git commit -m "Bump version to 0.2.0"
```

### 4. Publish

```bash
./packaging/npm/publish.sh
```

The script builds all packages, then publishes protocol first (since the other
two depend on it), followed by gateway and client.
