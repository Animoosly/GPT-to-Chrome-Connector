#!/usr/bin/env node
// ChatGPT <-> Chrome connector
// - Exposes an MCP server (Streamable HTTP) that ChatGPT (desktop/web) adds as a custom connector.
// - Holds a WebSocket to the companion Chrome extension, which executes the browser actions.
// - Serves the local control panel (GUI) and runs the Windows notification-area helper.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { GUI_HTML } from "./gui/page.js";
import { logs, events, calls, stats, event, recordLatency, latencySummary } from "./activity.js";
import { createDiagnostics } from "./diagnostics.js";
import {
  createWindowManager, createTray, openFolder, openInBrowser, openInChrome,
  startupEnabled, setStartup, cleanupSweep,
} from "./desktop.js";
import { WebSocketServer } from "ws";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const VERSION = "1.2.0";

// ---------- config ----------
// PACKAGED is replaced with true by the Windows build (esbuild --define).
const IS_PACKAGED = typeof PACKAGED !== "undefined" && PACKAGED;
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const APP_DIR = IS_PACKAGED ? path.dirname(process.execPath) : path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIR = IS_PACKAGED ? path.join(APP_DIR, "extension") : path.join(APP_DIR, "..", "extension");
const ICON_PATH = IS_PACKAGED ? path.join(APP_DIR, "icon.ico") : path.join(APP_DIR, "..", "build", "assets", "icon.ico");
const DATA_DIR = IS_PACKAGED
  ? path.join(process.env.LOCALAPPDATA || os.homedir(), "ChatGPTChromeConnector")
  : path.join(os.homedir(), ".chatgpt-chrome-connector");
fs.mkdirSync(DATA_DIR, { recursive: true });
const CONFIG_PATH = IS_PACKAGED ? path.join(DATA_DIR, "config.json") : path.join(os.homedir(), ".chatgpt-chrome-connector.json");
const LOG_PATH = path.join(DATA_DIR, "connector.log");

let config = {};
try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); } catch {}
const saveConfig = () => {
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 }); }
  catch (e) { logErr("could not save settings", e.message); }
};
const newToken = () => crypto.randomBytes(24).toString("base64url");
if (!config.token || flag("new-token")) { config.token = newToken(); saveConfig(); }
let TOKEN = process.env.CONNECTOR_TOKEN || config.token;
const PORT = Number(opt("port", process.env.PORT || 8765));
const HOST = opt("host", "127.0.0.1");
const LOCAL_URL = `http://127.0.0.1:${PORT}`;
const USE_TUNNEL = flag("tunnel") || (IS_PACKAGED && !flag("no-tunnel"));
const GUI_MODE = IS_PACKAGED || flag("gui"); // window + tray; in dev only with --gui
const COMMAND_TIMEOUT_MS = 45_000;

const UI_DEFAULTS = { tray: true, minimizeToTray: true, notifications: true };
const ui = () => ({ ...UI_DEFAULTS, ...(config.ui || {}) });

// In the packaged (windowless) app there is no console, so everything goes to a log file.
if (IS_PACKAGED) {
  try { if (fs.statSync(LOG_PATH).size > 2e6) fs.renameSync(LOG_PATH, LOG_PATH + ".old"); } catch {}
  const out = fs.createWriteStream(LOG_PATH, { flags: "a" });
  const write = (...a) => out.write(a.map((x) => (typeof x === "string" ? x : x instanceof Error ? x.stack : JSON.stringify(x))).join(" ") + "\n");
  console.log = console.error = console.warn = console.info = write;
}
process.on("uncaughtException", (e) => logErr("uncaught", e?.stack || e));
process.on("unhandledRejection", (e) => logErr("unhandled rejection", e?.stack || e));

const fmt = (a) => a.map((x) => (typeof x === "string" ? x : x instanceof Error ? x.message : JSON.stringify(x))).join(" ");
function logAt(level, ...a) {
  logs.push({ level, msg: fmt(a) });
  console.error(new Date().toISOString().slice(11, 19), level === "info" ? "" : `[${level}]`, ...a);
}
const log = (...a) => logAt("info", ...a);
const logWarn = (...a) => logAt("warn", ...a);
function logErr(...a) { logAt("error", ...a); }
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const redact = (s) => String(s ?? "").split(TOKEN).join("<secret>");

// Auto-pairing: the extension reads this file from its own folder, so nobody has to paste the token.
function writeExtensionToken() {
  try {
    if (fs.existsSync(path.join(EXTENSION_DIR, "manifest.json"))) {
      fs.writeFileSync(path.join(EXTENSION_DIR, "token.json"),
        JSON.stringify({ token: TOKEN, serverUrl: `ws://127.0.0.1:${PORT}` }));
      return true;
    }
  } catch (e) { logErr("could not write extension token", e.message); }
  return false;
}

// ---------- desktop: window + tray ----------
const startCommand = IS_PACKAGED
  ? { exe: process.execPath, args: [] }
  : { exe: process.execPath, args: [`"${fileURLToPath(import.meta.url)}"`, ...args.filter((a) => !["--background", "--wait-port"].includes(a)).map((a) => (/\s/.test(a) ? `"${a}"` : a))] };
const windows = createWindowManager({ url: LOCAL_URL + "/", dataDir: DATA_DIR, log });
const tray = createTray({ port: PORT, dataDir: DATA_DIR, iconPath: fs.existsSync(ICON_PATH) ? ICON_PATH : "", startCommand, log });
let nav = { seq: 0, view: "" };
const notify = (title, text, level = "info", copy) => { if (ui().notifications) tray.command({ type: "notify", title, text, level, copy }); };

function showWindow(view, force = false) {
  if (view) nav = { seq: nav.seq + 1, view };
  // The tray helper can find and restore an existing (maybe hidden) window; ask it first.
  if (!force && tray.alive()) { tray.command({ type: "show" }); return "tray"; }
  return windows.open();
}

// ---------- extension bridge ----------
let extSocket = null;
let extInfo = null;
const pending = new Map();
let nextId = 1;
let extDisconnectTimer = null;

