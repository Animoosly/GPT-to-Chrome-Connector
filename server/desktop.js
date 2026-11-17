// Desktop integration (Windows): the control-panel window, the system-tray helper and the
// "start at sign-in" shortcut. Everything degrades gracefully on other platforms.
import fs from "node:fs";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { TRAY_PS1 } from "./tray-script.js";

export const WINDOW_TITLE = "ChatGPT Chrome Connector - Control Panel";
const isWin = process.platform === "win32";

export function findBrowser() {
  const env = process.env;
  const candidates = isWin
    ? [
        path.join(env["ProgramFiles"] || "C:/Program Files", "Google/Chrome/Application/chrome.exe"),
        path.join(env["ProgramFiles(x86)"] || "C:/Program Files (x86)", "Google/Chrome/Application/chrome.exe"),
        path.join(env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
        path.join(env["ProgramFiles(x86)"] || "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe"),
        path.join(env["ProgramFiles"] || "C:/Program Files", "Microsoft/Edge/Application/msedge.exe"),
      ]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"];
  return candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

export function findChrome() {
  const env = process.env;
  const candidates = isWin
    ? [
        path.join(env["ProgramFiles"] || "C:/Program Files", "Google/Chrome/Application/chrome.exe"),
        path.join(env["ProgramFiles(x86)"] || "C:/Program Files (x86)", "Google/Chrome/Application/chrome.exe"),
        path.join(env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
      ]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"];
  return candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

export function openInBrowser(url) {
  if (isWin) execFile("cmd", ["/c", "start", "", url], { windowsHide: true });
  else if (process.platform === "darwin") execFile("open", [url]);
  else execFile("xdg-open", [url], () => {});
}

export function openFolder(dir) {
  if (isWin) execFile("explorer", [dir]);
  else if (process.platform === "darwin") execFile("open", [dir]);
  else execFile("xdg-open", [dir], () => {});
}

// Opens a chrome:// page in the user's real Chrome (start/cmd can't open chrome:// URLs).
export function openInChrome(url) {
  const chrome = findChrome();
  if (!chrome) return false;
  spawn(chrome, [url], { detached: true, stdio: "ignore", windowsHide: false }).unref();
  return true;
}

// ---------- control-panel window ----------
// A Chromium "app" window with its own small profile: no tabs or address bar, and it never
// touches the user's real Chrome session (hiding it can't keep their browser alive, etc.).
export function createWindowManager({ url, dataDir, log }) {
  let proc = null;
  const profile = path.join(dataDir, "ui-profile");
  return {
    isOpen: () => !!proc && proc.exitCode === null,
    open() {
      const browser = findBrowser();
      if (!browser) { openInBrowser(url); return "browser"; }
      const w = 1080, h = 740;
      proc = spawn(browser, [
        `--app=${url}`, `--user-data-dir=${profile}`, `--window-size=${w},${h}`,
        "--no-first-run", "--no-default-browser-check", "--disable-extensions",
        "--disable-sync", "--disable-features=Translate,MediaRouter", "--class=ChatGPTChromeConnector",
      ], { stdio: "ignore", windowsHide: false });
      proc.on("error", (e) => { log("[ui] could not open window", e.message); proc = null; openInBrowser(url); });
      proc.on("exit", () => { proc = null; });
      return "app";
    },
    close() { if (proc) { try { isWin ? execFile("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { windowsHide: true }, () => {}) : proc.kill(); } catch {} } },
  };
}

// ---------- tray helper ----------
// A small WinForms script run by the PowerShell that ships with Windows. It polls
// /api/tray/poll for status and commands, so it needs no secrets and no extra binaries.
export function createTray({ port, dataDir, iconPath, startCommand, log }) {
  let proc = null, lastPoll = 0, restarts = 0, wanted = false, timer = null;
  const queue = [];
  let seq = 0;
  const scriptPath = path.join(dataDir, "tray.ps1");

  function spawnTray() {
    if (!isWin || !wanted) return;
    try { fs.writeFileSync(scriptPath, "\ufeff" + TRAY_PS1); } catch (e) { log("[tray] cannot write script", e.message); return; }
    const psArgs = ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
      "-File", scriptPath, "-Port", String(port), "-IconPath", iconPath || "none", "-StartExe", startCommand.exe,
      "-StartArgs", startCommand.args.join(" ") || "none", "-WindowTitle", WINDOW_TITLE];
    const ps = path.join(process.env.SystemRoot || "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
    try {
      // Not detached: a detached PowerShell gets no console and exits at once. A plain child still
      // outlives the connector on Windows, which is what lets the icon survive a restart.
      proc = spawn(fs.existsSync(ps) ? ps : "powershell.exe", psArgs, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    } catch (e) { log("[tray] spawn failed", e.message); proc = null; return; }
    proc.unref();
    log("[tray] started, pid", proc.pid);
    let err = "";
    proc.stderr.on("data", (d) => { err += d; if (err.length > 4000) err = err.slice(-4000); });
    proc.on("error", (e) => { log("[tray] error", e.message); });
    proc.on("exit", (code) => {
      proc = null;
      log("[tray] exited", code, err.trim() ? err.trim().split("\n").slice(-3).join(" | ") : "");
      // Code 3 = another tray already owns the mutex (e.g. kept alive across a restart): not a failure.
      if (!wanted || code === 3 || code === 0) return;
      if (++restarts <= 5) timer = setTimeout(spawnTray, 2000 * restarts);
      else log("[tray] giving up after repeated failures");
    });
  }

  return {
    start() { wanted = true; restarts = 0; if (!proc) spawnTray(); },
    restart() {
      this.stop(false); wanted = true; restarts = 0;
      setTimeout(spawnTray, 800);
    },
    stop(sendExit = true) {
      wanted = false; clearTimeout(timer);
      if (sendExit) this.command({ type: "exit" });
      const p = proc;
      if (p) setTimeout(() => { try { execFile("taskkill", ["/PID", String(p.pid), "/T", "/F"], { windowsHide: true }, () => {}); } catch {} }, sendExit ? 1900 : 0);
    },
    command(cmd) { queue.push({ id: ++seq, ...cmd }); while (queue.length > 30) queue.shift(); },
    poll(since) { lastPoll = Date.now(); return queue.filter((c) => c.id > since); },
    alive: () => Date.now() - lastPoll < 6000,
    supported: isWin,
    lastPollAt: () => lastPoll || null,
  };
}

// ---------- cleanup sweep ----------
// Stops anything this app started that may have outlived it: the panel window (its own Chrome
// profile), the tray helper, and tunnel programs living in our folders. Matching is by our own
// paths only, so the user's own Chrome, PowerShell or tunnels are never touched.
export function cleanupSweep({ dataDir, appDir }) {
  return new Promise((resolve) => {
    if (!isWin) return resolve(0);
    const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
    const ps = [
      `$d=${q(dataDir)}; $a=${q(appDir)}; $n=0`,
      `Get-CimInstance Win32_Process | Where-Object {`,
      `  (($_.Name -eq 'chrome.exe' -or $_.Name -eq 'msedge.exe') -and $_.CommandLine -and $_.CommandLine.Contains($d + '\\ui-profile')) -or`,
      `  ($_.Name -eq 'powershell.exe' -and $_.CommandLine -and $_.CommandLine.Contains($d + '\\tray.ps1')) -or`,
      `  (($_.Name -eq 'cloudflared.exe' -or $_.Name -eq 'ngrok.exe') -and $_.ExecutablePath -and ($_.ExecutablePath.StartsWith($a) -or $_.ExecutablePath.StartsWith($d)))`,
      `} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $n++ }; $n`,
    ].join("\n");
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, timeout: 30000 },
      (e, out) => resolve(Number(String(out || "").trim()) || 0));
  });
}

// ---------- start at sign-in ----------
function startupShortcut() {
  const appData = process.env.APPDATA;
  return appData ? path.join(appData, "Microsoft/Windows/Start Menu/Programs/Startup/ChatGPT Chrome Connector.lnk") : null;
}
export const startupEnabled = () => { const p = startupShortcut(); return !!p && fs.existsSync(p); };
export function setStartup(enabled, exePath, iconPath) {
  return new Promise((resolve, reject) => {
    const lnk = startupShortcut();
    if (!isWin || !lnk) return reject(new Error("Only supported on Windows"));
    if (!enabled) { try { fs.rmSync(lnk, { force: true }); } catch (e) { return reject(e); } return resolve(false); }
    const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
    const script = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut(${q(lnk)});$s.TargetPath=${q(exePath)};` +
      `$s.Arguments='--background';$s.WorkingDirectory=${q(path.dirname(exePath))};` +
      (iconPath ? `$s.IconLocation=${q(iconPath)};` : "") + "$s.Save()";
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 15000 },
      (e) => (e ? reject(e) : resolve(true)));
  });
}
