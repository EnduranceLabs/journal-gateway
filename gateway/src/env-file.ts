import { readFileSync, watch, type FSWatcher } from "node:fs";
import { EventEmitter } from "node:events";
import { parse } from "dotenv";

export interface EnvFileEvents {
  env_changed: [];
}

export class EnvFile extends EventEmitter<EnvFileEvents> {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private filePath: string | null) {
    super();
  }

  load(): Record<string, string> {
    if (!this.filePath) return {};

    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf-8");
    } catch {
      return {};
    }

    return parse(raw);
  }

  startWatching(): void {
    if (this.watcher || !this.filePath) return;

    this.watcher = watch(this.filePath, () => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.emit("env_changed");
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
}