function callExtension(action, params = {}, timeout = COMMAND_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (!extSocket || extSocket.readyState !== 1) {
      return reject(new Error(
        "Chrome extension is not connected. Open Chrome, make sure the 'ChatGPT Chrome Connector' extension is installed and its popup shows 'Connected'."
      ));
    }
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Browser action '${action}' timed out after ${timeout / 1000}s`));
    }, timeout);
    pending.set(id, { resolve, reject, timer, action, at: Date.now() });
    extSocket.send(JSON.stringify({ id, action, params }));
  });
}

// ---------- MCP tools ----------
const text = (obj) => ({
  content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }],
});
const fail = (e) => ({ isError: true, content: [{ type: "text", text: `Error: ${e.message || e}` }] });
const RO = { readOnlyHint: true, openWorldHint: false };
const ACT = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

const tabId = z.number().int().optional().describe("Tab id from list_tabs. Omit to use the active tab.");
const target = {
  tabId,
  ref: z.number().int().optional().describe("Element ref number from find_elements (preferred)."),
  selector: z.string().optional().describe("CSS selector, used if ref is not given."),
  text: z.string().optional().describe("Visible text to match (e.g. a button label), used if ref/selector are not given."),
};

function summarizeArgs(a) {
  if (!a || typeof a !== "object") return "";
  const parts = [];
  for (const [k, v] of Object.entries(a)) {
    if (v == null) continue;
    let s = typeof v === "string" ? v : JSON.stringify(v);
    if (k === "value" || k === "code") s = `${s.length} chars`; // don't keep typed text / scripts around
    parts.push(`${k}=${s.length > 60 ? s.slice(0, 57) + "…" : s}`);
  }
  return parts.join(" ");
}

function buildServer(via) {
  const server = new McpServer(
    { name: "chrome-connector", version: VERSION },
    {
      instructions:
        "Controls the user's real Chrome browser (their logged-in session). Typical flow: list_tabs or open_url -> read_page to read content -> find_elements to get numbered refs -> click / type_text using those refs -> read_page or screenshot to verify. Refs are invalidated when the page changes; call find_elements again after navigation.",
    }
  );

  const tool = (name, description, schema, annotations, handler) =>
    server.registerTool(name, { description, inputSchema: schema, annotations }, async (a) => {
      const t0 = Date.now();
      stats.toolCalls++;
      let result, error = null;
      try { result = await handler(a); } catch (e) { error = e.message || String(e); result = fail(e); }
      const ms = Date.now() - t0;
      recordLatency(ms);
      if (error) stats.toolErrors++;
      calls.push({ tool: name, via, ok: !error, ms, args: summarizeArgs(a), error: error && redact(error).slice(0, 300) });
      return result;
    });
  const passthrough = (name, description, schema, annotations, action = name) =>
    tool(name, description, schema, annotations, async (a) => text(await callExtension(action, a)));

  // --- ChatGPT search/fetch compatibility (used by Deep Research & standard connector mode) ---
  tool("search", "Search the user's open Chrome tabs by title/URL/page text. Returns tab ids usable with fetch.",
    { query: z.string() }, RO, async ({ query }) => {
      const results = await callExtension("search_tabs", { query });
      return text({ results });
    });
  tool("fetch", "Fetch the full readable text of an open Chrome tab by id (from search or list_tabs).",
    { id: z.string() }, RO, async ({ id }) => {
      const r = await callExtension("read_page", { tabId: Number(id), maxChars: 100_000 });
      return text({ id, title: r.title, text: r.content, url: r.url, metadata: { truncated: r.truncated } });
    });

  // --- tabs & navigation ---
  passthrough("list_tabs", "List all open Chrome tabs (id, title, url, active, windowId).", {}, RO);
  passthrough("open_url", "Open a URL in Chrome. By default opens a new tab and waits for it to load.",
    { url: z.string(), newTab: z.boolean().optional().describe("Default true. If false, navigates the active tab."),
      background: z.boolean().optional().describe("Open without focusing the tab. Default false.") }, ACT);
  passthrough("navigate", "Navigate a tab: to a URL, or 'back' / 'forward' / 'reload'.",
    { tabId, url: z.string().optional(), action: z.enum(["back", "forward", "reload"]).optional() }, ACT);
  passthrough("switch_tab", "Focus a tab (and its window).", { tabId: z.number().int() }, ACT);
  tool("close_tab", "Close a tab.", { tabId: z.number().int() },
    { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    async (a) => text(await callExtension("close_tab", a)));

  // --- reading ---
  passthrough("read_page",
    "Read the page as clean markdown-like text (headings, links, lists, tables). Use offset to page through long content.",
    { tabId, maxChars: z.number().int().optional().describe("Default 20000"),
      offset: z.number().int().optional().describe("Character offset for pagination"),
      selector: z.string().optional().describe("Only read inside this CSS selector") }, RO);
  passthrough("find_elements",
    "List interactive elements (links, buttons, inputs, selects...) visible on the page, each with a numeric ref for click/type_text.",
    { tabId, query: z.string().optional().describe("Filter by text/label/placeholder (case-insensitive)"),
      includeOffscreen: z.boolean().optional().describe("Include elements outside the viewport. Default true."),
      limit: z.number().int().optional().describe("Default 150") }, RO);
  tool("screenshot", "Capture a screenshot of the visible part of a tab (focuses the tab).",
    { tabId, fullQuality: z.boolean().optional() }, RO, async (a) => {
      const r = await callExtension("screenshot", a);
      const [, mime, data] = r.dataUrl.match(/^data:(.+?);base64,(.*)$/);
      return { content: [{ type: "image", data, mimeType: mime }, { type: "text", text: `Screenshot of "${r.title}" (${r.url})` }] };
    });
  passthrough("get_selection", "Get the text the user currently has selected in a tab.", { tabId }, RO);

  // --- interaction ---
  passthrough("click", "Click an element by ref, CSS selector, or visible text.", target, ACT);
  passthrough("type_text", "Type into an input/textarea/contenteditable. Replaces existing value unless append=true.",
    { ...target, value: z.string(), append: z.boolean().optional(),
      submit: z.boolean().optional().describe("Press Enter / submit the form afterwards") }, ACT);
  passthrough("select_option", "Choose an option in a <select> by value or visible label.",
    { ...target, option: z.string() }, ACT);
  passthrough("press_key", "Dispatch a key press (e.g. Enter, Escape, Tab, ArrowDown) to the focused element or a target.",
    { ...target, key: z.string() }, ACT);
  passthrough("scroll", "Scroll the page or an element into view.",
    { tabId, direction: z.enum(["up", "down", "top", "bottom"]).optional(), amount: z.number().optional().describe("Pixels, default one viewport"),
      ref: z.number().int().optional(), selector: z.string().optional() }, RO);
  passthrough("wait_for", "Wait until text or a CSS selector appears on the page (or until the page finishes loading).",
    { tabId, text: z.string().optional(), selector: z.string().optional(),
      timeoutMs: z.number().int().optional().describe("Default 10000, max 30000") }, RO);
  passthrough("run_script",
    "Run a JavaScript expression/function body in the page and return the JSON result. Only available if enabled in the extension popup.",
    { tabId, code: z.string().describe("Function body, e.g. 'return document.title'") },
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true });

  return server;
}

// ---------- tunnel ----------
// Providers:
//  - cloudflare: free quick tunnel (random URL) or a named tunnel (permanent URL, needs a domain).
//    Needs outbound port 7844 (QUIC/UDP or HTTP2/TCP), which some firewalls block.
//  - ngrok: runs over normal HTTPS (port 443). Needs a free ngrok account (authtoken); a static
//    domain gives a permanent URL.
const tunnel = {
  proc: null, url: null, pendingUrl: null, status: "off", error: null, errorCode: null,
  readyAt: null, startedAt: null, retryDelay: 5000, portErrors: 0, notifiedError: null,
};
const NGROK_ZIP_URL = "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip";
const provider = () => (config.tunnelProvider === "ngrok" ? "ngrok" : "cloudflare");

function cloudflaredPath() {
  if (IS_PACKAGED) return path.join(APP_DIR, "cloudflared.exe");
  return process.env.CLOUDFLARED || "cloudflared";
}
function ngrokPath() {
  const exe = process.platform === "win32" ? "ngrok.exe" : "ngrok";
  const candidates = [process.env.NGROK, path.join(DATA_DIR, exe), path.join(APP_DIR, exe)].filter(Boolean);
  return candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}
const namedTunnel = () => provider() === "cloudflare" && !!(config.cloudflaredToken && config.publicUrl);
const stableUrl = () => namedTunnel() || (provider() === "ngrok" && !!config.ngrokDomain);

function stopTunnel() {
  if (tunnel.proc) { tunnel.proc.removeAllListeners("exit"); try { tunnel.proc.kill(); } catch {} }
  Object.assign(tunnel, { proc: null, url: null, pendingUrl: null, status: "off", readyAt: null });
}

function tunnelReady(url) {
  const was = tunnel.url;
  Object.assign(tunnel, { url, status: "ready", error: null, errorCode: null, readyAt: tunnel.readyAt || Date.now(), retryDelay: 5000, portErrors: 0, notifiedError: null });
  if (was !== url) announce();
  else event("tunnel", "Tunnel reconnected", "ok");
}

function tunnelFailed(code, message, { fatal = false } = {}) {
  const prev = tunnel.error;
  tunnel.status = "error"; tunnel.error = message; tunnel.errorCode = code;
  tunnel.url = null; tunnel.readyAt = null;
  if (prev !== message) { logErr("[tunnel]", message); event("tunnel", `Tunnel failed: ${message}`, "error"); }
  if (tunnel.notifiedError !== code) {
    tunnel.notifiedError = code;
    notify("Tunnel failed", code === "port-blocked"
      ? "This network blocks Cloudflare's tunnel. Open the control panel → Settings → Tunnel and switch to ngrok."
      : "ChatGPT can't reach the connector. Open the control panel and run diagnostics.", "error");
  }
  if (fatal && tunnel.proc) { tunnel.proc.removeAllListeners("exit"); try { tunnel.proc.kill(); } catch {} tunnel.proc = null; }
}

function tunnelWarn(message) {
  if (tunnel.error === message) return;
  tunnel.error = message;
  logWarn("[tunnel]", message);
  event("tunnel", `Tunnel problem: ${message}`, "warn");
}

const PORT_BLOCKED_MSG = "This network blocks outbound port 7844, which Cloudflare tunnels need (a firewall, VPN or antivirus is stopping it). Switch to ngrok in Settings → Tunnel: it uses the normal HTTPS port.";

function startCloudflare() {
  const named = namedTunnel();
  const cfArgs = named
    ? ["tunnel", "--no-autoupdate", "run", "--token", config.cloudflaredToken]
    : ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${PORT}`];
  const proc = spawn(cloudflaredPath(), cfArgs, { windowsHide: true });
  const onData = (d) => {
    for (const line of String(d).split("\n")) {
      if (!line.trim()) continue;
      const clean = line.replace(/^\S+Z\s+/, "").trim();
      // Quick-tunnel hosts are random hyphenated words; ignore api.trycloudflare.com in error messages.
      const m = !named && line.match(/https:\/\/(?!api\.)[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/);
      if (m && !tunnel.pendingUrl) { tunnel.pendingUrl = m[0]; log("[tunnel] assigned", m[0], "(waiting for the connection to register)"); }
      // Only a registered edge connection means the URL actually works.
      if (/Registered tunnel connection/i.test(line)) {
        const url = named ? config.publicUrl.replace(/\/+$/, "") : tunnel.pendingUrl;
        if (url) tunnelReady(url);
        continue;
      }
      if (/Unregistered tunnel connection|Lost connection with the edge|Connection terminated/i.test(line) && tunnel.status === "ready") {
        tunnel.status = "restarting";
        event("tunnel", "Tunnel lost its connection to Cloudflare; reconnecting…", "warn");
        continue;
      }
      if (/7844/.test(line) && /timeout|no recent network activity|refused|unreachable|Allow outbound/i.test(line)) {
        tunnel.portErrors++;
        // Two failed attempts with nothing registered = blocked port, not a blip.
        if (tunnel.portErrors >= 2 && tunnel.status !== "ready") tunnelFailed("port-blocked", PORT_BLOCKED_MSG);
        continue;
      }
      if (tunnel.status !== "ready" && tunnel.status !== "error" && /\bERR\b|error="|failed/i.test(line)) {
        tunnelWarn(/no such host|dial tcp|i\/o timeout/i.test(line)
          ? `Can't reach Cloudflare. Check your internet connection, VPN or firewall. Retrying… (${clean.slice(0, 160)})`
          : clean.slice(0, 300));
      }
    }
  };
  proc.stdout.on("data", onData);
  proc.stderr.on("data", onData);
  proc.on("error", (e) => {
    tunnelFailed(e.code === "ENOENT" ? "missing-binary" : "spawn",
      e.code === "ENOENT" ? `cloudflared wasn't found at ${cloudflaredPath()}. Reinstall the connector (antivirus may have removed it).` : e.message,
      { fatal: e.code === "ENOENT" });
  });
  return proc;
}

