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
| `JOURNAL_GATEWAY_TOKEN` | yes | — | Auth token from Journal (starts with `gw_`) |
| `JOURNAL_GATEWAY_URL` | no | `wss://gateway.journal.one/v1` | Journal endpoint |
| `MCP_SERVERS` | no* | — | JSON array of [MCP](https://modelcontextprotocol.io/) server configs (see below) |
| `SKILLS_DIR` | no* | — | Path to directory containing skill files |
| `LOG_LEVEL` | no | `info` | Log level: `debug`, `info`, `warn`, `error` |

*At least one of `MCP_SERVERS` or `SKILLS_DIR` must be set.

### MCP Server Configuration

[MCP (Model Context Protocol)](https://modelcontextprotocol.io/) is a standard for connecting AI agents to external tools. The gateway can run MCP servers as subprocesses, making their tools available to Journal.

Configure MCP servers via the `MCP_SERVERS` environment variable as a JSON array:

```bash
JOURNAL_GATEWAY_TOKEN=gw_your_token \
  MCP_SERVERS='[{"id":"postgresql","command":"npx","args":["-y","@modelcontextprotocol/server-postgres"],"name":"PostgreSQL","description":"Query databases","envVars":{"DATABASE_URL":"DATABASE_URL"}}]' \
  DATABASE_URL=postgresql://localhost:5432/mydb \
  journal-gateway
```

Each server object:

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Unique name for this server |
| `command` | yes | Command to run (e.g. `npx`, `python`) |
| `args` | no | Command-line arguments |
| `name` | no | Display name (defaults to `id`) |
| `description` | no | What this server does |
| `envVars` | no | Environment variables to pass to the server |

## Skills

Skills are instructions that teach Journal how to perform specific tasks in your environment. Place Markdown files in a directory and point `SKILLS_DIR` at it:

```bash
JOURNAL_GATEWAY_TOKEN=gw_your_token \
  SKILLS_DIR=/opt/journal/skills \
  journal-gateway
```

Each `.md` file becomes a skill. The filename is used as the skill name.

## License

MIT
