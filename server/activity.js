// In-memory telemetry for the control panel: log lines, connection events and MCP calls.
// Everything here is bounded ring buffers, so memory stays flat no matter how long it runs.

class Ring {
  constructor(max) { this.max = max; this.items = []; this.seq = 0; }
  push(item) {
    const entry = { seq: ++this.seq, t: Date.now(), ...item };
    this.items.push(entry);
    if (this.items.length > this.max) this.items.shift();
    return entry;
  }
  since(seq = 0) { return this.items.filter((x) => x.seq > seq); }
  clear() { this.items = []; }
}

export const logs = new Ring(800);      // { level, msg }
export const events = new Ring(300);    // { kind, level, msg }
export const calls = new Ring(300);     // { tool, method, via, ok, ms, error }

export const stats = {
  startedAt: Date.now(),
  mcpRequests: 0,
  toolCalls: 0,
  toolErrors: 0,
  lastChatgptAt: null,          // last authorized MCP request that came through the tunnel
  lastChatgptUrl: null,         // connector URL in effect at that moment
  unauthorizedRemote: 0,        // 401s through the tunnel (ChatGPT using an old secret)
  lastUnauthorizedAt: null,
  extensionConnects: 0,
  extensionDisconnects: 0,
  lastExtensionDisconnectAt: null,
  tunnelRestarts: 0,
  urlChanges: 0,
  latencies: [],                // last 50 tool-call durations in ms
};

export function recordLatency(ms) {
  stats.latencies.push(ms);
  if (stats.latencies.length > 50) stats.latencies.shift();
}

export function latencySummary() {
  const l = stats.latencies;
  if (!l.length) return { avg: null, p95: null, n: 0 };
  const sorted = [...l].sort((a, b) => a - b);
  return {
    avg: Math.round(l.reduce((a, b) => a + b, 0) / l.length),
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    n: l.length,
  };
}

// Listeners (the tray helper's notification queue subscribes here).
const listeners = new Set();
export const onEvent = (fn) => listeners.add(fn);

export function event(kind, msg, level = "info", extra = {}) {
  const e = events.push({ kind, level, msg, ...extra });
  for (const fn of listeners) { try { fn(e); } catch {} }
  return e;
}
