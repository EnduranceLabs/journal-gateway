# Examples

Runnable starting points for the two sides of the Journal Gateway protocol.

| File | What it is |
|------|-----------|
| [`gateway.json`](./gateway.json) | Sample gateway config (stdio + streamable-http servers, a skills dir). The `$schema` line gives you autocomplete and validation in editors like VS Code. |
| [`client-server.ts`](./client-server.ts) | Minimal service-side server using `@journal.one/gateway-client`. |
| [`client_server.py`](./client_server.py) | The same, using `journal-gateway-client`. |

## Try it end to end

1. **Start a client server** (the service side that gateways connect to):

   ```bash
   # TypeScript
   npm install @journal.one/gateway-client
   npx tsx client-server.ts

   # or Python
   pip install journal-gateway-client
   python client_server.py
   ```

   Both listen on `ws://localhost:8080` and accept the token `gw_demo`.

2. **Run a gateway** pointed at it. Edit `gateway.json` for your own MCP servers
   (or trim it to `{}` to connect with nothing to offer), then:

   ```bash
   npm install -g @journal.one/gateway

   JOURNAL_GATEWAY_TOKEN=gw_demo \
   JOURNAL_GATEWAY_URL=ws://localhost:8080 \
   journal-gateway --config gateway.json
   ```

The client server prints each gateway as it connects along with the tools it exposes.

See the [root README](../README.md) for the full configuration and protocol reference.
