// End-to-end driver: real client server + real gateway + real Toolbox MCP
// server + real database. No mocks.
//
//   node driver.mjs <configPath> <envFilePath> <integrationId> <readSql> <writeSql>
//
// It:
//   1. starts a GatewayServer (the Journal "service" side) on ws://127.0.0.1:8080
//   2. spawns `journal-gateway` pointed at it with the given config + env file
//   3. waits for the gateway to connect and auto-publish its MCP tools
//   4. prints the integrations + tool schemas it received
//   5. calls execute_sql with a read query (expects success + rows)
//   6. calls execute_sql with a write query (expects a read-only failure)
//
// Exit code 0 only if every assertion holds.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GatewayServer } from "../../clients/typescript/dist/server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const GATEWAY_BIN = path.join(REPO, "gateway", "dist", "main.js");

const [, , configPath, envFilePath, integrationId, readSql, writeSql] =
  process.argv;
const TOKEN = "gw_e2e";
const PORT = 8080;

const log = (...a) => console.log("[driver]", ...a);
const fail = (msg) => {
  console.error("[driver] FAIL:", msg);
  process.exitCode = 1;
};

function deadline(ms, label) {
  return new Promise((_, rej) =>
    setTimeout(() => rej(new Error(`timeout waiting for ${label}`)), ms)
  );
}

async function waitFor(check, ms, label) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = check();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timeout waiting for ${label}`);
}

const server = new GatewayServer({
  port: PORT,
  pingIntervalMs: 0,
  validateToken: async (t) =>
    t === TOKEN ? { organizationId: "org_e2e" } : null,
});

let gatewayProc;
async function cleanup() {
  try {
    gatewayProc?.kill("SIGTERM");
  } catch {}
  try {
    await server.stop();
  } catch {}
}

try {
  await server.start();
  log(`service listening on ${server.url}`);

  const connected = new Promise((resolve) => {
    server.onGatewayConnected = (gw) => resolve(gw);
  });

  gatewayProc = spawn(
    "node",
    [GATEWAY_BIN, "--env-file", envFilePath, "--config", configPath],
    { env: { ...process.env, LOG_LEVEL: "info" }, stdio: "inherit" }
  );
  gatewayProc.on("exit", (code) =>
    log(`gateway process exited with code ${code}`)
  );

  log("waiting for gateway to connect (npx may download Toolbox on first run)...");
  const gw = await Promise.race([connected, deadline(90_000, "gateway connect")]);
  log(`gateway connected: id=${gw.id}`);

  // Tools are auto-pulled after version_changed; poll until they arrive.
  const withTools = await waitFor(
    () => {
      const g = server.connectedGateways.find((c) => c.id === gw.id);
      return g && g.integrations.length > 0 ? g : null;
    },
    90_000,
    "integrations to publish"
  );

  log(`integrations (${withTools.integrations.length}):`);
  let execTool = null;
  for (const intg of withTools.integrations) {
    log(`  - ${intg.id} (${intg.name}): ${intg.tools.length} tools`);
    for (const t of intg.tools) {
      log(`      • ${t.name}: ${t.description ?? ""}`);
      if (t.name === "execute_sql") execTool = { intg: intg.id, def: t };
    }
  }
  if (execTool)
    log("execute_sql inputSchema:", JSON.stringify(execTool.def.inputSchema));

  if (!execTool) {
    fail("no execute_sql tool was published by the gateway");
  } else {
    // READ
    log(`calling ${execTool.intg}.execute_sql (read): ${readSql}`);
    const readRes = await server.callTool(execTool.intg, "execute_sql", {
      sql: readSql,
    });
    log("read result isError:", readRes.isError === true);
    log("read result content:", JSON.stringify(readRes.content));
    if (readRes.isError) fail("read query returned isError=true");

    // WRITE (must be rejected by the read-only DB account)
    log(`calling ${execTool.intg}.execute_sql (write): ${writeSql}`);
    const writeRes = await server.callTool(execTool.intg, "execute_sql", {
      sql: writeSql,
    });
    const text = JSON.stringify(writeRes.content) + " isError=" + writeRes.isError;
    log("write result:", text);
    const rejected =
      writeRes.isError === true || /read-only|denied|permission|not allowed/i.test(text);
    if (rejected) log("write correctly rejected by read-only account ✓");
    else fail("write query was NOT rejected — read-only enforcement broken");
  }
} catch (err) {
  fail(err?.stack || String(err));
} finally {
  await cleanup();
  log(process.exitCode ? "RESULT: FAIL" : "RESULT: PASS");
  process.exit(process.exitCode ?? 0);
}
