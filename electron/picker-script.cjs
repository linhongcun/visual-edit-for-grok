/**
 * Injected into the preview page for element pick mode.
 * Selection is reported via console.log("__VEFG_SELECT__" + JSON).
 */
function getPickerScript() {
  return `
(() => {
  if (window.__vefgPickerInstalled) return true;
  window.__vefgPickerInstalled = true;

  let pickMode = false;
  let hoverEl = null;
  let selectedEl = null;
  let badge = null;

  function ensureStyles() {
    if (document.getElementById("__vefg_hover_style")) return;
    const s = document.createElement("style");
    s.id = "__vefg_hover_style";
    s.textContent = \`
      .__vefg_hover {
        outline: 2px solid #3b82f6 !important;
        outline-offset: 2px !important;
        cursor: crosshair !important;
      }
      .__vefg_selected {
        outline: 2px solid #22c55e !important;
        outline-offset: 2px !important;
      }
      #__vefg_badge {
        position: fixed;
        z-index: 2147483647;
        pointer-events: none;
        background: #1e293b;
        color: #e2e8f0;
        font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
        padding: 4px 8px;
        border-radius: 6px;
        box-shadow: 0 4px 16px rgba(0,0,0,.35);
        max-width: 420px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    \`;
    document.documentElement.appendChild(s);
  }

  function cleanClasses(el) {
    return Array.from(el.classList || []).filter((c) => !c.startsWith("__vefg"));
  }

  /** Full CSS selector (unique-ish) */
  function cssPath(el) {
    if (!(el instanceof Element)) return "";
    const parts = [];
    while (el && el.nodeType === 1 && parts.length < 8) {
      let part = el.nodeName.toLowerCase();
      if (el.id) {
        part += "#" + CSS.escape(el.id);
        parts.unshift(part);
        break;
      }
      const parent = el.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (c) => c.nodeName === el.nodeName
        );
        if (siblings.length > 1) {
          part += ":nth-of-type(" + (siblings.indexOf(el) + 1) + ")";
        }
      }
      const classes = cleanClasses(el).slice(0, 3);
      if (classes.length) {
        part += "." + classes.map((c) => CSS.escape(c)).join(".");
      }
      parts.unshift(part);
      el = parent;
    }
    return parts.join(" > ");
  }

  /**
   * Cursor-style dom_path, e.g. main > div.cta > button#cta-secondary
   * Skips html/body; prefers #id on nodes, else first class.
   */
  function domPath(el) {
    if (!(el instanceof Element)) return "";
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1) {
      const tag = cur.tagName.toLowerCase();
      if (tag === "html" || tag === "body") break;
      let part = tag;
      if (cur.id) {
        part += "#" + cur.id;
      } else {
        const cls = cleanClasses(cur)[0];
        if (cls) part += "." + cls;
      }
      parts.unshift(part);
      cur = cur.parentElement;
      if (parts.length >= 12) break;
    }
    return parts.join(" > ");
  }

  function keyStyles(el) {
    const cs = window.getComputedStyle(el);
    const keys = [
      "display", "position", "width", "height", "margin", "padding",
      "color", "backgroundColor", "fontSize", "fontWeight", "fontFamily",
      "lineHeight", "border", "borderRadius", "boxShadow", "flex", "gap",
      "justifyContent", "alignItems", "gridTemplateColumns", "opacity",
      "overflow", "textAlign", "zIndex"
    ];
    const out = {};
    for (const k of keys) {
      const v = cs[k];
      if (v && v !== "none" && v !== "normal" && v !== "auto" && v !== "0px" && v !== "rgba(0, 0, 0, 0)") {
        out[k] = v;
      }
    }
    return out;
  }

  function describe(el) {
    const rect = el.getBoundingClientRect();
    const classes = cleanClasses(el);
    // Clone without picker marker classes for clean outerHTML
    const clone = el.cloneNode(true);
    if (clone instanceof Element) {
      Array.from(clone.classList || []).forEach((c) => {
        if (c.startsWith("__vefg")) clone.classList.remove(c);
      });
      clone.querySelectorAll && clone.querySelectorAll("[class]").forEach((node) => {
        Array.from(node.classList || []).forEach((c) => {
          if (c.startsWith("__vefg")) node.classList.remove(c);
        });
      });
    }
    let outerHTML = clone.outerHTML || el.outerHTML || "";
    if (outerHTML.length > 2000) {
      outerHTML = outerHTML.slice(0, 2000) + "\\n<!-- truncated -->";
    }
    const text = (el.innerText || "").trim().slice(0, 500);
    const attrs = {};
    for (const a of Array.from(el.attributes || [])) {
      if (a.name.startsWith("__vefg")) continue;
      if (a.name === "class") {
        attrs.class = classes.join(" ");
        continue;
      }
      attrs[a.name] = a.value.slice(0, 200);
    }
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      className: classes.join(" "),
      classes,
      selector: cssPath(el),
      domPath: domPath(el),
      text,
      attributes: attrs,
      outerHTML,
      computedStyle: keyStyles(el),
      boundingBox: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        top: Math.round(rect.top),
        left: Math.round(rect.left),
      },
      pageUrl: location.href,
      pageTitle: document.title,
      timestamp: Date.now(),
    };
  }

  function showBadge(el, x, y) {
    ensureStyles();
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "__vefg_badge";
      document.documentElement.appendChild(badge);
    }
    const classes = Array.from(el.classList || [])
      .filter((c) => !c.startsWith("__vefg"))
      .slice(0, 2)
      .join(".");
    badge.textContent =
      el.tagName.toLowerCase() +
      (el.id ? "#" + el.id : "") +
      (classes ? "." + classes : "");
    badge.style.top = Math.max(8, y - 28) + "px";
    badge.style.left = Math.min(window.innerWidth - 200, Math.max(8, x + 12)) + "px";
    badge.style.display = "block";
  }

  function hideBadge() {
    if (badge) badge.style.display = "none";
  }

  function clearHover() {
    if (hoverEl) {
      hoverEl.classList.remove("__vefg_hover");
      hoverEl = null;
    }
    hideBadge();
  }

  function onMove(e) {
    if (!pickMode) return;
    e.preventDefault();
    e.stopPropagation();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === badge || el.id === "__vefg_badge") return;
    if (el === hoverEl) {
      showBadge(el, e.clientX, e.clientY);
      return;
    }
    clearHover();
    hoverEl = el;
    ensureStyles();
    hoverEl.classList.add("__vefg_hover");
    showBadge(el, e.clientX, e.clientY);
  }

  function onClick(e) {
    if (!pickMode) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === badge) return;
    if (selectedEl) selectedEl.classList.remove("__vefg_selected");
    selectedEl = el;
    ensureStyles();
    selectedEl.classList.add("__vefg_selected");
    clearHover();
    console.log("__VEFG_SELECT__" + JSON.stringify(describe(el)));
    window.__vefgSetPickMode(false);
  }

  function onKey(e) {
    if (!pickMode) return;
    if (e.key === "Escape") {
      e.preventDefault();
      window.__vefgSetPickMode(false);
      console.log("__VEFG_CANCEL_PICK__");
    }
  }

  window.__vefgSetPickMode = function (enabled) {
    pickMode = !!enabled;
    ensureStyles();
    if (!pickMode) {
      clearHover();
      document.documentElement.style.cursor = "";
    } else {
      document.documentElement.style.cursor = "crosshair";
    }
  };

  /** Remove aim overlays after a successful capture */
  window.__vefgClearSelection = function () {
    clearHover();
    if (selectedEl) {
      selectedEl.classList.remove("__vefg_selected");
      selectedEl = null;
    }
    document.querySelectorAll(".__vefg_selected, .__vefg_hover").forEach((el) => {
      el.classList.remove("__vefg_selected", "__vefg_hover");
    });
    hideBadge();
    document.documentElement.style.cursor = "";
    pickMode = false;
  };

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("mousedown", (e) => {
    if (pickMode) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  document.addEventListener("mouseup", (e) => {
    if (pickMode) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  return true;
})();
`;
}

module.exports = { getPickerScript };
