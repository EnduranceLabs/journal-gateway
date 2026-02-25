# npm Publishing

Internal guide for publishing Journal Gateway packages to npm.

## Prerequisites

```bash
npm login --scope=@journal.one
```

## Packages

Three packages are published under `@journal.one/`, in dependency order:

1. `@journal.one/gateway-protocol` — shared Zod schemas and TypeScript types
2. `@journal.one/gateway` — the gateway CLI
3. `@journal.one/gateway-client` — TypeScript client library

## Publish

```bash
./packaging/npm/publish.sh
```

The script builds all packages, then publishes protocol first (since the other two depend on it), followed by gateway and client.

## Version bumping

Update the `version` field in all three `package.json` files in lockstep:

- `protocol/package.json`
- `gateway/package.json`
- `clients/typescript/package.json`

Then run `pnpm install` to update the lockfile before publishing.
