# journal-gateway-client

TypeScript service-side library for the Journal Gateway protocol. Use this
package in the service that accepts gateway WebSocket connections, validates
gateway tokens, receives tool and skill catalogs, and calls tools on connected
gateways.

If you want to run the customer-side gateway process, install
`journal-gateway` instead.

## Install

Requires Node.js 22 or newer.

```bash
npm install journal-gateway-client
```

## Quick Start

```ts
import { GatewayServer } from "journal-gateway-client";

const server = new GatewayServer({
  port: 8080,
  validateToken: async (token) => {
    if (token === process.env.JOURNAL_GATEWAY_TOKEN) {
      return { organizationId: "org_123" };
    }
    return null;
  },
});

server.onGatewayConnected = (gateway) => {
  console.info("gateway connected", {
    gatewayId: gateway.id,
    organizationId: gateway.organizationId,
    integrations: gateway.integrations.length,
  });
};

server.onGatewayUpdated = (gateway) => {
  console.info("gateway catalog updated", { gatewayId: gateway.id });
};

server.onGatewayDisconnected = (gateway, closeCode, closeReason) => {
  console.info("gateway disconnected", {
    gatewayId: gateway.id,
    closeCode,
    closeReason,
  });
};

await server.start();

// After a gateway for org_123 connects and publishes the postgresql integration:
const result = await server.callToolForOrg(
  "org_123",
  "postgresql",
  "execute_sql",
  { sql: "SELECT 1" },
);
```

The library never writes logs or metrics by itself. Route callbacks into your
own logger, metrics, and tracing stack.

## Key APIs

- `start()` / `stop()`: start or stop the built-in WebSocket server.
- `startHeartbeat()` / `handleConnection(ws)`: use your own HTTP/WebSocket
  server and pass accepted sockets to the client library.
- `callTool(integrationId, toolName, args, timeoutMs?)`: call a tool on any
  connected gateway that exposes the integration.
- `callToolForOrg(orgId, integrationId, toolName, args, timeoutMs?)`: call a
  tool for one organization, with candidate gateway selection and retry on
  connection-level failure.
- `getToolsForOrg(orgId)`: list deduplicated tools for an organization.
- `connectedGateways`: inspect currently connected gateways.

## Callbacks

- `onGatewayConnected(gateway)`: fired after authentication and initial catalog
  pull.
- `onGatewayUpdated(gateway)`: fired when MCP tools or skills change.
- `onGatewayDisconnected(gateway, closeCode?, closeReason?)`: fired after a
  connected gateway disconnects.
- `onSocketError(error, gateway | null)`: optional constructor callback for
  socket-level errors such as connection resets.

## Trace Propagation

Pass `getTraceContext` when you want Journal Gateway tool execution to attach to
your active distributed trace:

```ts
import { context, propagation } from "@opentelemetry/api";

const server = new GatewayServer({
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

`getTraceContext` is called for each tool call. The returned W3C trace context is
sent to the gateway and used as the parent for remote tool execution spans.

## More Documentation

- [Full README](https://github.com/EnduranceLabs/journal-gateway#readme)
- [Protocol spec](https://github.com/EnduranceLabs/journal-gateway/blob/main/spec/protocol.md)
- [Gateway package](https://www.npmjs.com/package/journal-gateway)

## License

MIT
