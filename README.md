# linux-evdev-wayland-helper

Standalone Linux evdev global hotkey helper for Node and Electron hosts on Wayland.

This package exists because Wayland global shortcuts are compositor and portal dependent. `Electron.globalShortcut` and libraries that rely on desktop APIs can fail while a game or another exclusive input client is focused. This backend uses Linux evdev instead: a small native helper reads configured keyboard event devices and only emits events for shortcuts that the host app registered.

It is not a general keylogger. Node/Electron never reads `/dev/input/event*` directly, and the helper does not stream arbitrary keypresses to Node.

## Install and Build

```sh
npm install
npm run build
npm run build:native
```

The TypeScript package builds on non-Linux platforms. The native helper is Linux-only and is built only when you run `npm run build:native`.

Run unit tests and coverage:

```sh
npm test
npm run test:coverage
```

## API

```ts
import { LinuxEvdevHelper } from "linux-evdev-wayland-helper";

const helper = new LinuxEvdevHelper();

helper.on("event", (event) => {
  if (event.type === "hotkey") {
    console.log(event.id);
  }
});

await helper.start({
  allDevices: true,
  elevation: "pkexec",
  parentPid: process.pid,
  hotkeys: [
    { id: "shift-n", accelerator: "Shift+N" },
    { id: "ctrl-d", accelerator: "Ctrl+D" }
  ]
});

await helper.bindHotkey({ id: "refresh", accelerator: "F5" });
await helper.unbindHotkey("refresh");
await helper.clearHotkeys();
await helper.setHotkeys([{ id: "ctrl-d", accelerator: "Ctrl+D" }]);
await helper.stop();
```

`bindHotkey()` means “register this sequence now”. Binding an existing id replaces that id. `unbindHotkey()` forgets one registered id, `clearHotkeys()` forgets all registered shortcuts, and `setHotkeys()` replaces the current set in the running helper. `updateHotkeys()` is kept as an alias for `setHotkeys()`. These hotkey-only changes do not restart the helper.

Supported accelerator keys in this initial package include the keys needed by the reference integration: `Ctrl+D`, `Ctrl+Alt+D`, `Shift+Space`, `Shift+N`, `Shift+Period`, `F5`, and `F9`. The parser also accepts function keys `F1` through `F12`, navigation keys such as `Tab`, `Home`, and `End`, and common numpad keys.

Bare basic alphabet keys are intentionally rejected. For example, `N` is invalid, while `Shift+N`, `Ctrl+N`, and `Alt+N` are valid. Standalone function and special keys are allowed because they do not turn the helper into a stream of ordinary text input.

## Comparison With Other Linux Input Approaches

This package is intentionally narrow. It is not trying to replace general input-hook libraries, keyboard remappers, compositor shortcut APIs, or desktop portals.

### `uiohook-napi` / `libuiohook`

