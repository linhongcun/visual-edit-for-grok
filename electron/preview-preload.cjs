const { ipcRenderer } = require("electron");

// This preload runs in Electron's isolated, sandboxed world. The preview page
// can see the temporary highlight classes in its DOM, but it cannot access the
// authenticated IPC channel used to report a selection.
let token = null;
let navigationId = 0;
let pickMode = false;
let hoverEl = null;
let selectedEl = null;
let badge = null;

function cleanClasses(el) {
  return Array.from(el?.classList || []).filter(
    (name) => !name.startsWith("__vefg"),
  );
}

function ensureStyles() {
  if (!document.documentElement || document.getElementById("__vefg_hover_style")) {
    return;
  }
  const style = document.createElement("style");
  style.id = "__vefg_hover_style";
  style.textContent = `
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
      position: fixed !important;
      z-index: 2147483647 !important;
      pointer-events: none !important;
      background: #1e293b !important;
      color: #e2e8f0 !important;
      font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace !important;
      padding: 4px 8px !important;
      border: 1px solid rgba(148, 163, 184, .35) !important;
      border-radius: 6px !important;
      box-shadow: 0 4px 16px rgba(0, 0, 0, .35) !important;
      max-width: 420px !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
    }
  `;
  document.documentElement.appendChild(style);
}

function cssPath(el) {
  if (!(el instanceof Element)) return "";
  const parts = [];
  let cur = el;
  while (cur && cur.nodeType === 1 && parts.length < 8) {
    let part = cur.nodeName.toLowerCase();
    if (cur.id) {
      part += `#${CSS.escape(cur.id)}`;
      parts.unshift(part);
      break;
    }
    const parent = cur.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (candidate) => candidate.nodeName === cur.nodeName,
      );
      if (siblings.length > 1) {
        part += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
      }
    }
    const classes = cleanClasses(cur).slice(0, 3);
    if (classes.length) {
      part += `.${classes.map((name) => CSS.escape(name)).join(".")}`;
    }
    parts.unshift(part);
    cur = parent;
  }
  return parts.join(" > ");
}

function domPath(el) {
  if (!(el instanceof Element)) return "";
  const parts = [];
  let cur = el;
  while (cur && cur.nodeType === 1 && parts.length < 12) {
    const tag = cur.tagName.toLowerCase();
    if (tag === "html" || tag === "body") break;
    let part = tag;
    if (cur.id) {
      part += `#${cur.id}`;
    } else {
      const firstClass = cleanClasses(cur)[0];
      if (firstClass) part += `.${firstClass}`;
    }
    parts.unshift(part);
    cur = cur.parentElement;
  }
  return parts.join(" > ");
}

function keyStyles(el) {
  const styles = window.getComputedStyle(el);
  const keys = [
    "display",
    "position",
    "width",
    "height",
    "margin",
    "padding",
    "color",
    "backgroundColor",
    "fontSize",
    "fontWeight",
    "fontFamily",
    "lineHeight",
    "border",
    "borderRadius",
    "boxShadow",
    "flex",
    "gap",
    "justifyContent",
    "alignItems",
    "gridTemplateColumns",
    "opacity",
    "overflow",
    "textAlign",
    "zIndex",
  ];
  const result = {};
  for (const key of keys) {
    const value = styles[key];
    if (
      value &&
      !["none", "normal", "auto", "0px", "rgba(0, 0, 0, 0)"].includes(value)
    ) {
      result[key] = value;
    }
  }
  return result;
}

function contextSnapshot() {
  return {
    navigationId,
    pageUrl: location.href,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
    },
    scroll: {
      x: Math.round(window.scrollX || 0),
      y: Math.round(window.scrollY || 0),
    },
  };
}

function describe(el) {
  const rect = el.getBoundingClientRect();
  const classes = cleanClasses(el);
  const attributes = {};
  for (const attr of Array.from(el.attributes || []).slice(0, 32)) {
    if (attr.name.startsWith("__vefg")) continue;
    attributes[attr.name] =
      attr.name === "class" ? classes.join(" ") : attr.value.slice(0, 300);
  }
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    className: classes.join(" "),
    classes,
    selector: cssPath(el),
    domPath: domPath(el),
    text: (el.innerText || el.textContent || "").trim().slice(0, 500),
    attributes,
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
    captureContext: contextSnapshot(),
  };
}

