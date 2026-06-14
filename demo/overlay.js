const params = new URLSearchParams(window.location.search);
const hotkeyEl = document.getElementById("hotkey");
const statusEl = document.getElementById("status");
const runningEl = document.getElementById("running");
const helperIndicatorEl = document.getElementById("helper-indicator");
const activeHotkeyEl = document.getElementById("active-hotkey");
const presetGridEl = document.getElementById("preset-grid");
const eventLogEl = document.getElementById("event-log");
const controlButtons = [...document.querySelectorAll("button[data-command]")];

hotkeyEl.textContent = params.get("hotkey") || "Shift+N";

if (!window.electronDemo) {
  statusEl.textContent = "Preload failed: Electron IPC bridge is unavailable";
  for (const button of controlButtons) {
    button.disabled = true;
  }
  throw new Error("Electron IPC bridge is unavailable");
}

function appendLog(message, detail) {
  const item = document.createElement("li");
  const renderedDetail = detail === undefined ? "" : ` ${JSON.stringify(detail)}`;
  item.textContent = `${new Date().toLocaleTimeString()} ${message}${renderedDetail}`;
  eventLogEl.prepend(item);
  while (eventLogEl.children.length > 80) {
    eventLogEl.lastElementChild?.remove();
  }
}

function renderPresets(state) {
  presetGridEl.replaceChildren();
  for (const preset of state.presets) {
    const button = document.createElement("button");
    button.className = "preset";
    if (state.hotkey?.accelerator === preset.accelerator) {
      button.classList.add("active");
    }
    button.type = "button";
    button.innerHTML = `
      <span class="preset-label">${preset.label}</span>
      <span class="preset-detail">${presetDescription(preset.mode)}</span>
    `;
    button.addEventListener("click", async () => {
      appendLog("preset", preset);
      const result = await window.electronDemo.command("apply-preset", { id: preset.id });
      appendLog(result.ok ? "preset applied" : "preset failed", result.error);
      renderState(await window.electronDemo.state());
    });
    presetGridEl.append(button);
  }
}

function presetDescription(mode) {
  if (mode === "set") {
    return "live update";
  }
  if (mode === "update") {
    return "settings replace";
  }
  if (mode === "restart") {
    return "restart helper";
  }
  if (mode === "clear-set") {
    return "clear then set";
  }
  if (mode === "stop-start") {
    return "stop/start";
  }
  return mode;
}

function renderState(state) {
  statusEl.textContent = state.helperStatus;
  runningEl.textContent = state.helperRunning ? "Yes" : "No";
  helperIndicatorEl.classList.toggle("on", state.helperRunning);
  helperIndicatorEl.classList.toggle("off", !state.helperRunning);
  activeHotkeyEl.textContent = state.hotkey
    ? `${state.hotkey.id}:${state.hotkey.accelerator}`
    : "None";
  renderPresets(state);

  for (const button of controlButtons) {
    const command = button.dataset.command;
    const needsHelper = ["stop", "restart", "clear-hotkeys"].includes(command);
    button.disabled =
      (needsHelper && !state.helperRunning) ||
      (command === "start" && state.helperRunning);
  }
}

for (const button of controlButtons) {
  button.addEventListener("click", async () => {
    const command = button.dataset.command;
    appendLog("command", command);
    const result = await window.electronDemo.command(command, {});
    appendLog(result.ok ? "command complete" : "command failed", result.error);
    renderState(await window.electronDemo.state());
  });
}

window.electronDemo.onDemoState(renderState);
window.electronDemo.onDemoLog((entry) => {
  appendLog(entry.message, entry.detail);
});

window.electronDemo.state().then(renderState).catch((error) => {
  appendLog("state failed", error.message);
});
