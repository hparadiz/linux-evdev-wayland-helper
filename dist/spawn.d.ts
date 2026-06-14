import type { LinuxEvdevHelperOptions } from "./types.js";
export type HelperSpawnCommand = {
    command: string;
    args: string[];
};
export declare function defaultHelperPath(): string;
export declare function buildSpawnCommand(options: LinuxEvdevHelperOptions): HelperSpawnCommand;
