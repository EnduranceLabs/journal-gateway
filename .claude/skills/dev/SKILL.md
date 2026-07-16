---
name: dev
description: Development commands and workflows for the journal-gateway project
user-invocable: false
---

# Development Reference

Shared agent instructions and release rules live in `AGENTS.md`; module-by-module
architecture lives in `ARCHITECTURE.md`. The command reference below mirrors
`AGENTS.md`.

## Commands

All commands run from the repository root:

```bash
pnpm build            # build protocol and gateway
pnpm typecheck        # protocol, gateway, and TS client
pnpm test             # gateway tests
pnpm test:client      # TypeScript client tests
pnpm test:integration # TypeScript integration (gateway <-> TS client)
pnpm test:python      # Python client tests
pnpm test:all         # root-script suites above
testing/e2e/run-all.sh # Docker database end-to-end tests (requires Docker)
```

## Project Structure

See `ARCHITECTURE.md`.

## Key Source Files

See `ARCHITECTURE.md` for the current module list. For protocol message work,
start with `protocol/src/messages.ts`, `protocol/src/index.ts`,
`spec/protocol.md`, and `gateway/src/__tests__/messages.test.ts`.

## Testing Patterns

Tests use **vitest**. Run tests:

```bash
pnpm test
# or directly:
cd gateway && pnpm test
```

`pnpm test` is the gateway test suite, not every test in the repo. Use
`pnpm test:all` for the root-script suites and `testing/e2e/run-all.sh` for the
Docker database end-to-end tests.

### Mocking conventions

- **MCP SDK:** Use `vi.mock("@modelcontextprotocol/sdk/client/index.js")` and `vi.mock("@modelcontextprotocol/sdk/client/stdio.js")` to mock the MCP client and transport
- **WebSocket:** Use `vi.mock("ws")` to mock the `ws` module
- **Config tests:** Use the `makeEnv` helper to create env var objects with sensible defaults, then override specific values

### Process event testing

The gateway uses `EventEmitter` patterns for process lifecycle. Tests verify
events like connection state changes, catalog updates, and tool call handling.

## Code Conventions

- **Zod discriminated unions** for message type narrowing (discriminator: `"type"` field)
- **Structured JSON logging** via the `Logger` class
- **ESM-only** (`"type": "module"` in package.json, `.js` extensions in imports)
- **Node >= 22** required
- **pnpm** as package manager
