# @journal/gateway

Connect your tools to the [Journal](https://journal.one) agent via the Journal Gateway.

The gateway connects outbound from your network to the Journal service over WebSocket. Your credentials and data sources never leave your network.

## Install

```bash
npm install -g @journal/gateway
```

## Usage

```bash
JOURNAL_GATEWAY_TOKEN=gw_your_token journal-gateway --config gateway.json
```

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JOURNAL_GATEWAY_TOKEN` | yes | — | Gateway auth token (`gw_*`) |
| `JOURNAL_GATEWAY_URL` | no | `wss://gateway.journal.one/v1` | WebSocket endpoint |
| `JOURNAL_GATEWAY_CONFIG` | no | — | Path to config file, or inline JSON |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, `error` |

The gateway reads its tool and skill definitions from a JSON config file. Pass it via `--config path/to/file.json` or the `JOURNAL_GATEWAY_CONFIG` env var.

## Documentation

See the full documentation at [github.com/journal/journal-edge](https://github.com/journal/journal-edge).