function hideBadge() {
  if (badge) badge.style.display = "none";
}

function clearHover() {
  if (hoverEl) hoverEl.classList.remove("__vefg_hover");
  hoverEl = null;
  hideBadge();
}

function clearSelection() {
  clearHover();
  if (selectedEl) selectedEl.classList.remove("__vefg_selected");
  selectedEl = null;
  document
    .querySelectorAll?.(".__vefg_selected, .__vefg_hover")
    .forEach((el) => el.classList.remove("__vefg_selected", "__vefg_hover"));
  hideBadge();
  if (document.documentElement) document.documentElement.style.cursor = "";
  pickMode = false;
}

function showBadge(el, x, y) {
  ensureStyles();
  if (!badge) {
    badge = document.createElement("div");
    badge.id = "__vefg_badge";
    document.documentElement?.appendChild(badge);
  }
  if (!badge) return;
  const classes = cleanClasses(el).slice(0, 2).join(".");
  badge.textContent = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${classes ? `.${classes}` : ""}`;
  badge.style.top = `${Math.max(8, y - 28)}px`;
  badge.style.left = `${Math.min(window.innerWidth - 200, Math.max(8, x + 12))}px`;
  badge.style.display = "block";
}

function setMode(enabled) {
  pickMode = Boolean(enabled);
  ensureStyles();
  if (!pickMode) {
    clearHover();
    if (document.documentElement) document.documentElement.style.cursor = "";
  } else if (document.documentElement) {
    document.documentElement.style.cursor = "crosshair";
  }
}

document.addEventListener(
  "mousemove",
  (event) => {
    if (!pickMode) return;
    event.preventDefault();
    event.stopPropagation();
    const el = document.elementFromPoint(event.clientX, event.clientY);
    if (!(el instanceof Element) || el === badge || el.id === "__vefg_badge") return;
    if (el !== hoverEl) {
      clearHover();
      hoverEl = el;
      ensureStyles();
      hoverEl.classList.add("__vefg_hover");
    }
    showBadge(el, event.clientX, event.clientY);
  },
  true,
);

document.addEventListener(
  "click",
  (event) => {
    if (!pickMode || !token || !event.isTrusted) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const el = document.elementFromPoint(event.clientX, event.clientY);
    if (!(el instanceof Element) || el === badge) return;
    if (selectedEl) selectedEl.classList.remove("__vefg_selected");
    selectedEl = el;
    selectedEl.classList.add("__vefg_selected");
    clearHover();
    pickMode = false;
    ipcRenderer.send("preview-picker:select", {
      token,
      navigationId,
      selection: describe(el),
    });
  },
  true,
);

for (const eventName of ["mousedown", "mouseup"]) {
  document.addEventListener(
    eventName,
    (event) => {
      if (!pickMode) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    },
    true,
  );
}

document.addEventListener(
  "keydown",
  (event) => {
    if (!pickMode || event.key !== "Escape" || !event.isTrusted) return;
    event.preventDefault();
    event.stopPropagation();
    setMode(false);
    ipcRenderer.send("preview-picker:cancel", { token, navigationId });
  },
  true,
);

ipcRenderer.on("preview-picker:configure", (_event, next) => {
  token = typeof next?.token === "string" ? next.token : null;
  navigationId = Number.isInteger(next?.navigationId) ? next.navigationId : 0;
  clearSelection();
});

ipcRenderer.on("preview-picker:set-mode", (_event, next) => {
  if (
    !next ||
    next.token !== token ||
    next.navigationId !== navigationId
  ) {
    setMode(false);
    return;
  }
  setMode(next.enabled);
});

ipcRenderer.on("preview-picker:clear", () => clearSelection());

ipcRenderer.on("preview-picker:resolve", (_event, request) => {
  if (
    !request ||
    request.token !== token ||
    request.navigationId !== navigationId ||
    typeof request.requestId !== "string"
  ) {
    return;
  }
  let selection = null;
  try {
    const el = document.querySelector(request.selector);
    if (el instanceof Element) selection = describe(el);
  } catch {
    selection = null;
  }
  ipcRenderer.send("preview-picker:resolved", {
    token,
    navigationId,
    requestId: request.requestId,
    selection,
  });
});
