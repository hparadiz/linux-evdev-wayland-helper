import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { buildHelperConfig, buildSpawnCommand } from "../dist/index.js";

const fixtureHelper = resolve("test/fixtures/fake-helper.mjs");

test("builds helper config and validates devices and hotkeys", () => {
  const config = buildHelperConfig({
    devices: ["/dev/input/event1"],
    hotkeys: [{ id: "ctrl-d", accelerator: "Ctrl+D" }]
  }, 99);

  assert.equal(config.parentPid, 99);
  assert.equal(config.enableUinput, false);
  assert.deepEqual(config.hotkeys[0].parsed, { keyCode: "KEY_D", modifiers: ["ctrl"] });

  assert.throws(() => buildHelperConfig({ devices: [], hotkeys: [{ id: "x", accelerator: "F5" }] }), /device/);
  assert.throws(() => buildHelperConfig({ devices: ["/tmp/event1"], hotkeys: [{ id: "x", accelerator: "F5" }] }), /invalid/);
  assert.throws(
    () => buildHelperConfig({ devices: ["/dev/input/event1"], hotkeys: [{ id: "x", accelerator: "F5" }, { id: "x", accelerator: "F9" }] }),
    /duplicate/
  );
});

test("constructs narrow spawn commands", () => {
  assert.deepEqual(buildSpawnCommand({
    helperPath: fixtureHelper,
    devices: ["/dev/input/event1"],
    hotkeys: [{ id: "x", accelerator: "F5" }],
    elevation: "none"
  }), { command: fixtureHelper, args: [] });

  assert.deepEqual(buildSpawnCommand({
    helperPath: fixtureHelper,
    devices: ["/dev/input/event1"],
    hotkeys: [{ id: "x", accelerator: "F5" }],
    elevation: "pkexec"
  }), { command: "pkexec", args: [fixtureHelper] });

  assert.throws(() => buildSpawnCommand({
    helperPath: fixtureHelper,
    devices: ["/dev/input/event1"],
    hotkeys: [{ id: "x", accelerator: "F5" }],
    elevation: "sudo"
  }), /unsupported/);
});
