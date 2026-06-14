import type { LinuxEvdevHelperConfig, LinuxEvdevHelperOptions, LinuxEvdevHotkey } from "./types.js";
export declare function parseHotkeys(hotkeys: LinuxEvdevHotkey[]): LinuxEvdevHelperConfig["hotkeys"];
export declare function buildHelperConfig(options: LinuxEvdevHelperOptions, parentPid?: number): LinuxEvdevHelperConfig;
