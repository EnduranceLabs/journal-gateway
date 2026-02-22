---
name: dev
description: Development commands and workflows for the journal-edge project
user-invocable: false
---

# Development Reference

## Commands

All commands run from the repository root via Turborepo:

```bash
pnpm build       # Build all packages (types first, then gateway)
pnpm test        # Run all tests with vitest
pnpm typecheck   # TypeScript type checking across all packages
```

## Monorepo Structure

```
packages/
  types/     # @journal/types — Zod schemas, TypeScript types, protocol definitions
  gateway/   # @journal/gateway — Gateway runtime (depends on @journal/types)
protocol/    # Protocol specification (JSON Schema + README)
```

**Build order matters:** `packages/types` must build before `packages/gateway` because gateway imports from `@journal/types`. Turborepo handles this automatically via `pnpm build`.

## Package Details

### `packages/types`

Protocol types defined with Zod schemas. Source files:
- `src/errors.ts` — `GatewayError`, error code enum (`INTEGRATION_NOT_FOUND`, `TOOL_NOT_FOUND`, `EXECUTION_FAILED`, `TIMEOUT`)
- `src/integrations.ts` — `Integration`, `ToolDefinition`, `ToolResult`, `ContentBlock`
- `src/messages.ts` — All message types with `z.discriminatedUnion("type", [...])` for `GatewayMessage` and `ServiceMessage`
- `src/index.ts` — Re-exports everything

### `packages/gateway`

Gateway runtime. Source files:
- `src/config.ts` — `McpServerConfig` interface and `parseConfig` with Zod validation
- `src/mcp-servers/` — Built-in MCP server catalog (one file per integration, barrel-exported via `mcp-servers/index.ts`)
- `src/mcp-process.ts` — Spawns MCP server subprocesses via `@modelcontextprotocol/sdk`
- `src/tool-runtime.ts` — Manages integration lifecycle (start, list tools, call tools)
- `src/connection.ts` — WebSocket connection to Journal service with reconnection
- `src/logger.ts` — Structured JSON logger
- `src/index.ts` — Entry point

## Testing Patterns

Tests use **vitest**. Run a single package's tests:

```bash
cd packages/types && pnpm test
cd packages/gateway && pnpm test
```

### Mocking conventions

- **MCP SDK:** Use `vi.mock("@modelcontextprotocol/sdk/client/index.js")` and `vi.mock("@modelcontextprotocol/sdk/client/stdio.js")` to mock the MCP client and transport
- **WebSocket:** Use `vi.mock("ws")` to mock the `ws` module
- **Config tests:** Use the `makeEnv` helper to create env var objects with sensible defaults, then override specific values:

```ts
function makeEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    JOURNAL_GATEWAY_TOKEN: "gw_test123",
    JOURNAL_GATEWAY_URL: "wss://gateway.journal.one/v1",
    INTEGRATIONS: "postgresql",
    DATABASE_URL: "postgresql://localhost:5432/test",
    LOG_LEVEL: "info",
    ...overrides,
  };
}
```

### Process event testing

The gateway uses `EventEmitter` patterns for process lifecycle. Tests verify events like connection state changes, integration registration, and tool call handling.

## Code Conventions

- **Zod discriminated unions** for message type narrowing (discriminator: `"type"` field)
- **Structured JSON logging** via the `Logger` class
- **ESM-only** (`"type": "module"` in package.json, `.js` extensions in imports)
- **Node >= 22** required
- **pnpm** as package manager (with Turborepo for task orchestration)
