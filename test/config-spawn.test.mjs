import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildHelperConfig,
  buildSpawnCommand,
  checkDevicePermissions,
  defaultHelperPath,
  discoverEventDevices
} from "../dist/index.js";

const fixtureHelper = resolve("test/fixtures/fake-helper.mjs");

test("builds helper config and validates devices and hotkeys", () => {
  const config = buildHelperConfig({
    devices: ["/dev/input/event1"],
    hotkeys: [{ id: "ctrl-d", accelerator: "Ctrl+D" }]
  }, 99);

  assert.equal(config.parentPid, 99);
  assert.equal(config.enableUinput, false);
  assert.deepEqual(config.hotkeys[0].parsed, { keyCode: "KEY_D", modifiers: ["ctrl"] });

  assert.deepEqual(buildHelperConfig({
    devices: ["/dev/input/event1"],
    hotkeys: []
  }, 99).hotkeys, []);
  assert.throws(() => buildHelperConfig({
    devices: ["/dev/input/event1"],
    hotkeys: [{ id: "x", accelerator: "F5" }],
    enableUinput: true
  }), /enableUinput/);
  assert.throws(() => buildHelperConfig({ devices: ["/dev/input/event1"], hotkeys: "nope" }), /array/);
  assert.throws(() => buildHelperConfig({ devices: ["/dev/input/event1"], hotkeys: [{ id: "", accelerator: "F5" }] }), /non-empty/);
  assert.throws(() => buildHelperConfig({ devices: [], hotkeys: [{ id: "x", accelerator: "F5" }] }), /device/);
  assert.throws(() => buildHelperConfig({ devices: ["/tmp/event1"], hotkeys: [{ id: "x", accelerator: "F5" }] }), /invalid/);
  assert.throws(
    () => buildHelperConfig({ devices: ["/dev/input/event1"], hotkeys: [{ id: "x", accelerator: "F5" }, { id: "x", accelerator: "F9" }] }),
    /duplicate/
  );
});

test("constructs narrow spawn commands", () => {
  assert.equal(defaultHelperPath().endsWith("native/linux-evdev-helper/linux-evdev-helper"), true);
  assert.throws(() => buildSpawnCommand({
    helperPath: resolve("test/fixtures/missing-helper"),
    devices: ["/dev/input/event1"],
    hotkeys: [{ id: "x", accelerator: "F5" }]
  }), /not found/);

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

test("discovers event devices and checks permissions", () => {
  const dir = mkdtempSync(join(tmpdir(), "evdev-helper-test-"));
  try {
    writeFileSync(join(dir, "event10"), "");
    writeFileSync(join(dir, "event2"), "");
    writeFileSync(join(dir, "mouse0"), "");

    assert.deepEqual(discoverEventDevices(dir), [join(dir, "event2"), join(dir, "event10")]);
    assert.deepEqual(discoverEventDevices(join(dir, "missing")), []);

    const checks = checkDevicePermissions([join(dir, "event2"), join(dir, "missing")]);
    assert.equal(checks[0].readable, true);
    assert.equal(checks[1].readable, false);
    assert.equal(typeof checks[1].error, "string");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
