import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen } from "electron";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LinuxEvdevHelper } from "../dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const iconPath = join(rootDir, "assets", "icon.png");
const helperPath = process.env.EVDEV_DEMO_HELPER_PATH ||
  join(rootDir, "native", "linux-evdev-helper", "linux-evdev-helper");
const hotkey = process.env.EVDEV_DEMO_HOTKEY || "Shift+N";
const elevation = process.env.EVDEV_DEMO_ELEVATION || "pkexec";
const defaultHotkey = { id: "toggle-overlay", accelerator: hotkey };
const presets = [
  { id: "shift-n", label: "Shift+N", accelerator: "Shift+N", mode: "set" },
  { id: "ctrl-d", label: "Ctrl+D", accelerator: "Ctrl+D", mode: "update" },
  { id: "ctrl-alt-d", label: "Ctrl+Alt+D", accelerator: "Ctrl+Alt+D", mode: "restart" },
  { id: "f9", label: "F9", accelerator: "F9", mode: "clear-set" },
  { id: "shift-space", label: "Shift+Space", accelerator: "Shift+Space", mode: "stop-start" }
];

let overlayWindow;
let tray;
let helper;
let helperStatus = "Starting helper...";
let activeHotkey = { ...defaultHotkey };
let hotkeysEnabled = true;
let isQuitting = false;
let quitAfterCleanup = false;
let helperRestarting = false;
let helperStopping = false;

function createOverlayWindow() {
  const display = screen.getPrimaryDisplay();
  const width = 760;
  const height = 640;
  const x = display.workArea.x + display.workArea.width - width - 32;
  const y = display.workArea.y + 80;

  overlayWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      hideOverlay();
      rebuildMenu();
    }
  });
  overlayWindow.loadFile(join(__dirname, "overlay.html"), { query: { hotkey } });
}

function overlayVisible() {
  return Boolean(overlayWindow && overlayWindow.isVisible());
}

function showOverlay() {
  if (!overlayWindow) {
    return;
  }
  sendDemoState();
  overlayWindow.show();
  overlayWindow.focus();
}

function hideOverlay() {
  overlayWindow?.hide();
}

function toggleOverlay() {
  if (overlayVisible()) {
    hideOverlay();
  } else {
    showOverlay();
  }
  rebuildMenu();
}

