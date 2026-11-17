// Control-panel markup. Dynamic parts are filled in by client.js.
const I = {
  logo: '<svg viewBox="0 0 32 32" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="square"><path d="M4 11h17l-4-4M28 21H11l4 4"/></svg>',
  tray: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 10v4h12v-4M8 2v8M5 7l3 3 3-3"/></svg>',
  chat: '<svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 7h26v17H15l-7 6v-6H5z"/><path d="M11 13h14M11 18h9"/></svg>',
  tunnel: '<svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 30V17a14 13 0 0 1 28 0v13"/><path d="M11 30V18a7 7 0 0 1 14 0v12"/><path d="M2 30h32"/></svg>',
  server: '<svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="6" y="5" width="24" height="10"/><rect x="6" y="19" width="24" height="10"/><path d="M11 10h2M11 24h2M19 10h7M19 24h7"/></svg>',
  ext: '<svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M7 11h7a3 3 0 1 1 6 0h7v7a3 3 0 1 0 0 6v7H20a3 3 0 1 0-6 0H7v-7a3 3 0 1 1 0-6z"/></svg>',
  browser: '<svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="4" y="6" width="28" height="24"/><path d="M4 12h28"/><path d="M8 9h1M12 9h1M16 9h1"/></svg>',
  play: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2l10 6-10 6z"/></svg>',
  wrench: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M10.5 2a3.5 3.5 0 0 0-3.2 4.9L2 12.2 3.8 14l5.3-5.3A3.5 3.5 0 0 0 14 5.5l-2 2-2.2-.3-.3-2.2 2-2a3.5 3.5 0 0 0-1-.1z"/></svg>',
  copy: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="5" width="9" height="9"/><path d="M3 11V2h9"/></svg>',
  refresh: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M13.5 8A5.5 5.5 0 1 1 11.6 3.8M13.5 2v3.5H10"/></svg>',
  link: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M6.5 9.5l3-3M7 4.5l1.5-1.5a2.8 2.8 0 0 1 4 4L11 8.5M9 11.5L7.5 13a2.8 2.8 0 0 1-4-4L5 7.5"/></svg>',
  ext16: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 2h5v5M14 2L7 9M12 10v4H2V4h4"/></svg>',
  folder: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1.5 3.5h5l1.5 2h6.5v8h-13z"/></svg>',
  tab: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="1.5" y="3" width="13" height="10"/><path d="M1.5 6h13"/></svg>',
  pulse: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M1 8h3l2-5 3 10 2-5h4"/></svg>',
  power: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 1.5V8M4.5 3.8a5.5 5.5 0 1 0 7 0"/></svg>',
};

const screws = '<span class="screw"></span>';
const panel = (title, tag, body, extra = "") =>
  `<section class="panel"${extra}><div class="ph"><h2>${title}</h2><span class="grow"></span>${tag ? `<span class="tag">${tag}</span>` : ""}${screws}</div>${body}</section>`;

const toggle = (id, title, desc) =>
  `<label class="sw"><input type="checkbox" id="${id}"><span class="knob"></span><span class="lbl"><b>${title}</b><span>${desc}</span></span></label>`;

