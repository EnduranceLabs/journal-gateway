import { readdir, readFile } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { join, basename } from "node:path";
import { EventEmitter } from "node:events";
import type { Skill, Integration } from "journal-gateway-protocol";
import type { Logger } from "./common/logger.js";

export interface SkillClientEvents {
  skills_changed: [];
}

export class SkillClient extends EventEmitter<SkillClientEvents> {
  private skills: Skill[] = [];
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private skillsDir: string | null,
    private logger?: Pick<Logger, "warn">
  ) {
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

    const skills: Skill[] = [];
    for (const file of files) {
      const filePath = join(this.skillsDir, file);
      try {
        skills.push({
          id: basename(file, ".md"),
          content: await readFile(filePath, "utf-8"),
        });
      } catch (err) {
        this.logger?.warn("Skill file load failed, skipping file", {
          file: filePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    this.skills = skills;
  }

  startWatching(): void {
    if (this.watcher || !this.skillsDir) return;

    try {
      this.watcher = watch(this.skillsDir, (eventType, filename) => {
        if (!filename || !filename.endsWith(".md")) return;

        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(async () => {
          this.debounceTimer = null;
          try {
            await this.load();
          } catch (err) {
            this.logger?.warn("Skill directory reload failed, keeping current skills", {
              error: err instanceof Error ? err.message : String(err),
            });
            return;
          }
          this.emit("skills_changed");
        }, 500);
      });

      this.watcher.on("error", (err) => {
        this.logger?.warn("Skill directory watcher failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        this.stopWatching();
      });
    } catch (err) {
      this.logger?.warn("Skill directory watcher failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      this.watcher = null;
    }
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

  getSkills(): Skill[] {
    return this.skills;
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
