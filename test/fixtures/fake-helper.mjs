#!/usr/bin/env node

import { readFileSync } from "node:fs";

const input = readFileSync(0, "utf8");
const config = JSON.parse(input);
if (process.env.FAKE_HELPER_EMIT_RAW === "1") {
  process.stdout.write(`${JSON.stringify({ type: "raw", keyCode: "KEY_A", value: 1 })}\n`);
}
process.stdout.write(`${JSON.stringify({ type: "ready", devices: config.devices, hotkeys: config.hotkeys.length })}\n`);

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
setInterval(() => {}, 1000);
