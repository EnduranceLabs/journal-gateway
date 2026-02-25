# Contributing

## Development

Prerequisites: Node.js 20+, pnpm, Python 3.10+ (for Python client).

```bash
# Install dependencies
pnpm install

# Build gateway
pnpm build

# Build TypeScript client
pnpm build:client

# Type check
pnpm typecheck

# Run gateway tests
pnpm test

# Run TypeScript client tests
pnpm test:client

# Run integration tests (requires gateway to be built)
pnpm test:integration

# Run Python client tests
cd clients/python && python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]" && pytest tests/
```

## Architecture

```
protocol/                   # @journal/gateway-protocol (shared Zod schemas + TS types)
gateway/                    # Gateway process (connects outbound to service)
  src/
    common/                 # Shared utilities (logger)
    connection.ts           # WebSocket connection handling
    runtime.ts              # MCP + skills runtime (IntegrationProvider)
    mcp-client.ts           # MCP server subprocess wrapper
    skill-client.ts         # Skill file loader + fs.watch change detection
    version-hash.ts         # Content-hash versioning for change detection
    config.ts               # Configuration parsing
    main.ts                 # CLI entry point
clients/
  typescript/               # @journal/gateway-client npm package
  python/                   # journal-gateway-client PyPI package
testing/
  integration/              # End-to-end tests (real gateway <-> client library)
spec/
  protocol.md               # WebSocket protocol specification
```

The gateway connects outbound to the Journal service over WebSocket. It manages MCP server subprocesses and skill files, routing tool calls from the service to the appropriate MCP server.

## Client Libraries

Agents that want to accept gateway connections and call tools through them can use the client libraries. They implement the **service side** of the protocol: run a WebSocket server, authenticate gateways, receive registrations, and provide a `callTool()` API.

```
+-------------+        +------------------+        +-----------+
|   Gateway   |--wss-->|  Client Library   |<--API--|   Agent   |
| (this repo) |        |  (TS or Python)   |        |           |
+-------------+        +------------------+        +-----------+
```

### TypeScript (`@journal/gateway-client`)

```typescript
import { GatewayServer } from "@journal/gateway-client";

const server = new GatewayServer({
  port: 8080,
  validateToken: async (token) =>
    token === "gw_expected" ? { organizationId: "org_1" } : null,
});

await server.start();

// Once a gateway connects and registers:
const result = await server.callTool("my-integration", "query", { sql: "SELECT 1" });
console.log(result.content);

await server.stop();
```

### Python (`journal-gateway-client`)

```python
from journal_gateway_client import GatewayServer, TokenValidationResult

async def validate(token):
    if token == "gw_expected":
        return TokenValidationResult(organization_id="org_1")
    return None

server = GatewayServer(validate_token=validate, port=8080)
await server.start()

# Once a gateway connects and registers:
result = await server.call_tool("my-integration", "query", {"sql": "SELECT 1"})
print(result.content)

await server.stop()
```

## Protocol

The gateway communicates with Journal over WebSocket using a simple JSON protocol. See [spec/protocol.md](./spec/protocol.md) for the full specification.

## Packaging

```bash
# Docker build
docker build -f packaging/docker/Dockerfile -t journal-gateway .

# Docker publish
./packaging/docker/publish.sh

# npm publish
./packaging/npm/publish.sh
```
