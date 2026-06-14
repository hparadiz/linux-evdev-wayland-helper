import { accessSync, constants, readdirSync } from "node:fs";
import { join } from "node:path";

export function discoverEventDevices(devInputPath = "/dev/input"): string[] {
  if (process.platform !== "linux") {
    return [];
  }

  try {
    return readdirSync(devInputPath)
      .filter((entry) => /^event\d+$/.test(entry))
      .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)))
      .map((entry) => join(devInputPath, entry));
  } catch {
    return [];
  }
}

export function checkDevicePermissions(devices: string[]): Array<{ path: string; readable: boolean; error?: string }> {
  return devices.map((path) => {
    try {
      accessSync(path, constants.R_OK);
      return { path, readable: true };
    } catch (error) {
      return { path, readable: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
