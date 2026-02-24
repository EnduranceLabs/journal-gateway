import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GatewayServer } from "@journal/gateway-client";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GATEWAY_BIN = path.resolve(__dirname, "../../../gateway/dist/main.js");

function waitForGateway(
  server: GatewayServer,
  timeoutMs = 10_000
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Gateway did not connect in time")),
      timeoutMs
    );
    server.onGatewayConnected = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

function startGateway(
  url: string,
  token: string,
  env?: Record<string, string>
): ChildProcess {
  return spawn("node", [GATEWAY_BIN], {
    env: {
      ...process.env,
      JOURNAL_GATEWAY_TOKEN: token,
      JOURNAL_GATEWAY_URL: url,
      JOURNAL_GATEWAY_CONFIG: "{}",
      LOG_LEVEL: "error",
      ...env,
    },
    stdio: "pipe",
  });
}

describe("Integration: TS client <-> real gateway", () => {
  let server: GatewayServer;
  let gateway: ChildProcess;

  beforeEach(async () => {
    server = new GatewayServer({
      validateToken: async (token) =>
        token === "gw_test" ? { organizationId: "org_1" } : null,
      pingIntervalMs: 0,
    });
    await server.start();

    const connected = waitForGateway(server);
    gateway = startGateway(server.url, "gw_test");
    await connected;
  });

  afterEach(async () => {
    gateway.kill("SIGTERM");
    await server.stop();
  });

  it("gateway registers with zero tools (no MCP servers)", () => {
    expect(server.connectedGateways).toHaveLength(1);
    expect(server.connectedGateways[0].integrations).toHaveLength(0);
  });

  it("rejects gateway with invalid token", async () => {
    const bad = startGateway(server.url, "gw_wrong");

    const code = await new Promise<number>((resolve) => {
      bad.on("exit", (c) => resolve(c ?? 1));
    });
    expect(code).not.toBe(0);
    // Original gateway should still be connected
    expect(server.connectedGateways).toHaveLength(1);
  });

  it("service requests refresh, gateway re-registers with updated tools", async () => {
    const gatewayId = server.connectedGateways[0].id;

    const updated = new Promise<void>((resolve) => {
      server.onGatewayUpdated = () => resolve();
    });

    server.requestRefreshRegistrations(gatewayId);
    await updated;

    // Gateway re-registered (same integrations but the callback fired)
    expect(server.connectedGateways).toHaveLength(1);
    expect(server.connectedGateways[0].id).toBe(gatewayId);
  });

  it("detects gateway disconnect", async () => {
    let disconnected = false;
    server.onGatewayDisconnected = () => {
      disconnected = true;
    };

    gateway.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    expect(disconnected).toBe(true);
    expect(server.connectedGateways).toHaveLength(0);
  });
});
