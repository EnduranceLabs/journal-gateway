# Architecture

## Core Principle
Small workspace: `protocol/` for shared types, `gateway/` for the runtime, client
libraries for the service side. Keep it simple.

## Structure
- `protocol/` — `@journal.one/gateway-protocol` package. Pure Zod schemas and TypeScript
  types shared by both gateway and client libraries (Integration, ToolResult, Skill,
  message schemas, IntegrationProvider, GatewayConfig, errors).
- `gateway/src/common/` — Shared utilities (logger).
- `gateway/src/connection.ts` — WebSocket connection to Journal service. Uses a single
  async reconnect loop (`connect()` is idempotent; `close()` drains the loop before a
  new `connect()` can start). Handles authentication, sends `version_changed` after
  auth, responds to pull requests (`get_versions`, `get_tools`, `get_skills`), routes
  tool calls, and handles ping/pong. The message handler has a top-level try/catch to
  prevent unhandled rejections. Reconnects with exponential backoff (1s initial, 2x
  multiplier, 30s max, ±25% jitter). Protocol version 2 (pull-based).
- `gateway/src/runtime.ts` — Runtime that manages MCP clients and skills. Implements
  IntegrationProvider with `getTools()` and `getSkills()`. Tracks content-hash
  versions (mcpVersion/skillsVersion) and emits `versions_changed` when tools or
  skills change at runtime. Supports hot-reload: accepts optional `configFilePath`
  and `envFilePath`, creates ConfigWatcher and EnvFile instances, and dynamically
  adds/removes/restarts MCP clients when config or env files change on disk.
- `gateway/src/mcp-client.ts` — Manages individual MCP server connections across three
  transports: `stdio` (subprocess), `sse` (SSEClientTransport), and `streamable-http`
  (StreamableHTTPClientTransport). Uses a `createTransport()` factory that switches on
  the config's `transport` field. Cache-first design: tools are fetched on `start()`
  and cached in memory; `getTools()` returns the cached snapshot synchronously.
  Listens for MCP `notifications/tools/list_changed`, refreshes the cache, and emits
  `tools_changed`. On refresh failure, retains last-known-good cache. Crash handling
  (`onclose`) clears the cache and works identically for all transports.
- `gateway/src/skill-client.ts` — Loads skill files (raw Markdown) from a directory.
  Watches the skills directory with `fs.watch` and emits `skills_changed` on `.md`
  file changes. Exposes `getSkills()` for direct skill access and `getIntegrations()`
  for version hash computation.
- `gateway/src/version-hash.ts` — Computes stable content hashes (SHA-256, 16 hex chars)
  over integration arrays for change detection.
- `gateway/src/config.ts` — Parses operational env vars and loads the gateway config file
  (`--config` or `JOURNAL_GATEWAY_CONFIG`). Validates with Zod using a discriminated union
  on `transport` (`stdio`, `sse`, `streamable-http`). Resolves `envVars` for stdio and
  `headers` (env var → header value) for HTTP transports. Backward compat: configs with
  `command` but no `transport` field auto-get `transport: "stdio"`. Exports reusable
  functions: `readConfigFile()`, `resolveConfigFile()`, `resolveConfigFilePath()`.
- `gateway/src/config-watcher.ts` — Watches the gateway config file with `fs.watch` +
  500ms debounce. Re-reads and re-parses on change via `readConfigFile()`. Parse errors
  are silently ignored (current config kept). Emits `config_changed` with the new
  `GatewayConfigFile`.
- `gateway/src/env-file.ts` — Loads and watches a `.env` file. Uses `dotenv.parse()` for
  parsing without mutating `process.env`. `fs.watch` + 500ms debounce pattern. Emits
  `env_changed` on file modification.
- `gateway/src/main.ts` — CLI entry point. Auto-detects `.env` in cwd (with `--env-file`
  override or `JOURNAL_GATEWAY_ENV_FILE` env var), loads it before `parseConfig()`, and
  passes config file path + env file path to `Runtime` for hot-reload.

## Gateway Config File
All MCP servers and skills are configured via a single JSON config file with two top-level
fields: `mcpServers` (array of server definitions) and `skillsDir` (path string).
The config file is pointed to by `--config <path>` CLI arg or `JOURNAL_GATEWAY_CONFIG`
env var (file path or inline JSON). Secrets stay in real env vars.

Each server in `mcpServers` is a discriminated union on `transport`:
- **`stdio`** (default): `command`, `args`, `envVars` — the `envVars` mapping resolves
  host env vars to subprocess env vars at startup.
- **`sse`**: `url`, `headers` — for legacy SSE-based MCP servers.
- **`streamable-http`**: `url`, `headers` — the current MCP spec recommendation.

For `sse`/`streamable-http`, the `headers` mapping resolves `{ headerName: envVarName }`
from host env vars at startup. Configs without a `transport` field that have `command`
are treated as `stdio` for backward compatibility.

## Client Libraries
- `clients/typescript/` — `@journal.one/gateway-client` npm package. Implements the
  service side of the protocol: runs a WebSocket server, authenticates gateways,
  auto-pulls tools/skills on `version_changed`, and provides `callTool()`,
  `getVersions()`, `getTools()`, and `getSkills()` APIs.
- `clients/python/` — `journal-gateway-client` PyPI package. Same functionality
  as the TypeScript client, using `websockets` and `asyncio`.
- `testing/integration/` — Integration tests that spin up the real gateway +
  client library and verify end-to-end tool calls.

## IntegrationProvider Interface
The Runtime implements this interface to provide capabilities to the connection:
- `getTools(): Integration[]` — synchronous, returns cached MCP tool integrations
- `getSkills(): Skill[]` — synchronous, returns skills loaded in memory
- `getVersions(): GatewayVersions` — return `{ mcpVersion, skillsVersion }` content hashes (null if empty)
- `callTool(integrationId, toolName, args)` — execute a tool call (async)
- `start()` / `stop()` — lifecycle management
- `on/off("versions_changed")` — optional event for proactive change notification

## Change Detection
The gateway detects tool/skill changes at runtime and notifies the service:
- MCP: listens for `notifications/tools/list_changed` from MCP SDK + crash events
- Skills: `fs.watch` on the skills directory (`.md` files only)
- Config hot-reload: `ConfigWatcher` watches the config file, `EnvFile` watches `.env`;
  on change the Runtime diffs current vs new servers by ID and adds/removes/restarts
  MCP clients as needed. `skillsDir` changes are NOT hot-reloaded (logged warning).
- All paths debounce 500ms, recompute content-hash versions, and emit
  `versions_changed` only if a version actually changed
- The connection subscribes to this event and sends a lightweight `version_changed`
  message (fire-and-forget push with just version hashes, not full integrations)
- The service then decides what to pull based on which versions changed
