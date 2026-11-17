import { createRequire } from "node:module"; const { chromium } = createRequire(import.meta.url)("playwright");
import { fileURLToPath } from "node:url"; const EXT = process.env.E2E_EXT || fileURLToPath(new URL("../../extension", import.meta.url)); const TOKEN = process.env.E2E_TOKEN || "testtoken123";
import http from "node:http";
import { spawn } from "node:child_process";
const srv = process.env.E2E_EXTERNAL_SERVER ? { kill() {} } : spawn(process.execPath, [fileURLToPath(new URL("../index.js", import.meta.url)), "--port", "8765"],
  { env: { ...process.env, CONNECTOR_TOKEN: "testtoken123" }, stdio: "ignore" });
process.on("exit", () => srv.kill());
await new Promise((r) => setTimeout(r, 800));
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const page = `<!doctype html><title>Test Shop</title><h1>Welcome</h1><p>Find the <a href="/about">about page</a>.</p>
<form action="/result" method="get"><label>Search <input name="q" placeholder="Search products"></label>
<select name="cat"><option value="a">Apples</option><option value="b">Bananas</option></select><button>Go</button></form>
<button id="cnt" onclick="this.textContent='Clicked '+(++window.n||(window.n=1))">Click me</button>
<div contenteditable="true" id="ed" aria-label="Notes"></div><table><tr><th>Item</th><th>Price</th></tr><tr><td>Pear</td><td>$2</td></tr></table>`;
const site = http.createServer((q, r) => { r.setHeader("content-type","text/html");
  r.end(q.url.startsWith("/result") ? `<title>Results</title><h1>Results for ${new URL(q.url,"http://x").searchParams.get("q")} in ${new URL(q.url,"http://x").searchParams.get("cat")}</h1>` : page); }).listen(9911);

const ctx = await chromium.launchPersistentContext("", { channel: "chromium", headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent("serviceworker");
await sw.evaluate(() => chrome.storage.local.set({ allowScripts: true }));
const p = ctx.pages()[0] || await ctx.newPage();
await p.goto("http://127.0.0.1:9911/");
for (let i = 0; i < 40; i++) { const h = await (await fetch("http://127.0.0.1:8765/health")).json(); if (h.extensionConnected) break; await new Promise(r=>setTimeout(r,250)); }

const c = new Client({ name: "t", version: "1" });
await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:8765/mcp/${TOKEN}`)));
const call = async (name, args = {}) => { const r = await c.callTool({ name, arguments: args });
  const out = r.content.map(x => x.type === "text" ? x.text : `[${x.type} ${x.mimeType} ${x.data.length}b]`).join("\n");
  console.log(`\n=== ${name} ${JSON.stringify(args)} ${r.isError ? "(ERROR)" : ""}\n${out.slice(0, 700)}`); return r; };

await call("list_tabs");
await call("read_page");
const f = await call("find_elements");
await call("click", { text: "Click me" });
await call("click", { selector: "#cnt" });
await call("read_page", { selector: "#cnt" });
await call("type_text", { selector: "#ed", value: "hello notes" });
await call("read_page", { selector: "#ed" });
await call("search", { query: "pear" });
await call("select_option", { selector: "select", option: "Bananas" });
await call("type_text", { text: "Search", value: "kiwi", submit: true });
await call("wait_for", { text: "Results for" });
await call("read_page");
await call("run_script", { code: "return history.length" }); await call("navigate", { action: "back" });
await new Promise(r=>setTimeout(r,1500)); console.log("PW url:", p.url()); await call("list_tabs"); await call("screenshot");
await call("navigate", { action: "forward" }); await call("navigate", { action: "back" });
await call("open_url", { url: "http://127.0.0.1:9911/about" });
await call("run_script", { code: "return document.title" });
await call("run_script", { code: "throw new Error(\"boom\")" });
await call("click", { text: "nonexistent thing" });
await call("click", { ref: 99999 });
await c.close(); await ctx.close(); site.close();
srv.kill(); process.exit(0);
