#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildHelperConfig,
  checkDevicePermissions,
  discoverEventDevices,
  NdjsonParser
} from "../dist/index.js";

function usage() {
  console.error(`Usage: linux-evdev-helper-test --config config.json [--all-devices] [--pkexec] [--debug-events] [--check-permissions]

The config file may contain either:
  { "devices": ["/dev/input/event3"], "hotkeys": [{ "id": "shift-n", "accelerator": "Shift+N" }] }

or a full helper config with parentPid, devices, hotkeys, and enableUinput.`);
}

const args = process.argv.slice(2);
let configPath;
let allDevices = false;
let usePkexec = false;
let debugEvents = false;
let checkPermissionsOnly = false;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--config") {
    configPath = args[++i];
  } else if (arg === "--all-devices") {
    allDevices = true;
  } else if (arg === "--pkexec") {
    usePkexec = true;
  } else if (arg === "--debug-events") {
    debugEvents = true;
  } else if (arg === "--check-permissions") {
    checkPermissionsOnly = true;
  } else if (arg === "--help" || arg === "-h") {
    usage();
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    usage();
    process.exit(2);
  }
}

if (!configPath) {
  usage();
  process.exit(2);
}

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const helperName = debugEvents ? "linux-evdev-helper-debug" : "linux-evdev-helper";
const helperPath = join(packageRoot, "native", "linux-evdev-helper", helperName);

if (!existsSync(helperPath)) {
  console.error(`Missing helper binary: ${helperPath}`);
  console.error("Run: npm run build:native");
  process.exit(1);
}

const rawConfig = JSON.parse(readFileSync(resolve(configPath), "utf8"));
const devices = allDevices ? discoverEventDevices() : rawConfig.devices;

if (checkPermissionsOnly) {
  const checks = checkDevicePermissions(devices ?? discoverEventDevices());
  for (const check of checks) {
    console.log(`${check.readable ? "OK" : "NO"} ${check.path}${check.error ? ` ${check.error}` : ""}`);
  }
  process.exit(checks.every((check) => check.readable) ? 0 : 1);
}

const helperConfig = rawConfig.parentPid
  ? { ...rawConfig, parentPid: process.pid }
  : buildHelperConfig({ ...rawConfig, devices, allDevices: false }, process.pid);

const command = usePkexec ? "pkexec" : helperPath;
const commandArgs = usePkexec ? [helperPath] : [];
const child = spawn(command, commandArgs, { stdio: "pipe" });
const parser = new NdjsonParser();

child.stdout.on("data", (chunk) => {
  for (const event of parser.push(chunk)) {
    if (event.type === "ready") {
      console.log(`READY devices=${event.devices.length} hotkeys=${event.hotkeys}`);
    } else if (event.type === "hotkey") {
      console.log(`HOTKEY id=${event.id} accelerator=${event.accelerator} timestamp=${event.timestamp}`);
    } else if (event.type === "error") {
      console.log(`ERROR code=${event.code} message=${event.message}${event.detail ? ` detail=${event.detail}` : ""}`);
    } else if (event.type === "configured") {
      console.log(`CONFIGURED hotkeys=${event.hotkeys}`);
    } else {
      console.log(JSON.stringify(event));
    }
  }
});

child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

child.on("exit", (code, signal) => {
  console.error(`EXIT code=${code ?? ""} signal=${signal ?? ""}`);
});

child.stdin.write(`${JSON.stringify(helperConfig)}\n`);

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  child.stdin.write(chunk);
});

process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
