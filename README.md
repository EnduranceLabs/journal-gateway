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
npm install -g @journal.one/gateway

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

The gateway communicates with Journal over a WebSocket using a simple JSON protocol (version 2). The full specification is in [spec/protocol.md](./spec/protocol.md); this section covers the key ideas.

### Connection flow

The gateway connects **outbound** to the Journal service — no inbound ports are needed. After authenticating with a token, it sends a **`version_changed`** message announcing its current version hashes. The connection is then ready — no registration handshake needed. The service decides when to fetch tools and skills by sending pull requests (`get_tools`, `get_skills`).

### Change detection

Tools and skills can change while the gateway is running. An MCP server might restart with different tools, or a skill file might be added to disk. The gateway detects these changes automatically and sends a lightweight **`version_changed`** message with updated version hashes. The service can then pull the specific data it needs.

Version hashes (`mcpVersion` and `skillsVersion`) are content-based (SHA-256, 16 hex chars). Same content produces the same hash across restarts — the service can tell at a glance whether anything actually changed.

### What clients should do

Services using the client libraries (TypeScript or Python) receive `onGatewayConnected` after the initial pull completes (integrations are already populated). When the gateway sends `version_changed`, the client auto-pulls what changed and fires `onGatewayUpdated`.

Services can also explicitly pull at any time using `getVersions()`, `getTools()`, or `getSkills()` on a specific gateway.

## License

MIT
