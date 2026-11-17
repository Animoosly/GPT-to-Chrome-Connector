const $ = (id) => document.getElementById(id);
const DEFAULTS = { serverUrl: "ws://127.0.0.1:8765", token: "", allowScripts: false, enabled: true };

function render(s) {
  if (!s) return;
  $("status").className = "status " + s.state;
  $("state").textContent = s.state === "connected" ? "Connected" : s.state === "connecting" ? "Connecting…" : "Not connected";
  $("detail").textContent = s.detail || "";
}

chrome.storage.local.get(Object.keys(DEFAULTS)).then((v) => {
  const s = { ...DEFAULTS, ...v };
  $("token").value = s.token;
  $("serverUrl").value = s.serverUrl;
  $("enabled").checked = s.enabled;
  $("allowScripts").checked = s.allowScripts;
});
chrome.runtime.sendMessage({ type: "getStatus" }).then(render).catch(() => {});
chrome.runtime.onMessage.addListener((m) => m.type === "status" && render(m.status));

$("save").onclick = async () => {
  await chrome.storage.local.set({
    token: $("token").value.trim(),
    serverUrl: $("serverUrl").value.trim() || DEFAULTS.serverUrl,
    enabled: $("enabled").checked,
    allowScripts: $("allowScripts").checked,
  });
  chrome.runtime.sendMessage({ type: "reconnect" });
};

$("panel").onclick = () => chrome.tabs.create({ url: "http://127.0.0.1:8765/" });
