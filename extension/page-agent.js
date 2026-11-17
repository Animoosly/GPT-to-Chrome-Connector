// Injected into pages via chrome.scripting.executeScript({ func: pageAgent, args: [op, params] }).
// Must be fully self-contained (no closures over module scope).
export async function pageAgent(op, p) {
  p = p || {};
  const ATTR = "data-gpt-ref";
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const isVisible = (el) => {
    if (!el.isConnected) return false;
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const inViewport = (el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  };
  const labelOf = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria) return norm(aria);
    const lb = el.getAttribute("aria-labelledby");
    if (lb) {
      const t = lb.split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ");
      if (norm(t)) return norm(t);
    }
    if (el.labels && el.labels.length) return norm([...el.labels].map((l) => l.innerText).join(" "));
    const t = norm(el.innerText || el.textContent);
    if (t) return t.slice(0, 150);
    return norm(el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("alt") ||
      el.querySelector?.("img[alt]")?.alt || el.value || el.name || "");
  };

  // Walk DOM including open shadow roots
  const allElements = (root = document) => {
    const out = [];
    const walk = (r) => {
      for (const el of r.querySelectorAll("*")) {
        out.push(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(root);
    return out;
  };
  const deepQuery = (sel) => {
    const direct = document.querySelector(sel);
    if (direct) return direct;
    for (const el of allElements()) if (el.shadowRoot) { const f = el.shadowRoot.querySelector(sel); if (f) return f; }
    return null;
  };

  const INTERACTIVE = 'a[href],button,input:not([type=hidden]),textarea,select,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=switch],[role=combobox],[role=textbox],[role=searchbox],[contenteditable=""],[contenteditable=true],[tabindex]:not([tabindex="-1"]),[onclick]';
  const assignRef = (el) => {
    let ref = el.getAttribute(ATTR);
    if (!ref) {
      window.__gptRefCounter = (window.__gptRefCounter || 0) + 1;
      ref = String(window.__gptRefCounter);
      el.setAttribute(ATTR, ref);
    }
    return Number(ref);
  };
  const describe = (el) => {
    const tag = el.tagName.toLowerCase();
    const d = { ref: assignRef(el), tag, role: el.getAttribute("role") || undefined, name: labelOf(el) };
    if (el.type && tag === "input") d.type = el.type;
    if (tag === "a") d.href = el.href;
    if ("value" in el && tag !== "button" && el.value) d.value = String(el.value).slice(0, 200);
    if (el.placeholder) d.placeholder = el.placeholder;
    if (el.checked) d.checked = true;
    if (el.disabled) d.disabled = true;
    if (tag === "select") d.options = [...el.options].slice(0, 30).map((o) => o.label);
    if (!inViewport(el)) d.offscreen = true;
    return d;
  };

  const resolve = () => {
    let el = null;
    if (p.ref != null) {
      el = deepQuery(`[${ATTR}="${p.ref}"]`);
      if (!el) throw new Error(`No element with ref ${p.ref}. The page may have changed; call find_elements again.`);
    } else if (p.selector) {
      el = deepQuery(p.selector);
      if (!el) throw new Error(`No element matches selector ${p.selector}`);
    } else if (p.text) {
      const want = norm(p.text).toLowerCase();
      const cands = allElements().filter((e) => e.matches(INTERACTIVE) && isVisible(e));
      el = cands.find((e) => labelOf(e).toLowerCase() === want) || cands.find((e) => labelOf(e).toLowerCase().includes(want));
      if (!el) {
        // fall back to any visible element whose own text matches
        el = allElements().find((e) => isVisible(e) && e.children.length === 0 && norm(e.textContent).toLowerCase() === want);
      }
      if (!el) throw new Error(`No visible element with text "${p.text}"`);
    } else if (op === "key") {
      return document.activeElement || document.body;
    } else {
      throw new Error("Provide ref, selector, or text to identify the element");
    }
    return el;
  };

  const toMarkdown = (root, maxLen) => {
    const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "CANVAS", "IFRAME", "OBJECT", "HEAD", "META", "LINK"]);
    const BLOCK = new Set(["P", "DIV", "SECTION", "ARTICLE", "MAIN", "HEADER", "FOOTER", "NAV", "ASIDE", "FORM", "FIGURE", "FIGCAPTION", "BLOCKQUOTE", "DL", "DT", "DD", "UL", "OL", "TABLE", "THEAD", "TBODY", "DETAILS", "FIELDSET", "LABEL"]);
    let out = "";
    const walk = (n) => {
      if (out.length > maxLen) return;
      if (n.nodeType === 3) { out += n.nodeValue.replace(/\s+/g, " "); return; }
      if (n.nodeType !== 1 && n.nodeType !== 11) return;
      const el = n;
      const tag = el.tagName || "";
      if (SKIP.has(tag.toUpperCase())) return;
      if (n.nodeType === 1 && el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true })) return;
      const kids = () => { for (const c of (el.shadowRoot || el).childNodes) walk(c); };
      const h = /^H([1-6])$/.exec(tag);
      if (h) { out += `\n\n${"#".repeat(+h[1])} ${norm(el.innerText)}\n\n`; return; }
      switch (tag) {
        case "BR": out += "\n"; return;
        case "HR": out += "\n\n---\n\n"; return;
        case "A": {
          const t = norm(el.innerText);
          if (t && el.href && !el.href.startsWith("javascript:")) out += ` [${t}](${el.href}) `; else kids();
          return;
        }
        case "IMG": if (el.alt) out += ` [image: ${norm(el.alt)}] `; return;
        case "LI": out += "\n- "; kids(); return;
        case "PRE": out += "\n```\n" + el.innerText + "\n```\n"; return;
        case "CODE": out += "`" + el.innerText + "`"; return;
        case "TR": out += "\n|"; kids(); return;
        case "TD": case "TH": out += " " + norm(el.innerText) + " |"; return;
        case "INPUT": case "TEXTAREA": case "SELECT": {
          const v = el.type === "password" ? "" : el.value;
          out += ` [${el.tagName.toLowerCase()}${el.type ? ":" + el.type : ""} "${labelOf(el)}"${v ? ` = "${String(v).slice(0, 100)}"` : ""}] `;
          return;
        }
        case "BUTTON": out += ` [button: ${labelOf(el)}] `; return;
      }
      const block = BLOCK.has(tag);
      if (block) out += "\n";
      kids();
      if (block) out += "\n";
    };
    walk(root);
    return out.replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/ {2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  };

  const fireMouse = (el) => {
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    el.dispatchEvent(new PointerEvent("pointerover", o));
    el.dispatchEvent(new MouseEvent("mouseover", o));
    el.dispatchEvent(new PointerEvent("pointerdown", o));
    el.dispatchEvent(new MouseEvent("mousedown", o));
    el.focus?.({ preventScroll: true });
    el.dispatchEvent(new PointerEvent("pointerup", o));
    el.dispatchEvent(new MouseEvent("mouseup", o));
    el.click();
  };
  const fireKey = (el, key) => {
    const codes = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, " ": 32 };
    const o = { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, keyCode: codes[key] || key.charCodeAt(0), which: codes[key] || key.charCodeAt(0), bubbles: true, cancelable: true, composed: true };
    const down = new KeyboardEvent("keydown", o);
    el.dispatchEvent(down);
    if (key === "Enter" || key.length === 1) el.dispatchEvent(new KeyboardEvent("keypress", o));
    el.dispatchEvent(new KeyboardEvent("keyup", o));
    return down.defaultPrevented;
  };
  const setNativeValue = (el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  };

  try { return await (() => { switch (op) {
    case "read": {
      const root = p.selector ? deepQuery(p.selector) : document.body;
      if (!root) throw new Error(`No element matches ${p.selector}`);
      const max = p.maxChars || 20000, off = p.offset || 0;
      const full = toMarkdown(root, off + max + 1000);
      const content = full.slice(off, off + max);
      return { title: document.title, url: location.href, offset: off, content, truncated: full.length > off + max,
        nextOffset: full.length > off + max ? off + max : undefined };
    }
    case "find": {
      const q = (p.query || "").toLowerCase();
      const limit = p.limit || 150;
      const els = allElements().filter((e) => e.matches(INTERACTIVE) && isVisible(e) && !e.closest("[aria-hidden=true]"));
      let items = els
        .filter((e) => p.includeOffscreen !== false || inViewport(e))
        .map(describe)
        .filter((d) => !q || [d.name, d.placeholder, d.href, d.value].some((s) => s && s.toLowerCase().includes(q)));
      items.sort((a, b) => (a.offscreen ? 1 : 0) - (b.offscreen ? 1 : 0));
      return { url: location.href, title: document.title, total: items.length, elements: items.slice(0, limit) };
    }
    case "click": {
      const el = resolve();
      el.scrollIntoView({ block: "center", inline: "center" });
      if (el.disabled) throw new Error("Element is disabled");
      fireMouse(el);
      return { clicked: describe(el) };
    }
    case "type": {
      const el = resolve();
      el.scrollIntoView({ block: "center" });
      el.focus();
      if (el.isContentEditable) {
        if (!p.append) { document.getSelection().selectAllChildren(el); }
        else { const s = document.getSelection(); s.selectAllChildren(el); s.collapseToEnd(); }
        if (!document.execCommand("insertText", false, p.value)) el.textContent = (p.append ? el.textContent : "") + p.value;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: p.value, inputType: "insertText" }));
      } else if ("value" in el) {
        setNativeValue(el, (p.append ? el.value : "") + p.value);
      } else {
        throw new Error("Target is not a text field");
      }
      let submitted = false;
      if (p.submit) {
        const handled = fireKey(el, "Enter");
        const form = el.form || el.closest("form");
        if (!handled && form && el.tagName !== "TEXTAREA") {
          form.requestSubmit ? form.requestSubmit() : form.submit();
        }
        submitted = true;
      }
      return { typed: true, submitted, element: describe(el) };
    }
    case "select": {
      const el = resolve();
      if (el.tagName !== "SELECT") throw new Error("Target is not a <select>");
      const want = p.option.toLowerCase();
      const opt = [...el.options].find((o) => o.value.toLowerCase() === want || norm(o.label).toLowerCase() === want) ||
        [...el.options].find((o) => norm(o.label).toLowerCase().includes(want));
      if (!opt) throw new Error(`Option "${p.option}" not found. Options: ${[...el.options].map((o) => o.label).join(", ")}`);
      setNativeValue(el, opt.value);
      return { selected: opt.label };
    }
    case "key": {
      const el = resolve();
      fireKey(el, p.key);
      return { pressed: p.key };
    }
    case "scroll": {
      if (p.ref != null || p.selector) { const el = resolve(); el.scrollIntoView({ block: "center" }); }
      else {
        const amt = p.amount || innerHeight * 0.85;
        const d = p.direction || "down";
        if (d === "top") scrollTo(0, 0);
        else if (d === "bottom") scrollTo(0, document.documentElement.scrollHeight);
        else scrollBy(0, d === "up" ? -amt : amt);
      }
      return { scrollY: Math.round(scrollY), scrollHeight: document.documentElement.scrollHeight, viewportHeight: innerHeight };
    }
    case "wait": {
      const timeout = Math.min(p.timeoutMs || 10000, 30000);
      const start = Date.now();
      return new Promise((res, rej) => {
        const check = () => {
          const ok = p.selector ? !!deepQuery(p.selector)
            : p.text ? (document.body?.innerText || "").toLowerCase().includes(p.text.toLowerCase())
            : document.readyState === "complete";
          if (ok) return res({ found: true, waitedMs: Date.now() - start });
          if (Date.now() - start > timeout) return rej(new Error(`Timed out after ${timeout}ms waiting for ${p.selector || p.text || "load"}`));
          setTimeout(check, 250);
        };
        check();
      });
    }
    case "selection":
      return { selection: String(getSelection() || ""), url: location.href };
    case "text":
      return { text: (document.body?.innerText || "").slice(0, p.maxChars || 50000) };
    default:
      throw new Error(`Unknown page op ${op}`);
  } })(); } catch (e) {
    return { __error: String(e?.message || e) };
  }
}