[`uiohook-napi`](https://github.com/SnosMe/uiohook-napi) provides Node N-API bindings for `libuiohook`. Its API exposes global input events such as `keydown`, `keyup`, mouse movement, mouse buttons, and wheel events, and it also has key synthesis helpers like `keyTap` and `keyToggle`.

That makes it useful when an application genuinely needs a broad cross-platform input hook. It is the wrong shape for this package's threat model: the host process receives raw input events and filters them itself. For an overlay app that only needs a known set of hotkeys, that is more power than necessary and looks much closer to a keylogger boundary.

This package inverts that model. The native helper reads evdev, but Node only receives `{ type: "hotkey", id, accelerator, timestamp }` for registered shortcuts. Unknown keypresses are never surfaced to Node, and bare alphabet bindings are rejected unless a modifier is present.

### keyd

[`keyd`](https://github.com/rvaiya/keyd) is a system-wide Linux key remapping daemon using evdev and uinput. It is excellent for keyboard layout changes, layers, tap/hold behavior, and virtual-keyboard output. It can also explain why apps sometimes need to watch all current event devices: with keyd enabled, rewritten keyboard events may come from a virtual device such as `keyd virtual keyboard` rather than from the physical keyboard.

This package is not a remapper. It does not create a persistent system daemon, does not install system config, does not rewrite keys, and does not require `/dev/uinput` for its default behavior. It coexists with keyd by watching the relevant evdev devices, including virtual keyboards when `allDevices: true` is used.

### X11, XGrabKey, XRecord, XInput, and XTest

On X11, global shortcuts can often be implemented with X APIs such as `XGrabKey`, and broader input observation can be done with mechanisms such as XRecord/XInput. Synthetic input is commonly associated with XTest.

Those APIs are X11-specific. They do not solve Wayland-focused overlay use cases, and they do not help when the target environment is a Wayland compositor running a game or another client with different focus/input behavior. X11 approaches are reasonable for an X11-only backend, but they are not the primary design here.

### Electron `globalShortcut`

Electron's `globalShortcut` is the best first attempt for ordinary desktop accelerators because it is simple and does not need direct device access. On Wayland it depends on compositor and portal support. In practice, that can vary by desktop, portal backend, version, and focused application.

This package exists for the cases where `globalShortcut` is not reliable enough, especially game-adjacent overlays where shortcuts need to activate even when the Electron window is not focused.

### XDG Desktop Portal GlobalShortcuts

The [XDG Desktop Portal GlobalShortcuts API](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.GlobalShortcuts.html) is the standardized desktop-friendly path for global shortcuts on Wayland. It is session-based: applications create a session, bind shortcuts, and receive `Activated` / `Deactivated` signals for shortcuts belonging to that session. The backend API is for portal implementations, not for arbitrary apps to spoof keypresses onto D-Bus.

Portals are a good optional backend for normal desktop integration, particularly when users prefer compositor-managed permissions and UI. They are not a complete replacement for this evdev helper because behavior depends on compositor and portal backend support, and minor desktop updates can change practical behavior. This package treats evdev as the deterministic fallback for registered hotkeys.

### Compositor-Specific Tools

Some compositors expose their own shortcut, IPC, or scripting mechanisms. Examples include sway/i3-style IPC, KWin scripting, GNOME Shell extensions, or desktop-specific settings daemons.

Those can be good for one desktop environment. They are poor package defaults because they require per-compositor code paths, user configuration, and version-specific assumptions. This package keeps the hotkey detector below the compositor layer and leaves compositor-specific behavior, such as overlay stacking and focus policy, to the host app.

### Why Not D-Bus for Helper Events?

A custom D-Bus service could carry the same `{ id, accelerator }` activation event, but it would add session-bus discovery, service ownership, bus policy, and spoofing questions, especially when the helper is launched through `pkexec`. It also risks making input events easier to observe outside the parent process.

For this package, stdout NDJSON over a parent-owned child process is simpler and tighter: the host launches exactly one helper, sends exactly one config stream, and receives only structured registered-hotkey activations.

## Permission Model

The Electron or Node app itself must not run as root. It should launch the helper directly, or use a narrow elevation path such as `pkexec` spawning the helper binary itself. The package does not run shell commands, does not install udev rules, does not call `sudo`, does not auto-`chmod` devices, and has no root-requiring postinstall script.

The helper opens configured `/dev/input/event*` devices read-only. On many distributions those devices are readable only by root or by a dedicated group such as `input`.

Optional manual udev/group setup can look like this, adjusted for your distribution policy:

```udev
KERNEL=="event*", SUBSYSTEM=="input", GROUP="input", MODE="0640"
```

Then add the user to the relevant group with your normal system administration tooling and start a new login session. Do not grant broad write access to input devices.

## Device Selection and keyd

The helper supports multiple devices at once. Physical keyboards may advertise useful capabilities while rewritten key events arrive from a virtual keyboard, such as `keyd virtual keyboard`. For that reason the package supports `allDevices: true`, which discovers all current `/dev/input/event*` devices and still emits only the registered hotkeys.

If you want a tighter policy, enumerate the devices yourself:

```ts
await helper.start({
  devices: ["/dev/input/event3", "/dev/input/event12"],
  hotkeys: [{ id: "ctrl-d", accelerator: "Ctrl+D" }]
});
```

`parentPid` is optional. By default the package uses the current Node process PID; Electron hosts can pass the supervising app PID explicitly. The native helper checks that PID every 60 seconds and exits if it disappears, including when it was launched through `pkexec`.

## Standalone Testing

Create `hotkeys.json`:

```json
{
  "hotkeys": [
    { "id": "shift-n", "accelerator": "Shift+N" },
    { "id": "ctrl-d", "accelerator": "Ctrl+D" }
  ]
}
```

Build and launch:

```sh
npm run build
npm run build:native
./scripts/linux-evdev-helper-test.mjs --config hotkeys.json --all-devices --pkexec
```

The wrapper prints only `READY`, `HOTKEY`, and `ERROR` events. It never prints raw keypresses unless you explicitly build and select the separate debug helper:

```sh
./scripts/linux-evdev-helper-test.mjs --config hotkeys.json --all-devices --pkexec --debug-events
```

The normal helper binary has no `--debug-events` flag and does not include raw event logging.

To test permissions without starting the helper:

```sh
./scripts/linux-evdev-helper-test.mjs --config hotkeys.json --all-devices --check-permissions
```

## Electron Demo

An Electron overlay demo lives in `demo/`. It registers `Shift+N` by default, toggles an always-on-top transparent overlay, and exposes only `Show Overlay` / `Hide Overlay` plus `Exit` in the menu.

```sh
npm run build
npm run build:native
cd demo
npm install
npm start
```

The demo behaves like a small host app settings panel: it starts the helper, lets you choose between five premade overlay hotkey presets, can clear all hotkeys, and can stop/restart the helper while showing event output. The presets exercise `setHotkeys()`, `updateHotkeys()`, `restart()`, `clearHotkeys()`, `stop()`, and `start()` without exposing method-shaped buttons in the UI.

## Helper Protocol

Node launches the helper with `child_process.spawn`, writes one JSON config object to stdin, keeps stdin open for runtime commands, and reads newline-delimited JSON from stdout.

Config:

```json
{
  "parentPid": 12345,
  "devices": ["/dev/input/event3"],
  "hotkeys": [
    {
      "id": "ctrl-d",
      "accelerator": "Ctrl+D",
      "parsed": { "keyCode": "KEY_D", "modifiers": ["ctrl"] }
    }
  ],
  "enableUinput": false
}
```

Events:

```json
{"type":"ready","devices":["/dev/input/event3"],"hotkeys":1}
{"type":"configured","hotkeys":2}
{"type":"hotkey","id":"ctrl-d","accelerator":"Ctrl+D","timestamp":123456789}
{"type":"error","code":"OPEN_DEVICE_FAILED","message":"failed to open evdev device","detail":"/dev/input/event3"}
```

Runtime commands are also newline-delimited JSON on stdin:

```json
{"type":"bind","hotkey":{"id":"shift-n","accelerator":"Shift+N","parsed":{"keyCode":"KEY_N","modifiers":["shift"]}}}
{"type":"unbind","id":"shift-n"}
{"type":"clear"}
{"type":"set","hotkeys":[{"id":"f5","accelerator":"F5","parsed":{"keyCode":"KEY_F5","modifiers":[]}}]}
```

The standalone wrapper forwards lines typed on stdin to the helper, so those command objects can be pasted into a running wrapper session for manual testing. The helper replies with `CONFIGURED hotkeys=N` when the active registered set changes.

The helper exits when the parent process disappears, handles `SIGTERM` and `SIGINT`, closes device file descriptors on exit, and uses `poll()` rather than busy waiting.

## Limitations

This package is Linux only for native hotkey capture. It requires read access to keyboard event devices. Wayland generally does not expose the currently focused window to arbitrary clients, so this does not provide foreground-window filtering. It does not solve overlay stacking or compositor-level rendering behavior. `uinput` passthrough is intentionally disabled in this initial package; if added later, it will require explicit `/dev/uinput` permissions.
