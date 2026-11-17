# ChatGPT Chrome Connector

Lets the **ChatGPT desktop app** (or chatgpt.com) read and control your **real Chrome browser**: your tabs, your logged-in sessions, your cookies. There are no remote browsers and no copy-paste.

```
ChatGPT desktop ──HTTPS──▶ tunnel ──▶ local server (MCP) ──WebSocket──▶ Chrome extension ──▶ your tabs
```

- `server/`: a small Node.js MCP server (Streamable HTTP). It is what you add to ChatGPT as a connector.
- `extension/`: a Chrome extension (Manifest V3) that does the work inside Chrome.

> **Why a tunnel?** ChatGPT runs connectors from OpenAI's servers, even when you use the desktop app, so it can't reach `localhost` directly. The server prints a public HTTPS URL with a secret token in it. Only the server is exposed. The extension still talks to it over `127.0.0.1`.

## Install on Windows (recommended)

1. Run **`ChatGPTChromeConnector-Setup-1.2.0.exe`**. It installs per user and needs no admin rights.
   Windows SmartScreen may say "Windows protected your PC" because the installer isn't code-signed. Click **More info → Run anyway**.
2. When it finishes, the connector starts and its **control panel** opens in its own window. Its **Setup** tab walks you through the rest:
   - **Load the Chrome extension**: open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the folder the page shows. The page's "Open folder" button opens it for you. The extension **pairs automatically**, with no token to paste. (Chrome only allows extensions from the Web Store to be installed automatically, so this one manual step is unavoidable.)
   - **Add it to ChatGPT**: click **Copy URL**, then in ChatGPT go to **Settings → Apps & Connectors → Advanced settings**, turn on **Developer mode**, click **Create**, paste the URL, choose **No authentication**, and create it. In a chat, click **+ → Developer mode** and enable **Chrome**.

What the installer sets up:
- `ChatGPTChromeConnector.exe` runs in the background with no console window. Start Menu entries: *ChatGPT Chrome Connector* (start, or open the control panel), *Stop ChatGPT Chrome Connector*, and *Uninstall*.
- A **notification-area (tray) icon** whose colored dot shows the state (green = ready, amber = attention, red = fault). Click it to open the control panel. Right-click it for: copy connector URL, run diagnostics, auto-repair, restart tunnel, re-pair extension, restart, and stop. It pops up a notification when the connector URL changes or Chrome disconnects.
- An optional **start when I sign in** setting, on by default, so ChatGPT can always reach Chrome.
- A bundled `cloudflared.exe` for the secure tunnel, so there's nothing else to install.
- Settings and the log live in `%LOCALAPPDATA%\ChatGPTChromeConnector`. Uninstall from *Settings → Apps* or the Start Menu.

> **The free tunnel URL changes when the connector restarts**, for example after a reboot. The control panel and tray always show the current URL, and notify you when it changes. For a URL that never changes, use **ngrok with its free static domain**, or a Cloudflare named tunnel, under **Settings → Tunnel**.

> **Work, school or corporate network?** Cloudflare tunnels need outbound port **7844**, which many firewalls block. The panel detects this ("Network blocks the tunnel"). Switch to **ngrok** under **Settings → Tunnel**: it uses the normal HTTPS port 443. You need a free ngrok account: paste its authtoken and, ideally, your free static domain. The panel downloads ngrok for you.

## The control panel

The window opens on start, and from the tray icon or Start menu at any time. Closing or minimizing it keeps the connector running in the notification area. Its tabs:

| Tab | What it's for |
|---|---|
| **Overview** | Live signal path *ChatGPT → Tunnel → Connector → Extension → Chrome* with a lamp per link, the connector URL with Copy, readouts (tool calls, errors, response time, last ChatGPT call, open tabs), quick actions, recent events. The top line always says the most useful thing to do next, with a button that does it. |
| **Setup** | The three install steps; each lamp turns green by itself. |
| **Diagnostics** | 18 checks from the settings file to "MCP through the tunnel, as ChatGPT sees it", each with a plain explanation and fix buttons. **Auto-repair** re-pairs the extension and restarts the tunnel/tray as needed, then re-checks. **Copy/Save report** produces a support report with the secret removed. |
| **Activity** | Every tool call (source ChatGPT/local, duration, errors) and connection event. |
| **Log** | The service log with level filter, search, copy, and open-file buttons. |
| **Settings** | Tray icon, minimize-to-tray, notifications, start at sign-in; tunnel provider (Cloudflare quick / Cloudflare named / ngrok); connector secret; restart/stop. |
| **Help** | Troubleshooting for common problems. |

