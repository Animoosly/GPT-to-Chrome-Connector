// Connection diagnostics and automatic repair for the control panel.
// Each check returns { id, group, label, status: pass|warn|fail|info|skip, detail, fixes: [{action,label}] }.
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { execFile } from "node:child_process";
import { stats, logs } from "./activity.js";
import { findChrome } from "./desktop.js";

const ago = (t) => {
  if (!t) return "never";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
const dur = (ms) => {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`;
};
const withTimeout = (p, ms, what) => Promise.race([
  p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000}s`)), ms)),
]);

const FIX = {
  repairPairing: { action: "repair-pairing", label: "Re-pair extension" },
  openExtensions: { action: "open-extensions-page", label: "Open chrome://extensions" },
  openExtFolder: { action: "open-ext-folder", label: "Show extension folder" },
  restartTunnel: { action: "restart-tunnel", label: "Restart tunnel" },
  copyUrl: { action: "copy-url", label: "Copy connector URL" },
  restartTray: { action: "restart-tray", label: "Restart tray icon" },
  openData: { action: "open-data-folder", label: "Open data folder" },
  freeTunnel: { action: "use-free-tunnel", label: "Switch to free tunnel" },
  killStray: { action: "kill-stray-cloudflared", label: "Stop stray tunnels" },
  setup: { action: "goto-setup", label: "Open setup guide" },
  tunnelSettings: { action: "goto-tunnel", label: "Tunnel settings" },
  installNgrok: { action: "install-ngrok", label: "Download ngrok" },
};

function tcpProbe(host, port, timeout) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const sock = net.connect({ host, port });
    const done = (ok, error) => { sock.destroy(); resolve({ ok, ms: Date.now() - t0, error }); };
    sock.setTimeout(timeout, () => done(false, "timeout"));
    sock.once("connect", () => done(true));
    sock.once("error", (e) => done(false, e.code || e.message));
  });
}

async function mcpPost(url, body, headers = {}) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {
    const m = text.match(/^data: (.*)$/m); // SSE fallback
    if (m) try { json = JSON.parse(m[1]); } catch {}
  }
  return { status: r.status, json, text };
}

async function mcpHandshake(url) {
  const t0 = Date.now();
  const init = await mcpPost(url, {
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "connector-selftest", version: "1" } },
  });
  if (init.status !== 200 || !init.json?.result) throw new Error(`initialize returned HTTP ${init.status}: ${init.text.slice(0, 160)}`);
  const list = await mcpPost(url, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { "mcp-protocol-version": init.json.result.protocolVersion || "2025-06-18" });
  const tools = list.json?.result?.tools;
  if (!Array.isArray(tools)) throw new Error(`tools/list returned HTTP ${list.status}: ${list.text.slice(0, 160)}`);
  return { ms: Date.now() - t0, tools: tools.length, server: init.json.result.serverInfo };
}

