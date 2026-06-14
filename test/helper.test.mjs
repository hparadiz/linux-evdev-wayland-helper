import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import test from "node:test";
import { LinuxEvdevHelper } from "../dist/index.js";

const fixtureHelper = resolve("test/fixtures/fake-helper.mjs");

class FakeChild extends EventEmitter {
  constructor({
    raw = false,
    startMessages = [],
    afterReadyMessages = [],
    stderrOnStart,
    exitBeforeReady = false,
    killThrows = false,
    noExitOnKill = false
  } = {}) {
    super();
    this.raw = raw;
    this.startMessages = startMessages;
    this.afterReadyMessages = afterReadyMessages;
    this.stderrOnStart = stderrOnStart;
    this.exitBeforeReady = exitBeforeReady;
    this.killThrows = killThrows;
    this.noExitOnKill = noExitOnKill;
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
        if (this.stderrOnStart !== undefined) {
          this.stderr.emit("data", this.stderrOnStart);
        }
        if (this.exitBeforeReady) {
          this.emit("exit", 1, null);
          return;
        }
        for (const startMessage of this.startMessages) {
          this.stdout.emit("data", `${JSON.stringify(startMessage)}\n`);
        }
        if (this.raw) {
          this.stdout.emit("data", `${JSON.stringify({ type: "raw", keyCode: "KEY_A", value: 1 })}\n`);
        }
        this.stdout.emit("data", `${JSON.stringify({ type: "ready", devices: message.devices, hotkeys: message.hotkeys.length })}\n`);
        for (const afterReadyMessage of this.afterReadyMessages) {
          this.stdout.emit("data", `${JSON.stringify(afterReadyMessage)}\n`);
        }
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
    if (this.killThrows) {
      const error = new Error(`kill ${signal} EPERM`);
      error.code = "EPERM";
      throw error;
    }
    if (this.noExitOnKill) {
      this.lastSignal = signal;
      return true;
    }
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

test("demo-style runtime configuration exercises all command APIs", async () => {
  const { children, spawnImpl } = createSpawner();
  const helper = new LinuxEvdevHelper(spawnImpl);
  const configured = [];
  helper.on("event", (event) => {
    if (event.type === "configured") {
      configured.push(event.hotkeys);
    }
  });

  await helper.start({
    helperPath: fixtureHelper,
    devices: ["/dev/input/event1"],
    hotkeys: []
  });
  await helper.bindHotkey({ id: "api-smoke-test", accelerator: "F9" });
  await helper.unbindHotkey("api-smoke-test");
  await helper.clearHotkeys();
  await helper.setHotkeys([{ id: "toggle-overlay", accelerator: "Shift+N" }]);
  await helper.stop();

  assert.deepEqual(children[0].commands.map((command) => command.type), ["bind", "unbind", "clear", "set"]);
  assert.deepEqual(configured, [0, 0, 0, 1]);
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

test("restart stops the old helper and starts a new one with merged options", async () => {
  const { calls, spawnImpl } = createSpawner();
  const helper = new LinuxEvdevHelper(spawnImpl);

  await helper.start({
    helperPath: fixtureHelper,
    devices: ["/dev/input/event1"],
    hotkeys: [{ id: "f5", accelerator: "F5" }]
  });
  await helper.restart({ hotkeys: [{ id: "f9", accelerator: "F9" }] });
  await helper.stop();

  assert.equal(calls.length, 2);
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

test("normalizes helper protocol events", async () => {
  const { spawnImpl } = createSpawner({
    afterReadyMessages: [
      null,
      { type: "configured", hotkeys: 2 },
      { type: "hotkey", id: "x", accelerator: "F5", timestamp: 123 },
      { type: "error", code: "WARN", message: "warning", detail: "detail" }
    ],
    stderrOnStart: new TextEncoder().encode("stderr bytes")
  });
  const helper = new LinuxEvdevHelper(spawnImpl);
  const events = [];
  helper.on("event", (event) => events.push(event));

  await helper.start({
    helperPath: fixtureHelper,
    devices: ["/dev/input/event1"],
    hotkeys: [{ id: "f5", accelerator: "F5" }]
  });
  await helper.stop();

  assert.equal(events.some((event) => event.type === "error" && event.code === "PROTOCOL_INVALID"), true);
  assert.equal(events.some((event) => event.type === "configured" && event.hotkeys === 2), true);
  assert.equal(events.some((event) => event.type === "hotkey" && event.id === "x"), true);
  assert.equal(events.some((event) => event.type === "error" && event.code === "HELPER_STDERR"), true);
});

test("rejects on malformed helper JSON, spawn errors, and early exits", async () => {
  const malformed = createSpawner();
  const malformedHelper = new LinuxEvdevHelper(malformed.spawnImpl);
  queueMicrotask(() => malformed.children[0]?.stdout.emit("data", "{bad json\n"));
  await assert.rejects(() => malformedHelper.start({
    helperPath: fixtureHelper,
    devices: ["/dev/input/event1"],
    hotkeys: [{ id: "f5", accelerator: "F5" }]
  }), /Unexpected token|JSON/);

  const spawnErrorHelper = new LinuxEvdevHelper(() => {
    const child = new FakeChild();
    queueMicrotask(() => child.emit("error", new Error("spawn failed")));
    return child;
  });
  await assert.rejects(() => spawnErrorHelper.start({
    helperPath: fixtureHelper,
    devices: ["/dev/input/event1"],
    hotkeys: [{ id: "f5", accelerator: "F5" }]
  }), /spawn failed/);

  const earlyExit = createSpawner({ exitBeforeReady: true });
  const earlyExitHelper = new LinuxEvdevHelper(earlyExit.spawnImpl);
  await assert.rejects(() => earlyExitHelper.start({
    helperPath: fixtureHelper,
    devices: ["/dev/input/event1"],
    hotkeys: [{ id: "f5", accelerator: "F5" }]
  }), /exited before ready/);
});

test("rejects invalid lifecycle calls", async () => {
  const helper = new LinuxEvdevHelper(createSpawner().spawnImpl);

  await helper.stop();
  await assert.rejects(() => helper.updateHotkeys([]), /not been started/);
  await assert.rejects(() => helper.bindHotkey({ id: "x", accelerator: "F5" }), /not been started/);
  await assert.rejects(() => helper.unbindHotkey("x"), /not been started/);
  await assert.rejects(() => helper.clearHotkeys(), /not been started/);
  await assert.rejects(() => helper.restart(), /not been started/);

  await helper.start({
    helperPath: fixtureHelper,
    devices: ["/dev/input/event1"],
    hotkeys: []
  });
  await assert.rejects(() => helper.start({
    helperPath: fixtureHelper,
    devices: ["/dev/input/event1"],
    hotkeys: []
  }), /already running/);
  await assert.rejects(() => helper.unbindHotkey(""), /non-empty/);
  await assert.rejects(() => helper.setHotkeys("nope"), /array/);
  await helper.stop();
});

test("stop handles signal failures without throwing", async () => {
  const { spawnImpl } = createSpawner({ killThrows: true });
  const helper = new LinuxEvdevHelper(spawnImpl);
  const events = [];
  helper.on("event", (event) => events.push(event));

  await helper.start({
    helperPath: fixtureHelper,
    devices: ["/dev/input/event1"],
    hotkeys: []
  });
  await helper.stop();

  assert.equal(events.some((event) => event.type === "error" && event.code === "SIGNAL_FAILED"), true);
});

test("stop resolves through the SIGKILL timeout fallback", async () => {
  const { children, spawnImpl } = createSpawner({ noExitOnKill: true });
  const helper = new LinuxEvdevHelper(spawnImpl);

  await helper.start({
    helperPath: fixtureHelper,
    devices: ["/dev/input/event1"],
    hotkeys: []
  });
  await helper.stop();

  assert.equal(children[0].lastSignal, "SIGKILL");
});

test("rejects commands when startup failed before the helper stayed running", async () => {
  const failedStartup = createSpawner({
    startMessages: [{ type: "error", code: "CONFIG_INVALID", message: "bad config" }]
  });
  const helper = new LinuxEvdevHelper(failedStartup.spawnImpl);

  await assert.rejects(() => helper.start({
    helperPath: fixtureHelper,
    devices: ["/dev/input/event1"],
    hotkeys: [{ id: "f5", accelerator: "F5" }]
  }), /bad config/);
  await assert.rejects(() => helper.setHotkeys([]), /not running/);
});
