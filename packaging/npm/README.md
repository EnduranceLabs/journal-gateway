# @journal/gateway

Connect your tools to the [Journal](https://journal.one) agent via the Journal Gateway.

The gateway connects outbound from your network to the Journal service over WebSocket. Your credentials and data sources never leave your network.

## Install

```bash
npm install -g @journal/gateway
```

## Usage

```bash
JOURNAL_GATEWAY_TOKEN=gw_your_token \
  SKILLS_DIR=/opt/journal/skills \
  journal-gateway
```

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JOURNAL_GATEWAY_TOKEN` | yes | — | Gateway auth token (`gw_*`) |
| `JOURNAL_GATEWAY_URL` | no | `wss://gateway.journal.one/v1` | WebSocket endpoint |
| `MCP_SERVERS` | no* | — | JSON array of MCP server configs |
| `SKILLS_DIR` | no* | — | Path to skills directory |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, `error` |

*At least one of `MCP_SERVERS` or `SKILLS_DIR` must be set.

## Documentation

See the full documentation at [github.com/journal/journal-edge](https://github.com/journal/journal-edge).
