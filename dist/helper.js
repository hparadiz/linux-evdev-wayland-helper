import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { buildHelperConfig, parseHotkeys } from "./config.js";
import { NdjsonParser } from "./ndjson.js";
import { buildSpawnCommand } from "./spawn.js";
function normalizeHelperEvent(value) {
    if (!value || typeof value !== "object") {
        return { type: "error", code: "PROTOCOL_INVALID", message: "helper emitted a non-object event" };
    }
    const event = value;
    if (event.type === "ready" && Array.isArray(event.devices) && typeof event.hotkeys === "number") {
        return { type: "ready", devices: event.devices.filter((device) => typeof device === "string"), hotkeys: event.hotkeys };
    }
    if (event.type === "configured" && typeof event.hotkeys === "number") {
        return { type: "configured", hotkeys: event.hotkeys };
    }
    if (event.type === "hotkey" &&
        typeof event.id === "string" &&
        typeof event.accelerator === "string" &&
        typeof event.timestamp === "number") {
        return { type: "hotkey", id: event.id, accelerator: event.accelerator, timestamp: event.timestamp };
    }
    if (event.type === "error" && typeof event.code === "string" && typeof event.message === "string") {
        return {
            type: "error",
            code: event.code,
            message: event.message,
            detail: typeof event.detail === "string" ? event.detail : undefined
        };
    }
    return undefined;
}
export class LinuxEvdevHelper extends EventEmitter {
    spawnImpl;
    child;
    options;
    stopping = false;
    constructor(spawnImpl = spawn) {
        super();
        this.spawnImpl = spawnImpl;
    }
    async start(options) {
        if (this.child) {
            throw new Error("linux evdev helper is already running");
        }
        const config = buildHelperConfig(options, options.parentPid ?? process.pid);
        const command = buildSpawnCommand(options);
        const parser = new NdjsonParser();
        this.options = { ...options, hotkeys: [...options.hotkeys] };
        this.stopping = false;
        await new Promise((resolve, reject) => {
            let settled = false;
            const child = this.spawnImpl(command.command, command.args, { stdio: ["pipe", "pipe", "pipe"] });
            this.child = child;
            const settleReady = () => {
                if (!settled) {
                    settled = true;
                    resolve();
                }
            };
            const settleError = (error) => {
                if (!settled) {
                    settled = true;
                    this.child = undefined;
                    reject(error);
                }
                else {
                    this.emit("event", { type: "error", code: "SPAWN_ERROR", message: error.message });
                }
            };
            child.stdout.on("data", (chunk) => {
                try {
                    for (const parsed of parser.push(chunk)) {
                        const event = normalizeHelperEvent(parsed);
                        if (!event) {
                            this.emit("event", {
                                type: "error",
                                code: "PROTOCOL_UNSUPPORTED_EVENT",
                                message: "helper emitted an unsupported event type"
                            });
                            continue;
                        }
                        this.emit("event", event);
                        if (event.type === "ready") {
                            settleReady();
                        }
                        else if (event.type === "error") {
                            settleError(new Error(event.message));
                        }
                    }
                }
                catch (error) {
                    settleError(error instanceof Error ? error : new Error(String(error)));
                }
            });
            child.stderr.on("data", (chunk) => {
                this.emit("event", {
                    type: "error",
                    code: "HELPER_STDERR",
                    message: typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
                });
            });
            child.once("error", settleError);
            child.once("exit", (code, signal) => {
                this.child = undefined;
                const exitEvent = { type: "exit", code, signal };
                this.emit("event", exitEvent);
                if (!settled && !this.stopping) {
                    settled = true;
                    reject(new Error(`linux evdev helper exited before ready: ${code ?? signal ?? "unknown"}`));
                }
            });
            child.stdin.write(`${JSON.stringify(config)}\n`);
        });
    }
    async updateHotkeys(hotkeys) {
        await this.setHotkeys(hotkeys);
    }
    async setHotkeys(hotkeys) {
        if (!this.options) {
            throw new Error("linux evdev helper has not been started");
        }
        const parsedHotkeys = parseHotkeys(hotkeys);
        this.sendCommand({ type: "set", hotkeys: parsedHotkeys });
        this.options = { ...this.options, hotkeys: [...hotkeys] };
    }
    async bindHotkey(hotkey) {
        if (!this.options) {
            throw new Error("linux evdev helper has not been started");
        }
        const [parsedHotkey] = parseHotkeys([hotkey]);
        this.sendCommand({ type: "bind", hotkey: parsedHotkey });
        const nextHotkeys = this.options.hotkeys.filter((existing) => existing.id !== hotkey.id);
        nextHotkeys.push(hotkey);
        this.options = { ...this.options, hotkeys: nextHotkeys };
    }
    async unbindHotkey(id) {
        if (!this.options) {
            throw new Error("linux evdev helper has not been started");
        }
        if (!id || typeof id !== "string") {
            throw new Error("hotkey id must be a non-empty string");
        }
        this.sendCommand({ type: "unbind", id });
        this.options = { ...this.options, hotkeys: this.options.hotkeys.filter((hotkey) => hotkey.id !== id) };
    }
    async clearHotkeys() {
        if (!this.options) {
            throw new Error("linux evdev helper has not been started");
        }
        this.sendCommand({ type: "clear" });
        this.options = { ...this.options, hotkeys: [] };
    }
    async restart(options = {}) {
        if (!this.options) {
            throw new Error("linux evdev helper has not been started");
        }
        const nextOptions = { ...this.options, ...options, hotkeys: options.hotkeys ?? this.options.hotkeys };
        await this.stop();
        await this.start(nextOptions);
    }
    async stop() {
        const child = this.child;
        if (!child) {
            return;
        }
        this.stopping = true;
        await new Promise((resolve) => {
            let resolved = false;
            const finish = () => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    resolve();
                }
            };
            const signalChild = (signal) => {
                try {
                    return child.kill(signal);
                }
                catch (error) {
                    this.emit("event", {
                        type: "error",
                        code: "SIGNAL_FAILED",
                        message: error instanceof Error ? error.message : String(error)
                    });
                    return false;
                }
            };
            const timeout = setTimeout(() => {
                if (this.child === child) {
                    signalChild("SIGKILL");
                }
                finish();
            }, 2000);
            child.once("exit", () => {
                finish();
            });
            if (!signalChild("SIGTERM")) {
                finish();
            }
        });
        this.child = undefined;
        this.stopping = false;
    }
    sendCommand(command) {
        if (!this.child) {
            throw new Error("linux evdev helper is not running");
        }
        this.child.stdin.write(`${JSON.stringify(command)}\n`);
    }
    on(event, cb) {
        return super.on(event, cb);
    }
}
