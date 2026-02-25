import { watch, type FSWatcher } from "node:fs";
import { EventEmitter } from "node:events";
import { readConfigFile, type GatewayConfigFile } from "./config.js";

export interface ConfigWatcherEvents {
  config_changed: [config: GatewayConfigFile];
}

export class ConfigWatcher extends EventEmitter<ConfigWatcherEvents> {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private filePath: string | null) {
    super();
  }

  startWatching(): void {
    if (this.watcher || !this.filePath) return;

    this.watcher = watch(this.filePath, () => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.reload();
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

  private reload(): void {
    if (!this.filePath) return;

    let configFile: GatewayConfigFile;
    try {
      configFile = readConfigFile(this.filePath);
    } catch (err) {
      console.warn(
        `Config file reload failed (keeping current config): ${err instanceof Error ? err.message : String(err)}`
      );
      return;
    }

    this.emit("config_changed", configFile);
  }
}
