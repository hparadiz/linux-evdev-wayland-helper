/// <reference path="../src/node-ambient.d.ts" />
import { type ChildProcessWithoutNullStreams, type SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import type { LinuxEvdevHelperEvent, LinuxEvdevHelperOptions, LinuxEvdevHotkey } from "./types.js";
type SpawnImplementation = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcessWithoutNullStreams;
export declare class LinuxEvdevHelper extends EventEmitter {
    private readonly spawnImpl;
    private child?;
    private options?;
    private stopping;
    constructor(spawnImpl?: SpawnImplementation);
    start(options: LinuxEvdevHelperOptions): Promise<void>;
    updateHotkeys(hotkeys: LinuxEvdevHelperOptions["hotkeys"]): Promise<void>;
    setHotkeys(hotkeys: LinuxEvdevHotkey[]): Promise<void>;
    bindHotkey(hotkey: LinuxEvdevHotkey): Promise<void>;
    unbindHotkey(id: string): Promise<void>;
    clearHotkeys(): Promise<void>;
    restart(options?: Partial<LinuxEvdevHelperOptions>): Promise<void>;
    stop(): Promise<void>;
    private sendCommand;
    on(event: "event", cb: (event: LinuxEvdevHelperEvent) => void): this;
}
export {};
