import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SkillClient } from "../skill-client.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "skills-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("SkillClient", () => {
  it("loads skills from a directory", async () => {
    await writeFile(
      join(tempDir, "review-pr.md"),
      "You are reviewing a pull request. Follow these steps..."
    );

    const client = new SkillClient(tempDir);
    await client.load();
    const integrations = client.getIntegrations();

    expect(integrations).toHaveLength(1);
    expect(integrations[0].id).toBe("skills");
    expect(integrations[0].tools).toEqual([]);
    const skills = integrations[0].skills!;
    expect(skills).toHaveLength(1);
    expect(skills[0].id).toBe("review-pr");
    expect(skills[0].content).toBe(
      "You are reviewing a pull request. Follow these steps..."
    );
  });

  it("loads multiple skills", async () => {
    await writeFile(join(tempDir, "skill-a.md"), "Instructions for A.");
    await writeFile(join(tempDir, "skill-b.md"), "Instructions for B.");

    const client = new SkillClient(tempDir);
    await client.load();
    const integrations = client.getIntegrations();

    expect(integrations).toHaveLength(1);
    const skills = integrations[0].skills!;
    expect(skills).toHaveLength(2);
    const ids = skills.map((s) => s.id).sort();
    expect(ids).toEqual(["skill-a", "skill-b"]);
  });

  it("returns empty array for null skillsDir", async () => {
    const client = new SkillClient(null);
    await client.load();
    const integrations = client.getIntegrations();
    expect(integrations).toEqual([]);
  });

  it("returns empty array for nonexistent directory", async () => {
    const client = new SkillClient("/nonexistent/path");
    await client.load();
    const integrations = client.getIntegrations();
    expect(integrations).toEqual([]);
  });

  it("returns empty array for empty directory", async () => {
    const client = new SkillClient(tempDir);
    await client.load();
    const integrations = client.getIntegrations();
    expect(integrations).toEqual([]);
  });

  it("returns raw markdown content without parsing", async () => {
    const content = `---
name: Review PR
description: Reviews a pull request
---

Follow these steps to review.`;

    await writeFile(join(tempDir, "review.md"), content);

    const client = new SkillClient(tempDir);
    await client.load();
    const integrations = client.getIntegrations();

    // Raw content — no YAML parsing, front matter included as-is
    expect(integrations[0].skills![0].content).toBe(content);
  });

  it("ignores non-markdown files", async () => {
    await writeFile(join(tempDir, "notes.txt"), "not a skill");
    await writeFile(join(tempDir, "actual-skill.md"), "Do the thing.");

    const client = new SkillClient(tempDir);
    await client.load();
    const integrations = client.getIntegrations();
    expect(integrations).toHaveLength(1);
    expect(integrations[0].skills![0].id).toBe("actual-skill");
  });

  it("skips skill files that cannot be read", async () => {
    const logger = { warn: vi.fn() };
    await writeFile(join(tempDir, "ok.md"), "Usable skill");
    await symlink(join(tempDir, "missing.md"), join(tempDir, "broken.md"));

    const client = new SkillClient(tempDir, logger);
    await client.load();
    const integrations = client.getIntegrations();

    expect(integrations).toHaveLength(1);
    expect(integrations[0].skills).toEqual([
      { id: "ok", content: "Usable skill" },
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      "Skill file load failed, skipping file",
      expect.objectContaining({ file: join(tempDir, "broken.md") })
    );
  });
});

describe("SkillClient watching", () => {
  it("emits skills_changed on .md file add", async () => {
    const client = new SkillClient(tempDir);
    await client.load();
    client.startWatching();

    const changedPromise = new Promise<void>((resolve) => {
      client.on("skills_changed", resolve);
    });

    // Add a new .md file
    await writeFile(join(tempDir, "new-skill.md"), "New skill content");

    await changedPromise;
    // After reload, the new skill should be available
    const integrations = client.getIntegrations();
    expect(integrations).toHaveLength(1);
    expect(integrations[0].skills!.some((s) => s.id === "new-skill")).toBe(true);

    client.stopWatching();
  });

  it("ignores non-.md file changes", async () => {
    const client = new SkillClient(tempDir);
    await client.load();
    client.startWatching();

    let changed = false;
    client.on("skills_changed", () => { changed = true; });

    // Add a non-.md file
    await writeFile(join(tempDir, "notes.txt"), "not a skill");

    // Wait longer than the debounce
    await new Promise((r) => setTimeout(r, 700));
    expect(changed).toBe(false);

    client.stopWatching();
  });

  it("debounces rapid changes", async () => {
    const client = new SkillClient(tempDir);
    await client.load();
    client.startWatching();

    let emitCount = 0;
    client.on("skills_changed", () => { emitCount++; });

    // Rapid writes
    await writeFile(join(tempDir, "a.md"), "A");
    await writeFile(join(tempDir, "b.md"), "B");
    await writeFile(join(tempDir, "c.md"), "C");

    // Wait for debounce to settle
    await new Promise((r) => setTimeout(r, 800));
    expect(emitCount).toBe(1);

    client.stopWatching();
  });

  it("stopWatching prevents further events", async () => {
    const client = new SkillClient(tempDir);
    await client.load();
    client.startWatching();
    client.stopWatching();

    let changed = false;
    client.on("skills_changed", () => { changed = true; });

    await writeFile(join(tempDir, "late.md"), "Too late");
    await new Promise((r) => setTimeout(r, 700));
    expect(changed).toBe(false);
  });
});
