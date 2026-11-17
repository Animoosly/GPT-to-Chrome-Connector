// Control-panel behaviour. This function is serialized into the page with toString(),
// so it must be self-contained: no imports, no references to module scope.
export function guiClient() {
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function req(method, path, body) {
    const r = await fetch(path, {
      method, cache: "no-store",
      headers: method === "POST" ? { "x-connector": "1", "content-type": "application/json" } : {},
      body: method === "POST" ? JSON.stringify(body || {}) : undefined,
    });
    const ct = r.headers.get("content-type") || "";
    const data = ct.includes("json") ? await r.json().catch(() => ({})) : await r.text();
    if (!r.ok) throw new Error((data && data.error) || r.statusText);
    return data;
  }
  const get = (p) => req("GET", p);
  const post = (p, b) => req("POST", p, b);

  // ---------- formatting ----------
  let clockSkew = 0; // server now - client now
  const now = () => Date.now() + clockSkew;
  function ago(t) {
    if (!t) return "never";
    const s = Math.max(0, Math.round((now() - t) / 1000));
    if (s < 5) return "just now";
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    return Math.round(s / 86400) + " d ago";
  }
  function agoShort(t) {
    if (!t) return "-";
    const s = Math.max(0, Math.round((now() - t) / 1000));
    if (s < 60) return s + "s";
    if (s < 3600) return Math.round(s / 60) + "m";
    if (s < 86400) return Math.round(s / 3600) + "h";
    return Math.round(s / 86400) + "d";
  }
  function dur(ms) {
    const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? d + "d " + h + "h" : h ? h + "h " + m + "m" : m ? m + "m " + (s % 60) + "s" : s + "s";
  }
  const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const ledCls = (st) => "led " + (st || "idle");

  // ---------- toasts & modal ----------
  function toast(msg, level) {
    const el = document.createElement("div");
    el.className = "toast " + (level || "");
    el.innerHTML = "<span>" + esc(msg) + "</span>";
    $("toasts").appendChild(el);
    setTimeout(() => el.remove(), level === "fail" ? 8000 : 4500);
  }
  function confirmBox(title, text, yes, danger) {
    return new Promise((resolve) => {
      $("mTitle").textContent = title;
      $("mText").textContent = text;
      $("mYes").textContent = yes || "OK";
      $("mYes").className = "btn " + (danger ? "danger" : "primary");
      $("modal").classList.add("show");
      const done = (v) => { $("modal").classList.remove("show"); $("mYes").onclick = $("mNo").onclick = null; resolve(v); };
      $("mYes").onclick = () => done(true);
      $("mNo").onclick = () => done(false);
      $("mYes").focus();
    });
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("modal").classList.contains("show")) $("mNo").click(); });

  async function copy(text, label) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select();
      document.execCommand("copy"); t.remove();
    }
    toast((label || "Copied") + " to the clipboard", "ok");
  }
  async function busy(btn, fn) {
    if (btn) btn.classList.add("busy");
    try { return await fn(); } finally { if (btn) btn.classList.remove("busy"); }
  }

  // ---------- navigation ----------
  let view = "";
  function show(v) {
    if (!$("v-" + v)) v = "overview";
    if (v === view) return;
    view = v;
    $$(".view").forEach((el) => el.classList.toggle("on", el.id === "v-" + v));
    $$("#nav button").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
    try { history.replaceState(null, "", "#" + v); } catch {}
    $("main").scrollTop = 0;
    if (v === "diagnostics" && !diag) loadDiagnostics();
    if (v === "log") pollLogs();
    if (v === "activity" || v === "overview") pollActivity();
  }
  $$("#nav button").forEach((b) => (b.onclick = () => show(b.dataset.v)));

  // ---------- status ----------
  let S = null;
  let fails = 0;
  let lastNav = null;
  let browserProbe = { at: 0, ok: null, tabs: null };

  function chain(s) {
    const t = s.tunnel, st = s.stats;
    const recent401 = st.lastUnauthorizedAt && now() - st.lastUnauthorizedAt < 1800000 && (!st.lastChatgptAt || st.lastUnauthorizedAt > st.lastChatgptAt);
    const gpt = recent401 ? ["fail", "OLD URL", "Using an outdated secret"]
      : st.urlStale ? ["warn", "UPDATE", "URL changed since last call"]
      : st.lastChatgptAt ? ["ok", "LINKED", "Last call " + ago(st.lastChatgptAt)]
      : ["idle", "STANDBY", "Waiting for first call"];
    const tun = !t.enabled ? ["idle", "OFF", "Tunnel disabled"]
      : t.status === "ready" ? ["ok", "ONLINE", t.provider === "ngrok" ? "ngrok" + (t.named ? " · static" : "") : t.named ? "Cloudflare named" : "Cloudflare quick"]
      : t.status === "error" ? ["fail", t.errorCode === "port-blocked" ? "BLOCKED" : "FAULT", t.errorCode === "port-blocked" ? "Network blocks port 7844" : /^ngrok-/.test(t.errorCode || "") ? "ngrok needs setup" : "Tunnel failed"]
      : ["warn", t.status === "restarting" ? "RECONNECT" : "STARTING", "Contacting Cloudflare…"];
    const con = ["ok", "RUNNING", "Port " + s.port + " · up " + dur(now() - s.startedAt)];
    const ext = s.extensionConnected ? ["ok", "PAIRED", "v" + ((s.extension && s.extension.version) || "?")] : ["fail", "OFFLINE", "Not connected"];
    const chr = !s.extensionConnected ? ["idle", "UNKNOWN", "Needs the extension"]
      : browserProbe.ok === false ? ["warn", "SLOW", "Not responding"]
      : ["ok", "READY", browserProbe.tabs != null ? browserProbe.tabs + " tabs open" : "Responding"];
    return { gpt, tun, con, ext, chr };
  }

  function setNode(id, n) {
    const el = $(id);
    el.className = "node " + n[0];
    el.querySelector(".led").className = ledCls(n[0]);
    el.querySelector(".ns").innerHTML = "<b class='st-" + n[0] + "'>" + esc(n[1]) + "</b>" + esc(n[2]);
  }
  const linkState = (a) => (a === "ok" ? "ok" : a === "fail" ? "fail" : a === "warn" ? "warn" : "");

  function headline(s, c) {
    // The single most useful thing to tell the user right now, plus a button that fixes it.
    if (!s.extensionConnected && !s.stats.extensionConnects) return ["fail", "The Chrome extension hasn't connected yet. Install it by following Setup, step 2.", ["goto-setup", "Open setup"]];
    if (!s.extensionConnected) return ["fail", "Chrome disconnected. Make sure Chrome is open and the extension is switched on.", ["repair-pairing", "Re-pair extension"]];
    if (s.tunnel.enabled && s.tunnel.status === "error") {
      if (s.tunnel.errorCode === "port-blocked") return ["fail", "This network blocks Cloudflare's tunnel (port 7844), so ChatGPT can't reach this PC. Switch to ngrok, which uses normal HTTPS.", ["goto-tunnel", "Switch to ngrok"]];
      if (/^ngrok-/.test(s.tunnel.errorCode || "")) return ["fail", s.tunnel.error || "ngrok needs setup.", ["goto-tunnel", "Tunnel settings"]];
      return ["fail", "The secure tunnel failed: " + (s.tunnel.error || "unknown error"), ["restart-tunnel", "Restart tunnel"]];
    }
    if (c.gpt[0] === "fail") return ["fail", "ChatGPT is calling with an old secret. Copy the URL below and update the connector in ChatGPT.", ["copy-url", "Copy URL"]];
    if (s.tunnel.enabled && s.tunnel.status !== "ready") return ["warn", "Starting the secure tunnel… " + (s.tunnel.error ? "Last error: " + s.tunnel.error : ""), null];
    if (s.stats.urlStale) return ["warn", "The connector URL changed since ChatGPT last used it. Update it in ChatGPT.", ["copy-url", "Copy URL"]];
    if (!s.tunnel.enabled) return ["warn", "The tunnel is off, so ChatGPT can't reach this computer.", null];
    if (!s.stats.lastChatgptAt) return ["ok", "Everything on this PC is ready. Add the URL below to ChatGPT (see Setup), then use the Chrome connector in a chat.", ["goto-setup", "Setup guide"]];
    return ["ok", "All links are up. ChatGPT can use Chrome.", null];
  }

  function render(s) {
    S = s;
    clockSkew = s.now - Date.now();
    const c = chain(s);
    $("ver").textContent = "v" + s.version;
    $("ovLed").className = "led lg " + s.overall.state;
    $("ovText").textContent = s.overall.summary;
    $("ovUpdated").textContent = "Live · " + clock(s.now);

    setNode("nChatgpt", c.gpt); setNode("nTunnel", c.tun); setNode("nConn", c.con); setNode("nExt", c.ext); setNode("nChrome", c.chr);
    $("l1").className = "link " + linkState(c.gpt[0] === "ok" && c.tun[0] === "ok" ? "ok" : c.gpt[0] === "fail" ? "fail" : c.tun[0] === "ok" ? "" : c.tun[0]);
    $("l2").className = "link " + linkState(c.tun[0]);
    $("l3").className = "link " + linkState(c.ext[0]);
    $("l4").className = "link " + linkState(c.ext[0] === "ok" ? c.chr[0] : "");

    const h = headline(s, c);
    $("chainMsg").className = "chainmsg " + h[0];
    $("cmLed").className = ledCls(h[0]);
    $("cmText").textContent = h[1];
    $("cmAct").innerHTML = h[2] ? "<button class='btn sm " + (h[0] === "ok" ? "" : "primary") + "' data-act='" + h[2][0] + "'>" + esc(h[2][1]) + "</button>" : "";

    // URL plates
    const urlText = s.connectorUrl || (s.tunnel.enabled ? (s.tunnel.status === "error" ? "Tunnel failed. See Diagnostics." : "Waiting for the tunnel…") : s.localMcpUrl + "  (local only)");
    for (const [v, b] of [["cUrl", "copyUrl"], ["cUrl2", "copyUrl2"]]) {
      $(v).textContent = urlText;
      $(v).className = "v" + (s.connectorUrl ? "" : " dim");
      $(b).disabled = !s.connectorUrl;
    }
    const stale = s.stats.urlStale || c.gpt[0] === "fail";
    $("urlAlert").hidden = !stale;
    $("urlAlert").className = "alert" + (c.gpt[0] === "fail" ? " fail" : "");
    $("urlAlertText").textContent = c.gpt[0] === "fail"
      ? "ChatGPT tried an outdated URL " + ago(s.stats.lastUnauthorizedAt) + ". Copy this one and replace the connector URL in ChatGPT."
      : "This URL is new since ChatGPT last connected. Paste it into the connector in ChatGPT.";
    $("urlNote").textContent = s.tunnel.named
      ? "Permanent address (named tunnel). It stays the same across restarts."
      : "ChatGPT reaches your computer through this secret address. Treat it like a password. The free tunnel address changes on restart.";

    // gauges
    $("gCalls").textContent = s.stats.toolCalls;
    $("gErr").textContent = s.stats.toolErrors;
    $("gErrBox").classList.toggle("bad", s.stats.toolErrors > 0);
    $("gLat").innerHTML = s.stats.latency.avg != null ? s.stats.latency.avg + "<small>ms</small>" : "-";
    $("gLast").textContent = s.stats.lastChatgptAt ? agoShort(s.stats.lastChatgptAt) : "never";
    $("gTabs").textContent = s.extensionConnected && browserProbe.tabs != null ? browserProbe.tabs : "-";

    // nav + footer + status bar
    const dc = s.lastDiagnostics && s.lastDiagnostics.counts;
    const nFail = dc ? dc.fail || 0 : 0, nWarn = dc ? dc.warn || 0 : 0;
    $("bDiag").textContent = nFail || nWarn || "";
    $("bDiag").className = "badge" + (nFail ? " show" : nWarn ? " show warn" : "");
    $("bSetup").classList.toggle("show", !s.extensionConnected || (!s.stats.lastChatgptAt && !!s.connectorUrl));
    $("fUp").textContent = dur(now() - s.startedAt);
    $("fPid").textContent = s.pid;
    $("fPort").textContent = s.port;
    $("fMode").textContent = (s.packaged ? "INSTALLED" : "DEV MODE") + " · NODE " + s.node;
    $("sbExt").className = ledCls(c.ext[0]);
    $("sbTun").className = ledCls(c.tun[0]);
    $("sbGpt").className = ledCls(c.gpt[0]);
    $("sbTray").className = ledCls(!s.tray.supported || !s.tray.enabled ? "idle" : s.tray.alive ? "ok" : "warn");
    $("toTray").disabled = !s.tray.alive;
    $("toTray").title = s.tray.alive ? "Hide this window. The connector keeps running in the notification area." : "The notification-area icon isn't running (see Diagnostics).";

    renderSetup(s, c);
    renderSettings(s);

    if (s.nav && lastNav !== null && s.nav.seq !== lastNav && s.nav.view) {
      show(s.nav.view);
      if (s.nav.view === "diagnostics") runDiagnostics();
    }
    if (s.nav) lastNav = s.nav.seq;
  }

  function renderSetup(s, c) {
    const st = (id, state, text) => {
      $(id).classList.toggle("done", state === "ok");
      $(id).querySelector(".led").className = ledCls(state);
      $(id + "s").textContent = text;
      $(id + "s").className = "st-" + state;
    };
    const t = s.tunnel;
    st("st1", !t.enabled ? "warn" : t.status === "ready" ? "ok" : t.status === "error" ? "fail" : "warn",
      !t.enabled ? "Running locally (tunnel off)" : t.status === "ready" ? "Running · tunnel ready" : t.status === "error" ? "Tunnel failed" : t.status === "restarting" ? "Tunnel reconnecting…" : "Starting tunnel…");
    $("st1e").textContent = t.status === "ready" ? "" : t.error || "";
    st("st2", s.extensionConnected ? "ok" : "fail", s.extensionConnected ? "Connected" : "Waiting for the extension…");
    $("extDir").textContent = s.extensionDir;
    st("st3", c.gpt[0] === "ok" ? "ok" : c.gpt[0] === "fail" ? "fail" : c.gpt[0] === "warn" ? "warn" : "idle",
      c.gpt[0] === "ok" ? "ChatGPT connected " + ago(s.stats.lastChatgptAt) : c.gpt[0] === "fail" ? "ChatGPT has an old URL. Update it." : c.gpt[0] === "warn" ? "URL changed. Update it in ChatGPT." : "Waiting for ChatGPT's first call…");
    $("setupUrlNote").hidden = !!t.named;
  }

  let settingsInit = false;
  function renderSettings(s) {
    const u = s.settings.ui;
    const setT = (id, v, dis) => { if (document.activeElement !== $(id)) $(id).checked = !!v; $(id).disabled = !!dis; };
    setT("uTray", u.tray, !s.tray.supported);
    setT("uMin", u.minimizeToTray, !s.tray.supported || !u.tray);
    setT("uNotify", u.notifications, !s.tray.supported || !u.tray);
    setT("uStartup", s.settings.startup, s.settings.startup === null);
    if (!settingsInit) {
      settingsInit = true;
      const mode = s.settings.provider === "ngrok" ? "ngrok" : s.settings.namedTunnel && s.settings.publicUrl ? "named" : "quick";
      $$("input[name=tmode]").forEach((r) => (r.checked = r.value === mode));
      $("pub").value = s.settings.publicUrl;
      $("ngDom").value = s.settings.ngrok.domain;
      tunnelModeUi();
    }
    const ng = s.settings.ngrok;
    $("ngInstLed").className = ledCls(ng.installed ? "ok" : "warn");
    $("ngInst").textContent = ng.installed ? "ngrok is installed" + (ng.hasToken ? " · authtoken saved" : "") : "ngrok isn't installed yet (about 10 MB, from ngrok.com)";
    $("ngInstall").hidden = ng.installed;
    $("ngTok").placeholder = ng.hasToken ? "(saved; leave blank to keep it)" : "Paste your authtoken";
    $("tBlocked").hidden = !(s.tunnel.errorCode === "port-blocked" && s.tunnel.provider === "cloudflare");
    $("cft").placeholder = s.settings.namedTunnel ? "(saved; leave blank to keep it)" : "From Cloudflare Zero Trust → Networks → Tunnels (route it to http://127.0.0.1:" + s.port + ")";
    if (secretShown) $("secret").textContent = s.token;
    const kv = (k, v, btn) => "<span class='k'>" + esc(k) + "</span><span class='v'>" + esc(v) + "</span><span>" + (btn || "") + "</span>";
    $("paths").innerHTML =
      kv("Extension", s.extensionDir, "<button class='btn sm' data-act='open-ext-folder'>Open</button>") +
      kv("Data", s.dataDir, "<button class='btn sm' data-act='open-data-folder'>Open</button>") +
      kv("Log file", s.logPath, "<button class='btn sm' data-act='open-log'>Open</button>") +
      kv("Local MCP", "http://127.0.0.1:" + s.port + "/mcp/<secret>", "");
    $("logPath").textContent = s.logPath;
    $("about").innerHTML =
      kv("Version", "v" + s.version + (s.packaged ? " (installed)" : " (dev)"), "") +
      kv("Extension", s.extension && s.extension.version ? "v" + s.extension.version + " on Chrome " + (s.extension.chrome || "?") : "not connected", "") +
      kv("Runtime", "Node " + s.node + " · " + s.platform, "") +
      kv("Process", "PID " + s.pid + " · started " + new Date(s.startedAt).toLocaleString(), "");
  }

  async function pollStatus() {
    try {
      render(await get("/api/status"));
      if (fails >= 2) { toast("Connector is back online", "ok"); pollActivity(); }
      fails = 0;
      $("offline").classList.remove("show");
    } catch {
      fails++;
      if (fails >= 2) {
        $("offline").classList.add("show");
        $("offTry").textContent = "Retrying… (" + fails + ")";
        $("ovLed").className = "led lg fail";
        $("ovText").textContent = "Connector offline";
      }
    }
  }

  async function probeBrowser() {
    if (!S || !S.extensionConnected || document.hidden) return;
    if (Date.now() - browserProbe.at < 20000) return;
    browserProbe.at = Date.now();
    try {
      const r = await post("/api/action", { name: "test-browser" });
      browserProbe = { at: Date.now(), ok: true, tabs: r.tabs, ms: r.ms };
    } catch { browserProbe = { at: Date.now(), ok: false, tabs: null }; }
    if (S) render(S);
  }

  // ---------- activity ----------
  let callSeq = 0, evSeq = 0;
  let callsArr = [], eventsArr = [];
  async function pollActivity() {
    try {
      const r = await get("/api/activity?since=" + callSeq + "&esince=" + evSeq);
      if (r.calls.length) { callsArr = callsArr.concat(r.calls).slice(-300); callSeq = r.calls[r.calls.length - 1].seq; }
      if (r.events.length) {
        eventsArr = eventsArr.concat(r.events).slice(-300); evSeq = r.events[r.events.length - 1].seq;
        for (const e of r.events) if (e.kind === "repair") repairLine(e);
      }
      renderActivity();
    } catch {}
  }
  function evRow(e) {
    return "<li><span class='tm'>" + clock(e.t) + "</span><span class='" + ledCls(e.level === "error" ? "fail" : e.level === "info" ? "info" : e.level) + "'></span><span>" + esc(e.msg) + "</span></li>";
  }
  function renderActivity() {
    const recent = eventsArr.filter((e) => e.kind !== "repair").slice(-7).reverse();
    $("ovEvents").innerHTML = recent.length ? recent.map(evRow).join("") : "<li class='empty'>No events yet.</li>";
    const all = eventsArr.slice().reverse();
    $("aEvents").innerHTML = all.length ? all.map(evRow).join("") : "<li class='empty'>No events yet.</li>";
    const errOnly = $("aErrOnly").checked, remoteOnly = $("aRemoteOnly").checked;
    const rows = callsArr.filter((c) => (!errOnly || !c.ok) && (!remoteOnly || c.via === "chatgpt")).slice().reverse();
    $("aCalls").innerHTML = rows.map((c) =>
      "<tr><td class='mono'>" + clock(c.t) + "</td><td><span class='" + ledCls(c.ok ? "ok" : "fail") + "' style='width:9px;height:9px;margin-right:7px'></span><b>" + esc(c.tool) + "</b></td>" +
      "<td><span class='src " + esc(c.via) + "'>" + (c.via === "chatgpt" ? "CHATGPT" : "LOCAL") + "</span></td>" +
      "<td class='mono'>" + (c.ms >= 1000 ? (c.ms / 1000).toFixed(1) + " s" : c.ms + " ms") + "</td>" +
      "<td>" + (c.error ? "<div class='err'>" + esc(c.error) + "</div>" : "") + "<div class='args'>" + esc(c.args || "") + "</div></td></tr>").join("");
    $("aEmpty").hidden = rows.length > 0;
    if (S) $("aSum").textContent = S.stats.toolCalls + " calls · " + S.stats.toolErrors + " errors · " + S.stats.mcpRequests + " MCP requests this session";
  }
  $("aErrOnly").onchange = $("aRemoteOnly").onchange = renderActivity;

  // ---------- diagnostics ----------
  let diag = null;
  let repairing = false;
  function renderDiagnostics(d) {
    diag = d;
    if (!d || !d.results || !d.results.length) return;
    const c = d.counts || {};
    $("dPass").textContent = c.pass || 0;
    $("dWarn").textContent = c.warn || 0;
    $("dFail").textContent = c.fail || 0;
    $("dInfo").textContent = (c.info || 0) + (c.skip || 0);
    $("dWhen").textContent = "Last run " + ago(d.at) + " · " + d.ms + " ms";
    const groups = [];
    for (const r of d.results) { let g = groups.find((x) => x.name === r.group); if (!g) groups.push((g = { name: r.group, items: [] })); g.items.push(r); }
    const label = { pass: "Pass", warn: "Warning", fail: "Fault", info: "Info", skip: "Skipped" };
    $("checks").innerHTML = groups.map((g) => "<div class='grp'>" + esc(g.name) + "</div>" + g.items.map((r) =>
      "<div class='chk " + r.status + "'><span class='" + ledCls(r.status) + "'></span>" +
      "<div><div class='cl'>" + esc(r.label) + "</div><span class='cs st-" + r.status + "'>" + label[r.status] + "</span></div>" +
      "<div><div class='cd'>" + esc(r.detail) + "</div>" +
      (r.fixes && r.fixes.length && r.status !== "pass" ? "<div class='fx'>" + r.fixes.map((f) => "<button class='btn sm" + (r.status === "fail" ? " primary" : "") + "' data-act='" + esc(f.action) + "' data-rerun='1'>" + esc(f.label) + "</button>").join("") + "</div>" : "") +
      "</div></div>").join("")).join("");
  }
  async function loadDiagnostics() {
    try {
      const d = await get("/api/diagnostics");
      // Show what we have at once, but refresh anything older than 30s: state changes fast.
      if (d.results && d.results.length) renderDiagnostics(d);
      if (!d.results || !d.results.length || now() - d.at > 30000) runDiagnostics();
    } catch {}
  }
  async function runDiagnostics() {
    const b = $("runDiag");
    if (b.classList.contains("busy")) return;
    await busy(b, async () => {
      $("checks").querySelectorAll(".led").forEach((l) => (l.className = "led idle"));
      $("dWhen").textContent = "Running checks… (up to 20 s)";
      try { renderDiagnostics(await post("/api/diagnostics")); pollStatus(); }
      catch (e) { toast("Diagnostics failed: " + e.message, "fail"); }
    });
  }
  $("runDiag").onclick = runDiagnostics;

  function repairLine(e) {
    const box = $("repairLog");
    box.hidden = false;
    const lvl = e.level === "error" ? "fail" : e.level;
    box.insertAdjacentHTML("beforeend", "<div class='" + lvl + "'><span class='tm'>" + clock(e.t) + "</span>  " + esc(e.msg) + "</div>");
    box.scrollTop = box.scrollHeight;
    if (/^Done\./.test(e.msg) || /crashed/.test(e.msg)) {
      if (repairing) {
        repairing = false;
        $("autoFix").classList.remove("busy");
        toast(e.msg, e.level === "ok" ? "ok" : "warn");
        get("/api/diagnostics").then(renderDiagnostics).catch(() => {});
      }
    }
  }
  async function autoRepair() {
    if (repairing) return;
    show("diagnostics");
    repairing = true;
    $("autoFix").classList.add("busy");
    $("repairLog").innerHTML = "";
    $("repairLog").hidden = false;
    try { await post("/api/action", { name: "auto-repair" }); }
    catch (e) { repairing = false; $("autoFix").classList.remove("busy"); toast(e.message, "fail"); }
    // Progress arrives through the event stream; poll it quickly while repair runs.
    (async () => { while (repairing) { await pollActivity(); await sleep(700); } })();
  }
  $("autoFix").onclick = autoRepair;

  async function report() { return await get("/api/report"); }
  $("copyReport").onclick = async (e) => busy(e.currentTarget, async () => {
    if (!diag) renderDiagnostics(await post("/api/diagnostics"));
    copy(await report(), "Diagnostics report copied");
  });
  $("saveReport").onclick = async (e) => busy(e.currentTarget, async () => {
    if (!diag) renderDiagnostics(await post("/api/diagnostics"));
    const blob = new Blob([await report()], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "chatgpt-chrome-connector-report-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".txt";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast("Report saved to your Downloads folder", "ok");
  });

  // ---------- log ----------
  let logSeq = 0;
  let logArr = [];
  async function pollLogs() {
    try {
      const r = await get("/api/logs?since=" + logSeq);
      if (r.logs.length) { logArr = logArr.concat(r.logs).slice(-1500); logSeq = r.logs[r.logs.length - 1].seq; renderLogs(); }
      else if (!logArr.length) renderLogs();
    } catch {}
  }
  function renderLogs() {
    const lvl = $("lLevel").value, q = $("lFind").value.toLowerCase();
    const rows = logArr.filter((l) => (!lvl || (lvl === "warn" ? l.level !== "info" : l.level === "error")) && (!q || l.msg.toLowerCase().includes(q)));
    const box = $("logbox");
    box.innerHTML = rows.length
      ? rows.map((l) => "<div class='" + l.level + "'><span class='tm'>" + clock(l.t) + "</span><span class='lv'>" + l.level.toUpperCase() + "</span>" + esc(l.msg) + "</div>").join("")
      : "<div style='color:#7f858a'>No log lines" + (lvl || q ? " match the filter." : " yet.") + "</div>";
    if ($("lFollow").checked) box.scrollTop = box.scrollHeight;
  }
  $("lLevel").onchange = renderLogs;
  $("lFind").oninput = renderLogs;
  $("lCopy").onclick = () => copy(logArr.map((l) => new Date(l.t).toISOString() + " " + l.level.toUpperCase() + " " + l.msg).join("\n"), "Log copied");

  // ---------- settings ----------
  async function saveUi(patch) {
    try { render(await post("/api/settings", { ui: patch })); toast("Setting saved", "ok"); }
    catch (e) { toast(e.message, "fail"); pollStatus(); }
  }
  $("uTray").onchange = (e) => saveUi({ tray: e.target.checked });
  $("uMin").onchange = (e) => saveUi({ minimizeToTray: e.target.checked });
  $("uNotify").onchange = (e) => saveUi({ notifications: e.target.checked });
  $("uStartup").onchange = async (e) => {
    try { render(await post("/api/startup", { enabled: e.target.checked })); toast(e.target.checked ? "Will start when you sign in" : "Won't start at sign-in", "ok"); }
    catch (err) { toast(err.message, "fail"); pollStatus(); }
  };
  const tunnelMode = () => ($$("input[name=tmode]").find((r) => r.checked) || {}).value || "quick";
  function tunnelModeUi() {
    const mode = tunnelMode();
    $("namedFields").hidden = mode !== "named";
    $("ngrokFields").hidden = mode !== "ngrok";
    $("tModeHelp").textContent = mode === "named"
      ? "A permanent address on your own domain. Needs a Cloudflare account and a domain on Cloudflare. Route the tunnel's public hostname to http://127.0.0.1:" + (S ? S.port : 8765) + ". Needs outbound port 7844."
      : mode === "ngrok"
      ? "Works on networks that block Cloudflare, because it uses the normal HTTPS port. Needs a free ngrok account. With the free static domain, the URL never changes."
      : "No account needed. The address changes every time the connector restarts. Needs outbound port 7844, which some networks block.";
  }
  $$("input[name=tmode]").forEach((r) => (r.onchange = tunnelModeUi));
  $("saveTun").onclick = (e) => busy(e.currentTarget, async () => {
    $("tunErr").textContent = "";
    const mode = tunnelMode();
    try {
      if (mode === "quick") render(await post("/api/action", { name: "use-free-tunnel" }).then((r) => r.status));
      else if (mode === "ngrok") {
        const body = { provider: "ngrok", ngrokDomain: $("ngDom").value };
        if ($("ngTok").value) body.ngrokAuthtoken = $("ngTok").value;
        render(await post("/api/settings", body));
        $("ngTok").value = "";
      } else {
        const body = { publicUrl: $("pub").value };
        if ($("cft").value) body.cloudflaredToken = $("cft").value;
        render(await post("/api/settings", body));
        $("cft").value = "";
      }
      toast("Tunnel settings saved. Restarting the tunnel…", "ok");
    } catch (err) { $("tunErr").textContent = err.message; }
  });
  let secretShown = false;
  $("revealSecret").onclick = () => {
    secretShown = !secretShown;
    $("revealSecret").textContent = secretShown ? "Hide" : "Show";
    $("secret").textContent = secretShown && S ? S.token : "••••••••••••";
  };
  $("newTok").onclick = async () => {
    if (!(await confirmBox("New secret", "Generate a new secret? ChatGPT loses access until you paste the new connector URL into it. The Chrome extension re-pairs by itself.", "Generate", true))) return;
    try { const r = await post("/api/action", { name: "new-token" }); render(r.status); toast("New secret generated. Copy the new URL into ChatGPT.", "warn"); }
    catch (e) { toast(e.message, "fail"); }
  };
  $("restartSrv").onclick = async () => {
    if (!(await confirmBox("Restart connector", "Restart the connector now? It takes a few seconds." + (S && !S.tunnel.named ? " The free tunnel will get a new URL." : ""), "Restart"))) return;
    try { await post("/api/action", { name: "restart-server" }); toast("Restarting…", "warn"); } catch (e) { toast(e.message, "fail"); }
  };
  $("stopSrv").onclick = async () => {
    if (!(await confirmBox("Stop connector", "Stop the connector? ChatGPT loses access to Chrome until you start it again from the Start menu.", "Stop", true))) return;
    try { await post("/api/action", { name: "stop" }); } catch {}
    toast("Connector stopped", "warn");
  };

  // ---------- generic action buttons ----------
  const actionLabels = {
    "restart-tunnel": "Tunnel restarting", "repair-pairing": "Extension asked to re-pair", "demo-tab": "Opened example.com in Chrome",
    "open-extensions-page": "Opened chrome://extensions in Chrome", "restart-tray": "Tray icon restarting", "kill-stray-cloudflared": "Stray tunnels stopped",
    "use-free-tunnel": "Switched to the free tunnel", "clear-activity": "Activity cleared", "install-ngrok": "ngrok downloaded and installed",
  };
  document.addEventListener("click", async (e) => {
    const go = e.target.closest("[data-go]");
    if (go) { show(go.dataset.go); if (go.dataset.run) runDiagnostics(); return; }
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const name = b.dataset.act;
    if (name === "copy-url") { if (S && S.connectorUrl) copy(S.connectorUrl, "Connector URL copied"); else toast("No public URL yet", "warn"); return; }
    if (name === "goto-setup") { show("setup"); return; }
    if (name === "goto-tunnel") { gotoTunnel(); return; }
    if (name === "auto-repair") { autoRepair(); return; }
    await busy(b, async () => {
      try {
        const r = await post("/api/action", { name });
        if (name === "clear-activity") { callsArr = []; eventsArr = []; renderActivity(); }
        if (r.status) render(r.status);
        if (actionLabels[name]) toast(actionLabels[name] + (r.killed != null ? " (" + r.killed + ")" : ""), "ok");
        if (b.dataset.rerun) { await sleep(name === "restart-tunnel" ? 9000 : 3000); runDiagnostics(); }
        pollActivity();
      } catch (err) { toast(err.message, "fail"); }
    });
  });
  function gotoTunnel() {
    show("settings");
    if (S && S.tunnel.errorCode === "port-blocked" && tunnelMode() !== "ngrok") {
      $$("input[name=tmode]").forEach((r) => (r.checked = r.value === "ngrok"));
      tunnelModeUi();
    }
    setTimeout(() => $("pTunnel").scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }
  document.addEventListener("click", (e) => {
    const l = e.target.closest("[data-link]");
    if (l) post("/api/action", { name: "open-link", link: l.dataset.link }).catch((err) => toast(err.message, "fail"));
  });
  $("copyUrl").onclick = $("copyUrl2").onclick = () => S && S.connectorUrl && copy(S.connectorUrl, "Connector URL copied");
  $("toTray").onclick = async () => {
    try { await post("/api/window", { action: "hide" }); }
    catch (e) { toast(e.message, "warn"); }
  };

  // ---------- loops ----------
  const startHash = (location.hash || "").slice(1);
  show(startHash || "overview");
  // First run: nothing is connected yet, so open on the setup guide instead.
  pollStatus().then(() => { if (S && !S.stats.extensionConnects && !S.stats.lastChatgptAt && view === "overview" && !startHash) show("setup"); });
  pollActivity();
  setInterval(pollStatus, 2000);
  setInterval(() => { if (view === "overview" || view === "activity") pollActivity(); }, 3000);
  setInterval(() => { if (view === "log") pollLogs(); }, 2000);
  setInterval(probeBrowser, 5000);
  setInterval(() => { if (diag && view === "diagnostics") $("dWhen").textContent = "Last run " + ago(diag.at) + " · " + diag.ms + " ms"; }, 5000);
  setTimeout(probeBrowser, 1200);
}
