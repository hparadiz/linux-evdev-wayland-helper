const params = new URLSearchParams(window.location.search);
const hotkeyEl = document.getElementById("hotkey");
const statusEl = document.getElementById("status");

hotkeyEl.textContent = params.get("hotkey") || "Shift+N";

window.electronDemo?.onHelperStatus?.((status) => {
  statusEl.textContent = status;
});
