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
| `INTEGRATIONS` | yes | — | Comma-separated integration IDs to enable |
| `LOG_LEVEL` | no | `info` | Log level: `debug`, `info`, `warn`, `error` |

## Available Integrations

No built-in integrations are included yet. See `packages/mcp/src/integrations/` to add new ones.

## Architecture

```
packages/
  types/     # Protocol types (Zod schemas) — stable
  gateway/   # Core connection library (IntegrationProvider interface) — stable
  mcp/       # MCP integration provider + CLI entry point
```

The gateway core (`packages/gateway/`) is a stable, minimal library that handles WebSocket connections and tool routing via a generic `IntegrationProvider` interface. The MCP implementation (`packages/mcp/`) provides the concrete integration by spawning MCP server subprocesses.

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

The gateway communicates with Journal over WebSocket using a simple JSON protocol. See [protocol/README.md](./protocol/README.md) for the full specification.

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
