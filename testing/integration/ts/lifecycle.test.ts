import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GatewayServer } from "journal-gateway-client";
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

  it("gateway connects with zero tools (no MCP servers)", () => {
    expect(server.connectedGateways).toHaveLength(1);
    expect(server.connectedGateways[0].integrations).toHaveLength(0);
  });

  it("connected gateway includes version fields (null when no MCP/skills configured)", () => {
    const gw = server.connectedGateways[0];
    // With no MCP servers or skills, both should be null
    expect(gw.mcpVersion).toBeNull();
    expect(gw.skillsVersion).toBeNull();
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

  it("service can pull versions from gateway", async () => {
    const gatewayId = server.connectedGateways[0].id;
    const versions = await server.getVersions(gatewayId);
    expect(versions).toHaveProperty("mcpVersion");
    expect(versions).toHaveProperty("skillsVersion");
    // No MCP servers configured, so mcpVersion should be null
    expect(versions.mcpVersion).toBeNull();
    expect(versions.skillsVersion).toBeNull();
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
