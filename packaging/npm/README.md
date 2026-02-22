# @journal/mcp

Connect your tools to the [Journal](https://journal.one) agent via the Journal Gateway.

The gateway connects outbound from your network to the Journal service over WebSocket. Your credentials and data sources never leave your network.

## Install

```bash
npm install -g @journal/mcp
```

## Usage

```bash
JOURNAL_GATEWAY_TOKEN=gw_your_token \
  INTEGRATIONS=postgresql \
  DATABASE_URL=postgresql://localhost:5432/mydb \
  journal-gateway
```

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JOURNAL_GATEWAY_TOKEN` | yes | — | Gateway auth token (`gw_*`) |
| `JOURNAL_GATEWAY_URL` | no | `wss://gateway.journal.one/v1` | WebSocket endpoint |
| `INTEGRATIONS` | no* | — | Comma-separated integration IDs |
| `SKILLS_DIR` | no* | — | Path to skills directory |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, `error` |

*At least one of `INTEGRATIONS` or `SKILLS_DIR` must be set.

## Documentation

See the full documentation at [github.com/journal/journal-edge](https://github.com/journal/journal-edge).