function rebuildMenu() {
  const label = overlayVisible() ? "Hide Overlay" : "Show Overlay";
  const template = [
    { label, click: toggleOverlay },
    { type: "separator" },
    { label: "Exit", click: quitApp }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  if (tray) {
    tray.setContextMenu(menu);
    tray.setToolTip(`Linux evdev helper demo (${hotkey})`);
  }
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

async function cleanupHelperForQuit() {
  if (!helper) {
    return;
  }
  const helperToStop = helper;
  helper = undefined;
  helperStopping = true;
  try {
    await helperToStop.stop();
  } finally {
    helperStopping = false;
  }
}

function currentHotkeys() {
  return hotkeysEnabled ? [activeHotkey] : [];
}

function helperOptions(hotkeys = currentHotkeys()) {
  return {
    helperPath,
    allDevices: true,
    elevation,
    parentPid: process.pid,
    hotkeys
  };
}

function logToOverlay(message, detail) {
  overlayWindow?.webContents.send("demo-log", {
    time: new Date().toLocaleTimeString(),
    message,
    detail
  });
}

function sendDemoState() {
  overlayWindow?.webContents.send("demo-state", {
    helperRunning: Boolean(helper),
    helperStatus,
    hotkey: hotkeysEnabled ? activeHotkey : null,
    defaultHotkey,
    presets,
    helperPath,
    elevation
  });
}

async function startHotkeyHelper() {
  if (helper) {
    helperStatus = "Helper is already running";
    sendDemoState();
    return;
  }
  helper = new LinuxEvdevHelper();
  helper.on("event", (event) => {
    logToOverlay(`event:${event.type}`, event);
    if (event.type === "ready") {
      helperStatus = `Ready: ${event.devices.length} devices, ${event.hotkeys} hotkey`;
      sendDemoState();
    } else if (event.type === "configured") {
      helperStatus = `Configured: ${event.hotkeys} hotkey`;
      sendDemoState();
    } else if (event.type === "hotkey" && event.id === "toggle-overlay") {
      toggleOverlay();
    } else if (event.type === "error") {
      helperStatus = `${event.code}: ${event.message}`;
      sendDemoState();
      showOverlay();
      rebuildMenu();
    } else if (event.type === "exit") {
      helperStatus = `Helper exited: ${event.code ?? event.signal ?? "unknown"}`;
      if (!helperRestarting && !helperStopping) {
        helper = undefined;
      }
      sendDemoState();
    }
  });

  try {
    await helper.start(helperOptions());
    logToOverlay("start", activeHotkey);
    helperStatus = hotkeysEnabled ? `Ready: ${activeHotkey.accelerator} toggles overlay` : "Ready: no hotkeys registered";
    sendDemoState();
  } catch (error) {
    helperStatus = error instanceof Error ? error.message : String(error);
    logToOverlay("start failed", helperStatus);
    helper = undefined;
    sendDemoState();
    showOverlay();
  }
}

async function stopHotkeyHelper() {
  if (!helper) {
    helperStatus = "Helper is already stopped";
    sendDemoState();
    return;
  }
  const helperToStop = helper;
  helperStopping = true;
  helper = undefined;
  try {
    await helperToStop.stop();
  } finally {
    helperStopping = false;
  }
  helperStatus = "Helper stopped";
  logToOverlay("stop", "helper stopped");
  sendDemoState();
}

async function runApiCommand(command, payload = {}) {
  try {
    if (command === "start") {
      await startHotkeyHelper();
    } else if (command === "stop") {
      await stopHotkeyHelper();
    } else if (command === "restart") {
      if (!helper) {
        await startHotkeyHelper();
      } else {
        helperRestarting = true;
        try {
          await helper.restart(helperOptions());
        } finally {
          helperRestarting = false;
        }
        helperStatus = "Helper restarted";
        logToOverlay("restart", activeHotkey);
        sendDemoState();
      }
    } else if (command === "apply-preset") {
      const preset = presets.find((item) => item.id === payload.id) ?? presets[0];
      await applyPreset(preset);
      sendDemoState();
    } else if (command === "reset-hotkey") {
      activeHotkey = { ...defaultHotkey };
      hotkeysEnabled = true;
      if (helper) {
        await helper.updateHotkeys([activeHotkey]);
      }
      helperStatus = helper ? `Ready: ${activeHotkey.accelerator} toggles overlay` : "Default hotkey restored; helper is stopped";
      logToOverlay("resetHotkey", activeHotkey);
      sendDemoState();
    } else if (command === "clear-hotkeys") {
      await requireHelper().clearHotkeys();
      hotkeysEnabled = false;
      helperStatus = "No hotkeys registered";
      logToOverlay("clearHotkeys", "overlay toggle disabled until Apply is clicked");
      sendDemoState();
    } else if (command === "toggle-overlay") {
      toggleOverlay();
    } else {
      throw new Error(`Unknown demo command: ${command}`);
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    helperStatus = message;
    logToOverlay(`${command} failed`, message);
    sendDemoState();
    return { ok: false, error: message };
  }
}

function requireHelper() {
  if (!helper) {
    throw new Error("Helper is not running");
  }
  return helper;
}

async function applyPreset(preset) {
  const nextHotkey = { id: "toggle-overlay", accelerator: preset.accelerator };
  if (preset.mode === "set") {
    if (helper) {
      await helper.setHotkeys([nextHotkey]);
    }
    logToOverlay("preset applied with setHotkeys", preset);
  } else if (preset.mode === "update") {
    if (helper) {
      await helper.updateHotkeys([nextHotkey]);
    }
    logToOverlay("preset applied with updateHotkeys", preset);
  } else if (preset.mode === "restart") {
    activeHotkey = nextHotkey;
    hotkeysEnabled = true;
    if (helper) {
      helperRestarting = true;
      try {
        await helper.restart(helperOptions([nextHotkey]));
      } finally {
        helperRestarting = false;
      }
    }
    logToOverlay("preset applied with restart", preset);
  } else if (preset.mode === "clear-set") {
    if (helper) {
      await helper.clearHotkeys();
      await helper.setHotkeys([nextHotkey]);
    }
    logToOverlay("preset applied with clearHotkeys + setHotkeys", preset);
  } else if (preset.mode === "stop-start") {
    activeHotkey = nextHotkey;
    hotkeysEnabled = true;
    if (helper) {
      await stopHotkeyHelper();
      await startHotkeyHelper();
    }
    logToOverlay("preset applied with stop + start", preset);
  }
  activeHotkey = nextHotkey;
  hotkeysEnabled = true;
  helperStatus = helper ? `Ready: ${nextHotkey.accelerator} toggles overlay` : "Preset saved; helper is stopped";
}

app.whenReady().then(async () => {
  createOverlayWindow();
  ipcMain.handle("demo-command", (_event, command, payload) => runApiCommand(command, payload));
  ipcMain.handle("demo-state", () => ({
    helperRunning: Boolean(helper),
    helperStatus,
    hotkey: hotkeysEnabled ? activeHotkey : null,
    defaultHotkey,
    presets,
    helperPath,
    elevation
  }));
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 24, height: 24 });
  tray = new Tray(trayIcon);
  rebuildMenu();
  await startHotkeyHelper();

  app.on("activate", () => {
    showOverlay();
    rebuildMenu();
  });
});

app.on("before-quit", async (event) => {
  isQuitting = true;
  if (quitAfterCleanup) {
    return;
  }
  event.preventDefault();
  await cleanupHelperForQuit();
  ipcMain.removeHandler("demo-command");
  ipcMain.removeHandler("demo-state");
  tray?.destroy();
  tray = undefined;
  quitAfterCleanup = true;
  app.quit();
});

app.on("window-all-closed", () => {
  return;
});
