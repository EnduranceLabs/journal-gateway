# Integration Examples

Customer-ready starting points for exposing common MCP integrations through
Journal Gateway.

Use these examples as templates. Keep credentials in environment variables or an
env file loaded with `journal-gateway --env-file`; do not commit credentials to
gateway config files.

The integration examples intentionally do not add dependencies to this
workspace's published npm packages. Example configs either point to remote MCP
servers or reference external packages with commands such as `npx -y`.

## Contents

| Path | What it is |
|------|------------|
| [`database/`](./database) | SQL database examples using Google MCP Toolbox for Databases. |
| [`common-mcp-servers.md`](./common-mcp-servers.md) | Curated list of reputable public MCP servers for enterprise integrations. |

## Selection Criteria

The examples and catalog favor MCP servers that are:

- published or maintained by the product vendor, cloud provider, or MCP steering
  group;
- actively documented for MCP usage;
- compatible with local stdio or remote Streamable HTTP/SSE transports that the
  gateway can reach;
- practical for enterprise review, with clear authentication and permission
  boundaries.

Avoid deploying unreviewed community MCP servers against production systems.
When a vendor-maintained server supports broad write/admin tools, restrict it
with the least-privilege credentials or toolsets your use case actually needs.

## Adapting Configs

For local MCP servers, use `transport: "stdio"` or omit `transport` and provide
`command`, `args`, and `envVars`. In gateway configs, `envVars` maps host
environment variable names to subprocess environment variable names:

```json
{ "HOST_ENV_VAR": "MCP_SERVER_ENV_VAR" }
```

For remote MCP servers, use `transport: "streamable-http"` or `"sse"` and map
headers to host environment variables:

```json
{
  "id": "vendor-api",
  "transport": "streamable-http",
  "url": "https://vendor.example.com/mcp",
  "headers": {
    "Authorization": "VENDOR_MCP_AUTHORIZATION"
  }
}
```

Set `VENDOR_MCP_AUTHORIZATION` to the complete header value expected by the MCP
server, for example `Bearer <token>`.

Some hosted MCP servers require an interactive OAuth flow or client-specific
connector setup. Those are included in the catalog for awareness, but they may
not be directly usable through Journal Gateway until the vendor provides a
non-interactive token/header path that can run in a server environment.
