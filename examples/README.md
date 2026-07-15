# Examples

Runnable starting points for the two sides of the Journal Gateway protocol.

| File | What it is |
|------|-----------|
| [`gateway.json`](./gateway.json) | Sample gateway config (stdio + streamable-http servers, a skills dir). The `$schema` line gives you autocomplete and validation in editors like VS Code. |
| [`gateway.env.example`](./gateway.env.example) | Environment variables required by `gateway.json`. |
| [`integrations/`](./integrations) | Customer-facing MCP integration examples, including SQL database configs and a curated enterprise MCP server catalog. |
| [`client-server.ts`](./client-server.ts) | Minimal service-side server using `journal-gateway-client`. |
| [`client_server.py`](./client_server.py) | The same, using `journal-gateway-client`. |

## Try it end to end

1. **Start a client server** (the service side that gateways connect to):

   ```bash
   # TypeScript
   npm install journal-gateway-client
   npx tsx client-server.ts

   # or Python
   pip install journal-gateway-client
   python client_server.py
   ```

   Both listen on `ws://localhost:8080` and accept the token `gw_demo`.

2. **Run a gateway** pointed at it. Copy `gateway.env.example` to `.env`, edit the
   database/API values for your environment, then:

   ```bash
   npm install -g journal-gateway

   journal-gateway --env-file .env --config gateway.json
   ```

   If you only want to test the connection lifecycle, trim `gateway.json` to `{}`
   and keep only `JOURNAL_GATEWAY_TOKEN` and `JOURNAL_GATEWAY_URL` in `.env`.
   With placeholder database/API values, the gateway still connects, but those
   MCP servers are skipped and expose no tools until you provide real values.

The client server prints each gateway as it connects along with the tools it exposes.

See the [root README](../README.md) for the full configuration and protocol reference.
For database deployments, start with the [database integration guide](./integrations/database/README.md).
