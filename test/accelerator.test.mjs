import assert from "node:assert/strict";
import test from "node:test";
import { parseAccelerator } from "../dist/index.js";

test("parses supported Electron-style accelerators", () => {
  assert.deepEqual(parseAccelerator("Ctrl+D"), { keyCode: "KEY_D", modifiers: ["ctrl"] });
  assert.deepEqual(parseAccelerator("Ctrl+Alt+D"), { keyCode: "KEY_D", modifiers: ["alt", "ctrl"] });
  assert.deepEqual(parseAccelerator("Shift+Space"), { keyCode: "KEY_SPACE", modifiers: ["shift"] });
  assert.deepEqual(parseAccelerator("Shift+N"), { keyCode: "KEY_N", modifiers: ["shift"] });
  assert.deepEqual(parseAccelerator("Shift+Period"), { keyCode: "KEY_DOT", modifiers: ["shift"] });
  assert.deepEqual(parseAccelerator("F1"), { keyCode: "KEY_F1", modifiers: [] });
  assert.deepEqual(parseAccelerator("F5"), { keyCode: "KEY_F5", modifiers: [] });
  assert.deepEqual(parseAccelerator("F9"), { keyCode: "KEY_F9", modifiers: [] });
  assert.deepEqual(parseAccelerator("F12"), { keyCode: "KEY_F12", modifiers: [] });
  assert.deepEqual(parseAccelerator("Tab"), { keyCode: "KEY_TAB", modifiers: [] });
  assert.deepEqual(parseAccelerator("Home"), { keyCode: "KEY_HOME", modifiers: [] });
  assert.deepEqual(parseAccelerator("End"), { keyCode: "KEY_END", modifiers: [] });
  assert.deepEqual(parseAccelerator("Numpad1"), { keyCode: "KEY_KP1", modifiers: [] });
  assert.deepEqual(parseAccelerator("NumEnter"), { keyCode: "KEY_KPENTER", modifiers: [] });
});

test("rejects unsupported keys and malformed accelerators", () => {
  assert.throws(() => parseAccelerator("Ctrl+Mouse1"), /unsupported/);
  assert.throws(() => parseAccelerator("Ctrl+"), /missing/);
  assert.throws(() => parseAccelerator("A+B"), /multiple/);
});

test("rejects bare basic alphabet keys", () => {
  assert.throws(() => parseAccelerator("N"), /modifier/);
  assert.throws(() => parseAccelerator("n"), /modifier/);
  assert.deepEqual(parseAccelerator("Shift+N"), { keyCode: "KEY_N", modifiers: ["shift"] });
  assert.deepEqual(parseAccelerator("Ctrl+D"), { keyCode: "KEY_D", modifiers: ["ctrl"] });
});