function startNgrok() {
  const bin = ngrokPath();
  if (!bin) { tunnelFailed("ngrok-missing", "ngrok isn't installed yet. Open Settings → Tunnel and click Download ngrok."); return null; }
  if (!config.ngrokAuthtoken) { tunnelFailed("ngrok-auth", "ngrok needs your authtoken. Paste it under Settings → Tunnel (free at dashboard.ngrok.com)."); return null; }
  const ngArgs = ["http", `http://127.0.0.1:${PORT}`, "--log", "stdout", "--log-format", "json", "--authtoken", config.ngrokAuthtoken];
  if (config.ngrokDomain) ngArgs.push("--url", `https://${config.ngrokDomain}`);
  const proc = spawn(bin, ngArgs, { windowsHide: true });
  const fatalRe = /ERR_NGROK_(4018|105|107|108|8012|302|313|334|15002|9017)|authentication failed|authtoken|is already online|not found or not reserved|reserved for another account/i;
  const onData = (d) => {
    for (const line of String(d).split("\n")) {
      if (!line.trim()) continue;
      let j = null;
      try { j = JSON.parse(line); } catch {}
      if (j && j.msg === "started tunnel" && j.url) { tunnelReady(String(j.url).replace(/\/+$/, "")); continue; }
      const err = j ? (j.err && j.err !== "<nil>" ? j.err : (j.lvl === "eror" || j.lvl === "crit") ? j.msg : null) : (/error|ERR_NGROK/i.test(line) ? line : null);
      if (!err) continue;
      const msg = String(err).replace(/\s+/g, " ").trim().slice(0, 300);
      if (/ERR_NGROK_334|is already online/i.test(msg)) tunnelFailed("ngrok-busy", `This ngrok domain is already in use by another ngrok agent. Stop the other copy (or use a different domain). ${msg}`, { fatal: true });
      else if (/ERR_NGROK_(4018|105|107|108)|authentication failed|authtoken/i.test(msg)) tunnelFailed("ngrok-auth", `ngrok rejected the authtoken. Copy it again from dashboard.ngrok.com → Your Authtoken. (${msg})`, { fatal: true });
      else if (fatalRe.test(msg)) tunnelFailed("ngrok-config", `ngrok: ${msg}`, { fatal: true });
      else if (tunnel.status !== "ready") tunnelWarn(`ngrok: ${msg}`);
    }
  };
  proc.stdout.on("data", onData);
  proc.stderr.on("data", onData);
  proc.on("error", (e) => tunnelFailed("ngrok-missing", `ngrok couldn't start: ${e.message}`, { fatal: true }));
  return proc;
}

