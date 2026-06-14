# Electron Demo

This demo starts an Exiled Exchange-style overlay window and toggles it with a Linux evdev hotkey registered through the package in the parent directory.

From the repository root:

```sh
npm run build
npm run build:native
cd demo
npm install
npm start
```

Default behavior:

- Hotkey: `Shift+N`
- Helper elevation: `pkexec`
- Device selection: all current `/dev/input/event*`
- Menu: `Show Overlay` / `Hide Overlay`, and `Exit`
- Settings panel: choose one of five premade hotkey presets, disable hotkeys, restart the helper, stop/start the helper, and inspect events

The presets are presented like normal app settings, but they exercise different API paths internally:

- `Shift+N`: live `setHotkeys()`
- `Ctrl+D`: `updateHotkeys()`
- `Ctrl+Alt+D`: `restart()`
- `F9`: `clearHotkeys()` followed by `setHotkeys()`
- `Shift+Space`: `stop()` followed by `start()`

The event log shows helper events and preset changes.

Environment overrides:

```sh
EVDEV_DEMO_HOTKEY=Ctrl+D npm start
EVDEV_DEMO_ELEVATION=none npm start
EVDEV_DEMO_HELPER_PATH=/path/to/linux-evdev-helper npm start
```

The Electron process is the supervised `parentPid`, even when the helper is launched through `pkexec`. The helper exits on its own if that PID disappears.
