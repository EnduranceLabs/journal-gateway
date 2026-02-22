# Journal Gateway Integrations

## Problem

The gateway core (`packages/gateway/`) is a stable, minimal library that handles WebSocket connections, authentication, registration, and tool-call routing. It cannot be updated frequently once deployed. Adding new tool providers — databases, observability platforms, internal APIs — must be possible without modifying the core. The `IntegrationProvider` interface is the seam that makes this work.

## IntegrationProvider Interface

Any object that implements `IntegrationProvider` can supply tools to the gateway. The interface is defined in `packages/gateway/src/types.ts`:

```typescript
interface IntegrationProvider {
  start(): Promise<void>;
  stop(): Promise<void>;
  getRegistrations(): Promise<Integration[]>;
  callTool(integrationId: string, toolName: string, args: Record<string, unknown>): Promise<ToolResult>;
}
```

### Methods

| Method | When called | What it does |
|--------|-------------|--------------|
| `start()` | Once, before the gateway connects | Initialize resources (spawn subprocesses, open connections, etc.) |
| `stop()` | Once, on gateway shutdown | Clean up resources (kill subprocesses, close connections) |
| `getRegistrations()` | After `start()`, before sending the `register` message | Return the list of integrations and their tool definitions |
| `callTool(integrationId, toolName, args)` | On each inbound `tool_call` message | Execute the tool and return a `ToolResult` |

The gateway calls these methods — the provider never calls the gateway. This keeps the dependency arrow one-directional: gateway depends on the interface, provider implements it.

## Integration Model

Integration is the umbrella concept. An integration can provide tools (callable by the agent), skills (prompt templates that guide agent behavior), or both. How those capabilities are implemented — MCP subprocesses, custom code, Markdown files — is an internal detail hidden from the wire protocol.

## Adding an MCP Integration

The built-in MCP provider (`packages/mcp/`) implements `IntegrationProvider` by spawning MCP server subprocesses. To add a new MCP-based integration:

### 1. Define the McpServerConfig

Each MCP server is described by a config object:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier (used as `integrationId` in tool calls) |
| `type` | `"mcp_server"` | Literal discriminator |
| `name` | `string` | Display name |
| `description` | `string` | What this integration does |
| `command` | `string` | Executable to spawn (e.g. `npx`, `python`) |
| `args` | `string[]` | Command-line arguments |
| `envVars` | `Record<string, string>` | Mapping from config key to environment variable name passed to the subprocess |

### 2. Add to the catalog

Register the config in the catalog file at `packages/mcp/src/integrations/index.ts`:

```typescript
import { McpServerConfig } from "../config.js";

export const BUILT_IN_MCP_SERVERS: Record<string, McpServerConfig> = {
  postgresql: {
    id: "postgresql",
    type: "mcp_server",
    name: "PostgreSQL",
    description: "Query PostgreSQL databases",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
    envVars: {
      DATABASE_URL: "DATABASE_URL",
    },
  },
};
```

### 3. Configure environment variables

When the gateway starts, the user sets environment variables that the config's `envVars` mapping resolves:

```bash
INTEGRATIONS=postgresql \
DATABASE_URL=postgresql://localhost:5432/mydb \
journal-gateway
```

The `envVars` mapping (`{ DATABASE_URL: "DATABASE_URL" }`) tells the runtime to read the `DATABASE_URL` environment variable and pass it to the subprocess under the same name.

### 4. How it works at runtime

1. The user sets `INTEGRATIONS=postgresql` (comma-separated list of integration IDs).
2. `parseConfig()` looks up each ID in `BUILT_IN_MCP_SERVERS`, resolves environment variables, and produces an `McpConfig`.
3. `McpRuntime.start()` spawns the MCP server subprocess with the resolved env vars.
4. `McpRuntime.getRegistrations()` queries each subprocess for its tool list and returns `Integration[]`.
5. On `tool_call`, `McpRuntime.callTool()` routes to the correct subprocess.

## Custom Providers

You don't have to use MCP. Implement `IntegrationProvider` directly for full control:

```typescript
import { IntegrationProvider } from "@journal/gateway";
import { Integration, ToolResult } from "@journal/types";

class MyProvider implements IntegrationProvider {
  async start() {
    // Open connections, load config, etc.
  }

  async stop() {
    // Clean up
  }

  async getRegistrations(): Promise<Integration[]> {
    return [
      {
        id: "my-tool",
        name: "My Tool",
        description: "Does something useful",
        tools: [
          {
            name: "do_thing",
            description: "Does the thing",
            inputSchema: {
              type: "object",
              properties: { input: { type: "string" } },
              required: ["input"],
            },
          },
        ],
      },
    ];
  }

  async callTool(
    integrationId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    // Execute the tool
    return {
      content: [{ type: "text", text: "Done." }],
    };
  }
}
```

Then pass it to the gateway:

```typescript
import { Gateway } from "@journal/gateway";

const gateway = new Gateway(config, new MyProvider());
await gateway.connect();
```

## Runtime Architecture

```
+-----------------------------------------------+
|              Gateway Process                   |
|                                                |
|  +------------------+   +-----------------+    |
|  |    Gateway Core   |-->| IntegrationProvider |
|  | (packages/gateway)|   |   (interface)   |    |
|  +------------------+   +--------+--------+    |
|                                  |              |
|                          +-------+-------+      |
|                          |               |      |
|                    +-----+-----+   +-----+-----+|
|                    | McpRuntime |   |  Custom   ||
|                    |(packages/  |   |  Provider ||
|                    |   mcp/)    |   |           ||
|                    +-----+-----+   +-----------+|
|                          |                      |
|              +-----------+-----------+          |
|              |           |           |          |
|           +--+--+     +--+--+     +--+--+       |
|           | MCP |     | MCP |     | MCP |       |
|           |Srv 1|     |Srv 2|     |Srv N|       |
|           +--+--+     +--+--+     +--+--+       |
|              |           |           |          |
+--------------+-----------+-----------+----------+
               |           |           |
            +--+--+     +--+--+     +--+--+
            | DB  |     |Sentry|    | ... |
            +-----+     +------+    +-----+
```

The gateway core knows nothing about MCP, databases, or any specific tool. It calls `IntegrationProvider` methods and sends the results over the wire. The provider decides how to fulfill those calls — by spawning MCP subprocesses, making HTTP requests, querying databases directly, or anything else.

## Skills Inside Integrations

An integration can optionally carry skills — prompt/workflow templates that guide agent behavior. Skills are bundled inside integration objects alongside tools. See [skills.md](./skills.md) for the full skills specification.
