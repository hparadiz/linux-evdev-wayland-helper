import { app, BrowserWindow, Menu, Tray, nativeImage, screen } from "electron";
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

let overlayWindow;
let tray;
let helper;
let helperStatus = "Starting helper...";
let isQuitting = false;

function createOverlayWindow() {
  const display = screen.getPrimaryDisplay();
  const width = 460;
  const height = 220;
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
    focusable: false,
    webPreferences: {
      preload: join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.loadFile(join(__dirname, "overlay.html"), { query: { hotkey } });
}

function overlayVisible() {
  return Boolean(overlayWindow && overlayWindow.isVisible());
}

function showOverlay() {
  if (!overlayWindow) {
    return;
  }
  overlayWindow.webContents.send("helper-status", helperStatus);
  overlayWindow.showInactive();
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

async function startHotkeyHelper() {
  helper = new LinuxEvdevHelper();
  helper.on("event", (event) => {
    if (event.type === "ready") {
      helperStatus = `Ready: ${event.devices.length} devices, ${event.hotkeys} hotkey`;
      overlayWindow?.webContents.send("helper-status", helperStatus);
    } else if (event.type === "configured") {
      helperStatus = `Configured: ${event.hotkeys} hotkey`;
      overlayWindow?.webContents.send("helper-status", helperStatus);
    } else if (event.type === "hotkey" && event.id === "toggle-overlay") {
      toggleOverlay();
    } else if (event.type === "error") {
      helperStatus = `${event.code}: ${event.message}`;
      overlayWindow?.webContents.send("helper-status", helperStatus);
      showOverlay();
      rebuildMenu();
    } else if (event.type === "exit") {
      helperStatus = `Helper exited: ${event.code ?? event.signal ?? "unknown"}`;
      overlayWindow?.webContents.send("helper-status", helperStatus);
    }
  });

  try {
    await helper.start({
      helperPath,
      allDevices: true,
      elevation,
      parentPid: process.pid,
      hotkeys: [{ id: "toggle-overlay", accelerator: hotkey }]
    });
  } catch (error) {
    helperStatus = error instanceof Error ? error.message : String(error);
    overlayWindow?.webContents.send("helper-status", helperStatus);
    showOverlay();
  }
}

app.whenReady().then(async () => {
  createOverlayWindow();
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
  if (!helper || !isQuitting) {
    isQuitting = true;
  }
  if (!helper) {
    return;
  }
  event.preventDefault();
  const helperToStop = helper;
  helper = undefined;
  await helperToStop.stop();
  tray?.destroy();
  tray = undefined;
  app.quit();
});

app.on("window-all-closed", () => {
  if (isQuitting) {
    return;
  }
});
