import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SkillLoader } from "../skill-loader.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "skills-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("SkillLoader", () => {
  it("loads skills from a directory", async () => {
    await writeFile(
      join(tempDir, "review-pr.md"),
      `---
name: Review PR
description: Reviews a pull request for code quality
tags: code-review, git
category: development
---

You are reviewing a pull request. Follow these steps...`
    );

    const loader = new SkillLoader(tempDir);
    await loader.load();
    const integrations = loader.getIntegrations();

    expect(integrations).toHaveLength(1);
    expect(integrations[0].id).toBe("skills");
    expect(integrations[0].tools).toEqual([]);
    const skills = integrations[0].skills!;
    expect(skills).toHaveLength(1);
    expect(skills[0].id).toBe("review-pr");
    expect(skills[0].name).toBe("Review PR");
    expect(skills[0].description).toBe("Reviews a pull request for code quality");
    expect(skills[0].instructions).toBe(
      "You are reviewing a pull request. Follow these steps..."
    );
    expect(skills[0].metadata).toEqual({
      tags: ["code-review", "git"],
      category: "development",
    });
  });

  it("loads multiple skills", async () => {
    await writeFile(
      join(tempDir, "skill-a.md"),
      `---
name: Skill A
description: First skill
---

Instructions for A.`
    );
    await writeFile(
      join(tempDir, "skill-b.md"),
      `---
name: Skill B
description: Second skill
---

Instructions for B.`
    );

    const loader = new SkillLoader(tempDir);
    await loader.load();
    const integrations = loader.getIntegrations();

    expect(integrations).toHaveLength(1);
    const skills = integrations[0].skills!;
    expect(skills).toHaveLength(2);
    const ids = skills.map((s) => s.id).sort();
    expect(ids).toEqual(["skill-a", "skill-b"]);
  });

  it("returns empty array for null skillsDir", async () => {
    const loader = new SkillLoader(null);
    await loader.load();
    const integrations = loader.getIntegrations();
    expect(integrations).toEqual([]);
  });

  it("returns empty array for nonexistent directory", async () => {
    const loader = new SkillLoader("/nonexistent/path");
    await loader.load();
    const integrations = loader.getIntegrations();
    expect(integrations).toEqual([]);
  });

  it("returns empty array for empty directory", async () => {
    const loader = new SkillLoader(tempDir);
    await loader.load();
    const integrations = loader.getIntegrations();
    expect(integrations).toEqual([]);
  });

  it("skips files without front matter", async () => {
    await writeFile(
      join(tempDir, "no-frontmatter.md"),
      "Just some plain text without YAML front matter."
    );

    const loader = new SkillLoader(tempDir);
    await loader.load();
    const integrations = loader.getIntegrations();
    expect(integrations).toEqual([]);
  });

  it("skips files missing required name", async () => {
    await writeFile(
      join(tempDir, "missing-name.md"),
      `---
description: Has description but no name
---

Some instructions.`
    );

    const loader = new SkillLoader(tempDir);
    await loader.load();
    const integrations = loader.getIntegrations();
    expect(integrations).toEqual([]);
  });

  it("skips files missing required description", async () => {
    await writeFile(
      join(tempDir, "missing-desc.md"),
      `---
name: Has Name
---

Some instructions.`
    );

    const loader = new SkillLoader(tempDir);
    await loader.load();
    const integrations = loader.getIntegrations();
    expect(integrations).toEqual([]);
  });

  it("skips files with empty body", async () => {
    await writeFile(
      join(tempDir, "empty-body.md"),
      `---
name: No Instructions
description: This skill has no body
---
`
    );

    const loader = new SkillLoader(tempDir);
    await loader.load();
    const integrations = loader.getIntegrations();
    expect(integrations).toEqual([]);
  });

  it("ignores non-markdown files", async () => {
    await writeFile(join(tempDir, "notes.txt"), "not a skill");
    await writeFile(
      join(tempDir, "actual-skill.md"),
      `---
name: Real Skill
description: A real skill
---

Do the thing.`
    );

    const loader = new SkillLoader(tempDir);
    await loader.load();
    const integrations = loader.getIntegrations();
    expect(integrations).toHaveLength(1);
    expect(integrations[0].skills![0].id).toBe("actual-skill");
  });

  it("parses metadata with category only", async () => {
    await writeFile(
      join(tempDir, "deploy.md"),
      `---
name: Deploy
description: Deploy the application
category: ops
---

Deploy it.`
    );

    const loader = new SkillLoader(tempDir);
    await loader.load();
    const integrations = loader.getIntegrations();

    expect(integrations[0].skills![0].metadata).toEqual({ category: "ops" });
  });

  it("parses metadata with tags only", async () => {
    await writeFile(
      join(tempDir, "debug.md"),
      `---
name: Debug
description: Debug an issue
tags: debugging, troubleshooting
---

Debug it.`
    );

    const loader = new SkillLoader(tempDir);
    await loader.load();
    const integrations = loader.getIntegrations();

    expect(integrations[0].skills![0].metadata).toEqual({
      tags: ["debugging", "troubleshooting"],
    });
  });

  it("skill without metadata fields has no metadata", async () => {
    await writeFile(
      join(tempDir, "simple.md"),
      `---
name: Simple
description: A simple skill
---

Just do it.`
    );

    const loader = new SkillLoader(tempDir);
    await loader.load();
    const integrations = loader.getIntegrations();

    expect(integrations[0].skills![0].metadata).toBeUndefined();
  });
});
