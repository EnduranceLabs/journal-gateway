# Journal Gateway

Connect your data sources to [Journal](https://journal.one). The gateway runs inside your network and connects outbound to Journal — your credentials never leave your infrastructure and you don't need to open any inbound ports.

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
npm install -g @journal/gateway

JOURNAL_GATEWAY_TOKEN=gw_your_token journal-gateway --config gateway.json
```

### Docker

```bash
docker run -e JOURNAL_GATEWAY_TOKEN=gw_your_token \
  -v ./gateway.json:/etc/journal/gateway.json \
  ghcr.io/journal/gateway --config /etc/journal/gateway.json
```

### Example config file (`gateway.json`)

```json
{
  "mcpServers": [
    {
      "id": "postgresql",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "name": "PostgreSQL",
      "description": "Query databases",
      "envVars": { "DATABASE_URL": "DATABASE_URL" }
    }
  ],
  "skillsDir": "/opt/journal/skills"
}
```

## Configuration

### Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JOURNAL_GATEWAY_TOKEN` | yes | — | Auth token from Journal (starts with `gw_`) |
| `JOURNAL_GATEWAY_URL` | no | `wss://gateway.journal.one/v1` | Journal endpoint |
| `JOURNAL_GATEWAY_CONFIG` | no | — | Path to config file, or inline JSON (detected by leading `{`) |
| `LOG_LEVEL` | no | `info` | Log level: `debug`, `info`, `warn`, `error` |

### Config file

The config file describes what the gateway offers. Point to it with either:

1. **`--config /path/to/gateway.json`** — CLI argument (highest precedence)
2. **`JOURNAL_GATEWAY_CONFIG`** — env var containing a file path or inline JSON

Both `mcpServers` and `skillsDir` are optional. An empty `{}` is valid — the gateway will connect but won't have anything to offer.

#### Config file schema

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mcpServers` | array | `[]` | MCP server definitions (see below) |
| `skillsDir` | string | `null` | Path to directory containing skill Markdown files |

#### MCP servers

[MCP (Model Context Protocol)](https://modelcontextprotocol.io/) is a standard for connecting AI agents to external tools. The gateway runs MCP servers as subprocesses, making their tools available to Journal.

Each entry in `mcpServers`:

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Unique name for this server |
| `command` | yes | Command to run (e.g. `npx`, `python`) |
| `args` | no | Command-line arguments |
| `name` | no | Display name (defaults to `id`) |
| `description` | no | What this server does |
| `envVars` | no | Map of env var names to resolve from the host environment and pass to the server |

#### Skills

Skills are instructions that teach Journal how to perform specific tasks in your environment. Place Markdown files in a directory and set `skillsDir` in the config file. Each `.md` file becomes a skill — the filename is used as the skill name.

## Protocol

The gateway communicates with Journal over a WebSocket using a simple JSON protocol. The full specification is in [spec/protocol.md](./spec/protocol.md); this section covers the key ideas.

### Connection flow

The gateway connects **outbound** to the Journal service — no inbound ports are needed. After authenticating with a token, it sends a **register** message declaring all available tools and skills. The service can then invoke tools via the gateway at any time.

### Change detection

Tools and skills can change while the gateway is running. An MCP server might restart with different tools, or a skill file might be added to disk. The gateway detects these changes automatically and pushes a **`registrations_changed`** message to the service with the updated integrations. No polling or manual refresh is needed.

Each registration includes content-based version hashes (`mcpVersion` and `skillsVersion`) so the service can tell at a glance which subsystem changed — or whether anything changed at all. These are informational; the integrations array is always the source of truth.

### What clients should do

Services using the client libraries (TypeScript or Python) should handle `registrations_changed` the same way they handle a re-register: replace the stored integrations for that gateway and notify any listeners. The `onGatewayUpdated` callback fires in both cases. The version fields on `ConnectedGateway` (`mcpVersion` / `skillsVersion`) are available for inspection but don't require special handling.

The service can also **pull** updates at any time by sending `refresh_registrations`, which asks the gateway to re-send its current state.

## License

MIT
