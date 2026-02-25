# @journal.one/gateway-client

TypeScript client library for the Journal Gateway protocol. Runs a WebSocket server that gateways connect to, authenticates them, auto-pulls their tools and skills, and lets you call tools.

## Install

```bash
npm install @journal.one/gateway-client
```

## Usage

```ts
import { GatewayServer } from "@journal.one/gateway-client";

const server = new GatewayServer({
  port: 8080,
  validateToken: async (token) => {
    // Return { organizationId } on success, null on failure
    if (token === "gw_valid") return { organizationId: "org_123" };
    return null;
  },
});

server.onGatewayConnected = (gateway) => {
  console.log("Gateway connected:", gateway.id);
  console.log("Tools:", gateway.integrations);
};

server.onGatewayUpdated = (gateway) => {
  console.log("Gateway tools/skills changed:", gateway.id);
};

server.onGatewayDisconnected = (gateway) => {
  console.log("Gateway disconnected:", gateway.id);
};

await server.start();

// Call a tool on a connected gateway
const result = await server.callTool("postgresql", "query", {
  sql: "SELECT 1",
});
```

## Key APIs

- **`start()` / `stop()`** — lifecycle
- **`callTool(integrationId, toolName, args)`** — execute a tool call on any gateway that provides the integration
- **`callToolForOrg(orgId, integrationId, toolName, args)`** — same, scoped to an organization with automatic load balancing
- **`getToolsForOrg(orgId)`** — list deduplicated tools across all gateways for an org
- **`connectedGateways`** — all currently connected gateways

## Callbacks

- **`onGatewayConnected`** — fired after a gateway authenticates and its initial tools/skills are pulled
- **`onGatewayUpdated`** — fired when a gateway's tools or skills change at runtime
- **`onGatewayDisconnected`** — fired when a gateway disconnects

## Full documentation

See the [root README](https://github.com/journal-ai/journal-edge#readme) for protocol details, gateway configuration, and architecture.

## License

MIT
