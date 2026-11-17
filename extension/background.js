import { pageAgent } from "./page-agent.js";

const DEFAULTS = { serverUrl: "ws://127.0.0.1:8765", token: "", allowScripts: false, enabled: true };
let ws = null;
let status = { state: "disconnected", detail: "" };
let pingTimer = null;
let reconnectTimer = null;
let backoff = 1000;

// token.json is written into this folder by the connector app, so the extension pairs itself.
async function pairingFile() {
  try {
    const r = await fetch(chrome.runtime.getURL("token.json"), { cache: "no-store" });
    return r.ok ? await r.json() : {};
  } catch { return {}; }
}
const getSettings = async () => {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const s = { ...DEFAULTS, ...stored };
  if (!s.token) {
    const f = await pairingFile();
    if (f.token) { s.token = f.token; s.autoPaired = true; if (!stored.serverUrl && f.serverUrl) s.serverUrl = f.serverUrl; }
  }
  return s;
};

function setStatus(state, detail = "") {
  status = { state, detail, at: Date.now() };
  chrome.action.setBadgeText({ text: state === "connected" ? "ON" : state === "connecting" ? "…" : "OFF" });
  chrome.action.setBadgeBackgroundColor({ color: state === "connected" ? "#5a8a3c" : state === "connecting" ? "#c9672a" : "#888" });
  chrome.runtime.sendMessage({ type: "status", status }).catch(() => {});
}

async function connect() {
  clearTimeout(reconnectTimer);
  const s = await getSettings();
  if (!s.enabled) return setStatus("disconnected", "Disabled");
  if (!s.token) return setStatus("disconnected", "Start the ChatGPT Chrome Connector app (or paste its token)");
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  const base = s.serverUrl.replace(/\/+$/, "").replace(/^http/, "ws");
  setStatus("connecting", base);
  let sock;
  try {
    sock = new WebSocket(`${base}/extension?token=${encodeURIComponent(s.token)}`);
  } catch (e) {
    setStatus("disconnected", String(e));
    return scheduleReconnect();
  }
  ws = sock;
  sock.onopen = () => {
    backoff = 1000;
    setStatus("connected", s.autoPaired ? `${base} (auto-paired)` : base);
    sendHello(sock, s);
    clearInterval(pingTimer);
    // Activity every 20s keeps the MV3 service worker alive (Chrome 116+).
    pingTimer = setInterval(() => sock.readyState === WebSocket.OPEN && sock.send(JSON.stringify({ type: "ping" })), 20000);
  };
  sock.onmessage = async (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === "pong" || msg.id == null) return;
    try {
      const result = await handle(msg.action, msg.params || {});
      sock.send(JSON.stringify({ id: msg.id, result }));
    } catch (e) {
      sock.send(JSON.stringify({ id: msg.id, error: e?.message || String(e) }));
    }
  };
  sock.onclose = (ev) => {
    clearInterval(pingTimer);
    if (ws === sock) ws = null;
    setStatus("disconnected", ev.code === 1006 ? "Connector app not running (or wrong token)" : `Closed (${ev.code})`);
    if (ev.code === 4001) backoff = 500;
    if (ev.code !== 4000) scheduleReconnect();
  };
  sock.onerror = () => {};
}

// Tells the connector which extension/Chrome version it is talking to (shown in its control panel).
function sendHello(sock, s) {
  const chromeVer = (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1] || "";
  try {
    sock.send(JSON.stringify({ type: "hello", version: chrome.runtime.getManifest().version, chrome: chromeVer, allowScripts: !!s.allowScripts, ua: navigator.userAgent }));
  } catch {}
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, backoff);
  backoff = Math.min(backoff * 2, 15000);
}

// ---------- helpers ----------
async function resolveTab(tabId) {
  if (tabId != null) return chrome.tabs.get(tabId);
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (t) return t;
  const [any] = await chrome.tabs.query({ active: true });
  if (!any) throw new Error("No active tab");
  return any;
}

const tabSummary = (t) => ({ id: t.id, title: t.title, url: t.url, active: t.active, windowId: t.windowId, status: t.status });

function waitForLoad(tabId, timeout = 20000) {
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); resolve(); };
    const listener = (id, info) => { if (id === tabId && info.status === "complete") done(); };
    const timer = setTimeout(done, timeout);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => { if (t.status === "complete") setTimeout(() => { chrome.tabs.get(tabId).then((t2) => t2.status === "complete" && done()).catch(done); }, 300); }).catch(done);
  });
}