function startTunnel() {
  stopTunnel();
  if (!USE_TUNNEL) return;
  // Keep the last error visible while retrying, so the panel doesn't flicker to "fine".
  Object.assign(tunnel, { status: "starting", startedAt: Date.now(), portErrors: 0 });
  let proc;
  try { proc = provider() === "ngrok" ? startNgrok() : startCloudflare(); }
  catch (e) { tunnelFailed("spawn", `Tunnel could not start: ${e.message}`); return; }
  if (!proc) return;
  tunnel.proc = proc;
  proc.on("exit", (code) => {
    log("[tunnel] exited", code);
    if (tunnel.proc !== proc) return;
    tunnel.proc = null;
    const wasReady = tunnel.status === "ready";
    if (tunnel.status !== "error") { tunnel.status = "restarting"; }
    tunnel.url = null; tunnel.readyAt = null;
    stats.tunnelRestarts++;
    const delay = tunnel.retryDelay;
    tunnel.retryDelay = Math.min(tunnel.retryDelay * 2, 60000);
    event("tunnel", `Tunnel stopped (exit ${code}); retrying in ${Math.round(delay / 1000)}s`, "warn");
    if (wasReady) notify("Tunnel dropped", stableUrl() ? "Reconnecting…" : "Reconnecting… The free tunnel's URL will change.", "warn");
    setTimeout(() => { if (!tunnel.proc && !shuttingDown) startTunnel(); }, delay); // keep it alive
  });
}

async function installNgrok() {
  if (process.platform !== "win32") throw new Error("Automatic download is only available on Windows. Install ngrok yourself and set the NGROK environment variable.");
  const zip = path.join(DATA_DIR, "ngrok-download.zip");
  event("tunnel", "Downloading ngrok from ngrok.com…");
  const r = await fetch(NGROK_ZIP_URL, { signal: AbortSignal.timeout(180000) });
  if (!r.ok) throw new Error(`Download failed: HTTP ${r.status}`);
  fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  await new Promise((resolve, reject) => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `Expand-Archive -LiteralPath ${q(zip)} -DestinationPath ${q(DATA_DIR)} -Force`], { windowsHide: true, timeout: 120000 },
    (e) => (e ? reject(new Error(`Couldn't unpack ngrok: ${e.message}`)) : resolve())));
  try { fs.rmSync(zip, { force: true }); } catch {}
  if (!ngrokPath()) throw new Error("ngrok.exe wasn't found after unpacking.");
  event("tunnel", `ngrok installed at ${ngrokPath()}`, "ok");
  return ngrokPath();
}

const connectorUrl = () => (tunnel.url ? `${tunnel.url}/mcp/${TOKEN}` : null);
function announce() {
  const url = connectorUrl();
  log(`connector URL ready: ${tunnel.url}/mcp/<secret>`);
  if (!IS_PACKAGED) console.log(`\n  >>> Paste this into ChatGPT as the connector URL:\n\n      ${url}\n`);
  const hash = crypto.createHash("sha256").update(url).digest("hex").slice(0, 16);
  const changed = config.lastUrlHash && config.lastUrlHash !== hash;
  event("tunnel", `Tunnel ready: ${tunnel.url}`, "ok");
  if (changed) {
    stats.urlChanges++;
    event("url", "The connector URL changed. ChatGPT needs the new URL.", "warn");
    notify("New connector URL", "The connector address changed. Click here to copy it, then update the connector in ChatGPT.", "warn", url);
  }
  if (config.lastUrlHash !== hash) { config.lastUrlHash = hash; saveConfig(); }
}