export const GUI_BODY = `
<div class="app">
  <header class="hdr">
    <div class="logo">${I.logo}</div>
    <div class="brand"><b>CHATGPT &#8644; CHROME</b><span>Connector control panel</span></div>
    <span class="ver" id="ver">v-</span>
    <span class="grow"></span>
    <div class="pill" title="Overall connection state"><span class="led lg" id="ovLed"></span><span id="ovText">Connecting…</span></div>
    <button class="hbtn" id="toTray" title="Hide this window. The connector keeps running in the notification area.">${I.tray}<span>To tray</span></button>
  </header>

  <div class="body">
    <nav class="nav" id="nav">
      <button data-v="overview"><span class="n">01</span>Overview</button>
      <button data-v="setup"><span class="n">02</span>Setup<span class="badge warn" id="bSetup">!</span></button>
      <button data-v="diagnostics"><span class="n">03</span>Diagnostics<span class="badge" id="bDiag"></span></button>
      <button data-v="activity"><span class="n">04</span>Activity</button>
      <button data-v="log"><span class="n">05</span>Log</button>
      <button data-v="settings"><span class="n">06</span>Settings</button>
      <button data-v="help"><span class="n">07</span>Help</button>
      <div class="foot">
        <div>UPTIME <b id="fUp">-</b></div>
        <div>PID <b id="fPid">-</b> &middot; PORT <b id="fPort">-</b></div>
        <div id="fMode">-</div>
      </div>
    </nav>

    <main class="main" id="main">
      <!-- OVERVIEW -->
      <section class="view" id="v-overview">
        <div class="vh"><h1>Overview</h1><span class="code">SYS-01</span><span class="grow"></span><p id="ovUpdated"></p></div>
        ${panel("Signal path", "CHATGPT &rarr; CHROME", `
          <div class="chain" id="chain">
            <div class="node" id="nChatgpt"><div class="nt">CHATGPT<span class="led"></span></div><div class="ic">${I.chat}</div><div class="ns"></div></div>
            <div class="link" id="l1"></div>
            <div class="node" id="nTunnel"><div class="nt">TUNNEL<span class="led"></span></div><div class="ic">${I.tunnel}</div><div class="ns"></div></div>
            <div class="link" id="l2"></div>
            <div class="node" id="nConn"><div class="nt">CONNECTOR<span class="led"></span></div><div class="ic">${I.server}</div><div class="ns"></div></div>
            <div class="link" id="l3"></div>
            <div class="node" id="nExt"><div class="nt">EXTENSION<span class="led"></span></div><div class="ic">${I.ext}</div><div class="ns"></div></div>
            <div class="link" id="l4"></div>
            <div class="node" id="nChrome"><div class="nt">CHROME<span class="led"></span></div><div class="ic">${I.browser}</div><div class="ns"></div></div>
          </div>
          <div class="chainmsg" id="chainMsg"><span class="led" id="cmLed"></span><span class="grow" id="cmText"></span><span id="cmAct"></span></div>
        `)}
        ${panel("Connector URL", "PASTE INTO CHATGPT", `
          <div class="pb">
            <div class="plate"><span class="k">URL</span><span class="v dim" id="cUrl">Waiting for the tunnel…</span>
              <button class="btn primary" id="copyUrl" disabled>${I.copy}Copy</button></div>
            <div class="alert" id="urlAlert" hidden><span class="led warn"></span><span class="grow" id="urlAlertText"></span>
              <button class="btn sm" data-act="open-chatgpt">${I.ext16}ChatGPT settings</button></div>
            <p class="muted" id="urlNote" style="margin:10px 0 0">ChatGPT reaches your computer through this secret address. Treat it like a password.</p>
          </div>
        `)}
        <div class="gauges" style="margin-bottom:14px">
          <div class="gauge"><div class="gv" id="gCalls">0</div><div class="gl">Tool calls</div></div>
          <div class="gauge" id="gErrBox"><div class="gv" id="gErr">0</div><div class="gl">Errors</div></div>
          <div class="gauge"><div class="gv" id="gLat">-</div><div class="gl">Avg response</div></div>
          <div class="gauge"><div class="gv" id="gLast">-</div><div class="gl">Last ChatGPT call</div></div>
          <div class="gauge"><div class="gv" id="gTabs">-</div><div class="gl">Chrome tabs</div></div>
        </div>
        <div class="cols">
          ${panel("Quick actions", "CTRL", `
            <div class="pb qa">
              <button class="btn primary" data-go="diagnostics" data-run="1">${I.pulse}Run diagnostics</button>
              <button class="btn" data-act="auto-repair">${I.wrench}Auto-repair</button>
              <button class="btn" data-act="restart-tunnel">${I.refresh}Restart tunnel</button>
              <button class="btn" data-act="repair-pairing">${I.link}Re-pair extension</button>
              <button class="btn" data-act="demo-tab">${I.tab}Open a test tab</button>
              <button class="btn" data-act="open-extensions-page">${I.ext16}Chrome extensions</button>
            </div>
          `)}
          ${panel("Recent events", "EVT", `<ul class="evl" id="ovEvents"><li class="empty">No events yet.</li></ul>`)}
        </div>
      </section>

      <!-- SETUP -->
      <section class="view" id="v-setup">
        <div class="vh"><h1>Setup</h1><span class="code">SYS-02</span><span class="grow"></span><p>Three steps. Each lamp turns green by itself.</p></div>
        ${panel("Installation sequence", "SEQ 1-3", `
          <div class="step" id="st1"><div class="num">1</div><div class="sc">
            <h3>Connector and secure tunnel</h3>
            <div class="stt"><span class="led"></span><span id="st1s">Checking…</span></div>
            <div class="err-t" id="st1e"></div>
            <p class="muted" style="margin:4px 0 0">Runs on this PC. The tunnel gives ChatGPT's servers a private HTTPS address that reaches it.</p>
          </div></div>
          <div class="step" id="st2"><div class="num">2</div><div class="sc">
            <h3>Chrome extension</h3>
            <div class="stt"><span class="led"></span><span id="st2s">Checking…</span></div>
            <ol>
              <li>In Chrome, open <code>chrome://extensions</code> <button class="btn sm" data-act="open-extensions-page">Open it</button></li>
              <li>Turn on <b>Developer mode</b> (top-right switch).</li>
              <li>Click <b>Load unpacked</b> and choose this folder: <button class="btn sm" data-act="open-ext-folder">${I.folder}Show folder</button><br><code id="extDir"></code></li>
            </ol>
            <p class="muted">It pairs by itself, with no token to paste. Already installed but not connecting? <button class="btn sm" data-act="repair-pairing">Re-pair</button></p>
          </div></div>
          <div class="step" id="st3"><div class="num">3</div><div class="sc">
            <h3>Add the connector to ChatGPT</h3>
            <div class="stt"><span class="led"></span><span id="st3s">Waiting for ChatGPT…</span></div>
            <div class="plate" style="margin:6px 0 8px"><span class="k">URL</span><span class="v dim" id="cUrl2">Waiting for the tunnel…</span><button class="btn primary" id="copyUrl2" disabled>${I.copy}Copy</button></div>
            <ol>
              <li>In ChatGPT open <b>Settings &rarr; Apps &amp; Connectors &rarr; Advanced settings</b> and turn on <b>Developer mode</b>.</li>
              <li>Click <b>Create</b>. Name: <b>Chrome</b>. MCP server URL: paste the URL above. Authentication: <b>No authentication</b>. Tick "I trust this application" and create it.</li>
              <li>In a chat, click <b>+ &rarr; Developer mode</b> and switch on <b>Chrome</b>. Ask it to "list my open tabs" to test.</li>
            </ol>
            <p class="muted" id="setupUrlNote">The free tunnel address changes when the connector restarts (for example after a reboot). This panel and the tray icon tell you when it does. For a permanent address, see Settings &rarr; Tunnel.</p>
          </div></div>
        `)}
      </section>

      <!-- DIAGNOSTICS -->
      <section class="view" id="v-diagnostics">
        <div class="vh"><h1>Diagnostics</h1><span class="code">SYS-03</span><span class="grow"></span><p id="dWhen">Not run yet</p></div>
        ${panel("Test bench", "DIAG", `
          <div class="pb">
            <div class="row">
              <button class="btn primary" id="runDiag">${I.pulse}Run all checks</button>
              <button class="btn" id="autoFix">${I.wrench}Auto-repair</button>
              <span class="grow" style="flex:1"></span>
              <button class="btn" id="copyReport">${I.copy}Copy report</button>
              <button class="btn" id="saveReport">Save report</button>
            </div>
            <div class="dsum" style="margin-top:12px">
              <div><b class="st-ok" id="dPass">-</b><span>Pass</span></div>
              <div><b class="st-warn" id="dWarn">-</b><span>Warning</span></div>
              <div><b class="st-fail" id="dFail">-</b><span>Fault</span></div>
              <div><b class="st-info" id="dInfo">-</b><span>Info / skipped</span></div>
            </div>
            <p class="muted" style="margin:10px 0 0">Auto-repair re-pairs the extension, restarts the tunnel and the tray icon as needed, then checks again. It never deletes settings. The report hides your secret, so it's safe to share for support.</p>
          </div>
          <div class="console" id="repairLog" hidden></div>
        `)}
        ${panel("Checks", "CHK", `<div id="checks"><div class="empty">Press <b>Run all checks</b> to test every link from ChatGPT to Chrome.</div></div>`)}
      </section>

      <!-- ACTIVITY -->
      <section class="view" id="v-activity">
        <div class="vh"><h1>Activity</h1><span class="code">SYS-04</span><span class="grow"></span><p id="aSum"></p></div>
        ${panel("Tool calls", "MCP", `
          <div class="tools">
            <label class="chkbox"><input type="checkbox" id="aErrOnly"> Errors only</label>
            <label class="chkbox"><input type="checkbox" id="aRemoteOnly"> From ChatGPT only</label>
            <span style="flex:1"></span>
            <button class="btn sm" data-act="clear-activity">Clear</button>
          </div>
          <div class="scroll"><table class="tbl"><thead><tr><th style="width:78px">Time</th><th>Tool</th><th style="width:92px">Source</th><th style="width:76px">Time taken</th><th>Details</th></tr></thead><tbody id="aCalls"></tbody></table>
          <div class="empty" id="aEmpty">No tool calls yet. They appear here as ChatGPT uses Chrome.</div></div>
        `)}
        ${panel("Connection events", "EVT", `<div class="scroll"><ul class="evl" id="aEvents"><li class="empty">No events yet.</li></ul></div>`)}
      </section>

      <!-- LOG -->
      <section class="view" id="v-log">
        <div class="vh"><h1>Log</h1><span class="code">SYS-05</span><span class="grow"></span><p id="logPath" class="mono"></p></div>
        ${panel("Service log", "LOG", `
          <div class="tools">
            <select class="t" id="lLevel"><option value="">All levels</option><option value="warn">Warnings and errors</option><option value="error">Errors only</option></select>
            <input class="t" id="lFind" placeholder="Filter text…">
            <label class="chkbox"><input type="checkbox" id="lFollow" checked> Follow</label>
            <span style="flex:1"></span>
            <button class="btn sm" id="lCopy">${I.copy}Copy</button>
            <button class="btn sm" data-act="open-log">Open log file</button>
            <button class="btn sm" data-act="open-data-folder">${I.folder}Data folder</button>
          </div>
          <div class="logbox" id="logbox"></div>
        `)}
      </section>

      <!-- SETTINGS -->
      <section class="view" id="v-settings">
        <div class="vh"><h1>Settings</h1><span class="code">SYS-06</span></div>
        <div class="cols">
          ${panel("Window and tray", "UI", `
            <div class="pb" style="padding-top:4px;padding-bottom:4px">
              ${toggle("uTray", "Notification-area icon", "Shows status in the system tray, with quick repair actions.")}
              ${toggle("uMin", "Minimize to tray", "The minimize button hides this window to the tray instead of the taskbar.")}
              ${toggle("uNotify", "Notifications", "Pop-up alerts when the connector URL changes or Chrome disconnects.")}
              ${toggle("uStartup", "Start when I sign in", "Runs the connector in the background after you sign in to Windows.")}
            </div>
          `)}
          ${panel("Security", "SEC", `
            <div class="pb">
              <label class="f" style="margin-top:0">Connector secret</label>
              <div class="plate"><span class="v" id="secret">&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;</span><button class="btn" id="revealSecret">Show</button></div>
              <p class="muted">The secret is part of the connector URL. If you think someone else has it, generate a new one, then paste the new URL into ChatGPT.</p>
              <div class="row"><button class="btn danger" id="newTok">Generate new secret</button></div>
            </div>
          `)}
        </div>
        ${panel("Tunnel", "NET", `
          <div class="pb">
            <div class="alert fail" id="tBlocked" hidden><span class="led fail"></span><span class="grow">This network blocks Cloudflare's tunnel port (7844). Choose <b>ngrok</b> below: it uses the normal HTTPS port.</span></div>
            <div class="radio" id="tMode" style="margin-top:10px">
              <label><input type="radio" name="tmode" value="quick"><span>Cloudflare quick</span></label>
              <label><input type="radio" name="tmode" value="named"><span>Cloudflare named</span></label>
              <label><input type="radio" name="tmode" value="ngrok"><span>ngrok</span></label>
            </div>
            <p class="muted" id="tModeHelp"></p>
            <div id="ngrokFields">
              <div class="row"><span class="led" id="ngInstLed"></span><span id="ngInst" style="font-size:13px">Checking…</span>
                <button class="btn sm" data-act="install-ngrok" id="ngInstall">Download ngrok</button></div>
              <ol class="muted" style="margin:10px 0 0;padding-left:18px">
                <li>Create a free ngrok account: <button class="btn sm" data-link="ngrok-signup">${I.ext16}Sign up</button></li>
                <li>Copy your authtoken: <button class="btn sm" data-link="ngrok-token">${I.ext16}Your authtoken</button></li>
                <li>Optional, for a permanent URL: copy your free static domain: <button class="btn sm" data-link="ngrok-domains">${I.ext16}Domains</button></li>
              </ol>
              <label class="f" for="ngTok">ngrok authtoken</label>
              <input class="t" id="ngTok" type="password" autocomplete="off" placeholder="Paste your authtoken">
              <label class="f" for="ngDom">Static domain (optional, recommended)</label>
              <input class="t" id="ngDom" placeholder="your-name.ngrok-free.app">
            </div>
            <div id="namedFields">
              <label class="f" for="pub">Permanent public URL</label>
              <input class="t" id="pub" placeholder="https://chrome.yourdomain.com">
              <label class="f" for="cft">Cloudflare tunnel token</label>
              <input class="t" id="cft" type="password" placeholder="From Cloudflare Zero Trust → Networks → Tunnels (route it to http://127.0.0.1:8765)">
            </div>
            <div class="row mt"><button class="btn primary" id="saveTun">Save and restart tunnel</button><span class="err-t" id="tunErr"></span></div>
          </div>
        `, ' id="pTunnel"')}
        <div class="cols">
          ${panel("Service", "SVC", `
            <div class="pb">
              <p class="muted" style="margin-top:0">Restarting takes a few seconds. The free tunnel gets a new address after a restart.</p>
              <div class="row"><button class="btn" id="restartSrv">${I.refresh}Restart connector</button><button class="btn danger" id="stopSrv">${I.power}Stop connector</button></div>
            </div>
          `)}
          ${panel("Locations", "FS", `
            <div class="pb kv" id="paths"></div>
          `)}
        </div>
      </section>

      <!-- HELP -->
      <section class="view" id="v-help">
        <div class="vh"><h1>Help</h1><span class="code">SYS-07</span><span class="grow"></span><p>Most problems are fixed by <b>Diagnostics &rarr; Auto-repair</b>.</p></div>
        ${panel("Troubleshooting", "FAQ", `
          <details class="faq"><summary>ChatGPT says it can't reach the connector, or the tools fail with an error</summary><div class="ans">
            <p>Most often the connector URL changed. The free tunnel gets a new address every time the connector restarts or the network changes.</p>
            <p>Copy the URL from <b>Overview</b>, then in ChatGPT go to <b>Settings &rarr; Apps &amp; Connectors</b>, open your Chrome connector and replace its URL. If you can't edit it there, delete the connector and create it again.</p>
            <p>If the Overview shows <b>ChatGPT is using an old URL</b>, this is definitely the cause.</p></div></details>
          <details class="faq"><summary>The Extension lamp stays red</summary><div class="ans">
            <p>1. Make sure Chrome is open. 2. Open <code>chrome://extensions</code> and check that <b>ChatGPT Chrome Connector</b> is listed and switched on. 3. If it's missing, load it again from the extension folder (Setup, step 2). 4. Press <b>Re-pair extension</b>.</p>
            <p>If you moved or reinstalled the connector, remove the old extension and load the one from the current folder. Chrome remembers the folder it was loaded from.</p></div></details>
          <details class="faq"><summary>The tunnel won't start, or the public URL doesn't answer</summary><div class="ans">
            <p>Cloudflare tunnels need outbound port <b>7844</b>. Many work, school and corporate networks (and some VPNs and antivirus products) block it. Diagnostics tests this port directly. If it's blocked, switch to <b>ngrok</b> under Settings &rarr; Tunnel. ngrok uses the normal HTTPS port 443 and needs only a free account.</p>
            <p>A brand-new address can take up to a minute to work. If it keeps failing, <b>Restart tunnel</b> to get a fresh one. Diagnostics shows the exact error.</p></div></details>
          <details class="faq"><summary>The URL changes after every reboot. Can I keep one?</summary><div class="ans">
            <p>Yes. The easiest way is <b>ngrok</b> with its free static domain: sign up, copy your authtoken and your domain from the ngrok dashboard, and enter both under Settings &rarr; Tunnel. Then the URL never changes.</p>
            <p>Or use a Cloudflare <b>named tunnel</b>. You need a free Cloudflare account and a domain on Cloudflare. Create a tunnel in Zero Trust &rarr; Networks &rarr; Tunnels, add a public hostname that routes to <code>http://127.0.0.1:8765</code>, then enter that hostname and the tunnel token under <b>Settings &rarr; Tunnel</b>.</p></div></details>
          <details class="faq"><summary>Clicks or typing don't work on a particular site</summary><div class="ans">
            <p>The extension sends simulated input. A few sites ignore it on purpose. Ask ChatGPT to try a different element, use the keyboard (press_key), or do that step yourself.</p></div></details>
          <details class="faq"><summary>run_script says it's disabled or blocked</summary><div class="ans">
            <p>Custom JavaScript is off by default. Turn it on in the extension's popup (the toolbar icon). Some sites still block it with their security policy (CSP).</p></div></details>
          <details class="faq"><summary>Where did the window go? How do I quit?</summary><div class="ans">
            <p>Closing or minimizing this window doesn't stop the connector. It keeps running in the notification area (the &and; arrow next to the clock). Click the icon to reopen this panel. Right-click it and choose <b>Stop connector and exit</b> to quit.</p></div></details>
          <details class="faq"><summary>Getting help</summary><div class="ans">
            <p>Run <b>Diagnostics</b>, then <b>Copy report</b> and include it when you ask for help. The report hides your secret.</p></div></details>
        `)}
        ${panel("About", "INFO", `<div class="pb kv" id="about"></div>`)}
      </section>
    </main>
  </div>

  <footer class="sbar">
    <span class="it"><span class="led" id="sbExt"></span>Extension</span>
    <span class="it"><span class="led" id="sbTun"></span>Tunnel</span>
    <span class="it"><span class="led" id="sbGpt"></span>ChatGPT</span>
    <span class="it"><span class="led" id="sbTray"></span>Tray</span>
    <span class="grow"></span>
    <span class="hint" id="sbHint">Closing this window keeps the connector running in the notification area.</span>
  </footer>
</div>

<div class="offline" id="offline"><div class="box"><div class="stripe"></div><div class="in">
  <h2>Connector offline</h2>
  <p>The connector service isn't responding, so ChatGPT can't reach Chrome right now.</p>
  <p class="muted">Start it from the notification-area icon (right-click &rarr; <b>Start connector</b>) or from the Start menu: <b>ChatGPT Chrome Connector</b>. This panel reconnects by itself.</p>
  <div class="row"><span class="led fail"></span><span class="muted" id="offTry">Retrying…</span></div>
</div><div class="stripe"></div></div></div>

<div class="modal" id="modal"><div class="box"><div class="ph"><h2 id="mTitle">Confirm</h2><span class="grow"></span>${screws}</div>
  <div class="in" id="mText"></div><div class="row"><button class="btn" id="mNo">Cancel</button><button class="btn primary" id="mYes">OK</button></div></div></div>
<div class="toasts" id="toasts"></div>
`;
