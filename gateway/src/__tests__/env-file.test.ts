import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EnvFile } from "../env-file.js";

let tempDir: string;
let envPath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "env-file-test-"));
  envPath = join(tempDir, ".env");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("EnvFile", () => {
  it("parses KEY=VALUE pairs", async () => {
    await writeFile(envPath, "FOO=bar\nBAZ=qux\n");
    const envFile = new EnvFile(envPath);
    const result = envFile.load();
    expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("handles comments and blank lines", async () => {
    await writeFile(envPath, "# comment\nFOO=bar\n\n# another\nBAZ=qux\n");
    const envFile = new EnvFile(envPath);
    const result = envFile.load();
    expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("handles quoted values", async () => {
    await writeFile(envPath, 'FOO="hello world"\nBAR=\'single\'\n');
    const envFile = new EnvFile(envPath);
    const result = envFile.load();
    expect(result).toEqual({ FOO: "hello world", BAR: "single" });
  });

  it("handles export prefix", async () => {
    await writeFile(envPath, "export FOO=bar\n");
    const envFile = new EnvFile(envPath);
    const result = envFile.load();
    expect(result).toEqual({ FOO: "bar" });
  });

  it("returns empty object for nonexistent file", () => {
    const envFile = new EnvFile("/nonexistent/.env");
    const result = envFile.load();
    expect(result).toEqual({});
  });

  it("returns empty object when path is null", () => {
    const envFile = new EnvFile(null);
    const result = envFile.load();
    expect(result).toEqual({});
  });
});

describe("EnvFile watching", () => {
  it("emits env_changed on file modification", async () => {
    await writeFile(envPath, "FOO=bar\n");
    const envFile = new EnvFile(envPath);
    envFile.startWatching();

    const changedPromise = new Promise<void>((resolve) => {
      envFile.on("env_changed", resolve);
    });

    await writeFile(envPath, "FOO=updated\n");
    await changedPromise;

    envFile.stopWatching();
  });

  it("debounces rapid changes", async () => {
    await writeFile(envPath, "FOO=1\n");
    const envFile = new EnvFile(envPath);
    envFile.startWatching();

    let emitCount = 0;
    envFile.on("env_changed", () => { emitCount++; });

    await writeFile(envPath, "FOO=2\n");
    await writeFile(envPath, "FOO=3\n");
    await writeFile(envPath, "FOO=4\n");

    await new Promise((r) => setTimeout(r, 800));
    expect(emitCount).toBe(1);

    envFile.stopWatching();
  });

  it("stopWatching prevents further events", async () => {
    await writeFile(envPath, "FOO=bar\n");
    const envFile = new EnvFile(envPath);
    envFile.startWatching();
    envFile.stopWatching();

    let changed = false;
    envFile.on("env_changed", () => { changed = true; });

    await writeFile(envPath, "FOO=updated\n");
    await new Promise((r) => setTimeout(r, 700));
    expect(changed).toBe(false);
  });

  it("no-op when path is null", () => {
    const envFile = new EnvFile(null);
    envFile.startWatching();
    envFile.stopWatching();
    // Should not throw
  });
});