// ---------- status ----------
function overall() {
  const t = tunnel;
  if (!extSocket) return { state: "fail", summary: "Chrome extension not connected" };
  if (USE_TUNNEL && t.status === "error") {
    return { state: "fail", summary: t.errorCode === "port-blocked" ? "Network blocks the tunnel"
      : t.errorCode === "ngrok-missing" || t.errorCode === "ngrok-auth" ? "ngrok needs setup" : "Tunnel failed" };
  }
  if (USE_TUNNEL && t.status !== "ready") return { state: "warn", summary: t.status === "restarting" ? "Tunnel reconnecting" : "Tunnel starting" };
  if (stats.lastUnauthorizedAt && Date.now() - stats.lastUnauthorizedAt < 30 * 60000 && (!stats.lastChatgptAt || stats.lastUnauthorizedAt > stats.lastChatgptAt))
    return { state: "warn", summary: "ChatGPT is using an old URL" };
  if (stats.lastChatgptUrl && connectorUrl() && stats.lastChatgptUrl !== connectorUrl())
    return { state: "warn", summary: "URL changed: update ChatGPT" };
  if (!USE_TUNNEL) return { state: "warn", summary: "Local only (tunnel off)" };
  return { state: "ok", summary: "Ready" };
}

function statusPayload() {
  const u = ui();
  const d = diagnostics.last();
  return {
    app: "chatgpt-chrome-connector",
    version: VERSION,
    packaged: IS_PACKAGED,
    pid: process.pid,
    node: process.versions.node,
    platform: `${os.type()} ${os.release()}`,
    startedAt: stats.startedAt,
    now: Date.now(),
    extensionConnected: !!extSocket,
    extension: extInfo,
    tunnel: { status: tunnel.status, error: tunnel.error, errorCode: tunnel.errorCode, enabled: USE_TUNNEL, url: tunnel.url, readyAt: tunnel.readyAt,
      provider: provider(), named: stableUrl(), cfNamed: namedTunnel(), restarts: stats.tunnelRestarts },
    connectorUrl: connectorUrl(),
    localMcpUrl: `${LOCAL_URL}/mcp/${TOKEN}`,
    token: TOKEN,
    port: PORT,
    extensionDir: EXTENSION_DIR,
    logPath: LOG_PATH,
    dataDir: DATA_DIR,
    pendingCommands: pending.size,
    settings: {
      publicUrl: config.publicUrl || "",
      provider: provider(),
      ngrok: { installed: !!ngrokPath(), hasToken: !!config.ngrokAuthtoken, domain: config.ngrokDomain || "" },
      namedTunnel: !!config.cloudflaredToken,
      ui: u,
      startup: IS_PACKAGED && process.platform === "win32" ? startupEnabled() : null,
    },
    stats: {
      mcpRequests: stats.mcpRequests, toolCalls: stats.toolCalls, toolErrors: stats.toolErrors,
      lastChatgptAt: stats.lastChatgptAt, unauthorizedRemote: stats.unauthorizedRemote, lastUnauthorizedAt: stats.lastUnauthorizedAt,
      extensionConnects: stats.extensionConnects, extensionDisconnects: stats.extensionDisconnects,
      urlChanges: stats.urlChanges, latency: latencySummary(),
      urlStale: !!(stats.lastChatgptUrl && connectorUrl() && stats.lastChatgptUrl !== connectorUrl()),
    },
    tray: { supported: tray.supported, enabled: u.tray && GUI_MODE, alive: tray.alive() },
    overall: overall(),
    nav,
    lastDiagnostics: d ? { at: d.at, counts: d.counts } : null,
    eventSeq: events.seq,
  };
}

const diagnostics = createDiagnostics({
  state: () => ({
    port: PORT, version: VERSION, packaged: IS_PACKAGED, token: TOKEN, localUrl: LOCAL_URL,
    configPath: CONFIG_PATH, extensionDir: EXTENSION_DIR, extensionConnected: !!extSocket, extInfo,
    tunnelEnabled: USE_TUNNEL, tunnel: { ...tunnel, proc: undefined }, namedTunnel: namedTunnel(), stableUrl: stableUrl(),
    provider: provider(), ngrokPath: ngrokPath(), ngrokToken: !!config.ngrokAuthtoken, ngrokDomain: config.ngrokDomain || "",
    connectorUrl: connectorUrl(), cloudflaredPath: cloudflaredPath(),
    tray: { supported: tray.supported, enabled: ui().tray && GUI_MODE, alive: tray.alive() },
  }),
  callExtension,
  actions: {
    repairPairing: () => actions["repair-pairing"](),
    restartTunnel: () => actions["restart-tunnel"](),
    restartTray: () => actions["restart-tray"](),
    killStray: () => actions["kill-stray-cloudflared"](),
  },
});

// ---------- actions (control panel + tray) ----------
function killStrayCloudflared() {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve({ killed: 0 });
    const own = tunnel.proc?.pid || 0;
    // Only cloudflared processes pointed at OUR port, never unrelated tunnels the user runs.
    const ps = `$n=0; Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" | Where-Object { $_.ProcessId -ne ${own} -and $_.CommandLine -like '*127.0.0.1:${PORT}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $n++ }; $n`;
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, timeout: 20000 },
      (e, out) => resolve({ killed: Number(String(out).trim()) || 0 }));
  });
}

let restarting = false;
function restartServer() {
  if (restarting) return;
  restarting = true;
  log("restart requested");
  event("server", "Connector restarting…", "warn");
  const childArgs = IS_PACKAGED ? ["--background", "--wait-port"] : [fileURLToPath(import.meta.url), ...args.filter((a) => a !== "--background" && a !== "--wait-port"), "--background", "--wait-port"];
  stopTunnel();
  try { extSocket?.close(1012, "restarting"); } catch {}
  httpServer.close();
  httpServer.closeAllConnections?.();
  const child = spawn(process.execPath, childArgs, { detached: true, stdio: "ignore", windowsHide: true, env: process.env });
  child.unref();
  setTimeout(() => process.exit(0), 300);
}

