// End-to-end driver: real client server + real gateway + real Toolbox MCP
// server + real database. No mocks.
//
//   node driver.mjs <configPath> <envFilePath> <integrationId> <readSql> <writeSql> <expectedCountsJson>
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
const expectedCountsJson = process.argv[7];
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

function parseExpectedCounts(raw) {
  if (!raw) {
    throw new Error("missing expectedCountsJson argument");
  }
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("expectedCountsJson must be an object");
  }
  return parsed;
}

function parseRows(result) {
  const rows = [];
  for (const block of result.content ?? []) {
    if (block.type !== "text") continue;
    try {
      const parsed = JSON.parse(block.text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        rows.push(parsed);
      }
    } catch {
      // Ignore non-JSON text blocks. Toolbox returns one JSON text block per row.
    }
  }
  return rows;
}

function assertExpectedCounts(rows, expectedCounts) {
  for (const [name, expected] of Object.entries(expectedCounts)) {
    const row = rows.find((r) => r.name === name);
    const actual = row ? Number(row.n) : NaN;
    if (actual !== expected) {
      fail(`expected ${name} count ${expected}, got ${row ? row.n : "missing"}`);
    }
  }
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
  const expectedCounts = parseExpectedCounts(expectedCountsJson);

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
  for (const intg of withTools.integrations) {
    log(`  - ${intg.id} (${intg.name}): ${intg.tools.length} tools`);
    for (const t of intg.tools) {
      log(`      • ${t.name}: ${t.description ?? ""}`);
    }
  }
  const requestedIntegration = withTools.integrations.find(
    (intg) => intg.id === integrationId
  );
  const execTool = requestedIntegration?.tools.find((t) => t.name === "execute_sql");
  if (execTool)
    log("execute_sql inputSchema:", JSON.stringify(execTool.inputSchema));

  if (!execTool) {
    fail(`no execute_sql tool was published for integration ${integrationId}`);
  } else {
    // READ
    log(`calling ${integrationId}.execute_sql (read): ${readSql}`);
    const readRes = await server.callTool(integrationId, "execute_sql", {
      sql: readSql,
    });
    log("read result isError:", readRes.isError === true);
    log("read result content:", JSON.stringify(readRes.content));
    if (readRes.isError) fail("read query returned isError=true");
    const rows = parseRows(readRes);
    assertExpectedCounts(rows, expectedCounts);

    // WRITE (must be rejected by the read-only DB account)
    log(`calling ${integrationId}.execute_sql (write): ${writeSql}`);
    const writeRes = await server.callTool(integrationId, "execute_sql", {
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
