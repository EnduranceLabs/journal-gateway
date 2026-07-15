# journal-gateway

Journal Gateway runs inside your network and connects your MCP servers and skill
files to [Journal](https://journal.one). It opens an outbound WebSocket to
Journal, so credentials stay in your infrastructure and you do not need to open
inbound ports.

## What It Does

- Starts local MCP servers over `stdio`.
- Connects to remote MCP servers over `sse` or `streamable-http`.
- Publishes available MCP tools and local skill files to Journal.
- Watches config and env files so tools can be added or removed without a
  restart.
- Keeps running when one MCP server fails to start. The failing server is logged
  and skipped while healthy servers remain available.

## Install

Requires Node.js 22 or newer.

```bash
npm install -g journal-gateway
journal-gateway --version
```

## Quick Start

Create `gateway.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/EnduranceLabs/journal-gateway/main/spec/gateway-config.schema.json",
  "mcpServers": [
    {
      "id": "postgresql",
      "name": "PostgreSQL",
      "description": "Read-only PostgreSQL tools",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@toolbox-sdk/server", "--prebuilt", "postgres", "--stdio"],
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

Create `.env`:

```bash
JOURNAL_GATEWAY_TOKEN=gw_your_token
POSTGRES_HOST=db.internal.example.com
POSTGRES_PORT=5432
POSTGRES_DATABASE=analytics
POSTGRES_USER=journal_gateway_ro
POSTGRES_PASSWORD=replace-me
```

Run the gateway:

```bash
journal-gateway --env-file .env --config gateway.json
```

The example MCP server package is an external runtime command. It is resolved by
`npx` when the gateway starts. It is not bundled with, or installed by,
`journal-gateway`.

## Configuration

Each entry in `mcpServers` describes one integration. Supported transports:

- `stdio`: starts a local subprocess with `command` and `args`.
- `sse`: connects to a legacy remote MCP server URL.
- `streamable-http`: connects to a remote MCP server using the current MCP HTTP
  transport.

Use `envVars` to map environment variables from the gateway process into the MCP
server. Do not put credentials directly in `gateway.json`.

For database integrations, create a read-only or restricted database role before
connecting an MCP server. See the database guide for PostgreSQL, MySQL, SQL
Server, and Snowflake examples:
[examples/integrations/database](https://github.com/EnduranceLabs/journal-gateway/tree/main/examples/integrations/database).

## Skills

Set `skillsDir` in `gateway.json` to publish markdown skill files alongside MCP
tools:

```json
{
  "skillsDir": "./skills",
  "mcpServers": []
}
```

## Security Notes

- Keep gateway tokens and integration credentials in environment variables or a
  secret manager.
- Prefer read-only database users and narrow service accounts for MCP servers.
- Run the gateway close to the systems it integrates with. It only needs
  outbound network access to Journal and to the MCP servers it starts or calls.

## More Documentation

- [Full README](https://github.com/EnduranceLabs/journal-gateway#readme)
- [Example configs](https://github.com/EnduranceLabs/journal-gateway/tree/main/examples)
- [Common MCP servers](https://github.com/EnduranceLabs/journal-gateway/blob/main/examples/integrations/common-mcp-servers.md)
- [Config JSON Schema](https://github.com/EnduranceLabs/journal-gateway/blob/main/spec/gateway-config.schema.json)

## License

MIT
