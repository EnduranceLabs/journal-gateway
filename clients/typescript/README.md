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
const result = await server.callTool("postgresql", "execute_sql", {
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
- **`onGatewayDisconnected(gateway, closeCode?, closeReason?)`** — fired when a gateway disconnects

## Telemetry

The library has no telemetry dependency of its own. Two options on
`GatewayServerOptions` let you wire it into your logging/tracing stack:

- **`getTraceContext()`** — called on every `callTool`. Return the active
  W3C trace context (`{ traceparent, tracestate? }`) and it is propagated on
  the `tool_call` message; the gateway parents its `gateway.tool_call` span
  onto it, so the remote tool execution appears in your distributed trace.
  Return `null` when there is no active span.
- **`onSocketError(error, gateway | null)`** — called when a gateway socket
  emits an `error` event (e.g. `ECONNRESET`). `gateway` is `null` if the
  socket errored before completing the handshake. The socket closes
  afterwards; if the gateway had connected, `onGatewayDisconnected` fires as
  usual (pre-handshake sockets have no gateway to disconnect). The library never
  writes to the console or anywhere else on its own — if you don't provide
  this callback, socket error details are dropped (the process is still
  protected from crashing either way), so bind it if you want visibility
  into connection-level failures.

Example wiring with OpenTelemetry and a structured logger:

```ts
import { context, propagation } from "@opentelemetry/api";

const server = new GatewayServer({
  port: 8080,
  validateToken,
  getTraceContext: () => {
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    return carrier.traceparent
      ? { traceparent: carrier.traceparent, tracestate: carrier.tracestate }
      : null;
  },
  onSocketError: (error, gateway) => {
    logger.error({ error, gatewayId: gateway?.id }, "gateway socket error");
  },
});
```

## Full documentation

See the [root README](https://github.com/EnduranceLabs/journal-gateway#readme) for protocol details, gateway configuration, and architecture.

## License

MIT
