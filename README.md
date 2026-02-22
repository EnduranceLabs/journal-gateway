# Journal Gateway

Connect your tools to the [Journal](https://journal.one) agent. Deploy a gateway that connects your data sources (databases, observability platforms, etc.) to Journal over an outbound WebSocket. Your credentials never leave your network.

## Quick Start

### npm

```bash
npm install -g @journal/gateway

JOURNAL_GATEWAY_TOKEN=gw_your_token \
  SKILLS=postgresql \
  DATABASE_URL=postgresql://localhost:5432/mydb \
  journal-gateway
```

### Docker

```bash
docker run -e JOURNAL_GATEWAY_TOKEN=gw_your_token \
  -e SKILLS=postgresql \
  -e DATABASE_URL=postgresql://localhost:5432/mydb \
  ghcr.io/journal/gateway
```

## Configuration

All configuration is via environment variables.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JOURNAL_GATEWAY_TOKEN` | yes | — | Gateway auth token (starts with `gw_`) |
| `JOURNAL_GATEWAY_URL` | no | `wss://gateway.journal.one/v1` | WebSocket endpoint |
| `SKILLS` | yes | — | Comma-separated skill IDs to enable |
| `LOG_LEVEL` | no | `info` | Log level: `debug`, `info`, `warn`, `error` |

## Available Skills

| Skill ID | Description | Required Env Vars |
|----------|-------------|-------------------|
| `postgresql` | Query PostgreSQL databases | `DATABASE_URL` |
| `railway` | Manage Railway services | `RAILWAY_TOKEN` |
| `sentry` | Query Sentry errors | `SENTRY_AUTH_TOKEN` |
| `langfuse` | Access Langfuse data | `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` |
| `clickhouse` | Query ClickHouse | `CLICKHOUSE_URL`, `CLICKHOUSE_USERNAME`, `CLICKHOUSE_PASSWORD` |

### Multiple Skills

```bash
JOURNAL_GATEWAY_TOKEN=gw_your_token \
  SKILLS=postgresql,sentry \
  DATABASE_URL=postgresql://localhost:5432/mydb \
  SENTRY_AUTH_TOKEN=your_sentry_token \
  journal-gateway
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

## Architecture

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

## License

MIT
