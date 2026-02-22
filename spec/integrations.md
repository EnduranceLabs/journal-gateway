# Journal Gateway Integrations

## Problem

The gateway core (connection handling, auth, registration, tool-call routing) is stable and minimal. Adding new tool providers — databases, observability platforms, internal APIs — must be possible without modifying the core. The `IntegrationProvider` interface is the seam that makes this work.

## IntegrationProvider Interface

Any object that implements `IntegrationProvider` can supply tools to the gateway. The interface is defined in `gateway/src/types/provider.ts`:

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

## MCP Server Configuration

MCP servers are configured via the `MCP_SERVERS` environment variable as a JSON array:

```bash
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

Each server object:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier (used as `integrationId` in tool calls) |
| `command` | `string` | Executable to spawn (e.g. `npx`, `python`) |
| `args` | `string[]` | Command-line arguments |
| `name` | `string` | Display name (defaults to `id`) |
| `description` | `string` | What this integration does |
| `envVars` | `Record<string, string>` | Mapping from gateway env var to subprocess env var |

### How it works at runtime

1. The user sets `MCP_SERVERS` with the JSON config and provides the required env vars.
2. `parseConfig()` validates the JSON and resolves environment variables.
3. `Runtime.start()` spawns each MCP server subprocess with the resolved env vars.
4. `Runtime.getRegistrations()` queries each subprocess for its tool list and returns `Integration[]`.
5. On `tool_call`, `Runtime.callTool()` routes to the correct subprocess.

## Custom Providers

You don't have to use MCP. Implement `IntegrationProvider` directly for full control:

```typescript
import type { IntegrationProvider } from "@journal/gateway";
import type { Integration, ToolResult } from "@journal/gateway";

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
import { GatewayConnection } from "@journal/gateway";

const connection = new GatewayConnection(config, new MyProvider());
await connection.connect();
```

## Runtime Architecture

```
+-----------------------------------------------+
|              Gateway Process                   |
|                                                |
|  +------------------+   +-----------------+    |
|  | GatewayConnection|-->| IntegrationProvider |
|  | (connection.ts)  |   |   (interface)   |    |
|  +------------------+   +--------+--------+    |
|                                  |              |
|                          +-------+-------+      |
|                          |               |      |
|                    +-----+-----+   +-----+-----+|
|                    |  Runtime  |   |  Custom   ||
|                    |(runtime.ts|   |  Provider ||
|                    |           |   |           ||
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

The gateway connection knows nothing about MCP, databases, or any specific tool. It calls `IntegrationProvider` methods and sends the results over the wire. The provider decides how to fulfill those calls — by spawning MCP subprocesses, making HTTP requests, querying databases directly, or anything else.

## Skills Inside Integrations

An integration can optionally carry skills — prompt/workflow templates that guide agent behavior. Skills are bundled inside integration objects alongside tools. See [skills.md](./skills.md) for the full skills specification.
