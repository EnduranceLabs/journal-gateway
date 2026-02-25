import { readdir, readFile } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { join, basename } from "node:path";
import { EventEmitter } from "node:events";
import type { Skill, Integration } from "@journal/gateway-protocol";

export interface SkillClientEvents {
  skills_changed: [];
}

export class SkillClient extends EventEmitter<SkillClientEvents> {
  private skills: Skill[] = [];
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private skillsDir: string | null) {
    super();
  }

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

  startWatching(): void {
    if (this.watcher || !this.skillsDir) return;

    this.watcher = watch(this.skillsDir, (eventType, filename) => {
      if (!filename || !filename.endsWith(".md")) return;

      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(async () => {
        this.debounceTimer = null;
        await this.load();
        this.emit("skills_changed");
      }, 500);
    });
  }

  stopWatching(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
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
