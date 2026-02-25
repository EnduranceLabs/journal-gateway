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
protocol/                   # @journal.one/gateway-protocol (shared Zod schemas + TS types)
gateway/                    # Gateway process (connects outbound to service)
  src/
    common/                 # Shared utilities (logger)
    connection.ts           # WebSocket connection handling
    runtime.ts              # MCP + skills runtime (IntegrationProvider) with config hot-reload
    mcp-client.ts           # MCP server transport wrapper (stdio, SSE, streamable-http)
    skill-client.ts         # Skill file loader + fs.watch change detection
    config-watcher.ts       # Config file watcher (fs.watch + debounce)
    env-file.ts             # .env file loader + watcher (dotenv)
    version-hash.ts         # Content-hash versioning for change detection
    config.ts               # Configuration parsing + resolution helpers
    main.ts                 # CLI entry point (.env auto-detection)
clients/
  typescript/               # @journal.one/gateway-client npm package
  python/                   # journal-gateway-client PyPI package
testing/
  integration/              # End-to-end tests (real gateway <-> client library)
spec/
  protocol.md               # WebSocket protocol specification
```

The gateway connects outbound to the Journal service over WebSocket. It manages MCP server connections (stdio subprocesses, SSE, or streamable-http) and skill files, routing tool calls from the service to the appropriate MCP server.

## Client Libraries

Agents that want to accept gateway connections and call tools through them can use the client libraries. They implement the **service side** of the protocol: run a WebSocket server, authenticate gateways, pull tools and skills, and provide a `callTool()` API.

```
+-------------+        +------------------+        +-----------+
|   Gateway   |--wss-->|  Client Library   |<--API--|   Agent   |
| (this repo) |        |  (TS or Python)   |        |           |
+-------------+        +------------------+        +-----------+
```

### TypeScript (`@journal.one/gateway-client`)

```typescript
import { GatewayServer } from "@journal.one/gateway-client";

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

# Once a gateway connects:
result = await server.call_tool("my-integration", "query", {"sql": "SELECT 1"})
print(result.content)

await server.stop()
```

## Protocol

The gateway communicates with Journal over WebSocket using a simple JSON protocol. See [spec/protocol.md](./spec/protocol.md) for the full specification.

## Telemetry and audit

- Telemetry bootstrapper: `gateway/src/telemetry.ts` (OTLP/HTTP exporters for traces, metrics, logs; defaults to `service.name=journal-gateway`).
- Audit logger: `gateway/src/audit.ts`, records metadata only (no arguments, results, or secrets). Events include tool call start/result/error, outbound message metadata, config/env reloads, and MCP process lifecycle.
- Instrumentation hooks live in `gateway/src/connection.ts` (tool call spans/metrics/logs + audit) and `gateway/src/runtime.ts` (config/env/apply events, MCP start/stop). Keep additions metadata-only; use ids/hashes instead of payloads.
- Env toggles: `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `TELEMETRY_ENABLED`, `AUDIT_LOG_FILE`.

## Packaging

```bash
# Docker build
docker build -f packaging/docker/Dockerfile -t journal-gateway .

# Docker publish
./packaging/docker/publish.sh

# npm publish
./packaging/npm/publish.sh
```
