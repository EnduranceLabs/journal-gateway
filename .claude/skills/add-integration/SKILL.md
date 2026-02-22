---
name: add-integration
description: Guide for configuring MCP server integrations with the gateway
disable-model-invocation: true
argument-hint: "[integration-id]"
---

# Configure an MCP Server Integration

MCP servers are configured by the user via the `MCP_SERVERS` environment variable (JSON array). There is no built-in catalog — all MCP servers are user-configured at runtime.

## MCP_SERVERS Format

Each entry in the JSON array must conform to:

```ts
interface McpServerConfig {
  id: string;         // Unique identifier (used as integrationId in tool calls)
  command: string;    // Executable to spawn (e.g. "npx", "python")
  args?: string[];    // Command-line arguments
  name?: string;      // Display name (defaults to id)
  description?: string; // What this integration does
  envVars?: Record<string, string>; // Gateway env var → subprocess env var mapping
}
```

## Example Configuration

```bash
JOURNAL_GATEWAY_TOKEN=gw_your_token \
  MCP_SERVERS='[
    {
      "id": "postgresql",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "name": "PostgreSQL",
      "description": "Query PostgreSQL databases",
      "envVars": { "DATABASE_URL": "DATABASE_URL" }
    }
  ]' \
  DATABASE_URL=postgresql://localhost:5432/mydb \
  journal-gateway
```

The `envVars` mapping tells the runtime to read the `DATABASE_URL` environment variable and pass it to the subprocess under the same name.

## How It Works at Runtime

1. The user sets `MCP_SERVERS` with the JSON config and provides required env vars.
2. `parseConfig()` in `gateway/src/config.ts` validates the JSON and resolves environment variables.
3. `Runtime.start()` in `gateway/src/runtime.ts` spawns each MCP server subprocess.
4. `Runtime.getRegistrations()` queries each subprocess for its tool list and returns `Integration[]`.
5. On `tool_call`, `Runtime.callTool()` routes to the correct subprocess.

## Key Files

- `gateway/src/config.ts` — `McpServerConfig` interface, `parseConfig()`, `RuntimeConfig` type
- `gateway/src/mcp-client.ts` — `McpClient` class (spawns and manages MCP subprocesses)
- `gateway/src/runtime.ts` — `Runtime` class (manages all MCP clients + skills)
- `gateway/src/__tests__/config.test.ts` — Config validation tests
- `gateway/src/__tests__/mcp-client.test.ts` — MCP client tests
- `gateway/src/__tests__/runtime.test.ts` — Runtime tests
