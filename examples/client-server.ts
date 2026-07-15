// Minimal Journal Gateway client server (TypeScript).
//
//   npm install journal-gateway-client
//   npx tsx client-server.ts
//
// Then point a gateway at ws://localhost:8080 with token "gw_demo":
//   JOURNAL_GATEWAY_TOKEN=gw_demo \
//   JOURNAL_GATEWAY_URL=ws://localhost:8080 \
//   journal-gateway --config gateway.json

import { GatewayServer } from "journal-gateway-client";

const server = new GatewayServer({
  port: 8080,
  validateToken: async (token) =>
    token === "gw_demo" ? { organizationId: "org_demo" } : null,
});

server.onGatewayConnected = (gateway) => {
  console.log(`gateway ${gateway.id} connected`);
  for (const integration of gateway.integrations) {
    console.log(`  ${integration.id}: ${integration.tools.length} tools`);
  }
};

server.onGatewayDisconnected = (gateway) => {
  console.log(`gateway ${gateway.id} disconnected`);
};

await server.start();
console.log("listening on ws://localhost:8080");
