# Journal Gateway

Connect your tools to the [Journal](https://journal.one) agent. Deploy a gateway that connects your data sources (databases, observability platforms, etc.) to Journal over an outbound WebSocket. Your credentials never leave your network.

## Quick Start

### npm

```bash
npm install -g @journal/mcp

JOURNAL_GATEWAY_TOKEN=gw_your_token \
  INTEGRATIONS=postgresql \
  DATABASE_URL=postgresql://localhost:5432/mydb \
  journal-gateway
```

### Docker

```bash
docker run -e JOURNAL_GATEWAY_TOKEN=gw_your_token \
  -e INTEGRATIONS=postgresql \
  -e DATABASE_URL=postgresql://localhost:5432/mydb \
  ghcr.io/journal/gateway
```

## Configuration

All configuration is via environment variables.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JOURNAL_GATEWAY_TOKEN` | yes | — | Gateway auth token (starts with `gw_`) |
| `JOURNAL_GATEWAY_URL` | no | `wss://gateway.journal.one/v1` | WebSocket endpoint |
| `INTEGRATIONS` | no* | — | Comma-separated integration IDs to enable |
| `SKILLS_DIR` | no* | — | Path to directory containing skill files |
| `LOG_LEVEL` | no | `info` | Log level: `debug`, `info`, `warn`, `error` |

*At least one of `INTEGRATIONS` or `SKILLS_DIR` must be set.

## Available Integrations

No built-in integrations are included yet. See `packages/mcp/src/integrations/` to add new ones.

## Packaging

```bash
# Docker
docker build -f packaging/docker/Dockerfile -t journal-gateway .

# npm publish
./packaging/npm/publish.sh

# Docker publish
./packaging/docker/publish.sh
```

## Skills

Skills are prompt/workflow templates that guide agent behavior. Place Markdown files with YAML front matter in a directory and point `SKILLS_DIR` at it:

```bash
JOURNAL_GATEWAY_TOKEN=gw_your_token \
  SKILLS_DIR=/opt/journal/skills \
  journal-gateway
```

See [spec/skills.md](./spec/skills.md) for the full specification.

## Architecture

```
packages/
  types/     # Protocol types (Zod schemas) — stable
  gateway/   # Core connection library (IntegrationProvider) — stable
  skills/    # Skill loading from Markdown files
  mcp/       # MCP integration provider + CLI entry point
```

The gateway core (`packages/gateway/`) is a stable, minimal library that handles WebSocket connections and tool routing via a generic `IntegrationProvider` interface. Integration is the umbrella concept — each integration can carry tools, skills, or both. The MCP implementation (`packages/mcp/`) provides the concrete integration by spawning MCP server subprocesses and composing skill integrations from the skill loader.

```
┌─────────────────────────────────────┐
│           Your Network              │
│                                     │
│  ┌──────────┐    ┌───────────────┐  │
│  │ Database │◄──│               │  │
│  └──────────┘    │   Gateway    │  │
│  ┌──────────┐    │  (this repo) │  │
│  │  Sentry  │◄──│               │  │
│  └──────────┘    └───────┬───────┘  │
│                          │ outbound │
└──────────────────────────┼──────────┘
                           │ wss://
                    ┌──────▼───────┐
                    │   Journal    │
                    │   Service    │
                    └──────────────┘
```

## Protocol

The gateway communicates with Journal over WebSocket using a simple JSON protocol. See [spec/protocol.md](./spec/protocol.md) for the full specification, [spec/integrations.md](./spec/integrations.md) for integrations, and [spec/skills.md](./spec/skills.md) for skills.

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Type check
pnpm typecheck

# Run tests
pnpm test
```

## License

MIT
