---
name: dev
description: Development commands and workflows for the journal-gateway project
user-invocable: false
---

# Development Reference

## Commands

All commands run from the repository root:

```bash
pnpm build       # Build the gateway package
pnpm test        # Run all tests with vitest
pnpm typecheck   # TypeScript type checking
```

## Project Structure

```
gateway/
  src/
    common/             # Shared utilities (logger)
    connection.ts       # WebSocket connection to Journal service
    runtime.ts          # MCP + skills runtime (IntegrationProvider) with config hot-reload
    mcp-client.ts       # MCP server transport wrapper (stdio, SSE, streamable-http)
    skill-client.ts     # Skill file loader
    config-watcher.ts   # Config file watcher (fs.watch + debounce)
    env-file.ts         # .env file loader + watcher (dotenv)
    config.ts           # Configuration parsing + resolution helpers
    main.ts             # CLI entry point (.env auto-detection)
    __tests__/          # All tests
protocol/
  src/
    messages.ts         # Protocol message schemas and types
    integrations.ts     # Integration, tool, and content schemas
    skills.ts           # Skill schema
    errors.ts           # Gateway error schemas
    provider.ts         # IntegrationProvider and gateway config types
```

## Key Source Files

### `protocol/src/`

Protocol types defined with Zod schemas:
- `errors.ts` — `GatewayError`, error code enum (`INTEGRATION_NOT_FOUND`, `TOOL_NOT_FOUND`, `EXECUTION_FAILED`, `TIMEOUT`)
- `integrations.ts` — `Integration`, `ToolDefinition`, `ToolResult`, `ContentBlock`
- `messages.ts` — All message types with `z.discriminatedUnion("type", [...])` for `GatewayMessage` and `ServiceMessage`
- `skills.ts` — `Skill` type (`{ id, content }`)
- `provider.ts` — `IntegrationProvider` interface, `GatewayConfig`, `IntegrationNotFoundError`
- `index.ts` — Re-exports everything

### `gateway/src/`

- `connection.ts` — WebSocket connection to Journal service with reconnection
- `common/logger.ts` — Structured JSON logger
- `version.ts` — Package version loader
- `config.ts` — `McpServerConfig` interface, `parseConfig`, `readConfigFile`, `resolveConfigFile`, `resolveConfigFilePath` with Zod validation
- `config-watcher.ts` — Watches config file with `fs.watch` + 500ms debounce, emits `config_changed`
- `env-file.ts` — Loads and watches `.env` files using `dotenv.parse()`, emits `env_changed`
- `mcp-client.ts` — Starts or connects to MCP servers via `@modelcontextprotocol/sdk` transports
- `runtime.ts` — `Runtime` implements `IntegrationProvider` (manages MCP clients + skills), supports hot-reload of config and env files
- `skill-client.ts` — Loads raw Markdown files as skills
- `main.ts` — CLI entry point with `.env` auto-detection (`--env-file`, `JOURNAL_GATEWAY_ENV_FILE`, or `.env` in cwd)

## Testing Patterns

Tests use **vitest**. Run tests:

```bash
pnpm test
# or directly:
cd gateway && pnpm test
```

### Mocking conventions

- **MCP SDK:** Use `vi.mock("@modelcontextprotocol/sdk/client/index.js")` and `vi.mock("@modelcontextprotocol/sdk/client/stdio.js")` to mock the MCP client and transport
- **WebSocket:** Use `vi.mock("ws")` to mock the `ws` module
- **Config tests:** Use the `makeEnv` helper to create env var objects with sensible defaults, then override specific values

### Process event testing

The gateway uses `EventEmitter` patterns for process lifecycle. Tests verify events like connection state changes, integration registration, and tool call handling.

## Code Conventions

- **Zod discriminated unions** for message type narrowing (discriminator: `"type"` field)
- **Structured JSON logging** via the `Logger` class
- **ESM-only** (`"type": "module"` in package.json, `.js` extensions in imports)
- **Node >= 22** required
- **pnpm** as package manager
