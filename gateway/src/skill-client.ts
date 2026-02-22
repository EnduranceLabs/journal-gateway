import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import type { Skill, Integration } from "./types/index.js";

export class SkillClient {
  private skills: Skill[] = [];

  constructor(private skillsDir: string | null) {}

  async load(): Promise<void> {
    if (!this.skillsDir) {
      this.skills = [];
      return;
    }

    let files: string[];
    try {
      const entries = await readdir(this.skillsDir);
      files = entries.filter((f) => f.endsWith(".md"));
    } catch {
      this.skills = [];
      return;
    }

    this.skills = await Promise.all(
      files.map(async (file) => ({
        id: basename(file, ".md"),
        content: await readFile(join(this.skillsDir!, file), "utf-8"),
      }))
    );
  }

  getIntegrations(): Integration[] {
    if (this.skills.length === 0) return [];
    return [
      {
        id: "skills",
        name: "Skills",
        description: `Loaded from ${this.skillsDir}`,
        tools: [],
        skills: this.skills,
      },
    ];
  }
}