async function runInPage(tabId, op, params) {
  const tab = await resolveTab(tabId);
  if (/^(chrome|edge|about|chrome-extension|devtools|view-source):/.test(tab.url || "") || (tab.url || "").startsWith("https://chromewebstore.google.com")) {
    throw new Error(`Chrome does not allow extensions to access ${tab.url}. Open a normal web page.`);
  }
  let res;
  try {
    [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pageAgent, args: [op, params] });
  } catch (e) {
    throw new Error(`Could not access tab ${tab.id} (${tab.url}): ${e.message}`);
  }
  if (!res) throw new Error("No result from page");
  if (res.result?.__error) throw new Error(res.result.__error);
  return { tabId: tab.id, ...res.result };
}

// Some actions trigger navigation; give the page a moment and then report where we are.
async function afterAction(tabId, result) {
  await new Promise((r) => setTimeout(r, 400));
  const t = await chrome.tabs.get(tabId).catch(() => null);
  if (t?.status === "loading") await waitForLoad(tabId, 15000);
  const t2 = await chrome.tabs.get(tabId).catch(() => null);
  return { ...result, page: t2 ? { url: t2.url, title: t2.title } : undefined };
}

// ---------- per-tab URL history ----------
// Chrome skips history entries that never got a real user gesture when going back, and every
// action from this extension is synthetic. We keep our own stack so back/forward still work.
const navHist = {}; // tabId -> { stack: [], idx }
let histLoaded = chrome.storage.session.get("navHist").then((v) => Object.assign(navHist, v.navHist || {}));
let navExpect = {}; // tabId -> url we are deliberately moving to via back/forward
const saveHist = () => chrome.storage.session.set({ navHist }).catch(() => {});
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (!info.url) return;
  await histLoaded;
  const h = (navHist[tabId] ||= { stack: [], idx: -1 });
  if (navExpect[tabId]) { // a back/forward we initiated
    const i = h.stack.lastIndexOf(info.url);
    if (i >= 0) h.idx = i;
    delete navExpect[tabId];
  } else if (h.stack[h.idx] !== info.url) {
    h.stack = h.stack.slice(0, h.idx + 1);
    h.stack.push(info.url);
    if (h.stack.length > 50) h.stack.shift();
    h.idx = h.stack.length - 1;
  }
  saveHist();
});
chrome.tabs.onRemoved.addListener((tabId) => { delete navHist[tabId]; saveHist(); });

async function historyStep(tab, dir) {
  await histLoaded;
  const h = navHist[tab.id] || { stack: [tab.url], idx: 0 };
  if (h.stack[h.idx] !== tab.url) { h.stack = [...h.stack.slice(0, h.idx + 1), tab.url]; h.idx = h.stack.length - 1; }
  const want = h.stack[h.idx + dir];
  navExpect[tab.id] = true;
  try { dir < 0 ? await chrome.tabs.goBack(tab.id) : await chrome.tabs.goForward(tab.id); } catch {}
  await new Promise((r) => setTimeout(r, 300));
  await waitForLoad(tab.id);
  const now = await chrome.tabs.get(tab.id);
  if (want && now.url !== want) {
    // Chrome skipped entries (or had none); go to the page the user actually saw.
    navExpect[tab.id] = true;
    await chrome.tabs.update(tab.id, { url: want });
    await new Promise((r) => setTimeout(r, 300));
    await waitForLoad(tab.id);
  }
  h.idx = Math.max(0, Math.min(h.stack.length - 1, h.idx + (want ? dir : 0)));
  navHist[tab.id] = h;
  saveHist();
}