## Manual setup (macOS / Linux / developers)

### 1. Start the server
Needs Node 20+ and [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) (`brew install cloudflared`).

```bash
cd server
npm install
npm run tunnel
```

It prints the **connector URL** (`https://xxxx.trycloudflare.com/mcp/<token>`) and also shows it at `http://127.0.0.1:8765/`. The token is saved in `~/.chatgpt-chrome-connector.json`. Run with `-- --new-token` to rotate it. With ngrok instead: `npm start` plus `ngrok http 8765`.

### 2. Load the extension
`chrome://extensions` → **Developer mode** → **Load unpacked** → choose `extension/`. It auto-pairs from the `token.json` the server writes into that folder. You can also paste the token in the extension popup.

### 3. Add it to ChatGPT
Same as the Windows steps above.

(OpenAI renames these menus now and then. If they've moved, look for "Developer mode" or "custom connector/app".)

## Tools exposed to ChatGPT

| Tool | What it does |
|---|---|
| `list_tabs`, `switch_tab`, `close_tab` | Tab management |
| `open_url`, `navigate` (url / back / forward / reload) | Navigation, waits for the page to load |
| `read_page` | Page as clean markdown (headings, links, lists, tables, form fields), paginated, can be limited to a CSS selector |
| `find_elements` | Numbered refs for every visible link, button, input and so on |
| `click`, `type_text`, `select_option`, `press_key`, `scroll` | Interaction by ref, CSS selector, or visible text. Works with React/Vue inputs and contenteditable editors |
| `wait_for` | Waits for text or a selector to appear |
| `screenshot` | Image of the visible tab |
| `get_selection` | Whatever text you've highlighted |
| `search`, `fetch` | The standard ChatGPT connector pair (searches open tabs), so Deep Research can use it too |
| `run_script` | Arbitrary JS in the page. **Off by default**, enable it in the popup |

Read-only tools are marked `readOnlyHint`, so ChatGPT only asks for confirmation on actions that change something.

## Security notes
- Anyone with the connector URL can drive your browser while the server and tunnel run. Treat it like a password. Use `--new-token` if it leaks, and stop the server when you're done.
- The extension only accepts a WebSocket on `127.0.0.1` with the token, from a `chrome-extension://` origin.
- Chrome blocks extensions on `chrome://` pages and the Chrome Web Store, so the connector can't touch those.
- A page you visit could contain text aimed at manipulating ChatGPT (prompt injection). Keep an eye on what it does on sensitive sites.

## Troubleshooting
- **"Chrome extension is not connected"**: make sure the connector is running (open the setup page from the Start Menu) and Chrome is open. The extension popup shows the connection state.
- **ChatGPT can't reach the connector**: the `trycloudflare.com` URL changes every time you restart `npm run tunnel`, so update it in ChatGPT, or use a named Cloudflare tunnel or ngrok static domain for a permanent URL.
- **Anything else**: open the control panel → **Diagnostics** → **Auto-repair**. If that doesn't fix it, check the log (Windows: `%LOCALAPPDATA%\\ChatGPTChromeConnector\\connector.log`) or `curl http://127.0.0.1:8765/health`.

## Building the Windows installer
**On Windows** (Node.js and [Inno Setup 6](https://jrsoftware.org/isinfo.php) installed):

```powershell
powershell -ExecutionPolicy Bypass -File build\build-windows.ps1
```

**From Linux or macOS** with `node`, `makensis` (NSIS 3), `osslsigncode` and `wine` installed:

```bash
cd server && npm install && npm run build:win
```

This writes `dist/ChatGPTChromeConnector-Setup-<version>.exe`. The build bundles the server with esbuild, embeds it in the official Windows `node.exe` as a Node single-executable app, sets the icon and version info, switches it to a windowless app, and wraps everything plus `cloudflared.exe` and the extension into an NSIS installer. To remove the SmartScreen warning, sign `ChatGPTChromeConnector.exe` and the installer with a code-signing certificate (`osslsigncode sign …`).

## Development
`node server/index.js --tunnel --gui` runs the dev server with the control-panel window and tray icon (without `--gui` it's headless; the panel is still at `http://127.0.0.1:8765/`). `--no-tray` disables the tray icon. `NGROK=<path>` points at an ngrok binary.

`npm test` (in `server/`) launches Chromium with the extension loaded, starts the server, and runs every tool against a local test page through a real MCP client. Requires Playwright.
