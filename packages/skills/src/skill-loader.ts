import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import type { Skill } from "@journal-edge/types";
import type { SkillProvider } from "@journal/gateway";

export class SkillLoader implements SkillProvider {
  private skills: Skill[] = [];

  constructor(
    private skillsDir: string | null,
    private logger?: { info(msg: string, meta?: Record<string, unknown>): void }
  ) {}

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

    const loaded: Skill[] = [];

    for (const file of files) {
      const filePath = join(this.skillsDir, file);
      const content = await readFile(filePath, "utf-8");
      const skill = this.parseSkillFile(file, content);
      if (skill) {
        loaded.push(skill);
      }
    }

    this.skills = loaded;
    this.logger?.info("Skills loaded", { count: loaded.length });
  }

  async getSkills(): Promise<Skill[]> {
    return this.skills;
  }

  private parseSkillFile(filename: string, content: string): Skill | null {
    const id = basename(filename, ".md");
    const frontMatter = this.parseFrontMatter(content);

    if (!frontMatter) {
      return null;
    }

    const { attributes, body } = frontMatter;

    if (!attributes.name || !attributes.description) {
      return null;
    }

    const instructions = body.trim();
    if (!instructions) {
      return null;
    }

    const skill: Skill = {
      id,
      name: attributes.name,
      description: attributes.description,
      instructions,
    };

    const tags = attributes.tags;
    const category = attributes.category;

    if (tags || category) {
      skill.metadata = {};
      if (tags) {
        skill.metadata.tags = typeof tags === "string"
          ? tags.split(",").map((t: string) => t.trim()).filter(Boolean)
          : Array.isArray(tags) ? tags : undefined;
      }
      if (category) {
        skill.metadata.category = category;
      }
    }

    return skill;
  }

  private parseFrontMatter(
    content: string
  ): { attributes: Record<string, string>; body: string } | null {
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) {
      return null;
    }

    const [, yamlBlock, body] = match;
    const attributes: Record<string, string> = {};

    for (const line of yamlBlock.split("\n")) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      if (key && value) {
        attributes[key] = value;
      }
    }

    return { attributes, body };
  }
}