const actions = {
  "repair-pairing": () => {
    const wrote = writeExtensionToken();
    if (extSocket) extSocket.close(4001, "re-pair");
    event("extension", wrote ? "Pairing file rewritten; extension asked to reconnect" : "Could not write the pairing file", wrote ? "info" : "error");
    return { ok: wrote };
  },
  "restart-tunnel": () => {
    if (!USE_TUNNEL) throw new Error("The tunnel is turned off (--no-tunnel).");
    event("tunnel", "Tunnel restart requested");
    stats.tunnelRestarts++;
    startTunnel();
    return { ok: true };
  },
  "kill-stray-cloudflared": async () => {
    const r = await killStrayCloudflared();
    event("tunnel", `Stopped ${r.killed} stray tunnel process(es)`);
    return r;
  },
  "install-ngrok": async () => ({ ok: true, path: await installNgrok() }),
  "use-free-tunnel": () => {
    config.tunnelProvider = "cloudflare"; config.publicUrl = undefined; config.cloudflaredToken = undefined; saveConfig();
    event("tunnel", "Switched to the free quick tunnel");
    startTunnel();
    return { ok: true };
  },
  "new-token": () => {
    config.token = TOKEN = newToken(); saveConfig(); writeExtensionToken();
    if (extSocket) extSocket.close(4001, "token changed");
    event("security", "New secret generated. Update the connector URL in ChatGPT.", "warn");
    return { ok: true };
  },
  "restart-tray": () => { if (!tray.supported) throw new Error("Only available on Windows."); tray.restart(); event("desktop", "Tray icon restarted"); return { ok: true }; },
  "restart-server": () => { setTimeout(restartServer, 200); return { restarting: true }; },
  "stop": () => { log("stop requested"); setTimeout(() => shutdown(true), 200); return { stopping: true }; },
  "open-ext-folder": () => { openFolder(EXTENSION_DIR); return { ok: true }; },
  "open-data-folder": () => { openFolder(DATA_DIR); return { ok: true }; },
  "open-log": () => {
    if (fs.existsSync(LOG_PATH)) { process.platform === "win32" ? execFile("notepad.exe", [LOG_PATH]) : openFolder(DATA_DIR); }
    else openFolder(DATA_DIR);
    return { ok: true };
  },
  "open-extensions-page": () => {
    if (!openInChrome("chrome://extensions")) throw new Error("Couldn't find Chrome. Open chrome://extensions yourself.");
    return { ok: true };
  },
  "open-link": ({ link }) => {
    // Fixed list only: the panel can't make the connector open arbitrary URLs.
    const links = {
      "ngrok-signup": "https://dashboard.ngrok.com/signup",
      "ngrok-token": "https://dashboard.ngrok.com/get-started/your-authtoken",
      "ngrok-domains": "https://dashboard.ngrok.com/domains",
    };
    if (!links[link]) throw new Error("Unknown link");
    openInBrowser(links[link]);
    return { ok: true };
  },
  "open-chatgpt": () => { openInBrowser("https://chatgpt.com/#settings/Connectors"); return { ok: true }; },
  "test-browser": async () => {
    const t0 = Date.now();
    const r = await callExtension("list_tabs", {}, 8000);
    return { ok: true, ms: Date.now() - t0, tabs: r.tabs?.length ?? 0 };
  },
  "demo-tab": async () => {
    const r = await callExtension("open_url", { url: "https://example.com", background: false }, 20000);
    event("extension", "Opened a test tab in Chrome");
    return { ok: true, tab: r };
  },
  "clear-activity": () => { calls.clear(); events.clear(); return { ok: true }; },
  "auto-repair": () => {
    // Long-running; progress streams into the event log. The panel picks it up from there.
    diagnostics.autoRepair((msg, level) => event("repair", msg, level)).catch((e) => event("repair", `Auto-repair crashed: ${e.message}`, "error"));
    return { started: true };
  },
};