// ---------- action handlers ----------
async function handle(action, p) {
  switch (action) {
    case "ping_info": {
      const [tabs, wins] = await Promise.all([chrome.tabs.query({}), chrome.windows.getAll()]);
      const s = await getSettings();
      return { tabCount: tabs.length, windowCount: wins.length, version: chrome.runtime.getManifest().version, allowScripts: !!s.allowScripts };
    }
    case "list_tabs": {
      const tabs = await chrome.tabs.query({});
      return { tabs: tabs.map(tabSummary) };
    }
    case "search_tabs": {
      const q = (p.query || "").toLowerCase().trim();
      const words = q.split(/\s+/).filter(Boolean);
      const tabs = await chrome.tabs.query({});
      const scored = await Promise.all(tabs.map(async (t) => {
        const hay = `${t.title} ${t.url}`.toLowerCase();
        let score = words.filter((w) => hay.includes(w)).length * 2;
        if (words.length && /^https?:/.test(t.url || "")) {
          try {
            const [r] = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: pageAgent, args: ["text", { maxChars: 30000 }] });
            const body = (r?.result?.text || "").toLowerCase();
            score += words.filter((w) => body.includes(w)).length;
          } catch {}
        }
        return { t, score };
      }));
      return scored
        .filter((x) => !words.length || x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20)
        .map(({ t }) => ({ id: String(t.id), title: t.title || t.url, url: t.url }));
    }
    case "open_url": {
      let url = p.url;
      if (!/^[a-z]+:/i.test(url)) url = "https://" + url;
      let tab;
      if (p.newTab === false) {
        const cur = await resolveTab();
        tab = await chrome.tabs.update(cur.id, { url });
      } else {
        tab = await chrome.tabs.create({ url, active: !p.background });
      }
      if (!p.background) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      await waitForLoad(tab.id);
      return tabSummary(await chrome.tabs.get(tab.id));
    }
    case "navigate": {
      const tab = await resolveTab(p.tabId);
      if (p.url) {
        const url = /^[a-z]+:/i.test(p.url) ? p.url : "https://" + p.url;
        await chrome.tabs.update(tab.id, { url });
      } else if (p.action === "back" || p.action === "forward") {
        await historyStep(tab, p.action === "back" ? -1 : 1);
        return tabSummary(await chrome.tabs.get(tab.id));
      } else if (p.action === "reload") await chrome.tabs.reload(tab.id);
      else throw new Error("Provide url or action");
      await new Promise((r) => setTimeout(r, 300));
      await waitForLoad(tab.id);
      return tabSummary(await chrome.tabs.get(tab.id));
    }
    case "switch_tab": {
      const t = await chrome.tabs.update(p.tabId, { active: true });
      await chrome.windows.update(t.windowId, { focused: true });
      return tabSummary(t);
    }
    case "close_tab":
      await chrome.tabs.remove(p.tabId);
      return { closed: p.tabId };
    case "screenshot": {
      const tab = await resolveTab(p.tabId);
      if (!tab.active) {
        await chrome.tabs.update(tab.id, { active: true });
        await new Promise((r) => setTimeout(r, 350));
      }
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, p.fullQuality ? { format: "png" } : { format: "jpeg", quality: 70 });
      return { dataUrl, url: tab.url, title: tab.title };
    }
    case "read_page": return runInPage(p.tabId, "read", p);
    case "find_elements": return runInPage(p.tabId, "find", p);
    case "get_selection": return runInPage(p.tabId, "selection", p);
    case "scroll": return runInPage(p.tabId, "scroll", p);
    case "wait_for": return runInPage(p.tabId, "wait", p);
    case "click": { const r = await runInPage(p.tabId, "click", p); return afterAction(r.tabId, r); }
    case "type_text": { const r = await runInPage(p.tabId, "type", p); return p.submit ? afterAction(r.tabId, r) : r; }
    case "select_option": return runInPage(p.tabId, "select", p);
    case "press_key": { const r = await runInPage(p.tabId, "key", p); return afterAction(r.tabId, r); }
    case "run_script": {
      const s = await getSettings();
      if (!s.allowScripts) throw new Error("run_script is disabled. The user can enable it in the extension popup.");
      const tab = await resolveTab(p.tabId);
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: async (code) => {
          let v;
          try { v = await new Function(code)(); } catch (e) { return { __error: String(e?.message || e) }; }
          try { return { value: JSON.parse(JSON.stringify(v ?? null)) }; } catch { return { value: String(v) }; }
        },
        args: [p.code],
      });
      if (!res?.result) throw new Error("Script could not run (the page's Content-Security-Policy may block it)");
      if (res.result.__error) throw new Error(res.result.__error);
      return { tabId: tab.id, result: res.result.value };
    }
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

// ---------- lifecycle ----------
chrome.runtime.onInstalled.addListener(connect);
chrome.runtime.onStartup.addListener(connect);
chrome.alarms.create("keepalive", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => a.name === "keepalive" && connect());
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "local" && "allowScripts" in changes && ws?.readyState === WebSocket.OPEN) sendHello(ws, await getSettings());
  if (area !== "local" || !["serverUrl", "token", "enabled"].some((k) => k in changes)) return;
  if (ws) ws.close(1000);
  ws = null; backoff = 1000; connect();
});
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg.type === "getStatus") { reply(status); return; }
  if (msg.type === "reconnect") { backoff = 1000; if (ws) ws.close(1000); ws = null; connect(); reply(true); }
});
connect();
