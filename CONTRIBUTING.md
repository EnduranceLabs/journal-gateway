# Contributing

## Development

Prerequisites: Node.js 22+, pnpm, Python 3.11+ (for Python client).

```bash
# Install dependencies
pnpm install

# Build protocol and gateway
pnpm build

# Build TypeScript client
pnpm build:client

# Type check protocol, gateway, and TypeScript client
pnpm typecheck

# Run gateway tests
pnpm test

# Run TypeScript client tests
pnpm test:client

# Run TypeScript integration tests
pnpm test:integration

# Run Python client tests (creates the venv on first run; set PYTHON=/path/to/python3.11 if needed)
pnpm test:python

# Run every root-script suite above
pnpm test:all

# Run Docker database end-to-end tests (requires Docker; not part of pnpm test:all)
testing/e2e/run-all.sh
```

If your default `python3` is older than 3.11, prefix Python-dependent commands
with `PYTHON=/path/to/python3.11`, for example
`PYTHON=/opt/homebrew/bin/python3.12 pnpm test:all`.

## Architecture

The gateway connects outbound to the Journal service over WebSocket. It manages
MCP server connections (`stdio`, `sse`, or `streamable-http`) and skill files,
routing tool calls from the service to the appropriate MCP server.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the module-by-module structure.

## Client Libraries

Agents that want to accept gateway connections and call tools through them can use the client libraries. They implement the **service side** of the protocol: run a WebSocket server, authenticate gateways, pull tools and skills, and provide a `callTool()` API.

The examples below print from application callbacks. The client libraries
themselves must not write to stdout/stderr; diagnostics are surfaced through
callbacks such as `onSocketError` / `on_socket_error`.

```
+-------------+        +------------------+        +-----------+
|   Gateway   |--wss-->|  Client Library   |<--API--|   Agent   |
| (this repo) |        |  (TS or Python)   |        |           |
+-------------+        +------------------+        +-----------+
```

### TypeScript (`journal-gateway-client`)

```typescript
import { GatewayServer } from "journal-gateway-client";

const server = new GatewayServer({
  port: 8080,
  validateToken: async (token) =>
    token === "gw_expected" ? { organizationId: "org_1" } : null,
});

await server.start();

// Once a gateway connects and its initial catalog is pulled:
const result = await server.callTool("postgresql", "execute_sql", { sql: "SELECT 1" });
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

# Once a gateway connects and its initial catalog is pulled:
result = await server.call_tool("postgresql", "execute_sql", {"sql": "SELECT 1"})
print(result.content)

await server.stop()
```

## Protocol

The gateway communicates with Journal over WebSocket using a simple JSON protocol. See [spec/protocol.md](./spec/protocol.md) for the full specification.

## Telemetry and audit

- Telemetry bootstrapper: `gateway/src/telemetry.ts` (minimal OTLP/HTTP exporters for traces and metrics; defaults to `service.name=journal-gateway`; no OTEL logs).
- Audit logger: `gateway/src/audit.ts`, records metadata only (no arguments, results, or secrets). Events include tool call start/result/error, outbound message metadata, config/env reloads, and MCP process lifecycle.
- Instrumentation hooks live in `gateway/src/connection.ts` (tool call spans/metrics + audit) and `gateway/src/runtime.ts` (config/env apply events, MCP start/stop). Keep additions metadata-only; use ids/hashes instead of payloads.
- Env toggles: `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `TELEMETRY_DISABLED`, `AUDIT_LOG_FILE`, `AUDIT_MAX_BYTES`, `AUDIT_MAX_FILES`.

## Packaging

All four packages (`journal-gateway-protocol`, `journal-gateway`, the npm
`journal-gateway-client`, and the PyPI `journal-gateway-client`) release in
lockstep at the same version. Bump them together
with `packaging/bump-version.sh` — never edit versions by hand. See
[packaging/npm/README.md](./packaging/npm/README.md) for the full release runbook
(npm, PyPI, Homebrew, and Docker).

```bash
# Bump every package to the same version
./packaging/bump-version.sh 0.8.0

# Build the Docker image locally
docker build -f packaging/docker/Dockerfile -t journal-gateway .
```

## Pre-PR checklist

- Run `pnpm build`, `pnpm build:client`, and `pnpm typecheck` before opening a PR or publishing. Use `pnpm -r build` when you need every TypeScript workspace package built.
