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

Environment overrides:

```sh
EVDEV_DEMO_HOTKEY=Ctrl+D npm start
EVDEV_DEMO_ELEVATION=none npm start
EVDEV_DEMO_HELPER_PATH=/path/to/linux-evdev-helper npm start
```

The Electron process is the supervised `parentPid`, even when the helper is launched through `pkexec`. The helper exits on its own if that PID disappears.
