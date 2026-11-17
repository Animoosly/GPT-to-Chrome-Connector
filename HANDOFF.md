# Handoff: ChatGPT Chrome Connector

_Last updated 2026-11-17. Version 1.2.0 (adds the desktop control panel, tray icon, diagnostics/auto-repair, ngrok, native Windows build)._

## Where the code lives
GitHub: `Animoosly/GPT-to-Chrome-Connector` (branch `main`).
`server/node_modules`, `build/vendor`, `build/out` and `dist/` are build output; see `.gitignore`.

## What it is
Lets the **ChatGPT desktop app** (or chatgpt.com) read and control the user's **real Chrome**, with their tabs and logins.

```
ChatGPT (OpenAI servers) ──HTTPS──▶ tunnel (cloudflared or ngrok) ──▶ local Node MCP server :8765 ──WebSocket──▶ Chrome extension (MV3) ──▶ tabs
                                                                         ├─ control panel (HTML app window, /api/*)
                                                                         └─ tray helper (PowerShell + WinForms)
```
ChatGPT runs connectors server-side, even from the desktop app, so a public HTTPS tunnel is required. ChatGPT adds the connector through **Settings → Apps & Connectors → Advanced → Developer mode → Create**, with "No authentication". The secret is in the URL path: `https://<host>/mcp/<token>`.

## Layout
```
server/index.js         MCP server, extension WS bridge, tunnel manager (cloudflare|ngrok), /api/* for the panel and tray,
                        actions, restart/stop, single instance, packaged-mode behaviour
server/activity.js      Ring buffers: log lines, events, tool calls; counters (last ChatGPT contact, 401s, latency)
server/diagnostics.js   18 checks + autoRepair(); each check returns status/detail/fix-actions
server/desktop.js       Panel window (Chrome/Edge --app with its own profile), tray process manager, start-at-sign-in
                        shortcut, cleanupSweep() used by --stop
server/tray-script.js   The tray helper (PowerShell 5.1 + WinForms), embedded as a string, written to DATA_DIR\tray.ps1
server/gui/             Control panel: style.js (theme), markup.js (HTML), client.js (behaviour, serialized with toString()), page.js
server/test/e2e.mjs     Playwright e2e (needs playwright installed; not run this session)
extension/              MV3 extension. 1.2.0 adds a "hello" message (version/Chrome/allowScripts) and a ping_info action
build/build-windows.ps1 NATIVE Windows build → Inno Setup installer (used this session)
build/installer.iss     Inno Setup 6 script (per-user, no admin)
build/patch-subsystem.cjs  PE console→GUI patch
build/build-windows.sh + installer.nsi   The original Linux/macOS + Wine + NSIS build (not updated or re-run this session, but nothing new needs packaging)
```

## Control panel and tray (new in 1.2.0)
- **Window:** `desktop.js` launches Chrome (or Edge) with `--app=http://127.0.0.1:8765/ --user-data-dir=DATA_DIR\ui-profile`. A separate profile means hiding or closing it never affects the user's own Chrome. The tray finds the window by its **exact title** `ChatGPT Chrome Connector - Control Panel` (`WINDOW_TITLE` in desktop.js and `TITLE` in gui/page.js must match).
- **Tray:** a PowerShell child process, with no secrets. It polls `GET /api/tray/poll?since=<cmdId>` every 1.5s for state, settings and queued commands (`show`, `hide`, `notify`, `exit`) and calls `POST /api/action`. A named mutex keeps it to one icon (exit code 3 = another copy owns it). The icon is drawn at runtime: the app icon plus a status dot. "Minimize to tray" uses ShowWindow(SW_HIDE) on the panel window, and with that setting on, the native minimize button also hides it. Spawn it **without** `detached` (a detached PowerShell gets no console and exits immediately). Pass no empty args (PS 5.1 drops them; the `-` placeholder also breaks, so `none` is used).
- **Window routing:** `POST /api/window {action:"open"}` (from a second launch) asks the tray to restore the existing window. The tray only sends `force:true` after it has looked and found no window, which prevents a loop.
- **Stop:** explicit shutdown keeps HTTP up for ~2s so the tray can receive `exit`, then force-kills it as a backstop. `--stop` additionally runs `cleanupSweep()`, which kills only processes tied to our own paths (ui-profile Chrome, our tray.ps1, cloudflared/ngrok under our folders). The installer relies on `--stop`.
- **Restart:** `restart-server` closes the listener, spawns a copy with `--background --wait-port`, then exits. The tray and window die with the old process on Windows; the new process makes a new tray.
- **Panel security:** unchanged from 1.1. `/` and `/api/*` only for a local Host with no tunnel headers (`cf-*`, `x-forwarded-*`, `ngrok-*`), and POSTs need `x-connector: 1`. `open-link` only opens a fixed list of ngrok URLs.

