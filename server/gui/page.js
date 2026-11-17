// Assembles the control-panel page served at http://127.0.0.1:<port>/ (only reachable from this machine).
import { GUI_CSS } from "./style.js";
import { GUI_BODY } from "./markup.js";
import { guiClient } from "./client.js";

// Must match WINDOW_TITLE in desktop.js: the tray helper finds the window by this exact title.
const TITLE = "ChatGPT Chrome Connector - Control Panel";

export const GUI_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${TITLE}</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#c9672a"/><path d="M4 11h17l-4-4M28 21H11l4 4" fill="none" stroke="#fff" stroke-width="3"/></svg>')}">
<style>${GUI_CSS}</style>
</head>
<body>
${GUI_BODY}
<script>(${guiClient.toString()})();</script>
</body>
</html>`;