export function createDiagnostics(ctx) {
  // ctx: live accessors into index.js. See index.js for the shape.
  const checks = [
    { id: "server", group: "Connector", label: "Connector service", run: async () => {
      const s = ctx.state();
      return { status: "pass", detail: `Listening on 127.0.0.1:${s.port}. PID ${process.pid}, up ${dur(Date.now() - stats.startedAt)}, Node ${process.versions.node}, v${s.version}${s.packaged ? "" : " (dev mode)"}.` };
    } },
    { id: "config", group: "Connector", label: "Settings file", run: async () => {
      const s = ctx.state();
      try {
        fs.accessSync(path.dirname(s.configPath), fs.constants.W_OK);
        if (fs.existsSync(s.configPath)) fs.accessSync(s.configPath, fs.constants.R_OK | fs.constants.W_OK);
        return { status: "pass", detail: s.configPath };
      } catch (e) {
        return { status: "fail", detail: `Can't write ${s.configPath} (${e.code || e.message}). Settings and the secret won't be saved. Check folder permissions or antivirus "controlled folder access".`, fixes: [FIX.openData] };
      }
    } },
    { id: "chrome", group: "Chrome", label: "Google Chrome installed", run: async () => {
      const c = findChrome();
      return c ? { status: "pass", detail: c }
        : { status: "warn", detail: "Chrome wasn't found in the usual install folders. If you use a portable or custom-installed Chrome this is fine; otherwise install Chrome from google.com/chrome." };
    } },
    { id: "pairing", group: "Chrome", label: "Pairing file", run: async () => {
      const s = ctx.state();
      if (!fs.existsSync(path.join(s.extensionDir, "manifest.json"))) {
        return { status: "warn", detail: `No extension found in ${s.extensionDir}. Auto-pairing is unavailable; paste the token into the extension popup instead.`, fixes: [FIX.openExtFolder] };
      }
      try {
        const f = JSON.parse(fs.readFileSync(path.join(s.extensionDir, "token.json"), "utf8"));
        if (f.token !== s.token) return { status: "fail", detail: "token.json is out of date, so the extension would use an old secret.", fixes: [FIX.repairPairing] };
        if (!String(f.serverUrl || "").endsWith(`:${s.port}`)) return { status: "fail", detail: `token.json points at ${f.serverUrl}, but the connector is on port ${s.port}.`, fixes: [FIX.repairPairing] };
        return { status: "pass", detail: `token.json matches (server ws://127.0.0.1:${s.port}).` };
      } catch (e) {
        return { status: "fail", detail: `token.json is missing or unreadable (${e.code || e.message}).`, fixes: [FIX.repairPairing] };
      }
    } },
    { id: "extension", group: "Chrome", label: "Extension connected", run: async () => {
      const s = ctx.state();
      if (s.extensionConnected) {
        const e = s.extInfo || {};
        return { status: "pass", detail: `Connected ${ago(Date.parse(e.connectedAt))}${e.chrome ? `, Chrome ${e.chrome}` : ""}${e.version ? `, extension v${e.version}` : ""}.` };
      }
      const never = stats.extensionConnects === 0;
      return {
        status: "fail",
        detail: never
          ? `The extension hasn't connected since the connector started. Usually it isn't installed, is turned off, or Chrome isn't running. Load it unpacked from ${s.extensionDir} at chrome://extensions with Developer mode on.`
          : `The extension disconnected ${ago(stats.lastExtensionDisconnectAt)}. Chrome may be closed, or the extension was turned off or reloaded. It reconnects by itself within ~15s when Chrome is open.`,
        fixes: [FIX.repairPairing, FIX.openExtensions, FIX.openExtFolder],
      };
    } },
    { id: "ext-version", group: "Chrome", label: "Extension version", run: async () => {
      const s = ctx.state();
      if (!s.extensionConnected) return { status: "skip", detail: "Extension not connected." };
      const v = s.extInfo?.version;
      if (!v) return { status: "warn", detail: "The extension is an older build that doesn't report its version. Reload it at chrome://extensions to pick up the latest files.", fixes: [FIX.openExtensions] };
      return v === s.version ? { status: "pass", detail: `v${v} matches the connector.` }
        : { status: "warn", detail: `Extension v${v}, connector v${s.version}. Click the reload icon on the extension's card at chrome://extensions.`, fixes: [FIX.openExtensions] };
    } },
    { id: "roundtrip", group: "Chrome", label: "Browser responds", run: async () => {
      const s = ctx.state();
      if (!s.extensionConnected) return { status: "skip", detail: "Extension not connected." };
      const t0 = Date.now();
      try {
        const r = await ctx.callExtension("ping_info", {}, 6000).catch(async (e) => {
          if (/Unknown action/.test(e.message)) return ctx.callExtension("list_tabs", {}, 6000); // older extension
          throw e;
        });
        const ms = Date.now() - t0;
        const tabs = r.tabCount ?? r.tabs?.length;
        return { status: ms > 2500 ? "warn" : "pass", detail: `Round trip ${ms} ms${tabs != null ? `, ${tabs} open tabs` : ""}.${ms > 2500 ? " Slow: Chrome may be busy or the computer is under load." : ""}` };
      } catch (e) {
        return { status: "fail", detail: `Chrome didn't answer: ${e.message}. The extension's background worker may be stuck.`, fixes: [FIX.repairPairing, FIX.openExtensions] };
      }
    } },
    { id: "mcp-local", group: "Connector", label: "MCP endpoint (local)", run: async () => {
      const s = ctx.state();
      try {
        const r = await mcpHandshake(`${s.localUrl}/mcp/${s.token}`);
        return { status: "pass", detail: `Handshake OK in ${r.ms} ms, ${r.tools} tools available.` };
      } catch (e) {
        return { status: "fail", detail: `Local MCP self-test failed: ${e.message}` };
      }
    } },
    { id: "cloudflared", group: "Tunnel", label: "Tunnel program", run: async () => {
      const s = ctx.state();
      if (!s.tunnelEnabled) return { status: "skip", detail: "Tunnel is turned off (--no-tunnel)." };
      if (s.provider === "ngrok") {
        if (!s.ngrokPath) return { status: "fail", detail: "ngrok isn't installed yet.", fixes: [FIX.installNgrok] };
        if (!s.ngrokToken) return { status: "fail", detail: "ngrok is installed, but no authtoken is saved. Paste it under Settings → Tunnel.", fixes: [FIX.tunnelSettings] };
        return await new Promise((resolve) => execFile(s.ngrokPath, ["version"], { timeout: 10000, windowsHide: true }, (err, out) =>
          resolve(err ? { status: "fail", detail: `ngrok couldn't run: ${err.message}`, fixes: [FIX.installNgrok] }
            : { status: "pass", detail: `${String(out).trim()}${s.ngrokDomain ? `, domain ${s.ngrokDomain}` : ""}` })));
      }
      const bin = s.cloudflaredPath;
      return await new Promise((resolve) => {
        execFile(bin, ["--version"], { timeout: 10000, windowsHide: true }, (err, out, errOut) => {
          if (err) {
            resolve({ status: "fail", detail: err.code === "ENOENT"
              ? `cloudflared not found at ${bin}. Reinstall the connector, or install cloudflared and put it on PATH. Antivirus software sometimes quarantines it.`
              : `cloudflared couldn't run: ${err.message}`, fixes: [FIX.openData] });
          } else resolve({ status: "pass", detail: String(out || errOut).trim().split("\n")[0] });
        });
      });
    } },
    { id: "internet", group: "Tunnel", label: "Internet and Cloudflare reachable", run: async () => {
      const t0 = Date.now();
      try {
        const r = await fetch("https://www.cloudflare.com/cdn-cgi/trace", { signal: AbortSignal.timeout(8000) });
        const txt = await r.text();
        const colo = (txt.match(/^colo=(\w+)/m) || [])[1];
        const warp = (txt.match(/^warp=(\w+)/m) || [])[1];
        return { status: "pass", detail: `Reached Cloudflare in ${Date.now() - t0} ms${colo ? ` (data center ${colo})` : ""}${warp && warp !== "off" ? `, WARP ${warp}` : ""}.` };
      } catch (e) {
        return { status: "fail", detail: `Can't reach Cloudflare (${e.cause?.code || e.message}). Check the internet connection, VPN, proxy or firewall. Corporate networks often block tunnels.` };
      }
    } },
    { id: "tunnel-port", group: "Tunnel", label: "Cloudflare tunnel port (7844)", run: async () => {
      const s = ctx.state();
      if (!s.tunnelEnabled || s.provider !== "cloudflare") return { status: "skip", detail: "Only needed for Cloudflare tunnels." };
      const hosts = ["region1.v2.argotunnel.com", "region2.v2.argotunnel.com"];
      const results = await Promise.all(hosts.map((h) => tcpProbe(h, 7844, 6000)));
      const open = results.filter((r) => r.ok);
      if (open.length) return { status: "pass", detail: `Outbound TCP 7844 to Cloudflare is open (${open[0].ms} ms).` };
      return {
        status: "fail",
        detail: `Can't open port 7844 to Cloudflare (${results.map((r) => r.error).join(", ")}). Your network, VPN or security software blocks it, so no Cloudflare tunnel can work here. Switch to ngrok, which uses the normal HTTPS port 443.`,
        fixes: [FIX.tunnelSettings],
      };
    } },
    { id: "tunnel", group: "Tunnel", label: "Secure tunnel", run: async () => {
      const s = ctx.state();
      if (!s.tunnelEnabled) return { status: "skip", detail: "Tunnel is turned off. ChatGPT can't reach a local-only connector." };
      const t = s.tunnel;
      const kind = s.provider === "ngrok" ? `ngrok tunnel${s.ngrokDomain ? " (static domain)" : ""}` : s.namedTunnel ? "Cloudflare named tunnel" : "Free Cloudflare quick tunnel";
      if (t.status === "ready") return { status: "pass", detail: `${kind} connected${t.readyAt ? ` ${ago(t.readyAt)}` : ""}: ${t.url}` };
      if (t.status === "starting" || t.status === "restarting") {
        return { status: "warn", detail: `${kind} is ${t.status === "starting" ? "connecting" : "reconnecting"}${t.error ? `. Last problem: ${t.error}` : "…"}`, fixes: [FIX.restartTunnel] };
      }
      const fixes = t.errorCode === "port-blocked" || /^ngrok-(auth|config|busy)$/.test(t.errorCode || "") ? [FIX.tunnelSettings]
        : t.errorCode === "ngrok-missing" ? [FIX.installNgrok, FIX.tunnelSettings]
        : s.namedTunnel ? [FIX.restartTunnel, FIX.freeTunnel] : [FIX.restartTunnel, FIX.killStray];
      return { status: "fail", detail: `${kind} failed: ${t.error || t.status}`, fixes };
    } },
    { id: "public", group: "Tunnel", label: "Public URL answers", run: async () => {
      const s = ctx.state();
      if (!s.tunnel.url) return { status: "skip", detail: "No public URL yet." };
      const t0 = Date.now();
      try {
        const r = await fetch(`${s.tunnel.url}/health`, { signal: AbortSignal.timeout(12000) });
        const j = await r.json().catch(() => ({}));
        if (j.app !== "chatgpt-chrome-connector") {
          return { status: "fail", detail: `${s.tunnel.url} answered HTTP ${r.status}, but not from this connector.${s.namedTunnel ? " Check the tunnel's public hostname routes to http://127.0.0.1:" + s.port + "." : ""}`, fixes: [FIX.restartTunnel] };
        }
        return { status: "pass", detail: `Reached this connector through the internet in ${Date.now() - t0} ms.` };
      } catch (e) {
        const young = s.tunnel.readyAt && Date.now() - s.tunnel.readyAt < 60000;
        const code = e.cause?.code || e.message;
        return {
          status: young ? "warn" : "fail",
          detail: young
            ? `Not reachable yet (${code}). New tunnel addresses can take up to a minute to appear in DNS. Run the checks again shortly.`
            : `The tunnel is up, but ${s.tunnel.url} doesn't answer (${code}). Your DNS may have cached a failed lookup. Restarting the tunnel gets a fresh address.`,
          fixes: [FIX.restartTunnel],
        };
      }
    } },
    { id: "mcp-public", group: "Tunnel", label: "MCP through tunnel (what ChatGPT sees)", run: async () => {
      const s = ctx.state();
      if (!s.connectorUrl) return { status: "skip", detail: "No public URL yet." };
      try {
        const r = await mcpHandshake(s.connectorUrl);
        return { status: "pass", detail: `ChatGPT-style handshake OK in ${r.ms} ms, ${r.tools} tools listed.` };
      } catch (e) {
        return { status: "fail", detail: `Handshake through the public URL failed: ${e.cause?.code || e.message}`, fixes: [FIX.restartTunnel] };
      }
    } },
    { id: "chatgpt", group: "ChatGPT", label: "ChatGPT contact", run: async () => {
      const s = ctx.state();
      const recent401 = stats.lastUnauthorizedAt && Date.now() - stats.lastUnauthorizedAt < 30 * 60000;
      if (recent401 && (!stats.lastChatgptAt || stats.lastUnauthorizedAt > stats.lastChatgptAt)) {
        return { status: "fail", detail: `Rejected ${stats.unauthorizedRemote} request(s) with a wrong secret, the last ${ago(stats.lastUnauthorizedAt)}. ChatGPT is probably using an old connector URL. Copy the current URL and update the connector in ChatGPT's settings.`, fixes: [FIX.copyUrl, FIX.setup] };
      }
      if (!stats.lastChatgptAt) {
        return { status: "info", detail: "ChatGPT hasn't called the connector since it started. That's normal until you use it in a chat. If ChatGPT says it can't reach the connector, check that its URL matches the one on the Overview tab.", fixes: [FIX.copyUrl] };
      }
      if (s.connectorUrl && stats.lastChatgptUrl && stats.lastChatgptUrl !== s.connectorUrl) {
        return { status: "warn", detail: `ChatGPT last connected ${ago(stats.lastChatgptAt)}, but the connector URL has changed since then. Update the URL in ChatGPT (Settings → Apps & Connectors → your connector).`, fixes: [FIX.copyUrl, FIX.setup] };
      }
      return { status: "pass", detail: `Last request from ChatGPT ${ago(stats.lastChatgptAt)}. ${stats.toolCalls} tool calls this session.` };
    } },
    { id: "tray", group: "Desktop", label: "Notification-area icon", run: async () => {
      const s = ctx.state();
      if (!s.tray.supported) return { status: "skip", detail: "Only available on Windows." };
      if (!s.tray.enabled) return { status: "info", detail: "Turned off in Settings." };
      return s.tray.alive ? { status: "pass", detail: "Running." }
        : { status: "warn", detail: "The tray helper isn't responding. PowerShell may be blocked by policy on this PC. The connector still works without it.", fixes: [FIX.restartTray] };
    } },
    { id: "scripts", group: "Chrome", label: "Custom JavaScript (run_script)", run: async () => {
      const s = ctx.state();
      if (!s.extensionConnected || s.extInfo?.allowScripts == null) return { status: "skip", detail: "Unknown until the extension connects." };
      return { status: "info", detail: s.extInfo.allowScripts ? "Allowed. ChatGPT can run custom JavaScript in your pages." : "Off (the safer default). Turn it on in the extension popup if you need it." };
    } },
    { id: "errors", group: "Connector", label: "Recent errors", run: async () => {
      const cutoff = Date.now() - 15 * 60000;
      // Tunnel errors have their own check above; don't report them twice.
      const errs = logs.items.filter((l) => l.level === "error" && l.t > cutoff && !l.msg.startsWith("[tunnel]"));
      if (!errs.length) return { status: "pass", detail: "No errors in the last 15 minutes." };
      return { status: "warn", detail: `${errs.length} error(s) in the last 15 minutes. Latest: ${errs[errs.length - 1].msg.slice(0, 220)}` };
    } },
  ];

  let running = null;
  let last = null;

  async function run() {
    if (running) return running;
    running = (async () => {
      const t0 = Date.now();
      const results = await Promise.all(checks.map(async (c) => {
        const base = { id: c.id, group: c.group, label: c.label };
        try {
          const r = await withTimeout(c.run(), 20000, c.label);
          return { ...base, fixes: [], ...r };
        } catch (e) {
          return { ...base, status: "fail", detail: `Check crashed: ${e.message}`, fixes: [] };
        }
      }));
      const counts = results.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
      last = { at: Date.now(), ms: Date.now() - t0, counts, results };
      return last;
    })();
    try { return await running; } finally { running = null; }
  }

  // Applies the safe fixes in dependency order, re-checking between steps.
  async function autoRepair(progress = () => {}) {
    const steps = [];
    const step = (msg, level = "info") => { steps.push({ t: Date.now(), msg, level }); progress(msg, level); };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (pred, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (pred()) return true; await wait(500); } return pred(); };

    step("Running diagnostics…");
    let d = await run();
    const bad = (id) => ["fail", "warn"].includes(d.results.find((r) => r.id === id)?.status);

    if (bad("pairing") || bad("extension") || bad("roundtrip")) {
      step("Re-writing the pairing file and asking the extension to reconnect…");
      ctx.actions.repairPairing();
      const ok = await until(() => ctx.state().extensionConnected, 12000);
      if (ok) {
        await wait(500);
        try { await ctx.callExtension("list_tabs", {}, 6000); step("Chrome extension is connected and responding.", "ok"); }
        catch (e) { step(`Extension connected but not responding: ${e.message}`, "warn"); }
      } else {
        step("The extension still isn't connected. Make sure Chrome is open and the extension is installed and switched on (chrome://extensions).", "warn");
      }
    }

    const s = ctx.state();
    const needsUser = s.tunnel.errorCode === "port-blocked" || bad("tunnel-port") || /^ngrok-(auth|missing|config|busy)$/.test(s.tunnel.errorCode || "");
    if (s.tunnelEnabled && needsUser && (bad("tunnel") || bad("tunnel-port"))) {
      step(s.provider === "cloudflare"
        ? "This network blocks Cloudflare's tunnel port (7844), so restarting it can't help. Switch to ngrok under Settings → Tunnel. It works over normal HTTPS."
        : `The ngrok tunnel needs your attention: ${s.tunnel.error || "check Settings → Tunnel"}`, "fail");
    } else if (s.tunnelEnabled && (bad("tunnel") || bad("public") || bad("mcp-public"))) {
      if (bad("tunnel") && /already|in use|stray/i.test(s.tunnel.error || "")) {
        step("Stopping stray tunnel processes…");
        await ctx.actions.killStray().catch(() => {});
      }
      step("Restarting the secure tunnel (this gives a new public URL for the free tunnel)…");
      ctx.actions.restartTunnel();
      const ok = await until(() => ctx.state().tunnel.status === "ready", 30000);
      if (ok) {
        step(`Tunnel is back up: ${ctx.state().tunnel.url}`, "ok");
        step("Waiting for the new address to become reachable…");
        let reach = false;
        for (let i = 0; i < 8 && !reach; i++) {
          try {
            const r = await fetch(`${ctx.state().tunnel.url}/health`, { signal: AbortSignal.timeout(6000) });
            reach = (await r.json()).app === "chatgpt-chrome-connector";
          } catch {}
          if (!reach) await wait(4000);
        }
        step(reach ? "Public URL reachable from the internet." : "Public URL not reachable yet. DNS can lag; run diagnostics again in a minute.", reach ? "ok" : "warn");
        if (!ctx.state().stableUrl) step("The connector URL changed. Copy the new one into ChatGPT.", "warn");
      } else {
        step(`Tunnel didn't come up: ${ctx.state().tunnel.error || "unknown error"}`, "fail");
      }
    }

    if (bad("tray") && s.tray.enabled) {
      step("Restarting the notification-area icon…");
      ctx.actions.restartTray();
    }

    step("Re-checking everything…");
    d = await run();
    const fails = d.results.filter((r) => r.status === "fail");
    step(fails.length ? `Done. ${fails.length} problem(s) still need attention: ${fails.map((f) => f.label).join(", ")}.` : "Done. No blocking problems left.", fails.length ? "warn" : "ok");
    return { steps, diagnostics: d };
  }

  return { run, autoRepair, last: () => last, ago };
}