// ---------- HTTP server ----------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = "";
    req.on("data", (c) => { d += c; if (d.length > 5e6) req.destroy(); });
    req.on("end", () => { try { resolve(d ? JSON.parse(d) : undefined); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

function authorized(req, url) {
  const parts = url.pathname.split("/").filter(Boolean); // ["mcp", "<token>"]
  if (parts[1] && safeEq(parts[1], TOKEN)) return true;
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") && safeEq(h.slice(7), TOKEN);
}
// Anything relayed by a tunnel: cloudflared adds cf-* headers, ngrok adds x-forwarded-*.
const viaTunnel = (req) => Object.keys(req.headers).some((h) => h.startsWith("cf-") || h === "x-forwarded-for" || h === "x-forwarded-host" || h.startsWith("ngrok-"));

// The control panel shows the token, so it must only ever be reachable from this machine:
// not through the tunnel (cloudflared adds cf-* headers / a public Host), and not from other websites.
function isLocalRequest(req) {
  const host = req.headers.host || "";
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return false;
  if (viaTunnel(req)) return false;
  const origin = req.headers.origin;
  if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return false;
  return true;
}

function diagnosticsReport() {
  const s = statusPayload();
  const d = diagnostics.last();
  const lines = [
    `ChatGPT Chrome Connector diagnostics report`,
    `Generated ${new Date().toISOString()}`,
    `Version ${VERSION} (${IS_PACKAGED ? "installed" : "dev"}), Node ${process.versions.node}, ${s.platform}`,
    `Overall: ${s.overall.state.toUpperCase()}: ${s.overall.summary}`,
    `Extension: ${s.extensionConnected ? `connected (v${extInfo?.version || "?"}, Chrome ${extInfo?.chrome || "?"})` : "NOT connected"}`,
    `Tunnel: ${s.tunnel.enabled ? `${s.tunnel.status}${s.tunnel.named ? " (named)" : " (quick)"}${s.tunnel.url ? " " + s.tunnel.url : ""}${s.tunnel.error ? ` | error: ${s.tunnel.error}` : ""}` : "disabled"}`,
    `Calls: ${stats.toolCalls} (${stats.toolErrors} errors), avg ${s.stats.latency.avg ?? "-"} ms; last ChatGPT contact: ${stats.lastChatgptAt ? new Date(stats.lastChatgptAt).toISOString() : "never"}; rejected (wrong secret): ${stats.unauthorizedRemote}`,
    "",
    "== Checks ==",
    ...(d ? d.results.map((r) => `[${r.status.toUpperCase().padEnd(4)}] ${r.label}: ${r.detail}`) : ["(diagnostics not run yet)"]),
    "",
    "== Recent events ==",
    ...events.items.slice(-40).map((e) => `${new Date(e.t).toISOString().slice(11, 19)} ${e.level.padEnd(5)} ${e.msg}`),
    "",
    "== Recent log ==",
    ...logs.items.slice(-80).map((l) => `${new Date(l.t).toISOString().slice(11, 19)} ${l.level.padEnd(5)} ${l.msg}`),
  ];
  return redact(lines.join("\n"));
}

async function handleApi(req, res, url) {
  const json = (code, obj) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(obj)); };
  const since = Number(url.searchParams.get("since") || 0);
  if (req.method === "GET") {
    switch (url.pathname) {
      case "/api/status": return json(200, statusPayload());
      case "/api/activity": return json(200, { calls: calls.since(since), events: events.since(Number(url.searchParams.get("esince") || 0)), stats: statusPayload().stats });
      case "/api/logs": return json(200, { logs: logs.since(since).map((l) => ({ ...l, msg: redact(l.msg) })) });
      case "/api/diagnostics": return json(200, diagnostics.last() || { results: [] });
      case "/api/report":
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
        return res.end(diagnosticsReport());
      case "/api/tray/poll": {
        const o = overall();
        return json(200, { state: o.state, summary: o.summary, connectorUrl: connectorUrl(), settings: ui(), commands: tray.poll(since) });
      }
    }
    return json(404, { error: "not found" });
  }
  // State-changing calls need a custom header, which cross-site pages cannot send without a CORS preflight we never grant.
  if (req.method !== "POST" || req.headers["x-connector"] !== "1") return json(403, { error: "forbidden" });
  const body = (await readBody(req).catch(() => ({}))) || {};
  switch (url.pathname) {
    case "/api/action": {
      const fn = actions[body.name];
      if (!fn) return json(400, { error: `Unknown action ${body.name}` });
      try { return json(200, { ...(await fn(body)), status: statusPayload() }); }
      catch (e) { return json(400, { error: e.message }); }
    }
    case "/api/diagnostics": return json(200, await diagnostics.run());
    case "/api/window": {
      if (body.action === "hide") {
        if (!tray.alive()) return json(409, { error: "The notification-area icon isn't running, so the window can't be hidden. Minimize it instead, or restart the tray icon from Diagnostics." });
        tray.command({ type: "hide" });
        return json(200, { ok: true });
      }
      if (body.action === "navigate") { nav = { seq: nav.seq + 1, view: String(body.view || "") }; return json(200, { ok: true }); }
      // The tray sends force=true once it has looked for the window itself and found none; anyone
      // else (e.g. launching the app a second time) goes through the tray so a hidden window is restored.
      if (body.action === "open") return json(200, { ok: true, how: showWindow(String(body.view || ""), !!body.force) });
      return json(400, { error: "bad action" });
    }
    case "/api/settings": {
      if (body.ui && typeof body.ui === "object") {
        const next = { ...ui() };
        for (const k of Object.keys(UI_DEFAULTS)) if (typeof body.ui[k] === "boolean") next[k] = body.ui[k];
        const trayChanged = next.tray !== ui().tray;
        config.ui = next; saveConfig();
        if (trayChanged && GUI_MODE) next.tray ? tray.start() : tray.stop();
        return json(200, statusPayload());
      }
      if (body.provider === "ngrok") {
        const domain = String(body.ngrokDomain || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
        if (domain && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return json(400, { error: "The static domain should look like your-name.ngrok-free.app (no https://)." });
        if (body.ngrokAuthtoken !== undefined && String(body.ngrokAuthtoken).trim()) config.ngrokAuthtoken = String(body.ngrokAuthtoken).trim();
        if (!config.ngrokAuthtoken) return json(400, { error: "Paste your ngrok authtoken first (dashboard.ngrok.com → Your Authtoken)." });
        config.tunnelProvider = "ngrok";
        config.ngrokDomain = domain || undefined;
        saveConfig(); startTunnel();
        event("tunnel", `Switched to ngrok${domain ? ` (${domain})` : ""}`);
        return json(200, statusPayload());
      }
      const publicUrl = String(body.publicUrl || "").trim().replace(/\/+$/, "");
      if (publicUrl && !/^https:\/\/[^/\s]+$/.test(publicUrl)) return json(400, { error: "Public URL must look like https://chrome.example.com" });
      config.tunnelProvider = "cloudflare";
      if (publicUrl && !body.cloudflaredToken && !config.cloudflaredToken) return json(400, { error: "A named tunnel needs both the public URL and the Cloudflare tunnel token." });
      config.publicUrl = publicUrl || undefined;
      if (body.cloudflaredToken !== undefined) config.cloudflaredToken = String(body.cloudflaredToken).trim() || undefined;
      saveConfig(); startTunnel();
      event("tunnel", config.publicUrl ? `Named tunnel configured for ${config.publicUrl}` : "Using the free quick tunnel");
      return json(200, statusPayload());
    }
    case "/api/startup": {
      if (!IS_PACKAGED) return json(400, { error: "Start-at-sign-in is only available in the installed app." });
      try { await setStartup(!!body.enabled, process.execPath, fs.existsSync(ICON_PATH) ? ICON_PATH : ""); }
      catch (e) { return json(500, { error: e.message }); }
      return json(200, statusPayload());
    }
    // Backwards-compatible endpoints from v1.1.
    case "/api/stop": json(200, { stopping: true }); log("stop requested"); return setTimeout(() => shutdown(true), 200);
    case "/api/open-folder": openFolder(EXTENSION_DIR); return json(200, { ok: true });
    case "/api/new-token": actions["new-token"](); return json(200, statusPayload());
  }
  return json(404, { error: "not found" });
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const isMcp = url.pathname === "/mcp" || url.pathname.startsWith("/mcp/");

  if (isMcp) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    if (req.method === "OPTIONS") return res.writeHead(204).end();
  }

  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, app: "chatgpt-chrome-connector", extensionConnected: !!extSocket }));
  }

  if (!isMcp) {
    if (!isLocalRequest(req)) return res.writeHead(404).end("not found");
    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
        "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'" });
      return res.end(GUI_HTML);
    }
    if (url.pathname.startsWith("/api/")) return handleApi(req, res, url).catch((e) => {
      logErr("api error", url.pathname, e.message);
      if (!res.headersSent) res.writeHead(500).end(JSON.stringify({ error: e.message }));
    });
    return res.writeHead(404).end("not found");
  }

  const remote = viaTunnel(req);
  if (!authorized(req, url)) {
    if (remote && url.pathname.split("/").filter(Boolean)[1]) {
      stats.unauthorizedRemote++; stats.lastUnauthorizedAt = Date.now();
      if (stats.unauthorizedRemote === 1 || stats.unauthorizedRemote % 20 === 0) {
        event("chatgpt", "Rejected a request with an outdated secret. ChatGPT probably has an old connector URL.", "warn");
        notify("ChatGPT is using an old URL", "Click to copy the current connector URL, then update it in ChatGPT's connector settings.", "warn", connectorUrl());
      }
    }
    res.writeHead(401, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "unauthorized" }));
  }
  if (req.method !== "POST") {
    // Stateless server: no standalone SSE stream / sessions.
    res.writeHead(405, { allow: "POST" });
    return res.end();
  }
  stats.mcpRequests++;
  if (remote && !/connector-selftest/.test(req.headers["user-agent"] || "")) {
    const first = !stats.lastChatgptAt;
    stats.lastChatgptAt = Date.now(); stats.lastChatgptUrl = connectorUrl();
    if (first) event("chatgpt", "ChatGPT connected to the connector", "ok");
  }
  try {
    const body = await readBody(req);
    const server = buildServer(remote ? "chatgpt" : "local");
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    if (body?.method) log("mcp", body.method, body.params?.name || "");
    await transport.handleRequest(req, res, body);
  } catch (e) {
    logErr("mcp error", e?.message || e);
    if (!res.headersSent) res.writeHead(500).end(JSON.stringify({ error: String(e.message || e) }));
  }
});

