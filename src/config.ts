import { parseAccelerator } from "./accelerator.js";
import { discoverEventDevices } from "./devices.js";
import type { LinuxEvdevHelperConfig, LinuxEvdevHelperOptions, LinuxEvdevHotkey } from "./types.js";

export function parseHotkeys(hotkeys: LinuxEvdevHotkey[]): LinuxEvdevHelperConfig["hotkeys"] {
  if (!Array.isArray(hotkeys)) {
    throw new Error("hotkeys must be an array");
  }

  const ids = new Set<string>();
  return hotkeys.map((hotkey) => {
    if (!hotkey.id || typeof hotkey.id !== "string") {
      throw new Error("hotkey id must be a non-empty string");
    }
    if (ids.has(hotkey.id)) {
      throw new Error(`duplicate hotkey id: ${hotkey.id}`);
    }
    ids.add(hotkey.id);
    return {
      ...hotkey,
      parsed: parseAccelerator(hotkey.accelerator)
    };
  });
}

export function buildHelperConfig(options: LinuxEvdevHelperOptions, parentPid = process.pid): LinuxEvdevHelperConfig {
  if (options.enableUinput !== undefined && options.enableUinput !== false) {
    throw new Error("enableUinput is reserved for future support and must be false");
  }

  if (!Array.isArray(options.hotkeys)) {
    throw new Error("hotkeys must be an array");
  }

  const devices = options.allDevices ? discoverEventDevices() : [...(options.devices ?? [])];
  if (devices.length === 0) {
    throw new Error("at least one evdev device is required; pass devices or allDevices: true");
  }
  for (const device of devices) {
    if (!/^\/dev\/input\/event\d+$/.test(device)) {
      throw new Error(`invalid evdev device path: ${device}`);
    }
  }

  return {
    parentPid,
    devices,
    hotkeys: parseHotkeys(options.hotkeys),
    enableUinput: false
  };
}
