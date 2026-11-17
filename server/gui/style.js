// Control-panel theme: 2000s industrial. Safety orange on bone white, graphite trim, matte finish.
// Uses fonts that ship with Windows (Bahnschrift is a DIN-style face) and falls back cleanly elsewhere.
export const GUI_CSS = String.raw`
:root {
  --ink: #232527;
  --graphite: #2d2f32;
  --graphite-2: #3a3d41;
  --graphite-3: #4a4e53;
  --steel: #80868c;
  --steel-l: #b3b7bb;
  --bone: #e6e1d7;
  --bone-2: #ddd7cb;
  --paper: #efece6;
  --white: #faf9f6;
  --line: #cfc9bd;
  --line-d: #aaa395;
  --orange: #c9672a;
  --orange-d: #9e4f1d;
  --orange-l: #e7b08a;
  --orange-wash: #f4e4d6;
  --amber: #e9a46b;
  --ok: #5a8a3c;
  --warn: #c8962b;
  --fail: #b0432f;
  --idle: #8e8e8a;
  --mono: "Cascadia Mono", Consolas, "Lucida Console", monospace;
  --sans: Bahnschrift, "DIN Alternate", "D-DIN", "Arial Narrow", "Segoe UI", Arial, sans-serif;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { height: 100%; }
body {
  margin: 0; background: var(--paper); color: var(--ink);
  font: 14px/1.45 var(--sans); overflow: hidden;
  -webkit-font-smoothing: antialiased;
}
button, input, select { font: inherit; color: inherit; }
::selection { background: var(--orange-l); }
a { color: var(--orange-d); }
code, .mono { font-family: var(--mono); font-size: 12.5px; }
code { background: var(--bone); border: 1px solid var(--line); padding: 0 5px; border-radius: 2px; }

/* ---------- frame ---------- */
.app { display: grid; grid-template-rows: auto 1fr auto; height: 100vh; }
.hdr {
  display: flex; align-items: center; gap: 14px; padding: 0 14px 0 0; height: 58px;
  background: var(--graphite); color: #ece8e0; border-bottom: 4px solid var(--orange);
  box-shadow: inset 0 -1px 0 #000;
}
.logo {
  width: 58px; height: 58px; flex: none; display: grid; place-items: center;
  background: var(--orange); border-right: 1px solid #000; position: relative;
}
.logo svg { width: 30px; height: 30px; }
.brand { display: flex; flex-direction: column; line-height: 1.1; min-width: 0; }
.brand b { font-size: 17px; letter-spacing: .14em; font-weight: 700; white-space: nowrap; }
.brand span { font-size: 11px; letter-spacing: .22em; color: var(--steel-l); text-transform: uppercase; white-space: nowrap; }
.hdr .grow { flex: 1; }
.ver { font-family: var(--mono); font-size: 11px; color: var(--steel-l); border: 1px solid var(--graphite-3); padding: 2px 6px; }
.pill {
  display: flex; align-items: center; gap: 9px; padding: 6px 12px 6px 10px; min-width: 210px;
  background: #222427; border: 1px solid #111; box-shadow: inset 0 1px 2px rgba(0,0,0,.5), 0 1px 0 var(--graphite-3);
  font-size: 12px; letter-spacing: .12em; text-transform: uppercase; font-weight: 600;
}
.hbtn {
  height: 32px; padding: 0 12px; display: flex; align-items: center; gap: 8px; cursor: pointer;
  background: var(--graphite-2); color: #ece8e0; border: 1px solid #16181a; border-bottom-width: 2px;
  font-size: 11px; letter-spacing: .16em; text-transform: uppercase; font-weight: 600;
}
.hbtn:hover { background: var(--graphite-3); }
.hbtn:active { transform: translateY(1px); }
.hbtn svg { width: 14px; height: 14px; }

.body { display: grid; grid-template-columns: 208px 1fr; min-height: 0; }
.nav {
  background: var(--bone); border-right: 1px solid var(--line-d); display: flex; flex-direction: column;
  box-shadow: inset -1px 0 0 var(--white); overflow-y: auto;
}
.nav button {
  display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; cursor: pointer;
  padding: 11px 14px 11px 16px; background: transparent; border: 0; border-bottom: 1px solid var(--line);
  border-left: 4px solid transparent; font-size: 13px; letter-spacing: .14em; text-transform: uppercase; font-weight: 600; color: var(--graphite-2);
}
.nav button .n { font-family: var(--mono); font-size: 11px; color: var(--steel); letter-spacing: 0; width: 18px; }
.nav button:hover { background: var(--bone-2); }
.nav button.on { background: var(--white); border-left-color: var(--orange); color: var(--ink); }
.nav button.on .n { color: var(--orange); }
.nav .badge { margin-left: auto; min-width: 20px; padding: 0 5px; height: 18px; display: none; place-items: center; font-size: 11px; letter-spacing: 0; background: var(--fail); color: #fff; }
.nav .badge.show { display: grid; }
.nav .badge.warn { background: var(--warn); }
.nav .foot { margin-top: auto; padding: 12px 16px; font-size: 11px; color: var(--steel); letter-spacing: .06em; border-top: 1px solid var(--line-d); line-height: 1.6; }
.nav .foot b { color: var(--graphite-2); font-weight: 600; }

.main { overflow-y: auto; padding: 18px 20px 28px; min-width: 0; }
.view { display: none; max-width: 1100px; }
.view.on { display: block; }
.vh { display: flex; align-items: flex-end; gap: 12px; margin: 0 0 14px; border-bottom: 2px solid var(--graphite-2); padding-bottom: 6px; }
.vh h1 { margin: 0; font-size: 22px; letter-spacing: .12em; text-transform: uppercase; font-weight: 700; }
.vh .code { font-family: var(--mono); font-size: 11px; color: var(--steel); margin-bottom: 4px; }
.vh .grow { flex: 1; }
.vh p { margin: 0 0 3px; color: var(--steel); font-size: 13px; }

.sbar {
  display: flex; align-items: center; gap: 18px; height: 28px; padding: 0 14px; font-size: 11px;
  background: var(--graphite); color: var(--steel-l); letter-spacing: .12em; text-transform: uppercase; border-top: 1px solid #000;
}
.sbar .it { display: flex; align-items: center; gap: 7px; white-space: nowrap; }
.sbar .grow { flex: 1; }
.sbar .hint { text-transform: none; letter-spacing: .02em; color: var(--steel); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ---------- panels ---------- */
.panel {
  background: var(--white); border: 1px solid var(--line-d); margin-bottom: 14px; position: relative;
  box-shadow: inset 0 1px 0 #fff, 0 1px 0 rgba(0,0,0,.05);
}
.ph {
  display: flex; align-items: center; gap: 10px; height: 34px; padding: 0 12px 0 0;
  background: var(--bone); border-bottom: 1px solid var(--line-d); box-shadow: inset 0 1px 0 #f6f3ed;
}
.ph::before { content: ""; width: 6px; align-self: stretch; background: var(--orange); border-right: 1px solid var(--orange-d); }
.ph h2 { margin: 0; font-size: 12px; letter-spacing: .2em; text-transform: uppercase; font-weight: 700; color: var(--graphite); }
.ph .grow { flex: 1; }
.ph .tag { font-family: var(--mono); font-size: 10.5px; color: var(--steel); }
.ph .screw { width: 7px; height: 7px; border-radius: 50%; background: var(--steel-l); box-shadow: inset 0 0 0 1px var(--line-d), inset 1px 1px 0 #fff; position: relative; }
.ph .screw::after { content: ""; position: absolute; left: 1px; right: 1px; top: 3px; height: 1px; background: var(--steel); transform: rotate(-35deg); }
.pb { padding: 14px 16px; }
.pb.tight { padding: 0; }
.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 0 14px; }
.cols > .panel { min-width: 0; }

/* ---------- controls ---------- */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 32px; padding: 0 13px; cursor: pointer;
  background: var(--bone); color: var(--graphite); border: 1px solid var(--line-d); border-bottom: 2px solid #8f887a;
  font-size: 11.5px; letter-spacing: .14em; text-transform: uppercase; font-weight: 700; white-space: nowrap;
  box-shadow: inset 0 1px 0 #f8f6f1;
}
.btn:hover { background: var(--bone-2); }
.btn:active { transform: translateY(1px); border-bottom-width: 1px; margin-bottom: 1px; }
.btn:disabled { opacity: .45; cursor: default; transform: none; }
.btn.primary { background: var(--orange); color: #fff; border-color: var(--orange-d); border-bottom-color: #7a3c15; box-shadow: inset 0 1px 0 rgba(255,255,255,.18); }
.btn.primary:hover { background: #bb5f25; }
.btn.danger { color: var(--fail); }
.btn.danger:hover { background: #ecd9d3; }
.btn.sm { height: 26px; padding: 0 9px; font-size: 10.5px; }
.btn svg { width: 14px; height: 14px; flex: none; }
.btn.busy { pointer-events: none; opacity: .75; }
.btn.busy::after { content: ""; width: 10px; height: 10px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin .7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.row.mt { margin-top: 12px; }

label.f { display: block; font-size: 11px; letter-spacing: .16em; text-transform: uppercase; font-weight: 700; color: var(--graphite-2); margin: 12px 0 5px; }
input.t, select.t {
  width: 100%; height: 34px; padding: 0 10px; background: #fff; border: 1px solid var(--line-d);
  box-shadow: inset 0 1px 2px rgba(0,0,0,.08); font-family: var(--mono); font-size: 13px; border-radius: 0;
}
input.t:focus, select.t:focus { outline: 2px solid var(--orange-l); outline-offset: 0; border-color: var(--orange); }
input.t::placeholder { color: #a49e93; font-family: var(--sans); }

.sw { display: flex; align-items: flex-start; gap: 12px; padding: 11px 0; border-bottom: 1px solid var(--line); cursor: pointer; }
.sw:last-child { border-bottom: 0; }
.sw input { position: absolute; opacity: 0; pointer-events: none; }
.sw .knob {
  flex: none; width: 44px; height: 22px; margin-top: 1px; position: relative; background: var(--bone-2);
  border: 1px solid var(--line-d); box-shadow: inset 0 1px 3px rgba(0,0,0,.18);
}
.sw .knob::after {
  content: "OFF"; position: absolute; top: 1px; left: 1px; width: 22px; height: 18px; display: grid; place-items: center;
  font-size: 8px; letter-spacing: .05em; font-weight: 700; color: var(--steel);
  background: var(--white); border: 1px solid var(--line-d); border-bottom-width: 2px; transition: left .12s;
}
.sw input:checked + .knob { background: var(--orange); border-color: var(--orange-d); }
.sw input:checked + .knob::after { content: "ON"; left: 19px; color: var(--orange-d); }
.sw input:focus-visible + .knob { outline: 2px solid var(--orange-l); }
.sw input:disabled + .knob { opacity: .5; }
.sw .lbl b { display: block; font-size: 13.5px; font-weight: 600; }
.sw .lbl span { display: block; color: var(--steel); font-size: 12.5px; }

.radio { display: flex; gap: 0; margin-top: 4px; }
.radio label { flex: 1; cursor: pointer; }
.radio input { position: absolute; opacity: 0; }
.radio span {
  display: block; text-align: center; padding: 8px 6px; background: var(--bone); border: 1px solid var(--line-d); margin-left: -1px;
  font-size: 11.5px; letter-spacing: .14em; text-transform: uppercase; font-weight: 700; color: var(--graphite-2);
}
.radio input:checked + span { background: var(--graphite-2); color: #fff; border-color: var(--graphite); box-shadow: inset 0 -3px 0 var(--orange); }
.radio input:focus-visible + span { outline: 2px solid var(--orange-l); }

/* ---------- lamps ---------- */
.led {
  display: inline-block; flex: none; width: 12px; height: 12px; border-radius: 50%; background: var(--idle);
  border: 1px solid rgba(0,0,0,.45); box-shadow: inset 0 -2px 2px rgba(0,0,0,.25);
}
.led.ok, .led.pass { background: var(--ok); box-shadow: inset 0 -2px 2px rgba(0,0,0,.2), 0 0 5px rgba(90,138,60,.45); }
.led.warn { background: var(--warn); box-shadow: inset 0 -2px 2px rgba(0,0,0,.2), 0 0 5px rgba(200,150,43,.45); }
.led.fail { background: var(--fail); box-shadow: inset 0 -2px 2px rgba(0,0,0,.2), 0 0 5px rgba(176,67,47,.5); animation: blink 1.6s steps(2, start) infinite; }
.led.info { background: #6f8796; }
.led.skip, .led.idle { background: #b1afa8; }
.led.lg { width: 16px; height: 16px; }
@keyframes blink { 50% { opacity: .55; } }
@media (prefers-reduced-motion: reduce) { .led.fail { animation: none; } }
.st-ok, .st-pass { color: var(--ok); } .st-warn { color: #9c7416; } .st-fail { color: var(--fail); } .st-idle, .st-skip { color: var(--steel); } .st-info { color: #56707f; }

/* ---------- overview: signal path ---------- */
.chain { display: flex; align-items: stretch; padding: 18px 16px 16px; gap: 0; overflow-x: auto; }
.node {
  flex: 1 1 0; min-width: 118px; background: var(--paper); border: 1px solid var(--line-d); position: relative;
  box-shadow: inset 0 1px 0 #fff;
}
.node .nt {
  display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 5px 8px;
  background: var(--graphite-2); color: #ece8e0; font-size: 10.5px; letter-spacing: .2em; font-weight: 700;
}
.node .ic { display: grid; place-items: center; height: 58px; color: var(--graphite-2); }
.node .ic svg { width: 34px; height: 34px; }
.node .ns { padding: 0 8px 9px; text-align: center; font-size: 12px; color: var(--graphite-2); min-height: 34px; line-height: 1.3; }
.node .ns b { display: block; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; }
.node.ok .ic { color: var(--ok); } .node.warn .ic { color: #a77c1a; } .node.fail .ic { color: var(--fail); } .node.idle .ic { color: var(--steel); }
.node.fail { border-color: var(--fail); }
.link { flex: 0 0 34px; align-self: center; height: 6px; position: relative; background: var(--line); border-top: 1px solid var(--line-d); border-bottom: 1px solid #fff; }
.link.ok { background: var(--ok); border-top-color: #3f6629; }
.link.warn { background: repeating-linear-gradient(90deg, var(--warn) 0 6px, transparent 6px 10px); border-color: transparent; }
.link.fail { background: repeating-linear-gradient(90deg, var(--fail) 0 4px, transparent 4px 9px); border-color: transparent; }
.link.ok::after { content: ""; position: absolute; top: -1px; width: 10px; height: 6px; background: rgba(255,255,255,.55); animation: flow 1.8s linear infinite; }
@keyframes flow { from { left: 0; } to { left: calc(100% - 10px); } }
@media (prefers-reduced-motion: reduce) { .link.ok::after { display: none; } }
.chainmsg { margin: 0 16px 14px; padding: 9px 12px; border: 1px solid var(--line-d); background: var(--paper); font-size: 13px; display: flex; gap: 10px; align-items: flex-start; }
.chainmsg.fail { border-color: var(--fail); background: #f3e1dc; }
.chainmsg.warn { border-color: var(--warn); background: #f5ead2; }
.chainmsg.ok { border-color: #a9c49a; background: #e5eedf; }
.chainmsg .grow { flex: 1; }

.plate {
  display: flex; align-items: stretch; border: 1px solid var(--graphite); background: #fff; margin-top: 2px;
}
.plate .k { background: var(--graphite-2); color: #ece8e0; padding: 0 12px; display: flex; align-items: center; font-size: 10.5px; letter-spacing: .2em; font-weight: 700; }
.plate .v { flex: 1; min-width: 0; padding: 9px 12px; font-family: var(--mono); font-size: 12.5px; word-break: break-all; line-height: 1.35; }
.plate .v.dim { color: var(--steel); font-family: var(--sans); }
.plate .btn { height: auto; border: 0; border-left: 1px solid var(--graphite); }
.plate .btn:active { margin: 0; }
.stripe { height: 6px; background: repeating-linear-gradient(-45deg, var(--orange) 0 9px, var(--graphite) 9px 18px); }
.alert { display: flex; gap: 10px; align-items: center; padding: 10px 12px; margin-top: 10px; border: 1px solid var(--warn); background: #f5ead2; font-size: 13px; }
.alert.fail { border-color: var(--fail); background: #f3e1dc; }
.alert .grow { flex: 1; }

.gauges { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
.gauge { background: var(--graphite); border: 1px solid #111; box-shadow: inset 0 0 0 1px var(--graphite-3); padding: 9px 11px 8px; min-width: 0; }
.gauge .gv { font-family: var(--mono); font-size: 24px; line-height: 1.1; color: var(--amber); letter-spacing: .02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gauge .gv small { font-size: 12px; color: #b98a63; margin-left: 3px; }
.gauge .gl { font-size: 10px; letter-spacing: .2em; text-transform: uppercase; color: var(--steel-l); margin-top: 3px; font-weight: 600; }
.gauge.bad .gv { color: #e2836f; }

.qa { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px; }
.qa .btn { justify-content: flex-start; height: 40px; }

/* ---------- lists / tables ---------- */
.evl { list-style: none; margin: 0; padding: 0; }
.evl li { display: grid; grid-template-columns: 64px 14px 1fr; gap: 8px; align-items: baseline; padding: 6px 14px; border-bottom: 1px solid var(--line); font-size: 13px; }
.evl li:last-child { border-bottom: 0; }
.evl .tm { font-family: var(--mono); font-size: 11.5px; color: var(--steel); }
.evl .led { width: 9px; height: 9px; transform: translateY(1px); }
.empty { padding: 18px 16px; color: var(--steel); font-size: 13px; text-align: center; }

table.tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.tbl th { position: sticky; top: 0; background: var(--bone); text-align: left; font-size: 10.5px; letter-spacing: .18em; text-transform: uppercase; color: var(--graphite-2); padding: 7px 10px; border-bottom: 1px solid var(--line-d); font-weight: 700; }
.tbl td { padding: 6px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
.tbl tr:nth-child(even) td { background: #f5f3ee; }
.tbl .mono { font-size: 12px; }
.tbl .err { color: var(--fail); font-size: 12px; }
.tbl .args { color: var(--steel); font-family: var(--mono); font-size: 11.5px; word-break: break-all; }
.src { display: inline-block; font-size: 10px; letter-spacing: .14em; font-weight: 700; padding: 1px 6px; border: 1px solid var(--line-d); background: var(--bone); }
.src.chatgpt { background: var(--orange-wash); border-color: var(--orange-l); color: var(--orange-d); }
.scroll { max-height: 420px; overflow-y: auto; }

/* ---------- diagnostics ---------- */
.dsum { display: flex; gap: 0; border: 1px solid var(--line-d); }
.dsum div { flex: 1; padding: 8px 12px; border-right: 1px solid var(--line-d); background: var(--paper); }
.dsum div:last-child { border-right: 0; }
.dsum b { display: block; font-family: var(--mono); font-size: 22px; line-height: 1.1; }
.dsum span { font-size: 10.5px; letter-spacing: .18em; text-transform: uppercase; color: var(--steel); font-weight: 600; }
.grp { padding: 6px 14px; background: var(--paper); border-bottom: 1px solid var(--line-d); border-top: 1px solid var(--line-d); font-size: 10.5px; letter-spacing: .22em; font-weight: 700; color: var(--graphite-2); text-transform: uppercase; }
.grp:first-child { border-top: 0; }
.chk { display: grid; grid-template-columns: 18px 210px 1fr; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--line); align-items: start; }
.chk .led { margin-top: 3px; }
.chk .cl { font-weight: 600; font-size: 13.5px; }
.chk .cs { font-size: 10px; letter-spacing: .16em; font-weight: 700; text-transform: uppercase; display: block; margin-top: 1px; }
.chk .cd { font-size: 13px; color: var(--graphite-2); word-break: break-word; }
.chk .fx { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 7px; }
.chk.fail { background: #f8ebe7; }
.chk.warn { background: #f8f1e1; }
.console {
  background: #232527; color: #d8d3c8; font-family: var(--mono); font-size: 12.5px; padding: 10px 12px; min-height: 90px; max-height: 260px; overflow-y: auto;
  border-top: 1px solid #000; line-height: 1.55; white-space: pre-wrap; word-break: break-word;
}
.console .ok { color: #9ec27f; } .console .warn { color: #e3bd6a; } .console .fail, .console .error { color: #ef9580; } .console .tm { color: #7f858a; }

/* ---------- log ---------- */
.logbox { background: #232527; color: #d8d3c8; font-family: var(--mono); font-size: 12px; height: calc(100vh - 260px); min-height: 240px; overflow: auto; padding: 8px 0; line-height: 1.55; }
.logbox div { padding: 0 12px; white-space: pre-wrap; word-break: break-word; }
.logbox div:hover { background: #2e3134; }
.logbox .tm { color: #7f858a; margin-right: 8px; }
.logbox .lv { display: inline-block; width: 46px; color: #7f858a; }
.logbox .warn .lv { color: #e3bd6a; } .logbox .error .lv { color: #ef9580; } .logbox .error { color: #f2c4b8; }
.tools { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 10px 12px; background: var(--paper); border-bottom: 1px solid var(--line-d); }
.tools input.t { width: 220px; height: 30px; }
.tools select.t { width: auto; height: 30px; font-family: var(--sans); }
.chkbox { display: flex; align-items: center; gap: 6px; font-size: 12.5px; cursor: pointer; }
.chkbox input { accent-color: var(--orange); }

/* ---------- setup ---------- */
.step { display: grid; grid-template-columns: 46px 1fr; gap: 0; border-bottom: 1px solid var(--line); }
.step:last-child { border-bottom: 0; }
.step .num { display: grid; place-items: start center; padding-top: 14px; background: var(--paper); border-right: 1px solid var(--line); font-family: var(--mono); font-size: 18px; font-weight: 700; color: var(--steel); }
.step.done .num { background: var(--ok); color: #fff; border-right-color: #3f6629; }
.step .sc { padding: 13px 16px; }
.step h3 { margin: 0 0 2px; font-size: 15px; letter-spacing: .06em; }
.step .stt { font-size: 11px; letter-spacing: .16em; text-transform: uppercase; font-weight: 700; display: flex; align-items: center; gap: 7px; margin-bottom: 6px; }
.step ol { margin: 6px 0 0; padding-left: 20px; } .step li { margin: 4px 0; }

/* ---------- help ---------- */
details.faq { border-bottom: 1px solid var(--line); }
details.faq:last-child { border-bottom: 0; }
details.faq summary { cursor: pointer; padding: 11px 16px; font-weight: 600; list-style: none; display: flex; gap: 10px; align-items: center; }
details.faq summary::-webkit-details-marker { display: none; }
details.faq summary::before { content: "+"; width: 18px; height: 18px; display: grid; place-items: center; background: var(--bone); border: 1px solid var(--line-d); font-family: var(--mono); font-size: 13px; color: var(--orange-d); flex: none; }
details.faq[open] summary::before { content: "\2212"; background: var(--orange); color: #fff; border-color: var(--orange-d); }
details.faq[open] summary { background: var(--paper); }
details.faq .ans { padding: 2px 16px 14px 44px; font-size: 13.5px; color: var(--graphite-2); }
details.faq .ans p { margin: 6px 0; }
.kv { display: grid; grid-template-columns: 150px 1fr auto; gap: 6px 12px; font-size: 13px; align-items: center; }
.kv .k { font-size: 10.5px; letter-spacing: .16em; text-transform: uppercase; color: var(--steel); font-weight: 700; }
.kv .v { font-family: var(--mono); font-size: 12px; word-break: break-all; }
.muted { color: var(--steel); font-size: 12.5px; }
.err-t { color: var(--fail); font-size: 13px; min-height: 1em; }

/* ---------- overlays ---------- */
.offline { position: fixed; inset: 0; z-index: 50; display: none; place-items: center; background: rgba(35,37,39,.72); }
.offline.show { display: grid; }
.offline .box { width: min(480px, calc(100vw - 32px)); background: var(--white); border: 1px solid #000; box-shadow: 0 10px 30px rgba(0,0,0,.35); }
.offline .box .in { padding: 18px 20px 20px; }
.offline h2 { margin: 0 0 6px; font-size: 18px; letter-spacing: .14em; text-transform: uppercase; }
.modal { position: fixed; inset: 0; z-index: 60; display: none; place-items: center; background: rgba(35,37,39,.55); }
.modal.show { display: grid; }
.modal .box { width: min(440px, calc(100vw - 32px)); background: var(--white); border: 1px solid var(--graphite); box-shadow: 0 10px 30px rgba(0,0,0,.3); }
.modal .in { padding: 16px 18px; font-size: 14px; }
.modal .row { justify-content: flex-end; padding: 0 18px 16px; }
.toasts { position: fixed; right: 16px; bottom: 40px; z-index: 70; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; pointer-events: none; }
.toast {
  pointer-events: auto; max-width: 380px; display: flex; gap: 10px; align-items: flex-start; padding: 10px 14px 10px 0;
  background: var(--graphite); color: #ece8e0; border: 1px solid #000; font-size: 13px; box-shadow: 0 6px 16px rgba(0,0,0,.3);
  animation: tin .18s ease-out;
}
.toast::before { content: ""; width: 5px; align-self: stretch; background: var(--orange); }
.toast.ok::before { background: var(--ok); } .toast.fail::before { background: var(--fail); } .toast.warn::before { background: var(--warn); }
@keyframes tin { from { transform: translateY(8px); opacity: 0; } }

@media (max-width: 860px) {
  .body { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
  .nav { flex-direction: row; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--line-d); }
  .nav button { width: auto; border-bottom: 0; border-left: 0; border-top: 3px solid transparent; padding: 10px 12px; }
  .nav button.on { border-top-color: var(--orange); }
  .nav .foot { display: none; }
  .gauges { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .chk { grid-template-columns: 18px 1fr; }
  .chk .cd { grid-column: 2; }
  .brand span, .ver { display: none; }
  .pill { min-width: 0; }
  .main { padding: 14px 16px 24px; }
  .kv { grid-template-columns: 1fr; }
}
`;
