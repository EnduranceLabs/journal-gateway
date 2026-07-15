# @journal.one/gateway

The Journal Gateway connects MCP servers and skills running in your network to [Journal](https://journal.one). It connects outbound — your credentials never leave your infrastructure and you don't need to open any inbound ports.

## Install

```bash
npm install -g @journal.one/gateway
```

## Quick start

Create a config file (`gateway.json`):

```json
{
  "mcpServers": [
    {
      "id": "postgresql",
      "command": "npx",
      "args": ["-y", "@toolbox-sdk/server", "--prebuilt", "postgres", "--stdio"],
      "name": "PostgreSQL",
      "envVars": {
        "POSTGRES_HOST": "POSTGRES_HOST",
        "POSTGRES_PORT": "POSTGRES_PORT",
        "POSTGRES_DATABASE": "POSTGRES_DATABASE",
        "POSTGRES_USER": "POSTGRES_USER",
        "POSTGRES_PASSWORD": "POSTGRES_PASSWORD"
      }
    }
  ]
}
```

MCP server packages in examples are external runtime commands. They are resolved
by `npx` when the gateway starts and are not bundled with, or installed by,
`@journal.one/gateway`.

Run the gateway:

```bash
JOURNAL_GATEWAY_TOKEN=gw_your_token \
POSTGRES_HOST=db.internal.example.com \
POSTGRES_PORT=5432 \
POSTGRES_DATABASE=analytics \
POSTGRES_USER=journal_gateway_ro \
POSTGRES_PASSWORD='replace-me' \
journal-gateway --config gateway.json
```

The gateway authenticates, announces its tools, and waits for requests from Journal. MCP servers are started on demand and their tools are made available automatically.

The gateway watches the config file and `.env` file for changes at runtime — add, remove, or modify MCP servers without restarting.

Startup is resilient: if one MCP server fails to start (bad command, unreachable URL), it is logged and skipped — the gateway still connects and serves the healthy servers and skills.

Run `journal-gateway --help` for all flags (`--config`, `--env-file`, `--version`), or see the sample config, client examples, and integration examples in [`examples/`](https://github.com/EnduranceLabs/journal-gateway/tree/main/examples). A JSON Schema for the config file is published at [`spec/gateway-config.schema.json`](https://github.com/EnduranceLabs/journal-gateway/blob/main/spec/gateway-config.schema.json) — reference it with `$schema` for editor autocomplete.

## Transports

MCP servers can connect via three transports:

- **`stdio`** (default) — local subprocess (`command` + `args`)
- **`sse`** — legacy SSE-based remote servers
- **`streamable-http`** — current MCP spec recommendation for remote servers

## Full documentation

See the [root README](https://github.com/EnduranceLabs/journal-gateway#readme) for the complete configuration reference, environment variables, protocol details, and Docker usage.

## License

MIT
