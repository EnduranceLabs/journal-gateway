import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConfigWatcher } from "../config-watcher.js";
import type { GatewayConfigFile } from "../config.js";

let tempDir: string;
let configPath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "config-watcher-test-"));
  configPath = join(tempDir, "gateway.json");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function writeConfig(config: object): Promise<void> {
  return writeFile(configPath, JSON.stringify(config));
}

describe("ConfigWatcher", () => {
  it("emits config_changed with parsed config on file change", async () => {
    await writeConfig({
      mcpServers: [{ id: "test", transport: "stdio", command: "echo" }],
    });

    const watcher = new ConfigWatcher(configPath);
    watcher.startWatching();

    const changedPromise = new Promise<GatewayConfigFile>((resolve) => {
      watcher.on("config_changed", resolve);
    });

    // Modify the config
    await writeConfig({
      mcpServers: [
        { id: "test", transport: "stdio", command: "echo" },
        { id: "new-server", transport: "stdio", command: "node" },
      ],
    });

    const config = await changedPromise;
    expect(config.mcpServers).toHaveLength(2);
    expect(config.mcpServers[1].id).toBe("new-server");

    watcher.stopWatching();
  });

  it("does NOT emit on parse/validation errors, logs warning", async () => {
    await writeConfig({
      mcpServers: [{ id: "test", transport: "stdio", command: "echo" }],
    });

    const watcher = new ConfigWatcher(configPath);
    watcher.startWatching();

    let emitted = false;
    watcher.on("config_changed", () => { emitted = true; });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Write invalid JSON
    await writeFile(configPath, "not json {{{");

    await new Promise((r) => setTimeout(r, 800));
    expect(emitted).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Config file reload failed")
    );

    warnSpy.mockRestore();
    watcher.stopWatching();
  });

  it("no-op when path is null", () => {
    const watcher = new ConfigWatcher(null);
    watcher.startWatching();
    watcher.stopWatching();
    // Should not throw
  });

  it("debounces rapid changes", async () => {
    await writeConfig({ mcpServers: [] });

    const watcher = new ConfigWatcher(configPath);
    watcher.startWatching();

    let emitCount = 0;
    watcher.on("config_changed", () => { emitCount++; });

    await writeConfig({ mcpServers: [{ id: "a", transport: "stdio", command: "a" }] });
    await writeConfig({ mcpServers: [{ id: "b", transport: "stdio", command: "b" }] });
    await writeConfig({ mcpServers: [{ id: "c", transport: "stdio", command: "c" }] });

    await new Promise((r) => setTimeout(r, 800));
    expect(emitCount).toBe(1);

    watcher.stopWatching();
  });

  it("stopWatching prevents further events", async () => {
    await writeConfig({ mcpServers: [] });

    const watcher = new ConfigWatcher(configPath);
    watcher.startWatching();
    watcher.stopWatching();

    let emitted = false;
    watcher.on("config_changed", () => { emitted = true; });

    await writeConfig({ mcpServers: [{ id: "late", transport: "stdio", command: "echo" }] });
    await new Promise((r) => setTimeout(r, 700));
    expect(emitted).toBe(false);
  });
});
