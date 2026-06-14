import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import test from "node:test";
import { LinuxEvdevHelper } from "../dist/index.js";

const fixtureHelper = resolve("test/fixtures/fake-helper.mjs");

class FakeChild extends EventEmitter {
  constructor({ raw = false } = {}) {
    super();
    this.raw = raw;
    this.commands = [];
    this.input = "";
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.stdin = {
      write: (chunk = "") => {
        this.input += chunk;
        for (;;) {
          const newline = this.input.indexOf("\n");
          if (newline === -1) {
            break;
          }
          const line = this.input.slice(0, newline);
          this.input = this.input.slice(newline + 1);
          if (line.length > 0) {
            this.handleLine(JSON.parse(line));
          }
        }
        return true;
      },
      end: (chunk = "") => {
        if (chunk) {
          this.stdin.write(chunk);
        }
      }
    };
  }

  handleLine(message) {
    if (message.parentPid) {
      queueMicrotask(() => {
        if (this.raw) {
          this.stdout.emit("data", `${JSON.stringify({ type: "raw", keyCode: "KEY_A", value: 1 })}\n`);
        }
        this.stdout.emit("data", `${JSON.stringify({ type: "ready", devices: message.devices, hotkeys: message.hotkeys.length })}\n`);
      });
      return;
    }
    this.commands.push(message);
    const hotkeys = message.type === "set" ? message.hotkeys.length : 0;
    queueMicrotask(() => {
      this.stdout.emit("data", `${JSON.stringify({ type: "configured", hotkeys })}\n`);
    });
  }

  kill(signal = "SIGTERM") {
    queueMicrotask(() => this.emit("exit", 0, signal));
    return true;
  }
}

function createSpawner(options = {}) {
  const calls = [];
  const children = [];
  const spawnImpl = (command, args, spawnOptions) => {
    calls.push({ command, args, spawnOptions });
    const child = new FakeChild(options);
    children.push(child);
    return child;
  };
  return { calls, children, spawnImpl };
}

test("updates hotkeys without restarting the helper", async () => {
  const { calls, children, spawnImpl } = createSpawner();
  const helper = new LinuxEvdevHelper(spawnImpl);
  const events = [];
  helper.on("event", (event) => events.push(event));

  await helper.start({
    helperPath: fixtureHelper,
    devices: ["/dev/input/event1"],
    hotkeys: [{ id: "shift-n", accelerator: "Shift+N" }]
  });

  await helper.updateHotkeys([{ id: "ctrl-d", accelerator: "Ctrl+D" }]);
  await helper.stop();

  const readyEvents = events.filter((event) => event.type === "ready");
  assert.equal(readyEvents.length, 1);
  assert.equal(readyEvents[0].hotkeys, 1);
  assert.equal(calls.length, 1);
  assert.equal(children[0].commands.length, 1);
  assert.equal(children[0].commands[0].type, "set");
  assert.equal(children[0].commands[0].hotkeys[0].id, "ctrl-d");
  assert.deepEqual(calls[0].spawnOptions.stdio, ["pipe", "pipe", "pipe"]);
});

test("binds, unbinds, clears, and replaces hotkeys through runtime commands", async () => {
  const { children, spawnImpl } = createSpawner();
  const helper = new LinuxEvdevHelper(spawnImpl);

  await helper.start({
    helperPath: fixtureHelper,
    devices: ["/dev/input/event1"],
    hotkeys: []
  });

  await helper.bindHotkey({ id: "shift-n", accelerator: "Shift+N" });
  await helper.unbindHotkey("shift-n");
  await helper.clearHotkeys();
  await helper.setHotkeys([{ id: "f5", accelerator: "F5" }]);
  await helper.stop();

  assert.deepEqual(children[0].commands.map((command) => command.type), ["bind", "unbind", "clear", "set"]);
  assert.equal(children[0].commands[0].hotkey.parsed.keyCode, "KEY_N");
  assert.equal(children[0].commands[1].id, "shift-n");
  assert.equal(children[0].commands[3].hotkeys[0].parsed.keyCode, "KEY_F5");
});

test("does not surface unknown raw helper events to callers", async () => {
  const { spawnImpl } = createSpawner({ raw: true });
  const helper = new LinuxEvdevHelper(spawnImpl);
  const events = [];
  helper.on("event", (event) => events.push(event));

  await helper.start({
    helperPath: fixtureHelper,
    devices: ["/dev/input/event1"],
    hotkeys: [{ id: "shift-n", accelerator: "Shift+N" }]
  });
  await helper.stop();

  assert.equal(events.some((event) => event.type === "raw"), false);
  assert.equal(events.some((event) => event.type === "error" && event.code === "PROTOCOL_UNSUPPORTED_EVENT"), true);
});
