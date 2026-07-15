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
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "name": "PostgreSQL",
      "envVars": { "DATABASE_URL": "DATABASE_URL" }
    }
  ]
}
```

Run the gateway:

```bash
JOURNAL_GATEWAY_TOKEN=gw_your_token journal-gateway --config gateway.json
```

The gateway authenticates, announces its tools, and waits for requests from Journal. MCP servers are started on demand and their tools are made available automatically.

The gateway watches the config file and `.env` file for changes at runtime — add, remove, or modify MCP servers without restarting.

Startup is resilient: if one MCP server fails to start (bad command, unreachable URL), it is logged and skipped — the gateway still connects and serves the healthy servers and skills.

Run `journal-gateway --help` for all flags (`--config`, `--env-file`, `--version`), or see the sample config and client examples in [`examples/`](https://github.com/EnduranceLabs/journal-edge/tree/main/examples). A JSON Schema for the config file is published at [`spec/gateway-config.schema.json`](https://github.com/EnduranceLabs/journal-edge/blob/main/spec/gateway-config.schema.json) — reference it with `$schema` for editor autocomplete.

## Transports

MCP servers can connect via three transports:

- **`stdio`** (default) — local subprocess (`command` + `args`)
- **`sse`** — legacy SSE-based remote servers
- **`streamable-http`** — current MCP spec recommendation for remote servers

## Full documentation

See the [root README](https://github.com/EnduranceLabs/journal-edge#readme) for the complete configuration reference, environment variables, protocol details, and Docker usage.

## License

MIT
