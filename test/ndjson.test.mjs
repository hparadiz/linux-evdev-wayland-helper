import assert from "node:assert/strict";
import test from "node:test";
import { NdjsonParser } from "../dist/index.js";

test("parses newline-delimited JSON with partial lines", () => {
  const parser = new NdjsonParser();
  assert.deepEqual(parser.push('{"type":"ready"'), []);
});

test("parses blank lines and Uint8Array chunks", () => {
  const parser = new NdjsonParser();
  assert.deepEqual(parser.push("\n"), []);
  assert.deepEqual(parser.push(new TextEncoder().encode('{"type":"configured","hotkeys":1}\n')), [
    { type: "configured", hotkeys: 1 }
  ]);
});

test("continues parsing newline-delimited JSON with partial lines", () => {
  const parser = new NdjsonParser();
  assert.deepEqual(parser.push('{"type":"ready"'), []);
  assert.deepEqual(parser.push(',"devices":[],"hotkeys":1}\n{"type":"hot'), [
    { type: "ready", devices: [], hotkeys: 1 }
  ]);
  assert.deepEqual(parser.push('key","id":"x","accelerator":"F5","timestamp":1}\n'), [
    { type: "hotkey", id: "x", accelerator: "F5", timestamp: 1 }
  ]);
});