// ---------- WebSocket for the extension ----------
const wss = new WebSocketServer({ noServer: true });
let lastRejectNote = 0;
httpServer.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://x");
  const origin = req.headers.origin || "";
  if (url.pathname !== "/extension" || !safeEq(url.searchParams.get("token") || "", TOKEN) ||
      !origin.startsWith("chrome-extension://")) {
    if (url.pathname === "/extension" && origin.startsWith("chrome-extension://") && Date.now() - lastRejectNote > 60000) {
      lastRejectNote = Date.now();
      logWarn("extension rejected: wrong token (re-pair from the control panel)");
      event("extension", "Extension tried to connect with an old secret. Use Re-pair.", "warn");
    }
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

wss.on("connection", (ws, req) => {
  if (extSocket && extSocket !== ws) extSocket.close(4000, "replaced by newer connection");
  extSocket = ws;
  extInfo = { origin: req.headers.origin, connectedAt: new Date().toISOString() };
  stats.extensionConnects++;
  log("extension connected", req.headers.origin);
  clearTimeout(extDisconnectTimer);
  event("extension", "Chrome extension connected", "ok");
  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === "ping") return ws.send(JSON.stringify({ type: "pong" }));
    if (msg.type === "hello") {
      extInfo = { ...extInfo, version: msg.version, chrome: msg.chrome, allowScripts: !!msg.allowScripts, ua: msg.ua };
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result);
  });
  ws.on("close", () => {
    if (extSocket === ws) {
      extSocket = null; extInfo = null;
      stats.extensionDisconnects++; stats.lastExtensionDisconnectAt = Date.now();
      log("extension disconnected");
      event("extension", "Chrome extension disconnected", "warn");
      for (const [id, p] of pending) { clearTimeout(p.timer); p.reject(new Error("Chrome extension disconnected during the action")); pending.delete(id); }
      // Only notify if it stays down (Chrome restarts and re-pairs reconnect within seconds).
      clearTimeout(extDisconnectTimer);
      extDisconnectTimer = setTimeout(() => {
        if (!extSocket && !shuttingDown) notify("Chrome disconnected", "The Chrome extension lost its connection. Is Chrome open? Click to troubleshoot.", "warn");
      }, 20000);
    }
  });
});

// ---------- lifecycle ----------
let shuttingDown = false;
function shutdown(explicit = false) {
  if (shuttingDown) return;
  shuttingDown = true;
  stopTunnel();
  try { extSocket?.close(1001); } catch {}
  const waitForTray = explicit && tray.alive();
  if (explicit) windows.close();
  if (explicit) tray.stop(true); // queues "exit"; force-kills it shortly after as a backstop
  // Keep answering HTTP for one tray poll cycle so the icon can pick up its "exit" command.
  setTimeout(() => {
    httpServer.close();
    setTimeout(() => process.exit(0), 300);
  }, waitForTray ? 2000 : 0);
}
process.on("SIGINT", () => shutdown(true));
process.on("exit", () => { try { tunnel.proc?.kill(); } catch {} });
process.on("SIGTERM", () => shutdown(true));

async function existingInstance() {
  try {
    const r = await fetch(`${LOCAL_URL}/health`, { signal: AbortSignal.timeout(1500) });
    return (await r.json()).app === "chatgpt-chrome-connector";
  } catch { return false; }
}

async function main() {
  if (flag("stop")) {
    let wasRunning = false;
    try { await fetch(`${LOCAL_URL}/api/action`, { method: "POST", headers: { "x-connector": "1", "content-type": "application/json" }, body: JSON.stringify({ name: "stop" }) }); wasRunning = true; } catch {}
    // Let it shut down gracefully, then sweep up anything it left behind (used by the installer too).
    if (wasRunning) await new Promise((r) => setTimeout(r, 3000));
    await cleanupSweep({ dataDir: DATA_DIR, appDir: APP_DIR });
    return process.exit(0);
  }
  if (flag("wait-port")) {
    // Restarting: wait for the previous instance to let go of the port.
    for (let i = 0; i < 40 && (await existingInstance()); i++) await new Promise((r) => setTimeout(r, 250));
  }
  if (await existingInstance()) {
    // Already running (e.g. started at login): bring up its control panel.
    if (!flag("background")) {
      try { await fetch(`${LOCAL_URL}/api/window`, { method: "POST", headers: { "x-connector": "1", "content-type": "application/json" }, body: JSON.stringify({ action: "open" }) }); }
      catch { openInBrowser(LOCAL_URL); }
    }
    return process.exit(0);
  }
  httpServer.on("error", (e) => {
    logErr("server error", e.message);
    if (e.code === "EADDRINUSE") {
      logErr(`port ${PORT} is in use by another program`);
      process.exit(1);
    }
  });
  httpServer.listen(PORT, HOST, () => {
    log(`listening on ${LOCAL_URL} (packaged=${IS_PACKAGED}, gui=${GUI_MODE}, data=${DATA_DIR})`);
    event("server", `Connector v${VERSION} started`, "ok");
    writeExtensionToken();
    if (!IS_PACKAGED) {
      console.log(`\nChatGPT Chrome Connector running on http://${HOST}:${PORT}`);
      console.log(`\n  Control panel   : ${LOCAL_URL}/`);
      console.log(`  Extension token : ${TOKEN}`);
      console.log(`  Local MCP URL   : ${LOCAL_URL}/mcp/${TOKEN}`);
      if (!USE_TUNNEL) console.log(`\n  ChatGPT needs a public HTTPS URL. Re-run with --tunnel (uses cloudflared), or point ngrok at port ${PORT}`);
      console.log("");
    }
    startTunnel();
    if (GUI_MODE) {
      if (ui().tray && !flag("no-tray")) tray.start();
      if (!flag("background")) windows.open();
    }
    // First diagnostics pass shortly after start, so the panel has results to show.
    setTimeout(() => diagnostics.run().catch(() => {}), 15000);
  });
}
main();
