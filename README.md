# Journal Gateway

Connect your tools to the [Journal](https://journal.one) agent. Deploy a gateway that connects your data sources (databases, observability platforms, etc.) to Journal over an outbound WebSocket. Your credentials never leave your network.

## How It Works

```
+-------------------------------------+
|           Your Network              |
|                                     |
|  +----------+    +---------------+  |
|  | Database |<---+               |  |
|  +----------+    |   Gateway     |  |
|  +----------+    |  (this repo)  |  |
|  |  Sentry  |<---+               |  |
|  +----------+    +-------+-------+  |
|                          | outbound |
+--------------------------+----------+
                           | wss://
                    +------v-------+
                    |   Journal    |
                    |   Service    |
                    +--------------+
```

## Quick Start

### npm

```bash
npm install -g @journal/gateway

JOURNAL_GATEWAY_TOKEN=gw_your_token \
  SKILLS_DIR=/opt/journal/skills \
  journal-gateway
```

### Docker

```bash
docker run -e JOURNAL_GATEWAY_TOKEN=gw_your_token \
  -e SKILLS_DIR=/opt/journal/skills \
  ghcr.io/journal/gateway
```

## Configuration

All configuration is via environment variables.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JOURNAL_GATEWAY_TOKEN` | yes | — | Gateway auth token (starts with `gw_`) |
| `JOURNAL_GATEWAY_URL` | no | `wss://gateway.journal.one/v1` | WebSocket endpoint |
| `MCP_SERVERS` | no* | — | JSON array of MCP server configs |
| `SKILLS_DIR` | no* | — | Path to directory containing skill files |
| `LOG_LEVEL` | no | `info` | Log level: `debug`, `info`, `warn`, `error` |

*At least one of `MCP_SERVERS` or `SKILLS_DIR` must be set.

### MCP Server Configuration

MCP servers are configured via the `MCP_SERVERS` environment variable as a JSON array:

```bash
JOURNAL_GATEWAY_TOKEN=gw_your_token \
  MCP_SERVERS='[{"id":"postgresql","command":"npx","args":["-y","@modelcontextprotocol/server-postgres"],"name":"PostgreSQL","description":"Query databases","envVars":{"DATABASE_URL":"DATABASE_URL"}}]' \
  DATABASE_URL=postgresql://localhost:5432/mydb \
  journal-gateway
```

Each server object:

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Unique identifier (used as `integrationId` in tool calls) |
| `command` | yes | Executable to spawn (e.g. `npx`, `python`) |
| `args` | no | Command-line arguments |
| `name` | no | Display name (defaults to `id`) |
| `description` | no | What this integration does |
| `envVars` | no | Mapping from gateway env var to subprocess env var |

## Skills

Skills are prompt/workflow templates that guide agent behavior. Place Markdown files in a directory and point `SKILLS_DIR` at it:

```bash
JOURNAL_GATEWAY_TOKEN=gw_your_token \
  SKILLS_DIR=/opt/journal/skills \
  journal-gateway
```

Each `.md` file becomes a skill with `id` derived from the filename and `content` as the raw file contents.

## License

MIT