## Tunnels
- **Cloudflare quick/named:** status becomes `ready` only on `Registered tunnel connection`. The URL printed earlier isn't reachable yet. (1.1 marked it ready on the URL, so a dead tunnel showed green.) Two port-7844 failures before registering set `errorCode: "port-blocked"`.
- **ngrok:** `ngrok http http://127.0.0.1:PORT --log stdout --log-format json --authtoken … [--url https://<static domain>]`. Ready on the JSON line `msg:"started tunnel"`. Auth, domain and already-online errors are fatal (no retry loop). The panel's **Download ngrok** fetches the official zip from bin.equinox.io into DATA_DIR (not bundled: ngrok's license). Config keys: `tunnelProvider`, `ngrokAuthtoken`, `ngrokDomain`.
- Retries back off 5s→60s.

## Test status (this session, on the user's real Windows 11 PC)
| Area | Status |
|---|---|
| Panel: all 7 views, live status, fix buttons, toasts, offline overlay | ✅ Checked in the browser pane and as the real app window |
| Tray: start, hide-to-tray, restore by second launch, tray self-restart after kill, exit on Stop | ✅ |
| Restart connector from the panel, extension reconnects by itself (~2s) | ✅ |
| Extension (in Edge with --load-extension, Chrome-equivalent): auto-pair, hello/version, 10 tool calls via a real MCP client | ✅ (branded Chrome 137+ ignores --load-extension, so real Chrome wasn't automated) |
| Diagnostics (18 checks) + auto-repair fixing a corrupted pairing file | ✅ |
| Real cloudflared on this network | ❌ **Network blocks outbound 7844 (UDP and TCP).** Detected and shown correctly; can't be fixed in-app |
| ngrok provider | ⚠️ Code complete; **not run**. Needs the user's free ngrok account/authtoken, and the download wasn't triggered without the user's OK |
| Native Windows build + silent install + upgrade over a running copy + clean shutdown | ✅ Built with Inno Setup 6 / node 26.11.0 |
| Uninstall | ⚠️ Not run (to keep the user's install) |
| Real ChatGPT connector | ❌ Not possible until a tunnel works (ngrok) |

## Known limitations
- The extension must be loaded **unpacked** by hand (Chrome policy). The installer and exe are **unsigned** (SmartScreen warning).
- Clicks and typing are synthetic DOM events. `run_script` can be blocked by a page's CSP. Cross-origin iframes aren't read.
- The tray needs PowerShell 5.1. Machines that block PowerShell lose the tray (the panel says so; the connector still works).

## Suggested next steps
1. Set up CI (e.g. a GitHub Actions job running build-windows.ps1) and attach installers to releases.
2. User: create a free ngrok account → panel **Settings → Tunnel → ngrok**: Download ngrok, paste authtoken + static domain, Save. Then add the URL to ChatGPT and test for real.
3. Verify the ngrok JSON-log parsing against the real agent output (see `startNgrok()` in index.js).
4. Optional: CDP "trusted input" mode; code signing; make `npm test` (Playwright) part of a build check.
