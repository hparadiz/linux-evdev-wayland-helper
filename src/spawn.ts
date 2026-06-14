import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LinuxEvdevHelperOptions } from "./types.js";

export type HelperSpawnCommand = {
  command: string;
  args: string[];
};

export function defaultHelperPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "native", "linux-evdev-helper", "linux-evdev-helper");
}

export function buildSpawnCommand(options: LinuxEvdevHelperOptions): HelperSpawnCommand {
  if (process.platform !== "linux") {
    throw new Error("linux-evdev-helper can only be started on Linux");
  }

  const helperPath = options.helperPath ?? defaultHelperPath();
  if (!existsSync(helperPath)) {
    throw new Error(`helper binary not found: ${helperPath}`);
  }

  const elevation = options.elevation ?? "none";
  if (elevation === "none") {
    return { command: helperPath, args: [] };
  }
  if (elevation === "pkexec") {
    return { command: "pkexec", args: [helperPath] };
  }

  throw new Error("sudo elevation is intentionally unsupported; use pkexec or configure device permissions");
}
