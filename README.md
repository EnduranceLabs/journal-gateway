# Journal Gateway

Connect your data sources to [Journal](https://journal.one). The gateway runs
inside your network and connects outbound to Journal. Credentials stay in your
infrastructure, and no inbound ports are required.

## How It Works

```
+-------------------------------------+
|           Your Network              |
|                                     |
|  +--------------+  +-------------+  |
|  | Data sources |<-+   Gateway   |  |
|  +--------------+  +------+------+  |
|                           |         |
+---------------------------+---------+
                            | secure outbound
                     +------v------+
                     |   Journal   |
                     +-------------+
```

## Quick Start

### npm

```bash
npm install -g journal-gateway

JOURNAL_GATEWAY_TOKEN=gw_your_token journal-gateway --config gateway.json
```

### Docker

To validate the Docker image locally, create a `.env` file next to
`gateway.json` that contains `JOURNAL_GATEWAY_TOKEN=gw_your_token`, then run:

```bash
docker run --rm \
  -v "$(pwd)/gateway.json:/etc/journal/gateway.json:ro" \
  --env-file .env \
  ghcr.io/endurancelabs/journal-gateway:latest --config /etc/journal/gateway.json
```

For a long-lived container, mount a persistent config file and env file:

```bash
docker run -d --name journal-gateway --restart unless-stopped \
  -v /etc/journal/gateway.json:/etc/journal/gateway.json:ro \
  --env-file /etc/journal/gateway.env \
  ghcr.io/endurancelabs/journal-gateway:latest --config /etc/journal/gateway.json
```

The image `ENTRYPOINT` is the gateway binary. Pass gateway flags such as
`--config`, `--env-file`, and `--version` after the image name. Provide secrets
with `--env-file` or `-e`; tokens and integration credentials should not be
included in the image. Config hot-reload over a bind mount is reliable on Linux
hosts. On Docker Desktop for macOS or Windows, restart the container after
editing the config file.

### Example config file (`gateway.json`)

```json
{
  "mcpServers": [
    {
      "id": "postgresql",
      "command": "npx",
      "args": ["-y", "@toolbox-sdk/server", "--prebuilt", "postgres", "--stdio"],
      "name": "PostgreSQL",
      "description": "Query a PostgreSQL database",
      "envVars": {
        "POSTGRES_HOST": "POSTGRES_HOST",
        "POSTGRES_PORT": "POSTGRES_PORT",
        "POSTGRES_DATABASE": "POSTGRES_DATABASE",
        "POSTGRES_USER": "POSTGRES_USER",
        "POSTGRES_PASSWORD": "POSTGRES_PASSWORD"
      }
    },
    {
      "id": "remote-api",
      "transport": "streamable-http",
      "url": "https://mcp.example.com/mcp",
      "name": "Remote API",
      "description": "Remote MCP server",
      "headers": { "Authorization": "REMOTE_MCP_AUTHORIZATION" }
    }
  ],
  "skillsDir": "/opt/journal/skills"
}
```

MCP server packages in examples are external runtime commands. They are resolved
by `npx` when the gateway starts and are not bundled with, or installed by,
`journal-gateway`.

Set every host environment variable referenced by an `envVars` key or a
`headers` value before starting the gateway. For the config above, that means
`POSTGRES_*` and `REMOTE_MCP_AUTHORIZATION` in addition to
`JOURNAL_GATEWAY_TOKEN`.

Runnable examples (this config plus minimal TS and Python client servers) live in
[`examples/`](./examples). Database and enterprise integration examples live in
[`examples/integrations/`](./examples/integrations). Add a `"$schema"` field pointing at
[`spec/gateway-config.schema.json`](./spec/gateway-config.schema.json) for editor
autocomplete and validation:

```json
{
  "$schema": "https://raw.githubusercontent.com/EnduranceLabs/journal-gateway/main/spec/gateway-config.schema.json",
  "mcpServers": []
}
```

Run `journal-gateway --help` for the full list of flags and environment variables.

## Configuration

### Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JOURNAL_GATEWAY_TOKEN` | yes | — | Auth token from Journal (starts with `gw_`) |
| `JOURNAL_GATEWAY_URL` | no | `wss://gateway.journal.one/v1` | Journal endpoint |
| `JOURNAL_GATEWAY_CONFIG` | no | — | Path to config file, or inline JSON (detected by leading `{`) |
| `JOURNAL_GATEWAY_ENV_FILE` | no | — | Path to `.env` file (auto-detects `.env` in cwd if not set) |
| `LOG_LEVEL` | no | `info` | Log level: `debug`, `info`, `warn`, `error` |

### Config file

The config file describes what the gateway offers. Point to it with either:

1. **`--config /path/to/gateway.json`** — CLI argument (highest precedence)
2. **`JOURNAL_GATEWAY_CONFIG`** — env var containing a file path or inline JSON

Both `mcpServers` and `skillsDir` are optional. An empty `{}` is valid; the
gateway will connect without exposing tools or skills.

Use `--env-file /path/to/.env` to load environment variables from a `.env`
file. If neither `--env-file` nor `JOURNAL_GATEWAY_ENV_FILE` is set, the
gateway auto-detects a `.env` file in the current directory. Values from `.env`
are used only when the variable is not already set in the process environment.

#### Config file schema

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mcpServers` | array | `[]` | MCP server definitions (see below) |
| `skillsDir` | `string \| null` | `null` | Path to directory containing skill Markdown files |

#### MCP servers

[MCP (Model Context Protocol)](https://modelcontextprotocol.io/) is a standard for connecting AI agents to external tools. The gateway connects to MCP servers via three transports, making their tools available to Journal.

Each entry in `mcpServers` has a `transport` field that determines the connection type. Configs without a `transport` field that have a `command` are treated as `stdio` for backward compatibility.

**Common fields (all transports):**

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Unique name for this server |
| `transport` | no | `"stdio"` (default), `"sse"`, or `"streamable-http"` |
| `name` | no | Display name (defaults to `id`) |
| `description` | no | Server description |

**`stdio` — local subprocess (default):**

| Field | Required | Description |
|-------|----------|-------------|
| `command` | yes | Command to run (e.g. `npx`, `python`) |
| `args` | no | Command-line arguments |
| `envVars` | no | Map of `{ hostEnvVar: subprocessEnvVar }` resolved before starting the subprocess |

**`sse` — SSE client (legacy remote servers):**

| Field | Required | Description |
|-------|----------|-------------|
| `url` | yes | SSE endpoint URL |
| `headers` | no | Map of `{ headerName: hostEnvVar }` — values resolved from host environment |

**`streamable-http` — Streamable HTTP client (recommended for remote servers):**

| Field | Required | Description |
|-------|----------|-------------|
| `url` | yes | HTTP endpoint URL |
| `headers` | no | Map of `{ headerName: hostEnvVar }` — values resolved from host environment |

#### Skills

Skills are instructions that teach Journal how to perform specific tasks in your environment. Place Markdown files in a directory and set `skillsDir` in the config file. Each `.md` file becomes a skill — the filename is used as the skill name.

## Protocol

The gateway communicates with Journal over a WebSocket using a simple JSON protocol (version 2). The full specification is in [spec/protocol.md](./spec/protocol.md); this section covers the key ideas.

### Connection flow

The gateway connects **outbound** to the Journal service — no inbound ports are needed. After authenticating with a token, it sends a **`version_changed`** message announcing its current version hashes. The connection is then ready — no registration handshake needed. The service decides when to fetch tools and skills by sending pull requests (`get_tools`, `get_skills`).

### Change detection

Tools and skills can change while the gateway is running. An MCP server might restart with different tools, or a skill file might be added to disk. The gateway detects these changes automatically and sends a lightweight **`version_changed`** message with updated version hashes. The service can then pull the specific data it needs.

The gateway also watches the config file and `.env` file for changes. When you add, remove, or modify an MCP server in the config file, the gateway automatically starts, stops, or restarts the affected servers — no gateway restart required. Similarly, when an environment variable in the `.env` file changes, any MCP servers that depend on it are automatically restarted. Note that `skillsDir` changes are not hot-reloaded and require a gateway restart.

Version hashes (`mcpVersion` and `skillsVersion`) are content-based (SHA-256,
16 hex chars). The same content produces the same hash across restarts, so the
service can distinguish real catalog changes from gateway restarts.

An MCP server that fails to start, for example because of an invalid command or
unreachable URL, is logged and skipped. The gateway still connects and serves
healthy servers and skills, so one misconfigured server does not make the
gateway unavailable.

### What clients should do

Services using the client libraries (TypeScript or Python) receive `onGatewayConnected` after the initial pull completes (integrations are already populated). When the gateway sends `version_changed`, the client auto-pulls what changed and fires `onGatewayUpdated`.

Services can also explicitly pull at any time using `getVersions()`, `getTools()`, or `getSkills()` on a specific gateway. Both client libraries expose the same optional hooks for observability: `getTraceContext` / `get_trace_context` propagates a W3C trace context onto each tool call, and `onSocketError` / `on_socket_error` surfaces socket-level and unexpected connection-handler failures (the libraries never write to the console themselves).

## Telemetry & Audit

The gateway can emit OpenTelemetry traces and metrics to a customer-controlled OTLP/HTTP endpoint. It also records audit metadata for transparency: tool calls (integration, tool, request id, outcome, duration), outbound messages to Journal (message type and request id), config/env reloads, and MCP process start/stop. No secrets, tool arguments, or payload bodies are recorded.

### Enabling telemetry

Telemetry is off unless an OTLP endpoint is provided.

| Variable | Default | Description |
|----------|---------|-------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | OTLP/HTTP endpoint (e.g., `https://otel.example.com`) to enable traces/metrics |
| `OTEL_SERVICE_NAME` | `journal-gateway` | Service name reported in telemetry |
| `TELEMETRY_DISABLED` | `false` | Set to `true` to force-disable telemetry |
| `AUDIT_LOG_FILE` | — | Path to a local JSONL audit file (metadata only) |
| `AUDIT_MAX_BYTES` | — | Rotate audit file when it exceeds this size (bytes) |
| `AUDIT_MAX_FILES` | — | Number of rotated audit files to keep |

Example:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.example.com \
OTEL_SERVICE_NAME=journal-gateway-prod \
AUDIT_LOG_FILE=/var/log/journal-gateway-audit.log \
JOURNAL_GATEWAY_TOKEN=gw_your_token \
JOURNAL_GATEWAY_CONFIG=/etc/journal/gateway.json \
journal-gateway --config /etc/journal/gateway.json
```

## License

MIT
