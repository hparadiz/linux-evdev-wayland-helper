export type LinuxEvdevHotkey = {
    id: string;
    accelerator: string;
    passthrough?: boolean;
};
export type LinuxEvdevParsedHotkey = {
    keyCode: string;
    modifiers: Array<"ctrl" | "shift" | "alt" | "meta">;
};
export type LinuxEvdevHelperOptions = {
    helperPath?: string;
    devices?: string[];
    hotkeys: LinuxEvdevHotkey[];
    elevation?: "pkexec" | "sudo" | "none";
    allDevices?: boolean;
    enableUinput?: false;
    parentPid?: number;
};
export type LinuxEvdevHelperEvent = {
    type: "ready";
    devices: string[];
    hotkeys: number;
} | {
    type: "configured";
    hotkeys: number;
} | {
    type: "hotkey";
    id: string;
    accelerator: string;
    timestamp: number;
} | {
    type: "error";
    code: string;
    message: string;
    detail?: string;
} | {
    type: "exit";
    code: number | null;
    signal: string | null;
};
export type LinuxEvdevHelperConfig = {
    parentPid: number;
    devices: string[];
    hotkeys: Array<LinuxEvdevHotkey & {
        parsed: LinuxEvdevParsedHotkey;
    }>;
    enableUinput: false;
};
export type LinuxEvdevHelperCommand = {
    type: "bind";
    hotkey: LinuxEvdevHotkey & {
        parsed: LinuxEvdevParsedHotkey;
    };
} | {
    type: "unbind";
    id: string;
} | {
    type: "clear";
} | {
    type: "set";
    hotkeys: Array<LinuxEvdevHotkey & {
        parsed: LinuxEvdevParsedHotkey;
    }>;
};
